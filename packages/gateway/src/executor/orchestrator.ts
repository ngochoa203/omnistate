import type { StatePlan, StateNode, ExecutionLayer } from "../types/task.js";
import { ExecutionQueue } from "./queue.js";
import { RetryEngine } from "./retry.js";
import { verifyStep } from "./verify.js";
import { DeepLayer } from "../layers/deep.js";
import { SurfaceLayer } from "../layers/surface.js";
import * as bridge from "../platform/bridge.js";
import { DeepOSLayer } from "../layers/deep-os.js";
import { DeepSystemLayer } from "../layers/deep-system.js";
import { AdvancedHealthMonitor } from "../health/advanced-health.js";
import * as HybridAutomation from "../hybrid/automation.js";
import * as HybridTooling from "../hybrid/tooling.js";
import { AdvancedVision } from "../vision/advanced.js";

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execution Orchestrator — coordinates the three execution layers.
 *
 * Walks through a StatePlan's DAG, executing each step on the
 * appropriate layer, verifying results, and handling retries.
 */
export class Orchestrator {
  private queue: ExecutionQueue;
  private retry: RetryEngine;
  private deep: DeepLayer;
  private surface: SurfaceLayer;
  private deepOS: DeepOSLayer;
  private deepSystem: DeepSystemLayer;
  private health: AdvancedHealthMonitor;
  private hybridAuto: typeof HybridAutomation;
  private hybridTools: typeof HybridTooling;
  private vision: AdvancedVision;
  private activeMacroSessionId: string | null;

  constructor() {
    this.queue = new ExecutionQueue();
    this.retry = new RetryEngine();
    this.deep = new DeepLayer();
    this.surface = new SurfaceLayer();
    this.deepOS = new DeepOSLayer(this.deep);
    this.deepSystem = new DeepSystemLayer(this.deep);
    this.health = new AdvancedHealthMonitor();
    this.hybridAuto = HybridAutomation;
    this.hybridTools = HybridTooling;
    this.vision = new AdvancedVision();
    this.activeMacroSessionId = null;
  }

  /** Get current queue depth. */
  get queueDepth(): number {
    return this.queue.depth;
  }

  /**
   * Execute a complete plan.
   */
  async executePlan(plan: StatePlan): Promise<ExecutionResult> {
    const completed = new Set<string>();
    const results: Map<string, StepResult> = new Map();

    for (const node of plan.nodes) {
      const result = await this.executeNode(node, results);
      results.set(node.id, result);

      if (result.status === "ok") {
        completed.add(node.id);
      } else {
        // Attempt retry
        const retried = await this.retry.attemptRetry(
          node,
          result,
          (n) => this.executeNode(n, results)
        );
        if (retried.status === "ok") {
          completed.add(node.id);
          results.set(node.id, retried);
        } else {
          return {
            taskId: plan.taskId,
            status: "failed",
            completedSteps: completed.size,
            totalSteps: plan.nodes.length,
            error: retried.error,
            stepResults: Array.from(results.values()),
          };
        }
      }
    }

    return {
      taskId: plan.taskId,
      status: "complete",
      completedSteps: completed.size,
      totalSteps: plan.nodes.length,
      stepResults: Array.from(results.values()),
    };
  }

