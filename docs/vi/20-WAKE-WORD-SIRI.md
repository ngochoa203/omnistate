# 20 – Wake-Word Engine Siri-Style (openWakeWord)

## Kiến trúc 2-tier

OmniState dùng kiến trúc wake-word 2 lớp giống Apple Siri, thay thế mô hình ghi âm 24/7 + ASR liên tục cũ:

```
┌─────────────────────────────────────────────────────┐
│  Tier 1 — Always-On Hotword (openWakeWord + ONNX)   │
│  • 80ms audio frame, ~1-3% CPU                      │
│  • Không gọi STT — chỉ chạy 1 model nhỏ             │
│  • Khi score > threshold → kích hoạt Tier 2          │
└───────────────────────┬─────────────────────────────┘
                        │ wake event
┌───────────────────────▼─────────────────────────────┐
│  Tier 2 — Post-Wake Processing                      │
│  • Mở mic trong commandWindowSec (5-10s)            │
│  • SpeechBrain ECAPA speaker verify (đã có)         │
│  • STT (Google Speech Recognition fallback)         │
│  • POST {phrase, transcript, timestamp} → Siri bridge│
└─────────────────────────────────────────────────────┘
```

**Script**: `packages/gateway/scripts/wake_listener_oww.py`  
**Legacy**: `packages/gateway/scripts/wake_listener.py` (giữ làm fallback)

---

## Cài đặt dependencies

```bash
cd packages/gateway/scripts
bash install_wake_deps.sh
```

Hoặc thủ công:

```bash
pip install openwakeword speechbrain torch torchaudio sounddevice numpy speech_recognition
# macOS Apple Silicon: sounddevice cần PortAudio
brew install portaudio
pip install sounddevice
```

---

## Chạy thử

```bash
python3 packages/gateway/scripts/wake_listener_oww.py \
  --phrase mimi \
  --endpoint http://127.0.0.1:9999/voice \
  --token YOUR_TOKEN \
  --cooldown-ms 1300 \
  --command-window-sec 7 \
  --aliases '["mimi","hey mimi","ok mimi"]'
```

Kỳ vọng log:
```
Listening for wake-word: hey_jarvis (placeholder for hey mimi) (threshold=0.50)
```

---

## Switch engine

Trong config `~/.omnistate/llm.runtime.json`:

```json
{
  "voice": {
    "wake": {
      "engine": "oww",
      "phrase": "mimi",
      "aliases": ["mimi", "hey mimi", "ok mimi", "mimi ơi"],
      "threshold": 0.5,
      "modelPath": "/path/to/hey_mimi.onnx"
    }
  }
}
```

- `engine: "oww"` (default) — dùng openWakeWord
- `engine: "legacy"` — dùng `wake_listener.py` cũ (Sphinx + Google STT)

---

## Train custom "hey mimi" model

openWakeWord cho phép train model cá nhân hóa bằng synthetic data (không cần thu âm thật).

**Colab nhanh nhất**: https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEY

Tóm tắt quy trình:
1. Mở Colab link trên
2. Nhập wake phrase: `hey mimi`
3. Chạy tất cả cells (sinh synthetic audio → train → export ONNX)
4. Download file `hey_mimi.onnx`
5. Đặt vào `~/.omnistate/models/hey_mimi.onnx`
6. Set config: `"modelPath": "/Users/YOU/.omnistate/models/hey_mimi.onnx"`

Docs chi tiết: https://github.com/dscripka/openWakeWord#training-new-models

---

## Tuning threshold

| Threshold | Hành vi |
|-----------|---------|
| `0.3`     | Nhạy hơn, nhiều false positive |
| `0.5`     | Cân bằng (default) |
| `0.7`     | Ít false positive, cần nói rõ hơn |

Test threshold bằng cách chạy script với `--threshold 0.3` và quan sát log score.

---

## Troubleshoot

**PyAudio/sounddevice lỗi trên macOS**
```
OSError: [Errno -9996] Invalid input device
```
→ `brew install portaudio && pip install --force-reinstall sounddevice`

**openwakeword không tìm thấy model**
```
FileNotFoundError: hey_jarvis not found
```
→ `python3 -c "import openwakeword; openwakeword.utils.download_models()"`

**Apple Silicon: torch không cài được**
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

**CPU vẫn cao khi dùng oww**
→ Kiểm tra `--threshold` có đủ cao không, hoặc giảm `CHUNK_SAMPLES` (không nên < 1280).
→ openwakeword chạy ONNX trên CPU, không cần GPU.

---

## stdout event format

Mỗi lần wake fire, script in JSON ra stdout để `wake-manager.ts` log:

```json
{
  "type": "wake",
  "score": 0.87,
  "model": "hey_jarvis",
  "phrase": "mimi",
  "transcript": "mở Safari",
  "accepted": true,
  "timestamp": 1714000000.123
}
```
