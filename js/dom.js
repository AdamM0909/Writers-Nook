/* Small helpers shared by every part of the app. Everything is built as DOM nodes, never HTML strings. */
export const $ = (id) => document.getElementById(id);

/* h("button", { class: "btn", onclick: fn, "aria-label": "…" }, "text", childNode) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith("aria-") && typeof v === "boolean") { el.setAttribute(k, String(v)); continue; }   // aria-pressed="true", not ""
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/* Small settings kept in this browser. Never throws: private windows can block storage. */
export const pref = {
  get: (k, d) => { try { return localStorage.getItem("wn-" + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("wn-" + k, v); } catch { /* ignore */ } },
  getJSON: (k, d) => { try { return JSON.parse(localStorage.getItem("wn-" + k)) ?? d; } catch { return d; } },
  setJSON: (k, v) => { try { localStorage.setItem("wn-" + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const uid = () => crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
export const cleanName = (n) => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const motion = { reduce: matchMedia("(prefers-reduced-motion: reduce)").matches };
export const fmtMinutes = (m) => (m < 1 ? "under a minute" : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
export const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

let toastTimer;
/* toast("Saved.")  or  toast("Updated", { action: { label: "Refresh", run: fn } }) */
export function toast(msg, opts = {}) {
  const t = $("toast");
  t.replaceChildren(msg);
  if (opts.action) t.append(" ", h("button", { class: "toast-act", onclick: () => { t.hidden = true; opts.action.run(); } }, opts.action.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), opts.action ? 9000 : 3200);
}

/* A modal sheet built on <dialog>: focus is trapped, Esc and the backdrop close it, the opener gets focus back. */
export function sheet({ title, body, wide = false, onClose }) {
  const dlg = h("dialog", { class: "sheet" + (wide ? " wide" : ""), "aria-label": title });
  const close = () => dlg.close();
  dlg.append(
    h("div", { class: "sheet-head" }, h("h2", { text: title }), h("button", { class: "btn ghost icon-btn", "aria-label": "Close", onclick: close }, "×")),
    h("div", { class: "sheet-body" }, body),
  );
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  const opener = document.activeElement;
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); opener?.focus?.(); });
  (document.fullscreenElement || document.body).append(dlg);
  dlg.showModal();
  return { dlg, close };
}
