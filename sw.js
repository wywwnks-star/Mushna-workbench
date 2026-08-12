/**
 * Service Worker - 离线缓存
 * v10 - 安全版本：不自动跳过等待，不强制刷新
 */
var CACHE_NAME = 'creator-workbench-v10';
var ASSETS = [
  './',
  './index.html?v=10',
  './css/style.css?v=10',
  './js/app-combined.js?v=10',
  './manifest.json?v=10',
  './icons/icon.svg?v=10',
  './icons/icon-192.png?v=10',
  './icons/icon-512.png?v=10',
];

// 安装时：预缓存资源，但不立即激活（等待用户关闭旧标签页）
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS).catch(function(err) {
        console.log('预缓存部分资源失败:', err);
      });
    })
  );
  // 不调用 skipWaiting()，让新版本等待用户手动刷新
});

// 激活时：清理旧缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) {
          console.log('删除旧缓存:', key);
          return caches.delete(key);
        })
      );
    })
  );
  // 不调用 clients.claim()，让页面自然获得新SW
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  
  var urlObj = new URL(request.url);
  // 跨域请求（热点API、WebDAV等）直接走网络，不缓存
  if (urlObj.origin !== self.location.origin) {
    return;
  }
  
  event.respondWith(
    caches.match(request).then(function(cached) {
      if (cached) {
        // 后台更新缓存
        fetch(request).then(function(response) {
          if (response.status === 200) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(request, response.clone());
            });
          }
        }).catch(function(){});
        return cached;
      }
      return fetch(request).then(function(response) {
        if (response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(request, clone);
          });
        }
        return response;
      }).catch(function() {
        if (request.mode === 'navigate') {
          return caches.match('./');
        }
        return new Response('离线', { status: 503 });
      });
    })
  );
});

// 监听消息：支持手动触发更新
self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
