/**
 * File Orchestrator — AI-powered file operations.
 *
 * "Tìm tất cả ảnh có mặt mèo trong thư mục Downloads và chuyển sang folder 'Pets'"
 *
 * Steps:
 * 1. List all image files in source directory
 * 2. For each image, use Vision framework to classify
 * 3. Filter images containing cats
 * 4. Create destination folder if needed
 * 5. Move matching files to destination
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, renameSync, cpSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

export interface ImageFile {
  path: string;
  name: string;
  extension: string;
  size: number;
}

export interface ClassifiedImage {
  file: ImageFile;
  hasCat: boolean;
  confidence: number;
  labels: string[];
}

export interface MoveResult {
  source: string;
  destination: string;
  success: boolean;
  error?: string;
}

// ------------------------------------------------------------------
// File Discovery
// ------------------------------------------------------------------

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".heic", ".webp", ".bmp", ".tiff"];

/**
 * List all image files in a directory (non-recursive).
 */
export async function listImageFiles(directory: string): Promise<ImageFile[]> {
  try {
    const extConditions = IMAGE_EXTENSIONS.map(e => `-name "*${e}"`).join(" -o ");
    const { stdout } = await execAsync(
      `find "${directory}" -maxdepth 1 -type f \\( ${extConditions} \\) -print 2>/dev/null`,
      { encoding: "utf-8" }
    );

    if (!stdout.trim()) return [];

    const files: ImageFile[] = [];
    for (const line of stdout.split("\n").filter(Boolean)) {
      const name = line.split("/").pop() || "";
      const extMatch = name.match(/\.([^.]+)$/);
      const ext = extMatch ? `.${extMatch[1]!.toLowerCase()}` : "";

      let size = 0;
      try {
        const statResult = await execAsync(
          `stat -f "%z" "${line}" 2>/dev/null || stat -c "%s" "${line}"`,
          { encoding: "utf-8" }
        );
        const sizeMatch = statResult.stdout.match(/(\d+)/);
        size = sizeMatch ? parseInt(sizeMatch[1]!, 10) : 0;
      } catch {
        // ignore stat errors
      }

      files.push({ path: line, name, extension: ext, size });
    }

    return files;
  } catch {
    return [];
  }
}

/**
 * Check if Vision framework can detect cats in an image using macOS.
 * Falls back to simple string matching if Vision fails.
 */
export async function classifyImageForCat(imagePath: string): Promise<{
  hasCat: boolean;
  confidence: number;
  labels: string[];
}> {
  // Try Vision framework first (macOS only)
  try {
    const escapedPath = imagePath.replace(/"/g, '\\"');
    const jxaScript = `
      try {
        ObjC.import('Vision');
        ObjC.import('Cocoa');

        const imagePath = "${escapedPath}";
        const imageData = $.NSData.dataWithContentsOfFile($.NSString.stringWithString(imagePath));
        if (!imageData) return "ERROR:no_data";

        const image = $.NSImage.alloc.initWithData(imageData);
        const cgImage = image.CGImageForProposedRect(null, null, null);
        if (!cgImage) return "ERROR:no_cgimage";

        let resultLabels = [];
        let hasCat = false;
        let maxConf = 0;

        const handler = function(request, error) {
          if (error || !request.results) return;
          const observations = request.results;
          for (let i = 0; i < observations.count; i++) {
            const obs = observations.objectAtIndex(i);
            const labels = obs.labels;
            for (let j = 0; j < labels.count; j++) {
              const label = labels.objectAtIndex(j);
              const identifier = String(label.identifier).toLowerCase();
              const confidence = label.confidence;

              resultLabels.push(identifier);
              if (identifier.includes("cat") || identifier.includes("kitten") || identifier.includes("felid")) {
                hasCat = true;
                maxConf = Math.max(maxConf, confidence);
              }
            }
          }
        };

        const request = $.VNClassifyImageRequest.alloc.initWithCompletionHandler(handler);
        const handlerInstance = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cgImage, null);
        handlerInstance.performRequestsError([request], null);

        return JSON.stringify({ hasCat: hasCat, confidence: maxConf, labels: resultLabels });
      } catch(e) {
        return "ERROR:" + e.message;
      }
    `;

    const { stdout } = await execAsync(
      `osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\"'\"'")}'`,
      { timeout: 15000 }
    );

    if (stdout.startsWith("ERROR:")) {
      throw new Error(stdout.slice(6));
    }

    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        return {
          hasCat: parsed.hasCat || false,
          confidence: parsed.confidence || 0,
          labels: Array.isArray(parsed.labels) ? parsed.labels : []
        };
      } catch {
        // JSON parse failed, fall through to fallback
      }
    }
  } catch {
    // Vision failed, will use fallback
  }

  // Fallback: Check EXIF/metadata for keywords
  try {
    const { stdout: metadata } = await execAsync(
      `mdls "${imagePath}" 2>/dev/null || strings "${imagePath}" | head -50`,
      { encoding: "utf-8" }
    );
    const lowerMeta = metadata.toLowerCase();
    const hasCat = lowerMeta.includes("cat") || lowerMeta.includes("kitten") ||
                   lowerMeta.includes("mèo") || lowerMeta.includes("meo");
    return { hasCat, confidence: hasCat ? 0.3 : 0, labels: hasCat ? ["cat_metadata"] : [] };
  } catch {
    return { hasCat: false, confidence: 0, labels: [] };
  }
}

