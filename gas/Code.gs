/**
 * グルメマップ API（Google Apps Script）
 *
 * 公開Webアプリとして配置し、読取専用の限定操作のみを提供する（SYS-01）。
 *   status    : 公開設定・稼働状態・お知らせ
 *   search    : ホットペッパー グルメサーチAPI（半径3km・1ページ100件）
 *   geocode   : Geoapify Geocoding（住所・駅名の候補）
 *   favorites : 店舗ID検索（最大20件）
 *
 * APIキー等は Script Properties に保存し、コード・ログ・応答に含めない（SYS-02）。
 * 応答は { ok, data, errorCode, requestId, fetchedAt, complete } 形式（SYS-03）。
 *
 * ▼ Script Properties（必須）
 *   HOTPEPPER_API_KEY   ホットペッパーWebサービスのAPIキー
 *   GEOAPIFY_API_KEY    GeoapifyのAPIキー
 *   SPREADSHEET_ID      管理用スプレッドシートのID
 * ▼ Script Properties（任意・初期値）
 *   RATE_LIMIT_PER_MINUTE  全体の1分あたり受付数（120）
 *   MAX_CONCURRENT         同時処理数の上限（10）
 *   DAILY_API_LIMIT        外部API呼出の日次上限（100）
 *   SERVICE_STOPPED        "true" で全機能を停止（停止フラグ）
 * ▼ 旧版との互換（設定済みの場合のみ有効）
 *   API_ENABLED            "false" で全機能を停止（メンテナンス）
 *   FAVORITES_ENABLED      "true" でお気に入りを有効化（シート「09_機能管理」でも可）
 *   PUBLIC_NOTICE          お知らせ本文（シート「03_お知らせ」と併用可）
 *   CACHE_ENABLED          "false" でキャッシュを無効化
 *   CACHE_SECONDS          キャッシュ秒数（1〜1800、既定1800）
 *   ADMIN_EMAIL / FRONTEND_URL / WEB_APP_URL / BACKUP_FOLDER_ID など（Operations.gs）
 */

const API_VERSION = "1.0.0";
const SERVICE_NAME = "Gourmet Map API";

const HOTPEPPER_ENDPOINT = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
const GEOAPIFY_ENDPOINT = "https://api.geoapify.com/v1/geocode/search";

const ALLOWED_ACTIONS = ["status", "search", "geocode", "favorites"];

const SEARCH_RANGE = 5; // 3000m
// 店舗検索は1回の呼び出しで近い順に最大100件のみ（ページングしない）
const PAGE_SIZE = 100;
// type=credit_card：標準の全項目に「利用できるカードの種類」を付加（電話番号はAPIの返却項目にない）
const RESPONSE_TYPE = "credit_card";
// 返却項目を変えたら更新（古い形式のキャッシュを使わない）
const SHOP_SCHEMA = 2;
const MAX_BODY_LENGTH = 4000;

const CACHE_TTL_SECONDS = 30 * 60; // PER-01（暫定30分）
const STATUS_CACHE_SECONDS = 60;
const CACHE_CHUNK_CHARS = 25000; // 1キー100KB制限に対しUTF-8の多バイト文字を考慮
const FORCE_REFRESH_MIN_AGE_MS = 60 * 1000;

const CIRCUIT_FAILURES = 5;
const CIRCUIT_OPEN_SECONDS = 5 * 60;

const DEFAULTS = Object.freeze({
  RATE_LIMIT_PER_MINUTE: 120,
  MAX_CONCURRENT: 10,
  // 要件 SEC-05／MON-02：日次上限の初期値は100（Script Properties で変更可）
  DAILY_API_LIMIT: 100,
});

/* ========================================
   01. Script Properties
======================================== */

function properties_() {
  return PropertiesService.getScriptProperties();
}

function getProperty_(key, fallback) {
  const raw = properties_().getProperty(key);

  // 前後の空白・改行は入力ミスとして除去
  const value = raw === null ? null : String(raw).trim();

  return value === null || value === "" ? (fallback === undefined ? null : fallback) : value;
}

