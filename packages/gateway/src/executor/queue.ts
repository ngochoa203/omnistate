/**
 * Lane-based FIFO execution queue.
 *
 * Adapted from OpenClaw's command queue pattern.
 * Each session gets its own lane; a global lane handles cross-session work.
 */

type QueueItem = {
  id: string;
  sessionId: string;
  execute: () => Promise<void>;
  priority: "critical" | "normal" | "background";
  enqueuedAt: number;
};

export class ExecutionQueue {
  private lanes: Map<string, QueueItem[]> = new Map();
  private processing: Set<string> = new Set();
  private maxConcurrency: number;

  constructor(maxConcurrency: number = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  /** Enqueue a task into a specific lane. */
  enqueue(
    laneId: string,
    item: Omit<QueueItem, "enqueuedAt">
  ): void {
    const lane = this.lanes.get(laneId) ?? [];
    lane.push({ ...item, enqueuedAt: Date.now() });

    // Sort by priority within lane
    lane.sort((a, b) => {
      const order = { critical: 0, normal: 1, background: 2 };
      return order[a.priority] - order[b.priority];
    });

    this.lanes.set(laneId, lane);
  }

  /** Process the next available item across all lanes. */
  async processNext(): Promise<boolean> {
    if (this.processing.size >= this.maxConcurrency) return false;

    for (const [laneId, lane] of this.lanes) {
      // Skip lane if it's already being processed (sequential within lane)
      if (this.processing.has(laneId)) continue;
      if (lane.length === 0) continue;

      const item = lane.shift()!;
      this.processing.add(laneId);

      // Bug fix #3: do NOT await item.execute() here — that blocks the caller
      // and prevents maxConcurrency from being honored. Fire-and-forget; the
      // finally block cleans up the processing slot when the item completes.
      item.execute().finally(() => {
        this.processing.delete(laneId);
      });
      return true;
    }
    return false;
  }

  /** Get queue depth across all lanes. */
  get depth(): number {
    let total = 0;
    for (const lane of this.lanes.values()) {
      total += lane.length;
    }
    return total;
  }

  /** Get the number of currently processing items. */
  get active(): number {
    return this.processing.size;
  }
}
