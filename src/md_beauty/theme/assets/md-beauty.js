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

// ---------------------------------------------------------------- add pages (only with `md-beauty serve <folder>`)
// Paste markdown or upload .md files; the server saves them as real files, MkDocs rebuilds,
// and we open the new page as soon as it is built.
// shared helpers for the serve-only features below
var mdBeauty = (function () {
  var toastTimer;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function toast(message, isError) {
    var box = document.querySelector(".mb-toast") || document.body.appendChild(el("div", { class: "mb-toast", role: "status" }));
    box.textContent = message;
    box.classList.toggle("mb-toast-error", !!isError);
    box.classList.add("mb-toast-show");
    clearTimeout(toastTimer);
    if (isError) toastTimer = setTimeout(function () { box.classList.remove("mb-toast-show"); }, 6000);
  }

  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  return { el: el, toast: toast, typing: typing };
})();

(function () {
  if (!document.querySelector('meta[name="md-beauty-edit"]')) return;
  var API = "/_md-beauty/pages";
  var PENDING = "mb-open-after-save";  // survives the live-reload refresh that follows a save
  var el = mdBeauty.el, toast = mdBeauty.toast, typing = mdBeauty.typing;
  var dialog;

  function save(name, content) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MD-Beauty": "1" },
      body: JSON.stringify({ name: name, content: content })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Could not save the page.");
        return data;
      });
    });
  }

  // MkDocs rebuilds after it notices the new file; open the page once it exists
  function openWhenBuilt(url, tries) {
    tries = tries || 0;
    return fetch(url, { method: "HEAD", cache: "no-store" }).then(function (res) {
      if (res.ok) {
        try { sessionStorage.removeItem(PENDING); } catch (e) { /* private mode */ }
        location.href = url;
        return;
      }
      if (tries > 60) throw new Error("Saved, but the page took too long to build. Reload in a moment.");
      return new Promise(function (r) { setTimeout(r, 500); }).then(function () { return openWhenBuilt(url, tries + 1); });
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error("Could not read " + file.name)); };
      reader.readAsText(file);
    });
  }

  function uploadFiles(files, folder) {
    files = Array.prototype.filter.call(files, function (f) { return /\.(md|markdown|txt)$/i.test(f.name); });
    if (!files.length) return Promise.reject(new Error("Choose .md files (or .markdown / .txt)."));
    folder = (folder || "").replace(/^\/+|\/+$/g, "");
    var saved = [];
    return files.reduce(function (chain, file) {
      return chain.then(function () {
        return readFile(file).then(function (text) {
          var name = (folder ? folder + "/" : "") + file.name.replace(/\.txt$/i, ".md");
          return save(name, text).then(function (data) { saved.push(data); });
        });
      });
    }, Promise.resolve()).then(function () { return saved; });
  }

  function finish(saved) {
    toast(saved.length === 1 ? "Saved " + saved[0].path + ". Opening…" : "Saved " + saved.length + " pages. Opening the first…");
    try { sessionStorage.setItem(PENDING, saved[0].url); } catch (e) { /* private mode */ }
    return openWhenBuilt(saved[0].url);
  }

  function buildDialog() {
    var nameInput = el("input", { type: "text", class: "mb-input", placeholder: "Page name (optional), e.g. guide/my-page" });
    var text = el("textarea", { class: "mb-textarea", placeholder: "# Page title\n\nPaste or write markdown here…" });
    var folderInput = el("input", { type: "text", class: "mb-input", placeholder: "Save into folder (optional), e.g. guide" });
    var fileInput = el("input", { type: "file", multiple: "", accept: ".md,.markdown,.txt,text/markdown,text/plain", class: "mb-file" });
    var drop = el("label", { class: "mb-drop" }, [
      el("strong", { text: "Drop .md files here" }),
      el("span", { text: "or click to choose files" }),
      fileInput
    ]);
    var picked = el("div", { class: "mb-picked" });
    var error = el("p", { class: "mb-error", role: "alert" });
    var pastePanel = el("div", { class: "mb-panel" }, [nameInput, text]);
    var uploadPanel = el("div", { class: "mb-panel", hidden: "" }, [folderInput, drop, picked]);
    var tabPaste = el("button", { type: "button", class: "mb-tab", "aria-selected": "true", text: "Paste markdown" });
    var tabUpload = el("button", { type: "button", class: "mb-tab", "aria-selected": "false", text: "Upload .md files" });
    var cancel = el("button", { type: "button", class: "mb-btn-text", text: "Cancel" });
    var submit = el("button", { type: "submit", class: "mb-btn-primary", text: "Save and open" });
    var form = el("form", { method: "dialog", class: "mb-form" }, [
      el("h2", { text: "Add a page" }),
      el("div", { class: "mb-tabs", role: "tablist" }, [tabPaste, tabUpload]),
      pastePanel, uploadPanel, error,
      el("div", { class: "mb-actions" }, [
        el("span", { class: "mb-hint", text: "Saved as a real .md file in the folder you are serving." }),
        cancel, submit
      ])
    ]);
    var d = el("dialog", { class: "mb-dialog", "aria-label": "Add a page" }, [form]);
    var mode = "paste";

    function setMode(m) {
      mode = m;
      pastePanel.hidden = m !== "paste";
      uploadPanel.hidden = m !== "upload";
      tabPaste.setAttribute("aria-selected", m === "paste" ? "true" : "false");
      tabUpload.setAttribute("aria-selected", m === "upload" ? "true" : "false");
      error.textContent = "";
      (m === "paste" ? text : folderInput).focus();
    }
    function showPicked() {
      picked.textContent = Array.prototype.map.call(fileInput.files, function (f) { return f.name; }).join(", ");
    }

    tabPaste.addEventListener("click", function () { setMode("paste"); });
    tabUpload.addEventListener("click", function () { setMode("upload"); });
    cancel.addEventListener("click", function () { d.close(); });
    fileInput.addEventListener("change", showPicked);
    ["dragover", "dragenter"].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("mb-drop-over"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      drop.addEventListener(t, function () { drop.classList.remove("mb-drop-over"); });
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      fileInput.files = e.dataTransfer.files;
      showPicked();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      var job = mode === "paste"
        ? (text.value.trim() ? save(nameInput.value, text.value).then(function (data) { return [data]; })
                             : Promise.reject(new Error("Paste or write some markdown first.")))
        : uploadFiles(fileInput.files, folderInput.value);
      job.then(function (saved) { d.close(); return finish(saved); })
        .catch(function (err) { error.textContent = err.message; toast(err.message, true); })
        .then(function () { submit.disabled = false; });
    });

    d.open_with = function (m, prefill) {
      form.reset();
      picked.textContent = "";
      error.textContent = "";
      if (prefill) text.value = prefill;
      if (!d.open) d.showModal();
      setMode(m || "paste");
    };
    document.body.appendChild(d);
    return d;
  }

  function openDialog(mode, prefill) {
    dialog = dialog || buildDialog();
    dialog.open_with(mode, prefill);
  }

  function resumePending() {
    var url;
    try { url = sessionStorage.getItem(PENDING); } catch (e) { return; }
    if (!url) return;
    if (location.pathname === url) { sessionStorage.removeItem(PENDING); return; }
    toast("Opening the new page…");
    openWhenBuilt(url).catch(function (err) { sessionStorage.removeItem(PENDING); toast(err.message, true); });
  }

  function addButtons() {
    resumePending();
    var controls = document.querySelector(".mb-controls");
    if (controls && !controls.querySelector(".mb-btn-add")) {
      var add = el("button", { type: "button", class: "mb-btn mb-btn-add", title: "Add a page: paste markdown or upload .md files  (a)", "aria-label": "Add a page", text: "+" });
      add.addEventListener("click", function () { openDialog("paste"); });
      controls.insertBefore(add, controls.firstChild);
    }
    var empty = document.querySelector(".mb-empty");
    if (empty && !empty.dataset.bound) {
      empty.dataset.bound = "1";
      var paste = el("button", { type: "button", class: "mb-btn-primary", text: "Paste markdown" });
      var upload = el("button", { type: "button", class: "mb-btn-secondary", text: "Upload .md files" });
      paste.addEventListener("click", function () { openDialog("paste"); });
      upload.addEventListener("click", function () { openDialog("upload"); });
      empty.innerHTML = "";
      empty.appendChild(el("p", { text: "No pages yet. Add your first one:" }));
      empty.appendChild(el("div", { class: "mb-empty-actions" }, [paste, upload]));
      empty.appendChild(el("p", { class: "mb-hint", text: "Or drop .md files anywhere on this page, or press Ctrl+V to paste." }));
    }
  }

  // drop .md files anywhere: save them all and open the first
  document.addEventListener("dragover", function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) e.preventDefault();
  });
  document.addEventListener("drop", function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    toast("Saving…");
    uploadFiles(e.dataTransfer.files).then(finish).catch(function (err) { toast(err.message, true); });
  });
  // Ctrl+V outside a text field: open the paste tab with the clipboard text
  document.addEventListener("paste", function (e) {
    if (typing(e.target) || document.querySelector("dialog[open]")) return;
    var pasted = e.clipboardData && e.clipboardData.getData("text/plain");
    if (pasted && pasted.trim()) { e.preventDefault(); openDialog("paste", pasted); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "a" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      openDialog("paste");
    }
  });

  if (window.document$) window.document$.subscribe(addButtons);
  else document.addEventListener("DOMContentLoaded", addButtons);
})();

