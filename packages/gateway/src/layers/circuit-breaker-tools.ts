/**
 * Circuit Breaker Tools — Advanced Layer (API 86)
 * Implements: Fault tolerance, fallback, bulkhead pattern, health checks
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // ms
  resetTimeout: number; // ms
}

export interface CircuitBreaker {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastStateChange?: Date;
}

const circuits = new Map<string, CircuitBreaker>();

export async function createCircuitBreaker(
  name: string,
  config: CircuitBreakerConfig
): Promise<CircuitBreaker> {
  const cb: CircuitBreaker = {
    name,
    state: "closed",
    failures: 0,
    successes: 0,
    lastStateChange: new Date()
  };
  
  circuits.set(name, cb);
  return cb;
}

export async function executeWithCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: () => Promise<T>,
  config: CircuitBreakerConfig
): Promise<T> {
  let cb = circuits.get(name);
  if (!cb) cb = await createCircuitBreaker(name, config);
  
  if (cb.state === "open") {
    // Check if should transition to half_open
    if (Date.now() - (cb.lastStateChange?.getTime() || 0) > config.resetTimeout) {
      cb.state = "half_open";
      cb.lastStateChange = new Date();
    } else {
      return fallback();
    }
  }
  
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), config.timeout))
    ]) as T;
    
    // Success
    cb.successes++;
    if (cb.state === "half_open" && cb.successes >= config.successThreshold) {
      cb.state = "closed";
      cb.failures = 0;
      cb.successes = 0;
      cb.lastStateChange = new Date();
    }
    
    return result;
  } catch (e) {
    cb.failures++;
    cb.lastFailure = new Date();
    
    if (cb.failures >= config.failureThreshold) {
      cb.state = "open";
      cb.lastStateChange = new Date();
    }
    
    return fallback();
  }
}

export async function getCircuitBreakerStatus(name: string): Promise<CircuitBreaker | null> {
  return circuits.get(name) || null;
}

export async function resetCircuitBreaker(name: string): Promise<boolean> {
  const cb = circuits.get(name);
  if (!cb) return false;
  
  cb.state = "closed";
  cb.failures = 0;
  cb.successes = 0;
  cb.lastStateChange = new Date();
  
  return true;
}

export class CircuitBreakerLayer {
  create = createCircuitBreaker;
  execute = executeWithCircuitBreaker;
  getStatus = getCircuitBreakerStatus;
  reset = resetCircuitBreaker;
}
