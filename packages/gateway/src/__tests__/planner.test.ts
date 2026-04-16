/**
 * E2E tests for intent classification and plan building.
 *
 * All tests use the regex/heuristic fallback — no API key required.
 * The ANTHROPIC_API_KEY env var is unset before each test to guarantee
 * the heuristic path is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { classifyIntent, planFromIntent } from "../planner/intent.js";

// ── Ensure no API key is present so heuristic path is always used ─────────────

const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
const originalRequireLlm = process.env.OMNISTATE_REQUIRE_LLM;

beforeEach(() => {
  // Remove API key so classifyWithLLM returns null and heuristics take over
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OMNISTATE_REQUIRE_LLM = "false";
});

afterEach(() => {
  if (originalAnthropicApiKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }
  if (originalRequireLlm !== undefined) {
    process.env.OMNISTATE_REQUIRE_LLM = originalRequireLlm;
  } else {
    delete process.env.OMNISTATE_REQUIRE_LLM;
  }
  vi.restoreAllMocks();
});

// ── Intent classification ─────────────────────────────────────────────────────

describe("classifyIntent() — regex heuristic fallback (no API key)", () => {
  it('classifies "ls -la" as shell-command', async () => {
    // "ls" matches the file-operation regex; but let's use an explicit run phrase
    const intent = await classifyIntent("run ls -la");
    expect(intent.type).toBe("shell-command");
    expect(intent.rawText).toBe("run ls -la");
  });

  it('classifies "execute npm install" as shell-command', async () => {
    const intent = await classifyIntent("execute npm install");
    expect(intent.type).toBe("shell-command");
  });

  it('classifies "open Safari" as app-launch', async () => {
    const intent = await classifyIntent("open Safari");
    expect(intent.type).toBe("app-launch");
  });

  it('classifies "launch Chrome browser" as app-launch', async () => {
    const intent = await classifyIntent("launch Chrome browser");
    expect(intent.type).toBe("app-launch");
  });

  it('classifies "check disk space" as system-query', async () => {
    const intent = await classifyIntent("check disk space");
    expect(intent.type).toBe("system-query");
  });

  it('classifies "how much memory is free" as system-query', async () => {
    const intent = await classifyIntent("how much memory is free");
    expect(intent.type).toBe("system-query");
  });

  it('classifies "click the submit button" as ui-interaction', async () => {
    const intent = await classifyIntent("click the submit button");
    expect(intent.type).toBe("ui-interaction");
  });

  it('classifies "copy file.txt to /tmp" as file-operation', async () => {
    const intent = await classifyIntent("copy file.txt to /tmp");
    expect(intent.type).toBe("file-operation");
  });

  it('classifies messaging command as app-control', async () => {
    const intent = await classifyIntent("Open zalo and message for 0389027907 with text 'Hi'");
    expect(intent.type).toBe("app-control");
  });

  it("returns the original rawText regardless of type", async () => {
    const text = "check disk space";
    const intent = await classifyIntent(text);
    expect(intent.rawText).toBe(text);
  });

  it("confidence is between 0 and 1", async () => {
    const intent = await classifyIntent("open Safari");
    expect(intent.confidence).toBeGreaterThan(0);
    expect(intent.confidence).toBeLessThanOrEqual(1);
  });

  it("unknown text falls back to multi-step with low confidence", async () => {
    const intent = await classifyIntent("do something weird and indescribable xyz123");
    expect(["multi-step", "automation-macro"]).toContain(intent.type);
    expect(intent.confidence).toBeLessThan(0.5);
  });
});

// ── Plan building ─────────────────────────────────────────────────────────────

describe("planFromIntent() — plan structure", () => {
  it("shell-command intent produces a plan with a deep-layer 'shell.exec' node", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);

    expect(plan.taskId).toMatch(/^task-\d+$/);
    expect(plan.goal).toBe("run ls -la");
    expect(plan.nodes.length).toBeGreaterThan(0);

    const execNode = plan.nodes.find((n) => n.action.tool === "shell.exec");
    expect(execNode).toBeDefined();
    expect(execNode!.layer).toBe("deep");
  });

  it("app-launch intent produces launch + verify nodes", async () => {
    const intent = await classifyIntent("open Safari");
    const plan = await planFromIntent(intent);

    const launchNode = plan.nodes.find((n) => n.action.tool === "app.launch");
    const verifyNode = plan.nodes.find((n) => n.type === "verify");

    expect(launchNode).toBeDefined();
    expect(launchNode!.layer).toBe("deep");
    expect(verifyNode).toBeDefined();
    expect(verifyNode!.layer).toBe("surface");
  });

  it("system-query intent produces a deep-layer node", async () => {
    const intent = await classifyIntent("check disk space");
    const plan = await planFromIntent(intent);

    const queryNode = plan.nodes.find(
      (n) => n.layer === "deep" || n.action.tool === "system.query"
    );
    expect(queryNode).toBeDefined();
  });

  it("ui-interaction intent produces multiple surface nodes", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "click the submit button",
    };
    const plan = await planFromIntent(intent);

    const surfaceNodes = plan.nodes.filter((n) => n.layer === "surface");
    expect(surfaceNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("file-operation intent produces a deep-layer node", async () => {
    const intent = await classifyIntent("copy file.txt to /tmp");
    const plan = await planFromIntent(intent);

    const fileNode = plan.nodes.find((n) => n.layer === "deep");
    expect(fileNode).toBeDefined();
  });

  it("plan estimatedDuration is a non-empty string", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);
    expect(typeof plan.estimatedDuration).toBe("string");
    expect(plan.estimatedDuration.length).toBeGreaterThan(0);
  });

  it("each node has required fields: id, type, layer, action, dependencies", async () => {
    const intent = await classifyIntent("run ls -la");
    const plan = await planFromIntent(intent);

    for (const node of plan.nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.type).toBe("string");
      expect(typeof node.layer).toBe("string");
      expect(typeof node.action).toBe("object");
      expect(typeof node.action.tool).toBe("string");
      expect(Array.isArray(node.dependencies)).toBe(true);
    }
  });

  it("health-check intent maps filesystem integrity requests to health.filesystem", async () => {
    const intent = {
      type: "health-check",
      entities: {},
      confidence: 0.9,
      rawText: "run filesystem integrity check with fsck",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("health.filesystem");
  });

  it("self-healing intent maps cert expiry requests to health.certExpiry", async () => {
    const intent = {
      type: "self-healing",
      entities: {},
      confidence: 0.9,
      rawText: "self-heal by checking TLS certificate expiry for example.com",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("health.certExpiry");
  });

  it("self-healing intent maps log anomaly requests to health.logAnomalies", async () => {
    const intent = {
      type: "self-healing",
      entities: {},
      confidence: 0.9,
      rawText: "self-heal by detecting log anomalies",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("health.logAnomalies");
  });

  it("app-control unmute intent should not map to mute command", async () => {
    const intent = {
      type: "audio-management",
      entities: {},
      confidence: 0.9,
      rawText: "please unmute audio",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("without output muted");
  });

  it("automation-macro stop intent maps to hybrid.macro.stop", async () => {
    const intent = {
      type: "automation-macro",
      entities: {},
      confidence: 0.9,
      rawText: "stop macro recording",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("hybrid.macro.stop");
  });

  it("ui-interaction drag intent with coordinates maps to ui.drag", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "drag from 100,200 to 400,500",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("ui.drag");
    expect(plan.nodes[0]?.action.params?.fromX).toBe(100);
    expect(plan.nodes[0]?.action.params?.toY).toBe(500);
  });

  it("ui-interaction move mouse intent maps to ui.move", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "move mouse to 320 240",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[0]?.action.params?.x).toBe(320);
    expect(plan.nodes[0]?.action.params?.y).toBe(240);
  });

  it("ui-interaction click with comma coordinates maps to ui.clickAt", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click at 100,200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[0]?.action.params?.x).toBe(100);
    expect(plan.nodes[0]?.action.params?.y).toBe(200);
  });

  it("ui-interaction click with x:y semicolon format maps to ui.clickAt", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click at x:100;y:200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[0]?.action.params?.x).toBe(100);
    expect(plan.nodes[0]?.action.params?.y).toBe(200);
  });

  it("ui-interaction move then click with one coordinate creates two ordered actions", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 640 y 360 and left click",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[1]?.dependencies).toEqual(["move"]);
    expect(plan.nodes[1]?.action.params?.x).toBe(640);
    expect(plan.nodes[1]?.action.params?.y).toBe(360);
    expect(plan.nodes[1]?.action.params?.button).toBe("left");
  });

  it("ui-interaction move then click with two coordinates uses second point for click", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 100 y 120 and click at x 300 y 320",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[0]?.action.params?.x).toBe(100);
    expect(plan.nodes[0]?.action.params?.y).toBe(120);
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[1]?.action.params?.x).toBe(300);
    expect(plan.nodes[1]?.action.params?.y).toBe(320);
  });

  it("ui-interaction move then scroll builds ordered move->scroll nodes", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 200 y 240 and scroll down 600",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["move"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-600);
  });

  it("ui-interaction move click scroll builds ordered move->click->scroll", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 100 y 150 and click at x 300 y 350 then scroll up 400",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(3);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[2]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["move"]);
    expect(plan.nodes[2]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[2]?.action.params?.dy).toBe(400);
  });

  it("ui-interaction chain parser supports Vietnamese connectors sau do/roi", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 120 y 180 sau do click at x 400 y 420 roi cuon len 300",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(3);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[2]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["move"]);
    expect(plan.nodes[2]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[2]?.action.params?.dy).toBe(300);
  });

  it("ui-interaction chain parser supports accented Vietnamese connectors sau do/roi", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move mouse to x 120 y 180 sau đó click at x 400 y 420 rồi cuộn lên 300",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(3);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[2]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[2]?.action.params?.dy).toBe(300);
  });

  it("ui-interaction chain parser handles no-accent Vietnamese phrasing", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "move chuot toi x 120 y 180 sau day click at x 400 y 420 roi cuon len 300",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(3);
    expect(plan.nodes[0]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[2]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[2]?.action.params?.dy).toBe(300);
  });

  it("ui-interaction chain parser can mix query click then scroll", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button then scroll down 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[0]?.action.params?.query).toContain("click submit button");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-200);
  });

  it("ui-interaction parser keeps click then scroll in same segment with and", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button and scroll down 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
  });

  it("ui-interaction chain parser supports teencode short connector r", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button r scroll down 120",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-120);
  });

  it("ui-interaction chain parser supports xong connector", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button xong cuon xuong 150",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-150);
  });

  it("ui-interaction chain parser supports arrow connector", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button -> scroll down 80",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-80);
  });

  it("ui-interaction chain parser does not leak later coordinates into earlier query click", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "click submit button then move mouse to x 100 y 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.move");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.x).toBe(100);
    expect(plan.nodes[1]?.action.params?.y).toBe(200);
  });

  it("ui-interaction chain parser keeps quoted type text that contains connector words", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "type \"Tom and Jerry\" then scroll down 100",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.type");
    expect(plan.nodes[0]?.action.params?.text).toBe("Tom and Jerry");
    expect(plan.nodes[1]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[1]?.action.params?.dy).toBe(-100);
  });

  it("ui-interaction type without quotes keeps 'and' text payload", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "type Tom and Jerry",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.type");
    expect(plan.nodes[0]?.action.params?.text).toBe("Tom and Jerry");
  });

  it("ui-interaction type without quotes keeps Vietnamese 'va' payload", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "type xin chao va tam biet",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.type");
    expect(plan.nodes[0]?.action.params?.text).toBe("xin chao va tam biet");
  });

  it("ui-interaction double click query chain keeps both clicks before scroll", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "double click submit button then scroll down 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(3);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
    expect(plan.nodes[2]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[2]?.dependencies).toEqual(["interact-2"]);
    expect(plan.nodes[2]?.action.params?.dy).toBe(-200);
  });

  it("ui-interaction standalone double click query keeps two click actions", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "double click submit button",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(2);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.action.tool).toBe("ui.click");
    expect(plan.nodes[1]?.dependencies).toEqual(["interact"]);
  });

  it("ui-interaction negative phrase does not click when told don't click", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "don't click at 100,200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.wait");
    expect(plan.nodes[0]?.id).toBe("no-op");
  });

  it("ui-interaction negative phrase does not scroll when told khong scroll", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "khong scroll down 300",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.wait");
    expect(plan.nodes[0]?.id).toBe("no-op");
  });

  it("ui-interaction mixed negation keeps allowed steps only", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "dung click submit button then scroll down 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[0]?.action.params?.dy).toBe(-200);
  });

  it("ui-interaction scoped negation does not cancel following action", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "do not click and scroll down 200",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.scroll");
    expect(plan.nodes[0]?.action.params?.dy).toBe(-200);
  });

  it("ui-interaction right click with coordinates maps to ui.clickAt with right button", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "right click at x 480 y 360",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("ui.clickAt");
    expect(plan.nodes[0]?.action.params?.button).toBe("right");
    expect(plan.nodes[0]?.action.params?.x).toBe(480);
    expect(plan.nodes[0]?.action.params?.y).toBe(360);
  });

  it("ui-interaction standalone right click query preserves right button intent", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.95,
      rawText: "right click submit button",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes.length).toBe(1);
    expect(plan.nodes[0]?.action.tool).toBe("ui.click");
    expect(plan.nodes[0]?.action.params?.button).toBe("right");
  });

  it("ui-interaction modal detection intent maps to vision.modal.detect", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "check if any modal dialog is open",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("vision.modal.detect");
  });

  it("ui-interaction captcha intent maps to vision.captcha.detect", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "detect captcha on this page",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("vision.captcha.detect");
  });

  it("ui-interaction table extraction intent maps to vision.table.extract", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "extract table from screen",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("vision.table.extract");
  });

  it("ui-interaction accessibility audit intent maps to vision.a11y.audit", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "run accessibility audit for this UI",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("vision.a11y.audit");
  });

  it("ui-interaction language detection intent maps to vision.language.detect", async () => {
    const intent = {
      type: "ui-interaction",
      entities: {},
      confidence: 0.9,
      rawText: "detect ui language",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("vision.language.detect");
  });

  it("split window left intent is classified as app-control and builds split action", async () => {
    const intent = await classifyIntent("split window left on safari");
    const plan = await planFromIntent(intent);

    const tools = plan.nodes.map((n) => n.action.tool);
    expect(tools).toContain("app.script");
    const scriptNode = plan.nodes.find((n) => n.action.tool === "app.script");
    expect(String(scriptNode?.action.params?.script ?? "")).toContain("left arrow");
  });

  it("autofill form intent maps to app.script with javascript form fill", async () => {
    const intent = await classifyIntent("fill form name: John Doe, email: john@example.com on safari");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("ui-interaction");
    expect(plan.nodes[0]?.action.tool).toBe("app.script");
    expect(String(plan.nodes[0]?.action.params?.script ?? "")).toContain("do JavaScript");
  });

  it("data-entry workflow builds per-field verify nodes with retry", async () => {
    const intent = await classifyIntent("data entry name: Alice, phone: 0909");
    const plan = await planFromIntent(intent);

    expect(plan.nodes.some((n) => n.id === "data-entry-type-0")).toBe(true);
    expect(plan.nodes.some((n) => n.id === "data-entry-verify-0")).toBe(true);

    const verifyNode = plan.nodes.find((n) => n.id === "data-entry-verify-0");
    expect(verifyNode?.type).toBe("verify");
    expect(verifyNode?.verify?.strategy).toBe("screenshot");
    expect(verifyNode?.onFailure?.strategy).toBe("retry");
  });

  it("bookmark intent maps to keyboard shortcut action", async () => {
    const intent = await classifyIntent("bookmark this page on safari");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("app-control");
    expect(plan.nodes[1]?.action.tool ?? plan.nodes[0]?.action.tool).toBe("ui.key");
  });

  it("clear browser history intent maps to browser management action", async () => {
    const intent = await classifyIntent("clear history and cache on chrome");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("app-control");
    expect(plan.nodes[1]?.action.tool ?? plan.nodes[0]?.action.tool).toMatch(/app\.script|ui\.key/);
  });

  it("bookmark intent produces Cmd+D keyboard shortcut", async () => {
    const intent = await classifyIntent("bookmark this page");
    const plan = await planFromIntent(intent);
    const actionNode = plan.nodes.find((n) => n.action.tool === "ui.key");
    const scriptNode = plan.nodes.find((n) => n.action.tool === "app.script");

    expect(actionNode || scriptNode).toBeDefined();
    if (actionNode) {
      expect(actionNode.action.params?.key).toBe("d");
      expect(actionNode.action.params?.modifiers).toMatchObject({ meta: true });
    } else {
      expect(String(scriptNode?.action.params?.script ?? "")).toContain("keystroke");
    }
  });

  it("show history intent produces Cmd+Y keyboard shortcut", async () => {
    const intent = await classifyIntent("show browser history");
    const plan = await planFromIntent(intent);
    const actionNode = plan.nodes.find((n) => n.action.tool === "ui.key");

    expect(actionNode).toBeDefined();
    expect(actionNode?.action.params?.key).toBe("y");
  });

  it("camera permission lock intent routes to security-management shell command", async () => {
    const intent = await classifyIntent("lock webcam permission");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("tccutil reset Camera");
  });

  it("vault password intent routes to Bitwarden copy command", async () => {
    const intent = await classifyIntent("get password from bitwarden for github");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("bw get password");
  });

  it("quick email intent maps to Mail app script", async () => {
    const intent = await classifyIntent("send email to alice@example.com subject: Sprint Update body: Build is green");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("app-control");
    expect(plan.nodes[1]?.action.tool ?? plan.nodes[0]?.action.tool).toBe("app.script");
    expect(String(plan.nodes[1]?.action.params?.script ?? plan.nodes[0]?.action.params?.script ?? "")).toContain("tell application \"Mail\"");
  });

  it("calendar scheduling intent maps to Calendar app script", async () => {
    const intent = await classifyIntent("schedule meeting \"Weekly Sync\" tomorrow at 3pm for 45 minutes");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("app-control");
    expect(plan.nodes[1]?.action.tool ?? plan.nodes[0]?.action.tool).toBe("app.script");
    expect(String(plan.nodes[1]?.action.params?.script ?? plan.nodes[0]?.action.params?.script ?? "")).toContain("tell application \"Calendar\"");
  });

  it("reminder/timer intent maps to reminder automation script", async () => {
    const intent = await classifyIntent("set reminder to submit report in 30 minutes");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[1]?.action.tool ?? plan.nodes[0]?.action.tool).toBe("app.script");
    expect(String(plan.nodes[1]?.action.params?.script ?? plan.nodes[0]?.action.params?.script ?? "")).toMatch(/Reminders|Timer/);
  });

  it("physical display switch intent maps to display settings command", async () => {
    const intent = await classifyIntent("switch to external monitor and mirror display");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("Displays-Settings.extension");
  });

  it("disk trim scheduling intent maps to scheduled disk verify command", async () => {
    const intent = await classifyIntent("schedule weekly SSD trim optimization");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("crontab -l");
  });

  it("work-context summarization intent maps to shell context summary command", async () => {
    const intent = await classifyIntent("summarize my current workspace context");
    const plan = await planFromIntent(intent);

    const firstTool = plan.nodes[0]?.action.tool;
    expect(["shell.exec", "system.info"]).toContain(firstTool);
    if (firstTool === "shell.exec") {
      expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("ACTIVE APP");
    }
  });

  it("wifi enable intent maps to networksetup power on command", async () => {
    const intent = await classifyIntent("turn on wifi");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("network-control");
    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("-setairportpower en0 on");
  });

  it("wifi connect intent maps to setairportnetwork command", async () => {
    const intent = await classifyIntent("connect wifi ssid: OfficeNet password: secret123");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("network-control");
    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("-setairportnetwork en0");
  });

  it("bluetooth toggle intent maps to blueutil fallback command", async () => {
    const intent = await classifyIntent("turn off bluetooth");
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("blueutil --power 0");
  });

  it("on-screen translation intent maps to OCR + translate command", async () => {
    const intent = await classifyIntent("translate screen text to vietnamese");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("ui-interaction");
    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("translate.google.com");
  });

  it("screen capture intent should map to screen.capture instead of ui.click", async () => {
    const intent = await classifyIntent("screen capture my macbook and send in here");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("ui-interaction");
    expect(plan.nodes[0]?.action.tool).toBe("screen.capture");
  });

  it("install app intent maps to brew install flow", async () => {
    const intent = {
      type: "package-management",
      entities: {},
      confidence: 0.9,
      rawText: "install chrome with brew cask",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("brew install");
  });

  it("uninstall app intent maps to cleanup uninstall flow", async () => {
    const intent = {
      type: "package-management",
      entities: {},
      confidence: 0.9,
      rawText: "uninstall slack and clean leftovers",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("brew uninstall");
  });

  it("startup app listing intent maps to login items query", async () => {
    const intent = {
      type: "package-management",
      entities: {},
      confidence: 0.9,
      rawText: "list startup apps and login items",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("login item");
  });

  it("automatic network repair intent maps to remediation command", async () => {
    const intent = {
      type: "self-healing",
      entities: {},
      confidence: 0.9,
      rawText: "repair my network automatically",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("flushcache");
  });

  it("performance tuning intent maps to diagnostics command", async () => {
    const intent = {
      type: "self-healing",
      entities: {},
      confidence: 0.9,
      rawText: "optimize system performance and detect memory leak",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("memory_pressure");
  });

  it("zip folder intent maps to zip -r command", async () => {
    const intent = {
      type: "file-operation",
      entities: {},
      confidence: 0.9,
      rawText: "zip folder Documents into docs_backup",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("zip -r");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("docs_backup.zip");
  });

  it("unzip archive intent maps to unzip command", async () => {
    const intent = {
      type: "file-operation",
      entities: {},
      confidence: 0.9,
      rawText: "unzip archive backup.zip to restored",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("unzip -o");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("-d \"restored\"");
  });

  it("encrypt folder intent maps to hdiutil encryption command", async () => {
    const intent = {
      type: "security-management",
      entities: {},
      confidence: 0.9,
      rawText: "encrypt folder path: ~/Documents/Secret",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("hdiutil create -encryption");
  });

  it("secure shred intent maps to secure delete command", async () => {
    const intent = {
      type: "security-management",
      entities: {},
      confidence: 0.9,
      rawText: "secure shred file path: ~/Desktop/secret.txt",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("Secure delete attempted");
  });

  it("git commit intent maps to git add + commit command", async () => {
    const intent = {
      type: "shell-command",
      entities: {},
      confidence: 0.9,
      rawText: "commit all changes message: planner hardening",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("git add -A && git commit -m");
  });

  it("focus mode on intent maps to shell focus command", async () => {
    const intent = {
      type: "os-config",
      entities: {},
      confidence: 0.9,
      rawText: "turn on do not disturb focus mode",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("Focus-Settings.extension");
  });

  it("log error analysis intent maps to shell log summary command", async () => {
    const intent = {
      type: "debug-assist",
      entities: {},
      confidence: 0.9,
      rawText: "analyze error logs and summarize crashes",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("log show --last 24h");
  });

  it("workspace organization intent maps to hybrid organizeFiles strategy", async () => {
    const intent = {
      type: "file-organization",
      entities: {},
      confidence: 0.9,
      rawText: "organize workspace files",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("hybrid.organizeFiles");
    expect(String(plan.nodes[0]?.action.params?.strategy ?? "")).toBe("smart-workspace");
  });

  it("safe eject usb intent maps to diskutil unmount command", async () => {
    const intent = {
      type: "peripheral-management",
      entities: {},
      confidence: 0.9,
      rawText: "safe eject disk: disk2",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("diskutil unmountDisk /dev/disk2");
  });

  it("printer queue intent maps to lpstat queue command", async () => {
    const intent = {
      type: "printer-management",
      entities: {},
      confidence: 0.9,
      rawText: "show print queue jobs",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("lpstat -o");
  });

  it("container compose up intent maps to docker compose up", async () => {
    const intent = {
      type: "container-management",
      entities: {},
      confidence: 0.9,
      rawText: "start compose stack",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("docker compose up -d");
  });

  it("python virtual env setup intent maps to python venv command", async () => {
    const intent = {
      type: "container-management",
      entities: {},
      confidence: 0.9,
      rawText: "create python virtual env in ~/Projects/sample",
    };
    const plan = await planFromIntent(intent);

    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("python3 -m venv .venv");
  });

  it("app-control phrase with 'on safari' should activate Safari instead of target website keyword", async () => {
    const intent = await classifyIntent(
      "open youtube on safari and play video first in search 'Chao em co gai lam hong'"
    );
    const plan = await planFromIntent(intent);

    const activateNode = plan.nodes.find((n) => n.action.tool === "app.activate");
    expect(activateNode).toBeDefined();
    expect(activateNode?.action.params?.name).toBe("Safari");
  });

  it("open <query> on youtube should map to browser app-control flow", async () => {
    const intent = await classifyIntent("open Do Mixi on youtube");
    const plan = await planFromIntent(intent);

    const activateNode = plan.nodes.find((n) => n.action.tool === "app.activate");
    const scriptNode = plan.nodes.find((n) => n.action.tool === "app.script");
    expect(activateNode).toBeDefined();
    expect(activateNode?.action.params?.name).toBe("Safari");
    expect(scriptNode).toBeDefined();
    expect(String(scriptNode?.action.params?.script ?? "")).toContain("youtube.com/results?search_query=Do%20Mixi");
  });

  it("create react project with vite in Projects maps to shell command", async () => {
    const intent = await classifyIntent("Create project react use vite in Projects");
    const plan = await planFromIntent(intent);

    expect(intent.type).toBe("shell-command");
    expect(plan.nodes[0]?.action.tool).toBe("shell.exec");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("npm create vite@latest");
    expect(String(plan.nodes[0]?.action.params?.command ?? "")).toContain("$HOME/Projects");
  });

  it("zalo messaging phrase surfaces an LLM provider error when generation fails", async () => {
    const intent = await classifyIntent(
      "Open zalo and message for 0389027907 with text 'Hi'"
    );

    await expect(planFromIntent(intent)).rejects.toThrow(
      /(LLM API error|No enabled LLM providers|Insufficient credits|Invalid API credentials)/i
    );
  });

  it("multi-step fallback should pass plain goal string to generic.execute", async () => {
    const intent = {
      type: "multi-step",
      entities: {},
      confidence: 0.3,
      rawText: "do something impossible xyz 123",
    };
    const plan = await planFromIntent(intent);

    expect(["generic.execute", "chat.ask"]).toContain(plan.nodes[0]?.action.tool);
    if (plan.nodes[0]?.action.tool === "generic.execute") {
      expect(plan.nodes[0]?.action.params?.goal).toBe("do something impossible xyz 123");
    }
  });
});
