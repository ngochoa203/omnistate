import type { IntentHandler } from "./types.js";

// ── Shell ─────────────────────────────────────────────────────────────────────

export const shellType: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const shellType = await deepSystem.getShellType();
  return { speak: "Shell type retrieved.", data: { shellType } };
};

export const shellConfig: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const config = await deepSystem.getShellConfig();
  return { speak: "Shell config retrieved.", data: { config } };
};

export const shellAddAlias: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.addAlias(args.name as string, args.command as string);
  return { speak: "Alias added.", data: { success } };
};

export const shellRemoveAlias: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.removeAlias(args.name as string);
  return { speak: "Alias removed.", data: { success } };
};

export const shellAliases: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const aliases = await deepSystem.listAliases();
  return { speak: "Aliases listed.", data: { aliases } };
};

export const shellAddToPath: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.addToPath(args.dir as string);
  return { speak: "Path updated.", data: { success } };
};

export const shellHistory: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const history = await deepSystem.getShellHistory(args.limit as number | undefined);
  return { speak: "Shell history retrieved.", data: { history } };
};

export const nlToCommand: IntentHandler = async (args, ctx) => {
  const text = String(args.text ?? args.query ?? "");
  const { classifyIntent } = await import("../planner/intent.js");
  const intent = await classifyIntent(text);
  const cmdEntity = Object.values(intent.entities ?? {}).find((e: any) => e.type === "command");
  const nlCmd = (cmdEntity as any)?.value ?? intent.rawText ?? "";
  if (
    nlCmd &&
    /^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|python3|node|make|brew|docker|kubectl|tmutil|osascript)\b/i.test(
      nlCmd.trim(),
    )
  ) {
    const { stdout: nlOut } = await ctx.layers.deep.execAsync(nlCmd, 30000);
    return { speak: "Command executed.", data: { success: true, originalText: text, command: nlCmd, output: nlOut } };
  }
  return { speak: "Could not convert to shell command.", data: { success: false, error: "Could not convert to shell command", text } };
};

// ── Git ───────────────────────────────────────────────────────────────────────

export const gitStatus: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? args.directory ?? ".");
  const { stdout } = await ctx.layers.deep.execAsync(`cd "${dir}" && git status --short --branch`, 10000);
  return { speak: "Git status retrieved.", data: { success: true, output: stdout } };
};

export const gitCommit: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? ".");
  const message = String(args.message ?? "Auto-commit by OmniState");
  const addAll = args.addAll !== false;
  if (addAll) {
    await ctx.layers.deep.execAsync(`cd "${dir}" && git add -A`, 10000);
  }
  const { stdout } = await ctx.layers.deep.execAsync(`cd "${dir}" && git commit -m "${message}"`, 10000);
  return { speak: "Committed.", data: { success: true, message, output: stdout } };
};

export const gitPush: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? ".");
  const branch = String(args.branch ?? "");
  const cmd = branch ? `cd "${dir}" && git push origin "${branch}"` : `cd "${dir}" && git push`;
  const { stdout } = await ctx.layers.deep.execAsync(cmd, 30000);
  return { speak: "Pushed.", data: { success: true, output: stdout } };
};

export const gitPull: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? ".");
  const { stdout } = await ctx.layers.deep.execAsync(`cd "${dir}" && git pull`, 30000);
  return { speak: "Pulled.", data: { success: true, output: stdout } };
};

export const gitBranch: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? ".");
  const name = String(args.name ?? "");
  const action = String(args.action ?? "create");
  let cmd: string;
  switch (action) {
    case "create": cmd = `cd "${dir}" && git checkout -b "${name}"`; break;
    case "switch": cmd = `cd "${dir}" && git checkout "${name}"`; break;
    case "delete": cmd = `cd "${dir}" && git branch -d "${name}"`; break;
    default: cmd = `cd "${dir}" && git branch -a`; break;
  }
  const { stdout } = await ctx.layers.deep.execAsync(cmd, 10000);
  return { speak: "Branch operation complete.", data: { success: true, action, name, output: stdout } };
};

