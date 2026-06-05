/**
 * Phase 4.2 - Voice Pipeline E2E Tests
 *
 * Status: Tests require a running web + gateway stack.
 * To run these against a live backend:
 *   1. Start the full stack: pnpm app:run:all
 *   2. Run e2e:                  pnpm test:e2e
 *
 * OR use the setup helper (auto-starts gateway + web):
 *   node scripts/dev/e2e-setup.mjs
 *
 * Prerequisites for live running:
 *   - Gateway on ws://127.0.0.1:19800 and http://127.0.0.1:19801
 *   - Web dev server on http://localhost:5173 (or set OMNISTATE_E2E_BASE_URL)
 *   - Voice Python venv (optional for TTS tests)
 *
 * When gateway/web is not running, tests skip with clear messaging rather than
 * failing confusingly. Fix: run pnpm app:run:all first.
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper: Ensure backend is reachable
// ---------------------------------------------------------------------------

async function waitForGateway(maxMs = 5000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch("http://127.0.0.1:19801/healthz");
      if (res.ok) return true;
    } catch { /* gateway not ready */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function waitForWeb(maxMs = 5000): Promise<boolean> {
  const baseUrl = process.env.OMNISTATE_E2E_BASE_URL ?? "http://localhost:5173";
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(baseUrl + "/");
      if (res.ok || res.status < 500) return true;
    } catch { /* web not ready */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gateway availability guard
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.describe("Voice Flow E2E", () => {
  test.beforeEach(async () => {
    const [gatewayReady, webReady] = await Promise.all([
      waitForGateway(5000),
      waitForWeb(5000),
    ]);
    if (!gatewayReady || !webReady) {
      test.skip(
        true,
        "Gateway or web not running. Start with: pnpm app:run:all, then re-run pnpm test:e2e"
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Gateway + web smoke
  // ---------------------------------------------------------------------------

  test("gateway health endpoint returns ok", async ({ request }) => {
    const response = await request.get("http://127.0.0.1:19801/healthz");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  // ---------------------------------------------------------------------------
  // 2. TTS route negative-path contract
  // ---------------------------------------------------------------------------

  test("TTS preview rejects missing text with structured 400", async ({ request }) => {
    const response = await request.post("http://127.0.0.1:19801/api/tts/preview", {
      data: {},
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "MISSING_TEXT",
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Web auth gate smoke
  // ---------------------------------------------------------------------------

  test("web root shows the auth/enrollment gate by default", async ({ page }) => {
    const baseUrl = process.env.OMNISTATE_E2E_BASE_URL ?? "http://localhost:5173";
    await page.goto(baseUrl);
    await expect(page.getByText("Welcome to OmniState")).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
  });
});
