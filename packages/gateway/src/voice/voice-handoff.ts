import { EventEmitter } from "node:events";
import { childLogger } from "../utils/logger.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const log = childLogger("voice-handoff");

export type DeviceType = "macos" | "iphone" | "ipad" | "apple_watch" | "airpods" | "airpods_pro" | "airpods_max" | "homepod";

export type HandoffStatus = "pending" | "in_progress" | "completed" | "cancelled" | "expired";

export interface HandoffState {
  sessionId: string;
  userId: string;
  lastTranscript: string;
  pendingIntent?: string;
  contextSummary: string;
  entities: Record<string, string[]>;
  timestamp: number;
  sourceDevice: DeviceInfo;
  targetDevice: DeviceInfo;
  status: HandoffStatus;
  expiresAt: number;
}

export interface DeviceInfo {
  id: string;
  type: DeviceType;
  name: string;
  platform: string;
  capabilities: DeviceCapabilities;
}

export interface DeviceCapabilities {
  stt: boolean;
  tts: boolean;
  wakeWord: boolean;
  speaker: boolean;
  microphone: boolean;
}

export interface VoiceHandoff {
  initiateHandoff(sessionId: string, targetDeviceId: string): Promise<HandoffState>;
  acceptHandoff(handoffId: string): Promise<void>;
  rejectHandoff(handoffId: string): void;
  getHandoffState(sessionId: string): HandoffState | null;
  listNearbyDevices(): DeviceInfo[];
  setActiveDevice(deviceId: string): void;
  getActiveDevice(): DeviceInfo | null;
  pruneExpired(): number;
}

interface HandoffData {
  handoffs: Record<string, HandoffState>;
  devices: Record<string, DeviceInfo>;
  activeDeviceId: string | null;
}

const HANDOFFS_FILE = join(homedir(), ".omnistate", "handoffs.json");
const HANDOFF_TTL_MS = 30000; // 30 seconds

class VoiceHandoffImpl extends EventEmitter implements VoiceHandoff {
  private handoffs = new Map<string, HandoffState>();
  private devices = new Map<string, DeviceInfo>();
  private activeDeviceId: string | null = null;

  constructor() {
    super();
    this.loadFromFile();
    this.initializeDevices();
  }

  private loadFromFile(): void {
    try {
      if (!existsSync(HANDOFFS_FILE)) return;

      const raw = readFileSync(HANDOFFS_FILE, "utf-8");
      const data = JSON.parse(raw) as HandoffData;

      if (data.handoffs) {
        for (const [id, handoff] of Object.entries(data.handoffs)) {
          if (handoff.expiresAt > Date.now()) {
            this.handoffs.set(id, handoff as HandoffState);
          }
        }
      }

      if (data.devices) {
        for (const [id, device] of Object.entries(data.devices)) {
          this.devices.set(id, device as DeviceInfo);
        }
      }

      if (data.activeDeviceId) {
        this.activeDeviceId = data.activeDeviceId;
      }

      log.info({ handoffCount: this.handoffs.size, deviceCount: this.devices.size }, "Handoff data loaded");
    } catch (err) {
      log.warn({ err }, "Failed to load handoff data");
    }
  }

  private saveToFile(): void {
    try {
      const dir = join(homedir(), ".omnistate");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: HandoffData = {
        handoffs: Object.fromEntries(this.handoffs),
        devices: Object.fromEntries(this.devices),
        activeDeviceId: this.activeDeviceId,
      };

      writeFileSync(HANDOFFS_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      log.warn({ err }, "Failed to save handoff data");
    }
  }

  private initializeDevices(): void {
    // Detect current device
    const platform = process.platform;
    let deviceType: DeviceType = "macos";

    if (platform === "darwin") {
      // Could be macOS, iOS simulator, etc.
      // In production, would use system profiling
      deviceType = "macos";
    }

    const localDevice: DeviceInfo = {
      id: this.getLocalDeviceId(),
      type: deviceType,
      name: `${deviceType}-local`,
      platform,
      capabilities: {
        stt: true,
        tts: true,
        wakeWord: true,
        speaker: true,
        microphone: true,
      },
    };

    this.devices.set(localDevice.id, localDevice);
    this.activeDeviceId = localDevice.id;

    // Add placeholder devices for discovery simulation
    this.addSimulatedDevices();

    log.info({ deviceId: localDevice.id, deviceType }, "Local device initialized");
  }

  private getLocalDeviceId(): string {
    return `device-${process.platform}-${process.pid}`;
  }

  private addSimulatedDevices(): void {
    // Simulated nearby devices (in production, would use Bonjour/mDNS)
    const nearbyDevices: DeviceInfo[] = [
      {
        id: "iphone-nearby",
        type: "iphone",
        name: "iPhone 15 Pro",
        platform: "darwin",
        capabilities: { stt: true, tts: true, wakeWord: true, speaker: true, microphone: true },
      },
      {
        id: "homepod-nearby",
        type: "homepod",
        name: "HomePod",
        platform: "darwin",
        capabilities: { stt: true, tts: true, wakeWord: true, speaker: true, microphone: true },
      },
      {
        id: "airpods-nearby",
        type: "airpods_pro",
        name: "AirPods Pro",
        platform: "darwin",
        capabilities: { stt: false, tts: false, wakeWord: false, speaker: true, microphone: true },
      },
    ];

    for (const device of nearbyDevices) {
      this.devices.set(device.id, device);
    }
  }

  async initiateHandoff(sessionId: string, targetDeviceId: string): Promise<HandoffState> {
    const targetDevice = this.devices.get(targetDeviceId);
    if (!targetDevice) {
      throw new Error(`Target device not found: ${targetDeviceId}`);
    }

    const sourceDevice = this.devices.get(this.activeDeviceId ?? "");
    if (!sourceDevice) {
      throw new Error("Active device not found");
    }

    const handoffId = `handoff-${sessionId}-${Date.now()}`;
    const now = Date.now();

    const handoff: HandoffState = {
      sessionId,
      userId: "local-user", // In production, from session context
      lastTranscript: "",
      pendingIntent: undefined,
      contextSummary: "",
      entities: {},
      timestamp: now,
      sourceDevice,
      targetDevice,
      status: "pending",
      expiresAt: now + HANDOFF_TTL_MS,
    };

    this.handoffs.set(handoffId, handoff);
    this.saveToFile();

    log.info(
      { handoffId, sessionId, source: sourceDevice.name, target: targetDevice.name },
      "Handoff initiated"
    );

    this.emit("handoffInitiated", { handoffId, sessionId, targetDeviceId });

    // Simulate handoff completion after short delay
    setTimeout(() => {
      this.completeHandoff(handoffId);
    }, 2000);

    return handoff;
  }

  private completeHandoff(handoffId: string): void {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff || handoff.status !== "pending") return;

    handoff.status = "completed";
    this.saveToFile();

    log.info({ handoffId }, "Handoff completed");
    this.emit("handoffCompleted", { handoffId, sessionId: handoff.sessionId });
  }

