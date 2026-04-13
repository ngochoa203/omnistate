/**
 * Permission Auto-Responder — watches for permission dialogs and responds
 * to them automatically based on an approval policy.
 *
 * Two classes are exported:
 *
 *   PermissionResponder — handles any GUI permission dialog (macOS system sheets,
 *     in-app dialogs, browser prompts, etc.) by detecting them via AdvancedVision
 *     and clicking the correct button via SurfaceLayer.
 *
 *   ClaudeCodeResponder — specialised responder for Claude Code terminal prompts.
 *     Reads the active terminal window via OCR, matches patterns like:
 *       "Allow Read to /path/to/file? (y/n)"
 *     and types 'y' or 'n' into the terminal.
 *
 * Data flow:
 *   poll() → detectModal/detectPermissionDialog → policy.evaluate()
 *          → clickButton / typeTerminalResponse → emit event
 */

import { EventEmitter } from "events";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import type { SurfaceLayer } from "../layers/surface.js";
import type { AdvancedVision, PermissionDialogInfo, ModalInfo } from "./advanced.js";

// ---------------------------------------------------------------------------
// Approval policy contract (approval-policy.ts will satisfy this interface)
// ---------------------------------------------------------------------------

/** A normalised permission request passed to the policy engine. */
export interface ApprovalRequest {
  /** The application requesting permission (e.g. "Claude Code", "Finder"). */
  app: string;
  /** The resource being accessed (file path, URL, capability name, etc.). */
  resource: string;
  /** The kind of access being requested. */
  action: "read" | "write" | "execute" | "full_access" | string;
  /** Broad dialog category from PermissionDialogInfo.type. */
  dialogType: PermissionDialogInfo["type"];
  /** Full OCR text of the dialog — used as a fallback signal. */
  rawText: string;
  /** When this request was detected. */
  timestamp: Date;
}

/** Decision returned by the policy engine. */
export interface ApprovalDecision {
  /** Whether to allow, deny, or defer (ask the user). */
  decision: "allow" | "deny" | "ask";
  /** Human-readable explanation of why this decision was made. */
  reason: string;
  /** Confidence in the decision, 0–1. Used for logging/telemetry only. */
  confidence?: number;
  /** Name of the rule that matched, if any. */
  matchedRule?: string;
}

/** Minimum interface that the approval policy engine must satisfy. */
export interface ApprovalEngine {
  evaluate(request: ApprovalRequest): ApprovalDecision;
}

// ---------------------------------------------------------------------------
// Public event types
// ---------------------------------------------------------------------------

export interface PermissionEvent {
  timestamp: Date;
  dialog: PermissionDialogInfo;
  decision: ApprovalDecision;
  /** What actually happened (or was skipped in dry-run mode). */
  action: "allowed" | "denied" | "deferred" | "error";
  error?: string;
}

export interface ClaudeCodePermissionEvent {
  timestamp: Date;
  /** The matched permission prompt line, e.g. "Allow Read to /foo/bar? (y/n)" */
  promptLine: string;
  /** Parsed details from the prompt. */
  parsed: ClaudeCodePrompt;
  decision: ApprovalDecision;
  action: "allowed" | "denied" | "deferred" | "error";
  error?: string;
}

// ---------------------------------------------------------------------------
// PermissionResponder
// ---------------------------------------------------------------------------

export interface PermissionResponderOptions {
  /** How often to poll the screen for dialogs (ms). Default: 1000. */
  pollIntervalMs: number;
  /** Max retry attempts when clicking a button fails. Default: 3. */
  maxRetries: number;
  /**
   * Dry-run mode — detect and log everything but do not actually click.
   * Default: false.
   */
  dryRun: boolean;
  /**
   * Master kill-switch. start() is a no-op when false.
   * Default: false (must be explicitly enabled).
   */
  enabled: boolean;
}

const DEFAULT_OPTIONS: PermissionResponderOptions = {
  pollIntervalMs: 1000,
  maxRetries: 3,
  dryRun: false,
  enabled: false,
};

