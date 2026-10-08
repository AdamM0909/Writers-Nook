/* Read aloud with the device's own voices (Web Speech). Turns the pages as it goes. */
import { $, pref, toast } from "./dom.js";
import { R, goTo, pageToPos, pagesShown } from "./reader.js";
import { pageText } from "./pdf.js";

export const supported = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let playing = false, paused = false, token = 0, auto = false;
let rate = +pref.get("rate", 1);
export const isSpeaking = () => playing;

function chunks(text) {                       // short pieces, so voices don't stall on long paragraphs
  const out = [];
  for (const s of text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || []) {
    const last = out[out.length - 1];
    if (last && last.length + s.length < 180) out[out.length - 1] += s; else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
function say(text) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.lang = document.documentElement.lang || "en";
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
/* goTo announces the new page synchronously, so the flag only needs to cover that instant. */
const nav = async (pos) => { auto = true; const done = goTo(pos); auto = false; await done; };

export async function start() {
  if (!supported()) return toast("This browser can't read aloud.");
  if (!R.current || playing) return;
  playing = true; paused = false;
  const my = ++token;
  show();
  speechSynthesis.cancel();
  const live = () => my === token && playing;
  if (R.current.kind === "pdf") {
    const doc = R.pdfDoc;
    let n = pagesShown()[0];
    while (live() && n <= doc.numPages) {
      if (pageToPos(n) !== R.pos) await nav(pageToPos(n));
      const text = await pageText(doc, n);
      for (const c of chunks(text)) { if (!live()) break; await say(c); }
      n++;
    }
  } else {
    // begin at the first paragraph that starts on this spread, or the one running across it
    let i = R.blockSpread.findIndex((s) => s === R.pos);
    if (i < 0) i = Math.max(0, R.blockSpread.findLastIndex((s) => s <= R.pos));
    for (; live() && i < R.blocks.length; i++) {
      if (R.blockSpread[i] > R.pos) await nav(R.blockSpread[i]);
      const el = R.blocks[i];
      el.classList.add("speaking");
      for (const c of chunks(el.textContent)) { if (!live()) break; await say(c); }
      el.classList.remove("speaking");
    }
    R.blocks.forEach((el) => el.classList.remove("speaking"));
  }
  if (my === token) stop();
}
export function stop() {
  token++; playing = false; paused = false;
  if (supported()) speechSynthesis.cancel();
  R.blocks.forEach((el) => el.classList?.remove("speaking"));
  show();
}
export function toggle() { if (playing) stop(); else start(); }
export function pauseResume() {
  if (!playing) return;
  paused = !paused;
  if (paused) speechSynthesis.pause(); else speechSynthesis.resume();
  show();
}
export function setRate(r) { rate = r; pref.set("rate", String(r)); }   // takes effect from the next sentence

function show() {
  const bar = $("tts-bar");
  bar.hidden = !playing;
  $("tts-pause").textContent = paused ? "▶" : "⏸";
  $("tts-pause").setAttribute("aria-label", paused ? "Resume reading aloud" : "Pause reading aloud");
  $("tts-rate").value = String(rate);
}
$("tts-pause").onclick = pauseResume;
$("tts-stop").onclick = stop;
$("tts-rate").onchange = (e) => setRate(+e.target.value);
R.hooks.pos.push(() => { if (playing && !auto) stop(); });      // turning pages yourself ends it
R.hooks.close.push(stop);
