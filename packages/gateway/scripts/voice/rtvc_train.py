#!/usr/bin/env python3
"""
RTVC Training - Train speaker embeddings from audio samples

Usage:
  python3 rtvc_train.py --repo /path/to/RTVC --sample audio.wav --output embedding.npy

Output:
  NumPy .npy file with speaker embedding at --output path
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
    format='[rtvc_train] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('rtvc_train')


def load_wav(wav_path: str) -> tuple[np.ndarray, int]:
    """Load WAV file and return audio data and sample rate"""
    try:
        with wave.open(wav_path, 'rb') as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            sample_rate = wf.getframerate()
            n_frames = wf.getnframes()

            raw_data = wf.readframes(n_frames)

            if sample_width == 2:
                audio = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768
            else:
                audio = np.frombuffer(raw_data, dtype=np.uint8).astype(np.float32) / 128 - 1

            if channels > 1:
                audio = audio.reshape(-1, channels).mean(axis=1)

            return audio, sample_rate
    except Exception as e:
        raise ValueError(f"Failed to load WAV: {e}")


def preprocess_audio(audio: np.ndarray, target_sr: int = 16000) -> np.ndarray:
    """Preprocess audio for embedding extraction"""

    # Normalize
    audio = audio / (np.abs(audio).max() + 1e-10)

    # Simple high-pass filter to remove DC offset
    audio = audio - np.mean(audio)

    # Trim silence
    energy = np.abs(audio)
    threshold = 0.01 * np.max(energy)

    start = 0
    for i in range(len(energy)):
        if energy[i] > threshold:
            start = max(0, i - 1600)  # Keep 100ms before
            break

    end = len(audio)
    for i in range(len(energy) - 1, -1, -1):
        if energy[i] > threshold:
            end = min(len(audio), i + 1600)  # Keep 100ms after
            break

    audio = audio[start:end]

    return audio


def train_embedding(audio: np.ndarray, repo_path: str) -> np.ndarray:
    """
    Train speaker embedding from audio sample
    In production, would use the RTVC encoder training
    """

    encoder_path = os.path.join(repo_path, 'encoder')

    if os.path.exists(encoder_path):
        try:
            sys.path.insert(0, encoder_path)

            # Try to use the encoder
            log.info("Loading RTVC encoder...")
            # from encoder.inference import load_encoder, embed_speaker
            # encoder = load_encoder()
            # embedding = embed_speaker(encoder, audio)

            sys.path.pop(0)

            # For now, use fallback
            log.info("Using fallback embedding extraction")

        except ImportError as e:
            log.warning(f"Could not import encoder: {e}")

    # Fallback: Extract embedding using spectral features
    return extract_spectral_embedding(audio)


def extract_spectral_embedding(audio: np.ndarray) -> np.ndarray:
    """
    Extract speaker embedding using spectral features
    This is a simplified version - production would use the full encoder
    """

    log.info("Extracting spectral embedding...")

    # Parameters
    n_fft = 512
    hop_length = 160
    n_mels = 40
    n_frames = 32

    # Pad audio
    min_samples = n_fft + (n_frames - 1) * hop_length
    if len(audio) < min_samples:
        audio = np.pad(audio, (0, min_samples - len(audio)))

    # Extract mel spectrogram
    frames = []
    for i in range(n_frames):
        start = i * hop_length
        frame = audio[start:start + n_fft]
        if len(frame) < n_fft:
            frame = np.pad(frame, (0, n_fft - len(frame)))

        # Apply window
        window = np.hanning(n_fft)
        frame = frame * window

        # FFT
        spectrum = np.abs(np.fft.rfft(frame))

        # Mel filterbank approximation
        mel = np.log(spectrum[:n_mels] + 1e-10)
        frames.append(mel)

    # Stack frames
    mel_spectrogram = np.stack(frames)  # shape: (n_frames, n_mels)

    # Aggregation: mean and std over time
    mean_features = mel_spectrogram.mean(axis=0)
    std_features = mel_spectrogram.std(axis=0)

    # Concatenate
    embedding = np.concatenate([mean_features, std_features])  # 80 dims

    # Expand to 256 dims using simple interpolation
    target_dims = 256
    if len(embedding) < target_dims:
        indices = np.linspace(0, len(embedding) - 1, target_dims)
        embedding = np.interp(indices, np.arange(len(embedding)), embedding)

    # Normalize
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return embedding.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description='RTVC Training')
    parser.add_argument('--repo', required=True, help='Path to RTVC repo')
    parser.add_argument('--sample', required=True, help='Path to audio sample WAV file')
    parser.add_argument('--output', required=True, help='Output .npy embedding file path')

    args = parser.parse_args()

    # Validate inputs
    if not os.path.exists(args.sample):
        print(json.dumps({"error": f"Sample not found: {args.sample}"}))
        sys.exit(1)

    # Create output directory if needed
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    try:
        # Load audio
        log.info(f"Loading {args.sample}...")
        audio, sample_rate = load_wav(args.sample)

        duration = len(audio) / sample_rate
        log.info(f"Audio: {duration:.2f}s, {sample_rate}Hz")

        # Check minimum duration (recommend 3+ seconds)
        if duration < 0.5:
            print(json.dumps({"error": "Audio too short (< 0.5s)"}))
            sys.exit(1)

        if duration < 3:
            log.warning(f"Short sample ({duration:.1f}s) - recommend 3+ seconds for best quality")

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            log.info(f"Resampling to 16kHz...")
            # Simple resampling
            indices = np.linspace(0, len(audio) - 1, int(len(audio) * 16000 / sample_rate))
            audio = np.interp(indices, np.arange(len(audio)), audio)

        # Preprocess
        audio = preprocess_audio(audio)

        # Train embedding
        log.info("Training embedding...")
        embedding = train_embedding(audio, args.repo)

        log.info(f"Embedding shape: {embedding.shape}")

        # Save
        np.save(args.output, embedding)
        log.info(f"Saved embedding to {args.output}")

        # Output result
        result = {
            "ok": True,
            "output": args.output,
            "embedding_dims": len(embedding),
            "sample_duration_sec": duration
        }
        print(json.dumps(result))

    except Exception as e:
        log.error(f"Error: {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()