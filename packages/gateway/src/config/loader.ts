import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import JSON5 from "json5";
import { gatewayConfigSchema, type GatewayConfig } from "./schema.js";

const DEFAULT_CONFIG_PATH = "~/.omnistate/config.json";

/**
 * Load and validate configuration from the specified path.
 * Falls back to default values if the file does not exist.
 */
export function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH
): GatewayConfig {
  const resolvedPath = configPath.replace(/^~/, homedir());
  const absolutePath = resolve(resolvedPath);

  let raw: Record<string, unknown> = {};
  if (existsSync(absolutePath)) {
    const content = readFileSync(absolutePath, "utf-8");
    raw = JSON5.parse(content);
  }

  return gatewayConfigSchema.parse(raw);
}
