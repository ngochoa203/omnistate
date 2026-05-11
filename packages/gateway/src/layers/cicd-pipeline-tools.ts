/**
 * CI/CD Pipeline Tools — Group 39
 * Implements: GitHub Actions, GitLab CI, Jenkins, Azure Pipelines
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// GitHub Actions
// ------------------------------------------------------------------

export async function listWorkflows(repo?: string): Promise<{ name: string; status: string; lastRun: string }[]> {
  try {
    const r = repo || ".";
    const { stdout } = await execAsync(`gh run list --repo ${r} --json name,status,updatedAt 2>/dev/null || echo "[]"`, { encoding: "utf-8" });
    const runs = JSON.parse(stdout || "[]");
    return runs.map((r: any) => ({ name: r.name, status: r.status, lastRun: r.updatedAt }));
  } catch {
    return [];
  }
}

export async function runWorkflow(workflowFile: string, ref?: string, repo?: string): Promise<boolean> {
  try {
    const r = repo || ".";
    const branch = ref || "main";
    await execAsync(`gh workflow run ${workflowFile} --ref ${branch} --repo ${r}`);
    return true;
  } catch {
    return false;
  }
}

export async function cancelWorkflow(runId: string, repo?: string): Promise<boolean> {
  try {
    const r = repo || ".";
    await execAsync(`gh run cancel ${runId} --repo ${r}`);
    return true;
  } catch {
    return false;
  }
}

export async function getWorkflowRuns(workflowName: string, limit: number = 10, repo?: string): Promise<{ id: string; status: string; conclusion: string; duration: string }[]> {
  try {
    const r = repo || ".";
    const { stdout } = await execAsync(`gh run list --workflow ${workflowName} --repo ${r} --limit ${limit} --json id,status,conclusion,updatedAt`, { encoding: "utf-8" });
    const runs = JSON.parse(stdout || "[]");
    return runs.map((r: any) => ({ id: r.id, status: r.status, conclusion: r.conclusion || "running", duration: r.updatedAt }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// GitLab CI
// ------------------------------------------------------------------

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  createdAt: string;
  duration: number;
}

export async function listGitLabPipelines(projectId: string, token?: string): Promise<GitLabPipeline[]> {
  try {
    const t = token || process.env.GITLAB_TOKEN;
    const { stdout } = await execAsync(`curl -s --header "PRIVATE-TOKEN: ${t}" "https://gitlab.com/api/v4/projects/${projectId}/pipelines" 2>/dev/null || echo "[]"`, { encoding: "utf-8" });
    const pipelines = JSON.parse(stdout || "[]");
    return pipelines.map((p: any) => ({ id: p.id, status: p.status, ref: p.ref, createdAt: p.created_at, duration: p.duration || 0 }));
  } catch {
    return [];
  }
}

export async function triggerGitLabPipeline(projectId: string, ref: string = "main", token?: string): Promise<boolean> {
  try {
    const t = token || process.env.GITLAB_TOKEN;
    await execAsync(`curl -s --request POST --header "PRIVATE-TOKEN: ${t}" "https://gitlab.com/api/v4/projects/${projectId}/pipeline?ref=${ref}"`);
    return true;
  } catch {
    return false;
  }
}

export async function cancelGitLabPipeline(projectId: string, pipelineId: number, token?: string): Promise<boolean> {
  try {
    const t = token || process.env.GITLAB_TOKEN;
    await execAsync(`curl -s --request POST --header "PRIVATE-TOKEN: ${t}" "https://gitlab.com/api/v4/projects/${projectId}/pipelines/${pipelineId}/cancel"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Jenkins
// ------------------------------------------------------------------

export interface JenkinsJob {
  name: string;
  lastBuild: number;
  lastSuccess: string;
  lastFailure: string;
}

export async function listJenkinsJobs(url: string, user?: string, token?: string): Promise<JenkinsJob[]> {
  try {
    const auth = user && token ? `--user ${user}:${token}` : "";
    const { stdout } = await execAsync(`curl -s ${auth} "${url}/api/json?tree=jobs[name,lastBuild[number],lastSuccessfulBuild[timestamp],lastUnsuccessfulBuild[timestamp]]" 2>/dev/null || echo "{}"`, { encoding: "utf-8" });
    const data = JSON.parse(stdout || "{}");
    return (data.jobs || []).map((j: any) => ({
      name: j.name,
      lastBuild: j.lastBuild?.number || 0,
      lastSuccess: j.lastSuccessfulBuild?.timestamp ? new Date(j.lastSuccessfulBuild.timestamp).toISOString() : "never",
      lastFailure: j.lastUnsuccessfulBuild?.timestamp ? new Date(j.lastUnsuccessfulBuild.timestamp).toISOString() : "never"
    }));
  } catch {
    return [];
  }
}

export async function triggerJenkinsJob(url: string, jobName: string, user?: string, token?: string): Promise<boolean> {
  try {
    const auth = user && token ? `--user ${user}:${token}` : "";
    await execAsync(`curl -s ${auth} -X POST "${url}/job/${jobName}/build"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Azure DevOps
// ------------------------------------------------------------------

export async function listAzurePipelines(org: string, project: string, token?: string): Promise<{ id: number; name: string; folder: string }[]> {
  try {
    const t = token || process.env.AZURE_DEVOPS_TOKEN;
    const { stdout } = await execAsync(`curl -s -H "Authorization: Bearer ${t}" "https://dev.azure.com/${org}/${project}/_apis/pipelines?api-version=7.0" 2>/dev/null || echo "{}"`, { encoding: "utf-8" });
    const data = JSON.parse(stdout || "{}");
    return (data.value || []).map((p: any) => ({ id: p.id, name: p.name, folder: p.folder }));
  } catch {
    return [];
  }
}

export async function runAzurePipeline(org: string, project: string, pipelineId: number, branch?: string, token?: string): Promise<boolean> {
  try {
    const t = token || process.env.AZURE_DEVOPS_TOKEN;
    const body = branch ? JSON.stringify({ resources: { repositories: { self: { refName: `refs/heads/${branch}` } } } }) : "{}";
    await execAsync(`curl -s -X POST -H "Authorization: Bearer ${t}" -H "Content-Type: application/json" "${org}/${project}/_apis/pipelines/${pipelineId}/runs" -d '${body}'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Generic CI Operations
// ------------------------------------------------------------------

export async function getCIStatus(): Promise<{ provider: string; branch: string; status: string }> {
  // Auto-detect CI provider
  if (process.env.GITHUB_ACTIONS) return { provider: "github-actions", branch: process.env.GITHUB_REF_NAME || "unknown", status: "running" };
  if (process.env.GITLAB_CI) return { provider: "gitlab", branch: process.env.CI_COMMIT_REF_NAME || "unknown", status: "running" };
  if (process.env.JENKINS_URL) return { provider: "jenkins", branch: process.env.GIT_BRANCH || "unknown", status: "unknown" };
  if (process.env.BUILD_REASON) return { provider: "azure", branch: "unknown", status: "unknown" };
  
  return { provider: "none", branch: "unknown", status: "not-in-ci" };
}

export async function notifyCI(message: string, status: "success" | "failure" | "running"): Promise<boolean> {
  console.log(`CI Notification [${status}]: ${message}`);
  return true;
}

export class CICDLayer {
  // GitHub Actions
  listWorkflows = listWorkflows;
  runWorkflow = runWorkflow;
  cancelWorkflow = cancelWorkflow;
  getWorkflowRuns = getWorkflowRuns;
  
  // GitLab
  listGitLabPipelines = listGitLabPipelines;
  triggerGitLab = triggerGitLabPipeline;
  cancelGitLab = cancelGitLabPipeline;
  
  // Jenkins
  listJenkinsJobs = listJenkinsJobs;
  triggerJenkins = triggerJenkinsJob;
  
  // Azure
  listAzurePipelines = listAzurePipelines;
  runAzurePipeline = runAzurePipeline;
  
  // Generic
  getCIStatus = getCIStatus;
  notify = notifyCI;
}
