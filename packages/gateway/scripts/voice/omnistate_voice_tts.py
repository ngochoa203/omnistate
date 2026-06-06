#!/usr/bin/env python3
"""
Lightweight OmniState Voice wrapper built on top of k2-fsa/OmniVoice.

Examples:
  python3 omnistate_voice_tts.py \
    --text "Xin chao" \
    --output out.wav

  python3 omnistate_voice_tts.py \
    --text "Hello world" \
    --ref-audio speaker.wav \
    --output out.wav
"""

from __future__ import annotations

import argparse
import logging
import sys


logging.basicConfig(level=logging.INFO, format="[omnistate_voice_tts] %(levelname)s %(message)s")
log = logging.getLogger("omnistate_voice_tts")


def resolve_device(requested: str | None, torch) -> str:
    if requested:
        return requested
    if torch.cuda.is_available():
        return "cuda:0"
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    xpu = getattr(torch, "xpu", None)
    if xpu is not None and xpu.is_available():
        return "xpu"
    return "cpu"


def resolve_dtype(device: str, torch):
    if device.startswith("cuda") or device in {"mps", "xpu"}:
        return torch.float16
    return torch.float32


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthesize speech via OmniState Voice")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--output", required=True, help="Output wav path")
    parser.add_argument("--model", default="k2-fsa/OmniVoice", help="HF model id")
    parser.add_argument("--language", default="en", help="Language hint for logging only")
    parser.add_argument("--device", default=None, help="Optional explicit device_map")
    parser.add_argument("--speed", type=float, default=1.0, help="Playback speed factor")
    parser.add_argument("--ref-audio", dest="ref_audio", default=None, help="Reference audio wav for voice cloning")
    parser.add_argument("--ref-text", dest="ref_text", default=None, help="Optional transcript for ref audio")
    parser.add_argument("--instruct", default=None, help="Optional voice design prompt")
    args = parser.parse_args()

    try:
        import soundfile as sf
        import torch
        from omnivoice import OmniVoice
    except Exception as exc:
        log.error(
            "Missing OmniState Voice runtime dependency: %s. "
            "The managed setup should install this automatically; if it did not, "
            "run `pip install torch torchaudio soundfile omnivoice`.",
            exc,
        )
        return 2

    try:
        device = resolve_device(args.device, torch)
        dtype = resolve_dtype(device, torch)
        log.info("loading model=%s device=%s language=%s", args.model, device, args.language)

        model = OmniVoice.from_pretrained(
            args.model,
            device_map=device,
            dtype=dtype,
        )

        generate_kwargs: dict[str, object] = {
            "text": args.text,
            "speed": args.speed,
        }
        if args.ref_audio:
            generate_kwargs["ref_audio"] = args.ref_audio
        if args.ref_text:
            generate_kwargs["ref_text"] = args.ref_text
        if args.instruct:
            generate_kwargs["instruct"] = args.instruct

        audio = model.generate(**generate_kwargs)
        if not audio:
            raise RuntimeError("OmniState Voice returned no audio")

        sf.write(args.output, audio[0], 24000)
        log.info("wrote %s", args.output)
        return 0
    except Exception as exc:
        log.error("synthesis failed: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
