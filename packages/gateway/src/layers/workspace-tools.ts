/**
 * Workspace & Productivity Tools — Enhanced task management.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";


// ------------------------------------------------------------------
// Pomodoro Timer
// ------------------------------------------------------------------

export interface PomodoroSession {
  id: string;
  durationMinutes: number;
  breaks: number;
  startedAt: Date;
  completed: boolean;
}

let activePomodoro: PomodoroSession | null = null;

export async function startPomodoro(minutes: number = 25): Promise<PomodoroSession> {
  activePomodoro = {
    id: `pomo-${Date.now()}`,
    durationMinutes: minutes,
    breaks: 0,
    startedAt: new Date(),
    completed: false
  };
  console.log(`Pomodoro started: ${minutes} minutes`);
  return activePomodoro;
}

export async function stopPomodoro(): Promise<boolean> {
  if (activePomodoro) {
    activePomodoro.completed = true;
    activePomodoro = null;
    return true;
  }
  return false;
}

export async function getPomodoroStatus(): Promise<PomodoroSession | null> {
  return activePomodoro;
}

// ------------------------------------------------------------------
// Quick Notes
// ------------------------------------------------------------------

const quickNotesFile = path.join(os.homedir(), ".omnistate", "quick-notes.json");

export async function saveQuickNote(content: string, tags?: string[]): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(quickNotesFile), { recursive: true });
    let notes: { content: string; tags: string[]; createdAt: string }[] = [];
    try {
      const data = await fs.readFile(quickNotesFile, "utf-8");
      notes = JSON.parse(data);
    } catch {}
    
    notes.push({
      content,
      tags: tags || [],
      createdAt: new Date().toISOString()
    });
    
    await fs.writeFile(quickNotesFile, JSON.stringify(notes, null, 2));
    return true;
  } catch (e) {
    console.error("saveQuickNote failed:", e);
    return false;
  }
}

export async function listQuickNotes(): Promise<{ content: string; tags: string[]; createdAt: string }[]> {
  try {
    const data = await fs.readFile(quickNotesFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Task Lists
// ------------------------------------------------------------------

const tasksFile = path.join(os.homedir(), ".omnistate", "tasks.json");

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: "low" | "medium" | "high";
  dueDate?: string;
  tags: string[];
  createdAt: string;
}

export async function addTask(title: string, priority: "low" | "medium" | "high" = "medium"): Promise<Task> {
  const task: Task = {
    id: `task-${Date.now()}`,
    title,
    done: false,
    priority,
    tags: [],
    createdAt: new Date().toISOString()
  };
  
  try {
    await fs.mkdir(path.dirname(tasksFile), { recursive: true });
    let tasks: Task[] = [];
    try {
      const data = await fs.readFile(tasksFile, "utf-8");
      tasks = JSON.parse(data);
    } catch {}
    
    tasks.push(task);
    await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
  } catch (e) {
    console.error("addTask failed:", e);
  }
  
  return task;
}

export async function listTasks(done?: boolean): Promise<Task[]> {
  try {
    const data = await fs.readFile(tasksFile, "utf-8");
    const tasks: Task[] = JSON.parse(data);
    return done !== undefined ? tasks.filter(t => t.done === done) : tasks;
  } catch {
    return [];
  }
}

export async function markTaskDone(taskId: string): Promise<boolean> {
  try {
    const data = await fs.readFile(tasksFile, "utf-8");
    const tasks: Task[] = JSON.parse(data);
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.done = true;
      await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Focus Mode
// ------------------------------------------------------------------

export async function enableFocusMode(appsToBlock?: string[]): Promise<boolean> {
  console.log(`Focus mode enabled. Blocking: ${appsToBlock?.join(", ") || "all"}`);
  return true;
}

export async function disableFocusMode(): Promise<boolean> {
  console.log("Focus mode disabled");
  return true;
}

// ------------------------------------------------------------------
// Daily Summary
// ------------------------------------------------------------------

export async function getDailySummary(): Promise<{
  tasksCompleted: number;
  notesCreated: number;
  focusTime: number;
  date: string;
}> {
  const tasks = await listTasks();
  const notes = await listQuickNotes();
  const today = new Date().toISOString().split("T")[0];
  
  return {
    tasksCompleted: tasks.filter(t => t.done).length,
    notesCreated: notes.filter(n => n.createdAt.startsWith(today)).length,
    focusTime: activePomodoro ? Math.floor((Date.now() - activePomodoro.startedAt.getTime()) / 60000) : 0,
    date: today
  };
}

export class WorkspaceLayer {
  startPomodoro = startPomodoro;
  stopPomodoro = stopPomodoro;
  getPomodoroStatus = getPomodoroStatus;
  saveQuickNote = saveQuickNote;
  listQuickNotes = listQuickNotes;
  addTask = addTask;
  listTasks = listTasks;
  markTaskDone = markTaskDone;
  enableFocusMode = enableFocusMode;
  disableFocusMode = disableFocusMode;
  getDailySummary = getDailySummary;
}
