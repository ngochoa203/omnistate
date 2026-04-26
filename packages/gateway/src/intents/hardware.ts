import type { IntentHandler } from "./types.js";

// ── Audio ─────────────────────────────────────────────────────────────────────

export const audioDevices: IntentHandler = async (_args, ctx) => {
  const devices = await ctx.layers.deepOS!.getAudioDevices();
  return { speak: "Audio devices retrieved.", data: { devices } };
};

export const audioSetOutput: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setAudioOutput(args.deviceId as string);
  return { speak: "Audio output set.", data: { success } };
};

export const audioSetInput: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setAudioInput(args.deviceId as string);
  return { speak: "Audio input set.", data: { success } };
};

export const audioMute: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setMute(args.muted as boolean);
  return { speak: "Mute updated.", data: { success } };
};

export const audioSources: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const sources = await deepSystem.getAudioSources();
  return { speak: "Audio sources retrieved.", data: { sources } };
};

export const audioDefaultOutput: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.setDefaultAudioOutput(args.deviceName as string);
  return { speak: "Default audio output set.", data: { success } };
};

export const audioDefaultInput: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.setDefaultAudioInput(args.deviceName as string);
  return { speak: "Default audio input set.", data: { success } };
};

export const audioMuted: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const muted = await deepSystem.isMuted();
  return { speak: muted ? "Audio is muted." : "Audio is not muted.", data: { muted } };
};

export const audioToggleMute: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.toggleMute();
  return { speak: "Mute toggled.", data: { success } };
};

// Hardware layer audio wrappers
export const hardwareGetVolume: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const vol = await hardware.getVolume();
  return { speak: "Volume retrieved.", data: vol };
};

export const hardwareSetVolume: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setVolume(args.level as number);
  return { speak: "Volume set.", data: { success: true } };
};

export const hardwareMute: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.mute();
  return { speak: "Muted.", data: { success: true } };
};

export const hardwareUnmute: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.unmute();
  return { speak: "Unmuted.", data: { success: true } };
};

export const hardwareToggleMute: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.toggleMute();
  return { speak: "Mute toggled.", data: { success: true } };
};

export const hardwareGetInputVolume: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const level = await hardware.getInputVolume();
  return { speak: "Input volume retrieved.", data: { level } };
};

export const hardwareSetInputVolume: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setInputVolume(args.level as number);
  return { speak: "Input volume set.", data: { success: true } };
};

export const hardwareListAudioDevices: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const devices = await hardware.listAudioDevices();
  return { speak: "Audio devices listed.", data: { devices } };
};

// ── Display ───────────────────────────────────────────────────────────────────

export const displayBrightness: IntentHandler = async (args, ctx) => {
  if (args.level !== undefined) {
    const success = await ctx.layers.deepOS!.setBrightness(args.level as number);
    return { speak: "Brightness set.", data: { success } };
  }
  const level = await ctx.layers.deepOS!.getBrightness();
  return { speak: `Brightness is ${level}.`, data: { level } };
};

export const displayList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const displays = await deepSystem.getDisplays();
  return { speak: "Displays listed.", data: { displays } };
};

export const displaySetResolution: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.setResolution(
    (args.displayId as number).toString(),
    args.width as number,
    args.height as number,
  );
  return { speak: "Resolution set.", data: { success } };
};

export const displayNightShift: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  if (args.enabled !== undefined) {
    const success = await deepSystem.setNightShift(args.enabled as boolean);
    return { speak: "Night Shift updated.", data: { success } };
  }
  const enabled = await deepSystem.getNightShiftStatus();
  return { speak: `Night Shift is ${enabled ? "on" : "off"}.`, data: { enabled } };
};

export const displayNightshift: IntentHandler = displayNightShift;

// Hardware display wrappers
export const hardwareGetBrightness: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const level = await hardware.getBrightness();
  return { speak: "Brightness retrieved.", data: { level } };
};

export const hardwareSetBrightness: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setBrightness(args.level as number);
  return { speak: "Brightness set.", data: { success: true } };
};

