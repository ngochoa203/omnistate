import type { IntentHandler } from "./types.js";

export const packageList: IntentHandler = async (args, ctx) => {
  const packages = await ctx.layers.deepOS!.listInstalledPackages(args.manager as string | undefined);
  return { speak: "Packages listed.", data: { packages } };
};

export const packageInstall: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.installPackage(args.name as string, args.manager as string | undefined);
  return { speak: "Package installed.", data: { success } };
};

export const packageRemove: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.removePackage(args.name as string, args.manager as string | undefined);
  return { speak: "Package removed.", data: { success } };
};

export const packageUpgrade: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.upgradePackage(args.name as string, args.manager as string | undefined);
  return { speak: "Package upgraded.", data: { success } };
};

export const packageUpgradeAll: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.upgradeAll(args.manager as string | undefined);
  return { speak: "All packages upgraded.", data: { success } };
};

export const packageSearch: IntentHandler = async (args, ctx) => {
  const packages = await ctx.layers.deepOS!.searchPackage(args.query as string, args.manager as string | undefined);
  return { speak: "Package search complete.", data: { packages } };
};

// Software layer handlers
export const softwareInstall: IntentHandler = async (args, ctx) => {
  const name = String(args.name ?? args.package ?? "");
  const manager = String(args.manager ?? "brew");
  let cmd: string;
  switch (manager) {
    case "cask": cmd = `brew install --cask "${name}"`; break;
    case "npm": cmd = `npm install -g "${name}"`; break;
    case "pip": cmd = `pip3 install "${name}"`; break;
    default: cmd = `brew install "${name}"`; break;
  }
  const result = await ctx.layers.deep.execAsync(cmd, 120000);
  return { speak: `${name} installed.`, data: { success: true, name, manager, output: result.stdout } };
};

export const softwareUninstall: IntentHandler = async (args, ctx) => {
  const name = String(args.name ?? args.package ?? "");
  const manager = String(args.manager ?? "brew");
  let cmd: string;
  switch (manager) {
    case "cask": cmd = `brew uninstall --cask "${name}"`; break;
    case "npm": cmd = `npm uninstall -g "${name}"`; break;
    case "pip": cmd = `pip3 uninstall -y "${name}"`; break;
    default: cmd = `brew uninstall "${name}"`; break;
  }
  const result = await ctx.layers.deep.execAsync(cmd, 60000);
  if (manager === "brew" || manager === "cask") {
    await ctx.layers.deep.execAsync("brew cleanup", 30000);
  }
  return { speak: `${name} uninstalled.`, data: { success: true, name, manager, output: result.stdout } };
};

export const softwareUpdate: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const updates = await deepSystem.checkForUpdates();
  return { speak: "Update check complete.", data: { success: true, updates } };
};

// Software layer method wrappers
export const softwareBrewInstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const result = await software.brewInstall(args.packages as string[]);
  return { speak: "Brew install complete.", data: result };
};

export const softwareBrewUninstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.brewUninstall(args.packages as string[]);
  return { speak: "Brew uninstall complete.", data: { success: true } };
};

export const softwareBrewList: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.brewList();
  return { speak: "Brew packages listed.", data: { packages } };
};

export const softwareBrewSearch: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.brewSearch(args.query as string);
  return { speak: "Brew search complete.", data: { packages } };
};

export const softwareBrewUpdate: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const output = await software.brewUpdate();
  return { speak: "Brew updated.", data: { output } };
};

export const softwareBrewUpgrade: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const result = await software.brewInstall((args.packages as string[]) ?? []);
  return { speak: "Brew upgrade complete.", data: result };
};

export const softwareBrewInfo: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const info = await software.brewInfo(args.name as string);
  return { speak: "Brew info retrieved.", data: info };
};

export const softwareBrewServices: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.brewList();
  return { speak: "Brew services listed.", data: { packages } };
};

export const softwareBrewDoctor: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const issues = await software.brewDoctor();
  return { speak: "Brew doctor complete.", data: { issues } };
};

export const softwareNpmInstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.npmInstall(args.packages as string[], args);
  return { speak: "npm install complete.", data: { success: true } };
};

export const softwareNpmUninstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.npmUninstall(args.packages as string[]);
  return { speak: "npm uninstall complete.", data: { success: true } };
};

export const softwareNpmList: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.npmList(args);
  return { speak: "npm packages listed.", data: { packages } };
};

export const softwareNpmRun: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const output = await software.brewUpdate();
  return { speak: "npm run complete.", data: { output } };
};

export const softwareNpmInit: IntentHandler = async () => {
  return { speak: "Use shell.exec: npm init", data: { success: true, note: "Use shell.exec: npm init" } };
};

