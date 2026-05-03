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

import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { DetectedElement } from "../layers/surface.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Shared utility
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an AppleScript string and return stdout. */
export async function runAppleScript(script: string): Promise<string> {
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
  capture: import("../layers/surface.js").ScreenCapture;
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

export interface ActiveRecording {
  id: string;
  filePath: string;
  startTime: number;
  process: import("node:child_process").ChildProcess;
}

// ---------------------------------------------------------------------------
// Private utility functions
// ---------------------------------------------------------------------------

/** Compute approximate percentage of pixels that differ between two buffers. */
export function computePixelDiff(a: Buffer, b: Buffer): number {
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
export function rectsOverlap(a: BoundsRect, b: BoundsRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Keywords whose presence in button labels or dialog text signals a permission dialog. */
export const PERMISSION_KEYWORDS = [
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
export function inferModalType(buttons: string[]): ModalInfo["type"] {
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
export function inferModalTypeFromText(buttons: string[], text: string): ModalInfo["type"] {
  const lowerText = text.toLowerCase();
  if (PERMISSION_KEYWORDS.some((kw) => lowerText.includes(kw.toLowerCase()))) {
    return "permission";
  }
  return inferModalType(buttons);
}

/** Quick non-cryptographic hash of a buffer for change detection. */
export function quickHash(buf: Buffer): string {
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
export function detectScript(text: string): string {
  const cjk = (text.match(/[　-鿿豈-﫿]/g) ?? []).length;
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
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
export const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ha", "ku"]);

// ---------------------------------------------------------------------------
// Color palette extraction (median-cut approximation)
// ---------------------------------------------------------------------------

/**
 * Extract a dominant color palette from a raw image buffer.
 *
 * Samples every ~16th pixel, rounds colors to 32-step buckets,
 * and returns the top 8 most frequent colors.
 */
export function extractColorPalette(buf: Buffer): ColorPalette {
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

export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

export function wcagContrastRatio(
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
export function buildTableFromElements(elements: DetectedElement[]): TableData {
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