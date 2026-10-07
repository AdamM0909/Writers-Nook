import * as pdfjs from "./vendor/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

const $ = (id) => document.getElementById(id);

/* ---------- storage (IndexedDB, stays in this browser) ---------- */
const dbReady = new Promise((resolve, reject) => {
  const req = indexedDB.open("writers-nook", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("books", { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function tx(mode, fn) {
  const db = await dbReady;
  return new Promise((resolve, reject) => {
    const t = db.transaction("books", mode);
    const r = fn(t.objectStore("books"));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
const idbAll = () => tx("readonly", (s) => s.getAll());
const idbPut = (b) => tx("readwrite", (s) => s.put(b));
const delBook = (id) => tx("readwrite", (s) => s.delete(id));

/* Books published with the site live in books/ and are listed by books/library.json.
   Their reading progress and generated covers are remembered in localStorage. */
const hosted = new Map();
const readMeta = () => { try { return JSON.parse(localStorage.getItem("wn-meta")) || {}; } catch { return {}; } };
function saveMeta(b) {
  try {
    const m = readMeta();
    m[b.id] = { progress: b.progress || 0, opened: b.opened, pages: b.pages, ...(b.cover?.startsWith("data:") && { cover: b.cover }) };
    localStorage.setItem("wn-meta", JSON.stringify(m));
  } catch { /* storage full or blocked: progress just won't persist */ }
}
async function loadHosted() {
  try {
    const r = await fetch("books/library.json", { cache: "no-cache" });
    if (!r.ok) return;
    const meta = readMeta();
    for (const e of await r.json()) {
      const id = "h:" + e.file;
      hosted.set(id, {
        id, hosted: true, added: 0, kind: /\.pdf$/i.test(e.file) ? "pdf" : "text",
        url: "books/" + e.file.split("/").map(encodeURIComponent).join("/"),
        title: e.title || cleanName(e.file.split("/").pop()), author: e.author || "", ...meta[id],
        ...(e.cover && { cover: "books/" + encodeURIComponent(e.cover) }),
      });
    }
  } catch { /* no hosted library: only local uploads */ }
}
const allBooks = async () => [...hosted.values(), ...(await idbAll()).sort((a, b) => b.added - a.added)];
const getBook = async (id) => hosted.get(id) || (await tx("readonly", (s) => s.get(id)));
const putBook = (b) => (b.hosted ? saveMeta(b) : idbPut(b));
navigator.storage?.persist?.();

/* ---------- helpers ---------- */
function cleanName(n) { return n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(); }
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const uid = () => crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
function show(view) {
  for (const v of ["library", "reader"]) $("view-" + v).hidden = v !== view;
  document.querySelector(".top").toggleAttribute("hidden", view === "reader");
  document.querySelector(".vine-rule").toggleAttribute("hidden", view === "reader");
}
/* ---------- theme & preferences ---------- */
const pref = {
  get: (k, d) => { try { return localStorage.getItem("wn-" + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("wn-" + k, v); } catch { /* ignore */ } },
};
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  pref.set("theme", next);
}
$("theme-lib").onclick = $("theme-read").onclick = toggleTheme;
let night = pref.get("night", "0") === "1";
let fontSize = +pref.get("fs", 19);

/* ---------- library ---------- */
async function renderLibrary() {
  show("library");
  const q = $("search").value.trim().toLowerCase();
  const everything = await allBooks();
  const sort = $("sort").value;
  const books = everything.filter((b) => !q || (b.title + " " + b.author).toLowerCase().includes(q));
  if (sort === "title") books.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "recent") books.sort((a, b) => (b.opened || 0) - (a.opened || 0));
  renderContinue(everything.filter((b) => b.opened && b.progress < 0.98).sort((a, b) => b.opened - a.opened)[0]);
  const shelf = $("shelf");
  shelf.replaceChildren();
  $("empty").hidden = books.length > 0 || !!q;
  books.forEach((b, i) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.setProperty("--i", Math.min(i, 12));
    const cover = document.createElement("div");
    cover.className = "cover";
    if (b.cover) {
      const img = document.createElement("img");
      img.src = b.cover; img.alt = "";
      cover.append(img);
    }
    const ct = document.createElement("div");
    ct.className = "ct";
    ct.textContent = b.title;
    if (b.author) { const s = document.createElement("small"); s.textContent = b.author; ct.append(s); }
    cover.append(ct);
    const meta = document.createElement("div");
    meta.className = "meta";
    const txt = document.createElement("div");
    const nm = document.createElement("b");
    nm.textContent = b.title;
    txt.append(nm, (b.author ? b.author + " · " : "") + (b.kind === "pdf" ? (b.pages ? `${b.pages} pages` : "PDF") : "Text"));
    const del = document.createElement("button");
    del.className = "del"; del.title = "Remove"; del.textContent = "×"; del.hidden = !!b.hosted;
    del.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`Remove “${b.title}” from your library?`)) { await delBook(b.id); renderLibrary(); }
    };
    meta.append(txt, del);
    const prog = document.createElement("div");
    prog.className = "progress";
    const bar = document.createElement("i");
    bar.style.width = Math.round((b.progress || 0) * 100) + "%";
    prog.append(bar);
    card.append(cover, meta, prog);
    card.onclick = () => (location.hash = "#read=" + encodeURIComponent(b.id));
    shelf.append(card);
    if (b.hosted && b.kind === "pdf" && !b.cover) coverQueue(b, cover);
  });
}
let coverChain = Promise.resolve();
function coverQueue(b, coverEl) {
  coverChain = coverChain.then(async () => {
    try {
      Object.assign(b, await pdfCover({ url: b.url }));
      saveMeta(b);
      const img = document.createElement("img");
      img.alt = ""; img.src = b.cover;
      img.style.animation = "fadeUp .5s ease-out";
      coverEl.prepend(img);
    } catch (err) { console.warn("cover failed", b.url, err); }
  });
}
function renderContinue(b) {
  const el = $("continue");
  el.hidden = !b;
  if (!b) return;
  el.replaceChildren();
  if (b.cover) { const img = document.createElement("img"); img.alt = ""; img.src = b.cover; el.append(img); }
  const t = document.createElement("div");
  t.className = "ct2";
  const sm = document.createElement("small"); sm.textContent = "Continue reading";
  const nm = document.createElement("b"); nm.textContent = b.title;
  const pc = document.createElement("small"); pc.textContent = Math.round((b.progress || 0) * 100) + "% read";
  t.append(sm, nm, pc);
  const go = document.createElement("span"); go.className = "go"; go.textContent = "Resume →";
  el.append(t, go);
  el.onclick = () => (location.hash = "#read=" + encodeURIComponent(b.id));
  el.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && el.click();
}
$("search").addEventListener("input", renderLibrary);
$("sort").value = pref.get("sort", "shelf");
$("sort").addEventListener("change", () => { pref.set("sort", $("sort").value); renderLibrary(); });

/* ---------- adding files ---------- */
async function pdfCover(source) {
  const task = pdfjs.getDocument(source.data ? { data: source.data.slice(0) } : source);
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 360 / vp0.width });
  const c = document.createElement("canvas");
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#fff" }).promise;
  const out = { cover: c.toDataURL("image/jpeg", 0.8), pages: doc.numPages };
  task.destroy();
  return out;
}
async function addFiles(files) {
  let added = 0;
  for (const f of files) {
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const isText = /\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/");
    if (!isPdf && !isText) { toast(`“${f.name}” isn't a PDF or text file.`); continue; }
    try {
      const book = { id: uid(), title: cleanName(f.name) || "Untitled", author: "", added: Date.now(), progress: 0 };
      if (isPdf) {
        const buf = await f.arrayBuffer();
        Object.assign(book, { kind: "pdf", data: new Blob([buf], { type: "application/pdf" }) }, await pdfCover({ data: buf }));
      } else {
        Object.assign(book, { kind: "text", text: await f.text() });
      }
      await idbPut(book);
      added++;
    } catch (err) {
      console.error(err);
      toast(`Couldn't read “${f.name}”.`);
    }
  }
  if (added) toast(added === 1 ? "Added to your library." : `Added ${added} items.`);
  if (location.hash) location.hash = ""; else renderLibrary();
}
$("file-input").addEventListener("change", async (e) => {
  await addFiles([...e.target.files]);
  e.target.value = "";
});
let dragDepth = 0;
addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; $("drop").hidden = false; } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop").hidden = true; } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; $("drop").hidden = true;
  if (e.dataTransfer?.files.length) addFiles([...e.dataTransfer.files]);
});

