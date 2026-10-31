// md-beauty workspace: open a folder or files on this computer, read and edit them in the browser.
// Active only on pages built with the md-beauty-workspace.html template. Nothing is uploaded:
// files are read with the File System Access API (Chrome/Edge: live reload, recent items, and
// Save writes back to the files) or file inputs (other browsers: a snapshot; Save downloads).
// Installed as an app (manifest + sw.js), it also opens .md files from the computer's "Open with".
(function () {
  "use strict";

  // markdown-it 14.1.0, DOMPurify 3.2.4, js-yaml 4.1.0: shipped with the theme, so the app works offline
  var VENDOR = (document.currentScript ? document.currentScript.src : "").replace(/[^/]*$/, "") + "vendor/";
  var LIBS = [VENDOR + "markdown-it.min.js", VENDOR + "purify.min.js", VENDOR + "js-yaml.min.js"];
  var MD_TYPES = [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown"] } }];
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
  var canPickFiles = typeof window.showOpenFilePicker === "function";
  var canSaveAs = typeof window.showSaveFilePicker === "function";

  var ws = null;        // the open folder: { name, live, pages, images, options, tree }
  var libsReady = null;
  var objectUrls = [];
  var pollTimer = null;
  var md = null;
  var drafts = {};      // path -> { text, base, baseModified }: pages being edited (kept when you switch pages)
  var editing = null;   // the path shown in the editor
  var previewUrls = [];
  var previewTimer = null;
  var installEvent = null;

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
      a.classList.toggle("mb-ws-dirty", isDirty(a.getAttribute("data-path")));
    });
  }

  function showFolderBar() {
    var bar = $("mb-ws-folder");
    var count = Object.keys(ws.pages).length;
    bar.innerHTML = "";
    var reload = el("button", { type: "button", class: "mb-chip", title: "Read the folder again", text: "Reload" });
    var other = el("button", { type: "button", class: "mb-chip", title: "Open another folder", text: "Folder…" });
    var files = el("button", { type: "button", class: "mb-chip", title: "Open .md files", text: "Files…" });
    var add = el("button", { type: "button", class: "mb-chip mb-ws-add", title: "Create a new .md file", text: "+ New page" });
    reload.addEventListener("click", function () { reopen(); });
    other.addEventListener("click", function () { pick(); });
    files.addEventListener("click", function () { pickFiles(); });
    add.addEventListener("click", newPageDialog);
    bar.appendChild(el("strong", { text: ws.folder }));
    bar.appendChild(el("span", { class: "mb-hint", text: count + (count === 1 ? " page" : " pages") + (ws.live ? " · live" : " · snapshot") }));
    bar.appendChild(el("div", { class: "mb-ws-folder-actions" }, [add, ws.live || ws.handle ? reload : null, other, files]));
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

  function decorate(article, path, urls) {
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
        (urls || objectUrls).push(url);
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

  function toHtml(text) {
    return window.DOMPurify.sanitize(md.render(text), { ADD_ATTR: ["target", "open"] });
  }

  function render(path, anchor, keepScroll) {
    var page = ws.pages[path];
    if (!page) return;
    var parent = dirname(path);
    $("mb-ws-eyebrow").textContent = parent ? folderTitle(findDir(parent)) : "";
    $("mb-ws-start").hidden = true;
    document.title = plainTitle(page.title) + " - " + ws.name;
    ws.current = path;
    try { localStorage.setItem("md-beauty-ws-last:" + ws.folder, path); } catch (e) { /* private mode */ }
    if (drafts[path]) {  // this page is being edited: show the editor, not the page
      showEditor(path);
      markActive(path);
      return Promise.resolve();
    }
    hideEditor();
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    var article = $("mb-ws-article");
    var scroll = window.scrollY;
    article.innerHTML = toHtml(page.text);
    $("mb-ws-page").hidden = false;
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
      hideEditor();
      $("mb-ws-start").hidden = false;
      $("mb-ws-page").hidden = true;
      $("mb-ws-support").textContent = "No .md files in “" + ws.folder + "”. Create one with “+ New page”, or open something else.";
      return;
    }
    showFolderBar();
    var r = parseHash();
    showTree(r[0] && ws.pages[r[0]] ? r[0] : homePage());
    onHash();
    startPolling();
  }

  // keepDrafts: the same folder read again (Reload, or files added or removed on disk)
  function openHandle(handle, keepDrafts) {
    if (!keepDrafts) drafts = {};
    return libs().then(function () {
      return walkHandle(handle, "", []);
    }).then(function (entries) {
      return load(handle.name, entries, true);
    }).then(function () {
      opened(ws, handle);
      return rememberHandle(handle);
    });
  }

  function leaveDrafts() {
    return !hasDirty() || window.confirm("Your unsaved edits will be lost. Open something else?");
  }

  function pick() {
    if (!leaveDrafts()) return;
    if (canPick) {
      return window.showDirectoryPicker({ id: "md-beauty-workspace", mode: "read" }).then(openHandle).catch(function (err) {
        if (err.name !== "AbortError") showError(err);
      });
    }
    var input = el("input", { type: "file", webkitdirectory: "", multiple: "" });
    input.addEventListener("change", function () {
      if (!input.files.length) return;
      var name = (input.files[0].webkitRelativePath || "folder").split("/")[0];
      drafts = {};
      libs().then(function () { return load(name, fromFileList(input.files), false); })
        .then(function () { opened(ws, null); }).catch(showError);
    });
    input.click();
  }

  // ---- single files: the picker (Chrome/Edge), a file input, a drop, or the app's "Open with"

  function filesLabel(list) { return list.length === 1 ? list[0].name : list.length + " files"; }

  // files keep their own names; the same name twice becomes "notes (2).md"
  function fileEntries(list, key) {
    var taken = {};
    return list.map(function (item) {
      var name = item.name, n = 1;
      while (taken[name]) {
        n += 1;
        name = item.name.replace(MD_RE, "") + " (" + n + ")" + (MD_RE.exec(item.name) || [""])[0];
      }
      taken[name] = true;
      var entry = { path: name };
      entry[key] = item;
      return entry;
    });
  }

  function openFileHandles(handles, keepDrafts) {
    if (!keepDrafts) drafts = {};
    return libs().then(function () {
      return load(filesLabel(handles), fileEntries(handles, "handle"), true);
    }).then(function () {
      ws.files = handles.slice();
      opened(ws, null);
      return rememberFiles(handles);
    });
  }

  function openPlainFiles(files) {
    drafts = {};
    return libs().then(function () {
      return load(filesLabel(files), fileEntries(files, "file"), false);
    }).then(function () { opened(ws, null); });
  }

  function pickFiles() {
    if (!leaveDrafts()) return;
    if (canPickFiles) {
      return window.showOpenFilePicker({ multiple: true, types: MD_TYPES }).then(function (handles) {
        return openFileHandles(handles);
      }).catch(function (err) {
        if (err.name !== "AbortError") showError(err);
      });
    }
    var input = el("input", { type: "file", multiple: "", accept: ".md,.markdown,text/markdown" });
    input.addEventListener("change", function () {
      if (input.files.length) openPlainFiles(Array.prototype.slice.call(input.files)).catch(showError);
    });
    input.click();
  }

  // a dropped folder opens as a folder, dropped .md files as files
  function openDropped(transfer) {
    var items = Array.prototype.filter.call(transfer.items || [], function (i) { return i.kind === "file"; });
    var files = Array.prototype.slice.call(transfer.files || []);
    // handles must be asked for while the drop event runs
    var jobs = items.length && items[0].getAsFileSystemHandle ? items.map(function (i) {
      try { return i.getAsFileSystemHandle().catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
    }) : null;
    if (!leaveDrafts()) return;
    if (jobs) {
      Promise.all(jobs).then(function (handles) {
        handles = handles.filter(Boolean);
        if (!handles.length) return openPlain();  // the drag source gave no handles
        var dir = handles.filter(function (h) { return h.kind === "directory"; })[0];
        if (dir) return openHandle(dir);
        var mdFiles = handles.filter(function (h) { return h.kind === "file" && MD_RE.test(h.name); });
        if (mdFiles.length) return openFileHandles(mdFiles);
        showError(new Error("drop .md files or a folder."));
      }).catch(showError);
      return;
    }
    openPlain();

    function openPlain() {
      var mdPlain = files.filter(function (f) { return MD_RE.test(f.name); });
      if (mdPlain.length) return openPlainFiles(mdPlain).catch(showError);
      showError(new Error("drop .md files here. To open a folder in this browser, use “Open folder”."));
    }
  }

  function reopen() {
    var keep = ws && ws.current;
    var again = function () { if (keep && ws.pages[keep]) render(keep, null, true); };
    if (ws && ws.handle) return openHandle(ws.handle, true).then(again);
    if (ws && ws.files) return openFileHandles(ws.files, true).then(again);
    return pick();
  }

  function showError(err) {
    var message = "Could not open it: " + (err && err.message ? err.message : err);
    $("mb-ws-support").textContent = message;
    if ($("mb-ws-start").hidden && window.mdBeauty) window.mdBeauty.toast(message, true);
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
        if (drafts[page.path]) return followDraft(page, f);
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

  // ------------------------------------------------------------------ editing

  function isDirty(path) { var d = drafts[path]; return !!d && d.text !== d.base; }
  function hasDirty() { return Object.keys(drafts).some(isDirty); }

  // Save writes back only with a file handle (Chrome/Edge); otherwise it's "Save as" or a download
  function canWrite(page) { return !!(ws && page && page.entry && page.entry.handle); }

  // asking on the folder covers all its files with one prompt; opened files are asked one by one
  function writeHandle(page) { return ws.handle || page.entry.handle; }

  // files are opened read-only; ask for write access the first time it's needed (during a click)
  function askWrite(h) {
    if (!h.queryPermission) return Promise.resolve("granted");
    return h.queryPermission({ mode: "readwrite" }).then(function (state) {
      return state === "granted" ? state : h.requestPermission({ mode: "readwrite" });
    });
  }

  function previewOn() {
    try { return localStorage.getItem("md-beauty-ws-preview") !== "off"; } catch (e) { return true; }
  }

  function setPreview(on) {
    try { localStorage.setItem("md-beauty-ws-preview", on ? "on" : "off"); } catch (e) { /* private mode */ }
    var toggle = $("mb-ws-preview-toggle");
    toggle.setAttribute("aria-pressed", String(on));
    toggle.textContent = on ? "Hide preview" : "Show preview";
    $("mb-ws-split").classList.toggle("mb-ws-nopreview", !on);
    $("mb-ws-preview").hidden = !on;
    if (on) updatePreview();
  }

  function updatePreview() {
    if (!editing || !previewOn()) return;
    var box = $("mb-ws-preview");
    var top = box.scrollTop;
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [];
    box.innerHTML = toHtml(drafts[editing].text);
    decorate(box, editing, previewUrls).then(function () { box.scrollTop = top; });
  }

  function showState(message) {
    var dirty = isDirty(editing);
    $("mb-ws-editstate").textContent = dirty ? "Unsaved changes" : (message || "");
    var write = canWrite(ws.pages[editing]);
    var save = $("mb-ws-save");
    save.textContent = write ? "Save" : canSaveAs ? "Save as…" : "Download";
    save.title = write ? "Save the file (Ctrl+S)" : canSaveAs ? "Choose where to save this new file (Ctrl+S)"
      : "This browser can't write to your files: download the .md file (Ctrl+S)";
    save.disabled = write && !dirty;
    markActive(editing);
  }

  function notice(message, actions) {
    var box = $("mb-ws-notice");
    box.innerHTML = "";
    box.hidden = !message;
    if (!message) return;
    box.appendChild(el("span", { text: message }));
    (actions || []).forEach(function (action) {
      var b = el("button", { type: "button", class: "mb-chip", text: action[0] });
      b.addEventListener("click", function () { notice(null); action[1](); });
      box.appendChild(b);
    });
  }

  function showEditor(path) {
    var d = drafts[path];
    var source = $("mb-ws-source");
    var fresh = source.dataset.path !== path;
    editing = path;
    document.documentElement.classList.add("mb-ws-editing");
    $("mb-ws-page").hidden = true;
    $("mb-ws-editor").hidden = false;
    $("mb-ws-editpath").textContent = path;
    $("mb-ws-toc").innerHTML = "";
    $("mb-ws-toc-title").hidden = true;
    if (source.value !== d.text) source.value = d.text;
    if (fresh) {
      source.dataset.path = path;
      source.scrollTop = 0;
      $("mb-ws-preview").scrollTop = 0;
      notice(null);
      source.focus();
    }
    setPreview(previewOn());
    showState();
  }

  function hideEditor() {
    if (!editing) return;
    editing = null;
    $("mb-ws-source").dataset.path = "";
    document.documentElement.classList.remove("mb-ws-editing");
    $("mb-ws-editor").hidden = true;
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [];
  }

  function startEdit() {
    if (!ws || !ws.current || editing) return;
    var page = ws.pages[ws.current];
    drafts[page.path] = { text: page.text, base: page.text, baseModified: page.modified };
    if (canWrite(page)) askWrite(writeHandle(page)).catch(function () { /* asked again on Save */ });
    render(page.path);
  }

  function finishEdit() {
    var path = editing;
    if (isDirty(path)) {
      notice("You have unsaved changes.", [
        [canWrite(ws.pages[path]) || canSaveAs ? "Save and close" : "Download and close", function () { save().then(function (ok) { if (ok) finishEdit(); }); }],
        ["Discard changes", function () { delete drafts[path]; render(path); }]
      ]);
      return;
    }
    delete drafts[path];
    render(path);
  }

  function download(path, text) {
    var url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    var a = el("a", { href: url, download: basename(path) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // the page now holds `text` (saved or downloaded): the reading view and sidebar follow it
  function adopt(path, text, modified) {
    var page = ws.pages[path], d = drafts[path];
    var title = (ws.options.pages || {})[path] || firstHeading(text) || page.title;
    page.text = text;
    if (modified) page.modified = modified;
    if (d) { d.base = text; if (modified) d.baseModified = modified; }
    if (title !== page.title) { page.title = title; showTree(path); }
  }

  function write(path) {
    var page = ws.pages[path], text = drafts[path].text;
    return page.entry.handle.createWritable().then(function (w) {
      return w.write(text).then(function () { return w.close(); });
    }).then(function () {
      return page.entry.handle.getFile();
    }).then(function (f) {
      adopt(path, text, f.lastModified);
      if (editing === path) showState("Saved");
      return true;
    });
  }

  // resolves true once the text is safely stored (or downloaded)
  function save() {
    var path = editing, d = drafts[path], page = ws.pages[path];
    if (!path) return Promise.resolve(false);
    if (!canWrite(page) && canSaveAs) return saveAs(path);
    if (!canWrite(page)) {
      download(path, d.text);
      adopt(path, d.text);
      showState("Downloaded " + basename(path));
      return Promise.resolve(true);
    }
    return askWrite(writeHandle(page)).then(function (state) {
      if (state !== "granted") {
        notice("The browser did not allow saving this file.", [["Download a copy", function () { download(path, d.text); }]]);
        return false;
      }
      return page.entry.handle.getFile().then(function (f) {
        if (f.lastModified === d.baseModified) return write(path);
        return f.text().then(function (disk) {
          if (disk === d.base) return write(path);
          notice("This file changed on disk after you started editing.", [
            ["Save mine over it", function () { write(path).catch(function (err) { notice("Could not save: " + err.message); }); }],
            ["Load the disk version", function () { loadDisk(path, disk, f.lastModified); }]
          ]);
          return false;
        });
      }, function () {
        return write(path);  // the file was removed on disk: saving puts it back
      });
    }).catch(function (err) {
      notice("Could not save: " + (err && err.message ? err.message : err));
      return false;
    });
  }

  // a new page with no file yet (opened files or a snapshot): the user picks where it goes
  function saveAs(path) {
    return window.showSaveFilePicker({ suggestedName: basename(path), types: MD_TYPES }).then(function (handle) {
      ws.pages[path].entry = { path: path, handle: handle };
      if (ws.files) ws.files.push(handle);
      return write(path);
    }, function (err) {
      if (err.name !== "AbortError") notice("Could not save: " + err.message);
      return false;
    });
  }

  function loadDisk(path, text, modified) {
    var d = drafts[path];
    d.text = d.base = text;
    d.baseModified = modified;
    adopt(path, text, modified);
    if (editing === path) {
      $("mb-ws-source").value = text;
      updatePreview();
      showState();
    }
  }

  // polling while a page is being edited: follow the file if nothing was typed yet, else warn once
  function followDraft(page, f) {
    var d = drafts[page.path];
    if (f.lastModified === d.baseModified || d.warned === f.lastModified) return;
    return f.text().then(function (text) {
      if (text === d.base) { d.baseModified = f.lastModified; return; }
      if (!isDirty(page.path)) { loadDisk(page.path, text, f.lastModified); return; }
      d.warned = f.lastModified;
      if (editing === page.path) notice("This file changed on disk while you were editing. Save will ask which version to keep.");
    });
  }

  // ------------------------------------------------------------------ new pages

  function slugPart(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // "Guide/My Page" -> "guide/my-page.md", like md-beauty serve's page names
  function cleanName(raw) {
    var parts = raw.trim().replace(/\\/g, "/").split("/").map(function (p) { return p.trim(); })
      .filter(function (p) { return p && p !== "."; });
    if (!parts.length) throw new Error("Give the page a name.");
    parts.forEach(function (p) {
      if (p === ".." || p.charAt(0) === ".") throw new Error("Not allowed in a page name: " + p);
    });
    var last = parts.pop().replace(MD_RE, "");
    return parts.map(function (p) { return slugPart(p) || "folder"; }).concat([(slugPart(last) || "untitled") + ".md"]).join("/");
  }

  function titleFrom(raw) {
    var last = raw.trim().replace(/\\/g, "/").split("/").pop().replace(MD_RE, "").trim();
    return last || "Untitled";
  }

  function dirHandle(path) {
    return path.split("/").filter(Boolean).reduce(function (job, part) {
      return job.then(function (dir) { return dir.getDirectoryHandle(part, { create: true }); });
    }, Promise.resolve(ws.handle));
  }

  // never overwrite: page.md, page-2.md, page-3.md ... (checks the disk, not just the pages shown)
  function freeName(dir, name, n) {
    var candidate = n > 1 ? name.replace(/\.md$/, "-" + n + ".md") : name;
    return dir.getFileHandle(candidate).then(function () {
      return freeName(dir, name, n + 1);
    }, function (err) {
      if (err.name === "NotFoundError") return candidate;
      if (err.name === "TypeMismatchError") return freeName(dir, name, n + 1);  // a folder has that name
      throw err;
    });
  }

  function createPage(rel, text) {
    var folder = dirname(rel);
    var made;
    if (ws.handle) {
      made = askWrite(ws.handle).then(function (state) {
        if (state !== "granted") throw new Error("The browser did not allow writing to this folder.");
        return dirHandle(folder);
      }).then(function (dir) {
        return freeName(dir, basename(rel), 1).then(function (name) { return dir.getFileHandle(name, { create: true }); });
      }).then(function (handle) {
        return handle.createWritable().then(function (w) {
          return w.write(text).then(function () { return w.close(); });
        }).then(function () { return handle.getFile(); }).then(function (f) {
          var path = (folder ? folder + "/" : "") + handle.name;
          return { path: path, entry: { path: path, handle: handle }, modified: f.lastModified, base: text };
        });
      });
    } else {  // snapshot: the page lives in this tab until it's downloaded
      var path = rel, n = 1;
      while (ws.pages[path]) { n += 1; path = rel.replace(/\.md$/, "-" + n + ".md"); }
      made = Promise.resolve({ path: path, entry: { path: path, file: new File([text], basename(path)) }, modified: Date.now(), base: "" });
    }
    return made.then(function (p) {
      ws.pages[p.path] = { path: p.path, entry: p.entry, text: p.base, modified: p.modified, title: firstHeading(text) || basename(p.path) };
      drafts[p.path] = { text: text, base: p.base, baseModified: p.modified };
      ws.tree = buildTree();
      showFolderBar();
      location.hash = route(p.path);  // hashchange opens it in the editor
      showTree(p.path);
      startPolling();
      return p.path;
    });
  }

  function newPageDialog() {
    var dialog = $("mb-ws-new");
    var folder = ws.current ? dirname(ws.current) : "";
    $("mb-ws-new-name").value = folder ? folder + "/" : "";
    $("mb-ws-new-error").textContent = "";
    $("mb-ws-new-where").textContent = ws.handle ? "Saved into “" + ws.folder + "”"
      : canSaveAs ? "You choose where to save it" : "Downloaded when you save";
    dialog.showModal();
    $("mb-ws-new-name").focus();
  }

  function submitNewPage(e) {
    e.preventDefault();
    var raw = $("mb-ws-new-name").value;
    var rel;
    try { rel = cleanName(raw); } catch (err) { $("mb-ws-new-error").textContent = err.message; return; }
    createPage(rel, "# " + titleFrom(raw) + "\n\n").then(function () {
      $("mb-ws-new").close();
    }).catch(function (err) {
      $("mb-ws-new-error").textContent = "Could not create the page: " + (err && err.message ? err.message : err);
    });
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
    return remember({ name: handle.name, handle: handle, time: Date.now() });
  }

  function rememberFiles(handles) {
    var names = handles.map(function (h) { return h.name; });
    return remember({ name: "files:" + names.join("|"), label: filesLabel(handles), handles: handles, time: Date.now() });
  }

  function remember(record) {
    if (!canPick) return Promise.resolve();
    return db().then(function (d) {
      return new Promise(function (resolve) {
        var tx = d.transaction("recent", "readwrite");
        tx.objectStore("recent").put(record);
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
      box.appendChild(el("p", { class: "mb-hint", text: "Recent:" }));
      items.forEach(function (item) {
        var handles = item.handles || [item.handle];
        var b = el("button", { type: "button", class: "mb-chip", text: (item.handles ? "📄 " + item.label : "📁 " + item.name) });
        b.addEventListener("click", function () {
          Promise.all(handles.map(function (h) { return h.requestPermission({ mode: "read" }); })).then(function (states) {
            var allowed = handles.filter(function (h, i) { return states[i] === "granted"; });
            if (!allowed.length) return showError(new Error("permission was not given"));
            return item.handles ? openFileHandles(allowed) : openHandle(allowed[0]);
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
      ? "Your browser keeps what you open: pages update when a file changes, Edit saves back to your files, and recent items are remembered."
      : "Your browser reads what you open once (a snapshot), and edits are downloaded as .md files. To save into your files, use Chrome or Edge.";
    $("mb-ws-open").addEventListener("click", pick);
    $("mb-ws-open-files").addEventListener("click", pickFiles);
    $("mb-ws-install").hidden = !installEvent;
    $("mb-ws-install").addEventListener("click", function () {
      if (!installEvent) return;
      installEvent.prompt();
      installEvent.userChoice.then(function () { installEvent = null; $("mb-ws-install").hidden = true; });
    });
    if ("launchQueue" in window) {  // the installed app was opened with .md files ("Open with")
      window.launchQueue.setConsumer(function (params) {
        var handles = (params.files || []).filter(function (h) { return h.kind === "file"; });
        if (handles.length) openFileHandles(handles).catch(showError);
      });
    }
    registerWorker(root.dataset.base || ".");
    $("mb-ws-edit").addEventListener("click", startEdit);
    $("mb-ws-save").addEventListener("click", function () { save(); });
    $("mb-ws-done").addEventListener("click", finishEdit);
    $("mb-ws-preview-toggle").addEventListener("click", function () { setPreview(!previewOn()); });
    $("mb-ws-source").addEventListener("input", function () {
      drafts[editing].text = this.value;
      showState();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 150);
    });
    $("mb-ws-source").addEventListener("scroll", function () {  // keep the preview near the text you're on
      var box = $("mb-ws-preview"), range = this.scrollHeight - this.clientHeight;
      if (range > 0) box.scrollTop = (this.scrollTop / range) * (box.scrollHeight - box.clientHeight);
    });
    $("mb-ws-new-form").addEventListener("submit", submitNewPage);
    $("mb-ws-new-cancel").addEventListener("click", function () { $("mb-ws-new").close(); });
    $("mb-ws-search").addEventListener("input", function () { if (ws) showTree(ws.current); });
    $("mb-ws-search").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var first = document.querySelector("#mb-ws-tree a.md-nav__link");
      if (first) first.click();
    });
    showRecent();
    libs().catch(showError);  // start loading the renderer early
  }

  // offline support: sw.js at the site root, told which files this page loaded
  function registerWorker(base) {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register(base + "/sw.js").then(function () {
      return Promise.all([navigator.serviceWorker.ready, libs()]);
    }).then(function (ready) {
      var urls = [location.href.split("#")[0]].concat(performance.getEntriesByType("resource").map(function (r) { return r.name; }));
      if (ready[0].active) ready[0].active.postMessage({ type: "cache", urls: urls });
    }).catch(function () { /* works online without it */ });
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    if (!document.getElementById("mb-ws")) return;
    e.preventDefault();
    installEvent = e;
    if ($("mb-ws-install")) $("mb-ws-install").hidden = false;
  });

  function dragsFiles(e) {
    return !!document.getElementById("mb-ws") && !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0;
  }

  document.addEventListener("dragover", function (e) {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    document.documentElement.classList.add("mb-ws-dropping");
  });
  document.addEventListener("dragleave", function (e) {
    if (!e.relatedTarget) document.documentElement.classList.remove("mb-ws-dropping");
  });
  document.addEventListener("drop", function (e) {
    document.documentElement.classList.remove("mb-ws-dropping");
    if (!dragsFiles(e)) return;
    e.preventDefault();
    openDropped(e.dataTransfer);
  });

  document.addEventListener("keydown", function (e) {
    if (!document.getElementById("mb-ws") || !ws) return;
    if (editing && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    } else if (e.key === "e" && !editing && !e.ctrlKey && !e.metaKey && !e.altKey && !window.mdBeauty.typing(e.target) &&
               !document.querySelector("dialog[open]")) {
      e.preventDefault();
      startEdit();
    }
  });

  window.addEventListener("beforeunload", function (e) {
    if (document.getElementById("mb-ws") && hasDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  window.addEventListener("hashchange", function () {
    if (!document.getElementById("mb-ws")) return;
    onHash();
    if (ws) showTree(ws.current);
  });

  if (window.document$) window.document$.subscribe(init);
  else document.addEventListener("DOMContentLoaded", init);
})();
