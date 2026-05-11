/**
 * Networking Advanced Tools — DNS, VPN, load balancers, diagnostics.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function dnsLookup(domain: string, type = "A"): Promise<string[]> { try { const { stdout } = await execAsync(`dig +short ${domain} ${type}`, { encoding: "utf-8" }); return stdout.trim().split("\n").filter(Boolean); } catch { return []; } }
export async function reverseDNS(ip: string): Promise<string> { try { const { stdout } = await execAsync(`dig +short -x ${ip}`, { encoding: "utf-8" }); return stdout.trim(); } catch { return ""; } }
export async function whoisLookup(domain: string): Promise<{ registrar: string; nameServers: string[] }> { try { const { stdout } = await execAsync(`whois ${domain} 2>/dev/null | grep -E "Registrar|Name Server" | head -5`, { encoding: "utf-8" }); const registrar = stdout.match(/Registrar:\s*(.+)/)?.[1] || ""; const ns = stdout.match(/Name Server:\s*(.+)/g)?.map(m => m.split(":")[1]?.trim()) || []; return { registrar, nameServers: ns }; } catch { return { registrar: "", nameServers: [] }; } }

export async function connectVPN(name: string, config?: string): Promise<boolean> { try { await execAsync(config ? `scutil --nc start "${name}" --secret "${config}"` : `scutil --nc start "${name}"`); return true; } catch { return false; } }
export async function disconnectVPN(name: string): Promise<boolean> { try { await execAsync(`scutil --nc stop "${name}"`); return true; } catch { return false; } }
export async function getVPNStatus(): Promise<{ connected: boolean; name?: string }> { try { const { stdout } = await execAsync(`scutil --nc show | grep "Connected" | head -1`, { encoding: "utf-8" }); return { connected: stdout.includes("Connected") }; } catch { return { connected: false }; } }
export async function listVPNConfigs(): Promise<string[]> { try { const { stdout } = await execAsync(`scutil --nc list | grep -E "PPP|L2TP|IPSEC"`, { encoding: "utf-8" }); return stdout.split("\n").filter(Boolean).map(l => l.match(/"(.+)"/)?.[1] || ""); } catch { return []; } }

export async function traceroute(host: string, maxHops = 30): Promise<{ hop: number; ip: string; rtt1: string }[]> { try { const { stdout } = await execAsync(`traceroute -m ${maxHops} ${host}`, { encoding: "utf-8" }); return stdout.split("\n").map(line => { const match = line.match(/^\s*(\d+)\s+(\S+)\s+((?:\d+\.\d+ ms|\*)\s*){1}/); return match ? { hop: parseInt(match[1]), ip: match[2], rtt1: match[3] || "*" } : null; }).filter(Boolean) as any[]; } catch { return []; } }
export async function portScan(host: string, ports = "20-1024"): Promise<{ port: number; open: boolean; service?: string }[]> { try { const { stdout } = await execAsync(`nmap -p ${ports} -T4 ${host} 2>/dev/null || echo ""`, { encoding: "utf-8" }); return stdout.split("\n").map(line => { const match = line.match(/(\d+)\/(tcp|udp)\s+(open|closed)\s+(\S+)?/); return match ? { port: parseInt(match[1]), open: match[3] === "open", service: match[4] } : null; }).filter(Boolean) as any[]; } catch { return []; } }

export async function speedTest(): Promise<{ download: number; upload: number; latency: number }> { try { const { stdout } = await execAsync(`curl -s -o /dev/null -w "%{speed_download},%{speed_upload},%{time_connect}" http://speedtest.tele2.net/10MB.zip`, { encoding: "utf-8" }); const parts = stdout.split(","); return { download: parseFloat(parts[0]) / 1024 / 1024, upload: parseFloat(parts[1]) / 1024 / 1024, latency: parseFloat(parts[2]) }; } catch { return { download: 0, upload: 0, latency: 0 }; } }

export class NetworkingAdvancedLayer { dnsLookup = dnsLookup; reverseDNS = reverseDNS; whoisLookup = whoisLookup; connectVPN = connectVPN; disconnectVPN = disconnectVPN; getVPNStatus = getVPNStatus; listVPNConfigs = listVPNConfigs; traceroute = traceroute; portScan = portScan; speedTest = speedTest; }
