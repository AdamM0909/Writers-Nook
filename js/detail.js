/* A book's detail sheet: cover, description, genres, series, length, status, shelves, offline, and (for files you
   added yourself) editing and removing. */
import { h, sheet, toast, fmtMinutes, fmtBytes } from "./dom.js";
import { saveSoon, delBook } from "./store.js";
import { statusOf, nextInSeries, sectionList } from "./organize.js";
import { isSaved, saveOffline, forgetOffline } from "./pwa.js";
import { readLink, filterGenre } from "./library.js";

const WPM = 230;
function lengthText(b) {
  if (b.kind === "pdf") {
    if (!b.pages) return "PDF";
    return `${b.pages} ${b.pages === 1 ? "page" : "pages"}` + (b.wpp ? ` · about ${fmtMinutes((b.pages * b.wpp) / WPM)} to read` : "");
  }
  const words = b.words || (b.kind === "text" && b.hosted && b.size ? Math.round(b.size / 6) : b.kind === "text" && b.text ? b.text.split(/\s+/).length : 0);
  const label = b.kind === "epub" ? "EPUB" : "Text";
  return words ? `${label} · about ${words.toLocaleString()} words · ${fmtMinutes(words / WPM)} to read` : label;
}
const dateText = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export function openDetail(b, everything, refresh) {
  const body = h("div", { class: "detail" });
  let s;
  const draw = () => {
    const st = statusOf(b);
    const top = h("div", { class: "detail-top" },
      h("div", { class: "detail-cover" }, b.cover ? h("img", { src: b.cover, alt: "" }) : h("div", { class: "ct", text: b.title })),
      h("div", { class: "detail-info" },
        h("h3", { text: b.title }),
        b.author && h("p", { class: "by", text: b.author }),
        h("p", { class: "len", text: lengthText(b) }),
        b.section && h("p", { class: "where", text: "In " + b.section }),
        (b.hosted ? b.added : b.added) ? h("p", { class: "when", text: (b.hosted ? "Published " : "Added ") + dateText(b.added) }) : null));
    body.replaceChildren(top);
    if (b.genres?.length) body.append(h("div", { class: "chips" }, b.genres.map((g) => h("button", { class: "chip", type: "button", onclick: () => { s.close(); filterGenre(g); } }, g))));
    if (b.description) body.append(h("p", { class: "desc", text: b.description }));
    const sr = nextInSeries(b, everything);
    if (sr) {
      body.append(h("div", { class: "series-box" },
        h("b", { text: `${b.series}${b.seriesNo != null ? `, book ${b.seriesNo} of ${sr.items.length}` : ` · ${sr.items.length} books`}` }),
        h("div", { class: "series-nav" },
          sr.prev && h("button", { class: "btn ghost", onclick: () => { s.close(); openDetail(sr.prev, everything, refresh); } }, "← " + sr.prev.title),
          sr.next && h("button", { class: "btn ghost", onclick: () => { s.close(); openDetail(sr.next, everything, refresh); } }, sr.next.title + " →"))));
    }
    const read = h("a", { class: "btn primary", href: readLink(b), onclick: () => s.close() }, st === "reading" ? "Continue reading" : st === "finished" ? "Read again" : "Read");
    body.append(h("div", { class: "sheet-actions" }, read));

    body.append(h("div", { class: "field" }, h("div", { class: "field-label", text: "Your list" }),
      h("div", { class: "seg", role: "group", "aria-label": "Reading status" },
        ...[["want", "Want to read"], ["finished", "Finished"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": b.status === v, onclick: () => { b.status = b.status === v ? undefined : v; if (b.status === "finished" && !b.finishedAt) b.finishedAt = Date.now(); save(); draw(); } }, t)))));

    // personal shelves
    const names = [...new Set(everything.flatMap((x) => x.shelves || []))].sort((a, c) => a.localeCompare(c));
    const mine = new Set(b.shelves || []);
    const toggle = (n) => { mine.has(n) ? mine.delete(n) : mine.add(n); b.shelves = [...mine]; save(); draw(); };
    const newShelf = h("input", { type: "text", class: "text-in", placeholder: "New shelf, e.g. Favourites", "aria-label": "New shelf name", maxlength: "40" });
    const addShelf = () => { const n = newShelf.value.trim(); if (n) { mine.add(n); b.shelves = [...mine]; if (!everything.includes(b)) everything.push(b); save(); draw(); } };
    newShelf.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addShelf(); } });
    body.append(h("div", { class: "field" }, h("div", { class: "field-label", text: "My shelves (only on this device)" }),
      names.length ? h("div", { class: "chips" }, names.map((n) => h("button", { class: "chip", type: "button", "aria-pressed": mine.has(n), onclick: () => toggle(n) }, n))) : null,
      h("div", { class: "row-inline" }, newShelf, h("button", { class: "btn ghost", type: "button", onclick: addShelf }, "Add"))));

    if (b.hosted) offlineRow();
    if (!b.hosted) {
      body.append(h("div", { class: "sheet-actions" },
        h("button", { class: "btn ghost", onclick: () => editForm() }, "Edit details"),
        h("button", { class: "btn danger", onclick: async () => { if (confirm(`Remove “${b.title}” from this device?`)) { await delBook(b.id); s.close(); refresh(); } } }, "Remove from this device")));
    }
  };
  async function offlineRow() {
    const urls = [b.url, ...(b.cover && !b.cover.startsWith("data:") ? [b.cover] : [])];
    const saved = await isSaved(b.url);
    const btn = h("button", { class: "btn ghost", type: "button" }, saved ? "Saved for offline ✓" : "Save for offline" + (b.size ? ` (${fmtBytes(b.size)})` : ""));
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (saved) { await forgetOffline(urls); toast("Removed from offline storage."); }
        else { await saveOffline(urls); toast("Saved. This book now opens without a connection."); }
      } catch { toast("Couldn't save it. Are you online?"); }
      refresh();
      body.querySelector(".off-row")?.remove();
      offlineRow();
    };
    body.querySelector(".off-row")?.remove();
    body.append(h("div", { class: "field off-row" }, h("div", { class: "field-label", text: "Offline" }), btn));
  }
  function editForm() {
    const f = (label, el) => h("label", { class: "form-row" }, h("span", { text: label }), el);
    const inp = (v, ph = "") => { const i = h("input", { type: "text", class: "text-in", placeholder: ph }); i.value = v ?? ""; return i; };
    const title = inp(b.title), author = inp(b.author), section = inp(b.section, "e.g. Poems"), genres = inp((b.genres || []).join(", "), "e.g. Poetry, Dark"), series = inp(b.series), no = inp(b.seriesNo ?? "", "1"), desc = h("textarea", { class: "note-input", rows: "3" });
    desc.value = b.description || "";
    const dl = h("datalist", { id: "sec-list" }, sectionList(everything).map((x) => h("option", { value: x })));
    section.setAttribute("list", "sec-list");
    body.replaceChildren(
      h("p", { class: "panel-note", text: "These details are only for the copy on this device." }),
      f("Title", title), f("Author", author), f("Section", section), dl, f("Genres (comma between)", genres), f("Series", series), f("Number in series", no), f("Description", desc),
      h("div", { class: "sheet-actions" },
        h("button", { class: "btn primary", onclick: () => {
          Object.assign(b, {
            title: title.value.trim() || b.title, author: author.value.trim(), section: section.value.trim(),
            genres: genres.value.split(/[;,]/).map((x) => x.trim()).filter(Boolean), series: series.value.trim(),
            seriesNo: no.value.trim() && !isNaN(+no.value) ? +no.value : undefined, description: desc.value.trim(),
          });
          save(); draw(); refresh();
        } }, "Save"),
        h("button", { class: "btn ghost", onclick: draw }, "Cancel")));
  }
  const save = () => { saveSoon(b); refresh(); };
  draw();
  s = sheet({ title: "Book details", body, wide: true });
}
