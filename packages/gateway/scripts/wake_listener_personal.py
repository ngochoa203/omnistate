#!/usr/bin/env python3
"""
Personal wake-word listener (v2) using a 5-sample MFCC+delta template.

v2 improvements vs v1:
  - Hop-correct sliding window (fixes deque-saturation bug in v1)
  - Pre-emphasis + peak normalization (matches trainer) → loudness-invariant
  - MFCC + delta features (auto-fallback to MFCC-only if template is v1)
  - Adaptive energy gate using short-term noise floor
  - 2-of-3 consecutive-frame confirmation → fewer false wakes

Mirrors CLI of wake_listener_oww.py so wake-manager.ts swaps engines transparently.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np

try:
    import sounddevice as sd
    import librosa
    import urllib.request
except ImportError as e:
    print(f"[wake-personal] missing dep: {e}. Run install_wake_deps.sh", file=sys.stderr)
    sys.exit(2)


SAMPLE_RATE = 16000
HOP_SEC = 0.3                  # slide every 300ms (tighter than v1's 400ms)
N_MFCC = 20
FRAME_MS = 25
HOP_MS = 10
PREEMPH = 0.97
CONFIRM_FRAMES = 3             # require N of last 4 windows above threshold
HISTORY_LEN = 4


def load_template(path: Path) -> tuple[np.ndarray, dict]:
    with open(path) as fp:
        data = json.load(fp)
    mfcc_norm = np.array(data["mfcc_norm"], dtype=np.float32)
    return mfcc_norm, data


def effective_template_frames(template_norm: np.ndarray, requested_frames: int) -> int:
    # Older templates may carry long padded tails (e.g. 280 frames) when training
    # phrases include content after "hey mimi". For wake detection we only need the
    # active wake prefix region.
    col_energy = np.linalg.norm(template_norm, axis=0)
    active_idxs = np.where(col_energy > 1e-5)[0]
    if active_idxs.size == 0:
        return max(80, min(requested_frames, 160))
    active_frames = int(active_idxs[-1]) + 1
    return max(80, min(active_frames + 8, 160))


def preprocess(y: np.ndarray) -> np.ndarray:
    if len(y) > 1:
        y = np.append(y[0], y[1:] - PREEMPH * y[:-1]).astype(np.float32)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = y / peak * 0.95
    return y


def l2_normalize_cols(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=0, keepdims=True)
    norms[norms == 0] = 1.0
    return x / norms


def extract_features(audio: np.ndarray, use_delta: bool, target_frames: int) -> np.ndarray:
    audio = preprocess(audio)
    mfcc = librosa.feature.mfcc(
        y=audio,
        sr=SAMPLE_RATE,
        n_mfcc=N_MFCC,
        n_fft=int(FRAME_MS / 1000 * SAMPLE_RATE),
        hop_length=int(HOP_MS / 1000 * SAMPLE_RATE),
    )
    if use_delta:
        delta = librosa.feature.delta(mfcc)
        feats = np.vstack([mfcc, delta])
    else:
        feats = mfcc

    if feats.shape[1] < target_frames:
        pad = target_frames - feats.shape[1]
        feats = np.pad(feats, ((0, 0), (0, pad)), mode="constant")
    else:
        feats = feats[:, :target_frames]
    return l2_normalize_cols(feats.astype(np.float32))


def score(template_norm: np.ndarray, live_norm: np.ndarray) -> float:
    if template_norm.shape[1] != live_norm.shape[1]:
        target = min(template_norm.shape[1], live_norm.shape[1])
        template_norm = template_norm[:, :target]
        live_norm = live_norm[:, :target]
    sims = np.sum(template_norm * live_norm, axis=0)
    return float(np.mean(sims))


def post_wake(endpoint: str, token: str, score_val: float, phrase: str) -> None:
    """POST to gateway's wake event endpoint (NOT the Siri command bridge).

    Wake is a *trigger*, not a command. The gateway broadcasts to UI clients
    so they can show the listening bubble + open the in-app voice capture.
    Sending phrase as `text` to the Siri bridge would execute "hey mimi" as
    a literal task and end up doing weird things like opening Safari search.
    """
    body = json.dumps(
        {"phrase": phrase, "score": round(score_val, 4), "engine": "personal", "token": token}
    ).encode()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            resp.read()
    except Exception as err:
        print(f"[wake-personal] post failed: {err}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--token", default="")
    parser.add_argument("--threshold", type=float, default=0.78)
    parser.add_argument("--cooldown-ms", type=int, default=4000)
    parser.add_argument("--command-window-sec", type=int, default=7)
    parser.add_argument("--aliases", default="mimi,hey mimi,ok mimi")
    parser.add_argument("--phrase", default="hey mimi")
    args = parser.parse_args()

    template_path = Path(os.path.expanduser(args.template))
    if not template_path.exists():
        print(f"[wake-personal] template not found: {template_path}", file=sys.stderr)
        return 1

    template_norm, meta = load_template(template_path)
    template_dim = template_norm.shape[0]
    requested_frames = int(meta.get("frames") or template_norm.shape[1])
    template_frames = effective_template_frames(template_norm, requested_frames)
    template_norm = template_norm[:, :template_frames]
    use_delta = template_dim == 2 * N_MFCC
    print(
        f"[wake-personal] loaded template v{meta.get('version', 1)} "
        f"({meta.get('num_samples', '?')} samples, dim={template_dim}, frames={template_frames}/{requested_frames}, delta={use_delta}), "
        f"threshold={args.threshold}, phrase='{args.phrase}'",
        file=sys.stderr,
    )

    # Match runtime window length to template frame width to avoid shape mismatch.
    # frame_count ~= 1 + (n_samples - n_fft) / hop_length  => invert to n_samples.
    window_sec = max((FRAME_MS + max(template_frames - 1, 0) * HOP_MS) / 1000.0, 1.2)
    win_samples = int(window_sec * SAMPLE_RATE)
    hop_samples = int(HOP_SEC * SAMPLE_RATE)
    ring = deque(maxlen=win_samples)
    last_trigger_ts = 0.0
    cooldown_sec = args.cooldown_ms / 1000.0

    # Adaptive noise floor — EWMA of RMS on quiet frames.
    noise_floor = float(meta.get("noise_floor_rms", 0.003))
    score_history: deque[float] = deque(maxlen=HISTORY_LEN)
    samples_since_score = 0

    def callback(indata, frames, time_info, status):  # noqa: ARG001
        nonlocal last_trigger_ts, noise_floor, samples_since_score
        try:
            ring.extend(indata[:, 0])
            if len(ring) < win_samples:
                return
            samples_since_score += frames
            # Score on every hop (v1 bug: `len(ring) % hop` never matched once saturated).
            if samples_since_score < hop_samples:
                return
            samples_since_score = 0

            now = time.time()
            if now - last_trigger_ts < cooldown_sec:
                return

            audio = np.array(ring, dtype=np.float32)
            rms = float(np.sqrt(np.mean(audio ** 2)))
            # Require energy > max(0.020, 4.5×noise_floor) → rejects breath/hum.
            gate = max(0.020, noise_floor * 4.5)
            if rms < gate:
                noise_floor = 0.95 * noise_floor + 0.05 * rms  # track quiet level
                score_history.clear()
                return

            live = extract_features(audio, use_delta=use_delta, target_frames=template_frames)

            # Spectral flatness check: reject noise-like windows (breath, fan, hum).
            flatness = float(librosa.feature.spectral_flatness(y=audio).mean())
            if flatness > 0.45:
                score_history.clear()
                return

            s = score(template_norm, live)
            score_history.append(s)

            # Confirm: CONFIRM_FRAMES of last HISTORY_LEN above threshold,
            # AND latest score is rising or at peak (rejects spurious mid-utterance matches).
            above = sum(1 for x in score_history if x >= args.threshold)
            score_is_peak = len(score_history) < 2 or s >= max(list(score_history)[:-1])
            if above >= CONFIRM_FRAMES and s >= args.threshold and score_is_peak:
                confirmed_windows = len(score_history)
                last_trigger_ts = now
                score_history.clear()
                print(f"[wake-personal] WAKE score={s:.3f} (confirmed {above}/{confirmed_windows})", file=sys.stderr)
                post_wake(args.endpoint, args.token, s, args.phrase)
        except Exception as err:
            print(f"[wake-personal] callback error: {err}", file=sys.stderr)
            score_history.clear()

    print(f"[wake-personal] listening on default mic @ {SAMPLE_RATE}Hz", file=sys.stderr)
    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        blocksize=hop_samples,
        callback=callback,
    ):
        try:
            while True:
                sd.sleep(1000)
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
