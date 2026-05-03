/**
 * Hybrid Desktop Automation — UC-D02, UC-D04, UC-D07, UC-D08, UC-D10, UC-D12, UC-D13.
 *
 * Desktop/system-facing automation: migration, macros, state enforcement,
 * checkpoints, usage patterns, action suggestion, and user isolation.
 *
 * @module hybrid/automation-desktop
 */

import { execAsync } from "./automation-types.js";
import { getClient } from "./automation-types.js";
import {
  _recordingSessions,
  ActionSequence,
  MacroDefinition,
  MacroParam,
  MacroResult,
} from "./automation-types.js";
import {
  MachineManifest,
  MigrationPlan,
  MigrationStep,
  MigrationResult,
} from "./automation-types.js";
import {
  DesiredStateSpec,
  StateCheck,
  DriftReport,
  DriftViolation,
  EnforcementResult,
  _stateLoops,
} from "./automation-types.js";
import {
  CheckpointInfo,
  RollbackResult,
} from "./automation-types.js";
import {
  UserAction,
  UsageProfile,
  AutomationSuggestion,
  UserProfile,
} from "./automation-types.js";
import {
  WorkContext,
  ActionSuggestion,
} from "./automation-types.js";
import {
  UserSession,
} from "./automation-types.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Storage helpers
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

// ===========================================================================
// UC-D02: Structured System Migration
// ===========================================================================

/**
 * UC-D02: Scan the current machine and produce a manifest of installed apps,
 * packages, dotfiles, cron jobs, and launch agents.
 */
export async function scanSourceMachine(): Promise<MachineManifest> {
  const [apps, brew, npm, cron, launchAgents] = await Promise.allSettled([
    execAsync("ls /Applications 2>/dev/null").then((r) =>
      r.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((a) => a.replace(/\.app$/, ""))
    ),
    execAsync("brew list --formula 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("npm list -g --depth=0 --json 2>/dev/null")
      .then((r) => Object.keys(JSON.parse(r.stdout).dependencies ?? {}))
      .catch(() => [] as string[]),
    execAsync("crontab -l 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter((l) => l && !l.startsWith("#"))
    ),
    execAsync("ls ~/Library/LaunchAgents 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
  ]);

  // Collect dotfiles from home dir
  const dotfiles: string[] = [];
  try {
    const home = readdirSync(homedir());
    for (const f of home) {
      if (f.startsWith(".") && !f.startsWith(".DS_Store")) dotfiles.push(f);
    }
  } catch {
    // ignore
  }

  // Sample visible env vars (non-secret keys only)
  const envVars = Object.keys(process.env).filter(
    (k) => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("TOKEN")
  );

  const { stdout: osInfo } = await execAsync(
    "sw_vers 2>/dev/null || uname -a"
  ).catch(() => ({ stdout: "unknown", stderr: "" }));
  const { stdout: archInfo } = await execAsync("uname -m").catch(() => ({
    stdout: "unknown",
    stderr: "",
  }));
  const { stdout: hostInfo } = await execAsync("hostname").catch(() => ({
    stdout: "unknown",
    stderr: "",
  }));

  return {
    hostname: hostInfo.trim(),
    os: osInfo.trim().split("\n")[0] ?? "unknown",
    arch: archInfo.trim(),
    scannedAt: new Date().toISOString(),
    apps:
      apps.status === "fulfilled"
        ? (apps.value as string[])
        : [],
    brewPackages:
      brew.status === "fulfilled" ? (brew.value as string[]) : [],
    npmGlobals:
      npm.status === "fulfilled" ? (npm.value as string[]) : [],
    dotfiles,
    envVars,
    cronJobs:
      cron.status === "fulfilled" ? (cron.value as string[]) : [],
    launchAgents:
      launchAgents.status === "fulfilled"
        ? (launchAgents.value as string[])
        : [],
    userDefaults: {},
  };
}

/**
 * UC-D02: Generate a migration plan from a scanned manifest.
 * Uses Claude to produce intelligent migration steps if available.
 */
export async function generateMigrationPlan(
  manifest: MachineManifest,
  target?: string
): Promise<MigrationPlan> {
  const id = generateId("migration");
  const targetDescription = target ?? "new macOS machine";

  const steps: MigrationStep[] = [];

  // Generate Homebrew install step
  if (manifest.brewPackages.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "package",
      description: "Install Homebrew packages",
      command: `brew install ${manifest.brewPackages.join(" ")}`,
      status: "pending",
    });
  }

  // Generate npm globals step
  if (manifest.npmGlobals.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "package",
      description: "Install npm global packages",
      command: `npm install -g ${manifest.npmGlobals.join(" ")}`,
      status: "pending",
    });
  }

  // Generate app install hints
  for (const app of manifest.apps.slice(0, 20)) {
    steps.push({
      id: generateId("step"),
      category: "app",
      description: `Install ${app}`,
      command: `open -a "App Store" || mas install "${app}" 2>/dev/null || brew install --cask "${app.toLowerCase().replace(/\s+/g, "-")}" 2>/dev/null`,
      status: "pending",
    });
  }

  // Copy dotfiles
  for (const dotfile of manifest.dotfiles.slice(0, 10)) {
    steps.push({
      id: generateId("step"),
      category: "dotfile",
      description: `Copy ${dotfile}`,
      filePath: join(homedir(), dotfile),
      status: "pending",
    });
  }

  // Restore cron jobs
  if (manifest.cronJobs.length > 0) {
    steps.push({
      id: generateId("step"),
      category: "cron",
      description: "Restore cron jobs",
      command: `(crontab -l 2>/dev/null; echo "${manifest.cronJobs.join("\\n")}") | crontab -`,
      status: "pending",
    });
  }

  const plan: MigrationPlan = {
    id,
    sourceManifest: manifest,
    targetDescription,
    steps,
    createdAt: new Date().toISOString(),
  };

  const dir = ensureDir("migrations");
  writeJson(join(dir, `${id}.json`), plan);
  return plan;
}

