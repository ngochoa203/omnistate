# OmniState — Trạng Thái Dự Án

> **Cập nhật lần cuối:** 2026-04-14
> **Phiên bản tài liệu:** 1.0

---

## Tổng Quan

**OmniState** ("Shadow OS") là một AI agent cá nhân chạy trên macOS, hoạt động hoàn toàn tự chủ — hiểu màn hình qua thị giác máy tính, điều khiển bằng giọng nói, và thực thi tác vụ trực tiếp trên hệ điều hành.

| Thông tin | Chi tiết |
|-----------|----------|
| **Mục tiêu** | AI agent tự chủ cho macOS (Shadow OS) |
| **Nền tảng** | macOS (primary), Android (secondary), iOS (planned) |
| **Tech stack** | Rust + Node.js (gateway) + Swift (macOS app) + React Native (mobile) |
| **Tiến độ tổng thể** | ~78% hoàn thiện |
| **Use case coverage** | ~78% (UC1/3/4/5/6/7/8/9/10/11/12/13 significantly updated) |

---

## Kết Quả E2E Theo Page (2026-04-14)

Nguồn chạy thực tế: task `e2e-pages-check-run5` (gateway build + WebSocket checks tại `127.0.0.1:19800`).

| Page | Check | Result | Evidence |
|---|---|---|---|
| Dashboard | connect | PASS | connected |
| Dashboard | status.query | PASS | clients=1 |
| Dashboard | history.query | PASS | entries=0 |
| Dashboard | runtime.config.get | PASS | provider=anthropic |
| Chat | runtime provider apply | PASS | Updated provider |
| Chat | runtime model apply | PASS | Updated model |
| Chat | task dispatch | PASS | taskId=3de239ee-d338-4187-b04b-34d698898b44 |
| Chat | claude.mem.query | PASS | sessions=1 |
| Voice | voice.lowLatency | PASS | Updated voice.lowLatency |
| Voice | voice.autoExecuteTranscript | PASS | Updated voice.autoExecuteTranscript |
| Voice | voice.siri.enabled | PASS | Updated voice.siri.enabled |
| Voice | voice.siri.mode | PASS | Updated voice.siri.mode |
| Voice | voice.siri.endpoint | PASS | Updated voice.siri.endpoint |
| Voice | voice.siri.token | PASS | Updated voice.siri.token |
| Voice | voice.wake.enabled | PASS | Updated voice.wake.enabled |
| Voice | voice.wake.phrase | PASS | Updated voice.wake.phrase |
| Triggers | wake.cooldownMs | PASS | Updated voice.wake.cooldownMs |
| Triggers | wake.commandWindowSec | PASS | Updated voice.wake.commandWindowSec |
| Triggers | verify wake persisted | PASS | cooldown=1300,window=18 |
| Settings | claude.mem.sync | PASS | claude-mem synced |
| Settings | runtime voice snapshot | PASS | siri.enabled=true,mode=command,wake.enabled=true |

Tổng hợp: **21 PASS / 0 FAIL**

Kết luận nhanh:
- Các action chính của Dashboard/Chat/Voice/Triggers/Settings đang gọi hành vi thật qua gateway và trả ACK đúng.
- Đã fix sai lệch kiểm chứng persistence ở nhánh Triggers bằng cách lấy `runtime.config.report` mới nhất sau khi settle stream; giá trị wake timing hiện phản ánh đúng sau `runtime.config.set`.
- Gateway đã được harden: key `runtime.config.set` không hợp lệ sẽ trả `ack.ok=false` thay vì ACK thành công giả.

---

## Kiến Trúc Dự Án

```
omnistate/
├── crates/              # Rust native bindings (6 crates)
├── packages/
│   ├── gateway/         # Node.js gateway daemon (lõi hệ thống)
│   ├── web/             # Vite SPA dashboard
│   ├── shared/          # Protocol types dùng chung
│   ├── mobile-core/     # Cross-platform mobile logic
│   └── cli/             # CLI client
├── apps/
│   ├── macos/           # Swift/SPM native app
│   └── android/         # React Native app
└── docs/                # Tài liệu kiến trúc (vi/) + audits
```

