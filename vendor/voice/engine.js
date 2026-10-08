/* The natural voice: a Piper neural voice running on your device (no internet needed once downloaded).
   Runs in a Web Worker so reading never freezes the page.
   Messages in:  { type: "init" }  { type: "speak", id, text, speed }
   Messages out: { type: "ready" }  { type: "audio", id, samples, rate }  { type: "error", id, message } */
import createPhonemizer from "./phonemize.mjs";

const CACHE = "wn-voice";
let ort, session, config, files;

async function load() {
  const cache = await caches.open(CACHE);
  files = {};
  for (const name of ["kathleen.onnx", "ort.wasm", "phonemize.wasm", "phonemize.data"]) {
    const r = await cache.match("/wn-voice/" + name);
    if (!r) throw new Error("The voice isn't downloaded yet.");
    files[name] = await r.arrayBuffer();
  }
  config = await (await fetch(new URL("./kathleen.json", import.meta.url))).json();
  const mjs = URL.createObjectURL(new Blob([await (await fetch(new URL("./ort-wasm.mjs", import.meta.url))).text()], { type: "text/javascript" }));
  ort = await import("./ort.min.mjs");
  ort.env.wasm.numThreads = 1;               // GitHub Pages can't enable threads; one is plenty for this small voice
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { mjs, wasm: URL.createObjectURL(new Blob([files["ort.wasm"]], { type: "application/wasm" })) };
  session = await ort.InferenceSession.create(new Uint8Array(files["kathleen.onnx"]), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  files["kathleen.onnx"] = null; files["ort.wasm"] = null;    // the engine keeps its own copy; free ours
}

/* text -> lists of phoneme ids, one list per sentence (the phonemizer is a small espeak-ng build) */
async function phonemize(text) {
  const json = await new Promise(async (resolve, reject) => {
    const t = setTimeout(() => reject(new Error("phonemizer timed out")), 15000);
    try {
      const mod = await createPhonemizer({
        print: (s) => { clearTimeout(t); resolve(JSON.parse(s)); },
        printErr: () => {},
        wasmBinary: files["phonemize.wasm"],
        getPreloadedPackage: (name) => (name.endsWith(".data") ? files["phonemize.data"] : null),
        locateFile: (f) => f,
      });
      mod.callMain(["-l", "en-us", "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]);
    } catch (e) { clearTimeout(t); reject(e); }
  });
  const ids = json.phoneme_ids || [], out = [];
  let cur = [];
  for (let i = 0; i < ids.length; i++) {
    cur.push(ids[i]);
    if (ids[i] === 2 && (ids[i + 1] === 1 || i === ids.length - 1)) { if (cur.length > 4) out.push(cur); cur = []; }
  }
  if (cur.length > 4) out.push(cur);
  return out;
}

async function synth(ids, speed) {
  const n = ids.length, inf = config.inference;
  const feeds = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, n]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(n)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale, inf.length_scale / speed, inf.noise_w]), [3]),
  };
  const out = await session.run(feeds);
  const raw = out.output.data;
  let peak = 0; for (let i = 0; i < raw.length; i++) { const a = Math.abs(raw[i]); if (a > peak) peak = a; }
  const gain = peak > 0 ? Math.min(8, 0.9 / peak) : 1;       // the model's output is quiet; bring every sentence to a comfortable, even level
  const samples = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) samples[i] = raw[i] * gain;
  return samples;
}

const join = (parts, gap) => {                    // a short breath between sentences
  const total = parts.reduce((a, p) => a + p.length, 0) + gap * (parts.length - 1), all = new Float32Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length + gap; }
  return all;
};

let busy = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  busy = busy.then(async () => {
    try {
      if (m.type === "init") { if (!session) await load(); self.postMessage({ type: "ready" }); }
      else if (m.type === "speak") {
        const rate = config.audio.sample_rate, parts = [];
        for (const ids of await phonemize(m.text)) parts.push(await synth(ids, m.speed || 1));
        if (!parts.length) { self.postMessage({ type: "audio", id: m.id, samples: new Float32Array(0), rate }); return; }
        const samples = join(parts, Math.round(rate * 0.28));
        self.postMessage({ type: "audio", id: m.id, samples, rate }, [samples.buffer]);
      }
    } catch (err) { self.postMessage({ type: "error", id: m.id, message: String(err && err.message || err) }); }
  });
};
