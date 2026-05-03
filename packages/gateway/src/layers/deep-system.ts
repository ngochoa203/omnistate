/**
 * Deep System Layer — Extended OS-level system operations.
 *
 * UC-B16 through UC-B30 split into modular files:
 *   B16 Shell/Terminal  B17 Log Collection  B18 Clipboard
 *   B19 Font/Locale     B20 Startup/Boot   B21 Power/Energy
 *   B22 Cert/Key Mgmt  B23 Firewall       B24 Container/VM
 *   B25 Display          B26 Audio          B27 Printer/Scanner
 *   B28 Backup/Restore  B29 OS Update      B30 Swap/Memory
 *
 * This file re-exports all types and provides a unified DeepSystemLayer
 * that composes all sub-layer capabilities for use by the orchestrator.
 */

export * from "./deep-system-types.js";
export * from "./deep-system-shell.js";
export * from "./deep-system-logs.js";
export * from "./deep-system-clipboard.js";
export * from "./deep-system-display.js";
export * from "./deep-system-power.js";
export * from "./deep-system-firewall.js";
export * from "./deep-system-audio.js";
export * from "./deep-system-update.js";

import type { DeepLayer } from "./deep.js";
import { DeepSystemShellLayer } from "./deep-system-shell.js";
import { DeepSystemLogsLayer } from "./deep-system-logs.js";
import { DeepSystemClipboardLayer } from "./deep-system-clipboard.js";
import { DeepSystemDisplayLayer } from "./deep-system-display.js";
import { DeepSystemPowerLayer } from "./deep-system-power.js";
import { DeepSystemFirewallLayer } from "./deep-system-firewall.js";
import { DeepSystemAudioLayer } from "./deep-system-audio.js";
import { DeepSystemUpdateLayer } from "./deep-system-update.js";

// Re-export each layer for external use
export {
  DeepSystemShellLayer,
  DeepSystemLogsLayer,
  DeepSystemClipboardLayer,
  DeepSystemDisplayLayer,
  DeepSystemPowerLayer,
  DeepSystemFirewallLayer,
  DeepSystemAudioLayer,
  DeepSystemUpdateLayer,
}

/**
 * Unified DeepSystemLayer that composes all sub-layers.
 * This is the layer used by the orchestrator - it delegates to sub-layers.
 */
export class DeepSystemLayer {
  private shell: DeepSystemShellLayer;
  private logs: DeepSystemLogsLayer;
  private clipboard: DeepSystemClipboardLayer;
  private display: DeepSystemDisplayLayer;
  private power: DeepSystemPowerLayer;
  private firewall: DeepSystemFirewallLayer;
  private audio: DeepSystemAudioLayer;
  private update: DeepSystemUpdateLayer;

  constructor(deep: DeepLayer) {
    this.shell = new DeepSystemShellLayer(deep);
    this.logs = new DeepSystemLogsLayer(deep);
    this.clipboard = new DeepSystemClipboardLayer(deep);
    this.display = new DeepSystemDisplayLayer(deep);
    this.power = new DeepSystemPowerLayer(deep);
    this.firewall = new DeepSystemFirewallLayer(deep);
    this.audio = new DeepSystemAudioLayer(deep);
    this.update = new DeepSystemUpdateLayer(deep);
  }

  // UC-B16 — Shell / Terminal
  getShellType = () => this.shell.getShellType();
  getShellConfig = () => this.shell.getShellConfig();
  addAlias = (name: string, command: string) => this.shell.addAlias(name, command);
  removeAlias = (name: string) => this.shell.removeAlias(name);
  listAliases = () => this.shell.listAliases();
  addToPath = (dir: string) => this.shell.addToPath(dir);
  getShellHistory = (limit?: number) => this.shell.getShellHistory(limit);

  // UC-B19 — Font / Locale / Layout
  listFonts = () => this.shell.listFonts();
  installFont = (fontPath: string) => this.shell.installFont(fontPath);
  getLocale = () => this.shell.getLocale();
  setLocale = (locale: string) => this.shell.setLocale(locale);
  getTimezone = () => this.shell.getTimezone();
  setTimezone = (tz: string) => this.shell.setTimezone(tz);
  getKeyboardLayouts = () => this.shell.getKeyboardLayouts();
  setKeyboardLayout = (layout: string) => this.shell.setKeyboardLayout(layout);

  // UC-B20 — Startup / Boot
  listStartupItems = () => this.shell.listStartupItems();
  addStartupItem = (config: { name: string; path: string; enabled?: boolean }) => this.shell.addStartupItem(config);
  removeStartupItem = (name: string) => this.shell.removeStartupItem(name);
  listLoginItems = () => this.shell.listLoginItems();
  addLoginItem = (appPath: string) => this.shell.addLoginItem(appPath);
  removeLoginItem = (appName: string) => this.shell.removeLoginItem(appName);

  // UC-B17 — Log Collection
  getSystemLogs = (lines?: number, filter?: string) => this.logs.getSystemLogs(lines, filter);
  getAppLogs = (appName: string, lines?: number) => this.logs.getAppLogs(appName, lines);
  searchLogs = (query: string, since?: string) => this.logs.searchLogs(query, since);
  getLogSize = () => this.logs.getLogSize();
  cleanOldLogs = (days?: number) => this.logs.cleanOldLogs(days);

