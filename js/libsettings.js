/* The library's settings sheet, reading stats and shortcuts. */
import { h, sheet, toast, fmtBytes, fmtMinutes } from "./dom.js";
import { themeChoice, setTheme, motionChoice, setMotion } from "./prefs.js";
import { allBooks } from "./store.js";
import { canInstall, installApp, saveOffline, forgetOffline, isSaved, storageUsed, ready as swReady } from "./pwa.js";
import { openBackup } from "./backup.js";
import { summary } from "./stats.js";
import { seg } from "./settings.js";
import { showShortcuts } from "./settings.js";

export function openLibrarySettings(refresh) {
  const body = h("div", { class: "settings" });
  const field = (label, control) => h("div", { class: "field" }, h("div", { class: "field-label", text: label }), control);
  body.append(
    field("Theme", seg([["auto", "Auto"], ["light", "Light"], ["dark", "Dark"], ["sepia", "Sepia"]], themeChoice(), setTheme, "Theme")),
    field("Page animation", seg([["auto", "Automatic"], ["reduce", "Calm (none)"]], motionChoice(), setMotion, "Page animation")));
  if (canInstall()) body.append(field("Install", h("button", { class: "btn primary", onclick: () => { s.close(); installApp(); } }, "Install Writer's Nook on this device")));

  const offline = h("div", { class: "field" });
  body.append(offline);
  (async () => {
    if (!swReady) { offline.append(h("div", { class: "field-label", text: "Offline" }), h("p", { class: "panel-note", text: "Offline reading needs the secure (https) version of the site." })); return; }
    const hosted = (await allBooks()).filter((b) => b.hosted);
    const flags = await Promise.all(hosted.map((b) => isSaved(b.url)));
    const missing = hosted.filter((_, i) => !flags[i]);
    const used = await storageUsed();
    const size = (list) => list.reduce((n, b) => n + (b.size || 0), 0);
    offline.append(h("div", { class: "field-label", text: "Offline" }),
      h("p", { class: "panel-note", text: `${hosted.length - missing.length} of ${hosted.length} published ${hosted.length === 1 ? "book is" : "books are"} saved on this device. Books you open are saved automatically. Storage used by this site: ${fmtBytes(used)}.` }));
    const row = h("div", { class: "sheet-actions" });
    if (missing.length) {
      const btn = h("button", { class: "btn ghost", onclick: async () => {
        btn.disabled = true;
        try {
          let i = 0;
          for (const b of missing) { btn.textContent = `Saving… ${++i} of ${missing.length}`; await saveOffline([b.url]); }
          toast("All published books are saved for offline."); s.close(); refresh?.();
        } catch { toast("Couldn't save everything. Are you online?"); btn.disabled = false; btn.textContent = "Try again"; }
      } }, `Save all published books (${fmtBytes(size(missing))})`);
      row.append(btn);
    }
    if (flags.some(Boolean)) row.append(h("button", { class: "btn ghost", onclick: async () => { await forgetOffline(hosted.flatMap((b) => [b.url])); toast("Offline copies removed."); s.close(); refresh?.(); } }, "Remove offline copies"));
    offline.append(row);
  })();

  body.append(
    field("Your reading", h("button", { class: "btn ghost", onclick: () => { s.close(); openStats(); } }, "Streaks and reading time")),
    field("Your data", h("button", { class: "btn ghost", onclick: () => { s.close(); openBackup(refresh); } }, "Back up or restore")),
    field("Help", h("button", { class: "btn ghost", onclick: () => { s.close(); showShortcuts(); } }, "Keyboard shortcuts")),
    h("p", { class: "foot-note" }, h("a", { href: "publish.html" }, "Author? Publish a book")));
  const s = sheet({ title: "Settings", body });
}

export function openStats() {
  const st = summary();
  const max = Math.max(5, ...st.last14.map((d) => d.min));
  const card = (big, small) => h("div", { class: "stat-card" }, h("b", { text: big }), h("small", { text: small }));
  const bars = h("div", { class: "bars", role: "img", "aria-label": "Minutes read each day for the last 14 days" },
    st.last14.map((d) => h("div", { class: "bar-col", title: `${d.day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: ${Math.round(d.min)} min` },
      h("i", { style: `height:${Math.max(d.min ? 6 : 2, (d.min / max) * 100)}%`, class: d.min >= 1 ? "on" : "" }),
      h("span", { text: d.day.toLocaleDateString(undefined, { weekday: "narrow" }) }))));
  sheet({ title: "Your reading", body: h("div", { class: "stats" },
    h("div", { class: "stat-cards" },
      card(st.streak ? `${st.streak} ${st.streak === 1 ? "day" : "days"}` : "0 days", st.streak ? "Current streak" : "Read a minute today to start a streak"),
      card(`${st.best} ${st.best === 1 ? "day" : "days"}`, "Best streak"),
      card(fmtMinutes(st.today), "Today"),
      card(fmtMinutes(st.week), "Last 7 days"),
      card(fmtMinutes(st.total), "All time"),
      card(String(st.finished), st.finished === 1 ? "Book finished" : "Books finished")),
    h("h3", { text: "Last 14 days" }), bars,
    st.finishedList.length ? h("div", {}, h("h3", { text: "Recently finished" }), h("ul", { class: "fin" }, st.finishedList.map((f) => h("li", { text: f.title + " · " + new Date(f.t).toLocaleDateString() })))) : null,
    h("p", { class: "panel-note", text: "Counted while a book is open and you're reading. Kept only in this browser." })) });
}
