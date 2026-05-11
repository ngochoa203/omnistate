/**
 * Clipboard & Clipboard History Tools — Group 17
 * Implements: Advanced clipboard operations, history, sync, templates
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Basic Clipboard Operations
// ------------------------------------------------------------------

export async function getClipboard(): Promise<string> {
  try {
    const { stdout } = await execAsync("osascript -e 'the clipboard as text'", { encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function setClipboard(text: string): Promise<boolean> {
  try {
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    await execAsync(`osascript -e 'set the clipboard to "${escaped}"'`);
    return true;
  } catch {
    return false;
  }
}

export async function clearClipboard(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set the clipboard to ""'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Clipboard History (In-Memory)
// ------------------------------------------------------------------

interface ClipboardEntry {
  id: string;
  content: string;
  type: "text" | "image" | "file" | "html";
  timestamp: Date;
  pinned: boolean;
}

const clipboardHistory: ClipboardEntry[] = [];
const MAX_HISTORY = 50;

export async function addToHistory(content: string, type: "text" | "image" | "file" | "html" = "text"): Promise<string> {
  const id = `clip-${Date.now()}`;
  
  clipboardHistory.unshift({
    id,
    content,
    type,
    timestamp: new Date(),
    pinned: false
  });
  
  // Limit history size
  while (clipboardHistory.length > MAX_HISTORY) {
    const lastUnpinned = [...clipboardHistory].reverse().findIndex(e => !e.pinned);
    const actualIndex = lastUnpinned >= 0 ? clipboardHistory.length - 1 - lastUnpinned : -1;
    if (actualIndex >= 0) {
      clipboardHistory.splice(lastUnpinned, 1);
    } else {
      break;
    }
  }
  
  return id;
}

export async function getHistory(limit: number = 10): Promise<ClipboardEntry[]> {
  return clipboardHistory.slice(0, limit);
}

export async function searchHistory(query: string): Promise<ClipboardEntry[]> {
  return clipboardHistory.filter(e => 
    e.content.toLowerCase().includes(query.toLowerCase())
  );
}

export async function copyFromHistory(id: string): Promise<boolean> {
  const entry = clipboardHistory.find(e => e.id === id);
  if (entry) {
    return setClipboard(entry.content);
  }
  return false;
}

export async function pinHistoryEntry(id: string): Promise<boolean> {
  const entry = clipboardHistory.find(e => e.id === id);
  if (entry) {
    entry.pinned = true;
    return true;
  }
  return false;
}

export async function deleteHistoryEntry(id: string): Promise<boolean> {
  const index = clipboardHistory.findIndex(e => e.id === id);
  if (index >= 0) {
    clipboardHistory.splice(index, 1);
    return true;
  }
  return false;
}

export async function clearHistory(keepPinned: boolean = true): Promise<boolean> {
  if (keepPinned) {
    const pinned = clipboardHistory.filter(e => e.pinned);
    clipboardHistory.length = 0;
    clipboardHistory.push(...pinned);
  } else {
    clipboardHistory.length = 0;
  }
  return true;
}

// ------------------------------------------------------------------
// Clipboard Templates
// ------------------------------------------------------------------

interface ClipboardTemplate {
  id: string;
  name: string;
  content: string;
  category?: string;
  usageCount: number;
}

const templates: ClipboardTemplate[] = [
  { id: "t1", name: "Email Signature", content: "Best regards,\nYour Name\nCompany", usageCount: 0 },
  { id: "t2", name: "Code Block", content: "```\n${code}\n```", usageCount: 0 },
  { id: "t3", name: "Meeting Link", content: "Join Meeting: https://meet.example.com/abc123", usageCount: 0 },
];

export async function createTemplate(name: string, content: string, category?: string): Promise<string> {
  const id = `tmpl-${Date.now()}`;
  templates.push({ id, name, content, category, usageCount: 0 });
  return id;
}

export async function listTemplates(category?: string): Promise<ClipboardTemplate[]> {
  if (category) {
    return templates.filter(t => t.category === category);
  }
  return templates;
}

export async function copyTemplate(id: string, vars?: Record<string, string>): Promise<boolean> {
  const template = templates.find(t => t.id === id);
  if (!template) return false;
  
  let content = template.content;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(`\${${key}}`, value);
    }
  }
  
  template.usageCount++;
  return setClipboard(content);
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const index = templates.findIndex(t => t.id === id);
  if (index >= 0) {
    templates.splice(index, 1);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------
// Multi-Clipboard (Multiple Items)
// ------------------------------------------------------------------

export async function copyMultiple(items: string[], separator: string = "\n"): Promise<boolean> {
  return setClipboard(items.join(separator));
}

export async function copyMerge(items: string[]): Promise<boolean> {
  return copyMultiple(items, "\n---\n");
}

// ------------------------------------------------------------------
// Clipboard File Operations
// ------------------------------------------------------------------

export async function copyFileToClipboard(filePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set the clipboard to ( POSIX file "${filePath}" )'`);
    return true;
  } catch {
    return false;
  }
}

export async function copyImageToClipboard(imagePath: string): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'set the clipboard to (read alias POSIX file "${imagePath}" as JPEG picture)'`);
    return true;
  } catch {
    return false;
  }
}

export async function getClipboardImageInfo(): Promise<{ width?: number; height?: number; format?: string } | null> {
  // Would require ImageEvents or similar
  return null;
}

// ------------------------------------------------------------------
// Sync Clipboard to File
// ------------------------------------------------------------------

const clipboardFile = path.join(os.homedir(), ".omnistate", "clipboard-history.json");

export async function saveHistoryToFile(): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(clipboardFile), { recursive: true });
    await fs.writeFile(clipboardFile, JSON.stringify(clipboardHistory, null, 2));
    return true;
  } catch {
    return false;
  }
}

export async function loadHistoryFromFile(): Promise<boolean> {
  try {
    const data = await fs.readFile(clipboardFile, "utf-8");
    const loaded = JSON.parse(data);
    clipboardHistory.length = 0;
    clipboardHistory.push(...loaded.map((e: any) => ({
      ...e,
      timestamp: new Date(e.timestamp)
    })));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Clipboard Statistics
// ------------------------------------------------------------------

export async function getClipboardStats(): Promise<{
  totalItems: number;
  pinnedCount: number;
  mostUsed?: string;
  lastUsed?: Date;
}> {
  const pinnedCount = clipboardHistory.filter(e => e.pinned).length;
  const mostUsed = templates.sort((a, b) => b.usageCount - a.usageCount)[0];
  
  return {
    totalItems: clipboardHistory.length,
    pinnedCount,
    mostUsed: mostUsed?.name,
    lastUsed: clipboardHistory[0]?.timestamp
  };
}

export class ClipboardLayer {
  get = getClipboard;
  set = setClipboard;
  clear = clearClipboard;
  
  addToHistory = addToHistory;
  getHistory = getHistory;
  searchHistory = searchHistory;
  copyFromHistory = copyFromHistory;
  pinEntry = pinHistoryEntry;
  deleteEntry = deleteHistoryEntry;
  clearHistory = clearHistory;
  
  createTemplate = createTemplate;
  listTemplates = listTemplates;
  copyTemplate = copyTemplate;
  deleteTemplate = deleteTemplate;
  
  copyMultiple = copyMultiple;
  copyMerge = copyMerge;
  
  copyFile = copyFileToClipboard;
  copyImage = copyImageToClipboard;
  
  saveHistory = saveHistoryToFile;
  loadHistory = loadHistoryFromFile;
  
  getStats = getClipboardStats;
}
