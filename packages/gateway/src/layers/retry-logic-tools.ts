/**
 * Retry Logic Tools — Advanced Layer (API 87)
 * Implements: Exponential backoff, jitter, retry policies, dead letter handling
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number; // ms
  maxDelay: number; // ms
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: string[];
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  attempts: number;
  totalTime: number;
  errors: string[];
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<RetryResult<T>> {
  const errors: string[] = [];
  const startTime = Date.now();
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt,
        totalTime: Date.now() - startTime,
        errors
      };
    } catch (e: any) {
      errors.push(e.message || String(e));
      
      if (attempt < config.maxAttempts) {
        let delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1);
        delay = Math.min(delay, config.maxDelay);
        
        if (config.jitter) {
          delay = delay * (0.5 + Math.random() * 0.5);
        }
        
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  return {
    success: false,
    attempts: config.maxAttempts,
    totalTime: Date.now() - startTime,
    errors
  };
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeout: number,
  fallback?: () => Promise<T>
): Promise<T> {
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout))
    ]) as T;
  } catch (e) {
    if (fallback) return fallback();
    throw e;
  }
}

export class RetryLogicLayer {
  withRetry = withRetry;
  withTimeout = withTimeout;
}