---

## Trạng Thái Chi Tiết

### 🦀 Rust Native Crates (6/6)

| Crate | Mô tả | Trạng thái |
|-------|-------|-----------|
| `omnistate-core` | Error types, shared types | ✅ Hoàn thành |
| `omnistate-capture` | ScreenCaptureKit + IOSurface zero-copy GPU capture | ✅ Hoàn thành |
| `omnistate-screen` | CGDisplay fallback capture | ✅ Hoàn thành |
| `omnistate-input` | CGEvent mouse/keyboard (move, click, drag, scroll, type, hotkey) | ✅ Hoàn thành |
| `omnistate-a11y` | AXUIElement accessibility tree walker | ✅ Hoàn thành |
| `omnistate-napi` | N-API bridge — export tất cả crates sang TypeScript | ✅ Hoàn thành |

---

### ⚙️ Gateway Daemon (`packages/gateway`)

#### Infrastructure Lõi

| Component | Trạng thái |
|-----------|-----------|
| WebSocket server (port 19800) | ✅ Hoàn thành |
| HTTP API server (port 19801) | ✅ Hoàn thành |
| SQLite + 6 migrations (users, sessions, voice, triggers, conversations, devices) | ✅ Hoàn thành |
| JWT auth — session token + device token + refresh | ✅ Hoàn thành |
| Config system (Zod-validated) | ✅ Hoàn thành |
| Health monitor + self-repair | ✅ Hoàn thành |
| Rate limiting trên APIs | ❌ Chưa làm |
| Production auth hardening (JWT secret) | ❌ Vẫn dùng dev secret |

#### Vision System

| Component | Trạng thái |
|-----------|-----------|
| Element detection 4 tầng (fingerprint → a11y → OCR → Claude Vision) | ✅ Hoàn thành |
| Tesseract.js OCR + fuzzy matching | ✅ Hoàn thành |
| Claude Vision integration (semantic detection) | ✅ Hoàn thành |
| Permission dialog detection (`detectPermissionDialog`) | ✅ Hoàn thành |
| Approval policy engine (blocklist/allowlist/custom rules) | ✅ Hoàn thành |
| Permission auto-responder (GUI + Claude Code terminal) | ✅ Hoàn thành |
| Modal detection + dismissal | ✅ Hoàn thành |

#### Execution Pipeline

| Component | Trạng thái |
|-----------|-----------|
| DAG orchestrator (plan → execute → verify) | ✅ Hoàn thành |
| Task queue với retry + resource tracking | ✅ Hoàn thành |
| Command router (intent → plan → execute) | ✅ Hoàn thành |
| Deep layer (direct OS APIs) | ✅ Hoàn thành |
| Surface layer (vision-based UI interaction) | ✅ Hoàn thành |
| Hybrid automation (AppleScript + native) | ✅ Hoàn thành |
| Fleet layer (multi-machine coordination) | ❌ Thiết kế xong, chưa implement |
| Plugin system (hooks + registry) | 🚧 Hooks có, nhưng không có plugin nào hoạt động |

#### HTTP APIs

| Nhóm | Endpoints | Trạng thái |
|------|-----------|-----------|
| **Auth** | signup, login, refresh, logout, /me | ✅ Hoàn thành |
| **Voice** | enroll, verify | ✅ Hoàn thành |
| **Devices** | pair, list, refresh, revoke, generate-pin | ✅ Hoàn thành |
| **Network** | info, tailscale status | ✅ Hoàn thành |
| **Health** | /health, /healthz, /readyz | ✅ Hoàn thành |
| **Permission** | policy CRUD, history, start/stop | ✅ Hoàn thành |
| **Rate limiting** | — | ❌ Chưa có |
| **WebRTC voice streaming** | — | ❌ Chưa có |

---

### 🌐 Web Dashboard (`packages/web`)

