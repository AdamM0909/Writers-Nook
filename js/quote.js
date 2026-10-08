/* Quote cards: turn a passage into a black-and-gold picture to save or share. */
import { h, sheet, toast } from "./dom.js";
import { R } from "./reader.js";

const W = 1080, H = 1350;
export async function drawQuote(text, title, author) {
  await Promise.all([document.fonts.load('italic 500 64px "Cormorant Garamond"'), document.fonts.load('600 40px "Cormorant Garamond"'), document.fonts.load('400 30px "EB Garamond"')]).catch(() => {});
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1d1a12"); bg.addColorStop(1, "#080807");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#c9a24b"; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80);
  g.strokeStyle = "rgba(201,162,75,.45)"; g.lineWidth = 1.5; g.strokeRect(58, 58, W - 116, H - 116);
  g.fillStyle = "#c9a24b"; g.textAlign = "center";
  g.font = '600 220px "Cormorant Garamond", Georgia, serif';
  g.fillText("“", W / 2, 330);

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 420) text = text.slice(0, 417).trimEnd() + "…";
  const maxW = W - 240, top = 380, bottom = H - 300;
  let size = 76, lines = [];
  for (; size >= 34; size -= 2) {
    g.font = `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`;
    lines = wrap(g, text, maxW);
    if (lines.length * size * 1.28 <= bottom - top) break;
  }
  g.fillStyle = "#efe6cf"; g.textBaseline = "alphabetic";
  const lh = size * 1.28, startY = top + Math.max(0, (bottom - top - lines.length * lh) / 2) + size * 0.85;
  lines.forEach((l, i) => g.fillText(l, W / 2, startY + i * lh));

  g.fillStyle = "#c9a24b"; g.fillRect(W / 2 - 60, H - 270, 120, 3);
  g.font = '600 44px "Cormorant Garamond", Georgia, serif'; g.fillStyle = "#e9cf8d";
  g.fillText(clip(g, title || "", W - 240), W / 2, H - 200);
  if (author) { g.font = 'italic 500 34px "Cormorant Garamond", Georgia, serif'; g.fillStyle = "#b7a77c"; g.fillText(clip(g, author, W - 240), W / 2, H - 148); }
  g.font = '400 24px "EB Garamond", Georgia, serif'; g.fillStyle = "rgba(201,162,75,.7)";
  g.fillText("WRITER’S NOOK", W / 2, H - 92);
  return c;
}
function wrap(g, text, maxW) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function clip(g, s, maxW) { while (g.measureText(s).width > maxW && s.length > 4) s = s.slice(0, -2); return s; }

export async function openQuote(text) {
  const b = R.current;
  const canvas = await drawQuote(text, b?.title, b?.author);
  canvas.className = "quote-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Quote card preview");
  const blob = () => new Promise((res) => canvas.toBlob(res, "image/png"));
  const name = (b?.title || "quote").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + "-quote.png";
  const actions = h("div", { class: "sheet-actions" },
    h("button", { class: "btn primary", onclick: async () => {
      const a = h("a", { href: URL.createObjectURL(await blob()), download: name });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } }, "Save picture"));
  const probe = new File([""], "x.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [probe] })) {
    actions.append(h("button", { class: "btn ghost", onclick: async () => {
      try { await navigator.share({ files: [new File([await blob()], name, { type: "image/png" })], title: b?.title }); } catch { /* cancelled */ }
    } }, "Share"));
  }
  actions.append(h("button", { class: "btn ghost", onclick: async () => {
    try { await navigator.clipboard.writeText(`“${text.trim()}” — ${[b?.author, b?.title].filter(Boolean).join(", ")}`); toast("Quote copied."); } catch { toast("Couldn't copy."); }
  } }, "Copy text"));
  sheet({ title: "Quote card", body: h("div", { class: "quote-sheet" }, canvas, actions) });
}
