/**
 * 単体・境界値・回帰テスト（15.1）
 * 実行：node --test test/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadApp } = require("./helpers.js");

function setup() {
  return loadApp().GM;
}

/* =================================
   距離計算（SR-01／SR-02）
================================== */

test("同じ座標の距離は0m", () => {
  const { Search: Q } = setup();

  assert.equal(Q.distance(35, 135, 35, 135), 0);
});

test("緯度0.01度は約1,112m（地球平均半径6,371km）", () => {
  const { Search: Q } = setup();

  assert.equal(Math.round(Q.distance(35, 135, 35.01, 135)), 1112);
});

test("無効な緯度・経度を拒否", () => {
  const { Search: Q } = setup();

  assert.throws(() => Q.distance(100, 135, 35, 135));
  assert.throws(() => Q.distance(35, 181, 35, 135));
  assert.throws(() => Q.distance(Number.NaN, 135, 35, 135));
});

test("徒歩時間は80m/分で切り上げ", () => {
  const { Search: Q } = setup();

  assert.equal(Q.walkingMinutes(80), 1);
  assert.equal(Q.walkingMinutes(81), 2);
  assert.equal(Q.walkingMinutes(400), 5);
  assert.equal(Q.walkingMinutes(Number.NaN), null);
});

test("距離表示はm／kmを切り替える", () => {
  const { Search: Q } = setup();

  assert.equal(Q.formatDistance(800), "800m");
  assert.equal(Q.formatDistance(999.4), "999m");
  assert.equal(Q.formatDistance(1000), "1km");
  assert.equal(Q.formatDistance(1500), "1.5km");
  assert.equal(Q.formatDistance(null), "距離情報なし");
});

/* =================================
   絞り込み・並び替え（SR-03〜SR-08）
================================== */

const SHOPS = [
  {
    id: "J000000001",
    name: "カフェ テスト",
    nameKana: "カフェ テスト",
    genre: "カフェ・スイーツ",
    distanceM: 300,
    lunch: "あり",
    parking: "なし",
    card: "利用可",
  },
  {
    id: "J000000002",
    name: "和食 テスト",
    nameKana: "ワショク テスト",
    genre: "和食",
    distanceM: 800,
    lunch: "あり",
    parking: "あり ：提携駐車場あり",
    card: "利用不可",
  },
  {
    id: "J000000003",
    name: "洋食 テスト",
    nameKana: "ヨウショク テスト",
    genre: "洋食",
    distanceM: 3001,
    lunch: "未確認",
    parking: "あり",
  },
  {
    id: "J000000004",
    name: "アジア料理",
    nameKana: "アジアリョウリ",
    genre: "アジア・エスニック料理",
    distanceM: 800,
    lunch: "なし",
    parking: "要確認",
  },
];

test("3kmを超える店舗を除外（3000mは含む）", () => {
  const { Search: Q, Storage: S } = setup();

  assert.equal(Q.filter(SHOPS, S.defaultFilters()).length, 3);
  assert.equal(Q.filter([{ ...SHOPS[0], distanceM: 3000 }], S.defaultFilters()).length, 1);
});

test("距離300mの境界値", () => {
  const { Search: Q, Storage: S } = setup();

  const filters = { ...S.defaultFilters(), radiusM: 300 };

  assert.deepEqual(
    Q.filter(SHOPS, filters).map((shop) => shop.id),
    ["J000000001"],
  );
});

test("ジャンルはOR、未選択は0件", () => {
  const { Search: Q, Storage: S } = setup();

  assert.equal(Q.filter(SHOPS, { ...S.defaultFilters(), genreNames: ["カフェ・スイーツ", "和食"] }).length, 2);
  assert.equal(Q.filter(SHOPS, { ...S.defaultFilters(), genreNames: [] }).length, 0);
});

