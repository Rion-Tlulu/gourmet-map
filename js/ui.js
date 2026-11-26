(function (GM) {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ====================================
       01. 要素生成（外部データは textContent で描画）
    ==================================== */

  /**
   * el("button", { className: "x", text: "y", attrs: { type: "button" }, on: { click } }, child...)
   */
  function el(tag, options = {}, ...children) {
    const node = document.createElement(tag);

    if (options.className) node.className = options.className;

    if (options.text !== undefined && options.text !== null) {
      node.textContent = String(options.text);
    }

    for (const [name, value] of Object.entries(options.attrs || {})) {
      if (value === false || value === null || value === undefined) continue;

      node.setAttribute(name, value === true ? "" : String(value));
    }

    for (const [name, value] of Object.entries(options.dataset || {})) {
      node.dataset[name] = value;
    }

    for (const [name, handler] of Object.entries(options.on || {})) {
      node.addEventListener(name, handler);
    }

    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;

      node.append(child instanceof Node ? child : document.createTextNode(child));
    }

    return node;
  }

  // 装飾アイコンは読み上げ対象外（UX-04）
  function icon(name, style = "solid", extraClass = "") {
    return el("i", {
      className: `fa-${style} fa-${name} ${extraClass}`.trim(),
      attrs: { "aria-hidden": "true" },
    });
  }

  function srOnly(text) {
    return el("span", { className: "visually-hidden", text });
  }

  /* ====================================
       02. 支援技術への通知（UX-05）
    ==================================== */

  let announceTimer = null;

  function announce(message) {
    const region = $("sr-announcer");

    if (!region) return;

    region.textContent = "";

    clearTimeout(announceTimer);

    // 同じ文言でも読み上げられるよう一度空にしてから設定
    announceTimer = setTimeout(() => {
      region.textContent = message;
    }, 50);
  }

  /* ====================================
       03. モーダル（Bootstrap Modal）
    ==================================== */

  const returnFocus = new WeakMap();
  const fallbackFocus = new WeakMap();

  function hasBootstrap() {
    return Boolean(window.bootstrap?.Modal);
  }

  // Bootstrapが読み込めない場合の簡易フォールバック
  function fallbackShow(node) {
    node.classList.add("show", "gm-fallback-open");
    node.style.display = "block";
    node.removeAttribute("aria-hidden");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("role", "dialog");
    document.body.classList.add("modal-open");

    node.dispatchEvent(new Event("shown.bs.modal"));
    node.dispatchEvent(new Event("shown.bs.offcanvas"));
  }

  function fallbackHide(node) {
    node.classList.remove("show", "gm-fallback-open");
    node.style.display = "";
    node.setAttribute("aria-hidden", "true");
    node.removeAttribute("aria-modal");
    document.body.classList.remove("modal-open");

    node.dispatchEvent(new Event("hidden.bs.modal"));
    node.dispatchEvent(new Event("hidden.bs.offcanvas"));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || hasBootstrap()) return;

    const open = document.querySelector(".gm-fallback-open");

    if (open && open.dataset.bsKeyboard !== "false") {
      fallbackHide(open);
    }
  });

  function setupReturnFocus(node, eventName) {
    if (node.dataset.gmFocusBound) return;

    node.dataset.gmFocusBound = "true";

    node.addEventListener(eventName, () => {
      const trigger = returnFocus.get(node);

      returnFocus.delete(node);

      // 元の操作位置へ復帰（UX-05）
      if (
        trigger?.isConnected &&
        !trigger.closest("[hidden], .modal:not(.show), .offcanvas:not(.show)")
      ) {
        trigger.focus();
        return;
      }

      const fallback = fallbackFocus.get(node);

      fallbackFocus.delete(node);

      if (typeof fallback === "function" && fallback()) return;

      $("main-content")?.focus();
    });
  }

  function showModal(id, options = {}) {
    const node = $(id);

    returnFocus.set(node, options.trigger || document.activeElement);

    if (options.fallbackFocus) {
      fallbackFocus.set(node, options.fallbackFocus);
    }

    setupReturnFocus(node, "hidden.bs.modal");

    if (hasBootstrap()) {
      window.bootstrap.Modal.getOrCreateInstance(node).show();
    } else {
      fallbackShow(node);
    }
  }

  function hideModal(id) {
    const node = $(id);

    if (!node.classList.contains("show")) return;

    if (hasBootstrap()) {
      window.bootstrap.Modal.getOrCreateInstance(node).hide();
    } else {
      fallbackHide(node);
    }
  }

  function isOpen(id) {
    return $(id)?.classList.contains("show") || false;
  }

  /* ====================================
       04. オフキャンバス（Bootstrap Offcanvas）
    ==================================== */

  function showOffcanvas(id, options = {}) {
    const node = $(id);

    returnFocus.set(node, options.trigger || document.activeElement);

    setupReturnFocus(node, "hidden.bs.offcanvas");

    if (window.bootstrap?.Offcanvas) {
      window.bootstrap.Offcanvas.getOrCreateInstance(node).show();
    } else {
      fallbackShow(node);
    }
  }

  function hideOffcanvas(id) {
    const node = $(id);

    if (!node.classList.contains("show")) return;

    if (window.bootstrap?.Offcanvas) {
      window.bootstrap.Offcanvas.getOrCreateInstance(node).hide();
    } else {
      fallbackHide(node);
    }
  }

  /* ====================================
       05. トースト（Bootstrap Toast）
    ==================================== */

  const TOAST_ICONS = {
    success: "circle-check",
    info: "circle-info",
    warning: "triangle-exclamation",
    danger: "circle-exclamation",
  };

  function toast(message, variant = "success") {
    const container = $("toast-container");

    if (!container) return;

    const node = el(
      "div",
      {
        className: `toast gm-toast gm-toast-${variant}`,
        attrs: {
          role: variant === "danger" ? "alert" : "status",
          "aria-live": variant === "danger" ? "assertive" : "polite",
          "aria-atomic": "true",
        },
      },
      el(
        "div",
        { className: "gm-toast-body" },
        icon(TOAST_ICONS[variant] || "circle-info"),
        el("span", { text: message }),
        el("button", {
          className: "gm-toast-close",
          attrs: {
            type: "button",
            "data-bs-dismiss": "toast",
            "aria-label": "通知を閉じる",
          },
        }, icon("xmark")),
      ),
    );

    container.append(node);

    node.addEventListener("hidden.bs.toast", () => node.remove());

    if (window.bootstrap?.Toast) {
      window.bootstrap.Toast.getOrCreateInstance(node, {
        delay: variant === "danger" ? 8000 : 4000,
      }).show();
    } else {
      node.classList.add("show");

      node.querySelector(".gm-toast-close").addEventListener("click", () => node.remove());

      setTimeout(() => node.remove(), 5000);
    }
  }

  /* ====================================
       06. 確認ダイアログ（confirm の代替）
    ==================================== */

  function confirmDialog({
    title = "確認",
    message = "",
    detail = "",
    confirmLabel = "OK",
    cancelLabel = "キャンセル",
    danger = false,
  } = {}) {
    return new Promise((resolve) => {
      const node = $("confirm-modal");

      $("confirm-title").textContent = title;
      $("confirm-message").textContent = message;
      $("confirm-detail").textContent = detail;
      $("confirm-detail").hidden = !detail;

      const ok = $("confirm-ok");

      ok.textContent = confirmLabel;
      ok.className = danger ? "gm-btn gm-btn-danger" : "gm-btn gm-btn-primary";

      $("confirm-cancel").textContent = cancelLabel;

      let result = false;

      function onOk() {
        result = true;
        hideModal("confirm-modal");
      }

      function onShown() {
        $("confirm-cancel").focus();
      }

      function onHidden() {
        ok.removeEventListener("click", onOk);
        node.removeEventListener("shown.bs.modal", onShown);
        node.removeEventListener("hidden.bs.modal", onHidden);

        resolve(result);
      }

      ok.addEventListener("click", onOk);
      node.addEventListener("shown.bs.modal", onShown);
      node.addEventListener("hidden.bs.modal", onHidden);

      showModal("confirm-modal");
    });
  }

  /* ====================================
       07. 入力ダイアログ（prompt の代替）
    ==================================== */

  function promptDialog({
    title = "入力",
    label = "",
    value = "",
    hint = "",
    maxLength = 80,
    confirmLabel = "保存",
  } = {}) {
    return new Promise((resolve) => {
      const node = $("prompt-modal");
      const form = $("prompt-form");
      const input = $("prompt-input");
      const error = $("prompt-error");

      $("prompt-title").textContent = title;
      $("prompt-label").textContent = label;
      $("prompt-hint").textContent = hint;
      $("prompt-hint").hidden = !hint;
      $("prompt-ok").textContent = confirmLabel;

      input.value = value;
      input.maxLength = maxLength;
      input.removeAttribute("aria-invalid");

      error.textContent = "";

      let result = null;

      function onSubmit(event) {
        event.preventDefault();

        const text = input.value.trim();

        if (!text) {
          error.textContent = `${label}を入力してください。`;
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }

        if (text.length > maxLength) {
          error.textContent = `${maxLength}文字以内で入力してください。`;
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }

        result = text;

        hideModal("prompt-modal");
      }

      function onShown() {
        input.focus();
        input.select();
      }

      function onHidden() {
        form.removeEventListener("submit", onSubmit);
        node.removeEventListener("shown.bs.modal", onShown);
        node.removeEventListener("hidden.bs.modal", onHidden);

        resolve(result);
      }

      form.addEventListener("submit", onSubmit);
      node.addEventListener("shown.bs.modal", onShown);
      node.addEventListener("hidden.bs.modal", onHidden);

      showModal("prompt-modal");
    });
  }

  GM.UI = Object.freeze({
    el,
    icon,
    srOnly,
    announce,
    showModal,
    hideModal,
    isOpen,
    showOffcanvas,
    hideOffcanvas,
    toast,
    confirm: confirmDialog,
    prompt: promptDialog,
  });
})(window.GourmetMap);
