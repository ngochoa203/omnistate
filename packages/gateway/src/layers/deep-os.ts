/**
 * Deep OS Layer — Extended OS-level operations.
 *
 * Barrel re-export for all DeepOSLayer modules.
 * Consumers import from here; all implementation is delegated to sub-modules.
 */

import type { DeepLayer } from "./deep.js";

// Re-export all types
export type {
  ProcessDetails,
  AppInfo,
  SnapshotInfo,
  ProxyConfig,
  ServiceInfo,
  ServiceStatus,
  LaunchDaemonConfig,
  PackageInfo,
  NetworkInterface,
  WiFiInfo,
  FirewallStatus,
  PortInfo,
  ConnectionInfo,
  RouteInfo,
  PingResult,
  VPNInfo,
  PowerSettings,
  AudioDevice,
  BluetoothStatus,
  BluetoothDevice,
  ScheduledTask,
  ScheduledTaskConfig,
  UserInfo,
  GroupInfo,
  PermissionInfo,
  VolumeInfo,
  PartitionInfo,
  WiFiScanResult,
  HostScanResult,
  PortScanResult,
  SecurityAuditResult,
  ToolAvailability,
} from "./deep-os-types.js";

// Re-export JXA standalone functions
export { executeJxa, executeJxaAsync } from "./deep-os-jxa.js";

// DeepOSLayer — assembled from all sub-layer classes
import { DeepOSProcessLayer } from "./deep-os-process.js";
import { DeepOSAppLayer } from "./deep-os-app.js";
import { DeepOSFilesLayer } from "./deep-os-files.js";
import { DeepOSNetworkLayer } from "./deep-os-network.js";
import { DeepOSKernelLayer } from "./deep-os-kernel.js";

export class DeepOSLayer {
  private readonly _process: DeepOSProcessLayer;
  private readonly _app: DeepOSAppLayer;
  private readonly _files: DeepOSFilesLayer;
  private readonly _network: DeepOSNetworkLayer;
  private readonly _kernel: DeepOSKernelLayer;

  constructor(private readonly _deep: DeepLayer) {
    this._process = new DeepOSProcessLayer(this._deep);
    this._app = new DeepOSAppLayer(this._deep);
    this._files = new DeepOSFilesLayer(this._deep);
    this._network = new DeepOSNetworkLayer(this._deep);
    this._kernel = new DeepOSKernelLayer(this._deep);
  }

  // ================================================================
  // UC-B01: Process Lifecycle (delegate to DeepOSProcessLayer)
  // ================================================================

  async restartProcess(name: string): Promise<boolean> {
    return this._process.restartProcess(name);
  }

  async reniceProcess(pid: number, priority: number): Promise<boolean> {
    return this._process.reniceProcess(pid, priority);
  }

  async getProcessDetails(pid: number): Promise<import("./deep-os-types.js").ProcessDetails | null> {
    return this._process.getProcessDetails(pid);
  }

  // ================================================================
  // UC-B02: App Resolution & Auto-Install (delegate to DeepOSAppLayer)
  // ================================================================

  async resolveApp(name: string): Promise<import("./deep-os-types.js").AppInfo | null> {
    return this._app.resolveApp(name);
  }

  async installApp(name: string, manager?: "brew" | "cask"): Promise<boolean> {
    return this._app.installApp(name, manager);
  }

  async launchAppWithContext(
    name: string,
    args?: string[],
    env?: Record<string, string>
  ): Promise<boolean> {
    return this._app.launchAppWithContext(name, args, env);
  }

  // ================================================================
  // UC-B04: Snapshots (delegate to DeepOSAppLayer)
  // ================================================================

  async createSnapshot(label: string): Promise<import("./deep-os-types.js").SnapshotInfo | null> {
    return this._app.createSnapshot(label);
  }

  async listSnapshots(): Promise<import("./deep-os-types.js").SnapshotInfo[]> {
    return this._app.listSnapshots();
  }

  async rollbackToSnapshot(label: string): Promise<boolean> {
    return this._app.rollbackToSnapshot(label);
  }

  // ================================================================
  // UC-B05: OS Configuration (delegate to DeepOSAppLayer)
  // ================================================================

  async getOSConfig(key: string): Promise<string | null> {
    return this._app.getOSConfig(key);
  }

  async setOSConfig(key: string, value: string, domain?: string): Promise<boolean> {
    return this._app.setOSConfig(key, value, domain);
  }

  async isDarkMode(): Promise<boolean> {
    return this._app.isDarkMode();
  }

