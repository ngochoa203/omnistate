/**
 * Plugin sandbox — isolates plugin execution in a worker thread.
 *
 * Note: worker_threads provides V8 context isolation but does not prevent
 * all Node.js API access. PermissionGuard provides the primary enforcement.
 */

import { Worker } from "node:worker_threads";
import { logger } from "../utils/logger.js";
import type { ToolResult } from "./sdk.js";

const DEFAULT_TIMEOUT_MS = 30_000;

// Inline bootstrap script executed inside the worker thread.
const WORKER_BOOTSTRAP = /* js */ `
const { workerData, parentPort } = require("node:worker_threads");

async function main() {
  let pluginModule;
  try {
    pluginModule = await import(workerData.entryPath);
  } catch (err) {
    parentPort.postMessage({
      type: "initError",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (typeof pluginModule.activate === "function") {
    try {
      await pluginModule.activate();
    } catch (err) {
      parentPort.postMessage({
        type: "initError",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  parentPort.postMessage({ type: "ready" });

  parentPort.on("message", async (msg) => {
    if (msg.type !== "callTool") return;
    const { name, params, requestId } = msg;
    try {
      const tool = pluginModule[name];
      if (typeof tool !== "function") {
        throw new Error("Tool not found: " + name);
      }
      const result = await tool(params);
      parentPort.postMessage({ type: "toolResult", result, requestId });
    } catch (err) {
      parentPort.postMessage({
        type: "toolError",
        error: err instanceof Error ? err.message : String(err),
        requestId,
      });
    }
  });
}

main().catch((err) => {
  parentPort.postMessage({
    type: "initError",
    error: err instanceof Error ? err.message : String(err),
  });
});
`;

export class PluginSandbox {
  private worker: Worker | null = null;
  private readonly pluginId: string;
  private readonly timeoutMs: number;

  constructor(pluginId: string, timeoutMs?: number) {
    this.pluginId = pluginId;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async load(entryPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_BOOTSTRAP, {
        eval: true,
        workerData: { entryPath },
      });

      const onMessage = (msg: { type: string; error?: string }) => {
        if (msg.type === "ready") {
          worker.off("message", onMessage);
          worker.off("error", onError);
          this.worker = worker;
          resolve();
        } else if (msg.type === "initError") {
          worker.off("message", onMessage);
          worker.off("error", onError);
          worker.terminate().catch(() => undefined);
          reject(new Error(`Plugin "${this.pluginId}" failed to initialize: ${msg.error}`));
        }
      };

      const onError = (err: Error) => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        reject(err);
      };

      worker.on("message", onMessage);
      worker.on("error", onError);
    });
  }

  async callTool(
    name: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!this.worker) {
      return { success: false, error: "Sandbox not loaded" };
    }

    const requestId = `${this.pluginId}:${name}:${Date.now()}`;
    const worker = this.worker;

    return new Promise<ToolResult>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker.off("message", onMessage);
        logger.warn({ pluginId: this.pluginId, tool: name }, "Plugin tool call timed out");
        this.terminate();
        resolve({ success: false, error: "Plugin timeout" });
      }, this.timeoutMs);

      const onMessage = (msg: {
        type: string;
        requestId?: string;
        result?: ToolResult;
        error?: string;
      }) => {
        if (msg.requestId !== requestId) return;
        if (msg.type !== "toolResult" && msg.type !== "toolError") return;

        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off("message", onMessage);

        if (msg.type === "toolResult") {
          resolve(msg.result ?? { success: true });
        } else {
          resolve({ success: false, error: msg.error ?? "Unknown error" });
        }
      };

      worker.on("message", onMessage);
      worker.postMessage({ type: "callTool", name, params, requestId });
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate().catch((err: unknown) => {
        logger.warn({ pluginId: this.pluginId, err }, "Error terminating plugin worker");
      });
      this.worker = null;
    }
  }
}
