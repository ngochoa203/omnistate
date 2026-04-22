/**
 * Shared mirror-session types and a lightweight client helper that both the
 * web UI and mobile app can import. Web UI → viewer, Android/macOS → source.
 */

export type MirrorRole = "source" | "viewer";

export interface MirrorHelloMessage {
  type: "hello";
  role: MirrorRole;
  sessionId: string;
  streamId?: number;
  deviceId?: string;
}

export interface MirrorInputMessage {
  type: "input";
  action: "tap" | "swipe" | "key" | "text" | "back" | "home" | "recents";
  params?: Record<string, unknown>;
}

export interface MirrorMetaMessage {
  type: "meta";
  width: number;
  height: number;
  fps: number;
  deviceName?: string;
}

export interface MirrorPingMessage { type: "ping" }
export interface MirrorPongMessage { type: "pong"; ts: number }
export interface MirrorByeMessage { type: "bye" }

export type MirrorControlMessage =
  | MirrorHelloMessage
  | MirrorInputMessage
  | MirrorMetaMessage
  | MirrorPingMessage
  | MirrorPongMessage
  | MirrorByeMessage;

export const MIRROR_FRAME_MAGIC = 0x01;

/** Build a binary frame: [magic] [streamId] [jpegBytes...] */
export function buildFrame(streamId: number, jpegBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpegBytes.length + 2);
  out[0] = MIRROR_FRAME_MAGIC;
  out[1] = streamId & 0xff;
  out.set(jpegBytes, 2);
  return out;
}

export function parseFrame(buf: Uint8Array): { streamId: number; jpeg: Uint8Array } | null {
  if (buf.length < 2 || buf[0] !== MIRROR_FRAME_MAGIC) return null;
  return { streamId: buf[1], jpeg: buf.subarray(2) };
}
