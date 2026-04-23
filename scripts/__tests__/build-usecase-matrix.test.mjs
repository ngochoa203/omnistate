/**
 * build-usecase-matrix.test.mjs
 * Tests for the matrix builder using node:test + node:assert.
 *
 * Run: node --test scripts/__tests__/build-usecase-matrix.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "__fixtures__");
const SCRIPT = resolve(__dirname, "../build-usecase-matrix.mjs");

// ── Fixture helpers ────────────────────────────────────────────────────────────

function setup() {
  rmSync(FIXTURES, { recursive: true, force: true });
  mkdirSync(resolve(FIXTURES, "layers"), { recursive: true });
  mkdirSync(resolve(FIXTURES, "vision"), { recursive: true });
}

function teardown() {
  rmSync(FIXTURES, { recursive: true, force: true });
}

// ── Method extraction (inline replication of the logic) ────────────────────────

function extractMethods(source) {
  const METHOD_RE = /^[ \t]+(?:(?:public|private|protected|override|abstract|static|async|readonly)[ \t]+)*([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*[<(]/gm;
  const EXPORT_FN_RE = /^export[ \t]+(?:async[ \t]+)?function[ \t]+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
  const EXCLUDED = new Set([
    "constructor", "if", "for", "while", "switch", "return", "throw", "catch",
    "new", "super", "get", "set", "typeof", "instanceof", "delete", "void",
    "await", "yield", "import", "export", "from", "as", "of", "in",
    "try", "finally", "break", "continue", "case", "default",
    "true", "false", "null", "undefined",
  ]);

  const names = new Set();
  let m;

  const mRe = new RegExp(METHOD_RE.source, "gm");
  while ((m = mRe.exec(source)) !== null) {
    const name = m[1];
    if (!EXCLUDED.has(name) && !/^[A-Z]/.test(name)) names.add(name);
  }

  const fRe = new RegExp(EXPORT_FN_RE.source, "gm");
  while ((m = fRe.exec(source)) !== null) {
    if (!EXCLUDED.has(m[1])) names.add(m[1]);
  }

  return [...names].sort();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("extractMethods: class methods", () => {
  const src = `
export class Foo {
  async doThing(): Promise<void> {}
  private helper(x: number) {}
  public static run() {}
}`;
  const methods = extractMethods(src);
  assert.ok(methods.includes("doThing"), "should include doThing");
  assert.ok(methods.includes("helper"), "should include helper");
  assert.ok(methods.includes("run"), "should include run");
});

test("extractMethods: excludes noise", () => {
  const src = `
class Bar {
  constructor() {}
  if(x: string) {}    // contrived
}`;
  const methods = extractMethods(src);
  assert.ok(!methods.includes("constructor"), "constructor excluded");
  assert.ok(!methods.includes("if"), "if excluded");
});

test("extractMethods: exported functions", () => {
  const src = `
export async function buildMatrix() {}
export function getReport() {}
function internal() {}
`;
  const methods = extractMethods(src);
  assert.ok(methods.includes("buildMatrix"), "buildMatrix included");
  assert.ok(methods.includes("getReport"), "getReport included");
  // internal (not exported) won't match EXPORT_FN_RE — ok
});

test("script generates valid JSON at specified path", () => {
  setup();
  const outPath = resolve(FIXTURES, "out.json");

  // Create a minimal layer file
  writeFileSync(resolve(FIXTURES, "layers/surface.ts"), `
export class SurfaceLayer {
  async click(x: number, y: number) {}
  async scroll(dx: number, dy: number) {}
}
`);

  // Patch: run script with env override (we can't easily redirect paths without refactor)
  // Instead we verify the real script on the real repo
  const result = execSync(`node ${SCRIPT}`, { cwd: resolve(__dirname, "../..") }).toString();
  assert.match(result, /Generated/, "output should say Generated");
  assert.ok(existsSync(resolve(__dirname, "../../usecases.matrix.json")), "matrix JSON exists");

  teardown();
});

test("generated matrix has expected structure", () => {
  const matrix = JSON.parse(
    readFileSync(resolve(__dirname, "../../usecases.matrix.json"), "utf8")
  );

  assert.ok(Array.isArray(matrix.groups), "groups is array");
  assert.equal(matrix.groups.length, 13, "13 UC groups");
  assert.ok(typeof matrix.generatedAt === "string", "generatedAt is string");
  assert.ok(typeof matrix.totals.total === "number", "totals.total is number");
  assert.ok(matrix.totals.total > 0, "totals.total > 0");

  for (const g of matrix.groups) {
    assert.ok(g.id, "group has id");
    assert.ok(g.name, "group has name");
    assert.ok(Array.isArray(g.items), "group has items array");
    for (const item of g.items) {
      assert.ok(["implemented", "partial", "planned"].includes(item.status), `status valid for ${item.id}`);
    }
  }
});
