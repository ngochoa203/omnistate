#!/usr/bin/env python3
from difflib import SequenceMatcher
import atexit
import array
import json
import os
from pathlib import Path
import random
import re
import sys
import time

try:
    import speech_recognition as sr
except Exception as err:
    print(f"missing dependency speech_recognition: {err}")
    raise SystemExit(2)

import audioop


_speechbrain_encoder = None

WAKE_TRAINING_PHRASES = [
    "Hey Mimi, mở Safari rồi tìm giúp tôi tin tức công nghệ mới nhất trong tuần này nhé",
    "Hey Mimi, đặt báo thức bảy giờ sáng mai và nhắc tôi uống thuốc trước khi ăn",
    "Hey Mimi, hôm nay trời đẹp quá, bật danh sách nhạc thư giãn buổi sáng giúp tôi",
    "Hey Mimi, ghi chú lại cuộc họp lúc hai giờ chiều với khách hàng quan trọng ngày mai",
    "Hey Mimi, gọi điện cho mẹ rồi nhắn anh hai là tối nay mình về ăn cơm cùng cả nhà",
]


def normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def text_similarity(a: str, b: str) -> float:
    a_n = normalize(a)
    b_n = normalize(b)
    if not a_n or not b_n:
        return 0.0
    return SequenceMatcher(None, a_n, b_n).ratio()


def keyword_overlap(expected: str, heard: str) -> float:
    stop = {
        "mở", "ở", "trên", "và", "cho", "của", "tôi", "the", "a", "an", "to", "in", "on", "my"
    }
    e = [w for w in re.split(r"\s+", normalize(expected)) if w and w not in stop]
    h = set([w for w in re.split(r"\s+", normalize(heard)) if w and w not in stop])
    if not e:
        return 0.0
    hit = sum(1 for w in e if w in h)
    return hit / len(e)


def is_accepted_transcript(expected: str, heard: str, locale: str) -> bool:
    if not heard:
        return False

    expected_n = normalize(expected)
    heard_n = normalize(heard)

    # Wake keyword training: accept if "hey mimi" is present AND at least 3
    # trailing words from the expected phrase appear in the transcript.
    # (Google STT often mis-transcribes Vietnamese tones, so we allow loose match.)
    if expected_n.startswith("hey mimi"):
        if "hey mimi" not in heard_n and "mimi" not in heard_n:
            return False
        trailing = [w for w in expected_n.split() if w not in ("hey", "mimi")]
        heard_words_set = set(re.split(r"\s+", heard_n))
        hit = sum(1 for w in trailing if w in heard_words_set)
        return hit >= min(3, len(trailing))

    # Critical platform/app tokens must be preserved.
    critical_tokens = {"youtube", "safari", "zalo", "spotify", "chrome"}
    required_critical = [t for t in critical_tokens if t in expected_n]
    if required_critical and not all(t in heard_n for t in required_critical):
        return False

    sim = text_similarity(expected, heard)
    overlap = keyword_overlap(expected, heard)

    # Anchor token: require the last meaningful token to appear in transcript.
    stop = {
        "mở", "ở", "trên", "và", "cho", "của", "tôi", "the", "a", "an", "to", "in", "on", "my"
    }
    expected_words = [w for w in re.split(r"\s+", expected_n) if w and w not in stop]
    heard_words_list = [w for w in re.split(r"\s+", heard_n) if w and w not in stop]
    heard_words = set(heard_words_list)
    anchor_ok = True
    if expected_words:
        anchor_ok = expected_words[-1] in heard_words

    if not anchor_ok:
        return False

    # For Vietnamese, keep the last 2-keyword phrase strict to avoid near-homophone drift
    # such as "ý tưởng" -> "lý tưởng" being accepted.
    if locale != "en" and len(expected_words) >= 2:
        expected_tail = " ".join(expected_words[-2:])
        heard_joined = " ".join(heard_words_list)
        if expected_tail not in heard_joined:
            return False

    overlap = keyword_overlap(expected, heard)
    # Token coverage gate: short commands need higher keyword precision.
    if len(expected_words) <= 4:
        min_overlap = 0.86 if locale != "en" else 0.8
    else:
        min_overlap = 0.76 if locale != "en" else 0.72
    if overlap < min_overlap:
        return False

    if locale == "en":
        return sim >= 0.68 or overlap >= 0.8
    return sim >= 0.7 or overlap >= 0.86