  private async executeNode(
    node: StateNode,
    _context: Map<string, StepResult>
  ): Promise<StepResult> {
    const layer = this.selectLayer(node);
    const params = node.action.params;
    const tool = node.action.tool;

    const startMs = Date.now();
    let data: Record<string, unknown> = {};

    // Verify-type nodes are handled by verifyStep() below, not as tool execution
    if (node.type === "verify" || tool.startsWith("verify.")) {
      const durationMs = Date.now() - startMs;
      const result: StepResult = {
        nodeId: node.id,
        status: "ok",
        layer,
        durationMs,
        data: {},
      };

      if (node.verify) {
        const verified = await verifyStep(node, result);
        if (!verified.passed) {
          return { ...result, status: "failed", error: verified.reason };
        }
      }

      return result;
    }

    try {
      if (layer === "deep") {
        data = await this.executeDeep(tool, params);
      } else if (layer === "surface") {
        data = await this.executeSurface(tool, params);
      } else {
        throw new Error(`Unsupported execution layer: ${layer}`);
      }
    } catch (err) {
      const durationMs = Date.now() - startMs;
      return {
        nodeId: node.id,
        status: "failed",
        layer,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const durationMs = Date.now() - startMs;
    const result: StepResult = {
      nodeId: node.id,
      status: "ok",
      layer,
      durationMs,
      data,
    };

    // Verify if configured
    if (node.verify) {
      const verified = await verifyStep(node, result);
      if (!verified.passed) {
        return { ...result, status: "failed", error: verified.reason };
      }
    }

    return result;
  }

  private async executeDeep(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "shell.exec": {
        const output = this.deep.exec(params.command as string);
        return { output };
      }
      case "app.launch": {
        const success = await this.deep.launchApp(params.name as string);
        return { success };
      }
      case "app.activate": {
        const success = await this.deep.activateApp(params.name as string);
        return { success };
      }
      case "app.quit": {
        const success = await this.deep.quitApp(params.name as string);
        return { success };
      }
      case "app.script": {
        const output = await this.deep.runAppleScript(params.script as string);
        return { output };
      }
      case "file.read": {
        const content = this.deep.readFile(params.path as string);
        return { content };
      }
      case "file.write": {
        this.deep.writeFile(params.path as string, params.content as string);
        return { path: params.path };
      }
      case "process.list": {
        const processes = await this.deep.getProcessList();
        return { processes };
      }
      case "process.kill": {
        const success = await this.deep.killProcess(params.pid as number);
        return { success };
      }
      case "system.info": {
        const info = this.deep.getSystemInfo();
        return { info };
      }
      case "generic.execute": {
        const raw =
          (params as any).command ??
          (params as any).goal ??
          (params as any).intent ??
          "";
        const cmd = typeof raw === "string" ? raw : "";
        // Safety check: don't run natural language as shell commands
        const trimmed = cmd.trim();
        const nlIndicators = /^(what|how|why|when|where|who|show|check|find|list|get|tell|can|is|are|do|does|please|help|i want|i need|open|launch|start|message|send|chat)/i;
        const looksLikeCommand = /^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|python3|node|make|brew|docker|kubectl|tmutil|osascript)\b/i.test(trimmed);
        if (!trimmed || nlIndicators.test(trimmed) || !looksLikeCommand) {
          return {
            success: false,
            output: `I understood your request "${cmd}" but couldn't map it to a safe executable shell command. Please use a supported task phrase (e.g. app-control/system-query) or an explicit command.`,
          };
        }
        // Only execute if it looks like a real shell command
        try {
          const output = this.deep.exec(cmd);
          return { success: true, output };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      // ── Domain B: Deep OS Layer (UC-B01 to B15) ──────────────────────
      case "process.restart": {
        const success = await this.deepOS.restartProcess(params.name as string);
        return { success };
      }
      case "process.renice": {
        const success = await this.deepOS.reniceProcess(params.pid as number, params.priority as number);
        return { success };
      }
      case "process.details": {
        const details = await this.deepOS.getProcessDetails(params.pid as number);
        return { details };
      }
      case "app.resolve": {
        const info = await this.deepOS.resolveApp(params.name as string);
        return { info };
      }
      case "app.install": {
        const success = await this.deepOS.installApp(params.name as string, params.manager as "brew" | "cask" | undefined);
        return { success };
      }
      case "app.launchWithContext": {
        const success = await this.deepOS.launchAppWithContext(params.name as string, params.args as string[] | undefined, params.env as Record<string, string> | undefined);
        return { success };
      }
      case "snapshot.create": {
        const info = await this.deepOS.createSnapshot(params.label as string);
        return { info };
      }
      case "snapshot.list": {
        const snapshots = await this.deepOS.listSnapshots();
        return { snapshots };
      }
      case "snapshot.rollback": {
        const success = await this.deepOS.rollbackToSnapshot(params.label as string);
        return { success };
      }
      case "os.getConfig": {
        const value = await this.deepOS.getOSConfig(params.key as string);
        return { value };
      }
      case "os.setConfig": {
        const success = await this.deepOS.setOSConfig(params.key as string, params.value as string, params.domain as string | undefined);
        return { success };
      }
      case "os.darkMode": {
        if (params.set !== undefined) {
          const success = await this.deepOS.setDarkMode(params.set as boolean);
          return { success };
        }
        const enabled = await this.deepOS.isDarkMode();
        return { enabled };
      }
      case "os.dns": {
        if (params.servers) {
          const success = await this.deepOS.setDNS(params.servers as string[], params.iface as string | undefined);
          return { success };
        }
        const servers = await this.deepOS.getDNS();
        return { servers };
      }
      case "os.proxy": {
        if (params.config) {
          const success = await this.deepOS.setProxy(params.config as Parameters<typeof this.deepOS.setProxy>[0]);
          return { success };
        }
        const config = await this.deepOS.getProxy();
        return { config };
      }
      case "service.list": {
        const services = await this.deepOS.listServices();
        return { services };
      }
      case "service.status": {
        const status = await this.deepOS.getServiceStatus(params.name as string);
        return { status };
      }
      case "service.start": {
        const success = await this.deepOS.startService(params.name as string);
        return { success };
      }
      case "service.stop": {
        const success = await this.deepOS.stopService(params.name as string);
        return { success };
      }
      case "service.restart": {
        const success = await this.deepOS.restartService(params.name as string);
        return { success };
      }
      case "service.enable": {
        const success = await this.deepOS.enableService(params.name as string);
        return { success };
      }
      case "service.disable": {
        const success = await this.deepOS.disableService(params.name as string);
        return { success };
      }
      case "package.list": {
        const packages = await this.deepOS.listInstalledPackages(params.manager as string | undefined);
        return { packages };
      }
      case "package.install": {
        const success = await this.deepOS.installPackage(params.name as string, params.manager as string | undefined);
        return { success };
      }
      case "package.remove": {
        const success = await this.deepOS.removePackage(params.name as string, params.manager as string | undefined);
        return { success };
      }
      case "package.upgrade": {
        const success = await this.deepOS.upgradePackage(params.name as string, params.manager as string | undefined);
        return { success };
      }
      case "package.upgradeAll": {
        const success = await this.deepOS.upgradeAll(params.manager as string | undefined);
        return { success };
      }
      case "package.search": {
        const packages = await this.deepOS.searchPackage(params.query as string, params.manager as string | undefined);
        return { packages };
      }
      case "network.interfaces": {
        const interfaces = await this.deepOS.getNetworkInterfaces();
        return { interfaces };
      }
      case "network.wifi": {
        const wifi = await this.deepOS.getWiFiStatus();
        return { wifi };
      }
      case "network.wifiConnect": {
        const success = await this.deepOS.connectWiFi(params.ssid as string, params.password as string | undefined);
        return { success };
      }
      case "network.wifiDisconnect": {
        const success = await this.deepOS.disconnectWiFi();
        return { success };
      }
      case "network.firewall": {
        const status = await this.deepOS.getFirewallStatus();
        return { status };
      }
      case "network.firewallToggle": {
        const success = await this.deepOS.setFirewallEnabled(params.enabled as boolean);
        return { success };
      }
      case "network.openPorts": {
        const ports = await this.deepOS.getOpenPorts();
        return { ports };
      }
      case "network.connections": {
        const connections = await this.deepOS.getActiveConnections();
        return { connections };
      }
      case "network.routes": {
        const routes = await this.deepOS.getRoutingTable();
        return { routes };
      }
      case "network.ping": {
        const result = await this.deepOS.pingHost(params.host as string, params.count as number | undefined);
        return { result };
      }
      case "network.traceroute": {
        const output = await this.deepOS.traceroute(params.host as string);
        return { output };
      }
      case "network.vpn": {
        const vpns = await this.deepOS.getVPNStatus();
        return { vpns };
      }
      case "kernel.sysctl": {
        if (params.value) {
          const success = await this.deepOS.setSysctl(params.key as string, params.value as string);
          return { success };
        }
        const value = await this.deepOS.getSysctl(params.key as string);
        return { value };
      }
      case "kernel.power": {
        if (params.value) {
          const success = await this.deepOS.setPowerSetting(params.key as string, params.value as string);
          return { success };
        }
        const settings = await this.deepOS.getPowerSettings();
        return { settings };
      }
      case "audio.devices": {
        const devices = await this.deepOS.getAudioDevices();
        return { devices };
      }
      case "audio.setOutput": {
        const success = await this.deepOS.setAudioOutput(params.deviceId as string);
        return { success };
      }
      case "audio.setInput": {
        const success = await this.deepOS.setAudioInput(params.deviceId as string);
        return { success };
      }
      case "audio.volume": {
        if (params.level !== undefined) {
          const success = await this.deepOS.setVolume(params.level as number);
          return { success };
        }
        const level = await this.deepOS.getVolume();
        return { level };
      }
      case "audio.mute": {
        const success = await this.deepOS.setMute(params.muted as boolean);
        return { success };
      }
      case "display.brightness": {
        if (params.level !== undefined) {
          const success = await this.deepOS.setBrightness(params.level as number);
          return { success };
        }
        const level = await this.deepOS.getBrightness();
        return { level };
      }
      case "bluetooth.status": {
        const status = await this.deepOS.getBluetoothStatus();
        return { status };
      }
      case "bluetooth.toggle": {
        const success = await this.deepOS.setBluetoothEnabled(params.enabled as boolean);
        return { success };
      }
      case "bluetooth.devices": {
        const devices = await this.deepOS.listBluetoothDevices();
        return { devices };
      }
      case "disk.eject": {
        const success = await this.deepOS.ejectDisk(params.mountPoint as string);
        return { success };
      }
      case "schedule.list": {
        const tasks = await this.deepOS.listScheduledTasks();
        return { tasks };
      }
      case "schedule.create": {
        const success = await this.deepOS.createScheduledTask(params.config as Parameters<typeof this.deepOS.createScheduledTask>[0]);
        return { success };
      }
      case "schedule.remove": {
        const success = await this.deepOS.removeScheduledTask(params.label as string);
        return { success };
      }
      case "defaults.read": {
        const value = await this.deepOS.readDefault(params.domain as string, params.key as string);
        return { value };
      }
      case "defaults.write": {
        const success = await this.deepOS.writeDefault(params.domain as string, params.key as string, params.type as string, params.value as string);
        return { success };
      }
      case "defaults.delete": {
        const success = await this.deepOS.deleteDefault(params.domain as string, params.key as string);
        return { success };
      }
      case "user.list": {
        const users = await this.deepOS.listUsers();
        return { users };
      }
      case "user.current": {
        const user = await this.deepOS.getCurrentUser();
        return { user };
      }
      case "user.groups": {
        const groups = await this.deepOS.listGroups();
        return { groups };
      }
      case "file.permissions": {
        const perms = await this.deepOS.getFilePermissions(params.path as string);
        return { perms };
      }
      case "file.chmod": {
        const success = await this.deepOS.setFilePermissions(params.path as string, params.mode as string);
        return { success };
      }
      case "file.chown": {
        const success = await this.deepOS.setFileOwner(params.path as string, params.owner as string, params.group as string | undefined);
        return { success };
      }
      case "volume.list": {
        const volumes = await this.deepOS.listVolumes();
        return { volumes };
      }
      case "volume.mount": {
        const success = await this.deepOS.mountVolume(params.device as string, params.mountPoint as string);
        return { success };
      }
      case "volume.unmount": {
        const success = await this.deepOS.unmountVolume(params.mountPoint as string);
        return { success };
      }
      case "env.get": {
        const value = await this.deepOS.getEnvVar(params.name as string);
        return { value };
      }
      case "env.set": {
        const success = await this.deepOS.setEnvVar(params.name as string, params.value as string, params.persist as boolean | undefined);
        return { success };
      }
      case "env.unset": {
        const success = await this.deepOS.unsetEnvVar(params.name as string, params.persist as boolean | undefined);
        return { success };
      }
      case "env.list": {
        const vars = await this.deepOS.listEnvVars();
        return { vars };
      }

      // ── Domain B: Deep System Layer (UC-B16 to B30) ──────────────────
      case "shell.type": {
        const shellType = await this.deepSystem.getShellType();
        return { shellType };
      }
      case "shell.config": {
        const config = await this.deepSystem.getShellConfig();
        return { config };
      }
      case "shell.addAlias": {
        const success = await this.deepSystem.addAlias(params.name as string, params.command as string);
        return { success };
      }
      case "shell.removeAlias": {
        const success = await this.deepSystem.removeAlias(params.name as string);
        return { success };
      }
      case "shell.aliases": {
        const aliases = await this.deepSystem.listAliases();
        return { aliases };
      }
      case "shell.addToPath": {
        const success = await this.deepSystem.addToPath(params.dir as string);
        return { success };
      }
      case "shell.history": {
        const history = await this.deepSystem.getShellHistory(params.limit as number | undefined);
        return { history };
      }
      case "log.system": {
        const logs = await this.deepSystem.getSystemLogs(params.lines as number | undefined, params.filter as string | undefined);
        return { logs };
      }
      case "log.app": {
        const logs = await this.deepSystem.getAppLogs(params.appName as string, params.lines as number | undefined);
        return { logs };
      }
      case "log.search": {
        const results = await this.deepSystem.searchLogs(params.query as string, params.since as string | undefined);
        return { results };
      }
      case "log.size": {
        const size = await this.deepSystem.getLogSize();
        return { size };
      }
      case "log.clean": {
        const result = await this.deepSystem.cleanOldLogs(params.olderThanDays as number | undefined);
        return { result };
      }
      case "clipboard.get": {
        const content = await this.deepSystem.getClipboard();
        return { content };
      }
      case "clipboard.set": {
        const success = await this.deepSystem.setClipboard(params.content as string);
        return { success };
      }
      case "clipboard.history": {
        const history = await this.deepSystem.getClipboardHistory();
        return { history };
      }
      case "clipboard.clear": {
        const success = await this.deepSystem.clearClipboard();
        return { success };
      }
      case "font.list": {
        const fonts = await this.deepSystem.listFonts();
        return { fonts };
      }
      case "font.install": {
        const success = await this.deepSystem.installFont(params.path as string);
        return { success };
      }
      case "locale.get": {
        const locale = await this.deepSystem.getLocale();
        return { locale };
      }
      case "locale.set": {
        const success = await this.deepSystem.setLocale(params.locale as string);
        return { success };
      }
      case "timezone.get": {
        const timezone = await this.deepSystem.getTimezone();
        return { timezone };
      }
      case "timezone.set": {
        const success = await this.deepSystem.setTimezone(params.tz as string);
        return { success };
      }
      case "keyboard.layouts": {
        const layouts = await this.deepSystem.getKeyboardLayouts();
        return { layouts };
      }
      case "keyboard.setLayout": {
        const success = await this.deepSystem.setKeyboardLayout(params.layout as string);
        return { success };
      }
      case "startup.list": {
        const items = await this.deepSystem.listStartupItems();
        return { items };
      }
      case "startup.add": {
        const success = await this.deepSystem.addStartupItem(params.config as Parameters<typeof this.deepSystem.addStartupItem>[0]);
        return { success };
      }
      case "startup.remove": {
        const success = await this.deepSystem.removeStartupItem(params.name as string);
        return { success };
      }
      case "login.items": {
        const items = await this.deepSystem.listLoginItems();
        return { items };
      }
      case "login.add": {
        const success = await this.deepSystem.addLoginItem(params.appPath as string);
        return { success };
      }
      case "login.remove": {
        const success = await this.deepSystem.removeLoginItem(params.appName as string);
        return { success };
      }
      case "power.battery": {
        const info = await this.deepSystem.getBatteryInfo();
        return { info };
      }
      case "power.sleep": {
        const success = await this.deepSystem.sleep();
        return { success };
      }
      case "power.shutdown": {
        const success = await this.deepSystem.shutdown(params.delay as number | undefined);
        return { success };
      }
      case "power.restart": {
        const success = await this.deepSystem.restart(params.delay as number | undefined);
        return { success };
      }
      case "power.scheduleWake": {
        const success = await this.deepSystem.scheduleWake(new Date(params.date as string).toISOString());
        return { success };
      }
      case "cert.list": {
        const certs = await this.deepSystem.listCertificates(params.keychain as string | undefined);
        return { certs };
      }
      case "cert.install": {
        const success = await this.deepSystem.installCertificate(params.certPath as string, params.keychain as string | undefined);
        return { success };
      }
      case "ssh.list": {
        const keys = await this.deepSystem.listSSHKeys();
        return { keys };
      }
      case "ssh.generate": {
        const key = await this.deepSystem.generateSSHKey(params.type as string | undefined, params.comment as string | undefined);
        return { key };
      }
      case "gpg.list": {
        const keys = await this.deepSystem.listGPGKeys();
        return { keys };
      }
      case "firewall.rules": {
        const rules = await this.deepSystem.getFirewallRules();
        return { rules };
      }
      case "firewall.addRule": {
        const success = await this.deepSystem.addFirewallRule(params.rule as Parameters<typeof this.deepSystem.addFirewallRule>[0]);
        return { success };
      }
      case "firewall.blockIP": {
        const success = await this.deepSystem.blockIP(params.ip as string);
        return { success };
      }
      case "firewall.unblockIP": {
        const success = await this.deepSystem.unblockIP(params.ip as string);
        return { success };
      }
      case "firewall.blockPort": {
        const success = await this.deepSystem.blockPort(params.port as number, params.protocol as "tcp" | "udp" | undefined);
        return { success };
      }
      case "firewall.allowPort": {
        const success = await this.deepSystem.allowPort(params.port as number, params.protocol as "tcp" | "udp" | undefined);
        return { success };
      }
      case "container.list": {
        const containers = await this.deepSystem.listContainers(params.all as boolean | undefined);
        return { containers };
      }
      case "container.start": {
        const success = await this.deepSystem.startContainer(params.id as string);
        return { success };
      }
      case "container.stop": {
        const success = await this.deepSystem.stopContainer(params.id as string);
        return { success };
      }
      case "container.remove": {
        const success = await this.deepSystem.removeContainer(params.id as string);
        return { success };
      }
      case "container.logs": {
        const logs = await this.deepSystem.getContainerLogs(params.id as string, params.tail as number | undefined);
        return { logs };
      }
      case "container.images": {
        const images = await this.deepSystem.listImages();
        return { images };
      }
      case "container.pull": {
        const success = await this.deepSystem.pullImage(params.name as string);
        return { success };
      }
      case "docker.status": {
        const running = await this.deepSystem.isDockerRunning();
        return { running };
      }
      case "vm.list": {
        const vms = await this.deepSystem.listVMs();
        return { vms };
      }
      case "vm.start": {
        const success = await this.deepSystem.startVM(params.name as string);
        return { success };
      }
      case "vm.stop": {
        const success = await this.deepSystem.stopVM(params.name as string);
        return { success };
      }
      case "display.list": {
        const displays = await this.deepSystem.getDisplays();
        return { displays };
      }
      case "display.setResolution": {
        const success = await this.deepSystem.setResolution((params.displayId as number).toString(), params.width as number, params.height as number);
        return { success };
      }
      case "display.nightShift": {
        if (params.enabled !== undefined) {
          const success = await this.deepSystem.setNightShift(params.enabled as boolean);
          return { success };
        }
        const enabled = await this.deepSystem.getNightShiftStatus();
        return { enabled };
      }
      case "audio.sources": {
        const sources = await this.deepSystem.getAudioSources();
        return { sources };
      }
      case "audio.defaultOutput": {
        const success = await this.deepSystem.setDefaultAudioOutput(params.deviceName as string);
        return { success };
      }
      case "audio.defaultInput": {
        const success = await this.deepSystem.setDefaultAudioInput(params.deviceName as string);
        return { success };
      }
      case "audio.muted": {
        const muted = await this.deepSystem.isMuted();
        return { muted };
      }
      case "audio.toggleMute": {
        const success = await this.deepSystem.toggleMute();
        return { success };
      }
      case "printer.list": {
        const printers = await this.deepSystem.listPrinters();
        return { printers };
      }
      case "printer.default": {
        if (params.name) {
          const success = await this.deepSystem.setDefaultPrinter(params.name as string);
          return { success };
        }
        const printer = await this.deepSystem.getDefaultPrinter();
        return { printer };
      }
      case "printer.print": {
        const success = await this.deepSystem.printFile(params.filePath as string, params.printer as string | undefined);
        return { success };
      }
      case "printer.queue": {
        const queue = await this.deepSystem.getPrintQueue(params.printer as string | undefined);
        return { queue };
      }
      case "backup.timemachine": {
        const status = await this.deepSystem.getTimeMachineStatus();
        return { status };
      }
      case "backup.start": {
        const success = await this.deepSystem.startTimeMachineBackup();
        return { success };
      }
      case "backup.list": {
        const backups = await this.deepSystem.listTimeMachineBackups();
        return { backups };
      }
      case "backup.rsync": {
        const result = await this.deepSystem.rsync(params.source as string, params.dest as string, params.opts as Parameters<typeof this.deepSystem.rsync>[2]);
        return { result };
      }
      case "update.check": {
        const updates = await this.deepSystem.checkForUpdates();
        return { updates };
      }
      case "update.install": {
        const success = await this.deepSystem.installUpdate(params.name as string);
        return { success };
      }
      case "update.installAll": {
        const success = await this.deepSystem.installAllUpdates();
        return { success };
      }
      case "update.osVersion": {
        const version = await this.deepSystem.getOSVersion();
        return { version };
      }
      case "memory.pressure": {
        const pressure = await this.deepSystem.getMemoryPressure();
        return { pressure };
      }
      case "memory.swap": {
        const swap = await this.deepSystem.getSwapUsage();
        return { swap };
      }
      case "memory.topProcesses": {
        const processes = await this.deepSystem.getTopMemoryProcesses(params.count as number | undefined);
        return { processes };
      }
      case "memory.purge": {
        const success = await this.deepSystem.purgeMemory();
        return { success };
      }
      case "memory.vmstats": {
        const stats = await this.deepSystem.getVMStats();
        return { stats };
      }

      // ── Domain C: Health & Self-Healing ──────────────────────────────
      case "health.notify": {
        const success = await this.health.sendNotification({ title: params.title as string, message: params.message as string });
        return { success };
      }
      case "health.diskRescue": {
        const report = await this.health.diskRescue();
        return { report };
      }
      case "health.networkDiagnose": {
        const diagnosis = await this.health.diagnoseAndHealNetwork();
        return { diagnosis };
      }
      case "health.securityScan": {
        const report = await this.health.securityScan();
        return { report };
      }
      case "health.thermal": {
        const state = await this.health.getThermalStatus();
        return { state };
      }
      case "health.battery": {
        const info = await this.health.getBatteryInfo();
        return { info };
      }
      case "health.filesystem": {
        const result = await this.health.checkFilesystemIntegrity(params.volume as string | undefined);
        return { result };
      }
      case "health.certExpiry": {
        const result = await this.health.checkCertExpiry(params.host as string, params.port as number | undefined);
        return { result };
      }
      case "health.logAnomalies": {
        const anomalies = await this.health.detectLogAnomalies(params.source as string | undefined);
        return { anomalies };
      }
      case "health.smartDisk": {
        const health = await this.health.getSmartDiskHealth(params.device as string | undefined);
        return { health };
      }
      case "health.socketStats": {
        const stats = await this.health.checkPortExhaustion();
        return { stats };
      }

      // ── Domain D: Hybrid Automation ──────────────────────────────────
      case "hybrid.voice": {
        const result = await this.hybridAuto.processVoiceCommand(params.audioBuffer as Buffer);
        return { result };
      }
      case "hybrid.migration.scan": {
        const manifest = await this.hybridAuto.scanSourceMachine();
        return { manifest };
      }
      case "hybrid.migration.plan": {
        const plan = await this.hybridAuto.generateMigrationPlan(
          params.manifest as Parameters<typeof this.hybridAuto.generateMigrationPlan>[0],
          params.target as string | undefined
        );
        return { plan };
      }
      case "hybrid.migration.execute": {
        const result = await this.hybridAuto.executeMigration(
          params.plan as Parameters<typeof this.hybridAuto.executeMigration>[0]
        );
        return { result };
      }
      case "hybrid.macro.start": {
        const sessionId = this.hybridAuto.startRecording();
        this.activeMacroSessionId = sessionId;
        return { sessionId };
      }
      case "hybrid.macro.stop": {
        const sessionId =
          (params.sessionId as string | undefined) ?? this.activeMacroSessionId;
        if (!sessionId) {
          throw new Error("No active macro recording session");
        }
        const sequence = this.hybridAuto.stopRecording(sessionId);
        if (this.activeMacroSessionId === sessionId) {
          this.activeMacroSessionId = null;
        }
        return { sequence };
      }
      case "hybrid.macro.infer": {
        const macro = await this.hybridAuto.inferMacro(
          params.sequence as Parameters<typeof this.hybridAuto.inferMacro>[0]
        );
        return { macro };
      }
      case "hybrid.macro.save": {
        const success = await this.hybridAuto.saveMacro(
          params.macro as Parameters<typeof this.hybridAuto.saveMacro>[0]
        );
        return { success };
      }
      case "hybrid.macro.list": {
        const macros = await this.hybridAuto.listMacros();
        return { macros };
      }
      case "hybrid.macro.run": {
        const result = await this.hybridAuto.runMacro(
          params.macroId as string,
          params.params as Record<string, unknown> | undefined
        );
        return { result };
      }
      case "hybrid.speak": {
        const success = await this.hybridAuto.speak(params.text as string, params.voice as string | undefined);
        return { success };
      }
      case "hybrid.generateScript": {
        const script = await this.hybridAuto.generateScript(params.description as string, params.language as "bash" | "python" | "applescript" | undefined);
        return { script };
      }
      case "hybrid.suggestAction": {
        const suggestions = await this.hybridAuto.suggestNextAction();
        return { suggestions };
      }
      case "hybrid.orchestrateApps": {
        const result = await this.hybridAuto.orchestrateApps(params.workflow as Parameters<typeof this.hybridAuto.orchestrateApps>[0]);
        return { result };
      }
      case "hybrid.state.define": {
        const stateId = await this.hybridAuto.defineDesiredState(
          params.spec as Parameters<typeof this.hybridAuto.defineDesiredState>[0]
        );
        return { stateId };
      }
      case "hybrid.state.check": {
        const report = await this.hybridAuto.checkDrift(params.stateId as string);
        return { report };
      }
      case "hybrid.state.enforce": {
        const result = await this.hybridAuto.enforcState(params.stateId as string);
        return { result };
      }
      case "hybrid.state.startLoop": {
        this.hybridAuto.startDesiredStateLoop(
          params.stateId as string,
          params.intervalMs as number | undefined
        );
        return { success: true };
      }
      case "hybrid.state.stopLoop": {
        this.hybridAuto.stopDesiredStateLoop(params.stateId as string);
        return { success: true };
      }
      case "hybrid.checkpoint.record": {
        const checkpoint = await this.hybridAuto.recordCheckpoint(params.label as string | undefined);
        return { checkpoint };
      }
      case "hybrid.checkpoint.list": {
        const checkpoints = await this.hybridAuto.listCheckpoints();
        return { checkpoints };
      }
      case "hybrid.checkpoint.rollback": {
        const result = await this.hybridAuto.rollbackToCheckpoint(params.checkpointId as string);
        return { result };
      }
      case "hybrid.checkpoint.undo": {
        const result = await this.hybridAuto.undoLastAction();
        return { result };
      }
      case "hybrid.context.serialize": {
        const context = await this.hybridAuto.serializeContext();
        return { context };
      }
      case "hybrid.context.send": {
        const success = await this.hybridAuto.sendContextToDevice(
          params.context as Parameters<typeof this.hybridAuto.sendContextToDevice>[0],
          params.targetId as string
        );
        return { success };
      }
      case "hybrid.context.receive": {
        const success = await this.hybridAuto.receiveContext(
          params.context as Parameters<typeof this.hybridAuto.receiveContext>[0]
        );
        return { success };
      }
      case "hybrid.profile.analyze": {
        const profile = await this.hybridAuto.analyzePatterns(params.days as number | undefined);
        return { profile };
      }
      case "hybrid.profile.suggest": {
        const suggestions = await this.hybridAuto.suggestAutomation();
        return { suggestions };
      }
      case "hybrid.profile.get": {
        const profile = await this.hybridAuto.getUserProfile();
        return { profile };
      }

      // ── Domain D: Hybrid Tooling ─────────────────────────────────────
      case "hybrid.templates": {
        const templates = await this.hybridTools.listWorkflowTemplates();
        return { templates };
      }
      case "hybrid.runTemplate": {
        const result = await this.hybridTools.runTemplate(params.templateId as string, params.params as Record<string, unknown> | undefined);
        return { result };
      }
      case "hybrid.analyzeError": {
        const analysis = await this.hybridTools.analyzeError(params.error as Parameters<typeof this.hybridTools.analyzeError>[0]);
        return { analysis };
      }
      case "hybrid.organizeFiles": {
        const result = await this.hybridTools.organizeDirectory(params.dirPath as string, params.rules as Parameters<typeof this.hybridTools.organizeDirectory>[1]);
        return { result };
      }
      case "hybrid.healthReport": {
        const report = await this.hybridTools.generateHealthReport();
        return { report };
      }
      case "hybrid.machineDiff": {
        const snapshot = await this.hybridTools.snapshotMachine();
        return { snapshot };
      }
      case "hybrid.compliance": {
        const report = await this.hybridTools.runComplianceCheck(params.policies as Parameters<typeof this.hybridTools.runComplianceCheck>[0]);
        return { report };
      }
      case "hybrid.docs": {
        const results = await this.hybridTools.lookupDocs(params.query as string, params.context as Parameters<typeof this.hybridTools.lookupDocs>[1]);
        return { results };
      }
      case "hybrid.forecast": {
        const forecast = await this.hybridTools.forecastUsage(params.metric as string, params.days as number | undefined);
        return { forecast };
      }
      case "hybrid.extensions": {
        const extensions = await this.hybridTools.listBrowserExtensions(params.browser as string | undefined);
        return { extensions };
      }
      case "hybrid.plugins": {
        const plugins = await this.hybridTools.listIDEPlugins(params.ide as string | undefined);
        return { plugins };
      }
      default:
        throw new Error(`Unknown deep layer tool: ${tool}`);
    }
  }

  private async executeSurface(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Surface layer requires native bindings
    if (!bridge.isNativeAvailable()) {
      throw new Error(
        `Surface layer unavailable: ${bridge.getNativeError() ?? "native binary not loaded"}`
      );
    }

    switch (tool) {
      case "screen.capture": {
        const capture = await this.surface.captureScreen();
        return {
          width: capture.width,
          height: capture.height,
          timestampMs: capture.timestampMs,
          captureMethod: capture.captureMethod,
          bytesPerRow: capture.bytesPerRow,
          pixelFormat: capture.pixelFormat,
        };
      }
      case "screen.capture.region": {
        const capture = await this.surface.captureRegion(
          params.x as number,
          params.y as number,
          params.width as number,
          params.height as number,
        );
        return {
          width: capture.width,
          height: capture.height,
          timestampMs: capture.timestampMs,
          captureMethod: capture.captureMethod,
          bytesPerRow: capture.bytesPerRow,
          pixelFormat: capture.pixelFormat,
        };
      }
      case "screen.capture.window": {
        const capture = await this.surface.captureWindow(params.windowId as number);
        return {
          width: capture.width,
          height: capture.height,
          timestampMs: capture.timestampMs,
          captureMethod: capture.captureMethod,
          bytesPerRow: capture.bytesPerRow,
          pixelFormat: capture.pixelFormat,
        };
      }
      case "ui.find": {
        const element = await this.surface.findElement(params.query as string);
        return { element };
      }
      case "ui.move": {
        await this.surface.moveMouse(params.x as number, params.y as number);
        return {};
      }
      case "ui.click": {
        const el = params.element as Parameters<
          typeof this.surface.clickElement
        >[0];
        await this.surface.clickElement(el);
        return {};
      }
      case "ui.clickAt": {
        await this.surface.moveMouse(params.x as number, params.y as number);
        await this.surface.click((params.button as "left" | "right" | "middle" | undefined) ?? "left");
        return {};
      }
      case "ui.doubleClickAt": {
        await this.surface.moveMouse(params.x as number, params.y as number);
        await this.surface.click((params.button as "left" | "right" | "middle" | undefined) ?? "left");
        await waitMs(60);
        await this.surface.click((params.button as "left" | "right" | "middle" | undefined) ?? "left");
        return {};
      }
      case "ui.drag": {
        await this.surface.drag(
          params.fromX as number,
          params.fromY as number,
          params.toX as number,
          params.toY as number,
        );
        return {};
      }
      case "ui.type": {
        await this.surface.typeText(params.text as string);
        return {};
      }
      case "ui.key": {
        await this.surface.keyTap(
          params.key as string,
          params.modifiers as Parameters<typeof this.surface.keyTap>[1]
        );
        return {};
      }
      case "ui.scroll": {
        await this.surface.scroll(
          params.dx as number,
          params.dy as number
        );
        return {};
      }
      case "ui.wait": {
        await waitMs((params.ms as number | undefined) ?? 300);
        return {};
      }
      case "vision.modal.detect": {
        const modal = await this.vision.detectModal();
        return { modal };
      }
      case "vision.modal.dismiss": {
        const handled = await this.vision.dismissModal(
          (params.action as "accept" | "dismiss" | "close" | undefined) ?? "dismiss",
        );
        return { handled };
      }
      case "vision.captcha.detect": {
        const captcha = await this.vision.detectCaptcha();
        return { captcha, present: captcha !== null };
      }
      case "vision.table.detect": {
        const tables = await this.vision.detectTables();
        return { tables };
      }
      case "vision.table.extract": {
        const capture = await this.surface.captureScreen();
        const region =
          typeof params.x === "number" &&
          typeof params.y === "number" &&
          typeof params.width === "number" &&
          typeof params.height === "number"
            ? {
                x: params.x as number,
                y: params.y as number,
                width: params.width as number,
                height: params.height as number,
              }
            : undefined;
        const table = await this.vision.extractTable(capture.data, region);
        const json = this.vision.tableToJSON(table);
        const csv = this.vision.tableToCSV(table);
        return { table, json, csv };
      }
      case "vision.a11y.audit": {
        const report = await this.vision.auditAccessibility();
        return { report };
      }
      case "vision.language.detect": {
        const language = await this.vision.detectUILanguage();
        return { language };
      }
      default:
        throw new Error(`Unknown surface layer tool: ${tool}`);
    }
  }

  /**
   * Resolve "auto" layer by inspecting the tool prefix.
   *
   * shell.*, app.*, file.*, process.*, system.* → deep
   * screen.*, ui.*, vision.*                     → surface
   * All new Domain B/C/D tools                   → deep
   */
  private selectLayer(node: StateNode): ExecutionLayer {
    if (node.layer !== "auto") return node.layer;

    const prefix = node.action.tool.split(".")[0];
    const surfacePrefixes = new Set(["screen", "ui", "vision"]);
    return surfacePrefixes.has(prefix) ? "surface" : "deep";
  }
}

export interface StepResult {
  nodeId: string;
  status: "ok" | "failed";
  layer: ExecutionLayer;
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "complete" | "failed";
  completedSteps: number;
  totalSteps: number;
  error?: string;
  stepResults?: StepResult[];
}
