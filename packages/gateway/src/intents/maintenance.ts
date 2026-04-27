import type { IntentHandler } from "./types.js";

// ── System maintenance ─────────────────────────────────────────────────────────

export const maintenanceDiskCleanup: IntentHandler = async (_args, ctx) => {
  const results: string[] = [];
  const { stdout: cacheOut } = await ctx.layers.deep.execAsync(
    "rm -rf ~/Library/Caches/* 2>/dev/null; du -sh ~/Library/Caches/",
    30000,
  );
  results.push(`Caches: ${cacheOut?.trim()}`);
  await ctx.layers.deep.execAsync(
    "rm -rf /tmp/com.apple.* 2>/dev/null; rm -rf $TMPDIR/* 2>/dev/null; echo 'Temp cleaned'",
    30000,
  );
  results.push("Temp files cleared");
  await ctx.layers.deep.execAsync("rm -rf ~/.Trash/* 2>/dev/null; echo 'Trash emptied'", 30000);
  results.push("Trash emptied");
  await ctx.layers.deep.execAsync(
    "rm -rf ~/Library/Developer/Xcode/DerivedData/* 2>/dev/null; echo 'ok'",
    30000,
  );
  results.push("Xcode DerivedData cleaned");
  const { stdout: spaceOut } = await ctx.layers.deep.execAsync("df -h / | tail -1", 5000);
  results.push(`Disk: ${spaceOut?.trim()}`);
  return { speak: "Disk cleanup complete.", data: { success: true, actions: results } };
};

export const maintenanceNetworkFix: IntentHandler = async (_args, ctx) => {
  const results: string[] = [];
  const { stdout: dnsOut } = await ctx.layers.deep.execAsync(
    "sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder && echo 'DNS flushed'",
    10000,
  );
  results.push(dnsOut?.trim() ?? "DNS flush attempted");
  const { stdout: wifiOut } = await ctx.layers.deep.execAsync(
    "networksetup -setairportpower en0 off && sleep 2 && networksetup -setairportpower en0 on && echo 'WiFi reset'",
    15000,
  );
  results.push(wifiOut?.trim() ?? "WiFi reset attempted");
  const { stdout: pingOut } = await ctx.layers.deep.execAsync("ping -c 3 8.8.8.8 2>&1 | tail -3", 10000);
  results.push(`Ping: ${pingOut?.trim()}`);
  return { speak: "Network fix attempted.", data: { success: true, actions: results } };
};

export const maintenanceKillMemoryLeaks: IntentHandler = async (args, ctx) => {
  const threshold = Number(args.threshold ?? 500);
  const deepSystem = (ctx.layers as any).deepSystem;
  const topProcs = await deepSystem.getTopMemoryProcesses(20);
  const killed: string[] = [];
  for (const proc of topProcs) {
    const memMB = Math.round(parseInt(proc.memRSS, 10) / 1024);
    if (memMB > threshold) {
      try {
        await ctx.layers.deep.execAsync(`kill -TERM ${proc.pid}`, 5000);
        killed.push(`${proc.name} (PID ${proc.pid}, ${memMB}MB)`);
      } catch {}
    }
  }
  return { speak: `Killed ${killed.length} memory-heavy processes.`, data: { success: true, threshold: `${threshold}MB`, killed, count: killed.length } };
};

// ── Health ────────────────────────────────────────────────────────────────────

export const healthNotify: IntentHandler = async (args, ctx) => {
  const health = (ctx.layers as any).health;
  const success = await health.sendNotification({ title: args.title as string, message: args.message as string });
  return { speak: "Notification sent.", data: { success } };
};

export const healthDiskRescue: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const report = await health.diskRescue();
  return { speak: "Disk rescue complete.", data: { report } };
};

export const healthNetworkDiagnose: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const diagnosis = await health.diagnoseAndHealNetwork();
  return { speak: "Network diagnosed.", data: { diagnosis } };
};

export const healthSecurityScan: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const report = await health.securityScan();
  return { speak: "Security scan complete.", data: { report } };
};

export const healthThermal: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const state = await health.getThermalStatus();
  return { speak: "Thermal status retrieved.", data: { state } };
};

export const healthBattery: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const info = await health.getBatteryInfo();
  return { speak: "Battery health retrieved.", data: { info } };
};

export const healthFilesystem: IntentHandler = async (args, ctx) => {
  const health = (ctx.layers as any).health;
  const result = await health.checkFilesystemIntegrity(args.volume as string | undefined);
  return { speak: "Filesystem check complete.", data: { result } };
};

