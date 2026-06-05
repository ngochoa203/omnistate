import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMessage } from "../gateway/server-handlers.js";

vi.mock("../llm/runtime-config.js", () => ({
  incrementSessionUsage: vi.fn(),
  loadLlmRuntimeConfig: vi.fn(() => ({
    voice: {
      autoExecuteTranscript: false,
      siri: { enabled: false, mode: "handoff" },
    },
  })),
  saveLlmRuntimeConfig: vi.fn(),
  setActiveModel: vi.fn(),
  setActiveProvider: vi.fn(),
  setSiriField: vi.fn(),
  setVoiceField: vi.fn(),
  setWakeField: vi.fn(),
  updateActiveProviderField: vi.fn(),
  upsertProvider: vi.fn(),
  addFallbackProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

function makeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

function makeGateway() {
  return {
    config: { gateway: { auth: { localAutoApprove: true } } },
    clients: new Map(),
    streamManager: {
      handleControlMessage: vi.fn(),
      handleBinaryFrame: vi.fn(),
      dropSession: vi.fn(),
    },
    safeSend: vi.fn((ws, msg) => ws.send(JSON.stringify(msg))),
  };
}

describe("voice stream websocket routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes JSON voice.stream.chunk frames into VoiceStreamManager", async () => {
    const gateway = makeGateway();
    const ws = makeWs();
    const audio = Buffer.from("webm audio bytes").toString("base64");

    await handleMessage(
      gateway,
      "client-1",
      ws as never,
      { type: "voice.stream.chunk", sessionId: "voice-1", chunk: audio, seq: 1 } as never,
      "127.0.0.1",
      true,
    );

    expect(gateway.streamManager.handleBinaryFrame).toHaveBeenCalledOnce();
    const [clientId, decoded] = gateway.streamManager.handleBinaryFrame.mock.calls[0]!;
    expect(clientId).toBe("client-1");
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect((decoded as Buffer).toString()).toBe("webm audio bytes");
  });

  it("rejects empty or invalid base64 voice chunks", async () => {
    const gateway = makeGateway();
    const ws = makeWs();

    await handleMessage(
      gateway,
      "client-1",
      ws as never,
      { type: "voice.stream.chunk", sessionId: "voice-1", chunk: "" } as never,
      "127.0.0.1",
      true,
    );

    expect(gateway.streamManager.handleBinaryFrame).not.toHaveBeenCalled();
    expect(gateway.safeSend).toHaveBeenCalledWith(ws, expect.objectContaining({
      type: "voice.stream.error",
      sessionId: "voice-1",
    }));
  });
});
