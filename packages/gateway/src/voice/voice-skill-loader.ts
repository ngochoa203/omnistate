import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-skill-loader");

export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  intents: string[];
  permissions: string[];
  dependencies?: string[];
  entry?: string;
  config?: Record<string, unknown>;
}

export interface SkillHandlers {
  onIntent?: (ctx: SkillContext) => Promise<SkillResult | null>;
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;
}

export interface SkillContext {
  userId: string;
  sessionId: string;
  transcript: string;
  intent: string;
  entities: Record<string, string[]>;
  language: string;
}

export interface SkillResult {
  success: boolean;
  message: string;
  data?: unknown;
  tts?: string;
  handled: boolean;
}

export interface VoiceSkill {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  intents: string[];
  permissions: string[];
  dependencies: string[];
  config: Record<string, unknown>;
  handlers: SkillHandlers;
  status: SkillStatus;
  loadTime: number;
}

export type SkillStatus = "loading" | "loaded" | "enabled" | "disabled" | "error" | "unloaded";

export interface VoiceSkillLoader {
  loadSkill(manifest: SkillManifest, handlers: SkillHandlers): Promise<void>;
  unloadSkill(id: string): void;
  enableSkill(id: string): void;
  disableSkill(id: string): void;
  getSkill(id: string): VoiceSkill | null;
  getAllSkills(): VoiceSkill[];
  listSkills(): SkillSummary[];
  reloadSkill(id: string): Promise<void>;
}

export interface SkillSummary {
  id: string;
  name: string;
  version: string;
  status: SkillStatus;
  intentCount: number;
  enabled: boolean;
}


const SKILLS_DIR = join(homedir(), ".omnistate", "skills");

class VoiceSkillLoaderImpl extends EventEmitter implements VoiceSkillLoader {
  private skills = new Map<string, VoiceSkill>();
  private manifestCache = new Map<string, SkillManifest>();

  constructor() {
    super();
    this.loadManifests();
  }

  private loadManifests(): void {
    try {
      if (!existsSync(SKILLS_DIR)) {
        mkdirSync(SKILLS_DIR, { recursive: true });
        log.info("Skills directory created");
        return;
      }

      const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = join(SKILLS_DIR, entry.name, "skill.json");
          if (existsSync(manifestPath)) {
            try {
              const raw = readFileSync(manifestPath, "utf-8");
              const manifest = JSON.parse(raw) as SkillManifest;
              this.manifestCache.set(entry.name, manifest);
              log.debug({ id: entry.name, name: manifest.name }, "Skill manifest found");
            } catch (err) {
              log.warn({ path: manifestPath, err }, "Failed to parse skill manifest");
            }
          }
        }
      }

