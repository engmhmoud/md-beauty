// md-beauty extension: extras for the workspace when it runs as the extension's own page.
// ?src=<address> shows the .md file the browser opened there (view.js handed its text to background.js).
(function () {
  "use strict";
  var src = new URLSearchParams(location.search).get("src");

  function $(id) { return document.getElementById(id); }

  function nameOf(url) {
    var path = new URL(url).pathname;
    var name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
    return /\.(md|markdown)$/i.test(name) ? name : "page.md";
  }

  function textOf(url) {
    var key = "view:" + url;
    return chrome.storage.session.get(key).then(function (got) {
      if (typeof got[key] === "string") return got[key];
      if (!/^https?:/.test(url)) throw new Error("this browser session no longer has it.");
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("the address answered " + res.status + ".");
        return res.text();
      });
    });
  }

  function show() {
    var name = nameOf(src);
    textOf(src).then(function (text) {
      return window.mdBeautyWorkspace.openText(name, text, src);
    }).catch(function (err) {
      var support = $("mb-ws-support");
      support.textContent = "Could not show " + name + ": " + err.message + " ";
      support.appendChild(Object.assign(document.createElement("a"), { href: src, textContent: "Open it again" }));
    });
  }

  // files on this computer show here only once "Allow access to file URLs" is on
  function fileAccessHint() {
    var hint = $("mb-ext-file-access");
    if (!hint) return;
    chrome.extension.isAllowedFileSchemeAccess(function (allowed) { hint.hidden = allowed; });
    $("mb-ext-settings").addEventListener("click", function () {
      chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id });
    });
  }

  // a page can't follow a link to file:// by itself; the extension opens it
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href^='file:']");
    if (!a || e.button !== 0) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.shiftKey) chrome.tabs.create({ url: a.href, active: false });
    else chrome.tabs.update({ url: a.href });
  });

  window.addEventListener("load", function () {
    fileAccessHint();
    if (src) show();
  });
})();