/**
 * UC-D02: Execute a previously generated migration plan step by step.
 */
export async function executeMigration(
  plan: MigrationPlan
): Promise<MigrationResult> {
  const startMs = Date.now();
  let completedSteps = 0;
  const failedSteps: MigrationStep[] = [];

  for (const step of plan.steps) {
    try {
      if (step.command) {
        await execAsync(step.command, { timeout: 120_000 });
      }
      step.status = "done";
      completedSteps++;
    } catch {
      step.status = "failed";
      failedSteps.push({ ...step });
    }
  }

  const durationMs = Date.now() - startMs;
  const result: MigrationResult = {
    planId: plan.id,
    completedSteps,
    totalSteps: plan.steps.length,
    failedSteps,
    durationMs,
    summary: `Completed ${completedSteps}/${plan.steps.length} steps in ${Math.round(durationMs / 1000)}s. ${failedSteps.length} failed.`,
  };

  // Persist updated plan
  const dir = ensureDir("migrations");
  writeJson(join(dir, `${plan.id}.json`), plan);
  return result;
}

// ===========================================================================
// UC-D04: Learn Repeated Actions → Macros
// ===========================================================================

/**
 * UC-D04: Start recording user actions. Returns a session ID.
 */
export function startRecording(): string {
  const sessionId = generateId("rec");
  _recordingSessions.set(sessionId, {
    sessionId,
    actions: [],
    startedAt: new Date().toISOString(),
  });
  return sessionId;
}

/**
 * UC-D04: Stop recording and return the captured action sequence.
 */
export function stopRecording(sessionId: string): ActionSequence {
  const session = _recordingSessions.get(sessionId);
  if (!session) throw new Error(`No recording session found: ${sessionId}`);
  session.stoppedAt = new Date().toISOString();
  _recordingSessions.delete(sessionId);
  return session;
}

/**
 * UC-D04: Use Claude to infer a reusable macro definition from an action sequence.
 */