/**
 * 有効／無効の値を解釈する（チェックボックス・TRUE/FALSE・有効/無効・ON/OFF・1/0）
 * 解釈できない値は null（未設定扱い）
 */
function parseFlag_(value) {
  if (value === true || value === false) return value;

  if (value === null || value === undefined) return null;

  const text = String(value).trim().toLowerCase();

  if (["true", "有効", "on", "1", "yes", "はい", "○"].indexOf(text) >= 0) return true;

  if (["false", "無効", "off", "0", "no", "いいえ", "×"].indexOf(text) >= 0) return false;

  return null;
}

function requireProperty_(key) {
  const value = getProperty_(key);

  if (!value) {
    throw new Error("ERR_CONFIG");
  }

  return value;
}

function numberProperty_(key, fallback) {
  const value = Number(getProperty_(key, String(fallback)));

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/* ========================================
   02. 入口
======================================== */

// GET は状態確認のみ（監視用）。利用者データはURLに含めない
function doGet() {
  return handleRequest_({ action: "status" });
}

function doPost(e) {
  let params;

  try {
    params = parseBody_(e);
  } catch (error) {
    return respond_(errorBody_(newRequestId_(), "unknown", codeOf_(error)));
  }

  return handleRequest_(params);
}

function handleRequest_(params) {
  const requestId = newRequestId_();

  let action = "unknown";

  let slotTaken = false;

  try {
    action = params.action;

    if (ALLOWED_ACTIONS.indexOf(action) < 0) {
      throw new Error("ERR_INPUT");
    }

    if (action !== "status") {
      ensureServiceAvailable_(action);
      checkRateLimit_();
      slotTaken = acquireSlot_();
    }

    let data;

    switch (action) {
      case "status":
        data = getStatus_();
        break;
      case "search":
        data = searchShops_(params);
        break;
      case "geocode":
        data = geocode_(params);
        break;
      case "favorites":
        data = searchFavorites_(params);
        break;
      default:
        throw new Error("ERR_INPUT");
    }

    countFeature_(action);

    return respond_({
      ok: true,
      data: data,
      errorCode: null,
      requestId: requestId,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      complete: data.complete === undefined ? null : data.complete,
      // SYS-03：API総件数・取得件数・上限到達状態（店舗検索のみ）
      total: data.total === undefined ? null : data.total,
      returned: data.returned === undefined ? null : data.returned,
      limitReached: data.limitReached === undefined ? null : data.limitReached,
    });
  } catch (error) {
    const code = codeOf_(error);

    // 想定外の例外は内容をログに出さず分類のみ記録（SEC-07）
    writeSafeError_(requestId, action, code);

    return respond_(errorBody_(requestId, action, code));
  } finally {
    if (slotTaken) releaseSlot_();
  }
}

function parseBody_(e) {
  const text = e && e.postData ? String(e.postData.contents || "") : "";

  if (!text || text.length > MAX_BODY_LENGTH) {
    throw new Error("ERR_INPUT");
  }

  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("ERR_INPUT");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ERR_INPUT");
  }

  return parsed;
}

function respond_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function errorBody_(requestId, action, code) {
  return {
    ok: false,
    data: null,
    errorCode: code,
    requestId: requestId,
    fetchedAt: new Date().toISOString(),
    complete: false,
  };
}

function codeOf_(error) {
  const message = error && error.message ? String(error.message) : "";

  return /^ERR_[A-Z_]+$/.test(message) ? message : "ERR_API";
}

function newRequestId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 12);
}

/* ========================================
   03. 停止フラグ・機能フラグ・メンテナンス
======================================== */

function readFeatureFlags_() {
  const cache = CacheService.getScriptCache();

  const cached = cache.get("flags:v1");

  if (cached) return JSON.parse(cached);

  const flags = {};

  try {
    const sheet = spreadsheet_().getSheetByName("09_機能管理");

    if (sheet && sheet.getLastRow() > 1) {
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();

      rows.forEach(function (row) {
        const key = String(row[0] || "").trim();

        const value = parseFlag_(row[1]);

        // 解釈できない値（空欄など）は既定値のまま
        if (/^[a-z][a-zA-Z0-9_]{0,40}$/.test(key) && value !== null) {
          flags[key] = value;
        }
      });
    }
  } catch (error) {
    // シートを読めない場合は既定値（お気に入りは無効）
  }

  cache.put("flags:v1", JSON.stringify(flags), STATUS_CACHE_SECONDS);

  return flags;
}

