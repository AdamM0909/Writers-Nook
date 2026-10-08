/* The library screen: Continue Reading, section tabs, series, shelves, genre and status filters, grid or list. */
import { $, h, pref, toast, cleanName, uid } from "./dom.js";
import { allBooks, idbPut, putCover, saveSoon, library } from "./store.js";
import { filterBooks, sortBooks, sectionList, genreList, seriesList, clusterSeries, statusOf } from "./organize.js";
import { pdfCover, fetchBytes } from "./pdf.js";
import { makeCover } from "./cover.js";
import { isSaved } from "./pwa.js";
import { openDetail } from "./detail.js";

const ui = { tab: "all", genre: "", series: "", shelf: "", status: pref.get("status", "all"), view: pref.get("view", "grid"), size: +pref.get("size", 180), sort: pref.get("sort", "shelf") };
const NEW_DAYS = 14;
const STATUS = [["all", "All"], ["reading", "Reading"], ["want", "Want to read"], ["finished", "Finished"]];

export function showLibrary() {
  $("view-library").hidden = false;
  $("view-reader").hidden = true;
  document.querySelector(".top").toggleAttribute("hidden", false);
  document.querySelector(".vine-rule").toggleAttribute("hidden", false);
}
export const readLink = (b) => "#read=" + encodeURIComponent(b.id);

/* ---------- drawing ---------- */
export async function renderLibrary() {
  showLibrary();
  const everything = await allBooks();
  const sections = sectionList(everything, library.sections);
  const genres = genreList(everything);
  const series = seriesList(everything);
  const shelves = [...new Set(everything.flatMap((b) => b.shelves || []))].sort((a, b) => a.localeCompare(b));
  // a tab that no longer exists falls back to All
  const tabs = ["all", ...sections, ...(series.length ? ["series"] : []), ...(shelves.length ? ["shelves"] : [])];
  if (!tabs.includes(ui.tab)) { ui.tab = "all"; ui.series = ui.shelf = ""; }
  if (ui.genre && !genres.some((g) => g.toLowerCase() === ui.genre.toLowerCase())) ui.genre = "";
  if (ui.shelf && !shelves.includes(ui.shelf)) ui.shelf = "";

  renderTabs(tabs, sections, shelves, series);
  renderFilters(genres);
  syncToolbar();

  const q = $("search").value.trim();
  const pool = filterBooks(everything, { tab: ui.tab, genre: ui.genre, status: ui.status, shelf: ui.shelf, series: ui.series, q });
  const sorted = sortBooks(pool, ui.sort);
  renderContinue(everything.filter((b) => b.opened && statusOf(b) === "reading").sort((a, b) => b.opened - a.opened)[0]);

  const shelf = $("shelf");
  shelf.replaceChildren();
  shelf.dataset.view = ui.view;
  shelf.style.setProperty("--cover", ui.size + "px");
  const groups = groupBooks(sorted, sections, shelves);
  let i = 0;
  for (const g of groups) {
    if (g.title) shelf.append(h("h2", { class: "group-title" }, g.title, h("small", { text: `${g.books.length} ${g.books.length === 1 ? "book" : "books"}` })));
    const grid = h("div", { class: "grid" });
    for (const b of g.books) grid.append(card(b, i++, everything));
    shelf.append(grid);
  }
  $("empty").hidden = everything.length > 0;
  $("none").hidden = everything.length === 0 || pool.length > 0;
  markOffline(everything);
}

function groupBooks(books, sections, shelves) {
  if (!books.length) return [];
  const clustered = (list) => (ui.sort === "shelf" || ui.sort === "title" ? clusterSeries(list) : list);
  if (ui.tab === "series" && !ui.series) {
    return seriesList(books).map((s) => ({ title: s.name, books: s.items }));
  }
  if (ui.tab === "shelves" && !ui.shelf) {
    return shelves.map((name) => ({ title: name, books: books.filter((b) => (b.shelves || []).includes(name)) })).filter((g) => g.books.length);
  }
  if (ui.tab === "all" && sections.length && !$("search").value.trim() && !ui.genre) {
    const out = sections.map((s) => ({ title: s, books: clustered(books.filter((b) => b.section === s)) })).filter((g) => g.books.length);
    const rest = books.filter((b) => !b.section);
    if (rest.length) out.push({ title: out.length ? "More books" : "", books: clustered(rest) });
    return out;
  }
  return [{ title: "", books: clustered(books) }];
}

