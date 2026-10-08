/* The reader: two-page spreads for PDFs, flowing columns for text books, page turns, saved place.
   Other modules (contents, bookmarks, search, settings, read-aloud…) plug in through R.hooks. */
import { $, pref, clamp, motion, toast, fmtMinutes } from "./dom.js";
import { getBook, saveSoon, saveProgress, flushSaves } from "./store.js";
import { bookBytes, openPdf, pdfOutline, findChapters, wordsPerPage } from "./pdf.js";
import { renderMarkdown, renderPlain, wrapRange, clearMarks } from "./text.js";
import { isPoetry } from "./organize.js";
import { textPrefs } from "./prefs.js";

/* Live reader state, read by the other modules. */
export const R = {
  current: null, pdfDoc: null, pdfTask: null,
  pos: 0, count: 1, single: false,
  blocks: [], blockSpread: [], blockEnd: [], toc: [], root: null, words: 0,
  focus: false, ready: false,          // ready: the book is open and laid out at least once
  hooks: { open: [], close: [], layout: [], preMeasure: [], pos: [], finished: [] },
};
const fire = (name, ...a) => R.hooks[name].forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });

let renderToken = 0, pageW = 0, pageH = 0, flipping = null, resizeTimer, laidOut = { w: 0, h: 0, single: null }, night = pref.get("night", "0") === "1";
const book = $("book");
const GAP = 88;
const TOC_VERSION = 2;                    // bump when findChapters changes, so saved chapter lists are redone
const WPM = 230;

export const isOpen = () => !$("view-reader").hidden && !!R.current;
export const pageToPos = (n) => clamp(R.single ? n - 1 : Math.floor(n / 2), 0, R.count - 1);
const pdfPagesAt = (p) => (R.single ? [p + 1] : p === 0 ? [null, 1] : [2 * p, 2 * p + 1]);
export const pagesShown = (p = R.pos) => (R.current?.kind === "pdf" ? pdfPagesAt(p).filter((n) => n && n <= R.pdfDoc.numPages) : []);
export const progressNow = () => (R.count > 1 ? R.pos / (R.count - 1) : 0);

/* ---------- night pages, theme of the page area ---------- */
export function applyNight() {
  book.classList.toggle("night", night);
}
export function toggleNight() { night = !night; pref.set("night", night ? "1" : "0"); applyNight(); }

function stageSize() {
  const s = $("stage"), cs = getComputedStyle(s);
  const navs = innerWidth <= 700 ? 0 : 2 * 56;
  return {
    w: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - navs - 14,
    h: s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 14,
  };
}

