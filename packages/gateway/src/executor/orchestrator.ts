import type { StatePlan, StateNode, ExecutionLayer } from "../types/task.js";
import { ExecutionQueue } from "./queue.js";
import { RetryEngine } from "./retry.js";
import { verifyStep } from "./verify.js";
import { DeepLayer } from "../layers/deep.js";
import { SurfaceLayer } from "../layers/surface.js";
import * as bridge from "../platform/bridge.js";

/**
 * Execution Orchestrator — coordinates the three execution layers.
 *
 * Walks through a StatePlan's DAG, executing each step on the
 * appropriate layer, verifying results, and handling retries.
 */
export class Orchestrator {
  private queue: ExecutionQueue;
  private retry: RetryEngine;
  private deep: DeepLayer;
  private surface: SurfaceLayer;

  constructor() {
    this.queue = new ExecutionQueue();
    this.retry = new RetryEngine();
    this.deep = new DeepLayer();
    this.surface = new SurfaceLayer();
  }

  /** Get current queue depth. */
  get queueDepth(): number {
    return this.queue.depth;
  }

  /**
   * Execute a complete plan.
   */
  async executePlan(plan: StatePlan): Promise<ExecutionResult> {
    const completed = new Set<string>();
    const results: Map<string, StepResult> = new Map();

    for (const node of plan.nodes) {
      const result = await this.executeNode(node, results);
      results.set(node.id, result);

      if (result.status === "ok") {
        completed.add(node.id);
      } else {
        // Attempt retry
        const retried = await this.retry.attemptRetry(
          node,
          result,
          (n) => this.executeNode(n, results)
        );
        if (retried.status === "ok") {
          completed.add(node.id);
          results.set(node.id, retried);
        } else {
          return {
            taskId: plan.taskId,
            status: "failed",
            completedSteps: completed.size,
            totalSteps: plan.nodes.length,
            error: retried.error,
          };
        }
      }
    }

    return {
      taskId: plan.taskId,
      status: "complete",
      completedSteps: completed.size,
      totalSteps: plan.nodes.length,
    };
  }

  private async executeNode(
    node: StateNode,
    _context: Map<string, StepResult>
  ): Promise<StepResult> {
    const layer = this.selectLayer(node);
    const params = node.action.params;
    const tool = node.action.tool;

    const startMs = Date.now();
    let data: Record<string, unknown> = {};

    try {
      if (layer === "deep") {
        data = await this.executeDeep(tool, params);
      } else if (layer === "surface") {
        data = await this.executeSurface(tool, params);
      } else {
        throw new Error(`Unsupported execution layer: ${layer}`);
      }
    } catch (err) {
      const durationMs = Date.now() - startMs;
      return {
        nodeId: node.id,
        status: "failed",
        layer,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - startMs;
    const result: StepResult = {
      nodeId: node.id,
      status: "ok",
      layer,
      durationMs,
      data,
    };

    // Verify if configured
    if (node.verify) {
      const verified = await verifyStep(node, result);
      if (!verified.passed) {
        return { ...result, status: "failed", error: verified.reason };
      }
    }

    return result;
  }

  private async executeDeep(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "shell.exec": {
        const output = this.deep.exec(params.command as string);
        return { output };
      }
      case "app.launch": {
        const success = await this.deep.launchApp(params.name as string);
        return { success };
      }
      case "app.activate": {
        const success = await this.deep.activateApp(params.name as string);
        return { success };
      }
      case "app.quit": {
        const success = await this.deep.quitApp(params.name as string);
        return { success };
      }
      case "file.read": {
        const content = this.deep.readFile(params.path as string);
        return { content };
      }
      case "file.write": {
        this.deep.writeFile(params.path as string, params.content as string);
        return { path: params.path };
      }
      case "process.list": {
        const processes = await this.deep.getProcessList();
        return { processes };
      }
      case "process.kill": {
        const success = await this.deep.killProcess(params.pid as number);
        return { success };
      }
      case "system.info": {
        const info = this.deep.getSystemInfo();
        return { info };
      }
      default:
        throw new Error(`Unknown deep layer tool: ${tool}`);
    }
  }

  private async executeSurface(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Surface layer requires native bindings
    if (!bridge.isNativeAvailable()) {
      throw new Error(
        `Surface layer unavailable: ${bridge.getNativeError() ?? "native binary not loaded"}`
      );
    }

    switch (tool) {
      case "screen.capture": {
        const capture = await this.surface.captureScreen();
        return {
          width: capture.width,
          height: capture.height,
          timestampMs: capture.timestampMs,
          captureMethod: capture.captureMethod,
          bytesPerRow: capture.bytesPerRow,
          pixelFormat: capture.pixelFormat,
        };
      }
      case "ui.find": {
        const element = await this.surface.findElement(params.query as string);
        return { element };
      }
      case "ui.click": {
        const el = params.element as Parameters<
          typeof this.surface.clickElement
        >[0];
        await this.surface.clickElement(el);
        return {};
      }
      case "ui.type": {
        await this.surface.typeText(params.text as string);
        return {};
      }
      case "ui.key": {
        await this.surface.keyTap(
          params.key as string,
          params.modifiers as Parameters<typeof this.surface.keyTap>[1]
        );
        return {};
      }
      case "ui.scroll": {
        await this.surface.scroll(
          params.dx as number,
          params.dy as number
        );
        return {};
      }
      default:
        throw new Error(`Unknown surface layer tool: ${tool}`);
    }
  }

  /**
   * Resolve "auto" layer by inspecting the tool prefix.
   *
   * shell.*, app.*, file.*, process.*, system.* → deep
   * screen.*, ui.*                               → surface
   */
  private selectLayer(node: StateNode): ExecutionLayer {
    if (node.layer !== "auto") return node.layer;

    const prefix = node.action.tool.split(".")[0];
    const surfacePrefixes = new Set(["screen", "ui"]);
    return surfacePrefixes.has(prefix) ? "surface" : "deep";
  }
}

export interface StepResult {
  nodeId: string;
  status: "ok" | "failed";
  layer: ExecutionLayer;
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "complete" | "failed";
  completedSteps: number;
  totalSteps: number;
  error?: string;
}
