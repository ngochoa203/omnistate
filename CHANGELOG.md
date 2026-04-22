# Changelog

All notable changes to OmniState are documented here.

## [Unreleased]

### Added
- **E2E Test Suite** — 36 tests across 10 sections (WebSocket, HTTP, auth, device, rate limit, task, config)
- **Sample Plugin** — `system-health` plugin with CPU/memory/disk/thermal monitoring + repair
- **React Native Native Modules** — AudioRecorder + CameraCapture (3-layer: real/guard/mock)
- **iOS App** — Full iOS native layer (Xcode project, Podfile, AppDelegate, LaunchScreen)
- **Onboarding Wizard** — 5-step first-run modal (Welcome, Permissions, Voice, Remote, Complete)
- **WebRTC Voice Streaming** — VoiceStreamManager with WebSocket binary audio, STT, TTS
- **Performance Benchmarks** — 6 benchmarks with p50/p95/p99 percentiles
- **CI/CD Pipeline** — GitHub Actions ci.yml + release.yml (lint, test, swift, rust, multi-platform napi)
- **Xcode Project** — XcodeGen project.yml for macOS App Store submission

### Changed
- **Web ↔ Mobile-Core Dedup** — i18n, protocol (274→5 lines), audio-utils unified via @omnistate/shared
- **Production Cleanup** — removed 18 audit files, 2 dead scripts, 8 duplicate npm scripts
- **Root Scripts** — standardized to `app:*` prefix pattern, removed duplicates
- **.gitignore** — added .cursor/, .claude/, .pytest_cache/, removed stray `pipefail`
- **Dependencies** — removed duplicate @omnistate/shared from android, added typescript to mobile-core
- **Configs** — added .prettierrc, eslint.config.mjs

### Previously added (in this release cycle)
- **12 Execution Layers** wired into orchestrator with prefix-based routing
  - `surface.ts` (57 methods) — GUI control, OCR, keyboard, window management, drag-drop
  - `deep.ts` (47 methods) — File I/O, process management, shell, app launching, system info
  - `deep-os.ts` (84 methods) — App lifecycle, window management, system snapshots
  - `deep-system.ts` (107 methods) — Network, power, clipboard, security, CPU/memory/thermal monitoring
  - `browser.ts` (47 methods) — Tab/nav/JS/forms/cookies, headless CDP, downloads, bookmarks, history
  - `communication.ts` (40 methods) — Email, iMessage, Calendar, Notifications, Contacts, FaceTime, Reminders, Notes
  - `media.ts` (42 methods) — Music/Spotify, Playlists, AirPlay, Video, Podcast, Screen Recording, Media Keys, EQ
  - `hardware.ts` (45 methods) — Volume, Brightness, Bluetooth, Display, Power, Keyboard backlight, USB, WiFi
  - `software.ts` (45 methods) — Homebrew/Cask, npm/pnpm, pip, env vars, version managers, app discovery
  - `developer.ts` (25 methods) — Terminal, Git, Editor integration, Docker
  - `maintenance.ts` (26 methods) — Disk cleanup, cache, process, log, system maintenance
  - `fleet.ts` (34 methods) — Device discovery, task distribution, file sync, mesh networking, WoL
- **Permission System** — ApprovalEngine with blocklist/allowlist, per-app scoping, sandbox profiles, policy templates (strict/moderate/permissive), audit API, real-time monitoring, interceptors
- **Rate Limiting** — Sliding window rate limiter on all HTTP endpoints (100 req/15min general, 10 req/15min auth)
- **JWT Secret Hardening** — Auto-generates secure 48-byte secret on first run, persists to `~/.omnistate/jwt-secret` (chmod 600)
- **Tailscale Remote Access** — Device registration with 30-day JWT + 90-day refresh, LAN PIN pairing, network info API
- **Android App** — 6 screens (Connect, Dashboard, Chat, Voice, Triggers, Settings), persistent connection store, remote mode
- **macOS Menu Bar** — Network info, Remote Access PIN, Paired Devices with revoke

### Infrastructure
- 6 Rust native crates (capture, screen, input, a11y, core, napi)
- SQLite with 6 migrations
- WebSocket server (port 19800) + HTTP API (port 19801)
- DAG orchestrator with retry + resource tracking
- Vision system: 4-layer detection (fingerprint → a11y → OCR → Claude Vision)

## [0.1.0] — 2026-03-15

### Added
- Initial project scaffold
- Gateway daemon with WebSocket protocol
- Rust native bindings via N-API
- Web dashboard (Vite SPA)
- macOS app (Swift/SPM)
- CLI client
