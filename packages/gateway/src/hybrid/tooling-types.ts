/**
 * Hybrid Tooling Module — Types and Interfaces (UC-D14 through UC-D25).
 *
 * @module hybrid/tooling-types
 */

// ===========================================================================
// Shared Utilities & Helpers
// ===========================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";

export {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
};
import { join, extname } from "node:path";
import { homedir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";

export const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton — mirrors intent.ts pattern)
// ---------------------------------------------------------------------------

export let _client: Anthropic | null = null;

export function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    const baseURL =
      process.env.ANTHROPIC_BASE_URL ?? "https://chat.trollllm.xyz";
    _client = new Anthropic({ apiKey, baseURL });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Persistent storage helpers
// ---------------------------------------------------------------------------

export const OMNISTATE_DIR = join(homedir(), ".omnistate");

export function ensureDir(subdir?: string): string {
  const dir = subdir ? join(OMNISTATE_DIR, subdir) : OMNISTATE_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function askClaude(
  system: string,
  user: string,
  maxTokens: number = 1024
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not set");
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
}

// ===========================================================================
// UC-D14: Workflow Template Library Types
// ===========================================================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: WorkflowTemplateStep[];
  params: TemplateParam[];
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];
}

export interface WorkflowTemplateStep {
  id: string;
  name: string;
  tool: string;
  params: Record<string, unknown>;
  depends?: string[];
}

export interface TemplateParam {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "file";
  required: boolean;
  defaultValue?: unknown;
}

export interface WorkflowTemplateConfig {
  name: string;
  description: string;
  category?: string;
  steps: WorkflowTemplateStep[];
  params?: TemplateParam[];
  author?: string;
  tags?: string[];
}

export interface WorkflowResult {
  templateId: string;
  status: "ok" | "failed";
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  outputs: Record<string, unknown>;
  error?: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  skipped: number;
}

// Built-in templates
export const BUILT_IN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "builtin-git-cleanup",
    name: "Git Cleanup",
    description: "Clean merged branches and prune remote references",
    category: "development",
    steps: [
      { id: "prune", name: "Prune remotes", tool: "shell.exec", params: { command: "git remote prune origin" } },
      { id: "delete-merged", name: "Delete merged branches", tool: "shell.exec", params: { command: "git branch --merged | grep -v '\\*\\|main\\|master\\|develop' | xargs git branch -d 2>/dev/null || true" } },
    ],
    params: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tags: ["git", "dev"],
  },
  {
    id: "builtin-disk-cleanup",
    name: "Disk Cleanup",
    description: "Remove caches, trash, and temporary files",
    category: "maintenance",
    steps: [
      { id: "empty-trash", name: "Empty Trash", tool: "shell.exec", params: { command: "osascript -e 'tell application \"Finder\" to empty trash' 2>/dev/null || true" } },
      { id: "clear-caches", name: "Clear user caches", tool: "shell.exec", params: { command: "rm -rf ~/Library/Caches/* 2>/dev/null || true" } },
    ],
    params: [],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    tags: ["disk", "maintenance"],
  },
];

// ===========================================================================
// UC-D15: AI-Assisted Debugging Types
// ===========================================================================

export interface ErrorContext {
  message: string;
  stack?: string;
  code?: string;
  exitCode?: number;
  stderr?: string;
  filePath?: string;
  language?: string;
}

export interface DebugAnalysis {
  errorType: string;
  rootCause: string;
  severity: "low" | "medium" | "high" | "critical";
  context: ErrorContext;
  analyzedAt: string;
}

export interface CrashAnalysis {
  logPath: string;
  crashedProcess?: string;
  errorSignal?: string;
  timestamp?: string;
  summary: string;
  keyEvents: string[];
  analyzedAt: string;
}

export interface FixSuggestion {
  id: string;
  title: string;
  description: string;
  command?: string;
  filePatch?: string;
  confidence: number;
  automated: boolean;
}

export interface FixResult {
  suggestionId: string;
  status: "ok" | "failed" | "dry-run";
  output?: string;
  durationMs: number;
  error?: string;
}

export interface DebugReport {
  pid: number;
  processName: string;
  status: string;
  memoryMB: number;
  cpuPercent: number;
  openFiles: string[];
  threads: number;
  analyzedAt: string;
}

