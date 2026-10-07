# Writer's Nook

A small place for friends to log in, share their writing and express themselves.

- Anyone can **read**; you need an account to **write**.
- You can only **edit or delete your own** posts (enforced on the server, not just hidden in the UI).
- Tag a piece with a **genre** (Poetry, Short Story, Fantasy, ...) or leave it untagged. Filter by genre or by author.

## Run it

Requires Node 22.13+.

```sh
npm install
SIGNUP_CODE=pick-a-secret SESSION_SECRET=$(openssl rand -hex 32) npm start
```

Open http://localhost:3000.

| Variable | Purpose |
| --- | --- |
| `SIGNUP_CODE` | If set, new accounts need this invite code. **Set it** so only your friends can join. |
| `SESSION_SECRET` | Signs login cookies (required when `NODE_ENV=production`). |
| `DB_PATH` | SQLite file location (default `nook.db`). |
| `PORT` | Port (default 3000). |

## Test

```sh
npm test
```

To change the genre list, edit `GENRES` in `app.js`.
