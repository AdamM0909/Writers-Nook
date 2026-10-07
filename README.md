# Writer's Nook

A small place for friends to log in, share their writing and express themselves.

- Anyone can **read**; you need a free account to **write, like and comment**. Sign-up is open.
- You can only **edit or delete your own** posts. This is enforced on the server, not just hidden in the UI.
- Tag a piece with up to 3 of 50+ **genres** (Gothic, Adventure, Fantasy, Poetry, Memoir...) or leave it untagged.
- Search, filter by genre or author, writer **profiles** with a bio, **likes**, **comments** (you can delete your own,
  and writers can remove comments on their own posts), reading time, change password, login rate limiting.

## Run it on your computer

Needs Node 22.13+.

```sh
npm install
npm start          # http://localhost:3000
npm test
```

## Put it online so your friends can join

GitHub itself only stores the code. **GitHub Pages can't run this site** because it needs a server and a database.
Host it on a service that runs Node, then send your friends the link. They click **Join**, pick a username and password, done.

### Render (easiest)
1. Push this repo to your GitHub (it already is).
2. On [render.com](https://render.com) choose **New + > Blueprint**, pick this repo. `render.yaml` sets everything up.
3. Render gives you a URL like `https://writers-nook.onrender.com`. Share it.

Posts are stored in a SQLite file, so the host **must have a persistent disk** (Render's is on its paid plan, about $7/mo).
Without one, every redeploy wipes all posts and accounts. Fly.io, Railway or any VPS work too: use the included
`Dockerfile`, mount a volume at `/data`, and set `SESSION_SECRET` to a long random string.

### Settings

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs login cookies. Required when `NODE_ENV=production`. |
| `DB_PATH` | SQLite file location (default `nook.db`; `/data/nook.db` in Docker). |
| `PORT` | Port (default 3000). |

### Back up
Everything is in the one SQLite file. Copy it now and then.

## Customising
Edit `genres.js` to change the genre list or `MAX_GENRES` (tags per post).
