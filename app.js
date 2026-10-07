const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const GENRES = [
  'Poetry', 'Short Story', 'Fiction', 'Fantasy', 'Sci-Fi', 'Horror',
  'Romance', 'Non-fiction', 'Essay', 'Journal', 'Song Lyrics', 'Other',
];

function createApp({ dbPath = ':memory:', secret, signupCode = '' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      genre TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS posts_genre ON posts(genre);
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
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
    // Mutating requests must be JSON: blocks cross-site form posts.
    if (req.method !== 'GET' && req.method !== 'HEAD' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return res.status(415).json({ error: 'JSON required' });
    }
    next();
  });

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
    getPost: db.prepare(`SELECT p.*, u.username AS author FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`),
    insertPost: db.prepare('INSERT INTO posts (user_id, title, body, genre) VALUES (?, ?, ?, ?)'),
    updatePost: db.prepare(`UPDATE posts SET title = ?, body = ?, genre = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?'),
  };

  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
  const publicPost = (p, me) => ({
    id: p.id, title: p.title, body: p.body, genre: p.genre, author: p.author,
    createdAt: p.created_at, updatedAt: p.updated_at,
    mine: !!me && p.user_id === me.id,
  });
  const currentUser = (req) => (req.session.uid ? q.userById.get(req.session.uid) : null);
  const requireLogin = (req, res, next) => {
    const me = currentUser(req);
    if (!me) return res.status(401).json({ error: 'Please log in.' });
    req.me = me;
    next();
  };
  const str = (v) => (typeof v === 'string' ? v : '');

  function parsePost(body) {
    const title = str(body.title).trim();
    const text = str(body.body).trim();
    const genre = str(body.genre).trim() || null;
    if (!title || title.length > 150) return { error: 'Title is required (max 150 characters).' };
    if (!text || text.length > 50000) return { error: 'Writing is required (max 50,000 characters).' };
    if (genre && !GENRES.includes(genre)) return { error: 'Unknown genre.' };
    return { title, text, genre };
  }

  // ---- auth ----
  app.get('/api/config', (req, res) => {
    res.json({ genres: GENRES, signupCodeRequired: !!signupCode });
  });

  app.get('/api/me', (req, res) => res.json({ user: currentUser(req) }));

  app.post('/api/register', (req, res) => {
    const username = str(req.body.username).trim();
    const password = str(req.body.password);
    if (signupCode && str(req.body.code) !== signupCode) {
      return res.status(403).json({ error: 'Wrong invite code.' });
    }
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

  app.post('/api/login', (req, res) => {
    const user = q.userByName.get(str(req.body.username).trim());
    const ok = bcrypt.compareSync(str(req.body.password), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Wrong username or password.' });
    req.session.uid = user.id;
    res.json({ user: { id: user.id, username: user.username } });
  });

  app.post('/api/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  // ---- posts ----
  // Reading is public; writing requires login and ownership.
  app.get('/api/posts', (req, res) => {
    const me = currentUser(req);
    const where = [];
    const args = [];
    const genre = str(req.query.genre);
    if (genre === 'none') where.push('p.genre IS NULL');
    else if (genre) { where.push('p.genre = ?'); args.push(genre); }
    const author = str(req.query.author);
    if (author) { where.push('u.username = ?'); args.push(author); }
    const rows = db.prepare(
      `SELECT p.*, u.username AS author FROM posts p JOIN users u ON u.id = p.user_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.created_at DESC, p.id DESC LIMIT 200`
    ).all(...args);
    res.json({ posts: rows.map((p) => publicPost(p, me)) });
  });

  app.get('/api/posts/:id', (req, res) => {
    const p = q.getPost.get(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Not found.' });
    res.json({ post: publicPost(p, currentUser(req)) });
  });

  app.post('/api/posts', requireLogin, (req, res) => {
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { lastInsertRowid } = q.insertPost.run(req.me.id, v.title, v.text, v.genre);
    res.status(201).json({ post: publicPost(q.getPost.get(Number(lastInsertRowid)), req.me) });
  });

  app.put('/api/posts/:id', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const existing = q.getPost.get(id);
    if (!existing) return res.status(404).json({ error: 'Not found.' });
    if (existing.user_id !== req.me.id) return res.status(403).json({ error: 'You can only edit your own writing.' });
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    q.updatePost.run(v.title, v.text, v.genre, id, req.me.id);
    res.json({ post: publicPost(q.getPost.get(id), req.me) });
  });

  app.delete('/api/posts/:id', requireLogin, (req, res) => {
    const id = Number(req.params.id);
    const existing = q.getPost.get(id);
    if (!existing) return res.status(404).json({ error: 'Not found.' });
    if (existing.user_id !== req.me.id) return res.status(403).json({ error: 'You can only delete your own writing.' });
    q.deletePost.run(id, req.me.id);
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

module.exports = { createApp, GENRES };
