/**
 * Local Vision Provider — on-device OCR via tesseract.js.
 *
 * No API calls, no cost. Extracts text + bounding boxes from screenshots,
 * then fuzzy-matches against the query to find elements.
 *
 * Usage:
 *   const provider = new LocalVisionProvider();
 *   await provider.init(); // load OCR engine once
 *   const elements = await provider.detectElements(screenshot, "Settings");
 *   await provider.terminate(); // cleanup on shutdown
 */

import { createWorker, type Worker } from "tesseract.js";
import type { VisionProvider, VerifyResult } from "../engine.js";
import type { DetectedElement } from "../../layers/surface.js";

export class LocalVisionProvider implements VisionProvider {
  name = "local-ocr";

  private worker: Worker | null = null;
  private initializing: Promise<void> | null = null;

  /** Initialize the OCR engine (lazy — called automatically on first use). */
  async init(): Promise<void> {
    if (this.worker) return;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        this.worker = await createWorker("eng");
      } catch (e) {
        this.initializing = null; // allow retry on next call
        throw e;
      }
    })();

    return this.initializing;
  }

  /** Terminate the OCR worker to free resources. */
  async terminate(): Promise<void> {
    // Wait for any in-flight init to finish before terminating
    if (this.initializing) {
      await this.initializing.catch(() => {});
    }
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.initializing = null;
  }

  async detectElements(
    screenshot: Buffer,
    query: string
  ): Promise<DetectedElement[]> {
    await this.init();
    if (!this.worker) return [];

    let result;
    try {
      result = await this.worker.recognize(screenshot);
    } catch {
      return []; // Corrupt image or worker error — return empty
    }
    const page = result.data;
    const elements: DetectedElement[] = [];
    const queryLower = query.toLowerCase();
    const queryTokens = queryLower.split(/\s+/);

    // Flatten: Page → Block → Paragraph → Line → Word
    const words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
    const lines: typeof words = [];

    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          lines.push({ text: line.text, confidence: line.confidence, bbox: line.bbox });
          for (const word of line.words ?? []) {
            words.push({ text: word.text, confidence: word.confidence, bbox: word.bbox });
          }
        }
      }
    }

    // Strategy 1: Find exact or fuzzy matches at the word level
    for (const word of words) {
      const wordLower = word.text.toLowerCase().trim();
      if (!wordLower) continue;

      const confidence = fuzzyMatch(wordLower, queryLower);
      if (confidence > 0.4) {
        elements.push({
          id: `ocr-word-${elements.length}`,
          type: "text",
          text: word.text.trim(),
          bounds: {
            x: word.bbox.x0,
            y: word.bbox.y0,
            width: word.bbox.x1 - word.bbox.x0,
            height: word.bbox.y1 - word.bbox.y0,
          },
          confidence: confidence * (word.confidence / 100),
          detectionMethod: "local-ocr",
        });
      }
    }

    // Strategy 2: Find multi-word matches across lines
    if (queryTokens.length > 1) {
      for (const line of lines) {
        const lineText = line.text.trim();
        const lineLower = lineText.toLowerCase();
        const confidence = fuzzyMatch(lineLower, queryLower);
        if (confidence > 0.5) {
          elements.push({
            id: `ocr-line-${elements.length}`,
            type: "text",
            text: lineText,
            bounds: {
              x: line.bbox.x0,
              y: line.bbox.y0,
              width: line.bbox.x1 - line.bbox.x0,
              height: line.bbox.y1 - line.bbox.y0,
            },
            confidence: confidence * (line.confidence / 100),
            detectionMethod: "local-ocr",
          });
        }
      }
    }

    return elements.sort((a, b) => b.confidence - a.confidence);
  }

  async verifyState(
    screenshot: Buffer,
    expected: string
  ): Promise<VerifyResult> {
    await this.init();
    if (!this.worker) {
      return {
        passed: false,
        confidence: 0,
        description: "OCR worker not initialized",
      };
    }

    let result;
    try {
      result = await this.worker.recognize(screenshot);
    } catch {
      return {
        passed: false,
        confidence: 0,
        description: "OCR recognition failed on screenshot",
      };
    }
    const fullText = result.data.text.toLowerCase();
    const expectedLower = expected.toLowerCase();

    // Check for exact substring match
    if (fullText.includes(expectedLower)) {
      return {
        passed: true,
        confidence: 0.9,
        description: `Found exact match: "${expected}"`,
      };
    }

    // Check for token overlap
    const expectedTokens = expectedLower.split(/\s+/).filter(Boolean);
    const foundTokens = expectedTokens.filter((t) => fullText.includes(t));
    const ratio = foundTokens.length / expectedTokens.length;

    if (ratio >= 0.7) {
      return {
        passed: true,
        confidence: ratio * 0.8,
        description: `Found ${foundTokens.length}/${expectedTokens.length} keywords: ${foundTokens.join(", ")}`,
      };
    }

    // Check fuzzy match on full text
    const confidence = fuzzyMatch(fullText, expectedLower);
    return {
      passed: confidence > 0.6,
      confidence,
      description:
        confidence > 0.6
          ? `Fuzzy match (${(confidence * 100).toFixed(0)}%)`
          : `Expected "${expected}" not found in OCR text`,
    };
  }
}

// ---------------------------------------------------------------------------
// Fuzzy matching (Dice coefficient on bigrams — fast, good for short strings)
// ---------------------------------------------------------------------------

function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) {
    return a.includes(b) || b.includes(a) ? 0.8 : 0.0;
  }

  // Contains check — high confidence for substring matches
  if (a.includes(b)) return 0.95;
  if (b.includes(a)) return 0.85;

  // Dice coefficient on character bigrams
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);

  let intersectionSize = 0;
  const bCopy = new Map(bigramsB);

  for (const [bigram, count] of bigramsA) {
    const bCount = bCopy.get(bigram) ?? 0;
    if (bCount > 0) {
      intersectionSize += Math.min(count, bCount);
      bCopy.set(bigram, bCount - Math.min(count, bCount));
    }
  }

  const totalA = [...bigramsA.values()].reduce((s, v) => s + v, 0);
  const totalB = [...bigramsB.values()].reduce((s, v) => s + v, 0);

  return (2 * intersectionSize) / (totalA + totalB);
}

function bigrams(str: string): Map<string, number> {
  const result = new Map<string, number>();
  for (let i = 0; i < str.length - 1; i++) {
    const bg = str.slice(i, i + 2);
    result.set(bg, (result.get(bg) ?? 0) + 1);
  }
  return result;
}
