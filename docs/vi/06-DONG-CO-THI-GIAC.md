# Động Cơ Thị Giác — Nhận Thức Màn Hình

Động Cơ Thị Giác là "đôi mắt" của OmniState. Nó chụp, phân tích, và hiểu những gì đang hiển thị trên màn hình, cho phép Tầng Mặt tương tác với bất kỳ ứng dụng nào.

## Kiến Trúc

```
+--------------------------------------------------------------+
|                    ĐỘNG CƠ THỊ GIÁC                           |
|                                                               |
|  +------------------+                                        |
|  | MODULE CHỤP      |                                        |
|  |                  |                                        |
|  | Ưu tiên:         |                                        |
|  | 1. GPU Framebuf  |  +----------------------------------+ |
|  | 2. API Ảnh chụp  |  |       PIPELINE PHÂN TÍCH          | |
|  | 3. Chụp cửa sổ  |  |                                  | |
|  +--------+---------+  |  Khung hình gốc                   | |
|           |             |      |                            | |
|           v             |      v                            | |
|  +------------------+   |  +------------+                   | |
|  | BỘ SO SÁNH       |   |  | Phát Hiện  |                   | |
|  | KHUNG HÌNH       |   |  | Phần Tử    |                   | |
|  | (Phát hiện       |   |  | (Vision LM)|                   | |
|  |  thay đổi)       |   |  +-----+------+                   | |
|  |                  |   |        |                          | |
|  | Chỉ phân tích    |   |        v                          | |
|  | vùng thay đổi    |   |  +------------+                   | |
|  +--------+---------+   |  | OCR Engine |                   | |
|           |             |  | (Trích xuất|                   | |
|           v             |  |  văn bản)   |                   | |
|  +------------------+   |  +-----+------+                   | |
|  | VÙNG QUAN TÂM    |   |        |                          | |
|  | (ROI)             |   |        v                          | |
|  | Tập trung vào     |   |  +------------+                   | |
|  | cửa sổ/vùng       |   |  | Bộ Ánh Xạ  |                   | |
|  | đang hoạt động    |   |  | Ngữ Nghĩa  |                   | |
|  +------------------+   |  | (UI Graph)  |                   | |
|                         |  +------------+                   | |
|                         +----------------------------------+ |
+--------------------------------------------------------------+
```

## Chiến Lược Chụp Ảnh

### Ưu tiên 1: Đọc Trực Tiếp GPU Framebuffer
- **Độ trễ**: < 5ms
- **Phương pháp**: Can thiệp vào pipeline xuất hình ảnh của GPU trước khi hiển thị
- **Hỗ trợ nền tảng**: macOS (IOSurface), Windows (DXGI), Linux (DRM/KMS)
- **Ưu điểm**: Gần như không có độ trễ, không nhấp nháy, hoạt động với app toàn màn hình
- **Ca sử dụng**: Giám sát thời gian thực, tự động hóa game, xác minh nhanh

### Ưu tiên 2: API Chụp Ảnh Màn Hình OS
- **Độ trễ**: 50-200ms
- **Phương pháp**: API chụp ảnh của nền tảng (CGWindowListCreateImage, BitBlt, XGetImage)
- **Hỗ trợ**: Tất cả nền tảng chính
- **Ưu điểm**: Đáng tin cậy, có tài liệu rõ ràng
- **Ca sử dụng**: Tự động hóa UI tiêu chuẩn, chụp xác minh

### Ưu tiên 3: Chụp Cửa Sổ Cụ Thể
- **Độ trễ**: 30-100ms
- **Phương pháp**: Chỉ chụp cửa sổ cụ thể (API accessibility + ID cửa sổ)
- **Ưu điểm**: Hoạt động ngay cả khi cửa sổ bị che một phần
- **Ca sử dụng**: Giám sát nền, quy trình đa cửa sổ

## Phát Hiện Phần Tử

### Phát Hiện Đa Chiến Lược

