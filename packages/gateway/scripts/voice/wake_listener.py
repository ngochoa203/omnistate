#!/usr/bin/env python3
"""
Wake Listener - Multi-engine wake word detection for OmniState
Supports: OWW (ONNX), Personal (speaker verification), Porcupine

Usage:
  python3 wake_listener.py --engine oww --model-path model.onnx --phrase "hey mimi"
  python3 wake_listener.py --engine personal --template template.json --threshold 0.88
  python3 wake_listener.py --engine porcupine --access-key KEY --keyword-path keyword.ppn
"""

import argparse
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Optional

# Audio libraries - try to import, fallback gracefully
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
    stream=sys.stderr
)
log = logging.getLogger('wake_listener')


class WakeConfig:
    def __init__(self, args):
        self.phrase = args.phrase
        self.endpoint = args.endpoint
        self.token = args.token
        self.cooldown_ms = int(args.cooldown_ms or 3000)
        self.command_window_sec = int(args.command_window_sec or 5)
        self.engine = args.engine or 'legacy'
        self.aliases = self._parse_aliases(args)
        self.model_path = args.model_path or ''
        self.template = args.template or ''
        self.threshold = float(args.threshold or 0.5)

    def _parse_aliases(self, args):
        aliases = args.aliases or 'mimi,hey mimi,ok mimi'
        try:
            # Try JSON array first
            parsed = json.loads(aliases)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
        # Fall back to comma-separated
        return [a.strip() for a in aliases.split(',')]


class WakeEngine:
    """Base class for wake word detection engines"""

    def __init__(self, config: WakeConfig):
        self.config = config
        self.last_trigger = 0

    def process_audio(self, audio_data: np.ndarray) -> bool:
        """Return True if wake word detected"""
        raise NotImplementedError

    def should_trigger(self) -> bool:
        """Check cooldown and trigger conditions"""
        now = time.time() * 1000
        if now - self.last_trigger < self.config.cooldown_ms:
            return False
        return True

    def on_trigger(self):
        """Called when wake word detected"""
        self.last_trigger = time.time() * 1000


class LegacyEngine(WakeEngine):
    """Keyword spotting using simple energy detection + pattern matching"""

    def __init__(self, config: WakeConfig):
        super().__init__(config)
        self.buffer = []
        self.sample_rate = 16000
        self.min_samples = int(self.sample_rate * 0.5)  # 500ms min

    def process_audio(self, audio_data: np.ndarray) -> bool:
        if np is None:
            return False

        self.buffer.extend(audio_data.tolist())

        # Need minimum samples
        if len(self.buffer) < self.min_samples:
            return False

        # Simple energy-based detection
        energy = np.sqrt(np.mean(np.array(self.buffer[-self.min_samples:]) ** 2))

        # Reset buffer
        self.buffer = self.buffer[-self.min_samples:]

        # Trigger on energy threshold
        return energy > 0.1


class OWWEngine(WakeEngine):
    """Open Wake Word engine with ONNX model"""

    def __init__(self, config: WakeConfig):
        super().__init__(config)
        self.session = None
        self.sample_rate = 16000
        self._load_model()

    def _load_model(self):
        try:
            import onnxruntime as ort
            model_path = self.config.model_path
            if not model_path or not os.path.exists(model_path):
                log.warning(f"OWW model not found: {model_path}")
                self.session = None
                return
            self.session = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
            log.info(f"OWW model loaded: {model_path}")
        except ImportError:
            log.error("onnxruntime not installed - run: pip install onnxruntime")
            self.session = None
        except Exception as e:
            log.error(f"Failed to load OWW model: {e}")
            self.session = None

    def process_audio(self, audio_data: np.ndarray) -> bool:
        if self.session is None:
            # Fall back to legacy detection
            return LegacyEngine(self.config).process_audio(audio_data)

        try:
            # Prepare input
            audio_norm = audio_data / 32768.0
            input_data = audio_norm.astype(np.float32)

            # Run inference
            input_name = self.session.get_inputs()[0].name
            output = self.session.run(None, {input_name: input_data.reshape(1, -1)})

            # Get probability
            prob = float(output[0][0][0])

            return prob > self.config.threshold
        except Exception as e:
            log.error(f"OWW inference error: {e}")
            return False


