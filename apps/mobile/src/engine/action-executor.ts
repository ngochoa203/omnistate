/**
 * Action executor — executes AutomationIntent objects against the native
 * bridges (accessibility + screen capture + app manager).
 */

import { AccessibilityModule } from "../native/AccessibilityModule";
import { ScreenCaptureModule } from "../native/ScreenCaptureModule";
import { AppManagerModule } from "../native/AppManagerModule";
import type { AutomationIntent, ActionResult, ScreenCondition } from "./types";
import type { ScreenNode } from "../native/AccessibilityModule";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 300;

export class ActionExecutor {
  private screenWidth = 1080;
  private screenHeight = 2400;

  setScreenSize(w: number, h: number): void {
    this.screenWidth = w;
    this.screenHeight = h;
  }

  async execute(intent: AutomationIntent): Promise<ActionResult> {
    const start = Date.now();
    try {
      const result = await this.dispatch(intent);
      return { ...result, durationMs: Date.now() - start };
    } catch (e) {
      const err = e as Error;
      return {
        success: false,
        message: err.message ?? String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  private async dispatch(i: AutomationIntent): Promise<ActionResult> {
    switch (i.action) {
      case "tap":
        return this.tap(i);
      case "find_element":
        return this.findAndTap(i.target ?? "");
      case "swipe":
        return this.swipe(i);
      case "type":
        return this.type(i);
      case "wait":
        return this.wait(i);
      case "scroll":
        return this.scroll(i);
      case "screenshot":
        return this.screenshot();
      case "app:open":
        return this.openApp(i);
      case "app:back":
        return this.performGlobal("back");
      case "app:home":
        return this.performGlobal("home");
      case "app:recents":
        return this.performGlobal("recents");
      case "system:notifications":
        return this.performGlobal("notifications");
      case "system:lock":
        return { success: false, message: "lock not supported via accessibility" };
      default:
        return { success: false, message: `unknown action: ${i.action}` };
    }
  }

  private async tap(i: AutomationIntent): Promise<ActionResult> {
    const x = Number(i.params?.x);
    const y = Number(i.params?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, message: "tap requires numeric x,y" };
    }
    await AccessibilityModule.tap(x, y);
    return { success: true, message: `tap(${x},${y})` };
  }

  async findAndTap(text: string): Promise<ActionResult> {
    if (!text) return { success: false, message: "empty target text" };
    try {
      const bounds = await AccessibilityModule.findElementByText(text);
      if (bounds) {
        await AccessibilityModule.tap(bounds.centerX, bounds.centerY);
        return { success: true, message: `tapped "${text}"`, data: bounds };
      }
    } catch { /* fall through to tree */ }

    const tree = await AccessibilityModule.getScreenTree();
    const node = findNodeByText(tree, text);
    if (!node) return { success: false, message: `not found: "${text}"` };
    const b = node.bounds;
    await AccessibilityModule.tap(b.centerX, b.centerY);
    return { success: true, message: `tapped "${text}"`, data: b };
  }

  private async swipe(i: AutomationIntent): Promise<ActionResult> {
    const direction = String(i.params?.direction ?? "down");
    const duration = Number(i.params?.duration ?? 300);
    const { fromX, fromY, toX, toY } = this.swipeCoords(direction);
    await AccessibilityModule.swipe(fromX, fromY, toX, toY, duration);
    return { success: true, message: `swipe ${direction}` };
  }

  private swipeCoords(direction: string) {
    const cx = this.screenWidth / 2;
    const cy = this.screenHeight / 2;
    const dx = this.screenWidth * 0.3;
    const dy = this.screenHeight * 0.3;
    switch (direction) {
      case "up":    return { fromX: cx, fromY: cy + dy, toX: cx, toY: cy - dy };
      case "down":  return { fromX: cx, fromY: cy - dy, toX: cx, toY: cy + dy };
      case "left":  return { fromX: cx + dx, fromY: cy, toX: cx - dx, toY: cy };
      case "right": return { fromX: cx - dx, fromY: cy, toX: cx + dx, toY: cy };
      default:      return { fromX: cx, fromY: cy - dy, toX: cx, toY: cy + dy };
    }
  }

  private async type(i: AutomationIntent): Promise<ActionResult> {
    const text = String(i.params?.text ?? "");
    if (!text) return { success: false, message: "empty text" };
    await AccessibilityModule.typeText(text);
    return { success: true, message: `typed "${text}"` };
  }

  private async wait(i: AutomationIntent): Promise<ActionResult> {
    const ms = Number(i.params?.durationMs ?? 1000);
    await sleep(ms);
    return { success: true, message: `waited ${ms}ms` };
  }

  private async scroll(i: AutomationIntent): Promise<ActionResult> {
    return this.swipe({ ...i, action: "swipe" });
  }

  private async screenshot(): Promise<ActionResult> {
    const base64 = await ScreenCaptureModule.captureScreenshot(80);
    return { success: true, message: "screenshot captured", data: { base64 } };
  }

  private async openApp(i: AutomationIntent): Promise<ActionResult> {
    const pkg = i.target ?? "";
    if (!pkg) return { success: false, message: "missing package name" };
    const ok = await AppManagerModule.launchApp(pkg);
    return { success: ok, message: ok ? `launched ${pkg}` : `failed to launch ${pkg}` };
  }

  private async performGlobal(
    action: "back" | "home" | "recents" | "notifications" | "power",
  ): Promise<ActionResult> {
    await AccessibilityModule.performAction(action);
    return { success: true, message: `performed ${action}` };
  }

  async waitForCondition(cond: ScreenCondition): Promise<ActionResult> {
    const timeout = cond.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();
    if (cond.type === "delay") {
      await sleep(cond.timeoutMs ?? 1000);
      return { success: true };
    }
    while (Date.now() - start < timeout) {
      const tree = await AccessibilityModule.getScreenTree().catch(() => [] as ScreenNode[]);
      const found = cond.value ? findNodeByText(tree, cond.value) != null : false;
      if (cond.type === "text_visible" && found) return { success: true };
      if (cond.type === "text_gone" && !found) return { success: true };
      await sleep(DEFAULT_POLL_MS);
    }
    return { success: false, message: `condition ${cond.type} timed out` };
  }
}

export function findNodeByText(tree: ScreenNode[], text: string): ScreenNode | null {
  const lower = text.toLowerCase();
  const stack = [...tree];
  while (stack.length) {
    const node = stack.pop()!;
    const nodeText = (node.text ?? "").toLowerCase();
    const desc = (node.contentDescription ?? "").toLowerCase();
    if (nodeText.includes(lower) || desc.includes(lower)) return node;
    if (node.children) stack.push(...node.children);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
