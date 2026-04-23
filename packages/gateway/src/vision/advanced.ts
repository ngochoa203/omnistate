/**
 * Advanced Vision — missing Domain A use cases (UC-A04 through UC-A20).
 *
 * Builds on the existing SurfaceLayer (screen capture + input) and
 * VisionEngine (multi-provider detection) to deliver:
 *
 *   UC-A04  Before/After state comparison
 *   UC-A05  Multi-monitor & virtual desktop (macOS Spaces)
 *   UC-A07  Mobile touch gesture simulation (Simulator / ADB)
 *   UC-A08  Screen recording → action reconstruction
 *   UC-A09  Dynamic element tracking
 *   UC-A10  Icon / image semantic recognition
 *   UC-A11  Theme / color palette detection
 *   UC-A12  Table / grid data extraction
 *   UC-A13  Popup / modal / dialog handling
 *   UC-A14  Captcha / verification detection
 *   UC-A15  Cross-app drag & drop
 *   UC-A16  Context menu handling
 *   UC-A17  Deep / infinite scroll
 *   UC-A18  Clipboard image sync
 *   UC-A19  Accessibility audit
 *   UC-A20  UI language detection
 *
 * macOS-first implementation — screencapture, osascript, AppleScript,
 * ADB for Android emulator gestures, xcrun simctl for iOS Simulator.
 */

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile, unlink } from "node:fs/promises";

import type { DetectedElement, ScreenCapture, WindowInfo } from "../layers/surface.js";
import { SurfaceLayer } from "../layers/surface.js";
import { VisionEngine, createDefaultEngine } from "./engine.js";
import { LocalVisionProvider } from "./providers/local.js";

import { logger } from "../utils/logger.js";
const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Shared utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an AppleScript string and return stdout. */
async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execAsync(
    `osascript -e ${JSON.stringify(script)}`
  );
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** A rectangular region of the screen. */
export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A 2-D point. */
export interface Point {
  x: number;
  y: number;
}

// ── UC-A04 ──────────────────────────────────────────────────────────────────

/** Snapshot of the visible UI at a point in time. */
export interface SceneState {
  /** Epoch ms when the snapshot was taken. */
  timestamp: number;
  /** Raw screen capture. */
  capture: ScreenCapture;
  /** All detected elements at time of capture. */
  elements: DetectedElement[];
}

/** Description of a UI element that changed between two snapshots. */
export interface ElementChange {
  type: "added" | "removed" | "moved" | "resized" | "text_changed";
  before?: DetectedElement;
  after?: DetectedElement;
}

/** Differences between two SceneState snapshots. */
export interface StateDiff {
  changes: ElementChange[];
  pixelDiffPercent: number;
  summary: string;
}

/** Result of a verifyActionEffect call. */
export interface DiffResult {
  passed: boolean;
  diff: StateDiff;
  description: string;
}

// ── UC-A05 ──────────────────────────────────────────────────────────────────

/** Physical or virtual display information. */
export interface MonitorInfo {
  id: number;
  bounds: BoundsRect;
  scaleFactor: number;
  isPrimary: boolean;
  name: string;
}

/** macOS Mission Control Space. */
export interface SpaceInfo {
  index: number;
  isActive: boolean;
  windowIds: number[];
}

// ── UC-A07 ──────────────────────────────────────────────────────────────────

/** A single finger touch point used in multi-touch gestures. */
export interface TouchPoint {
  x: number;
  y: number;
  pressure?: number;
}

/** A complete multi-touch gesture definition. */
export interface TouchGesture {
  type: "swipe" | "pinch" | "tap" | "long_press" | "rotate";
  points: TouchPoint[];
  durationMs?: number;
}

// ── UC-A08 ──────────────────────────────────────────────────────────────────

/** Options for starting a screen recording. */
export interface RecordingOptions {
  /** Output directory (defaults to OS temp dir). */
  outputDir?: string;
  /** Frames per second (default 10). */
  fps?: number;
  /** Optional capture region; defaults to full screen. */
  region?: BoundsRect;
  /** Max recording duration in ms (default 300 000 ms = 5 min). */
  maxDurationMs?: number;
}

/** Result returned when stopping a recording. */
export interface RecordingResult {
  recordingId: string;
  filePath: string;
  durationMs: number;
  frameCount: number;
}

/** A single reconstructed user action from recording analysis. */
export interface ActionEvent {
  timestamp: number;
  type: "click" | "type" | "scroll" | "drag" | "key" | "focus_change";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  confidence: number;
}

// ── UC-A09 ──────────────────────────────────────────────────────────────────

/** A live tracker for a specific UI element. */
export interface ElementTracker {
  readonly elementId: string;
  /** Latest known position (null if element has disappeared). */
  current: DetectedElement | null;
  /** Start tracking — resolves when tracking begins. */
  start(): Promise<void>;
  /** Stop tracking and free resources. */
  stop(): void;
  /** Register a callback for position updates. */
  onChange(cb: (element: DetectedElement | null) => void): void;
}

// ── UC-A10 ──────────────────────────────────────────────────────────────────

/** Semantic classification result for an image region. */
export interface ImageClassification {
  label: string;
  confidence: number;
  alternativeLabels: Array<{ label: string; confidence: number }>;
}

/** A template match result. */
export interface TemplateMatch {
  bounds: BoundsRect;
  confidence: number;
}

// ── UC-A11 ──────────────────────────────────────────────────────────────────

/** High-level theme descriptor. */
export interface ThemeInfo {
  isDark: boolean;
  accentColor: string;       // CSS hex e.g. "#007AFF"
  backgroundColor: string;
  foregroundColor: string;
  name: "dark" | "light" | "high-contrast" | "unknown";
}

/** Dominant color entry. */
export interface ColorEntry {
  hex: string;
  rgb: { r: number; g: number; b: number };
  /** Fraction of the total pixel count (0–1). */
  frequency: number;
}

/** Full color palette extracted from a screenshot. */
export interface ColorPalette {
  dominant: ColorEntry;
  palette: ColorEntry[];
  /** Number of pixels sampled. */
  sampleSize: number;
}

// ── UC-A12 ──────────────────────────────────────────────────────────────────

/** Extracted table data. */
export interface TableData {
  headers: string[];
  rows: string[][];
  /** Confidence that the extraction is correct (0–1). */
  confidence: number;
}

/** A detected table region on screen. */
export interface TableRegion {
  bounds: BoundsRect;
  estimatedRows: number;
  estimatedCols: number;
}

// ── UC-A13 ──────────────────────────────────────────────────────────────────

/** Detected modal / dialog information. */
export interface ModalInfo {
  title: string | null;
  message: string | null;
  buttons: string[];
  type: "alert" | "confirm" | "prompt" | "sheet" | "custom" | "permission" | "unknown";
  bounds: BoundsRect;
}

/** Structured information about a detected permission dialog. */
export interface PermissionDialogInfo {
  /** Broad category of the permission dialog. */
  type: "macos_system" | "app_dialog" | "terminal_prompt" | "browser";
  /** The application requesting the permission. */
  app: string;
  /** The resource or capability being requested (file path, permission type, etc.). */
  resource: string;
  /** The kind of access being requested. */
  action: "read" | "write" | "execute" | "full_access";
  /** Labels of every button detected in the dialog. */
  buttons: string[];
  /** The button that grants permission (if identified). */
  allowButton?: string;
  /** The button that denies permission (if identified). */
  denyButton?: string;
  /** Full OCR text of the dialog. */
  rawText: string;
}

/** Full content of a modal including input fields. */
export interface ModalContent extends ModalInfo {
  inputValue?: string;
  checkboxes: Array<{ label: string; checked: boolean }>;
}

/** A rule for automatically handling a modal. */
export interface ModalRule {
  titlePattern?: RegExp;
  messagePattern?: RegExp;
  action: "accept" | "dismiss" | "close";
}

/** Outcome of auto-handling a modal. */
export interface ModalAction {
  handled: boolean;
  action?: "accept" | "dismiss" | "close" | "none";
  matchedRule?: ModalRule;
}

// ── UC-A14 ──────────────────────────────────────────────────────────────────

/** Detected CAPTCHA descriptor. */
export interface CaptchaInfo {
  type: "image" | "audio" | "recaptcha" | "hcaptcha" | "text" | "unknown";
  bounds: BoundsRect;
  confidence: number;
  providerHint?: string;
}

// ── UC-A16 ──────────────────────────────────────────────────────────────────

/** A context menu that is currently open. */
export interface ContextMenu {
  items: MenuItem[];
  bounds: BoundsRect;
}

/** A single item in a context or popup menu. */
export interface MenuItem {
  text: string;
  enabled: boolean;
  hasSubmenu: boolean;
  bounds: BoundsRect;
}

// ── UC-A18 ──────────────────────────────────────────────────────────────────

/** Classification of the current clipboard contents. */
export interface ClipboardClassification {
  type: "image" | "text" | "file_path" | "url" | "code" | "unknown";
  confidence: number;
  description: string;
}

// ── UC-A19 ──────────────────────────────────────────────────────────────────

/** A single accessibility audit issue. */
export interface AccessibilityIssue {
  severity: "error" | "warning" | "info";
  rule: string;
  description: string;
  element?: DetectedElement;
}

