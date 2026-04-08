export type {
  ClientMessage,
  ServerMessage,
  ClientRole,
  ConnectMessage,
  TaskMessage,
  ConnectedMessage,
  TaskAcceptedMessage,
  TaskStepMessage,
  TaskVerifyMessage,
  TaskCompleteMessage,
  TaskErrorMessage,
  HealthAlertMessage,
} from "../gateway/protocol.js";

export type { GatewayConfig } from "../config/schema.js";

export type {
  StateNode,
  StatePlan,
  TaskStatus,
  ExecutionLayer,
} from "./task.js";

export type { SessionEntry, SessionKey, TranscriptEntry } from "./session.js";

export type {
  PlatformScreen,
  PlatformInput,
  PlatformAccessibility,
} from "./platform.js";
