import type { IntentHandler } from "./types.js";

export const appActivate: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deep.activateApp(args.name as string);
  return { speak: `App activated.`, data: { success } };
};

export const appQuit: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deep.quitApp(args.name as string);
  return { speak: `App quit.`, data: { success } };
};

export const appScript: IntentHandler = async (args, ctx) => {
  const output = await ctx.layers.deep.runAppleScript(args.script as string);
  return { speak: "Script executed.", data: { output } };
};

export const appResolve: IntentHandler = async (args, ctx) => {
  const info = await ctx.layers.deepOS!.resolveApp(args.name as string);
  return { speak: "App resolved.", data: { info } };
};

export const appInstall: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.installApp(args.name as string, args.manager as "brew" | "cask" | undefined);
  return { speak: "App installed.", data: { success } };
};

export const appLaunchWithContext: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.launchAppWithContext(
    args.name as string,
    args.args as string[] | undefined,
    args.env as Record<string, string> | undefined,
  );
  return { speak: "App launched.", data: { success } };
};

export const appChat: IntentHandler = async (args, ctx) => {
  // openChatWithPerson is an orchestrator method; fall back to app open via deep
  const appName = args.app as string;
  const success = await ctx.layers.deep.launchApp(appName);
  return { speak: `Opened ${appName}.`, data: { success } };
};
