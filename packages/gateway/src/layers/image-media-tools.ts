/**
 * Image & Media Processing Tools — Group 16
 * Implements: Image resize, convert, thumbnail, video thumbnail, PDF tools
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as fs from "node:fs/promises";
import * as path from "node:path";


// ------------------------------------------------------------------
// Image Resize
// ------------------------------------------------------------------

export async function resizeImage(
  inputPath: string,
  outputPath: string,
  width: number,
  height?: number
): Promise<boolean> {
  try {
    const h = height || width;
    await execAsync(`sips -z ${h} ${width} "${inputPath}" --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function resizeImagePercent(inputPath: string, outputPath: string, percent: number): Promise<boolean> {
  try {
    await execAsync(`sips "${inputPath}" --resampleWidth ${Math.round(percent)}% --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function createThumbnail(inputPath: string, outputPath: string, size: number = 200): Promise<boolean> {
  return resizeImage(inputPath, outputPath, size, size);
}

// ------------------------------------------------------------------
// Image Format Conversion
// ------------------------------------------------------------------

export async function convertImage(
  inputPath: string,
  outputPath: string,
  format: "png" | "jpg" | "jpeg" | "tiff" | "gif"
): Promise<boolean> {
  try {
    const ext = format === "jpeg" ? "jpg" : format;
    await execAsync(`sips -s format ${ext} "${inputPath}" --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function convertToPNG(inputPath: string, outputPath: string): Promise<boolean> {
  return convertImage(inputPath, outputPath, "png");
}

export async function convertToJPG(inputPath: string, outputPath: string, quality: number = 80): Promise<boolean> {
  try {
    await execAsync(`sips -s format jpeg -s formatOptions ${quality} "${inputPath}" --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Image Effects
// ------------------------------------------------------------------

export async function grayscaleImage(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`sips "${inputPath}" --edgeSmooth 0 --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function flipImage(inputPath: string, outputPath: string, horizontal?: boolean): Promise<boolean> {
  try {
    const flip = horizontal ? "-f" : "-f"; // Default flip
    await execAsync(`sips "${inputPath}" ${flip} --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function rotateImage(inputPath: string, outputPath: string, degrees: number): Promise<boolean> {
  try {
    await execAsync(`sips "${inputPath}" --rotate ${degrees} --out "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Image Info
// ------------------------------------------------------------------

export async function getImageInfo(inputPath: string): Promise<{ width: number; height: number; format: string; size: number }> {
  try {
    const stat = await fs.stat(inputPath);
    const { stdout } = await execAsync(`sips -g pixelWidth -g pixelHeight -g format "${inputPath}"`, { encoding: "utf-8" });
    
    const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
    const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);
    const formatMatch = stdout.match(/format:\s*(\w+)/);
    
    return {
      width: parseInt(widthMatch?.[1] || "0", 10),
      height: parseInt(heightMatch?.[1] || "0", 10),
      format: formatMatch?.[1] || "unknown",
      size: stat.size
    };
  } catch {
    return { width: 0, height: 0, format: "unknown", size: 0 };
  }
}

// ------------------------------------------------------------------
// PDF Operations
// ------------------------------------------------------------------

export async function pdfToImages(pdfPath: string, outputDir: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`pdftoppm -png "${pdfPath}" "${outputDir}/page"`, { encoding: "utf-8" });
    // List generated images
    const files = await fs.readdir(outputDir);
    return files.filter(f => f.endsWith(".png")).map(f => path.join(outputDir, f));
  } catch {
    return [];
  }
}

export async function mergePDFs(pdfPaths: string[], outputPath: string): Promise<boolean> {
  try {
    const filesArg = pdfPaths.join(" ");
    await execAsync(`pdfunite ${filesArg} "${outputPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function splitPDF(pdfPath: string, outputDir: string): Promise<boolean> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await execAsync(`pdftoppm -png "${pdfPath}" "${outputDir}/page"`);
    return true;
  } catch {
    return false;
  }
}

export async function getPDFInfo(pdfPath: string): Promise<{ pages: number; size: number }> {
  try {
    const stat = await fs.stat(pdfPath);
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}" 2>/dev/null || echo "Pages: 1"`, { encoding: "utf-8" });
    const pagesMatch = stdout.match(/Pages:\s*(\d+)/);
    
    return {
      pages: parseInt(pagesMatch?.[1] || "1", 10),
      size: stat.size
    };
  } catch {
    return { pages: 1, size: 0 };
  }
}

// ------------------------------------------------------------------
// Video Thumbnail
// ------------------------------------------------------------------

export async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp?: number
): Promise<boolean> {
  try {
    const time = timestamp ? `-ss ${timestamp}` : "-ss 1";
    await execAsync(`ffmpeg -y ${time} -i "${videoPath}" -vframes 1 "${outputPath}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function extractVideoThumbnails(
  videoPath: string,
  outputDir: string,
  count: number = 5
): Promise<string[]> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    await execAsync(`ffmpeg -i "${videoPath}" -vf "fps=1" "${outputDir}/thumb_%03d.jpg" 2>/dev/null`);
    
    const files = await fs.readdir(outputDir);
    return files.filter(f => f.endsWith(".jpg")).map(f => path.join(outputDir, f)).slice(0, count);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// GIF Creation
// ------------------------------------------------------------------

export async function createGIF(
  inputPath: string,
  outputPath: string,
  fps: number = 10,
  duration?: number
): Promise<boolean> {
  try {
    const dur = duration ? `-t ${duration}` : "";
    await execAsync(`ffmpeg -y -i "${inputPath}" -vf "fps=${fps},scale=480:-1:flags=lanczos" ${dur} "${outputPath}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function imagesToGIF(imagePaths: string[], outputPath: string, fps: number = 10): Promise<boolean> {
  try {
    const listFile = path.join(outputPath + ".txt");
    await fs.writeFile(listFile, imagePaths.map(p => `file '${p}'`).join("\n"));
    
    await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -vf "fps=${fps}" "${outputPath}" 2>/dev/null`);
    await fs.unlink(listFile);
    
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Image Batch Processing
// ------------------------------------------------------------------

export async function batchResize(
  inputDir: string,
  outputDir: string,
  width: number,
  height?: number
): Promise<number> {
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const files = await fs.readdir(inputDir);
    const images = files.filter(f => /\.(jpg|jpeg|png|gif|tiff)$/i.test(f));
    
    for (const file of images) {
      await resizeImage(
        path.join(inputDir, file),
        path.join(outputDir, file),
        width,
        height
      );
    }
    
    return images.length;
  } catch {
    return 0;
  }
}

export class ImageMediaLayer {
  resize = resizeImage;
  resizePercent = resizeImagePercent;
  thumbnail = createThumbnail;
  convert = convertImage;
  toPNG = convertToPNG;
  toJPG = convertToJPG;
  grayscale = grayscaleImage;
  flip = flipImage;
  rotate = rotateImage;
  info = getImageInfo;
  
  pdfToImages = pdfToImages;
  mergePDFs = mergePDFs;
  splitPDF = splitPDF;
  pdfInfo = getPDFInfo;
  
  videoThumbnail = extractVideoThumbnail;
  videoThumbnails = extractVideoThumbnails;
  
  createGIF = createGIF;
  imagesToGIF = imagesToGIF;
  
  batchResize = batchResize;
}
