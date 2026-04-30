/**
 * Kernel intent handlers — expose KernelLayer operations to the intent registry.
 */

import type { IntentHandler } from "./types.js";

export const kernelSysctlGet: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const value = await kernel.getSysctl(args.key as string);
  return {
    speak: value ? `${args.key}: ${value}` : `sysctl key '${args.key}' not found.`,
    data: { key: args.key, value },
  };
};

export const kernelSysctlSet: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const success = await kernel.setSysctl(args.key as string, args.value as string, Boolean(args.persist));
  return { speak: success ? "sysctl updated." : "Failed to update sysctl.", data: { success } };
};

export const kernelSysctlAll: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const vars = await kernel.getSysctlAll();
  const count = Object.keys(vars).length;
  return { speak: `${count} sysctl parameters read.`, data: { vars } };
};

export const kernelSysctlPrefix: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const vars = await kernel.getSysctlByPrefix(args.prefix as string);
  const count = Object.keys(vars).length;
  return { speak: `${count} sysctl parameters with prefix '${args.prefix}'.`, data: { vars } };
};

export const kernelVMStats: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const stats = await kernel.getVMStats();
  const pageSizeKB = stats.pageSize / 1024;
  const activeGB = ((stats.pagesActive * stats.pageSize) / 1e9).toFixed(2);
  const freeGB = ((stats.pagesFree * stats.pageSize) / 1e9).toFixed(2);
  return {
    speak: `VM stats: ${activeGB} GB active, ${freeGB} GB free (${pageSizeKB}KB pages).`,
    data: { stats },
  };
};

export const kernelSwapUsage: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const swap = await kernel.getSwapUsage();
  const usedMB = (swap.used / 1e6).toFixed(0);
  const totalMB = (swap.total / 1e6).toFixed(0);
  return { speak: `Swap: ${usedMB} MB used of ${totalMB} MB.`, data: { swap } };
};

export const kernelPurgeMemory: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const success = await kernel.purgeMemory();
  return { speak: success ? "Memory purged." : "Failed to purge memory (may require sudo).", data: { success } };
};

export const kernelListKexts: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const kexts = await kernel.listKexts();
  return { speak: `${kexts.length} kernel extensions loaded.`, data: { kexts } };
};

export const kernelGetKext: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const kext = await kernel.getKextInfo(args.name as string);
  return {
    speak: kext ? `Kext ${kext.name} v${kext.version} is ${kext.loaded ? 'loaded' : 'not loaded'}.` : `Kext '${args.name}' not found.`,
    data: { kext },
  };
};

export const kernelTraceSyscalls: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const output = await kernel.traceSyscalls(
    args.pid as number,
    args.durationMs as number | undefined
  );
  return { speak: "Syscall trace complete.", data: { output } };
};

export const kernelOpenFiles: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const files = await kernel.traceOpenFiles(args.pid as number);
  return { speak: `${files.length} open files for PID ${args.pid}.`, data: { files } };
};

export const kernelFDs: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const fds = await kernel.getOpenFileDescriptors(args.pid as number);
  return { speak: `${fds.length} file descriptors for PID ${args.pid}.`, data: { fds } };
};

export const kernelSpotlight: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const results = await kernel.spotlightQuery(args.query as string, args.maxResults as number | undefined);
  return {
    speak: `Found ${results.length} result${results.length !== 1 ? 's' : ''} for '${args.query}'.`,
    data: { results },
  };
};

export const kernelMdutilStatus: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const status = await kernel.mdutilStatus(args.volume as string | undefined);
  return {
    speak: `Spotlight indexing is ${status.indexing ? 'enabled' : 'disabled'}.`,
    data: { status },
  };
};

export const kernelMdutilControl: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const volume = args.volume as string;
  const action = args.action as string;
  let success = false;
  if (action === 'enable') success = await kernel.mdutilEnable(volume);
  else if (action === 'disable') success = await kernel.mdutilDisable(volume);
  else if (action === 'reindex') success = await kernel.mdutilReindex(volume);
  return { speak: success ? `mdutil ${action} complete.` : `mdutil ${action} failed.`, data: { success, action, volume } };
};

export const kernelSIPStatus: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const sip = await kernel.getSIPStatus();
  return {
    speak: `SIP is ${sip.enabled ? 'enabled' : 'DISABLED'}.`,
    data: { sip },
  };
};

export const kernelBootArgs: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const args_out = await kernel.getBootArgs();
  return {
    speak: args_out ? `Boot args: ${args_out}` : "No custom boot args set.",
    data: { bootArgs: args_out },
  };
};

export const kernelLaunchctlList: IntentHandler = async (_args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const jobs = await kernel.launchctlList();
  const running = jobs.filter((j: any) => j.pid != null).length;
  return { speak: `${jobs.length} launchd jobs, ${running} running.`, data: { jobs } };
};

export const kernelLaunchctlLoad: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const success = await kernel.launchctlLoad(args.plist as string);
  return { speak: success ? "Service loaded." : "Failed to load service.", data: { success } };
};

export const kernelLaunchctlUnload: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const success = await kernel.launchctlUnload(args.plist as string);
  return { speak: success ? "Service unloaded." : "Failed to unload service.", data: { success } };
};

export const kernelLaunchctlKickstart: IntentHandler = async (args, ctx) => {
  const kernel = ctx.layers.kernel as any;
  const success = await kernel.launchctlKickstart(args.service as string);
  return { speak: success ? "Service kickstarted." : "Failed to kickstart service.", data: { success } };
};
