/**
 * Search & Indexing Tools — Advanced Layer (API 83)
 * Implements: Full-text search, indexing, fuzzy search, autocomplete
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface IndexedDocument {
  id: string;
  content: string;
  fields: Record<string, string>;
  metadata?: Record<string, any>;
  indexedAt: Date;
}

export interface SearchResult {
  id: string;
  score: number;
  highlights: string[];
  document: IndexedDocument;
}

interface Index {
  documents: Map<string, IndexedDocument>;
  invertedIndex: Map<string, Set<string>>;
}

const indexes = new Map<string, Index>();

export async function createIndex(name: string): Promise<void> {
  indexes.set(name, { documents: new Map(), invertedIndex: new Map() });
}

export async function indexDocument(
  indexName: string,
  doc: Omit<IndexedDocument, "indexedAt">
): Promise<void> {
  const index = indexes.get(indexName);
  if (!index) await createIndex(indexName);
  
  const fullDoc: IndexedDocument = { ...doc, indexedAt: new Date() };
  indexes.get(indexName)!.documents.set(doc.id, fullDoc);
  
  // Update inverted index
  const words = doc.content.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (!indexes.get(indexName)!.invertedIndex.has(word)) {
      indexes.get(indexName)!.invertedIndex.set(word, new Set());
    }
    indexes.get(indexName)!.invertedIndex.get(word)!.add(doc.id);
  }
}

export async function search(
  indexName: string,
  query: string,
  options?: { limit?: number; fuzzy?: boolean }
): Promise<SearchResult[]> {
  const index = indexes.get(indexName);
  if (!index) return [];
  
  const queryWords = query.toLowerCase().split(/\s+/);
  const scores = new Map<string, number>();
  
  for (const word of queryWords) {
    for (const [indexedWord, docIds] of index.invertedIndex.entries()) {
      const similarity = calculateSimilarity(word, indexedWord);
      if (similarity > 0.7 || (options?.fuzzy && similarity > 0.5)) {
        for (const docId of docIds) {
          scores.set(docId, (scores.get(docId) || 0) + similarity);
        }
      }
    }
  }
  
  const results: SearchResult[] = [];
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  
  for (const [docId, score] of sorted.slice(0, options?.limit || 10)) {
    const doc = index.documents.get(docId);
    if (doc) {
      results.push({
        id: docId,
        score,
        highlights: getHighlights(doc.content, queryWords),
        document: doc
      });
    }
  }
  
  return results;
}

function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  
  const alen = a.length, blen = b.length;
  const matrix = Array(alen + 1).fill(null).map(() => Array(blen + 1).fill(0));
  
  for (let i = 0; i <= alen; i++) matrix[i][0] = i;
  for (let j = 0; j <= blen; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= alen; i++) {
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  
  const distance = matrix[alen][blen];
  return 1 - distance / Math.max(alen, blen);
}

function getHighlights(content: string, queryWords: string[]): string[] {
  const highlights: string[] = [];
  const lower = content.toLowerCase();
  
  for (const word of queryWords) {
    const idx = lower.indexOf(word);
    if (idx >= 0) {
      highlights.push(content.slice(Math.max(0, idx - 30), idx + word.length + 30));
    }
  }
  
  return highlights;
}

export async function autocomplete(
  indexName: string,
  prefix: string,
  limit: number = 5
): Promise<string[]> {
  const index = indexes.get(indexName);
  if (!index) return [];
  
  const suggestions: string[] = [];
  const lowerPrefix = prefix.toLowerCase();
  
  for (const word of index.invertedIndex.keys()) {
    if (word.startsWith(lowerPrefix)) {
      suggestions.push(word);
      if (suggestions.length >= limit) break;
    }
  }
  
  return suggestions;
}

export class SearchIndexingLayer {
  createIndex = createIndex;
  indexDocument = indexDocument;
  search = search;
  autocomplete = autocomplete;
}
