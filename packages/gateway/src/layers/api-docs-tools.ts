/**
 * API Documentation Tools — Group 41
 * Implements: OpenAPI/Swagger generation, API docs, Postman collection
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// OpenAPI/Swagger
// ------------------------------------------------------------------

export async function generateOpenAPIfromRoutes(routesDir: string): Promise<string> {
  // Scan routes directory and generate OpenAPI spec
  const routes: { path: string; method: string; summary: string }[] = [];
  
  try {
    const files = await fs.readdir(routesDir);
    for (const file of files) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        const content = await fs.readFile(path.join(routesDir, file), "utf-8");
        // Simple regex to find routes
        const methodMatches = content.matchAll(/@(get|post|put|delete|patch)\s+(\/[^\s]+)/g);
        for (const match of methodMatches) {
          routes.push({
            method: match[1]!,
            path: match[2]!,
            summary: "Auto-generated endpoint"
          });
        }
      }
    }
    
    const spec = {
      openapi: "3.0.0",
      info: { title: "API", version: "1.0.0" },
      paths: routes.reduce((acc, r) => {
        if (!acc[r.path]) acc[r.path] = {};
        acc[r.path][r.method] = {
          summary: r.summary,
          responses: { "200": { description: "OK" } }
        };
        return acc;
      }, {} as Record<string, any>)
    };
    
    return JSON.stringify(spec, null, 2);
  } catch {
    return "{}";
  }
}

export async function saveOpenAPISpec(spec: object, outputPath: string): Promise<boolean> {
  try {
    await fs.writeFile(outputPath, JSON.stringify(spec, null, 2));
    return true;
  } catch {
    return false;
  }
}

export async function validateOpenAPI(specPath: string): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const content = await fs.readFile(specPath, "utf-8");
    const spec = JSON.parse(content);
    
    const errors: string[] = [];
    
    // Basic validation
    if (!spec.openapi && !spec.swagger) {
      errors.push("Missing openapi or swagger version");
    }
    if (!spec.info) errors.push("Missing info section");
    if (!spec.paths) errors.push("Missing paths section");
    
    return { valid: errors.length === 0, errors };
  } catch (e: any) {
    return { valid: false, errors: [e.message] };
  }
}

// ------------------------------------------------------------------
// Postman Collection
// ------------------------------------------------------------------

export interface PostmanRequest {
  name: string;
  method: string;
  url: string;
  headers?: { key: string; value: string }[];
  body?: string;
}

export async function createPostmanCollection(requests: PostmanRequest[]): Promise<object> {
  const collection = {
    info: {
      name: "Generated Collection",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: requests.map(req => ({
      name: req.name,
      request: {
        method: req.method.toUpperCase(),
        header: req.headers || [],
        url: { raw: req.url },
        body: req.body ? { mode: "raw", raw: req.body } : undefined
      }
    }))
  };
  
  return collection;
}

export async function exportToPostmanCollection(requests: PostmanRequest[], outputPath: string): Promise<boolean> {
  try {
    const collection = await createPostmanCollection(requests);
    await fs.writeFile(outputPath, JSON.stringify(collection, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// API Documentation Generator
// ------------------------------------------------------------------

export async function generateMarkdownDocs(specPath: string, outputPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(specPath, "utf-8");
    const spec = JSON.parse(content);
    
    let markdown = `# ${spec.info?.title || "API Documentation"}\n\n`;
    markdown += `Version: ${spec.info?.version || "1.0.0"}\n\n`;
    
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
        markdown += `## ${path}\n\n`;
        
        for (const [method, details] of Object.entries(methods) as [string, any][]) {
          markdown += `### ${method.toUpperCase()}\n\n`;
          markdown += `- **Summary**: ${details.summary || "N/A"}\n`;
          markdown += `- **Description**: ${details.description || "N/A"}\n\n`;
          
          if (details.parameters) {
            markdown += `**Parameters:**\n`;
            for (const param of details.parameters) {
              markdown += `- ${param.name} (${param.in}): ${param.description}\n`;
            }
            markdown += "\n";
          }
          
          if (details.requestBody) {
            markdown += `**Request Body:**\n`;
            markdown += "```json\n";
            markdown += JSON.stringify(details.requestBody, null, 2);
            markdown += "\n```\n\n";
          }
          
          markdown += `**Responses:**\n`;
          if (details.responses) {
            for (const [code, response] of Object.entries(details.responses) as [string, any][]) {
              markdown += `- ${code}: ${response.description || "N/A"}\n`;
            }
          }
          markdown += "\n---\n\n";
        }
      }
    }
    
    await fs.writeFile(outputPath, markdown);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// API Testing
// ------------------------------------------------------------------

export async function testEndpoint(url: string, method: string = "GET", headers?: Record<string, string>): Promise<{ status: number; time: number }> {
  const start = Date.now();
  
  try {
    const { stdout } = await execAsync(
      `curl -s -o /dev/null -w "%{http_code}" -X ${method} ${headers ? Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" ") : ""} "${url}"`,
      { encoding: "utf-8" }
    );

    return {
      status: parseInt(stdout.trim() || "0", 10),
      time: Date.now() - start
    };
  } catch {
    return { status: 0, time: Date.now() - start };
  }
}

export async function batchTestEndpoints(endpoints: { url: string; method: string }[]): Promise<{ url: string; status: number; time: number }[]> {
  return Promise.all(endpoints.map(async (e) => {
    const result = await testEndpoint(e.url, e.method);
    return { url: e.url, ...result };
  }));
}

export class APIDocsLayer {
  generateOpenAPI = generateOpenAPIfromRoutes;
  saveOpenAPI = saveOpenAPISpec;
  validateOpenAPI = validateOpenAPI;
  
  createPostmanCollection = createPostmanCollection;
  exportPostman = exportToPostmanCollection;
  
  generateMarkdown = generateMarkdownDocs;
  
  testEndpoint = testEndpoint;
  batchTest = batchTestEndpoints;
}
