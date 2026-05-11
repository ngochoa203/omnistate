/**
 * AI Integration Layer — OpenAI, Anthropic, image generation, embeddings.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: { tokens: number };
}

export interface ImageGenerationOptions {
  size?: "256x256" | "512x512" | "1024x1024";
  style?: "vivid" | "natural";
  quality?: "standard" | "hd";
}

// ------------------------------------------------------------------
// OpenAI Integration
// ------------------------------------------------------------------

function getOpenAiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

function getAnthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

/**
 * Chat with OpenAI.
 */
export async function chatWithOpenAI(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY not set" };
  }
  
  try {
    const {
      model = "gpt-4",
      temperature = 0.7,
      maxTokens = 1000
    } = options;
    
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    };
    
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${apiKey}" \
        -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 60000 }
    );
    
    const response = JSON.parse(stdout);
    
    if (response.error) {
      return { success: false, error: response.error.message };
    }
    
    return { success: true, content: response.choices[0]?.message?.content };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generate embeddings with OpenAI.
 */
export async function generateEmbeddings(
  texts: string[],
  model: string = "text-embedding-3-small"
): Promise<{ success: boolean; embeddings?: EmbeddingResult[]; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY not set" };
  }
  
  try {
    const payload = { model, input: texts };
    
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/embeddings \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${apiKey}" \
        -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 30000 }
    );
    
    const response = JSON.parse(stdout);
    
    if (response.error) {
      return { success: false, error: response.error.message };
    }
    
    const embeddings: EmbeddingResult[] = response.data.map((item: any) => ({
      embedding: item.embedding,
      model,
      usage: { tokens: response.usage.total_tokens }
    }));
    
    return { success: true, embeddings };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Generate image with DALL-E.
 */
export async function generateImage(
  prompt: string,
  outputPath?: string,
  options: ImageGenerationOptions = {}
): Promise<{ success: boolean; imagePath?: string; error?: string }> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return { success: false, error: "OPENAI_API_KEY not set" };
  }
  
  try {
    const {
      size = "1024x1024",
      style = "vivid",
      quality = "standard"
    } = options;
    
    const payload = {
      model: "dall-e-3",
      prompt,
      n: 1,
      size,
      style,
      quality
    };
    
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.openai.com/v1/images/generations \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${apiKey}" \
        -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 120000 }
    );
    
    const response = JSON.parse(stdout);
    
    if (response.error) {
      return { success: false, error: response.error.message };
    }
    
    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      return { success: false, error: "No image URL returned" };
    }
    
    // Download image
    const outPath = outputPath || `/tmp/generated_image_${Date.now()}.png`;
    await execAsync(
      `curl -s -o "${outPath}" "${imageUrl}"`,
      { timeout: 30000 }
    );
    
    return { success: true, imagePath: outPath };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------
// Anthropic Integration
// ------------------------------------------------------------------

/**
 * Chat with Anthropic Claude.
 */
