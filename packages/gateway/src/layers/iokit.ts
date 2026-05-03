import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execFileAsync = promisify(execFile);

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ThermalSensors {
  cpu?: number;
  gpu?: number;
  battery?: number;
  ambient?: number;
  heatsink?: number;
  [key: string]: number | undefined;
}

export interface FanInfo {
  id: number;
  name: string;
  speedRPM: number;
  minRPM?: number;
  maxRPM?: number;
}

export interface BatteryHealthInfo {
  cycleCount?: number;
  designCapacity?: number;
  maxCapacity?: number;
  currentCapacity?: number;
  healthPercent?: number;
  isCharging?: boolean;
  isPluggedIn?: boolean;
  temperature?: number;
  manufacturer?: string;
  serialNumber?: string;
}

export interface GPUInfo {
  name: string;
  vendor?: string;
  vramMB?: number;
  metalSupport?: string;
  deviceId?: string;
  pciBus?: string;
  type?: string;
}

export interface CoreUsage {
  core: number;
  userPercent: number;
  systemPercent: number;
  idlePercent: number;
}

export interface PCIDevice {
  name: string;
  deviceId?: string;
  vendorId?: string;
  subsystemId?: string;
  revision?: string;
  type?: string;
  linkWidth?: string;
  linkSpeed?: string;
}

export interface USBDevice {
  name: string;
  productId?: string;
  vendorId?: string;
  serialNumber?: string;
  speed?: string;
  manufacturer?: string;
  locationId?: string;
  children?: USBDevice[];
}

