# Giám Sát Sức Khỏe — Cỗ Máy Tự Hồi Phục

Bộ Giám Sát Sức Khỏe là chó canh (watchdog) luôn hoạt động của OmniState. Nó liên tục giám sát sức khỏe hệ thống và chủ động sửa chữa vấn đề trước khi ảnh hưởng đến người dùng.

## Kiến Trúc

```
+--------------------------------------------------------------+
|                  BỘ GIÁM SÁT SỨC KHỎE                        |
|                                                               |
|  +----------------------------------------------------------+|
|  |                  MẢNG CẢM BIẾN                            ||
|  |                                                          ||
|  |  +--------+ +--------+ +--------+ +--------+ +--------+ ||
|  |  |  CPU   | |  RAM   | |  Ổ đĩa | | Mạng   | |Tiến    | ||
|  |  |Giám sát| |Giám sát| |Giám sát| |Giám sát| |trình   | ||
|  |  |        | |        | |        | |        | |Giám sát| ||
|  |  +---+----+ +---+----+ +---+----+ +---+----+ +---+----+ ||
|  |      |          |          |          |          |        ||
|  +------+----------+----------+----------+----------+--------+|
|         |          |          |          |          |          |
|         v          v          v          v          v          |
|  +----------------------------------------------------------+|
|  |             BỘ PHÁT HIỆN BẤT THƯỜNG                      ||
|  |                                                          ||
|  |  Quy tắc ngưỡng | Phân tích xu hướng | So khớp mẫu     ||
|  |  Học baseline | Tương quan chéo                          ||
|  +----------------------------+-----------------------------+|
|                               |                               |
|                               v                               |
|  +----------------------------------------------------------+|
|  |             ĐỘNG CƠ QUYẾT ĐỊNH                           ||
|  |                                                          ||
|  |  Đánh giá mức độ | Phân tích tác động | Chọn hành động   ||
|  +----------------------------+-----------------------------+|
|                               |                               |
|            +------------------+------------------+            |
|            v                  v                  v            |
|  +-------------+  +------------------+  +---------------+    |
|  | TỰ SỬA CHỮA|  | THÔNG BÁO        |  | GHI LOG &     |    |
|  | (Nền)       |  | NGƯỜI DÙNG       |  | THEO DÕI      |    |
|  +-------------+  +------------------+  +---------------+    |
+--------------------------------------------------------------+
```

## Cảm Biến

### Giám Sát CPU
```json5
{
  metric: "cpu",
  checks: [
    { name: "su_dung_tong_the", threshold: 90, window: "30s", action: "dieu_tra" },
    { name: "spike_tien_trinh", threshold: 80, window: "10s", action: "xac_dinh_tien_trinh" },
    { name: "cao_keo_dai", threshold: 70, window: "5m", action: "canh_bao" },
    { name: "throttle_nhiet", condition: "nhiet_do > 95C", action: "giam_tai" },
  ],
}
```

### Giám Sát RAM
```json5
{
  metric: "memory",
  checks: [
    { name: "ap_luc_bo_nho", threshold: 85, action: "xac_dinh_nguoi_tieu_thu" },
    { name: "phat_hien_ro_ri", pattern: "tang_don_dieu_trong_1h", action: "danh_dau_tien_trinh" },
    { name: "su_dung_swap", threshold: 50, action: "canh_bao" },
    { name: "tien_trinh_zombie", condition: "state=zombie && age > 5m", action: "don_dep" },
  ],
}
```

### Giám Sát Ổ Đĩa
```json5
{
  metric: "disk",
  checks: [
    { name: "dung_luong", threshold: 90, action: "xac_dinh_file_lon" },
    { name: "inode", threshold: 85, action: "canh_bao" },
    { name: "do_tre_io", threshold: "50ms_trung_binh_1m", action: "dieu_tra" },
    { name: "file_tam_phat_trien", path: ["/tmp", "$TMPDIR"], maxAge: "24h", action: "don_dep" },
  ],
}
```

### Giám Sát Mạng
```json5
{
  metric: "network",
  checks: [
    { name: "ket_noi", targets: ["1.1.1.1", "8.8.8.8"], interval: "30s" },
    { name: "phan_giai_dns", targets: ["google.com", "github.com"], timeout: "5s" },
    { name: "trang_thai_interface", watchInterfaces: ["en0", "en1", "wlan0"] },
    { name: "bat_thuong_bandwidth", pattern: "sut_hoac_tang_dot_ngot", action: "dieu_tra" },
    { name: "xung_dot_ip", method: "arp_scan", action: "canh_bao" },
  ],
}
```

### Giám Sát Tiến Trình
```json5
{
  metric: "process",
  checks: [
    { name: "tien_trinh_zombie", condition: "state=zombie", action: "don_dep" },
    { name: "tien_trinh_mo_coi", condition: "ppid=1 && khong_phai_daemon", action: "danh_dau" },
    { name: "tien_trinh_mat_kiem_soat", condition: "cpu > 80% && duration > 5m", action: "dieu_tra" },
    { name: "dich_vu_quan_trong_chet", watchList: ["sshd", "omnistate-gateway"], action: "khoi_dong_lai" },
  ],
}
```

## Phát Hiện Bất Thường

### Quy Tắc Ngưỡng
Kiểm tra biên đơn giản — "nếu metric > X trong Y giây, kích hoạt hành động."

### Phân Tích Xu Hướng
Phát hiện vấn đề chậm rì:
- Sử dụng bộ nhớ tăng 1% mỗi giờ → rò rỉ bộ nhớ
- Dung lượng ổ đĩa giảm 500MB mỗi ngày → áp lực lưu trữ
- Baseline CPU dịch chuyển lên → suy giảm hiệu năng

