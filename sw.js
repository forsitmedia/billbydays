// 🔁 Bump this when you ship a new build (e.g. when Pro becomes paid)
const CACHE_VERSION = "v1.0.0";
const CACHE_NAME = `billbydays-${CACHE_VERSION}`;

const URLS_TO_CACHE = [
  "/",
  "/index.html",
  "/step2.html",
  "/step3.html",
  "/index.js",
  "/step2.js",
  "/step3.js",
  "/favicon-32.png",
  "/favicon-48.png",
  "/favicon-180.png",
  "/android-chrome-192.png",
  "/android-chrome-512.png"
];

// Install: cache core files
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(URLS_TO_CACHE);
      // 👉 Tell the new SW to activate as soon as it's ready
      self.skipWaiting();
    })()
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          // Only touch billbydays-* caches
          if (!key.startsWith("billbydays-")) return null;
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
      // 👉 Take control of all open clients immediately
      await self.clients.claim();
    })()
  );
});

// Fetch: serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
