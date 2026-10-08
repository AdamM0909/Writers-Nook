/* Read aloud, with either the natural voice downloaded to this device or the device's own voices (Web Speech).
   Turns the pages as it goes.
   Phones are fussy about speech, so this checks that a voice really starts, and says so plainly when it can't. */
import { $, pref, toast } from "./dom.js";
import { R, goTo, pageToPos, pagesShown } from "./reader.js";
import { pageText } from "./pdf.js";
import { bestVoice, rankVoices, isEnglish, voiceLabel } from "./voices.js";
import * as natural from "./natural.js";

export const NATURAL = "@natural", DEVICE = "@device";    // saved "voice" values: the downloaded natural voice / the device's best voice (nothing saved: natural if it's downloaded)
export const deviceSupported = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
export const supported = () => deviceSupported() || natural.available();
let naturalReady = false, naturalBroken = false;          // downloaded and usable / failed once this visit
natural.isInstalled().then((ok) => { naturalReady = ok; });
export const markNatural = (ok) => { naturalReady = ok; naturalBroken = false; };
export const useNatural = () => naturalReady && !naturalBroken && natural.available() && ["", NATURAL].includes(pref.get("voice", ""));
let playing = false, paused = false, token = 0, auto = false;
let rate = +pref.get("rate", 0.9);          // a little slower than the default: calmer, easier to follow
export const isSpeaking = () => playing;
const START_TIMEOUT = 4000;      // a voice that hasn't begun after this long is not going to

/* ---------- voices ---------- */
const voices = () => { if (!deviceSupported()) return []; try { return speechSynthesis.getVoices() || []; } catch { return []; } };
export function listVoices() {
  const all = voices();
  return [...rankVoices(all.filter(isEnglish)), ...all.filter((v) => !isEnglish(v)).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))];
}
export const labelFor = (v) => voiceLabel(v, voices());
export const savedVoice = () => pref.get("voice", "");
export const setVoice = (uri) => pref.set("voice", uri);
/* the chosen voice, or the smoothest English one the device has: asking only for lang "en" fails on some phones */
function chooseVoice() {
  const all = voices(), saved = savedVoice();
  return all.find((v) => v.voiceURI === saved) || bestVoice(all) || null;
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));     // a breath between paragraphs and pages

/* ---------- the natural voice ---------- */
let ctx = null, current = null, ahead = new Map();
const audioCtx = () => {                      // made inside your tap, so the browser lets it play
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); }
  if (ctx.state === "suspended" && !paused) ctx.resume();
  return ctx;
};
const prepare = (text) => {                    // start making a sentence now; the answer is kept for when it's needed
  const key = rate + "|" + text;
  if (!ahead.has(key)) { const p = natural.synthesize(text, rate); p.catch(() => {}); ahead.set(key, p); }
  return ahead.get(key);
};
function playSamples({ samples, rate: sr }) {
  return new Promise((resolve) => {
    const c = audioCtx();
    const buf = c.createBuffer(1, Math.max(1, samples.length), sr);
    const data = buf.getChannelData(0);
    data.set(samples);
    const f = Math.min(320, samples.length >> 1);                       // a tiny fade at each end avoids clicks
    for (let i = 0; i < f; i++) { data[i] *= i / f; data[samples.length - 1 - i] *= i / f; }
    const src = c.createBufferSource();
    src.buffer = buf; src.connect(c.destination);
    const me = { src, resolve };
    current = me;
    src.onended = () => { if (current === me) current = null; resolve("ok"); };
    src.start();
  });
}
function stopSound() {
  const c = current; current = null;
  if (c) { c.src.onended = null; try { c.src.stop(); } catch { /* already finished */ } c.resolve("cancelled"); }
}
/* Fall back to the device's voice if the natural one ever fails, and say so. */
function giveUpOnNatural(err) {
  naturalBroken = true; ahead.clear();
  toast(deviceSupported() ? "The natural voice had a problem, so I've switched to your device's voice for now." : "The natural voice couldn't run on this device.");
  return err;
}
async function sayNatural(text, hint) {
  if (!/[\p{L}\p{N}]/u.test(text)) return "ok";                       // nothing speakable (just punctuation)
  const mine = token;
  try {
    const audio = await prepare(text);
    if (mine !== token) return "cancelled";
    if (hint && /[\p{L}\p{N}]/u.test(hint)) prepare(hint);                // get the next sentence ready while this one plays
    ahead.delete(rate + "|" + text);
    return await playSamples(audio);
  } catch (e) {
    if (mine !== token) return "cancelled";
    giveUpOnNatural(e);
    return { error: "natural" };
  }
}

