#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const configTargets = [
  {
    label: "Root environment",
    source: resolve(repoRoot, ".env.example"),
    target: resolve(repoRoot, ".env"),
    required: true,
  },
  {
    label: "Web environment",
    source: resolve(repoRoot, "packages/web/.env.example"),
    target: resolve(repoRoot, "packages/web/.env"),
    required: false,
  },
];

let hasError = false;

for (const item of configTargets) {
  if (!existsSync(item.source)) {
    if (item.required) {
      console.error(`[app:config] Missing template: ${item.source}`);
      hasError = true;
    }
    continue;
  }

  if (existsSync(item.target)) {
    console.log(`[app:config] Keep existing ${item.label}: ${item.target}`);
    continue;
  }

  copyFileSync(item.source, item.target);
  console.log(`[app:config] Created ${item.label}: ${item.target}`);
}

if (hasError) {
  process.exit(1);
}

console.log("[app:config] Done. Edit .env and packages/web/.env if needed.");
