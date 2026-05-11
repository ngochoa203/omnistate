/**
 * Kubernetes Tools — Group 38
 * Implements: kubectl operations, pod management, deployments, services
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Cluster Info
// ------------------------------------------------------------------

export async function getClusterInfo(): Promise<{ cluster: string; nodes: number; version: string }> {
  try {
    const { stdout: cluster } = await execAsync("kubectl config current-context 2>/dev/null || echo 'unknown'", { encoding: "utf-8" });
    const { stdout: nodes } = await execAsync("kubectl get nodes --no-headers 2>/dev/null | wc -l", { encoding: "utf-8" });
    const { stdout: version } = await execAsync("kubectl version --short 2>/dev/null | grep Server || echo ''", { encoding: "utf-8" });
    
    return {
      cluster: cluster.trim(),
      nodes: parseInt(nodes.trim(), 10) || 0,
      version: version.trim().replace("Server Version: ", "")
    };
  } catch {
    return { cluster: "unknown", nodes: 0, version: "" };
  }
}

export async function checkClusterHealth(): Promise<{ healthy: boolean; issues: string[] }> {
  try {
    await execAsync("kubectl cluster-info 2>/dev/null");
    return { healthy: true, issues: [] };
  } catch {
    return { healthy: false, issues: ["Cluster not reachable"] };
  }
}

// ------------------------------------------------------------------
// Pod Operations
// ------------------------------------------------------------------

export interface PodInfo {
  name: string;
  namespace: string;
  ready: string;
  status: string;
  restarts: number;
  age: string;
}

export async function listPods(namespace?: string): Promise<PodInfo[]> {
  try {
    const ns = namespace ? `-n ${namespace}` : "-A";
    const { stdout } = await execAsync(`kubectl get pods ${ns} --no-headers -o wide`, { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0] || "",
        namespace: parts[1] || "default",
        ready: parts[2] || "0/0",
        status: parts[3] || "Unknown",
        restarts: parseInt(parts[4] || "0", 10),
        age: parts[5] || ""
      };
    });
  } catch {
    return [];
  }
}

export async function getPodLogs(podName: string, namespace?: string, lines: number = 100): Promise<string> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    const { stdout } = await execAsync(`kubectl logs ${podName} ${ns} --tail=${lines}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export async function describePod(podName: string, namespace?: string): Promise<string> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    const { stdout } = await execAsync(`kubectl describe pod ${podName} ${ns}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export async function deletePod(podName: string, namespace?: string): Promise<boolean> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    await execAsync(`kubectl delete pod ${podName} ${ns}`);
    return true;
  } catch {
    return false;
  }
}

export async function execInPod(podName: string, command: string, namespace?: string): Promise<string> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    const { stdout } = await execAsync(`kubectl exec ${podName} ${ns} -- ${command}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Deployment Operations
// ------------------------------------------------------------------

export interface DeploymentInfo {
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  age: string;
}

export async function listDeployments(namespace?: string): Promise<DeploymentInfo[]> {
  try {
    const ns = namespace ? `-n ${namespace}` : "-A";
    const { stdout } = await execAsync(`kubectl get deployments ${ns} --no-headers`, { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0] || "",
        namespace: parts[1] || "default",
        ready: parts[2] || "0/0",
        upToDate: parseInt(parts[3] || "0", 10),
        available: parseInt(parts[4] || "0", 10),
        age: parts[5] || ""
      };
    });
  } catch {
    return [];
  }
}

export async function scaleDeployment(name: string, replicas: number, namespace?: string): Promise<boolean> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    await execAsync(`kubectl scale deployment ${name} ${ns} --replicas=${replicas}`);
    return true;
  } catch {
    return false;
  }
}

export async function restartDeployment(name: string, namespace?: string): Promise<boolean> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    await execAsync(`kubectl rollout restart deployment/${name} ${ns}`);
    return true;
  } catch {
    return false;
  }
}

export async function rollbackDeployment(name: string, namespace?: string): Promise<boolean> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    await execAsync(`kubectl rollout undo deployment/${name} ${ns}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Service Operations
// ------------------------------------------------------------------

export interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
}

export async function listServices(namespace?: string): Promise<ServiceInfo[]> {
  try {
    const ns = namespace ? `-n ${namespace}` : "-A";
    const { stdout } = await execAsync(`kubectl get services ${ns} --no-headers`, { encoding: "utf-8" });
    
    return stdout.trim().split("\n").filter(l => l.trim()).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        name: parts[0] || "",
        namespace: parts[1] || "default",
        type: parts[2] || "",
        clusterIP: parts[3] || "",
        ports: parts[4] || ""
      };
    });
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Namespace Operations
// ------------------------------------------------------------------

export async function listNamespaces(): Promise<string[]> {
  try {
    const { stdout } = await execAsync("kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name", { encoding: "utf-8" });
    return stdout.trim().split("\n").filter(n => n.trim());
  } catch {
    return [];
  }
}

export async function setNamespace(namespace: string): Promise<boolean> {
  try {
    await execAsync(`kubectl config set-context --current --namespace=${namespace}`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Quick Commands
// ------------------------------------------------------------------

export async function getAllResources(namespace?: string): Promise<string> {
  try {
    const ns = namespace ? `-n ${namespace}` : "-A";
    const { stdout } = await execAsync(`kubectl get all ${ns}`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export async function portForward(serviceName: string, localPort: number, targetPort: number, namespace?: string): Promise<boolean> {
  try {
    const ns = namespace ? `-n ${namespace}` : "";
    await execAsync(`kubectl port-forward svc/${serviceName} ${localPort}:${targetPort} ${ns} &`);
    return true;
  } catch {
    return false;
  }
}

export async function getResourceUsage(namespace?: string): Promise<string> {
  try {
    const ns = namespace ? `-n ${namespace}` : "-A";
    const { stdout } = await execAsync(`kubectl top pods ${ns} 2>/dev/null || kubectl top nodes`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

export class KubernetesLayer {
  getClusterInfo = getClusterInfo;
  checkHealth = checkClusterHealth;
  
  listPods = listPods;
  getPodLogs = getPodLogs;
  describePod = describePod;
  deletePod = deletePod;
  execPod = execInPod;
  
  listDeployments = listDeployments;
  scaleDeployment = scaleDeployment;
  restartDeployment = restartDeployment;
  rollbackDeployment = rollbackDeployment;
  
  listServices = listServices;
  
  listNamespaces = listNamespaces;
  setNamespace = setNamespace;
  
  getAllResources = getAllResources;
  portForward = portForward;
  getResourceUsage = getResourceUsage;
}
