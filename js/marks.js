/* Bookmarks, highlights and notes for the book you are reading.
   PDF:   a bookmark remembers the page.  Text: it remembers the paragraph and how far through it, so it survives
   changes of text size.  Highlights sit on exact words inside a paragraph. Everything is saved per book, in this browser. */
import { $, h, uid, toast, sheet } from "./dom.js";
import { saveSoon } from "./store.js";
import { R, blockPos, anchorHere, posOfAnchor } from "./reader.js";
import { wrapRange, clearMarks } from "./text.js";

/* ---------- where is a saved thing now? ---------- */
export function markPos(m) {
  if (m.start != null && m.block != null && R.blockSpread[m.block] != null) {       // a highlight: by where its words sit in the paragraph
    return blockPos(m.block, m.start / Math.max(1, R.blocks[m.block]?.textContent.length || 1));
  }
  return posOfAnchor(m);
}
const sortedMarks = () => [...(R.current?.bookmarks || []), ...(R.current?.highlights || [])].sort((a, b) => markPos(a) - markPos(b) || a.at - b.at);
export const savedItems = () => {
  const seen = new Set();
  return sortedMarks().filter((m) => !m.g || (!seen.has(m.g) && seen.add(m.g)));
};

/* ---------- bookmarks ---------- */
export function makeBookmark() {
  const b = R.current;
  const a = anchorHere();
  if (b.kind === "pdf") return { id: uid(), page: a.page, label: "Page " + a.page, at: Date.now() };
  const text = a.block != null ? R.blocks[a.block].textContent.trim() : "";
  return {
    id: uid(), ...a, at: Date.now(),
    label: text.length > 2 ? (text.length > 70 ? text.slice(0, 70).trimEnd() + "…" : text) : `About ${Math.round(a.frac * 100)}% through`,
  };
}
const here = () => (R.current?.bookmarks || []).filter((m) => markPos(m) === R.pos);
export function updateMark() {
  const on = !!R.current && here().length > 0;
  $("r-mark").setAttribute("aria-pressed", on);
  $("r-mark").setAttribute("aria-label", on ? "Remove bookmark from this page" : "Bookmark this page");
  $("ribbon").hidden = !on;
}
export function toggleMark() {
  const b = R.current;
  if (!b || !$("r-loading").hidden) return;
  const h0 = here();
  if (h0.length) { b.bookmarks = b.bookmarks.filter((m) => !h0.includes(m)); toast("Bookmark removed."); }
  else { b.bookmarks = [...(b.bookmarks || []), makeBookmark()]; toast("Bookmark added."); }
  saveSoon(b);
  changed();
}
export function removeSaved(m) {
  const b = R.current;
  if (m.g || m.start != null) removeHighlight(m);
  else { b.bookmarks = b.bookmarks.filter((k) => k !== m); saveSoon(b); }
  changed();
}

/* ---------- highlights ---------- */
function paint(hl) {
  const el = R.root?.children[hl.block];            // R.blocks only exists after layout; the tree is there from the start
  if (!el) return;
  wrapRange(el, hl.start, hl.end, "hl" + (hl.note ? " has-note" : ""), { id: hl.id });
}
function unpaint(id) {
  for (const mk of document.querySelectorAll(`mark.hl[data-id="${CSS.escape(id)}"]`)) {
    const parent = mk.parentNode;
    mk.replaceWith(...mk.childNodes);
    parent.normalize();
  }
}
export function addHighlights(pieces, note = "") {
  const b = R.current;
  if (!b || !pieces.length) return;
  const g = pieces.length > 1 ? uid() : undefined;
  const now = Date.now();
  b.highlights ||= [];
  pieces.forEach((p, i) => {
    const hl = { id: uid(), g, block: p.block, start: p.start, end: p.end, text: p.text, at: now + i, ...(i === 0 && note && { note }) };
    b.highlights.push(hl);
    paint(hl);
  });
  getSelection().removeAllRanges();
  saveSoon(b);
  changed();
}
function removeHighlight(m) {
  const b = R.current;
  const gone = b.highlights.filter((x) => x === m || (m.g && x.g === m.g));
  for (const x of gone) unpaint(x.id);
  b.highlights = b.highlights.filter((x) => !gone.includes(x));
  saveSoon(b);
}
export function setNote(m, note) {
  const b = R.current;
  note = note.trim();
  if (note) m.note = note; else delete m.note;
  if (m.start != null) for (const mk of document.querySelectorAll(`mark.hl[data-id="${CSS.escape(m.id)}"]`)) mk.classList.toggle("has-note", !!note);
  saveSoon(b);
  changed();
}
/* the whole text of a saved highlight (a selection over several paragraphs is several pieces) */
export const highlightText = (m) => (m.g ? R.current.highlights.filter((x) => x.g === m.g).map((x) => x.text).join(" ") : m.text);

/* A small sheet to read, edit or delete a note on a bookmark or highlight. */
export function editNote(m, { onQuote } = {}) {
  const isHl = m.start != null;
  const ta = h("textarea", { class: "note-input", rows: "4", placeholder: "Write a note…", "aria-label": "Note" });
  ta.value = m.note || "";
  const body = h("div", { class: "note-sheet" },
    isHl && h("blockquote", { class: "note-quote", text: highlightText(m) }),
    !isHl && h("p", { class: "note-where", text: m.label }),
    ta,
    h("div", { class: "sheet-actions" },
      h("button", { class: "btn primary", onclick: () => { setNote(m, ta.value); s.close(); } }, "Save"),
      isHl && onQuote && h("button", { class: "btn ghost", onclick: () => { s.close(); onQuote(m); } }, "Quote card"),
      h("button", { class: "btn danger", onclick: () => { removeSaved(m); s.close(); } }, isHl ? "Remove highlight" : "Remove bookmark")));
  const s = sheet({ title: isHl ? "Highlight" : "Bookmark", body });
  ta.focus();
}

/* Tapping a highlight in the text opens it. */
$("text-flow").addEventListener("click", (e) => {
  const mk = e.target.closest?.("mark.hl");
  if (!mk || !getSelection().isCollapsed) return;
  const m = R.current?.highlights?.find((x) => x.id === mk.dataset.id);
  if (m) hooks.openNote?.(m);
});

/* ---------- plumbing ---------- */
export const hooks = { changed: [], openNote: null };
function changed() { updateMark(); hooks.changed.forEach((f) => f()); }
R.hooks.open.push((b) => {
  if (b.kind === "pdf" || !b.highlights?.length) return;
  clearMarks(R.root, "hl");
  for (const hl of b.highlights) paint(hl);
});
R.hooks.pos.push(updateMark);
R.hooks.layout.push(updateMark);
$("r-mark").onclick = toggleMark;
