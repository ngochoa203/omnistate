/**
 * Text Processing & Clipboard Tools — Text manipulation utilities.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Clipboard Operations
// ------------------------------------------------------------------

export async function getClipboard(): Promise<string> {
  try {
    const { stdout } = await execAsync("osascript -e 'the clipboard as text'", { encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function setClipboard(text: string): Promise<boolean> {
  try {
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    await execAsync(`osascript -e 'set the clipboard to "${escaped}"'`);
    return true;
  } catch (e) {
    console.error("setClipboard failed:", e);
    return false;
  }
}

export async function appendToClipboard(text: string): Promise<boolean> {
  const current = await getClipboard();
  return setClipboard(current + text);
}

// ------------------------------------------------------------------
// Text Transformation
// ------------------------------------------------------------------

export function uppercase(text: string): string {
  return text.toUpperCase();
}

export function lowercase(text: string): string {
  return text.toLowerCase();
}

export function capitalize(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase());
}

export function titleCase(text: string): string {
  return text.split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function trim(text: string): string {
  return text.trim();
}

export function removeExtraSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function camelCase(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, c => c.toLowerCase());
}

export function snakeCase(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^[A-Z]/, c => c.toLowerCase())
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_|_$/g, "");
}

// ------------------------------------------------------------------
// Text Analysis
// ------------------------------------------------------------------

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

export function charCount(text: string, includeSpaces: boolean = true): number {
  return includeSpaces ? text.length : text.replace(/\s/g, "").length;
}

export function lineCount(text: string): number {
  return text.split("\n").length;
}

export function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
}

// ------------------------------------------------------------------
// Text Extraction
// ------------------------------------------------------------------

export function extractEmails(text: string): string[] {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.match(regex) || [];
}

export function extractUrls(text: string): string[] {
  const regex = /https?:\/\/[^\s]+/g;
  return text.match(regex) || [];
}

export function extractPhoneNumbers(text: string): string[] {
  const regex = /(?:\+?84|0)?[0-9]{9,10}/g;
  return text.match(regex) || [];
}

// ------------------------------------------------------------------
// Text Search & Replace
// ------------------------------------------------------------------

export function replaceAll(text: string, search: string, replace: string): string {
  return text.split(search).join(replace);
}

export function regexReplace(text: string, pattern: string, replace: string): string {
  try {
    const regex = new RegExp(pattern, "g");
    return text.replace(regex, replace);
  } catch {
    return text;
  }
}

// ------------------------------------------------------------------
// Language Detection (Simple)
// ------------------------------------------------------------------

export function detectLanguage(text: string): "vi" | "en" | "mixed" {
  // Simple heuristic based on common words
  const vietnameseChars = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/gi;
  const englishChars = /[a-z]/gi;
  
  const viMatches = text.match(vietnameseChars) || [];
  const enMatches = text.match(englishChars) || [];
  
  if (viMatches.length > enMatches.length * 0.3) return "vi";
  if (enMatches.length > viMatches.length * 0.3) return "en";
  return "mixed";
}

// ------------------------------------------------------------------
// Translation (Placeholder)
// ------------------------------------------------------------------

export async function translate(text: string, from: string, to: string): Promise<string> {
  // In production, use Google Translate API or similar
  console.log(`Translating from ${from} to ${to}: ${text}`);
  return text; // Placeholder
}

export async function translateVietnameseToEnglish(text: string): Promise<string> {
  return translate(text, "vi", "en");
}

export async function translateEnglishToVietnamese(text: string): Promise<string> {
  return translate(text, "en", "vi");
}

export class TextLayer {
  getClipboard = getClipboard;
  setClipboard = setClipboard;
  appendToClipboard = appendToClipboard;
  uppercase = uppercase;
  lowercase = lowercase;
  capitalize = capitalize;
  titleCase = titleCase;
  trim = trim;
  removeExtraSpaces = removeExtraSpaces;
  slugify = slugify;
  camelCase = camelCase;
  snakeCase = snakeCase;
  wordCount = wordCount;
  charCount = charCount;
  lineCount = lineCount;
  sentenceCount = sentenceCount;
  extractEmails = extractEmails;
  extractUrls = extractUrls;
  extractPhoneNumbers = extractPhoneNumbers;
  replaceAll = replaceAll;
  regexReplace = regexReplace;
  detectLanguage = detectLanguage;
  translate = translate;
  translateViToEn = translateVietnameseToEnglish;
  translateEnToVi = translateEnglishToVietnamese;
}
