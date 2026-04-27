# Voice Feature Stack

## 1. Overview

The voice subsystem provides a Vietnamese+English voice assistant with three capabilities:

- **Speech-to-text** — incoming audio streams through the existing `webrtc-stream.ts` pipeline.
- **Speaker verification** — each utterance is compared against a stored voice profile using cosine similarity (default threshold: 0.75). Verification is disabled by default.
- **Text-to-speech** — LLM responses are synthesised to MP3 via Microsoft Edge TTS. Default voices: `vi-VN-HoaiMyNeural` (Vietnamese) and `en-US-AriaNeural` (English). Language is detected per-call using Vietnamese diacritics as a signal.

---

## 2. Architecture

```
Browser
  |  WebRTC audio stream (STT)
  |  WS voice.enroll.* / voice.tts.audio
  v
WS Gateway (packages/gateway)
  |-- webrtc-stream.ts   receives audio, calls verifySpeaker(), forwards transcript
  |-- enrollment.ts      handles voice.enroll.* WS protocol
  |-- verification.ts    cosineSim(incoming, profile) >= threshold?
  |-- edge-tts.ts        synthesise LLM response, send voice.tts.audio
  |
  |-- scripts/voice_embed.py   execFileAsync -> stdout JSON {embedding:[256 floats]}
  |-- scripts/edge_tts.py      execFileAsync -> stdout base64 MP3
  |-- scripts/rtvc_tts.py      (reserved, not yet wired)
  |
  |-- profile-store.ts   read/write <profileDir>/enrollment/<userId>.json
```

Python bridges are invoked as child processes via `execFileAsync`. The binary is controlled by `OMNISTATE_RTC_PYTHON`.

---

## 3. Setup

### Install Python dependencies

```bash
./scripts/setup-voice-python.sh
# With a specific Python binary:
./scripts/setup-voice-python.sh --python /usr/bin/python3.11
```

The script creates `.venv-voice/` at the repo root and installs `scripts/requirements.txt` (`edge-tts`, `numpy`, RTVC encoder deps). On completion it prints the venv Python path.

```bash
export OMNISTATE_RTC_PYTHON=/path/to/omnistate/.venv-voice/bin/python
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OMNISTATE_RTC_PYTHON` | `python3` | Python binary for all voice bridges |
| `OMNISTATE_RTC_REPO_DIR` | `packages/gateway/vendor/Real-Time-Voice-Cloning` | RTVC repo with `encoder/saved_models/pretrained.pt` |
| `OMNISTATE_RTC_PROFILE_DIR` | `<tmpdir>/omnistate-voice-profiles` | Root for enrollment JSON files |
| `OMNISTATE_SPEAKER_VERIFY_ENABLED` | `0` | Set `1` to enable speaker verification |
| `OMNISTATE_SPEAKER_VERIFY_THRESHOLD` | `0.75` | Cosine similarity threshold (0-1) |
| `OMNISTATE_SPEAKER_VERIFY_ON_MISMATCH` | `warn` | `warn`, `reject`, or `silent` |
| `OMNISTATE_TTS_PROVIDER` | `edge` | `edge`, `rtvc` (placeholder), or `none` (skip synthesis) |
| `OMNISTATE_TTS_VOICE_VI` | `vi-VN-HoaiMyNeural` | Vietnamese TTS voice |
| `OMNISTATE_TTS_VOICE_EN` | `en-US-AriaNeural` | English TTS voice |
| `OMNISTATE_ENROLL_MOCK` | unset | Set `1` to skip Python bridge; uses SHA-256-based embeddings |

---

## 4. Enrollment Flow

### Phrases (must be recorded in order)

| Index | Language | Phrase |
|-------|----------|--------|
| 0 | vi | Tro ly, hay bat dau phien lam viec hom nay |
| 1 | vi | Toi can ban tim kiem thong tin cho toi |
| 2 | vi | Hay doc lai noi dung vua nhan duoc |
| 3 | en | Hey assistant, open my task list |
| 4 | en | Read the last message out loud |

(Phrases include Vietnamese diacritics in source; shown without for ASCII safety.)

### WebSocket protocol

**Client -> gateway:**

| Message type | Key fields |
|---|---|
| `voice.enroll.start` | `userId: string` |
| `voice.enroll.sample` | `audio: string` (base64), `format: string`, `phraseIndex: 0-4` |
| `voice.enroll.finalize` | `userId: string` |
| `voice.enroll.cancel` | `userId: string` |

**Gateway -> client:**

| Message type | Key fields |
|---|---|
| `voice.enroll.ready` | `phraseIndex: number`, `prompt: string` |
| `voice.enroll.progress` | `accepted: boolean`, `phraseIndex: number` |
| `voice.enroll.done` | `userId: string`, `sampleCount: number` |
| `voice.enroll.error` | `code: string`, `message: string` |

Full type definitions: `packages/shared/src/protocol.ts`.

### Flow

1. Client sends `voice.enroll.start { userId }`.
2. Gateway creates an in-memory session; sends `voice.enroll.ready { phraseIndex: 0, prompt }`.
3. Client records phrase, sends `voice.enroll.sample { audio, format, phraseIndex: 0 }`.
4. Gateway extracts d-vector via `voice_embed.py`, stores in-memory, sends `voice.enroll.progress { accepted: true, phraseIndex: 1 }` and next `voice.enroll.ready`.
5. Steps 3-4 repeat for indices 1-4.
6. Client sends `voice.enroll.finalize`. Gateway averages five embeddings, writes `<profileDir>/enrollment/<userId>.json`, sends `voice.enroll.done`.
7. `voice.enroll.cancel` discards in-memory state; no file is written.

