/**
 * GAS（サーバー側）の結合テスト：外部APIは模擬応答を使用し、実APIへ負荷をかけない
 * 実行：node --test test/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadGas } = require("./helpers.js");

const PROPS = {
  HOTPEPPER_API_KEY: "test-hotpepper-key",
  GEOAPIFY_API_KEY: "test-geoapify-key",
  SPREADSHEET_ID: "dummy",
};

function hotpepperPage(start, total, count) {
  const shops = [];

  for (let i = 0; i < count; i++) {
    const n = start + i;

    shops.push({
      id: `J${String(n).padStart(9, "0")}`,
      name: `店舗${n}`,
      name_kana: `テンポ${n}`,
      genre: { name: "居酒屋" },
      catch: "キャッチ",
      address: "東京都千代田区",
      lat: "35.6812",
      lng: "139.7671",
      open: "11:00～23:00",
      close: "日",
      budget: { average: "3000円" },
      station_name: "東京",
      access: "徒歩1分",
      lunch: "あり",
      card: "利用可",
      credit_card: [
        { code: "c01", name: "VISA" },
        { code: "c02", name: "JCB" },
        { code: "c01", name: "VISA" },
        { code: "c03", name: "" },
      ],
      budget_memo: "お通し代300円",
      party_capacity: 30,
      course: "あり",
      charter: "貸切可",
      tatami: "なし",
      horigotatsu: "なし",
      midnight: "営業している",
      english: "なし",
      pet: "不可",
      other_memo: "プロジェクターあり",
      shop_detail_memo: "メモ",
      coupon_urls: { pc: "https://www.hotpepper.jp/strJ000000001/map/", sp: "https://evil.example.com/" },
      parking: "なし",
      non_smoking: "全面禁煙",
      barrier_free: "なし",
      capacity: 40,
      private_room: "あり",
      wifi: "あり",
      child: "お子様連れ歓迎",
      free_drink: "あり",
      free_food: "なし",
      urls: { pc: "https://www.hotpepper.jp/strJ000000001/" },
      photo: { pc: { l: "https://imgfp.hotp.jp/a.jpg", m: "https://imgfp.hotp.jp/b.jpg", s: "javascript:alert(1)" } },
      secret_field: "除外されるべき項目",
    });
  }

  return {
    results: {
      results_available: total,
      results_returned: String(count),
      results_start: start,
      shop: shops,
    },
  };
}

function post(gas, body) {
  const output = gas.doPost({ postData: { contents: JSON.stringify(body) } });

  return JSON.parse(output.text);
}

test("許可されていない操作は拒否（SYS-01）", () => {
  const { gas } = loadGas({ properties: PROPS });

  const result = post(gas, { action: "admin" });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "ERR_INPUT");
  assert.match(result.requestId, /^[0-9a-f]{12}$/);
});

test("座標・ページ位置を検証（SEC-02）", () => {
  const { gas, fetched } = loadGas({ properties: PROPS });

  assert.equal(post(gas, { action: "search", lat: 51.5, lng: -0.1, start: 1 }).errorCode, "ERR_INPUT");
  assert.equal(post(gas, { action: "search", lat: "35", lng: 139, start: 1 }).errorCode, "ERR_INPUT");
  assert.equal(post(gas, { action: "search", lat: 35.6, lng: 139.7, start: 2 }).errorCode, "ERR_INPUT");
  assert.equal(fetched.length, 0);
});

test("検索：range=5・count=100・datum=world、項目は許可リストで返却", () => {
  const { gas, fetched } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 150, 100)) }),
  });

  const result = post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.data.total, 150);
  assert.equal(result.data.returned, 100);
  assert.equal(result.data.limitReached, true);
  // complete は単回取得の成否（SYS-03）
  assert.equal(result.data.complete, true);
  assert.equal(result.complete, true);
  assert.equal(result.total, 150);
  assert.equal(result.limitReached, true);
  assert.equal(result.data.shops.length, 100);

  const shop = result.data.shops[0];

  assert.equal(shop.genre, "居酒屋");
  assert.equal(shop.budget, "3000円");
  assert.equal(shop.nonSmoking, "全面禁煙");
  assert.equal(Object.hasOwn(shop, "secret_field"), false);
  assert.deepEqual(shop.photos, ["https://imgfp.hotp.jp/a.jpg", "https://imgfp.hotp.jp/b.jpg"]);
  // 利用できるカードの種類（重複・空は除外）
  assert.deepEqual(shop.creditCards, ["VISA", "JCB"]);
  assert.equal(shop.card, "利用可");
  assert.equal(shop.budgetMemo, "お通し代300円");
  assert.equal(shop.partyCapacity, "30");
  assert.equal(shop.charter, "貸切可");
  assert.equal(shop.midnight, "営業している");
  // クーポンURLはホットペッパーのドメインのみ（sp が不正なら pc を採用）
  assert.equal(shop.couponUrl, "https://www.hotpepper.jp/strJ000000001/map/");
  // 電話番号はAPIの返却項目にないため持たない
  assert.equal(Object.hasOwn(shop, "tel"), false);

  assert.match(fetched[0], /range=5/);
  assert.match(fetched[0], /count=100/);
  assert.match(fetched[0], /datum=world/);
  assert.match(fetched[0], /format=json/);
  assert.doesNotMatch(fetched[0], /type=lite/);
  assert.match(fetched[0], /type=credit_card/);

  // APIキーは応答に含まれない
  assert.doesNotMatch(JSON.stringify(result), /test-hotpepper-key/);
});

test("キャッシュは分割保存され、元の取得時刻を維持（PER-01／API-05）", () => {
  const { gas, fetched } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 100, 100)) }),
  });

  const first = post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });
  const second = post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  assert.equal(fetched.length, 1);
  assert.equal(second.data.cached, true);
  assert.equal(second.data.fetchedAt, first.data.fetchedAt);
  assert.equal(second.data.complete, true);
});

test("キャッシュの欠落時は再取得", () => {
  const { gas, fetched, cache } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 100, 100)) }),
  });

  post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  // 分割された一部を削除
  const chunkKey = [...cache.keys()].find((key) => /^hp:.*:1$/.test(key));

  assert.ok(chunkKey, "複数チャンクに分割されている");

  cache.delete(chunkKey);

  post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  assert.equal(fetched.length, 2);
});

test("座標はキャッシュキーに平文で残さない", () => {
  const { gas, cache } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 1, 1)) }),
  });

  post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  assert.ok([...cache.keys()].every((key) => !key.includes("35.68")));
});

test("日次予算に達したら ERR_RATE_LIMIT（SEC-05）", () => {
  const { gas } = loadGas({
    properties: { ...PROPS, DAILY_API_LIMIT: "1" },
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 300, 100)) }),
  });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671 }).ok, true);
  assert.equal(post(gas, { action: "search", lat: 35.6, lng: 139.7 }).errorCode, "ERR_RATE_LIMIT");
});

test("停止フラグで全機能を停止", () => {
  const { gas } = loadGas({ properties: { ...PROPS, SERVICE_STOPPED: "true" } });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 }).errorCode, "ERR_MAINTENANCE");
});

test("提供元のエラー・障害を分類", () => {
  const { gas } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify({ results: { error: [{ code: 2000 }] } }) }),
  });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 }).errorCode, "ERR_CONFIG");

  const down = loadGas({ properties: PROPS, fetch: () => ({ status: 503, body: "" }) });

  assert.equal(post(down.gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 }).errorCode, "ERR_TEMPORARY");
});

test("住所検索：日本国内に限定し、駅名は「駅」を補完", () => {
  const { gas, fetched } = loadGas({
    properties: PROPS,
    fetch: () => ({
      status: 200,
      body: JSON.stringify({
        results: [
          { name: "東京駅", formatted: "東京駅, 千代田区, 東京都", lat: 35.681, lon: 139.767 },
          { name: "海外", formatted: "London", lat: 51.5, lon: -0.1 },
        ],
      }),
    }),
  });

  const result = post(gas, { action: "geocode", query: "東京", mode: "station" });

  assert.equal(result.ok, true);
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.candidates[0].source, "station");
  assert.match(decodeURIComponent(fetched[0]), /text=東京駅/);
  assert.match(fetched[0], /countrycode%3Ajp/);
});

test("お気に入りは既定で無効、IDは20件まで（FAV-02）", () => {
  const { gas } = loadGas({ properties: PROPS });

  assert.equal(post(gas, { action: "favorites", ids: ["J000000001"] }).errorCode, "ERR_DISABLED");
});

test("GETは状態確認のみ（監視用）", () => {
  const { gas } = loadGas({ properties: PROPS });

  const result = JSON.parse(gas.doGet().text);

  assert.equal(result.ok, true);
  assert.equal(result.data.service, "Gourmet Map API");
  assert.equal(result.data.favoritesEnabled, false);
});

/* =================================
   旧版の Script Properties との互換
================================== */

