import type { IntentHandler } from "./types.js";

export const networkInterfaces: IntentHandler = async (_args, ctx) => {
  const interfaces = await ctx.layers.deepOS!.getNetworkInterfaces();
  return { speak: "Network interfaces retrieved.", data: { interfaces } };
};

export const networkWifiConnect: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.connectWiFi(args.ssid as string, args.password as string | undefined);
  return { speak: "Connected to Wi-Fi.", data: { success } };
};

export const networkWifiDisconnect: IntentHandler = async (_args, ctx) => {
  const success = await ctx.layers.deepOS!.disconnectWiFi();
  return { speak: "Disconnected from Wi-Fi.", data: { success } };
};

export const networkFirewall: IntentHandler = async (_args, ctx) => {
  const status = await ctx.layers.deepOS!.getFirewallStatus();
  return { speak: "Firewall status retrieved.", data: { status } };
};

export const networkFirewallToggle: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setFirewallEnabled(args.enabled as boolean);
  return { speak: "Firewall updated.", data: { success } };
};

export const networkOpenPorts: IntentHandler = async (_args, ctx) => {
  const ports = await ctx.layers.deepOS!.getOpenPorts();
  return { speak: "Open ports retrieved.", data: { ports } };
};

export const networkConnections: IntentHandler = async (_args, ctx) => {
  const connections = await ctx.layers.deepOS!.getActiveConnections();
  return { speak: "Active connections retrieved.", data: { connections } };
};

export const networkRoutes: IntentHandler = async (_args, ctx) => {
  const routes = await ctx.layers.deepOS!.getRoutingTable();
  return { speak: "Routing table retrieved.", data: { routes } };
};

export const networkPing: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.deepOS!.pingHost(args.host as string, args.count as number | undefined);
  return { speak: "Ping complete.", data: { result } };
};

export const networkTraceroute: IntentHandler = async (args, ctx) => {
  const output = await ctx.layers.deepOS!.traceroute(args.host as string);
  return { speak: "Traceroute complete.", data: { output } };
};

export const networkVpn: IntentHandler = async (_args, ctx) => {
  const vpns = await ctx.layers.deepOS!.getVPNStatus();
  return { speak: "VPN status retrieved.", data: { vpns } };
};

export const firewallRules: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const rules = await deepSystem.getFirewallRules();
  return { speak: "Firewall rules retrieved.", data: { rules } };
};

export const firewallAddRule: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.addFirewallRule(args.rule);
  return { speak: "Firewall rule added.", data: { success } };
};

export const firewallBlockIP: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.blockIP(args.ip as string);
  return { speak: "IP blocked.", data: { success } };
};

export const firewallUnblockIP: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.unblockIP(args.ip as string);
  return { speak: "IP unblocked.", data: { success } };
};

export const firewallBlockPort: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.blockPort(args.port as number, args.protocol as "tcp" | "udp" | undefined);
  return { speak: "Port blocked.", data: { success } };
};

export const firewallAllowPort: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.allowPort(args.port as number, args.protocol as "tcp" | "udp" | undefined);
  return { speak: "Port allowed.", data: { success } };
};

export const sshList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const keys = await deepSystem.listSSHKeys();
  return { speak: "SSH keys listed.", data: { keys } };
};

export const sshGenerate: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const key = await deepSystem.generateSSHKey(args.type as string | undefined, args.comment as string | undefined);
  return { speak: "SSH key generated.", data: { key } };
};

export const securityVpnToggle: IntentHandler = async (args, ctx) => {
  const vpnName = String(args.name ?? "");
  const vpnEnabled = Boolean(args.enabled ?? true);
  if (vpnEnabled) {
    await ctx.layers.deep.execAsync(
      `scutil --nc start "${vpnName}" 2>/dev/null || networksetup -connectpppoeservice "${vpnName}"`,
      10000,
    );
  } else {
    await ctx.layers.deep.execAsync(
      `scutil --nc stop "${vpnName}" 2>/dev/null || networksetup -disconnectpppoeservice "${vpnName}"`,
      10000,
    );
  }
  return { speak: vpnEnabled ? "VPN connected." : "VPN disconnected.", data: { success: true, vpn: vpnName, enabled: vpnEnabled } };
};

export const securityDnsSet: IntentHandler = async (args, ctx) => {
  const dns = String(args.dns ?? args.server ?? "1.1.1.1");
  const iface = String(args.interface ?? "Wi-Fi");
  await ctx.layers.deep.execAsync(`networksetup -setdnsservers "${iface}" ${dns}`, 5000);
  return { speak: "DNS updated.", data: { success: true, dns, interface: iface } };
};

export const securityProxySet: IntentHandler = async (args, ctx) => {
  const host = String(args.host ?? "");
  const port = Number(args.port ?? 8080);
  const iface = String(args.interface ?? "Wi-Fi");
  await ctx.layers.deep.execAsync(`networksetup -setwebproxy "${iface}" "${host}" ${port}`, 5000);
  return { speak: "Proxy set.", data: { success: true, host, port } };
};
