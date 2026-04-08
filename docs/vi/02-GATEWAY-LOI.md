# Gateway Lõi

Gateway là daemon trung tâm của OmniState — nguồn sự thật duy nhất cho mọi điều phối tác vụ, trạng thái phiên, và phối hợp hệ thống.

## Kiến Trúc (Lấy cảm hứng từ OpenClaw Gateway)

```
+---------------------------------------------------------------+
|                      OMNISTATE GATEWAY                         |
|                                                                |
|  +-----------+  +----------+  +-----------+  +-------------+  |
|  | WS Server |  | REST API |  | IPC Socket|  | Event Bus   |  |
|  +-----------+  +----------+  +-----------+  +-------------+  |
|        |              |             |               |          |
|        v              v             v               v          |
|  +----------------------------------------------------------+ |
|  |                 BỘ PHÂN PHỐI YÊU CẦU                     | |
|  |  Xác thực | Giới hạn tốc độ | Phân loại ý định | Định tuyến| |
|  +---------------------------+------------------------------+ |
|                              |                                 |
|         +--------------------+--------------------+            |
|         v                    v                    v            |
|  +-----------+  +------------------+  +----------------+      |
|  | Bộ Phân   |  | Bộ Lập Kế Hoạch  |  | Kho Phiên      |      |
|  | Tích NL   |  | (Máy Trạng Thái) |  | (JSONL + JSON) |      |
|  | (LLM)     |  |                  |  |                |      |
|  +-----------+  +------------------+  +----------------+      |
|                          |                                     |
|                          v                                     |
|  +----------------------------------------------------------+ |
|  |           HÀNG ĐỢI THỰC THI (theo Lane)                  | |
|  |  lane task:<id> | lane chung | lane cron | lane đội máy  | |
|  +----------------------------------------------------------+ |
|                          |                                     |
|                          v                                     |
|  +----------------------------------------------------------+ |
|  |                REGISTRY PLUGIN                            | |
|  |  Plugin Sâu | Plugin Mặt | Plugin Đội Máy               | |
|  |  Plugin Sức Khỏe | Plugin Xác Minh                       | |
|  +----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

## Vòng Đời Gateway

### Khởi động
1. Đọc cấu hình từ `~/.omnistate/config.json`
2. Khởi tạo registry plugin và nạp các plugin được bật
3. Khởi động Bộ Giám Sát Sức Khỏe (watchdog nền)
4. Mở IPC socket cho CLI cục bộ
5. Mở WebSocket server cho client từ xa/UI
6. Phục hồi các tác vụ chưa hoàn thành đã lưu

### Trạng thái ổn định
- Nhận lệnh qua NL, CLI, WS, REST, hoặc trigger lịch trình
- Định tuyến đến tầng thực thi phù hợp
- Duy trì trạng thái phiên và phát sự kiện cho client kết nối
- Chạy kiểm tra sức khỏe theo khoảng thời gian cấu hình

### Tắt máy
- Bình thường: hoàn thành bước tác vụ hiện tại, lưu trạng thái, thông báo đội máy
- Khẩn cấp: dump bản chụp trạng thái, dừng mọi thực thi

## Giao Thức Kết Nối (Thừa kế từ OpenClaw)

```
Client -> Gateway:  { type: "connect", auth: { token: "..." }, role: "cli" | "ui" | "remote" | "fleet-agent" }
Gateway -> Client:  { type: "connected", capabilities: [...], health: {...} }

Client -> Gateway:  { type: "task", goal: "Lấy số liệu từ Excel, nhập vào phần mềm nội bộ..." }
Gateway -> Client:  { type: "task.accepted", taskId: "...", plan: {...} }
Gateway -> Client:  { type: "task.step", taskId: "...", step: 3, status: "executing", layer: "surface" }
Gateway -> Client:  { type: "task.verify", taskId: "...", step: 3, screenshot: "base64..." }
Gateway -> Client:  { type: "task.complete", taskId: "...", result: {...} }
```

## Cấu Hình

```json5
// ~/.omnistate/config.json
{
  gateway: {
    bind: "127.0.0.1",
    port: 19800,
    auth: {
      token: "OMNISTATE_TOKEN",       // Bắt buộc cho truy cập từ xa
      localAutoApprove: true,          // Tự động phê duyệt kết nối loopback
    },
  },
  
  execution: {
    defaultLayer: "auto",              // "auto" | "deep" | "surface"
    maxRetries: 3,
    retryBackoffMs: [1000, 3000, 10000],
    verifyAfterEachStep: true,
    screenshotOnError: true,
  },
  
  session: {
    store: "~/.omnistate/sessions/sessions.json",
    transcriptDir: "~/.omnistate/sessions/",
    maintenance: {
      mode: "enforce",
      pruneAfter: "30d",
      maxEntries: 500,
    },
  },
  
  fleet: {
    enabled: false,
    discoveryMode: "tailscale",        // "tailscale" | "manual" | "mdns"
    agents: [],                         // Danh sách agent thủ công
  },
  
  health: {
    enabled: true,
    intervalMs: 30000,
    autoRepair: true,
    notifyChannel: "telegram",          // Gửi cảnh báo sức khỏe qua kênh nào
  },
  
  plugins: {
    dir: "~/.omnistate/plugins/",
    enabled: [],
  },
}
```

## Hệ Thống Sự Kiện

Gateway phát sự kiện có kiểu dữ liệu cho mọi client kết nối:

| Sự kiện | Mô tả |
|---------|-------|
| `task.accepted` | Tác vụ đã được lập kế hoạch và chấp nhận |
| `task.step` | Một bước trong kế hoạch đang bắt đầu/hoàn thành |
| `task.verify` | Kết quả xác minh cho bước đã hoàn thành |
| `task.retry` | Bước thất bại và đang thử lại |
| `task.error` | Lỗi không thể phục hồi trong thực thi tác vụ |
| `task.complete` | Tác vụ hoàn thành thành công |
| `health.alert` | Phát hiện vấn đề sức khỏe hệ thống |
| `health.repair` | Đã thực hiện hành động tự sửa chữa |
| `fleet.status` | Cập nhật trạng thái agent đội máy |
| `fleet.sync` | Sự kiện đồng bộ đội máy |

## Các Bất Biến

1. **Một Gateway duy nhất mỗi máy** — Chỉ một instance OmniState điều khiển một máy tính
2. **Gateway sở hữu mọi trạng thái** — Client không giữ trạng thái; mọi lưu trữ bền vững nằm phía server
3. **Mọi tác vụ đều có phiên** — Không có thực thi ẩn danh/không trạng thái
4. **Xác thực bắt buộc cho truy cập từ xa** — Kết nối cục bộ có thể tự động phê duyệt; từ xa luôn yêu cầu token
