#!/usr/bin/env python3
"""
Personal Wake Listener - Speaker verification based wake word

Usage:
  python3 wake_listener_personal.py --template template.json --threshold 0.88
"""

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from typing import Optional

try:
    import numpy as np
    AUDIO_AVAILABLE = True
except ImportError:
    AUDIO_AVAILABLE = False
    np = None

try:
    import sounddevice as sd
    SD_AVAILABLE = True
except ImportError:
    SD_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format='[Personal] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('wake_listener_personal')


class PersonalWakeListener:
    def __init__(self, template_path: str, threshold: float,
                 endpoint: str, token: str, cooldown_ms: int,
                 command_window_sec: int, aliases: list, phrase: str):
        self.template_path = template_path
        self.threshold = threshold
        self.endpoint = endpoint
        self.token = token
        self.cooldown_ms = cooldown_ms
        self.command_window_sec = command_window_sec
        self.aliases = aliases
        self.phrase = phrase

        self.embedding = None
        self.last_trigger = 0
        self.speaker_embedding = None

        self._load_template()

    def _load_template(self):
        if not os.path.exists(self.template_path):
            log.error(f"Template not found: {self.template_path}")
            return

        try:
            with open(self.template_path, 'r') as f:
                data = json.load(f)
                self.speaker_embedding = np.array(data.get('embedding', []))
                log.info(f"Speaker template loaded ({len(self.speaker_embedding)} dims)")
        except Exception as e:
            log.error(f"Failed to load template: {e}")

    def _extract_embedding(self, audio: np.ndarray) -> Optional[np.ndarray]:
        """Extract speaker embedding from audio using encoder"""
        # In production, would use the encoder from RTVC repo
        # For now, use simple spectral features as approximation
        if len(audio) < 16000:  # Less than 1 second
            return None

        try:
            # Simple MFCC-like features (in production, use proper encoder)
            n_fft = 512
            hop = 160

            # Pad audio
            if len(audio) < n_fft:
                audio = np.pad(audio, (0, n_fft - len(audio)))

            # Get spectral features
            spectra = np.abs(np.fft.rfft(audio[:n_fft]))

            # Normalize
            spectra = spectra / (np.linalg.norm(spectra) + 1e-10)

            # Pad/truncate to expected dimension
            target_dim = len(self.speaker_embedding) if self.speaker_embedding is not None else 256
            if len(spectra) < target_dim:
                spectra = np.pad(spectra, (0, target_dim - len(spectra)))
            else:
                spectra = spectra[:target_dim]

            return spectra
        except Exception as e:
            log.error(f"Embedding extraction failed: {e}")
            return None

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        if len(a) != len(b):
            log.error(f"Dimension mismatch: {len(a)} vs {len(b)}")
            return 0.0

        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)

        if norm_a < 1e-10 or norm_b < 1e-10:
            return 0.0

        return float(np.dot(a, b) / (norm_a * norm_b))

    def verify_speaker(self, audio: np.ndarray) -> tuple[bool, float]:
        """Verify if speaker matches enrolled profile"""
        if self.speaker_embedding is None:
            log.error("No speaker embedding loaded")
            return False, 0.0

        extracted = self._extract_embedding(audio)
        if extracted is None:
            return False, 0.0

        similarity = self._cosine_similarity(extracted, self.speaker_embedding)
        match = similarity >= self.threshold

        log.debug(f"Speaker similarity: {similarity:.3f} (threshold: {self.threshold})")
        return match, similarity

    def should_trigger(self) -> bool:
        now = time.time() * 1000
        if now - self.last_trigger < self.cooldown_ms:
            return False
        return True

    def on_trigger(self, similarity: float):
        self.last_trigger = time.time() * 1000
        self._send_event(similarity)

    def _send_event(self, similarity: float):
        try:
            url = self.endpoint.rstrip('/') + '/api/wake/event'
            data = json.dumps({
                'event': 'wake.detected',
                'engine': 'personal',
                'similarity': similarity,
                'aliases': self.aliases,
                'phrase': self.phrase,
                'timestamp': time.time(),
                'token': self.token
            })

            subprocess.run([
                'curl', '-s', '-X', 'POST', url,
                '-H', 'Content-Type: application/json',
                '-d', data
            ], capture_output=True, timeout=5)

            log.info(f"Personal wake detected (similarity: {similarity:.3f})")
        except Exception as e:
            log.error(f"Failed to send event: {e}")


