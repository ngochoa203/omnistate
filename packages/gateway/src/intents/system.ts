import type { IntentHandler } from "./types.js";

export const systemInfo: IntentHandler = async (_args, ctx) => {
  const info = ctx.layers.deep.getSystemInfo();
  const parts: string[] = [];
  if (info && typeof info === 'object') {
    const i = info as unknown as Record<string, unknown>;
    if (typeof i.cpuModel === 'string') {
      parts.push(`CPU: ${i.cpuModel}${typeof i.cpuCores === 'number' ? ` (${i.cpuCores} cores)` : ''}`);
    }
    if (typeof i.totalMemoryMB === 'number' && typeof i.freeMemoryMB === 'number') {
      const usedMB = Math.max(0, i.totalMemoryMB - i.freeMemoryMB);
      parts.push(`RAM: ${usedMB}MB used of ${i.totalMemoryMB}MB`);
    }
    if (typeof i.platform === 'string') parts.push(`Platform: ${i.platform}`);
    if (typeof i.hostname === 'string') parts.push(`Host: ${i.hostname}`);
  }
  const speak = parts.length > 0 ? parts.join(' | ') : 'System info retrieved.';
  return { speak, data: { info } };
};

export const systemLock: IntentHandler = async (_args, ctx) => {
  await ctx.layers.deep.execAsync(
    "/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend",
    5000,
  );
  return { speak: "Screen locked.", data: { success: true, action: "screen locked" } };
};

export const systemDnd: IntentHandler = async (args, ctx) => {
  const dndEnabled = Boolean(args.enabled ?? true);
  const dndVal = dndEnabled ? "true" : "false";
  await ctx.layers.deep.execAsync(
    `defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean ${dndVal} && killall NotificationCenter 2>/dev/null || true`,
    5000,
  );
  return { speak: dndEnabled ? "Do not disturb enabled." : "Do not disturb disabled.", data: { success: true, dnd: dndEnabled } };
};

export const osGetConfig: IntentHandler = async (args, ctx) => {
  const value = await ctx.layers.deepOS!.getOSConfig(args.key as string);
  return { speak: "Config retrieved.", data: { value } };
};

export const osSetConfig: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setOSConfig(
    args.key as string,
    args.value as string,
    args.domain as string | undefined,
  );
  return { speak: "Config set.", data: { success } };
};

export const osDarkMode: IntentHandler = async (args, ctx) => {
  if (args.set !== undefined) {
    const success = await ctx.layers.deepOS!.setDarkMode(args.set as boolean);
    return { speak: "Dark mode updated.", data: { success } };
  }
  const enabled = await ctx.layers.deepOS!.isDarkMode();
  return { speak: `Dark mode is ${enabled ? "on" : "off"}.`, data: { enabled } };
};

export const osDns: IntentHandler = async (args, ctx) => {
  if (args.servers) {
    const success = await ctx.layers.deepOS!.setDNS(args.servers as string[], args.iface as string | undefined);
    return { speak: "DNS updated.", data: { success } };
  }
  const servers = await ctx.layers.deepOS!.getDNS();
  return { speak: "DNS retrieved.", data: { servers } };
};

export const osProxy: IntentHandler = async (args, ctx) => {
  if (args.config) {
    const success = await ctx.layers.deepOS!.setProxy(args.config as any);
    return { speak: "Proxy set.", data: { success } };
  }
  const config = await ctx.layers.deepOS!.getProxy();
  return { speak: "Proxy retrieved.", data: { config } };
};

export const snapshotCreate: IntentHandler = async (args, ctx) => {
  const info = await ctx.layers.deepOS!.createSnapshot(args.label as string);
  return { speak: "Snapshot created.", data: { info } };
};

export const snapshotList: IntentHandler = async (_args, ctx) => {
  const snapshots = await ctx.layers.deepOS!.listSnapshots();
  return { speak: "Snapshots listed.", data: { snapshots } };
};

export const snapshotRollback: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.rollbackToSnapshot(args.label as string);
  return { speak: "Snapshot restored.", data: { success } };
};

export const envGet: IntentHandler = async (args, ctx) => {
  const value = await ctx.layers.deepOS!.getEnvVar(args.name as string);
  return { speak: "Env var retrieved.", data: { value } };
};

export const envSet: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setEnvVar(
    args.name as string,
    args.value as string,
    args.persist as boolean | undefined,
  );
  return { speak: "Env var set.", data: { success } };
};

export const envUnset: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.unsetEnvVar(args.name as string, args.persist as boolean | undefined);
  return { speak: "Env var unset.", data: { success } };
};

export const envList: IntentHandler = async (_args, ctx) => {
  const vars = await ctx.layers.deepOS!.listEnvVars();
  return { speak: "Env vars listed.", data: { vars } };
};

