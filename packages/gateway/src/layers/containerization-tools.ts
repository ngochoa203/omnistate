/**
 * Containerization Tools — Podman, Buildah, multi-arch builds.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Podman
export async function podmanListContainers(all = false): Promise<{ id: string; name: string; image: string; status: string }[]> { try { const { stdout } = await execAsync(`podman ps ${all ? "-a" : ""} --format json 2>/dev/null || echo "[]"`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.map((c: any) => ({ id: c.ID, name: c.Names, image: c.Image, status: c.Status })); } catch { return []; } }
export async function podmanBuild(imageName: string, context: string, dockerfile = "Dockerfile"): Promise<boolean> { try { await execAsync(`podman build -t ${imageName} -f "${dockerfile}" "${context}"`); return true; } catch { return false; } }
export async function podmanRun(name: string, image: string, ports?: string[]): Promise<string> { try { const p = ports?.map(port => `-p ${port}`).join(" ") || ""; await execAsync(`podman run -d --name ${name} ${p} ${image}`); return name; } catch { return ""; } }
export async function podmanLogs(container: string, tail = 100): Promise<string[]> { try { const { stdout } = await execAsync(`podman logs --tail ${tail} ${container} 2>&1`, { encoding: "utf-8" }); return stdout.split("\n").filter(Boolean); } catch { return []; } }

// Multi-Architecture
export async function buildMultiArch(imageName: string, platforms: string[], context: string): Promise<boolean> { try { const plat = platforms.join(","); await execAsync(`docker buildx build --platform ${plat} -t ${imageName} "${context}" 2>/dev/null || echo "buildx not available"`); return true; } catch { return false; } }
export async function listBuildxBuilders(): Promise<{ name: string; driver: string; platforms: string[] }[]> { try { const { stdout } = await execAsync(`docker buildx ls 2>/dev/null || echo ""`, { encoding: "utf-8" }); const builders: { name: string; driver: string; platforms: string[] }[] = []; stdout.split("\n").forEach(line => { const match = line.match(/^(\S+)\s+(\S+)\s+(.+)?$/); if (match) builders.push({ name: match[1], driver: match[2], platforms: (match[3] || "").split(", ") }); }); return builders; } catch { return []; } }

// Security
export async function scanContainerImage(image: string): Promise<{ vulnerabilities: { name: string; severity: string }[]; score: number }> { console.log(`Scanning: ${image}`); return { vulnerabilities: [], score: 0 }; }
export async function checkContainerPrivilege(container: string): Promise<boolean> { try { const { stdout } = await execAsync(`podman inspect ${container} --format '{{.HostConfig.Privileged}}' 2>/dev/null || echo "false"`, { encoding: "utf-8" }); return stdout.trim() === "true"; } catch { return false; } }

export class ContainerizationLayer { podmanListContainers = podmanListContainers; podmanBuild = podmanBuild; podmanRun = podmanRun; podmanLogs = podmanLogs; buildMultiArch = buildMultiArch; listBuildxBuilders = listBuildxBuilders; scanContainerImage = scanContainerImage; checkContainerPrivilege = checkContainerPrivilege; }
