# E2E Manual Test Plan — Voice Enrollment

## Prerequisites

- Gateway running (`pnpm -C packages/gateway dev`)
- `OMNISTATE_RTC_PROFILE_DIR` set (e.g. `/tmp/omnistate-profiles`)
- Microphone available in the browser
- A test user authenticated (userId visible in session)

## Steps

1. **Open** `http://localhost:3000/config` in Chrome/Firefox.
2. **Enable microphone** — click the mic toggle; browser should prompt for permission. Grant it.
3. **Phrase 1** — Click the first enrollment prompt. Speak the phrase when the recording indicator turns red. Wait for the green checkmark.
4. **Phrase 2–5** — Repeat for each of the remaining 4 prompts. The progress bar should advance 20 % per phrase (total 5 phrases = 100 %).
5. **Verify progress UI** — After each phrase the counter should read "N / 5 phrases recorded". The "Finish Enrollment" button is disabled until all 5 are done.
6. **Complete enrollment** — After phrase 5, click "Finish Enrollment". A success toast should appear.

## Expected File Output

After step 6, verify the profile file exists:

```
$OMNISTATE_RTC_PROFILE_DIR/enrollment/<userId>.json
```

The JSON must contain:
- `userId` matching the authenticated user
- `sampleCount: 5`
- `embedding` array of length 256
- `createdAt` and `updatedAt` ISO timestamps

```bash
cat "$OMNISTATE_RTC_PROFILE_DIR/enrollment/<userId>.json" | jq '{userId, sampleCount, embLen: (.embedding | length)}'
# expected: { "userId": "...", "sampleCount": 5, "embLen": 256 }
```

## Playwright Automation Note

Playwright is not yet configured in this repo. To add it:

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

Then convert this plan into `e2e/voice-enrollment.spec.ts` using
`page.goto`, `page.click`, and `page.waitForSelector`. Mock the mic
with `context.grantPermissions(['microphone'])` and inject a fake audio
stream via the browser's AudioContext, or record real audio with
`page.evaluate` + MediaRecorder.
