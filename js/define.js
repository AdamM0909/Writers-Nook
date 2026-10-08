/* Look a word up. This sends the single word to dictionaryapi.dev, so it asks first and remembers the answer. */
import { h, sheet, pref } from "./dom.js";

export async function defineWord(raw) {
  const word = (raw.match(/[\p{L}'’-]+/u) || [""])[0].replace(/^['’-]+|['’-]+$/g, "").toLowerCase();
  if (!word) return;
  if (pref.get("define", "") !== "1") {
    const ok = await ask(word);
    if (!ok) return;
    pref.set("define", "1");
  }
  const body = h("div", { class: "define" }, h("p", { class: "panel-note", text: "Looking up “" + word + "”…" }));
  sheet({ title: word, body });
  try {
    const r = await fetch("https://api.dictionaryapi.dev/v2/entries/en/" + encodeURIComponent(word));
    if (!r.ok) throw new Error(r.status);
    const entries = await r.json();
    body.replaceChildren();
    const phon = entries.map((e) => e.phonetic).find(Boolean);
    if (phon) body.append(h("p", { class: "define-phon", text: phon }));
    for (const m of entries.flatMap((e) => e.meanings || []).slice(0, 4)) {
      body.append(h("h3", { class: "define-pos", text: m.partOfSpeech }),
        h("ol", {}, (m.definitions || []).slice(0, 2).map((d) => h("li", {}, d.definition, d.example && h("em", { class: "define-ex", text: " “" + d.example + "”" })))));
    }
    if (!body.children.length) throw new Error("empty");
  } catch {
    body.replaceChildren(h("p", { class: "panel-note", text: navigator.onLine ? "No definition found for “" + word + "”." : "You're offline, so the dictionary can't be reached." }),
      navigator.onLine && h("a", { class: "btn ghost", href: "https://duckduckgo.com/?q=" + encodeURIComponent("define " + word), target: "_blank", rel: "noopener" }, "Search the web"));
  }
}
function ask(word) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; s.close(); resolve(v); };
    const s = sheet({
      title: "Look up a word",
      body: h("div", {},
        h("p", {}, "To define words, Writer's Nook sends the word you select (“" + word + "”) to the free dictionaryapi.dev service. Nothing else is sent: not the book, not who you are."),
        h("div", { class: "sheet-actions" },
          h("button", { class: "btn primary", onclick: () => done(true) }, "Look it up"),
          h("button", { class: "btn ghost", onclick: () => done(false) }, "Not now"))),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}
