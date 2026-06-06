# OmniState Execution Plan

## Goal

Drive the repo from current audit state to a working macOS-first agent milestone with meaningful end-to-end validation.

## Rules For This Plan

- Update this file whenever a phase advances, blocks, or reveals follow-up work.
- Record both implemented work and recommended later work.
- Keep the mainline focused on a real macOS agent path, not demo breadth.

## Mainline Guardrails

- Do not add new demo-facing surfaces unless they directly improve the macOS agent path.
- Prefer deleting or flagging ambiguous capability surfaces over keeping optimistic placeholders.
- Every new action path must define:
  - capability owner
  - contract
  - verifier
  - test location
  - honest unsupported behavior

## Current Status

### Phase 0: Execution Setup

- Status: done
- Outcome target: establish the implementation program, lock priorities, and prevent fake success paths.

### Phase 1: Product Honesty

- Status: done
- Done:
  - Removed fallback script stub generation when no LLM is available.
  - Tightened Claude vision verification so plain-text success claims do not count as verified state.
  - Added regression coverage for those guards.
  - Narrowed shell-first planner paths (Workstream B).
- Remaining:
  - Replace or explicitly gate fake capability surfaces.

### Phase 2: macOS Runtime Packaging

- Status: done (bundled runtime checkpoint reached)
- Outcome target: the macOS app launches a self-contained runtime instead of relying on dev-machine assumptions.

### Phase 2.5: Capability Contracts

- Status: in progress (shared contract registry + transport refs landed)
- Outcome target: every shipped capability has a contract for input schema, execution path, verification method, failure mode, confidence policy, and observability hooks.
- Deliverables:
  - `capabilities/*.yaml` or `packages/shared/src/capability-contracts.ts`
  - capability matrix with `implemented`, `experimental`, `unsupported`, `flagged`
  - per-capability test requirements across unit, gateway integration, and E2E
- Success criteria:
  - no capability is exposed as shipped without a valid contract
  - planner routes only into capabilities with a valid contract
  - UI can render capability status honestly

### Phase 3: Reliable Agent Core

- Status: in progress (typed verification transport landed; final verifier policy still incomplete)
- Outcome target: typed macOS action path with verification-bearing execution results.

### Phase 3.5: Desktop Safety Rails

- Status: not started
- Outcome target: typed action execution has risk scoring, confirmation policy, and auditability for desktop-sensitive actions.
- Success criteria:
  - destructive shell-backed paths do not run silently
  - risk level is surfaced in logs, UI, and tests
  - dangerous actions have bounded confirmation policy

### Phase 4: E2E Milestone

- Status: done (stack-backed checkpoint reached)
- Outcome target: meaningful browser/macOS automation flow runs with a real or realistic harness.
- Changes made (Workstream C):
  - `e2e/browser-automation.spec.ts`: fixed hardcoded port 8080 -> 19800 (gateway default)
  - `e2e/browser-automation.spec.ts`: rewired browser coverage to the real WebSocket `task` protocol instead of the nonexistent `intent` message shape.
  - `e2e/browser-automation.spec.ts`: replaced fake Chromium-page assertions with gateway-task and macOS process verification.
  - `e2e/voice-flow.spec.ts`: rewrote placeholder UI checks into live stack-backed smoke tests for gateway health, deterministic TTS negative-path behavior, and the default auth gate.
  - `e2e/voice-flow.spec.ts`: added waitForGateway() and waitForWeb() helpers that probe health endpoints.
  - `scripts/dev/e2e-setup.mjs`: new helper that builds gateway, starts gateway + web dev server, waits for readiness, then exits or keeps running with --watch
  - `scripts/dev/run-all.mjs`: aligned web port to `5173` so docs, Playwright, and runtime launch path agree.
  - `packages/gateway/src/layers/browser.ts`: Safari `newTab(url)` now uses `open location` instead of the blocking AppleScript tab-creation path.
  - Playwright chromium installed (was missing at start of workstream)
  - `packages/gateway/tests/e2e/gateway-pipeline.test.ts`: validated it runs (40/40 passed via cd + pnpm test)

### Phase 4.5: macOS Permission Readiness

- Status: not started
- Outcome target: the app can diagnose TCC and runtime permission readiness before it attempts desktop actions.
- Deliverables:
  - preflight checks for Accessibility, Screen Recording, Apple Events/Automation, and Microphone when voice is enabled
  - user-facing readiness UI/state
  - testable permission-state contract
- Success criteria:
  - the app does not fail silently because a required permission is missing
  - E2E can assert readiness state directly instead of guessing from side effects

### Phase 5: Deep macOS Integration

- Status: in progress (policy model + first contract pass landed)
- Outcome target: ship the deepest practical macOS integration that remains supportable on stock macOS, while quarantining SIP-off or private-kernel behavior into explicit experimental lanes.
- Reference:
  - `docs/deep-macos-integration.md`
- Mainline scope:
  - stable native capture/input/a11y
  - launchd / power / system observability
  - selected privileged OS mutations with typed verification
  - Swift supervision for permissions, lifecycle, and low-power behavior
- Out of mainline:
  - fan write control
  - private SMC writes
  - private GPU power manipulation
  - kext-dependent or SIP-off workflows

## Active Workstreams

### Workstream A: macOS App Packaging And Runtime

- Owner: active
- Scope:
  - `apps/macos/OmniState/project.yml`
  - `apps/macos/build-and-open-app.sh`
  - `apps/macos/OmniState/OmniState/Services/GatewayManager.swift`
