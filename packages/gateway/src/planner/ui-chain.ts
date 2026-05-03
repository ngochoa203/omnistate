// ── UI action chain parsing extracted from intent.ts ─────────────────────────

import type { Entity } from "./types.js";
import type { StateNode } from "../types/task.js";
import { actionNode } from "./types.js";

// ============================================================================
// UI chain connector patterns
// ============================================================================

export const UI_CHAIN_CONNECTOR =
  /\s*(?:->|\band\s+then\b|\bthen\b|\bafter\s+that\b|\bnext\b|\br(?:[ồo]i)?\b|\bxong(?:\s+r(?:[ồo]i)?)?\b|\bsau\s*(?:[đd][oó]|[đd][aá]y|do|day)\b|\bti[ếe]p(?:\s*theo|\s*[đd][oó])?\b)\s*/gi;
export const UI_MOVE_KEYWORDS = ["move", "mouse", "cursor", "chuot", "con tro"];
export const UI_SCROLL_KEYWORDS = ["scroll", "cuon"];
export const UI_DOUBLE_CLICK_KEYWORDS = ["double click", "double tap", "nhap doi"];
export const UI_RIGHT_CLICK_KEYWORDS = ["right click", "chuot phai", "nhap phai"];
export const UI_CLICK_KEYWORDS = ["click", "tap", "nhap"];
export const UI_TYPE_KEYWORDS = ["type", "enter", "input", "write", "go chu"];
export const UI_NEGATION_PREFIXES = [
  "do not",
  "dont",
  "not",
  "no",
  "never",
  "khong duoc",
  "khong",
  "ko",
  "k",
  "dung",
  "cam",
];

// ============================================================================
// Helpers
// ============================================================================

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeUiPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bdo\s+n['']?t\b/g, "dont")
    .replace(/\bdon['']?t\b/g, "dont")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findKeywordIndex(normalized: string, keywords: string[]): number {
  let best = -1;

  for (const keyword of keywords) {
    const phrase = escapeRegex(keyword).replace(/\s+/g, "\\s+");
    const regex = new RegExp(`(?:^|\\s)${phrase}(?=\\s|$)`);
    const match = normalized.match(regex);
    if (!match || typeof match.index !== "number") continue;

    const idx = normalized.indexOf(match[0], Math.max(0, match.index));
    if (idx < 0) continue;
    const start = idx + (match[0].startsWith(" ") ? 1 : 0);
    if (best === -1 || start < best) best = start;
  }

  return best;
}

export function hasNegatedKeyword(normalized: string, keywords: string[]): boolean {
  for (const negation of UI_NEGATION_PREFIXES) {
    const negationPattern = escapeRegex(negation).replace(/\s+/g, "\\s+");

    for (const keyword of keywords) {
      const phrase = escapeRegex(keyword).replace(/\s+/g, "\\s+");
      const regex = new RegExp(
        `(?:^|\\s)${negationPattern}(?:\\s+\\w+){0,1}\\s+${phrase}(?=\\s|$)`,
      );
      if (regex.test(normalized)) return true;
    }
  }

  return false;
}

export function isNegatedUiInstruction(raw: string): boolean {
  const normalized = normalizeUiPhrase(raw);
  const allKeywords = [
    ...UI_MOVE_KEYWORDS,
    ...UI_SCROLL_KEYWORDS,
    ...UI_DOUBLE_CLICK_KEYWORDS,
    ...UI_RIGHT_CLICK_KEYWORDS,
    ...UI_CLICK_KEYWORDS,
    ...UI_TYPE_KEYWORDS,
  ];
  return hasNegatedKeyword(normalized, allKeywords);
}

// ============================================================================
// Segment splitting
// ============================================================================

export function splitUiInteractionSegments(raw: string): string[] {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const quotedChunks: string[] = [];
  const masked = normalized.replace(/["'""][^"'""]*["'""]/g, (chunk) => {
    const token = `__Q${quotedChunks.length}__`;
    quotedChunks.push(chunk);
    return token;
  });

  const unmask = (segment: string): string =>
    segment.replace(/__Q(\d+)__/g, (_, index: string) => {
      const parsedIndex = parseInt(index, 10);
      return Number.isNaN(parsedIndex) ? _ : (quotedChunks[parsedIndex] ?? _);
    });

  return masked
    .split(UI_CHAIN_CONNECTOR)
    .map(unmask)
    .map(s => s.trim())
    .filter(Boolean);
}

