/**
 * Service Worker - 离线缓存
 * v8 - 单文件架构，安装时自动清除所有旧缓存
 */
var CACHE_NAME = 'creator-workbench-v8';
var ASSETS = [
  './',
  './index.html?v=8',
  './css/style.css?v=8',
  './js/app-combined.js?v=8',
  './manifest.json?v=8',
  './icons/icon.svg?v=8',
  './icons/icon-192.png?v=8',
  './icons/icon-512.png?v=8',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) { return caches.delete(key); }));
    }).then(function() {
      return caches.open(CACHE_NAME);
    }).then(function(cache) {
      return cache.addAll(ASSETS).catch(function(){});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  var urlObj = new URL(request.url);
  if (urlObj.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(function() {
        return caches.match(request).then(function(cached) { return cached || new Response('Offline', {status:503}); });
      })
    );
    return;
  }
  event.respondWith(
    fetch(request).then(function(response) {
      if (response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(request).then(function(cached) {
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('./');
        return new Response('Offline', {status:503});
      });
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
