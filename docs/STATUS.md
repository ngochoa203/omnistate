# OmniState — Trạng Thái Dự Án

> **Cập nhật lần cuối:** 2026-04-13
> **Phiên bản tài liệu:** 1.0

---

## Tổng Quan

**OmniState** ("Shadow OS") là một AI agent cá nhân chạy trên macOS, hoạt động hoàn toàn tự chủ — hiểu màn hình qua thị giác máy tính, điều khiển bằng giọng nói, và thực thi tác vụ trực tiếp trên hệ điều hành.

| Thông tin | Chi tiết |
|-----------|----------|
| **Mục tiêu** | AI agent tự chủ cho macOS (Shadow OS) |
| **Nền tảng** | macOS (primary), Android (secondary), iOS (planned) |
| **Tech stack** | Rust + Node.js (gateway) + Swift (macOS app) + React Native (mobile) |
| **Tiến độ tổng thể** | ~45% hoàn thiện |
| **Use case coverage** | 30% (23/76 items hoàn chỉnh) |

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

> Nguồn: audit 91 items, cập nhật 2026-04-13

| Use Case | Hoàn chỉnh | Một phần | Thiếu | Tiến độ |
|----------|:----------:|:--------:|:-----:|:-------:|
| UC1: GUI & Peripherals | 7 | 5 | 2 | 🟨 50% |
| UC2: Window/App Management | 4 | 2 | 1 | 🟨 57% |
| UC3: File System Operations | 3 | 3 | 2 | 🟥 38% |
| UC4: Browser Automation | 2 | 3 | 2 | 🟥 29% |
| UC5: System & Network | 2 | 3 | 2 | 🟥 29% |
| UC6: Communication Apps | 0 | 0 | 4 | 🔴 0% |
| UC7: Workflow Automation | 2 | 1 | 1 | 🟨 50% |
| UC8: Software/Env Management | 0 | 0 | 4 | 🔴 0% |
| UC9: Hardware Control | 0 | 0 | 4 | 🔴 0% |
| UC10: Security | 1 | 2 | 2 | 🟥 20% |
| UC11: Developer/CLI | 1 | 2 | 1 | 🟥 25% |
| UC12: Maintenance | 1 | 2 | 1 | 🟥 25% |
| UC13: On-Screen AI | 0 | 0 | 4 | 🔴 0% |
| **TỔNG** | **23** | **23** | **30** | **🟥 30%** |

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
| 6 | ❌ **Browser automation (UC4)** | 29% | Thiếu form filling, session management |
| 7 | ❌ **File system operations (UC3)** | 38% | Thiếu bulk ops, cloud sync |
| 8 | ❌ **Communication apps (UC6)** | 0% | Email, messaging, calendar — chưa có gì |
| 9 | ❌ **Software/env management (UC8)** | 0% | Package manager, env vars, dependencies |
| 10 | ❌ **Hardware control (UC9)** | 0% | Volume, brightness, Bluetooth, displays |
| 11 | ❌ **On-screen AI (UC13)** | 0% | Live translation, smart OCR, overlay |
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
- 🚧 **Application layer:** Đang dang dở — UC coverage chỉ 30%
- ⚠️ **Production readiness:** Chưa sẵn sàng — thiếu E2E tests, auth hardening, rate limiting
- 📱 **Mobile:** Android có UI shell nhưng không có native modules; iOS chưa tồn tại

---

*Tài liệu này được cập nhật thủ công. Lần cập nhật tiếp theo: khi hoàn thành một milestone lớn.*
