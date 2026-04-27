/**
 * Intent registry bootstrap.
 *
 * Registers:
 *  - 4 new Siri-class handlers (timer, note, reminder, calendar)
 *  - All domain tool adapters migrated from orchestrator.ts
 */

import { IntentRegistry } from "./types.js";
import type { HandlerContext, StructuredResponse } from "./types.js";
import { timerSet, timerCancel, timerList } from "./timer.js";
import { noteCreate, noteList, noteSearch } from "./note.js";
import { reminderSet, reminderList, reminderCancel } from "./reminder.js";
import { calendarToday, calendarNext } from "./calendar.js";
import { processRestart, processRenice, processDetails, processList, processKill } from "./process.js";
import {
  appActivate, appQuit, appScript, appResolve, appInstall, appLaunchWithContext, appChat,
} from "./app.js";
import {
  fileRead, fileWrite, filePermissions, fileChmod, fileChown, fileCreate, fileCopy, fileMove,
  fileRenameBatch, fileDelete, fileSearch, fileZip, fileUnzip, fileOrganizeDesktop,
  fileList, fileMetadata, fileExists, fileSize, fileHash, fileTouch, fileAppend,
  fileSymlink, fileResolveSymlink, fileDiskSpace, fileCompare, fileMkdir, fileReadBuffer,
  fileGetPermissions, fileSetPermissions, fileWatch,
} from "./file.js";
import {
  systemInfo, systemLock, systemDnd,
  osGetConfig, osSetConfig, osDarkMode, osDns, osProxy,
  snapshotCreate, snapshotList, snapshotRollback,
  envGet, envSet, envUnset, envList,
  defaultsRead, defaultsWrite, defaultsDelete,
  timezoneGet, timezoneSet, localeGet, localeSet,
  powerBattery, powerSleep, powerShutdown, powerRestart, powerScheduleWake,
  startupList, startupAdd, startupRemove,
  loginItems, loginAdd, loginRemove,
  userList, userCurrent, userGroups,
  scheduleList, scheduleCreate, scheduleRemove,
  wifiToggle, searchSpotlight,
} from "./system.js";
import {
  serviceList, serviceStatus, serviceStart, serviceStop, serviceRestart, serviceEnable, serviceDisable,
} from "./service.js";
import {
  packageList, packageInstall, packageRemove, packageUpgrade, packageUpgradeAll, packageSearch,
  softwareInstall, softwareUninstall, softwareUpdate,
  softwareBrewInstall, softwareBrewUninstall, softwareBrewList, softwareBrewSearch,
  softwareBrewUpdate, softwareBrewUpgrade, softwareBrewInfo, softwareBrewServices, softwareBrewDoctor,
  softwareNpmInstall, softwareNpmUninstall, softwareNpmList, softwareNpmRun, softwareNpmInit,
  softwareNpmSearch, softwareNpmOutdated, softwareNpmUpdate,
  softwarePipInstall, softwarePipUninstall, softwarePipList, softwarePipFreeze, softwarePipSearch, softwarePipShowVenvs,
  softwareGetEnv, softwareSetEnv, softwareUnsetEnv, softwareListEnv, softwareExportEnv,
  softwareGetSystemInfo, softwareGetDiskUsage, softwareGetMemoryUsage, softwareGetProcessorUsage, softwareGetNetworkInterfaces,
  softwareGetNodeVersions, softwareSetNodeVersion, softwareGetPythonVersions, softwareSetPythonVersion, softwareGetRubyVersions,
  softwareCaskInstall, softwareCaskUninstall, softwareCaskList, softwareCaskSearch,
  softwareGetInstalledApps, softwareGetAppInfo, softwareIsAppInstalled,
} from "./package.js";
import {
  networkInterfaces, networkWifiConnect, networkWifiDisconnect, networkFirewall, networkFirewallToggle,
  networkOpenPorts, networkConnections, networkRoutes, networkPing, networkTraceroute, networkVpn,
  firewallRules, firewallAddRule, firewallBlockIP, firewallUnblockIP, firewallBlockPort, firewallAllowPort,
  sshList, sshGenerate, securityVpnToggle, securityDnsSet, securityProxySet,
} from "./network.js";
import {
  audioDevices, audioSetOutput, audioSetInput, audioMute, audioSources, audioDefaultOutput, audioDefaultInput, audioMuted, audioToggleMute,
  hardwareGetVolume, hardwareSetVolume, hardwareMute, hardwareUnmute, hardwareToggleMute, hardwareGetInputVolume, hardwareSetInputVolume, hardwareListAudioDevices,
  displayBrightness, displayList, displaySetResolution, displayNightShift, displayNightshift,
  hardwareGetBrightness, hardwareSetBrightness, hardwareGetNightShift, hardwareSetNightShift,
  hardwareListDisplays, hardwareGetResolution, hardwareSetResolution, hardwareIsDarkMode, hardwareSetDarkMode, hardwareGetAppearance,
  bluetoothStatus, bluetoothToggle, bluetoothDevices,
  hardwareGetBluetoothStatus, hardwareEnableBluetooth, hardwareDisableBluetooth,
  hardwareListBluetoothDevices, hardwareConnectBluetooth, hardwareDisconnectBluetooth,
  diskEject, volumeList, volumeMount, volumeUnmount,
  keyboardLayouts, keyboardSetLayout,
  hardwareGetKeyboardBacklight, hardwareSetKeyboardBacklight, hardwareIsKeyboardBacklightAuto,
  printerList, printerDefault, printerPrint, printerQueue,
  memoryPressure, memorySwap, memoryTopProcesses, memoryPurge, memoryVmstats,
  kernelSysctl, kernelPower,
  hardwareGetBatteryStatus, hardwareGetSleepSettings, hardwarePreventSleep, hardwareAllowSleep,
  hardwareSleep, hardwareRestart, hardwareShutdown,
  hardwareListUSBDevices, hardwareListThunderboltDevices, hardwareGetInputDevices, hardwareEjectDisk,
  hardwareGetWifiInfo, hardwareGetWifiNetworks, hardwareConnectToWifi,
  hardwareEject, hardwarePrint, hardwareWebcamLock, hardwareMicLock, hardwareHealth,
} from "./hardware.js";
import {
  browserOpen, browserNewTab, browserCloseTab, browserFillForm, browserScrape, browserDownload, browserBookmark,
  browserListTabs, browserGetActiveTab, browserSwitchTab, browserReloadTab, browserDuplicateTab,
  browserNavigateTo, browserGoBack, browserGoForward, browserGetUrl, browserGetTitle, browserGetPageSource,
  browserExecuteJs, browserQuerySelector, browserQuerySelectorAll, browserGetElementText, browserGetElementAttribute,
  browserFillInput, browserClickElement, browserSubmitForm, browserSelectOption,
  browserGetCookies, browserSetCookie, browserGetLocalStorage, browserSetLocalStorage,
  browserScreenshot, browserSavePdf, browserStartHeadless, browserStopHeadless, browserIsHeadlessRunning, browserExecuteInHeadless,
  browserPinTab, browserMuteTab, browserUnmuteTab, browserGetTabMemory,
  browserGetDownloads, browserClearDownloads, browserGetDownloadDirectory,
  browserGetBookmarks, browserAddBookmark, browserSearchBookmarks,
  browserGetHistory, browserGetPageLoadTime, browserGetNetworkRequests, browserBlockUrls,
} from "./browser-intents.js";
import {
  windowMinimize, windowMaximize, windowRestore, windowSnap, windowFocus,
  uiFind, uiMove, uiClickAt, uiDoubleClickAt, uiDrag, uiType, uiKey, uiScroll, uiWait,
  uiHighlight, uiDesktopSwitch, screenRecordStart, screenRecordStop,
  clipboardGet, clipboardSet, clipboardHistory, clipboardClear,
} from "./ui.js";
import {
  fleetDiscoverDevices, fleetGetDeviceStatus, fleetPingDevice, fleetGetDeviceInfo, fleetListOnlineDevices, fleetGetFleetOverview,
  fleetSendTask, fleetBroadcastTask, fleetGetTaskStatus, fleetCancelTask, fleetCollectResults,
  fleetSendFile, fleetRequestFile, fleetSyncDirectory, fleetGetRemoteFileList, fleetSyncClipboard, fleetSendNotification, fleetGetRemoteClipboard,
  fleetStartHeartbeat, fleetStopHeartbeat, fleetGetHealthHistory,
  fleetCreateTaskGroup, fleetGetTaskGroupStatus, fleetCancelTaskGroup,
  fleetScheduleTask, fleetSyncConfig, fleetGetRemoteConfig, fleetBroadcastConfig,
  fleetGetFleetMetrics, fleetGetDeviceMetrics, fleetSetAlertThresholds,
  fleetEnableMeshRelay, fleetGetNetworkTopology, fleetFindBestRoute, fleetWakeDevice, fleetGetDeviceMacAddress,
} from "./fleet-intents.js";
import {
  shellType, shellConfig, shellAddAlias, shellRemoveAlias, shellAliases, shellAddToPath, shellHistory,
  nlToCommand,
  gitStatus, gitCommit, gitPush, gitPull, gitBranch,
  dockerPs, dockerStart, dockerStop, dockerCompose, dockerStatus,
  containerList, containerStart, containerStop, containerRemove, containerLogs, containerImages, containerPull,
  vmList, vmStart, vmStop,
  devOpenTerminal, devRunCommand, devRunCommandAsync, devGetRunningShells, devGetShellHistory, devGetEnvironment,
  devGitStatus, devGitLog, devGitDiff, devGitBranches, devGitCommit, devGitPush, devGitPull, devGitClone,
  devOpenInEditor, devOpenProject, devGetOpenEditors, devSearchInProject, devGetProjectStructure,
  devDockerPs, devDockerImages, devDockerRun, devDockerStop, devDockerLogs, devDockerCompose,
  logAnalyze,
} from "./dev.js";
import {
  mediaToggle, mediaNext, mediaPrevious, mediaInfo,
  mediaPlay, mediaPause, mediaTogglePlayPause, mediaNextTrack, mediaPreviousTrack,
  mediaGetCurrentTrack, mediaSetPosition, mediaGetQueue, mediaGetPlayerVolume, mediaSetPlayerVolume,
  mediaGetAudioOutput, mediaSetAudioOutput, mediaGetPlaylists, mediaPlayPlaylist,
  mediaAddToPlaylist, mediaCreatePlaylist, mediaSearchTracks,
  mediaGetAirPlayDevices, mediaSetAirPlayDevice, mediaIsAirPlaying, mediaStopAirPlay,
  mediaGetVideoPlayers, mediaControlVideo, mediaGetVideoInfo, mediaSetVideoPosition,
  visionModalDetect, visionModalDismiss, visionCaptchaDetect, visionTableDetect, visionTableExtract,
  visionA11yAudit, visionLanguageDetect, visionTranslate, visionOcr, visionContext, visionOrganizeDesktop,
} from "./media.js";
import {
  emailCompose, calendarCreate, reminderCreate,
  commSendEmail, commGetUnreadEmails, commReadEmail, commSearchEmails, commGetMailboxes,
  commSendMessage, commGetRecentMessages, commSearchMessages,
  commGetEvents, commCreateEvent, commDeleteEvent, commGetCalendars, commGetUpcomingEvents,
  commSendNotification, commGetRecentNotifications, commClearNotifications,
  commSearchContacts, commGetContactDetails, commAddContact, commGetContactGroups,
  commSendEmailWithAttachment, commGetEmailAccounts, commMoveEmail, commFlagEmail,
  commStartFaceTimeCall, commEndFaceTimeCall, commIsFaceTimeActive,
  commGetReminders, commCreateReminder, commCompleteReminder, commGetReminderLists, commDeleteReminder,
  commGetNotes, commCreateNote, commSearchNotes, commGetNoteFolders,
} from "./comm.js";
import {
  maintenanceDiskCleanup, maintenanceNetworkFix, maintenanceKillMemoryLeaks,
  healthNotify, healthDiskRescue, healthNetworkDiagnose, healthSecurityScan, healthThermal, healthBattery,
  healthFilesystem, healthCertExpiry, healthLogAnomalies, healthSmartDisk, healthSocketStats,
  maintGetDiskUsage, maintGetLargeFiles, maintCleanTempFiles, maintCleanDownloads, maintEmptyTrash,
  maintGetDirectorySize, maintListCaches, maintClearAppCache, maintClearBrowserCache, maintClearDeveloperCaches, maintGetCacheSize,
  maintListProcesses, maintKillProcess, maintKillByName, maintGetProcessInfo, maintGetResourceHogs, maintGetZombieProcesses,
  maintGetSystemLogs, maintGetAppLogs, maintClearUserLogs, maintGetLogSize,
  maintRepairPermissions, maintVerifyDisk, maintFlushDNS, maintRebuildSpotlight, maintGetStartupItems,
  logSystem, logApp, logSearch, logSize, logClean,
  certList, certInstall, gpgList,
  updateCheck, updateInstall, updateInstallAll, updateOsVersion,
  backupTimemachine, backupStart, backupList, backupRsync,
  fontList, fontInstall,
  securityScan, securityVaultGet, securityEncrypt, securityShred,
} from "./maintenance.js";
import {
  hybridVoice, hybridMigrationScan, hybridMigrationPlan, hybridMigrationExecute,
  hybridMacroStart, hybridMacroStop, hybridMacroInfer, hybridMacroSave, hybridMacroList, hybridMacroRun,
  hybridSpeak, hybridGenerateScript, hybridSuggestAction, hybridOrchestrateApps,
  hybridStateDefine, hybridStateCheck, hybridStateEnforce, hybridStateStartLoop, hybridStateStopLoop,
  hybridCheckpointRecord, hybridCheckpointList, hybridCheckpointRollback, hybridCheckpointUndo,
  hybridContextSerialize, hybridContextSend, hybridContextReceive,
  hybridProfileAnalyze, hybridProfileSuggest, hybridProfileGet,
  hybridTemplates, hybridRunTemplate, hybridAnalyzeError, hybridOrganizeFiles, hybridHealthReport,
  hybridMachineDiff, hybridCompliance, hybridDocs, hybridForecast, hybridExtensions, hybridPlugins,
  learningDetectHabits, learningSuggestMacro, learningHealthReminder, learningPrefetch,
  workflowResearch, workflowDataEntry, workflowMeeting, workflowDev,
  genericExecute, alarmSet,
} from "./hybrid-intents.js";
import {
  wifiScan, wifiDetails, wifiMonitorStart, wifiMonitorStop,
  networkCapture, networkScanHosts, networkScanPorts, networkDns, networkWhois,
  securityTools, securityAudit,
} from "./security.js";

