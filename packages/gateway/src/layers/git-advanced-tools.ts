/**
 * Git Advanced Tools — Bisect, worktrees, submodules, patches.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const git = (cmd: string, cwd?: string) => execAsync(`git ${cmd}`, { cwd, encoding: "utf-8" });

export async function bisectStart(): Promise<boolean> { try { await git("bisect start"); return true; } catch { return false; } }
export async function bisectGood(revision = "HEAD"): Promise<boolean> { try { await git(`bisect good ${revision}`); return true; } catch { return false; } }
export async function bisectBad(revision = "HEAD"): Promise<boolean> { try { await git(`bisect bad ${revision}`); return true; } catch { return false; } }
export async function bisectReset(): Promise<boolean> { try { await git("bisect reset"); return true; } catch { return false; } }
export async function bisectSkip(revision?: string): Promise<boolean> { try { await git(`bisect skip ${revision || ""}`); return true; } catch { return false; } }
export async function bisectLog(): Promise<string> { try { const { stdout } = await git("bisect log"); return stdout; } catch { return ""; } }

export async function listWorktrees(): Promise<{ path: string; branch: string }[]> {
  try {
    const { stdout } = await git("worktree list --porcelain");
    const trees: { path: string; branch: string }[] = [];
    const parts = stdout.split("\n\n").filter(Boolean);
    for (const part of parts) {
      const lines = part.split("\n");
      const path = lines.find(l => l.startsWith("worktree "))?.replace("worktree ", "") || "";
      const branch = lines.find(l => l.startsWith("branch "))?.replace("branch ", "") || "";
      trees.push({ path, branch });
    }
    return trees;
  } catch { return []; }
}

export async function createWorktree(path: string, branch: string, createBranch = false): Promise<boolean> {
  try {
    const cmd = createBranch ? `worktree add -b ${branch} "${path}"` : `worktree add "${path}" ${branch}`;
    await git(cmd);
    return true;
  } catch { return false; }
}

export async function removeWorktree(path: string, force = false): Promise<boolean> { try { await git(`worktree remove "${path}" ${force ? "--force" : ""}`); return true; } catch { return false; } }
export async function pruneWorktrees(): Promise<boolean> { try { await git("worktree prune"); return true; } catch { return false; } }

export async function listSubmodules(): Promise<{ path: string; branch: string }[]> {
  try {
    const { stdout } = await git("submodule status");
    return stdout.split("\n").filter(Boolean).map(line => {
      const [hash, path, tag] = line.split(" ");
      return { path, branch: tag || "HEAD" };
    });
  } catch { return []; }
}

export async function addSubmodule(url: string, path: string, branch?: string): Promise<boolean> { try { await git(`submodule add ${branch ? `-b ${branch}` : ""} ${url} "${path}"`); return true; } catch { return false; } }
export async function updateSubmodules(init = true, recursive = false): Promise<boolean> { try { await git(`submodule update --init ${recursive ? "--recursive" : ""}`); return true; } catch { return false; } }
export async function syncSubmodules(): Promise<boolean> { try { await git("submodule sync --recursive"); return true; } catch { return false; } }

export async function stashWithMessage(message: string): Promise<boolean> { try { await git(`stash push -m "${message}"`); return true; } catch { return false; } }
export async function stashPop(includeUntracked = true): Promise<boolean> { try { await git(`stash pop ${includeUntracked ? "-u" : ""}`); return true; } catch { return false; } }
export async function listStashes(): Promise<{ index: number; message: string }[]> {
  try {
    const { stdout } = await git("stash list --format=%gd::%s");
    return stdout.split("\n").filter(Boolean).map(line => {
      const [ref, msg] = line.split("::");
      const idx = parseInt(ref?.replace("stash@{", "").replace("}", "") || "0", 10);
      return { index: idx, message: msg || "" };
    });
  } catch { return []; }
}

export async function blameFile(filePath: string): Promise<{ author: string; line: number; commit: string }[]> {
  try {
    const { stdout } = await git(`blame --line-porcelain "${filePath}"`);
    const lines: { author: string; line: number; commit: string }[] = [];
    const parts = stdout.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]?.startsWith("author ")) {
        const author = parts[i].replace("author ", "");
        const lineNum = parts[i + 1]?.match(/^(\d+)/)?.[1] || "0";
        const commit = parts[i + 2]?.replace("summary ", "") || "";
        lines.push({ author, line: parseInt(lineNum, 10), commit });
      }
    }
    return lines;
  } catch { return []; }
}

export async function createPatch(from: string, to: string, outputPath: string): Promise<boolean> { try { await git(`format-patch ${from}..${to} -o "${outputPath}"`); return true; } catch { return false; } }
export async function applyPatch(patchPath: string): Promise<boolean> { try { await git(`am "${patchPath}"`); return true; } catch { return false; } }
export async function reflogShow(limit = 20): Promise<{ ref: string; action: string }[]> {
  try {
    const { stdout } = await git(`reflog -n ${limit} --format=%gd::%gs`);
    return stdout.split("\n").filter(Boolean).map(line => {
      const [ref, action] = line.split("::");
      return { ref: ref || "", action: action || "" };
    });
  } catch { return []; }
}

export class GitAdvancedLayer {
  bisectStart = bisectStart; bisectGood = bisectGood; bisectBad = bisectBad; bisectReset = bisectReset; bisectSkip = bisectSkip; bisectLog = bisectLog;
  listWorktrees = listWorktrees; createWorktree = createWorktree; removeWorktree = removeWorktree; pruneWorktrees = pruneWorktrees;
  listSubmodules = listSubmodules; addSubmodule = addSubmodule; updateSubmodules = updateSubmodules; syncSubmodules = syncSubmodules;
  stashWithMessage = stashWithMessage; stashPop = stashPop; listStashes = listStashes;
  blameFile = blameFile; createPatch = createPatch; applyPatch = applyPatch; reflogShow = reflogShow;
}
