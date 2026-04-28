import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { TranscriptEntry } from "../types/session.js";

/**
 * Transcript writer — appends step records to a JSONL file.
 *
 * Each task gets its own transcript file for forensic review.
 */
export class TranscriptWriter {
  private filePath: string;
  private traceId?: string;

  constructor(transcriptDir: string, sessionId: string, traceId?: string) {
    this.filePath = `${transcriptDir}/${sessionId}.jsonl`;
    this.traceId = traceId;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** Append a single transcript entry. */
  write(entry: TranscriptEntry): void {
    const line = JSON.stringify({ ...entry, ...(this.traceId ? { traceId: this.traceId } : {}) }) + "\n";
    appendFileSync(this.filePath, line);
  }

  /** Convenience: record step start. */
  stepStart(
    nodeId: string,
    layer: "deep" | "surface" | "fleet" | "auto"
  ): void {
    this.write({
      type: "step.start",
      ts: new Date().toISOString(),
      nodeId,
      layer,
    });
  }

  /** Convenience: record step result. */
  stepResult(
    nodeId: string,
    status: "ok" | "error",
    data?: Record<string, unknown>,
    error?: string
  ): void {
    this.write({
      type: "step.result",
      ts: new Date().toISOString(),
      nodeId,
      status,
      data,
      error,
    });
  }

  /** Convenience: record step end with duration. */
  stepEnd(nodeId: string, durationMs: number): void {
    this.write({
      type: "step.end",
      ts: new Date().toISOString(),
      nodeId,
      durationMs,
    });
  }

  /** Convenience: record task completion. */
  taskComplete(
    totalDurationMs: number,
    stepsCompleted: number,
    retriesUsed: number
  ): void {
    this.write({
      type: "task.complete",
      ts: new Date().toISOString(),
      totalDurationMs,
      stepsCompleted,
      retriesUsed,
    });
  }
}
