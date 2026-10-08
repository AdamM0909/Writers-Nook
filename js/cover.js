/* A black-and-gold cover drawn for books that don't have one (text books, EPUBs without a cover image). */
let fontsReady = null;
export async function makeCover(title, author) {
  fontsReady ||= Promise.all([document.fonts.load('600 40px "Cormorant Garamond"'), document.fonts.load('italic 500 26px "Cormorant Garamond"')]).catch(() => {});
  await fontsReady;
  const W = 360, H = 540;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2b271c"); bg.addColorStop(1, "#0d0c09");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#c9a24b"; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  g.strokeStyle = "rgba(201,162,75,.6)"; g.lineWidth = 1; g.strokeRect(14, 14, W - 28, H - 28);
  // a small vine across the top and bottom
  g.strokeStyle = "#c9a24b"; g.lineWidth = 1.4; g.lineCap = "round";
  for (const y of [64, H - 64]) {
    g.beginPath(); g.moveTo(70, y); g.bezierCurveTo(110, y - 14, 140, y + 14, 180, y); g.bezierCurveTo(220, y - 14, 250, y + 14, 290, y); g.stroke();
    g.fillStyle = "#c9a24b"; g.beginPath(); g.arc(180, y, 3, 0, 7); g.fill();
  }
  g.textAlign = "center"; g.fillStyle = "#e9cf8d";
  let size = 44, lines = [];
  for (; size >= 22; size -= 2) {
    g.font = `600 ${size}px "Cormorant Garamond", Georgia, serif`;
    lines = wrap(g, title, W - 90);
    if (lines.length * size * 1.15 <= 250) break;
  }
  const lh = size * 1.15, y0 = H / 2 - (lines.length * lh) / 2 + size * 0.7 - 20;
  lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh));
  if (author) {
    g.fillStyle = "#c9a24b"; g.fillRect(W / 2 - 24, y0 + lines.length * lh + 6, 48, 2);
    g.font = 'italic 500 24px "Cormorant Garamond", Georgia, serif'; g.fillStyle = "#b7a77c";
    g.fillText(wrap(g, author, W - 90)[0], W / 2, y0 + lines.length * lh + 44);
  }
  return c.toDataURL("image/jpeg", 0.85);
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
