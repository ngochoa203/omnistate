/**
 * Docker & Container Tools — Group 37
 * Implements: Docker operations, image management, container control, compose
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Docker Status & Info
// ------------------------------------------------------------------

export interface DockerStatus {
  running: boolean;
  version: string;
  containers: number;
  images: number;
  volumes: number;
}

export async function getDockerStatus(): Promise<DockerStatus> {
  try {
    const { stdout: version } = await execAsync("docker version --format '{{.Server.Version}}' 2>/dev/null || echo ''", { encoding: "utf-8" });
    const { stdout: containers } = await execAsync("docker ps -q 2>/dev/null | wc -l", { encoding: "utf-8" });
    const { stdout: images } = await execAsync("docker images -q 2>/dev/null | wc -l", { encoding: "utf-8" });
    const { stdout: volumes } = await execAsync("docker volume ls -q 2>/dev/null | wc -l", { encoding: "utf-8" });
    
    return {
      running: version.length > 0,
      version: version.trim(),
      containers: parseInt(containers.trim(), 10),
      images: parseInt(images.trim(), 10),
      volumes: parseInt(volumes.trim(), 10)
    };
  } catch {
    return { running: false, version: "", containers: 0, images: 0, volumes: 0 };
  }
}

export async function isDockerRunning(): Promise<boolean> {
  const status = await getDockerStatus();
  return status.running;
}

// ------------------------------------------------------------------
// Container Operations
// ------------------------------------------------------------------

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
}

export async function listContainers(all: boolean = true): Promise<ContainerInfo[]> {
  try {
    const flag = all ? "-a" : "";
    const { stdout } = await execAsync(`docker ps ${flag} --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.CreatedAt}}"`, { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const [id, name, image, status, ports, created] = line.split("|");
      return { id, name, image, status, ports, created };
    });
  } catch {
    return [];
  }
}

export async function startContainer(nameOrId: string): Promise<boolean> {
  try {
    await execAsync(`docker start ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

export async function stopContainer(nameOrId: string): Promise<boolean> {
  try {
    await execAsync(`docker stop ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

export async function restartContainer(nameOrId: string): Promise<boolean> {
  try {
    await execAsync(`docker restart ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

export async function removeContainer(nameOrId: string, force: boolean = false): Promise<boolean> {
  try {
    const flag = force ? "-f" : "";
    await execAsync(`docker rm ${flag} ${nameOrId}`);
    return true;
  } catch {
    return false;
  }
}

export async function getContainerLogs(nameOrId: string, lines: number = 50): Promise<string> {
  try {
    const { stdout } = await execAsync(`docker logs ${nameOrId} --tail ${lines}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export async function execInContainer(nameOrId: string, command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`docker exec ${nameOrId} ${command}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Image Operations
// ------------------------------------------------------------------

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export async function listImages(): Promise<ImageInfo[]> {
  try {
    const { stdout } = await execAsync("docker images --format '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedAt}}'", { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const [id, repository, tag, size, created] = line.split("|");
      return { id, repository, tag, size, created };
    });
  } catch {
    return [];
  }
}

export async function pullImage(imageName: string): Promise<boolean> {
  try {
    await execAsync(`docker pull ${imageName}`);
    return true;
  } catch {
    return false;
  }
}

export async function removeImage(imageId: string, force: boolean = false): Promise<boolean> {
  try {
    const flag = force ? "-f" : "";
    await execAsync(`docker rmi ${flag} ${imageId}`);
    return true;
  } catch {
    return false;
  }
}

export async function buildImage(dockerfilePath: string, tag: string): Promise<boolean> {
  try {
    await execAsync(`docker build -t ${tag} -f ${dockerfilePath} .`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Docker Compose
// ------------------------------------------------------------------

export async function composeUp(services?: string[], detached: boolean = true): Promise<boolean> {
  try {
    const servicesStr = services?.join(" ") || "";
    const flag = detached ? "-d" : "";
    await execAsync(`docker-compose up ${flag} ${servicesStr}`);
    return true;
  } catch {
    return false;
  }
}

export async function composeDown(removeVolumes: boolean = false): Promise<boolean> {
  try {
    const flag = removeVolumes ? "-v" : "";
    await execAsync(`docker-compose down ${flag}`);
    return true;
  } catch {
    return false;
  }
}

export async function composeRestart(services?: string[]): Promise<boolean> {
  try {
    const servicesStr = services?.join(" ") || "";
    await execAsync(`docker-compose restart ${servicesStr}`);
    return true;
  } catch {
    return false;
  }
}

export async function composeLogs(services?: string[], lines: number = 50): Promise<string> {
  try {
    const servicesStr = services?.join(" ") || "";
    const { stdout } = await execAsync(`docker-compose logs --tail=${lines} ${servicesStr}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Volume & Network
// ------------------------------------------------------------------

export async function listVolumes(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("docker volume ls --format '{{.Name}}'", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(v => v.trim());
  } catch {
    return [];
  }
}

export async function removeVolume(volumeName: string): Promise<boolean> {
  try {
    await execAsync(`docker volume rm ${volumeName}`);
    return true;
  } catch {
    return false;
  }
}

export async function listNetworks(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("docker network ls --format '{{.Name}}'", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(n => n.trim());
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Quick Container Launch
// ------------------------------------------------------------------

export async function runNginx(port: number = 80): Promise<boolean> {
  try {
    await execAsync(`docker run -d -p ${port}:80 --name nginx-${port} nginx`);
    return true;
  } catch {
    return false;
  }
}

export async function runPostgres(password: string, port: number = 5432): Promise<boolean> {
  try {
    await execAsync(`docker run -d -p ${port}:5432 -e POSTGRES_PASSWORD=${password} --name postgres-${port} postgres`);
    return true;
  } catch {
    return false;
  }
}

export async function runRedis(port: number = 6379): Promise<boolean> {
  try {
    await execAsync(`docker run -d -p ${port}:6379 --name redis-${port} redis`);
    return true;
  } catch {
    return false;
  }
}

export async function runMongo(port: number = 27017): Promise<boolean> {
  try {
    await execAsync(`docker run -d -p ${port}:27017 --name mongo-${port} mongo`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// System Prune
// ------------------------------------------------------------------

export async function pruneAll(removeVolumes: boolean = false): Promise<boolean> {
  try {
    const flag = removeVolumes ? "-v" : "";
    await execAsync(`docker system prune -a ${flag} --filter "until=24h"`);
    return true;
  } catch {
    return false;
  }
}

export class DockerLayer {
  status = getDockerStatus;
  isRunning = isDockerRunning;
  
  listContainers = listContainers;
  startContainer = startContainer;
  stopContainer = stopContainer;
  restartContainer = restartContainer;
  removeContainer = removeContainer;
  logs = getContainerLogs;
  exec = execInContainer;
  
  listImages = listImages;
  pullImage = pullImage;
  removeImage = removeImage;
  buildImage = buildImage;
  
  composeUp = composeUp;
  composeDown = composeDown;
  composeRestart = composeRestart;
  composeLogs = composeLogs;
  
  listVolumes = listVolumes;
  removeVolume = removeVolume;
  listNetworks = listNetworks;
  
  runNginx = runNginx;
  runPostgres = runPostgres;
  runRedis = runRedis;
  runMongo = runMongo;
  
  prune = pruneAll;
}