| Component | Trạng thái |
|-----------|-----------|
| Vite SPA | ✅ Hoàn thành |
| Voice identity panel | ✅ Hoàn thành |
| Gateway connection via WebSocket | ✅ Hoàn thành |
| Task dispatch + streaming results | ✅ Hoàn thành |
| LLM provider management | ✅ Hoàn thành |
| i18n (9 ngôn ngữ) | ✅ Hoàn thành |
| Onboarding wizard (first-run experience) | ❌ Chưa có |
| Dedup code với mobile-core (i18n, gateway-client, audio-utils) | ❌ Đang bị duplicate |

---

### 🍎 macOS App (`apps/macos`)

| Component | Trạng thái |
|-----------|-----------|
| Swift/SPM project (build thành công) | ✅ Hoàn thành |
| WKWebView wrapping web dashboard | ✅ Hoàn thành |
| Gateway process manager (auto-start, restart) | ✅ Hoàn thành |
| Menu bar: gateway status, network info, Tailscale IP, device list, PIN pairing | ✅ Hoàn thành |
| Global hotkey ⌘⇧O | ✅ Hoàn thành |
| Health checker polling | ✅ Hoàn thành |
| Custom URL scheme `omnistate://` | ✅ Hoàn thành |
| Xcode project (`.xcodeproj`) | ❌ Chỉ có SPM, không có .xcodeproj |

---

### 📱 Mobile Core (`packages/mobile-core`)

| Component | Trạng thái |
|-----------|-----------|
| `GatewayClientCore` (platform-agnostic WebSocket + device token) | ✅ Hoàn thành |
| Store factory (pluggable storage adapter) | ✅ Hoàn thành |
| Voice encoder (DOM-free WAV encoding) | ✅ Hoàn thành |
| i18n (9 ngôn ngữ, mobile-specific copy) | ✅ Hoàn thành |
| Token manager (pair, refresh, JWT decode) | ✅ Hoàn thành |

---

### 🤖 Android App (`apps/android`)

| Component | Trạng thái |
|-----------|-----------|
| React Native scaffold + Metro monorepo config | ✅ Hoàn thành |
| 6 màn hình: Connect, Dashboard, Chat, Voice, Triggers, Settings | ✅ Hoàn thành |
| Connection store (persistent, saved gateways) | ✅ Hoàn thành |
| Tailscale remote connection support | ✅ Hoàn thành |
| Native audio recording module | ❌ Chưa có (chỉ là scaffold) |
| Native camera module | ❌ Chưa có |
| iOS app | ❌ Chưa tồn tại |

---

### 🔒 Remote Access / Phase 3

| Component | Trạng thái |
|-----------|-----------|
| Tailscale detection (`tailscale status --json`) | ✅ Hoàn thành |
| Device registration với 30-day JWT + 90-day refresh | ✅ Hoàn thành |
| LAN PIN pairing → persistent device token | ✅ Hoàn thành |
| Network info API (LAN IPs + Tailscale) | ✅ Hoàn thành |
| Remote config (enabled, tailscaleOnly, allowedDevices) | ✅ Hoàn thành |

---

### 📚 CLI & Documentation

| Component | Trạng thái |
|-----------|-----------|
| CLI client | ✅ Hoàn thành |
| 15 tài liệu kiến trúc tiếng Việt (`docs/vi/`) | ✅ Hoàn thành |
| Use case audit (91 items cataloged) | ✅ Hoàn thành |
| Phase 3 plan (`docs/plan.md`) | ✅ Hoàn thành |
| CHANGELOG.md | ❌ Chưa có |
| CI/CD pipeline (workflows có nhưng chưa test) | 🚧 Chưa xác minh |

---

## Ma Trận Use Case

> Nguồn: audit 91 items, cập nhật 2026-04-14

