/**
 * Browser Layer — UC4: Browser Automation for OmniState Gateway.
 *
 * Implements Safari and Chrome automation on macOS via AppleScript and
 * JXA (JavaScript for Automation), executed through `osascript`.
 *
 * Capabilities:
 *   UC4.1 — Tab Management (open, new, close, list, switch, reload, active)
 *   UC4.2 — Navigation (navigate, back, forward, title, url, waitForLoad)
 *   UC4.3 — JavaScript Execution (eval, pageText, pageHtml, querySelector)
 *   UC4.4 — Form Interaction (fill, click, submit, select)
 *   UC4.5 — Cookies & Storage (get/clear cookies, get/set localStorage)
 *   UC4.6 — Screenshots & PDF (screenshot via surface, save PDF)
 *
 * All methods accept an optional `browser` parameter ('safari' | 'chrome').
 * When omitted, auto-detection runs Safari first, then Chrome.
 *
 * AppleScript execution strategy:
 *   - DOM queries / JS evaluation → `osascript -l JavaScript` (JXA)
 *   - Tab management / navigation  → standard AppleScript via `osascript`
 */

import { exec, spawn } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { SurfaceLayer } from "./surface.js";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Public interfaces
// ------------------------------------------------------------------

/** Represents a browser tab. */
export interface TabInfo {
  /** 1-based index within its window. */
  index: number;
  url: string;
  title: string;
  active: boolean;
  /** 1-based index of the containing window. */
  windowIndex: number;
}

/** Represents a DOM element's observable properties. */
export interface ElementInfo {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  value?: string;
  visible: boolean;
}

/** A single field to fill in a form. */
export interface FormField {
  /** CSS selector that uniquely identifies the element. */
  selector: string;
  value: string;
  type?: "text" | "select" | "checkbox" | "radio";
}

/** An HTTP cookie. */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

/** Resolved browser name used in scripts. */
type BrowserName = "safari" | "chrome";

/**
 * Escape a string for safe embedding inside an AppleScript string literal
 * (double-quoted).  Backslash must come first.
 */