/**
 * Polls the screen at a configurable interval, detects GUI permission dialogs,
 * evaluates them against an approval policy, and clicks the correct button.
 *
 * @example
 * ```typescript
 * const responder = new PermissionResponder(surface, vision, policy, {
 *   pollIntervalMs: 800,
 *   dryRun: false,
 *   enabled: true,
 * });
 * responder.on('allowed', (ev) => console.log('Allowed:', ev.dialog.resource));
 * responder.on('denied',  (ev) => console.log('Denied:',  ev.dialog.resource));
 * responder.on('ask',     (ev) => promptUser(ev.dialog, ev.decision));
 * responder.start();
 * ```
 */
export class PermissionResponder extends EventEmitter {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  /** Avoid re-processing the same dialog on consecutive polls. */
  private lastDialogHash: string | null = null;
  private history: PermissionEvent[] = [];
  private readonly options: PermissionResponderOptions;

  /** Monitoring state */
  private monitoringActive = false;
  private monitoringStartedAt: Date | undefined = undefined;
  private monitoringDecisionsCount = 0;
  private monitoringLastDecision: { timestamp: Date; tool: string; decision: string } | undefined = undefined;

  /** Registered interceptors: run before evaluate() */
  private interceptors: Array<{
    pattern: { tool?: string; resource?: string };
    handler: (request: ApprovalRequest) => Promise<"allow" | "deny" | "ask">;
  }> = [];

  constructor(
    private readonly surface: SurfaceLayer,
    private readonly vision: AdvancedVision,
    private readonly policy: ApprovalEngine,
    options: Partial<PermissionResponderOptions> = {}
  ) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start polling. No-op if options.enabled is false. */
  start(): void {
    if (!this.options.enabled) {
      this.emit("disabled");
      return;
    }
    if (this.pollInterval) return; // already running

    this.pollInterval = setInterval(
      () => void this.poll(),
      this.options.pollIntervalMs
    );
    this.emit("started");
  }