export { IntentRegistry } from "./types.js";
export type { StructuredResponse, HandlerContext, HandlerLayers, IntentHandler } from "./types.js";

export const intentRegistry = new IntentRegistry();

// ── Siri-class handlers ───────────────────────────────────────────────────────
intentRegistry.register("timer.set", timerSet);
intentRegistry.register("timer.cancel", timerCancel);
intentRegistry.register("timer.list", timerList);
intentRegistry.register("note.create", noteCreate);
intentRegistry.register("note.list", noteList);
intentRegistry.register("note.search", noteSearch);
intentRegistry.register("reminder.set", reminderSet);
intentRegistry.register("reminder.list", reminderList);
intentRegistry.register("reminder.cancel", reminderCancel);
intentRegistry.register("calendar.today", calendarToday);
intentRegistry.register("calendar.next", calendarNext);

// ── Previously migrated tool adapters ────────────────────────────────────────

intentRegistry.register(
  "app.launch",
  async (args, ctx: HandlerContext): Promise<StructuredResponse> => {
    const name = String(args.name ?? args.app ?? "").trim();
    const success = await ctx.layers.deep.launchApp(name);
    if (success) {
      return { speak: `Launched ${name}.`, data: { success: true } };
    }
    const fallback = await ctx.layers.deep.openDefaultBrowser(name);
    return {
      speak: fallback
        ? `App "${name}" not found. Opened in default browser instead.`
        : `Unable to launch "${name}".`,
      data: { success: fallback, fallback: fallback ? "default-browser" : "none" },
    };
  },
);

