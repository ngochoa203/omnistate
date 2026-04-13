import { describe, expect, it } from "vitest";
import { planFromIntent } from "../planner/intent.js";

const baseIntent = {
  type: "ui-interaction" as const,
  entities: {},
  confidence: 0.95,
};

describe("ui parser phrase fuzz", () => {
  it("keeps click+scroll chain across connector variants", async () => {
    const connectors = ["then", "r", "xong", "->", "sau do", "sau đó", "roi", "rồi"];

    for (const connector of connectors) {
      const plan = await planFromIntent({
        ...baseIntent,
        rawText: `click submit button ${connector} scroll down 120`,
      });

      const tools = plan.nodes.map((n) => n.action.tool);
      expect(tools).toContain("ui.click");
      expect(tools).toContain("ui.scroll");
    }
  });

  it("keeps only allowed action for negated click variants", async () => {
    const negations = ["dont", "don't", "do not", "khong", "ko", "dung"];

    for (const negation of negations) {
      const plan = await planFromIntent({
        ...baseIntent,
        rawText: `${negation} click submit button then scroll down 120`,
      });

      const tools = plan.nodes.map((n) => n.action.tool);
      expect(tools).not.toContain("ui.click");
      expect(tools).toContain("ui.scroll");
    }
  });

  it("does not throw on mixed no-accent and accented Vietnamese phrases", async () => {
    const phrases = [
      "move chuot toi x 120 y 180 sau day click at x 400 y 420 roi cuon len 300",
      "move chuột tới x 120 y 180 sau đó click at x 400 y 420 rồi cuộn lên 300",
      "right click submit button",
      "click at x:100;y:200",
      "type Tom and Jerry",
    ];

    for (const rawText of phrases) {
      const plan = await planFromIntent({
        ...baseIntent,
        rawText,
      });

      expect(plan.nodes.length).toBeGreaterThan(0);
    }
  });
});
