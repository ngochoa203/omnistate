import { describe, expect, it, vi, afterEach } from "vitest";
import { getCapabilityContract } from "@omnistate/shared";

vi.mock("../platform/bridge.js", () => ({
  isNativeAvailable: () => false,
}));

vi.mock("../layers/browser.js", () => ({
  BrowserLayer: class {
    async waitForPageLoad(): Promise<void> {}

    async getActiveTab(): Promise<{ index: number; url: string; title: string; active: boolean; windowIndex: number }> {
      return {
        index: 1,
        url: "https://www.youtube.com/watch?v=test",
        title: "Test Video",
        active: true,
        windowIndex: 1,
      };
    }
  },
}));

import { SurfaceLayer } from "../layers/surface.js";
import * as visionEngineModule from "../vision/engine.js";
import { verifyStep, _resetVerifySingletons } from "../executor/verify.js";

afterEach(() => {
  _resetVerifySingletons();
});

describe("capability contracts", () => {
  it("provides an implemented contract for app.launch", () => {
    const contract = getCapabilityContract("app.launch");
    expect(contract?.status).toBe("implemented");
    expect(contract?.verifier).toBe("process");
  });

  it("provides an honest unsupported contract entry", () => {
    const contract = getCapabilityContract("unsupported.capability");
    expect(contract?.status).toBe("unsupported");
  });

  it("classifies read-only deep macOS observability as public and allowed by default", () => {
    const contract = getCapabilityContract("iokit.thermals");
    expect(contract?.status).toBe("implemented");
    expect(contract?.riskTier).toBe("read-only");
    expect(contract?.policy).toEqual({
      platform: "macos",
      stability: "public",
      requiresPrivilege: false,
      requiresConfirmation: false,
      allowedByDefault: true,
    });
  });

  it("marks privileged deep macOS mutation paths as non-default and confirmation-gated", () => {
    const contract = getCapabilityContract("kernel.sysctl.set");
    expect(contract?.status).toBe("flagged");
    expect(contract?.riskTier).toBe("system-sensitive");
    expect(contract?.policy?.stability).toBe("privileged");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("classifies Wi-Fi pentest surfaces as experimental and not allowed by default", () => {
    const contract = getCapabilityContract("wifi.capture.handshake");
    expect(contract?.status).toBe("flagged");
    expect(contract?.riskTier).toBe("destructive");
    expect(contract?.policy?.stability).toBe("experimental");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks wifi.deep.scan as experimental read-only and not allowed by default", () => {
    const contract = getCapabilityContract("wifi.deep.scan");
    expect(contract?.status).toBe("experimental");
    expect(contract?.riskTier).toBe("read-only");
    expect(contract?.verifier).toBe("api");
    expect(contract?.policy?.requiresPrivilege).toBe(false);
    expect(contract?.policy?.requiresConfirmation).toBe(false);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks wifi.monitor.start as experimental and privilege+confirmation gated", () => {
    const contract = getCapabilityContract("wifi.monitor.start");
    expect(contract?.status).toBe("experimental");
    expect(contract?.riskTier).toBe("system-sensitive");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks wifi.monitor.stop as experimental with sudo but no confirmation", () => {
    const contract = getCapabilityContract("wifi.monitor.stop");
    expect(contract?.status).toBe("experimental");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(false);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks wifi.channel.set as experimental and confirmation-gated", () => {
    const contract = getCapabilityContract("wifi.channel.set");
    expect(contract?.status).toBe("experimental");
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks wifi.deauth as experimental destructive with legal warning", () => {
    const contract = getCapabilityContract("wifi.deauth");
    expect(contract?.status).toBe("experimental");
    expect(contract?.riskTier).toBe("destructive");
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
    expect(contract?.notes).toContain("Legal WARNING");
  });

  it("marks wifi.crack.handshake as experimental and destructive", () => {
    const contract = getCapabilityContract("wifi.crack.handshake");
    expect(contract?.status).toBe("experimental");
    expect(contract?.riskTier).toBe("destructive");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.notes).toContain("aircrack-ng");
    expect(contract?.notes).toContain("Legal WARNING");
  });

  it("marks wifi.install-tools as flagged and confirmation-gated", () => {
    const contract = getCapabilityContract("wifi.install-tools");
    expect(contract?.status).toBe("flagged");
    expect(contract?.riskTier).toBe("system-sensitive");
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
    expect(contract?.notes).toContain("aircrack-ng");
  });

  it("resolves wifi.tools.install to the same flagged contract alias", () => {
    const contract = getCapabilityContract("wifi.tools.install");
    expect(contract?.id).toBe("wifi.install-tools");
    expect(contract?.status).toBe("flagged");
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks network.capture as experimental and privilege-gated", () => {
    const contract = getCapabilityContract("network.capture");
    expect(contract?.status).toBe("experimental");
    expect(contract?.verifier).toBe("file");
    expect(contract?.policy?.requiresPrivilege).toBe(true);
    expect(contract?.policy?.requiresConfirmation).toBe(true);
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks network.scan.hosts as experimental and not allowed by default", () => {
    const contract = getCapabilityContract("network.scan.hosts");
    expect(contract?.status).toBe("experimental");
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });

  it("marks network.scan.ports as experimental and not allowed by default", () => {
    const contract = getCapabilityContract("network.scan.ports");
    expect(contract?.status).toBe("experimental");
    expect(contract?.policy?.allowedByDefault).toBe(false);
  });
});

describe("typed verification results", () => {
  it("returns verified status for matching API verification", async () => {
    const result = await verifyStep(
      {
        id: "verify-api",
        type: "verify",
        layer: "deep",
        action: { description: "verify", tool: "verify.api", params: {} },
        verify: { strategy: "api", expected: "ready", timeoutMs: 500 },
        dependencies: [],
        onSuccess: null,
        onFailure: { strategy: "abort" },
        estimatedDurationMs: 10,
        priority: "normal",
      },
      {
        nodeId: "verify-api",
        status: "ok",
        layer: "deep",
        durationMs: 1,
        data: { state: "ready" },
      },
    );

    expect(result.passed).toBe(true);
    expect(result.verification.status).toBe("verified");
    expect(result.verification.verifier).toBe("api");
  });

  it("marks unavailable screenshot verification as unsupported instead of fake pass", async () => {
    const result = await verifyStep(
      {
        id: "verify-screenshot",
        type: "verify",
        layer: "surface",
        action: { description: "verify", tool: "verify.screenshot", params: {} },
        verify: { strategy: "screenshot", expected: "loaded", timeoutMs: 500 },
        dependencies: [],
        onSuccess: null,
        onFailure: { strategy: "abort" },
        estimatedDurationMs: 10,
        priority: "normal",
      },
      {
        nodeId: "verify-screenshot",
        status: "ok",
        layer: "surface",
        durationMs: 1,
        data: {},
      },
    );

    expect(result.passed).toBe(true);
    expect(result.verification.status).toBe("unsupported");
    expect(result.verification.summary).toContain("skipped");
  });

  it("returns verified status for matching browser-state verification", async () => {
    const result = await verifyStep(
      {
        id: "verify-browser-state",
        type: "verify",
        layer: "deep",
        action: { description: "verify browser", tool: "verify.browser-state", params: {} },
        verify: {
          strategy: "browser-state",
          expected: JSON.stringify({
            url: "https://www.youtube.com/watch?v=test",
            browser: "safari",
          }),
          timeoutMs: 500,
        },
        dependencies: [],
        onSuccess: null,
        onFailure: { strategy: "abort" },
        estimatedDurationMs: 10,
        priority: "normal",
      },
      {
        nodeId: "verify-browser-state",
        status: "ok",
        layer: "deep",
        durationMs: 1,
        data: {},
      },
    );

    expect(result.passed).toBe(true);
    expect(result.verification.status).toBe("verified");
    expect(result.verification.verifier).toBe("app-state");
  });
});

describe("screenshot exception policy", () => {
  // ── SurfaceLayer mock helpers ──────────────────────────────────────────────────

  const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function makeScreenshotNode(expected = "loaded"): Parameters<typeof verifyStep>[0] {
    return {
      id: "screenshot-exc",
      type: "verify",
      layer: "surface",
      action: { description: "verify", tool: "verify.screenshot", params: {} },
      verify: { strategy: "screenshot", expected, timeoutMs: 500 },
      dependencies: [],
      onSuccess: null,
      onFailure: { strategy: "abort" },
      estimatedDurationMs: 10,
      priority: "normal",
    };
  }

  const okStepResult = (): Parameters<typeof verifyStep>[1] => ({
    nodeId: "screenshot-exc",
    status: "ok",
    layer: "surface",
    durationMs: 1,
    data: {},
  });

  it("screenshot verifier exception → passed: false (not true)", async () => {
    vi.spyOn(SurfaceLayer.prototype, "isAvailable", "get").mockReturnValue(true);
    vi.spyOn(SurfaceLayer.prototype, "captureScreen").mockRejectedValue(
      new Error("CaptureBridge crashed — access violation"),
    );

    _resetVerifySingletons();
    const result = await verifyStep(makeScreenshotNode(), okStepResult());

    expect(result.passed).toBe(false);
    expect(result.verification.status).toBe("contradicted");
    expect(result.verification.verifier).toBe("vision");
    expect(result.verification.confidence).toBe(0);
    expect(result.reason).toContain("Screenshot verify error");
    expect(result.reason).toContain("CaptureBridge");
  });

  it("vision engine exception → passed: false (not true)", async () => {
    vi.spyOn(SurfaceLayer.prototype, "isAvailable", "get").mockReturnValue(true);
    vi.spyOn(SurfaceLayer.prototype, "captureScreen").mockResolvedValue({
      data: FAKE_PNG,
    } as Awaited<ReturnType<SurfaceLayer["captureScreen"]>>);
    vi.spyOn(visionEngineModule, "createDefaultEngine").mockReturnValue({
      registerProvider: vi.fn(),
      detectElements: vi.fn(),
      verifyState: vi.fn(async () => {
        throw new Error("Vision API timeout after 30s");
      }),
    } as unknown as visionEngineModule.VisionEngine);

    _resetVerifySingletons();
    const result = await verifyStep(makeScreenshotNode(), okStepResult());

    expect(result.passed).toBe(false);
    expect(result.verification.status).toBe("contradicted");
    expect(result.verification.verifier).toBe("vision");
    expect(result.verification.confidence).toBe(0);
    expect(result.reason).toContain("Screenshot verify error");
    expect(result.reason).toContain("Vision API timeout");
  });

  it("raw-pixel capture (no PNG/JPEG header) → still runs vision (status unverified, confidence 0.3)", async () => {
    vi.spyOn(SurfaceLayer.prototype, "isAvailable", "get").mockReturnValue(true);
    vi.spyOn(SurfaceLayer.prototype, "captureScreen").mockResolvedValue({
      data: new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    } as Awaited<ReturnType<SurfaceLayer["captureScreen"]>>);

    _resetVerifySingletons();
    const result = await verifyStep(makeScreenshotNode(), okStepResult());

    // raw pixel → unverified, not verified → passes current (already-correct) policy
    expect(result.passed).toBe(true);
    expect(result.verification.status).toBe("unverified");
    expect(result.verification.confidence).toBe(0.3);
  });
});
