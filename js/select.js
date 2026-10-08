/* The little bar that appears when you select words in a text book: highlight, note, define, quote, copy. */
import { $, h, toast } from "./dom.js";
import { R } from "./reader.js";
import { selectionPieces } from "./text.js";
import { addHighlights, editNote } from "./marks.js";
import { openQuote } from "./quote.js";
import { defineWord } from "./define.js";

const bar = $("sel-bar");
let pieces = [], timer;

function selectionInText() {
  if (!R.current || R.current.kind === "pdf" || $("view-reader").hidden) return null;
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!$("text-flow").contains(range.commonAncestorContainer)) return null;
  return range;
}
function update() {
  const range = selectionInText();
  if (!range) { bar.hidden = true; pieces = []; return; }
  pieces = selectionPieces(getSelection(), R.blocks);
  if (!pieces.length) { bar.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  const book = $("view-reader").getBoundingClientRect();
  bar.hidden = false;
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  const coarse = matchMedia("(pointer: coarse)").matches;   // phones show their own menu above the selection
  let top = coarse ? rect.bottom + 12 : rect.top - bh - 10;
  if (top < book.top + 8) top = rect.bottom + 12;
  if (top + bh > book.bottom - 8) top = Math.max(book.top + 8, rect.top - bh - 10);
  const left = Math.min(Math.max(book.left + 8, rect.left + rect.width / 2 - bw / 2), book.right - bw - 8);
  bar.style.top = top - book.top + "px";
  bar.style.left = left - book.left + "px";
}
document.addEventListener("selectionchange", () => { clearTimeout(timer); timer = setTimeout(update, 120); });
R.hooks.pos.push(() => { bar.hidden = true; });
R.hooks.close.push(() => { bar.hidden = true; });

const act = (label, fn, key) => h("button", { class: "sel-btn", type: "button", "aria-label": label, onpointerdown: (e) => e.preventDefault(), onclick: () => { const p = pieces; fn(p); } }, label);
bar.replaceChildren(
  act("Highlight", (p) => { addHighlights(p); bar.hidden = true; }),
  act("Note", (p) => {
    addHighlights(p);
    const hl = R.current.highlights.at(-p.length);
    bar.hidden = true;
    if (hl) editNote(hl, { onQuote: (m) => openQuote(m.text) });
  }),
  act("Define", (p) => { const t = p.map((x) => x.text).join(" "); bar.hidden = true; getSelection().removeAllRanges(); defineWord(t); }),
  act("Quote", (p) => { const t = p.map((x) => x.text).join(" "); bar.hidden = true; getSelection().removeAllRanges(); openQuote(t); }),
  act("Copy", async (p) => {
    try { await navigator.clipboard.writeText(p.map((x) => x.text).join("\n")); toast("Copied."); } catch { toast("Couldn't copy."); }
    bar.hidden = true;
  }),
);
