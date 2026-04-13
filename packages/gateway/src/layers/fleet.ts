/**
 * Fleet Layer — multi-device orchestration over Tailscale.
 *
 * FleetLayer acts as the Fleet Commander, coordinating task distribution,
 * file sync, clipboard sharing, and health monitoring across all registered
 * devices. Communication is plain HTTP to each device's gateway endpoint,
 * authenticated with the device's JWT token.
 *
 * Remote device base URL: http://${device.tailscaleIp}:${device.port || 9377}
 */

import { execSync } from "node:child_process";

import { DeviceRepository, type DeviceInfo } from "../db/device-repository.js";
import { getTailscaleStatus } from "../network/tailscale.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A task dispatched to a remote device. */
export interface RemoteTask {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  timeout?: number;
}

/** Real-time status of a single device in the fleet. */
export interface DeviceStatus {
  deviceId: string;
  deviceName: string;
  online: boolean;
  lastSeenAt: string | null;
  latencyMs: number | null;
  capabilities: string[];
  tailscaleIp: string | null;
}

/** Full info about a remote device. */
export interface RemoteDeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: string;
  hostname: string | null;
  os: string | null;
  arch: string | null;
  tailscaleIps: string[];
  lanIps: string[];
  port: number;
  version: string | null;
}

/** Status of a task running on a remote device. */
export interface RemoteTaskStatus {
  taskId: string;
  deviceId: string;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  result: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** Aggregated results from all devices that ran a task. */
export interface CollectedResults {
  taskId: string;
  results: Array<RemoteTaskStatus & { deviceId: string }>;
  successCount: number;
  failureCount: number;
}

/** Fleet overview: totals and per-device status. */
export interface FleetOverview {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  devices: DeviceStatus[];
}

/** Entry in the in-memory health history. */
export interface HealthCheckEntry {
  deviceId: string;
  checkedAt: string;
  online: boolean;
  latencyMs: number | null;
  error: string | null;
}

/** Remote file list response. */
export interface RemoteFileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const DEFAULT_PORT = 9377;
const DEFAULT_HEARTBEAT_MS = 30_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HEALTH_HISTORY = 100;

function deviceBaseUrl(device: DeviceInfo, port?: number): string {
  const ip = device.tailscaleIp ?? "127.0.0.1";
  return `http://${ip}:${port ?? DEFAULT_PORT}`;
}

/** Wrap fetch with a hard timeout so offline devices don't stall the loop. */
async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── FleetLayer ───────────────────────────────────────────────────────────────

export class FleetLayer {
  private repo: DeviceRepository;

  /**
   * In-memory health history: deviceId → circular buffer of check results.
   * Not persisted across restarts — use for live dashboards only.
   */
  private healthHistory: Map<string, HealthCheckEntry[]> = new Map();

  /** Tracks which device IDs were seen online in the last heartbeat round. */
  private onlineSet: Set<string> = new Set();

  /** setInterval handle for the heartbeat loop. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(repo: DeviceRepository) {
    this.repo = repo;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Device Discovery & Management
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Discover all devices: union of Tailscale peers (if available) and
   * registered devices from the DB. Returns enriched DeviceStatus for each.
   */
  async discoverDevices(): Promise<DeviceStatus[]> {
    const dbDevices = this.repo.listDevices();
    const tsStatus = getTailscaleStatus();

    // Collect Tailscale peer IPs we can map to DB devices
    const tsPeerIpSet = new Set<string>();
    if (tsStatus.running) {
      try {
        const raw = execSync("tailscale status --json", {
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5_000,
          encoding: "utf8",
        });
        const parsed = JSON.parse(raw);
        const peers: Record<string, any> = parsed?.Peer ?? {};
        for (const peer of Object.values(peers)) {
          const ips: string[] = peer?.TailscaleIPs ?? [];
          ips.forEach((ip) => tsPeerIpSet.add(ip));
        }
      } catch {
        // Tailscale query failed — degrade gracefully
      }
    }

    const statuses = await Promise.all(
      dbDevices.map((d) => this.getDeviceStatus(d.id))
    );
    return statuses;
  }

