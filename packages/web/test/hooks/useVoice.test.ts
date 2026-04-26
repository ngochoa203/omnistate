/**
 * useVoice VAD gate tests.
 *
 * We exercise the hook's stopRecording() path in isolation by mocking
 * AudioContext, AudioWorkletNode, and getUserMedia so the hook can run
 * in jsdom. We feed silent audio (all-zero Float32Array) to trigger the
 * VAD guard (speechFrames < 5 && peakRms < 0.02) and assert that onError
 * fires with the STT_NO_SPEECH message while sendAudio is NOT called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoice } from "../../src/hooks/useVoice";

// ── AudioContext / AudioWorklet mock ──────────────────────────────────────────

type MessageHandler = (e: { data: Float32Array }) => void;

function makeMockAudioContext(onWorkletMessage: (handler: MessageHandler) => void) {
  const mockWorkletNode = {
    port: {
      set onmessage(handler: MessageHandler) {
        onWorkletMessage(handler);
      },
    },
    disconnect: vi.fn(),
  };

  const mockSource = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockAudioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  return {
    audioWorklet: mockAudioWorklet,
    createMediaStreamSource: vi.fn().mockReturnValue(mockSource),
    createScriptProcessor: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    destination: {},
    sampleRate: 16000,
    workletNode: mockWorkletNode,
    AudioWorkletNode: vi.fn().mockReturnValue(mockWorkletNode),
    source: mockSource,
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

describe("useVoice — VAD gate", () => {
  it("fires onError with STT_NO_SPEECH and does NOT call sendAudio for silent audio", async () => {
    const onError = vi.fn();
    const sendAudio = vi.fn();

    let capturedMessageHandler: MessageHandler | null = null;

    const mockCtx = makeMockAudioContext((handler) => {
      capturedMessageHandler = handler;
    });

    // Patch AudioContext constructor
    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => mockCtx));
    // Patch AudioWorkletNode constructor
    vi.stubGlobal("AudioWorkletNode", mockCtx.AudioWorkletNode);

    const mockStream = makeMockStream();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { result } = renderHook(() =>
      useVoice({ onError, sendAudio, vadThreshold: 0.015 })
    );

    // Start recording
    await act(async () => {
      await result.current.startRecording();
    });

    // Wait for AudioWorklet addModule to resolve and workletNode to be set up
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Feed a single silent frame via the worklet message handler (all zeros → rms = 0)
    // This simulates the onmessage callback from the PCMProcessor worklet
    if (capturedMessageHandler) {
      act(() => {
        capturedMessageHandler!({ data: new Float32Array(128) });
      });
    }

    // Stop recording — triggers VAD check
    await act(async () => {
      await result.current.stopRecording();
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatch(/STT_NO_SPEECH/);
    expect(sendAudio).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("does NOT fire STT_NO_SPEECH when audio has sufficient speech frames", async () => {
    const onError = vi.fn();
    const sendAudio = vi.fn();

    let capturedMessageHandler: MessageHandler | null = null;

    const mockCtx = makeMockAudioContext((handler) => {
      capturedMessageHandler = handler;
    });

    vi.stubGlobal("AudioContext", vi.fn().mockImplementation(() => mockCtx));
    vi.stubGlobal("AudioWorkletNode", mockCtx.AudioWorkletNode);

    // Stub encodeWav and blobToBase64 to avoid @omnistate/mobile-core import
    vi.mock("../../src/lib/audio-utils", () => ({
      encodeWav: vi.fn().mockReturnValue(new Blob(["wav"])),
      blobToBase64: vi.fn().mockResolvedValue("base64audio=="),
    }));

    const mockStream = makeMockStream();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const { result } = renderHook(() =>
      useVoice({ onError, sendAudio, vadThreshold: 0.015 })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Feed 6 loud frames (rms >> 0.02 threshold)
    if (capturedMessageHandler) {
      act(() => {
        for (let i = 0; i < 6; i++) {
          const frame = new Float32Array(128).fill(0.5); // rms = 0.5, well above thresholds
          capturedMessageHandler!({ data: frame });
        }
      });
    }

    await act(async () => {
      await result.current.stopRecording();
    });

    // VAD should pass — onError must NOT be called with STT_NO_SPEECH
    const speechErrors = onError.mock.calls.filter(([msg]) => msg.includes("STT_NO_SPEECH"));
    expect(speechErrors).toHaveLength(0);
  });
});
