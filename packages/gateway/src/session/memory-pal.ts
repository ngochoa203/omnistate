import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { v4 as uuid } from "uuid";

const STORAGE_PATH = join(homedir(), ".omnistate", "memory-pal.json");
const STORAGE_DIR = join(homedir(), ".omnistate");

const MemoryCategorySchema = z.enum(["password", "contact", "address", "birthday", "preference", "note"]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

const MemoryEntrySchema = z.object({
  id: z.string(),
  category: MemoryCategorySchema,
  key: z.string().min(1).max(200),
  value: z.string().max(5000),
  sensitive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

const AddEntryInputSchema = z.object({
  category: MemoryCategorySchema,
  key: z.string().min(1).max(200),
  value: z.string().max(5000),
  sensitive: z.boolean().default(false),
});
export type AddEntryInput = z.infer<typeof AddEntryInputSchema>;

export function maskValue(value: string): string {
  return "•".repeat(Math.min(value.length, 8));
}

function loadEntries(): MemoryEntry[] {
  if (!existsSync(STORAGE_PATH)) return [];
  try {
    const raw = readFileSync(STORAGE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data as MemoryEntry[];
    return [];
  } catch {
    return [];
  }
}

function saveEntries(entries: MemoryEntry[]): void {
  if (!existsSync(STORAGE_DIR)) {
    mkdirSync(STORAGE_DIR, { recursive: true });
  }
  writeFileSync(STORAGE_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

export function addEntry(input: AddEntryInput): MemoryEntry {
  const parsed = AddEntryInputSchema.parse(input);
  const entries = loadEntries();
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: uuid(),
    category: parsed.category,
    key: parsed.key,
    value: parsed.value,
    sensitive: parsed.sensitive,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  saveEntries(entries);
  return entry;
}

export function getEntry(id: string): MemoryEntry | null {
  const entries = loadEntries();
  return entries.find((e) => e.id === id) ?? null;
}

export function searchByKey(query: string): MemoryEntry[] {
  const lower = query.toLowerCase();
  return loadEntries().filter((e) => e.key.toLowerCase().includes(lower));
}

export function listAll(category?: MemoryCategory): MemoryEntry[] {
  const entries = loadEntries();
  if (category) return entries.filter((e) => e.category === category);
  return entries;
}

export function deleteEntry(id: string): boolean {
  const entries = loadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  saveEntries(entries);
  return true;
}

/** Returns entry with sensitive values masked for listing */
export function toPublicEntry(entry: MemoryEntry): MemoryEntry & { maskedValue?: string } {
  if (entry.sensitive) {
    return { ...entry, value: maskValue(entry.value), maskedValue: maskValue(entry.value) };
  }
  return entry;
}