// ── Docker ────────────────────────────────────────────────────────────────────

export const dockerPs: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const containers = await deepSystem.listContainers();
  return { speak: "Containers listed.", data: { success: true, containers } };
};

export const dockerStart: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const name = String(args.name ?? args.container ?? "");
  const success = await deepSystem.startContainer(name);
  return { speak: `Container ${name} started.`, data: { success, name, action: "started" } };
};

export const dockerStop: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const name = String(args.name ?? args.container ?? "");
  const success = await deepSystem.stopContainer(name);
  return { speak: `Container ${name} stopped.`, data: { success, name, action: "stopped" } };
};

export const dockerCompose: IntentHandler = async (args, ctx) => {
  const dir = String(args.dir ?? ".");
  const action = String(args.action ?? "up");
  const detach = action === "up" ? "-d" : "";
  const { stdout } = await ctx.layers.deep.execAsync(`cd "${dir}" && docker compose ${action} ${detach}`, 60000);
  return { speak: "Docker Compose operation complete.", data: { success: true, action, output: stdout } };
};

export const dockerStatus: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const running = await deepSystem.isDockerRunning();
  return { speak: running ? "Docker is running." : "Docker is not running.", data: { running } };
};

// ── Container ─────────────────────────────────────────────────────────────────

export const containerList: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const containers = await deepSystem.listContainers(args.all as boolean | undefined);
  return { speak: "Containers listed.", data: { containers } };
};

export const containerStart: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.startContainer(args.id as string);
  return { speak: "Container started.", data: { success } };
};

export const containerStop: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.stopContainer(args.id as string);
  return { speak: "Container stopped.", data: { success } };
};

export const containerRemove: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.removeContainer(args.id as string);
  return { speak: "Container removed.", data: { success } };
};

export const containerLogs: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const logs = await deepSystem.getContainerLogs(args.id as string, args.tail as number | undefined);
  return { speak: "Container logs retrieved.", data: { logs } };
};

export const containerImages: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const images = await deepSystem.listImages();
  return { speak: "Images listed.", data: { images } };
};

export const containerPull: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.pullImage(args.name as string);
  return { speak: "Image pulled.", data: { success } };
};

// ── VM ────────────────────────────────────────────────────────────────────────

export const vmList: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const vms = await deepSystem.listVMs();
  return { speak: "VMs listed.", data: { vms } };
};

export const vmStart: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.startVM(args.name as string);
  return { speak: "VM started.", data: { success } };
};

export const vmStop: IntentHandler = async (args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const success = await deepSystem.stopVM(args.name as string);
  return { speak: "VM stopped.", data: { success } };
};

// ── Developer layer ───────────────────────────────────────────────────────────

export const devOpenTerminal: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  await developer.openTerminal(args);
  return { speak: "Terminal opened.", data: { success: true } };
};

export const devRunCommand: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.runCommand(args.command as string, args);
  return { speak: "Command executed.", data: result };
};

export const devRunCommandAsync: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.runCommandAsync(args.command as string, args);
  return { speak: "Command started.", data: result };
};

export const devGetRunningShells: IntentHandler = async (_args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const shells = await developer.getRunningShells();
  return { speak: "Running shells retrieved.", data: { shells } };
};

export const devGetShellHistory: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const history = await developer.getShellHistory((args.shell as "zsh" | "bash" | undefined) ?? "zsh", args.limit as number | undefined);
  return { speak: "Shell history retrieved.", data: { history } };
};

export const devGetEnvironment: IntentHandler = async (_args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const env = await developer.getEnvironment();
  return { speak: "Environment retrieved.", data: { env } };
};

export const devGitStatus: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const status = await developer.gitStatus(args.repoPath as string | undefined);
  return { speak: "Git status retrieved.", data: status };
};