def estimate_capture_config(expected: str):
    # Adapt capture budget by phrase length so long phrases are not cut early.
    words = [w for w in re.split(r"\s+", normalize(expected)) if w]
    n = max(1, len(words))

    timeout = min(35, max(10, int(8 + n * 0.8)))
    phrase_time_limit = min(36, max(10, int(8 + n * 1.5)))
    silence_end_sec = min(3.4, max(1.8, 1.6 + n * 0.07))
    return timeout, phrase_time_limit, silence_end_sec


def looks_truncated(expected: str, heard: str) -> bool:
    e = normalize(expected)
    h = normalize(heard)
    if not e or not h:
        return False

    e_words = [w for w in e.split(" ") if w]
    h_words = [w for w in h.split(" ") if w]
    if not e_words or not h_words:
        return False

    # Common truncation shape: heard is shorter and resembles the phrase prefix.
    if len(h_words) < len(e_words):
        prefix = " ".join(e_words[: len(h_words)])
        if text_similarity(prefix, h) >= 0.78:
            return True

    # Last meaningful token is missing.
    stop = {"mở", "ở", "trên", "và", "cho", "của", "tôi", "the", "a", "an", "to", "in", "on", "my"}
    e_core = [w for w in e_words if w not in stop]
    if e_core and e_core[-1] not in set(h_words):
        return True

    return False


def amplify_audio_if_needed(audio, target_rms=500, max_gain=10.0):
    try:
        raw = audio.get_raw_data()
        width = audio.sample_width
        rate = audio.sample_rate
        rms = audioop.rms(raw, width)
        if rms <= 0:
            return audio, 1.0
        gain = min(max_gain, max(1.0, float(target_rms) / float(rms)))
        if gain <= 1.03:
            return audio, 1.0
        boosted_raw = audioop.mul(raw, width, gain)
        boosted = sr.AudioData(boosted_raw, rate, width)
        return boosted, gain
    except Exception:
        return audio, 1.0


def record_once(recognizer, expected_text, timeout=None, phrase_time_limit=None, silence_end_sec=None):
    if timeout is None or phrase_time_limit is None or silence_end_sec is None:
        timeout, phrase_time_limit, silence_end_sec = estimate_capture_config(expected_text)

    with sr.Microphone(sample_rate=16000) as source:
        print(
            f"    [mic] armed: waiting voice start (timeout={timeout}s, max_phrase={phrase_time_limit}s)"
        )
        recognizer.adjust_for_ambient_noise(source, duration=0.2)
        # Long-phrase mode: tolerate short pauses inside a sentence.
        recognizer.pause_threshold = 1.25
        recognizer.non_speaking_duration = 0.9

        # First chunk: wait until user starts speaking.
        first = recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
        chunks = [first]

        # Keep collecting follow-up chunks until a clear silence gap.
        while True:
            try:
                nxt = recognizer.listen(
                    source,
                    timeout=silence_end_sec,
                    phrase_time_limit=phrase_time_limit,
                )
                chunks.append(nxt)
            except sr.WaitTimeoutError:
                break

        raw = b"".join(c.get_raw_data() for c in chunks)
        audio = sr.AudioData(raw, first.sample_rate, first.sample_width)
        print(f"    [mic] captured, transcribing... (chunks={len(chunks)})")
    return audio


def transcribe_google(recognizer, audio, languages):
    for lang in languages:
        try:
            txt = recognizer.recognize_google(audio, language=lang).strip()
            if txt:
                return normalize(txt), lang
        except Exception:
            continue
    return "", ""


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
        from speechbrain.inference.speaker import EncoderClassifier
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
        norm = sum(x * x for x in vec) ** 0.5
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
        raw = audio.get_raw_data()
    if not raw:
        return []

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
        vec.append(float(audioop.rms(raw[start:end], width)))

    zcr = float(audioop.cross(raw, width)) / max(1.0, float(total))
    avg_rms = sum(vec) / max(1.0, float(len(vec)))
    vec.append(zcr)
    vec.append(avg_rms)

    norm = sum(x * x for x in vec) ** 0.5
    if norm <= 1e-9:
        return []
    return [x / norm for x in vec]


