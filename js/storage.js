(function (GM) {
  "use strict";

  const C = GM.Config;

  const CONDITION_KEYS = Object.freeze([
    "lunch",
    "card",
    "parking",
    "nonSmoking",
    "barrierFree",
    "privateRoom",
    "wifi",
    "child",
    "freeFood",
    "softDrinkPlan",
  ]);

  const SORT_OPTIONS = Object.freeze([
    "distanceAsc",
    "distanceDesc",
    "nameAsc",
    "nameDesc",
  ]);

  // geocoding は旧版データとの互換用（住所検索として扱う）
  const LOCATION_SOURCES = Object.freeze([
    "address",
    "station",
    "gps",
    "map",
    "manual",
    "geocoding",
  ]);

  const BACKUP_APP_ID = "gourmet-map";

  /* ====================================
       01. エラー
    ==================================== */

  function storageError(code = "ERR_STORAGE") {
    return new Error(code);
  }

  function ensure(condition, code) {
    if (!condition) {
      throw storageError(code);
    }
  }

  /* ====================================
       02. 初期値
    ==================================== */

  function defaultFilters() {
    return {
      keyword: "",
      radiusM: C.MAX_RADIUS_M,
      genreNames: null,
      conditions: [],
      sort: "distanceAsc",
      favoriteOnly: false,
    };
  }

  function defaultSettings() {
    return {
      activeLocationId: null,
      theme: "system",
      fontSize: "normal",
      contrast: false,
      reduceMotion: false,
      autoRefreshEnabled: true,
      interval: C.DEFAULT_REFRESH_MINUTES,
    };
  }

  function defaultData() {
    return {
      schemaVersion: C.SCHEMA_VERSION,
      appSettings: defaultSettings(),
      locations: [],
      favorites: [],
      presets: [],
      lastFilters: {},
      consent: null,
    };
  }

  /* ====================================
       03. 入力検証
    ==================================== */

  function validString(value, max) {
    return typeof value === "string" && value.length <= max;
  }

  function validId(value) {
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
  }

  function validDate(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function validShopId(value) {
    return typeof value === "string" && /^J[0-9]{9}$/.test(value);
  }

  /**
   * 座標の検証（LOC-04）
   * null：正常
   * ERR_COORD_RANGE：緯度±90・経度±180の範囲外、または数値でない
   * ERR_COORD_AREA：対象地域（日本周辺）の範囲外
   */
  function coordinateError(lat, lng) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return "ERR_COORD_RANGE";
    }

    if (lat < 20 || lat > 46 || lng < 122 || lng > 154) {
      return "ERR_COORD_AREA";
    }

    return null;
  }

  function validCoordinates(lat, lng) {
    return coordinateError(lat, lng) === null;
  }

  function cleanFilters(input) {
    ensure(input && typeof input === "object");

    ensure(validString(input.keyword, 150));

    ensure(C.DISTANCE_OPTIONS.includes(input.radiusM));

    ensure(
      input.genreNames === null ||
        (Array.isArray(input.genreNames) &&
          input.genreNames.length <= 200 &&
          input.genreNames.every((value) => validString(value, 100))),
    );

    ensure(
      Array.isArray(input.conditions) &&
        input.conditions.every((value) => CONDITION_KEYS.includes(value)),
    );

    ensure(SORT_OPTIONS.includes(input.sort));

    ensure(typeof input.favoriteOnly === "boolean");

    return {
      keyword: input.keyword,
      radiusM: input.radiusM,

      genreNames:
        input.genreNames === null ? null : [...new Set(input.genreNames)],

      conditions: [...new Set(input.conditions)],

      sort: input.sort,

      favoriteOnly: C.FAVORITES_ENABLED && input.favoriteOnly,
    };
  }

  /* ====================================
       04. データ形式の移行（DATA-05）
    ==================================== */

  // 旧バージョン → 次のバージョンへの変換を登録する
  // 例：MIGRATIONS[1] = (data) => ({ ...data, schemaVersion: 2 })
  const MIGRATIONS = Object.freeze({});

  function migrate(input) {
    ensure(input && typeof input === "object" && !Array.isArray(input));

    let data = input;

    let version = data.schemaVersion;

    ensure(Number.isInteger(version) && version >= 1);

    // 未対応の新しい形式は拒否
    ensure(version <= C.SCHEMA_VERSION, "ERR_STORAGE_VERSION");

    while (version < C.SCHEMA_VERSION) {
      const step = MIGRATIONS[version];

      ensure(typeof step === "function", "ERR_STORAGE_VERSION");

      data = step(data);

      version = data.schemaVersion;
    }

    return data;
  }

  /* ====================================
       05. 保存データ全体の検証（許可リスト方式）
    ==================================== */

  function validateData(raw) {
    const input = migrate(raw);

    ensure(input.schemaVersion === C.SCHEMA_VERSION);

    ensure(Array.isArray(input.locations));
    ensure(Array.isArray(input.presets));
    ensure(Array.isArray(input.favorites));

    const output = defaultData();

    output.locations = input.locations.map((item) => {
      ensure(item && validId(item.id));

      ensure(validString(item.label, 80) && item.label.trim().length > 0);

      ensure(validCoordinates(item.lat, item.lng));

      ensure(validString(item.address || "", 500));

      ensure(LOCATION_SOURCES.includes(item.source));

      ensure(validString(item.attribution || "", 500));

      ensure(validDate(item.createdAt));
      ensure(validDate(item.updatedAt));

      return {
        id: item.id,
        label: item.label,
        lat: item.lat,
        lng: item.lng,
        address: item.address || "",
        source: item.source,
        attribution: item.attribution || "",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    const locationIds = new Set(output.locations.map((item) => item.id));

    ensure(locationIds.size === output.locations.length);

    const settings = input.appSettings;

    ensure(settings && typeof settings === "object");

    ensure(["system", "light", "dark"].includes(settings.theme));

    ensure(["normal", "large", "extra-large"].includes(settings.fontSize));

    ensure(typeof settings.contrast === "boolean");
    ensure(typeof settings.reduceMotion === "boolean");

    ensure(typeof settings.autoRefreshEnabled === "boolean");

    ensure(C.REFRESH_OPTIONS.includes(settings.interval));

    ensure(
      settings.activeLocationId === null ||
        locationIds.has(settings.activeLocationId),
    );

    output.appSettings = {
      activeLocationId: settings.activeLocationId,
      theme: settings.theme,
      fontSize: settings.fontSize,
      contrast: settings.contrast,
      reduceMotion: settings.reduceMotion,
      autoRefreshEnabled: settings.autoRefreshEnabled,
      interval: settings.interval,
    };

    output.presets = input.presets.map((item) => {
      ensure(item && validId(item.presetId));

      ensure(locationIds.has(item.locationId));

      ensure(validString(item.name, 80) && item.name.trim().length > 0);

      return {
        presetId: item.presetId,
        locationId: item.locationId,
        name: item.name,
        filters: cleanFilters(item.filters),
      };
    });

    ensure(
      new Set(output.presets.map((item) => item.presetId)).size ===
        output.presets.length,
    );

    // お気に入りIDは規約確認後（機能有効時）のみ保持する
    if (C.FAVORITES_ENABLED) {
      output.favorites = input.favorites.map((item) => {
        ensure(item && validShopId(item.shopId) && validDate(item.createdAt));

        return {
          shopId: item.shopId,
          createdAt: item.createdAt,
        };
      });

      ensure(
        new Set(output.favorites.map((item) => item.shopId)).size ===
          output.favorites.length,
      );
    }

    ensure(
      input.lastFilters &&
        typeof input.lastFilters === "object" &&
        !Array.isArray(input.lastFilters),
    );

    for (const [id, filters] of Object.entries(input.lastFilters)) {
      ensure(locationIds.has(id));

      output.lastFilters[id] = cleanFilters(filters);
    }

    if (input.consent) {
      ensure(validString(input.consent.termsVersion, 30));

      ensure(validString(input.consent.privacyVersion, 30));

      ensure(validDate(input.consent.acceptedAt));

      output.consent = {
        termsVersion: input.consent.termsVersion,
        privacyVersion: input.consent.privacyVersion,
        acceptedAt: input.consent.acceptedAt,
      };
    }

    return output;
  }

  /* ====================================
       06. 保存・読み込み
    ==================================== */

  let cachedRaw = null;
  let cachedData = null;

  function clone(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function storage() {
    try {
      return window.localStorage;
    } catch {
      throw storageError("ERR_STORAGE_UNAVAILABLE");
    }
  }

  function isAvailable() {
    try {
      const store = storage();

      const key = C.STORAGE_KEY + ":test";

      store.setItem(key, "1");
      store.removeItem(key);

      return true;
    } catch {
      return false;
    }
  }

  function load() {
    let raw;

    try {
      raw = storage().getItem(C.STORAGE_KEY);
    } catch {
      throw storageError("ERR_STORAGE_UNAVAILABLE");
    }

    if (!raw) {
      return defaultData();
    }

    if (raw !== cachedRaw) {
      let parsed;

      try {
        parsed = JSON.parse(raw);
      } catch {
        throw storageError();
      }

      cachedData = validateData(parsed);
      cachedRaw = raw;
    }

    return clone(cachedData);
  }

  function save(data) {
    const validated = validateData(data);

    const raw = JSON.stringify(validated);

    try {
      storage().setItem(C.STORAGE_KEY, raw);
    } catch (error) {
      if (error?.message?.startsWith("ERR_")) throw error;

      // QuotaExceededError など
      throw storageError("ERR_STORAGE_FULL");
    }

    cachedRaw = raw;
    cachedData = validated;

    return clone(validated);
  }

  function getStorageSize() {
    try {
      const raw = storage().getItem(C.STORAGE_KEY) || "";

      // LocalStorageは概ねUTF-16で保持されるため2バイト換算の概算
      return (raw.length + C.STORAGE_KEY.length) * 2;
    } catch {
      return 0;
    }
  }

  // アプリ専用キーのみ削除（同一オリジンの他データは消さない）
  function clear() {
    cachedRaw = null;
    cachedData = null;

    try {
      storage().removeItem(C.STORAGE_KEY);
    } catch {
      throw storageError("ERR_STORAGE_UNAVAILABLE");
    }
  }

  /* ====================================
       07. 利用規約
    ==================================== */

  function hasConsent() {
    try {
      const consent = load().consent;

      return (
        consent?.termsVersion === C.TERMS_VERSION &&
        consent?.privacyVersion === C.PRIVACY_VERSION
      );
    } catch {
      return false;
    }
  }

  function acceptConsent() {
    const data = load();

    data.consent = {
      termsVersion: C.TERMS_VERSION,
      privacyVersion: C.PRIVACY_VERSION,
      acceptedAt: new Date().toISOString(),
    };

    save(data);
  }

  /* ====================================
       08. 地点管理
    ==================================== */

  function getLocations() {
    return load().locations;
  }

  function getActiveLocation() {
    const data = load();

    return (
      data.locations.find(
        (item) => item.id === data.appSettings.activeLocationId,
      ) || null
    );
  }

  function saveLocation(input) {
    const data = load();

    const existing = data.locations.find((item) => item.id === input.id);

    const label = String(input.label ?? "").trim();

    ensure(label.length > 0 && label.length <= 80, "ERR_INPUT");

    const coordError = coordinateError(input.lat, input.lng);

    ensure(!coordError, coordError || "ERR_INPUT");

    const now = new Date().toISOString();

    const location = {
      id: existing?.id || crypto.randomUUID(),
      label,
      lat: input.lat,
      lng: input.lng,
      address: String(input.address || "").slice(0, 500),
      source: LOCATION_SOURCES.includes(input.source) ? input.source : "manual",
      attribution: String(input.attribution || "").slice(0, 500),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      // 並び順を維持して置き換え
      data.locations = data.locations.map((item) =>
        item.id === location.id ? location : item,
      );
    } else {
      data.locations.push(location);
    }

    // 新規登録時、または未選択時のみ選択中の地点にする
    if (!existing || !data.appSettings.activeLocationId) {
      data.appSettings.activeLocationId = location.id;
    }

    save(data);

    return location;
  }

  function selectLocation(id) {
    const data = load();

    ensure(data.locations.some((item) => item.id === id), "ERR_INPUT");

    data.appSettings.activeLocationId = id;

    save(data);
  }

  function countLocationRelations(id) {
    const data = load();

    return {
      presets: data.presets.filter((item) => item.locationId === id).length,
      hasLastFilters: Object.hasOwn(data.lastFilters, id),
    };
  }

  // 地点削除時は関連する条件・プリセットも削除（LOC-08）
  function deleteLocation(id) {
    const data = load();

    data.locations = data.locations.filter((item) => item.id !== id);

    data.presets = data.presets.filter((item) => item.locationId !== id);

    delete data.lastFilters[id];

    if (data.appSettings.activeLocationId === id) {
      data.appSettings.activeLocationId = data.locations[0]?.id || null;
    }

    save(data);
  }

  /* ====================================
       09. 検索条件
    ==================================== */

  function saveFilters(locationId, filters) {
    const data = load();

    ensure(data.locations.some((item) => item.id === locationId));

    data.lastFilters[locationId] = cleanFilters(filters);

    save(data);
  }

  function getFilters(locationId) {
    return load().lastFilters[locationId] || defaultFilters();
  }

  /* ====================================
       10. プリセット
    ==================================== */

  function getPresets(locationId) {
    return load().presets.filter((item) => item.locationId === locationId);
  }

  function savePreset(locationId, name, filters, presetId) {
    const data = load();

    const trimmed = String(name ?? "").trim();

    ensure(trimmed.length > 0 && trimmed.length <= 80, "ERR_INPUT");

    ensure(data.locations.some((item) => item.id === locationId), "ERR_INPUT");

    const preset = {
      presetId: presetId || crypto.randomUUID(),
      locationId,
      name: trimmed,
      filters: cleanFilters(filters),
    };

    const index = data.presets.findIndex(
      (item) => item.presetId === preset.presetId,
    );

    if (index >= 0) {
      data.presets[index] = preset;
    } else {
      data.presets.push(preset);
    }

    save(data);

    return preset;
  }

  function deletePreset(id) {
    const data = load();

    data.presets = data.presets.filter((item) => item.presetId !== id);

    save(data);
  }

  /* ====================================
       11. お気に入り
    ==================================== */

  function getFavoriteIds() {
    if (!C.FAVORITES_ENABLED) return [];

    try {
      return load().favorites.map((item) => item.shopId);
    } catch {
      return [];
    }
  }

  function toggleFavorite(shopId) {
    ensure(C.FAVORITES_ENABLED, "ERR_DISABLED");

    ensure(validShopId(shopId), "ERR_INPUT");

    const data = load();

    const exists = data.favorites.some((item) => item.shopId === shopId);

    if (exists) {
      data.favorites = data.favorites.filter((item) => item.shopId !== shopId);
    } else {
      data.favorites.push({
        shopId,
        createdAt: new Date().toISOString(),
      });
    }

    save(data);

    return !exists;
  }

  /* ====================================
       12. 設定・項目別初期化（DATA-02）
    ==================================== */

  function updateSettings(patch) {
    const data = load();

    data.appSettings = {
      ...data.appSettings,
      ...patch,
    };

    return save(data).appSettings;
  }

  function resetAppearance() {
    const defaults = defaultSettings();

    return updateSettings({
      theme: defaults.theme,
      fontSize: defaults.fontSize,
      contrast: defaults.contrast,
      reduceMotion: defaults.reduceMotion,
    });
  }

  function resetSettings() {
    const data = load();

    data.appSettings = {
      ...defaultSettings(),
      activeLocationId: data.appSettings.activeLocationId,
    };

    return save(data).appSettings;
  }

  function clearLastFilters() {
    const data = load();

    data.lastFilters = {};

    save(data);
  }

  function clearPresets() {
    const data = load();

    data.presets = [];

    save(data);
  }

  function clearFavorites() {
    const data = load();

    data.favorites = [];

    save(data);
  }

  /* ====================================
       13. バックアップ（DATA-03／DATA-04）
    ==================================== */

  function createBackup() {
    const data = load();

    // 同意情報は端末ごとに取得するため移行しない
    // 店舗データ・画像・APIキー・内部ログは保存していないため含まれない
    return {
      app: BACKUP_APP_ID,
      exportedAt: new Date().toISOString(),
      appVersion: C.APP_VERSION,
      ...data,
      consent: null,
    };
  }

  function exportBackup() {
    const backup = createBackup();

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const stamp = backup.exportedAt.slice(0, 10).replaceAll("-", "");

    const link = document.createElement("a");

    link.href = url;
    link.download = `gourmet-map-backup-${stamp}.json`;

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function sameLocation(a, b) {
    return a.label === b.label && a.lat === b.lat && a.lng === b.lng;
  }

  /**
   * バックアップの検証と取り込み
   * 失敗時は例外を投げ、既存データは変更しない。
   */
  function parseBackup(text) {
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw storageError("ERR_BACKUP_FORMAT");
    }

    ensure(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
      "ERR_BACKUP_FORMAT",
    );

    if (parsed.app !== undefined) {
      ensure(parsed.app === BACKUP_APP_ID, "ERR_BACKUP_FORMAT");
    }

    try {
      return validateData(parsed);
    } catch (error) {
      if (error.message === "ERR_STORAGE_VERSION") throw error;

      throw storageError("ERR_BACKUP_FORMAT");
    }
  }

  async function importBackup(file, mode = "replace") {
    ensure(file, "ERR_INPUT");

    ensure(file.size <= C.MAX_BACKUP_BYTES, "ERR_BACKUP_SIZE");

    ensure(["replace", "merge"].includes(mode), "ERR_INPUT");

    const input = parseBackup(await file.text());

    return applyBackup(input, mode);
  }

  function applyBackup(input, mode) {
    const current = load();

    // 同意情報は現在の端末のものを維持
    input.consent = current.consent;

    if (mode === "replace") {
      save(input);

      return {
        mode,
        locations: input.locations.length,
        presets: input.presets.length,
        favorites: input.favorites.length,
        duplicates: 0,
      };
    }

    let duplicates = 0;

    const locations = [...current.locations];

    // 取り込み元ID → 実際に使うID（同一地点は既存側に寄せる）
    const idMap = new Map();

    let addedLocations = 0;

    for (const item of input.locations) {
      const sameId = locations.find((existing) => existing.id === item.id);

      const sameContent = locations.find((existing) =>
        sameLocation(existing, item),
      );

      if (sameId || sameContent) {
        duplicates++;

        idMap.set(item.id, (sameId || sameContent).id);

        continue;
      }

      locations.push(item);

      idMap.set(item.id, item.id);

      addedLocations++;
    }

    const presets = [...current.presets];

    let addedPresets = 0;

    for (const item of input.presets) {
      if (presets.some((existing) => existing.presetId === item.presetId)) {
        duplicates++;
        continue;
      }

      presets.push({
        ...item,
        locationId: idMap.get(item.locationId) || item.locationId,
      });

      addedPresets++;
    }

    const favorites = [...current.favorites];

    let addedFavorites = 0;

    for (const item of input.favorites) {
      if (favorites.some((existing) => existing.shopId === item.shopId)) {
        duplicates++;
        continue;
      }

      favorites.push(item);

      addedFavorites++;
    }

    const lastFilters = { ...current.lastFilters };

    for (const [id, filters] of Object.entries(input.lastFilters)) {
      const mapped = idMap.get(id) || id;

      // 重複時は既存の条件を優先
      if (!Object.hasOwn(lastFilters, mapped)) {
        lastFilters[mapped] = filters;
      }
    }

    save({
      ...current,
      locations,
      presets,
      favorites,
      lastFilters,
      appSettings: {
        ...current.appSettings,
        activeLocationId:
          current.appSettings.activeLocationId ||
          idMap.get(input.appSettings.activeLocationId) ||
          locations[0]?.id ||
          null,
      },
    });

    return {
      mode,
      locations: addedLocations,
      presets: addedPresets,
      favorites: addedFavorites,
      duplicates,
    };
  }

  /* ====================================
       14. 外部公開する関数
    ==================================== */

  GM.Storage = Object.freeze({
    CONDITION_KEYS,
    SORT_OPTIONS,

    defaultData,
    defaultFilters,
    defaultSettings,
    validateData,
    cleanFilters,
    validCoordinates,
    coordinateError,
    validShopId,

    isAvailable,
    load,
    save,
    clear,
    getStorageSize,

    hasConsent,
    acceptConsent,

    getLocations,
    getActiveLocation,
    saveLocation,
    selectLocation,
    countLocationRelations,
    deleteLocation,

    saveFilters,
    getFilters,

    getPresets,
    savePreset,
    deletePreset,

    getFavoriteIds,
    toggleFavorite,

    updateSettings,
    resetAppearance,
    resetSettings,
    clearLastFilters,
    clearPresets,
    clearFavorites,

    createBackup,
    exportBackup,
    parseBackup,
    applyBackup,
    importBackup,
  });
})(window.GourmetMap);
