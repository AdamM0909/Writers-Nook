# Writer's Nook

A quiet, classy reading room for your books and writing — white pages with purple and gold vine accents.

- **Two-page book spreads** for PDFs (cover on its own, then facing pages) with a real page-turn animation. Phones get single pages.
- Reads `.txt` / `.md` too, paginated into the same spread.
- Animated vine header, staggered shelf, sheen on covers, book-opening transition (respects *reduced motion*).
- Navigate with ← → / Space, clicking a page, swiping, or the slider. `F` toggles fullscreen. Your place in each book is remembered.
- Static site: no server, no build.

## Publish it from GitHub (GitHub Pages)

1. Merge to `main`.
2. In the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow runs on every push to `main`; your site appears at `https://<user>.github.io/Writers-Nook/`.

## Add books to your shelf

Put each book and its cover image in the [`books/`](books) folder, **with the same file name**, and push to `main`:

```
books/
  My Novel.pdf      <- the book  (.pdf, .txt or .md)
  My Novel.jpg      <- its cover (.jpg, .jpeg, .png, .webp or .gif)
  Poems.txt
  Poems.png
```

That's it: the deploy workflow lists the folder automatically, and anyone with your link sees the shelf and can read everything. You can add files straight from the GitHub website (**Add file → Upload files**). A book with no cover image gets one made from its first page (PDF) or a purple-and-gold cover (text).

Titles come from the file names. To set a title or author, add `books/meta.json`:

```json
{ "My Novel.pdf": { "title": "My Novel", "author": "Your Name" } }
```

Visitors can also use **Add a book** to open a file just for themselves; those stay only in that browser.

> If the repo is public, so are the books in it. For private reading, keep the repo private (Pages on private repos needs a paid plan) or only use **Add a book**.

## Run locally

```sh
node scripts/build-library.mjs   # writes books/library.json
python3 -m http.server 8000      # open http://localhost:8000
```

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), vendored in `vendor/`.