  /**
   * Get the current online/offline status, last-seen timestamp, and
   * capabilities for a specific device. Falls back to DB data when offline.
   */
  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const device = this.repo.getDevice(deviceId);
    if (!device) {
      return {
        deviceId,
        deviceName: "Unknown",
        online: false,
        lastSeenAt: null,
        latencyMs: null,
        capabilities: [],
        tailscaleIp: null,
      };
    }

    if (!device.tailscaleIp) {
      return {
        deviceId,
        deviceName: device.deviceName,
        online: false,
        lastSeenAt: device.lastSeenAt,
        latencyMs: null,
        capabilities: [],
        tailscaleIp: null,
      };
    }

    const t0 = Date.now();
    try {
      const url = `${deviceBaseUrl(device)}/health`;
      const res = await fetchWithTimeout(url, {}, 4_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: any = await res.json().catch(() => ({}));
      const latencyMs = Date.now() - t0;
      this.onlineSet.add(deviceId);
      return {
        deviceId,
        deviceName: device.deviceName,
        online: true,
        lastSeenAt: new Date().toISOString(),
        latencyMs,
        capabilities: body?.capabilities ?? [],
        tailscaleIp: device.tailscaleIp,
      };
    } catch {
      this.onlineSet.delete(deviceId);
      return {
        deviceId,
        deviceName: device.deviceName,
        online: false,
        lastSeenAt: device.lastSeenAt,
        latencyMs: null,
        capabilities: [],
        tailscaleIp: device.tailscaleIp,
      };
    }
  }

  /**
   * Send an HTTP health ping to the device's `/health` endpoint.
   * Returns true if the device responds with 2xx within the timeout.
   */
  async pingDevice(deviceId: string): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/health`,
        { method: "GET" },
        4_000
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve detailed device info (OS, hostname, IPs) from the remote device.
   * Returns null if the device is unreachable.
   */
  async getDeviceInfo(deviceId: string): Promise<RemoteDeviceInfo | null> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return null;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/device/info`,
        {
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        }
      );
      if (!res.ok) return null;
      const body: any = await res.json();
      return {
        deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        hostname: body?.hostname ?? null,
        os: body?.os ?? null,
        arch: body?.arch ?? null,
        tailscaleIps: body?.tailscaleIps ?? (device.tailscaleIp ? [device.tailscaleIp] : []),
        lanIps: body?.lanIps ?? [],
        port: body?.port ?? DEFAULT_PORT,
        version: body?.version ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Return only devices that responded to a ping in the last heartbeat round
   * (or fire a fresh round of pings if no heartbeat is running).
   */
  async listOnlineDevices(): Promise<DeviceStatus[]> {
    const all = await this.discoverDevices();
    return all.filter((d) => d.online);
  }

  /**
   * High-level fleet summary: total count, online count, and full device list
   * with status for each.
   */
  async getFleetOverview(): Promise<FleetOverview> {
    const devices = await this.discoverDevices();
    const online = devices.filter((d) => d.online);
    return {
      totalDevices: devices.length,
      onlineDevices: online.length,
      offlineDevices: devices.length - online.length,
      devices,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Task Distribution
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Send a single task to a specific device via HTTP POST.
   * Returns the initial task status (usually "pending").
   */
  async sendTask(
    deviceId: string,
    task: RemoteTask
  ): Promise<RemoteTaskStatus> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) {
      return this._offlineTaskStatus(deviceId, task.id, "Device not found or no Tailscale IP");
    }

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/tasks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
          body: JSON.stringify(task),
        },
        task.timeout ?? FETCH_TIMEOUT_MS
      );