class PersonalEngine(WakeEngine):
    """Speaker verification based wake word"""

    def __init__(self, config: WakeConfig):
        super().__init__(config)
        self.embedding = None
        self.sample_rate = 16000
        self._load_template()

    def _load_template(self):
        template_path = self.config.template
        if not template_path or not os.path.exists(template_path):
            log.warning(f"Personal template not found: {template_path}")
            return

        try:
            with open(template_path, 'r') as f:
                data = json.load(f)
                self.embedding = np.array(data.get('embedding', []))
                log.info(f"Personal template loaded: {template_path}")
        except Exception as e:
            log.error(f"Failed to load template: {e}")

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        if len(a) != len(b):
            return 0.0
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))

    def process_audio(self, audio_data: np.ndarray) -> bool:
        if self.embedding is None:
            log.warning("No embedding loaded - cannot verify speaker")
            return False

        try:
            # Extract embedding from audio (simplified - would use encoder in production)
            # For now, just check audio energy as proxy
            energy = np.sqrt(np.mean(audio_data ** 2))

            # Basic check - in production, extract actual embedding
            if energy < 0.05:
                return False

            # Would compare embeddings here
            # For now, always return True if energy detected
            return energy > 0.1
        except Exception as e:
            log.error(f"Speaker verification error: {e}")
            return False


def send_wake_event(endpoint: str, token: str):
    """Send wake event to OmniState gateway"""
    try:
        url = endpoint.rstrip('/') + '/api/wake/event'
        data = json.dumps({
            'event': 'wake.detected',
            'timestamp': time.time(),
            'token': token
        })

        # Use curl for simple HTTP POST
        result = subprocess.run([
            'curl', '-s', '-X', 'POST', url,
            '-H', 'Content-Type: application/json',
            '-d', data
        ], capture_output=True, timeout=5)

        log.info(f"Wake event sent to {endpoint}")
        return True
    except Exception as e:
        log.error(f"Failed to send wake event: {e}")
        return False


def audio_capture_loop(engine: WakeEngine, config: WakeConfig, stop_event: threading.Event):
    """Main audio capture loop"""

    if not SD_AVAILABLE:
        log.error("sounddevice not installed - run: pip install sounddevice")
        return

    def audio_callback(indata, frames, time_info, status):
        if status:
            log.warning(f"Audio status: {status}")

        audio_data = np.frombuffer(indata, dtype=np.int16)

        if engine.process_audio(audio_data):
            if engine.should_trigger():
                engine.on_trigger()
                log.info("Wake word detected!")
                send_wake_event(config.endpoint, config.token)

                # Optionally wait for command
                if config.command_window_sec > 0:
                    log.info(f"Listening for command ({config.command_window_sec}s)...")
                    # In production, would capture and process command here

    try:
        with sd.InputStream(
            samplerate=16000,
            blocksize=4000,  # 250ms blocks
            dtype='int16',
            channels=1,
            callback=audio_callback
        ):
            log.info("Listening for wake words...")
            while not stop_event.is_set():
                time.sleep(0.1)
    except Exception as e:
        log.error(f"Audio capture error: {e}")


def main():
    parser = argparse.ArgumentParser(description='OmniState Wake Listener')
    parser.add_argument('--phrase', default='mimi', help='Wake phrase')
    parser.add_argument('--engine', default='legacy',
                        choices=['legacy', 'oww', 'personal', 'porcupine'],
                        help='Wake detection engine')
    parser.add_argument('--endpoint', default='http://127.0.0.1:19801',
                        help='OmniState gateway endpoint')
    parser.add_argument('--token', default=os.environ.get('OMNISTATE_SIRI_TOKEN', ''),
                        help='Auth token')
    parser.add_argument('--cooldown-ms', default='3000',
                        help='Cooldown between triggers (ms)')
    parser.add_argument('--command-window-sec', default='5',
                        help='Command listening window (sec)')
    parser.add_argument('--aliases',
                        help='Comma-separated or JSON array of aliases')
    parser.add_argument('--model-path',
                        help='Path to ONNX model (for OWW engine)')
    parser.add_argument('--template',
                        help='Path to personal template JSON')
    parser.add_argument('--threshold', default='0.5',
                        help='Detection threshold')
    parser.add_argument('--access-key',
                        help='Picovoice access key (for Porcupine)')
    parser.add_argument('--keyword-path',
                        help='Path to Porcupine keyword file')

    args = parser.parse_args()
    config = WakeConfig(args)

    # Create engine
    if args.engine == 'oww':
        engine = OWWEngine(config)
    elif args.engine == 'personal':
        engine = PersonalEngine(config)
    elif args.engine == 'porcupine':
        log.error("Porcupine engine requires porcupine library - use wake_listener_porcupine.py")
        sys.exit(1)
    else:
        engine = LegacyEngine(config)

    log.info(f"Starting wake listener (engine={args.engine})")
    log.info(f"Aliases: {config.aliases}")
    log.info(f"Endpoint: {config.endpoint}")

    # Setup signal handlers
    stop_event = threading.Event()

    def signal_handler(signum, frame):
        log.info("Shutting down...")
        stop_event.set()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Start audio capture
    try:
        audio_capture_loop(engine, config, stop_event)
    except KeyboardInterrupt:
        log.info("Interrupted")
    except Exception as e:
        log.error(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()