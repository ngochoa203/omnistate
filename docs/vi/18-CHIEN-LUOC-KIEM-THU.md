# Chiến Lược Kiểm Thử

## Mục đích

Định nghĩa kim tự tháp kiểm thử, mục tiêu coverage, CI gate, và chính sách với flaky tests cho toàn bộ dự án OmniState.

---

## Kim Tự Tháp Kiểm Thử

```
              ╔══════════════════╗
              ║   Manual Smoke   ║  ← Mỗi release
              ╠══════════════════╣
              ║  E2E / Integration║  ← Gateway E2E (vitest)
              ╠══════════════════╣
              ║  Native (cargo)  ║  ← Rust unit tests
              ╠══════════════════╣
              ║   Unit (vitest)  ║  ← Mỗi package TS/JS
              ╚══════════════════╝
```

---

## Tầng 1 — Unit Tests (vitest)

**Phạm vi:** Mỗi package trong monorepo (`packages/*`)

```bash
# Chạy tất cả unit tests
pnpm test

# Chỉ một package
pnpm --filter @omnistate/gateway test

# Watch mode (development)
pnpm --filter @omnistate/gateway test --watch
```

**Quy tắc:**
- Test files đặt cạnh source: `foo.ts` → `foo.test.ts`
- Mock external dependencies (DB, LLM, native module)
- Không gọi network thật
- Mỗi test độc lập, không chia sẻ state với nhau

---

## Tầng 2 — Native Tests (cargo test)

**Phạm vi:** 6 Rust crates trong `crates/`

```bash
# Chạy tất cả Rust tests
cargo test --workspace

# Chỉ crate cụ thể
cargo test -p omnistate-core

# Với output chi tiết
cargo test -- --nocapture
```

**Lưu ý:** Các crates dùng macOS API (capture, a11y, input) chỉ chạy được trên macOS runner. CI sử dụng `macos-14` cho full workspace test.

---

## Tầng 3 — Integration / E2E Tests

**Phạm vi:** Gateway daemon — kiểm tra end-to-end qua WebSocket và HTTP thật

```bash
# Chạy E2E suite (yêu cầu gateway đang chạy hoặc tự khởi động)
pnpm --filter @omnistate/gateway test:e2e
```

**36 test cases** trải qua 10 section:

| Section | Số test | Mô tả |
|---------|---------|-------|
| WebSocket connect | 3 | Kết nối, auth, reject |
| HTTP auth | 5 | signup, login, refresh, logout, /me |
| Device pairing | 4 | PIN, pair, list, revoke |
| Rate limiting | 3 | General, auth, voice limits |
| Task dispatch | 5 | Submit, progress, complete, error, cancel |
| Runtime config | 4 | get, set, upsert provider, invalid key |
| History | 3 | query, pagination, filter |
| Health | 4 | /health, /healthz, /readyz, WS health.query |
| Broadcast | 3 | Gửi tới tất cả connected clients |
| Voice | 2 | Enroll, verify (mock audio) |

---

## Tầng 4 — Manual Smoke Tests

Thực hiện trước mỗi release:

- [ ] Khởi động gateway từ binary release
- [ ] Mở web dashboard, kết nối WebSocket
- [ ] Dispatch task đơn giản ("chụp screenshot màn hình")
- [ ] Ghép đôi thiết bị Android qua PIN
- [ ] Xác minh giọng nói (voice verify)
- [ ] Kiểm tra trigger: tạo → bật → xem log

---

## Coverage Targets

| Package | Mục tiêu | Thực tế hiện tại |
|---------|---------|-----------------|
| `@omnistate/gateway` | ≥ 80% | > TBD |
| `@omnistate/web` | ≥ 70% | > TBD |
| `@omnistate/shared` | ≥ 90% | > TBD |
| Rust crates | ≥ 60% | > TBD |

```bash
# Xem coverage report
pnpm --filter @omnistate/gateway test --coverage
# Report HTML tại: packages/gateway/coverage/index.html
```

---

## CI Gate (GitHub Actions)

File: `.github/workflows/ci.yml`

```
Push / PR → main
    │
    ├── [rust] cargo fmt --check
    ├── [rust] cargo clippy -- -D warnings
    ├── [rust] cargo test --workspace  (macos-14 only)
    │
    ├── [typescript] pnpm lint
    ├── [typescript] pnpm typecheck
    ├── [typescript] pnpm test
    ├── [typescript] pnpm build
    │
    └── [swift] xcodebuild (macOS app compile check)
```

**Tất cả gate phải xanh** trước khi merge vào `main`.

CI hủy run cũ khi có push mới cùng branch (concurrency cancel-in-progress).

---

## Performance Benchmarks

**6 benchmarks** với mục tiêu p50/p95/p99:

| Benchmark | p50 mục tiêu | p95 mục tiêu | p99 mục tiêu |
|-----------|-------------|-------------|-------------|
| WS handshake | < 10ms | < 30ms | < 50ms |
| HTTP auth (login) | < 50ms | < 150ms | < 300ms |
| Task dispatch (ack) | < 20ms | < 60ms | < 100ms |
| DB query (task history) | < 5ms | < 15ms | < 30ms |
| WS throughput | > 1000 msg/s | — | — |
| HTTP throughput | > 500 req/s | — | — |

```bash
# Chạy benchmarks
pnpm --filter @omnistate/gateway bench
```

> TBD — Benchmark runner cụ thể và ngưỡng CI chưa được thiết lập chính thức.

---

## Chính Sách Flaky Tests

**Định nghĩa flaky:** Test fail < 20% số lần chạy mà không có thay đổi code.

**Quy trình:**

1. **Phát hiện:** CI fail nhưng retry pass → đánh dấu nghi ngờ
2. **Cách ly:** Move test vào thư mục `__flaky__/` trong vòng **24 giờ**
3. **Điều tra:** Tìm nguyên nhân (race condition, timeout cứng, phụ thuộc order)
4. **Sửa hoặc xóa:** Nếu không fix được trong **5 ngày làm việc** → xóa test, tạo issue tracking
5. **Không skip im lặng:** Không dùng `test.skip` mà không có comment + issue link

```typescript
// Cách đánh dấu flaky (tạm thời)
test.skip("WS reconnect race condition — xem issue #42", () => { ... });
```

---

## Database Test Isolation

Gateway cung cấp `getTestDb()` trả về SQLite in-memory:

```typescript
import { getTestDb } from "../db/database.js";

beforeEach(() => {
  const db = getTestDb(); // fresh DB mỗi test
});
```

Không test trên file `~/.omnistate/omnistate.db` thật.

---

## Tham chiếu

- [Runbook Vận Hành](17-RUNBOOK.md) — chạy gateway để E2E test
- [Hợp Đồng API](16-HOP-DONG-API.md) — endpoints được test
- [Đóng Góp](19-DONG-GOP.md) — quy trình PR và CI
- `.github/workflows/ci.yml` — CI pipeline thực tế
