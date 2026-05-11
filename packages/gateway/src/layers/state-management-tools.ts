/**
 * State Management Tools — Advanced Layer (API 73)
 * Implements: Application state, cache management, session store, distributed state
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface StateEntry<T = any> {
  key: string;
  value: T;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  tags?: string[];
}

const stateStore = new Map<string, StateEntry>();

export async function setState<T>(
  key: string,
  value: T,
  options?: { ttl?: number; tags?: string[] }
): Promise<StateEntry<T>> {
  const existing = stateStore.get(key);
  const entry: StateEntry<T> = {
    key,
    value,
    version: (existing?.version || 0) + 1,
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date(),
    expiresAt: options?.ttl ? new Date(Date.now() + options.ttl * 1000) : undefined,
    tags: options?.tags
  };
  
  stateStore.set(key, entry);
  
  // Persist
  const statePath = path.join(process.cwd(), ".omnistate", "state", `${key.replace(/\//g, "_")}.json`);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(entry));
  
  return entry;
}

export async function getState<T>(key: string): Promise<StateEntry<T> | null> {
  const entry = stateStore.get(key);
  
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < new Date()) {
    stateStore.delete(key);
    return null;
  }
  
  return entry;
}

export async function deleteState(key: string): Promise<boolean> {
  return stateStore.delete(key);
}

export async function getStateOrDefault<T>(
  key: string,
  defaultValue: T,
  options?: { ttl?: number }
): Promise<T> {
  const entry = await getState<T>(key);
  if (entry) return entry.value;
  
  await setState(key, defaultValue, options);
  return defaultValue;
}

export async function updateState<T>(
  key: string,
  updater: (current: T | undefined) => T
): Promise<StateEntry<T>> {
  const current = await getState<T>(key);
  const newValue = updater(current?.value);
  return setState(key, newValue);
}

export async function findByTags(tags: string[]): Promise<StateEntry[]> {
  const results: StateEntry[] = [];
  for (const [, entry] of stateStore.entries()) {
    if (entry.tags?.some(t => tags.includes(t))) {
      results.push(entry);
    }
  }
  return results;
}

export async function listKeys(pattern?: string): Promise<string[]> {
  const keys = Array.from(stateStore.keys());
  if (!pattern) return keys;
  
  const regex = new RegExp(pattern.replace(/\*/g, ".*"));
  return keys.filter(k => regex.test(k));
}

export async function clearExpired(): Promise<number> {
  let cleared = 0;
  const now = new Date();
  
  for (const [key, entry] of stateStore.entries()) {
    if (entry.expiresAt && entry.expiresAt < now) {
      stateStore.delete(key);
      cleared++;
    }
  }
  
  return cleared;
}

export class StateManagementLayer {
  set = setState;
  get = getState;
  delete = deleteState;
  getOrDefault = getStateOrDefault;
  update = updateState;
  findByTags = findByTags;
  listKeys = listKeys;
  clearExpired = clearExpired;
}
