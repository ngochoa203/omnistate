/**
 * Terminal Advanced Tools — Advanced Layer (API 63)
 * Implements: Tmux, screen, shell configuration, multiplex management
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const execAsync = promisify(exec);

// ------------------------------------------------------------------
// Tmux Session Management
// ------------------------------------------------------------------

export async function createTmuxSession(
  sessionName: string,
  startDirectory?: string
): Promise<boolean> {
  try {
    const dir = startDirectory || process.cwd();
    await execAsync(`tmux new-session -d -s "${sessionName}" -c "${dir}" 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

export async function attachTmuxSession(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux attach-session -t "${sessionName}" 2>/dev/null || tmux new-session -s "${sessionName}"`);
    return true;
  } catch {
    return false;
  }
}

export async function listTmuxSessions(): Promise<{
  sessions: { name: string; windows: number; created: string }[];
}> {
  try {
    const { stdout } = await execAsync(
      "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created_string}' 2>/dev/null || echo ''",
      { encoding: "utf-8" }
    );
    
    const sessions = stdout.trim().split("\n").filter(s => s.includes("|")).map(line => {
      const [name, windows, created] = line.split("|");
      return { name, windows: parseInt(windows, 10), created };
    });
    
    return { sessions };
  } catch {
    return { sessions: [] };
  }
}

export async function killTmuxSession(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux kill-session -t "${sessionName}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function sendTmuxCommand(
  sessionName: string,
  windowIndex: number = 0,
  command: string
): Promise<boolean> {
  try {
    await execAsync(
      `tmux send-keys -t "${sessionName}:${windowIndex}" "${command}" Enter 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Tmux Window/Pane Management
// ------------------------------------------------------------------

export async function createTmuxWindow(
  sessionName: string,
  windowName: string,
  startDirectory?: string
): Promise<boolean> {
  try {
    const dir = startDirectory || "";
    await execAsync(
      `tmux new-window -t "${sessionName}" -n "${windowName}" ${dir ? `-c "${dir}"` : ""} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

export async function splitTmuxWindow(
  sessionName: string,
  windowIndex: number = 0,
  direction: "horizontal" | "vertical" = "horizontal"
): Promise<boolean> {
  try {
    const splitCmd = direction === "horizontal" ? "split-window -h" : "split-window -v";
    await execAsync(`tmux ${splitCmd} -t "${sessionName}:${windowIndex}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export async function selectTmuxLayout(
  sessionName: string,
  windowIndex: number = 0,
  layout: "tiled" | "main-horizontal" | "main-vertical" | "even-horizontal" | "even-vertical" = "tiled"
): Promise<boolean> {
  try {
    await execAsync(
      `tmux select-layout -t "${sessionName}:${windowIndex}" ${layout} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Screen Session Management
// ------------------------------------------------------------------

export async function createScreenSession(
  sessionName: string,
  command?: string
): Promise<boolean> {
  try {
    const cmd = command ? `-dmS "${sessionName}" ${command}` : `-dmS "${sessionName}"`;
    await execAsync(`screen ${cmd} 2>/dev/null || echo "done"`);
    return true;
  } catch {
    return false;
  }
}

export async function listScreenSessions(): Promise<{
  sessions: { pid: string; name: string; state: string }[];
}> {
  try {
    const { stdout } = await execAsync(
      "screen -ls 2>/dev/null | grep -E '^\s+[0-9]+' | awk '{print $1, $2}' || echo ''",
      { encoding: "utf-8" }
    );
    
    const sessions = stdout.trim().split("\n").filter(s => s).map(line => {
      const [pidName, state] = line.trim().split(/\s+/);
      const pid = pidName.replace(/\..*$/, "");
      const name = pidName.replace(/^\d+\./, "");
      return { pid, name, state };
    });
    
    return { sessions };
  } catch {
    return { sessions: [] };
  }
}

export async function attachScreenSession(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`screen -r "${sessionName}" 2>/dev/null || screen -x "${sessionName}"`);
    return true;
  } catch {
    return false;
  }
}

export async function killScreenSession(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`screen -S "${sessionName}" -X quit 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Shell Configuration
// ------------------------------------------------------------------

export async function updateShellConfig(
  shell: "bash" | "zsh",
  content: string,
  append: boolean = true
): Promise<boolean> {
  try {
    const configPath = shell === "bash"
      ? path.join(process.env.HOME || "", ".bashrc")
      : path.join(process.env.HOME || "", ".zshrc");
    
    if (append) {
      const existing = await fs.readFile(configPath, "utf-8").catch(() => "");
      await fs.writeFile(configPath, existing + "\n" + content);
    } else {
      await fs.writeFile(configPath, content);
    }
    
    return true;
  } catch {
    return false;
  }
}

export async function createShellAlias(
  alias: string,
  command: string
): Promise<boolean> {
  return updateShellConfig("bash", `alias ${alias}='${command}'`);
}

export async function createShellFunction(
  name: string,
  content: string
): Promise<boolean> {
  return updateShellConfig("bash", `${name}() { ${content} }`);
}

export async function exportEnvironmentVariable(
  key: string,
  value: string
): Promise<boolean> {
  return updateShellConfig("bash", `export ${key}="${value}"`);
}

// ------------------------------------------------------------------
// Multiplexer Layout Management
// ------------------------------------------------------------------

export interface TmuxLayout {
  session: string;
  windows: {
    name: string;
    panes: { direction: "horizontal" | "vertical"; command?: string }[];
  }[];
}

export async function applyTmuxLayout(layout: TmuxLayout): Promise<boolean> {
  try {
    await createTmuxSession(layout.session);
    
    for (let i = 0; i < layout.windows.length; i++) {
      const win = layout.windows[i];
      
      if (i === 0) {
        // First window already exists with session
        await execAsync(
          `tmux rename-window -t "${layout.session}:0" "${win.name}" 2>/dev/null`
        );
      } else {
        await createTmuxWindow(layout.session, win.name);
      }
      
      // Setup panes
      for (let j = 0; j < win.panes.length; j++) {
        const pane = win.panes[j];
        await splitTmuxWindow(
          layout.session,
          i,
          pane.direction
        );
        
        if (pane.command) {
          await sendTmuxCommand(layout.session, i, pane.command);
        }
      }
    }
    
    return true;
  } catch {
    return false;
  }
}

export async function captureTmuxPane(
  sessionName: string,
  windowIndex: number = 0,
  paneIndex: number = 0
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${sessionName}:${windowIndex}.${paneIndex}" -p 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    return stdout;
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// Terminal Colors & Theming
// ------------------------------------------------------------------

export async function setTerminalColor(
  colorName: string,
  rgb: { r: number; g: number; b: number }
): Promise<boolean> {
  try {
    // For iTerm2
    const escape = `\x1b]${colorName};#${rgb.r};${rgb.g};${rgb.b}\x07`;
    await execAsync(`echo -e '${escape}'`);
    return true;
  } catch {
    return false;
  }
}

export async function apply256ColorTheme(
  colors: string[]
): Promise<boolean> {
  try {
    for (let i = 0; i < Math.min(colors.length, 16); i++) {
      const escape = `\x1b]4;${i};${colors[i]}\x07`;
      await execAsync(`echo -e '${escape}'`);
    }
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// History Management
// ------------------------------------------------------------------

export async function searchBashHistory(
  pattern: string
): Promise<{ commands: string[]; count: number }> {
  try {
    const { stdout } = await execAsync(
      `grep -E '${pattern}' ~/.bash_history 2>/dev/null | tail -50 || echo ''`,
      { encoding: "utf-8" }
    );
    
    const commands = stdout.trim().split("\n").filter(c => c);
    return { commands, count: commands.length };
  } catch {
    return { commands: [], count: 0 };
  }
}

export async function clearShellHistory(
  shell: "bash" | "zsh" | "all" = "bash"
): Promise<boolean> {
  try {
    if (shell === "bash" || shell === "all") {
      await execAsync("echo '' > ~/.bash_history 2>/dev/null || echo 'done'");
    }
    if (shell === "zsh" || shell === "all") {
      await execAsync("echo '' > ~/.zsh_history 2>/dev/null || echo 'done'");
    }
    return true;
  } catch {
    return false;
  }
}

export class TerminalAdvancedLayer {
  createTmuxSession = createTmuxSession;
  attachTmuxSession = attachTmuxSession;
  listTmuxSessions = listTmuxSessions;
  killTmuxSession = killTmuxSession;
  sendTmuxCommand = sendTmuxCommand;
  
  createTmuxWindow = createTmuxWindow;
  splitTmuxWindow = splitTmuxWindow;
  selectTmuxLayout = selectTmuxLayout;
  applyTmuxLayout = applyTmuxLayout;
  captureTmuxPane = captureTmuxPane;
  
  createScreenSession = createScreenSession;
  listScreenSessions = listScreenSessions;
  attachScreenSession = attachScreenSession;
  killScreenSession = killScreenSession;
  
  updateShellConfig = updateShellConfig;
  createAlias = createShellAlias;
  createFunction = createShellFunction;
  exportEnv = exportEnvironmentVariable;
  
  setTerminalColor = setTerminalColor;
  apply256ColorTheme = apply256ColorTheme;
  
  searchHistory = searchBashHistory;
  clearHistory = clearShellHistory;
}