- Changes made:
  - `build-and-open-app.sh`: now builds gateway + native runtime before packaging.
  - `build-and-open-app.sh`: now stages a bundled runtime tree under `Contents/Resources/runtime/` with:
    - production-only `gateway/` deploy output from a temp staging workspace
    - bundled `node`
    - runtime `manifest.json`
  - `build-and-open-app.sh`: supports `SKIP_OPEN=1` for non-interactive validation.
  - `build-and-open-app.sh`: now rewrites bundled Node/dylib Mach-O install names away from absolute Homebrew paths to relative `@executable_path` / `@loader_path`.
  - `build-and-open-app.sh`: now explicitly signs nested runtime binaries (`.dylib`, `.node`, bundled `node`) before signing the `.app`.
  - `build-and-open-app.sh`: now relaxes write permissions before deleting the previous `.app`, so repeated packaging runs stay idempotent after codesign.
  - `build-and-open-app.sh`: now builds a safe temp workspace in `/tmp`, runs `pnpm --filter @omnistate/gateway deploy --prod --legacy`, prunes obvious dev-only files from the deploy output, and copies that artifact into the app while preserving pnpm symlinks.
  - `GatewayManager.swift`: now prefers bundled runtime root `Contents/Resources/runtime`.
  - `GatewayManager.swift`: now prefers bundled `node` before host-machine Node lookup.
  - `GatewayManager.swift`: uses the runtime root as working directory when running the bundled gateway.
  - `GatewayManager.swift`: still keeps DEBUG-only project-root fallbacks for development.
- Success criteria:
  - Packaged app can find its bundled gateway runtime.
  - App does not depend on `~/Projects/omnistate` or Homebrew-only paths in the product path.
  - Build/run path is explicit and repeatable.
- Validation:
  - `SKIP_OPEN=1 bash apps/macos/build-and-open-app.sh` → passed
  - `codesign --verify --deep --strict apps/macos/OmniState/dist/OmniState.app` → passed
  - runtime symlink audit → `319` symlinks, `0` broken (expected from pnpm deploy layout)
  - `./Contents/Resources/runtime/bin/node -v` → `v26.0.0`
  - bundled gateway boot smoke: `NODE_ENV=production timeout 5s ./bin/node gateway/dist/index.js --port 19992 --no-health` → passed
  - `otool -L` on bundled `bin/node` and copied dylibs no longer shows `/opt/homebrew` or `/usr/local` runtime paths
  - nested runtime code now verifies after explicit per-file signing before bundle signing
  - bundle size reduced from `2.2G` to about `450M`
- Recommended follow-ups:
  - Add a post-install/pre-flight check in the app that validates the gateway dist is present before attempting to start.
  - Consider a `SKIP_GATEWAY=1` env var or launch arg for CI builds where the gateway is not yet needed.
  - Cache or reuse the staging deploy artifact between local packaging runs so repeated builds do not always pay full `pnpm deploy` cost.
  - Reduce signing noise and audit whether optional heavy ML/runtime dependencies can be feature-flagged out of the default macOS bundle.

### Workstream B: Gateway Reliability And Scope Narrowing

- Owner: active
- Scope:
  - `packages/gateway/src/planner/*`
  - `packages/gateway/src/hybrid/*`
  - `packages/gateway/src/vision/*`
  - `packages/shared/src/protocol.ts`
- Changes made:
  - Added `unsupported.capability` tool in orchestrator executor: explicit nodes for unimplemented
    paths now return `{ success: false, unsupported: true, error: "Unsupported: <reason>" }`
    instead of falling through to generic.execute.
  - Added `unsupportedNode()` factory in `planning.ts`: creates honest-fail StateNodes with
    `unsupportedReason` surfaced in params for downstream error reporting.
  - Added `UNSUPPORTED_TOOL_MAP` in `planning.ts` and `app-control.ts`: maps 4 declared-but-unimplemented
    tools to explicit reasons.
  - Updated `mapIntentToTool()` in both `planning.ts` and `app-control.ts` to return
    `unsupported: true` for: `hybrid.templates`, `hybrid.forecast`, `hybrid.suggestAction`,
    `hybrid.compliance`.
  - Updated `planFromIntent` (planning.ts) default case: unsupported tool → unsupportedNode;
    no handler + no command match → unsupportedNode (removed generic.execute fallback).
  - Updated `planFromIntentDomain` (app-control.ts) default case: same logic with unsupported flag
    handling.
  - `app-control` case: replaced `generic.execute` fallback with `unsupported.capability` node
    so unhandled app-control requests fail honestly.
  - `multi-step` fallback: replaced `generic.execute` with `unsupportedNode` when no LLM
    decomposition and no shell command match.
  - Updated existing `planner.test.ts` test: "multi-step fallback" now expects
    `unsupported.capability` (behavior change: non-command multi-step → honest fail).
- Success criteria:
  - Fewer shell-first paths for core macOS interactions. ✅ (app-control unhandled cases no longer
    route to generic.execute; multi-step non-commands no longer route to generic.execute)
  - Execution and verification contracts are stricter. ✅ (unsupported.capability returns explicit
    failure with reason)
  - Unsupported behavior fails honestly. ✅ (4 tools explicitly marked unsupported; fallback
    paths replaced with unsupportedNode)
- Validation:
  - `pnpm --filter @omnistate/gateway test src/__tests__/product-honesty-guards.test.ts src/__tests__/vision-engine.test.ts src/__tests__/planner.test.ts src/__tests__/unsupported-path-guards.test.ts`
    - Passed: `190/190` (4 test files)

### Workstream C: Test And E2E Harness

- Owner: active
- Scope:
  - `packages/gateway/src/__tests__/*`
  - `packages/gateway/tests/e2e/*`
  - `e2e/*`
  - root scripts/config needed to make the milestone runnable
- Success criteria:
  - Gateway tests cover regression risks from the current refactor.
  - E2E path reaches a meaningful macOS/browser milestone.
- Changes made:
  - Fixed port mismatch: e2e tests hardcoded 8080 but gateway listens on 19800 (WS) / 19801 (API).
    Now defaults to 19800, overridable via `OMNISTATE_E2E_WS_PORT`.
  - Fixed unhandled rejection: WS connect errors in browser-automation tests no longer crash workers.
    Each test wraps its WS connect in try/catch and calls test.skip() on failure.
  - Rewrote `voice-flow.spec.ts` from skipped placeholders into live tests with gateway/web readiness guard.
  - Created `scripts/dev/e2e-setup.mjs` to bootstrap gateway + web in one command.
  - Installed Playwright chromium browser (was missing at start of workstream).
  - `e2e/browser-automation.spec.ts`: now asserts verification-aware completion metadata (`task.verify` pass events, capability refs, and non-contradicted verification summaries) instead of only `task.complete` plus `pgrep Safari`.
  - `packages/gateway/tests/e2e/gateway-pipeline.test.ts`: lifecycle coverage now waits for terminal typed `task.complete` payloads instead of passing on raw progress events.