export const hardwareGetNightShift: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const status = await hardware.getNightShift();
  return { speak: "Night Shift status retrieved.", data: status };
};

export const hardwareSetNightShift: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setNightShift(args.enabled as boolean);
  return { speak: "Night Shift updated.", data: { success: true } };
};

export const hardwareListDisplays: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const displays = await hardware.listDisplays();
  return { speak: "Displays listed.", data: { displays } };
};

export const hardwareGetResolution: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const resolution = await hardware.getDisplayResolution(args.displayId as number | undefined);
  return { speak: "Resolution retrieved.", data: resolution };
};

export const hardwareSetResolution: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setDisplayResolution(args.width as number, args.height as number);
  return { speak: "Resolution set.", data: { success: true } };
};

export const hardwareIsDarkMode: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const enabled = await hardware.isDarkMode();
  return { speak: `Dark mode is ${enabled ? "on" : "off"}.`, data: { enabled } };
};

export const hardwareSetDarkMode: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setDarkMode(args.enabled as boolean);
  return { speak: "Dark mode updated.", data: { success: true } };
};

export const hardwareGetAppearance: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const appearance = await hardware.getAppearance();
  return { speak: "Appearance retrieved.", data: { appearance } };
};

// ── Bluetooth ─────────────────────────────────────────────────────────────────

export const bluetoothStatus: IntentHandler = async (_args, ctx) => {
  const status = await ctx.layers.deepOS!.getBluetoothStatus();
  return { speak: "Bluetooth status retrieved.", data: { status } };
};

export const bluetoothToggle: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.setBluetoothEnabled(args.enabled as boolean);
  return { speak: "Bluetooth updated.", data: { success } };
};

export const bluetoothDevices: IntentHandler = async (_args, ctx) => {
  const devices = await ctx.layers.deepOS!.listBluetoothDevices();
  return { speak: "Bluetooth devices listed.", data: { devices } };
};

export const hardwareGetBluetoothStatus: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const status = await hardware.getBluetoothStatus();
  return { speak: "Bluetooth status retrieved.", data: status };
};

export const hardwareEnableBluetooth: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.enableBluetooth();
  return { speak: "Bluetooth enabled.", data: { success: true } };
};

export const hardwareDisableBluetooth: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.disableBluetooth();
  return { speak: "Bluetooth disabled.", data: { success: true } };
};

export const hardwareListBluetoothDevices: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const devices = await hardware.listBluetoothDevices();
  return { speak: "Bluetooth devices listed.", data: { devices } };
};

export const hardwareConnectBluetooth: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.connectBluetoothDevice(args.address as string);
  return { speak: "Bluetooth device connected.", data: { success: true } };
};

export const hardwareDisconnectBluetooth: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.disconnectBluetoothDevice(args.address as string);
  return { speak: "Bluetooth device disconnected.", data: { success: true } };
};

// ── Disk ──────────────────────────────────────────────────────────────────────

export const diskEject: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.ejectDisk(args.mountPoint as string);
  return { speak: "Disk ejected.", data: { success } };
};

// ── Volume ────────────────────────────────────────────────────────────────────

export const volumeList: IntentHandler = async (_args, ctx) => {
  const volumes = await ctx.layers.deepOS!.listVolumes();
  return { speak: "Volumes listed.", data: { volumes } };
};

export const volumeMount: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.mountVolume(args.device as string, args.mountPoint as string);
  return { speak: "Volume mounted.", data: { success } };
};

export const volumeUnmount: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.deepOS!.unmountVolume(args.mountPoint as string);
  return { speak: "Volume unmounted.", data: { success } };
};

// ── Keyboard ──────────────────────────────────────────────────────────────────

export const keyboardLayouts: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const layouts = await deepSystem.getKeyboardLayouts();
  return { speak: "Keyboard layouts retrieved.", data: { layouts } };
};

export const keyboardSetLayout: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.setKeyboardLayout(args.layout as string);
  return { speak: "Keyboard layout set.", data: { success } };
};