// ------------------------------------------------------------------
// File Operations
// ------------------------------------------------------------------

/**
 * Ensure directory exists.
 */
export function ensureDirectory(path: string): boolean {
  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a file to destination directory.
 */
export function moveFile(sourcePath: string, destinationDir: string): MoveResult {
  try {
    const fileName = sourcePath.split("/").pop() || "";
    let destPath = join(destinationDir, fileName);

    // Check if destination exists - add suffix to avoid overwrite
    if (existsSync(destPath)) {
      const extMatch = fileName.match(/^([^.]+)(\..+)$/);
      const baseName = extMatch ? extMatch[1]! : fileName;
      const ext = extMatch ? extMatch[2]! : "";
      const timestamp = Date.now();
      const newName = `${baseName}_${timestamp}${ext}`;
      destPath = join(destinationDir, newName);
    }

    renameSync(sourcePath, destPath);
    return { source: sourcePath, destination: destPath, success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { source: sourcePath, destination: destinationDir, success: false, error };
  }
}

// ------------------------------------------------------------------
// Orchestrator
// ------------------------------------------------------------------

export interface FindAndMoveOptions {
  sourceDir: string;
  destinationDir: string;
  filter?: "cat" | "dog" | "all";
  minConfidence?: number;
  recursive?: boolean;
  dryRun?: boolean;
}

export interface FindAndMoveResult {
  totalFiles: number;
  classifiedFiles: number;
  matchedFiles: string[];
  movedFiles: string[];
  skippedFiles: string[];
  errors: string[];
}

/**
 * Find images matching criteria and move to destination.
 *
 * Example: Find cat images in ~/Downloads and move to ~/Pictures/Pets
 */
export async function findAndMoveImages(
  options: FindAndMoveOptions
): Promise<FindAndMoveResult> {
  const {
    sourceDir,
    destinationDir,
    filter = "all",
    minConfidence = 0.5,
    dryRun = false
  } = options;

  const result: FindAndMoveResult = {
    totalFiles: 0,
    classifiedFiles: 0,
    matchedFiles: [],
    movedFiles: [],
    skippedFiles: [],
    errors: []
  };

  // List images
  const images = await listImageFiles(sourceDir);
  result.totalFiles = images.length;

  if (images.length === 0) {
    return result;
  }

  // Ensure destination exists (unless dry run)
  if (!dryRun) {
    if (!ensureDirectory(destinationDir)) {
      result.errors.push(`Failed to create destination: ${destinationDir}`);
      return result;
    }
  }

  // Classify each image
  for (const image of images) {
    try {
      const classification = await classifyImageForCat(image.path);
      result.classifiedFiles++;

      // Check if matches filter
      let matches = false;
      if (filter === "all") {
        matches = true;
      } else if (filter === "cat") {
        matches = classification.hasCat && classification.confidence >= minConfidence;
      } else if (filter === "dog") {
        matches = classification.labels.some(l =>
          l.toLowerCase().includes("dog") ||
          l.toLowerCase().includes("puppy") ||
          l.toLowerCase().includes("canine")
        );
      }

      if (matches) {
        result.matchedFiles.push(image.path);

        if (!dryRun) {
          const moveResult = moveFile(image.path, destinationDir);
          if (moveResult.success) {
            result.movedFiles.push(moveResult.destination);
          } else if (moveResult.error) {
            result.errors.push(`Failed to move ${image.name}: ${moveResult.error}`);
          }
        }
      } else {
        result.skippedFiles.push(image.path);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to classify ${image.name}: ${error}`);
    }
  }

  return result;
}

// ------------------------------------------------------------------
// Quick helpers
// ------------------------------------------------------------------

/**
 * Find and move cat images from Downloads to Pets folder.
 */
export async function moveCatImagesToPets(): Promise<FindAndMoveResult> {
  const homeDir = process.env.HOME || "/Users/ngochoa";
  return findAndMoveImages({
    sourceDir: `${homeDir}/Downloads`,
    destinationDir: `${homeDir}/Pictures/Pets`,
    filter: "cat",
    minConfidence: 0.4
  });
}

/**
 * Find all images of any type in a directory.
 */
export async function findAllImages(directory: string): Promise<ImageFile[]> {
  return listImageFiles(directory);
}

// ------------------------------------------------------------------
// Semantic Search
// ------------------------------------------------------------------

/**
 * Search files using semantic/AI content analysis.
 * Uses Vision framework + AI to find files matching a text query.
 */
export async function searchFilesBySemanticContent(
  directory: string,
  query: string,
  options: {
    fileType?: "image" | "video" | "all";
    maxResults?: number;
    minConfidence?: number;
  } = {}
): Promise<Array<{ path: string; name: string; relevance: number; matchReason: string }>> {
  const { fileType = "all", maxResults = 50, minConfidence = 0.3 } = options;

  // List files based on type
  let files = fileType === "image" || fileType === "all"
    ? await listImageFiles(directory)
    : [];

  const results: Array<{ path: string; name: string; relevance: number; matchReason: string }> = [];

  for (const file of files.slice(0, maxResults)) {
    const classification = await classifyImageForCat(file.path);

    // Simple keyword matching for now (replace with AI embedding in production)
    const queryLower = query.toLowerCase();
    const catKeywords = ["cat", "mèo", "kitten", "feline", "pussy", "nya"];
    const dogKeywords = ["dog", "chó", "puppy", "canine", "pupper"];

    let relevance = 0;
    let matchReason = "";

    if (catKeywords.some(k => queryLower.includes(k))) {
      if (classification.hasCat) {
        relevance = classification.confidence;
        matchReason = `Cat detected (${(relevance * 100).toFixed(0)}%)`;
      }
    }
    if (dogKeywords.some(k => queryLower.includes(k))) {
      if (classification.labels.some(l => l.includes("dog"))) {
        relevance = 0.8;
        matchReason = "Dog detected";
      }
    }

    // Generic image query - return all images if query is generic
    if (queryLower.includes("image") || queryLower.includes("photo") || queryLower.includes("picture")) {
      relevance = 0.5;
      matchReason = "Image file";
    }

    if (relevance >= minConfidence) {
      results.push({ path: file.path, name: file.name, relevance, matchReason });
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance);
}

// ------------------------------------------------------------------
// Directory & Batch File Operations
// ------------------------------------------------------------------

/**
 * Create a directory with all parent directories.
 */
export function createDirectory(path: string): { success: boolean; path: string; error?: string } {
  try {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
    return { success: true, path };
  } catch (err: unknown) {
    return { success: false, path, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Move multiple files to a destination directory.
 * Returns results for each file.
 */
export function moveFiles(
  sourceFiles: string[],
  destinationDir: string
): Array<{ source: string; destination: string; success: boolean; error?: string }> {
  // Ensure destination exists
  createDirectory(destinationDir);

  return sourceFiles.map(source => {
    return moveFile(source, destinationDir);
  });
}

/**
 * Copy files to destination.
 */
export function copyFiles(
  sourceFiles: string[],
  destinationDir: string
): Array<{ source: string; destination: string; success: boolean; error?: string }> {
  createDirectory(destinationDir);

  return sourceFiles.map(source => {
    try {
      const fileName = source.split("/").pop() || "";
      let destPath = join(destinationDir, fileName);

      if (existsSync(destPath)) {
        const extMatch = fileName.match(/^([^.]+)(\..+)$/);
        const baseName = extMatch ? extMatch[1]! : fileName;
        const ext = extMatch ? extMatch[2]! : "";
        destPath = join(destinationDir, `${baseName}_copy_${Date.now()}${ext}`);
      }

      cpSync(source, destPath);
      return { source, destination: destPath, success: true };
    } catch (err: unknown) {
      return { source, destination: destinationDir, success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}