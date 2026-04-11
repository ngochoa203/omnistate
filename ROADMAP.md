# OmniState Product Roadmap

## Muc tieu
- Dua OmniState tu prototype len product command-first tren macOS.
- Tang do on dinh, bao mat, va kha nang van hanh truoc khi mo rong da nen tang.
- Tich hop nhan dien giong noi da nguoi dung bang SpeechBrain theo huong pre-trained embedding + cosine similarity.

## Trang thai hien tai
### Da hoan thanh
- Gateway daemon hoat dong on dinh tren macOS.
- WebSocket gateway va HTTP bridge da chay.
- Health endpoints:
  - GET /healthz
  - GET /readyz
- CLI co bo lenh van hanh chinh:
  - start, stop, status, run, config, model, session, health, doctor
- Voiceprint pipeline (SpeechBrain ECAPA-TDNN):
  - enroll/verify qua script
  - enroll/verify qua HTTP API
- FE da hop nhat dashboard + voice identity panel.
- Script run full stack bang mot lenh da co.

### Dang can hoan thien
- Tinh nang semantic repair cho media command trong dieu kien ASR nhieu nhieu.
- Chuan hoa data model speakerProfiles cho truong hop da nguoi dung lon.
- Hardening auth cho voice API trong moi truong production.

## Lo trinh theo giai doan

## Phase 1: On dinh nen tang (1-2 tuan)
### Muc tieu
- Chot duong day command-first va giam loi execute sai.

### Cong viec
- Hoan thien command confidence gate cho media va system commands.
- Them fallback confirm step khi confidence thap.
- Bo sung trace event chuan cho toan bo command lifecycle.
- Them test integration cho:
  - wake -> command capture -> rewrite -> send
  - low-confidence -> follow-up capture -> recovered command

### Dau ra
- Ty le command sai do ASR giam ro ret.
- Co bo log de debug theo taskId/day.

## Phase 2: Voice Identity da nguoi dung (2-3 tuan)
### Muc tieu
- San sang cho use case nhieu nguoi dang ky giong noi tren cung mot gateway.

### Cong viec
- Chuan hoa schema speakerProfiles (userId/displayName/enabled/threshold).
- Them API management:
  - list profiles
  - update threshold/profile metadata
  - disable/remove profile
- Them enrollment flow trong FE:
  - upload audio
  - ket qua quality check
  - preview similarity score
- Them benchmark script:
  - FAR/FRR
  - ROC nguong de xac dinh threshold theo moi user

### Dau ra
- Phan biet duoc nhieu user tren cung he thong.
- Co quy trinh dang ky va quan tri voice profile day du.

## Phase 3: Security + Ops hardening (2 tuan)
### Muc tieu
- Dat muc deploy an toan cho team nho.

### Cong viec
- Ep token auth cho voice enroll/verify o mode production.
- Them rate limit cho endpoint voice va siri bridge.
- Them audit log cho hanh dong nhay cam.
- Bo sung doctor checks:
  - token policy
  - permission state
  - storage/file permission
- Viet runbook su co va checklist release.

### Dau ra
- Giam rui ro abuse endpoint.
- Tang kha nang van hanh va bao tri.

## Phase 4: Productization FE/UX (2 tuan)
### Muc tieu
- Bien dashboard thanh control center day du.

### Cong viec
- Hop nhat status, health, voice identity, config trong mot luong UX ro rang.
- Them onboarding wizard cho setup lan dau.
- Them toasts + error states + retry UX chuan.
- Them quick actions cho cac command pho bien.

### Dau ra
- Luong su dung ro rang cho user cuoi.
- Giam thao tac terminal o cac tac vu thong thuong.

## Phase 5: Mo rong kha nang va scale (3-4 tuan)
### Muc tieu
- San sang scale use case va tich hop them.

### Cong viec
- Them plugin contracts on dinh.
- Bo sung queue controls va scheduler nang cao.
- Danh gia remote mode va multi-node strategy.
- Theo doi hieu nang, them benchmark throughput.

### Dau ra
- Kha nang mo rong theo use case enterprise nho/vua.

## KPI de theo doi
- Command success rate.
- False execute rate.
- Voice verification FRR/FAR.
- Mean task completion time.
- Gateway uptime.
- MTTR khi co su co.

## Milestone de xuat
- M1 (Tuan 2): Command-first on dinh, test xanh.
- M2 (Tuan 5): Multi-user voice identity co UI quan tri co ban.
- M3 (Tuan 7): Security/ops hardening + release candidate.
- M4 (Tuan 9): FE productized + public demo internal.

## Ghi chu trien khai
- Uu tien command-first va su dung voice nhu tang bo sung.
- Tat ca luong voice can co fallback text ro rang.
- Khi deploy production: bat token bat buoc, tat local bypass.
