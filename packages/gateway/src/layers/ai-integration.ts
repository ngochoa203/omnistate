/**
 * AI Integration Layer — OpenAI, Anthropic, embeddings, semantic search.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

function getOpenAiKey(): string { return process.env.OPENAI_API_KEY || ""; }
function getAnthropicKey(): string { return process.env.ANTHROPIC_API_KEY || ""; }

export async function chatWithOpenAI(messages: ChatMessage[], options: { model?: string; temperature?: number; maxTokens?: number } = {}): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return { success: false, error: "OPENAI_API_KEY not set" };
  try {
    const { model = "gpt-4", temperature = 0.7, maxTokens = 1000 } = options;
    const payload = { model, messages, temperature, max_tokens: maxTokens };
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer ${apiKey}" -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 60000 }
    );
    const response = JSON.parse(stdout);
    if (response.error) return { success: false, error: response.error.message };
    return { success: true, content: response.choices[0]?.message?.content };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateEmbeddings(texts: string[], model: string = "text-embedding-3-small"): Promise<{ success: boolean; embeddings?: Array<{ embedding: number[]; model: string; usage: { tokens: number } }>; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return { success: false, error: "OPENAI_API_KEY not set" };
  try {
    const payload = { model, input: texts };
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/embeddings -H "Content-Type: application/json" -H "Authorization: Bearer ${apiKey}" -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const response = JSON.parse(stdout);
    if (response.error) return { success: false, error: response.error.message };
    const embeddings = response.data.map((item: any) => ({ embedding: item.embedding, model, usage: { tokens: response.usage.total_tokens } }));
    return { success: true, embeddings };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function generateImage(prompt: string, outputPath?: string): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return { success: false, error: "OPENAI_API_KEY not set" };
  try {
    const payload = { model: "dall-e-3", prompt, n: 1, size: "1024x1024" };
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/images/generations -H "Content-Type: application/json" -H "Authorization: Bearer ${apiKey}" -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 120000 }
    );
    const response = JSON.parse(stdout);
    if (response.error) return { success: false, error: response.error.message };
    const imageUrl = response.data[0]?.url;
    if (!imageUrl) return { success: false, error: "No image URL returned" };
    const outPath = outputPath || `/tmp/generated_image_${Date.now()}.png`;
    await execAsync(`curl -s -o "${outPath}" "${imageUrl}"`, { timeout: 30000 });
    return { success: true, imagePath: outPath };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function chatWithAnthropic(messages: ChatMessage[], options: { model?: string; maxTokens?: number } = {}): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = getAnthropicKey();
  if (!apiKey) return { success: false, error: "ANTHROPIC_API_KEY not set" };
  try {
    const { model = "claude-sonnet-4-20250514", maxTokens = 1024 } = options;
    const payload = { model, messages: messages.filter(m => m.role !== "system"), max_tokens: maxTokens };
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.anthropic.com/v1/messages -H "Content-Type: application/json" -H "x-api-key: ${apiKey}" -H "anthropic-version: 2023-06-01" -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 60000 }
    );
    const response = JSON.parse(stdout);
    if (response.error) return { success: false, error: response.error.message };
    return { success: true, content: response.content[0]?.text };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dotProduct += a[i]! * b[i]!; normA += a[i]! * a[i]!; normB += b[i]! * b[i]!; }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}