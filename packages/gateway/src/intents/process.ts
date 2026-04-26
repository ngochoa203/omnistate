import type { IntentHandler } from "./types.js";

export const processRestart: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.restartProcess(args.name as string);
  return { speak: "Process restarted.", data: { success } };
};

export const processRenice: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.reniceProcess(args.pid as number, args.priority as number);
  return { speak: "Process priority changed.", data: { success } };
};

export const processDetails: IntentHandler = async (args, ctx) => {
  const details = await ctx.layers.deepOS!.getProcessDetails(args.pid as number);
  return { speak: "Process details retrieved.", data: { details } };
};

export const processList: IntentHandler = async (_args, ctx) => {
  const processes = await ctx.layers.deep.getProcessList();
  return { speak: "Process list retrieved.", data: { processes } };
};

export const processKill: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deep.killProcess(args.pid as number);
  return { speak: "Process killed.", data: { success } };
};
