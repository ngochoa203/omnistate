/**
 * Hybrid Tooling Module — Workflow Functions (UC-D14, UC-D21).
 *
 * @module hybrid/tooling-docker
 */

import { join } from "node:path";
import {
  execAsync,
  ensureDir,
  readJson,
  writeJson,
  generateId,
  WorkflowTemplate,
  WorkflowTemplateConfig,
  WorkflowResult,
  PipelineConfig,
  Pipeline,
  PipelineResult,
  BUILT_IN_TEMPLATES,
} from "./tooling-types.js";

// ===========================================================================
// UC-D14: Workflow Template Library
// ===========================================================================

/**
 * UC-D14: List all available workflow templates (built-in + user-created).
 */
export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const dir = ensureDir("templates");
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const userTemplates = files.map((f) =>
    readJson<WorkflowTemplate>(join(dir, f), {} as WorkflowTemplate)
  );
  return [...BUILT_IN_TEMPLATES, ...userTemplates];
}

/**
 * UC-D14: Get a specific workflow template by ID.
 */
export async function getTemplate(
  templateId: string
): Promise<WorkflowTemplate | null> {
  const builtin = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (builtin) return builtin;

  const dir = ensureDir("templates");
  const path = join(dir, `${templateId}.json`);
  const { existsSync } = await import("node:fs");
  if (!existsSync(path)) return null;
  return readJson<WorkflowTemplate>(path, null as unknown as WorkflowTemplate);
}

/**
 * UC-D14: Create a new workflow template.
 */
export async function createTemplate(
  config: WorkflowTemplateConfig
): Promise<WorkflowTemplate> {
  const now = new Date().toISOString();
  const template: WorkflowTemplate = {
    id: generateId("tmpl"),
    name: config.name,
    description: config.description,
    category: config.category ?? "custom",
    steps: config.steps,
    params: config.params ?? [],
    author: config.author,
    tags: config.tags,
    createdAt: now,
    updatedAt: now,
  };
  const dir = ensureDir("templates");
  writeJson(join(dir, `${template.id}.json`), template);
  return template;
}

/**
 * UC-D14: Delete a workflow template by ID.
 */
