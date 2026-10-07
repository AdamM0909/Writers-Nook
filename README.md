# Writer's Nook

A small, open place to share writing. **No accounts, no sign-up.**

- Anyone can **read, post and comment**. Every post and comment needs a **name** (shown as the author).
- Only the **admin** (whoever knows `ADMIN_PASSWORD`) can **edit or delete** posts and comments.
- Tag a piece with up to 3 of 50+ **genres** (Gothic, Adventure, Fantasy, Poetry, Memoir...) or leave it untagged.
- Search, filter by genre or author, reading time, comments, "load more" paging.
- Posting and admin login are rate limited per IP to slow down spam and password guessing.

Because there are no accounts, **names aren't verified**: anyone can type any name, and writers can't edit their
own posts after publishing (they ask the admin). That's the trade-off for keeping it open.

## Run it on your computer

Needs Node 22.13+.

```sh
npm install
ADMIN_PASSWORD='pick-something-long' npm start     # http://localhost:3000
npm test
```

Log in as admin at `/admin` (the **Admin** link in the top bar). If `ADMIN_PASSWORD` isn't set, nobody can edit or delete.
Changing `ADMIN_PASSWORD` logs every admin session out immediately.

## Put it online

GitHub only stores the code; **GitHub Pages can't run this site** because it needs a server and a database.
Use a host that runs Node and **keeps a persistent disk** (posts live in one SQLite file, and hosts without a disk
wipe it on every restart). The included `Dockerfile` works anywhere; `render.yaml` is a ready Render blueprint
(its disk needs a paid plan).

Set these on the host:

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Your admin password. Required when `NODE_ENV=production`. |
| `SESSION_SECRET` | Signs the admin cookie. Required in production (any long random string). |
| `DB_PATH` | SQLite file location (default `nook.db`; `/data/nook.db` in Docker). |
| `PORT` | Port (default 3000). |

Back up by copying the SQLite file now and then.

## Customising
Edit `genres.js` to change the genre list or `MAX_GENRES` (tags per post).
