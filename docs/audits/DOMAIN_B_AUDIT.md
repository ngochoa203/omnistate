# OmniState Domain B Deep OS Layer - Complete Audit

**Audit Date**: April 10, 2026  
**Project Path**: `/Users/hoahn/Projects/omnistate/`  
**Scope**: All 30 Domain B "Deep OS Layer" use cases  
**Methodology**: Source code review of TypeScript gateway and Rust N-API crates

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Use Cases** | 30 |
| **✅ Fully Implemented** | 1 (3.3%) |
| **⚠️ Partially Implemented** | 1 (3.3%) |
| **❌ Missing** | 28 (93.3%) |
| **TS Code Size** | ~6,800 lines |
| **Rust Crates** | 6 (screen, capture, input, a11y, core, napi) |

**Key Finding**: Project focuses on **UI interaction & file operations**. Deep OS features (packages, services, network, storage, security) are **not yet implemented** despite being listed in the vision. Generic `shell.exec` support allows workarounds but lacks type-safe APIs and cross-platform abstraction.

---

## Detailed Use Case Assessment

### ✅ UC-B03: File/Directory Operations — IMPLEMENTED

**Status**: ✅ FULLY IMPLEMENTED

**Evidence**:
- **Location**: `packages/gateway/src/layers/deep.ts:51-88`
- **Implemented Operations**:
  - `readFile(path: string): string` — Read file as UTF-8 text
  - `readFileBinary(path: string): Buffer` — Read file as binary
  - `writeFile(path: string, content: string): void` — Write file
  - `fileExists(path: string): boolean` — Check file/directory existence
  - `fileStat(path: string): FileInfo` — Get metadata (size, dates, isDir)
  - `listDir(path: string): string[]` — List directory contents

**Tools Exposed**:
- `file.read` — via orchestrator.ts:174-177
- `file.write` — via orchestrator.ts:178-181
- `shell.exec` — for find, grep, ls operations

**Gaps**:
- Search/filtering: Only available through shell commands (`shell.exec find ...`)
- Sorting: Not natively supported; requires shell piping
- Async operations: All file I/O is synchronous (blocking)

**Usage Example** (from intent.ts:699-711):
```typescript
case "file-operation": {
  const cmd = extractShellCommand(intent);
  nodes.push(
    actionNode("file-op", intent.rawText, "shell.exec", "deep",
      { command: cmd, entities: intent.entities })
  );
}
```

---

### ⚠️ UC-B01: Process Lifecycle Management — PARTIALLY IMPLEMENTED

**Status**: ⚠️ PARTIAL (List & Kill only)

**Evidence**:
- **Location**: `packages/gateway/src/layers/deep.ts:180-233`
- **Implemented Operations**:
  - `getProcessList(): Promise<ProcessInfo[]>` — List running processes with CPU/memory
  - `isProcessRunning(name: string): boolean` — Check if process exists
  - `killProcess(pid: number, force?: boolean): Promise<boolean>` — Kill by PID (SIGTERM or SIGKILL)
  - `killProcessByName(name: string, force?: boolean): Promise<boolean>` — Kill by name

**Tools Exposed**:
- `process.list` — via orchestrator.ts:182-185
- `process.kill` — via orchestrator.ts:186-189

**Implementation Details** (deep.ts:181-198):
```typescript
async getProcessList(): Promise<ProcessInfo[]> {
  const { stdout } = await execAsync(
    "ps -eo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null || ps -eo pid,pcpu,pmem,comm"
  );
  const lines = stdout.trim().split("\n").slice(1);
  return lines.slice(0, 50).map(line => {
    const parts = line.trim().split(/\s+/);
    return { pid: parseInt(parts[0]), name: parts.slice(3).join(" "), 
             cpu: parseFloat(parts[1]), memory: parseFloat(parts[2]) };
  });
}
```

**Missing**:
- ❌ Process restart/relaunch
- ❌ Process priority adjustment (`renice`, `nice`)
- ❌ cgroup management (resource limits, CPU/memory caps)
- ❌ CPU affinity / processor binding
- ❌ Signal handling beyond SIGTERM/SIGKILL
- ❌ Process monitoring/health checks

---

### ❌ UC-B02: App Resolution & Auto-Install — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Current State**:
- App launch exists (deep.ts:100-118) but is platform-specific and simple
- Only wraps OS commands: `open -a` (macOS), `start` (Windows), spawn (Linux)
- No dependency checking, auto-install, or verification

