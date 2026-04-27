#!/usr/bin/env python3
"""
OmniState Voiceprint Service
Local speaker embedding and verification using Resemblyzer.
Runs as HTTP microservice on localhost:19802.
"""

import os
import sys
import json
import base64
import tempfile
import logging
from typing import Optional

import numpy as np

try:
    from flask import Flask, request, jsonify
except ImportError:
    print("Flask not installed. Run: pip install flask", file=sys.stderr)
    sys.exit(1)

try:
    from resemblyzer import VoiceEncoder, preprocess_wav
    from resemblyzer.audio import sampling_rate as RESEMBLYZER_SR
except ImportError:
    print("Resemblyzer not installed. Run: pip install resemblyzer", file=sys.stderr)
    sys.exit(1)

try:
    import soundfile as sf
except ImportError:
    print("soundfile not installed. Run: pip install soundfile", file=sys.stderr)
    sys.exit(1)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voiceprint")

# Load encoder once (downloads model on first run ~50MB)
logger.info("Loading Resemblyzer voice encoder...")
encoder = VoiceEncoder()
logger.info("Voice encoder loaded successfully")


def decode_audio(audio_base64: str) -> np.ndarray:
    """Decode base64 audio (WAV) to numpy array at 16kHz mono."""
    audio_bytes = base64.b64decode(audio_base64)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        wav, sr = sf.read(tmp_path)
    finally:
        os.unlink(tmp_path)

    # Convert to mono if stereo
    if len(wav.shape) > 1:
        wav = wav.mean(axis=1)

    # Resample if needed (Resemblyzer expects 16kHz)
    if sr != RESEMBLYZER_SR:
        try:
            import librosa
            wav = librosa.resample(wav.astype(np.float32), orig_sr=sr, target_sr=RESEMBLYZER_SR)
        except ImportError:
            logger.warning("librosa not available for resampling; audio may be wrong sample rate")

    return preprocess_wav(wav)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a < 1e-9 or norm_b < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": "resemblyzer", "embedding_dim": 256})


@app.route("/embed", methods=["POST"])
def embed():
    """Generate speaker embedding from base64 WAV audio."""
    data = request.get_json()
    if not data or "audio" not in data:
        return jsonify({"error": "Missing 'audio' field (base64 WAV)"}), 400

    try:
        wav = decode_audio(data["audio"])
        embedding = encoder.embed_utterance(wav)
        return jsonify({
            "embedding": embedding.tolist(),
            "dim": len(embedding),
        })
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/verify", methods=["POST"])
def verify():
    """Verify speaker against stored embeddings.

    Request body:
      audio      : base64 WAV
      embeddings : dict of profileId -> float[]
      threshold  : float (default 0.75)
    """
    data = request.get_json()
    if not data or "audio" not in data:
        return jsonify({"error": "Missing 'audio' field"}), 400
    if "embeddings" not in data:
        return jsonify({"error": "Missing 'embeddings' field (dict of profileId -> embedding)"}), 400

    try:
        wav = decode_audio(data["audio"])
        query_embedding = encoder.embed_utterance(wav)

        results = {}
        best_match = None
        best_similarity = -1.0

        for profile_id, stored_embedding in data["embeddings"].items():
            stored = np.array(stored_embedding, dtype=np.float64)
            similarity = cosine_similarity(query_embedding, stored)
            results[profile_id] = similarity

            if similarity > best_similarity:
                best_similarity = similarity
                best_match = profile_id

        threshold = float(data.get("threshold", 0.75))
        matched = best_similarity >= threshold

        return jsonify({
            "matched": matched,
            "bestMatch": best_match if matched else None,
            "bestSimilarity": best_similarity,
            "scores": results,
            "threshold": threshold,
        })
    except Exception as e:
        logger.error(f"Verification failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/enroll", methods=["POST"])
def enroll():
    """Enroll a voice sample and return updated average embedding.

    Request body:
      audio             : base64 WAV
      existingEmbedding : float[] or null
      sampleCount       : int (how many samples already in existingEmbedding)
    """
    data = request.get_json()
    if not data or "audio" not in data:
        return jsonify({"error": "Missing 'audio' field"}), 400

    try:
        wav = decode_audio(data["audio"])
        new_embedding = encoder.embed_utterance(wav)

        existing = data.get("existingEmbedding")
        sample_count = int(data.get("sampleCount", 0))

        if existing and sample_count > 0:
            existing_arr = np.array(existing, dtype=np.float64)
            # Weighted running average, then re-normalize
            averaged = (existing_arr * sample_count + new_embedding) / (sample_count + 1)
            norm = np.linalg.norm(averaged)
            if norm > 1e-9:
                averaged = averaged / norm
            final_embedding = averaged
        else:
            final_embedding = new_embedding

        return jsonify({
            "embedding": final_embedding.tolist(),
            "dim": len(final_embedding),
            "sampleCount": sample_count + 1,
        })
    except Exception as e:
        logger.error(f"Enrollment failed: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("VOICEPRINT_PORT", 19802))
    logger.info(f"Starting voiceprint service on port {port}")
    app.run(host="127.0.0.1", port=port, debug=False)
