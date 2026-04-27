# OmniState — Architecture & Implementation Reference

> Single-file reference: cấu trúc dự án, từng phase pipeline, các model AI, danh sách Use Case đã implement và UC còn dở.
> Nguồn: survey codebase ngày 2026-04-23 (4 sub-agents Haiku đọc song song `packages/`, `crates/`, `apps/`).

---

## 1. Overview

OmniState là personal AI agent điều khiển máy tính (macOS-first) bằng vision + voice + OS APIs, có companion mobile (Android/iOS RN) và remote-fleet qua Tailscale.

```
User (voice / text / mobile)
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│                    GATEWAY DAEMON (Node)                  │
│   WS :19800 + HTTP REST + Siri TCP :19801 + Prometheus    │
│                                                            │
│   Planner → Executor → [Deep | Surface | Fleet] Layers    │
│      ▲                       │                             │
│      │                       ▼                             │
│   LLM Router          Native .node (Rust N-API)            │
│   (Claude/Router9)    (capture · screen · input · a11y)    │
│                                                            │
│   Session · Voice · Plugins · Triggers · Health · Auth    │
└──────────────────────────────────────────────────────────┘
        │                                  │
        ▼                                  ▼
   Web SPA (Vite)                   macOS .app (SwiftUI+WKWebView)
   Mobile (RN: Android + iOS target)
```

---

## 2. Repository Layout

```
omnistate/
├── crates/                 # Rust native (compiled → .node addon)
│   ├── omnistate-core      # shared types: Frame, UIElement, Key, Point...
│   ├── omnistate-capture   # ScreenCaptureKit + IOSurface (zero-copy GPU)
│   ├── omnistate-screen    # CGDisplay/CGWindow fallback capture
│   ├── omnistate-input     # CGEvent mouse/keyboard synthesis
│   ├── omnistate-a11y      # AXUIElement tree walk
│   └── omnistate-napi      # N-API bridge → 22 exported fns
├── packages/
│   ├── gateway/            # Node daemon — orchestration core
│   ├── web/                # Vite SPA dashboard (React 19)
│   ├── shared/             # Protocol + auth + trigger + mirror types
│   ├── mobile-core/        # Cross-platform (RN/Web/Node) WS client + auth
│   └── cli/                # `omnistate` CLI (Node)
├── apps/
│   ├── macos/              # SwiftUI app, WKWebView host của web SPA
│   └── android/            # RN 0.77 + ios/ target (shared JS)
└── docs/
    └── ARCHITECTURE.md     # ← file này
```

---

## 3. Layer Architecture

| Layer | Responsibility | Files (gateway) | Maturity |
|---|---|---|---|
| **Deep** | OS-level: filesystem, process, AppleScript, pmset, permissions | `layers/deep.ts`, `deep-os.ts`, `deep-system.ts` | ✅ macOS đầy đủ; ⚠️ Linux pmset stub; ❌ Windows stub |
| **Surface** | Vision UI: screen capture → element detect → input synthesize | `layers/surface.ts` (+ vision/, native bridge) | ✅ Functional; ⚠️ Vision-fallback Sprint-3 chưa làm |
| **Fleet** | Multi-device: dispatch task sang gateway peers, sync config, aggregate health | `layers/fleet.ts` | ✅ Wired qua HTTP |
| **Hardware** | Sensor read | `layers/hardware.ts` | ✅ |
| **Browser** | Browser automation | `layers/browser.ts` | ✅ |
| **Communication / Media / Developer / Maintenance / Software** | Domain helpers | tương ứng `layers/*.ts` | ✅ |

---

## 4. Pipelines (Phase-by-Phase)

### 4.1 Command Execution Pipeline

