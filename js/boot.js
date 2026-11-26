/*
 * 表示設定の先行適用
 * CSPでインラインスクリプトを禁止しているため、外部ファイルとして
 * <head>内で同期読み込みし、描画前にテーマ・文字サイズを反映する。
 */
(function () {
  "use strict";

  var root = document.documentElement;

  var settings = {};

  try {
    var raw = window.localStorage.getItem("gourmet-map:v1");

    if (raw) {
      settings = JSON.parse(raw).appSettings || {};
    }
  } catch (error) {
    settings = {};
  }

  var theme = ["light", "dark", "system"].indexOf(settings.theme) >= 0
    ? settings.theme
    : "system";

  var dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-bs-theme", dark ? "dark" : "light");

  root.setAttribute(
    "data-font-size",
    ["normal", "large", "extra-large"].indexOf(settings.fontSize) >= 0
      ? settings.fontSize
      : "normal",
  );

  root.setAttribute("data-contrast", settings.contrast === true ? "high" : "normal");

  root.setAttribute(
    "data-reduce-motion",
    settings.reduceMotion === true ? "true" : "false",
  );

  root.classList.add("js");
})();
