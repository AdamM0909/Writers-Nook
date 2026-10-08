/* Writer's Nook: the entry point. Each part of the app lives in js/. */
import { $, toast } from "./js/dom.js";
import { applyTheme, toggleTheme } from "./js/prefs.js";
import { loadHosted, storage } from "./js/store.js";
import { renderLibrary } from "./js/library.js";
import { R, openBook, closeBook } from "./js/reader.js";
import "./js/marks.js";
import "./js/panel.js";
import "./js/select.js";
import "./js/settings.js";
import "./js/keys.js";
import { openLibrarySettings } from "./js/libsettings.js";
import { registerSW, canInstall, installApp } from "./js/pwa.js";
import * as stats from "./js/stats.js";

applyTheme();
let warned = 0;
storage.onError = () => {
  if (Date.now() - warned < 30000) return;
  warned = Date.now();
  toast("This browser's storage is full, so your place and notes may not be saved. Back up in Settings, then remove books you don't need.");
};
$("theme-lib").onclick = toggleTheme;
$("lib-settings").onclick = () => openLibrarySettings(renderLibrary);
$("install-btn").onclick = installApp;
const syncInstall = () => ($("install-btn").hidden = !canInstall());
addEventListener("wn:install", syncInstall);
syncInstall();

R.hooks.open.push(() => stats.start());
R.hooks.close.push(() => stats.stop());
R.hooks.finished.push((b) => stats.noteFinished(b.title));

/* #read=<id> opens a book. Extra bits say where: &p=<pdf page> or &b=<block>&o=<how far through it> */
function parseRead(hash) {
  const [first, ...rest] = hash.split("&");
  const extra = Object.fromEntries(rest.map((kv) => kv.split("=")));
  return { id: decodeURIComponent(first.slice(5)), params: { page: extra.p, block: extra.b, off: extra.o } };
}
async function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("read=")) { const { id, params } = parseRead(hash); return openBook(id, params); }
  closeBook();
  renderLibrary();
}
addEventListener("hashchange", route);
$("brand").onclick = (e) => { e.preventDefault(); if (location.hash) location.hash = ""; else renderLibrary(); };
$("skip").onclick = (e) => { e.preventDefault(); ($("search").offsetParent ? $("search") : $("view-library")).focus(); };
loadHosted().then(route);
registerSW();