/* ---------- open and close ---------- */
export async function openBook(id, params = {}) {
  const b = await getBook(id);
  if (!b) { location.hash = ""; return; }
  closeBook();
  R.current = b;
  R.ready = false;
  R.toc = b.kind === "pdf" ? (b.autoToc?.length && b.autoTocV === TOC_VERSION ? b.autoToc : null) : [];
  $("view-library").hidden = true;
  $("view-reader").hidden = false;
  document.querySelector(".top").toggleAttribute("hidden", true);
  document.querySelector(".vine-rule").toggleAttribute("hidden", true);   // an SVG: no .hidden property
  $("r-title").textContent = b.title;
  $("r-author").textContent = b.author;
  $("r-loading").hidden = false;
  document.body.classList.add("reading");
  setFocus(false);
  applyNight();
  applyTextStyle();
  b.opened = Date.now();
  saveSoon(b);
  document.title = b.title + " · Writer's Nook";
  try {
    if (b.kind === "pdf") {
      const { task, doc } = await openPdf(await bookBytes(b));
      if (R.current !== b) { task.destroy(); return; }
      R.pdfTask = task; R.pdfDoc = doc;
      loadPdfContents(b, doc);
    } else {
      b.text ??= b.kind === "epub" ? null : await textOf(b);
      R.root = await buildText(b);
    }
  } catch (err) {
    console.error(err);
    if (R.current !== b) return;
    $("r-loading").hidden = true;
    toast(navigator.onLine ? "This file couldn't be opened." : "This book isn't saved for offline reading.");
    location.hash = "";
    return;
  }
  if (R.current !== b) return;
  fire("open", b);
  await layout(params.progress ?? b.progress ?? 0);
  if (b.anchor && params.progress == null && !params.page && params.block == null) await goTo(posOfAnchor(b.anchor), false, false);
  if (params.page && b.kind === "pdf") await goTo(pageToPos(+params.page), true, false);
  else if (params.block != null && b.kind !== "pdf") await goTo(blockPos(+params.block, +params.off || 0), true, false);
  R.ready = R.current === b;
  $("r-loading").hidden = true;
}
async function textOf(b) {
  if (!b.hosted) return b.text;
  const r = await fetch(b.url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
async function buildText(b) {
  if (b.kind === "epub") {
    const { parseEpub } = await import("./epub.js");
    const bytes = b.hosted ? new Uint8Array(await (await fetch(b.url)).arrayBuffer()) : new Uint8Array(await b.data.arrayBuffer());
    const parsed = await parseEpub(bytes);
    if (!b.hosted) { /* private: fill in details the file knows */ if (!b.author && parsed.author) b.author = parsed.author; }
    return parsed.root;
  }
  return b.md ? renderMarkdown(b.text, { keepBreaks: isPoetry(b) }) : renderPlain(b.text);
}
/* PDF contents: the file's own outline, else chapters found in the text (remembered afterwards). */
async function loadPdfContents(b, doc) {
  try {
    let toc = await pdfOutline(doc);
    if (!toc.length) {
      if (b.autoTocV !== TOC_VERSION) b.autoToc = null;           // the chapter finder improved: look again
      toc = b.autoToc?.length ? b.autoToc : await findChapters(doc);
      if (!b.autoToc?.length && toc.length) { b.autoToc = toc; b.autoTocV = TOC_VERSION; saveSoon(b); }
    }
    if (R.pdfDoc !== doc) return;
    R.toc = toc;
    if (!b.wpp) { b.wpp = await wordsPerPage(doc); saveSoon(b); }
  } catch { if (R.pdfDoc === doc) R.toc = []; }
  if (R.pdfDoc === doc) { fire("layout"); updateFooter(); }
}
export function closeBook() {
  flushSaves();
  renderToken++;
  flipping?.();
  fire("close");
  R.pdfTask?.destroy(); R.pdfTask = R.pdfDoc = null; R.current = null; R.root = null; R.ready = false;
  R.blocks = []; R.blockSpread = []; R.blockEnd = []; R.toc = []; R.words = 0;
  document.body.classList.remove("reading");
  document.title = "Writer's Nook";
  if (document.fullscreenElement) document.exitFullscreen();
}

/* ---------- text appearance ---------- */
export function applyTextStyle() {
  const v = $("view-reader").style, t = textPrefs;
  v.setProperty("--rf", t.font === "sans" ? 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    : t.font === "readable" ? '"Atkinson Hyperlegible", system-ui, sans-serif' : "var(--body)");
  v.setProperty("--rlh", t.lh);
  v.setProperty("--rm", t.margin === "narrow" ? 0.55 : t.margin === "wide" ? 1.55 : 1);
  v.setProperty("--ralign", t.justify ? "justify" : "left");
}

/* ---------- layout ---------- */
export async function layout(progress) {
  const b = R.current;
  if (!b || (b.kind === "pdf" ? !R.pdfDoc : !R.root)) return;      // closed, or still opening
  const { w, h } = stageSize();
  R.single = innerWidth <= 700;
  laidOut = { w, h, single: R.single };
  book.classList.toggle("single", R.single);
  const isPdf = b.kind === "pdf";
  $("spread-pdf").hidden = !isPdf;
  $("spread-text").hidden = isPdf;
  const gap = R.single ? 0 : GAP, cols = R.single ? 1 : 2;
  if (isPdf) {
    const vp = (await R.pdfDoc.getPage(1)).getViewport({ scale: 1 });
    const ratio = vp.width / vp.height;
    pageH = Math.max(200, Math.min(h, w / (cols * ratio)));
    pageW = pageH * ratio;
    book.style.width = pageW * cols + "px";
    book.style.height = pageH + "px";
    for (const side of ["left", "right"]) {
      const pg = book.querySelector(".page." + side);
      pg.style.width = pageW + "px"; pg.style.height = pageH + "px";
    }
    R.count = R.single ? R.pdfDoc.numPages : Math.floor(R.pdfDoc.numPages / 2) + 1;
  } else {
    book.style.width = Math.max(260, Math.min(w, 1080)) + "px";
    book.style.height = Math.max(300, h) + "px";
    const flow = $("text-flow");
    flow.style.columnGap = gap + "px";
    flow.style.fontSize = textPrefs.size + "px";
    flow.replaceChildren();
    const root = R.root;
    // Books that open with their own title heading don't need ours.
    const first = root.firstElementChild;
    const own = first?.tagName === "H2" && (b.kind === "epub" ? first.textContent.trim().toLowerCase() === b.title.trim().toLowerCase() : b.md);
    if (!own) {
      const t = document.createElement("h2");
      t.className = "title-page";
      t.textContent = b.title;
      flow.append(t);
      if (b.author) { const a = document.createElement("div"); a.className = "title-by"; a.textContent = "by " + b.author; flow.append(a); }
    }
    flow.append(root);
    await loadFonts();
    fire("preMeasure");
    const colW = (flow.clientWidth - gap * (cols - 1)) / cols;
    R.count = Math.max(1, Math.ceil(Math.round((flow.scrollWidth + gap) / (colW + gap)) / cols));
    // Which spread each block starts on, so bookmarks, chapters and highlights survive text size changes.
    // offsetLeft, not getBoundingClientRect: the book-opening animation scales and tilts the page.
    flow.scrollLeft = 0;
    R.blocks = [...root.children];
    R.blockSpread = R.blocks.map((el) => clamp(Math.floor(Math.round((el.offsetLeft - flow.offsetLeft) / (colW + gap)) / cols), 0, R.count - 1));
    R.blockEnd = R.blockSpread.map((s, i) => Math.max(s, R.blockSpread[i + 1] ?? R.count - 1));
    R.toc = [];
    R.blocks.forEach((el, i) => {
      if (/^H[2-4]$/.test(el.tagName) && el.textContent.trim()) R.toc.push({ label: el.textContent.trim(), depth: +el.tagName[1] - 2, spread: R.blockSpread[i] });
    });
    R.words = R.blocks.reduce((n, el) => n + (el.textContent.trim().split(/\s+/).filter(Boolean).length), 0);
    b.words = R.words;
  }
  $("r-slider").max = R.count - 1;
  await goTo(Math.round(progress * (R.count - 1)), false, false);
  fire("layout");
}
/* Measure with the real fonts, not the stand-ins the browser uses while they load. */
async function loadFonts() {
  const fam = textPrefs.font === "readable" ? '"Atkinson Hyperlegible"' : textPrefs.font === "sans" ? null : '"EB Garamond"';
  const px = textPrefs.size;
  const wanted = ['600 32px "Cormorant Garamond"', ...(fam ? [`400 ${px}px ${fam}`, `italic 400 ${px}px ${fam}`, `700 ${px}px ${fam}`] : [])];
  try { await Promise.all(wanted.map((f) => document.fonts.load(f))); await document.fonts.ready; } catch { /* measure anyway */ }
}
/* A bookmark-style place inside a block: which spread is it on now? */
export function blockPos(block, off = 0) {
  if (R.blockSpread[block] == null) return 0;
  const start = R.blockSpread[block], span = Math.max(1, R.blockEnd[block] - start + 1);
  return Math.min(R.count - 1, start + Math.floor(off * span));
}

/* Where you are, in terms that survive a change of text size or screen shape:
   a PDF page, or a paragraph plus how far through it. */
export function anchorHere() {
  const b = R.current, pos = R.pos;
  if (!b) return null;
  if (b.kind === "pdf") return { page: pagesShown(pos)[0] };
  // the first paragraph that starts on this spread, or else the one running across it
  const starts = R.blockSpread.map((s, i) => (s === pos ? i : -1)).filter((i) => i >= 0);
  let i = starts.find((k) => R.blocks[k].textContent.trim().length > 2);
  if (i === undefined) i = R.blockSpread.findLastIndex((s) => s <= pos);
  const span = i >= 0 ? Math.max(1, R.blockEnd[i] - R.blockSpread[i] + 1) : 1;
  return { block: i >= 0 ? i : null, frac: progressNow(), off: i >= 0 && pos > R.blockSpread[i] ? (pos - R.blockSpread[i] + 0.5) / span : 0 };
}
export function posOfAnchor(a) {
  if (!a) return 0;
  if (a.page) return pageToPos(a.page);
  if (a.block != null && R.blockSpread[a.block] != null) return blockPos(a.block, a.off || 0);
  return Math.round((a.frac || 0) * (R.count - 1));
}

/* Lay the book out again (new text size, new screen shape…) and land on the same words.
   Rapid changes are folded into one go, and the place is remembered from before the first change. */
let reflowRun = null, reflowAgain = false;
export function reflow() {
  if (!R.current || !R.ready) return Promise.resolve();
  if (reflowRun) { reflowAgain = true; return reflowRun; }
  const anchor = R.current.anchor || anchorHere();     // the place from your last page turn, so repeated changes never drift
  reflowRun = (async () => {
    try {
      do {
        reflowAgain = false;
        if (!R.current) break;
        applyTextStyle();
        await layout(progressNow());
        await goTo(posOfAnchor(anchor), false, false);
      } while (reflowAgain);
    } finally { reflowRun = null; }
  })();
  return reflowRun;
}

/* ---------- PDF pages and the page turn ---------- */
async function renderCanvas(n, token) {
  if (!n || n > R.pdfDoc.numPages) return null;
  const page = await R.pdfDoc.getPage(n);
  if (token !== renderToken) return null;
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (pageW / base.width) * dpr });
  const cv = document.createElement("canvas");
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  cv.style.width = pageW + "px"; cv.style.height = pageH + "px";
  await page.render({ canvasContext: cv.getContext("2d"), viewport: vp, background: "#fff" }).promise;
  return cv;
}
function copyCanvas(src) {
  if (!src) return null;
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  c.style.cssText = src.style.cssText;
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
}
function setPage(side, cv) {
  const pg = book.querySelector(".page." + side);
  pg.classList.toggle("blank", !cv);
  pg.replaceChildren(...(cv ? [cv] : []));
}
function makeLeaf(dir, front, back) {
  const leaf = document.createElement("div");
  leaf.className = "leaf " + (dir > 0 ? "fwd" : "bwd");
  leaf.style.width = pageW + "px"; leaf.style.height = pageH + "px";
  leaf.style.left = (dir > 0 ? pageW : 0) + "px";
  for (const [cls, cv] of [["front", front], ["back", back]]) {
    const f = document.createElement("div");
    f.className = "face " + cls;
    if (cv) f.append(cv);
    leaf.append(f);
  }
  return leaf;
}
/* Turn one leaf of the book: dir > 0 forward, dir < 0 back. */
function flip(dir, newLeft, newRight) {
  return new Promise((resolve) => {
    const layer = $("flip-layer");
    const leftPg = book.querySelector(".page.left canvas"), rightPg = book.querySelector(".page.right canvas");
    let leaf;
    if (dir > 0) { leaf = makeLeaf(1, rightPg || null, copyCanvas(newLeft)); setPage("right", newRight); }
    else { leaf = makeLeaf(-1, leftPg || null, copyCanvas(newRight)); setPage("left", newLeft); }
    layer.append(leaf);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      flipping = null;
      setPage(dir > 0 ? "left" : "right", dir > 0 ? newLeft : newRight);
      leaf.remove();
      resolve();
    };
    flipping = finish;
    leaf.getBoundingClientRect();
    leaf.classList.add("turning");
    leaf.style.transform = `rotateY(${dir > 0 ? -180 : 180}deg)`;
    leaf.addEventListener("transitionend", (e) => e.target === leaf && finish());
    setTimeout(finish, 1000);
  });
}

