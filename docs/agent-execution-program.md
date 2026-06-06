# OmniState Agent Execution Program

## Objective

Turn OmniState into a reliable macOS AI agent that can:

- Observe the active screen and application state.
- Plan multi-step actions safely.
- Execute mouse, keyboard, browser, and app actions through native primitives.
- Verify every step and recover when state diverges.
- Run efficiently as a CLI-first and Swift `.app`-assisted system.

## Principles

- Native-first: prefer Rust capture/input/a11y and Swift app services over AppleScript-heavy flows.
- Small core: keep the product centered on perception, planning, actuation, verification, and power policy.
- Verify every action: no success without post-action state validation.
- Low-power by default: on-demand sensing, event-driven wakeups, and tiered runtime modes.
- Production honesty: remove or de-prioritize fake breadth and placeholder capability.

## Core Runtime Modes

### Idle

- No continuous heavy capture.
- No VLM/OCR loops.
- Health checks reduced to coarse intervals.
- Swift app stays resident for permissions, wake, and gateway supervision.

### Listening

- Voice and trigger listeners active.
- Lightweight app/screen context only.
- Promotion to active mode only after a task is accepted.

### Active

- Perception loop enabled.
- Planner and executor allowed to run multi-step tasks.
- Verification after every state-changing action.

### Recovery

- Triggered on permission loss, task divergence, app crash, or wake-from-sleep.
- Re-sync focused app, active window, screen context, and gateway state.

## Delivery Phases

## Phase 1: Reliable Core Loop

### Goal

Establish a trustworthy `sense -> plan -> act -> verify` loop for a narrow set of high-value tasks.

### Functions

- Open/focus app.
- Read active window/app context.
- Find UI element by accessibility or vision fallback.
- Click, type, press shortcut.
- Verify state transition after every action.

### Primary modules

- `packages/gateway/src/planner/*`
- `packages/gateway/src/executor/*`
- `packages/gateway/src/vision/*`
- `packages/gateway/src/layers/surface.ts`
- `packages/gateway/src/layers/ui-automation.ts`
- `crates/omnistate-capture/*`
- `crates/omnistate-input/*`
- `crates/omnistate-a11y/*`

### Exit criteria

- CLI can execute deterministic tasks on a real macOS machine.
- Every action returns a verification result, not only an execution result.
- Failed verification produces retry or explicit failure.

### Validation

- `pnpm test:gateway`
- `cargo test -p omnistate-capture -p omnistate-input -p omnistate-a11y`
- Manual smoke flows on macOS:
  - open app
  - focus window
  - click input
  - type text
  - verify visible result

## Phase 2: Website Autopilot

### Goal

Enable controlled browser and web-app execution against visible UI, not only brittle scripts.

### Functions

- Read visible browser state.
- Locate CTA, input, form, navigation targets.
- Execute website test plans step by step.
- Re-check DOM-visible or screen-visible outcomes.

### Primary modules

- `packages/gateway/src/layers/browser.ts`
- `packages/gateway/src/hybrid/automation-browser.ts`
- `packages/gateway/src/vision/*`
- `e2e/browser-automation.spec.ts`

### Exit criteria

- System can open a website, identify target controls, fill a form, submit, and verify outcomes.
- Browser tasks prefer a real perception loop over special-case YouTube shortcuts.

### Validation

- `pnpm test:e2e`
- New browser smoke tests for:
  - login form
  - search input
  - navigation click
  - modal close
  - failed selector recovery

## Phase 3: Swift App Productionization

### Goal

Make the Swift app the lightweight macOS resident supervisor for permissions, launch lifecycle, and idle/wake resilience.

### Functions

- Launch at login.
- Menu bar resident mode.
- Permission bootstrap and recovery UX.
- Gateway supervision and restart policy.
- Sleep/wake handling and runtime re-sync.

### Primary modules

- `apps/macos/OmniState/OmniState/Services/*`
- `apps/macos/OmniState/OmniState/Views/*`

### Exit criteria

- App can survive launch, sleep, wake, and gateway restart without manual repair.
- App can keep the system mostly idle when no task is active.

### Validation

- Swift build and app smoke:
  - `swift build --package-path apps/macos/OmniState`
  - manual login launch test
  - manual sleep/wake recovery test
  - permission denied/re-grant flow

## Phase 4: Power And Resource Policy

### Goal

Reduce battery drain and background churn while keeping responsiveness acceptable.

### Functions

- Tiered polling policy.
- Suspend heavy vision when idle.
- On-demand capture instead of continuous capture where possible.
- Degrade gracefully on thermal or battery pressure.

### Primary modules

- `packages/gateway/src/health/*`
- `packages/gateway/src/layers/deep-os*.ts`
- `packages/gateway/src/layers/deep-system*.ts`
- `apps/macos/OmniState/OmniState/Services/HealthChecker.swift`
- `apps/macos/OmniState/OmniState/Services/NetworkMonitor.swift`

### Exit criteria

- Idle CPU and memory baselines are measured and reduced.
- Heavy perception tasks only run during active execution windows.

### Validation

- Idle vs active resource benchmark runs.
- Thermal and battery-pressure behavior smoke tests.

## Phase 5: Native Deepening

### Goal

Broaden reliable macOS-native control without crossing into unstable kernel/private-API dependence.

### Functions

- Better accessibility tree fusion with vision.
- Multi-monitor coordinate normalization.
- Richer system observability from safe user-space APIs.
- More robust app/window/menu traversal.

### Primary modules

- `crates/omnistate-*`
- `packages/gateway/src/layers/deep-os*.ts`
- `packages/gateway/src/layers/deep-system*.ts`

### Exit criteria

- Native control surface is stronger than AppleScript fallback for common tasks.
- User-space observability is good enough for recovery and planning.

## Phase 6: Experimental Deep-Mac Features

### Goal

Isolate risky or uncertain work such as fan control, private sensors, and other low-level experiments.

### Rules

- Keep out of the core runtime.
- Mark clearly as experimental.
- Require explicit validation on target hardware and macOS version.

## Lane Ownership

### Claude Code lanes

- Planner/executor lane.
- Native capture/input/a11y lane.
- Swift app lane.
- Testing/reliability lane.
- Power/deep-mac feasibility lane.

### Codex lanes

- Architecture synthesis lane.
- Test-matrix synthesis lane.
- Productization/review lane.
- Main orchestrator lane for final integration and direction.

## First-Wave Implementation Backlog

1. Shrink browser and UI automation into a native-first path with verification.
2. Add a single action result contract that includes execution and verification status.
3. Add deterministic smoke tests for macOS core actions.
4. Harden Swift app lifecycle for permission recovery and gateway supervision.
5. Introduce runtime power states and disable heavy sensing while idle.
6. Move risky deep-mac ideas behind an experimental boundary.

## Non-Goals For The Core Path

- Kernel extensions as a default architecture.
- Private API dependence in the main runtime.
- Broad tool-layer coverage that cannot be verified on a real machine.
- Claiming support for automation paths that are only placeholders.