// ---------------------------------------------------------------- open another folder (only with `md-beauty serve`)
// Browse folders on this computer, pick one, and md-beauty restarts on it (same port).
(function () {
  var rootMeta = document.querySelector('meta[name="md-beauty-root"]');
  if (!rootMeta) return;
  var el = mdBeauty.el, toast = mdBeauty.toast, typing = mdBeauty.typing;
  var RECENT = "md-beauty-recent-folders";
  var OPENING = "mb-opening-folder";  // survives the live-reload refresh while md-beauty restarts
  var ICON = '<svg viewBox="0 0 24 24"><path d="M10 4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6Z"/></svg>';
  var dialog;

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ "X-MD-Beauty": "1" }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Request failed.");
        return data;
      });
    });
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch (e) { return []; }
  }
  function remember(path) {
    var list = [path].concat(recent().filter(function (p) { return p !== path; })).slice(0, 8);
    try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }
  remember(rootMeta.content);

  // a live-reload refresh may land here mid-switch: finish on the new folder's home page
  (function resume() {
    var pending;
    try { pending = sessionStorage.getItem(OPENING); } catch (e) { return; }
    if (!pending) return;
    if (pending === rootMeta.content) {
      sessionStorage.removeItem(OPENING);
      if (location.pathname !== "/") location.replace("/");
    }
  })();

  function servedRoot(html) {
    var meta = new DOMParser().parseFromString(html, "text/html").querySelector('meta[name="md-beauty-root"]');
    return meta && meta.content;
  }

  // after a restart the new server answers with the new root; then go to its home page
  function waitForRoot(path, tries) {
    tries = tries || 0;
    return fetch("/", { cache: "no-store" }).then(function (res) { return res.text(); }).then(function (html) {
      if (servedRoot(html) === path) {
        try { sessionStorage.removeItem(OPENING); } catch (e) { /* private mode */ }
        location.href = "/";
        return;
      }
      throw new Error("not yet");
    }).catch(function () {
      if (tries > 120) throw new Error("md-beauty did not come back. Check the terminal.");
      return new Promise(function (r) { setTimeout(r, 500); }).then(function () { return waitForRoot(path, tries + 1); });
    });
  }

  function open(path) {
    toast("Opening " + path + "…");
    return api("/_md-beauty/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path })
    }).then(function (data) {
      remember(data.path);
      try { sessionStorage.setItem(OPENING, data.path); } catch (e) { /* private mode */ }
      if (dialog) dialog.close();
      return waitForRoot(data.path);
    }).catch(function (err) { toast(err.message, true); throw err; });
  }

  function buildDialog() {
    var current = rootMeta.content;
    var crumbs = el("div", { class: "mb-crumbs" });
    var list = el("ul", { class: "mb-dirs" });
    var info = el("p", { class: "mb-hint" });
    var pathInput = el("input", { type: "text", class: "mb-input", placeholder: "Type or paste a folder path, then Enter" });
    var recentBox = el("div", { class: "mb-recent" });
    var error = el("p", { class: "mb-error", role: "alert" });
    var up = el("button", { type: "button", class: "mb-btn-text", text: "↑ Up" });
    var cancel = el("button", { type: "button", class: "mb-btn-text", text: "Cancel" });
    var submit = el("button", { type: "submit", class: "mb-btn-primary", text: "Open this folder" });
    var form = el("form", { method: "dialog", class: "mb-form" }, [
      el("h2", { text: "Open folder" }),
      pathInput, recentBox,
      el("div", { class: "mb-crumb-row" }, [up, crumbs]),
      list, info, error,
      el("div", { class: "mb-actions" }, [
        el("span", { class: "mb-hint", text: "md-beauty restarts on the folder you pick. Nothing is copied." }),
        cancel, submit
      ])
    ]);
    var d = el("dialog", { class: "mb-dialog", "aria-label": "Open folder" }, [form]);
    var parent = null;

    function show(path) {
      error.textContent = "";
      return api("/_md-beauty/dirs?path=" + encodeURIComponent(path)).then(function (data) {
        current = data.path;
        parent = data.parent;
        up.disabled = !parent;
        pathInput.value = data.path;
        crumbs.innerHTML = "";
        var sep = data.path.indexOf("\\") >= 0 ? "\\" : "/";
        var parts = data.path.split(sep), acc = "";
        parts.forEach(function (part, i) {
          acc = i === 0 ? (part || sep) : (acc.slice(-1) === sep ? acc : acc + sep) + part;
          if (i > 0 && !part) return;
          var target = acc;
          var b = el("button", { type: "button", class: i === 0 && !part ? "mb-crumb mb-crumb-root" : "mb-crumb", text: i === 0 && !part ? sep : part });
          b.addEventListener("click", function () { show(target); });
          crumbs.appendChild(b);
        });
        list.innerHTML = "";
        data.dirs.forEach(function (dir) {
          var b = el("button", { type: "button", class: "mb-dir" }, [
            el("span", { class: "mb-dir-name", text: dir.name }),
            el("span", { class: "mb-dir-count", text: dir.md_files ? dir.md_files + " .md" : "" })
          ]);
          b.addEventListener("click", function () { show(dir.path); });
          b.addEventListener("dblclick", function () { open(dir.path); });
          list.appendChild(el("li", {}, [b]));
        });
        if (!data.dirs.length) list.appendChild(el("li", { class: "mb-hint", text: "No subfolders." }));
        info.textContent = data.md_files === 1 ? "1 .md file in this folder." : data.md_files + " .md files in this folder.";
        submit.disabled = data.path === rootMeta.content;
        submit.textContent = submit.disabled ? "Already open" : "Open this folder";
      }).catch(function (err) { error.textContent = err.message; });
    }

    function showRecent() {
      recentBox.innerHTML = "";
      var items = recent().filter(function (p) { return p !== rootMeta.content; });
      if (!items.length) return;
      recentBox.appendChild(el("span", { class: "mb-hint", text: "Recent:" }));
      items.forEach(function (p) {
        var b = el("button", { type: "button", class: "mb-chip", title: p, text: p.split(/[\\/]/).filter(Boolean).pop() || p });
        b.addEventListener("click", function () { open(p); });
        recentBox.appendChild(b);
      });
    }

    up.addEventListener("click", function () { if (parent) show(parent); });
    cancel.addEventListener("click", function () { d.close(); });
    pathInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); show(pathInput.value.trim()); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit.disabled = true;
      open(current).catch(function (err) { error.textContent = err.message; submit.disabled = false; });
    });

    d.open_at = function () {
      showRecent();
      if (!d.open) d.showModal();
      show(rootMeta.content).then(function () { pathInput.focus(); pathInput.select(); });
    };
    document.body.appendChild(d);
    return d;
  }

  function openDialog() {
    dialog = dialog || buildDialog();
    dialog.open_at();
  }

  function addButton() {
    var controls = document.querySelector(".mb-controls");
    if (!controls || controls.querySelector(".mb-btn-open")) return;
    var b = el("button", { type: "button", class: "mb-btn mb-btn-open", title: "Open another folder  (o)", "aria-label": "Open folder", html: ICON });
    b.addEventListener("click", openDialog);
    controls.insertBefore(b, controls.firstChild);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "o" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      openDialog();
    }
  });

  if (window.document$) window.document$.subscribe(addButton);
  else document.addEventListener("DOMContentLoaded", addButton);
})();
