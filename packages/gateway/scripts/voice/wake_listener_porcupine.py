#!/usr/bin/env python3
"""
Porcupine Wake Word Listener - Using Picovoice Porcupine

Usage:
  python3 wake_listener_porcupine.py --access-key KEY --keyword-path hey_mimi.ppn
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

try:
    import pvporcupine
    PORCUPINE_AVAILABLE = True
except ImportError:
    PORCUPINE_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format='[Porcupine] %(levelname)s %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('wake_listener_porcupine')


class PorcupineWakeListener:
    def __init__(self, access_key: str, keyword_path: Optional[str],
                 keyword: str, endpoint: str, token: str,
                 cooldown_ms: int, command_window_sec: int):
        self.access_key = access_key
        self.keyword_path = keyword_path
        self.keyword = keyword
        self.endpoint = endpoint
        self.token = token
        self.cooldown_ms = cooldown_ms
        self.command_window_sec = command_window_sec

        self.porcupine = None
        self.last_trigger = 0

        self._init_porcupine()

    def _init_porcupine(self):
        if not PORCUPINE_AVAILABLE:
            log.error("pvporcupine not installed - install with: pip install pvporcupine")
            return

        try:
            if self.keyword_path and os.path.exists(self.keyword_path):
                self.porcupine = pvporcupine.create(
                    access_key=self.access_key,
                    keyword_path=self.keyword_path
                )
                log.info(f"Porcupine initialized with keyword file: {self.keyword_path}")
            else:
                # Use built-in keyword
                keyword_enum = pvporcupine.KEYWORDS.get(self.keyword.lower())
                if keyword_enum:
                    self.porcupine = pvporcupine.create(
                        access_key=self.access_key,
                        keyword=keyword_enum
                    )
                    log.info(f"Porcupine initialized with built-in keyword: {self.keyword}")
                else:
                    log.error(f"Unknown keyword: {self.keyword}")
                    return

            log.info(f"Porcupine ready (version: {pvporcupine.__version__})")
        except Exception as e:
            log.error(f"Failed to initialize Porcupine: {e}")

    def process_audio(self, audio: np.ndarray) -> bool:
        if self.porcupine is None:
            return False

        try:
            # Porcupine expects int16 mono audio at 16kHz
            pcm = audio.astype(np.int16)

            # Process audio
            result = self.porcupine.process(pcm)
            return result >= 0
        except Exception as e:
            log.error(f"Porcupine error: {e}")
            return False

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
                'engine': 'porcupine',
                'keyword': self.keyword,
                'timestamp': time.time(),
                'token': self.token
            })

            subprocess.run([
                'curl', '-s', '-X', 'POST', url,
                '-H', 'Content-Type: application/json',
                '-d', data
            ], capture_output=True, timeout=5)

            log.info("Porcupine wake detected - event sent")
        except Exception as e:
            log.error(f"Failed to send event: {e}")


def main():
    parser = argparse.ArgumentParser(description='Porcupine Wake Listener')
    parser.add_argument('--access-key', required=True, help='Picovoice access key')
    parser.add_argument('--keyword-path', help='Path to .ppn keyword file')
    parser.add_argument('--keyword', default='porcupine',
                        help='Built-in keyword name (e.g., alexa, hey google, porcupine)')
    parser.add_argument('--endpoint', default='http://127.0.0.1:19801',
                        help='Wake event endpoint')
    parser.add_argument('--token', default=os.environ.get('OMNISTATE_SIRI_TOKEN', ''),
                        help='Auth token')
    parser.add_argument('--cooldown-ms', default='3000', help='Cooldown between triggers')
    parser.add_argument('--phrase', default='hey porcupine', help='Keyword phrase (for logging)')
    parser.add_argument('--command-window-sec', default='5', help='Command listening window')

    args = parser.parse_args()

    listener = PorcupineWakeListener(
        access_key=args.access_key,
        keyword_path=args.keyword_path,
        keyword=args.keyword,
        endpoint=args.endpoint,
        token=args.token,
        cooldown_ms=int(args.cooldown_ms),
        command_window_sec=int(args.command_window_sec)
    )

    if listener.porcupine is None:
        log.error("Failed to initialize Porcupine - exiting")
        sys.exit(1)

    log.info(f"Starting Porcupine listener (keyword: {args.keyword})")

    # Audio capture
    stop_event = threading.Event()

    def audio_callback(indata, frames, time_info, status):
        if status:
            log.warning(f"Audio: {status}")

        audio_data = np.frombuffer(indata, dtype=np.int16).flatten()

        if listener.process_audio(audio_data):
            if listener.should_trigger():
                log.info("Wake word detected!")
                listener.on_trigger()

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
            blocksize=512,  # Porcupine expects small frames
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

    # Cleanup
    if listener.porcupine:
        listener.porcupine.delete()

    log.info("Shutdown complete")


if __name__ == '__main__':
    main()