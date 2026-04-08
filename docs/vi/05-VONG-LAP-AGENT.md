# Vòng Lặp Agent — Vòng Đời Thực Thi

Vòng Lặp Agent là chu trình thực thi cốt lõi của OmniState. Mọi tác vụ — từ đọc file đơn giản đến quy trình đa ứng dụng phức tạp — đều đi qua vòng lặp này.

## Tổng Quan Vòng Lặp (Thừa kế từ OpenClaw Agent Loop)

```
+---------+     +----------+     +---------+     +--------+     +----------+
| TIẾP    | --> | LẬP KẾ   | --> | THỰC    | --> | XÁC    | --> | LƯU      |
| NHẬN    |     | HOẠCH    |     | THI     |     | MINH   |     | TRỮ      |
| (Lệnh NL)|    | (Đồ thị  |     | (Sâu/   |     | (Kiểm  |     | (Kho     |
|         |     |  trạng    |     |  Mặt)   |     |  tra   |     |  Phiên)  |
|         |     |  thái)    |     |         |     |  kết   |     |          |
|         |     |          |     |         |     |  quả)  |     |          |
+---------+     +----------+     +----+----+     +---+----+     +----------+
                                      |              |
                                      |    +---------+
                                      |    |
                                      v    v
                                 +----------+
                                 | THỬ LẠI  |
                                 | (nếu lỗi)|
                                 | tối đa N |
                                 +----------+
```

## Luồng Chi Tiết

### Giai Đoạn 1: Tiếp Nhận
```
Đầu vào đến (văn bản NL, lệnh CLI, trigger lịch trình, lệnh đội máy, trigger từ xa)
    |
    v
Xác thực + phân quyền người gửi
    |
    v
Tạo hoặc phục hồi phiên (khóa phiên từ ngữ cảnh)
    |
    v
Phân loại ý định:
  - Lệnh đơn giản (một bước) → Nhảy thẳng đến Thực Thi
  - Mục tiêu phức tạp (nhiều bước) → Gửi đến Bộ Lập Kế Hoạch
  - Truy vấn hệ thống (trạng thái, sức khỏe) → Phản hồi trực tiếp
  - Lệnh đội máy → Chuyển đến Tầng Mạng Lưới
```

### Giai Đoạn 2: Lập Kế Hoạch
```
Ý định + thực thể + trạng thái hệ thống hiện tại
    |
    v
Chọn chiến lược thực thi:
  - Có thể làm hoàn toàn ở Tầng Sâu? → Xây kế hoạch chỉ-sâu
  - Cần tương tác giao diện? → Xây kế hoạch hỗn hợp (sâu + mặt)
  - Đa máy? → Xây kế hoạch đội máy
    |
    v
Xây dựng Đồ Thị Trạng Thái (DAG gồm các StateNode)
    |
    v
Tối ưu hóa:
  - Xác định các nhánh có thể song song hóa
  - Chèn các nút xác minh
  - Thêm đường dự phòng
  - Ước tính tổng thời gian
    |
    v
Trả kế hoạch cho client để xem trước (tùy cấu hình)
```

### Giai Đoạn 3: Thực Thi

Thực thi **từng bước qua DAG**, tôn trọng phụ thuộc:

```
Với mỗi nút sẵn sàng (mọi phụ thuộc đã hoàn thành):
    |
    v
Chọn tầng thực thi (sâu/mặt/đội máy)
    |
    v
[Tầng Sâu]                         [Tầng Mặt]
  Thực thi lệnh API/CLI OS           Chụp màn hình hiện tại
  Capture stdout/stderr              Phát hiện phần tử UI đích
  Phân tích output có cấu trúc       Tạo chuỗi hành động
                                      Thực thi chuột/bàn phím
                                      Đợi phản hồi UI
    |                                    |
    +------------------------------------+
    |
    v
Thu thập kết quả thực thi
```

### Giai Đoạn 4: Xác Minh

Mỗi bước đều được theo sau bởi xác minh:

```
Chiến lược xác minh:
    |
    +-- screenshot: Chụp màn hình, hỏi mô hình thị giác "bước này có thành công không?"
    |
    +-- api: Kiểm tra qua API OS (file tồn tại? tiến trình chạy? giá trị thay đổi?)
    |
    +-- file: Xác minh nội dung file khớp với output kỳ vọng
    |
    +-- process: Kiểm tra trạng thái tiến trình (đang chạy, mã thoát, output)
    |
    +-- compound: Kết hợp nhiều phương pháp xác minh
    |
    v
Kết quả:
  - THÀNH CÔNG → Đánh dấu nút hoàn thành, tiến đến nút tiếp theo
  - THẤT BẠI → Vào logic thử lại
  - HẾT THỜI GIAN → Vào logic thử lại với chiến lược leo thang
  - KHÔNG RÕ RÀNG → Thu thập thêm ngữ cảnh, xác minh lại với prompt chi tiết hơn
```

