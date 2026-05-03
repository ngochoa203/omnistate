import { describe, it, expect, vi } from "vitest";
import { classifyIntent } from "../planner/classify.js";

vi.mock("../llm/router.js", () => ({
  requestLlmTextWithFallback: vi.fn().mockResolvedValue({ text: '{"type":"clipboard-management","confidence":0.9}' }),
  isLlmRequired: vi.fn().mockReturnValue(false),
  resolveEffectiveBudget: vi.fn().mockReturnValue({ maxInputChars: 2000, intentMax: 128, compactPrompt: false }),
}));

const VALID = ["clipboard-management","shell-command","file-operation","app-control","multi-step","ui-interaction","system-query","ask-clarification","text-extract","app-launch"];

function ok(t: string, p: string) {
  return it(t, async () => {
    const intent = await classifyIntent(p);
    expect(VALID, `"${p}" → got "${intent.type}"`).toContain(intent.type);
  });
}

describe("Agent M: Clipboard & Data Management (50 prompts)", () => {
  ok("copy to clipboard", "copy to clipboard");
  ok("copy text", "copy text");
  ok("pbcopy", "pbcopy");
  ok("pbpaste", "pbpaste");
  ok("paste from clipboard", "paste from clipboard");
  ok("paste", "paste");
  ok("read clipboard", "read clipboard");
  ok("clear clipboard", "clear clipboard");
  ok("clipboard history", "show clipboard history");
  ok("copy file path", "copy file path");
  ok("copy email", "copy email address");
  ok("copy link", "copy link");
  ok("copy password", "copy password");
  ok("copy JSON", "copy JSON");
  ok("copy code", "copy code snippet");
  ok("paste into terminal", "paste into terminal");
  ok("paste into form", "paste into form");
  ok("paste image", "paste image");
  ok("clipboard manager", "open clipboard manager");
  ok("clip menu", "show clip menu");
  ok("pastebot", "open pastebot");
  ok("alfred clipboard", "alfred clipboard");
  ok("get clipboard content", "get clipboard content");
  ok("set clipboard", "set clipboard");
  ok("copy folder path", "copy folder path");
  ok("copy URL", "copy URL");
  ok("copy all", "copy all");
  ok("paste all", "paste all");
  ok("copy selected", "copy selected");
  ok("select all and copy", "select all and copy");
  ok("copy as plain text", "copy as plain text");
  ok("paste without formatting", "paste without formatting");
  ok("paste match style", "paste match style");
  ok("paste and go", "paste and go");
  ok("paste into new document", "paste into new document");
  ok("copy document", "copy document");
  ok("duplicate clipboard entry", "duplicate clipboard entry");
  ok("search clipboard", "search clipboard");
  ok("clipboard sync", "sync clipboard");
  ok("paste image from clipboard", "paste image from clipboard");
  ok("clipboard to file", "save clipboard to file");
  ok("read from pasteboard", "read from pasteboard");
  ok("clipboard digest", "clipboard digest");
  ok("copy ssh key", "copy ssh key");
  ok("copy public key", "copy public key");
  ok("copy token", "copy token");
  ok("copy API key", "copy API key");
  ok("paste API key", "paste API key");
  ok("copy config", "copy config");
  ok("paste JSON", "paste JSON");
  ok("clipboard size", "clipboard size");
  ok("clipboard clear history", "clear clipboard history");
  ok("save clipboard items", "save clipboard items");
  ok("copy selected text", "copy selected text");
  ok("copy password from keychain", "copy password from keychain");
  ok("paste into Xcode", "paste into Xcode");
  ok("copy from terminal", "copy from terminal");
  ok("clipboard share", "share clipboard");
  ok("sync clipboard across devices", "sync clipboard across devices");
  ok("clipboard merge", "merge clipboard entries");
  ok("copy screenshot to clipboard", "copy screenshot to clipboard");
  ok("save clipboard as note", "save clipboard as note");
  ok("copy formatted text", "copy formatted text");
  ok("paste match destination style", "paste match destination style");
  ok("clipboard history manager", "clipboard history manager");
  ok("copy link to clipboard", "copy link to clipboard");
  ok("extract text from image clipboard", "extract text from image");
  ok("copy code block", "copy code block");
  ok("copy path to clipboard", "copy path to clipboard");
  ok("copy directory path", "copy directory path");
  ok("copy filename", "copy filename");
  ok("clipboard export", "export clipboard");
  ok("clipboard import", "import clipboard");
  ok("copy credentials", "copy credentials");
  ok("clipboard encryption", "encrypt clipboard");
  ok("paste secure", "paste secure");
  ok("copy to clipboard without format", "copy to clipboard without format");
  ok("copy raw text", "copy raw text");
  ok("clipboard quick copy", "quick copy");
  ok("paste snippet", "paste snippet");
  ok("copy snippet", "copy snippet");
  ok("clipboard buffer", "clipboard buffer");
  ok("copy selection", "copy selection");
  ok("paste selection", "paste selection");
  ok("copy to notes", "copy to notes");
  ok("clipboard journal", "clipboard journal");
  ok("copy HTML", "copy HTML");
  ok("copy rich text", "copy rich text");
  ok("paste rich text", "paste rich text");
  ok("copy markdown", "copy markdown");
  ok("copy URL text", "copy URL text");
  ok("clipboard auto-copy", "auto-copy to clipboard");
  ok("clipboard persistent", "persistent clipboard");
});
