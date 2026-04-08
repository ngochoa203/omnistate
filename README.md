# OmniState

> Shadow OS — an invisible system administrator that autonomously operates your computer.

OmniState is a personal AI agent that lives inside your computer 24/7. You give it tasks in natural language, and it autonomously sees the screen, moves the mouse, types on the keyboard, and manages the system end-to-end — just like a real human operator.

## What makes it different?

| Feature | Existing tools | OmniState |
|---------|---------------|-----------|
| UI changes | Scripts break when buttons move | Vision-based — finds elements by meaning |
| Error handling | Freeze and wait for human | Self-diagnoses, retries with alternative strategies |
| Cross-app workflows | Need APIs for each app | Works on ANY app with a GUI |
| Background work | Fights for mouse/keyboard | Operates in invisible virtual desktops |
| System depth | Surface-level only | Deep OS integration — firewall, GPU framebuffer, processes |

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
│  │Deep Layer│ │Surface   │ │Fleet     │    │
│  │(Rust/OS) │ │Layer     │ │Layer     │    │
│  │          │ │(Vision+  │ │(Multi-   │    │
│  │          │ │ Input)   │ │ Machine) │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│  Session Store │ Health Monitor │ Plugins    │
└─────────────────────────────────────────────┘
```

**Three execution layers:**
- **Deep Layer** — Direct OS APIs via Rust (screen capture, input, processes, network)
- **Surface Layer** — Vision-based UI interaction (screenshot → AI analysis → mouse/keyboard)
- **Fleet Layer** — Multi-machine coordination over Tailscale/WireGuard

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Gateway / Orchestrator | TypeScript (ESM) + Node.js 22+ |
| Screen Capture | Rust — IOSurface (macOS), DXGI (Windows), XCB (Linux) |
| Input Control | Rust — CGEvent (macOS), SendInput (Windows), XTest (Linux) |
| Accessibility | Rust — AXUIElement (macOS), UIAutomation (Win), AT-SPI2 (Linux) |
| TS ↔ Rust Bridge | napi-rs |
| Vision / LLM | Claude Computer Use, GPT-4V, local OCR |
| State Storage | JSON + JSONL files |
| Fleet Transport | Tailscale / WireGuard |

## Project Structure

```
omnistate/
├── crates/                     # Rust workspace
│   ├── omnistate-core/         # Shared types & traits
│   ├── omnistate-screen/       # Screen capture (per-platform)
│   ├── omnistate-input/        # Mouse & keyboard control
│   ├── omnistate-a11y/         # Accessibility tree
│   └── omnistate-napi/         # N-API bridge → Node.js
├── packages/
│   └── gateway/                # TypeScript gateway
│       └── src/
│           ├── gateway/        # WebSocket server
│           ├── planner/        # Intent → State Graph (DAG)
│           ├── executor/       # Queue, retry, verify
│           ├── layers/         # Deep, Surface, Fleet
│           ├── vision/         # Claude/GPT-4V + local OCR
│           ├── health/         # System monitoring & repair
│           ├── session/        # Persistent state
│           └── plugin/         # Plugin system
└── docs/                       # Architecture documentation
```

## Quick Start

```bash
# Prerequisites: Node.js 22+, Rust, pnpm
git clone https://github.com/ngochoa203/omnistate.git
cd omnistate

# Install dependencies
pnpm install

# Build Rust crates
cargo build

# Build TypeScript
pnpm build

# Run gateway
pnpm dev
```

## Use Cases

| UC | Name | Description |
|----|------|-------------|
| UC-1 | Visual UI Interaction | See the screen, understand UI elements, operate mouse/keyboard |
| UC-2 | Deep System Administration | Terminal, firewall, GPU framebuffer, virtual desktops |
| UC-3 | Self-Healing Maintenance | Monitor health, auto-diagnose, auto-repair 24/7 |
| UC-4 | Complex Task Orchestration | Chain apps, personalize, fleet-scale operations |

## Documentation

Architecture docs (Vietnamese): [`docs/vi/`](docs/vi/)

## License

MIT
