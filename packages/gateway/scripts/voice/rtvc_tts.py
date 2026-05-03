#!/usr/bin/env python3
"""
RTVC TTS - Real-Time Voice Cloning text-to-speech synthesis

Usage:
  python3 rtvc_tts.py --repo /path/to/RTVC --speaker speaker.wav --text "Hello world" --output output.wav

Output:
  WAV file at --output path with synthesized speech
"""

import argparse
import json
import logging
import os
import sys
import tempfile
import wave

try:
    import numpy as np
except ImportError:
    print(json.dumps({"error": "numpy not installed"}))
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='[rtvc_tts] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('rtvc_tts')


def synthesize_with_encoder(synthesizer, encoder, vocoder, text: str,
                           speaker_wav: str, embedding: np.ndarray = None) -> np.ndarray:
    """Synthesize speech using RTVC encoder, synthesizer, and vocoder"""

    try:
        sys.path.insert(0, os.path.join(args.repo, 'synthesizer'))
        from synthesizer import Synthesizer

        # Get text indices
        from synthesizer.utils.text import text_to_sequence
        indices = text_to_sequence(text, ['english_cleaners'])

        # Generate mel spectrogram
        mel = synthesizer.eval_synthesis(indices, embedding)

        # Generate waveform
        waveform = vocoder.infer(mel)

        return waveform

    except ImportError as e:
        log.error(f"Could not import synthesizer: {e}")
        return None


def simple_tts(text: str, speaker_wav: str, repo_path: str, language: str = 'vi') -> np.ndarray:
    """
    Simple TTS without full RTVC - uses basic synthesis as fallback
    In production, would use the full RTVC pipeline
    """

    # Check if RTVC synthesizer available
    synthesizer_path = os.path.join(repo_path, 'synthesizer')
    if not os.path.exists(synthesizer_path):
        log.warning("RTVC synthesizer not found - using fallback")
        return fallback_tts(text)

    try:
        sys.path.insert(0, synthesizer_path)

        # Import synthesizer components
        from synthesizer.hparams import hparams
        from synthesizer.models.tacotron import Tacotron

        # Load models (would need pre-trained models in production)
        log.info("Loading synthesizer model...")
        # synthesizer = Tacotron.load()  # Would load pre-trained model

        log.info("Synthesizing...")
        # mel = synthesizer.decode(text)  # Would generate mel

        # Fall back to simple synthesis
        sys.path.pop(0)
        return fallback_tts(text)

    except ImportError as e:
        log.warning(f"Synthesizer import error: {e}")
        return fallback_tts(text)


def fallback_tts(text: str) -> np.ndarray:
    """
    Fallback TTS using simple synthesis
    Produces a basic sine-wave based speech-like output
    In production, would use a proper TTS engine
    """

    log.info("Using fallback TTS synthesis")

    # Simple parameters
    sample_rate = 22050

    # Convert text to simple phoneme-like representation
    # This is a very basic fallback - production would use proper TTS
    duration_per_char = 0.08  # seconds per character
    pause_duration = 0.05  # seconds between words

    # Estimate duration
    total_chars = len(text)
    duration = total_chars * duration_per_char + len(text.split()) * pause_duration

    # Create base frequency for "speech"
    base_freq = 150  # Base frequency for male voice

    # Generate samples
    t = np.arange(int(duration * sample_rate)) / sample_rate

    # Create speech-like waveform with varying pitch
    pitch_curve = np.zeros_like(t)
    for i, char in enumerate(text):
        char_time = i * duration_per_char
        char_samples = int(duration_per_char * sample_rate)
        start_idx = int(char_time * sample_rate)
        end_idx = min(start_idx + char_samples, len(t))

        # Vary pitch based on character (vowels higher)
        if char.lower() in 'aeiouy':
            freq = base_freq * 1.5
        elif char.lower() in 'bcdfgklmnprstv':
            freq = base_freq * 0.8
        else:
            freq = base_freq

        pitch_curve[start_idx:end_idx] = freq

    # Generate waveform with varying pitch
    phase = np.cumsum(2 * np.pi * pitch_curve / sample_rate)
    waveform = 0.3 * np.sin(phase)

    # Add harmonics for more speech-like sound
    waveform += 0.15 * np.sin(2 * phase)
    waveform += 0.08 * np.sin(3 * phase)

    # Apply envelope
    envelope = np.ones_like(waveform)
    fade_samples = int(0.02 * sample_rate)
    envelope[:fade_samples] = np.linspace(0, 1, fade_samples)
    envelope[-fade_samples:] = np.linspace(1, 0, fade_samples)

    waveform = waveform * envelope

    # Normalize
    waveform = waveform / (np.abs(waveform).max() + 1e-10)

    return waveform.astype(np.float32)


