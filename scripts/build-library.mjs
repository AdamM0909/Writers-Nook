// Lists everything in books/ into books/library.json (run by the deploy workflow; run it locally too).
//
//   books/My Novel.pdf     <- the book (.pdf, .txt or .md)
//   books/My Novel.jpg     <- its cover (same name; .jpg .jpeg .png .webp .gif)
//
// Optional books/meta.json: { "My Novel.pdf": { "title": "My Novel", "author": "Me" } }
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("../books/", import.meta.url);
const meta = existsSync(new URL("meta.json", dir)) ? JSON.parse(readFileSync(new URL("meta.json", dir), "utf8")) : {};
const all = readdirSync(dir);
const stem = (f) => f.replace(/\.[^.]+$/, "").toLowerCase();
const covers = new Map(all.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).map((f) => [stem(f), f]));
const books = all.filter((f) => /\.(pdf|txt|md)$/i.test(f)).sort((a, b) => a.localeCompare(b));
const list = books.map((file) => ({ file, ...(covers.has(stem(file)) && { cover: covers.get(stem(file)) }), ...meta[file] }));
writeFileSync(new URL("library.json", dir), JSON.stringify(list, null, 2) + "\n");
console.log(`books/library.json: ${list.length} book(s), ${list.filter((b) => b.cover).length} with covers`);