function readMaintenance_() {
  try {
    const sheet = spreadsheet_().getSheetByName("04_メンテナンス");

    if (!sheet || sheet.getLastRow() < 2) return null;

    const now = Date.now();

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];

      const start = new Date(row[1]).getTime();
      const end = row[2] ? new Date(row[2]).getTime() : Infinity;
      const status = String(row[4] || "");

      if (status === "実施中" || (Number.isFinite(start) && start <= now && now <= end && status !== "中止")) {
        return {
          active: true,
          target: String(row[3] || "全体").slice(0, 50),
          message: String(row[5] || "現在メンテナンス中です。").slice(0, 300),
          startAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
          endAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
        };
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

// 停止の理由（管理者向け診断用。公開応答には含めない）
function stopReason_() {
  if (parseFlag_(getProperty_("SERVICE_STOPPED")) === true) return "SERVICE_STOPPED";

  // 旧版互換：明示的に無効（false 等）が設定されている場合のみ停止
  if (parseFlag_(getProperty_("API_ENABLED")) === false) return "API_ENABLED";

  const flags = readFeatureFlags_();

  if (flags.service === false) return "FEATURE_FLAG_SERVICE";

  const maintenance = readMaintenance_();

  if (maintenance && maintenance.active) return "MAINTENANCE_SHEET";

  return null;
}

// 停止フラグ（新：SERVICE_STOPPED=true／旧：API_ENABLED=false）
function serviceStopped_() {
  return (
    parseFlag_(getProperty_("SERVICE_STOPPED")) === true ||
    parseFlag_(getProperty_("API_ENABLED")) === false
  );
}

function favoritesEnabled_(flags) {
  return flags.favorites === true || parseFlag_(getProperty_("FAVORITES_ENABLED")) === true;
}

function ensureServiceAvailable_(action) {
  if (serviceStopped_()) {
    throw new Error("ERR_MAINTENANCE");
  }

  const flags = readFeatureFlags_();

  if (flags.service === false) throw new Error("ERR_MAINTENANCE");

  if (flags[action] === false) throw new Error("ERR_DISABLED");

  if (action === "favorites" && !favoritesEnabled_(flags)) {
    throw new Error("ERR_DISABLED");
  }

  const cache = CacheService.getScriptCache();

  let maintenance = cache.get("maintenance:v1");

  if (maintenance === null) {
    maintenance = JSON.stringify(readMaintenance_());
    cache.put("maintenance:v1", maintenance, STATUS_CACHE_SECONDS);
  }

  const parsed = JSON.parse(maintenance);

  if (parsed && parsed.active) throw new Error("ERR_MAINTENANCE");
}

/* ========================================
   04. レート制限・同時実行制限・日次予算（SEC-05）
   ※ ブラウザ側の制御は信頼しない
======================================== */

function withLock_(callback) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(3000)) {
    throw new Error("ERR_BUSY");
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function checkRateLimit_() {
  const limit = numberProperty_("RATE_LIMIT_PER_MINUTE", DEFAULTS.RATE_LIMIT_PER_MINUTE);

  const key = "rate:" + Math.floor(Date.now() / 60000);

  withLock_(function () {
    const cache = CacheService.getScriptCache();

    const count = Number(cache.get(key) || "0") + 1;

    if (count > limit) {
      throw new Error("ERR_RATE_LIMIT");
    }

    cache.put(key, String(count), 120);
  });
}

function acquireSlot_() {
  const limit = numberProperty_("MAX_CONCURRENT", DEFAULTS.MAX_CONCURRENT);

  return withLock_(function () {
    const cache = CacheService.getScriptCache();

    const count = Number(cache.get("inflight") || "0");

    if (count >= limit) {
      throw new Error("ERR_BUSY");
    }

    // 異常終了で戻されなかった場合も60秒で自然に解消
    cache.put("inflight", String(count + 1), 60);

    return true;
  });
}

function releaseSlot_() {
  try {
    withLock_(function () {
      const cache = CacheService.getScriptCache();

      const count = Number(cache.get("inflight") || "0");

      cache.put("inflight", String(Math.max(0, count - 1)), 60);
    });
  } catch (error) {
    // 解放失敗はTTLで解消
  }
}

function today_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
}

// 外部API呼出の事前予約（日次予算）
function reserveExternalCall_() {
  const limit = numberProperty_("DAILY_API_LIMIT", DEFAULTS.DAILY_API_LIMIT);

  withLock_(function () {
    const props = properties_();

    const date = today_();

    const previousDate = props.getProperty("USAGE_DATE");

    if (previousDate !== date) {
      // 日付が変わった場合は前日分を退避（Operations.gs の集計で記録）
      if (previousDate) {
        props.setProperty(
          "USAGE_PREV",
          JSON.stringify({
            date: previousDate,
            count: Number(props.getProperty("USAGE_COUNT") || "0"),
            success: Number(props.getProperty("USAGE_SUCCESS") || "0"),
            failure: Number(props.getProperty("USAGE_FAILURE") || "0"),
            limitHit: Number(props.getProperty("USAGE_LIMIT_HIT") || "0"),
          }),
        );
      }

      props.setProperties({
        USAGE_DATE: date,
        USAGE_COUNT: "0",
        USAGE_SUCCESS: "0",
        USAGE_FAILURE: "0",
        USAGE_LIMIT_HIT: "0",
      });
    }

    const count = Number(props.getProperty("USAGE_COUNT") || "0");

    if (count >= limit) {
      props.setProperty(
        "USAGE_LIMIT_HIT",
        String(Number(props.getProperty("USAGE_LIMIT_HIT") || "0") + 1),
      );

      throw new Error("ERR_RATE_LIMIT");
    }

    props.setProperty("USAGE_COUNT", String(count + 1));
  });
}

function recordExternalResult_(success) {
  try {
    withLock_(function () {
      const props = properties_();

      const key = success ? "USAGE_SUCCESS" : "USAGE_FAILURE";

      props.setProperty(key, String(Number(props.getProperty(key) || "0") + 1));
    });
  } catch (error) {
    // 集計の失敗で応答を止めない
  }
}

// 機能別の利用件数（個人を識別しない集計：08_利用統計へ日次で転記）
function countFeature_(action) {
  if (ALLOWED_ACTIONS.indexOf(action) < 0) return;

  try {
    withLock_(function () {
      const props = properties_();

      const key = "STAT_" + today_() + "_" + action;

      props.setProperty(key, String(Number(props.getProperty(key) || "0") + 1));
    });
  } catch (error) {
    // 集計の失敗で応答を止めない
  }
}

/* ========================================
   05. サーキットブレーカー（PER-04）
======================================== */

function circuitOpen_(service) {
  return CacheService.getScriptCache().get("circuit:" + service) === "open";
}

function recordCircuit_(service, success) {
  const cache = CacheService.getScriptCache();

  const key = "circuit-fail:" + service;

  if (success) {
    cache.remove(key);
    return;
  }

  const failures = Number(cache.get(key) || "0") + 1;

  cache.put(key, String(failures), CIRCUIT_OPEN_SECONDS);

  if (failures >= CIRCUIT_FAILURES) {
    cache.put("circuit:" + service, "open", CIRCUIT_OPEN_SECONDS);
  }
}

/* ========================================
   06. 外部API呼出（キーはログに出さない）
======================================== */

function buildQuery_(params) {
  return Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    })
    .join("&");
}

