/**
 * Deep OS Layer — Type Definitions & Constants.
 *
 * All interfaces, types, and constants used across the DeepOSLayer modules.
 * Exported here so consumers can import types without pulling in method implementations.
 */

// ------------------------------------------------------------------
// UC-B01: Process Lifecycle
// ------------------------------------------------------------------

export interface ProcessDetails {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  openFiles: string[];
  openPorts: number[];
  children: number[];
  ppid: number;
  status: string;
}

// ------------------------------------------------------------------
// UC-B02: App Resolution & Auto-Install
// ------------------------------------------------------------------

export interface AppInfo {
  name: string;
  path: string;
  version: string | null;
  bundleId: string | null;
}

// ------------------------------------------------------------------
// UC-B04: Snapshots
// ------------------------------------------------------------------

export interface SnapshotInfo {
  label: string;
  createdAt: string;
  volume: string;
}

// ------------------------------------------------------------------
// UC-B05: OS Configuration
// ------------------------------------------------------------------

export interface ProxyConfig {
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypass?: string[];
}

// ------------------------------------------------------------------
// UC-B06: Service/Daemon Management
// ------------------------------------------------------------------

export type ServiceStatus = "running" | "stopped" | "disabled" | "unknown";

export interface ServiceInfo {
  name: string;
  label: string;
  status: ServiceStatus;
  pid: number | null;
}

export interface LaunchDaemonConfig {
  /** Reverse-DNS label, e.g. com.example.myservice */
  label: string;
  programArgs: string[];
  runAtLoad?: boolean;
  keepAlive?: boolean;
  /** Interval in seconds for StartInterval */
  startInterval?: number;
  workingDirectory?: string;
  standardOutPath?: string;
  standardErrorPath?: string;
  environmentVariables?: Record<string, string>;
  /** Install as user LaunchAgent (~/Library/LaunchAgents) vs system LaunchDaemon */
  userAgent?: boolean;
}

// ------------------------------------------------------------------
// UC-B07: Package Management
// ------------------------------------------------------------------

export interface PackageInfo {
  name: string;
  version: string;
  manager: string;
  description?: string;
}

// ------------------------------------------------------------------
// UC-B08: Network Control
// ------------------------------------------------------------------

export interface NetworkInterface {
  name: string;
  address: string;
  netmask: string | null;
  family: "IPv4" | "IPv6";
  mac: string | null;
  up: boolean;
}

export interface WiFiInfo {
  ssid: string;
  bssid: string | null;
  rssi: number | null;
  channel: number | null;
  security: string | null;
  connected: boolean;
}

export interface FirewallStatus {
  enabled: boolean;
  blockAll: boolean;
  stealthMode: boolean;
}

export interface PortInfo {
  protocol: "tcp" | "udp";
  localPort: number;
  localAddress: string;
  state: string;
  pid: number | null;
  process: string | null;
}

export interface ConnectionInfo {
  protocol: "tcp" | "udp";
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  pid: number | null;
}

export interface RouteInfo {
  destination: string;
  gateway: string;
  flags: string;
  iface: string;
}

export interface PingResult {
  host: string;
  packets: number;
  received: number;
  loss: number;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
}

export interface VPNInfo {
  name: string;
  status: "connected" | "disconnected" | "connecting";
  address: string | null;
}

// ------------------------------------------------------------------
// UC-B09: Kernel/Hardware Tuning
// ------------------------------------------------------------------

export interface PowerSettings {
  sleepDelay: number | null;
  displaySleepDelay: number | null;
  diskSleepDelay: number | null;
  hibernateMode: number | null;
  autopoweroff: boolean;
  powernap: boolean;
  raw: Record<string, string>;
}

// ------------------------------------------------------------------
// UC-B10: Peripheral Control
// ------------------------------------------------------------------

export interface AudioDevice {
  id: string;
  name: string;
  type: "input" | "output";
  isDefault: boolean;
}

export interface BluetoothStatus {
  enabled: boolean;
  discovering: boolean;
}

export interface BluetoothDevice {
  address: string;
  name: string;
  connected: boolean;
  paired: boolean;
}

// ------------------------------------------------------------------
// UC-B11: Scheduled Tasks
// ------------------------------------------------------------------

export interface ScheduledTask {
  label: string;
  status: string;
  lastExit: number | null;
  pid: number | null;
}

export interface ScheduledTaskConfig {
  /** Reverse-DNS label */
  label: string;
  programArgs: string[];
  /** Cron-style or launchd calendar config — use startInterval (seconds) for simple repeating */
  startInterval?: number;
  /** ISO 8601 date-time for one-shot run */
  startCalendarInterval?: {
    Minute?: number;
    Hour?: number;
    Day?: number;
    Weekday?: number;
    Month?: number;
  };
  runAtLoad?: boolean;
}

// ------------------------------------------------------------------
// UC-B13: User/Group/ACL Management
// ------------------------------------------------------------------

export interface UserInfo {
  uid: number;
  username: string;
  fullName: string | null;
  shell: string;
  home: string;
  groups: string[];
}

export interface GroupInfo {
  gid: number;
  name: string;
  members: string[];
}

export interface PermissionInfo {
  path: string;
  mode: string;
  octal: string;
  owner: string;
  group: string;
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

// ------------------------------------------------------------------
// UC-B14: Partition/Volume Management
// ------------------------------------------------------------------

export interface VolumeInfo {
  name: string;
  device: string;
  mountPoint: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export interface PartitionInfo {
  device: string;
  index: number;
  name: string | null;
  type: string;
  startSector: number | null;
  sizeMB: number | null;
}

// ------------------------------------------------------------------
// UC-B16: WiFi Pentest & Security Auditing
// ------------------------------------------------------------------

export interface WiFiScanResult {
  ssid: string;
  bssid: string;
  rssi: number;
  channel: number;
  security: string;
}

export interface HostScanResult {
  ip: string;
  hostname: string | null;
  mac: string | null;
  alive: boolean;
}

export interface PortScanResult {
  port: number;
  state: "open" | "closed" | "filtered";
  service: string | null;
}

export interface SecurityAuditResult {
  openPorts: PortInfo[];
  firewallStatus: FirewallStatus;
  wifiSecurity: string | null;
  sshEnabled: boolean;
  remoteLoginEnabled: boolean;
  recommendations: string[];
}

export interface ToolAvailability {
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}