test("詳細条件はAND（「あり ：…」形式も肯定と判定）", () => {
  const { Search: Q, Storage: S } = setup();

  const filters = { ...S.defaultFilters(), conditions: ["lunch", "parking"] };

  assert.deepEqual(
    Q.filter(SHOPS, filters).map((shop) => shop.id),
    ["J000000002"],
  );
});

test("店名・読みかなの部分一致（ひらがな・カタカナ・全角を正規化）", () => {
  const { Search: Q, Storage: S } = setup();

  assert.equal(Q.filter(SHOPS, { ...S.defaultFilters(), keyword: "かふぇ" }).length, 1);
  assert.equal(Q.filter(SHOPS, { ...S.defaultFilters(), keyword: "ワショク" }).length, 1);
  assert.equal(Q.filter(SHOPS, { ...S.defaultFilters(), keyword: "ｶﾌｪ" }).length, 1);
  assert.equal(Q.normalize("ＡＢＣ１２３"), "abc123");
});

test("並び替え：距離・店名（同値時は店舗IDで安定化）", () => {
  const { Search: Q, Storage: S } = setup();

  const ids = (sort) => Q.filter(SHOPS, { ...S.defaultFilters(), sort }).map((shop) => shop.id);

  assert.deepEqual(ids("distanceAsc"), ["J000000001", "J000000002", "J000000004"]);
  assert.deepEqual(ids("distanceDesc"), ["J000000002", "J000000004", "J000000001"]);
  assert.equal(ids("nameAsc")[0], "J000000004");
  assert.equal(ids("nameDesc")[0], "J000000002");
});

test("お気に入り絞り込み", () => {
  const { Search: Q, Storage: S } = setup();

  const filters = { ...S.defaultFilters(), favoriteOnly: true };

  assert.equal(Q.filter(SHOPS, filters, ["J000000001"]).length, 1);
});

/* =================================
   自由記述の分類（SR-07）
================================== */

test("設備情報の肯定・否定・不明", () => {
  const { Search: Q } = setup();

  assert.equal(Q.classify("あり", "parking"), "yes");
  assert.equal(Q.classify("あり ：提携駐車場あり", "parking"), "yes");
  assert.equal(Q.classify("なし", "parking"), "no");
  assert.equal(Q.classify("利用可", "card"), "yes");
  assert.equal(Q.classify("利用不可", "card"), "no");
  assert.equal(Q.classify("未確認", "wifi"), "unknown");
  assert.equal(Q.classify("あり ：要確認", "wifi"), "unknown");
  assert.equal(Q.classify("", "wifi"), "unknown");
  assert.equal(Q.classify("要相談", "privateRoom"), "unknown");
});

test("禁煙・お子様連れの判定", () => {
  const { Search: Q } = setup();

  assert.equal(Q.classify("全面禁煙", "nonSmoking"), "yes");
  assert.equal(Q.classify("禁煙席なし", "nonSmoking"), "no");
  assert.equal(Q.classify("お子様連れ歓迎", "child"), "yes");
  assert.equal(Q.classify("お子様連れOK", "child"), "yes");
  assert.equal(Q.classify("お子様連れ不可", "child"), "no");
});

test("飲料プランは非アルコール提供が明示された場合のみ肯定", () => {
  const { Search: Q } = setup();

  assert.equal(Q.classify("あり ：ソフトドリンク飲み放題あり", "softDrinkPlan"), "yes");
  assert.equal(Q.classify("あり", "softDrinkPlan"), "unknown");
  assert.equal(Q.classify("なし", "softDrinkPlan"), "no");
});

/* =================================
   条件の要約
================================== */

test("条件の要約と適用数", () => {
  const { Search: Q, Storage: S } = setup();

  const filters = { ...S.defaultFilters(), radiusM: 1000, conditions: ["lunch"], keyword: "カフェ" };

  assert.equal(Q.describeFilters(filters), "1km以内 / 全ジャンル / 店名：カフェ / ランチあり");
  assert.equal(Q.countActiveFilters(filters), 3);
  assert.equal(Q.isDefaultFilters(S.defaultFilters()), true);
});