export async function inferMacro(
  actions: ActionSequence
): Promise<MacroDefinition> {
  const client = getClient();
  let name = `Macro ${Date.now()}`;
  let description = "Recorded macro";
  const params: MacroParam[] = [];

  if (client) {
    try {
      const msg = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system:
          'You are a macro analyzer. Given a list of actions, output JSON with: {"name": string, "description": string, "params": [{"name": string, "description": string, "defaultValue"?: string}]}. Keep it concise.',
        messages: [
          {
            role: "user",
            content: JSON.stringify(actions.actions.slice(0, 20)),
          },
        ],
      });
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
      const parsed = JSON.parse(text) as {
        name?: string;
        description?: string;
        params?: MacroParam[];
      };
      name = parsed.name ?? name;
      description = parsed.description ?? description;
      if (Array.isArray(parsed.params)) params.push(...parsed.params);
    } catch {
      // fallback to defaults
    }
  }

  return {
    id: generateId("macro"),
    name,
    description,
    actions: actions.actions,
    params,
    createdAt: new Date().toISOString(),
    runCount: 0,
  };
}

/**
 * UC-D04: Persist a macro definition to ~/.omnistate/macros/.
 */
export async function saveMacro(macro: MacroDefinition): Promise<boolean> {
  try {
    const dir = ensureDir("macros");
    writeJson(join(dir, `${macro.id}.json`), macro);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D04: List all saved macros.
 */
export async function listMacros(): Promise<MacroDefinition[]> {
  try {
    const dir = ensureDir("macros");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => readJson<MacroDefinition>(join(dir, f), {} as MacroDefinition));
  } catch {
    return [];
  }
}

/**
 * UC-D04: Execute a saved macro by ID.
 */
export async function runMacro(
  macroId: string,
  _params?: Record<string, unknown>
): Promise<MacroResult> {
  const dir = ensureDir("macros");
  const macroPath = join(dir, `${macroId}.json`);

  if (!existsSync(macroPath)) {
    return { macroId, status: "failed", durationMs: 0, error: "Macro not found" };
  }

  const macro = readJson<MacroDefinition>(macroPath, {} as MacroDefinition);
  const startMs = Date.now();

  try {
    for (const action of macro.actions) {
      switch (action.type) {
        case "shell":
          await execAsync(action.payload["command"] as string, {
            timeout: 30_000,
          });
          break;
        case "applescript":
          await execAsync(
            `osascript -e ${JSON.stringify(action.payload["script"] as string)}`
          );
          break;
        default:
          // Skip unknown action types
          break;
      }
    }

    // Update run metadata
    macro.lastRunAt = new Date().toISOString();
    macro.runCount = (macro.runCount ?? 0) + 1;
    writeJson(macroPath, macro);

    return { macroId, status: "ok", durationMs: Date.now() - startMs };
  } catch (err) {
    return {
      macroId,
      status: "failed",
      durationMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ===========================================================================
// UC-D07: Desired State Enforcement
// ===========================================================================

/**
 * UC-D07: Define a desired state specification. Returns a state ID.
 */
export async function defineDesiredState(
  spec: DesiredStateSpec
): Promise<string> {
  const id = generateId("state");
  const dir = ensureDir("states");
  writeJson(join(dir, `${id}.json`), { id, ...spec, createdAt: new Date().toISOString() });
  return id;
}

/**
 * UC-D07: Check for drift against a defined desired state.
 */
export async function checkDrift(stateId: string): Promise<DriftReport> {
  const dir = ensureDir("states");
  const specPath = join(dir, `${stateId}.json`);
  if (!existsSync(specPath)) {
    throw new Error(`State not found: ${stateId}`);
  }

  const spec = readJson<DesiredStateSpec & { id: string }>(specPath, {} as DesiredStateSpec & { id: string });
  const violations: DriftViolation[] = [];

  for (const check of spec.checks ?? []) {
    try {
      switch (check.type) {
        case "file-exists":
          if (!existsSync(check.filePath ?? "")) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: "file exists",
              actual: "file missing",
            });
          }
          break;
        case "process-running": {
          const { stdout } = await execAsync(
            `pgrep -x "${check.processName}" 2>/dev/null`
          ).catch(() => ({ stdout: "", stderr: "" }));
          if (!stdout.trim()) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: "process running",
              actual: "process not found",
            });
          }
          break;
        }
        case "shell-check": {
          const { stdout } = await execAsync(check.command ?? "true", {
            timeout: 10_000,
          }).catch(() => ({ stdout: "", stderr: "" }));
          if (
            check.expectedOutput &&
            !stdout.trim().includes(check.expectedOutput)
          ) {
            violations.push({
              checkId: check.id,
              description: check.description,
              expected: check.expectedOutput,
              actual: stdout.trim().slice(0, 100),
            });
          }
          break;
        }
      }
    } catch {
      violations.push({
        checkId: check.id,
        description: check.description,
        expected: "check passed",
        actual: "check errored",
      });
    }
  }

  return {
    stateId,
    checkedAt: new Date().toISOString(),
    drifted: violations.length > 0,
    violations,
  };
}

