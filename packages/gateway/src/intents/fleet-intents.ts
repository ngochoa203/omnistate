import type { IntentHandler } from "./types.js";

export const fleetDiscoverDevices: IntentHandler = async (_args, ctx) => {
  const devices = await ctx.layers.fleet.discoverDevices();
  return { speak: "Devices discovered.", data: { devices } };
};

export const fleetGetDeviceStatus: IntentHandler = async (args, ctx) => {
  const status = await ctx.layers.fleet.getDeviceStatus(args.deviceId as string);
  return { speak: "Device status retrieved.", data: { status } };
};

export const fleetPingDevice: IntentHandler = async (args, ctx) => {
  const alive = await ctx.layers.fleet.pingDevice(args.deviceId as string);
  return { speak: alive ? "Device is online." : "Device is offline.", data: { alive } };
};

export const fleetGetDeviceInfo: IntentHandler = async (args, ctx) => {
  const info = await ctx.layers.fleet.getDeviceInfo(args.deviceId as string);
  return { speak: "Device info retrieved.", data: { info } };
};

export const fleetListOnlineDevices: IntentHandler = async (_args, ctx) => {
  const devices = await ctx.layers.fleet.listOnlineDevices();
  return { speak: "Online devices listed.", data: { devices } };
};

export const fleetGetFleetOverview: IntentHandler = async (_args, ctx) => {
  const overview = await ctx.layers.fleet.getFleetOverview();
  return { speak: "Fleet overview retrieved.", data: { overview } };
};

export const fleetSendTask: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.sendTask(args.deviceId as string, args.task as any);
  return { speak: "Task sent.", data: result as unknown as Record<string, unknown> };
};

export const fleetBroadcastTask: IntentHandler = async (args, ctx) => {
  const results = await ctx.layers.fleet.broadcastTask(args.task as any, args.filter as any);
  return { speak: "Task broadcast.", data: { results } };
};

export const fleetGetTaskStatus: IntentHandler = async (args, ctx) => {
  const status = await ctx.layers.fleet.getTaskStatus(args.deviceId as string, args.taskId as string);
  return { speak: "Task status retrieved.", data: { status } };
};

export const fleetCancelTask: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.fleet.cancelTask(args.deviceId as string, args.taskId as string);
  return { speak: "Task cancelled.", data: { success } };
};

export const fleetCollectResults: IntentHandler = async (args, ctx) => {
  const results = await ctx.layers.fleet.collectResults(args.taskId as string);
  return { speak: "Results collected.", data: { results } };
};

export const fleetSendFile: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.sendFile(args.deviceId as string, args.localPath as string, args.remotePath as string);
  return { speak: "File sent.", data: result as unknown as Record<string, unknown> };
};

export const fleetRequestFile: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.requestFile(args.deviceId as string, args.remotePath as string, args.localPath as string);
  return { speak: "File requested.", data: result as unknown as Record<string, unknown> };
};

export const fleetSyncDirectory: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.syncDirectory(
    args.deviceId as string,
    args.localDir as string,
    args.remoteDir as string,
    (args.direction as any) ?? "push",
  );
  return { speak: "Directory synced.", data: result as unknown as Record<string, unknown> };
};

export const fleetGetRemoteFileList: IntentHandler = async (args, ctx) => {
  const files = await ctx.layers.fleet.getRemoteFileList(args.deviceId as string, args.remotePath as string);
  return { speak: "Remote file list retrieved.", data: { files } };
};

export const fleetSyncClipboard: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.syncClipboard(args.deviceId as string, args.direction as any);
  return { speak: "Clipboard synced.", data: result as unknown as Record<string, unknown> };
};

export const fleetSendNotification: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.sendNotification(
    args.deviceId as string,
    String(args.title ?? ""),
    String(args.body ?? ""),
  );
  return { speak: "Notification sent.", data: result as unknown as Record<string, unknown> };
};

export const fleetGetRemoteClipboard: IntentHandler = async (args, ctx) => {
  const content = await ctx.layers.fleet.getRemoteClipboard(args.deviceId as string);
  return { speak: "Remote clipboard retrieved.", data: { content } };
};

