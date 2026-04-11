#!/usr/bin/env python3
import argparse
import atexit
import array
import audioop
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import re
from difflib import SequenceMatcher

try:
    import speech_recognition as sr
except Exception as err:
    print(f"[wake] missing dependency speech_recognition: {err}", flush=True)
    sys.exit(2)

try:
    from sea_g2p import Normalizer as SeaNormalizer
except Exception:
    SeaNormalizer = None


_vi_normalizer = None
_speechbrain_encoder = None


def get_vi_normalizer():
    global _vi_normalizer
    if _vi_normalizer is None and SeaNormalizer is not None:
        try:
            _vi_normalizer = SeaNormalizer()
        except Exception:
            _vi_normalizer = None
    return _vi_normalizer


def normalize_vi_text(text):
    base = normalize_text(text)
    if not base:
        return ""
    normalizer = get_vi_normalizer()
    if normalizer is None:
        return base
    try:
        return normalize_text(normalizer.normalize(base))
    except Exception:
        return base


def recognize_text(recognizer, audio):
    try:
        return recognizer.recognize_sphinx(audio).strip().lower()
    except Exception:
        return ""


def load_voice_profile(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        raw = {}

    aliases = raw.get("wakeAliases")
    if not isinstance(aliases, list):
        aliases = []
    aliases = [normalize_text(x) for x in aliases if isinstance(x, str) and x.strip()]

    corrections = raw.get("commandCorrections")
    if not isinstance(corrections, dict):
        corrections = {}
    normalized_corrections = {}
    for k, v in corrections.items():
        if isinstance(k, str) and isinstance(v, str):
            nk = normalize_text(k)
            nv = normalize_text(v)
            if nk and nv:
                normalized_corrections[nk] = nv

    phrase_hints = raw.get("phraseHints")
    if not isinstance(phrase_hints, list):
        phrase_hints = []
    phrase_hints = [normalize_text(x) for x in phrase_hints if isinstance(x, str) and x.strip()]

    hint_aliases = raw.get("hintAliases")
    if not isinstance(hint_aliases, dict):
        hint_aliases = {}
    normalized_hint_aliases = {}
    for k, v in hint_aliases.items():
        if isinstance(k, str) and isinstance(v, str):
            nk = normalize_text(k)
            nv = normalize_text(v)
            if nk and nv:
                normalized_hint_aliases[nk] = nv

    langs = raw.get("languages")
    if not isinstance(langs, list):
        langs = []
    langs = [x for x in langs if isinstance(x, str) and x.strip()]

    wake_langs = raw.get("wakeLanguages")
    if not isinstance(wake_langs, list):
        wake_langs = []
    wake_langs = [x for x in wake_langs if isinstance(x, str) and x.strip()]

    command_langs = raw.get("commandLanguages")
    if not isinstance(command_langs, list):
        command_langs = []
    command_langs = [x for x in command_langs if isinstance(x, str) and x.strip()]

    default_lang = raw.get("language")
    if not isinstance(default_lang, str) or not default_lang.strip():
        default_lang = "vi-VN"

    voice_lock_enabled = bool(raw.get("voiceLockEnabled", False))
    speaker_print = raw.get("speakerPrint")
    if not isinstance(speaker_print, list):
        speaker_print = []
    speaker_print = [float(x) for x in speaker_print if isinstance(x, (int, float))]

    speaker_threshold = raw.get("speakerThreshold", 0.79)
    if not isinstance(speaker_threshold, (int, float)):
        speaker_threshold = 0.79

    speaker_profiles_raw = raw.get("speakerProfiles")
    speaker_profiles = []
    if isinstance(speaker_profiles_raw, list):
        for p in speaker_profiles_raw:
            if not isinstance(p, dict):
                continue
            user_id = p.get("userId")
            if not isinstance(user_id, str) or not user_id.strip():
                continue
            user_name = p.get("displayName") if isinstance(p.get("displayName"), str) else user_id
            p_print = p.get("speakerPrint")
            if not isinstance(p_print, list):
                continue
            vec = [float(x) for x in p_print if isinstance(x, (int, float))]
            if not vec:
                continue
            p_threshold = p.get("speakerThreshold", speaker_threshold)
            if not isinstance(p_threshold, (int, float)):
                p_threshold = speaker_threshold
            speaker_profiles.append(
                {
                    "userId": user_id.strip(),
                    "displayName": user_name.strip() if isinstance(user_name, str) else user_id.strip(),
                    "speakerPrint": vec,
                    "speakerThreshold": float(p_threshold),
                    "enabled": bool(p.get("enabled", True)),
                }
            )

    active_speaker_id = raw.get("activeSpeakerId")
    if not isinstance(active_speaker_id, str) or not active_speaker_id.strip():
        active_speaker_id = ""

    return {
        "wakeAliases": aliases,
        "commandCorrections": normalized_corrections,
        "phraseHints": phrase_hints,
        "hintAliases": normalized_hint_aliases,
        "languages": langs,
        "wakeLanguages": wake_langs,
        "commandLanguages": command_langs,
        "language": default_lang,
        "voiceLockEnabled": voice_lock_enabled,
        "speakerPrint": speaker_print,
        "speakerThreshold": float(speaker_threshold),
        "speakerProfiles": speaker_profiles,
        "activeSpeakerId": active_speaker_id,
    }


def speaker_backend_name():
    preferred = os.environ.get("OMNISTATE_SPEAKER_BACKEND", "speechbrain").strip().lower()
    if preferred in {"legacy", "fallback", "classic"}:
        return "legacy"
    return "speechbrain"


def get_speechbrain_encoder():
    global _speechbrain_encoder
    if _speechbrain_encoder is not None:
        return _speechbrain_encoder
    try:
        from speechbrain.inference.speaker import EncoderClassifier  # type: ignore[import-not-found]
        _speechbrain_encoder = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(Path.home() / ".omnistate" / "speechbrain-spkrec"),
            run_opts={"device": "cpu"},
        )
        return _speechbrain_encoder
    except Exception:
        _speechbrain_encoder = None
        return None