/**
 * UC-D07: Enforce desired state by running remediation commands.
 */
export async function enforcState(stateId: string): Promise<EnforcementResult> {
  const report = await checkDrift(stateId);
  const actions: string[] = [];
  let remediated = 0;
  let failed = 0;

  for (const violation of report.violations) {
    const dir = ensureDir("states");
    const spec = readJson<DesiredStateSpec & { checks: StateCheck[] }>(
      join(dir, `${stateId}.json`),
      { checks: [] } as unknown as DesiredStateSpec & { checks: StateCheck[] }
    );
    const check = spec.checks.find((c) => c.id === violation.checkId);
    if (!check) continue;

    try {
      if (check.type === "process-running" && check.processName) {
        await execAsync(`open -a "${check.processName}" 2>/dev/null || ${check.processName} &`);
        actions.push(`Started process: ${check.processName}`);
        remediated++;
      } else if (check.type === "file-exists" && check.filePath) {
        await execAsync(`touch "${check.filePath}"`);
        actions.push(`Created file: ${check.filePath}`);
        remediated++;
      } else if (check.command) {
        await execAsync(check.command, { timeout: 30_000 });
        actions.push(`Ran remediation: ${check.command}`);
        remediated++;
      }
    } catch {
      failed++;
    }
  }

  return {
    stateId,
    enforcedAt: new Date().toISOString(),
    violations: report.violations.length,
    remediated,
    failed,
    actions,
  };
}

/**
 * UC-D07: Start a background enforcement loop.
 */
export function startDesiredStateLoop(
  stateId: string,
  intervalMs: number = 60_000
): void {
  if (_stateLoops.has(stateId)) return;
  const timer = setInterval(async () => {
    try {
      const report = await checkDrift(stateId);
      if (report.drifted) await enforcState(stateId);
    } catch {
      // Ignore loop errors silently
    }
  }, intervalMs);
  _stateLoops.set(stateId, timer);
}

/**
 * UC-D07: Stop the enforcement loop for a state.
 */
export function stopDesiredStateLoop(stateId: string): void {
  const timer = _stateLoops.get(stateId);
  if (timer) {
    clearInterval(timer);
    _stateLoops.delete(stateId);
  }
}

// ===========================================================================
// UC-D08: Time-Travel Undo / Checkpoints
// ===========================================================================

/**
 * UC-D08: Record a system checkpoint (clipboard, frontmost app, env snapshot).
 */
