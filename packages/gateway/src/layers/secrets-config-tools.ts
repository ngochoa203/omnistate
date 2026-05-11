/**
 * Secrets & Configuration Management — Group 44
 * Implements: Environment variables, secrets, config files, vaults
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";


// ------------------------------------------------------------------
// Environment Variables
// ------------------------------------------------------------------

export async function getEnvVar(name: string): Promise<string | undefined> {
  return process.env[name];
}

export async function setEnvVar(name: string, value: string): Promise<boolean> {
  process.env[name] = value;
  return true;
}

export async function listEnvVars(prefix?: string): Promise<{ name: string; value: string }[]> {
  const env = process.env;
  const entries = Object.entries(env);
  
  if (prefix) {
    return entries
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => ({ name, value: value || "" }));
  }
  
  return entries.map(([name, value]) => ({ name, value: value || "" }));
}

export async function exportEnvToFile(filePath: string, vars: string[]): Promise<boolean> {
  try {
    const content = vars.map(v => `${v}=${process.env[v] || ""}`).join("\n");
    await fs.writeFile(filePath, content);
    return true;
  } catch {
    return false;
  }
}

export async function loadEnvFromFile(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");
    
    for (const line of lines) {
      if (line && !line.startsWith("#") && line.includes("=")) {
        const [key, ...valueParts] = line.split("=");
        const value = valueParts.join("=").trim();
        if (key && !process.env[key]) {
          process.env[key.trim()] = value;
        }
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Secrets Management
// ------------------------------------------------------------------

export interface Secret {
  key: string;
  value: string;
  updatedAt: Date;
}

const secretsStore: Map<string, Secret> = new Map();

export async function setSecret(key: string, value: string): Promise<boolean> {
  secretsStore.set(key, {
    key,
    value,
    updatedAt: new Date()
  });
  return true;
}

export async function getSecret(key: string): Promise<string | null> {
  const secret = secretsStore.get(key);
  return secret?.value || null;
}

export async function deleteSecret(key: string): Promise<boolean> {
  return secretsStore.delete(key);
}

export async function listSecrets(): Promise<{ key: string; updatedAt: Date }[]> {
  return Array.from(secretsStore.values()).map(s => ({
    key: s.key,
    updatedAt: s.updatedAt
  }));
}

// ------------------------------------------------------------------
// Configuration Files
// ------------------------------------------------------------------

export async function readConfig(filePath: string): Promise<object | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    
    if (filePath.endsWith(".json")) {
      return JSON.parse(content);
    } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
      // Simple YAML parser
      const result: Record<string, any> = {};
      const lines = content.split("\n");
      
      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
          result[match[1]!] = match[2]?.trim() || "";
        }
      }
      
      return result;
    } else if (filePath.endsWith(".env")) {
      const config: Record<string, string> = {};
      content.split("\n").forEach(line => {
        if (line && !line.startsWith("#") && line.includes("=")) {
          const [key, value] = line.split("=");
          config[key.trim()] = value?.trim() || "";
        }
      });
      return config;
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function writeConfig(filePath: string, config: object): Promise<boolean> {
  try {
    let content: string;
    
    if (filePath.endsWith(".json")) {
      content = JSON.stringify(config, null, 2);
    } else if (filePath.endsWith(".env")) {
      const obj = config as Record<string, string>;
      content = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n");
    } else {
      content = JSON.stringify(config, null, 2);
    }
    
    await fs.writeFile(filePath, content);
    return true;
  } catch {
    return false;
  }
}

export async function mergeConfig(baseFile: string, overrides: object): Promise<object> {
  const base = await readConfig(baseFile) || {};
  return { ...base, ...overrides };
}

// ------------------------------------------------------------------
// Hash & Encryption
// ------------------------------------------------------------------

export function hashString(value: string, algorithm: "sha256" | "sha512" = "sha256"): string {
  const hash = crypto.createHash(algorithm);
  hash.update(value);
  return hash.digest("hex");
}

export function generateRandomString(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

export function encryptValue(value: string, password: string): string {
  const key = crypto.scryptSync(password, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  
  const encrypted = Buffer.concat([iv, cipher.update(value), cipher.final()]);
  return encrypted.toString("base64");
}

export function decryptValue(encrypted: string, password: string): string {
  try {
    const key = crypto.scryptSync(password, "salt", 32);
    const data = Buffer.from(encrypted, "base64");
    const iv = data.subarray(0, 16);
    const text = data.subarray(16);
    
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(text), decipher.final()]);
    
    return decrypted.toString();
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// .gitignore Helper
// ------------------------------------------------------------------

export async function addToGitignore(patterns: string[]): Promise<boolean> {
  try {
    const gitignorePath = path.join(os.homedir(), ".gitignore_global");
    const existing = await fs.readFile(gitignorePath, "utf-8").catch(() => "");
    
    const lines = [...existing.split("\n"), ...patterns].filter((v, i, a) => a.indexOf(v) === i);
    await fs.writeFile(gitignorePath, lines.join("\n"));
    
    return true;
  } catch {
    return false;
  }
}

export class SecretsLayer {
  getEnv = getEnvVar;
  setEnv = setEnvVar;
  listEnv = listEnvVars;
  exportEnv = exportEnvToFile;
  loadEnv = loadEnvFromFile;
  
  setSecret = setSecret;
  getSecret = getSecret;
  deleteSecret = deleteSecret;
  listSecrets = listSecrets;
  
  readConfig = readConfig;
  writeConfig = writeConfig;
  mergeConfig = mergeConfig;
  
  hash = hashString;
  randomString = generateRandomString;
  encrypt = encryptValue;
  decrypt = decryptValue;
  
  addToGitignore = addToGitignore;
}
