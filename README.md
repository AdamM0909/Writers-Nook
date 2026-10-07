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

Needs Node 22+. Posts are saved in a local file (`nook.db`) when you run it like this.

```sh
npm install
ADMIN_PASSWORD='pick-something-long' npm start     # http://localhost:3000
npm test
```

Log in as admin at `/admin` (the **Admin** link in the top bar). If `ADMIN_PASSWORD` isn't set, nobody can edit or delete.
Changing `ADMIN_PASSWORD` logs every admin session out immediately.

## Put it online for free (Render + Turso)

GitHub only stores the code; **GitHub Pages can't run this site** because it needs a server and a database.
Free hosts delete files on the server, so the posts live in **Turso**, a free hosted SQLite database, and the
site itself runs on **Render's** free web service. Free-tier terms change, so check each site as you sign up.

### 1. Make the Turso database

Easiest from your computer's terminal (Mac, Linux or Windows WSL):

```sh
curl -sSfL https://get.tur.so/install.sh | bash     # install the Turso CLI (restart your terminal after)
turso auth login                                    # opens a browser; sign up / log in
turso db create writers-nook                        # make the database
turso db show writers-nook --url                    # -> libsql://writers-nook-yourname.turso.io   (copy this)
turso db tokens create writers-nook                 # -> a long token                              (copy this)
```

Prefer clicking? In the dashboard at [turso.tech](https://turso.tech), create a database called `writers-nook`, then
copy its **URL** and create a **token** from the database's page.

The tables are created automatically the first time the site starts. You don't run any SQL.

### 2. Deploy on Render

1. Sign up at [render.com](https://render.com) with your GitHub account.
2. **New + > Blueprint**, choose this repo, and allow Render access to it. (Merge to `main` first, or set the service's branch.)
3. Render reads `render.yaml` and asks for three values:
   - `ADMIN_PASSWORD`: the password only you will use to edit/delete (make it long).
   - `TURSO_DATABASE_URL`: the `libsql://...` URL from step 1.
   - `TURSO_AUTH_TOKEN`: the token from step 1.
4. Apply. After a few minutes you get a link like `https://writers-nook.onrender.com`. Send it to your friends.

On the free plan the site sleeps when nobody visits and takes about a minute to wake up. Posts are safe in Turso either way.

### Settings

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Your admin password. Required when `NODE_ENV=production`. |
| `SESSION_SECRET` | Signs the admin cookie. Required in production (Render generates it). |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Use the hosted Turso database. Leave both unset to use a local file instead. |
| `DB_PATH` | Local SQLite file when not using Turso (default `nook.db`). |
| `PORT` | Port (default 3000). |

### Other hosts
Any host that runs Node or Docker works the same way: set the variables above. Without Turso you need a host with a
persistent disk, with `DB_PATH` pointing onto it.

### Backups
Turso keeps a short point-in-time history on the free plan. For your own copy, `turso db shell writers-nook .dump > backup.sql`.

## Customising
Edit `genres.js` to change the genre list or `MAX_GENRES` (tags per post).
