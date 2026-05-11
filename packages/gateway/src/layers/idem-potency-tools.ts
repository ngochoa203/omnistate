/**
 * Idempotency Tools — Advanced Layer (API 95)
 * Implements: Idempotent operations, deduplication, request deduplication
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface IdempotencyRecord {
  key: string;
  status: "processing" | "completed" | "failed";
  result?: any;
  error?: string;
  createdAt: Date;
  expiresAt: Date;
}

const idempotencyStore = new Map<string, IdempotencyRecord>();

export async function withIdempotency<T>(
  key: string,
  fn: () => Promise<T>,
  options?: { ttl?: number }
): Promise<{ result?: T; isCached: boolean }> {
  const existing = idempotencyStore.get(key);
  
  if (existing?.status === "completed") {
    return { result: existing.result as T, isCached: true };
  }
  
  if (existing?.status === "processing") {
    throw new Error("Request already in progress");
  }
  
  const record: IdempotencyRecord = {
    key,
    status: "processing",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + (options?.ttl || 3600) * 1000)
  };
  
  idempotencyStore.set(key, record);
  
  try {
    const result = await fn();
    record.status = "completed";
    record.result = result;
    return { result, isCached: false };
  } catch (e: any) {
    record.status = "failed";
    record.error = e.message;
    throw e;
  }
}

export async function getIdempotencyStatus(key: string): Promise<IdempotencyRecord | null> {
  return idempotencyStore.get(key) || null;
}

export async function clearIdempotencyKey(key: string): Promise<boolean> {
  return idempotencyStore.delete(key);
}

export async function clearExpiredIdempotencyKeys(): Promise<number> {
  let cleared = 0;
  const now = new Date();
  
  for (const [key, record] of idempotencyStore.entries()) {
    if (record.expiresAt < now) {
      idempotencyStore.delete(key);
      cleared++;
    }
  }
  
  return cleared;
}

export class IdempotencyLayer {
  withIdempotency = withIdempotency;
  getStatus = getIdempotencyStatus;
  clear = clearIdempotencyKey;
  clearExpired = clearExpiredIdempotencyKeys;
}
