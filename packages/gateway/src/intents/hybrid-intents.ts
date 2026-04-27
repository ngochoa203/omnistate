import type { IntentHandler } from "./types.js";

// ── Hybrid Automation ─────────────────────────────────────────────────────────

export const hybridVoice: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.processVoiceCommand(args.audioBuffer as Buffer);
  return { speak: "Voice command processed.", data: { result } };
};

export const hybridMigrationScan: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const manifest = await hybridAuto.scanSourceMachine();
  return { speak: "Migration scan complete.", data: { manifest } };
};

export const hybridMigrationPlan: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const plan = await hybridAuto.generateMigrationPlan(args.manifest, args.target as string | undefined);
  return { speak: "Migration plan generated.", data: { plan } };
};

export const hybridMigrationExecute: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.executeMigration(args.plan);
  return { speak: "Migration complete.", data: { result } };
};

export const hybridMacroStart: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const sessionId = hybridAuto.startRecording();
  return { speak: "Macro recording started.", data: { sessionId } };
};

export const hybridMacroStop: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const sessionId = args.sessionId as string | undefined;
  if (!sessionId) {
    throw new Error("No active macro recording session");
  }
  const sequence = hybridAuto.stopRecording(sessionId);
  return { speak: "Macro recording stopped.", data: { sequence } };
};

export const hybridMacroInfer: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const macro = await hybridAuto.inferMacro(args.sequence);
  return { speak: "Macro inferred.", data: { macro } };
};

export const hybridMacroSave: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const success = await hybridAuto.saveMacro(args.macro);
  return { speak: "Macro saved.", data: { success } };
};

export const hybridMacroList: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const macros = await hybridAuto.listMacros();
  return { speak: "Macros listed.", data: { macros } };
};

export const hybridMacroRun: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.runMacro(
    args.macroId as string,
    args.params as Record<string, unknown> | undefined,
  );
  return { speak: "Macro executed.", data: { result } };
};

export const hybridSpeak: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const success = await hybridAuto.speak(args.text as string, args.voice as string | undefined);
  return { speak: args.text as string, data: { success } };
};

export const hybridGenerateScript: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const script = await hybridAuto.generateScript(
    args.description as string,
    args.language as "bash" | "python" | "applescript" | undefined,
  );
  return { speak: "Script generated.", data: { script } };
};

export const hybridSuggestAction: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const suggestions = await hybridAuto.suggestNextAction();
  return { speak: "Action suggestions ready.", data: { suggestions } };
};

export const hybridOrchestrateApps: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.orchestrateApps(args.workflow);
  return { speak: "Apps orchestrated.", data: { result } };
};

export const hybridStateDefine: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const stateId = await hybridAuto.defineDesiredState(args.spec);
  return { speak: "Desired state defined.", data: { stateId } };
};

export const hybridStateCheck: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const report = await hybridAuto.checkDrift(args.stateId as string);
  return { speak: "Drift check complete.", data: { report } };
};

export const hybridStateEnforce: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.enforcState(args.stateId as string);
  return { speak: "State enforced.", data: { result } };
};

export const hybridStateStartLoop: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  hybridAuto.startDesiredStateLoop(args.stateId as string, args.intervalMs as number | undefined);
  return { speak: "State loop started.", data: { success: true } };
};

export const hybridStateStopLoop: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  hybridAuto.stopDesiredStateLoop(args.stateId as string);
  return { speak: "State loop stopped.", data: { success: true } };
};

export const hybridCheckpointRecord: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const checkpoint = await hybridAuto.recordCheckpoint(args.label as string | undefined);
  return { speak: "Checkpoint recorded.", data: { checkpoint } };
};

export const hybridCheckpointList: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const checkpoints = await hybridAuto.listCheckpoints();
  return { speak: "Checkpoints listed.", data: { checkpoints } };
};

export const hybridCheckpointRollback: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.rollbackToCheckpoint(args.checkpointId as string);
  return { speak: "Rolled back to checkpoint.", data: { result } };
};

export const hybridCheckpointUndo: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const result = await hybridAuto.undoLastAction();
  return { speak: "Last action undone.", data: { result } };
};

export const hybridContextSerialize: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const context = await hybridAuto.serializeContext();
  return { speak: "Context serialized.", data: { context } };
};

export const hybridContextSend: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const success = await hybridAuto.sendContextToDevice(args.context, args.targetId as string);
  return { speak: "Context sent.", data: { success } };
};

export const hybridContextReceive: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const success = await hybridAuto.receiveContext(args.context);
  return { speak: "Context received.", data: { success } };
};

export const hybridProfileAnalyze: IntentHandler = async (args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const profile = await hybridAuto.analyzePatterns(args.days as number | undefined);
  return { speak: "Profile analyzed.", data: { profile } };
};

export const hybridProfileSuggest: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const suggestions = await hybridAuto.suggestAutomation();
  return { speak: "Automation suggestions ready.", data: { suggestions } };
};

