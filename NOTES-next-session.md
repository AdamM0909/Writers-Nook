# Writer's Nook: notes for the next session

## Done
- Bookmarks and contents (PR 7), then the big library upgrade (this branch): offline app and installing, sections / genres / series / statuses / shelves, grid and list, search by genre, New badge, detail sheet, EPUB, highlights and notes, search in a book, read aloud, quote cards, dictionary (opt-in), reading settings and themes (Auto, Sepia), focus mode, tap zones, time left, share links, sleep timer, reading stats, backup and restore, generated covers, publish page that builds the full file name, accessibility pass (axe clean).

## Known gaps (honest list)
- **Cover images are huge** (13 PNGs, about 38 MB, 1600x2560). They slow the shelf on a phone. Shrinking them to about 600 px JPEGs would change nothing visible. Not touched: they are the owner's files.
- PDFs: no highlights (a PDF page is a picture): use bookmarks with notes. No yellow highlight of search hits on the page. Quote cards need selectable text, so text books and EPUBs only.
- EPUB: text only; pictures inside EPUBs are left out. DRM-protected files won't open.
- No sync between devices (no server, no accounts): use Back up and restore.
- Read aloud depends on the voices the device has.
- Not tested: real iPhone Safari, real Android Chrome install prompt, real speech voices.

## Ideas not built
- Collections that visitors can follow (needs a server), comments, PDF text-layer highlights, image support in EPUB, per-book reading goals.
