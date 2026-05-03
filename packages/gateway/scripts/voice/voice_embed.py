#!/usr/bin/env python3
"""
Voice Embedding Extraction - Extract speaker embeddings from audio

Usage:
  python3 voice_embed.py --wav audio.wav --repo /path/to/RTVC/repo

Output:
  {"embedding": [0.123, -0.456, ...], "duration_sec": 2.5}
"""

import argparse
import json
import logging
import os
import sys
import wave

try:
    import numpy as np
except ImportError:
    print(json.dumps({"error": "numpy not installed"}))
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='[voice_embed] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('voice_embed')


def load_wav(wav_path: str) -> tuple[np.ndarray, int]:
    """Load WAV file and return audio data and sample rate"""
    try:
        with wave.open(wav_path, 'rb') as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            sample_rate = wf.getframerate()
            n_frames = wf.getnframes()

            raw_data = wf.readframes(n_frames)

            if sample_width == 1:  # 8-bit
                audio = np.frombuffer(raw_data, dtype=np.uint8).astype(np.float32) / 128 - 1
            elif sample_width == 2:  # 16-bit
                audio = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768
            elif sample_width == 4:  # 32-bit
                audio = np.frombuffer(raw_data, dtype=np.int32).astype(np.float32) / 2147483648
            else:
                raise ValueError(f"Unsupported sample width: {sample_width}")

            # Convert to mono if stereo
            if channels > 1:
                audio = audio.reshape(-1, channels).mean(axis=1)

            return audio, sample_rate
    except Exception as e:
        raise ValueError(f"Failed to load WAV: {e}")


def resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """Simple resampling using linear interpolation"""
    if orig_sr == target_sr:
        return audio

    duration = len(audio) / orig_sr
    target_length = int(duration * target_sr)

    indices = np.linspace(0, len(audio) - 1, target_length)
    return np.interp(indices, np.arange(len(audio)), audio)


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    """Normalize audio to [-1, 1] range"""
    max_val = np.abs(audio).max()
    if max_val > 0:
        audio = audio / max_val
    return audio


def trim_silence(audio: np.ndarray, sample_rate: int, threshold: float = 0.01) -> np.ndarray:
    """Trim leading and trailing silence"""
    # Find first non-silent sample
    energy = np.abs(audio)
    threshold_val = threshold * np.max(energy)

    start = 0
    for i in range(len(energy)):
        if energy[i] > threshold_val:
            start = max(0, i - int(sample_rate * 0.1))  # Keep 100ms before speech
            break

    end = len(audio)
    for i in range(len(energy) - 1, -1, -1):
        if energy[i] > threshold_val:
            end = min(len(audio), i + int(sample_rate * 0.1))  # Keep 100ms after speech
            break

    return audio[start:end]


def extract_embedding(audio: np.ndarray, repo_path: str) -> list[float]:
    """Extract speaker embedding using encoder from RTVC repo"""

    # Try to use the RTVC encoder
    encoder_path = os.path.join(repo_path, 'encoder')
    if not os.path.exists(encoder_path):
        log.warning(f"RTVC encoder not found at {encoder_path}")
        log.info("Using fallback embedding extraction")
        return fallback_embedding(audio)

    try:
        sys.path.insert(0, encoder_path)

        from encoder.inference import load_encoder, embed_speaker

        encoder = load_encoder()
        embedding = embed_speaker(encoder, audio)

        sys.path.pop(0)
        return embedding.tolist()

    except ImportError as e:
        log.warning(f"Could not import RTVC encoder: {e}")
        return fallback_embedding(audio)
    except Exception as e:
        log.warning(f"Encoder error: {e}")
        return fallback_embedding(audio)


def fallback_embedding(audio: np.ndarray) -> list[float]:
    """Fallback embedding extraction using spectral features"""

    # Normalize
    audio = audio / (np.abs(audio).max() + 1e-10)

    # Parameters
    n_fft = 512
    n_mels = 40
    n_frames = 32

    # Pad audio
    if len(audio) < n_fft:
        audio = np.pad(audio, (0, n_fft - len(audio)))

    # Compute STFT
    frames = []
    hop = len(audio) // n_frames
    for i in range(n_frames):
        frame = audio[i * hop:i * hop + n_fft]
        if len(frame) < n_fft:
            frame = np.pad(frame, (0, n_fft - len(frame)))
        frames.append(np.fft.rfft(frame))

    # Get magnitude spectrum
    mag = np.abs(np.stack(frames))

    # Simple mel-like features
    mel = np.log(mag[:, :n_mels] + 1e-10)

    # Average over time to get speaker representation
    embedding = mel.mean(axis=0)

    # Pad to 256 dimensions
    if len(embedding) < 256:
        embedding = np.pad(embedding, (0, 256 - len(embedding)))
    else:
        embedding = embedding[:256]

    # Normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding.tolist()


def main():
    parser = argparse.ArgumentParser(description='Voice Embedding Extraction')
    parser.add_argument('--wav', required=True, help='Path to WAV audio file')
    parser.add_argument('--repo', default='', help='Path to RTVC repo')

    args = parser.parse_args()

    if not os.path.exists(args.wav):
        print(json.dumps({"error": f"WAV file not found: {args.wav}"}))
        sys.exit(1)

    try:
        # Load audio
        log.info(f"Loading {args.wav}...")
        audio, sample_rate = load_wav(args.wav)

        duration = len(audio) / sample_rate
        log.info(f"Audio: {duration:.2f}s, {sample_rate}Hz")

        # Check minimum duration
        if duration < 0.5:
            print(json.dumps({"error": "Audio too short (< 0.5s)"}))
            sys.exit(1)

        # Resample to 16kHz
        if sample_rate != 16000:
            audio = resample(audio, sample_rate, 16000)
            log.info(f"Resampled to 16kHz")

        # Normalize
        audio = normalize_audio(audio)

        # Trim silence
        audio = trim_silence(audio, 16000)
        log.info(f"Trimmed to {len(audio)/16000:.2f}s")

        # Extract embedding
        log.info("Extracting embedding...")
        embedding = extract_embedding(audio, args.repo)

        if len(embedding) != 256:
            log.warning(f"Embedding dimension: {len(embedding)} (expected 256)")

        # Output JSON
        result = {
            "embedding": embedding,
            "duration_sec": len(audio) / 16000
        }

        print(json.dumps(result))

    except Exception as e:
        log.error(f"Error: {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()