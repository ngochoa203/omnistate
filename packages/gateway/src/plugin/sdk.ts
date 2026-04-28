/**
 * Plugin SDK — the API surface that plugins use to register
 * capabilities with the OmniState gateway.
 */

import type { PermissionGuard } from "./permission.js";

export interface OmniStatePluginAPI {
  /** Register a new tool (capability). */
  registerTool(
    name: string,
    definition: ToolDefinition
  ): void;

  /** Register a health sensor. */
  registerHealthSensor(
    name: string,
    sensor: HealthSensorDefinition
  ): void;

  /** Register a verification strategy. */
  registerVerification(
    name: string,
    strategy: VerificationDefinition
  ): void;

  /** Access the deep layer for OS operations. */
  readonly deep: DeepLayerAccess;

  /** Access the surface layer for UI operations. */
  readonly surface: SurfaceLayerAccess;

  /** Access the vision engine. */
  readonly vision: VisionAccess;
}

export interface ToolDefinition {
  description: string;
  params: Record<string, ParamSpec>;
  execute(
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult>;
}

export interface ParamSpec {
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
  items?: string;
}

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  screenshot?: Buffer;
}

export interface HealthSensorDefinition {
  interval: number;
  check(context: ExecutionContext): Promise<{
    status: "ok" | "warning" | "critical";
    message: string;
  }>;
}

export interface VerificationDefinition {
  verify(
    context: ExecutionContext,
    expected: string
  ): Promise<{ passed: boolean; confidence: number }>;
}

export interface ExecutionContext {
  taskId: string;
  sessionId: string;
  platform: "macos" | "windows" | "linux";
}

export interface DeepLayerAccess {
  exec(command: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  isProcessRunning(name: string): Promise<boolean>;
}

export interface SurfaceLayerAccess {
  capture(): Promise<Buffer>;
  findElement(
    screenshot: Buffer,
    description: string
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;
  click(target: { x: number; y: number }): Promise<void>;
  type(text: string): Promise<void>;
  waitFor(condition: string, options: { timeout: number }): Promise<boolean>;
  pressKey(key: string): Promise<void>;
}

export interface VisionAccess {
  verify(screenshot: Buffer, expected: string): Promise<boolean>;
  detectElements(
    screenshot: Buffer,
    query: string
  ): Promise<Array<{ x: number; y: number; width: number; height: number; text?: string }>>;
}

/**
 * Create a permission-wrapped plugin API.
 * Used by PluginRegistry when loading sandboxed plugins.
 */
export function createGuardedApi(
  base: OmniStatePluginAPI,
  guard: PermissionGuard
): OmniStatePluginAPI {
  return guard.wrapApi(base);
}
