const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { GENRES, MAX_GENRES } = require('./genres');

const PAGE_SIZE = 20;
const sha = (v) => crypto.createHash('sha256').update(v).digest();

// Everyone can read, post and comment (with a name). Only the admin can edit or delete.
function createApp({ dbPath = ':memory:', secret, adminPassword = '', loginLimit = 10, writeLimit = 20 } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      author TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
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
    maxAge: 7 * 24 * 3600 * 1000,
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

  // Per-IP fixed-window limiter. Login: stop password guessing. Writes: stop spam, since anyone can post.
  const limiter = (max, windowMs, message) => {
    const hits = new Map();
    setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60 * 1000).unref();
    return (req, res, next) => {
      const now = Date.now();
      const rec = hits.get(req.ip);
      if (!rec || rec.reset < now) hits.set(req.ip, { n: 1, reset: now + windowMs });
      else if (++rec.n > max) return res.status(429).json({ error: message });
      next();
    };
  };
  const limitLogin = limiter(loginLimit, 15 * 60 * 1000, 'Too many attempts. Try again in a few minutes.');
  const limitWrite = limiter(writeLimit, 10 * 60 * 1000, "You're posting a lot. Please wait a few minutes.");

  const POST_SELECT = `
    SELECT p.id, p.author, p.title, p.body, p.created_at, p.updated_at,
      (SELECT group_concat(genre, '|') FROM post_genres WHERE post_id = p.id) AS genres,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments
    FROM posts p`;
  const q = {
    insertPost: db.prepare('INSERT INTO posts (author, title, body) VALUES (?, ?, ?)'),
    updatePost: db.prepare('UPDATE posts SET author = ?, title = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    postExists: db.prepare('SELECT id FROM posts WHERE id = ?'),
    clearGenres: db.prepare('DELETE FROM post_genres WHERE post_id = ?'),
    addGenre: db.prepare('INSERT INTO post_genres (post_id, genre) VALUES (?, ?)'),
    comments: db.prepare('SELECT id, author, body, created_at FROM comments WHERE post_id = ? ORDER BY id'),
    insertComment: db.prepare('INSERT INTO comments (post_id, author, body) VALUES (?, ?, ?)'),
    commentExists: db.prepare('SELECT id FROM comments WHERE id = ?'),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
  };

  // Admin = knows ADMIN_PASSWORD. The session stores a hash of it, so changing the
  // password instantly logs every admin out. With no password configured, nobody is admin.
  const adminTag = adminPassword ? sha('admin:' + adminPassword).toString('hex') : null;
  const isAdmin = (req) => !!adminTag && req.session.admin === adminTag;
  const requireAdmin = (req, res, next) =>
    (isAdmin(req) ? next() : res.status(403).json({ error: 'Only the admin can do that.' }));

  const str = (v) => (typeof v === 'string' ? v : '');
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const shapePost = (p) => ({
    id: p.id, author: p.author, title: p.title, body: p.body,
    genres: p.genres ? p.genres.split('|').sort() : [],
    comments: p.comments, words: words(p.body), createdAt: p.created_at, updatedAt: p.updated_at,
  });
  const getPost = (id) => {
    const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id);
    return row ? shapePost(row) : null;
  };
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const cleanName = (v) => str(v).replace(/\s+/g, ' ').trim();
  const nameError = (n) => (!n || n.length > 40 ? 'Your name is required (max 40 characters).' : null);

  function parsePost(body) {
    const author = cleanName(body.author);
    const title = str(body.title).trim();
    const text = str(body.body).trim();
    if (nameError(author)) return { error: nameError(author) };
    if (!title || title.length > 150) return { error: 'Title is required (max 150 characters).' };
    if (!text || text.length > 50000) return { error: 'Writing is required (max 50,000 characters).' };
    const genres = [...new Set(Array.isArray(body.genres) ? body.genres.map(str) : [])];
    if (genres.some((g) => !GENRES.includes(g))) return { error: 'Unknown genre.' };
    if (genres.length > MAX_GENRES) return { error: `Pick at most ${MAX_GENRES} genres.` };
    return { author, title, text, genres };
  }
  const saveGenres = (id, genres) => { q.clearGenres.run(id); genres.forEach((g) => q.addGenre.run(id, g)); };

  // ---- config & health ----
  app.get('/api/config', (req, res) => res.json({ genres: GENRES, maxGenres: MAX_GENRES, adminEnabled: !!adminTag }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // ---- admin ----
  app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

  app.post('/api/admin/login', limitLogin, (req, res) => {
    if (!adminTag) return res.status(404).json({ error: 'Admin is not set up on this site.' });
    if (!crypto.timingSafeEqual(sha(str(req.body.password)), sha(adminPassword))) {
      return res.status(403).json({ error: 'Wrong admin password.' });
    }
    req.session.admin = adminTag;
    res.json({ admin: true });
  });

  app.post('/api/admin/logout', (req, res) => { req.session = null; res.json({ admin: false }); });

  // ---- posts ----
  app.get('/api/posts', (req, res) => {
    const where = [];
    const args = [];
    const genre = str(req.query.genre);
    if (genre === 'none') where.push('NOT EXISTS (SELECT 1 FROM post_genres g WHERE g.post_id = p.id)');
    else if (genre) { where.push('EXISTS (SELECT 1 FROM post_genres g WHERE g.post_id = p.id AND g.genre = ?)'); args.push(genre); }
    const author = cleanName(req.query.author);
    if (author) { where.push('p.author = ? COLLATE NOCASE'); args.push(author); }
    const search = str(req.query.q).trim().slice(0, 100);
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR p.author LIKE ? ESCAPE '\\')");
      args.push(like, like, like);
    }
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rows = db.prepare(
      `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    ).all(...args, PAGE_SIZE + 1, offset);
    res.json({ posts: rows.slice(0, PAGE_SIZE).map(shapePost), hasMore: rows.length > PAGE_SIZE });
  });

  app.get('/api/posts/:id', (req, res) => {
    const p = getPost(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'Not found.' });
    res.json({ post: p });
  });

  app.post('/api/posts', limitWrite, (req, res) => {
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const id = tx(() => {
      const newId = Number(q.insertPost.run(v.author, v.title, v.text).lastInsertRowid);
      saveGenres(newId, v.genres);
      return newId;
    });
    res.status(201).json({ post: getPost(id) });
  });

  app.put('/api/posts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!q.postExists.get(id)) return res.status(404).json({ error: 'Not found.' });
    const v = parsePost(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    tx(() => { q.updatePost.run(v.author, v.title, v.text, id); saveGenres(id, v.genres); });
    res.json({ post: getPost(id) });
  });

  app.delete('/api/posts/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!q.postExists.get(id)) return res.status(404).json({ error: 'Not found.' });
    q.deletePost.run(id);
    res.json({ ok: true });
  });

  // ---- comments ----
  app.get('/api/posts/:id/comments', (req, res) => {
    const id = Number(req.params.id);
    if (!q.postExists.get(id)) return res.status(404).json({ error: 'Not found.' });
    res.json({
      comments: q.comments.all(id).map((c) => ({ id: c.id, author: c.author, body: c.body, createdAt: c.created_at })),
    });
  });

  app.post('/api/posts/:id/comments', limitWrite, (req, res) => {
    const id = Number(req.params.id);
    if (!q.postExists.get(id)) return res.status(404).json({ error: 'Not found.' });
    const author = cleanName(req.body.author);
    const body = str(req.body.body).trim();
    if (nameError(author)) return res.status(400).json({ error: nameError(author) });
    if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment is required (max 2,000 characters).' });
    q.insertComment.run(id, author, body);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/comments/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!q.commentExists.get(id)) return res.status(404).json({ error: 'Not found.' });
    q.deleteComment.run(id);
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
