# OmniState — 50 Use Cases

Status legend:
- `ready` — existing modules already cover this; implementation is wiring/UI only.
- `build` — needs new code in non-sensitive packages (gateway, shared, web, mobile-core).
- `blocked` — touches the remote-control / accessibility / overlay surface; out of scope here until the consent gate is implemented.
- `policy` — feasible technically but declined on ToS / abuse grounds (game botting, stealth surveillance, etc.).

Each UC lists: trigger → action → surface → status → touchpoints.

---

## A. Personal productivity (1–10)

1. **Morning briefing digest**
   Trigger: daily 07:30. Action: gateway aggregates calendar + unread counts + weather + top 3 tasks → push to phone + web.
   Surface: web `Dashboard`, Android `DashboardScreen`, macOS menu bar.
   Status: `build`. Touches: `gateway/triggers`, `gateway/integrations`, `shared/trigger-types.ts`, new `BriefingCard` in web.

2. **Focus-mode scheduler**
   Trigger: calendar event tagged `#focus`. Action: DND on all paired devices, silence non-VIP senders, start Pomodoro timer in menu bar.
   Surface: macOS, Android.
   Status: `build`. Touches: `gateway/session`, new `focus-mode` trigger kind.

3. **Cross-device clipboard**
   Trigger: user copies text on device A. Action: encrypted push to device B, expires after 60 s or first paste.
   Surface: all.
   Status: `build`. Touches: new `clipboard-relay` in gateway, AES-GCM key per pairing.

4. **"What was I doing?" resume**
   Trigger: user asks in chat. Action: return last 3 active apps / docs / URLs per device with timestamps; click to re-open via platform URL scheme.
   Surface: web Chat.
   Status: `build` (view-only activity log) / `blocked` (actually re-opening on remote device).

5. **Meeting auto-notes**
   Trigger: calendar event starts, mic permission on. Action: transcribe locally, diarize, extract action items, save to Notes.
   Surface: macOS.
   Status: `ready`. Touches: existing voice pipeline in `gateway/voice`.

6. **Daily shutdown checklist**
   Trigger: 18:00 weekdays. Action: checklist prompt (commit code, close tabs, log hours), tick in web, log to journal.
   Surface: web.
   Status: `build`. Small CRUD; new `checklists` resource type.

7. **Tab hoarder rescue**
   Trigger: Chrome/Arc has >50 tabs open. Action: group by domain, archive to reading list, keep top 5 recent.
   Surface: macOS.
   Status: `build`. AppleScript + `resource-types.ts` addition.

8. **Inbox zero triage**
   Trigger: hourly. Action: LLM classifies unread mail into reply/read/archive/snooze, presents queue; one-tap apply.
   Surface: web Mail view (new).
   Status: `build`. Touches: new Gmail/IMAP integration in `gateway/integrations`.

9. **Receipt scanner → spreadsheet**
   Trigger: photo taken matching receipt heuristic. Action: OCR, parse merchant/amount/date, append row to a Sheet.
   Surface: Android.
   Status: `build`. Needs Google Sheets integration.

10. **Weekly review generator**
    Trigger: Sunday 20:00. Action: compile commits, merged PRs, calendar hours, resolved tasks → markdown review.
    Surface: web.
    Status: `build`.

---

## B. Communication (11–18)

11. **Smart reply drafts**
    Trigger: unread message in supported app. Action: LLM drafts 3 replies matching the user's prior tone, user picks.
    Surface: web + Android notification.
    Status: `build`. Safe: drafts only, user sends manually.

12. **VIP priority inbox**
    Trigger: new message. Action: if sender in VIP list, bypass DND + ping watch.
    Surface: all.
    Status: `build`. Touches: `gateway/triggers`.

13. **Translation relay for chats**
    Trigger: incoming message in foreign language. Action: show translation inline; user types in VN, outgoing auto-translates.
    Surface: web Chat bridge.
    Status: `build`. Uses existing `i18n-types`.

14. **Voice-to-message** (on-device)
    Trigger: long-press record in web composer. Action: transcribe → send as text.
    Surface: web.
    Status: `ready`.

