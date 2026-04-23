#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";

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

const rootEnvPath = resolve(repoRoot, ".env");
const webEnvPath = resolve(repoRoot, "packages/web/.env");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf-8");
  const result = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    result[key] = value;
  }

  return result;
}

function upsertEnvValue(filePath, key, value) {
  const content = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const lines = content ? content.split(/\r?\n/) : [];
  let found = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(`${key}=${value}`);
  }

  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

function askValueLabel(key) {
  switch (key) {
    case "ANTHROPIC_API_KEY":
      return "Anthropic API key";
    case "ANTHROPIC_BASE_URL":
      return "Anthropic base URL";
    case "OPENAI_API_KEY":
      return "OpenAI API key";
    case "OPENAI_BASE_URL":
      return "OpenAI base URL";
    case "OMNISTATE_PORT":
      return "Gateway port";
    case "OMNISTATE_BIND":
      return "Gateway bind host";
    case "VITE_GATEWAY_WS_URL":
      return "Web gateway ws URL";
    default:
      return key;
  }
}

function maskSecret(value) {
  if (!value) return "(empty)";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function valueOrDefault(value, fallback = "(unset)") {
  return value && value.trim() ? value : fallback;
}

function printDashboard(rootEnv, webEnv) {
  const model = valueOrDefault(rootEnv.OMNISTATE_MODEL, "trolllm/claude-sonnet-4.6");
  const mode = valueOrDefault(rootEnv.OMNISTATE_GATEWAY_MODE, "local");
  const port = valueOrDefault(rootEnv.OMNISTATE_PORT, "19800");
  const bind = valueOrDefault(rootEnv.OMNISTATE_BIND, "127.0.0.1");
  const remote = valueOrDefault(webEnv.VITE_GATEWAY_WS_URL, "ws://127.0.0.1:19800/ws");

  console.log("");
  console.log("OmniState configure");
  console.log("");
  console.log("+--------------------------------------------------+");
  console.log("| Existing config detected                         |");
  console.log("|                                                  |");
  console.log(`| model: ${model.padEnd(41).slice(0, 41)}|`);
  console.log(`| gateway.mode: ${mode.padEnd(34).slice(0, 34)}|`);
  console.log(`| gateway.port: ${port.padEnd(34).slice(0, 34)}|`);
  console.log(`| gateway.bind: ${bind.padEnd(34).slice(0, 34)}|`);
  console.log(`| gateway.remote.url: ${remote.padEnd(28).slice(0, 28)}|`);
  console.log("+--------------------------------------------------+");
  console.log("");
}

const SECTION_ITEMS = [
  { id: "1", label: "Workspace (Set workspace + sessions)" },
  { id: "2", label: "Model" },
  { id: "3", label: "Web tools" },
  { id: "4", label: "Gateway" },
  { id: "5", label: "Daemon" },
  { id: "6", label: "Channels" },
  { id: "7", label: "Skills" },
  { id: "8", label: "Health check" },
  { id: "9", label: "Continue (save + exit)" },
];

function renderConfigScreen(rootEnv, webEnv, selectedIndex) {
  console.clear();
  printDashboard(rootEnv, webEnv);
  console.log("Select sections to configure");
  console.log("Use ↑/↓ to move, Enter to select.");
  console.log("");

  SECTION_ITEMS.forEach((item, index) => {
    const marker = index === selectedIndex ? "❯" : " ";
    console.log(` ${marker} ${item.label}`);
  });
  console.log("");
}

async function selectSectionWithArrows(rootEnv, webEnv, initialIndex = 0) {
  let selectedIndex = Math.max(0, Math.min(initialIndex, SECTION_ITEMS.length - 1));

  return new Promise((resolveSelection) => {
    emitKeypressEvents(stdin);

    const canUseRawMode = typeof stdin.setRawMode === "function";
    if (canUseRawMode) stdin.setRawMode(true);

    const cleanup = () => {
      stdin.off("keypress", onKeyPress);
      if (canUseRawMode) stdin.setRawMode(false);
    };

    const onKeyPress = (_str, key) => {
      if (key?.name === "up") {
        selectedIndex = (selectedIndex - 1 + SECTION_ITEMS.length) % SECTION_ITEMS.length;
        renderConfigScreen(rootEnv, webEnv, selectedIndex);
        return;
      }

      if (key?.name === "down") {
        selectedIndex = (selectedIndex + 1) % SECTION_ITEMS.length;
        renderConfigScreen(rootEnv, webEnv, selectedIndex);
        return;
      }

      if (key?.name === "return") {
        const item = SECTION_ITEMS[selectedIndex];
        cleanup();
        resolveSelection({ id: item.id, index: selectedIndex });
        return;
      }

      if (key?.ctrl && key?.name === "c") {
        cleanup();
        process.exit(130);
      }
    };

    stdin.on("keypress", onKeyPress);
    renderConfigScreen(rootEnv, webEnv, selectedIndex);
  });
}

async function configureSection(rl, section, rootEnv, webEnv) {
  if (section === "2") {
    const keys = [
      ["ANTHROPIC_API_KEY", rootEnvPath],
      ["ANTHROPIC_BASE_URL", rootEnvPath],
      ["OPENAI_API_KEY", rootEnvPath],
      ["OPENAI_BASE_URL", rootEnvPath],
    ];

    for (const [key, filePath] of keys) {
      const envObj = filePath === rootEnvPath ? rootEnv : webEnv;
      const current = envObj[key] ?? "";
      const prompt = `${askValueLabel(key)} [${current ? maskSecret(current) : "empty"}] (Enter to keep): `;
      const next = (await rl.question(prompt)).trim();
      if (next) {
        upsertEnvValue(filePath, key, next);
        envObj[key] = next;
      }
    }
    console.log("[app:config] Model section updated.");
    return;
  }

  if (section === "3") {
    const key = "VITE_GATEWAY_WS_URL";
    const current = webEnv[key] ?? "";
    const next = (
      await rl.question(`${askValueLabel(key)} [${valueOrDefault(current, "empty")}] (Enter to keep): `)
    ).trim();

    if (next) {
      upsertEnvValue(webEnvPath, key, next);
      webEnv[key] = next;
      console.log("[app:config] Web tools section updated.");
    } else {
      console.log("[app:config] No changes for Web tools.");
    }
    return;
  }

  if (section === "4") {
    const keys = ["OMNISTATE_PORT", "OMNISTATE_BIND"];
    for (const key of keys) {
      const current = rootEnv[key] ?? "";
      const next = (
        await rl.question(`${askValueLabel(key)} [${valueOrDefault(current, "empty")}] (Enter to keep): `)
      ).trim();

      if (next) {
        upsertEnvValue(rootEnvPath, key, next);
        rootEnv[key] = next;
      }
    }
    console.log("[app:config] Gateway section updated.");
    return;
  }

  if (["1", "5", "6", "7", "8"].includes(section)) {
    console.log("[app:config] This section is planned. No editable keys yet.");
    return;
  }

  console.log("[app:config] Invalid selection.");
}

async function runInteractiveConfig() {
  const rootEnv = parseEnvFile(rootEnvPath);
  const webEnv = parseEnvFile(webEnvPath);

  const rl = createInterface({ input: stdin, output: stdout });
  let menuIndex = 0;

  try {
    while (true) {
      const selection = await selectSectionWithArrows(rootEnv, webEnv, menuIndex);
      menuIndex = selection.index;
      const section = selection.id;

      if (section === "9") break;

      console.log("");
      await configureSection(rl, section, rootEnv, webEnv);
      await rl.question("Press Enter to return to menu...");
    }
  } finally {
    rl.close();
  }
}

const interactive = stdin.isTTY && stdout.isTTY;

if (interactive) {
  await runInteractiveConfig();
  console.log("[app:config] Done. Config dashboard completed.");
} else {
  console.log("[app:config] Done. Edit .env and packages/web/.env if needed.");
}
