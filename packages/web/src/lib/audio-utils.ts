/**
 * Audio utilities for voice recording.
 *
 * WAV encoding logic lives in @omnistate/mobile-core (platform-agnostic Uint8Array).
 * This module wraps it with browser-specific Blob / FileReader helpers.
 */
import { encodeWavFromPCM } from "@omnistate/mobile-core/voice-encoder";

// Re-export the portable encoder so callers that don't need a Blob can use it directly.
export { encodeWavFromPCM, pcmToBase64Wav } from "@omnistate/mobile-core/voice-encoder";

/**
 * Encode raw Float32 PCM samples into a WAV Blob (browser only).
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = encodeWavFromPCM(samples, sampleRate);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" });
}

/**
 * Convert a Blob to a base64 string (without the data:... prefix).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip "data:audio/wav;base64," prefix
      const base64 = dataUrl.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
