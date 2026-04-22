# Hợp Đồng API

## Mục đích

Tài liệu này là nguồn sự thật (source of truth) cho tất cả giao diện mà client có thể gọi vào OmniState Gateway — HTTP REST, WebSocket protocol, Mirror session, và API plugin.

---

## Cổng Mặc Định

| Cổng | Giao thức | Mô tả |
|------|-----------|-------|
| **19800** | WebSocket | Kênh chính — task dispatch, streaming, config |
| **19801** | HTTP/1.1 | REST API — auth, voice, devices, network |

---

## Định Dạng Lỗi Chuẩn

Mọi HTTP error đều trả về:

```json
{
  "error": "Mô tả ngắn bằng tiếng Anh"
}
```

| HTTP Status | Ý nghĩa |
|-------------|---------|
| 400 | Thiếu trường bắt buộc / dữ liệu không hợp lệ |
| 401 | Chưa xác thực (token thiếu hoặc hết hạn) |
| 403 | Không đủ quyền |
| 404 | Resource không tìm thấy |
| 409 | Conflict (VD: email đã tồn tại) |
| 429 | Vượt rate limit |
| 500 | Lỗi nội bộ server |

---

## HTTP REST Endpoints

### Xác Thực (`/api/auth/*`)

**Rate limit:** 10 request / 15 phút trên `/api/auth/`

#### `POST /api/auth/signup`

Tạo tài khoản mới.

```
Request:  { email, password, displayName? }
Response: { user: User, token: string, refreshToken: string }
Errors:   400 (thiếu trường), 409 (email đã tồn tại)
```

#### `POST /api/auth/login`

Đăng nhập, trả JWT.

```
Request:  { email, password }
Response: { user: User, token: string, refreshToken: string }
Errors:   401 (sai mật khẩu), 404 (user không tồn tại)
```

#### `POST /api/auth/refresh`

Làm mới access token bằng refresh token.

```
Request:  { refreshToken: string }
Response: { token: string, refreshToken: string }
Errors:   401 (refresh token hết hạn / không hợp lệ)
```

#### `POST /api/auth/logout`

Thu hồi session hiện tại.

```
Headers:  Authorization: Bearer <token>
Response: { ok: true }
```

#### `GET /api/auth/me`

Trả thông tin user đang đăng nhập.

```
Headers:  Authorization: Bearer <token>
Response: User object (không có password_hash)
```

---

### Voice (`/api/voice/*`)

**Rate limit:** 30 request / 15 phút

#### `POST /api/voice/enroll`

Đăng ký vân giọng từ audio sample.

```
Headers:  Authorization: Bearer <token>
Request:  multipart/form-data  field: audio (WAV/WebM)
Response: { ok: true, sampleCount: number }
Errors:   400 (audio quá ngắn), 413 (file quá lớn)
```

#### `POST /api/voice/verify`

Xác minh giọng nói so với vân đã đăng ký.

```
Headers:  Authorization: Bearer <token>
Request:  multipart/form-data  field: audio
Response: { match: boolean, score: number, threshold: number }
```

---

### Devices (`/api/devices/*`)

#### `POST /api/devices/generate-pin`

Tạo PIN 6 chữ số (hết hạn sau 5 phút) để ghép đôi thiết bị mới.

```
Headers:  Authorization: Bearer <token>
Response: { pin: string, expiresAt: string }
```

#### `POST /api/devices/pair`

Thiết bị mới dùng PIN để lấy device token.

```
Request:  { pin, deviceName, deviceType: "android"|"ios"|"cli" }
Response: { deviceToken: string, refreshToken: string, deviceId: string }
Errors:   401 (PIN sai / hết hạn), 403 (IP không thuộc LAN/Tailscale)
```

#### `GET /api/devices`

Danh sách thiết bị đã đăng ký.

```
Headers:  Authorization: Bearer <token>
Response: { devices: Device[] }
```

#### `POST /api/devices/refresh`

Làm mới device token.

```
Request:  { refreshToken: string }
Response: { deviceToken: string, refreshToken: string }
```

#### `DELETE /api/devices/:id`

Thu hồi thiết bị.

```
Headers:  Authorization: Bearer <token>
Response: { ok: true }
```

---

### Network (`/api/network/*`)

#### `GET /api/network/info`

Thông tin mạng của máy host.

```
Response: {
  lanIps: string[],
  tailscaleIp: string | null,
  hostname: string
}
```

#### `GET /api/network/tailscale`

Trạng thái Tailscale (từ `tailscale status --json`).

```
Response: { connected: boolean, ip: string | null, peers: Peer[] }
```

---

### Health

#### `GET /health` hoặc `GET /healthz`

Kiểm tra trạng thái gateway nhanh. Không cần auth.

```
Response: { status: "ok", uptime: number, version: string }
```

#### `GET /readyz`

Gateway sẵn sàng nhận request (DB connected, config loaded).

```
Response: { ready: true }
Errors:   503 nếu chưa sẵn sàng
```

---

## WebSocket Protocol (port 19800)

