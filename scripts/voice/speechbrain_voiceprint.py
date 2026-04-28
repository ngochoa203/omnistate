#!/usr/bin/env python3
"""ECAPA-TDNN voiceprint enrollment + verification helper.

Examples:
  # Enroll owner from ~30s clean WAV
  python3 speechbrain_voiceprint.py enroll \
    --audio ~/recordings/owner_30s.wav \
    --user-id owner \
    --display-name "Owner" \
    --profile ~/.omnistate/voice_profile.json \
    --threshold 0.85

  # Verify probe audio against enrolled profiles
  python3 speechbrain_voiceprint.py verify \
    --audio ~/recordings/probe.wav \
    --profile ~/.omnistate/voice_profile.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple
import wave

import torch
import torchaudio
from speechbrain.inference.speaker import EncoderClassifier


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    return float(sum(a[i] * b[i] for i in range(n)))


def l2_normalize(vec: List[float]) -> List[float]:
    norm = sum(x * x for x in vec) ** 0.5
    if norm <= 1e-9:
        return []
    return [x / norm for x in vec]


def load_audio_mono_16k(path: Path) -> torch.Tensor:
    try:
        wav, sr = torchaudio.load(str(path))
        if wav.ndim == 2 and wav.shape[0] > 1:
            wav = torch.mean(wav, dim=0, keepdim=True)
        if sr != 16000:
            wav = torchaudio.functional.resample(wav, sr, 16000)
        return wav.squeeze(0)
    except Exception as err:
        if path.suffix.lower() != ".wav":
            raise SystemExit(
                f"Failed to decode audio ({path.suffix}). Install torchcodec or upload WAV. Root error: {err}"
            )

    try:
        with wave.open(str(path), "rb") as wf:
            channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            sample_rate = wf.getframerate()
            frame_count = wf.getnframes()
            compression = wf.getcomptype()
            if compression != "NONE":
                raise SystemExit("Compressed WAV is not supported. Please use PCM WAV.")
            raw = wf.readframes(frame_count)
    except wave.Error as err:
        raise SystemExit(
            f"Invalid WAV file. Install torchcodec or upload WEBM/OGG with proper format flag. Root error: {err}"
        )

    if sample_width not in (1, 2, 4):
        raise SystemExit("Unsupported WAV bit depth. Please use 16-bit PCM WAV.")

    if sample_width == 1:
        samples = torch.frombuffer(raw, dtype=torch.uint8).to(torch.float32)
        samples = (samples - 128.0) / 128.0
    elif sample_width == 2:
        samples = torch.frombuffer(raw, dtype=torch.int16).to(torch.float32) / 32768.0
    else:
        samples = torch.frombuffer(raw, dtype=torch.int32).to(torch.float32) / 2147483648.0

    if channels > 1:
        sample_count = samples.shape[0] // channels
        samples = samples[: sample_count * channels].view(sample_count, channels).mean(dim=1)

    if sample_rate != 16000:
        samples = torchaudio.functional.resample(samples.unsqueeze(0), sample_rate, 16000).squeeze(0)

    return samples


def extract_embedding(encoder: EncoderClassifier, wav: torch.Tensor) -> List[float]:
    emb = encoder.encode_batch(wav.unsqueeze(0))
    vec = emb.squeeze().detach().cpu().flatten().tolist()
    return l2_normalize([float(x) for x in vec])


def load_profile(path: Path) -> Dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def upsert_speaker_profile(
    profile: Dict,
    user_id: str,
    display_name: str,
    speaker_print: List[float],
    threshold: float,
) -> Dict:
    profiles = profile.get("speakerProfiles")
    if not isinstance(profiles, list):
        profiles = []

    out = []
    replaced = False
    for p in profiles:
        if not isinstance(p, dict):
            continue
        pid = p.get("userId")
        if not isinstance(pid, str) or not pid.strip():
            continue
        if pid.strip() == user_id:
            p = {
                "userId": user_id,
                "displayName": display_name,
                "speakerPrint": speaker_print,
                "speakerThreshold": float(threshold),
                "enabled": True,
            }
            replaced = True
        out.append(p)

    if not replaced:
        out.append(
            {
                "userId": user_id,
                "displayName": display_name,
                "speakerPrint": speaker_print,
                "speakerThreshold": float(threshold),
                "enabled": True,
            }
        )

    profile["speakerProfiles"] = out
    profile["activeSpeakerId"] = "all"
    profile["speakerBackend"] = "speechbrain"
    profile["voiceLockEnabled"] = True
    profile["speakerPrint"] = speaker_print
    profile["speakerThreshold"] = float(threshold)
    return profile


def choose_best_match(vec: List[float], profile: Dict) -> Tuple[str, float, float]:
    candidates = []
    profiles = profile.get("speakerProfiles")
    if isinstance(profiles, list):
        for p in profiles:
            if not isinstance(p, dict) or not p.get("enabled", True):
                continue
            uid = p.get("userId")
            sp = p.get("speakerPrint")
            thr = p.get("speakerThreshold", 0.85)
            if isinstance(uid, str) and isinstance(sp, list) and sp:
                candidates.append((uid, [float(x) for x in sp if isinstance(x, (int, float))], float(thr)))

    if not candidates and isinstance(profile.get("speakerPrint"), list):
        candidates.append(("default", [float(x) for x in profile["speakerPrint"]], float(profile.get("speakerThreshold", 0.85))))

    best_uid = ""
    best_score = -1.0
    best_thr = 0.85
    for uid, sp, thr in candidates:
        score = cosine_similarity(vec, sp)
        if score > best_score:
            best_uid = uid
            best_score = score
            best_thr = thr
    return best_uid, best_score, best_thr


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    enroll = sub.add_parser("enroll")
    enroll.add_argument("--audio", required=True)
    enroll.add_argument("--user-id", required=True)
    enroll.add_argument("--display-name", default="Owner")
    enroll.add_argument("--profile", default=str(Path.home() / ".omnistate" / "voice_profile.json"))
    enroll.add_argument("--threshold", type=float, default=0.85)

    verify = sub.add_parser("verify")
    verify.add_argument("--audio", required=True)
    verify.add_argument("--profile", default=str(Path.home() / ".omnistate" / "voice_profile.json"))

    args = parser.parse_args()

    encoder = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir=str(Path.home() / ".omnistate" / "speechbrain-spkrec"),
        run_opts={"device": "cpu"},
    )
    if encoder is None:
        raise SystemExit("Failed to initialize SpeechBrain encoder")

    audio_path = Path(args.audio).expanduser()
    if not audio_path.exists():
        raise SystemExit(f"Audio file not found: {audio_path}")

    wav = load_audio_mono_16k(audio_path)
    vec = extract_embedding(encoder, wav)
    if not vec:
        raise SystemExit("Failed to extract voice embedding")

    profile_path = Path(args.profile).expanduser()
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    profile = load_profile(profile_path)

    if args.cmd == "enroll":
        profile = upsert_speaker_profile(
            profile,
            user_id=str(args.user_id).strip(),
            display_name=str(args.display_name).strip() or str(args.user_id).strip(),
            speaker_print=vec,
            threshold=float(args.threshold),
        )
        with profile_path.open("w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)
        print(json.dumps({
            "ok": True,
            "mode": "enroll",
            "userId": args.user_id,
            "threshold": float(args.threshold),
            "embeddingDim": len(vec),
            "profile": str(profile_path),
        }, ensure_ascii=False))
        return

    uid, score, threshold = choose_best_match(vec, profile)
    accepted = bool(uid) and score >= threshold
    print(json.dumps({
        "ok": True,
        "mode": "verify",
        "matchedUserId": uid,
        "score": round(score, 6),
        "threshold": round(threshold, 6),
        "accepted": accepted,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