export const healthCertExpiry: IntentHandler = async (args, ctx) => {
  const health = (ctx.layers as any).health;
  const result = await health.checkCertExpiry(args.host as string, args.port as number | undefined);
  return { speak: "Certificate expiry checked.", data: { result } };
};

export const healthLogAnomalies: IntentHandler = async (args, ctx) => {
  const health = (ctx.layers as any).health;
  const anomalies = await health.detectLogAnomalies(args.source as string | undefined);
  return { speak: "Log anomalies detected.", data: { anomalies } };
};

export const healthSmartDisk: IntentHandler = async (args, ctx) => {
  const health = (ctx.layers as any).health;
  const health_ = await health.getSmartDiskHealth(args.device as string | undefined);
  return { speak: "SMART disk health retrieved.", data: { health: health_ } };
};

export const healthSocketStats: IntentHandler = async (_args, ctx) => {
  const health = (ctx.layers as any).health;
  const stats = await health.checkPortExhaustion();
  return { speak: "Socket stats retrieved.", data: { stats } };
};

// ── Maintenance layer ─────────────────────────────────────────────────────────

export const maintGetDiskUsage: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const usage = await maint.getDiskUsage();
  return { speak: "Disk usage retrieved.", data: { usage } };
};

export const maintGetLargeFiles: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const files = await maint.getLargeFiles(
    args.directory as string | undefined,
    args.minSizeMB as number | undefined,
    args.limit as number | undefined,
  );
  return { speak: "Large files listed.", data: { files } };
};

export const maintCleanTempFiles: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.cleanTempFiles();
  return { speak: "Temp files cleaned.", data: result };
};

export const maintCleanDownloads: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.cleanDownloads(args);
  return { speak: "Downloads cleaned.", data: result };
};

export const maintEmptyTrash: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.emptyTrash();
  return { speak: "Trash emptied.", data: result };
};

export const maintGetDirectorySize: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const size = await maint.getDirectorySize(args.path as string);
  return { speak: "Directory size retrieved.", data: size };
};

export const maintListCaches: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const caches = await maint.listCaches();
  return { speak: "Caches listed.", data: { caches } };
};

export const maintClearAppCache: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.clearAppCache(args.appName as string);
  return { speak: "App cache cleared.", data: result };
};

export const maintClearBrowserCache: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.clearBrowserCache(args);
  return { speak: "Browser cache cleared.", data: result };
};

export const maintClearDeveloperCaches: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.clearDeveloperCaches(args.searchRoot as string | undefined);
  return { speak: "Developer caches cleared.", data: result };
};

export const maintGetCacheSize: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const size = await maint.getCacheSize();
  return { speak: "Cache size retrieved.", data: size };
};

export const maintListProcesses: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const processes = await maint.listProcesses(args.sortBy);
  return { speak: "Processes listed.", data: { processes } };
};

export const maintKillProcess: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.killProcess(args.pid as number, args.force as boolean | undefined);
  return { speak: "Process killed.", data: result };
};

export const maintKillByName: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.killByName(args.name as string, args.force as boolean | undefined);
  return { speak: "Processes killed.", data: result };
};

export const maintGetProcessInfo: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const info = await maint.getProcessInfo(args.pid as number);
  return { speak: "Process info retrieved.", data: { info } };
};

export const maintGetResourceHogs: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const hogs = await maint.getResourceHogs(
    (args.type as "cpu" | "memory" | undefined) ?? "cpu",
    args.limit as number | undefined,
  );
  return { speak: "Resource hogs retrieved.", data: { hogs } };
};

export const maintGetZombieProcesses: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const zombies = await maint.getZombieProcesses();
  return { speak: "Zombie processes found.", data: { zombies } };
};

export const maintGetSystemLogs: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const logs = await maint.getSystemLogs(args.limit as number | undefined, args.since as string | undefined);
  return { speak: "System logs retrieved.", data: { logs } };
};

export const maintGetAppLogs: IntentHandler = async (args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const logs = await maint.getAppLogs(args.appName as string, args.limit as number | undefined);
  return { speak: "App logs retrieved.", data: { logs } };
};

export const maintClearUserLogs: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.clearUserLogs();
  return { speak: "User logs cleared.", data: result };
};

export const maintGetLogSize: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const sizes = await maint.getLogSize();
  return { speak: "Log size retrieved.", data: { sizes } };
};

export const maintRepairPermissions: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.repairPermissions();
  return { speak: "Permissions repaired.", data: result };
};

export const maintVerifyDisk: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.verifyDisk();
  return { speak: "Disk verified.", data: result };
};

export const maintFlushDNS: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.flushDNS();
  return { speak: "DNS flushed.", data: result };
};

export const maintRebuildSpotlight: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const result = await maint.rebuildSpotlight();
  return { speak: "Spotlight index rebuilt.", data: result };
};

