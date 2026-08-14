"""Export the pinned Ngoc Ngan Matcha checkpoint for the browser.

This intentionally uses the checkpoint author's Matcha fork because its
Vietnamese symbol table/cleaner differs from upstream Matcha.  The acoustic
model and HiFi-GAN are kept in separate ONNX files so neither Git object
crosses GitHub's 100 MiB limit.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from matcha.cli import load_matcha, load_vocoder


class Acoustic(torch.nn.Module):
    def __init__(self, model: torch.nn.Module, steps: int) -> None:
        super().__init__()
        self.model = model
        self.steps = steps

    def forward(self, x: torch.Tensor, x_lengths: torch.Tensor, scales: torch.Tensor):
        result = self.model.synthesise(
            x,
            x_lengths,
            n_timesteps=self.steps,
            temperature=scales[0],
            length_scale=scales[1],
        )
        return result["mel"], result["mel_lengths"]


class Vocoder(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, mel: torch.Tensor):
        return self.model(mel).clamp(-1, 1).squeeze(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("vocoder_checkpoint", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--steps", type=int, default=5)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cpu")
    model = load_matcha(args.checkpoint, device)
    vocoder, _ = load_vocoder(args.vocoder_checkpoint, device)
    acoustic = Acoustic(model, args.steps).eval()
    vocoder_wrapper = Vocoder(vocoder).eval()

    token_count = 50
    x = torch.randint(0, 20, (1, token_count), dtype=torch.long)
    lengths = torch.tensor([token_count], dtype=torch.long)
    scales = torch.tensor([0.667, 1.0], dtype=torch.float32)
    torch.onnx.export(
        acoustic,
        (x, lengths, scales),
        args.output_dir / "matcha-ngoc-ngan.onnx",
        input_names=["x", "x_lengths", "scales"],
        output_names=["mel", "mel_lengths"],
        dynamic_axes={
            "x": {0: "batch", 1: "text_time"},
            "x_lengths": {0: "batch"},
            "mel": {0: "batch", 2: "mel_time"},
            "mel_lengths": {0: "batch"},
        },
        opset_version=15,
        do_constant_folding=True,
        dynamo=False,
    )

    mel = torch.randn(1, 80, 64, dtype=torch.float32)
    torch.onnx.export(
        vocoder_wrapper,
        (mel,),
        args.output_dir / "hifigan-ngoc-ngan.onnx",
        input_names=["mel"],
        output_names=["wav"],
        dynamic_axes={"mel": {0: "batch", 2: "mel_time"}, "wav": {0: "batch", 1: "audio_time"}},
        opset_version=15,
        do_constant_folding=True,
        dynamo=False,
    )
    print("Exported Matcha acoustic model and HiFi-GAN vocoder")


if __name__ == "__main__":
    main()
