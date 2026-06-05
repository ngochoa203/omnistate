# OmniState Testing Strategy

## Quality Gates

- `pnpm test:voice`: voice capture, wake, streaming, command routing, STT/TTS plumbing.
- `pnpm test:voice:full`: full legacy voice suite. This currently exposes unstable enrollment/verification/whisper subprocess tests and should be used while hardening those areas before moving them into the required gate.
- `pnpm test:gateway`: gateway unit and integration tests.
- `pnpm test:web`: web UI component and hook tests.
- `pnpm test:e2e`: browser end-to-end flows.
- `pnpm test:quality`: lint, build, all unit/integration tests, then e2e.

## Coverage Matrix

| Area | Required coverage |
| --- | --- |
| Voice input | stream start/chunk/stop, empty audio, invalid base64, STT fallback, VAD bypass, command routing, TTS result |
| Wake | engine selection, missing model behavior, cooldown/window, restart health, wake-to-session transition |
| NLP/intent | Vietnamese, English, mixed language, ambiguous app/file/media commands, missing parameter clarification |
| Gateway | auth, runtime config, health, event/memory routes, task pipeline, cancellation, WebSocket routing |
| Executor/layers | happy path, failure path, retries, permission/approval, idempotency for destructive actions |
| Web | voice hooks, gateway client protocol, settings, onboarding, error boundaries |
| Native/macOS/Rust | permission checks, capture/input/a11y adapters, smoke tests on macOS CI |

## Rules

- Every new feature gets at least one fast unit test and one integration-style test at the closest boundary.
- Bugs get regression tests that fail without the fix.
- Voice changes must test protocol compatibility between `packages/web`, `packages/shared`, and `packages/gateway`.
- Hardware/OS-dependent behavior should be behind adapters and tested with mocks; one smoke/e2e test can cover real integration.
- Do not rely on external STT/LLM services in default CI. Use mocks for deterministic tests and keep provider smoke tests opt-in.

## Recommended Next Additions

- Add synthetic audio fixtures: silence, short speech, noisy speech, invalid codec.
- Add contract tests generated from `packages/shared/src/protocol.ts`.
- Add coverage thresholds after the current uncovered legacy areas are baselined.
- Add nightly macOS voice smoke tests using a known WAV fixture and local Whisper model.
- Stabilize `test:voice:full` by removing real subprocess dependencies from Whisper tests and making enrollment start/resume tests await async progress restore.
