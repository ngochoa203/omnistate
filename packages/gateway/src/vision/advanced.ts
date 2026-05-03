/**
 * Advanced Vision — missing Domain A use cases (UC-A04 through UC-A20).
 *
 * Re-exports from modular files. See:
 *   advanced-types.ts    — interfaces, types, and standalone utilities
 *   advanced-analysis.ts — AdvancedVision class with all methods
 *
 * Original monolithic file has been split for better maintainability.
 */

// Re-export all types from advanced-types
export type {
  BoundsRect,
  Point,
  SceneState,
  ElementChange,
  StateDiff,
  DiffResult,
  MonitorInfo,
  SpaceInfo,
  TouchPoint,
  TouchGesture,
  RecordingOptions,
  RecordingResult,
  ActionEvent,
  ElementTracker,
  ImageClassification,
  TemplateMatch,
  ThemeInfo,
  ColorEntry,
  ColorPalette,
  TableData,
  TableRegion,
  ModalInfo,
  PermissionDialogInfo,
  ModalContent,
  ModalRule,
  ModalAction,
  CaptchaInfo,
  ContextMenu,
  MenuItem,
  ClipboardClassification,
  AccessibilityIssue,
  AccessibilityReport,
  ContrastResult,
  LanguageDetection,
  ActiveRecording,
} from "./advanced-types.js";

// Re-export standalone utilities from advanced-types
export {
  sleep,
  runAppleScript,
  computePixelDiff,
  rectsOverlap,
  PERMISSION_KEYWORDS,
  inferModalType,
  inferModalTypeFromText,
  quickHash,
  detectScript,
  RTL_LANGUAGES,
  extractColorPalette,
  relativeLuminance,
  wcagContrastRatio,
  buildTableFromElements,
} from "./advanced-types.js";

// Re-export the main class from advanced-analysis
export { AdvancedVision } from "./advanced-analysis.js";