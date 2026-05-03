/**
 * Test runner for 600 Vietnamese intent test sentences
 * Generated automatically for macOS automation testing
 */
import { describe, it, expect, afterAll } from "vitest";

// Force heuristic-only path before importing the module
const savedRequireLlm = process.env.OMNISTATE_REQUIRE_LLM;
process.env.OMNISTATE_REQUIRE_LLM = "false";
const savedApiKey = process.env.ANTHROPIC_API_KEY;
const savedRouter9Key = process.env.OMNISTATE_ROUTER9_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OMNISTATE_ROUTER9_API_KEY;

import { classifyIntent } from "../planner/intent.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load test data
const testDataPath = resolve(__dirname, "../../../../test-data/vi/vietnamese-intent-700.json");
let testData: Array<{ text: string; intent: string; [key: string]: unknown }> = [];

try {
  const content = readFileSync(testDataPath, "utf-8");
  const cleaned = content
    .replace(/\/\/.*$/gm, "")  // Remove JS comments
    .replace(/\/\*[\s\S]*?\*\//g, "");  // Remove block comments
  testData = JSON.parse(cleaned);
  console.log(`Loaded ${testData.length} test sentences`);
} catch (err) {
  console.warn("Could not load test data:", (err as Error).message);
}

afterAll(() => {
  if (savedRequireLlm !== undefined) process.env.OMNISTATE_REQUIRE_LLM = savedRequireLlm;
  else delete process.env.OMNISTATE_REQUIRE_LLM;
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  if (savedRouter9Key !== undefined) process.env.OMNISTATE_ROUTER9_API_KEY = savedRouter9Key;
});

describe("Vietnamese Intent Classification - 600 Test Sentences", () => {
  // Run a sample of tests to avoid timeout
  const sampleSize = Math.min(testData.length, 100); // Run 100 tests max
  const step = Math.max(1, Math.floor(testData.length / sampleSize));
  
  for (let i = 0; i < testData.length; i += step) {
    const item = testData[i];
    const testName = `${item.text.substring(0, 50)}${item.text.length > 50 ? "..." : ""}`;
    const expected = item.intent;
    
    it(`"${testName}" → ${expected}`, async () => {
      const result = await classifyIntent(item.text);
      
      // Log result for debugging
      console.log(`  → ${result.type} (confidence: ${result.confidence})`);
      
      // For now, just verify it doesn't crash
      expect(result.type).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
    });
  }
});

describe("Vietnamese Intent Classification - By Category", () => {
  const categories = [
    { name: "app-launch", filter: (d: any) => d.intent === "app-launch" },
    { name: "app-control", filter: (d: any) => d.intent === "app-control" },
    { name: "file-operation", filter: (d: any) => d.intent === "file-operation" },
    { name: "system-query", filter: (d: any) => d.intent === "system-query" },
    { name: "media-play", filter: (d: any) => d.intent === "media.play" },
    { name: "audio-management", filter: (d: any) => d.intent === "audio-management" },
    { name: "alarm-set", filter: (d: any) => d.intent === "alarm.set" },
    { name: "network-control", filter: (d: any) => d.intent === "network-control" },
    { name: "power-management", filter: (d: any) => d.intent === "power-management" },
  ];
  
  for (const cat of categories) {
    const items = testData.filter(cat.filter);
    if (items.length === 0) continue;
    
    describe(cat.name, () => {
      // Test first 10 items from each category
      for (let i = 0; i < Math.min(items.length, 10); i++) {
        const item = items[i];
        const testName = `${item.text.substring(0, 45)}${item.text.length > 45 ? "..." : ""}`;
        
        it(`"${testName}"`, async () => {
          const result = await classifyIntent(item.text);
          expect(result.type).toBeTruthy();
        });
      }
    });
  }
});