def extract_voice_signature_speechbrain(audio):
    if speaker_backend_name() != "speechbrain":
        return []
    encoder = get_speechbrain_encoder()
    if encoder is None:
        return []

    try:
        import torch
        raw = audio.get_raw_data(convert_rate=16000, convert_width=2)
        if not raw:
            return []

        pcm = array.array("h")
        pcm.frombytes(raw)
        if sys.byteorder == "big":
            pcm.byteswap()
        if len(pcm) <= 200:
            return []

        waveform = torch.tensor(pcm, dtype=torch.float32) / 32768.0
        emb = encoder.encode_batch(waveform.unsqueeze(0))
        vec = emb.squeeze().detach().cpu().flatten().tolist()
        norm = sum((x * x) for x in vec) ** 0.5
        if norm <= 1e-9:
            return []
        return [x / norm for x in vec]
    except Exception:
        return []


def extract_voice_signature(audio, bins=32):
    sb_vec = extract_voice_signature_speechbrain(audio)
    if sb_vec:
        return sb_vec

    try:
        raw = audio.get_raw_data(convert_rate=8000, convert_width=2)
    except Exception:
        try:
            raw = audio.get_raw_data()
        except Exception:
            return []

    if not raw:
        return []

    try:
        width = 2
        total = len(raw) // width
        if total <= 0:
            return []

        chunk = max(1, total // bins)
        vec = []
        for i in range(bins):
            start = i * chunk * width
            end = min(len(raw), start + (chunk * width))
            if end <= start:
                vec.append(0.0)
                continue
            rms = audioop.rms(raw[start:end], width)
            vec.append(float(rms))

        zcr = float(audioop.cross(raw, width)) / max(1.0, float(total))
        avg_rms = sum(vec) / max(1.0, float(len(vec)))
        vec.append(zcr)
        vec.append(avg_rms)

        norm = sum((x * x) for x in vec) ** 0.5
        if norm <= 1e-9:
            return []
        return [x / norm for x in vec]
    except Exception:
        return []


def cosine_similarity(a, b):
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    return sum(a[i] * b[i] for i in range(n))


def verify_speaker(audio, speaker_profiles, speaker_print, threshold, active_speaker_id=""):
    if not speaker_print and not speaker_profiles:
        return True, 1.0, "default", float(threshold)

    sig = extract_voice_signature(audio)
    if not sig:
        return False, 0.0, "", threshold

    candidates = []
    for p in speaker_profiles:
        if not p.get("enabled", True):
            continue
        if active_speaker_id and active_speaker_id not in {"all", "*"} and p.get("userId") != active_speaker_id:
            continue
        p_print = p.get("speakerPrint")
        if not isinstance(p_print, list) or not p_print:
            continue
        p_threshold = p.get("speakerThreshold", threshold)
        if not isinstance(p_threshold, (int, float)):
            p_threshold = threshold
        candidates.append(
            {
                "userId": p.get("userId", "unknown"),
                "speakerPrint": p_print,
                "speakerThreshold": float(p_threshold),
            }
        )

    if not candidates and speaker_print:
        candidates.append(
            {
                "userId": "default",
                "speakerPrint": speaker_print,
                "speakerThreshold": float(threshold),
            }
        )

    if not candidates:
        return False, 0.0, "", threshold

    best_score = -1.0
    best_user = ""
    best_threshold = float(threshold)
    for p in candidates:
        score = cosine_similarity(sig, p["speakerPrint"])
        if score > best_score:
            best_score = score
            best_user = p["userId"]
            best_threshold = p["speakerThreshold"]

    return best_score >= best_threshold, best_score, best_user, best_threshold


def audio_rms(audio):
    try:
        return audioop.rms(audio.get_raw_data(), 2)
    except Exception:
        return 0


def recognize_google_with_languages(recognizer, audio, languages):
    for lang in languages:
        try:
            text = recognizer.recognize_google(audio, language=lang).strip().lower()
            if text:
                return text, lang
        except Exception:
            continue
    return "", ""


def amplify_audio_if_needed(audio, target_rms=420, max_gain=6.0):
    try:
        raw = audio.get_raw_data()
        width = audio.sample_width
        rate = audio.sample_rate
        rms = audioop.rms(raw, width)
        if rms <= 0:
            return audio, 0, 1.0
        gain = min(max_gain, max(1.0, float(target_rms) / float(rms)))
        if gain <= 1.03:
            return audio, rms, 1.0
        boosted_raw = audioop.mul(raw, width, gain)
        boosted = sr.AudioData(boosted_raw, rate, width)
        return boosted, rms, gain
    except Exception:
        return audio, 0, 1.0


def count_hint_hits(text, phrase_hints):
    if not text:
        return 0
    out = 0
    for hint in phrase_hints:
        if hint and hint in text:
            out += 1
    return out


def choose_better_transcript(primary, retry, phrase_hints):
    if not retry:
        return primary
    if not primary:
        return retry

    p_words = len(primary.split())
    r_words = len(retry.split())
    p_incomplete = 1 if looks_incomplete_command(primary) else 0
    r_incomplete = 1 if looks_incomplete_command(retry) else 0
    p_hints = count_hint_hits(primary, phrase_hints)
    r_hints = count_hint_hits(retry, phrase_hints)

    # Prefer richer and less-truncated transcript.
    p_score = (p_words * 2) + (p_hints * 3) - (p_incomplete * 4)
    r_score = (r_words * 2) + (r_hints * 3) - (r_incomplete * 4)
    return retry if r_score > p_score else primary


def extract_media_query(text):
    t = normalize_text(text)
    # Remove trigger/action filler words while keeping the song/query phrase.
    patterns = [
        r"\bmở\b",
        r"\bxem\b",
        r"\bphát\b",
        r"\bplay\b",
        r"\bbài hát\b",
        r"\bnhạc\b",
        r"\btrên youtube\b",
        r"\byoutube\b",
        r"\bở safari\b",
        r"\btrên safari\b",
        r"\bsafari\b",
    ]
    for p in patterns:
        t = re.sub(p, " ", t)
    t = re.sub(r"\s+", " ", t).strip()

    # Remove common ASR filler tokens around media queries.
    filler = {"in", "a", "ơ", "ờ", "uh", "um"}
    words = [w for w in t.split(" ") if w]
    while words and words[0] in filler:
        words.pop(0)
    while words and words[-1] in filler:
        words.pop()
    t = " ".join(words)
    return t


def rewrite_media_command(text):
    t = normalize_text(text)
    if not t:
        return t

    if "youtube" not in t:
        return t
    if "safari" not in t:
        return t

    query = extract_media_query(t)
    if not query:
        query = t

    encoded = urllib.parse.quote_plus(query)
    return f"mở Safari URL https://www.youtube.com/results?search_query={encoded}"


def normalize_media_tokens(text):
    t = normalize_text(text)
    if not t:
        return t
    # Normalize common truncations around platform/browser words.
    replacements = [
        (r"\bo saf\b", "ở safari"),
        (r"\bở saf\b", "ở safari"),
        (r"\btren youtube\b", "trên youtube"),
        (r"\bo youtube\b", "ở youtube"),
        (r"\btren safari\b", "trên safari"),
    ]
    out = t
    for pattern, repl in replacements:
        out = re.sub(pattern, repl, out)
    return normalize_text(out)


def media_query_tokens(text):
    q = normalize_text(extract_media_query(text))
    if not q:
        return []
    return [w for w in q.split(" ") if w]


def is_low_confidence_media_command(text):
    t = normalize_text(text)
    if "youtube" not in t or "safari" not in t:
        return False

    tokens = media_query_tokens(t)
    if not tokens:
        return True

    noise_tokens = {
        "in",
        "tren",
        "trên",
        "o",
        "ở",
        "youtube",
        "safari",
        "mo",
        "mở",
        "play",
        "phat",
        "phát",
        "xem",
        "nhac",
        "nhạc",
        "bai",
        "bài",
        "hat",
        "hát",
    }
    content = [w for w in tokens if w not in noise_tokens]
    if not content:
        return True
    content_text = " ".join(content)
    if len(content) < 2 and len(content_text) < 5:
        return True
    return False


def command_semantic_score(text, phrase_hints):
    t = normalize_text(text)
    if not t:
        return -999
    words = len([w for w in t.split(" ") if w])
    score = (words * 2) + (count_hint_hits(t, phrase_hints) * 3)
    if looks_incomplete_command(t):
        score -= 4
    if is_low_confidence_media_command(t):
        score -= 10
    return score


def choose_better_command_candidate(primary, candidate, phrase_hints):
    if not candidate:
        return primary
    if not primary:
        return candidate
    return candidate if command_semantic_score(candidate, phrase_hints) > command_semantic_score(primary, phrase_hints) else primary


def build_reply_text(command, rewritten=False):
    c = normalize_text(command)
    if rewritten and "youtube.com/results?search_query=" in c and "safari" in c:
        return "Okay. Da mo YouTube tren Safari."
    return "Okay. Da nhan lenh."


def build_notify_text(command, rewritten=False):
    c = normalize_text(command)
    if rewritten and "youtube.com/results?search_query=" in c and "safari" in c:
        return "Da mo YouTube tren Safari"
    return "Da nhan lenh"


def apply_phrase_hints(text, phrase_hints, hint_aliases):
    t = normalize_vi_text(text)
    if not t:
        return t

    out = t

    # Canonicalize common app/platform variants first.
    for src, dst in hint_aliases.items():
        if src in out:
            out = out.replace(src, dst)

    # If platform keyword is near-miss, snap to canonical hint token.
    for hint in phrase_hints:
        if not hint:
            continue
        if hint in out:
            continue
        hint_words = hint.split()
        if len(hint_words) != 1:
            continue
        hw = hint_words[0]
        words = out.split()
        for i, w in enumerate(words):
            if phrase_similarity(w, hw) >= 0.78:
                words[i] = hw
        out = " ".join(words)

    return normalize_text(out)


def apply_command_corrections(text, corrections):
    normalized = normalize_vi_text(text)
    if not normalized or not corrections:
        return normalized

    # Full-phrase override first.
    if normalized in corrections:
        return corrections[normalized]

    # Then phrase substitutions by descending key length.
    out = normalized
    for src in sorted(corrections.keys(), key=len, reverse=True):
        dst = corrections[src]
        if src in out:
            out = out.replace(src, dst)

    # Fuzzy full-phrase remap helps recover close Vietnamese misrecognitions.
    best_src = ""
    best_ratio = 0.0
    for src in corrections.keys():
        ratio = phrase_similarity(out, src)
        if ratio > best_ratio:
            best_ratio = ratio
            best_src = src
    if best_src and best_ratio >= 0.86:
        out = corrections[best_src]

    return normalize_text(out)


def capture_command_until_silence(
    recognizer,
    source,
    languages,
    corrections,
    allow_offline_fallback,
    silence_end_sec,
    max_total_sec,
    command_min_rms,
    phrase_hints,
    hint_aliases,
):
    # Keep listening in chunks and stop only after silence timeout.
    started = time.time()
    deadline = started + max_total_sec
    max_deadline = started + max(55, max_total_sec)
    chunks = []
    engines = []
    captured_parts = []

    while True:
        now = time.time()
        elapsed = now - started
        if now >= deadline:
            break

        remaining = max(1, int(deadline - now))
        phrase_limit = min(8, max(2, int(remaining)))

        try:
            audio_part = recognizer.listen(
                source,
                timeout=silence_end_sec,
                phrase_time_limit=phrase_limit,
            )
        except sr.WaitTimeoutError:
            # No speech for silence_end_sec -> finalize immediately.
            break

        captured_parts.append(audio_part)

        try:
            rms = audioop.rms(audio_part.get_raw_data(), 2)
        except Exception:
            rms = 0

        prepared_audio = audio_part
        if rms < command_min_rms:
            prepared_audio, _, gain = amplify_audio_if_needed(
                audio_part,
                target_rms=max(420, command_min_rms * 3),
                max_gain=8.0,
            )
            if gain <= 1.03:
                continue

        text, engine = recognize_command_text(
            recognizer,
            prepared_audio,
            languages,
            corrections,
            phrase_hints,
            hint_aliases,
            allow_offline_fallback=allow_offline_fallback,
        )
        text = normalize_media_tokens(text)

        if text:
            chunks.append(text)
            engines.append(engine)

            # Adaptive window: extend listening when phrase is long or still incomplete.
            merged_now = normalize_text(" ".join(chunks))
            words = len([w for w in merged_now.split(" ") if w])
            extend_sec = 0
            if looks_incomplete_command(merged_now):
                extend_sec += 8
            if words >= 6:
                extend_sec += min(14, int(words * 0.9))
            if extend_sec > 0:
                deadline = min(max_deadline, deadline + extend_sec)

    total_sec = round(time.time() - started, 2)
    if not chunks:
        # Last resort: transcribe merged captured audio once to reduce false command_empty.
        if captured_parts:
            try:
                merged_raw = b"".join(p.get_raw_data() for p in captured_parts)
                merged_audio = sr.AudioData(
                    merged_raw,
                    captured_parts[0].sample_rate,
                    captured_parts[0].sample_width,
                )
                merged_audio, _, _ = amplify_audio_if_needed(merged_audio, target_rms=560, max_gain=12.0)
                rescue_text, rescue_engine = recognize_command_text(
                    recognizer,
                    merged_audio,
                    languages,
                    corrections,
                    phrase_hints,
                    hint_aliases,
                    allow_offline_fallback=allow_offline_fallback,
                )
                if rescue_text:
                    return normalize_text(rescue_text), rescue_engine, total_sec, 1
            except Exception:
                pass
        return "", "none", total_sec, 0

    merged = normalize_text(" ".join(chunks))
    merged = normalize_media_tokens(merged)

    # If the sentence ends with a dangling connector, capture a short tail.
    if looks_incomplete_command(merged):
        try:
            audio_tail = recognizer.listen(source, timeout=2, phrase_time_limit=6)
            try:
                tail_rms = audioop.rms(audio_tail.get_raw_data(), 2)
            except Exception:
                tail_rms = 0
            if tail_rms >= command_min_rms:
                tail_text, tail_engine = recognize_command_text(
                    recognizer,
                    audio_tail,
                    languages,
                    corrections,
                    phrase_hints,
                    hint_aliases,
                    allow_offline_fallback=allow_offline_fallback,
                )
                if tail_text:
                    merged = normalize_text(f"{merged} {tail_text}")
                    merged = normalize_media_tokens(merged)
                    engines.append(tail_engine)
                    chunks.append(tail_text)
        except Exception:
            pass

    # If media command intent exists but query is low-confidence, attempt extra tail stitching.
    extra_tail_attempts = 0
    while is_low_confidence_media_command(merged) and extra_tail_attempts < 2:
        extra_tail_attempts += 1
        try:
            audio_tail = recognizer.listen(source, timeout=3, phrase_time_limit=8)
            tail_text, tail_engine = recognize_command_text(
                recognizer,
                audio_tail,
                languages,
                corrections,
                phrase_hints,
                hint_aliases,
                allow_offline_fallback=allow_offline_fallback,
            )
            tail_text = normalize_media_tokens(tail_text)
            if tail_text:
                stitched = normalize_text(f"{merged} {tail_text}")
                merged = choose_better_command_candidate(merged, stitched, phrase_hints)
                engines.append(tail_engine)
                chunks.append(tail_text)
        except Exception:
            break

    # Final rescue pass on merged audio even when chunks are present.
    if captured_parts:
        try:
            merged_raw = b"".join(p.get_raw_data() for p in captured_parts)
            merged_audio = sr.AudioData(
                merged_raw,
                captured_parts[0].sample_rate,
                captured_parts[0].sample_width,
            )
            merged_audio, _, _ = amplify_audio_if_needed(merged_audio, target_rms=560, max_gain=12.0)
            rescue_text, _ = recognize_command_text(
                recognizer,
                merged_audio,
                languages,
                corrections,
                phrase_hints,
                hint_aliases,
                allow_offline_fallback=allow_offline_fallback,
            )
            rescue_text = normalize_media_tokens(rescue_text)
            merged = choose_better_command_candidate(merged, rescue_text, phrase_hints)
        except Exception:
            pass

    primary_engine = engines[0] if engines else "none"
    return merged, primary_engine, total_sec, len(chunks)


def capture_followup_media_command(
    recognizer,
    languages,
    corrections,
    allow_offline_fallback,
    command_min_rms,
    phrase_hints,
    hint_aliases,
    attempts=2,
):
    current = ""
    engine = "none"
    total_sec = 0.0
    total_chunks = 0

    for _ in range(max(1, attempts)):
        try:
            with sr.Microphone(sample_rate=16000) as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.2)
                recognizer.pause_threshold = 1.05
                recognizer.non_speaking_duration = 0.7
                follow, follow_engine, sec, chunks = capture_command_until_silence(
                    recognizer=recognizer,
                    source=source,
                    languages=languages,
                    corrections=corrections,
                    allow_offline_fallback=allow_offline_fallback,
                    silence_end_sec=2,
                    max_total_sec=12,
                    command_min_rms=command_min_rms,
                    phrase_hints=phrase_hints,
                    hint_aliases=hint_aliases,
                )
        except Exception:
            continue

        total_sec += sec
        total_chunks += chunks
        if not follow:
            continue

        candidate = normalize_text(f"{current} {follow}") if current else follow
        current = choose_better_command_candidate(current, candidate, phrase_hints)
        engine = follow_engine

        if not is_low_confidence_media_command(current):
            break

    return current, engine, round(total_sec, 2), total_chunks


