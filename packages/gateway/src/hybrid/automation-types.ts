/**
 * Hybrid Automation Types — UC-D02 through UC-D13.
 *
 * All interfaces and shared types for automation module.
 *
 * @module hybrid/automation-types
 */

import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Shared utilities (re-exported from automation.ts)
// ---------------------------------------------------------------------------

export const execAsync = promisify(exec);
export const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Anthropic client (lazy singleton)
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

// ===========================================================================
// UC-D02: Structured System Migration
// ===========================================================================

export interface MachineManifest {
  hostname: string;
  os: string;
  arch: string;
  scannedAt: string;
  apps: string[];
  brewPackages: string[];
  npmGlobals: string[];
  dotfiles: string[];
  envVars: string[];
  cronJobs: string[];
  launchAgents: string[];
  userDefaults: Record<string, string>;
}

export interface MigrationPlan {
  id: string;
  sourceManifest: MachineManifest;
  targetDescription: string;
  steps: MigrationStep[];
  createdAt: string;
}

export interface MigrationStep {
  id: string;
  category: "app" | "package" | "dotfile" | "config" | "cron";
  description: string;
  command?: string;
  filePath?: string;
  content?: string;
  status: "pending" | "done" | "failed" | "skipped";
}

export interface MigrationResult {
  planId: string;
  completedSteps: number;
  totalSteps: number;
  failedSteps: MigrationStep[];
  durationMs: number;
  summary: string;
}

// ===========================================================================
// UC-D03: Voice Control Pipeline
// ===========================================================================

export interface TranscriptionResult {
  text: string;
  confidence: number;
  durationMs: number;
  provider: string;
}

export interface VoiceCommandResult {
  transcription: TranscriptionResult;
  intent: string;
  executed: boolean;
  output?: string;
  error?: string;
}

// ===========================================================================
// UC-D04: Learn Repeated Actions → Macros
// ===========================================================================

export interface ActionSequence {
  sessionId: string;
  actions: RecordedAction[];
  startedAt: string;
  stoppedAt?: string;
}

export interface RecordedAction {
  timestamp: string;
  type: "shell" | "applescript" | "keypress" | "click" | "type" | "custom";
  payload: Record<string, unknown>;
}