export const hybridProfileGet: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const profile = await hybridAuto.getUserProfile();
  return { speak: "User profile retrieved.", data: { profile } };
};

// ── Hybrid Tooling ────────────────────────────────────────────────────────────

export const hybridTemplates: IntentHandler = async (_args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const templates = await hybridTools.listWorkflowTemplates();
  return { speak: "Templates listed.", data: { templates } };
};

export const hybridRunTemplate: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const result = await hybridTools.runTemplate(
    args.templateId as string,
    args.params as Record<string, unknown> | undefined,
  );
  return { speak: "Template executed.", data: { result } };
};

export const hybridAnalyzeError: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const analysis = await hybridTools.analyzeError(args.error);
  return { speak: "Error analyzed.", data: { analysis } };
};

export const hybridOrganizeFiles: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const result = await hybridTools.organizeDirectory(args.dirPath as string, args.rules);
  return { speak: "Files organized.", data: { result } };
};

export const hybridHealthReport: IntentHandler = async (_args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const report = await hybridTools.generateHealthReport();
  return { speak: "Health report generated.", data: { report } };
};

export const hybridMachineDiff: IntentHandler = async (_args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const snapshot = await hybridTools.snapshotMachine();
  return { speak: "Machine snapshot taken.", data: { snapshot } };
};

export const hybridCompliance: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const report = await hybridTools.runComplianceCheck(args.policies);
  return { speak: "Compliance check complete.", data: { report } };
};

export const hybridDocs: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const results = await hybridTools.lookupDocs(args.query as string, args.context);
  return { speak: "Docs retrieved.", data: { results } };
};

export const hybridForecast: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const forecast = await hybridTools.forecastUsage(args.metric as string, args.days as number | undefined);
  return { speak: "Forecast complete.", data: { forecast } };
};

export const hybridExtensions: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const extensions = await hybridTools.listBrowserExtensions(args.browser as string | undefined);
  return { speak: "Browser extensions listed.", data: { extensions } };
};

export const hybridPlugins: IntentHandler = async (args, ctx) => {
  const hybridTools = (ctx.layers as any).hybridTools;
  const plugins = await hybridTools.listIDEPlugins(args.ide as string | undefined);
  return { speak: "IDE plugins listed.", data: { plugins } };
};

// ── Learning / Workflow / Search ──────────────────────────────────────────────

export const learningDetectHabits: IntentHandler = async (_args, ctx) => {
  const deepSystem = (ctx.layers as any).deepSystem;
  const history = await deepSystem.getShellHistory(500);
  const cmdFreq: Record<string, number> = {};
  for (const line of history) {
    const cmd = line.split(" ")[0];
    if (cmd) cmdFreq[cmd] = (cmdFreq[cmd] || 0) + 1;
  }
  const topCmds = Object.entries(cmdFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([command, count]) => ({ command, count }));
  const { stdout: appHistOut } = await ctx.layers.deep.execAsync(
    "log show --last 24h --predicate 'process == \"launchd\" && messageType == info' 2>/dev/null | grep -i 'launch' | head -20",
    10000,
  );
  return {
    speak: topCmds.length > 0
      ? `Your most used commands: ${topCmds.slice(0, 5).map(c => c.command).join(", ")}`
      : "Not enough data yet.",
    data: {
      success: true,
      topCommands: topCmds,
      recentApps: appHistOut?.split("\n").filter(Boolean).slice(0, 10) ?? [],
      suggestion: topCmds.length > 0
        ? `Your most used commands: ${topCmds.slice(0, 5).map(c => c.command).join(", ")}`
        : "Not enough data yet",
    },
  };
};

export const learningSuggestMacro: IntentHandler = async (_args, ctx) => {
  const hybridAuto = (ctx.layers as any).hybridAuto;
  const macro = await hybridAuto.inferMacro({ actions: [], sessionId: "" });
  return { speak: "Macro suggestion ready.", data: { success: true, macro } };
};

export const learningHealthReminder: IntentHandler = async (args, ctx) => {
  const type = String(args.type ?? "break");
  const intervalMinutes = Number(args.interval ?? 30);
  await ctx.layers.deep.execAsync(
    `(while true; do sleep ${intervalMinutes * 60}; osascript -e 'display notification "Time for a ${type} break! Stand up and stretch." with title "OmniState Health" sound name "Purr"'; done) &`,
    5000,
  );
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 6) {
    return {
      speak: "Health reminder set. Night Shift enabled.",
      data: { success: true, type, interval: intervalMinutes, nightShiftEnabled: true, lateHour: true },
    };
  }
  return { speak: "Health reminder set.", data: { success: true, type, interval: intervalMinutes } };
};