/* =================================
   店舗取得（近い順に最大100件・重複排除・部分取得）
================================== */

function fakeApi(handler) {
  const calls = [];

  return {
    calls,
    request: async (action, params) => {
      calls.push({ action, ...params });

      return handler(params);
    },
    wait: async () => undefined,
  };
}

function shopsAround(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: "J" + String(i + 1).padStart(9, "0"),
    lat: 35 + i * 0.0001,
    lng: 135,
  }));
}

test("1回の呼び出しで取得し、重複排除・3km以内に限定（総件数100件以下は完了）", async () => {
  const { GM } = loadApp(["config", "storage", "search"]);

  const api = fakeApi(() => ({
    shops: [
      { id: "J000000001", lat: 35.0, lng: 135.0 },
      { id: "J000000002", lat: 35.01, lng: 135.0 },
      { id: "J000000002", lat: 35.01, lng: 135.0 },
      { id: "J000000003", lat: 35.5, lng: 135.0 },
    ],
    total: 3,
    fetchedAt: new Date().toISOString(),
  }));

  GM.Api = api;

  const result = await GM.Search.fetchNearby({ lat: 35, lng: 135 });

  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].start, undefined);
  assert.equal(result.received, 3);
  assert.equal(result.complete, true);
  assert.equal(result.limited, false);
  assert.equal(result.errorCode, null);
  assert.deepEqual(
    [...result.shops.map((shop) => shop.id)],
    ["J000000001", "J000000002"],
  );
});

test("API総件数が100件を超える場合は正常な上限到達（complete=true・limited=true）で追加取得しない", async () => {
  const { GM } = loadApp(["config", "storage", "search"]);

  const api = fakeApi(() => ({
    shops: shopsAround(100),
    total: 3000,
    fetchedAt: new Date().toISOString(),
  }));

  GM.Api = api;

  const result = await GM.Search.fetchNearby({ lat: 35, lng: 135 });

  assert.equal(api.calls.length, 1);
  assert.equal(result.received, 100);
  assert.equal(result.total, 3000);
  assert.equal(result.complete, true);
  assert.equal(result.limited, true);
  assert.equal(result.errorCode, null);
});

test("想定件数に届かない応答は部分取得（ERR_PARTIAL）", async () => {
  const { GM } = loadApp(["config", "storage", "search"]);

  GM.Api = fakeApi(() => ({
    shops: shopsAround(40),
    total: 3000,
    fetchedAt: new Date().toISOString(),
  }));

  const result = await GM.Search.fetchNearby({ lat: 35, lng: 135 });

  assert.equal(result.complete, false);
  assert.equal(result.errorCode, "ERR_PARTIAL");
  assert.equal(result.shops.length, 40);
});

test("通信エラーはエラーコードと識別番号を返す", async () => {
  const { GM } = loadApp(["config", "storage", "search"]);

  GM.Api = fakeApi(() => {
    const error = new Error("ERR_TIMEOUT");
    error.requestId = "abc";
    throw error;
  });

  const result = await GM.Search.fetchNearby({ lat: 35, lng: 135 });

  assert.equal(result.errorCode, "ERR_TIMEOUT");
  assert.equal(result.requestId, "abc");
  assert.equal(result.fetchedAt, null);
});

/* =================================
   保存データ（DATA-01〜06）
================================== */

test("初期データが正常", () => {
  const { Storage: S } = setup();

  assert.equal(S.validateData(S.defaultData()).schemaVersion, 1);
});

test("未対応の新しい形式を拒否", () => {
  const { Storage: S } = setup();

  const data = { ...S.defaultData(), schemaVersion: 999 };

  assert.throws(() => S.validateData(data), /ERR_STORAGE_VERSION/);
});

test("不正な設定値を拒否", () => {
  const { Storage: S } = setup();

  const data = S.defaultData();
  data.appSettings.theme = "invalid";
  assert.throws(() => S.validateData(data));

  const data2 = S.defaultData();
  data2.appSettings.interval = -1;
  assert.throws(() => S.validateData(data2));
});