      log.info({ count: this.manifestCache.size }, "Skill manifests loaded");
    } catch (err) {
      log.warn({ err }, "Failed to load skill manifests");
    }
  }

  async loadSkill(manifest: SkillManifest, handlers: SkillHandlers): Promise<void> {
    const { id } = manifest;

    if (this.skills.has(id)) {
      log.warn({ id }, "Skill already loaded");
      return;
    }

    const skill: VoiceSkill = {
      id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      intents: manifest.intents ?? [],
      permissions: manifest.permissions ?? [],
      dependencies: manifest.dependencies ?? [],
      config: manifest.config ?? {},
      handlers,
      status: "loading",
      loadTime: Date.now(),
    };

    // Check dependencies
    for (const depId of skill.dependencies) {
      if (!this.skills.has(depId)) {
        const depManifest = this.manifestCache.get(depId);
        if (!depManifest) {
          throw new Error(`Skill dependency not found: ${depId}`);
        }
        // Note: In production, would recursively load dependency
        log.warn({ id, depId }, "Dependency not loaded yet");
      }
    }

    // Load handlers
    try {
      if (handlers.onStart) {
        await handlers.onStart();
      }
      skill.status = "loaded";
      this.skills.set(id, skill);

      log.info({ id, name: skill.name }, "Skill loaded");
      this.emit("skillLoaded", { id, name: skill.name });
    } catch (err) {
      skill.status = "error";
      log.error({ id, err }, "Failed to load skill");
      throw err;
    }
  }

  unloadSkill(id: string): void {
    const skill = this.skills.get(id);
    if (!skill) return;

    try {
      if (skill.handlers.onStop) {
        skill.handlers.onStop().catch(err => {
          log.error({ id, err }, "Skill onStop error");
        });
      }

      skill.status = "unloaded";
      this.skills.delete(id);

      log.info({ id }, "Skill unloaded");
      this.emit("skillUnloaded", { id });
    } catch (err) {
      log.error({ id, err }, "Failed to unload skill");
    }
  }

  enableSkill(id: string): void {
    const skill = this.skills.get(id);
    if (!skill) {
      log.warn({ id }, "Skill not found for enable");
      return;
    }

    if (skill.status === "enabled") return;

    try {
      // Check permissions (in production, would prompt user)
      for (const permission of skill.permissions) {
        if (!this.checkPermission(permission)) {
          throw new Error(`Permission denied: ${permission}`);
        }
      }

      if (skill.handlers.onEnable) {
        skill.handlers.onEnable().catch(err => {
          log.error({ id, err }, "Skill onEnable error");
        });
      }

      skill.status = "enabled";
      log.info({ id }, "Skill enabled");
      this.emit("skillEnabled", { id });
    } catch (err) {
      skill.status = "disabled";
      log.error({ id, err }, "Failed to enable skill");
      this.emit("skillError", { id, error: String(err) });
    }
  }

  disableSkill(id: string): void {
    const skill = this.skills.get(id);
    if (!skill) return;

    try {
      if (skill.handlers.onDisable) {
        skill.handlers.onDisable().catch(err => {
          log.error({ id, err }, "Skill onDisable error");
        });
      }

      skill.status = "disabled";
      log.info({ id }, "Skill disabled");
      this.emit("skillDisabled", { id });
    } catch (err) {
      log.error({ id, err }, "Failed to disable skill");
    }
  }

  getSkill(id: string): VoiceSkill | null {
    return this.skills.get(id) ?? null;
  }

  getAllSkills(): VoiceSkill[] {
    return Array.from(this.skills.values());
  }

  listSkills(): SkillSummary[] {
    return this.getAllSkills().map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
      status: s.status,
      intentCount: s.intents.length,
      enabled: s.status === "enabled",
    }));
  }

  async reloadSkill(id: string): Promise<void> {
    const manifest = this.manifestCache.get(id);
    if (!manifest) {
      throw new Error(`Skill manifest not found: ${id}`);
    }

    this.unloadSkill(id);
    // In production, would re-require the skill module and call loadSkill again
    log.info({ id }, "Skill reloaded");
    this.emit("skillReloaded", { id });
  }

  /**
   * Execute intent across all enabled skills.
   * First matching skill that handles the intent wins.
   */
  async dispatchIntent(ctx: SkillContext): Promise<SkillResult | null> {
    const enabledSkills = this.getAllSkills().filter(s => s.status === "enabled");

    for (const skill of enabledSkills) {
      if (skill.intents.includes(ctx.intent) && skill.handlers.onIntent) {
        try {
          const result = await skill.handlers.onIntent(ctx);
          if (result?.handled) {
            log.debug({ skillId: skill.id, intent: ctx.intent }, "Intent handled by skill");
            return result;
          }
        } catch (err) {
          log.error({ skillId: skill.id, err }, "Skill handler error");
          // Continue to next skill
        }
      }
    }

    return null;
  }

  private checkPermission(permission: string): boolean {
    // In production, would check against user-granted permissions
    // For now, allow all permissions in dev mode
    const allowedPermissions = [
      "access_microphone",
      "control_apps",
      "send_messages",
      "make_calls",
      "access_files",
      "control_homekit",
      "access_location",
    ];
    return allowedPermissions.includes(permission);
  }
}

export interface VoiceSkillLoader extends EventEmitter {
  on(event: "skillLoaded", listener: (info: { id: string; name: string }) => void): this;
  on(event: "skillUnloaded" | "skillReloaded", listener: (info: { id: string }) => void): this;
  on(event: "skillEnabled" | "skillDisabled", listener: (info: { id: string }) => void): this;
  on(event: "skillError", listener: (info: { id: string; error: string }) => void): this;
  emit(event: "skillLoaded", info: { id: string; name: string }): boolean;
  emit(event: "skillUnloaded" | "skillReloaded", info: { id: string }): boolean;
  emit(event: "skillEnabled" | "skillDisabled", info: { id: string }): boolean;
  emit(event: "skillError", info: { id: string; error: string }): boolean;
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voiceSkillLoader: VoiceSkillLoader = new VoiceSkillLoaderImpl();