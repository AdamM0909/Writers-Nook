const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');

let server, base;
before(async () => {
  server = createApp({ secret: 'test', signupCode: 'friends' }).listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

// Minimal client that keeps its own cookie jar.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
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
  const r = await c('POST', '/api/register', { username: name, password: 'password123', code: 'friends' });
  assert.strictEqual(r.status, 201);
  return c;
};

test('registration needs the invite code', async () => {
  const r = await client()('POST', '/api/register', { username: 'sneaky', password: 'password123', code: 'nope' });
  assert.strictEqual(r.status, 403);
});

test('logged-out users can read but not write', async () => {
  const anon = client();
  assert.strictEqual((await anon('GET', '/api/posts')).status, 200);
  assert.strictEqual((await anon('POST', '/api/posts', { title: 'x', body: 'y' })).status, 401);
});

test('only the author can edit or delete a post', async () => {
  const alice = await join('alice');
  const bob = await join('bob');
  const { data } = await alice('POST', '/api/posts', { title: 'Mine', body: 'Original', genre: 'Poetry' });
  const id = data.post.id;

  assert.strictEqual((await bob('PUT', `/api/posts/${id}`, { title: 'Hacked', body: 'Hacked' })).status, 403);
  assert.strictEqual((await bob('DELETE', `/api/posts/${id}`)).status, 403);
  assert.strictEqual((await client()('PUT', `/api/posts/${id}`, { title: 'a', body: 'b' })).status, 401);

  const seenByBob = (await bob('GET', `/api/posts/${id}`)).data.post;
  assert.strictEqual(seenByBob.body, 'Original');
  assert.strictEqual(seenByBob.mine, false);

  assert.strictEqual((await alice('PUT', `/api/posts/${id}`, { title: 'Mine', body: 'Edited', genre: '' })).status, 200);
  assert.strictEqual((await alice('GET', `/api/posts/${id}`)).data.post.genre, null);
  assert.strictEqual((await alice('DELETE', `/api/posts/${id}`)).status, 200);
});

test('genre tags are optional, validated and filterable', async () => {
  const carol = await join('carol');
  await carol('POST', '/api/posts', { title: 'Tagged', body: 'a', genre: 'Horror' });
  await carol('POST', '/api/posts', { title: 'Loose', body: 'b' });
  assert.strictEqual((await carol('POST', '/api/posts', { title: 'Bad', body: 'c', genre: 'Nonsense' })).status, 400);

  const horror = (await carol('GET', '/api/posts?genre=Horror')).data.posts;
  assert.ok(horror.length && horror.every((p) => p.genre === 'Horror'));
  const none = (await carol('GET', '/api/posts?genre=none')).data.posts;
  assert.ok(none.some((p) => p.title === 'Loose') && none.every((p) => p.genre === null));
});

test('login works and bad passwords fail', async () => {
  const c = client();
  assert.strictEqual((await c('POST', '/api/login', { username: 'ALICE', password: 'wrongpass1' })).status, 401);
  assert.strictEqual((await c('POST', '/api/login', { username: 'ALICE', password: 'password123' })).status, 200);
});