test("許可されていない項目を除外（APIキー等）", () => {
  const { Storage: S } = setup();

  const data = { ...S.defaultData(), apiKey: "dummy" };

  assert.equal(Object.hasOwn(S.validateData(data), "apiKey"), false);
});

test("存在しない地点への参照を拒否", () => {
  const { Storage: S } = setup();

  const data = S.defaultData();

  data.appSettings.activeLocationId = "00000000-0000-0000-0000-000000000000";

  assert.throws(() => S.validateData(data));
});

test("座標の検証（範囲外・対象地域外）", () => {
  const { Storage: S } = setup();

  assert.equal(S.coordinateError(35.68, 139.76), null);
  assert.equal(S.coordinateError(91, 139), "ERR_COORD_RANGE");
  assert.equal(S.coordinateError(35, 181), "ERR_COORD_RANGE");
  assert.equal(S.coordinateError(Number.NaN, 139), "ERR_COORD_RANGE");
  assert.equal(S.coordinateError(51.5, -0.12), "ERR_COORD_AREA");
});

test("地点の登録・編集・切替・削除（関連プリセットも削除）", () => {
  const { Storage: S } = setup();

  const first = S.saveLocation({ label: "東京駅", lat: 35.681236, lng: 139.767125, source: "station" });
  const second = S.saveLocation({ label: "自宅", lat: 35.0, lng: 135.0, source: "manual" });

  // 新規登録時は選択中になる
  assert.equal(S.getActiveLocation().id, second.id);

  // 他の地点を編集しても選択中の地点は変わらない
  S.saveLocation({ id: first.id, label: "東京駅（丸の内）", lat: 35.681236, lng: 139.767125, source: "station" });
  assert.equal(S.getActiveLocation().id, second.id);
  assert.equal(S.getLocations()[0].label, "東京駅（丸の内）");

  S.selectLocation(first.id);
  S.savePreset(first.id, "ランチ", { ...S.defaultFilters(), conditions: ["lunch"] });
  S.saveFilters(first.id, { ...S.defaultFilters(), radiusM: 500 });

  assert.equal(S.countLocationRelations(first.id).presets, 1);

  S.deleteLocation(first.id);

  assert.equal(S.getLocations().length, 1);
  assert.equal(S.getPresets(first.id).length, 0);
  assert.equal(S.getActiveLocation().id, second.id);
});

test("地点名・座標の入力検証", () => {
  const { Storage: S } = setup();

  assert.throws(() => S.saveLocation({ label: " ", lat: 35, lng: 135 }), /ERR_INPUT/);
  assert.throws(() => S.saveLocation({ label: "海外", lat: 48.85, lng: 2.35 }), /ERR_COORD_AREA/);
});

test("同意は版が一致する場合のみ有効", () => {
  const { Storage: S } = setup();

  assert.equal(S.hasConsent(), false);

  S.acceptConsent();

  assert.equal(S.hasConsent(), true);
});

test("バックアップ：同意情報を含めず、復元時に既存データを優先（重複検出）", () => {
  const { Storage: S } = setup();

  S.acceptConsent();

  const location = S.saveLocation({ label: "職場", lat: 35.1, lng: 135.1 });

  const backup = S.createBackup();

  assert.equal(backup.consent, null);
  assert.equal(backup.app, "gourmet-map");

  const parsed = S.parseBackup(JSON.stringify(backup));

  const report = S.applyBackup(parsed, "merge");

  assert.equal(report.duplicates, 1);
  assert.equal(report.locations, 0);
  assert.equal(S.getLocations().length, 1);
  assert.equal(S.getLocations()[0].id, location.id);

  // 同意情報は端末のものを維持
  assert.equal(S.hasConsent(), true);
});

