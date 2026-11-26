/**
 * テスト用ヘルパー（Node.js 標準機能のみ使用。npm 不要）
 * ブラウザ用スクリプトを vm で読み込み、LocalStorage 等を模擬する。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function createLocalStorage() {
  const store = new Map();

  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    _store: store,
  };
}

/**
 * フロントエンドのスクリプトを読み込んだ window を返す
 */
function loadApp(files = ["config", "storage", "search", "api"], overrides = {}) {
  const localStorage = createLocalStorage();

  const window = {
    localStorage,
    navigator: { onLine: true },
    ...overrides,
  };

  const context = vm.createContext({
    window,
    localStorage,
    navigator: window.navigator,
    crypto: globalThis.crypto,
    structuredClone: globalThis.structuredClone,
    Intl,
    URL,
    Blob: globalThis.Blob,
    DOMException: globalThis.DOMException,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    fetch: overrides.fetch || (() => Promise.reject(new TypeError("offline"))),
  });

  for (const name of files) {
    const file = path.join(ROOT, "js", `${name}.js`);

    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }

  return { GM: window.GourmetMap, window, localStorage, context };
}

/**
 * GASスクリプトを模擬サービス上で読み込む
 */
function loadGas(mocks = {}) {
  const properties = new Map(Object.entries(mocks.properties || {}));
  const cache = new Map();

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
      setProperty: (key, value) => properties.set(key, String(value)),
      setProperties: (values) => {
        for (const [key, value] of Object.entries(values)) properties.set(key, String(value));
      },
      deleteProperty: (key) => properties.delete(key),
      getProperties: () => Object.fromEntries(properties),
    }),
  };

  const CacheService = {
    getScriptCache: () => ({
      get: (key) => (cache.has(key) ? cache.get(key) : null),
      put: (key, value) => cache.set(key, String(value)),
      putAll: (values) => {
        for (const [key, value] of Object.entries(values)) cache.set(key, String(value));
      },
      getAll: (keys) => Object.fromEntries(keys.filter((key) => cache.has(key)).map((key) => [key, cache.get(key)])),
      remove: (key) => cache.delete(key),
    }),
  };

  const fetched = [];

  const UrlFetchApp = {
    fetch: (url) => {
      fetched.push(url);

      const result = mocks.fetch ? mocks.fetch(url) : { status: 200, body: "{}" };

      return {
        getResponseCode: () => result.status,
        getContentText: () => result.body,
      };
    },
  };

  const LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      waitLock: () => undefined,
      releaseLock: () => undefined,
    }),
  };

  const crypto = require("node:crypto");

  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    formatDate: (date) => date.toISOString().slice(0, 10),
    DigestAlgorithm: { SHA_256: "sha256" },
    computeDigest: (algorithm, text) => [...crypto.createHash("sha256").update(text).digest()].map((byte) => (byte > 127 ? byte - 256 : byte)),
  };

  const ContentService = {
    MimeType: { JSON: "json" },
    createTextOutput: (text) => ({
      text,
      setMimeType() {
        return this;
      },
    }),
  };

  const SpreadsheetApp = {
    openById: () => {
      throw new Error("ERR_CONFIG");
    },
  };

  const context = vm.createContext({
    PropertiesService,
    CacheService,
    UrlFetchApp,
    LockService,
    Utilities,
    ContentService,
    SpreadsheetApp,
    MailApp: { getRemainingDailyQuota: () => 0 },
    console: { warn() {}, log() {} },
  });

  for (const name of ["Code.gs", "Operations.gs"]) {
    const file = path.join(ROOT, "gas", name);

    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }

  return { gas: context, properties, cache, fetched };
}

module.exports = { loadApp, loadGas, createLocalStorage };
