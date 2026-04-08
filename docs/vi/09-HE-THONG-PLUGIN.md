# Hệ Thống Plugin

Hệ thống plugin của OmniState cho phép mở rộng khả năng mà không cần sửa đổi mã lõi. Lấy cảm hứng từ kiến trúc plugin của OpenClaw.

## Phân Loại Plugin

| Danh mục | Mô tả | Ví dụ |
|----------|-------|-------|
| **Plugin Sâu** | Khả năng tự động hóa cấp OS | Quản lý tường lửa, quản lý gói, điều khiển dịch vụ |
| **Plugin Mặt** | Tương tác UI cho app cụ thể | Tự động Zalo, hỗ trợ Excel, điều khiển trình duyệt |
| **Plugin Đội Máy** | Mở rộng phối hợp đội máy | Khám phá tùy chỉnh, đồng bộ chuyên biệt |
| **Plugin Sức Khỏe** | Cảm biến sức khỏe tùy chỉnh và sửa chữa | Giám sát database, kiểm tra dịch vụ cloud |
| **Plugin Xác Minh** | Chiến lược xác minh tùy chỉnh | Kiểm tra phản hồi API, xác minh toàn vẹn dữ liệu |
| **Plugin Kênh** | Kênh nhập lệnh mới | LINE bot, tích hợp Slack, trợ lý giọng nói |

## Cấu Trúc Plugin

```
~/.omnistate/plugins/
└── my-plugin/
    ├── omnistate.plugin.json       # Manifest plugin
    ├── package.json                # Siêu dữ liệu gói npm
    ├── src/
    │   ├── index.ts                # Điểm nhập (hàm register)
    │   └── ...
    └── README.md
```

### Manifest Plugin

```json5
// omnistate.plugin.json
{
  id: "zalo-automator",
  name: "Tự Động Zalo Desktop",
  version: "1.0.0",
  category: "surface",
  
  // Plugin này cung cấp gì
  capabilities: [
    "app.zalo.gui-tin-nhan",
    "app.zalo.tim-lien-lac",
    "app.zalo.gui-file",
    "app.zalo.doc-tin-nhan",
  ],
  
  // Plugin này yêu cầu gì
  requirements: {
    platform: ["macos", "windows"],
    apps: ["Zalo"],
  },
  
  // Hook của plugin
  hooks: [
    "before_step",
    "after_step",
    "on_app_detected",
  ],
}
```

### API Đăng Ký Plugin

```typescript
// src/index.ts
import { OmniStatePluginAPI } from "omnistate/plugin-sdk";

export default function register(api: OmniStatePluginAPI) {
  // Đăng ký công cụ
  api.registerTool("app.zalo.gui-tin-nhan", {
    description: "Gửi tin nhắn qua ứng dụng Zalo desktop",
    params: {
      recipient: { type: "string", required: true },
      message: { type: "string", required: true },
      attachments: { type: "array", items: "string", required: false },
    },
    
    async execute(params, context) {
      // Sử dụng API Tầng Mặt
      const screen = await context.surface.capture();
      const thanhTimKiem = await context.surface.findElement(screen, "Thanh tìm kiếm Zalo");
      
      await context.surface.click(thanhTimKiem);
      await context.surface.type(params.recipient);
      await context.surface.waitFor("danh sách liên lạc hiện ra", { timeout: 5000 });
      
      const lienLac = await context.surface.findElement(screen, `Liên lạc: ${params.recipient}`);
      await context.surface.click(lienLac);
      
      const khungTinNhan = await context.surface.findElement(screen, "Khung nhập tin nhắn");
      await context.surface.click(khungTinNhan);
      await context.surface.type(params.message);
      await context.surface.pressKey("Enter");
      
      // Xác minh
      const result = await context.surface.capture();
      const verified = await context.vision.verify(result, "Dấu hiệu tin nhắn đã gửi hiện ra");
      
      return { success: verified, screenshot: result };
    },
  });
  
  // Đăng ký cảm biến sức khỏe
  api.registerHealthSensor("zalo-connection", {
    interval: 60000,
    
    async check(context) {
      const dangChay = await context.deep.isProcessRunning("Zalo");
      return {
        status: dangChay ? "ok" : "warning",
        message: dangChay ? "Zalo đang chạy" : "Zalo không chạy",
      };
    },
  });
  
  // Đăng ký chiến lược xác minh
  api.registerVerification("zalo-tin-nhan-da-gui", {
    async verify(context, expected) {
      const screen = await context.surface.capture();
      return context.vision.check(screen, "Dấu tick xanh đôi hiện ra trên tin nhắn cuối");
    },
  });
}
```

## Vòng Đời Plugin

```
Gateway khởi động
    |
    v
Quét ~/.omnistate/plugins/ tìm manifest
    |
    v
Với mỗi plugin được bật:
  1. Nạp và xác thực manifest
  2. Kiểm tra yêu cầu (nền tảng, app, phụ thuộc)
  3. Gọi hàm register()
  4. Đăng ký công cụ, hook, cảm biến đã cung cấp
    |
    v
Plugin sẵn sàng cho lập kế hoạch và thực thi tác vụ
    |
    v
Gateway tắt → Gọi dispose() trên mỗi plugin
```

## Khám Phá Plugin

```bash
# Cài từ npm
omnistate plugins install @omnistate/zalo-automator

# Cài từ thư mục cục bộ
omnistate plugins install -l ./my-plugin

# Liệt kê plugin đã cài
omnistate plugins list

# Bật/tắt
omnistate plugins enable zalo-automator
omnistate plugins disable zalo-automator
```

## Bảo Mật

- Plugin chạy trong cùng tiến trình với Gateway (không sandbox mặc định)
- Công cụ plugin tuân thủ cùng hệ thống quyền như công cụ lõi
- Plugin không thể sửa đổi hành vi lõi của Gateway
- Hook plugin được sắp xếp theo ưu tiên; hook lõi luôn chạy trước
- Truy cập thông tin xác thực yêu cầu quyền rõ ràng trong manifest

## Plugin Tích Hợp Sẵn (Kế Hoạch)

| Plugin | Danh mục | Mô tả |
|--------|----------|-------|
| `core-deep` | Sâu | Hệ thống tập tin, tiến trình, mạng, thao tác terminal |
| `core-surface` | Mặt | Tương tác UI chung (chuột, bàn phím, thị giác) |
| `core-health` | Sức Khỏe | Giám sát CPU, RAM, ổ đĩa, mạng, tiến trình |
| `browser-automator` | Mặt | Tự động Chrome/Firefox/Safari |
| `office-suite` | Mặt | Tương tác Microsoft Office / LibreOffice |
| `terminal-emulator` | Sâu | iTerm2, Terminal.app, Windows Terminal |
| `docker-manager` | Sâu | Quản lý container Docker |
| `cloud-cli` | Sâu | Tích hợp AWS/GCP/Azure CLI |