/* ---------- moving around ---------- */
export async function goTo(p, save = true, animate = true) {
  const b = R.current;
  if (!b) return;
  flipping?.();
  const old = R.pos;
  R.pos = clamp(p, 0, R.count - 1);
  const token = ++renderToken;
  $("r-prev").disabled = R.pos === 0;
  $("r-next").disabled = R.pos >= R.count - 1;
  $("r-slider").value = R.pos;
  updateFooter();
  fire("pos", old, save);           // save is true only for real moves by the reader; layout and reopening pass false
  if (save) {                       // remember the place now, not after the page-turn animation: leaving mid-turn must not lose it
    b.progress = progressNow();
    b.anchor = anchorHere();
    if (b.progress >= 0.98 && !b.finishedAt) { b.finishedAt = Date.now(); fire("finished", b); saveSoon(b); }
    else saveProgress(b);
  }
  if (b.kind === "pdf") {
    const nums = pdfPagesAt(R.pos), total = R.pdfDoc.numPages;
    const cvs = await Promise.all(nums.map((n) => renderCanvas(n, token)));
    if (token !== renderToken) return;
    const [l, r] = R.single ? [null, cvs[0]] : cvs;
    if (animate && !motion.reduce && !R.single && Math.abs(R.pos - old) === 1) {
      await flip(R.pos > old ? 1 : -1, l, r);
    } else {
      setPage("left", l); setPage("right", r);
      if (animate && !motion.reduce && R.pos !== old) {
        book.querySelector(".page.right").animate(
          { opacity: [0, 1], transform: [`translateX(${R.pos > old ? 24 : -24}px)`, "none"] }, { duration: 280, easing: "ease-out" });
      }
    }
  } else {
    const flow = $("text-flow"), gap = R.single ? 0 : GAP;
    const move = () => (flow.scrollLeft = R.pos * (flow.clientWidth + gap));
    if (animate && !motion.reduce && R.pos !== old) {
      const out = flow.animate({ opacity: [1, 0] }, { duration: 140, fill: "forwards" });
      await out.finished;
      move(); out.cancel();
      flow.animate({ opacity: [0, 1], transform: [`translateX(${R.pos > old ? 18 : -18}px)`, "none"] }, { duration: 260, easing: "ease-out" });
    } else move();
  }
}

