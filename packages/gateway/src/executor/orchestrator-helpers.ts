/**
 * Helper utilities for the Orchestrator.
 */

function wrapResult<T>(
  data: T,
  status: "ok" | "failed" = "ok",
  error?: string
): { data: T; status: "ok" | "failed"; error?: string } {
  return error
    ? { data: null as unknown as T, status: "failed", error }
    : { data, status };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeToolAlias(
  tool: string,
  params: Record<string, unknown>
): { tool: string; params: Record<string, unknown> } {
  const action = String(params.action ?? params.op ?? "").toLowerCase();

  if (tool === "app.control") {
    if (["move", "mouse_move", "mousemove"].includes(action)) return { tool: "ui.move", params };
    if (["click", "tap"].includes(action)) return { tool: "ui.click", params };
    if (["doubleclick", "double_click", "double-tap"].includes(action)) return { tool: "ui.doubleClickAt", params };
    if (["drag", "dragdrop", "drag_drop"].includes(action)) return { tool: "ui.drag", params };
    if (["type", "text", "input", "write"].includes(action)) return { tool: "ui.type", params };
    if (["key", "keypress", "hotkey"].includes(action)) return { tool: "ui.key", params };
    if (["scroll", "wheel"].includes(action)) return { tool: "ui.scroll", params };
    if (["find", "locate"].includes(action)) return { tool: "ui.find", params };
    return { tool: "ui.click", params };
  }

  if (tool === "app.keyboard") {
    if (["key", "keypress", "hotkey", "shortcut"].includes(action) || typeof params.key === "string") {
      return { tool: "ui.key", params };
    }
    return { tool: "ui.type", params };
  }

  if (tool === "app.mouse") {
    if (["move", "mousemove"].includes(action)) return { tool: "ui.move", params };
    if (["drag", "dragdrop", "drag_drop"].includes(action)) return { tool: "ui.drag", params };
    if (["scroll", "wheel"].includes(action)) return { tool: "ui.scroll", params };
    if (["doubleclick", "double_click"].includes(action)) return { tool: "ui.doubleClickAt", params };
    return { tool: "ui.click", params };
  }

  if (tool === "app.clipboard") {
    if (["clear"].includes(action)) return { tool: "clipboard.clear", params };
    if (["history"].includes(action)) return { tool: "clipboard.history", params };
    if (
      ["set", "write", "copy"].includes(action) ||
      typeof params.content === "string" ||
      typeof params.text === "string"
    ) {
      const next = { ...params };
      if (typeof next.content !== "string" && typeof next.text === "string") {
        next.content = next.text;
      }
      return { tool: "clipboard.set", params: next };
    }
    return { tool: "clipboard.get", params };
  }

  if (tool.startsWith("app.clipboard.")) {
    return { tool: tool.replace("app.clipboard.", "clipboard."), params };
  }

  if (tool.startsWith("app.keyboard.")) {
    const suffix = tool.slice("app.keyboard.".length);
    if (["key", "press", "tap", "hotkey", "shortcut"].includes(suffix)) {
      return { tool: "ui.key", params };
    }
    return { tool: "ui.type", params };
  }

  if (tool.startsWith("app.mouse.")) {
    const suffix = tool.slice("app.mouse.".length);
    const map: Record<string, string> = {
      move: "ui.move",
      click: "ui.click",
      doubleclick: "ui.doubleClickAt",
      drag: "ui.drag",
      scroll: "ui.scroll",
    };
    return { tool: map[suffix] ?? "ui.click", params };
  }

  if (tool === "app.screen") {
    if (["record.start", "start_record", "start-record", "record-start"].includes(action)) {
      return { tool: "screen.record.start", params };
    }
    if (["record.stop", "stop_record", "stop-record", "record-stop"].includes(action)) {
      return { tool: "screen.record.stop", params };
    }
    return { tool: "screen.capture", params };
  }

  if (tool.startsWith("app.screen.")) {
    return { tool: tool.replace("app.screen.", "screen."), params };
  }

  return { tool, params };
}

export { wrapResult, waitMs, normalizeToolAlias };
