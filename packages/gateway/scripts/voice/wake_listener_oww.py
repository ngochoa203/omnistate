#!/usr/bin/env python3
"""
OWW Wake Word Listener - Optimized for Open Wake Word ONNX models

Usage:
  python3 wake_listener_oww.py --model-path model.onnx --aliases '["mimi","hey mimi"]'
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
    format='[OWW] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('wake_listener_oww')


class OWWListener:
    def __init__(self, model_path: str, aliases: list, threshold: float,
                 endpoint: str, token: str, cooldown_ms: int):
        self.model_path = model_path
        self.aliases = aliases
        self.threshold = threshold
        self.endpoint = endpoint
        self.token = token
        self.cooldown_ms = cooldown_ms
        self.session = None
        self.last_trigger = 0
        self._load_model()

    def _load_model(self):
        try:
            import onnxruntime as ort
            if not os.path.exists(self.model_path):
                log.error(f"Model not found: {self.model_path}")
                self.session = None
                return

            self.session = ort.InferenceSession(
                self.model_path,
                providers=['CPUExecutionProvider']
            )
            log.info(f"OWW model loaded: {self.model_path}")
        except ImportError:
            log.error("onnxruntime not installed - install with: pip install onnxruntime")
            self.session = None
        except Exception as e:
            log.error(f"Model load failed: {e}")
            self.session = None

    def _run_inference(self, audio: np.ndarray) -> float:
        if self.session is None:
            return 0.0

        try:
            # Normalize to [-1, 1]
            audio_norm = (audio / 32768.0).astype(np.float32)

            # Pad or trim to expected length (typically 16000 samples = 1 sec)
            expected_len = 16000
            if len(audio_norm) < expected_len:
                audio_norm = np.pad(audio_norm, (0, expected_len - len(audio_norm)))
            else:
                audio_norm = audio_norm[:expected_len]

            input_name = self.session.get_inputs()[0].name
            output = self.session.run(None, {input_name: audio_norm.reshape(1, -1)})

            return float(output[0][0][0])
        except Exception as e:
            log.error(f"Inference error: {e}")
            return 0.0

    def should_trigger(self) -> bool:
        now = time.time() * 1000
        if now - self.last_trigger < self.cooldown_ms:
            return False
        return True

    def on_trigger(self):
        self.last_trigger = time.time() * 1000
        self._send_event()

    def _send_event(self):
        try:
            url = self.endpoint.rstrip('/') + '/api/wake/event'
            data = json.dumps({
                'event': 'wake.detected',
                'engine': 'oww',
                'aliases': self.aliases,
                'timestamp': time.time(),
                'token': self.token
            })

            subprocess.run([
                'curl', '-s', '-X', 'POST', url,
                '-H', 'Content-Type: application/json',
                '-d', data
            ], capture_output=True, timeout=5)

            log.info("Wake detected - event sent")
        except Exception as e:
            log.error(f"Failed to send event: {e}")


def main():
    parser = argparse.ArgumentParser(description='OWW Wake Listener')
    parser.add_argument('--phrase', default='mimi', help='Wake phrase (for logging)')
    parser.add_argument('--aliases', required=True, help='JSON array of aliases')
    parser.add_argument('--threshold', default='0.5', help='Detection threshold')
    parser.add_argument('--model-path', required=True, help='Path to OWW ONNX model')
    parser.add_argument('--endpoint', default='http://127.0.0.1:19801',
                        help='Wake event endpoint')
    parser.add_argument('--token', default=os.environ.get('OMNISTATE_SIRI_TOKEN', ''),
                        help='Auth token')
    parser.add_argument('--cooldown-ms', default='3000', help='Cooldown between triggers')

    args = parser.parse_args()

    # Parse aliases
    try:
        aliases = json.loads(args.aliases)
        if not isinstance(aliases, list):
            raise ValueError("Aliases must be a JSON array")
    except json.JSONDecodeError:
        aliases = [a.strip() for a in args.aliases.split(',')]

    listener = OWWListener(
        model_path=args.model_path,
        aliases=aliases,
        threshold=float(args.threshold),
        endpoint=args.endpoint,
        token=args.token,
        cooldown_ms=int(args.cooldown_ms)
    )

    if listener.session is None:
        log.error("Failed to initialize OWW engine - exiting")
        sys.exit(1)

    log.info(f"Starting OWW listener (threshold={args.threshold})")
    log.info(f"Aliases: {aliases}")

    # Audio capture
    stop_event = threading.Event()
    audio_buffer = []
    buffer_lock = threading.Lock()

    def audio_callback(indata, frames, time_info, status):
        if status:
            log.warning(f"Audio: {status}")

        audio_data = np.frombuffer(indata, dtype=np.int16).flatten()

        with buffer_lock:
            audio_buffer.append(audio_data)

            # Keep last 1 second of audio
            total_samples = sum(len(a) for a in audio_buffer)
            while total_samples > 16000 and len(audio_buffer) > 1:
                removed = audio_buffer.pop(0)
                total_samples -= len(removed)

    def process_loop():
        while not stop_event.is_set():
            time.sleep(0.1)

            with buffer_lock:
                if not audio_buffer:
                    continue
                audio = np.concatenate(audio_buffer) if len(audio_buffer) > 1 else audio_buffer[0]

            prob = listener._run_inference(audio)

            if prob > listener.threshold and listener.should_trigger():
                log.info(f"Wake detected! (confidence: {prob:.3f})")
                listener.on_trigger()

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
            log.error("sounddevice not installed - install with: pip install sounddevice")
            sys.exit(1)

        with sd.InputStream(
            samplerate=16000,
            blocksize=4000,
            dtype='int16',
            channels=1,
            callback=audio_callback
        ):
            log.info("Listening for wake words...")
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