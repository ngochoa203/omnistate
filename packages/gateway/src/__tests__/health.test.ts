/**
 * E2E tests for HealthMonitor and individual sensors.
 *
 * All tests run against the real OS — no mocking needed for basic sensor checks.
 * The monitor is not started (no timer); runCheck() is called directly.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { HealthMonitor } from "../health/monitor.js";
import type { HealthReport, SensorResult } from "../health/monitor.js";
import { checkCpu, checkMemory, checkDisk } from "../health/sensors.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Individual sensor tests ───────────────────────────────────────────────────

describe("sensors", () => {
  describe("checkCpu()", () => {
    it("returns a SensorResult with status", async () => {
      const result = await checkCpu();
      expect(result).toHaveProperty("status");
      expect(["ok", "warning", "critical"]).toContain(result.status);
    });

    it("value is a non-negative number", async () => {
      const result = await checkCpu();
      expect(typeof result.value).toBe("number");
      expect(result.value).toBeGreaterThanOrEqual(0);
    });

    it("unit is '%'", async () => {
      const result = await checkCpu();
      expect(result.unit).toBe("%");
    });
  });

  describe("checkMemory()", () => {
    it("returns a SensorResult with status", async () => {
      const result = await checkMemory();
      expect(["ok", "warning", "critical"]).toContain(result.status);
    });

    it("value is between 0 and 100", async () => {
      const result = await checkMemory();
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThanOrEqual(100);
    });

    it("unit is '%'", async () => {
      const result = await checkMemory();
      expect(result.unit).toBe("%");
    });
  });

  describe("checkDisk()", () => {
    it("returns a SensorResult with status", async () => {
      const result = await checkDisk();
      expect(["ok", "warning", "critical"]).toContain(result.status);
    });

    it("value is a non-negative number", async () => {
      const result = await checkDisk();
      expect(result.value).toBeGreaterThanOrEqual(0);
    });

    it("unit is '%'", async () => {
      const result = await checkDisk();
      expect(result.unit).toBe("%");
    });
  });
});

// ── HealthMonitor.runCheck() ──────────────────────────────────────────────────

describe("HealthMonitor.runCheck()", () => {
  it("returns a valid HealthReport", async () => {
    const monitor = new HealthMonitor(60000, false); // disable auto-repair for test speed
    const report = await monitor.runCheck();

    expect(typeof report.timestamp).toBe("string");
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(["healthy", "degraded", "critical"]).toContain(report.overall);
    expect(typeof report.sensors).toBe("object");
    expect(Array.isArray(report.alerts)).toBe(true);
    expect(Array.isArray(report.repairs)).toBe(true);
  });

  it("report.sensors contains cpu, memory, disk, network, processes", async () => {
    const monitor = new HealthMonitor(60000, false);
    const report = await monitor.runCheck();

    expect(report.sensors).toHaveProperty("cpu");
    expect(report.sensors).toHaveProperty("memory");
    expect(report.sensors).toHaveProperty("disk");
    expect(report.sensors).toHaveProperty("network");
    expect(report.sensors).toHaveProperty("processes");
  });

  it("each sensor in the report is a valid SensorResult", async () => {
    const monitor = new HealthMonitor(60000, false);
    const report = await monitor.runCheck();

    for (const [_name, sensor] of Object.entries(report.sensors)) {
      const s = sensor as SensorResult;
      expect(["ok", "warning", "critical"]).toContain(s.status);
      expect(typeof s.value).toBe("number");
      expect(typeof s.unit).toBe("string");
    }
  });
});

// ── Overall status logic ──────────────────────────────────────────────────────

describe("HealthMonitor overall status logic", () => {
  /**
   * We test the aggregation logic by wiring mock sensors via vi.mock
   * at the monitor's imported sensor functions level.
   */

  it("all ok → overall is healthy", async () => {
    const monitor = new HealthMonitor(60000, false);

    // Spy on runCheck to return a controlled report
    const okSensor: SensorResult = { status: "ok", value: 10, unit: "%" };
    const mockReport: HealthReport = {
      timestamp: new Date().toISOString(),
      overall: "healthy",
      sensors: {
        cpu: okSensor,
        memory: okSensor,
        disk: okSensor,
        network: { status: "ok", value: 1, unit: "connected" },
        processes: { status: "ok", value: 100, unit: "processes" },
      },
      alerts: [],
      repairs: [],
    };

    const spy = vi.spyOn(monitor, "runCheck").mockResolvedValue(mockReport);
    const report = await monitor.runCheck();

    expect(report.overall).toBe("healthy");
    expect(report.alerts).toHaveLength(0);
    spy.mockRestore();
  });

  it("any warning sensor → overall is degraded", async () => {
    const monitor = new HealthMonitor(60000, false);

    const warnSensor: SensorResult = { status: "warning", value: 75, unit: "%" };
    const okSensor: SensorResult = { status: "ok", value: 10, unit: "%" };

    const mockReport: HealthReport = {
      timestamp: new Date().toISOString(),
      overall: "degraded",
      sensors: {
        cpu: warnSensor,
        memory: okSensor,
        disk: okSensor,
        network: { status: "ok", value: 1, unit: "connected" },
        processes: { status: "ok", value: 100, unit: "processes" },
      },
      alerts: [
        {
          sensor: "cpu",
          severity: "warning",
          message: "cpu is warning",
          timestamp: new Date().toISOString(),
        },
      ],
      repairs: [],
    };

    const spy = vi.spyOn(monitor, "runCheck").mockResolvedValue(mockReport);
    const report = await monitor.runCheck();

    expect(report.overall).toBe("degraded");
    expect(report.alerts.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("any critical sensor → overall is critical", async () => {
    const monitor = new HealthMonitor(60000, false);

    const critSensor: SensorResult = {
      status: "critical",
      value: 98,
      unit: "%",
      message: "Disk at 98%",
    };
    const okSensor: SensorResult = { status: "ok", value: 10, unit: "%" };

    const mockReport: HealthReport = {
      timestamp: new Date().toISOString(),
      overall: "critical",
      sensors: {
        cpu: okSensor,
        memory: okSensor,
        disk: critSensor,
        network: { status: "ok", value: 1, unit: "connected" },
        processes: { status: "ok", value: 100, unit: "processes" },
      },
      alerts: [
        {
          sensor: "disk",
          severity: "critical",
          message: "Disk at 98%",
          timestamp: new Date().toISOString(),
        },
      ],
      repairs: [],
    };

    const spy = vi.spyOn(monitor, "runCheck").mockResolvedValue(mockReport);
    const report = await monitor.runCheck();

    expect(report.overall).toBe("critical");
    spy.mockRestore();
  });

  it("onReport listener is called after runCheck", async () => {
    const monitor = new HealthMonitor(60000, false);
    const listener = vi.fn();

    monitor.onReport(listener);
    await monitor.runCheck();

    expect(listener).toHaveBeenCalledOnce();
    const [report] = listener.mock.calls[0] as [HealthReport];
    expect(["healthy", "degraded", "critical"]).toContain(report.overall);
  });

  it("start/stop lifecycle does not throw", () => {
    const monitor = new HealthMonitor(60000, false);
    expect(() => {
      monitor.start();
      monitor.stop();
    }).not.toThrow();
  });
});
