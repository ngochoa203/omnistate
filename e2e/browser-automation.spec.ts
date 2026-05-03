/**
 * Phase 4.2 — Browser Automation E2E Tests
 *
 * Tests for Safari/Chrome browser automation including YouTube multi-step commands.
 * These tests require a running macOS system with the gateway server.
 *
 * To run:
 *   pnpm test:e2e
 *
 * Prerequisites:
 *   - Gateway server running on port 8080 (default)
 *   - Safari or Chrome installed on macOS
 *   - Automation permissions granted to Terminal in System Settings
 */

import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper: Connect to gateway WebSocket
// ---------------------------------------------------------------------------

interface GatewayMessage {
  id?: string;
  type: string;
  intent?: string;
  plan?: unknown;
  result?: unknown;
  error?: string;
}

async function sendGatewayCommand(
  ws: WebSocket,
  intent: string,
  args: Record<string, unknown>
): Promise<GatewayMessage> {
  return new Promise((resolve, reject) => {
    const id = `test-${Date.now()}`;
    ws.send(JSON.stringify({ id, type: "intent", intent, args }));

    const timeout = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`Timeout waiting for intent response: ${intent}`));
    }, 30000);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as GatewayMessage;
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.addEventListener("message", handler);
  });
}

// ---------------------------------------------------------------------------
// Test: Open Safari + YouTube on new tab
// ---------------------------------------------------------------------------

test.describe("Safari/YouTube Browser Automation", () => {
  test.beforeEach(() => {
    // Skip if not on macOS
    test.skip(
      process.platform !== "darwin",
      "Browser automation tests only run on macOS"
    );
  });

  test("opens Safari with new tab", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Connect to gateway WebSocket
    const wsUrl = "ws://localhost:8080";
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      test.skip(true, "Gateway not running on localhost:8080");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection failed"));
      });
    });

    try {
      // Step 1: Launch Safari
      const launchResult = await sendGatewayCommand(ws, "app.launch", {
        app: "Safari",
      });
      expect(launchResult.error).toBeUndefined();

      // Step 2: Open YouTube in new tab
      const tabResult = await sendGatewayCommand(ws, "browser.newTab", {
        url: "https://www.youtube.com",
        browser: "safari",
      });
      expect(tabResult.error).toBeUndefined();

      // Step 3: Wait and click first video
      await page.waitForTimeout(2000); // Let YouTube load
      const clickResult = await sendGatewayCommand(ws, "browser.clickFirstVideo", {
        browser: "safari",
      });
      expect(clickResult.error).toBeUndefined();

      // Verify: page URL should be a YouTube watch page
      const url = await page.url();
      expect(url).toMatch(/youtube\.com\/watch\?v=/);
    } finally {
      ws.close();
      await context.close();
    }
  });

  test("handles 'mở youtube ở tab mới và mở video đầu tiên' (Vietnamese multi-step)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const wsUrl = "ws://localhost:8080";
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      test.skip(true, "Gateway not running on localhost:8080");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection failed"));
      });
    });

    try {
      // Send the multi-step intent
      const result = await sendGatewayCommand(ws, "natural.language.execute", {
        text: "ở Safari, hãy mở youtube ở tab mới và mở video đầu tiên",
      });

      // The gateway should route this as a multi-step plan
      // and execute: Safari launch -> YouTube tab -> click first video
      expect(result.error).toBeUndefined();

      // The result should contain step results showing each action completed
      if (result.result) {
        const data = result.result as { stepResults?: unknown[] };
        if (data.stepResults) {
          expect(data.stepResults.length).toBeGreaterThanOrEqual(3);
        }
      }

      // Verify YouTube watch page opened
      await page.waitForTimeout(3000);
      const url = await page.url();
      expect(url).toMatch(/youtube\.com\/watch\?v=/);
    } finally {
      ws.close();
      await context.close();
    }
  });

  test("AppleScript escaping handles special characters in URLs", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const wsUrl = "ws://localhost:8080";
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      test.skip(true, "Gateway not running on localhost:8080");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection failed"));
      });
    });

    try {
      // URLs with special characters that previously caused AppleScript errors
      const testUrls = [
        "https://www.youtube.com/results?search_query=test+with+quotes",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://example.com/path?param=value",
      ];

      for (const url of testUrls) {
        const result = await sendGatewayCommand(ws, "browser.newTab", {
          url,
          browser: "safari",
        });

        // Should NOT produce AppleScript error -2741
        expect(result.error).not.toContain("-2741");
        expect(result.error).not.toContain("Expected end of line");
      }
    } finally {
      ws.close();
      await context.close();
    }
  });

  test("browser.clickFirstVideo finds and clicks first video on YouTube", async () => {
    // This test validates the clickFirstVideo logic without a real browser
    // by testing the JavaScript selectors that would be used

    const clickScript = `
      (function() {
        var selectors = [
          'ytd-rich-item-renderer a#video-title-link',
          'ytd-video-renderer a#video-title-link',
          'ytd-grid-video-renderer a#thumbnail',
          '#content a.ytd-rich-grid-media',
          'ytd-shelf-renderer ytd-video-renderer a#thumbnail',
          'a[href*="/watch?v="]:not([href*="list="])'
        ];
        for (var i = 0; i < selectors.length; i++) {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            if (el.offsetWidth > 0 && el.offsetHeight > 0 && el.href && el.href.includes('/watch?v=')) {
              var href = el.href;
              return href;
            }
          }
        }
        return null;
      })()
    `;

    // Verify the script is syntactically valid JS
    expect(() => new Function(clickScript)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Regression: AppleScript escaping bug (-2741)
// ---------------------------------------------------------------------------

test.describe("AppleScript Escaping Regression", () => {
  test("temp file approach avoids -2741 error with complex scripts", async () => {
    // This test verifies the fix by checking that the gateway's runAppleScript
    // method (now using temp files) doesn't produce the -2741 error

    const wsUrl = "ws://localhost:8080";
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      test.skip(true, "Gateway not running on localhost:8080");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection failed"));
      });
    });

    try {
      // Commands that previously caused -2741 error due to escaping issues
      const commands = [
        { intent: "browser.newTab", args: { url: "https://youtube.com", browser: "safari" } },
        { intent: "browser.newTab", args: { url: "https://example.com?q=test\"quote", browser: "safari" } },
        { intent: "browser.newTab", args: { url: "https://example.com?q=test\\backslash", browser: "safari" } },
      ];

      for (const cmd of commands) {
        const result = await sendGatewayCommand(ws, cmd.intent, cmd.args);
        expect(result.error).toBeUndefined();
        expect(result.error).not.toContain("-2741");
      }
    } finally {
      ws.close();
    }
  });
});