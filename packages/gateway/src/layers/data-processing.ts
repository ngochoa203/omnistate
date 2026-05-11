/**
 * Data Processing Layer — CSV, JSON, text manipulation.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export async function readCsv(filePath: string, delimiter: string = ","): Promise<Array<Record<string, string>>> {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(line => line.trim());
    if (lines.length === 0) return [];
    const headers = lines[0]!.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ""));
    return lines.slice(1).map(line => {
      const values = line.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ""));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = values[i] || ""; });
      return obj;
    });
  } catch {
    return [];
  }
}

export async function writeCsv(filePath: string, data: Array<Record<string, unknown>>, delimiter: string = ","): Promise<{ success: boolean; rows: number; error?: string }> {
  try {
    if (data.length === 0) return { success: false, rows: 0, error: "No data" };
    const headers = Object.keys(data[0]!);
    const lines = [headers.map(h => `"${h}"`).join(delimiter)];
    for (const row of data) {
      const values = headers.map(h => {
        const str = String(row[h] ?? "");
        return str.includes(delimiter) || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      });
      lines.push(values.join(delimiter));
    }
    writeFileSync(filePath, lines.join("\n"), "utf-8");
    return { success: true, rows: data.length };
  } catch (err: unknown) {
    return { success: false, rows: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readJson<T = unknown>(filePath: string): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    if (!existsSync(filePath)) return { success: false, error: "File not found" };
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as T;
    return { success: true, data };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function extractByRegex(text: string, pattern: string, flags: string = "g"): string[] {
  try {
    const regex = new RegExp(pattern, flags);
    if (flags.includes("g")) {
      const matches: string[] = [];
      let match;
      while ((match = regex.exec(text)) !== null) matches.push(match[0]!);
      return matches;
    }
    const match = text.match(regex);
    return match ? [match[0]!] : [];
  } catch {
    return [];
  }
}

export function extractEmails(text: string): string[] {
  return extractByRegex(text, "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}");
}

export function extractUrls(text: string): string[] {
  return extractByRegex(text, "https?://[^\\s<>\\\"']+");
}