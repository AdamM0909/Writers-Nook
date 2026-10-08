/* The side panel (a bottom sheet on phones): Contents, Saved (bookmarks, highlights, notes) and Search. */
import { $, h, debounce } from "./dom.js";
import { R, goTo, pageToPos } from "./reader.js";
import { savedItems, markPos, removeSaved, editNote, hooks as markHooks, highlightText } from "./marks.js";
import { searchBook, showResult, cancelSearch, clearFind } from "./search.js";
import { openQuote } from "./quote.js";

const TABS = ["toc", "saved", "search"];
let tab = "toc", returnFocus = null, query = "", searchToken = 0;

const tocTarget = (it) => (it.page ? pageToPos(it.page) : it.spread);
export const panelOpen = () => !$("panel").hidden;

function note(msg) { $("panel-list").replaceChildren(h("p", { class: "panel-note", text: msg })); }

function renderToc() {
  const list = $("panel-list");
  if (R.toc === null) return note("Looking for contents…");
  if (!R.toc.length) return note(R.current.kind === "pdf"
    ? "This PDF has no contents, and no chapter headings could be found in it. You can still bookmark any page."
    : "This book has no chapter headings. Start a line with # to make one, and it will appear here.");
  const here = R.toc.reduce((a, it, i) => (tocTarget(it) <= R.pos ? i : a), -1);
  list.replaceChildren(...R.toc.map((it, i) => h("button", {
    class: "row d" + it.depth, text: it.label, "aria-current": i === here ? "true" : null,
    onclick: () => go(tocTarget(it)),
  })));
}

function renderSaved() {
  const items = savedItems();
  $("saved-count").textContent = items.length ? `(${items.length})` : "";
  if (!items.length) return note("Nothing saved yet. Press the ribbon button (or B) to bookmark this page. In a text book, select words to highlight them or add a note.");
  const rows = items.map((m) => {
    const isHl = m.start != null;
    const pos = markPos(m);
    const where = m.page ? `Page ${m.page}` : `Spread ${pos + 1}`;
    const main = h("button", { class: "row saved-row", onclick: () => go(pos) },
      h("span", { class: isHl ? "hl-text" : "", text: isHl ? highlightText(m) : m.label }),
      h("small", { text: (isHl ? "Highlight · " : "Bookmark · ") + where }),
      m.note && h("em", { class: "saved-note", text: m.note }));
    return h("div", { class: "row-wrap" }, main,
      h("button", { class: "x", "aria-label": "Note on: " + (m.label || m.text), title: "Note", onclick: () => editNote(m, { onQuote: (x) => openQuote(highlightText(x)) }) }, "✎"),
      h("button", { class: "x", "aria-label": "Remove: " + (m.label || m.text), title: "Remove", onclick: () => removeSaved(m) }, "×"));
  });
  $("panel-list").replaceChildren(...rows);
}

function renderSearch() {
  const input = h("input", { type: "search", id: "panel-q", class: "panel-search", placeholder: R.current.kind === "pdf" ? "Search this PDF…" : "Search this book…", "aria-label": "Search in this book", value: query, autocomplete: "off" });
  const status = h("p", { class: "panel-note", "aria-live": "polite" });
  const results = h("div", { class: "results" });
  $("panel-list").replaceChildren(h("div", { class: "search-box" }, input), status, results);
  const doSearch = async () => {
    const my = ++searchToken;
    query = input.value;
    results.replaceChildren(); status.textContent = "";
    if (query.trim().length < 2) { status.textContent = query ? "Type at least two letters." : ""; cancelSearch(); clearFind(); return; }
    status.textContent = "Searching…";
    const r = await searchBook(query, (hit) => {
      if (my !== searchToken) return;
      results.append(h("button", { class: "row result", onclick: () => { showResult(hit); if (R.single) closePanel(false); } },
        h("small", { text: hit.label }), h("span", {}, hit.before, h("b", { text: hit.hit }), hit.after)));
    }, (p) => { if (my === searchToken) status.textContent = `Searching… ${Math.round(p * 100)}%`; });
    if (my !== searchToken || r.cancelled) return;
    status.textContent = r.count ? `${r.count}${r.capped ? "+" : ""} ${r.count === 1 ? "match" : "matches"}` : R.current.kind === "pdf" ? "No matches. (Scanned PDFs have no text to search.)" : "No matches.";
  };
  input.addEventListener("input", debounce(doSearch, 250));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
  if (query) doSearch();
  return input;
}

export function render() {
  if (!panelOpen() || !R.current) return;
  for (const t of TABS) {
    const el = $("tab-" + t);
    el.setAttribute("aria-selected", tab === t);
    el.tabIndex = tab === t ? 0 : -1;
  }
  $("panel-list").setAttribute("aria-labelledby", "tab-" + tab);
  if (tab === "search" && $("panel-list").contains($("panel-q"))) { $("saved-count").textContent = savedItems().length ? `(${savedItems().length})` : ""; return; }   // keep the box you're typing in
  if (tab === "toc") renderToc();
  else if (tab === "saved") renderSaved();
  else renderSearch();
  $("saved-count").textContent = savedItems().length ? `(${savedItems().length})` : "";
  $("panel-list").querySelector("[aria-current]")?.scrollIntoView({ block: "center" });
}
function go(p) { closePanel(false); goTo(p); }

export function openPanel(which) {
  if (!R.current) return;
  tab = which || (R.toc?.length === 0 && savedItems().length ? "saved" : "toc");
  returnFocus = document.activeElement;
  $("panel").hidden = $("panel-back").hidden = false;
  render();
  if (tab === "search") $("panel-q")?.focus(); else $("tab-" + tab).focus();
}
export function closePanel(restore = true) {
  if ($("panel").contains(document.activeElement)) document.activeElement.blur();   // a hidden search box must not keep eating keys
  $("panel").hidden = $("panel-back").hidden = true;
  cancelSearch(); searchToken++;
  if (restore) returnFocus?.focus?.();
  returnFocus = null;
}

for (const t of TABS) $("tab-" + t).onclick = () => { tab = t; render(); if (t === "search") $("panel-q")?.focus(); };
$("r-toc").onclick = () => openPanel("toc");
$("r-search").onclick = () => openPanel("search");
$("panel-close").onclick = () => closePanel();
$("panel-back").onclick = () => closePanel();
$("panel").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.stopPropagation(); closePanel(); }
  else if (e.key === "Tab") {
    const f = [...$("panel").querySelectorAll("button, input")].filter((x) => x.tabIndex !== -1 && !x.disabled);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target.getAttribute("role") === "tab") {
    const i = TABS.indexOf(tab), n = (i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    tab = TABS[n]; render(); $("tab-" + tab).focus();
  }
});
R.hooks.layout.push(render);
R.hooks.pos.push(() => { if (panelOpen() && tab === "toc") render(); });
R.hooks.close.push(() => closePanel(false));
markHooks.changed.push(render);
markHooks.openNote = (m) => editNote(m, { onQuote: (x) => openQuote(highlightText(x)) });
