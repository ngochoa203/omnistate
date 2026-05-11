/**
 * Docker Advanced Tools — Multi-stage builds, health checks, logging.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const docker = (cmd: string) => execAsync(`docker ${cmd}`, { encoding: "utf-8" });

export async function buildMultiStage(dockerfile: string, target?: string): Promise<boolean> { try { const t = target ? `--target ${target}` : ""; await docker(`build -f "${dockerfile}" ${t} .`); return true; } catch { return false; } }
export async function pruneBuildCache(): Promise<{ reclaimed: number }> { try { await docker("builder prune -f"); return { reclaimed: 0 }; } catch { return { reclaimed: 0 }; } }

export async function checkContainerHealth(containerId: string): Promise<{ status: string }> {
  try {
    const { stdout } = await docker(`inspect --format='{{.State.Health}}' ${containerId}`);
    return { status: stdout.includes("Healthy") ? "healthy" : stdout.includes("Unhealthy") ? "unhealthy" : "starting" };
  } catch { return { status: "unknown" }; }
}

export async function enableHealthCheck(containerId: string, interval = 30): Promise<boolean> { try { await docker(`update --health-cmd="curl -f localhost/" --health-interval=${interval}s ${containerId}`); return true; } catch { return false; } }

export async function getContainerLogs(containerId: string, tail = 100): Promise<string[]> {
  try {
    const { stdout } = await docker(`logs --tail ${tail} ${containerId}`);
    return stdout.split("\n").filter(Boolean);
  } catch { return []; }
}

export async function setContainerResources(containerId: string, options: { memory?: string; cpu?: number }): Promise<boolean> {
  try {
    const mem = options.memory ? `--memory=${options.memory}` : "";
    const cpu = options.cpu ? `--cpus=${options.cpu}` : "";
    await docker(`update ${mem} ${cpu} ${containerId}`);
    return true;
  } catch { return false; }
}

export async function getContainerStats(containerId: string): Promise<{ cpu: number; memory: { used: number; limit: number } }> {
  try {
    const { stdout } = await docker(`stats --no-stream --format "{{.CPUPerc}}" ${containerId}`);
    const cpuMatch = stdout.match(/(\d+\.?\d*)/);
    return { cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0, memory: { used: 0, limit: 0 } };
  } catch { return { cpu: 0, memory: { used: 0, limit: 0 } }; }
}

export async function createDockerNetwork(name: string, driver = "bridge"): Promise<boolean> { try { await docker(`network create --driver=${driver} ${name}`); return true; } catch { return false; } }
export async function connectContainerToNetwork(containerId: string, networkName: string): Promise<boolean> { try { await docker(`network connect ${networkName} ${containerId}`); return true; } catch { return false; } }
export async function disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<boolean> { try { await docker(`network disconnect ${networkName} ${containerId}`); return true; } catch { return false; } }

export async function listContainerNetworks(containerId: string): Promise<string[]> {
  try {
    const { stdout } = await docker(`inspect --format='{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' ${containerId}`);
    return stdout.split(" ").filter(Boolean);
  } catch { return []; }
}

export async function createVolume(name: string, driver = "local"): Promise<boolean> { try { await docker(`volume create --name=${name} --driver=${driver}`); return true; } catch { return false; } }
export async function pruneVolumes(): Promise<{ reclaimed: number }> { try { await docker("volume prune -f"); return { reclaimed: 0 }; } catch { return { reclaimed: 0 }; } }

export class DockerAdvancedLayer {
  buildMultiStage = buildMultiStage; pruneBuildCache = pruneBuildCache;
  checkContainerHealth = checkContainerHealth; enableHealthCheck = enableHealthCheck;
  getContainerLogs = getContainerLogs;
  setContainerResources = setContainerResources; getContainerStats = getContainerStats;
  createDockerNetwork = createDockerNetwork; connectContainerToNetwork = connectContainerToNetwork; disconnectContainerFromNetwork = disconnectContainerFromNetwork; listContainerNetworks = listContainerNetworks;
  createVolume = createVolume; pruneVolumes = pruneVolumes;
}
