import { logger } from "../utils/logger.js";

export class CircuitOpenError extends Error {
  constructor(providerId: string) {
    super(`Circuit breaker OPEN for provider '${providerId}' — too many recent failures`);
    this.name = "CircuitOpenError";
  }
}

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

const FAILURE_THRESHOLD = 3;
const WINDOW_MS = 30_000;
const RECOVERY_MS = 30_000;

interface BreakerState {
  state: State;
  failures: number[];  // timestamps of recent failures
  openedAt: number;
}

const breakers = new Map<string, BreakerState>();

function getBreaker(providerId: string): BreakerState {
  if (!breakers.has(providerId)) {
    breakers.set(providerId, { state: "CLOSED", failures: [], openedAt: 0 });
  }
  return breakers.get(providerId)!;
}

export function checkCircuit(providerId: string): void {
  const b = getBreaker(providerId);
  const now = Date.now();

  if (b.state === "OPEN") {
    if (now - b.openedAt >= RECOVERY_MS) {
      b.state = "HALF_OPEN";
      logger.info({ providerId }, "circuit breaker HALF_OPEN — probing");
    } else {
      throw new CircuitOpenError(providerId);
    }
  }
}

export function recordSuccess(providerId: string): void {
  const b = getBreaker(providerId);
  b.failures = [];
  if (b.state === "HALF_OPEN") {
    b.state = "CLOSED";
    logger.info({ providerId }, "circuit breaker CLOSED after successful probe");
  }
}

export function recordFailure(providerId: string): void {
  const b = getBreaker(providerId);
  const now = Date.now();

  // Prune failures outside the window
  b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
  b.failures.push(now);

  if (b.state === "HALF_OPEN" || b.failures.length >= FAILURE_THRESHOLD) {
    b.state = "OPEN";
    b.openedAt = now;
    logger.error({ providerId, failures: b.failures.length }, "circuit breaker OPEN");
  }
}
