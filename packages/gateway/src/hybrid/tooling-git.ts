/**
 * Hybrid Tooling Module — Git and File Operations (UC-D16, UC-D18).
 *
 * @module hybrid/tooling-git
 */

import { join, extname, basename } from "node:path";
import { homedir } from "node:os";
import {
  execAsync,
  ensureDir,
  writeJson,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  generateId,
  categorizeByExtension,
  FileClassification,
  DirectoryClassification,
  OrganizationRules,
  OrganizationResult,
  OrganizationPlan,
  MachineSnapshot,
  MachineDiff,
  EnvDiff,
} from "./tooling-types.js";

// Re-export for convenience
export { FILE_CATEGORY_MAP, categorizeByExtension } from "./tooling-types.js";

// ===========================================================================
// UC-D16: Auto File Labeling & Organization
// ===========================================================================

/**
 * UC-D16: Classify a single file using extension heuristics + optional Claude analysis.
 */
export async function classifyFile(filePath: string): Promise<FileClassification> {
  const category = categorizeByExtension(filePath);
  const tags: string[] = [category];

  // Suggest folder based on category
  const folderMap: Record<string, string> = {
    image: "~/Pictures",
    video: "~/Movies",
    audio: "~/Music",
    document: "~/Documents",
    code: "~/Developer",
    archive: "~/Downloads/Archives",
    spreadsheet: "~/Documents/Spreadsheets",
    data: "~/Documents/Data",
  };

  return {
    filePath,
    category,
    tags,
    confidence: 0.85,
    suggestedFolder: folderMap[category],
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D16: Classify all files in a directory.
 */
export async function classifyDirectory(
  dirPath: string
): Promise<DirectoryClassification> {
  let files: string[] = [];
  try {
    files = readdirSync(dirPath).filter((f) => {
      try {
        return statSync(join(dirPath, f)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    files = [];
  }

  const classifications = await Promise.all(
    files.map((f) => classifyFile(join(dirPath, f)))
  );

  const summary: Record<string, number> = {};
  for (const c of classifications) {
    summary[c.category] = (summary[c.category] ?? 0) + 1;
  }

  return {
    dirPath,
    files: classifications,
    summary,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * UC-D16: Organize a directory by moving files into categorized sub-folders.
 */
export async function organizeDirectory(
  dirPath: string,
  rules?: OrganizationRules
): Promise<OrganizationResult> {
  const classification = await classifyDirectory(dirPath);
  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const actions: string[] = [];

  for (const file of classification.files) {
    const targetFolder = rules
      ? (() => {
          const ext = extname(file.filePath).toLowerCase();
          const rule = rules.rules.find((r) => ext.match(r.pattern) || file.category === r.pattern);
          return rule?.targetFolder ?? null;
        })()
      : file.suggestedFolder;

    if (!targetFolder) {
      skipped++;
      continue;
    }

    try {
      const expandedTarget = targetFolder.replace(/^~/, homedir());
      if (!existsSync(expandedTarget)) mkdirSync(expandedTarget, { recursive: true });
      const filename = basename(file.filePath);
      const dest = join(expandedTarget, filename);
      if (!existsSync(dest)) {
        await execAsync(`mv "${file.filePath}" "${dest}"`);
        actions.push(`Moved: ${filename} → ${targetFolder}`);
        moved++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  return { dirPath, moved, skipped, failed, actions };
}

/**
 * UC-D16: Suggest an organization plan without executing moves.
 */
export async function suggestOrganization(
  dirPath: string
): Promise<OrganizationPlan> {
  const classification = await classifyDirectory(dirPath);
  const proposedMoves = classification.files
    .filter((f) => f.suggestedFolder)
    .map((f) => ({
      from: f.filePath,
      to: join(
        (f.suggestedFolder ?? "~/Downloads").replace(/^~/, homedir()),
        basename(f.filePath)
      ),
      reason: `File classified as ${f.category}`,
    }));

  return {
    dirPath,
    proposedMoves,
    estimatedFiles: classification.files.length,
  };
}

/**
 * UC-D16: Tag a file using macOS Finder extended attributes (xattr).
 */
export async function tagFile(
  filePath: string,
  tags: string[]
): Promise<boolean> {
  try {
    // Use macOS tag utility or xattr to apply Finder tags
    for (const tag of tags) {
      await execAsync(`tag -a "${tag}" "${filePath}" 2>/dev/null`).catch(
        async () => {
          // Fallback: use xattr directly with Finder tag format
          await execAsync(
            `xattr -w com.apple.metadata:_kMDItemUserTags '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array><string>${tag}</string></array></plist>' "${filePath}"`
          );
        }
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D16: Get macOS Finder tags for a file.
 */
export async function getFileTags(filePath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`tag -l "${filePath}" 2>/dev/null`);
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^[^\t]+\t/, "").trim());
  } catch {
    return [];
  }
}

// ===========================================================================
// UC-D18: Machine/Environment Diff
// ===========================================================================

/**
 * UC-D18: Take a snapshot of the current machine state.
 */
export async function snapshotMachine(): Promise<MachineSnapshot> {
  const [apps, brew, npm, hostname, osInfo, disk, mem] = await Promise.allSettled([
    execAsync("ls /Applications 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("brew list --formula 2>/dev/null").then((r) =>
      r.stdout.trim().split("\n").filter(Boolean)
    ),
    execAsync("npm list -g --depth=0 --json 2>/dev/null")
      .then((r) => Object.keys((JSON.parse(r.stdout) as { dependencies?: Record<string, unknown> }).dependencies ?? {}))
      .catch(() => [] as string[]),
    execAsync("hostname").then((r) => r.stdout.trim()),
    execAsync("sw_vers 2>/dev/null || uname -a").then((r) => r.stdout.trim().split("\n")[0] ?? ""),
    execAsync("df -h / 2>/dev/null").then((r) => r.stdout.trim().split("\n")[1] ?? ""),
    execAsync("sysctl hw.memsize 2>/dev/null || free -b 2>/dev/null").then((r) => {
      const match = r.stdout.match(/(\d+)/);
      return match ? Math.round(parseInt(match[1], 10) / 1024 / 1024 / 1024) : 0;
    }),
  ]);

  const envVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.includes("KEY") && !k.includes("SECRET") && !k.includes("TOKEN") && v) {
      envVars[k] = v;
    }
  }

  const id = generateId("snap");
  const snapshot: MachineSnapshot = {
    id,
    capturedAt: new Date().toISOString(),
    hostname: hostname.status === "fulfilled" ? hostname.value : "unknown",
    os: osInfo.status === "fulfilled" ? osInfo.value : "unknown",
    installedApps: apps.status === "fulfilled" ? apps.value : [],
    brewPackages: brew.status === "fulfilled" ? brew.value : [],
    npmGlobals: npm.status === "fulfilled" ? npm.value : [],
    envVars,
    diskUsage: disk.status === "fulfilled" ? disk.value : "unknown",
    memoryGB: mem.status === "fulfilled" ? mem.value : 0,
  };

  const dir = ensureDir("snapshots");
  writeJson(join(dir, `${id}.json`), snapshot);
  return snapshot;
}

/**
 * UC-D18: Diff two machine snapshots.
 */
export async function diffMachines(
  a: MachineSnapshot,
  b: MachineSnapshot
): Promise<MachineDiff> {
  const setA = new Set(a.installedApps);
  const setB = new Set(b.installedApps);
  const pkgA = new Set(a.brewPackages);
  const pkgB = new Set(b.brewPackages);

  const addedApps = [...setB].filter((x) => !setA.has(x));
  const removedApps = [...setA].filter((x) => !setB.has(x));
  const addedPackages = [...pkgB].filter((x) => !pkgA.has(x));
  const removedPackages = [...pkgA].filter((x) => !pkgB.has(x));

  const changedEnvVars = Object.keys(b.envVars).filter(
    (k) => a.envVars[k] !== b.envVars[k]
  );

  return {
    addedApps,
    removedApps,
    addedPackages,
    removedPackages,
    changedEnvVars,
    summary: `+${addedApps.length} apps, -${removedApps.length} apps, +${addedPackages.length} pkgs, -${removedPackages.length} pkgs`,
    diffedAt: new Date().toISOString(),
  };
}

/**
 * UC-D18: Diff two environment files (e.g. .env.staging vs .env.production).
 */
export async function diffEnvironments(
  envA: string,
  envB: string
): Promise<EnvDiff> {
  const parseEnvFile = (path: string): Record<string, string> => {
    try {
      return Object.fromEntries(
        readFileSync(path, "utf-8")
          .split("\n")
          .filter((l) => l && !l.startsWith("#") && l.includes("="))
          .map((l) => {
            const idx = l.indexOf("=");
            return [l.slice(0, idx), l.slice(idx + 1).replace(/^["']|["']$/g, "")];
          })
      );
    } catch {
      return {};
    }
  };

  const a = parseEnvFile(envA);
  const b = parseEnvFile(envB);

  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));

  return {
    envA,
    envB,
    onlyInA: [...keysA].filter((k) => !keysB.has(k)),
    onlyInB: [...keysB].filter((k) => !keysA.has(k)),
    changed: [...keysA]
      .filter((k) => keysB.has(k) && a[k] !== b[k])
      .map((k) => ({ key: k, valueA: a[k] ?? "", valueB: b[k] ?? "" })),
    diffedAt: new Date().toISOString(),
  };
}
