// ── NLP preprocessing extracted from intent.ts ──────────────────────────────

// ============================================================================
// Text preprocessing & normalization
// ============================================================================

/**
 * Strip common typos / normalize common misspellings before classification.
 */
export function correctTypos(text: string): string {
  return text
    .replace(/\bssh\s*-(l|login)\b/gi, "ssh -l")
    .replace(/\bkill\s+-9\b/gi, "kill -9")
    .replace(/\bgit\s*push\s*-f\b/gi, "git push")
    .replace(/\bnode\s*--flag\b/gi, "node --flag")
    .replace(/\bbrew\s* instal\b/gi, "brew install")
    .replace(/\bsudo\s* ap\b/gi, "sudo apt")
    .replace(/\bls\s* -l\s*-l\b/gi, "ls -l")
    .replace(/\bcd\s+\.\.\s+\.\.\b/gi, "cd ../..")
    .replace(/\bgrep\s+ -n\b/gi, "grep -n")
    .replace(/\bcurl\s+ -X\b/gi, "curl -X")
    .replace(/\bchmod\s+ 777\b/gi, "chmod 755")
    .replace(/\brm\s+ -rf\s+ \/\b/gi, "rm -rf .");
}

/**
 * Lowercase + trim for classification matching.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

// ── Typed text utilities ────────────────────────────────────────────────────

export function extractCoordinatePairs(text: string): Array<{ x: number; y: number }> {
  const pairs: Array<{ x: number; y: number }> = [];
  const regex =
    /(?:\bx\s*[:=]?\s*(\d{1,5})\s*(?:[,;\s]+)?\by\s*[:=]?\s*(\d{1,5}))|(?:(\d{1,5})\s*[,x]\s*(\d{1,5}))|(?:(\d{1,5})\s+(\d{1,5}))/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const xRaw = match[1] ?? match[3] ?? match[5];
    const yRaw = match[2] ?? match[4] ?? match[6];
    const x = xRaw ? parseInt(xRaw, 10) : NaN;
    const y = yRaw ? parseInt(yRaw, 10) : NaN;
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      pairs.push({ x, y });
    }
  }

  return pairs;
}

export function extractQuotedText(raw: string): string | null {
  const m = raw.match(/["'""](.+?)["'""]/);
  if (m?.[1]) return m[1].trim();

  const tail = raw.match(/\b(?:type|enter|input|write)\b\s+(.+)/i);
  if (tail?.[1]) return tail[1].trim();
  return null;
}
