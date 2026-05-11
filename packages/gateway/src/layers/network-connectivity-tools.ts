/**
 * Network & Connectivity Tools — Group 20
 * Implements: Network info, ping, DNS, WiFi, Bluetooth, VPN status
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";


// ------------------------------------------------------------------
// Network Interface Info
// ------------------------------------------------------------------

export interface NetworkInterface {
  name: string;
  ip: string;
  mac: string;
  type: "ethernet" | "wifi" | "bluetooth" | "loopback" | "other";
  status: "up" | "down";
}

export async function getNetworkInterfaces(): Promise<NetworkInterface[]> {
  try {
    const { stdout } = await execAsync("ifconfig -a | grep -E '^([a-z0-9]+):' | awk '{print $1}' | tr -d ':'", { encoding: "utf-8" });
    const interfaces = stdout.trim().split("\n");
    
    const result: NetworkInterface[] = [];
    for (const name of interfaces) {
      const [ip, mac, type] = await Promise.all([
        execAsync(`ipconfig getifaddr ${name} 2>/dev/null || echo ""`, { encoding: "utf-8" }),
        execAsync(`ifconfig ${name} | grep -o '..:..:..:..:..:..' | head -1`, { encoding: "utf-8" }),
        execAsync(`ifconfig ${name} | grep -q 'status: active' && echo 'up' || echo 'down'`, { encoding: "utf-8" })
      ]);
      
      let ifaceType: NetworkInterface["type"] = "other";
      if (name.startsWith("en")) ifaceType = "ethernet";
      if (name.includes("wl") || name.includes("wifi")) ifaceType = "wifi";
      if (name.includes("bt") || name.includes("bluetooth")) ifaceType = "bluetooth";
      if (name === "lo0") ifaceType = "loopback";
      
      result.push({
        name,
        ip: ip.stdout.trim(),
        mac: mac.stdout.trim(),
        type: ifaceType,
        status: (type.stdout.trim() as "up" | "down") || "down"
      });
    }
    
    return result;
  } catch {
    return [];
  }
}

export async function getPrimaryIP(): Promise<string> {
  try {
    const { stdout } = await execAsync("ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export async function getPublicIP(): Promise<string> {
  try {
    const { stdout } = await execAsync("curl -s ifconfig.me 2>/dev/null || echo ''", { encoding: "utf-8" });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

// ------------------------------------------------------------------
// WiFi Operations
// ------------------------------------------------------------------

export async function getWiFiStatus(): Promise<{ connected: boolean; ssid?: string; signal?: number; bssid?: string }> {
  try {
    const { stdout } = await execAsync("airport -I 2>/dev/null || networksetup -getairportnetwork en0 2>/dev/null", { encoding: "utf-8" });
    
    const ssidMatch = stdout.match(/SSID:\s*(\S+)/) || stdout.match(/Current WiFi Network:\s*(.+)/);
    const signalMatch = stdout.match(/agrCtlRSSI:\s*(-?\d+)/);
    
    return {
      connected: ssidMatch !== null,
      ssid: ssidMatch?.[1],
      signal: signalMatch ? parseInt(signalMatch[1]!, 10) : undefined
    };
  } catch {
    return { connected: false };
  }
}

export async function connectWiFi(ssid: string, password?: string): Promise<boolean> {
  try {
    if (password) {
      await execAsync(`networksetup -setairportnetwork en0 "${ssid}" "${password}"`);
    } else {
      await execAsync(`networksetup -setairportnetwork en0 "${ssid}"`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function disconnectWiFi(): Promise<boolean> {
  try {
    await execAsync("networksetup -setairportpower en0 off");
    return true;
  } catch {
    return false;
  }
}

export async function scanWiFiNetworks(): Promise<{ ssid: string; signal: number; security: string }[]> {
  try {
    const { stdout } = await execAsync("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -s", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").slice(1).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        ssid: parts[0] || "unknown",
        signal: parseInt(parts[1] || "0", 10) || -100,
        security: parts.slice(-1)[0] || "unknown"
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Bluetooth
// ------------------------------------------------------------------

export async function getBluetoothStatus(): Promise<{ enabled: boolean; devices: { name: string; connected: boolean }[] }> {
  try {
    const { stdout } = await execAsync("system_profiler SPBluetoothDataType -json 2>/dev/null | head -50", { encoding: "utf-8" });
    
    return {
      enabled: stdout.includes("Bluetooth"),
      devices: []
    };
  } catch {
    return { enabled: false, devices: [] };
  }
}

export async function toggleBluetooth(enable: boolean): Promise<boolean> {
  try {
    await execAsync(`blueutil -power ${enable ? 1 : 0} 2>/dev/null || echo 'done'`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// DNS Operations
// ------------------------------------------------------------------

export async function flushDNS(): Promise<boolean> {
  try {
    await execAsync("sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder; echo 'DNS flushed'");
    return true;
  } catch {
    return false;
  }
}

export async function getDNSServers(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("scutil --dns | grep 'nameserver' | awk '{print $3}'", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(s => s.trim());
  } catch {
    return [];
  }
}

export async function setDNSServers(servers: string[]): Promise<boolean> {
  try {
    const serversStr = servers.join(" ");
    await execAsync(`networksetup -setdnsservers Wi-Fi ${serversStr}`);
    return true;
  } catch {
    return false;
  }
}

export async function lookupDNS(hostname: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`dig +short ${hostname} 2>/dev/null || host ${hostname} 2>/dev/null`, { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(s => s.trim() && !s.includes("failed"));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Network Testing
// ------------------------------------------------------------------

export async function pingTest(host: string, count: number = 4): Promise<{ success: boolean; avgMs?: number; packetLoss?: number }> {
  try {
    const { stdout } = await execAsync(`ping -c ${count} ${host}`, { encoding: "utf-8" });
    
    const avgMatch = stdout.match(/average = (\d+\.\d+)/) || stdout.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)/);
    const lossMatch = stdout.match(/(\d+)% packet loss/);
    
    return {
      success: true,
      avgMs: avgMatch ? parseFloat(avgMatch[1]!) : undefined,
      packetLoss: lossMatch ? parseInt(lossMatch[1]!, 10) : 0
    };
  } catch {
    return { success: false };
  }
}

export async function traceroute(host: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`traceroute -m 15 ${host} 2>/dev/null || echo ""`, { encoding: "utf-8" });
    return stdout.trim().split("\n");
  } catch {
    return [];
  }
}

export async function portScan(host: string, ports: number[] = [22, 80, 443]): Promise<{ port: number; open: boolean }[]> {
  const results: { port: number; open: boolean }[] = [];
  
  for (const port of ports) {
    try {
      const { stdout } = await execAsync(`nc -z -w 1 ${host} ${port} && echo 'open' || echo 'closed'`, { encoding: "utf-8" });
      results.push({ port, open: stdout.trim() === "open" });
    } catch {
      results.push({ port, open: false });
    }
  }
  
  return results;
}

// ------------------------------------------------------------------
// Proxy Settings
// ------------------------------------------------------------------

export async function getProxySettings(): Promise<{ http?: string; https?: string; ftp?: string; socks?: string }> {
  try {
    const { stdout } = await execAsync("networksetup -getwebproxy Wi-Fi 2>/dev/null || echo ''", { encoding: "utf-8" });
    
    return {
      http: stdout.match(/Enabled: Yes\nServer: (.+)/)?.[1]
    };
  } catch {
    return {};
  }
}

export async function setProxy(server: string, port: number, type: "http" | "https" | "socks" = "http"): Promise<boolean> {
  try {
    await execAsync(`networksetup -set${type}proxy Wi-Fi ${server} ${port}`);
    return true;
  } catch {
    return false;
  }
}

export async function disableProxy(): Promise<boolean> {
  try {
    await execAsync("networksetup -setwebproxystate Wi-Fi off; networksetup -setsecurewebproxystate Wi-Fi off; networksetup -setsocksfirewallproxystate Wi-Fi off");
    return true;
  } catch {
    return false;
  }
}

export class NetworkLayer {
  getInterfaces = getNetworkInterfaces;
  getPrimaryIP = getPrimaryIP;
  getPublicIP = getPublicIP;
  
  getWiFiStatus = getWiFiStatus;
  connectWiFi = connectWiFi;
  disconnectWiFi = disconnectWiFi;
  scanWiFi = scanWiFiNetworks;
  
  getBluetoothStatus = getBluetoothStatus;
  toggleBluetooth = toggleBluetooth;
  
  flushDNS = flushDNS;
  getDNS = getDNSServers;
  setDNS = setDNSServers;
  lookup = lookupDNS;
  
  ping = pingTest;
  traceroute = traceroute;
  portScan = portScan;
  
  getProxy = getProxySettings;
  setProxy = setProxy;
  disableProxy = disableProxy;
}
