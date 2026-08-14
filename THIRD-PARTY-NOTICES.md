# Third-party notices

## Piper web runtime

- `onnxruntime-web` 1.27.0, MIT License.
- Piper phonemizer WebAssembly assets from `@diffusionstudio/piper-wasm` 1.0.0, served locally from `public/piper/`.
- Piper phonemizer browser glue is derived from `piper-wasm` 0.1.4 (MIT), served locally from `public/piper/`.

## Vietnamese voice

- Voice: `vi_VN-vais1000-medium` from `rhasspy/piper-voices`.
- Model repository license: MIT.
- Source dataset: VAIS1000 Vietnamese Speech Synthesis Corpus, CC BY 4.0.
- Model card: https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN/vais1000/medium

The voice model and configuration are distributed from `public/voices/` and fetched lazily only when narration is generated.

## Additional speech voices

- Official Piper voice checkpoints are fetched lazily from `rhasspy/piper-voices` and retain their published model-card licenses.
- Registered Vietnamese checkpoints: `vi_VN-vais1000-medium`, `vi_VN-vivos-x_low`, and `vi_VN-25hours_single-low`.
- The English LJSpeech browser-check voice uses Akjava's community Matcha-TTS ONNX quantization (`ljspeech_sim_q8.onnx`, Apache-2.0 repository). The original Matcha-TTS implementation is MIT licensed.
- The pronunciation dictionary in `public/tts/cmudict-0.7b` is the Carnegie Mellon Pronouncing Dictionary and retains its permissive CMU notice.
- Matcha-TTS-VIVOS is intentionally not registered because the referenced public checkpoint no longer exists.

## MC. Ngọc Ngân

- Checkpoint: `doof-ferb/matcha_ngngngan`, epoch 420, exported locally to separate acoustic and HiFi-GAN ONNX graphs.
- Checkpoint license: CC BY-NC-SA 4.0. The model card explicitly prohibits commercial use of both the checkpoint and generated audio. The application displays this restriction beside the selected voice.
- Source: https://huggingface.co/doof-ferb/matcha_ngngngan
- Matcha-TTS implementation: MIT. HiFi-GAN retains its upstream terms.

## VieNeu Vietnamese presets

- Runtime/checkpoint: `pnnbao-ump/VieNeu-TTS-v3-Turbo`, Apache-2.0, pinned at commit `75ff82a72f54d55ed389e1eeb12041d3c4bac7d4`.
- The ten named presets use reference-code records published with the project's v3.0.0 release. Backbone, acoustic decoder, embeddings and output heads execute through ONNX Runtime Web/WASM.
- Codec: `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX`, pinned at commit `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`.
- Source: https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo

Engine and checkpoint metadata is intentionally internal. End users select only friendly voice names in the application.
