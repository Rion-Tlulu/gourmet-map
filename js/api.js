(function (GM) {
  "use strict";

  const C = GM.Config;

  const GAS_URL_PATTERN =
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

  // 一時障害のみ再試行する（PER-03）
  const RETRYABLE = Object.freeze([
    "ERR_BUSY",
    "ERR_TEMPORARY",
    "ERR_NETWORK",
    "ERR_TIMEOUT",
  ]);

  function abortError() {
    return new DOMException("Aborted", "AbortError");
  }

  // 中断可能な待機
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function isConfigured() {
    return GAS_URL_PATTERN.test(C.GAS_URL);
  }

  async function requestOnce(action, params, signal) {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted) abort();

    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, C.REQUEST_TIMEOUT_MS);

    try {
      // text/plain でプリフライトを発生させない（GASのCORS制約）
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
        cache: "no-store",
        referrerPolicy: "no-referrer",
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

      if (!result || typeof result !== "object") {
        throw new Error("ERR_API");
      }

      // GASはHTTP状態を返せないため、応答本文の ok / errorCode で判定（SYS-03）
      if (!result.ok) {
        const error = new Error(
          /^ERR_[A-Z_]+$/.test(result.errorCode) ? result.errorCode : "ERR_API",
        );

        error.requestId = result.requestId;

        throw error;
      }

      return result.data;
    } catch (error) {
      if (signal?.aborted) {
        throw abortError();
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
    if (!isConfigured()) {
      throw new Error("ERR_CONFIG");
    }

    // 規約同意前は利用者データを外部送信しない
    if (action !== "status" && !GM.Storage.hasConsent()) {
      throw new Error("ERR_CONSENT");
    }

    if (!navigator.onLine) {
      throw new Error("ERR_OFFLINE");
    }

    for (let attempt = 0; attempt <= C.MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) {
        throw abortError();
      }

      try {
        return await requestOnce(action, params, options.signal);
      } catch (error) {
        if (
          error.name === "AbortError" ||
          attempt === C.MAX_RETRIES ||
          !RETRYABLE.includes(error.message)
        ) {
          throw error;
        }

        // 指数バックオフ＋ゆらぎ
        const delay = 1200 * 2 ** attempt + Math.random() * 300;

        await wait(delay, options.signal);
      }
    }

    throw new Error("ERR_API");
  }

  function geocode(query, mode, options) {
    return request("geocode", { query, mode }, options);
  }

  function getStatus(options) {
    return request("status", {}, options);
  }

  // 現在地は明示操作時のみ一度だけ取得し、継続追跡しない（LOC-03／PRV-01）
  function getCurrentPosition() {
    if (!GM.Storage.hasConsent()) {
      return Promise.reject(new Error("ERR_CONSENT"));
    }

    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("ERR_GPS_UNSUPPORTED"));
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

        (error) => {
          const codes = {
            1: "ERR_GPS_DENIED",
            2: "ERR_GPS_UNAVAILABLE",
            3: "ERR_GPS_TIMEOUT",
          };

          reject(new Error(codes[error?.code] || "ERR_LOCATION"));
        },

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
    isConfigured,
    geocode,
    getStatus,
    getCurrentPosition,
  });
})(window.GourmetMap);
