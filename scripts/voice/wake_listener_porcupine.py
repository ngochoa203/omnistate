#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Wake-word listener using Picovoice Porcupine."""

from __future__ import annotations

import argparse
import json
import signal
import struct
import sys
import time
import urllib.request

try:
    import pvporcupine
except ImportError:
    print(
        "[porcupine] pvporcupine not found. Run: pip install pvporcupine",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)

try:
    import sounddevice
except ImportError:
    print("[porcupine] sounddevice not found. Run: pip install sounddevice", file=sys.stderr, flush=True)
    sys.exit(1)


def post_wake(endpoint: str, token: str, phrase: str, score: float, engine: str) -> None:
    body = json.dumps({"phrase": phrase, "score": score, "engine": engine, "token": token}).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Porcupine wake-word listener")
    parser.add_argument("--access-key", required=True, help="Picovoice access key")
    parser.add_argument("--endpoint", required=True, help="POST URL for wake events")
    parser.add_argument("--token", required=True, help="Bearer token")
    parser.add_argument("--cooldown-ms", type=int, default=1500, help="Debounce ms after detection")
    parser.add_argument("--command-window-sec", type=int, default=8, help="Command window (passed through)")
    parser.add_argument("--phrase", default="hey mimi", help="Phrase broadcast to clients")
    parser.add_argument("--keyword-path", default=None, help="Path to .ppn custom keyword file")
    parser.add_argument("--sensitivity", type=float, default=0.6, help="Detection sensitivity 0.0-1.0")
    args = parser.parse_args()

    # Build porcupine instance
    try:
        if args.keyword_path:
            porcupine = pvporcupine.create(
                access_key=args.access_key,
                keyword_paths=[args.keyword_path],
                sensitivities=[args.sensitivity],
            )
        else:
            print(
                "[porcupine] WARNING: no --keyword-path given; using built-in 'jarvis'. "
                "A custom 'hey mimi' .ppn file is recommended.",
                file=sys.stderr,
                flush=True,
            )
            porcupine = pvporcupine.create(
                access_key=args.access_key,
                keywords=["jarvis"],
                sensitivities=[args.sensitivity],
            )
    except pvporcupine.PorcupineInvalidArgumentError as e:
        print(f"[porcupine] invalid argument (check access key): {e}", file=sys.stderr, flush=True)
        return 1
    except Exception as e:
        print(f"[porcupine] init error: {e}", file=sys.stderr, flush=True)
        return 1

    # Signal handling for clean exit
    def _shutdown(signum, frame):  # noqa: ARG001
        print("[porcupine] shutting down", file=sys.stderr, flush=True)
        porcupine.delete()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    cooldown_sec = args.cooldown_ms / 1000.0
    last_fire = 0.0
    fmt = "h" * porcupine.frame_length

    print(
        f"[porcupine] listening — sample_rate={porcupine.sample_rate} "
        f"frame_length={porcupine.frame_length} sensitivity={args.sensitivity}",
        file=sys.stderr,
        flush=True,
    )

    try:
        with sounddevice.RawInputStream(
            samplerate=porcupine.sample_rate,
            blocksize=porcupine.frame_length,
            channels=1,
            dtype="int16",
        ) as stream:
            while True:
                audio_bytes, _ = stream.read(porcupine.frame_length)
                pcm = struct.unpack_from(fmt, bytes(audio_bytes))
                result = porcupine.process(pcm)
                if result >= 0:
                    now = time.monotonic()
                    if now - last_fire < cooldown_sec:
                        continue
                    last_fire = now
                    post_wake(args.endpoint, args.token, args.phrase, 1.0, "porcupine")
                    print(f"[porcupine] wake detected -> {args.endpoint}", flush=True)
    except Exception as e:
        print(f"[porcupine] stream error: {e}", file=sys.stderr, flush=True)
        porcupine.delete()
        return 1

    porcupine.delete()
    return 0


if __name__ == "__main__":
    sys.exit(main())
