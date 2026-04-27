/**
 * BaseAppProfile — abstract base for app-specific automation profiles.
 *
 * Profiles provide:
 *   - screen recognition (isAppScreen)
 *   - a map of user-authored macros keyed by intent name
 *
 * NOTE: OmniState ships only neutral, general-purpose profiles for user
 * productivity automation. Profiles for competitive-multiplayer games that
 * would violate those games' ToS (input automation, botting) are NOT provided
 * and must be authored by the user on their own responsibility.
 */

import type { AutomationIntent, ActionResult, Macro } from "../engine/types";
import type { ActionExecutor } from "../engine/action-executor";
import type { ScreenNode } from "../native/AccessibilityModule";

export abstract class BaseAppProfile {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly packageName: string;
  abstract readonly category: "productivity" | "social" | "media" | "utility" | "other";

  /** User-authored macros this profile exposes. */
  macros: Macro[] = [];

  /** Identify the app's top-level screen from an accessibility tree. */
  abstract isAppScreen(tree: ScreenNode[]): boolean;

  /** Default action dispatcher — profiles can override for custom handling. */
  async executeAction(
    intent: AutomationIntent,
    executor: ActionExecutor,
  ): Promise<ActionResult> {
    return executor.execute(intent);
  }

  protected findNode(tree: ScreenNode[], text: string): ScreenNode | null {
    const lower = text.toLowerCase();
    const stack = [...tree];
    while (stack.length) {
      const n = stack.pop()!;
      if ((n.text ?? "").toLowerCase().includes(lower)) return n;
      if (n.children) stack.push(...n.children);
    }
    return null;
  }

  protected hasClass(tree: ScreenNode[], pattern: string): boolean {
    const re = new RegExp(pattern);
    const stack = [...tree];
    while (stack.length) {
      const n = stack.pop()!;
      if (re.test(n.className ?? "")) return true;
      if (n.children) stack.push(...n.children);
    }
    return false;
  }

  protected scaleCoords(
    x: number,
    y: number,
    baseWidth: number,
    baseHeight: number,
    actualWidth: number,
    actualHeight: number,
  ): { x: number; y: number } {
    return {
      x: Math.round((x / baseWidth) * actualWidth),
      y: Math.round((y / baseHeight) * actualHeight),
    };
  }
}
