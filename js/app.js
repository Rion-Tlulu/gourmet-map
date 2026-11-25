(function (GM) {
  "use strict";

  const C = GM.Config;
  const S = GM.Storage;
  const A = GM.Api;
  const Q = GM.Search;

  const $ = (id) => document.getElementById(id);

  const state = {
    page: "home",
    view: "list",

    shops: [],
    favoriteShops: [],

    filters: S.defaultFilters(),
    visibleCount: C.DISPLAY_COUNT,

    result: null,

    locationKey: null,

    loading: false,
    controller: null,
    generation: 0,

    favoriteController: null,
    favoriteGeneration: 0,

    favoriteFetchedAt: 0,

    lastAttempt: 0,
    refreshPaused: false,

    serverFavoritesEnabled: false,

    editingLocationId: null,
    selectedCandidate: null,

    locationGeneration: 0,
    locationController: null,

    filterAllGenres: true,
  };

  const themeMedia = matchMedia("(prefers-color-scheme: dark)");

  const wideMedia = matchMedia("(min-width: 1024px)");

  /* ====================================
       01. 共通処理
    ==================================== */

  function element(tag, text, className) {
    const node = document.createElement(tag);

    if (text !== undefined) {
      node.textContent = text;
    }

    if (className) {
      node.className = className;
    }

    return node;
  }

  function button(label, handler, className) {
    const node = element("button", label, className);

    node.type = "button";

    node.addEventListener("click", () => {
      run(handler);
    });

    return node;
  }

  function showStatus(message = "") {
    $("app-status").textContent = message;
    $("app-status").hidden = !message;
  }

  function showError(message = "") {
    $("app-error").textContent = message;
    $("app-error").hidden = !message;
  }

  function errorText(error) {
    const messages = {
      ERR_NETWORK: "通信に失敗しました。接続を確認してください。",

      ERR_OFFLINE: "オフラインです。インターネット接続を確認してください。",

      ERR_TIMEOUT: "通信がタイムアウトしました。",

      ERR_RATE_LIMIT:
        "API利用制限に達しました。時間をおいて再試行してください。",

      ERR_BUSY: "現在通信が混み合っています。",

      ERR_LOCATION:
        "地点を取得できませんでした。別の登録方法をお試しください。",

      ERR_STORAGE:
        "保存データを処理できませんでした。形式や容量を確認してください。",

      ERR_CONSENT: "利用規約への同意が必要です。",

      ERR_MAINTENANCE: "現在メンテナンス中です。",

      ERR_DISABLED: "この機能は現在利用できません。",

      ERR_MAP: "地図を表示できません。店舗一覧をご利用ください。",

      ERR_PARTIAL: "店舗情報をすべて取得できませんでした。",

      ERR_INPUT: "入力内容を確認してください。",
    };

    const message =
      messages[error.message] ||
      "処理に失敗しました。設定や通信状態をご確認ください。";

    return (
      message + (error.requestId ? `（識別番号：${error.requestId}）` : "")
    );
  }

  async function run(handler) {
    try {
      return await handler();
    } catch (error) {
      if (error.name !== "AbortError") {
        const message = errorText(error);

        if ($("location-dialog").open) {
          $("location-message").textContent = message;
        } else if ($("shop-dialog").open) {
          $("shop-message").textContent = message;
        } else {
          showError(message);
        }
      }
    }
  }

  function locationKey(location) {
    return location ? `${location.id}:${location.lat}:${location.lng}` : null;
  }

  function favoriteEnabled() {
    return C.FAVORITES_ENABLED && state.serverFavoritesEnabled;
  }

  function formatDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) {
      return "未取得";
    }

    return (
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hourCycle: "h23",
      }).format(new Date(value)) + " JST"
    );
  }

  /* ====================================
       02. モーダル
    ==================================== */

  function openDialog(id) {
    const dialog = $(id);

    if (dialog.open) return;

    dialog._trigger = document.activeElement;

    dialog.showModal();
  }

  function setupDialogs() {
    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("close", () => {
        if (dialog._trigger?.isConnected) {
          dialog._trigger.focus();
        }
      });
    });
  }

  /* ====================================
       03. 画面切替
    ==================================== */

  function navigate(page, focus = true) {
    if (page === "map") {
      state.view = "map";
      page = "results";
    }

    if (page === "list") {
      state.view = "list";
      page = "results";
    }

    if (!$(`page-${page}`)) {
      page = "home";
    }

    state.page = page;

    document.querySelectorAll(".page").forEach((section) => {
      section.hidden = section.id !== `page-${page}`;
    });

    document.querySelectorAll(".bottom-nav button").forEach((node) => {
      const selected =
        node.dataset.page === page ||
        (page === "results" &&
          state.view === "map" &&
          node.dataset.page === "map");

      const active =
        node.dataset.page === "results"
          ? page === "results" && state.view === "list"
          : selected;

      if (active) {
        node.setAttribute("aria-current", "page");
      } else {
        node.removeAttribute("aria-current");
      }
    });

    if (page !== "results") {
      GM.Map.hideRestaurants();
    }

    if (page === "results") {
      renderResults();
    }

    if (page === "locations") {
      renderLocations();
    }

    if (page === "favorites") {
      run(loadFavorites);
    }

    if (page === "presets") {
      renderPresets();
    }

    if (page === "settings") {
      renderSettings();
    }

    if (focus) {
      $("main-content").focus();

      window.scrollTo({
        top: 0,
        behavior: "instant",
      });
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
       04. 初回利用
    ==================================== */

  function checkConsent() {
    if (!S.hasConsent()) {
      openDialog("consent-dialog");

      return false;
    }

    return true;
  }

  /* ====================================
       05. 地点管理
    ==================================== */

  function renderLocationSelect() {
    const data = S.load();

    const select = $("location-select");

    select.replaceChildren();

    if (!data.locations.length) {
      const empty = new Option("地点を登録してください", "");

      select.append(empty);

      return;
    }

    for (const item of data.locations) {
      const option = new Option(item.label, item.id);

      option.selected = item.id === data.appSettings.activeLocationId;

      select.append(option);
    }
  }

  function openLocationEditor(item = null) {
    if (!checkConsent()) return;

    state.locationController?.abort();
    state.locationGeneration++;

    state.editingLocationId = item?.id || null;
    state.selectedCandidate = item;

    $("location-title").textContent = item ? "地点の編集" : "地点の登録";

    $("location-name").value = item?.label || "";
    $("latitude").value = item?.lat ?? "";
    $("longitude").value = item?.lng ?? "";

    $("address-query").value = "";
    $("location-address").textContent = item?.address || "";

    $("location-candidates").replaceChildren();

    $("location-message").textContent = "";

    $("location-map").hidden = true;

    openDialog("location-dialog");
  }

  function fillLocation(candidate) {
    state.selectedCandidate = candidate;

    if (candidate.label) {
      $("location-name").value = candidate.label;
    }

    $("latitude").value = candidate.lat;
    $("longitude").value = candidate.lng;

    $("location-address").textContent = [
      candidate.address,
      candidate.attribution,
    ]
      .filter(Boolean)
      .join(" / ");

    $("location-message").textContent =
      "位置を確認し、地点名を付けて保存してください。";
  }

  function renderLocations() {
    const data = S.load();

    const list = $("location-list");

    list.replaceChildren();

    if (!data.locations.length) {
      list.append(
        element("p", "登録地点はありません。新しい地点を登録してください。"),
      );
    }

    for (const item of data.locations) {
      const card = element("article", undefined, "management-card");

      card.append(
        element("h3", item.label),

        element("p", item.address || `${item.lat}, ${item.lng}`),

        element("small", item.attribution || ""),
      );

      const actions = element("div", undefined, "action-row");

      actions.append(
        button("この地点を使用", async () => {
          S.selectLocation(item.id);

          await changeLocation();

          go("home");
        }),

        button("編集", () => openLocationEditor(item)),

        button(
          "削除",
          async () => {
            if (!confirm("この地点と関連する検索条件を削除しますか？")) return;

            S.deleteLocation(item.id);

            await changeLocation();

            renderLocations();
          },

          "danger-button",
        ),
      );

      card.append(actions);

      list.append(card);
    }
  }

  async function changeLocation() {
    const current = S.getActiveLocation();

    const key = locationKey(current);

    const changed = key !== state.locationKey;

    state.favoriteController?.abort();
    state.favoriteGeneration++;

    state.favoriteShops = [];
    state.favoriteFetchedAt = 0;

    if (changed) {
      state.controller?.abort();

      state.generation++;
      state.loading = false;

      state.shops = [];
      state.result = null;

      state.locationKey = key;

      state.refreshPaused = false;

      state.filters = current ? S.getFilters(current.id) : S.defaultFilters();

      state.visibleCount = C.DISPLAY_COUNT;
    }

    renderLocationSelect();

    syncFilterControls();

    if (!current) {
      GM.Map.hideRestaurants();

      renderResults();

      showStatus("検索する地点を登録してください。");

      return;
    }

    if (changed && S.hasConsent()) {
      await fetchRestaurants({
        navigateAfter: false,
      });
    } else {
      renderResults();
    }
  }

  /* ====================================
       06. 店舗取得
    ==================================== */

  async function fetchRestaurants(options = {}) {
    if (!checkConsent()) return;

    const current = S.getActiveLocation();

    if (!current) {
      go("locations");
      return;
    }

    if (state.loading) return;

    const generation = ++state.generation;

    const key = locationKey(current);

    state.controller = new AbortController();

    state.loading = true;
    state.lastAttempt = Date.now();

    state.locationKey = key;

    if (options.force) {
      state.refreshPaused = false;
    }

    $("refresh-results").disabled = true;

    showError("");

    showStatus("店舗情報を取得しています。");

    try {
      const result = await Q.fetchAll(current, {
        force: options.force === true,

        signal: state.controller.signal,

        onProgress(progress) {
          if (generation !== state.generation) {
            return;
          }

          showStatus(`${progress.received} / ` + `${progress.total}件取得中`);
        },
      });

      if (
        generation !== state.generation ||
        key !== locationKey(S.getActiveLocation())
      )
        return;

      const oldValid =
        state.result?.fetchedAt &&
        Date.now() - Date.parse(state.result.fetchedAt) < C.DATA_TTL_MS;

      if (result.fetchedAt || !oldValid) {
        state.shops = result.shops;
        state.result = result;

        state.visibleCount = C.DISPLAY_COUNT;
      }

      if (
        ["ERR_RATE_LIMIT", "ERR_MAINTENANCE", "ERR_DISABLED"].includes(
          result.errorCode,
        )
      ) {
        state.refreshPaused = true;
      }

      if (result.errorCode) {
        const error = new Error(result.errorCode);

        error.requestId = result.requestId;

        showError(errorText(error));
      }

      showStatus("");

      renderResults(true);

      if (options.navigateAfter) {
        go("results");
      }
    } finally {
      if (generation === state.generation) {
        state.loading = false;

        $("refresh-results").disabled = false;
      }
    }
  }

  /* ====================================
       07. 外部URL・画像
    ==================================== */

  function safeUrl(value, domains) {
    try {
      const url = new URL(value);

      const allowed = domains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith("." + domain),
      );

      if (
        url.protocol !== "https:" ||
        !allowed ||
        url.username ||
        url.password ||
        url.port
      )
        return null;

      return url.href;
    } catch {
      return null;
    }
  }

  function shopUrl(shop) {
    return safeUrl(shop.url, ["hotpepper.jp"]);
  }

  function imageFor(shop) {
    const wrapper = element("div", undefined, "shop-photo");

    const image = document.createElement("img");

    const sources = (shop.photos || [])
      .map((url) => safeUrl(url, ["hotpepper.jp", "hotp.jp"]))
      .filter(Boolean);

    let index = 0;

    image.alt = `${shop.name}の提供画像`;
    image.loading = "lazy";
    image.decoding = "async";

    function next() {
      if (index < sources.length) {
        image.src = sources[index++];
      } else {
        image.removeEventListener("error", next);

        image.src = "./assets/images/no-image.svg";

        image.alt = "店舗画像なし";
      }
    }

    image.addEventListener("error", next);

    next();

    wrapper.append(
      image,

      element("small", "画像提供：ホットペッパーグルメ"),
    );

    return wrapper;
  }

  function externalLink(label, href) {
    const link = element("a", label, "secondary-button link-button");

    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    return link;
  }

  /* ====================================
       08. 店舗カード
    ==================================== */

  function createCard(shop) {
    const article = element("article", undefined, "restaurant-card");

    const content = element("div", undefined, "restaurant-content");

    content.append(
      element("h3", shop.name || "店舗名なし"),

      element("span", shop.genre || "ジャンル情報なし", "genre-chip"),

      element("p", shop.catchCopy || "情報なし"),

      element(
        "p",
        Number.isFinite(shop.distanceM)
          ? `${Q.formatDistance(shop.distanceM)} / ` +
              `徒歩約${shop.walkingMinutes}分（目安）`
          : "距離情報なし",
        "distance-text",
      ),

      element("p", shop.address || "住所情報なし"),

      element("p", `営業時間：${shop.open || "情報なし"}`),

      element("p", `定休日：${shop.close || "情報なし"}`),

      element("p", `平均ディナー予算：${shop.budget || "情報なし"}`),
    );

    const actions = element("div", undefined, "action-row");

    actions.append(button("店舗詳細", () => openShop(shop)));

    if (favoriteEnabled()) {
      const selected = S.getFavoriteIds().includes(shop.id);

      const favoriteButton = button(
        selected ? "♥ 保存済み" : "♡ 保存",

        () => {
          const active = S.toggleFavorite(shop.id);

          favoriteButton.textContent = active ? "♥ 保存済み" : "♡ 保存";

          favoriteButton.setAttribute("aria-pressed", String(active));

          state.favoriteFetchedAt = 0;

          if (state.filters.favoriteOnly) {
            renderResults();
          }

          if (state.page === "favorites") {
            state.favoriteShops = state.favoriteShops.filter(
              (item) => item.id !== shop.id || active,
            );

            if (!active) article.remove();
          }
        },
      );

      favoriteButton.setAttribute("aria-pressed", String(selected));

      actions.append(favoriteButton);
    }

    content.append(actions);

    article.append(imageFor(shop), content);

    return article;
  }

  /* ====================================
       09. 検索結果描画
    ==================================== */

  function renderResults(fitMap = true) {
    const current = S.getActiveLocation();

    if (
      state.result?.fetchedAt &&
      Date.now() - Date.parse(state.result.fetchedAt) >= C.DATA_TTL_MS
    ) {
      state.shops = [];
      state.result = null;
    }

    const filtered = Q.filter(state.shops, state.filters, S.getFavoriteIds());

    const visible = filtered.slice(0, state.visibleCount);

    $("result-location").textContent = current
      ? `${current.label} 周辺`
      : "地点未登録";

    $("result-count").textContent =
      `該当${filtered.length}件中${visible.length}件表示`;

    $("last-updated").textContent =
      (state.result?.complete ? "最終更新：" : "取得日時：") +
      formatDate(state.result?.fetchedAt);

    $("acquisition-status").textContent = state.result
      ? `${state.result.complete ? "取得完了" : "部分取得"}：` +
        `${state.result.received} / ` +
        `${state.result.total ?? "不明"}件` +
        `（3km以内：${state.shops.length}件）`
      : "店舗情報は未取得です。";

    const list = $("restaurant-list");

    list.replaceChildren(...visible.map(createCard));

    if (!visible.length) {
      const message = !state.result
        ? "店舗情報を取得してください。"
        : state.result.complete
          ? "条件に一致する店舗が見つかりません。"
          : "取得できた範囲には該当店舗がありません。";

      list.append(
        element("p", message, "empty-state"),

        button("検索条件を変更する", openFilters, "secondary-button"),
      );
    }

    $("load-more").hidden = visible.length >= filtered.length;

    const onResults = state.page === "results";

    const showMap =
      onResults &&
      Boolean(current) &&
      Boolean(state.result?.fetchedAt) &&
      (wideMedia.matches || state.view === "map");

    $("list-panel").hidden =
      showMap && !wideMedia.matches && state.view === "map";

    $("map-panel").hidden = !showMap;

    $("show-list").setAttribute("aria-pressed", String(state.view === "list"));

    $("show-map").setAttribute("aria-pressed", String(state.view === "map"));

    if (showMap) {
      try {
        GM.Map.showRestaurants(
          current,
          filtered,
          state.filters.radiusM,
          openShop,
          fitMap,
        );
      } catch {
        $("map-panel").hidden = true;
        $("list-panel").hidden = false;

        showError(errorText(new Error("ERR_MAP")));
      }
    } else {
      GM.Map.hideRestaurants();
    }
  }

  /* ====================================
       10. 店舗詳細・共有
    ==================================== */

  async function shareShop(shop) {
    const url = shopUrl(shop);

    if (!url) {
      throw new Error("ERR_INPUT");
    }

    if (navigator.share) {
      try {
        await navigator.share({ url });

        $("shop-message").textContent = "共有操作を完了しました。";

        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }

    await copyShopLink(shop);
  }

  async function copyShopLink(shop) {
    const url = shopUrl(shop);

    if (!url) {
      throw new Error("ERR_INPUT");
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);

        $("shop-message").textContent = "店舗リンクをコピーしました。";

        return;
      } catch {
        // 手動コピーに切り替える
      }
    }

    prompt("店舗リンクを選択してコピーしてください。", url);
  }

  function openShop(shop) {
    $("shop-title").textContent = shop.name;

    $("shop-message").textContent = "";

    $("shop-image").replaceChildren(imageFor(shop));

    const details = [
      ["ジャンル", shop.genre],
      ["店舗紹介", shop.catchCopy],
      ["住所", shop.address],
      ["直線距離", Q.formatDistance(shop.distanceM)],

      [
        "概算徒歩時間",
        Number.isFinite(shop.walkingMinutes)
          ? `約${shop.walkingMinutes}分（目安）`
          : "情報なし",
      ],

      ["営業時間", shop.open],
      ["定休日", shop.close],
      ["平均ディナー予算", shop.budget],
      ["最寄り駅", shop.stationName],
      ["アクセス", shop.access],
      ["ランチ", shop.lunch],
      ["カード対応", shop.card],
      ["駐車場", shop.parking],
      ["禁煙・喫煙情報", shop.nonSmoking],
      ["バリアフリー", shop.barrierFree],
      ["総席数", shop.capacity],
      ["個室", shop.privateRoom],
      ["Wi-Fi", shop.wifi],
      ["お子様連れ対応", shop.child],
      ["飲料プラン（掲載情報）", shop.freeDrink],
      ["食べ放題", shop.freeFood],
    ];

    $("shop-details").replaceChildren();

    for (const [label, value] of details) {
      $("shop-details").append(
        element("dt", label),
        element("dd", String(value ?? "") || "情報なし"),
      );
    }

    const actions = $("shop-actions");

    actions.replaceChildren();

    if (Number.isFinite(shop.lat) && Number.isFinite(shop.lng)) {
      const mapsUrl = new URL("https://www.google.com/maps/search/");

      mapsUrl.searchParams.set("api", "1");

      mapsUrl.searchParams.set("query", `${shop.lat},${shop.lng}`);

      actions.append(externalLink("Google マップで開く", mapsUrl.href));
    }

    const url = shopUrl(shop);

    if (url) {
      actions.append(
        externalLink("ホットペッパーで開く", url),

        button("店舗リンクを共有", () => shareShop(shop)),

        button("リンクをコピー", () => copyShopLink(shop)),
      );
    }

    if (favoriteEnabled()) {
      const node = button(
        S.getFavoriteIds().includes(shop.id)
          ? "お気に入りを解除"
          : "お気に入りに登録",

        () => {
          const active = S.toggleFavorite(shop.id);

          node.textContent = active ? "お気に入りを解除" : "お気に入りに登録";

          state.favoriteFetchedAt = 0;

          $("shop-message").textContent = active
            ? "お気に入りに登録しました。"
            : "お気に入りを解除しました。";
        },
      );

      actions.append(node);
    }

    openDialog("shop-dialog");

    $("shop-title").focus();
  }

  /* ====================================
       11. フィルター
    ==================================== */

  function checkbox(value, label, selected) {
    const wrapper = element("label", undefined, "check-row");

    const input = document.createElement("input");

    input.type = "checkbox";
    input.value = value;
    input.checked = selected;

    wrapper.append(input, document.createTextNode(label));

    return wrapper;
  }

  function checkedValues(id) {
    return [...$(id).querySelectorAll('input[type="checkbox"]:checked')].map(
      (node) => node.value,
    );
  }

  function syncFilterControls() {
    $("keyword").value = state.filters.keyword;
    $("filter-keyword").value = state.filters.keyword;
    $("radius").value = state.filters.radiusM;
    $("sort").value = state.filters.sort;

    document.querySelectorAll('[name="quick-condition"]').forEach((node) => {
      node.checked = state.filters.conditions.includes(node.value);
    });
  }

  function openFilters() {
    syncFilterControls();

    const genres = Q.getGenres(state.shops);

    const saved = state.filters.genreNames || [];

    const choices = [...new Set([...genres, ...saved])];

    state.filterAllGenres = state.filters.genreNames === null;

    $("genre-options").replaceChildren(
      ...choices.map((name) =>
        checkbox(
          name,
          genres.includes(name)
            ? name
            : `${name}（現在の取得結果にありません）`,

          state.filterAllGenres || saved.includes(name),
        ),
      ),
    );

    $("condition-options").replaceChildren(
      ...Object.entries(Q.CONDITIONS).map(([key, label]) =>
        checkbox(key, label, state.filters.conditions.includes(key)),
      ),
    );

    $("favorite-only").disabled = !favoriteEnabled();

    $("favorite-only").checked =
      favoriteEnabled() && state.filters.favoriteOnly;

    openDialog("filter-dialog");
  }

  function saveCurrentFilters() {
    const current = S.getActiveLocation();

    if (current) {
      S.saveFilters(current.id, state.filters);
    }

    state.visibleCount = C.DISPLAY_COUNT;

    syncFilterControls();

    renderResults();
  }

  /* ====================================
       12. お気に入り一覧
    ==================================== */

  async function loadFavorites() {
    state.favoriteController?.abort();

    const generation = ++state.favoriteGeneration;

    state.favoriteController = new AbortController();

    const list = $("favorite-list");

    list.replaceChildren();

    if (!favoriteEnabled()) {
      $("favorite-status").textContent =
        "お気に入りは利用条件の確認後に提供予定です。";

      return;
    }

    if (!checkConsent()) return;

    $("favorite-status").textContent =
      "保存した店舗の最新情報を取得しています。";

    const result = await Q.fetchFavorites(S.getActiveLocation(), {
      signal: state.favoriteController.signal,
    });

    if (generation !== state.favoriteGeneration || state.page !== "favorites")
      return;

    state.favoriteShops = result.shops;
    state.favoriteFetchedAt = Date.now();

    list.replaceChildren(...result.shops.map(createCard));

    function addMissing(id, message) {
      const card = element("div", undefined, "management-card");

      card.append(
        element("p", message),
        element("small", id),

        button("お気に入りから解除", () => {
          if (!confirm("登録を解除しますか？")) {
            return;
          }

          if (S.getFavoriteIds().includes(id)) {
            S.toggleFavorite(id);
          }

          card.remove();
        }),
      );

      list.append(card);
    }

    result.missingIds.forEach((id) => {
      addMissing(id, "掲載情報を確認できない店舗です。");
    });

    result.failedIds.forEach((id) => {
      addMissing(id, "通信に失敗したため取得できませんでした。");
    });

    $("favorite-status").textContent =
      `${result.shops.length}件表示` +
      ` / 未取得${result.failedIds.length}件` +
      ` / 掲載未確認${result.missingIds.length}件`;

    if (!S.getFavoriteIds().length) {
      $("favorite-status").textContent = "お気に入りの店舗はありません。";
    }
  }

  /* ====================================
       13. プリセット
    ==================================== */

  function savePreset(existing = null) {
    const current = S.getActiveLocation();

    if (!current) {
      go("locations");
      return;
    }

    const name = prompt(
      "プリセット名を入力してください。",
      existing?.name || "",
    );

    if (!name?.trim()) return;

    if (name.length > 80) {
      throw new Error("ERR_INPUT");
    }

    S.savePreset(
      current.id,
      name,

      existing ? existing.filters : state.filters,

      existing?.presetId,
    );

    showStatus("検索条件を保存しました。");

    renderPresets();
  }

  function renderPresets() {
    const current = S.getActiveLocation();

    const list = $("preset-list");

    list.replaceChildren();

    const presets = S.load().presets.filter(
      (item) => item.locationId === current?.id,
    );

    if (!presets.length) {
      list.append(element("p", "保存した検索条件はありません。"));
    }

    for (const item of presets) {
      const card = element("article", undefined, "management-card");

      card.append(
        element("h3", item.name),

        element(
          "p",
          `${item.filters.radiusM}m以内 / ` +
            (item.filters.genreNames?.join("・") || "ジャンル指定なし"),
        ),

        button("適用", async () => {
          state.filters = {
            ...item.filters,
          };

          saveCurrentFilters();

          go("results");

          if (!state.result) {
            await fetchRestaurants();
          }
        }),

        button("名称変更", () => savePreset(item)),

        button("現在の条件で上書き", () => {
          if (!confirm("検索条件を上書きしますか？")) {
            return;
          }

          S.savePreset(
            item.locationId,
            item.name,
            state.filters,
            item.presetId,
          );

          renderPresets();
        }),

        button(
          "削除",
          () => {
            if (!confirm("削除しますか？")) return;

            S.deletePreset(item.presetId);

            renderPresets();
          },

          "danger-button",
        ),
      );

      list.append(card);
    }
  }

  /* ====================================
       14. 外観・設定
    ==================================== */

  function applyAppearance() {
    const settings = S.load().appSettings;

    const root = document.documentElement;

    root.dataset.theme =
      settings.theme === "system"
        ? themeMedia.matches
          ? "dark"
          : "light"
        : settings.theme;

    root.dataset.fontSize = settings.fontSize;

    root.dataset.contrast = settings.contrast ? "high" : "normal";

    root.dataset.reduceMotion = String(settings.reduceMotion);
  }

  function renderSettings() {
    const settings = S.load().appSettings;

    $("theme").value = settings.theme;

    $("font-size").value = settings.fontSize;

    $("high-contrast").checked = settings.contrast;

    $("reduce-motion").checked = settings.reduceMotion;

    $("auto-refresh").checked = settings.autoRefreshEnabled;

    $("refresh-interval").value = settings.interval;

    $("storage-size").textContent = `使用容量：約${(
      S.getStorageSize() / 1024
    ).toFixed(1)} KB`;

    $("app-version").textContent = `バージョン：${C.APP_VERSION}`;
  }

  async function checkSystemStatus() {
    $("system-status").textContent = "確認中";

    try {
      const result = await A.getStatus();

      const labels = {
        online: "稼働中",
        degraded: "一部機能に制限あり",
        maintenance: "メンテナンス中",
      };

      $("system-status").textContent =
        `${labels[result.status] || "未確認"} / ` +
        formatDate(result.fetchedAt);

      $("system-notice").textContent =
        result.notice || "お知らせはありません。";

      state.serverFavoritesEnabled = result.favoritesEnabled === true;

      if (!favoriteEnabled()) {
        state.filters.favoriteOnly = false;
      }
    } catch {
      state.serverFavoritesEnabled = false;

      $("system-status").textContent = "GASへの接続状態：未確認";

      $("system-notice").textContent = "システム状態を取得できませんでした。";
    }
  }

  /* ====================================
       15. 自動更新・有効期限
    ==================================== */

  function checkExpiry() {
    if (
      state.result?.fetchedAt &&
      Date.now() - Date.parse(state.result.fetchedAt) >= C.DATA_TTL_MS
    ) {
      state.shops = [];
      state.result = null;

      $("shop-dialog").close();

      $("shop-image").replaceChildren();
      $("shop-details").replaceChildren();
      $("shop-actions").replaceChildren();

      renderResults();

      showStatus("店舗情報の有効期限が切れました。");
    }

    if (
      state.favoriteFetchedAt &&
      Date.now() - state.favoriteFetchedAt >= C.DATA_TTL_MS
    ) {
      state.favoriteShops = [];
      state.favoriteFetchedAt = 0;

      $("favorite-list").replaceChildren();

      $("favorite-status").textContent =
        "店舗情報の有効期限が切れました。更新してください。";
    }
  }

  async function autoRefresh() {
    checkExpiry();

    if (
      document.hidden ||
      !navigator.onLine ||
      !S.hasConsent() ||
      state.loading ||
      state.refreshPaused ||
      $("location-dialog").open ||
      !S.getActiveLocation()
    )
      return;

    const settings = S.load().appSettings;

    if (!settings.autoRefreshEnabled) return;

    if (Date.now() - state.lastAttempt >= settings.interval * 60000) {
      await fetchRestaurants({
        navigateAfter: false,
      });
    }
  }

  /* ====================================
       16. イベント登録
    ==================================== */

  function bindEvents() {
    document.querySelectorAll("[data-page]").forEach((node) => {
      node.addEventListener("click", () => {
        run(() => go(node.dataset.page));
      });
    });

    window.addEventListener("hashchange", () => {
      run(() => navigate(location.hash.slice(1) || "home"));
    });

    $("location-select").addEventListener("change", (event) =>
      run(async () => {
        if (!checkConsent()) return;

        S.selectLocation(event.target.value);

        await changeLocation();
      }),
    );

    $("add-location").addEventListener("click", () =>
      run(() => openLocationEditor()),
    );

    $("location-dialog").addEventListener("close", () => {
      state.locationGeneration++;
      state.locationController?.abort();

      GM.Map.hideLocationPicker();
    });

    $("search-address").addEventListener("click", () =>
      run(async () => {
        const query = $("address-query").value.trim();

        if (query.length < 2) {
          throw new Error("ERR_INPUT");
        }

        if (!checkConsent()) return;

        state.locationController?.abort();

        const generation = ++state.locationGeneration;

        state.locationController = new AbortController();

        $("location-message").textContent = "地点候補を検索中です。";

        const result = await A.geocode(query, {
          signal: state.locationController.signal,
        });

        if (
          generation !== state.locationGeneration ||
          !$("location-dialog").open
        )
          return;

        $("location-candidates").replaceChildren();

        result.candidates.forEach((candidate) => {
          $("location-candidates").append(
            button(
              `${candidate.label} / ${candidate.address}`,

              () => fillLocation(candidate),
            ),
          );
        });

        $("location-message").textContent = result.candidates.length
          ? "地点候補を選択してください。"
          : "候補が見つかりません。";
      }),
    );

    $("use-gps").addEventListener("click", () =>
      run(async () => {
        const generation = ++state.locationGeneration;

        $("location-message").textContent = "現在地を取得しています。";

        const result = await A.getCurrentPosition();

        if (
          generation === state.locationGeneration &&
          $("location-dialog").open
        ) {
          fillLocation(result);
        }
      }),
    );

    $("use-location-map").addEventListener("click", () =>
      run(() => {
        if (!checkConsent()) return;

        const lat = $("latitude").valueAsNumber;
        const lng = $("longitude").valueAsNumber;

        const center = S.validCoordinates(lat, lng)
          ? { lat, lng }
          : S.getActiveLocation() || { lat: 35.6812, lng: 139.7671 };

        $("location-map").hidden = false;

        GM.Map.showLocationPicker(center, fillLocation);
      }),
    );

    $("location-form").addEventListener("submit", (event) => {
      event.preventDefault();

      run(async () => {
        const lat = $("latitude").valueAsNumber;
        const lng = $("longitude").valueAsNumber;

        if (!S.validCoordinates(lat, lng)) {
          throw new Error("ERR_LOCATION");
        }

        const candidate = state.selectedCandidate;

        const matches = candidate?.lat === lat && candidate?.lng === lng;

        S.saveLocation({
          id: state.editingLocationId,

          label: $("location-name").value,

          lat,
          lng,

          address: matches ? candidate.address : "",

          source: matches ? candidate.source : "manual",

          attribution: matches ? candidate.attribution : "",
        });

        $("location-dialog").close();

        await changeLocation();

        renderLocations();

        go("home");
      });
    });

    $("search-form").addEventListener("submit", (event) => {
      event.preventDefault();

      run(async () => {
        if (!checkConsent()) return;

        state.filters.keyword = $("keyword").value;

        const quickKeys = ["lunch", "parking", "barrierFree"];

        const selected = [
          ...document.querySelectorAll('[name="quick-condition"]:checked'),
        ].map((node) => node.value);

        state.filters.conditions = [
          ...state.filters.conditions.filter((key) => !quickKeys.includes(key)),
          ...selected,
        ];

        saveCurrentFilters();

        const valid =
          state.result?.fetchedAt &&
          Date.now() - Date.parse(state.result.fetchedAt) < C.DATA_TTL_MS;

        if (valid) {
          go("results");
        } else {
          await fetchRestaurants({
            navigateAfter: true,
          });
        }
      });
    });

    let keywordTimer;

    $("keyword").addEventListener("input", () => {
      clearTimeout(keywordTimer);

      const currentKey = state.locationKey;

      keywordTimer = setTimeout(() => {
        if (currentKey !== state.locationKey) return;

        run(() => {
          state.filters.keyword = $("keyword").value;

          saveCurrentFilters();
        });
      }, C.SEARCH_DEBOUNCE_MS);
    });

    $("refresh-results").addEventListener("click", () =>
      run(() =>
        fetchRestaurants({
          force: true,
        }),
      ),
    );

    $("show-list").addEventListener("click", () => go("list"));

    $("show-map").addEventListener("click", () => go("map"));

    $("load-more").addEventListener("click", () =>
      run(() => {
        state.visibleCount += C.DISPLAY_COUNT;

        renderResults(false);
      }),
    );

    $("sort").addEventListener("change", () =>
      run(() => {
        state.filters.sort = $("sort").value;

        saveCurrentFilters();
      }),
    );

    $("open-filter").addEventListener("click", () => run(openFilters));

    $("genre-options").addEventListener("change", () => {
      state.filterAllGenres = false;
    });

    $("select-all-genres").addEventListener("click", () => {
      state.filterAllGenres = true;

      $("genre-options")
        .querySelectorAll("input")
        .forEach((node) => (node.checked = true));
    });

    $("clear-genres").addEventListener("click", () => {
      state.filterAllGenres = false;

      $("genre-options")
        .querySelectorAll("input")
        .forEach((node) => (node.checked = false));
    });

    $("filter-form").addEventListener("submit", (event) => {
      event.preventDefault();

      run(() => {
        state.filters = {
          keyword: $("filter-keyword").value,

          radiusM: Number($("radius").value),

          genreNames: state.filterAllGenres
            ? null
            : checkedValues("genre-options"),

          conditions: checkedValues("condition-options"),

          sort: $("sort").value,

          favoriteOnly: favoriteEnabled() && $("favorite-only").checked,
        };

        saveCurrentFilters();

        $("filter-dialog").close();
      });
    });

    $("reset-filters").addEventListener("click", () =>
      run(() => {
        state.filters = S.defaultFilters();

        saveCurrentFilters();

        openFilters();
      }),
    );

    $("refresh-favorites").addEventListener("click", () => run(loadFavorites));

    $("quick-save-preset").addEventListener("click", () =>
      run(() => savePreset()),
    );

    $("add-preset").addEventListener("click", () => run(() => savePreset()));

    $("settings-form").addEventListener("change", () =>
      run(() => {
        S.updateSettings({
          theme: $("theme").value,

          fontSize: $("font-size").value,

          contrast: $("high-contrast").checked,

          reduceMotion: $("reduce-motion").checked,

          autoRefreshEnabled: $("auto-refresh").checked,

          interval: Number($("refresh-interval").value),
        });

        applyAppearance();
        renderSettings();
      }),
    );

    $("reset-appearance").addEventListener("click", () =>
      run(() => {
        S.updateSettings({
          theme: "system",
          fontSize: "normal",
          contrast: false,
          reduceMotion: false,
        });

        applyAppearance();
        renderSettings();
      }),
    );

    $("export-backup").addEventListener("click", () =>
      run(() => {
        if (
          !confirm(
            "バックアップには住所・座標が含まれる可能性があります。安全な場所に保存してください。",
          )
        )
          return;

        S.exportBackup();
      }),
    );

    $("import-backup").addEventListener("click", () =>
      run(async () => {
        const file = $("backup-file").files[0];

        const mode = $("import-mode").value;

        if (!file) {
          throw new Error("ERR_INPUT");
        }

        if (
          !confirm(
            mode === "replace"
              ? "現在の利用者データを上書きしますか？"
              : "既存データを残して追加しますか？",
          )
        )
          return;

        await S.importBackup(file, mode);

        state.locationKey = null;

        await changeLocation();

        applyAppearance();
        renderSettings();

        showStatus("バックアップを復元しました。");
      }),
    );

    $("clear-data").addEventListener("click", () =>
      run(() => {
        if (!confirm("登録地点・検索条件・設定をすべて削除しますか？")) return;

        state.controller?.abort();
        state.favoriteController?.abort();
        state.locationController?.abort();

        S.clear();

        location.hash = "home";

        location.reload();
      }),
    );

    $("check-status").addEventListener("click", () => run(checkSystemStatus));

    $("consent-checkbox").addEventListener("change", () => {
      $("accept-consent").disabled = !$("consent-checkbox").checked;
    });

    $("accept-consent").addEventListener("click", () =>
      run(async () => {
        if (!$("consent-checkbox").checked) return;

        S.acceptConsent();

        $("consent-dialog").close();

        await checkSystemStatus();

        if (!S.getActiveLocation()) {
          go("locations");
        } else {
          await changeLocation();
        }
      }),
    );

    $("read-legal").addEventListener("click", () => {
      $("consent-dialog").close();

      go("settings");

      $("terms").open = true;
      $("privacy").open = true;

      $("terms").scrollIntoView();

      const back = button("初回利用案内へ戻る", () => {
        back.remove();

        openDialog("consent-dialog");
      });

      $("privacy").after(back);
    });

    $("consent-dialog").addEventListener("cancel", (event) =>
      event.preventDefault(),
    );

    $("shop-dialog").addEventListener("close", () => {
      $("shop-image").replaceChildren();
      $("shop-details").replaceChildren();
      $("shop-actions").replaceChildren();

      if (state.page === "results") {
        renderResults(false);
      }

      if (state.page === "favorites") {
        run(loadFavorites);
      }
    });

    themeMedia.addEventListener("change", () => run(applyAppearance));

    wideMedia.addEventListener("change", () => run(() => renderResults()));

    document.addEventListener("visibilitychange", () => run(autoRefresh));

    window.addEventListener("online", () => run(autoRefresh));

    window.addEventListener("offline", () =>
      showError(errorText(new Error("ERR_OFFLINE"))),
    );

    setInterval(() => run(autoRefresh), 15000);
  }

  /* ====================================
       17. 初期化
    ==================================== */

  async function initialize() {
    try {
      S.load();
    } catch {
      showError("保存データを読み込めません。既存データは削除していません。");

      $("app-error").append(
        button("保存データを初期化", () => {
          if (!confirm("保存データを削除して初期化しますか？")) return;

          S.clear();

          location.reload();
        }),
      );

      return;
    }

    setupDialogs();

    bindEvents();

    applyAppearance();

    renderLocationSelect();

    renderSettings();

    await checkSystemStatus();

    navigate(location.hash.slice(1) || "home", false);

    if (!checkConsent()) return;

    await changeLocation();
  }

  run(initialize);
})(window.GourmetMap);