export const defaultsRead: IntentHandler = async (args, ctx) => {
  const value = await ctx.layers.deepOS!.readDefault(args.domain as string, args.key as string);
  return { speak: "Default read.", data: { value } };
};

export const defaultsWrite: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.writeDefault(
    args.domain as string,
    args.key as string,
    args.type as string,
    args.value as string,
  );
  return { speak: "Default written.", data: { success } };
};

export const defaultsDelete: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.deleteDefault(args.domain as string, args.key as string);
  return { speak: "Default deleted.", data: { success } };
};

export const timezoneGet: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const timezone = await deepSystem.getTimezone();
  return { speak: "Timezone retrieved.", data: { timezone } };
};

export const timezoneSet: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.setTimezone(args.tz as string);
  return { speak: "Timezone set.", data: { success } };
};

export const localeGet: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const locale = await deepSystem.getLocale();
  return { speak: "Locale retrieved.", data: { locale } };
};

export const localeSet: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.setLocale(args.locale as string);
  return { speak: "Locale set.", data: { success } };
};

export const powerBattery: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const info = await deepSystem.getBatteryInfo();
  return { speak: "Battery info retrieved.", data: { info } };
};

export const powerSleep: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.sleep();
  return { speak: "Going to sleep.", data: { success } };
};

export const powerShutdown: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.shutdown(args.delay as number | undefined);
  return { speak: "Shutting down.", data: { success } };
};

export const powerRestart: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.restart(args.delay as number | undefined);
  return { speak: "Restarting.", data: { success } };
};

export const powerScheduleWake: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.scheduleWake(new Date(args.date as string).toISOString());
  return { speak: "Wake scheduled.", data: { success } };
};

export const startupList: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const items = await deepSystem.listStartupItems();
  return { speak: "Startup items listed.", data: { items } };
};

export const startupAdd: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.addStartupItem(args.config);
  return { speak: "Startup item added.", data: { success } };
};

export const startupRemove: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.removeStartupItem(args.name as string);
  return { speak: "Startup item removed.", data: { success } };
};

export const loginItems: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const items = await deepSystem.listLoginItems();
  return { speak: "Login items listed.", data: { items } };
};

export const loginAdd: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.addLoginItem(args.appPath as string);
  return { speak: "Login item added.", data: { success } };
};

export const loginRemove: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem as any;
  const success = await deepSystem.removeLoginItem(args.appName as string);
  return { speak: "Login item removed.", data: { success } };
};

export const userList: IntentHandler = async (_args, ctx) => {
  const users = await ctx.layers.deepOS!.listUsers();
  return { speak: "Users listed.", data: { users } };
};

export const userCurrent: IntentHandler = async (_args, ctx) => {
  const user = await ctx.layers.deepOS!.getCurrentUser();
  return { speak: "Current user retrieved.", data: { user } };
};

export const userGroups: IntentHandler = async (_args, ctx) => {
  const groups = await ctx.layers.deepOS!.listGroups();
  return { speak: "Groups listed.", data: { groups } };
};

export const scheduleList: IntentHandler = async (_args, ctx) => {
  const tasks = await ctx.layers.deepOS!.listScheduledTasks();
  return { speak: "Scheduled tasks listed.", data: { tasks } };
};

export const scheduleCreate: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.createScheduledTask(args.config as any);
  return { speak: "Scheduled task created.", data: { success } };
};

export const scheduleRemove: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.removeScheduledTask(args.label as string);
  return { speak: "Scheduled task removed.", data: { success } };
};

export const wifiToggle: IntentHandler = async (args, ctx) => {
  const wifiEnabled = Boolean(args.enabled ?? true);
  const wifiCmd = wifiEnabled
    ? "networksetup -setairportpower en0 on"
    : "networksetup -setairportpower en0 off";
  await ctx.layers.deep.execAsync(wifiCmd, 5000);
  return { speak: wifiEnabled ? "Wi-Fi enabled." : "Wi-Fi disabled.", data: { success: true, wifi: wifiEnabled } };
};

export const searchSpotlight: IntentHandler = async (args, ctx) => {
  const query = String(args.query ?? "");
  const type = String(args.type ?? "all");
  let cmd: string;
  if (type === "app") {
    cmd = `mdfind 'kMDItemContentTypeTree == "com.apple.application-bundle" && kMDItemDisplayName == "*${query}*"c' | head -20`;
  } else if (type === "file") {
    cmd = `mdfind -name "${query}" | head -20`;
  } else {
    cmd = `mdfind "${query}" | head -20`;
  }
  const { stdout: searchOut } = await ctx.layers.deep.execAsync(cmd, 10000);
  const files = (searchOut ?? "").split("\n").filter(Boolean);
  return { speak: `Found ${files.length} results.`, data: { success: true, query, results: files, count: files.length } };
};
