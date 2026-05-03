// server-types.ts — interfaces and types extracted from server.ts
import type { ClientRole } from "./protocol.js";
import type { WebSocket } from "ws";

export interface ConnectedClient {
  ws: WebSocket;
  id: string;
  role: ClientRole;
  authenticatedAt: number;
  userId: string | null;
  /** Set when the connection authenticated via a device JWT (type: "device"). */
  deviceId?: string | null;
}

export type KnownAudioFormat = "wav" | "webm" | "ogg" | "mp3" | "unknown";

/**
 * Minimal interface covering all OmniStateGateway members used by server-handlers.ts.
 * Avoids circular import between server.ts and server-handlers.ts.
 */
export interface GatewayRef {
  clients: Map<string, ConnectedClient>;
  wakeManager: { isRunning(): boolean; start(opts: unknown): void; stop(): void };
  eventBus: { getRecent(opts: { limit?: number; type?: string; since?: number }): unknown[] };
  ruleEngine: {
    listRules(): unknown[];
    addRule(opts: { name: string; eventPattern: string; condition?: string; action: unknown; enabled: boolean }): unknown;
    toggleRule(id: string, enabled: boolean): unknown;
  };
  broadcast(msg: unknown): void;
  orchestrator: { approvalEngine?: unknown; permissionResponder?: unknown };
  monitor: unknown;
  config: { approvalPolicy?: unknown };
  claudeMemStore: { loadState(): { payload: string; updatedAt: number }; saveState(payload: unknown): { payload: string; updatedAt: number } };
  memoryRepository: { upsert(msg: unknown): unknown; query(msg: unknown): unknown; delete(msg: unknown): boolean };
  eventRepository: { ingest(msg: unknown): unknown; query(msg: unknown): unknown; get(id: string): unknown };
  streamManager: {
    handleBinaryFrame(sessionId: string, data: Buffer, cb: (msg: unknown) => void): void;
    handleControlMessage(sessionId: string, msg: unknown, cb: (msg: unknown) => void): void;
    dropSession(sessionId: string): void;
  };
  triggerEngine: {
    createTrigger(userId: string, opts: unknown): unknown;
    listTriggers(userId: string): unknown[];
    updateTrigger(id: string, updates: unknown): unknown;
    deleteTrigger(id: string): void;
    getTriggerHistory(id: string, limit?: number): unknown[];
    evaluateEvent(event: unknown): Promise<void>;
  };
  claudeCodeResponder?: {
    getHistory(): unknown[];
    isRunning: boolean;
    start(): void;
    stop(): Promise<void>;
  };
  approvalEngine?: unknown;
  safeSend(ws: WebSocket, msg: unknown): void;
  handleMessage(clientId: string, ws: WebSocket, msg: unknown, remoteIp?: string, isLocalhost?: boolean): Promise<void>;
  executeTaskPipeline(taskId: string, goal: string, layerHint: string | undefined, ws?: WebSocket): Promise<void>;
  buildGoalWithAttachments(goal: string, attachments?: unknown[]): string;
  clearTaskHistory(): number;
  startedAt: number;
  taskHistory: unknown[];
  shouldRefreshWakeListener(goal: string): boolean;
  startWakeListener(): void;
  shouldUseChatMode(goal: string): Promise<boolean>;
  unwrapUserGoal(goal: string): string;
  fallbackUserFacingOutput(goal: string, intentType: string): string | undefined;
}