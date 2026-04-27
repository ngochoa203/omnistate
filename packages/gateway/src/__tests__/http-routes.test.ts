/**
 * HTTP route tests for OmniStateGateway.
 *
 * Strategy: spin up OmniStateGateway on port 0 (ephemeral), run requests with
 * supertest against the bound address, then shut down.
 *
 * Mocks:
 *  - db/database → getDb() → fake statement stub (no SQLite I/O)
 *  - llm/runtime-config → loadLlmRuntimeConfig returns in-memory config
 *  - network/tailscale → getTailscaleStatus returns offline stub
 *  - voice/* and triggers → no-ops so start() doesn't fail
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import supertest from "supertest";

// ── Mocks (must be hoisted before imports that pull in server) ────────────────

vi.mock("../db/database.js", () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ result: 1 }), run: () => ({}) }),
  }),
  closeDb: () => {},
  getTestDb: () => ({}),
}));

vi.mock("../llm/runtime-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm/runtime-config.js")>();
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

vi.mock("../network/tailscale.js", () => ({
  getTailscaleStatus: () => ({
    installed: false,
    running: false,
    ip: null,
    hostname: null,
    magicDns: null,
    online: false,
  }),
  clearTailscaleCache: () => {},
}));

// Mock wake manager to avoid spawning processes
vi.mock("../voice/wake-manager.js", () => ({
  WakeManager: class {
    isRunning() { return false; }
    start() {}
    stop() {}
  },
}));

// Mock trigger engine
vi.mock("../triggers/index.js", () => ({
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

// Mock Claude mem store
vi.mock("../session/claude-mem-store.js", () => ({
  ClaudeMemStore: class {
    load() { return null; }
    save() {}
  },
}));

// Mock approval engine / vision
vi.mock("../vision/approval-policy.js", () => ({
  ApprovalEngine: class {},
  ApprovalPolicySchema: { optional: () => ({}) },
}));

vi.mock("../vision/permission-responder.js", () => ({
  ClaudeCodeResponder: class {
    isRunning = false;
    start() {}
    stop() {}
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { OmniStateGateway } from "../gateway/server.js";
import type { GatewayConfig } from "../config/schema.js";

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
      store: "/tmp/omnistate-test-sessions.json",
      transcriptDir: "/tmp/",
      maintenance: { mode: "warn", pruneAfter: "30d", maxEntries: 10 },
    },
    fleet: { enabled: false, discoveryMode: "tailscale", agents: [] },
    health: { enabled: false, intervalMs: 999999, autoRepair: false },
    plugins: { dir: "/tmp/", enabled: [] },
    remote: { enabled: false, tailscaleOnly: false, allowedDevices: 1 },
  };
}

async function getServerPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      resolve(addr.port);
    } else {
      server.once("listening", () => {
        const a = server.address() as { port: number };
        resolve(a.port);
      });
    }
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Gateway HTTP routes", () => {
  let gateway: OmniStateGateway;
  let agent: ReturnType<typeof supertest.agent>;

  beforeAll(async () => {
    gateway = new OmniStateGateway(makeConfig(0));
    gateway.start();

    // Wait for the HTTP server to bind
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const httpServer = (gateway as any).gatewayHttpServer as http.Server;
    const port = await getServerPort(httpServer);
    agent = supertest(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    (gateway as any).stop?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

  it("GET /health → 200 with status ok", async () => {
    const res = await agent.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("GET /healthz → 200", async () => {
    const res = await agent.get("/healthz");
    expect(res.status).toBe(200);
  });

  it("GET /metrics → 200 with prometheus content-type", async () => {
    const res = await agent.get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
  });

  it("GET /readyz → 200 with ready: true", async () => {
    const res = await agent.get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ready: true });
  });

  it("GET /health/ready → 200 or 503 (db check)", async () => {
    const res = await agent.get("/health/ready");
    expect([200, 503]).toContain(res.status);
    expect(typeof res.body.ready).toBe("boolean");
  });

  it("GET /unknown-path → 404 with NOT_FOUND code", async () => {
    const res = await agent.get("/this-does-not-exist-xyz");
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe("NOT_FOUND");
  });

  it("OPTIONS /health → 204 with CORS preflight headers", async () => {
    const res = await agent
      .options("/health")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
  });

  it("GET /health → response has X-Request-Id header", async () => {
    const res = await agent.get("/health");
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});
