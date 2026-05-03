/**
 * Deep System Layer — Certificate/Key (UC-B22), Firewall (UC-B23), Container/VM (UC-B24).
 *
 * macOS-first; Linux fallbacks where reasonable.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import type { DeepLayer } from "./deep.js";
import type { CertificateInfo, SSHKeyInfo, GPGKeyInfo, FirewallRule, ContainerInfo, ImageInfo, VMInfo } from "./deep-system-types.js";
import { execAsync } from "./deep-system-types.js";

abstract class DeepSystemFirewallCore {
  constructor(protected readonly deep: DeepLayer) {}

  protected get os(): "macos" | "windows" | "linux" {
    switch (platform()) {
      case "darwin":
        return "macos";
      case "win32":
        return "windows";
      default:
        return "linux";
    }
  }

  protected async run(cmd: string, timeoutMs = 30_000): Promise<string> {
    try {
      const { stdout } = await execAsync(cmd, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

export class DeepSystemFirewallLayer extends DeepSystemFirewallCore {
  // =========================================================================
  // UC-B22 — Certificate / Key Management
  // =========================================================================

  /**
   * List certificates in a macOS keychain (default: login).
   */
  async listCertificates(keychain = "login"): Promise<CertificateInfo[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run(
        `security find-certificate -a "${keychain}.keychain-db" 2>/dev/null | grep 'labl' | head -100`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const name = l.replace(/.*"labl"<blob>="?/, "").replace(/"?\s*$/, "").trim();
          return { name, keychain };
        });
    } catch {
      return [];
    }
  }

  /**
   * Install a certificate as trusted in a macOS keychain.
   */
  async installCertificate(path: string, keychain = "login"): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `sudo security add-trusted-cert -d -r trustRoot -k "/Library/Keychains/${keychain}.keychain-db" "${path}"`,
        { timeout: 15_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a certificate by common name from a macOS keychain.
   */
  async removeCertificate(name: string, keychain = "login"): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      await execAsync(
        `security delete-certificate -c "${name}" "${keychain}.keychain-db" 2>/dev/null`,
        { timeout: 5_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List SSH public key files from `~/.ssh/`.
   */
  listSSHKeys(): SSHKeyInfo[] {
    try {
      const sshDir = join(homedir(), ".ssh");
      if (!existsSync(sshDir)) return [];
      return readdirSync(sshDir)
        .filter((f) => f.endsWith(".pub"))
        .map((f) => {
          const fullPath = join(sshDir, f);
          const content = readFileSync(fullPath, "utf-8").trim();
          const parts = content.split(/\s+/);
          return {
            file: fullPath,
            type: parts[0] ?? "unknown",
            comment: parts[2],
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Generate a new SSH key pair.
   *
   * @param type    Key type: "ed25519" | "rsa" | "ecdsa" (default "ed25519").
   * @param comment Comment embedded in the public key.
   */
  async generateSSHKey(type = "ed25519", comment = ""): Promise<boolean> {
    try {
      const keyPath = join(homedir(), ".ssh", `id_${type}`);
      await execAsync(
        `ssh-keygen -t ${type} -C "${comment}" -f "${keyPath}" -N "" 2>/dev/null`,
        { timeout: 15_000 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List GPG public keys (requires `gpg` in PATH).
   */
  async listGPGKeys(): Promise<GPGKeyInfo[]> {
    try {
      const out = await this.run("gpg --list-keys --with-colons 2>/dev/null");
      const keys: GPGKeyInfo[] = [];
      const lines = out.split("\n");
      let current: Partial<GPGKeyInfo> = {};
      for (const line of lines) {
        const parts = line.split(":");
        if (parts[0] === "pub") {
          current = { keyId: parts[4] ?? "", expiry: parts[6] };
        } else if (parts[0] === "uid" && current.keyId) {
          keys.push({
            keyId: current.keyId,
            uid: parts[9] ?? "",
            expiry: current.expiry,
          });
          current = {};
        }
      }
      return keys;
    } catch {
      return [];
    }
  }

  // =========================================================================
  // UC-B23 — Advanced Firewall (macOS pf)
  // =========================================================================

  /**
   * Get the active pf firewall rules (`pfctl -sr`).
   */
  async getFirewallRules(): Promise<FirewallRule[]> {
    try {
      if (this.os !== "macos") return [];
      const out = await this.run("sudo pfctl -sr 2>/dev/null");
      return out
        .split("\n")
        .filter(Boolean)
        .map((raw, i) => ({ id: String(i), raw }));
    } catch {
      return [];
    }
  }

  /**
   * Append a pf rule to `/etc/pf.conf` and reload pf (macOS).
   */
  async addFirewallRule(rule: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      const current = existsSync(pfConf) ? readFileSync(pfConf, "utf-8") : "";
      writeFileSync(pfConf, `${current.trimEnd()}\n${rule}\n`, "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a pf rule by its index (from `getFirewallRules`) and reload.
   */
  async removeFirewallRule(ruleId: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      if (!existsSync(pfConf)) return false;
      const lines = readFileSync(pfConf, "utf-8").split("\n");
      const idx = parseInt(ruleId, 10);
      if (isNaN(idx) || idx < 0 || idx >= lines.length) return false;
      lines.splice(idx, 1);
      writeFileSync(pfConf, lines.join("\n"), "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Block all traffic from a specific IP address.
   */
  async blockIP(ip: string): Promise<boolean> {
    return this.addFirewallRule(`block drop quick from ${ip} to any`);
  }

  /**
   * Remove the block rule for a specific IP address.
   */
  async unblockIP(ip: string): Promise<boolean> {
    try {
      if (this.os !== "macos") return false;
      const pfConf = "/etc/pf.conf";
      if (!existsSync(pfConf)) return false;
      let content = readFileSync(pfConf, "utf-8");
      content = content.replace(
        new RegExp(`block drop quick from ${ip.replace(/\./g, "\\.")} to any\\n?`, "g"),
        ""
      );
      writeFileSync(pfConf, content, "utf-8");
      await execAsync("sudo pfctl -f /etc/pf.conf", { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Block a port on a given protocol (tcp | udp).
   */
  async blockPort(port: number, protocol: "tcp" | "udp" = "tcp"): Promise<boolean> {
    return this.addFirewallRule(
      `block drop quick proto ${protocol} from any to any port ${port}`
    );
  }

  /**
   * Allow a port on a given protocol (tcp | udp).
   */
  async allowPort(port: number, protocol: "tcp" | "udp" = "tcp"): Promise<boolean> {
    return this.addFirewallRule(
      `pass in quick proto ${protocol} from any to any port ${port}`
    );
  }

  // =========================================================================
  // UC-B24 — Container / VM Lifecycle
  // =========================================================================

  /**
   * Check whether the Docker daemon is running.
   */
  async isDockerRunning(): Promise<boolean> {
    const out = await this.run("docker info 2>&1 | head -5");
    return out.length > 0 && !out.includes("Cannot connect");
  }

  /**
   * List Docker containers.
   *
   * @param all  When true, include stopped containers (`docker ps -a`).
   */
  async listContainers(all = false): Promise<ContainerInfo[]> {
    try {
      const flag = all ? "-a" : "";
      const out = await this.run(
        `docker ps ${flag} --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [id, name, image, status, ports] = line.split("\t");
          return { id: id ?? "", name: name ?? "", image: image ?? "", status: status ?? "", ports: ports ?? "" };
        });
    } catch {
      return [];
    }
  }

  /** Start a Docker container by ID or name. */
  async startContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker start "${id}"`, { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Stop a Docker container by ID or name. */
  async stopContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker stop "${id}"`, { timeout: 30_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a Docker container by ID or name. */
  async removeContainer(id: string): Promise<boolean> {
    try {
      await execAsync(`docker rm "${id}"`, { timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the tail of container logs.
   *
   * @param id    Container ID or name.
   * @param tail  Number of lines to return.
   */
  async getContainerLogs(id: string, tail = 100): Promise<string[]> {
    try {
      const out = await this.run(`docker logs --tail ${tail} "${id}" 2>&1`);
      return out.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * List Docker images.
   */
  async listImages(): Promise<ImageInfo[]> {
    try {
      const out = await this.run(
        `docker images --format "{{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedAt}}" 2>/dev/null`
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [repository, tag, id, size, created] = line.split("\t");
          return {
            repository: repository ?? "",
            tag: tag ?? "",
            id: id ?? "",
            size: size ?? "",
            created: created ?? "",
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Pull a Docker image by name (e.g. "nginx:latest").
   */
  async pullImage(name: string): Promise<boolean> {
    try {
      await execAsync(`docker pull "${name}"`, { timeout: 120_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List VirtualBox VMs (falls back to listing UTM VMs on macOS if VBoxManage absent).
   */
  async listVMs(): Promise<VMInfo[]> {
    try {
      const vbox = await this.run(
        `VBoxManage list vms 2>/dev/null`
      );
      if (vbox) {
        const running = await this.run("VBoxManage list runningvms 2>/dev/null");
        return vbox
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            const m = l.match(/"(.+)"\s+\{(.+)\}/);
            const name = m?.[1] ?? l;
            const uuid = m?.[2];
            return { name, uuid, state: running.includes(name) ? "running" : "stopped" };
          });
      }
      // UTM fallback (macOS)
      if (this.os === "macos") {
        const utmOut = await this.run(
          `osascript -e 'tell application "UTM" to get name of every virtual machine' 2>/dev/null`
        );
        return utmOut
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name, state: "unknown" }));
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Start a VirtualBox VM by name.
   */
  async startVM(name: string): Promise<boolean> {
    try {
      await execAsync(`VBoxManage startvm "${name}" --type headless`, {
        timeout: 30_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Power off a VirtualBox VM by name.
   */
  async stopVM(name: string): Promise<boolean> {
    try {
      await execAsync(`VBoxManage controlvm "${name}" poweroff`, {
        timeout: 15_000,
      });
      return true;
    } catch {
      return false;
    }
  }
}