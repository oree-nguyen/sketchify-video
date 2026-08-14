"""Convert VieNeu's NumPy embedding/head archive into a WASM-friendly ONNX graph."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch


class VieNeuEmbed(torch.nn.Module):
    def __init__(self, text_emb: np.ndarray, audio_emb: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("text_emb", torch.from_numpy(text_emb.astype("float32")))
        self.register_buffer("audio_emb", torch.from_numpy(audio_emb.astype("float32")))

    def forward(self, rows: torch.Tensor):
        text_ids = rows[:, 0]
        audio_ids = rows[:, 1:]
        embedded = self.text_emb[text_ids]
        safe = audio_ids.clamp(0, self.audio_emb.shape[1] - 1)
        for index in range(self.audio_emb.shape[0]):
            part = self.audio_emb[index][safe[:, index]]
            embedded = embedded + part * (audio_ids[:, index] < self.audio_emb.shape[1]).unsqueeze(1)
        return embedded.unsqueeze(0)


class VieNeuHeads(torch.nn.Module):
    def __init__(self, text_emb: np.ndarray, audio_emb: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("text_emb", torch.from_numpy(text_emb.astype("float32")))
        self.register_buffer("audio_emb", torch.from_numpy(audio_emb.astype("float32")))

    def forward(self, hidden: torch.Tensor, channel: torch.Tensor, code: torch.Tensor, text_id: torch.Tensor):
        selected = self.audio_emb[channel.reshape(())]
        return (
            hidden @ selected.transpose(0, 1),
            hidden @ self.text_emb.transpose(0, 1),
            selected[code.reshape(())],
            self.text_emb[text_id.reshape(())],
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("npz", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    archive = np.load(args.npz)
    embed = VieNeuEmbed(archive["text_emb"], archive["audio_emb"]).eval()
    heads = VieNeuHeads(archive["text_emb"], archive["audio_emb"]).eval()
    rows = torch.full((3, 17), 1024, dtype=torch.long)
    rows[:, 0] = torch.tensor([8, 3, 4])
    hidden = torch.randn(1, 768)
    channel = torch.tensor([0], dtype=torch.long)
    code = torch.tensor([0], dtype=torch.long)
    text_id = torch.tensor([5], dtype=torch.long)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    embed_output = args.output.with_name("embed.onnx")
    heads_output = args.output.with_name("heads.onnx")
    torch.onnx.export(
        embed,
        (rows,),
        embed_output,
        input_names=["rows"],
        output_names=["embeddings"],
        dynamic_axes={"rows": {0: "time"}, "embeddings": {1: "time"}},
        opset_version=15,
        do_constant_folding=True,
        dynamo=False,
    )
    torch.onnx.export(
        heads,
        (hidden, channel, code, text_id),
        heads_output,
        input_names=["hidden", "channel", "code", "text_id"],
        output_names=["audio_logits", "text_logits", "audio_embedding", "text_embedding"],
        opset_version=15,
        do_constant_folding=True,
        dynamo=False,
    )
    print(embed_output, embed_output.stat().st_size)
    print(heads_output, heads_output.stat().st_size)


if __name__ == "__main__":
    main()
