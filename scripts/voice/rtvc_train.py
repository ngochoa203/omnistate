#!/usr/bin/env python3
import argparse
import os
import sys
import numpy as np


def resolve_encoder_path(repo_dir: str) -> str:
    return os.path.join(repo_dir, "saved_models", "default", "encoder.pt")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--sample", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    repo_dir = os.path.abspath(args.repo)
    if not os.path.isdir(repo_dir):
        raise RuntimeError(f"RTC repo not found: {repo_dir}")

    sample_path = os.path.abspath(args.sample)
    if not os.path.isfile(sample_path):
        raise RuntimeError(f"Speaker sample not found: {sample_path}")

    sys.path.insert(0, repo_dir)

    from encoder import inference as encoder
    from encoder.audio import preprocess_wav

    encoder_model = resolve_encoder_path(repo_dir)
    if not os.path.isfile(encoder_model):
        raise RuntimeError(f"Missing encoder checkpoint: {encoder_model}")

    encoder.load_model(encoder_model)
    wav = preprocess_wav(sample_path)
    embedding = encoder.embed_utterance(wav)

    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    np.save(output_path, embedding)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