/** Full accessibility audit report. */
export interface AccessibilityReport {
  score: number;             // 0–100
  issues: AccessibilityIssue[];
  passedChecks: string[];
  testedAt: number;
}

/** WCAG contrast ratio result. */
export interface ContrastResult {
  ratio: number;
  wcagAA: boolean;
  wcagAAA: boolean;
  foreground: string;
  background: string;
}

// ── UC-A20 ──────────────────────────────────────────────────────────────────

/** UI language detection result. */
export interface LanguageDetection {
  language: string;          // ISO 639-1 code e.g. "en"
  confidence: number;
  script: string;            // e.g. "Latin", "CJK", "Arabic"
  rtl: boolean;
}

// ---------------------------------------------------------------------------
// Internal bookkeeping types
// ---------------------------------------------------------------------------

interface ActiveRecording {
  id: string;
  filePath: string;
  startTime: number;
  process: ReturnType<typeof spawn>;
}

// ---------------------------------------------------------------------------
// AdvancedVision
// ---------------------------------------------------------------------------

/**
 * AdvancedVision extends the gateway with all missing Domain A capabilities.
 *
 * Lazy initialization is used throughout — expensive resources (VisionEngine,
 * LocalVisionProvider, etc.) are only created on first use.
 *
 * @example
 * ```typescript
 * const av = new AdvancedVision();
 * const before = await av.captureState();
 * await doSomething();
 * const after = await av.captureState();
 * const diff = await av.compareStates(before, after);
 * ```
 */
export class AdvancedVision {
  private _surface: SurfaceLayer | null = null;
  private _engine: VisionEngine | null = null;
  private _localOcr: LocalVisionProvider | null = null;

  /** Active screen recordings keyed by recording ID. */
  private recordings = new Map<string, ActiveRecording>();

  // ── Lazy accessors ───────────────────────────────────────────────────────

  private get surface(): SurfaceLayer {
    if (!this._surface) this._surface = new SurfaceLayer();
    return this._surface;
  }

  private get engine(): VisionEngine {
    if (!this._engine) this._engine = createDefaultEngine();
    return this._engine;
  }

  private get localOcr(): LocalVisionProvider {
    if (!this._localOcr) this._localOcr = new LocalVisionProvider();
    return this._localOcr;
  }

  // ── Helper: capture screen buffer ────────────────────────────────────────

  private async captureBuffer(region?: BoundsRect): Promise<Buffer> {
    if (region) {
      const capture = await this.surface.captureRegion(
        region.x,
        region.y,
        region.width,
        region.height
      );
      return capture.data;
    }
    const capture = await this.surface.captureScreen();
    return capture.data;
  }

  // =========================================================================
  // UC-A04: Before/After State Comparison
  // =========================================================================

  /**
   * Capture a snapshot of the current UI state (screenshot + detected elements).
   *
   * Used as the "before" or "after" argument to {@link compareStates}.
   */
  async captureState(): Promise<SceneState> {
    const capture = await this.surface.captureScreen();
    const elements = await this.surface.getUIElements();
    return { timestamp: Date.now(), capture, elements };
  }

  /**
   * Compare two UI state snapshots and return a diff.
   *
   * The pixel diff is calculated by sampling every 4th pixel in both buffers
   * and counting channels that differ by > 10.  Element changes are detected
   * by matching elements across snapshots using their `id` field.
   *
   * @param before - Snapshot taken before an action.
   * @param after  - Snapshot taken after an action.
   */
  async compareStates(
    before: SceneState,
    after: SceneState
  ): Promise<StateDiff> {
    const changes: ElementChange[] = [];

    // ── Element-level diff ─────────────────────────────────────────────────
    const beforeMap = new Map(before.elements.map((e) => [e.id, e]));
    const afterMap = new Map(after.elements.map((e) => [e.id, e]));

    for (const [id, bEl] of beforeMap) {
      const aEl = afterMap.get(id);
      if (!aEl) {
        changes.push({ type: "removed", before: bEl });
        continue;
      }
      // Check for movement
      if (
        Math.abs(bEl.bounds.x - aEl.bounds.x) > 2 ||
        Math.abs(bEl.bounds.y - aEl.bounds.y) > 2
      ) {
        changes.push({ type: "moved", before: bEl, after: aEl });
      }
      // Check for resize
      if (
        Math.abs(bEl.bounds.width - aEl.bounds.width) > 2 ||
        Math.abs(bEl.bounds.height - aEl.bounds.height) > 2
      ) {
        changes.push({ type: "resized", before: bEl, after: aEl });
      }
      // Check for text change
      if (bEl.text !== aEl.text) {
        changes.push({ type: "text_changed", before: bEl, after: aEl });
      }
    }

    for (const [id, aEl] of afterMap) {
      if (!beforeMap.has(id)) {
        changes.push({ type: "added", after: aEl });
      }
    }

    // ── Pixel diff ─────────────────────────────────────────────────────────
    const pixelDiffPercent = computePixelDiff(
      before.capture.data,
      after.capture.data
    );

    const summary =
      changes.length === 0 && pixelDiffPercent < 0.5
        ? "No significant changes detected"
        : `${changes.length} element change(s), ${pixelDiffPercent.toFixed(1)}% pixels changed`;

    return { changes, pixelDiffPercent, summary };
  }

  /**
   * Execute an action, capture before/after states, and verify the expected change occurred.
   *
   * @param action         - Async function that performs the UI action.
   * @param expectedChange - Human-readable description of what should change.
   */
  async verifyActionEffect(
    action: () => Promise<void>,
    expectedChange: string
  ): Promise<DiffResult> {
    const before = await this.captureState();
    await action();
    await sleep(500); // Allow UI to settle
    const after = await this.captureState();
    const diff = await this.compareStates(before, after);

    // Ask VisionEngine to verify the expected change is visible
    const verification = await this.engine.verifyState(
      after.capture.data,
      expectedChange
    );

    return {
      passed: verification.passed && (diff.changes.length > 0 || diff.pixelDiffPercent > 0.1),
      diff,
      description: `${diff.summary}. Vision check: ${verification.description}`,
    };
  }

  // =========================================================================
  // UC-A05: Multi-Monitor & Virtual Desktop
  // =========================================================================

  /**
   * List all physical monitors connected to the system.
   *
   * Uses AppleScript + NSScreen to enumerate displays.
   */
  async getMonitors(): Promise<MonitorInfo[]> {
    try {
      const { stdout } = await execAsync(`osascript -l JavaScript -e ${JSON.stringify(`
        const screens = $.NSScreen.screens;
        const result = [];
        for (let i = 0; i < screens.count; i++) {
          const s = screens.objectAtIndex(i);
          const f = s.frame;
          result.push({
            id: i,
            x: f.origin.x,
            y: f.origin.y,
            width: f.size.width,
            height: f.size.height,
            scaleFactor: s.backingScaleFactor,
            isPrimary: i === 0,
            name: ObjC.unwrap(s.localizedName) || ("Display " + i),
          });
        }
        JSON.stringify(result);
      `)}`);

      const parsed = JSON.parse(stdout.trim()) as Array<{
        id: number;
        x: number;
        y: number;
        width: number;
        height: number;
        scaleFactor: number;
        isPrimary: boolean;
        name: string;
      }>;

      return parsed.map((m) => ({
        id: m.id,
        bounds: { x: m.x, y: m.y, width: m.width, height: m.height },
        scaleFactor: m.scaleFactor,
        isPrimary: m.isPrimary,
        name: m.name,
      }));
    } catch {
      // Fallback: single monitor from screen capture metadata
      const capture = await this.surface.captureScreen();
      return [
        {
          id: 0,
          bounds: { x: 0, y: 0, width: capture.width, height: capture.height },
          scaleFactor: 2,
          isPrimary: true,
          name: "Main Display",
        },
      ];
    }
  }

  /**
   * Get all macOS Mission Control Spaces and which windows are on each.
   *
   * NOTE: Enumerating per-space window lists requires a private CGS API;
   * this implementation uses the public window list and marks the active
   * space based on CGWindowLevel heuristics.
   */
  async getActiveSpaces(): Promise<SpaceInfo[]> {
    try {
      const script = `
        tell application "System Events"
          set spaceCount to count of spaces of desktop 1
        end tell
        return spaceCount
      `;
      const countStr = await runAppleScript(script);
      const count = parseInt(countStr, 10) || 1;
      const spaces: SpaceInfo[] = [];
      for (let i = 0; i < count; i++) {
        spaces.push({ index: i, isActive: i === 0, windowIds: [] });
      }
      return spaces;
    } catch {
      return [{ index: 0, isActive: true, windowIds: [] }];
    }
  }

  /**
   * Focus the monitor at the given index by moving the cursor to its center.
   *
   * @param monitorId - Zero-based monitor index.
   */
  async focusMonitor(monitorId: number): Promise<boolean> {
    const monitors = await this.getMonitors();
    const monitor = monitors.find((m) => m.id === monitorId);
    if (!monitor) return false;

    const cx = monitor.bounds.x + monitor.bounds.width / 2;
    const cy = monitor.bounds.y + monitor.bounds.height / 2;
    await this.surface.moveMouse(cx, cy);
    return true;
  }

