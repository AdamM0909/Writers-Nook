(() => {
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  let me = null;
  let config = { genres: [], maxGenres: 3 };

  // All user content goes through textContent, never innerHTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }
  function go(path) { history.pushState(null, '', path); render(); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a && e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', render);
  const link = (href, text, cls) => h('a', { href, 'data-link': true, class: cls }, text);
  const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const authorLink = (name) => link('/u/' + encodeURIComponent(name), name);
  const genreTags = (genres) => genres.map((g) => link('/?genre=' + encodeURIComponent(g), g, 'tag'));
  const readTime = (words) => `${Math.max(1, Math.round(words / 200))} min read`;

  function renderNav() {
    $nav.replaceChildren(...(me ? [
      link('/new', '+ Write'),
      link('/u/' + encodeURIComponent(me.username), me.username),
      link('/settings', 'Settings'),
      h('button', { class: 'link', onclick: async () => { await api('POST', '/api/logout', {}); me = null; go('/'); } }, 'Log out'),
    ] : [link('/login', 'Log in'), link('/register', 'Join')]));
  }

  function likeButton(p) {
    const btn = h('button', { class: 'like' + (p.liked ? ' on' : ''), title: me ? 'Like' : 'Log in to like' });
    const paint = () => { btn.textContent = `${p.liked ? '♥' : '♡'} ${p.likes}`; btn.classList.toggle('on', p.liked); };
    btn.addEventListener('click', async () => {
      if (!me) return go('/login');
      const r = await api('PUT', `/api/posts/${p.id}/like`, { liked: !p.liked });
      p.liked = r.liked; p.likes = r.likes; paint();
    });
    paint();
    return btn;
  }

  function postCard(p) {
    const excerpt = p.body.length > 300 ? p.body.slice(0, 300).trimEnd() + '…' : p.body;
    return h('article', { class: 'card' },
      h('h2', {}, link('/post/' + p.id, p.title)),
      h('div', { class: 'meta' }, 'by ', authorLink(p.author), ` · ${when(p.createdAt)} · ${readTime(p.words)}`, genreTags(p.genres)),
      h('div', { class: 'excerpt' }, excerpt),
      h('div', { class: 'meta stats' }, `♥ ${p.likes}  ·  💬 ${p.comments}`));
  }

  async function home(params) {
    const genre = params.get('genre') || '';
    const author = params.get('author') || '';
    const search = params.get('q') || '';
    const list = h('div');
    const more = h('button', { class: 'more' }, 'Load more');
    let offset = 0;
    const load = async () => {
      const qs = new URLSearchParams({ offset });
      if (genre) qs.set('genre', genre);
      if (author) qs.set('author', author);
      if (search) qs.set('q', search);
      const { posts, hasMore } = await api('GET', '/api/posts?' + qs);
      offset += posts.length;
      list.append(...posts.map(postCard));
      if (!offset) list.append(h('p', { class: 'empty' }, search || genre ? 'Nothing matches that.' : 'Nothing here yet. Be the first to write something!'));
      more.hidden = !hasMore;
    };
    more.addEventListener('click', load);

    const apply = () => { const p = new URLSearchParams(); if (select.value) p.set('genre', select.value); if (box.value.trim()) p.set('q', box.value.trim()); go('/?' + p); };
    const select = h('select', { onchange: apply },
      h('option', { value: '' }, 'All genres'), h('option', { value: 'none', selected: genre === 'none' }, 'Untagged'),
      config.genres.map((g) => h('option', { value: g, selected: g === genre }, g)));
    const box = h('input', { type: 'search', placeholder: 'Search writing…', value: search });
    $app.replaceChildren(
      h('form', { class: 'filters', onsubmit: (e) => { e.preventDefault(); apply(); } }, box, select),
      author ? h('p', {}, 'Writing by ', h('strong', {}, author), ' · ', link('/', 'show everyone')) : null,
      list, more);
    await load();
  }

  async function commentsSection(postId) {
    const box = h('div');
    const err = h('div', { class: 'error' });
    const text = h('textarea', { maxlength: 2000, placeholder: 'Leave a kind word…', class: 'short', required: true });
    async function refresh() {
      const { comments } = await api('GET', `/api/posts/${postId}/comments`);
      box.replaceChildren(...comments.map((c) => h('div', { class: 'comment' },
        h('div', { class: 'meta' }, authorLink(c.author), ' · ' + when(c.createdAt),
          c.canDelete ? h('button', { class: 'link', onclick: async () => { await api('DELETE', '/api/comments/' + c.id); refresh(); } }, ' delete') : null),
        h('div', { class: 'body' }, c.body))));
    }
    await refresh();
    return h('section', {}, h('h3', {}, 'Comments'), box,
      me ? h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', `/api/posts/${postId}/comments`, { body: text.value }); text.value = ''; err.textContent = ''; refresh(); }
        catch (ex) { err.textContent = ex.message; }
      } }, text, err, h('button', { type: 'submit' }, 'Comment'))
        : h('p', { class: 'meta' }, link('/login', 'Log in'), ' to comment.'));
  }

  async function postPage(id) {
    const { post: p } = await api('GET', '/api/posts/' + id);
    const actions = h('div', { class: 'actions' }, likeButton(p),
      p.mine ? [link('/edit/' + p.id, 'Edit'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm('Delete this piece for good?')) return;
          await api('DELETE', '/api/posts/' + p.id); go('/');
        } }, 'Delete')] : null);
    document.title = p.title + " · Writer's Nook";
    $app.replaceChildren(h('article', { class: 'card' },
      h('h2', {}, p.title),
      h('div', { class: 'meta' }, 'by ', authorLink(p.author), ` · ${when(p.createdAt)}${p.updatedAt !== p.createdAt ? ' (edited)' : ''} · ${readTime(p.words)}`, genreTags(p.genres)),
      h('div', { class: 'body' }, p.body), actions), await commentsSection(p.id));
  }

  async function editor(id) {
    if (!me) return go('/login');
    const p = id ? (await api('GET', '/api/posts/' + id)).post : { title: '', body: '', genres: [] };
    if (id && !p.mine) return go('/post/' + id);
    const err = h('div', { class: 'error' });
    const title = h('input', { maxlength: 150, required: true, value: p.title });
    const body = h('textarea', { required: true, value: p.body });
    const count = h('span', { class: 'meta' });
    const boxes = config.genres.map((g) => h('input', { type: 'checkbox', value: g, checked: p.genres.includes(g) }));
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      count.textContent = `${n}/${config.maxGenres} chosen`;
      boxes.forEach((b) => { b.disabled = !b.checked && n >= config.maxGenres; });
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();
    $app.replaceChildren(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const payload = { title: title.value, body: body.value, genres: boxes.filter((b) => b.checked).map((b) => b.value) };
          const { post } = id ? await api('PUT', '/api/posts/' + id, payload) : await api('POST', '/api/posts', payload);
          go('/post/' + post.id);
        } catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, id ? 'Edit your writing' : 'Share something'),
      h('label', {}, 'Title', title),
      h('fieldset', {}, h('legend', {}, 'Genres (optional, pick up to ' + config.maxGenres + ') ', count),
        h('div', { class: 'genres' }, config.genres.map((g, i) => h('label', { class: 'check' }, boxes[i], g)))),
      h('label', {}, 'Your writing', body), err, h('button', { type: 'submit' }, id ? 'Save' : 'Publish')));
  }

  async function profile(name) {
    const { user } = await api('GET', '/api/users/' + encodeURIComponent(name));
    document.title = user.username + " · Writer's Nook";
    const params = new URLSearchParams({ author: user.username });
    const holder = h('div');
    $app.replaceChildren(
      h('div', { class: 'card' }, h('h2', {}, user.username),
        h('div', { class: 'meta' }, `Joined ${when(user.joined)} · ${user.posts} piece${user.posts === 1 ? '' : 's'}`),
        user.bio ? h('p', { class: 'body' }, user.bio) : null,
        me && me.username.toLowerCase() === user.username.toLowerCase() ? link('/settings', 'Edit profile') : null),
      holder);
    const { posts } = await api('GET', '/api/posts?' + params);
    holder.replaceChildren(...(posts.length ? posts.map(postCard) : [h('p', { class: 'empty' }, 'No writing yet.')]));
  }

  async function settings() {
    if (!me) return go('/login');
    const { user } = await api('GET', '/api/users/' + encodeURIComponent(me.username));
    const bioErr = h('div', { class: 'error' });
    const bio = h('textarea', { class: 'short', maxlength: 500, value: user.bio });
    const pwErr = h('div', { class: 'error' });
    const cur = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
    const next = h('input', { type: 'password', required: true, autocomplete: 'new-password' });
    const ok = (el, msg) => { el.textContent = msg; el.style.color = 'green'; };
    const bad = (el, msg) => { el.textContent = msg; el.style.color = ''; };
    $app.replaceChildren(
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('PUT', '/api/me/profile', { bio: bio.value }); ok(bioErr, 'Saved.'); } catch (ex) { bad(bioErr, ex.message); }
      } }, h('h2', {}, 'About you'), h('label', {}, 'Bio (shown on your profile)', bio), bioErr, h('button', { type: 'submit' }, 'Save bio')),
      h('form', { class: 'card', onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/me/password', { current: cur.value, next: next.value }); cur.value = next.value = ''; ok(pwErr, 'Password changed.'); }
        catch (ex) { bad(pwErr, ex.message); }
      } }, h('h2', {}, 'Change password'), h('label', {}, 'Current password', cur), h('label', {}, 'New password (8+ characters)', next), pwErr, h('button', { type: 'submit' }, 'Change password')));
  }

  function authForm(mode) {
    const reg = mode === 'register';
    const err = h('div', { class: 'error' });
    const user = h('input', { autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', required: true, autocomplete: reg ? 'new-password' : 'current-password' });
    $app.replaceChildren(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          ({ user: me } = await api('POST', reg ? '/api/register' : '/api/login', { username: user.value, password: pass.value }));
          go('/');
        } catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, reg ? 'Join the Nook' : 'Welcome back'),
      h('label', {}, 'Username', user),
      h('label', {}, reg ? 'Password (8+ characters)' : 'Password', pass),
      err, h('button', { type: 'submit' }, reg ? 'Create account' : 'Log in'),
      reg ? h('p', { class: 'meta' }, 'Already have an account? ', link('/login', 'Log in'))
        : h('p', { class: 'meta' }, 'New here? ', link('/register', 'Join'))));
  }

  async function render() {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    document.title = "Writer's Nook";
    renderNav();
    try {
      let m;
      if (path === '/login') authForm('login');
      else if (path === '/register') authForm('register');
      else if (path === '/settings') await settings();
      else if (path === '/new') await editor();
      else if ((m = path.match(/^\/edit\/(\d+)$/))) await editor(m[1]);
      else if ((m = path.match(/^\/post\/(\d+)$/))) await postPage(m[1]);
      else if ((m = path.match(/^\/u\/([^/]+)$/))) await profile(decodeURIComponent(m[1]));
      else await home(params);
    } catch (e) {
      $app.replaceChildren(h('p', { class: 'empty' }, e.message));
    }
    window.scrollTo(0, 0);
  }

  (async () => {
    [config, { user: me }] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/me')]);
    render();
  })();
})();