def average_signature(signatures):
    if not signatures:
        return []
    n = min(len(s) for s in signatures if s)
    if n <= 0:
        return []
    out = [0.0] * n
    count = 0
    for sig in signatures:
        if len(sig) < n:
            continue
        count += 1
        for i in range(n):
            out[i] += sig[i]
    if count == 0:
        return []
    out = [v / count for v in out]
    norm = sum(x * x for x in out) ** 0.5
    if norm <= 1e-9:
        return []
    return [x / norm for x in out]


def cosine_similarity(a, b):
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    return sum(a[i] * b[i] for i in range(n))


def suggest_speaker_threshold(signatures):
    # Derive a robust threshold from enrollment consistency.
    backend = speaker_backend_name()
    if not signatures:
        return 0.85 if backend == "speechbrain" else 0.72
    centroid = average_signature(signatures)
    if not centroid:
        return 0.85 if backend == "speechbrain" else 0.72
    scores = [cosine_similarity(s, centroid) for s in signatures if s]
    if not scores:
        return 0.85 if backend == "speechbrain" else 0.72
    scores = sorted(scores)
    # Use lower quantile minus a small safety margin for real-world noise.
    idx = max(0, int((len(scores) - 1) * 0.25))
    base = scores[idx] - 0.03
    if backend == "speechbrain":
        return round(max(0.8, min(0.95, base)), 4)
    return round(max(0.58, min(0.86, base)), 4)


def train_phrase(recognizer, expected, repeats, languages, locale):
    expected_n = normalize(expected)
    heard_list = []
    accepted = 0
    attempts = 0
    print(f"\nTraining phrase: '{expected_n}'")
    while accepted < repeats:
        attempts += 1
        cmd = input(f"  [{accepted+1}/{repeats}] Enter=start, s=skip phrase, q=quit > ").strip().lower()
        if cmd == "q":
            raise KeyboardInterrupt
        if cmd == "s":
            print("    skipped this phrase by user")
            break
        print(f"  [{accepted+1}/{repeats}] Speak now... (attempt {attempts})")
        try:
            audio = record_once(recognizer, expected_n)
            heard, lang = transcribe_google(recognizer, audio, languages)

            # If transcript looks cut, retry STT once on boosted audio before rejecting.
            if heard and looks_truncated(expected_n, heard):
                boosted, gain = amplify_audio_if_needed(audio)
                if gain > 1.03:
                    retry_heard, retry_lang = transcribe_google(recognizer, boosted, languages)
                    if retry_heard and text_similarity(expected_n, retry_heard) > text_similarity(expected_n, heard):
                        heard = retry_heard
                        lang = retry_lang or lang

            print(f"    heard({lang or 'none'}): {heard or '<empty>'}")
            if heard:
                heard_list.append(heard)
            if is_accepted_transcript(expected_n, heard, locale):
                accepted += 1
            else:
                print("    retry: transcript not close enough, please read again")
        except Exception as err:
            print(f"    error: {err}")
            print("    retry: please read again")
        time.sleep(0.2)

    return expected_n, heard_list


def build_corrections(training_pairs):
    corrections = {}
    for expected, heard_list in training_pairs:
        for heard in heard_list:
            if heard != expected:
                corrections[heard] = expected
    return corrections


