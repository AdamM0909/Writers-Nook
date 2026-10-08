/* Reading and appearance settings, kept in this browser. */
import { pref, motion } from "./dom.js";

/* ---------- theme: auto (follows the device), light, dark or sepia ---------- */
export const themeChoice = () => pref.get("theme", "auto");
const systemDark = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme() {
  const c = themeChoice();
  const theme = c === "auto" || !["light", "dark", "sepia"].includes(c) ? (systemDark.matches ? "dark" : "light") : c;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = { dark: "#0a0a0b", light: "#ffffff", sepia: "#f4ecd8" }[theme];
  return theme;
}
export function setTheme(c) { pref.set("theme", c); applyTheme(); }
/* The quick button flips between light and dark. */
export function toggleTheme() { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); }
systemDark.addEventListener?.("change", () => themeChoice() === "auto" && applyTheme());

/* ---------- animation ---------- */
const systemReduce = matchMedia("(prefers-reduced-motion: reduce)");
export const motionChoice = () => pref.get("motion", "auto");
export function applyMotion() {
  motion.reduce = motionChoice() === "reduce" || (motionChoice() === "auto" && systemReduce.matches);
  document.documentElement.classList.toggle("reduce-motion", motion.reduce);
}
export function setMotion(c) { pref.set("motion", c); applyMotion(); }
systemReduce.addEventListener?.("change", applyMotion);
applyMotion();

/* ---------- text books: font, size, spacing, margins ---------- */
export const textPrefs = {
  font: pref.get("font", "serif"),                 // serif | sans | readable
  size: +pref.get("fs", 19),
  lh: +pref.get("lh", 1.65),
  margin: pref.get("margin", "normal"),            // narrow | normal | wide
  justify: pref.get("justify", "1") === "1",
};
export function setTextPref(key, value) {
  textPrefs[key] = value;
  pref.set(key === "size" ? "fs" : key, key === "justify" ? (value ? "1" : "0") : String(value));
}