def main():
    parser = argparse.ArgumentParser(description='Personal Wake Listener')
    parser.add_argument('--template', required=True, help='Path to speaker template JSON')
    parser.add_argument('--endpoint', default='http://127.0.0.1:19801',
                        help='Wake event endpoint')
    parser.add_argument('--token', default=os.environ.get('OMNISTATE_SIRI_TOKEN', ''),
                        help='Auth token')
    parser.add_argument('--threshold', default='0.88', help='Verification threshold')
    parser.add_argument('--phrase', default='hey mimi', help='Expected wake phrase')
    parser.add_argument('--aliases', default='mimi,hey mimi,ok mimi',
                        help='Comma-separated or JSON array of aliases')
    parser.add_argument('--cooldown-ms', default='3000', help='Cooldown between triggers')
    parser.add_argument('--command-window-sec', default='5', help='Command listening window')

    args = parser.parse_args()

    # Parse aliases
    try:
        aliases = json.loads(args.aliases)
        if not isinstance(aliases, list):
            raise ValueError("Aliases must be a JSON array")
    except json.JSONDecodeError:
        aliases = [a.strip() for a in args.aliases.split(',')]

    listener = PersonalWakeListener(
        template_path=args.template,
        threshold=float(args.threshold),
        endpoint=args.endpoint,
        token=args.token,
        cooldown_ms=int(args.cooldown_ms),
        command_window_sec=int(args.command_window_sec),
        aliases=aliases,
        phrase=args.phrase
    )

    if listener.speaker_embedding is None:
        log.error("No speaker embedding - cannot start. Run enrollment first.")
        sys.exit(1)

    log.info(f"Starting Personal wake listener (threshold={args.threshold})")
    log.info(f"Aliases: {aliases}")

    # Audio capture
    stop_event = threading.Event()
    audio_buffer = []
    buffer_lock = threading.Lock()

    # For VAD (voice activity detection) - simple energy-based
    def is_speech(audio: np.ndarray) -> bool:
        energy = np.sqrt(np.mean(audio ** 2))
        return energy > 0.02  # Minimum energy threshold

    def audio_callback(indata, frames, time_info, status):
        if status:
            log.warning(f"Audio: {status}")

        audio_data = np.frombuffer(indata, dtype=np.int16).flatten()

        with buffer_lock:
            audio_buffer.append(audio_data)

            # Keep last 3 seconds for verification
            total_samples = sum(len(a) for a in audio_buffer)
            while total_samples > 48000 and len(audio_buffer) > 1:
                audio_buffer.pop(0)
                total_samples -= len(audio_buffer[0]) if audio_buffer else 0

    def process_loop():
        consecutive_verified = 0
        VERIFY_FRAMES = 3  # Need 3 consecutive verified frames to trigger

        while not stop_event.is_set():
            time.sleep(0.1)

            with buffer_lock:
                if not audio_buffer:
                    continue

                audio = np.concatenate(audio_buffer) if len(audio_buffer) > 1 else audio_buffer[0]

            # Check for speech first
            if not is_speech(audio):
                consecutive_verified = 0
                continue

            # Verify speaker
            match, similarity = listener.verify_speaker(audio)

            if match:
                consecutive_verified += 1
                if consecutive_verified >= VERIFY_FRAMES and listener.should_trigger():
                    log.info(f"Wake verified! ({similarity:.3f})")
                    listener.on_trigger(similarity)
                    consecutive_verified = 0
            else:
                consecutive_verified = max(0, consecutive_verified - 1)

    # Start processing thread
    process_thread = threading.Thread(target=process_loop, daemon=True)
    process_thread.start()

    # Setup signal handlers
    def signal_handler(signum, frame):
        log.info("Shutting down...")
        stop_event.set()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start audio stream
    try:
        if not SD_AVAILABLE:
            log.error("sounddevice not installed")
            sys.exit(1)

        with sd.InputStream(
            samplerate=16000,
            blocksize=4000,
            dtype='int16',
            channels=1,
            callback=audio_callback
        ):
            log.info("Listening for personal wake word...")
            while not stop_event.is_set():
                time.sleep(0.1)
    except KeyboardInterrupt:
        log.info("Interrupted")
    except Exception as e:
        log.error(f"Error: {e}")
        sys.exit(1)

    log.info("Shutdown complete")


if __name__ == '__main__':
    main()