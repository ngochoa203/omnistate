import type { Logger } from "pino";
import type { DeepLayer } from "../layers/deep.js";
import type { SurfaceLayer } from "../layers/surface.js";
import type { BrowserLayer } from "../layers/browser.js";
import type { FleetLayer } from "../layers/fleet.js";
import type { DeepOSLayer } from "../layers/deep-os.js";

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