### So Khớp Mẫu
Nhận diện dấu hiệu vấn đề đã biết:
- "CPU cao + I/O đĩa cao + RAM thấp" → Thrashing swap
- "DNS lỗi + Gateway vẫn truy cập được" → Cấu hình DNS sai
- "Tiến trình khởi động lại liên tục" → Vòng lặp crash (đừng tiếp tục restart)

### Tương Quan Chéo
Đối chiếu nhiều cảm biến:
- Mạng rớt + tiến trình cụ thể crash → Tiến trình đó gây lỗi mạng
- RAM cao + app cụ thể → Rò rỉ bộ nhớ trong app đó

## Chiến Lược Tự Sửa Chữa

### Ví dụ UC-3.1: Ngăn Rò Rỉ Bộ Nhớ

```
Phát hiện: App X sử dụng bộ nhớ tăng tuyến tính (dấu hiệu rò rỉ)
    |
    v
Đánh giá: Hiện tại 60%, dự kiến đạt 90% trong 2 giờ nữa
    |
    v
Hành động: Khởi động lại App X một cách nhẹ nhàng (lưu trạng thái nếu có thể)
    |
    v
Xác minh: Bộ nhớ đã giải phóng, app chạy bình thường
    |
    v
Báo cáo: "App X đang ngốn bộ nhớ bất thường (phát hiện rò rỉ bộ nhớ).
          Đã tự động khởi động lại. Sử dụng bộ nhớ hiện tại: 35%."
```

### Ví dụ UC-3.2: Chẩn Đoán Mạng Tận Gốc

```
Phát hiện: Mất kết nối Internet
    |
    v
Chẩn đoán (sâu, không chỉ "tắt bật WiFi"):
  1. Kiểm tra interface vật lý → UP/DOWN?
  2. Kiểm tra cấp phát IP → Lease DHCP còn hiệu lực?
  3. Kiểm tra xung đột IP → Quét ARP tìm trùng lặp
  4. Kiểm tra gateway mặc định → Ping được không?
  5. Kiểm tra DNS → Phân giải tên miền đã biết
  6. Kiểm tra DNS server cụ thể → 1.1.1.1, 8.8.8.8
    |
    v
Nguyên nhân gốc: DNS server 192.168.1.1 không phản hồi, DNS thay thế hoạt động
    |
    v
Hành động: Chuyển DNS sang 1.1.1.1 + 8.8.8.8 (tạm thời)
    |
    v
Xác minh: Kết nối Internet đã phục hồi
    |
    v
Báo cáo: "Mạng bị đứt do DNS của router gặp sự cố.
          Đã tạm chuyển sang DNS Cloudflare (1.1.1.1).
          Sẽ chuyển lại khi DNS router phục hồi."
```

### Ví dụ UC-3.3: Dọn Dẹp Tiến Trình Xác Sống

```
Phát hiện: 3 tiến trình zombie từ App Y (đã đóng 10 phút trước)
    |
    v
Đánh giá: Zombie đang ngốn tổng cộng 15% CPU
    |
    v
Hành động: Gửi SIGTERM, đợi 5 giây, SIGKILL nếu vẫn còn
    |
    v
Xác minh: Tiến trình đã được dọn sạch, CPU đã giải phóng
    |
    v
Báo cáo: "Đã dọn dẹp 3 tiến trình mồ côi từ App Y.
          Giải phóng 15% CPU. Hiệu năng hệ thống đã phục hồi."
```

## Cấu Hình

```json5
// ~/.omnistate/config.json
{
  health: {
    enabled: true,
    intervalMs: 30000,                   // Kiểm tra mỗi 30 giây
    autoRepair: true,                    // Cho phép tự sửa chữa
    
    severity: {
      critical: { autoRepair: true, notify: true },
      warning: { autoRepair: true, notify: false },
      info: { autoRepair: false, notify: false },
    },
    
    // Không đụng đến các tiến trình này dù chúng có trông bất thường
    protectedProcesses: [
      "Finder", "WindowServer", "kernel_task", "launchd",
      "loginwindow", "SystemUIServer",
    ],
    
    // Tối đa số lần sửa chữa mỗi giờ (ngăn vòng lặp sửa chữa)
    maxRepairsPerHour: 10,
    
    // Kênh thông báo
    notifyChannel: "telegram",
    notifyOnlyAbove: "warning",
    
    // Chế độ học: quan sát N ngày trước khi bật tự sửa chữa
    learningPeriodDays: 3,
  },
}
```

## Định Dạng Báo Cáo Sức Khỏe

```json5
{
  timestamp: "2026-04-08T10:30:00Z",
  overall: "healthy",               // "healthy" | "degraded" | "critical"
  uptime: "5 ngày 12 giờ 30 phút",
  sensors: {
    cpu: { status: "ok", usage: 23, temperature: 62 },
    memory: { status: "ok", used: 8.2, total: 16, pressure: "nominal" },
    disk: { status: "warning", used: "420GB", total: "500GB", percent: 84 },
    network: { status: "ok", interfaces: { en0: "up", en1: "down" } },
    processes: { status: "ok", total: 312, zombies: 0, highCpu: [] },
  },
  recentRepairs: [
    { time: "2 giờ trước", action: "Đã dọn 2 tiến trình zombie từ Chrome", severity: "info" },
  ],
  recommendations: [
    "Ổ đĩa đã dùng 84%. Cân nhắc dọn ~/Library/Caches (có thể thu hồi 12GB).",
  ],
}
```
