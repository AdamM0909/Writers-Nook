# Writer's Nook

A quiet, classy personal library for your books and writing — white pages with purple and gold vine accents.

- **Upload PDFs** and read them as a two-page book spread (cover on its own, then facing pages).
- **Upload `.txt` / `.md`** files, or **write directly** in the built-in editor; text is paginated into a two-page spread too.
- Auto-generated covers, search, reading progress remembered per book, keyboard (← →), swipe and slider navigation.
- Single-page mode automatically on phones.
- Everything is stored privately in your browser (IndexedDB). No server, no accounts.

## Run it

It's a static site — no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

It also deploys as-is to GitHub Pages, Netlify, Cloudflare Pages, etc.

## Notes

- PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), vendored in `vendor/`.
- Library data lives in the browser it was added from; use **Download** in the reader to keep copies.
