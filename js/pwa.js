/* Offline use and installing: registers the service worker, offers "Install", says when the app was updated,
   and keeps books saved for offline in the browser's cache. */
import { toast, h, sheet } from "./dom.js";

const CACHE = "wn-books";
let deferred = null;
export const ready = "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost");

export async function registerSW() {
  if (!ready) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) toast("Writer's Nook was updated.", { action: { label: "Refresh", run: () => { reloading = true; location.reload(); } } });
  });
  try { (await navigator.serviceWorker.register("sw.js")).update?.().catch(() => {}); } catch (e) { console.warn("service worker", e); }
}

/* ---------- installing ---------- */
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; dispatchEvent(new Event("wn:install")); });
addEventListener("appinstalled", () => { deferred = null; dispatchEvent(new Event("wn:install")); });
export const canInstall = () => !isStandalone() && (!!deferred || isIOS());
export async function installApp() {
  if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; dispatchEvent(new Event("wn:install")); return; }
  if (isIOS()) sheet({ title: "Add to your Home Screen", body: h("ol", { class: "how" },
    h("li", {}, "Tap the ", h("b", { text: "Share" }), " button in Safari (the square with an arrow)."),
    h("li", {}, "Scroll down and tap ", h("b", { text: "Add to Home Screen" }), "."),
    h("li", {}, "Open Writer's Nook from your Home Screen. Books you've opened keep working without a connection.")) });
}

/* ---------- books kept for offline reading ---------- */
const abs = (u) => new URL(u, location.href).href;
export async function isSaved(url) {
  try { return !!(await caches.match(abs(url), { cacheName: CACHE })); } catch { return false; }
}
export async function saveOffline(urls, onProgress) {
  const cache = await caches.open(CACHE);
  let done = 0;
  for (const u of urls) {
    const res = await fetch(abs(u), { cache: "reload" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await cache.put(abs(u), res);
    onProgress?.(++done / urls.length);
  }
}
export async function forgetOffline(urls) {
  try { const cache = await caches.open(CACHE); for (const u of urls) await cache.delete(abs(u)); } catch { /* nothing saved */ }
}
export async function storageUsed() {
  try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch { return 0; }
}

/* ---------- on or offline ---------- */
function net() {
  document.body.classList.toggle("offline", !navigator.onLine);
  dispatchEvent(new Event("wn:net"));
}
addEventListener("online", () => { net(); toast("Back online."); });
addEventListener("offline", () => { net(); toast("You're offline. Books you've saved still open."); });
net();
