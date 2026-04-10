/** Messages sent from client to gateway. */
export type ClientMessage =
  | ConnectMessage
  | TaskMessage
  | HistoryQueryMessage
  | HealthQueryMessage
  | StatusQueryMessage;

export interface ConnectMessage {
  type: "connect";
  auth: { token?: string };
  role: "cli" | "ui" | "remote" | "fleet-agent";
}

export interface TaskMessage {
  type: "task";
  goal: string;
  layer?: "deep" | "surface" | "auto";
}

export interface HistoryQueryMessage {
  type: "history.query";
  limit?: number;
  before?: string;
}

export interface HealthQueryMessage {
  type: "health.query";
}

export interface StatusQueryMessage {
  type: "status.query";
}

/** Messages sent from gateway to client. */
export type ServerMessage =
  | ConnectedMessage
  | TaskAcceptedMessage
  | TaskStepMessage
  | TaskVerifyMessage
  | TaskCompleteMessage
  | TaskErrorMessage
  | HistoryResultMessage
  | HealthReportMessage
  | StatusReplyMessage
  | GatewayShutdownMessage
  | ErrorMessage;

export interface ConnectedMessage { type: "connected"; clientId: string; capabilities: string[] }
export interface TaskAcceptedMessage { type: "task.accepted"; taskId: string; goal: string }
export interface TaskStepMessage { type: "task.step"; taskId: string; step: number; status: "executing" | "completed" | "failed"; layer: "deep" | "surface" | "fleet"; data?: Record<string, unknown> }
export interface TaskVerifyMessage { type: "task.verify"; taskId: string; step: number; result: "pass" | "fail" | "ambiguous"; confidence?: number }
export interface TaskCompleteMessage { type: "task.complete"; taskId: string; result: Record<string, unknown> }
export interface TaskErrorMessage { type: "task.error"; taskId: string; error: string }
export interface HistoryResultMessage { type: "history.result"; entries: HistoryEntry[] }
export interface HealthReportMessage { type: "health.report"; overall: string; timestamp: string; sensors: Record<string, SensorResult>; alerts: Alert[] }
export interface StatusReplyMessage { type: "status.reply"; connectedClients: number; queueDepth: number; uptime: number }
export interface GatewayShutdownMessage { type: "gateway.shutdown"; reason: string }
export interface ErrorMessage { type: "error"; message: string }

export interface HistoryEntry {
  taskId: string;
  goal: string;
  status: "complete" | "failed";
  output?: string;
  intentType: string;
  timestamp: string;
  durationMs: number;
}

export interface SensorResult {
  status: string;
  value: number;
  unit: string;
  message?: string;
}

export interface Alert {
  sensor: string;
  severity: string;
  message: string;
}