def recognize_command_text(
    recognizer,
    audio,
    languages,
    corrections,
    phrase_hints,
    hint_aliases,
    allow_offline_fallback=False,
):
    # Prefer cloud transcription for better accuracy.
    text, used_lang = recognize_google_with_languages(recognizer, audio, languages)
    if text:
        corrected = apply_command_corrections(
            apply_phrase_hints(text, phrase_hints, hint_aliases),
            corrections,
        )
        corrected = normalize_media_tokens(corrected)

        # Retry ASR once on boosted audio if transcript seems truncated.
        if looks_incomplete_command(corrected):
            boosted_audio, _, gain = amplify_audio_if_needed(audio, target_rms=540, max_gain=10.0)
            if gain > 1.03:
                retry_text, retry_lang = recognize_google_with_languages(recognizer, boosted_audio, languages)
                retry_corrected = apply_command_corrections(
                    apply_phrase_hints(retry_text, phrase_hints, hint_aliases),
                    corrections,
                )
                retry_corrected = normalize_media_tokens(retry_corrected)
                corrected = choose_better_transcript(corrected, retry_corrected, phrase_hints)
                if retry_lang:
                    used_lang = retry_lang

        return corrected, f"google:{used_lang}"

    if not allow_offline_fallback:
        return "", "none"

    # Optional fallback to offline Sphinx when explicitly enabled.
    text = apply_command_corrections(
        apply_phrase_hints(recognize_text(recognizer, audio), phrase_hints, hint_aliases),
        corrections,
    )
    text = normalize_media_tokens(text)
    return text, "sphinx"


