/**
 * MirrorSource — Android-side driver that captures frames and posts them to
 * the mirror WebSocket as a "source". Input events from viewers are forwarded
 * to the AccessibilityModule.
 */

import { AccessibilityModule } from "../native/AccessibilityModule";
import { ScreenCaptureModule } from "../native/ScreenCaptureModule";
import { MIRROR_FRAME_MAGIC } from "@omnistate/shared";

export interface MirrorSourceOptions {
  gatewayWsUrl: string;
  sessionId: string;
  streamId?: number;
  deviceId?: string;
  targetFps?: number;
  jpegQuality?: number;
}

export class MirrorSource {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private options: MirrorSourceOptions) {}

  async start(): Promise<void> {
    await ScreenCaptureModule.requestPermission();
    this.ws = new WebSocket(this.options.gatewayWsUrl);
    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onclose = () => this.stop();
    this.ws.onerror = () => this.stop();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    ScreenCaptureModule.stopCapture().catch(() => {});
  }

  private onOpen(): void {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({
        type: "hello",
        role: "source",
        sessionId: this.options.sessionId,
        streamId: this.options.streamId ?? 0,
        deviceId: this.options.deviceId,
      }),
    );
    const fps = this.options.targetFps ?? 10;
    this.timer = setInterval(() => { void this.tick(); }, Math.max(50, Math.floor(1000 / fps)));
  }

  private async tick(): Promise<void> {
    if (this.closed || !this.ws || this.ws.readyState !== 1) return;
    try {
      const b64 = await ScreenCaptureModule.captureScreenshot(this.options.jpegQuality ?? 60);
      if (!b64) return;
      const jpeg = base64ToBytes(b64);
      const payload = new Uint8Array(jpeg.length + 2);
      payload[0] = MIRROR_FRAME_MAGIC;
      payload[1] = (this.options.streamId ?? 0) & 0xff;
      payload.set(jpeg, 2);
      this.ws.send(payload);
    } catch { /* ignore transient errors */ }
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "input") await this.handleInput(msg);
    } catch { /* ignore malformed */ }
  }

  private async handleInput(msg: { action: string; params?: Record<string, unknown> }): Promise<void> {
    const { action, params = {} } = msg;
    try {
      switch (action) {
        case "tap": {
          const x = Number(params.x), y = Number(params.y);
          if (Number.isFinite(x) && Number.isFinite(y)) await AccessibilityModule.tap(x, y);
          break;
        }
        case "swipe": {
          const fromX = Number(params.fromX);
          const fromY = Number(params.fromY);
          const toX = Number(params.toX);
          const toY = Number(params.toY);
          const duration = Number(params.duration ?? 300);
          await AccessibilityModule.swipe(fromX, fromY, toX, toY, duration);
          break;
        }
        case "text": {
          const t = String(params.text ?? "");
          if (t) await AccessibilityModule.typeText(t);
          break;
        }
        case "back":
          await AccessibilityModule.performAction("back"); break;
        case "home":
          await AccessibilityModule.performAction("home"); break;
        case "recents":
          await AccessibilityModule.performAction("recents"); break;
      }
    } catch { /* ignore input errors */ }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(b64) : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
