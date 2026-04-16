# Gateway Latency Benchmarks

Measures six dimensions of the running gateway: WS connection time, message round-trip, HTTP endpoint latency, auth flow, task dispatch, and sustained throughput.

## Prerequisites

The gateway must be running before you start.

```bash
# Start the gateway (from repo root)
node dist/index.js
# or in dev mode:
cd packages/gateway && npm run dev
```

## Run

```bash
# From repo root — uses ts-node ESM loader
node --loader ts-node/esm packages/gateway/tests/benchmarks/latency.ts

# Or with tsx (faster)
npx tsx packages/gateway/tests/benchmarks/latency.ts
```

## Configuration (env vars)

| Variable              | Default   | Description                              |
|-----------------------|-----------|------------------------------------------|
| `WS_HOST`             | 127.0.0.1 | WebSocket host                           |
| `WS_PORT`             | 19800     | WebSocket port                           |
| `HTTP_HOST`           | 127.0.0.1 | Siri-bridge / HTTP host                  |
| `HTTP_PORT`           | 19801     | HTTP port                                |
| `BENCH_ITERATIONS`    | 50        | Samples per benchmark (affects p95/p99)  |
| `BENCH_THROUGHPUT_MSGS` | 200     | Messages fired in the throughput test    |
| `BENCH_TIMEOUT_MS`    | 5000      | Per-message response timeout (ms)        |

```bash
# Example: more samples, custom port
BENCH_ITERATIONS=100 WS_PORT=19800 npx tsx packages/gateway/tests/benchmarks/latency.ts
```

## Output

Results are printed as a table and saved to `tests/benchmarks/results.json`.

```
  Name                                  |  n | min   | mean  | p50   | p95   | p99   | max   | unit
  WS connection time                    | 50 | 0.812 | 1.243 | 1.102 | 2.341 | 3.012 | 4.521 | ms
  WS message round-trip (status.query)  | 50 | 0.201 | 0.387 | 0.341 | 0.812 | 1.203 | 1.891 | ms
  HTTP GET /health                      | 50 | 0.512 | 0.741 | 0.689 | 1.312 | 1.802 | 2.103 | ms
  ...
```

`results.json` schema:

```jsonc
{
  "runAt": "2026-04-15T16:30:00.000Z",
  "gateway": { "ws": "ws://127.0.0.1:19800", "http": "http://127.0.0.1:19801" },
  "config": { "iterations": 50, "throughputMsgs": 200 },
  "results": [ { "name": "...", "unit": "ms", "iterations": 50, "min": 0, "mean": 0, "p50": 0, "p95": 0, "p99": 0, "max": 0 } ],
  "errors": []
}
```