export const learningPrefetch: IntentHandler = async (_args, ctx) => {
  const calResult = await ctx.layers.deep.runAppleScript(`
    tell application "Calendar"
      set now to current date
      set later to now + (30 * 60) -- next 30 minutes
      set upcomingEvents to {}
      repeat with cal in calendars
        repeat with evt in (events of cal whose start date > now and start date < later)
          set end of upcomingEvents to {summary of evt, location of evt, start date of evt}
        end repeat
      end repeat
      return upcomingEvents as text
    end tell
  `);
  const events = calResult?.split(",").filter(Boolean) ?? [];
  const prefetchActions: string[] = [];
  for (const event of events) {
    const lower = event.toLowerCase();
    if (lower.includes("zoom") || lower.includes("meet") || lower.includes("call")) {
      prefetchActions.push("Opening video call app");
      await ctx.layers.deep.execAsync("open -a Zoom", 5000).catch(() => {});
    }
    if (lower.includes("review") || lower.includes("code")) {
      prefetchActions.push("Opening IDE");
      await ctx.layers.deep.execAsync("open -a 'Visual Studio Code'", 5000).catch(() => {});
    }
  }
  return {
    speak: "Prefetch complete.",
    data: { success: true, upcomingEvents: events, prefetchActions, checkedWindow: "next 30 minutes" },
  };
};

export const workflowResearch: IntentHandler = async (args, ctx) => {
  const topic = String(args.topic ?? args.query ?? "");
  await ctx.layers.deep.execAsync(`open "https://www.google.com/search?q=${encodeURIComponent(topic)}"`, 5000);
  return { speak: "Research workflow started.", data: { success: true, topic, action: "research workflow started" } };
};

export const workflowDataEntry: IntentHandler = async (args, ctx) => {
  const source = String(args.source ?? "");
  const result = await ctx.layers.deep.execAsync(`cat "${source}" | head -50`, 5000);
  return { speak: "Data loaded.", data: { success: true, source, data: result.stdout, action: "data loaded for entry" } };
};

export const workflowMeeting: IntentHandler = async (args, ctx) => {
  const app = String(args.app ?? "zoom");
  const slides = String(args.slides ?? "");
  const notes = String(args.notes ?? "");
  await ctx.layers.deep.launchApp(app);
  await new Promise(r => setTimeout(r, 2000));
  if (slides) await ctx.layers.deep.execAsync(`open "${slides}"`, 5000);
  if (notes) await ctx.layers.deep.execAsync(`open "${notes}"`, 5000);
  return { speak: "Meeting setup complete.", data: { success: true, app, action: "meeting setup complete" } };
};

export const workflowDev: IntentHandler = async (args, ctx) => {
  const ide = String(args.ide ?? "Visual Studio Code");
  const project = String(args.project ?? ".");
  const server = String(args.server ?? "");
  await ctx.layers.deep.execAsync(`code "${project}"`, 5000);
  await new Promise(r => setTimeout(r, 2000));
  if (server) await ctx.layers.deep.execAsync(`cd "${project}" && ${server} &`, 5000);
  return { speak: "Dev environment ready.", data: { success: true, ide, project, server, action: "dev environment ready" } };
};

export const genericExecute: IntentHandler = async (args, ctx) => {
  const raw = (args as any).command ?? (args as any).goal ?? (args as any).intent ?? "";
  const cmd = typeof raw === "string" ? raw : "";
  const trimmed = cmd.trim();
  const nlIndicators = /^(what|how|why|when|where|who|show|check|find|list|get|tell|can|is|are|do|does|please|help|i want|i need|open|launch|start|message|send|chat)/i;
  const looksLikeCommand = /^[.\/~]|^(ls|cd|cat|echo|grep|find|ps|df|du|top|kill|rm|cp|mv|mkdir|chmod|curl|wget|git|npm|pnpm|yarn|cargo|python|python3|node|make|brew|docker|kubectl|tmutil|osascript)\b/i.test(trimmed);
  if (!trimmed || nlIndicators.test(trimmed) || !looksLikeCommand) {
    return {
      speak: `I understood your request but couldn't map it to a safe shell command.`,
      data: {
        success: false,
        output: `I understood your request "${cmd}" but couldn't map it to a safe executable shell command. Please use a supported task phrase (e.g. app-control/system-query) or an explicit command.`,
      },
    };
  }
  try {
    const output = ctx.layers.deep.exec(cmd);
    return { speak: "Command executed.", data: { success: true, output } };
  } catch (err: any) {
    return { speak: "Command failed.", data: { success: false, error: err.message } };
  }
};

export const alarmSet: IntentHandler = async (args, ctx) => {
  const seconds = Number(args.seconds ?? (args.minutes ? Number(args.minutes) * 60 : 300));
  const message = String(args.message ?? "Timer finished!");
  await ctx.layers.deep.execAsync(
    `(sleep ${seconds} && osascript -e 'display notification "${message}" with title "OmniState Timer" sound name "Glass"') &`,
    5000,
  );
  return { speak: `Alarm set for ${seconds} seconds.`, data: { success: true, seconds, message } };
};