  // UC-B18 — Clipboard
  getClipboard = () => this.clipboard.getClipboard();
  setClipboard = (text: string) => this.clipboard.setClipboard(text);
  getClipboardHistory = () => this.clipboard.getClipboardHistory();
  clearClipboard = () => this.clipboard.clearClipboard();

  // UC-B21 — Power / Energy
  getBatteryInfo = () => this.power.getBatteryInfo();
  sleep = () => this.power.sleep();
  shutdown = (delay?: number) => this.power.shutdown(delay);
  restart = (delay?: number) => this.power.restart(delay);
  scheduleWake = (dateTime: string) => this.power.scheduleWake(dateTime);

  // UC-B22 — Certificate / Key Management
  listCertificates = (keychain?: string) => this.firewall.listCertificates(keychain);
  installCertificate = (certPath: string, keychain?: string) => this.firewall.installCertificate(certPath, keychain);
  listSSHKeys = () => this.firewall.listSSHKeys();
  generateSSHKey = (type?: string, comment?: string) => this.firewall.generateSSHKey(type, comment);
  listGPGKeys = () => this.firewall.listGPGKeys();

  // UC-B23 — Firewall
  getFirewallRules = () => this.firewall.getFirewallRules();
  addFirewallRule = (rule: string) => this.firewall.addFirewallRule(rule);
  blockIP = (ip: string) => this.firewall.blockIP(ip);
  unblockIP = (ip: string) => this.firewall.unblockIP(ip);
  blockPort = (port: number, protocol?: "tcp" | "udp") => this.firewall.blockPort(port, protocol);
  allowPort = (port: number, protocol?: "tcp" | "udp") => this.firewall.allowPort(port, protocol);

  // UC-B24 — Container / VM
  listContainers = (all?: boolean) => this.firewall.listContainers(all);
  startContainer = (id: string) => this.firewall.startContainer(id);
  stopContainer = (id: string) => this.firewall.stopContainer(id);
  removeContainer = (id: string) => this.firewall.removeContainer(id);
  getContainerLogs = (id: string, tail?: number) => this.firewall.getContainerLogs(id, tail);
  listImages = () => this.firewall.listImages();
  pullImage = (name: string) => this.firewall.pullImage(name);
  isDockerRunning = () => this.firewall.isDockerRunning();
  listVMs = () => this.firewall.listVMs();
  startVM = (name: string) => this.firewall.startVM(name);
  stopVM = (name: string) => this.firewall.stopVM(name);

  // UC-B25 — Display
  getDisplays = () => this.display.getDisplays();
  setResolution = (displayId: string, width: number, height: number) => this.display.setResolution(displayId, width, height);
  setNightShift = (enabled: boolean) => this.display.setNightShift(enabled);
  getNightShiftStatus = () => this.display.getNightShiftStatus();

  // UC-B26 — Audio
  getAudioSources = () => this.audio.getAudioSources();
  setDefaultAudioOutput = (deviceName: string) => this.audio.setDefaultAudioOutput(deviceName);
  setDefaultAudioInput = (deviceName: string) => this.audio.setDefaultAudioInput(deviceName);
  getAudioVolume = () => this.audio.getInputVolume();
  isMuted = () => this.audio.isMuted();
  toggleMute = () => this.audio.toggleMute();

  // UC-B27 — Printer / Scanner (in display layer)
  listPrinters = () => this.display.listPrinters();
  setDefaultPrinter = (name: string) => this.display.setDefaultPrinter(name);
  getDefaultPrinter = () => this.display.getDefaultPrinter();
  printFile = (file: string, printer?: string) => this.display.printFile(file, printer);
  getPrintQueue = (printer?: string) => this.display.getPrintQueue(printer);

  // UC-B28 — Backup / Restore (in display layer)
  getTimeMachineStatus = () => this.display.getTimeMachineStatus?.() ?? { running: false, raw: "" };
  startTimeMachineBackup = () => this.display.startTimeMachineBackup?.() ?? false;
  listTimeMachineBackups = () => this.display.listTimeMachineBackups?.() ?? [];
  rsync = (src: string, dest: string, opts?: object) => this.display.rsync?.(src, dest, opts) ?? false;

  // UC-B29 — OS Update
  checkForUpdates = () => this.update.checkForUpdates();
  installUpdate = (name: string) => this.update.installUpdate(name);
  installAllUpdates = () => this.update.installAllUpdates();
  installUpdates = () => this.update.installAllUpdates(); // alias
  getOSVersion = () => this.update.getOSVersion();

  // UC-B30 — Swap / Memory (stub out - not implemented in update layer yet)
  getMemoryPressure = () => ({ level: "unknown" as const, raw: "" });
  getSwapUsage = () => ({ total: "", used: "", free: "", raw: "" });
  getTopMemoryProcesses = (_count?: number) => [];
  purgeMemory = () => false;
  getVMStats = () => ({ pagesFree: null, pagesActive: null, pagesInactive: null, pagesWiredDown: null, pageSize: null, raw: "" });
}
