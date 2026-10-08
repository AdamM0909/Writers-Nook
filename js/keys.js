/* Keyboard shortcuts. Listed in js/settings.js (the "?" sheet). */
import { $ } from "./dom.js";
import { toggleTheme } from "./prefs.js";
import { R, isOpen, goTo, toggleFullscreen, toggleFocus, setFocus, toggleNight } from "./reader.js";
import { toggleMark } from "./marks.js";
import { panelOpen, openPanel } from "./panel.js";
import { changeSize, showShortcuts } from "./settings.js";
import * as tts from "./tts.js";

addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.matches?.("input, select, textarea, [contenteditable]")) return;
  if (document.querySelector("dialog[open]")) return;             // sheets handle their own keys
  const k = e.key;
  if (k === "t") return toggleTheme();
  if (k === "?") return showShortcuts();
  if (!isOpen()) { if (k === "/") { e.preventDefault(); $("search").focus(); } return; }
  if (panelOpen()) return;
  if (k === " " && e.target.closest?.("button, a, input, select, summary, [role=button], [role=tab]")) return;   // Space presses a focused control
  const kind = R.current.kind;
  if (k === "ArrowRight" || k === "PageDown" || k === " ") { e.preventDefault(); goTo(R.pos + 1); }
  else if (k === "ArrowLeft" || k === "PageUp") goTo(R.pos - 1);
  else if (k === "Home") goTo(0);
  else if (k === "End") goTo(R.count - 1);
  else if (k === "f") toggleFullscreen();
  else if (k === "z") toggleFocus();
  else if (k === "b") toggleMark();
  else if (k === "c") openPanel("toc");
  else if (k === "/") { e.preventDefault(); openPanel("search"); }
  else if (k === "r") tts.toggle();
  else if (k === "n" && kind === "pdf") toggleNight();
  else if ((k === "+" || k === "=") && kind !== "pdf") changeSize(1);
  else if (k === "-" && kind !== "pdf") changeSize(-1);
  else if (k === "Escape" && !document.fullscreenElement) { if (R.focus) setFocus(false); else location.hash = ""; }
});