**Missing**:
- ❌ Check if app is installed
- ❌ Resolve app dependencies
- ❌ Auto-install missing apps (via brew, apt, etc.)
- ❌ Verify app launches successfully
- ❌ Wait for app to become interactive

**Evidence of Limitation** (deep.ts:100-118):
```typescript
async launchApp(name: string): Promise<boolean> {
  try {
    switch (this.platform) {
      case "macos":
        await execAsync(`open -a "${name}"`);  // ← Just wraps 'open'
        break;
      case "linux":
        spawn(name, { detached: true, stdio: "ignore" }).unref();
        break;
      case "windows":
        await execAsync(`start "" "${name}"`);
        break;
    }
    return true;
  } catch { return false; }
}
```

---

### ❌ UC-B04: Filesystem Snapshots — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ APFS snapshot support (macOS)
- ❌ ZFS snapshot support (Linux)
- ❌ Btrfs snapshot support (Linux)
- ❌ Volume Shadow Copy (VSS) support (Windows)
- ❌ LVM snapshot support
- ❌ Time Machine integration
- ❌ Backup-before-destructive-op pattern

**Use Case**: Create filesystem snapshot before dangerous operations (package upgrades, system config changes, app installations).

---

### ❌ UC-B05: OS-Level Configuration — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Current State**:
- Only basic system info available: hostname, CPU, RAM, uptime (deep.ts:240-253)

**Missing**:
- ❌ DNS settings (resolver config, primary/secondary DNS)
- ❌ Dark mode / light mode (macOS/Windows)
- ❌ Proxy configuration (HTTP/HTTPS/SOCKS proxy)
- ❌ Sleep/idle settings (sleep timeout, wake on LAN)
- ❌ System policies (firewall, app security, privacy)
- ❌ Hostname/workgroup configuration
- ❌ Time zone and NTP settings

**Impact**: Cannot automate system preferences without shell commands.

---

### ❌ UC-B06: Service/Daemon Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ launchd (macOS) — start, stop, restart, status, enable, disable services
- ❌ systemd (Linux) — systemctl, journalctl, service management
- ❌ Windows Services — sc.exe, Service Control Manager
- ❌ init.d / upstart (legacy Linux)
- ❌ Service file management (create, edit, delete)
- ❌ Dependency ordering
- ❌ Auto-start configuration

**Impact**: Cannot manage background services or daemons.

---

### ❌ UC-B07: Package Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Homebrew (macOS/Linux) — brew install, upgrade, uninstall
- ❌ apt (Debian/Ubuntu) — apt-get, apt install, upgrade
- ❌ yum/dnf (RedHat/Fedora) — package management
- ❌ winget (Windows) — package installation
- ❌ Chocolatey (Windows) — choco install
- ❌ Snap (Linux) — snap install
- ❌ Dependency resolution
- ❌ Version pinning
- ❌ Repository management

**Impact**: Cannot automate software installation, updates, or dependency management.

**Workaround**: `shell.exec "brew install foo"` works but lacks error handling and cross-platform abstraction.

---

### ❌ UC-B08: Network Control — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ WiFi control (connect, disconnect, scan networks)
- ❌ Firewall rules (add, remove, list rules)
- ❌ VPN management (connect, disconnect, status)
- ❌ Routing table management
- ❌ DNS configuration (set primary/secondary DNS)
- ❌ Port management (open, close, forward)
- ❌ Network interface configuration
- ❌ Proxy settings (HTTP, HTTPS, SOCKS)

**Impact**: Cannot manage network connectivity or security at the OS level.

---

### ❌ UC-B09: Kernel/Hardware Tuning — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ sysctl parameters (Linux) — kernel tuning
- ❌ pmset (macOS) — power management settings
- ❌ bcdedit (Windows) — boot configuration
- ❌ CPU frequency scaling
- ❌ I/O scheduler tuning
- ❌ Swap configuration
- ❌ Buffer cache tuning

**Impact**: Cannot optimize system performance at the kernel level.

---

### ❌ UC-B10: Peripheral Control — MOSTLY MISSING

**Status**: ❌ MOSTLY MISSING (Volume only)

**Partially Implemented**:
- ⚠️ Audio volume: AppleScript in intent.ts:569-581
  ```typescript
  if (/\bvolume\s*(up|down)\b/i.test(text)) {
    return `set volume output volume (...)`; // AppleScript
  }
  ```