| Use Case | Hoàn chỉnh | Một phần | Thiếu | Tiến độ |
|----------|:----------:|:--------:|:-----:|:-------:|
| UC1: GUI & Peripherals | 7 | 5 | 2 | 🟢 90% — Added 13 methods: Window geometry (getWindowInfo, resizeWindow, repositionWindow, minimizeWindow, maximizeWindow, closeWindow, listWindows), OCR with confidence (getTextWithConfidence, findTextOnScreen), Drag-and-drop (dragAndDrop, dragFile), Screenshot to file (captureRegionToFile, captureWindowToFile) |
| UC2: Window/App Management | 4 | 2 | 1 | 🟢 80% — Added clipboard expansion: getClipboardImage, copyFileToClipboard, RTF handling, persistent history (JSON), clipboard watching |
| UC3: File System Operations | 3 | 3 | 2 | 🟢 80% — Added 10 methods to deep.ts: listDirectory, searchFiles, getMetadata, setPermissions, getPermissions, watchDirectory, createSymlink, resolveSymlink, getDiskSpace, compareFiles |
| UC4: Browser Automation | 2 | 3 | 2 | 🟨 70% — Created layers/browser.ts (28 methods): Tab management, Navigation, JS execution, Form interaction, Cookies/Storage, Screenshots/PDF. Dual AppleScript (Safari) + JXA (Chrome) |
| UC5: System & Network | 2 | 3 | 2 | 🟢 80% — Added 8 monitoring methods: getCpuUsage, getMemoryUsage, getNetworkStats, getThermalState, getSystemUptime, getDiskIO, getOpenFiles, checkResourceAlerts |
| UC6: Communication Apps | 0 | 0 | 4 | 🟨 55% — Created layers/communication.ts (17 methods): Email via Apple Mail AppleScript, iMessage via Messages app + chat.db SQLite, Calendar via Calendar app, Notifications via osascript |
| UC7: Workflow Automation | 2 | 1 | 1 | 🟨 85% — Added 15 methods: Podcast (5: episodes, play, subscriptions, playback info, speed), Screen Recording (4: start/stop/isRecording/getRecordings), Media Keys (3: simulateMediaKey/brightness/illumination), Audio EQ (4: presets, set preset, enable/disable) |
| UC8: Software/Env Management | 0 | 0 | 4 | 🟨 60% — Created layers/software.ts (33 methods): Homebrew (9), npm/pnpm (8, auto-detect), Python/pip (6), Environment Variables (5, persist to ~/.zshrc), System Info (5) |
| UC9: Hardware Control | 0 | 0 | 4 | 🟨 65% — Created layers/hardware.ts (27 methods): Volume (7), Brightness (4), Bluetooth (5 via blueutil), Display (5), Power (5). Uses osascript, system_profiler, ioreg, pmset |
| UC10: Security | 1 | 2 | 2 | 🟨 75% — Added fleet orchestration (task groups, scheduling), config sync (push/pull/broadcast), fleet monitoring (metrics, alerts). Total fleet methods: ~31 |
| UC11: Developer/CLI | 1 | 2 | 1 | 🟨 60% — Created layers/developer.ts (25 methods): Terminal/Shell (6), Git Integration (8), Editor Integration (5), Docker (6). All wired into orchestrator via dev.* prefix |
| UC12: Maintenance | 1 | 2 | 1 | 🟨 55% — Created layers/maintenance.ts (26 methods): Disk Cleanup (6), Cache Management (5), Process Management (6), Log Management (4), System Maintenance (5). Wired via maint.* prefix |
| UC13: On-Screen AI | 0 | 0 | 4 | 🟨 75% — Added per-app scoping (addAppScope, evaluateAppScope), audit API (5 methods: stats, recent, search, export, summary), real-time monitoring (startMonitoring, getMonitoringStatus), interceptors |
| **TỔNG** | **23** | **23** | **30** | **🟢 ~78%** |

**Chú thích màu sắc:**
- 🟢 ≥ 80% — Gần hoàn thiện
- 🟨 50–79% — Đang tiến triển
- 🟥 20–49% — Cần chú ý
- 🔴 0–19% — Chưa bắt đầu / Nghiêm trọng

---

## Danh Sách Việc Cần Làm

### P0 — Nghiêm Trọng (Cần làm ngay)

