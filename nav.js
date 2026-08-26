(function () {
  "use strict";
  // Minimal, dependency-free mobile menu toggle for content pages (landing
  // pages, tutorials) that don't load main.js. Mirrors the same behavior
  // and CSS classes (#navToggle / #headerNav / .is-open) already used and
  // verified on index.html, so the menu looks and behaves identically.
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  ready(function () {
    var btn = document.getElementById("navToggle");
    var nav = document.getElementById("headerNav");
    if (!btn || !nav) return;
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
  });
})();