test("旧版：API_ENABLED=false でメンテナンス扱い", () => {
  const { gas } = loadGas({ properties: { ...PROPS, API_ENABLED: "false" } });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 }).errorCode, "ERR_MAINTENANCE");
  assert.equal(JSON.parse(gas.doGet().text).data.status, "maintenance");
});

test("旧版：API_ENABLED=true・FAVORITES_ENABLED・PUBLIC_NOTICE を反映", () => {
  const { gas } = loadGas({
    properties: { ...PROPS, API_ENABLED: "true", FAVORITES_ENABLED: "true", PUBLIC_NOTICE: "メンテナンス予定のお知らせ" },
  });

  const status = JSON.parse(gas.doGet().text).data;

  assert.equal(status.status, "online");
  assert.equal(status.favoritesEnabled, true);
  assert.equal(status.notices[0].body, "メンテナンス予定のお知らせ");
});

test("旧版：CACHE_ENABLED=false ではキャッシュしない", () => {
  const { gas, fetched } = loadGas({
    properties: { ...PROPS, CACHE_ENABLED: "false" },
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 1, 1)) }),
  });

  post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });
  post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 1 });

  assert.equal(fetched.length, 2);
});

test("2ページ目以降は要求できない（1検索1回・最大100件）", () => {
  const { gas, fetched } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 300, 100)) }),
  });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671, start: 101 }).errorCode, "ERR_INPUT");
  assert.equal(fetched.length, 0);

  const result = post(gas, { action: "search", lat: 35.6812, lng: 139.7671 });

  assert.equal(result.data.shops.length, 100);
  assert.equal(result.data.total, 300);
  assert.match(fetched[0], /start=1(&|$)/);
});

