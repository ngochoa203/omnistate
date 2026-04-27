"""
whisper_server.py — Persistent Whisper transcription service.

Reads line-delimited JSON requests from stdin, writes line-delimited JSON
responses to stdout. Loads the model once at startup.

Request:  {"id": "...", "wav_path": "...", "language": "vi"}
Response: {"id": "...", "text": "...", "durationMs": 123}
          {"id": "...", "error": "..."}
Ready:    {"ready": true, "model": "small", "device": "cpu"}
"""

import json
import os
import signal
import sys
import time


# ---------------------------------------------------------------------------
# Device selection
# ---------------------------------------------------------------------------

def _detect_device() -> str:
    explicit = os.environ.get("WHISPER_DEVICE", "").strip().lower()
    if explicit in ("cpu", "cuda", "mps"):
        return explicit
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


# ---------------------------------------------------------------------------
# Backend abstraction
# ---------------------------------------------------------------------------

class _FasterWhisperBackend:
    def __init__(self, model_name: str, device: str):
        from faster_whisper import WhisperModel
        compute_type = "float16" if device in ("cuda", "mps") else "int8"
        self._model = WhisperModel(model_name, device=device, compute_type=compute_type)
        self.device = device

    def transcribe(self, wav_path: str, language: str) -> str:
        segments, _info = self._model.transcribe(
            wav_path,
            language=language or None,
            beam_size=5,
        )
        return "".join(seg.text for seg in segments).strip()


class _OpenAIWhisperBackend:
    def __init__(self, model_name: str, device: str):
        import whisper
        self._model = whisper.load_model(model_name)
        # openai-whisper uses torch under the hood; move to device if possible
        try:
            import torch
            self._model = self._model.to(device)
        except Exception:
            pass
        self.device = device

    def transcribe(self, wav_path: str, language: str) -> str:
        result = self._model.transcribe(
            wav_path,
            language=language or None,
        )
        return result["text"].strip()


def _load_backend(model_name: str, device: str):
    backend_missing = False
    errors: list[str] = []

    def _attempt(load_device: str):
        nonlocal backend_missing
        try:
            return _FasterWhisperBackend(model_name, load_device)
        except ImportError:
            backend_missing = True
        except Exception as exc:
            errors.append(f"faster-whisper[{load_device}]: {exc}")
        try:
            return _OpenAIWhisperBackend(model_name, load_device)
        except ImportError:
            backend_missing = True
        except Exception as exc:
            errors.append(f"openai-whisper[{load_device}]: {exc}")
        return None

    backend = _attempt(device)
    if backend is not None:
        return backend

    # Some runtime stacks advertise MPS but backend builds don't support it.
    if device != "cpu":
        print(
            f"[whisper_server] backend init failed on device={device}, retrying on cpu",
            file=sys.stderr,
        )
        backend = _attempt("cpu")
        if backend is not None:
            return backend

    if backend_missing:
        raise RuntimeError(
            "Neither faster-whisper nor openai-whisper is installed. "
            "Install one of them to use whisper-local."
        )
    details = "; ".join(errors[-4:]) if errors else "unknown backend init error"
    raise RuntimeError(
        f"Failed to initialize whisper backend on device={device} and fallback cpu: {details}"
    )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(msg: str) -> None:
    """Log to stderr — stdout is the JSON protocol channel."""
    print(f"[whisper_server] {msg}", file=sys.stderr, flush=True)


def main() -> None:
    model_name = os.environ.get("WHISPER_MODEL", "small")
    device = _detect_device()
    _log(f"loading model={model_name} device={device}")

    try:
        backend = _load_backend(model_name, device)
    except Exception as exc:
        _log(f"FATAL load failed: {exc!r}")
        _emit({"error": str(exc)})
        sys.exit(1)

    _log(f"ready model={model_name} device={backend.device}")
    _emit({"ready": True, "model": model_name, "device": backend.device})

    def _handle_sigterm(_sig, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue

        try:
            req = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            _log(f"invalid JSON: {exc}")
            _emit({"error": f"invalid JSON: {exc}"})
            continue

        req_id = req.get("id", "")
        wav_path = req.get("wav_path", "")
        language = req.get("language", "")

        if not wav_path:
            _emit({"id": req_id, "error": "missing wav_path"})
            continue

        try:
            wav_bytes = os.path.getsize(wav_path)
        except OSError:
            wav_bytes = -1
        _log(f"transcribe id={req_id} wav={wav_path} bytes={wav_bytes} lang={language}")

        t0 = time.monotonic()
        try:
            text = backend.transcribe(wav_path, language)
            duration_ms = int((time.monotonic() - t0) * 1000)
            _log(f"done id={req_id} text_len={len(text)} duration_ms={duration_ms} preview={text[:120]!r}")
            _emit({"id": req_id, "text": text, "durationMs": duration_ms})
        except Exception as exc:
            _log(f"ERROR id={req_id} {type(exc).__name__}: {exc}")
            _emit({"id": req_id, "error": str(exc)})


if __name__ == "__main__":
    main()
