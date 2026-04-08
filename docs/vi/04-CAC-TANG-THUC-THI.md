# Các Tầng Thực Thi

OmniState hoạt động qua ba tầng thực thi riêng biệt. Bộ Lập Kế Hoạch tự động chọn tầng tối ưu cho mỗi bước, hoặc người dùng có thể ép chọn tầng cụ thể.

---

## Tầng 1: Tầng Sâu (Deep Layer)

Thao tác trực tiếp cấp OS, bỏ qua giao diện đồ họa. Nhanh, đáng tin cậy, và vô hình với người dùng.

### Kiến Trúc

```
+--------------------------------------------------------------+
|                        TẦNG SÂU                               |
|                                                               |
|  +------------------+  +------------------+  +-----------+   |
|  | Quản Lý Tiến     |  | Thao Tác Hệ     |  | Mạng      |   |
|  | Trình            |  | Thống Tập Tin    |  | tường lửa,|   |
|  | kill, spawn,     |  | đọc, ghi,        |  | DNS, proxy|   |
|  | giám sát, inject |  | theo dõi, tìm    |  |           |   |
|  +------------------+  +------------------+  +-----------+   |
|                                                               |
|  +------------------+  +------------------+  +-----------+   |
|  | Registry/Config  |  | Terminal/Shell   |  | GPU Frame |   |
|  | plist, registry,  |  | bash, powershell,|  | buffer    |   |
|  | systemd, launchd  |  | thực thi lệnh    |  | capture   |   |
|  +------------------+  +------------------+  +-----------+   |
|                                                               |
|  +------------------+  +------------------+  +-----------+   |
|  | Quản Lý Gói      |  | Quản Lý Clipboard|  | Âm Thanh  |   |
|  | brew, apt, choco, |  | đọc/ghi clip     |  | capture,  |   |
|  | npm, pip          |  | theo dõi lịch sử |  | playback  |   |
|  +------------------+  +------------------+  +-----------+   |
+--------------------------------------------------------------+
```

### Khả Năng

| Danh mục | Thao tác |
|----------|----------|
| **Tiến trình** | Liệt kê, kill, spawn, giám sát CPU/RAM, inject biến môi trường |
| **Hệ thống tập tin** | Đọc/ghi/tìm/theo dõi file, phân tích dữ liệu có cấu trúc (Excel, CSV, JSON, PDF) |
| **Mạng** | Quy tắc tường lửa, cấu hình DNS, cài đặt proxy, quét port, kiểm tra kết nối |
| **Cấu hình** | Đọc/ghi plist (macOS), registry (Windows), dịch vụ systemd/launchd |
| **Terminal** | Thực thi lệnh shell, capture output, quản lý job nền |
| **GPU Framebuffer** | Đọc màn hình trực tiếp không cần chụp ảnh (độ trễ mili-giây) |
| **Desktop ảo** | Tạo/chuyển/xóa workspace vô hình cho tác vụ nền |
| **Quản lý gói** | Cài/cập nhật/gỡ phần mềm qua nhiều trình quản lý gói |
| **Clipboard** | Đọc/ghi nội dung clipboard, theo dõi lịch sử clipboard |

### Mục Tiêu Hiệu Năng

- Đọc file: < 10ms
- Danh sách tiến trình: < 50ms
- Quy tắc tường lửa: < 100ms
- Dispatch lệnh shell: < 20ms

---

## Tầng 2: Tầng Mặt (Surface Layer)

Tương tác UI trực quan, giống con người. Sử dụng khi không có API/CLI cho ứng dụng đích.

### Kiến Trúc

```
+--------------------------------------------------------------+
|                       TẦNG MẶT                                |
|                                                               |
|  +-----------------------------------------------------------+
|  |                ĐỘNG CƠ NHẬN THỨC                          |
|  |                                                           |
|  |  +---------------+  +------------------+  +------------+ |
|  |  | Chụp Màn Hình |  | Mô Hình Thị Giác|  | Phát Hiện  | |
|  |  | (Framebuffer  |  | (Hiểu UI)       |  | Phần Tử    | |
|  |  |  hoặc Ảnh)    |  | Ngữ cảnh + Ý đồ |  | (Ngữ nghĩa)| |
|  |  +-------+-------+  +--------+---------+  +------+-----+ |
|  |          |                    |                    |       |
|  |          v                    v                    v       |
|  |  +----------------------------------------------------+  |
|  |  |           MÔ HÌNH TRẠNG THÁI UI (Bản Đồ Màn Hình)  |  |
|  |  |  Phần tử: nút, trường, menu, văn bản, hình ảnh      |  |
|  |  |  Trạng thái: focus, enabled, visible, vị trí         |  |
|  |  |  Quan hệ: cha, anh em, label-for                     |  |
|  |  +----------------------------------------------------+  |
|  +-----------------------------------------------------------+
|                              |
|  +-----------------------------------------------------------+
|  |                  ĐỘNG CƠ HÀNH ĐỘNG                        |
|  |                                                           |
|  |  +---------------+  +------------------+  +------------+ |
|  |  | Điều Khiển    |  | Điều Khiển       |  | Cử Chỉ     | |
|  |  | Chuột         |  | Bàn Phím         |  | kéo, thả,  | |
|  |  | di, click,    |  | gõ, phím tắt,    |  | vuốt       | |
|  |  | cuộn, kéo     |  | hotkey, IME      |  |            | |
|  |  +---------------+  +------------------+  +------------+ |
|  |                                                           |
|  |  +----------------------------------------------------+  |
|  |  |         ĐỘNG CƠ HÀNH VI GIỐNG NGƯỜI                |  |
|  |  |  Đường cong Bezier cho chuột | Tốc độ gõ biến thiên |  |
|  |  |  Micro-delay ngẫu nhiên | Pattern cuộn tự nhiên     |  |
|  |  |  Focus trước khi click | Tab giữa các trường       |  |
|  |  +----------------------------------------------------+  |
|  +-----------------------------------------------------------+
+--------------------------------------------------------------+
```

