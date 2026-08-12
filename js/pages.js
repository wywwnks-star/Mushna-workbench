/**
 * Service Worker - 离线缓存
 * v7 - 强制清除所有旧缓存，网络优先策略
 */
const CACHE_NAME = 'creator-workbench-v7';
const ASSETS = [
  './',
  './index.html?v=7',
  './css/style.css?v=7',
  './js/db.js?v=7',
  './js/utils.js?v=7',
  './js/api.js?v=7',
  './js/webdav.js?v=7',
  './js/mindmap.js?v=7',
  './js/pages.js?v=7',
  './js/app.js?v=7',
  './manifest.json?v=7',
  './icons/icon.svg?v=7',
  './icons/icon-192.png?v=7',
  './icons/icon-512.png?v=7',
];

// 安装时立即激活，删除所有旧缓存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      // 删除所有旧版本缓存
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => {
      return caches.open(CACHE_NAME);
    }).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// 激活时接管所有页面
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 网络优先策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const urlObj = new URL(request.url);
  
  // 跨域请求（API等）直接走网络，不缓存
  if (urlObj.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 }));
      })
    );
    return;
  }

  // 同源资源：网络优先，失败用缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return caches.match('./');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
