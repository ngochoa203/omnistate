import type { IntentHandler } from "./types.js";

// ── Window management ──────────────────────────────────────────────────────────

export const windowMinimize: IntentHandler = async (args, ctx) => {
  const app = String(args.app ?? args.target ?? "");
  await ctx.layers.deep.runAppleScript(
    `tell application "System Events" to set miniaturized of (first window of (first process whose name contains "${app}")) to true`,
  );
  return { speak: "Window minimized.", data: { success: true, action: "minimized", app } };
};

export const windowMaximize: IntentHandler = async (args, ctx) => {
  const app = String(args.app ?? args.target ?? "");
  await ctx.layers.deep.runAppleScript(
    `tell application "System Events" to set value of attribute "AXFullScreen" of (first window of (first process whose name contains "${app}")) to true`,
  );
  return { speak: "Window maximized.", data: { success: true, action: "maximized", app } };
};

export const windowRestore: IntentHandler = async (args, ctx) => {
  const app = String(args.app ?? args.target ?? "");
  await ctx.layers.deep.runAppleScript(`tell application "System Events"
  set miniaturized of (first window of (first process whose name contains "${app}")) to false
  set value of attribute "AXFullScreen" of (first window of (first process whose name contains "${app}")) to false
end tell`);
  return { speak: "Window restored.", data: { success: true, action: "restored", app } };
};

export const windowSnap: IntentHandler = async (args, ctx) => {
  const position = String(args.position ?? "left");
  const app = String(args.app ?? args.target ?? "");
  let script: string;
  if (position === "left") {
    script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {0, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {960, 1050}`;
  } else if (position === "right") {
    script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {960, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {960, 1050}`;
  } else {
    script = `tell application "System Events" to tell process "${app}" to set position of window 1 to {0, 25}\ntell application "System Events" to tell process "${app}" to set size of window 1 to {1920, 525}`;
  }
  await ctx.layers.deep.runAppleScript(script);
  return { speak: `Window snapped ${position}.`, data: { success: true, position, app } };
};

export const windowFocus: IntentHandler = async (args, ctx) => {
  const app = String(args.app ?? args.target ?? "");
  await ctx.layers.deep.runAppleScript(`tell application "${app}" to activate`);
  return { speak: `${app} focused.`, data: { success: true, action: "focused", app } };
};

// ── UI Layer handlers ─────────────────────────────────────────────────────────

export const uiFind: IntentHandler = async (args, ctx) => {
  const element = await ctx.layers.surface.findElement(args.query as string);
  return { speak: "Element found.", data: { element } };
};

export const uiMove: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.moveMouse(args.x as number, args.y as number);
  return { speak: "Mouse moved.", data: {} };
};

export const uiClickAt: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.moveMouse(args.x as number, args.y as number);
  await ctx.layers.surface.click((args.button as "left" | "right" | "middle" | undefined) ?? "left");
  return { speak: "Clicked.", data: {} };
};

export const uiDoubleClickAt: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.moveMouse(args.x as number, args.y as number);
  const button = (args.button as "left" | "right" | "middle" | undefined) ?? "left";
  await ctx.layers.surface.click(button);
  await new Promise(r => setTimeout(r, 60));
  await ctx.layers.surface.click(button);
  return { speak: "Double-clicked.", data: {} };
};

export const uiDrag: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.drag(
    args.fromX as number,
    args.fromY as number,
    args.toX as number,
    args.toY as number,
  );
  return { speak: "Dragged.", data: {} };
};

export const uiType: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.typeText(args.text as string);
  return { speak: "Text typed.", data: {} };
};

export const uiKey: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.keyTap(
    args.key as string,
    args.modifiers as Parameters<typeof ctx.layers.surface.keyTap>[1],
  );
  return { speak: "Key tapped.", data: {} };
};

export const uiScroll: IntentHandler = async (args, ctx) => {
  await ctx.layers.surface.scroll(args.dx as number, args.dy as number);
  return { speak: "Scrolled.", data: {} };
};

export const uiWait: IntentHandler = async (args) => {
  await new Promise(r => setTimeout(r, (args.ms as number | undefined) ?? 300));
  return { speak: "Waited.", data: {} };
};

export const uiHighlight: IntentHandler = async (args, ctx) => {
  const fromX = Number(args.fromX ?? args.x1 ?? 0);
  const fromY = Number(args.fromY ?? args.y1 ?? 0);
  const toX = Number(args.toX ?? args.x2 ?? 0);
  const toY = Number(args.toY ?? args.y2 ?? 0);
  await ctx.layers.surface.drag(fromX, fromY, toX, toY);
  return { speak: "Text highlighted.", data: { success: true, action: "text highlighted" } };
};

export const uiDesktopSwitch: IntentHandler = async (args, ctx) => {
  const direction = String(args.direction ?? "right");
  const modifiers = { control: true };
  if (direction === "left") {
    await ctx.layers.surface.keyTap("left", modifiers);
  } else {
    await ctx.layers.surface.keyTap("right", modifiers);
  }
  return { speak: `Switched desktop ${direction}.`, data: { success: true, direction } };
};

// ── Screen ────────────────────────────────────────────────────────────────────

export const screenRecordStart: IntentHandler = async (args, ctx) => {
  const output = String(args.output ?? "~/Desktop/recording.mov");
  await ctx.layers.deep.execAsync(`screencapture -v -C -T 0 "${output}" &`, 5000);
  return { speak: "Screen recording started.", data: { success: true, output } };
};

export const screenRecordStop: IntentHandler = async (_args, ctx) => {
  await ctx.layers.deep.execAsync("pkill -f 'screencapture -v'", 5000);
  return { speak: "Screen recording stopped.", data: { success: true, action: "recording stopped" } };
};

// ── Clipboard ─────────────────────────────────────────────────────────────────

export const clipboardGet: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem!;
  const content = await deepSystem.getClipboard();
  return { speak: "Clipboard retrieved.", data: { content } };
};

export const clipboardSet: IntentHandler = async (args, ctx) => {
  const deepSystem = ctx.layers.deepSystem!;
  const success = await deepSystem.setClipboard(args.content as string);
  return { speak: "Clipboard set.", data: { success } };
};

export const clipboardHistory: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem!;
  const history = await deepSystem.getClipboardHistory();
  return { speak: "Clipboard history retrieved.", data: { history } };
};

export const clipboardClear: IntentHandler = async (_args, ctx) => {
  const deepSystem = ctx.layers.deepSystem!;
  const success = await deepSystem.clearClipboard();
  return { speak: "Clipboard cleared.", data: { success } };
};
