#!/usr/bin/env python3
"""
whisper_server.py

Long-lived STT worker that accepts streaming JSON-lines commands on stdin
and emits JSON-lines transcript events on stdout.

stdin protocol (JSON-lines):
  {"cmd": "start", "session": "<id>"}
  {"cmd": "chunk", "session": "<id>", "pcm_b64": "<base64 PCM16 mono 16kHz>"}
  {"cmd": "stop",  "session": "<id>"}

stdout protocol (JSON-lines):
  {"kind": "partial", "session": "<id>", "text": "...", "t0": 0.0, "t1": 1.5}
  {"kind": "final",   "session": "<id>", "text": "...", "t0": 0.0, "t1": 3.0}
  {"ready": true, "model": "<name>", "device": "<cpu|cuda|mps>"}
  {"error": "<message>"}
"""

import base64
import json
import os
import signal
import sys
import threading
import time
from collections import deque
from typing import Dict, Deque

import numpy as np

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL_NAME: str = os.environ.get("WHISPER_MODEL", "base")
DEVICE: str = os.environ.get("WHISPER_DEVICE", "cpu")
SAMPLE_RATE: int = 16_000

# Sliding window: 1.5s window, 0.3s overlap step
WINDOW_SAMPLES: int = int(1.5 * SAMPLE_RATE)   # 24000 samples
STEP_SAMPLES: int = int((1.5 - 0.3) * SAMPLE_RATE)  # 19200 samples (advance each step)

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

_shutdown = threading.Event()


def _handle_sigterm(signum, frame):  # type: ignore[type-arg]
    _shutdown.set()


signal.signal(signal.SIGTERM, _handle_sigterm)

# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------


class SessionState:
    """Accumulates PCM samples for one logical session."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.samples: Deque[np.ndarray] = deque()
        self.total_samples: int = 0
        # Cursor: how many samples have already been consumed by partial windows
        self.consumed: int = 0

    def push(self, pcm_bytes: bytes) -> None:
        """Append raw PCM16 LE mono bytes."""
        arr = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        self.samples.append(arr)
        self.total_samples += len(arr)

    def get_audio(self) -> np.ndarray:
        """Return all buffered samples as a contiguous float32 array."""
        if not self.samples:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(list(self.samples))


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def emit(obj: dict) -> None:  # type: ignore[type-arg]
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def emit_error(message: str) -> None:
    emit({"error": message})


# ---------------------------------------------------------------------------
# Main worker loop
# ---------------------------------------------------------------------------


def main() -> None:
    # Load model
    try:
        from faster_whisper import WhisperModel  # type: ignore[import]
    except ImportError:
        emit_error("faster-whisper not installed. Run: pip install faster-whisper")
        sys.exit(1)

    try:
        model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type="int8")
    except Exception as exc:
        emit_error(f"Failed to load model '{MODEL_NAME}' on device '{DEVICE}': {exc}")
        sys.exit(1)

    emit({"ready": True, "model": MODEL_NAME, "device": DEVICE})

    sessions: Dict[str, SessionState] = {}

    def transcribe_window(audio: np.ndarray, session_id: str, is_final: bool) -> str:
        """Run Whisper on a numpy float32 array; return stripped text."""
        if len(audio) < 100:
            return ""
        try:
            segments, _ = model.transcribe(
                audio,
                language=None,
                beam_size=1 if not is_final else 3,
                vad_filter=False,
            )
            parts = [seg.text for seg in segments]
            return "".join(parts).strip()
        except Exception as exc:
            emit_error(f"transcribe error for session {session_id}: {exc}")
            return ""

    for raw_line in sys.stdin:
        if _shutdown.is_set():
            break

        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            msg = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            emit_error(f"invalid JSON on stdin: {exc}")
            continue

        # Backward compatibility: batch protocol
        # {"id":"...","wav_path":"...","language":"vi"}
        if "wav_path" in msg:
            req_id = str(msg.get("id", ""))
            wav_path = str(msg.get("wav_path", ""))
            language = msg.get("language")
            t0 = time.monotonic()
            try:
                segments, _ = model.transcribe(
                    wav_path,
                    language=language or None,
                    beam_size=3,
                    vad_filter=False,
                )
                text = "".join(seg.text for seg in segments).strip()
                duration_ms = int((time.monotonic() - t0) * 1000)
                emit({"id": req_id, "text": text, "durationMs": duration_ms})
            except Exception as exc:
                emit({"id": req_id, "error": str(exc)})
            continue

        cmd = msg.get("cmd")
        session_id = msg.get("session", "")

        if cmd == "start":
            sessions[session_id] = SessionState(session_id)

        elif cmd == "chunk":
            state = sessions.get(session_id)
            if state is None:
                # Auto-create session if start was not received (tolerate disorder)
                state = SessionState(session_id)
                sessions[session_id] = state

            pcm_b64 = msg.get("pcm_b64", "")
            if pcm_b64:
                try:
                    pcm_bytes = base64.b64decode(pcm_b64)
                except Exception as exc:
                    emit_error(f"base64 decode failed for session {session_id}: {exc}")
                    continue
                state.push(pcm_bytes)

            # Emit partial transcript on each full sliding window step
            audio = state.get_audio()
            available = len(audio) - state.consumed
            while available >= WINDOW_SAMPLES:
                window = audio[state.consumed: state.consumed + WINDOW_SAMPLES]
                text = transcribe_window(window, session_id, is_final=False)
                t0 = state.consumed / SAMPLE_RATE
                t1 = (state.consumed + WINDOW_SAMPLES) / SAMPLE_RATE
                if text:
                    emit({"kind": "partial", "session": session_id, "text": text, "t0": t0, "t1": t1})
                state.consumed += STEP_SAMPLES
                available = len(audio) - state.consumed

        elif cmd == "stop":
            state = sessions.pop(session_id, None)
            if state is None:
                emit_error(f"stop received for unknown session {session_id}")
                continue

            audio = state.get_audio()
            t0 = 0.0
            t1 = len(audio) / SAMPLE_RATE
            text = transcribe_window(audio, session_id, is_final=True)
            emit({"kind": "final", "session": session_id, "text": text, "t0": t0, "t1": t1})

        else:
            emit_error(f"unknown cmd '{cmd}'")

    # Drain remaining sessions on shutdown
    for session_id, state in sessions.items():
        audio = state.get_audio()
        if len(audio) > 0:
            text = transcribe_window(audio, session_id, is_final=True)
            t1 = len(audio) / SAMPLE_RATE
            emit({"kind": "final", "session": session_id, "text": text, "t0": 0.0, "t1": t1})


if __name__ == "__main__":
    main()