function escapeForAppleScript(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Escape a string for safe embedding inside a JS string literal that will
 * itself be passed to AppleScript's `do JavaScript`.  Two levels of escaping.
 */
function escapeForJsInAppleScript(s: string): string {
  // First escape for JS string (backtick template — use single quotes inside)
  const jsEscaped = s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  // Then escape the result for AppleScript string embedding
  return escapeForAppleScript(jsEscaped);
}

/**
 * Execute an AppleScript snippet and return stdout.
 * Throws on non-zero exit with stderr details.
 */
async function runAppleScript(
  script: string,
  timeoutMs: number = 15_000
): Promise<string> {
  const { stdout } = await execAsync(
    `osascript -e ${JSON.stringify(script)}`,
    { timeout: timeoutMs }
  );
  return stdout.trim();
}

/**
 * Execute a JXA (JavaScript for Automation) snippet via `osascript -l
 * JavaScript` and return stdout.
 */
async function runJxa(
  script: string,
  timeoutMs: number = 15_000
): Promise<string> {
  const { stdout } = await execAsync(
    `osascript -l JavaScript -e ${JSON.stringify(script)}`,
    { timeout: timeoutMs }
  );
  return stdout.trim();
}

// ------------------------------------------------------------------
// BrowserLayer class
// ------------------------------------------------------------------

export class BrowserLayer {
  constructor(private readonly surface?: SurfaceLayer) {}

  // ================================================================
  // Browser detection
  // ================================================================

  /**
   * Determine which browser to target.  When `preferred` is supplied it is
   * used directly.  Otherwise, checks running processes: Safari first, then
   * Chrome.  Falls back to 'safari' if neither is found.
   */
  async detectBrowser(preferred?: string): Promise<BrowserName> {
    if (preferred) {
      const norm = preferred.toLowerCase();
      if (norm === "chrome" || norm === "google chrome") return "chrome";
      return "safari";
    }
    try {
      const { stdout } = await execAsync(
        "pgrep -x Safari ; pgrep -x 'Google Chrome'",
        { timeout: 3_000 }
      );
      if (/\d/.test(stdout)) {
        // Both might be running — prefer Safari (first match)
        const lines = stdout.trim().split("\n");
        if (lines.length > 0) {
          // pgrep returns pid lines — we care about which name matched first
          const safarPid = await execAsync("pgrep -x Safari 2>/dev/null").catch(
            () => ({ stdout: "" })
          );
          if (safarPid.stdout.trim()) return "safari";
        }
      }
    } catch {
      // ignore
    }
    return "safari";
  }

  /** Returns the application name string used in AppleScript for the browser. */
  private appName(browser: BrowserName): string {
    return browser === "safari" ? "Safari" : "Google Chrome";
  }

  // ================================================================
  // UC4.1: Tab Management
  // ================================================================

  /**
   * Open a URL in the specified (or auto-detected) browser.
   * Reuses the frontmost window if one is open; otherwise opens a new window.
   */
  async openUrl(url: string, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    const safeUrl = escapeForAppleScript(url);

    if (b === "safari") {
      await runAppleScript(
        `tell application "Safari" to open location "${safeUrl}"`
      );
    } else {
      await runAppleScript(
        `tell application "Google Chrome" to open location "${safeUrl}"`
      );
    }
  }

  /**
   * Open a new tab (and optionally navigate to a URL).
   * Returns metadata about the newly created tab.
   */
  async newTab(url?: string, browser?: string): Promise<TabInfo> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      const script = url
        ? `tell application "Safari"
             activate
             tell window 1 to set newTab to make new tab with properties {URL:"${escapeForAppleScript(url)}"}
             set current tab of window 1 to newTab
             return (index of newTab as string) & "|" & (URL of newTab) & "|" & (name of newTab)
           end tell`
        : `tell application "Safari"
             activate
             tell window 1 to set newTab to make new tab
             set current tab of window 1 to newTab
             return (index of newTab as string) & "|" & "" & "|" & ""
           end tell`;

      const out = await runAppleScript(script);
      const [idx, tabUrl, title] = out.split("|");
      return {
        index: parseInt(idx ?? "1", 10),
        url: tabUrl ?? url ?? "",
        title: title ?? "",
        active: true,
        windowIndex: 1,
      };
    } else {
      const script = url
        ? `tell application "Google Chrome"
             activate
             tell window 1 to make new tab with properties {URL:"${escapeForAppleScript(url)}"}
             return (index of active tab of window 1 as string) & "|" & (URL of active tab of window 1) & "|" & (title of active tab of window 1)
           end tell`
        : `tell application "Google Chrome"
             activate
             tell window 1 to make new tab
             return (index of active tab of window 1 as string) & "|" & "" & "|" & ""
           end tell`;

      const out = await runAppleScript(script);
      const [idx, tabUrl, title] = out.split("|");
      return {
        index: parseInt(idx ?? "1", 10),
        url: tabUrl ?? url ?? "",
        title: title ?? "",
        active: true,
        windowIndex: 1,
      };
    }
  }

  /**
   * Close a tab by 1-based index in window 1, or the current tab when
   * `tabIndex` is omitted.
   */
  async closeTab(tabIndex?: number, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      const script =
        tabIndex != null
          ? `tell application "Safari" to close tab ${tabIndex} of window 1`
          : `tell application "Safari" to close current tab of window 1`;
      await runAppleScript(script);
    } else {
      const script =
        tabIndex != null
          ? `tell application "Google Chrome" to close tab ${tabIndex} of window 1`
          : `tell application "Google Chrome" to close active tab of window 1`;
      await runAppleScript(script);
    }
  }

  /**
   * Return metadata for every open tab across all windows.
   */
  async listTabs(browser?: string): Promise<TabInfo[]> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      const script = `
        tell application "Safari"
          set output to ""
          set winIdx to 0
          repeat with w in windows
            set winIdx to winIdx + 1
            set tabIdx to 0
            repeat with t in tabs of w
              set tabIdx to tabIdx + 1
              set isCurrent to (t is current tab of w)
              set output to output & winIdx & "|" & tabIdx & "|" & (URL of t) & "|" & (name of t) & "|" & isCurrent & "\\n"
            end repeat
          end repeat
          return output
        end tell`;

      const out = await runAppleScript(script);
      return this._parseTabLines(out);
    } else {
      const script = `
        tell application "Google Chrome"
          set output to ""
          set winIdx to 0
          repeat with w in windows
            set winIdx to winIdx + 1
            set tabIdx to 0
            repeat with t in tabs of w
              set tabIdx to tabIdx + 1
              set isCurrent to (t is active tab of w)
              set output to output & winIdx & "|" & tabIdx & "|" & (URL of t) & "|" & (title of t) & "|" & isCurrent & "\\n"
            end repeat
          end repeat
          return output
        end tell`;

      const out = await runAppleScript(script);
      return this._parseTabLines(out);
    }
  }

  private _parseTabLines(raw: string): TabInfo[] {
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [winIdx, tabIdx, url, title, active] = line.split("|");
        return {
          windowIndex: parseInt(winIdx ?? "1", 10),
          index: parseInt(tabIdx ?? "1", 10),
          url: url ?? "",
          title: title ?? "",
          active: active?.trim() === "true",
        };
      });
  }

  /**
   * Make a specific tab (by 1-based index in window 1) active.
   */
  async switchTab(tabIndex: number, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      await runAppleScript(
        `tell application "Safari" to set current tab of window 1 to tab ${tabIndex} of window 1`
      );
    } else {
      await runAppleScript(
        `tell application "Google Chrome" to set active tab index of window 1 to ${tabIndex}`
      );
    }
  }

  /**
   * Reload the active tab.
   */
  async reloadTab(browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      await runAppleScript(
        `tell application "Safari" to do JavaScript "location.reload()" in current tab of window 1`
      );
    } else {
      await runAppleScript(
        `tell application "Google Chrome" to reload active tab of window 1`
      );
    }
  }

  /**
   * Return metadata (URL + title) for the currently active tab.
   */
  async getActiveTab(browser?: string): Promise<TabInfo> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      const out = await runAppleScript(
        `tell application "Safari"
           set t to current tab of window 1
           return (index of t as string) & "|" & (URL of t) & "|" & (name of t)
         end tell`
      );
      const [idx, url, title] = out.split("|");
      return {
        index: parseInt(idx ?? "1", 10),
        url: url ?? "",
        title: title ?? "",
        active: true,
        windowIndex: 1,
      };
    } else {
      const out = await runAppleScript(
        `tell application "Google Chrome"
           set t to active tab of window 1
           return (index of t as string) & "|" & (URL of t) & "|" & (title of t)
         end tell`
      );
      const [idx, url, title] = out.split("|");
      return {
        index: parseInt(idx ?? "1", 10),
        url: url ?? "",
        title: title ?? "",
        active: true,
        windowIndex: 1,
      };
    }
  }

  // ================================================================
  // UC4.2: Navigation
  // ================================================================

  /**
   * Set the URL of the active tab (triggers navigation).
   */
  async navigate(url: string, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    const safeUrl = escapeForAppleScript(url);

    if (b === "safari") {
      await runAppleScript(
        `tell application "Safari" to set URL of current tab of window 1 to "${safeUrl}"`
      );
    } else {
      await runAppleScript(
        `tell application "Google Chrome" to set URL of active tab of window 1 to "${safeUrl}"`
      );
    }
  }

  /**
   * Navigate back in the active tab's history.
   */
  async goBack(browser?: string): Promise<void> {
    await this.executeJavaScript("history.back()", browser);
  }

  /**
   * Navigate forward in the active tab's history.
   */
  async goForward(browser?: string): Promise<void> {
    await this.executeJavaScript("history.forward()", browser);
  }

  /**
   * Return the page title of the active tab.
   */
  async getPageTitle(browser?: string): Promise<string> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      return runAppleScript(
        `tell application "Safari" to return name of current tab of window 1`
      );
    } else {
      return runAppleScript(
        `tell application "Google Chrome" to return title of active tab of window 1`
      );
    }
  }

  /**
   * Return the URL of the active tab.
   */
  async getPageUrl(browser?: string): Promise<string> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      return runAppleScript(
        `tell application "Safari" to return URL of current tab of window 1`
      );
    } else {
      return runAppleScript(
        `tell application "Google Chrome" to return URL of active tab of window 1`
      );
    }
  }

  /**
   * Poll `document.readyState` until it equals `"complete"` or the timeout
   * elapses.  Resolves silently on timeout rather than throwing.
   */
  async waitForPageLoad(
    timeoutMs: number = 10_000,
    browser?: string
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 300;

    while (Date.now() < deadline) {
      try {
        const state = await this.executeJavaScript(
          "document.readyState",
          browser
        );
        if (state.trim() === "complete") return;
      } catch {
        // page may be mid-navigation — keep polling
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, pollInterval)
      );
    }
    // Timed out — return without throwing so callers can decide
  }

  // ================================================================
  // UC4.3: JavaScript Execution
  // ================================================================

  /**
   * Execute arbitrary JavaScript in the active tab and return the result as a
   * string.  Safari uses `do JavaScript`; Chrome uses the same mechanism via
   * JXA execute.
   */
  async executeJavaScript(
    code: string,
    browser?: string
  ): Promise<string> {
    const b = await this.detectBrowser(browser);
    const safeCode = escapeForAppleScript(code);

    if (b === "safari") {
      return runAppleScript(
        `tell application "Safari" to return do JavaScript "${safeCode}" in current tab of window 1`
      );
    } else {
      // Chrome: use JXA for reliable string return
      const jxaScript = `
        var chrome = Application("Google Chrome");
        var tab = chrome.windows[0].activeTab();
        var result = tab.execute({javascript: "${safeCode}"});
        result == null ? "" : String(result);
      `;
      return runJxa(jxaScript);
    }
  }

  /**
   * Return the visible text content of the page (`document.body.innerText`).
   */
  async getPageText(browser?: string): Promise<string> {
    return this.executeJavaScript("document.body.innerText", browser);
  }

  /**
   * Return the full outer HTML of the page.
   */
  async getPageHtml(browser?: string): Promise<string> {
    return this.executeJavaScript(
      "document.documentElement.outerHTML",
      browser
    );
  }

  /**
   * Return observable properties of the first element matching `selector`, or
   * `null` if not found.
   */
  async querySelector(
    selector: string,
    browser?: string
  ): Promise<ElementInfo | null> {
    const safeSelector = escapeForJsInAppleScript(selector);
    const code = `
      (function() {
        var el = document.querySelector('${safeSelector}');
        if (!el) return 'null';
        var r = el.getBoundingClientRect();
        return JSON.stringify({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          classes: Array.from(el.classList),
          text: el.innerText ? el.innerText.slice(0, 500) : undefined,
          value: el.value !== undefined ? String(el.value) : undefined,
          visible: r.width > 0 && r.height > 0
        });
      })()
    `.trim();

    const raw = await this.executeJavaScript(code, browser);
    if (!raw || raw === "null") return null;
    try {
      return JSON.parse(raw) as ElementInfo;
    } catch {
      return null;
    }
  }

  /**
   * Return observable properties for all elements matching `selector`.
   */
  async querySelectorAll(
    selector: string,
    browser?: string
  ): Promise<ElementInfo[]> {
    const safeSelector = escapeForJsInAppleScript(selector);
    const code = `
      (function() {
        var els = Array.from(document.querySelectorAll('${safeSelector}')).slice(0, 100);
        return JSON.stringify(els.map(function(el) {
          var r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            classes: Array.from(el.classList),
            text: el.innerText ? el.innerText.slice(0, 200) : undefined,
            value: el.value !== undefined ? String(el.value) : undefined,
            visible: r.width > 0 && r.height > 0
          };
        }));
      })()
    `.trim();

    const raw = await this.executeJavaScript(code, browser);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ElementInfo[];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC4.4: Form Interaction
  // ================================================================

  /**
   * Fill multiple form fields sequentially.  Dispatches both `input` and
   * `change` events so React / Vue controlled components pick up the value.
   */
  async fillForm(fields: FormField[], browser?: string): Promise<void> {
    for (const field of fields) {
      const safeSelector = escapeForJsInAppleScript(field.selector);
      const safeValue = escapeForJsInAppleScript(field.value);

      let code: string;

      switch (field.type) {
        case "checkbox":
        case "radio":
          code = `
            (function() {
              var el = document.querySelector('${safeSelector}');
              if (!el) return 'not found';
              el.checked = ${field.value === "true" || field.value === "1"};
              el.dispatchEvent(new Event('change', {bubbles:true}));
              return 'ok';
            })()
          `.trim();
          break;

        case "select":
          code = `
            (function() {
              var el = document.querySelector('${safeSelector}');
              if (!el) return 'not found';
              el.value = '${safeValue}';
              el.dispatchEvent(new Event('change', {bubbles:true}));
              return 'ok';
            })()
          `.trim();
          break;

        default:
          // text and everything else
          code = `
            (function() {
              var el = document.querySelector('${safeSelector}');
              if (!el) return 'not found';
              var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (nativeInputValueSetter && nativeInputValueSetter.set) {
                nativeInputValueSetter.set.call(el, '${safeValue}');
              } else {
                el.value = '${safeValue}';
              }
              el.dispatchEvent(new Event('input',  {bubbles:true}));
              el.dispatchEvent(new Event('change', {bubbles:true}));
              return 'ok';
            })()
          `.trim();
      }

      await this.executeJavaScript(code, browser);
    }
  }

  /**
   * Programmatically click an element matching `selector`.
   */
  async clickElement(selector: string, browser?: string): Promise<void> {
    const safeSelector = escapeForJsInAppleScript(selector);
    const code = `
      (function() {
        var el = document.querySelector('${safeSelector}');
        if (!el) return 'not found';
        el.click();
        return 'ok';
      })()
    `.trim();
    await this.executeJavaScript(code, browser);
  }

  /**
   * Submit a form.  If `formSelector` is supplied, submits that form;
   * otherwise submits the first `<form>` in the document.
   */
  async submitForm(
    formSelector: string = "form",
    browser?: string
  ): Promise<void> {
    const safeSelector = escapeForJsInAppleScript(formSelector);
    const code = `
      (function() {
        var form = document.querySelector('${safeSelector}');
        if (!form) return 'not found';
        form.submit();
        return 'ok';
      })()
    `.trim();
    await this.executeJavaScript(code, browser);
  }

  /**
   * Select an option in a `<select>` element by value.
   */
  async selectOption(
    selectSelector: string,
    value: string,
    browser?: string
  ): Promise<void> {
    await this.fillForm(
      [{ selector: selectSelector, value, type: "select" }],
      browser
    );
  }

  // ================================================================
  // UC4.5: Cookies & Storage
  // ================================================================

  /**
   * Return cookies visible to the current page.  Optionally filter by domain
   * substring.  Note: `document.cookie` only exposes non-HttpOnly cookies;
   * HttpOnly cookies are intentionally inaccessible from JavaScript.
   */
  async getCookies(
    domain?: string,
    browser?: string
  ): Promise<Cookie[]> {
    const raw = await this.executeJavaScript("document.cookie", browser);
    if (!raw) return [];

    const currentUrl = await this.getPageUrl(browser);
    let currentDomain = "";
    try {
      currentDomain = new URL(currentUrl).hostname;
    } catch {
      currentDomain = "";
    }

    const cookies: Cookie[] = raw
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const eqIdx = pair.indexOf("=");
        const name = eqIdx >= 0 ? pair.slice(0, eqIdx).trim() : pair;
        const value = eqIdx >= 0 ? pair.slice(eqIdx + 1).trim() : "";
        return {
          name,
          value,
          domain: currentDomain,
          path: "/",
        };
      });

    if (domain) {
      return cookies.filter((c) => c.domain.includes(domain));
    }
    return cookies;
  }

  /**
   * Clear all cookies accessible from the current page by expiring them.
   */
  async clearCookies(browser?: string): Promise<void> {
    const code = `
      (function() {
        document.cookie.split(';').forEach(function(c) {
          var name = c.trim().split('=')[0];
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + location.hostname;
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + location.hostname;
        });
        return 'ok';
      })()
    `.trim();
    await this.executeJavaScript(code, browser);
  }

  /**
   * Return all (or a single keyed) localStorage entries for the current
   * origin.
   */
  async getLocalStorage(
    key?: string,
    browser?: string
  ): Promise<Record<string, string>> {
    if (key) {
      const safeKey = escapeForJsInAppleScript(key);
      const code = `
        (function() {
          var v = localStorage.getItem('${safeKey}');
          return JSON.stringify(v === null ? {} : {'${safeKey}': v});
        })()
      `.trim();
      const raw = await this.executeJavaScript(code, browser);
      try {
        return JSON.parse(raw) as Record<string, string>;
      } catch {
        return {};
      }
    }

    const code = `
      (function() {
        var result = {};
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k !== null) result[k] = localStorage.getItem(k) || '';
        }
        return JSON.stringify(result);
      })()
    `.trim();
    const raw = await this.executeJavaScript(code, browser);
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /**
   * Set a single localStorage entry on the current origin.
   */
  async setLocalStorage(
    key: string,
    value: string,
    browser?: string
  ): Promise<void> {
    const safeKey = escapeForJsInAppleScript(key);
    const safeValue = escapeForJsInAppleScript(value);
    const code = `localStorage.setItem('${safeKey}', '${safeValue}'); 'ok'`;
    await this.executeJavaScript(code, browser);
  }

  // ================================================================
  // UC4.6: Screenshots & PDF
  // ================================================================

  /**
   * Capture the browser window as a pixel buffer using the SurfaceLayer.
   * Finds the frontmost browser window and crops the screen capture to it.
   *
   * Requires a `SurfaceLayer` instance to have been passed to the constructor.
   */
  async capturePageScreenshot(browser?: string): Promise<Buffer> {
    if (!this.surface) {
      throw new Error(
        "BrowserLayer requires a SurfaceLayer instance for screenshot capture. " +
          "Pass one via the constructor: new BrowserLayer(surfaceLayer)."
      );
    }

    const b = await this.detectBrowser(browser);
    const appName = this.appName(b);

    // Find the window ID of the frontmost browser window via JXA
    const jxaScript = `
      var app = Application("${appName}");
      app.activate();
      // Small settle time — JXA doesn't await window activation
      var se = Application("System Events");
      var wins = se.applicationProcesses.byName("${appName}").windows;
      wins.length > 0 ? wins[0].id() : -1;
    `;

    let windowId: number | null = null;
    try {
      const idStr = await runJxa(jxaScript);
      windowId = parseInt(idStr.trim(), 10);
      if (isNaN(windowId) || windowId < 0) windowId = null;
    } catch {
      windowId = null;
    }

    if (windowId !== null) {
      try {
        const capture = await this.surface.captureWindow(windowId);
        return capture.data;
      } catch {
        // fall through to full-screen capture
      }
    }

    // Fallback: full-screen capture
    const capture = await this.surface.captureScreen();
    return capture.data;
  }

  /**
   * Save the current page as PDF.
   *
   * - Chrome: triggers `window.print()` via the browser's print-to-PDF
   *   mechanism.  For headless/CLI PDF export use
   *   `google-chrome --headless --print-to-pdf=<path> <url>`.
   * - Safari: uses AppleScript to invoke File › Export as PDF.
   *
   * `outputPath` should be an absolute path ending in `.pdf`.
   */
  async savePageAsPdf(outputPath: string, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);

    if (b === "safari") {
      // Safari: use System Events to trigger File → Export as PDF
      const safePath = escapeForAppleScript(outputPath);
      const script = `
        tell application "Safari" to activate
        tell application "System Events"
          tell process "Safari"
            keystroke "e" using {command down, shift down}
            delay 1
            -- The save panel should now be open; type the path and confirm
            keystroke "${safePath}"
            key code 36
          end tell
        end tell`;
      await runAppleScript(script, 15_000);
    } else {
      // Chrome: use --headless --print-to-pdf for reliable output
      const currentUrl = await this.getPageUrl(browser);
      const safePath = outputPath.replace(/"/g, '\\"');
      const safeUrl = currentUrl.replace(/"/g, '\\"');

      await execAsync(
        `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome ` +
          `--headless --disable-gpu ` +
          `--print-to-pdf="${safePath}" ` +
          `"${safeUrl}" 2>/dev/null`,
        { timeout: 30_000 }
      );
    }
  }

  // ----------------------------------------------------------------
  // UC4.7 — Headless Browser Execution
  // ----------------------------------------------------------------

  private _headlessProcess: ReturnType<typeof spawn> | null = null;
  private _headlessPort = 0;

  /**
   * Launch Chrome/Chromium in headless mode with remote debugging enabled.
   * Returns the process PID and the debug port.
   */
  async startHeadlessBrowser(options?: {
    browser?: "chrome" | "chromium";
    port?: number;
    width?: number;
    height?: number;
  }): Promise<{ pid: number; debugPort: number }> {
    if (this._headlessProcess) {
      await this.stopHeadlessBrowser();
    }

    const port = options?.port ?? 9222;
    const width = options?.width ?? 1280;
    const height = options?.height ?? 800;
    const chromePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];

    let chromeBin: string | null = null;
    for (const p of chromePaths) {
      try {
        await execAsync(`test -x "${p}"`);
        chromeBin = p;
        break;
      } catch {
        // not found, try next
      }
    }
    if (!chromeBin) throw new Error("Chrome/Chromium not found on this system");

    const args = [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
    ];

    this._headlessProcess = spawn(chromeBin, args, {
      detached: false,
      stdio: "ignore",
    });
    this._headlessPort = port;

    // Give it a moment to start up
    await new Promise<void>((resolve) => setTimeout(resolve, 800));

    const pid = this._headlessProcess.pid;
    if (!pid) throw new Error("Failed to start headless browser (no PID)");
    return { pid, debugPort: port };
  }

  /** Kill the currently running headless browser process. */
  async stopHeadlessBrowser(): Promise<void> {
    if (this._headlessProcess) {
      this._headlessProcess.kill("SIGTERM");
      this._headlessProcess = null;
      this._headlessPort = 0;
    }
  }

  /** Returns true if the headless browser process is currently alive. */
  async isHeadlessRunning(): Promise<boolean> {
    if (!this._headlessProcess || !this._headlessProcess.pid) return false;
    try {
      // Signal 0 tests process existence without killing it
      process.kill(this._headlessProcess.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Navigate the headless browser to `url`, execute `script` in the page
   * context via CDP, and return the result.
   */
  async executeInHeadless(url: string, script: string): Promise<unknown> {
    if (!this._headlessPort) {
      throw new Error("Headless browser is not running. Call startHeadlessBrowser() first.");
    }
    const port = this._headlessPort;

    // Get the first available target via /json
    const { stdout: targetsJson } = await execAsync(
      `curl -s http://localhost:${port}/json`,
      { timeout: 5_000 }
    );
    let targets: Array<{ webSocketDebuggerUrl?: string; id?: string }> = [];
    try {
      targets = JSON.parse(targetsJson);
    } catch {
      throw new Error("Could not parse CDP targets from headless browser");
    }

    // Use the Python-based CDP approach since node ws is not guaranteed
    const cdpScript = `python3 -c "
import urllib.request, json, asyncio, websocket, sys

url = '${url.replace(/'/g, "\\'")}'
script = '''${script.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'''
port = ${port}

# Get targets
with urllib.request.urlopen(f'http://localhost:{port}/json') as r:
    targets = json.loads(r.read())

if not targets:
    print(json.dumps(None))
    sys.exit(0)

ws_url = targets[0].get('webSocketDebuggerUrl', '')
if not ws_url:
    print(json.dumps(None))
    sys.exit(0)

import websocket as ws_lib
ws = ws_lib.create_connection(ws_url, timeout=10)

# Navigate
ws.send(json.dumps({'id':1,'method':'Page.navigate','params':{'url':url}}))
ws.recv()
import time; time.sleep(1)

# Execute script
ws.send(json.dumps({'id':2,'method':'Runtime.evaluate','params':{'expression':script,'returnByValue':True}}))
resp = json.loads(ws.recv())
ws.close()
result = resp.get('result',{}).get('result',{}).get('value', None)
print(json.dumps(result))
" 2>/dev/null`;

    try {
      const { stdout } = await execAsync(cdpScript, { timeout: 15_000 });
      return JSON.parse(stdout.trim());
    } catch {
      // Fallback: use curl + CDP REST if websocket-client not available
      throw new Error(
        "executeInHeadless requires Python websocket-client. " +
        "Install with: pip3 install websocket-client"
      );
    }
  }

  // ----------------------------------------------------------------
  // UC4.8 — Advanced Tab Management
  // ----------------------------------------------------------------

  /** Pin the current tab (or the tab at tabIndex) in Chrome/Safari. */
  async pinTab(tabIndex?: number, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      const idx = tabIndex ?? 1;
      const script = `
        tell application "Google Chrome"
          set t to tab ${idx} of window 1
          -- Chrome doesn't expose a pin property; use keyboard shortcut
          activate
          tell application "System Events"
            keystroke "p" using {command down, shift down}
          end tell
        end tell`;
      await runAppleScript(script);
    } else {
      // Safari doesn't support pinning via AppleScript; use keyboard shortcut
      await runAppleScript(`
        tell application "Safari" to activate
        tell application "System Events"
          key code 35 using {command down, shift down}
        end tell`);
    }
  }

  /** Mute audio in the current or specified tab (Chrome only). */
  async muteTab(tabIndex?: number, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    if (b !== "chrome") throw new Error("muteTab is only supported in Chrome");
    const idx = tabIndex ?? 1;
    const script = `
      tell application "Google Chrome"
        set tab ${idx} of window 1 to muted
      end tell`;
    await runAppleScript(script);
  }

  /** Unmute audio in the current or specified tab (Chrome only). */
  async unmuteTab(tabIndex?: number, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    if (b !== "chrome") throw new Error("unmuteTab is only supported in Chrome");
    const idx = tabIndex ?? 1;
    const script = `
      tell application "Google Chrome"
        set muted of tab ${idx} of window 1 to false
      end tell`;
    await runAppleScript(script);
  }

  /**
   * Return approximate memory usage per tab (Chrome only).
   * Uses the chrome://memory-redirect/ page which exposes process info via JS.
   */
  async getTabMemory(): Promise<
    Array<{ tabIndex: number; title: string; memoryMB: number }>
  > {
    const b = await this.detectBrowser();
    if (b !== "chrome") {
      throw new Error("getTabMemory is only supported in Chrome");
    }

    // Use ps to get Chrome renderer processes and estimate memory
    const { stdout } = await execAsync(
      `ps aux | grep -i "Google Chrome" | grep -v grep | awk '{print $6, $11}' | head -50`,
      { timeout: 5_000 }
    );

    const tabs = await this.listTabs("chrome");
    // Map tab indices to rough memory estimates (heuristic: even split)
    const lines = stdout.trim().split("\n").filter(Boolean);
    const totalKB = lines.reduce((sum, line) => {
      const kb = parseInt(line.split(" ")[0] ?? "0", 10);
      return sum + (isNaN(kb) ? 0 : kb);
    }, 0);
    const perTabMB = tabs.length > 0 ? (totalKB / 1024 / tabs.length) : 0;

    return tabs.map((t) => ({
      tabIndex: t.index,
      title: t.title,
      memoryMB: Math.round(perTabMB),
    }));
  }

  // ----------------------------------------------------------------
  // UC4.9 — Download Management
  // ----------------------------------------------------------------

  private get _chromeHistoryPath(): string {
    return path.join(
      os.homedir(),
      "Library/Application Support/Google/Chrome/Default/History"
    );
  }

  private get _safariDownloadsPath(): string {
    return path.join(os.homedir(), "Library/Safari/Downloads.plist");
  }

  /**
   * Return recent downloads.  Uses Chrome's SQLite history DB or Safari's
   * Downloads.plist depending on the active browser.
   */
  async getDownloads(
    limit = 20,
    browser?: string
  ): Promise<
    Array<{
      filename: string;
      url: string;
      size: number;
      status: "complete" | "in_progress" | "cancelled";
      path: string;
    }>
  > {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      // Copy to a temp file first (Chrome locks the DB while running)
      const tmp = path.join(os.tmpdir(), `omnistate_history_${Date.now()}`);
      await execAsync(`cp "${this._chromeHistoryPath}" "${tmp}"`);
      try {
        const { stdout } = await execAsync(
          `sqlite3 "${tmp}" "SELECT target_path, tab_url, received_bytes, total_bytes, state FROM downloads ORDER BY start_time DESC LIMIT ${limit};"`,
          { timeout: 10_000 }
        );
        const rows = stdout.trim().split("\n").filter(Boolean);
        return rows.map((row) => {
          const parts = row.split("|");
          const dlPath = parts[0] ?? "";
          const url = parts[1] ?? "";
          const received = parseInt(parts[2] ?? "0", 10);
          const total = parseInt(parts[3] ?? "0", 10);
          const state = parseInt(parts[4] ?? "0", 10);
          // Chrome state: 1=in_progress, 2=complete, 4=cancelled
          const status: "complete" | "in_progress" | "cancelled" =
            state === 2 ? "complete" : state === 4 ? "cancelled" : "in_progress";
          return {
            filename: path.basename(dlPath),
            url,
            size: total || received,
            status,
            path: dlPath,
          };
        });
      } finally {
        await execAsync(`rm -f "${tmp}"`).catch(() => {});
      }
    } else {
      // Safari: parse the plist
      const { stdout } = await execAsync(
        `plutil -convert json -o - "${this._safariDownloadsPath}" 2>/dev/null`,
        { timeout: 5_000 }
      );
      let plist: { DownloadHistory?: Array<Record<string, unknown>> };
      try {
        plist = JSON.parse(stdout);
      } catch {
        return [];
      }
      const history = plist.DownloadHistory ?? [];
      return history.slice(0, limit).map((entry) => ({
        filename: String(entry.DownloadEntryFilename ?? ""),
        url: String(entry.DownloadEntryURL ?? ""),
        size: Number(entry.DownloadEntryProgressTotalToLoad ?? 0),
        status: "complete" as const,
        path: String(entry.DownloadEntryPath ?? ""),
      }));
    }
  }

  /** Clear the download history for the active browser. */
  async clearDownloads(browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      const tmp = path.join(os.tmpdir(), `omnistate_history_${Date.now()}`);
      await execAsync(`cp "${this._chromeHistoryPath}" "${tmp}"`);
      try {
        await execAsync(
          `sqlite3 "${tmp}" "DELETE FROM downloads;"`,
          { timeout: 10_000 }
        );
        await execAsync(`cp "${tmp}" "${this._chromeHistoryPath}"`);
      } finally {
        await execAsync(`rm -f "${tmp}"`).catch(() => {});
      }
    } else {
      // Safari: overwrite with empty history
      const { stdout } = await execAsync(
        `plutil -convert json -o - "${this._safariDownloadsPath}" 2>/dev/null`
      );
      let plist: Record<string, unknown> = {};
      try { plist = JSON.parse(stdout); } catch { /* empty */ }
      plist.DownloadHistory = [];
      const tmpJson = path.join(os.tmpdir(), `safariDL_${Date.now()}.json`);
      await execAsync(`echo '${JSON.stringify(plist).replace(/'/g, "'\\''")}' > "${tmpJson}"`);
      await execAsync(`plutil -convert binary1 -o "${this._safariDownloadsPath}" "${tmpJson}"`);
      await execAsync(`rm -f "${tmpJson}"`).catch(() => {});
    }
  }

  /** Return the directory where downloads are saved. */
  async getDownloadDirectory(browser?: string): Promise<string> {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      const tmp = path.join(os.tmpdir(), `omnistate_history_${Date.now()}`);
      await execAsync(`cp "${this._chromeHistoryPath}" "${tmp}"`);
      try {
        const { stdout } = await execAsync(
          `sqlite3 "${tmp}" "SELECT target_path FROM downloads WHERE state=2 ORDER BY start_time DESC LIMIT 1;"`,
          { timeout: 5_000 }
        );
        const lastPath = stdout.trim();
        return lastPath ? path.dirname(lastPath) : path.join(os.homedir(), "Downloads");
      } finally {
        await execAsync(`rm -f "${tmp}"`).catch(() => {});
      }
    } else {
      // Safari downloads always go to the configured folder; read from prefs
      try {
        const { stdout } = await execAsync(
          `defaults read com.apple.Safari DownloadsPath 2>/dev/null`
        );
        return stdout.trim() || path.join(os.homedir(), "Downloads");
      } catch {
        return path.join(os.homedir(), "Downloads");
      }
    }
  }

  // ----------------------------------------------------------------
  // UC4.10 — Bookmark Management
  // ----------------------------------------------------------------

  private get _chromeBookmarksPath(): string {
    return path.join(
      os.homedir(),
      "Library/Application Support/Google/Chrome/Default/Bookmarks"
    );
  }

  private get _safariBookmarksPath(): string {
    return path.join(os.homedir(), "Library/Safari/Bookmarks.plist");
  }

  private _flattenChromeBookmarks(
    node: Record<string, unknown>,
    folderName = "Bookmarks Bar"
  ): Array<{ title: string; url: string; folder: string; dateAdded: string }> {
    const results: Array<{ title: string; url: string; folder: string; dateAdded: string }> = [];
    if (node.type === "url") {
      results.push({
        title: String(node.name ?? ""),
        url: String(node.url ?? ""),
        folder: folderName,
        dateAdded: String(node.date_added ?? ""),
      });
    } else if (node.type === "folder" || node.children) {
      const childFolder = node.type === "folder" ? String(node.name ?? folderName) : folderName;
      const children = (node.children as Array<Record<string, unknown>>) ?? [];
      for (const child of children) {
        results.push(...this._flattenChromeBookmarks(child, childFolder));
      }
    }
    return results;
  }

  /**
   * Return bookmarks from the active browser.
   * Optionally filter by folder name.
   */
  async getBookmarks(
    folder?: string,
    browser?: string
  ): Promise<Array<{ title: string; url: string; folder: string; dateAdded: string }>> {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      const { stdout } = await execAsync(`cat "${this._chromeBookmarksPath}"`, { timeout: 5_000 });
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(stdout);
      } catch {
        return [];
      }
      const roots = (data.roots as Record<string, unknown>) ?? {};
      let all: Array<{ title: string; url: string; folder: string; dateAdded: string }> = [];
      for (const rootKey of Object.keys(roots)) {
        all = all.concat(this._flattenChromeBookmarks(roots[rootKey] as Record<string, unknown>));
      }
      if (folder) {
        return all.filter((bm) => bm.folder.toLowerCase().includes(folder.toLowerCase()));
      }
      return all;
    } else {
      // Safari: convert plist to JSON
      const { stdout } = await execAsync(
        `plutil -convert json -o - "${this._safariBookmarksPath}" 2>/dev/null`,
        { timeout: 5_000 }
      );
      let plist: Record<string, unknown> = {};
      try { plist = JSON.parse(stdout); } catch { return []; }

      const results: Array<{ title: string; url: string; folder: string; dateAdded: string }> = [];
      const walk = (node: Record<string, unknown>, currentFolder: string) => {
        const uriDict = node.URIDictionary as Record<string, string> | undefined;
        if (uriDict?.title && uriDict?.URL) {
          results.push({
            title: uriDict.title,
            url: uriDict.URL,
            folder: currentFolder,
            dateAdded: "",
          });
        }
        const children = node.Children as Array<Record<string, unknown>> | undefined;
        if (children) {
          const childFolder = (node.Title as string) || currentFolder;
          for (const child of children) walk(child, childFolder);
        }
      };
      walk(plist, "Bookmarks");
      if (folder) {
        return results.filter((bm) => bm.folder.toLowerCase().includes(folder.toLowerCase()));
      }
      return results;
    }
  }

  /** Add a bookmark via AppleScript. */
  async addBookmark(url: string, title: string, folder?: string, browser?: string): Promise<void> {
    const b = await this.detectBrowser(browser);
    const safeUrl = escapeForAppleScript(url);
    const safeTitle = escapeForAppleScript(title);

    if (b === "chrome") {
      // Chrome doesn't expose bookmark creation via AppleScript; use keyboard shortcut
      await this.navigate(url, "chrome");
      await new Promise<void>((r) => setTimeout(r, 500));
      const script = `
        tell application "Google Chrome" to activate
        tell application "System Events"
          keystroke "d" using {command down}
          delay 0.5
          keystroke return
        end tell`;
      await runAppleScript(script);
    } else {
      const script = `
        tell application "Safari"
          activate
          make new bookmark with properties {URL:"${safeUrl}", name:"${safeTitle}"}
        end tell`;
      await runAppleScript(script);
    }
  }

  /** Search bookmarks by title or URL substring. */
  async searchBookmarks(
    query: string,
    browser?: string
  ): Promise<Array<{ title: string; url: string; folder: string }>> {
    const all = await this.getBookmarks(undefined, browser);
    const q = query.toLowerCase();
    return all
      .filter(
        (bm) =>
          bm.title.toLowerCase().includes(q) || bm.url.toLowerCase().includes(q)
      )
      .map(({ title, url, folder }) => ({ title, url, folder }));
  }

  /**
   * Return browser history entries.
   * Reads from SQLite (Chrome) or WebKit history DB (Safari).
   */
  async getHistory(
    limit = 50,
    since?: Date,
    browser?: string
  ): Promise<
    Array<{ title: string; url: string; visitTime: string; visitCount: number }>
  > {
    const b = await this.detectBrowser(browser);
    if (b === "chrome") {
      const tmp = path.join(os.tmpdir(), `omnistate_history_${Date.now()}`);
      await execAsync(`cp "${this._chromeHistoryPath}" "${tmp}"`);
      try {
        let sinceClause = "";
        if (since) {
          // Chrome uses microseconds since 1601-01-01 epoch
          const chromeMicros = (since.getTime() + 11644473600000) * 1000;
          sinceClause = `WHERE v.visit_time > ${chromeMicros}`;
        }
        const sql =
          `SELECT u.title, u.url, v.visit_time, u.visit_count ` +
          `FROM visits v JOIN urls u ON v.url=u.id ` +
          `${sinceClause} ORDER BY v.visit_time DESC LIMIT ${limit};`;
        const { stdout } = await execAsync(`sqlite3 "${tmp}" "${sql}"`, { timeout: 10_000 });
        const rows = stdout.trim().split("\n").filter(Boolean);
        return rows.map((row) => {
          const parts = row.split("|");
          const chromeMicros = parseInt(parts[2] ?? "0", 10);
          const ms = chromeMicros / 1000 - 11644473600000;
          return {
            title: parts[0] ?? "",
            url: parts[1] ?? "",
            visitTime: new Date(ms).toISOString(),
            visitCount: parseInt(parts[3] ?? "0", 10),
          };
        });
      } finally {
        await execAsync(`rm -f "${tmp}"`).catch(() => {});
      }
    } else {
      // Safari: History.db
      const safariHistoryPath = path.join(
        os.homedir(),
        "Library/Safari/History.db"
      );
      const tmp = path.join(os.tmpdir(), `omnistate_safarihistory_${Date.now()}`);
      await execAsync(`cp "${safariHistoryPath}" "${tmp}"`);
      try {
        let sinceClause = "";
        if (since) {
          // Safari uses CoreData timestamps (seconds since 2001-01-01)
          const coreDataSecs = since.getTime() / 1000 - 978307200;
          sinceClause = `WHERE hv.visit_time > ${coreDataSecs}`;
        }
        const sql =
          `SELECT hi.title, hi.url, hv.visit_time, hi.visit_count_score ` +
          `FROM history_visits hv JOIN history_items hi ON hv.history_item=hi.id ` +
          `${sinceClause} ORDER BY hv.visit_time DESC LIMIT ${limit};`;
        const { stdout } = await execAsync(`sqlite3 "${tmp}" "${sql}"`, { timeout: 10_000 });
        const rows = stdout.trim().split("\n").filter(Boolean);
        return rows.map((row) => {
          const parts = row.split("|");
          const coreDataSecs = parseFloat(parts[2] ?? "0");
          const ms = (coreDataSecs + 978307200) * 1000;
          return {
            title: parts[0] ?? "",
            url: parts[1] ?? "",
            visitTime: new Date(ms).toISOString(),
            visitCount: parseInt(parts[3] ?? "0", 10),
          };
        });
      } finally {
        await execAsync(`rm -f "${tmp}"`).catch(() => {});
      }
    }
  }

  // ----------------------------------------------------------------
  // UC4.11 — Network & Performance
  // ----------------------------------------------------------------

  /**
   * Return page timing metrics for the current (or navigated-to) tab.
   * Uses `window.performance.timing`.
   */
  async getPageLoadTime(
    url?: string,
    browser?: string
  ): Promise<{ domContentLoaded: number; load: number; firstPaint?: number } | null> {
    if (url) await this.navigate(url, browser);
    const result = await this.executeJavaScript(
      `(function(){
        var t = window.performance.timing;
        var nav = t.navigationStart;
        var fp = null;
        try {
          var entries = performance.getEntriesByType('paint');
          var fpEntry = entries.find(function(e){ return e.name === 'first-paint'; });
          if (fpEntry) fp = Math.round(fpEntry.startTime);
        } catch(e) {}
        return JSON.stringify({
          domContentLoaded: t.domContentLoadedEventEnd - nav,
          load: t.loadEventEnd - nav,
          firstPaint: fp
        });
      })()`,
      browser
    );
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  /**
   * Return resource timing entries for the current page.
   * Uses `performance.getEntriesByType('resource')`.
   */
  async getNetworkRequests(
    url?: string,
    browser?: string
  ): Promise<
    Array<{ url: string; method: string; status: number; size: number; time: number }>
  > {
    if (url) await this.navigate(url, browser);
    const result = await this.executeJavaScript(
      `JSON.stringify(performance.getEntriesByType('resource').map(function(e){
        return {
          url: e.name,
          method: 'GET',
          status: 200,
          size: e.transferSize || e.encodedBodySize || 0,
          time: Math.round(e.duration)
        };
      }))`,
      browser
    );
    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  /**
   * Block URL patterns via Chrome DevTools Protocol (headless only).
   * Requires an active headless browser session.
   */
  async blockUrls(patterns: string[]): Promise<void> {
    if (!this._headlessPort) {
      throw new Error("blockUrls requires an active headless browser session. Call startHeadlessBrowser() first.");
    }
    const port = this._headlessPort;

    const { stdout: targetsJson } = await execAsync(
      `curl -s http://localhost:${port}/json`,
      { timeout: 5_000 }
    );
    let targets: Array<{ webSocketDebuggerUrl?: string }> = [];
    try { targets = JSON.parse(targetsJson); } catch { return; }

    const wsUrl = targets[0]?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error("No CDP target available");

    const patternsJson = JSON.stringify(patterns).replace(/'/g, "\\'");
    const cdpScript = `python3 -c "
import websocket, json
ws = websocket.create_connection('${wsUrl}', timeout=10)
ws.send(json.dumps({'id':1,'method':'Network.setBlockedURLs','params':{'urls':${patternsJson}}}))
ws.recv()
ws.close()
" 2>/dev/null`;
    try {
      await execAsync(cdpScript, { timeout: 10_000 });
    } catch {
      throw new Error(
        "blockUrls requires Python websocket-client. Install with: pip3 install websocket-client"
      );
    }
  }
}
