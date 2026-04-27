#!/usr/bin/env python3
"""
Train a personal wake-word template from N short WAV samples.

v3 features (vs v2):
  - Silence trim at top_db=25 (tighter than v2's 30) before MFCC extraction
  - Outlier rejection: samples with mean pairwise cosine similarity < 0.55
    are dropped (min 3 kept); prevents generic noise from polluting template
  - noise_floor_rms: RMS of quietest 200 ms slice across all samples;
    listener can use as a personalized energy-gate seed
  - template_version=3 field added alongside version for explicit format ID

v2 features preserved:
  - Pre-emphasis (boosts high freqs ~ consonants like "h" in "hey")
  - Per-utterance peak normalization (loudness-invariant)
  - MFCC + delta (captures motion, not just spectral shape)
  - Mean of L2-normalized per-sample features

Usage:
    python3 train_personal_wake.py \
        --samples-dir ~/.omnistate/wake-samples \
        --output ~/.omnistate/wake-samples/personal_template.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

try:
    import librosa
except ImportError:
    print("[train] librosa not installed. Run: pip install librosa numpy", file=sys.stderr)
    sys.exit(2)


TARGET_SR = 16000
N_MFCC = 20
FRAME_MS = 25
HOP_MS = 10
MAX_DURATION_SEC = 4.5
TARGET_FRAMES = 140
PREEMPH = 0.97
TRIM_TOP_DB = 25          # tighter than v2's 30 — removes more background hiss
OUTLIER_SIM_THRESHOLD = 0.55  # drop sample if mean cosine sim to peers < this
NOISE_FLOOR_WIN_SAMPLES = int(0.200 * TARGET_SR)  # 200 ms window


WAKE_WORD = "hey mimi"
WAKE_PORTION_SEC = 1.35  # keep wake prefix only; improves "hey mimi" trigger latency/recall


def load_phrase(path: Path) -> str | None:
    """Read phrase from sidecar JSON (sample_N.json); return None if absent/invalid."""
    sidecar = path.with_suffix(".json")
    if not sidecar.exists():
        return None
    try:
        with open(sidecar) as f:
            return json.load(f).get("phrase")
    except Exception:
        return None


def preprocess(y: np.ndarray) -> np.ndarray:
    """Pre-emphasis + peak normalize → loudness-invariant signal."""
    if len(y) > 1:
        y = np.append(y[0], y[1:] - PREEMPH * y[:-1]).astype(np.float32)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = y / peak * 0.95
    return y


def extract_features(path: Path, phrase: str | None = None) -> np.ndarray:
    """Load WAV → 16kHz mono → trim → preprocess → MFCC+delta → fixed length."""
    y, _ = librosa.load(str(path), sr=TARGET_SR, mono=True)
    y, _ = librosa.effects.trim(y, top_db=TRIM_TOP_DB)
    if phrase is not None and phrase.lower().startswith(WAKE_WORD):
        y = y[: int(WAKE_PORTION_SEC * TARGET_SR)]
    else:
        max_samples = int(MAX_DURATION_SEC * TARGET_SR)
        if len(y) > max_samples:
            y = y[:max_samples]
    MIN_SAMPLES_AFTER_TRIM = TARGET_SR // 4  # 0.25 s
    MIN_RAW_SAMPLES = int(0.1 * TARGET_SR)  # 0.1 s — truly empty
    if len(y) < MIN_SAMPLES_AFTER_TRIM:
        # Reload untrimmed signal as fallback.
        y_raw, _ = librosa.load(str(path), sr=TARGET_SR, mono=True)
        if len(y_raw) < MIN_RAW_SAMPLES:
            raise ValueError(f"{path.name}: too short after trim ({len(y)/TARGET_SR:.2f}s)")
        print(
            f"[train]   {path.name}: WARNING — trim produced {len(y)/TARGET_SR:.2f}s "
            f"(< 0.25s); falling back to untrimmed signal ({len(y_raw)/TARGET_SR:.2f}s)",
            file=sys.stderr,
        )
        y = y_raw
        if phrase is not None and phrase.lower().startswith(WAKE_WORD):
            y = y[: int(WAKE_PORTION_SEC * TARGET_SR)]
        else:
            max_samples = int(MAX_DURATION_SEC * TARGET_SR)
            if len(y) > max_samples:
                y = y[:max_samples]

    y = preprocess(y)

    mfcc = librosa.feature.mfcc(
        y=y,
        sr=TARGET_SR,
        n_mfcc=N_MFCC,
        n_fft=int(FRAME_MS / 1000 * TARGET_SR),
        hop_length=int(HOP_MS / 1000 * TARGET_SR),
    )
    delta = librosa.feature.delta(mfcc)
    feats = np.vstack([mfcc, delta])  # (2*N_MFCC, frames)

    if feats.shape[1] < TARGET_FRAMES:
        pad = TARGET_FRAMES - feats.shape[1]
        feats = np.pad(feats, ((0, 0), (0, pad)), mode="constant")
    else:
        feats = feats[:, :TARGET_FRAMES]
    return feats.astype(np.float32)


def l2_normalize_cols(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=0, keepdims=True)
    norms[norms == 0] = 1.0
    return x / norms


def load_raw(path: Path) -> np.ndarray:
    """Load and trim signal (same trim as extract_features) for noise-floor calc."""
    y, _ = librosa.load(str(path), sr=TARGET_SR, mono=True)
    y, _ = librosa.effects.trim(y, top_db=TRIM_TOP_DB)
    return y


def cosine_sim_flat(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two flattened feature matrices."""
    af, bf = a.flatten(), b.flatten()
    denom = np.linalg.norm(af) * np.linalg.norm(bf)
    if denom < 1e-10:
        return 0.0
    return float(np.dot(af, bf) / denom)