/* "Spread 3 of 30" and roughly how long is left. */
export function minutesLeft() {
  const b = R.current;
  if (!b || R.count < 2) return null;
  const frac = 1 - progressNow();
  if (b.kind === "pdf") {
    const pages = R.pdfDoc.numPages * frac;
    return b.wpp ? (pages * b.wpp) / WPM : null;
  }
  return R.words ? (R.words * frac) / WPM : null;
}
export function updateFooter() {
  const b = R.current;
  if (!b) return;
  let pos;
  if (b.kind === "pdf") {
    const shown = pagesShown(), total = R.pdfDoc.numPages;
    pos = R.single ? `Page ${shown[0]} of ${total}` : `Pages ${shown.join("–")} of ${total}`;
  } else pos = `Spread ${R.pos + 1} of ${R.count}`;
  $("r-pos").textContent = pos;
  const m = minutesLeft();
  $("r-left").textContent = m == null ? "" : R.pos >= R.count - 1 ? "The end" : "About " + fmtMinutes(m) + " left";
}

/* ---------- focus mode: just the page ---------- */
export function setFocus(on) {      // the bars fade out but keep their space, so the pages never reflow
  R.focus = on;
  $("view-reader").classList.toggle("focus", on);
}
export const toggleFocus = () => setFocus(!R.focus);

