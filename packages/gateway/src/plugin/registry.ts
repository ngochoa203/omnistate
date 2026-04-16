/**
 * Plugin registry — loads, validates, and manages OmniState plugins.
 *
 * Plugin categories:
 * - deep: OS-level automation capabilities
 * - surface: App-specific UI automation
 * - fleet: Multi-machine coordination extensions
 * - health: Custom health sensors and repairs
 * - verify: Custom verification strategies
 * - channel: New command input channels
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export type PluginCategory =
  | "deep"
  | "surface"
  | "fleet"
  | "health"
  | "verify"
  | "channel";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  category: PluginCategory;
  capabilities: string[];
  requirements?: {
    platform?: string[];
    apps?: string[];
  };
  hooks?: string[];
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  module: unknown;
  status: "active" | "error" | "disabled";
}

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginDir: string;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
  }

  /** Scan plugin directory and load enabled plugins. */
  async loadAll(enabledIds: string[]): Promise<void> {
    if (!existsSync(this.pluginDir)) return;

    const dirs = readdirSync(this.pluginDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      const manifestPath = resolve(this.pluginDir, dir, "omnistate.plugin.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const raw = readFileSync(manifestPath, "utf-8");
        const manifest: PluginManifest = JSON.parse(raw);

        if (!enabledIds.includes(manifest.id)) {
          this.plugins.set(manifest.id, {
            manifest,
            module: null,
            status: "disabled",
          });
          continue;
        }

        // Load the plugin entry point
        const entryPoint = resolve(this.pluginDir, dir, "index.js");
        let mod: unknown = null;
        if (existsSync(entryPoint)) {
          try {
            mod = await import(entryPoint);
            if (typeof (mod as any).activate === "function") {
              await (mod as any).activate();
            }
          } catch (loadErr) {
            this.plugins.set(manifest.id, {
              manifest,
              module: null,
              status: "error",
            });
            continue;
          }
        }

        this.plugins.set(manifest.id, {
          manifest,
          module: mod,
          status: "active",
        });
      } catch {
        // Invalid manifest, skip
      }
    }
  }

  /** Get a loaded plugin by ID. */
  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** Get all plugins in a category. */
  byCategory(category: PluginCategory): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.manifest.category === category
    );
  }

  /** Get all active plugins. */
  active(): LoadedPlugin[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.status === "active"
    );
  }

  /** Get all registered capabilities across all active plugins. */
  capabilities(): string[] {
    return this.active().flatMap((p) => p.manifest.capabilities);
  }
}
