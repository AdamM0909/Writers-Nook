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
const allBooks = () => tx("readonly", (s) => s.getAll());
const getBook = (id) => tx("readonly", (s) => s.get(id));
const putBook = (b) => tx("readwrite", (s) => s.put(b));
const delBook = (id) => tx("readwrite", (s) => s.delete(id));
navigator.storage?.persist?.();

/* ---------- helpers ---------- */
const uid = () => crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}
const cleanName = (n) => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
function show(view) {
  for (const v of ["library", "reader", "editor"]) $("view-" + v).hidden = v !== view;
  document.querySelector(".vine-rule").hidden = view === "reader";
}
/* ---------- library ---------- */
async function renderLibrary() {
  show("library");
  const q = $("search").value.trim().toLowerCase();
  const books = (await allBooks())
    .filter((b) => !q || (b.title + " " + b.author).toLowerCase().includes(q))
    .sort((a, b) => b.added - a.added);
  const shelf = $("shelf");
  shelf.replaceChildren();
  $("empty").hidden = books.length > 0 || !!q;
  for (const b of books) {
    const card = document.createElement("div");
    card.className = "card";
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
    txt.append(nm, b.kind === "pdf" ? `PDF · ${b.pages || "?"} pages` : "Writing");
    const del = document.createElement("button");
    del.className = "del"; del.title = "Remove"; del.textContent = "×";
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
    card.onclick = () => (location.hash = "#read=" + b.id);
    shelf.append(card);
  }
}
$("search").addEventListener("input", renderLibrary);

/* ---------- adding files ---------- */
async function pdfCover(data) {
  const task = pdfjs.getDocument({ data: data.slice(0) });
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
        Object.assign(book, { kind: "pdf", data: new Blob([buf], { type: "application/pdf" }) }, await pdfCover(buf));
      } else {
        Object.assign(book, { kind: "text", text: await f.text() });
      }
      await putBook(book);
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

/* ---------- editor ---------- */
let editing = null;
function openEditor(book) {
  editing = book || null;
  show("editor");
  $("e-heading").textContent = book ? "Edit Writing" : "New Writing";
  $("e-title").value = book?.title || "";
  $("e-author").value = book?.author || "";
  $("e-body").value = book?.text || "";
  $("e-title").focus();
}
$("btn-write").onclick = () => (location.hash = "#write");
$("e-cancel").onclick = () => history.back();
$("e-save").onclick = async () => {
  const text = $("e-body").value;
  if (!text.trim()) return toast("Write something first.");
  const book = editing || { id: uid(), kind: "text", added: Date.now(), progress: 0 };
  book.title = $("e-title").value.trim() || "Untitled";
  book.author = $("e-author").value.trim();
  book.text = text;
  await putBook(book);
  toast("Saved.");
  location.hash = "#read=" + book.id;
};

/* ---------- reader ---------- */
let current = null, pdfDoc = null, pdfTask = null, pos = 0, count = 1, single = false, renderToken = 0, pageRatio = 0.7727, resizeTimer;
const book = $("book");

function stageSize() {
  const s = $("stage"), cs = getComputedStyle(s);
  const mobile = innerWidth <= 700;
  const navs = mobile ? 0 : 2 * 56;
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
  $("r-edit").hidden = b.kind !== "text";
  $("r-loading").hidden = false;
  document.title = b.title + " · Writer's Nook";
  try {
    if (b.kind === "pdf") {
      pdfTask = pdfjs.getDocument({ data: await b.data.arrayBuffer() });
      pdfDoc = await pdfTask.promise;
    }
  } catch (err) {
    console.error(err);
    $("r-loading").hidden = true;
    toast("This file couldn't be opened.");
    location.hash = "";
    return;
  }
  await layout(b.progress || 0);
  $("r-loading").hidden = true;
}
function closeBook() {
  renderToken++;
  pdfTask?.destroy(); pdfTask = pdfDoc = null; current = null;
  document.title = "Writer's Nook";
}