/* ---------- controls ---------- */
$("r-prev").onclick = () => goTo(R.pos - 1);
$("r-next").onclick = () => goTo(R.pos + 1);
$("r-slider").oninput = (e) => goTo(+e.target.value);
$("r-back").onclick = () => (location.hash = "");
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else $("view-reader").requestFullscreen?.();
}

/* Tap zones: left third back, right third forward, middle third shows or hides the bars. */
let lastPointer = "mouse";
$("book").addEventListener("pointerdown", (e) => (lastPointer = e.pointerType));
$("book").addEventListener("click", (e) => {
  if (!R.current) return;
  if (R.current.kind !== "pdf" && lastPointer !== "touch") return;   // with a mouse, clicking text is for selecting it
  if (e.target.closest("mark.hl")) return;                      // highlights open their own note
  if (!getSelection().isCollapsed) return;                      // finishing a selection is not a page turn
  const rect = book.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  if (!R.single) {                                              // two pages: left page back, right page forward
    if (R.current.kind !== "pdf" && x > 0.3 && x < 0.7) return toggleFocus();
    return goTo(R.pos + (x < 0.5 ? -1 : 1));
  }
  if (x < 0.3) goTo(R.pos - 1); else if (x > 0.7) goTo(R.pos + 1); else toggleFocus();
});

let touchX = null, touchY = null;
$("stage").addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
$("stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
  touchX = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) goTo(R.pos + (dx < 0 ? 1 : -1));
});

/* A phone's on-screen keyboard resizes the page: don't re-lay the book out while you're typing, only once you're done. */
const typing = () => document.activeElement?.matches?.("input, textarea, select");
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!R.ready || !isOpen() || typing()) return;
    const { w, h } = stageSize();           // closing a menu or a dialog moves focus: only re-lay out if the space really changed
    if (Math.abs(w - laidOut.w) < 2 && Math.abs(h - laidOut.h) < 2 && (innerWidth <= 700) === laidOut.single) return;
    reflow();
  }, 200);
}
addEventListener("resize", onResize);
addEventListener("focusout", () => setTimeout(() => { if (!typing()) onResize(); }, 50));
document.addEventListener("fullscreenchange", onResize);

/* highlights are re-applied by the notes module on "preMeasure"; exposed so it can clear and redraw */
export { wrapRange, clearMarks };