**Missing**:
- ❌ Audio input/output device selection
- ❌ Bluetooth connectivity (pair, disconnect, device list)
- ❌ Display brightness
- ❌ USB device enumeration/control
- ❌ Printer selection and configuration
- ❌ Camera/microphone permissions
- ❌ Keyboard layout switching

**Impact**: Limited peripheral management.

---

### ❌ UC-B11: Scheduled Task Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ cron (Linux/macOS) — schedule commands
- ❌ launchd timers (macOS) — scheduled launch agents
- ❌ Windows Task Scheduler — scheduled tasks
- ❌ at command (Unix) — one-time scheduling
- ❌ Task creation, deletion, listing
- ❌ Recurrence/repeat patterns

**Impact**: Cannot schedule automated tasks.

---

### ❌ UC-B12: Registry/System Database — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Windows Registry read/write (HKEY_*, regedit)
- ❌ macOS plist database (com.apple.* preferences)
- ❌ Linux /etc configuration files (advanced parsing/validation)
- ❌ Database transactions
- ❌ Backup/restore of system configuration

**Impact**: Cannot directly manipulate system databases.

---

### ❌ UC-B13: User/Group/ACL Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ User account creation, deletion, modification
- ❌ Group management
- ❌ Password policy configuration
- ❌ File permissions (chmod, chown)
- ❌ ACL (Access Control List) management
- ❌ Sudo configuration
- ❌ User login shell configuration

**Impact**: Cannot manage user accounts or permissions.

---

### ❌ UC-B14: Partition/Volume Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Create, delete, resize partitions
- ❌ Format volumes (ext4, NTFS, HFS+, APFS)
- ❌ Mount/unmount volumes
- ❌ LVM management (logical volumes, volume groups)
- ❌ Disk partitioning utilities
- ❌ Compression configuration
- ❌ Quotas

**Impact**: Cannot manage storage layout.

---

### ❌ UC-B15: Environment Variable Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Session environment variables ($PATH, $HOME, etc.)
- ❌ User-level environment variables (~/.bashrc, ~/.zshenv)
- ❌ System-level environment variables (/etc/environment)
- ❌ Persistent environment variable storage
- ❌ Profile script management

**Impact**: Cannot configure environment for spawned processes.

---

### ❌ UC-B16: Shell/Terminal Profile Configuration — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ .zshrc/.bashrc editing
- ❌ Alias definition and management
- ❌ Function definition
- ❌ Shell settings (set -x, etc.)
- ❌ Profile sourcing and dependency management
- ❌ Shell prompt customization

**Impact**: Cannot automate shell configuration.

---

### ❌ UC-B17: Log Collection and Rotation — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ System log collection (syslog, journald, Event Viewer)
- ❌ Application log aggregation
- ❌ Log rotation (logrotate, built-in rotation)
- ❌ Log filtering and searching
- ❌ Log retention policies
- ❌ Centralized logging configuration

**Impact**: Cannot manage system logs or perform log analysis at scale.

---

### ❌ UC-B18: Clipboard Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Read clipboard contents
- ❌ Write to clipboard
- ❌ Clipboard history
- ❌ Cross-platform clipboard sync
- ❌ Clipboard format handling (text, image, rich text)

**Impact**: Cannot interact with clipboard.

---

### ❌ UC-B19: Font/Locale/Keyboard Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Font installation and management
- ❌ Locale configuration
- ❌ Keyboard layout switching
- ❌ Input method management (IME)
- ❌ Language pack management
- ❌ Time/date format configuration

**Impact**: Cannot manage system internationalization or input devices.

---

### ❌ UC-B20: Startup/Boot Flow Control — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Boot order configuration
- ❌ Boot menu access
- ❌ Secure boot settings
- ❌ UEFI/BIOS settings
- ❌ Startup items management
- ❌ Boot animation/logo customization

**Impact**: Cannot control boot sequence.

---

### ❌ UC-B21: Power/Energy Orchestration — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Sleep command (sleep, suspend)
- ❌ Hibernation
- ❌ Shutdown with options
- ❌ Wake-on-LAN
- ❌ Power profile management
- ❌ Battery management
- ❌ CPU throttling

**Note**: Volume control works via AppleScript, but power states do not.

**Impact**: Cannot automate power state changes.

---

### ❌ UC-B22: Certificate/Key Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ SSH key generation and management
- ❌ GPG key management
- ❌ X.509 certificate handling
- ❌ Keychain/credential store management
- ❌ Certificate chain verification
- ❌ Key import/export
- ❌ Passphrase management