export const fleetStartHeartbeat: IntentHandler = async (args, ctx) => {
  ctx.layers.fleet.startHeartbeat(args.intervalMs as number | undefined);
  return { speak: "Heartbeat started.", data: { success: true } };
};

export const fleetStopHeartbeat: IntentHandler = async (_args, ctx) => {
  ctx.layers.fleet.stopHeartbeat();
  return { speak: "Heartbeat stopped.", data: { success: true } };
};

export const fleetGetHealthHistory: IntentHandler = async (args, ctx) => {
  const history = ctx.layers.fleet.getHealthHistory(args.deviceId as string);
  return { speak: "Health history retrieved.", data: { history } };
};

export const fleetCreateTaskGroup: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.createTaskGroup(args.tasks as any, args.options as any);
  return { speak: "Task group created.", data: result as Record<string, unknown> };
};

export const fleetGetTaskGroupStatus: IntentHandler = async (args, ctx) => {
  const status = await ctx.layers.fleet.getTaskGroupStatus(args.groupId as string);
  return { speak: "Task group status retrieved.", data: { status } };
};

export const fleetCancelTaskGroup: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.cancelTaskGroup(args.groupId as string);
  return { speak: "Task group cancelled.", data: result as Record<string, unknown> };
};

export const fleetScheduleTask: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.scheduleTask(
    args.deviceId as string,
    args.task as any,
    args.cronExpression as string,
  );
  return { speak: "Task scheduled.", data: result as Record<string, unknown> };
};

export const fleetSyncConfig: IntentHandler = async (args, ctx) => {
  await ctx.layers.fleet.syncConfig(args.deviceId as string, args.config as Record<string, unknown>);
  return { speak: "Config synced.", data: { success: true } };
};

export const fleetGetRemoteConfig: IntentHandler = async (args, ctx) => {
  const config = await ctx.layers.fleet.getRemoteConfig(args.deviceId as string);
  return { speak: "Remote config retrieved.", data: { config } };
};

export const fleetBroadcastConfig: IntentHandler = async (args, ctx) => {
  const result = await ctx.layers.fleet.broadcastConfig(args.config as Record<string, unknown>);
  return { speak: "Config broadcast.", data: result as Record<string, unknown> };
};

export const fleetGetFleetMetrics: IntentHandler = async (_args, ctx) => {
  const metrics = await ctx.layers.fleet.getFleetMetrics();
  return { speak: "Fleet metrics retrieved.", data: { metrics } };
};

export const fleetGetDeviceMetrics: IntentHandler = async (args, ctx) => {
  const metrics = await ctx.layers.fleet.getDeviceMetrics(args.deviceId as string);
  return { speak: "Device metrics retrieved.", data: { metrics } };
};

export const fleetSetAlertThresholds: IntentHandler = async (args, ctx) => {
  await ctx.layers.fleet.setAlertThresholds(args.thresholds as any);
  return { speak: "Alert thresholds set.", data: { success: true } };
};

export const fleetEnableMeshRelay: IntentHandler = async (_args, ctx) => {
  await ctx.layers.fleet.enableMeshRelay();
  return { speak: "Mesh relay enabled.", data: { success: true } };
};

export const fleetGetNetworkTopology: IntentHandler = async (_args, ctx) => {
  const topology = await ctx.layers.fleet.getNetworkTopology();
  return { speak: "Network topology retrieved.", data: { topology } };
};

export const fleetFindBestRoute: IntentHandler = async (args, ctx) => {
  const route = await ctx.layers.fleet.findBestRoute(args.fromDeviceId as string, args.toDeviceId as string);
  return { speak: "Best route found.", data: { route } };
};

export const fleetWakeDevice: IntentHandler = async (args, ctx) => {
  const success = await ctx.layers.fleet.wakeDevice(args.deviceId as string);
  return { speak: "Wake signal sent.", data: { success } };
};

export const fleetGetDeviceMacAddress: IntentHandler = async (args, ctx) => {
  const mac = await ctx.layers.fleet.getDeviceMacAddress(args.deviceId as string);
  return { speak: "MAC address retrieved.", data: { mac } };
};
