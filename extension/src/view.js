// md-beauty extension: a .md file opened in a tab shows in md-beauty style.
// Only plain text (raw files on the web, files on this computer): a site's own page about a .md file is left alone.
(function () {
  "use strict";
  if (!/^text\/(plain|markdown|x-markdown)$/i.test(document.contentType || "") || !document.body) return;
  var pre = document.body.querySelector("pre");
  var text = (pre || document.body).textContent;
  var url = location.href.split("#")[0];
  chrome.runtime.sendMessage({ type: "view", url: url, text: text }, function (ok) {
    if (!ok) return;  // keep the plain text
    // replace: Back goes to the page before, not to this file again
    location.replace(chrome.runtime.getURL("index.html") + "?src=" + encodeURIComponent(url));
  });
})();
