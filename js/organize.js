/* How books are organised. Pure functions, shared by the deploy script (node) and the app (browser).

   Where a book's details come from, strongest first:
     1. books/meta.json         { "Poems/Night Verses.pdf": { "genres": ["Poetry"], "description": "…" } }
     2. its file name           Title - Author {Section} [Genre, Genre] (Series Name, Book 2).pdf
     3. its folder              books/Poems/…  -> section "Poems";  books/Stories/Dark Saga/…  -> section + series
     4. numbers in titles       "Self-Appreciation 1", "Self-Appreciation 2"  -> series "Self-Appreciation"
*/

const EXT = /\.(pdf|txt|md|epub)$/i;
const COVER_EXT = /\.(jpe?g|png|webp|gif)$/i;
export const isBookFile = (f) => EXT.test(f);
export const isCoverFile = (f) => COVER_EXT.test(f);

const stripExt = (f) => f.replace(/\.[^./]+$/, "");
const clean = (s) => s.replace(/\s+/g, " ").trim();
const SERIES_TAG = /\(\s*([^()#]+?)\s*(?:#|,?\s*book\s*|,?\s*no\.?\s*|,?\s*vol(?:ume|\.)?\s*)(\d+(?:\.\d+)?)\s*\)/i;
const GENRE_TAG = /\[([^\[\]]+)\]/g;
const SECTION_TAG = /\{([^{}]+)\}/;

/* "Poems/Night Verses - Me {Poems} [Poetry, Dark] (Verse, Book 2).pdf" -> its parts */
export function fileToMeta(relPath) {
  const parts = relPath.split("/");
  const file = parts.pop();
  let stem = stripExt(file);
  const out = {};
  if (parts[0]) out.section = clean(parts[0]);
  if (parts[1]) out.series = clean(parts[1]);
  const sec = SECTION_TAG.exec(stem);
  if (sec) { out.section = clean(sec[1]); stem = stem.replace(SECTION_TAG, " "); }     // {Poems} in the name beats the folder
  const s = SERIES_TAG.exec(stem);
  if (s) { out.series = clean(s[1]); out.seriesNo = parseFloat(s[2]); stem = stem.replace(SERIES_TAG, " "); }
  const genres = [];
  stem = stem.replace(GENRE_TAG, (_, g) => { genres.push(...g.split(/[;,]/).map(clean).filter(Boolean)); return " "; });
  if (genres.length) out.genres = genres;
  const [title, author] = clean(stem).replace(/[_]+/g, " ").split(/\s+-\s+/, 2).map(clean);
  out.title = title || clean(stem);
  if (author) out.author = author;
  return out;
}

/* A name for matching a cover image to its book: folder + file name, minus extension and tags. */
export function coverKey(relPath) {
  const parts = relPath.split("/");
  const file = parts.pop();
  const stem = stripExt(file).replace(SERIES_TAG, " ").replace(SECTION_TAG, " ").replace(GENRE_TAG, " ");
  return [...parts, clean(stem)].join("/").toLowerCase();
}

/* "Self-Appreciation 1", "Self-Appreciation 2" -> series "Self-Appreciation" (needs two or more). Mutates entries. */
export function detectSeries(entries) {
  const NUM = /^(.*\S)\s+(?:#|no\.?\s*|book\s+|part\s+|vol(?:ume|\.)?\s*)?(\d{1,3})$/i;
  const groups = new Map();
  const known = new Set(entries.filter((e) => e.series).map((e) => e.series.toLowerCase()));
  for (const e of entries) {
    if (e.series) continue;
    const m = NUM.exec(e.title || "");
    if (!m) continue;
    if (known.has(m[1].toLowerCase())) { e.series = entries.find((x) => x.series && x.series.toLowerCase() === m[1].toLowerCase()).series; e.seriesNo = +m[2]; continue; }
    const key = m[1].toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ e, base: m[1], n: +m[2] });
  }
  for (const g of groups.values()) {
    if (g.length < 2 || new Set(g.map((x) => x.n)).size < 2) continue;
    for (const { e, base, n } of g) { e.series = base; e.seriesNo = n; }
  }
  return entries;
}

export const POETRY = /poem|poetry|verse|lyric|haiku|sonnet/i;
export const isPoetry = (b) => POETRY.test([b.section, ...(b.genres || [])].join(" "));

/* ---------- reading status ---------- */
export function statusOf(b) {
  if (b.status) return b.status;                         // chosen by the reader: "want" or "finished"
  if (b.opened && (b.progress || 0) >= 0.98) return "finished";
  return b.opened ? "reading" : "unread";
}

/* ---------- searching, filtering, sorting ---------- */
export function matches(b, q) {
  if (!q) return true;
  const hay = [b.title, b.author, b.section, b.series, b.description, ...(b.genres || [])].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

/* state: { tab: "all" | "series" | "shelves" | "<section>", series, genre, status, shelf, q } */
export function filterBooks(books, st) {
  return books.filter((b) => {
    if (!matches(b, st.q)) return false;
    if (st.tab && !["all", "series", "shelves"].includes(st.tab) && (b.section || "") !== st.tab) return false;
    if (st.tab === "series" && !b.series) return false;
    if (st.series && b.series !== st.series) return false;
    if (st.genre && !(b.genres || []).some((g) => g.toLowerCase() === st.genre.toLowerCase())) return false;
    if (st.status && st.status !== "all" && statusOf(b) !== st.status) return false;
    if (st.tab === "shelves" && st.shelf && !(b.shelves || []).includes(st.shelf)) return false;
    if (st.tab === "shelves" && !st.shelf && !(b.shelves || []).length) return false;
    return true;
  });
}

const byNo = (a, b) => (a.seriesNo ?? 1e9) - (b.seriesNo ?? 1e9) || a.title.localeCompare(b.title);
export function sortBooks(books, sort) {
  const out = [...books];
  if (sort === "title") out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "author") out.sort((a, b) => (a.author || "~").localeCompare(b.author || "~") || a.title.localeCompare(b.title));
  else if (sort === "recent") out.sort((a, b) => (b.opened || 0) - (a.opened || 0));
  else if (sort === "newest") out.sort((a, b) => (b.added || 0) - (a.added || 0));
  return out;
}

/* Sections in the order they should appear: meta.json's "_sections" first, then the rest A to Z. */
export function sectionList(books, order = []) {
  const seen = new Set(books.map((b) => b.section).filter(Boolean));
  const first = order.filter((s) => seen.has(s));
  return [...first, ...[...seen].filter((s) => !first.includes(s)).sort((a, b) => a.localeCompare(b))];
}
export function genreList(books) {
  const m = new Map();
  for (const b of books) for (const g of b.genres || []) { const k = g.toLowerCase(); m.set(k, { name: m.get(k)?.name || g, n: (m.get(k)?.n || 0) + 1 }); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => x.name);
}
export function seriesList(books) {
  const m = new Map();
  for (const b of books) if (b.series) { if (!m.has(b.series)) m.set(b.series, []); m.get(b.series).push(b); }
  return [...m.entries()].map(([name, items]) => ({ name, items: items.sort(byNo) })).sort((a, b) => a.name.localeCompare(b.name));
}
/* Within a list that is already sorted, pull each series together at the position of its first book, in order. */
export function clusterSeries(books) {
  const out = [], done = new Set();
  for (const b of books) {
    if (!b.series) { out.push(b); continue; }
    if (done.has(b.series)) continue;
    done.add(b.series);
    out.push(...books.filter((x) => x.series === b.series).sort(byNo));
  }
  return out;
}
export function nextInSeries(book, books) {
  if (!book.series) return null;
  const items = books.filter((b) => b.series === book.series).sort(byNo);
  const i = items.findIndex((b) => b.id === book.id);
  return { items, index: i, prev: items[i - 1] || null, next: items[i + 1] || null };
}