def is_garbage_command(text):
    garbage = {
        "uh",
        "um",
        "ah",
        "huh",
        "oh",
        "er",
        "hmm",
        "uh huh",
        "mhm",
        "yeah",
        "yes",
        "the",
        "and",
        "and in",
        "at a",
        "that law",
    }
    normalized = (text or "").strip().lower()
    if not normalized:
        return True
    if normalized in garbage:
        return True
    return len(normalized) < 3


def looks_like_intent_command(text):
    t = normalize_text(text)
    if not t:
        return False

    action_hints = {
        "open",
        "run",
        "start",
        "stop",
        "show",
        "list",
        "search",
        "find",
        "play",
        "pause",
        "call",
        "send",
        "create",
        "delete",
        "set",
        "turn",
        "close",
        "what",
        "who",
        "where",
        "when",
        "how",
        "why",
    }

    words = [w for w in t.split(" ") if w]
    if not words:
        return False

    if words[0] in action_hints:
        return True

    # Multi-word utterances are more likely to be real intent than filler.
    return len(words) >= 3


def looks_incomplete_command(text):
    t = normalize_text(text)
    if not t:
        return False
    tail_words = {
        "tren",
        "trên",
        "o",
        "ở",
        "va",
        "và",
        "cho",
        "toi",
        "tôi",
        "cua",
        "của",
        "tai",
        "tại",
    }
    last = t.split(" ")[-1]
    if last in tail_words:
        return True
    # Common pattern from truncation: command ends with platform preposition.
    return t.endswith(" tren") or t.endswith(" trên") or t.endswith(" o") or t.endswith(" ở")


