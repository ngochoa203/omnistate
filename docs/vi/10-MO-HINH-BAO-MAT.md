# Mô Hình Bảo Mật

OmniState hoạt động với quyền truy cập hệ thống sâu. Bảo mật không phải suy nghĩ sau — nó là ràng buộc kiến trúc cốt lõi.

## Mô Hình Mối Đe Dọa

### OmniState có thể làm gì
- Đọc/ghi bất kỳ file nào người dùng có quyền truy cập
- Thực thi bất kỳ lệnh nào người dùng có thể chạy
- Điều khiển chuột và bàn phím
- Sửa đổi cấu hình hệ thống (tường lửa, DNS, dịch vụ)
- Vận hành trên nhiều máy tính (chế độ đội máy)

### Các vector tấn công
1. **Prompt injection** — Nội dung độc hại trên màn hình lừa mô hình thị giác thực hiện hành động có hại
2. **Đánh cắp thông tin xác thực** — Token/credentials được lưu bị lộ qua truy cập file
3. **Di chuyển ngang** — Chế độ đội máy bị lợi dụng để lan sang máy khác
4. **Leo thang đặc quyền** — Tầng Sâu được dùng để sửa đổi cài đặt bảo mật
5. **Rút trộm dữ liệu** — Dữ liệu tác vụ gửi đến đích trái phép
6. **Vòng lặp vô tận** — Logic thử lại lỗi gây cạn kiệt tài nguyên

## Kiến Trúc Phòng Thủ

```
+--------------------------------------------------------------+
|                    CÁC TẦNG BẢO MẬT                           |
|                                                               |
|  Tầng 1: XÁC THỰC                                            |
|  +----------------------------------------------------------+|
|  | Xác thực token (từ xa) | Tự động phê duyệt cục bộ | TLS||
|  +----------------------------------------------------------+|
|                                                               |
|  Tầng 2: PHÂN QUYỀN (Mô Hình Quyền Hạn)                    |
|  +----------------------------------------------------------+|
|  | Danh sách cho phép công cụ | Phân loại hành động | Leo thang||
|  +----------------------------------------------------------+|
|                                                               |
|  Tầng 3: SANDBOX                                             |
|  +----------------------------------------------------------+|
|  | Cô lập tiến trình | Ranh giới hệ thống tập tin | ACL mạng||
|  +----------------------------------------------------------+|
|                                                               |
|  Tầng 4: XÁC MINH & KIỂM TOÁN                               |
|  +----------------------------------------------------------+|
|  | Ghi log hành động | Dấu vết ảnh chụp kiểm toán | Phát hiện||
|  +----------------------------------------------------------+|
|                                                               |
|  Tầng 5: CHẶN CỨNG (Không thương lượng)                     |
|  +----------------------------------------------------------+|
|  | Đường dẫn được bảo vệ | Tiến trình được bảo vệ | Giới hạn||
|  +----------------------------------------------------------+|
+--------------------------------------------------------------+
```

## Mô Hình Quyền Hạn (Thừa kế từ Delegate Tier của OpenClaw)

### Cấp 1: Chỉ Đọc (Mặc định cho agent mới)

```json5
{
  permissions: {
    tier: 1,
    allow: ["deep.file.read", "deep.process.list", "surface.capture", "surface.detect"],
    deny: ["deep.file.write", "deep.process.kill", "deep.network.modify", "surface.click", "surface.type"],
  },
}
```

### Cấp 2: Tương Tác (Vận hành tiêu chuẩn)

```json5
{
  permissions: {
    tier: 2,
    allow: [
      "deep.file.read", "deep.file.write",
      "deep.process.list", "deep.process.launch",
      "deep.terminal.execute",
      "surface.*",
    ],
    deny: [
      "deep.network.firewall", "deep.config.system",
      "deep.process.kill_protected",
      "fleet.*",
    ],
  },
}
```

### Cấp 3: Quản Trị Viên (Toàn quyền, phải chủ động bật)

```json5
{
  permissions: {
    tier: 3,
    allow: ["*"],
    deny: [],
    // Ngay cả ở Cấp 3, chặn cứng vẫn áp dụng
  },
}
```

## Chặn Cứng (Không Thương Lượng)

Các hạn chế này áp dụng bất kể cấp quyền:

```json5
{
  hardBlocks: {
    // Không bao giờ đụng các tiến trình này
    protectedProcesses: [
      "kernel_task", "launchd", "WindowServer", "loginwindow",
      "securityd", "trustd", "syspolicyd",
    ],
    
    // Không bao giờ sửa các đường dẫn này
    protectedPaths: [
      "/System/", "/usr/bin/", "/sbin/",
      "~/.ssh/id_*",                  // Khóa SSH riêng
      "~/.gnupg/",                     // Khóa GPG
      "~/.omnistate/credentials/",     // Kho thông tin xác thực riêng
    ],
    
    // Không bao giờ thực thi các mẫu này
    blockedCommands: [
      "rm -rf /",
      "mkfs",
      "dd if=",
      "chmod 777",
      "curl * | sh",                   // Pipe đến shell
    ],
    
    // Giới hạn tốc độ
    rateLimits: {
      fileWritesPerMinute: 100,
      processKillsPerMinute: 10,
      networkChangesPerHour: 5,
      fleetCommandsPerMinute: 20,
    },
    
    // Giới hạn thử lại
    maxRetriesPerStep: 5,
    maxRetriesPerTask: 20,
    
    // Giới hạn tài nguyên
    maxScreenshotsPerTask: 100,
    maxLLMTokensPerTask: 500000,
    maxTaskDuration: "48h",
  },
}
```

