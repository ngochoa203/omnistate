/**
 * Queue Management Tools — Advanced Layer (API 71)
 * Implements: Message queues, task queues, priority queues, dead letter queues
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface QueueMessage {
  id: string;
  queue: string;
  payload: any;
  priority: "low" | "normal" | "high" | "critical";
  retries: number;
  maxRetries: number;
  createdAt: Date;
  processedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export interface QueueStats {
  name: string;
  size: number;
  avgWaitTime: number;
  processing: number;
  deadLetter: number;
}

const queues = new Map<string, QueueMessage[]>();

export async function enqueue(
  queueName: string,
  payload: any,
  options?: { priority?: QueueMessage["priority"]; delay?: number }
): Promise<string> {
  if (!queues.has(queueName)) {
    queues.set(queueName, []);
  }
  
  const message: QueueMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    queue: queueName,
    payload,
    priority: options?.priority || "normal",
    retries: 0,
    maxRetries: 3,
    createdAt: new Date()
  };
  
  queues.get(queueName)!.push(message);
  
  // Persist to disk
  const queuePath = path.join(process.cwd(), ".omnistate", "queues", `${queueName}.jsonl`);
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.appendFile(queuePath, JSON.stringify(message) + "\n");
  
  return message.id;
}

export async function dequeue(queueName: string, timeout: number = 5000): Promise<QueueMessage | null> {
  const queue = queues.get(queueName);
  if (!queue || queue.length === 0) {
    await new Promise(r => setTimeout(r, Math.min(timeout, 1000)));
    return queues.get(queueName)?.[0] || null;
  }
  
  // Sort by priority
  queue.sort((a, b) => {
    const pOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    return pOrder[a.priority] - pOrder[b.priority];
  });
  
  return queue.shift() || null;
}

export async function acknowledge(messageId: string): Promise<boolean> {
  for (const [name, queue] of queues.entries()) {
    const idx = queue.findIndex(m => m.id === messageId);
    if (idx >= 0) {
      queue[idx].processedAt = new Date();
      return true;
    }
  }
  return false;
}

export async function requeue(messageId: string, error?: string): Promise<boolean> {
  for (const [name, queue] of queues.entries()) {
    const msg = queue.find(m => m.id === messageId);
    if (msg) {
      msg.retries++;
      msg.error = error;
      if (msg.retries >= msg.maxRetries) {
        msg.failedAt = new Date();
      }
      return true;
    }
  }
  return false;
}

export async function getQueueStats(queueName: string): Promise<QueueStats> {
  const queue = queues.get(queueName) || [];
  return {
    name: queueName,
    size: queue.length,
    avgWaitTime: 0,
    processing: 0,
    deadLetter: queue.filter(m => m.failedAt).length
  };
}

export async function purgeQueue(queueName: string): Promise<number> {
  const queue = queues.get(queueName) || [];
  const size = queue.length;
  queues.set(queueName, []);
  return size;
}

export async function listQueues(): Promise<QueueStats[]> {
  const stats: QueueStats[] = [];
  for (const [name] of queues.entries()) {
    stats.push(await getQueueStats(name));
  }
  return stats;
}

export class QueueLayer {
  enqueue = enqueue;
  dequeue = dequeue;
  acknowledge = acknowledge;
  requeue = requeue;
  getStats = getQueueStats;
  purge = purgeQueue;
  list = listQueues;
}
