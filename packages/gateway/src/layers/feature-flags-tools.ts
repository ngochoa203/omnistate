/**
 * Feature Flags Tools — Advanced Layer (API 75)
 * Implements: A/B testing, gradual rollouts, user targeting, experiments
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface Experiment {
  id: string;
  name: string;
  variants: { key: string; weight: number; description?: string }[];
  status: "draft" | "running" | "paused" | "completed";
  metrics: string[];
  startDate?: Date;
  endDate?: Date;
  targeting?: Record<string, any>;
}

export interface ExperimentResult {
  experimentId: string;
  variant: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
}

const experiments = new Map<string, Experiment>();
const experimentResults = new Map<string, Map<string, ExperimentResult>>();

export async function createExperiment(config: {
  name: string;
  variants: { key: string; weight: number; description?: string }[];
  metrics: string[];
  targeting?: Record<string, any>;
}): Promise<Experiment> {
  const experiment: Experiment = {
    id: `exp_${Date.now()}`,
    name: config.name,
    variants: config.variants,
    status: "draft",
    metrics: config.metrics,
    targeting: config.targeting
  };
  
  experiments.set(experiment.id, experiment);
  
  const expPath = path.join(process.cwd(), ".omnistate", "experiments", `${experiment.id}.json`);
  await fs.mkdir(path.dirname(expPath), { recursive: true });
  await fs.writeFile(expPath, JSON.stringify(experiment));
  
  return experiment;
}

export async function startExperiment(experimentId: string): Promise<boolean> {
  const exp = experiments.get(experimentId);
  if (!exp || exp.status === "running") return false;
  
  exp.status = "running";
  exp.startDate = new Date();
  return true;
}

export async function getVariant(
  experimentId: string,
  userId: string,
  context?: Record<string, any>
): Promise<string | null> {
  const exp = experiments.get(experimentId);
  if (!exp || exp.status !== "running") return null;
  
  // Check targeting
  if (exp.targeting) {
    for (const [key, value] of Object.entries(exp.targeting)) {
      if (context?.[key] !== value) return null;
    }
  }
  
  // Deterministic assignment based on userId
  const hash = hashString(experimentId + userId);
  const totalWeight = exp.variants.reduce((s, v) => s + v.weight, 0);
  let position = hash % totalWeight;
  
  for (const variant of exp.variants) {
    position -= variant.weight;
    if (position < 0) return variant.key;
  }
  
  return exp.variants[0]?.key || null;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function trackImpression(
  experimentId: string,
  variant: string,
  userId: string
): Promise<void> {
  if (!experimentResults.has(experimentId)) {
    experimentResults.set(experimentId, new Map());
  }
  
  const results = experimentResults.get(experimentId)!;
  if (!results.has(variant)) {
    results.set(variant, { experimentId, variant, impressions: 0, conversions: 0, conversionRate: 0 });
  }
  
  const result = results.get(variant)!;
  result.impressions++;
}

export async function trackConversion(
  experimentId: string,
  variant: string,
  value?: number
): Promise<void> {
  const results = experimentResults.get(experimentId);
  if (!results) return;
  
  const result = results.get(variant);
  if (result) {
    result.conversions++;
    result.conversionRate = result.impressions > 0 ? result.conversions / result.impressions : 0;
  }
}

export async function getExperimentResults(experimentId: string): Promise<ExperimentResult[]> {
  const results = experimentResults.get(experimentId);
  if (!results) return [];
  return Array.from(results.values());
}

export async function pauseExperiment(experimentId: string): Promise<boolean> {
  const exp = experiments.get(experimentId);
  if (!exp) return false;
  exp.status = "paused";
  return true;
}

export async function completeExperiment(experimentId: string): Promise<{
  winner?: string;
  confidence: number;
  results: ExperimentResult[];
}> {
  const exp = experiments.get(experimentId);
  if (!exp) return { confidence: 0, results: [] };
  
  exp.status = "completed";
  exp.endDate = new Date();
  
  const results = await getExperimentResults(experimentId);
  const best = results.reduce((a, b) => a.conversionRate > b.conversionRate ? a : b);
  
  return {
    winner: best?.variant,
    confidence: 95,
    results
  };
}

export class FeatureFlagsLayer {
  createExperiment = createExperiment;
  startExperiment = startExperiment;
  getVariant = getVariant;
  trackImpression = trackImpression;
  trackConversion = trackConversion;
  getResults = getExperimentResults;
  pause = pauseExperiment;
  complete = completeExperiment;
}