def reject_outliers(
    feats_list: list[np.ndarray],
    names: list[str],
    min_keep: int,
) -> tuple[list[np.ndarray], list[str]]:
    """Drop samples whose mean pairwise cosine similarity < OUTLIER_SIM_THRESHOLD.

    Always keeps at least min_keep samples (skips dropping if it would go below).
    """
    n = len(feats_list)
    if n <= min_keep:
        return feats_list, names

    # Build n×n similarity matrix
    sim = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                sim[i, j] = cosine_sim_flat(feats_list[i], feats_list[j])

    mean_sim = sim.sum(axis=1) / max(n - 1, 1)

    keep_feats, keep_names = [], []
    for i, (f, name) in enumerate(zip(feats_list, names)):
        if mean_sim[i] < OUTLIER_SIM_THRESHOLD:
            if len(feats_list) - (n - len(keep_feats) - 1) > min_keep:
                print(
                    f"[train]   {name}: OUTLIER dropped "
                    f"(mean_sim={mean_sim[i]:.3f} < {OUTLIER_SIM_THRESHOLD})",
                    file=sys.stderr,
                )
                continue
            else:
                print(
                    f"[train]   {name}: would be outlier (mean_sim={mean_sim[i]:.3f}) "
                    f"but keeping to maintain min_samples={min_keep}",
                    file=sys.stderr,
                )
        keep_feats.append(f)
        keep_names.append(name)

    return keep_feats, keep_names