```
Đầu vào: Ảnh chụp + Ngữ cảnh tác vụ ("tìm nút Gửi")
    |
    v
+-- Chiến lược 1: Truy Vấn API Accessibility
|   Truy vấn cây accessibility OS cho phần tử phù hợp
|   Độ tin cậy: CAO (có cấu trúc, đáng tin)
|   Khả dụng: Chỉ cho app hỗ trợ a11y
|
+-- Chiến lược 2: Mô Hình Ngôn Ngữ Thị Giác (VLM)
|   Gửi ảnh chụp + prompt cho VLM
|   "Xác định vị trí và vùng bao của nút Gửi"
|   Độ tin cậy: TRUNG BÌNH-CAO (hiểu ngữ nghĩa)
|   Chi phí: Thời gian suy luận LLM + token
|
+-- Chiến lược 3: OCR + Suy Luận Không Gian
|   Chạy OCR trên ảnh chụp
|   Tìm văn bản khớp mục tiêu ("Gửi", "Send", v.v.)
|   Suy ra vùng có thể click từ ngữ cảnh không gian
|   Độ tin cậy: TRUNG BÌNH
|
+-- Chiến lược 4: So Khớp Mẫu (Template Matching)
|   So sánh với mẫu UI đã biết
|   Dùng vị trí phần tử đã cache cho app quen
|   Độ tin cậy: THẤP-TRUNG BÌNH (dễ vỡ khi thay đổi)
|
    v
Gộp kết quả, chọn phát hiện có độ tin cậy cao nhất
    |
    v
Đầu ra: { element: "Nút Gửi", bounds: {x, y, w, h}, confidence: 0.95 }
```

## Khả Năng Chống Thay Đổi Giao Diện (Dark Mode / Theme)

OmniState tìm phần tử theo **ý nghĩa**, không phải theo màu pixel:

```
Chế độ sáng:                      Chế độ tối:
+------------------+            +------------------+
| [Gửi]  (xanh)   |            | [Gửi]  (xanh)   |
|  nền: #FFFFFF     |            |  nền: #1E1E1E     |
+------------------+            +------------------+

Cả hai đều được phát hiện là: { type: "button", text: "Gửi", semanticRole: "submit-message" }
```

## Hỗ Trợ Desktop Ảo (Không Gian Vô Hình)

Cho tác vụ nền cần Tầng Mặt nhưng không được làm phiền người dùng:

```
Màn hình người dùng:             Desktop ẩn:
+------------------+            +------------------+
| Người dùng đang  |            | OmniState đang   |
| chơi game        |            | cài đặt phần mềm |
| (toàn màn hình)  |            | ở đây             |
+------------------+            +------------------+
     HIỂN THỊ                       ẨN

OmniState tạo desktop ảo, mở app ở đó,
và thao tác hoàn toàn trong không gian ẩn.
Chuột và bàn phím của người dùng không bị ảnh hưởng.
```

### Triển khai theo nền tảng:
- **macOS**: Spaces API + CGDisplay private APIs
- **Windows**: Virtual Desktop API (IVirtualDesktopManager)
- **Linux**: X11 workspaces / Wayland virtual outputs

## Mục Tiêu Hiệu Năng

| Thao tác | Độ trễ mục tiêu | Phương pháp |
|---------|----------------|-------------|
| Chụp màn hình (framebuffer) | < 5ms | Đọc trực tiếp GPU |
| Chụp màn hình (ảnh chụp) | < 200ms | API OS |
| Phát hiện thay đổi | < 10ms | So sánh pixel |
| Phát hiện phần tử (a11y) | < 50ms | API Accessibility |
| Phát hiện phần tử (VLM) | 500ms - 2s | Suy luận mô hình thị giác |
| OCR (toàn màn hình) | 200-500ms | OCR engine cục bộ |
| Cập nhật mô hình UI | < 100ms | Cập nhật tăng dần |