export const devGitLog: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const log = await developer.gitLog(args.repoPath as string | undefined, args.limit as number | undefined);
  return { speak: "Git log retrieved.", data: { log } };
};

export const devGitDiff: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const diff = await developer.gitDiff(args.repoPath as string | undefined, args.staged as boolean | undefined);
  return { speak: "Git diff retrieved.", data: { diff } };
};

export const devGitBranches: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const branches = await developer.gitBranches(args.repoPath as string | undefined);
  return { speak: "Git branches retrieved.", data: { branches } };
};

export const devGitCommit: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.gitCommit(args.message as string, args.repoPath as string | undefined);
  return { speak: "Committed.", data: result };
};

export const devGitPush: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.gitPush(args.repoPath as string | undefined, args.remote as string | undefined, args.branch as string | undefined);
  return { speak: "Pushed.", data: result };
};

export const devGitPull: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.gitPull(args.repoPath as string | undefined, args.remote as string | undefined);
  return { speak: "Pulled.", data: result };
};

export const devGitClone: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.gitClone(args.url as string, args.destination as string | undefined);
  return { speak: "Repository cloned.", data: result };
};

export const devOpenInEditor: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  await developer.openInEditor(args.path as string, args.editor);
  return { speak: "Opened in editor.", data: { success: true } };
};

export const devOpenProject: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  await developer.openProject(args.path as string, args.editor);
  return { speak: "Project opened.", data: { success: true } };
};

export const devGetOpenEditors: IntentHandler = async (_args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const editors = await developer.getOpenEditors();
  return { speak: "Open editors retrieved.", data: { editors } };
};

export const devSearchInProject: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const results = await developer.searchInProject(
    args.query as string,
    (args.projectPath as string | undefined) ?? process.cwd(),
    args.options,
  );
  return { speak: "Search complete.", data: { results } };
};

export const devGetProjectStructure: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const structure = await developer.getProjectStructure(args.path as string, args.depth as number | undefined);
  return { speak: "Project structure retrieved.", data: { structure } };
};

export const devDockerPs: IntentHandler = async (_args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const containers = await developer.dockerPs();
  return { speak: "Containers listed.", data: { containers } };
};

export const devDockerImages: IntentHandler = async (_args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const images = await developer.dockerImages();
  return { speak: "Images listed.", data: { images } };
};

export const devDockerRun: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.dockerRun(args);
  return { speak: "Container started.", data: result };
};

export const devDockerStop: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  await developer.dockerStop(args.containerId as string);
  return { speak: "Container stopped.", data: { success: true } };
};

export const devDockerLogs: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const logs = await developer.dockerLogs(args.containerId as string, args.lines as number | undefined);
  return { speak: "Container logs retrieved.", data: { logs } };
};

export const devDockerCompose: IntentHandler = async (args, ctx) => {
  const developer = (ctx.layers as any).developer;
  const result = await developer.dockerCompose(args.action, args.projectPath as string | undefined);
  return { speak: "Docker Compose operation complete.", data: result };
};

// ── Log analysis ──────────────────────────────────────────────────────────────

export const logAnalyze: IntentHandler = async (args, ctx) => {
  const logPath = String(args.path ?? "");
  const filter = String(args.filter ?? "error|warning|fatal|exception");
  const lines = Number(args.lines ?? 100);
  let logOut: string;
  if (logPath) {
    const r = await ctx.layers.deep.execAsync(`grep -iE "${filter}" "${logPath}" | tail -${lines}`, 15000);
    logOut = r.stdout ?? "";
  } else {
    const r = await ctx.layers.deep.execAsync(`log show --last 1h --predicate 'messageType == error' | tail -${lines}`, 15000);
    logOut = r.stdout ?? "";
  }
  const logLines = logOut.split("\n").filter(Boolean);
  return {
    speak: `Found ${logLines.length} log entries.`,
    data: { success: true, path: logPath, filter, count: logLines.length, logs: logLines.slice(-20) },
  };
};
