(function (GM) {
  "use strict";

  const C = GM.Config;

  // 詳細条件（SR-06）。キーは保存データでも使用するため変更しない
  const CONDITIONS = Object.freeze({
    lunch: "ランチあり",
    card: "カード可",
    parking: "駐車場あり",
    nonSmoking: "禁煙席あり",
    barrierFree: "バリアフリー",
    privateRoom: "個室あり",
    wifi: "Wi-Fiあり",
    child: "お子様連れOK",
    freeFood: "食べ放題あり",
    softDrinkPlan: "ノンアルコール飲料プラン",
  });

  // 条件と店舗データ項目の対応
  const CONDITION_FIELDS = Object.freeze({
    lunch: "lunch",
    card: "card",
    parking: "parking",
    nonSmoking: "nonSmoking",
    barrierFree: "barrierFree",
    privateRoom: "privateRoom",
    wifi: "wifi",
    child: "child",
    freeFood: "freeFood",
    softDrinkPlan: "freeDrink",
  });

  /* ====================================
       01. 距離計算（SR-01／SR-02）
    ==================================== */

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  // ハーバーサイン公式。丸め前の値を返す
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

  // 概算徒歩時間＝直線距離÷80m/分 を切り上げ
  function walkingMinutes(distanceM) {
    if (!Number.isFinite(distanceM) || distanceM < 0) return null;

    return Math.max(1, Math.ceil(distanceM / C.WALK_SPEED_M_PER_MIN));
  }

  function formatDistance(distanceM) {
    if (!Number.isFinite(distanceM)) {
      return "距離情報なし";
    }

    if (distanceM < 1000) {
      return `${Math.round(distanceM)}m`;
    }

    // 1.0km → 1km、1.5km → 1.5km
    const text = (distanceM / 1000).toFixed(1);

    return `${text.endsWith(".0") ? text.slice(0, -2) : text}km`;
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
       02. 店舗取得（近い順に最大100件・重複排除）
    ==================================== */

  /**
   * 登録地点から近い順に最大100件を1回の呼び出しで取得する
   * （ホットペッパーは位置検索時に距離順で返すため、近い100件になる）
   *
   * complete：単回取得が正常に完了した（SYS-03。全掲載店舗の網羅ではない）
   * limited ：API総件数が100件を超え、近い順の100件で上限に達した（正常）
   */
  async function fetchNearby(location, options = {}) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const failed = (errorCode, requestId = null) => ({
      shops: [],
      received: 0,
      total: null,
      complete: false,
      limited: false,
      fetchedAt: null,
      errorCode,
      requestId,
    });

    let result;

    try {
      result = await GM.Api.request(
        "search",
        {
          lat: location.lat,
          lng: location.lng,
          force: options.force === true,
        },
        options,
      );
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }

      return failed(error.message, error.requestId || null);
    }

    if (
      !result ||
      !Array.isArray(result.shops) ||
      !Number.isInteger(result.total) ||
      result.total < 0 ||
      !Number.isFinite(Date.parse(result.fetchedAt))
    ) {
      return failed("ERR_API");
    }

    // 店舗IDで重複排除
    const shops = new Map();

    for (const shop of result.shops.slice(0, C.MAX_SHOPS)) {
      if (shop && typeof shop.id === "string" && shop.id && !shops.has(shop.id)) {
        shops.set(shop.id, withDistance(shop, location));
      }
    }

    const received = shops.size;
    const total = result.total;
    const expected = Math.min(total, C.MAX_SHOPS);

    options.onProgress?.({ received, total: expected });

    // 取得後に直線距離で3,000m以下を対象にする
    const nearby = [...shops.values()].filter(
      (shop) => Number.isFinite(shop.distanceM) && shop.distanceM <= C.MAX_RADIUS_M,
    );

    // 想定件数に届かない・サーバーが不完全と判定した場合は部分取得（欠損）
    const missing = received < expected || result.complete === false;

    return {
      shops: nearby,
      received,
      total,
      complete: !missing,
      limited: total > C.MAX_SHOPS,
      fetchedAt: result.fetchedAt,
      errorCode: missing ? "ERR_PARTIAL" : null,
      requestId: null,
    };
  }

  /* ====================================
       03. 文字列正規化
    ==================================== */

  // NFKC → 小文字 → カタカナをひらがなへ → 空白除去
  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0x60),
      )
      .replace(/\s+/g, "")
      .trim();
  }

  /* ====================================
       04. ジャンル（SR-04）
    ==================================== */

  function getGenres(shops) {
    return [...new Set(shops.map((shop) => shop.genre).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "ja"),
    );
  }

  /* ====================================
       05. 設備条件判定（SR-07）
       自由記述を yes / no / unknown に分類する。
       unknown は指定条件に合致させない。
    ==================================== */

  const AMBIGUOUS = /要相談|要確認|要問合|問い合わせ|問合せ|未確認|不明|条件付|曜日による|時期による/;

  function headOf(text) {
    // 「あり ：提携駐車場あり」→「あり」
    return text.split(/[:：(（/／、,]/)[0].trim();
  }

  function classify(value, condition) {
    const text = normalize(value);

    if (!text) {
      return "unknown";
    }

    const head = headOf(text);

    // 禁煙・喫煙情報
    if (condition === "nonSmoking") {
      if (/禁煙席なし|全面喫煙|全席喫煙/.test(text)) return "no";

      if (/^(全面禁煙|全席禁煙|一部禁煙|禁煙席あり|分煙)/.test(text)) {
        return "yes";
      }

      return "unknown";
    }

    // お子様連れ対応
    if (condition === "child") {
      if (/不可|お断り|ng/.test(text)) return "no";

      if (/^お子様連れ(歓迎|ok|可)/.test(text) || head === "あり") {
        return AMBIGUOUS.test(text) ? "unknown" : "yes";
      }

      return "unknown";
    }

    // 非アルコール提供が明示された飲料プランのみ肯定
    if (condition === "softDrinkPlan") {
      if (head === "なし") return "no";

      // normalize() でカタカナはひらがなに変換済み
      if (/そふとどりんく|のんある/.test(text)) {
        return "yes";
      }

      return "unknown";
    }

    // 一般設備条件
    if (/^(なし|無し|無|不可|利用不可|非対応|利用できません)$/.test(head)) {
      return "no";
    }

    if (/^(あり|有り|有|利用可|対応可|可|ok|対応)$/.test(head)) {
      return AMBIGUOUS.test(text) ? "unknown" : "yes";
    }

    return "unknown";
  }

  function conditionValue(shop, condition) {
    return shop[CONDITION_FIELDS[condition]];
  }

  /* ====================================
       06. 絞り込み・並び替え（SR-07／SR-08）
    ==================================== */

  const collator = new Intl.Collator("ja");

  function matches(shop, filters, favoriteSet) {
    if (!Number.isFinite(shop.distanceM) || shop.distanceM > filters.radiusM) {
      return false;
    }

    // ジャンルはOR（null は全ジャンル、空配列は0件）
    if (filters.genreNames !== null && !filters.genreNames.includes(shop.genre)) {
      return false;
    }

    const keyword = normalize(filters.keyword);

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

    // 異なる条件はAND
    return filters.conditions.every(
      (condition) => classify(conditionValue(shop, condition), condition) === "yes",
    );
  }

  function sortShops(shops, sort) {
    return shops.sort((a, b) => {
      let value;

      switch (sort) {
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

      // 同値時は店舗IDで安定化
      return value || a.id.localeCompare(b.id);
    });
  }

  function filter(shops, filters, favoriteIds = []) {
    const favoriteSet = new Set(favoriteIds);

    const result = shops.filter((shop) => matches(shop, filters, favoriteSet));

    return sortShops(result, filters.sort);
  }

  /* ====================================
       07. 条件の要約
    ==================================== */

  function isDefaultFilters(filters) {
    return (
      !filters.keyword &&
      filters.radiusM === C.MAX_RADIUS_M &&
      filters.genreNames === null &&
      filters.conditions.length === 0 &&
      !filters.favoriteOnly
    );
  }

  function countActiveFilters(filters) {
    return (
      (filters.keyword ? 1 : 0) +
      (filters.radiusM !== C.MAX_RADIUS_M ? 1 : 0) +
      (filters.genreNames !== null ? 1 : 0) +
      filters.conditions.length +
      (filters.favoriteOnly ? 1 : 0)
    );
  }

  function describeFilters(filters) {
    const descriptions = [`${formatDistance(filters.radiusM)}以内`];

    if (filters.genreNames === null) {
      descriptions.push("全ジャンル");
    } else if (filters.genreNames.length === 0) {
      descriptions.push("ジャンル未選択");
    } else {
      descriptions.push(filters.genreNames.join("・"));
    }

    if (filters.keyword) {
      descriptions.push(`店名：${filters.keyword}`);
    }

    for (const condition of filters.conditions) {
      if (CONDITIONS[condition]) {
        descriptions.push(CONDITIONS[condition]);
      }
    }

    if (filters.favoriteOnly) {
      descriptions.push("お気に入りのみ");
    }

    return descriptions.join(" / ");
  }

  /* ====================================
       08. お気に入り店舗取得（FAV-02）
    ==================================== */

  async function fetchFavorites(location, ids, options = {}) {
    const shops = [];
    const missingIds = [];
    const failedIds = [];

    let errorCode = null;

    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);

      try {
        const result = await GM.Api.request("favorites", { ids: batch }, options);

        shops.push(...result.shops.map((shop) => withDistance(shop, location)));

        missingIds.push(...result.missingIds);
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }

        errorCode = error.message;

        failedIds.push(...ids.slice(i));

        break;
      }

      if (i + 20 < ids.length) {
        await GM.Api.wait(C.PAGE_INTERVAL_MS, options.signal);
      }
    }

    return {
      shops,
      missingIds,
      failedIds,
      errorCode,
      fetchedAt: new Date().toISOString(),
    };
  }

  GM.Search = Object.freeze({
    CONDITIONS,
    CONDITION_FIELDS,
    distance,
    walkingMinutes,
    formatDistance,
    withDistance,
    fetchNearby,
    normalize,
    getGenres,
    classify,
    conditionValue,
    filter,
    isDefaultFilters,
    countActiveFilters,
    describeFilters,
    fetchFavorites,
  });
})(window.GourmetMap);