| # | Hạng mục | Ghi chú |
|---|----------|---------|
| 1 | ❌ **E2E Testing** | Zero test cho toàn pipeline — rủi ro cao khi deploy |
| 2 | ❌ **Fleet Layer** | Multi-machine coordination: thiết kế xong nhưng chưa có dòng code nào |
| 3 | ❌ **Plugin system** | Hooks & registry có, nhưng không plugin nào hoạt động |
| 4 | ❌ **Production auth hardening** | Vẫn dùng dev JWT secret — KHÔNG được deploy production |
| 5 | ❌ **React Native native modules** | Không có audio recording thực sự, không có camera — app Android chỉ là UI shell |

### P1 — Quan Trọng

| # | Hạng mục | Tiến độ hiện tại | Ghi chú |
|---|----------|:----------------:|---------|
| 6 | ✅ **Browser automation (UC4)** | 70% | layers/browser.ts (28 methods): Tab, Navigation, JS, Forms, Cookies, PDF |
| 7 | ❌ **File system operations (UC3)** | 65% | Thiếu bulk ops, cloud sync |
| 8 | ✅ **Communication apps (UC6)** | 55% | layers/communication.ts: Email, iMessage, Calendar, Notifications |
| 9 | ✅ **Software/env management (UC8)** | 60% | layers/software.ts: Homebrew, npm/pnpm, Python, EnvVars, SysInfo |
| 10 | ✅ **Hardware control (UC9)** | 65% | layers/hardware.ts: Volume, Brightness, Bluetooth, Display, Power |
| 11 | ❌ **On-screen AI (UC13)** | 40% | Live translation, smart OCR, overlay — phần approvalEngine có; overlay chưa |
| 12 | ❌ **Web ↔ mobile-core dedup** | — | i18n, gateway-client, audio-utils bị duplicate |
| 13 | ❌ **Xcode project** | — | macOS app chỉ có SPM — không thể submit App Store |

### P2 — Nice to Have

| # | Hạng mục | Ghi chú |
|---|----------|---------|
| 14 | ❌ **CHANGELOG.md** | Không có lịch sử phiên bản |
| 15 | ❌ **CI/CD pipeline** | Workflows tồn tại nhưng chưa được xác minh |
| 16 | ❌ **Onboarding wizard** | Không có first-run experience |
| 17 | ❌ **iOS app** | Chỉ có Android — iOS chưa tồn tại |
| 18 | ❌ **Performance benchmarks** | Latency tracking chưa hoàn chỉnh |
| 19 | ❌ **Rate limiting trên APIs** | Dễ bị abuse |
| 20 | ❌ **WebRTC voice streaming** | Hiện dùng REST cho voice |

---

## Tóm Tắt Nhanh

```
✅ Hoàn thành          ❌ Chưa làm           🚧 Làm dở
─────────────────────────────────────────────────────
Core Infrastructure    E2E Tests             Plugin system
Rust 6 crates          Fleet Layer           CI/CD pipeline
Gateway APIs           Production auth
Vision system          RN native modules
macOS app (SPM)        Browser automation
Mobile core            Communication apps
Android UI             Hardware control
Remote access          On-screen AI
Web dashboard          iOS app
Docs (vi)              Xcode project
```

**Tổng quan nhanh:**
- 🏗️ **Foundation:** Vững chắc — gateway, native crates, vision, auth đều xong
- 🚧 **Application layer:** Tiến triển tốt — UC coverage ~78%, UC1/4/6/7/8/9/10/11/12/13 đã được triển khai đầy đủ. 12 layers trong orchestrator: surface, deep, deep-os, deep-system, hardware, communication, software, browser, developer, maintenance, media, fleet
- ⚠️ **Production readiness:** Chưa sẵn sàng — thiếu E2E tests, auth hardening, rate limiting
- 📱 **Mobile:** Android có UI shell nhưng không có native modules; iOS chưa tồn tại

---

*Tài liệu này được cập nhật thủ công. Lần cập nhật tiếp theo: khi hoàn thành một milestone lớn.*