export interface SMCKey {
  key: string;
  type: string;
  size: number;
  value: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function parseIntSafe(val: string | undefined): number | undefined {
  if (val === undefined || val === null) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

// ─── IOKitLayer ───────────────────────────────────────────────────────────────

export class IOKitLayer {
  private readonly isMac: boolean;

  constructor() {
    this.isMac = platform() === 'darwin';
  }

  // ── Thermals ────────────────────────────────────────────────────────────────

  async getThermals(): Promise<ThermalSensors> {
    if (!this.isMac) return {};

    // Try smc first
    try {
      const out = await run('smc', ['-f']);
      const sensors: ThermalSensors = {};
      const lines = out.split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        const match = line.match(/([\d.]+)\s*°?C/i);
        if (!match) continue;
        const temp = parseFloat(match[1]);
        if (isNaN(temp)) continue;

        if (lower.includes('cpu')) sensors.cpu = temp;
        else if (lower.includes('gpu')) sensors.gpu = temp;
        else if (lower.includes('batt')) sensors.battery = temp;
        else if (lower.includes('ambient')) sensors.ambient = temp;
        else if (lower.includes('heat')) sensors.heatsink = temp;
      }
      if (Object.keys(sensors).length > 0) return sensors;
    } catch {
      // fallthrough
    }

    // Fallback: istats
    try {
      const out = await run('istats', ['all', '--no-graphs']);
      const sensors: ThermalSensors = {};
      const lines = out.split('\n');
      for (const line of lines) {
        const lower = line.toLowerCase();
        const match = line.match(/([\d.]+)\s*°?C/i);
        if (!match) continue;
        const temp = parseFloat(match[1]);
        if (isNaN(temp)) continue;

        if (lower.includes('cpu')) sensors.cpu = temp;
        else if (lower.includes('gpu')) sensors.gpu = temp;
        else if (lower.includes('batt')) sensors.battery = temp;
        else if (lower.includes('ambient')) sensors.ambient = temp;
        else if (lower.includes('heat')) sensors.heatsink = temp;
        else {
          // Store by label key
          const labelMatch = line.match(/^([^:]+):/);
          if (labelMatch) {
            const key = labelMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
            sensors[key] = temp;
          }
        }
      }
      return sensors;
    } catch {
      return {};
    }
  }

  // ── Fan Speeds ───────────────────────────────────────────────────────────────

  async getFanSpeeds(): Promise<FanInfo[]> {
    if (!this.isMac) return [];

    // Try smc -f
    try {
      const out = await run('smc', ['-f']);
      const fans: FanInfo[] = [];
      const lines = out.split('\n');
      let currentId = 0;
      for (const line of lines) {
        const speedMatch = line.match(/Fan\s+(\d+)\s+.*?:\s+([\d.]+)/i);
        if (speedMatch) {
          fans.push({
            id: parseInt(speedMatch[1], 10),
            name: `Fan ${speedMatch[1]}`,
            speedRPM: parseFloat(speedMatch[2]),
          });
        } else {
          const genericMatch = line.match(/(\d+)\s+rpm/i);
          if (genericMatch) {
            fans.push({
              id: currentId++,
              name: `Fan ${currentId}`,
              speedRPM: parseFloat(genericMatch[1]),
            });
          }
        }
      }
      if (fans.length > 0) return fans;
    } catch {
      // fallthrough
    }

    // Fallback: istats
    try {
      const out = await run('istats', ['fan', '--no-graphs']);
      const fans: FanInfo[] = [];
      const lines = out.split('\n');
      lines.forEach((line, idx) => {
        const match = line.match(/([\d.]+)\s*RPM/i);
        if (match) {
          fans.push({
            id: idx,
            name: `Fan ${idx + 1}`,
            speedRPM: parseFloat(match[1]),
          });
        }
      });
      return fans;
    } catch {
      return [];
    }
  }

  // ── Battery Health ───────────────────────────────────────────────────────────

  async getBatteryHealth(): Promise<BatteryHealthInfo> {
    if (!this.isMac) return {};

    try {
      const out = await run('ioreg', [
        '-r',
        '-c', 'AppleSmartBattery',
        '-a', // output as XML plist (parseable)
      ]);

      const info: BatteryHealthInfo = {};

      const extract = (key: string): string | undefined => {
        const re = new RegExp(`<key>${key}</key>\\s*<(?:integer|real|string)>(.*?)</(?:integer|real|string)>`, 's');
        const m = out.match(re);
        return m ? m[1].trim() : undefined;
      };

      const extractBool = (key: string): boolean | undefined => {
        const re = new RegExp(`<key>${key}</key>\\s*(<true/>|<false/>)`);
        const m = out.match(re);
        if (!m) return undefined;
        return m[1] === '<true/>';
      };

      info.cycleCount = parseIntSafe(extract('CycleCount'));
      info.designCapacity = parseIntSafe(extract('DesignCapacity'));
      info.maxCapacity = parseIntSafe(extract('MaxCapacity') ?? extract('AppleRawMaxCapacity'));
      info.currentCapacity = parseIntSafe(extract('CurrentCapacity') ?? extract('AppleRawCurrentCapacity'));
      info.isCharging = extractBool('IsCharging');
      info.isPluggedIn = extractBool('ExternalConnected');
      info.manufacturer = extract('Manufacturer');
      info.serialNumber = extract('BatterySerialNumber');

      const tempRaw = parseIntSafe(extract('Temperature'));
      if (tempRaw !== undefined) info.temperature = tempRaw / 100;

      if (info.maxCapacity && info.designCapacity && info.designCapacity > 0) {
        info.healthPercent = Math.round((info.maxCapacity / info.designCapacity) * 100);
      }

      return info;
    } catch {
      return {};
    }
  }

  // ── GPU Info ─────────────────────────────────────────────────────────────────

  async getGPUInfo(): Promise<GPUInfo[]> {
    if (!this.isMac) return [];

    try {
      const out = await run('system_profiler', ['SPDisplaysDataType', '-json']);
      const data = JSON.parse(out) as Record<string, unknown>;
      const displays = data['SPDisplaysDataType'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(displays)) return [];

      return displays.map((d) => {
        const gpu: GPUInfo = {
          name: (d['sppci_model'] as string) ?? (d['_name'] as string) ?? 'Unknown GPU',
        };
        if (d['sppci_vendor']) gpu.vendor = d['sppci_vendor'] as string;
        if (d['sppci_device_type']) gpu.type = d['sppci_device_type'] as string;
        if (d['sppci_bus']) gpu.pciBus = d['sppci_bus'] as string;
        if (d['spdisplays_metal']) gpu.metalSupport = d['spdisplays_metal'] as string;

        const vramStr = (d['sppci_vram'] ?? d['sppci_vram_shared']) as string | undefined;
        if (vramStr) {
          const vramMatch = vramStr.match(/([\d,]+)\s*MB/i);
          if (vramMatch) gpu.vramMB = parseInt(vramMatch[1].replace(',', ''), 10);
        }

        return gpu;
      });
    } catch {
      return [];
    }
  }

  // ── CPU Usage Per Core ────────────────────────────────────────────────────────

  async getCPUUsagePerCore(): Promise<CoreUsage[]> {
    if (!this.isMac) return [];

    try {
      // top -l 1 -n 0 outputs CPU usage; for per-core we use -stats
      // We use a workaround: sample via `top -l 2 -n 0 -stats cpu`
      const out = await run('top', ['-l', '2', '-n', '0', '-stats', 'cpu'], 15000);
      const lines = out.split('\n');
      const cores: CoreUsage[] = [];

      // Look for lines like "CPU usage: X% user, Y% sys, Z% idle"
      // top on macOS gives aggregate; for per-core, parse sysctl
      // Fallback to aggregate as core 0 if no per-core data
      for (const line of lines) {
        const coreMatch = line.match(/CPU(\d+)\s+usage:\s+([\d.]+)%\s+user.*?([\d.]+)%\s+sys.*?([\d.]+)%\s+idle/i);
        if (coreMatch) {
          cores.push({
            core: parseInt(coreMatch[1], 10),
            userPercent: parseFloat(coreMatch[2]),
            systemPercent: parseFloat(coreMatch[3]),
            idlePercent: parseFloat(coreMatch[4]),
          });
        }
      }

      if (cores.length === 0) {
        // Aggregate fallback: parse total CPU line
        for (const line of lines) {
          const aggMatch = line.match(/CPU usage:\s+([\d.]+)%\s+user.*?([\d.]+)%\s+sys.*?([\d.]+)%\s+idle/i);
          if (aggMatch) {
            cores.push({
              core: 0,
              userPercent: parseFloat(aggMatch[1]),
              systemPercent: parseFloat(aggMatch[2]),
              idlePercent: parseFloat(aggMatch[3]),
            });
            break;
          }
        }
      }

      return cores;
    } catch {
      return [];
    }
  }

  // ── Memory Pressure ───────────────────────────────────────────────────────────

  async getMemoryPressureLevel(): Promise<'nominal' | 'warn' | 'critical' | 'unknown'> {
    if (!this.isMac) return 'unknown';

    try {
      const out = await run('memory_pressure', []);
      const lower = out.toLowerCase();
      if (lower.includes('critical')) return 'critical';
      if (lower.includes('warn')) return 'warn';
      if (lower.includes('nominal')) return 'nominal';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ── NVRAM ────────────────────────────────────────────────────────────────────

  async getNVRAMVariable(key: string): Promise<string | null> {
    if (!this.isMac) return null;

    try {
      const out = await run('nvram', [key]);
      // nvram output: "key\tvalue"
      const tabIdx = out.indexOf('\t');
      if (tabIdx === -1) return out.trim() || null;
      return out.slice(tabIdx + 1).trim() || null;
    } catch {
      return null;
    }
  }

  async setNVRAMVariable(key: string, value: string): Promise<boolean> {
    if (!this.isMac) return false;

    try {
      await run('sudo', ['nvram', `${key}=${value}`]);
      return true;
    } catch {
      return false;
    }
  }

  async listNVRAMVariables(): Promise<Record<string, string>> {
    if (!this.isMac) return {};

    try {
      const out = await run('nvram', ['-p']);
      const result: Record<string, string> = {};
      const lines = out.split('\n');
      for (const line of lines) {
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        const k = line.slice(0, tabIdx).trim();
        const v = line.slice(tabIdx + 1).trim();
        if (k) result[k] = v;
      }
      return result;
    } catch {
      return {};
    }
  }

  // ── PCI Devices ───────────────────────────────────────────────────────────────

  async getPCIDevices(): Promise<PCIDevice[]> {
    if (!this.isMac) return [];

    try {
      const out = await run('system_profiler', ['SPPCIDataType', '-json']);
      const data = JSON.parse(out) as Record<string, unknown>;
      const items = data['SPPCIDataType'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(items)) return [];

      return items.map((item) => ({
        name: (item['_name'] as string) ?? 'Unknown PCI Device',
        deviceId: item['sppci_device-id'] as string | undefined,
        vendorId: item['sppci_vendor-id'] as string | undefined,
        subsystemId: item['sppci_subsystem-id'] as string | undefined,
        revision: item['sppci_revision-id'] as string | undefined,
        type: item['sppci_device_type'] as string | undefined,
        linkWidth: item['sppci_link_width'] as string | undefined,
        linkSpeed: item['sppci_link_speed'] as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  // ── USB Tree ─────────────────────────────────────────────────────────────────

  async getUSBTree(): Promise<USBDevice[]> {
    if (!this.isMac) return [];

    try {
      const out = await run('system_profiler', ['SPUSBDataType', '-json']);
      const data = JSON.parse(out) as Record<string, unknown>;
      const items = data['SPUSBDataType'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(items)) return [];

      const mapDevice = (d: Record<string, unknown>): USBDevice => {
        const device: USBDevice = {
          name: (d['_name'] as string) ?? 'Unknown USB Device',
          productId: d['usb_product_id'] as string | undefined,
          vendorId: d['usb_vendor_id'] as string | undefined,
          serialNumber: d['usb_serial_num'] as string | undefined,
          speed: d['usb_speed'] as string | undefined,
          manufacturer: d['manufacturer'] as string | undefined,
          locationId: d['location_id'] as string | undefined,
        };

        const subItems = d['_items'] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(subItems) && subItems.length > 0) {
          device.children = subItems.map(mapDevice);
        }

        return device;
      };

      return items.map(mapDevice);
    } catch {
      return [];
    }
  }

  // ── IOReg Entry ───────────────────────────────────────────────────────────────

  async getIORegEntry(className: string): Promise<Record<string, unknown>> {
    if (!this.isMac) return {};

    try {
      const out = await run('ioreg', ['-r', '-c', className, '-a']);
      // Output is an XML plist; do a best-effort key-value extraction
      // For structured parsing we'd need plist lib; do simple regex extraction
      const result: Record<string, unknown> = {};
      const keyValueRe = /<key>([^<]+)<\/key>\s*<(?:string|integer|real|true|false)\/?>(.*?)<\/(?:string|integer|real)>/gs;
      let match: RegExpExecArray | null;
      while ((match = keyValueRe.exec(out)) !== null) {
        const k = match[1].trim();
        const v = match[2].trim();
        // Convert numbers
        const num = Number(v);
        result[k] = isNaN(num) ? v : num;
      }
      // Handle booleans
      const boolRe = /<key>([^<]+)<\/key>\s*(<true\/>|<false\/>)/g;
      let bm: RegExpExecArray | null;
      while ((bm = boolRe.exec(out)) !== null) {
        result[bm[1].trim()] = bm[2] === '<true/>';
      }
      return result;
    } catch {
      return {};
    }
  }

  // ── SMC Keys ─────────────────────────────────────────────────────────────────

  async getSMCKeys(): Promise<SMCKey[]> {
    if (!this.isMac) return [];

    try {
      const out = await run('smc', ['-l']);
      const keys: SMCKey[] = [];
      const lines = out.split('\n');
      for (const line of lines) {
        // Format: "  KEY  [TYPE]  SIZE bytes  VALUE"
        const match = line.match(/^\s*(\S{1,4})\s+\[(\S+)\]\s+(\d+)\s+bytes\s+(.*)/);
        if (match) {
          keys.push({
            key: match[1],
            type: match[2],
            size: parseInt(match[3], 10),
            value: match[4].trim(),
          });
        }
      }
      return keys;
    } catch {
      return [];
    }
  }

  async readSMCKey(key: string): Promise<number | null> {
    if (!this.isMac) return null;

    try {
      const out = await run('smc', ['-k', key, '-r']);
      // Output: "  KEY  VALUE (units)"
      const match = out.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        return isNaN(val) ? null : val;
      }
      return null;
    } catch {
      return null;
    }
  }
}