/* ---------- reader ---------- */
let current = null, pdfDoc = null, pdfTask = null, pos = 0, count = 1, single = false, renderToken = 0;
let pageW = 0, pageH = 0, flipping = null, resizeTimer;
const book = $("book");
const GAP = 88;
function applyNight() {
  book.classList.toggle("night", night);
  $("r-night").setAttribute("aria-pressed", night);
}
$("r-night").onclick = () => { night = !night; pref.set("night", night ? "1" : "0"); applyNight(); };
function changeSize(d) {
  fontSize = Math.max(14, Math.min(30, fontSize + d));
  pref.set("fs", fontSize);
  if (current?.kind === "text") layout(count > 1 ? pos / (count - 1) : 0);
}
$("r-smaller").onclick = () => changeSize(-1);
$("r-bigger").onclick = () => changeSize(1);

function stageSize() {
  const s = $("stage"), cs = getComputedStyle(s);
  const navs = innerWidth <= 700 ? 0 : 2 * 56;
  return {
    w: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - navs - 14,
    h: s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 14,
  };
}
const pdfPagesAt = (p) => (single ? [p + 1] : p === 0 ? [null, 1] : [2 * p, 2 * p + 1]);

async function openBook(id) {
  const b = await getBook(id);
  if (!b) { location.hash = ""; return; }
  closeBook();
  current = b;
  show("reader");
  $("r-title").textContent = b.title;
  $("r-author").textContent = b.author;
  $("r-loading").hidden = false;
  $("r-size").hidden = b.kind === "pdf";
  $("r-night").hidden = b.kind !== "pdf";
  applyNight();
  b.opened = Date.now();
  Promise.resolve(putBook(b)).catch(() => {});
  document.title = b.title + " · Writer's Nook";
  try {
    if (b.kind === "pdf") {
      pdfTask = pdfjs.getDocument(b.hosted ? { url: b.url } : { data: await b.data.arrayBuffer() });
      pdfDoc = await pdfTask.promise;
    } else if (b.hosted && b.text == null) {
      const r = await fetch(b.url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      b.text = await r.text();
    }
  } catch (err) {
    console.error(err);
    $("r-loading").hidden = true;
    toast("This file couldn't be opened.");
    location.hash = "";
    return;
  }
  if (current !== b) return;
  await layout(b.progress || 0);
  $("r-loading").hidden = true;
}
function closeBook() {
  renderToken++;
  flipping?.();
  pdfTask?.destroy(); pdfTask = pdfDoc = null; current = null;
  document.title = "Writer's Nook";
  if (document.fullscreenElement) document.exitFullscreen();
}

async function layout(progress) {
  if (!current) return;
  const { w, h } = stageSize();
  single = innerWidth <= 700;
  book.classList.toggle("single", single);
  const isPdf = current.kind === "pdf";
  $("spread-pdf").hidden = !isPdf;
  $("spread-text").hidden = isPdf;
  const gap = single ? 0 : GAP, cols = single ? 1 : 2;
  if (isPdf) {
    const vp = (await pdfDoc.getPage(1)).getViewport({ scale: 1 });
    const ratio = vp.width / vp.height;
    pageH = Math.max(200, Math.min(h, w / (cols * ratio)));
    pageW = pageH * ratio;
    book.style.width = pageW * cols + "px";
    book.style.height = pageH + "px";
    for (const side of ["left", "right"]) {
      const pg = book.querySelector(".page." + side);
      pg.style.width = pageW + "px"; pg.style.height = pageH + "px";
    }
    count = single ? pdfDoc.numPages : Math.floor(pdfDoc.numPages / 2) + 1;
  } else {
    book.style.width = Math.max(260, Math.min(w, 1080)) + "px";
    book.style.height = Math.max(300, h) + "px";
    const flow = $("text-flow");
    flow.style.columnGap = gap + "px";
    flow.style.fontSize = fontSize + "px";
    flow.replaceChildren();
    const t = document.createElement("h2");
    t.textContent = current.title;
    t.style.cssText = "text-align:center;margin:1.2em 0 .2em;font-size:2em;break-inside:avoid";
    flow.append(t);
    if (current.author) {
      const a = document.createElement("div");
      a.textContent = "by " + current.author;
      a.style.cssText = "text-align:center;font-style:italic;color:var(--muted);margin-bottom:1.6em";
      flow.append(a);
    }
    const body = document.createElement("div");
    body.textContent = current.text;
    flow.append(body);
    await document.fonts?.ready;
    const colW = (flow.clientWidth - gap * (cols - 1)) / cols;
    count = Math.max(1, Math.ceil(Math.round((flow.scrollWidth + gap) / (colW + gap)) / cols));
  }
  $("r-slider").max = count - 1;
  await goTo(Math.round(progress * (count - 1)), false, false);
}

async function renderCanvas(n, token) {
  if (!n || n > pdfDoc.numPages) return null;
  const page = await pdfDoc.getPage(n);
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
    if (dir > 0) {
      leaf = makeLeaf(1, rightPg || null, copyCanvas(newLeft));
      setPage("right", newRight);
    } else {
      leaf = makeLeaf(-1, leftPg || null, copyCanvas(newRight));
      setPage("left", newLeft);
    }
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

async function goTo(p, save = true, animate = true) {
  if (!current) return;
  flipping?.();
  const old = pos;
  pos = Math.max(0, Math.min(count - 1, p));
  const token = ++renderToken;
  $("r-prev").disabled = pos === 0;
  $("r-next").disabled = pos >= count - 1;
  $("r-slider").value = pos;
  if (current.kind === "pdf") {
    const nums = pdfPagesAt(pos), total = pdfDoc.numPages;
    const shown = nums.filter((n) => n && n <= total);
    $("r-pos").textContent = single ? `Page ${shown[0]} of ${total}` : `Pages ${shown.join("–")} of ${total}`;
    const cvs = await Promise.all(nums.map((n) => renderCanvas(n, token)));
    if (token !== renderToken) return;
    const [l, r] = single ? [null, cvs[0]] : cvs;
    if (animate && !reduceMotion && !single && Math.abs(pos - old) === 1) {
      await flip(pos > old ? 1 : -1, l, r);
    } else {
      setPage("left", l); setPage("right", r);
      if (animate && !reduceMotion && pos !== old) {
        book.querySelector(".page.right").animate(
          { opacity: [0, 1], transform: [`translateX(${pos > old ? 24 : -24}px)`, "none"] }, { duration: 280, easing: "ease-out" });
      }
    }
  } else {
    const flow = $("text-flow"), gap = single ? 0 : GAP;
    const move = () => (flow.scrollLeft = pos * (flow.clientWidth + gap));
    $("r-pos").textContent = `Spread ${pos + 1} of ${count}`;
    if (animate && !reduceMotion && pos !== old) {
      const out = flow.animate({ opacity: [1, 0] }, { duration: 140, fill: "forwards" });
      await out.finished;
      move(); out.cancel();
      flow.animate({ opacity: [0, 1], transform: [`translateX(${pos > old ? 18 : -18}px)`, "none"] }, { duration: 260, easing: "ease-out" });
    } else move();
  }
  if (save && token === renderToken) {
    current.progress = count > 1 ? pos / (count - 1) : 0;
    Promise.resolve(putBook(current)).catch(() => {});
  }
}

$("r-prev").onclick = () => goTo(pos - 1);
$("r-next").onclick = () => goTo(pos + 1);
$("r-slider").oninput = (e) => goTo(+e.target.value);
$("r-back").onclick = () => (location.hash = "");
$("r-full").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $("view-reader").requestFullscreen?.();
};
book.addEventListener("click", (e) => {
  if (current?.kind !== "pdf") return;
  const x = e.clientX - book.getBoundingClientRect().left;
  goTo(pos + (x < book.clientWidth / (single ? 3 : 2) ? -1 : 1));
});
$("r-download").onclick = () => {
  if (!current) return;
  const a = document.createElement("a");
  const ext = current.kind === "pdf" ? ".pdf" : ".txt";
  if (current.hosted) a.href = current.url;
  else a.href = URL.createObjectURL(current.kind === "pdf" ? current.data : new Blob([current.text], { type: "text/plain" }));
  a.download = current.title + ext;
  a.click();
  if (!current.hosted) setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "t") return toggleTheme();
  if ($("view-reader").hidden) return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goTo(pos + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") goTo(pos - 1);
  else if (e.key === "Home") goTo(0);
  else if (e.key === "End") goTo(count - 1);
  else if (e.key === "f") $("r-full").click();
  else if (e.key === "n" && current?.kind === "pdf") $("r-night").click();
  else if (e.key === "+" || e.key === "=") changeSize(1);
  else if (e.key === "-") changeSize(-1);
  else if (e.key === "Escape" && !document.fullscreenElement) location.hash = "";
});
let touchX = null;
$("stage").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
$("stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) goTo(pos + (dx < 0 ? 1 : -1));
});
function relayout() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (current && !$("view-reader").hidden) layout(count > 1 ? pos / (count - 1) : 0);
  }, 200);
}
addEventListener("resize", relayout);
document.addEventListener("fullscreenchange", relayout);

/* ---------- routing ---------- */
async function route() {
  const h = location.hash.slice(1);
  if (h.startsWith("read=")) return openBook(decodeURIComponent(h.slice(5)));
  closeBook();
  renderLibrary();
}
addEventListener("hashchange", route);
$("brand").onclick = (e) => { e.preventDefault(); if (location.hash) location.hash = ""; else renderLibrary(); };
loadHosted().then(route);
