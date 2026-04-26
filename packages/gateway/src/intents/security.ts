import type { IntentHandler } from "./types.js";

export const wifiScan: IntentHandler = async (_args, ctx) => {
  const networks = await ctx.layers.deepOS!.scanWiFiNetworks();
  return {
    speak: `Found ${networks.length} Wi-Fi network${networks.length === 1 ? "" : "s"}.`,
    data: { networks },
  };
};

export const wifiDetails: IntentHandler = async (_args, ctx) => {
  const details = await ctx.layers.deepOS!.getWiFiDetails();
  return { speak: "Current Wi-Fi details retrieved.", data: { details } };
};

export const wifiMonitorStart: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.enableMonitorMode(
    args.channel as number | undefined
  );
  return {
    speak: success ? "Monitor mode enabled." : "Failed to enable monitor mode.",
    data: { success },
  };
};

export const wifiMonitorStop: IntentHandler = async (_args, ctx) => {
  const success = await ctx.layers.deepOS!.disableMonitorMode();
  return {
    speak: success ? "Monitor mode disabled." : "Failed to disable monitor mode.",
    data: { success },
  };
};

export const networkCapture: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.deepOS!.capturePackets(
    args.iface as string,
    args.filter as string,
    args.duration as number,
    args.outFile as string
  );
  return {
    speak: result.success
      ? `Capture complete. ${result.packetCount} packets captured.`
      : "Packet capture failed.",
    data: result,
  };
};

export const networkScanHosts: IntentHandler = async (args, ctx) => {
  const hosts = await ctx.layers.deepOS!.scanHosts(args.subnet as string);
  return {
    speak: `Found ${hosts.length} host${hosts.length === 1 ? "" : "s"} on subnet.`,
    data: { hosts },
  };
};

export const networkScanPorts: IntentHandler = async (args, ctx) => {
  const ports = await ctx.layers.deepOS!.portScan(
    args.host as string,
    args.ports as string | undefined
  );
  const openCount = ports.filter((p) => p.state === "open").length;
  return {
    speak: `Port scan complete. ${openCount} open port${openCount === 1 ? "" : "s"} found.`,
    data: { ports },
  };
};

export const networkDns: IntentHandler = async (args, ctx) => {
  const output = await ctx.layers.deepOS!.dnsLookup(
    args.domain as string,
    args.type as string | undefined
  );
  return { speak: "DNS lookup complete.", data: { output } };
};

export const networkWhois: IntentHandler = async (args, ctx) => {
  const output = await ctx.layers.deepOS!.whoisLookup(args.target as string);
  return { speak: "WHOIS lookup complete.", data: { output } };
};

export const securityTools: IntentHandler = async (_args, ctx) => {
  const tools = await ctx.layers.deepOS!.checkToolAvailability([
    "nmap",
    "tcpdump",
    "hashcat",
    "aircrack-ng",
    "wireshark",
    "john",
    "hydra",
    "netcat",
    "curl",
    "openssl",
  ]);
  const available = tools.filter((t) => t.available).map((t) => t.name);
  return {
    speak: `${available.length} of ${tools.length} security tools available.`,
    data: { tools },
  };
};

export const securityAudit: IntentHandler = async (_args, ctx) => {
  const deepOS = ctx.layers.deepOS!;

  const [openPorts, firewallStatus, wifiDetails] = await Promise.all([
    deepOS.getOpenPorts(),
    deepOS.getFirewallStatus(),
    deepOS.getWiFiDetails(),
  ]);

  const wifiSecurity = wifiDetails["link auth"] ?? wifiDetails["security"] ?? null;
  const sshEnabled = openPorts.some((p) => p.localPort === 22);
  const remoteLoginEnabled = sshEnabled;

  const recommendations: string[] = [];
  if (!firewallStatus.enabled) {
    recommendations.push("Enable the firewall to block unauthorized inbound connections.");
  }
  if (sshEnabled) {
    recommendations.push("SSH port 22 is open — ensure key-based auth is enforced and password auth is disabled.");
  }
  if (!wifiSecurity || wifiSecurity === "NONE" || wifiSecurity.includes("WEP")) {
    recommendations.push("Wi-Fi is using weak or no encryption. Upgrade to WPA3 or WPA2.");
  }
  if (openPorts.length > 10) {
    recommendations.push(`${openPorts.length} open ports detected — review and close unused services.`);
  }

  return {
    speak: `Security audit complete. ${recommendations.length} recommendation${recommendations.length === 1 ? "" : "s"} found.`,
    data: {
      openPorts,
      firewallStatus,
      wifiSecurity,
      sshEnabled,
      remoteLoginEnabled,
      recommendations,
    },
  };
};