**Impact**: Cannot manage cryptographic keys or certificates.

---

### ❌ UC-B23: Advanced Firewall Rules — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Basic firewall rules (covered in UC-B08)
- ❌ Rate limiting rules
- ❌ Geo-blocking (by country/IP range)
- ❌ Application-based rules
- ❌ Deep packet inspection (DPI)
- ❌ Intrusion detection configuration

**Impact**: Cannot configure advanced firewall policies.

---

### ❌ UC-B24: Container/VM Lifecycle — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Docker container management (run, stop, kill, rm)
- ❌ Podman integration
- ❌ VirtualBox VM management
- ❌ KVM/QEMU VM management
- ❌ Kubernetes cluster management
- ❌ Image building and pulling

**Impact**: Cannot automate container/VM workflows.

---

### ❌ UC-B25: Display/Resolution Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Display resolution changes
- ❌ Refresh rate configuration
- ❌ Multi-monitor setup (arrange, mirror, extend)
- ❌ Display on/off control
- ❌ Rotation (portrait/landscape)
- ❌ Scaling/DPI adjustment

**Impact**: Cannot manage display configuration.

---

### ❌ UC-B26: System-Wide Audio Management — PARTIALLY MISSING

**Status**: ❌ MOSTLY MISSING (Volume only)

**Partially Implemented**:
- ⚠️ Master volume control (intent.ts:569-581)

**Missing**:
- ❌ Per-application volume control (some apps only)
- ❌ Per-device I/O selection (audio inputs/outputs)
- ❌ Equalizer settings
- ❌ Surround sound configuration
- ❌ Audio format selection (44.1kHz vs 48kHz)

**Impact**: Limited audio device management.

---

### ❌ UC-B27: Printer/Scanner Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Printer enumeration
- ❌ Default printer selection
- ❌ Print queue management
- ❌ Scanner enumeration
- ❌ Scan-to-file/email
- ❌ Driver management
- ❌ Network printer configuration

**Impact**: Cannot manage printers or scanners.

---

### ❌ UC-B28: Backup/Restore Orchestration — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Time Machine backup (macOS) integration
- ❌ rsync automation
- ❌ restic backup
- ❌ Duplicati
- ❌ Windows Backup integration
- ❌ Incremental/differential backups
- ❌ Backup scheduling and retention

**Impact**: Cannot automate backups.

---

### ❌ UC-B29: OS Update/Patch Management — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ OS update checking
- ❌ Security patch application
- ❌ Update scheduling
- ❌ Rollback support
- ❌ Update progress monitoring
- ❌ Reboot coordination

**Impact**: Cannot manage OS updates.

---

### ❌ UC-B30: Swap/Memory Pressure Tuning — MISSING

**Status**: ❌ NOT IMPLEMENTED

**Missing**:
- ❌ Swap file creation and configuration
- ❌ zram (compressed RAM disk) management
- ❌ OOM (Out-of-Memory) killer tuning
- ❌ Memory pressure monitoring
- ❌ Swap priority management
- ❌ Memory compaction

**Impact**: Cannot tune memory subsystem.

---

## Architecture & Implementation Details

### Project Structure
```
omnistate/
├── crates/                              # Rust crates (N-API bindings)
│   ├── omnistate-screen/                # Screen capture
│   ├── omnistate-capture/               # Zero-copy GPU framebuffer
│   ├── omnistate-input/                 # Mouse/keyboard input
│   ├── omnistate-a11y/                  # Accessibility tree
│   ├── omnistate-napi/                  # N-API bridge
│   └── omnistate-core/                  # Shared types
├── packages/
│   ├── gateway/
│   │   └── src/
│   │       ├── layers/
│   │       │   ├── deep.ts              # ← Deep Layer (file, process, shell)
│   │       │   ├── surface.ts           # ← Surface Layer (UI/vision)
│   │       │   └── fleet.ts             # ← Fleet Layer (distributed)
│   │       ├── executor/                # Orchestrator, queue, retry, verify
│   │       ├── planner/                 # Intent classification, planning
│   │       ├── vision/                  # Claude/GPT-4V integration
│   │       ├── health/                  # System monitoring
│   │       └── session/                 # State storage
│   └── cli/                             # CLI tool
```

### Deep Layer API

Currently exposed tools (via orchestrator.ts:149-204):

