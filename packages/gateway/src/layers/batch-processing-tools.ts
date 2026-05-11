/**
 * Batch Processing Tools — Advanced Layer (API 70)
 * Implements: Bulk operations, job queues, batch jobs, parallel processing
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface BatchJob {
  id: string;
  name: string;
  type: "import" | "export" | "transform" | "delete" | "custom";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  processed: number;
  failed: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export async function createBatchJob(
  name: string,
  type: BatchJob["type"],
  items: any[]
): Promise<BatchJob> {
  const job: BatchJob = {
    id: `batch_${Date.now()}`,
    name,
    type,
    status: "pending",
    total: items.length,
    processed: 0,
    failed: 0,
    createdAt: new Date()
  };
  
  const jobPath = path.join(process.cwd(), ".omnistate", "jobs", `${job.id}.json`);
  await fs.mkdir(path.dirname(jobPath), { recursive: true });
  await fs.writeFile(jobPath, JSON.stringify(job));
  
  // Save items
  const itemsPath = path.join(process.cwd(), ".omnistate", "jobs", `${job.id}_items.json`);
  await fs.writeFile(itemsPath, JSON.stringify(items));
  
  return job;
}

export async function processBatchJob(
  jobId: string,
  processor: (item: any) => Promise<boolean>,
  concurrency: number = 5
): Promise<{ success: boolean; processed: number; failed: number }> {
  const jobPath = path.join(process.cwd(), ".omnistate", "jobs", `${jobId}.json`);
  const itemsPath = path.join(process.cwd(), ".omnistate", "jobs", `${jobId}_items.json`);
  
  const job: BatchJob = JSON.parse(await fs.readFile(jobPath, "utf-8"));
  const items: any[] = JSON.parse(await fs.readFile(itemsPath, "utf-8"));
  
  job.status = "running";
  await fs.writeFile(jobPath, JSON.stringify(job));
  
  let processed = 0, failed = 0;
  
  // Process in chunks
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map(item => processor(item)));
    
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        processed++;
      } else {
        failed++;
      }
    }
    
    job.processed = processed;
    job.failed = failed;
    await fs.writeFile(jobPath, JSON.stringify(job));
  }
  
  job.status = failed === 0 ? "completed" : failed === job.total ? "failed" : "completed";
  job.completedAt = new Date();
  await fs.writeFile(jobPath, JSON.stringify(job));
  
  return { success: job.status === "completed", processed, failed };
}

export async function getBatchJobStatus(jobId: string): Promise<BatchJob | null> {
  try {
    const jobPath = path.join(process.cwd(), ".omnistate", "jobs", `${jobId}.json`);
    return JSON.parse(await fs.readFile(jobPath, "utf-8"));
  } catch {
    return null;
  }
}

export async function cancelBatchJob(jobId: string): Promise<boolean> {
  try {
    const jobPath = path.join(process.cwd(), ".omnistate", "jobs", `${jobId}.json`);
    const job: BatchJob = JSON.parse(await fs.readFile(jobPath, "utf-8"));
    job.status = "cancelled";
    job.completedAt = new Date();
    await fs.writeFile(jobPath, JSON.stringify(job));
    return true;
  } catch {
    return false;
  }
}

export async function listBatchJobs(status?: BatchJob["status"]): Promise<BatchJob[]> {
  const jobsDir = path.join(process.cwd(), ".omnistate", "jobs");
  const jobs: BatchJob[] = [];
  
  try {
    const files = await fs.readdir(jobsDir);
    for (const file of files.filter(f => f.endsWith(".json") && !f.includes("_items"))) {
      const job: BatchJob = JSON.parse(await fs.readFile(path.join(jobsDir, file), "utf-8"));
      if (!status || job.status === status) {
        jobs.push(job);
      }
    }
  } catch {
    // Return empty
  }
  
  return jobs;
}

export async function retryFailedBatchJob(jobId: string): Promise<boolean> {
  try {
    const jobPath = path.join(process.cwd(), ".omnistate", "jobs", `${jobId}.json`);
    const job: BatchJob = JSON.parse(await fs.readFile(jobPath, "utf-8"));
    job.status = "pending";
    job.processed = 0;
    job.failed = 0;
    job.completedAt = undefined;
    job.error = undefined;
    await fs.writeFile(jobPath, JSON.stringify(job));
    return true;
  } catch {
    return false;
  }
}

export class BatchProcessingLayer {
  createJob = createBatchJob;
  processJob = processBatchJob;
  getStatus = getBatchJobStatus;
  cancelJob = cancelBatchJob;
  listJobs = listBatchJobs;
  retryJob = retryFailedBatchJob;
}