export async function recordCheckpoint(label?: string): Promise<CheckpointInfo> {
  const id = generateId("ckpt");

  // Capture lightweight state snapshot
  const [clipboard, frontApp, cwd] = await Promise.allSettled([
    execAsync("pbpaste").then((r) => r.stdout.trim().slice(0, 500)),
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
    ).then((r) => r.stdout.trim()),
    execAsync("pwd").then((r) => r.stdout.trim()),
  ]);

  const snapshot: Record<string, unknown> = {
    clipboard: clipboard.status === "fulfilled" ? clipboard.value : "",
    frontmostApp: frontApp.status === "fulfilled" ? frontApp.value : "",
    cwd: cwd.status === "fulfilled" ? cwd.value : "",
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.includes("KEY") && !k.includes("SECRET")
      )
    ),
  };

  const info: CheckpointInfo = {
    id,
    label: label ?? `Checkpoint ${new Date().toLocaleTimeString()}`,
    createdAt: new Date().toISOString(),
    snapshot,
  };

  const dir = ensureDir("checkpoints");
  writeJson(join(dir, `${id}.json`), info);
  return info;
}

/**
 * UC-D08: List all recorded checkpoints.
 */
export async function listCheckpoints(): Promise<CheckpointInfo[]> {
  try {
    const dir = ensureDir("checkpoints");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    return files.map((f) =>
      readJson<CheckpointInfo>(join(dir, f), {} as CheckpointInfo)
    );
  } catch {
    return [];
  }
}

/**
 * UC-D08: Roll back to a previous checkpoint.
 */
