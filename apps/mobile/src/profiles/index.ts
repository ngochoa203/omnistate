/**
 * Profile registry — neutral, general-purpose profiles for productivity.
 *
 * OmniState does NOT ship profiles for competitive-multiplayer games.
 * If you want to automate such an app, author a macro yourself with full
 * awareness of the target game's Terms of Service.
 */

import { MessengerProfile } from "./messenger";
import type { BaseAppProfile } from "./base-profile";

export const PROFILES: BaseAppProfile[] = [new MessengerProfile()];

export function findProfile(packageName: string): BaseAppProfile | undefined {
  return PROFILES.find((p) => p.packageName === packageName);
}

export { BaseAppProfile } from "./base-profile";
