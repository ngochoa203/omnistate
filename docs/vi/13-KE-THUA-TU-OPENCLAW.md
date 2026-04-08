# Kế Thừa Từ OpenClaw — Các Pattern Kiến Trúc

Kiến trúc của OmniState được lấy cảm hứng trực tiếp từ [OpenClaw](https://github.com/openclaw/openclaw). Tài liệu này ánh xạ chi tiết pattern nào của OpenClaw đã được áp dụng, điều chỉnh, hoặc mở rộng.

## Bảng Ánh Xạ Pattern

| Pattern OpenClaw | Áp dụng trong OmniState | Thay đổi chính |
|-----------------|------------------------|---------------|
| **Gateway Daemon** | Gateway OmniState | Mở rộng từ gateway nhắn tin sang gateway tự động hóa OS |
| **Agent Loop** | Vòng Lặp Agent (05) | Thêm giai đoạn xác minh + thử lại sau mỗi bước |
| **Command Queue** | Hàng Đợi Thực Thi (05) | Thêm lane đội máy và lane sức khỏe bên cạnh lane phiên/chung |
| **Multi-Agent Routing** | Tầng Mạng Lưới (04) | Mở rộng từ đa persona sang phối hợp đa máy tính |
| **Session Management** | Phiên & Trạng Thái (08) | Thêm lưu ảnh chụp, bản đồ cache UI, trạng thái DAG tác vụ |
| **Plugin Architecture** | Hệ Thống Plugin (09) | Thêm danh mục plugin Mặt/Sâu/Sức Khỏe/Đội Máy |
| **Delegate Architecture** | Cấp Quyền (10) | Chuyển mô hình ủy quyền tổ chức thành cấp bảo mật theo tác vụ |
| **Context Engine** | Động Cơ Thị Giác (06) | Thay lắp ráp ngữ cảnh LLM bằng pipeline nhận thức màn hình |
| **Channel System** | Điều Khiển Từ Xa (11) | Tái sử dụng pattern Telegram/nhắn tin cho đầu vào lệnh từ xa |
| **Compaction** | Vô hiệu hóa cache UI | Chuyển khái niệm nén phiên sang dọn dẹp bản đồ UI cũ |
| **Standing Orders** | Tác vụ sức khỏe lịch trình | Tái sử dụng pattern cron cho kiểm tra sức khỏe và bảo trì định kỳ |

## Phân Tích Chi Tiết: Các Điều Chỉnh Chính

### 1. Pattern Gateway

**OpenClaw**: Gateway dựa trên WebSocket kết nối ứng dụng chat với AI agent.

**OmniState**: Cùng gateway WebSocket, nhưng thay vì định tuyến tin nhắn đến LLM, nó định tuyến lệnh NL đến các tầng thực thi (Sâu/Mặt/Đội Máy).

```
OpenClaw:   App Chat → Gateway → LLM Agent → Phản hồi
OmniState:  Lệnh NL → Gateway → Bộ Lập Kế Hoạch → Tầng Thực Thi → Xác Minh → Kết Quả
```

### 2. Agent Loop

**OpenClaw**: tiếp nhận → lắp ráp ngữ cảnh → suy luận model → thực thi công cụ → stream phản hồi → lưu trữ.

**OmniState**: tiếp nhận → lập kế hoạch → thực thi → **xác minh** → **thử lại/phục hồi** → lưu trữ.

Bổ sung chính:
- **Giai đoạn xác minh** — Mỗi bước được xác minh trước khi tiến tiếp
- **Thử lại với leo thang chiến lược** — Cùng chiến lược → chiến lược thay thế → đổi tầng → leo thang
- **Đồ thị trạng thái (DAG)** — Không phải chuỗi tuyến tính mà là kế hoạch thực thi có nhánh

### 3. Hệ Thống Queue

**OpenClaw**: FIFO theo lane với lane phiên + lane chung + lane cron.

**OmniState**: Cùng pattern, mở rộng:
- Lane `session:<id>` — Một bước hoạt động mỗi tác vụ
- Lane `global` — Đồng thời tùy cấu hình xuyên tác vụ
- Lane `fleet` — Thực thi đội máy song song
- Lane `cron` — Tác vụ sức khỏe và bảo trì lịch trình
- Lane `health` — Tự sửa chữa khẩn cấp (ưu tiên cao nhất)

### 4. Lưu Trữ Phiên

**OpenClaw**: `sessions.json` (khóa→siêu dữ liệu) + `<sessionId>.jsonl` (bản ghi).

**OmniState**: Cùng pattern, mở rộng:
- `sessions.json` — Siêu dữ liệu tác vụ với trạng thái tiến độ DAG
- `<sessionId>.jsonl` — Bản ghi thực thi từng bước
- `<sessionId>.screenshots/` — Ảnh chụp xác minh theo tác vụ
- `cache/ui-maps/` — Vị trí phần tử UI đã học theo app

### 5. Hệ Thống Plugin

**OpenClaw**: Gói npm với manifest `openclaw.plugin.json`, đăng ký qua `api.register*()`.

**OmniState**: Cùng pattern, nhưng với danh mục plugin chuyên biệt:
- Plugin OpenClaw: kết nối kênh, plugin bộ nhớ, engine ngữ cảnh
- Plugin OmniState: thao tác sâu, tự động bề mặt, cảm biến sức khỏe, mở rộng đội máy

### 6. Mô Hình Bảo Mật

**OpenClaw**: Kiến trúc delegate với 3 cấp (Chỉ Đọc, Gửi Thay, Chủ Động) + chặn cứng.

**OmniState**: Điều chỉnh cho ngữ cảnh tự động hóa OS:
- Cấp 1: Chỉ Đọc (quan sát hệ thống, không sửa đổi)
- Cấp 2: Tương Tác (thao tác chuột/bàn phím, chạy lệnh)
- Cấp 3: Quản Trị Viên (sửa cấu hình hệ thống, điều khiển đội máy)
- Chặn cứng: Tiến trình được bảo vệ, đường dẫn được bảo vệ, giới hạn tốc độ, giới hạn thử lại

## OmniState Bổ Sung Gì So Với OpenClaw

| Khả năng | OpenClaw | OmniState |
|----------|---------|-----------|
| Hiểu UI trực quan | Không có | Động cơ thị giác với phát hiện đa chiến lược |
| Điều khiển chuột/bàn phím | Không có | Động cơ hành vi giống người với chống phát hiện bot |
| Desktop ảo | Không có | Workspace vô hình cho tự động hóa nền |
| Chụp GPU framebuffer | Không có | Chụp màn hình dưới 5ms không cần screenshot |
| Giám sát sức khỏe hệ thống | Sức khỏe gateway cơ bản | Sức khỏe OS đầy đủ với cảm biến, phát hiện bất thường, tự sửa chữa |
| Điều phối đội máy | Định tuyến đa agent (cùng host) | Phối hợp đa máy với khám phá và đồng bộ |
| Lập kế hoạch đồ thị trạng thái | Agent loop tuyến tính | Lập kế hoạch tác vụ dạng DAG với nhánh và dự phòng |
| Tích hợp OS native | Thực thi CLI/shell | Binding API nền tảng trực tiếp (Obj-C++, Win32, X11) |

## Căn Chỉnh Triết Lý

Cả hai dự án chia sẻ triết lý cốt lõi:
1. **Một daemon duy nhất** — Một nguồn sự thật, không phức tạp trạng thái phân tán
2. **Plugin-first** — Lõi gọn nhẹ, khả năng mở rộng qua plugin
3. **Lưu trữ phiên bền vững** — Mọi thứ đều được log, có thể phục hồi, kiểm toán được
4. **Bảo mật mặc định** — Mặc định hạn chế, chủ động bật cho tính năng mạnh
5. **Tự host** — Người dùng kiểm soát dữ liệu và phần cứng của chính mình
