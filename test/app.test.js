const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');

let server, base;
before(async () => {
  server = createApp({ secret: 'test', authLimit: 1000 }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// Minimal client that keeps its own cookie jar.
function client(root = () => base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(root() + url, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = set.join('; ');
    return { status: res.status, data: await res.json() };
  };
}
const join = async (name) => {
  const c = client();
  const r = await c('POST', '/api/register', { username: name, password: 'password123' });
  assert.strictEqual(r.status, 201);
  return c;
};

test('anyone can sign up (no invite code)', async () => {
  await join('newcomer');
  const dup = await client()('POST', '/api/register', { username: 'NEWCOMER', password: 'password123' });
  assert.strictEqual(dup.status, 409);
});

test('logged-out users can read but not write', async () => {
  const anon = client();
  assert.strictEqual((await anon('GET', '/api/posts')).status, 200);
  assert.strictEqual((await anon('POST', '/api/posts', { title: 'x', body: 'y' })).status, 401);
  assert.strictEqual((await anon('PUT', '/api/posts/1/like', {})).status, 401);
});

test('only the author can edit or delete a post', async () => {
  const alice = await join('alice');
  const bob = await join('bob');
  const { data } = await alice('POST', '/api/posts', { title: 'Mine', body: 'Original', genres: ['Gothic'] });
  const id = data.post.id;

  assert.strictEqual((await bob('PUT', `/api/posts/${id}`, { title: 'Hacked', body: 'Hacked' })).status, 403);
  assert.strictEqual((await bob('DELETE', `/api/posts/${id}`)).status, 403);
  assert.strictEqual((await client()('PUT', `/api/posts/${id}`, { title: 'a', body: 'b' })).status, 401);

  const seenByBob = (await bob('GET', `/api/posts/${id}`)).data.post;
  assert.strictEqual(seenByBob.body, 'Original');
  assert.strictEqual(seenByBob.mine, false);

  assert.strictEqual((await alice('PUT', `/api/posts/${id}`, { title: 'Mine', body: 'Edited', genres: [] })).status, 200);
  assert.deepStrictEqual((await alice('GET', `/api/posts/${id}`)).data.post.genres, []);
  assert.strictEqual((await alice('DELETE', `/api/posts/${id}`)).status, 200);
  assert.strictEqual((await alice('GET', `/api/posts/${id}`)).status, 404);
});

test('genres: multiple, optional, validated, capped and filterable', async () => {
  const carol = await join('carol');
  const ok = await carol('POST', '/api/posts', { title: 'Tagged', body: 'a', genres: ['Horror', 'Adventure'] });
  assert.deepStrictEqual(ok.data.post.genres, ['Adventure', 'Horror']);
  await carol('POST', '/api/posts', { title: 'Loose', body: 'b' });
  assert.strictEqual((await carol('POST', '/api/posts', { title: 'Bad', body: 'c', genres: ['Nonsense'] })).status, 400);
  assert.strictEqual((await carol('POST', '/api/posts', { title: 'Many', body: 'c', genres: ['Horror', 'Gothic', 'Poetry', 'Essay'] })).status, 400);

  const horror = (await carol('GET', '/api/posts?genre=Horror')).data.posts;
  assert.ok(horror.length && horror.every((p) => p.genres.includes('Horror')));
  const none = (await carol('GET', '/api/posts?genre=none')).data.posts;
  assert.ok(none.some((p) => p.title === 'Loose') && none.every((p) => p.genres.length === 0));
});

test('search finds title and body text, and treats % literally', async () => {
  const dan = await join('dan');
  await dan('POST', '/api/posts', { title: 'Lighthouse', body: 'The keeper climbed 100% of the stairs' });
  assert.strictEqual((await dan('GET', '/api/posts?q=lighthouse')).data.posts.length, 1);
  assert.strictEqual((await dan('GET', '/api/posts?q=keeper')).data.posts.length, 1);
  assert.strictEqual((await dan('GET', '/api/posts?q=100%25')).data.posts.length, 1);
  assert.strictEqual((await dan('GET', '/api/posts?q=%25')).data.posts.length, 1);
  assert.strictEqual((await dan('GET', '/api/posts?q=zzzz')).data.posts.length, 0);
});

test('likes toggle and count once per user', async () => {
  const erin = await join('erin');
  const fay = await join('fay');
  const id = (await erin('POST', '/api/posts', { title: 'Likeable', body: 'x' })).data.post.id;
  await fay('PUT', `/api/posts/${id}/like`, { liked: true });
  const again = await fay('PUT', `/api/posts/${id}/like`, { liked: true });
  assert.strictEqual(again.data.likes, 1);
  assert.strictEqual((await fay('GET', `/api/posts/${id}`)).data.post.liked, true);
  assert.strictEqual((await fay('PUT', `/api/posts/${id}/like`, { liked: false })).data.likes, 0);
});

test('comments: author or post owner can delete, others cannot', async () => {
  const gus = await join('gus');
  const hal = await join('hal');
  const ivy = await join('ivy');
  const id = (await gus('POST', '/api/posts', { title: 'Chatty', body: 'x' })).data.post.id;
  assert.strictEqual((await hal('POST', `/api/posts/${id}/comments`, { body: 'nice' })).status, 201);
  assert.strictEqual((await hal('POST', `/api/posts/${id}/comments`, { body: '  ' })).status, 400);
  const cid = (await ivy('GET', `/api/posts/${id}/comments`)).data.comments[0];
  assert.strictEqual(cid.canDelete, false);
  assert.strictEqual((await ivy('DELETE', `/api/comments/${cid.id}`)).status, 403);
  assert.strictEqual((await gus('DELETE', `/api/comments/${cid.id}`)).status, 200); // post owner moderates
});

test('profile bio and password change', async () => {
  const jo = await join('joey');
  assert.strictEqual((await jo('PUT', '/api/me/profile', { bio: 'I write about the sea.' })).status, 200);
  assert.strictEqual((await client()('GET', '/api/users/joey')).data.user.bio, 'I write about the sea.');
  assert.strictEqual((await jo('POST', '/api/me/password', { current: 'wrong', next: 'newpassword1' })).status, 403);
  assert.strictEqual((await jo('POST', '/api/me/password', { current: 'password123', next: 'newpassword1' })).status, 200);
  const c = client();
  assert.strictEqual((await c('POST', '/api/login', { username: 'joey', password: 'password123' })).status, 401);
  assert.strictEqual((await c('POST', '/api/login', { username: 'joey', password: 'newpassword1' })).status, 200);
});

test('pagination reports hasMore', async () => {
  const kai = await join('kai');
  for (let i = 0; i < 22; i++) await kai('POST', '/api/posts', { title: 'P' + i, body: 'x' });
  const page1 = (await kai('GET', '/api/posts?author=kai')).data;
  assert.strictEqual(page1.posts.length, 20);
  assert.strictEqual(page1.hasMore, true);
  const page2 = (await kai('GET', '/api/posts?author=kai&offset=20')).data;
  assert.strictEqual(page2.posts.length, 2);
  assert.strictEqual(page2.hasMore, false);
});

test('login attempts are rate limited', async () => {
  const s = createApp({ secret: 't', authLimit: 3 }).listen(0);
  try {
    const c = client(() => `http://localhost:${s.address().port}`);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await c('POST', '/api/login', { username: 'x', password: 'y' })).status);
    assert.deepStrictEqual(codes, [401, 401, 401, 429, 429]);
  } finally { s.close(); }
});