- Current state:
  - Root Playwright suite is now a real stack-backed checkpoint.
  - Browser automation tests now validate gateway task completion plus typed verification metadata for shipped browser/app-launch paths.
  - Voice tests validate deterministic gateway/web contracts without depending on missing UI hooks.
- Validation:
  - `pnpm exec playwright test e2e/browser-automation.spec.ts` → 5/5 passed
  - `pnpm exec playwright test e2e/voice-flow.spec.ts` → 3/3 passed
  - `pnpm test:e2e` → 8/8 passed
  - `cd packages/gateway && pnpm test tests/e2e/gateway-pipeline.test.ts` → 40/40 passed

### Workstream D: Typed Verification Pipeline

- Owner: active
- Scope:
  - `packages/gateway/src/verification/*`
  - `packages/gateway/src/perception/*`
  - `packages/shared/src/protocol.ts`
- Outcome target:
  - separate execution success from verification success
  - return typed, evidence-bearing verification results
- Deliverables:
  - `VerificationResult` with `status`, `confidence`, `verifier`, `evidence`
  - verifier taxonomy such as `vision`, `accessibility`, `app-state`, `dom`, `heuristic`
  - UI-safe completion policy that distinguishes verified, unverified, contradicted, and unsupported
- Changes made:
  - `packages/gateway/src/layers/browser.ts`: `runAppleScript()` and `runJxa()` now use `execFile` argument passing instead of shell-quoted `exec`, and AppleScript is emitted as one `-e` per logical line. This removes the `-2741` parse failure that was breaking `browser-state` verification on Safari tab reads.
  - `packages/shared/src/capability-contracts.ts`: added a first shared capability registry for shipped macOS/browser actions and honest unsupported surfaces.
  - `packages/shared/src/protocol.ts`: added typed verification transport (`VerificationResult`, evidence, claim status, capability refs) while keeping backward-compatible `task.verify.result`.
  - `packages/gateway/src/planner/types.ts`: action nodes for `app.launch`, `app.activate`, `app.quit`, `browser.open`, and `browser.newTab` now get default verify configs so common shipped actions emit verification-bearing results without bespoke planner glue per callsite.
  - `packages/gateway/src/planner/types.ts`: `browser.open` and `browser.newTab` now default to `browser-state` verification instead of raw API string matching.
  - `packages/gateway/src/planner/types.ts`: added `verifyProcessNode()` so planner can express process-backed verification explicitly instead of falling back to screenshot verification for app lifecycle steps.
  - `packages/gateway/src/planner/planning.ts`: `app-launch` plans now verify with process state instead of `verify.screenshot`, removing the false `verified -> unverified` downgrade on simple app-launch tasks.
  - `packages/gateway/src/executor/verify.ts`: verification now returns typed status/evidence and no longer collapses unavailable screenshot checks into a fake `pass`.
  - `packages/gateway/src/executor/verify.ts`: added `browser-state` verification using active-tab URL/title + page-load wait so browser navigation claims are backed by browser state instead of process-only heuristics.
  - `packages/gateway/src/executor/orchestrator.ts`: step results now carry verification payloads and aggregate a task-level `verificationSummary`.
  - `packages/gateway/src/gateway/server.ts`: `task.verify` is now emitted from real step verification state; `task.complete` now carries `claimStatus`, `verificationSummary`, and capability refs.
  - `packages/gateway/src/gateway/server.ts`: verification summaries are now merged by status priority (`contradicted > verified > unsupported > unverified`) so one degraded verify step does not erase already-verified evidence from shipped actions.
  - `packages/gateway/src/gateway/server-handlers.ts`: chat/command/clarification completions now satisfy the typed completion contract instead of using loose result shapes.
  - `packages/gateway/src/verification/capability-contracts.ts`: added a runtime-safe gateway lookup so the daemon does not depend on `@omnistate/shared` runtime source exports.
- Suggested result shape:
  ```ts
  type VerificationResult = {
    status: 'verified' | 'unverified' | 'contradicted' | 'unsupported';
    confidence: number;
    verifier: 'vision' | 'accessibility' | 'app-state' | 'dom' | 'heuristic';
    evidence: Array<{
      type: 'text' | 'ui-tree' | 'image-region' | 'process-state' | 'window-state';
      summary: string;
    }>;
  };
  ```
- Success criteria:
  - no user-visible `done` state if execution passes but verification fails
  - UI claims are derived from verification status, not raw tool output
- Current state:
  - execution success and verification truth are now separate in the task protocol
  - screenshot/native-capture degradation is surfaced as `unverified` or `unsupported`, not `pass`
  - browser E2E now consumes typed verification metadata, and `app-launch` no longer regresses to `claimStatus: unverified` because of a trailing screenshot verify node
  - browser navigation evidence now uses browser-state (active URL/title), and the YouTube “open first result” flow is now exercised end-to-end against a real `task.complete` payload with watch-URL evidence
  - deeper UI interaction evidence is still not DOM/accessibility-backed

### Workstream E: State Recovery And Idempotency

### Workstream E: State Recovery And Idempotency

- Owner: proposed
- Scope:
  - task lifecycle
  - retries
  - interrupted execution recovery
  - stale UI/window handling
- Outcome target:
  - tasks fail clearly or recover predictably instead of getting stuck
- Deliverables:
  - task states: `queued`, `executing`, `awaiting_verification`, `needs_replan`, `blocked`, `completed`, `failed`
  - retry policy by action type
  - stale-window, stale-tab, and app-not-focused recovery rules
- Success criteria:
  - interrupted and stale-state flows are testable and bounded
  - the agent does not get stuck silently when UI state drifts

