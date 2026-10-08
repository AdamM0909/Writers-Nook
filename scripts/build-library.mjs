// Lists everything in books/ into books/library.json (run by the deploy workflow; run it locally too).
//
//   books/My Novel.pdf                      <- the book (.pdf, .epub, .txt or .md)
//   books/My Novel.jpg                      <- its cover (same name; .jpg .jpeg .png .webp .gif)
//   books/Poems/Night Verses.pdf            <- a folder is a section on the shelf ("Poems")
//   books/Stories/Dark Saga/Book One.pdf    <- a second folder is a series
//   books/My Novel - Your Name {Stories} [Fantasy, Dark] (Dark Saga, Book 2).pdf
//                                           <- Title - Author, {section}, [genre tags], (Series, Book number)
// Optional books/meta.json wins over everything above:
//   { "_sections": ["Poems", "Philosophy"],
//     "Poems/Night Verses.pdf": { "title": "…", "author": "…", "genres": ["Poetry"], "series": "…", "seriesNo": 1, "description": "…" } }
// See js/organize.js for the rules.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fileToMeta, coverKey, detectSeries, isBookFile, isCoverFile } from "../js/organize.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = join(root, "books");
// books/meta.json is edited by hand, so a stray trailing comma is forgiven, and a real mistake is reported without stopping the deploy.
function readMeta() {
  if (!existsSync(join(dir, "meta.json"))) return {};
  const text = readFileSync(join(dir, "meta.json"), "utf8");
  for (const t of [text, text.replace(/,(\s*[}\]])/g, "$1")]) { try { return JSON.parse(t); } catch { /* try the forgiving version */ } }
  console.warn("WARNING: books/meta.json is not valid JSON, so it was ignored. Check commas and quotes.");
  return {};
}
const meta = readMeta();

/* every file under books/, as paths relative to it ("Poems/Night Verses.pdf") */
function walk(rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...walk(rel + e.name + "/"));
    else out.push(rel + e.name);
  }
  return out;
}
const all = walk();
const covers = new Map(all.filter(isCoverFile).map((f) => [coverKey(f), f]));
const files = all.filter(isBookFile).sort((a, b) => a.localeCompare(b));

// When a book first appeared in the repo (for "New" badges and the Newest sort). Needs full git history.
let shallow = true;
try { shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "ignore"] }).trim() !== "false"; } catch { /* no git */ }
function added(file) {
  if (shallow) return undefined;
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "--", "books/" + file], { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
    return out.length ? +out[out.length - 1] * 1000 : undefined;
  } catch { return undefined; }
}

const list = files.map((file) => {
  const m = meta[file] || {};
  const e = { file, ...fileToMeta(file) };
  const c = covers.get(coverKey(file));
  if (c) e.cover = c;
  e.size = statSync(join(dir, file)).size;
  const t = added(file);
  if (t) e.added = t;
  return Object.assign(e, m);
});
detectSeries(list);

const sections = Array.isArray(meta._sections) ? meta._sections : [];
writeFileSync(join(dir, "library.json"), JSON.stringify({ sections, books: list }, null, 2) + "\n");
console.log(`books/library.json: ${list.length} book(s), ${list.filter((b) => b.cover).length} with covers, ` +
  `${new Set(list.map((b) => b.section).filter(Boolean)).size} section(s), ${new Set(list.map((b) => b.series).filter(Boolean)).size} series` +
  (shallow ? " (no git history: 'added' dates skipped)" : ""));
