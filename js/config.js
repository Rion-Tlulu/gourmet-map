(function () {
  "use strict";

  window.GourmetMap = window.GourmetMap || {};

  window.GourmetMap.Config = Object.freeze({
    APP_NAME: "グルメマップ",
    APP_VERSION: "0.1.0",

    // GASのデプロイURL（公開してよい値。APIキーはGASのScript Propertiesで管理）
    GAS_URL:
      "https://script.google.com/macros/s/AKfycbxFPoFvxacRYc22hQQMES7DhNGouvSc_Dp0aCGe8ekpNu2i9mI18SgVEscZwc9tO1to/exec",

    // LocalStorage（同一オリジンの他アプリと衝突しない専用キー）
    STORAGE_KEY: "gourmet-map:v1",
    SCHEMA_VERSION: 1,

    // 利用規約・プライバシーポリシーの版（変更時は再同意）
    TERMS_VERSION: "1.0.0",
    PRIVACY_VERSION: "1.0.0",

    // 距離（SR-01／SR-02）
    EARTH_RADIUS_M: 6371000,
    MAX_RADIUS_M: 3000,
    WALK_SPEED_M_PER_MIN: 80,

    // 距離選択（SR-03）
    DISTANCE_OPTIONS: [300, 500, 1000, 1500, 2000, 2500, 3000],

    // 表示件数（SR-09）
    DISPLAY_COUNT: 20,

    // API
    REQUEST_TIMEOUT_MS: 30000,
    // 店舗検索は1回の呼び出しで、登録地点から近い順に最大100件のみ取得
    MAX_SHOPS: 100,
    MAX_RETRIES: 3,
    // お気に入り（20件ずつ）を分割取得する場合の間隔
    PAGE_INTERVAL_MS: 1200,

    // 取得済みデータを再検索で再利用する期間
    REUSE_TTL_MS: 30 * 60 * 1000,

    // 画面内の店舗データ保持期限（LEGAL-05：24時間以内に更新または削除）
    DATA_TTL_MS: 24 * 60 * 60 * 1000,

    // 自動更新（API-04）
    DEFAULT_REFRESH_MINUTES: 60,
    REFRESH_OPTIONS: [5, 15, 30, 60, 180, 360],

    // 検索（SR-05）
    SEARCH_DEBOUNCE_MS: 300,

    // 地図
    MAP_ZOOM: 14,
    MAP_TILE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    DEFAULT_CENTER: Object.freeze({ lat: 35.6812, lng: 139.7671 }),

    // 外部リンク・画像の許可ドメイン（SEC-03）
    SHOP_URL_DOMAINS: Object.freeze(["hotpepper.jp"]),
    IMAGE_DOMAINS: Object.freeze(["hotp.jp", "hotpepper.jp"]),

    // お気に入りの長期保存は規約確認後に有効化（FAV-01）
    // true にしても、GAS側の機能フラグ（favorites）が有効な場合のみ利用可能
    FAVORITES_ENABLED: false,

    // バックアップ（DATA-04）
    MAX_BACKUP_BYTES: 5 * 1024 * 1024,
  });
})();