  /** Stop polling and clean up. Safe to call multiple times. */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.emit("stopped");
  }

  get isRunning(): boolean {
    return this.pollInterval !== null;
  }

  // ── Core poll loop ─────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    // Prevent concurrent processing — drop ticks while busy
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Fast gate: is any modal window on screen right now?
      const modal = await this.vision.detectModal();
      if (!modal) return;

      // 2. Is it specifically a permission dialog?
      const permDialog = await this.detectPermissionDialog(modal);
      if (!permDialog) return;

      // 3. Hash to avoid re-processing the same dialog on the next tick
      const hash = hashDialog(permDialog);
      if (hash === this.lastDialogHash) return;
      this.lastDialogHash = hash;

      // 4. Evaluate against policy
      const request: ApprovalRequest = {
        app: permDialog.app,
        resource: permDialog.resource,
        action: permDialog.action,
        dialogType: permDialog.type,
        rawText: permDialog.rawText,
        timestamp: new Date(),
      };
      const decision = this.policy.evaluate(request);

      // 5. Act
      if (decision.decision === "allow") {
        await this.clickWithRetry(permDialog.allowButton ?? "Allow");
        this.recordEvent(permDialog, decision, "allowed");
      } else if (decision.decision === "deny") {
        await this.clickWithRetry(permDialog.denyButton ?? "Deny");
        this.recordEvent(permDialog, decision, "denied");
      } else {
        // 'ask' — surface to the user, do not act
        this.recordEvent(permDialog, decision, "deferred");
        this.emit("ask", { dialog: permDialog, decision } satisfies {
          dialog: PermissionDialogInfo;
          decision: ApprovalDecision;
        });
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Permission dialog detection ────────────────────────────────────────────

  /**
   * Enriches a raw ModalInfo into a PermissionDialogInfo by running OCR
   * on the dialog region and classifying its content.
   *
   * Returns null when the modal does not look like a permission dialog.
   */
  private async detectPermissionDialog(
    modal: ModalInfo
  ): Promise<PermissionDialogInfo | null> {
    // Shortcut: the accessibility tree already classified it as "permission"
    if (modal.type === "permission") {
      return buildPermissionInfo(modal, "macos_system");
    }

    // For unknown/alert/confirm types we need to read the dialog text via OCR
    // and check for permission keywords.
    if (!["unknown", "alert", "confirm", "sheet", "custom"].includes(modal.type)) {
      return null;
    }

    // Use OCR to read the dialog region
    const capture = await this.surface.captureScreen();
    const dialogRegion = cropToRegion(
      capture.data,
      capture.width,
      capture.height,
      modal.bounds,
      capture.bytesPerRow
    );

    const fullText = await ocrBuffer(dialogRegion);
    if (!fullText) return null;

    const textLower = fullText.toLowerCase();
    const hasPermissionKeyword = PERMISSION_KEYWORDS.some((kw) =>
      textLower.includes(kw)
    );
    if (!hasPermissionKeyword) return null;

    return buildPermissionInfo(modal, classifyDialogType(textLower), fullText);
  }

  // ── Button clicking ────────────────────────────────────────────────────────

  private async clickWithRetry(label: string): Promise<void> {
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        await this.clickButton(label);
        return;
      } catch (err) {
        if (attempt === this.options.maxRetries) throw err;
        await sleep(200 * attempt); // back-off
      }
    }
  }

  private async clickButton(label: string): Promise<void> {
    if (this.options.dryRun) {
      this.emit("dryRun", { button: label });
      return;
    }

    // Strategy 1: accessibility tree / fingerprint element lookup
    const element = await this.surface.findElement(label);
    if (element) {
      await this.surface.clickElement(element);
      await sleep(150);
      return;
    }

    // Strategy 2: keyboard shortcut fallback
    // macOS convention: default (blue) button = Return, cancel = Escape
    const labelLower = label.toLowerCase();
    if (
      labelLower.includes("allow") ||
      labelLower.includes("yes") ||
      labelLower.includes("ok") ||
      labelLower.includes("grant") ||
      labelLower.includes("approve")
    ) {
      await this.surface.keyTap("return");
    } else {
      await this.surface.keyTap("escape");
    }
    await sleep(150);
  }

  // ── History ────────────────────────────────────────────────────────────────

  // ── Real-time monitoring ───────────────────────────────────────────────────

  /**
   * Start a self-contained monitoring loop that auto-evaluates permission dialogs.
   * Returns a stop handle. Independent of the main start()/stop() lifecycle.
   */
  async startMonitoring(options?: {
    pollIntervalMs?: number;
    onDecision?: (decision: any) => void;
  }): Promise<{ stop: () => void }> {
    this.monitoringActive = true;
    this.monitoringStartedAt = new Date();

    const intervalMs = options?.pollIntervalMs ?? this.options.pollIntervalMs;

    const tick = async (): Promise<void> => {
      if (!this.monitoringActive) return;
      try {
        const modal = await this.vision.detectModal();
        if (!modal) return;
        const permDialog = await this.detectPermissionDialog(modal);
        if (!permDialog) return;

        const hash = hashDialog(permDialog);
        if (hash === this.lastDialogHash) return;
        this.lastDialogHash = hash;

        const request: ApprovalRequest = {
          app: permDialog.app,
          resource: permDialog.resource,
          action: permDialog.action,
          dialogType: permDialog.type,
          rawText: permDialog.rawText,
          timestamp: new Date(),
        };

        // Run interceptors first
        let interceptorResult: "allow" | "deny" | "ask" | null = null;
        for (const { pattern, handler } of this.interceptors) {
          const toolMatch = !pattern.tool || permDialog.action === pattern.tool;
          const resourceMatch = !pattern.resource || permDialog.resource.includes(pattern.resource);
          if (toolMatch && resourceMatch) {
            interceptorResult = await handler(request);
            break;
          }
        }

        const decision = interceptorResult
          ? { decision: interceptorResult, reason: "Matched interceptor" }
          : this.policy.evaluate(request);

        this.monitoringDecisionsCount++;
        this.monitoringLastDecision = {
          timestamp: new Date(),
          tool: permDialog.action,
          decision: decision.decision,
        };

        const result = { request, decision, dialog: permDialog };
        options?.onDecision?.(result);

        if (decision.decision === "allow") {
          await this.clickWithRetry(permDialog.allowButton ?? "Allow");
          this.recordEvent(permDialog, decision as ApprovalDecision, "allowed");
        } else if (decision.decision === "deny") {
          await this.clickWithRetry(permDialog.denyButton ?? "Deny");
          this.recordEvent(permDialog, decision as ApprovalDecision, "denied");
        } else {
          this.recordEvent(permDialog, decision as ApprovalDecision, "deferred");
        }
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    };

    const handle = setInterval(() => void tick(), intervalMs);

    return {
      stop: () => {
        clearInterval(handle);
        this.monitoringActive = false;
      },
    };
  }

  async getMonitoringStatus(): Promise<{
    isActive: boolean;
    startedAt?: Date;
    decisionsCount: number;
    lastDecision?: { timestamp: Date; tool: string; decision: string };
  }> {
    return {
      isActive: this.monitoringActive,
      startedAt: this.monitoringStartedAt,
      decisionsCount: this.monitoringDecisionsCount,
      lastDecision: this.monitoringLastDecision,
    };
  }

  /**
   * Register a custom interceptor that runs before the default evaluate().
   * The first matching interceptor wins; use 'ask' to fall through to evaluate().
   */
  async registerInterceptor(
    pattern: { tool?: string; resource?: string },
    handler: (request: ApprovalRequest) => Promise<"allow" | "deny" | "ask">
  ): Promise<void> {
    this.interceptors.push({ pattern, handler });
  }

  // ── History (PermissionResponder) ──────────────────────────────────────────

  private recordEvent(
    dialog: PermissionDialogInfo,
    decision: ApprovalDecision,
    action: PermissionEvent["action"],
    error?: string
  ): void {
    const ev: PermissionEvent = {
      timestamp: new Date(),
      dialog,
      decision,
      action,
      error,
    };
    this.history.push(ev);
    this.emit(action, ev);
    this.emit("event", ev);
  }

  getHistory(): PermissionEvent[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

// ---------------------------------------------------------------------------
// ClaudeCodeResponder
// ---------------------------------------------------------------------------

/** Parsed details from a Claude Code permission prompt. */
export interface ClaudeCodePrompt {
  /**
   * The tool being used:
   *   Read | Write | Edit | Bash | Execute | NotebookEdit | MultiEdit | …
   */
  toolName: string;
  /**
   * The target: file path (for Read/Write/Edit) or command (for Bash).
   */
  target: string;
  /** Normalised action type (mapped from toolName). */
  action: "read" | "write" | "execute" | "full_access";
}

export interface ClaudeCodeResponderOptions {
  /** How often to poll the active terminal window (ms). Default: 500. */
  pollIntervalMs: number;
  /** Dry-run: log but don't type. Default: false. */
  dryRun: boolean;
  /** Master kill-switch. Default: false. */
  enabled: boolean;
  /**
   * Optional: only watch terminals whose window title matches this pattern.
   * When omitted, the frontmost terminal window is used.
   */
  terminalTitleFilter?: RegExp;
}

const DEFAULT_CLAUDE_OPTIONS: ClaudeCodeResponderOptions = {
  pollIntervalMs: 500,
  dryRun: false,
  enabled: false,
};

/**
 * Detects Claude Code permission prompts in terminal windows and auto-responds.
 *
 * Claude Code shows prompts in the form:
 *   Allow Read to /Users/hoahn/Projects/foo/bar.ts? (y/n)
 *   Allow Write to file? (y/n)
 *   Allow Bash: npm install? (y/n)
 *   Allow Edit to /path/to/file? (y/n)
 *
 * This class:
 *  1. Polls the frontmost terminal window via screen capture + OCR.
 *  2. Matches lines against CLAUDE_PROMPT_PATTERN.
 *  3. Evaluates each new prompt against the policy engine.
 *  4. Types 'y\n' (allow) or 'n\n' (deny) directly into the terminal.
 *
 * @example
 * ```typescript
 * const cc = new ClaudeCodeResponder(surface, policy, {
 *   pollIntervalMs: 400,
 *   enabled: true,
 * });
 * cc.on('allowed', (ev) => log('auto-allowed', ev.parsed.target));
 * cc.on('denied',  (ev) => log('auto-denied',  ev.parsed.target));
 * cc.start();
 * ```
 */
export class ClaudeCodeResponder extends EventEmitter {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;
  /** Tracks the last prompt line we responded to — avoids responding twice. */
  private lastPromptKey: string | null = null;
  private history: ClaudeCodePermissionEvent[] = [];
  private ocr: TesseractWorker | null = null;
  private ocrInitializing: Promise<void> | null = null;
  private readonly options: ClaudeCodeResponderOptions;

  constructor(
    private readonly surface: SurfaceLayer,
    private readonly policy: ApprovalEngine,
    options: Partial<ClaudeCodeResponderOptions> = {}
  ) {
    super();
    this.options = { ...DEFAULT_CLAUDE_OPTIONS, ...options };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start polling. No-op if options.enabled is false. */
  start(): void {
    if (!this.options.enabled) {
      this.emit("disabled");
      return;
    }
    if (this.pollInterval) return;

    this.pollInterval = setInterval(
      () => void this.poll(),
      this.options.pollIntervalMs
    );
    this.emit("started");
  }

  /** Stop polling and free OCR resources. */
  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    await this.terminateOcr();
    this.emit("stopped");
  }

  get isRunning(): boolean {
    return this.pollInterval !== null;
  }

  // ── Core poll loop ─────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // 1. Find the target terminal window
      const terminalCapture = await this.captureTerminal();
      if (!terminalCapture) return;

      // 2. OCR it — we need the raw text content
      const text = await this.ocrImage(terminalCapture);
      if (!text) return;

      // 3. Find the last Claude Code permission prompt in the terminal output
      const prompt = findLastClaudePrompt(text);
      if (!prompt) return;

      // 4. Deduplicate — only act on each unique prompt once
      const promptKey = `${prompt.toolName}:${prompt.target}`;
      if (promptKey === this.lastPromptKey) return;
      this.lastPromptKey = promptKey;

      // 5. Evaluate against policy
      const promptLine = buildPromptLine(prompt);
      const request: ApprovalRequest = {
        app: "Claude Code",
        resource: prompt.target,
        action: prompt.action,
        dialogType: "terminal_prompt",
        rawText: promptLine,
        timestamp: new Date(),
      };
      const decision = this.policy.evaluate(request);

      // 6. Respond
      if (decision.decision === "allow") {
        await this.typeResponse("y");
        this.recordEvent(promptLine, prompt, decision, "allowed");
      } else if (decision.decision === "deny") {
        await this.typeResponse("n");
        this.recordEvent(promptLine, prompt, decision, "denied");
      } else {
        // 'ask' — notify caller, do not type anything
        this.recordEvent(promptLine, prompt, decision, "deferred");
        this.emit("ask", { prompt, decision } satisfies {
          prompt: ClaudeCodePrompt;
          decision: ApprovalDecision;
        });
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Terminal window capture ────────────────────────────────────────────────

  /**
   * Finds the frontmost terminal window and captures it.
   * Supports Terminal.app, iTerm2, Warp, Ghostty, Alacritty, Kitty.
   */
  private async captureTerminal(): Promise<Buffer | null> {
    const windows = await this.surface.listWindows();

    const terminalOwners = [
      "terminal",
      "iterm",
      "warp",
      "ghostty",
      "alacritty",
      "kitty",
      "hyper",
      "tabby",
    ];

    const target = windows.find((w) => {
      if (!w.isOnScreen) return false;

      const ownerLower = w.owner.toLowerCase();
      const isTerminal = terminalOwners.some((t) => ownerLower.includes(t));
      if (!isTerminal) return false;

      if (this.options.terminalTitleFilter) {
        return this.options.terminalTitleFilter.test(w.title);
      }
      return true;
    });

    if (!target) return null;

    const capture = await this.surface.captureWindow(target.id);
    return capture.data;
  }

  // ── OCR helpers ────────────────────────────────────────────────────────────

  private async ensureOcr(): Promise<TesseractWorker> {
    if (this.ocr) return this.ocr;
    if (this.ocrInitializing) {
      await this.ocrInitializing;
      return this.ocr!;
    }
    this.ocrInitializing = (async () => {
      this.ocr = await createWorker("eng");
    })();
    await this.ocrInitializing;
    return this.ocr!;
  }

  private async terminateOcr(): Promise<void> {
    if (this.ocrInitializing) await this.ocrInitializing.catch(() => {});
    if (this.ocr) {
      await this.ocr.terminate();
      this.ocr = null;
    }
    this.ocrInitializing = null;
  }

  private async ocrImage(buf: Buffer): Promise<string | null> {
    try {
      const worker = await this.ensureOcr();
      const result = await worker.recognize(buf);
      return result.data.text;
    } catch {
      return null;
    }
  }

  // ── Terminal response ──────────────────────────────────────────────────────

  /**
   * Types the response character followed by Enter into the frontmost window.
   *
   * We use typeText (simulates real key events via CGEvent) so the active
   * terminal receives it exactly as if the user typed it.
   */
  private async typeResponse(answer: "y" | "n"): Promise<void> {
    if (this.options.dryRun) {
      this.emit("dryRun", { answer });
      return;
    }
    // Type the character
    await this.surface.typeText(answer);
    await sleep(80);
    // Press Enter to confirm
    await this.surface.keyTap("return");
    await sleep(150);
  }

  // ── History ────────────────────────────────────────────────────────────────

  private recordEvent(
    promptLine: string,
    parsed: ClaudeCodePrompt,
    decision: ApprovalDecision,
    action: ClaudeCodePermissionEvent["action"],
    error?: string
  ): void {
    const ev: ClaudeCodePermissionEvent = {
      timestamp: new Date(),
      promptLine,
      parsed,
      decision,
      action,
      error,
    };
    this.history.push(ev);
    this.emit(action, ev);
    this.emit("event", ev);
  }

  getHistory(): ClaudeCodePermissionEvent[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

// ---------------------------------------------------------------------------
// Claude Code prompt parsing
// ---------------------------------------------------------------------------

/**
 * Matches Claude Code permission lines, e.g.:
 *   Allow Read to /Users/hoahn/foo.ts? (y/n)
 *   Allow Bash: npm install --save-dev jest? (y/n)
 *   Allow Write to /tmp/out.json? (y/n)
 *   Allow Edit to /path/to/file.ts? (y/n)
 *   Allow NotebookEdit to /nb.ipynb? (y/n)
 *   Allow Execute: ./build.sh? (y/n)
 *
 * Capture groups:
 *   1 — tool name  (Read | Write | Edit | Bash | Execute | NotebookEdit | …)
 *   2 — separator  ("to " | ": ")
 *   3 — target     (file path or shell command)
 */
const CLAUDE_PROMPT_PATTERN =
  /Allow\s+(Read|Write|Edit|Bash|Execute|NotebookEdit|MultiEdit|ListDirectory|Glob|Grep|WebFetch|WebSearch|mcp__\S+)\s*(to\s+|:\s*)(.+?)\?\s*\([yYnN]\/[yYnN]\)/;

/** Scan the full OCR text and return the last matching prompt, if any. */
function findLastClaudePrompt(text: string): ClaudeCodePrompt | null {
  const lines = text.split(/\r?\n/);

  // Walk from bottom so we catch the most recent prompt
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    const match = CLAUDE_PROMPT_PATTERN.exec(line);
    if (!match) continue;

    const toolName = match[1]!;
    // strip leading "to " or ": " captured in group 2
    const target = match[3]!.trim();

    return {
      toolName,
      target,
      action: toolToAction(toolName),
    };
  }
  return null;
}

/** Reconstruct a human-readable prompt line from the parsed struct. */
function buildPromptLine(p: ClaudeCodePrompt): string {
  const sep = isCommandTool(p.toolName) ? ": " : " to ";
  return `Allow ${p.toolName}${sep}${p.target}? (y/n)`;
}

/** Map Claude Code tool names to canonical action types. */
function toolToAction(toolName: string): ClaudeCodePrompt["action"] {
  switch (toolName) {
    case "Read":
    case "ListDirectory":
    case "Glob":
    case "Grep":
    case "WebFetch":
    case "WebSearch":
      return "read";
    case "Write":
    case "Edit":
    case "NotebookEdit":
    case "MultiEdit":
      return "write";
    case "Bash":
    case "Execute":
      return "execute";
    default:
      // mcp__ tools or anything unknown — treat as full_access (most restrictive)
      return "full_access";
  }
}

function isCommandTool(toolName: string): boolean {
  return toolName === "Bash" || toolName === "Execute";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Keywords that signal a GUI dialog is requesting permission. */
const PERMISSION_KEYWORDS = [
  "allow",
  "deny",
  "don't allow",
  "block",
  "permission",
  "access",
  "would like to",
  "wants to access",
  "grant",
  "authorize",
  // macOS system privacy dialogs
  "screen recording",
  "accessibility",
  "full disk access",
  "files and folders",
  "automation",
  "input monitoring",
  // Generic approval patterns
  "approve",
  "reject",
];

/** Build a PermissionDialogInfo from a ModalInfo + optional full OCR text. */
function buildPermissionInfo(
  modal: ModalInfo,
  type: PermissionDialogInfo["type"],
  fullText?: string
): PermissionDialogInfo {
  const rawText = fullText ?? [modal.title, modal.message, ...modal.buttons].filter(Boolean).join(" ");
  const textLower = rawText.toLowerCase();

  // Determine allow/deny buttons
  const allowButton = modal.buttons.find((b) =>
    /\b(allow|yes|ok|grant|approve|continue)\b/i.test(b)
  );
  const denyButton = modal.buttons.find((b) =>
    /\b(deny|no|cancel|block|don.t allow|reject)\b/i.test(b)
  );

  // Infer action from text keywords
  let action: PermissionDialogInfo["action"] = "full_access";
  if (textLower.includes("read") || textLower.includes("view") || textLower.includes("access")) {
    action = "read";
  } else if (textLower.includes("write") || textLower.includes("modify") || textLower.includes("edit")) {
    action = "write";
  } else if (textLower.includes("execute") || textLower.includes("run")) {
    action = "execute";
  }

  // Extract app name from title (e.g. "\"Finder\" wants access to…")
  const appMatch = /[""«»]([^"""»]+)[""»]/.exec(modal.title ?? "");
  const app = appMatch?.[1]?.trim() ?? modal.title?.split(/\s/)[0] ?? "Unknown";

  // Extract resource (file path or capability name)
  const resourceMatch =
    /(?:to |access )[""]?([/~][^\s"".]+|[\w\s]+(?:folder|files|calendar|contacts|camera|microphone|location|screen))/i.exec(
      rawText
    );
  const resource = resourceMatch?.[1]?.trim() ?? modal.message?.slice(0, 80) ?? "";

  return {
    type,
    app,
    resource,
    action,
    buttons: modal.buttons,
    allowButton,
    denyButton,
    rawText,
  };
}

/** Classify the dialog type from OCR text. */
function classifyDialogType(
  textLower: string
): PermissionDialogInfo["type"] {
  if (textLower.includes("system preferences") || textLower.includes("privacy & security")) {
    return "macos_system";
  }
  if (textLower.includes("(y/n)") || textLower.includes("allow read") || textLower.includes("allow write")) {
    return "terminal_prompt";
  }
  if (textLower.includes("chrome") || textLower.includes("firefox") || textLower.includes("safari")) {
    return "browser";
  }
  return "app_dialog";
}

/**
 * Quick non-cryptographic hash of a PermissionDialogInfo for deduplication.
 * Intentionally cheap — not for security use.
 */
function hashDialog(d: PermissionDialogInfo): string {
  const str = `${d.type}|${d.app}|${d.resource}|${d.action}|${d.buttons.join(",")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Crop a raw BGRA/RGBA buffer to a sub-region (matches surface.ts cropBufferRegion). */
function cropToRegion(
  src: Buffer,
  srcWidth: number,
  srcHeight: number,
  region: { x: number; y: number; width: number; height: number },
  srcBytesPerRow?: number
): Buffer {
  const startX = Math.max(0, Math.floor(region.x));
  const startY = Math.max(0, Math.floor(region.y));
  const endX = Math.min(srcWidth, startX + Math.max(1, Math.floor(region.width)));
  const endY = Math.min(srcHeight, startY + Math.max(1, Math.floor(region.height)));
  const outWidth = Math.max(1, endX - startX);
  const outHeight = Math.max(1, endY - startY);

  const bytesPerPixel = 4;
  const inStride = srcBytesPerRow ?? srcWidth * bytesPerPixel;
  const outStride = outWidth * bytesPerPixel;
  const out = Buffer.alloc(outStride * outHeight);

  for (let row = 0; row < outHeight; row++) {
    const inOffset = (startY + row) * inStride + startX * bytesPerPixel;
    const outOffset = row * outStride;
    src.copy(out, outOffset, inOffset, inOffset + outStride);
  }
  return out;
}

/** Shared tesseract worker for one-shot OCR calls from PermissionResponder. */
let _sharedOcr: TesseractWorker | null = null;
let _sharedOcrInit: Promise<void> | null = null;

async function ocrBuffer(buf: Buffer): Promise<string | null> {
  try {
    if (!_sharedOcr) {
      if (!_sharedOcrInit) {
        _sharedOcrInit = (async () => {
          _sharedOcr = await createWorker("eng");
        })();
      }
      await _sharedOcrInit;
    }
    const result = await _sharedOcr!.recognize(buf);
    return result.data.text;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