```
┌─ phase 0: ingress ────────────────────────────────────────┐
│   WS /HTTP /Siri-TCP /CLI → gateway/server.ts             │
│   auth check (JWT) → rate-limiter → command router         │
└────────────────────────────────────────────────────────────┘
                       │
┌─ phase 1: plan ───────▼───────────────────────────────────┐
│   planner/intent.ts     → classify intent (LLM call)      │
│   planner/graph.ts      → build TaskGraph (DAG of steps)  │
│   planner/optimizer.ts  → prune/merge/reorder             │
└────────────────────────────────────────────────────────────┘
                       │
┌─ phase 2: queue ──────▼───────────────────────────────────┐
│   executor/queue.ts          → priority FIFO               │
│   executor/resource-tracker  → CPU/mem budget guard        │
└────────────────────────────────────────────────────────────┘
                       │
┌─ phase 3: execute ────▼───────────────────────────────────┐
│   executor/orchestrator.ts                                 │
│     → dispatch each TaskNode to chosen layer              │
│     → executor/retry.ts (exponential backoff)             │
│   layer:                                                   │
│     Deep    → OS sys-calls (fs, process, AppleScript)     │
│     Surface → see §4.2 Vision Pipeline                    │
│     Fleet   → HTTP POST tới peer gateway → repeat         │
└────────────────────────────────────────────────────────────┘
                       │
┌─ phase 4: verify ─────▼───────────────────────────────────┐
│   executor/result-verifier  → re-screenshot diff / check  │
│   vision/approval-policy    → permission approval if any  │
└────────────────────────────────────────────────────────────┘
                       │
┌─ phase 5: persist ────▼───────────────────────────────────┐
│   session/store.ts          → SQLite session row          │
│   session/transcript-log    → append-only audit           │
│   session/claude-mem-store  → long-term memory            │
│   metrics → Prometheus + WS event broadcast → UI          │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Vision Pipeline (Surface Layer)

4 priorities — fallback-on-fail:

```
phase A: capture
  vision/engine.ts → omnistate-capture (IOSurface, ~3-10 ms)
                     fallback: omnistate-screen (CGDisplay, 50-200 ms)
phase B: detect element  (priority order)
  1. Fingerprint match    → vision/detect.ts (cached UI hash)
  2. Accessibility tree   → omnistate-a11y AXUIElement walk
  3. OCR                  → tesseract.js (in-process) hoặc native bridge
  4. Claude Vision        → vision/providers/claude.ts (last resort)
                            ⚠️ TODO: Vision model fallback Sprint-3
phase C: act
  omnistate-input → CGEvent mouse/keyboard synthesis
  vision/approval-center → human-in-the-loop nếu policy yêu cầu
```

### 4.3 Voice Pipeline

```
mic capture (web getUserMedia / RN AudioRecorder / mac AVCaptureDevice)
   → PCM Float32
   → mobile-core/voice-encoder.ts (Float32 → 16-bit WAV → base64)
   → WS message vibevoice.* (typed in shared/protocol.ts)
   → gateway:
        wake-word          : voice/wake-manager.ts (OpenWakeWord, Python child)
        speaker ID (auth)  : voice/voiceprint.ts → SpeechBrain ECAPA-TDNN
        STT                : whisper-local | whisper-cloud (llm/runtime-config)
        TTS / clone        : voice/rtvc.ts (Real-Time-Voice-Cloning, vendored)
        full-duplex stream : voice/webrtc-stream.ts
   → planner intent → execution pipeline (§4.1)
```

### 4.4 Auth & Pairing Pipeline

```
phase 1: enroll        — voice 3-sample capture → SpeechBrain embedding
                         → db/voice-profile-repository
phase 2: signup/signin — http/auth-routes (bcrypt + JWT)
phase 3: device pair   — LAN PIN /api/lan/pair
                         (mobile-core/token-manager.ts ↔ gateway)
phase 4: token         — short-lived session-token (24h cookie httpOnly)
                         long-lived device-token + refresh
                         JWT pre-expiry warning event
