/* The natural voice, kept on this device. Downloads once (about 33 MB), then works with no internet.
   The voice itself lives in vendor/voice/ (see the README there); this file downloads, stores and runs it. */
const CACHE = "wn-voice", BASE = "vendor/voice/";
const FILES = [                      // what to fetch, what it's called when stored, and its size once unpacked
  { gz: "kathleen.onnx.gz", name: "kathleen.onnx", size: 31934781, sent: 29174535 },
  { gz: "ort.wasm.gz", name: "ort.wasm", size: 14239897, sent: 3659927 },
  { gz: "phonemize.wasm.gz", name: "phonemize.wasm", size: 635212, sent: 219126 },
  { gz: "phonemize.data.gz", name: "phonemize.data", size: 836496, sent: 445461 },
];
export const DOWNLOAD_BYTES = FILES.reduce((a, f) => a + f.sent, 0);

export const available = () => typeof Worker !== "undefined" && typeof DecompressionStream !== "undefined"
  && typeof WebAssembly === "object" && "caches" in self && !!(window.AudioContext || window.webkitAudioContext);

export async function isInstalled() {
  try {
    const cache = await caches.open(CACHE);
    for (const f of FILES) {
      const r = await cache.match("/wn-voice/" + f.name);
      if (!r || +r.headers.get("content-length") !== f.size) return false;
    }
    return true;
  } catch { return false; }
}

let job = null;
/* Download and store the voice. onProgress(0..1). Safe to call twice: the second call joins the first. */
export function download(onProgress = () => {}) {
  if (job) return job;
  job = (async () => {
    const cache = await caches.open(CACHE);
    let done = 0;
    for (const f of FILES) {
      const res = await fetch(BASE + f.gz);
      if (!res.ok || !res.body) throw new Error("Couldn't reach the voice file (" + res.status + ").");
      const counter = new TransformStream({ transform(chunk, c) { done += chunk.length; onProgress(Math.min(1, done / DOWNLOAD_BYTES)); c.enqueue(chunk); } });
      const raw = await new Response(res.body.pipeThrough(counter).pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (raw.byteLength !== f.size) throw new Error("The voice file arrived damaged. Please try again.");
      await cache.put("/wn-voice/" + f.name, new Response(raw, { headers: { "content-length": String(f.size), "content-type": "application/octet-stream" } }));
    }
    onProgress(1);
  })().finally(() => { job = null; });
  return job;
}
export const downloading = () => !!job;
export async function remove() { stopEngine(); try { await caches.delete(CACHE); } catch { /* nothing stored */ } }

/* ---------- running it ---------- */
let worker = null, ready = null, nextId = 1;
const waiting = new Map();
function stopEngine() { worker?.terminate(); worker = null; ready = null; for (const w of waiting.values()) w.reject(new Error("stopped")); waiting.clear(); }
function boot() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    worker = new Worker(BASE + "engine.js", { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "ready") return resolve();
      const w = waiting.get(m.id);
      if (!w) { if (m.type === "error") reject(new Error(m.message)); return; }
      waiting.delete(m.id);
      if (m.type === "audio") w.resolve(m); else w.reject(new Error(m.message));
    };
    worker.onerror = (e) => { reject(new Error(e.message || "The voice engine couldn't start.")); };
    worker.postMessage({ type: "init" });
  });
  ready.catch(() => { stopEngine(); });
  return ready;
}
export const warmUp = () => boot();
/* -> { samples: Float32Array, rate } */
export async function synthesize(text, speed = 1) {
  await boot();
  const id = nextId++;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ type: "speak", id, text, speed }); });
}