### Hành Vi Giống Người

Để đánh bại hệ thống chống bot và đảm bảo tương tác tự nhiên:

| Hành vi | Cách thực hiện |
|---------|---------------|
| Di chuyển chuột | Đường cong Bezier với điểm điều khiển ngẫu nhiên, tốc độ biến thiên |
| Tốc độ gõ | 50-120ms mỗi phím với phân phối Gaussian |
| Thời gian click | Trễ 80-200ms trước khi click sau khi chuột đến |
| Cuộn | Cuộn mượt mà với mô phỏng quán tính |
| Focus | Luôn di chuyển focus đến phần tử trước khi tương tác |
| Tạm dừng | Tạm dừng tự nhiên giữa các hành động đa bước (200-500ms) |

### Hồ Sơ App Đã Biết

Với các ứng dụng hay dùng, OmniState duy trì hồ sơ UI đã cache:

```json5
{
  "Zalo": {
    platform: "desktop",
    timKienLienLac: { method: "click-thanh-tim-kiem → gõ-tên → chọn-kết-quả" },
    guiTinNhan: { method: "gõ-trong-khung-chat → nhấn-enter" },
    guiFile: { method: "click-đính-kèm → duyệt-file → chọn-file" },
  },
  "Microsoft Excel": {
    platform: "desktop",
    docDuLieu: { method: "ưu-tiên-tầng-sâu", fallback: "surface-select-all-copy" },
    ghiDuLieu: { method: "surface-click-ô-rồi-gõ" },
  },
}
```

---

## Tầng 3: Tầng Mạng Lưới (Fleet Layer)

Phối hợp đa máy tính. Một instance OmniState đóng vai **Chỉ Huy Đội**, các máy khác là **Agent Đội**.

### Kiến Trúc

```
+--------------------------------------------------------------+
|                     CHỈ HUY ĐỘI (Fleet Commander)            |
|                                                               |
|  +------------------+  +------------------+  +------------+  |
|  | Khám Phá Agent   |  | Phân Phối Tác Vụ |  | Tổng Hợp   |  |
|  | Tailscale/mDNS/  |  | Cân bằng tải     |  | Kết Quả    |  |
|  | Đăng ký thủ công  |  | Quy tắc ưu tiên  |  | Báo cáo    |  |
|  +--------+---------+  +--------+---------+  +------+-----+  |
|           |                     |                    |        |
+--------------------------------------------------------------+
            |                     |                    |
     +------v------+      +------v------+      +------v------+
     | Agent Đội   |      | Agent Đội   |      | Agent Đội   |
     | Máy A       |      | Máy B       |      | Máy C       |
     | (OmniState  |      | (OmniState  |      | (OmniState  |
     |  đầy đủ)    |      |  đầy đủ)    |      |  đầy đủ)    |
     +-------------+      +-------------+      +-------------+
```

### Giao Thức Giao Tiếp Đội

```
Chỉ Huy -> Agent:  { type: "fleet.task", taskId: "...", plan: {...} }
Agent -> Chỉ Huy:  { type: "fleet.accepted", agentId: "...", taskId: "..." }
Agent -> Chỉ Huy:  { type: "fleet.progress", agentId: "...", step: 3, status: "ok" }
Agent -> Chỉ Huy:  { type: "fleet.complete", agentId: "...", result: {...} }
Agent -> Chỉ Huy:  { type: "fleet.error", agentId: "...", error: {...} }
```

### Ví Dụ: "Cập nhật phần mềm trên tất cả máy phòng Marketing"

```json5
{
  fleetTask: {
    goal: "Cập nhật phần mềm X và đổi màn hình nền trên tất cả máy tính phòng Marketing",
    targetGroup: "marketing",
    strategy: "parallel",
    maxConcurrent: 10,
    perMachine: {
      steps: [
        { action: "deep.package.update", params: { package: "software-X" } },
        { action: "deep.config.wallpaper", params: { image: "new-wallpaper.png" } },
      ],
    },
    rollback: {
      onFailurePercent: 30,
      action: "pause-and-notify",    // Tạm dừng và thông báo nếu > 30% máy lỗi
    },
  },
}
```

---

## Ma Trận Chọn Tầng

| Tình huống | Tầng | Lý do |
|-----------|------|-------|
| Đọc file Excel | Sâu | Phân tích qua thư viện nhanh và đáng tin |
| Nhập dữ liệu vào CRM web | Mặt | Không có API, phải dùng giao diện |
| Thay đổi quy tắc tường lửa | Sâu | API OS trực tiếp nhanh và đáng tin hơn |
| Gửi tin nhắn Zalo | Mặt | Zalo desktop không có API công khai |
| Cài phần mềm trên 100 máy | Mạng Lưới + Sâu | Thực thi song song + trình quản lý gói |
| Sao chép dữ liệu từ PDF khóa | Mặt | OCR dựa trên thị giác khi copy bị tắt |
| Giám sát sử dụng RAM | Sâu | API OS cung cấp dữ liệu thời gian thực |
| Điều hướng app lạ | Mặt | Mô hình thị giác khám phá và học UI |
