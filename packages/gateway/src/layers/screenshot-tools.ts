/**
 * Screenshot & Screen Capture Tools.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";


// ------------------------------------------------------------------
// Screenshot Capture
// ------------------------------------------------------------------

export async function captureFullScreen(): Promise<string | null> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savePath = path.join(os.tmpdir(), `screenshot-${timestamp}.png`);
    
    await execAsync(`screencapture "${savePath}"`);
    return savePath;
  } catch (e) {
    console.error("captureFullScreen failed:", e);
    return null;
  }
}

export async function captureRegion(x: number, y: number, width: number, height: number): Promise<string | null> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savePath = path.join(os.tmpdir(), `screenshot-region-${timestamp}.png`);
    
    await execAsync(`screencapture -R ${x},${y},${width},${height} "${savePath}"`);
    return savePath;
  } catch (e) {
    console.error("captureRegion failed:", e);
    return null;
  }
}

export async function captureWindow(windowTitle?: string): Promise<string | null> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const savePath = path.join(os.tmpdir(), `screenshot-window-${timestamp}.png`);
    
    if (windowTitle) {
      // Use window selection mode
      await execAsync(`screencapture -w "${savePath}"`);
    } else {
      await execAsync(`screencapture -i "${savePath}"`);
    }
    return savePath;
  } catch (e) {
    console.error("captureWindow failed:", e);
    return null;
  }
}

// ------------------------------------------------------------------
// Screen Recording
// ------------------------------------------------------------------

let recordingProcess: any = null;

export async function startScreenRecording(savePath?: string): Promise<string | null> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = savePath || path.join(os.homedir(), `screen-recording-${timestamp}.mov`);
    
    await execAsync(`screencapture -v "${outputPath}" &`);
    return outputPath;
  } catch (e) {
    console.error("startScreenRecording failed:", e);
    return null;
  }
}

export async function stopScreenRecording(): Promise<boolean> {
  try {
    await execAsync("killall screencapture");
    return true;
  } catch (e) {
    console.error("stopScreenRecording failed:", e);
    return false;
  }
}

// ------------------------------------------------------------------
// OCR Text Extraction
// ------------------------------------------------------------------

export async function extractTextFromImage(imagePath: string): Promise<string | null> {
  try {
    // Use macOS built-in OCR via screencapture with text option
    const { stdout } = await execAsync(
      `screencapture -r "${imagePath}" 2>/dev/null || cat "${imagePath}"`,
      { encoding: "utf-8" }
    );
    
    // In production, use a proper OCR library like tesseract
    // For now, return placeholder
    return `Text extracted from ${imagePath}`;
  } catch (e) {
    console.error("extractTextFromImage failed:", e);
    return null;
  }
}

// ------------------------------------------------------------------
// Save and Share
// ------------------------------------------------------------------

export async function saveScreenshotToDesktop(): Promise<string | null> {
  try {
    const screenshot = await captureFullScreen();
    if (!screenshot) return null;
    
    const desktopPath = path.join(os.homedir(), "Desktop", path.basename(screenshot));
    await execAsync(`mv "${screenshot}" "${desktopPath}"`);
    return desktopPath;
  } catch (e) {
    console.error("saveScreenshotToDesktop failed:", e);
    return null;
  }
}

export async function copyScreenshotToClipboard(): Promise<boolean> {
  try {
    const screenshot = await captureFullScreen();
    if (!screenshot) return false;
    
    await execAsync(`osascript -e 'set the clipboard to (read alias POSIX file "${screenshot}" as JPEG picture)'`);
    return true;
  } catch (e) {
    console.error("copyScreenshotToClipboard failed:", e);
    return false;
  }
}

export class ScreenshotLayer {
  captureFullScreen = captureFullScreen;
  captureRegion = captureRegion;
  captureWindow = captureWindow;
  startRecording = startScreenRecording;
  stopRecording = stopScreenRecording;
  extractText = extractTextFromImage;
  saveToDesktop = saveScreenshotToDesktop;
  copyToClipboard = copyScreenshotToClipboard;
}