export async function chatWithAnthropic(
  messages: ChatMessage[],
  options: ChatOptions & { systemPrompt?: string } = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    return { success: false, error: "ANTHROPIC_API_KEY not set" };
  }
  
  try {
    const {
      model = "claude-sonnet-4-20250514",
      temperature = 1,
      maxTokens = 1024,
      systemPrompt = ""
    } = options;
    
    const payload: any = {
      model,
      messages: messages.filter(m => m.role !== "system"),
      max_tokens: maxTokens,
      temperature
    };
    
    if (systemPrompt) {
      payload.system = systemPrompt;
    }
    
    const { stdout } = await execAsync(
      `curl -s -X POST https://api.anthropic.com/v1/messages \
        -H "Content-Type: application/json" \
        -H "x-api-key: ${apiKey}" \
        -H "anthropic-version: 2023-06-01" \
        -d '${JSON.stringify(payload)}'`,
      { encoding: "utf-8", timeout: 60000 }
    );
    
    const response = JSON.parse(stdout);
    
    if (response.error) {
      return { success: false, error: response.error.message };
    }
    
    return { success: true, content: response.content[0]?.text };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------
// Semantic Search
// ------------------------------------------------------------------

const embeddingsCache: Map<string, EmbeddingResult> = new Map();

/**
 * Find similar text using cosine similarity.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Semantic search over a corpus.
 */
export async function semanticSearch(
  query: string,
  corpus: Array<{ id: string; text: string }>,
  topK: number = 5
): Promise<Array<{ id: string; text: string; score: number }>> {
  // Generate embeddings for query and corpus
  const queryResult = await generateEmbeddings([query]);
  if (!queryResult.success || !queryResult.embeddings) {
    return [];
  }
  
  const queryEmbedding = queryResult.embeddings[0]!.embedding;
  
  // Embed corpus in batches
  const corpusEmbeddings: Array<{ id: string; text: string; embedding: number[] }> = [];
  const batchSize = 20;
  
  for (let i = 0; i < corpus.length; i += batchSize) {
    const batch = corpus.slice(i, i + batchSize);
    const batchTexts = batch.map(c => c.text);
    
    const batchResult = await generateEmbeddings(batchTexts);
    if (batchResult.success && batchResult.embeddings) {
      batch.forEach((item, idx) => {
        corpusEmbeddings.push({
          id: item.id,
          text: item.text,
          embedding: batchResult.embeddings![idx]!.embedding
        });
      });
    }
  }
  
  // Calculate similarities
  const results = corpusEmbeddings.map(item => ({
    id: item.id,
    text: item.text,
    score: cosineSimilarity(queryEmbedding, item.embedding)
  }));
  
  // Sort by score and return top K
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ------------------------------------------------------------------
// Text Analysis
// ------------------------------------------------------------------

/**
 * Analyze sentiment of text.
 */
export async function analyzeSentiment(
  text: string
): Promise<{ sentiment: "positive" | "negative" | "neutral"; score: number }> {
  const result = await chatWithOpenAI(
    [
      {
        role: "user",
        content: `Analyze the sentiment of this text. Return ONLY a JSON object like: {"sentiment": "positive", "score": 0.8}\n\nText: ${text}`
      }
    ],
    { model: "gpt-4", maxTokens: 100 }
  );
  
  if (!result.success || !result.content) {
    return { sentiment: "neutral", score: 0 };
  }
  
  try {
    const parsed = JSON.parse(result.content);
    return {
      sentiment: parsed.sentiment || "neutral",
      score: parsed.score || 0
    };
  } catch {
    return { sentiment: "neutral", score: 0 };
  }
}

/**
 * Extract entities from text.
 */
export async function extractEntities(
  text: string
): Promise<{ persons: string[]; organizations: string[]; locations: string[] }> {
  const result = await chatWithOpenAI(
    [
      {
        role: "user",
        content: `Extract named entities from this text. Return ONLY a JSON object like: {"persons": [], "organizations": [], "locations": []}\n\nText: ${text}`
      }
    ],
    { model: "gpt-4", maxTokens: 200 }
  );
  
  if (!result.success || !result.content) {
    return { persons: [], organizations: [], locations: [] };
  }
  
  try {
    return JSON.parse(result.content);
  } catch {
    return { persons: [], organizations: [], locations: [] };
  }
}

/**
 * Translate text.
 */
export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string
): Promise<{ success: boolean; translated?: string; error?: string }> {
  const lang = sourceLanguage ? `from ${sourceLanguage} to ${targetLanguage}` : `to ${targetLanguage}`;
  
  const result = await chatWithOpenAI(
    [
      {
        role: "user",
        content: `Translate the following text ${lang}. Return ONLY the translated text:\n\n${text}`
      }
    ],
    { model: "gpt-4", maxTokens: 2000 }
  );
  
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  return { success: true, translated: result.content };
}