```typescript
switch (tool) {
  case "shell.exec":      // Shell command execution
  case "app.launch":      // App launching
  case "app.activate":    // App activation
  case "app.quit":        // App termination
  case "app.script":      // AppleScript execution
  case "file.read":       // File read
  case "file.write":      // File write
  case "process.list":    // Process enumeration
  case "process.kill":    // Process termination
  case "system.info":     // System information
  case "generic.execute": // Fallback for unknown tools
}
```

### Surface Layer API

Currently exposed tools (via orchestrator.ts:206-260):

```typescript
switch (tool) {
  case "screen.capture":  // Screen capture (IOSurface zero-copy)
  case "ui.find":         // Find UI element by query
  case "ui.click":        // Click element
  case "ui.type":         // Type text
  case "ui.key":          // Press key with modifiers
  case "ui.scroll":       // Scroll
}
```

### Intent Classification (from planner/intent.ts:28-36)

```typescript
const INTENT_TYPES = [
  "shell-command",        // → shell.exec
  "app-launch",           // → app.launch
  "app-control",          // → app.script or ui.key
  "file-operation",       // → shell.exec or file.{read,write}
  "ui-interaction",       // → screen.capture → ui.find → ui.click
  "system-query",         // → system.info or shell.exec
  "multi-step",           // → LLM decomposition
]
```

---

## What's Possible (Workarounds)

### via `shell.exec`

Because the deep layer accepts `shell.exec` with arbitrary commands, the following **are technically possible** via shell commands:

- ✅ Package management: `shell.exec "brew install foo"`
- ✅ Service management: `shell.exec "systemctl start foo"`
- ✅ Network control: `shell.exec "ip addr add ..."`
- ✅ User management: `shell.exec "useradd -m user"`
- ✅ Power control: `shell.exec "shutdown -h now"`

**However**, these lack:
- ❌ Type-safe parameter marshaling
- ❌ Cross-platform abstraction (same command for macOS, Linux, Windows)
- ❌ Error handling and validation
- ❌ Human-friendly intent classification
- ❌ Progress monitoring and retries
- ❌ Verification of operation success

---

## Gap Analysis by Category

| Category | Gap | Count | Severity | Examples |
|----------|-----|-------|----------|----------|
| **System Configuration** | Cannot read/write system settings | 5 UC | HIGH | DNS, dark mode, proxy, sleep, policies (UC-B05) |
| **Package Management** | No package manager integration | 1 UC | **CRITICAL** | brew, apt, winget, choco, snap (UC-B07) |
| **Service Management** | No daemon/service control | 1 UC | **CRITICAL** | launchd, systemd, Windows Services (UC-B06) |
| **Power Management** | No sleep/shutdown/wake | 1 UC | HIGH | sleep, hibernate, wake-on-LAN (UC-B21) |
| **Storage** | No partition/volume/snapshot ops | 2 UC | HIGH | LVM, APFS, ZFS, Btrfs, VSS (UC-B04, UC-B14) |
| **Network** | No network stack control | 2 UC | HIGH | WiFi, firewall, VPN, DNS (UC-B08, UC-B23) |
| **Security** | No cryptographic key/cert management | 1 UC | MEDIUM | SSH, GPG, keychain, certs (UC-B22) |
| **User/Permission** | No user/group/ACL management | 1 UC | MEDIUM | Users, groups, chmod, ACL (UC-B13) |
| **Backup** | No backup orchestration | 1 UC | MEDIUM | Time Machine, rsync, restic (UC-B28) |
| **Container/VM** | No Docker/Podman/VirtualBox | 1 UC | MEDIUM | Container/VM lifecycle (UC-B24) |
| **Display** | No resolution/mode management | 1 UC | LOW | Resolution, refresh rate, multi-monitor (UC-B25) |
| **Peripheral** | Limited audio, no Bluetooth/USB | 1 UC | LOW | Audio, Bluetooth, brightness, USB (UC-B10) |
| **Scheduling** | No cron/Task Scheduler | 1 UC | MEDIUM | cron, launchd timers, Task Scheduler (UC-B11) |
| **Logging** | No log management | 1 UC | MEDIUM | Log collection, rotation (UC-B17) |
| **Clipboard** | No clipboard access | 1 UC | LOW | Clipboard read/write/history (UC-B18) |
| **Locale** | No font/locale/keyboard config | 1 UC | LOW | Fonts, locale, keyboard layout (UC-B19) |
| **Boot** | No boot control | 1 UC | LOW | Boot order, UEFI settings (UC-B20) |
| **Updates** | No OS update management | 1 UC | MEDIUM | OS updates, patches (UC-B29) |
| **Memory** | No swap/zram tuning | 1 UC | LOW | Swap, zram, OOM tuning (UC-B30) |
| **Registry** | No system database access | 1 UC | MEDIUM | Windows Registry, plist (UC-B12) |
| **Environment** | No env var management | 1 UC | MEDIUM | $PATH, shell profiles (UC-B15, UC-B16) |
| **Process** | Partial (no restart/renice/cgroup) | 1 UC | MEDIUM | Process lifecycle (UC-B01) |
| **App Resolution** | No dependency/auto-install | 1 UC | MEDIUM | App auto-install, dependency resolution (UC-B02) |