function fetchJson_(service, url) {
  if (circuitOpen_(service)) {
    throw new Error("ERR_TEMPORARY");
  }

  reserveExternalCall_();

  let response;

  try {
    response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true,
    });
  } catch (error) {
    recordCircuit_(service, false);
    recordExternalResult_(false);

    throw new Error("ERR_TEMPORARY");
  }

  const status = response.getResponseCode();

  if (status === 429) {
    recordExternalResult_(false);
    throw new Error("ERR_RATE_LIMIT");
  }

  if (status >= 500) {
    recordCircuit_(service, false);
    recordExternalResult_(false);
    throw new Error("ERR_TEMPORARY");
  }

  if (status === 401 || status === 403) {
    recordExternalResult_(false);
    throw new Error("ERR_CONFIG");
  }

  if (status !== 200) {
    recordExternalResult_(false);
    throw new Error("ERR_API");
  }

  try {
    const json = JSON.parse(response.getContentText("UTF-8"));

    recordCircuit_(service, true);
    recordExternalResult_(true);

    return json;
  } catch (error) {
    recordExternalResult_(false);
    throw new Error("ERR_API");
  }
}

/* ========================================
   07. 入力検証（SEC-02）
======================================== */

function validLatLng_(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    isFinite(lat) &&
    isFinite(lng) &&
    lat >= 20 &&
    lat <= 46 &&
    lng >= 122 &&
    lng <= 154
  );
}

