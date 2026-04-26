#!/usr/bin/env python3
import argparse
import os
import sys
import numpy as np


def resolve_model_paths(repo_dir: str):
    root = os.path.join(repo_dir, "saved_models", "default")
    return {
        "encoder": os.path.join(root, "encoder.pt"),
        "synthesizer": os.path.join(root, "synthesizer.pt"),
        "vocoder": os.path.join(root, "vocoder.pt"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--speaker", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", default="vi")
    parser.add_argument("--embedding", default=None,
                        help="Path to pre-computed speaker-embedding.npy; skips re-encoding if present")
    args = parser.parse_args()

    repo_dir = os.path.abspath(args.repo)
    if not os.path.isdir(repo_dir):
        raise RuntimeError(f"RTC repo not found: {repo_dir}")

    sys.path.insert(0, repo_dir)

    from encoder import inference as encoder
    from encoder.audio import preprocess_wav
    from synthesizer.inference import Synthesizer
    from synthesizer.audio import save_wav
    from vocoder import inference as vocoder

    model_paths = resolve_model_paths(repo_dir)
    missing = [p for p in model_paths.values() if not os.path.isfile(p)]
    if missing:
        raise RuntimeError(
            "Missing RTC model checkpoint(s). Expected under saved_models/default: "
            + ", ".join(missing)
        )

    encoder.load_model(model_paths["encoder"])
    synthesizer = Synthesizer(model_paths["synthesizer"])
    vocoder.load_model(model_paths["vocoder"])

    # Prefer pre-saved embedding (fast, consistent voice); fall back to re-encoding the wav.
    embedding_path = os.path.abspath(args.embedding) if args.embedding else None
    if embedding_path and os.path.isfile(embedding_path):
        embed = np.load(embedding_path)
    else:
        wav = preprocess_wav(args.speaker)
        embed = encoder.embed_utterance(wav)

    specs = synthesizer.synthesize_spectrograms([args.text], [embed])
    generated_wav = vocoder.infer_wave(specs[0])

    out_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    save_wav(generated_wav, out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