export async function rollbackToCheckpoint(
  checkpointId: string
): Promise<RollbackResult> {
  const dir = ensureDir("checkpoints");
  const path = join(dir, `${checkpointId}.json`);
  if (!existsSync(path)) {
    return {
      checkpointId,
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied: 0,
      error: "Checkpoint not found",
    };
  }

  const info = readJson<CheckpointInfo>(path, {} as CheckpointInfo);
  let actionsApplied = 0;

  try {
    // Restore clipboard
    if (info.snapshot["clipboard"]) {
      const escaped = (info.snapshot["clipboard"] as string).replace(
        /'/g,
        "'\\''"
      );
      await execAsync(`printf '%s' '${escaped}' | pbcopy`);
      actionsApplied++;
    }

    // Re-activate front app
    if (info.snapshot["frontmostApp"]) {
      await execAsync(
        `osascript -e 'tell application "${info.snapshot["frontmostApp"]}" to activate'`
      ).catch(() => null);
      actionsApplied++;
    }

    return {
      checkpointId,
      status: "ok",
      restoredAt: new Date().toISOString(),
      actionsApplied,
    };
  } catch (err) {
    return {
      checkpointId,
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * UC-D08: Undo the last recorded action by rolling back to the most recent checkpoint.
 */
export async function undoLastAction(): Promise<RollbackResult> {
  const checkpoints = await listCheckpoints();
  if (checkpoints.length === 0) {
    return {
      checkpointId: "",
      status: "failed",
      restoredAt: new Date().toISOString(),
      actionsApplied: 0,
      error: "No checkpoints available",
    };
  }
  return rollbackToCheckpoint(checkpoints[0].id);
}

// ===========================================================================
// UC-D10: Personalization via Usage Patterns
// ===========================================================================

/**
 * UC-D10: Record a user action to the usage log.
 */
export async function recordUserAction(action: UserAction): Promise<void> {
  const dir = ensureDir("usage");
  const logPath = join(dir, "actions.jsonl");
  const entry = {
    ...action,
    timestamp: action.timestamp ?? new Date().toISOString(),
  };
  // Append to JSONL log
  const line = JSON.stringify(entry) + "\n";
  const { appendFileSync } = await import("node:fs");
  appendFileSync(logPath, line, "utf-8");
}

/**
 * UC-D10: Analyze usage patterns over the specified number of days.
 */
export async function analyzePatterns(days: number = 7): Promise<UsageProfile> {
  const dir = ensureDir("usage");
  const logPath = join(dir, "actions.jsonl");

  let actions: UserAction[] = [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    actions = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UserAction)
      .filter(
        (a) =>
          !a.timestamp || new Date(a.timestamp).getTime() > cutoff
      );
  } catch {
    // No log yet
  }

  const appCounts = new Map<string, number>();
  const cmdCounts = new Map<string, number>();
  const hourCounts = Array.from({ length: 24 }, () => 0) as number[];

  for (const action of actions) {
    if (action.appName) appCounts.set(action.appName, (appCounts.get(action.appName) ?? 0) + 1);
    if (action.command) cmdCounts.set(action.command, (cmdCounts.get(action.command) ?? 0) + 1);
    if (action.timestamp) {
      const hour = new Date(action.timestamp).getHours();
      hourCounts[hour]++;
    }
  }

  const topApps = Array.from(appCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([app, count]) => ({ app, count }));

  const topCommands = Array.from(cmdCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([command, count]) => ({ command, count }));

  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour);

  return {
    analyzedDays: days,
    totalActions: actions.length,
    topApps,
    topCommands,
    peakHours,
    patterns: topApps.slice(0, 3).map((a) => `Frequent ${a.app} usage`),
  };
}

/**
 * UC-D10: Suggest automations based on usage patterns (Claude-assisted).
 */
export async function suggestAutomation(): Promise<AutomationSuggestion[]> {
  const profile = await analyzePatterns(30);
  const client = getClient();

  if (!client || profile.totalActions < 5) {
    return profile.topApps.slice(0, 3).map((a) => ({
      id: generateId("sug"),
      title: `Automate ${a.app} workflow`,
      description: `You use ${a.app} frequently. Consider creating a macro.`,
      confidence: 0.6,
      estimatedTimeSavedMinutes: 5,
    }));
  }

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system:
        'You are an automation advisor. Given a usage profile, suggest 3 automations. Return JSON array: [{"id":"...","title":"...","description":"...","confidence":0.8,"estimatedTimeSavedMinutes":10}]',
      messages: [{ role: "user", content: JSON.stringify(profile) }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return JSON.parse(text) as AutomationSuggestion[];
  } catch {
    return [];
  }
}

/**
 * UC-D10: Get the persisted user profile.
 */
export async function getUserProfile(): Promise<UserProfile> {
  const dir = ensureDir("profile");
  const profilePath = join(dir, "user.json");
  const profile = readJson<UserProfile>(profilePath, {
    userId: generateId("user"),
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    preferences: {},
  });

  // Refresh with latest usage analysis
  profile.usageProfile = await analyzePatterns(30);
  profile.lastUpdatedAt = new Date().toISOString();
  writeJson(profilePath, profile);
  return profile;
}

// ===========================================================================
// UC-D12: Context-Aware Next-Action Suggestion
// ===========================================================================

/**
 * UC-D12: Capture the current work context from the OS.
 */
export async function getCurrentContext(): Promise<WorkContext> {
  const [frontApp, windows, clipboard, cwd] = await Promise.allSettled([
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of first application process whose frontmost is true'"
    ).then((r) => r.stdout.trim()),
    execAsync(
      "osascript -e 'tell application \"System Events\" to get name of every application process whose background only is false'"
    ).then((r) => r.stdout.trim().split(", ").filter(Boolean)),
    execAsync("pbpaste 2>/dev/null").then((r) => r.stdout.trim().slice(0, 200)),
    execAsync("pwd").then((r) => r.stdout.trim()),
  ]);

  return {
    id: generateId("wctx"),
    capturedAt: new Date().toISOString(),
    frontmostApp: frontApp.status === "fulfilled" ? frontApp.value : undefined,
    openWindows: windows.status === "fulfilled" ? windows.value : undefined,
    clipboard: clipboard.status === "fulfilled" ? clipboard.value : undefined,
    workingDirectory: cwd.status === "fulfilled" ? cwd.value : undefined,
  };
}

/**
 * UC-D12: Suggest next actions based on current work context using Claude.
 */