15. **Unified notification center**
    Trigger: any device gets a notification. Action: relay to web, dedupe across devices.
    Surface: web.
    Status: `build` iOS/Android read-only; no interactive dismissal.

16. **"Don't reply while driving"**
    Trigger: phone in Android Auto mode. Action: auto-reply with ETA pulled from Maps.
    Surface: Android.
    Status: `build`. Uses Android broadcast; no accessibility needed.

17. **Meeting handoff note**
    Trigger: meeting ends. Action: generate 5-line summary + next steps, send to chat of choice.
    Surface: macOS → web.
    Status: `build`.

18. **Language coach feedback**
    Trigger: user toggles on a chat. Action: correct grammar of their outgoing messages in a side panel before send.
    Surface: web.
    Status: `build`.

---

## C. Developer workflow (19–28)

19. **PR digest**
    Trigger: 09:00 daily. Action: summarize open PRs assigned/review-requested, CI status, stale >3d flagged.
    Surface: web Dev view.
    Status: `build`. GitHub integration.

20. **Auto-assign PR reviewers**
    Trigger: PR opened. Action: pick reviewers from CODEOWNERS + recent file authors.
    Surface: GitHub webhook → gateway.
    Status: `build`.

21. **Failing test localiser**
    Trigger: CI red. Action: parse log, link to the first failing assertion, quote stack, suggest likely file.
    Surface: web + Slack.
    Status: `build`.

22. **Branch hygiene nag**
    Trigger: weekly. Action: list branches merged/stale/unpushed across local machines, one-click delete.
    Surface: macOS.
    Status: `build`. Touches existing macOS app.

23. **"Explain this diff"**
    Trigger: user pastes diff or selects PR. Action: plain-English summary + risk annotations.
    Surface: web.
    Status: `ready` (LLM pipe exists).

24. **Secrets pre-commit scanner**
    Trigger: pre-commit hook. Action: block commit if entropy/keyword match on new lines.
    Surface: CLI.
    Status: `build`. New `packages/cli` command.

25. **Local log tail aggregator**
    Trigger: user starts dev servers. Action: tail all registered logs, colorize by source, grep bar in UI.
    Surface: macOS.
    Status: `build`.

26. **Dependency upgrade radar**
    Trigger: weekly. Action: run `npm outdated` / `pnpm outdated` across workspaces, group by major/minor/patch, propose a single PR for safe patches.
    Surface: web.
    Status: `build`.

27. **Incident timeline builder**
    Trigger: user tags chat thread `#incident`. Action: collect messages, git deploys in window, Sentry events → timeline markdown.
    Surface: web.
    Status: `build`.

28. **AI code review comments**
    Trigger: PR opened. Action: line-level comments for obvious issues (null deref, missing await, eslint). User approves before posting.
    Surface: GitHub.
    Status: `build`. Draft-only.

---

## D. Knowledge & capture (29–34)

29. **Screenshot → searchable note**
    Trigger: user screenshots anything. Action: OCR, tag, store in Notes with source URL/app metadata.
    Surface: macOS.
    Status: `build`.

30. **Link saver + summary**
    Trigger: share-sheet "Save to OmniState". Action: fetch page, readability extract, 3-bullet summary, store.
    Surface: all.
    Status: `build`.

31. **Voice memo index**
    Trigger: new memo. Action: transcribe, embed, searchable in web.
    Surface: web.
    Status: `ready` once voice pipeline wired.

32. **"Where did I read that?"**
    Trigger: semantic query. Action: search across saved notes/links/transcripts with snippet hits.
    Surface: web.
    Status: `build`. Needs embedding store (pgvector / sqlite-vec).

33. **Book highlight importer**
    Trigger: Kindle/Apple Books export detected in iCloud Drive. Action: parse and add to notes with spaced-repetition flag.
    Surface: macOS.
    Status: `build`.

34. **Handwriting OCR from iPad**
    Trigger: new Notability/GoodNotes export in iCloud. Action: OCR, index.
    Surface: macOS.
    Status: `build`.

---

## E. Health, home, and ambient (35–40)

