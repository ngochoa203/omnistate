/**
 * Validation Tools — Advanced Layer (API 81)
 * Implements: Input validation, sanitization, schema validation, rule engine
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface ValidationRule {
  field: string;
  rules: ((value: any) => boolean | string)[];
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
}

const validators = {
  required: (v: any) => v !== undefined && v !== null && v !== "",
  email: (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  url: (v: string) => /^https?:\/\/.+/.test(v),
  min: (v: number, min: number) => v >= min,
  max: (v: number, max: number) => v <= max,
  minLength: (v: string, len: number) => v.length >= len,
  maxLength: (v: string, len: number) => v.length <= len,
  pattern: (v: string, pattern: string) => new RegExp(pattern).test(v),
  oneOf: (v: any, options: any[]) => options.includes(v)
};

export async function validate(
  data: Record<string, any>,
  rules: ValidationRule[]
): Promise<ValidationResult> {
  const errors: ValidationResult["errors"] = [];
  const warnings: ValidationResult["warnings"] = [];
  
  for (const rule of rules) {
    const value = data[rule.field];
    
    for (const validator of rule.rules) {
      const result = validator(value);
      if (result === false) {
        errors.push({ field: rule.field, message: rule.message || `Validation failed for ${rule.field}` });
      } else if (typeof result === "string") {
        warnings.push({ field: rule.field, message: result });
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}

export async function sanitize(data: any, rules?: Record<string, string[]>): Promise<any> {
  if (typeof data !== "object" || data === null) return data;
  
  const sanitized: any = Array.isArray(data) ? [] : {};
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      let clean = value.trim();
      const keyRules = rules?.[key] || [];
      
      if (keyRules.includes("html")) clean = clean.replace(/<[^>]*>/g, "");
      if (keyRules.includes("sql")) clean = clean.replace(/['";]/g, "");
      if (keyRules.includes("escape")) clean = clean.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", "\"": "&quot;" })[c] || c);
      
      sanitized[key] = clean;
    } else if (typeof value === "object") {
      sanitized[key] = await sanitize(value, rules);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export class ValidationLayer {
  validate = validate;
  sanitize = sanitize;
  validators = validators;
}
