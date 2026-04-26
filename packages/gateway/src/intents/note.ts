import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { IntentHandler, StructuredResponse } from "./types.js";

const NOTES_DIR = resolve(homedir(), ".omnistate/notes");
const NOTES_FILE = resolve(NOTES_DIR, "notes.json");

interface NoteEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

function loadNotes(): NoteEntry[] {
  if (!existsSync(NOTES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(NOTES_FILE, "utf-8")) as NoteEntry[];
  } catch {
    return [];
  }
}

function saveNotes(notes: NoteEntry[]): void {
  if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
  writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export const noteCreate: IntentHandler = async (args, _ctx): Promise<StructuredResponse> => {
  const text = String(args.text ?? "").trim();
  if (!text) return { speak: "Please provide text for the note." };

  const rawTags = args.tags;
  const tags: string[] = Array.isArray(rawTags)
    ? rawTags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const notes = loadNotes();
  const note: NoteEntry = { id: randomUUID(), text, tags, createdAt: new Date().toISOString() };
  notes.push(note);
  saveNotes(notes);

  return {
    speak: `Note saved${tags.length ? ` with tags: ${tags.join(", ")}` : ""}.`,
    data: note,
  };
};

export const noteList: IntentHandler = async (_args, _ctx): Promise<StructuredResponse> => {
  const notes = loadNotes();
  if (notes.length === 0) return { speak: "No notes found." };

  const summary = notes
    .slice(-5)
    .map((n) => `"${n.text.slice(0, 60)}${n.text.length > 60 ? "..." : ""}"`)
    .join(", ");

  return { speak: `You have ${notes.length} note${notes.length !== 1 ? "s" : ""}. Recent: ${summary}.`, data: { notes } };
};

export const noteSearch: IntentHandler = async (args, _ctx): Promise<StructuredResponse> => {
  const query = String(args.query ?? "").toLowerCase().trim();
  if (!query) return { speak: "Please provide a search query." };

  const notes = loadNotes();
  const results = notes.filter(
    (n) =>
      n.text.toLowerCase().includes(query) ||
      n.tags.some((t) => t.toLowerCase().includes(query))
  );

  if (results.length === 0) {
    return { speak: `No notes matching "${query}".` };
  }

  return {
    speak: `Found ${results.length} note${results.length !== 1 ? "s" : ""} matching "${query}".`,
    data: { results },
  };
};
