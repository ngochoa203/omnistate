/**
 * Collaboration Tools — Advanced Layer (API 65)
 * Implements: GitHub PR, code review, Slack integration, team metrics
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// GitHub Pull Requests
// ------------------------------------------------------------------

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
  author: string;
  base: string;
  head: string;
  labels: string[];
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
}

export async function createPullRequest(options: {
  title: string;
  body?: string;
  base?: string;
  head?: string;
  labels?: string[];
  maintainerCanModify?: boolean;
}): Promise<{ success: boolean; url?: string; number?: number }> {
  try {
    const args: string[] = [
      options.title,
      `--base ${options.base || "main"}`,
      `--head ${options.head || ""}`,
      options.maintainerCanModify ? "--maintainer-can-modify" : ""
    ].filter(Boolean) as string[];

    const bodyFile = "/tmp/pr_body.md";
    if (options.body) {
      await fs.writeFile(bodyFile, options.body);
      args.push(`--body-file "${bodyFile}"`);
    }

    const { stdout } = await execAsync(
      `gh pr create ${args.join(" ")} 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    
    const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
    
    return {
      success: !!urlMatch,
      url: urlMatch?.[0],
      number: parseInt(stdout.match(/#(\d+)/)?.[1] || "0", 10)
    };
  } catch {
    return { success: false };
  }
}

export async function listPullRequests(
  state: "open" | "closed" | "merged" | "all" = "open",
  limit: number = 30
): Promise<{ pullRequests: PullRequest[] }> {
  try {
    const { stdout } = await execAsync(
      `gh pr list --state ${state} --limit ${limit} --json number,title,body,state,author,base,head,labels,reviewers,createdAt,updatedAt 2>/dev/null || echo "[]"`,
      { encoding: "utf-8" }
    );
    
    const prs = JSON.parse(stdout || "[]");
    return { pullRequests: prs };
  } catch {
    return { pullRequests: [] };
  }
}

export async function getPullRequest(
  numberOrUrl: string | number
): Promise<PullRequest | null> {
  try {
    const num = typeof numberOrUrl === "string"
      ? parseInt(numberOrUrl.match(/\/pull\/(\d+)/)?.[1] || "0", 10)
      : numberOrUrl;
    
    const { stdout } = await execAsync(
      `gh pr view ${num} --json number,title,body,state,author,base,head,labels,reviewers,createdAt,updatedAt 2>/dev/null || echo '{}'`,
      { encoding: "utf-8" }
    );
    
    return JSON.parse(stdout || "{}");
  } catch {
    return null;
  }
}

export async function mergePullRequest(
  number: number,
  method: "merge" | "squash" | "rebase" = "squash",
  deleteBranch: boolean = true
): Promise<{ success: boolean; merged: boolean }> {
  try {
    const methodFlag = `--${method}`;
    const deleteFlag = deleteBranch ? "--delete-branch" : "";
    
    await execAsync(
      `gh pr merge ${number} ${methodFlag} ${deleteFlag} 2>/dev/null`,
      { encoding: "utf-8" }
    );
    
    return { success: true, merged: true };
  } catch {
    return { success: false, merged: false };
  }
}

export async function closePullRequest(
  number: number,
  message?: string
): Promise<boolean> {
  try {
    const msgFlag = message ? `--comment "${message}"` : "";
    await execAsync(`gh pr close ${number} ${msgFlag} 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Code Review
// ------------------------------------------------------------------

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  createdAt: string;
  author: string;
}

export async function addReviewComment(
  prNumber: number,
  body: string,
  commitId?: string,
  path?: string,
  line?: number
): Promise<{ success: boolean; commentId?: string }> {
  try {
    const args = [
      `--body "${body.replace(/"/g, '\\"')}"`,
      commitId ? `--commit ${commitId}` : "",
      path ? `--path "${path}"` : "",
      line ? `--line ${line}` : ""
    ].filter(Boolean).join(" ");
    
    const { stdout } = await execAsync(
      `gh pr review ${prNumber} --comment ${args} 2>&1 || echo ""`,
      { encoding: "utf-8" }
    );
    
    const idMatch = stdout.match(/comment ID: (\w+)/);
    
    return { success: true, commentId: idMatch?.[1] };
  } catch {
    return { success: false };
  }
}

export async function approvePullRequest(
  prNumber: number,
  body?: string
): Promise<boolean> {
  try {
    const bodyFlag = body ? `--body "${body}"` : "";
    await execAsync(
      `gh pr review ${prNumber} --approve ${bodyFlag} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

export async function requestReviewers(
  prNumber: number,
  reviewers: string[]
): Promise<boolean> {
  try {
    await execAsync(
      `gh pr edit ${prNumber} --add-reviewer ${reviewers.join(",")} 2>/dev/null || echo "done"`
    );
    return true;
  } catch {
    return false;
  }
}

export async function getReviewComments(
  prNumber: number
): Promise<{ comments: ReviewComment[] }> {
  try {
    const { stdout } = await execAsync(
      `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments 2>/dev/null || echo "[]"`,
      { encoding: "utf-8" }
    );
    
    const comments = JSON.parse(stdout || "[]").map((c: any) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      createdAt: c.created_at,
      author: c.user?.login
    }));
    
    return { comments };
  } catch {
    return { comments: [] };
  }
}

// ------------------------------------------------------------------
// GitHub Issues
// ------------------------------------------------------------------

export async function createIssue(options: {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}): Promise<{ success: boolean; url?: string; number?: number }> {
  try {
    const args = [
      `"${options.title}"`,
      options.body ? `--body "${options.body}"` : "",
      options.labels?.length ? `--label "${options.labels.join(",")}"` : "",
      options.assignees?.length ? `--assignee "${options.assignees.join(",")}"` : ""
    ].filter(Boolean).join(" ");
    
    const { stdout } = await execAsync(
      `gh issue create ${args} 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    
    const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+/);
    const numMatch = stdout.match(/#(\d+)/);
    
    return {
      success: !!urlMatch,
      url: urlMatch?.[0],
      number: parseInt(numMatch?.[1] || "0", 10)
    };
  } catch {
    return { success: false };
  }
}

export async function listIssues(
  state: "open" | "closed" | "all" = "open",
  labels?: string[],
  limit: number = 30
): Promise<{ issues: { number: number; title: string; state: string; labels: string[] }[] }> {
  try {
    const labelFlag = labels?.length ? `--label "${labels.join(",")}"` : "";
    const { stdout } = await execAsync(
      `gh issue list --state ${state} ${labelFlag} --limit ${limit} --json number,title,state,labels 2>/dev/null || echo "[]"`,
      { encoding: "utf-8" }
    );
    
    return { issues: JSON.parse(stdout || "[]") };
  } catch {
    return { issues: [] };
  }
}

// ------------------------------------------------------------------
// Slack Integration
// ------------------------------------------------------------------

export async function sendSlackMessage(
  webhookUrl: string,
  message: string,
  channel?: string,
  username?: string
): Promise<boolean> {
  try {
    const payload = {
      text: message,
      ...(channel && { channel }),
      ...(username && { username })
    };
    
    await execAsync(
      `curl -s -X POST -H 'Content-type: application/json' --data '${JSON.stringify(payload)}' "${webhookUrl}" 2>/dev/null`
    );
    
    return true;
  } catch {
    return false;
  }
}

export async function sendSlackNotification(
  webhookUrl: string,
  type: "deploy" | "build" | "pr" | "issue" | "custom",
  data: Record<string, string>
): Promise<boolean> {
  const templates: Record<string, string> = {
    deploy: `🚀 *Deployment* ${data.status || "completed"}\nEnvironment: ${data.env || "production"}\nVersion: ${data.version || "unknown"}`,
    build: `🔨 *Build* ${data.status || "completed"}\n${data.message || ""}`,
    pr: `📝 *Pull Request* #${data.number}: ${data.title}\n${data.url || ""}`,
    issue: `🐛 *Issue* #${data.number}: ${data.title}\n${data.url || ""}`,
    custom: data.message || ""
  };
  
  return sendSlackMessage(webhookUrl, templates[type] || templates.custom);
}

// ------------------------------------------------------------------
// Team Metrics
// ------------------------------------------------------------------

export interface TeamMetrics {
  openPRs: number;
  closedPRs: number;
  mergedPRs: number;
  openIssues: number;
  closedIssues: number;
  avgReviewTime: number;
  avgMergeTime: number;
}

export async function getTeamMetrics(): Promise<TeamMetrics> {
  try {
    
    const [openPRs, closedPRs, openIssues, closedIssues] = await Promise.all([
      execAsync(`gh pr list --state open --limit 100 --json number 2>/dev/null || echo "[]"`, { encoding: "utf-8" }),
      execAsync(`gh pr list --state closed --limit 100 --json number 2>/dev/null || echo "[]"`, { encoding: "utf-8" }),
      execAsync(`gh issue list --state open --limit 100 --json number 2>/dev/null || echo "[]"`, { encoding: "utf-8" }),
      execAsync(`gh issue list --state closed --limit 100 --json number 2>/dev/null || echo "[]"`, { encoding: "utf-8" })
    ]);
    
    return {
      openPRs: JSON.parse(openPRs.stdout || "[]").length,
      closedPRs: JSON.parse(closedPRs.stdout || "[]").length,
      mergedPRs: 0,
      openIssues: JSON.parse(openIssues.stdout || "[]").length,
      closedIssues: JSON.parse(closedIssues.stdout || "[]").length,
      avgReviewTime: 0,
      avgMergeTime: 0
    };
  } catch {
    return {
      openPRs: 0, closedPRs: 0, mergedPRs: 0,
      openIssues: 0, closedIssues: 0,
      avgReviewTime: 0, avgMergeTime: 0
    };
  }
}

// ------------------------------------------------------------------
// GitHub Actions
// ------------------------------------------------------------------

export async function triggerWorkflow(
  workflowFile: string,
  ref: string = "main",
  inputs?: Record<string, string>
): Promise<{ success: boolean; runId?: string }> {
  try {
    const inputFlags = inputs
      ? Object.entries(inputs).map(([k, v]) => `-f ${k}=${v}`).join(" ")
      : "";
    
    const { stdout } = await execAsync(
      `gh workflow run "${workflowFile}" --ref ${ref} ${inputFlags} 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    
    const runMatch = stdout.match(/Run ID: (\w+)/);
    
    return { success: true, runId: runMatch?.[1] };
  } catch {
    return { success: false };
  }
}

export async function listWorkflowRuns(
  workflowFile?: string,
  limit: number = 10
): Promise<{ runs: { id: string; name: string; status: string; conclusion?: string; createdAt: string }[] }> {
  try {
    const workflowFlag = workflowFile ? `"${workflowFile}"` : "";
    const { stdout } = await execAsync(
      `gh run list ${workflowFlag} --limit ${limit} --json id,name,status,conclusion,createdAt 2>/dev/null || echo "[]"`,
      { encoding: "utf-8" }
    );
    
    return { runs: JSON.parse(stdout || "[]") };
  } catch {
    return { runs: [] };
  }
}

export class CollaborationLayer {
  createPR = createPullRequest;
  listPRs = listPullRequests;
  getPR = getPullRequest;
  mergePR = mergePullRequest;
  closePR = closePullRequest;
  
  addReviewComment = addReviewComment;
  approvePR = approvePullRequest;
  requestReviewers = requestReviewers;
  getReviewComments = getReviewComments;
  
  createIssue = createIssue;
  listIssues = listIssues;
  
  sendSlackMessage = sendSlackMessage;
  sendSlackNotification = sendSlackNotification;
  
  getTeamMetrics = getTeamMetrics;
  
  triggerWorkflow = triggerWorkflow;
  listWorkflowRuns = listWorkflowRuns;
}
