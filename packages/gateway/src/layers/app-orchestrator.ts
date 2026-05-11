/**
 * App Orchestrator — executes multi-step UI automation workflows.
 *
 * Example use:
 * "Mở app zalo và nhắn tin cho Con Lợn nhắn 'Anh yêu em'"
 *
 * Steps:
 * 1. app.open → { app: "Zalo" }
 * 2. app.wait → { seconds: 2 }
 * 3. contact.search → { contact: "Con Lợn" }
 * 4. app.wait → { seconds: 1 }
 * 5. click → { x: 300, y: 150 } (first search result)
 * 6. message.send → { message: "Anh yêu em" }
 */

import * as ui from "./ui-automation.js";
import * as fileOps from "./file-orchestrator.js";
import * as sysOps from "./system-advanced.js";
import * as commOps from "./communication-advanced.js";
import * as noteOps from "./notes-tasks.js";
import * as prodOps from "./productivity.js";
import * as dataOps from "./data-processing.js";
import * as aiOps from "./ai-integration.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("app-orchestrator");

export interface OrchestrateStep {
  action: string;
  params: Record<string, unknown>;
}

export interface StepResult {
  step: number;
  action: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface OrchestrateResult {
  session_id?: string;
  completed: boolean;
  steps: StepResult[];
  screenshot?: string;
}

// ------------------------------------------------------------------
// Step Executors
// ------------------------------------------------------------------

async function executeStep(step: OrchestrateStep, stepIndex: number): Promise<StepResult> {
  const { action, params } = step;

  try {
    switch (action) {
      // App lifecycle
      case "app.open": {
        const app = params.app as string;
        log.info(`Opening app: ${app}`);
        const ok = await ui.openApp(app);
        return { step: stepIndex, action, success: ok, output: ok ? `Opened ${app}` : `Failed to open ${app}` };
      }

      case "app.close": {
        const app = params.app as string;
        log.info(`Closing app: ${app}`);
        const ok = await ui.closeApp(app);
        return { step: stepIndex, action, success: ok, output: ok ? `Closed ${app}` : `Failed to close ${app}` };
      }

      case "app.wait": {
        const seconds = (params.seconds ?? params.wait ?? 1) as number;
        log.info(`Waiting ${seconds}s`);
        await ui.sleep(seconds);
        return { step: stepIndex, action, success: true, output: `Waited ${seconds}s` };
      }

      case "app.focus": {
        const app = params.app as string;
        const ok = await ui.focusApp(app);
        return { step: stepIndex, action, success: ok, output: ok ? `Focused ${app}` : `Failed to focus ${app}` };
      }

      case "app.running": {
        const app = params.app as string;
        const running = await ui.isAppRunning(app);
        return { step: stepIndex, action, success: true, output: running ? "Running" : "Not running" };
      }

      // Mouse actions
      case "click": {
        if (params.x !== undefined && params.y !== undefined) {
          await ui.clickAt(params.x as number, params.y as number, (params.button as "left" | "right") || "left");
        } else if (params.element) {
          // Find element - would need position from accessibility API
          log.warn(`Click by element not fully implemented: ${params.element}`);
        }
        return { step: stepIndex, action, success: true };
      }

      case "double_click":
      case "doubleClick": {
        if (params.x !== undefined && params.y !== undefined) {
          await ui.doubleClickAt(params.x as number, params.y as number);
        }
        return { step: stepIndex, action, success: true };
      }

      case "right_click":
      case "rightClick": {
        if (params.x !== undefined && params.y !== undefined) {
          await ui.rightClickAt(params.x as number, params.y as number);
        }
        return { step: stepIndex, action, success: true };
      }

      // Keyboard actions
      case "type": {
        const text = params.text as string;
        await ui.typeText(text);
        return { step: stepIndex, action, success: true, output: `Typed: ${text.substring(0, 50)}` };
      }

      case "paste": {
        const text = params.text as string;
        await ui.pasteText(text);
        return { step: stepIndex, action, success: true, output: `Pasted: ${text.substring(0, 50)}` };
      }

      case "key": {
        const key = params.key as string;
        const modifiers = (params.modifiers || []) as ("command" | "shift" | "option" | "control")[];
        await ui.pressKey(key, modifiers);
        return { step: stepIndex, action, success: true };
      }

      case "key.enter":
      case "enter": {
        await ui.pressEnter();
        return { step: stepIndex, action, success: true };
      }

      case "key.tab":
      case "tab": {
        await ui.pressTab();
        return { step: stepIndex, action, success: true };
      }

      case "key.escape":
      case "escape": {
        await ui.pressEscape();
        return { step: stepIndex, action, success: true };
      }

      case "select.all":
      case "selectAll": {
        await ui.selectAll();
        return { step: stepIndex, action, success: true };
      }

      // Search actions
      case "search.find":
      case "search.open": {
        await ui.pressKey("f", ["command"]);
        return { step: stepIndex, action, success: true };
      }

      case "search.type": {
        await ui.pressKey("f", ["command"]);
        await ui.sleep(0.3);
        await ui.typeText(params.text as string);
        return { step: stepIndex, action, success: true, output: `Searched: ${params.text}` };
      }

      // Contact actions (for Zalo, Line, Messages, etc.)
      case "contact.search": {
        const contact = params.contact as string;
        log.info(`Searching contact: ${contact}`);
        // Most apps use Cmd+F for search
        await ui.pressKey("f", ["command"]);
        await ui.sleep(0.3);
        await ui.typeText(contact);
        return { step: stepIndex, action, success: true, output: `Searched: ${contact}` };
      }

      case "message.send": {
        const msg = (params.text ?? params.message ?? "") as string;
        if (!msg) {
          return { step: stepIndex, action, success: false, error: "No message text provided" };
        }
        await ui.typeText(msg);
        await ui.pressEnter();
        return { step: stepIndex, action, success: true, output: `Sent: ${msg.substring(0, 50)}` };
      }

      // UI wait/exists
      case "ui.wait_for":
      case "wait_for": {
        const seconds = (params.seconds || 5) as number;
        await ui.sleep(seconds);
        return { step: stepIndex, action, success: true, output: `Waited ${seconds}s` };
      }

      case "ui.exists": {
        const elements = await ui.findElements(params.app as string, {
          title: params.element as string
        });
        return { step: stepIndex, action, success: elements.length > 0,
          output: elements.length > 0 ? `Found: ${params.element}` : `Not found: ${params.element}` };
      }

      case "ui.wait_for_element": {
        const seconds = (params.timeout || 10) as number;
        const found = await ui.waitFor(
          async () => {
            const elements = await ui.findElements(params.app as string, { title: params.element as string });
            return elements.length > 0;
          },
          seconds
        );
        return { step: stepIndex, action, success: found, output: found ? "Element appeared" : "Timeout waiting for element" };
      }

      // Screenshot
      case "screenshot": {
        const path = await ui.screenshot(params.path as string);
        return { step: stepIndex, action, success: true, output: `Screenshot: ${path}` };
      }

      // Generic sleep
      case "sleep": {
        const seconds = (params.seconds || 1) as number;
        await ui.sleep(seconds);
        return { step: stepIndex, action, success: true };
      }

      // ==================================================================
      // File Operations
      // ==================================================================

      case "file.list_images": {
        const dir = (params.path || params.source) as string;
        if (!dir) {
          return { step: stepIndex, action, success: false, error: "No path specified" };
        }
        const images = await fileOps.listImageFiles(dir);
        return {
          step: stepIndex, action, success: true,
          output: `Found ${images.length} images: ${images.map(i => i.name).join(", ")}`
        };
      }

      case "file.classify_image": {
        const imgPath = (params.path || params.source) as string;
        if (!imgPath) {
          return { step: stepIndex, action, success: false, error: "No image path specified" };
        }
        const result = await fileOps.classifyImageForCat(imgPath);
        return {
          step: stepIndex, action, success: true,
          output: `Cat: ${result.hasCat}, Confidence: ${result.confidence}, Labels: ${result.labels.join(", ")}`
        };
      }

      case "file.move": {
        const source = (params.source || params.path) as string;
        const dest = (params.destination) as string;
        if (!source || !dest) {
          return { step: stepIndex, action, success: false, error: "Missing source or destination" };
        }
        fileOps.ensureDirectory(dest);
        const result = fileOps.moveFile(source, dest);
        return {
          step: stepIndex, action, success: result.success,
          output: result.success ? `Moved to ${result.destination}` : `Failed: ${result.error}`,
          error: result.error
        };
      }

      case "file.find_and_move": {
        const sourceDir = (params.source || params.path) as string;
        const destDir = (params.destination) as string;
        const filter = (params.filter || "all") as "cat" | "dog" | "all";
        const minConf = (params.confidence || 0.5) as number;
        const dryRun = (params.dry_run || false) as boolean;

        if (!sourceDir || !destDir) {
          return { step: stepIndex, action, success: false, error: "Missing source or destination" };
        }

        const result = await fileOps.findAndMoveImages({
          sourceDir, destinationDir: destDir, filter, minConfidence: minConf, dryRun
        });

        return {
          step: stepIndex, action, success: result.errors.length === 0,
          output: `Processed ${result.totalFiles} files, matched ${result.matchedFiles.length}, moved ${result.movedFiles.length}`,
          error: result.errors.length > 0 ? result.errors.join("; ") : undefined
        };
      }

      // ==================================================================
      // Vision Operations
      // ==================================================================

      case "vision.detect_cat": {
        const imgPath = (params.path || params.source) as string;
        if (!imgPath) {
          return { step: stepIndex, action, success: false, error: "No image path specified" };
        }
        const result = await fileOps.classifyImageForCat(imgPath);
        return {
          step: stepIndex, action, success: true,
          output: JSON.stringify({ hasCat: result.hasCat, confidence: result.confidence })
        };
      }

      // ==================================================================
      // System Operations
      // ==================================================================
      case "clipboard.get": {
        const text = await sysOps.getClipboard();
        return { step: stepIndex, action, success: true, output: text };
      }

      case "clipboard.set": {
        const text = params.text as string;
        const ok = await sysOps.setClipboard(text);
        return { step: stepIndex, action, success: ok };
      }

      case "notification.show": {
        const title = (params.title || "Notification") as string;
        const message = (params.message || "") as string;
        const ok = await sysOps.showNotification(title, message);
        return { step: stepIndex, action, success: ok };
      }

      case "system.info": {
        const battery = await sysOps.getBatteryInfo();
        const disk = await sysOps.getDiskUsage();
        return {
          step: stepIndex, action, success: true,
          output: JSON.stringify({ battery, disk })
        };
      }

      case "process.list": {
        const pattern = params.pattern as string | undefined;
        const processes = await sysOps.listProcesses(pattern);
        return { step: stepIndex, action, success: true, output: JSON.stringify(processes.slice(0, 20)) };
      }

      case "process.kill": {
        const name = params.name as string;
        const ok = await sysOps.killProcessByName(name);
        return { step: stepIndex, action, success: ok === 1 };
      }

      // ==================================================================
      // Communication
      // ==================================================================
      case "message.send": {
        const recipient = (params.contact || params.recipient) as string;
        const text = (params.text || params.message) as string;
        const result = await commOps.sendMessage(recipient, text);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "email.send": {
        const to = params.to as string;
        const subject = (params.subject || "") as string;
        const body = (params.body || params.text || "") as string;
        const result = await commOps.sendEmail(to, subject, body);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "calendar.today": {
        const events = await commOps.getTodayEvents();
        return { step: stepIndex, action, success: true, output: JSON.stringify(events) };
      }

      case "calendar.create": {
        const title = (params.title || params.text) as string;
        const start = new Date(params.start as string || Date.now());
        const end = new Date(params.end as string || Date.now() + 3600000);
        const result = await commOps.createCalendarEvent(title, start, end, {
          location: params.location as string,
          notes: params.notes as string
        });
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      // ==================================================================
      // Notes & Reminders
      // ==================================================================
      case "notes.list": {
        const notes = await noteOps.listNotes(50);
        return { step: stepIndex, action, success: true, output: JSON.stringify(notes) };
      }

      case "notes.search": {
        const query = (params.query || params.text) as string;
        const notes = await noteOps.searchNotes(query);
        return { step: stepIndex, action, success: true, output: JSON.stringify(notes) };
      }

      case "notes.create": {
        const title = (params.title || "Untitled") as string;
        const content = (params.text || params.content || "") as string;
        const result = await noteOps.createNote(title, content);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "reminders.list": {
        const reminders = await noteOps.listReminders();
        return { step: stepIndex, action, success: true, output: JSON.stringify(reminders) };
      }

      case "reminders.create": {
        const title = (params.title || params.text) as string;
        const result = await noteOps.createReminder(title, {
          dueDate: params.dueDate ? new Date(params.dueDate as string) : undefined,
          priority: params.priority as number
        });
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      // ==================================================================
      // Productivity / GitHub
      // ==================================================================
      case "github.issue": {
        const repo = (params.repo) as string;
        const title = (params.title || params.text) as string;
        const result = await prodOps.createGitHubIssue(repo, title, {
          body: params.body as string,
          labels: params.labels ? (params.labels as string).split(",") : undefined
        });
        return { step: stepIndex, action, success: result.success, output: result.url, error: result.error };
      }

      case "shell.exec": {
        const command = (params.command || params.text) as string;
        const result = await prodOps.executeShell(command, {
          cwd: params.cwd as string,
          timeout: params.timeout as number
        });
        return {
          step: stepIndex, action, success: result.exitCode === 0,
          output: result.stdout, error: result.stderr
        };
      }

      // ==================================================================
      // AI / OpenAI
      // ==================================================================
      case "ai.chat": {
        const messages = (params.messages || []) as Array<{role: "system" | "user" | "assistant"; content: string}>;
        const result = await aiOps.chatWithOpenAI(messages, {
          model: params.model as string,
          temperature: params.temperature as number
        });
        return { step: stepIndex, action, success: result.success, output: result.content, error: result.error };
      }

      case "ai.embed": {
        const texts = Array.isArray(params.texts) ? params.texts as string[] : [(params.text || params.query) as string];
        const result = await aiOps.generateEmbeddings(texts);
        return { step: stepIndex, action, success: result.success, output: JSON.stringify(result.embeddings), error: result.error };
      }

      case "ai.image": {
        const prompt = (params.prompt || params.text) as string;
        const result = await aiOps.generateImage(prompt);
        return { step: stepIndex, action, success: result.success, output: result.imagePath, error: result.error };
      }

      // ==================================================================
      // Data / CSV
      // ==================================================================
      case "csv.read": {
        const filePath = (params.path || params.source) as string;
        const data = await dataOps.readCsv(filePath);
        return { step: stepIndex, action, success: true, output: JSON.stringify(data) };
      }

      case "csv.write": {
        const filePath = (params.path || params.destination) as string;
        const data = (params.data as Array<Record<string, unknown>>) || [];
        const result = await dataOps.writeCsv(filePath, data);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "json.read": {
        const filePath = (params.path) as string;
        const result = await dataOps.readJson(filePath);
        return { step: stepIndex, action, success: result.success, output: JSON.stringify(result.data), error: result.error };
      }

      case "text.extract": {
        const text = (params.text || params.source) as string;
        const pattern = (params.pattern) as string;
        const matches = dataOps.extractByRegex(text, pattern);
        return { step: stepIndex, action, success: true, output: JSON.stringify(matches) };
      }

      // ==================================================================
      // Browser / Maps
      // ==================================================================
      case "browser.open": {
        const url = (params.url) as string;
        const browser = (params.browser || "default") as "safari" | "chrome" | "firefox" | "default";
        const result = await ui.openBrowserUrl(url, browser);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "maps.navigate": {
        const destination = (params.destination || params.text) as string;
        const origin = params.origin as string | undefined;
        const result = await ui.openGoogleMaps(destination, origin);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      case "maps.search": {
        const query = (params.query || params.text) as string;
        const result = await ui.searchGoogleMaps(query);
        return { step: stepIndex, action, success: result.success, error: result.error };
      }

      default:
        return {
          step: stepIndex,
          action,
          success: false,
          error: `Unknown action: ${action}`
        };
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { step: stepIndex, action, success: false, error };
  }
}

// ------------------------------------------------------------------
// Main Orchestrator
// ------------------------------------------------------------------

/**
 * Execute a sequence of automation steps.
 */
export async function orchestrate(
  steps: OrchestrateStep[],
  sessionId?: string
): Promise<OrchestrateResult> {
  log.info(`Starting orchestration: ${steps.length} steps`);

  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const result = await executeStep(steps[i], i);
    results.push(result);

    if (!result.success) {
      log.warn(`Step ${i} (${result.action}) failed: ${result.error}`);
      // Continue anyway - some UI steps might be optional
    }
  }

  // Take final screenshot for debugging
  let screenshotPath: string | undefined;
  try {
    screenshotPath = await ui.screenshot();
  } catch {
    // Ignore screenshot errors
  }

  return {
    session_id: sessionId,
    completed: results.every(r => r.success),
    steps: results,
    screenshot: screenshotPath,
  };
}

// ------------------------------------------------------------------
// Pre-built Workflows
// ------------------------------------------------------------------

/**
 * Open app for duration then close.
 */
export async function openAppTimed(
  appName: string,
  durationSeconds: number
): Promise<OrchestrateResult> {
  return orchestrate([
    { action: "app.open", params: { app: appName } },
    { action: "app.wait", params: { seconds: durationSeconds } },
    { action: "app.close", params: { app: appName } },
  ]);
}

/**
 * Helper to create Zalo messaging workflow.
 * Note: Coordinates need calibration for your screen resolution.
 */
export function zaloMessageWorkflow(
  contactName: string,
  message: string,
  options: {
    searchBoxX?: number;
    searchBoxY?: number;
    firstResultX?: number;
    firstResultY?: number;
  } = {}
): OrchestrateStep[] {
  const {
    searchBoxX = 400,
    searchBoxY = 100,
    firstResultX = 400,
    firstResultY = 180
  } = options;

  return [
    { action: "app.open", params: { app: "Zalo" } },
    { action: "app.wait", params: { seconds: 2 } },
    // Click search box
    { action: "click", params: { x: searchBoxX, y: searchBoxY } },
    { action: "app.wait", params: { seconds: 0.3 } },
    // Type contact name
    { action: "type", params: { text: contactName } },
    { action: "app.wait", params: { seconds: 1 } },
    // Click first search result
    { action: "click", params: { x: firstResultX, y: firstResultY } },
    { action: "app.wait", params: { seconds: 0.5 } },
    // Type and send message
    { action: "message.send", params: { message } },
  ];
}

/**
 * Generic message workflow for any messaging app.
 */
export function messageContactWorkflow(
  appName: string,
  contactName: string,
  message: string,
  searchClickCoords: { x: number; y: number },
  resultClickCoords: { x: number; y: number }
): OrchestrateStep[] {
  return [
    { action: "app.open", params: { app: appName } },
    { action: "app.wait", params: { seconds: 2 } },
    { action: "click", params: { x: searchClickCoords.x, y: searchClickCoords.y } },
    { action: "app.wait", params: { seconds: 0.3 } },
    { action: "type", params: { text: contactName } },
    { action: "app.wait", params: { seconds: 1 } },
    { action: "click", params: { x: resultClickCoords.x, y: resultClickCoords.y } },
    { action: "app.wait", params: { seconds: 0.5 } },
    { action: "message.send", params: { message } },
  ];
}