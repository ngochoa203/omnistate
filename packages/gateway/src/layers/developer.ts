/**
 * Developer Layer — terminal, git, editor, and Docker operations.
 *
 * Implements UC11: Developer & CLI Tools.
 *   UC11.1 Terminal / Shell        UC11.2 Git Integration
 *   UC11.3 Code Editor Integration UC11.4 Docker
 *
 * macOS-first; uses child_process, AppleScript, and shell commands.
 * Every method has try/catch with safe fallback returns.
 */

import {
  execSync,
  spawn,
  type SpawnOptions,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { DeepLayer } from "./deep.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UC11.1 — Terminal / Shell
// ---------------------------------------------------------------------------

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface AsyncCommandResult {
  pid: number;
  error?: string;
}

export interface ShellProcess {
  pid: number;
  name: string;
  command: string;
  user: string;
}

// ---------------------------------------------------------------------------
// UC11.2 — Git Integration
// ---------------------------------------------------------------------------

export interface GitStatusResult {
  branch: string;
  files: Array<{
    status: string;
    path: string;
  }>;
  clean: boolean;
  error?: string;
}

export interface GitLogEntry {
  hash: string;
  message: string;
}

export interface GitLogResult {
  entries: GitLogEntry[];
  error?: string;
}

export interface GitDiffResult {
  diff: string;
  staged: boolean;
  error?: string;
}

export interface GitBranchResult {
  branches: string[];
  current: string;
  error?: string;
}

export interface GitOperationResult {
  success: boolean;
  output: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// UC11.3 — Code Editor Integration
// ---------------------------------------------------------------------------

export interface RunningEditor {
  name: string;
  pid: number;
  command: string;
}

export interface SearchResult {
  file: string;
  line: number;
  match: string;
}

export interface SearchInProjectResult {
  results: SearchResult[];
  total: number;
  error?: string;
}

export interface ProjectStructureResult {
  tree: string;
  files: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// UC11.4 — Docker
// ---------------------------------------------------------------------------

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerRunOptions {
  name?: string;
  ports?: string[];
  env?: Record<string, string>;
  detach?: boolean;
}

export interface DockerResult {
  output: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class DeveloperLayer {
  constructor(private readonly _deep: DeepLayer) {}

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * Run a shell command synchronously; returns stdout/stderr/exitCode.
   * Never throws — errors are captured in the result object.
   */
  private runSync(
    command: string,
    cwd?: string,
    timeoutMs = 30_000
  ): CommandResult {
    try {
      const stdout = execSync(command, {
        cwd,
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout: stdout.toString().trim(), stderr: "", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        status?: number;
        message?: string;
      };
      return {
        stdout: e.stdout?.toString().trim() ?? "",
        stderr: e.stderr?.toString().trim() ?? "",
        exitCode: e.status ?? 1,
        error: e.message,
      };
    }
  }

  /** Run a shell command asynchronously; returns stdout on success or "" on failure. */
  private async runAsync(cmd: string, timeoutMs = 15_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /** Run an AppleScript snippet and return trimmed stdout. */
  private async osascript(script: string): Promise<string> {
    return this.runAsync(`osascript -e ${JSON.stringify(script)}`);
  }

  // =========================================================================
  // UC11.1 — Terminal / Shell
  // =========================================================================

  /**
   * Open or focus a terminal application via AppleScript.
   * Defaults to Terminal.app if no app is specified.
   */
  async openTerminal(
    app: "terminal" | "iterm" | "warp" = "terminal"
  ): Promise<void> {
    const appMap: Record<string, string> = {
      terminal: "Terminal",
      iterm: "iTerm2",
      warp: "Warp",
    };
    const appName = appMap[app] ?? "Terminal";
    try {
      await this.osascript(
        `tell application "${appName}" to activate`
      );
    } catch {
      // Fall back to `open -a`
      await this.runAsync(`open -a "${appName}" 2>/dev/null`);
    }
  }

  /**
   * Run a shell command synchronously.
   * Returns stdout, stderr, and exitCode.
   * Uses a default timeout of 30 seconds.
   */
  runCommand(command: string, cwd?: string): CommandResult {
    return this.runSync(command, cwd, 30_000);
  }

  /**
   * Spawn a shell command asynchronously and return its PID immediately.
   * The process runs detached so it outlives this call.
   */
  runCommandAsync(command: string, cwd?: string): AsyncCommandResult {
    try {
      const opts: SpawnOptions = {
        shell: true,
        detached: true,
        stdio: "ignore",
        ...(cwd ? { cwd } : {}),
      };
      const child = spawn(command, [], opts);
      child.unref();
      return { pid: child.pid ?? -1 };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { pid: -1, error: e.message };
    }
  }

  /**
   * List all running shell processes (zsh, bash, fish).
   * Parses `ps aux` output filtered for common shell names.
   */
  getRunningShells(): ShellProcess[] {
    try {
      const result = this.runSync(
        `ps aux | grep -E '\\b(zsh|bash|fish)\\b' | grep -v grep`
      );
      if (result.exitCode !== 0 || !result.stdout) return [];

      return result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          // ps aux columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
          const user = parts[0] ?? "";
          const pid = parseInt(parts[1] ?? "0", 10);
          const command = parts.slice(10).join(" ");
          const name = parts[10]?.split("/").pop() ?? command;
          return { pid, name, command, user };
        })
        .filter((p) => p.pid > 0);
    } catch {
      return [];
    }
  }

  /**
   * Read shell history for the given shell.
   * Returns the last `limit` entries (default 50).
   */
  getShellHistory(
    shell: "zsh" | "bash" = "zsh",
    limit = 50
  ): { entries: string[]; error?: string } {
    try {
      const historyFile =
        shell === "zsh"
          ? join(homedir(), ".zsh_history")
          : join(homedir(), ".bash_history");

      if (!existsSync(historyFile)) {
        return { entries: [], error: `History file not found: ${historyFile}` };
      }

      const raw = readFileSync(historyFile, "utf-8");
      const lines = raw.split("\n").filter(Boolean);

      // zsh extended history format: ": <timestamp>:<elapsed>;<command>"
      const entries = lines
        .map((line) => {
          const m = line.match(/^:\s*\d+:\d+;(.+)$/);
          return m ? m[1] : line;
        })
        .filter(Boolean)
        .slice(-limit);

      return { entries };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { entries: [], error: e.message };
    }
  }

  /**
   * Return the current process environment variables.
   */
  getEnvironment(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
  }

  // =========================================================================
  // UC11.2 — Git Integration
  // =========================================================================

  /**
   * Get the working-tree status for a git repository.
   * Returns the current branch and list of changed files.
   */
  gitStatus(cwd?: string): GitStatusResult {
    try {
      const porcelain = this.runSync("git status --porcelain", cwd);
      const branchResult = this.runSync("git branch --show-current", cwd);

      if (branchResult.exitCode !== 0) {
        return {
          branch: "",
          files: [],
          clean: true,
          error: branchResult.stderr || branchResult.error,
        };
      }

      const branch = branchResult.stdout;
      const files = porcelain.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          status: line.slice(0, 2).trim(),
          path: line.slice(3).trim(),
        }));

      return { branch, files, clean: files.length === 0 };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { branch: "", files: [], clean: true, error: e.message };
    }
  }

  /**
   * Get the git log for a repository.
   * Returns the last `limit` commits (default 20) in oneline format.
   */
  gitLog(cwd?: string, limit = 20): GitLogResult {
    try {
      const result = this.runSync(
        `git log --oneline -${limit}`,
        cwd
      );
      if (result.exitCode !== 0) {
        return { entries: [], error: result.stderr || result.error };
      }

      const entries = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const spaceIdx = line.indexOf(" ");
          return {
            hash: line.slice(0, spaceIdx),
            message: line.slice(spaceIdx + 1),
          };
        });

      return { entries };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { entries: [], error: e.message };
    }
  }

  /**
   * Get the git diff for a repository.
   * Pass `staged: true` to get the staged diff (`git diff --staged`).
   */
  gitDiff(cwd?: string, staged = false): GitDiffResult {
    try {
      const cmd = staged ? "git diff --staged" : "git diff";
      const result = this.runSync(cmd, cwd);

      if (result.exitCode !== 0) {
        return { diff: "", staged, error: result.stderr || result.error };
      }

      return { diff: result.stdout, staged };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { diff: "", staged, error: e.message };
    }
  }

  /**
   * List all local and remote branches.
   * Returns the current branch name separately.
   */
  gitBranches(cwd?: string): GitBranchResult {
    try {
      const result = this.runSync("git branch -a", cwd);
      const currentResult = this.runSync("git branch --show-current", cwd);

      if (result.exitCode !== 0) {
        return { branches: [], current: "", error: result.stderr || result.error };
      }

      const branches = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((b) => b.replace(/^\*\s*/, "").trim())
        .filter(Boolean);

      return { branches, current: currentResult.stdout };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { branches: [], current: "", error: e.message };
    }
  }

  /**
   * Stage all changes and create a commit with the given message.
   */
  gitCommit(message: string, cwd?: string): GitOperationResult {
    try {
      const addResult = this.runSync("git add -A", cwd);
      if (addResult.exitCode !== 0) {
        return {
          success: false,
          output: addResult.stderr,
          error: addResult.error ?? addResult.stderr,
        };
      }

      // Escape the message for safe shell injection
      const safeMessage = message.replace(/'/g, "'\\''");
      const commitResult = this.runSync(
        `git commit -m '${safeMessage}'`,
        cwd
      );

      return {
        success: commitResult.exitCode === 0,
        output: commitResult.stdout || commitResult.stderr,
        error: commitResult.exitCode !== 0
          ? (commitResult.error ?? commitResult.stderr)
          : undefined,
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, output: "", error: e.message };
    }
  }

  /**
   * Push commits to a remote repository.
   * Defaults to `origin` and the current branch.
   */
  gitPush(
    cwd?: string,
    remote = "origin",
    branch?: string
  ): GitOperationResult {
    try {
      const branchPart = branch ? ` ${branch}` : "";
      const result = this.runSync(`git push ${remote}${branchPart}`, cwd);

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
        error: result.exitCode !== 0
          ? (result.error ?? result.stderr)
          : undefined,
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, output: "", error: e.message };
    }
  }

  /**
   * Pull latest changes from a remote repository.
   * Defaults to `origin` and the current branch.
   */
  gitPull(
    cwd?: string,
    remote = "origin",
    branch?: string
  ): GitOperationResult {
    try {
      const branchPart = branch ? ` ${branch}` : "";
      const result = this.runSync(`git pull ${remote}${branchPart}`, cwd);

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
        error: result.exitCode !== 0
          ? (result.error ?? result.stderr)
          : undefined,
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, output: "", error: e.message };
    }
  }

  /**
   * Clone a git repository from `url` into an optional destination path.
   */
  gitClone(url: string, dest?: string): GitOperationResult {
    try {
      const destPart = dest ? ` ${JSON.stringify(dest)}` : "";
      const result = this.runSync(
        `git clone ${JSON.stringify(url)}${destPart}`,
        undefined,
        60_000
      );

      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
        error: result.exitCode !== 0
          ? (result.error ?? result.stderr)
          : undefined,
      };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, output: "", error: e.message };
    }
  }

  // =========================================================================
  // UC11.3 — Code Editor Integration
  // =========================================================================

  /**
   * Open a file in the specified editor.
   * Defaults to VS Code (`code`). For `vim`, opens a new Terminal window.
   */
  async openInEditor(
    filePath: string,
    editor: "vscode" | "cursor" | "sublime" | "vim" = "vscode"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const cliMap: Record<string, string> = {
        vscode: "code",
        cursor: "cursor",
        sublime: "subl",
      };

      if (editor === "vim") {
        // Open vim in a new Terminal window via AppleScript
        const script = `tell application "Terminal"
          activate
          do script "vim ${filePath.replace(/"/g, '\\"')}"
        end tell`;
        await this.osascript(script);
      } else {
        const cli = cliMap[editor] ?? "code";
        const result = this.runSync(
          `${cli} ${JSON.stringify(filePath)} 2>/dev/null`
        );
        if (result.exitCode !== 0) {
          return { success: false, error: result.stderr || result.error };
        }
      }

      return { success: true };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, error: e.message };
    }
  }

  /**
   * Open a project folder in VS Code or Cursor.
   */
  async openProject(
    projectPath: string,
    editor: "vscode" | "cursor" = "vscode"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const cli = editor === "cursor" ? "cursor" : "code";
      const result = this.runSync(
        `${cli} ${JSON.stringify(projectPath)} 2>/dev/null`
      );

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || result.error };
      }

      return { success: true };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { success: false, error: e.message };
    }
  }

  /**
   * Detect which code editors are currently running.
   * Checks for VS Code, Cursor, Sublime Text, Vim, and Neovim.
   */
  getOpenEditors(): RunningEditor[] {
    try {
      const editorPatterns: Array<{ pattern: string; name: string }> = [
        { pattern: "Electron.*Code Helper", name: "VS Code" },
        { pattern: "Cursor", name: "Cursor" },
        { pattern: "Sublime Text", name: "Sublime Text" },
        { pattern: "\\bvim\\b", name: "Vim" },
        { pattern: "\\bnvim\\b", name: "Neovim" },
      ];

      const result = this.runSync("ps aux");
      if (!result.stdout) return [];

      const editors: RunningEditor[] = [];
      const seen = new Set<string>();

      for (const { pattern, name } of editorPatterns) {
        const regex = new RegExp(pattern);
        const lines = result.stdout.split("\n").filter((l) => regex.test(l));
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[1] ?? "0", 10);
          const command = parts.slice(10).join(" ");
          const key = `${name}:${pid}`;
          if (pid > 0 && !seen.has(key)) {
            seen.add(key);
            editors.push({ name, pid, command });
          }
        }
      }

      return editors;
    } catch {
      return [];
    }
  }

  /**
   * Search for a string pattern in a project directory.
   * Uses `rg` (ripgrep) if available, otherwise falls back to `grep -rn`.
   * Optional `filePattern` restricts the search (e.g. `"*.ts"`).
   */
  searchInProject(
    query: string,
    cwd: string,
    filePattern?: string
  ): SearchInProjectResult {
    try {
      // Check for ripgrep
      const hasRg = this.runSync("which rg 2>/dev/null").exitCode === 0;
      let cmd: string;

      if (hasRg) {
        const globPart = filePattern ? ` --glob ${JSON.stringify(filePattern)}` : "";
        cmd = `rg -n ${JSON.stringify(query)}${globPart} .`;
      } else {
        const includePart = filePattern
          ? ` --include=${JSON.stringify(filePattern)}`
          : "";
        cmd = `grep -rn ${JSON.stringify(query)}${includePart} .`;
      }

      const result = this.runSync(cmd, cwd, 30_000);

      // grep/rg exit code 1 means no matches (not an error)
      if (result.exitCode > 1) {
        return { results: [], total: 0, error: result.stderr || result.error };
      }

      const results: SearchResult[] = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // format: "file:lineNumber:match" or "file:lineNumber:match" (rg)
          const colonIdx = line.indexOf(":");
          const secondColon = line.indexOf(":", colonIdx + 1);
          if (colonIdx === -1 || secondColon === -1) {
            return { file: line, line: 0, match: "" };
          }
          return {
            file: line.slice(0, colonIdx),
            line: parseInt(line.slice(colonIdx + 1, secondColon), 10) || 0,
            match: line.slice(secondColon + 1),
          };
        });

      return { results, total: results.length };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { results: [], total: 0, error: e.message };
    }
  }

  /**
   * List the file/directory structure of a project.
   * Uses `tree` if available, otherwise falls back to `find`.
   * `depth` controls how many levels deep to traverse (default 3).
   */
  getProjectStructure(
    cwd: string,
    depth = 3
  ): ProjectStructureResult {
    try {
      const hasTree = this.runSync("which tree 2>/dev/null").exitCode === 0;

      let treeOutput = "";
      let files: string[] = [];

      if (hasTree) {
        const result = this.runSync(
          `tree -L ${depth} --noreport -a -I '.git|node_modules|.DS_Store'`,
          cwd
        );
        treeOutput = result.stdout;

        // Also collect plain file paths
        const filesResult = this.runSync(
          `find . -maxdepth ${depth} -not -path '*/.git/*' -not -path '*/node_modules/*' -type f`,
          cwd
        );
        files = filesResult.stdout.split("\n").filter(Boolean);
      } else {
        // find fallback
        const result = this.runSync(
          `find . -maxdepth ${depth} -not -path '*/.git/*' -not -path '*/node_modules/*'`,
          cwd
        );
        treeOutput = result.stdout;
        files = result.stdout.split("\n").filter((f) => !f.endsWith("/"));
      }

      return { tree: treeOutput, files };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { tree: "", files: [], error: e.message };
    }
  }

  // =========================================================================
  // UC11.4 — Docker
  // =========================================================================

  /**
   * List all running Docker containers.
   * Returns an array of container records.
   */
  dockerPs(): { containers: DockerContainer[]; error?: string } {
    try {
      const result = this.runSync(
        `docker ps --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.CreatedAt}}"`,
        undefined,
        30_000
      );

      if (result.exitCode !== 0) {
        return {
          containers: [],
          error: result.stderr || result.error,
        };
      }

      const containers: DockerContainer[] = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, name, image, status, ports, created] = line.split("\t");
          return {
            id: id ?? "",
            name: name ?? "",
            image: image ?? "",
            status: status ?? "",
            ports: ports ?? "",
            created: created ?? "",
          };
        });

      return { containers };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { containers: [], error: e.message };
    }
  }

  /**
   * List all locally available Docker images.
   */
  dockerImages(): { images: DockerImage[]; error?: string } {
    try {
      const result = this.runSync(
        `docker images --format "{{.ID}}\\t{{.Repository}}\\t{{.Tag}}\\t{{.Size}}\\t{{.CreatedAt}}"`,
        undefined,
        30_000
      );

      if (result.exitCode !== 0) {
        return { images: [], error: result.stderr || result.error };
      }

      const images: DockerImage[] = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, repository, tag, size, created] = line.split("\t");
          return {
            id: id ?? "",
            repository: repository ?? "",
            tag: tag ?? "",
            size: size ?? "",
            created: created ?? "",
          };
        });

      return { images };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { images: [], error: e.message };
    }
  }

  /**
   * Run a Docker container from an image.
   * Supports optional name, port mappings, environment variables, and detach mode.
   */
  dockerRun(image: string, options: DockerRunOptions = {}): DockerResult {
    try {
      const parts: string[] = ["docker run"];

      if (options.detach !== false) {
        parts.push("-d");
      }

      if (options.name) {
        parts.push(`--name ${JSON.stringify(options.name)}`);
      }

      if (options.ports) {
        for (const port of options.ports) {
          parts.push(`-p ${port}`);
        }
      }

      if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
          parts.push(`-e ${JSON.stringify(`${key}=${value}`)}`);
        }
      }

      parts.push(JSON.stringify(image));

      const cmd = parts.join(" ");
      const result = this.runSync(cmd, undefined, 60_000);

      if (result.exitCode !== 0) {
        return { output: result.stderr, error: result.error ?? result.stderr };
      }

      return { output: result.stdout };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { output: "", error: e.message };
    }
  }

  /**
   * Stop a running Docker container by ID or name.
   */
  dockerStop(containerId: string): DockerResult {
    try {
      const result = this.runSync(
        `docker stop ${JSON.stringify(containerId)}`,
        undefined,
        30_000
      );

      if (result.exitCode !== 0) {
        return { output: result.stderr, error: result.error ?? result.stderr };
      }

      return { output: result.stdout };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { output: "", error: e.message };
    }
  }

  /**
   * Retrieve logs from a Docker container.
   * `tail` limits the number of lines returned (default 100).
   */
  dockerLogs(containerId: string, tail = 100): DockerResult {
    try {
      const result = this.runSync(
        `docker logs --tail ${tail} ${JSON.stringify(containerId)}`,
        undefined,
        30_000
      );

      // docker logs writes to stderr even for normal output
      const output = result.stdout || result.stderr;

      if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
        return { output: "", error: result.error };
      }

      return { output };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { output: "", error: e.message };
    }
  }

  /**
   * Run a Docker Compose command (`up`, `down`, `restart`, or `logs`).
   * Optionally pass a working directory containing the `docker-compose.yml`.
   */
  dockerCompose(
    action: "up" | "down" | "restart" | "logs",
    cwd?: string
  ): DockerResult {
    try {
      const actionFlags: Record<string, string> = {
        up: "up -d",
        down: "down",
        restart: "restart",
        logs: "logs --tail=100",
      };

      const flags = actionFlags[action] ?? action;
      const result = this.runSync(
        `docker compose ${flags}`,
        cwd,
        60_000
      );

      const output = result.stdout || result.stderr;

      if (result.exitCode !== 0) {
        return {
          output,
          error: result.error ?? result.stderr,
        };
      }

      return { output };
    } catch (err: unknown) {
      const e = err as { message?: string };
      return { output: "", error: e.message };
    }
  }
}

export default DeveloperLayer;