intentRegistry.register(
  "shell.exec",
  async (args, ctx: HandlerContext): Promise<StructuredResponse> => {
    const command = String(args.command ?? "").trim();
    if (!command) return { speak: "No command provided." };
    const output = ctx.layers.deep.exec(command);
    return { speak: `Command executed.`, data: { output } };
  },
);

intentRegistry.register(
  "network.wifi",
  async (_args, ctx: HandlerContext): Promise<StructuredResponse> => {
    const wifi = await ctx.layers.deepOS?.getWiFiStatus() ?? null;
    return { speak: "Wi-Fi status retrieved.", data: { wifi } };
  },
);

intentRegistry.register(
  "audio.volume",
  async (args, ctx: HandlerContext): Promise<StructuredResponse> => {
    const deepOS = ctx.layers.deepOS;
    if (args.level !== undefined && deepOS?.setVolume) {
      const success = await deepOS.setVolume(Number(args.level));
      return { speak: `Volume set to ${args.level}.`, data: { success } };
    }
    const level = deepOS?.getVolume ? await deepOS.getVolume() : null;
    return { speak: `Current volume is ${level ?? "unknown"}.`, data: { level } };
  },
);

intentRegistry.register(
  "ui.click",
  async (args, ctx: HandlerContext): Promise<StructuredResponse> => {
    const button = (args.button as "left" | "right" | "middle" | undefined) ?? "left";
    const x = args.x as number | undefined;
    const y = args.y as number | undefined;
    const surface = ctx.layers.surface;

    if (typeof x === "number" && typeof y === "number") {
      await surface.moveMouse(x, y);
      await surface.click(button);
      return { speak: `Clicked at (${x}, ${y}).`, data: {} };
    }

    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (query) {
      const found = await surface.findElement(query);
      if (found) {
        await surface.clickElement(found);
        return { speak: `Clicked element "${query}".`, data: {} };
      }
      throw new Error(`ui.click target not found for query: ${query}`);
    }

    throw new Error("ui.click requires element, query, or x/y coordinates");
  },
);

// ── Process ───────────────────────────────────────────────────────────────────
intentRegistry.register("process.restart", processRestart);
intentRegistry.register("process.renice", processRenice);
intentRegistry.register("process.details", processDetails);
intentRegistry.register("process.list", processList);
intentRegistry.register("process.kill", processKill);

// ── App ───────────────────────────────────────────────────────────────────────
intentRegistry.register("app.activate", appActivate);
intentRegistry.register("app.quit", appQuit);
intentRegistry.register("app.script", appScript);
intentRegistry.register("app.resolve", appResolve);
intentRegistry.register("app.install", appInstall);
intentRegistry.register("app.launchWithContext", appLaunchWithContext);
intentRegistry.register("app.chat", appChat);

// ── File ──────────────────────────────────────────────────────────────────────
intentRegistry.register("file.read", fileRead);
intentRegistry.register("file.write", fileWrite);
intentRegistry.register("file.permissions", filePermissions);
intentRegistry.register("file.chmod", fileChmod);
intentRegistry.register("file.chown", fileChown);
intentRegistry.register("file.create", fileCreate);
intentRegistry.register("file.copy", fileCopy);
intentRegistry.register("file.move", fileMove);
intentRegistry.register("file.rename.batch", fileRenameBatch);
intentRegistry.register("file.delete", fileDelete);
intentRegistry.register("file.search", fileSearch);
intentRegistry.register("file.zip", fileZip);
intentRegistry.register("file.unzip", fileUnzip);
intentRegistry.register("file.organizeDesktop", fileOrganizeDesktop);
intentRegistry.register("file.list", fileList);
intentRegistry.register("file.metadata", fileMetadata);
intentRegistry.register("file.exists", fileExists);
intentRegistry.register("file.size", fileSize);
intentRegistry.register("file.hash", fileHash);
intentRegistry.register("file.touch", fileTouch);
intentRegistry.register("file.append", fileAppend);
intentRegistry.register("file.symlink", fileSymlink);
intentRegistry.register("file.resolveSymlink", fileResolveSymlink);
intentRegistry.register("file.diskSpace", fileDiskSpace);
intentRegistry.register("file.compare", fileCompare);
intentRegistry.register("file.mkdir", fileMkdir);
intentRegistry.register("file.readBuffer", fileReadBuffer);
intentRegistry.register("file.getPermissions", fileGetPermissions);
intentRegistry.register("file.setPermissions", fileSetPermissions);
intentRegistry.register("file.watch", fileWatch);

// ── System ────────────────────────────────────────────────────────────────────
intentRegistry.register("system.info", systemInfo);
intentRegistry.register("system.lock", systemLock);
intentRegistry.register("system.dnd", systemDnd);
intentRegistry.register("system.focus", systemDnd);
intentRegistry.register("os.getConfig", osGetConfig);
intentRegistry.register("os.setConfig", osSetConfig);
intentRegistry.register("os.darkMode", osDarkMode);
intentRegistry.register("os.dns", osDns);
intentRegistry.register("os.proxy", osProxy);
intentRegistry.register("snapshot.create", snapshotCreate);
intentRegistry.register("snapshot.list", snapshotList);
intentRegistry.register("snapshot.rollback", snapshotRollback);
intentRegistry.register("env.get", envGet);
intentRegistry.register("env.set", envSet);
intentRegistry.register("env.unset", envUnset);
intentRegistry.register("env.list", envList);
intentRegistry.register("defaults.read", defaultsRead);
intentRegistry.register("defaults.write", defaultsWrite);
intentRegistry.register("defaults.delete", defaultsDelete);
intentRegistry.register("timezone.get", timezoneGet);
intentRegistry.register("timezone.set", timezoneSet);
intentRegistry.register("locale.get", localeGet);
intentRegistry.register("locale.set", localeSet);
intentRegistry.register("power.battery", powerBattery);
intentRegistry.register("power.sleep", powerSleep);
intentRegistry.register("power.shutdown", powerShutdown);
intentRegistry.register("power.restart", powerRestart);
intentRegistry.register("power.scheduleWake", powerScheduleWake);
intentRegistry.register("startup.list", startupList);
intentRegistry.register("startup.add", startupAdd);
intentRegistry.register("startup.remove", startupRemove);
intentRegistry.register("login.items", loginItems);
intentRegistry.register("login.add", loginAdd);
intentRegistry.register("login.remove", loginRemove);
intentRegistry.register("user.list", userList);
intentRegistry.register("user.current", userCurrent);
intentRegistry.register("user.groups", userGroups);
intentRegistry.register("schedule.list", scheduleList);
intentRegistry.register("schedule.create", scheduleCreate);
intentRegistry.register("schedule.remove", scheduleRemove);
intentRegistry.register("wifi.toggle", wifiToggle);
intentRegistry.register("search.spotlight", searchSpotlight);
intentRegistry.register("search.files", searchSpotlight);