// ===========================================================================
// UC-D16: Auto File Labeling & Organization Types
// ===========================================================================

export interface FileClassification {
  filePath: string;
  category: string;
  subCategory?: string;
  tags: string[];
  confidence: number;
  suggestedFolder?: string;
  analyzedAt: string;
}

export interface DirectoryClassification {
  dirPath: string;
  files: FileClassification[];
  summary: Record<string, number>;
  analyzedAt: string;
}

export interface OrganizationRules {
  rules: Array<{
    pattern: string;
    targetFolder: string;
    description: string;
  }>;
}

export interface OrganizationResult {
  dirPath: string;
  moved: number;
  skipped: number;
  failed: number;
  actions: string[];
}

export interface OrganizationPlan {
  dirPath: string;
  proposedMoves: Array<{
    from: string;
    to: string;
    reason: string;
  }>;
  estimatedFiles: number;
}

export const FILE_CATEGORY_MAP: Record<string, string[]> = {
  image: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".heic", ".tiff"],
  video: [".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".m4v"],
  audio: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"],
  document: [".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".odt", ".pages"],
  spreadsheet: [".xls", ".xlsx", ".csv", ".numbers", ".ods"],
  presentation: [".ppt", ".pptx", ".key", ".odp"],
  code: [".js", ".ts", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".swift", ".sh", ".bash"],
  archive: [".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".dmg", ".pkg"],
  font: [".ttf", ".otf", ".woff", ".woff2"],
  data: [".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env"],
};

export function categorizeByExtension(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  for (const [category, exts] of Object.entries(FILE_CATEGORY_MAP)) {
    if (exts.includes(ext)) return category;
  }
  return "other";
}

// ===========================================================================
// UC-D17: Scheduled Health Reports Types
// ===========================================================================

export interface HealthReportDoc {
  id: string;
  generatedAt: string;
  period: string;
  overall: "healthy" | "degraded" | "critical";
  sections: HealthReportSection[];
  recommendations: string[];
}

export interface HealthReportSection {
  title: string;
  status: "ok" | "warning" | "critical";
  metrics: Record<string, unknown>;
  notes?: string;
}

export interface ReportConfig {
  includeSections?: string[];
  format?: "json" | "text";
}

export interface ScheduledReport {
  id: string;
  cron: string;
  config: ReportConfig;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

// ===========================================================================
// UC-D18: Machine/Environment Diff Types
// ===========================================================================

export interface MachineSnapshot {
  id: string;
  capturedAt: string;
  hostname: string;
  os: string;
  installedApps: string[];
  brewPackages: string[];
  npmGlobals: string[];
  envVars: Record<string, string>;
  diskUsage: string;
  memoryGB: number;
}

export interface MachineDiff {
  addedApps: string[];
  removedApps: string[];
  addedPackages: string[];
  removedPackages: string[];
  changedEnvVars: string[];
  summary: string;
  diffedAt: string;
}

export interface EnvDiff {
  envA: string;
  envB: string;
  onlyInA: string[];
  onlyInB: string[];
  changed: Array<{ key: string; valueA: string; valueB: string }>;
  diffedAt: string;
}

// ===========================================================================
// UC-D19: Incident Timeline Reconstruction Types
// ===========================================================================

export interface TimelineEvent {
  id: string;
  timestamp: string;
  source: string;
  level: "debug" | "info" | "warning" | "error" | "critical";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface IncidentTimeline {
  id: string;
  startTime: string;
  endTime: string;
  events: TimelineEvent[];
  duration: string;
  builtAt: string;
}

export interface RootCauseAnalysis {
  timelineId: string;
  probableCause: string;
  triggerEvent?: TimelineEvent;
  contributingFactors: string[];
  timeline: string;
  confidence: number;
  analyzedAt: string;
}

// ===========================================================================
// UC-D20: Plugin/Extension Management Types
// ===========================================================================

export interface Extension {
  id: string;
  name: string;
  version?: string;
  browser: string;
  enabled?: boolean;
}

export interface Plugin {
  id: string;
  name: string;
  version?: string;
  ide: string;
  enabled?: boolean;
}

export interface ShellPlugin {
  name: string;
  manager: string;
  path?: string;
}

// ===========================================================================
// UC-D21: Local Data Pipeline Automation Types
// ===========================================================================

export interface PipelineConfig {
  name: string;
  description?: string;
  steps: PipelineStep[];
  schedule?: string;
}

export interface PipelineStep {
  id: string;
  name: string;
  type: "shell" | "transform" | "filter" | "aggregate";
  command?: string;
  params?: Record<string, unknown>;
}

export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  schedule?: string;
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface PipelineResult {
  pipelineId: string;
  status: "ok" | "failed";
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  outputs: Record<string, string>;
  error?: string;
}

// ===========================================================================
// UC-D22: Compliance/Policy Checking Types
// ===========================================================================

export interface CompliancePolicy {
  id: string;
  name: string;
  description: string;
  category: "security" | "privacy" | "performance" | "storage";
  check: string;  // shell command to run; exit 0 = pass
  remediation?: string;
}

export interface ComplianceReport {
  id: string;
  generatedAt: string;
  overall: "compliant" | "non-compliant" | "partial";
  passed: number;
  failed: number;
  skipped: number;
  results: CompliancePolicyResult[];
}

export interface CompliancePolicyResult {
  policyId: string;
  policyName: string;
  status: "pass" | "fail" | "skip";
  output?: string;
  remediation?: string;
}

export interface EncryptionStatus {
  filevaultEnabled: boolean;
  filevaultStatus: string;
  encryptedVolumes: string[];
  checkedAt: string;
}

export interface PolicyResult {
  policy: string;
  compliant: boolean;
  details: string;
  checkedAt: string;
}

export const DEFAULT_POLICIES: CompliancePolicy[] = [
  {
    id: "filevault",
    name: "FileVault Encryption",
    description: "Disk encryption must be enabled",
    category: "security",
    check: "fdesetup status 2>/dev/null | grep -i 'FileVault is On'",
  },
  {
    id: "firewall",
    name: "Firewall Enabled",
    description: "macOS firewall must be active",
    category: "security",
    check: "defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null | grep -E '^[12]$'",
  },
  {
    id: "screen-lock",
    name: "Screen Lock",
    description: "Screen must lock after idle",
    category: "security",
    check: "defaults -currentHost read com.apple.screensaver idleTime 2>/dev/null | grep -vE '^0$'",
  },
  {
    id: "gatekeeper",
    name: "Gatekeeper",
    description: "Gatekeeper must be enabled",
    category: "security",
    check: "spctl --status 2>/dev/null | grep 'assessments enabled'",
  },
  {
    id: "sip",
    name: "System Integrity Protection",
    description: "SIP must be enabled",
    category: "security",
    check: "csrutil status 2>/dev/null | grep 'enabled'",
  },
];

// ===========================================================================
// UC-D23: Smart Notification Digest Types
// ===========================================================================

export interface Notification {
  id: string;
  source: string;
  title: string;
  body?: string;
  timestamp: string;
  priority: "low" | "medium" | "high" | "urgent";
  read?: boolean;
}

export interface NotificationDigest {
  id: string;
  generatedAt: string;
  totalNotifications: number;
  summary: string;
  groups: NotificationGroup[];
}

export interface NotificationGroup {
  source: string;
  count: number;
  latestNotification: Notification;
  summary: string;
}

export interface PrioritizedNotification {
  notification: Notification;
  priorityScore: number;
  reason: string;
}

// ===========================================================================
// UC-D24: Context-Aware Documentation Lookup Types
// ===========================================================================

export interface DocResult {
  title: string;
  url?: string;
  summary: string;
  relevance: number;
  source: string;
}

// ===========================================================================
// UC-D25: Resource Usage Forecasting Types
// ===========================================================================

export interface UsageDataPoint {
  timestamp: string;
  metric: string;
  value: number;
  unit: string;
}

export interface ForecastResult {
  metric: string;
  forecastDays: number;
  trend: "increasing" | "decreasing" | "stable";
  predictedValues: Array<{ date: string; value: number; confidence: number }>;
  summary: string;
  generatedAt: string;
}
