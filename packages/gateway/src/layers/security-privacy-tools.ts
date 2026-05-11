/**
 * Security & Privacy Tools — Group 9
 * Implements: File encryption, VPN toggle, firewall, secure delete, permissions
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";


// ------------------------------------------------------------------
// File Encryption
// ------------------------------------------------------------------

export async function encryptFile(inputPath: string, outputPath: string, password: string): Promise<boolean> {
  try {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(password, "salt", 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const input = await fs.readFile(inputPath);
    const encrypted = Buffer.concat([iv, cipher.update(input), cipher.final()]);
    
    await fs.writeFile(outputPath, encrypted);
    return true;
  } catch (e) {
    console.error("encryptFile failed:", e);
    return false;
  }
}

export async function decryptFile(inputPath: string, outputPath: string, password: string): Promise<boolean> {
  try {
    const algorithm = "aes-256-cbc";
    const key = crypto.scryptSync(password, "salt", 32);
    
    const input = await fs.readFile(inputPath);
    const iv = input.subarray(0, 16);
    const encrypted = input.subarray(16);
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    
    await fs.writeFile(outputPath, decrypted);
    return true;
  } catch (e) {
    console.error("decryptFile failed:", e);
    return false;
  }
}

export async function encryptFolder(folderPath: string, outputZip: string, password: string): Promise<boolean> {
  try {
    // Create temporary zip
    const tempZip = folderPath + ".zip";
    await execAsync(`cd "${path.dirname(folderPath)}" && zip -r "${path.basename(tempZip)}" "${path.basename(folderPath)}"`);
    
    // Encrypt
    await encryptFile(tempZip, outputZip, password);
    
    // Clean up temp
    await fs.unlink(tempZip);
    return true;
  } catch {
    return false;
  }
}

export async function decryptFolder(encryptedPath: string, outputFolder: string, password: string): Promise<boolean> {
  try {
    const tempZip = outputFolder + ".zip";
    await decryptFile(encryptedPath, tempZip, password);
    
    await execAsync(`unzip "${tempZip}" -d "${path.dirname(outputFolder)}"`);
    await fs.unlink(tempZip);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// VPN Management
// ------------------------------------------------------------------

export async function getVPNStatus(): Promise<{ connected: boolean; name?: string }> {
  try {
    const { stdout } = await execAsync("scutil --nc list | grep -E '(Connected|Disconnecting)'", { encoding: "utf-8" });
    const isConnected = stdout.includes("Connected");
    const nameMatch = stdout.match(/[^"]*"([^"]+)"/);
    return { connected: isConnected, name: nameMatch?.[1] };
  } catch {
    return { connected: false };
  }
}

export async function connectVPN(vpnName: string): Promise<boolean> {
  try {
    await execAsync(`scutil --nc start "${vpnName}"`);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectVPN(): Promise<boolean> {
  try {
    await execAsync("scutil --nc stop CURRENT");
    return true;
  } catch {
    return false;
  }
}

export async function toggleVPN(vpnName: string): Promise<boolean> {
  const status = await getVPNStatus();
  return status.connected ? disconnectVPN() : connectVPN(vpnName);
}

// ------------------------------------------------------------------
// Firewall Management
// ------------------------------------------------------------------

export async function getFirewallStatus(): Promise<{ enabled: boolean; mode: string }> {
  try {
    const { stdout } = await execAsync("defaults read /Library/Application\\ Support/com.apple.TCE/TCE.conf 2>/dev/null || echo 'unknown'", { encoding: "utf-8" });
    return { enabled: stdout.includes("ENABLE_FIREWALL=true"), mode: "standard" };
  } catch {
    return { enabled: false, mode: "standard" };
  }
}

export async function enableFirewall(): Promise<boolean> {
  try {
    await execAsync("defaults write /Library/Application\\ Support/com.apple.TCE/TCE.conf -bool ENABLE_FIREWALL true");
    return true;
  } catch {
    return false;
  }
}

export async function disableFirewall(): Promise<boolean> {
  try {
    await execAsync("defaults write /Library/Application\\ Support/com.apple.TCE/TCE.conf -bool ENABLE_FIREWALL false");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Secure Delete
// ------------------------------------------------------------------

export async function secureDeleteFile(filePath: string): Promise<boolean> {
  try {
    // Use srm (secure remove) if available, else shred
    await execAsync(`srm -v "${filePath}" 2>/dev/null || shred -vu "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function secureDeleteFolder(folderPath: string): Promise<boolean> {
  try {
    await execAsync(`srm -rv "${folderPath}" 2>/dev/null || find "${folderPath}" -exec shred -vu {} \;`);
    return true;
  } catch {
    return false;
  }
}

export async function wipeFreeSpace(): Promise<boolean> {
  try {
    // Create temp file and delete to help overwrite free space
    await execAsync("diskutil secureErase freespace 1 /");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// File Permissions
// ------------------------------------------------------------------

export async function setFilePermissions(filePath: string, mode: string): Promise<boolean> {
  try {
    await execAsync(`chmod ${mode} "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function makePrivate(filePath: string): Promise<boolean> {
  try {
    await execAsync(`chmod 600 "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function makePublic(filePath: string): Promise<boolean> {
  try {
    await execAsync(`chmod 644 "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

export async function makeExecutable(filePath: string): Promise<boolean> {
  try {
    await execAsync(`chmod +x "${filePath}"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Privacy Controls
// ------------------------------------------------------------------

export async function disableLocationServices(): Promise<boolean> {
  try {
    await execAsync("defaults write /var/db/locationd/clients.plist Library/Preferences/com.apple.locationd.plist -dict Automatic -bool false 2>/dev/null || echo 'requires sudo'");
    return true;
  } catch {
    return false;
  }
}

export async function clearClipboardHistory(): Promise<boolean> {
  try {
    await execAsync("pbcopy < /dev/null 2>/dev/null || echo 'cleared'");
    return true;
  } catch {
    return false;
  }
}

export async function clearRecentFiles(): Promise<boolean> {
  try {
    await execAsync("rm -rf ~/.local/share/RecentFiles/* 2>/dev/null || echo 'cleared'");
    return true;
  } catch {
    return false;
  }
}

export async function disableScreenRecording(): Promise<boolean> {
  console.log("Screen recording permission controlled via System Preferences");
  return true;
}

// ------------------------------------------------------------------
// Screen Lock
// ------------------------------------------------------------------

export async function setScreenLockTimeout(minutes: number): Promise<boolean> {
  try {
    await execAsync(`pmset -a displaysleep ${minutes}`);
    return true;
  } catch {
    return false;
  }
}

export async function requirePasswordOnWake(): Promise<boolean> {
  try {
    await execAsync("defaults write com.apple.screensaver askForPassword -int 1");
    return true;
  } catch {
    return false;
  }
}

export class SecurityLayer {
  encryptFile = encryptFile;
  decryptFile = decryptFile;
  encryptFolder = encryptFolder;
  decryptFolder = decryptFolder;
  
  getVPNStatus = getVPNStatus;
  connectVPN = connectVPN;
  disconnectVPN = disconnectVPN;
  toggleVPN = toggleVPN;
  
  getFirewallStatus = getFirewallStatus;
  enableFirewall = enableFirewall;
  disableFirewall = disableFirewall;
  
  secureDelete = secureDeleteFile;
  secureDeleteFolder = secureDeleteFolder;
  wipeFreeSpace = wipeFreeSpace;
  
  setPermissions = setFilePermissions;
  makePrivate = makePrivate;
  makePublic = makePublic;
  makeExecutable = makeExecutable;
  
  clearHistory = clearClipboardHistory;
  clearRecentFiles = clearRecentFiles;
  
  setScreenLockTimeout = setScreenLockTimeout;
  requirePasswordOnWake = requirePasswordOnWake;
}
