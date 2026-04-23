#!/usr/bin/env node
/**
 * build-usecase-matrix.mjs
 * Scans gateway layer files and generates usecases.matrix.json at repo root.
 *
 * Usage:
 *   node scripts/build-usecase-matrix.mjs           # generate JSON only
 *   node scripts/build-usecase-matrix.mjs --report  # generate + print table
 *   node scripts/build-usecase-matrix.mjs --check   # compare existing vs scan, exit 1 if mismatch
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── UC group definitions ──────────────────────────────────────────────────────

const UC_GROUPS = [
  { id: "UC1",  name: "GUI & Peripherals",         files: ["layers/surface.ts"] },
  { id: "UC2",  name: "Window & App Management",   files: ["layers/deep-os.ts"] },
  { id: "UC3",  name: "File System Operations",    files: ["layers/deep.ts"] },
  { id: "UC4",  name: "Browser Automation",        files: ["layers/browser.ts"] },
  { id: "UC5",  name: "System & Network",          files: ["layers/deep-system.ts"] },
  { id: "UC6",  name: "Communication & Media",     files: ["layers/communication.ts"] },
  { id: "UC7",  name: "Workflow Automation",       files: ["layers/media.ts"] },
  { id: "UC8",  name: "Software & Environment",    files: ["layers/software.ts"] },
  { id: "UC9",  name: "Hardware Control",          files: ["layers/hardware.ts"] },
  { id: "UC10", name: "Multi-Device / Fleet",      files: ["layers/fleet.ts"] },
  { id: "UC11", name: "Developer & CLI",           files: ["layers/developer.ts"] },
  { id: "UC12", name: "Maintenance",               files: ["layers/maintenance.ts"] },
  { id: "UC13", name: "Permission & Security",     files: ["vision/approval-policy.ts", "vision/permission-responder.ts"] },
];

const LAYERS_ROOT = resolve(ROOT, "packages/gateway/src");

// ── Method extraction ─────────────────────────────────────────────────────────

// Matches class methods: optional modifiers then identifier followed by '('
// Also matches top-level exported functions
const METHOD_RE = /^[ \t]+(?:(?:public|private|protected|override|abstract|static|async|readonly)[ \t]+)*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*[<(]/gm;
const EXPORT_FN_RE = /^export[ \t]+(?:async[ \t]+)?function[ \t]+([a-zA-Z_][a-zA-Z0-9_]*)/gm;

// Common noise: constructor, super, if, for, while, switch, return, etc.
const EXCLUDED = new Set([
  "constructor", "if", "for", "while", "switch", "return", "throw", "catch",
  "new", "super", "get", "set", "typeof", "instanceof", "delete", "void",
  "await", "yield", "import", "export", "from", "as", "of", "in",
  "try", "finally", "break", "continue", "case", "default",
  "true", "false", "null", "undefined",
]);

function extractMethods(source) {
  const names = new Set();

  let m;

  // Class methods
  const mRe = new RegExp(METHOD_RE.source, "gm");
  while ((m = mRe.exec(source)) !== null) {
    const name = m[1];
    if (!EXCLUDED.has(name) && !/^[A-Z]/.test(name)) {
      names.add(name);
    }
  }

  // Exported functions
  const fRe = new RegExp(EXPORT_FN_RE.source, "gm");
  while ((m = fRe.exec(source)) !== null) {
    const name = m[1];
    if (!EXCLUDED.has(name)) {
      names.add(name);
    }
  }

  return [...names].sort();
}

// ── Load overrides ────────────────────────────────────────────────────────────

function loadOverrides() {
  const overridesPath = resolve(ROOT, "usecases.overrides.json");
  if (!existsSync(overridesPath)) return {};
  try {
    return JSON.parse(readFileSync(overridesPath, "utf8"));
  } catch {
    return {};
  }
}

// ── Build matrix ──────────────────────────────────────────────────────────────

function buildMatrix() {
  const overrides = loadOverrides();
  const groups = [];
  let totalItems = 0;
  let totalImplemented = 0;
  let totalPartial = 0;
  let totalPlanned = 0;

  for (const group of UC_GROUPS) {
    const methods = [];

    for (const relPath of group.files) {
      const absPath = resolve(LAYERS_ROOT, relPath);
      if (!existsSync(absPath)) {
        // File missing — mark all items as planned (no methods to extract)
        continue;
      }
      const source = readFileSync(absPath, "utf8");
      const extracted = extractMethods(source);
      for (const name of extracted) {
        if (!methods.includes(name)) methods.push(name);
      }
    }

    const items = methods.sort().map((name) => {
      const itemId = `${group.id}.${name}`;
      const defaultStatus = group.files.some((f) => existsSync(resolve(LAYERS_ROOT, f)))
        ? "implemented"
        : "planned";
      const status = overrides[itemId] ?? defaultStatus;
      return { id: itemId, title: name, status };
    });

    // If no methods found but file exists, treat as planned group
    if (items.length === 0 && group.files.every((f) => !existsSync(resolve(LAYERS_ROOT, f)))) {
      // planned placeholder
      items.push({ id: `${group.id}.unknown`, title: "(not found)", status: "planned" });
    }

    const impl = items.filter((i) => i.status === "implemented").length;
    const part = items.filter((i) => i.status === "partial").length;
    const plan = items.filter((i) => i.status === "planned").length;

    totalItems += items.length;
    totalImplemented += impl;
    totalPartial += part;
    totalPlanned += plan;

    groups.push({ id: group.id, name: group.name, items });
  }

  return {
    groups,
    generatedAt: new Date().toISOString(),
    totals: {
      total: totalItems,
      implemented: totalImplemented,
      partial: totalPartial,
      planned: totalPlanned,
    },
  };
}

// ── Report ────────────────────────────────────────────────────────────────────

function printReport(matrix) {
  const { groups, totals, generatedAt } = matrix;

  console.log(`\nOmniState Use Case Coverage Report — ${generatedAt}`);
  console.log("─".repeat(82));

  const header = pad("UC", 5) + pad("Name", 30) + pad("Total", 7) + pad("Impl", 7) + pad("Part", 7) + pad("Plan", 7) + pad("%", 7);
  console.log(header);
  console.log("─".repeat(82));

  for (const g of groups) {
    const impl = g.items.filter((i) => i.status === "implemented").length;
    const part = g.items.filter((i) => i.status === "partial").length;
    const plan = g.items.filter((i) => i.status === "planned").length;
    const total = g.items.length;
    const pct = total > 0 ? Math.round((impl / total) * 100) : 0;

    console.log(
      pad(g.id, 5) +
      pad(g.name, 30) +
      pad(String(total), 7) +
      pad(String(impl), 7) +
      pad(String(part), 7) +
      pad(String(plan), 7) +
      pad(`${pct}%`, 7)
    );
  }

  console.log("─".repeat(82));
  const pct = totals.total > 0 ? Math.round((totals.implemented / totals.total) * 100) : 0;
  console.log(
    pad("TOT", 5) +
    pad("All Groups", 30) +
    pad(String(totals.total), 7) +
    pad(String(totals.implemented), 7) +
    pad(String(totals.partial), 7) +
    pad(String(totals.planned), 7) +
    pad(`${pct}%`, 7)
  );
  console.log("─".repeat(82));
  console.log();
}

function pad(str, len) {
  return str.length >= len ? str.slice(0, len - 1) + " " : str + " ".repeat(len - str.length);
}

// ── Check (CI guard) ──────────────────────────────────────────────────────────

function checkMatrix() {
  const outputPath = resolve(ROOT, "usecases.matrix.json");
  if (!existsSync(outputPath)) {
    console.error("ERROR: usecases.matrix.json not found. Run: node scripts/build-usecase-matrix.mjs");
    process.exit(1);
  }

  const existing = JSON.parse(readFileSync(outputPath, "utf8"));
  const fresh = buildMatrix();

  // Compare by group totals and item ids
  let mismatch = false;

  if (existing.groups.length !== fresh.groups.length) {
    console.error(`MISMATCH: group count changed (${existing.groups.length} → ${fresh.groups.length})`);
    mismatch = true;
  }

  for (const freshGroup of fresh.groups) {
    const existingGroup = existing.groups.find((g) => g.id === freshGroup.id);
    if (!existingGroup) {
      console.error(`MISMATCH: group ${freshGroup.id} missing from existing matrix`);
      mismatch = true;
      continue;
    }

    const newIds = new Set(freshGroup.items.map((i) => i.id));
    const oldIds = new Set(existingGroup.items.map((i) => i.id));

    const added = [...newIds].filter((id) => !oldIds.has(id));
    const removed = [...oldIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      console.error(`MISMATCH in ${freshGroup.id}: +${added.length} added, -${removed.length} removed`);
      if (added.length > 0 && added.length <= 5) console.error(`  Added: ${added.join(", ")}`);
      if (removed.length > 0 && removed.length <= 5) console.error(`  Removed: ${removed.join(", ")}`);
      mismatch = true;
    }
  }

  if (mismatch) {
    console.error("\nRun `node scripts/build-usecase-matrix.mjs` to regenerate and commit the updated matrix.");
    process.exit(1);
  } else {
    console.log("✅ usecases.matrix.json is up to date.");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isReport = args.includes("--report");
const isCheck = args.includes("--check");

if (isCheck) {
  checkMatrix();
} else {
  const matrix = buildMatrix();
  const outputPath = resolve(ROOT, "usecases.matrix.json");
  writeFileSync(outputPath, JSON.stringify(matrix, null, 2) + "\n", "utf8");
  console.log(`Generated ${outputPath} (${matrix.totals.total} methods across ${matrix.groups.length} groups)`);

  if (isReport) {
    printReport(matrix);
  }
}