async function layout(progress) {
  if (!current) return;
  const { w, h } = stageSize();
  single = innerWidth <= 700;
  book.classList.toggle("single", single);
  const isPdf = current.kind === "pdf";
  $("spread-pdf").hidden = !isPdf;
  $("spread-text").hidden = isPdf;
  if (isPdf) {
    const first = await pdfDoc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    pageRatio = vp.width / vp.height;
    const cols = single ? 1 : 2;
    const ph = Math.max(200, Math.min(h, w / (cols * pageRatio)));
    const pw = ph * pageRatio;
    book.style.width = pw * cols + "px";
    book.style.height = ph + "px";
    for (const side of ["left", "right"]) {
      const pg = book.querySelector(".page." + side);
      pg.style.width = pw + "px"; pg.style.height = ph + "px";
    }
    count = single ? pdfDoc.numPages : Math.floor(pdfDoc.numPages / 2) + 1;
    pos = Math.round(progress * (count - 1));
  } else {
    const bw = Math.max(260, Math.min(w, 1080)), bh = Math.max(300, h);
    book.style.width = bw + "px"; book.style.height = bh + "px";
    const flow = $("text-flow");
    flow.style.columnGap = single ? "0px" : "88px";
    if (!flow.dataset.id || flow.dataset.id !== current.id) {
      flow.dataset.id = current.id;
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
    }
    await document.fonts?.ready;
    const colW = flow.clientWidth, g = single ? 0 : 88;
    const cols = single ? 1 : 2;
    const pages = Math.max(1, Math.round((flow.scrollWidth + g) / ((colW - g * (cols - 1)) / cols + g)));
    count = Math.max(1, Math.ceil(pages / cols));
    pos = Math.round(progress * (count - 1));
  }
  $("r-slider").max = count - 1;
  await goTo(pos, false);
}

async function goTo(p, save = true) {
  if (!current) return;
  pos = Math.max(0, Math.min(count - 1, p));
  const token = ++renderToken;
  $("r-prev").disabled = pos === 0;
  $("r-next").disabled = pos >= count - 1;
  $("r-slider").value = pos;
  if (current.kind === "pdf") {
    const nums = pdfPagesAt(pos);
    const total = pdfDoc.numPages;
    const shown = nums.filter((n) => n && n <= total);
    $("r-pos").textContent = single ? `Page ${shown[0]} of ${total}` : `Pages ${shown.join("–")} of ${total}`;
    const targets = single ? [["right", nums[0]]] : [["left", nums[0]], ["right", nums[1]]];
    await Promise.all(targets.map(([side, n]) => drawPage(side, n, token)));
  } else {
    const flow = $("text-flow");
    const colW = flow.clientWidth, g = single ? 0 : 88;
    flow.scrollLeft = pos * (colW + g);
    $("r-pos").textContent = `Spread ${pos + 1} of ${count}`;
  }
  if (save && token === renderToken) {
    current.progress = count > 1 ? pos / (count - 1) : 0;
    putBook(current).catch(() => {});
  }
}

async function drawPage(side, n, token) {
  const pg = book.querySelector(".page." + side);
  const cv = pg.querySelector("canvas");
  const blank = !n || n > pdfDoc.numPages;
  pg.classList.toggle("blank", blank);
  if (blank) { cv.width = cv.height = 1; return; }
  const page = await pdfDoc.getPage(n);
  if (token !== renderToken) return;
  const base = page.getViewport({ scale: 1 });
  const cssW = parseFloat(pg.style.width), dpr = Math.min(devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (cssW / base.width) * dpr });
  const off = document.createElement("canvas");
  off.width = Math.round(vp.width); off.height = Math.round(vp.height);
  await page.render({ canvasContext: off.getContext("2d"), viewport: vp, background: "#fff" }).promise;
  if (token !== renderToken) return;
  cv.width = off.width; cv.height = off.height;
  cv.style.width = cssW + "px"; cv.style.height = parseFloat(pg.style.height) + "px";
  cv.getContext("2d").drawImage(off, 0, 0);
}

$("r-prev").onclick = () => goTo(pos - 1);
$("r-next").onclick = () => goTo(pos + 1);
$("r-slider").oninput = (e) => goTo(+e.target.value);
$("r-back").onclick = () => (location.hash = "");
$("r-edit").onclick = () => (location.hash = "#edit=" + current.id);
$("r-download").onclick = () => {
  if (!current) return;
  const blob = current.kind === "pdf" ? current.data : new Blob([current.text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = current.title + (current.kind === "pdf" ? ".pdf" : ".txt");
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
addEventListener("keydown", (e) => {
  if ($("view-reader").hidden || e.target.matches("input, textarea")) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") goTo(pos + 1);
  else if (e.key === "ArrowLeft" || e.key === "PageUp") goTo(pos - 1);
  else if (e.key === "Escape") location.hash = "";
});
let touchX = null;
$("stage").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
$("stage").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) goTo(pos + (dx < 0 ? 1 : -1));
});
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (current && !$("view-reader").hidden) layout(count > 1 ? pos / (count - 1) : 0);
  }, 200);
});

/* ---------- routing ---------- */
async function route() {
  const h = location.hash.slice(1);
  if (h.startsWith("read=")) return openBook(h.slice(5));
  closeBook();
  if (h === "write") return openEditor(null);
  if (h.startsWith("edit=")) {
    const b = await getBook(h.slice(5));
    return b && b.kind === "text" ? openEditor(b) : (location.hash = "");
  }
  renderLibrary();
}
addEventListener("hashchange", route);
$("brand").onclick = (e) => { e.preventDefault(); if (location.hash) location.hash = ""; else renderLibrary(); };
route();