  async setDarkMode(enabled: boolean): Promise<boolean> {
    return this._app.setDarkMode(enabled);
  }

  async getDNS(): Promise<string[]> {
    return this._app.getDNS();
  }

  async setDNS(servers: string[], iface?: string): Promise<boolean> {
    return this._app.setDNS(servers, iface);
  }

  async getProxy(): Promise<import("./deep-os-types.js").ProxyConfig | null> {
    return this._app.getProxy();
  }

  async setProxy(config: import("./deep-os-types.js").ProxyConfig): Promise<boolean> {
    return this._app.setProxy(config);
  }

  // ================================================================
  // UC-B06: Service/Daemon Management (delegate to DeepOSKernelLayer)
  // ================================================================

  async listServices(): Promise<import("./deep-os-types.js").ServiceInfo[]> {
    return this._kernel.listServices();
  }

  async getServiceStatus(name: string): Promise<import("./deep-os-types.js").ServiceStatus> {
    return this._kernel.getServiceStatus(name);
  }

  async startService(name: string): Promise<boolean> {
    return this._kernel.startService(name);
  }

  async stopService(name: string): Promise<boolean> {
    return this._kernel.stopService(name);
  }

  async restartService(name: string): Promise<boolean> {
    return this._kernel.restartService(name);
  }

  async enableService(name: string): Promise<boolean> {
    return this._kernel.enableService(name);
  }

  async disableService(name: string): Promise<boolean> {
    return this._kernel.disableService(name);
  }

  async createLaunchDaemon(
    config: import("./deep-os-types.js").LaunchDaemonConfig
  ): Promise<boolean> {
    return this._kernel.createLaunchDaemon(config);
  }

  // ================================================================
  // UC-B07: Package Management (delegate to DeepOSKernelLayer)
  // ================================================================

  async detectPackageManager(): Promise<string> {
    return this._kernel.detectPackageManager();
  }

  async listInstalledPackages(
    manager?: string
  ): Promise<import("./deep-os-types.js").PackageInfo[]> {
    return this._kernel.listInstalledPackages(manager);
  }

  async installPackage(name: string, manager?: string): Promise<boolean> {
    return this._kernel.installPackage(name, manager);
  }

  async removePackage(name: string, manager?: string): Promise<boolean> {
    return this._kernel.removePackage(name, manager);
  }

  async upgradePackage(name: string, manager?: string): Promise<boolean> {
    return this._kernel.upgradePackage(name, manager);
  }

  async upgradeAll(manager?: string): Promise<boolean> {
    return this._kernel.upgradeAll(manager);
  }

  async searchPackage(
    query: string,
    manager?: string
  ): Promise<import("./deep-os-types.js").PackageInfo[]> {
    return this._kernel.searchPackage(query, manager);
  }

  // ================================================================
  // UC-B08: Network Control (delegate to DeepOSNetworkLayer)
  // ================================================================

  async getNetworkInterfaces(): Promise<import("./deep-os-types.js").NetworkInterface[]> {
    return this._network.getNetworkInterfaces();
  }

  async getWiFiStatus(): Promise<any> {
    return this._network.getWiFiStatus();
  }

  async connectWiFi(ssid: string, password?: string): Promise<boolean> {
    return this._network.connectWiFi(ssid, password);
  }

  async disconnectWiFi(): Promise<boolean> {
    return this._network.disconnectWiFi();
  }

  async getFirewallStatus(): Promise<import("./deep-os-types.js").FirewallStatus> {
    return this._network.getFirewallStatus();
  }

  async setFirewallEnabled(enabled: boolean): Promise<boolean> {
    return this._network.setFirewallEnabled(enabled);
  }

  async getOpenPorts(): Promise<import("./deep-os-types.js").PortInfo[]> {
    return this._network.getOpenPorts();
  }

  async getActiveConnections(): Promise<import("./deep-os-types.js").ConnectionInfo[]> {
    return this._network.getActiveConnections();
  }

  async getRoutingTable(): Promise<import("./deep-os-types.js").RouteInfo[]> {
    return this._network.getRoutingTable();
  }

  async pingHost(host: string, count?: number): Promise<import("./deep-os-types.js").PingResult> {
    return this._network.pingHost(host, count);
  }

  async traceroute(host: string): Promise<string> {
    return this._network.traceroute(host);
  }

  async getVPNStatus(): Promise<import("./deep-os-types.js").VPNInfo[]> {
    return this._network.getVPNStatus();
  }