// ============================================================================
// Coordinate & text extraction
// ============================================================================

export function extractCoordinatePairs(text: string): Array<{ x: number; y: number }> {
  const pairs: Array<{ x: number; y: number }> = [];
  const regex =
    /(?:\bx\s*[:=]?\s*(\d{1,5})\s*(?:[,;\s]+)?\by\s*[:=]?\s*(\d{1,5}))|(?:(\d{1,5})\s*[,x]\s*(\d{1,5}))|(?:(\d{1,5})\s+(\d{1,5}))/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const xRaw = match[1] ?? match[3] ?? match[5];
    const yRaw = match[2] ?? match[4] ?? match[6];
    const x = xRaw ? parseInt(xRaw, 10) : NaN;
    const y = yRaw ? parseInt(yRaw, 10) : NaN;
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      pairs.push({ x, y });
    }
  }

  return pairs;
}

export function extractQuotedText(raw: string): string | null {
  const m = raw.match(/["'""](.+?)["'""]/);
  if (m?.[1]) return m[1].trim();

  const tail = raw.match(/\b(?:type|enter|input|write)\b\s+(.+)/i);
  if (tail?.[1]) return tail[1].trim();
  return null;
}

export function extractScrollAmountFromSegment(segment: string): number {
  const match = segment.match(
    /(?:scroll|cu[oộ]n)(?:\s+(?:up|down|l[eê]n|xu[oố]ng))?\s+(\d{1,4})/i,
  );
  return match ? parseInt(match[1], 10) : 250;
}

// ============================================================================
// UiActionStep types
// ============================================================================

export type UiActionKind = "move" | "click" | "scroll" | "type";

export interface UiActionStep {
  kind: UiActionKind;
  sourceText: string;
  coordinate?: { x: number; y: number };
  button?: "left" | "right";
  isDoubleClick?: boolean;
  scrollAmount?: number;
  scrollUp?: boolean;
  typedText?: string;
  queryText?: string;
}

// ============================================================================
// Core chain parser
// ============================================================================

export function parseUiActionChain(
  raw: string,
): UiActionStep[] {
  const segments = splitUiInteractionSegments(raw);
  const normalizedRaw = normalizeUiPhrase(raw);
  const hasChainConnectors = segments.length > 1;
  const allCoords = extractCoordinatePairs(raw);
  let globalCoordIndex = 0;
  let lastCoordinate: { x: number; y: number } | null = null;
  const steps: UiActionStep[] = [];

  for (const segment of segments) {
    const normalizedSegment = normalizeUiPhrase(segment);
    const localCoords = extractCoordinatePairs(segment);
    let localCoordIndex = 0;

    const resolveCoordinate = (
      preferLast: boolean,
      allowGlobalFallback: boolean,
    ): { x: number; y: number } | null => {
      if (localCoordIndex < localCoords.length) {
        const coord = localCoords[localCoordIndex];
        localCoordIndex += 1;
        return coord;
      }
      if (preferLast && lastCoordinate) return lastCoordinate;
      if (allowGlobalFallback && globalCoordIndex < allCoords.length) {
        const coord = allCoords[globalCoordIndex];
        globalCoordIndex += 1;
        return coord;
      }
      return null;
    };

    const orderedEvents: Array<{
      kind: UiActionKind;
      index: number;
      button?: "left" | "right";
      isDoubleClick?: boolean;
    }> = [];

    const moveIndex = findKeywordIndex(normalizedSegment, UI_MOVE_KEYWORDS);
    if (moveIndex >= 0) orderedEvents.push({ kind: "move", index: moveIndex });

    const scrollIndex = findKeywordIndex(normalizedSegment, UI_SCROLL_KEYWORDS);
    if (scrollIndex >= 0) orderedEvents.push({ kind: "scroll", index: scrollIndex });

    const doubleClickIndex = findKeywordIndex(normalizedSegment, UI_DOUBLE_CLICK_KEYWORDS);
    const rightClickIndex = findKeywordIndex(normalizedSegment, UI_RIGHT_CLICK_KEYWORDS);
    const clickIndex = findKeywordIndex(normalizedSegment, UI_CLICK_KEYWORDS);
    if (doubleClickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: doubleClickIndex, button: "left", isDoubleClick: true });
    } else if (rightClickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: rightClickIndex, button: "right" });
    } else if (clickIndex >= 0) {
      orderedEvents.push({ kind: "click", index: clickIndex, button: "left" });
    }

    const typeIndex = findKeywordIndex(normalizedSegment, UI_TYPE_KEYWORDS);
    if (typeIndex >= 0) orderedEvents.push({ kind: "type", index: typeIndex });

    orderedEvents.sort((a, b) => a.index - b.index);
    const hasMultipleEvents = orderedEvents.length > 1;

    for (const event of orderedEvents) {
      const isNegatedMove =
        event.kind === "move" && hasNegatedKeyword(normalizedSegment, UI_MOVE_KEYWORDS);
      const isNegatedScroll =
        event.kind === "scroll" && hasNegatedKeyword(normalizedSegment, UI_SCROLL_KEYWORDS);
      const isNegatedType =
        event.kind === "type" && hasNegatedKeyword(normalizedSegment, UI_TYPE_KEYWORDS);
      const clickNegationKeywords = event.isDoubleClick
        ? UI_DOUBLE_CLICK_KEYWORDS
        : event.button === "right"
          ? UI_RIGHT_CLICK_KEYWORDS
          : UI_CLICK_KEYWORDS;
      const isNegatedClick =
        event.kind === "click" && hasNegatedKeyword(normalizedSegment, clickNegationKeywords);

      if (isNegatedMove || isNegatedScroll || isNegatedType || isNegatedClick) {
        continue;
      }

      if (event.kind === "move") {
        const coordinate = resolveCoordinate(false, true);
        if (!coordinate) continue;
        lastCoordinate = coordinate;
        steps.push({
          kind: "move",
          sourceText: segment,
          coordinate,
        });
        continue;
      }

      if (event.kind === "click") {
        const coordinate = resolveCoordinate(true, false);
        if (coordinate) {
          lastCoordinate = coordinate;
          steps.push({
            kind: "click",
            sourceText: segment,
            coordinate,
            button: event.button ?? "left",
            isDoubleClick: event.isDoubleClick,
          });
          continue;
        }

        if (hasChainConnectors || hasMultipleEvents || event.isDoubleClick || event.button === "right") {
          steps.push({
            kind: "click",
            sourceText: segment,
            button: event.button ?? "left",
            isDoubleClick: event.isDoubleClick,
            queryText: segment,
          });
        }
        continue;
      }

      if (event.kind === "scroll") {
        steps.push({
          kind: "scroll",
          sourceText: segment,
          scrollAmount: extractScrollAmountFromSegment(segment),
          scrollUp: /\b(?:up|len)\b/.test(normalizedSegment),
        });
        continue;
      }

      if (event.kind === "type") {
        steps.push({
          kind: "type",
          sourceText: segment,
          typedText: extractQuotedText(segment) ?? segment,
        });
      }
    }
  }

  // Fallback: type-only if no chain
  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_TYPE_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_TYPE_KEYWORDS)) {
    steps.push({
      kind: "type",
      sourceText: raw,
      typedText: extractQuotedText(raw) ?? raw,
    });
  }

  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_SCROLL_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_SCROLL_KEYWORDS)) {
    steps.push({
      kind: "scroll",
      sourceText: raw,
      scrollAmount: extractScrollAmountFromSegment(raw),
      scrollUp: /\b(?:up|len)\b/.test(normalizedRaw),
    });
  }

  if (!steps.length &&
      findKeywordIndex(normalizedRaw, UI_MOVE_KEYWORDS) >= 0 &&
      !hasNegatedKeyword(normalizedRaw, UI_MOVE_KEYWORDS)) {
    const coord = allCoords[0];
    if (coord) {
      steps.push({
        kind: "move",
        sourceText: raw,
        coordinate: coord,
      });
    }
  }

  if (!steps.length &&
      (findKeywordIndex(normalizedRaw, UI_DOUBLE_CLICK_KEYWORDS) >= 0 ||
        findKeywordIndex(normalizedRaw, UI_RIGHT_CLICK_KEYWORDS) >= 0 ||
        findKeywordIndex(normalizedRaw, UI_CLICK_KEYWORDS) >= 0) &&
      !hasNegatedKeyword(normalizedRaw, [
        ...UI_DOUBLE_CLICK_KEYWORDS,
        ...UI_RIGHT_CLICK_KEYWORDS,
        ...UI_CLICK_KEYWORDS,
      ]) &&
      allCoords[0]) {
    const isDoubleClick = findKeywordIndex(normalizedRaw, UI_DOUBLE_CLICK_KEYWORDS) >= 0;
    const isRightClick = findKeywordIndex(normalizedRaw, UI_RIGHT_CLICK_KEYWORDS) >= 0;
    steps.push({
      kind: "click",
      sourceText: raw,
      coordinate: allCoords[0],
      button: isRightClick ? "right" : "left",
      isDoubleClick,
    });
  }

  return steps;
}

