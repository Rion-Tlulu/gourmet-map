(function (GM) {
  "use strict";

  const C = GM.Config;

  const CONDITION_KEYS = [
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
  ];

  const SORT_OPTIONS = ["distanceAsc", "distanceDesc", "nameAsc", "nameDesc"];

  /* ====================================
       01. 初期値
    ==================================== */

  function defaultFilters() {
    return {
      keyword: "",
      radiusM: 3000,
      genreNames: null,
      conditions: [],
      sort: "distanceAsc",
      favoriteOnly: false,
    };
  }

  function defaultData() {
    return {
      schemaVersion: C.SCHEMA_VERSION,

      appSettings: {
        activeLocationId: null,
        theme: "system",
        fontSize: "normal",
        contrast: false,
        reduceMotion: false,
        autoRefreshEnabled: true,
        interval: 60,
      },

      locations: [],
      favorites: [],
      presets: [],
      lastFilters: {},
      consent: null,
    };
  }

  /* ====================================
       02. 入力検証
    ==================================== */

  function ensure(condition) {
    if (!condition) {
      throw new Error("ERR_STORAGE");
    }
  }

  function validString(value, max) {
    return typeof value === "string" && value.length <= max;
  }

  function validId(value) {
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
  }

  function validDate(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function validCoordinates(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= 20 &&
      lat <= 46 &&
      lng >= 122 &&
      lng <= 154
    );
  }

  function cleanFilters(input) {
    ensure(input && typeof input === "object");

    ensure(validString(input.keyword, 150));

    ensure(C.DISTANCE_OPTIONS.includes(input.radiusM));

    ensure(
      input.genreNames === null ||
        (Array.isArray(input.genreNames) &&
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
       03. 保存データ全体の検証
    ==================================== */

  function validateData(input) {
    ensure(input && typeof input === "object");

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

      ensure(["manual", "gps", "geocoding", "map"].includes(item.source));

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

    if (C.FAVORITES_ENABLED) {
      output.favorites = input.favorites.map((item) => {
        ensure(
          item && /^J[0-9]{9}$/.test(item.shopId) && validDate(item.createdAt),
        );

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

    if (input.consent !== null && input.consent) {
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
       04. 保存・読み込み
    ==================================== */

  function load() {
    const raw = localStorage.getItem(C.STORAGE_KEY);

    if (!raw) {
      return defaultData();
    }

    return validateData(JSON.parse(raw));
  }

  function save(data) {
    const validated = validateData(data);

    localStorage.setItem(C.STORAGE_KEY, JSON.stringify(validated));

    return validated;
  }

  function getStorageSize() {
    return new Blob([localStorage.getItem(C.STORAGE_KEY) || ""]).size;
  }

  function clear() {
    localStorage.removeItem(C.STORAGE_KEY);
  }

  /* ====================================
       05. 利用規約
    ==================================== */

  function hasConsent() {
    const consent = load().consent;

    return (
      consent?.termsVersion === C.TERMS_VERSION &&
      consent?.privacyVersion === C.PRIVACY_VERSION
    );
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
       06. 地点管理
    ==================================== */

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

    const now = new Date().toISOString();

    const location = {
      id: existing?.id || crypto.randomUUID(),

      label: input.label.trim(),

      lat: input.lat,
      lng: input.lng,

      address: input.address || "",

      source: input.source || "manual",

      attribution: input.attribution || "",

      createdAt: existing?.createdAt || now,

      updatedAt: now,
    };

    data.locations = data.locations.filter((item) => item.id !== location.id);

    data.locations.push(location);

    data.appSettings.activeLocationId = location.id;

    save(data);

    return location;
  }

  function selectLocation(id) {
    const data = load();

    ensure(data.locations.some((item) => item.id === id));

    data.appSettings.activeLocationId = id;

    save(data);
  }

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
       07. 検索条件
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
       08. プリセット
    ==================================== */

  function savePreset(locationId, name, filters, presetId) {
    const data = load();

    const preset = {
      presetId: presetId || crypto.randomUUID(),
      locationId,
      name: name.trim(),
      filters: cleanFilters(filters),
    };

    data.presets = data.presets.filter(
      (item) => item.presetId !== preset.presetId,
    );

    data.presets.push(preset);

    save(data);

    return preset;
  }

  function deletePreset(id) {
    const data = load();

    data.presets = data.presets.filter((item) => item.presetId !== id);

    save(data);
  }

  /* ====================================
       09. お気に入り
    ==================================== */

  function getFavoriteIds() {
    if (!C.FAVORITES_ENABLED) return [];

    return load().favorites.map((item) => item.shopId);
  }

  function toggleFavorite(shopId) {
    ensure(C.FAVORITES_ENABLED);

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
       10. 設定
    ==================================== */

  function updateSettings(patch) {
    const data = load();

    data.appSettings = {
      ...data.appSettings,
      ...patch,
    };

    return save(data).appSettings;
  }

  /* ====================================
       11. バックアップ
    ==================================== */

  function exportBackup() {
    const data = load();

    // 同意情報は移行しない
    data.consent = null;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = "gourmet-map-backup.json";

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function importBackup(file, mode = "replace") {
    if (!file || file.size > C.MAX_BACKUP_BYTES) {
      throw new Error("ERR_STORAGE");
    }

    const input = validateData(JSON.parse(await file.text()));

    const current = load();

    input.consent = current.consent;

    if (mode === "replace") {
      return save(input);
    }

    if (mode !== "merge") {
      throw new Error("ERR_INPUT");
    }

    const locationMap = new Map(
      current.locations.map((item) => [item.id, item]),
    );

    for (const item of input.locations) {
      if (!locationMap.has(item.id)) {
        locationMap.set(item.id, item);
      }
    }

    const presetMap = new Map(
      current.presets.map((item) => [item.presetId, item]),
    );

    for (const item of input.presets) {
      if (!presetMap.has(item.presetId)) {
        presetMap.set(item.presetId, item);
      }
    }

    const favoriteMap = new Map(
      current.favorites.map((item) => [item.shopId, item]),
    );

    for (const item of input.favorites) {
      if (!favoriteMap.has(item.shopId)) {
        favoriteMap.set(item.shopId, item);
      }
    }

    return save({
      ...current,

      locations: [...locationMap.values()],

      presets: [...presetMap.values()],

      favorites: [...favoriteMap.values()],

      // 重複時は既存の条件を優先
      lastFilters: {
        ...input.lastFilters,
        ...current.lastFilters,
      },

      appSettings: {
        ...current.appSettings,

        activeLocationId:
          current.appSettings.activeLocationId ||
          input.appSettings.activeLocationId ||
          null,
      },
    });
  }

  /* ====================================
       12. 外部公開する関数
    ==================================== */

  GM.Storage = Object.freeze({
    defaultData,
    defaultFilters,
    validateData,
    validCoordinates,

    load,
    save,
    clear,
    getStorageSize,

    hasConsent,
    acceptConsent,

    getActiveLocation,
    saveLocation,
    selectLocation,
    deleteLocation,

    saveFilters,
    getFilters,

    savePreset,
    deletePreset,

    getFavoriteIds,
    toggleFavorite,

    updateSettings,

    exportBackup,
    importBackup,
  });
})(window.GourmetMap);
