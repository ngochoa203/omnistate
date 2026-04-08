# Bộ Lập Kế Hoạch — Động Cơ Đồ Thị Trạng Thái

Bộ Lập Kế Hoạch là bộ não của OmniState. Nó chuyển đổi mục tiêu bằng ngôn ngữ tự nhiên thành đồ thị trạng thái có thể thực thi — kế hoạch có cấu trúc mà Bộ Điều Phối Thực Thi có thể chạy từng bước.

## Triết Lý Thiết Kế

Lấy cảm hứng từ Agent Loop của OpenClaw (tiếp nhận → suy luận → công cụ → lưu trữ), nhưng mở rộng cho tự động hóa trực quan/cấp OS:

```
Mục tiêu (NL) → Phân loại ý định → Xây dựng đồ thị trạng thái → Thực thi → Xác minh → Lưu trữ
```

## Mô Hình Đồ Thị Trạng Thái

Mọi tác vụ được phân rã thành một **Đồ Thị Có Hướng Không Chu Trình (DAG)** gồm các trạng thái:

```
                    +--------+
                    | MỤC    |
                    | TIÊU   |
                    | (Gốc)  |
                    +---+----+
                        |
              +---------+---------+
              |                   |
         +----v----+         +----v----+
         | Bước 1  |         | Bước 2  |
         | (Sâu)   |         | (Sâu)   |
         | Đọc     |         | Mở      |
         | Excel   |         | App X   |
         +----+----+         +----+----+
              |                   |
              |         +---------+---------+
              |         |                   |
              |    +----v----+         +----v----+
              |    | Bước 2a |         | Bước 2b |
              |    | (Mặt)   |         | (Mặt)   |
              |    | Điều    |         | Đợi     |
              |    | hướng   |         | Tải     |
              |    | đến Form|         | Xong    |
              |    +----+----+         +----+----+
              |         |                   |
              +---------+---------+---------+
                        |
                   +----v----+
                   | Bước 3  |
                   | (Mặt)   |
                   | Nhập    |
                   | Dữ liệu |
                   +----+----+
                        |
                   +----v----+
                   | Bước 4  |
                   | (Sâu)   |
                   | Mở      |
                   | Zalo    |
                   +----+----+
                        |
                   +----v----+
                   | Bước 5  |
                   | (Mặt)   |
                   | Gửi     |
                   | Báo cáo |
                   +----+----+
                        |
                   +----v----+
                   | XÁC     |
                   | MINH    |
                   | (Cuối)  |
                   +----+----+
```

## Schema Nút Trạng Thái

```typescript
interface StateNode {
  id: string;                          // Mã định danh bước duy nhất
  type: "action" | "verify" | "branch" | "wait" | "goal";
  layer: "deep" | "surface" | "auto";  // Chọn tầng thực thi
  
  // Hành động
  action: {
    description: string;               // Mô tả dễ đọc cho con người
    tool: string;                       // Plugin/công cụ cần gọi
    params: Record<string, unknown>;    // Tham số cụ thể cho công cụ
  };
  
  // Xác minh
  verify?: {
    strategy: "screenshot" | "api" | "file" | "process" | "compound";
    expected: string;                   // Thành công trông như thế nào (NL hoặc có cấu trúc)
    timeout: number;                    // Thời gian chờ tối đa (ms)
  };
  
  // Điều khiển luồng
  dependencies: string[];              // ID các nút phải hoàn thành trước
  onSuccess: string | null;            // ID nút tiếp theo
  onFailure: {
    strategy: "retry" | "alternative" | "escalate" | "abort";
    maxRetries?: number;
    alternativeNodeId?: string;
  };
  
  // Siêu dữ liệu
  estimatedDurationMs: number;
  priority: "critical" | "normal" | "background";
}
```

## Pipeline Lập Kế Hoạch

### Giai đoạn 1: Phân Loại Ý Định
```
"Lấy số liệu từ Excel trên Desktop, nhập vào phần mềm nội bộ, rồi mở Zalo gửi báo cáo cho sếp"
                                    |
                                    v
{
  intent: "cross-app-data-transfer",
  entities: {
    source: { type: "file", format: "excel", location: "Desktop" },
    destination: { type: "app", name: "phần-mềm-nội-bộ", action: "nhập-dữ-liệu" },
    delivery: { type: "app", name: "Zalo", recipient: "sếp", content: "báo-cáo" }
  }
}
```