def should_reject_command(text, engine):
    if is_garbage_command(text):
        return True

    if is_low_confidence_media_command(text):
        return True

    # Sphinx fallback is noisier; require stronger intent shape.
    if engine == "sphinx" and not looks_like_intent_command(text):
        return True

    return False


def normalize_text(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def phrase_similarity(a, b):
    a_n = normalize_text(a)
    b_n = normalize_text(b)
    if not a_n or not b_n:
        return 0.0
    return SequenceMatcher(None, a_n, b_n).ratio()


def detect_wake(
    recognizer,
    audio,
    phrase,
    wake_aliases,
    languages,
    min_similarity=0.9,
    max_phrase_repeat=1,
    allow_offline_wake_fallback=False,
    wake_min_rms=160,
):
    # Strict wake gate: only wake on explicit phrase from cloud transcript.
    phrase = normalize_text(phrase)
    allowed_phrases = {phrase}
    if phrase == "hey mimi":
        allowed_phrases.add("mimi")
    for alias in wake_aliases:
        if alias:
            allowed_phrases.add(alias)

    def is_valid_candidate(text):
        text = normalize_text(text)
        if not text:
            return False
        words = [w for w in text.split(" ") if w]
        word_count = len(words)
        leadins = {"hey", "ok", "okay", "này", "oi", "ơi", "a", "ê", "alo"}
        for candidate in allowed_phrases:
            candidate_words = [w for w in candidate.split(" ") if w]
            if not candidate_words:
                continue
            phrase_count = text.count(candidate)
            if phrase_count == 0 or phrase_count > max_phrase_repeat:
                continue

            # Strict primary rule: exact wake phrase.
            if text == candidate:
                return True

            # Optional one-token polite lead-in, e.g. "hey mimi".
            if word_count == len(candidate_words) + 1 and words[-len(candidate_words):] == candidate_words:
                if words[0] in leadins:
                    return True

            # Fuzzy only for canonical phrase, not for short aliases (prevents noise triggers).
            if candidate == phrase and len(candidate) >= 4 and phrase_similarity(text, candidate) >= min_similarity + 0.04:
                return True
        return False

    # Primary: Google STT wake detection.
    try:
        try:
            rms = audioop.rms(audio.get_raw_data(), 2)
        except Exception:
            rms = 0

        prepared_audio = audio
        if rms < wake_min_rms:
            prepared_audio, _, gain = amplify_audio_if_needed(
                audio,
                target_rms=max(380, wake_min_rms * 3),
                max_gain=10.0,
            )
            if gain <= 1.03:
                return False, f"rms_low:{rms}"

        g, used_lang = recognize_google_with_languages(recognizer, prepared_audio, languages)
        g = normalize_text(g)
        if g:
            if is_valid_candidate(g):
                return True, g
            return False, f"google:{used_lang}:{g}"
    except Exception:
        pass

    if not allow_offline_wake_fallback:
        return False, ""

    # Optional fallback: strict Sphinx keyword-only wake when cloud STT is unavailable.
    try:
        candidate_phrase = phrase
        if phrase == "hey mimi":
            candidate_phrase = "hey mimi"
        spotted = normalize_text(
            recognizer.recognize_sphinx(
                audio,
                keyword_entries=[(candidate_phrase, 1e-42)],
            )
        )
        if is_valid_candidate(spotted):
            return True, f"sphinx_kw:{spotted}"
        if spotted:
            return False, f"sphinx_kw:{spotted}"
    except Exception:
        pass

    return False, ""


def write_trace(trace_file, event, text=""):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts}\t{event}\t{text}".rstrip() + "\n"
    try:
        with open(trace_file, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def is_pid_running(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def acquire_single_instance_lock(lock_file, trace_file):
    path = Path(lock_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    current_pid = os.getpid()

    try:
        if path.exists():
            old = (path.read_text(encoding="utf-8") or "").strip()
            if old.isdigit():
                old_pid = int(old)
                if old_pid != current_pid and is_pid_running(old_pid):
                    write_trace(trace_file, "listener_duplicate_exit", f"existing_pid={old_pid}")
                    return False, None

        path.write_text(str(current_pid), encoding="utf-8")

        def _cleanup():
            try:
                if path.exists():
                    holder = (path.read_text(encoding="utf-8") or "").strip()
                    if holder == str(current_pid):
                        path.unlink()
            except Exception:
                pass

        atexit.register(_cleanup)
        return True, _cleanup
    except Exception:
        return True, None


def post_goal(endpoint, token, goal):
    payload = json.dumps({"token": token, "text": goal}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        _ = resp.read()


def show_notification(title, message):
    # macOS banner notification to indicate wake/capture state globally.
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display notification "{message}" with title "{title}"',
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def play_tone(sound_name):
    # Short system sounds provide immediate feedback similar to voice assistants.
    try:
        subprocess.run(
            ["afplay", f"/System/Library/Sounds/{sound_name}.aiff"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def speak_reply(text, rate=205, voice="Samantha"):
    try:
        subprocess.run(
            ["say", "-v", voice, "-r", str(rate), text],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phrase", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--cooldown-ms", type=int, default=1200)
    parser.add_argument("--command-window-sec", type=int, default=7)
    parser.add_argument("--silence-end-sec", type=int, default=5)
    parser.add_argument("--suppress-after-trigger-ms", type=int, default=700)
    parser.add_argument("--startup-guard-ms", type=int, default=1500)
    parser.add_argument("--wake-min-similarity", type=float, default=0.9)
    parser.add_argument("--max-phrase-repeat", type=int, default=1)
    parser.add_argument("--self-voice-guard-ms", type=int, default=900)
    parser.add_argument("--wake-min-rms", type=int, default=130)
    parser.add_argument("--command-min-rms", type=int, default=55)
    parser.add_argument("--max-energy-threshold", type=int, default=180)
    parser.add_argument("--speaker-min-rms", type=int, default=95)
    parser.add_argument("--allow-offline-wake-fallback", action="store_true", default=False)
    parser.add_argument("--allow-offline-command-fallback", action="store_true", default=False)
    parser.add_argument("--reply-voice", default="Samantha")
    parser.add_argument("--reply-rate", type=int, default=205)
    parser.add_argument("--reply-enabled", action="store_true", default=True)
    parser.add_argument(
        "--voice-profile",
        default=str(Path.home() / ".omnistate" / "voice_profile.json"),
    )
    parser.add_argument(
        "--trace-file",
        default=str(Path.home() / ".omnistate" / "wake.trace.log"),
    )
    parser.add_argument(
        "--pause-file",
        default=str(Path.home() / ".omnistate" / "wake.pause"),
    )
    parser.add_argument(
        "--lock-file",
        default=str(Path.home() / ".omnistate" / "wake_listener.lock"),
    )
    args = parser.parse_args()

    phrase = normalize_text(args.phrase)
    if len(phrase) < 3:
        print("[wake] wake phrase must be at least 3 chars", flush=True)
        sys.exit(2)

    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 120
    recognizer.dynamic_energy_threshold = True
    recognizer.dynamic_energy_adjustment_damping = 0.08
    recognizer.dynamic_energy_ratio = 1.3
    recognizer.pause_threshold = 0.6
    recognizer.non_speaking_duration = 0.45

    trace_file = args.trace_file
    Path(trace_file).parent.mkdir(parents=True, exist_ok=True)

    lock_ok, _ = acquire_single_instance_lock(args.lock_file, trace_file)
    if not lock_ok:
        print("[wake] another wake listener instance is already running; exiting", flush=True)
        return

    profile = load_voice_profile(args.voice_profile)
    wake_aliases = profile["wakeAliases"]
    command_corrections = profile["commandCorrections"]
    phrase_hints = profile["phraseHints"] if profile["phraseHints"] else [
        "youtube",
        "safari",
        "zalo",
        "spotify",
        "chrome",
    ]
    hint_aliases = profile["hintAliases"] if profile["hintAliases"] else {
        "you tube": "youtube",
        "u tube": "youtube",
        "du tup": "youtube",
        "du túp": "youtube",
        "gia lo": "zalo",
        "za lo": "zalo",
        "sa fa ri": "safari",
        "safa ri": "safari",
    }
    lang_list = profile["languages"]
    if not lang_list:
        lang_list = [profile["language"], "en-US", "vi-VN"]
    # Keep order while deduping.
    seen_lang = set()
    languages = []
    for lang in lang_list:
        if lang not in seen_lang:
            seen_lang.add(lang)
            languages.append(lang)

    wake_languages = profile["wakeLanguages"] if profile["wakeLanguages"] else ["vi-VN"]
    command_languages = profile["commandLanguages"] if profile["commandLanguages"] else languages

    print(f"[wake] listening phrase='{phrase}'", flush=True)
    print(f"[wake] trace file: {trace_file}", flush=True)
    show_notification("OmniState", f"Wake listener active: '{phrase}'")
    write_trace(trace_file, "listener_started", f"phrase={phrase}")

    last_trigger_ms = 0
    suppress_until_ms = 0
    self_voice_guard_until_ms = 0
    startup_guard_until_ms = int(time.time() * 1000) + args.startup_guard_ms
    paused = False

    while True:
        try:
            if Path(args.pause_file).exists():
                if not paused:
                    paused = True
                    print("[wake] paused by lock file", flush=True)
                    write_trace(trace_file, "listener_paused", args.pause_file)
                time.sleep(0.2)
                continue
            if paused:
                paused = False
                print("[wake] resumed after lock file removed", flush=True)
                write_trace(trace_file, "listener_resumed", args.pause_file)

            now_ms = int(time.time() * 1000)
            if now_ms < startup_guard_until_ms:
                time.sleep(0.08)
                continue
            if now_ms < suppress_until_ms:
                time.sleep(0.08)
                continue
            if now_ms < self_voice_guard_until_ms:
                time.sleep(0.08)
                continue

            with sr.Microphone(sample_rate=16000) as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.45)
                if recognizer.energy_threshold > args.max_energy_threshold:
                    recognizer.energy_threshold = args.max_energy_threshold
                recognizer.pause_threshold = 0.55
                recognizer.non_speaking_duration = 0.35
                audio = recognizer.listen(source, timeout=2, phrase_time_limit=4)

            triggered, heard_wake = detect_wake(
                recognizer,
                audio,
                phrase,
                wake_aliases,
                wake_languages,
                min_similarity=args.wake_min_similarity,
                max_phrase_repeat=args.max_phrase_repeat,
                allow_offline_wake_fallback=args.allow_offline_wake_fallback,
                wake_min_rms=max(50, args.wake_min_rms),
            )
            if not triggered:
                if heard_wake:
                    write_trace(trace_file, "wake_rejected", heard_wake)
                continue

            if profile["voiceLockEnabled"]:
                if not profile["speakerPrint"] and not profile["speakerProfiles"]:
                    write_trace(trace_file, "speaker_unconfigured", "voiceLockEnabled=true but speakerPrint empty")
                    time.sleep(0.2)
                    continue
                rms = audio_rms(audio)
                if rms < args.speaker_min_rms:
                    write_trace(trace_file, "speaker_skip_low_rms", f"rms={rms}")
                    continue
                authorized, score, matched_user, matched_threshold = verify_speaker(
                    audio,
                    profile["speakerProfiles"],
                    profile["speakerPrint"],
                    profile["speakerThreshold"],
                    profile["activeSpeakerId"],
                )
                if not authorized:
                    write_trace(
                        trace_file,
                        "speaker_rejected",
                        f"score={round(score, 4)};threshold={round(matched_threshold,4)};user={matched_user or 'none'};wake={heard_wake}",
                    )
                    continue
                write_trace(
                    trace_file,
                    "speaker_matched",
                    f"score={round(score,4)};threshold={round(matched_threshold,4)};user={matched_user or 'default'};backend={speaker_backend_name()}",
                )

            now_ms = int(time.time() * 1000)
            if now_ms - last_trigger_ms < args.cooldown_ms:
                continue
            last_trigger_ms = now_ms
            suppress_until_ms = now_ms + args.suppress_after_trigger_ms

            print("[wake] trigger detected", flush=True)
            if heard_wake:
                print(f"[wake] heard wake: {heard_wake}", flush=True)
            write_trace(trace_file, "trigger_detected", heard_wake)
            play_tone("Glass")
            show_notification("OmniState", "🎤 Dang nghe lenh...")

            command = ""
            command_engine = ""
            capture_sec = 0.0
            capture_chunks = 0
            command_error = ""
            try:
                with sr.Microphone(sample_rate=16000) as source:
                    recognizer.adjust_for_ambient_noise(source, duration=0.25)
                    if recognizer.energy_threshold > args.max_energy_threshold:
                        recognizer.energy_threshold = args.max_energy_threshold
                    # Command stage should tolerate brief pauses to avoid truncation.
                    recognizer.pause_threshold = 1.0
                    recognizer.non_speaking_duration = 0.65
                    command, command_engine, capture_sec, capture_chunks = capture_command_until_silence(
                        recognizer=recognizer,
                        source=source,
                        languages=command_languages,
                        corrections=command_corrections,
                        allow_offline_fallback=args.allow_offline_command_fallback,
                        silence_end_sec=max(2, args.silence_end_sec),
                        max_total_sec=max(20, args.command_window_sec),
                        command_min_rms=max(40, args.command_min_rms),
                        phrase_hints=phrase_hints,
                        hint_aliases=hint_aliases,
                    )
            except Exception as err:
                command = ""
                command_error = str(err)

            write_trace(
                trace_file,
                "command_capture",
                f"seconds={capture_sec};chunks={capture_chunks}",
            )
            if command_error:
                write_trace(trace_file, "command_error", command_error)

            if should_reject_command(command, command_engine):
                print("[wake] no command captured", flush=True)
                write_trace(trace_file, "command_empty", "")
                if is_low_confidence_media_command(command):
                    write_trace(trace_file, "command_rejected", "low_confidence_media")
                    show_notification("OmniState", "Lenh YouTube chua ro, vui long noi lai day du")
                    if args.reply_enabled:
                        speak_reply(
                            "Mình nghe chưa rõ từ khóa bài hát. Bạn nói lại đầy đủ giúp mình.",
                            rate=args.reply_rate,
                            voice=args.reply_voice,
                        )
                        self_voice_guard_until_ms = int(time.time() * 1000) + args.self_voice_guard_ms

                    follow_command, follow_engine, follow_sec, follow_chunks = capture_followup_media_command(
                        recognizer=recognizer,
                        languages=command_languages,
                        corrections=command_corrections,
                        allow_offline_fallback=args.allow_offline_command_fallback,
                        command_min_rms=max(40, args.command_min_rms),
                        phrase_hints=phrase_hints,
                        hint_aliases=hint_aliases,
                        attempts=2,
                    )
                    write_trace(
                        trace_file,
                        "command_followup_capture",
                        f"seconds={follow_sec};chunks={follow_chunks}",
                    )
                    if follow_command:
                        merged_follow = normalize_text(f"{command} {follow_command}")
                        recovered = choose_better_command_candidate(command, merged_follow, phrase_hints)
                        if not should_reject_command(recovered, follow_engine or command_engine):
                            command = recovered
                            command_engine = follow_engine or command_engine
                            write_trace(trace_file, "command_recovered", f"{command_engine}:{command}")
                        else:
                            write_trace(trace_file, "command_rejected", "followup_still_low_confidence")
                            continue
                    else:
                        write_trace(trace_file, "command_rejected", "followup_empty")
                        continue
                else:
                    # Do not notify on empty to avoid periodic spam and perceived auto-triggering.
                    continue

            print(f"[wake] heard command ({command_engine}): {command}", flush=True)
            write_trace(trace_file, "command_heard", f"{command_engine}:{command}")

            rewritten = rewrite_media_command(command)
            did_rewrite = rewritten != command
            if rewritten != command:
                write_trace(trace_file, "command_rewritten", rewritten)
                command = rewritten

            try:
                post_goal(args.endpoint, args.token, command)
                print(f"[wake] sent command: {command}", flush=True)
                write_trace(trace_file, "command_sent", command)
                play_tone("Pop")
                show_notification("OmniState", build_notify_text(command, did_rewrite))
                if args.reply_enabled:
                    speak_reply(build_reply_text(command, did_rewrite), rate=args.reply_rate, voice=args.reply_voice)
                    self_voice_guard_until_ms = int(time.time() * 1000) + args.self_voice_guard_ms
            except Exception as err:
                print(f"[wake] send failed: {err}", flush=True)
                write_trace(trace_file, "send_failed", str(err))
                play_tone("Basso")
                show_notification("OmniState", "Gui lenh that bai")
                if args.reply_enabled:
                    speak_reply("Sorry, I could not send that command.", rate=args.reply_rate, voice=args.reply_voice)
                    self_voice_guard_until_ms = int(time.time() * 1000) + args.self_voice_guard_ms

        except sr.WaitTimeoutError:
            continue
        except KeyboardInterrupt:
            print("[wake] stopped", flush=True)
            write_trace(trace_file, "listener_stopped", "keyboard_interrupt")
            return
        except Exception as err:
            print(f"[wake] loop error: {err}", flush=True)
            write_trace(trace_file, "loop_error", str(err))
            time.sleep(0.4)


if __name__ == "__main__":
    main()
