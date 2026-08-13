# Third-party notices

## Piper web runtime

- `@mintplex-labs/piper-tts-web` 1.0.3, MIT License.
- `onnxruntime-web` 1.18.0, MIT License.
- Piper phonemizer WebAssembly assets from `@diffusionstudio/piper-wasm` 1.0.0, served locally from `public/piper/`.

## Vietnamese voice

- Voice: `vi_VN-vais1000-medium` from `rhasspy/piper-voices`.
- Model repository license: MIT.
- Source dataset: VAIS1000 Vietnamese Speech Synthesis Corpus, CC BY 4.0.
- Model card: https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN/vais1000/medium

The voice model and configuration are distributed from `public/voices/` and fetched lazily only when narration is generated.
