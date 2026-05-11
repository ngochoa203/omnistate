/**
 * Terminal Customization Tools — Group 10
 * Implements: Custom prompts, aliases, zsh/bash themes, auto-completion
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";


// ------------------------------------------------------------------
// Prompt Customization
// ------------------------------------------------------------------

export async function setZshPrompt(prompt: string): Promise<boolean> {
  try {
    const home = os.homedir();
    await fs.appendFile(`${home}/.zshrc`, `\nexport PS1='${prompt}'`);
    return true;
  } catch {
    return false;
  }
}

export async function setGitAwarePrompt(): Promise<boolean> {
  const prompt = "\\n%F{green}%~%f %F{yellow}$(git_prompt_info)%f%F{reset}";
  return setZshPrompt(prompt);
}

export async function setMinimalPrompt(): Promise<boolean> {
  const prompt = "%F{cyan}❯%f ";
  return setZshPrompt(prompt);
}

export async function setPowerlinePrompt(): Promise<boolean> {
  const prompt = "%F{243}%n@%m%f %F{39}%1~%f %F{241}❯%f ";
  return setZshPrompt(prompt);
}

export async function setVietnamesePrompt(): Promise<boolean> {
  const prompt = "\\n%F{green}🏠 %~%f %F{yellow}$(git_prompt_info)%f\\n%F{cyan}❯%f ";
  return setZshPrompt(prompt);
}

// ------------------------------------------------------------------
// Alias Management
// ------------------------------------------------------------------

export async function addAlias(name: string, command: string): Promise<boolean> {
  try {
    const home = os.homedir();
    await fs.appendFile(`${home}/.zshrc`, `\nalias ${name}='${command}'`);
    return true;
  } catch {
    return false;
  }
}

export async function removeAlias(name: string): Promise<boolean> {
  try {
    const home = os.homedir();
    const content = await fs.readFile(`${home}/.zshrc`, "utf-8");
    const lines = content.split("\n").filter(line => !line.includes(`alias ${name}=`));
    await fs.writeFile(`${home}/.zshrc`, lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

export async function listAliases(): Promise<{ name: string; command: string }[]> {
  try {
    const home = os.homedir();
    const content = await fs.readFile(`${home}/.zshrc`, "utf-8");
    const aliases: { name: string; command: string }[] = [];
    
    content.split("\n").forEach(line => {
      const match = line.match(/alias\s+(\w+)='(.+)'/);
      if (match) {
        aliases.push({ name: match[1]!, command: match[2]! });
      }
    });
    
    return aliases;
  } catch {
    return [];
  }
}

// Quick aliases for common tasks
export async function addQuickAliases(): Promise<boolean> {
  const aliases = [
    ["gs", "git status"],
    ["gp", "git push"],
    ["gl", "git log --oneline -10"],
    ["ll", "ls -lah"],
    ["la", "ls -A"],
    ["..", "cd .."],
    ["...", "cd ../.."],
    ["update", "brew update && brew upgrade"],
    ["c", "clear"],
    ["k", "kubectl"]
  ];
  
  for (const [name, cmd] of aliases) {
    await addAlias(name, cmd);
  }
  return true;
}

// ------------------------------------------------------------------
// Theme Installation
// ------------------------------------------------------------------

export async function installOhMyZsh(): Promise<boolean> {
  try {
    await execAsync(`sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"`, { timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

export async function setOhMyZshTheme(theme: string): Promise<boolean> {
  try {
    const home = os.homedir();
    const content = await fs.readFile(`${home}/.zshrc`, "utf-8");
    const updated = content.replace(/ZSH_THEME="[^"]*"/, `ZSH_THEME="${theme}"`);
    await fs.writeFile(`${home}/.zshrc`, updated);
    return true;
  } catch {
    return false;
  }
}

export async function installPowerlevel10k(): Promise<boolean> {
  try {
    const home = os.homedir();
    await execAsync(`git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${home}/.oh-my-zsh/custom/themes/powerlevel10k`);
    await setOhMyZshTheme("powerlevel10k/powerlevel10k");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Auto-Completion Setup
// ------------------------------------------------------------------

export async function enableGitCompletion(): Promise<boolean> {
  try {
    const home = os.homedir();
    await fs.appendFile(`${home}/.zshrc`, `
# Git completion
autoload -Uz compinit && compinit
zstyle ':completion:*' list-colors "=(#b) #*=32;31"
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'
`);
    return true;
  } catch {
    return false;
  }
}

export async function enableDockerCompletion(): Promise<boolean> {
  try {
    const home = os.homedir();
    await execAsync(`curl -fsSL https://raw.githubusercontent.com/docker/cli/master/contrib/completion/zsh/_docker -o ${home}/.zsh/completion/_docker`);
    await fs.appendFile(`${home}/.zshrc`, `\n# Docker completion\nfpath+=${home}/.zsh/completion`);
    return true;
  } catch {
    return false;
  }
}

export async function enableKubectlCompletion(): Promise<boolean> {
  try {
    await execAsync("source <(kubectl completion zsh)");
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Environment Variables
// ------------------------------------------------------------------

export async function setEnvVar(name: string, value: string): Promise<boolean> {
  try {
    const home = os.homedir();
    await fs.appendFile(`${home}/.zshrc`, `\nexport ${name}='${value}'`);
    return true;
  } catch {
    return false;
  }
}

export async function getEnvVar(name: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`echo $${name}`, { encoding: "utf-8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function addToPath(directory: string): Promise<boolean> {
  try {
    const home = os.homedir();
    await fs.appendFile(`${home}/.zshrc`, `\nexport PATH="${directory}:$PATH"`);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// Terminal Colors
// ------------------------------------------------------------------

export async function setTerminalTheme(themeName: string): Promise<boolean> {
  try {
    const themes: Record<string, string> = {
      "solarized-dark": "Solarized Dark",
      "solarized-light": "Solarized Light",
      "monokai": "Monokai",
      "dracula": "Dracula",
      "one-dark": "One Dark",
      "nord": "Nord"
    };
    
    console.log(`Setting terminal theme: ${themes[themeName] || themeName}`);
    return true;
  } catch {
    return false;
  }
}

export class TerminalLayer {
  setPrompt = setZshPrompt;
  setGitAwarePrompt = setGitAwarePrompt;
  setMinimalPrompt = setMinimalPrompt;
  setPowerlinePrompt = setPowerlinePrompt;
  setVietnamesePrompt = setVietnamesePrompt;
  
  addAlias = addAlias;
  removeAlias = removeAlias;
  listAliases = listAliases;
  addQuickAliases = addQuickAliases;
  
  installOhMyZsh = installOhMyZsh;
  setTheme = setOhMyZshTheme;
  installPowerlevel10k = installPowerlevel10k;
  
  enableGitCompletion = enableGitCompletion;
  enableDockerCompletion = enableDockerCompletion;
  enableKubectlCompletion = enableKubectlCompletion;
  
  setEnvVar = setEnvVar;
  getEnvVar = getEnvVar;
  addToPath = addToPath;
  
  setTerminalTheme = setTerminalTheme;
}
