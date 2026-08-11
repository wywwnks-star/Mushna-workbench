/**
 * Service Worker - 离线缓存
 * 支持GitHub Pages子路径部署
 */
const CACHE_NAME = 'creator-workbench-v4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/utils.js',
  './js/api.js',
  './js/webdav.js',
  './js/mindmap.js',
  './js/pages.js',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 安装时缓存资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('部分资源缓存失败，继续:', err);
        return Promise.all(
          ASSETS.map(url =>
            cache.add(url).catch(() => {})
          )
        );
      });
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 拦截请求 - 网络优先，缓存回退（开发友好，部署稳定）
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理GET请求
  if (request.method !== 'GET') return;

  // 跳过非HTTP请求（如chrome-extension://）
  if (!request.url.startsWith('http')) return;

  // 不缓存跨域API请求，直接网络请求
  const urlObj = new URL(request.url);
  if (urlObj.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // 同源请求使用网络优先策略
  event.respondWith(
    fetch(request).then((response) => {
      // 如果获取成功，更新缓存
      if (response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(() => {
      // 网络失败时使用缓存
      return caches.match(request).then((cached) => {
        if (cached) return cached;
        // 离线回退到首页
        if (request.mode === 'navigate') {
          return caches.match('./');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
