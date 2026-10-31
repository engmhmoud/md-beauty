// md-beauty: keeps the workspace page working offline once it has been opened.
// Network first, so a published site is always fresh; the cache is only the fallback.
// The workspace page registers this file and sends the list of files it loaded (see "cache" below).
"use strict";

var CACHE = "md-beauty-v1";
var FONTS = /^fonts\.(googleapis|gstatic)\.com$/;

function cacheable(url) {
  if (url.origin === self.location.origin) {
    return url.pathname.indexOf("/livereload") < 0 && url.pathname.indexOf("/_md-beauty/") < 0;
  }
  return FONTS.test(url.hostname);
}

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// {type: "cache", urls: [...]}: the files the workspace page needs, cached right away
self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type !== "cache" || !Array.isArray(data.urls)) return;
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return Promise.all(data.urls.filter(function (u) { return cacheable(new URL(u)); }).map(function (u) {
      return fetch(u).then(function (res) { if (res.ok) return cache.put(u, res); }).catch(function () { /* offline */ });
    }));
  }));
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || !cacheable(new URL(req.url))) return;
  event.respondWith(fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
  }));
});
