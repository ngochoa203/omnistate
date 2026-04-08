# Mục Lục Tài Liệu OmniState

> Shadow OS — Người quản trị hệ thống vô hình bên trong máy tính của bạn.

## Tài Liệu Kiến Trúc

| # | Tài liệu | Mô tả |
|---|----------|-------|
| 00 | [Tầm Nhìn](00-TAM-NHIN.md) | Tầm nhìn dự án, triết lý, mối quan hệ với OpenClaw |
| 01 | [Tổng Quan Kiến Trúc](01-TONG-QUAN-KIEN-TRUC.md) | Sơ đồ hệ thống, tổng quan thành phần, nguyên tắc thiết kế |
| 02 | [Gateway Lõi](02-GATEWAY-LOI.md) | Daemon trung tâm, giao thức kết nối, cấu hình, sự kiện |
| 03 | [Bộ Lập Kế Hoạch](03-BO-LAP-KE-HOACH.md) | Đồ thị trạng thái, pipeline lập kế hoạch, mô hình DAG |
| 04 | [Các Tầng Thực Thi](04-CAC-TANG-THUC-THI.md) | Tầng Sâu, Tầng Mặt, Tầng Mạng Lưới — đặc tả đầy đủ |
| 05 | [Vòng Lặp Agent](05-VONG-LAP-AGENT.md) | Vòng đời thực thi, quản lý hàng đợi, logic thử lại |
| 06 | [Động Cơ Thị Giác](06-DONG-CO-THI-GIAC.md) | Nhận thức màn hình, phát hiện thành phần, mô hình trạng thái UI |
| 07 | [Giám Sát Sức Khỏe](07-GIAM-SAT-SUC-KHOE.md) | Cỗ máy tự hồi phục, cảm biến, phát hiện bất thường, tự sửa chữa |
| 08 | [Phiên & Trạng Thái](08-PHIEN-VA-TRANG-THAI.md) | Mô hình lưu trữ, bản ghi, bộ nhớ đệm, phục hồi |
| 09 | [Hệ Thống Plugin](09-HE-THONG-PLUGIN.md) | Phân loại plugin, manifest, API đăng ký, vòng đời |
| 10 | [Mô Hình Bảo Mật](10-MO-HINH-BAO-MAT.md) | Mô hình mối đe dọa, phân quyền, chặn cứng, nhật ký kiểm toán |
| 11 | [Điều Khiển Từ Xa](11-DIEU-KHIEN-TU-XA.md) | Vận hành xuyên thiết bị, kênh nhắn tin, Wake-on-LAN |
| 12 | [Công Nghệ & Triển Khai](12-CONG-NGHE-VA-TRIEN-KHAI.md) | API nền tảng, native bindings, mô hình triển khai |
| 13 | [Kế Thừa Từ OpenClaw](13-KE-THUA-TU-OPENCLAW.md) | Các pattern kiến trúc kế thừa từ OpenClaw |

## Bản Đồ Kiến Trúc Nhanh

```
Người dùng (lệnh ngôn ngữ tự nhiên)
    │
    ▼
┌─────────────────────────────────────────────┐
│              OMNISTATE GATEWAY               │
│                                              │
│  Bộ Định Tuyến → Bộ Lập Kế Hoạch → Hàng Đợi│
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │Tầng Sâu  │ │Tầng Mặt  │ │Tầng Mạng │    │
│  │(OS APIs) │ │(Thị giác │ │Lưới      │    │
│  │          │ │+ Chuột/  │ │(Đa máy) │    │
│  │          │ │  Bàn phím)│ │          │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│  Kho Phiên │ Giám Sát Sức Khỏe │ Plugins   │
└─────────────────────────────────────────────┘
```

## Tóm Tắt Các Ca Sử Dụng

| UC | Tên | Tài liệu liên quan |
|----|-----|-------------------|
| UC-1 | Tương Tác Giao Diện Trực Quan | [Động Cơ Thị Giác](06-DONG-CO-THI-GIAC.md), [Các Tầng Thực Thi](04-CAC-TANG-THUC-THI.md) |
| UC-2 | Quản Trị Hệ Thống Chuyên Sâu | [Các Tầng Thực Thi](04-CAC-TANG-THUC-THI.md), [Gateway Lõi](02-GATEWAY-LOI.md) |
| UC-3 | Tự Bảo Trì & Phục Hồi | [Giám Sát Sức Khỏe](07-GIAM-SAT-SUC-KHOE.md), [Vòng Lặp Agent](05-VONG-LAP-AGENT.md) |
| UC-4 | Điều Phối Tác Vụ Phức Hợp | [Bộ Lập Kế Hoạch](03-BO-LAP-KE-HOACH.md), [Điều Khiển Từ Xa](11-DIEU-KHIEN-TU-XA.md), [Tầng Mạng Lưới](04-CAC-TANG-THUC-THI.md) |
