/**
 * useVoice hook tests.
 *
 * We exercise startRecording() / stopRecording() in isolation by mocking
 * AudioContext (using createScriptProcessor), and getUserMedia so the hook
 * can run in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoice } from "../../src/hooks/useVoice";

// Hoist mock functions to ensure they're available before vi.mock factory runs
const { mockEncodeWav, mockBlobToBase64 } = vi.hoisted(() => ({
  mockEncodeWav: vi.fn().mockReturnValue(new Blob(["wav"])),
  mockBlobToBase64: vi.fn().mockResolvedValue("base64audio=="),
}));

// Hoist audio-utils mock so it applies to all tests
vi.mock("../../src/lib/audio-utils", () => ({
  encodeWav: mockEncodeWav,
  blobToBase64: mockBlobToBase64,
}));

// ── AudioContext / AudioWorklet mock ──────────────────────────────────────────

type AudioProcessHandler = (e: { inputBuffer: { getChannelData: (ch: number) => Float32Array } }) => void;
type MessageHandler = (e: { data: Float32Array }) => void;

function makeMockAudioContext(onAudioProcess?: (handler: AudioProcessHandler) => void) {
  let capturedOnaudioprocess: AudioProcessHandler | null = null;

  const mockProcessor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    set onaudioprocess(handler: AudioProcessHandler) {
      capturedOnaudioprocess = handler;
      onAudioProcess?.(handler);
    },
    get onaudioprocess() { return capturedOnaudioprocess; },
  };

  const mockSource = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockAudioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  const mockWorkletNode = {
    port: { onmessage: null as MessageHandler | null },
    disconnect: vi.fn(),
  };

  return {
    audioWorklet: mockAudioWorklet,
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createScriptProcessor: vi.fn().mockReturnValue(mockProcessor),
    close: vi.fn().mockResolvedValue(undefined),
    destination: {},
    sampleRate: 16000,
    workletNode: mockWorkletNode,
    AudioWorkletNode: vi.fn().mockReturnValue(mockWorkletNode),
    source: mockSource,
    processor: mockProcessor,
  };
}

// ── getUserMedia mock ─────────────────────────────────────────────────────────

function makeMockStream() {
  const audioTrack = { stop: vi.fn(), label: "Mock microphone", getSettings: vi.fn(() => ({})) };

  return {
    getTracks: () => [audioTrack],
    getAudioTracks: () => [audioTrack],
  } as unknown as MediaStream;
}

// ── URL.createObjectURL / revokeObjectURL stubs ───────────────────────────────

beforeEach(() => {
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue("blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useVoice — recording lifecycle", () => {
  it("fires onError('No audio recorded') when stopRecording is called with no chunks", async () => {
    const onError = vi.fn();
    const sendAudio = vi.fn();

    const mockCtx = makeMockAudioContext();

    // Patch AudioContext constructor
    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => mockCtx));

    const mockStream = makeMockStream();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { result } = renderHook(() =>
      useVoice({ onError, sendAudio })
    );

    // Start recording
    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.state).toBe("recording");

    // Stop without feeding any audio — chunksRef stays empty
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatch(/No audio recorded/);
    expect(sendAudio).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("calls sendAudio when audio chunks are present", async () => {
    const onError = vi.fn();
    const sendAudio = vi.fn();

    let capturedProcessHandler: AudioProcessHandler | null = null;

    const mockCtx = makeMockAudioContext((handler) => {
      capturedProcessHandler = handler;
    });

    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => mockCtx));

    const mockStream = makeMockStream();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { result } = renderHook(() =>
      useVoice({ onError, sendAudio })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    // Feed audio frame via the onaudioprocess callback
    if (capturedProcessHandler) {
      act(() => {
        capturedProcessHandler!({
          inputBuffer: {
            getChannelData: () => new Float32Array(128).fill(0.5),
          },
        });
      });
    }

    await act(async () => {
      await result.current.stopRecording();
    });

    // onError must NOT be called with "No audio recorded"
    const recordingErrors = onError.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("No audio recorded")
    );
    expect(recordingErrors).toHaveLength(0);
    // Verify sendAudio was called (with any audio data)
    expect(sendAudio).toHaveBeenCalledOnce();
  });
});
