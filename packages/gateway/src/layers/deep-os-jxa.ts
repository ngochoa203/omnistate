/**
 * Deep OS Layer — JXA Executors.
 *
 * JXA (JavaScript for Automation) execution helpers.
 */

import { execSync, execFile } from "child_process";
import { promisify } from "util";

// ------------------------------------------------------------------
// JXA Executors
// ------------------------------------------------------------------

/**
 * Execute JXA (JavaScript for Automation) code via osascript.
 * JXA uses standard JavaScript syntax — much easier for LLMs to generate
 * than AppleScript. Runs synchronously with a 10s timeout.
 *
 * Example: executeJxa('Application("Safari").windows[0].currentTab.url()')
 */
export async function executeJxa(code: string): Promise<string> {
  try {
    const result = execSync(`osascript -l JavaScript -e ${JSON.stringify(code)}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return result.trim();
  } catch (err: any) {
    throw new Error(`JXA execution failed: ${err.stderr || err.message}`);
  }
}

/**
 * Execute JXA code asynchronously (non-blocking).
 * For longer-running automation scripts.
 */
export async function executeJxaAsync(code: string): Promise<string> {
  const execFileP = promisify(execFile);
  try {
    const { stdout } = await execFileP('osascript', ['-l', 'JavaScript', '-e', code], {
      timeout: 30000,
    });
    return stdout.trim();
  } catch (err: any) {
    throw new Error(`JXA execution failed: ${err.stderr || err.message}`);
  }
}
