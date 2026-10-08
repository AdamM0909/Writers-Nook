/* PDF helpers on top of PDF.js (vendored). */
import * as pdfjs from "../vendor/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

/* Download a whole file. The offline cache stores whole files, so PDFs are never streamed in pieces. */
export async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
export async function bookBytes(b) {
  return b.hosted ? fetchBytes(b.url) : new Uint8Array(await b.data.arrayBuffer());
}
export function openPdf(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(0) });
  return task.promise.then((doc) => ({ task, doc }));
}

/* source: the file's bytes, or a url (PDF.js then reads just the first page, for big files). */
export async function pdfCover(source) {
  const task = typeof source === "string" ? pdfjs.getDocument({ url: source }) : pdfjs.getDocument({ data: source.slice(0) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 360 / vp0.width });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#fff" }).promise;
    return { cover: c.toDataURL("image/jpeg", 0.8), pages: doc.numPages };
  } finally { task.destroy(); }
}

/* The PDF's own outline, flattened: [{ label, depth, page }] */
export async function pdfOutline(doc) {
  const out = [];
  const walk = async (items, depth) => {
    for (const it of items) {
      if (out.length >= 500) return;
      try {
        let dest = it.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest)) {
          const ref = dest[0];
          const page = (typeof ref === "object" ? await doc.getPageIndex(ref) : ref) + 1;
          if (page >= 1 && page <= doc.numPages && it.title?.trim()) out.push({ label: it.title.trim(), depth: Math.min(depth, 2), page });
        }
      } catch { /* skip an entry that points nowhere */ }
      if (it.items?.length) await walk(it.items, depth + 1);
    }
  };
  const outline = await doc.getOutline();
  if (outline) await walk(outline, 0);
  return out;
}

/* ---------- page text (search, read aloud, chapter finding, reading time) ---------- */
const texts = new WeakMap();
export async function pageLines(doc, n) {
  if (!texts.has(doc)) texts.set(doc, new Map());
  const cache = texts.get(doc);
  if (cache.has(n)) return cache.get(n);
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  // group text pieces into lines by their baseline
  const rows = [];
  for (const it of content.items) {
    if (!it.str && !it.hasEOL) continue;
    const y = Math.round(it.transform[5]);
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push((row = { y, x: it.transform[4], parts: [] }));
    row.parts.push([it.transform[4], it.str]);
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((r) => r.parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join("").replace(/\s+/g, " ").trim()).filter(Boolean);
  cache.set(n, lines);
  return lines;
}
export const pageText = async (doc, n) => (await pageLines(doc, n)).join("\n");

/* "Chapter One", "Part II", "Prologue"… at the start of a line. Shared with plain-text books. */
export const HEADING = /^(?:(?:chapter|part|book|act|section)\s+(?:\d{1,3}|[ivxlcdm]{1,7}|(?:twenty|thirty|forty|fifty)?[- ]?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))\b(?:[\s.:\u2013\u2014-]+(?!of\b).{0,50})?|(?:prologue|epilogue|interlude|foreword|preface|introduction|afterword|acknowledg(?:e)?ments|dedication)[.:]?)$/i;
const BARE = /^(?:chapter|part|book|act|section)\s+\S+$/i;

/* PDFs without an outline: look for chapter headings in the first lines of each page. [{ label, depth:0, page }] */
export async function findChapters(doc, onProgress) {
  const found = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const lines = (await pageLines(doc, n)).slice(0, 4);
    for (let line of lines) {
      line = line.replace(/^\d{1,4}\s*[/|.–-]\s*/, "").replace(/\s*[/|]\s*\d{1,4}$/, "").trim(); // "2/ Chapter One" or a page number beside it
      if (line.length <= 70 && HEADING.test(line)) { found.push({ label: line, depth: 0, page: n }); break; }
    }
    if (n % 20 === 0) onProgress?.(n / doc.numPages);
  }
  // A heading repeated on many pages is a running header, not a chapter.
  const count = new Map();
  for (const f of found) count.set(f.label.toLowerCase(), (count.get(f.label.toLowerCase()) || 0) + 1);
  const kept = found.filter((f) => count.get(f.label.toLowerCase()) <= 2);
  // Many novels have a title page ("Chapter One") and then a first text page ("Chapter I: Ten Years Gone"): one entry, not two.
  const out = [];
  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i], next = kept[i + 1];
    if (next && next.page - cur.page <= 1 && BARE.test(cur.label) && /[:\u2013\u2014-]\s*\S/.test(next.label)) { out.push({ ...next, page: cur.page }); i++; }
    else out.push(cur);
  }
  return out;
}

/* Average words per page, from a few pages (for "time left"). 0 if the PDF has no text layer. */
export async function wordsPerPage(doc) {
  const picks = [...new Set([2, Math.ceil(doc.numPages / 2), doc.numPages - 1].map((n) => Math.max(1, Math.min(doc.numPages, n))))];
  let words = 0, n = 0;
  for (const p of picks) { const t = await pageText(doc, p); words += t.split(/\s+/).filter(Boolean).length; n++; }
  return n ? Math.round(words / n) : 0;
}
