/**
 * MessengerProfile — read/reply automation for Facebook Messenger.
 */

import type { ScreenNode } from "../native/AccessibilityModule";
import { BaseAppProfile } from "./base-profile";

export class MessengerProfile extends BaseAppProfile {
  readonly id = "messenger";
  readonly name = "Messenger";
  readonly packageName = "com.facebook.orca";
  readonly category = "social" as const;

  isAppScreen(tree: ScreenNode[]): boolean {
    return this.hasClass(tree, "com\\.facebook\\.orca");
  }
}