### Workstream F: Vietnamese Intent Reliability

- Owner: active
- Scope:
  - `packages/gateway/src/planner/*`
  - heuristic fallback
  - browser/app intent disambiguation
- Outcome target:
  - common Vietnamese and mixed-language browser goals route correctly
- Suggested test cases:
  - `ở Safari, hãy mở youtube ở tab mới`
  - `mở github trên chrome`
  - `vào notion rồi tạo tab mới`
  - `tìm video React rồi mở kết quả đầu tiên`
- Success criteria:
  - browser goals no longer degrade into bogus app-launch fallbacks
  - Vietnamese benchmark pass rate is tracked over time
- Changes made:
  - `packages/gateway/src/planner/classify.ts`: added Vietnamese browser heuristics for browser-context new-tab phrasing and mixed-language browser/app commands.
  - `packages/gateway/src/__tests__/planner.test.ts`: added regression coverage for canonical Vietnamese browser tasks including Safari/Chrome routing and no bogus app-launch fallback.
  - `packages/gateway/src/planner/planning.ts`: Vietnamese YouTube search/open-first-result chains now terminate in `verify.browser-state`, so the planner path can prove a watch-page end state instead of stopping at script execution.
- Current state:
  - `ở Safari, hãy mở youtube ở tab mới` no longer degrades into an app-launch fallback
  - `mở github trên chrome` is regression-covered as browser control
  - `vào notion rồi tạo tab mới` is accepted as `app-control` or `multi-step` as long as planning remains browser-safe
  - `tìm video React rồi mở kết quả đầu tiên` is now regression-covered in both planner tests and real Playwright E2E

### Workstream G: Production Runtime Slimming

- Owner: proposed
- Scope:
  - bundle composition
  - production dependency isolation
  - native artifact audit
- Outcome target:
  - reduce packaged app size without breaking self-contained runtime startup
- Deliverables:
  - dependency inventory by size
  - keep/remove matrix
  - packaging lane isolated from the active workspace
  - size budgets and checkpoint tracking
- Success criteria:
  - checkpoint 1: `< 1.2G`
  - checkpoint 2: `< 700M`
  - checkpoint 3: `< 400M`
  - startup, codesign, and bundled-node validation remain green

### Workstream H: Deep macOS Integration

- Owner: active
- Scope:
  - `packages/gateway/src/layers/iokit.ts`
  - `packages/gateway/src/layers/kernel.ts`
  - `packages/gateway/src/layers/deep-os-kernel.ts`
  - `packages/gateway/src/intents/kernel-intents.ts`
  - `packages/gateway/src/executor/orchestrator.ts`
  - `apps/macos/OmniState/OmniState/Services/*`
  - `packages/shared/src/capability-contracts.ts`
- Outcome target:
  - classify and harden deep macOS capabilities into `stable public`, `privileged but supportable`, and `experimental low-level`
  - stop overclaiming “kernel-level” support where the repo is really wrapping user-space tools
  - build a shippable deep OS path around observability, safe control, and typed verification
- Deliverables:
  - capability reclassification for `iokit.*`, `kernel.*`, and related `health.*` surfaces
  - risk-tier and confirmation policy for all mutating deep OS actions
  - readback verification for `launchctl`, `pmset`, `sysctl`, and related stateful actions
  - Swift readiness/recovery path for permission, sleep/wake, and power mode behavior
- Changes made:
  - `docs/deep-macos-integration.md`: added a dedicated blueprint that splits deep macOS work into `stable public`, `privileged but supportable`, and `experimental low-level`.
  - `packages/shared/src/capability-contracts.ts`: added `CapabilityPolicy` so contracts can declare `platform`, `stability`, `requiresPrivilege`, `requiresConfirmation`, and `allowedByDefault`.
  - `packages/shared/src/capability-contracts.ts`: added the first honest deep-mac classification pass for a bounded subset of `iokit.*` and `kernel.*` capabilities.
  - `packages/shared/src/capability-contracts.ts`: explicitly classified `wifi.deep.scan`, `wifi.capture.handshake`, and `wifi.tools.install` as experimental/flagged security-sensitive surfaces instead of leaving them implicit.
  - `packages/gateway/src/__tests__/verification-contracts.test.ts`: added contract regression coverage for read-only deep macOS observability and privileged mutation gating.
  - `packages/gateway/src/executor/orchestrator.ts`: added a runtime capability gate so `flagged` and non-default deep-mac/Wi-Fi surfaces fail honestly before execution and no longer retry pointlessly.
  - `packages/gateway/src/verification/capability-contracts.ts`: added gateway-local runtime gate metadata for dangerous capabilities so the production gateway can enforce policy without depending on a non-built `@omnistate/shared` runtime export.
  - `packages/gateway/tests/e2e/gateway-pipeline.test.ts`: added a WebSocket pipeline regression that proves a flagged runtime capability returns a failed step + `task.verify` unsupported evidence + terminal error instead of fake success.
  - `packages/shared/src/capability-contracts.ts`: added alias resolution for `wifi.tools.install -> wifi.install-tools` so shared contracts and runtime registry no longer drift on that surface.
  - `packages/gateway/src/llm/tools.ts`: split full tool catalog from default exported catalog and quarantined pentest-grade Wi-Fi/network tools from the mainline LLM surface.
  - `packages/gateway/src/__tests__/llm-tools.test.ts`: added regression coverage that the default LLM tool catalog no longer advertises `wifi.monitor.*`, `network.capture`, or `network.scan.*`, while the full internal catalog still retains them for explicit/internal use.
  - `packages/gateway/src/executor/orchestrator.ts`: removed the last stale runtime import of shared capability contracts so stack-backed E2E no longer trips over `@omnistate/shared` JS export gaps.
  - `packages/gateway/src/intents/index.ts`: quarantined pentest-grade Wi-Fi/network intent registrations behind `OMNISTATE_ENABLE_MUTATION_SURFACES=true`, so they are no longer part of the default registry surface.
  - `packages/gateway/src/intents/index.ts`: expanded `OMNISTATE_ENABLE_MUTATION_SURFACES` gating to cover broader system and hardware mutation surfaces in addition to system, network, package, security, and experimental Wi-Fi/network surfaces — including snapshots, environment mutation, timezone/locale setters, Wi-Fi toggles/connect/disconnect, VPN toggles, defaults writes, power mutation, startup/login changes, schedule mutation, service mutation, package/software mutation, firewall mutation, and hardware-level mutation paths.
  - `packages/gateway/src/intents/index.ts`: moved mixed read/write hardware/network intents such as `audio.defaultOutput`, `audio.defaultInput`, `display.brightness`, `display.nightShift`, `network.firewallToggle`, `disk.eject`, `printer.default`, `kernel.sysctl`, and `kernel.power` behind the mutation flag so default routing no longer exposes hidden write behavior via getter-like names.
  - `packages/gateway/src/intents/index.ts`: expanded `OMNISTATE_ENABLE_KERNEL_MUTATION_SURFACES` gating to cover deep mutation paths such as `iokit.nvram.set`, `kernel.trace.syscalls`, and `kernel.mdutil.control`, keeping read-only observability on the default registry path.
  - `.env.example`: added `OMNISTATE_ENABLE_MUTATION_SURFACES=false` so the default product stance is documented alongside kernel-mutation gating.
