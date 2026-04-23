# ADR-0003: Dùng pino Thay console.log

**Ngày:** 2026-04
**Trạng thái:** Accepted
**Tác giả:** Team OmniState

---

## Bối Cảnh

Trong giai đoạn đầu phát triển (v0.1.0), gateway dùng `console.log` / `console.error` trực tiếp để ghi log. Khi hệ thống phức tạp hơn, xuất hiện các vấn đề:

1. **Không có level control:** Không thể bật/tắt debug logs trong production mà không sửa code
2. **Không có structured data:** Log là plain text, khó parse và filter (VD: lọc theo `taskId`)
3. **Không có metadata chuẩn:** Timestamp, hostname, process ID không được include nhất quán
4. **Hiệu suất:** `console.log` đồng bộ có thể block event loop khi log nhiều

---

## Phương Án Đã Xem Xét

1. **pino** — Node.js logging library, JSON output, rất nhanh (low overhead)
2. **winston** — Popular, nhiều transport, nhưng nặng hơn
3. **bunyan** — Tương tự pino nhưng ít active development
4. **Giữ console.log** với custom wrapper

---

## Quyết Định

Chọn **pino** vì:

- **Nhanh nhất:** pino benchmark vượt trội winston và bunyan — thiết kế async JSON serialization không block event loop
- **JSON chuẩn:** Mỗi log line là 1 JSON object → dễ ingest vào bất kỳ log aggregator nào (Loki, Datadog, CloudWatch)
- **Level runtime:** `LOG_LEVEL=debug` env var thay đổi level mà không cần restart (với `pino.destination`)
- **pino-pretty:** Dev-friendly formatting khi cần: `pnpm dev | pino-pretty`
- **Nhỏ gọn:** pino < 10KB runtime overhead, phù hợp daemon chạy 24/7

---

## Hậu Quả

### Tích cực
- Log production là JSON → grep/jq/filter dễ dàng
- `LOG_LEVEL=warn pnpm app:start` để giảm noise production
- Tương thích với future log shipping (Loki, etc.)
- `logger.info({ taskId, goal }, "task started")` — structured context

### Tiêu cực / Trade-off
- Cần thêm `pino-pretty` cho dev readability (dep thêm)
- Cần migrate tất cả `console.log` cũ — một số có thể bị bỏ sót
- Log format thay đổi → script parse log cũ (nếu có) cần cập nhật

### Rủi ro
- Nhỏ: pino là thư viện mature, ít risk breaking change

---

## Ghi Chú Triển Khai (v0.1.0)

Thay đổi này được thực hiện trong v0.1.0:
- `packages/gateway/src/utils/logger.ts` export singleton `logger`
- Các module import `logger` thay vì gọi `console.*` trực tiếp
- Dev script tự động pipe qua `pino-pretty` nếu cài

---

## Tham chiếu

- [Runbook — Logs](../17-RUNBOOK.md#logs)
- `packages/gateway/src/utils/logger.ts`
- [pino documentation](https://getpino.io/)
