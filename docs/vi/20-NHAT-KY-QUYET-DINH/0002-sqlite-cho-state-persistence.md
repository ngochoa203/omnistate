# ADR-0002: SQLite + WAL cho State Persistence

**Ngày:** 2025-01
**Trạng thái:** Accepted
**Tác giả:** Team OmniState

---

## Bối Cảnh

OmniState cần lưu trữ bền vững (durable) cho:
- Tài khoản người dùng và phiên đăng nhập
- Lịch sử tác vụ AI
- Trigger definitions và trigger log
- Voice embeddings
- Lịch sử hội thoại
- Danh sách thiết bị đã ghép đôi

Hệ thống chạy **local-first** trên macOS của người dùng — không phải SaaS multi-tenant. Gateway là một daemon chạy trên máy cá nhân.

---

## Phương Án Đã Xem Xét

1. **SQLite + WAL mode** (via `better-sqlite3`)
2. **PostgreSQL** — database server riêng
3. **LevelDB / RocksDB** — key-value store
4. **JSON files** — lưu trực tiếp vào filesystem

---

## Quyết Định

Chọn **SQLite với WAL journal mode** vì:

- **Local-first phù hợp:** SQLite là file duy nhất (`~/.omnistate/omnistate.db`) — không cần cài đặt server, không cần Docker, không cần network
- **Đủ mạnh:** SQLite xử lý tốt cho single-user workload; OmniState không có concurrent multi-user writes
- **WAL mode:** Cho phép đọc đồng thời trong khi ghi — phù hợp với gateway có nhiều WebSocket client đọc trong khi task đang ghi history
- **Migrations:** Schema versioning đơn giản qua bảng `migrations` — không cần ORM phức tạp
- **Backup đơn giản:** `.backup` command hoặc copy file — dễ cho người dùng cuối
- **`better-sqlite3`:** Synchronous API phù hợp với Node.js gateway (tránh async/callback complexity cho DB ops đơn giản)

So với PostgreSQL: PostgreSQL overkill cho local-first single-user, yêu cầu cài đặt riêng biệt, không portable.

---

## Hậu Quả

### Tích cực
- Zero-dependency deployment: không cần DB server
- File có thể inspect trực tiếp bằng DB Browser for SQLite
- `getTestDb()` dùng `:memory:` — tests hoàn toàn isolated
- Backup/restore đơn giản

### Tiêu cực / Trade-off
- Không phù hợp nếu sau này mở rộng sang multi-user server deployment
- Không có connection pooling thật sự (single writer tại 1 thời điểm)
- `busy_timeout = 5000ms` là workaround cho write contention, không phải giải pháp scalable

### Rủi ro
- DB file bị corrupt nếu process bị kill đột ngột (WAL mode giảm risk nhưng không eliminate)
- Cần monitor kích thước file nếu task_history và trigger_log tăng lớn

---

## Tham chiếu

- [Mô Hình Dữ Liệu](../15-MO-HINH-DU-LIEU.md)
- [Runbook — Phục Hồi DB](../17-RUNBOOK.md#phục-hồi)
- `packages/gateway/src/db/database.ts` — implementation
- [SQLite WAL mode](https://www.sqlite.org/wal.html)
