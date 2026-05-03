// ── Planner barrel — re-exports from split modules ─────────────────────────────
// intent.ts was split into these modules:
//   types.ts       — interfaces, constants, LLM helpers, node factories
//   nlp.ts        — text preprocessing & normalization
//   classify.ts   — intent classification (LLM + heuristics)
//   planning.ts   — multi-step decomposition & planFromIntent
//   app-control.ts — AppleScript builders, keyboard shortcuts
//   shell.ts      — NL → shell command extraction
//   ui-chain.ts   — UI action chain parsing

// Re-export all public symbols to maintain the original import surface
export type { Intent, Entity, IntentContext, IntentType, DecomposedStep, FormField } from "./types.js";

export {
  INTENT_TYPES,
  CLASSIFICATION_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT_COMPACT,
  LEGACY_TOOL_ALIASES,
  SUPPORTED_DECOMPOSED_TOOLS,
} from "./types.js";

export {
  correctTypos,
  normalizeText,
  extractCoordinatePairs,
} from "./nlp.js";

// Alias extractQuotedText from nlp (avoid duplicate exports)
export { extractQuotedText as extractQuotedTextFromNlp } from "./nlp.js";

export {
  classifyIntent,
  classifyWithLLM,
  classifyWithHeuristics,
  QUICK_INTENT_MAP,
  PHRASE_PATTERNS,
  HEURISTIC_RULES,
} from "./classify.js";

export {
  planFromIntent,
  getEpisodicStore,
  getKnowledgeGraph,
  DECOMPOSE_SYSTEM_PROMPT,
} from "./planning.js";

export {
  buildAppControlScript,
  buildKeyboardAction,
  buildWebFormFillScript,
  buildDataEntryWorkflowNodes,
  isDataEntryWorkflowText,
  isMessagingIntentText,
  buildMessagingScriptWithLLM,
  extractAppName,
  normalizeAppName,
  escapeAppleScriptString,
  sanitizeToken,
  extractTarget,
  extractFormFields,
  BROWSERS,
  MEDIA_APPS,
  KNOWN_APPS,
  SAFE_HOST_PATTERN,
  SAFE_NAME_PATTERN,
  SAFE_DOCKER_TARGET_PATTERN,
} from "./app-control.js";

export {
  extractShellCommand,
  NL_TO_COMMAND,
} from "./shell.js";

export {
  parseUiActionChain,
  buildUiActionChainNodes,
  isNegatedUiInstruction,
  splitUiInteractionSegments,
  extractCoordinatePairs as extractCoordPairs,
  extractScrollAmountFromSegment,
  UI_CHAIN_CONNECTOR,
  UI_MOVE_KEYWORDS,
  UI_SCROLL_KEYWORDS,
  UI_DOUBLE_CLICK_KEYWORDS,
  UI_RIGHT_CLICK_KEYWORDS,
  UI_CLICK_KEYWORDS,
  UI_TYPE_KEYWORDS,
  UI_NEGATION_PREFIXES,
  type UiActionKind,
  type UiActionStep,
  escapeRegex,
  normalizeUiPhrase,
  findKeywordIndex,
  hasNegatedKeyword,
} from "./ui-chain.js";