- Success criteria:
  - no deep OS capability is exposed as `implemented` without a truthful stability tier and verifier
  - mutating system actions never report success from raw command exit alone
  - experimental low-level work is isolated from planner auto-routing and release gates
- Current state:
  - the contract layer can now express deep-mac policy without changing planner/executor transport
  - read-only deep macOS capabilities have started to be classified as `public`
  - privileged mutation paths such as `kernel.sysctl.set` are now modeled as non-default and confirmation-gated
  - Wi-Fi deep scan, monitor mode (start/stop), channel set, handshake capture, deauth, WPA crack, and tool-install surfaces are now classified as `experimental`/`flagged` with explicit privilege/confirmation policy
  - network packet capture, host scan, and port scan surfaces are now classified as `experimental` with explicit policy
  - runtime behavior now matches the contract for the first dangerous subset: `shell.exec`, `kernel.sysctl.set`, `kernel.memory.purge`, `kernel.launchctl.*`, `kernel.trace.syscalls`, `wifi.*`, and `network.capture/scan.*` are blocked by default in the gateway executor
  - the gateway now emits an honest failed step plus unsupported verification evidence when a flagged/non-default capability is requested, and policy-denied steps no longer burn retry budget
  - the `wifi.tools.install` vs `wifi.install-tools` contract mismatch is now normalized via shared alias lookup, but the naming split still exists and should be cleaned up at the source later
  - the default LLM/mainline tool catalog no longer advertises pentest-grade Wi-Fi/network capabilities, so these surfaces are now both hidden from normal model routing and blocked at runtime
  - pentest-grade Wi-Fi/network handlers are no longer registered in the default intent registry unless `OMNISTATE_ENABLE_MUTATION_SURFACES=true` is set explicitly
  - the default intent registry is now closer to `read/query by default, mutate only via explicit opt-in env flags` for system, network, package, and deep-mac surfaces
  - the repo still exposes a broader deep-mac surface than the current classified subset; more `iokit.*`, `kernel.*`, and hardware mutation intents still need reclassification

## Confirmed Blockers

1. ~~The macOS app packaging path is not yet self-contained.~~ *(Resolved by Workstream A)*
2. ~~Core planner behavior is still too shell-first for a trustworthy UI agent.~~ *(Partially resolved by Workstream B: unsupported paths now fail honestly; unhandled app-control and multi-step fallbacks replaced with unsupportedNode)*
3. ~~Planner maps too many requests directly to `shell.exec`.~~ *(Partially resolved: app-control fallback and multi-step non-command fallback now use unsupported.capability; remaining shell.exec paths are intentional for legitimate system operations like network-control, process-management)*
4. ~~Vision verification used to accept unstructured text as success.~~ *(Resolved by Phase 1: parseVerifyResponse requires structured JSON)*
5. ~~Some automation surfaces emit unsupported behavior as if it were implemented.~~ *(Resolved by Workstream B: 4 tools explicitly gated with unsupported flag)*
6. Perception and verification are not yet strong enough for broad UI claims. *(Residual — needs typed verification result from Phase 3)*
7. Sleep/wake and low-power behavior remain largely untested. *(Residual — not scoped to Workstream B)*
8. ~~E2E browser/voice tests require a running stack; no self-contained milestone yet.~~ *(Resolved by Workstream C: stack-backed Playwright checkpoint is now green at 8/8)*
9. Deep macOS surfaces are broader than the current product truth model, and several “kernel” capabilities are really user-space wrappers that still need honest classification, verification, and safety policy. *(Residual — Workstream H)*

## Bugs To Fix