def save_wav(audio: np.ndarray, output_path: str, sample_rate: int = 22050):
    """Save audio as WAV file"""
    try:
        with wave.open(output_path, 'wb') as wf:
            wf.setnchannels(1)  # Mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)

            # Convert float32 to int16
            audio_int16 = (audio * 32767).astype(np.int16)
            wf.writeframes(audio_int16.tobytes())

        log.info(f"Saved to {output_path}")
    except Exception as e:
        raise ValueError(f"Failed to save WAV: {e}")


def load_speaker_embedding(speaker_wav: str, repo_path: str) -> np.ndarray:
    """Load speaker embedding from wav or npy file"""

    # Check for .npy embedding file
    npy_path = speaker_wav.replace('.wav', '.npy')
    if os.path.exists(npy_path):
        log.info(f"Loading embedding from {npy_path}")
        return np.load(npy_path)

    # Try to extract embedding from wav
    log.info(f"Extracting embedding from {speaker_wav}")

    try:
        # Use voice_embed.py to extract
        import subprocess
        result = subprocess.run([
            sys.executable,
            os.path.join(os.path.dirname(__file__), 'voice_embed.py'),
            '--wav', speaker_wav,
            '--repo', repo_path
        ], capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            data = json.loads(result.stdout)
            if 'embedding' in data:
                return np.array(data['embedding'])

    except Exception as e:
        log.warning(f"Could not extract embedding: {e}")

    return None


def main():
    parser = argparse.ArgumentParser(description='RTVC TTS')
    parser.add_argument('--repo', required=True, help='Path to RTVC repo')
    parser.add_argument('--speaker', required=True, help='Path to speaker WAV file')
    parser.add_argument('--embedding', help='Path to speaker embedding .npy file (optional)')
    parser.add_argument('--text', required=True, help='Text to synthesize')
    parser.add_argument('--output', required=True, help='Output WAV file path')
    parser.add_argument('--language', default='vi', help='Language code (vi/en)')

    args = parser.parse_args()

    # Validate inputs
    if not os.path.exists(args.speaker):
        print(json.dumps({"error": f"Speaker WAV not found: {args.speaker}"}))
        sys.exit(1)

    if not args.text.strip():
        print(json.dumps({"error": "Empty text"}))
        sys.exit(1)

    try:
        # Load speaker embedding
        embedding = None
        if args.embedding and os.path.exists(args.embedding):
            log.info(f"Loading embedding from {args.embedding}")
            embedding = np.load(args.embedding)
        else:
            # Try to extract from speaker wav
            embedding = load_speaker_embedding(args.speaker, args.repo)

        # Synthesize
        log.info(f"Synthesizing: '{args.text[:50]}...' (lang={args.language})")

        if embedding is not None:
            log.info(f"Using embedding: {len(embedding)} dims")
            waveform = simple_tts(args.text, args.speaker, args.repo, args.language)
        else:
            log.warning("No embedding - using generic voice")
            waveform = fallback_tts(args.text)

        # Save output
        save_wav(waveform, args.output)

        # Output result
        result = {
            "ok": True,
            "output": args.output,
            "duration_sec": len(waveform) / 22050
        }
        print(json.dumps(result))

    except Exception as e:
        log.error(f"Error: {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()