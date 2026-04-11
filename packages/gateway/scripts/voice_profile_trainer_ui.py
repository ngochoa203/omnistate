#!/usr/bin/env python3
import audioop
from difflib import SequenceMatcher
import json
from pathlib import Path
import random
import re
import socket

try:
    import gradio as gr
except Exception as err:
    print(f"missing dependency gradio: {err}")
    print("install: python3 -m pip install --user gradio")
    raise SystemExit(2)

try:
    import speech_recognition as sr
except Exception as err:
    print(f"missing dependency speech_recognition: {err}")
    raise SystemExit(2)


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


def accepted(expected: str, heard: str, locale: str) -> bool:
    if not heard:
        return False
    sim = text_similarity(expected, heard)
    overlap = keyword_overlap(expected, heard)
    if locale == "en":
        return sim >= 0.58 or overlap >= 0.6
    return sim >= 0.52 or overlap >= 0.55


def transcribe_file(audio_path: str, languages: list[str]) -> tuple[str, str]:
    if not audio_path:
        return "", ""
    recognizer = sr.Recognizer()
    with sr.AudioFile(audio_path) as source:
        audio = recognizer.record(source)
    for lang in languages:
        try:
            txt = recognizer.recognize_google(audio, language=lang).strip()
            if txt:
                return normalize(txt), lang
        except Exception:
            continue
    return "", ""


def extract_voice_signature_from_file(audio_path: str, bins: int = 32) -> list[float]:
    if not audio_path:
        return []
    recognizer = sr.Recognizer()
    with sr.AudioFile(audio_path) as source:
        audio = recognizer.record(source)
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


def average_signature(signatures: list[list[float]]) -> list[float]:
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


def build_corrections(training_pairs: list[tuple[str, list[str]]]) -> dict[str, str]:
    corrections = {}
    for expected, heard_list in training_pairs:
        for heard in heard_list:
            if heard and heard != expected:
                corrections[heard] = expected
    return corrections