- ~~Packaging expects a bundled gateway runtime that is not consistently included.~~ *(Fixed at checkpoint level by Workstream A)*
- ~~Gateway startup still relies on dev-path fallbacks.~~ *(Fixed for product path by Workstream A)*
- ~~Planner maps too many requests directly to `shell.exec`.~~ *(Partially fixed by Workstream B; app-control and multi-step non-command fallbacks now use unsupported.capability)*
- ~~Vision verification used to accept unstructured text as success.~~ *(Fixed by Phase 1 — parseVerifyResponse requires JSON)*
- ~~Some automation surfaces emit unsupported behavior as if it were implemented.~~ *(Fixed by Workstream B: 4 tools gated with unsupported flag)*
- ~~Packaged app is currently too large for practical distribution because runtime dependencies are copied in full.~~ *(Fixed at checkpoint level by Workstream A: bundle dropped from `2.2G` to about `450M`)*
- ~~Runtime slimming via `pnpm deploy --prod` is promising but is not safe to call from the current workspace build script; it needs a separate staging flow so it cannot disturb the active workspace install.~~ *(Fixed by Workstream A: temp staging workspace now isolates deploy from the active repo install)*
- ~~Bundled Node runtime still does not cleanly self-start from inside the bundle; app must currently rely on host Node fallback if bundled Node validation fails.~~ *(Fixed: dylib install names rewritten + nested runtime binaries explicitly signed; bundled `node -v` now passes)*
- Remaining `shell.exec` fallbacks in mapIntentToTool for network/process/audio/etc. are intentional (no typed tool in executor) but represent a gap in typed action path. *(Phase 3 work)*
- Vietnamese browser goals degrade badly when LLM preflight fails; heuristic fallback can misclassify `ở Safari, hãy mở youtube ở tab mới` as an app-launch string instead of browser control. *(Workstream B residual)*
- Positive-path `POST /api/tts/preview` is not a stable CI gate yet because it can hang on external TTS/provider behavior; only the negative-path contract is deterministic today. *(Workstream C residual)*
- The macOS bundle is materially smaller now, but still carries heavy optional native/ML dependencies by default; further slimming should be feature-flag driven, not by breaking the runtime graph. *(Workstream A residual)*
- Browser verification is now transport-aware in E2E, and the YouTube first-result path now returns real watch-URL evidence; broader browser/UI evidence is still mostly app-state based rather than DOM/accessibility-backed. *(Workstream C + D residual)*
- Playwright `webServer` auto-boot is green for `pnpm test:e2e`, but concurrent Playwright invocations can race on ports 19800/19801/5173 and make `e2e-setup` report a “ready” stack that was actually started by a sibling run. *(Workstream C residual)*
- Browser Playwright coverage currently needs serial execution because Safari/gateway state is shared and task-level browser flows are not isolated yet. *(Workstream C residual)*
- `verifyScreenshot()` still fails open on some verifier/runtime exceptions by returning `passed: true` with `unverified` evidence; this keeps flows alive but remains a trustworthiness gap for any path that depends on screenshot verification. *(Workstream D residual)*
- Several `kernel.*` and `iokit.*` capabilities are exposed in the runtime surface, but they have not yet been reclassified into `public`, `privileged`, or `experimental`, so the deep-mac story is still broader than the current product honesty bar. *(Workstream H residual)*
- Security-sensitive Wi-Fi intents such as `wifi.deep.scan` and `wifi.capture.handshake` are no longer part of the default registry path, but planner/UI and explicit experimental routing still need to reflect that split consistently instead of assuming they are normal mainline capabilities. *(Workstream H residual)*
- Security-sensitive Wi-Fi/network surfaces are no longer exposed in the default LLM tool catalog or default intent registry, but explicit/internal routing semantics are still loose; full quarantine still requires planner/UI/release-gate cleanup. *(Workstream H residual)*
- The Wi-Fi pentest surfaces are now classified honestly in capability contracts, hidden from the default LLM tool catalog, blocked at runtime by default, and removed from the default registry path; remaining cleanup is to unify naming and explicit experimental routing semantics. *(Workstream H residual)*
- Gateway runtime policy enforcement currently depends on a local metadata table in `packages/gateway/src/verification/capability-contracts.ts` because `@omnistate/shared` does not ship a JS runtime export for contracts yet; that duplication is safe for now but should be collapsed once shared runtime packaging exists. *(Workstream H residual)*
- Some system-mutating surfaces such as `system.lock`, `system.dnd`, browser state mutators, and a few remaining hardware-control paths still need their own safety-tier review instead of staying implicitly mainline. *(Workstream H residual)*
- The default registry now hides broader system mutation behind `OMNISTATE_ENABLE_MUTATION_SURFACES`, but planner/UI capability surfacing and release-gate docs still need to reflect that split consistently. *(Workstream H residual)*

## Latest Validation

- `pnpm --filter @omnistate/gateway test src/__tests__/verification-contracts.test.ts src/__tests__/orchestrator.test.ts tests/e2e/gateway-pipeline.test.ts` -> `73/73`
- `pnpm --filter @omnistate/gateway test src/__tests__/llm-tools.test.ts src/__tests__/runtime-gating.test.ts src/__tests__/verification-contracts.test.ts src/__tests__/orchestrator.test.ts tests/e2e/gateway-pipeline.test.ts` -> `83/83`
- `pnpm test:e2e` -> `8/8`
- Latest mutation-surface checkpoint intentionally skipped revalidation at user request after expanding `OMNISTATE_ENABLE_MUTATION_SURFACES` and `OMNISTATE_ENABLE_KERNEL_MUTATION_SURFACES` gating in `packages/gateway/src/intents/index.ts`.

## Recommended Features

- Add a maintained capability matrix for shipped macOS features only.
- Add action risk tiers: `read-only`, `reversible write`, `destructive`, `system-sensitive`.
- Add confirmation policy for file delete/overwrite, mutating terminal commands, app quit/force quit, and network/system preference changes.
- Add a guarded shell denylist and audit trail for destructive actions.
- Add launch-at-login, sleep/wake recovery, and low-power throttling in the Swift app.
- Add a typed action result that includes verification status and confidence.
- Add a persistent OCR or equivalent low-overhead perception bridge.
- Add a self-contained runtime bundle for the macOS app.
- ~~Add runtime pruning or a deploy step that packages only production dependencies for the bundled gateway.~~ *(Done in Workstream A via temp staging + `pnpm deploy --prod`)*
- ~~Finish dylib/install-name normalization for the bundled Node runtime so the `.app` can launch gateway without host Node.~~ *(Done in Workstream A)*
- Add an artifact cache for the staged gateway deploy so local `.app` packaging does not rerun a full production deploy every time.
- Add a first-class browser task test client shared by E2E and app code so tests do not hand-roll WebSocket protocol assumptions.
- Add seeded auth/profile fixtures for web E2E so voice/config pages can be exercised past the default enrollment gate.
- Add a deterministic local TTS stub or fixture mode so the positive `/api/tts/preview` path can join CI without external dependencies.
- Add per-task trace view with user intent, normalized intent, chosen capability, execution output, verification evidence, and final confidence.
- Add task artifact capture for screenshot before/after, active app, window title, and focused element.
- Add a failure taxonomy dashboard for planner, execution, verification, environment, and permission/TCC failures.
- Replace syntax-only browser smoke tests with gateway-driven user-task E2E that assert both action and verified browser end state.
- Isolate browser E2E fixtures further so Safari/gateway flows can run in parallel without cross-test state races.
- Expand the capability registry beyond the current small shipped subset; audit shows only a small fraction of real browser/macOS tools are currently contracted and verifier-backed.
- Add deep macOS capability policy fields such as `requiresPrivilege`, `requiresConfirmation`, and `stability = public | privileged | experimental`.
- Reclassify “kernel-level” capabilities to reflect their actual implementation path, especially where the repo currently wraps `sysctl`, `launchctl`, `ioreg`, `pmset`, or other user-space tooling rather than true kernel integration.
- Move security/pentest-grade Wi-Fi capabilities out of the default agent surface and behind explicit experimental/security gating.

