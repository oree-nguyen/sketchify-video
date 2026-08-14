"""Package VieNeu/MOSS ONNX artifacts for static hosting and GitHub limits."""

from __future__ import annotations

import shutil
from pathlib import Path

import onnx
from onnx.external_data_helper import _get_all_tensors


SOURCE = Path('.tmp-vieneu-runtime')
OUTPUT = Path('public/voices/vieneu-v3/runtime')
MAX_PART = 60 * 1024 * 1024


def external(tensor) -> dict[str, str]:
    return {item.key: item.value for item in tensor.external_data}


def set_external(tensor, location: str, offset: int, length: int) -> None:
    del tensor.external_data[:]
    for key, value in (("location", location), ("offset", str(offset)), ("length", str(length))):
        item = tensor.external_data.add(); item.key = key; item.value = value


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    backbone = (SOURCE / 'onnx_int8/vieneu_backbone_shared.data').read_bytes()
    reference = onnx.load(str(SOURCE / 'onnx_int8/vieneu_prefill.onnx'), load_external_data=False)
    spans = []
    for tensor in _get_all_tensors(reference):
        data = external(tensor)
        if data:
            spans.append((int(data['offset']), int(data['length'])))
    spans = sorted(set(spans))
    mapping: dict[tuple[int, int], tuple[str, int]] = {}
    parts: list[bytearray] = [bytearray()]
    for old_offset, length in spans:
        if parts[-1] and len(parts[-1]) + length > MAX_PART:
            parts.append(bytearray())
        name = f'vieneu-backbone-{len(parts) - 1}.data'
        mapping[(old_offset, length)] = (name, len(parts[-1]))
        parts[-1].extend(backbone[old_offset:old_offset + length])
    for index, data in enumerate(parts):
        (OUTPUT / f'vieneu-backbone-{index}.data').write_bytes(data)

    for filename in ('vieneu_prefill.onnx', 'vieneu_decode_step.onnx'):
        model = onnx.load(str(SOURCE / 'onnx_int8' / filename), load_external_data=False)
        for tensor in _get_all_tensors(model):
            data = external(tensor)
            if not data:
                continue
            old = (int(data['offset']), int(data['length']))
            location, offset = mapping[old]
            set_external(tensor, location, offset, old[1])
        onnx.save_model(model, str(OUTPUT / filename))

    shutil.copy2(SOURCE / 'onnx_int8/vieneu_acoustic_cached.onnx', OUTPUT / 'vieneu_acoustic_cached.onnx')
    shutil.copy2(SOURCE / 'moss_audio_tokenizer_decode_full.onnx', OUTPUT / 'moss_audio_tokenizer_decode_full.onnx')
    shutil.copy2(SOURCE / 'moss_audio_tokenizer_decode_shared.data', OUTPUT / 'moss_audio_tokenizer_decode_shared.data')
    for path in sorted(OUTPUT.iterdir()):
        print(path.name, path.stat().st_size)


if __name__ == '__main__':
    main()
