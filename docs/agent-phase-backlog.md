# OmniState Phase Backlog

## Phase 0: Refocus The Repo

### Objective

Reduce the repo from broad, partially real capability into a reliable macOS agent core.

### Scope

- Keep `apps/macos/OmniState` as the host.
- Keep `packages/gateway` as the runtime core.
- Keep `crates/omnistate-{capture,a11y,input,napi}` as the native substrate.
- Treat `packages/web` as a debug and ops console.
- De-prioritize `apps/mobile`, `packages/mobile-core`, and non-critical web panels.

### Immediate tasks

1. Define and enforce the 5 core domains:
   - `perception`
   - `planning`
   - `actuation`
   - `verification`
   - `power-management`
2. Mark non-core layers and product surfaces as optional or deprecated.
3. Narrow the CLI and protocol to the macOS-first path.

### Key files

- `packages/gateway/src/index.ts`
- `packages/gateway/src/gateway/*`
- `packages/gateway/src/planner/*`
- `packages/gateway/src/executor/*`
- `packages/gateway/src/vision/*`
- `packages/gateway/src/health/*`
- `packages/shared/src/protocol.ts`

## Phase 1: Reliable Sense-Plan-Act-Verify

### Objective

Make the system able to execute narrow, deterministic UI tasks and verify the outcome.

### Function groups

#### Perception

- Unify native screen perception behind one primary API.
- Prefer `omnistate-capture` over duplicate capture paths.
- Add a persistent OCR bridge or equivalent low-overhead text extraction path.

#### Planning

- Narrow planning to the macOS core actions.
- Reduce raw `shell.exec` usage for common UI tasks.
- Add step contracts with expected verification state.

#### Actuation

- Prefer native input primitives from `omnistate-input`.
- Reduce AppleScript-only interaction paths when native input or AX action exists.
- Add retry/backoff around unstable UI actions.

#### Verification

- Require post-action verification.
- Add explicit `passed/confidence/description` result on every UI step.
- Block success reporting when verification fails.

### Immediate tasks

1. Introduce a single action result contract carrying both execution and verification status.
2. Add an action sequencer for multi-step plans with retry/backoff.
3. Add post-action verification capture and timeout handling.
4. Narrow planner outputs to actions that the runtime can truly verify.

### Key files

- `packages/gateway/src/planner/planning.ts`
- `packages/gateway/src/planner/intent.ts`
- `packages/gateway/src/executor/orchestrator.ts`
- `packages/gateway/src/vision/engine.ts`
- `packages/gateway/src/layers/surface.ts`
- `packages/gateway/src/layers/ui-automation.ts`

## Phase 2: Browser And Website Autopilot

### Objective

Control websites from visible state, not from brittle one-off scripts.

### Function groups

- Open site and identify active browser state.
- Locate visible inputs, buttons, links, tabs, and modals.
- Execute a stepwise site test plan.
- Verify URL, visible text, or DOM/AX state transitions.

### Immediate tasks

1. Replace special-case browser shortcuts with a generic browser action loop.
2. Add proper browser context support where native accessibility is insufficient.
3. Expand e2e coverage around website task execution.

### Key files

- `packages/gateway/src/layers/browser.ts`
- `packages/gateway/src/hybrid/automation-browser.ts`
- `e2e/browser-automation.spec.ts`

## Phase 3: Swift App Hardening

### Objective

Make the Swift app a lightweight and resilient resident supervisor.

### Function groups

- Menu bar and launch lifecycle.
- Permission bootstrap and permission recovery UX.
- Gateway supervision.
- Sleep/wake and reconnect behavior.
- Low-power and low-battery behavior.

### Immediate tasks

1. Add sleep/wake observers and reconnect logic.
2. Add `LSUIElement`-style menu-bar-first behavior.
3. Add launch-at-login support.
4. Add fault state after repeated gateway restart failures.
5. Add permission status UI and recovery actions.

### Key files

- `apps/macos/OmniState/OmniState/AppDelegate.swift`
- `apps/macos/OmniState/OmniState/Info.plist`
- `apps/macos/OmniState/OmniState/Services/GatewayManager.swift`
- `apps/macos/OmniState/OmniState/Services/GatewaySocketClient.swift`
- `apps/macos/OmniState/OmniState/Services/PermissionBootstrapper.swift`

## Phase 4: Power And Battery Optimization

### Objective

Keep the system mostly asleep when not needed.

### Function groups

- Idle and active runtime modes.
- Throttled health/network checks.
- Low Power Mode adaptation.
- Thermal and battery awareness.

### Immediate tasks

1. Add runtime power states.
2. Reduce polling when idle or in Low Power Mode.
3. Add energy-impact observability.
4. Keep heavy vision/capture off unless a task is active.

### Key files

- `packages/gateway/src/health/sensors.ts`
- `packages/gateway/src/layers/deep-system-display.ts`
- `packages/gateway/src/layers/deep-system-power.ts`
- `packages/gateway/src/layers/deep-os-kernel.ts`
- `apps/macos/OmniState/OmniState/Services/HealthChecker.swift`
- `apps/macos/OmniState/OmniState/Services/NetworkMonitor.swift`

## Phase 5: Test And Reliability Program

### Objective

Build the test surface missing from the actual product path.

### Immediate tasks

1. Add CLI tests.
2. Add native N-API smoke tests.
3. Add Swift XCTest coverage for critical services.
4. Unskip voice e2e coverage.
5. Add permission, idle, sleep/wake, and power behavior tests.

### Key files

- `packages/cli/src/cli.ts`
- `packages/gateway/src/__tests__/*`
- `packages/gateway/src/voice/__tests__/*`
- `packages/web/test/*`
- `e2e/voice-flow.spec.ts`
- `e2e/browser-automation.spec.ts`

## Phase 6: Experimental Deep-mac Features

### Objective

Keep risky low-level ambitions out of the product core.

### Allowed in experimental only

- Fan write control.
- Private SMC or GPU power manipulation.
- Kernel-extension-dependent behavior.
- Any feature that requires SIP-off assumptions.

### Safe user-space targets

- Battery, thermal pressure, and energy observability.
- `pmset`-based power policy.
- `screencapture` or ScreenCaptureKit-based public capture paths.

## Implementation Lanes

### Claude Code lanes

- Lane A: gateway planner/executor consolidation.
- Lane B: native capture/input/a11y integration.
- Lane C: Swift app lifecycle and permissions.
- Lane D: testing and CI/nightly matrix.
- Lane E: power/deep-mac feasibility and safe observability.

### Codex lanes

- Lane P: architecture synthesis and scope cutting.
- Lane T: system testcase design.
- Lane R: productization and sprawl review.
- Lane O: final orchestration and patch integration.

## First Execution Wave

1. Refocus the runtime around 5 core domains.
2. Add the verification-bearing action contract.
3. Harden the Swift app lifecycle for sleep/wake and permission recovery.
4. Add the missing QA surface for CLI, Swift services, and macOS behavior.
