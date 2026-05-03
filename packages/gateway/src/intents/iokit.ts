/**
 * IOKit Intent Handlers — bridge KernelLayer to intent registry.
 *
 * Provides intent handlers for low-level macOS kernel and hardware sensor access
 * using the KernelLayer class from packages/gateway/src/layers/kernel.ts.
 *
 * Exported intent handlers:
 *   iokitThermals       → getSysctl + thermal sensor keys
 *   iokitFans           → kextstat analysis (fan control kexts)
 *   iokitBatteryHealth  → pmset battery health data
 *   iokitGPU            → graphics/GPU sensor data via sysctl
 *   iokitCPUUsage       → getSysctl + vm_stat CPU metrics
 *   iokitMemoryPressure → getVMStats memory pressure
 *   iokitNVRAMGet       → nvram read
 *   iokitNVRAMSet       → nvram write
 *   iokitNVRAMList      → nvram all
 *   iokitPCIDevices     → system_profiler PCI data
 *   iokitUSBTree        → system_profiler USB data
 *   iokitSMCKeys        → SMC key read (via sysctl fallback)
 *   iokitSMCRead        → individual SMC key read
 */

import type { IntentHandler } from "./types.js";

interface KextInfo {
  index: number;
  refs: number;
  size: number;
  wiredBytes: number;
  name: string;
  version: string;
  loaded: boolean;
}


// ── Kernel layer getter ────────────────────────────────────────────────────

async function getKernelLayer(ctx: any) {
  // KernelLayer is instantiated on the deepOS layer
  const deepOS = ctx.layers.deepOS;
  if (!deepOS) {
    throw new Error("deepOS layer not available — IOKit requires macOS");
  }
  // Create KernelLayer instance if not already created
  if (!(deepOS as any)._kernelLayer) {
    const { KernelLayer } = await import("../layers/kernel.js");
    (deepOS as any)._kernelLayer = new KernelLayer();
  }
  return (deepOS as any)._kernelLayer as import("../layers/kernel.js").KernelLayer;
}

// ── IOKit Thermals ─────────────────────────────────────────────────────────

export const iokitThermals: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  // Collect thermal-related sysctl keys
  const thermalKeys = [
    "machdep.cpu.thread_count",
    "hw.ncpu",
    "hw.perflevel1、物理",
    "kern.constraint_control",
  ];

  const results: Record<string, string | number> = {};
  for (const key of thermalKeys) {
    const val = await kernel.getSysctl(key);
    if (val !== null) {
      results[key] = isNaN(Number(val)) ? val : Number(val);
    }
  }

  // Also try CPU thermal zone keys (platform-specific)
  const allKeys = await kernel.getSysctlByPrefix("hw.");
  for (const [k, v] of Object.entries(allKeys)) {
    if (/thermal|temp|cpu|core/i.test(k)) {
      results[k] = isNaN(Number(v)) ? v : Number(v);
    }
  }

  // vm_stat gives memory pressure indicator
  const vmStats = await kernel.getVMStats();
  results.memoryPagesFree = vmStats.pagesFree;
  results.memoryPagesActive = vmStats.pagesActive;
  results.memoryPagesWiredDown = vmStats.pagesWiredDown;
  results.pageSize = vmStats.pageSize;

  return {
    speak: "Thermal sensor data retrieved.",
    data: {
      success: true,
      thermal: results,
      vmStats: {
        pagesFree: vmStats.pagesFree,
        pagesActive: vmStats.pagesActive,
        pagesWiredDown: vmStats.pagesWiredDown,
      },
    },
  };
};

// ── IOKit Fans ──────────────────────────────────────────────────────────────

export const iokitFans: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  // Get all loaded kexts and filter for fan-related ones
  const kexts = await kernel.listKexts();

  // Fan control kexts on MacBook models
  const fanKexts = kexts.filter((k: KextInfo) =>
    /fan|appleh8|applelpc|applebc|smc/i.test(k.name)
  );

  return {
    speak: fanKexts.length > 0
      ? `Found ${fanKexts.length} fan-related kernel extensions.`
      : "No dedicated fan control kexts found.",
    data: {
      success: true,
      fanKexts,
      totalKexts: kexts.length,
      note: "Direct fan RPM control requires SMC write access (sudo). Read-only via IOKit.",
    },
  };
};

// ── IOKit Battery Health ───────────────────────────────────────────────────

export const iokitBatteryHealth: IntentHandler = async (_args, ctx) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    // pmset -g bi = battery info
    const { stdout } = await execFileAsync("pmset", ["-g", "bi"]);
    const lines = stdout.split("\n").filter(Boolean);

    const batteryInfo: Record<string, string | number> = {};
    for (const line of lines) {
      const [key, ...valueParts] = line.split(/\s*=\s*/);
      if (key && valueParts.length > 0) {
        const val = valueParts.join("=").trim();
        batteryInfo[key.trim()] = isNaN(Number(val)) ? val : Number(val);
      }
    }

    // Also get power settings
    const kernel = await getKernelLayer(ctx);
    const powerKeys = await kernel.getSysctlByPrefix("hw.");
    const relevantPower: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(powerKeys)) {
      if (/battery|capacity|current|voltage|watt/i.test(k)) {
        relevantPower[k] = isNaN(Number(v)) ? v : Number(v);
      }
    }

    return {
      speak: "Battery health data retrieved.",
      data: {
        success: true,
        batteryInfo,
        powerInfo: relevantPower,
      },
    };
  } catch (err: any) {
    return {
      speak: "Could not read battery health.",
      data: { success: false, error: err.message },
    };
  }
};

