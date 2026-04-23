import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { v4 as uuid } from "uuid";

const WHITELIST_PATH = join(homedir(), ".omnistate", "approval-whitelist.json");
const STORAGE_DIR = join(homedir(), ".omnistate");

export type RiskLevel = "low" | "medium" | "high";

export interface PendingApproval {
  id: string;
  intent: string;
  risk: RiskLevel;
  context: string;
  userId: string;
  createdAt: string;
  resolve?: (approved: boolean) => void;
}

export interface ApprovalResult {
  approved: boolean;
  autoApproved: boolean;
}

interface WhitelistEntry {
  key: string; // `${userId}::${intent}`
  count: number;
  autoApprove: boolean;
}

function loadWhitelist(): WhitelistEntry[] {
  if (!existsSync(WHITELIST_PATH)) return [];
  try {
    return JSON.parse(readFileSync(WHITELIST_PATH, "utf-8")) as WhitelistEntry[];
  } catch {
    return [];
  }
}

function saveWhitelist(entries: WhitelistEntry[]): void {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  writeFileSync(WHITELIST_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

const AUTO_APPROVE_THRESHOLD = 3;
const DEFAULT_TIMEOUT_MS = 60_000;

// In-memory queue
const pendingQueue = new Map<string, PendingApproval>();

export function getPendingApprovals(): Omit<PendingApproval, "resolve">[] {
  return Array.from(pendingQueue.values()).map(({ resolve: _r, ...rest }) => rest);
}

export function requestApproval(opts: {
  intent: string;
  risk: RiskLevel;
  context: string;
  userId: string;
  timeoutMs?: number;
}): Promise<ApprovalResult> {
  const key = `${opts.userId}::${opts.intent}`;
  const whitelist = loadWhitelist();
  const wlEntry = whitelist.find((e) => e.key === key);

  // Auto-approve if whitelisted
  if (wlEntry?.autoApprove) {
    return Promise.resolve({ approved: true, autoApproved: true });
  }

  const id = uuid();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ApprovalResult>((resolve) => {
    const pending: PendingApproval = {
      id,
      intent: opts.intent,
      risk: opts.risk,
      context: opts.context,
      userId: opts.userId,
      createdAt: new Date().toISOString(),
      resolve: (approved) => resolve({ approved, autoApproved: false }),
    };

    pendingQueue.set(id, pending);

    // Timeout → reject
    setTimeout(() => {
      if (pendingQueue.has(id)) {
        pendingQueue.delete(id);
        resolve({ approved: false, autoApproved: false });
      }
    }, timeoutMs);
  });
}

function recordApproval(userId: string, intent: string, approved: boolean, makeAutoApprove: boolean): void {
  const key = `${userId}::${intent}`;
  const whitelist = loadWhitelist();
  const idx = whitelist.findIndex((e) => e.key === key);

  if (idx === -1) {
    whitelist.push({ key, count: approved ? 1 : 0, autoApprove: makeAutoApprove });
  } else {
    if (approved) whitelist[idx].count += 1;
    if (makeAutoApprove) whitelist[idx].autoApprove = true;
    // Auto-promote after threshold
    if (whitelist[idx].count >= AUTO_APPROVE_THRESHOLD) {
      whitelist[idx].autoApprove = true;
    }
  }

  saveWhitelist(whitelist);
}

export function approveRequest(id: string, permanent = false): boolean {
  const pending = pendingQueue.get(id);
  if (!pending) return false;

  recordApproval(pending.userId, pending.intent, true, permanent);
  pending.resolve?.(true);
  pendingQueue.delete(id);
  return true;
}

export function rejectRequest(id: string): boolean {
  const pending = pendingQueue.get(id);
  if (!pending) return false;

  pending.resolve?.(false);
  pendingQueue.delete(id);
  return true;
}
