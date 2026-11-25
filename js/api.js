(function (GM) {
  "use strict";

  const C = GM.Config;

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function requestOnce(action, params, signal) {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal?.addEventListener("abort", abort, {
      once: true,
    });

    if (signal?.aborted) abort();

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;

      controller.abort();
    }, C.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(C.GAS_URL, {
        method: "POST",

        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
        },

        body: JSON.stringify({
          ...params,
          action,
        }),

        redirect: "follow",
        credentials: "omit",

        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("ERR_RATE_LIMIT");
        }

        throw new Error(response.status >= 500 ? "ERR_TEMPORARY" : "ERR_API");
      }

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error("ERR_API");
      }

      if (!result.ok) {
        const error = new Error(result.errorCode || "ERR_API");

        error.requestId = result.requestId;

        throw error;
      }

      return result.data;
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      if (timedOut) {
        throw new Error("ERR_TIMEOUT");
      }

      if (error instanceof TypeError) {
        throw new Error("ERR_NETWORK");
      }

      throw error;
    } finally {
      clearTimeout(timer);

      signal?.removeEventListener("abort", abort);
    }
  }

  async function request(action, params = {}, options = {}) {
    // 規約同意前は利用者データを外部送信しない
    if (action !== "status" && !GM.Storage.hasConsent()) {
      throw new Error("ERR_CONSENT");
    }

    if (!navigator.onLine) {
      throw new Error("ERR_OFFLINE");
    }

    const retryable = [
      "ERR_BUSY",
      "ERR_TEMPORARY",
      "ERR_NETWORK",
      "ERR_TIMEOUT",
    ];

    for (let attempt = 0; attempt <= C.MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      try {
        return await requestOnce(action, params, options.signal);
      } catch (error) {
        if (attempt === C.MAX_RETRIES || !retryable.includes(error.message)) {
          throw error;
        }

        const delay = 1200 * Math.pow(2, attempt) + Math.random() * 300;

        await wait(delay);
      }
    }

    throw new Error("ERR_API");
  }

  function geocode(query, options) {
    return request("geocode", { query }, options);
  }

  function getStatus() {
    return request("status");
  }

  function getCurrentPosition() {
    if (!GM.Storage.hasConsent()) {
      return Promise.reject(new Error("ERR_CONSENT"));
    }

    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("ERR_LOCATION"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            label: "現在地",

            lat: position.coords.latitude,

            lng: position.coords.longitude,

            source: "gps",
          }),

        () => reject(new Error("ERR_LOCATION")),

        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 0,
        },
      );
    });
  }

  GM.Api = Object.freeze({
    request,
    wait,
    geocode,
    getStatus,
    getCurrentPosition,
  });
})(window.GourmetMap);
