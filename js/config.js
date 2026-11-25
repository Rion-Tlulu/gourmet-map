(function () {
  "use strict";

  window.GourmetMap = window.GourmetMap || {};

  window.GourmetMap.Config = Object.freeze({
    APP_NAME: "グルメマップ",
    APP_VERSION: "0.1.0",

    // GASのデプロイ後に設定
    GAS_URL:
      "https://script.google.com/macros/s/AKfycbxFPoFvxacRYc22hQQMES7DhNGouvSc_Dp0aCGe8ekpNu2i9mI18SgVEscZwc9tO1to/exec",

    // LocalStorage
    STORAGE_KEY: "gourmet-map:v1",
    SCHEMA_VERSION: 1,

    // 利用規約
    TERMS_VERSION: "1.0.0",
    PRIVACY_VERSION: "1.0.0",

    // 距離
    EARTH_RADIUS_M: 6371000,
    MAX_RADIUS_M: 3000,
    WALK_SPEED_M_PER_MIN: 80,

    DISTANCE_OPTIONS: [300, 500, 1000, 1500, 2000, 2500, 3000],

    // 表示件数
    DISPLAY_COUNT: 20,

    // API
    REQUEST_TIMEOUT_MS: 30000,
    API_PAGE_SIZE: 100,
    MAX_API_PAGES: 100,
    MAX_RETRIES: 3,

    // 画面内の店舗データ有効期限
    DATA_TTL_MS: 30 * 60 * 1000,

    // 自動更新
    DEFAULT_REFRESH_MINUTES: 60,

    REFRESH_OPTIONS: [5, 15, 30, 60, 180, 360],

    // 検索
    SEARCH_DEBOUNCE_MS: 300,

    // 地図
    MAP_ZOOM: 14,

    MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",

    // 規約確認後のみ有効化
    FAVORITES_ENABLED: false,

    // バックアップ
    MAX_BACKUP_BYTES: 5 * 1024 * 1024,
  });
})();