export const hardwareGetKeyboardBacklight: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const level = await hardware.getKeyboardBacklight();
  return { speak: "Keyboard backlight retrieved.", data: { level } };
};

export const hardwareSetKeyboardBacklight: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.setKeyboardBacklight(args.level as number);
  return { speak: "Keyboard backlight set.", data: { success: true } };
};

export const hardwareIsKeyboardBacklightAuto: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const auto = await hardware.isKeyboardBacklightAuto();
  return { speak: "Keyboard backlight auto status retrieved.", data: { auto } };
};

// ── Printer ───────────────────────────────────────────────────────────────────

export const printerList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const printers = await deepSystem.listPrinters();
  return { speak: "Printers listed.", data: { printers } };
};

export const printerDefault: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  if (args.name) {
    const success = await deepSystem.setDefaultPrinter(args.name as string);
    return { speak: "Default printer set.", data: { success } };
  }
  const printer = await deepSystem.getDefaultPrinter();
  return { speak: "Default printer retrieved.", data: { printer } };
};

export const printerPrint: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.printFile(args.filePath as string, args.printer as string | undefined);
  return { speak: "File printed.", data: { success } };
};

export const printerQueue: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const queue = await deepSystem.getPrintQueue(args.printer as string | undefined);
  return { speak: "Print queue retrieved.", data: { queue } };
};

// ── Memory ────────────────────────────────────────────────────────────────────

export const memoryPressure: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const pressure = await deepSystem.getMemoryPressure();
  return { speak: "Memory pressure retrieved.", data: { pressure } };
};

export const memorySwap: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const swap = await deepSystem.getSwapUsage();
  return { speak: "Swap usage retrieved.", data: { swap } };
};

export const memoryTopProcesses: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const processes = await deepSystem.getTopMemoryProcesses(args.count as number | undefined);
  return { speak: "Top memory processes retrieved.", data: { processes } };
};

export const memoryPurge: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.purgeMemory();
  return { speak: "Memory purged.", data: { success } };
};

export const memoryVmstats: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const stats = await deepSystem.getVMStats();
  return { speak: "VM stats retrieved.", data: { stats } };
};

// ── Kernel ────────────────────────────────────────────────────────────────────

export const kernelSysctl: IntentHandler = async (args, ctx) => {
  if (args.value) {
    const success = await ctx.layers.deepOS!.setSysctl(args.key as string, args.value as string);
    return { speak: "Sysctl set.", data: { success } };
  }
  const value = await ctx.layers.deepOS!.getSysctl(args.key as string);
  return { speak: "Sysctl retrieved.", data: { value } };
};

export const kernelPower: IntentHandler = async (args, ctx) => {
  if (args.value) {
    const success = await ctx.layers.deepOS!.setPowerSetting(args.key as string, args.value as string);
    return { speak: "Power setting set.", data: { success } };
  }
  const settings = await ctx.layers.deepOS!.getPowerSettings();
  return { speak: "Power settings retrieved.", data: { settings } };
};

// ── Hardware misc ──────────────────────────────────────────────────────────────

export const hardwareGetBatteryStatus: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const status = await hardware.getBatteryStatus();
  return { speak: "Battery status retrieved.", data: status };
};

export const hardwareGetSleepSettings: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const settings = await hardware.getSleepSettings();
  return { speak: "Sleep settings retrieved.", data: settings };
};

export const hardwarePreventSleep: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const result = await hardware.preventSleep(args.minutes as number);
  return { speak: "Sleep prevention started.", data: result };
};

export const hardwareAllowSleep: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.allowSleep(args.pid as number);
  return { speak: "Sleep allowed.", data: { success: true } };
};

export const hardwareSleep: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.sleep();
  return { speak: "Going to sleep.", data: { success: true } };
};

export const hardwareRestart: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.restart();
  return { speak: "Restarting.", data: { success: true } };
};

export const hardwareShutdown: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.shutdown();
  return { speak: "Shutting down.", data: { success: true } };
};

