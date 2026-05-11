/**
 * Git & Version Control Tools — Group 14
 * Implements: Git operations, branch management, commit, PR creation
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";


// ------------------------------------------------------------------
// Repository Status
// ------------------------------------------------------------------

export async function getGitStatus(repoPath?: string): Promise<{ branch: string; changes: number; staged: number; untracked: number }> {
  try {
    const cwd = repoPath || process.cwd();
    
    const { stdout: branch } = await execAsync("git branch --show-current", { cwd, encoding: "utf-8" });
    const { stdout: status } = await execAsync("git status --porcelain", { cwd, encoding: "utf-8" });
    
    const lines = status.trim().split("\n").filter(l => l.trim());
    const staged = lines.filter(l => l.startsWith(" ")).length;
    const untracked = lines.filter(l => l.startsWith("?")).length;
    
    return {
      branch: branch.trim(),
      changes: lines.length,
      staged,
      untracked
    };
  } catch {
    return { branch: "", changes: 0, staged: 0, untracked: 0 };
  }
}

export async function getCurrentBranch(repoPath?: string): Promise<string> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync("git branch --show-current", { cwd, encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Branch Operations
// ------------------------------------------------------------------

export async function createBranch(name: string, from?: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const base = from ? from : "HEAD";
    await execAsync(`git checkout -b ${name} ${base}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function switchBranch(name: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync(`git checkout ${name}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function deleteBranch(name: string, force?: boolean, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const flag = force ? "-D" : "-d";
    await execAsync(`git branch ${flag} ${name}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function listBranches(remote?: boolean, repoPath?: string): Promise<string[]> {
  try {
    const cwd = repoPath || process.cwd();
    const flag = remote ? "-r" : "";
    const { stdout } = await execAsync(`git branch ${flag} --format="%(refname:short)"`, { cwd, encoding: "utf-8" });
    return stdout.trim().split("\n").filter(b => b.trim());
  } catch {
    return [];
  }
}

export async function mergeBranch(branchName: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync(`git merge ${branchName}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Commit Operations
// ------------------------------------------------------------------

export async function stageFiles(files: string[], repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync(`git add ${files.join(" ")}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function stageAll(repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync("git add -A", { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function commit(message: string, author?: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const escapedMsg = message.replace(/"/g, '\\"');
    
    if (author) {
      await execAsync(`git -c user.name="${author}" commit -m "${escapedMsg}"`, { cwd });
    } else {
      await execAsync(`git commit -m "${escapedMsg}"`, { cwd });
    }
    return true;
  } catch {
    return false;
  }
}

export async function amendCommit(message?: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    if (message) {
      const escapedMsg = message.replace(/"/g, '\\"');
      await execAsync(`git commit --amend -m "${escapedMsg}"`, { cwd });
    } else {
      await execAsync("git commit --amend --no-edit", { cwd });
    }
    return true;
  } catch {
    return false;
  }
}

export async function undoLastCommit(keepChanges?: boolean, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const flag = keepChanges ? "--soft" : "--hard";
    await execAsync(`git reset ${flag} HEAD~1`, { cwd });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Remote Operations
// ------------------------------------------------------------------

export async function push(branch?: string, setUpstream?: boolean, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const upstream = setUpstream ? "-u" : "";
    const br = branch || "";
    await execAsync(`git push ${upstream} origin ${br}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function pull(rebase?: boolean, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const flag = rebase ? "--rebase" : "";
    await execAsync(`git pull ${flag}`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function fetch(repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync("git fetch --all", { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function clone(url: string, targetPath?: string): Promise<boolean> {
  try {
    const target = targetPath || path.join(os.homedir(), "Projects");
    await execAsync(`git clone ${url} ${target}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Git Log & History
// ------------------------------------------------------------------

export async function getCommitHistory(count: number = 10, repoPath?: string): Promise<{ hash: string; message: string; author: string; date: Date }[]> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync(`git log --oneline -${count} --format="%H|%s|%an|%ad" --date=iso`, { cwd, encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const [hash, message, author, date] = line.split("|");
      return { hash, message, author, date: new Date(date) };
    });
  } catch {
    return [];
  }
}

export async function getFileHistory(filePath: string, repoPath?: string): Promise<{ hash: string; message: string; date: Date }[]> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync(`git log --oneline --format="%H|%s|%ad" --date=iso "${filePath}"`, { cwd, encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const [hash, message, date] = line.split("|");
      return { hash, message, date: new Date(date) };
    });
  } catch {
    return [];
  }
}

export async function showDiff(file?: string, repoPath?: string): Promise<string> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync(`git diff ${file || ""}`, { cwd, encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export async function showStagedDiff(repoPath?: string): Promise<string> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync("git diff --cached", { cwd, encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Stash Operations
// ------------------------------------------------------------------

export async function stash(message?: string, repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    const msg = message ? ` stash with message: ${message}` : "";
    await execAsync(`git stash push -m "${message || "auto-stash"}"`, { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function stashPop(repoPath?: string): Promise<boolean> {
  try {
    const cwd = repoPath || process.cwd();
    await execAsync("git stash pop", { cwd });
    return true;
  } catch {
    return false;
  }
}

export async function listStashes(repoPath?: string): Promise<{ index: number; message: string; date: Date }[]> {
  try {
    const cwd = repoPath || process.cwd();
    const { stdout } = await execAsync("git stash list --format='%gd|%gs|%ai'", { cwd, encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map((line, i) => {
      const [index, message, date] = line.split("|");
      return { index: parseInt(index.replace("stash@{", "").replace("}", ""), 10), message, date: new Date(date) };
    });
  } catch {
    return [];
  }
}

export class GitLayer {
  getStatus = getGitStatus;
  getBranch = getCurrentBranch;
  createBranch = createBranch;
  switchBranch = switchBranch;
  deleteBranch = deleteBranch;
  listBranches = listBranches;
  merge = mergeBranch;
  stage = stageFiles;
  stageAll = stageAll;
  commit = commit;
  amend = amendCommit;
  undo = undoLastCommit;
  push = push;
  pull = pull;
  fetch = fetch;
  clone = clone;
  log = getCommitHistory;
  fileHistory = getFileHistory;
  diff = showDiff;
  stagedDiff = showStagedDiff;
  stash = stash;
  stashPop = stashPop;
  listStashes = listStashes;
}
