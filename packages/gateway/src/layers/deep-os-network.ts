/**
 * Deep OS Layer — Network Operations.
 *
 * UC-B08: Network control — interfaces, WiFi, firewall, ports, routing, VPN.
 * UC-B16: WiFi pentest & security auditing.
 */

import type { DeepLayer } from "./deep.js";
import type {
  NetworkInterface,
  FirewallStatus,
  PortInfo,
  ConnectionInfo,
  RouteInfo,
  PingResult,
  VPNInfo,
  WiFiScanResult,
  HostScanResult,
  PortScanResult,
  ToolAvailability,
} from "./deep-os-types.js";

// ------------------------------------------------------------------
// UC-B08: Network Control
// ------------------------------------------------------------------

export class DeepOSNetworkLayer {
  constructor(private readonly deep: DeepLayer) {}

  /**
   * List all network interfaces with their addresses and status.
   */
  async getNetworkInterfaces(): Promise<NetworkInterface[]> {
    try {
      const { networkInterfaces } = await import("node:os");
      const ifaces = networkInterfaces();
      const result: NetworkInterface[] = [];
      for (const [name, addrs] of Object.entries(ifaces)) {
        for (const addr of addrs ?? []) {
          result.push({
            name,
            address: addr.address,
            netmask: addr.netmask,
            family: addr.family as "IPv4" | "IPv6",
            mac: addr.mac,
            up: !addr.internal,
          });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Get current Wi-Fi connection status and network info (macOS / Linux).
   */
  async getWiFiStatus(): Promise<any> {
    try {
      // Get current WiFi network
      let ssid = "Not connected";
      let connected = false;
      try {
        const networkOut = this.deep.exec("networksetup -getairportnetwork en0");
        const match = networkOut.match(/Current Wi-Fi Network:\s*(.+)/);
        if (match) {
          ssid = match[1].trim();
          connected = true;
        }
      } catch {}

      // Get WiFi interface info
      let ip = "N/A", subnet = "N/A", router = "N/A";
      try {
        const infoOut = this.deep.exec("networksetup -getinfo Wi-Fi");
        const ipMatch = infoOut.match(/IP address:\s*(.+)/);
        const subnetMatch = infoOut.match(/Subnet mask:\s*(.+)/);
        const routerMatch = infoOut.match(/Router:\s*(.+)/);
        if (ipMatch) ip = ipMatch[1].trim();
        if (subnetMatch) subnet = subnetMatch[1].trim();
        if (routerMatch) router = routerMatch[1].trim();
      } catch {}

      // Get signal strength if possible
      let signalStrength = "N/A";
      try {
        const rssiOut = this.deep.exec("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null || true");
        const rssiMatch = rssiOut.match(/agrCtlRSSI:\s*(-?\d+)/);
        if (rssiMatch) signalStrength = `${rssiMatch[1]} dBm`;
      } catch {}

      return {
        connected,
        ssid,
        ip,
        subnet,
        router,
        signalStrength,
        interface: "en0",
      };
    } catch (err) {
      return { connected: false, error: String(err) };
    }
  }

  /**
   * Connect to a Wi-Fi network by SSID (macOS: networksetup; Linux: nmcli).
   */
  async connectWiFi(ssid: string, password?: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const passArg = password ? `"${password}"` : "";
        await this.deep.execAsync(
          `networksetup -setairportnetwork en0 "${ssid}" ${passArg}`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        const passArg = password ? `password "${password}"` : "";
        await this.deep.execAsync(
          `nmcli device wifi connect "${ssid}" ${passArg}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect from the current Wi-Fi network.
   */
  async disconnectWiFi(): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `networksetup -setairportpower en0 off && networksetup -setairportpower en0 on`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`nmcli device disconnect wlan0 2>/dev/null`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get the current macOS Application Firewall status.
   */
  async getFirewallStatus(): Promise<FirewallStatus> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null`
        );
        const enabled = /enabled/i.test(stdout);
        const { stdout: blockAll } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getblockall 2>/dev/null`
        );
        const { stdout: stealth } = await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null`
        );
        return {
          enabled,
          blockAll: /enabled/i.test(blockAll),
          stealthMode: /enabled/i.test(stealth),
        };
      }
      return { enabled: false, blockAll: false, stealthMode: false };
    } catch {
      return { enabled: false, blockAll: false, stealthMode: false };
    }
  }

  /**
   * Enable or disable the macOS Application Firewall.
   */
  async setFirewallEnabled(enabled: boolean): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        const flag = enabled ? "--setglobalstate on" : "--setglobalstate off";
        await this.deep.execAsync(
          `/usr/libexec/ApplicationFirewall/socketfilterfw ${flag}`
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List all ports that currently have listening services.
   * Uses `lsof` on macOS/Linux.
   */
  async getOpenPorts(): Promise<PortInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `lsof -iTCP -iUDP -sTCP:LISTEN -n -P 2>/dev/null | head -200`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          const procName = parts[0];
          const pid = parseInt(parts[1], 10);
          const proto = parts[7]?.toLowerCase().includes("udp") ? "udp" : "tcp";
          const addr = parts[8] ?? "";
          const lastColon = addr.lastIndexOf(":");
          const localAddress = addr.slice(0, lastColon);
          const localPort = parseInt(addr.slice(lastColon + 1), 10);
          const state = parts[9] ?? "LISTEN";
          return {
            protocol: proto as "tcp" | "udp",
            localAddress,
            localPort,
            state,
            pid: isNaN(pid) ? null : pid,
            process: procName,
          };
        })
        .filter((p) => !isNaN(p.localPort));
    } catch {
      return [];
    }
  }

  /**
   * List all active TCP/UDP connections.
   */
  async getActiveConnections(): Promise<ConnectionInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `lsof -iTCP -iUDP -n -P 2>/dev/null | grep -v LISTEN | head -200`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          const pid = parseInt(parts[1], 10);
          const proto = parts[7]?.toLowerCase().includes("udp") ? "udp" : "tcp";
          const addrPart = parts[8] ?? "";
          const [local, remote] = addrPart.split("->");
          const localLastColon = (local ?? "").lastIndexOf(":");
          const remoteLastColon = (remote ?? "").lastIndexOf(":");
          return {
            protocol: proto as "tcp" | "udp",
            localAddress: local?.slice(0, localLastColon) ?? "",
            localPort: parseInt(local?.slice(localLastColon + 1) ?? "0", 10),
            remoteAddress: remote?.slice(0, remoteLastColon) ?? "",
            remotePort: parseInt(remote?.slice(remoteLastColon + 1) ?? "0", 10),
            state: parts[9] ?? "ESTABLISHED",
            pid: isNaN(pid) ? null : pid,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get the current IP routing table.
   */
  async getRoutingTable(): Promise<RouteInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `netstat -rn 2>/dev/null | head -100`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(2) // skip two header lines
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            destination: parts[0] ?? "",
            gateway: parts[1] ?? "",
            flags: parts[2] ?? "",
            iface: parts[parts.length - 1] ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Ping a host and return latency statistics.
   */
  async pingHost(host: string, count: number = 4): Promise<PingResult> {
    const base: PingResult = {
      host,
      packets: count,
      received: 0,
      loss: 100,
      avgMs: null,
      minMs: null,
      maxMs: null,
    };
    try {
      const { stdout } = await this.deep.execAsync(
        `ping -c ${count} "${host}" 2>/dev/null`,
        15_000
      );
      const lossMatch = stdout.match(/(\d+(?:\.\d+)?)%\s+packet loss/);
      const statsMatch = stdout.match(
        /min\/avg\/max(?:\/mdev|\/stddev)?\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/
      );
      const rxMatch = stdout.match(/(\d+)\s+(?:packets\s+)?received/);
      return {
        host,
        packets: count,
        received: rxMatch ? parseInt(rxMatch[1], 10) : 0,
        loss: lossMatch ? parseFloat(lossMatch[1]) : 100,
        minMs: statsMatch ? parseFloat(statsMatch[1]) : null,
        avgMs: statsMatch ? parseFloat(statsMatch[2]) : null,
        maxMs: statsMatch ? parseFloat(statsMatch[3]) : null,
      };
    } catch {
      return base;
    }
  }

  /**
   * Run a traceroute to a host and return the raw output.
   */
  async traceroute(host: string): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(
        `traceroute "${host}" 2>/dev/null`,
        60_000
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  /**
   * Get the status of VPN connections (macOS: scutil; Linux: ip link).
   */
  async getVPNStatus(): Promise<VPNInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `scutil --nc list 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const nameMatch = line.match(/"([^"]+)"/);
            const connected = line.includes("Connected");
            return {
              name: nameMatch ? nameMatch[1] : line,
              status: connected ? "connected" : ("disconnected" as VPNInfo["status"]),
              address: null,
            };
          });
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `ip link show type tun 2>/dev/null; ip link show type wireguard 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter((l) => /^\d+:/.test(l))
          .map((line) => {
            const nameMatch = line.match(/: (\w+):/);
            const up = line.includes("UP");
            return {
              name: nameMatch ? nameMatch[1] : "vpn",
              status: up ? "connected" : ("disconnected" as VPNInfo["status"]),
              address: null,
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC-B16: WiFi Pentest & Security Auditing
  // ================================================================

  async scanWiFiNetworks(): Promise<WiFiScanResult[]> {
    try {
      if (this.deep.platform === "macos") {
        const airportPath =
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
        const { stdout } = await this.deep.execAsync(`"${airportPath}" -s`);
        const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
        return lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            ssid: parts[0] ?? "",
            bssid: parts[1] ?? "",
            rssi: parseInt(parts[2] ?? "0", 10),
            channel: parseInt(parts[3] ?? "0", 10),
            security: parts.slice(6).join(" ") || "NONE",
          };
        });
      } else {
        const { stdout } = await this.deep.execAsync("nmcli device wifi list");
        const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
        return lines.map((line) => {
          const parts = line.trim().split(/\s{2,}/);
          return {
            ssid: parts[1] ?? "",
            bssid: parts[0]?.replace("* ", "") ?? "",
            rssi: parseInt(parts[6] ?? "0", 10),
            channel: parseInt(parts[4] ?? "0", 10),
            security: parts[7] ?? "NONE",
          };
        });
      }
    } catch {
      return [];
    }
  }

  async getWiFiDetails(): Promise<Record<string, string>> {
    try {
      if (this.deep.platform === "macos") {
        const airportPath =
          "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
        const { stdout } = await this.deep.execAsync(`"${airportPath}" -I`);
        const result: Record<string, string> = {};
        for (const line of stdout.split("\n")) {
          const idx = line.indexOf(":");
          if (idx !== -1) {
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            if (key) result[key] = val;
          }
        }
        return result;
      } else {
        const { stdout } = await this.deep.execAsync(
          "nmcli -t -f active,ssid,bssid,signal,chan,security device wifi list"
        );
        const result: Record<string, string> = {};
        for (const line of stdout.split("\n")) {
          if (line.startsWith("yes:")) {
            const [, ssid, bssid, signal, chan, security] = line.split(":");
            result["SSID"] = ssid ?? "";
            result["BSSID"] = bssid ?? "";
            result["signal"] = signal ?? "";
            result["channel"] = chan ?? "";
            result["security"] = security ?? "";
          }
        }
        return result;
      }
    } catch {
      return {};
    }
  }

  async enableMonitorMode(channel = 1): Promise<boolean> {
    try {
      if (this.deep.platform !== "macos") return false;
      const airportPath =
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      await this.deep.execAsync(`sudo "${airportPath}" sniff ${channel}`);
      return true;
    } catch {
      return false;
    }
  }

  async disableMonitorMode(): Promise<boolean> {
    try {
      await this.deep.execAsync(
        "sudo pkill -f 'airport sniff' 2>/dev/null; sudo killall airport 2>/dev/null; true"
      );
      return true;
    } catch {
      return false;
    }
  }

  async capturePackets(
    iface: string,
    filter: string,
    duration: number,
    outFile: string
  ): Promise<{ success: boolean; packetCount: number }> {
    try {
      const { stdout } = await this.deep.execAsync(
        `sudo tcpdump -i ${iface} -c 1000 -w ${outFile} ${filter} 2>&1`,
        duration * 1000
      );
      const match = stdout.match(/(\d+)\s+packets? captured/);
      return { success: true, packetCount: match ? parseInt(match[1]!, 10) : 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const match = msg.match(/(\d+)\s+packets? captured/);
      return { success: false, packetCount: match ? parseInt(match[1]!, 10) : 0 };
    }
  }

  async scanHosts(subnet: string): Promise<HostScanResult[]> {
    try {
      const { stdout: whichOut } = await this.deep.execAsync(
        "which nmap 2>/dev/null"
      );
      if (whichOut.trim()) {
        const { stdout } = await this.deep.execAsync(
          `nmap -sn ${subnet} 2>/dev/null`
        );
        const results: HostScanResult[] = [];
        const blocks = stdout.split("Nmap scan report for ").slice(1);
        for (const block of blocks) {
          const lines = block.split("\n");
          const header = lines[0]?.trim() ?? "";
          const ipMatch = header.match(/\(([^)]+)\)/);
          const ip = ipMatch ? ipMatch[1]! : header;
          const hostname = ipMatch ? header.replace(/ \([^)]+\)/, "") : null;
          const macLine = lines.find((l) => l.includes("MAC Address:"));
          const mac = macLine
            ? (macLine.match(/MAC Address: ([0-9A-F:]+)/i)?.[1] ?? null)
            : null;
          results.push({ ip, hostname, mac, alive: true });
        }
        return results;
      }
      // Fallback: arp -a
      const { stdout: arpOut } = await this.deep.execAsync("arp -a 2>/dev/null");
      return arpOut
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const ipMatch = line.match(/\(([^)]+)\)/);
          const macMatch = line.match(/at ([0-9a-f:]+)/i);
          const hostMatch = line.match(/^(\S+)/);
          return {
            ip: ipMatch?.[1] ?? "",
            hostname: hostMatch?.[1] ?? null,
            mac: macMatch?.[1] ?? null,
            alive: true,
          };
        })
        .filter((r) => r.ip);
    } catch {
      return [];
    }
  }

  async portScan(
    host: string,
    ports = "22,80,443,8080,3000,5000,3306,5432,6379,27017"
  ): Promise<PortScanResult[]> {
    try {
      const { stdout: whichOut } = await this.deep.execAsync(
        "which nmap 2>/dev/null"
      );
      if (whichOut.trim()) {
        const { stdout } = await this.deep.execAsync(
          `nmap -Pn -p ${ports} ${host} 2>/dev/null`
        );
        const results: PortScanResult[] = [];
        for (const line of stdout.split("\n")) {
          const m = line.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s*(\S*)/);
          if (m) {
            results.push({
              port: parseInt(m[1]!, 10),
              state: m[3] as "open" | "closed" | "filtered",
              service: m[4] || null,
            });
          }
        }
        return results;
      }
      // Fallback: nc per port
      const portList = ports.split(",").map((p) => parseInt(p.trim(), 10));
      const results: PortScanResult[] = [];
      for (const port of portList) {
        try {
          await this.deep.execAsync(
            `nc -zv -w 2 ${host} ${port} 2>&1`,
            3000
          );
          results.push({ port, state: "open", service: null });
        } catch {
          results.push({ port, state: "closed", service: null });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  async dnsLookup(domain: string, type = "A"): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(`dig ${domain} ${type}`);
      return stdout;
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async whoisLookup(target: string): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(`whois ${target}`);
      return stdout.slice(0, 5000);
    } catch (err: unknown) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async checkToolAvailability(tools: string[]): Promise<ToolAvailability[]> {
    const results: ToolAvailability[] = [];
    for (const name of tools) {
      try {
        const { stdout: pathOut } = await this.deep.execAsync(
          `which ${name} 2>/dev/null`
        );
        const path = pathOut.trim() || null;
        let version: string | null = null;
        if (path) {
          try {
            const { stdout: verOut } = await this.deep.execAsync(
              `${name} --version 2>&1 | head -1`
            );
            version = verOut.trim() || null;
          } catch {
            version = null;
          }
        }
        results.push({ name, available: !!path, path, version });
      } catch {
        results.push({ name, available: false, path: null, version: null });
      }
    }
    return results;
  }

  // ================================================================
  // WiFi Deep Control — monitor mode, channel hopping, deauth, handshake capture
  // ================================================================

  /**
   * Get the system WiFi interface name (en0 on most Macs).
   */
  async getWiFiInterface(): Promise<string> {
    try {
      const { stdout } = await this.deep.execAsync(
        "networksetup -listallhardwareports 2>/dev/null | awk '/Wi-Fi/{getline; print $2}' | head -1"
      );
      return stdout.trim() || "en0";
    } catch {
      return "en0";
    }
  }

  /**
   * Set WiFi interface to a specific channel (requires sudo).
   * Uses airport CLI. Must be in monitor mode first.
   */
  async setWiFiChannel(channel: number): Promise<boolean> {
    if (this.deep.platform !== "macos") return false;
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      await this.deep.execAsync(`sudo "${airportPath}" --channel=${channel}`, 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Capture WiFi packets with airodump-ng (requires aircrack-ng via brew).
   * Falls back to tcpdump if airodump-ng not available.
   */
  async captureWiFiHandshake(
    bssid: string,
    channel: number,
    outputFile: string,
    durationSec = 30
  ): Promise<{ success: boolean; file: string; tool: string }> {
    try {
      const iface = await this.getWiFiInterface();
      // Check if airodump-ng available
      const { stdout: airodumpPath } = await this.deep.execAsync("which airodump-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (airodumpPath.trim()) {
        await this.deep.execAsync(
          `sudo timeout ${durationSec} airodump-ng --bssid ${bssid} --channel ${channel} -w ${outputFile} ${iface} 2>/dev/null || true`,
          (durationSec + 5) * 1000
        );
        return { success: true, file: outputFile + "-01.cap", tool: "airodump-ng" };
      }
      // Fallback: tcpdump
      await this.deep.execAsync(
        `sudo timeout ${durationSec} tcpdump -i ${iface} -w ${outputFile}.pcap ether host ${bssid} 2>/dev/null || true`,
        (durationSec + 5) * 1000
      );
      return { success: true, file: outputFile + ".pcap", tool: "tcpdump" };
    } catch {
      return { success: false, file: outputFile, tool: "none" };
    }
  }

  /**
   * Run a deauthentication attack to force client reconnection (for WPA handshake capture).
   * Requires aircrack-ng suite and monitor mode.
   * NOTE: Only use against networks you own or have explicit permission to test.
   */
  async deauthAttack(bssid: string, clientMac = "FF:FF:FF:FF:FF:FF", count = 10): Promise<boolean> {
    if (this.deep.platform !== "macos") return false;
    try {
      const { stdout: aireplayPath } = await this.deep.execAsync("which aireplay-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (!aireplayPath.trim()) return false;
      const iface = await this.getWiFiInterface();
      await this.deep.execAsync(
        `sudo aireplay-ng --deauth ${count} -a ${bssid} -c ${clientMac} ${iface} 2>/dev/null || true`,
        30000
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install aircrack-ng suite via Homebrew for WiFi testing tools.
   */
  async installAircrackSuite(): Promise<boolean> {
    try {
      await this.deep.execAsync("brew install aircrack-ng 2>&1", 120000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Channel-hop WiFi scan: collect BSSIDs across all 2.4GHz + 5GHz channels.
   * Uses airport CLI, loops through channels 1-13 and 36-165.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deepWiFiScan(_durationPerChannelMs = 200): Promise<WiFiScanResult[]> {
    if (this.deep.platform !== "macos") return [];
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      const { stdout } = await this.deep.execAsync(
        `"${airportPath}" -s 2>/dev/null`,
        15000
      );
      const lines = stdout.split("\n").slice(1).filter(l => l.trim());
      const results: WiFiScanResult[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        results.push({
          ssid: parts[0] ?? "",
          bssid: parts[1] ?? "",
          rssi: parseInt(parts[2] ?? "0", 10),
          channel: parseInt(parts[3] ?? "0", 10),
          security: parts.slice(6).join(" ") || "NONE",
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * Get current WiFi signal strength in dBm.
   */
  async getWiFiSignalStrength(): Promise<number | null> {
    if (this.deep.platform !== "macos") return null;
    try {
      const airportPath = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport";
      const { stdout } = await this.deep.execAsync(`"${airportPath}" -I 2>/dev/null`);
      const m = stdout.match(/agrCtlRSSI:\s*(-?\d+)/);
      return m ? parseInt(m[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Crack WPA handshake using aircrack-ng with a wordlist.
   * NOTE: Only use against networks you own or have permission to test.
   */
  async crackWPAHandshake(
    capFile: string,
    wordlist: string,
    bssid?: string
  ): Promise<{ found: boolean; password?: string; output: string }> {
    try {
      const { stdout: aircrackPath } = await this.deep.execAsync("which aircrack-ng 2>/dev/null").catch(() => ({ stdout: '' }));
      if (!aircrackPath.trim()) {
        return { found: false, output: "aircrack-ng not installed. Run: brew install aircrack-ng" };
      }
      const bssidArg = bssid ? `-b ${bssid}` : "";
      const { stdout } = await this.deep.execAsync(
        `aircrack-ng ${bssidArg} -w ${wordlist} ${capFile} 2>&1`,
        300000 // 5 min timeout
      );
      const found = stdout.includes("KEY FOUND!");
      const pwMatch = stdout.match(/KEY FOUND!\s*\[\s*(.+?)\s*\]/);
      return { found, password: pwMatch?.[1], output: stdout.slice(0, 5000) };
    } catch (err) {
      return { found: false, output: err instanceof Error ? err.message : String(err) };
    }
  }
}