  // ================================================================
  // UC-B09: Kernel/Hardware Tuning (delegate to DeepOSKernelLayer)
  // ================================================================

  async getSysctl(key: string): Promise<string | null> {
    return this._kernel.getSysctl(key);
  }

  async setSysctl(key: string, value: string): Promise<boolean> {
    return this._kernel.setSysctl(key, value);
  }

  async getPowerSettings(): Promise<import("./deep-os-types.js").PowerSettings> {
    return this._kernel.getPowerSettings();
  }

  async setPowerSetting(key: string, value: string): Promise<boolean> {
    return this._kernel.setPowerSetting(key, value);
  }

  // ================================================================
  // UC-B10: Peripheral Control (delegate to DeepOSKernelLayer)
  // ================================================================

  async getAudioDevices(): Promise<import("./deep-os-types.js").AudioDevice[]> {
    return this._kernel.getAudioDevices();
  }

  async setAudioOutput(deviceId: string): Promise<boolean> {
    return this._kernel.setAudioOutput(deviceId);
  }

  async setAudioInput(deviceId: string): Promise<boolean> {
    return this._kernel.setAudioInput(deviceId);
  }

  async getVolume(): Promise<number> {
    return this._kernel.getVolume();
  }

  async setVolume(level: number): Promise<boolean> {
    return this._kernel.setVolume(level);
  }

  async setMute(muted: boolean): Promise<boolean> {
    return this._kernel.setMute(muted);
  }

  async getBrightness(): Promise<number> {
    return this._kernel.getBrightness();
  }

  async setBrightness(level: number): Promise<boolean> {
    return this._kernel.setBrightness(level);
  }

  async getBluetoothStatus(): Promise<import("./deep-os-types.js").BluetoothStatus> {
    return this._kernel.getBluetoothStatus();
  }

  async setBluetoothEnabled(enabled: boolean): Promise<boolean> {
    return this._kernel.setBluetoothEnabled(enabled);
  }

  async listBluetoothDevices(): Promise<import("./deep-os-types.js").BluetoothDevice[]> {
    return this._kernel.listBluetoothDevices();
  }

  async ejectDisk(mountPoint: string): Promise<boolean> {
    return this._kernel.ejectDisk(mountPoint);
  }

  // ================================================================
  // UC-B11: Scheduled Tasks (delegate to DeepOSKernelLayer)
  // ================================================================

  async listScheduledTasks(): Promise<import("./deep-os-types.js").ScheduledTask[]> {
    return this._kernel.listScheduledTasks();
  }

  async createScheduledTask(
    config: import("./deep-os-types.js").ScheduledTaskConfig
  ): Promise<boolean> {
    return this._kernel.createScheduledTask(config);
  }

  async removeScheduledTask(label: string): Promise<boolean> {
    return this._kernel.removeScheduledTask(label);
  }

  async getScheduledTaskStatus(label: string): Promise<string> {
    return this._kernel.getScheduledTaskStatus(label);
  }

  // ================================================================
  // UC-B12: Registry/System DB (delegate to DeepOSAppLayer)
  // ================================================================

  async readDefault(domain: string, key: string): Promise<string | null> {
    return this._app.readDefault(domain, key);
  }

  async writeDefault(
    domain: string,
    key: string,
    type: string,
    value: string
  ): Promise<boolean> {
    return this._app.writeDefault(domain, key, type, value);
  }

  async deleteDefault(domain: string, key: string): Promise<boolean> {
    return this._app.deleteDefault(domain, key);
  }

  async listDefaults(domain: string): Promise<Record<string, unknown>> {
    return this._app.listDefaults(domain);
  }

  // ================================================================
  // UC-B13: User/Group/ACL Management (delegate to DeepOSFilesLayer)
  // ================================================================

  async listUsers(): Promise<import("./deep-os-types.js").UserInfo[]> {
    return this._files.listUsers();
  }

  async getCurrentUser(): Promise<import("./deep-os-types.js").UserInfo> {
    return this._files.getCurrentUser();
  }

  async listGroups(): Promise<import("./deep-os-types.js").GroupInfo[]> {
    return this._files.listGroups();
  }

  async getFilePermissions(
    path: string
  ): Promise<import("./deep-os-types.js").PermissionInfo> {
    return this._files.getFilePermissions(path);
  }

  async setFilePermissions(path: string, mode: string): Promise<boolean> {
    return this._files.setFilePermissions(path, mode);
  }

  async setFileOwner(
    path: string,
    owner: string,
    group?: string
  ): Promise<boolean> {
    return this._files.setFileOwner(path, owner, group);
  }

