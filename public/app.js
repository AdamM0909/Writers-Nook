(() => {
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  let me = null;
  let config = { genres: [], signupCodeRequired: false };

  // All user content goes through textContent, never innerHTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
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

  function renderNav() {
    $nav.replaceChildren(...(me ? [
      link('/new', '+ Write'),
      link('/?author=' + encodeURIComponent(me.username), 'My writing'),
      h('span', { class: 'meta' }, me.username),
      h('button', { class: 'link', onclick: async () => { await api('POST', '/api/logout', {}); me = null; go('/'); } }, 'Log out'),
    ] : [link('/login', 'Log in'), link('/register', 'Join')]));
  }

  function postCard(p) {
    const excerpt = p.body.length > 300 ? p.body.slice(0, 300).trimEnd() + '…' : p.body;
    return h('article', { class: 'card' },
      h('h2', {}, link('/post/' + p.id, p.title)),
      h('div', { class: 'meta' },
        'by ', link('/?author=' + encodeURIComponent(p.author), p.author), ' · ' + when(p.createdAt),
        p.genre ? link('/?genre=' + encodeURIComponent(p.genre), p.genre, 'tag') : null),
      h('div', { class: 'excerpt' }, excerpt));
  }

  async function home(params) {
    const genre = params.get('genre') || '';
    const author = params.get('author') || '';
    const qs = new URLSearchParams();
    if (genre) qs.set('genre', genre);
    if (author) qs.set('author', author);
    const { posts } = await api('GET', '/api/posts?' + qs);
    const tab = (g, label) => link(g ? '/?genre=' + encodeURIComponent(g) : '/', label, g === genre ? 'on' : '');
    $app.replaceChildren(
      author ? h('p', {}, 'Writing by ', h('strong', {}, author), ' · ', link('/', 'show everyone')) : null,
      h('div', { class: 'filters' }, tab('', 'All'), config.genres.map((g) => tab(g, g)), tab('none', 'Untagged')),
      posts.length ? posts.map(postCard) : h('p', { class: 'empty' }, 'Nothing here yet.'));
  }

  async function postPage(id) {
    const { post: p } = await api('GET', '/api/posts/' + id);
    const actions = p.mine ? h('div', { class: 'actions' },
      link('/edit/' + p.id, 'Edit'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete this piece for good?')) return;
        await api('DELETE', '/api/posts/' + p.id); go('/');
      } }, 'Delete')) : null;
    $app.replaceChildren(h('article', { class: 'card' },
      h('h2', {}, p.title),
      h('div', { class: 'meta' }, 'by ', link('/?author=' + encodeURIComponent(p.author), p.author), ' · ' + when(p.createdAt),
        p.updatedAt !== p.createdAt ? ' (edited)' : '',
        p.genre ? link('/?genre=' + encodeURIComponent(p.genre), p.genre, 'tag') : null),
      h('div', { class: 'body' }, p.body), actions));
  }

  async function editor(id) {
    if (!me) return go('/login');
    const p = id ? (await api('GET', '/api/posts/' + id)).post : { title: '', body: '', genre: null };
    if (id && !p.mine) return go('/post/' + id);
    const err = h('div', { class: 'error' });
    const title = h('input', { maxlength: 150, required: true, value: p.title });
    const body = h('textarea', { required: true }); body.value = p.body;
    const genre = h('select', {}, h('option', { value: '' }, 'No genre'),
      config.genres.map((g) => h('option', { value: g, selected: g === p.genre }, g)));
    $app.replaceChildren(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const payload = { title: title.value, body: body.value, genre: genre.value };
          const { post } = id ? await api('PUT', '/api/posts/' + id, payload) : await api('POST', '/api/posts', payload);
          go('/post/' + post.id);
        } catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, id ? 'Edit your writing' : 'Share something'),
      h('label', {}, 'Title', title), h('label', {}, 'Genre (optional)', genre),
      h('label', {}, 'Your writing', body), err, h('button', { type: 'submit' }, id ? 'Save' : 'Publish')));
  }

  function authForm(mode) {
    const reg = mode === 'register';
    const err = h('div', { class: 'error' });
    const user = h('input', { autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', required: true, autocomplete: reg ? 'new-password' : 'current-password' });
    const code = h('input', { required: true });
    $app.replaceChildren(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const payload = { username: user.value, password: pass.value };
          if (reg && config.signupCodeRequired) payload.code = code.value;
          ({ user: me } = await api('POST', reg ? '/api/register' : '/api/login', payload));
          renderNav(); go('/');
        } catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, reg ? 'Join the Nook' : 'Welcome back'),
      h('label', {}, 'Username', user),
      h('label', {}, reg ? 'Password (8+ characters)' : 'Password', pass),
      reg && config.signupCodeRequired ? h('label', {}, 'Invite code', code) : null,
      err, h('button', { type: 'submit' }, reg ? 'Create account' : 'Log in')));
  }

  async function render() {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    renderNav();
    try {
      let m;
      if (path === '/login') authForm('login');
      else if (path === '/register') authForm('register');
      else if (path === '/new') await editor();
      else if ((m = path.match(/^\/edit\/(\d+)$/))) await editor(m[1]);
      else if ((m = path.match(/^\/post\/(\d+)$/))) await postPage(m[1]);
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
