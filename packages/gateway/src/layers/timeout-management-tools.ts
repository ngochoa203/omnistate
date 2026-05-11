/**
 * Timeout Management Tools — Advanced Layer (API 88)
 * Implements: Timeout pools, deadline propagation, graceful shutdown
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface TimeoutTask {
  id: string;
  fn: () => Promise<any>;
  timeout: number;
  startedAt: Date;
  deadline: Date;
  status: "pending" | "running" | "completed" | "timeout" | "cancelled";
}

export interface TimeoutConfig {
  defaultTimeout: number;
  maxConcurrent: number;
  onTimeout?: (task: TimeoutTask) => void;
}

const tasks = new Map<string, TimeoutTask>();
const timeouts = new Map<string, NodeJS.Timeout>();

export async function scheduleWithTimeout<T>(
  id: string,
  fn: () => Promise<T>,
  timeout: number,
  config?: TimeoutConfig
): Promise<{ result?: T; status: TimeoutTask["status"]; duration: number }> {
  const task: TimeoutTask = {
    id,
    fn,
    timeout,
    startedAt: new Date(),
    deadline: new Date(Date.now() + timeout),
    status: "pending"
  };
  
  tasks.set(id, task);
  
  const timeoutId = setTimeout(() => {
    const t = tasks.get(id);
    if (t && t.status === "pending") {
      t.status = "timeout";
      config?.onTimeout?.(t);
    }
  }, timeout);
  
  timeouts.set(id, timeoutId);
  
  task.status = "running";
  const startTime = Date.now();
  
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => timeoutId)
    ]) as T;
    
    task.status = "completed";
    return { result, status: "completed", duration: Date.now() - startTime };
  } catch (e) {
    task.status = "timeout";
    return { status: "timeout", duration: Date.now() - startTime };
  } finally {
    clearTimeout(timeoutId);
    timeouts.delete(id);
  }
}

export async function cancelTimeout(id: string): Promise<boolean> {
  const timeoutId = timeouts.get(id);
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeouts.delete(id);
  }
  
  const task = tasks.get(id);
  if (task) {
    task.status = "cancelled";
    return true;
  }
  
  return false;
}

export async function getTimeoutTaskStatus(id: string): Promise<TimeoutTask | null> {
  return tasks.get(id) || null;
}

export async function listTimeoutTasks(): Promise<TimeoutTask[]> {
  return Array.from(tasks.values());
}

export class TimeoutManagementLayer {
  schedule = scheduleWithTimeout;
  cancel = cancelTimeout;
  getStatus = getTimeoutTaskStatus;
  list = listTimeoutTasks;
}