      if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`);
        return this._offlineTaskStatus(deviceId, task.id, text);
      }

      const body: any = await res.json();
      return {
        taskId: task.id,
        deviceId,
        status: body?.status ?? "pending",
        result: body?.result ?? null,
        error: body?.error ?? null,
        startedAt: body?.startedAt ?? null,
        completedAt: body?.completedAt ?? null,
      };
    } catch (err: any) {
      return this._offlineTaskStatus(deviceId, task.id, err?.message ?? "Network error");
    }
  }

  /**
   * Broadcast a task to all online devices, optionally filtered by OS or tag.
   * Dispatches concurrently and returns all results.
   */
  async broadcastTask(
    task: RemoteTask,
    filter?: { os?: string; tag?: string }
  ): Promise<RemoteTaskStatus[]> {
    const online = await this.listOnlineDevices();
    let targets = online;

    if (filter?.os) {
      // os match is best-effort — we skip devices where info fetch fails
      const infoResults = await Promise.all(
        online.map((d) => this.getDeviceInfo(d.deviceId))
      );
      targets = online.filter((_, i) => {
        const info = infoResults[i];
        return info?.os?.toLowerCase().includes(filter.os!.toLowerCase());
      });
    }
    // tag filtering would require tag storage in device metadata — skip for now

    const results = await Promise.all(
      targets.map((d) => this.sendTask(d.deviceId, task))
    );
    return results;
  }

  /**
   * Poll a remote device for the current status of a previously dispatched task.
   */
  async getTaskStatus(
    deviceId: string,
    taskId: string
  ): Promise<RemoteTaskStatus> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) {
      return this._offlineTaskStatus(deviceId, taskId, "Device not reachable");
    }

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/tasks/${encodeURIComponent(taskId)}`,
        {
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        }
      );
      if (!res.ok) {
        return this._offlineTaskStatus(deviceId, taskId, `HTTP ${res.status}`);
      }
      const body: any = await res.json();
      return {
        taskId,
        deviceId,
        status: body?.status ?? "failed",
        result: body?.result ?? null,
        error: body?.error ?? null,
        startedAt: body?.startedAt ?? null,
        completedAt: body?.completedAt ?? null,
      };
    } catch (err: any) {
      return this._offlineTaskStatus(deviceId, taskId, err?.message ?? "Network error");
    }
  }

  /**
   * Send a cancel signal for a running task on a remote device.
   * Returns true if the cancel was acknowledged.
   */
  async cancelTask(deviceId: string, taskId: string): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/tasks/${encodeURIComponent(taskId)}/cancel`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Collect the final results of a task from all devices that received it.
   * Queries all registered devices concurrently; ignores unreachable ones.
   */
  async collectResults(taskId: string): Promise<CollectedResults> {
    const devices = this.repo.listDevices();
    const all = await Promise.all(
      devices.map((d) => this.getTaskStatus(d.id, taskId))
    );

    // Only include devices that actually ran the task (status != "failed" due to offline)
    const relevant = all.filter(
      (r) => r.status !== "failed" || r.error === null
    );

    return {
      taskId,
      results: relevant,
      successCount: relevant.filter((r) => r.status === "complete").length,
      failureCount: relevant.filter((r) => r.status === "failed").length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. File Sync
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Upload a local file to a remote device via HTTP multipart/form-data.
   * Returns true if the upload succeeded.
   */
  async sendFile(
    deviceId: string,
    localPath: string,
    remotePath: string
  ): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const form = new FormData();
      // Node 18+ supports FormData with Blob
      const { readFileSync } = await import("node:fs");
      const data = readFileSync(localPath);
      const blob = new Blob([data]);
      form.append("file", blob, remotePath.split("/").pop() ?? "upload");
      form.append("remotePath", remotePath);

      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/files/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
          body: form,
        },
        60_000 // generous timeout for large files
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Download a file from a remote device to a local path.
   * Returns true if the download completed successfully.
   */
  async requestFile(
    deviceId: string,
    remotePath: string,
    localPath: string
  ): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/files/download?path=${encodeURIComponent(remotePath)}`,
        {
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        },
        60_000
      );
      if (!res.ok || !res.body) return false;

      const { createWriteStream: cws } = await import("node:fs");
      const out = cws(localPath);
      const reader = res.body.getReader();

      await new Promise<void>((resolve, reject) => {
        const pump = () =>
          reader.read().then(({ done, value }) => {
            if (done) {
              out.end(resolve);
              return;
            }
            if (!out.write(value)) {
              out.once("drain", pump);
            } else {
              pump();
            }
          }).catch(reject);
        pump();
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sync a directory between local and remote using rsync over Tailscale SSH.
   * Requires rsync and Tailscale SSH to be available on both ends.
   */
  async syncDirectory(
    deviceId: string,
    localDir: string,
    remoteDir: string,
    direction: "push" | "pull"
  ): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const remote = `${device.tailscaleIp}:${remoteDir}`;
      const [src, dst] = direction === "push"
        ? [localDir.replace(/\/$/, "") + "/", remote]
        : [remote + "/", localDir];

      execSync(
        `rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" "${src}" "${dst}"`,
        { stdio: "ignore", timeout: 120_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files in a directory on a remote device.
   * Returns an empty array if the device is unreachable or the path does not exist.
   */
  async getRemoteFileList(
    deviceId: string,
    remotePath: string
  ): Promise<RemoteFileEntry[]> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return [];

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/files/list?path=${encodeURIComponent(remotePath)}`,
        {
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        }
      );
      if (!res.ok) return [];
      const body: any = await res.json();
      return Array.isArray(body?.files) ? body.files : [];
    } catch {
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Clipboard & Notification Sync
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Sync clipboard between local machine and a remote device.
   * - `push`: reads local clipboard → sends to remote
   * - `pull`: gets remote clipboard → writes to local (macOS / pbcopy)
   *
   * Returns true on success.
   */
  async syncClipboard(
    deviceId: string,
    direction: "push" | "pull"
  ): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    if (direction === "push") {
      let content: string;
      try {
        content = execSync("pbpaste", { encoding: "utf8", timeout: 2_000 });
      } catch {
        return false;
      }

      try {
        const res = await fetchWithTimeout(
          `${deviceBaseUrl(device)}/api/clipboard`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this._getDeviceToken(device)}`,
            },
            body: JSON.stringify({ content }),
          }
        );
        return res.ok;
      } catch {
        return false;
      }
    } else {
      // pull
      const content = await this.getRemoteClipboard(deviceId);
      if (content === null) return false;
      try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("pbcopy", { input: content, timeout: 2_000 });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Send a push notification to a remote device.
   * Returns true if the device acknowledged the notification.
   */
  async sendNotification(
    deviceId: string,
    title: string,
    body: string
  ): Promise<boolean> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return false;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/notify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
          body: JSON.stringify({ title, body }),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve the current clipboard contents from a remote device.
   * Returns null if the device is unreachable or clipboard access is denied.
   */
  async getRemoteClipboard(deviceId: string): Promise<string | null> {
    const device = this.repo.getDevice(deviceId);
    if (!device?.tailscaleIp) return null;

    try {
      const res = await fetchWithTimeout(
        `${deviceBaseUrl(device)}/api/clipboard`,
        {
          headers: {
            Authorization: `Bearer ${this._getDeviceToken(device)}`,
          },
        }
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      return typeof data?.content === "string" ? data.content : null;
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Heartbeat & Health
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Start a periodic heartbeat loop that pings all registered devices.
   * Results are stored in the in-memory health history.
   *
   * @param intervalMs - How often to ping, default 30 000 ms.
   */
  startHeartbeat(intervalMs: number = DEFAULT_HEARTBEAT_MS): void {
    if (this.heartbeatTimer !== null) return; // already running

    const runRound = async () => {
      const devices = this.repo.listDevices();
      await Promise.all(devices.map((d) => this._heartbeatOne(d)));
    };

    // First tick immediately, then on interval
    void runRound();
    this.heartbeatTimer = setInterval(() => void runRound(), intervalMs);
  }

  /** Stop the heartbeat loop. */
  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Get recent health check results for a device.
   * Most recent entry is first.
   *
   * @param deviceId - Target device.
   * @param limit    - Max entries to return; defaults to 20.
   */
  getHealthHistory(deviceId: string, limit = 20): HealthCheckEntry[] {
    const history = this.healthHistory.get(deviceId) ?? [];
    return history.slice(-limit).reverse();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Ping a single device and record the result in health history.
   * Called by the heartbeat loop.
   */
  private async _heartbeatOne(device: DeviceInfo): Promise<void> {
    const t0 = Date.now();
    let online = false;
    let latencyMs: number | null = null;
    let error: string | null = null;

    if (device.tailscaleIp) {
      try {
        const res = await fetchWithTimeout(
          `${deviceBaseUrl(device)}/health`,
          { method: "GET" },
          4_000
        );
        online = res.ok;
        latencyMs = Date.now() - t0;
      } catch (err: any) {
        error = err?.message ?? "timeout";
      }
    } else {
      error = "No Tailscale IP";
    }

    if (online) {
      this.onlineSet.add(device.id);
    } else {
      this.onlineSet.delete(device.id);
    }

    const entry: HealthCheckEntry = {
      deviceId: device.id,
      checkedAt: new Date().toISOString(),
      online,
      latencyMs,
      error,
    };

    const buf = this.healthHistory.get(device.id) ?? [];
    buf.push(entry);
    if (buf.length > MAX_HEALTH_HISTORY) buf.shift();
    this.healthHistory.set(device.id, buf);
  }

  /**
   * Build a failed RemoteTaskStatus for when a device is unreachable.
   */
  private _offlineTaskStatus(
    deviceId: string,
    taskId: string,
    error: string
  ): RemoteTaskStatus {
    return {
      taskId,
      deviceId,
      status: "failed",
      result: null,
      error,
      startedAt: null,
      completedAt: null,
    };
  }

  /**
   * Retrieve the JWT token stored for the device row.
   * The token is the device_token column (already a signed JWT from registration).
   *
   * We access it via a raw DB query since DeviceInfo does not expose the token
   * directly (by design — it's kept off the public struct).
   */
  private _getDeviceToken(device: DeviceInfo): string {
    // Access the underlying DB via the repository's `db` property.
    // DeviceRepository stores the db as `private db`, so we cast to any here.
    const db = (this.repo as any).db;
    const row: { device_token: string } | undefined = db
      .prepare("SELECT device_token FROM registered_devices WHERE id = ?")
      .get(device.id);
    return row?.device_token ?? "";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Fleet Orchestration
  // ══════════════════════════════════════════════════════════════════════════

  /** In-memory task group registry. */
  private taskGroups: Map<
    string,
    {
      groupId: string;
      tasks: Array<{ deviceId: string; taskId: string }>;
      results: any[];
    }
  > = new Map();

  /** In-memory schedule registry. */
  private schedules: Map<
    string,
    { scheduleId: string; deviceId: string; task: RemoteTask; cron: string }
  > = new Map();

  /**
   * Group multiple tasks and execute them in parallel or sequentially.
   * Returns a groupId that can be used with getTaskGroupStatus / cancelTaskGroup.
   */
  async createTaskGroup(
    tasks: Array<{ deviceId: string; task: RemoteTask }>,
    options?: { parallel?: boolean; failFast?: boolean }
  ): Promise<{ groupId: string; taskIds: string[] }> {
    const groupId = crypto.randomUUID();
    const parallel = options?.parallel ?? true;
    const failFast = options?.failFast ?? false;

    const dispatched: Array<{ deviceId: string; taskId: string }> = [];
    const taskIds: string[] = [];

    const dispatch = async (entry: { deviceId: string; task: RemoteTask }) => {
      try {
        const status = await this.sendTask(entry.deviceId, entry.task);
        dispatched.push({ deviceId: entry.deviceId, taskId: status.taskId });
        taskIds.push(status.taskId);
        return status;
      } catch (err) {
        const errStatus: RemoteTaskStatus = {
          taskId: entry.task.id ?? crypto.randomUUID(),
          deviceId: entry.deviceId,
          status: "failed",
          result: null,
          error: err instanceof Error ? err.message : String(err),
          startedAt: null,
          completedAt: null,
        };
        dispatched.push({ deviceId: entry.deviceId, taskId: errStatus.taskId });
        taskIds.push(errStatus.taskId);
        if (failFast) throw err;
        return errStatus;
      }
    };

    if (parallel) {
      await Promise.allSettled(tasks.map(dispatch));
    } else {
      for (const entry of tasks) {
        try {
          await dispatch(entry);
        } catch {
          if (failFast) break;
        }
      }
    }

    this.taskGroups.set(groupId, { groupId, tasks: dispatched, results: [] });
    return { groupId, taskIds };
  }

  /**
   * Aggregate status of a task group by polling each device.
   */
  async getTaskGroupStatus(groupId: string): Promise<{
    groupId: string;
    total: number;
    completed: number;
    failed: number;
    pending: number;
    results: any[];
  }> {
    const group = this.taskGroups.get(groupId);
    if (!group) {
      return {
        groupId,
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        results: [],
      };
    }

    const statuses = await Promise.allSettled(
      group.tasks.map((t) => this.getTaskStatus(t.deviceId, t.taskId))
    );

    let completed = 0;
    let failed = 0;
    let pending = 0;
    const results: any[] = [];

    for (const s of statuses) {
      if (s.status === "fulfilled") {
        const ts = s.value;
        results.push(ts);
        if (ts.status === "completed") completed++;
        else if (ts.status === "failed") failed++;
        else pending++;
      } else {
        failed++;
        results.push({ status: "failed", error: s.reason?.message });
      }
    }

    group.results = results;
    return {
      groupId,
      total: group.tasks.length,
      completed,
      failed,
      pending,
      results,
    };
  }

  /**
   * Cancel all tasks in a group.
   */
  async cancelTaskGroup(groupId: string): Promise<{ cancelled: number }> {
    const group = this.taskGroups.get(groupId);
    if (!group) return { cancelled: 0 };

    const results = await Promise.allSettled(
      group.tasks.map((t) => this.cancelTask(t.deviceId, t.taskId))
    );

    const cancelled = results.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;

    this.taskGroups.delete(groupId);
    return { cancelled };
  }

  /**
   * Schedule a recurring task on a device (stored in memory).
   */
  async scheduleTask(
    deviceId: string,
    task: RemoteTask,
    cronExpression: string
  ): Promise<{ scheduleId: string }> {
    const scheduleId = crypto.randomUUID();
    this.schedules.set(scheduleId, {
      scheduleId,
      deviceId,
      task,
      cron: cronExpression,
    });
    return { scheduleId };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Fleet Configuration Sync
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Push configuration to a remote device via POST /api/config.
   */
  async syncConfig(
    deviceId: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const device = this.repo.getDevice(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    const base = deviceBaseUrl(device);
    const token = this._getDeviceToken(device);
    const res = await fetchWithTimeout(`${base}/api/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      throw new Error(`syncConfig failed: HTTP ${res.status}`);
    }
  }

  /**
   * Get configuration from a remote device via GET /api/config.
   */
  async getRemoteConfig(
    deviceId: string
  ): Promise<Record<string, unknown>> {
    const device = this.repo.getDevice(deviceId);
    if (!device) throw new Error(`Device not found: ${deviceId}`);
    const base = deviceBaseUrl(device);
    const token = this._getDeviceToken(device);
    try {
      const res = await fetchWithTimeout(`${base}/api/config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `getRemoteConfig failed for ${deviceId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Push config to all online devices.
   */
  async broadcastConfig(
    config: Record<string, unknown>
  ): Promise<{ succeeded: number; failed: number }> {
    const online = await this.listOnlineDevices();
    const results = await Promise.allSettled(
      online.map((d) => this.syncConfig(d.deviceId, config))
    );
    let succeeded = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") succeeded++;
      else failed++;
    }
    return { succeeded, failed };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. Fleet Monitoring
  // ══════════════════════════════════════════════════════════════════════════

  /** Alert thresholds for fleet-wide monitoring. */
  private alertThresholds: {
    cpu?: number;
    memory?: number;
    disk?: number;
    offlineMinutes?: number;
  } = {};

  /**
   * Collect metrics from all online devices via GET /api/metrics.
   */
  async getFleetMetrics(): Promise<{
    devices: Array<{
      id: string;
      hostname: string;
      online: boolean;
      cpu?: number;
      memory?: number;
      disk?: number;
      lastSeen: string;
    }>;
    aggregate: { avgCpu: number; avgMemory: number; totalTasks: number };
  }> {
    const all = await this.discoverDevices();
    const deviceMetrics = await Promise.allSettled(
      all.map(async (d) => {
        const metrics = d.online
          ? await this.getDeviceMetrics(d.deviceId).catch(() => null)
          : null;
        return {
          id: d.deviceId,
          hostname: d.hostname,
          online: d.online,
          cpu: metrics?.cpu,
          memory: metrics?.memory,
          disk: metrics?.disk,
          lastSeen: d.lastSeen ?? new Date().toISOString(),
        };
      })
    );

    const devices = deviceMetrics.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : {
            id: "unknown",
            hostname: "unknown",
            online: false,
            lastSeen: new Date().toISOString(),
          }
    );

    const online = devices.filter((d) => d.online && d.cpu != null);
    const avgCpu =
      online.length > 0
        ? online.reduce((sum, d) => sum + (d.cpu ?? 0), 0) / online.length
        : 0;
    const avgMemory =
      online.length > 0
        ? online.reduce((sum, d) => sum + (d.memory ?? 0), 0) / online.length
        : 0;

    return {
      devices,
      aggregate: { avgCpu, avgMemory, totalTasks: 0 },
    };
  }

  /**
   * Get detailed metrics from a single device via GET /api/metrics.
   */
  async getDeviceMetrics(
    deviceId: string
  ): Promise<{
    cpu: number;
    memory: number;
    disk: number;
    uptime: number;
    load: number[];
  } | null> {
    const device = this.repo.getDevice(deviceId);
    if (!device) return null;
    const base = deviceBaseUrl(device);
    const token = this._getDeviceToken(device);
    try {
      const res = await fetchWithTimeout(`${base}/api/metrics`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        cpu: number;
        memory: number;
        disk: number;
        uptime: number;
        load: number[];
      };
    } catch {
      return null;
    }
  }

  /**
   * Configure alert thresholds for fleet-wide monitoring (stored in memory).
   */
  async setAlertThresholds(thresholds: {
    cpu?: number;
    memory?: number;
    disk?: number;
    offlineMinutes?: number;
  }): Promise<void> {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
  }
}

// ─── Re-export legacy interfaces for backward compat ────────────────────────

/** @deprecated Use DeviceStatus instead. */
export interface FleetAgent {
  id: string;
  hostname: string;
  address: string;
  group: string;
  status: "healthy" | "degraded" | "offline";
  lastSeen: number;
  capabilities: string[];
}

/** @deprecated Use FleetLayer.broadcastTask() instead. */
export interface FleetDistributionResult {
  taskId: string;
  distributed: number;
  failed: number;
  agents: string[];
}