## Recommendations For Later Waves

- Quarantine demo/mobile/mock-heavy surfaces behind flags or move them out of the core path.
- Consolidate the gateway around 5 domains:
  - perception
  - planning
  - actuation
  - verification
  - power-management
- Add explicit system tests for TCC bootstrap, app lifecycle, and sleep/wake recovery.

## Planner Benchmark Suite

- Goal:
  - measure intent parsing and action planning quality against a stable task corpus
- Task buckets:
  - browser control
  - app launch and switching
  - text entry
  - tab management
  - settings and navigation
  - Vietnamese commands
  - mixed-language commands
- Metrics:
  - first-plan accuracy
  - unsupported honesty rate
  - bad-shell-fallback rate
  - verification-backed completion rate
- Regression targets:
  - `bad-shell-fallback rate = 0` for typed capabilities
  - Vietnamese browser commands have their own tracked benchmark lane

## Canonical User Tasks

1. Open Safari and create a new tab.
2. Open a URL in the current tab.
3. Search Google for a query.
4. Switch to an already open app.
5. Type text into a focused field.
6. Copy selected text.
7. Launch Notes and create a new note.
8. Open System Settings to a target pane.
9. Summarize the current browser page.
10. Verify a page title changed.
11. Handle app not installed.
12. Handle missing permission.
13. Recover from the wrong focused window.
14. Retry after stale UI.
15. Execute a reversible shell-backed system action.
16. Reject an unsupported request honestly.
17. Handle a Vietnamese browser command.
18. Handle a mixed-language command.
19. Return evidence-backed completion.
20. Return `contradicted` or `unverified` when evidence is weak.

## Release Gate For macOS Agent Milestone

- Ship only if all of the following are green:
  - bundled runtime self-starts without host Node
  - typed capability contracts exist for shipped actions
  - unsupported surfaces fail honestly
  - verification-backed result path is enabled
  - permission readiness is surfaced in the UI
  - stack-backed E2E is green
  - no fake success path remains in shipped surfaces
  - bundle size is within the agreed budget
  - top 20 scripted user tasks pass at the target rate

## Validation Log

- `pnpm --filter @omnistate/gateway test src/__tests__/product-honesty-guards.test.ts src/__tests__/vision-engine.test.ts`
  - Passed: `16/16`
- `pnpm --filter @omnistate/gateway test src/__tests__/planner.test.ts src/__tests__/verification-contracts.test.ts src/__tests__/product-honesty-guards.test.ts src/__tests__/unsupported-path-guards.test.ts`
  - Passed: `201/201`
- `pnpm test:e2e --list`
  - Passed discovery: `8` tests found across `browser-automation.spec.ts` and `voice-flow.spec.ts`
- `pnpm --filter @omnistate/gateway test packages/gateway/tests/e2e/gateway-pipeline.test.ts`
  - Failed: wrong path shape for package-local Vitest invocation; needs package-relative test command or config adjustment
- `cd packages/gateway && pnpm test tests/e2e/gateway-pipeline.test.ts`
  - Passed: `40/40`
  - Notes:
    - wake model missing warnings are emitted but test still passes
    - TLS warning appears from environment during test run
- `SKIP_OPEN=1 bash apps/macos/build-and-open-app.sh`
  - Passed
- `SKIP_OPEN=1 bash apps/macos/build-and-open-app.sh` (repeat packaging after previous signed bundle existed)
  - Passed
- `pnpm --filter @omnistate/gateway deploy --prod --legacy /tmp/omnistate-gateway-deploy`
  - Experimental result: gateway package boots in `NODE_ENV=production` at about `337M`, but calling deploy from the main workspace build path is unsafe because it can trigger workspace reinstall behavior
- `SKIP_OPEN=1 bash apps/macos/build-and-open-app.sh` (with temp staging deploy packaging)
  - Passed
- `find apps/macos/OmniState/dist/OmniState.app/Contents/Resources/runtime -type l | wc -l`
  - Result: `319` symlinks in runtime (expected from pnpm deploy layout)
- `find -L apps/macos/OmniState/dist/OmniState.app/Contents/Resources/runtime -type l | wc -l`
  - Result: `0` broken symlinks
- `codesign --verify --deep --strict apps/macos/OmniState/dist/OmniState.app`
  - Passed
- Bundled runtime linkage audit
  - Passed: `otool -L` shows no `/opt/homebrew` or `/usr/local` references inside `runtime/bin/node` and copied `runtime/lib/*.dylib`
- Bundled runtime node execution
  - Passed: `cd apps/macos/OmniState/dist/OmniState.app/Contents/Resources/runtime && ./bin/node -v` → `v26.0.0`
- Bundled runtime gateway execution
  - Passed: `cd apps/macos/OmniState/dist/OmniState.app/Contents/Resources/runtime && NODE_ENV=production timeout 5s ./bin/node gateway/dist/index.js --port 19992 --no-health`
- Bundle size
  - Previous checkpoint: `2.2G`
  - Current checkpoint: `450M`
- `pnpm test:e2e`
  - Historical checkpoint: `1` passed, `7` skipped, `0` failed
  - Meaning:
    - root Playwright harness no longer fails on wrong-port assumptions
    - browser selector smoke passes
    - stack-dependent browser/voice tests skip cleanly when gateway/web is absent
