/* EPUB reader: unzip, follow the book's reading order, and turn each chapter into the same tree of paragraphs and
   headings the other text books use. Built as DOM nodes, never HTML strings, so a book can't run anything.
   Pictures are left out for now. */
import { unzipSync, strFromU8 } from "../vendor/fflate.min.mjs";

const SKIP_BINARY = /\.(jpe?g|png|gif|webp|svg|bmp|ttf|otf|woff2?|mp3|mp4|m4a|ogg|wav|js|css)$/i;
const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const q = (doc, name) => [...doc.getElementsByTagName("*")].filter((n) => n.localName === name);
const dirOf = (p) => p.slice(0, p.lastIndexOf("/") + 1);
function resolve(base, href) {
  const parts = (base + decodeURIComponent(href.split("#")[0])).split("/"), out = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
  return out.join("/");
}
const collapse = (s) => s.replace(/\s+/g, " ");

function readPackage(files) {
  const containerFile = files["META-INF/container.xml"];
  if (!containerFile) throw new Error("Not an EPUB (no container.xml)");
  const rootfile = q(xml(strFromU8(containerFile)), "rootfile")[0]?.getAttribute("full-path");
  if (!rootfile || !files[rootfile]) throw new Error("EPUB package file missing");
  const opf = xml(strFromU8(files[rootfile]));
  const base = dirOf(rootfile);
  const manifest = new Map();
  for (const it of q(opf, "item")) manifest.set(it.getAttribute("id"), { href: it.getAttribute("href"), type: it.getAttribute("media-type"), props: it.getAttribute("properties") || "" });
  const spine = q(opf, "itemref").map((r) => manifest.get(r.getAttribute("idref"))).filter(Boolean);
  const meta = (n) => q(opf, n)[0]?.textContent.trim() || "";
  let coverItem = [...manifest.values()].find((m) => /cover-image/.test(m.props));
  if (!coverItem) {
    const id = q(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
    coverItem = id && manifest.get(id);
  }
  // chapter titles from the navigation document or the old NCX file
  const titles = new Map();
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  const ncx = [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml");
  try {
    if (nav && files[resolve(base, nav.href)]) {
      const navBase = dirOf(resolve(base, nav.href));
      for (const a of q(new DOMParser().parseFromString(strFromU8(files[resolve(base, nav.href)]), "text/html"), "a"))
        if (a.getAttribute("href")) titles.set(resolve(navBase, a.getAttribute("href")), collapse(a.textContent).trim());
    } else if (ncx && files[resolve(base, ncx.href)]) {
      const ncxBase = dirOf(resolve(base, ncx.href));
      for (const p of q(xml(strFromU8(files[resolve(base, ncx.href)])), "navPoint")) {
        const src = q(p, "content")[0]?.getAttribute("src"), label = q(p, "text")[0]?.textContent;
        if (src && label) titles.set(resolve(ncxBase, src), collapse(label).trim());
      }
    }
  } catch { /* titles are a nicety */ }
  return { base, spine, titles, title: meta("title"), author: meta("creator"), coverItem, manifest };
}

function toDataUrl(bytes, type) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || "image/jpeg"};base64,${btoa(bin)}`;
}

/* Title, author and cover only (cheap): used when a book is added or listed. */
export async function epubInfo(bytes) {
  const files = unzipSync(bytes, { filter: (f) => !SKIP_BINARY.test(f.name) });
  const pkg = readPackage(files);
  let cover = null;
  if (pkg.coverItem) {
    const path = resolve(pkg.base, pkg.coverItem.href);
    const img = unzipSync(bytes, { filter: (f) => f.name === path })[path];
    if (img && img.length < 6e6) cover = toDataUrl(img, pkg.coverItem.type);
  }
  return { title: pkg.title, author: pkg.author, cover };
}

/* The whole book: { title, author, root } where root is a div of blocks. */
export async function parseEpub(bytes) {
  const files = unzipSync(bytes, { filter: (f) => !SKIP_BINARY.test(f.name) });
  const pkg = readPackage(files);
  const root = document.createElement("div");
  root.className = "md";
  for (const item of pkg.spine) {
    if (!/x?html/i.test(item.type || "") && !/\.x?html?$/i.test(item.href)) continue;
    const path = resolve(pkg.base, item.href);
    if (!files[path]) continue;
    const str = strFromU8(files[path]);
    let doc = new DOMParser().parseFromString(str, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(str, "text/html");
    const blocks = convert(doc.body || doc.documentElement);
    if (!blocks.length) continue;
    const title = pkg.titles.get(path);
    const hasHeading = blocks.slice(0, 3).some((b) => /^H[2-4]$/.test(b.tagName));
    if (title && !hasHeading) { const hd = document.createElement("h2"); hd.textContent = title; root.append(hd); }
    root.append(...blocks);
  }
  if (!root.children.length) throw new Error("This EPUB has no readable text.");
  return { title: pkg.title, author: pkg.author, root };
}

/* XHTML element -> array of block elements (h2/h3/h4, p, blockquote, ul, scene-break) */
const BLOCK = new Set(["p", "div", "section", "article", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "pre", "table", "figure", "aside", "header", "footer", "main", "nav", "body", "dl", "dt", "dd", "tr"]);
const DROP = new Set(["script", "style", "svg", "img", "head", "nav", "audio", "video", "iframe", "object", "math", "image", "title"]);
function convert(node) {
  const out = [];
  const name = (n) => (n.localName || n.nodeName || "").toLowerCase();
  const para = (el, tag = "p") => {
    const p = document.createElement(tag);
    inlineInto(p, el);
    if (p.textContent.trim()) out.push(p);
  };
  (function walk(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) { const p = document.createElement("p"); p.textContent = collapse(n.nodeValue).trim(); out.push(p); } continue; }
      if (n.nodeType !== 1) continue;
      const t = name(n);
      if (DROP.has(t)) continue;
      if (/^h[1-6]$/.test(t)) para(n, t === "h1" ? "h2" : t === "h2" ? "h3" : "h4");
      else if (t === "p" || t === "dt" || t === "dd") para(n);
      else if (t === "hr") { const hr = document.createElement("div"); hr.className = "scene-break"; hr.textContent = "❦"; out.push(hr); }
      else if (t === "blockquote") { const bq = document.createElement("blockquote"); inlineInto(bq, n, " "); if (bq.textContent.trim()) out.push(bq); }
      else if (t === "ul" || t === "ol") {
        const ul = document.createElement("ul");
        let i = 0;
        for (const li of n.children) if (name(li) === "li") { const l = document.createElement("li"); if (t === "ol") l.append(`${++i}. `); inlineInto(l, li); if (l.textContent.trim()) ul.append(l); }
        if (ul.children.length) out.push(ul);
      } else if (t === "pre") { const p = document.createElement("p"); p.style.whiteSpace = "pre-wrap"; p.textContent = n.textContent.replace(/^\n+|\s+$/g, ""); if (p.textContent) out.push(p); }
      else if (t === "tr") { const p = document.createElement("p"); p.textContent = [...n.children].map((c) => collapse(c.textContent).trim()).filter(Boolean).join("  |  "); if (p.textContent) out.push(p); }
      else if (BLOCK.has(t)) {
        // a container: paragraphs inside become blocks; a container holding only text is one paragraph
        const hasBlocks = [...n.children].some((c) => BLOCK.has(name(c)));
        if (hasBlocks) walk(n); else para(n);
      } else para(n);                                           // inline element sitting loose in a container
    }
  })(node);
  return out;
}
/* copy the text of el into target, keeping only emphasis, strong and line breaks */
function inlineInto(target, el, joiner = "") {
  const name = (n) => (n.localName || n.nodeName || "").toLowerCase();
  (function walk(src, dst) {
    let first = true;
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { dst.append(collapse(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const t = name(n);
      if (DROP.has(t)) continue;
      if (t === "br") { dst.append(document.createElement("br")); continue; }
      if (joiner && BLOCK.has(t) && !first) dst.append(joiner);
      first = false;
      if (t === "em" || t === "i" || t === "cite" || t === "dfn") { const e = document.createElement("em"); walk(n, e); dst.append(e); }
      else if (t === "strong" || t === "b") { const e = document.createElement("strong"); walk(n, e); dst.append(e); }
      else walk(n, dst);
    }
  })(el, target);
  // tidy the whitespace at the ends of the block
  const a = target.firstChild, z = target.lastChild;
  if (a?.nodeType === 3) a.nodeValue = a.nodeValue.replace(/^\s+/, "");
  if (z?.nodeType === 3) z.nodeValue = z.nodeValue.replace(/\s+$/, "");
}
