# Deep macOS Integration Blueprint

## Goal

Push OmniState deeper into macOS system control without building the core product on unstable kernel hooks, SIP-off assumptions, or private APIs that will break across OS updates.

## Product Boundary

The product should target the deepest layer that is:

- automatable from user space
- supportable on stock macOS
- compatible with TCC/SIP defaults
- testable in CI or reproducible local validation

Anything deeper than that belongs in `experimental`, not the mainline agent path.

## Integration Tiers

### Tier 1: Stable Public User-Space

Ship this in the mainline product.

- Screen capture via `ScreenCaptureKit` / `IOSurface`
- Input injection via `CGEvent`
- Accessibility tree and actions via `AXUIElement`
- Apple Events / browser automation
- Launch services, `launchctl`, `pmset`, `sysctl -n`, `ioreg`, `system_profiler`
- Thermal / battery / memory / process observability
- App/window/browser state verification

Repo mapping:

- `crates/omnistate-capture`
- `crates/omnistate-input`
- `crates/omnistate-a11y`
- `packages/gateway/src/layers/browser.ts`
- `packages/gateway/src/layers/iokit.ts`
- `packages/gateway/src/layers/kernel.ts`
- `apps/macos/OmniState/OmniState/Services/PermissionBootstrapper.swift`

### Tier 2: Privileged But Supportable

Ship only behind explicit capability contracts, risk tiers, and confirmation policy.

- selected `sysctl` writes
- `launchctl load/unload/kickstart`
- `pmset` power profile writes
- `nvram` reads
- controlled `nvram` writes only when explicitly approved
- memory purge and service restart flows

Rules:

- require `system-sensitive` or `destructive` risk tier
- require explicit audit trail
- fail closed when privilege is missing
- never silently escalate to `sudo`

Repo mapping:

- `packages/gateway/src/layers/kernel.ts`
- `packages/gateway/src/layers/deep-os-kernel.ts`
- `packages/gateway/src/intents/kernel-intents.ts`

### Tier 3: Experimental Low-Level

Do not treat these as core product capabilities.

- fan write control
- private SMC write paths
- private GPU power manipulation
- kext-dependent behavior
- SIP-off workflows
- DriverKit/SystemExtension work that changes device behavior
- raw framebuffer or hardware paths that require unsupported entitlements

Rules:

- mark as `experimental` or `flagged`
- quarantine in separate module / feature flag
- no planner auto-routing
- no user-visible “done” without explicit experimental notice

## What “Deepest Practical” Means For OmniState

For this repo, “deep OS integration” should mean:

1. The agent can observe process, power, thermal, window, browser, and UI state from public APIs.
2. The agent can act at the OS level with native input, app lifecycle, launchd, power, and browser controls.
3. The agent can verify those actions with typed evidence.
4. The Swift app can supervise permissions, lifecycle, idle mode, and recovery.

It should not mean:

- arbitrary kernel mutation
- private-driver dependence
- fan or SMC writes in the core path
- requiring SIP disablement

## Capability Lanes

### Lane 1: Deep Observability

Target:

- CPU, memory, disk, network, battery, thermals
- active process tree
- active app / window / tab
- launchd service state
- system power and sleep state

Primary files:

- `packages/gateway/src/layers/iokit.ts`
- `packages/gateway/src/layers/kernel.ts`
- `packages/gateway/src/health/*`
- `packages/shared/src/capability-contracts.ts`

Needed upgrades:

- contract every shipped read-only deep OS capability
- add typed verification for system-state reads
- add source attribution in step evidence

### Lane 2: Deep Control

Target:

- launch/activate/quit apps
- control launch agents/daemons
- switch power modes
- restart services
- perform selected privileged system actions safely

Primary files:

- `packages/gateway/src/intents/index.ts`
- `packages/gateway/src/intents/kernel-intents.ts`
- `packages/gateway/src/executor/orchestrator.ts`
- `packages/shared/src/capability-contracts.ts`

Needed upgrades:

- risk tiering for `kernel.*` and `iokit.*`
- explicit confirmation policy
- remove optimistic routing for unsupported write actions

### Lane 3: Permission And Supervisor

Target:

- TCC readiness
- launch at login
- sleep/wake handling
- reconnect and gateway fault recovery
- idle power policies

Primary files:

- `apps/macos/OmniState/OmniState/Services/PermissionBootstrapper.swift`
- `apps/macos/OmniState/OmniState/Services/GatewayManager.swift`
- `apps/macos/OmniState/OmniState/Services/GatewaySocketClient.swift`

Needed upgrades:

- explicit readiness contract for Accessibility, Screen Recording, Apple Events, Microphone
- agent idle / active / heavy-work modes
- recovery rules after wake and permission changes

### Lane 4: Verification For Deep OS Actions

Target:

- never report system mutation success from raw command exit alone

Examples:

- `launchctl` action must verify job state changed
- `pmset` action must verify effective power setting
- `sysctl` write must verify readback
- browser/window action must verify active state change

Primary files:

- `packages/gateway/src/executor/verify.ts`
- `packages/gateway/src/gateway/server.ts`
- `packages/shared/src/protocol.ts`

## Required Contract Shape For Deep OS Capabilities

Every deep macOS capability should define:

- input schema
- whether it is read-only or mutating
- whether it requires privilege
- execution path
- verifier
- fallback behavior
- confidence policy
- test coverage level

Suggested additions to contracts:

```ts
type DeepMacPolicy = {
  requiresPrivilege: boolean;
  requiresConfirmation: boolean;
  allowedByDefault: boolean;
  platform: "macos";
  stability: "public" | "privileged" | "experimental";
};
```

## Immediate Build Order

### Step 1: Audit And Reclassify Existing Deep OS Surfaces

Audit these groups and move each capability into one of:

- `implemented`
- `experimental`
- `unsupported`
- `flagged`

Focus groups:

- `iokit.*`
- `kernel.*`
- `health.*`
- `launchctl` and power actions

### Step 2: Add Safety Rails Before Adding More Depth

Must land before expanding write-capable deep OS actions.

- risk tiers
- confirmation policy
- audit trail
- denylist / guarded shell patterns

### Step 3: Strengthen Verification

Add readback verifiers for:

- `sysctl`
- `launchctl`
- `pmset`
- `browser-state`
- app lifecycle state

### Step 4: Build Swift Readiness And Recovery

- TCC readiness UI
- launch-at-login
- sleep/wake recovery
- low-power mode adaptation

### Step 5: Quarantine Experimental Low-Level Features

Put fan writes, private SMC work, or SIP-sensitive features behind:

- separate contract status
- separate feature flag
- separate docs

## Recommended Near-Term Milestone

The next credible “deep macOS” milestone is not kernel hacking. It is:

- stable native capture/input/a11y
- launchd/power/system observability
- selected safe OS mutations with verification
- Swift supervision for permission/lifecycle/power
- typed evidence for all shipped deep actions

That milestone is supportable, testable, and useful.