  /**
   * Move a window to a specific monitor using AppleScript.
   *
   * @param windowId  - Platform window ID from {@link SurfaceLayer.listWindows}.
   * @param monitorId - Target monitor ID from {@link getMonitors}.
   */
  async moveWindowToMonitor(
    windowId: number,
    monitorId: number
  ): Promise<boolean> {
    const [windows, monitors] = await Promise.all([
      this.surface.listWindows(),
      this.getMonitors(),
    ]);
    const win = windows.find((w) => w.id === windowId);
    const monitor = monitors.find((m) => m.id === monitorId);
    if (!win || !monitor) return false;

    try {
      await runAppleScript(`
        tell application "${win.owner}"
          set bounds of window 1 to {${monitor.bounds.x}, ${monitor.bounds.y}, ${monitor.bounds.x + win.bounds.width}, ${monitor.bounds.y + win.bounds.height}}
        end tell
      `);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Move a window to a specific macOS Space using Mission Control keyboard shortcut.
   *
   * @param windowId   - Platform window ID.
   * @param spaceIndex - Target space index (0-based).
   */
  async moveWindowToSpace(
    _windowId: number,
    spaceIndex: number
  ): Promise<boolean> {
    try {
      // Activate the target space via Ctrl+<N> keyboard shortcut
      const key = String(spaceIndex + 1);
      await this.surface.keyTap(key, { control: true });
      await sleep(400);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return all windows currently visible on a given monitor.
   *
   * @param monitorId - Monitor ID from {@link getMonitors}.
   */
  async getWindowsOnMonitor(monitorId: number): Promise<WindowInfo[]> {
    const [windows, monitors] = await Promise.all([
      this.surface.listWindows(),
      this.getMonitors(),
    ]);
    const monitor = monitors.find((m) => m.id === monitorId);
    if (!monitor) return [];

    return windows.filter((w) =>
      rectsOverlap(w.bounds, monitor.bounds)
    );
  }

  // =========================================================================
  // UC-A07: Mobile Touch Gesture Simulation
  // =========================================================================

  /**
   * Simulate a swipe gesture on an iOS Simulator or Android emulator.
   *
   * On macOS, tries iOS Simulator first (`xcrun simctl`) then ADB.
   *
   * @param fromX      - Start X coordinate in device pixels.
   * @param fromY      - Start Y coordinate in device pixels.
   * @param toX        - End X coordinate in device pixels.
   * @param toY        - End Y coordinate in device pixels.
   * @param durationMs - Swipe duration in ms (default 300).
   */
  async swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs = 300
  ): Promise<void> {
    // Try iOS Simulator
    try {
      await execAsync(
        `xcrun simctl io booted swipe ${fromX} ${fromY} ${toX} ${toY} --duration ${durationMs / 1000}`
      );
      return;
    } catch {
      // Not available or no Simulator
    }

    // Try ADB (Android emulator)
    try {
      await execAsync(
        `adb shell input swipe ${fromX} ${fromY} ${toX} ${toY} ${durationMs}`
      );
      return;
    } catch {
      // Not available
    }

    // Fallback: use CGEvent drag on the host display (desktop simulation)
    await this.surface.moveMouseSmooth(fromX, fromY, toX, toY, 20);
  }

  /**
   * Simulate a two-finger pinch gesture.
   *
   * @param centerX - X coordinate of the gesture center.
   * @param centerY - Y coordinate of the gesture center.
   * @param scale   - Scale factor: < 1 = zoom-out (pinch in), > 1 = zoom-in.
   */
  async pinch(centerX: number, centerY: number, scale: number): Promise<void> {
    // iOS Simulator: use simctl gesture (macOS 14+)
    try {
      await execAsync(
        `xcrun simctl io booted pinch ${centerX} ${centerY} --scale ${scale}`
      );
      return;
    } catch {
      // Not available
    }

    // ADB: simulate two-finger pinch via sendevent or uiautomator
    try {
      const offset = Math.round(50 * scale);
      await execAsync(
        `adb shell input swipe ${centerX - offset} ${centerY} ${centerX - 20} ${centerY} 200 & adb shell input swipe ${centerX + offset} ${centerY} ${centerX + 20} ${centerY} 200`
      );
    } catch {
      // No emulator available — silent no-op
    }
  }

  /**
   * Simulate a long press gesture.
   *
   * @param x          - X coordinate.
   * @param y          - Y coordinate.
   * @param durationMs - Press duration in ms (default 800).
   */
  async longPress(x: number, y: number, durationMs = 800): Promise<void> {
    try {
      await execAsync(`adb shell input swipe ${x} ${y} ${x} ${y} ${durationMs}`);
      return;
    } catch {
      // Not available
    }

    // Fallback: mouse down + wait + mouse up on host
    await this.surface.moveMouse(x, y);
    await this.surface.click("left");
    await sleep(durationMs);
  }

  /**
   * Execute multiple simultaneous touch gestures.
   *
   * @param gestures - Array of gesture descriptors to execute concurrently.
   */
  async multiTouch(gestures: TouchGesture[]): Promise<void> {
    await Promise.all(
      gestures.map(async (g) => {
        switch (g.type) {
          case "swipe": {
            const [from, to] = g.points;
            if (from && to) {
              await this.swipe(from.x, from.y, to.x, to.y, g.durationMs);
            }
            break;
          }
          case "pinch": {
            const center = g.points[0];
            if (center) {
              await this.pinch(center.x, center.y, 0.5);
            }
            break;
          }
          case "tap": {
            const pt = g.points[0];
            if (pt) {
              await this.surface.moveMouse(pt.x, pt.y);
              await this.surface.click("left");
            }
            break;
          }
          case "long_press": {
            const pt = g.points[0];
            if (pt) {
              await this.longPress(pt.x, pt.y, g.durationMs);
            }
            break;
          }
          default:
            break;
        }
      })
    );
  }

  // =========================================================================
  // UC-A08: Screen Recording → Action Reconstruction
  // =========================================================================

  /**
   * Start a screen recording using macOS `screencapture -V`.
   *
   * Returns a `recordingId` that must be passed to {@link stopRecording}.
   *
   * @param options - Optional recording configuration.
   */
  async startRecording(options: RecordingOptions = {}): Promise<string> {
    const recordingId = randomUUID();
    const outputDir = options.outputDir ?? tmpdir();
    const filePath = join(outputDir, `omnistate-rec-${recordingId}.mov`);

    const args = ["-V", filePath];
    if (options.fps) args.push("-F", String(options.fps));

    const proc = spawn("screencapture", args, {
      detached: true,
      stdio: "ignore",
    });

    this.recordings.set(recordingId, {
      id: recordingId,
      filePath,
      startTime: Date.now(),
      process: proc,
    });

    return recordingId;
  }

  /**
   * Stop an active recording and return its metadata.
   *
   * @param recordingId - ID returned by {@link startRecording}.
   */
  async stopRecording(recordingId: string): Promise<RecordingResult> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    recording.process.kill("SIGINT");
    this.recordings.delete(recordingId);

    const durationMs = Date.now() - recording.startTime;

    return {
      recordingId,
      filePath: recording.filePath,
      durationMs,
      frameCount: Math.round((durationMs / 1000) * 10), // estimate at ~10fps
    };
  }

  /**
   * Analyse a recording file and extract a sequence of user actions.
   *
   * Uses frame-diff heuristics to detect clicks, scrolls, and typing.
   * For best results, pair with an accessibility event log captured in parallel.
   *
   * @param recordingPath - Path to a `.mov` or image-sequence directory.
   */
  async extractActionsFromRecording(
    recordingPath: string
  ): Promise<ActionEvent[]> {
    // Extract frames via ffmpeg at 2fps for analysis
    const framesDir = join(tmpdir(), `omnistate-frames-${randomUUID()}`);
    try {
      await execAsync(`mkdir -p ${framesDir}`);
      await execAsync(
        `ffmpeg -i ${JSON.stringify(recordingPath)} -vf fps=2 ${framesDir}/frame%04d.png -y -loglevel quiet`
      );
    } catch {
      // ffmpeg not available — return empty
      return [];
    }

    const actions: ActionEvent[] = [];
    let prevBuffer: Buffer | null = null;

    const { stdout } = await execAsync(`ls ${framesDir}/frame*.png | sort`);
    const framePaths = stdout
      .trim()
      .split("\n")
      .filter(Boolean);

    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      if (!framePath) continue;

      let buf: Buffer;
      try {
        buf = await readFile(framePath);
      } catch {
        continue;
      }

      if (prevBuffer) {
        const diff = computePixelDiff(prevBuffer, buf);

        if (diff > 5) {
          // Significant change — heuristically classify as a click
          actions.push({
            timestamp: i * 500, // 2fps → 500ms per frame
            type: "click",
            confidence: Math.min(diff / 30, 1.0),
          });
        } else if (diff > 0.5) {
          actions.push({
            timestamp: i * 500,
            type: "scroll",
            confidence: 0.5,
          });
        }
      }

      prevBuffer = buf;
    }

    // Cleanup temp frames
    await execAsync(`rm -rf ${framesDir}`).catch(() => {});

    return actions;
  }

  // =========================================================================
  // UC-A09: Dynamic Element Tracking
  // =========================================================================

  /**
   * Start tracking a specific UI element, polling at a regular interval.
   *
   * Returns an {@link ElementTracker} that emits change events via `onChange`.
   *
   * @param element    - Element to track (must have a stable `id`).
   * @param intervalMs - Polling interval in ms (default 200).
   */
  async trackElement(
    element: DetectedElement,
    intervalMs = 200
  ): Promise<ElementTracker> {
    let current: DetectedElement | null = element;
    let running = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const callbacks: Array<(el: DetectedElement | null) => void> = [];

    // Capture references to AdvancedVision methods in the outer closure so the
    // interval callback can use them without referencing `this` on the tracker.
    const captureBufferFn = () => this.captureBuffer();
    const engineRef = this.engine;

    const tracker: ElementTracker = {
      elementId: element.id,
      get current() {
        return current;
      },
      async start() {
        if (running) return;
        running = true;
        timer = setInterval(async () => {
          try {
            const screenshot = await captureBufferFn();
            const found = await engineRef.detectElements(screenshot, element.id);
            const next = found[0] ?? null;
            if (JSON.stringify(next?.bounds) !== JSON.stringify(current?.bounds)) {
              current = next;
              callbacks.forEach((cb) => cb(current));
            }
          } catch {
            // Ignore transient errors
          }
        }, intervalMs) as unknown as ReturnType<typeof setInterval>;
      },
      stop() {
        running = false;
        if (timer) clearInterval(timer);
        timer = null;
      },
      onChange(cb) {
        callbacks.push(cb);
      },
    };

    await tracker.start();
    return tracker;
  }

  /**
   * Wait until an element matching `query` stops moving (position stable for 2+ polls).
   *
   * @param query     - Element search query.
   * @param timeoutMs - Maximum wait time in ms (default 5000).
   */
  async waitForElementStable(
    query: string,
    timeoutMs = 5000
  ): Promise<DetectedElement | null> {
    const deadline = Date.now() + timeoutMs;
    let lastBounds: string | null = null;
    let stableCount = 0;

    while (Date.now() < deadline) {
      const screenshot = await this.captureBuffer();
      const elements = await this.engine.detectElements(screenshot, query);
      const el = elements[0] ?? null;
      const boundsKey = el ? JSON.stringify(el.bounds) : null;

      if (boundsKey && boundsKey === lastBounds) {
        stableCount++;
        if (stableCount >= 2) return el;
      } else {
        stableCount = 0;
        lastBounds = boundsKey;
      }
      await sleep(150);
    }
    return null;
  }

  /**
   * Wait until an element matching `query` appears on screen.
   *
   * @param query     - Element search query.
   * @param timeoutMs - Maximum wait time in ms (default 10 000).
   */
  async waitForElement(
    query: string,
    timeoutMs = 10_000
  ): Promise<DetectedElement | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const screenshot = await this.captureBuffer();
      const elements = await this.engine.detectElements(screenshot, query);
      if (elements.length > 0) return elements[0]!;
      await sleep(200);
    }
    return null;
  }

  /**
   * Wait until an element matching `query` disappears from the screen.
   *
   * @param query     - Element search query.
   * @param timeoutMs - Maximum wait time in ms (default 10 000).
   */
  async waitForElementGone(
    query: string,
    timeoutMs = 10_000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const screenshot = await this.captureBuffer();
      const elements = await this.engine.detectElements(screenshot, query);
      if (elements.length === 0) return true;
      await sleep(200);
    }
    return false;
  }

  // =========================================================================
  // UC-A10: Icon / Image Semantic Recognition
  // =========================================================================

  /**
   * Classify the image content within a screen region.
   *
   * Delegates to the ClaudeVision provider for semantic classification.
   *
   * @param screenshot - Full screenshot buffer.
   * @param region     - The region of interest within the screenshot.
   */
  async classifyImage(
    screenshot: Buffer,
    region: BoundsRect
  ): Promise<ImageClassification> {
    // Crop region — ask VisionEngine to describe it
    const result = await this.engine.verifyState(
      screenshot,
      `What is shown in the region x=${region.x} y=${region.y} w=${region.width} h=${region.height}? Classify the icon or image.`
    );

    return {
      label: result.description.split(/[,;.]/)[0]?.trim() ?? "unknown",
      confidence: result.confidence,
      alternativeLabels: [],
    };
  }

  /**
   * Find all on-screen icons matching a semantic description.
   *
   * @param iconDescription - Natural language description, e.g. "shopping cart icon".
   * @param screenshot      - Optional screenshot; captured fresh if not provided.
   */
  async findIcon(
    iconDescription: string,
    screenshot?: Buffer
  ): Promise<DetectedElement[]> {
    const buf = screenshot ?? (await this.captureBuffer());
    return this.engine.detectElements(buf, `icon: ${iconDescription}`);
  }

  /**
   * Find all locations where a template image appears in the screenshot.
   *
   * Uses a pixel-sampling heuristic for a rough match; for production use
   * pair with a native template-matching implementation.
   *
   * @param template   - Template image buffer (PNG).
   * @param screenshot - Full screenshot; captured fresh if not provided.
   */
  async matchTemplate(
    template: Buffer,
    screenshot?: Buffer
  ): Promise<TemplateMatch[]> {
    const buf = screenshot ?? (await this.captureBuffer());
    // Persist template to a temp file and use screencapture comparison as a proxy
    const tmpTemplate = join(tmpdir(), `tpl-${randomUUID()}.png`);
    const tmpScreen = join(tmpdir(), `scr-${randomUUID()}.png`);

    try {
      await writeFile(tmpTemplate, template);
      await writeFile(tmpScreen, buf);

      // Use ImageMagick `compare` if available
      const { stdout } = await execAsync(
        `convert ${JSON.stringify(tmpScreen)} ${JSON.stringify(tmpTemplate)} -metric RMSE -compare -format "%[distortion]" info: 2>&1`
      );
      const distortion = parseFloat(stdout.trim());
      const confidence = Math.max(0, 1 - distortion);

      if (confidence > 0.5) {
        const capture = await this.surface.captureScreen();
        return [
          {
            bounds: { x: 0, y: 0, width: capture.width, height: capture.height },
            confidence,
          },
        ];
      }
      return [];
    } catch {
      // ImageMagick not available — use VisionEngine semantic match
      const label = "template image match";
      const elements = await this.engine.detectElements(buf, label);
      return elements.map((el) => ({ bounds: el.bounds, confidence: el.confidence }));
    } finally {
      await Promise.allSettled([
        unlink(tmpTemplate),
        unlink(tmpScreen),
      ]);
    }
  }

  // =========================================================================
  // UC-A11: Theme / Color Palette Detection
  // =========================================================================

  /**
   * Detect the current UI theme (light/dark/high-contrast).
   *
   * First checks system preference via AppleScript; falls back to pixel analysis.
   *
   * @param screenshot - Optional screenshot buffer; captured fresh if not provided.
   */
  async detectTheme(screenshot?: Buffer): Promise<ThemeInfo> {
    // Check macOS dark mode setting
    const isDark = await this.isDarkMode();

    const buf = screenshot ?? (await this.captureBuffer());
    const palette = await this.getColorPalette(buf);

    return {
      isDark,
      accentColor: palette.palette[1]?.hex ?? "#007AFF",
      backgroundColor: palette.dominant.hex,
      foregroundColor: isDark ? "#FFFFFF" : "#000000",
      name: isDark ? "dark" : "light",
    };
  }

  /**
   * Extract the dominant color palette from a screenshot.
   *
   * Samples every 16th pixel row and column, then clusters colors into
   * at most 8 buckets using a simplified median-cut algorithm.
   *
   * @param screenshot - Optional screenshot buffer; captured fresh if not provided.
   */
  async getColorPalette(screenshot?: Buffer): Promise<ColorPalette> {
    const buf = screenshot ?? (await this.captureBuffer());
    return extractColorPalette(buf);
  }

  /**
   * Check whether macOS is currently in dark mode.
   *
   * Uses AppleScript to query the system preference (fast, no screen read needed).
   */
  async isDarkMode(): Promise<boolean> {
    try {
      const result = await runAppleScript(
        'tell application "System Events" to tell appearance preferences to return dark mode'
      );
      return result.trim().toLowerCase() === "true";
    } catch {
      // Fallback: analyse pixel brightness
      const buf = await this.captureBuffer();
      const palette = extractColorPalette(buf);
      const { r, g, b } = palette.dominant.rgb;
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.4;
    }
  }

  // =========================================================================
  // UC-A12: Table / Grid Data Extraction
  // =========================================================================

  /**
   * Extract tabular data from a screenshot region using OCR and grid heuristics.
   *
   * @param screenshot - Screenshot buffer containing the table.
   * @param region     - Optional crop region; full image used if omitted.
   */
  async extractTable(
    screenshot: Buffer,
    region?: BoundsRect
  ): Promise<TableData> {
    const buf = region
      ? await this.captureBuffer(region)
      : screenshot;

    // Use OCR to get all words with bounding boxes
    await this.localOcr.init();
    const elements = await this.localOcr.detectElements(buf, "");

    return buildTableFromElements(elements);
  }

  /**
   * Detect table regions within the current screen.
   *
   * Uses VisionEngine to identify grid/table structures.
   *
   * @param screenshot - Optional screenshot; captured fresh if not provided.
   */
  async detectTables(screenshot?: Buffer): Promise<TableRegion[]> {
    const buf = screenshot ?? (await this.captureBuffer());
    const elements = await this.engine.detectElements(buf, "table grid spreadsheet");

    return elements
      .filter((el) => el.confidence > 0.5)
      .map((el) => ({
        bounds: el.bounds,
        estimatedRows: Math.max(1, Math.round(el.bounds.height / 24)),
        estimatedCols: Math.max(1, Math.round(el.bounds.width / 80)),
      }));
  }

  /**
   * Convert extracted table data to an array of JSON row objects.
   *
   * @param table - TableData from {@link extractTable}.
   */
  tableToJSON(table: TableData): Record<string, unknown>[] {
    return table.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      table.headers.forEach((header, i) => {
        obj[header || `col${i}`] = row[i] ?? "";
      });
      return obj;
    });
  }

  /**
   * Convert extracted table data to a CSV string.
   *
   * @param table - TableData from {@link extractTable}.
   */
  tableToCSV(table: TableData): string {
    const escape = (v: string) =>
      v.includes(",") || v.includes('"') || v.includes("\n")
        ? `"${v.replace(/"/g, '""')}"`
        : v;

    const lines = [
      table.headers.map(escape).join(","),
      ...table.rows.map((row) => row.map(escape).join(",")),
    ];
    return lines.join("\n");
  }

  // =========================================================================
  // UC-A13: Popup / Modal / Dialog Handling
  // =========================================================================

  /**
   * Detect whether a modal or dialog is currently on screen.
   *
   * Checks the macOS accessibility tree for modal windows first,
   * then falls back to VisionEngine detection.
   */
  async detectModal(): Promise<ModalInfo | null> {
    try {
      const result = await runAppleScript(`
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set modalWindows to every window of frontApp whose modal is true
          if (count of modalWindows) > 0 then
            set w to first item of modalWindows
            set wTitle to name of w
            set btns to name of every button of w
            return wTitle & "|" & (btns as string)
          end if
          return ""
        end tell
      `);

      if (!result) return null;

      const [title, btnStr] = result.split("|");
      const buttons = (btnStr ?? "")
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean);

      const capture = await this.surface.captureScreen();
      return {
        title: title?.trim() || null,
        message: null,
        buttons,
        type: inferModalType(buttons),
        bounds: { x: 0, y: 0, width: capture.width, height: capture.height },
      };
    } catch {
      // Fall back to vision detection
      const buf = await this.captureBuffer();
      const elements = await this.engine.detectElements(
        buf,
        "dialog modal popup alert window"
      );
      if (elements.length === 0) return null;

      const el = elements[0]!;
      return {
        title: el.text ?? null,
        message: null,
        buttons: [],
        type: "unknown",
        bounds: el.bounds,
      };
    }
  }

  /**
   * Dismiss the currently visible modal using keyboard or button click.
   *
   * @param action - How to dismiss: "accept" (Return/OK), "dismiss" (Escape/Cancel), "close" (⌘W),
   *                 "allow" / "allow_always" / "allow_once" / "deny" for permission dialogs.
   */
  async dismissModal(
    action: "accept" | "dismiss" | "close" | "allow" | "allow_always" | "allow_once" | "deny" = "dismiss"
  ): Promise<boolean> {
    const modal = await this.detectModal();
    if (!modal) return false;

    // Permission dialog actions: find and click the appropriate button
    if (action === "allow" || action === "allow_always" || action === "allow_once" || action === "deny") {
      const permInfo = await this.detectPermissionDialog();

      // Determine the target button label
      const isAllow = action !== "deny";
      const targetLabel = isAllow ? permInfo?.allowButton : permInfo?.denyButton;

      logger.info(
        `[AdvancedVision] Permission dialog action="${action}"` +
        ` app="${permInfo?.app ?? "unknown"}" resource="${permInfo?.resource ?? "unknown"}"` +
        ` button="${targetLabel ?? "(keyboard fallback)"}"`
      );

      if (targetLabel) {
        // Click the identified button via AppleScript
        const clicked = await runAppleScript(`
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set modalWindows to every window of frontApp whose modal is true
            if (count of modalWindows) > 0 then
              set w to first item of modalWindows
              click button "${targetLabel.replace(/"/g, '\\"')}" of w
              return "ok"
            end if
            return ""
          end tell
        `).catch(() => "");

        if (clicked === "ok") {
          await sleep(200);
          return true;
        }
      }

      // Keyboard fallback: allow = Return, deny = Escape
      await this.surface.keyTap(isAllow ? "return" : "escape");
      await sleep(200);
      return true;
    }

    switch (action) {
      case "accept":
        await this.surface.keyTap("return");
        break;
      case "dismiss":
        await this.surface.keyTap("escape");
        break;
      case "close":
        await this.surface.keyTap("w", { meta: true });
        break;
    }
    await sleep(200);
    return true;
  }

  /**
   * Detect and parse a permission dialog currently on screen.
   *
   * Captures the screen, OCRs the dialog, and extracts structured information
   * about which app is requesting access, what resource is targeted, and which
   * buttons allow or deny the request.
   *
   * @returns Structured {@link PermissionDialogInfo}, or `null` if no permission dialog is visible.
   */
  async detectPermissionDialog(): Promise<PermissionDialogInfo | null> {
    // ── Step 1: Check if any modal is present ────────────────────────────────
    const modal = await this.detectModal();
    if (!modal) return null;

    // ── Step 2: OCR the dialog region to get full text ───────────────────────
    const buf = await this.captureBuffer(modal.bounds);
    const elements = await this.localOcr.detectElements(buf, "");
    const rawText = elements.map((e) => e.text ?? "").join(" ").trim();

    // ── Step 3: Confirm this looks like a permission dialog ──────────────────
    const combinedType = inferModalTypeFromText(modal.buttons, rawText);
    if (combinedType !== "permission") return null;

    // ── Step 4: Identify the requesting app ──────────────────────────────────
    let app = "Unknown";
    try {
      app = await runAppleScript(`
        tell application "System Events"
          return name of first application process whose frontmost is true
        end tell
      `);
    } catch { /* best-effort */ }

    // ── Step 5: Classify dialog type ─────────────────────────────────────────
    const lowerText = rawText.toLowerCase();
    let dialogType: PermissionDialogInfo["type"] = "app_dialog";
    if (
      lowerText.includes("screen recording") ||
      lowerText.includes("accessibility") ||
      lowerText.includes("full disk access") ||
      lowerText.includes("files and folders") ||
      lowerText.includes("automation") ||
      lowerText.includes("input monitoring")
    ) {
      dialogType = "macos_system";
    } else if (
      lowerText.includes("terminal") ||
      lowerText.includes("shell") ||
      lowerText.includes("claude code") ||
      lowerText.includes("approve") ||
      lowerText.includes("reject")
    ) {
      dialogType = "terminal_prompt";
    } else if (lowerText.includes("browser") || lowerText.includes("safari") || lowerText.includes("chrome")) {
      dialogType = "browser";
    }

    // ── Step 6: Extract the requested resource ────────────────────────────────
    // Heuristic: path-like strings, or the phrase after "access to"
    const resourceMatch =
      rawText.match(/access to ([^\n.]+)/i) ??
      rawText.match(/([~/][^\s]+)/) ??
      rawText.match(/(?:read|write|modify|delete|execute)\s+([^\n.]+)/i);
    const resource = resourceMatch?.[1]?.trim() ?? "unknown";

    // ── Step 7: Determine the access action ──────────────────────────────────
    let accessAction: PermissionDialogInfo["action"] = "full_access";
    if (lowerText.includes("read") && !lowerText.includes("write")) {
      accessAction = "read";
    } else if (lowerText.includes("write") || lowerText.includes("modify")) {
      accessAction = "write";
    } else if (lowerText.includes("execute") || lowerText.includes("run")) {
      accessAction = "execute";
    }

    // ── Step 8: Identify allow / deny buttons ────────────────────────────────
    const ALLOW_LABELS = ["allow", "ok", "yes", "grant", "approve", "cho phép", "allow always", "allow once"];
    const DENY_LABELS  = ["deny", "don't allow", "no", "block", "reject", "cancel", "từ chối"];

    const allowButton = modal.buttons.find((b) =>
      ALLOW_LABELS.some((lbl) => b.toLowerCase().includes(lbl))
    );
    const denyButton = modal.buttons.find((b) =>
      DENY_LABELS.some((lbl) => b.toLowerCase().includes(lbl))
    );

    return {
      type: dialogType,
      app,
      resource,
      action: accessAction,
      buttons: modal.buttons,
      ...(allowButton !== undefined && { allowButton }),
      ...(denyButton  !== undefined && { denyButton }),
      rawText,
    };
  }

  /**
   * Get the full content of the currently visible modal, including inputs.
   */
  async getModalContent(): Promise<ModalContent | null> {
    const modal = await this.detectModal();
    if (!modal) return null;

    const buf = await this.captureBuffer(modal.bounds);
    const elements = await this.localOcr.detectElements(buf, "");
    const text = elements.map((e) => e.text ?? "").join(" ");

    return {
      ...modal,
      message: text.slice(0, 500) || null,
      checkboxes: [],
    };
  }

  /**
   * Wait until a modal appears on screen.
   *
   * @param timeoutMs - Maximum wait time in ms (default 5000).
   */
  async waitForModal(timeoutMs = 5000): Promise<ModalInfo | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const modal = await this.detectModal();
      if (modal) return modal;
      await sleep(200);
    }
    return null;
  }

  /**
   * Automatically handle any open modal by applying matching rules.
   *
   * If no rule matches, the modal is dismissed via Escape.
   *
   * @param rules - Ordered list of rules; first match wins.
   */
  async autoHandleModal(rules: ModalRule[] = []): Promise<ModalAction> {
    const modal = await this.detectModal();
    if (!modal) return { handled: false, action: "none" };

    for (const rule of rules) {
      const titleOk = !rule.titlePattern || rule.titlePattern.test(modal.title ?? "");
      const msgOk = !rule.messagePattern || rule.messagePattern.test(modal.message ?? "");
      if (titleOk && msgOk) {
        await this.dismissModal(rule.action);
        return { handled: true, action: rule.action, matchedRule: rule };
      }
    }

    // Default: dismiss
    await this.dismissModal("dismiss");
    return { handled: true, action: "dismiss" };
  }

  // =========================================================================
  // UC-A14: Captcha / Verification Detection
  // =========================================================================

  /**
   * Detect whether a CAPTCHA is visible on the current screen.
   *
   * Uses VisionEngine semantic detection and keyword analysis.
   *
   * @param screenshot - Optional screenshot; captured fresh if not provided.
   */
  async detectCaptcha(screenshot?: Buffer): Promise<CaptchaInfo | null> {
    const buf = screenshot ?? (await this.captureBuffer());
    const elements = await this.engine.detectElements(
      buf,
      "captcha verification challenge recaptcha hcaptcha I am not a robot"
    );

    if (elements.length === 0) return null;

    const el = elements[0]!;
    const text = (el.text ?? "").toLowerCase();
    let type: CaptchaInfo["type"] = "unknown";
    let providerHint: string | undefined;

    if (text.includes("recaptcha")) { type = "recaptcha"; providerHint = "Google reCAPTCHA"; }
    else if (text.includes("hcaptcha")) { type = "hcaptcha"; providerHint = "hCaptcha"; }
    else if (text.includes("audio")) { type = "audio"; }
    else if (text.includes("robot") || text.includes("human")) { type = "image"; }
    else { type = "text"; }

    return {
      type,
      bounds: el.bounds,
      confidence: el.confidence,
      providerHint,
    };
  }

  /**
   * Quick check: is a CAPTCHA currently visible?
   */
  async isCaptchaPresent(): Promise<boolean> {
    return (await this.detectCaptcha()) !== null;
  }

  /**
   * Notify the user that a CAPTCHA requires manual intervention.
   *
   * Sends a system notification via AppleScript.
   *
   * @param captchaInfo - CAPTCHA details from {@link detectCaptcha}.
   */
  async notifyUserCaptcha(captchaInfo: CaptchaInfo): Promise<void> {
    const message = `CAPTCHA detected (${captchaInfo.type}${captchaInfo.providerHint ? ` — ${captchaInfo.providerHint}` : ""}). Manual intervention required.`;
    try {
      await runAppleScript(
        `display notification "${message}" with title "OmniState — CAPTCHA" sound name "Ping"`
      );
    } catch {
      logger.warn(`[AdvancedVision] ${message}`);
    }
  }

  // =========================================================================
  // UC-A15: Cross-App Drag & Drop
  // =========================================================================

  /**
   * Drag an element from one window to a specific position in another window.
   *
   * Uses CGEvent-level drag (SurfaceLayer.drag) after focusing the source window.
   *
   * @param sourceElement - Element to drag.
   * @param targetWindow  - Destination window.
   * @param targetPos     - Target drop position in screen coordinates.
   */
  async dragBetweenWindows(
    sourceElement: DetectedElement,
    _targetWindow: WindowInfo,
    targetPos: Point
  ): Promise<boolean> {
    try {
      const srcCx = sourceElement.bounds.x + sourceElement.bounds.width / 2;
      const srcCy = sourceElement.bounds.y + sourceElement.bounds.height / 2;

      // Activate source app
      await this.surface.moveMouse(srcCx, srcCy);
      await sleep(50);

      // Drag to target
      await this.surface.drag(srcCx, srcCy, targetPos.x, targetPos.y);
      await sleep(100);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Drag files from the filesystem into a running application.
   *
   * Uses AppleScript + Finder to initiate a Finder-level drag.
   *
   * @param filePaths - Absolute paths of files to drag.
   * @param appName   - Name of the target application (e.g. "Slack").
   */
  async dragFilesToApp(
    filePaths: string[],
    appName: string
  ): Promise<boolean> {
    if (filePaths.length === 0) return false;

    try {
      const posixList = filePaths.map((p) => `POSIX file "${p}"`).join(", ");
      await runAppleScript(`
        tell application "Finder"
          activate
        end tell
        tell application "${appName}"
          activate
          open { ${posixList} }
        end tell
      `);
      return true;
    } catch {
      return false;
    }
  }

  // =========================================================================
  // UC-A16: Context Menu Handling
  // =========================================================================

  /**
   * Right-click on an element to open its context menu, then detect menu items.
   *
   * @param element - Element to right-click.
   */
  async openContextMenu(element: DetectedElement): Promise<ContextMenu> {
    const cx = element.bounds.x + element.bounds.width / 2;
    const cy = element.bounds.y + element.bounds.height / 2;

    await this.surface.moveMouse(cx, cy);
    await sleep(50);
    await this.surface.click("right");
    await sleep(300); // Allow menu animation

    const items = await this.getContextMenuItems();

    return {
      items,
      bounds: { x: cx, y: cy, width: 200, height: items.length * 24 },
    };
  }

  /**
   * Detect and return all items in the currently visible context menu.
   */
  async getContextMenuItems(): Promise<MenuItem[]> {
    try {
      const result = await runAppleScript(`
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set menuItems to every menu item of menu 1 of frontApp
          set result to {}
          repeat with mi in menuItems
            set miName to name of mi
            set miEnabled to enabled of mi
            set end of result to miName & "|" & (miEnabled as string)
          end repeat
          return result
        end tell
      `);

      return result
        .split(",")
        .map((line, i) => {
          const [text, enabledStr] = line.trim().split("|");
          return {
            text: text?.trim() ?? "",
            enabled: enabledStr?.trim() !== "false",
            hasSubmenu: false,
            bounds: { x: 0, y: i * 24, width: 200, height: 24 },
          };
        })
        .filter((item) => item.text && item.text !== "missing value");
    } catch {
      // Fallback: use OCR on current screen to find menu-like text
      const buf = await this.captureBuffer();
      const elements = await this.localOcr.detectElements(buf, "menu item");
      return elements.map((el) => ({
        text: el.text ?? "",
        enabled: true,
        hasSubmenu: false,
        bounds: el.bounds,
      }));
    }
  }

  /**
   * Click a context menu item by its text label.
   *
   * @param itemText - Exact or partial text label of the menu item.
   */
  async selectContextMenuItem(itemText: string): Promise<boolean> {
    const items = await this.getContextMenuItems();
    const target = items.find(
      (item) =>
        item.enabled &&
        item.text.toLowerCase().includes(itemText.toLowerCase())
    );

    if (!target) return false;

    const cx = target.bounds.x + target.bounds.width / 2;
    const cy = target.bounds.y + target.bounds.height / 2;
    await this.surface.moveMouse(cx, cy);
    await sleep(50);
    await this.surface.click("left");
    return true;
  }

  /**
   * Dismiss the currently open context menu by pressing Escape.
   */
  async dismissContextMenu(): Promise<boolean> {
    await this.surface.keyTap("escape");
    await sleep(100);
    return true;
  }

  // =========================================================================
  // UC-A17: Deep / Infinite Scroll
  // =========================================================================

  /**
   * Scroll to the bottom of the current view.
   *
   * @param maxScrolls - Maximum number of scroll events to fire (default 50).
   * @returns Number of scroll events fired.
   */
  async scrollToBottom(maxScrolls = 50): Promise<number> {
    let count = 0;
    let prevHash = "";

    while (count < maxScrolls) {
      await this.surface.scroll(0, -300); // Scroll down
      await sleep(200);
      count++;

      const buf = await this.captureBuffer();
      const hash = quickHash(buf);
      if (hash === prevHash) break; // No change — already at bottom
      prevHash = hash;
    }

    return count;
  }

  /**
   * Scroll until an element matching `query` becomes visible.
   *
   * @param query      - Element search query.
   * @param maxScrolls - Maximum scroll events before giving up (default 30).
   */
  async scrollToElement(
    query: string,
    maxScrolls = 30
  ): Promise<DetectedElement | null> {
    for (let i = 0; i < maxScrolls; i++) {
      const buf = await this.captureBuffer();
      const elements = await this.engine.detectElements(buf, query);
      if (elements.length > 0) return elements[0]!;

      await this.surface.scroll(0, -200);
      await sleep(200);
    }
    return null;
  }

  /**
   * Scroll until a user-supplied predicate returns true.
   *
   * @param predicate  - Async function that receives the current screenshot and returns true when done.
   * @param maxScrolls - Maximum scroll events (default 50).
   */
  async scrollUntilFound(
    predicate: (screenshot: Buffer) => Promise<boolean>,
    maxScrolls = 50
  ): Promise<boolean> {
    for (let i = 0; i < maxScrolls; i++) {
      const buf = await this.captureBuffer();
      if (await predicate(buf)) return true;

      await this.surface.scroll(0, -200);
      await sleep(200);
    }
    return false;
  }

  /**
   * Load all content in an infinite-scroll page by scrolling to the bottom repeatedly
   * until no new content loads.
   *
   * @param maxPages - Maximum number of "page loads" to trigger (default 20).
   * @returns Estimated number of new items loaded.
   */
  async loadAllInfiniteScroll(maxPages = 20): Promise<number> {
    let totalLoaded = 0;
    let prevElementCount = 0;

    for (let page = 0; page < maxPages; page++) {
      await this.scrollToBottom(10);
      await sleep(1000); // Wait for network load

      const elements = await this.surface.getUIElements();
      const newCount = elements.length;

      if (newCount <= prevElementCount) break; // No new items
      totalLoaded += newCount - prevElementCount;
      prevElementCount = newCount;
    }

    return totalLoaded;
  }

  // =========================================================================
  // UC-A18: Clipboard Image Sync
  // =========================================================================

  /**
   * Read the current clipboard contents as an image buffer.
   *
   * Returns `null` if the clipboard doesn't contain an image.
   */
  async getClipboardImage(): Promise<Buffer | null> {
    const tmpPath = join(tmpdir(), `clipboard-${randomUUID()}.png`);
    try {
      await execAsync(
        `osascript -e 'set the clipboard to (read (POSIX file "/dev/null") as JPEG picture)'`
      );
      // Use pngpaste or pbpaste to get image
      await execAsync(`pngpaste ${tmpPath}`);
      return await readFile(tmpPath);
    } catch {
      // pngpaste not available — try screencapture from clipboard
      try {
        await execAsync(`screencapture -c ${tmpPath}`);
        const buf = await readFile(tmpPath);
        return buf;
      } catch {
        return null;
      }
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  /**
   * Write an image buffer to the system clipboard.
   *
   * @param image - PNG image buffer.
   */
  async setClipboardImage(image: Buffer): Promise<boolean> {
    const tmpPath = join(tmpdir(), `clipboard-${randomUUID()}.png`);
    try {
      await writeFile(tmpPath, image);
      await execAsync(
        `osascript -e 'set the clipboard to (read (POSIX file "${tmpPath}") as TIFF picture)'`
      );
      return true;
    } catch {
      return false;
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  /**
   * OCR the image currently in the clipboard and return the extracted text.
   *
   * Returns `null` if no image is in the clipboard or OCR yields no text.
   */
  async ocrClipboardImage(): Promise<string | null> {
    const image = await this.getClipboardImage();
    if (!image) return null;

    await this.localOcr.init();
    const elements = await this.localOcr.detectElements(image, "");
    const text = elements.map((e) => e.text ?? "").join(" ").trim();
    return text || null;
  }

  /**
   * Classify the type of content currently in the clipboard.
   *
   * Checks for image first, then reads text clipboard for classification.
   */
  async classifyClipboardContent(): Promise<ClipboardClassification> {
    const image = await this.getClipboardImage();
    if (image) {
      return { type: "image", confidence: 0.95, description: "Image data in clipboard" };
    }

    try {
      const { stdout: text } = await execAsync("pbpaste");
      const trimmed = text.trim();

      if (!trimmed) {
        return { type: "unknown", confidence: 1.0, description: "Clipboard is empty" };
      }
      if (/^https?:\/\//.test(trimmed)) {
        return { type: "url", confidence: 0.95, description: `URL: ${trimmed.slice(0, 80)}` };
      }
      if (/^\/[\w/.-]+$/.test(trimmed)) {
        return { type: "file_path", confidence: 0.9, description: `File path: ${trimmed.slice(0, 80)}` };
      }
      if (/^[\s\S]*[{}\[\]();][\s\S]*$/.test(trimmed)) {
        return { type: "code", confidence: 0.7, description: "Looks like code" };
      }
      return { type: "text", confidence: 0.8, description: `Text (${trimmed.length} chars)` };
    } catch {
      return { type: "unknown", confidence: 0.5, description: "Could not read clipboard" };
    }
  }

  // =========================================================================
  // UC-A19: Accessibility Audit
  // =========================================================================

  /**
   * Run a full accessibility audit of the current screen.
   *
   * Checks: contrast ratios, missing labels, small tap targets, keyboard focus indicators.
   *
   * @param screenshot - Optional screenshot; captured fresh if not provided.
   */
  async auditAccessibility(screenshot?: Buffer): Promise<AccessibilityReport> {
    const buf = screenshot ?? (await this.captureBuffer());
    const issues: AccessibilityIssue[] = [];
    const passedChecks: string[] = [];

    // Check 1: Missing labels
    const unlabeled = await this.findMissingLabels();
    if (unlabeled.length > 0) {
      issues.push({
        severity: "error",
        rule: "WCAG 1.1.1",
        description: `${unlabeled.length} interactive element(s) missing accessible labels`,
        element: unlabeled[0],
      });
    } else {
      passedChecks.push("All interactive elements have labels");
    }

    // Check 2: Small tap targets
    const smallTargets = await this.findSmallTapTargets(44);
    if (smallTargets.length > 0) {
      issues.push({
        severity: "warning",
        rule: "WCAG 2.5.5",
        description: `${smallTargets.length} tap target(s) smaller than 44×44pt`,
        element: smallTargets[0],
      });
    } else {
      passedChecks.push("All tap targets meet minimum size (44pt)");
    }

    // Check 3: Dark/light mode preference honoured
    const isDark = await this.isDarkMode();
    const palette = await this.getColorPalette(buf);
    const { r, g, b } = palette.dominant.rgb;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const modeMatches = isDark ? lum < 0.5 : lum >= 0.5;

    if (modeMatches) {
      passedChecks.push("UI respects system dark/light mode");
    } else {
      issues.push({
        severity: "info",
        rule: "WCAG 1.4.3",
        description: "UI colour scheme does not appear to match system dark-mode preference",
      });
    }

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const score = Math.max(
      0,
      100 - errorCount * 20 - warnCount * 10
    );

    return {
      score,
      issues,
      passedChecks,
      testedAt: Date.now(),
    };
  }

  /**
   * Check the WCAG contrast ratio between an element's foreground and background colors.
   *
   * @param element - The element to check (uses its bounding box to sample colors).
   */
  async checkContrast(element: DetectedElement): Promise<ContrastResult> {
    const buf = await this.captureBuffer(element.bounds);
    const palette = extractColorPalette(buf);

    // Use top 2 colors as foreground/background
    const bg = palette.palette[0] ?? { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 }, frequency: 1 };
    const fg = palette.palette[1] ?? { hex: "#000000", rgb: { r: 0, g: 0, b: 0 }, frequency: 0 };

    const ratio = wcagContrastRatio(fg.rgb, bg.rgb);

    return {
      ratio,
      wcagAA: ratio >= 4.5,
      wcagAAA: ratio >= 7.0,
      foreground: fg.hex,
      background: bg.hex,
    };
  }

  /**
   * Find interactive elements that appear to have no accessible label.
   *
   * Uses the accessibility tree — elements with empty `text` and non-generic `type`.
   */
  async findMissingLabels(): Promise<DetectedElement[]> {
    const elements = await this.surface.getUIElements();
    const interactiveTypes = new Set([
      "button", "AXButton", "link", "AXLink",
      "textField", "AXTextField", "checkBox", "AXCheckBox",
    ]);

    return elements.filter(
      (el) => interactiveTypes.has(el.type) && !el.text?.trim()
    );
  }

  /**
   * Find interactive elements whose tap target is smaller than `minSize` points.
   *
   * @param minSize - Minimum width AND height in points (default 44).
   */
  async findSmallTapTargets(minSize = 44): Promise<DetectedElement[]> {
    const elements = await this.surface.getUIElements();
    return elements.filter(
      (el) =>
        el.bounds.width < minSize || el.bounds.height < minSize
    );
  }

  // =========================================================================
  // UC-A20: UI Language Detection
  // =========================================================================

  /**
   * Detect the language of text visible in the current screenshot.
   *
   * Uses macOS NLLanguageRecognizer (via osascript JXA) with OCR text as input.
   *
   * @param screenshot - Optional screenshot; captured fresh if not provided.
   */
  async detectUILanguage(screenshot?: Buffer): Promise<LanguageDetection> {
    const buf = screenshot ?? (await this.captureBuffer());

    // Extract text via OCR
    await this.localOcr.init();
    const elements = await this.localOcr.detectElements(buf, "");
    const text = elements.map((e) => e.text ?? "").join(" ").trim();

    if (!text) {
      return { language: "und", confidence: 0, script: "Unknown", rtl: false };
    }

    // Try macOS NLLanguageRecognizer via JXA
    try {
      const safeText = text.slice(0, 200).replace(/"/g, '\\"');
      const { stdout } = await execAsync(`osascript -l JavaScript -e ${JSON.stringify(`
        ObjC.import('NaturalLanguage');
        const recognizer = $.NLLanguageRecognizer.alloc.init;
        recognizer.processString(${JSON.stringify(safeText)});
        const hypos = ObjC.deepUnwrap(recognizer.languageHypothesesWithMaximum(3));
        JSON.stringify(hypos);
      `)}`);

      const hypos = JSON.parse(stdout.trim()) as Record<string, number>;
      const entries = Object.entries(hypos).sort((a, b) => b[1] - a[1]);
      const [lang, conf] = entries[0] ?? ["en", 0.5];

      return {
        language: lang,
        confidence: conf,
        script: detectScript(text),
        rtl: RTL_LANGUAGES.has(lang),
      };
    } catch {
      // Fallback: heuristic script detection
      const script = detectScript(text);
      return {
        language: "en",
        confidence: 0.3,
        script,
        rtl: false,
      };
    }
  }

  /**
   * Select the best Tesseract OCR model language code for a given language.
   *
   * Returns a Tesseract language string (e.g. "eng", "chi_sim", "ara").
   *
   * @param language - ISO 639-1 language code (e.g. "en", "zh", "ar").
   */
  async selectBestOCRModel(language: string): Promise<string> {
    const map: Record<string, string> = {
      en: "eng",
      zh: "chi_sim",
      "zh-TW": "chi_tra",
      ja: "jpn",
      ko: "kor",
      ar: "ara",
      hi: "hin",
      de: "deu",
      fr: "fra",
      es: "spa",
      pt: "por",
      ru: "rus",
      it: "ita",
      nl: "nld",
      pl: "pol",
      tr: "tur",
      vi: "vie",
      th: "tha",
    };

    return map[language] ?? "eng";
  }
}

// =============================================================================
// Private utility functions
// =============================================================================

/** Compute approximate percentage of pixels that differ between two buffers. */
function computePixelDiff(a: Buffer, b: Buffer): number {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let diffCount = 0;
  const step = 4; // Compare every 4th byte (approx per-pixel for RGBA)

  for (let i = 0; i < len; i += step) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 10) diffCount++;
  }

  return (diffCount / (len / step)) * 100;
}

/** Check if two rectangles overlap. */
function rectsOverlap(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Keywords whose presence in button labels or dialog text signals a permission dialog. */
const PERMISSION_KEYWORDS = [
  "allow", "deny", "don't allow", "block", "permission",
  "access", "would like to", "wants to access",
  "grant", "authorize", "cho phép", "từ chối",
  // macOS system privacy dialogs
  "screen recording", "accessibility", "full disk access",
  "files and folders", "automation", "input monitoring",
  // Claude Code / terminal permission prompts
  "read", "write", "execute", "modify", "delete",
  "approve", "reject", "yes", "no",
];

/** Infer modal type from its button labels. */
function inferModalType(buttons: string[]): ModalInfo["type"] {
  const lowerBtns = buttons.map((b) => b.toLowerCase());

  // Permission dialogs: look for allow/deny style buttons first
  if (
    lowerBtns.some((b) =>
      PERMISSION_KEYWORDS.some((kw) => b.includes(kw))
    ) &&
    lowerBtns.some((b) =>
      ["allow", "deny", "don't allow", "block", "approve", "reject",
       "yes", "no", "grant", "cho phép", "từ chối"].some((kw) => b.includes(kw))
    )
  ) {
    return "permission";
  }

  if (lowerBtns.includes("ok") && lowerBtns.includes("cancel")) return "confirm";
  if (lowerBtns.some((b) => b.includes("ok") || b.includes("close"))) return "alert";
  if (lowerBtns.includes("save")) return "sheet";
  return "unknown";
}

/**
 * Infer modal type from both button labels AND full dialog text.
 * Used by detectPermissionDialog() which has access to OCR text.
 */
function inferModalTypeFromText(buttons: string[], text: string): ModalInfo["type"] {
  const lowerText = text.toLowerCase();
  if (PERMISSION_KEYWORDS.some((kw) => lowerText.includes(kw.toLowerCase()))) {
    return "permission";
  }
  return inferModalType(buttons);
}

/** Quick non-cryptographic hash of a buffer for change detection. */
function quickHash(buf: Buffer): string {
  let h = 0;
  const step = Math.max(1, Math.floor(buf.length / 256));
  for (let i = 0; i < buf.length; i += step) {
    h = (Math.imul(31, h) + (buf[i] ?? 0)) | 0;
  }
  return h.toString(16);
}

/**
 * Determine the dominant Unicode script in a text string.
 * Used as a fallback when NLLanguageRecognizer is unavailable.
 */
function detectScript(text: string): string {
  const cjk = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const arabic = (text.match(/[\u0600-\u06ff]/g) ?? []).length;
  const cyrillic = (text.match(/[\u0400-\u04ff]/g) ?? []).length;
  const devanagari = (text.match(/[\u0900-\u097f]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;

  const counts: Array<[string, number]> = [
    ["CJK", cjk],
    ["Arabic", arabic],
    ["Cyrillic", cyrillic],
    ["Devanagari", devanagari],
    ["Latin", latin],
  ];

  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] ? counts[0][0] : "Unknown";
}

/** ISO 639-1 codes for RTL languages. */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ha", "ku"]);

// ---------------------------------------------------------------------------
// Color palette extraction (median-cut approximation)
// ---------------------------------------------------------------------------

/**
 * Extract a dominant color palette from a raw image buffer.
 *
 * Samples every ~16th pixel, rounds colors to 32-step buckets,
 * and returns the top 8 most frequent colors.
 */
function extractColorPalette(buf: Buffer): ColorPalette {
  if (buf.length < 4) {
    const fallback: ColorEntry = {
      hex: "#808080",
      rgb: { r: 128, g: 128, b: 128 },
      frequency: 1,
    };
    return { dominant: fallback, palette: [fallback], sampleSize: 0 };
  }

  const colorCounts = new Map<string, { r: number; g: number; b: number; count: number }>();
  const step = Math.max(4, Math.floor(buf.length / 10_000) * 4); // ~10k samples max
  let sampleSize = 0;

  for (let i = 0; i + 2 < buf.length; i += step) {
    const r = Math.round((buf[i] ?? 0) / 32) * 32;
    const g = Math.round((buf[i + 1] ?? 0) / 32) * 32;
    const b = Math.round((buf[i + 2] ?? 0) / 32) * 32;
    const key = `${r},${g},${b}`;
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorCounts.set(key, { r, g, b, count: 1 });
    }
    sampleSize++;
  }

  const sorted = [...colorCounts.values()].sort((a, b) => b.count - a.count);

  const toEntry = (c: { r: number; g: number; b: number; count: number }): ColorEntry => ({
    hex: `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`,
    rgb: { r: c.r, g: c.g, b: c.b },
    frequency: c.count / sampleSize,
  });

  const palette = sorted.slice(0, 8).map(toEntry);
  const dominant = palette[0] ?? {
    hex: "#808080",
    rgb: { r: 128, g: 128, b: 128 },
    frequency: 1,
  };

  return { dominant, palette, sampleSize };
}

// ---------------------------------------------------------------------------
// WCAG contrast ratio
// ---------------------------------------------------------------------------

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

function wcagContrastRatio(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Table reconstruction from OCR elements
// ---------------------------------------------------------------------------

/**
 * Reconstruct a table from a flat list of OCR word elements.
 *
 * Groups elements into rows by Y-coordinate proximity, then sorts
 * each row by X coordinate to form columns.
 */
function buildTableFromElements(elements: DetectedElement[]): TableData {
  if (elements.length === 0) {
    return { headers: [], rows: [], confidence: 0 };
  }

  // Sort by Y, then group into rows (elements within 12px of each other share a row)
  const sorted = [...elements].sort((a, b) => a.bounds.y - b.bounds.y);
  const rowGroups: DetectedElement[][] = [];
  let currentRow: DetectedElement[] = [];
  let rowY = sorted[0]!.bounds.y;

  for (const el of sorted) {
    if (Math.abs(el.bounds.y - rowY) <= 12) {
      currentRow.push(el);
    } else {
      if (currentRow.length > 0) rowGroups.push(currentRow);
      currentRow = [el];
      rowY = el.bounds.y;
    }
  }
  if (currentRow.length > 0) rowGroups.push(currentRow);

  // Sort each row by X
  const textRows = rowGroups.map((row) =>
    row
      .sort((a, b) => a.bounds.x - b.bounds.x)
      .map((el) => el.text ?? "")
  );

  const headers = textRows[0] ?? [];
  const rows = textRows.slice(1);
  const avgConfidence =
    elements.reduce((sum, el) => sum + el.confidence, 0) / elements.length;

  return { headers, rows, confidence: avgConfidence };
}
