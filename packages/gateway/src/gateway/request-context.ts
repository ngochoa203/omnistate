import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../utils/logger.js";

export function resolveRequestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return randomUUID();
}

export function applyRequestId(req: IncomingMessage, res: ServerResponse): string {
  const reqId = resolveRequestId(req);
  res.setHeader("X-Request-Id", reqId);
  return reqId;
}

export function childLogger(reqId: string) {
  return logger.child({ reqId });
}