export async function deleteTemplate(templateId: string): Promise<boolean> {
  try {
    const dir = ensureDir("templates");
    const path = join(dir, `${templateId}.json`);
    const { existsSync, unlinkSync } = await import("node:fs");
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D14: Run a workflow template with optional parameters.
 */
export async function runTemplate(
  templateId: string,
  params?: Record<string, unknown>
): Promise<WorkflowResult> {
  const template = await getTemplate(templateId);
  if (!template) {
    return {
      templateId,
      status: "failed",
      completedSteps: 0,
      totalSteps: 0,
      durationMs: 0,
      outputs: {},
      error: "Template not found",
    };
  }

  const startMs = Date.now();
  let completedSteps = 0;
  const outputs: Record<string, unknown> = {};

  for (const step of template.steps) {
    try {
      // Substitute template params
      const stepParams = JSON.parse(
        JSON.stringify(step.params).replace(
          /\{\{(\w+)\}\}/g,
          (_, key: string) => String(params?.[key] ?? `{{${key}}}`)
        )
      ) as Record<string, unknown>;

      if (step.tool === "shell.exec") {
        const { stdout } = await execAsync(
          stepParams["command"] as string,
          { timeout: 60_000 }
        );
        outputs[step.id] = stdout.trim();
      } else if (step.tool === "app.script") {
        const { stdout } = await execAsync(
          `osascript -e ${JSON.stringify(stepParams["script"] as string)}`
        );
        outputs[step.id] = stdout.trim();
      }
      completedSteps++;
    } catch (err) {
      return {
        templateId,
        status: "failed",
        completedSteps,
        totalSteps: template.steps.length,
        durationMs: Date.now() - startMs,
        outputs,
        error: `Step "${step.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    templateId,
    status: "ok",
    completedSteps,
    totalSteps: template.steps.length,
    durationMs: Date.now() - startMs,
    outputs,
  };
}

/**
 * UC-D14: Export a template to a JSON file path.
 */
export async function shareTemplate(
  templateId: string,
  exportPath: string
): Promise<boolean> {
  try {
    const template = await getTemplate(templateId);
    if (!template) return false;
    writeJson(exportPath, template);
    return true;
  } catch {
    return false;
  }
}

/**
 * UC-D14: Import a template from a JSON file path.
 */
export async function importTemplate(
  importPath: string
): Promise<WorkflowTemplate> {
  const raw = readJson<WorkflowTemplate>(importPath, null as unknown as WorkflowTemplate);
  if (!raw) throw new Error(`Could not read template from: ${importPath}`);

  // Assign a new ID to avoid collisions
  const template: WorkflowTemplate = {
    ...raw,
    id: generateId("tmpl"),
    updatedAt: new Date().toISOString(),
  };
  const dir = ensureDir("templates");
  writeJson(join(dir, `${template.id}.json`), template);
  return template;
}

// ===========================================================================
// UC-D21: Local Data Pipeline Automation
// ===========================================================================

/**
 * UC-D21: Create a new local data pipeline.
 */
export async function createPipeline(config: PipelineConfig): Promise<Pipeline> {
  const pipeline: Pipeline = {
    id: generateId("pipe"),
    name: config.name,
    description: config.description,
    steps: config.steps,
    schedule: config.schedule,
    createdAt: new Date().toISOString(),
    runCount: 0,
  };
  const dir = ensureDir("pipelines");
  writeJson(join(dir, `${pipeline.id}.json`), pipeline);
  return pipeline;
}

/**
 * UC-D21: Run a pipeline by ID, executing each step sequentially.
 */
export async function runPipeline(pipelineId: string): Promise<PipelineResult> {
  const dir = ensureDir("pipelines");
  const path = join(dir, `${pipelineId}.json`);
  const { existsSync } = await import("node:fs");
  if (!existsSync(path)) {
    return {
      pipelineId,
      status: "failed",
      completedSteps: 0,
      totalSteps: 0,
      durationMs: 0,
      outputs: {},
      error: "Pipeline not found",
    };
  }

  const pipeline = readJson<Pipeline>(path, {} as Pipeline);
  const startMs = Date.now();
  let completedSteps = 0;
  const outputs: Record<string, string> = {};
  let lastOutput = "";

  for (const step of pipeline.steps ?? []) {
    try {
      let cmd = step.command ?? "";
      // Pipe previous output as stdin for transform steps
      if (step.type === "transform" && lastOutput) {
        cmd = `echo ${JSON.stringify(lastOutput)} | ${cmd}`;
      }
      const { stdout } = await execAsync(cmd, { timeout: 60_000 });
      lastOutput = stdout.trim();
      outputs[step.id] = lastOutput.slice(0, 1000);
      completedSteps++;
    } catch (err) {
      pipeline.runCount = (pipeline.runCount ?? 0) + 1;
      pipeline.lastRunAt = new Date().toISOString();
      writeJson(path, pipeline);
      return {
        pipelineId,
        status: "failed",
        completedSteps,
        totalSteps: pipeline.steps.length,
        durationMs: Date.now() - startMs,
        outputs,
        error: `Step "${step.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  pipeline.runCount = (pipeline.runCount ?? 0) + 1;
  pipeline.lastRunAt = new Date().toISOString();
  writeJson(path, pipeline);

  return {
    pipelineId,
    status: "ok",
    completedSteps,
    totalSteps: pipeline.steps.length,
    durationMs: Date.now() - startMs,
    outputs,
  };
}

/**
 * UC-D21: List all defined pipelines.
 */
export async function listPipelines(): Promise<Pipeline[]> {
  try {
    const dir = ensureDir("pipelines");
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    return files.map((f) => readJson<Pipeline>(join(dir, f), {} as Pipeline));
  } catch {
    return [];
  }
}

/**
 * UC-D21: Delete a pipeline by ID.
 */
export async function deletePipeline(pipelineId: string): Promise<boolean> {
  try {
    const dir = ensureDir("pipelines");
    const path = join(dir, `${pipelineId}.json`);
    const { existsSync, unlinkSync } = await import("node:fs");
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
