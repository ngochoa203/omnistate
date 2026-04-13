import type { StatePlan, StateNode, ExecutionLayer } from "../types/task.js";
import { ExecutionQueue } from "./queue.js";
import { RetryEngine } from "./retry.js";
import { verifyStep } from "./verify.js";
import { DeepLayer } from "../layers/deep.js";
import { SurfaceLayer } from "../layers/surface.js";
import * as bridge from "../platform/bridge.js";
import { DeepOSLayer } from "../layers/deep-os.js";
import { DeepSystemLayer } from "../layers/deep-system.js";
import { HardwareLayer } from "../layers/hardware.js";
import { CommunicationLayer } from "../layers/communication.js";
import { SoftwareLayer } from "../layers/software.js";
import { BrowserLayer } from "../layers/browser.js";
import { DeveloperLayer } from "../layers/developer.js";
import { MaintenanceLayer } from "../layers/maintenance.js";
import { MediaLayer } from "../layers/media.js";
import { FleetLayer } from "../layers/fleet.js";
import { DeviceRepository } from "../db/device-repository.js";
import { getDb } from "../db/database.js";
import { AdvancedHealthMonitor } from "../health/advanced-health.js";
import * as HybridAutomation from "../hybrid/automation.js";
import * as HybridTooling from "../hybrid/tooling.js";
import { AdvancedVision } from "../vision/advanced.js";
import { ApprovalEngine } from "../vision/approval-policy.js";
import { PermissionResponder, ClaudeCodeResponder } from "../vision/permission-responder.js";

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
  private hardware: HardwareLayer;
  private communication: CommunicationLayer;
  private software: SoftwareLayer;
  private browser: BrowserLayer;
  private developer: DeveloperLayer;
  private maintenance: MaintenanceLayer;
  private media: MediaLayer;
  private fleet: FleetLayer;
  private health: AdvancedHealthMonitor;
  private hybridAuto: typeof HybridAutomation;
  private hybridTools: typeof HybridTooling;
  private vision: AdvancedVision;
  private activeMacroSessionId: string | null;

  // Permission responder system (optional — wired in when approvalPolicy is configured)
  approvalEngine?: ApprovalEngine;
  permissionResponder?: PermissionResponder;
  claudeCodeResponder?: ClaudeCodeResponder;

  constructor() {
    this.queue = new ExecutionQueue();
    this.retry = new RetryEngine();
    this.deep = new DeepLayer();
    this.surface = new SurfaceLayer();
    this.deepOS = new DeepOSLayer(this.deep);
    this.deepSystem = new DeepSystemLayer(this.deep);
    this.hardware = new HardwareLayer(this.deep);
    this.communication = new CommunicationLayer();
    this.software = new SoftwareLayer(this.deep);
    this.browser = new BrowserLayer(this.surface);
    this.developer = new DeveloperLayer();
    this.maintenance = new MaintenanceLayer();
    this.media = new MediaLayer(this.deep);
    this.fleet = new FleetLayer(new DeviceRepository(getDb()));
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
      const toolPrefix = tool.split(".")[0];
      if (toolPrefix === "hardware") {
        data = await this.executeHardware(tool, params);
      } else if (toolPrefix === "comm") {
        data = await this.executeCommunication(tool, params);
      } else if (toolPrefix === "software" && !["software.install", "software.uninstall", "software.update"].includes(tool)) {
        data = await this.executeSoftware(tool, params);
      } else if (toolPrefix === "browser" && !["browser.open", "browser.newTab", "browser.closeTab", "browser.fillForm", "browser.scrape", "browser.download", "browser.bookmark"].includes(tool)) {
        data = await this.executeBrowser(tool, params);
      } else if (toolPrefix === "dev") {
        data = await this.executeDeveloper(tool, params);
      } else if (toolPrefix === "maint") {
        data = await this.executeMaintenance(tool, params);
      } else if (toolPrefix === "media") {
        data = await this.executeMedia(tool, params);
      } else if (toolPrefix === "fleet") {
        data = await this.executeFleet(tool, params);
      } else if (layer === "deep") {
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
        const name = params.name as string;
        const success = await this.deep.launchApp(name);
        if (success) return { success: true };

        const fallbackSuccess = await this.deep.openDefaultBrowser(name);
        return {
          success: fallbackSuccess,
          fallback: fallbackSuccess ? "default-browser" : "none",
          output: fallbackSuccess
            ? `App '${name}' not found. Opened in default browser instead.`
            : `Unable to launch app '${name}' and fallback browser open failed.`,
        };
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

      // ── UC2.2: Search for apps/files (Spotlight/mdfind) ──────────────
      case "search.spotlight":
      case "search.files": {
        const query = String(params.query ?? "");
        const type = String(params.type ?? "all"); // "app" | "file" | "all"
        let cmd: string;
        if (type === "app") {
          cmd = `mdfind 'kMDItemContentTypeTree == "com.apple.application-bundle" && kMDItemDisplayName == "*${query}*"c' | head -20`;
        } else if (type === "file") {
          cmd = `mdfind -name "${query}" | head -20`;
        } else {
          cmd = `mdfind "${query}" | head -20`;
        }
        const { stdout: searchOut } = await this.deep.execAsync(cmd, 10000);
        const files = (searchOut ?? "").split("\n").filter(Boolean);
        return { success: true, query, results: files, count: files.length };
      }

      // ── UC2.3: Window state management ───────────────────────────────
      case "window.minimize": {
        const app = String(params.app ?? params.target ?? "");
        await this.deep.runAppleScript(`tell application "System Events" to set miniaturized of (first window of (first process whose name contains "${app}")) to true`);
        return { success: true, action: "minimized", app };
      }
      case "window.maximize":
      case "window.fullscreen": {
        const app = String(params.app ?? params.target ?? "");
        await this.deep.runAppleScript(`tell application "System Events" to set value of attribute "AXFullScreen" of (first window of (first process whose name contains "${app}")) to true`);
        return { success: true, action: "maximized", app };
      }
      case "window.restore": {
        const app = String(params.app ?? params.target ?? "");
        await this.deep.runAppleScript(`tell application "System Events"
  set miniaturized of (first window of (first process whose name contains "${app}")) to false
  set value of attribute "AXFullScreen" of (first window of (first process whose name contains "${app}")) to false
end tell`);
        return { success: true, action: "restored", app };
      }

      // ── UC2.4: Split/Snap windows ─────────────────────────────────────
      case "window.split":
      case "window.snap": {
        const position = String(params.position ?? "left"); // "left" | "right" | "top" | "bottom"
        const app = String(params.app ?? params.target ?? "");
        let script: string;
        if (position === "left") {
          script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {0, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {960, 1050}`;
        } else if (position === "right") {
          script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {960, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {960, 1050}`;
        } else {
          script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {0, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {1920, 525}`;
        }
        await this.deep.runAppleScript(script);
        return { success: true, position, app };
      }

      // ── UC2.6: Focus specific window ──────────────────────────────────
      case "window.focus": {
        const app = String(params.app ?? params.target ?? "");
        await this.deep.runAppleScript(`tell application "${app}" to activate`);
        return { success: true, action: "focused", app };
      }

      // ── UC3.1: Create file/directory ──────────────────────────────────
      case "file.create": {
        const path = String(params.path ?? "");
        const type = String(params.type ?? "file"); // "file" | "directory"
        const content = String(params.content ?? "");
        if (type === "directory") {
          await this.deep.execAsync(`mkdir -p "${path}"`, 5000);
        } else {
          await this.deep.execAsync(`mkdir -p "$(dirname "${path}")" && printf '%s' ${JSON.stringify(content)} > "${path}"`, 5000);
        }
        return { success: true, path, type };
      }

      // ── UC3.2: Copy/Move files ────────────────────────────────────────
      case "file.copy": {
        const src = String(params.source ?? params.src ?? "");
        const dest = String(params.destination ?? params.dest ?? "");
        const recursive = params.recursive !== false;
        const flag = recursive ? "-R" : "";
        await this.deep.execAsync(`cp ${flag} "${src}" "${dest}"`, 30000);
        return { success: true, source: src, destination: dest };
      }
      case "file.move": {
        const src = String(params.source ?? params.src ?? "");
        const dest = String(params.destination ?? params.dest ?? "");
        await this.deep.execAsync(`mv "${src}" "${dest}"`, 30000);
        return { success: true, source: src, destination: dest };
      }

      // ── UC3.3: Batch rename ───────────────────────────────────────────
      case "file.rename.batch": {
        const dir = String(params.directory ?? params.dir ?? ".");
        const pattern = String(params.pattern ?? "");
        const replacement = String(params.replacement ?? "");
        const { stdout: renameOut } = await this.deep.execAsync(
          `cd "${dir}" && for f in *${pattern}*; do mv "$f" "$(echo "$f" | sed "s/${pattern}/${replacement}/g")"; done 2>&1`,
          30000
        );
        return { success: true, directory: dir, pattern, replacement, output: renameOut };
      }

      // ── UC3.4: Delete files ───────────────────────────────────────────
      case "file.delete": {
        const path = String(params.path ?? "");
        const permanent = Boolean(params.permanent ?? false);
        if (permanent) {
          await this.deep.execAsync(`rm -rf "${path}"`, 10000);
        } else {
          await this.deep.runAppleScript(`tell application "Finder" to delete POSIX file "${path}"`);
        }
        return { success: true, path, permanent };
      }

      // ── UC3.5: Search files ───────────────────────────────────────────
      case "file.search": {
        const name = String(params.name ?? params.query ?? "");
        const content = String(params.content ?? "");
        const dir = String(params.directory ?? params.dir ?? "~");
        let fsCmd: string;
        if (content) {
          fsCmd = `grep -rl "${content}" "${dir}" 2>/dev/null | head -20`;
        } else {
          fsCmd = `find "${dir}" -name "*${name}*" -maxdepth 5 2>/dev/null | head -20`;
        }
        const { stdout: fsOut } = await this.deep.execAsync(fsCmd, 15000);
        const fsFiles = (fsOut ?? "").split("\n").filter(Boolean);
        return { success: true, results: fsFiles, count: fsFiles.length };
      }

      // ── UC3.7: Zip/Unzip ──────────────────────────────────────────────
      case "file.zip": {
        const source = String(params.source ?? params.path ?? "");
        const output = String(params.output ?? `${source}.zip`);
        await this.deep.execAsync(`zip -r "${output}" "${source}"`, 60000);
        return { success: true, source, output };
      }
      case "file.unzip": {
        const source = String(params.source ?? params.path ?? "");
        const dest = String(params.destination ?? params.dest ?? ".");
        await this.deep.execAsync(`unzip -o "${source}" -d "${dest}"`, 60000);
        return { success: true, source, destination: dest };
      }

      // UC13.4 (deep route): Auto-organize desktop
      case "file.organizeDesktop": {
        const desktop = String(params.path ?? "~/Desktop");
        const orgScript = `
          cd "${desktop}" && \
          mkdir -p Documents Images Videos Music Archives Code Other && \
          mv -n *.{pdf,doc,docx,txt,pages,xlsx,csv,pptx} Documents/ 2>/dev/null; \
          mv -n *.{jpg,jpeg,png,gif,svg,ico,webp,heic,raw,tiff} Images/ 2>/dev/null; \
          mv -n *.{mp4,mov,avi,mkv,wmv,flv,webm} Videos/ 2>/dev/null; \
          mv -n *.{mp3,wav,flac,aac,ogg,m4a} Music/ 2>/dev/null; \
          mv -n *.{zip,rar,7z,tar,gz,dmg,iso} Archives/ 2>/dev/null; \
          mv -n *.{js,ts,py,rs,go,java,c,cpp,h,rb,php,swift,kt} Code/ 2>/dev/null; \
          echo "Desktop organized"
        `;
        const { stdout: orgOut } = await this.deep.execAsync(orgScript, 30000);
        return { success: true, path: desktop, output: orgOut };
      }

      // ── UC4.1: Open URL / Tab management ─────────────────────────────
      case "browser.open": {
        const url = String(params.url ?? "");
        const browser = String(params.browser ?? "default");
        if (browser === "default") {
          await this.deep.execAsync(`open "${url}"`, 5000);
        } else {
          await this.deep.execAsync(`open -a "${browser}" "${url}"`, 5000);
        }
        return { success: true, url, browser };
      }
      case "browser.newTab": {
        const url = String(params.url ?? "about:blank");
        await this.deep.runAppleScript(`
tell application "Google Chrome"
  activate
  make new tab at end of tabs of front window with properties {URL:"${url}"}
end tell`);
        return { success: true, url };
      }
      case "browser.closeTab": {
        await this.deep.runAppleScript(`
tell application "Google Chrome"
  close active tab of front window
end tell`);
        return { success: true, action: "tab closed" };
      }

      // ── UC4.2: Fill form via JavaScript injection ─────────────────────
      case "browser.fillForm":
      case "form.fill": {
        const fields = (params.fields as Record<string, string>) ?? {};
        const filled: string[] = [];
        for (const [selector, value] of Object.entries(fields)) {
          const safeSelector = selector.replace(/'/g, "\\'").replace(/"/g, '\\"');
          const safeValue = value.replace(/'/g, "\\'").replace(/"/g, '\\"');
          await this.deep.runAppleScript(`
tell application "Google Chrome"
  execute front window's active tab javascript "var el = document.querySelector('${safeSelector}') || document.querySelector('[name=\\"${safeSelector}\\"]') || document.querySelector('[placeholder*=\\"${safeSelector}\\"]'); if (el) { el.value = '${safeValue}'; el.dispatchEvent(new Event('input', {bubbles:true})); }"
end tell`);
          filled.push(`${selector}: filled`);
        }
        return { success: true, filled };
      }

      // ── UC4.3: Web scraping ───────────────────────────────────────────
      case "browser.scrape":
      case "web.scrape": {
        const selector = String(params.selector ?? "body");
        const attribute = String(params.attribute ?? "textContent");
        const scrapeResult = await this.deep.runAppleScript(`
tell application "Google Chrome"
  set jsResult to execute front window's active tab javascript "JSON.stringify(Array.from(document.querySelectorAll('${selector}')).map(el => el.${attribute}).slice(0, 50))"
  return jsResult
end tell`);
        return { success: true, data: scrapeResult, selector };
      }

      // ── UC4.4: Download file ──────────────────────────────────────────
      case "browser.download":
      case "web.download": {
        const dlUrl = String(params.url ?? "");
        const output = String(params.output ?? params.path ?? "~/Downloads/");
        await this.deep.execAsync(`curl -L -o "${output}" "${dlUrl}"`, 120000);
        return { success: true, url: dlUrl, output };
      }

      // ── UC4.5: Bookmark current tab ───────────────────────────────────
      case "browser.bookmark": {
        const bookmarkResult = await this.deep.runAppleScript(`
tell application "Google Chrome"
  set bookmarkURL to URL of active tab of front window
  set bookmarkTitle to title of active tab of front window
  return bookmarkTitle & "|" & bookmarkURL
end tell`);
        const [title, url] = (bookmarkResult ?? "").split("|");
        return { success: true, url: url ?? params.url, title: title ?? params.title, action: "bookmarked" };
      }

      // ── UC5.1: WiFi toggle ────────────────────────────────────────────
      case "wifi.toggle": {
        const wifiEnabled = Boolean(params.enabled ?? true);
        const wifiCmd = wifiEnabled
          ? "networksetup -setairportpower en0 on"
          : "networksetup -setairportpower en0 off";
        await this.deep.execAsync(wifiCmd, 5000);
        return { success: true, wifi: wifiEnabled };
      }

      // ── UC5.3: Lock screen ────────────────────────────────────────────
      case "system.lock": {
        await this.deep.execAsync(
          "/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend",
          5000
        );
        return { success: true, action: "screen locked" };
      }

      // ── UC5.4: Night Shift alias ──────────────────────────────────────
      case "display.nightshift": {
        if (params.enabled !== undefined) {
          const success = await this.deepSystem.setNightShift(params.enabled as boolean);
          return { success };
        }
        const enabled = await this.deepSystem.getNightShiftStatus();
        return { enabled };
      }

      // ── UC5.5: Focus / Do Not Disturb mode ───────────────────────────
      case "system.dnd":
      case "system.focus": {
        const dndEnabled = Boolean(params.enabled ?? true);
        const dndVal = dndEnabled ? "true" : "false";
        await this.deep.execAsync(
          `defaults -currentHost write com.apple.notificationcenterui doNotDisturb -boolean ${dndVal} && killall NotificationCenter 2>/dev/null || true`,
          5000
        );
        return { success: true, dnd: dndEnabled };
      }

      // ── UC11: Developer & CLI ────────────────────────────────────────
      // UC11.1: Natural language to shell command
      case "nl.toCommand":
      case "shell.fromNL": {
        const text = String(params.text ?? params.query ?? "");
        const { classifyIntent } = await import("../planner/intent.js");
        const intent = await classifyIntent(text);
        // Extract shell command from intent entities if present
        const cmdEntity = Object.values(intent.entities ?? {}).find(e => e.type === "command");
        const nlCmd = cmdEntity?.value ?? intent.rawText ?? "";
        if (nlCmd && /^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|python3|node|make|brew|docker|kubectl|tmutil|osascript)\b/i.test(nlCmd.trim())) {
          const { stdout: nlOut } = await this.deep.execAsync(nlCmd, 30000);
          return { success: true, originalText: text, command: nlCmd, output: nlOut };
        }
        return { success: false, error: "Could not convert to shell command", text };
      }

      // UC11.2: Git operations
      case "git.status": {
        const dir = String(params.dir ?? params.directory ?? ".");
        const { stdout: gitStatusOut } = await this.deep.execAsync(`cd "${dir}" && git status --short --branch`, 10000);
        return { success: true, output: gitStatusOut };
      }
      case "git.commit": {
        const dir = String(params.dir ?? ".");
        const message = String(params.message ?? "Auto-commit by OmniState");
        const addAll = params.addAll !== false;
        if (addAll) {
          await this.deep.execAsync(`cd "${dir}" && git add -A`, 10000);
        }
        const { stdout: gitCommitOut } = await this.deep.execAsync(`cd "${dir}" && git commit -m "${message}"`, 10000);
        return { success: true, message, output: gitCommitOut };
      }
      case "git.push": {
        const dir = String(params.dir ?? ".");
        const branch = String(params.branch ?? "");
        const gitPushCmd = branch ? `cd "${dir}" && git push origin "${branch}"` : `cd "${dir}" && git push`;
        const { stdout: gitPushOut } = await this.deep.execAsync(gitPushCmd, 30000);
        return { success: true, output: gitPushOut };
      }
      case "git.pull": {
        const dir = String(params.dir ?? ".");
        const { stdout: gitPullOut } = await this.deep.execAsync(`cd "${dir}" && git pull`, 30000);
        return { success: true, output: gitPullOut };
      }
      case "git.branch": {
        const dir = String(params.dir ?? ".");
        const name = String(params.name ?? "");
        const action = String(params.action ?? "create"); // create | switch | delete | list
        let branchCmd: string;
        switch (action) {
          case "create": branchCmd = `cd "${dir}" && git checkout -b "${name}"`; break;
          case "switch": branchCmd = `cd "${dir}" && git checkout "${name}"`; break;
          case "delete": branchCmd = `cd "${dir}" && git branch -d "${name}"`; break;
          default: branchCmd = `cd "${dir}" && git branch -a`; break;
        }
        const { stdout: gitBranchOut } = await this.deep.execAsync(branchCmd, 10000);
        return { success: true, action, name, output: gitBranchOut };
      }

      // UC11.3: Docker shortcuts
      case "docker.ps": {
        const containers = await this.deepSystem.listContainers();
        return { success: true, containers };
      }
      case "docker.start": {
        const name = String(params.name ?? params.container ?? "");
        const success = await this.deepSystem.startContainer(name);
        return { success, name, action: "started" };
      }
      case "docker.stop": {
        const name = String(params.name ?? params.container ?? "");
        const success = await this.deepSystem.stopContainer(name);
        return { success, name, action: "stopped" };
      }
      case "docker.compose": {
        const dir = String(params.dir ?? ".");
        const action = String(params.action ?? "up"); // up | down | restart
        const detach = action === "up" ? "-d" : "";
        const { stdout: composeOut } = await this.deep.execAsync(
          `cd "${dir}" && docker compose ${action} ${detach}`,
          60000
        );
        return { success: true, action, output: composeOut };
      }

      // UC11.4: Log analysis
      case "log.analyze": {
        const logPath = String(params.path ?? "");
        const filter = String(params.filter ?? "error|warning|fatal|exception");
        const lines = Number(params.lines ?? 100);
        let logOut: string;
        if (logPath) {
          const r = await this.deep.execAsync(
            `grep -iE "${filter}" "${logPath}" | tail -${lines}`,
            15000
          );
          logOut = r.stdout ?? "";
        } else {
          const r = await this.deep.execAsync(
            `log show --last 1h --predicate 'messageType == error' | tail -${lines}`,
            15000
          );
          logOut = r.stdout ?? "";
        }
        const logLines = logOut.split("\n").filter(Boolean);
        return { success: true, path: logPath, filter, count: logLines.length, logs: logLines.slice(-20) };
      }

      // ── UC12: System Maintenance ─────────────────────────────────────
      // UC12.1: Disk cleanup
      case "maintenance.diskCleanup": {
        const cleanResults: string[] = [];

        const { stdout: cacheOut } = await this.deep.execAsync(
          "rm -rf ~/Library/Caches/* 2>/dev/null; du -sh ~/Library/Caches/",
          30000
        );
        cleanResults.push(`Caches: ${cacheOut?.trim()}`);

        await this.deep.execAsync(
          "rm -rf /tmp/com.apple.* 2>/dev/null; rm -rf $TMPDIR/* 2>/dev/null; echo 'Temp cleaned'",
          30000
        );
        cleanResults.push("Temp files cleared");

        await this.deep.execAsync(
          "rm -rf ~/.Trash/* 2>/dev/null; echo 'Trash emptied'",
          30000
        );
        cleanResults.push("Trash emptied");

        await this.deep.execAsync(
          "rm -rf ~/Library/Developer/Xcode/DerivedData/* 2>/dev/null; echo 'ok'",
          30000
        );
        cleanResults.push("Xcode DerivedData cleaned");

        const { stdout: spaceOut } = await this.deep.execAsync("df -h / | tail -1", 5000);
        cleanResults.push(`Disk: ${spaceOut?.trim()}`);

        return { success: true, actions: cleanResults };
      }

      // UC12.2: Network troubleshooting
      case "maintenance.networkFix": {
        const netResults: string[] = [];

        const { stdout: dnsOut } = await this.deep.execAsync(
          "sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder && echo 'DNS flushed'",
          10000
        );
        netResults.push(dnsOut?.trim() ?? "DNS flush attempted");

        const { stdout: wifiOut } = await this.deep.execAsync(
          "networksetup -setairportpower en0 off && sleep 2 && networksetup -setairportpower en0 on && echo 'WiFi reset'",
          15000
        );
        netResults.push(wifiOut?.trim() ?? "WiFi reset attempted");

        const { stdout: pingOut } = await this.deep.execAsync("ping -c 3 8.8.8.8 2>&1 | tail -3", 10000);
        netResults.push(`Ping: ${pingOut?.trim()}`);

        return { success: true, actions: netResults };
      }

      // UC12.3: Kill memory leaks
      case "maintenance.killMemoryLeaks": {
        const threshold = Number(params.threshold ?? 500); // MB
        const topProcs = await this.deepSystem.getTopMemoryProcesses(20);
        const killed: string[] = [];

        for (const proc of topProcs) {
          const memMB = Math.round(parseInt(proc.memRSS, 10) / 1024);
          if (memMB > threshold) {
            try {
              await this.deep.execAsync(`kill -TERM ${proc.pid}`, 5000);
              killed.push(`${proc.name} (PID ${proc.pid}, ${memMB}MB)`);
            } catch {}
          }
        }

        return { success: true, threshold: `${threshold}MB`, killed, count: killed.length };
      }

      // ── UC14: Proactive Learning & Personalization ───────────────────
      // UC14.1: Habit detection
      case "learning.detectHabits": {
        const history = await this.deepSystem.getShellHistory(500);

        const cmdFreq: Record<string, number> = {};
        for (const line of history) {
          const habitCmd = line.split(" ")[0];
          if (habitCmd) cmdFreq[habitCmd] = (cmdFreq[habitCmd] || 0) + 1;
        }

        const topCmds = Object.entries(cmdFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([cmd, count]) => ({ command: cmd, count }));

        const { stdout: appHistOut } = await this.deep.execAsync(
          "log show --last 24h --predicate 'process == \"launchd\" && messageType == info' 2>/dev/null | grep -i 'launch' | head -20",
          10000
        );

        return {
          success: true,
          topCommands: topCmds,
          recentApps: appHistOut?.split("\n").filter(Boolean).slice(0, 10) ?? [],
          suggestion: topCmds.length > 0
            ? `Your most used commands: ${topCmds.slice(0, 5).map(c => c.command).join(", ")}`
            : "Not enough data yet",
        };
      }

      // UC14.2: Macro suggestion — delegates to hybridAuto with empty sequence
      case "learning.suggestMacro": {
        const macro = await this.hybridAuto.inferMacro({ actions: [], sessionId: "" } as any);
        return { success: true, macro };
      }

      // UC14.3: Health reminder (eye break, posture, etc.)
      case "learning.healthReminder": {
        const type = String(params.type ?? "break"); // "break" | "posture" | "hydrate" | "eyerest"
        const intervalMinutes = Number(params.interval ?? 30);

        await this.deep.execAsync(
          `(while true; do sleep ${intervalMinutes * 60}; osascript -e 'display notification "Time for a ${type} break! Stand up and stretch." with title "OmniState Health" sound name "Purr"'; done) &`,
          5000
        );

        const hour = new Date().getHours();
        if (hour >= 22 || hour < 6) {
          await (this.deepOS as any).setNightShift?.(true);
          return { success: true, type, interval: intervalMinutes, nightShiftEnabled: true, lateHour: true };
        }

        return { success: true, type, interval: intervalMinutes };
      }

      // UC14.4: Pre-fetch resources for upcoming events
      case "learning.prefetch": {
        const calResult = await this.deep.runAppleScript(`
          tell application "Calendar"
            set now to current date
            set later to now + (30 * 60) -- next 30 minutes
            set upcomingEvents to {}
            repeat with cal in calendars
              repeat with evt in (events of cal whose start date > now and start date < later)
                set end of upcomingEvents to {summary of evt, location of evt, start date of evt}
              end repeat
            end repeat
            return upcomingEvents as text
          end tell
        `);

        const events = calResult?.split(",").filter(Boolean) ?? [];
        const prefetchActions: string[] = [];

        for (const event of events) {
          const lower = event.toLowerCase();
          if (lower.includes("zoom") || lower.includes("meet") || lower.includes("call")) {
            prefetchActions.push("Opening video call app");
            await this.deep.execAsync("open -a Zoom", 5000).catch(() => {});
          }
          if (lower.includes("review") || lower.includes("code")) {
            prefetchActions.push("Opening IDE");
            await this.deep.execAsync("open -a 'Visual Studio Code'", 5000).catch(() => {});
          }
        }

        return {
          success: true,
          upcomingEvents: events,
          prefetchActions,
          checkedWindow: "next 30 minutes",
        };
      }

      // ── UC6: Communication & Media ───────────────────────────────────
      case "media.play":
      case "media.pause":
      case "media.toggle": {
        await this.surface.keyTap("space", { meta: false });
        return { success: true, action: "media toggled" };
      }
      case "media.next": {
        await this.deep.runAppleScript(`tell application "Music" to next track`);
        return { success: true, action: "next track" };
      }
      case "media.previous": {
        await this.deep.runAppleScript(`tell application "Music" to previous track`);
        return { success: true, action: "previous track" };
      }
      case "media.info": {
        const mediaInfoResult = await this.deep.runAppleScript(`
          tell application "Music"
            set trackName to name of current track
            set trackArtist to artist of current track
            set trackAlbum to album of current track
            return trackName & " - " & trackArtist & " (" & trackAlbum & ")"
          end tell
        `);
        return { success: true, nowPlaying: mediaInfoResult };
      }
      case "email.compose":
      case "email.send": {
        const emailTo = String(params.to ?? "");
        const emailSubject = String(params.subject ?? "");
        const emailBody = String(params.body ?? "");
        await this.deep.runAppleScript(`
          tell application "Mail"
            activate
            set newMsg to make new outgoing message with properties {subject:"${emailSubject}", content:"${emailBody}", visible:true}
            tell newMsg
              make new to recipient at end of to recipients with properties {address:"${emailTo}"}
            end tell
            ${params.send ? "send newMsg" : ""}
          end tell
        `);
        return { success: true, to: emailTo, subject: emailSubject, sent: Boolean(params.send) };
      }
      case "calendar.create": {
        const calTitle = String(params.title ?? params.event ?? "");
        const calDate = String(params.date ?? new Date().toISOString().split("T")[0]);
        const calTime = String(params.time ?? "09:00");
        const calDuration = Number(params.duration ?? 60);
        await this.deep.runAppleScript(`
          tell application "Calendar"
            activate
            tell calendar "Home"
              set startDate to current date
              set hours of startDate to ${parseInt(calTime.split(":")[0])}
              set minutes of startDate to ${parseInt(calTime.split(":")[1] || "0")}
              set endDate to startDate + (${calDuration} * 60)
              make new event with properties {summary:"${calTitle}", start date:startDate, end date:endDate}
            end tell
          end tell
        `);
        return { success: true, title: calTitle, date: calDate, time: calTime, duration: calDuration };
      }
      case "reminder.create": {
        const reminderTitle = String(params.title ?? params.text ?? "");
        const reminderDueDate = String(params.dueDate ?? "");
        if (reminderDueDate) {
          await this.deep.runAppleScript(`
            tell application "Reminders"
              activate
              tell list "Reminders"
                make new reminder with properties {name:"${reminderTitle}", due date:date "${reminderDueDate}"}
              end tell
            end tell
          `);
        } else {
          await this.deep.runAppleScript(`
            tell application "Reminders"
              activate
              tell list "Reminders"
                make new reminder with properties {name:"${reminderTitle}"}
              end tell
            end tell
          `);
        }
        return { success: true, title: reminderTitle, dueDate: reminderDueDate };
      }
      case "timer.set":
      case "alarm.set": {
        const timerSeconds = Number(params.seconds ?? (params.minutes ? Number(params.minutes) * 60 : 300));
        const timerMessage = String(params.message ?? "Timer finished!");
        await this.deep.execAsync(
          `(sleep ${timerSeconds} && osascript -e 'display notification "${timerMessage}" with title "OmniState Timer" sound name "Glass"') &`,
          5000
        );
        return { success: true, seconds: timerSeconds, message: timerMessage };
      }

      // ── UC7: Workflow Automation ─────────────────────────────────────
      case "workflow.research": {
        const researchTopic = String(params.topic ?? params.query ?? "");
        const researchSteps = [
          { tool: "browser.open", params: { url: `https://www.google.com/search?q=${encodeURIComponent(researchTopic)}` } },
        ];
        for (const step of researchSteps) {
          await this.executeDeep(step.tool, step.params);
          await new Promise(r => setTimeout(r, 1000));
        }
        return { success: true, topic: researchTopic, action: "research workflow started" };
      }
      case "workflow.dataEntry": {
        const dataSource = String(params.source ?? "");
        const dataEntryResult = await this.deep.execAsync(`cat "${dataSource}" | head -50`, 5000);
        return { success: true, source: dataSource, data: dataEntryResult.stdout, action: "data loaded for entry" };
      }
      case "workflow.meeting": {
        const meetingApp = String(params.app ?? "zoom");
        const meetingNotes = String(params.notes ?? "");
        const meetingSlides = String(params.slides ?? "");
        await this.executeDeep("app.launch", { name: meetingApp });
        await new Promise(r => setTimeout(r, 2000));
        if (meetingSlides) {
          await this.deep.execAsync(`open "${meetingSlides}"`, 5000);
        }
        if (meetingNotes) {
          await this.deep.execAsync(`open "${meetingNotes}"`, 5000);
        }
        return { success: true, app: meetingApp, action: "meeting setup complete" };
      }
      case "workflow.dev": {
        const devIde = String(params.ide ?? "Visual Studio Code");
        const devProject = String(params.project ?? ".");
        const devServer = String(params.server ?? "");
        await this.deep.execAsync(`code "${devProject}"`, 5000);
        await new Promise(r => setTimeout(r, 2000));
        if (devServer) {
          await this.deep.execAsync(`cd "${devProject}" && ${devServer} &`, 5000);
        }
        await this.executeDeep("window.snap", { app: devIde, position: "left" });
        return { success: true, ide: devIde, project: devProject, server: devServer, action: "dev environment ready" };
      }

      // ── UC8: Software & Environment ──────────────────────────────────
      case "software.install": {
        const swInstallName = String(params.name ?? params.package ?? "");
        const swInstallManager = String(params.manager ?? "brew");
        let swInstallCmd: string;
        switch (swInstallManager) {
          case "cask": swInstallCmd = `brew install --cask "${swInstallName}"`; break;
          case "npm": swInstallCmd = `npm install -g "${swInstallName}"`; break;
          case "pip": swInstallCmd = `pip3 install "${swInstallName}"`; break;
          default: swInstallCmd = `brew install "${swInstallName}"`; break;
        }
        const swInstallResult = await this.deep.execAsync(swInstallCmd, 120000);
        return { success: true, name: swInstallName, manager: swInstallManager, output: swInstallResult.stdout };
      }
      case "software.uninstall": {
        const swUninstallName = String(params.name ?? params.package ?? "");
        const swUninstallManager = String(params.manager ?? "brew");
        let swUninstallCmd: string;
        switch (swUninstallManager) {
          case "cask": swUninstallCmd = `brew uninstall --cask "${swUninstallName}"`; break;
          case "npm": swUninstallCmd = `npm uninstall -g "${swUninstallName}"`; break;
          case "pip": swUninstallCmd = `pip3 uninstall -y "${swUninstallName}"`; break;
          default: swUninstallCmd = `brew uninstall "${swUninstallName}"`; break;
        }
        const swUninstallResult = await this.deep.execAsync(swUninstallCmd, 60000);
        if (swUninstallManager === "brew" || swUninstallManager === "cask") {
          await this.deep.execAsync("brew cleanup", 30000);
        }
        return { success: true, name: swUninstallName, manager: swUninstallManager, output: swUninstallResult.stdout };
      }
      case "software.update": {
        const swUpdates = await this.deepSystem.checkForUpdates();
        return { success: true, updates: swUpdates };
      }

      // ── UC9: Hardware Control ────────────────────────────────────────
      case "hardware.eject": {
        const ejectVolume = String(params.volume ?? params.name ?? "");
        if (ejectVolume) {
          await this.deep.execAsync(`diskutil eject "${ejectVolume}"`, 10000);
        } else {
          await this.deep.execAsync("diskutil eject external", 10000);
        }
        return { success: true, volume: ejectVolume, action: "ejected" };
      }
      case "hardware.print": {
        const hwPrintFile = String(params.file ?? params.path ?? "");
        const hwPrinter = String(params.printer ?? "");
        const hwCopies = Number(params.copies ?? 1);
        const hwPrinterFlag = hwPrinter ? `-d "${hwPrinter}"` : "";
        await this.deep.execAsync(`lpr ${hwPrinterFlag} -# ${hwCopies} "${hwPrintFile}"`, 10000);
        return { success: true, file: hwPrintFile, printer: hwPrinter, copies: hwCopies };
      }
      case "hardware.webcam.lock": {
        const webcamLocked = Boolean(params.locked ?? true);
        if (webcamLocked) {
          await this.deep.execAsync(
            "sudo killall VDCAssistant 2>/dev/null; sudo killall AppleCameraAssistant 2>/dev/null",
            5000
          );
        }
        return { success: true, webcam: webcamLocked ? "locked" : "unlocked" };
      }
      case "hardware.mic.lock": {
        const micLocked = Boolean(params.locked ?? true);
        await this.deepSystem.toggleMute();
        return { success: true, mic: micLocked ? "locked" : "unlocked" };
      }
      case "hardware.health": {
        const hwBattery = await this.deepSystem.getBatteryInfo();
        const hwMemory = await this.deepSystem.getMemoryPressure();
        const hwSwap = await this.deepSystem.getSwapUsage();
        const hwTopProcs = await this.deepSystem.getTopMemoryProcesses(5);

        let hwCpuTemp = "N/A";
        try {
          const hwTempResult = await this.deep.execAsync(
            "sudo powermetrics --samplers smc -n 1 -i 100 2>/dev/null | grep \'CPU die temperature\' | head -1",
            5000
          );
          hwCpuTemp = hwTempResult.stdout?.trim() ?? "N/A";
        } catch {}

        let hwDiskHealth = "N/A";
        try {
          const hwDiskResult = await this.deep.execAsync(
            "diskutil info disk0 | grep SMART",
            5000
          );
          hwDiskHealth = hwDiskResult.stdout?.trim() ?? "N/A";
        } catch {}

        return {
          success: true,
          battery: hwBattery,
          memory: hwMemory,
          swap: hwSwap,
          cpuTemp: hwCpuTemp,
          diskHealth: hwDiskHealth,
          topMemoryProcesses: hwTopProcs,
        };
      }

      // ── UC10: Security & Privacy ─────────────────────────────────────
      case "security.vpn.toggle": {
        const vpnName = String(params.name ?? "");
        const vpnEnabled = Boolean(params.enabled ?? true);
        if (vpnEnabled) {
          await this.deep.execAsync(
            `scutil --nc start "${vpnName}" 2>/dev/null || networksetup -connectpppoeservice "${vpnName}"`,
            10000
          );
        } else {
          await this.deep.execAsync(
            `scutil --nc stop "${vpnName}" 2>/dev/null || networksetup -disconnectpppoeservice "${vpnName}"`,
            10000
          );
        }
        return { success: true, vpn: vpnName, enabled: vpnEnabled };
      }
      case "security.dns.set": {
        const secDns = String(params.dns ?? params.server ?? "1.1.1.1");
        const secDnsIface = String(params.interface ?? "Wi-Fi");
        await this.deep.execAsync(
          `networksetup -setdnsservers "${secDnsIface}" ${secDns}`,
          5000
        );
        return { success: true, dns: secDns, interface: secDnsIface };
      }
      case "security.proxy.set": {
        const proxyHost = String(params.host ?? "");
        const proxyPort = Number(params.port ?? 8080);
        const proxyIface = String(params.interface ?? "Wi-Fi");
        await this.deep.execAsync(
          `networksetup -setwebproxy "${proxyIface}" "${proxyHost}" ${proxyPort}`,
          5000
        );
        return { success: true, host: proxyHost, port: proxyPort };
      }
      case "security.scan": {
        const scanPath = String(params.path ?? "/");
        const scanResult = await this.deep.execAsync(
          `clamscan -r "${scanPath}" --max-dir-recursion=3 2>&1 | tail -20`,
          120000
        );
        return { success: true, path: scanPath, output: scanResult.stdout };
      }
      case "security.vault.get": {
        const vaultName = String(params.name ?? params.search ?? "");
        const vaultResult = await this.deep.execAsync(
          `bw get item "${vaultName}" --pretty 2>/dev/null | head -20`,
          10000
        );
        return { success: true, name: vaultName, data: vaultResult.stdout };
      }
      case "security.encrypt": {
        const encryptPath = String(params.path ?? "");
        const encryptPassword = String(params.password ?? "");
        await this.deep.execAsync(
          `hdiutil create -encryption -stdinpass -srcfolder "${encryptPath}" "${encryptPath}.dmg" <<< "${encryptPassword}"`,
          60000
        );
        return { success: true, path: encryptPath, output: `${encryptPath}.dmg` };
      }
      case "security.shred": {
        const shredPath = String(params.path ?? "");
        await this.deep.execAsync(`rm -P "${shredPath}"`, 30000);
        return { success: true, path: shredPath, action: "securely deleted" };
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

    // Mouse/keyboard/accessibility actions require Accessibility permission.
    const requiresAccessibility = tool.startsWith("ui.");
    if (requiresAccessibility && !this.surface.isAccessibilityTrusted()) {
      // Try to detect if there's a permission dialog on screen we can auto-approve
      if (this.permissionResponder) {
        const detected = await this.vision.detectPermissionDialog();
        if (detected && detected.type === 'macos_system') {
          const decision = this.approvalEngine!.evaluate({
            app: detected.app,
            resource: detected.resource,
            action: detected.action,
            dialogType: detected.type,
            rawText: detected.rawText,
            timestamp: new Date(),
          });
          if (decision.decision === 'allow') {
            await this.vision.dismissModal('allow');
            // Wait a moment for permission to take effect
            await new Promise(r => setTimeout(r, 1000));
            // Re-check
            if (!this.surface.isAccessibilityTrusted()) {
              throw new Error("Permission dialog was approved but accessibility still not granted. Please enable manually in System Settings → Privacy & Security → Accessibility.");
            }
          } else {
            throw new Error(`Accessibility permission needed but policy denied auto-approval: ${decision.reason}`);
          }
        } else {
          throw new Error("Accessibility permission is not granted. Enable in System Settings → Privacy & Security → Accessibility.");
        }
      } else {
        throw new Error("Accessibility permission is not granted. Enable in System Settings → Privacy & Security → Accessibility.");
      }
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
        const button = (params.button as "left" | "right" | "middle" | undefined) ?? "left";
        const x = params.x as number | undefined;
        const y = params.y as number | undefined;

        if (typeof x === "number" && typeof y === "number") {
          await this.surface.moveMouse(x, y);
          await this.surface.click(button);
          return {};
        }

        const el = params.element as Parameters<typeof this.surface.clickElement>[0] | undefined;
        if (el && (el as any).bounds) {
          if (button === "left") {
            await this.surface.clickElement(el);
          } else {
            const centerX = el.bounds.x + el.bounds.width / 2;
            const centerY = el.bounds.y + el.bounds.height / 2;
            await this.surface.moveMouse(centerX, centerY);
            await this.surface.click(button);
          }
          return {};
        }

        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (query) {
          const found = await this.surface.findElement(query);
          if (found) {
            if (button === "left") {
              await this.surface.clickElement(found);
            } else {
              const centerX = found.bounds.x + found.bounds.width / 2;
              const centerY = found.bounds.y + found.bounds.height / 2;
              await this.surface.moveMouse(centerX, centerY);
              await this.surface.click(button);
            }
            return {};
          }
          throw new Error(`ui.click target not found for query: ${query}`);
        }

        throw new Error("ui.click requires element, query, or x/y coordinates");
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

      // ── UC1.5: Highlight / Select text by mouse drag ─────────────────
      case "ui.highlight":
      case "ui.select": {
        const fromX = Number(params.fromX ?? params.x1 ?? 0);
        const fromY = Number(params.fromY ?? params.y1 ?? 0);
        const toX = Number(params.toX ?? params.x2 ?? 0);
        const toY = Number(params.toY ?? params.y2 ?? 0);
        await this.surface.drag(fromX, fromY, toX, toY);
        return { success: true, action: "text highlighted" };
      }

      // ── UC1.9: Switch virtual desktops ───────────────────────────────
      case "ui.desktop.switch": {
        const direction = String(params.direction ?? "right");
        const modifiers = { control: true };
        if (direction === "left") {
          await this.surface.keyTap("left", modifiers);
        } else {
          await this.surface.keyTap("right", modifiers);
        }
        return { success: true, direction };
      }

      // ── UC1.10b: Screen recording ────────────────────────────────────
      case "screen.record.start": {
        const output = String(params.output ?? "~/Desktop/recording.mov");
        await this.deep.execAsync(
          `screencapture -v -C -T 0 "${output}" &`,
          5000
        );
        return { success: true, output };
      }
      case "screen.record.stop": {
        await this.deep.execAsync("pkill -f 'screencapture -v'", 5000);
        return { success: true, action: "recording stopped" };
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

      // ── UC13: Context-Aware & Vision ─────────────────────────────────
      // UC13.1: On-screen translation (OCR + translate)
      case "vision.translate": {
        const capture = await this.surface.captureScreen();
        if (!capture) return { success: false, error: "Screen capture failed" };

        const { stdout: ocrOut } = await this.deep.execAsync(
          "screencapture -x /tmp/omni_translate.png && shortcuts run 'Live Text' -i /tmp/omni_translate.png 2>/dev/null || echo 'OCR not available'",
          15000
        );
        return { success: true, text: ocrOut, action: "text extracted for translation" };
      }

      // UC13.2: Smart OCR — extract data from screen
      case "vision.ocr": {
        const region = params.region as { x: number; y: number; width: number; height: number } | undefined;
        if (region) {
          await this.deep.execAsync(
            `screencapture -x -R${region.x},${region.y},${region.width},${region.height} /tmp/omni_ocr.png`,
            5000
          );
        } else {
          await this.deep.execAsync("screencapture -x /tmp/omni_ocr.png", 5000);
        }

        const { stdout: tesseractOut } = await this.deep.execAsync(
          "tesseract /tmp/omni_ocr.png stdout 2>/dev/null || echo 'Tesseract not installed. Install with: brew install tesseract'",
          15000
        );
        return { success: true, text: tesseractOut?.trim(), region };
      }

      // UC13.3: Screen context summary
      case "vision.context":
      case "vision.summarize": {
        const tree = bridge.getUiTree?.();
        const activeApp = (tree as any)?.title ?? "Unknown";
        const windowTitle = (tree as any)?.children?.[0]?.title ?? "";

        const { stdout: appsListOut } = await this.deep.execAsync(
          "osascript -e 'tell application \"System Events\" to get name of every process whose background only is false'",
          5000
        );

        const doc = await this.deep.runAppleScript(`
          tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
            return frontApp
          end tell
        `);

        return {
          success: true,
          activeApp,
          windowTitle,
          openApps: appsListOut?.split(", ") ?? [],
          frontApp: doc,
          context: `You are in ${activeApp}${windowTitle ? ` - "${windowTitle}"` : ""}`,
        };
      }

      // UC13.4: Auto-organize desktop
      case "vision.organizeDesktop": {
        const desktop = String(params.path ?? "~/Desktop");
        const orgScript = `
          cd "${desktop}" && \
          mkdir -p Documents Images Videos Music Archives Code Other && \
          mv -n *.{pdf,doc,docx,txt,pages,xlsx,csv,pptx} Documents/ 2>/dev/null; \
          mv -n *.{jpg,jpeg,png,gif,svg,ico,webp,heic,raw,tiff} Images/ 2>/dev/null; \
          mv -n *.{mp4,mov,avi,mkv,wmv,flv,webm} Videos/ 2>/dev/null; \
          mv -n *.{mp3,wav,flac,aac,ogg,m4a} Music/ 2>/dev/null; \
          mv -n *.{zip,rar,7z,tar,gz,dmg,iso} Archives/ 2>/dev/null; \
          mv -n *.{js,ts,py,rs,go,java,c,cpp,h,rb,php,swift,kt} Code/ 2>/dev/null; \
          echo "Desktop organized"
        `;
        const { stdout: visionOrgOut } = await this.deep.execAsync(orgScript, 30000);
        return { success: true, path: desktop, output: visionOrgOut };
      }

      default:
        throw new Error(`Unknown surface layer tool: ${tool}`);
    }
  }

  // ── HardwareLayer execute methods ───────────────────────────────────────
  private async executeHardware(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "hardware.getVolume": { const vol = await this.hardware.getVolume(); return vol; }
      case "hardware.setVolume": { await this.hardware.setVolume(params.level as number); return { success: true }; }
      case "hardware.mute": { await this.hardware.mute(); return { success: true }; }
      case "hardware.unmute": { await this.hardware.unmute(); return { success: true }; }
      case "hardware.toggleMute": { await this.hardware.toggleMute(); return { success: true }; }
      case "hardware.getInputVolume": { const level = await this.hardware.getInputVolume(); return { level }; }
      case "hardware.setInputVolume": { await this.hardware.setInputVolume(params.level as number); return { success: true }; }
      case "hardware.listAudioDevices": { const devices = await this.hardware.listAudioDevices(); return { devices }; }
      case "hardware.getBrightness": { const level = await this.hardware.getBrightness(); return { level }; }
      case "hardware.setBrightness": { await this.hardware.setBrightness(params.level as number); return { success: true }; }
      case "hardware.getNightShift": { const status = await this.hardware.getNightShift(); return status; }
      case "hardware.setNightShift": { await this.hardware.setNightShift(params.enabled as boolean); return { success: true }; }
      case "hardware.getBluetoothStatus": { const status = await this.hardware.getBluetoothStatus(); return status; }
      case "hardware.enableBluetooth": { await this.hardware.enableBluetooth(); return { success: true }; }
      case "hardware.disableBluetooth": { await this.hardware.disableBluetooth(); return { success: true }; }
      case "hardware.listBluetoothDevices": { const devices = await this.hardware.listBluetoothDevices(); return { devices }; }
      case "hardware.connectBluetooth": { await this.hardware.connectBluetoothDevice(params.address as string); return { success: true }; }
      case "hardware.disconnectBluetooth": { await this.hardware.disconnectBluetoothDevice(params.address as string); return { success: true }; }
      case "hardware.listDisplays": { const displays = await this.hardware.listDisplays(); return { displays }; }
      case "hardware.getResolution": { const resolution = await this.hardware.getDisplayResolution(params.displayId as number | undefined); return resolution as unknown as Record<string, unknown>; }
      case "hardware.setResolution": { await this.hardware.setDisplayResolution(params.width as number, params.height as number); return { success: true }; }
      case "hardware.isDarkMode": { const enabled = await this.hardware.isDarkMode(); return { enabled }; }
      case "hardware.setDarkMode": { await this.hardware.setDarkMode(params.enabled as boolean); return { success: true }; }
      case "hardware.getAppearance": { const appearance = await this.hardware.getAppearance(); return { appearance }; }
      case "hardware.getBatteryStatus": { const status = await this.hardware.getBatteryStatus(); return status as unknown as Record<string, unknown>; }
      case "hardware.getSleepSettings": { const settings = await this.hardware.getSleepSettings(); return settings as unknown as Record<string, unknown>; }
      case "hardware.preventSleep": { const result = await this.hardware.preventSleep(params.minutes as number); return result; }
      case "hardware.allowSleep": { await this.hardware.allowSleep(params.pid as number); return { success: true }; }
      case "hardware.sleep": { await this.hardware.sleep(); return { success: true }; }
      case "hardware.restart": { await this.hardware.restart(); return { success: true }; }
      case "hardware.shutdown": { await this.hardware.shutdown(); return { success: true }; }
      case "hardware.getKeyboardBacklight": { const level = await this.hardware.getKeyboardBacklight(); return { level }; }
      case "hardware.setKeyboardBacklight": { await this.hardware.setKeyboardBacklight(params.level as number); return { success: true }; }
      case "hardware.isKeyboardBacklightAuto": { const auto = await this.hardware.isKeyboardBacklightAuto(); return { auto }; }
      case "hardware.listUSBDevices": { const devices = await this.hardware.listUSBDevices(); return { devices }; }
      case "hardware.listThunderboltDevices": { const devices = await this.hardware.listThunderboltDevices(); return { devices }; }
      case "hardware.getInputDevices": { const devices = await this.hardware.getInputDevices(); return { devices }; }
      case "hardware.ejectDisk": { await this.hardware.ejectDisk(params.diskName as string); return { success: true }; }
      case "hardware.getWifiInfo": { const info = await this.hardware.getWifiInfo(); return { info }; }
      case "hardware.getWifiNetworks": { const networks = await this.hardware.getWifiNetworks(); return { networks }; }
      case "hardware.connectToWifi": { await this.hardware.connectToWifi(params.ssid as string, params.password as string | undefined); return { success: true }; }
      default: throw new Error(`Unknown hardware tool: ${tool}`);
    }
  }

  // ── CommunicationLayer execute methods ──────────────────────────────────
  private async executeCommunication(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "comm.sendEmail": { await this.communication.sendEmail(params as unknown as Parameters<typeof this.communication.sendEmail>[0]); return { success: true }; }
      case "comm.getUnreadEmails": { const emails = await this.communication.getUnreadEmails(params as unknown as Parameters<typeof this.communication.getUnreadEmails>[0]); return { emails }; }
      case "comm.readEmail": { const email = await this.communication.readEmail(params.messageId as string); return { email }; }
      case "comm.searchEmails": { const emails = await this.communication.searchEmails(params as unknown as Parameters<typeof this.communication.searchEmails>[0]); return { emails }; }
      case "comm.getMailboxes": { const mailboxes = await this.communication.getMailboxes(); return { mailboxes }; }
      case "comm.sendMessage": { await this.communication.sendMessage(params as unknown as Parameters<typeof this.communication.sendMessage>[0]); return { success: true }; }
      case "comm.getRecentMessages": { const messages = await this.communication.getRecentMessages(params as unknown as Parameters<typeof this.communication.getRecentMessages>[0]); return { messages }; }
      case "comm.searchMessages": { const messages = await this.communication.searchMessages(params.query as string); return { messages }; }
      case "comm.getEvents": { const events = await this.communication.getEvents(params as unknown as Parameters<typeof this.communication.getEvents>[0]); return { events }; }
      case "comm.createEvent": { await this.communication.createEvent(params as unknown as Parameters<typeof this.communication.createEvent>[0]); return { success: true }; }
      case "comm.deleteEvent": { await this.communication.deleteEvent(params.eventId as string); return { success: true }; }
      case "comm.getCalendars": { const calendars = await this.communication.getCalendars(); return { calendars }; }
      case "comm.getUpcomingEvents": { const events = await this.communication.getUpcomingEvents(params.hours as number | undefined); return { events }; }
      case "comm.sendNotification": { await this.communication.sendNotification(params as unknown as Parameters<typeof this.communication.sendNotification>[0]); return { success: true }; }
      case "comm.getRecentNotifications": { const notifications = await this.communication.getRecentNotifications(params.limit as number | undefined); return { notifications }; }
      case "comm.clearNotifications": { await this.communication.clearNotifications(); return { success: true }; }
      case "comm.searchContacts": { const contacts = await this.communication.searchContacts(params.query as string); return { contacts }; }
      case "comm.getContactDetails": { const contact = await this.communication.getContactDetails(params.contactId as string); return { contact }; }
      case "comm.addContact": { await this.communication.addContact(params as unknown as Parameters<typeof this.communication.addContact>[0]); return { success: true }; }
      case "comm.getContactGroups": { const groups = await this.communication.getContactGroups(); return { groups }; }
      case "comm.sendEmailWithAttachment": { await this.communication.sendEmailWithAttachment(params as unknown as Parameters<typeof this.communication.sendEmailWithAttachment>[0]); return { success: true }; }
      case "comm.getEmailAccounts": { const accounts = await this.communication.getEmailAccounts(); return { accounts }; }
      case "comm.moveEmail": { await this.communication.moveEmail(params.messageId as string, params.mailbox as string); return { success: true }; }
      case "comm.flagEmail": { await this.communication.flagEmail(params.messageId as string, params.flagged as boolean | undefined); return { success: true }; }
      case "comm.startFaceTimeCall": { await this.communication.startFaceTimeCall(params.contact as string); return { success: true }; }
      case "comm.endFaceTimeCall": { await this.communication.endFaceTimeCall(); return { success: true }; }
      case "comm.isFaceTimeActive": { const active = await this.communication.isFaceTimeActive(); return { active }; }
      case "comm.getReminders": { const reminders = await this.communication.getReminders(params as unknown as Parameters<typeof this.communication.getReminders>[0]); return { reminders }; }
      case "comm.createReminder": { await this.communication.createReminder(params as unknown as Parameters<typeof this.communication.createReminder>[0]); return { success: true }; }
      case "comm.completeReminder": { await this.communication.completeReminder(params.reminderId as string); return { success: true }; }
      case "comm.getReminderLists": { const lists = await this.communication.getReminderLists(); return { lists }; }
      case "comm.deleteReminder": { await this.communication.deleteReminder(params.reminderId as string); return { success: true }; }
      case "comm.getNotes": { const notes = await this.communication.getNotes(params.folder as string | undefined); return { notes }; }
      case "comm.createNote": { await this.communication.createNote(params as unknown as Parameters<typeof this.communication.createNote>[0]); return { success: true }; }
      case "comm.searchNotes": { const notes = await this.communication.searchNotes(params.query as string); return { notes }; }
      case "comm.getNoteFolders": { const folders = await this.communication.getNoteFolders(); return { folders }; }
      default: throw new Error(`Unknown communication tool: ${tool}`);
    }
  }

  // ── SoftwareLayer execute methods ────────────────────────────────────────
  private async executeSoftware(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "software.brewInstall": { const result = await this.software.brewInstall(params.packages as string[]); return result as unknown as Record<string, unknown>; }
      case "software.brewUninstall": { await this.software.brewUninstall(params.packages as string[]); return { success: true }; }
      case "software.brewList": { const packages = await this.software.brewList(); return { packages }; }
      case "software.brewSearch": { const packages = await this.software.brewSearch(params.query as string); return { packages }; }
      case "software.brewUpdate": { const output = await this.software.brewUpdate(); return { output }; }
      case "software.brewUpgrade": { const result = await this.software.brewInstall(params.packages as string[] ?? []); return result as unknown as Record<string, unknown>; }
      case "software.brewInfo": { const info = await this.software.brewInfo(params.name as string); return info as unknown as Record<string, unknown>; }
      case "software.brewServices": { const packages = await this.software.brewList(); return { packages }; }
      case "software.brewDoctor": { const issues = await this.software.brewDoctor(); return { issues }; }
      case "software.npmInstall": { await this.software.npmInstall(params.packages as string[], params as Parameters<typeof this.software.npmInstall>[1]); return { success: true }; }
      case "software.npmUninstall": { await this.software.npmUninstall(params.packages as string[]); return { success: true }; }
      case "software.npmList": { const packages = await this.software.npmList(params as Parameters<typeof this.software.npmList>[0]); return { packages }; }
      case "software.npmRun": { const output = await this.software.brewUpdate(); return { output }; }
      case "software.npmInit": { return { success: true, note: "Use shell.exec: npm init" }; }
      case "software.npmSearch": { const packages = await this.software.npmSearch(params.query as string); return { packages }; }
      case "software.npmOutdated": { const outdated = await this.software.npmOutdated(); return { outdated }; }
      case "software.npmUpdate": { await this.software.npmInstall([], { global: params.global as boolean | undefined }); return { success: true }; }
      case "software.pipInstall": { const result = await this.software.pipInstall(params.packages as string[], params as Parameters<typeof this.software.pipInstall>[1]); return result as unknown as Record<string, unknown>; }
      case "software.pipUninstall": { await this.software.pipUninstall(params.packages as string[]); return { success: true }; }
      case "software.pipList": { const packages = await this.software.pipList(); return { packages }; }
      case "software.pipFreeze": { const packages = await this.software.pipList(); return { packages }; }
      case "software.pipSearch": { return { note: "pip search has been deprecated; use PyPI web search" }; }
      case "software.pipShowVenvs": { const info = await this.software.getSystemInfo(); return { info }; }
      case "software.getEnv": { const value = await this.software.getEnvVar(params.name as string); return { value }; }
      case "software.setEnv": { await this.software.setEnvVar(params.name as string, params.value as string, params as unknown as Parameters<typeof this.software.setEnvVar>[2]); return { success: true }; }
      case "software.unsetEnv": { await this.software.setEnvVar(params.name as string, "", { persist: params.persist as boolean | undefined }); return { success: true }; }
      case "software.listEnv": { const vars = await this.software.listEnvVars(params.filter as string | undefined); return { vars }; }
      case "software.exportEnv": { const vars = await this.software.listEnvVars(); return { vars }; }
      case "software.getSystemInfo": { const info = await this.software.getSystemInfo(); return info as unknown as Record<string, unknown>; }
      case "software.getDiskUsage": { const disks = await this.software.getDiskUsage(); return { disks }; }
      case "software.getMemoryUsage": { const memory = await this.software.getMemoryUsage(); return memory as unknown as Record<string, unknown>; }
      case "software.getProcessorUsage": { const cpu = await this.software.getCpuUsage(); return cpu as unknown as Record<string, unknown>; }
      case "software.getNetworkInterfaces": { const info = await this.software.getSystemInfo(); return { interfaces: (info as any).networkInterfaces ?? [] }; }
      case "software.getNodeVersions": { const versions = await this.software.getNodeVersions(); return { versions }; }
      case "software.setNodeVersion": { await this.software.setNodeVersion(params.version as string); return { success: true }; }
      case "software.getPythonVersions": { const versions = await this.software.getPythonVersions(); return { versions }; }
      case "software.setPythonVersion": { await this.software.setPythonVersion(params.version as string); return { success: true }; }
      case "software.getRubyVersions": { const versions = await this.software.getRubyVersions(); return { versions }; }
      case "software.caskInstall": { const result = await this.software.caskInstall(params.packages as string[]); return result as unknown as Record<string, unknown>; }
      case "software.caskUninstall": { await this.software.caskUninstall(params.packages as string[]); return { success: true }; }
      case "software.caskList": { const packages = await this.software.caskList(); return { packages }; }
      case "software.caskSearch": { const packages = await this.software.caskSearch(params.query as string); return { packages }; }
      case "software.getInstalledApps": { const apps = await this.software.getInstalledApps(); return { apps }; }
      case "software.getAppInfo": { const info = await this.software.getAppInfo(params.name as string); return { info }; }
      case "software.isAppInstalled": { const installed = await this.software.isAppInstalled(params.name as string); return { installed }; }
      default: throw new Error(`Unknown software tool: ${tool}`);
    }
  }

  // ── BrowserLayer execute methods ─────────────────────────────────────────
  private async executeBrowser(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const browser = params.browser as string | undefined;
    switch (tool) {
      case "browser.listTabs": { const tabs = await this.browser.listTabs(browser); return { tabs }; }
      case "browser.getActiveTab": { const tab = await this.browser.getActiveTab(browser); return { tab }; }
      case "browser.switchTab": { await this.browser.switchTab(params.tabIndex as number, browser); return { success: true }; }
      case "browser.closeTab": { await this.browser.closeTab(params.tabIndex as number | undefined, browser); return { success: true }; }
      case "browser.newTab": { const tab = await this.browser.newTab(params.url as string | undefined, browser); return { tab }; }
      case "browser.reloadTab": { await this.browser.reloadTab(browser); return { success: true }; }
      case "browser.duplicateTab": { const tab = await this.browser.getActiveTab(browser); await this.browser.newTab(tab.url, browser); return { success: true }; }
      case "browser.navigateTo": { await this.browser.navigate(params.url as string, browser); return { success: true }; }
      case "browser.goBack": { await this.browser.goBack(browser); return { success: true }; }
      case "browser.goForward": { await this.browser.goForward(browser); return { success: true }; }
      case "browser.getUrl": { const url = await this.browser.getPageUrl(browser); return { url }; }
      case "browser.getTitle": { const title = await this.browser.getPageTitle(browser); return { title }; }
      case "browser.getPageSource": { const html = await this.browser.getPageHtml(browser); return { html }; }
      case "browser.executeJs": { const result = await this.browser.executeJavaScript(params.script as string, browser); return { result }; }
      case "browser.querySelector": { const element = await this.browser.querySelector(params.selector as string, browser); return { element }; }
      case "browser.querySelectorAll": { const elements = await this.browser.querySelectorAll(params.selector as string, browser); return { elements }; }
      case "browser.getElementText": { const element = await this.browser.querySelector(params.selector as string, browser); return { text: (element as any)?.text ?? "" }; }
      case "browser.getElementAttribute": { const element = await this.browser.querySelector(params.selector as string, browser); return { value: (element as any)?.[params.attribute as string] ?? "" }; }
      case "browser.fillInput": { await this.browser.fillForm([{ selector: params.selector as string, value: params.value as string }], browser); return { success: true }; }
      case "browser.clickElement": { await this.browser.clickElement(params.selector as string, browser); return { success: true }; }
      case "browser.submitForm": { await this.browser.submitForm(params.selector as string | undefined, browser); return { success: true }; }
      case "browser.selectOption": { await this.browser.selectOption(params.selector as string, params.value as string, browser); return { success: true }; }
      case "browser.getCookies": { const cookies = await this.browser.getCookies(params.domain as string | undefined, browser); return { cookies }; }
      case "browser.setCookie": { return { note: "Use browser.executeJs to set cookies directly" }; }
      case "browser.getLocalStorage": { const value = await this.browser.getLocalStorage(params.key as string, browser); return { value }; }
      case "browser.setLocalStorage": { await this.browser.setLocalStorage(params.key as string, params.value as string, browser); return { success: true }; }
      case "browser.screenshot": { const buffer = await this.browser.capturePageScreenshot(browser); return { data: buffer.toString("base64"), format: "png" }; }
      case "browser.savePdf": { await this.browser.savePageAsPdf(params.outputPath as string, browser); return { success: true }; }
      case "browser.startHeadless": { const result = await this.browser.startHeadless(params as unknown as Parameters<typeof this.browser.startHeadless>[0]); return result as unknown as Record<string, unknown>; }
      case "browser.stopHeadless": { await this.browser.stopHeadless(params.sessionId as string | undefined); return { success: true }; }
      case "browser.isHeadlessRunning": { const running = await this.browser.isHeadlessRunning(params.sessionId as string | undefined); return { running }; }
      case "browser.executeInHeadless": { const result = await this.browser.executeInHeadless(params.script as string, params.sessionId as string | undefined); return { result }; }
      case "browser.pinTab": { await this.browser.pinTab(params.tabIndex as number | undefined, browser); return { success: true }; }
      case "browser.muteTab": { await this.browser.muteTab(params.tabIndex as number | undefined, browser); return { success: true }; }
      case "browser.unmuteTab": { await this.browser.unmuteTab(params.tabIndex as number | undefined, browser); return { success: true }; }
      case "browser.getTabMemory": { const memory = await this.browser.getTabMemory(params.tabIndex as number | undefined, browser); return { memory }; }
      case "browser.getDownloads": { const downloads = await this.browser.getDownloads(browser); return { downloads }; }
      case "browser.clearDownloads": { await this.browser.clearDownloads(browser); return { success: true }; }
      case "browser.getDownloadDirectory": { const directory = await this.browser.getDownloadDirectory(browser); return { directory }; }
      case "browser.getBookmarks": { const bookmarks = await this.browser.getBookmarks(params.folder as string | undefined, browser); return { bookmarks }; }
      case "browser.addBookmark": { await this.browser.addBookmark(params.url as string, params.title as string | undefined, params.folder as string | undefined, browser); return { success: true }; }
      case "browser.searchBookmarks": { const bookmarks = await this.browser.searchBookmarks(params.query as string, browser); return { bookmarks }; }
      case "browser.getHistory": { const history = await this.browser.getHistory(params.limit as number | undefined, params.query as string | undefined, browser); return { history }; }
      case "browser.getPageLoadTime": { const loadTime = await this.browser.getPageLoadTime(browser); return { loadTime }; }
      case "browser.getNetworkRequests": { const requests = await this.browser.getNetworkRequests(browser); return { requests }; }
      case "browser.blockUrls": { await this.browser.blockUrls(params.patterns as string[], browser); return { success: true }; }
      default: throw new Error(`Unknown browser tool: ${tool}`);
    }
  }

  // ── DeveloperLayer execute methods ───────────────────────────────────────
  private async executeDeveloper(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "dev.openTerminal": { await this.developer.openTerminal(params as unknown as Parameters<typeof this.developer.openTerminal>[0]); return { success: true }; }
      case "dev.runCommand": { const result = await this.developer.runCommand(params.command as string, params as unknown as Parameters<typeof this.developer.runCommand>[1]); return result as unknown as Record<string, unknown>; }
      case "dev.runCommandAsync": { const result = await this.developer.runCommandAsync(params.command as string, params as unknown as Parameters<typeof this.developer.runCommandAsync>[1]); return result as unknown as Record<string, unknown>; }
      case "dev.getRunningShells": { const shells = await this.developer.getRunningShells(); return { shells }; }
      case "dev.getShellHistory": { const history = await this.developer.getShellHistory(params.limit as number | undefined); return { history }; }
      case "dev.getEnvironment": { const env = await this.developer.getEnvironment(); return { env }; }
      case "dev.gitStatus": { const status = await this.developer.gitStatus(params.repoPath as string | undefined); return status as unknown as Record<string, unknown>; }
      case "dev.gitLog": { const log = await this.developer.gitLog(params.repoPath as string | undefined, params.limit as number | undefined); return { log }; }
      case "dev.gitDiff": { const diff = await this.developer.gitDiff(params.repoPath as string | undefined, params.staged as boolean | undefined); return { diff }; }
      case "dev.gitBranches": { const branches = await this.developer.gitBranches(params.repoPath as string | undefined); return { branches }; }
      case "dev.gitCommit": { const result = await this.developer.gitCommit(params.message as string, params.repoPath as string | undefined); return result as unknown as Record<string, unknown>; }
      case "dev.gitPush": { const result = await this.developer.gitPush(params.repoPath as string | undefined, params.remote as string | undefined, params.branch as string | undefined); return result as unknown as Record<string, unknown>; }
      case "dev.gitPull": { const result = await this.developer.gitPull(params.repoPath as string | undefined, params.remote as string | undefined); return result as unknown as Record<string, unknown>; }
      case "dev.gitClone": { const result = await this.developer.gitClone(params.url as string, params.destination as string | undefined); return result as unknown as Record<string, unknown>; }
      case "dev.openInEditor": { await this.developer.openInEditor(params.path as string, params.editor as string | undefined); return { success: true }; }
      case "dev.openProject": { await this.developer.openProject(params.path as string, params.editor as string | undefined); return { success: true }; }
      case "dev.getOpenEditors": { const editors = await this.developer.getOpenEditors(); return { editors }; }
      case "dev.searchInProject": { const results = await this.developer.searchInProject(params.query as string, params.projectPath as string | undefined, params.options as unknown as Parameters<typeof this.developer.searchInProject>[2]); return { results }; }
      case "dev.getProjectStructure": { const structure = await this.developer.getProjectStructure(params.path as string, params.depth as number | undefined); return { structure }; }
      case "dev.dockerPs": { const containers = await this.developer.dockerPs(params.all as boolean | undefined); return { containers }; }
      case "dev.dockerImages": { const images = await this.developer.dockerImages(); return { images }; }
      case "dev.dockerRun": { const result = await this.developer.dockerRun(params as unknown as Parameters<typeof this.developer.dockerRun>[0]); return result as unknown as Record<string, unknown>; }
      case "dev.dockerStop": { await this.developer.dockerStop(params.containerId as string); return { success: true }; }
      case "dev.dockerLogs": { const logs = await this.developer.dockerLogs(params.containerId as string, params.lines as number | undefined); return { logs }; }
      case "dev.dockerCompose": { const result = await this.developer.dockerCompose(params.action as Parameters<typeof this.developer.dockerCompose>[0], params.projectPath as string | undefined); return result as unknown as Record<string, unknown>; }
      default: throw new Error(`Unknown developer tool: ${tool}`);
    }
  }

  // ── MaintenanceLayer execute methods ─────────────────────────────────────
  private async executeMaintenance(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "maint.getDiskUsage": { const usage = await this.maintenance.getDiskUsage(); return { usage }; }
      case "maint.getLargeFiles": { const files = await this.maintenance.getLargeFiles(params.directory as string | undefined, params.minSizeMB as number | undefined, params.limit as number | undefined); return { files }; }
      case "maint.cleanTempFiles": { const result = await this.maintenance.cleanTempFiles(); return result as unknown as Record<string, unknown>; }
      case "maint.cleanDownloads": { const result = await this.maintenance.cleanDownloads(params as unknown as Parameters<typeof this.maintenance.cleanDownloads>[0]); return result as unknown as Record<string, unknown>; }
      case "maint.emptyTrash": { const result = await this.maintenance.emptyTrash(); return result as unknown as Record<string, unknown>; }
      case "maint.getDirectorySize": { const size = await this.maintenance.getDirectorySize(params.path as string); return size as unknown as Record<string, unknown>; }
      case "maint.listCaches": { const caches = await this.maintenance.listCaches(); return { caches }; }
      case "maint.clearAppCache": { const result = await this.maintenance.clearAppCache(params.appName as string); return result as unknown as Record<string, unknown>; }
      case "maint.clearBrowserCache": { const result = await this.maintenance.clearBrowserCache(params as unknown as Parameters<typeof this.maintenance.clearBrowserCache>[0]); return result as unknown as Record<string, unknown>; }
      case "maint.clearDeveloperCaches": { const result = await this.maintenance.clearDeveloperCaches(params.searchRoot as string | undefined); return result as unknown as Record<string, unknown>; }
      case "maint.getCacheSize": { const size = await this.maintenance.getCacheSize(); return size as unknown as Record<string, unknown>; }
      case "maint.listProcesses": { const processes = await this.maintenance.listProcesses(params.sortBy as Parameters<typeof this.maintenance.listProcesses>[0]); return { processes }; }
      case "maint.killProcess": { const result = await this.maintenance.killProcess(params.pid as number, params.force as boolean | undefined); return result as unknown as Record<string, unknown>; }
      case "maint.killByName": { const result = await this.maintenance.killByName(params.name as string, params.force as boolean | undefined); return result as unknown as Record<string, unknown>; }
      case "maint.getProcessInfo": { const info = await this.maintenance.getProcessInfo(params.pid as number); return { info }; }
      case "maint.getResourceHogs": { const hogs = await this.maintenance.getResourceHogs(params.limit as number | undefined); return { hogs }; }
      case "maint.getZombieProcesses": { const zombies = await this.maintenance.getZombieProcesses(); return { zombies }; }
      case "maint.getSystemLogs": { const logs = await this.maintenance.getSystemLogs(params.limit as number | undefined, params.since as string | undefined); return { logs }; }
      case "maint.getAppLogs": { const logs = await this.maintenance.getAppLogs(params.appName as string, params.limit as number | undefined); return { logs }; }
      case "maint.clearUserLogs": { const result = await this.maintenance.clearUserLogs(); return result as unknown as Record<string, unknown>; }
      case "maint.getLogSize": { const sizes = await this.maintenance.getLogSize(); return { sizes }; }
      case "maint.repairPermissions": { const result = await this.maintenance.repairPermissions(); return result as unknown as Record<string, unknown>; }
      case "maint.verifyDisk": { const result = await this.maintenance.verifyDisk(); return result as unknown as Record<string, unknown>; }
      case "maint.flushDNS": { const result = await this.maintenance.flushDNS(); return result as unknown as Record<string, unknown>; }
      case "maint.rebuildSpotlight": { const result = await this.maintenance.rebuildSpotlight(); return result as unknown as Record<string, unknown>; }
      case "maint.getStartupItems": { const items = await this.maintenance.getStartupItems(); return { items }; }
      default: throw new Error(`Unknown maintenance tool: ${tool}`);
    }
  }

  private async executeMedia(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "media.play": { await this.media.play(); return { success: true }; }
      case "media.pause": { await this.media.pause(); return { success: true }; }
      case "media.togglePlayPause": { await this.media.togglePlayPause(); return { success: true }; }
      case "media.nextTrack": { await this.media.nextTrack(); return { success: true }; }
      case "media.previousTrack": { await this.media.previousTrack(); return { success: true }; }
      case "media.getCurrentTrack": { const track = await this.media.getCurrentTrack(); return { track }; }
      case "media.setPosition": { await this.media.setPosition(params.seconds as number); return { success: true }; }
      case "media.getQueue": { const queue = await this.media.getQueue(params.limit as number | undefined); return { queue }; }
      case "media.getPlayerVolume": { const volume = await this.media.getPlayerVolume(params.app as "music" | "spotify" | undefined); return { volume }; }
      case "media.setPlayerVolume": { await this.media.setPlayerVolume(params.level as number, params.app as "music" | "spotify" | undefined); return { success: true }; }
      case "media.getAudioOutput": { const device = await this.media.getAudioOutput(); return { device }; }
      case "media.setAudioOutput": { await this.media.setAudioOutput(params.deviceName as string); return { success: true }; }
      case "media.getPlaylists": { const playlists = await this.media.getPlaylists(params.app as "music" | "spotify" | undefined); return { playlists }; }
      case "media.playPlaylist": { await this.media.playPlaylist(params.name as string, params.app as "music" | "spotify" | undefined); return { success: true }; }
      case "media.addToPlaylist": { await this.media.addToPlaylist(params.playlistName as string, params.trackId as string, params.app as "music" | "spotify" | undefined); return { success: true }; }
      case "media.createPlaylist": { const playlist = await this.media.createPlaylist(params.name as string, params.app as "music" | "spotify" | undefined); return { playlist }; }
      case "media.searchTracks": { const results = await this.media.searchTracks(params.query as string, params.app as "music" | "spotify" | undefined); return { results }; }
      case "media.getAirPlayDevices": { const devices = await this.media.getAirPlayDevices(); return { devices }; }
      case "media.setAirPlayDevice": { await this.media.setAirPlayDevice(params.deviceName as string); return { success: true }; }
      case "media.isAirPlaying": { const playing = await this.media.isAirPlaying(); return { playing }; }
      case "media.stopAirPlay": { await this.media.stopAirPlay(); return { success: true }; }
      case "media.getVideoPlayers": { const players = await this.media.getVideoPlayers(); return { players }; }
      case "media.controlVideo": { const result = await this.media.controlVideo(params.action as Parameters<typeof this.media.controlVideo>[0], params.value as number | undefined); return result as unknown as Record<string, unknown>; }
      case "media.getVideoInfo": { const info = await this.media.getVideoInfo(); return { info }; }
      case "media.setVideoPosition": { await this.media.setVideoPosition(params.seconds as number); return { success: true }; }
      default: throw new Error(`Unknown media tool: ${tool}`);
    }
  }

  private async executeFleet(
    tool: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case "fleet.discoverDevices": { const devices = await this.fleet.discoverDevices(); return { devices }; }
      case "fleet.getDeviceStatus": { const status = await this.fleet.getDeviceStatus(params.deviceId as string); return { status }; }
      case "fleet.pingDevice": { const alive = await this.fleet.pingDevice(params.deviceId as string); return { alive }; }
      case "fleet.getDeviceInfo": { const info = await this.fleet.getDeviceInfo(params.deviceId as string); return { info }; }
      case "fleet.listOnlineDevices": { const devices = await this.fleet.listOnlineDevices(); return { devices }; }
      case "fleet.getFleetOverview": { const overview = await this.fleet.getFleetOverview(); return { overview }; }
      case "fleet.sendTask": { const result = await this.fleet.sendTask(params.deviceId as string, params.task as Parameters<typeof this.fleet.sendTask>[1]); return result as unknown as Record<string, unknown>; }
      case "fleet.broadcastTask": { const results = await this.fleet.broadcastTask(params.task as Parameters<typeof this.fleet.broadcastTask>[0], params.deviceIds as string[] | undefined); return { results }; }
      case "fleet.getTaskStatus": { const status = await this.fleet.getTaskStatus(params.deviceId as string, params.taskId as string); return { status }; }
      case "fleet.cancelTask": { const success = await this.fleet.cancelTask(params.deviceId as string, params.taskId as string); return { success }; }
      case "fleet.collectResults": { const results = await this.fleet.collectResults(params.taskId as string); return { results }; }
      case "fleet.sendFile": { const result = await this.fleet.sendFile(params.deviceId as string, params.localPath as string, params.remotePath as string); return result as unknown as Record<string, unknown>; }
      case "fleet.requestFile": { const result = await this.fleet.requestFile(params.deviceId as string, params.remotePath as string, params.localPath as string); return result as unknown as Record<string, unknown>; }
      case "fleet.syncDirectory": { const result = await this.fleet.syncDirectory(params.deviceId as string, params.localDir as string, params.remoteDir as string, params.options as Parameters<typeof this.fleet.syncDirectory>[3] | undefined); return result as unknown as Record<string, unknown>; }
      case "fleet.getRemoteFileList": { const files = await this.fleet.getRemoteFileList(params.deviceId as string, params.remotePath as string); return { files }; }
      case "fleet.syncClipboard": { const result = await this.fleet.syncClipboard(params.deviceId as string, params.direction as Parameters<typeof this.fleet.syncClipboard>[1]); return result as unknown as Record<string, unknown>; }
      case "fleet.sendNotification": { const result = await this.fleet.sendNotification(params.deviceId as string, params.notification as Parameters<typeof this.fleet.sendNotification>[1]); return result as unknown as Record<string, unknown>; }
      case "fleet.getRemoteClipboard": { const content = await this.fleet.getRemoteClipboard(params.deviceId as string); return { content }; }
      case "fleet.startHeartbeat": { this.fleet.startHeartbeat(params.intervalMs as number | undefined); return { success: true }; }
      case "fleet.stopHeartbeat": { this.fleet.stopHeartbeat(); return { success: true }; }
      case "fleet.getHealthHistory": { const history = this.fleet.getHealthHistory(params.deviceId as string); return { history }; }
      default: throw new Error(`Unknown fleet tool: ${tool}`);
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