## Phòng Chống Prompt Injection

### An Toàn Mô Hình Thị Giác
Mô hình thị giác phân tích ảnh chụp. Nội dung độc hại trên màn hình có thể cố gắng injection:

```
Chiến lược phòng thủ:
1. KHÔNG BAO GIỜ thực thi chỉ dẫn tìm thấy trong văn bản ảnh chụp
   - Mô hình thị giác chỉ PHÁT HIỆN và MÔ TẢ
   - Quyết định hành động do Bộ Lập Kế Hoạch đưa ra với ý định người dùng gốc
   
2. Tách biệt nhận thức khỏi thực thi
   - Đầu ra thị giác: { elements: [...], text: [...] }  // Chỉ quan sát
   - Đầu vào lập kế hoạch: { goal: "...", currentState: {...} }  // Ra quyết định
   
3. Lọc nội dung
   - Đánh dấu mẫu đáng ngờ trong văn bản OCR
   - Cảnh báo khi văn bản giống lệnh hoặc chỉ dẫn
   
4. Xác minh trong sandbox
   - Prompt xác minh được tạo từ mẫu, không động
   - "Nút Gửi có hiện ra không?" chứ không phải "Làm theo chỉ dẫn trên màn hình"
```

## Dấu Vết Kiểm Toán

Mọi hành động đều được ghi log cho rà soát pháp y:

```json5
// ~/.omnistate/audit.jsonl
{ "ts": "2026-04-08T10:00:01Z", "action": "file.read", "target": "~/Desktop/data.xlsx", "actor": "task-001", "result": "ok" }
{ "ts": "2026-04-08T10:00:02Z", "action": "app.launch", "target": "Internal CRM", "actor": "task-001", "result": "ok" }
{ "ts": "2026-04-08T10:00:05Z", "action": "mouse.click", "target": {"x": 512, "y": 340}, "actor": "task-001", "result": "ok" }
{ "ts": "2026-04-08T10:00:06Z", "action": "keyboard.type", "target": "[REDACTED:data]", "actor": "task-001", "result": "ok" }
```

### Chính Sách Kiểm Toán
- Dữ liệu nhạy cảm (mật khẩu, token) bị BIÊN TẬP trong log
- Ảnh chụp được giữ lại theo chính sách `screenshotRetention`
- Log kiểm toán chỉ ghi thêm (append-only) — plugin không thể sửa đổi
- Log kiểm toán đội máy được sao chép về chỉ huy

## Bảo Mật Đội Máy

```
Mô hình tin cậy đội máy:
                     +-------------------+
                     |  Chỉ Huy Đội     |
                     |  (Máy của bạn)   |
                     +--------+----------+
                              |
                     Mutual TLS / Tailscale
                              |
              +---------------+---------------+
              |               |               |
     +--------v-----+ +------v-------+ +-----v--------+
     | Agent Đội    | | Agent Đội    | | Agent Đội    |
     | (Máy A)      | | (Máy B)      | | (Máy C)      |
     +------+-------+ +------+-------+ +------+-------+
            |                |                |
     Kho credentials  Kho credentials  Kho credentials
     riêng           riêng           riêng

Quy tắc:
- Agent không bao giờ chia sẻ credentials với nhau
- Chỉ huy không thể đọc kho credentials cục bộ của agent
- Lệnh đội máy yêu cầu phê duyệt tác vụ rõ ràng cho mỗi agent
- Mỗi agent tự thực thi chặn cứng của riêng mình
- Mạng: ưu tiên Tailscale (mutual TLS không cần cấu hình)
```

## Danh Mục Kiểm Tra Bảo Mật Cho Triển Khai

- [ ] Đặt `gateway.auth.token` cho mọi truy cập không cục bộ
- [ ] Cấu hình `hardBlocks.protectedPaths` cho thư mục nhạy cảm
- [ ] Đặt cấp quyền phù hợp với ca sử dụng (bắt đầu từ Cấp 1)
- [ ] Bật ghi log kiểm toán
- [ ] Cấu hình giới hạn tốc độ
- [ ] Cho đội máy: bật mutual TLS hoặc Tailscale
- [ ] Rà soát và kiểm thử chặn cứng trước khi bật tự sửa chữa
- [ ] Đặt chính sách giữ ảnh chụp
- [ ] Xác minh mã hóa credentials đang hoạt động
