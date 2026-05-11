/**
 * Configuration Management Tools — Advanced Layer (API 74)
 * Implements: Config files, environment management, feature flags, secrets rotation
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface Config {
  name: string;
  environment: string;
  values: Record<string, any>;
  version: number;
  lastModified: Date;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercentage?: number;
  conditions?: Record<string, any>;
  description?: string;
}

const configs = new Map<string, Config>();
const featureFlags = new Map<string, FeatureFlag>();

export async function loadConfig(
  name: string,
  environment: string = "development"
): Promise<Config | null> {
  const key = `${name}:${environment}`;
  if (configs.has(key)) return configs.get(key)!;
  
  const configPath = path.join(process.cwd(), "config", environment, `${name}.json`);
  try {
    const data = await fs.readFile(configPath, "utf-8");
    const config: Config = { name, environment, values: JSON.parse(data), version: 1, lastModified: new Date() };
    configs.set(key, config);
    return config;
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<boolean> {
  const key = `${config.name}:${config.environment}`;
  const configPath = path.join(process.cwd(), "config", config.environment, `${config.name}.json`);
  
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config.values, null, 2));
  
  config.version++;
  config.lastModified = new Date();
  configs.set(key, config);
  
  return true;
}

export async function getConfigValue<T>(
  name: string,
  key: string,
  defaultValue?: T
): Promise<T | undefined> {
  const config = await loadConfig(name);
  return (config?.values?.[key] as T) ?? defaultValue;
}

export async function setFeatureFlag(
  key: string,
  enabled: boolean,
  options?: { rolloutPercentage?: number; description?: string }
): Promise<FeatureFlag> {
  const flag: FeatureFlag = { key, enabled, rolloutPercentage: options?.rolloutPercentage, description: options?.description };
  featureFlags.set(key, flag);
  
  const flagPath = path.join(process.cwd(), ".omnistate", "features", `${key}.json`);
  await fs.mkdir(path.dirname(flagPath), { recursive: true });
  await fs.writeFile(flagPath, JSON.stringify(flag));
  
  return flag;
}

export async function getFeatureFlag(key: string): Promise<FeatureFlag | null> {
  return featureFlags.get(key) || null;
}

export async function isFeatureEnabled(
  key: string,
  context?: Record<string, any>
): Promise<boolean> {
  const flag = await getFeatureFlag(key);
  if (!flag) return false;
  if (!flag.enabled) return false;
  if (flag.rolloutPercentage) {
    const hash = hashString(context?.userId || Math.random().toString());
    return (hash % 100) < flag.rolloutPercentage;
  }
  return true;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  return Array.from(featureFlags.values());
}

export async function rotateSecret(
  key: string,
  generator?: () => string
): Promise<{ old: string; new: string }> {
  const oldSecret = process.env[key] || "";
  const newSecret = generator ? generator() : generateRandomSecret(32);
  
  process.env[key] = newSecret;
  
  const secretPath = path.join(process.cwd(), ".omnistate", "secrets", `${key}.json`);
  await fs.mkdir(path.dirname(secretPath), { recursive: true });
  await fs.writeFile(secretPath, JSON.stringify({ rotated: new Date(), value: newSecret }));
  
  return { old: oldSecret, new: newSecret };
}

function generateRandomSecret(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export class ConfigManagementLayer {
  load = loadConfig;
  save = saveConfig;
  getValue = getConfigValue;
  setFeatureFlag = setFeatureFlag;
  getFeatureFlag = getFeatureFlag;
  isEnabled = isFeatureEnabled;
  listFeatures = listFeatureFlags;
  rotateSecret = rotateSecret;
}
