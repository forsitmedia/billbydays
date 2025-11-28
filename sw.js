// 🧠 BillByDays service worker
// Goal: PWA install + offline support + automatic fresh updates
// → Network-first, cache as fallback. No manual version bump needed.

const CACHE_NAME = "billbydays-app-v1";
const CORE_URLS = [
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
  "/android-chrome-512.png",
];

// INSTALL: precache core files so the app works offline after first load
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_URLS);
      // Activate this service worker immediately
      self.skipWaiting();
    })()
  );
});

// ACTIVATE: delete old BillByDays caches and take control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          // Delete any old billbydays-* caches
          if (key.startsWith("billbydays-") && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
      // Make this SW control all existing tabs immediately
      await self.clients.claim();
    })()
  );
});

// FETCH: network-first, fallback to cache for offline use
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        // 👉 Try the network first, forcing a fresh fetch
        const freshResponse = await fetch(
          new Request(event.request, { cache: "no-store" })
        );

        // Save a copy in cache for offline
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, freshResponse.clone());

        // Return the fresh response to the page
        return freshResponse;
      } catch (err) {
        // ❌ Network failed (offline) → try cache
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // If it's a navigation request and we have index.html cached, use it
        if (event.request.mode === "navigate") {
          const fallback = await caches.match("/");
          if (fallback) return fallback;
        }

        // Last resort: throw error
        throw err;
      }
    })()
  );
});
