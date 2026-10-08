/* Text books (.md, .txt, .epub) become one tree of paragraphs, headings, quotes and lists, built as DOM nodes
   (never HTML strings). Bookmarks, chapters, highlights, search and read-aloud all work on those blocks. */
import { HEADING } from "./pdf.js";

export function inline(parent, text) {
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    parent.append(text.slice(last, m.index));
    const el = document.createElement(m[1] ? "strong" : "em");
    inline(el, m[1] ? m[2] : m[4]);
    parent.append(el);
    last = re.lastIndex;
  }
  parent.append(text.slice(last));
}

const newRoot = (keepBreaks) => {
  const root = document.createElement("div");
  root.className = "md" + (keepBreaks ? " verse" : "");
  return root;
};

/* Markdown: # headings (to ###), **bold**, *italic*, > quotes, - lists, --- scene breaks.
   keepBreaks (poetry): every line break in a paragraph is kept. */
export function renderMarkdown(src, { keepBreaks = false } = {}) {
  const root = newRoot(keepBreaks);
  let para = [], list = null, quote = null;
  const join = keepBreaks ? "\n" : " ";
  const flush = () => {
    if (para.length) { const p = document.createElement("p"); inline(p, para.join(join)); root.append(p); para = []; }
    list = quote = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) flush();
    else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flush();
      const hd = document.createElement("h" + (m[1].length + 1));
      inline(hd, m[2]); root.append(hd);
    } else if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      const hr = document.createElement("div"); hr.className = "scene-break"; hr.textContent = "❦"; root.append(hr);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (!quote) { flush(); quote = []; }
      quote.push(m[1]);
      let bq = root.lastElementChild;
      if (bq?.tagName !== "BLOCKQUOTE") { bq = document.createElement("blockquote"); root.append(bq); }
      bq.replaceChildren(); inline(bq, quote.join(join));
    } else if ((m = /^[-*+]\s+(.*)$/.exec(line))) {
      if (!list) { flush(); list = document.createElement("ul"); root.append(list); }
      const li = document.createElement("li"); inline(li, m[1]); list.append(li);
    } else { if (list) flush(); para.push(line); }
  }
  flush();
  return root;
}

/* Plain text: blank lines separate paragraphs; line breaks inside a paragraph are kept.
   A short line like "Chapter Three" or "Prologue" becomes a heading. */
export function renderPlain(src, { keepBreaks = true } = {}) {
  const root = newRoot(keepBreaks);
  for (const chunk of src.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const text = chunk.replace(/^\n+|\s+$/g, "");
    if (!text.trim()) continue;
    const single = text.trim();
    if (!single.includes("\n") && single.length <= 70 && HEADING.test(single)) {
      const hd = document.createElement("h3"); hd.textContent = single; root.append(hd);
    } else if (/^([-*_=~])(\s*\1){3,}$/.test(single)) {
      const hr = document.createElement("div"); hr.className = "scene-break"; hr.textContent = "❦"; root.append(hr);
    } else {
      const p = document.createElement("p"); p.textContent = text; root.append(p);
    }
  }
  return root;
}

/* ---------- ranges inside a block (highlights, search hits) ---------- */
/* Wrap characters [start, end) of block.textContent in <mark>. Returns the marks made (one per text node touched). */
export function wrapRange(block, start, end, cls, data = {}) {
  const marks = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  let pos = 0;
  for (const node of nodes) {
    const len = node.nodeValue.length, a = Math.max(start, pos), b = Math.min(end, pos + len);
    if (a < b) {
      let target = node;
      if (a > pos) target = node.splitText(a - pos);
      if (b < pos + len) target.splitText(b - a);
      const mark = document.createElement("mark");
      mark.className = cls;
      Object.assign(mark.dataset, data);
      target.replaceWith(mark);
      mark.append(target);
      marks.push(mark);
    }
    pos += len;
    if (pos >= end) break;
  }
  return marks;
}
export function clearMarks(root, cls) {
  for (const m of root.querySelectorAll("mark." + cls)) {
    const parent = m.parentNode;
    m.replaceWith(...m.childNodes);
    parent.normalize();
  }
}

/* The current text selection as pieces inside blocks: [{ block (index), start, end, text }] */
export function selectionPieces(sel, blocks) {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const out = [];
  blocks.forEach((el, i) => {
    if (!range.intersectsNode(el)) return;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    const s = range.compareBoundaryPoints(Range.START_TO_START, pre) > 0 ? offsetIn(el, range.startContainer, range.startOffset) : 0;
    const e = range.compareBoundaryPoints(Range.END_TO_END, pre) < 0 ? offsetIn(el, range.endContainer, range.endOffset) : el.textContent.length;
    if (e > s) out.push({ block: i, start: s, end: e, text: el.textContent.slice(s, e) });
  });
  return out;
}
function offsetIn(el, node, off) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(node, off);
  return r.toString().length;
}