export const maintGetStartupItems: IntentHandler = async (_args, ctx) => {
  const maint = (ctx.layers as any).maintenance;
  const items = await maint.getStartupItems();
  return { speak: "Startup items retrieved.", data: { items } };
};

// ── Log (deepSystem) ──────────────────────────────────────────────────────────

export const logSystem: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const logs = await deepSystem.getSystemLogs(args.lines as number | undefined, args.filter as string | undefined);
  return { speak: "System logs retrieved.", data: { logs } };
};

export const logApp: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const logs = await deepSystem.getAppLogs(args.appName as string, args.lines as number | undefined);
  return { speak: "App logs retrieved.", data: { logs } };
};

export const logSearch: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const results = await deepSystem.searchLogs(args.query as string, args.since as string | undefined);
  return { speak: "Log search complete.", data: { results } };
};

export const logSize: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const size = await deepSystem.getLogSize();
  return { speak: "Log size retrieved.", data: { size } };
};

export const logClean: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const result = await deepSystem.cleanOldLogs(args.olderThanDays as number | undefined);
  return { speak: "Old logs cleaned.", data: { result } };
};

// ── Cert / GPG ─────────────────────────────────────────────────────────────────

export const certList: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const certs = await deepSystem.listCertificates(args.keychain as string | undefined);
  return { speak: "Certificates listed.", data: { certs } };
};

export const certInstall: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.installCertificate(args.certPath as string, args.keychain as string | undefined);
  return { speak: "Certificate installed.", data: { success } };
};

export const gpgList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const keys = await deepSystem.listGPGKeys();
  return { speak: "GPG keys listed.", data: { keys } };
};

// ── Update ────────────────────────────────────────────────────────────────────

export const updateCheck: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const updates = await deepSystem.checkForUpdates();
  return { speak: "Update check complete.", data: { updates } };
};

export const updateInstall: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.installUpdate(args.name as string);
  return { speak: "Update installed.", data: { success } };
};

export const updateInstallAll: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.installAllUpdates();
  return { speak: "All updates installed.", data: { success } };
};

export const updateOsVersion: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const version = await deepSystem.getOSVersion();
  return { speak: "OS version retrieved.", data: { version } };
};

// ── Backup ────────────────────────────────────────────────────────────────────

export const backupTimemachine: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const status = await deepSystem.getTimeMachineStatus();
  return { speak: "Time Machine status retrieved.", data: { status } };
};

export const backupStart: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.startTimeMachineBackup();
  return { speak: "Time Machine backup started.", data: { success } };
};

export const backupList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const backups = await deepSystem.listTimeMachineBackups();
  return { speak: "Backups listed.", data: { backups } };
};

export const backupRsync: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const result = await deepSystem.rsync(args.source as string, args.dest as string, args.opts);
  return { speak: "rsync complete.", data: { result } };
};

// ── Font ──────────────────────────────────────────────────────────────────────

export const fontList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const fonts = await deepSystem.listFonts();
  return { speak: "Fonts listed.", data: { fonts } };
};

export const fontInstall: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.installFont(args.path as string);
  return { speak: "Font installed.", data: { success } };
};

// ── Security ──────────────────────────────────────────────────────────────────

export const securityScan: IntentHandler = async (args, ctx) => {
  const path = String(args.path ?? "/");
  const result = await ctx.layers.deep.execAsync(
    `clamscan -r "${path}" --max-dir-recursion=3 2>&1 | tail -20`,
    120000,
  );
  return { speak: "Security scan complete.", data: { success: true, path, output: result.stdout } };
};

export const securityVaultGet: IntentHandler = async (args, ctx) => {
  const name = String(args.name ?? args.search ?? "");
  const result = await ctx.layers.deep.execAsync(
    `bw get item "${name}" --pretty 2>/dev/null | head -20`,
    10000,
  );
  return { speak: "Vault item retrieved.", data: { success: true, name, data: result.stdout } };
};

export const securityEncrypt: IntentHandler = async (args, ctx) => {
  const path = String(args.path ?? "");
  const password = String(args.password ?? "");
  await ctx.layers.deep.execAsync(
    `hdiutil create -encryption -stdinpass -srcfolder "${path}" "${path}.dmg" <<< "${password}"`,
    60000,
  );
  return { speak: "File encrypted.", data: { success: true, path, output: `${path}.dmg` } };
};

export const securityShred: IntentHandler = async (args, ctx) => {
  const path = String(args.path ?? "");
  await ctx.layers.deep.execAsync(`rm -P "${path}"`, 30000);
  return { speak: "File securely deleted.", data: { success: true, path, action: "securely deleted" } };
};