---

## Recommendations

### Priority 1: High-Impact Quick Wins

1. **Package Manager Wrapper** (UC-B07)
   - Create `packages.ts` module wrapping brew/apt/winget
   - Type-safe `installPackage(name, version)`, `uninstallPackage(name)`
   - Cross-platform abstraction: detect OS, choose tool
   - Estimated effort: 1-2 days

2. **Service Management** (UC-B06)
   - Create `services.ts` module for launchd/systemd/Windows Services
   - Implement `startService()`, `stopService()`, `restartService()`, `getServiceStatus()`
   - Estimated effort: 2-3 days

3. **Power Management** (UC-B21)
   - Create `power.ts` module for sleep, shutdown, wake-on-LAN
   - Implement `sleep()`, `shutdown()`, `hibernate()`, `wakeOnLan()`
   - Estimated effort: 1 day

### Priority 2: Expanded Deep Layer

4. **Process Lifecycle** (UC-B01)
   - Extend `process.ts` with restart, renice, cgroup support
   - Estimated effort: 2 days

5. **System Configuration** (UC-B05)
   - Create `config.ts` for DNS, dark mode, proxy, sleep settings
   - Estimated effort: 3-5 days

6. **Network Control** (UC-B08)
   - Create `network.ts` for WiFi, firewall, DNS, VPN
   - Estimated effort: 3-5 days

### Priority 3: Native Bindings

7. **New Rust Crates** (for persistent data / native APIs):
   - `omnistate-storage` — LVM, APFS, ZFS, Btrfs snapshots
   - `omnistate-network` — WiFi, firewall (native APIs)
   - `omnistate-service` — launchd, systemd (native APIs)

### Priority 4: Operational Features

8. **Backup Orchestration** (UC-B28)
9. **OS Updates** (UC-B29)
10. **Clipboard** (UC-B18)
11. **Logging** (UC-B17)

---

## Code Evidence Summary

### Deep Layer (packages/gateway/src/layers/deep.ts)
- **Lines**: 1–332
- **Exports**: `DeepLayer` class with 14 public methods
- **Coverage**: File I/O, process mgmt, app control (macOS), shell execution

### Orchestrator (packages/gateway/src/executor/orchestrator.ts)
- **Lines**: 1–295
- **Exports**: `Orchestrator` class with `executePlan()` method
- **Tool Handling**: ~20 case statements for shell, app, file, process, system, screen, ui tools

### Intent Planner (packages/gateway/src/planner/intent.ts)
- **Lines**: 1–932
- **Exports**: `classifyIntent()`, `planFromIntent()` functions
- **Intent Types**: 7 types (shell-command, app-launch, app-control, file-operation, ui-interaction, system-query, multi-step)

### Types (packages/gateway/src/types/task.ts)
- **Lines**: 1–55
- **Exports**: `ExecutionLayer`, `TaskStatus`, `StateNode`, `StatePlan` interfaces

---

## Conclusion

OmniState is **well-architected for UI automation** (Surface Layer) and **basic system operations** (Deep Layer file/process/shell). However, it **lacks comprehensive OS integration** for the 30 Domain B use cases.

The **3% implementation rate** reflects the project's current focus: enabling vision-based UI interaction and general-purpose task orchestration. Deep OS features (packages, services, network, storage, security) are **planned but not yet implemented**.

**Key insight**: The project can leverage its existing `shell.exec` support + modest wrapper modules to quickly achieve 50%+ coverage of the 30 use cases, rather than building extensive Rust N-API bindings. A phased approach prioritizing package management, services, and power management would unlock the most value for end users.

