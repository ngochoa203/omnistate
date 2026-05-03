/**
 * Deep OS Layer — Process Management.
 *
 * UC-B01: Process lifecycle — list, kill, restart, monitor, prioritize.
 */

import type { DeepLayer } from "./deep.js";
import type { ProcessDetails } from "./deep-os-types.js";

// ------------------------------------------------------------------
// UC-B01: Process Lifecycle
// ------------------------------------------------------------------

export class DeepOSProcessLayer {
  constructor(private readonly deep: DeepLayer) {}

  /**
   * Restart a named process: kill it and re-launch its command.
   * Uses SIGTERM first; falls back to SIGKILL after 3 s.
   */
  async restartProcess(name: string): Promise<boolean> {
    try {
      const { stdout: pidStr } = await this.deep.execAsync(
        `pgrep -x "${name}" | head -1`
      );
      const pid = parseInt(pidStr.trim(), 10);
      if (isNaN(pid)) return false;

      // Capture the original command line before killing
      const cmdResult = await this.deep.execAsync(
        `ps -p ${pid} -o comm= 2>/dev/null`
      );
      const cmd = cmdResult.stdout.trim();
      if (!cmd) return false;

      // Graceful stop
      await this.deep.execAsync(`kill -15 ${pid}`);

      // Wait up to 3 s then force if still alive
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
      try {
        await this.deep.execAsync(`kill -0 ${pid}`);
        // Still alive — force
        await this.deep.execAsync(`kill -9 ${pid}`);
      } catch {
        // Already dead — good
      }

      // Re-launch detached
      const { spawn } = await import("node:child_process");
      spawn(cmd, { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the scheduling priority (nice value) of a process.
   * Priority range: -20 (highest) to 19 (lowest). Requires sudo for negative values.
   */
  async reniceProcess(pid: number, priority: number): Promise<boolean> {
    try {
      await this.deep.execAsync(`renice -n ${priority} -p ${pid}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return detailed information for a given PID, including open files,
   * listening ports, and child PIDs.
   */
  async getProcessDetails(pid: number): Promise<ProcessDetails | null> {
    try {
      const [infoRes, filesRes, childRes] = await Promise.allSettled([
        this.deep.execAsync(
          `ps -p ${pid} -o pid=,ppid=,pcpu=,pmem=,stat=,comm= 2>/dev/null`
        ),
        this.deep.execAsync(`lsof -p ${pid} -F n 2>/dev/null | grep '^n' | head -40`),
        this.deep.execAsync(`pgrep -P ${pid} 2>/dev/null`),
      ]);

      if (infoRes.status === "rejected") return null;
      const raw = infoRes.value.stdout.trim().split(/\s+/);
      if (raw.length < 5) return null;

      const ppid = parseInt(raw[1], 10);
      const cpu = parseFloat(raw[2]);
      const mem = parseFloat(raw[3]);
      const status = raw[4] ?? "?";
      const name = raw.slice(5).join(" ");

      const openFiles: string[] =
        filesRes.status === "fulfilled"
          ? filesRes.value.stdout
              .trim()
              .split("\n")
              .filter((l) => l.startsWith("n"))
              .map((l) => l.slice(1))
          : [];

      // Extract numeric ports from open files list
      const openPorts: number[] = openFiles
        .filter((f) => /:\d+$/.test(f))
        .map((f) => parseInt(f.split(":").pop() ?? "", 10))
        .filter((p) => !isNaN(p));

      const children: number[] =
        childRes.status === "fulfilled"
          ? childRes.value.stdout
              .trim()
              .split("\n")
              .map((s) => parseInt(s, 10))
              .filter((n) => !isNaN(n))
          : [];

      return { pid, name, ppid, cpu, memory: mem, status, openFiles, openPorts, children };
    } catch {
      return null;
    }
  }
}
