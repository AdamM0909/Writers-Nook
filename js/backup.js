/* Backup and restore: everything that lives only in this browser (your own files, reading places, bookmarks,
   notes, shelves, settings, stats) in one file you can keep or move to another device. */
import { idbAll, idbPut } from "./store.js";
import { h, sheet, toast } from "./dom.js";

const FORMAT = "writers-nook-backup";
const blobToData = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const dataToBlob = async (url) => (await fetch(url)).blob();

export async function exportBackup() {
  const prefs = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("wn-")) prefs[k] = localStorage.getItem(k); } } catch { /* blocked */ }
  const books = [];
  for (const b of await idbAll()) {
    const copy = { ...b };
    if (b.data instanceof Blob) { copy.data = await blobToData(b.data); copy.dataIsBlob = true; }
    books.push(copy);
  }
  const json = JSON.stringify({ format: FORMAT, version: 1, exported: new Date().toISOString(), prefs, books });
  const a = h("a", { href: URL.createObjectURL(new Blob([json], { type: "application/json" })), download: `writers-nook-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return { books: books.length, bytes: json.length };
}

/* Merge a backup into this browser. Same book id: the backup's copy wins. Stats days keep the larger number. */
export async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file isn't a Writer's Nook backup."); }
  if (data.format !== FORMAT || !data.prefs || !Array.isArray(data.books)) throw new Error("That file isn't a Writer's Nook backup.");
  let restored = 0;
  for (const b of data.books) {
    // only genuine private books: a backup can't smuggle in a "published" book pointing somewhere else
    if (!b || typeof b.id !== "string" || !["pdf", "text", "epub"].includes(b.kind) || b.hosted) continue;
    delete b.url;
    if (b.dataIsBlob) { b.data = await dataToBlob(b.data); delete b.dataIsBlob; }
    await idbPut(b);
    restored++;
  }
  try {
    for (const [k, v] of Object.entries(data.prefs)) {
      if (!k.startsWith("wn-")) continue;
      if (k === "wn-meta") {
        const mine = JSON.parse(localStorage.getItem(k) || "{}");
        localStorage.setItem(k, JSON.stringify({ ...mine, ...JSON.parse(v) }));
      } else if (k === "wn-stats") {
        const mine = JSON.parse(localStorage.getItem(k) || '{"days":{},"finished":[]}'), theirs = JSON.parse(v);
        const days = { ...mine.days };
        for (const [d, m] of Object.entries(theirs.days || {})) days[d] = Math.max(days[d] || 0, m);
        const seen = new Set(mine.finished.map((f) => f.t + f.title));
        localStorage.setItem(k, JSON.stringify({ days, finished: [...mine.finished, ...(theirs.finished || []).filter((f) => !seen.has(f.t + f.title))] }));
      } else localStorage.setItem(k, v);
    }
  } catch { /* storage blocked: books were still restored */ }
  return { books: restored };
}

export function openBackup(afterRestore) {
  const fileIn = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const r = await importBackup(f);
      toast(`Restored ${r.books} ${r.books === 1 ? "book" : "books"} and your settings. Reloading…`);
      setTimeout(() => location.reload(), 900);     // start fresh so nothing stale is left in memory (and can't overwrite what was restored)
    } catch (e) { toast(e.message || "Couldn't restore that backup."); }
  });
  const s = sheet({
    title: "Back up and restore",
    body: h("div", {},
      h("p", { text: "Your own files, reading places, bookmarks, notes, shelves and settings live only in this browser. A backup saves them in one file, so you can keep a copy or move to another device." }),
      h("div", { class: "sheet-actions" },
        h("button", { class: "btn primary", onclick: async () => { try { const r = await exportBackup(); toast(`Backup saved (${r.books} of your own ${r.books === 1 ? "file" : "files"}).`); } catch { toast("Couldn't make the backup."); } } }, "Save a backup"),
        h("button", { class: "btn ghost", onclick: () => fileIn.click() }, "Restore from a backup")),
      h("p", { class: "panel-note", text: "Restoring adds to what's here. Books with the same identity are replaced by the backup's copy." }), fileIn),
  });
}
