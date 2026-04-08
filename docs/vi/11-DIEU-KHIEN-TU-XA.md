# Điều Khiển Từ Xa — Vận Hành Xuyên Thiết Bị

OmniState hỗ trợ điều khiển từ xa qua kênh nhắn tin và quản lý đội máy, cho phép điện thoại ra lệnh cho máy tính để bàn hoặc một máy trạm quản lý toàn bộ mạng lưới.

## Ví Dụ UC-4.3: Điều Khiển Từ Xa Qua Telegram

```
Người dùng (Điện thoại, ở ngoài đường)
    |
    | "Tìm file thuyết trình trên laptop ở nhà,
    |  chuyển sang PDF rồi gửi cho khách XYZ"
    |
    v
+------------------+
| Telegram Bot     |  (Chạy trên OmniState Gateway)
| Plugin Kênh      |
+--------+---------+
         |
         v
+------------------+
| OmniState Gateway|  (Trên laptop ở nhà)
| Bộ Định Tuyến    |
+--------+---------+
         |
         v
+------------------+
| Bộ Lập Kế Hoạch  |
| Đồ thị trạng thái:|
| 1. Tìm file .pptx |  → Tầng Sâu (tìm kiếm file)
| 2. Chuyển PDF     |  → Tầng Sâu (CLI LibreOffice hoặc Tầng Mặt)
| 3. Gửi cho XYZ    |  → Tầng Mặt (ứng dụng email hoặc Zalo)
+--------+---------+
         |
         v
[Thực thi các bước...]
         |
         v
+------------------+
| Báo cáo lại      |  → Tin nhắn Telegram đến điện thoại người dùng
| "Đã gửi file     |
|  BaoCao.pdf cho  |
|  khách XYZ qua   |
|  email"           |
+------------------+
```

## Các Mẫu Truy Cập Từ Xa

### Mẫu 1: Kênh Nhắn Tin (Telegram, Zalo, v.v.)

```
Điện thoại → Messaging API → Plugin Kênh OmniState → Gateway → Thực thi → Báo cáo lại
```

**Ưu điểm**: Không cần cài đặt đặc biệt, hoạt động từ bất kỳ điện thoại nào, giao diện quen thuộc
**Hạn chế**: Lệnh dạng văn bản, phản hồi hạn chế (không xem trực tiếp màn hình)

### Mẫu 2: Dashboard Web (Trình duyệt từ xa)

```
Trình duyệt Điện thoại/PC → HTTPS → Web UI OmniState → Gateway → Thực thi → Cập nhật trực tiếp
```

**Ưu điểm**: UI phong phú, tiến độ tác vụ trực tiếp, ảnh chụp xác minh
**Yêu cầu**: Port forwarding hoặc Tailscale

### Mẫu 3: CLI qua SSH

```
Terminal từ xa → SSH → CLI OmniState → Gateway → Thực thi
```

**Ưu điểm**: Toàn quyền điều khiển, hỗ trợ scripting
**Yêu cầu**: SSH đã cấu hình

### Mẫu 4: Chỉ Huy Đội Máy

```
Máy chỉ huy → Giao thức đội → Các máy agent → Thực thi → Báo cáo về chỉ huy
```

**Ưu điểm**: Điều phối đa máy, thực thi song song
**Yêu cầu**: OmniState cài trên tất cả máy, kết nối mạng

## Hỗ Trợ Wake-on-LAN

Cho ví dụ UC-4.3, laptop ở nhà có thể đang ngủ:

```
Người dùng gửi lệnh Telegram
    |
    v
Gateway kiểm tra: Máy đích có đang thức không?
    |
    +-- CÓ → Tiến hành tác vụ
    |
    +-- KHÔNG → Gửi gói Wake-on-LAN
               Đợi máy khởi động (timeout: 120s)
               Xác minh OmniState Gateway đang chạy
               Tiến hành tác vụ
```

Cấu hình:
```json5
{
  fleet: {
    wakeOnLan: {
      enabled: true,
      targets: {
        "laptop-nha": {
          mac: "AA:BB:CC:DD:EE:FF",
          broadcastAddress: "192.168.1.255",
          waitAfterWakeMs: 30000,
        },
      },
    },
  },
}
```

## Cấu Hình Kênh Lệnh

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "OMNISTATE_TELEGRAM_TOKEN",
      allowedUsers: ["telegram:123456789"],
      
      // Có thể làm gì qua Telegram
      permissions: {
        tier: 2,                     // Cấp tương tác
        requireConfirmation: ["deep.file.delete", "deep.process.kill"],
      },
    },
    
    web: {
      enabled: true,
      auth: "token",                 // hoặc "oauth"
    },
    
    cli: {
      enabled: true,                 // Luôn bật cho cục bộ
    },
  },
}
```

## Vòng Phản Hồi

Tác vụ từ xa cung cấp phản hồi qua cùng kênh:

### Phản Hồi Văn Bản (Telegram)
```
Người dùng: "Cài đặt VS Code trên máy bàn ở văn phòng"

OmniState: "Đang thực hiện...
  [1/3] Mở Terminal ✓
  [2/3] Chạy `brew install --cask visual-studio-code` ✓
  [3/3] Xác nhận cài đặt ✓
  
  VS Code đã được cài đặt thành công!"
```

### Phản Hồi Phong Phú (Dashboard Web)
- Thanh tiến độ tác vụ trực tiếp
- Log thực thi từng bước
- Ảnh chụp xác minh tại mỗi bước
- Điều khiển tương tác (tạm dừng, tiếp tục, hủy)

### Phản Hồi Lỗi
```
Người dùng: "Gửi file BaoCao.xlsx cho sếp qua Zalo"

OmniState: "Gặp sự cố ở bước 2/3:
  [1/3] Tìm file BaoCao.xlsx ✓
  [2/3] Mở Zalo ✗ — Zalo chưa được cài đặt trên máy này
  
  Gợi ý:
  1. Gửi qua email thay thế?
  2. Cài đặt Zalo trước rồi thử lại?
  3. Hủy tác vụ?"
```

## Bảo Mật Cho Điều Khiển Từ Xa

- Mọi kênh từ xa yêu cầu xác thực
- Hành động nhạy cảm yêu cầu xác nhận qua cùng kênh
- Ảnh chụp gửi qua kênh từ xa tự động xóa sau 24h
- Lệnh đội máy được log trên cả chỉ huy và agent
- Lệnh Telegram bị giới hạn tốc độ (mặc định: 10/phút)
