/**
 * AppManagerModule — launch/discover installed apps via intents.
 */

import { Linking } from "react-native";

export interface KnownApp {
  id: string;
  name: string;
  packageName: string;
  category: "game" | "social" | "productivity" | "system";
}

export const KNOWN_APPS: KnownApp[] = [
  { id: "messenger", name: "Messenger", packageName: "com.facebook.orca", category: "social" },
  { id: "zalo", name: "Zalo", packageName: "com.zing.zalo", category: "social" },
  { id: "youtube", name: "YouTube", packageName: "com.google.android.youtube", category: "social" },
  { id: "chrome", name: "Chrome", packageName: "com.android.chrome", category: "productivity" },
  { id: "settings", name: "Settings", packageName: "com.android.settings", category: "system" },
  { id: "camera", name: "Camera", packageName: "com.android.camera", category: "system" },
];

export const AppManagerModule = {
  async launchApp(packageName: string): Promise<boolean> {
    const url = `intent://open#Intent;package=${packageName};end`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) return false;
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  },

  getKnownApps(): KnownApp[] {
    return KNOWN_APPS.slice();
  },

  findByName(name: string): KnownApp | undefined {
    const lower = name.toLowerCase();
    return KNOWN_APPS.find(
      (a) => a.name.toLowerCase().includes(lower) || a.id.includes(lower),
    );
  },
};
