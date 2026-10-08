/* The reader's "Aa" settings and "More" menu, the sleep timer, share links and the shortcuts list. */
import { $, h, sheet, toast, fmtBytes } from "./dom.js";
import { R, reflow, toggleNight, toggleFullscreen, toggleFocus, isOpen } from "./reader.js";
import { textPrefs, setTextPref, themeChoice, setTheme, motionChoice, setMotion } from "./prefs.js";
import { makeBookmark } from "./marks.js";
import * as tts from "./tts.js";
import { isSaved, saveOffline, forgetOffline } from "./pwa.js";

/* a row of choices: seg([["a", "Label"], …], current, pick) */
export function seg(options, current, pick, label) {
  const row = h("div", { class: "seg", role: "group", "aria-label": label });
  const paint = (cur) => row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === String(cur)));
  for (const [v, text] of options) row.append(h("button", { type: "button", "data-v": String(v), onclick: () => { paint(v); pick(v); } }, text));
  paint(current);
  return row;
}
const field = (label, control) => h("div", { class: "field" }, h("div", { class: "field-label", text: label }), control);

/* Change a text setting and re-flow the book, keeping the reader's place in the words. */
const reflowText = () => { if (R.current && R.current.kind !== "pdf") reflow(); };

/* ---------- Aa ---------- */
export function openAppearance() {
  const b = R.current;
  const body = h("div", { class: "settings" });
  body.append(field("Theme", seg([["auto", "Auto"], ["light", "Light"], ["dark", "Dark"], ["sepia", "Sepia"]], themeChoice(), setTheme, "Theme")));
  if (b?.kind === "pdf") {
    body.append(field("Page colours", h("button", { class: "btn ghost toggle", "aria-pressed": $("book").classList.contains("night"), onclick: (e) => { toggleNight(); e.currentTarget.setAttribute("aria-pressed", $("book").classList.contains("night")); } }, "Night pages")));
  } else if (b) {
    const size = h("span", { class: "size-val", text: textPrefs.size + " px" });
    const bump = (d) => { setTextPref("size", Math.max(14, Math.min(30, textPrefs.size + d))); size.textContent = textPrefs.size + " px"; reflowText(); };
    body.append(
      field("Font", seg([["serif", "Serif"], ["sans", "Sans"], ["readable", "Easy to read"]], textPrefs.font, (v) => { setTextPref("font", v); reflowText(); }, "Font")),
      field("Text size", h("div", { class: "stepper" }, h("button", { class: "btn ghost", "aria-label": "Smaller text", onclick: () => bump(-1) }, "A−"), size, h("button", { class: "btn ghost", "aria-label": "Larger text", onclick: () => bump(1) }, "A+"))),
      field("Line spacing", seg([[1.45, "Tight"], [1.65, "Normal"], [1.9, "Roomy"]], textPrefs.lh, (v) => { setTextPref("lh", +v); reflowText(); }, "Line spacing")),
      field("Margins", seg([["narrow", "Narrow"], ["normal", "Normal"], ["wide", "Wide"]], textPrefs.margin, (v) => { setTextPref("margin", v); reflowText(); }, "Margins")),
      field("Alignment", seg([["1", "Justified"], ["0", "Left"]], textPrefs.justify ? "1" : "0", (v) => { setTextPref("justify", v === "1"); reflowText(); }, "Alignment")));
  }
  if (tts.supported()) {
    const sel = h("select", { class: "text-in", "aria-label": "Read-aloud voice" });
    const fillVoices = () => {
      const vs = tts.listVoices();
      sel.replaceChildren(h("option", { value: "" }, vs.length ? "Automatic (an English voice)" : "No voices found on this device"));
      for (const v of vs) sel.append(h("option", { value: v.voiceURI }, tts.labelFor(v)));
      sel.value = vs.some((v) => v.voiceURI === tts.savedVoice()) ? tts.savedVoice() : "";
    };
    fillVoices();
    speechSynthesis.addEventListener?.("voiceschanged", fillVoices);       // phones load their voices a moment late
    sel.addEventListener("change", () => tts.setVoice(sel.value));
    body.append(field("Read-aloud voice", h("div", {},
      sel,
      h("div", { class: "row-inline" }, h("button", { class: "btn ghost", type: "button", onclick: () => tts.preview() }, "Hear a sample")),
      h("p", { class: "panel-note voice-help", text: "★ marks the voices most likely to sound smooth and warm. For a more natural voice, download an Enhanced or Premium one in your phone's settings, and it will appear here. iPhone: Settings, Accessibility, Spoken Content, Voices. Android: Settings, System, Languages, Text-to-speech output." }))));
  }
  body.append(
    field("Page animation", seg([["auto", "Automatic"], ["reduce", "Calm (none)"]], motionChoice(), setMotion, "Page animation")),
    field("Sleep timer", seg([[0, "Off"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "60 min"]], sleepMin, setSleep, "Sleep timer")));
  sheet({ title: "Reading settings", body });
}
export const changeSize = (d) => { setTextPref("size", Math.max(14, Math.min(30, textPrefs.size + d))); reflowText(); };