export const hardwareListUSBDevices: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const devices = await hardware.listUSBDevices();
  return { speak: "USB devices listed.", data: { devices } };
};

export const hardwareListThunderboltDevices: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const devices = await hardware.listThunderboltDevices();
  return { speak: "Thunderbolt devices listed.", data: { devices } };
};

export const hardwareGetInputDevices: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const devices = await hardware.getInputDevices();
  return { speak: "Input devices retrieved.", data: { devices } };
};

export const hardwareEjectDisk: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.ejectDisk(args.diskName as string);
  return { speak: "Disk ejected.", data: { success: true } };
};

export const hardwareGetWifiInfo: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const info = await hardware.getWifiInfo();
  return { speak: "Wi-Fi info retrieved.", data: { info } };
};

export const hardwareGetWifiNetworks: IntentHandler = async (_args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  const networks = await hardware.getWifiNetworks();
  return { speak: "Wi-Fi networks retrieved.", data: { networks } };
};

export const hardwareConnectToWifi: IntentHandler = async (args, ctx) => {
  const hardware = (ctx.layers as any).hardware;
  await hardware.connectToWifi(args.ssid as string, args.password as string | undefined);
  return { speak: "Connected to Wi-Fi.", data: { success: true } };
};

export const hardwareEject: IntentHandler = async (args, ctx) => {
  const volume = String(args.volume ?? args.name ?? "");
  if (volume) {
    await ctx.layers.deep.execAsync(`diskutil eject "${volume}"`, 10000);
  } else {
    await ctx.layers.deep.execAsync("diskutil eject external", 10000);
  }
  return { speak: "Volume ejected.", data: { success: true, volume, action: "ejected" } };
};

export const hardwarePrint: IntentHandler = async (args, ctx) => {
  const file = String(args.file ?? args.path ?? "");
  const printer = String(args.printer ?? "");
  const copies = Number(args.copies ?? 1);
  const printerFlag = printer ? `-d "${printer}"` : "";
  await ctx.layers.deep.execAsync(`lpr ${printerFlag} -# ${copies} "${file}"`, 10000);
  return { speak: "File sent to printer.", data: { success: true, file, printer, copies } };
};

export const hardwareWebcamLock: IntentHandler = async (args, ctx) => {
  const locked = Boolean(args.locked ?? true);
  if (locked) {
    await ctx.layers.deep.execAsync(
      "sudo killall VDCAssistant 2>/dev/null; sudo killall AppleCameraAssistant 2>/dev/null",
      5000,
    );
  }
  return { speak: locked ? "Webcam locked." : "Webcam unlocked.", data: { success: true, webcam: locked ? "locked" : "unlocked" } };
};

export const hardwareMicLock: IntentHandler = async (args, ctx) => {
  const locked = Boolean(args.locked ?? true);
  const deepSystem = (ctx.layers as any).deepSystem;
  await deepSystem.toggleMute();
  return { speak: locked ? "Mic locked." : "Mic unlocked.", data: { success: true, mic: locked ? "locked" : "unlocked" } };
};

export const hardwareHealth: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const battery = await deepSystem.getBatteryInfo();
  const memory = await deepSystem.getMemoryPressure();
  const swap = await deepSystem.getSwapUsage();
  const topProcs = await deepSystem.getTopMemoryProcesses(5);
  let cpuTemp = "N/A";
  try {
    const tempResult = await ctx.layers.deep.execAsync(
      "sudo powermetrics --samplers smc -n 1 -i 100 2>/dev/null | grep 'CPU die temperature' | head -1",
      5000,
    );
    cpuTemp = tempResult.stdout?.trim() ?? "N/A";
  } catch {}
  let diskHealth = "N/A";
  try {
    const diskResult = await ctx.layers.deep.execAsync("diskutil info disk0 | grep SMART", 5000);
    diskHealth = diskResult.stdout?.trim() ?? "N/A";
  } catch {}
  return {
    speak: "Hardware health retrieved.",
    data: { success: true, battery, memory, swap, cpuTemp, diskHealth, topMemoryProcesses: topProcs },
  };
};
