/**
 * SSH & Remote Access Tools — Group 49
 * Implements: SSH operations, remote execution, tunneling, SCP
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// SSH Connection
// ------------------------------------------------------------------

export interface SSHConnection {
  host: string;
  user: string;
  port: number;
  keyFile?: string;
}

export async function sshConnect(connection: SSHConnection, command: string): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const portFlag = connection.port !== 22 ? `-p ${connection.port}` : "";
    const keyFlag = connection.keyFile ? `-i ${connection.keyFile}` : "";
    const userHost = `${connection.user}@${connection.host}`;
    
    const { stdout, stderr } = await execAsync(
      `ssh ${portFlag} ${keyFlag} ${userHost} "${command.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", timeout: 60000 }
    );
    
    return { success: true, output: stdout, error: stderr || undefined };
  } catch (e: any) {
    return { success: false, output: "", error: e.message };
  }
}

// ------------------------------------------------------------------
// SSH Key Management
// ------------------------------------------------------------------

export async function generateSSHKey(
  name: string,
  type: "rsa" | "ed25519" | "ecdsa" = "ed25519",
  passphrase?: string
): Promise<{ publicKey: string; privateKeyPath: string }> {
  try {
    const keyPath = `~/.ssh/${name}`;
    const typeFlag = type === "ed25519" ? "-t ed25519" : type === "ecdsa" ? "-t ecdsa" : "-t rsa";
    const passFlag = passphrase ? `-P "${passphrase}"` : "";
    
    await execAsync(`ssh-keygen ${typeFlag} -f ${keyPath} -N "" ${passFlag}`);
    
    const privateKeyPath = keyPath.replace("~", process.env.HOME || "");
    const { stdout } = await execAsync(`cat ${privateKeyPath}.pub`, { encoding: "utf-8" });
    
    return { publicKey: stdout.trim(), privateKeyPath };
  } catch {
    return { publicKey: "", privateKeyPath: "" };
  }
}

export async function copySSHKey(host: string, user: string, port: number = 22): Promise<boolean> {
  try {
    await execAsync(`ssh-copy-id -p ${port} ${user}@${host}`);
    return true;
  } catch {
    return false;
  }
}

export async function listSSHKeys(): Promise<{ name: string; type: string; fingerprint: string }[]> {
  try {
    const { stdout } = await execAsync("ls -la ~/.ssh/ 2>/dev/null | grep -E '^-.*\\.pub$' || echo ''", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const match = line.match(/\.(\w+)\.pub/);
      const nameMatch = line.match(/(\S+\.pub)/);
      
      return {
        name: nameMatch?.[1] || "unknown",
        type: match?.[1] || "rsa",
        fingerprint: ""
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Remote Execution
// ------------------------------------------------------------------

export async function remoteCommand(
  host: string,
  user: string,
  command: string,
  options?: { port?: number; key?: string; password?: string }
): Promise<string> {
  const connection: SSHConnection = {
    host,
    user,
    port: options?.port || 22,
    keyFile: options?.key
  };
  
  const result = await sshConnect(connection, command);
  return result.success ? result.output : result.error || "";
}

export async function remoteExecuteParallel(
  hosts: string[],
  user: string,
  command: string
): Promise<{ host: string; output: string; success: boolean }[]> {
  return Promise.all(hosts.map(async host => {
    const output = await remoteCommand(host, user, command);
    return { host, output, success: output.length > 0 };
  }));
}

// ------------------------------------------------------------------
// SCP File Transfer
// ------------------------------------------------------------------

export async function scpToRemote(
  localFile: string,
  remotePath: string,
  host: string,
  user: string,
  options?: { port?: number; key?: string }
): Promise<boolean> {
  try {
    const portFlag = options?.port ? `-P ${options.port}` : "";
    const keyFlag = options?.key ? `-i ${options.key}` : "";
    
    await execAsync(`scp ${portFlag} ${keyFlag} "${localFile}" ${user}@${host}:${remotePath}`);
    return true;
  } catch {
    return false;
  }
}

export async function scpFromRemote(
  remoteFile: string,
  localPath: string,
  host: string,
  user: string,
  options?: { port?: number; key?: string }
): Promise<boolean> {
  try {
    const portFlag = options?.port ? `-P ${options.port}` : "";
    const keyFlag = options?.key ? `-i ${options.key}` : "";
    
    await execAsync(`scp ${portFlag} ${keyFlag} ${user}@${host}:${remoteFile} "${localPath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function scpDirectory(
  localDir: string,
  remotePath: string,
  host: string,
  user: string
): Promise<boolean> {
  try {
    await execAsync(`scp -r "${localDir}" ${user}@${host}:${remotePath}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// SSH Tunneling
// ------------------------------------------------------------------

export async function createSSHTunnel(
  localPort: number,
  remoteHost: string,
  remotePort: number,
  jumpHost: string,
  jumpUser: string
): Promise<boolean> {
  try {
    // Background tunnel
    await execAsync(`ssh -L ${localPort}:${remoteHost}:${remotePort} -N ${jumpUser}@${jumpHost} &`);
    return true;
  } catch {
    return false;
  }
}

export async function createReverseTunnel(
  localPort: number,
  remotePort: number,
  remoteHost: string,
  user: string
): Promise<boolean> {
  try {
    await execAsync(`ssh -R ${remotePort}:localhost:${localPort} ${user}@${remoteHost} -N &`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// SSH Config
// ------------------------------------------------------------------

export async function addSSHHost(
  name: string,
  host: string,
  user: string,
  options?: { port?: number; key?: string; proxy?: string }
): Promise<boolean> {
  try {
    const sshConfig = process.env.HOME + "/.ssh/config";
    const entry = `
Host ${name}
  HostName ${host}
  User ${user}
  ${options?.port ? `Port ${options.port}` : ""}
  ${options?.key ? `IdentityFile ${options.key}` : ""}
  ${options?.proxy ? `ProxyJump ${options.proxy}` : ""}
`;
    
    await fs.appendFile(sshConfig, entry);
    return true;
  } catch {
    return false;
  }
}

export async function listSSHHosts(): Promise<{ name: string; host: string; user: string }[]> {
  try {
    const sshConfig = process.env.HOME + "/.ssh/config";
    const content = await fs.readFile(sshConfig, "utf-8");
    
    const hosts: { name: string; host: string; user: string }[] = [];
    const hostMatches = content.matchAll(/^Host\s+(\S+)$/gm);
    
    for (const match of hostMatches) {
      const name = match[1]!;
      const hostMatch = content.match(new RegExp(`^Host\\s+${name}[\\s\\S]*?HostName\\s+(\\S+)`, "m"));
      const userMatch = content.match(new RegExp(`^Host\\s+${name}[\\s\\S]*?User\\s+(\\S+)`, "m"));
      
      hosts.push({
        name,
        host: hostMatch?.[1] || "",
        user: userMatch?.[1] || ""
      });
    }
    
    return hosts;
  } catch {
    return [];
  }
}

export class SSHRemoteLayer {
  connect = sshConnect;
  
  generateKey = generateSSHKey;
  copyKey = copySSHKey;
  listKeys = listSSHKeys;
  
  remoteCommand = remoteCommand;
  remoteParallel = remoteExecuteParallel;
  
  scpTo = scpToRemote;
  scpFrom = scpFromRemote;
  scpDir = scpDirectory;
  
  createTunnel = createSSHTunnel;
  reverseTunnel = createReverseTunnel;
  
  addHost = addSSHHost;
  listHosts = listSSHHosts;
}