// ── Service ───────────────────────────────────────────────────────────────────
intentRegistry.register("service.list", serviceList);
intentRegistry.register("service.status", serviceStatus);
intentRegistry.register("service.start", serviceStart);
intentRegistry.register("service.stop", serviceStop);
intentRegistry.register("service.restart", serviceRestart);
intentRegistry.register("service.enable", serviceEnable);
intentRegistry.register("service.disable", serviceDisable);

// ── Package / Software ────────────────────────────────────────────────────────
intentRegistry.register("package.list", packageList);
intentRegistry.register("package.install", packageInstall);
intentRegistry.register("package.remove", packageRemove);
intentRegistry.register("package.upgrade", packageUpgrade);
intentRegistry.register("package.upgradeAll", packageUpgradeAll);
intentRegistry.register("package.search", packageSearch);
intentRegistry.register("software.install", softwareInstall);
intentRegistry.register("software.uninstall", softwareUninstall);
intentRegistry.register("software.update", softwareUpdate);
intentRegistry.register("software.brewInstall", softwareBrewInstall);
intentRegistry.register("software.brewUninstall", softwareBrewUninstall);
intentRegistry.register("software.brewList", softwareBrewList);
intentRegistry.register("software.brewSearch", softwareBrewSearch);
intentRegistry.register("software.brewUpdate", softwareBrewUpdate);
intentRegistry.register("software.brewUpgrade", softwareBrewUpgrade);
intentRegistry.register("software.brewInfo", softwareBrewInfo);
intentRegistry.register("software.brewServices", softwareBrewServices);
intentRegistry.register("software.brewDoctor", softwareBrewDoctor);
intentRegistry.register("software.npmInstall", softwareNpmInstall);
intentRegistry.register("software.npmUninstall", softwareNpmUninstall);
intentRegistry.register("software.npmList", softwareNpmList);
intentRegistry.register("software.npmRun", softwareNpmRun);
intentRegistry.register("software.npmInit", softwareNpmInit);
intentRegistry.register("software.npmSearch", softwareNpmSearch);
intentRegistry.register("software.npmOutdated", softwareNpmOutdated);
intentRegistry.register("software.npmUpdate", softwareNpmUpdate);
intentRegistry.register("software.pipInstall", softwarePipInstall);
intentRegistry.register("software.pipUninstall", softwarePipUninstall);
intentRegistry.register("software.pipList", softwarePipList);
intentRegistry.register("software.pipFreeze", softwarePipFreeze);
intentRegistry.register("software.pipSearch", softwarePipSearch);
intentRegistry.register("software.pipShowVenvs", softwarePipShowVenvs);
intentRegistry.register("software.getEnv", softwareGetEnv);
intentRegistry.register("software.setEnv", softwareSetEnv);
intentRegistry.register("software.unsetEnv", softwareUnsetEnv);
intentRegistry.register("software.listEnv", softwareListEnv);
intentRegistry.register("software.exportEnv", softwareExportEnv);
intentRegistry.register("software.getSystemInfo", softwareGetSystemInfo);
intentRegistry.register("software.getDiskUsage", softwareGetDiskUsage);
intentRegistry.register("software.getMemoryUsage", softwareGetMemoryUsage);
intentRegistry.register("software.getProcessorUsage", softwareGetProcessorUsage);
intentRegistry.register("software.getNetworkInterfaces", softwareGetNetworkInterfaces);
intentRegistry.register("software.getNodeVersions", softwareGetNodeVersions);
intentRegistry.register("software.setNodeVersion", softwareSetNodeVersion);
intentRegistry.register("software.getPythonVersions", softwareGetPythonVersions);
intentRegistry.register("software.setPythonVersion", softwareSetPythonVersion);
intentRegistry.register("software.getRubyVersions", softwareGetRubyVersions);
intentRegistry.register("software.caskInstall", softwareCaskInstall);
intentRegistry.register("software.caskUninstall", softwareCaskUninstall);
intentRegistry.register("software.caskList", softwareCaskList);
intentRegistry.register("software.caskSearch", softwareCaskSearch);
intentRegistry.register("software.getInstalledApps", softwareGetInstalledApps);
intentRegistry.register("software.getAppInfo", softwareGetAppInfo);
intentRegistry.register("software.isAppInstalled", softwareIsAppInstalled);

// ── Network ───────────────────────────────────────────────────────────────────
intentRegistry.register("network.interfaces", networkInterfaces);
intentRegistry.register("network.wifiConnect", networkWifiConnect);
intentRegistry.register("network.wifiDisconnect", networkWifiDisconnect);
intentRegistry.register("network.firewall", networkFirewall);
intentRegistry.register("network.firewallToggle", networkFirewallToggle);
intentRegistry.register("network.openPorts", networkOpenPorts);
intentRegistry.register("network.connections", networkConnections);
intentRegistry.register("network.routes", networkRoutes);
intentRegistry.register("network.ping", networkPing);
intentRegistry.register("network.traceroute", networkTraceroute);
intentRegistry.register("network.vpn", networkVpn);
intentRegistry.register("firewall.rules", firewallRules);
intentRegistry.register("firewall.addRule", firewallAddRule);
intentRegistry.register("firewall.blockIP", firewallBlockIP);
intentRegistry.register("firewall.unblockIP", firewallUnblockIP);
intentRegistry.register("firewall.blockPort", firewallBlockPort);
intentRegistry.register("firewall.allowPort", firewallAllowPort);
intentRegistry.register("ssh.list", sshList);
intentRegistry.register("ssh.generate", sshGenerate);
intentRegistry.register("security.vpn.toggle", securityVpnToggle);
intentRegistry.register("security.dns.set", securityDnsSet);
intentRegistry.register("security.proxy.set", securityProxySet);

// ── Security / Pentest ──────────────────────────────────────────────────────
intentRegistry.register("wifi.scan", wifiScan);
intentRegistry.register("wifi.details", wifiDetails);
intentRegistry.register("wifi.monitor.start", wifiMonitorStart);
intentRegistry.register("wifi.monitor.stop", wifiMonitorStop);
intentRegistry.register("network.capture", networkCapture);
intentRegistry.register("network.scan.hosts", networkScanHosts);
intentRegistry.register("network.scan.ports", networkScanPorts);
intentRegistry.register("network.dns", networkDns);
intentRegistry.register("network.whois", networkWhois);
intentRegistry.register("security.tools", securityTools);
intentRegistry.register("security.audit", securityAudit);