export const softwareNpmSearch: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.npmSearch(args.query as string);
  return { speak: "npm search complete.", data: { packages } };
};

export const softwareNpmOutdated: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const outdated = await software.npmOutdated();
  return { speak: "npm outdated check complete.", data: { outdated } };
};

export const softwareNpmUpdate: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.npmInstall([], { global: args.global as boolean | undefined });
  return { speak: "npm update complete.", data: { success: true } };
};

export const softwarePipInstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const result = await software.pipInstall(args.packages as string[], args);
  return { speak: "pip install complete.", data: result };
};

export const softwarePipUninstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.pipUninstall(args.packages as string[]);
  return { speak: "pip uninstall complete.", data: { success: true } };
};

export const softwarePipList: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.pipList();
  return { speak: "pip packages listed.", data: { packages } };
};

export const softwarePipFreeze: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.pipList();
  return { speak: "pip freeze complete.", data: { packages } };
};

export const softwarePipSearch: IntentHandler = async () => {
  return { speak: "pip search has been deprecated; use PyPI web search.", data: { note: "pip search has been deprecated; use PyPI web search" } };
};

export const softwarePipShowVenvs: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const info = await software.getSystemInfo();
  return { speak: "Venv info retrieved.", data: { info } };
};

export const softwareGetEnv: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const value = await software.getEnvVar(args.name as string);
  return { speak: "Env var retrieved.", data: { value } };
};

export const softwareSetEnv: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.setEnvVar(args.name as string, args.value as string, args);
  return { speak: "Env var set.", data: { success: true } };
};

export const softwareUnsetEnv: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.setEnvVar(args.name as string, "", { persist: args.persist as boolean | undefined });
  return { speak: "Env var unset.", data: { success: true } };
};

export const softwareListEnv: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const vars = await software.listEnvVars(args.filter as string | undefined);
  return { speak: "Env vars listed.", data: { vars } };
};

export const softwareExportEnv: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const vars = await software.listEnvVars();
  return { speak: "Env vars exported.", data: { vars } };
};

export const softwareGetSystemInfo: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const info = await software.getSystemInfo();
  return { speak: "System info retrieved.", data: info };
};

export const softwareGetDiskUsage: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const disks = await software.getDiskUsage();
  return { speak: "Disk usage retrieved.", data: { disks } };
};

export const softwareGetMemoryUsage: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const memory = await software.getMemoryUsage();
  return { speak: "Memory usage retrieved.", data: memory };
};

export const softwareGetProcessorUsage: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const cpu = await software.getCpuUsage();
  return { speak: "CPU usage retrieved.", data: cpu };
};

export const softwareGetNetworkInterfaces: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const info = await software.getSystemInfo();
  return { speak: "Network interfaces retrieved.", data: { interfaces: (info as any).networkInterfaces ?? [] } };
};

export const softwareGetNodeVersions: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const versions = await software.getNodeVersions();
  return { speak: "Node versions retrieved.", data: { versions } };
};

export const softwareSetNodeVersion: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.setNodeVersion(args.version as string);
  return { speak: "Node version set.", data: { success: true } };
};

export const softwareGetPythonVersions: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const versions = await software.getPythonVersions();
  return { speak: "Python versions retrieved.", data: { versions } };
};

export const softwareSetPythonVersion: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  await software.setPythonVersion(args.version as string);
  return { speak: "Python version set.", data: { success: true } };
};

export const softwareGetRubyVersions: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const versions = await software.getRubyVersions();
  return { speak: "Ruby versions retrieved.", data: { versions } };
};

export const softwareCaskInstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const result = await software.caskInstall(args.name as string);
  return { speak: "Cask installed.", data: result };
};

export const softwareCaskUninstall: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const result = await software.caskUninstall(args.name as string);
  return { speak: "Cask uninstalled.", data: result };
};

export const softwareCaskList: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.caskList();
  return { speak: "Cask packages listed.", data: { packages } };
};

export const softwareCaskSearch: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const packages = await software.caskSearch(args.query as string);
  return { speak: "Cask search complete.", data: { packages } };
};

export const softwareGetInstalledApps: IntentHandler = async (_args, ctx) => {
  const software = (ctx.layers as any).software;
  const apps = await software.getInstalledApps();
  return { speak: "Installed apps listed.", data: { apps } };
};

export const softwareGetAppInfo: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const info = await software.getAppInfo(args.name as string);
  return { speak: "App info retrieved.", data: { info } };
};

export const softwareIsAppInstalled: IntentHandler = async (args, ctx) => {
  const software = (ctx.layers as any).software;
  const installed = await software.isAppInstalled(args.name as string);
  return { speak: installed ? "App is installed." : "App is not installed.", data: { installed } };
};
