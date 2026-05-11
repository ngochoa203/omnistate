/**
 * Security Tools Layer — Passwords, hashing, Keychain, audit.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";

const execAsync = promisify(exec);

export function generatePassword(length: number = 16, options: { includeUppercase?: boolean; includeLowercase?: boolean; includeNumbers?: boolean; includeSymbols?: boolean } = {}): string {
  const { includeUppercase = true, includeLowercase = true, includeNumbers = true, includeSymbols = true } = options;
  let chars = "";
  if (includeLowercase) chars += "abcdefghijklmnopqrstuvwxyz";
  if (includeUppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (includeNumbers) chars += "0123456789";
  if (includeSymbols) chars += "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const random = randomBytes(length);
  return Array.from(random).map(b => chars[b % chars.length]!).join("");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function checkPasswordStrength(password: string): { score: number; strength: string; feedback: string[] } {
  let score = 0;
  const feedback: string[] = [];
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  else feedback.push("Add lowercase letters");
  if (/[A-Z]/.test(password)) score += 1;
  else feedback.push("Add uppercase letters");
  if (/[0-9]/.test(password)) score += 1;
  else feedback.push("Add numbers");
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  else feedback.push("Add special characters");
  const strength = score <= 2 ? "weak" : score <= 4 ? "fair" : score <= 6 ? "good" : "strong";
  return { score: Math.max(0, score), strength, feedback };
}

export async function getKeychainPassword(service: string, account: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`security find-generic-password -s "${service}" -a "${account}" -w 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function setKeychainPassword(service: string, account: string, password: string): Promise<boolean> {
  try {
    await execAsync(`security delete-generic-password -s "${service}" -a "${account}" 2>/dev/null`, { encoding: "utf-8" });
    await execAsync(`security add-generic-password -s "${service}" -a "${account}" -w "${password}"`, { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function securityAudit(): Promise<Array<{ name: string; passed: boolean; details: string; severity: string }>> {
  const checks: Array<{ name: string; passed: boolean; details: string; severity: string }> = [];
  try {
    const { stdout } = await execAsync(`defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null`, { encoding: "utf-8" });
    checks.push({ name: "Firewall", passed: stdout.trim() === "1", details: stdout.trim() === "1" ? "Enabled" : "Disabled", severity: "high" });
  } catch {
    checks.push({ name: "Firewall", passed: false, details: "Unable to check", severity: "medium" });
  }
  try {
    const { stdout } = await execAsync(`csrutil status 2>/dev/null`, { encoding: "utf-8" });
    checks.push({ name: "SIP", passed: stdout.toLowerCase().includes("enabled"), details: stdout.includes("enabled") ? "Enabled" : "Disabled", severity: "critical" });
  } catch {
    checks.push({ name: "SIP", passed: false, details: "Unable to check", severity: "low" });
  }
  return checks;
}