function cleanText_(value, max) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

/* ========================================
   08. 店舗検索（API-01〜06）
======================================== */

function hashKey_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);

  return bytes
    .map(function (byte) {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    })
    .join("")
    .slice(0, 40);
}

function cacheEnabled_() {
  return String(getProperty_("CACHE_ENABLED", "true")).toLowerCase() !== "false";
}

function cacheSeconds_() {
  const value = Number(getProperty_("CACHE_SECONDS", String(CACHE_TTL_SECONDS)));

  return Number.isInteger(value) ? Math.max(1, Math.min(value, CACHE_TTL_SECONDS)) : CACHE_TTL_SECONDS;
}

// 1キーの容量制限に合わせて分割保存
function cachePut_(key, value) {
  if (!cacheEnabled_()) return;

  const text = JSON.stringify(value);

  const chunks = [];

  for (let i = 0; i < text.length; i += CACHE_CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CACHE_CHUNK_CHARS));
  }

  const entries = {};

  entries[key + ":n"] = String(chunks.length);

  chunks.forEach(function (chunk, index) {
    entries[key + ":" + index] = chunk;
  });

  try {
    CacheService.getScriptCache().putAll(entries, cacheSeconds_());
  } catch (error) {
    // キャッシュ保存の失敗は無視（次回は再取得）
  }
}

// 欠落がある場合は null（再取得）
function cacheGet_(key) {
  if (!cacheEnabled_()) return null;

  const cache = CacheService.getScriptCache();

  const count = Number(cache.get(key + ":n"));

  if (!Number.isInteger(count) || count < 1 || count > 50) return null;

  const keys = [];

  for (let i = 0; i < count; i++) keys.push(key + ":" + i);

  const values = cache.getAll(keys);

  let text = "";

  for (let i = 0; i < count; i++) {
    const chunk = values[key + ":" + i];

    if (typeof chunk !== "string") return null;

    text += chunk;
  }

  try {
    const data = JSON.parse(text);

    // 保持期限を超えたデータは使わない
    if (Date.now() - Date.parse(data.fetchedAt) >= cacheSeconds_() * 1000) return null;

    return data;
  } catch (error) {
    return null;
  }
}

function photoList_(shop) {
  const pc = shop.photo && shop.photo.pc ? shop.photo.pc : {};

  return [pc.l, pc.m, pc.s]
    .filter(function (url) {
      return typeof url === "string" && /^https:\/\/[a-z0-9.-]+\.(hotp|hotpepper)\.jp\//i.test(url);
    })
    .slice(0, 3);
}

// 利用できるカードの種類（type=credit_card の credit_card[].name）
function creditCards_(shop) {
  const list = Array.isArray(shop.credit_card) ? shop.credit_card : [];
  const names = [];

  list.forEach(function (card) {
    const name = cleanText_(card && card.name, 50);

    if (name && names.indexOf(name) < 0 && names.length < 30) names.push(name);
  });

  return names;
}