export interface MacroDefinition {
  id: string;
  name: string;
  description: string;
  actions: RecordedAction[];
  params: MacroParam[];
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface MacroParam {
  name: string;
  description: string;
  defaultValue?: string;
}

export interface MacroResult {
  macroId: string;
  status: "ok" | "failed";
  durationMs: number;
  error?: string;
  output?: unknown;
}

export const _recordingSessions = new Map<string, ActionSequence>();

// ===========================================================================
// UC-D05: Multi-App Orchestration
// ===========================================================================

export interface AppContext {
  appName: string;
  windowTitle?: string;
  elementQuery?: string;
}

export interface DataPayload {
  type: "text" | "file" | "url" | "json";
  content: string;
}

export interface AppWorkflow {
  id?: string;
  steps: AppWorkflowStep[];
}

export interface AppWorkflowStep {
  app: string;
  action: "activate" | "copy" | "paste" | "type" | "run-script";
  params: Record<string, unknown>;
}

export interface WorkflowResult {
  workflowId: string;
  status: "ok" | "failed";
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  error?: string;
}

// ===========================================================================
// UC-D06: Remote Control Bridge
// ===========================================================================

export interface RemoteBridgeConfig {
  port?: number;
  host?: string;
  authToken?: string;
  allowShell?: boolean;
  protocol?: "ws" | "http";
}

export interface RemoteBridge {
  id: string;
  config: RemoteBridgeConfig;
  status: "active" | "closed";
  startedAt: string;
  port: number;
}

export interface RemoteCommand {
  id: string;
  bridgeId?: string;
  authToken?: string;
  type: "shell" | "applescript" | "plan";
  payload: Record<string, unknown>;
}

export interface RemoteResult {
  commandId: string;
  status: "ok" | "failed";
  output?: unknown;
  error?: string;
  durationMs: number;
}

export const _remoteBridges = new Map<string, RemoteBridge>();

// ===========================================================================
// UC-D07: Desired State Enforcement
// ===========================================================================

export interface DesiredStateSpec {
  name: string;
  description?: string;
  checks: StateCheck[];
}

export interface StateCheck {
  id: string;
  type: "file-exists" | "process-running" | "shell-check" | "pref-check";
  description: string;
  command?: string;
  filePath?: string;
  processName?: string;
  expectedOutput?: string;
}

export interface DriftReport {
  stateId: string;
  checkedAt: string;
  drifted: boolean;
  violations: DriftViolation[];
}

export interface DriftViolation {
  checkId: string;
  description: string;
  expected: string;
  actual: string;
}

export interface EnforcementResult {
  stateId: string;
  enforcedAt: string;
  violations: number;
  remediated: number;
  failed: number;
  actions: string[];
}

export const _stateLoops = new Map<string, NodeJS.Timeout>();

// ===========================================================================
// UC-D08: Time-Travel Undo / Checkpoints
// ===========================================================================

export interface CheckpointInfo {
  id: string;
  label: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export interface RollbackResult {
  checkpointId: string;
  status: "ok" | "failed";
  restoredAt: string;
  actionsApplied: number;
  error?: string;
}

// ===========================================================================
// UC-D09: Cross-Device Context Handoff
// ===========================================================================

export interface ContextPackage {
  id: string;
  sourceDevice: string;
  createdAt: string;
  clipboard?: string;
  openFiles?: string[];
  workingDirectory?: string;
  openApps?: string[];
  notes?: string;
}

// ===========================================================================
// UC-D10: Personalization via Usage Patterns
// ===========================================================================

export interface UserAction {
  timestamp?: string;
  type: string;
  appName?: string;
  command?: string;
  description?: string;
  durationMs?: number;
}

export interface UsageProfile {
  analyzedDays: number;
  totalActions: number;
  topApps: Array<{ app: string; count: number }>;
  topCommands: Array<{ command: string; count: number }>;
  peakHours: number[];
  patterns: string[];
}

export interface AutomationSuggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  estimatedTimeSavedMinutes: number;
}

export interface UserProfile {
  userId: string;
  createdAt: string;
  lastUpdatedAt: string;
  usageProfile?: UsageProfile;
  preferences: Record<string, unknown>;
}

// ===========================================================================
// UC-D11: NL → Script Generation
// ===========================================================================

export interface GeneratedScript {
  id: string;
  description: string;
  language: "bash" | "python" | "applescript" | "jxa";
  code: string;
  generatedAt: string;
  filePath?: string;
}

export interface ScriptResult {
  scriptId: string;
  status: "ok" | "failed" | "dry-run";
  output?: string;
  error?: string;
  durationMs: number;
}

export const QUICK_ACTIONS: Record<string, { type: "applescript" | "jxa"; code: string }> = {
  "dark-mode-on": {
    type: "applescript",
    code: `tell application "System Events" to tell appearance preferences to set dark mode to true`,
  },
  "dark-mode-off": {
    type: "applescript",
    code: `tell application "System Events" to tell appearance preferences to set dark mode to false`,
  },
  "dark-mode-toggle": {
    type: "applescript",
    code: `tell application "System Events" to tell appearance preferences to set dark mode to not dark mode`,
  },
  "volume-up": {
    type: "applescript",
    code: `set volume output volume (output volume of (get volume settings)) + 10`,
  },
  "volume-down": {
    type: "applescript",
    code: `set volume output volume (output volume of (get volume settings)) - 10`,
  },
  "volume-mute": {
    type: "applescript",
    code: `set volume with output muted`,
  },
  "volume-unmute": {
    type: "applescript",
    code: `set volume without output muted`,
  },
  "do-not-disturb-on": {
    type: "jxa",
    code: `Application("System Events").processes["Control Center"].menuBars[0].menuBarItems["Control Center"].click(); delay(0.5); Application("System Events").processes["Control Center"].windows[0].checkBoxes.whose({ name: "Focus" })[0].click();`,
  },
  "do-not-disturb-off": {
    type: "jxa",
    code: `Application("System Events").processes["Control Center"].menuBars[0].menuBarItems["Control Center"].click(); delay(0.5); Application("System Events").processes["Control Center"].windows[0].checkBoxes.whose({ name: "Focus" })[0].click();`,
  },
};

// ===========================================================================
// UC-D12: Context-Aware Next-Action Suggestion
// ===========================================================================

export interface WorkContext {
  id: string;
  capturedAt: string;
  frontmostApp?: string;
  openWindows?: string[];
  clipboard?: string;
  recentCommands?: string[];
  workingDirectory?: string;
}

export interface ActionSuggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  tool: string;
  params: Record<string, unknown>;
  estimatedDurationMs: number;
}

// ===========================================================================
// UC-D13: Multi-User Isolation
// ===========================================================================

export interface UserSession {
  userId: string;
  username: string;
  displayName: string;
  homeDir: string;
  isActive: boolean;
  loginAt?: string;
}
