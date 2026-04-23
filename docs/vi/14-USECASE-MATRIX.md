# Ma Trận Use Case OmniState (macOS)

Tài liệu này chuyển danh sách UC thành trạng thái thực thi trong repo.

## Cách Kiểm Tra Nhanh

Chạy báo cáo tổng hợp:

```bash
pnpm usecase:report
```

Dữ liệu nguồn nằm ở: `usecases.matrix.json`

## Định Nghĩa Trạng Thái

- `implemented`: đã có trong repo và có thể chạy được trên macOS.
- `partial`: đã có một phần, cần hoàn thiện để dùng production.
- `planned`: chưa có implementation rõ ràng.

## Tổng Quan Theo Nhóm

| Use Case | Tiến độ | Module | Số methods |
|----------|---------|--------|------------|
| UC1 GUI & Peripherals | ✅ 100% | `surface.ts` | 41 methods |
| UC2 Window & App Management | ✅ 100% | `deep-os.ts` | 88 methods |
| UC3 File System Operations | ✅ 100% | `deep.ts` | 46 methods |
| UC4 Browser Automation | ✅ 100% | `browser.ts` | 53 methods |
| UC5 System & Network | ✅ 100% | `deep-system.ts` | 125 methods |
| UC6 Communication & Media | ✅ 100% | `communication.ts` | 44 methods |
| UC7 Workflow Automation | ✅ 100% | `media.ts` | 46 methods |
| UC8 Software & Environment | ✅ 100% | `software.ts` | 48 methods |
| UC9 Hardware Control | ✅ 100% | `hardware.ts` | 46 methods |
| UC10 Multi-Device / Fleet | ✅ 100% | `fleet.ts` | 46 methods |
| UC11 Developer & CLI | ✅ 100% | `developer.ts` | 28 methods |
| UC12 Maintenance | ✅ 100% | `maintenance.ts` | 30 methods |
| UC13 Permission & Security | ✅ 100% | `approval-policy.ts` + `permission-responder.ts` | 48 methods |
| **Tổng** | **✅ 100%** | — | **689 methods** |

## Chi Tiết Theo Use Case

### UC1 — GUI & Peripherals (100%)
- Điều khiển chuột: move, click, drag, scroll
- Bàn phím: type, hotkey, CGEvent-level injection
- Screenshot với OCR + confidence scoring
- Desktop navigation, window geometry
- Kéo thả (drag-drop)

### UC2 — Window & App Management (100%)
- Vòng đời ứng dụng: launch, quit, focus, hide
- Quản lý cửa sổ: resize, move, snap, split
- Process list, snapshots
- Clipboard mở rộng (deep-system)

### UC3 — File System Operations (100%)
- CRUD: read, write, delete, rename, copy, move
- listDir, search (by name/content), metadata
- Permissions, watch (file events), symlink
- Hash, compare, touch, disk info, zip/unzip

### UC4 — Browser Automation (100%)
- Tab management, navigation, JS execution
- Form fill, cookie management
- Headless CDP support
- Downloads, bookmarks, history, cache, network perf

### UC5 — System & Network (100%)
- CPU / memory / disk / thermal / network monitoring
- Power management, uptime, disk I/O
- Open files tracking, resource alerts
- Wi-Fi / Bluetooth toggle, Focus/Do Not Disturb

### UC6 — Communication & Media (100%)
- Email (Mail.app), iMessage, FaceTime
- Calendar, Reminders, Contacts, Notes
- Thông báo hệ thống

### UC7 — Workflow Automation (100%)
- Music, Playlists, AirPlay
- Video, Podcast, Screen Recording
- Media Keys, Audio EQ

### UC8 — Software & Environment (100%)
- Homebrew + Cask: install, uninstall, update
- npm / pnpm / pip package management
- Environment variables, system info
- Version managers: nvm, pyenv, rbenv
- App discovery, startup management

### UC9 — Hardware Control (100%)
- Volume, Brightness (display)
- Bluetooth connect/disconnect
- Power settings (sleep, restart, shutdown)
- Keyboard backlight, USB / Thunderbolt
- Wi-Fi, Camera/Mic privacy
- Printer queue, scanner control
- Safe eject external drives

### UC10 — Multi-Device / Fleet (100%)
- Device discovery (mDNS / Tailscale)
- Task distribution đến nhiều máy
- File sync, clipboard sync
- Heartbeat, mesh networking
- Wake-on-LAN, config sync, metrics

### UC11 — Developer & CLI (100%)
- Natural language → terminal/shell
- Git operations: status, commit, push, pull, branch, stash
- Editor integration
- Docker: container lifecycle, compose
- Python virtual env lifecycle
- Project structure analysis, log/crash diagnostics

### UC12 — Maintenance (100%)
- Disk cleanup, cache management
- Process management, log management
- Auto network diagnostics và remediation
- Performance diagnostics
- Scheduled disk optimization

### UC13 — Permission & Security (100%)
- Blocklist / allowlist per-app scoping
- Sandbox profiles, policy templates
- Audit API, real-time monitoring
- Permission interceptors
- Auto-responder (GUI + Claude Code terminal)
- Encrypt/decrypt folder, secure shred
- Smart desktop/workspace organization

## Ghi Chú

Trạng thái này phản ánh kết quả audit 2026-04-14 (21/21 E2E checks PASS).
Nguồn tham khảo thêm: [docs/STATUS.md](../STATUS.md).

Cập nhật `usecases.matrix.json` mỗi khi thêm/chỉnh sửa UC.

## Cập Nhật Ma Trận

```bash
# Tái tạo JSON từ source code (chạy sau khi thêm method mới):
pnpm usecase:report

# CI guard — kiểm tra JSON có đồng bộ với source không (exit 1 nếu lệch):
pnpm usecase:check
```

> Script nguồn: `scripts/build-usecase-matrix.mjs`. Override trạng thái cụ thể bằng `usecases.overrides.json` ở root (shape: `{ "UC1.methodName": "partial" }`).
