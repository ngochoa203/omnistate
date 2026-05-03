/**
 * Error classification utilities for the Orchestrator.
 */

/**
 * Classifies execution errors by type and severity.
 */
export function classifyExecutionError(error: unknown): {
  type: "timeout" | "permission" | "validation" | "layer" | "unknown";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  retryable: boolean;
} {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("timeout") || msg.includes("timed out")) {
      return {
        type: "timeout",
        severity: "medium",
        message: error.message,
        retryable: true,
      };
    }

    if (
      msg.includes("eperm") ||
      msg.includes("permission") ||
      msg.includes("accessibility") ||
      msg.includes("untrusted")
    ) {
      return {
        type: "permission",
        severity: "high",
        message: error.message,
        retryable: false,
      };
    }

    if (msg.includes("validation") || msg.includes("invalid")) {
      return {
        type: "validation",
        severity: "medium",
        message: error.message,
        retryable: false,
      };
    }

    if (
      msg.includes("layer") ||
      msg.includes("unsupported") ||
      msg.includes("unknown tool")
    ) {
      return {
        type: "layer",
        severity: "high",
        message: error.message,
        retryable: false,
      };
    }
  }

  return {
    type: "unknown",
    severity: "medium",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}
