/* Where books live.
   - Books you publish sit in books/ and are listed by books/library.json. What you do with them
     (reading place, bookmarks, notes, status, shelves) is remembered in this browser's localStorage.
   - Files a reader opens themselves live in this browser's IndexedDB and are never published. */
import { cleanName } from "./dom.js";
import { detectSeries } from "./organize.js";

/* ---------- IndexedDB (private books) ---------- */
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open("writers-nook", 2);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("books")) db.createObjectStore("books", { keyPath: "id" });    // your own files
    if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers", { keyPath: "id" });  // covers made from published PDFs and EPUBs
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function tx(mode, fn, store = "books") {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
export const idbAll = () => tx("readonly", (s) => s.getAll());
export const idbPut = (b) => tx("readwrite", (s) => s.put(b));
export const delBook = (id) => tx("readwrite", (s) => s.delete(id));
export const putCover = (id, cover) => tx("readwrite", (s) => s.put({ id, cover }), "covers");
const allCovers = () => tx("readonly", (s) => s.getAll(), "covers").catch(() => []);
navigator.storage?.persist?.();

/* ---------- published books ---------- */
export const hosted = new Map();
export const library = { sections: [], offline: false };

/* What we remember per published book. Everything else comes from library.json. */
const PERSIST = ["progress", "anchor", "opened", "pages", "bookmarks", "highlights", "status", "statusAt", "shelves", "words", "wpp", "autoToc", "autoTocV", "finishedAt"];
export const storage = { onError: null };      // called when the browser refuses to save (storage full)
export const readMeta = () => { try { return JSON.parse(localStorage.getItem("wn-meta")) || {}; } catch { return {}; } };
export function saveMeta(b) {
  try {
    const m = readMeta(), keep = {};
    for (const k of PERSIST) {
      const v = b[k];
      if (v == null || v === "" || (Array.isArray(v) && !v.length) || (k === "progress" && !v)) continue;
      keep[k] = v;
    }
    m[b.id] = keep;
    localStorage.setItem("wn-meta", JSON.stringify(m));
  } catch { storage.onError?.(); }                 // storage full or blocked
}

const enc = (path) => "books/" + path.split("/").map(encodeURIComponent).join("/");
export async function loadHosted() {
  hosted.clear();
  try {
    const r = await fetch("books/library.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const raw = await r.json();
    // Older sites listed books as a bare array; newer ones as { sections, books }.
    const list = Array.isArray(raw) ? raw : raw.books || [];
    library.sections = Array.isArray(raw) ? [] : raw.sections || [];
    const meta = readMeta();
    const made = new Map((await allCovers()).map((c) => [c.id, c.cover]));
    detectSeries(list.filter((e) => !e.series));
    for (const e of list) {
      const id = "h:" + e.file;
      const ext = (/\.([a-z0-9]+)$/i.exec(e.file) || [])[1]?.toLowerCase();
      hosted.set(id, {
        id, hosted: true, file: e.file, added: e.added || 0, size: e.size || 0,
        kind: ext === "pdf" ? "pdf" : ext === "epub" ? "epub" : "text", md: ext === "md",
        url: enc(e.file),
        title: e.title || cleanName(e.file.split("/").pop()), author: e.author || "",
        section: e.section || "", genres: e.genres || [], series: e.series || "", seriesNo: e.seriesNo, description: e.description || "",
        ...meta[id],
        ...(e.cover ? { cover: enc(e.cover) } : made.has(id) ? { cover: made.get(id) } : { cover: undefined }),
      });
    }
  } catch { library.offline = !navigator.onLine; /* no hosted library: only local uploads */ }
}

/* ---------- one list of everything ---------- */
export const allBooks = async () => [...hosted.values(), ...(await idbAll()).sort((a, b) => b.added - a.added)];
export const getBook = async (id) => hosted.get(id) || (await tx("readonly", (s) => s.get(id)));
export const putBook = (b) => (b.hosted ? saveMeta(b) : idbPut(b));
export const saveSoon = (b) => Promise.resolve(putBook(b)).catch(() => storage.onError?.());

/* Turning pages saves your place often. Those saves are batched, and written out when you stop, leave, or close the tab. */
const pending = new Map();
let pendingTimer;
export function saveProgress(b) { pending.set(b.id, b); clearTimeout(pendingTimer); pendingTimer = setTimeout(flushSaves, 600); }
export function flushSaves() {
  clearTimeout(pendingTimer);
  for (const b of pending.values()) saveSoon(b);
  pending.clear();
}
addEventListener("pagehide", flushSaves);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSaves(); });