- `pnpm exec playwright test e2e/browser-automation.spec.ts`
  - Passed: `5/5`
- `pnpm --filter @omnistate/gateway test src/__tests__/verification-contracts.test.ts`
  - Passed: `10/10`
  - Meaning:
    - deep-mac policy metadata compiles and is regression-covered
    - read-only observability and privileged mutation contracts are now differentiated in tests
- `pnpm --filter @omnistate/gateway test src/__tests__/verification-contracts.test.ts src/__tests__/planner.test.ts`
  - Passed: `182/182`
  - Meaning:
    - Wi-Fi pentest-grade surfaces are now contract-classified without regressing planner coverage
- `pnpm --filter @omnistate/gateway test src/__tests__/planner.test.ts src/__tests__/verification-contracts.test.ts`
  - Historical checkpoint: `181/181`
- `pnpm --filter @omnistate/gateway test src/__tests__/planner.test.ts src/__tests__/verification-contracts.test.ts tests/e2e/gateway-pipeline.test.ts`
  - Passed: `215/215`
- `pnpm --filter @omnistate/gateway test src/__tests__/planner.test.ts tests/e2e/gateway-pipeline.test.ts`
  - Passed: `211/211`
- `pnpm --filter @omnistate/gateway test src/__tests__/verification-contracts.test.ts src/__tests__/planner.test.ts tests/e2e/gateway-pipeline.test.ts`
  - Passed: `216/216`
- `pnpm exec playwright test e2e/browser-automation.spec.ts` (after verification-aware browser assertions + default verify configs)
  - Passed: `5/5`
- `pnpm exec playwright test e2e/browser-automation.spec.ts` (after browser-state verifier landed)
  - Passed: `5/5`
- `pnpm exec playwright test e2e/browser-automation.spec.ts` (after replacing the fake-green YouTube selector smoke test with a real gateway-driven task flow)
  - Passed: `5/5`
  - Meaning:
    - the YouTube “open first result” path now goes through `task` protocol, planner, executor, and `browser-state` verification
    - browser-state evidence now surfaces the actual `youtube.com/watch?v=` URL in `task.complete.verificationSummary`
- `pnpm --filter @omnistate/gateway test tests/e2e/gateway-pipeline.test.ts`
  - Passed: `40/40`
- `pnpm exec playwright test e2e/voice-flow.spec.ts`
  - Passed: `3/3`
- `pnpm test:e2e`
  - Passed: `8/8`
  - Meaning:
    - root Playwright suite now exercises real gateway/web stack behavior
    - browser suite uses the actual `task` protocol and verifies macOS-side launch behavior
    - voice suite validates deterministic gateway/web contracts without relying on missing UI hooks
- Capability coverage audit snapshot
  - Real browser/macOS primitives implemented is materially larger than the current contract registry.
  - Verified and contracted autonomy is still narrow relative to the repo surface; this milestone is not yet “any task user gives”.
- `node scripts/dev/e2e-setup.mjs --watch` + second `node scripts/dev/e2e-setup.mjs`
  - Passed expected contention check: second invocation exits non-zero with `Another e2e-setup instance is already running ... e2e-setup.lock`
  - Meaning:
    - concurrent stack bootstrap now fails fast instead of silently reusing a sibling run
- `pnpm test:e2e` (with Playwright-managed `webServer` auto-booting `scripts/dev/e2e-setup.mjs --watch`)
  - Passed: `8/8`
  - Meaning:
    - `pnpm test:e2e` is self-bootstrapping again and no longer depends on a manually started stack
    - browser WebSocket tests no longer fail red just because gateway/web were not started first
- `pnpm --filter @omnistate/gateway build`
  - Passed after typed verification transport changes
- `cd packages/gateway && pnpm test tests/e2e/gateway-pipeline.test.ts`
  - Passed: `40/40` after typed verification transport changes

## Next Checkpoint

1. ~~Fix macOS packaging/runtime path.~~ *(Workstream A checkpoint done)*
2. ~~Reduce shell-first planner/product paths.~~ *(Workstream B done — 190/190 tests passing)*
3. ~~Run e2e against a real stack.~~ *(Done — `pnpm test:e2e` now passes 8/8 against a live stack)*
4. ~~Fix bundled Node runtime install names so the `.app` no longer depends on host Node.~~ *(Done — bundled `node -v` passes and linkage is relative)*
5. ~~Prune bundled runtime contents so the `.app` is materially smaller than the current `2.2G`.~~ *(Done — staging deploy packaging reduced the bundle to about `450M`)*
6. ~~Phase 2.5 follow-up: gate planner-routable shipped actions against the capability registry instead of only exposing refs in transport.~~ *(Done — expanded shared + gateway contracts from 10 to 61 capabilities; browser tab/nav/DOM/storage/cookies/headless/advanced-tab/downloads/bookmarks/history/perf/high-level covered)*
7. Workstream D follow-up: push browser verification from current app-state URL/title evidence toward DOM/accessibility-backed evidence.
8. Workstream D follow-up: decide whether screenshot verifier exceptions should fail closed or remain `unverified` but non-blocking, then encode that policy in tests.
9. Phase 3.5: Add desktop safety rails with risk tiers, confirmation policy, and audit trail.
10. Workstream E: Add state recovery and idempotent recovery rules for stale/interrupted desktop tasks.
11. Add deterministic seeded auth/profile E2E so voice/config pages can be exercised past the enrollment gate.
12. Workstream F follow-up: push Vietnamese browser benchmarks into a dedicated benchmark suite instead of only regression tests.
13. Phase 4.5: Add macOS permission readiness contracts and UI.
14. Workstream G follow-up: add caching/feature-flagged dependency trimming so packaging stays fast while keeping the default `.app` runtime honest.
15. Workstream H: reclassify and harden deep macOS capabilities before adding any new low-level surface area.
16. Workstream H follow-up: remove or quarantine pentest-grade Wi-Fi intents from the default mainline registry before broadening deep OS routing.
