/**
 * AI Integration Tools — OpenAI, Claude, Ollama, RAG.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as https from "node:https";

const execAsync = promisify(exec);

// OpenAI
export async function openaiComplete(prompt: string, model = "gpt-4", options?: { temperature?: number; maxTokens?: number }): Promise<{ text: string; model: string; usage: object }> {
  return new Promise((resolve) => {
    const data = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: options?.temperature ?? 0.7, max_tokens: options?.maxTokens ?? 1000 });
    const req = https.request({ hostname: "api.openai.com", path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}` } }, (res) => {
      let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => { try { const result = JSON.parse(body); resolve({ text: result.choices?.[0]?.message?.content || "", model, usage: result.usage || {} }); } catch { resolve({ text: "", model, usage: {} }); } });
    });
    req.write(data); req.end();
  });
}

export async function openaiEmbed(text: string, model = "text-embedding-3-small"): Promise<number[]> {
  return new Promise((resolve) => {
    const data = JSON.stringify({ model, input: text });
    const req = https.request({ hostname: "api.openai.com", path: "/v1/embeddings", method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}` } }, (res) => {
      let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => { try { const result = JSON.parse(body); resolve(result.data?.[0]?.embedding || []); } catch { resolve([]); } });
    });
    req.write(data); req.end();
  });
}

// Ollama
const OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost:11434";
export async function ollamaList(): Promise<{ name: string; size: number }[]> { try { const { stdout } = await execAsync(`curl -s ${OLLAMA_HOST}/api/tags 2>/dev/null || echo "{}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.models?.map((m: any) => ({ name: m.name, size: m.size })) || []; } catch { return []; } }
export async function ollamaGenerate(prompt: string, model = "llama2"): Promise<string> { try { const { stdout } = await execAsync(`curl -s -X POST ${OLLAMA_HOST}/api/generate -d '{"model":"${model}","prompt":"${prompt}","stream":false}' 2>/dev/null || echo "{}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.response || ""; } catch { return ""; } }
export async function ollamaEmbed(text: string, model = "nomic-embed-text"): Promise<number[]> { try { const { stdout } = await execAsync(`curl -s -X POST ${OLLAMA_HOST}/api/embeddings -d '{"model":"${model}","prompt":"${text}"}' 2>/dev/null || echo "{}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.embedding || []; } catch { return []; } }

// Claude
export async function claudeComplete(prompt: string, model = "claude-3-opus-20240229", options?: { temperature?: number }): Promise<{ text: string; model: string; usage: object }> {
  return new Promise((resolve) => {
    const data = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 1024, temperature: options?.temperature ?? 0.7 });
    const req = https.request({ hostname: "api.anthropic.com", path: "/v1/messages", method: "POST", headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" } }, (res) => {
      let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => { try { const result = JSON.parse(body); resolve({ text: result.content?.[0]?.text || "", model, usage: result.usage || {} }); } catch { resolve({ text: "", model, usage: {} }); } });
    });
    req.write(data); req.end();
  });
}

// RAG
interface Document { id: string; content: string; embedding: number[]; }
const documentStore = new Map<string, Document>();

export async function ragIndexDocument(id: string, content: string): Promise<boolean> { const embedding = await ollamaEmbed(content.slice(0, 1000)); documentStore.set(id, { id, content, embedding }); return true; }
export async function ragSearch(query: string, limit = 5): Promise<{ id: string; content: string; score: number }[]> {
  const queryEmbedding = await ollamaEmbed(query);
  const scored = Array.from(documentStore.values()).map(doc => ({ id: doc.id, content: doc.content, score: cosineSimilarity(queryEmbedding, doc.embedding) }));
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function cosineSimilarity(a: number[], b: number[]): number { if (a.length !== b.length || a.length === 0) return 0; let dot = 0, magA = 0, magB = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; } return dot / (Math.sqrt(magA) * Math.sqrt(magB)); }

export class AIIntegrationLayer { openaiComplete = openaiComplete; openaiEmbed = openaiEmbed; claudeComplete = claudeComplete; ollamaList = ollamaList; ollamaGenerate = ollamaGenerate; ollamaEmbed = ollamaEmbed; ragIndexDocument = ragIndexDocument; ragSearch = ragSearch; }
