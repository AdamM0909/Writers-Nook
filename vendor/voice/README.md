# The natural voice

Writer's Nook can read aloud in a smooth, warm, feminine voice that runs entirely on the reader's device.
It is downloaded once from this folder (about 33 MB) and then works with no internet.

| File | What it is | Licence |
| --- | --- | --- |
| `kathleen.onnx.gz` | The "Kathleen" voice from the [Piper](https://github.com/rhasspy/piper) project (`en_US-kathleen-low`), trained on the CC0 [Kathleen dataset](https://github.com/rhasspy/dataset-voice-kathleen). Stored with half-precision weights (identical audio to within rounding) to keep the download small. | CC0 (public domain) |
| `kathleen.json` | The voice's settings (phoneme map, sample rate). | CC0 |
| `ort.wasm.gz`, `ort.min.mjs`, `ort-wasm.mjs` | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.30.0, single-threaded WebAssembly build. | MIT |
| `phonemize.mjs`, `phonemize.wasm.gz`, `phonemize.data.gz` | Piper's phonemizer (turns words into sounds), built for the web by [piper-wasm](https://github.com/diffusionstudio/piper-wasm), with the English data only. It embeds **eSpeak NG**. | MIT (piper-wasm), **GPL-3.0** (eSpeak NG: <https://github.com/espeak-ng/espeak-ng>) |
| `engine.js` | Writer's Nook's own glue: runs the above in a Web Worker. | Same as this repository |

The `.gz` files are decompressed by the browser (`DecompressionStream`) and kept in the browser's Cache Storage
under the name `wn-voice`, which is also where "Remove the natural voice" deletes them from.

Source for eSpeak NG is available at the link above; the piper-wasm build scripts are at the piper-wasm link.
The voice is a low-quality-tier (16 kHz) Piper model: much smoother than most robotic device voices, but not studio quality.
