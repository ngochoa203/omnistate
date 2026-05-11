/**
 * Media Processing Tools — Image optimization, video compression, audio processing.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";

const execAsync = promisify(exec);

// Image Processing
export async function resizeImage(input: string, output: string, width: number, height?: number): Promise<boolean> { try { const h = height ? `-resize ${width}x${height}` : `-resize ${width}`; await execAsync(`convert "${input}" ${h} "${output}" 2>/dev/null || sips -z ${height || width} ${width} "${input}" --out "${output}" 2>/dev/null`); return true; } catch { return false; } }
export async function compressImage(input: string, output: string, quality = 80): Promise<boolean> { try { await execAsync(`convert "${input}" -quality ${quality} "${output}" 2>/dev/null`); return true; } catch { return false; } }
export async function getImageInfo(filePath: string): Promise<{ width: number; height: number; format: string; size: number }> { try { const stat = await fs.promises.stat(filePath); const { stdout } = await execAsync(`sips -g pixelHeight -g pixelWidth -g format "${filePath}" 2>/dev/null || echo ""`, { encoding: "utf-8" }); return { width: parseInt(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] || "0", 10), height: parseInt(stdout.match(/pixelHeight:\s*(\d+)/)?.[1] || "0", 10), format: stdout.match(/format:\s*(\S+)/)?.[1] || "unknown", size: stat.size }; } catch { return { width: 0, height: 0, format: "", size: 0 }; } }
export async function createThumbnail(input: string, output: string, size = 200): Promise<boolean> { try { await execAsync(`convert "${input}" -resize ${size}x${size}^ -gravity center -extent ${size}x${size} "${output}" 2>/dev/null`); return true; } catch { return false; } }

// Video Processing
export async function compressVideo(input: string, output: string, codec = "libx264", crf = 23): Promise<boolean> { try { await execAsync(`ffmpeg -i "${input}" -c:v ${codec} -crf ${crf} "${output}" -y 2>/dev/null`); return true; } catch { return false; } }
export async function extractVideoThumbnail(video: string, output: string, timestamp = "00:00:01"): Promise<boolean> { try { await execAsync(`ffmpeg -i "${video}" -ss "${timestamp}" -vframes 1 "${output}" -y 2>/dev/null`); return true; } catch { return false; } }
export async function getVideoInfo(filePath: string): Promise<{ duration: number; width: number; height: number; codec: string }> { try { const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_streams "${filePath}" 2>/dev/null || echo "{}"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); const video = data.streams?.find((s: any) => s.codec_type === "video"); return { duration: parseFloat(data.format?.duration || "0"), width: video?.width || 0, height: video?.height || 0, codec: video?.codec_name || "" }; } catch { return { duration: 0, width: 0, height: 0, codec: "" }; } }
export async function trimVideo(input: string, output: string, start: string, end: string): Promise<boolean> { try { await execAsync(`ffmpeg -i "${input}" -ss "${start}" -to "${end}" -c copy "${output}" -y 2>/dev/null`); return true; } catch { return false; } }

// Audio Processing
export async function convertAudioFormat(input: string, output: string, format: "mp3" | "wav" | "aac" = "mp3"): Promise<boolean> { try { const codec = format === "mp3" ? "libmp3lame" : format === "aac" ? "aac" : ""; await execAsync(`ffmpeg -i "${input}" ${codec ? `-c:a ${codec}` : ""} "${output}" -y 2>/dev/null`); return true; } catch { return false; } }
export async function extractAudio(video: string, output: string): Promise<boolean> { try { await execAsync(`ffmpeg -i "${video}" -vn -c:a copy "${output}" -y 2>/dev/null`); return true; } catch { return false; } }
export async function normalizeAudio(input: string, output: string): Promise<boolean> { try { await execAsync(`ffmpeg -i "${input}" -af loudnorm=I=-16:TP=-1.5:LRA=11 "${output}" -y 2>/dev/null`); return true; } catch { return false; } }

export class MediaProcessingLayer { resizeImage = resizeImage; compressImage = compressImage; getImageInfo = getImageInfo; createThumbnail = createThumbnail; compressVideo = compressVideo; extractVideoThumbnail = extractVideoThumbnail; getVideoInfo = getVideoInfo; trimVideo = trimVideo; convertAudioFormat = convertAudioFormat; extractAudio = extractAudio; normalizeAudio = normalizeAudio; }