def default_training_phrases(locale):
    curated_vi = [
        "chào trợ lý ảo, bạn có ở đó không",
        "tắt toàn bộ đèn trong phòng khách",
        "đặt báo thức vào lúc bảy giờ sáng mai",
        "bật danh sách nhạc thư giãn của tôi",
        "thời tiết hôm nay ở đây thế nào",
        "chỉ đường đến quán cà phê gần nhất",
        "đọc các tin tức nổi bật trong ngày hôm nay",
        "nhắc tôi gọi điện cho mẹ vào chiều nay",
        "dịch câu này sang tiếng anh giúp tôi",
        "bạn có thể kể cho tôi nghe một câu chuyện vui không",
    ]

    vi_templates = [
        "mở ứng dụng {app}",
        "đóng ứng dụng {app}",
        "tìm thông tin về {topic}",
        "tìm kiếm {topic} trên web",
        "mở tài liệu {doc}",
        "tạo ghi chú về {topic}",
        "đặt lời nhắc về {topic}",
        "liệt kê các việc cần làm hôm nay",
        "mở trang web {site}",
        "phát nhạc chủ đề {topic}",
        "mở cài đặt hệ thống",
        "kiểm tra thời tiết tại {place}",
    ]
    en_templates = [
        "open the {app} app",
        "close the {app} app",
        "search information about {topic}",
        "search the web for {topic}",
        "open my {doc} document",
        "create a note about {topic}",
        "set a reminder about {topic}",
        "list my tasks for today",
        "open the website {site}",
        "play music about {topic}",
        "open system settings",
        "check weather in {place}",
    ]
    apps = ["ghi chú", "lịch", "máy tính", "thư", "trình duyệt"]
    sites = ["wikipedia", "github", "google", "stackoverflow", "news"]
    topics = ["năng suất", "thiết kế", "lập trình", "sức khỏe", "du lịch", "tài chính", "học tiếng anh"]
    docs = ["công việc", "kế hoạch", "ý tưởng", "nhật ký", "học tập", "dự án"]
    places = ["hà nội", "đà nẵng", "hồ chí minh", "tokyo", "singapore"]

    apps_en = ["notes", "calendar", "calculator", "mail", "browser"]
    sites_en = ["wikipedia", "github", "google", "stackoverflow", "news"]
    topics_en = ["productivity", "design", "programming", "health", "travel", "finance", "english learning"]
    docs_en = ["work", "plan", "ideas", "journal", "study", "project"]
    places_en = ["hanoi", "da nang", "ho chi minh city", "tokyo", "singapore"]

    def render(templates, app_pool, site_pool, topic_pool, doc_pool, place_pool, n=8):
        out = []
        for _ in range(n):
            tpl = random.choice(templates)
            out.append(
                tpl.format(
                    app=random.choice(app_pool),
                    site=random.choice(site_pool),
                    topic=random.choice(topic_pool),
                    doc=random.choice(doc_pool),
                    place=random.choice(place_pool),
                )
            )
        return out

    def merge_unique(primary, secondary):
        out = []
        seen = set()
        for p in primary + secondary:
            pn = normalize(p)
            if not pn or pn in seen:
                continue
            seen.add(pn)
            out.append(p)
        return out

    if locale == "mixed":
        vi_generated = render(vi_templates, apps, sites, topics, docs, places, n=8)
        en_generated = render(en_templates, apps_en, sites_en, topics_en, docs_en, places_en, n=8)
        return merge_unique(curated_vi, vi_generated) + en_generated
    if locale == "en":
        return render(en_templates, apps_en, sites_en, topics_en, docs_en, places_en, n=8)
    vi_generated = render(vi_templates, apps, sites, topics, docs, places, n=10)
    return merge_unique(curated_vi, vi_generated)


def default_speaker_phrases(locale):
    if locale == "en":
        return [
            "this is my voice",
            "my voice is authorized for this device",
            "assistant please recognize my voice profile",
            "i am the owner of this computer",
            "confirm this voice is mine",
            "wake assistant and listen to me",
            "my voice is clear and stable",
            "only my voice can unlock this assistant",
            "verify my voice signature now",
            "please lock this assistant to my voice",
        ]
    if locale == "mixed":
        return [
            "đây là giọng của tôi",
            "this is my voice",
            "chỉ giọng tôi được phép kích hoạt trợ lý",
            "only my voice can unlock this assistant",
            "xác minh giọng nói của tôi",
            "verify my voice signature now",
            "tôi là chủ sở hữu thiết bị này",
            "i am the owner of this computer",
            "hãy nhận diện đúng giọng của tôi",
            "please recognize my voice profile",
        ]
    return [
        "đây là giọng của tôi",
        "chỉ giọng tôi được phép kích hoạt trợ lý",
        "xác minh giọng nói của tôi",
        "tôi là chủ sở hữu thiết bị này",
        "hãy nhận diện đúng giọng của tôi",
        "khóa trợ lý bằng giọng nói của tôi",
        "giọng nói này thuộc về tôi",
        "vui lòng ghi nhớ giọng nói của tôi",
        "chỉ nhận lệnh khi tôi nói",
        "xác thực giọng nói của tôi ngay bây giờ",
    ]