function hotpepperUrl_(url) {
  return typeof url === "string" && /^https:\/\/([a-z0-9-]+\.)*hotpepper\.jp\//i.test(url)
    ? url.slice(0, 300)
    : "";
}

// 許可した項目のみを返す（許可リスト方式）
function mapShop_(shop) {
  const url = shop.urls && typeof shop.urls.pc === "string" ? shop.urls.pc : "";
  const coupon = shop.coupon_urls || {};

  return {
    id: cleanText_(shop.id, 20),
    name: cleanText_(shop.name, 200),
    nameKana: cleanText_(shop.name_kana, 200),
    genre: cleanText_(shop.genre && shop.genre.name, 100),
    catchCopy: cleanText_(shop["catch"], 300),
    address: cleanText_(shop.address, 300),
    lat: Number(shop.lat),
    lng: Number(shop.lng),
    open: cleanText_(shop.open, 600),
    close: cleanText_(shop.close, 300),
    budget: cleanText_(shop.budget && shop.budget.average, 200),
    budgetMemo: cleanText_(shop.budget_memo, 300),
    stationName: cleanText_(shop.station_name, 100),
    access: cleanText_(shop.access, 400),
    lunch: cleanText_(shop.lunch, 200),
    card: cleanText_(shop.card, 200),
    creditCards: creditCards_(shop),
    parking: cleanText_(shop.parking, 200),
    nonSmoking: cleanText_(shop.non_smoking, 200),
    barrierFree: cleanText_(shop.barrier_free, 200),
    capacity: cleanText_(shop.capacity, 50),
    privateRoom: cleanText_(shop.private_room, 200),
    wifi: cleanText_(shop.wifi, 200),
    child: cleanText_(shop.child, 200),
    freeDrink: cleanText_(shop.free_drink, 200),
    freeFood: cleanText_(shop.free_food, 200),
    partyCapacity: cleanText_(shop.party_capacity, 50),
    course: cleanText_(shop.course, 200),
    charter: cleanText_(shop.charter, 200),
    tatami: cleanText_(shop.tatami, 200),
    horigotatsu: cleanText_(shop.horigotatsu, 200),
    midnight: cleanText_(shop.midnight, 200),
    english: cleanText_(shop.english, 200),
    pet: cleanText_(shop.pet, 200),
    otherMemo: cleanText_(shop.other_memo, 300),
    shopDetailMemo: cleanText_(shop.shop_detail_memo, 300),
    url: hotpepperUrl_(url),
    couponUrl: hotpepperUrl_(coupon.sp) || hotpepperUrl_(coupon.pc),
    photos: photoList_(shop),
  };
}

function hotpepperError_(json) {
  const results = json && json.results;

  const errors = results && results.error;

  if (!errors || !errors.length) return null;

  const code = Number(errors[0].code);

  if (code === 2000) return "ERR_CONFIG";
  if (code === 3000) return "ERR_INPUT";

  return "ERR_TEMPORARY";
}

