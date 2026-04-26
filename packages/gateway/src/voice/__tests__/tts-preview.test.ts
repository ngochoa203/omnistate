/**
 * Tests for POST /api/tts/preview route (handleSiriBridgeRequest).
 *
 * Strategy: create a minimal http server that delegates to the gateway's
 * handleSiriBridgeRequest, so we can test TTS logic without needing
 * port 19801. Mock edge-tts synthesize to avoid spawning Python.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import supertest from "supertest";

// ── Mocks (hoisted before server import) ──────────────────────────────────────

vi.mock("../../db/database.js", () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ result: 1 }), run: () => ({}) }),
  }),
  closeDb: () => {},
  getTestDb: () => ({}),
}));

vi.mock("../../llm/runtime-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../llm/runtime-config.js")>();
  const fakeConfig = {
    activeProviderId: "test",
    activeModel: "test-model",
    fallbackProviderIds: [],
    providers: [
      {
        id: "test",
        kind: "anthropic" as const,
        baseURL: "http://localhost:0",
        apiKey: "test-key",
        model: "test-model",
        enabled: true,
      },
    ],
    voice: {
      lowLatency: false,
      autoExecuteTranscript: false,
      primaryProvider: "native" as const,
      fallbackProviders: [],
      chunkMs: 100,
      siri: {
        enabled: false,
        mode: "handoff" as const,
        shortcutName: "",
        endpoint: "http://127.0.0.1:19801/siri/command",
        token: "",
      },
      wake: {
        enabled: false,
        phrase: "hey omni",
        cooldownMs: 3000,
        commandWindowSec: 5,
        engine: "legacy" as const,
        aliases: [],
      },
      voiceprint: { enabled: false, profiles: [] },
    },
  };
  return {
    ...actual,
    loadLlmRuntimeConfig: () => fakeConfig,
    saveLlmRuntimeConfig: () => {},
    incrementSessionUsage: () => {},
    setActiveModel: () => {},
    setActiveProvider: () => {},
    setSiriField: () => {},
    setVoiceField: () => {},
    setWakeField: () => {},
    updateActiveProviderField: () => {},
    upsertProvider: () => {},
    addFallbackProvider: () => {},
  };
});

vi.mock("../../network/tailscale.js", () => ({
  getTailscaleStatus: () => ({
    installed: false, running: false, ip: null, hostname: null, magicDns: null, online: false,
  }),
  clearTailscaleCache: () => {},
}));

vi.mock("../../voice/wake-manager.js", () => ({
  WakeManager: class {
    isRunning() { return false; }
    start() {}
    stop() {}
  },
}));

vi.mock("../../triggers/index.js", () => ({
  TriggerEngine: class {
    start() {}
    stop() {}
    createTrigger() {}
    listTriggers() { return []; }
    updateTrigger() {}
    deleteTrigger() {}
    getTriggerHistory() { return []; }
  },
}));

vi.mock("../../session/claude-mem-store.js", () => ({
  ClaudeMemStore: class {
    load() { return null; }
    save() {}
  },
}));

vi.mock("../../vision/approval-policy.js", () => ({
  ApprovalEngine: class {},
  ApprovalPolicySchema: { optional: () => ({}) },
}));

vi.mock("../../vision/permission-responder.js", () => ({
  ClaudeCodeResponder: class {
    isRunning = false;
    start() {}
    stop() {}
  },
}));

// Mock edge-tts so no real Python is spawned
const mockSynthesize = vi.fn();
vi.mock("../edge-tts.js", () => ({
  detectLanguage: (text: string) =>
    /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)
      ? "vi"
      : "en",
  pickVoice: (lang: string) =>
    lang === "vi" ? "vi-VN-HoaiMyNeural" : "en-US-AriaNeural",
  synthesize: (...args: any[]) => mockSynthesize(...args),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { OmniStateGateway } from "../../gateway/server.js";
import type { GatewayConfig } from "../../config/schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(port = 0): GatewayConfig {
  return {
    gateway: { bind: "127.0.0.1", port, auth: { localAutoApprove: true } },
    execution: {
      defaultLayer: "auto",
      maxRetries: 0,
      retryBackoffMs: [],
      verifyAfterEachStep: false,
      screenshotOnError: false,
    },
    session: {
      store: "/tmp/omnistate-test-tts-sessions.json",
      transcriptDir: "/tmp/",
      maintenance: { mode: "warn", pruneAfter: "30d", maxEntries: 10 },
    },
    fleet: { enabled: false, discoveryMode: "tailscale", agents: [] },
    health: { enabled: false, intervalMs: 999999, autoRepair: false },
    plugins: { dir: "/tmp/", enabled: [] },
    remote: { enabled: false, tailscaleOnly: false, allowedDevices: 1 },
  };
}

async function listenOnPort(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("No address"));
    });
    server.on("error", reject);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/tts/preview", () => {
  let gateway: OmniStateGateway;
  let proxyServer: http.Server;
  let agent: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    gateway = new OmniStateGateway(makeConfig(0));
    gateway.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Create a proxy server that delegates to handleSiriBridgeRequest
    // (the method that contains the /api/tts/preview route)
    const bridgeHandler = (gateway as any).handleSiriBridgeRequest.bind(gateway);
    const expectedPath = "/siri/command";
    proxyServer = http.createServer((req, res) => {
      bridgeHandler(req, res, expectedPath).catch((err: Error) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
    });

    const port = await listenOnPort(proxyServer);
    agent = supertest(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    proxyServer.close();
    (gateway as any).stop?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

  it("returns 200 with audio and voice for valid text", async () => {
    const fakeAudio = Buffer.from("fake-mp3");
    mockSynthesize.mockResolvedValue(fakeAudio);

    const res = await agent
      .post("/api/tts/preview")
      .set("Content-Type", "application/json")
      .send({ text: "hello world" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      audio: fakeAudio.toString("base64"),
      voice: expect.any(String),
    });
  });

  it("returns 400 with MISSING_TEXT for empty text", async () => {
    const res = await agent
      .post("/api/tts/preview")
      .set("Content-Type", "application/json")
      .send({ text: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TEXT");
  });

  it("returns 400 with MISSING_TEXT when text field is absent", async () => {
    const res = await agent
      .post("/api/tts/preview")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_TEXT");
  });

  it("returns 400 with TEXT_TOO_LONG for text exceeding 500 chars", async () => {
    const res = await agent
      .post("/api/tts/preview")
      .set("Content-Type", "application/json")
      .send({ text: "a".repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TEXT_TOO_LONG");
  });
});
