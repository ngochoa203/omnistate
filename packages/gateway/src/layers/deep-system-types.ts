/**
 * Deep System Layer — Shared types and constants.
 *
 * UC-B16 through UC-B30:
 *   B16 Shell/Terminal  B17 Log Collection  B18 Clipboard
 *   B19 Font/Locale     B20 Startup/Boot    B21 Power/Energy
 *   B22 Cert/Key Mgmt  B23 Firewall        B24 Container/VM
 *   B25 Display         B26 Audio           B27 Printer/Scanner
 *   B28 Backup/Restore  B29 OS Update       B30 Swap/Memory
 */

import { promisify } from "node:util";
import { exec } from "node:child_process";

export const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// UC-B16 — Shell / Terminal Profile
// ---------------------------------------------------------------------------

export interface ShellInfo {
  type: "zsh" | "bash" | "fish" | "unknown";
  path: string;
  rcFile: string;
}

export interface AliasEntry {
  name: string;
  command: string;
}

// ---------------------------------------------------------------------------
// UC-B17 — Log Collection & Rotation
// ---------------------------------------------------------------------------

export interface LogSizeInfo {
  directory: string;
  sizeBytes: number;
  sizeMB: number;
}

// ---------------------------------------------------------------------------
// UC-B18 — Clipboard Management
// ---------------------------------------------------------------------------

export interface ClipboardEntry {
  content: string;
  timestamp: string;
}

export interface ClipboardHistoryEntry {
  text: string;
  timestamp: number;
  type: "text" | "image" | "file" | "rtf";
}

// ---------------------------------------------------------------------------
// UC-B19 — Font, Locale & Layout
// ---------------------------------------------------------------------------

export interface FontInfo {
  name: string;
  path?: string;
  family?: string;
}

export interface KeyboardLayout {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// UC-B20 — Startup / Boot Flow
// ---------------------------------------------------------------------------

export interface StartupItem {
  name: string;
  path?: string;
  enabled?: boolean;
}

export interface StartupItemConfig {
  name: string;
  path: string;
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B21 — Power / Energy
// ---------------------------------------------------------------------------

export interface BatteryInfo {
  present: boolean;
  percentage: number | null;
  charging: boolean;
  timeRemaining: string | null;
  raw: string;
}

// ---------------------------------------------------------------------------
// UC-B22 — Certificate / Key Management
// ---------------------------------------------------------------------------

export interface CertificateInfo {
  name: string;
  keychain: string;
  raw?: string;
}

export interface SSHKeyInfo {
  file: string;
  type: string;
  comment?: string;
}

export interface GPGKeyInfo {
  keyId: string;
  uid: string;
  expiry?: string;
}

// ---------------------------------------------------------------------------
// UC-B23 — Advanced Firewall
// ---------------------------------------------------------------------------

export interface FirewallRule {
  id: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// UC-B24 — Container / VM Lifecycle
// ---------------------------------------------------------------------------

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
}

export interface ImageInfo {
  repository: string;
  tag: string;
  id: string;
  size: string;
  created: string;
}

export interface VMInfo {
  name: string;
  state: string;
  uuid?: string;
}

// ---------------------------------------------------------------------------
// UC-B25 — Display Management
// ---------------------------------------------------------------------------

export interface DisplayInfo {
  id: string;
  name: string;
  resolution?: string;
  refreshRate?: string;
  raw?: string;
}

// ---------------------------------------------------------------------------
// UC-B26 — Audio Management
// ---------------------------------------------------------------------------

export interface AudioSource {
  name: string;
  type: "input" | "output" | "unknown";
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B27 — Printer / Scanner
// ---------------------------------------------------------------------------

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status?: string;
}

export interface PrintJob {
  jobId: string;
  printer: string;
  user?: string;
  file?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// UC-B28 — Backup / Restore
// ---------------------------------------------------------------------------

export interface TimeMachineStatus {
  running: boolean;
  phase?: string;
  lastBackup?: string;
  raw: string;
}

export interface RsyncOptions {
  archive?: boolean;
  verbose?: boolean;
  delete?: boolean;
  exclude?: string[];
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B29 — OS Update
// ---------------------------------------------------------------------------

export interface OSVersion {
  productName: string;
  productVersion: string;
  buildVersion: string;
}

export interface SoftwareUpdate {
  name: string;
  version?: string;
  size?: string;
  recommended?: boolean;
}

// ---------------------------------------------------------------------------
// UC-B30 — Swap / Memory Pressure
// ---------------------------------------------------------------------------

export interface MemoryPressure {
  level: "normal" | "warning" | "critical" | "unknown";
  raw: string;
}

export interface SwapUsage {
  total: string;
  used: string;
  free: string;
  encrypted?: boolean;
  raw: string;
}

export interface MemoryProcessInfo {
  pid: number;
  name: string;
  memPercent: number;
  memRSS: string;
}

export interface VMStats {
  pagesFree: number | null;
  pagesActive: number | null;
  pagesInactive: number | null;
  pagesWiredDown: number | null;
  pageSize: number | null;
  raw: string;
}