test("提供元の応答の開始位置が要求と異なる場合は異常", () => {
  const { gas } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(101, 300, 100)) }),
  });

  assert.equal(post(gas, { action: "search", lat: 35.6812, lng: 139.7671 }).errorCode, "ERR_API");
});

/* =================================
   改定要件（2026/11/26）・設定値の解釈
================================== */

test("日次上限の初期値は100（101回目の実呼出を防止）", () => {
  const { gas, fetched } = loadGas({
    properties: PROPS,
    fetch: () => ({ status: 200, body: JSON.stringify(hotpepperPage(1, 1, 1)) }),
  });

  for (let i = 0; i < 100; i++) {
    assert.equal(post(gas, { action: "search", lat: 35 + i * 0.001, lng: 139.7 }).ok, true);
  }

  assert.equal(post(gas, { action: "search", lat: 36, lng: 139.7 }).errorCode, "ERR_RATE_LIMIT");
  assert.equal(fetched.length, 100);
});

test("フラグ値の表記ゆれ（有効・ TRUE ・空白）を解釈し、誤ってメンテナンスにしない", () => {
  const { gas } = loadGas({ properties: { ...PROPS, API_ENABLED: " TRUE ", SERVICE_STOPPED: "" } });

  assert.equal(JSON.parse(gas.doGet().text).data.status, "online");
  assert.equal(gas.parseFlag_("有効"), true);
  assert.equal(gas.parseFlag_("無効"), false);
  assert.equal(gas.parseFlag_(""), null);
  assert.equal(gas.parseFlag_("abc"), null);
});

test("停止の原因を判定できる（診断用）", () => {
  assert.equal(loadGas({ properties: { ...PROPS, API_ENABLED: "false" } }).gas.stopReason_(), "API_ENABLED");
  assert.equal(loadGas({ properties: { ...PROPS, SERVICE_STOPPED: "true" } }).gas.stopReason_(), "SERVICE_STOPPED");
  assert.equal(loadGas({ properties: PROPS }).gas.stopReason_(), null);
});
