# Phiên & Quản Lý Trạng Thái

OmniState duy trì trạng thái bền vững xuyên suốt tác vụ, khởi động lại, và thậm chí khi reboot hệ thống. Hệ thống phiên lấy cảm hứng từ quản lý phiên của OpenClaw nhưng mở rộng cho tự động hóa cấp OS.

## Kiến Trúc Trạng Thái

```
~/.omnistate/
├── config.json                     # Cấu hình Gateway
├── sessions/
│   ├── sessions.json               # Kho phiên (khóa -> siêu dữ liệu)
│   ├── <sessionId>.jsonl           # Bản ghi tác vụ (mọi bước, kết quả)
│   └── <sessionId>.screenshots/    # Ảnh chụp xác minh
├── agents/
│   └── <agentId>/
│       ├── state/                  # Trạng thái bền vững riêng agent
│       ├── sessions/               # Kho phiên riêng agent
│       └── profiles/               # Hồ sơ app, bản đồ UI
├── health/
│   ├── baselines.json              # Baseline hệ thống đã học
│   ├── history.jsonl               # Lịch sử sự kiện sức khỏe
│   └── repairs.jsonl               # Nhật ký tự sửa chữa
├── fleet/
│   ├── agents.json                 # Agent đội máy đã biết
│   └── tasks/                      # Kết quả tác vụ đội máy
├── plugins/
│   └── <pluginId>/                 # Trạng thái riêng plugin
├── cache/
│   ├── ui-maps/                    # Bản đồ phần tử UI đã cache theo app
│   ├── app-profiles/               # Mẫu tương tác app đã học
│   └── decisions/                  # Quyết định lập kế hoạch đã cache
└── credentials/                    # Kho thông tin xác thực đã mã hóa
```

## Mô Hình Phiên

### Định Dạng Khóa Phiên

Thừa kế từ pattern khóa phiên OpenClaw:

```
task:<taskId>                              # Tác vụ một lần
scheduled:<cronJobId>                      # Tác vụ lịch trình
fleet:<commanderId>:<taskId>:<agentId>     # Tác vụ đội máy
health:<repairId>                          # Phiên tự sửa chữa
interactive:<channelId>:<userId>           # Phiên chat tương tác
```

### Mục Nhập Kho Phiên

```typescript
interface SessionEntry {
  sessionId: string;              // UUID
  sessionKey: string;             // Khóa định tuyến (xem trên)
  status: "planning" | "executing" | "paused" | "complete" | "failed";
  
  // Siêu dữ liệu tác vụ
  goal: string;                   // Lệnh NL gốc
  plan?: StatePlan;               // Đồ thị trạng thái
  currentNodeId?: string;         // Đang ở đâu trong DAG
  
  // Thời gian
  createdAt: string;              // ISO timestamp
  updatedAt: string;
  completedAt?: string;
  estimatedDurationMs?: number;
  actualDurationMs?: number;
  
  // Ngữ cảnh thực thi
  layer: "deep" | "surface" | "fleet" | "hybrid";
  agentId: string;                // Agent nào sở hữu phiên này
  
  // Kết quả
  stepsCompleted: number;
  stepsTotal: number;
  retryCount: number;
  lastError?: string;
  
  // Sử dụng tài nguyên
  screenshotCount: number;
  llmTokensUsed: number;
  
  // Nguồn gốc (tác vụ được kích hoạt bằng cách nào)
  origin: {
    channel: "cli" | "telegram" | "web" | "voice" | "cron" | "fleet" | "health";
    from?: string;                // Định danh người gửi
  };
}
```

### Định Dạng Bản Ghi (JSONL)

Mỗi dòng trong file bản ghi là một đối tượng JSON:

```json5
// Bản ghi thực thi bước
{ "type": "step.start", "ts": "2026-04-08T10:00:01Z", "nodeId": "doc-excel", "layer": "deep" }
{ "type": "step.action", "ts": "2026-04-08T10:00:01Z", "nodeId": "doc-excel", "tool": "file.read", "params": { "path": "~/Desktop/data.xlsx" } }
{ "type": "step.result", "ts": "2026-04-08T10:00:02Z", "nodeId": "doc-excel", "status": "ok", "data": { "rows": 150, "columns": 8 } }
{ "type": "step.verify", "ts": "2026-04-08T10:00:02Z", "nodeId": "doc-excel", "strategy": "api", "result": "pass" }
{ "type": "step.end", "ts": "2026-04-08T10:00:02Z", "nodeId": "doc-excel", "durationMs": 1200 }

// Bước tầng mặt (bao gồm tham chiếu ảnh chụp)
{ "type": "step.start", "ts": "2026-04-08T10:00:03Z", "nodeId": "mo-app", "layer": "surface" }
{ "type": "step.capture", "ts": "2026-04-08T10:00:03Z", "nodeId": "mo-app", "screenshot": "screenshots/mo-app-truoc.png" }
{ "type": "step.action", "ts": "2026-04-08T10:00:04Z", "nodeId": "mo-app", "tool": "mouse.click", "params": { "target": "Icon App", "x": 512, "y": 340 } }
{ "type": "step.capture", "ts": "2026-04-08T10:00:06Z", "nodeId": "mo-app", "screenshot": "screenshots/mo-app-sau.png" }
{ "type": "step.verify", "ts": "2026-04-08T10:00:07Z", "nodeId": "mo-app", "strategy": "screenshot", "result": "pass", "confidence": 0.94 }

// Bản ghi thử lại
{ "type": "step.retry", "ts": "2026-04-08T10:00:10Z", "nodeId": "nhap-du-lieu", "attempt": 2, "reason": "không tìm thấy phần tử", "strategy": "đợi-và-thử-lại" }

// Hoàn thành tác vụ
{ "type": "task.complete", "ts": "2026-04-08T10:01:30Z", "totalDurationMs": 89000, "stepsCompleted": 5, "retriesUsed": 1 }
```

## Quy Tắc Lưu Trữ Trạng Thái

### Lưu trữ ngay lập tức:
- Kế hoạch tác vụ (khi tạo)
- Kết quả mỗi bước (khi hoàn thành)
- Ảnh chụp xác minh (khi chụp)
- Trạng thái lỗi và quyết định thử lại

### Lưu trữ định kỳ:
- Baseline sức khỏe (mỗi giờ)
- Bản đồ cache UI (khi thay đổi)
- Trạng thái agent đội máy (mỗi heartbeat)

### Không bao giờ lưu trữ:
- Dữ liệu GPU framebuffer (quá lớn, thoáng qua)
- Sự kiện chuột/bàn phím thô (chỉ log hành động)
- Token trung gian LLM (chỉ log quyết định cuối)

## Bảo Trì Phiên (Thừa kế từ OpenClaw)

```json5
{
  session: {
    maintenance: {
      mode: "enforce",               // "warn" | "enforce"
      pruneAfter: "30d",             // Xóa phiên cũ hơn 30 ngày
      maxEntries: 500,               // Giữ tối đa 500 phiên
      rotateBytes: "10mb",           // Xoay sessions.json tại 10MB
      screenshotRetention: "7d",     // Xóa ảnh chụp sau 7 ngày
      maxDiskBytes: "2gb",           // Giới hạn ổ đĩa cứng
    },
  },
}
```

## Phục Hồi & Tiếp Tục

Tác vụ có thể được tiếp tục sau khi bị gián đoạn:

```
Gateway khởi động → Nạp sessions.json
    |
    v
Tìm phiên có trạng thái "executing" hoặc "paused"
    |
    v
Với mỗi phiên có thể phục hồi:
  1. Nạp bản ghi → tìm bước hoàn thành cuối cùng
  2. Nạp kế hoạch → xác định bước tiếp theo
  3. Xác minh lại trạng thái hiện tại (ảnh chụp/kiểm tra API)
  4. Nếu trạng thái khớp kỳ vọng → tiếp tục từ bước tiếp theo
  5. Nếu trạng thái không khớp → lập kế hoạch lại từ trạng thái hiện tại
```

## Chiến Lược Cache (Bản Đồ UI)

Các mẫu tương tác UI đã học được cache để tránh suy luận LLM lặp lại:

```json5
// ~/.omnistate/cache/ui-maps/zalo-desktop.json
{
  appName: "Zalo",
  appVersion: "23.10.1",
  platform: "macOS",
  lastUpdated: "2026-04-08T10:00:00Z",
  
  elements: {
    "tim-lien-lac": {
      type: "textfield",
      location: "trung-tâm-trên",
      accessPath: "click icon tìm kiếm → gõ trong trường",
      confidence: 0.95,
      lastVerified: "2026-04-08T10:00:00Z",
    },
    "gui-tin-nhan": {
      type: "button",
      location: "dưới-phải cửa sổ chat",
      accessPath: "gõ trong khung tin nhắn → nhấn Enter",
      confidence: 0.98,
      lastVerified: "2026-04-08T10:00:00Z",
    },
  },
  
  // Vô hiệu hóa cache nếu phiên bản app thay đổi đáng kể
  validUntil: "2026-05-08",
}
```
