// Lists everything in books/ into books/library.json (run by the deploy workflow; run it locally too).
// Optional books/meta.json: { "My Book.pdf": { "title": "My Book", "author": "Me" } }
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("../books/", import.meta.url);
const meta = existsSync(new URL("meta.json", dir)) ? JSON.parse(readFileSync(new URL("meta.json", dir), "utf8")) : {};
const files = readdirSync(dir).filter((f) => /\.(pdf|txt|md)$/i.test(f)).sort((a, b) => a.localeCompare(b));
const list = files.map((file) => ({ file, ...meta[file] }));
writeFileSync(new URL("library.json", dir), JSON.stringify(list, null, 2) + "\n");
console.log(`books/library.json: ${list.length} book(s)`);
