/**
 * AI & LLM Integration Tools — Group 23
 * Implements: Text generation, summarization, translation, embeddings
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as https from "node:https";
import * as http from "node:http";


// ------------------------------------------------------------------
// OpenAI Integration
// ------------------------------------------------------------------

export interface LLMResponse {
  text: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
  finishReason: string;
}

export class OpenAIClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string = "https://api.openai.com/v1";
  
  constructor(apiKey: string, model: string = "gpt-4") {
    this.apiKey = apiKey;
    this.model = model;
  }
  
  async complete(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    stop?: string[];
  }): Promise<LLMResponse> {
    return new Promise((resolve) => {
      const data = JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 1000,
        stop: options?.stop
      });
      
      const url = new URL(`${this.baseUrl}/chat/completions`);
      const requestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        }
      };

      const req = https.request(requestOptions, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            resolve({
              text: result.choices?.[0]?.message?.content || "",
              model: this.model,
              usage: result.usage || { prompt: 0, completion: 0, total: 0 },
              finishReason: result.choices?.[0]?.finish_reason || "stop"
            });
          } catch {
            resolve({ text: "", model: this.model, usage: { prompt: 0, completion: 0, total: 0 }, finishReason: "error" });
          }
        });
      });
      
      req.write(data);
      req.end();
    });
  }
  
  async embed(text: string): Promise<number[]> {
    return new Promise((resolve) => {
      const data = JSON.stringify({
        model: "text-embedding-3-small",
        input: text
      });
      
      const url = new URL(`${this.baseUrl}/embeddings`);
      const requestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        }
      };

      const req = https.request(requestOptions, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            resolve(result.data?.[0]?.embedding || []);
          } catch {
            resolve([]);
          }
        });
      });
      
      req.write(data);
      req.end();
    });
  }
}

// ------------------------------------------------------------------
// Text Operations with AI
// ------------------------------------------------------------------

export async function summarizeText(text: string, openaiKey?: string): Promise<string> {
  if (!openaiKey) {
    return text.slice(0, 200) + "...";
  }
  
  const client = new OpenAIClient(openaiKey, "gpt-4");
  const response = await client.complete(`Summarize this text in 3 sentences:\n\n${text}`);
  return response.text;
}

export async function translateText(text: string, targetLang: string, openaiKey?: string): Promise<string> {
  if (!openaiKey) {
    return text;
  }
  
  const client = new OpenAIClient(openaiKey);
  const response = await client.complete(`Translate to ${targetLang}:\n\n${text}`);
  return response.text;
}

export async function extractKeyPoints(text: string, openaiKey?: string): Promise<string[]> {
  if (!openaiKey) {
    return text.split(". ").slice(0, 5).map(s => s.trim());
  }
  
  const client = new OpenAIClient(openaiKey);
  const response = await client.complete(`Extract 5 key points from this text:\n\n${text}`);
  return response.text.split("\n").filter(l => l.trim());
}

export async function fixGrammar(text: string, openaiKey?: string): Promise<string> {
  if (!openaiKey) {
    return text;
  }
  
  const client = new OpenAIClient(openaiKey);
  const response = await client.complete(`Fix grammar and spelling:\n\n${text}`);
  return response.text;
}

// ------------------------------------------------------------------
// Image Generation (DALL-E)
// ------------------------------------------------------------------

export async function generateImage(prompt: string, openaiKey: string, size: "1024x1024" | "512x512" | "256x256" = "1024x1024"): Promise<string | null> {
  try {
    const data = JSON.stringify({
      prompt,
      n: 1,
      size
    });
    
    const options = {
      hostname: "api.openai.com",
      path: "/v1/images/generations",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            resolve(result.data?.[0]?.url || null);
          } catch {
            resolve(null);
          }
        });
      });
      
      req.write(data);
      req.end();
    });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Local LLM (Ollama)
// ------------------------------------------------------------------

export async function ollamaComplete(
  prompt: string,
  model: string = "llama3",
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  try {
    const data = JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 500
      }
    });
    
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: "localhost", port: 11434, path: "/api/generate", method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => body += chunk);
          res.on("end", () => {
            try {
              const result = JSON.parse(body);
              resolve(result.response || "");
            } catch {
              resolve("");
            }
          });
        }
      );
      
      req.write(data);
      req.end();
    });
  } catch {
    return "";
  }
}

export async function ollamaEmbed(text: string, model: string = "nomic-embed-text"): Promise<number[]> {
  try {
    const data = JSON.stringify({ model, prompt: text });
    
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: "localhost", port: 11434, path: "/api/embeddings", method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => body += chunk);
          res.on("end", () => {
            try {
              const result = JSON.parse(body);
              resolve(result.embedding || []);
            } catch {
              resolve([]);
            }
          });
        }
      );
      
      req.write(data);
      req.end();
    });
  } catch {
    return [];
  }
}

export async function listOllamaModels(): Promise<string[]> {
  try {
    return new Promise((resolve) => {
      const req = http.get({ hostname: "localhost", port: 11434, path: "/api/tags" }, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            resolve(result.models?.map((m: any) => m.name) || []);
          } catch {
            resolve([]);
          }
        });
      });
      
      req.on("error", () => resolve([]));
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Whisper (Speech to Text)
// ------------------------------------------------------------------

export async function transcribeAudio(audioPath: string, openaiKey?: string): Promise<string> {
  // In production, use openai-whisper or similar
  console.log(`Transcribing: ${audioPath}`);
  return "Transcription placeholder";
}

// ------------------------------------------------------------------
// AI Chat Completion (Generic)
// ------------------------------------------------------------------

export async function chatComplete(
  prompt: string,
  systemPrompt?: string,
  options?: { temperature?: number; model?: string }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    const client = new OpenAIClient(apiKey, options?.model || "gpt-4");
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\nUser: ${prompt}` : prompt;
    const response = await client.complete(fullPrompt, { temperature: options?.temperature });
    return response.text;
  }
  
  // Fallback to Ollama
  return ollamaComplete(prompt);
}

export class AILLMTools {
  OpenAI = OpenAIClient;
  
  summarize = summarizeText;
  translate = translateText;
  keyPoints = extractKeyPoints;
  fixGrammar = fixGrammar;
  
  generateImage = generateImage;
  
  ollamaComplete = ollamaComplete;
  ollamaEmbed = ollamaEmbed;
  listOllamaModels = listOllamaModels;
  
  transcribe = transcribeAudio;
  
  chat = chatComplete;
}
