import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { logger } from "../utils/logger.js";

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
}

const MODEL_DIR = join(homedir(), ".omnistate", "models", "all-MiniLM-L6-v2");
const DIMENSIONS = 384;

// ---------------------------------------------------------------------------
// TF-IDF bag-of-words fallback (character 3-gram hashing)
// ---------------------------------------------------------------------------

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

function tfidfHash(text: string, dims: number): Float32Array {
  const vec = new Float32Array(dims);
  const lower = text.toLowerCase();
  for (let i = 0; i + 2 < lower.length; i++) {
    const gram = lower.slice(i, i + 3);
    const idx = Math.abs(hashCode(gram)) % dims;
    vec[idx] += 1;
  }
  // L2-normalise
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) vec[i] /= norm;
  }
  return vec;
}

class TfidfEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;

  async embed(text: string): Promise<Float32Array> {
    return tfidfHash(text, this.dimensions);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => tfidfHash(t, this.dimensions));
  }
}

// ---------------------------------------------------------------------------
// ONNX provider (all-MiniLM-L6-v2)
// ---------------------------------------------------------------------------

class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;
  private session: unknown = null;

  private async init(): Promise<boolean> {
    if (this.session) return true;
    if (!existsSync(MODEL_DIR)) return false;

    const modelPath = join(MODEL_DIR, "model.onnx");
    const tokenizerPath = join(MODEL_DIR, "tokenizer.json");
    if (!existsSync(modelPath) || !existsSync(tokenizerPath)) return false;

    try {
      const ort = await import("onnxruntime-node");
      this.session = await ort.InferenceSession.create(modelPath);
      logger.info("[embeddings] Loaded ONNX model from " + modelPath);
      return true;
    } catch (err) {
      logger.warn({ err }, "[embeddings] Failed to load ONNX model, will use TF-IDF fallback");
      return false;
    }
  }

  async embed(text: string): Promise<Float32Array> {
    const ok = await this.init();
    if (!ok || !this.session) return tfidfHash(text, this.dimensions);

    try {
      // Simple whitespace tokenization (placeholder — real impl needs tokenizer)
      // If tokenizer.json is present, a full tokenizer lib is required.
      // For now fall back to TF-IDF until tokenizer library is wired.
      return tfidfHash(text, this.dimensions);
    } catch (err) {
      logger.warn({ err }, "[embeddings] ONNX inference failed, falling back to TF-IDF");
      return tfidfHash(text, this.dimensions);
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!_provider) {
    if (existsSync(MODEL_DIR)) {
      _provider = new OnnxEmbeddingProvider();
    } else {
      logger.debug("[embeddings] ONNX model dir not found, using TF-IDF fallback");
      _provider = new TfidfEmbeddingProvider();
    }
  }
  return _provider;
}

export { OnnxEmbeddingProvider };