function searchShops_(params) {
  const lat = params.lat;
  const lng = params.lng;
  const force = params.force === true;

  // 2ページ目以降は提供しない（外部APIの呼出回数を1検索1回に抑える）
  if (params.start !== undefined && params.start !== 1) throw new Error("ERR_INPUT");

  const start = 1;

  if (!validLatLng_(lat, lng)) throw new Error("ERR_INPUT");

  // 座標はそのまま保存せずハッシュ化したキーで一時保持
  const key =
    "hp:" + hashKey_(
      [lat.toFixed(6), lng.toFixed(6), SEARCH_RANGE, PAGE_SIZE, start, RESPONSE_TYPE, SHOP_SCHEMA].join(":"),
    );

  const cached = cacheGet_(key);

  // 手動更新でも直近の取得は再利用（制限の範囲内で最新取得）
  if (cached && (!force || Date.now() - Date.parse(cached.fetchedAt) < FORCE_REFRESH_MIN_AGE_MS)) {
    cached.cached = true;
    return cached;
  }

  const url =
    HOTPEPPER_ENDPOINT +
    "?" +
    buildQuery_({
      key: requireProperty_("HOTPEPPER_API_KEY"),
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      range: SEARCH_RANGE,
      datum: "world",
      count: PAGE_SIZE,
      start: start,
      type: RESPONSE_TYPE,
      format: "json",
    });

  const json = fetchJson_("hotpepper", url);

  const apiError = hotpepperError_(json);

  if (apiError) throw new Error(apiError);

  const results = json && json.results;

  if (!results) throw new Error("ERR_API");

  const total = Number(results.results_available);
  const returned = Number(results.results_returned);
  const resultStart = Number(results.results_start);

  if (
    !Number.isInteger(total) ||
    total < 0 ||
    !Number.isInteger(returned) ||
    resultStart !== start ||
    returned !== (results.shop || []).length
  ) {
    throw new Error("ERR_API");
  }

  const shops = (results.shop || []).map(mapShop_).filter(function (shop) {
    return shop.id && isFinite(shop.lat) && isFinite(shop.lng);
  });

  // SYS-03：complete は単回取得の成否（全掲載店舗の網羅ではない）
  const expected = Math.min(total, PAGE_SIZE);

  const data = {
    shops: shops,
    total: Math.floor(total), // API総件数（results_available）
    returned: returned, // 取得件数（results_returned）
    limitReached: total > PAGE_SIZE, // 100件の上限に達した（101件目以降は未取得）
    complete: returned === expected && shops.length === returned,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  cachePut_(key, data);

  return data;
}

/* ========================================
   09. お気に入り（ID検索：最大20件）
======================================== */

function searchFavorites_(params) {
  const ids = params.ids;

  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20) {
    throw new Error("ERR_INPUT");
  }

  const unique = [];

  ids.forEach(function (id) {
    if (typeof id !== "string" || !/^J[0-9]{9}$/.test(id)) {
      throw new Error("ERR_INPUT");
    }

    if (unique.indexOf(id) < 0) unique.push(id);
  });

  const url =
    HOTPEPPER_ENDPOINT +
    "?" +
    buildQuery_({
      key: requireProperty_("HOTPEPPER_API_KEY"),
      id: unique.join(","),
      count: 20,
      type: RESPONSE_TYPE,
      format: "json",
    });

  const json = fetchJson_("hotpepper", url);

  const apiError = hotpepperError_(json);

  if (apiError) throw new Error(apiError);

  const shops = ((json.results && json.results.shop) || []).map(mapShop_);

  const found = shops.map(function (shop) {
    return shop.id;
  });

  return {
    shops: shops,
    missingIds: unique.filter(function (id) {
      return found.indexOf(id) < 0;
    }),
    fetchedAt: new Date().toISOString(),
  };
}

/* ========================================
   10. 住所・駅名検索（Geoapify）
   入力はログ・シートに記録しない（3.3）
======================================== */

function geocode_(params) {
  const mode = params.mode === "station" ? "station" : "address";

  let query = cleanText_(params.query, 100);

  if (query.length < 2) throw new Error("ERR_INPUT");

  if (mode === "station" && !/駅$/.test(query)) {
    query += "駅";
  }

  const url =
    GEOAPIFY_ENDPOINT +
    "?" +
    buildQuery_({
      text: query,
      lang: "ja",
      filter: "countrycode:jp",
      limit: 6,
      format: "json",
      apiKey: requireProperty_("GEOAPIFY_API_KEY"),
    });

  const json = fetchJson_("geoapify", url);

  const results = (json && json.results) || [];

  const candidates = results
    .filter(function (item) {
      return !item.country_code || item.country_code === "jp";
    })
    .map(function (item) {
      const lat = Number(item.lat);
      const lng = Number(item.lon);

      return {
        label: cleanText_(item.name || item.address_line1 || item.formatted, 100),
        address: cleanText_(item.formatted || item.address_line2, 300),
        lat: lat,
        lng: lng,
        source: mode,
        attribution: cleanText_(
          (item.datasource && item.datasource.attribution) || "© OpenStreetMap contributors",
          200,
        ) + " / Geoapify",
      };
    })
    .filter(function (item) {
      return validLatLng_(item.lat, item.lng);
    });

  return {
    candidates: candidates,
    fetchedAt: new Date().toISOString(),
  };
}

