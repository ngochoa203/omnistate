export class TaskCancelledError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task cancelled: ${taskId}`);
    this.name = "TaskCancelledError";
  }
}

export class CancellationRegistry {
  private controllers = new Map<string, AbortController>();
  private cancelled = new Set<string>();

  create(taskId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.cancelled.delete(taskId);
    return controller.signal;
  }

  cancel(taskId: string): boolean {
    this.cancelled.add(taskId);
    const controller = this.controllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  isCancelled(taskId: string): boolean {
    return this.cancelled.has(taskId) || this.controllers.get(taskId)?.signal.aborted === true;
  }

  throwIfCancelled(taskId: string): void {
    if (this.isCancelled(taskId)) throw new TaskCancelledError(taskId);
  }

  complete(taskId: string): void {
    this.controllers.delete(taskId);
    this.cancelled.delete(taskId);
  }
}
