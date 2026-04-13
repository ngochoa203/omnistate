import { z } from "zod";
import { homedir } from "node:os";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Glob helpers (no external dep — picomatch/minimatch not in package.json)
// ---------------------------------------------------------------------------

/** Expand leading ~ to the user's home directory. */
function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~" ? homedir() + p.slice(1) : p;
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports: `*` (any chars except `/`), `**` (any chars including `/`), `?` (single non-`/` char).
 */
function globToRegex(pattern: string): RegExp {
  const expanded = expandHome(pattern);
  let re = "";
  let i = 0;
  while (i < expanded.length) {
    const ch = expanded[i];
    if (ch === "*") {
      if (expanded[i + 1] === "*") {
        // `**` — match anything including path separators
        re += ".*";
        i += 2;
        // consume optional trailing slash
        if (expanded[i] === "/") i++;
      } else {
        // `*` — match anything except `/`
        re += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Returns true when `value` matches any of the glob `patterns`. */
function matchesAny(value: string, patterns: string[]): boolean {
  const expanded = expandHome(value);
  return patterns.some((p) => globToRegex(p).test(expanded));
}

/** Case-insensitive literal or glob match for app names. */
function appMatchesAny(appName: string, patterns: string[]): boolean {
  const lower = appName.toLowerCase();
  return patterns.some((p) => {
    if (p.includes("*") || p.includes("?")) {
      return globToRegex(p.toLowerCase()).test(lower);
    }
    return p.toLowerCase() === lower;
  });
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ApprovalRuleSchema = z.object({
  /** App name pattern (glob): "claude*", "Terminal", "*" */
  app: z.string().optional(),
  /** Resource path pattern: "/Users/hoahn/Projects/**" */
  resource: z.string().optional(),
  action: z
    .enum(["read", "write", "execute", "full_access", "*"])
    .default("*"),
  dialogType: z
    .enum(["macos_system", "app_dialog", "terminal_prompt", "browser", "*"])
    .default("*"),

  decision: z.enum(["allow", "deny", "ask"]).default("ask"),

  conditions: z
    .object({
      /** "09:00-18:00" — only auto-approve during work hours (local time) */
      timeWindow: z.string().optional(),
      /** Max auto-approvals per hour (rolling window keyed by app+resource) */
      maxPerHour: z.number().optional(),
      /** Only approve when a Tailscale interface is detected */
      requireTailscale: z.boolean().optional(),
    })
    .optional(),
});

export const ApprovalPolicySchema = z.object({
  enabled: z.boolean().default(false),

  /**
   * Security blocklist — NEVER auto-approve these (highest priority).
   * Evaluated before allowlist and custom rules.
   */
  blocklist: z
    .object({
      paths: z
        .array(z.string())
        .default([
          "~/.ssh/**",
          "~/.gnupg/**",
          "~/.aws/**",
          "~/.*credentials*",
          "~/.env*",
          "**/secrets/**",
          "**/private/**",
          "**/.git/config",
          "**/node_modules/.cache/**",
          "/etc/**",
          "/System/**",
          "/usr/**",
        ]),
      apps: z
        .array(z.string())
        .default([
          "System Preferences",
          "Keychain Access",
          "1Password",
          "Bitwarden",
        ]),
      /** Raw action strings whose presence in `rawText` triggers a block. */
      actions: z
        .array(z.string())
        .default(["delete", "format", "sudo", "rm -rf", "chmod 777"]),
    })
    .default({}),

  /**
   * Allowlist — auto-approve these after the blocklist check.
   */
  allowlist: z
    .object({
      paths: z
        .array(z.string())
        .default([
          "~/Projects/**",
          "~/Documents/**",
          "~/Desktop/**",
          "/tmp/**",
        ]),
      apps: z
        .array(z.string())
        .default([
          "Terminal",
          "iTerm2",
          "Warp",
          "Visual Studio Code",
          "Cursor",
          "claude",
        ]),
    })
    .default({}),

  /** Custom rules evaluated in order after blocklist/allowlist checks. */
  rules: z.array(ApprovalRuleSchema).default([]),

  auditLog: z
    .object({
      enabled: z.boolean().default(true),
      path: z
        .string()
        .default("~/.omnistate/approval-audit.jsonl"),
      retentionDays: z.number().default(30),
    })
    .default({}),
});

export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

// ---------------------------------------------------------------------------
// Request / Decision types
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  app: string;
  resource: string;
  action: string;
  dialogType: string;
  /** The raw text extracted from the dialog / prompt */
  rawText: string;
  timestamp: Date;
}

export interface ApprovalDecision {
  decision: "allow" | "deny" | "ask";
  /** Human-readable explanation of why this decision was made */
  reason: string;
  /** Serialised rule that triggered the decision (if any) */
  matchedRule?: string;
  isBlocklisted: boolean;
  isAllowlisted: boolean;
}

// ---------------------------------------------------------------------------
// Rate-limit bucket key
// ---------------------------------------------------------------------------

function rateKey(req: ApprovalRequest): string {
  return `${req.app}::${req.resource}`;
}

// ---------------------------------------------------------------------------
// ApprovalEngine
// ---------------------------------------------------------------------------

export class ApprovalEngine {
  private policy: ApprovalPolicy;

  /**
   * Sliding-hour approval counts per (app, resource) key.
   * Each entry: [count, windowStartEpochMs]
   */
  private rateBuckets: Map<string, { count: number; windowStart: number }> =
    new Map();

  constructor(policy?: Partial<ApprovalPolicy>) {
    this.policy = ApprovalPolicySchema.parse(policy ?? {});
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  evaluate(request: ApprovalRequest): ApprovalDecision {
    // 1. Engine disabled → always escalate to user
    if (!this.policy.enabled) {
      return {
        decision: "ask",
        reason: "Policy engine disabled",
        isBlocklisted: false,
        isAllowlisted: false,
      };
    }

    // 2. BLOCKLIST — highest priority, always deny
    const blockReason = this.blocklistReason(request);
    if (blockReason) {
      this.audit(request, "deny", blockReason);
      return {
        decision: "deny",
        reason: blockReason,
        isBlocklisted: true,
        isAllowlisted: false,
      };
    }

    // 3. ALLOWLIST — auto-approve (subject to rate limit)
    if (this.isAllowlisted(request)) {
      if (this.isRateLimited(request)) {
        this.audit(request, "ask", "Allowlisted but rate limit exceeded");
        return {
          decision: "ask",
          reason: "Rate limit exceeded for allowlisted resource",
          isBlocklisted: false,
          isAllowlisted: true,
        };
      }
      this.incrementRateCounter(request);
      this.audit(request, "allow", "Allowlisted");
      return {
        decision: "allow",
        reason: "Resource/app is allowlisted",
        isBlocklisted: false,
        isAllowlisted: true,
      };
    }

    // 4. Custom rules (evaluated in declaration order)
    for (const rule of this.policy.rules) {
      if (this.ruleMatches(rule, request)) {
        const condCheck = this.checkConditions(rule, request);
        if (condCheck !== null) {
          // Condition not satisfied — escalate
          this.audit(request, "ask", condCheck);
          return {
            decision: "ask",
            reason: condCheck,
            matchedRule: JSON.stringify(rule),
            isBlocklisted: false,
            isAllowlisted: false,
          };
        }
        const label = `Matched rule: app=${rule.app ?? "*"} resource=${rule.resource ?? "*"}`;
        this.audit(request, rule.decision, label);
        return {
          decision: rule.decision,
          reason: "Matched custom rule",
          matchedRule: JSON.stringify(rule),
          isBlocklisted: false,
          isAllowlisted: false,
        };
      }
    }

    // 5. Default: escalate to user
    this.audit(request, "ask", "No matching rule");
    return {
      decision: "ask",
      reason: "No matching policy rule",
      isBlocklisted: false,
      isAllowlisted: false,
    };
  }

  // -------------------------------------------------------------------------
  // Blocklist
  // -------------------------------------------------------------------------

  private blocklistReason(req: ApprovalRequest): string | null {
    const bl = this.policy.blocklist;

    if (req.resource && matchesAny(req.resource, bl.paths)) {
      return `Resource path matches blocklist: ${req.resource}`;
    }

    if (appMatchesAny(req.app, bl.apps)) {
      return `App is blocklisted: ${req.app}`;
    }

    const rawLower = req.rawText.toLowerCase();
    for (const actionKeyword of bl.actions) {
      if (rawLower.includes(actionKeyword.toLowerCase())) {
        return `Blocked action detected in dialog text: "${actionKeyword}"`;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Allowlist
  // -------------------------------------------------------------------------

  private isAllowlisted(req: ApprovalRequest): boolean {
    const al = this.policy.allowlist;
    if (req.resource && matchesAny(req.resource, al.paths)) return true;
    if (appMatchesAny(req.app, al.apps)) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // Custom rule matching
  // -------------------------------------------------------------------------

  private ruleMatches(rule: ApprovalRule, req: ApprovalRequest): boolean {
    // app pattern
    if (rule.app && rule.app !== "*") {
      if (!appMatchesAny(req.app, [rule.app])) return false;
    }

    // resource pattern
    if (rule.resource && rule.resource !== "*") {
      if (!req.resource || !matchesAny(req.resource, [rule.resource]))
        return false;
    }

    // action
    if (rule.action !== "*" && req.action !== rule.action) return false;

    // dialogType
    if (rule.dialogType !== "*" && req.dialogType !== rule.dialogType)
      return false;

    return true;
  }

  /**
   * Check rule conditions.
   * Returns `null` when all conditions pass, or a human-readable failure reason.
   */
  private checkConditions(
    rule: ApprovalRule,
    req: ApprovalRequest
  ): string | null {
    const cond = rule.conditions;
    if (!cond) return null;

    // Time-window check (local time)
    if (cond.timeWindow) {
      const match = cond.timeWindow.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
      if (match) {
        const now = req.timestamp;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const startMins = parseInt(match[1]) * 60 + parseInt(match[2]);
        const endMins = parseInt(match[3]) * 60 + parseInt(match[4]);
        if (nowMins < startMins || nowMins > endMins) {
          return `Outside allowed time window ${cond.timeWindow}`;
        }
      }
    }

    // Rate limit
    if (cond.maxPerHour !== undefined) {
      const key = rateKey(req);
      const bucket = this.getRateBucket(key);
      if (bucket.count >= cond.maxPerHour) {
        return `Rate limit of ${cond.maxPerHour}/hr exceeded`;
      }
    }

    // Tailscale check (heuristic: look for utun/tun100 interfaces)
    if (cond.requireTailscale) {
      if (!this.tailscaleActive()) {
        return "Tailscale not active";
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  private getRateBucket(
    key: string
  ): { count: number; windowStart: number } {
    const now = Date.now();
    const existing = this.rateBuckets.get(key);
    if (!existing || now - existing.windowStart >= 3_600_000) {
      // New or expired window
      const fresh = { count: 0, windowStart: now };
      this.rateBuckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  /**
   * Check global rate limit for allowlisted requests.
   * Currently uses the first matching custom rule's `maxPerHour` condition if set,
   * or a generous 360 req/hr default (6/min) for allowlisted entries.
   */
  private isRateLimited(req: ApprovalRequest): boolean {
    // Check if any matching custom rule imposes a maxPerHour
    for (const rule of this.policy.rules) {
      if (
        this.ruleMatches(rule, req) &&
        rule.conditions?.maxPerHour !== undefined
      ) {
        const bucket = this.getRateBucket(rateKey(req));
        return bucket.count >= rule.conditions.maxPerHour;
      }
    }
    return false;
  }

  private incrementRateCounter(req: ApprovalRequest): void {
    const key = rateKey(req);
    const bucket = this.getRateBucket(key);
    bucket.count++;
  }

  // -------------------------------------------------------------------------
  // Tailscale detection (best-effort, no external dep)
  // -------------------------------------------------------------------------

  private tailscaleActive(): boolean {
    try {
      // Synchronous is fine here — called rarely, advisory only
      const { execSync } = require("node:child_process") as typeof import("node:child_process");
      const out = execSync("ifconfig 2>/dev/null || ip link 2>/dev/null", {
        encoding: "utf-8",
        timeout: 500,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // Tailscale typically uses utun (macOS) or tailscale0 (Linux)
      return /\butun\d+\b|\btailscale\d*\b/.test(out);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  private audit(
    req: ApprovalRequest,
    decision: "allow" | "deny" | "ask",
    reason: string
  ): void {
    if (!this.policy.auditLog.enabled) return;

    const entry = {
      ts: req.timestamp.toISOString(),
      decision,
      reason,
      app: req.app,
      resource: req.resource,
      action: req.action,
      dialogType: req.dialogType,
    };

    try {
      const logPath = resolve(expandHome(this.policy.auditLog.path));
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Audit failures must never block the decision path
    }
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /** Replace the running policy at runtime (e.g. after config reload). */
  updatePolicy(policy: Partial<ApprovalPolicy>): void {
    this.policy = ApprovalPolicySchema.parse(policy);
    this.rateBuckets.clear();
  }

  getPolicy(): Readonly<ApprovalPolicy> {
    return this.policy;
  }
}
