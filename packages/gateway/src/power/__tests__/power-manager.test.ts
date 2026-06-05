import { describe, expect, it } from "vitest";
import {
  derivePowerMode,
  parseBatteryState,
  parseLowPowerMode,
  parseThermalPressure,
} from "../power-manager.js";

describe("power-manager parsers", () => {
  it("parses macOS battery state from pmset output", () => {
    const parsed = parseBatteryState(
      "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234567)\t14%; discharging; 2:31 remaining present: true",
    );

    expect(parsed.isOnBattery).toBe(true);
    expect(parsed.isCharging).toBe(false);
    expect(parsed.chargePercent).toBe(14);
  });

  it("parses thermal pressure and low power mode", () => {
    expect(parseThermalPressure("CPU_Speed_Limit = 68")).toBe("heavy");
    expect(parseLowPowerMode(" lowpowermode 1")).toBe(true);
  });

  it("derives a battery saver runtime mode under critical conditions", () => {
    const mode = derivePowerMode(
      {
        chargePercent: 7,
        isCharging: false,
        isOnBattery: true,
        lowPowerModeEnabled: false,
        thermalPressure: "nominal",
      },
      { lowBatteryThreshold: 20, criticalBatteryThreshold: 10 },
    );

    expect(mode).toBe("battery_saver");
  });
});
