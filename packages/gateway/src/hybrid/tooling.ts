/**
 * Hybrid Tooling Module — UC-D14 through UC-D25.
 *
 * Implements workflow templates, AI-assisted debugging, file organization,
 * health reports, compliance checking, notification digests, documentation
 * lookup, and resource usage forecasting.
 *
 * @module hybrid/tooling
 */

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
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton — mirrors intent.ts pattern)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
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

const OMNISTATE_DIR = join(homedir(), ".omnistate");

function ensureDir(subdir?: string): string {
  const dir = subdir ? join(OMNISTATE_DIR, subdir) : OMNISTATE_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function askClaude(
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
// UC-D14: Workflow Template Library
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
const BUILT_IN_TEMPLATES: WorkflowTemplate[] = [
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

/**
 * UC-D14: List all available workflow templates (built-in + user-created).
 */
export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const dir = ensureDir("templates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const userTemplates = files.map((f) =>
    readJson<WorkflowTemplate>(join(dir, f), {} as WorkflowTemplate)
  );
  return [...BUILT_IN_TEMPLATES, ...userTemplates];
}

/**
 * UC-D14: Get a specific workflow template by ID.
 */
export async function getTemplate(
  templateId: string
): Promise<WorkflowTemplate | null> {
  const builtin = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (builtin) return builtin;

  const dir = ensureDir("templates");
  const path = join(dir, `${templateId}.json`);
  if (!existsSync(path)) return null;
  return readJson<WorkflowTemplate>(path, null as unknown as WorkflowTemplate);
}

/**
 * UC-D14: Create a new workflow template.
 */
export async function createTemplate(
  config: WorkflowTemplateConfig
): Promise<WorkflowTemplate> {
  const now = new Date().toISOString();
  const template: WorkflowTemplate = {
    id: generateId("tmpl"),
    name: config.name,
    description: config.description,
    category: config.category ?? "custom",
    steps: config.steps,
    params: config.params ?? [],
    author: config.author,
    tags: config.tags,
    createdAt: now,
    updatedAt: now,
  };
  const dir = ensureDir("templates");
  writeJson(join(dir, `${template.id}.json`), template);
  return template;
}

/**
 * UC-D14: Delete a workflow template by ID.
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
  try {
    const dir = ensureDir("templates");
    const path = join(dir, `${templateId}.json`);
    if (!existsSync(path)) return false;
    const { unlinkSync } = await import("node:fs");
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D14: Run a workflow template with optional parameters.
 */
export async function runTemplate(
  templateId: string,
  params?: Record<string, unknown>
): Promise<WorkflowResult> {
  const template = await getTemplate(templateId);
  if (!template) {
    return {
      templateId,
      status: "failed",
      completedSteps: 0,
      totalSteps: 0,
      durationMs: 0,
      outputs: {},
      error: "Template not found",
    };
  }

  const startMs = Date.now();
  let completedSteps = 0;
  const outputs: Record<string, unknown> = {};

  for (const step of template.steps) {
    try {
      // Substitute template params
      const stepParams = JSON.parse(
        JSON.stringify(step.params).replace(
          /\{\{(\w+)\}\}/g,
          (_, key: string) => String(params?.[key] ?? `{{${key}}}`)
        )
      ) as Record<string, unknown>;

      if (step.tool === "shell.exec") {
        const { stdout } = await execAsync(
          stepParams["command"] as string,
          { timeout: 60_000 }
        );
        outputs[step.id] = stdout.trim();
      } else if (step.tool === "app.script") {
        const { stdout } = await execAsync(
          `osascript -e ${JSON.stringify(stepParams["script"] as string)}`
        );
        outputs[step.id] = stdout.trim();
      }
      completedSteps++;
    } catch (err) {
      return {
        templateId,
        status: "failed",
        completedSteps,
        totalSteps: template.steps.length,
        durationMs: Date.now() - startMs,
        outputs,
        error: `Step "${step.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    templateId,
    status: "ok",
    completedSteps,
    totalSteps: template.steps.length,
    durationMs: Date.now() - startMs,
    outputs,
  };
}

/**
 * UC-D14: Export a template to a JSON file path.
 */
export async function shareTemplate(
  templateId: string,
  exportPath: string
): Promise<boolean> {
  try {
    const template = await getTemplate(templateId);
    if (!template) return false;
    writeJson(exportPath, template);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D14: Import a template from a JSON file path.
 */
export async function importTemplate(
  importPath: string
): Promise<WorkflowTemplate> {
  const raw = readJson<WorkflowTemplate>(importPath, null as unknown as WorkflowTemplate);
  if (!raw) throw new Error(`Could not read template from: ${importPath}`);

  // Assign a new ID to avoid collisions
  const template: WorkflowTemplate = {
    ...raw,
    id: generateId("tmpl"),
    updatedAt: new Date().toISOString(),
  };
  const dir = ensureDir("templates");
  writeJson(join(dir, `${template.id}.json`), template);
  return template;
}

// ===========================================================================
// UC-D15: AI-Assisted Debugging
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

/**
 * UC-D15: Analyze an error context using Claude to identify root cause.
 */
export async function analyzeError(
  error: ErrorContext
): Promise<DebugAnalysis> {
  let rootCause = error.message;
  let errorType = "UnknownError";
  let severity: DebugAnalysis["severity"] = "medium";

  try {
    const analysis = await askClaude(
      'You are a debugging expert. Analyze the error and return JSON: {"errorType":"...","rootCause":"...","severity":"low|medium|high|critical"}',
      JSON.stringify(error),
      512
    );
    const parsed = JSON.parse(analysis) as Partial<DebugAnalysis>;
    rootCause = parsed.rootCause ?? rootCause;
    errorType = parsed.errorType ?? errorType;
    severity = parsed.severity ?? severity;
  } catch {
    // Heuristic fallback
    if (error.message.includes("ENOENT")) {
      errorType = "FileNotFound";
      rootCause = "File or directory does not exist";
    } else if (error.message.includes("EACCES")) {
      errorType = "PermissionError";
      rootCause = "Insufficient permissions";
      severity = "high";
    } else if (error.message.includes("ENOMEM")) {
      errorType = "OutOfMemory";
      rootCause = "System is out of memory";
      severity = "critical";
    }
  }

  return {
    errorType,
    rootCause,
    severity,
    context: error,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D15: Analyze a crash log file.
 */
export async function analyzeCrashLog(
  logPath: string
): Promise<CrashAnalysis> {
  let logContent = "";
  try {
    logContent = readFileSync(logPath, "utf-8").slice(0, 8000);
  } catch {
    return {
      logPath,
      summary: "Could not read log file",
      keyEvents: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  // Extract key metadata via regex
  const processMatch = logContent.match(/Process:\s+(.+)/);
  const signalMatch = logContent.match(/Exception Type:\s+(.+)/);
  const dateMatch = logContent.match(/Date\/Time:\s+(.+)/);

  let summary = `Crash in ${processMatch?.[1] ?? "unknown process"}`;
  const keyEvents: string[] = [];

  try {
    const analysis = await askClaude(
      'Analyze this macOS crash log. Return JSON: {"summary":"...","keyEvents":["..."]}',
      logContent.slice(0, 4000),
      512
    );
    const parsed = JSON.parse(analysis) as {
      summary?: string;
      keyEvents?: string[];
    };
    summary = parsed.summary ?? summary;
    if (Array.isArray(parsed.keyEvents)) keyEvents.push(...parsed.keyEvents);
  } catch {
    // Extract key lines heuristically
    const lines = logContent
      .split("\n")
      .filter(
        (l) =>
          l.includes("Exception") ||
          l.includes("SIGSEGV") ||
          l.includes("SIGABRT") ||
          l.includes("Thread") ||
          l.includes("Fatal")
      )
      .slice(0, 5);
    keyEvents.push(...lines);
  }

  return {
    logPath,
    crashedProcess: processMatch?.[1]?.trim(),
    errorSignal: signalMatch?.[1]?.trim(),
    timestamp: dateMatch?.[1]?.trim(),
    summary,
    keyEvents,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D15: Suggest fixes for a debug analysis.
 */
export async function suggestFix(
  analysis: DebugAnalysis
): Promise<FixSuggestion[]> {
  try {
    const raw = await askClaude(
      'You are a fix advisor for macOS. Return JSON array of fix suggestions: [{"id":"...","title":"...","description":"...","command":"...","confidence":0.8,"automated":true}]',
      JSON.stringify(analysis),
      1024
    );
    return JSON.parse(raw) as FixSuggestion[];
  } catch {
    // Heuristic fixes
    const fixes: FixSuggestion[] = [];
    if (analysis.errorType === "FileNotFound") {
      fixes.push({
        id: generateId("fix"),
        title: "Check file path",
        description: "Verify the file path exists",
        command: `ls -la "${analysis.context.filePath ?? "."}"`,
        confidence: 0.9,
        automated: false,
      });
    } else if (analysis.errorType === "PermissionError") {
      fixes.push({
        id: generateId("fix"),
        title: "Fix permissions",
        description: "Reset file permissions",
        command: `chmod 755 "${analysis.context.filePath ?? "."}"`,
        confidence: 0.7,
        automated: true,
      });
    }
    return fixes;
  }
}

/**
 * UC-D15: Apply a fix suggestion, optionally in dry-run mode.
 */
export async function autoFix(
  suggestion: FixSuggestion,
  dryRun: boolean = false
): Promise<FixResult> {
  const startMs = Date.now();
  if (dryRun) {
    return {
      suggestionId: suggestion.id,
      status: "dry-run",
      output: suggestion.command,
      durationMs: 0,
    };
  }
  if (!suggestion.command) {
    return {
      suggestionId: suggestion.id,
      status: "failed",
      error: "No command to execute",
      durationMs: 0,
    };
  }
  try {
    const { stdout, stderr } = await execAsync(suggestion.command, {
      timeout: 30_000,
    });
    return {
      suggestionId: suggestion.id,
      status: "ok",
      output: (stdout + stderr).trim(),
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      suggestionId: suggestion.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
}

/**
 * UC-D15: Collect a debug report for a running process by PID.
 */
export async function debugProcess(pid: number): Promise<DebugReport> {
  const [ps, lsof, threads] = await Promise.allSettled([
    execAsync(
      `ps -p ${pid} -o pid,pcpu,pmem,rss,comm 2>/dev/null`
    ).then((r) => r.stdout.trim().split("\n")[1] ?? ""),
    execAsync(`lsof -p ${pid} 2>/dev/null | head -20`).then((r) =>
      r.stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((l) => l.split(/\s+/).pop() ?? "")
        .filter(Boolean)
    ),
    execAsync(
      `ps -M ${pid} 2>/dev/null | wc -l`
    ).then((r) => parseInt(r.stdout.trim(), 10) - 1),
  ]);

  const psLine =
    ps.status === "fulfilled" ? ps.value.trim().split(/\s+/) : [];
  const processName = psLine[4] ?? "unknown";
  const cpuPercent = parseFloat(psLine[1] ?? "0");
  const memoryMB = Math.round(
    (parseFloat(psLine[3] ?? "0") * 1024) / (1024 * 1024)
  );

  return {
    pid,
    processName,
    status: psLine.length > 0 ? "running" : "not found",
    memoryMB,
    cpuPercent,
    openFiles: lsof.status === "fulfilled" ? lsof.value : [],
    threads: threads.status === "fulfilled" ? threads.value : 0,
    analyzedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// UC-D16: Auto File Labeling & Organization
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

const FILE_CATEGORY_MAP: Record<string, string[]> = {
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

function categorizeByExtension(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  for (const [category, exts] of Object.entries(FILE_CATEGORY_MAP)) {
    if (exts.includes(ext)) return category;
  }
  return "other";
}

/**
 * UC-D16: Classify a single file using extension heuristics + optional Claude analysis.
 */
export async function classifyFile(filePath: string): Promise<FileClassification> {
  const category = categorizeByExtension(filePath);
  const tags: string[] = [category];

  // Suggest folder based on category
  const folderMap: Record<string, string> = {
    image: "~/Pictures",
    video: "~/Movies",
    audio: "~/Music",
    document: "~/Documents",
    code: "~/Developer",
    archive: "~/Downloads/Archives",
    spreadsheet: "~/Documents/Spreadsheets",
    data: "~/Documents/Data",
  };

  return {
    filePath,
    category,
    tags,
    confidence: 0.85,
    suggestedFolder: folderMap[category],
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D16: Classify all files in a directory.
 */
export async function classifyDirectory(
  dirPath: string
): Promise<DirectoryClassification> {
  let files: string[] = [];
  try {
    files = readdirSync(dirPath).filter((f) => {
      try {
        return statSync(join(dirPath, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    files = [];
  }

  const classifications = await Promise.all(
    files.map((f) => classifyFile(join(dirPath, f)))
  );

  const summary: Record<string, number> = {};
  for (const c of classifications) {
    summary[c.category] = (summary[c.category] ?? 0) + 1;
  }

  return {
    dirPath,
    files: classifications,
    summary,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D16: Organize a directory by moving files into categorized sub-folders.
 */
export async function organizeDirectory(
  dirPath: string,
  rules?: OrganizationRules
): Promise<OrganizationResult> {
  const classification = await classifyDirectory(dirPath);
  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const actions: string[] = [];

  for (const file of classification.files) {
    const targetFolder = rules
      ? (() => {
          const ext = extname(file.filePath).toLowerCase();
          const rule = rules.rules.find((r) => ext.match(r.pattern) || file.category === r.pattern);
          return rule?.targetFolder ?? null;
        })()
      : file.suggestedFolder;

    if (!targetFolder) {
      skipped++;
      continue;
    }

    try {
      const expandedTarget = targetFolder.replace(/^~/, homedir());
      if (!existsSync(expandedTarget)) mkdirSync(expandedTarget, { recursive: true });
      const filename = basename(file.filePath);
      const dest = join(expandedTarget, filename);
      if (!existsSync(dest)) {
        await execAsync(`mv "${file.filePath}" "${dest}"`);
        actions.push(`Moved: ${filename} → ${targetFolder}`);
        moved++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  return { dirPath, moved, skipped, failed, actions };
}

/**
 * UC-D16: Suggest an organization plan without executing moves.
 */
export async function suggestOrganization(
  dirPath: string
): Promise<OrganizationPlan> {
  const classification = await classifyDirectory(dirPath);
  const proposedMoves = classification.files
    .filter((f) => f.suggestedFolder)
    .map((f) => ({
      from: f.filePath,
      to: join(
        (f.suggestedFolder ?? "~/Downloads").replace(/^~/, homedir()),
        basename(f.filePath)
      ),
      reason: `File classified as ${f.category}`,
    }));

  return {
    dirPath,
    proposedMoves,
    estimatedFiles: classification.files.length,
  };
}

/**
 * UC-D16: Tag a file using macOS Finder extended attributes (xattr).
 */
export async function tagFile(
  filePath: string,
  tags: string[]
): Promise<boolean> {
  try {
    // Use macOS tag utility or xattr to apply Finder tags
    for (const tag of tags) {
      await execAsync(`tag -a "${tag}" "${filePath}" 2>/dev/null`).catch(
        async () => {
          // Fallback: use xattr directly with Finder tag format
          await execAsync(
            `xattr -w com.apple.metadata:_kMDItemUserTags '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array><string>${tag}</string></array></plist>' "${filePath}"`
          );
        }
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D16: Get macOS Finder tags for a file.
 */
export async function getFileTags(filePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`tag -l "${filePath}" 2>/dev/null`);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^[^\t]+\t/, "").trim());
  } catch {
    return [];
  }
}

// ===========================================================================
// UC-D17: Scheduled Health Reports
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

/**
 * UC-D17: Generate a comprehensive system health report.
 */
export async function generateHealthReport(): Promise<HealthReportDoc> {
  const sections: HealthReportSection[] = [];

  // CPU
  try {
    const { stdout: cpuOut } = await execAsync(
      "ps -eo pcpu --sort=-pcpu | head -6 | tail -5"
    );
    const topCpuValues = cpuOut.trim().split("\n").map(Number);
    const avgCpu = topCpuValues.reduce((a, b) => a + b, 0) / topCpuValues.length;
    sections.push({
      title: "CPU",
      status: avgCpu > 80 ? "critical" : avgCpu > 50 ? "warning" : "ok",
      metrics: { topProcessesCpuAvg: avgCpu.toFixed(1) },
    });
  } catch {
    sections.push({ title: "CPU", status: "warning", metrics: { error: "unavailable" } });
  }

  // Memory
  try {
    const { stdout: vmOut } = await execAsync("vm_stat 2>/dev/null");
    const freeMatch = vmOut.match(/Pages free:\s+(\d+)/);
    const activeMatch = vmOut.match(/Pages active:\s+(\d+)/);
    const freePages = parseInt(freeMatch?.[1] ?? "0", 10);
    const activePages = parseInt(activeMatch?.[1] ?? "0", 10);
    const freeMB = Math.round((freePages * 4096) / 1024 / 1024);
    sections.push({
      title: "Memory",
      status: freeMB < 500 ? "critical" : freeMB < 1000 ? "warning" : "ok",
      metrics: { freeMemoryMB: freeMB, activePages },
    });
  } catch {
    sections.push({ title: "Memory", status: "warning", metrics: { error: "unavailable" } });
  }

  // Disk
  try {
    const { stdout: dfOut } = await execAsync("df -h / 2>/dev/null");
    const dfLine = dfOut.trim().split("\n")[1] ?? "";
    const parts = dfLine.trim().split(/\s+/);
    const usePercent = parseInt((parts[4] ?? "0").replace("%", ""), 10);
    sections.push({
      title: "Disk",
      status: usePercent > 90 ? "critical" : usePercent > 75 ? "warning" : "ok",
      metrics: { usage: parts[4], available: parts[3], filesystem: parts[0] },
    });
  } catch {
    sections.push({ title: "Disk", status: "warning", metrics: { error: "unavailable" } });
  }

  // Network
  try {
    const { stdout: pingOut } = await execAsync("ping -c 1 -t 2 8.8.8.8 2>/dev/null").catch(
      () => ({ stdout: "", stderr: "" })
    );
    sections.push({
      title: "Network",
      status: pingOut.includes("1 packets received") ? "ok" : "warning",
      metrics: { internet: pingOut.includes("1 packets received") ? "reachable" : "unreachable" },
    });
  } catch {
    sections.push({ title: "Network", status: "warning", metrics: { internet: "unreachable" } });
  }

  const hasCritical = sections.some((s) => s.status === "critical");
  const hasWarning = sections.some((s) => s.status === "warning");
  const overall: HealthReportDoc["overall"] = hasCritical
    ? "critical"
    : hasWarning
    ? "degraded"
    : "healthy";

  const recommendations: string[] = [];
  for (const s of sections) {
    if (s.status === "critical") {
      recommendations.push(`${s.title}: Critical — immediate action required`);
    } else if (s.status === "warning") {
      recommendations.push(`${s.title}: Warning — monitor closely`);
    }
  }

  const report: HealthReportDoc = {
    id: generateId("report"),
    generatedAt: new Date().toISOString(),
    period: "current",
    overall,
    sections,
    recommendations,
  };

  const dir = ensureDir("reports");
  writeJson(join(dir, `${report.id}.json`), report);
  return report;
}

/**
 * UC-D17: Schedule a recurring health report. Returns report schedule ID.
 */
export async function scheduleReport(
  cron: string,
  config?: ReportConfig
): Promise<string> {
  const id = generateId("sched");
  const scheduled: ScheduledReport = {
    id,
    cron,
    config: config ?? {},
    createdAt: new Date().toISOString(),
  };
  const dir = ensureDir("schedules");
  writeJson(join(dir, `${id}.json`), scheduled);
  return id;
}

/**
 * UC-D17: Cancel a scheduled health report.
 */
export async function cancelScheduledReport(reportId: string): Promise<boolean> {
  try {
    const dir = ensureDir("schedules");
    const path = join(dir, `${reportId}.json`);
    if (!existsSync(path)) return false;
    const { unlinkSync } = await import("node:fs");
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D17: List all scheduled health reports.
 */
export async function listScheduledReports(): Promise<ScheduledReport[]> {
  try {
    const dir = ensureDir("schedules");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) =>
      readJson<ScheduledReport>(join(dir, f), {} as ScheduledReport)
    );
  } catch {
    return [];
  }
}

/**
 * UC-D17: Send a health report to a channel (currently: write to file, log to stdout).
 */
export async function sendReport(
  report: HealthReportDoc,
  channel: string
): Promise<boolean> {
  try {
    const dir = ensureDir("reports/sent");
    writeJson(join(dir, `${channel}-${report.id}.json`), report);
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D18: Machine/Environment Diff
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

/**
 * UC-D18: Take a snapshot of the current machine state.
 */
export async function snapshotMachine(): Promise<MachineSnapshot> {
  const [apps, brew, npm, hostname, osInfo, disk, mem] = await Promise.allSettled([
    execAsync("ls /Applications 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("brew list --formula 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("npm list -g --depth=0 --json 2>/dev/null")
      .then((r) => Object.keys((JSON.parse(r.stdout) as { dependencies?: Record<string, unknown> }).dependencies ?? {}))
      .catch(() => [] as string[]),
    execAsync("hostname").then((r) => r.stdout.trim()),
    execAsync("sw_vers 2>/dev/null || uname -a").then((r) => r.stdout.trim().split("\n")[0] ?? ""),
    execAsync("df -h / 2>/dev/null").then((r) => r.stdout.trim().split("\n")[1] ?? ""),
    execAsync("sysctl hw.memsize 2>/dev/null || free -b 2>/dev/null").then((r) => {
      const match = r.stdout.match(/(\d+)/);
      return match ? Math.round(parseInt(match[1], 10) / 1024 / 1024 / 1024) : 0;
    }),
  ]);

  const envVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.includes("KEY") && !k.includes("SECRET") && !k.includes("TOKEN") && v) {
      envVars[k] = v;
    }
  }

  const id = generateId("snap");
  const snapshot: MachineSnapshot = {
    id,
    capturedAt: new Date().toISOString(),
    hostname: hostname.status === "fulfilled" ? hostname.value : "unknown",
    os: osInfo.status === "fulfilled" ? osInfo.value : "unknown",
    installedApps: apps.status === "fulfilled" ? apps.value : [],
    brewPackages: brew.status === "fulfilled" ? brew.value : [],
    npmGlobals: npm.status === "fulfilled" ? npm.value : [],
    envVars,
    diskUsage: disk.status === "fulfilled" ? disk.value : "unknown",
    memoryGB: mem.status === "fulfilled" ? mem.value : 0,
  };

  const dir = ensureDir("snapshots");
  writeJson(join(dir, `${id}.json`), snapshot);
  return snapshot;
}

/**
 * UC-D18: Diff two machine snapshots.
 */
export async function diffMachines(
  a: MachineSnapshot,
  b: MachineSnapshot
): Promise<MachineDiff> {
  const setA = new Set(a.installedApps);
  const setB = new Set(b.installedApps);
  const pkgA = new Set(a.brewPackages);
  const pkgB = new Set(b.brewPackages);

  const addedApps = [...setB].filter((x) => !setA.has(x));
  const removedApps = [...setA].filter((x) => !setB.has(x));
  const addedPackages = [...pkgB].filter((x) => !pkgA.has(x));
  const removedPackages = [...pkgA].filter((x) => !pkgB.has(x));

  const changedEnvVars = Object.keys(b.envVars).filter(
    (k) => a.envVars[k] !== b.envVars[k]
  );

  return {
    addedApps,
    removedApps,
    addedPackages,
    removedPackages,
    changedEnvVars,
    summary: `+${addedApps.length} apps, -${removedApps.length} apps, +${addedPackages.length} pkgs, -${removedPackages.length} pkgs`,
    diffedAt: new Date().toISOString(),
  };
}

/**
 * UC-D18: Diff two environment files (e.g. .env.staging vs .env.production).
 */
export async function diffEnvironments(
  envA: string,
  envB: string
): Promise<EnvDiff> {
  const parseEnvFile = (path: string): Record<string, string> => {
    try {
      return Object.fromEntries(
        readFileSync(path, "utf-8")
          .split("\n")
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => {
            const idx = l.indexOf("=");
            return [l.slice(0, idx), l.slice(idx + 1).replace(/^["']|["']$/g, "")];
          })
      );
    } catch {
      return {};
    }
  };

  const a = parseEnvFile(envA);
  const b = parseEnvFile(envB);

  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));

  return {
    envA,
    envB,
    onlyInA: [...keysA].filter((k) => !keysB.has(k)),
    onlyInB: [...keysB].filter((k) => !keysA.has(k)),
    changed: [...keysA]
      .filter((k) => keysB.has(k) && a[k] !== b[k])
      .map((k) => ({ key: k, valueA: a[k] ?? "", valueB: b[k] ?? "" })),
    diffedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// UC-D19: Incident Timeline Reconstruction
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

/**
 * UC-D19: Collect system events from logs between two timestamps.
 */
export async function collectEvents(
  since: Date,
  until: Date = new Date()
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // macOS unified log
  try {
    const sinceStr = since.toISOString().replace("T", " ").replace("Z", "");
    const untilStr = until.toISOString().replace("T", " ").replace("Z", "");
    const { stdout } = await execAsync(
      `log show --start "${sinceStr}" --end "${untilStr}" --style syslog --predicate 'messageType == 16 OR messageType == 17' 2>/dev/null | head -100`,
      { timeout: 15_000 }
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines.slice(0, 50)) {
      const tsMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      events.push({
        id: generateId("evt"),
        timestamp: tsMatch ? new Date(tsMatch[1]).toISOString() : new Date().toISOString(),
        source: "system-log",
        level: line.toLowerCase().includes("error") ? "error" : "info",
        message: line.slice(0, 200),
      });
    }
  } catch {
    // unified log not available, try syslog
  }

  // Fallback: read /var/log/system.log
  try {
    const { stdout: syslog } = await execAsync(
      "tail -100 /var/log/system.log 2>/dev/null"
    );
    const lines = syslog.trim().split("\n").filter(Boolean);
    for (const line of lines.slice(-20)) {
      events.push({
        id: generateId("evt"),
        timestamp: new Date().toISOString(),
        source: "syslog",
        level: line.toLowerCase().includes("error") ? "error" : "info",
        message: line.slice(0, 200),
      });
    }
  } catch {
    // ignore
  }

  return events.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * UC-D19: Build a structured incident timeline from raw events.
 */
export async function buildTimeline(
  events: TimelineEvent[]
): Promise<IncidentTimeline> {
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const start = sorted[0]?.timestamp ?? new Date().toISOString();
  const end = sorted[sorted.length - 1]?.timestamp ?? new Date().toISOString();
  const durationMs = new Date(end).getTime() - new Date(start).getTime();

  return {
    id: generateId("tl"),
    startTime: start,
    endTime: end,
    events: sorted,
    duration: `${Math.round(durationMs / 1000)}s`,
    builtAt: new Date().toISOString(),
  };
}

/**
 * UC-D19: Find the probable root cause of an incident using Claude.
 */
export async function findRootCause(
  timeline: IncidentTimeline
): Promise<RootCauseAnalysis> {
  const errorEvents = timeline.events.filter(
    (e) => e.level === "error" || e.level === "critical"
  );

  let probableCause = "Unknown — insufficient log data";
  let confidence = 0.3;
  const contributingFactors: string[] = [];

  try {
    const analysis = await askClaude(
      'You are an incident analyst. Analyze system events and find the root cause. Return JSON: {"probableCause":"...","confidence":0.8,"contributingFactors":["..."],"timeline":"..."}',
      JSON.stringify({
        totalEvents: timeline.events.length,
        errorEvents: errorEvents.slice(0, 10),
        duration: timeline.duration,
      }),
      512
    );
    const parsed = JSON.parse(analysis) as {
      probableCause?: string;
      confidence?: number;
      contributingFactors?: string[];
    };
    probableCause = parsed.probableCause ?? probableCause;
    confidence = parsed.confidence ?? confidence;
    if (Array.isArray(parsed.contributingFactors)) {
      contributingFactors.push(...parsed.contributingFactors);
    }
  } catch {
    // Heuristic: first error event is often the trigger
    if (errorEvents.length > 0) {
      probableCause = errorEvents[0].message.slice(0, 100);
      confidence = 0.5;
    }
  }

  return {
    timelineId: timeline.id,
    probableCause,
    triggerEvent: errorEvents[0],
    contributingFactors,
    timeline: `${timeline.events.length} events over ${timeline.duration}`,
    confidence,
    analyzedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// UC-D20: Plugin/Extension Management
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

/**
 * UC-D20: List installed browser extensions.
 */
export async function listBrowserExtensions(
  browser: string = "chrome"
): Promise<Extension[]> {
  const results: Extension[] = [];

  try {
    if (browser === "chrome" || browser === "brave") {
      const profileDir = browser === "chrome"
        ? `${homedir()}/Library/Application Support/Google/Chrome/Default/Extensions`
        : `${homedir()}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Extensions`;

      if (existsSync(profileDir)) {
        const dirs = readdirSync(profileDir).filter((d) => {
          try {
            return statSync(join(profileDir, d)).isDirectory();
          } catch {
            return false;
          }
        });

        for (const extId of dirs.slice(0, 30)) {
          const extDir = join(profileDir, extId);
          const versions = readdirSync(extDir);
          for (const ver of versions.slice(0, 1)) {
            const manifestPath = join(extDir, ver, "manifest.json");
            if (existsSync(manifestPath)) {
              const manifest = readJson<{ name?: string; version?: string }>(
                manifestPath,
                {}
              );
              results.push({
                id: extId,
                name: manifest.name ?? extId,
                version: manifest.version,
                browser,
                enabled: true,
              });
            }
          }
        }
      }
    }

    if (browser === "safari") {
      const { stdout } = await execAsync(
        "pluginkit -m -A -D -p com.apple.Safari.extension 2>/dev/null | head -30"
      );
      const lines = stdout.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        results.push({
          id: generateId("ext"),
          name: line.split("(")[0]?.trim() ?? line,
          browser: "safari",
        });
      }
    }
  } catch {
    // ignore
  }

  return results;
}

/**
 * UC-D20: List installed IDE plugins.
 */
export async function listIDEPlugins(ide: string = "vscode"): Promise<Plugin[]> {
  const results: Plugin[] = [];

  try {
    if (ide === "vscode") {
      const { stdout } = await execAsync("code --list-extensions 2>/dev/null");
      const extensions = stdout.trim().split("\n").filter(Boolean);
      for (const ext of extensions) {
        results.push({ id: ext, name: ext, ide: "vscode", enabled: true });
      }
    } else if (ide === "vim") {
      const plugDir = join(homedir(), ".vim/plugged");
      if (existsSync(plugDir)) {
        const plugins = readdirSync(plugDir);
        for (const p of plugins) {
          results.push({ id: p, name: p, ide: "vim" });
        }
      }
    }
  } catch {
    // ignore
  }

  return results;
}

/**
 * UC-D20: List installed shell plugins (zsh/oh-my-zsh, etc.).
 */
export async function listShellPlugins(): Promise<ShellPlugin[]> {
  const results: ShellPlugin[] = [];

  // oh-my-zsh plugins
  const omzPlugins = join(homedir(), ".oh-my-zsh/plugins");
  if (existsSync(omzPlugins)) {
    const plugins = readdirSync(omzPlugins).filter((p) => {
      try {
        return statSync(join(omzPlugins, p)).isDirectory();
      } catch {
        return false;
      }
    });
    results.push(
      ...plugins.map((p) => ({ name: p, manager: "oh-my-zsh", path: join(omzPlugins, p) }))
    );
  }

  // zsh custom plugins
  const zshCustom = join(homedir(), ".oh-my-zsh/custom/plugins");
  if (existsSync(zshCustom)) {
    const custom = readdirSync(zshCustom).filter((p) => {
      try {
        return statSync(join(zshCustom, p)).isDirectory();
      } catch {
        return false;
      }
    });
    results.push(
      ...custom.map((p) => ({ name: p, manager: "oh-my-zsh-custom", path: join(zshCustom, p) }))
    );
  }

  return results;
}

/**
 * UC-D20: Install an extension in a target browser/IDE.
 */
export async function installExtension(
  id: string,
  target: string
): Promise<boolean> {
  try {
    if (target === "vscode") {
      await execAsync(`code --install-extension "${id}" 2>/dev/null`);
      return true;
    }
    // Browser extensions must be installed from stores — open store page
    if (target === "chrome") {
      await execAsync(
        `open "https://chrome.google.com/webstore/detail/${id}"`
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * UC-D20: Remove an extension from a target browser/IDE.
 */
export async function removeExtension(
  id: string,
  target: string
): Promise<boolean> {
  try {
    if (target === "vscode") {
      await execAsync(`code --uninstall-extension "${id}" 2>/dev/null`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * UC-D20: Sync extensions from a source profile to a target profile.
 */
export async function syncExtensions(
  _sourceProfile: string,
  _targetProfile: string
): Promise<SyncResult> {
  // Sync VSCode extensions as the most common use case
  let synced = 0;
  let failed = 0;
  const skipped = 0;

  try {
    const { stdout } = await execAsync("code --list-extensions 2>/dev/null");
    const extensions = stdout.trim().split("\n").filter(Boolean);

    for (const ext of extensions) {
      try {
        await execAsync(`code --install-extension "${ext}" 2>/dev/null`);
        synced++;
      } catch {
        failed++;
      }
    }
  } catch {
    failed++;
  }

  return { synced, failed, skipped };
}

// ===========================================================================
// UC-D21: Local Data Pipeline Automation
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

/**
 * UC-D21: Create a new local data pipeline.
 */
export async function createPipeline(config: PipelineConfig): Promise<Pipeline> {
  const pipeline: Pipeline = {
    id: generateId("pipe"),
    name: config.name,
    description: config.description,
    steps: config.steps,
    schedule: config.schedule,
    createdAt: new Date().toISOString(),
    runCount: 0,
  };
  const dir = ensureDir("pipelines");
  writeJson(join(dir, `${pipeline.id}.json`), pipeline);
  return pipeline;
}

/**
 * UC-D21: Run a pipeline by ID, executing each step sequentially.
 */
export async function runPipeline(pipelineId: string): Promise<PipelineResult> {
  const dir = ensureDir("pipelines");
  const path = join(dir, `${pipelineId}.json`);
  if (!existsSync(path)) {
    return {
      pipelineId,
      status: "failed",
      completedSteps: 0,
      totalSteps: 0,
      durationMs: 0,
      outputs: {},
      error: "Pipeline not found",
    };
  }

  const pipeline = readJson<Pipeline>(path, {} as Pipeline);
  const startMs = Date.now();
  let completedSteps = 0;
  const outputs: Record<string, string> = {};
  let lastOutput = "";

  for (const step of pipeline.steps ?? []) {
    try {
      let cmd = step.command ?? "";
      // Pipe previous output as stdin for transform steps
      if (step.type === "transform" && lastOutput) {
        cmd = `echo ${JSON.stringify(lastOutput)} | ${cmd}`;
      }
      const { stdout } = await execAsync(cmd, { timeout: 60_000 });
      lastOutput = stdout.trim();
      outputs[step.id] = lastOutput.slice(0, 1000);
      completedSteps++;
    } catch (err) {
      pipeline.runCount = (pipeline.runCount ?? 0) + 1;
      pipeline.lastRunAt = new Date().toISOString();
      writeJson(path, pipeline);
      return {
        pipelineId,
        status: "failed",
        completedSteps,
        totalSteps: pipeline.steps.length,
        durationMs: Date.now() - startMs,
        outputs,
        error: `Step "${step.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  pipeline.runCount = (pipeline.runCount ?? 0) + 1;
  pipeline.lastRunAt = new Date().toISOString();
  writeJson(path, pipeline);

  return {
    pipelineId,
    status: "ok",
    completedSteps,
    totalSteps: pipeline.steps.length,
    durationMs: Date.now() - startMs,
    outputs,
  };
}

/**
 * UC-D21: List all defined pipelines.
 */
export async function listPipelines(): Promise<Pipeline[]> {
  try {
    const dir = ensureDir("pipelines");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => readJson<Pipeline>(join(dir, f), {} as Pipeline));
  } catch {
    return [];
  }
}

/**
 * UC-D21: Delete a pipeline by ID.
 */
export async function deletePipeline(pipelineId: string): Promise<boolean> {
  try {
    const dir = ensureDir("pipelines");
    const path = join(dir, `${pipelineId}.json`);
    if (!existsSync(path)) return false;
    const { unlinkSync } = await import("node:fs");
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D22: Compliance/Policy Checking
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

const DEFAULT_POLICIES: CompliancePolicy[] = [
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

/**
 * UC-D22: Run compliance checks against a set of policies.
 */
export async function runComplianceCheck(
  policies?: CompliancePolicy[]
): Promise<ComplianceReport> {
  const activePolices = policies ?? DEFAULT_POLICIES;
  const results: CompliancePolicyResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const policy of activePolices) {
    try {
      const { stdout } = await execAsync(policy.check, { timeout: 10_000 });
      const isPass = stdout.trim().length > 0;
      results.push({
        policyId: policy.id,
        policyName: policy.name,
        status: isPass ? "pass" : "fail",
        output: stdout.trim().slice(0, 200),
        remediation: isPass ? undefined : policy.remediation,
      });
      if (isPass) passed++;
      else failed++;
    } catch {
      results.push({
        policyId: policy.id,
        policyName: policy.name,
        status: "fail",
        remediation: policy.remediation,
      });
      failed++;
    }
  }

  const overall: ComplianceReport["overall"] =
    failed === 0 ? "compliant" : passed === 0 ? "non-compliant" : "partial";

  return {
    id: generateId("compliance"),
    generatedAt: new Date().toISOString(),
    overall,
    passed,
    failed,
    skipped,
    results,
  };
}

/**
 * UC-D22: Get the default compliance policies.
 */
export async function getDefaultPolicies(): Promise<CompliancePolicy[]> {
  return DEFAULT_POLICIES;
}

/**
 * UC-D22: Check disk encryption status via FileVault.
 */
export async function checkEncryption(): Promise<EncryptionStatus> {
  const { stdout } = await execAsync("fdesetup status 2>/dev/null").catch(
    () => ({ stdout: "", stderr: "" })
  );
  const enabled = stdout.toLowerCase().includes("filevault is on");

  const { stdout: diskutil } = await execAsync(
    "diskutil list 2>/dev/null | grep -i 'encrypted'"
  ).catch(() => ({ stdout: "", stderr: "" }));

  return {
    filevaultEnabled: enabled,
    filevaultStatus: stdout.trim() || "unavailable",
    encryptedVolumes: diskutil
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.trim()),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * UC-D22: Check macOS firewall policy status.
 */
export async function checkFirewallPolicy(): Promise<PolicyResult> {
  try {
    const { stdout } = await execAsync(
      "defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null"
    );
    const state = parseInt(stdout.trim(), 10);
    return {
      policy: "firewall",
      compliant: state > 0,
      details:
        state === 0 ? "Firewall disabled" : state === 1 ? "Firewall enabled (standard)" : "Firewall enabled (stealth mode)",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      policy: "firewall",
      compliant: false,
      details: "Could not determine firewall status",
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * UC-D22: Check password policy (login window settings).
 */
export async function checkPasswordPolicy(): Promise<PolicyResult> {
  try {
    const { stdout } = await execAsync(
      "pwpolicy getaccountpolicies 2>/dev/null | head -5"
    );
    return {
      policy: "password",
      compliant: stdout.trim().length > 0,
      details: stdout.trim() || "No password policy configured",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      policy: "password",
      compliant: false,
      details: "Could not retrieve password policy",
      checkedAt: new Date().toISOString(),
    };
  }
}

// ===========================================================================
// UC-D23: Smart Notification Digest
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

/**
 * UC-D23: Collect notifications from available sources.
 */
export async function collectNotifications(
  sources?: string[]
): Promise<Notification[]> {
  const notifications: Notification[] = [];

  // macOS Notification Center via sqlite
  try {
    const dbPath = `${homedir()}/Library/Group Containers/group.com.apple.usernoted/db2/db`;
    if (existsSync(dbPath)) {
      const { stdout } = await execAsync(
        `sqlite3 "${dbPath}" "SELECT app_id, title, subtitle, body, delivered_date FROM record ORDER BY delivered_date DESC LIMIT 50;" 2>/dev/null`,
        { timeout: 5000 }
      );
      const rows = stdout.trim().split("\n").filter(Boolean);
      for (const row of rows.slice(0, 20)) {
        const parts = row.split("|");
        notifications.push({
          id: generateId("notif"),
          source: parts[0] ?? "system",
          title: parts[1] ?? "Notification",
          body: parts[3] ?? undefined,
          timestamp: parts[4]
            ? new Date(
                (parseInt(parts[4], 10) + 978307200) * 1000
              ).toISOString()
            : new Date().toISOString(),
          priority: "medium",
        });
      }
    }
  } catch {
    // sqlite not available or table structure different
  }

  // Fallback: simulate from macOS notification count
  if (notifications.length === 0) {
    notifications.push({
      id: generateId("notif"),
      source: "system",
      title: "No recent notifications",
      timestamp: new Date().toISOString(),
      priority: "low",
    });
  }

  const activeSources = sources ?? ["all"];
  if (!activeSources.includes("all")) {
    return notifications.filter((n) => activeSources.includes(n.source));
  }

  return notifications;
}

/**
 * UC-D23: Generate a digest summary of notifications.
 */
export async function generateDigest(
  notifications: Notification[]
): Promise<NotificationDigest> {
  // Group by source
  const groups = new Map<string, Notification[]>();
  for (const n of notifications) {
    const group = groups.get(n.source) ?? [];
    group.push(n);
    groups.set(n.source, group);
  }

  const digestGroups: NotificationGroup[] = Array.from(groups.entries()).map(
    ([source, notifs]) => ({
      source,
      count: notifs.length,
      latestNotification: notifs[0],
      summary: `${notifs.length} notifications from ${source}`,
    })
  );

  let summary = `${notifications.length} notifications from ${groups.size} apps`;
  try {
    summary = await askClaude(
      "Summarize these notifications in one sentence.",
      JSON.stringify(notifications.slice(0, 10).map((n) => ({ source: n.source, title: n.title }))),
      100
    );
  } catch {
    // use default
  }

  return {
    id: generateId("digest"),
    generatedAt: new Date().toISOString(),
    totalNotifications: notifications.length,
    summary,
    groups: digestGroups,
  };
}

/**
 * UC-D23: Prioritize notifications by urgency and recency.
 */
export async function prioritizeNotifications(
  notifications: Notification[]
): Promise<PrioritizedNotification[]> {
  const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };

  return notifications
    .map((n) => {
      const ageHours =
        (Date.now() - new Date(n.timestamp).getTime()) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 10 - ageHours);
      const priorityScore =
        (priorityWeight[n.priority] ?? 1) * 2 + recencyScore;

      return {
        notification: n,
        priorityScore,
        reason: `Priority: ${n.priority}, Age: ${ageHours.toFixed(1)}h`,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

// ===========================================================================
// UC-D24: Context-Aware Documentation Lookup
// ===========================================================================

export interface DocResult {
  title: string;
  url?: string;
  summary: string;
  relevance: number;
  source: string;
}

/**
 * UC-D24: Look up documentation for a query, optionally using error context.
 */
export async function lookupDocs(
  query: string,
  context?: ErrorContext
): Promise<DocResult[]> {
  const results: DocResult[] = [];

  // Man page check
  try {
    const cmd = query.split(" ")[0] ?? query;
    const manResult = await searchManPages(cmd);
    if (manResult && manResult.length > 50) {
      results.push({
        title: `man ${cmd}`,
        summary: manResult.slice(0, 200),
        relevance: 0.9,
        source: "man",
      });
    }
  } catch {
    // no man page
  }

  // Claude-assisted documentation synthesis
  try {
    const queryWithContext = context
      ? `${query} — Error context: ${context.message}`
      : query;
    const synthesis = await askClaude(
      'You are a documentation assistant for macOS/Unix systems. Provide a concise answer with relevant documentation references. Return JSON array: [{"title":"...","url":"...","summary":"...","relevance":0.9,"source":"..."}]',
      queryWithContext,
      512
    );
    const parsed = JSON.parse(synthesis) as DocResult[];
    if (Array.isArray(parsed)) results.push(...parsed);
  } catch {
    // fallback
  }

  if (results.length === 0) {
    results.push({
      title: query,
      summary: "No documentation found locally. Try: man " + query.split(" ")[0],
      relevance: 0.3,
      source: "fallback",
    });
  }

  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * UC-D24: Search man pages for a command.
 */
export async function searchManPages(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `man "${command}" 2>/dev/null | col -bx | head -50`
    );
    return stdout.trim();
  } catch {
    try {
      // Try whatis as fallback
      const { stdout } = await execAsync(`whatis "${command}" 2>/dev/null`);
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

/**
 * UC-D24: Fetch online documentation for a query.
 */
export async function fetchOnlineDocs(query: string): Promise<DocResult[]> {
  // Use Claude to synthesize documentation from training data
  try {
    const raw = await askClaude(
      'You are a documentation assistant. Provide relevant online documentation references for the query. Return JSON array: [{"title":"...","url":"https://...","summary":"...","relevance":0.9,"source":"online"}]',
      query,
      512
    );
    return JSON.parse(raw) as DocResult[];
  } catch {
    return [
      {
        title: `Search: ${query}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        summary: "No online documentation retrieved — search manually",
        relevance: 0.2,
        source: "online",
      },
    ];
  }
}

// ===========================================================================
// UC-D25: Resource Usage Forecasting
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

/**
 * UC-D25: Get historical usage data for a metric (cpu, memory, disk).
 */
export async function getHistoricalUsage(
  metric: string,
  days: number = 7
): Promise<UsageDataPoint[]> {
  const points: UsageDataPoint[] = [];
  const dir = ensureDir("metrics");
  const logPath = join(dir, `${metric}.jsonl`);

  // Read persisted metrics
  try {
    const raw = readFileSync(logPath, "utf-8");
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const stored = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UsageDataPoint)
      .filter((p) => new Date(p.timestamp).getTime() > cutoff);
    points.push(...stored);
  } catch {
    // No history yet — collect current sample
  }

  // Always add a current sample
  try {
    let value = 0;
    let unit = "";
    switch (metric) {
      case "cpu": {
        const { stdout } = await execAsync(
          "ps -eo pcpu | tail -n +2 | awk '{sum+=$1} END {print sum}' 2>/dev/null"
        );
        value = parseFloat(stdout.trim()) || 0;
        unit = "%";
        break;
      }
      case "memory": {
        const { stdout } = await execAsync("vm_stat 2>/dev/null");
        const freeMatch = stdout.match(/Pages free:\s+(\d+)/);
        const totalPages = 256000; // approximate
        const freePct = ((parseInt(freeMatch?.[1] ?? "0", 10) / totalPages) * 100);
        value = 100 - freePct;
        unit = "%";
        break;
      }
      case "disk": {
        const { stdout } = await execAsync("df -h / 2>/dev/null");
        const line = stdout.trim().split("\n")[1] ?? "";
        const pct = parseInt(line.trim().split(/\s+/)[4] ?? "0", 10);
        value = isNaN(pct) ? 0 : pct;
        unit = "%";
        break;
      }
    }

    const point: UsageDataPoint = {
      timestamp: new Date().toISOString(),
      metric,
      value,
      unit,
    };
    points.push(point);

    // Persist the sample
    const { appendFileSync } = await import("node:fs");
    appendFileSync(logPath, JSON.stringify(point) + "\n", "utf-8");
  } catch {
    // ignore
  }

  return points.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * UC-D25: Forecast future resource usage using linear regression.
 */
export async function forecastUsage(
  metric: string,
  days: number = 7
): Promise<ForecastResult> {
  const historical = await getHistoricalUsage(metric, 30);

  if (historical.length < 2) {
    return {
      metric,
      forecastDays: days,
      trend: "stable",
      predictedValues: [],
      summary: "Insufficient historical data for forecasting",
      generatedAt: new Date().toISOString(),
    };
  }

  // Simple linear regression
  const n = historical.length;
  const xs = historical.map((_, i) => i);
  const ys = historical.map((p) => p.value);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const trend: ForecastResult["trend"] =
    slope > 0.5 ? "increasing" : slope < -0.5 ? "decreasing" : "stable";

  const predictedValues = Array.from({ length: days }, (_, i) => {
    const x = n + i;
    const predicted = Math.min(100, Math.max(0, slope * x + intercept));
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0] ?? new Date().toISOString().split("T")[0] ?? "";
    return {
      date,
      value: Math.round(predicted * 10) / 10,
      confidence: Math.max(0.3, 1 - i * 0.1),
    };
  });

  const lastPredicted = predictedValues[predictedValues.length - 1]?.value ?? 0;

  return {
    metric,
    forecastDays: days,
    trend,
    predictedValues,
    summary: `${metric} is ${trend}. Predicted value in ${days} days: ${lastPredicted.toFixed(1)}${historical[0]?.unit ?? ""}`,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * UC-D25: Predict when disk will be full based on usage trends.
 */
export async function predictDiskFull(): Promise<{
  daysUntilFull: number;
  confidence: number;
}> {
  const forecast = await forecastUsage("disk", 90);

  if (forecast.trend !== "increasing" || forecast.predictedValues.length === 0) {
    return { daysUntilFull: Infinity, confidence: 0.8 };
  }

  const fullDay = forecast.predictedValues.find((p) => p.value >= 95);
  if (!fullDay) {
    return { daysUntilFull: 90, confidence: 0.4 };
  }

  const daysUntilFull = forecast.predictedValues.indexOf(fullDay);
  return { daysUntilFull, confidence: fullDay.confidence };
}

/**
 * UC-D25: Predict when memory will reach critical levels.
 */
export async function predictMemoryExhaustion(): Promise<{
  hoursUntilCritical: number;
  confidence: number;
}> {
  const forecast = await forecastUsage("memory", 7);

  if (forecast.trend !== "increasing" || forecast.predictedValues.length === 0) {
    return { hoursUntilCritical: Infinity, confidence: 0.8 };
  }

  const criticalDay = forecast.predictedValues.find((p) => p.value >= 90);
  if (!criticalDay) {
    return { hoursUntilCritical: 7 * 24, confidence: 0.5 };
  }

  const dayIdx = forecast.predictedValues.indexOf(criticalDay);
  return { hoursUntilCritical: dayIdx * 24, confidence: criticalDay.confidence };
}
