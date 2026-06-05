import { describe, expect, it } from "vitest";
import { ALL_TOOLS, TOOLS } from "../llm/tools.js";

const QUARANTINED = [
  "wifi.monitor.start",
  "wifi.monitor.stop",
  "network.capture",
  "network.scan.hosts",
  "network.scan.ports",
];

describe("llm tool catalog", () => {
  it("keeps quarantined pentest-grade tools out of the default mainline list", () => {
    const names = new Set(TOOLS.map((tool) => tool.name));

    for (const name of QUARANTINED) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("retains quarantined tools in the full catalog for explicit/internal use", () => {
    const names = new Set(ALL_TOOLS.map((tool) => tool.name));

    for (const name of QUARANTINED) {
      expect(names.has(name)).toBe(true);
    }
  });
});