### Giai đoạn 2: Đánh Giá Khả Năng
Với mỗi thực thể, xác định tầng thực thi tốt nhất:
- File Excel → **Tầng Sâu** (đọc qua thư viện, không cần UI)
- Phần mềm nội bộ → **Tầng Mặt** (không có API, phải dùng giao diện)
- Zalo → **Tầng Mặt** (ứng dụng desktop, tương tác trực quan)

### Giai đoạn 3: Xây Dựng Đồ Thị
Xây dựng DAG với các nút xác minh giữa mỗi chuyển đổi lớn.

### Giai đoạn 4: Tối Ưu Hóa
- Song song hóa các nhánh độc lập
- Chèn thời gian chờ chiến lược (tải app, yêu cầu mạng)
- Thêm đường dự phòng cho các chế độ lỗi đã biết

## Hợp Đồng Kế Hoạch (Mỗi Giai Đoạn)

Mọi kế hoạch phải bao gồm (thừa kế từ quy tắc điều phối OpenClaw):

| Trường | Mô tả |
|--------|-------|
| `phase` | Mã định danh giai đoạn |
| `goal` | Giai đoạn này đạt được gì |
| `owner` | Tầng thực thi nào sở hữu nó |
| `inputs` | Dữ liệu/trạng thái cần thiết từ giai đoạn trước |
| `deliverables` | Giai đoạn này tạo ra gì |
| `validation` | Cách xác minh thành công |
| `exitCriteria` | Khi nào giai đoạn hoàn thành |

## Ví Dụ: Kế Hoạch Đầy Đủ

```json5
{
  taskId: "task-20260408-001",
  goal: "Lấy dữ liệu Excel, nhập vào phần mềm nội bộ, gửi qua Zalo cho sếp",
  estimatedDuration: "45s",
  nodes: [
    {
      id: "doc-excel",
      type: "action",
      layer: "deep",
      action: { tool: "file.read", params: { path: "~/Desktop/*.xlsx", format: "structured" } },
      verify: { strategy: "api", expected: "data.rows.length > 0" },
      dependencies: [],
      onSuccess: "mo-app-noi-bo",
      onFailure: { strategy: "escalate" },
    },
    {
      id: "mo-app-noi-bo",
      type: "action",
      layer: "surface",
      action: { tool: "app.launch", params: { name: "Internal CRM" } },
      verify: { strategy: "screenshot", expected: "Màn hình đăng nhập hoặc dashboard chính hiện ra" },
      dependencies: ["doc-excel"],
      onSuccess: "nhap-du-lieu",
      onFailure: { strategy: "retry", maxRetries: 2 },
    },
    {
      id: "nhap-du-lieu",
      type: "action",
      layer: "surface",
      action: { tool: "ui.fill-form", params: { data: "$doc-excel.result", targetForm: "data-entry" } },
      verify: { strategy: "screenshot", expected: "Thông báo thành công hoặc dữ liệu hiển thị trong form" },
      dependencies: ["mo-app-noi-bo"],
      onSuccess: "mo-zalo",
      onFailure: { strategy: "retry", maxRetries: 3 },
    },
    {
      id: "mo-zalo",
      type: "action",
      layer: "surface",
      action: { tool: "app.launch", params: { name: "Zalo" } },
      verify: { strategy: "screenshot", expected: "Cửa sổ chat Zalo đã mở" },
      dependencies: ["nhap-du-lieu"],
      onSuccess: "gui-bao-cao",
      onFailure: { strategy: "retry", maxRetries: 2 },
    },
    {
      id: "gui-bao-cao",
      type: "action",
      layer: "surface",
      action: { tool: "ui.chat-send", params: { recipient: "Sếp", message: "$nhap-du-lieu.summary" } },
      verify: { strategy: "screenshot", expected: "Dấu hiệu tin nhắn đã gửi hiện ra" },
      dependencies: ["mo-zalo"],
      onSuccess: null,
      onFailure: { strategy: "escalate" },
    },
  ],
}
```

## Logic Chọn Tầng

```
Có API/CLI lập trình cho hành động này không?
  ├── CÓ → Tầng Sâu
  │        Nhanh hơn tương tác trực quan?
  │        ├── CÓ → Dùng Tầng Sâu
  │        └── KHÔNG → Xem xét Tầng Mặt
  └── KHÔNG → Tầng Mặt
              App này đã biết chưa?
              ├── CÓ → Dùng bản đồ UI đã cache
              └── KHÔNG → Chế độ khám phá (duyệt UI trước)
```
