const APP_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = `fp25-reader-${APP_VERSION}`;
const APP_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    APP_FILES.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" })),
  )));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("fp25-reader-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    !requestUrl.href.startsWith(self.registration.scope) ||
    requestUrl.pathname.endsWith("/version.json")
  ) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cacheUrl = event.request.mode === "navigate"
          ? new URL("./", self.registration.scope)
          : event.request;
        await cache.put(cacheUrl, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request) ||
        await cache.match(event.request, { ignoreSearch: true });
      if (cached) {
        return cached;
      }
      throw error;
    }
  })());
});
