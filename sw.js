/* Writer's Nook service worker: makes the app and any book you have opened work offline.
   - The app itself (pages, scripts, styles, fonts) is fetched fresh when online, and kept for offline use.
   - books/library.json is also fetched fresh, falling back to the last copy.
   - Books and covers are served from the saved copy when there is one, and refreshed in the background.
   Bump VERSION when this file's behaviour changes. */
const VERSION = "v2";
const SHELL = `wn-shell-${VERSION}`;
const BOOKS = "wn-books";
const SHELL_FILES = [
  "./", "index.html", "publish.html", "styles.css", "app.js", "manifest.webmanifest",
  "js/backup.js", "js/cover.js", "js/define.js", "js/detail.js", "js/dom.js", "js/epub.js", "js/keys.js", "js/library.js", "js/libsettings.js", "js/marks.js", "js/organize.js", "js/panel.js", "js/pdf.js", "js/prefs.js", "js/pwa.js", "js/quote.js", "js/reader.js", "js/search.js", "js/select.js", "js/settings.js", "js/stats.js", "js/store.js", "js/text.js", "js/tts.js", "js/natural.js",
  "vendor/voice/engine.js", "vendor/voice/phonemize.mjs", "vendor/voice/ort.min.mjs", "vendor/voice/ort-wasm.mjs", "vendor/voice/kathleen.json",
  "vendor/pdf.min.mjs", "vendor/pdf.worker.min.mjs", "vendor/fflate.min.mjs",
  "vendor/fonts/eb-garamond-latin-400-normal.woff2", "vendor/fonts/eb-garamond-latin-400-italic.woff2",
  "vendor/fonts/eb-garamond-latin-500-normal.woff2", "vendor/fonts/eb-garamond-latin-700-normal.woff2",
  "vendor/fonts/cormorant-garamond-latin-500-normal.woff2", "vendor/fonts/cormorant-garamond-latin-600-normal.woff2",
  "vendor/fonts/cormorant-garamond-latin-500-italic.woff2",
  "vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2", "vendor/fonts/atkinson-hyperlegible-latin-400-italic.woff2",
  "vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One missing file must not stop the install: add what we can.
    await Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("wn-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isBookPath = (url) => url.pathname.includes("/books/") && !url.pathname.endsWith("/library.json");

async function networkFirst(req, cacheName, timeout = 4000) {
  const cache = await caches.open(cacheName);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  try {
    return await Promise.race([fresh, new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), timeout))]);
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: req.mode === "navigate" })) || (await cache.match("index.html"));
    if (hit) { fresh.catch(() => {}); return hit; }
    return fresh; // nothing saved: wait for the network and let it fail normally
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(BOOKS);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Range requests (PDF.js streaming) go straight through; the app downloads whole books instead.
  if (req.headers.has("range")) return;
  // The big voice files are downloaded and kept by the app itself (js/natural.js), not by this worker.
  if (url.pathname.endsWith(".gz")) return;
  if (isBookPath(url)) return e.respondWith(staleWhileRevalidate(req));
  if (url.pathname.endsWith("/library.json")) return e.respondWith(networkFirst(req, BOOKS));
  if (req.mode === "navigate") return e.respondWith(networkFirst(req, SHELL));
  e.respondWith(networkFirst(req, SHELL));
});
