/**
 * Mobile Development Tools — iOS Xcode, Android, React Native, Flutter.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// iOS / Xcode
export async function xcodeListSimulators(): Promise<{ name: string; version: string }[]> { try { const { stdout } = await execAsync(`xcrun simctl list devices available | grep -E "iPhone|iPad"`, { encoding: "utf-8" }); return stdout.split("\n").map(line => { const match = line.match(/--\s+(.+?)\s+\((.+?)\)/); return match ? { name: match[1], version: match[2] } : { name: line, version: "" }; }); } catch { return []; } }
export async function xcodeBuild(projectPath: string, target?: string): Promise<{ success: boolean; buildDir?: string }> { try { const t = target ? `-target ${target}` : ""; await execAsync(`cd "${projectPath}" && xcodebuild build ${t} 2>&1 | tail -5`); return { success: true, buildDir: `${projectPath}/build` }; } catch { return { success: false }; } }
export async function xcodeTest(projectPath: string, scheme: string): Promise<{ passed: number; failed: number }> { try { await execAsync(`cd "${projectPath}" && xcodebuild test -scheme "${scheme}" 2>/dev/null || echo ""`); return { passed: 0, failed: 0 }; } catch { return { passed: 0, failed: 0 }; } }
export async function xcodeArchive(projectPath: string, scheme: string, outputPath: string): Promise<boolean> { try { await execAsync(`cd "${projectPath}" && xcodebuild archive -scheme "${scheme}" -archivePath "${outputPath}"`); return true; } catch { return false; } }

// Android
export async function androidListAVDs(): Promise<{ name: string; api: number }[]> { try { const { stdout } = await execAsync(`avdmanager list avd 2>/dev/null || echo ""`, { encoding: "utf-8" }); const avds: { name: string; api: number }[] = []; stdout.split("\n").forEach(line => { const nameMatch = line.match(/Name:\s*(.+)/); const apiMatch = line.match(/API:\s*(\d+)/); if (nameMatch) avds.push({ name: nameMatch[1], api: 0 }); if (apiMatch && avds.length) avds[avds.length - 1].api = parseInt(apiMatch[1]); }); return avds; } catch { return []; } }
export async function androidBuild(projectPath: string, variant = "debug"): Promise<{ success: boolean; apkPath?: string }> { try { const task = variant === "release" ? "assembleRelease" : "assembleDebug"; await execAsync(`cd "${projectPath}" && ./gradlew ${task} 2>&1 | tail -3`); return { success: true, apkPath: `${projectPath}/app/build/outputs/apk/${variant}/app-${variant}.apk` }; } catch { return { success: false }; } }
export async function androidInstallAPK(apkPath: string, deviceId?: string): Promise<boolean> { try { await execAsync(`adb ${deviceId ? `-s ${deviceId}` : ""} install -r "${apkPath}"`); return true; } catch { return false; } }

// React Native
export async function reactNativeInit(name: string, template?: string): Promise<boolean> { try { await execAsync(`npx react-native init "${name}" ${template ? `--template ${template}` : ""}`); return true; } catch { return false; } }
export async function reactNativeBundle(platform: "ios" | "android", outputPath: string): Promise<boolean> { try { await execAsync(`npx react-native bundle --platform ${platform} --entry-file index.js --bundle-output "${outputPath}" --assets-dest ./`); return true; } catch { return false; } }
export async function reactNativeStart(resetCache = false): Promise<boolean> { try { await execAsync(`npx react-native start ${resetCache ? "--reset-cache" : ""} &`); return true; } catch { return false; } }

// Flutter
export async function flutterListDevices(): Promise<{ id: string; name: string; platform: string }[]> { try { const { stdout } = await execAsync(`flutter devices --machine`, { encoding: "utf-8" }); const data = JSON.parse(stdout); return data.map((d: any) => ({ id: d.id, name: d.name, platform: d.platform })); } catch { return []; } }
export async function flutterBuild(platform: "ios" | "android" | "web"): Promise<boolean> { try { await execAsync(`flutter build ${platform}`); return true; } catch { return false; } }
export async function flutterRun(deviceId?: string): Promise<boolean> { try { await execAsync(`flutter run ${deviceId ? `-d ${deviceId}` : ""} &`); return true; } catch { return false; } }

export class MobileDevLayer { xcodeListSimulators = xcodeListSimulators; xcodeBuild = xcodeBuild; xcodeTest = xcodeTest; xcodeArchive = xcodeArchive; androidListAVDs = androidListAVDs; androidBuild = androidBuild; androidInstallAPK = androidInstallAPK; reactNativeInit = reactNativeInit; reactNativeBundle = reactNativeBundle; reactNativeStart = reactNativeStart; flutterListDevices = flutterListDevices; flutterBuild = flutterBuild; flutterRun = flutterRun; }
