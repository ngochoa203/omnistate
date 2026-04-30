/**
 * IOKit intent handlers — expose hardware sensor layer to the intent registry.
 */

import type { IntentHandler } from "./types.js";

export const iokitThermals: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const thermals = await iokit.getThermals();
  const parts: string[] = [];
  if (thermals.cpuDie != null) parts.push(`CPU ${thermals.cpuDie.toFixed(1)}°C`);
  if (thermals.gpuDie != null) parts.push(`GPU ${thermals.gpuDie.toFixed(1)}°C`);
  if (thermals.battery != null) parts.push(`Battery ${thermals.battery.toFixed(1)}°C`);
  const speak = parts.length > 0 ? `Thermals: ${parts.join(', ')}.` : "Thermal data unavailable.";
  return { speak, data: { thermals } };
};

export const iokitFans: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const fans = await iokit.getFanSpeeds();
  const speak = fans.length > 0
    ? `${fans.length} fan${fans.length > 1 ? 's' : ''}: ${fans.map((f: any) => `Fan ${f.id} at ${f.rpm} RPM`).join(', ')}.`
    : "Fan data unavailable.";
  return { speak, data: { fans } };
};

export const iokitBatteryHealth: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const health = await iokit.getBatteryHealth();
  const speak = health.cycleCount > 0
    ? `Battery: ${health.healthPercent}% health, ${health.cycleCount} cycles, condition: ${health.condition}.`
    : "Battery health data unavailable.";
  return { speak, data: { health } };
};

export const iokitGPU: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const gpus = await iokit.getGPUInfo();
  const speak = gpus.length > 0
    ? `GPU: ${gpus.map((g: any) => g.model).join(', ')}.`
    : "GPU info unavailable.";
  return { speak, data: { gpus } };
};

export const iokitCPUUsage: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const cores = await iokit.getCPUUsagePerCore();
  const speak = cores.length > 0
    ? `CPU: ${cores[0].user.toFixed(1)}% user, ${cores[0].system.toFixed(1)}% system, ${cores[0].idle.toFixed(1)}% idle.`
    : "CPU usage data unavailable.";
  return { speak, data: { cores } };
};

export const iokitMemoryPressure: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const level = await iokit.getMemoryPressureLevel();
  return { speak: `Memory pressure: ${level}.`, data: { level } };
};

export const iokitNVRAMGet: IntentHandler = async (args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const value = await iokit.getNVRAMVariable(args.key as string);
  return { speak: value ? `NVRAM ${args.key}: ${value}` : "NVRAM variable not found.", data: { key: args.key, value } };
};

export const iokitNVRAMSet: IntentHandler = async (args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const success = await iokit.setNVRAMVariable(args.key as string, args.value as string);
  return { speak: success ? "NVRAM variable set." : "Failed to set NVRAM variable.", data: { success } };
};

export const iokitNVRAMList: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const vars = await iokit.listNVRAMVariables();
  const count = Object.keys(vars).length;
  return { speak: `${count} NVRAM variables found.`, data: { vars } };
};

export const iokitPCIDevices: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const devices = await iokit.getPCIDevices();
  return { speak: `${devices.length} PCI device${devices.length !== 1 ? 's' : ''} found.`, data: { devices } };
};

export const iokitUSBTree: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const devices = await iokit.getUSBTree();
  return { speak: `${devices.length} USB device${devices.length !== 1 ? 's' : ''} found.`, data: { devices } };
};

export const iokitSMCKeys: IntentHandler = async (_args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const keys = await iokit.getSMCKeys();
  return { speak: `${keys.length} SMC keys found.`, data: { keys } };
};

export const iokitSMCRead: IntentHandler = async (args, ctx) => {
  const iokit = ctx.layers.iokit as any;
  const value = await iokit.readSMCKey(args.key as string);
  return {
    speak: value !== null ? `SMC ${args.key}: ${value}` : "SMC key not found or smc tool not installed.",
    data: { key: args.key, value },
  };
};
