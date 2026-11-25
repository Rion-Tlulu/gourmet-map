(function (GM) {
  "use strict";

  const C = GM.Config;

  let restaurantMap = null;
  let locationMap = null;

  let markers = null;
  let origin = null;
  let circle = null;

  let locationMarker = null;
  let locationCircle = null;

  /* ====================================
       01. 地図タイル
    ==================================== */

  function addTiles(map) {
    const tiles = L.tileLayer(C.MAP_TILE_URL, {
      maxZoom: 19,

      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">' +
        "OpenStreetMap contributors</a>",
    });

    tiles.on("tileerror", () => {
      const element = map.getContainer();

      element.setAttribute(
        "aria-label",
        "地図を取得できない場合は店舗一覧をご利用ください",
      );
    });

    tiles.addTo(map);
  }

  /* ====================================
       02. 店舗地図
    ==================================== */

  function showRestaurants(location, shops, radiusM, onSelect, fit = true) {
    if (!window.L || !location) {
      throw new Error("ERR_MAP");
    }

    if (!restaurantMap) {
      restaurantMap = L.map("restaurant-map").setView(
        [location.lat, location.lng],
        C.MAP_ZOOM,
      );

      addTiles(restaurantMap);

      markers =
        typeof L.markerClusterGroup === "function"
          ? L.markerClusterGroup({
              chunkedLoading: true,
              animate: false,
            })
          : L.layerGroup();

      markers.addTo(restaurantMap);
    }

    markers.clearLayers();

    origin?.remove();
    circle?.remove();

    const center = [location.lat, location.lng];

    origin = L.circleMarker(center, {
      radius: 9,
      color: "#ffffff",
      fillColor: "#1d4ed8",
      fillOpacity: 1,
      weight: 3,
    }).addTo(restaurantMap);

    const originLabel = document.createElement("span");

    originLabel.textContent = `登録地点：${location.label}`;

    origin.bindTooltip(originLabel);

    circle = L.circle(center, {
      radius: radiusM,
      color: "#c2410c",
      fillColor: "#f97316",
      fillOpacity: 0.1,
      dashArray: "6 5",
    }).addTo(restaurantMap);

    const favoriteIds = new Set(GM.Storage.getFavoriteIds());

    for (const shop of shops) {
      const favorite = favoriteIds.has(shop.id);

      const markerIcon = L.divIcon({
        className: "restaurant-marker",

        html: favorite
          ? '<span class="marker-pin">★</span>'
          : '<span class="marker-pin">●</span>',

        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      const marker = L.marker([shop.lat, shop.lng], {
        icon: markerIcon,

        title: shop.name,

        alt: shop.name + (favorite ? " お気に入り" : ""),
      });

      const popup = document.createElement("div");

      const title = document.createElement("strong");

      title.textContent = shop.name;

      const info = document.createElement("p");

      info.textContent = GM.Search.formatDistance(shop.distanceM);

      const button = document.createElement("button");

      button.type = "button";
      button.textContent = "店舗詳細を見る";

      button.addEventListener("click", () => {
        onSelect(shop);
      });

      popup.append(title, info, button);

      marker.bindPopup(popup);

      markers.addLayer(marker);
    }

    restaurantMap.invalidateSize();

    if (fit) {
      restaurantMap.fitBounds(circle.getBounds(), {
        padding: [15, 15],
        animate: false,
      });
    }
  }

  /* ====================================
       03. 地点選択
    ==================================== */

  function showLocationPicker(center, onSelect) {
    if (!window.L) {
      throw new Error("ERR_MAP");
    }

    hideLocationPicker();

    locationMap = L.map("location-map").setView(
      [center.lat, center.lng],
      C.MAP_ZOOM,
    );

    addTiles(locationMap);

    function updatePosition(lat, lng) {
      locationMarker?.remove();
      locationCircle?.remove();

      locationMarker = L.marker([lat, lng], {
        title: "選択中の地点",
        draggable: true,
      }).addTo(locationMap);

      locationCircle = L.circle([lat, lng], {
        radius: C.MAX_RADIUS_M,
        color: "#c2410c",
        fillOpacity: 0.1,
      }).addTo(locationMap);

      locationMarker.on("dragend", () => {
        const position = locationMarker.getLatLng();

        selectPosition(position.lat, position.lng);
      });
    }

    function selectPosition(lat, lng) {
      if (!GM.Storage.validCoordinates(lat, lng)) {
        updatePosition(center.lat, center.lng);
        return;
      }

      center = { lat, lng };

      updatePosition(lat, lng);

      onSelect({
        lat,
        lng,
        source: "map",
      });
    }

    updatePosition(center.lat, center.lng);

    locationMap.on("click", (event) => {
      selectPosition(event.latlng.lat, event.latlng.lng);
    });

    locationMap.invalidateSize();
  }

  /* ====================================
       04. 地図の破棄
    ==================================== */

  function hideRestaurants() {
    if (restaurantMap) {
      restaurantMap.remove();

      restaurantMap = null;
      markers = null;
      origin = null;
      circle = null;
    }
  }

  function hideLocationPicker() {
    if (locationMap) {
      locationMap.remove();

      locationMap = null;
      locationMarker = null;
      locationCircle = null;
    }
  }

  GM.Map = Object.freeze({
    showRestaurants,
    showLocationPicker,
    hideRestaurants,
    hideLocationPicker,
  });
})(window.GourmetMap);
