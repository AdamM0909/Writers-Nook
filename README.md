# Writer's Nook

A quiet, classy reading room for your books and writing: white and gold by day, black and gold by night (or sepia), with vine accents. A static site: no server, no accounts, no build step except one small script that lists your books at deploy time.

## For readers

- **Reads PDF, EPUB, Markdown (`.md`) and plain text.** PDFs show as two-page spreads with a real page turn (single pages on phones). Text books flow into the same spread.
- **Shelves:** sections (Poems, Philosophy, Stories…), genre tags, series (grouped in order, with "Book 2 of 3"), reading status (Reading, Want to read, Finished), and your own private shelves. Grid or list view, cover-size slider, search by title, author, genre, series or description, sort including *Newest first*. New books get a **New** badge.
- **Contents** from `#` headings in text books, from a PDF's own outline, and, for PDFs that have none, from "Chapter One / Prologue…" headings found in the text.
- **Bookmarks, highlights and notes** (select words in a text book), all saved per book. Text-book places follow the words, so they survive changing the text size or turning your phone.
- **Search inside a book.** Read aloud, in a **natural feminine voice** you download once (about 33 MB, in Aa; then it works offline on any phone or computer; see `vendor/voice/README.md` for licences) or with your device's voices (turns the pages as it goes; it picks the smoothest warm English voice the device has, a calm pace with a breath between paragraphs; choose another voice and hear a sample in Aa; if a device can't speak it says why instead of going silent). **Quote cards**: select a passage and save it as a black-and-gold picture. Look up a word (asks first; see Privacy).
- **Reading settings** (Aa): theme (Auto, Light, Dark, Sepia), font (Serif, Sans, Easy to read), text size, line spacing, margins, alignment, calm (no) page animation, sleep timer. Focus mode hides the bars (tap the middle of the page, or `Z`). "About 20 min left" estimates. Share a link that opens a published book at your exact place.
- **Works offline and installs like an app.** Books you open are kept on the device; **Save for offline** keeps any book, and Settings can save them all. "Install" adds it to your Home Screen (on iPhone: Share, then Add to Home Screen). New versions announce themselves.
- **Reading stats**: time, streaks, books finished (kept only in your browser).
- **Back up and restore** everything that lives in your browser (your own files, places, notes, shelves, settings).
- Keyboard: `?` lists the shortcuts. Screen-reader and keyboard friendly, checked with axe in all three themes.

**Open a file** lets a visitor read their own PDF, EPUB, `.md` or `.txt`. It stays in their browser (IndexedDB) and is never published. Their bookmarks, notes and shelves stay in their browser too; there are no accounts, so nothing syncs between devices (use *Back up and restore* to move it).

## Publish it from GitHub (GitHub Pages)

1. Merge to `main`.
2. In the repo: **Settings, Pages, Build and deployment, Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow runs on every push to `main`; your site appears at `https://<user>.github.io/Writers-Nook/`.

## Add books to your shelf

Put each book (and its cover image, with the same name) in the [`books/`](books) folder and push to `main`. You can upload straight from the GitHub website (**Add file, Upload files**); `publish.html` on your site (the *Author? Publish a book* link) builds the file names for you.

```
books/
  My Novel.pdf                     <- the book (.pdf, .epub, .md or .txt)
  My Novel.jpg                     <- its cover (.jpg .jpeg .png .webp .gif), same name
```

Everything about a book can live in its **file name**:

```
Night Verses - Your Name {Poems} [Poetry, Dark] (Night Cycle, Book 2).pdf
   title        author     section   genres        series, number
```

| Part | What it does |
| --- | --- |
| `Title - Author` | title and author |
| `{Poems}` | the section (a tab and a shelf heading) |
| `[Poetry, Dark]` | genre tags (filter chips) |
| `(Night Cycle, Book 2)` | series and position |

All parts are optional. A cover only needs the plain name: `Night Verses - Your Name.jpg`. Folders work too (`books/Poems/…` is the Poems section; `books/Stories/Dark Saga/…` adds a series). Titles ending in numbers ("Self-Appreciation 1, 2, 3") are grouped into a series automatically.

For things a file name can't hold (a description, the order of sections), add `books/meta.json`. It wins over everything else:

```json
{
  "_sections": ["Poems", "Philosophy", "Stories"],
  "Night Verses - Your Name {Poems}.pdf": { "description": "Short poems about the night.", "genres": ["Poetry"] }
}
```

A book with no cover image gets one made from its first page (PDF), its cover (EPUB), or a black-and-gold cover with its title (text). Poetry (section or genre containing "poem", "poetry", "verse"…) keeps every line break.

Only people with write access to the repo can publish, so only the owner can add books. Anyone with the link can read what is published. If the repo is public, so are the books in it.

> **Tip:** cover images are shown small, so large images only slow the shelf down. Around 600 px wide (under 150 KB each) looks the same on a phone.

## Privacy

- Nothing you read, highlight or search leaves the browser, with one exception: **Define** sends the single selected word to [dictionaryapi.dev](https://dictionaryapi.dev) after asking you once.
- Fonts are bundled (no Google Fonts), so the site loads nothing from third parties.

## Run locally

```sh
node scripts/build-library.mjs   # writes books/library.json (git history gives each book its "added" date)
python3 -m http.server 8000      # open http://localhost:8000
```

## How it is put together

```
index.html, styles.css, app.js     the page and its entry point
js/organize.js                     file-name rules, filters, series (shared with the build script)
js/store.js                        published books, your own files (IndexedDB), what is remembered per book
js/library.js, detail.js           the shelf, cards, detail sheet
js/reader.js                       layout, pages, saved place; panel.js marks.js search.js select.js settings.js tts.js quote.js define.js are its parts
js/pdf.js, text.js, epub.js        PDF, Markdown/plain text, EPUB
js/pwa.js, sw.js                   offline, install, updates
js/stats.js, backup.js, libsettings.js, cover.js, prefs.js, keys.js, dom.js
scripts/build-library.mjs          lists books/ at deploy time
vendor/                            PDF.js (Apache-2.0), fflate (MIT), fonts (SIL OFL)
```

PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache-2.0); EPUBs are unzipped with [fflate](https://github.com/101arrowz/fflate) (MIT); fonts are EB Garamond, Cormorant Garamond and Atkinson Hyperlegible (SIL Open Font License).
