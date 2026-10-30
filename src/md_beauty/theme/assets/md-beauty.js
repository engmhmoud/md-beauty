// "Mark as read": per-browser progress, shown as ✓ in the sidebar.
(function () {
  var KEY = "md-beauty-read";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(read) {
    try { localStorage.setItem(KEY, JSON.stringify(read)); } catch (e) { /* private mode */ }
  }
  function pathOf(href) {
    return new URL(href, location.href).pathname.replace(/index\.html$/, "");
  }

  function paint() {
    var read = load();
    document.querySelectorAll(".md-sidebar--primary a.md-nav__link[href]").forEach(function (a) {
      var mark = a.querySelector(".mb-check");
      var isRead = !!read[pathOf(a.href)];
      if (isRead && !mark) {
        mark = document.createElement("span");
        mark.className = "mb-check";
        mark.textContent = "✓";
        a.appendChild(mark);
      } else if (!isRead && mark) {
        mark.remove();
      }
    });
    var btn = document.querySelector(".mb-read-toggle");
    if (btn) btn.setAttribute("aria-checked", read[location.pathname] ? "true" : "false");
  }

  function setup() {
    var btn = document.querySelector(".mb-read-toggle");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var read = load();
        if (read[location.pathname]) delete read[location.pathname];
        else read[location.pathname] = Date.now();
        save(read);
        paint();
      });
    }
    paint();
  }

  // Material's instant navigation swaps pages without a reload
  if (window.document$) window.document$.subscribe(setup);
  else document.addEventListener("DOMContentLoaded", setup);
})();
