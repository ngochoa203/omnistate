# Nhật Ký Quyết Định Kiến Trúc (ADR)

## Mục đích

Thư mục này lưu trữ các **Architecture Decision Records (ADR)** — tài liệu ngắn ghi lại những quyết định kỹ thuật quan trọng: bối cảnh, lý do chọn, và hậu quả.

**Tại sao cần ADR?**
- Người mới có thể hiểu *tại sao* hệ thống được thiết kế như vậy, không chỉ *cái gì*
- Ngăn việc tranh luận lại cùng một vấn đề đã giải quyết
- Ghi lại trade-off đã chấp nhận, để sau này có thể xem xét lại khi bối cảnh thay đổi

---

## Cách Đọc ADR

Mỗi ADR có cấu trúc MADR (Markdown Architectural Decision Records):

- **Trạng thái:** `Proposed` → `Accepted` → (`Deprecated` | `Superseded by ADR-XXXX`)
- **Bối cảnh:** Tình huống dẫn đến quyết định
- **Quyết định:** Phương án được chọn và lý do
- **Hậu quả:** Trade-off, tác động, rủi ro

---

## Cách Tạo ADR Mới

1. Copy `TEMPLATE.md` → `XXXX-tieu-de-ngan.md` (số thứ tự tiếp theo)
2. Điền đầy đủ các section
3. Cập nhật bảng Index bên dưới
4. Tạo PR — ADR được review như code

```bash
# Lấy số tiếp theo
ls docs/vi/20-NHAT-KY-QUYET-DINH/*.md | grep -v TEMPLATE | grep -v README | wc -l
```

---

## Index

| ADR | Tiêu đề | Trạng thái | Ngày |
|-----|---------|-----------|------|
| [0001](0001-chon-rust-cho-tang-sau.md) | Chọn Rust cho tầng sâu (capture/a11y/input) | Accepted | 2025-01 |
| [0002](0002-sqlite-cho-state-persistence.md) | SQLite + WAL cho state persistence | Accepted | 2025-01 |
| [0003](0003-pino-thay-console.md) | Dùng pino thay console.log | Accepted | 2026-04 |

---

## Tham chiếu

- [Tổng Quan Kiến Trúc](../01-TONG-QUAN-KIEN-TRUC.md)
- [Công Nghệ & Triển Khai](../12-CONG-NGHE-VA-TRIEN-KHAI.md)
- [MADR format](https://adr.github.io/madr/)