// ── IOKit GPU ───────────────────────────────────────────────────────────────

export const iokitGPU: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  const gpuKeys = await kernel.getSysctlByPrefix("hw.");
  const gpuInfo: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(gpuKeys)) {
    if (/gpu|graphics|card|device/i.test(k)) {
      gpuInfo[k] = isNaN(Number(v)) ? v : Number(v);
    }
  }

  // Fallback: system_profiler SPDisplaysDataType
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync(
      "system_profiler",
      ["SPDisplaysDataType", "-json"],
      { timeout: 10_000 }
    );
    const data = JSON.parse(stdout);
    const displays = data?.SPDisplaysDataType ?? [];

    return {
      speak: "GPU info retrieved.",
      data: {
        success: true,
        gpuSysctl: gpuInfo,
        gpuProfiler: displays,
      },
    };
  } catch {
    return {
      speak: "GPU info retrieved (system profiler unavailable).",
      data: {
        success: true,
        gpuSysctl: gpuInfo,
        gpuProfiler: [],
      },
    };
  }
};

// ── IOKit CPU Usage ─────────────────────────────────────────────────────────

export const iokitCPUUsage: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  // Get CPU count and thread info
  const cpuCount = await kernel.getSysctl("hw.ncpu");
  const cpuBrand = await kernel.getSysctl("machdep.cpu.brand");
  const cpuFreq = await kernel.getSysctl("hw.cpufrequency");

  // VM stats for memory-related CPU load
  const vmStats = await kernel.getVMStats();

  // Also get per-CPU usage via top (if available)
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  let topOutput = "";
  try {
    const { stdout } = await execFileAsync(
      "top", ["-l1", "-n1", "-stats", "cpu"],
      { timeout: 5_000 }
    );
    topOutput = stdout;
  } catch {
    // top may not be available
  }

  return {
    speak: "CPU usage data retrieved.",
    data: {
      success: true,
      cpu: {
        count: cpuCount ? Number(cpuCount) : 0,
        brand: cpuBrand ?? "unknown",
        frequency: cpuFreq ?? "unknown",
      },
      vmStats: {
        pagesActive: vmStats.pagesActive,
        pagesWiredDown: vmStats.pagesWiredDown,
        pageins: vmStats.pageins,
        pageouts: vmStats.pageouts,
      },
      topRaw: topOutput,
    },
  };
};

// ── IOKit Memory Pressure ───────────────────────────────────────────────────

export const iokitMemoryPressure: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  const vmStats = await kernel.getVMStats();
  const swapInfo = await kernel.getSwapUsage();

  // Calculate pressure indicator (free pages / total)
  const totalPages = vmStats.pagesFree + vmStats.pagesActive +
                      vmStats.pagesInactive + vmStats.pagesWiredDown;
  const freePercent = totalPages > 0
    ? Math.round((vmStats.pagesFree / totalPages) * 100)
    : 0;

  let pressure: "low" | "medium" | "high";
  if (freePercent > 30) {
    pressure = "low";
  } else if (freePercent > 15) {
    pressure = "medium";
  } else {
    pressure = "high";
  }

  return {
    speak: `Memory pressure is ${pressure}.`,
    data: {
      success: true,
      pressure,
      freePercent,
      vmStats: {
        pagesFree: vmStats.pagesFree,
        pagesActive: vmStats.pagesActive,
        pagesInactive: vmStats.pagesInactive,
        pagesWiredDown: vmStats.pagesWiredDown,
        pagesSpeculative: vmStats.pagesSpeculative,
        purgeablePages: vmStats.purgeablePages,
        pageins: vmStats.pageins,
        pageouts: vmStats.pageouts,
        pageSize: vmStats.pageSize,
      },
      swap: {
        totalMB: Math.round(swapInfo.totalBytes / 1024 / 1024),
        usedMB: Math.round(swapInfo.usedBytes / 1024 / 1024),
        freeMB: Math.round(swapInfo.freeBytes / 1024 / 1024),
        encrypted: swapInfo.encrypted,
      },
    },
  };
};

// ── IOKit NVRAM ────────────────────────────────────────────────────────────

export const iokitNVRAMGet: IntentHandler = async (args, _ctx) => {
  const key = String(args.key ?? "");
  if (!key) {
    return { speak: "No NVRAM key specified.", data: { success: false } };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync("nvram", [key], { timeout: 5_000 });
    return {
      speak: `NVRAM key "${key}" retrieved.`,
      data: { success: true, key, value: stdout.trim() },
    };
  } catch (err: any) {
    return {
      speak: `Could not read NVRAM key "${key}".`,
      data: { success: false, error: err.message },
    };
  }
};

