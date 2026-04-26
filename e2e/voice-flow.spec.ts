/**
 * Phase 4.2 — Voice Pipeline E2E Tests
 *
 * Status: ALL SKIPPED — Playwright is not yet configured in this repo.
 *
 * To enable:
 *   pnpm add -D @playwright/test
 *   npx playwright install chromium
 *   # then add a playwright.config.ts at repo root pointing to this file
 *
 * Coverage:
 *   1. TTS preview — intercept /api/tts/preview, assert JSON { audio: <base64> }
 *   2. Enrollment wizard smoke — assert 5 phrase steps, cancel, clean unmount
 *   3. Settings roundtrip — toggle speaker-verification, persist across reload
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// 1. TTS Preview
// ---------------------------------------------------------------------------

test.skip("TTS preview returns 200 JSON with audio field", async ({ page }) => {
  // TODO: Playwright not installed. Unskip after `pnpm add -D @playwright/test`.
  //
  // Expected flow:
  //   1. page.route('/api/tts/preview*', route => route.fulfill({
  //        status: 200,
  //        contentType: 'application/json',
  //        body: JSON.stringify({ audio: 'dGVzdA==', voice: 'vi-VN-HoaiMyNeural' }),
  //      }))
  //   2. await page.goto('http://localhost:3000/config');          // VoiceSettings page
  //   3. await page.selectOption('[data-testid="voice-select"]', 'vi-VN-HoaiMyNeural');
  //   4. const [response] = await Promise.all([
  //        page.waitForResponse('/api/tts/preview*'),
  //        page.click('[data-testid="tts-test-button"]'),
  //      ]);
  //   5. expect(response.status()).toBe(200);
  //   6. const body = await response.json();
  //   7. expect(body).toMatchObject({ audio: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/) });

  expect(true).toBe(true); // placeholder so the file parses
});

// ---------------------------------------------------------------------------
// 2. Enrollment Wizard Smoke
// ---------------------------------------------------------------------------

test.skip("Enrollment wizard renders 5 phrase steps and cancels cleanly", async ({ page }) => {
  // TODO: Unskip after Playwright is installed.
  //
  // Mock WebSocket so no real mic / gateway is needed:
  //
  //   await page.addInitScript(() => {
  //     class FakeWebSocket extends EventTarget {
  //       static OPEN = 1;
  //       readyState = FakeWebSocket.OPEN;
  //       send(data: string) {
  //         const msg = JSON.parse(data);
  //         if (msg.type === 'enroll_start') {
  //           setTimeout(() => this.dispatchEvent(
  //             Object.assign(new MessageEvent('message'), {
  //               data: JSON.stringify({ type: 'ready', phraseIndex: 0 }),
  //             })
  //           ), 50);
  //         }
  //       }
  //       close() {}
  //     }
  //     (window as any).WebSocket = FakeWebSocket;
  //   });
  //
  // Then:
  //   await page.goto('http://localhost:3000/config');
  //   await page.click('[data-testid="enrollment-open-button"]');
  //   const steps = page.locator('[data-testid="enrollment-phrase-step"]');
  //   await expect(steps).toHaveCount(5);
  //   await page.click('[data-testid="enrollment-cancel-button"]');
  //   await expect(page.locator('[data-testid="enrollment-modal"]')).not.toBeVisible();

  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// 3. Settings Roundtrip
// ---------------------------------------------------------------------------

test.skip("Speaker-verification settings persist across reload", async ({ page }) => {
  // TODO: Unskip after Playwright is installed. Requires a running web server
  //       and writable settings store (or mock localStorage / API).
  //
  // Expected flow:
  //   await page.goto('http://localhost:3000/config');
  //
  //   // Toggle speaker-verification on
  //   await page.check('[data-testid="sv-enabled-toggle"]');
  //
  //   // Set threshold to 0.80
  //   await page.fill('[data-testid="sv-threshold-input"]', '0.80');
  //
  //   // Set onMismatch to "reject"
  //   await page.selectOption('[data-testid="sv-on-mismatch-select"]', 'reject');
  //
  //   // Save / wait for auto-save
  //   await page.click('[data-testid="sv-save-button"]');
  //   await page.waitForResponse('/api/voice/settings');
  //
  //   // Reload and assert persistence
  //   await page.reload();
  //   await expect(page.locator('[data-testid="sv-enabled-toggle"]')).toBeChecked();
  //   await expect(page.locator('[data-testid="sv-threshold-input"]')).toHaveValue('0.80');
  //   await expect(page.locator('[data-testid="sv-on-mismatch-select"]')).toHaveValue('reject');

  expect(true).toBe(true);
});
