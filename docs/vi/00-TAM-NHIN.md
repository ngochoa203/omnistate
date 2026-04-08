# Tầm Nhìn OmniState

> "Bạn chỉ cần nói kết quả bạn muốn, máy tính tự lo cách làm."

## OmniState là gì?

OmniState là một **Hệ Điều Hành Bóng (Shadow OS)** — một người quản trị hệ thống vô hình sống bên trong máy tính của bạn 24/7. Bạn giao việc bằng ngôn ngữ tự nhiên, và nó tự động "nhìn" màn hình, di chuột, gõ phím, quản lý hệ thống từ A đến Z — giống hệt một người thật đang ngồi trước máy tính.

## Tại sao OmniState ra đời?

Các công cụ tự động hóa và AI Agent hiện tại đều rất máy móc và dễ vỡ:

| Vấn đề | Công cụ hiện tại | OmniState |
|--------|-----------------|-----------|
| Giao diện thay đổi | Script sập khi nút bấm dời chỗ | Dựa trên thị giác — tìm phần tử theo ý nghĩa, không phải tọa độ |
| Xử lý lỗi | Đứng hình chờ người đến sửa | Tự chẩn đoán, đọc thông báo lỗi, thử lại bằng chiến lược thay thế |
| Quy trình đa ứng dụng | Cần API hoặc tích hợp cho từng app | Hoạt động trên MỌI ứng dụng — con người click được thì OmniState cũng làm được |
| Làm việc nền | Tranh giành chuột/bàn phím với người dùng | Hoạt động trong desktop ảo vô hình |
| Độ sâu hệ thống | Chỉ tự động hóa bề mặt | Tích hợp sâu vào OS — tường lửa, GPU framebuffer, quản lý tiến trình |

Các tính năng "Computer Use" hiện tại (Anthropic, OpenAI, OpenHands/OpenDevin) vẫn chỉ ở mức demo chậm chạp, hoạt động như ứng dụng bên ngoài, và thiếu tích hợp sâu với hệ thống.

## Triết Lý Cốt Lõi

**Hướng đến kết quả, không phải từng bước.** Bạn mô tả kết quả mong muốn, OmniState tự lo:

1. **Lập kế hoạch** — Xây dựng đồ thị trạng thái (state graph) từ mục tiêu của bạn
2. **Thực thi** — Chạy từng bước, tự chọn giữa API hệ thống (nhanh) hoặc thao tác giao diện (trực quan)
3. **Xác minh** — Sau mỗi bước, kiểm tra lại màn hình để xác nhận thành công
4. **Phục hồi** — Khi gặp lỗi, tự chẩn đoán và thử lại với giới hạn số lần để tránh vòng lặp vô tận

## Bốn Trụ Cột (Ca Sử Dụng)

| UC | Tên | Khả năng cốt lõi |
|----|-----|------------------|
| UC-1 | Tương tác giao diện trực quan | Nhìn màn hình, hiểu thành phần UI, thao tác chuột/bàn phím như con người |
| UC-2 | Quản trị hệ thống chuyên sâu | Can thiệp tận lõi OS — terminal, tường lửa, GPU framebuffer, desktop ảo |
| UC-3 | Tự bảo trì & phục hồi | Giám sát sức khỏe hệ thống, tự chẩn đoán, tự sửa chữa — 24/7 không cần con người |
| UC-4 | Điều phối tác vụ phức hợp | Kết nối đa ứng dụng, cá nhân hóa theo thói quen, vận hành quy mô đội máy |

## Điểm Đột Phá

1. **Thực thi hai tầng** — Tầng Sâu (nhanh, API/OS) + Tầng Mặt (trực quan, chuột/bàn phím)
2. **Không cần API** — Hoạt động trên bất kỳ phần mềm nào có giao diện, kể cả tool nội bộ cổ xưa
3. **Vòng lặp tự xác minh** — Không bao giờ nhắm mắt làm bừa; luôn kiểm tra kết quả
4. **Điều khiển đội máy** — Một lệnh điều phối 100+ máy tính đồng thời
5. **Hoạt động vô hình** — Làm việc trong desktop ảo mà không làm phiền người dùng

## Cảm hứng

- **Pattern Gateway** — Daemon trung tâm điều phối lệnh đến các engine thực thi
- **Agent loop** — Tiếp nhận → suy luận → thực thi công cụ → xác minh → lưu trữ
- **Định tuyến đa agent** — Agent cô lập theo tác vụ/máy tính với quy tắc binding
- **Quản lý phiên** — Trạng thái bền vững với nén (compaction) và cắt tỉa (pruning)
- **Kiến trúc plugin** — Mở rộng khả năng mà không sửa lõi
- **Hệ thống hàng đợi** — Tuần tự hóa theo lane cho quản lý tác vụ đồng thời
- **Mô hình ủy quyền (delegate)** — Agent hành động thay người dùng với quyền hạn rõ ràng

OmniState mở rộng các pattern này vào lĩnh vực tự động hóa cấp hệ điều hành.