function renderTabs(tabs, sections, shelves, series) {
  const bar = $("tabs");
  bar.hidden = tabs.length < 2;
  bar.replaceChildren(...tabs.map((t) => h("button", {
    class: "tab", role: "tab", "aria-selected": ui.tab === t, type: "button",
    text: t === "all" ? "All" : t === "series" ? "Series" : t === "shelves" ? "My shelves" : t,
    onclick: () => { ui.tab = t; ui.series = ui.shelf = ""; renderLibrary(); },
  })));
  const sub = $("subtabs");
  const chips = ui.tab === "shelves" ? shelves.map((s) => [s, s]) : [];
  sub.hidden = !chips.length;
  sub.replaceChildren(...(chips.length ? [chip("All shelves", !ui.shelf, () => { ui.shelf = ""; renderLibrary(); }), ...chips.map(([n]) => chip(n, ui.shelf === n, () => { ui.shelf = n; renderLibrary(); }))] : []));
}
function renderFilters(genres) {
  const st = $("status-chips");
  st.replaceChildren(...STATUS.map(([v, t]) => chip(t, ui.status === v, () => { ui.status = v; pref.set("status", v); renderLibrary(); })));
  const gc = $("genre-chips");
  gc.hidden = !genres.length;
  gc.replaceChildren(...(genres.length ? [chip("All genres", !ui.genre, () => { ui.genre = ""; renderLibrary(); }), ...genres.map((g) => chip(g, ui.genre.toLowerCase() === g.toLowerCase(), () => { ui.genre = g; renderLibrary(); }))] : []));
}
const chip = (text, on, fn) => h("button", { class: "chip", type: "button", "aria-pressed": on, onclick: fn }, text);

function syncToolbar() {
  $("sort").value = ui.sort;
  $("v-grid").setAttribute("aria-pressed", ui.view === "grid");
  $("v-list").setAttribute("aria-pressed", ui.view === "list");
  $("size").value = ui.size;
  $("size-wrap").hidden = ui.view !== "grid";
}

function card(b, i, everything) {
  const st = statusOf(b);
  const pct = Math.round((b.progress || 0) * 100);
  const isNew = b.hosted && b.added && !b.opened && Date.now() - b.added < NEW_DAYS * 864e5;
  const cover = h("div", { class: "cover" });
  if (b.cover) {
    const img = h("img", { src: b.cover, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => img.remove());       // offline or missing: the title cover underneath shows instead
    cover.append(img);
  }
  const ct = h("div", { class: "ct" }, b.title, b.author && h("small", { text: b.author }));
  cover.append(ct);
  watchCover(b, cover);
  if (isNew) cover.append(h("span", { class: "badge new", text: "New" }));
  else if (st === "finished") cover.append(h("span", { class: "badge done", text: "Finished" }));
  else if (st === "want") cover.append(h("span", { class: "badge want", text: "Want to read" }));
  const sub = [];
  if (b.author) sub.push(b.author);
  if (b.series && b.seriesNo != null) sub.push(`Book ${b.seriesNo}`);
  else if (b.genres?.length) sub.push(b.genres.slice(0, 2).join(", "));
  const status = st === "reading" && pct ? `${pct}% read` : st === "finished" ? "Finished" : st === "want" ? "Want to read" : b.kind === "pdf" ? (b.pages ? `${b.pages} ${b.pages === 1 ? "page" : "pages"}` : "PDF") : b.kind === "epub" ? "EPUB" : "Text";
  const prog = h("div", { class: "progress" }, h("i", { style: `width:${st === "finished" ? 100 : pct}%` }));
  const link = h("a", { class: "card-link", href: readLink(b), "aria-label": `${b.title}${b.author ? " by " + b.author : ""}. ${status}` }, cover,
    h("div", { class: "meta" }, h("b", { text: b.title }), h("span", { class: "sub", text: sub.join(" · ") }), h("span", { class: "stat", text: status })), prog);
  const info = h("button", { class: "info-btn", type: "button", "aria-label": "Details for " + b.title, title: "Details", onclick: () => openDetail(b, everything, renderLibrary) }, "ⓘ");
  const el = h("article", { class: "card", style: `--i:${Math.min(i, 12)}`, "data-id": b.id }, link, info);
  link.addEventListener("click", (e) => { if (el.classList.contains("unavailable")) { e.preventDefault(); toast("This book isn't saved for offline reading. Connect to open it."); } });
  return el;
}

/* books saved for offline get a small mark; when you're offline the others are dimmed */
export async function markOffline(books) {
  const offline = !navigator.onLine;
  books ||= await allBooks();
  for (const el of document.querySelectorAll("#shelf .card")) {
    const b = books.find((x) => x.id === el.dataset.id);
    if (!b?.hosted) continue;
    const saved = await isSaved(b.url);
    el.classList.toggle("saved", saved);
    el.classList.toggle("unavailable", offline && !saved);
    const stat = el.querySelector(".stat");
    if (stat && saved && !stat.dataset.off) { stat.dataset.off = "1"; stat.append(h("span", { class: "off-dot", title: "Saved for offline", "aria-label": "Saved for offline" }, " ⬇")); }
  }
}
addEventListener("wn:net", () => { if (!$("view-library").hidden) markOffline(); });

/* ---------- continue reading ---------- */
function renderContinue(b) {
  const el = $("continue");
  el.hidden = !b;
  if (!b) return;
  el.dataset.id = b.id;
  el.replaceChildren();
  if (b.cover) el.append(h("img", { alt: "", src: b.cover }));
  el.append(h("div", { class: "ct2" }, h("small", { text: "Continue reading" }), h("b", { text: b.title }), h("small", { text: Math.round((b.progress || 0) * 100) + "% read" })),
    h("span", { class: "go", text: "Resume →" }));
  el.onclick = () => (location.hash = readLink(b));
  el.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), el.click());
}

