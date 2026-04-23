/**
 * Claude Vision Provider — uses Anthropic Claude API for
 * UI element detection and screen state verification.
 *
 * Sends screenshots as base64 images to Claude's vision model.
 * Returns structured element data with bounding boxes and confidence.
 *
 * Usage:
 *   const provider = new ClaudeVisionProvider(); // reads ANTHROPIC_API_KEY env
 *   const elements = await provider.detectElements(screenshotBuf, "Submit button");
 */

import Anthropic from "@anthropic-ai/sdk";
import type { VisionProvider, VerifyResult } from "../engine.js";
import type { DetectedElement } from "../../layers/surface.js";

import { logger } from "../../utils/logger.js";
type ClaudeModel = "claude-sonnet-4-20250514" | "claude-opus-4-20250514";
type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ClaudeVisionConfig {
  apiKey?: string;
  model?: ClaudeModel;
  maxTokens?: number;
}

export class ClaudeVisionProvider implements VisionProvider {
  name = "claude-vision";

  private client: Anthropic | null = null;
  private model: ClaudeModel;
  private maxTokens: number;

  constructor(config: ClaudeVisionConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    this.model = config.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = config.maxTokens ?? 1024;

    if (apiKey) {
      this.client = new Anthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
    }
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  async detectElements(
    screenshot: Buffer,
    query: string
  ): Promise<DetectedElement[]> {
    if (!this.client) return [];

    try {
      const base64Image = screenshot.toString("base64");
      const mediaType = detectMediaType(screenshot);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: buildDetectPrompt(query),
              },
            ],
          },
        ],
      });

      return parseDetectResponse(response);
    } catch (e) {
      logger.error(`[claude-vision] detectElements failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  async verifyState(
    screenshot: Buffer,
    expected: string
  ): Promise<VerifyResult> {
    if (!this.client) {
      return {
        passed: false,
        confidence: 0,
        description: "Claude API key not configured",
      };
    }

    try {
      const base64Image = screenshot.toString("base64");
      const mediaType = detectMediaType(screenshot);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Image,
                },
              },
              {
                type: "text",
                text: buildVerifyPrompt(expected),
              },
            ],
          },
        ],
      });

      return parseVerifyResponse(response);
    } catch (e) {
      logger.error(`[claude-vision] verifyState failed: ${e instanceof Error ? e.message : e}`);
      return {
        passed: false,
        confidence: 0,
        description: `Claude API error: ${e instanceof Error ? e.message : "unknown"}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect image format from buffer magic bytes. */
function detectMediaType(buf: Buffer): ImageMediaType {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp"; // RIFF
  return "image/png"; // default assumption
}

/** Sanitize user input to prevent prompt injection. */
function sanitizeInput(input: string): string {
  return input
    .slice(0, 500)  // Truncate excessively long queries
    .replace(/[<>]/g, ""); // Strip XML-like delimiters
}

// ---------------------------------------------------------------------------
// Prompt builders (use XML delimiters to mitigate injection)
// ---------------------------------------------------------------------------

function buildDetectPrompt(query: string): string {
  const safeQuery = sanitizeInput(query);
  return `Analyze this screenshot and find UI elements matching the query below.

<query>${safeQuery}</query>

Return a JSON array of detected elements. Each element must have:
- "type": the UI element type (button, text_field, link, label, image, checkbox, menu_item, tab, icon, etc.)
- "text": visible text content (if any)
- "bounds": {"x": <left px>, "y": <top px>, "width": <w px>, "height": <h px>}
- "confidence": 0.0-1.0 how certain this matches the query

Return ONLY valid JSON — no markdown, no explanation. Example:
[{"type":"button","text":"Submit","bounds":{"x":100,"y":200,"width":80,"height":32},"confidence":0.95}]

If nothing matches, return: []`;
}

function buildVerifyPrompt(expected: string): string {
  const safeExpected = sanitizeInput(expected);
  return `Look at this screenshot and determine: Does the screen currently show the expected state?

<expected>${safeExpected}</expected>

Return ONLY a JSON object:
{"passed": true/false, "confidence": 0.0-1.0, "description": "what you actually see"}`;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseDetectResponse(
  response: Anthropic.Message
): DetectedElement[] {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      type?: string;
      text?: string;
      bounds?: { x: number; y: number; width: number; height: number };
      confidence?: number;
    }>;

    return parsed
      .filter((el) => isBounds(el.bounds) && typeof el.confidence === "number")
      .map((el, i) => ({
        id: `claude-${i}`,
        type: el.type ?? "unknown",
        text: el.text,
        bounds: el.bounds!,
        confidence: el.confidence!,
        detectionMethod: "claude-vision",
      }));
  } catch {
    return [];
  }
}

function parseVerifyResponse(
  response: Anthropic.Message
): VerifyResult {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: false, confidence: 0.3, description: text.slice(0, 200) };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      passed?: boolean;
      confidence?: number;
      description?: string;
    };

    return {
      passed: parsed.passed ?? false,
      confidence: parsed.confidence ?? 0.5,
      description: parsed.description ?? text.slice(0, 200),
    };
  } catch {
    const lower = text.toLowerCase();
    const passed = lower.includes("yes") || lower.includes("passed") || lower.includes("matches");
    return { passed, confidence: 0.4, description: text.slice(0, 200) };
  }
}

/** Runtime guard for bounds object shape. */
function isBounds(
  v: unknown
): v is { x: number; y: number; width: number; height: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    ["x", "y", "width", "height"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "number"
    )
  );
}
