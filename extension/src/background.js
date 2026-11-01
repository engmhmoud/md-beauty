// md-beauty extension: the toolbar button opens the workspace; view.js hands over .md files opened in a tab.
"use strict";

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: "index.html" });
});

// {type: "view", url, text}: kept for this browser session, so the page survives a reload
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || msg.type !== "view" || !sender.tab || typeof msg.text !== "string") return;
  var item = {};
  item["view:" + msg.url] = msg.text;
  chrome.storage.session.set(item).then(function () { reply(true); }, function () { reply(false); });
  return true;  // reply comes later
});