def arrow_select(title, options, default_index=0):
    index = max(0, min(default_index, len(options) - 1))
    tty_in = None
    tty_out = None
    old = None
    fd = None
    try:
        tty_in = open("/dev/tty", "rb", buffering=0)
        tty_out = open("/dev/tty", "w", buffering=1)
        fd = tty_in.fileno()
        import termios
        import tty
        old = termios.tcgetattr(fd)
        tty.setraw(fd)

        def render():
            tty_out.write("\033[2J\033[H")
            tty_out.write("=== OmniState Voice Profile Trainer ===\r\n")
            tty_out.write(f"{title}\r\n")
            tty_out.write("Use Up/Down arrows, Enter to confirm. (j/k also works)\r\n\r\n")
            for i, opt in enumerate(options):
                mark = "❯" if i == index else " "
                tty_out.write(f" {mark} {opt}\r\n")
            tty_out.flush()

        render()
        while True:
            c1 = os.read(fd, 1)
            if c1 in (b"\r", b"\n"):
                break
            if c1 == b"\x03":
                raise KeyboardInterrupt
            if c1 == b"\x1b":
                c2 = os.read(fd, 1)
                if c2 == b"[":
                    c3 = os.read(fd, 1)
                    if c3 == b"A":
                        index = (index - 1) % len(options)
                        render()
                        continue
                    if c3 == b"B":
                        index = (index + 1) % len(options)
                        render()
                        continue
                # Esc cancels selection change.
                break
            if c1 in (b"k", b"K"):
                index = (index - 1) % len(options)
                render()
                continue
            if c1 in (b"j", b"J"):
                index = (index + 1) % len(options)
                render()
                continue
        return options[index], index
    except Exception:
        # Safe fallback for terminals that cannot read /dev/tty.
        print(f"\n{title}")
        for i, opt in enumerate(options, start=1):
            print(f"  {i}. {opt}")
        try:
            raw = input(f"Select [1-{len(options)}] (default {index+1}): ").strip()
            if raw:
                picked = int(raw)
                if 1 <= picked <= len(options):
                    index = picked - 1
        except Exception:
            pass
        return options[index], index
    finally:
        try:
            if fd is not None and old is not None:
                import termios
                termios.tcsetattr(fd, termios.TCSADRAIN, old)
        except Exception:
            pass
        try:
            if tty_out:
                tty_out.write("\033[2J\033[H")
                tty_out.flush()
        except Exception:
            pass
        try:
            if tty_in:
                tty_in.close()
        except Exception:
            pass
        try:
            if tty_out:
                tty_out.close()
        except Exception:
            pass


def choose_languages_by_locale(locale):
    lang_options = {
        "vi": ["vi-VN", "en-US"],
        "en": ["en-US", "vi-VN"],
        "mixed": ["vi-VN", "en-US"],
    }
    return lang_options.get(locale, ["vi-VN", "en-US"])


