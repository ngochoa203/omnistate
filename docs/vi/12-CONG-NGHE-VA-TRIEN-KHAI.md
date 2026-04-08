# Công Nghệ & Triển Khai

## Lựa Chọn Công Nghệ Cốt Lõi

| Thành phần | Công nghệ | Lý do |
|-----------|----------|-------|
| **Runtime** | Node.js 22+ / Bun | Tương thích hệ sinh thái OpenClaw, I/O async nhanh |
| **Ngôn ngữ** | TypeScript (ESM) | An toàn kiểu, tương thích OpenClaw |
| **Giao thức Gateway** | WebSocket + JSON | Đã chứng minh bởi OpenClaw, hai chiều thời gian thực |
| **Mô hình thị giác** | Claude 4 Computer Use / GPT-4V | Hiểu UI tốt nhất cho phần tử giao diện |
| **Thị giác cục bộ** | Florence-2 / PaddleOCR | OCR cục bộ nhanh không tốn API |
| **Chụp màn hình** | API nền tảng native | CGWindowListCreateImage (macOS), DXGI (Win), XCB (Linux) |
| **Chuột/Bàn phím** | API nền tảng native | CGEvent (macOS), SendInput (Win), XTest (Linux) |
| **Accessibility** | AX API / UI Automation / AT-SPI | Cây accessibility nền tảng |
| **Lưu trữ trạng thái** | JSON + JSONL files | Đơn giản, dễ debug, theo pattern OpenClaw |
| **Truyền tải đội máy** | Tailscale / WireGuard | Mesh mã hóa không cần cấu hình |
| **Hàng đợi tác vụ** | FIFO theo lane trong tiến trình | Theo thiết kế queue OpenClaw |
| **Hệ thống plugin** | Gói npm + nạp cục bộ | Theo pattern plugin OpenClaw |

## Triển Khai Theo Nền Tảng

### macOS

| Khả năng | API / Framework |
|----------|----------------|
| Chụp màn hình | `CGWindowListCreateImage`, `IOSurface` (framebuffer) |
| Điều khiển chuột | `CGEventCreateMouseEvent` + `CGEventPost` |
| Điều khiển bàn phím | `CGEventCreateKeyboardEvent` + `CGEventPost` |
| Accessibility | `AXUIElement` API |
| Desktop ảo | `CGSMoveWorkspaceToSpace` (private API) |
| Quản lý tiến trình | `NSRunningApplication`, `kill(2)`, `proc_listpids` |
| Hệ thống tập tin | `Foundation` / Node.js `fs` |
| Cấu hình mạng | `SystemConfiguration.framework`, `scutil` |
| Tường lửa | `pfctl` (packet filter) |
| Quản lý gói | `brew` |
| Clipboard | `NSPasteboard` |
| Wake-on-LAN | `IOEthernetController` / raw socket |

### Windows

| Khả năng | API / Framework |
|----------|----------------|
| Chụp màn hình | `DXGI Desktop Duplication API` |
| Điều khiển chuột | `SendInput` + `SetCursorPos` |
| Điều khiển bàn phím | `SendInput` (keyboard events) |
| Accessibility | `UIAutomation` COM interface |
| Desktop ảo | `IVirtualDesktopManager` |
| Quản lý tiến trình | `CreateToolhelp32Snapshot`, `TerminateProcess` |
| Hệ thống tập tin | Node.js `fs` / `PowerShell` |
| Cấu hình mạng | `netsh`, WMI |
| Tường lửa | `netsh advfirewall`, Windows Firewall COM |
| Quản lý gói | `winget`, `choco` |
| Clipboard | `GetClipboardData` / `SetClipboardData` |
| Wake-on-LAN | Raw UDP socket |

### Linux

| Khả năng | API / Framework |
|----------|----------------|
| Chụp màn hình | `XCB/Xlib` (X11), `wlr-screencopy` (Wayland) |
| Điều khiển chuột | Phần mở rộng `XTest` (X11), `wtype` (Wayland) |
| Điều khiển bàn phím | Phần mở rộng `XTest` (X11), `wtype` (Wayland) |
| Accessibility | `AT-SPI2` qua D-Bus |
| Desktop ảo | `_NET_CURRENT_DESKTOP` (X11), Sway IPC (Wayland) |
| Quản lý tiến trình | Hệ thống tập tin `/proc`, `kill(2)` |
| Hệ thống tập tin | Node.js `fs` |
| Cấu hình mạng | `ip`, `nmcli`, `systemd-resolved` |
| Tường lửa | `iptables` / `nftables` |
| Quản lý gói | `apt`, `dnf`, `pacman` |
| Clipboard | `xclip` / `wl-copy` |
| Wake-on-LAN | `ethtool` + raw UDP |

## Native Bindings

Khả năng cụ thể nền tảng yêu cầu mã native. Cấu trúc:

```
src/
├── bindings/
│   ├── macos/
│   │   ├── screen.mm          # Obj-C++ chụp màn hình
│   │   ├── input.mm           # Chuột/bàn phím qua CGEvent
│   │   ├── accessibility.mm   # Wrapper AXUIElement
│   │   └── virtual-desktop.mm # Spaces API
│   ├── windows/
│   │   ├── screen.cpp         # DXGI duplication
│   │   ├── input.cpp          # Wrapper SendInput
│   │   ├── accessibility.cpp  # UIAutomation
│   │   └── virtual-desktop.cpp
│   └── linux/
│       ├── screen.c           # XCB chụp màn hình
│       ├── input.c            # XTest input
│       ├── accessibility.c    # AT-SPI2
│       └── virtual-desktop.c
├── platform/
│   ├── index.ts               # Phát hiện nền tảng + API thống nhất
│   ├── screen.ts              # Chụp màn hình xuyên nền tảng
│   ├── input.ts               # Chuột/bàn phím xuyên nền tảng
│   └── accessibility.ts       # A11y xuyên nền tảng
```

Phương pháp binding: **N-API** (Node.js Native Addon API) để tương thích tối đa.

## Mô Hình Triển Khai

### Desktop Cá Nhân (Một Máy)
```
Cài đặt: npm install -g omnistate
Khởi động: omnistate gateway
Cấu hình: ~/.omnistate/config.json
```

### Server Gia Đình (Đa Máy)
```
Chỉ huy:   omnistate gateway --fleet-commander
Agent:     omnistate gateway --fleet-agent --commander=<ip>
Mạng:      Mesh Tailscale hoặc LAN cục bộ
```

### Doanh Nghiệp (Đội Máy)
```
Chỉ huy:   Server quản lý trung tâm
Agent:     omnistate gateway --fleet-agent trên mỗi máy trạm
Khám phá:  Tailscale tags / Active Directory / đăng ký thủ công
Chính sách: Cấu hình tập trung đẩy qua fleet sync
```