// ── Hardware / Audio / Display ────────────────────────────────────────────────
intentRegistry.register("audio.devices", audioDevices);
intentRegistry.register("audio.setOutput", audioSetOutput);
intentRegistry.register("audio.setInput", audioSetInput);
intentRegistry.register("audio.mute", audioMute);
intentRegistry.register("audio.sources", audioSources);
intentRegistry.register("audio.defaultOutput", audioDefaultOutput);
intentRegistry.register("audio.defaultInput", audioDefaultInput);
intentRegistry.register("audio.muted", audioMuted);
intentRegistry.register("audio.toggleMute", audioToggleMute);
intentRegistry.register("hardware.getVolume", hardwareGetVolume);
intentRegistry.register("hardware.setVolume", hardwareSetVolume);
intentRegistry.register("hardware.mute", hardwareMute);
intentRegistry.register("hardware.unmute", hardwareUnmute);
intentRegistry.register("hardware.toggleMute", hardwareToggleMute);
intentRegistry.register("hardware.getInputVolume", hardwareGetInputVolume);
intentRegistry.register("hardware.setInputVolume", hardwareSetInputVolume);
intentRegistry.register("hardware.listAudioDevices", hardwareListAudioDevices);
intentRegistry.register("display.brightness", displayBrightness);
intentRegistry.register("display.list", displayList);
intentRegistry.register("display.setResolution", displaySetResolution);
intentRegistry.register("display.nightShift", displayNightShift);
intentRegistry.register("display.nightshift", displayNightshift);
intentRegistry.register("hardware.getBrightness", hardwareGetBrightness);
intentRegistry.register("hardware.setBrightness", hardwareSetBrightness);
intentRegistry.register("hardware.getNightShift", hardwareGetNightShift);
intentRegistry.register("hardware.setNightShift", hardwareSetNightShift);
intentRegistry.register("hardware.listDisplays", hardwareListDisplays);
intentRegistry.register("hardware.getResolution", hardwareGetResolution);
intentRegistry.register("hardware.setResolution", hardwareSetResolution);
intentRegistry.register("hardware.isDarkMode", hardwareIsDarkMode);
intentRegistry.register("hardware.setDarkMode", hardwareSetDarkMode);
intentRegistry.register("hardware.getAppearance", hardwareGetAppearance);
intentRegistry.register("bluetooth.status", bluetoothStatus);
intentRegistry.register("bluetooth.toggle", bluetoothToggle);
intentRegistry.register("bluetooth.devices", bluetoothDevices);
intentRegistry.register("hardware.getBluetoothStatus", hardwareGetBluetoothStatus);
intentRegistry.register("hardware.enableBluetooth", hardwareEnableBluetooth);
intentRegistry.register("hardware.disableBluetooth", hardwareDisableBluetooth);
intentRegistry.register("hardware.listBluetoothDevices", hardwareListBluetoothDevices);
intentRegistry.register("hardware.connectBluetooth", hardwareConnectBluetooth);
intentRegistry.register("hardware.disconnectBluetooth", hardwareDisconnectBluetooth);
intentRegistry.register("disk.eject", diskEject);
intentRegistry.register("volume.list", volumeList);
intentRegistry.register("volume.mount", volumeMount);
intentRegistry.register("volume.unmount", volumeUnmount);
intentRegistry.register("keyboard.layouts", keyboardLayouts);
intentRegistry.register("keyboard.setLayout", keyboardSetLayout);
intentRegistry.register("hardware.getKeyboardBacklight", hardwareGetKeyboardBacklight);
intentRegistry.register("hardware.setKeyboardBacklight", hardwareSetKeyboardBacklight);
intentRegistry.register("hardware.isKeyboardBacklightAuto", hardwareIsKeyboardBacklightAuto);
intentRegistry.register("printer.list", printerList);
intentRegistry.register("printer.default", printerDefault);
intentRegistry.register("printer.print", printerPrint);
intentRegistry.register("printer.queue", printerQueue);
intentRegistry.register("memory.pressure", memoryPressure);
intentRegistry.register("memory.swap", memorySwap);
intentRegistry.register("memory.topProcesses", memoryTopProcesses);
intentRegistry.register("memory.purge", memoryPurge);
intentRegistry.register("memory.vmstats", memoryVmstats);
intentRegistry.register("kernel.sysctl", kernelSysctl);
intentRegistry.register("kernel.power", kernelPower);
intentRegistry.register("hardware.getBatteryStatus", hardwareGetBatteryStatus);
intentRegistry.register("hardware.getSleepSettings", hardwareGetSleepSettings);
intentRegistry.register("hardware.preventSleep", hardwarePreventSleep);
intentRegistry.register("hardware.allowSleep", hardwareAllowSleep);
intentRegistry.register("hardware.sleep", hardwareSleep);
intentRegistry.register("hardware.restart", hardwareRestart);
intentRegistry.register("hardware.shutdown", hardwareShutdown);
intentRegistry.register("hardware.listUSBDevices", hardwareListUSBDevices);
intentRegistry.register("hardware.listThunderboltDevices", hardwareListThunderboltDevices);
intentRegistry.register("hardware.getInputDevices", hardwareGetInputDevices);
intentRegistry.register("hardware.ejectDisk", hardwareEjectDisk);
intentRegistry.register("hardware.getWifiInfo", hardwareGetWifiInfo);
intentRegistry.register("hardware.getWifiNetworks", hardwareGetWifiNetworks);
intentRegistry.register("hardware.connectToWifi", hardwareConnectToWifi);
intentRegistry.register("hardware.eject", hardwareEject);
intentRegistry.register("hardware.print", hardwarePrint);
intentRegistry.register("hardware.webcam.lock", hardwareWebcamLock);
intentRegistry.register("hardware.mic.lock", hardwareMicLock);
intentRegistry.register("hardware.health", hardwareHealth);

// ── Browser ───────────────────────────────────────────────────────────────────
intentRegistry.register("browser.open", browserOpen);
intentRegistry.register("browser.newTab", browserNewTab);
intentRegistry.register("browser.closeTab", browserCloseTab);
intentRegistry.register("browser.fillForm", browserFillForm);
intentRegistry.register("form.fill", browserFillForm);
intentRegistry.register("browser.scrape", browserScrape);
intentRegistry.register("web.scrape", browserScrape);
intentRegistry.register("browser.download", browserDownload);
intentRegistry.register("web.download", browserDownload);
intentRegistry.register("browser.bookmark", browserBookmark);
intentRegistry.register("browser.listTabs", browserListTabs);
intentRegistry.register("browser.getActiveTab", browserGetActiveTab);
intentRegistry.register("browser.switchTab", browserSwitchTab);
intentRegistry.register("browser.reloadTab", browserReloadTab);
intentRegistry.register("browser.duplicateTab", browserDuplicateTab);
intentRegistry.register("browser.navigateTo", browserNavigateTo);
intentRegistry.register("browser.goBack", browserGoBack);
intentRegistry.register("browser.goForward", browserGoForward);
intentRegistry.register("browser.getUrl", browserGetUrl);
intentRegistry.register("browser.getTitle", browserGetTitle);
intentRegistry.register("browser.getPageSource", browserGetPageSource);
intentRegistry.register("browser.executeJs", browserExecuteJs);
intentRegistry.register("browser.querySelector", browserQuerySelector);
intentRegistry.register("browser.querySelectorAll", browserQuerySelectorAll);
intentRegistry.register("browser.getElementText", browserGetElementText);
intentRegistry.register("browser.getElementAttribute", browserGetElementAttribute);
intentRegistry.register("browser.fillInput", browserFillInput);
intentRegistry.register("browser.clickElement", browserClickElement);
intentRegistry.register("browser.submitForm", browserSubmitForm);
intentRegistry.register("browser.selectOption", browserSelectOption);
intentRegistry.register("browser.getCookies", browserGetCookies);
intentRegistry.register("browser.setCookie", browserSetCookie);
intentRegistry.register("browser.getLocalStorage", browserGetLocalStorage);
intentRegistry.register("browser.setLocalStorage", browserSetLocalStorage);
intentRegistry.register("browser.screenshot", browserScreenshot);
intentRegistry.register("browser.savePdf", browserSavePdf);
intentRegistry.register("browser.startHeadless", browserStartHeadless);
intentRegistry.register("browser.stopHeadless", browserStopHeadless);
intentRegistry.register("browser.isHeadlessRunning", browserIsHeadlessRunning);
intentRegistry.register("browser.executeInHeadless", browserExecuteInHeadless);
intentRegistry.register("browser.pinTab", browserPinTab);
intentRegistry.register("browser.muteTab", browserMuteTab);
intentRegistry.register("browser.unmuteTab", browserUnmuteTab);
intentRegistry.register("browser.getTabMemory", browserGetTabMemory);
intentRegistry.register("browser.getDownloads", browserGetDownloads);
intentRegistry.register("browser.clearDownloads", browserClearDownloads);
intentRegistry.register("browser.getDownloadDirectory", browserGetDownloadDirectory);
intentRegistry.register("browser.getBookmarks", browserGetBookmarks);
intentRegistry.register("browser.addBookmark", browserAddBookmark);
intentRegistry.register("browser.searchBookmarks", browserSearchBookmarks);
intentRegistry.register("browser.getHistory", browserGetHistory);
intentRegistry.register("browser.getPageLoadTime", browserGetPageLoadTime);
intentRegistry.register("browser.getNetworkRequests", browserGetNetworkRequests);
intentRegistry.register("browser.blockUrls", browserBlockUrls);

