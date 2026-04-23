# Mục Lục Tài Liệu OmniState

> Shadow OS — Người quản trị hệ thống vô hình bên trong máy tính của bạn.

## Đối Tượng

| Đối tượng | Đọc trước |
|-----------|-----------|
| **Developer** | 01 → 02 → 04 → 16 → 19 → 18 |
| **Operator / DevOps** | 17 → 07 → 10 → 16 |
| **Contributor mới** | 19 → 17 → 18 → 20 |

## Liên Kết Nhanh

- [Trạng thái dự án](../STATUS.md) — tiến độ thực tế, E2E results
- [CHANGELOG](../../CHANGELOG.md) — lịch sử phiên bản
- [Ma trận Use Case](14-USECASE-MATRIX.md) — 13 UC, 440+ methods

---

## Tài Liệu Kiến Trúc (00–13)

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

## Tài Liệu Kỹ Thuật & Vận Hành (14–20)

| # | Tài liệu | Mô tả |
|---|----------|-------|
| 14 | [Ma Trận Use Case](14-USECASE-MATRIX.md) | 13 UC, 440+ methods, trạng thái thực thi |
| 15 | [Mô Hình Dữ Liệu](15-MO-HINH-DU-LIEU.md) | Schema SQLite, ERD, JSON schemas |
| 16 | [Hợp Đồng API](16-HOP-DONG-API.md) | HTTP REST, WebSocket protocol, Mirror session |
| 17 | [Runbook Vận Hành](17-RUNBOOK.md) | Cài đặt, start/stop, debug, recover |
| 18 | [Chiến Lược Kiểm Thử](18-CHIEN-LUOC-KIEM-THU.md) | Test pyramid, CI gate, benchmark, flaky policy |
| 19 | [Hướng Dẫn Đóng Góp](19-DONG-GOP.md) | Dev setup, branch, commit, PR flow |
| 20 | [Nhật Ký Quyết Định (ADR)](20-NHAT-KY-QUYET-DINH/README.md) | Lý do các quyết định kiến trúc quan trọng |

## Tóm Tắt Các Ca Sử Dụng

| UC | Tên | Tài liệu liên quan |
|----|-----|-------------------|
| UC-1 | Tương Tác Giao Diện Trực Quan | [Động Cơ Thị Giác](06-DONG-CO-THI-GIAC.md), [Các Tầng Thực Thi](04-CAC-TANG-THUC-THI.md) |
| UC-2 | Quản Trị Hệ Thống Chuyên Sâu | [Các Tầng Thực Thi](04-CAC-TANG-THUC-THI.md), [Gateway Lõi](02-GATEWAY-LOI.md) |
| UC-3 | Tự Bảo Trì & Phục Hồi | [Giám Sát Sức Khỏe](07-GIAM-SAT-SUC-KHOE.md), [Vòng Lặp Agent](05-VONG-LAP-AGENT.md) |
| UC-4 | Điều Phối Tác Vụ Phức Hợp | [Bộ Lập Kế Hoạch](03-BO-LAP-KE-HOACH.md), [Điều Khiển Từ Xa](11-DIEU-KHIEN-TU-XA.md), [Tầng Mạng Lưới](04-CAC-TANG-THUC-THI.md) |