/* ---------- speaking ---------- */
function chunks(text) {                       // short pieces, so voices don't stall on long paragraphs
  const out = [];
  const pieces = [];
  for (let s of text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || []) {
    while (s.length > 220) {                    // a very long sentence: break it at a comma, or else a space
      let cut = Math.max(s.lastIndexOf(", ", 200), s.lastIndexOf("; ", 200), s.lastIndexOf(": ", 200)) + 1;
      if (cut < 60) cut = s.lastIndexOf(" ", 200) + 1;
      if (cut < 60) cut = 200;
      pieces.push(s.slice(0, cut)); s = s.slice(cut);
    }
    pieces.push(s);
  }
  for (const s of pieces) {
    const last = out[out.length - 1];
    if (last && last.length + s.length < 180) out[out.length - 1] += s; else out.push(s);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
/* Resolves "ok" when the sentence has been spoken, "cancelled" if we stopped it ourselves,
   or { error } if the device could not speak it (so the caller can stop instead of racing on in silence). */
function say(text, hint) {
  if (useNatural()) return sayNatural(text, hint).then((r) => (r && r.error === "natural" && deviceSupported() ? say(text) : r));
  if (!deviceSupported()) return Promise.resolve({ error: "failed" });
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
  if (error === "natural") return "The natural voice couldn't run on this device.";
  if (error === "not-allowed") return "Your browser blocked the voice. Tap Read aloud again, and check the phone isn't on silent.";
  if (error === "network") return "This voice needs an internet connection.";
  return "This device didn't start a voice. Check the volume, and that a text-to-speech voice is installed (Android: Settings, System, Languages, Text-to-speech. iPhone: Settings, Accessibility, Spoken Content).";
}
/* goTo announces the new page synchronously, so the flag only needs to cover that instant. */
const nav = async (pos) => { auto = true; const done = goTo(pos); auto = false; await done; };

export async function start() {
  if (!supported()) return toast("This browser can't read aloud.");
  if (!R.current || playing) return;
  if (!deviceSupported() && !useNatural()) {          // no device voice here: the natural voice is the way
    return toast("This browser has no built-in voice. Download the natural voice in Aa settings to read aloud.", { action: { label: "Open", run: () => import("./settings.js").then((m) => m.openAppearance()) } });
  }
  playing = true; paused = false;
  const my = ++token;
  show();
  // Phones only allow speech that begins inside your tap, so wake the voice right now, before anything else is awaited.
  const nat = useNatural();
  if (!nat && !naturalReady && natural.available() && !pref.get("voice-offered", "")) {      // once: mention the smoother voice
    pref.set("voice-offered", "1");
    toast("A smoother, warmer voice is available.", { action: { label: "Get it", run: () => import("./settings.js").then((m) => m.openAppearance()) } });
  }
  if (nat) { audioCtx(); natural.warmUp().catch(() => {}); if (!ahead.size) toast("Getting the natural voice ready…"); }
  else try {
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
      const cs = chunks(text);
      for (const [j, c] of cs.entries()) {
        if (!live()) break;
        const r = await say(c, cs[j + 1]);
        if (r !== "ok") { if (r !== "cancelled") failed(r); return; }
      }
      if (live()) await pause(300);
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
      const cs = chunks(el.textContent);
      for (const [j, c] of cs.entries()) {
        if (!live()) break;
        const r = await say(c, cs[j + 1] ?? (R.blocks[i + 1] ? chunks(R.blocks[i + 1].textContent)[0] : undefined));
        if (r !== "ok") { el.classList.remove("speaking"); if (r !== "cancelled") failed(r); return; }
      }
      el.classList.remove("speaking");
      if (live()) await pause(/^H[2-4]$/.test(el.tagName) ? 600 : 350);       // a longer breath after a heading
    }
    R.blocks.forEach((el) => el.classList.remove("speaking"));
  }
  if (my === token) stop();
}
export function stop() {
  token++; playing = false; paused = false;
  stopSound(); ahead.clear();
  if (ctx?.state === "suspended") ctx.resume();
  if (deviceSupported()) { try { speechSynthesis.cancel(); } catch { /* nothing to cancel */ } }
  R.blocks.forEach((el) => el.classList?.remove("speaking"));
  show();
}
export function toggle() { if (playing) stop(); else start(); }
export function pauseResume() {
  if (!playing) return;
  paused = !paused;
  if (current || useNatural()) { if (paused) ctx?.suspend(); else ctx?.resume(); }
  else if (paused) speechSynthesis.pause(); else speechSynthesis.resume();
  show();
}
/* Hear the chosen voice on a short sample (called from a tap, so phones allow it). */
export async function preview() {
  if (!supported()) return toast("This browser can't read aloud.");
  if (playing) stop();
  token++; stopSound();
  if (!useNatural()) { try { speechSynthesis.cancel(); } catch { /* nothing playing */ } }
  else { audioCtx(); if (!ahead.size) toast("Getting the natural voice ready…"); }
  const r = await say("Hello. Let's read something lovely together.");
  if (r !== "ok" && r !== "cancelled") toast(explain(r.error));
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