// ── UI / Window / Screen / Clipboard ─────────────────────────────────────────
intentRegistry.register("window.minimize", windowMinimize);
intentRegistry.register("window.maximize", windowMaximize);
intentRegistry.register("window.fullscreen", windowMaximize);
intentRegistry.register("window.restore", windowRestore);
intentRegistry.register("window.split", windowSnap);
intentRegistry.register("window.snap", windowSnap);
intentRegistry.register("window.focus", windowFocus);
intentRegistry.register("ui.find", uiFind);
intentRegistry.register("ui.move", uiMove);
intentRegistry.register("ui.clickAt", uiClickAt);
intentRegistry.register("ui.doubleClickAt", uiDoubleClickAt);
intentRegistry.register("ui.drag", uiDrag);
intentRegistry.register("ui.type", uiType);
intentRegistry.register("ui.key", uiKey);
intentRegistry.register("ui.scroll", uiScroll);
intentRegistry.register("ui.wait", uiWait);
intentRegistry.register("ui.highlight", uiHighlight);
intentRegistry.register("ui.select", uiHighlight);
intentRegistry.register("ui.desktop.switch", uiDesktopSwitch);
intentRegistry.register("screen.record.start", screenRecordStart);
intentRegistry.register("screen.record.stop", screenRecordStop);
intentRegistry.register("clipboard.get", clipboardGet);
intentRegistry.register("clipboard.set", clipboardSet);
intentRegistry.register("clipboard.history", clipboardHistory);
intentRegistry.register("clipboard.clear", clipboardClear);

// ── Fleet ─────────────────────────────────────────────────────────────────────
intentRegistry.register("fleet.discoverDevices", fleetDiscoverDevices);
intentRegistry.register("fleet.getDeviceStatus", fleetGetDeviceStatus);
intentRegistry.register("fleet.pingDevice", fleetPingDevice);
intentRegistry.register("fleet.getDeviceInfo", fleetGetDeviceInfo);
intentRegistry.register("fleet.listOnlineDevices", fleetListOnlineDevices);
intentRegistry.register("fleet.getFleetOverview", fleetGetFleetOverview);
intentRegistry.register("fleet.sendTask", fleetSendTask);
intentRegistry.register("fleet.broadcastTask", fleetBroadcastTask);
intentRegistry.register("fleet.getTaskStatus", fleetGetTaskStatus);
intentRegistry.register("fleet.cancelTask", fleetCancelTask);
intentRegistry.register("fleet.collectResults", fleetCollectResults);
intentRegistry.register("fleet.sendFile", fleetSendFile);
intentRegistry.register("fleet.requestFile", fleetRequestFile);
intentRegistry.register("fleet.syncDirectory", fleetSyncDirectory);
intentRegistry.register("fleet.getRemoteFileList", fleetGetRemoteFileList);
intentRegistry.register("fleet.syncClipboard", fleetSyncClipboard);
intentRegistry.register("fleet.sendNotification", fleetSendNotification);
intentRegistry.register("fleet.getRemoteClipboard", fleetGetRemoteClipboard);
intentRegistry.register("fleet.startHeartbeat", fleetStartHeartbeat);
intentRegistry.register("fleet.stopHeartbeat", fleetStopHeartbeat);
intentRegistry.register("fleet.getHealthHistory", fleetGetHealthHistory);
intentRegistry.register("fleet.createTaskGroup", fleetCreateTaskGroup);
intentRegistry.register("fleet.getTaskGroupStatus", fleetGetTaskGroupStatus);
intentRegistry.register("fleet.cancelTaskGroup", fleetCancelTaskGroup);
intentRegistry.register("fleet.scheduleTask", fleetScheduleTask);
intentRegistry.register("fleet.syncConfig", fleetSyncConfig);
intentRegistry.register("fleet.getRemoteConfig", fleetGetRemoteConfig);
intentRegistry.register("fleet.broadcastConfig", fleetBroadcastConfig);
intentRegistry.register("fleet.getFleetMetrics", fleetGetFleetMetrics);
intentRegistry.register("fleet.getDeviceMetrics", fleetGetDeviceMetrics);
intentRegistry.register("fleet.setAlertThresholds", fleetSetAlertThresholds);
intentRegistry.register("fleet.enableMeshRelay", fleetEnableMeshRelay);
intentRegistry.register("fleet.getNetworkTopology", fleetGetNetworkTopology);
intentRegistry.register("fleet.findBestRoute", fleetFindBestRoute);
intentRegistry.register("fleet.wakeDevice", fleetWakeDevice);
intentRegistry.register("fleet.getDeviceMacAddress", fleetGetDeviceMacAddress);

// ── Dev / Shell / Git / Docker / Container / VM ───────────────────────────────
intentRegistry.register("shell.type", shellType);
intentRegistry.register("shell.config", shellConfig);
intentRegistry.register("shell.addAlias", shellAddAlias);
intentRegistry.register("shell.removeAlias", shellRemoveAlias);
intentRegistry.register("shell.aliases", shellAliases);
intentRegistry.register("shell.addToPath", shellAddToPath);
intentRegistry.register("shell.history", shellHistory);
intentRegistry.register("nl.toCommand", nlToCommand);
intentRegistry.register("shell.fromNL", nlToCommand);
intentRegistry.register("git.status", gitStatus);
intentRegistry.register("git.commit", gitCommit);
intentRegistry.register("git.push", gitPush);
intentRegistry.register("git.pull", gitPull);
intentRegistry.register("git.branch", gitBranch);
intentRegistry.register("docker.ps", dockerPs);
intentRegistry.register("docker.start", dockerStart);
intentRegistry.register("docker.stop", dockerStop);
intentRegistry.register("docker.compose", dockerCompose);
intentRegistry.register("docker.status", dockerStatus);
intentRegistry.register("container.list", containerList);
intentRegistry.register("container.start", containerStart);
intentRegistry.register("container.stop", containerStop);
intentRegistry.register("container.remove", containerRemove);
intentRegistry.register("container.logs", containerLogs);
intentRegistry.register("container.images", containerImages);
intentRegistry.register("container.pull", containerPull);
intentRegistry.register("vm.list", vmList);
intentRegistry.register("vm.start", vmStart);
intentRegistry.register("vm.stop", vmStop);
intentRegistry.register("dev.openTerminal", devOpenTerminal);
intentRegistry.register("dev.runCommand", devRunCommand);
intentRegistry.register("dev.runCommandAsync", devRunCommandAsync);
intentRegistry.register("dev.getRunningShells", devGetRunningShells);
intentRegistry.register("dev.getShellHistory", devGetShellHistory);
intentRegistry.register("dev.getEnvironment", devGetEnvironment);
intentRegistry.register("dev.gitStatus", devGitStatus);
intentRegistry.register("dev.gitLog", devGitLog);
intentRegistry.register("dev.gitDiff", devGitDiff);
intentRegistry.register("dev.gitBranches", devGitBranches);
intentRegistry.register("dev.gitCommit", devGitCommit);
intentRegistry.register("dev.gitPush", devGitPush);
intentRegistry.register("dev.gitPull", devGitPull);
intentRegistry.register("dev.gitClone", devGitClone);
intentRegistry.register("dev.openInEditor", devOpenInEditor);
intentRegistry.register("dev.openProject", devOpenProject);
intentRegistry.register("dev.getOpenEditors", devGetOpenEditors);
intentRegistry.register("dev.searchInProject", devSearchInProject);
intentRegistry.register("dev.getProjectStructure", devGetProjectStructure);
intentRegistry.register("dev.dockerPs", devDockerPs);
intentRegistry.register("dev.dockerImages", devDockerImages);
intentRegistry.register("dev.dockerRun", devDockerRun);
intentRegistry.register("dev.dockerStop", devDockerStop);
intentRegistry.register("dev.dockerLogs", devDockerLogs);
intentRegistry.register("dev.dockerCompose", devDockerCompose);
intentRegistry.register("log.analyze", logAnalyze);

