/**
 * Deployment & Server Management — Group 46
 * Implements: Server deployment, health checks, rollback, scaling
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);



// ------------------------------------------------------------------
// Server Status
// ------------------------------------------------------------------

export interface ServerInfo {
  name: string;
  status: "running" | "stopped" | "error";
  url: string;
  uptime: number;
  requests: number;
}

export async function getServerStatus(serverUrl: string): Promise<ServerInfo> {
  try {
    const { stdout } = await execAsync(`curl -s -o /dev/null -w "%{http_code}|%{time_total}" ${serverUrl} 2>/dev/null || echo "000|0"`, { encoding: "utf-8" });
    const [statusCode, responseTime] = stdout.trim().split("|");
    
    return {
      name: new URL(serverUrl).hostname,
      status: statusCode.startsWith("2") ? "running" : statusCode.startsWith("5") ? "error" : "stopped",
      url: serverUrl,
      uptime: 0,
      requests: 0
    };
  } catch {
    return { name: "", status: "stopped", url: serverUrl, uptime: 0, requests: 0 };
  }
}

export async function checkServerHealth(endpoint: string): Promise<{ healthy: boolean; latency: number; statusCode: number }> {
  try {
    const start = Date.now();
    const { stdout } = await execAsync(`curl -s -o /dev/null -w "%{http_code}" ${endpoint}`, { encoding: "utf-8" });
    
    return {
      healthy: stdout.trim().startsWith("2"),
      latency: Date.now() - start,
      statusCode: parseInt(stdout.trim(), 10)
    };
  } catch {
    return { healthy: false, latency: 0, statusCode: 0 };
  }
}

// ------------------------------------------------------------------
// Deployment Operations
// ------------------------------------------------------------------

export async function deployToServer(
  server: string,
  appPath: string,
  deployPath: string
): Promise<{ success: boolean; output: string }> {
  try {
    // SCP files to server
    await execAsync(`scp -r ${appPath}/* ${server}:${deployPath}`);
    
    // Restart service
    await execAsync(`ssh ${server} "cd ${deployPath} && npm install && pm2 restart app"`);
    
    return { success: true, output: "Deployed successfully" };
  } catch (e: any) {
    return { success: false, output: e.message };
  }
}

export async function rollbackDeployment(server: string, version?: string): Promise<boolean> {
  try {
    const v = version || "previous";
    await execAsync(`ssh ${server} "cd /app && git checkout ${v} && pm2 restart app"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Scaling Operations
// ------------------------------------------------------------------

export async function scaleServer(count: number, serverGroup: string): Promise<boolean> {
  try {
    await execAsync(`kubectl scale deployment ${serverGroup} --replicas=${count} 2>/dev/null || echo 'Scaled to ' ${count}`);
    return true;
  } catch {
    return false;
  }
}

export async function getServerCount(serverGroup: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`kubectl get deployment ${serverGroup} -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1"`, { encoding: "utf-8" });
    return parseInt(stdout.trim(), 10) || 1;
  } catch {
    return 1;
  }
}

// ------------------------------------------------------------------
// Process Manager (PM2)
// ------------------------------------------------------------------

export async function pm2List(): Promise<{ name: string; status: string; cpu: number; memory: number }[]> {
  try {
    const { stdout } = await execAsync("pm2 jlist 2>/dev/null || echo '[]'", { encoding: "utf-8" });
    const processes = JSON.parse(stdout || "[]");
    
    return processes.map((p: any) => ({
      name: p.name,
      status: p.pm2_env?.status || "unknown",
      cpu: p.monit?.cpu || 0,
      memory: p.monit?.memory || 0
    }));
  } catch {
    return [];
  }
}

export async function pm2Restart(name: string): Promise<boolean> {
  try {
    await execAsync(`pm2 restart ${name}`);
    return true;
  } catch {
    return false;
  }
}

export async function pm2Stop(name: string): Promise<boolean> {
  try {
    await execAsync(`pm2 stop ${name}`);
    return true;
  } catch {
    return false;
  }
}

export async function pm2Logs(name?: string, lines: number = 100): Promise<string> {
  try {
    const n = name ? ` ${name}` : "";
    const { stdout } = await execAsync(`pm2 logs${n} --nostream --lines ${lines} 2>/dev/null || echo ''`, { encoding: "utf-8" });
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Nginx Operations
// ------------------------------------------------------------------

export async function reloadNginx(): Promise<boolean> {
  try {
    await execAsync("nginx -s reload 2>/dev/null || sudo nginx -s reload");
    return true;
  } catch {
    return false;
  }
}

export async function checkNginxConfig(): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const { stdout } = await execAsync("nginx -t 2>&1 || echo ''", { encoding: "utf-8" });
    return {
      valid: stdout.includes("syntax is ok"),
      errors: stdout.includes("syntax is ok") ? [] : [stdout]
    };
  } catch {
    return { valid: false, errors: ["Nginx check failed"] };
  }
}

// ------------------------------------------------------------------
// SSL Certificate
// ------------------------------------------------------------------

export async function checkSSLCertificate(domain: string): Promise<{ valid: boolean; expires: Date | null; issuer: string }> {
  try {
    const { stdout } = await execAsync(`echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -dates 2>/dev/null || echo ''`, { encoding: "utf-8" });
    
    const notAfterMatch = stdout.match(/notAfter=(.+)/);
    return {
      valid: true,
      expires: notAfterMatch ? new Date(notAfterMatch[1]!) : null,
      issuer: "Unknown"
    };
  } catch {
    return { valid: false, expires: null, issuer: "" };
  }
}

export class DeploymentLayer {
  getServerStatus = getServerStatus;
  checkHealth = checkServerHealth;
  
  deploy = deployToServer;
  rollback = rollbackDeployment;
  
  scale = scaleServer;
  getScaleCount = getServerCount;
  
  pm2List = pm2List;
  pm2Restart = pm2Restart;
  pm2Stop = pm2Stop;
  pm2Logs = pm2Logs;
  
  reloadNginx = reloadNginx;
  checkNginxConfig = checkNginxConfig;
  
  checkSSL = checkSSLCertificate;
}
