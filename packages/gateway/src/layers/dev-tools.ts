/**
 * Dev Environment & Terminal Tools — Group 5
 * Implements 5 development workflow operations.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// UC1: Ping Command
// ------------------------------------------------------------------

export interface PingResult {
  host: string;
  success: boolean;
  time?: number;
  avgTime?: number;
  packetLoss?: number;
}

export async function pingHost(host: string, count: number = 4): Promise<PingResult> {
  try {
    const { stdout } = await execAsync(`ping -c ${count} "${host}"`, { encoding: "utf-8" });
    
    const timeMatch = stdout.match(/time[=<](\d+\.?\d*)/);
    const avgMatch = stdout.match(/average[=](\d+\.?\d*)/);
    const lossMatch = stdout.match(/(\d+)% packet loss/);
    
    return {
      host,
      success: true,
      time: timeMatch ? parseFloat(timeMatch[1]!) : undefined,
      avgTime: avgMatch ? parseFloat(avgMatch[1]!) : undefined,
      packetLoss: lossMatch ? parseInt(lossMatch[1]!, 10) : 0
    };
  } catch (e) {
    console.error("pingHost failed:", e);
    return { host, success: false };
  }
}

export async function pingGoogle(): Promise<PingResult> {
  return pingHost("google.com");
}

// ------------------------------------------------------------------
// UC2: Open VS Code with Project
// ------------------------------------------------------------------

export async function openVSCode(folderPath?: string): Promise<boolean> {
  try {
    if (folderPath) {
      await execAsync(`code "${folderPath}"`);
    } else {
      await execAsync(`code`);
    }
    return true;
  } catch (e) {
    console.error("openVSCode failed:", e);
    return false;
  }
}

export async function openVSCodeWithOmniState(): Promise<boolean> {
  const omniStatePath = "/Users/hoahn/Projects/omnistate";
  return openVSCode(omniStatePath);
}

export async function openVSCodeFocusProject(projectName: string): Promise<boolean> {
  const projectPath = path.join(os.homedir(), "Projects", projectName);
  return openVSCode(projectPath);
}

// ------------------------------------------------------------------
// UC3: Run Build Command
// ------------------------------------------------------------------

export interface BuildResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
}

export async function runBuildCommand(
  cwd: string,
  command: string = "npm run build"
): Promise<BuildResult> {
  const startTime = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, encoding: "utf-8" });
    return {
      success: true,
      output: stdout + (stderr ? "\n" + stderr : ""),
      exitCode: 0,
      duration: Date.now() - startTime
    };
  } catch (e: any) {
    return {
      success: false,
      output: e.message || "Build failed",
      exitCode: e.code || 1,
      duration: Date.now() - startTime
    };
  }
}

export async function runNpmBuild(): Promise<BuildResult> {
  const cwd = process.cwd();
  return runBuildCommand(cwd, "npm run build");
}

export async function runCurrentProjectBuild(): Promise<BuildResult> {
  return runBuildCommand(path.join(os.homedir(), "Projects/omnistate"), "npm run build");
}

// ------------------------------------------------------------------
// UC4: Docker Desktop Operations
// ------------------------------------------------------------------

export async function startDockerDesktop(): Promise<boolean> {
  try {
    await execAsync(`open -a "Docker"`);
    await new Promise(r => setTimeout(r, 5000));
    return true;
  } catch (e) {
    console.error("startDockerDesktop failed:", e);
    return false;
  }
}

export async function stopDockerDesktop(): Promise<boolean> {
  try {
    await execAsync(`osascript -e 'tell application "Docker" to quit'`);
    return true;
  } catch (e) {
    console.error("stopDockerDesktop failed:", e);
    return false;
  }
}

export async function isDockerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("docker info 2>&1 | head -5", { encoding: "utf-8" });
    return stdout.includes("Server Version") || stdout.includes("Docker version");
  } catch {
    return false;
  }
}

export async function dockerStatus(): Promise<{ running: boolean; version?: string; containers: number }> {
  try {
    const { stdout: infoOut } = await execAsync("docker info --format '{{.ServerVersion}}'", { encoding: "utf-8" }).catch(() => ({ stdout: "" }));
    const { stdout: psOut } = await execAsync("docker ps -q 2>/dev/null | wc -l", { encoding: "utf-8" }).catch(() => ({ stdout: "0" }));
    
    return {
      running: infoOut.length > 0,
      version: infoOut.trim() || undefined,
      containers: parseInt(psOut.trim(), 10) || 0
    };
  } catch {
    return { running: false, containers: 0 };
  }
}

// ------------------------------------------------------------------
// UC5: Get Local IP & Copy to Clipboard
// ------------------------------------------------------------------

export async function getLocalIP(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null`,
      { encoding: "utf-8" }
    );
    const ip = stdout.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return ip;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getLocalIPWithCopy(): Promise<string | null> {
  const ip = await getLocalIP();
  if (ip) {
    await execAsync(`osascript -e 'set the clipboard to "${ip}"'`);
  }
  return ip;
}

export async function copyLocalIPToClipboard(): Promise<boolean> {
  const result = await getLocalIPWithCopy();
  return result !== null;
}

export async function getAllNetworkInterfaces(): Promise<{ name: string; ip: string }[]> {
  try {
    const { stdout } = await execAsync("ifconfig | grep -E '^[a-z0-9]+:' | awk '{print $1}' | head -10", { encoding: "utf-8" });
    const interfaces = stdout.trim().split("\n").filter(i => i.length > 0);
    
    return Promise.all(interfaces.map(async (name) => {
      try {
        const { stdout: ipOut } = await execAsync(`ipconfig getifaddr ${name}`, { encoding: "utf-8" });
        return { name, ip: ipOut.trim() };
      } catch {
        return { name, ip: "" };
      }
    })).then(results => results.filter(r => r.ip.length > 0));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Layer Export
// ------------------------------------------------------------------

export class DevLayer {
  pingHost = pingHost;
  pingGoogle = pingGoogle;
  openVSCode = openVSCode;
  openVSCodeWithOmniState = openVSCodeWithOmniState;
  openVSCodeFocusProject = openVSCodeFocusProject;
  runBuildCommand = runBuildCommand;
  runNpmBuild = runNpmBuild;
  runCurrentProjectBuild = runCurrentProjectBuild;
  startDockerDesktop = startDockerDesktop;
  stopDockerDesktop = stopDockerDesktop;
  isDockerRunning = isDockerRunning;
  dockerStatus = dockerStatus;
  getLocalIP = getLocalIP;
  getLocalIPWithCopy = getLocalIPWithCopy;
  copyLocalIPToClipboard = copyLocalIPToClipboard;
  getAllNetworkInterfaces = getAllNetworkInterfaces;
}
