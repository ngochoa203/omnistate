import type { Logger } from "pino";
import type { DeepLayer } from "../layers/deep.js";
import type { SurfaceLayer } from "../layers/surface.js";
import type { BrowserLayer } from "../layers/browser.js";
import type { FleetLayer } from "../layers/fleet.js";
import type { DeepOSLayer } from "../layers/deep-os.js";
import type { DeepSystemLayer } from "../layers/deep-system.js";
import type { HardwareLayer } from "../layers/hardware.js";
import type { IOKitLayer } from "../layers/iokit.js";
import type { KernelLayer } from "../layers/kernel.js";
import type { SoftwareLayer } from "../layers/software.js";
import type { CommunicationLayer } from "../layers/communication.js";
import type { DeveloperLayer } from "../layers/developer.js";
import type { MaintenanceLayer } from "../layers/maintenance.js";
import type { MediaLayer } from "../layers/media.js";

export type { Logger };

export interface StructuredResponse {
  speak: string;
  ui?: Record<string, unknown>;
  followup?: string[];
  data?: unknown;
}

export interface HandlerLayers {
  surface: SurfaceLayer;
  deep: DeepLayer;
  browser: BrowserLayer;
  fleet: FleetLayer;
  hybrid: Record<string, unknown>;
  deepOS?: DeepOSLayer;
  /** Deep system layer — shell profiles, clipboard, logs, display, audio, containers */
  deepSystem?: DeepSystemLayer;
  /** Hardware layer — volume, brightness, bluetooth, battery, keyboard backlight */
  hardware?: HardwareLayer;
  /** IOKit layer — direct sensor reads: thermals, fans, battery health, NVRAM, USB/PCI tree */
  iokit?: IOKitLayer;
  /** Kernel layer — sysctl, kexts, process tracing, Spotlight, launchd, SIP */
  kernel?: KernelLayer;
  /** Software layer — Homebrew, npm, pip, env vars, system info */
  software?: SoftwareLayer;
  /** Communication layer — Mail, Messages, Calendar, Notifications */
  communication?: CommunicationLayer;
  /** Developer layer — terminal, git, editor, Docker */
  developer?: DeveloperLayer;
  /** Maintenance layer — disk cleanup, log rotation, health checks */
  maintenance?: MaintenanceLayer;
  /** Media layer — audio/video playback, screen recording, screenshots */
  media?: MediaLayer;
  /** HybridAutomation — macro/workflow automation (static class ref) */
  hybridAuto?: Record<string, unknown>;
  /** HybridTooling — tooling utilities (static class ref) */
  hybridTools?: Record<string, unknown>;
  /** Health monitor — system health checks */
  health?: Record<string, unknown>;
  /** Advanced vision — UI detection, approval policy */
  vision?: Record<string, unknown>;
  /** Native bridge — platform N-API bridge */
  bridge?: Record<string, unknown>;
}

export interface HandlerContext {
  sessionId?: string;
  userId?: string;
  logger: Logger;
  layers: HandlerLayers;
}

export type IntentHandler = (
  args: Record<string, unknown>,
  ctx: HandlerContext
) => Promise<StructuredResponse>;

export class IntentRegistry {
  private readonly handlers = new Map<string, IntentHandler>();

  register(tool: string, handler: IntentHandler): void {
    this.handlers.set(tool, handler);
  }

  has(tool: string): boolean {
    return this.handlers.has(tool);
  }

  async dispatch(
    tool: string,
    args: Record<string, unknown>,
    ctx: HandlerContext
  ): Promise<StructuredResponse> {
    const handler = this.handlers.get(tool);
    if (!handler) {
      throw new Error(`No handler registered for tool: ${tool}`);
    }
    return handler(args, ctx);
  }
}
