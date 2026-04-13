export interface MemoryContextInput {
  goal: string;
  provider: string;
  model: string;
  sharedMemorySummary: string;
  sessionMemorySummary: string;
}

const MAX_ENTRY_LENGTH = 320;
const MAX_SUMMARY_LENGTH = 1600;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function buildMemoryEntry(userText?: string, assistantText?: string): string {
  const user = compactText(userText ?? "");
  const assistant = compactText(assistantText ?? "");
  if (!user && !assistant) return "";

  const userPart = user ? `U: ${truncate(user, 140)}` : "";
  const assistantPart = assistant ? `A: ${truncate(assistant, 170)}` : "";
  return truncate([userPart, assistantPart].filter(Boolean).join(" | "), MAX_ENTRY_LENGTH);
}

export function summarizeMemory(previousSummary: string, nextEntry?: string): string {
  const prior = compactText(previousSummary);
  const entry = compactText(nextEntry ?? "");
  if (!entry) return prior;

  const merged = prior
    ? `${prior}\n- ${entry}`
    : `- ${entry}`;

  if (merged.length <= MAX_SUMMARY_LENGTH) return merged;

  const lines = merged.split("\n").filter(Boolean);
  const recent = lines.slice(-8).join("\n");
  return truncate(recent, MAX_SUMMARY_LENGTH);
}

export function buildTaskGoalWithMemory(input: MemoryContextInput): string {
  const goal = input.goal.trim();
  const provider = compactText(input.provider);
  const model = compactText(input.model);
  const shared = compactText(input.sharedMemorySummary);
  const session = compactText(input.sessionMemorySummary);

  const contextLines = [
    provider || model ? `Model route: provider=${provider || "default"}, model=${model || "default"}` : "",
    shared ? `Shared memory: ${truncate(shared, 600)}` : "",
    session ? `Session memory: ${truncate(session, 600)}` : "",
  ].filter(Boolean);

  if (contextLines.length === 0) return goal;

  return `${goal}\n\n[Context]\n${contextLines.join("\n")}`;
}