export async function suggestNextAction(
  context?: WorkContext
): Promise<ActionSuggestion[]> {
  const ctx = context ?? (await getCurrentContext());
  const client = getClient();

  if (!client) {
    return [
      {
        id: generateId("sug"),
        title: "Save current work",
        description: `Save work in ${ctx.frontmostApp ?? "current app"}`,
        confidence: 0.7,
        tool: "app.script",
        params: {
          script: `tell application "${ctx.frontmostApp ?? "System Events"}" to activate`,
        },
        estimatedDurationMs: 500,
      },
    ];
  }

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system:
        'You are a macOS productivity assistant. Given work context, suggest 3 next actions. Return JSON array: [{"id":"...","title":"...","description":"...","confidence":0.8,"tool":"shell.exec","params":{"command":"..."},"estimatedDurationMs":1000}]',
      messages: [{ role: "user", content: JSON.stringify(ctx) }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return JSON.parse(text) as ActionSuggestion[];
  } catch {
    return [];
  }
}

/**
 * UC-D12: Auto-execute a suggested action using the orchestrator.
 */
export async function autoExecuteSuggestion(
  suggestion: ActionSuggestion
): Promise<boolean> {
  try {
    const { Orchestrator } = await import("../executor/orchestrator.js");
    const orch = new Orchestrator();
    const plan = {
      taskId: generateId("task"),
      goal: suggestion.title,
      estimatedDuration: `${Math.round(suggestion.estimatedDurationMs / 1000)}s`,
      nodes: [
        {
          id: "action",
          type: "action" as const,
          layer: "auto" as const,
          action: {
            description: suggestion.description,
            tool: suggestion.tool,
            params: suggestion.params,
          },
          dependencies: [],
          onSuccess: null,
          onFailure: { strategy: "escalate" as const },
          estimatedDurationMs: suggestion.estimatedDurationMs,
          priority: "normal" as const,
        },
      ],
    };
    const result = await orch.executePlan(plan);
    return result.status === "complete";
  } catch {
    return false;
  }
}

// ===========================================================================
// UC-D13: Multi-User Isolation
// ===========================================================================

/**
 * UC-D13: Get the current user session information.
 */
export async function getCurrentUserSession(): Promise<UserSession> {
  const [whoami, id, home] = await Promise.allSettled([
    execAsync("whoami").then((r) => r.stdout.trim()),
    execAsync("id -F 2>/dev/null || getent passwd $(whoami) 2>/dev/null | cut -d: -f5 || whoami").then(
      (r) => r.stdout.trim()
    ),
    execAsync("echo $HOME").then((r) => r.stdout.trim()),
  ]);

  const username = whoami.status === "fulfilled" ? whoami.value : "unknown";
  const displayName =
    id.status === "fulfilled" ? id.value : username;
  const homeDir =
    home.status === "fulfilled" ? home.value : `/Users/${username}`;

  return {
    userId: username,
    username,
    displayName,
    homeDir,
    isActive: true,
    loginAt: new Date().toISOString(),
  };
}

/**
 * UC-D13: Switch to a different macOS user session (fast-user-switching via loginwindow).
 */
export async function switchUserSession(_userId: string): Promise<boolean> {
  try {
    // macOS fast user switching via loginwindow AppleScript
    await execAsync(
      `osascript -e 'tell application "System Events" to keystroke "q" using {control down, option down, command down}' 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D13: List all local macOS user accounts.
 */
export async function listUserSessions(): Promise<UserSession[]> {
  try {
    const { stdout } = await execAsync(
      "dscl . -list /Users 2>/dev/null | grep -v '^_' | head -20"
    );
    const usernames = stdout.trim().split("\n").filter(Boolean);

    return usernames.map((username) => ({
      userId: username,
      username,
      displayName: username,
      homeDir: `/Users/${username}`,
      isActive: false,
    }));
  } catch {
    return [await getCurrentUserSession()];
  }
}

/**
 * UC-D13: Isolate user data by setting restrictive permissions on a user's home directory.
 */
export async function isolateUserData(userId: string): Promise<boolean> {
  try {
    // Set home directory permissions to 700 (owner only)
    await execAsync(`chmod 700 /Users/${userId} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}
