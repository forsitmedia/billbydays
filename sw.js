const CACHE_NAME = "billbydays-v1";
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
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
