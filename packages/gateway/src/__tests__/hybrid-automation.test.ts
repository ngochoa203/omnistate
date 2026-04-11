import { describe, it, expect } from "vitest";
import {
  startRemoteBridge,
  stopRemoteBridge,
  handleRemoteCommand,
} from "../hybrid/automation.js";

describe("Hybrid automation remote bridge auth", () => {
  it("rejects command when no active bridge exists", async () => {
    const result = await handleRemoteCommand({
      id: "cmd-no-bridge",
      type: "plan",
      payload: { text: "echo test" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No active remote bridge");
  });

  it("rejects command with invalid auth token", async () => {
    const bridge = await startRemoteBridge({
      authToken: "secret-token",
      allowShell: true,
    });

    const result = await handleRemoteCommand({
      id: "cmd-bad-token",
      bridgeId: bridge.id,
      authToken: "wrong-token",
      type: "plan",
      payload: { text: "echo test" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid auth token");

    stopRemoteBridge(bridge.id);
  });

  it("rejects shell command when shell execution is disabled", async () => {
    const bridge = await startRemoteBridge({
      authToken: "token-shell-off",
      allowShell: false,
    });

    const result = await handleRemoteCommand({
      id: "cmd-shell-disabled",
      bridgeId: bridge.id,
      authToken: "token-shell-off",
      type: "shell",
      payload: { command: "echo should-not-run" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Shell execution disabled");

    stopRemoteBridge(bridge.id);
  });
});