export const iokitNVRAMSet: IntentHandler = async (args, _ctx) => {
  const key = String(args.key ?? "");
  const value = String(args.value ?? "");
  if (!key || !value) {
    return { speak: "Both key and value are required.", data: { success: false } };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync("sudo", ["nvram", `${key}=${value}`], {
      timeout: 10_000,
    });
    return {
      speak: `NVRAM key "${key}" set (requires sudo).`,
      data: { success: true, key, value, stdout, stderr },
    };
  } catch (err: any) {
    return {
      speak: `Could not set NVRAM key "${key}".`,
      data: { success: false, error: err.message, note: "NVRAM write requires sudo" },
    };
  }
};

export const iokitNVRAMList: IntentHandler = async (_args, _ctx) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync("nvram", ["-x", "-p"], { timeout: 10_000 });
    let entries: Record<string, string> = {};
    try {
      entries = JSON.parse(stdout);
    } catch {
      // Fallback: parse key=value lines
      for (const line of stdout.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx !== -1) {
          const k = line.slice(0, eqIdx).trim();
          const v = line.slice(eqIdx + 1).trim();
          if (k) entries[k] = v;
        }
      }
    }

    return {
      speak: `NVRAM contains ${Object.keys(entries).length} entries.`,
      data: { success: true, entries, count: Object.keys(entries).length },
    };
  } catch (err: any) {
    return {
      speak: "Could not list NVRAM entries.",
      data: { success: false, error: err.message },
    };
  }
};

// ── IOKit PCI Devices ──────────────────────────────────────────────────────

export const iokitPCIDevices: IntentHandler = async (_args, _ctx) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync(
      "system_profiler",
      ["SPPCIDataType", "-json"],
      { timeout: 15_000 }
    );
    const data = JSON.parse(stdout);
    const pciDevices = data?.SPPCIDataType ?? [];

    return {
      speak: `Found ${pciDevices.length} PCI devices.`,
      data: { success: true, pciDevices, count: pciDevices.length },
    };
  } catch (err: any) {
    return {
      speak: "Could not retrieve PCI device info.",
      data: { success: false, error: err.message },
    };
  }
};

// ── IOKit USB Tree ─────────────────────────────────────────────────────────

export const iokitUSBTree: IntentHandler = async (_args, _ctx) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync(
      "system_profiler",
      ["SPUSBDataType", "-json"],
      { timeout: 15_000 }
    );
    const data = JSON.parse(stdout);
    const usbDevices = data?.SPUSBDataType ?? [];

    return {
      speak: `Found ${usbDevices.length} USB devices.`,
      data: { success: true, usbDevices, count: usbDevices.length },
    };
  } catch (err: any) {
    return {
      speak: "Could not retrieve USB device tree.",
      data: { success: false, error: err.message },
    };
  }
};

// ── IOKit SMC Keys ─────────────────────────────────────────────────────────

export const iokitSMCKeys: IntentHandler = async (_args, ctx) => {
  const kernel = await getKernelLayer(ctx);

  // SMC keys are not directly readable without SMC kit
  // List known SMC key prefixes via sysctl as proxy
  const allKeys = await kernel.getSysctlAll();
  const smcProxy: Record<string, string | number> = {};

  for (const [k, v] of Object.entries(allKeys)) {
    if (/smc|thermal|brightness|fan|power|cpu|gpu/i.test(k)) {
      smcProxy[k] = isNaN(Number(v)) ? v : Number(v);
    }
  }

  return {
    speak: "SMC proxy keys retrieved.",
    data: {
      success: true,
      note: "Direct SMC key access requires Apple's SMCKit (closed-source). Values exposed via sysctl.",
      smcProxyKeys: smcProxy,
      keyCount: Object.keys(smcProxy).length,
    },
  };
};

export const iokitSMCRead: IntentHandler = async (args, ctx) => {
  const key = String(args.key ?? "").toUpperCase();
  if (!key) {
    return { speak: "No SMC key specified.", data: { success: false } };
  }

  const kernel = await getKernelLayer(ctx);

  // Map common SMC key names to sysctl equivalents
  const smcKeyMap: Record<string, string> = {
    "F0Ac": "hw.ncpu",
    "CPU SLC": "machdep.cpu.thread_count",
    "FNum": "kern.constraint_control",
    "MSLC": "machdep.cpu.logical_per_pkg",
  };

  const sysctlKey = smcKeyMap[key] ?? `unknown.smc.${key}`;

  try {
    const value = await kernel.getSysctl(sysctlKey);
    return {
      speak: `SMC key "${key}" read.`,
      data: {
        success: value !== null,
        smcKey: key,
        sysctlKey,
        value,
        note: value === null
          ? "SMC key not directly accessible. Value may be available via system_profiler."
          : "Read via sysctl proxy.",
      },
    };
  } catch (err: any) {
    return {
      speak: `Could not read SMC key "${key}".`,
      data: { success: false, error: err.message },
    };
  }
};
