/**
 * Deep OS Layer — File & Volume Operations.
 *
 * UC-B14: Partition/volume management.
 * UC-B13: User/Group/ACL management (file permissions).
 * UC-B15: Environment variables.
 */

import type { DeepLayer } from "./deep.js";
import type {
  VolumeInfo,
  PartitionInfo,
  PermissionInfo,
  UserInfo,
  GroupInfo,
} from "./deep-os-types.js";

// ------------------------------------------------------------------
// UC-B14: Partition/Volume Management
// ------------------------------------------------------------------

export class DeepOSFilesLayer {
  constructor(private readonly deep: DeepLayer) {}

  /**
   * List all mounted volumes with usage statistics.
   * Uses `df` on macOS/Linux.
   */
  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const { stdout } = await this.deep.execAsync(
        `df -k --output=source,fstype,target,size,used,avail 2>/dev/null || df -k 2>/dev/null`
      );
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          // Handle both GNU df (with --output) and BSD df
          const [device, fsType, , sizeKb, usedKb, availKb, , mountPoint] =
            parts.length >= 7
              ? parts
              : [parts[0], "", "", parts[1], parts[2], parts[3], parts[4], parts[5]];
          return {
            name: (mountPoint ?? device ?? "").split("/").pop() ?? "",
            device: device ?? "",
            mountPoint: mountPoint ?? parts[parts.length - 1] ?? "",
            fsType: fsType ?? "",
            totalBytes: parseInt(sizeKb ?? "0", 10) * 1024,
            usedBytes: parseInt(usedKb ?? "0", 10) * 1024,
            availableBytes: parseInt(availKb ?? "0", 10) * 1024,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Mount a device to the specified mount point.
   * On macOS, uses `diskutil mount`; on Linux uses `mount`.
   */
  async mountVolume(device: string, mountPoint: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(
          `diskutil mount -mountPoint "${mountPoint}" "${device}"`
        );
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`mount "${device}" "${mountPoint}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Unmount a volume by its mount point.
   * On macOS, uses `diskutil unmount`; on Linux uses `umount`.
   */
  async unmountVolume(mountPoint: string): Promise<boolean> {
    try {
      if (this.deep.platform === "macos") {
        await this.deep.execAsync(`diskutil unmount "${mountPoint}"`);
        return true;
      }
      if (this.deep.platform === "linux") {
        await this.deep.execAsync(`umount "${mountPoint}"`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * List partitions on a disk device.
   * On macOS uses `diskutil list -plist`; on Linux uses `lsblk -J`.
   */
  async getDiskPartitions(device: string): Promise<PartitionInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `diskutil list "${device}" 2>/dev/null`
        );
        const lines = stdout.split("\n").filter((l) => /^\s+\d+:/.test(l));
        return lines.map((line) => {
          const match = line.match(/\s+(\d+):\s+(\S+)\s+(.*?)\s+(\d+\.\d+\s+\S+)\s+(\S+)/);
          if (!match) return { device, index: 0, name: null, type: "", startSector: null, sizeMB: null };
          const sizePart = match[4]?.trim();
          const sizeMB = sizePart
            ? parseFloat(sizePart) * (sizePart.includes("GB") ? 1024 : 1)
            : null;
          return {
            device: match[5] ?? device,
            index: parseInt(match[1], 10),
            name: match[3]?.trim() || null,
            type: match[2] ?? "",
            startSector: null,
            sizeMB,
          };
        });
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `lsblk -b -o NAME,FSTYPE,SIZE,TYPE "${device}" --noheadings 2>/dev/null`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line, i) => {
            const parts = line.trim().split(/\s+/);
            const sizeB = parseInt(parts[2] ?? "0", 10);
            return {
              device: `/dev/${parts[0]}`,
              index: i,
              name: parts[0] ?? null,
              type: parts[1] ?? "",
              startSector: null,
              sizeMB: Math.round(sizeB / 1024 / 1024),
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  // ================================================================
  // UC-B13: User/Group/ACL Management
  // ================================================================

  /**
   * List all local user accounts on the system.
   */
  async listUsers(): Promise<UserInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `dscl . list /Users | grep -v '^_' 2>/dev/null`
        );
        const usernames = stdout.trim().split("\n").filter(Boolean);
        const users = await Promise.all(
          usernames.map((u) => this._getMacUser(u))
        );
        return users.filter((u): u is UserInfo => u !== null);
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `getent passwd 2>/dev/null | head -100`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [username, , uidStr, , fullName, home, shell] =
              line.split(":");
            return {
              uid: parseInt(uidStr ?? "0", 10),
              username,
              fullName: fullName || null,
              shell: shell?.trim() ?? "",
              home: home ?? "",
              groups: [],
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Internal helper: fetch a single macOS user record via dscl. */
  private async _getMacUser(username: string): Promise<UserInfo | null> {
    try {
      const { stdout } = await this.deep.execAsync(
        `dscl . read /Users/${username} UniqueID RealName UserShell NFSHomeDirectory 2>/dev/null`
      );
      const get = (key: string): string | null => {
        const m = stdout.match(new RegExp(`${key}:\\s*(.+)`));
        return m ? m[1].trim() : null;
      };
      const uid = parseInt(get("UniqueID") ?? "0", 10);
      const { stdout: groups } = await this.deep.execAsync(
        `id -Gn "${username}" 2>/dev/null`
      ).catch(() => ({ stdout: "" }));
      return {
        uid,
        username,
        fullName: get("RealName"),
        shell: get("UserShell") ?? "",
        home: get("NFSHomeDirectory") ?? "",
        groups: groups.trim().split(" ").filter(Boolean),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get information about the currently logged-in user.
   */
  async getCurrentUser(): Promise<UserInfo> {
    const username = process.env.USER ?? process.env.LOGNAME ?? "unknown";
    const { stdout: uidStr } = await this.deep.execAsync(`id -u 2>/dev/null`).catch(
      () => ({ stdout: "0" })
    );
    const { stdout: groups } = await this.deep.execAsync(`id -Gn 2>/dev/null`).catch(
      () => ({ stdout: "" })
    );
    return {
      uid: parseInt(uidStr.trim(), 10),
      username,
      fullName: null,
      shell: process.env.SHELL ?? "",
      home: process.env.HOME ?? "",
      groups: groups.trim().split(" ").filter(Boolean),
    };
  }

  /**
   * List local groups on the system.
   */
  async listGroups(): Promise<GroupInfo[]> {
    try {
      if (this.deep.platform === "macos") {
        const { stdout } = await this.deep.execAsync(
          `dscl . list /Groups 2>/dev/null | head -100`
        );
        const names = stdout.trim().split("\n").filter(Boolean);
        const results = await Promise.all(
          names.map(async (name) => {
            try {
              const { stdout: gidOut } = await this.deep.execAsync(
                `dscl . read /Groups/${name} PrimaryGroupID GroupMembership 2>/dev/null`
              );
              const gidMatch = gidOut.match(/PrimaryGroupID:\s*(\d+)/);
              const memberMatch = gidOut.match(/GroupMembership:\s*(.+)/);
              return {
                gid: gidMatch ? parseInt(gidMatch[1], 10) : 0,
                name,
                members: memberMatch ? memberMatch[1].trim().split(" ") : [],
              };
            } catch {
              return { gid: 0, name, members: [] };
            }
          })
        );
        return results;
      }
      if (this.deep.platform === "linux") {
        const { stdout } = await this.deep.execAsync(
          `getent group 2>/dev/null | head -100`
        );
        return stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [name, , gidStr, membersStr] = line.split(":");
            return {
              gid: parseInt(gidStr ?? "0", 10),
              name,
              members: membersStr ? membersStr.split(",").filter(Boolean) : [],
            };
          });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get POSIX permission information for a file or directory.
   */
  async getFilePermissions(path: string): Promise<PermissionInfo> {
    try {
      await this.deep.execAsync(
        `ls -la "${path}" 2>/dev/null | head -1`
      );
      const { stdout: statOut } = await this.deep.execAsync(
        this.deep.platform === "macos"
          ? `stat -f "%Sp %Su %Sg" "${path}" 2>/dev/null`
          : `stat -c "%A %U %G" "${path}" 2>/dev/null`
      );
      const parts = statOut.trim().split(" ");
      const mode = parts[0] ?? "";
      const owner = parts[1] ?? "";
      const group = parts[2] ?? "";

      // Derive octal from symbolic mode
      const octal = this._symbolicToOctal(mode);

      return {
        path,
        mode,
        octal,
        owner,
        group,
        readable: mode.includes("r"),
        writable: mode.includes("w"),
        executable: mode.includes("x"),
      };
    } catch {
      return {
        path,
        mode: "----------",
        octal: "0000",
        owner: "",
        group: "",
        readable: false,
        writable: false,
        executable: false,
      };
    }
  }

  /** Convert symbolic permission string (e.g. -rwxr-xr-x) to octal string. */
  private _symbolicToOctal(mode: string): string {
    const chars = mode.slice(1); // strip leading type char
    let octal = 0;
    const map: Record<string, number> = { r: 4, w: 2, x: 1, s: 1, S: 0, t: 1, T: 0 };
    for (let i = 0; i < 9; i++) {
      const c = chars[i];
      if (c && c !== "-") {
        const shift = 6 - Math.floor(i / 3) * 3;
        octal += (map[c] ?? 0) * (i % 3 === 0 ? 1 : 1);
        void shift; // future: could compose proper octal
      }
    }
    // Simple 3-group approach
    const bits = (grp: string): number =>
      (grp[0] !== "-" ? 4 : 0) + (grp[1] !== "-" ? 2 : 0) + (grp[2] !== "-" && grp[2] !== "T" && grp[2] !== "S" ? 1 : 0);
    if (chars.length >= 9) {
      return `0${bits(chars.slice(0, 3))}${bits(chars.slice(3, 6))}${bits(chars.slice(6, 9))}`;
    }
    return "0000";
  }

  /**
   * Change the POSIX mode of a file or directory.
   * `mode` should be a chmod-compatible string, e.g. "755" or "u+x".
   */
  async setFilePermissions(path: string, mode: string): Promise<boolean> {
    try {
      await this.deep.execAsync(`chmod "${mode}" "${path}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Change the owner (and optionally group) of a file or directory.
   */
  async setFileOwner(
    path: string,
    owner: string,
    group?: string
  ): Promise<boolean> {
    try {
      const spec = group ? `${owner}:${group}` : owner;
      await this.deep.execAsync(`chown "${spec}" "${path}"`);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================
  // UC-B15: Environment Variables
  // ================================================================

  /**
   * Get the value of an environment variable from the current process.
   */
  async getEnvVar(name: string): Promise<string | undefined> {
    return process.env[name];
  }

  /**
   * Set an environment variable in the current process.
   * If `persist` is true, also appends an export to the detected shell profile.
   */
  async setEnvVar(
    name: string,
    value: string,
    persist: boolean = false
  ): Promise<boolean> {
    try {
      process.env[name] = value;
      if (persist) {
        const profile = await this.getShellProfile();
        const { appendFileSync } = await import("node:fs");
        appendFileSync(profile, `\nexport ${name}="${value}"\n`);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unset an environment variable in the current process.
   * If `persist` is true, removes the export line from the shell profile.
   */
  async unsetEnvVar(name: string, persist: boolean = false): Promise<boolean> {
    try {
      delete process.env[name];
      if (persist) {
        const profile = await this.getShellProfile();
        const { readFileSync, writeFileSync } = await import("node:fs");
        const content = readFileSync(profile, "utf-8");
        const filtered = content
          .split("\n")
          .filter((l) => !l.match(new RegExp(`export\\s+${name}=`)))
          .join("\n");
        writeFileSync(profile, filtered);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return a snapshot of all environment variables in the current process.
   */
  async listEnvVars(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  /**
   * Detect the shell profile file path for the current user.
   * Checks SHELL env, then falls back to common defaults.
   */
  async getShellProfile(): Promise<string> {
    const home = process.env.HOME ?? "~";
    const shell = process.env.SHELL ?? "";
    if (shell.includes("zsh")) return `${home}/.zshrc`;
    if (shell.includes("bash")) {
      // macOS uses .bash_profile; Linux uses .bashrc
      return this.deep.platform === "macos"
        ? `${home}/.bash_profile`
        : `${home}/.bashrc`;
    }
    if (shell.includes("fish")) return `${home}/.config/fish/config.fish`;
    // Default fallback
    return `${home}/.profile`;
  }
}