test("不正なバックアップは拒否し既存データを変更しない", () => {
  const { Storage: S } = setup();

  S.saveLocation({ label: "職場", lat: 35.1, lng: 135.1 });

  assert.throws(() => S.parseBackup("not json"), /ERR_BACKUP_FORMAT/);
  assert.throws(() => S.parseBackup(JSON.stringify({ app: "other", schemaVersion: 1 })), /ERR_BACKUP_FORMAT/);
  assert.throws(() => S.parseBackup(JSON.stringify({ ...S.defaultData(), locations: [{ id: "<script>" }] })), /ERR_BACKUP_FORMAT/);

  assert.equal(S.getLocations().length, 1);
});

test("項目別の初期化（DATA-02）", () => {
  const { Storage: S } = setup();

  const location = S.saveLocation({ label: "職場", lat: 35.1, lng: 135.1 });

  S.savePreset(location.id, "A", S.defaultFilters());
  S.saveFilters(location.id, { ...S.defaultFilters(), radiusM: 500 });
  S.updateSettings({ theme: "dark", interval: 5 });

  S.clearPresets();
  assert.equal(S.getPresets(location.id).length, 0);

  S.clearLastFilters();
  assert.equal(S.getFilters(location.id).radiusM, 3000);

  S.resetSettings();
  assert.equal(S.load().appSettings.theme, "system");
  assert.equal(S.load().appSettings.activeLocationId, location.id);
});

test("アプリ専用キーのみ削除（同一オリジンの他データは消さない）", () => {
  const { Storage: S, } = setup();
  const app = loadApp();

  app.localStorage.setItem("other-app", "keep");
  app.GM.Storage.saveLocation({ label: "職場", lat: 35.1, lng: 135.1 });
  app.GM.Storage.clear();

  assert.equal(app.localStorage.getItem("other-app"), "keep");
  assert.equal(app.localStorage.getItem("gourmet-map:v1"), null);
  assert.ok(S);
});

test("保存容量超過は ERR_STORAGE_FULL", () => {
  const app = loadApp();

  app.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };

  assert.throws(
    () => app.GM.Storage.saveLocation({ label: "職場", lat: 35.1, lng: 135.1 }),
    /ERR_STORAGE_FULL/,
  );
});

/* =================================
   API通信（SYS-03／PER-03）
================================== */

test("同意前は外部送信しない", async () => {
  const { GM } = loadApp();

  await assert.rejects(GM.Api.request("search", { lat: 35, lng: 135 }), /ERR_CONSENT/);
});

test("GASの応答 ok:false はエラーコードと識別番号を返す", async () => {
  const { GM } = loadApp(["config", "storage", "search", "api"], {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, errorCode: "ERR_RATE_LIMIT", requestId: "abc123" }),
    }),
  });

  GM.Storage.acceptConsent();

  await assert.rejects(GM.Api.request("search", {}), (error) => {
    assert.equal(error.message, "ERR_RATE_LIMIT");
    assert.equal(error.requestId, "abc123");
    return true;
  });
});

test("一時障害は再試行し、入力エラーは再試行しない", async () => {
  let calls = 0;

  const { GM } = loadApp(["config", "storage", "search", "api"], {
    fetch: async () => {
      calls++;

      return {
        ok: true,
        status: 200,
        json: async () =>
          calls < 2
            ? { ok: false, errorCode: "ERR_TEMPORARY" }
            : { ok: true, data: { value: 1 } },
      };
    },
  });

  GM.Storage.acceptConsent();

  const data = await GM.Api.request("search", {});

  assert.deepEqual({ ...data }, { value: 1 });
  assert.equal(calls, 2);

  // 入力エラーは1回で終了
  calls = 0;

  const { GM: GM2 } = loadApp(["config", "storage", "search", "api"], {
    fetch: async () => {
      calls++;

      return { ok: true, status: 200, json: async () => ({ ok: false, errorCode: "ERR_INPUT" }) };
    },
  });

  GM2.Storage.acceptConsent();

  await assert.rejects(GM2.Api.request("search", {}), /ERR_INPUT/);
  assert.equal(calls, 1);
});