def load_existing_profile(profile_path: Path):
    try:
        with open(profile_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def upsert_speaker_profile(existing_profile, user_id, display_name, speaker_print, speaker_threshold):
    profiles = existing_profile.get("speakerProfiles")
    if not isinstance(profiles, list):
        profiles = []

    normalized = []
    replaced = False
    for p in profiles:
        if not isinstance(p, dict):
            continue
        pid = p.get("userId")
        if not isinstance(pid, str) or not pid.strip():
            continue
        current = {
            "userId": pid.strip(),
            "displayName": p.get("displayName") if isinstance(p.get("displayName"), str) else pid.strip(),
            "speakerPrint": p.get("speakerPrint") if isinstance(p.get("speakerPrint"), list) else [],
            "speakerThreshold": float(p.get("speakerThreshold", speaker_threshold)),
            "enabled": bool(p.get("enabled", True)),
        }
        if current["userId"] == user_id:
            current["displayName"] = display_name
            current["speakerPrint"] = speaker_print
            current["speakerThreshold"] = float(speaker_threshold)
            current["enabled"] = True
            replaced = True
        normalized.append(current)

    if not replaced:
        normalized.append(
            {
                "userId": user_id,
                "displayName": display_name,
                "speakerPrint": speaker_print,
                "speakerThreshold": float(speaker_threshold),
                "enabled": True,
            }
        )

    return normalized


def main():
    profile_path = Path.home() / ".omnistate" / "voice_profile.json"
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    pause_path = Path.home() / ".omnistate" / "wake.pause"
    existing_profile = load_existing_profile(profile_path)

    # Pause always-on wake listener while training to avoid microphone contention.
    pause_path.write_text("trainer_active\n", encoding="utf-8")

    def _resume_wake_listener():
        try:
            if pause_path.exists():
                pause_path.unlink()
        except Exception:
            pass

    atexit.register(_resume_wake_listener)

    print("=== OmniState Voice Profile Trainer ===")
    print(f"[trainer] wake listener paused: {pause_path}")

    speaker_user_id = normalize(input("Speaker profile id [owner]: ").strip() or "owner")
    if not speaker_user_id:
        speaker_user_id = "owner"
    speaker_display_name = input("Speaker display name [Owner]: ").strip() or "Owner"

    mode_options = [
        "full - full phrase + speaker training",
        "speaker-only - enroll your voice lock only",
    ]
    _, mode_idx = arrow_select("Select training mode", mode_options, default_index=0)
    speaker_only = mode_idx == 1

    locale_options = [
        "vi - Vietnamese",
        "en - English",
        "mixed - Bilingual",
    ]
    locale_selected, locale_idx = arrow_select("Select training language", locale_options, default_index=0)
    locale = ["vi", "en", "mixed"][locale_idx]

    wake_options = [
        "mimi",
        "hey mimi",
    ]
    if locale == "en":
        wake_default = 1
    else:
        wake_default = 0
    wake_phrase, _ = arrow_select("Select wake phrase", wake_options, default_index=wake_default)

    # For the actual training loop we always use the 5 fixed Vietnamese sentences
    # regardless of what was selected above (or any --wake-samples flag).
    wake_training_phrases = WAKE_TRAINING_PHRASES

    repeat_options = ["3", "4", "5", "6", "8"]
    repeat_selected, _ = arrow_select("Select repeats per phrase", repeat_options, default_index=2)
    repeats = int(repeat_selected)

    phrase_count = 0
    if not speaker_only:
        phrase_count_options = ["6", "8", "10", "12", "16"]
        phrase_count_selected, _ = arrow_select("Select auto phrase count", phrase_count_options, default_index=2)
        phrase_count = int(phrase_count_selected)

    languages = choose_languages_by_locale(locale)
    phrases = default_training_phrases(locale)[:phrase_count] if not speaker_only else []
    if not speaker_only:
        print("\nGenerated training phrases:")
        for p in phrases:
            print(f"  - {p}")

    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 220
    recognizer.dynamic_energy_threshold = True
    recognizer.dynamic_energy_adjustment_damping = 0.12
    recognizer.dynamic_energy_ratio = 1.6
    recognizer.pause_threshold = 1.1
    recognizer.non_speaking_duration = 0.8

    pairs = []
    speaker_signatures = []
    interrupted = False
    if not speaker_only:
        try:
            print(f"\n=== Wake-word training: {len(wake_training_phrases)} phrases (1 sample each) ===")
            for idx, wp in enumerate(wake_training_phrases):
                print(f"\n  Phrase {idx+1}/{len(wake_training_phrases)}: \"{wp}\"")
                expected, heard_list = train_phrase(recognizer, wp, 1, languages, locale)
                pairs.append((expected, heard_list))
            for phrase in phrases:
                expected, heard_list = train_phrase(recognizer, phrase, repeats, languages, locale)
                pairs.append((expected, heard_list))
        except KeyboardInterrupt:
            interrupted = True
            print("\nInterrupted by user. Saving collected data so far...")

    if not interrupted:
        if speaker_only:
            sample_options = ["10", "15", "20", "30"]
            sample_selected, _ = arrow_select("Select speaker-only sample count", sample_options, default_index=2)
            speaker_samples = int(sample_selected)
        else:
            speaker_samples = max(4, repeats + 1)

        speaker_phrase_pool = default_speaker_phrases(locale)
        for i in range(speaker_samples):
            phrase_prompt = speaker_phrase_pool[i % len(speaker_phrase_pool)]
            print(f"  phrase[{i+1}/{speaker_samples}]: {phrase_prompt}")
            print(f"  [voice {i+1}/{speaker_samples}] Enter=start, s=skip, q=quit > ", end="")
            action = input().strip().lower()
            if action == "q":
                break
            if action == "s":
                continue
            try:
                audio = record_once(recognizer, phrase_prompt, timeout=10, phrase_time_limit=7, silence_end_sec=2.0)
                sig = extract_voice_signature(audio)
                if sig:
                    speaker_signatures.append(sig)
            except Exception as err:
                print(f"    error: {err}")
            time.sleep(0.2)

    speaker_print = average_signature(speaker_signatures)
    speaker_threshold = suggest_speaker_threshold(speaker_signatures)

    corrections = build_corrections(pairs)

    speaker_profiles = existing_profile.get("speakerProfiles", [])
    if speaker_print:
        speaker_profiles = upsert_speaker_profile(
            existing_profile,
            speaker_user_id,
            speaker_display_name,
            speaker_print,
            speaker_threshold,
        )

    profile = {
        "language": languages[0] if languages else existing_profile.get("language", "vi-VN"),
        "languages": languages if languages else existing_profile.get("languages", ["vi-VN", "en-US"]),
        "wakeLanguages": existing_profile.get("wakeLanguages", ["vi-VN"]),
        "commandLanguages": languages if languages else existing_profile.get("commandLanguages", ["vi-VN", "en-US"]),
        "wakeAliases": existing_profile.get("wakeAliases", ["hey mimi", "mimi"]),
        "phraseHints": existing_profile.get("phraseHints", ["youtube", "safari", "zalo", "spotify", "chrome"]),
        "hintAliases": existing_profile.get(
            "hintAliases",
            {
                "you tube": "youtube",
                "u tube": "youtube",
                "za lo": "zalo",
                "gia lo": "zalo",
                "sa fa ri": "safari",
            },
        ),
        "commandCorrections": corrections if not speaker_only else existing_profile.get("commandCorrections", {}),
        "voiceLockEnabled": True if (speaker_print or speaker_profiles) else existing_profile.get("voiceLockEnabled", False),
        "speakerPrint": speaker_print if speaker_print else existing_profile.get("speakerPrint", []),
        "speakerThreshold": speaker_threshold if speaker_print else existing_profile.get("speakerThreshold", 0.72),
        "speakerProfiles": speaker_profiles,
        "activeSpeakerId": "all" if speaker_profiles else speaker_user_id,
        "speakerBackend": speaker_backend_name(),
    }

    try:
        with open(profile_path, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)

        print("\nSaved profile to:", profile_path)
        print("Corrections:")
        if corrections:
            for k, v in sorted(corrections.items()):
                print(f"  {k} -> {v}")
        else:
            print("  (none)")
        if speaker_print:
            print(f"Speaker threshold(auto): {speaker_threshold}")
            print(f"Speaker profile: {speaker_user_id} ({speaker_display_name})")
            print(f"Speaker backend: {speaker_backend_name()}")
    finally:
        try:
            if pause_path.exists():
                pause_path.unlink()
                print(f"[trainer] wake listener resumed: {pause_path}")
        except Exception:
            pass


if __name__ == "__main__":
    main()