// ============================================================================
// Build StateNodes from UiActionStep[]
// ============================================================================

export function buildUiActionChainNodes(
  raw: string,
  steps: UiActionStep[],
  entities: Record<string, Entity>,
): StateNode[] {
  const nodes: StateNode[] = [];
  let previousId: string | null = null;
  let moveCount = 0;
  let interactCount = 0;
  let scrollCount = 0;

  const nextId = (kind: "move" | "interact" | "scroll"): string => {
    if (kind === "move") {
      moveCount += 1;
      return moveCount === 1 ? "move" : `move-${moveCount}`;
    }
    if (kind === "scroll") {
      scrollCount += 1;
      return scrollCount === 1 ? "scroll" : `scroll-${scrollCount}`;
    }
    interactCount += 1;
    return interactCount === 1 ? "interact" : `interact-${interactCount}`;
  };

  for (const step of steps) {
    const deps = previousId ? [previousId] : [];

    if (step.kind === "move" && step.coordinate) {
      const id = nextId("move");
      nodes.push(
        actionNode(
          id,
          `${raw} (move)`,
          "ui.move",
          "surface",
          { x: step.coordinate.x, y: step.coordinate.y },
          deps,
        ),
      );
      previousId = id;
      continue;
    }

    if (step.kind === "click") {
      const id = nextId("interact");
      const button = step.button ?? "left";

      if (step.coordinate) {
        const tool = step.isDoubleClick ? "ui.doubleClickAt" : "ui.clickAt";
        const params: Record<string, unknown> = {
          x: step.coordinate.x,
          y: step.coordinate.y,
        };
        if (!step.isDoubleClick) {
          params.button = button;
        }

        nodes.push(
          actionNode(
            id,
            `${raw} (click)`,
            tool,
            "surface",
            params,
            deps,
          ),
        );
      } else {
        nodes.push(
          actionNode(
            id,
            `${raw} (click)`,
            "ui.click",
            "surface",
            { query: step.queryText ?? raw, entities, button },
            deps,
          ),
        );

        if (step.isDoubleClick) {
          const secondId = nextId("interact");
          nodes.push(
            actionNode(
              secondId,
              `${raw} (double-click)`,
              "ui.click",
              "surface",
              { query: step.queryText ?? raw, entities, button },
              [id],
            ),
          );
          previousId = secondId;
          continue;
        }
      }

      previousId = id;
      continue;
    }

    if (step.kind === "scroll") {
      const id = nextId("scroll");
      const amount = step.scrollAmount ?? 250;
      nodes.push(
        actionNode(
          id,
          `${raw} (scroll)`,
          "ui.scroll",
          "surface",
          { dx: 0, dy: step.scrollUp ? amount : -amount },
          deps,
        ),
      );
      previousId = id;
      continue;
    }

    if (step.kind === "type") {
      const id = nextId("interact");
      nodes.push(
        actionNode(
          id,
          `${raw} (type)`,
          "ui.type",
          "surface",
          { text: step.typedText ?? raw },
          deps,
        ),
      );
      previousId = id;
    }
  }

  return nodes;
}