```

---

## 5. AI Models In Use

| Model | Provider | Location | Use case |
|---|---|---|---|
| **Claude Haiku 4.5** | Anthropic SDK | `llm/router.ts` (default) | Intent classify, simple plan, fast tasks |
| **Claude Sonnet 4.6** | Anthropic SDK | `llm/runtime-config.ts` | Default code/task generation |
| **Claude Opus 4.7** | Anthropic SDK | `llm/runtime-config.ts` | Architecture / heavy plan only |
| **Claude Vision** | Anthropic SDK | `vision/providers/claude.ts`, `vision/detect.ts` | UI element detect cuối cùng (priority 4) |
| **Router9 OpenAI-compat** | `gh/...`, `cx/...`, `kr/...` | `llm/router.ts` | Fallback khi Anthropic 429/5xx |
| **Whisper (local + cloud)** | OpenAI / faster-whisper | `llm/runtime-config.ts` | Speech-to-text |
| **SpeechBrain ECAPA-TDNN** | local Python child | `scripts/speechbrain_voiceprint.py` | Speaker identification (auth) |
| **OpenWakeWord (OWW)** | local Python child | `scripts/wake_listener_oww.py` | Wake-word "Hey OmniState" |
| **Real-Time Voice Cloning** | vendored `Real-Time-Voice-Cloning/` | `voice/rtvc.ts` | TTS với giọng người dùng |
| **Tesseract.js** | in-process JS | `vision/providers/local.ts` | OCR offline |

**Routing policy** (mặc định trong code) — ưu tiên Haiku cho intent + Sonnet cho code/exec; Opus chỉ khi explicit. Có circuit-breaker (`llm/circuit-breaker.ts`) chuyển provider khi error.

---

## 6. Use Cases — Implementation Status

### 6.1 ✅ Implemented

| UC | File / module |
|---|---|
| Task planner (intent → DAG) | `planner/intent.ts`, `graph.ts`, `optimizer.ts` |
| Task orchestration + retry | `executor/orchestrator.ts`, `queue.ts`, `retry.ts` |
| Result verification | `executor/result-verifier` |
| Screen capture (zero-copy GPU) | `crates/omnistate-capture` (SCK + IOSurface, macOS 14+) |
| Screen capture (fallback) | `crates/omnistate-screen` (CGDisplay) |
| Window enumerate + region capture | `omnistate-screen::list_windows / capture_region` |
| Mouse/keyboard synthesis | `crates/omnistate-input` (CGEvent, smooth Bezier) |
| Accessibility tree walk | `crates/omnistate-a11y` (AXUIElement) |
| Element detection (4-priority) | `vision/detect.ts`, `engine.ts`, `advanced.ts` |
| OCR | `vision/providers/local.ts` (tesseract) + native bridge |
| Permission approval center | `vision/approval-center.ts`, `approval-policy.ts`, `permission-responder.ts` |
| LLM router + circuit breaker | `llm/router.ts`, `circuit-breaker.ts`, `preflight` |
| Voice wake-word | `voice/wake-manager.ts` + Python OWW |
| Voice cloning (RTVC) | `voice/rtvc.ts` + vendored RTVC |
| Voiceprint speaker ID | `voice/voiceprint.ts` + SpeechBrain |
| WebRTC voice stream | `voice/webrtc-stream.ts` |
| Auth (JWT + bcrypt) | `gateway/auth.ts`, `http/auth-routes.ts`, `config/jwt-secret.ts` |
| Session store (SQLite) | `session/store.ts`, `db/session-repository.ts` |
| Long-term memory | `session/claude-mem-store.ts`, `memory-pal.ts` |
| Plugin system | `plugin/registry.ts`, `hooks.ts`, `sdk.ts` |
| Cron / event triggers | `triggers/trigger-engine.ts`, `templates.ts` |
| Health monitor + self-heal | `health/monitor.ts`, `advanced-health.ts`, `repair.ts`, `sensors.ts` |
| Fleet multi-device dispatch | `layers/fleet.ts` |
| Tailscale mesh detect | `network/tailscale.ts` |
| Prometheus metrics | `gateway/metrics.ts` |
| Mirror sessions (screen share) | `gateway/mirror-session.ts` (gateway side ✅) |
| Hybrid automation scripting | `hybrid/automation.ts`, `tooling.ts` |
| Rate limiting | `http/rate-limiter.ts` |
| Device registry + LAN pairing | `db/device-repository.ts`, `http/device-routes.ts`, `mobile-core/token-manager.ts` |
| CLI: start/run/status/health/stop + ext | `packages/cli/src/cli.ts` |
| Web dashboard (11 panels — xem §7) | `packages/web/src/components/*` |
| Mobile app: 9 screens + native modules | `apps/android/` |
| macOS native shell + permission bootstrap | `apps/macos/PermissionBootstrapper.swift` |

### 6.2 ⚠️ Partial / Stubbed

| UC | Vị trí | Trạng thái |
|---|---|---|
| **Vision model fallback** | `layers/surface.ts:207` | TODO Sprint-3 — comment thẳng |
| **Auto-generated automation scripts** | `hybrid/automation.ts:1708-1710` | Scaffold sinh `echo "TODO: implement ${description}"` cho bash/python |
| **Linux power-management** | `layers/deep-os.ts:1625` | Stub — chỉ macOS pmset thật |
| **Windows Deep layer** | `layers/deep-os.ts:11` | "Windows stubs" comment, không build được trên Windows |
| **`integrations/` folder** | `packages/gateway/src/integrations/` | Empty directory |
| **Web: `MirrorPage`** | `packages/web/src/components/MirrorPage.tsx` | Component viết xong nhưng KHÔNG mount trong `App.tsx` (orphan) |
| **Web: `PixelAgentLocalPanel`** | `packages/web/src/components/PixelAgentLocalPanel.tsx` | Tương tự — orphan, không reachable |
| **i18n mobile-core** | `mobile-core/src/i18n.ts:82` | 7/9 locales (ja/ko/zh/fr/de/es/th) fallback EN; web có dịch nhưng mobile chưa |
| **Mobile `connection-store` persistence** | `apps/android/src/.../connection-store.ts` | Dùng `Map` in-memory, comment: "replace with AsyncStorage in production" |
| **Mobile `macro-store` persistence** | `apps/android/src/.../macro-store.ts` | TODO: wire AsyncStorage |
| **Mobile `CameraCapture.ts`** | `apps/android/src/.../CameraCapture.ts` | Trả placeholder base64 khi native module vắng (dev-mock) |
| **CLI ↔ shared types drift risk** | `packages/cli/src/cli.ts` | CLI tự inline subset protocol thay vì import `@omnistate/shared` → drift risk |

### 6.3 ❌ Not Implemented

| UC | Ghi chú |
|---|---|
| **Windows native** (capture/screen/input/a11y) | Tất cả `crates/*` để Windows deps commented out (DXGI, SendInput, UIA) |
| **Linux native** | Tương tự (PipeWire, XTest/libei, AT-SPI2) — comment out |
| **iOS / Android native crates** | Module declarations có, source files không có |
| **Streaming capture qua N-API** (async callback) | Không có `napi::threadsafe_function` — pixel data luôn full-copy vào Buffer |
| **TypeScript .d.ts auto-gen** cho N-API | Không có config visible |
| **`key_down`/`key_up` non-macOS** | Silent no-op fallback |
| **iOS native modules** (RN) | iOS target chỉ chạy JS chung; không có a11y/screen-capture/overlay native như Android |

---

## 7. Web Dashboard — Panel Map

`App.tsx` quản state `View` thủ công (không router). 11 panel được mount:

| Nav | Component | Note |
|---|---|---|
| Dashboard | `DashboardOverview` | summary |
| Chat | `ChatView` + `ChatInput` + `MessageBubble` | task input + memory sync |
| Voice | `VoicePage` | VibeVoice stream + wake config + enroll |
| Health | `HealthDashboard` | sensor table + alerts |
| System | `SystemPanel` | battery/wifi/disk/cpu/mem |
| Config | `ConfigPage` | provider/model/API key |
| Settings | `SettingsPanel` | app-level |
| ScreenTree | `ScreenTreePage` | a11y tree viewer |
| Triggers | `TriggerPage` | CRUD trigger |
| Memory | `MemoryPalPage` | KV memory |
| Approvals | `ApprovalCenter` | permission history + policy |

State store: Zustand (`lib/chat-store.ts`, `lib/auth-store.ts`).
Auth gate: hard-redirect tới `AuthPage` (voice enrollment) nếu chưa có voice profile — có thể block onboarding nếu mic/SpeechBrain trục trặc.

---

## 8. Mobile App (RN bare 0.77)

Bottom-tab 9 màn (`Dashboard, Chat, Automation, Macro Editor, Live Preview, Settings, Voice, Connect, Triggers`). Native module Android:

| Kotlin module | Bridge | Purpose |
|---|---|---|
| `OmniAccessibilityService` | AccessibilityBridge / GestureBuilder / NodeSerializer | UI tree + gesture inject |
| `ScreenCaptureService` | ScreenCaptureBridge / ImageProcessor | MediaProjection + JPEG |
| `OverlayWindowService` | OverlayBridge | System overlay |
| `OmniPackage` | — | Register tất cả |

**iOS target:** chia sẻ 100% JS/TS trong `src/`; native layer chỉ là `RCTAppDelegate` skeleton — mất chức năng a11y/capture/overlay trên iOS cho tới khi viết RN module riêng.

---

## 9. macOS App

- SwiftUI `@main`, `@NSApplicationDelegateAdaptor`, MenuBarExtra popover
- 6 `@StateObject` services injected env: `GatewayManager`, `HealthChecker`, `NetworkMonitor`, `DeviceManager`, `GatewaySocketClient`, `VoiceCaptureService`
- `WebViewContainer` (WKWebView) host web SPA: scheme `omnistate://`, JS↔Swift bridge `window.omnistateNative`, dev mode `OMNISTATE_USE_DEV_SERVER=1` → `localhost:5173`
- `PermissionBootstrapper`: Accessibility, Screen Recording, Apple Events (Automation), Microphone, Camera, Speech, Notifications — 6h cooldown
- Build: `build-and-open-app.sh` → `swift build -c release` → hand-craft `.app` → ad-hoc codesign → open. Không Xcode project.
- **0 SPM external dependencies** — tất cả first-party Apple frameworks.

---

## 10. Maturity Snapshot

| Domain | Status |
|---|---|
| macOS native (Rust × 4 crates) | ✅ Production-ready |
| Gateway (planner / executor / vision / voice / auth / fleet) | ✅ Production-ready |
| Web SPA | ✅ Hoàn chỉnh (trừ 2 panel orphan) |
| macOS app shell | ✅ ~95% |
| Android RN | ⚠️ ~80% — persistence in-memory |
| iOS RN | ❌ Skeleton — không có native modules |
| Windows / Linux native | ❌ Stub toàn bộ |
| Streaming capture API | ❌ Chưa có async callback |
| i18n mobile-core | ⚠️ 2/9 locales |
| Vision-fallback Sprint-3 | ⚠️ TODO |

---

## 11. Quick References

- Entry: `packages/gateway/src/index.ts` → `OmniStateGateway` (`gateway/server.ts`)
- WS protocol: `packages/shared/src/protocol.ts` (18 client + 24 server messages)
- LLM config runtime: `packages/gateway/src/llm/runtime-config.ts`
- Native addon: `packages/gateway/native/omnistate.darwin-arm64.node`
- Build pipeline: `pnpm app:init && pnpm app:config && pnpm app:build:web && pnpm app:build:macos`
- Dev: `pnpm run:all` (gateway + web với HMR)

---

*Generated 2026-04-23 by survey of `packages/`, `crates/`, `apps/`. Thông tin "TODO/stub" lấy trực tiếp từ comment trong code — nếu sửa, update file này luôn.*