  async acceptHandoff(handoffId: string): Promise<void> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`Handoff not found: ${handoffId}`);
    }

    if (handoff.status !== "pending") {
      throw new Error(`Handoff not pending: ${handoff.status}`);
    }

    handoff.status = "in_progress";
    this.saveToFile();

    log.info({ handoffId }, "Handoff accepted");
    this.emit("handoffAccepted", { handoffId, sessionId: handoff.sessionId });
  }

  rejectHandoff(handoffId: string): void {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) return;

    handoff.status = "cancelled";
    this.saveToFile();

    log.info({ handoffId }, "Handoff rejected");
    this.emit("handoffRejected", { handoffId, sessionId: handoff.sessionId });
  }

  getHandoffState(sessionId: string): HandoffState | null {
    // Find most recent handoff for this session
    let latest: HandoffState | null = null;
    for (const handoff of this.handoffs.values()) {
      if (handoff.sessionId === sessionId) {
        if (!latest || handoff.timestamp > latest.timestamp) {
          latest = handoff;
        }
      }
    }
    return latest;
  }

  listNearbyDevices(): DeviceInfo[] {
    return Array.from(this.devices.values()).filter(d => d.id !== this.activeDeviceId);
  }

  setActiveDevice(deviceId: string): void {
    if (!this.devices.has(deviceId)) {
      log.warn({ deviceId }, "Device not found for activation");
      return;
    }

    this.activeDeviceId = deviceId;
    this.saveToFile();

    log.info({ deviceId, name: this.devices.get(deviceId)?.name }, "Active device changed");
    this.emit("activeDeviceChanged", { deviceId });
  }

  getActiveDevice(): DeviceInfo | null {
    return this.activeDeviceId ? this.devices.get(this.activeDeviceId) ?? null : null;
  }

  /**
   * Serialize handoff state for transfer.
   */
  serializeHandoff(sessionId: string): string | null {
    const handoff = this.getHandoffState(sessionId);
    if (!handoff) return null;
    return JSON.stringify(handoff);
  }

  /**
   * Deserialize handoff state from another device.
   */
  deserializeHandoff(serialized: string): HandoffState | null {
    try {
      const handoff = JSON.parse(serialized) as HandoffState;
      handoff.status = "pending";
      handoff.expiresAt = Date.now() + HANDOFF_TTL_MS;
      return handoff;
    } catch {
      log.warn("Failed to deserialize handoff");
      return null;
    }
  }

  /**
   * Clean up expired handoffs.
   */
  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, handoff] of this.handoffs) {
      if (handoff.expiresAt < now) {
        handoff.status = "expired";
        this.handoffs.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.saveToFile();
      log.info({ pruned }, "Expired handoffs pruned");
    }

    return pruned;
  }
}

export interface VoiceHandoff extends EventEmitter {
  on(event: "handoffInitiated", listener: (info: { handoffId: string; sessionId: string; targetDeviceId: string }) => void): this;
  on(event: "handoffAccepted" | "handoffCompleted" | "handoffRejected", listener: (info: { handoffId: string; sessionId: string }) => void): this;
  on(event: "activeDeviceChanged", listener: (info: { deviceId: string }) => void): this;
  emit(event: "handoffInitiated", info: { handoffId: string; sessionId: string; targetDeviceId: string }): boolean;
  emit(event: "handoffAccepted" | "handoffCompleted" | "handoffRejected", info: { handoffId: string; sessionId: string }): boolean;
  emit(event: "activeDeviceChanged", info: { deviceId: string }): boolean;
}

// ─── Singleton Export ──────────────────────────────────────────────────────────

export const voiceHandoff: VoiceHandoff = new VoiceHandoffImpl();

// Auto-prune expired handoffs every minute
setInterval(() => {
  voiceHandoff.pruneExpired();
}, 60000);