  // ================================================================
  // UC-B14: Partition/Volume Management (delegate to DeepOSFilesLayer)
  // ================================================================

  async listVolumes(): Promise<import("./deep-os-types.js").VolumeInfo[]> {
    return this._files.listVolumes();
  }

  async mountVolume(device: string, mountPoint: string): Promise<boolean> {
    return this._files.mountVolume(device, mountPoint);
  }

  async unmountVolume(mountPoint: string): Promise<boolean> {
    return this._files.unmountVolume(mountPoint);
  }

  async getDiskPartitions(
    device: string
  ): Promise<import("./deep-os-types.js").PartitionInfo[]> {
    return this._files.getDiskPartitions(device);
  }

  // ================================================================
  // UC-B15: Environment Variables (delegate to DeepOSFilesLayer)
  // ================================================================

  async getEnvVar(name: string): Promise<string | undefined> {
    return this._files.getEnvVar(name);
  }

  async setEnvVar(
    name: string,
    value: string,
    persist?: boolean
  ): Promise<boolean> {
    return this._files.setEnvVar(name, value, persist);
  }

  async unsetEnvVar(name: string, persist?: boolean): Promise<boolean> {
    return this._files.unsetEnvVar(name, persist);
  }

  async listEnvVars(): Promise<Record<string, string>> {
    return this._files.listEnvVars();
  }

  async getShellProfile(): Promise<string> {
    return this._files.getShellProfile();
  }

  // ================================================================
  // UC-B16: WiFi Pentest & Security Auditing (delegate to DeepOSNetworkLayer)
  // ================================================================

  async scanWiFiNetworks(): Promise<import("./deep-os-types.js").WiFiScanResult[]> {
    return this._network.scanWiFiNetworks();
  }

  async getWiFiDetails(): Promise<Record<string, string>> {
    return this._network.getWiFiDetails();
  }

  async enableMonitorMode(channel?: number): Promise<boolean> {
    return this._network.enableMonitorMode(channel);
  }

  async disableMonitorMode(): Promise<boolean> {
    return this._network.disableMonitorMode();
  }

  async capturePackets(
    iface: string,
    filter: string,
    duration: number,
    outFile: string
  ): Promise<{ success: boolean; packetCount: number }> {
    return this._network.capturePackets(iface, filter, duration, outFile);
  }

  async scanHosts(subnet: string): Promise<import("./deep-os-types.js").HostScanResult[]> {
    return this._network.scanHosts(subnet);
  }

  async portScan(
    host: string,
    ports?: string
  ): Promise<import("./deep-os-types.js").PortScanResult[]> {
    return this._network.portScan(host, ports);
  }

  async dnsLookup(domain: string, type?: string): Promise<string> {
    return this._network.dnsLookup(domain, type);
  }

  async whoisLookup(target: string): Promise<string> {
    return this._network.whoisLookup(target);
  }

  async checkToolAvailability(
    tools: string[]
  ): Promise<import("./deep-os-types.js").ToolAvailability[]> {
    return this._network.checkToolAvailability(tools);
  }

  async getWiFiInterface(): Promise<string> {
    return this._network.getWiFiInterface();
  }

  async setWiFiChannel(channel: number): Promise<boolean> {
    return this._network.setWiFiChannel(channel);
  }

  async captureWiFiHandshake(
    bssid: string,
    channel: number,
    outputFile: string,
    durationSec?: number
  ): Promise<{ success: boolean; file: string; tool: string }> {
    return this._network.captureWiFiHandshake(bssid, channel, outputFile, durationSec);
  }

  async deauthAttack(
    bssid: string,
    clientMac?: string,
    count?: number
  ): Promise<boolean> {
    return this._network.deauthAttack(bssid, clientMac, count);
  }

  async installAircrackSuite(): Promise<boolean> {
    return this._network.installAircrackSuite();
  }

  async deepWiFiScan(
    durationPerChannelMs?: number
  ): Promise<import("./deep-os-types.js").WiFiScanResult[]> {
    return this._network.deepWiFiScan(durationPerChannelMs);
  }

  async getWiFiSignalStrength(): Promise<number | null> {
    return this._network.getWiFiSignalStrength();
  }

  async crackWPAHandshake(
    capFile: string,
    wordlist: string,
    bssid?: string
  ): Promise<{ found: boolean; password?: string; output: string }> {
    return this._network.crackWPAHandshake(capFile, wordlist, bssid);
  }
}
