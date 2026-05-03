#!/usr/bin/env node
/**
 * Copy the built N-API binary to the gateway package.
 *
 * Maps the cargo output (cdylib) to the Node.js native module filename
 * convention: omnistate.<platform>-<arch>.node
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

const platform = process.platform;
const arch = process.arch;

// Map platform to cargo output filename
const sourceNames = {
  darwin: "libomnistate_napi.dylib",
  win32: "omnistate_napi.dll",
  linux: "libomnistate_napi.so",
};

const sourceName = sourceNames[platform];
if (!sourceName) {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

const source = join(root, "target", "release", sourceName);
if (!existsSync(source)) {
  console.error(`Native binary not found: ${source}`);
  console.error("Run 'cargo build -p omnistate-napi --release' first.");
  process.exit(1);
}

// Map to Node.js naming convention
const platformMap = { darwin: "darwin", win32: "win32", linux: "linux" };
const archMap = { arm64: "arm64", x64: "x64" };

const targetName = `omnistate.${platformMap[platform]}-${archMap[arch] || arch}.node`;
const targetDir = join(root, "packages", "gateway", "native");
const target = join(targetDir, targetName);

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

console.log(`Copied native binary: ${sourceName} -> ${targetName}`);
console.log(`  From: ${source}`);
console.log(`  To:   ${target}`);
