/**
 * Local Vision Provider — uses local OCR (Tesseract/PaddleOCR)
 * for text extraction and basic element detection.
 *
 * No API calls needed — runs entirely on-device.
 * TODO: Integrate with tesseract.js or native PaddleOCR binding.
 */

import type { VisionProvider, VerifyResult } from "../engine.js";
import type { DetectedElement } from "../../layers/surface.js";

export class LocalVisionProvider implements VisionProvider {
  name = "local-ocr";

  async detectElements(
    _screenshot: Buffer,
    _query: string
  ): Promise<DetectedElement[]> {
    // TODO: Run OCR on screenshot, find text matching query,
    // infer bounding boxes from text positions
    return [];
  }

  async verifyState(
    _screenshot: Buffer,
    _expected: string
  ): Promise<VerifyResult> {
    // TODO: Run OCR, check if expected text appears on screen
    return {
      passed: false,
      confidence: 0,
      description: "Local OCR provider not yet implemented",
    };
  }
}