def default_training_phrases(locale: str, n: int) -> list[str]:
    vi_templates = [
        "mở ứng dụng {app}",
        "tìm video {topic} trên youtube",
        "mở {site} ở safari",
        "tìm thông tin về {topic}",
        "mở tài liệu {doc} của tôi",
        "phát nhạc về {topic} trên youtube",
    ]
    en_templates = [
        "open the {app} app",
        "search videos about {topic} on youtube",
        "open {site} in safari",
        "find information about {topic}",
        "open my {doc} document",
        "play music about {topic} on youtube",
    ]

    pools = {
        "vi": {
            "app": ["ghi chú", "lịch", "máy tính", "mail", "zalo"],
            "site": ["youtube", "wikipedia", "github", "google", "spotify"],
            "topic": ["năng suất", "thiết kế", "lập trình", "sức khỏe", "du lịch"],
            "doc": ["công việc", "kế hoạch", "ý tưởng", "học tập", "nhật ký"],
            "templates": vi_templates,
        },
        "en": {
            "app": ["notes", "calendar", "calculator", "mail", "messages"],
            "site": ["youtube", "wikipedia", "github", "google", "spotify"],
            "topic": ["productivity", "design", "programming", "health", "travel"],
            "doc": ["work", "plan", "ideas", "study", "journal"],
            "templates": en_templates,
        },
    }

    def render(spec, count):
        out = []
        for _ in range(count):
            tpl = random.choice(spec["templates"])
            out.append(
                tpl.format(
                    app=random.choice(spec["app"]),
                    site=random.choice(spec["site"]),
                    topic=random.choice(spec["topic"]),
                    doc=random.choice(spec["doc"]),
                )
            )
        return out

    if locale == "mixed":
        n_vi = max(3, n // 2)
        n_en = max(3, n - n_vi)
        return render(pools["vi"], n_vi) + render(pools["en"], n_en)
    if locale == "en":
        return render(pools["en"], n)
    return render(pools["vi"], n)


def locale_config(locale: str) -> tuple[str, list[str], str]:
    if locale == "en":
        return "hey mimi", ["en-US", "vi-VN"], "this is my voice"
    if locale == "mixed":
        return "mimi", ["vi-VN", "en-US"], "đây là giọng của tôi this is my voice"
    return "mimi", ["vi-VN", "en-US"], "đây là giọng của tôi"


def session_init(locale: str, repeats: int, phrase_count: int):
    wake_phrase, languages, speaker_phrase = locale_config(locale)
    phrases = default_training_phrases(locale, phrase_count)
    all_phrases = [wake_phrase] + phrases
    state = {
        "locale": locale,
        "languages": languages,
        "wake_phrase": wake_phrase,
        "speaker_phrase": speaker_phrase,
        "repeats": int(repeats),
        "all_phrases": all_phrases,
        "index": 0,
        "accepted": 0,
        "heard_current": [],
        "pairs": [],
        "speaker_sigs": [],
        "speaker_target": max(3, int(repeats)),
        "stage": "phrases",
        "done": False,
    }
    return state


def current_prompt(state):
    if not state:
        return "Bấm 'Tạo Session' để bắt đầu."
    if state.get("done"):
        return "Hoàn tất. Bấm 'Lưu Profile'."
    if state["stage"] == "speaker":
        return f"Speaker lock phrase: {state['speaker_phrase']} ({len(state['speaker_sigs'])}/{state['speaker_target']})"
    phrase = state["all_phrases"][state["index"]]
    return f"Câu hiện tại: {phrase} ({state['accepted']}/{state['repeats']})"


def process_audio(audio_path, state):
    if not state:
        return "Chưa có session", current_prompt(state), state
    if state.get("done"):
        return "Session đã hoàn tất, hãy lưu profile.", current_prompt(state), state
    if not audio_path:
        return "Chưa có audio, hãy ghi âm rồi gửi.", current_prompt(state), state

    if state["stage"] == "speaker":
        sig = extract_voice_signature_from_file(audio_path)
        if not sig:
            return "Không đọc được giọng, hãy đọc lại speaker phrase.", current_prompt(state), state
        state["speaker_sigs"].append(sig)
        if len(state["speaker_sigs"]) >= state["speaker_target"]:
            state["done"] = True
            return "Đã đủ mẫu speaker lock. Bấm 'Lưu Profile'.", current_prompt(state), state
        return "Đã nhận mẫu speaker. Đọc lại lần nữa.", current_prompt(state), state

    expected = normalize(state["all_phrases"][state["index"]])
    heard, lang = transcribe_file(audio_path, state["languages"])
    if heard:
        state["heard_current"].append(heard)

    if not heard:
        return "Nhận diện rỗng, vui lòng đọc lại (không tính lượt).", current_prompt(state), state

    if not accepted(expected, heard, state["locale"]):
        return f"Sai lệch: '{heard}' (lang={lang or 'none'}). Đọc lại để lấy đúng data.", current_prompt(state), state

    state["accepted"] += 1
    if state["accepted"] < state["repeats"]:
        return f"OK ({state['accepted']}/{state['repeats']}) - đọc lại cùng câu.", current_prompt(state), state

    # phrase done
    state["pairs"].append((expected, list(state["heard_current"])))
    state["heard_current"] = []
    state["accepted"] = 0
    state["index"] += 1

    if state["index"] >= len(state["all_phrases"]):
        state["stage"] = "speaker"
        return "Hoàn tất train câu lệnh. Bắt đầu speaker lock.", current_prompt(state), state

    return "Chuyển sang câu tiếp theo.", current_prompt(state), state


def save_profile(state):
    if not state:
        return "Không có session để lưu."

    profile_path = Path.home() / ".omnistate" / "voice_profile.json"
    profile_path.parent.mkdir(parents=True, exist_ok=True)

    corrections = build_corrections(state.get("pairs", []))
    speaker_print = average_signature(state.get("speaker_sigs", []))

    profile = {
        "language": state["languages"][0] if state.get("languages") else "vi-VN",
        "languages": state.get("languages", ["vi-VN", "en-US"]),
        "wakeLanguages": ["vi-VN"],
        "commandLanguages": state.get("languages", ["vi-VN", "en-US"]),
        "wakeAliases": [normalize(state.get("wake_phrase", "mimi")), "mimi"],
        "phraseHints": ["youtube", "safari", "zalo", "spotify", "chrome"],
        "hintAliases": {
            "you tube": "youtube",
            "u tube": "youtube",
            "du túp": "youtube",
            "du tup": "youtube",
            "za lo": "zalo",
            "gia lo": "zalo",
            "sa fa ri": "safari",
            "safa ri": "safari",
        },
        "commandCorrections": corrections,
        "voiceLockEnabled": True if speaker_print else False,
        "speakerPrint": speaker_print,
        "speakerThreshold": 0.79,
    }

    with open(profile_path, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)

    return f"Đã lưu profile: {profile_path} | corrections={len(corrections)} | voiceLock={'on' if profile['voiceLockEnabled'] else 'off'}"


def build_ui():
    css = """
    .app-shell {max-width: 980px; margin: 0 auto;}
    .hero {padding: 14px 18px; border-radius: 14px; background: linear-gradient(135deg,#0ea5e9,#22c55e); color: white;}
    .hero h1 {margin: 0; font-size: 26px;}
    .hero p {margin: 6px 0 0; opacity: .95;}
    """

    with gr.Blocks(css=css, title="OmniState Voice Trainer") as demo:
        gr.Markdown(
            """
<div class='app-shell'>
  <div class='hero'>
    <h1>OmniState Voice Trainer</h1>
    <p>Chọn chế độ, bấm ghi âm, đọc sai thì hệ thống yêu cầu đọc lại ngay để lấy data sạch.</p>
  </div>
</div>
            """
        )

        with gr.Row():
            locale = gr.Dropdown(choices=["vi", "en", "mixed"], value="vi", label="Ngôn ngữ train")
            repeats = gr.Slider(2, 8, value=4, step=1, label="Số lần đúng / mỗi câu")
            phrase_count = gr.Slider(4, 16, value=8, step=1, label="Số câu tự sinh")

        start_btn = gr.Button("Tạo Session", variant="primary")
        prompt = gr.Markdown("Bấm 'Tạo Session' để bắt đầu.")
        status = gr.Textbox(label="Trạng thái", interactive=False)

        audio = gr.Audio(sources=["microphone"], type="filepath", label="Ghi âm")
        submit_btn = gr.Button("Phân tích bản ghi", variant="secondary")

        save_btn = gr.Button("Lưu Profile", variant="primary")
        save_status = gr.Textbox(label="Lưu Profile", interactive=False)

        state = gr.State({})

        def start(locale_v, repeats_v, phrase_count_v):
            s = session_init(locale_v, int(repeats_v), int(phrase_count_v))
            return current_prompt(s), "Session đã tạo. Bắt đầu ghi âm câu hiện tại.", s

        start_btn.click(start, [locale, repeats, phrase_count], [prompt, status, state])
        submit_btn.click(process_audio, [audio, state], [status, prompt, state])
        save_btn.click(save_profile, [state], [save_status])

    return demo


if __name__ == "__main__":
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        free_port = s.getsockname()[1]
    ui = build_ui()
    ui.launch(server_name="127.0.0.1", server_port=free_port, inbrowser=True)