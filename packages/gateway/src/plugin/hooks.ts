/**
 * Hook system — allows plugins to intercept execution lifecycle events.
 *
 * Hook points match the agent loop phases from architecture docs:
 * - before_plan, after_plan
 * - before_step, after_step
 * - before_verify
 * - on_failure, on_complete
 */

export type HookPoint =
  | "before_plan"
  | "after_plan"
  | "before_step"
  | "after_step"
  | "before_verify"
  | "on_failure"
  | "on_complete";

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface HookContext {
  taskId: string;
  nodeId?: string;
  phase: HookPoint;
  data: Record<string, unknown>;
}

export interface HookResult {
  /** If true, proceed with the operation. If false, abort. */
  proceed: boolean;
  /** Optional data to merge into the execution context. */
  data?: Record<string, unknown>;
}

export class HookRegistry {
  private hooks: Map<HookPoint, Array<{ pluginId: string; handler: HookHandler }>> =
    new Map();

  /** Register a hook handler from a plugin. */
  register(
    pluginId: string,
    point: HookPoint,
    handler: HookHandler
  ): void {
    const existing = this.hooks.get(point) ?? [];
    existing.push({ pluginId, handler });
    this.hooks.set(point, existing);
  }

  /** Unregister all hooks from a plugin. */
  unregisterAll(pluginId: string): void {
    for (const [point, handlers] of this.hooks) {
      this.hooks.set(
        point,
        handlers.filter((h) => h.pluginId !== pluginId)
      );
    }
  }

  /**
   * Run all handlers for a hook point.
   * Returns false if any handler says not to proceed.
   */
  async run(context: HookContext): Promise<HookResult> {
    const handlers = this.hooks.get(context.phase) ?? [];
    let mergedData: Record<string, unknown> = {};

    for (const { handler } of handlers) {
      const result = await handler(context);
      if (!result.proceed) {
        return { proceed: false, data: result.data };
      }
      if (result.data) {
        mergedData = { ...mergedData, ...result.data };
      }
    }

    return { proceed: true, data: mergedData };
  }
}