Re-enrollment overwrites the existing file at the backend level. The frontend (`VoiceEnrollment.tsx`) is expected to show a confirmation dialog first.

---

## 5. Runtime Config

Speaker verification and TTS voices can also be tuned at runtime via `~/.omnistate/llm.runtime.json` without restarting the gateway. Env vars are the fallback when runtime config keys are absent.

```json
{
  "voice": {
    "tts": {
      "provider": "edge",           // "edge" | "rtvc" | "none" (none skips synthesis)
      "voiceVi": "vi-VN-HoaiMyNeural",
      "voiceEn": "en-US-AriaNeural"
    },
    "speakerVerification": {
      "enabled": false,
      "threshold": 0.75,
      "onMismatch": "warn"
    }
  }
}
```

`onMismatch` modes:

| Mode | Effect |
|---|---|
| `warn` | Emits `voice.speaker.mismatch { sessionId, userId, score, threshold }` to client; processing continues |
| `reject` | Drops the utterance; no transcript forwarded |
| `silent` | Server-side log only; client not notified |

TTS voice selection priority: direct `opts.voice` argument > runtime config > env var > built-in default.

- **`tts.provider: "none"`** — skips synthesis entirely; no audio is emitted. Useful for text-only or testing scenarios.

### Protocol additions

**`voice.tts.audio`** message now includes optional fields:

| Field | Type | Description |
|---|---|---|
| `voice` | `string?` | Synthesized voice id used for this utterance |
| `text` | `string?` | Original text (for UI subtitle display) |

**`voice.speaker.mismatch`** event — emitted when verification is enabled and `score < threshold`:

| Field | Type |
|---|---|
| `type` | `"voice.speaker.mismatch"` |
| `sessionId` | `string` |
| `userId` | `string` |
| `score` | `number` |
| `threshold` | `number` |

### Settings UI (`VoiceSettings.tsx`)

Speaker Verification section exposes:

- **Enabled** toggle — maps to `speakerVerification.enabled`
- **Threshold** slider — range 0.5–0.95, step 0.05; maps to `speakerVerification.threshold`
- **On mismatch** selector — `warn` / `reject` / `silent`; maps to `speakerVerification.onMismatch`

### `/api/tts/preview`

- **Response:** JSON `{ audio: string (base64), voice: string }` — not a binary blob.
- **Input cap:** request text truncated / rejected beyond 500 characters.

---

## 6. Testing

### Smoke test (CI-safe, no RTVC model required)

```bash
./scripts/smoke-voice.sh
```

Runs gateway voice unit tests in mock mode (`OMNISTATE_ENROLL_MOCK=1`), then typechecks gateway and web packages.

### Mock mode

Set `OMNISTATE_ENROLL_MOCK=1` to skip `voice_embed.py`. A deterministic 256-dim embedding is generated from a SHA-256 hash of the raw audio bytes (`verification.ts`, `mockEmbedding`).

### Unit tests

| File | Covers |
|---|---|
| `packages/gateway/src/voice/__tests__/enrollment.test.ts` | WS session lifecycle, duplicate finalize rejection |
| `packages/gateway/src/voice/__tests__/verification.test.ts` | Cosine sim boundary (0.74 reject / 0.76 pass), `onMismatch` modes |
| `packages/gateway/src/voice/__tests__/profile-store.test.ts` | Read/write, missing profile, FS error on write |

Target coverage: >= 80% on the three backend voice files.

---

## 7. Known Limitations

- **No liveness detection.** A recording of the enrolled user passes verification. Replay-attack protection is out of scope.
- **Single profile per userId.** One JSON file per user; no multi-user aggregation.
- **File-based storage, local only.** Profiles do not sync across devices or deployments.
- **`rtvc` TTS provider** is declared in config types but falls through to Edge TTS. It is a placeholder for future use.

---

## 8. Troubleshooting

**`edge-tts` not installed**

```
Error: No module named 'edge_tts'
```

Run `scripts/setup-voice-python.sh`, or: `pip install edge-tts`.

**Wrong Python binary**

```
EMBEDDING_FAILED: [Errno 2] No such file or directory: 'python3'
```

Set `OMNISTATE_RTC_PYTHON` to the correct Python 3 path (printed by setup script).

**RTVC model not found**

```
{"error": "Encoder model pretrained.pt not found in repo"}
```

Download `pretrained.pt` to `<repo>/encoder/saved_models/`. During development use `OMNISTATE_ENROLL_MOCK=1`.

**`NO_PROFILE` on verification**

`verifySpeaker` returns `{ match: false, score: 0, reason: "NO_PROFILE" }` when no profile exists. Run enrollment first. Ensure `OMNISTATE_RTC_PROFILE_DIR` is consistent between enrollment and runtime.

**`SAVE_FAILED` on finalize**

The enrollment directory could not be written. Check write permissions on `OMNISTATE_RTC_PROFILE_DIR` (or `<tmpdir>/omnistate-voice-profiles/`).