### Kết Nối & Xác Thực

Sau khi mở WS, client gửi `ConnectMessage` đầu tiên:

```json
{
  "type": "connect",
  "role": "ui" | "cli" | "remote" | "fleet-agent",
  "auth": { "token": "<jwt>" }
}
```

Gateway phản hồi `connected` hoặc đóng kết nối nếu token không hợp lệ.

---

### Client → Gateway (ClientMessage)

| `type` | Mô tả | Trường chính |
|--------|-------|--------------|
| `task` | Dispatch tác vụ AI | `goal`, `layer?`, `attachments?` |
| `claude.mem.query` | Truy vấn bộ nhớ Claude | — |
| `claude.mem.sync` | Đồng bộ bộ nhớ Claude | `payload` |
| `history.query` | Lấy lịch sử task | — |
| `status.query` | Trạng thái gateway | — |
| `runtime.config.get` | Lấy config hiện tại | — |
| `runtime.config.set` | Cập nhật config key | `key`, `value` |
| `runtime.config.upsert_provider` | Thêm/sửa LLM provider | provider object |
| `health.query` | Sức khỏe hệ thống | — |
| `llm.preflight` | Kiểm tra LLM provider | — |
| `admin.shutdown` | Tắt gateway (admin) | — |
| `voice.transcribe` | Phiên âm audio | `audioBase64`, `mimeType` |
| `voice.stream.start` | Bắt đầu stream giọng liên tục | — |
| `voice.stream.chunk` | Gửi chunk audio nhị phân | — |
| `voice.stream.end` | Kết thúc stream | — |
| `permission.policy.get` | Lấy chính sách permission | — |
| `permission.policy.update` | Cập nhật chính sách | `policy` |
| `permission.history` | Nhật ký permission | — |
| `permission.start` | Bật permission monitor | — |
| `permission.stop` | Tắt permission monitor | — |

---

### Gateway → Client (ServerMessage)

| `type` | Mô tả | Trường chính |
|--------|-------|--------------|
| `connected` | Xác nhận kết nối | `clientId`, `sessionId` |
| `task.ack` | Gateway nhận task | `taskId` |
| `task.progress` | Tiến độ thực thi | `taskId`, `step`, `message` |
| `task.complete` | Task hoàn thành | `taskId`, `output` |
| `task.error` | Task thất bại | `taskId`, `error` |
| `ack` | Xác nhận chung | `ok`, `requestType`, `data?` |
| `status.report` | Trạng thái gateway | `clients`, `uptime`, `version` |
| `runtime.config.report` | Config hiện tại | config object |
| `history.result` | Kết quả lịch sử | `entries: TaskHistory[]` |
| `health.report` | Sức khỏe hệ thống | sensors, alerts |
| `broadcast` | Thông báo tới tất cả client | `event`, `data` |
| `error` | Lỗi protocol | `message` |

---

## Mirror Session Protocol

Dùng để điều khiển màn hình Android/iOS từ xa qua WebSocket.

### Handshake

```
source  →  { type: "hello", role: "source", sessionId, streamId, deviceId }
viewer  →  { type: "hello", role: "viewer", sessionId }
```

### Frame Nhị Phân (Binary)

```
Byte 0: magic = 0x01
Byte 1: streamId (0–255)
Byte 2+: JPEG bytes
```

### Control Messages

| `type` | Hướng | Mô tả |
|--------|-------|-------|
| `meta` | source→viewer | width, height, fps, deviceName |
| `input` | viewer→source | action: tap/swipe/key/text/back/home/recents |
| `ping` / `pong` | cả hai | Keep-alive, pong có trường `ts` |
| `bye` | cả hai | Đóng session sạch sẽ |

---

## Plugin API Surface

> TBD — Plugin API được thiết kế qua hook registry. Chi tiết tham khảo [Hệ Thống Plugin](09-HE-THONG-PLUGIN.md).

Plugin đăng ký hooks tại khởi động:

```typescript
// Mẫu đăng ký hook (không cam kết public interface)
registry.register("system-health", {
  onTaskComplete: async (ctx) => { ... },
  onHealthCheck:  async ()      => { ... },
});
```

---

## Rate Limiting

| Nhóm endpoint | Giới hạn | Cửa sổ |
|---------------|---------|--------|
| Tất cả `/api/` | 100 req | 15 phút |
| `/api/auth/` | 10 req | 15 phút |
| `/api/voice/` | 30 req | 15 phút |

Khi vượt giới hạn: HTTP 429 + header `Retry-After`.

---

## Tham chiếu

- [Mô Hình Dữ Liệu](15-MO-HINH-DU-LIEU.md) — bảng DB phía sau endpoints
- [Mô Hình Bảo Mật](10-MO-HINH-BAO-MAT.md) — JWT, auth flow
- [Điều Khiển Từ Xa](11-DIEU-KHIEN-TU-XA.md) — device pairing chi tiết
- Source: `packages/gateway/src/http/`, `packages/shared/src/protocol.ts`
