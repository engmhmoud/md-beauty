// md-beauty: reading controls (collapsible sidebars, text size) and "mark as read".
// Everything is saved per browser; main.html applies the saved layout before the page paints.
(function () {
  var root = document.documentElement;
  var READ_KEY = "md-beauty-read";
  var MIN_SCALE = 0.8, MAX_SCALE = 3, STEP = 0.1;

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  // ---------------------------------------------------------------- layout controls

  var ICON_NAV = '<svg viewBox="0 0 24 24"><path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h5V6H4Zm7 0v12h9V6h-9Z"/></svg>';
  var ICON_TOC = '<svg viewBox="0 0 24 24"><path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h11V6H4Zm13 0v12h3V6h-3Z"/></svg>';

  function scale() { return parseFloat(get("mb-text-scale")) || 1; }

  function setScale(value) {
    value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 10) / 10));
    set("mb-text-scale", String(value));
    root.style.setProperty("--mb-text-scale", value);
    var label = document.querySelector(".mb-size");
    if (label) label.textContent = Math.round(value * 100) + "%";
  }

  function toggle(name, force) {
    var hidden = root.classList.toggle("mb-hide-" + name, force);
    set("mb-hide-" + name, hidden ? "1" : "0");
    var btn = document.querySelector(".mb-btn-" + name);
    if (btn) btn.setAttribute("aria-pressed", hidden ? "false" : "true");
  }

  function button(cls, html, title, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "mb-btn " + cls;
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", onClick);
    return b;
  }

  function addControls() {
    var header = document.querySelector(".md-header__inner");
    if (!header || header.querySelector(".mb-controls")) return;
    var box = document.createElement("div");
    box.className = "mb-controls";
    box.appendChild(button("mb-btn-nav", ICON_NAV, "Show/hide the left sidebar  [", function () { toggle("nav"); }));
    box.appendChild(button("mb-btn-toc", ICON_TOC, "Show/hide the table of contents  ]", function () { toggle("toc"); }));
    box.appendChild(button("mb-btn-smaller", "A−", "Smaller text  -", function () { setScale(scale() - STEP); }));
    var size = document.createElement("span");
    size.className = "mb-size";
    box.appendChild(size);
    box.appendChild(button("mb-btn-bigger", "A+", "Bigger text  =", function () { setScale(scale() + STEP); }));
    var anchor = header.querySelector(".md-header__option") || header.querySelector(".md-search");
    header.insertBefore(box, anchor);
    toggle("nav", root.classList.contains("mb-hide-nav"));
    toggle("toc", root.classList.contains("mb-hide-toc"));
    setScale(scale());
  }

  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "[") toggle("nav");
    else if (e.key === "]") toggle("toc");
    else if (e.key === "\\") {
      var focus = !(root.classList.contains("mb-hide-nav") && root.classList.contains("mb-hide-toc"));
      toggle("nav", focus);
      toggle("toc", focus);
    } else if (e.key === "=" || e.key === "+") setScale(scale() + STEP);
    else if (e.key === "-") setScale(scale() - STEP);
    else if (e.key === "0") setScale(1);
    else return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------- mark as read

  function loadRead() {
    try { return JSON.parse(get(READ_KEY)) || {}; } catch (e) { return {}; }
  }
  function pathOf(href) {
    return new URL(href, location.href).pathname.replace(/index\.html$/, "");
  }

  function paintRead() {
    var read = loadRead();
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

  function setupRead() {
    var btn = document.querySelector(".mb-read-toggle");
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var read = loadRead();
        if (read[location.pathname]) delete read[location.pathname];
        else read[location.pathname] = Date.now();
        set(READ_KEY, JSON.stringify(read));
        paintRead();
      });
    }
    paintRead();
  }

  function setup() {
    addControls();
    setupRead();
  }

  // Material's instant navigation swaps pages without a reload
  if (window.document$) window.document$.subscribe(setup);
  else document.addEventListener("DOMContentLoaded", setup);
})();
