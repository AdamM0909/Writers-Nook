/* Reading time, streaks and books finished. Counted while the reader is open and you are actually reading
   (the tab is visible and you've touched it in the last two minutes). Stays in this browser. */
import { pref } from "./dom.js";

const KEY = "stats";
const load = () => pref.getJSON(KEY, { days: {}, finished: [] });
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let timer = null, lastActive = 0;

export function touch() { lastActive = Date.now(); }
export function start() {
  stop();
  touch();
  timer = setInterval(() => {
    if (document.visibilityState !== "visible" || Date.now() - lastActive > 120000) return;
    const s = load();
    const k = dayKey();
    s.days[k] = Math.round(((s.days[k] || 0) + 10 / 60) * 100) / 100;
    pref.setJSON(KEY, s);
  }, 10000);
}
export function stop() { clearInterval(timer); timer = null; }
export function noteFinished(title) {
  const s = load();
  s.finished.push({ t: Date.now(), title });
  pref.setJSON(KEY, s);
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, touch, { passive: true });

export function summary(now = new Date()) {
  const s = load();
  const mins = (d) => s.days[dayKey(d)] || 0;
  const back = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  let streak = 0;
  for (let i = mins(back(0)) >= 1 ? 0 : 1; mins(back(i)) >= 1; i++) streak++;
  let best = 0, run = 0;
  for (const k of Object.keys(s.days).sort()) {
    const d = new Date(k + "T00:00:00");
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    run = s.days[k] >= 1 ? (s.days[dayKey(prev)] >= 1 ? run + 1 : 1) : 0;
    best = Math.max(best, run);
  }
  const last14 = Array.from({ length: 14 }, (_, i) => ({ day: back(13 - i), min: mins(back(13 - i)) }));
  const week = last14.slice(7).reduce((n, d) => n + d.min, 0);
  return {
    streak, best, today: mins(back(0)), week, last14,
    total: Object.values(s.days).reduce((n, m) => n + m, 0),
    finished: s.finished.length, finishedList: s.finished.slice(-5).reverse(),
  };
}