def compute_noise_floor_rms(raw_signals: list[np.ndarray]) -> float:
    """RMS of the quietest 200 ms window across all sample signals."""
    min_rms = float("inf")
    win = NOISE_FLOOR_WIN_SAMPLES
    for y in raw_signals:
        if len(y) < win:
            rms = float(np.sqrt(np.mean(y ** 2)))
            min_rms = min(min_rms, rms)
        else:
            for start in range(0, len(y) - win + 1, win // 2):
                chunk = y[start : start + win]
                rms = float(np.sqrt(np.mean(chunk ** 2)))
                min_rms = min(min_rms, rms)
    return min_rms if min_rms < float("inf") else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--min-samples", type=int, default=3)
    args = parser.parse_args()

    samples_dir = Path(os.path.expanduser(args.samples_dir))
    output_path = Path(os.path.expanduser(args.output))

    if not samples_dir.exists():
        print(f"[train] samples-dir does not exist: {samples_dir}", file=sys.stderr)
        return 1

    wavs = sorted(samples_dir.glob("sample_*.wav"))
    if len(wavs) < args.min_samples:
        print(
            f"[train] need at least {args.min_samples} samples, found {len(wavs)}",
            file=sys.stderr,
        )
        return 1

    print(f"[train] processing {len(wavs)} samples from {samples_dir}")
    feats_list: list[np.ndarray] = []
    names_list: list[str] = []
    raw_signals: list[np.ndarray] = []
    for wav in wavs:
        try:
            phrase = load_phrase(wav)
            f = extract_features(wav, phrase)
            raw_signals.append(load_raw(wav))
            # Normalize each sample BEFORE averaging → equal weight.
            feats_list.append(l2_normalize_cols(f))
            names_list.append(wav.name)
            if phrase is not None and phrase.lower().startswith(WAKE_WORD):
                print(f"[train]   {wav.name}: wake-portion trim applied ({WAKE_PORTION_SEC}s)")
            else:
                print(f"[train]   {wav.name}: full-duration (no phrase metadata)")
            print(f"[train]   {wav.name}: feature shape={f.shape}")
        except Exception as err:
            print(f"[train]   {wav.name}: SKIPPED — {err}", file=sys.stderr)

    if len(feats_list) < args.min_samples:
        print(f"[train] too few usable samples after loading", file=sys.stderr)
        return 1

    # Outlier rejection — only applicable when all samples are the SAME phrase.
    # When the wizard records 5 *distinct* phrases the cosine similarity across
    # phrases will legitimately be low, so applying the outlier threshold would
    # incorrectly drop perfectly good samples.
    raw_phrases = [load_phrase(samples_dir / n) for n in names_list]
    raw_non_none = [p for p in raw_phrases if p is not None]
    all_same_phrase = len(raw_non_none) == 0 or (
        len(set(p.lower().strip() for p in raw_non_none)) == 1
    )
    if all_same_phrase:
        feats_list, names_list = reject_outliers(feats_list, names_list, args.min_samples)
        if len(feats_list) < args.min_samples:
            print(f"[train] too few samples after outlier rejection", file=sys.stderr)
            return 1
    else:
        print(
            f"[train] skipping outlier rejection — {len(set(p.lower().strip() for p in raw_non_none))} "
            f"distinct phrases detected (expected acoustic diversity)",
            file=sys.stderr,
        )

    # Collect per-sample phrases for the output payload (names_list may have
    # shrunk after outlier rejection in the single-phrase path above).
    kept_phrases: list[str | None] = [load_phrase(samples_dir / n) for n in names_list]
    non_none_phrases = [p for p in kept_phrases if p is not None]
    phrases_are_distinct = (
        len(non_none_phrases) >= 2
        and len(set(p.lower().strip() for p in non_none_phrases)) == len(non_none_phrases)
    )

    noise_floor_rms = compute_noise_floor_rms(raw_signals)

    template = np.mean(np.stack(feats_list, axis=0), axis=0)
    template_norm = l2_normalize_cols(template)

    # Per-sample centroids (L2-normalised) — stored for future multi-centroid matching.
    # The current listener uses only mfcc_norm (the mean) and ignores this field.
    per_sample_centroids = [f.tolist() for f in feats_list]

    assert template_norm.shape[0] == 2 * N_MFCC, (
        f"feature_dim={template_norm.shape[0]} != 2*N_MFCC={2*N_MFCC}"
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 2,           # kept for backward-compat with existing listeners
        "template_version": 3,  # new field — signals v3 format
        "sample_rate": TARGET_SR,
        "n_mfcc": N_MFCC,
        "feature_dim": int(template_norm.shape[0]),
        "frames": int(template_norm.shape[1]),
        "frame_ms": FRAME_MS,
        "hop_ms": HOP_MS,
        "preemphasis": PREEMPH,
        "num_samples": len(feats_list),
        "noise_floor_rms": round(noise_floor_rms, 8),
        "phrases": kept_phrases,           # per-sample phrase strings (may contain None)
        "distinct_phrases": phrases_are_distinct,
        "mfcc_norm": template_norm.tolist(),            # mean centroid — backward-compat key
        "per_sample_centroids": per_sample_centroids,  # individual L2-normalised centroids
    }
    with open(output_path, "w") as fp:
        json.dump(payload, fp)
    print(
        f"[train] wrote template → {output_path} "
        f"({len(feats_list)} samples, v3 MFCC+delta, noise_floor_rms={noise_floor_rms:.6f})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