/* ========================================
   11. 状態・お知らせ（公開用の項目のみ）
======================================== */

function readNotices_() {
  try {
    const sheet = spreadsheet_().getSheetByName("03_お知らせ");

    if (!sheet || sheet.getLastRow() < 2) return [];

    const now = Date.now();

    return sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 6)
      .getValues()
      .filter(function (row) {
        const start = row[3] ? new Date(row[3]).getTime() : 0;
        const end = row[4] ? new Date(row[4]).getTime() : Infinity;

        return (row[5] === true || String(row[5]).toUpperCase() === "TRUE") && start <= now && now <= end;
      })
      .slice(-5)
      .reverse()
      .map(function (row) {
        return {
          id: cleanText_(row[0], 30),
          title: cleanText_(row[1], 100),
          body: cleanText_(row[2], 1000),
          publishedAt: row[3] ? new Date(row[3]).toISOString() : null,
        };
      });
  } catch (error) {
    return [];
  }
}

// シートのお知らせ＋旧版の PUBLIC_NOTICE
function publicNotices_() {
  const notices = readNotices_();

  const legacy = cleanText_(getProperty_("PUBLIC_NOTICE", ""), 500);

  if (legacy) {
    notices.unshift({ id: "notice", title: "お知らせ", body: legacy, publishedAt: null });
  }

  return notices.slice(0, 5);
}

function readServiceStatus_() {
  try {
    const sheet = spreadsheet_().getSheetByName("07_稼働記録");

    if (!sheet || sheet.getLastRow() < 2) return [];

    const count = Math.min(sheet.getLastRow() - 1, 300);

    const rows = sheet.getRange(sheet.getLastRow() - count + 1, 1, count, 4).getValues();

    const services = {};

    rows.forEach(function (row) {
      const name = cleanText_(row[1], 50);

      if (!name) return;

      if (!services[name]) {
        services[name] = { name: name, total: 0, success: 0 };
      }

      const entry = services[name];

      entry.total++;

      if (row[2] === "success") entry.success++;

      entry.status = row[2] === "success" ? "success" : "failure";
      entry.checkedAt = row[0] ? new Date(row[0]).toISOString() : null;
      entry.responseMs = Number(row[3]);
    });

    return Object.keys(services).map(function (name) {
      const entry = services[name];

      return {
        name: entry.name,
        status: entry.status,
        checkedAt: entry.checkedAt,
        responseMs: isFinite(entry.responseMs) ? Math.round(entry.responseMs) : null,
        successRate: entry.total ? Math.round((entry.success / entry.total) * 1000) / 10 : null,
      };
    });
  } catch (error) {
    return [];
  }
}

function getStatus_() {
  const cache = CacheService.getScriptCache();

  const cached = cache.get("status:v1");

  if (cached) return JSON.parse(cached);

  const flags = readFeatureFlags_();

  const maintenance = readMaintenance_();

  const stopped = serviceStopped_();

  const services = readServiceStatus_();

  const hasFailure = services.some(function (service) {
    return service.status === "failure";
  });

  let status = "online";

  if (stopped || flags.service === false || (maintenance && maintenance.active)) {
    status = "maintenance";
  } else if (hasFailure || circuitOpen_("hotpepper") || circuitOpen_("geoapify")) {
    status = "degraded";
  }

  const data = {
    service: SERVICE_NAME,
    version: API_VERSION,
    status: status,
    message:
      status === "online"
        ? "すべての機能が利用可能です。"
        : status === "degraded"
          ? "一部の外部サービスで応答の遅延や失敗を確認しています。"
          : "現在メンテナンス中です。",
    maintenance: maintenance,
    favoritesEnabled: favoritesEnabled_(flags),
    services: services,
    notices: publicNotices_(),
    fetchedAt: new Date().toISOString(),
  };

  cache.put("status:v1", JSON.stringify(data), STATUS_CACHE_SECONDS);

  return data;
}