/* ---------- sleep timer ---------- */
let sleepMin = 0, sleepTimer = null, sleepEnd = 0, sleepTick = null;
export function setSleep(min) {
  clearTimeout(sleepTimer); clearInterval(sleepTick);
  sleepMin = +min;
  if (!sleepMin) { $("r-sleep").textContent = ""; return; }
  sleepEnd = Date.now() + sleepMin * 60000;
  sleepTimer = setTimeout(timesUp, sleepMin * 60000);
  const label = () => { $("r-sleep").textContent = `Sleep in ${Math.max(1, Math.ceil((sleepEnd - Date.now()) / 60000))} min`; };
  label(); sleepTick = setInterval(label, 20000);
  toast(`Sleep timer set for ${sleepMin} minutes.`);
}
function timesUp() {
  sleepMin = 0; $("r-sleep").textContent = ""; clearInterval(sleepTick);
  tts.stop();
  if (!isOpen()) return;
  sheet({ title: "Time to rest", body: h("div", {},
    h("p", { text: "Your sleep timer has finished. Your place is saved." }),
    h("div", { class: "sheet-actions" },
      h("button", { class: "btn primary", onclick: (e) => { e.target.closest("dialog").close(); location.hash = ""; } }, "Close the book"),
      h("button", { class: "btn ghost", onclick: (e) => { e.target.closest("dialog").close(); setSleep(15); } }, "15 more minutes"),
      h("button", { class: "btn ghost", onclick: (e) => e.target.closest("dialog").close() }, "Keep reading"))) });
}
R.hooks.close.push(() => { clearTimeout(sleepTimer); clearInterval(sleepTick); sleepMin = 0; $("r-sleep").textContent = ""; });

/* ---------- share a place ---------- */
export async function shareHere() {
  const b = R.current;
  if (!b) return;
  if (!b.hosted) return toast("Private files can't be shared. Publish the book and share that.");
  const a = makeBookmark();
  const params = a.page ? `&p=${a.page}` : a.block != null ? `&b=${a.block}&o=${(a.off || 0).toFixed(3)}` : "";
  const url = `${location.origin}${location.pathname}#read=${encodeURIComponent(b.id)}${params}`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title: b.title, url }); return; }
    await navigator.clipboard.writeText(url);
    toast("Link copied. It opens this book at this place.");
  } catch (e) { if (e?.name !== "AbortError") toast("Couldn't copy the link."); }
}

/* ---------- More ---------- */
export async function openMore() {
  const b = R.current;
  if (!b) return;
  const list = h("div", { class: "menu" });
  const item = (label, sub, fn) => { const btn = h("button", { class: "menu-item", type: "button", onclick: () => { s.close(); fn(); } }, h("span", { text: label }), sub && h("small", { text: sub })); list.append(btn); return btn; };
  item(tts.isSpeaking() ? "Stop reading aloud" : "Read aloud", tts.supported() ? "Uses your device's voice. Turns the pages as it goes." : "Not available in this browser.", tts.toggle);
  item("Focus mode", "Hides the bars. Tap the middle of the page to bring them back.", toggleFocus);
  item("Fullscreen", null, toggleFullscreen);
  item("Share a link to this place", b.hosted ? "Copies a link that opens this book here." : "Only published books can be shared.", shareHere);
  const saveBtn = b.hosted ? item("Save for offline", "Keep this book on your device.", () => {}) : null;
  if (saveBtn) {
    const urls = [b.url, ...(b.cover && !b.cover.startsWith("data:") ? [b.cover] : [])];
    const saved = await isSaved(b.url);
    saveBtn.firstChild.textContent = saved ? "Saved for offline ✓" : "Save for offline";
    saveBtn.lastChild.textContent = saved ? "Tap to remove it from this device." : "Keep this book on your device (" + (b.size ? fmtBytes(b.size) : "small") + ").";
    saveBtn.onclick = async () => {
      s.close();
      try {
        if (saved) { await forgetOffline(urls); toast("Removed from offline storage."); }
        else { await saveOffline(urls); toast("Saved. This book now opens without a connection."); }
      } catch { toast("Couldn't save it. Are you online?"); }
    };
  }
  item("Download", "Get the original file.", download);
  item("Keyboard shortcuts", null, showShortcuts);
  const s = sheet({ title: "More", body: list });
}
export function download() {
  const b = R.current;
  if (!b) return;
  const ext = b.kind === "pdf" ? ".pdf" : b.kind === "epub" ? ".epub" : b.md ? ".md" : ".txt";
  const a = document.createElement("a");
  if (b.hosted) a.href = b.url;
  else a.href = URL.createObjectURL(b.kind === "text" ? new Blob([b.text], { type: "text/plain" }) : b.data);
  a.download = b.title + ext;
  a.click();
  if (!b.hosted) setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- shortcuts ---------- */
const KEYS = [
  ["← → / Space", "Turn the page"], ["Home / End", "First or last page"], ["C", "Contents, saved places"], ["/", "Search in the book"],
  ["B", "Bookmark this page"], ["R", "Read aloud"], ["Z", "Focus mode (hide the bars)"], ["F", "Fullscreen"],
  ["T", "Light / dark"], ["N", "Night pages (PDF)"], ["+ / −", "Text size (text books)"], ["?", "This list"], ["Esc", "Close, or go back to the library"],
];
export function showShortcuts() {
  sheet({ title: "Keyboard shortcuts", body: h("dl", { class: "keys" }, KEYS.flatMap(([k, d]) => [h("dt", {}, h("kbd", { text: k })), h("dd", { text: d })])) });
}

$("r-aa").onclick = openAppearance;
$("r-more").onclick = openMore;
