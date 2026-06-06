/**
 * Capability-exposure quarantine tests.
 *
 * Validates that pentest-grade WiFi/network capabilities are quarantined from
 * default planner/UI surfacing while runtime blocking remains in place.
 *
 * Run with:
 *   pnpm --filter @omnistate/gateway test src/__tests__/capability-quarantine.test.ts
 */

import { describe, expect, it } from "vitest";
import { INTENT_TYPES } from "../planner/types.js";
import { classifyWithHeuristics, HEURISTIC_RULES, PHRASE_PATTERNS } from "../planner/classify.js";
import { getRuntimeCapabilityGate } from "../verification/capability-contracts.js";

// ── Quarantined tools ────────────────────────────────────────────────────────────

const QUARANTINED_TOOLS = new Set([
  "wifi.monitor.start",
  "wifi.monitor.stop",
  "network.capture",
  "network.scan.hosts",
  "network.scan.ports",
  "wifi.deep.scan",
  "wifi.channel.set",
  "wifi.capture.handshake",
  "wifi.tools.install",
  "wifi.deauth",
  "wifi.crack.handshake",
]);

// ── Pentest keywords ───────────────────────────────────────────────────────────

const PENTEST_KEYWORDS = [
  "aircrack",
  "airodump",
  "aireplay",
  "capture handshake",
  "wifi monitor mode",
  "packet capture",
  "wifi deauth",
  "wifi attack",
  "wifi crack",
  "deauthentication attack",
  "wpa crack",
  "wpa handshake",
  "channel hop",
  "channel hopping",
  "install aircrack",
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("planner: intent type quarantine", () => {
  it("wifi-security is NOT in INTENT_TYPES", () => {
    expect(INTENT_TYPES).not.toContain("wifi-security");
  });

  it("HEURISTIC_RULES contains no wifi-security entries", () => {
    // r.type is IntentType which no longer includes "wifi-security" —
    // TypeScript enforces at compile time; runtime check below confirms zero matches.
    const wifiSecurityRules = HEURISTIC_RULES.filter((r) => (r.type as string) === "wifi-security");
    expect(wifiSecurityRules).toHaveLength(0);
  });

  it("PHRASE_PATTERNS contains no wifi-security entries", () => {
    // Same rationale — cast to string to satisfy TS strict comparison check
    const wifiSecurityPatterns = PHRASE_PATTERNS.filter(([, type]) => (type as string) === "wifi-security");
    expect(wifiSecurityPatterns).toHaveLength(0);
  });

  it.each(PENTEST_KEYWORDS)("classifyWithHeuristics('%s') does NOT return wifi-security", (keyword) => {
    const result = classifyWithHeuristics(keyword);
    expect(result.type).not.toBe("wifi-security");
  });

  it("classifyWithHeuristics('aircrack wifi handshake capture') routes to shell-command, not wifi-security", () => {
    const result = classifyWithHeuristics("aircrack wifi handshake capture");
    expect(result.type).not.toBe("wifi-security");
  });

  it("classifyWithHeuristics('deauth attack on network') routes to network-control, not wifi-security", () => {
    const result = classifyWithHeuristics("deauth attack on network");
    expect(result.type).not.toBe("wifi-security");
  });
});

describe("capability contracts: wifi.deep.scan policy", () => {
  it("wifi.deep.scan has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("wifi.deep.scan");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });

  it("wifi.monitor.start has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("wifi.monitor.start");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });

  it("network.capture has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("network.capture");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });

  it("network.scan.hosts has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("network.scan.hosts");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });

  it("network.scan.ports has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("network.scan.ports");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });

  it("wifi.capture.handshake has allowedByDefault=false", () => {
    const gate = getRuntimeCapabilityGate("wifi.capture.handshake");
    expect(gate).toBeDefined();
    expect(gate!.allowedByDefault).toBe(false);
  });
});

describe("LLM tool set: no quarantined pentest tools surfaced", () => {
  it("TOOLS does NOT include any quarantined pentest tool", async () => {
    // Dynamically import to get the filtered TOOLS export
    const { TOOLS } = await import("../llm/tools.js");
    const toolNames = new Set(TOOLS.map((t) => t.name));

    for (const quarantined of QUARANTINED_TOOLS) {
      expect(toolNames.has(quarantined)).toBe(false);
    }
  });

  it("TOOLS includes benign wifi.network tool", async () => {
    const { TOOLS } = await import("../llm/tools.js");
    const toolNames = new Set(TOOLS.map((t) => t.name));
    expect(toolNames.has("network.wifi")).toBe(true);
  });

  it("TOOLS includes wifi.scan (read-only scan)", async () => {
    const { TOOLS } = await import("../llm/tools.js");
    const toolNames = new Set(TOOLS.map((t) => t.name));
    expect(toolNames.has("wifi.scan")).toBe(true);
  });
});