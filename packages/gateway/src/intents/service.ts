import type { IntentHandler } from "./types.js";

export const serviceList: IntentHandler = async (_args, ctx) => {
  const services = await ctx.layers.deepOS!.listServices();
  return { speak: "Services listed.", data: { services } };
};

export const serviceStatus: IntentHandler = async (args, ctx) => {
  const status = await ctx.layers.deepOS!.getServiceStatus(args.name as string);
  return { speak: "Service status retrieved.", data: { status } };
};

export const serviceStart: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.startService(args.name as string);
  return { speak: "Service started.", data: { success } };
};

export const serviceStop: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.stopService(args.name as string);
  return { speak: "Service stopped.", data: { success } };
};

export const serviceRestart: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.restartService(args.name as string);
  return { speak: "Service restarted.", data: { success } };
};

export const serviceEnable: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.enableService(args.name as string);
  return { speak: "Service enabled.", data: { success } };
};

export const serviceDisable: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.disableService(args.name as string);
  return { speak: "Service disabled.", data: { success } };
};