// ── Media / Vision ────────────────────────────────────────────────────────────
intentRegistry.register("media.play", mediaPlay);
intentRegistry.register("media.pause", mediaPause);
intentRegistry.register("media.toggle", mediaToggle);
intentRegistry.register("media.next", mediaNext);
intentRegistry.register("media.previous", mediaPrevious);
intentRegistry.register("media.info", mediaInfo);
intentRegistry.register("media.togglePlayPause", mediaTogglePlayPause);
intentRegistry.register("media.nextTrack", mediaNextTrack);
intentRegistry.register("media.previousTrack", mediaPreviousTrack);
intentRegistry.register("media.getCurrentTrack", mediaGetCurrentTrack);
intentRegistry.register("media.setPosition", mediaSetPosition);
intentRegistry.register("media.getQueue", mediaGetQueue);
intentRegistry.register("media.getPlayerVolume", mediaGetPlayerVolume);
intentRegistry.register("media.setPlayerVolume", mediaSetPlayerVolume);
intentRegistry.register("media.getAudioOutput", mediaGetAudioOutput);
intentRegistry.register("media.setAudioOutput", mediaSetAudioOutput);
intentRegistry.register("media.getPlaylists", mediaGetPlaylists);
intentRegistry.register("media.playPlaylist", mediaPlayPlaylist);
intentRegistry.register("media.addToPlaylist", mediaAddToPlaylist);
intentRegistry.register("media.createPlaylist", mediaCreatePlaylist);
intentRegistry.register("media.searchTracks", mediaSearchTracks);
intentRegistry.register("media.getAirPlayDevices", mediaGetAirPlayDevices);
intentRegistry.register("media.setAirPlayDevice", mediaSetAirPlayDevice);
intentRegistry.register("media.isAirPlaying", mediaIsAirPlaying);
intentRegistry.register("media.stopAirPlay", mediaStopAirPlay);
intentRegistry.register("media.getVideoPlayers", mediaGetVideoPlayers);
intentRegistry.register("media.controlVideo", mediaControlVideo);
intentRegistry.register("media.getVideoInfo", mediaGetVideoInfo);
intentRegistry.register("media.setVideoPosition", mediaSetVideoPosition);
intentRegistry.register("vision.modal.detect", visionModalDetect);
intentRegistry.register("vision.modal.dismiss", visionModalDismiss);
intentRegistry.register("vision.captcha.detect", visionCaptchaDetect);
intentRegistry.register("vision.table.detect", visionTableDetect);
intentRegistry.register("vision.table.extract", visionTableExtract);
intentRegistry.register("vision.a11y.audit", visionA11yAudit);
intentRegistry.register("vision.language.detect", visionLanguageDetect);
intentRegistry.register("vision.translate", visionTranslate);
intentRegistry.register("vision.ocr", visionOcr);
intentRegistry.register("vision.context", visionContext);
intentRegistry.register("vision.summarize", visionContext);
intentRegistry.register("vision.organizeDesktop", visionOrganizeDesktop);

// ── Communication ─────────────────────────────────────────────────────────────
intentRegistry.register("email.compose", emailCompose);
intentRegistry.register("email.send", emailCompose);
intentRegistry.register("calendar.create", calendarCreate);
intentRegistry.register("reminder.create", reminderCreate);
intentRegistry.register("comm.sendEmail", commSendEmail);
intentRegistry.register("comm.getUnreadEmails", commGetUnreadEmails);
intentRegistry.register("comm.readEmail", commReadEmail);
intentRegistry.register("comm.searchEmails", commSearchEmails);
intentRegistry.register("comm.getMailboxes", commGetMailboxes);
intentRegistry.register("comm.sendMessage", commSendMessage);
intentRegistry.register("comm.getRecentMessages", commGetRecentMessages);
intentRegistry.register("comm.searchMessages", commSearchMessages);
intentRegistry.register("comm.getEvents", commGetEvents);
intentRegistry.register("comm.createEvent", commCreateEvent);
intentRegistry.register("comm.deleteEvent", commDeleteEvent);
intentRegistry.register("comm.getCalendars", commGetCalendars);
intentRegistry.register("comm.getUpcomingEvents", commGetUpcomingEvents);
intentRegistry.register("comm.sendNotification", commSendNotification);
intentRegistry.register("comm.getRecentNotifications", commGetRecentNotifications);
intentRegistry.register("comm.clearNotifications", commClearNotifications);
intentRegistry.register("comm.searchContacts", commSearchContacts);
intentRegistry.register("comm.getContactDetails", commGetContactDetails);
intentRegistry.register("comm.addContact", commAddContact);
intentRegistry.register("comm.getContactGroups", commGetContactGroups);
intentRegistry.register("comm.sendEmailWithAttachment", commSendEmailWithAttachment);
intentRegistry.register("comm.getEmailAccounts", commGetEmailAccounts);
intentRegistry.register("comm.moveEmail", commMoveEmail);
intentRegistry.register("comm.flagEmail", commFlagEmail);
intentRegistry.register("comm.startFaceTimeCall", commStartFaceTimeCall);
intentRegistry.register("comm.endFaceTimeCall", commEndFaceTimeCall);
intentRegistry.register("comm.isFaceTimeActive", commIsFaceTimeActive);
intentRegistry.register("comm.getReminders", commGetReminders);
intentRegistry.register("comm.createReminder", commCreateReminder);
intentRegistry.register("comm.completeReminder", commCompleteReminder);
intentRegistry.register("comm.getReminderLists", commGetReminderLists);
intentRegistry.register("comm.deleteReminder", commDeleteReminder);
intentRegistry.register("comm.getNotes", commGetNotes);
intentRegistry.register("comm.createNote", commCreateNote);
intentRegistry.register("comm.searchNotes", commSearchNotes);
intentRegistry.register("comm.getNoteFolders", commGetNoteFolders);

