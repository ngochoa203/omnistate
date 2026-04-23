# ADR-0001: Chọn Rust cho Tầng Sâu (Capture / A11y / Input)

**Ngày:** 2025-01
**Trạng thái:** Accepted
**Tác giả:** Team OmniState

---

## Bối Cảnh

OmniState cần truy cập trực tiếp vào các macOS system API cấp thấp:

- **ScreenCaptureKit / IOSurface** — chụp màn hình zero-copy từ GPU
- **AXUIElement** — đọc cây accessibility (a11y) của ứng dụng
- **CGEvent** — inject mouse/keyboard events

Các thao tác này yêu cầu:
1. Hiệu suất thấp-latency (capture frame < 16ms cho 60fps)
2. Binding trực tiếp với Objective-C / C frameworks của macOS
3. Kiểm soát bộ nhớ tường minh (không GC pause)
4. An toàn thread (CGEvent phải đến từ đúng thread)

---

## Phương Án Đã Xem Xét

1. **Rust + N-API bridge** — Rust gọi macOS C API qua `objc2` crate, export sang Node.js qua NAPI-RS
2. **Node.js N-API trực tiếp (C++)** — viết C++ addon thủ công
3. **Swift framework** — viết Swift library, gọi từ Node.js qua FFI
4. **Python + ctypes** — gọi macOS API qua ctypes

---

## Quyết Định

Chọn **Rust + N-API bridge** vì:

- **Hiệu suất:** Rust zero-cost abstractions, không GC, phù hợp với yêu cầu latency thấp cho screen capture
- **An toàn:** Ownership model ngăn race condition và use-after-free — quan trọng khi thao tác với CGEvent và IOSurface
- **Ecosystem:** `objc2` crate có binding chất lượng cao cho Objective-C runtime; `napi-rs` tạo N-API binding an toàn và ergonomic
- **Build tooling:** Cargo + cross-compilation rõ ràng hơn cmake/gyp của C++ addon
- So với Swift: Rust có ecosystem tốt hơn cho cross-platform (Ubuntu CI check), Swift khó export FFI an toàn

**Kết quả:** 6 crates (`omnistate-core`, `capture`, `screen`, `input`, `a11y`, `napi`), tất cả export qua một N-API bridge duy nhất.

---

## Hậu Quả

### Tích cực
- Screen capture đạt < 16ms/frame (60fps) trên M1/M2
- Rust type system ngăn lỗi khi thao tác với raw pointer của macOS API
- `cargo test` chạy được trên CI (Ubuntu cho core crates, macOS cho platform crates)

### Tiêu cực / Trade-off
- Contributor cần biết Rust — thêm rào cản đóng góp
- Build time Rust (~2–4 phút clean build) dài hơn TypeScript
- macOS-specific crates không chạy trên Linux/Windows

### Rủi ro
- `objc2` crate là cộng đồng, không phải Apple-official — có thể lag sau các macOS major update
- Thay đổi ScreenCaptureKit API (Apple) có thể yêu cầu update Rust unsafe code

---

## Tham chiếu

- [Công Nghệ & Triển Khai](../12-CONG-NGHE-VA-TRIEN-KHAI.md)
- [Các Tầng Thực Thi](../04-CAC-TANG-THUC-THI.md)
- `crates/` — source code Rust crates
- [napi-rs](https://napi.rs/), [objc2](https://github.com/madsmtm/objc2)
