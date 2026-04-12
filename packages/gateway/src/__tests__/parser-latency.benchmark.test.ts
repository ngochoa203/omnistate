import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { planFromIntent } from "../planner/intent.js";

describe("parser latency benchmark", () => {
  it("keeps p95 latency under configured budget", async () => {
    const samples = [
      "move mouse to x 100 y 120 and click at x 300 y 320",
      "move mouse to x 200 y 240 then scroll down 600",
      "click submit button then scroll down 120",
      "type \"Tom and Jerry\" then scroll down 100",
      "move chuot toi x 120 y 180 sau day click at x 400 y 420 roi cuon len 300",
      "double click submit button then scroll down 200",
      "dung click submit button then scroll down 200",
      "khong scroll down 300",
      "click at x:100;y:200",
      "click at 100,200",
    ];

    const warmup = 80;
    const rounds = 500;
    const timings: number[] = [];

    for (let i = 0; i < warmup; i += 1) {
      const text = samples[i % samples.length];
      await planFromIntent({
        type: "ui-interaction",
        entities: {},
        confidence: 0.95,
        rawText: text,
      });
    }

    for (let i = 0; i < rounds; i += 1) {
      const text = samples[i % samples.length];
      const t0 = performance.now();
      await planFromIntent({
        type: "ui-interaction",
        entities: {},
        confidence: 0.95,
        rawText: text,
      });
      timings.push(performance.now() - t0);
    }

    timings.sort((a, b) => a - b);
    const avg = timings.reduce((sum, v) => sum + v, 0) / timings.length;
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;

    const p95Budget = Number(process.env.PARSER_BENCH_P95_MS ?? "20");
    const avgBudget = Number(process.env.PARSER_BENCH_AVG_MS ?? "8");
    const enforceBudget = process.env.PARSER_BENCH_ENFORCE === "1";

    console.info(
      `[parser-latency] rounds=${rounds} avgMs=${avg.toFixed(3)} p95Ms=${p95.toFixed(3)} budgetAvg=${avgBudget} budgetP95=${p95Budget}`,
    );

    if (enforceBudget) {
      expect(avg).toBeLessThan(avgBudget);
      expect(p95).toBeLessThan(p95Budget);
      return;
    }

    expect(Number.isFinite(avg)).toBe(true);
    expect(Number.isFinite(p95)).toBe(true);
  });
});