/* ---------- covers ---------- */
/* Covers are made only when a card scrolls near the screen. A drawn cover for a text book is cheap and is not kept;
   one rendered from a published PDF or EPUB is remembered (in IndexedDB). */
let coverChain = Promise.resolve();
const coverWatcher = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { coverWatcher.unobserve(e.target); makeCoverFor(e.target._book, e.target); }
  }, { rootMargin: "400px" })
  : null;
function watchCover(b, el) {
  if (b.cover || b.coverTried || (b.kind === "pdf" && !b.hosted)) return;
  el._book = b;
  coverWatcher ? coverWatcher.observe(el) : makeCoverFor(b, el);
}
function makeCoverFor(b, el) {
  if (b.cover || b.coverTried) return;
  b.coverTried = true;
  coverChain = coverChain.then(async () => {
    try {
      let keep = false;
      if (b.kind === "pdf" && b.hosted) { Object.assign(b, await pdfCover(b.size > 4e6 ? b.url : await fetchBytes(b.url))); keep = true; }   // big files: just the first page
      else if (b.kind === "epub" && b.hosted) {
        const { epubInfo } = await import("./epub.js");
        const info = await epubInfo(await fetchBytes(b.url));
        b.cover = info.cover || (await makeCover(b.title, b.author));
        keep = !!info.cover;
      } else if (b.kind !== "pdf") b.cover = await makeCover(b.title, b.author);
      else return;
      if (!b.hosted) idbPut(b).catch(() => {});
      else if (keep) { putCover(b.id, b.cover).catch(() => {}); saveSoon(b); }
      el.prepend(h("img", { alt: "", src: b.cover, style: "animation: fadeUp .5s ease-out" }));
      const cont = $("continue");
      if (!cont.hidden && cont.dataset.id === b.id && !cont.querySelector("img")) renderContinue(b);
    } catch (err) { console.warn("cover failed", b.title, err); }
  });
}

/* ---------- toolbar wiring ---------- */
$("search").addEventListener("input", renderLibrary);
$("sort").addEventListener("change", () => { ui.sort = $("sort").value; pref.set("sort", ui.sort); renderLibrary(); });
$("v-grid").onclick = () => { ui.view = "grid"; pref.set("view", "grid"); renderLibrary(); };
$("v-list").onclick = () => { ui.view = "list"; pref.set("view", "list"); renderLibrary(); };
$("size").addEventListener("input", () => { ui.size = +$("size").value; pref.set("size", ui.size); $("shelf").style.setProperty("--cover", ui.size + "px"); });

/* ---------- adding your own files (private to this browser) ---------- */
export async function addFiles(files) {
  let added = 0;
  for (const f of files) {
    const name = f.name;
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(name);
    const isEpub = /\.epub$/i.test(name) || f.type === "application/epub+zip";
    const isText = /\.(txt|md)$/i.test(name) || f.type.startsWith("text/");
    if (!isPdf && !isEpub && !isText) { toast(`“${name}” isn't a PDF, EPUB or text file.`); continue; }
    try {
      const book = { id: uid(), title: cleanName(name) || "Untitled", author: "", added: Date.now(), progress: 0 };
      if (isPdf) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        Object.assign(book, { kind: "pdf", data: new Blob([bytes], { type: "application/pdf" }) }, await pdfCover(bytes));
      } else if (isEpub) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const { epubInfo } = await import("./epub.js");
        const info = await epubInfo(bytes);
        Object.assign(book, { kind: "epub", data: new Blob([bytes], { type: "application/epub+zip" }), title: info.title || book.title, author: info.author || "" });
        book.cover = info.cover || (await makeCover(book.title, book.author));
      } else {
        Object.assign(book, { kind: "text", md: /\.md$/i.test(name), text: await f.text() });
        book.cover = await makeCover(book.title, book.author);
      }
      await idbPut(book);
      added++;
    } catch (err) {
      console.error(err);
      toast(`Couldn't read “${name}”.`);
    }
  }
  if (added) toast(added === 1 ? "Added to your library." : `Added ${added} items.`);
  if (location.hash) location.hash = ""; else renderLibrary();
}
$("file-input").addEventListener("change", async (e) => { await addFiles([...e.target.files]); e.target.value = ""; });
let dragDepth = 0;
addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; $("drop").hidden = false; } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("drop").hidden = true;
  if (e.dataTransfer?.files.length) addFiles([...e.dataTransfer.files]);
});

/* jump to a genre from the detail sheet */
export function filterGenre(g) { ui.genre = g; ui.tab = "all"; renderLibrary(); window.scrollTo({ top: 0 }); }
