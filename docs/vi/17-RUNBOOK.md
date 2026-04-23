# Runbook Vận Hành

## Mục đích

Hướng dẫn thực tế để cài đặt, khởi động, dừng, gỡ lỗi và phục hồi OmniState. Dành cho developer và operator.

---

## Yêu Cầu Môi Trường

| Công cụ | Phiên bản tối thiểu | Mục đích |
|---------|---------------------|---------|
| Node.js | 22.x | Gateway daemon, web dashboard |
| pnpm | 10.x | Package manager monorepo |
| Rust | 1.80+ (stable) | Build native crates |
| Xcode CLI Tools | 15+ | macOS native bindings (ScreenCaptureKit) |
| macOS | 13 Ventura+ | ScreenCaptureKit API |

---

## Cài Đặt Lần Đầu

```bash
# 1. Clone repo
git clone https://github.com/<org>/omnistate.git
cd omnistate

# 2. Cài dependencies
pnpm install

# 3. Build Rust native crates
cargo build --workspace

# 4. Build N-API bridge (tạo .node binary)
pnpm --filter @omnistate/gateway build:native

# 5. Build các TS packages
pnpm build

# 6. Chạy config wizard lần đầu
pnpm --filter @omnistate/gateway app:config
```

Wizard sẽ hỏi:
- LLM provider (Anthropic / OpenAI / Ollama)
- API key
- Port gateway (mặc định 19800/19801)
- Bật remote access không

Config được lưu tại `~/.omnistate/config.json`.

---

## Khởi Động & Dừng

### Khởi động development

```bash
# Gateway + web dashboard (hot-reload)
pnpm dev

# Chỉ gateway
pnpm --filter @omnistate/gateway dev
```

### Khởi động production

```bash
pnpm --filter @omnistate/gateway app:start
```

Gateway lắng nghe tại:
- WS: `ws://127.0.0.1:19800`
- HTTP: `http://127.0.0.1:19801`

### Dừng sạch sẽ (graceful shutdown)

```bash
# Gửi SIGTERM — gateway drain pending tasks rồi mới thoát
kill -TERM $(lsof -ti :19800)

# Hoặc qua WebSocket (yêu cầu admin token):
# { "type": "admin.shutdown" }
```

Gateway nhận SIGTERM → dừng nhận task mới → chờ tasks đang chạy hoàn thành (timeout 30s) → thoát.

---

## Vị Trí File Quan Trọng

| File | Mô tả |
|------|-------|
| `~/.omnistate/omnistate.db` | SQLite database chính |
| `~/.omnistate/config.json` | Runtime config (LLM, ports, remote) |
| `~/.omnistate/jwt-secret` | JWT signing key (chmod 600, tự tạo) |
| `~/.omnistate/logs/` | > TBD — log rotation chưa cấu hình |

---

## Logs

Gateway dùng **pino** — structured JSON logs, ghi ra stdout.

```bash
# Xem log realtime (dev)
pnpm --filter @omnistate/gateway dev 2>&1 | pino-pretty

# Production — redirect stdout ra file
pnpm app:start >> ~/.omnistate/gateway.log 2>&1
```

**Log levels:** `error` / `warn` / `info` (default) / `debug` / `trace`

Đặt level qua biến môi trường:
```bash
LOG_LEVEL=debug pnpm app:start
```

---

## Metrics Endpoint

```bash
GET http://127.0.0.1:19801/health

# Trả về:
{
  "status": "ok",
  "uptime": 3600,
  "version": "0.1.0"
}
```

Kiểm tra readiness (DB connected):
```bash
curl http://127.0.0.1:19801/readyz
```

---

## Gỡ Lỗi Thường Gặp

### Port đang bị chiếm

**Triệu chứng:** `Error: listen EADDRINUSE :::19800`

```bash
# Tìm process đang dùng port
lsof -ti :19800
lsof -ti :19801

# Kill
kill -9 $(lsof -ti :19800)
```

---

### DB bị lock

**Triệu chứng:** `SQLITE_BUSY: database is locked`

Gateway đặt `busy_timeout = 5000ms` — nếu lỗi vẫn xảy ra:

```bash
# Kiểm tra có process nào giữ lock không
fuser ~/.omnistate/omnistate.db

# Nếu chỉ có 1 process đang chạy, restart gateway là đủ
```

---

### LLM preflight thất bại

**Triệu chứng:** Log `[llm] preflight failed` hoặc task error ngay lập tức

```bash
# Kiểm tra config
cat ~/.omnistate/config.json | grep -E "provider|apiKey|model"

# Chạy lại wizard
pnpm --filter @omnistate/gateway app:config

# Test thủ công qua WS:
# { "type": "llm.preflight" }
```

---

### Permission denied (ScreenCaptureKit / Accessibility)

**Triệu chứng:** `[capture] CGRequestScreenCaptureAccess denied` hoặc `[a11y] AXIsProcessTrusted = false`

```bash
# Mở System Settings → Privacy & Security → Screen Recording
# Bật quyền cho Terminal hoặc OmniState.app

# Kiểm tra trạng thái:
osascript -e 'tell application "System Events" to get UI elements enabled'
```

Sau khi cấp quyền, **restart gateway** (quyền không hot-reload).

---

### Native module (.node) không load

**Triệu chứng:** `Error: Cannot find module '...omnistate-napi.node'`

```bash
# Rebuild N-API bridge
pnpm --filter @omnistate/gateway build:native

# Nếu fail, kiểm tra Rust toolchain
rustup show
cargo --version
```

---

## Phục Hồi

### Backup database

```bash
# SQLite online backup (an toàn khi DB đang mở)
sqlite3 ~/.omnistate/omnistate.db ".backup ~/.omnistate/omnistate.db.bak"
```

### Phục hồi từ backup

```bash
# Dừng gateway trước
kill -TERM $(lsof -ti :19800)

# Copy backup về
cp ~/.omnistate/omnistate.db.bak ~/.omnistate/omnistate.db

# Khởi động lại
pnpm app:start
```

### DB bị corrupt

```bash
# Thử sửa với integrity check
sqlite3 ~/.omnistate/omnistate.db "PRAGMA integrity_check;"

# Nếu fail, xóa và để gateway tạo lại (mất dữ liệu)
rm ~/.omnistate/omnistate.db
pnpm app:start
```

### Reset JWT secret

```bash
rm ~/.omnistate/jwt-secret
# Gateway sẽ tự tạo mới khi khởi động
# LƯU Ý: Tất cả phiên đăng nhập hiện tại sẽ bị vô hiệu hóa
```

### Rollback 1 phiên bản

```bash
git log --oneline -10     # Tìm commit muốn rollback về
git checkout v0.1.0       # Hoặc commit hash
pnpm install
pnpm build
pnpm app:start
```

---

## CI/CD Pipeline

Xem chi tiết tại [Chiến Lược Kiểm Thử](18-CHIEN-LUOC-KIEM-THU.md).

Workflows tại `.github/workflows/`:
- `ci.yml` — lint, typecheck, test, Rust check, Swift build
- `release.yml` — build N-API binaries đa nền tảng, tạo GitHub Release

---

## Tham chiếu

- [Mô Hình Bảo Mật](10-MO-HINH-BAO-MAT.md) — JWT, permission model
- [Hợp Đồng API](16-HOP-DONG-API.md) — endpoints health/readyz
- [Chiến Lược Kiểm Thử](18-CHIEN-LUOC-KIEM-THU.md) — CI gate
- `packages/gateway/src/db/database.ts` — DB setup & migrations
