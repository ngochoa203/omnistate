# Tổng Quan Kiến Trúc OmniState

## Sơ Đồ Hệ Thống

```
+------------------------------------------------------------------+
|                   TẦNG GIAO DIỆN NGƯỜI DÙNG                       |
|  [Lệnh NL] [Telegram Bot] [Web UI] [Giọng nói] [CLI từ xa]     |
+----------------------------------+-------------------------------+
                                   |
                                   v
+------------------------------------------------------------------+
|                     OMNISTATE GATEWAY (Daemon)                    |
|                                                                   |
|  +------------------+  +------------------+  +----------------+  |
|  | Bộ Định Tuyến    |  | Bộ Lập Kế Hoạch  |  | Quản Lý Phiên  |  |
|  | Lệnh             |  | (Đồ Thị          |  | (Lưu trữ       |  |
|  | (NL -> Ý định)   |  |  Trạng Thái)      |  |  bền vững)      |  |
|  +--------+---------+  +--------+---------+  +-------+--------+  |
|           |                     |                    |            |
|           v                     v                    v            |
|  +----------------------------------------------------------+   |
|  |           BỘ ĐIỀU PHỐI THỰC THI                            |   |
|  |  Quản lý hàng đợi | Cơ chế thử lại | Vòng lặp xác minh  |   |
|  +------------------+--------------------+-------------------+   |
|                     |                    |                        |
+------------------------------------------------------------------+
                      |                    |
          +-----------+----------+   +-----+-----------+
          |                      |   |                  |
          v                      v   v                  v
+-----------------+  +-----------------+  +------------------+
| TẦNG SÂU        |  | TẦNG MẶT        |  | TẦNG MẠNG LƯỚI   |
| (Deep Layer)    |  | (Surface Layer) |  | (Fleet Layer)    |
|                 |  |                 |  |                  |
| API hệ điều hành|  | Chụp màn hình  |  | Lưới Agent       |
| Terminal/Shell  |  | Động cơ thị giác|  | Thực thi từ xa   |
| Quy tắc tường lửa| | Chuột/Bàn phím |  | Giao thức đồng bộ|
| Quản lý tiến trình| | OCR/Nhận diện  |  | Khám phá đội máy |
| Hệ thống tập tin |  | phần tử UI     |  | Tổng hợp kết quả|
| GPU Framebuffer |  | I/O giống người |  |                  |
| Desktop ảo      |  | Chống phát hiện |  |                  |
|                 |  | bot             |  |                  |
+-----------------+  +-----------------+  +------------------+

          |                    |                    |
          v                    v                    v
+-----------------------------------------------------------------+
|                BỘ GIÁM SÁT SỨC KHỎE HỆ THỐNG                    |
|  Chó canh tài nguyên | Phát hiện bất thường | Cỗ máy tự sửa   |
+-----------------------------------------------------------------+
```

## Tổng Quan Thành Phần

### 1. Tầng Giao Diện Người Dùng
Các điểm nhận lệnh — ngôn ngữ tự nhiên qua chat, giọng nói, CLI, dashboard web, hoặc trigger từ xa (Telegram, v.v.).

### 2. OmniState Gateway (Daemon lõi)
Hệ thần kinh trung ương. Lấy cảm hứng từ pattern Gateway của OpenClaw:
- **Bộ Định Tuyến Lệnh** — Phân tích ngôn ngữ tự nhiên thành ý định (intent) có cấu trúc
- **Bộ Lập Kế Hoạch** — Phân rã mục tiêu thành đồ thị trạng thái (kế hoạch thực thi)
- **Quản Lý Phiên** — Duy trì trạng thái bền vững xuyên suốt tác vụ và khi khởi động lại
- **Bộ Điều Phối Thực Thi** — Phối hợp ba tầng thực thi

### 3. Các Tầng Thực Thi
Ba chiến lược thực thi song song:
- **Tầng Sâu** — Thao tác cấp OS nhanh, lập trình, vô hình
- **Tầng Mặt** — Tương tác giao diện trực quan giống con người
- **Tầng Mạng Lưới** — Phối hợp đa máy tính

### 4. Bộ Giám Sát Sức Khỏe
Hệ thống nền luôn hoạt động cho bảo trì chủ động và tự phục hồi.

## Nguyên Tắc Thiết Kế

1. **Lấy Gateway làm trung tâm** — Một daemon duy nhất sở hữu mọi trạng thái và phối hợp (như OpenClaw)
2. **Tự động chọn tầng** — Bộ lập kế hoạch tự chọn Tầng Sâu hay Tầng Mặt dựa trên khả năng của app đích
3. **Xác minh mọi thứ** — Mỗi hành động đều được theo sau bởi bước xác minh
4. **Thử lại có giới hạn** — Thử lại với chiến lược leo thang, nhưng luôn có giới hạn để tránh vòng lặp vô tận
5. **Cô lập mặc định** — Mỗi tác vụ có ngữ cảnh phiên riêng; agent đội máy hoàn toàn cô lập
6. **Mở rộng qua plugin** — Khả năng mới (app, tích hợp OS, chiến lược xác minh) được thêm dưới dạng plugin
