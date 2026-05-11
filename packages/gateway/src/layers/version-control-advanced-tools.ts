/**
 * Version Control Advanced Tools — Advanced Layer (API 64)
 * Implements: Monorepo management, merge strategies, cherry-pick, bisect, worktrees
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Monorepo Management
// ------------------------------------------------------------------

export interface MonorepoPackage {
  name: string;
  path: string;
  version: string;
  dependencies: string[];
}

export async function discoverMonorepoPackages(
  rootDir: string = "."
): Promise<{ packages: MonorepoPackage[]; workspaces: string[] }> {
  try {
    const { stdout: wsOut } = await execAsync(
      `cat package.json 2>/dev/null | grep -A10 '"workspaces"' | grep -E '"[^"]+/\\*"|"\\*"' || echo ''`,
      { encoding: "utf-8", cwd: rootDir }
    );
    
    const workspaces = wsOut.trim().split("\n").map(w => w.trim().replace(/[",]/g, ""));
    const packages: MonorepoPackage[] = [];
    
    for (const ws of workspaces) {
      try {
        const { stdout } = await execAsync(
          `find ${ws} -name package.json -not -path '*/node_modules/*' 2>/dev/null | head -20`,
          { encoding: "utf-8" }
        );
        
        for (const pkgJson of stdout.trim().split("\n").filter(p => p)) {
          try {
            const content = await fs.readFile(pkgJson, "utf-8");
            const pkg = JSON.parse(content);
            
            packages.push({
              name: pkg.name,
              path: path.dirname(pkgJson),
              version: pkg.version,
              dependencies: Object.keys(pkg.dependencies || {})
            });
          } catch {
            // Skip invalid package.json
          }
        }
      } catch {
        // Skip invalid workspace
      }
    }
    
    return { packages, workspaces };
  } catch {
    return { packages: [], workspaces: [] };
  }
}

export async function getPackageDependencyGraph(
  packages: MonorepoPackage[]
): Promise<{ edges: { from: string; to: string }[]; circular: string[][] }> {
  const edges: { from: string; to: string }[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const circular: string[][] = [];
  
  for (const pkg of packages) {
    for (const dep of pkg.dependencies) {
      const depPkg = packages.find(p => p.name === dep);
      if (depPkg) {
        edges.push({ from: pkg.name, to: depPkg.name });
      }
    }
  }
  
  // Detect circular dependencies (simplified)
  function dfs(pkgName: string, path: string[]): boolean {
    if (recursionStack.has(pkgName)) {
      circular.push([...path, pkgName]);
      return true;
    }
    if (visited.has(pkgName)) return false;
    
    visited.add(pkgName);
    recursionStack.add(pkgName);
    
    const children = edges.filter(e => e.from === pkgName).map(e => e.to);
    for (const child of children) {
      dfs(child, [...path, pkgName]);
    }
    
    recursionStack.delete(pkgName);
    return false;
  }
  
  for (const pkg of packages) {
    dfs(pkg.name, []);
  }
  
  return { edges, circular };
}

export async function runMonorepoTask(
  task: string,
  packages: string[] = []
): Promise<{ success: boolean; results: { pkg: string; output: string }[] }> {
  const results: { pkg: string; output: string }[] = [];
  
  if (packages.length === 0) {
    try {
      await execAsync(`npm run ${task} 2>/dev/null`, { encoding: "utf-8" });
      return { success: true, results };
    } catch {
      return { success: false, results };
    }
  }
  
  for (const pkg of packages) {
    try {
      const { stdout } = await execAsync(
        `npm run ${task} --workspace=${pkg} 2>/dev/null || echo ""`,
        { encoding: "utf-8" }
      );
      results.push({ pkg, output: stdout });
    } catch (e: any) {
      results.push({ pkg, output: e.message || "" });
    }
  }
  
  return { success: results.every(r => r.output.length === 0), results };
}

// ------------------------------------------------------------------
// Merge Strategies
// ------------------------------------------------------------------

export async function performMerge(
  branch: string,
  strategy?: "fast-forward" | "resolve" | "recursive" | "ort"
): Promise<{ success: boolean; conflicts: string[] }> {
  try {
    const stratFlag = strategy ? `-${strategy[0]}` : "";
    await execAsync(`git merge ${stratFlag} "${branch}" 2>&1`, { encoding: "utf-8" });
    
    const { stdout } = await execAsync(
      "git diff --name-only --diff-filter=U 2>/dev/null || echo ''",
      { encoding: "utf-8" }
    );
    
    const conflicts = stdout.trim().split("\n").filter(f => f);
    return { success: conflicts.length === 0, conflicts };
  } catch {
    return { success: false, conflicts: [] };
  }
}

export async function abortMerge(): Promise<boolean> {
  try {
    await execAsync("git merge --abort 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

export async function continueMerge(): Promise<boolean> {
  try {
    await execAsync("git commit --no-edit 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Cherry-Pick Operations
// ------------------------------------------------------------------

export async function cherryPickCommits(
  commits: string[],
  noCommit: boolean = false
): Promise<{ success: boolean; skipped: string[] }> {
  try {
    const noCommitFlag = noCommit ? "-n" : "";
    const result = await execAsync(
      `git cherry-pick ${noCommitFlag} ${commits.join(" ")} 2>&1`,
      { encoding: "utf-8" }
    );
    
    const skipped = result.stdout.match(/could not apply [^:]+/g)?.map(s => s.replace("could not apply ", "")) || [];
    
    return { success: skipped.length === 0, skipped };
  } catch {
    return { success: false, skipped: commits };
  }
}

export async function continueCherryPick(): Promise<boolean> {
  try {
    await execAsync("git cherry-pick --continue 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

export async function abortCherryPick(): Promise<boolean> {
  try {
    await execAsync("git cherry-pick --abort 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Git Bisect
// ------------------------------------------------------------------

export async function startBisect(
  goodCommit: string,
  badCommit: string = "HEAD"
): Promise<boolean> {
  try {
    await execAsync(`git bisect start "${badCommit}" "${goodCommit}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function markBisectGood(): Promise<boolean> {
  try {
    await execAsync("git bisect good 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

export async function markBisectBad(): Promise<boolean> {
  try {
    await execAsync("git bisect bad 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

export async function resetBisect(): Promise<boolean> {
  try {
    await execAsync("git bisect reset 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

export async function getBisectStatus(): Promise<{
  inProgress: boolean;
  current?: string;
  good?: string;
  bad?: string;
}> {
  try {
    const { stdout } = await execAsync(
      "git bisect log 2>/dev/null | head -20 || echo ''",
      { encoding: "utf-8" }
    );
    
    const lines = stdout.trim().split("\n");
    
    return {
      inProgress: lines.length > 0 && !lines.includes("first bad commit"),
      current: lines[lines.length - 1]?.match(/checking out/)?.[1],
      good: lines.find(l => l.includes("good"))?.split(" ")[1],
      bad: lines.find(l => l.includes("bad"))?.split(" ")[1]
    };
  } catch {
    return { inProgress: false };
  }
}

// ------------------------------------------------------------------
// Git Worktrees
// ------------------------------------------------------------------

export async function listWorktrees(): Promise<{
  worktrees: { path: string; branch: string; head: string }[];
}> {
  try {
    const { stdout } = await execAsync(
      "git worktree list --porcelain 2>/dev/null || echo ''",
      { encoding: "utf-8" }
    );
    
    const worktrees: { path: string; branch: string; head: string }[] = [];
    const entries = stdout.split("\n\n");
    
    for (const entry of entries) {
      const lines = entry.trim().split("\n");
      const worktree: Partial<{ path: string; branch: string; head: string }> = {};
      
      for (const line of lines) {
        if (line.startsWith("worktree ")) worktree.path = line.slice(9);
        if (line.startsWith("branch ")) worktree.branch = line.slice(7);
        if (line.startsWith("HEAD ")) worktree.head = line.slice(5);
      }
      
      if (worktree.path) {
        worktrees.push(worktree as { path: string; branch: string; head: string });
      }
    }
    
    return { worktrees };
  } catch {
    return { worktrees: [] };
  }
}

export async function createWorktree(
  path: string,
  branch: string,
  createBranch: boolean = false
): Promise<boolean> {
  try {
    const branchFlag = createBranch ? `-b "${branch}"` : `"${branch}"`;
    await execAsync(`git worktree add ${path} ${branchFlag} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function removeWorktree(path: string, force: boolean = false): Promise<boolean> {
  try {
    const forceFlag = force ? "--force" : "";
    await execAsync(`git worktree remove ${forceFlag} "${path}" 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Rebase Operations
// ------------------------------------------------------------------

export async function performRebase(
  branch: string,
  interactive: boolean = false
): Promise<{ success: boolean; conflicts: string[] }> {
  try {
    if (interactive) {
      await execAsync(`git rebase -i "${branch}" 2>&1`, { encoding: "utf-8" });
    } else {
      await execAsync(`git rebase "${branch}" 2>&1`, { encoding: "utf-8" });
    }
    
    const { stdout } = await execAsync(
      "git diff --name-only --diff-filter=U 2>/dev/null || echo ''",
      { encoding: "utf-8" }
    );
    
    const conflicts = stdout.trim().split("\n").filter(f => f);
    return { success: conflicts.length === 0, conflicts };
  } catch {
    return { success: false, conflicts: [] };
  }
}

export async function continueRebase(): Promise<boolean> {
  try {
    await execAsync("git rebase --continue 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

export async function abortRebase(): Promise<boolean> {
  try {
    await execAsync("git rebase --abort 2>/dev/null || echo 'done'");
    return true;
  } catch {
    return false;
  }
}

export async function skipRebaseCommit(): Promise<boolean> {
  try {
    await execAsync("git rebase --skip 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

export class VersionControlAdvancedLayer {
  discoverPackages = discoverMonorepoPackages;
  getDependencyGraph = getPackageDependencyGraph;
  runMonorepoTask = runMonorepoTask;
  
  merge = performMerge;
  abortMerge = abortMerge;
  continueMerge = continueMerge;
  
  cherryPick = cherryPickCommits;
  continueCherryPick = continueCherryPick;
  abortCherryPick = abortCherryPick;
  
  startBisect = startBisect;
  markGood = markBisectGood;
  markBad = markBisectBad;
  resetBisect = resetBisect;
  getBisectStatus = getBisectStatus;
  
  listWorktrees = listWorktrees;
  createWorktree = createWorktree;
  removeWorktree = removeWorktree;
  
  rebase = performRebase;
  continueRebase = continueRebase;
  abortRebase = abortRebase;
  skipCommit = skipRebaseCommit;
}