### Giai Đoạn 5: Thử Lại

```
Cây quyết định thử lại:
    |
    v
Còn lượt thử? (tối đa từ kế hoạch, mặc định 3)
    |
    +-- CÒN → Thử cùng chiến lược trước
    |          |
    |          +-- Vẫn lỗi? → Thử chiến lược thay thế
    |                          (VD: đổi từ Sâu sang Mặt hoặc ngược lại)
    |
    +-- HẾT → Leo thang:
              |
              +-- "alternative" → Thực thi nút dự phòng từ kế hoạch
              +-- "escalate"    → Thông báo người dùng, tạm dừng chờ quyết định
              +-- "abort"       → Đánh dấu tác vụ thất bại, lưu trạng thái để phục hồi sau
```

### Giai Đoạn 6: Lưu Trữ

```
Sau mỗi bước VÀ khi tác vụ hoàn thành:
    |
    v
Ghi vào bản ghi phiên (JSONL):
  - ID bước, thời gian, tầng đã dùng
  - Hành động đã thực hiện + tham số
  - Kết quả (thành công/thất bại + chi tiết)
  - Kết quả xác minh
  - Ảnh chụp (nếu có)
  - Chỉ số thời gian
    |
    v
Cập nhật kho phiên (JSON):
  - Tiến độ tác vụ (nút hiện tại trong DAG)
  - Trạng thái tổng thể
  - Sử dụng token (nếu LLM được gọi)
```

## Quản Lý Hàng Đợi (Thừa kế từ OpenClaw Command Queue)

Tác vụ được tuần tự hóa qua hàng đợi theo lane:

```
+----------------------------------------------------------------+
|                    HÀNG ĐỢI THỰC THI                            |
|                                                                  |
|  Lane Phiên (1 đồng thời mỗi phiên):                           |
|    task:session-001  →  [bước3] [bước4] [bước5]                |
|    task:session-002  →  [bước1] [bước2]                        |
|                                                                  |
|  Lane Chung (đồng thời tùy cấu hình, mặc định 4):              |
|    main  →  [session-001.bước3] [session-002.bước1] [cron-job] |
|                                                                  |
|  Lane Đội Máy (song song, tối đa maxFleetConcurrent):           |
|    fleet →  [agent-A.task1] [agent-B.task1] [agent-C.task1]    |
|                                                                  |
|  Lane Cron (tách biệt khỏi main, mặc định 2):                  |
|    cron  →  [kiểm-tra-sức-khỏe] [job-dọn-dẹp]                |
+----------------------------------------------------------------+
```

### Chế Độ Hàng Đợi (Mỗi Phiên)

| Chế độ | Hành vi |
|--------|---------|
| `sequential` | Từng bước một, thứ tự nghiêm ngặt (mặc định) |
| `parallel` | Chạy các nhánh độc lập đồng thời |
| `collect` | Gộp nhiều lệnh đến thành một tác vụ |
| `steer` | Lệnh mới điều hướng/chuyển hướng tác vụ đang chạy |

## Xử Lý Timeout

| Loại Timeout | Mặc định | Mô tả |
|-------------|----------|-------|
| Timeout bước | 30s | Thời gian tối đa cho một bước thực thi |
| Timeout xác minh | 10s | Thời gian tối đa chờ xác minh |
| Timeout tác vụ | 48h | Thời gian tối đa cho toàn bộ tác vụ |
| Timeout suy luận LLM | 60s | Thời gian tối đa cho phân tích mô hình thị giác |
| Timeout agent đội máy | 120s | Thời gian tối đa chờ agent đội phản hồi |

## Điểm Hook (Mở Rộng)

| Hook | Khi nào | Ca sử dụng |
|------|---------|------------|
| `before_plan` | Sau phân loại ý định | Ghi đè chiến lược lập kế hoạch |
| `after_plan` | Kế hoạch đã xây xong | Xác minh/sửa kế hoạch trước khi thực thi |
| `before_step` | Trước mỗi bước thực thi | Chèn điều kiện tiên quyết |
| `after_step` | Sau mỗi bước hoàn thành | Log tùy chỉnh, chỉ số |
| `before_verify` | Trước xác minh | Ghi đè chiến lược xác minh |
| `on_failure` | Bước thất bại hết lượt thử | Xử lý lỗi tùy chỉnh |
| `on_complete` | Tác vụ kết thúc | Thông báo, dọn dẹp |
