/**
 * Service Worker - 离线缓存
 * 支持GitHub Pages子路径部署
 * v5 - 修复缓存问题，使用网络优先策略，确保更新及时
 */
const CACHE_NAME = 'creator-workbench-v6';
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

// 安装时立即激活，跳过等待
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
  self.skipWaiting(); // 立即激活新的SW
});

// 激活时清理所有旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim(); // 立即控制所有页面
});

// 拦截请求 - 网络优先，缓存回退（确保用户总是拿到最新版本）
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理GET请求
  if (request.method !== 'GET') return;

  // 跳过非HTTP请求（如chrome-extension://）
  if (!request.url.startsWith('http')) return;

  // 对跨域API请求（热点、AI、飞书、WebDAV等）直接网络请求，不缓存
  const urlObj = new URL(request.url);
  if (urlObj.origin !== self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then(cached => cached || new Response('Offline', { status: 503 }));
      })
    );
    return;
  }

  // 同源静态资源：先尝试网络获取最新版本，失败再用缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        // 如果获取成功，更新缓存
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() => {
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

// 监听消息，支持手动触发更新检查
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
