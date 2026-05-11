/**
 * Template Engine Tools — Advanced Layer (API 93)
 * Implements: Template rendering, partials, helpers, layouts
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface Template {
  id: string;
  name: string;
  content: string;
  helpers?: Record<string, (arg: any) => string>;
  partials?: Record<string, string>;
}

export interface RenderOptions {
  data?: Record<string, any>;
  helpers?: Record<string, (arg: any) => string>;
  partials?: Record<string, string>;
  layout?: string;
}

const templates = new Map<string, Template>();

export async function createTemplate(name: string, content: string): Promise<Template> {
  const template: Template = { id: `tpl_${Date.now()}`, name, content };
  templates.set(name, template);
  return template;
}

export async function renderTemplate(
  templateName: string,
  options: RenderOptions
): Promise<string> {
  const template = templates.get(templateName);
  if (!template) throw new Error(`Template ${templateName} not found`);
  
  let content = template.content;
  
  // Replace helpers
  const allHelpers = { ...template.helpers, ...options.helpers };
  for (const [name, helper] of Object.entries(allHelpers)) {
    const regex = new RegExp(`\\{\\{${name}\\s+([^}]+)\\}\\}`, "g");
    content = content.replace(regex, (_, arg) => helper(arg.trim()));
  }
  
  // Replace variables
  if (options.data) {
    for (const [key, value] of Object.entries(options.data)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      content = content.replace(regex, String(value));
    }
  }
  
  // Process partials
  const partialRegex = /\{\{>\s*(\w+)\s*\}\}/g;
  for (const [, partialName] of content.matchAll(partialRegex)) {
    const partial = options.partials?.[partialName] || template.partials?.[partialName];
    if (partial) {
      content = content.replace(`{{> ${partialName} }}`, partial);
    }
  }
  
  // Apply layout
  if (options.layout) {
    const layout = templates.get(options.layout);
    if (layout) {
      content = layout.content.replace("{{content}}", content);
    }
  }
  
  return content;
}

export class TemplateLayer {
  create = createTemplate;
  render = renderTemplate;
}
