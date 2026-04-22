/**
 * Vision client — sends screenshots to the gateway for AI analysis.
 */

export interface VisionResult {
  description?: string;
  elements?: Array<{ label: string; x: number; y: number; confidence: number }>;
  raw?: unknown;
}

export interface VisionClientConfig {
  gatewayUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export class VisionClient {
  constructor(private config: VisionClientConfig = {}) {}

  update(patch: Partial<VisionClientConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  async analyzeScreen(base64: string, prompt: string): Promise<VisionResult> {
    const url = this.config.gatewayUrl;
    if (!url) return { description: "[offline] vision client not configured" };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 20_000);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/vision/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify({ image: base64, prompt }),
        signal: controller.signal,
      });
      if (!res.ok) return { description: `[error] ${res.status}` };
      const data = (await res.json()) as VisionResult;
      return data;
    } catch (e) {
      const err = e as Error;
      return { description: `[error] ${err.message}` };
    } finally {
      clearTimeout(t);
    }
  }

  async findElementByVision(
    base64: string,
    description: string,
  ): Promise<{ x: number; y: number } | null> {
    const result = await this.analyzeScreen(base64, `Find the element: ${description}`);
    const el = result.elements?.[0];
    if (!el) return null;
    return { x: el.x, y: el.y };
  }
}
