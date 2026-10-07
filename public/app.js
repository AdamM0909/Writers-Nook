(() => {
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');
  let admin = false;
  let config = { genres: [], maxGenres: 3, adminEnabled: false };

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
  // Remember the visitor's name on this device (best effort; storage can be blocked).
  const savedName = () => { try { return localStorage.getItem('nook-name') || ''; } catch { return ''; } };
  const saveName = (n) => { try { localStorage.setItem('nook-name', n); } catch { /* ignore */ } };

  function go(path) { history.pushState(null, '', path); render(); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a && e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });
  window.addEventListener('popstate', render);
  const link = (href, text, cls) => h('a', { href, 'data-link': true, class: cls }, text);
  const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const authorLink = (name) => link('/?author=' + encodeURIComponent(name), name);
  const genreTags = (genres) => genres.map((g) => link('/?genre=' + encodeURIComponent(g), g, 'tag'));
  const readTime = (words) => `${Math.max(1, Math.round(words / 200))} min read`;

  function renderNav() {
    $nav.replaceChildren(
      link('/new', '+ Write'),
      admin
        ? [h('span', { class: 'meta' }, 'Admin'),
          h('button', { class: 'link', onclick: async () => { await api('POST', '/api/admin/logout', {}); admin = false; go('/'); } }, 'Log out')]
        : link('/admin', 'Admin'));
  }

  function postCard(p) {
    const excerpt = p.body.length > 300 ? p.body.slice(0, 300).trimEnd() + '…' : p.body;
    return h('article', { class: 'card' },
      h('h2', {}, link('/post/' + p.id, p.title)),
      h('div', { class: 'meta' }, 'by ', authorLink(p.author), ` · ${when(p.createdAt)} · ${readTime(p.words)}`, genreTags(p.genres)),
      h('div', { class: 'excerpt' }, excerpt),
      h('div', { class: 'meta stats' }, `💬 ${p.comments}`));
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
      if (!offset) list.append(h('p', { class: 'empty' }, search || genre || author ? 'Nothing matches that.' : 'Nothing here yet. Be the first to write something!'));
      more.hidden = !hasMore;
    };
    more.addEventListener('click', load);

    const apply = () => {
      const p = new URLSearchParams();
      if (select.value) p.set('genre', select.value);
      if (box.value.trim()) p.set('q', box.value.trim());
      go('/?' + p);
    };
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
    const name = h('input', { maxlength: 40, required: true, placeholder: 'Your name', value: savedName() });
    const text = h('textarea', { maxlength: 2000, placeholder: 'Leave a kind word…', class: 'short', required: true });
    async function refresh() {
      const { comments } = await api('GET', `/api/posts/${postId}/comments`);
      box.replaceChildren(...comments.map((c) => h('div', { class: 'comment' },
        h('div', { class: 'meta' }, authorLink(c.author), ' · ' + when(c.createdAt),
          admin ? h('button', { class: 'link', onclick: async () => { await api('DELETE', '/api/comments/' + c.id); refresh(); } }, ' delete') : null),
        h('div', { class: 'body' }, c.body))));
    }
    await refresh();
    return h('section', {}, h('h3', {}, 'Comments'), box,
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', `/api/posts/${postId}/comments`, { author: name.value, body: text.value });
          saveName(name.value.trim()); text.value = ''; err.textContent = ''; refresh();
        } catch (ex) { err.textContent = ex.message; }
      } }, name, text, err, h('button', { type: 'submit' }, 'Comment')));
  }

  async function postPage(id) {
    const { post: p } = await api('GET', '/api/posts/' + id);
    const actions = admin ? h('div', { class: 'actions' },
      link('/edit/' + p.id, 'Edit'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete this piece for good?')) return;
        await api('DELETE', '/api/posts/' + p.id); go('/');
      } }, 'Delete')) : null;
    document.title = p.title + " · Writer's Nook";
    $app.replaceChildren(h('article', { class: 'card' },
      h('h2', {}, p.title),
      h('div', { class: 'meta' }, 'by ', authorLink(p.author), ` · ${when(p.createdAt)}${p.updatedAt !== p.createdAt ? ' (edited)' : ''} · ${readTime(p.words)}`, genreTags(p.genres)),
      h('div', { class: 'body' }, p.body), actions), await commentsSection(p.id));
  }

  async function editor(id) {
    if (id && !admin) return go('/admin');
    const p = id ? (await api('GET', '/api/posts/' + id)).post : { author: savedName(), title: '', body: '', genres: [] };
    const err = h('div', { class: 'error' });
    const author = h('input', { maxlength: 40, required: true, value: p.author, placeholder: 'Your name' });
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
          const payload = { author: author.value, title: title.value, body: body.value, genres: boxes.filter((b) => b.checked).map((b) => b.value) };
          const { post } = id ? await api('PUT', '/api/posts/' + id, payload) : await api('POST', '/api/posts', payload);
          if (!id) saveName(author.value.trim());
          go('/post/' + post.id);
        } catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, id ? 'Edit this piece' : 'Share something'),
      h('label', {}, 'Your name (shown as the author)', author),
      h('label', {}, 'Title', title),
      h('fieldset', {}, h('legend', {}, 'Genres (optional, pick up to ' + config.maxGenres + ') ', count),
        h('div', { class: 'genres' }, config.genres.map((g, i) => h('label', { class: 'check' }, boxes[i], g)))),
      h('label', {}, 'Your writing', body),
      id ? null : h('p', { class: 'meta' }, 'Once posted, only the site admin can edit or delete it, so give it a quick read first.'),
      err, h('button', { type: 'submit' }, id ? 'Save' : 'Publish')));
  }

  function adminPage() {
    if (admin) return go('/');
    const err = h('div', { class: 'error' });
    const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
    $app.replaceChildren(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await api('POST', '/api/admin/login', { password: pass.value }); admin = true; go('/'); }
        catch (ex) { err.textContent = ex.message; }
      } },
      h('h2', {}, 'Admin'),
      h('p', { class: 'meta' }, config.adminEnabled ? 'Enter the admin password to edit or delete posts and comments.' : 'Admin is not set up on this site yet.'),
      h('label', {}, 'Admin password', pass), err, h('button', { type: 'submit' }, 'Log in')));
  }

  async function render() {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    document.title = "Writer's Nook";
    renderNav();
    try {
      let m;
      if (path === '/admin') adminPage();
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
    let me;
    [config, me] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/me')]);
    admin = me.admin;
    render();
  })();
})();