35. **Hydration nudge**
    Trigger: every 90 min during work hours, DND-aware. Action: watch haptic + banner.
    Surface: Android.
    Status: `build`.

36. **Posture reminder**
    Trigger: 50 min continuous typing. Action: banner + short stretch prompt.
    Surface: macOS.
    Status: `build`.

37. **Wind-down mode**
    Trigger: 22:30. Action: warm-tint displays, silence non-VIP, prepare morning brief draft for 07:30.
    Surface: macOS + Android.
    Status: `build`.

38. **Smart-home scene by presence**
    Trigger: phone geofence enters/leaves home. Action: call Home Assistant scene.
    Surface: Android.
    Status: `build`. HA webhook integration.

39. **Parking spot memo**
    Trigger: Bluetooth car disconnects. Action: drop pin + 3-sec voice note prompt.
    Surface: Android.
    Status: `build`.

40. **Travel packing generator**
    Trigger: flight found in calendar. Action: weather-aware packing list, one-tap Todoist push.
    Surface: web.
    Status: `build`.

---

## F. Fleet / multi-device admin (41–45)

41. **Device inventory dashboard**
    Trigger: —. Action: list all paired devices, last seen, battery, storage, OS version.
    Surface: web Devices page.
    Status: `build`. Read-only, telemetry already flows via existing gateway session.

42. **Pair new device flow**
    Trigger: user scans QR in web. Action: gateway issues short-lived pairing token, device validates.
    Surface: web + mobile.
    Status: `build`. Uses `auth-types.ts`.

43. **Revoke device**
    Trigger: user clicks revoke. Action: invalidate device token on gateway, push `bye` on all open sockets.
    Surface: web.
    Status: `build`.

44. **Battery and storage alerts**
    Trigger: device reports <15% battery or <5% storage. Action: push notification to other paired device.
    Surface: all.
    Status: `build`.

45. **Session audit log viewer**
    Trigger: —. Action: view every mirror session, command execution, integration call, per device, with filters.
    Surface: web.
    Status: `build`. Pure viewer over gateway's audit store.

---

## G. Integrations (46–48)

46. **Calendar ⇄ tasks sync**
    Trigger: new `#todo` in calendar note. Action: create task in Todoist/Things/Linear, back-link.
    Surface: macOS.
    Status: `build`.

47. **Email → task**
    Trigger: email labeled `todo`. Action: create task with original thread link.
    Surface: gateway.
    Status: `build`.

48. **Paste → structured**
    Trigger: user pastes unstructured text in web composer. Action: detect type (address, event, contact, code) and offer one-tap "save as …".
    Surface: web.
    Status: `build`.

---

## H. Declined on policy (49–50)

49. **Game shop bot (Liên Quân, PUBG, etc.)**
    Would require stealth input into competitive games against the games' ToS.
    Status: `policy`. Not shipping.

50. **Silent stalker / covert install**
    Remote mirror + input without on-device consent UI or visible indicator.
    Status: `policy`. Not shipping. Consent-gated mirroring is the supported path — see `A.consent-gate.md` (TBD) for the design.

---

## Implementation slate (what I'll actually build from this list in this session if you pick it)

These touch only non-sensitive surfaces — no mirror / accessibility / overlay edits — so I can do them directly:

- **#41 Device inventory dashboard** (web page + gateway read endpoint).
- **#42/#43 Pair + revoke** (gateway endpoints, web UI, uses `auth-types`).
- **#45 Audit log viewer** (web page over a new read-only gateway endpoint).
- **#3 Cross-device clipboard relay** (gateway relay + web + shared types; no OS automation hooks).
- **#11 Smart reply drafts** (web-only, LLM pipe, drafts never auto-sent).
- **#19 PR digest** (gateway integration + web card).
- **#23 "Explain this diff"** (wire existing LLM pipe into a new web page).
- **#26 Dependency upgrade radar** (CLI + web read-only view).
- **#32 Semantic search over notes** (pgvector/sqlite-vec in gateway + web page).
- **#48 Paste → structured** (web-only).

Tell me which of these ten to start on and I'll do it now.