// ── Maintenance / Health / Log / Cert / Update / Backup / Security ────────────
intentRegistry.register("maintenance.diskCleanup", maintenanceDiskCleanup);
intentRegistry.register("maintenance.networkFix", maintenanceNetworkFix);
intentRegistry.register("maintenance.killMemoryLeaks", maintenanceKillMemoryLeaks);
intentRegistry.register("health.notify", healthNotify);
intentRegistry.register("health.diskRescue", healthDiskRescue);
intentRegistry.register("health.networkDiagnose", healthNetworkDiagnose);
intentRegistry.register("health.securityScan", healthSecurityScan);
intentRegistry.register("health.thermal", healthThermal);
intentRegistry.register("health.battery", healthBattery);
intentRegistry.register("health.filesystem", healthFilesystem);
intentRegistry.register("health.certExpiry", healthCertExpiry);
intentRegistry.register("health.logAnomalies", healthLogAnomalies);
intentRegistry.register("health.smartDisk", healthSmartDisk);
intentRegistry.register("health.socketStats", healthSocketStats);
intentRegistry.register("maint.getDiskUsage", maintGetDiskUsage);
intentRegistry.register("maint.getLargeFiles", maintGetLargeFiles);
intentRegistry.register("maint.cleanTempFiles", maintCleanTempFiles);
intentRegistry.register("maint.cleanDownloads", maintCleanDownloads);
intentRegistry.register("maint.emptyTrash", maintEmptyTrash);
intentRegistry.register("maint.getDirectorySize", maintGetDirectorySize);
intentRegistry.register("maint.listCaches", maintListCaches);
intentRegistry.register("maint.clearAppCache", maintClearAppCache);
intentRegistry.register("maint.clearBrowserCache", maintClearBrowserCache);
intentRegistry.register("maint.clearDeveloperCaches", maintClearDeveloperCaches);
intentRegistry.register("maint.getCacheSize", maintGetCacheSize);
intentRegistry.register("maint.listProcesses", maintListProcesses);
intentRegistry.register("maint.killProcess", maintKillProcess);
intentRegistry.register("maint.killByName", maintKillByName);
intentRegistry.register("maint.getProcessInfo", maintGetProcessInfo);
intentRegistry.register("maint.getResourceHogs", maintGetResourceHogs);
intentRegistry.register("maint.getZombieProcesses", maintGetZombieProcesses);
intentRegistry.register("maint.getSystemLogs", maintGetSystemLogs);
intentRegistry.register("maint.getAppLogs", maintGetAppLogs);
intentRegistry.register("maint.clearUserLogs", maintClearUserLogs);
intentRegistry.register("maint.getLogSize", maintGetLogSize);
intentRegistry.register("maint.repairPermissions", maintRepairPermissions);
intentRegistry.register("maint.verifyDisk", maintVerifyDisk);
intentRegistry.register("maint.flushDNS", maintFlushDNS);
intentRegistry.register("maint.rebuildSpotlight", maintRebuildSpotlight);
intentRegistry.register("maint.getStartupItems", maintGetStartupItems);
intentRegistry.register("log.system", logSystem);
intentRegistry.register("log.app", logApp);
intentRegistry.register("log.search", logSearch);
intentRegistry.register("log.size", logSize);
intentRegistry.register("log.clean", logClean);
intentRegistry.register("cert.list", certList);
intentRegistry.register("cert.install", certInstall);
intentRegistry.register("gpg.list", gpgList);
intentRegistry.register("update.check", updateCheck);
intentRegistry.register("update.install", updateInstall);
intentRegistry.register("update.installAll", updateInstallAll);
intentRegistry.register("update.osVersion", updateOsVersion);
intentRegistry.register("backup.timemachine", backupTimemachine);
intentRegistry.register("backup.start", backupStart);
intentRegistry.register("backup.list", backupList);
intentRegistry.register("backup.rsync", backupRsync);
intentRegistry.register("font.list", fontList);
intentRegistry.register("font.install", fontInstall);
intentRegistry.register("security.scan", securityScan);
intentRegistry.register("security.vault.get", securityVaultGet);
intentRegistry.register("security.encrypt", securityEncrypt);
intentRegistry.register("security.shred", securityShred);

// ── Hybrid / Learning / Workflow / Generic ────────────────────────────────────
intentRegistry.register("hybrid.voice", hybridVoice);
intentRegistry.register("hybrid.migration.scan", hybridMigrationScan);
intentRegistry.register("hybrid.migration.plan", hybridMigrationPlan);
intentRegistry.register("hybrid.migration.execute", hybridMigrationExecute);
intentRegistry.register("hybrid.macro.start", hybridMacroStart);
intentRegistry.register("hybrid.macro.stop", hybridMacroStop);
intentRegistry.register("hybrid.macro.infer", hybridMacroInfer);
intentRegistry.register("hybrid.macro.save", hybridMacroSave);
intentRegistry.register("hybrid.macro.list", hybridMacroList);
intentRegistry.register("hybrid.macro.run", hybridMacroRun);
intentRegistry.register("hybrid.speak", hybridSpeak);
intentRegistry.register("hybrid.generateScript", hybridGenerateScript);
intentRegistry.register("hybrid.suggestAction", hybridSuggestAction);
intentRegistry.register("hybrid.orchestrateApps", hybridOrchestrateApps);
intentRegistry.register("hybrid.state.define", hybridStateDefine);
intentRegistry.register("hybrid.state.check", hybridStateCheck);
intentRegistry.register("hybrid.state.enforce", hybridStateEnforce);
intentRegistry.register("hybrid.state.startLoop", hybridStateStartLoop);
intentRegistry.register("hybrid.state.stopLoop", hybridStateStopLoop);
intentRegistry.register("hybrid.checkpoint.record", hybridCheckpointRecord);
intentRegistry.register("hybrid.checkpoint.list", hybridCheckpointList);
intentRegistry.register("hybrid.checkpoint.rollback", hybridCheckpointRollback);
intentRegistry.register("hybrid.checkpoint.undo", hybridCheckpointUndo);
intentRegistry.register("hybrid.context.serialize", hybridContextSerialize);
intentRegistry.register("hybrid.context.send", hybridContextSend);
intentRegistry.register("hybrid.context.receive", hybridContextReceive);
intentRegistry.register("hybrid.profile.analyze", hybridProfileAnalyze);
intentRegistry.register("hybrid.profile.suggest", hybridProfileSuggest);
intentRegistry.register("hybrid.profile.get", hybridProfileGet);
intentRegistry.register("hybrid.templates", hybridTemplates);
intentRegistry.register("hybrid.runTemplate", hybridRunTemplate);
intentRegistry.register("hybrid.analyzeError", hybridAnalyzeError);
intentRegistry.register("hybrid.organizeFiles", hybridOrganizeFiles);
intentRegistry.register("hybrid.healthReport", hybridHealthReport);
intentRegistry.register("hybrid.machineDiff", hybridMachineDiff);
intentRegistry.register("hybrid.compliance", hybridCompliance);
intentRegistry.register("hybrid.docs", hybridDocs);
intentRegistry.register("hybrid.forecast", hybridForecast);
intentRegistry.register("hybrid.extensions", hybridExtensions);
intentRegistry.register("hybrid.plugins", hybridPlugins);
intentRegistry.register("learning.detectHabits", learningDetectHabits);
intentRegistry.register("learning.suggestMacro", learningSuggestMacro);
intentRegistry.register("learning.healthReminder", learningHealthReminder);
intentRegistry.register("learning.prefetch", learningPrefetch);
intentRegistry.register("workflow.research", workflowResearch);
intentRegistry.register("workflow.dataEntry", workflowDataEntry);
intentRegistry.register("workflow.meeting", workflowMeeting);
intentRegistry.register("workflow.dev", workflowDev);
intentRegistry.register("generic.execute", genericExecute);
intentRegistry.register("alarm.set", alarmSet);
