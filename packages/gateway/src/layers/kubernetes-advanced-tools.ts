/**
 * Kubernetes Advanced Tools — Helm, ingress, service mesh.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const kubectl = (cmd: string) => execAsync(`kubectl ${cmd}`, { encoding: "utf-8" });
const helm = (cmd: string) => execAsync(`helm ${cmd}`, { encoding: "utf-8" });

// Helm Operations
export async function helmInstall(name: string, chart: string, values?: Record<string, string>): Promise<boolean> { try { const v = values ? Object.entries(values).map(([k, v]) => `--set ${k}=${v}`).join(" ") : ""; await helm(`install ${name} ${chart} ${v}`); return true; } catch { return false; } }
export async function helmUpgrade(name: string, chart: string, values?: Record<string, string>): Promise<boolean> { try { const v = values ? Object.entries(values).map(([k, val]) => `--set ${k}=${val}`).join(" ") : ""; await helm(`upgrade ${name} ${chart} ${v}`); return true; } catch { return false; } }
export async function helmList(): Promise<{ name: string; namespace: string; revision: string; status: string }[]> { try { const { stdout } = await helm("list -o json"); const releases = JSON.parse(stdout); return releases.map((r: any) => ({ name: r.name, namespace: r.namespace, revision: r.revision, status: r.status })); } catch { return []; } }
export async function helmRollback(name: string, revision?: number): Promise<boolean> { try { await helm(`rollback ${name} ${revision ? `--revision ${revision}` : ""}`); return true; } catch { return false; } }
export async function helmSearchRepo(query: string): Promise<{ name: string; version: string }[]> { try { const { stdout } = await helm(`search repo ${query} --output=json`); const results = JSON.parse(stdout); return results.map((r: any) => ({ name: r.name, version: r.version })); } catch { return []; } }

// Ingress Management
export async function listIngresses(namespace = "default"): Promise<{ name: string; hosts: string[]; tls: boolean }[]> {
  try {
    const { stdout } = await kubectl(`get ingress -n ${namespace} -o json`);
    const data = JSON.parse(stdout);
    return data.items.map((item: any) => ({ name: item.metadata.name, hosts: item.spec?.rules?.map((r: any) => r.host) || [], tls: !!item.spec?.tls }));
  } catch { return []; }
}

export async function deleteIngress(name: string, namespace: string): Promise<boolean> { try { await kubectl(`delete ingress ${name} -n ${namespace}`); return true; } catch { return false; } }

// Pod Operations
export async function getPodLogs(podName: string, namespace = "default", container?: string, tail = 100): Promise<string> { try { const c = container ? `-c ${container}` : ""; const { stdout } = await kubectl(`logs ${podName} -n ${namespace} ${c} --tail=${tail}`); return stdout; } catch { return ""; } }
export async function execInPod(podName: string, command: string, namespace = "default"): Promise<string> { try { const { stdout } = await kubectl(`exec ${podName} -n ${namespace} -- ${command}`); return stdout; } catch { return ""; } }
export async function topPods(namespace = "default"): Promise<{ name: string; cpu: string; memory: string }[]> { try { const { stdout } = await kubectl(`top pods -n ${namespace}`); const lines = stdout.split("\n").slice(1); return lines.map(line => { const parts = line.split(/\s+/); return { name: parts[0] || "", cpu: parts[1] || "", memory: parts[2] || "" }; }).filter(p => p.name); } catch { return []; } }

// ConfigMap & Secret Operations
export async function createConfigMap(name: string, data: Record<string, string>, namespace = "default"): Promise<boolean> { try { await kubectl(`create configmap ${name} --from-literal=${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" --from-literal=")} -n ${namespace}`); return true; } catch { return false; } }
export async function getConfigMap(name: string, namespace = "default"): Promise<Record<string, string>> { try { const { stdout } = await kubectl(`get configmap ${name} -n ${namespace} -o jsonpath='{.data}'`); return JSON.parse(stdout) || {}; } catch { return {}; } }
export async function createSecret(name: string, data: Record<string, string>, namespace = "default"): Promise<boolean> { try { await kubectl(`create secret generic ${name} --from-literal=${Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" --from-literal=")} -n ${namespace}`); return true; } catch { return false; } }

export class KubernetesAdvancedLayer {
  helmInstall = helmInstall; helmUpgrade = helmUpgrade; helmList = helmList; helmRollback = helmRollback; helmSearchRepo = helmSearchRepo;
  listIngresses = listIngresses; deleteIngress = deleteIngress;
  getPodLogs = getPodLogs; execInPod = execInPod; topPods = topPods;
  createConfigMap = createConfigMap; getConfigMap = getConfigMap; createSecret = createSecret;
}
