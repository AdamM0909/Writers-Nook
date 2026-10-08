/* Read aloud with the device's own voices (Web Speech). Turns the pages as it goes.
   Phones are fussy about speech, so this checks that a voice really starts, and says so plainly when it can't. */
import { $, pref, toast } from "./dom.js";
import { R, goTo, pageToPos, pagesShown } from "./reader.js";
import { pageText } from "./pdf.js";

export const supported = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let playing = false, paused = false, token = 0, auto = false;
let rate = +pref.get("rate", 1);
export const isSpeaking = () => playing;
const START_TIMEOUT = 4000;      // a voice that hasn't begun after this long is not going to

/* ---------- voices ---------- */
const voices = () => { try { return speechSynthesis.getVoices() || []; } catch { return []; } };
export function listVoices() {
  const en = (v) => (/^en/i.test(v.lang) ? 0 : 1);
  return [...voices()].sort((a, b) => en(a) - en(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}
export const savedVoice = () => pref.get("voice", "");
export const setVoice = (uri) => pref.set("voice", uri);
/* the chosen voice, or an English one: asking only for lang "en" fails on some phones */
function chooseVoice() {
  const all = voices(), saved = savedVoice();
  return all.find((v) => v.voiceURI === saved) || all.find((v) => v.default && /^en/i.test(v.lang)) || all.find((v) => /^en/i.test(v.lang)) || null;
}

/* ---------- speaking ---------- */
function chunks(text) {                       // short pieces, so voices don't stall on long paragraphs
  const out = [];
  for (const s of text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || []) {
    const last = out[out.length - 1];
    if (last && last.length + s.length < 180) out[out.length - 1] += s; else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
/* Resolves "ok" when the sentence has been spoken, "cancelled" if we stopped it ourselves,
   or { error } if the device could not speak it (so the caller can stop instead of racing on in silence). */
function say(text) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    const v = chooseVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-US";
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(dog); resolve(r); };
    const dog = setTimeout(() => { if (speechSynthesis.speaking) return; finish({ error: "no-start" }); }, START_TIMEOUT);
    u.onstart = () => clearTimeout(dog);
    u.onend = () => finish("ok");
    u.onerror = (e) => finish(e.error === "interrupted" || e.error === "canceled" ? "cancelled" : { error: e.error || "failed" });
    try { speechSynthesis.speak(u); } catch { finish({ error: "failed" }); }
  });
}
function explain(error) {
  if (error === "not-allowed") return "Your browser blocked the voice. Tap Read aloud again, and check the phone isn't on silent.";
  if (error === "network") return "This voice needs an internet connection.";
  return "This device didn't start a voice. Check the volume, and that a text-to-speech voice is installed (Android: Settings, System, Languages, Text-to-speech. iPhone: Settings, Accessibility, Spoken Content).";
}
/* goTo announces the new page synchronously, so the flag only needs to cover that instant. */
const nav = async (pos) => { auto = true; const done = goTo(pos); auto = false; await done; };

export async function start() {
  if (!supported()) return toast("This browser can't read aloud.");
  if (!R.current || playing) return;
  playing = true; paused = false;
  const my = ++token;
  show();
  // Phones only allow speech that begins inside your tap, so wake the voice right now, before anything else is awaited.
  try {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const wake = new SpeechSynthesisUtterance("");
    wake.volume = 0;
    speechSynthesis.speak(wake);
  } catch { /* the first real sentence will report any problem */ }
  const live = () => my === token && playing;
  const failed = (r) => { if (live()) { stop(); toast(explain(r.error)); } };
  if (R.current.kind === "pdf") {
    const doc = R.pdfDoc;
    let n = pagesShown()[0];
    while (live() && n <= doc.numPages) {
      if (pageToPos(n) !== R.pos) await nav(pageToPos(n));
      const text = await pageText(doc, n);
      for (const c of chunks(text)) {
        if (!live()) break;
        const r = await say(c);
        if (r !== "ok") { if (r !== "cancelled") failed(r); return; }
      }
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
      for (const c of chunks(el.textContent)) {
        if (!live()) break;
        const r = await say(c);
        if (r !== "ok") { el.classList.remove("speaking"); if (r !== "cancelled") failed(r); return; }
      }
      el.classList.remove("speaking");
    }
    R.blocks.forEach((el) => el.classList.remove("speaking"));
  }
  if (my === token) stop();
}
export function stop() {
  token++; playing = false; paused = false;
  if (supported()) { try { speechSynthesis.cancel(); } catch { /* nothing to cancel */ } }
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
R.hooks.pos.push((old, byReader) => { if (playing && !auto && byReader) stop(); });      // turning pages yourself ends it (re-flowing the text does not)
R.hooks.close.push(stop);
