(function () {
  "use strict";

  var data = window.__BRAND__ || {};
  var STYLES = data.styles || {};

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  var escHTML = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function safe(fn, name) { try { return fn(); } catch (e) { console.warn("[" + name + "]", e); } }

  var state = {
    mode: "link",
    link: "",
    wifi: { ssid: "", pass: "", sec: "WPA", hidden: false },
    styleKey: "clasico",
    fg: "#1b1b22",
    bg: "#ffffff",
    centerType: "none",   // 'none' | 'emoji' | 'logo'
    centerImage: null     // dataURL
  };

  var currentPayload = "https://tu-negocio.com";
  var listeners = [];
  var previewInst = null;
  var renderTimer = null;
  var renderGen = 0;

  // ---------------------------------------------------------------- payload

  function normalizeLink(raw) {
    var v = (raw || "").trim();
    if (!v) return "";
    if (/^wifi:/i.test(v)) return v;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !/^mailto:|^tel:/i.test(v)) {
      v = "https://" + v.replace(/^\/+/, "");
    }
    return v;
  }

  function escWifi(s) {
    return String(s || "").replace(/([\\;,:"])/g, "\\$1");
  }

  function buildPayload() {
    if (state.mode === "wifi") {
      if (!state.wifi.ssid) return "WIFI:T:WPA;S:MiRed;P:;;";
      var sec = state.wifi.sec === "nopass" ? "nopass" : state.wifi.sec;
      var pass = sec === "nopass" ? "" : "P:" + escWifi(state.wifi.pass) + ";";
      return "WIFI:T:" + sec + ";S:" + escWifi(state.wifi.ssid) + ";" + pass +
        (state.wifi.hidden ? "H:true;" : "") + ";";
    }
    var link = normalizeLink(state.link);
    return link || "https://tu-negocio.com";
  }

  // ---------------------------------------------------------------- options

  function styleDef() { return STYLES[state.styleKey] || STYLES.clasico || { dots: "square", corners: "square", cornerDot: "square" }; }

  function buildOptions(sizePx, type) {
    var st = styleDef();
    var hasCenter = state.centerType !== "none" && !!state.centerImage;
    var opts = {
      width: sizePx,
      height: sizePx,
      type: type || "canvas",
      data: currentPayload,
      margin: Math.max(6, Math.round(sizePx * 0.025)),
      qrOptions: { errorCorrectionLevel: hasCenter ? "H" : "M" },
      dotsOptions: { color: state.fg, type: st.dots },
      backgroundOptions: { color: state.bg },
      cornersSquareOptions: { color: state.fg, type: st.corners },
      cornersDotOptions: { color: state.fg, type: st.cornerDot }
    };
    if (hasCenter) {
      opts.image = state.centerImage;
      opts.imageOptions = { crossOrigin: "anonymous", margin: 4, imageSize: 0.4, hideBackgroundDots: true };
    }
    return opts;
  }

  // ---------------------------------------------------------------- render

  function ensurePreviewInst() {
    if (previewInst || !window.QRCodeStyling) return previewInst;
    var frame = $("#qrPreview");
    if (!frame) return null;
    previewInst = new window.QRCodeStyling(buildOptions(300, "svg"));
    previewInst.append(frame);
    return previewInst;
  }

  function render() {
    currentPayload = buildPayload();
    var inst = ensurePreviewInst();
    if (inst) inst.update(buildOptions(300, "svg"));
    updateWarningsAndNotify();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 130);
  }

  function updateWarningsAndNotify() {
    var gen = ++renderGen;
    listeners.forEach(function (fn) {
      safe(function () { fn(gen); }, "qr:onChange listener");
    });
  }

  // ---------------------------------------------------------------- slug / filenames

  function slugFromPayload() {
    if (state.mode === "wifi") {
      return "wifi-" + (state.wifi.ssid || "red").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30) || "wifi";
    }
    try {
      var u = new URL(currentPayload);
      return u.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    } catch (e) {
      return "codigo-qr";
    }
  }

  // ---------------------------------------------------------------- downloads

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    document.dispatchEvent(new CustomEvent("qr:downloaded", { detail: { filename: filename } }));
  }

  function downloadPng() {
    if (!window.QRCodeStyling) return;
    var inst = new window.QRCodeStyling(buildOptions(1024, "canvas"));
    inst.getRawData("png").then(function (blob) {
      if (blob) saveBlob(blob, "qr-" + slugFromPayload() + ".png");
    });
  }

  function downloadSvg() {
    if (!window.QRCodeStyling) return;
    var inst = new window.QRCodeStyling(buildOptions(1024, "svg"));
    inst.getRawData("svg").then(function (blob) {
      if (blob) saveBlob(blob, "qr-" + slugFromPayload() + ".svg");
    });
  }

  // ---------------------------------------------------------------- center image

  function emojiToDataUrl(emoji) {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = "200px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, 128, 145);
    return c.toDataURL("image/png");
  }

  function setCenterEmoji(emoji) {
    state.centerType = "emoji";
    state.centerImage = emojiToDataUrl(emoji);
    $$(".emoji-btn").forEach(function (b) { b.classList.toggle("is-active", b.dataset.emoji === emoji); });
    scheduleRender();
  }

  function setCenterLogo(dataUrl) {
    state.centerType = "logo";
    state.centerImage = dataUrl;
    $$(".emoji-btn").forEach(function (b) { b.classList.remove("is-active"); });
    scheduleRender();
  }

  function clearCenter() {
    state.centerType = "none";
    state.centerImage = null;
    $$(".emoji-btn").forEach(function (b) { b.classList.remove("is-active"); });
    var upload = $("#logoUpload");
    if (upload) upload.value = "";
    scheduleRender();
  }

  // ---------------------------------------------------------------- init UI

  function mountStyleGrid() {
    var grid = $("[data-style-grid]");
    if (!grid || grid.children.length) return;
    grid.innerHTML = Object.keys(STYLES).map(function (key) {
      return '<button type="button" class="style-btn' + (key === state.styleKey ? " is-active" : "") +
        '" data-style="' + key + '">' + escHTML(STYLES[key].label) + "</button>";
    }).join("");
    grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-style]");
      if (!btn) return;
      state.styleKey = btn.dataset.style;
      $$(".style-btn", grid).forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      scheduleRender();
    });
  }

  function mountEmojiGrid() {
    var grid = $("[data-emoji-grid]");
    if (!grid || grid.children.length) return;
    var picks = data.emojiPicks || [];
    grid.innerHTML = picks.map(function (e) {
      return '<button type="button" class="emoji-btn" data-emoji="' + e + '" aria-label="Usar ' + e + ' como centro">' + e + "</button>";
    }).join("");
    grid.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-emoji]");
      if (!btn) return;
      setCenterEmoji(btn.dataset.emoji);
    });
  }

  function mountPresetColors() {
    var row = $("[data-preset-colors]");
    if (!row || row.children.length) return;
    var presets = data.presetColors || [];
    row.innerHTML = presets.map(function (p, i) {
      return '<button type="button" class="preset-swatch" data-idx="' + i + '" title="' + escHTML(p.label) +
        '" style="background:linear-gradient(135deg,' + p.base + " 50%," + p.code + ' 50%)"></button>';
    }).join("");
    row.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-idx]");
      if (!btn) return;
      var p = presets[+btn.dataset.idx];
      if (!p) return;
      var base = $("#obj3dColorBase"), code = $("#obj3dColorCode");
      if (base) base.value = p.base;
      if (code) code.value = p.code;
      document.dispatchEvent(new CustomEvent("qr3d:colors-changed"));
    });
  }

  function initContentTabs() {
    $$(".content-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var mode = tab.dataset.contentMode;
        state.mode = mode;
        $$(".content-tab").forEach(function (t) {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        $$("[data-content-panel]").forEach(function (p) {
          p.classList.toggle("is-hidden", p.dataset.contentPanel !== mode);
        });
        scheduleRender();
      });
    });
  }

  function initFields() {
    var link = $("#linkInput");
    if (link) link.addEventListener("input", function () { state.link = link.value; scheduleRender(); });

    var ssid = $("#wifiSsid"), pass = $("#wifiPass"), sec = $("#wifiSec"), hidden = $("#wifiHidden");
    if (ssid) ssid.addEventListener("input", function () { state.wifi.ssid = ssid.value; scheduleRender(); });
    if (pass) pass.addEventListener("input", function () { state.wifi.pass = pass.value; scheduleRender(); });
    if (sec) sec.addEventListener("change", function () { state.wifi.sec = sec.value; scheduleRender(); });
    if (hidden) hidden.addEventListener("change", function () { state.wifi.hidden = hidden.checked; scheduleRender(); });

    var fg = $("#fgColor"), bg = $("#bgColor");
    if (fg) fg.addEventListener("input", function () { state.fg = fg.value; scheduleRender(); });
    if (bg) bg.addEventListener("input", function () { state.bg = bg.value; scheduleRender(); });

    var upload = $("#logoUpload");
    if (upload) upload.addEventListener("change", function () {
      var file = upload.files && upload.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { setCenterLogo(reader.result); };
      reader.readAsDataURL(file);
    });

    var remove = $("#removeCenter");
    if (remove) remove.addEventListener("click", clearCenter);

    var pngBtn = $("#downloadPng"), svgBtn = $("#downloadSvg");
    if (pngBtn) pngBtn.addEventListener("click", downloadPng);
    if (svgBtn) svgBtn.addEventListener("click", downloadSvg);
  }

  // ---------------------------------------------------------------- ad UX

  function initDownloadDialog() {
    var dialog = $("#adDialog");
    if (!dialog) return;
    document.addEventListener("qr:downloaded", function () {
      setTimeout(function () { safe(function () { dialog.showModal(); }, "adDialog.showModal"); }, 350);
    });
    var close = function () { if (dialog.open) dialog.close(); };
    var closeBtn = $("#adDialogClose"), closeBtn2 = $("#adDialogCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (closeBtn2) closeBtn2.addEventListener("click", close);
    dialog.addEventListener("click", function (e) { if (e.target === dialog) close(); });
  }

  function initCornerToast() {
    var toast = $("#cornerAd");
    if (!toast) return;
    if (sessionStorage.getItem("qr3d_corner_dismissed")) return;
    setTimeout(function () { toast.hidden = false; }, 3500);
    var closeBtn = $("#cornerAdClose");
    if (closeBtn) closeBtn.addEventListener("click", function () {
      toast.hidden = true;
      try { sessionStorage.setItem("qr3d_corner_dismissed", "1"); } catch (e) {}
    });
  }

  // ---------------------------------------------------------------- public API (used by qr3d.js)

  window.__QR__ = {
    getPayload: function () { return currentPayload; },
    getState: function () { return state; },
    getStyleDef: styleDef,
    buildOptions: buildOptions,
    onChange: function (fn) { listeners.push(fn); },
    escHTML: escHTML,
    $: $, $$: $, safe: safe
  };

  function boot() {
    safe(mountStyleGrid, "mountStyleGrid");
    safe(mountEmojiGrid, "mountEmojiGrid");
    safe(mountPresetColors, "mountPresetColors");
    safe(initContentTabs, "initContentTabs");
    safe(initFields, "initFields");
    safe(initDownloadDialog, "initDownloadDialog");
    safe(initCornerToast, "initCornerToast");

    var tryRender = function () {
      if (window.QRCodeStyling) { render(); }
      else { setTimeout(tryRender, 60); }
    };
    tryRender();

    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
