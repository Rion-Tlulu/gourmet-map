(function (GM) {
  "use strict";

  const C = GM.Config;

  let restaurantMap = null;
  let restaurantMarkers = null;
  let originMarker = null;
  let radiusCircle = null;

  let locationMap = null;
  let pickerMarker = null;
  let pickerCircle = null;
  let pickerSelect = null;

  /* ========================================
       01. Leaflet利用可否
    ======================================== */

  function getLeaflet() {
    if (!window.L) {
      throw new Error("ERR_MAP");
    }

    return window.L;
  }

  function isAvailable() {
    return Boolean(window.L);
  }

  /* ========================================
       02. 地図通信状態の表示
    ======================================== */

  function setMapMessage(container, message) {
    if (!container?.parentElement) return;

    const id = container.id + "-status";

    let status = document.getElementById(id);

    if (!status) {
      status = document.createElement("p");
      status.id = id;
      status.className = "gm-map-status";
      status.setAttribute("role", "status");
      container.after(status);
    }

    status.textContent = message;
    status.hidden = !message;
  }

  /* ========================================
       03. 地図タイル（閲覧時のみ取得・先読みしない）
    ======================================== */

  function addTiles(map) {
    const L = getLeaflet();

    const tiles = L.tileLayer(C.MAP_TILE_URL, {
      maxZoom: 19,
      // OSMタイルポリシー：帰属表示を常に表示
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      crossOrigin: false,
    });

    let failed = false;

    tiles.on("loading", () => {
      failed = false;
      setMapMessage(map.getContainer(), "地図を読み込んでいます。");
    });

    tiles.on("load", () => {
      if (!failed) setMapMessage(map.getContainer(), "");
    });

    tiles.on("tileerror", () => {
      failed = true;
      setMapMessage(
        map.getContainer(),
        "地図の一部を取得できませんでした。一覧表示や座標入力をご利用ください。",
      );
    });

    tiles.addTo(map);
  }

  function setupMapA11y(map, label) {
    const container = map.getContainer();

    container.setAttribute("role", "region");
    container.setAttribute("aria-label", label);
  }

  /* ========================================
       04. マーカー
    ======================================== */

  function iconNode(name, extraClass) {
    const node = document.createElement("span");

    node.className = "gm-marker " + extraClass;

    const icon = document.createElement("i");

    icon.className = "fa-solid fa-" + name;
    icon.setAttribute("aria-hidden", "true");

    node.append(icon);

    return node;
  }

  // お気に入りは色だけでなく形（ハート）でも区別（MAP-03）
  function createShopIcon(isFavorite) {
    const L = getLeaflet();

    return L.divIcon({
      className: "gm-marker-wrapper",
      html: isFavorite
        ? iconNode("heart", "gm-marker-favorite")
        : iconNode("utensils", "gm-marker-shop"),
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -32],
    });
  }

  function createOriginIcon() {
    const L = getLeaflet();

    return L.divIcon({
      className: "gm-marker-wrapper",
      html: iconNode("location-dot", "gm-marker-origin"),
      iconSize: [40, 40],
      iconAnchor: [20, 40],
    });
  }

  /* ========================================
       05. 店舗ポップアップ
    ======================================== */

  function createPopup(shop, onSelect) {
    const popup = document.createElement("div");
    popup.className = "gm-popup";

    const title = document.createElement("strong");
    title.textContent = shop.name || "店舗名なし";

    const genre = document.createElement("p");
    genre.textContent = shop.genre || "ジャンル情報なし";

    const distance = document.createElement("p");
    distance.textContent =
      GM.Search.formatDistance(shop.distanceM) +
      (Number.isFinite(shop.walkingMinutes)
        ? `（徒歩約${shop.walkingMinutes}分・目安）`
        : "");

    const details = document.createElement("button");
    details.type = "button";
    details.className = "gm-btn gm-btn-primary gm-btn-sm";
    details.textContent = "店舗詳細を見る";

    details.addEventListener("click", () => {
      onSelect(shop, details);
    });

    popup.append(title, genre, distance, details);

    return popup;
  }

  /* ========================================
       06. 店舗地図
    ======================================== */

  function initializeRestaurantMap(location) {
    if (restaurantMap) {
      return restaurantMap;
    }

    const L = getLeaflet();

    restaurantMap = L.map("restaurant-map", {
      zoomControl: true,
      scrollWheelZoom: false,
      keyboard: true,
    }).setView([location.lat, location.lng], C.MAP_ZOOM);

    setupMapA11y(restaurantMap, "店舗地図");

    addTiles(restaurantMap);

    // クラスタリングで描画負荷を軽減（PER-04）
    restaurantMarkers =
      typeof L.markerClusterGroup === "function"
        ? L.markerClusterGroup({
            animate: false,
            maxClusterRadius: 60,
            showCoverageOnHover: false,
          })
        : L.layerGroup();

    restaurantMarkers.addTo(restaurantMap);

    return restaurantMap;
  }

  function showRestaurants(location, shops, radiusM, onSelect, fit = true) {
    if (!location) {
      throw new Error("ERR_LOCATION");
    }

    const L = getLeaflet();

    const map = initializeRestaurantMap(location);

    restaurantMarkers.clearLayers();

    originMarker?.remove();
    radiusCircle?.remove();

    const center = [location.lat, location.lng];

    // 登録地点は店舗と別のマーカー（MAP-02）
    originMarker = L.marker(center, {
      icon: createOriginIcon(),
      title: "登録地点：" + location.label,
      alt: "登録地点：" + location.label,
      keyboard: true,
      zIndexOffset: 1000,
    }).addTo(map);

    const originLabel = document.createElement("span");
    originLabel.textContent = location.label;

    originMarker.bindTooltip(originLabel, {
      permanent: true,
      direction: "bottom",
      offset: [0, 4],
      className: "gm-origin-tooltip",
    });

    // 距離フィルターの円
    radiusCircle = L.circle(center, {
      radius: radiusM,
      color: "#c2410c",
      fillColor: "#f97316",
      fillOpacity: 0.08,
      weight: 2,
      dashArray: "6 6",
      interactive: false,
    }).addTo(map);

    const favorites = new Set(GM.Storage.getFavoriteIds());

    const markers = [];

    for (const shop of shops) {
      if (
        !Number.isFinite(shop.lat) ||
        !Number.isFinite(shop.lng) ||
        Math.abs(shop.lat) > 90 ||
        Math.abs(shop.lng) > 180
      ) {
        continue;
      }

      const isFavorite = favorites.has(shop.id);

      const marker = L.marker([shop.lat, shop.lng], {
        icon: createShopIcon(isFavorite),
        title: shop.name,
        alt: shop.name + (isFavorite ? "（お気に入り）" : ""),
        keyboard: true,
      });

      marker.bindPopup(createPopup(shop, onSelect));

      markers.push(marker);
    }

    if (typeof restaurantMarkers.addLayers === "function") {
      restaurantMarkers.addLayers(markers);
    } else {
      markers.forEach((marker) => restaurantMarkers.addLayer(marker));
    }

    map.invalidateSize();

    if (fit) {
      map.fitBounds(radiusCircle.getBounds(), {
        padding: [16, 16],
        animate: false,
      });
    }
  }

  function hideRestaurants() {
    if (!restaurantMap) return;

    setMapMessage(restaurantMap.getContainer(), "");

    restaurantMap.remove();

    restaurantMap = null;
    restaurantMarkers = null;
    originMarker = null;
    radiusCircle = null;
  }

  /* ========================================
       07. 地点選択用地図（LOC-05）
    ======================================== */

  function showLocationPicker(center, onSelect) {
    const L = getLeaflet();

    if (!GM.Storage.validCoordinates(center.lat, center.lng)) {
      throw new Error("ERR_LOCATION");
    }

    if (locationMap) {
      pickerSelect = onSelect;
      setPickerPosition(center.lat, center.lng, true);
      locationMap.invalidateSize();
      return;
    }

    pickerSelect = onSelect;

    locationMap = L.map("location-map", {
      scrollWheelZoom: false,
      keyboard: true,
    }).setView([center.lat, center.lng], C.MAP_ZOOM - 1);

    setupMapA11y(locationMap, "地点選択地図。地図をクリックするかマーカーを移動して地点を選択");

    addTiles(locationMap);

    pickerMarker = L.marker([center.lat, center.lng], {
      draggable: true,
      keyboard: true,
      icon: createOriginIcon(),
      title: "選択中の地点（ドラッグで移動）",
      alt: "選択中の地点",
      autoPan: true,
    }).addTo(locationMap);

    // 半径3kmの確認用の円
    pickerCircle = L.circle([center.lat, center.lng], {
      radius: C.MAX_RADIUS_M,
      color: "#c2410c",
      fillColor: "#f97316",
      fillOpacity: 0.08,
      weight: 2,
      dashArray: "6 6",
      interactive: false,
    }).addTo(locationMap);

    function selectPosition(lat, lng) {
      const roundedLat = Math.round(lat * 1e6) / 1e6;
      const roundedLng = Math.round(lng * 1e6) / 1e6;

      if (!GM.Storage.validCoordinates(roundedLat, roundedLng)) {
        const current = pickerCircle.getLatLng();

        pickerMarker.setLatLng(current);

        setMapMessage(
          locationMap.getContainer(),
          "日本国内の範囲で地点を選択してください。",
        );

        return;
      }

      setMapMessage(locationMap.getContainer(), "");

      setPickerPosition(roundedLat, roundedLng, false);

      pickerSelect?.({
        lat: roundedLat,
        lng: roundedLng,
        source: "map",
      });
    }

    locationMap.on("click", (event) => {
      selectPosition(event.latlng.lat, event.latlng.lng);
    });

    pickerMarker.on("dragend", () => {
      const position = pickerMarker.getLatLng();
      selectPosition(position.lat, position.lng);
    });

    locationMap.invalidateSize();

    locationMap.fitBounds(pickerCircle.getBounds(), {
      padding: [8, 8],
      animate: false,
    });
  }

  // 座標入力・候補選択に合わせてマーカーを移動
  function setPickerPosition(lat, lng, recenter = true) {
    if (!locationMap || !GM.Storage.validCoordinates(lat, lng)) return;

    pickerMarker.setLatLng([lat, lng]);
    pickerCircle.setLatLng([lat, lng]);

    if (recenter) {
      locationMap.fitBounds(pickerCircle.getBounds(), {
        padding: [8, 8],
        animate: false,
      });
    }
  }

  function hideLocationPicker() {
    if (!locationMap) return;

    setMapMessage(locationMap.getContainer(), "");

    locationMap.remove();

    locationMap = null;
    pickerMarker = null;
    pickerCircle = null;
    pickerSelect = null;
  }

  function invalidate() {
    restaurantMap?.invalidateSize();
    locationMap?.invalidateSize();
  }

  /* ========================================
       08. 公開関数
    ======================================== */

  GM.Map = Object.freeze({
    isAvailable,
    showRestaurants,
    hideRestaurants,
    showLocationPicker,
    setPickerPosition,
    hideLocationPicker,
    invalidate,
  });
})(window.GourmetMap);
