const CACHE_NAME = "iot-lab-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/favicon.ico",
  "/icons/pwa-icon.svg",
  "/icons/pwa-192x192.png",
  "/esp-web-tools.html",
];

// 安装阶段：预缓存静态资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting(); // 立即激活新版本
});

// 激活阶段：清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim(); // 立即接管所有页面
});

// 拦截请求：API 走网络，静态资源走缓存
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // IoT 实时数据 API → 永远走网络，不缓存
  if (url.pathname.startsWith("/api/")) {
    return; // 默认网络请求
  }

  // 其他请求 → 缓存优先，失败则回退网络
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // 仅缓存成功的 GET 请求
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
