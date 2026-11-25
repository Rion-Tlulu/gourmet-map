(function (GM) {
  "use strict";

  const C = GM.Config;

  const CONDITIONS = Object.freeze({
    lunch: "ランチ提供あり",
    card: "クレジットカード対応",
    parking: "駐車場あり",
    nonSmoking: "禁煙席等あり",
    barrierFree: "バリアフリー対応",
    privateRoom: "個室あり",
    wifi: "Wi-Fiあり",
    child: "お子様連れ対応",
    freeFood: "食べ放題あり",
    softDrinkPlan: "ノンアルコール飲料プラン",
  });

  /* ====================================
       01. 距離計算
    ==================================== */

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function distance(lat1, lng1, lat2, lng2) {
    if (
      ![lat1, lng1, lat2, lng2].every(Number.isFinite) ||
      Math.abs(lat1) > 90 ||
      Math.abs(lat2) > 90 ||
      Math.abs(lng1) > 180 ||
      Math.abs(lng2) > 180
    ) {
      throw new Error("ERR_LOCATION");
    }

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) ** 2;

    const safeA = Math.max(0, Math.min(1, a));

    return (
      C.EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA))
    );
  }

  function walkingMinutes(distanceM) {
    return Math.ceil(distanceM / C.WALK_SPEED_M_PER_MIN);
  }

  function formatDistance(distanceM) {
    if (!Number.isFinite(distanceM)) {
      return "距離情報なし";
    }

    if (distanceM < 1000) {
      return `${Math.round(distanceM)}m`;
    }

    return `${(distanceM / 1000).toFixed(1)}km`;
  }

  function withDistance(shop, location) {
    if (
      !location ||
      !Number.isFinite(shop.lat) ||
      !Number.isFinite(shop.lng) ||
      Math.abs(shop.lat) > 90 ||
      Math.abs(shop.lng) > 180
    ) {
      return {
        ...shop,
        distanceM: null,
        walkingMinutes: null,
      };
    }

    const distanceM = distance(location.lat, location.lng, shop.lat, shop.lng);

    return {
      ...shop,
      distanceM,
      walkingMinutes: walkingMinutes(distanceM),
    };
  }

  /* ====================================
       02. 店舗全件取得
    ==================================== */

  async function fetchAll(location, options = {}) {
    const shops = new Map();

    let start = 1;
    let total = null;
    let complete = false;
    let oldestFetchedAt = null;
    let inconsistent = false;
    let errorCode = null;
    let requestId = null;

    for (let page = 0; page < C.MAX_API_PAGES; page++) {
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      let result;

      try {
        result = await GM.Api.request(
          "search",
          {
            lat: location.lat,
            lng: location.lng,
            start,
            force: options.force === true,
          },
          options,
        );
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }

        errorCode = error.message;

        requestId = error.requestId || null;

        break;
      }

      if (
        !Array.isArray(result.shops) ||
        !Number.isInteger(result.total) ||
        result.total < 0 ||
        !Number.isFinite(Date.parse(result.fetchedAt))
      ) {
        errorCode = "ERR_API";
        break;
      }

      if (total !== null && total !== result.total) {
        inconsistent = true;
      }

      total = result.total;

      if (
        !oldestFetchedAt ||
        Date.parse(result.fetchedAt) < Date.parse(oldestFetchedAt)
      ) {
        oldestFetchedAt = result.fetchedAt;
      }

      for (const shop of result.shops) {
        if (!shop.id || shops.has(shop.id)) {
          inconsistent = true;
          continue;
        }

        shops.set(shop.id, withDistance(shop, location));
      }

      options.onProgress?.({
        received: shops.size,
        total,
      });

      if (result.complete) {
        complete = !inconsistent && shops.size === total;

        break;
      }

      if (!Number.isInteger(result.nextStart) || result.nextStart <= start) {
        errorCode = "ERR_PARTIAL";
        break;
      }

      start = result.nextStart;

      await GM.Api.wait(1200);
    }

    const result = [...shops.values()].filter(
      (shop) =>
        Number.isFinite(shop.distanceM) && shop.distanceM <= C.MAX_RADIUS_M,
    );

    if (!complete && !errorCode) {
      errorCode = "ERR_PARTIAL";
    }

    return {
      shops: result,

      received: shops.size,

      total,

      complete,

      fetchedAt: oldestFetchedAt,

      errorCode,

      requestId,
    };
  }

  /* ====================================
       03. 文字列正規化
    ==================================== */

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()

      .replace(/[\u30A1-\u30F6]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0x60),
      )

      .trim();
  }

  /* ====================================
       04. ジャンル取得
    ==================================== */

  function getGenres(shops) {
    return [...new Set(shops.map((shop) => shop.genre).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "ja"),
    );
  }

  /* ====================================
       05. 設備条件判定
    ==================================== */

  function classify(value, condition) {
    const text = normalize(value);

    if (!text) return "unknown";

    if (/なし|無し|不可|非対応|利用できません/.test(text)) {
      return "no";
    }

    if (/要相談|要確認|未確認|不明|一部|条件付き/.test(text)) {
      return "unknown";
    }

    if (condition === "nonSmoking") {
      return /^(全面禁煙|全席禁煙|禁煙席あり)$/.test(text) ? "yes" : "unknown";
    }

    if (condition === "child") {
      return /^(お子様連れ歓迎|お子様連れok)/.test(text) ? "yes" : "unknown";
    }

    if (condition === "softDrinkPlan") {
      return /^(ノンアルコール飲み放題|ソフトドリンク飲み放題)$/.test(text)
        ? "yes"
        : "unknown";
    }

    if (/^(あり|有り|有|利用可|対応可|ok)$/.test(text)) {
      return "yes";
    }

    return "unknown";
  }

  /* ====================================
       06. 絞り込み・並び替え
    ==================================== */

  function filter(shops, filters, favoriteIds = []) {
    const keyword = normalize(filters.keyword);

    const favoriteSet = new Set(favoriteIds);

    const collator = new Intl.Collator("ja");

    const result = shops.filter((shop) => {
      if (
        !Number.isFinite(shop.distanceM) ||
        shop.distanceM > filters.radiusM
      ) {
        return false;
      }

      // ジャンルはOR
      if (
        filters.genreNames !== null &&
        !filters.genreNames.includes(shop.genre)
      ) {
        return false;
      }

      if (
        keyword &&
        !normalize(shop.name).includes(keyword) &&
        !normalize(shop.nameKana).includes(keyword)
      ) {
        return false;
      }

      if (filters.favoriteOnly && !favoriteSet.has(shop.id)) {
        return false;
      }

      // 設備条件はAND
      return filters.conditions.every((condition) => {
        const value =
          condition === "softDrinkPlan" ? shop.freeDrink : shop[condition];

        return classify(value, condition) === "yes";
      });
    });

    return result.sort((a, b) => {
      let value;

      switch (filters.sort) {
        case "distanceDesc":
          value = b.distanceM - a.distanceM;
          break;

        case "nameAsc":
          value = collator.compare(a.nameKana || a.name, b.nameKana || b.name);

          break;

        case "nameDesc":
          value = collator.compare(b.nameKana || b.name, a.nameKana || a.name);

          break;

        default:
          value = a.distanceM - b.distanceM;
      }

      return value || a.id.localeCompare(b.id);
    });
  }

  /* ====================================
       07. お気に入り店舗取得
    ==================================== */

  async function fetchFavorites(location, options = {}) {
    const ids = GM.Storage.getFavoriteIds();

    const shops = [];
    const missingIds = [];
    const failedIds = [];

    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);

      try {
        const result = await GM.Api.request(
          "favorites",
          { ids: batch },
          options,
        );

        shops.push(...result.shops.map((shop) => withDistance(shop, location)));

        missingIds.push(...result.missingIds);
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }

        failedIds.push(...ids.slice(i));
        break;
      }

      if (i + 20 < ids.length) {
        await GM.Api.wait(1200);
      }
    }

    return {
      shops,
      missingIds,
      failedIds,
    };
  }

  GM.Search = Object.freeze({
    CONDITIONS,
    distance,
    walkingMinutes,
    formatDistance,
    withDistance,
    fetchAll,
    normalize,
    getGenres,
    classify,
    filter,
    fetchFavorites,
  });
})(window.GourmetMap);
