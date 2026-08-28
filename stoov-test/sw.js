// Stoov Bed 加热垫控制面板 - Service Worker
const CACHE_NAME = 'stoov-heating-v1';
const CACHE_ASSETS = [
  './stoov-yaokong.html',
  './serial-protocol.js',
  './yaokong-wc.js',
  './manifest.json',
  'https://unpkg.com/mqtt/dist/mqtt.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
];

// 安装：预缓存关键资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_ASSETS).catch((err) => {
        console.warn('[SW] 部分资源缓存失败:', err);
      });
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
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

// 请求拦截：缓存优先（静态资源），网络优先（API/动态）
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 仅缓存 http/https 请求，跳过 chrome-extension 等不支持的协议
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // WebSocket / MQTT 请求不缓存
  if (url.protocol === 'wss:' || url.pathname.includes('/mqtt')) {
    return;
  }

  // CDN 脚本 / 本地静态资源：缓存优先
  if (
    url.hostname === 'unpkg.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response && response.status === 200 && (url.protocol === 'http:' || url.protocol === 'https:')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 其他请求：网络优先，失败时回退缓存
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
