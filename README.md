# OmniState

> Personal AI agent that operates your macOS computer autonomously — vision-based screen understanding, voice control, and deep OS integration.

## Architecture

```
User (natural language command)
    │
    ▼
┌─────────────────────────────────────────────┐
│              OMNISTATE GATEWAY               │
│                                              │
│  Command Router → Task Planner → Queue       │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │  Deep    │ │ Surface  │ │  Fleet   │    │
│  │  Layer   │ │  Layer   │ │  Layer   │    │
│  │ (Rust/OS)│ │(Vision + │ │  (Multi- │    │
│  │          │ │ Input)   │ │ Machine) │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│   Session Store │ Health Monitor │ Plugins   │
└─────────────────────────────────────────────┘
```

**Three execution layers:**
- **Deep Layer** — Direct OS APIs via Rust (screen capture, input, accessibility tree)
- **Surface Layer** — Vision-based UI interaction (screenshot → AI analysis → mouse/keyboard)
- **Fleet Layer** — Multi-machine coordination over Tailscale

## Project Structure

```
omnistate/
├── crates/              # Rust native bindings (N-API)
│   ├── omnistate-core/     # Shared error types
│   ├── omnistate-capture/  # ScreenCaptureKit + IOSurface GPU capture
│   ├── omnistate-screen/   # CGDisplay fallback capture
│   ├── omnistate-input/    # CGEvent mouse/keyboard control
│   ├── omnistate-a11y/     # AXUIElement accessibility tree
│   └── omnistate-napi/     # N-API bridge to TypeScript
├── packages/
│   ├── gateway/         # Node.js daemon (WebSocket + HTTP)
│   ├── web/             # Vite SPA dashboard
│   ├── shared/          # Protocol types + auth types
│   ├── mobile-core/     # Cross-platform mobile logic
│   └── cli/             # CLI client
├── apps/
│   ├── macos/           # Swift/SPM native wrapper
│   └── android/         # React Native companion app
└── docs/
    ├── vi/              # Architecture docs (Vietnamese)
    ├── audits/          # Use case audits
    ├── plan.md          # Current phase plan
    └── STATUS.md        # Implementation status
```

## Quick Start (Non-Tech Friendly)

### 1) Clone and setup once

**Prerequisites:** Node.js 22+, pnpm.

```bash
git clone https://github.com/ngochoa203/omnistate.git
cd omnistate
pnpm app:init
pnpm app:config
```

Then open `.env` and add your API key (`ANTHROPIC_API_KEY=...`).

### 2) Build the app you need

```bash
# Web dashboard
pnpm app:build:web

# macOS native app (SwiftUI)
pnpm app:build:macos

# Android companion app (requires Android Studio/SDK)
pnpm app:build:android

# iOS companion app (requires Xcode)
pnpm app:build:ios
```

### 3) Run local dev stack (gateway + web)

```bash
pnpm run:all
```

### Useful aliases

```bash
pnpm app:quickstart   # init + config + build web
pnpm app:run:macos    # package and open OmniState.app
pnpm app:build:gateway
pnpm app:build:cli
```

**Run tests:**
```bash
pnpm test
pnpm lint
```

## Key Features

- Vision-based UI understanding (not fragile scripts)
- Zero-copy GPU screen capture (ScreenCaptureKit + IOSurface)
- 4-priority element detection (fingerprint → a11y → OCR → Claude Vision)
- Voice identity via SpeechBrain ECAPA-TDNN
- Tailscale remote access for cross-network control
- Auto-permission handling for Claude Code integration
- 9-language i18n support

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Native | Rust, napi-rs, Core Graphics, ScreenCaptureKit |
| Gateway | TypeScript, Node.js 22, better-sqlite3, tesseract.js |
| Web | Vite, TypeScript, WebSocket |
| macOS | Swift, SwiftUI, WKWebView, SPM |
| Android | React Native, Zustand, TypeScript |

## CLI

| Command | Description |
|---------|-------------|
| `omnistate start [--port <n>]` | Start the gateway daemon |
| `omnistate run "<command>"` | Send a task to the running gateway |
| `omnistate status` | Show gateway status and active tasks |
| `omnistate health` | Run a full system health check |
| `omnistate stop` | Gracefully shut down the gateway |

## Documentation

- [Architecture (Vietnamese)](docs/vi/README.md)
- [Implementation Status](docs/STATUS.md)
- [Current Plan](docs/plan.md)
- [Use Case Audits](docs/audits/)

## License

MIT
