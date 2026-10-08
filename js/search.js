/* Search inside the open book. Text books: every match in every paragraph. PDFs: the text layer of every page
   (scanned PDFs with no text layer have nothing to search). */
import { R, pageToPos, goTo, blockPos } from "./reader.js";
import { pageText } from "./pdf.js";
import { wrapRange, clearMarks } from "./text.js";

let run = 0;
const MAX = 300;

function snippet(text, i, len) {
  const a = Math.max(0, i - 40), z = Math.min(text.length, i + len + 60);
  const clean = (s) => s.replace(/\s+/g, " ");
  return { before: (a > 0 ? "…" : "") + clean(text.slice(a, i)), hit: clean(text.slice(i, i + len)), after: clean(text.slice(i + len, z)) + (z < text.length ? "…" : "") };
}
function findAll(text, q, push) {
  const hay = text.toLowerCase();
  for (let i = hay.indexOf(q); i !== -1; i = hay.indexOf(q, i + q.length)) { if (!push(i)) return false; }
  return true;
}

/* onResult(result) for each hit; onProgress(0..1); resolves when done or superseded. result: { pos, label, ...snippet, block?, start?, page? } */
export async function searchBook(query, onResult, onProgress) {
  const id = ++run;
  const q = query.trim().toLowerCase();
  if (q.length < 2 || !R.current) return { count: 0, capped: false };
  let count = 0, capped = false;
  const push = (r) => { if (count >= MAX) { capped = true; return false; } count++; onResult(r); return true; };
  if (R.current.kind === "pdf") {
    const doc = R.pdfDoc, total = doc.numPages;
    for (let n = 1; n <= total; n++) {
      if (id !== run || R.pdfDoc !== doc) return { count, capped, cancelled: true };
      const text = await pageText(doc, n);
      if (!findAll(text, q, (i) => push({ page: n, pos: pageToPos(n), label: "Page " + n, ...snippet(text, i, q.length) }))) break;
      if (n % 10 === 0) { onProgress?.(n / total); await new Promise((r) => setTimeout(r)); }
    }
  } else {
    for (let b = 0; b < R.blocks.length; b++) {
      const text = R.blocks[b].textContent;
      if (!findAll(text, q, (i) => push({ block: b, start: i, len: q.length, pos: blockPos(b, i / Math.max(1, text.length)), label: "Spread " + (blockPos(b, i / Math.max(1, text.length)) + 1), ...snippet(text, i, q.length) }))) break;
    }
  }
  return { count, capped };
}
export const cancelSearch = () => run++;

/* Go to a result and, in text books, mark the words. The mark goes when you turn the page or search again. */
export async function showResult(r) {
  clearFind();
  await goTo(r.pos);
  if (r.block != null && R.blocks[r.block]) wrapRange(R.blocks[r.block], r.start, r.start + r.len, "find");
}
export function clearFind() { if (R.root) clearMarks(R.root, "find"); }
R.hooks.pos.push((old) => { if (R.pos !== old) clearFind(); });
R.hooks.close.push(() => { cancelSearch(); });
