#!/usr/bin/env python3
"""voice_embed.py — Extract d-vector embedding from a wav file using RTVC SpeakerEncoder."""

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract speaker embedding from wav")
    parser.add_argument("--wav", required=True, help="Path to input wav file")
    parser.add_argument("--repo", required=True, help="Path to Real-Time-Voice-Cloning repo")
    args = parser.parse_args()

    repo_path = Path(args.repo)
    if not repo_path.exists():
        print(json.dumps({"error": f"RTVC repo not found: {args.repo}"}))
        sys.exit(1)

    wav_path = Path(args.wav)
    if not wav_path.exists():
        print(json.dumps({"error": f"WAV file not found: {args.wav}"}))
        sys.exit(1)

    if str(repo_path) not in sys.path:
        sys.path.insert(0, str(repo_path))

    try:
        from encoder import inference as encoder
        from encoder.params_model import model_embedding_size
        import numpy as np

        encoder_model_path = repo_path / "encoder" / "saved_models" / "pretrained.pt"
        if not encoder_model_path.exists():
            # Try alternate location
            candidates = list(repo_path.rglob("pretrained.pt"))
            if not candidates:
                print(json.dumps({"error": "Encoder model pretrained.pt not found in repo"}))
                sys.exit(1)
            encoder_model_path = candidates[0]

        encoder.load_model(encoder_model_path)
        wav = encoder.preprocess_wav(wav_path)
        embedding = encoder.embed_utterance(wav)
        print(json.dumps({"embedding": embedding.tolist()}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
