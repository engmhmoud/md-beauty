// md-beauty workspace: open a folder on this computer and read its .md files in the browser.
// Active only on pages built with the md-beauty-workspace.html template. Nothing is uploaded:
// files are read with the File System Access API (Chrome/Edge: live reload + recent folders)
// or a folder <input> (other browsers: a read-only snapshot).
(function () {
  "use strict";

  var LIBS = [
    "https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js",
    "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js",
    "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js"
  ];
  var MD_RE = /\.(md|markdown)$/i;
  var IMG_RE = /\.(png|jpe?g|gif|svg|webp)$/i;
  var SKIP = { node_modules: 1, __pycache__: 1, venv: 1, "site-packages": 1 };
  var CONFIG = ".md-beauty.yml";
  var TAGS = /^\[(MUST|IMPORTANT|ARCHITECT|DEEP|SENIOR|OPTIONAL)\]$/;
  var ALERTS = { NOTE: "info", IMPORTANT: "info", TIP: "tip", WARNING: "warning", CAUTION: "warning" };
  var WARN_WORDS = ["warning", "trap", "gotcha", "caution", "careful", "danger", "pitfall", "don't", "do not",
                    "never", "common mistake", "watch out", "bug", "wrong"];
  var TIP_WORDS = ["tip", "interview", "takeaway", "remember", "rule of thumb", "must know", "shortcut",
                   "key idea", "core idea", "try it", "in short", "tl;dr", "answer"];
  var canPick = typeof window.showDirectoryPicker === "function";

  var ws = null;        // the open folder: { name, live, pages, images, options, tree }
  var libsReady = null;
  var objectUrls = [];
  var pollTimer = null;
  var md = null;

  // ------------------------------------------------------------------ small helpers

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function libs() {
    libsReady = libsReady || LIBS.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src); });
    }, Promise.resolve()).then(function () {
      md = window.markdownit({ html: true, linkify: true });
    });
    return libsReady;
  }

  // GitHub-style heading ids, the same as md-beauty's MkDocs build
  function slug(text) {
    return text.trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
  }

  function firstHeading(text) {
    var m = /^# (.+)$/m.exec(text);
    return m ? m[1].trim() : null;
  }

  function shortTitle(title) {
    return title.replace(/\s*\(.*$/, "").replace(/:\s.*$/, "").replace(/`/g, "").trim();
  }

  function dirname(path) { var i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i); }
  function basename(path) { return path.slice(path.lastIndexOf("/") + 1); }

  function resolve(base, rel) {
    var parts = (base ? base.split("/") : []);
    rel.split("/").forEach(function (p) {
      if (p === "..") parts.pop();
      else if (p && p !== ".") parts.push(p);
    });
    return parts.join("/");
  }

  // gitignore-style patterns from .md-beauty.yml `exclude` (e.g. /drafts/**, *.tmp.md)
  function globToRegex(glob) {
    var anchored = glob.charAt(0) === "/";
    var body = glob.replace(/^\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")
      .replace(/\u0000/g, ".*");
    return new RegExp((anchored ? "^" : "(^|/)") + body + "$");
  }

  function isIndex(path) { return /^(readme|index)\.(md|markdown)$/i.test(basename(path)); }

  // ------------------------------------------------------------------ reading the folder

  function walkHandle(dir, prefix, out) {
    var it = dir.entries();
    function next() {
      return it.next().then(function (step) {
        if (step.done) return out;
        var name = step.value[0], handle = step.value[1];
        var path = prefix ? prefix + "/" + name : name;
        var job = Promise.resolve();
        if (handle.kind === "directory") {
          if (name.charAt(0) !== "." && !SKIP[name]) job = walkHandle(handle, path, out);
        } else if (MD_RE.test(name) || IMG_RE.test(name) || path === CONFIG) {
          out.push({ path: path, handle: handle });
        }
        return job.then(next);
      });
    }
    return next();
  }

  function fromFileList(list) {
    var out = [];
    Array.prototype.forEach.call(list, function (file) {
      var parts = (file.webkitRelativePath || file.name).split("/");
      parts.shift();  // the picked folder itself
      var path = parts.join("/");
      if (parts.some(function (p) { return p.charAt(0) === "." && p !== CONFIG; }) || parts.some(function (p) { return SKIP[p]; })) return;
      if (MD_RE.test(path) || IMG_RE.test(path) || path === CONFIG) out.push({ path: path, file: file });
    });
    return out;
  }

  function getFile(entry) { return entry.handle ? entry.handle.getFile() : Promise.resolve(entry.file); }

  function load(name, entries, live) {
    var config = entries.filter(function (e) { return e.path === CONFIG; })[0];
    var optionsJob = config ? getFile(config).then(function (f) { return f.text(); }).then(function (t) {
      try { return window.jsyaml.load(t) || {}; } catch (e) { return {}; }
    }) : Promise.resolve({});
    return optionsJob.then(function (options) {
      var excludes = (options.exclude || []).map(globToRegex);
      var keep = function (e) { return !excludes.some(function (re) { return re.test(e.path); }); };
      var pages = {}, images = {};
      var mdEntries = entries.filter(function (e) { return MD_RE.test(e.path) && keep(e); });
      entries.forEach(function (e) { if (IMG_RE.test(e.path)) images[e.path] = e; });
      return Promise.all(mdEntries.map(function (e) {
        return getFile(e).then(function (f) {
          return f.text().then(function (text) {
            pages[e.path] = { path: e.path, entry: e, text: text, modified: f.lastModified,
                              title: (options.pages || {})[e.path] || firstHeading(text) || basename(e.path).replace(MD_RE, "") };
          });
        });
      })).then(function () {
        ws = { name: options.title || name, folder: name, live: live, pages: pages, images: images, options: options };
        ws.tree = buildTree();
        return ws;
      });
    });
  }

  // ------------------------------------------------------------------ sidebar tree

  function buildTree() {
    var root = { path: "", name: ws.name, dirs: {}, files: [] };
    Object.keys(ws.pages).forEach(function (path) {
      var node = root;
      var parts = path.split("/");
      parts.slice(0, -1).forEach(function (part, i) {
        var p = parts.slice(0, i + 1).join("/");
        node = node.dirs[part] = node.dirs[part] || { path: p, name: part, dirs: {}, files: [] };
      });
      node.files.push(path);
    });
    return root;
  }

  function folderTitle(node) {
    var sections = ws.options.sections || {};
    if (sections[node.path]) return sections[node.path];
    var index = node.files.filter(isIndex)[0];
    return index ? shortTitle(plainTitle(ws.pages[index].title)) : node.name;
  }

  function sortedChildren(node, top) {
    var order = top ? (ws.options.order || []) : [];
    var items = node.files.map(function (f) { return { file: f, key: basename(f) }; })
      .concat(Object.keys(node.dirs).map(function (d) { return { dir: node.dirs[d], key: d }; }));
    function rank(item) {
      if (item.file && isIndex(item.file)) return [0, 0];
      var i = order.indexOf(item.key);
      if (i >= 0) return [1, i];
      return [2, item.dir && item.key.charAt(0) === "_" ? 1 : 0];
    }
    return items.sort(function (a, b) {
      var ra = rank(a), rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || a.key.localeCompare(b.key, undefined, { numeric: true });
    });
  }

  function plainTitle(title) {
    return title.replace(/`\[(MUST|IMPORTANT|ARCHITECT|DEEP|SENIOR|OPTIONAL)\]`/g, "").replace(/`/g, "").trim();
  }

  function link(path, cls) {
    return el("a", { class: "md-nav__link" + (cls ? " " + cls : ""), href: "#/" + encodeURI(path), "data-path": path },
              [el("span", { class: "md-ellipsis", text: plainTitle(ws.pages[path].title) })]);
  }

  function renderTree(node, depth, open) {
    var list = el("ul", { class: "md-nav__list" });
    sortedChildren(node, depth === 0).forEach(function (item) {
      if (item.file) {
        list.appendChild(el("li", { class: "md-nav__item" }, [link(item.file)]));
        return;
      }
      var dir = item.dir;
      var inside = open && (open === dir.path || open.indexOf(dir.path + "/") === 0);
      if (depth === 0) {  // top-level folders are section labels, like navigation.sections
        list.appendChild(el("li", { class: "md-nav__item md-nav__item--section" }, [
          el("span", { class: "md-nav__link mb-ws-section", text: folderTitle(dir) }), renderTree(dir, 1, open)
        ]));
      } else {
        var details = el("details", { class: "mb-ws-dir" }, [el("summary", { class: "md-nav__link", text: folderTitle(dir) }), renderTree(dir, depth + 1, open)]);
        if (inside) details.open = true;
        list.appendChild(el("li", { class: "md-nav__item" }, [details]));
      }
    });
    return list;
  }

  function showTree(current) {
    var tree = $("mb-ws-tree");
    var query = ($("mb-ws-search").value || "").trim().toLowerCase();
    tree.innerHTML = "";
    if (query) {
      var hits = Object.keys(ws.pages).filter(function (p) {
        var page = ws.pages[p];
        return (page.title + " " + p + " " + page.text).toLowerCase().indexOf(query) >= 0;
      }).sort();
      hits.forEach(function (p) {
        var a = link(p);
        a.appendChild(el("small", { class: "mb-ws-hit-path", text: p }));
        tree.appendChild(el("li", { class: "md-nav__item" }, [a]));
      });
      if (!hits.length) tree.appendChild(el("li", { class: "md-nav__item mb-hint", text: "No pages match." }));
    } else {
      tree.appendChild(renderTree(ws.tree, 0, dirname(current || "")));
    }
    markActive(current);
  }

  function markActive(current) {
    document.querySelectorAll("#mb-ws-tree a.md-nav__link").forEach(function (a) {
      a.classList.toggle("md-nav__link--active", a.getAttribute("data-path") === current);
    });
  }

  function showFolderBar() {
    var bar = $("mb-ws-folder");
    var count = Object.keys(ws.pages).length;
    bar.innerHTML = "";
    var reload = el("button", { type: "button", class: "mb-chip", title: "Read the folder again", text: "Reload" });
    var other = el("button", { type: "button", class: "mb-chip", title: "Open another folder", text: "Open…" });
    reload.addEventListener("click", function () { reopen(); });
    other.addEventListener("click", function () { pick(); });
    bar.appendChild(el("strong", { text: ws.folder }));
    bar.appendChild(el("span", { class: "mb-hint", text: count + (count === 1 ? " page" : " pages") + (ws.live ? " · live" : " · snapshot") }));
    bar.appendChild(el("div", { class: "mb-ws-folder-actions" }, [ws.live || ws.handle ? reload : null, other]));
    $("mb-ws-search").hidden = false;
  }

  // ------------------------------------------------------------------ rendering a page

  function calloutKind(label) {
    var low = label.toLowerCase();
    if (WARN_WORDS.some(function (w) { return low.indexOf(w) >= 0; })) return "warning";
    if (TIP_WORDS.some(function (w) { return low.indexOf(w) >= 0; })) return "tip";
    return "info";
  }

  function route(path, anchor) { return "#/" + encodeURI(path) + (anchor ? "#" + anchor : ""); }

  function decorate(article, path) {
    var used = {};
    article.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
      var id = slug(h.textContent) || "section", n = used[id] || 0;
      used[id] = n + 1;
      if (n) id += "_" + n;
      h.id = id;
      h.appendChild(el("a", { class: "headerlink", href: route(path, id), title: "Permanent link", text: "#" }));
    });
    article.querySelectorAll("blockquote").forEach(function (q) {
      var p = q.querySelector("p");
      var kind = "info";
      if (p && /^\s*\[!(\w+)\]/.test(p.innerHTML)) {
        var m = /^\s*\[!(\w+)\]\s*(<br\s*\/?>)?\s*/.exec(p.innerHTML);
        kind = ALERTS[m[1].toUpperCase()] || "info";
        p.innerHTML = p.innerHTML.slice(m[0].length);
      } else if (p && p.firstElementChild && p.firstElementChild.tagName === "STRONG" && p.innerHTML.trim().indexOf("<strong>") === 0) {
        kind = calloutKind(p.firstElementChild.textContent);
      }
      q.classList.add("callout", "callout-" + kind);
    });
    article.querySelectorAll("code").forEach(function (c) {
      var m = TAGS.exec(c.textContent);
      if (m && c.parentElement.tagName !== "PRE") {
        c.replaceWith(el("span", { class: "tag tag-" + m[1].toLowerCase(), text: m[1] }));
      }
    });
    article.querySelectorAll("p > strong:first-child").forEach(function (s) {
      if (/^(Interview line|Interview answer|Say this):?$/.test(s.textContent.trim()) && s.parentElement.innerHTML.indexOf("<strong>") === 0) {
        s.parentElement.classList.add("interview-line");
      }
    });
    article.querySelectorAll("table").forEach(function (t) {
      var wrap = el("div", { class: "md-typeset__scrollwrap" }, [el("div", { class: "md-typeset__table" })]);
      t.replaceWith(wrap);
      wrap.firstChild.appendChild(t);
    });
    article.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) {
        a.target = "_blank";
        a.rel = "noopener";
      } else if (href.charAt(0) === "#") {
        if (href.indexOf("#/") !== 0) a.setAttribute("href", route(path, href.slice(1)));
      } else {
        var parts = href.split("#");
        var target = resolve(dirname(path), decodeURI(parts[0]));
        if (!MD_RE.test(target)) {
          var index = ["README.md", "index.md"].map(function (n) { return (target ? target + "/" : "") + n; })
            .filter(function (p) { return ws.pages[p]; })[0];
          if (index) target = index;
        }
        if (ws.pages[target]) a.setAttribute("href", route(target, parts[1]));
        else { a.classList.add("mb-ws-missing"); a.title = "Not in this folder: " + target; }
      }
    });
    var images = [];
    article.querySelectorAll("img[src]").forEach(function (img) {
      var src = img.getAttribute("src");
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.indexOf("//") === 0) return;
      var entry = ws.images[resolve(dirname(path), decodeURI(src))];
      if (!entry) return;
      images.push(getFile(entry).then(function (f) {
        var url = URL.createObjectURL(f);
        objectUrls.push(url);
        img.src = url;
      }));
    });
    return Promise.all(images);
  }

  function showToc(article, path) {
    var toc = $("mb-ws-toc");
    toc.innerHTML = "";
    var current = null;
    article.querySelectorAll("h2, h3").forEach(function (h) {
      var text = h.cloneNode(true);
      text.querySelectorAll(".headerlink, .tag").forEach(function (x) { x.remove(); });
      var item = el("li", { class: "md-nav__item" }, [el("a", { class: "md-nav__link", href: route(path, h.id), text: text.textContent.trim() })]);
      if (h.tagName === "H2" || !current) {
        toc.appendChild(item);
        current = item;
      } else {
        var sub = current.querySelector("ul") || current.appendChild(el("ul", { class: "md-nav__list" }));
        sub.appendChild(item);
      }
    });
    $("mb-ws-toc-title").hidden = !toc.children.length;
  }

  function render(path, anchor, keepScroll) {
    var page = ws.pages[path];
    if (!page) return;
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    var article = $("mb-ws-article");
    var scroll = window.scrollY;
    article.innerHTML = window.DOMPurify.sanitize(md.render(page.text), { ADD_ATTR: ["target", "open"] });
    var parent = dirname(path);
    $("mb-ws-eyebrow").textContent = parent ? folderTitle(findDir(parent)) : "";
    $("mb-ws-start").hidden = true;
    $("mb-ws-page").hidden = false;
    document.title = plainTitle(page.title) + " - " + ws.name;
    ws.current = path;
    try { localStorage.setItem("md-beauty-ws-last:" + ws.folder, path); } catch (e) { /* private mode */ }
    return decorate(article, path).then(function () {
      showToc(article, path);
      markActive(path);
      if (keepScroll) window.scrollTo(0, scroll);
      else if (anchor && document.getElementById(anchor)) document.getElementById(anchor).scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }

  function findDir(path) {
    var node = ws.tree;
    path.split("/").forEach(function (p) { node = node && node.dirs[p]; });
    return node || { path: path, name: basename(path), dirs: {}, files: [] };
  }

  function homePage() {
    var root = sortedChildren(ws.tree, true);
    var last;
    try { last = localStorage.getItem("md-beauty-ws-last:" + ws.folder); } catch (e) { /* private mode */ }
    if (last && ws.pages[last]) return last;
    var first = root.filter(function (i) { return i.file; })[0];
    if (first) return first.file;
    var any = Object.keys(ws.pages).sort()[0];
    return any || null;
  }

  // "#/guide/intro.md#section" -> ["guide/intro.md", "section"]
  function parseHash() {
    var h = location.hash;
    if (h.indexOf("#/") !== 0) return [null, null];
    var rest = h.slice(2), i = rest.indexOf("#");
    return [decodeURI(i < 0 ? rest : rest.slice(0, i)), i < 0 ? null : decodeURIComponent(rest.slice(i + 1))];
  }

  function onHash() {
    if (!ws) return;
    var r = parseHash();
    if (!r[0] || !ws.pages[r[0]]) {
      var home = homePage();
      if (home) history.replaceState(null, "", route(home));
      r = [home, null];
    }
    if (!r[0]) return;
    if (r[0] === ws.current && r[1] && document.getElementById(r[1])) {
      document.getElementById(r[1]).scrollIntoView();
      return;
    }
    render(r[0], r[1]);
  }

  // ------------------------------------------------------------------ opening folders

  function opened(result, handle) {
    ws.handle = handle || null;
    if (!Object.keys(ws.pages).length) {
      showFolderBar();
      $("mb-ws-tree").innerHTML = "";
      $("mb-ws-start").hidden = false;
      $("mb-ws-page").hidden = true;
      $("mb-ws-support").textContent = "No .md files in “" + ws.folder + "”. Pick another folder.";
      return;
    }
    showFolderBar();
    var r = parseHash();
    showTree(r[0] && ws.pages[r[0]] ? r[0] : homePage());
    onHash();
    startPolling();
  }

  function openHandle(handle) {
    return libs().then(function () {
      return walkHandle(handle, "", []);
    }).then(function (entries) {
      return load(handle.name, entries, true);
    }).then(function () {
      opened(ws, handle);
      return rememberHandle(handle);
    });
  }

  function pick() {
    if (canPick) {
      return window.showDirectoryPicker({ id: "md-beauty-workspace", mode: "read" }).then(openHandle).catch(function (err) {
        if (err.name !== "AbortError") showError(err);
      });
    }
    var input = el("input", { type: "file", webkitdirectory: "", multiple: "" });
    input.addEventListener("change", function () {
      if (!input.files.length) return;
      var name = (input.files[0].webkitRelativePath || "folder").split("/")[0];
      libs().then(function () { return load(name, fromFileList(input.files), false); })
        .then(function () { opened(ws, null); }).catch(showError);
    });
    input.click();
  }

  function reopen() {
    if (ws && ws.handle) {
      var keep = ws.current;
      return openHandle(ws.handle).then(function () { if (keep && ws.pages[keep]) render(keep, null, true); });
    }
    return pick();
  }

  function showError(err) {
    $("mb-ws-support").textContent = "Could not open the folder: " + (err && err.message ? err.message : err);
  }

  // live reload (Chrome/Edge): re-read the open page when its file changes; re-read the folder for new files
  function startPolling() {
    clearInterval(pollTimer);
    if (!ws || !ws.live) return;
    var ticks = 0;
    pollTimer = setInterval(function () {
      if (!document.getElementById("mb-ws")) { clearInterval(pollTimer); return; }
      if (document.hidden || !ws.current) return;
      var page = ws.pages[ws.current];
      ticks += 1;
      if (ticks % 5 === 0 && ws.handle) {  // every ~7.5 s: notice added or removed files
        walkHandle(ws.handle, "", []).then(function (entries) {
          var now = entries.filter(function (e) { return MD_RE.test(e.path); }).map(function (e) { return e.path; }).sort().join("|");
          if (now !== Object.keys(ws.pages).sort().join("|")) reopen();
        }).catch(function () { /* folder gone or permission dropped */ });
        return;
      }
      getFile(page.entry).then(function (f) {
        if (f.lastModified === page.modified) return;
        return f.text().then(function (text) {
          page.text = text;
          page.modified = f.lastModified;
          page.title = (ws.options.pages || {})[page.path] || firstHeading(text) || page.title;
          render(page.path, null, true);
        });
      }).catch(function () { /* file removed: the folder check above will notice */ });
    }, 1500);
  }

  // ------------------------------------------------------------------ recent folders (IndexedDB keeps the handles)

  function db() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("md-beauty-workspace", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("recent", { keyPath: "name" }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function rememberHandle(handle) {
    if (!canPick) return Promise.resolve();
    return db().then(function (d) {
      return new Promise(function (resolve) {
        var tx = d.transaction("recent", "readwrite");
        tx.objectStore("recent").put({ name: handle.name, handle: handle, time: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).catch(function () { /* storage blocked */ });
  }

  function recentHandles() {
    if (!canPick) return Promise.resolve([]);
    return db().then(function (d) {
      return new Promise(function (resolve) {
        var req = d.transaction("recent").objectStore("recent").getAll();
        req.onsuccess = function () { resolve(req.result.sort(function (a, b) { return b.time - a.time; }).slice(0, 8)); };
        req.onerror = function () { resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function showRecent() {
    var box = $("mb-ws-recent");
    recentHandles().then(function (items) {
      box.innerHTML = "";
      if (!items.length) return;
      box.appendChild(el("p", { class: "mb-hint", text: "Recent folders:" }));
      items.forEach(function (item) {
        var b = el("button", { type: "button", class: "mb-chip", text: item.name });
        b.addEventListener("click", function () {
          item.handle.requestPermission({ mode: "read" }).then(function (state) {
            if (state === "granted") return openHandle(item.handle);
            showError(new Error("permission was not given"));
          }).catch(showError);
        });
        box.appendChild(b);
      });
    });
  }

  // ------------------------------------------------------------------ start

  function init() {
    var root = document.getElementById("mb-ws");
    if (!root || root.dataset.ready) return;
    // reached through instant navigation: load the page for real so its config (instant off) applies
    var cfg = document.getElementById("__config");
    if (cfg && cfg.textContent.indexOf("navigation.instant") >= 0) { location.reload(); return; }
    root.dataset.ready = "1";
    $("mb-ws-support").textContent = canPick
      ? "Your browser keeps the folder open: pages update when you save a file, and recent folders are remembered."
      : "Your browser reads the folder once (a snapshot). For live updates and recent folders, use Chrome or Edge.";
    $("mb-ws-open").addEventListener("click", pick);
    $("mb-ws-search").addEventListener("input", function () { if (ws) showTree(ws.current); });
    $("mb-ws-search").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var first = document.querySelector("#mb-ws-tree a.md-nav__link");
      if (first) first.click();
    });
    showRecent();
    libs().catch(showError);  // start loading the renderer early
  }

  window.addEventListener("hashchange", function () {
    if (!document.getElementById("mb-ws")) return;
    onHash();
    if (ws) showTree(ws.current);
  });

  if (window.document$) window.document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
