# Ma tran Use Case OmniState (macOS)

Tai lieu nay chuyen danh sach UC thanh trang thai thuc thi trong repo.

## Cach kiem tra nhanh
- Chay bao cao tong hop:

```bash
pnpm usecase:report
```

- Du lieu nguon nam o:
  - `usecases.matrix.json`

## Dinh nghia trang thai
- `implemented`: da co trong repo va co the chay duoc tren macOS.
- `partial`: da co mot phan, can hoan thien de dung production.
- `planned`: chua co implementation ro rang.

## Tong quan theo nhom
- UC1 GUI & Peripherals: da co nen tang dieu khien chuot/ban phim/screenshot.
- UC2 Window & App: da co launch/quit/focus/process list, da co split/snap co ban (dang harden).
- UC3 File system: da co read/write/search, cac thao tac quan ly batch can bo sung.
- UC4 Browser: da co open URL/tab/form fill, da co luong bookmark + history/cache co ban.
- UC5 System & Network: da co health va power, networking/control can harden them.
- UC6 Communication & Media: da co media control co ban, email/calendar/reminder chua productized.
- UC7 Workflow automation: UC7.2 da implemented voi node verify + retry theo field map.
- UC8 Software & Environment: da co package/service/update/startup primitives, can them policy va UX.
- UC9 Hardware & External Device: da co printer/health mot phan; webcam/mic permission da co planner routing (partial).
- UC10 Security & Privacy: da co firewall/network control; vault/password automation da co planner routing (partial).
- UC11 Developer & CLI: da co NL->terminal va mot phan docker/git workflow.
- UC12 Maintenance & Troubleshooting: da co disk cleanup + diagnostics, can bo sung auto-remediation sau cung.
- UC13 Context-Aware On-Screen AI: da co OCR/table/a11y/language primitives, overlay/context summary con thieu.

## Uu tien trien khai tiep theo
1. UC13.1 + UC13.3: on-screen translation overlay va context summarization.
2. UC5.1/UC5.2: wifi/bluetooth toggle/connect o muc production-safe.
3. UC6.2/UC6.3/UC6.4: harden email/calendar/reminder de tu dong tin cay hon.
4. UC12.2/UC12.4: auto network repair va scheduled disk optimization (an toan production).
5. UC9.3 + UC10.3: nang tu planner-routing len production-safe execution guard.

## Delta cap nhat dot nay
- Hoan thien UC4.6/UC4.7 o planner (bookmark + history/cache management).
- Nang UC7.2 len implemented bang workflow node verify + retry tung field.
- Them regression tests cho 3 intent moi: split window, autofill form, data-entry workflow.
- Bo sung planner routing + test cho UC9.3 (camera/mic privacy) va UC10.3 (vault/password flow).
- Bo sung planner routing + test cho UC1.10 (switch display), UC6.2/UC6.3/UC6.4 (email/calendar/reminder), UC12.4 (trim scheduling), UC13.3 (work-context summary).
- Mo rong UC5.1/UC5.2 voi lenh Wi-Fi/Bluetooth toggle/connect/disconnect trong planner routing.
- Mo rong UC13.1 voi luong OCR screenshot -> mo Translate URL de dich on-screen nhanh.
- Mo rong UC8.1/UC8.2/UC8.3/UC8.4 voi planner routing cho install/uninstall/update/startup management + regression tests.
- Mo rong UC12.2/UC12.3 voi planner routing auto network remediation va performance diagnostics + regression tests.
- Mo rong UC3.8 voi planner routing zip/unzip tu lenh NL va them regression tests.
- Mo rong UC10.4 voi planner routing encrypt/decrypt folder va secure shred + regression tests.
- Mo rong UC11.2 voi planner NL->git operations (status/commit/push/pull/branch/stash) + regression tests.
- Mo rong UC5.6 voi planner routing Focus/Do Not Disturb (on/off/status) va regression tests.
- Mo rong UC11.4 voi planner routing phan tich + tom tat log loi/crash bang shell diagnostics + regression tests.
- Mo rong UC13.4 voi planner routing smart desktop/workspace organization strategy + regression tests.
- Mo rong UC9.1 voi planner routing safe eject USB/external drives (diskutil unmount) + regression tests.
- Mo rong UC9.2 voi planner routing printer queue/scanner control (lpstat/system_profiler) + regression tests.
- Mo rong UC11.3 voi planner routing container lifecycle (docker compose up/down/restart) va Python virtual env lifecycle + regression tests.

## Ghi chu
- Danh sach UC chi de tracking capability trong codebase.
- Cap nhat `usecases.matrix.json` moi khi them/chinh sua UC.
