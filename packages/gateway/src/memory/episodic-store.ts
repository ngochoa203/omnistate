import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger.js";
import type { EmbeddingProvider } from "./embeddings.js";

export interface Episode {
  id: string;
  taskId: string;
  goal: string;
  summary: string;
  embedding: Float32Array;
  toolsUsed: string[];
  success: boolean;
  durationMs: number;
  createdAt: string;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function bufferToFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export class EpisodicStore {
  constructor(
    private readonly db: Database.Database,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async record(
    episode: Omit<Episode, "id" | "embedding" | "createdAt"> & { summary: string },
  ): Promise<string> {
    const id = uuid();
    const text = `${episode.goal} ${episode.summary}`;
    const embeddingArr = await this.embedder.embed(text);
    const embeddingBuf = Buffer.from(embeddingArr.buffer);

    this.db
      .prepare(
        `INSERT INTO episodic_memories (id, task_id, goal, summary, embedding, tools_used, success, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        episode.taskId,
        episode.goal,
        episode.summary,
        embeddingBuf,
        JSON.stringify(episode.toolsUsed),
        episode.success ? 1 : 0,
        episode.durationMs,
      );

    logger.debug({ id, taskId: episode.taskId }, "[episodic-store] recorded episode");
    return id;
  }

  async recall(
    query: string,
    opts?: { limit?: number; minSimilarity?: number },
  ): Promise<Episode[]> {
    const limit = opts?.limit ?? 5;
    const minSimilarity = opts?.minSimilarity ?? 0.3;

    const queryEmbedding = await this.embedder.embed(query);

    const rows = this.db
      .prepare(
        `SELECT id, task_id, goal, summary, embedding, tools_used, success, duration_ms, created_at
         FROM episodic_memories
         ORDER BY created_at DESC
         LIMIT 500`,
      )
      .all() as Array<{
        id: string;
        task_id: string;
        goal: string;
        summary: string;
        embedding: Buffer;
        tools_used: string;
        success: number;
        duration_ms: number;
        created_at: string;
      }>;

    const scored = rows
      .map((row) => {
        const emb = bufferToFloat32Array(row.embedding);
        const sim = cosineSimilarity(queryEmbedding, emb);
        return { row, sim };
      })
      .filter(({ sim }) => sim >= minSimilarity)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit);

    return scored.map(({ row }) => ({
      id: row.id,
      taskId: row.task_id,
      goal: row.goal,
      summary: row.summary,
      embedding: bufferToFloat32Array(row.embedding),
      toolsUsed: JSON.parse(row.tools_used) as string[],
      success: row.success === 1,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }));
  }

  prune(maxAgeDays: number): number {
    const result = this.db
      .prepare(
        `DELETE FROM episodic_memories
         WHERE created_at < datetime('now', ?)`,
      )
      .run(`-${maxAgeDays} days`);
    const deleted = result.changes;
    if (deleted > 0) {
      logger.info({ deleted, maxAgeDays }, "[episodic-store] pruned old episodes");
    }
    return deleted;
  }
}
