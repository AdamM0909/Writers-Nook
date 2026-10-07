const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GENRES, MAX_GENRES } = require('./genres');

const PAGE_SIZE = 20;

function createApp({ dbPath = ':memory:', secret, authLimit = 30 } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS post_genres (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      genre TEXT NOT NULL,
      PRIMARY KEY (post_id, genre)
    );
    CREATE TABLE IF NOT EXISTS likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS post_genres_genre ON post_genres(genre);
  `);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieSession({
    name: 'nook',
    keys: [secret || crypto.randomBytes(32).toString('hex')],
    maxAge: 30 * 24 * 3600 * 1000,
    httpOnly: true,
    sameSite: 'lax',
  }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    // Mutating requests must be JSON: blocks cross-site form posts.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return res.status(415).json({ error: 'JSON required' });
    }
    next();
  });

  // Slow down password guessing / account spam: `authLimit` tries per IP per 15 min.
  const attempts = new Map();
  const limitAuth = (req, res, next) => {
    const now = Date.now();
    const rec = attempts.get(req.ip);
    if (!rec || rec.reset < now) attempts.set(req.ip, { n: 1, reset: now + 15 * 60 * 1000 });
    else if (++rec.n > authLimit) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    next();
  };
  setInterval(() => { const t = Date.now(); for (const [k, v] of attempts) if (v.reset < t) attempts.delete(k); }, 60 * 1000).unref();

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
    userFull: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
    setBio: db.prepare('UPDATE users SET bio = ? WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    postCount: db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?'),
    insertPost: db.prepare('INSERT INTO posts (user_id, title, body) VALUES (?, ?, ?)'),
    updatePost: db.prepare('UPDATE posts SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?'),
    postOwner: db.prepare('SELECT id, user_id FROM posts WHERE id = ?'),
    clearGenres: db.prepare('DELETE FROM post_genres WHERE post_id = ?'),
    addGenre: db.prepare('INSERT INTO post_genres (post_id, genre) VALUES (?, ?)'),
    like: db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)'),
    unlike: db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?'),
    likeCount: db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?'),
    comments: db.prepare(`SELECT c.id, c.user_id, c.body, c.created_at, u.username AS author FROM comments c
      JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`),
    insertComment: db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)'),
    getComment: db.prepare(`SELECT c.id, c.user_id, p.user_id AS post_owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  };

  const POST_SELECT = `
    SELECT p.id, p.user_id, p.title, p.body, p.created_at, p.updated_at, u.username AS author,
      (SELECT group_concat(genre, '|') FROM post_genres WHERE post_id = p.id) AS genres,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments,
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id`;

  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const shapePost = (p, me) => ({
    id: p.id, title: p.title, body: p.body, author: p.author,
    genres: p.genres ? p.genres.split('|').sort() : [],
    likes: p.likes, comments: p.comments, liked: !!p.liked,
    words: words(p.body), createdAt: p.created_at, updatedAt: p.updated_at,
    mine: !!me && p.user_id === me.id,
  });
  const getPost = (id, me) => {
    const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(me ? me.id : 0, id);
    return row ? shapePost(row, me) : null;
  };
  const currentUser = (req) => (req.session.uid ? q.userById.get(req.session.uid) || null : null);
  const requireLogin = (req, res, next) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: 'Please log in.' });
    req.me = me;
    next();
  };
  const str = (v) => (typeof v === 'string' ? v : '');
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  function parsePost(body) {
    const title = str(body.title).trim();
    const text = str(body.body).trim();
    if (!title || title.length > 150) return { error: 'Title is required (max 150 characters).' };
    if (!text || text.length > 50000) return { error: 'Writing is required (max 50,000 characters).' };
    const genres = [...new Set(Array.isArray(body.genres) ? body.genres.map(str) : [])];
    if (genres.some((g) => !GENRES.includes(g))) return { error: 'Unknown genre.' };
    if (genres.length > MAX_GENRES) return { error: `Pick at most ${MAX_GENRES} genres.` };
    return { title, text, genres };
  }
  const saveGenres = (id, genres) => { q.clearGenres.run(id); genres.forEach((g) => q.addGenre.run(id, g)); };

  // ---- config & health ----
  app.get('/api/config', (req, res) => res.json({ genres: GENRES, maxGenres: MAX_GENRES }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // ---- auth ----
  app.get('/api/me', (req, res) => res.json({ user: currentUser(req) }));

  app.post('/api/register', limitAuth, (req, res) => {
    const username = str(req.body.username).trim();
    const password = str(req.body.password);
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({ error: 'Username: 3-24 letters, numbers or underscores.' });
    }
    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (q.userByName.get(username)) return res.status(409).json({ error: 'That username is taken.' });
    const { lastInsertRowid } = q.insertUser.run(username, bcrypt.hashSync(password, 10));
    req.session.uid = Number(lastInsertRowid);
    res.status(201).json({ user: q.userById.get(req.session.uid) });
  });

  app.post('/api/login', limitAuth, (req, res) => {
    const user = q.userByName.get(str(req.body.username).trim());
    const ok = bcrypt.compareSync(str(req.body.password), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Wrong username or password.' });
    req.session.uid = user.id;
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

  app.post('/api/me/password', requireLogin, limitAuth, (req, res) => {
    const user = q.userFull.get(req.me.id);
    if (!bcrypt.compareSync(str(req.body.current), user.password_hash)) {
      return res.status(403).json({ error: 'Current password is wrong.' });
    }
    const next = str(req.body.next);
    if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    q.setPassword.run(bcrypt.hashSync(next, 10), req.me.id);
    res.json({ ok: true });
  });

  // ---- profiles ----
  app.get('/api/users/:username', (req, res) => {
    const u = q.userByName.get(req.params.username);
    if (!u) return res.status(404).json({ error: 'No such writer.' });
    res.json({ user: { username: u.username, bio: u.bio, joined: u.created_at, posts: q.postCount.get(u.id).n } });
  });

  app.put('/api/me/profile', requireLogin, (req, res) => {
    const bio = str(req.body.bio).trim();
    if (bio.length > 500) return res.status(400).json({ error: 'Bio is max 500 characters.' });
    q.setBio.run(bio, req.me.id);
    res.json({ ok: true });
  });

  // ---- posts ----
  // Reading is public; writing requires login and ownership.
  app.get('/api/posts', (req, res) => {
    const me = currentUser(req);
    const where = [];
    const args = [me ? me.id : 0];
    const genre = str(req.query.genre);
    if (genre === 'none') where.push('NOT EXISTS (SELECT 1 FROM post_genres g WHERE g.post_id = p.id)');
    else if (genre) { where.push('EXISTS (SELECT 1 FROM post_genres g WHERE g.post_id = p.id AND g.genre = ?)'); args.push(genre); }
    const author = str(req.query.author);
    if (author) { where.push('u.username = ?'); args.push(author); }
    const search = str(req.query.q).trim().slice(0, 100);
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rows = db.prepare(
      `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    ).all(...args, PAGE_SIZE + 1, offset);
    res.json({ posts: rows.slice(0, PAGE_SIZE).map((p) => shapePost(p, me)), hasMore: rows.length > PAGE_SIZE });
  });

  app.get('/api/posts/:id', (req, res) => {
    const p = getPost(Number(req.params.id), currentUser(req));
    if (!p) return res.status(404).json({ error: 'Not found.' });
    res.json({ post: p });
  });

  app.post('/api/posts', requireLogin, (req, res) => {
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const id = tx(() => {
      const newId = Number(q.insertPost.run(req.me.id, v.title, v.text).lastInsertRowid);
      saveGenres(newId, v.genres);
      return newId;
    });
    res.status(201).json({ post: getPost(id, req.me) });
  });

  app.put('/api/posts/:id', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const existing = q.postOwner.get(id);
    if (!existing) return res.status(404).json({ error: 'Not found.' });
    if (existing.user_id !== req.me.id) return res.status(403).json({ error: 'You can only edit your own writing.' });
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    tx(() => { q.updatePost.run(v.title, v.text, id, req.me.id); saveGenres(id, v.genres); });
    res.json({ post: getPost(id, req.me) });
  });

  app.delete('/api/posts/:id', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const existing = q.postOwner.get(id);
    if (!existing) return res.status(404).json({ error: 'Not found.' });
    if (existing.user_id !== req.me.id) return res.status(403).json({ error: 'You can only delete your own writing.' });
    q.deletePost.run(id, req.me.id);
    res.json({ ok: true });
  });

  // ---- likes ----
  app.put('/api/posts/:id/like', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    if (!q.postOwner.get(id)) return res.status(404).json({ error: 'Not found.' });
    const liked = req.body.liked !== false;
    (liked ? q.like : q.unlike).run(id, req.me.id);
    res.json({ liked, likes: q.likeCount.get(id).n });
  });

  // ---- comments ----
  app.get('/api/posts/:id/comments', (req, res) => {
    const me = currentUser(req);
    const post = q.postOwner.get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: 'Not found.' });
    res.json({
      comments: q.comments.all(post.id).map((c) => ({
        id: c.id, author: c.author, body: c.body, createdAt: c.created_at,
        // Commenters can remove their own; the post's author can remove anything on their post.
        canDelete: !!me && (c.user_id === me.id || post.user_id === me.id),
      })),
    });
  });

  app.post('/api/posts/:id/comments', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    if (!q.postOwner.get(id)) return res.status(404).json({ error: 'Not found.' });
    const body = str(req.body.body).trim();
    if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment is required (max 2,000 characters).' });
    q.insertComment.run(id, req.me.id, body);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/comments/:id', requireLogin, (req, res) => {
    const c = q.getComment.get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Not found.' });
    if (c.user_id !== req.me.id && c.post_owner !== req.me.id) return res.status(403).json({ error: 'Not allowed.' });
    q.deleteComment.run(c.id);
    res.json({ ok: true });
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp };
