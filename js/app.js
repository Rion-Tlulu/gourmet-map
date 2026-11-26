(function (GM) {
  "use strict";

  const C = GM.Config;
  const S = GM.Storage;
  const A = GM.Api;
  const Q = GM.Search;
  const M = GM.Map;
  const UI = GM.UI;

  const { el, icon } = UI;

  const $ = (id) => document.getElementById(id);

  /* ====================================
       00. 定数
    ==================================== */

  // 画面ID（SCR）とページ名
  const PAGES = Object.freeze({
    home: "ホーム",
    results: "検索結果",
    favorites: "お気に入り",
    locations: "登録地点の管理",
    presets: "検索条件のプリセット",
    settings: "設定",
    data: "データ管理",
    status: "お知らせ・システムステータス",
    help: "ヘルプ・FAQ",
    terms: "利用規約",
    privacy: "プライバシーポリシー",
    licenses: "外部サービス・ライセンス",
    about: "このアプリについて",
  });

  const SOURCE_META = Object.freeze({
    address: { icon: "house", label: "住所" },
    geocoding: { icon: "house", label: "住所" },
    station: { icon: "train-subway", label: "駅名" },
    gps: { icon: "location-crosshairs", label: "現在地" },
    map: { icon: "map-location-dot", label: "地図" },
    manual: { icon: "keyboard", label: "緯度・経度" },
  });

  const FEATURE_ICONS = Object.freeze({
    lunch: "utensils",
    card: "credit-card",
    parking: "square-parking",
    nonSmoking: "ban-smoking",
    barrierFree: "wheelchair",
    privateRoom: "door-closed",
    wifi: "wifi",
    child: "children",
    freeFood: "bowl-food",
    softDrinkPlan: "glass-water",
  });

  const ERROR_MESSAGES = Object.freeze({
    ERR_NETWORK:
      "サーバーに接続できませんでした。通信状況を確認して再試行してください。解消しない場合はシステムステータスをご確認ください。",
    ERR_OFFLINE: "オフラインです。インターネット接続を確認してください。",
    ERR_TIMEOUT: "通信がタイムアウトしました。時間をおいて再試行してください。",
    ERR_RATE_LIMIT:
      "利用回数の上限に達したため、取得を一時停止しました。時間をおいて再試行してください。",
    ERR_BUSY: "現在アクセスが集中しています。しばらくしてから再試行してください。",
    ERR_TEMPORARY: "サーバーで一時的な障害が発生しています。時間をおいて再試行してください。",
    ERR_API: "店舗情報サービスから正しい応答を取得できませんでした。",
    ERR_CONFIG: "サーバーの接続設定が完了していないため、現在は利用できません。",
    ERR_PARTIAL: "店舗情報の一部のみ取得しました。取得済みの範囲で表示しています。",
    ERR_INPUT: "入力内容を確認してください。",
    ERR_LOCATION: "地点を取得できませんでした。別の登録方法をお試しください。",
    ERR_COORD_RANGE: "緯度は-90〜90、経度は-180〜180の数値で入力してください。",
    ERR_COORD_AREA: "日本国内の地点を指定してください（対象地域外です）。",
    ERR_GPS_DENIED:
      "位置情報の利用が許可されていません。住所・駅名・地図・緯度経度から登録してください。",
    ERR_GPS_UNAVAILABLE:
      "現在地を取得できませんでした。住所・駅名・地図などから登録してください。",
    ERR_GPS_TIMEOUT:
      "現在地の取得がタイムアウトしました。再試行するか、別の方法で登録してください。",
    ERR_GPS_UNSUPPORTED:
      "この端末・ブラウザでは現在地を取得できません。別の方法で登録してください。",
    ERR_STORAGE: "保存データを処理できませんでした。",
    ERR_STORAGE_FULL:
      "端末の保存容量が不足しています。不要なプリセットや地点を削除するか、バックアップ後にデータを整理してください。",
    ERR_STORAGE_UNAVAILABLE:
      "ブラウザの設定により端末にデータを保存できません。保存を許可するか、通常のウィンドウでご利用ください。",
    ERR_STORAGE_VERSION:
      "このアプリより新しい形式のデータのため読み込めません。アプリを最新版に更新してください。",
    ERR_BACKUP_FORMAT:
      "バックアップファイルの形式が正しくありません。既存データは変更していません。",
    ERR_BACKUP_SIZE: "ファイルサイズが大きすぎます（5MBまで）。",
    ERR_CONSENT: "利用規約への同意が必要です。",
    ERR_MAINTENANCE: "現在メンテナンス中のため利用できません。",
    ERR_DISABLED: "この機能は現在利用できません。",
    ERR_MAP: "地図を表示できません。一覧表示や座標入力をご利用ください。",
    ERR_SHARE: "共有できませんでした。リンクをコピーしてご利用ください。",
  });

  const RETRYABLE_ERRORS = Object.freeze([
    "ERR_NETWORK",
    "ERR_TIMEOUT",
    "ERR_BUSY",
    "ERR_TEMPORARY",
    "ERR_API",
    "ERR_PARTIAL",
    "ERR_OFFLINE",
  ]);

  // 自動更新を止めるエラー（API-06／ERR_RATE_LIMIT）
  const PAUSE_ERRORS = Object.freeze([
    "ERR_RATE_LIMIT",
    "ERR_MAINTENANCE",
    "ERR_DISABLED",
    "ERR_CONFIG",
  ]);

  const GENRE_VISIBLE_COUNT = 9;

  /* ====================================
       01. 状態
    ==================================== */

  const state = {
    page: "home",
    view: "list",

    shops: [],
    result: null,
    filtered: [],
    filters: S.defaultFilters(),
    visibleCount: C.DISPLAY_COUNT,

    locationKey: null,

    loading: false,
    progress: null,
    loadError: null,
    controller: null,
    generation: 0,
    lastAttempt: 0,
    refreshPaused: false,

    favoriteShops: [],
    favoriteResult: null,
    favoriteGenre: null,
    favoriteController: null,
    favoriteGeneration: 0,
    favoriteLoading: false,

    serverStatus: null,
    serverFavoritesEnabled: false,

    editingLocationId: null,
    selectedCandidate: null,
    autoName: "",
    locationMethod: "address",
    locationGeneration: 0,
    locationController: null,

    draft: null,
    genreExpanded: false,

    currentShop: null,
    shopFavoriteChanged: false,

    consentStep: 1,

    previewShopId: null,
  };

  const themeMedia = matchMedia("(prefers-color-scheme: dark)");
  const wideMedia = matchMedia("(min-width: 1024px)");

  /* ====================================
       02. 共通処理
    ==================================== */

  function errorCode(error) {
    return /^ERR_[A-Z_]+$/.test(error?.message) ? error.message : "ERR_UNKNOWN";
  }

  // エラーコード・識別番号を案内し、内部情報は表示しない
  function errorText(error) {
    const code = errorCode(error);

    const message =
      ERROR_MESSAGES[code] || "処理に失敗しました。時間をおいて再試行してください。";

    const ids = [`エラーコード：${code}`];

    if (error?.requestId) {
      ids.push(`識別番号：${error.requestId}`);
    }

    return `${message}（${ids.join("／")}）`;
  }

  function makeError(code, requestId) {
    const error = new Error(code);

    if (requestId) error.requestId = requestId;

    return error;
  }

  function showError(message, options = {}) {
    $("app-error-text").textContent = message;

    const actions = $("app-error-actions");

    actions.replaceChildren();

    if (options.retry) {
      actions.append(
        el(
          "button",
          {
            className: "gm-btn gm-btn-outline gm-btn-sm",
            attrs: { type: "button" },
            on: {
              click: () => {
                clearError();
                run(options.retry);
              },
            },
          },
          icon("rotate"),
          options.retryLabel || "再試行",
        ),
      );
    }

    if (options.action) {
      actions.append(options.action);
    }

    actions.hidden = !actions.childElementCount;

    $("app-error").hidden = false;
  }

  function clearError() {
    $("app-error").hidden = true;
    $("app-error-text").textContent = "";
    $("app-error-actions").replaceChildren();
  }

  function setFieldMessage(id, message, isError = false) {
    const node = $(id);

    node.textContent = message;
    node.classList.toggle("gm-error-text", isError);
    node.classList.toggle("gm-help", !isError);
  }

  async function run(handler) {
    try {
      return await handler();
    } catch (error) {
      if (error?.name === "AbortError") return;

      if (errorCode(error) === "ERR_UNKNOWN") {
        console.error(error);
      }

      if (errorCode(error) === "ERR_CONSENT") {
        openConsent();
        return;
      }

      const message = errorText(error);

      if (UI.isOpen("location-modal")) {
        setFieldMessage("location-message", message, true);
      } else if (UI.isOpen("shop-modal")) {
        $("shop-message").textContent = message;
      } else {
        showError(message);
        UI.toast(ERROR_MESSAGES[errorCode(error)] || "処理に失敗しました。", "danger");
      }
    }
  }

  function locationKey(location) {
    return location ? `${location.id}:${location.lat}:${location.lng}` : null;
  }

  function favoriteEnabled() {
    return C.FAVORITES_ENABLED && state.serverFavoritesEnabled;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  // JST、YYYY/MM/DD HH:mm:ss（API-05）
  function formatDate(value) {
    const time = Date.parse(value);

    if (!Number.isFinite(time)) return "未取得";

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(time))
        .map((part) => [part.type, part.value]),
    );

    return `${parts.year}/${pad(parts.month)}/${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
  }

  function dataAge() {
    const time = Date.parse(state.result?.fetchedAt);

    return Number.isFinite(time) ? Date.now() - time : Infinity;
  }

  function hasValidData() {
    return Boolean(state.result) && dataAge() < C.DATA_TTL_MS;
  }

  function hasFreshData() {
    return Boolean(state.result) && dataAge() < C.REUSE_TTL_MS;
  }

  function cloneFilters(filters) {
    return {
      ...filters,
      genreNames: filters.genreNames === null ? null : [...filters.genreNames],
      conditions: [...filters.conditions],
    };
  }

  function afterModalHidden(id) {
    return new Promise((resolve) => {
      const node = $(id);

      if (!node.classList.contains("show")) {
        resolve();
        return;
      }

      node.addEventListener("hidden.bs.modal", () => resolve(), { once: true });

      UI.hideModal(id);
    });
  }

  /* ====================================
       03. 外部URL・画像（SEC-03）
    ==================================== */

  function safeUrl(value, domains) {
    try {
      const url = new URL(value);

      const allowed = domains.some(
        (domain) => url.hostname === domain || url.hostname.endsWith("." + domain),
      );

      if (url.protocol !== "https:" || !allowed || url.username || url.password || url.port) {
        return null;
      }

      return url.href;
    } catch {
      return null;
    }
  }

  function shopUrl(shop) {
    return safeUrl(shop?.url, C.SHOP_URL_DOMAINS);
  }

  // 店舗座標のみを渡す（SH-02／PRV-03）
  function googleMapsUrl(shop) {
    if (!Number.isFinite(shop.lat) || !Number.isFinite(shop.lng)) return null;

    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(`${shop.lat},${shop.lng}`)
    );
  }

  // 画像：大→中→小→代替画像（画像欠損）
  function shopImage(shop, variant = "card") {
    const wrapper = el("figure", { className: `gm-shop-photo gm-shop-photo-${variant}` });

    const image = el("img", {
      attrs: {
        alt: variant === "card" ? "" : `${shop.name || "店舗"}の写真`,
        loading: variant === "card" ? "lazy" : "eager",
        decoding: "async",
        referrerpolicy: "no-referrer",
      },
    });

    const sources = (shop.photos || [])
      .map((url) => safeUrl(url, C.IMAGE_DOMAINS))
      .filter(Boolean);

    let index = 0;

    function next() {
      if (index < sources.length) {
        image.src = sources[index++];
        return;
      }

      image.removeEventListener("error", next);
      image.src = "./assets/images/no-image.svg";

      if (variant !== "card") image.alt = "店舗画像なし";

      credit.hidden = true;
    }

    const credit = el("figcaption", { text: "画像提供：ホットペッパー グルメ" });

    image.addEventListener("error", next);

    next();

    wrapper.append(image, credit);

    return wrapper;
  }

  function externalLink(label, href, iconName, className = "gm-btn gm-btn-outline") {
    return el(
      "a",
      {
        className,
        attrs: {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      },
      icon(iconName),
      label,
      UI.srOnly("（新しいタブで開く）"),
    );
  }

  /* ====================================
       04. 画面切替（ハッシュルーティング）
    ==================================== */

  function currentHash() {
    return decodeURIComponent(location.hash.slice(1)) || "home";
  }

  function updateNav() {
    document.querySelectorAll("[data-nav]").forEach((node) => {
      const target = node.dataset.nav;

      let active;

      if (node.closest(".gm-desktop-nav")) {
        active = target === state.page;
      } else if (target === "map") {
        active = state.page === "results" && state.view === "map";
      } else if (target === "results") {
        active = state.page === "results" && state.view === "list";
      } else {
        active = target === state.page;
      }

      if (active) {
        node.setAttribute("aria-current", "page");
      } else {
        node.removeAttribute("aria-current");
      }
    });
  }

  function navigate(target, options = {}) {
    let page = target;

    if (page === "map") {
      state.view = "map";
      page = "results";
    } else if (page === "results" || page === "list") {
      state.view = "list";
      page = "results";
    }

    if (!Object.hasOwn(PAGES, page)) {
      page = "home";
    }

    const changed = state.page !== page;

    state.page = page;

    document.querySelectorAll(".gm-page").forEach((section) => {
      section.hidden = section.id !== `page-${page}`;
    });

    document.title = `${PAGES[page]} | グルメマップ`;

    updateNav();

    UI.hideOffcanvas("filter-sheet");

    if (page !== "results") {
      M.hideRestaurants();
    }

    switch (page) {
      case "home":
        renderHome();
        break;
      case "results":
        renderResults();
        break;
      case "locations":
        renderLocations();
        break;
      case "favorites":
        run(loadFavorites);
        break;
      case "presets":
        renderPresets();
        break;
      case "settings":
        renderSettings();
        break;
      case "data":
        renderData();
        break;
      case "status":
        renderStatus();
        if (!state.serverStatus) run(() => checkSystemStatus());
        break;
      case "about":
        renderAbout();
        break;
      default:
        break;
    }

    if (options.focus !== false && changed) {
      const heading = document.querySelector(`#page-${page} h1`);

      window.scrollTo({ top: 0, behavior: "instant" });

      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }

      UI.announce(`${PAGES[page]}を表示しました`);
    }
  }

  function go(page) {
    const hash = "#" + page;

    if (location.hash !== hash) {
      location.hash = hash;
    } else {
      navigate(page);
    }
  }

  /* ====================================
       05. 初回利用・規約同意（SCR-01／LEGAL-01）
    ==================================== */

  function setConsentStep(step) {
    state.consentStep = step;

    document.querySelectorAll("#consent-modal .gm-step").forEach((node) => {
      node.hidden = Number(node.dataset.step) !== step;
    });

    document.querySelectorAll("#consent-modal [data-dot]").forEach((node) => {
      const current = Number(node.dataset.dot) === step;

      node.classList.toggle("is-active", current);

      if (current) {
        node.setAttribute("aria-current", "step");
      } else {
        node.removeAttribute("aria-current");
      }
    });

    $("consent-next").hidden = step >= 4;
    $("accept-consent").hidden = step < 4;
    $("consent-back").hidden = step <= 1;
    $("consent-skip").hidden = step >= 4;

    $("consent-progress").textContent = `ステップ${step} / 4`;

    const heading = document.querySelector(`#consent-modal .gm-step[data-step="${step}"] h3`);

    if (heading && UI.isOpen("consent-modal")) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }

  function openConsent() {
    if (UI.isOpen("consent-modal")) return;

    $("consent-checkbox").checked = false;
    $("accept-consent").disabled = true;

    setConsentStep(1);

    UI.showModal("consent-modal");
  }

  async function acceptConsent() {
    if (!$("consent-checkbox").checked) return;

    S.acceptConsent();

    await afterModalHidden("consent-modal");

    UI.toast("ご利用ありがとうございます。まずは地点を登録しましょう。", "success");

    run(() => checkSystemStatus({ silent: true }));

    if (!S.getActiveLocation()) {
      openLocationEditor();
    } else {
      await changeLocation();
    }
  }

  function requireConsent() {
    if (S.hasConsent()) return true;

    openConsent();

    return false;
  }

  /* ====================================
       06. 地点の表示（SCR-02／SCR-07）
    ==================================== */

  function sourceMeta(source) {
    return SOURCE_META[source] || SOURCE_META.manual;
  }

  function locationSummary(item) {
    return item.address || `緯度 ${item.lat} / 経度 ${item.lng}`;
  }

  function renderLocationSelect() {
    const data = S.load();
    const select = $("location-select");

    select.replaceChildren();

    const empty = !data.locations.length;

    select.disabled = empty;

    $("home-no-location").hidden = !empty;

    if (empty) {
      select.append(new Option("地点を登録してください", ""));
      return;
    }

    for (const item of data.locations) {
      const option = new Option(item.label, item.id);

      option.selected = item.id === data.appSettings.activeLocationId;

      select.append(option);
    }
  }

  function renderHeaderLocations() {
    const data = S.load();
    const active = data.locations.find((item) => item.id === data.appSettings.activeLocationId);

    $("header-location-label").textContent = active?.label || "地点未登録";

    const menu = $("header-location-menu");

    menu.replaceChildren();

    for (const item of data.locations) {
      const isActive = item.id === active?.id;

      menu.append(
        el(
          "li",
          {},
          el(
            "button",
            {
              className: "dropdown-item",
              attrs: {
                type: "button",
                "aria-current": isActive ? "true" : null,
              },
              on: { click: () => run(() => selectLocation(item.id)) },
            },
            icon(isActive ? "check" : sourceMeta(item.source).icon, "solid", "gm-dropdown-icon"),
            item.label,
          ),
        ),
      );
    }

    if (data.locations.length) {
      menu.append(el("li", {}, el("hr", { className: "dropdown-divider" })));
    }

    menu.append(
      el(
        "li",
        {},
        el(
          "button",
          {
            className: "dropdown-item",
            attrs: { type: "button" },
            on: { click: () => run(() => openLocationEditor()) },
          },
          icon("plus", "solid", "gm-dropdown-icon"),
          "新しい地点を登録",
        ),
      ),
      el(
        "li",
        {},
        el(
          "a",
          { className: "dropdown-item", attrs: { href: "#locations" } },
          icon("list", "solid", "gm-dropdown-icon"),
          "登録地点の管理",
        ),
      ),
    );
  }

  function renderHomeLocations() {
    const data = S.load();
    const list = $("home-location-list");

    list.replaceChildren();

    if (!data.locations.length) {
      list.append(
        el(
          "li",
          { className: "gm-inline-empty" },
          el("p", { className: "tw-m-0", text: "登録した場所はまだありません。" }),
          el(
            "button",
            {
              className: "gm-btn gm-btn-outline gm-btn-sm",
              attrs: { type: "button" },
              on: { click: (event) => run(() => openLocationEditor(null, event.currentTarget)) },
            },
            icon("plus"),
            "地点を登録",
          ),
        ),
      );

      return;
    }

    for (const item of data.locations.slice(0, 5)) {
      const isActive = item.id === data.appSettings.activeLocationId;

      const menuId = `home-location-menu-${item.id}`;

      list.append(
        el(
          "li",
          { className: "gm-list-item" },
          el(
            "button",
            {
              className: "gm-list-main",
              attrs: {
                type: "button",
                "aria-current": isActive ? "true" : null,
              },
              on: {
                click: () =>
                  run(async () => {
                    await selectLocation(item.id);
                  }),
              },
            },
            el("span", { className: "gm-list-icon" }, icon("location-dot")),
            el(
              "span",
              { className: "tw-min-w-0 tw-flex-1 tw-text-left" },
              el("span", { className: "gm-list-title", text: item.label }),
              el("span", { className: "gm-list-sub", text: locationSummary(item) }),
            ),
            isActive ? el("span", { className: "gm-badge gm-badge-soft", text: "選択中" }) : null,
          ),
          el(
            "div",
            { className: "dropdown" },
            el(
              "button",
              {
                className: "gm-icon-btn",
                attrs: {
                  type: "button",
                  "data-bs-toggle": "dropdown",
                  "aria-expanded": "false",
                  "aria-label": `「${item.label}」の操作`,
                  id: menuId,
                },
              },
              icon("ellipsis"),
            ),
            el(
              "ul",
              {
                className: "dropdown-menu dropdown-menu-end gm-dropdown",
                attrs: { "aria-labelledby": menuId },
              },
              el(
                "li",
                {},
                el(
                  "button",
                  {
                    className: "dropdown-item",
                    attrs: { type: "button" },
                    on: {
                      click: () =>
                        run(async () => {
                          await selectLocation(item.id, { showResults: true });

                          if (!state.result && !state.loading) await fetchRestaurants();
                        }),
                    },
                  },
                  icon("magnifying-glass", "solid", "gm-dropdown-icon"),
                  "この地点で探す",
                ),
              ),
              el(
                "li",
                {},
                el(
                  "button",
                  {
                    className: "dropdown-item",
                    attrs: { type: "button" },
                    on: { click: () => run(() => openLocationEditor(item, $(menuId))) },
                  },
                  icon("pen", "solid", "gm-dropdown-icon"),
                  "編集",
                ),
              ),
              el(
                "li",
                {},
                el(
                  "button",
                  {
                    className: "dropdown-item gm-text-danger",
                    attrs: { type: "button" },
                    on: { click: () => run(() => deleteLocation(item)) },
                  },
                  icon("trash-can", "solid", "gm-dropdown-icon"),
                  "削除",
                ),
              ),
            ),
          ),
        ),
      );
    }
  }

  function renderLocations() {
    const data = S.load();
    const list = $("location-list");

    list.replaceChildren();

    if (!data.locations.length) {
      list.append(
        el(
          "li",
          { className: "gm-state" },
          el("span", { className: "gm-state-icon" }, icon("location-dot")),
          el("p", { className: "gm-state-title", text: "登録地点はありません" }),
          el("p", { className: "gm-help", text: "下のボタンから最初の地点を登録してください。" }),
        ),
      );

      return;
    }

    for (const item of data.locations) {
      const isActive = item.id === data.appSettings.activeLocationId;
      const meta = sourceMeta(item.source);

      list.append(
        el(
          "li",
          { className: "gm-list-card" + (isActive ? " is-active" : "") },
          el("span", { className: "gm-list-icon gm-list-icon-lg" }, icon(meta.icon)),
          el(
            "div",
            { className: "tw-min-w-0 tw-flex-1" },
            el(
              "h2",
              { className: "gm-list-title tw-flex tw-items-center tw-gap-2" },
              item.label,
              isActive ? el("span", { className: "gm-badge gm-badge-soft", text: "選択中" }) : null,
            ),
            el("p", { className: "gm-list-sub", text: locationSummary(item) }),
            el("p", {
              className: "gm-list-sub",
              text: `登録方法：${meta.label}${item.attribution ? `／${item.attribution}` : ""}`,
            }),
          ),
          el(
            "div",
            { className: "gm-list-actions" },
            isActive
              ? null
              : el(
                  "button",
                  {
                    className: "gm-btn gm-btn-soft gm-btn-sm",
                    attrs: { type: "button" },
                    on: { click: () => run(() => selectLocation(item.id)) },
                  },
                  "この地点を使う",
                ),
            el(
              "button",
              {
                className: "gm-icon-btn gm-icon-btn-primary",
                attrs: { type: "button", "aria-label": `「${item.label}」を編集` },
                on: { click: (event) => run(() => openLocationEditor(item, event.currentTarget)) },
              },
              icon("pen"),
            ),
            el(
              "button",
              {
                className: "gm-icon-btn gm-icon-btn-danger",
                attrs: { type: "button", "aria-label": `「${item.label}」を削除` },
                on: { click: () => run(() => deleteLocation(item)) },
              },
              icon("trash-can"),
            ),
          ),
        ),
      );
    }
  }

  function renderLocationViews() {
    renderLocationSelect();
    renderHeaderLocations();
    renderHomeLocations();

    if (state.page === "locations") renderLocations();
    if (state.page === "presets") renderPresets();
  }

  async function selectLocation(id, options = {}) {
    if (!requireConsent()) return;

    S.selectLocation(id);

    renderLocationViews();

    const current = S.getActiveLocation();

    UI.toast(`「${current.label}」を選択しました`, "info");

    if (options.showResults) go("results");

    await changeLocation();
  }

  /* ====================================
       07. 地点切替（API-03：古い応答は破棄）
    ==================================== */

  async function changeLocation() {
    const current = S.getActiveLocation();
    const key = locationKey(current);
    const changed = key !== state.locationKey;

    state.favoriteController?.abort();
    state.favoriteGeneration++;
    state.favoriteShops = [];
    state.favoriteResult = null;

    if (changed) {
      state.controller?.abort();
      state.generation++;

      state.loading = false;
      state.progress = null;
      state.loadError = null;
      state.shops = [];
      state.result = null;
      state.locationKey = key;
      state.refreshPaused = false;
      state.filters = current ? S.getFilters(current.id) : S.defaultFilters();
      state.visibleCount = C.DISPLAY_COUNT;

      updateRefreshButtons();
    }

    renderLocationViews();
    syncFilterControls();

    if (!current) {
      M.hideRestaurants();
      renderResults();
      return;
    }

    if (changed && S.hasConsent()) {
      await fetchRestaurants();
    } else {
      renderResults();
    }
  }

  /* ====================================
       08. 地点の登録・編集（LOC-01〜08）
    ==================================== */

  function methodForSource(source) {
    return (
      {
        address: "address",
        geocoding: "address",
        station: "station",
        gps: "gps",
        map: "map",
        manual: "coords",
      }[source] || "address"
    );
  }

  function setLocationMethod(method) {
    state.locationMethod = method;

    const radio = document.querySelector(`input[name="location-method"][value="${method}"]`);

    if (radio) radio.checked = true;

    const isSearch = method === "address" || method === "station";

    $("panel-search").hidden = !isSearch;
    $("panel-gps").hidden = method !== "gps";
    $("panel-map").hidden = method !== "map";
    $("panel-coords").hidden = method !== "coords";

    if (isSearch) {
      $("address-query-label").textContent = method === "station" ? "駅名" : "住所";
      $("address-query").placeholder =
        method === "station" ? "例：東京駅、梅田" : "例：東京都千代田区丸の内1-9-1";
      $("location-candidates").replaceChildren();
    }

    updateLocationMap(true);
  }

  function readCoordinates() {
    return {
      lat: $("latitude").valueAsNumber,
      lng: $("longitude").valueAsNumber,
    };
  }

  function showCoordError(code) {
    const node = $("coord-error");

    node.hidden = !code;
    node.textContent = code ? ERROR_MESSAGES[code] : "";

    $("latitude").toggleAttribute("aria-invalid", Boolean(code));
    $("longitude").toggleAttribute("aria-invalid", Boolean(code));
  }

  function onPickerSelect(candidate) {
    fillLocation(candidate, { recenter: false });
  }

  function updateLocationMap(recenter = true) {
    const { lat, lng } = readCoordinates();

    const valid = S.validCoordinates(lat, lng);

    const show = state.locationMethod === "map" || valid;

    const wrap = $("location-map-wrap");

    if (!show) {
      wrap.hidden = true;
      M.hideLocationPicker();
      return;
    }

    if (!M.isAvailable()) {
      wrap.hidden = true;

      if (state.locationMethod === "map") {
        setFieldMessage("location-message", ERROR_MESSAGES.ERR_MAP, true);
      }

      return;
    }

    wrap.hidden = false;

    // 表示中のモーダル内でのみ地図を生成（タイルは閲覧時のみ取得）
    if (!UI.isOpen("location-modal")) return;

    const center = valid
      ? { lat, lng }
      : S.getActiveLocation() || C.DEFAULT_CENTER;

    try {
      M.showLocationPicker(center, onPickerSelect);

      if (valid) M.setPickerPosition(lat, lng, recenter);
    } catch {
      wrap.hidden = true;
      setFieldMessage("location-message", ERROR_MESSAGES.ERR_MAP, true);
    }
  }

  function openLocationEditor(item = null, trigger) {
    if (!requireConsent()) return;

    state.locationController?.abort();
    state.locationGeneration++;

    state.editingLocationId = item?.id || null;

    state.selectedCandidate = item
      ? {
          label: item.label,
          lat: item.lat,
          lng: item.lng,
          address: item.address,
          source: item.source,
          attribution: item.attribution,
        }
      : null;

    state.autoName = "";

    $("location-title").textContent = item ? "地点の編集" : "地点の登録";
    $("location-name").value = item?.label || "";
    $("latitude").value = item?.lat ?? "";
    $("longitude").value = item?.lng ?? "";
    $("address-query").value = "";
    $("location-address").textContent = item
      ? [item.address, item.attribution].filter(Boolean).join(" ／ ")
      : "";
    $("location-candidates").replaceChildren();
    $("location-name-error").hidden = true;
    $("location-name").removeAttribute("aria-invalid");

    setFieldMessage(
      "location-message",
      item ? "名称のみの変更では店舗情報を再取得しません。位置を変更すると再取得します。" : "",
    );

    showCoordError(null);

    M.hideLocationPicker();

    setLocationMethod(item ? methodForSource(item.source) : "address");

    UI.showModal("location-modal", { trigger });
  }

  function fillLocation(candidate, options = {}) {
    const lat = Math.round(candidate.lat * 1e6) / 1e6;
    const lng = Math.round(candidate.lng * 1e6) / 1e6;

    state.selectedCandidate = { ...candidate, lat, lng };

    const name = $("location-name");

    // 未入力、または前回自動入力した名称のみ上書き
    if (candidate.label && (!name.value.trim() || name.value === state.autoName)) {
      name.value = candidate.label;
      state.autoName = candidate.label;
    }

    $("latitude").value = lat;
    $("longitude").value = lng;

    showCoordError(null);

    $("location-address").textContent = [candidate.address, candidate.attribution]
      .filter(Boolean)
      .join(" ／ ");

    setFieldMessage(
      "location-message",
      "位置を地図で確認し、地点名を付けて保存してください。",
    );

    updateLocationMap(options.recenter !== false);
  }

  async function searchAddress() {
    const mode = state.locationMethod === "station" ? "station" : "address";

    const query = $("address-query").value.trim();

    if (query.length < 2) {
      setFieldMessage("location-message", "2文字以上で入力してください。", true);
      $("address-query").focus();
      return;
    }

    state.locationController?.abort();

    const generation = ++state.locationGeneration;

    state.locationController = new AbortController();

    const list = $("location-candidates");

    list.replaceChildren();

    setFieldMessage("location-message", "地点候補を検索しています。");

    $("search-address").disabled = true;

    try {
      const result = await A.geocode(query, mode, {
        signal: state.locationController.signal,
      });

      if (generation !== state.locationGeneration || !UI.isOpen("location-modal")) return;

      const candidates = Array.isArray(result?.candidates) ? result.candidates : [];

      for (const candidate of candidates) {
        if (!S.validCoordinates(candidate.lat, candidate.lng)) continue;

        const item = el(
          "button",
          {
            className: "gm-candidate",
            attrs: { type: "button", "aria-pressed": "false" },
            on: {
              click: () => {
                list.querySelectorAll(".gm-candidate").forEach((node) => {
                  node.setAttribute("aria-pressed", "false");
                });

                item.setAttribute("aria-pressed", "true");

                fillLocation({
                  ...candidate,
                  source: mode,
                });
              },
            },
          },
          icon(mode === "station" ? "train-subway" : "location-dot", "solid", "gm-candidate-icon"),
          el(
            "span",
            { className: "tw-min-w-0 tw-flex-1 tw-text-left" },
            el("span", { className: "gm-list-title", text: candidate.label || candidate.address }),
            el("span", { className: "gm-list-sub", text: candidate.address || "" }),
            el("span", {
              className: "gm-list-sub",
              text: `緯度 ${candidate.lat.toFixed(6)} / 経度 ${candidate.lng.toFixed(6)}`,
            }),
          ),
        );

        list.append(el("li", {}, item));
      }

      if (list.childElementCount) {
        setFieldMessage(
          "location-message",
          `${list.childElementCount}件の候補が見つかりました。所在地を確認して選択してください。`,
        );
      } else {
        setFieldMessage(
          "location-message",
          mode === "station"
            ? "該当する駅が見つかりません。住所入力や地図からの選択もお試しください。"
            : "候補が見つかりません。表記を変えるか、地図・緯度経度から登録してください。",
          true,
        );
      }
    } finally {
      if (generation === state.locationGeneration) {
        $("search-address").disabled = false;
      }
    }
  }

  async function useGps() {
    const generation = ++state.locationGeneration;

    setFieldMessage("location-message", "現在地を取得しています。");

    $("use-gps").disabled = true;

    try {
      const result = await A.getCurrentPosition();

      if (generation !== state.locationGeneration || !UI.isOpen("location-modal")) return;

      if (!S.validCoordinates(result.lat, result.lng)) {
        throw new Error("ERR_COORD_AREA");
      }

      fillLocation(result);
    } finally {
      $("use-gps").disabled = false;
    }
  }

  function onCoordinateInput() {
    const { lat, lng } = readCoordinates();

    const bothEntered = $("latitude").value !== "" && $("longitude").value !== "";

    if (!bothEntered) {
      showCoordError(null);
      return;
    }

    const code = S.coordinateError(lat, lng);

    showCoordError(code);

    const candidate = state.selectedCandidate;

    if (!candidate || candidate.lat !== lat || candidate.lng !== lng) {
      $("location-address").textContent = "";
    }

    if (!code) updateLocationMap(true);
  }

  async function saveLocationForm() {
    const name = $("location-name").value.trim();

    const nameError = $("location-name-error");

    if (!name) {
      nameError.textContent = "地点名を入力してください。";
      nameError.hidden = false;
      $("location-name").setAttribute("aria-invalid", "true");
      $("location-name").focus();
      return;
    }

    nameError.hidden = true;
    $("location-name").removeAttribute("aria-invalid");

    const { lat, lng } = readCoordinates();

    const code = S.coordinateError(lat, lng);

    if (code) {
      showCoordError(code);
      $("latitude").focus();
      return;
    }

    const candidate = state.selectedCandidate;
    const matches = candidate && candidate.lat === lat && candidate.lng === lng;
    const editing = Boolean(state.editingLocationId);

    const saved = S.saveLocation({
      id: state.editingLocationId,
      label: name,
      lat,
      lng,
      address: matches ? candidate.address : "",
      source: matches ? candidate.source : "manual",
      attribution: matches ? candidate.attribution : "",
    });

    await afterModalHidden("location-modal");

    UI.toast(editing ? `「${saved.label}」を更新しました` : `「${saved.label}」を登録しました`);

    renderLocationViews();

    if (!editing) {
      // 初回利用フロー：保存 → 店舗取得 → 店舗一覧
      go("results");
    }

    await changeLocation();
  }

  async function deleteLocation(item) {
    const relations = S.countLocationRelations(item.id);

    const ok = await UI.confirm({
      title: "地点を削除",
      message: `「${item.label}」を削除しますか？`,
      detail:
        "この地点の前回の検索条件" +
        (relations.presets ? `とプリセット${relations.presets}件` : "") +
        "も削除されます。この操作は取り消せません。",
      confirmLabel: "削除する",
      danger: true,
    });

    if (!ok) return;

    S.deleteLocation(item.id);

    UI.toast(`「${item.label}」を削除しました`);

    await changeLocation();

    // 最後の地点を削除した場合は初回登録状態に戻す
    if (!S.getLocations().length) {
      go("home");
      openLocationEditor();
    }
  }

  /* ====================================
       09. 店舗取得（API-01〜06）
    ==================================== */

  function updateRefreshButtons() {
    $("refresh-results").disabled = state.loading;
    $("refresh-results").setAttribute("aria-busy", String(state.loading));
  }

  async function fetchRestaurants(options = {}) {
    if (!requireConsent()) return;

    const current = S.getActiveLocation();

    if (!current) {
      openLocationEditor();
      return;
    }

    // 重複通信の抑止
    if (state.loading) {
      if (options.force) UI.toast("店舗情報を取得中です。完了までお待ちください。", "info");
      return;
    }

    if (options.reason === "auto" && state.refreshPaused) return;

    const generation = ++state.generation;
    const key = locationKey(current);

    state.controller = new AbortController();
    state.loading = true;
    state.loadError = null;
    state.progress = { received: 0, total: null };
    state.lastAttempt = Date.now();
    state.locationKey = key;

    if (options.force) state.refreshPaused = false;

    updateRefreshButtons();
    renderResults(false);

    UI.announce("店舗情報を取得しています。");

    try {
      const result = await Q.fetchNearby(current, {
        force: options.force === true,
        signal: state.controller.signal,
        onProgress(progress) {
          if (generation !== state.generation) return;

          state.progress = progress;

          renderLoadingProgress();
        },
      });

      // 地点が切り替わった後の古い応答は破棄
      if (generation !== state.generation || key !== locationKey(S.getActiveLocation())) {
        return;
      }

      let keptOld = false;

      if (result.fetchedAt && (result.complete || !hasValidData())) {
        state.shops = result.shops;
        state.result = result;
        state.visibleCount = C.DISPLAY_COUNT;
      } else if (hasValidData()) {
        // 取得済みの有効データを維持
        keptOld = true;
      }

      if (PAUSE_ERRORS.includes(result.errorCode)) {
        state.refreshPaused = true;
      }

      if (result.errorCode === "ERR_MAINTENANCE") {
        run(() => checkSystemStatus({ silent: true }));
      }

      if (result.errorCode && result.errorCode !== "ERR_PARTIAL") {
        state.loadError = { code: result.errorCode, requestId: result.requestId };

        if (state.result) {
          showError(
            errorText(makeError(result.errorCode, result.requestId)) +
              (keptOld ? " 前回取得した店舗情報を表示しています。" : ""),
            RETRYABLE_ERRORS.includes(result.errorCode)
              ? { retry: () => fetchRestaurants({ force: true }) }
              : {},
          );
        }

        UI.announce("店舗情報を取得できませんでした。");

        if (state.page !== "results") {
          UI.toast(ERROR_MESSAGES[result.errorCode] || "店舗情報を取得できませんでした。", "danger");
        }
      } else {
        clearError();

        state.loadError =
          result.errorCode === "ERR_PARTIAL"
            ? { code: "ERR_PARTIAL", requestId: result.requestId }
            : null;

        UI.announce(
          `${result.limited ? `周辺${result.total}件のうち近い順に${C.MAX_SHOPS}件の` : ""}店舗情報を取得しました。半径3km以内に${state.shops.length}件、条件に一致するお店は${Q.filter(state.shops, state.filters, S.getFavoriteIds()).length}件です。`,
        );
      }
    } catch (error) {
      if (error?.name === "AbortError") return;

      if (generation !== state.generation) return;

      state.loadError = { code: errorCode(error), requestId: error.requestId };

      if (state.result) showError(errorText(error));
    } finally {
      if (generation === state.generation) {
        state.loading = false;
        state.controller = null;
        state.progress = null;

        updateRefreshButtons();
        renderResults(true);
      }
    }
  }

  /* ====================================
       10. 状態表示（読み込み中・エラー・0件・部分取得）
    ==================================== */

  function stateCard({ type, title, message, actions = [], progress }) {
    const icons = {
      loading: null,
      empty: "magnifying-glass",
      error: "triangle-exclamation",
      info: "circle-info",
      location: "location-dot",
      favorite: "heart",
    };

    const node = el(
      "div",
      {
        className: `gm-state gm-state-${type}`,
        attrs: {
          role: type === "error" ? "alert" : "status",
          "aria-busy": type === "loading" ? "true" : null,
        },
      },
      type === "loading"
        ? el("span", { className: "gm-spinner", attrs: { "aria-hidden": "true" } })
        : el("span", { className: "gm-state-icon" }, icon(icons[type] || "circle-info")),
      el("p", { className: "gm-state-title", text: title }),
      message ? el("p", { className: "gm-help tw-m-0", text: message }) : null,
    );

    if (progress) node.append(progress);

    if (actions.length) {
      node.append(el("div", { className: "gm-state-actions" }, ...actions));
    }

    return node;
  }

  function actionButton(label, handler, className = "gm-btn gm-btn-outline gm-btn-sm", iconName) {
    return el(
      "button",
      {
        className,
        attrs: { type: "button" },
        on: { click: (event) => run(() => handler(event)) },
      },
      iconName ? icon(iconName) : null,
      label,
    );
  }

  function progressBar(progress) {
    const total = progress?.total;
    const received = progress?.received || 0;
    const percent = total ? Math.min(100, Math.round((received / total) * 100)) : 0;

    return el(
      "div",
      { className: "tw-w-full tw-max-w-xs tw-mx-auto" },
      el(
        "div",
        {
          className: "gm-progress",
          attrs: {
            role: "progressbar",
            "aria-label": "取得進捗",
            "aria-valuemin": "0",
            "aria-valuemax": total ? String(total) : null,
            "aria-valuenow": total ? String(received) : null,
            "aria-valuetext": total ? `${received} / ${total}件` : "件数を確認中",
          },
        },
        el("span", { className: "gm-progress-bar", attrs: { "data-percent": String(percent) } }),
      ),
      el("p", {
        className: "gm-help tw-mt-1 tw-mb-0",
        attrs: { id: "loading-progress-text" },
        text: total ? `${received} / ${total}件取得中` : "件数を確認しています",
      }),
    );
  }

  function applyProgressWidth(root) {
    root.querySelectorAll(".gm-progress-bar[data-percent]").forEach((bar) => {
      bar.style.width = `${bar.dataset.percent}%`;
    });
  }

  function renderLoadingProgress() {
    const container = $("results-state");

    const existing = container.querySelector(".gm-progress");

    if (!existing) {
      renderResults(false);
      return;
    }

    const holder = existing.parentElement;

    holder.replaceWith(progressBar(state.progress));

    applyProgressWidth(container);
  }

  function renderResultsState(current, visible) {
    const container = $("results-state");

    container.replaceChildren();

    if (!current) {
      container.append(
        stateCard({
          type: "location",
          title: "地点が登録されていません",
          message: "住所・駅名・現在地・地図などから、探したい場所を登録してください。",
          actions: [
            actionButton("地点を登録する", (event) => openLocationEditor(null, event.currentTarget), "gm-btn gm-btn-primary gm-btn-sm", "plus"),
          ],
        }),
      );
      return;
    }

    if (state.loading && !state.result) {
      container.append(
        stateCard({
          type: "loading",
          title: "通信中…",
          message: "お店を探しています。",
          progress: progressBar(state.progress),
        }),
      );
      applyProgressWidth(container);
      return;
    }

    if (state.loading) {
      container.append(
        el(
          "div",
          { className: "gm-alert gm-alert-info gm-alert-compact", attrs: { role: "status" } },
          el("span", { className: "gm-spinner gm-spinner-sm", attrs: { "aria-hidden": "true" } }),
          el("div", { className: "tw-flex-1" }, el("p", { className: "tw-m-0", text: "最新の店舗情報を取得しています。" }), progressBar(state.progress)),
        ),
      );
      applyProgressWidth(container);
    }

    if (!state.result) {
      if (state.loadError) {
        const error = makeError(state.loadError.code, state.loadError.requestId);

        container.append(
          stateCard({
            type: "error",
            title: "データの取得に失敗しました",
            message: errorText(error),
            actions: RETRYABLE_ERRORS.includes(state.loadError.code)
              ? [actionButton("再試行", () => fetchRestaurants({ force: true }), "gm-btn gm-btn-outline-primary gm-btn-sm", "rotate")]
              : [],
          }),
        );
      } else if (!state.loading) {
        container.append(
          stateCard({
            type: "info",
            title: "店舗情報は未取得です",
            message: S.hasConsent() ? "「店舗情報を取得」を押してください。" : "利用規約への同意後に取得できます。",
            actions: [actionButton("店舗情報を取得", () => fetchRestaurants({ force: true }), "gm-btn gm-btn-primary gm-btn-sm", "rotate")],
          }),
        );
      }
      return;
    }

    // 正常な100件上限：エラーとせず検索範囲の制約を案内（API-01／ERR_PARTIAL）
    if (state.result.complete && state.result.limited && !state.loading) {
      container.append(
        el(
          "div",
          { className: "gm-alert gm-alert-info gm-alert-compact", attrs: { role: "status" } },
          icon("circle-info"),
          el("p", {
            className: "tw-m-0 tw-text-sm",
            text: `周辺の${state.result.total}件のうち、登録地点から近い順に${C.MAX_SHOPS}件を取得しました。絞り込み・並び替えはこの${C.MAX_SHOPS}件の中で行い、${C.MAX_SHOPS + 1}件目以降のお店は表示されません。`,
          }),
        ),
      );
    }

    // 部分取得（ERR_PARTIAL：完了扱いにしない）
    if (!state.result.complete && !state.loading) {
      container.append(
        el(
          "div",
          { className: "gm-alert gm-alert-warning gm-alert-compact", attrs: { role: "status" } },
          icon("circle-exclamation"),
          el(
            "div",
            { className: "tw-flex-1" },
            el("p", { className: "tw-m-0 tw-font-semibold", text: "一部の情報のみ表示しています" }),
            el("p", {
              className: "tw-m-0 tw-text-sm",
              text: `取得済み ${state.result.received}件 / 全${state.result.total ?? "不明"}件。不足している店舗は表示されていません。（ERR_PARTIAL${state.loadError?.requestId ? `／識別番号：${state.loadError.requestId}` : ""}）`,
            }),
          ),
          actionButton("再試行", () => fetchRestaurants({ force: true }), "gm-btn gm-btn-outline gm-btn-sm", "rotate"),
        ),
      );
    }

    if (!visible.length && !state.loading) {
      const noShops = state.shops.length === 0;

      const genreNone = Array.isArray(state.filters.genreNames) && state.filters.genreNames.length === 0;

      // SR-11：未取得店舗の存在を否定しない
      const scopeNote = state.result.limited
        ? `検索対象は近い順に取得した${C.MAX_SHOPS}件のみです。${C.MAX_SHOPS + 1}件目以降に該当するお店がある可能性があります。`
        : "";

      container.append(
        stateCard({
          type: "empty",
          title: noShops
            ? "取得できたお店がありません"
            : state.result.limited
              ? "取得済みの100件の中に該当するお店はありません"
              : "該当するお店が見つかりません",
          message: noShops
            ? "ホットペッパーグルメで取得できる店舗がありませんでした。別の地点をお試しください。"
            : (genreNone
                ? "ジャンルが1つも選択されていません。ジャンルを選択してください。"
                : "条件を変えて、再度検索してください。") + (scopeNote ? " " + scopeNote : ""),
          actions: noShops
            ? [actionButton("別の地点を選ぶ", () => go("locations"), "gm-btn gm-btn-outline-primary gm-btn-sm", "location-dot")]
            : [
                actionButton("検索条件を変更する", (event) => openFilters(event.currentTarget), "gm-btn gm-btn-outline-primary gm-btn-sm", "sliders"),
                actionButton("条件をリセット", () => resetFiltersAndApply(), "gm-btn gm-btn-ghost gm-btn-sm"),
              ],
        }),
      );
    }
  }

  /* ====================================
       11. 店舗カード（C項目）
    ==================================== */

  function shopLine(iconName, label, value, className = "") {
    return el(
      "p",
      { className: `gm-shop-line ${className}`.trim() },
      icon(iconName, "solid", "gm-shop-line-icon"),
      el("span", { className: "visually-hidden", text: `${label}：` }),
      el("span", { text: value || "情報なし" }),
    );
  }

  function distanceText(shop) {
    if (!Number.isFinite(shop.distanceM)) return "距離情報なし";

    return `${Q.formatDistance(shop.distanceM)}（徒歩約${shop.walkingMinutes}分・目安）`;
  }

  function heartButton(shop, onChange) {
    const node = el("button", {
      className: "gm-heart-btn",
      attrs: { type: "button" },
    });

    function paint() {
      const active = S.getFavoriteIds().includes(shop.id);

      node.setAttribute("aria-pressed", String(active));
      node.setAttribute(
        "aria-label",
        active ? `「${shop.name}」をお気に入りから解除` : `「${shop.name}」をお気に入りに登録`,
      );

      node.replaceChildren(icon("heart", active ? "solid" : "regular"));
    }

    node.addEventListener("click", () =>
      run(() => {
        const active = S.toggleFavorite(shop.id);

        paint();

        UI.toast(active ? "お気に入りに登録しました" : "お気に入りを解除しました", "info");

        onChange?.(active);
      }),
    );

    paint();

    return node;
  }

  function createCard(shop, context = "results") {
    const detailsButton = el(
      "button",
      {
        className: "gm-shop-name-btn",
        attrs: { type: "button" },
        dataset: { action: "details" },
        on: { click: (event) => openShop(shop, event.currentTarget) },
      },
      shop.name || "店舗名なし",
    );

    const header = el(
      "div",
      { className: "tw-flex tw-items-start tw-justify-between tw-gap-2" },
      el("h3", { className: "gm-shop-name" }, detailsButton),
    );

    if (favoriteEnabled()) {
      header.append(
        heartButton(shop, () => {
          if (context === "results" && state.filters.favoriteOnly) {
            renderResults(false);
          }

          if (context === "favorites") {
            renderFavorites();
            document.querySelector("#page-favorites h1")?.focus();
          }
        }),
      );
    }

    const body = el(
      "div",
      { className: "gm-shop-body" },
      header,
      el(
        "div",
        { className: "gm-chip-row" },
        el("span", { className: "gm-chip gm-chip-genre", text: shop.genre || "ジャンル情報なし" }),
      ),
      el("p", { className: "gm-shop-catch", text: shop.catchCopy || "情報なし" }),
      shopLine("location-dot", "距離", distanceText(shop), "gm-shop-distance"),
      shopLine("map-pin", "住所", shop.address),
      shopLine("clock", "営業時間", shop.open, "gm-clamp-2"),
      shopLine("calendar-xmark", "定休日", shop.close, "gm-clamp-1"),
      shopLine("yen-sign", "平均ディナー予算", shop.budget ? `ディナー平均 ${shop.budget}` : ""),
    );

    const article = el(
      "article",
      {
        className: "gm-shop-card",
        dataset: { shopId: shop.id },
        attrs: { "aria-label": shop.name || "店舗" },
      },
      shopImage(shop, "card"),
      body,
    );

    return el("li", {}, article);
  }

  // カードの余白部分クリックでも詳細を開く（キーボードは店名ボタンで操作）
  function onCardClick(event) {
    if (event.target.closest("button, a, input, select, label")) return;

    const card = event.target.closest("[data-shop-id]");

    if (!card) return;

    card.querySelector('[data-action="details"]')?.click();
  }

  /* ====================================
       12. 検索結果描画（SR-09／SR-10／MAP-01）
    ==================================== */

  function expireIfNeeded() {
    if (state.result && dataAge() >= C.DATA_TTL_MS) {
      state.shops = [];
      state.result = null;

      if (UI.isOpen("shop-modal")) UI.hideModal("shop-modal");

      UI.toast("店舗情報の保持期限（24時間）を過ぎたため削除しました。再取得してください。", "info");
    }
  }

  function renderActiveChips() {
    const list = $("active-chips");
    const filters = state.filters;
    const chips = [];

    if (filters.keyword) {
      chips.push({ label: `「${filters.keyword}」`, remove: () => (filters.keyword = "") });
    }

    if (filters.radiusM !== C.MAX_RADIUS_M) {
      chips.push({
        label: `${Q.formatDistance(filters.radiusM)}以内`,
        remove: () => (filters.radiusM = C.MAX_RADIUS_M),
      });
    }

    if (filters.genreNames !== null) {
      const names = filters.genreNames;

      chips.push({
        label:
          names.length === 0
            ? "ジャンル未選択"
            : names.length <= 2
              ? names.join("・")
              : `ジャンル${names.length}件`,
        remove: () => (filters.genreNames = null),
      });
    }

    for (const condition of filters.conditions) {
      chips.push({
        label: Q.CONDITIONS[condition],
        remove: () => (filters.conditions = filters.conditions.filter((key) => key !== condition)),
      });
    }

    if (filters.favoriteOnly) {
      chips.push({ label: "お気に入りのみ", remove: () => (filters.favoriteOnly = false) });
    }

    list.replaceChildren(
      ...chips.map((chip, index) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              className: "gm-chip gm-chip-filter",
              attrs: { type: "button", "aria-label": `${chip.label}の条件を解除` },
              on: {
                click: () =>
                  run(() => {
                    chip.remove();
                    applyFilters();

                    const buttons = $("active-chips").querySelectorAll("button");

                    (buttons[Math.min(index, buttons.length - 1)] || $("open-filter")).focus();
                  }),
              },
            },
            chip.label,
            icon("xmark"),
          ),
        ),
      ),
    );

    list.hidden = !chips.length;

    const badge = $("filter-count-badge");

    const count = Q.countActiveFilters(filters);

    badge.hidden = !count;
    badge.textContent = count ? String(count) : "";

    $("open-filter").setAttribute(
      "aria-label",
      count ? `絞り込み（${count}件の条件を適用中）` : "絞り込み",
    );
  }

  function renderResults(fitMap = true) {
    expireIfNeeded();

    const current = S.getActiveLocation();

    const filtered = Q.filter(state.shops, state.filters, S.getFavoriteIds());

    const visible = filtered.slice(0, state.visibleCount);

    state.filtered = filtered;

    $("result-location").textContent = current ? current.label : "地点未登録";
    $("result-total").textContent = String(filtered.length);
    $("result-count").textContent = `該当${filtered.length}件中${visible.length}件表示`;
    $("sort").value = state.filters.sort;

    // 最終更新日時（部分取得の時刻は区別）
    $("last-updated").textContent = !state.result
      ? "最終更新：未取得"
      : state.result.complete
        ? `最終更新：${formatDate(state.result.fetchedAt)}`
        : `取得日時（部分取得）：${formatDate(state.result.fetchedAt)}`;

    // API総件数・取得件数・上限到達（SR-10）
    $("acquisition-status").textContent = !state.result
      ? ""
      : !state.result.complete
        ? `部分取得：${state.result.received} / ${Math.min(state.result.total ?? C.MAX_SHOPS, C.MAX_SHOPS)}件（API総件数 ${state.result.total ?? "不明"}件）`
        : state.result.limited
          ? `取得：${state.result.received}件（API総件数 ${state.result.total}件・上限${C.MAX_SHOPS}件に到達・3km以内 ${state.shops.length}件）`
          : `取得：${state.result.received}件（API総件数 ${state.result.total}件・3km以内 ${state.shops.length}件）`;

    renderActiveChips();

    renderResultsState(current, visible);

    $("restaurant-list").replaceChildren(...visible.map((shop) => createCard(shop, "results")));

    const remaining = filtered.length - visible.length;

    $("load-more").hidden = remaining <= 0;
    $("load-more-detail").textContent = remaining > 0 ? `（残り${remaining}件）` : "";

    $("show-list").setAttribute("aria-pressed", String(state.view === "list"));
    $("show-map").setAttribute("aria-pressed", String(state.view === "map"));

    renderMap(current, filtered, fitMap);
  }

  function renderMap(current, filtered, fitMap) {
    const onResults = state.page === "results";

    const showMap =
      onResults &&
      Boolean(current) &&
      Boolean(state.result) &&
      (wideMedia.matches || state.view === "map");

    $("list-panel").hidden = showMap && !wideMedia.matches && state.view === "map";
    $("map-panel").hidden = !showMap;

    // スマートフォンで地図を選んだが表示できない場合も一覧で全機能を利用可能（MAP-01）
    if (onResults && state.view === "map" && !wideMedia.matches && !showMap) {
      $("list-panel").hidden = false;
    }

    if (!showMap) {
      hideMapPreview();
      M.hideRestaurants();
      return;
    }

    // 絞り込みで選択中の店舗が外れた場合はプレビューを閉じる
    if (state.previewShopId && !filtered.some((shop) => shop.id === state.previewShopId)) {
      hideMapPreview();
    }

    try {
      M.showRestaurants(current, filtered, state.filters.radiusM, openShop, fitMap, showMapPreview);
    } catch {
      $("map-panel").hidden = true;
      $("list-panel").hidden = false;

      showError(errorText(new Error("ERR_MAP")));
    }
  }

  /* ====================================
       12-2. 地図の店舗プレビュー（デザイン③：マーカー選択で基本情報）
    ==================================== */

  function hideMapPreview() {
    state.previewShopId = null;

    const node = $("map-preview");

    node.hidden = true;
    node.replaceChildren();
  }

  function showMapPreview(shop) {
    state.previewShopId = shop.id;

    const node = $("map-preview");

    const photo = shopImage(shop, "card").querySelector("img");

    const details = el(
      "button",
      {
        className: "gm-btn gm-btn-primary gm-btn-sm",
        attrs: { type: "button" },
        dataset: { action: "details" },
        on: { click: (event) => openShop(shop, event.currentTarget) },
      },
      "詳細",
      UI.srOnly(`：${shop.name}`),
    );

    node.replaceChildren(
      photo,
      el(
        "div",
        { className: "gm-map-preview-body" },
        el("p", { className: "gm-map-preview-name", text: shop.name || "店舗名なし" }),
        el(
          "div",
          { className: "gm-chip-row" },
          el("span", { className: "gm-chip gm-chip-genre", text: shop.genre || "ジャンル情報なし" }),
        ),
        el("p", { className: "gm-shop-line gm-shop-distance tw-m-0" }, icon("location-dot", "solid", "gm-shop-line-icon"), el("span", { text: distanceText(shop) })),
      ),
      el(
        "div",
        { className: "tw-flex tw-flex-col tw-items-center tw-gap-1" },
        favoriteEnabled() ? heartButton(shop) : null,
        details,
      ),
      el(
        "button",
        {
          className: "gm-icon-btn gm-icon-btn-sm tw-self-start",
          attrs: { type: "button", "aria-label": "店舗プレビューを閉じる" },
          on: { click: () => { hideMapPreview(); $("restaurant-map").focus(); } },
        },
        icon("xmark"),
      ),
    );

    // 店舗カードとして識別できるようにし、モーダルを閉じた後のフォーカス復帰に利用
    node.dataset.shopId = shop.id;
    node.hidden = false;

    UI.announce(`${shop.name}、${distanceText(shop)}`);

    details.focus({ preventScroll: true });
  }

  /* ====================================
       13. 店舗詳細モーダル（M項目）・共有（SH-01／SH-02）
    ==================================== */

  // value は文字列または要素（リンク・チップなど）
  function infoItem(iconName, label, value) {
    const body =
      value instanceof Node
        ? el("div", { className: "gm-info-value" }, value)
        : el("span", { className: "gm-info-value", text: value || "情報なし" });

    return el(
      "li",
      {},
      icon(iconName, "solid", "gm-info-icon"),
      el("div", { className: "tw-min-w-0" }, el("span", { className: "gm-info-label", text: label }), body),
    );
  }

  // 電話番号はホットペッパーAPIの返却項目にないため、店舗ページへ案内する
  function phoneInfo(shop) {
    const url = shopUrl(shop);

    if (!url) return "情報なし";

    return el(
      "a",
      {
        className: "gm-text-link tw-gap-1.5",
        attrs: { href: url, target: "_blank", rel: "noopener noreferrer" },
      },
      "ホットペッパーの店舗ページで確認",
      icon("arrow-up-right-from-square", "solid", "tw-text-xs"),
      UI.srOnly("（新しいタブで開く）"),
    );
  }

  // 利用できるカードの種類（type=credit_card）。種類がなければ「利用可／不可」を表示
  function cardInfo(shop) {
    const brands = Array.isArray(shop.creditCards)
      ? shop.creditCards.map((name) => String(name ?? "").trim()).filter(Boolean)
      : [];

    if (!brands.length) return shop.card || "情報なし";

    return el(
      "ul",
      { className: "gm-card-brands", attrs: { "aria-label": "利用できるカード" } },
      ...brands.map((name) => el("li", { className: "gm-chip", text: name })),
    );
  }

  function renderShopFavorite(shop) {
    const node = $("shop-favorite");

    if (!favoriteEnabled()) {
      node.hidden = true;
      return;
    }

    const fresh = heartButton(shop, () => {
      state.shopFavoriteChanged = true;
    });

    fresh.id = "shop-favorite";

    node.replaceWith(fresh);
  }

  function openShop(shop, trigger) {
    state.currentShop = shop;
    state.shopFavoriteChanged = false;

    $("shop-hero").replaceChildren(shopImage(shop, "hero"));
    $("shop-title").textContent = shop.name || "店舗名なし";

    renderShopFavorite(shop);

    $("shop-genres").replaceChildren(
      el("li", {}, el("span", { className: "gm-chip gm-chip-genre", text: shop.genre || "ジャンル情報なし" })),
    );

    $("shop-catch").textContent = shop.catchCopy || "";
    $("shop-catch").hidden = !shop.catchCopy;

    $("shop-info").replaceChildren(
      infoItem("map-pin", "住所", shop.address),
      infoItem("person-walking", "直線距離・概算徒歩時間", distanceText(shop)),
      infoItem("clock", "営業時間", shop.open),
      infoItem("calendar-xmark", "定休日", shop.close),
      infoItem("yen-sign", "平均ディナー予算（ランチ予算ではありません）", shop.budget),
      infoItem("phone", "電話番号", phoneInfo(shop)),
      infoItem("credit-card", "使えるカード", cardInfo(shop)),
    );

    // 「あり」と判定できる設備のみアイコン＋テキストで表示（色だけに依存しない）
    const features = Object.keys(Q.CONDITIONS).filter(
      (key) => Q.classify(Q.conditionValue(shop, key), key) === "yes",
    );

    $("shop-features").replaceChildren(
      ...features.map((key) =>
        el(
          "li",
          { className: "gm-feature" },
          icon(FEATURE_ICONS[key]),
          el("span", { text: Q.CONDITIONS[key] }),
        ),
      ),
    );

    $("shop-features").hidden = !features.length;

    const details = [
      ["最寄り駅", shop.stationName],
      ["アクセス", shop.access],
      ["ランチ", shop.lunch],
      ["23時以降の営業", shop.midnight],
      ["カード", shop.card],
      ["予算メモ", shop.budgetMemo],
      ["駐車場", shop.parking],
      ["禁煙・喫煙", shop.nonSmoking],
      ["バリアフリー", shop.barrierFree],
      ["総席数", shop.capacity],
      ["宴会最大人数", shop.partyCapacity],
      ["個室", shop.privateRoom],
      ["座敷", shop.tatami],
      ["掘りごたつ", shop.horigotatsu],
      ["貸切", shop.charter],
      ["Wi-Fi", shop.wifi],
      ["お子様連れ", shop.child],
      ["飲み放題（掲載情報）", shop.freeDrink],
      ["食べ放題", shop.freeFood],
      ["コース", shop.course],
      ["英語メニュー", shop.english],
      ["ペット同伴", shop.pet],
      ["その他設備", shop.otherMemo],
      ["備考", shop.shopDetailMemo],
    ];

    $("shop-details").replaceChildren(
      ...details.flatMap(([label, value]) => [
        el("dt", { text: label }),
        el("dd", { text: String(value ?? "").trim() || "情報なし" }),
      ]),
    );

    $("shop-fetched").textContent = state.result?.fetchedAt
      ? `情報取得日時：${formatDate(state.result.fetchedAt)}（営業時間・定休日は変更されている場合があります）`
      : "";

    // 共有パネルを初期化（共有する店舗の概要を表示：デザイン⑨）
    $("share-summary").replaceChildren(
      shopImage(shop, "card").querySelector("img"),
      el(
        "div",
        { className: "tw-min-w-0" },
        el("p", { className: "gm-list-title tw-text-sm", text: shop.name || "店舗名なし" }),
        el("p", { className: "gm-list-sub tw-text-xs", text: shop.address || "" }),
      ),
    );

    $("shop-share-panel").hidden = true;
    $("share-qr-area").hidden = true;
    $("share-qr").setAttribute("aria-expanded", "false");
    $("share-url-field").hidden = true;
    $("shop-message").textContent = "";

    const url = shopUrl(shop);

    $("share-native").parentElement.hidden = !(
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare({ url: url || "https://example.com" }))
    );

    $("share-qr").parentElement.hidden = typeof window.qrcode !== "function";

    const actions = $("shop-actions");

    actions.replaceChildren();

    const mapsUrl = googleMapsUrl(shop);

    if (mapsUrl) {
      actions.append(externalLink("地図で見る", mapsUrl, "location-dot", "gm-btn gm-btn-primary"));
    }

    if (url) {
      actions.append(
        externalLink("ホットペッパーで開く", url, "arrow-up-right-from-square", "gm-btn gm-btn-outline-primary"),
      );
    }

    const couponUrl = safeUrl(shop.couponUrl, C.SHOP_URL_DOMAINS);

    if (couponUrl) {
      actions.append(externalLink("クーポン", couponUrl, "ticket", "gm-btn gm-btn-outline-primary"));
    }

    if (url) {
      actions.append(
        el(
          "button",
          {
            className: "gm-btn gm-btn-outline",
            attrs: {
              type: "button",
              id: "toggle-share",
              "aria-expanded": "false",
              "aria-controls": "shop-share-panel",
            },
            on: {
              click: (event) => {
                const panel = $("shop-share-panel");

                panel.hidden = !panel.hidden;

                event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));

                if (!panel.hidden) {
                  panel.scrollIntoView({ block: "nearest" });
                  $("share-line").focus();
                }
              },
            },
          },
          icon("share-nodes"),
          "共有",
        ),
      );
    }

    UI.showModal("shop-modal", {
      trigger,
      fallbackFocus: () => focusShopCard(shop.id),
    });
  }

  function focusShopCard(shopId) {
    const target = [
      ...document.querySelectorAll(`[data-shop-id="${CSS.escape(shopId)}"] [data-action="details"]`),
    ].find((node) => !node.closest("[hidden]"));

    if (target) {
      target.focus();
      return true;
    }

    return false;
  }

  async function shareNative() {
    const shop = state.currentShop;
    const url = shopUrl(shop);

    if (!url) throw new Error("ERR_SHARE");

    try {
      await navigator.share({ title: shop.name, url });

      $("shop-message").textContent = "共有メニューを開きました。";
    } catch (error) {
      if (error?.name === "AbortError") return;

      await copyShopLink();
    }
  }

  async function copyShopLink() {
    const url = shopUrl(state.currentShop);

    if (!url) throw new Error("ERR_SHARE");

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(url);

        $("shop-message").textContent = "店舗リンクをコピーしました。";

        UI.toast("店舗リンクをコピーしました");

        return;
      } catch {
        // 手動コピーへ切替
      }
    }

    // クリップボード非対応時は手動選択
    $("share-url").value = url;
    $("share-url-field").hidden = false;
    $("share-url").focus();
    $("share-url").select();

    $("shop-message").textContent = "リンクを選択した状態にしました。コピーしてご利用ください。";
  }

  function shareLine() {
    const url = shopUrl(state.currentShop);

    if (!url) throw new Error("ERR_SHARE");

    window.open(
      "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(url),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function toggleQr() {
    const area = $("share-qr-area");
    const button = $("share-qr");

    if (!area.hidden) {
      area.hidden = true;
      button.setAttribute("aria-expanded", "false");
      return;
    }

    const url = shopUrl(state.currentShop);

    if (!url || typeof window.qrcode !== "function") throw new Error("ERR_SHARE");

    const qr = window.qrcode(0, "M");

    qr.addData(url);
    qr.make();

    $("share-qr-image").src = qr.createDataURL(5, 2);
    $("share-qr-image").alt = `「${state.currentShop.name}」の店舗ページのQRコード`;

    area.hidden = false;
    button.setAttribute("aria-expanded", "true");
  }

  /* ====================================
       14. 絞り込み（SCR-11／SR-03〜11）
    ==================================== */

  function syncFilterControls() {
    $("keyword").value = state.filters.keyword;
    $("sort").value = state.filters.sort;

    document.querySelectorAll('[name="quick-condition"]').forEach((node) => {
      node.checked = state.filters.conditions.includes(node.value);
    });
  }

  function saveCurrentFilters() {
    const current = S.getActiveLocation();

    state.filters = S.cleanFilters(state.filters);

    if (current) {
      S.saveFilters(current.id, state.filters);
    }

    state.visibleCount = C.DISPLAY_COUNT;

    syncFilterControls();
  }

  function applyFilters(options = {}) {
    saveCurrentFilters();

    renderResults(options.fitMap !== false);

    if (state.result) {
      UI.announce(`条件に一致するお店は${state.filtered.length}件です。`);
    }
  }

  function resetFiltersAndApply() {
    const sort = state.filters.sort;

    state.filters = { ...S.defaultFilters(), sort };

    applyFilters();

    UI.toast("検索条件をリセットしました", "info");
  }

  function availableGenres() {
    return Q.getGenres(state.shops);
  }

  function radiusIndex(radiusM) {
    const index = C.DISTANCE_OPTIONS.indexOf(radiusM);

    return index >= 0 ? index : C.DISTANCE_OPTIONS.length - 1;
  }

  function updateRadiusOutput() {
    const radius = state.draft.radiusM;
    const text = `${Q.formatDistance(radius)}以内`;

    $("radius-output").textContent = `〜${Q.formatDistance(radius)}`;
    $("radius-range").setAttribute("aria-valuetext", text);
  }

  function updateFilterCount() {
    if (!state.draft) return;

    const button = $("filter-apply");

    if (!state.result) {
      button.textContent = "この条件で検索";
      return;
    }

    const count = Q.filter(state.shops, state.draft, S.getFavoriteIds()).length;

    button.textContent = `この条件で検索（${count}件）`;
  }

  function renderGenreOptions() {
    const genres = availableGenres();
    const saved = state.draft.genreNames || [];
    const choices = [...new Set([...genres, ...saved])];
    const container = $("genre-options");

    container.replaceChildren(
      ...choices.map((name, index) => {
        const missing = !genres.includes(name);

        const checked = state.draft.genreNames === null || saved.includes(name);

        return el(
          "label",
          {
            className:
              "gm-toggle-chip" +
              (index >= GENRE_VISIBLE_COUNT && !state.genreExpanded ? " gm-genre-extra" : ""),
            attrs: { hidden: index >= GENRE_VISIBLE_COUNT && !state.genreExpanded },
          },
          el("input", {
            attrs: { type: "checkbox", value: name, checked },
          }),
          el("span", {}, name, missing ? el("small", { text: "（現在の結果になし）" }) : null),
        );
      }),
    );

    container.querySelectorAll("input").forEach((input) => {
      input.checked = state.draft.genreNames === null || saved.includes(input.value);
    });

    const more = $("genre-more");

    more.hidden = choices.length <= GENRE_VISIBLE_COUNT;
    more.setAttribute("aria-expanded", String(state.genreExpanded));
    more.replaceChildren(
      state.genreExpanded ? "閉じる" : `もっと見る（${choices.length - GENRE_VISIBLE_COUNT}件）`,
      icon(state.genreExpanded ? "chevron-up" : "chevron-down", "solid", "tw-ml-1"),
    );

    updateGenreNote();
  }

  function updateGenreNote() {
    const genres = availableGenres();
    const saved = state.draft.genreNames || [];
    const notes = [];

    if (!genres.length) notes.push("店舗情報の取得後にジャンルを選択できます。");

    const missing = saved.filter((name) => !genres.includes(name));

    if (missing.length && genres.length) {
      notes.push(`保存されたジャンル「${missing.join("・")}」は現在の取得結果にありません。必要に応じて選び直してください。`);
    }

    if (Array.isArray(state.draft.genreNames) && !state.draft.genreNames.length) {
      notes.push("ジャンルが未選択のため、検索結果は0件になります。");
    }

    $("genre-note").textContent = notes.join(" ");
    $("genre-note").hidden = !notes.length;
  }

  function renderConditionOptions() {
    $("condition-options").replaceChildren(
      ...Object.entries(Q.CONDITIONS).map(([key, label]) =>
        el(
          "label",
          { className: "gm-check" },
          el("input", {
            attrs: {
              type: "checkbox",
              value: key,
              checked: state.draft.conditions.includes(key),
            },
          }),
          icon(FEATURE_ICONS[key], "solid", "gm-check-icon"),
          el("span", { text: label }),
        ),
      ),
    );
  }

  function renderFilterControls() {
    $("filter-keyword").value = state.draft.keyword;
    $("radius-range").value = String(radiusIndex(state.draft.radiusM));

    updateRadiusOutput();
    renderGenreOptions();
    renderConditionOptions();

    const enabled = favoriteEnabled();

    $("favorite-only").disabled = !enabled;
    $("favorite-only").checked = enabled && state.draft.favoriteOnly;
    $("favorite-only-note").textContent = enabled
      ? "お気に入りに登録した店舗のみを表示します"
      : "お気に入り機能は利用条件の確認後に提供予定です";

    updateFilterCount();
  }

  function openFilters(trigger) {
    state.draft = cloneFilters(state.filters);
    state.genreExpanded = false;

    renderFilterControls();

    UI.showOffcanvas("filter-sheet", { trigger: trigger || $("open-filter") });
  }

  function readGenreSelection() {
    const inputs = [...$("genre-options").querySelectorAll("input")];

    const checked = inputs.filter((node) => node.checked).map((node) => node.value);

    const genres = availableGenres();

    // 現在の全ジャンルが選択され、取得結果にないジャンルを含まない場合は「すべて」
    const all =
      genres.length > 0 &&
      genres.every((name) => checked.includes(name)) &&
      checked.every((name) => genres.includes(name));

    state.draft.genreNames = all ? null : checked;
  }

  async function submitFilters() {
    state.filters = S.cleanFilters({
      ...state.draft,
      keyword: $("filter-keyword").value.trim().slice(0, 150),
      favoriteOnly: favoriteEnabled() && $("favorite-only").checked,
    });

    UI.hideOffcanvas("filter-sheet");

    applyFilters();

    if (state.page !== "results") go("results");

    if (!hasValidData()) {
      await fetchRestaurants();
    }
  }

  /* ====================================
       15. ホームからの検索
    ==================================== */

  function readQuickConditions() {
    const quickKeys = ["lunch", "parking", "barrierFree"];

    const selected = [...document.querySelectorAll('[name="quick-condition"]:checked')].map(
      (node) => node.value,
    );

    state.filters.conditions = [
      ...state.filters.conditions.filter((key) => !quickKeys.includes(key)),
      ...selected,
    ];
  }

  async function searchFromHome() {
    if (!requireConsent()) return;

    if (!S.getActiveLocation()) {
      openLocationEditor();
      return;
    }

    state.filters.keyword = $("keyword").value.trim().slice(0, 150);

    readQuickConditions();

    saveCurrentFilters();

    go("results");

    if (hasFreshData()) {
      renderResults();
      UI.announce(`条件に一致するお店は${state.filtered.length}件です。`);
    } else {
      await fetchRestaurants();
    }
  }

  function renderHome() {
    renderLocationViews();
    syncFilterControls();
  }

  /* ====================================
       16. お気に入り（FAV-01／FAV-02）
    ==================================== */

  async function loadFavorites() {
    state.favoriteController?.abort();

    const generation = ++state.favoriteGeneration;

    const list = $("favorite-list");
    const stateNode = $("favorite-state");

    list.replaceChildren();
    stateNode.replaceChildren();

    $("favorite-tabs").replaceChildren();
    $("favorite-status").textContent = "";

    if (!favoriteEnabled()) {
      $("refresh-favorites").hidden = true;

      stateNode.append(
        stateCard({
          type: "favorite",
          title: "お気に入りは提供準備中です",
          message:
            "店舗IDを長期保存するための利用条件（ホットペッパーグルメWebサービスの規約）を確認した後に提供します。",
          actions: [actionButton("お店を探す", () => go("results"), "gm-btn gm-btn-outline-primary gm-btn-sm", "magnifying-glass")],
        }),
      );

      return;
    }

    $("refresh-favorites").hidden = false;

    if (!requireConsent()) return;

    const ids = S.getFavoriteIds();

    if (!ids.length) {
      stateNode.append(
        stateCard({
          type: "favorite",
          title: "お気に入りの店舗はありません",
          message: "店舗のハートボタンを押すと、ここに保存されます。",
          actions: [actionButton("お店を探す", () => go("results"), "gm-btn gm-btn-outline-primary gm-btn-sm", "magnifying-glass")],
        }),
      );

      return;
    }

    state.favoriteController = new AbortController();
    state.favoriteLoading = true;

    stateNode.append(
      stateCard({ type: "loading", title: "通信中…", message: "保存した店舗の最新情報を取得しています。" }),
    );

    try {
      const result = await Q.fetchFavorites(S.getActiveLocation(), ids, {
        signal: state.favoriteController.signal,
      });

      if (generation !== state.favoriteGeneration || state.page !== "favorites") return;

      state.favoriteResult = result;
      state.favoriteShops = result.shops;

      renderFavorites();
    } finally {
      if (generation === state.favoriteGeneration) state.favoriteLoading = false;
    }
  }

  function renderFavorites() {
    const result = state.favoriteResult;

    if (!result) return;

    const ids = new Set(S.getFavoriteIds());

    const shops = state.favoriteShops.filter((shop) => ids.has(shop.id));

    const genres = Q.getGenres(shops);

    if (state.favoriteGenre && !genres.includes(state.favoriteGenre)) {
      state.favoriteGenre = null;
    }

    const tabs = [{ label: "すべて", value: null, count: shops.length }].concat(
      genres.map((genre) => ({
        label: genre,
        value: genre,
        count: shops.filter((shop) => shop.genre === genre).length,
      })),
    );

    $("favorite-tabs").replaceChildren(
      ...tabs.map((tab) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              className: "gm-chip gm-chip-tab",
              attrs: { type: "button", "aria-pressed": String(state.favoriteGenre === tab.value) },
              on: {
                click: () => {
                  state.favoriteGenre = tab.value;
                  renderFavorites();
                },
              },
            },
            `${tab.label}（${tab.count}）`,
          ),
        ),
      ),
    );

    const visible = shops.filter((shop) => !state.favoriteGenre || shop.genre === state.favoriteGenre);

    const list = $("favorite-list");

    list.replaceChildren(...visible.map((shop) => createCard(shop, "favorites")));

    const stateNode = $("favorite-state");

    stateNode.replaceChildren();

    // 掲載終了・欠損と取得失敗を区別し、解除可能にする
    const unresolved = [
      ...result.missingIds
        .filter((id) => ids.has(id))
        .map((id) => ({ id, message: "掲載が終了したか、情報を確認できない店舗です。" })),
      ...result.failedIds
        .filter((id) => ids.has(id))
        .map((id) => ({ id, message: "通信に失敗したため取得できませんでした。" })),
    ];

    for (const item of unresolved) {
      list.append(
        el(
          "li",
          {},
          el(
            "div",
            { className: "gm-list-card" },
            el("span", { className: "gm-list-icon" }, icon("circle-question")),
            el(
              "div",
              { className: "tw-min-w-0 tw-flex-1" },
              el("p", { className: "tw-m-0", text: item.message }),
              el("p", { className: "gm-list-sub", text: `店舗ID：${item.id}` }),
            ),
            actionButton("お気に入りから解除", async () => {
              const ok = await UI.confirm({
                title: "お気に入りを解除",
                message: "この店舗をお気に入りから解除しますか？",
                confirmLabel: "解除する",
                danger: true,
              });

              if (!ok) return;

              if (S.getFavoriteIds().includes(item.id)) S.toggleFavorite(item.id);

              renderFavorites();
            }),
          ),
        ),
      );
    }

    if (!shops.length && !unresolved.length) {
      stateNode.append(
        stateCard({ type: "favorite", title: "お気に入りの店舗はありません" }),
      );
    }

    if (result.errorCode) {
      stateNode.append(
        stateCard({
          type: "error",
          title: "一部のお気に入りを取得できませんでした",
          message: errorText(new Error(result.errorCode)),
          actions: [actionButton("再試行", loadFavorites, "gm-btn gm-btn-outline-primary gm-btn-sm", "rotate")],
        }),
      );
    }

    $("favorite-status").textContent =
      `${shops.length}件表示` +
      `／掲載未確認 ${result.missingIds.filter((id) => ids.has(id)).length}件` +
      `／取得失敗 ${result.failedIds.filter((id) => ids.has(id)).length}件` +
      `（取得日時：${formatDate(result.fetchedAt)}）`;
  }

  /* ====================================
       17. プリセット（PRE-01／PRE-02）
    ==================================== */

  async function savePreset(existing = null) {
    const current = S.getActiveLocation();

    if (!current) {
      openLocationEditor();
      return;
    }

    const name = await UI.prompt({
      title: existing ? "プリセット名の変更" : "検索条件をプリセットに保存",
      label: "プリセット名",
      value: existing?.name || "",
      hint: existing ? "" : `保存する条件：${Q.describeFilters(state.filters)}`,
      maxLength: 80,
    });

    if (!name) return;

    S.savePreset(
      current.id,
      name,
      existing ? existing.filters : state.filters,
      existing?.presetId,
    );

    UI.toast(existing ? "プリセット名を変更しました" : `「${name}」として保存しました`);

    if (state.page === "presets") renderPresets();
  }

  async function applyPreset(item) {
    state.filters = cloneFilters(item.filters);

    saveCurrentFilters();

    go("results");

    if (!hasValidData()) {
      await fetchRestaurants();
    } else {
      renderResults();
    }

    // 選択肢が存在しない場合は通知・再設定を可能にする
    const genres = availableGenres();

    const missing = (state.filters.genreNames || []).filter((name) => !genres.includes(name));

    if (state.result && missing.length) {
      showError(
        `プリセットのジャンル「${missing.join("・")}」は現在の取得結果にありません。必要に応じて条件を再設定してください。`,
        {
          action: actionButton("条件を再設定", (event) => openFilters(event.currentTarget), "gm-btn gm-btn-outline gm-btn-sm", "sliders"),
        },
      );
    } else {
      UI.toast(`「${item.name}」を適用しました`, "info");
    }
  }

  function renderPresets() {
    const current = S.getActiveLocation();
    const list = $("preset-list");

    $("preset-location-name").textContent = current ? `「${current.label}」` : "選択中の地点";

    list.replaceChildren();

    if (!current) {
      list.append(
        el(
          "li",
          {},
          stateCard({
            type: "location",
            title: "地点が登録されていません",
            message: "プリセットは地点ごとに保存されます。",
          }),
        ),
      );
      $("add-preset").disabled = true;
      return;
    }

    $("add-preset").disabled = false;

    const presets = S.getPresets(current.id);

    if (!presets.length) {
      list.append(
        el(
          "li",
          {},
          stateCard({
            type: "info",
            title: "保存した検索条件はありません",
            message: "検索結果画面の「条件を保存」や、上のボタンから登録できます。",
          }),
        ),
      );
      return;
    }

    for (const item of presets) {
      list.append(
        el(
          "li",
          { className: "gm-list-card" },
          el("span", { className: "gm-list-icon gm-list-icon-lg" }, icon("sliders")),
          el(
            "div",
            { className: "tw-min-w-0 tw-flex-1" },
            el("h2", { className: "gm-list-title", text: item.name }),
            el("p", { className: "gm-list-sub", text: Q.describeFilters(item.filters) }),
            el(
              "div",
              { className: "tw-mt-2" },
              actionButton("この条件で探す", () => applyPreset(item), "gm-btn gm-btn-primary gm-btn-sm", "magnifying-glass"),
            ),
          ),
          el(
            "div",
            { className: "gm-list-actions" },
            el(
              "button",
              {
                className: "gm-icon-btn gm-icon-btn-primary",
                attrs: { type: "button", "aria-label": `「${item.name}」の名前を変更` },
                on: { click: () => run(() => savePreset(item)) },
              },
              icon("pen"),
            ),
            el(
              "button",
              {
                className: "gm-icon-btn gm-icon-btn-primary",
                attrs: { type: "button", "aria-label": `「${item.name}」を現在の条件で上書き` },
                on: {
                  click: () =>
                    run(async () => {
                      const ok = await UI.confirm({
                        title: "プリセットの上書き",
                        message: `「${item.name}」を現在の検索条件で上書きしますか？`,
                        detail: `現在の条件：${Q.describeFilters(state.filters)}`,
                        confirmLabel: "上書きする",
                      });

                      if (!ok) return;

                      S.savePreset(item.locationId, item.name, state.filters, item.presetId);

                      UI.toast("プリセットを上書きしました");

                      renderPresets();
                    }),
                },
              },
              icon("floppy-disk"),
            ),
            el(
              "button",
              {
                className: "gm-icon-btn gm-icon-btn-danger",
                attrs: { type: "button", "aria-label": `「${item.name}」を削除` },
                on: {
                  click: () =>
                    run(async () => {
                      const ok = await UI.confirm({
                        title: "プリセットの削除",
                        message: `「${item.name}」を削除しますか？`,
                        confirmLabel: "削除する",
                        danger: true,
                      });

                      if (!ok) return;

                      S.deletePreset(item.presetId);

                      UI.toast("プリセットを削除しました");

                      renderPresets();
                    }),
                },
              },
              icon("trash-can"),
            ),
          ),
        ),
      );
    }
  }

  /* ====================================
       18. 外観・設定（UX-07／API-04）
    ==================================== */

  function applyAppearance() {
    const settings = S.load().appSettings;
    const root = document.documentElement;

    const theme =
      settings.theme === "system" ? (themeMedia.matches ? "dark" : "light") : settings.theme;

    root.dataset.theme = theme;
    root.setAttribute("data-bs-theme", theme);
    root.dataset.fontSize = settings.fontSize;
    root.dataset.contrast = settings.contrast ? "high" : "normal";
    root.dataset.reduceMotion = String(settings.reduceMotion);

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#1c1917" : "#c2410c");

    // 文字サイズ変更後に地図サイズを再計算
    M.invalidate();
  }

  function setRadio(name, value) {
    const node = document.querySelector(`input[name="${name}"][value="${value}"]`);

    if (node) node.checked = true;
  }

  function renderSettings() {
    const settings = S.load().appSettings;

    setRadio("theme", settings.theme);
    setRadio("font-size", settings.fontSize);

    $("high-contrast").checked = settings.contrast;
    $("reduce-motion").checked = settings.reduceMotion;
    $("auto-refresh").checked = settings.autoRefreshEnabled;
    $("refresh-interval").value = String(settings.interval);
    $("refresh-interval").disabled = !settings.autoRefreshEnabled;
  }

  function saveSettingsForm() {
    S.updateSettings({
      theme: document.querySelector('input[name="theme"]:checked')?.value || "system",
      fontSize: document.querySelector('input[name="font-size"]:checked')?.value || "normal",
      contrast: $("high-contrast").checked,
      reduceMotion: $("reduce-motion").checked,
      autoRefreshEnabled: $("auto-refresh").checked,
      interval: Number($("refresh-interval").value),
    });

    applyAppearance();
    renderSettings();

    UI.announce("設定を保存しました。");
  }

  /* ====================================
       19. データ管理（DATA-01〜06）
    ==================================== */

  function renderData() {
    const data = S.load();

    const kb = (S.getStorageSize() / 1024).toFixed(1);

    $("storage-size").textContent =
      `使用容量：約${kb}KB（地点${data.locations.length}件・プリセット${data.presets.length}件` +
      (C.FAVORITES_ENABLED ? `・お気に入り${data.favorites.length}件` : "") +
      "）";

    $("clear-favorites").hidden = !C.FAVORITES_ENABLED;
  }

  async function exportBackup() {
    const ok = await UI.confirm({
      title: "バックアップの作成",
      message: "バックアップファイルには登録地点の住所や座標が含まれる場合があります。",
      detail: "他人と共有しない場所に保存してください。",
      confirmLabel: "作成する",
    });

    if (!ok) return;

    S.exportBackup();

    UI.toast("バックアップを作成しました");
  }

  async function importBackup() {
    const file = $("backup-file").files[0];

    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || "merge";

    if (!file) {
      UI.toast("バックアップファイルを選択してください。", "warning");
      $("backup-file").focus();
      return;
    }

    if (file.size > C.MAX_BACKUP_BYTES) {
      throw new Error("ERR_BACKUP_SIZE");
    }

    // 事前に検証し、内容を確認してから反映
    const parsed = S.parseBackup(await file.text());

    const ok = await UI.confirm({
      title: "バックアップの復元",
      message:
        mode === "replace"
          ? "現在の利用者データをすべて上書きします。よろしいですか？"
          : "既存データを残して追加します。よろしいですか？",
      detail: `ファイルの内容：地点${parsed.locations.length}件・プリセット${parsed.presets.length}件` +
        (C.FAVORITES_ENABLED ? `・お気に入り${parsed.favorites.length}件` : "") +
        "・各種設定",
      confirmLabel: "復元する",
      danger: mode === "replace",
    });

    if (!ok) return;

    const report = S.applyBackup(parsed, mode);

    state.locationKey = null;

    $("backup-file").value = "";

    applyAppearance();
    renderSettings();
    renderData();

    await changeLocation();

    UI.toast(
      mode === "replace"
        ? "バックアップで上書きしました"
        : `復元しました（追加：地点${report.locations}件・プリセット${report.presets}件／重複${report.duplicates}件はスキップ）`,
    );
  }

  async function confirmAndRun(options, handler) {
    const ok = await UI.confirm({ confirmLabel: "削除する", danger: true, ...options });

    if (!ok) return;

    await handler();

    renderData();
  }

  /* ====================================
       20. システムステータス・お知らせ（SCR-19／20／26）
    ==================================== */

  const STATUS_LABELS = Object.freeze({
    online: { label: "正常に稼働中", className: "gm-status-ok" },
    degraded: { label: "一部機能に制限あり", className: "gm-status-warn" },
    maintenance: { label: "メンテナンス中", className: "gm-status-maint" },
    failure: { label: "障害", className: "gm-status-error" },
    success: { label: "正常", className: "gm-status-ok" },
    unknown: { label: "未確認", className: "gm-status-unknown" },
  });

  function statusMeta(value) {
    return STATUS_LABELS[value] || STATUS_LABELS.unknown;
  }

  function renderStatus() {
    const status = state.serverStatus;
    const badge = $("system-status-badge");
    const meta = statusMeta(status?.status);

    badge.textContent = meta.label;
    badge.className = `gm-status-badge ${meta.className}`;

    $("system-status-text").textContent = status
      ? status.message || ""
      : "GASへの接続状態は未確認です。";

    $("system-checked-at").textContent = status?.fetchedAt
      ? `最終確認：${formatDate(status.fetchedAt)}`
      : "";

    const services = Array.isArray(status?.services) ? status.services : [];

    $("service-status-list").replaceChildren(
      ...services.map((service) => {
        const serviceMeta = statusMeta(service.status);

        const details = [];

        if (Number.isFinite(service.successRate)) {
          details.push(`成功率 ${service.successRate}%`);
        }

        if (Number.isFinite(service.responseMs)) {
          details.push(`応答 ${service.responseMs}ms`);
        }

        if (service.checkedAt) {
          details.push(`確認 ${formatDate(service.checkedAt)}`);
        }

        return el(
          "li",
          {},
          el("span", { className: "tw-font-semibold", text: String(service.name || "") }),
          el("span", { className: `gm-status-badge gm-status-sm ${serviceMeta.className}`, text: serviceMeta.label }),
          el("span", { className: "gm-help tw-m-0 tw-w-full", text: details.join("／") }),
        );
      }),
    );

    const notices = Array.isArray(status?.notices) ? status.notices : [];

    $("notice-list").replaceChildren(
      ...(notices.length
        ? notices.map((notice) =>
            el(
              "li",
              {},
              el("p", { className: "gm-help tw-m-0", text: notice.publishedAt ? formatDate(notice.publishedAt).slice(0, 10) : "" }),
              el("h3", { className: "gm-list-title", text: String(notice.title || "") }),
              el("p", { className: "tw-m-0", text: String(notice.body || "") }),
            ),
          )
        : [el("li", { className: "gm-help", text: status ? "現在お知らせはありません。" : "お知らせを取得できていません。" })]),
    );
  }

  async function checkSystemStatus(options = {}) {
    const badge = $("system-status-badge");

    if (!options.silent) {
      badge.textContent = "確認中…";
      badge.className = "gm-status-badge gm-status-unknown";
    }

    try {
      const result = await A.getStatus();

      state.serverStatus = result && typeof result === "object" ? result : null;
      state.serverFavoritesEnabled = result?.favoritesEnabled === true;

      if (result?.status === "online" && state.refreshPaused) {
        state.refreshPaused = false;
      }

      const maintenance = result?.status === "maintenance" || result?.maintenance?.active === true;

      $("maintenance-banner").hidden = !maintenance;
      $("maintenance-text").textContent = maintenance
        ? String(result?.maintenance?.message || "現在メンテナンス中です。終了までお待ちください。")
        : "";

      if (!options.silent) UI.toast("システムの状態を確認しました", "info");
    } catch (error) {
      state.serverStatus = {
        status: "unknown",
        message: `GASに接続できないため状態を確認できません（${errorCode(error)}）。`,
        fetchedAt: new Date().toISOString(),
      };

      state.serverFavoritesEnabled = false;
    }

    if (!favoriteEnabled() && state.filters.favoriteOnly) {
      state.filters.favoriteOnly = false;
    }

    renderStatus();

    if (state.page === "results") renderResults(false);
    if (state.page === "favorites") run(loadFavorites);
  }

  function renderAbout() {
    const consent = S.load().consent;

    $("app-version").textContent = C.APP_VERSION;
    $("terms-version").textContent = C.TERMS_VERSION;
    $("privacy-version").textContent = C.PRIVACY_VERSION;
    $("consent-date").textContent = consent?.acceptedAt ? `${formatDate(consent.acceptedAt)}（JST）` : "未同意";
  }

  /* ====================================
       21. 自動更新・保持期限（API-04／PER-02）
    ==================================== */

  async function autoRefresh() {
    expireIfNeeded();

    if (
      document.hidden ||
      !navigator.onLine ||
      !S.hasConsent() ||
      state.loading ||
      state.refreshPaused ||
      UI.isOpen("location-modal") ||
      !S.getActiveLocation()
    ) {
      return;
    }

    const settings = S.load().appSettings;

    if (!settings.autoRefreshEnabled) return;

    if (Date.now() - state.lastAttempt >= settings.interval * 60000) {
      await fetchRestaurants({ reason: "auto" });
    }
  }

  /* ====================================
       22. イベント登録
    ==================================== */

  function bindEvents() {
    window.addEventListener("hashchange", () => run(() => navigate(currentHash())));

    // ホーム
    $("location-select").addEventListener("change", (event) =>
      run(() => selectLocation(event.target.value)),
    );

    $("home-add-location").addEventListener("click", (event) =>
      run(() => openLocationEditor(null, event.currentTarget)),
    );

    $("search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      run(searchFromHome);
    });

    let keywordTimer;

    // 300msデバウンス（SR-05）
    $("keyword").addEventListener("input", () => {
      clearTimeout(keywordTimer);

      const key = state.locationKey;

      keywordTimer = setTimeout(() => {
        if (key !== state.locationKey) return;

        run(() => {
          state.filters.keyword = $("keyword").value.trim().slice(0, 150);
          saveCurrentFilters();
        });
      }, C.SEARCH_DEBOUNCE_MS);
    });

    document.querySelectorAll('[name="quick-condition"]').forEach((node) => {
      node.addEventListener("change", () =>
        run(() => {
          readQuickConditions();
          saveCurrentFilters();
        }),
      );
    });

    // 検索結果
    $("refresh-results").addEventListener("click", () =>
      run(() => fetchRestaurants({ force: true })),
    );

    $("show-list").addEventListener("click", () => go("results"));
    $("show-map").addEventListener("click", () => go("map"));

    $("load-more").addEventListener("click", () =>
      run(() => {
        const before = state.visibleCount;

        state.visibleCount += C.DISPLAY_COUNT;

        renderResults(false);

        UI.announce(`${Math.min(state.visibleCount, state.filtered.length)}件まで表示しました。`);

        // 追加された最初の店舗へフォーカス
        $("restaurant-list").querySelectorAll('[data-action="details"]')[before]?.focus();
      }),
    );

    $("sort").addEventListener("change", () =>
      run(() => {
        state.filters.sort = $("sort").value;
        applyFilters({ fitMap: false });
      }),
    );

    $("open-filter").addEventListener("click", (event) => run(() => openFilters(event.currentTarget)));

    $("quick-save-preset").addEventListener("click", () => run(() => savePreset()));

    $("restaurant-list").addEventListener("click", onCardClick);
    $("favorite-list").addEventListener("click", onCardClick);

    // 絞り込み
    $("filter-form").addEventListener("submit", (event) => {
      event.preventDefault();
      run(submitFilters);
    });

    let filterKeywordTimer;

    $("filter-keyword").addEventListener("input", () => {
      clearTimeout(filterKeywordTimer);

      filterKeywordTimer = setTimeout(() => {
        state.draft.keyword = $("filter-keyword").value.trim().slice(0, 150);
        updateFilterCount();
      }, C.SEARCH_DEBOUNCE_MS);
    });

    $("radius-range").addEventListener("input", () => {
      state.draft.radiusM = C.DISTANCE_OPTIONS[Number($("radius-range").value)] || C.MAX_RADIUS_M;
      updateRadiusOutput();
      updateFilterCount();
    });

    $("genre-options").addEventListener("change", () => {
      readGenreSelection();
      updateGenreNote();
      updateFilterCount();
    });

    $("genre-more").addEventListener("click", () => {
      state.genreExpanded = !state.genreExpanded;

      renderGenreOptions();

      if (state.genreExpanded) {
        $("genre-options").querySelectorAll("input")[GENRE_VISIBLE_COUNT]?.focus();
      }
    });

    $("select-all-genres").addEventListener("click", () => {
      state.draft.genreNames = null;
      renderGenreOptions();
      updateFilterCount();
      UI.announce("すべてのジャンルを選択しました。");
    });

    $("clear-genres").addEventListener("click", () => {
      state.draft.genreNames = [];
      renderGenreOptions();
      updateFilterCount();
      UI.announce("ジャンルの選択をすべて解除しました。");
    });

    $("condition-options").addEventListener("change", () => {
      state.draft.conditions = [
        ...$("condition-options").querySelectorAll("input:checked"),
      ].map((node) => node.value);

      updateFilterCount();
    });

    $("favorite-only").addEventListener("change", () => {
      state.draft.favoriteOnly = favoriteEnabled() && $("favorite-only").checked;
      updateFilterCount();
    });

    $("reset-filters").addEventListener("click", () => {
      state.draft = { ...S.defaultFilters(), sort: state.draft.sort };
      renderFilterControls();
      UI.announce("条件をクリアしました。「この条件で検索」で反映されます。");
    });

    // 店舗詳細・共有
    $("shop-modal").addEventListener("shown.bs.modal", () => $("shop-title").focus());

    $("shop-modal").addEventListener("hidden.bs.modal", () => {
      $("shop-hero").replaceChildren();
      $("shop-details").replaceChildren();
      $("shop-actions").replaceChildren();
      $("share-qr-image").removeAttribute("src");

      if (state.shopFavoriteChanged) {
        if (state.page === "results") renderResults(false);
        if (state.page === "favorites") renderFavorites();
      }

      state.shopFavoriteChanged = false;
    });

    $("share-line").addEventListener("click", () => run(shareLine));
    $("share-copy").addEventListener("click", () => run(copyShopLink));
    $("share-qr").addEventListener("click", () => run(toggleQr));
    $("share-native").addEventListener("click", () => run(shareNative));

    // 地点登録
    $("add-location").addEventListener("click", (event) =>
      run(() => openLocationEditor(null, event.currentTarget)),
    );

    document.querySelectorAll('input[name="location-method"]').forEach((node) => {
      node.addEventListener("change", () => run(() => setLocationMethod(node.value)));
    });

    $("location-modal").addEventListener("shown.bs.modal", () => {
      $("location-title").focus();
      updateLocationMap(true);
    });

    $("location-modal").addEventListener("hidden.bs.modal", () => {
      state.locationGeneration++;
      state.locationController?.abort();
      M.hideLocationPicker();
    });

    $("search-address").addEventListener("click", () => run(searchAddress));

    $("address-query").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        run(searchAddress);
      }
    });

    $("use-gps").addEventListener("click", () => run(useGps));

    $("latitude").addEventListener("change", onCoordinateInput);
    $("longitude").addEventListener("change", onCoordinateInput);

    $("location-name").addEventListener("input", () => {
      $("location-name-error").hidden = true;
      $("location-name").removeAttribute("aria-invalid");
    });

    $("location-form").addEventListener("submit", (event) => {
      event.preventDefault();
      run(saveLocationForm);
    });

    // プリセット
    $("add-preset").addEventListener("click", () => run(() => savePreset()));

    // 設定（自動保存）
    $("settings-form").addEventListener("change", () => run(saveSettingsForm));

    $("reset-appearance").addEventListener("click", () =>
      run(() => {
        S.resetAppearance();
        applyAppearance();
        renderSettings();
        UI.toast("表示設定を初期化しました");
      }),
    );

    // データ管理
    $("export-backup").addEventListener("click", () => run(exportBackup));
    $("import-backup").addEventListener("click", () => run(importBackup));

    $("clear-filters").addEventListener("click", () =>
      run(() =>
        confirmAndRun({ title: "前回の検索条件を削除", message: "すべての地点の前回の検索条件を削除しますか？" }, () => {
          S.clearLastFilters();
          state.filters = S.defaultFilters();
          syncFilterControls();
          UI.toast("前回の検索条件を削除しました");
        }),
      ),
    );

    $("clear-presets").addEventListener("click", () =>
      run(() =>
        confirmAndRun({ title: "プリセットを削除", message: "すべての地点のプリセットを削除しますか？" }, () => {
          S.clearPresets();
          UI.toast("プリセットを削除しました");
        }),
      ),
    );

    $("clear-favorites").addEventListener("click", () =>
      run(() =>
        confirmAndRun({ title: "お気に入りを削除", message: "すべてのお気に入りを削除しますか？" }, () => {
          S.clearFavorites();
          UI.toast("お気に入りを削除しました");
        }),
      ),
    );

    $("reset-settings").addEventListener("click", () =>
      run(() =>
        confirmAndRun(
          { title: "設定の初期化", message: "表示・自動更新の設定を初期値に戻しますか？", confirmLabel: "初期化する" },
          () => {
            S.resetSettings();
            applyAppearance();
            renderSettings();
            UI.toast("設定を初期化しました");
          },
        ),
      ),
    );

    $("clear-data").addEventListener("click", () =>
      run(() =>
        confirmAndRun(
          {
            title: "すべての利用者データを削除",
            message: "登録地点・検索条件・プリセット・設定・同意情報をすべて削除しますか？",
            detail: "この操作は取り消せません。必要な場合は先にバックアップを作成してください。",
          },
          () => {
            state.controller?.abort();
            state.favoriteController?.abort();
            state.locationController?.abort();

            S.clear();

            location.hash = "home";
            location.reload();
          },
        ),
      ),
    );

    // ステータス
    $("check-status").addEventListener("click", () => run(() => checkSystemStatus()));

    // 規約同意
    $("consent-next").addEventListener("click", () => setConsentStep(Math.min(4, state.consentStep + 1)));
    $("consent-back").addEventListener("click", () => setConsentStep(Math.max(1, state.consentStep - 1)));
    $("consent-skip").addEventListener("click", () => setConsentStep(4));

    $("consent-checkbox").addEventListener("change", () => {
      $("accept-consent").disabled = !$("consent-checkbox").checked;
    });

    $("accept-consent").addEventListener("click", () => run(acceptConsent));

    $("consent-modal").addEventListener("shown.bs.modal", () => {
      document.querySelector('#consent-modal .gm-step:not([hidden]) h3')?.focus();
    });

    // 共通
    $("app-error-close").addEventListener("click", () => {
      clearError();
      $("main-content").focus();
    });

    themeMedia.addEventListener("change", () => run(applyAppearance));

    wideMedia.addEventListener("change", () =>
      run(() => {
        if (state.page === "results") renderResults();
      }),
    );

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) run(autoRefresh);
    });

    window.addEventListener("online", () => {
      $("offline-banner").hidden = true;

      UI.toast("インターネット接続が回復しました", "info");

      run(async () => {
        if (!state.result && S.getActiveLocation() && S.hasConsent()) {
          await fetchRestaurants();
        } else {
          await autoRefresh();
        }
      });
    });

    window.addEventListener("offline", () => {
      $("offline-banner").hidden = false;
    });

    setInterval(() => run(autoRefresh), 15000);
  }

  /* ====================================
       23. 初期化
    ==================================== */

  function copyLegalTexts() {
    // 規約本文は1か所で管理し、初回案内にも複製して表示
    const terms = $("terms-content").cloneNode(true);
    const privacy = $("privacy-content").cloneNode(true);

    for (const node of [terms, privacy]) {
      node.removeAttribute("id");
      node.classList.remove("gm-card");

      node.querySelectorAll("h2").forEach((heading) => {
        const h4 = el("h4", { text: heading.textContent });
        heading.replaceWith(h4);
      });

      node.querySelectorAll("h3").forEach((heading) => {
        const h5 = el("h5", { text: heading.textContent });
        heading.replaceWith(h5);
      });
    }

    $("consent-terms").replaceChildren(...terms.childNodes);
    $("consent-privacy").replaceChildren(...privacy.childNodes);
  }

  async function initialize() {
    if (!S.isAvailable()) {
      $("storage-banner").hidden = false;
    }

    try {
      S.load();
    } catch (error) {
      showError(
        errorText(error) + " 既存データは削除していません。",
        {
          action: el(
            "button",
            {
              className: "gm-btn gm-btn-danger gm-btn-sm",
              attrs: { type: "button" },
              on: {
                click: () =>
                  run(async () => {
                    const ok = await UI.confirm({
                      title: "保存データの初期化",
                      message: "読み込めない保存データを削除して初期化しますか？",
                      confirmLabel: "初期化する",
                      danger: true,
                    });

                    if (!ok) return;

                    S.clear();
                    location.reload();
                  }),
              },
            },
            "保存データを初期化",
          ),
        },
      );

      return;
    }

    if (!navigator.onLine) {
      $("offline-banner").hidden = false;
    }

    copyLegalTexts();
    bindEvents();
    applyAppearance();

    const current = S.getActiveLocation();

    state.filters = current ? S.getFilters(current.id) : S.defaultFilters();

    renderLocationViews();
    syncFilterControls();
    renderSettings();

    navigate(currentHash(), { focus: false });

    // ステータスは同意前でも取得可（個人データを送信しない）
    const statusCheck = run(() => checkSystemStatus({ silent: true }));

    if (!S.hasConsent()) {
      openConsent();
      return;
    }

    await statusCheck;

    // 起動時に取得（API-03）
    await changeLocation();
  }

  run(initialize);
})(window.GourmetMap);
