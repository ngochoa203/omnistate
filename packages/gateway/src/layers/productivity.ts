/**
 * Productivity Layer — GitHub, Slack, Linear, Notion integration.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// GitHub (CLI)
// ------------------------------------------------------------------

/**
 * Check if gh CLI is installed and authenticated.
 */
export async function isGitHubAuthenticated(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("gh auth status 2>&1", { encoding: "utf-8" });
    return stdout.includes("Logged in");
  } catch {
    return false;
  }
}

/**
 * Create a GitHub issue.
 */
export async function createGitHubIssue(
  repo: string,
  title: string,
  options: {
    body?: string;
    labels?: string[];
    assignees?: string[];
  } = {}
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    let cmd = `gh issue create -R "${repo}" -t "${title.replace(/"/g, '\\"')}"`;

    if (options.body) {
      const bodyFile = "/tmp/gh_issue_body.md";
      writeFileSync(bodyFile, options.body);
      cmd += ` -F "${bodyFile}"`;
    }

    if (options.labels && options.labels.length > 0) {
      cmd += ` -l "${options.labels.join('" -l "')}"`;
    }

    if (options.assignees && options.assignees.length > 0) {
      cmd += ` -a "${options.assignees.join('" -a "')}"`;
    }

    const { stdout } = await execAsync(cmd, { encoding: "utf-8", timeout: 30000 });
    return { success: true, url: stdout.trim() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Search GitHub issues/PRs.
 */
export async function searchGitHub(
  query: string,
  type: "issue" | "pr" | "all" = "issue"
): Promise<Array<{ number: number; title: string; state: string; url: string }>> {
  try {
    const typeFlag = type === "all" ? "" : `type:${type}`;
    const { stdout } = await execAsync(
      `gh search issues "${query} ${typeFlag}" --limit 20 --json number,title,state,url`,
      { encoding: "utf-8", timeout: 30000 }
    );

    return JSON.parse(stdout.trim());
  } catch {
    return [];
  }
}

/**
 * Get current Git branch.
 */
export async function getCurrentBranch(): Promise<string> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Create a git commit.
 */
export async function gitCommit(
  message: string,
  files?: string[]
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    if (files && files.length > 0) {
      await execAsync(`git add ${files.map((f) => `"${f}"`).join(" ")}`);
    } else {
      await execAsync(`git add -A`);
    }

    const { stdout } = await execAsync(
      `git commit -m "${message.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8" }
    );

    return { success: true, output: stdout.trim() };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------
// Slack
// ------------------------------------------------------------------

/**
 * Send Slack message via webhook or API.
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: string,
  options: {
    channel?: string;
    username?: string;
    iconEmoji?: string;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, unknown> = { text: message };
    if (options.channel) payload.channel = options.channel;
    if (options.username) payload.username = options.username;
    if (options.iconEmoji) payload.icon_emoji = options.iconEmoji;

    const payloadStr = JSON.stringify(payload);

    await execAsync(
      `curl -s -X POST -H "Content-Type: application/json" -d '${payloadStr}' "${webhookUrl}"`,
      { timeout: 10000 }
    );

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Search Slack messages.
 */
export async function searchSlackMessages(
  query: string,
  _limit: number = 20
): Promise<Array<{ user: string; text: string; timestamp: string }>> {
  // Requires Slack token - placeholder for now
  console.log(`Searching Slack for: ${query}`);
  return [];
}

// ------------------------------------------------------------------
// Terminal/Shell
// ------------------------------------------------------------------

/**
 * Execute a shell command and return output.
 */
export async function executeShell(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { cwd, timeout = 30000, env } = options;
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      encoding: "utf-8",
      env: { ...process.env, ...env }
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err) {
      return {
        stdout: "",
        stderr: (err as unknown as Record<string, unknown>).stderr as string || err.message,
        exitCode: (err as unknown as Record<string, unknown>).code as number || 1
      };
    }
    return { stdout: "", stderr: String(err), exitCode: 1 };
  }
}

/**
 * Run a long-running command in background.
 */
export async function runInBackground(
  command: string,
  options: {
    cwd?: string;
    logFile?: string;
  } = {}
): Promise<{ pid: number; logFile: string }> {
  const logFile = options.logFile || `/tmp/background_${Date.now()}.log`;
  const cwd = options.cwd || process.cwd();

  await execAsync(
    `nohup ${command} > "${logFile}" 2>&1 & echo $!`,
    { cwd, encoding: "utf-8" }
  );

  const { stdout } = await execAsync(
    `tail -1 "${logFile}" | grep -E "^\\d+$" || echo "0"`,
    { encoding: "utf-8" }
  );

  return { pid: parseInt(stdout.trim(), 10) || 0, logFile };
}

// ------------------------------------------------------------------
// URL Utilities
// ------------------------------------------------------------------

/**
 * Extract metadata from URL (title, description, image).
 */
export async function extractUrlMetadata(
  url: string
): Promise<{ title?: string; description?: string; image?: string; error?: string }> {
  try {
    // Use mdls or curl to get metadata
    const { stdout } = await execAsync(
      `curl -sL "${url}" | grep -E "<title>|<meta name=\"description\"|og:image" | head -5`,
      { encoding: "utf-8", timeout: 10000 }
    );

    const titleMatch = stdout.match(/<title>([^<]+)<\/title>/i);
    const descMatch = stdout.match(/name="description" content="([^"]+)"/i);
    const imageMatch = stdout.match(/og:image" content="([^"]+)"/i);

    return {
      title: titleMatch?.[1]?.trim(),
      description: descMatch?.[1]?.trim(),
      image: imageMatch?.[1]?.trim()
    };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Shorten URL using is.gd or similar.
 */
export async function shortenUrl(longUrl: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `curl -s "https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    return stdout.trim();
  } catch {
    return longUrl;
  }
}