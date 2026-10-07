const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');

let server, base;
before(async () => {
  server = createApp({ secret: 'test', adminPassword: 'sesame', loginLimit: 1000, writeLimit: 1000 }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// Minimal client that keeps its own cookie jar.
function client(root = () => base) {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(root() + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = set.join('; ');
    return { status: res.status, data: await res.json() };
  };
}
const adminClient = async () => {
  const c = client();
  assert.strictEqual((await c('POST', '/api/admin/login', { password: 'sesame' })).status, 200);
  return c;
};

test('anyone can post without an account, and everyone can read', async () => {
  const anon = client();
  const r = await anon('POST', '/api/posts', { author: '  Mia   Rose ', title: 'Hello', body: 'First words', genres: ['Gothic'] });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.post.author, 'Mia Rose'); // whitespace tidied
  const other = client();
  const list = (await other('GET', '/api/posts')).data.posts;
  assert.ok(list.some((p) => p.title === 'Hello' && p.author === 'Mia Rose'));
  assert.strictEqual((await other('GET', `/api/posts/${r.data.post.id}`)).status, 200);
});

test('a name is required on posts and comments', async () => {
  const c = client();
  for (const author of [undefined, '', '   ', 'x'.repeat(41)]) {
    assert.strictEqual((await c('POST', '/api/posts', { author, title: 't', body: 'b' })).status, 400, `post author=${author}`);
  }
  const id = (await c('POST', '/api/posts', { author: 'Sam', title: 't', body: 'b' })).data.post.id;
  assert.strictEqual((await c('POST', `/api/posts/${id}/comments`, { body: 'hi' })).status, 400);
  assert.strictEqual((await c('POST', `/api/posts/${id}/comments`, { author: 'Lee', body: 'hi' })).status, 201);
});

test('only the admin can edit or delete posts and comments', async () => {
  const id = (await client()('POST', '/api/posts', { author: 'Ann', title: 'Mine', body: 'Original' })).data.post.id;
  await client()('POST', `/api/posts/${id}/comments`, { author: 'Bo', body: 'nice' });
  const cid = (await client()('GET', `/api/posts/${id}/comments`)).data.comments[0].id;

  const visitor = client();
  const edit = { author: 'Ann', title: 'Hacked', body: 'Hacked' };
  assert.strictEqual((await visitor('PUT', `/api/posts/${id}`, edit)).status, 403);
  assert.strictEqual((await visitor('DELETE', `/api/posts/${id}`)).status, 403);
  assert.strictEqual((await visitor('DELETE', `/api/comments/${cid}`)).status, 403);
  assert.strictEqual((await visitor('POST', '/api/admin/login', { password: 'wrong' })).status, 403);
  assert.strictEqual((await visitor('PUT', `/api/posts/${id}`, edit)).status, 403); // still locked out
  assert.strictEqual((await client()('GET', `/api/posts/${id}`)).data.post.body, 'Original');

  const admin = await adminClient();
  assert.strictEqual((await admin('GET', '/api/me')).data.admin, true);
  assert.strictEqual((await admin('PUT', `/api/posts/${id}`, { author: 'Ann', title: 'Mine', body: 'Fixed typo', genres: ['Poetry'] })).status, 200);
  assert.strictEqual((await visitor('GET', `/api/posts/${id}`)).data.post.body, 'Fixed typo');
  assert.strictEqual((await admin('DELETE', `/api/comments/${cid}`)).status, 200);
  assert.strictEqual((await admin('DELETE', `/api/posts/${id}`)).status, 200);
  assert.strictEqual((await admin('GET', `/api/posts/${id}`)).status, 404);
});

test('a forged admin cookie does not work, and logging out revokes access', async () => {
  const id = (await client()('POST', '/api/posts', { author: 'Cy', title: 't', body: 'b' })).data.post.id;
  const forged = await client()('DELETE', `/api/posts/${id}`, null, { cookie: 'nook=eyJhZG1pbiI6InguIn0=' });
  assert.strictEqual(forged.status, 403);
  const admin = await adminClient();
  await admin('POST', '/api/admin/logout', {});
  assert.strictEqual((await admin('DELETE', `/api/posts/${id}`)).status, 403);
});

test('with no admin password configured, nobody is admin', async () => {
  const s = createApp({ secret: 't' }).listen(0);
  try {
    const c = client(() => `http://localhost:${s.address().port}`);
    assert.strictEqual((await c('POST', '/api/admin/login', { password: '' })).status, 404);
    assert.strictEqual((await c('DELETE', '/api/posts/1')).status, 403);
  } finally { s.close(); }
});

test('genres: multiple, optional, validated, capped and filterable', async () => {
  const c = client();
  const ok = await c('POST', '/api/posts', { author: 'Di', title: 'Tagged', body: 'a', genres: ['Horror', 'Adventure'] });
  assert.deepStrictEqual(ok.data.post.genres, ['Adventure', 'Horror']);
  await c('POST', '/api/posts', { author: 'Di', title: 'Loose', body: 'b' });
  assert.strictEqual((await c('POST', '/api/posts', { author: 'Di', title: 'Bad', body: 'c', genres: ['Nonsense'] })).status, 400);
  assert.strictEqual((await c('POST', '/api/posts', { author: 'Di', title: 'Many', body: 'c', genres: ['Horror', 'Gothic', 'Poetry', 'Essay'] })).status, 400);

  const horror = (await c('GET', '/api/posts?genre=Horror')).data.posts;
  assert.ok(horror.length && horror.every((p) => p.genres.includes('Horror')));
  const none = (await c('GET', '/api/posts?genre=none')).data.posts;
  assert.ok(none.some((p) => p.title === 'Loose') && none.every((p) => p.genres.length === 0));
});

test('search covers title, body and author, and treats % literally; author filter ignores case', async () => {
  const c = client();
  await c('POST', '/api/posts', { author: 'Zelda Quill', title: 'Lighthouse', body: 'The keeper climbed 100% of the stairs' });
  const count = async (qs) => (await c('GET', '/api/posts?' + qs)).data.posts.length;
  assert.strictEqual(await count('q=lighthouse'), 1);
  assert.strictEqual(await count('q=keeper'), 1);
  assert.strictEqual(await count('q=zelda'), 1);
  assert.strictEqual(await count('q=100%25'), 1);
  assert.strictEqual(await count('q=zzzz'), 0);
  assert.strictEqual(await count('author=zelda%20quill'), 1);
});

test('pagination reports hasMore', async () => {
  const c = client();
  for (let i = 0; i < 22; i++) await c('POST', '/api/posts', { author: 'Pagey', title: 'P' + i, body: 'x' });
  const page1 = (await c('GET', '/api/posts?author=Pagey')).data;
  assert.strictEqual(page1.posts.length, 20);
  assert.strictEqual(page1.hasMore, true);
  const page2 = (await c('GET', '/api/posts?author=Pagey&offset=20')).data;
  assert.strictEqual(page2.posts.length, 2);
  assert.strictEqual(page2.hasMore, false);
});

test('admin login and posting are rate limited', async () => {
  const s = createApp({ secret: 't', adminPassword: 'pw', loginLimit: 3, writeLimit: 2 }).listen(0);
  try {
    const c = client(() => `http://localhost:${s.address().port}`);
    const login = [];
    for (let i = 0; i < 5; i++) login.push((await c('POST', '/api/admin/login', { password: 'bad' })).status);
    assert.deepStrictEqual(login, [403, 403, 403, 429, 429]);
    const post = [];
    for (let i = 0; i < 4; i++) post.push((await c('POST', '/api/posts', { author: 'Spam', title: 't', body: 'b' })).status);
    assert.deepStrictEqual(post, [201, 201, 429, 429]);
  } finally { s.close(); }
});

test('cross-site style form posts are rejected', async () => {
  const res = await fetch(base + '/api/posts', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.strictEqual(res.status, 415);
});
