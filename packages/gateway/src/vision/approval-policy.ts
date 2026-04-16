import { z } from "zod";
import { homedir } from "node:os";
import { appendFileSync, mkdirSync, createReadStream, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

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

// ---------------------------------------------------------------------------
// App scope types
// ---------------------------------------------------------------------------

export interface AppScope {
  allowedPaths: string[];
  deniedPaths: string[];
  allowedTools: string[];
  deniedTools: string[];
  maxRequestsPerMinute?: number;
}

export class ApprovalEngine {
  private policy: ApprovalPolicy;

  /**
   * Sliding-hour approval counts per (app, resource) key.
   * Each entry: [count, windowStartEpochMs]
   */
  private rateBuckets: Map<string, { count: number; windowStart: number }> =
    new Map();

  /** Per-app granular scopes, keyed by app name (case-insensitive). */
  private appScopes: Map<string, AppScope> = new Map();

  /** Per-minute rate buckets for app scopes, keyed by app name. */
  private appScopeRateBuckets: Map<string, { count: number; windowStart: number }> =
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

    // 3. APP SCOPE — per-app granular rules evaluated before allowlist
    const scopeResult = this.evaluateAppScope(request.app, request.action, request.resource);
    if (scopeResult !== "no_scope") {
      const reason = scopeResult === "allow"
        ? `Allowed by app scope for ${request.app}`
        : `Denied by app scope for ${request.app}`;
      this.audit(request, scopeResult, reason);
      return {
        decision: scopeResult,
        reason,
        isBlocklisted: false,
        isAllowlisted: false,
      };
    }

    // 4. ALLOWLIST — auto-approve (subject to rate limit)
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

    // 5. Custom rules (evaluated in declaration order)
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

    // 6. Default: escalate to user
    this.audit(request, "ask", "No matching rule");
    return {
      decision: "ask",
      reason: "No matching policy rule",
      isBlocklisted: false,
      isAllowlisted: false,
    };
  }

  // -------------------------------------------------------------------------
  // Per-app permission scoping
  // -------------------------------------------------------------------------

  /**
   * Define granular permission rules for a specific app.
   * These are evaluated after the blocklist but before the allowlist.
   */
  addAppScope(appName: string, scope: AppScope): void {
    this.appScopes.set(appName.toLowerCase(), scope);
  }

  /**
   * Evaluate a request against the registered app scope for `appName`.
   * Returns 'allow' | 'deny' when the scope matches, or 'no_scope' when
   * no scope is registered for the app.
   */
  evaluateAppScope(appName: string, tool: string, resource: string): "allow" | "deny" | "no_scope" {
    const scope = this.appScopes.get(appName.toLowerCase());
    if (!scope) return "no_scope";

    // Denied paths take priority
    if (resource && matchesAny(resource, scope.deniedPaths)) return "deny";

    // Denied tools take priority
    if (scope.deniedTools.includes(tool) || scope.deniedTools.includes("*")) return "deny";

    // Check per-minute rate limit
    if (scope.maxRequestsPerMinute !== undefined) {
      const bucket = this.getAppScopeRateBucket(appName);
      if (bucket.count >= scope.maxRequestsPerMinute) return "deny";
      bucket.count++;
    }

    // Allowed paths
    if (resource && matchesAny(resource, scope.allowedPaths)) return "allow";

    // Allowed tools
    if (scope.allowedTools.includes(tool) || scope.allowedTools.includes("*")) return "allow";

    return "deny";
  }

  private getAppScopeRateBucket(appName: string): { count: number; windowStart: number } {
    const key = appName.toLowerCase();
    const now = Date.now();
    const existing = this.appScopeRateBuckets.get(key);
    if (!existing || now - existing.windowStart >= 60_000) {
      const fresh = { count: 0, windowStart: now };
      this.appScopeRateBuckets.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  // -------------------------------------------------------------------------
  // Permission Audit API
  // -------------------------------------------------------------------------

  private get auditLogPath(): string {
    return resolve(expandHome(this.policy.auditLog.path));
  }

  private async readAuditEntries(since?: Date): Promise<any[]> {
    const entries: any[] = [];
    try {
      const rl = createInterface({
        input: createReadStream(this.auditLogPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          if (since && entry.ts && new Date(entry.ts) < since) continue;
          entries.push(entry);
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // file may not exist yet — return empty
    }
    return entries;
  }

  async getAuditStats(since?: Date): Promise<{
    totalRequests: number;
    approved: number;
    denied: number;
    byTool: Record<string, { approved: number; denied: number }>;
    byApp: Record<string, { approved: number; denied: number }>;
    topDeniedResources: Array<{ resource: string; count: number }>;
  }> {
    const entries = await this.readAuditEntries(since);
    let approved = 0;
    let denied = 0;
    const byTool: Record<string, { approved: number; denied: number }> = {};
    const byApp: Record<string, { approved: number; denied: number }> = {};
    const deniedResourceCounts: Record<string, number> = {};

    for (const e of entries) {
      const isApproved = e.decision === "allow";
      const isDenied = e.decision === "deny";
      if (isApproved) approved++;
      if (isDenied) denied++;

      const tool: string = e.action ?? "unknown";
      if (!byTool[tool]) byTool[tool] = { approved: 0, denied: 0 };
      if (isApproved) byTool[tool]!.approved++;
      if (isDenied) byTool[tool]!.denied++;

      const app: string = e.app ?? "unknown";
      if (!byApp[app]) byApp[app] = { approved: 0, denied: 0 };
      if (isApproved) byApp[app]!.approved++;
      if (isDenied) byApp[app]!.denied++;

      if (isDenied && e.resource) {
        deniedResourceCounts[e.resource] = (deniedResourceCounts[e.resource] ?? 0) + 1;
      }
    }

    const topDeniedResources = Object.entries(deniedResourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([resource, count]) => ({ resource, count }));

    return {
      totalRequests: entries.length,
      approved,
      denied,
      byTool,
      byApp,
      topDeniedResources,
    };
  }

  async getRecentDecisions(limit = 50): Promise<Array<{
    timestamp: string;
    tool: string;
    resource: string;
    decision: string;
    reason: string;
    app?: string;
  }>> {
    const entries = await this.readAuditEntries();
    return entries.slice(-limit).map((e) => ({
      timestamp: e.ts ?? "",
      tool: e.action ?? "unknown",
      resource: e.resource ?? "",
      decision: e.decision ?? "ask",
      reason: e.reason ?? "",
      app: e.app,
    }));
  }

  async searchAuditLog(query: {
    tool?: string;
    resource?: string;
    decision?: string;
    since?: Date;
    until?: Date;
  }): Promise<any[]> {
    const entries = await this.readAuditEntries(query.since);
    return entries.filter((e) => {
      if (query.tool && e.action !== query.tool) return false;
      if (query.resource && !(e.resource ?? "").includes(query.resource)) return false;
      if (query.decision && e.decision !== query.decision) return false;
      if (query.until && e.ts && new Date(e.ts) > query.until) return false;
      return true;
    });
  }

  async exportAuditReport(outputPath: string, format: "json" | "csv"): Promise<string> {
    const entries = await this.readAuditEntries();
    const absPath = resolve(expandHome(outputPath));
    mkdirSync(dirname(absPath), { recursive: true });

    if (format === "json") {
      writeFileSync(absPath, JSON.stringify(entries, null, 2), "utf-8");
    } else {
      const headers = ["ts", "decision", "reason", "app", "resource", "action", "dialogType"];
      const rows = entries.map((e) =>
        headers.map((h) => JSON.stringify(e[h] ?? "")).join(",")
      );
      writeFileSync(absPath, [headers.join(","), ...rows].join("\n"), "utf-8");
    }
    return absPath;
  }

  async getPermissionSummary(): Promise<{
    engine: { blocklist: number; allowlist: number; customRules: number; appScopes: number };
    stats: { total: number; approveRate: number; topTools: string[] };
    status: "active" | "inactive";
  }> {
    const stats = await this.getAuditStats();
    const approveRate = stats.totalRequests > 0
      ? Math.round((stats.approved / stats.totalRequests) * 100) / 100
      : 0;
    const topTools = Object.entries(stats.byTool)
      .sort((a, b) => (b[1].approved + b[1].denied) - (a[1].approved + a[1].denied))
      .slice(0, 5)
      .map(([tool]) => tool);

    return {
      engine: {
        blocklist: this.policy.blocklist.paths.length + this.policy.blocklist.apps.length,
        allowlist: this.policy.allowlist.paths.length + this.policy.allowlist.apps.length,
        customRules: this.policy.rules.length,
        appScopes: this.appScopes.size,
      },
      stats: { total: stats.totalRequests, approveRate, topTools },
      status: this.policy.enabled ? "active" : "inactive",
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

  // ── §6 Sandbox Profiles ─────────────────────────────────────────────────

  private sandboxProfiles = new Map<
    string,
    {
      allowedTools: string[];
      allowedPaths: string[];
      deniedPaths: string[];
      maxRequestsPerMinute: number;
      timeWindow?: { start: string; end: string };
      networkAccess?: boolean;
    }
  >();

  /** Define a reusable named sandbox profile. */
  addSandboxProfile(
    profileName: string,
    config: {
      allowedTools: string[];
      allowedPaths: string[];
      deniedPaths: string[];
      maxRequestsPerMinute: number;
      timeWindow?: { start: string; end: string };
      networkAccess?: boolean;
    }
  ): void {
    this.sandboxProfiles.set(profileName, config);
  }

  /** Apply a named sandbox profile to an app (wraps addAppScope). */
  applySandboxProfile(appName: string, profileName: string): void {
    const profile = this.sandboxProfiles.get(profileName);
    if (!profile) throw new Error(`Sandbox profile "${profileName}" not found`);
    this.addAppScope(appName, {
      allowedPaths: profile.allowedPaths,
      deniedPaths: profile.deniedPaths,
      allowedTools: profile.allowedTools,
      deniedTools: [],
      maxRequestsPerMinute: profile.maxRequestsPerMinute,
    });
  }

  /** List all defined sandbox profiles. */
  listSandboxProfiles(): Array<{ name: string; config: any }> {
    return Array.from(this.sandboxProfiles.entries()).map(([name, config]) => ({
      name,
      config,
    }));
  }

  // ── §7 Policy Templates ────────────────────────────────────────────────

  /**
   * Load a predefined policy template.
   * - `strict`:     deny by default, only allowlist passes, 5 req/min
   * - `moderate`:   blocklist critical paths, allow dev tools, 30 req/min
   * - `permissive`: block only secrets dirs, allow everything, no rate limit
   */
  loadPolicyTemplate(template: "strict" | "moderate" | "permissive"): void {
    const home = homedir();
    switch (template) {
      case "strict":
        this.updatePolicy({
          enabled: true,
          defaultAction: "deny",
          blocklist: {
            paths: [
              "~/.ssh/**",
              "~/.aws/**",
              "~/.gnupg/**",
              "~/.config/gcloud/**",
              "/etc/shadow",
              "/etc/passwd",
            ],
            apps: [],
          },
          allowlist: {
            paths: [],
            apps: ["Terminal", "claude"],
            tools: ["Read", "Glob", "Grep"],
          },
          rateLimit: { maxPerMinute: 5 },
        });
        break;
      case "moderate":
        this.updatePolicy({
          enabled: true,
          defaultAction: "allow",
          blocklist: {
            paths: [
              "~/.ssh/**",
              "~/.aws/**",
              "~/.gnupg/**",
              "~/.config/gcloud/**",
              `${home}/Documents/Private/**`,
            ],
            apps: [],
          },
          allowlist: {
            paths: [`${home}/Projects/**`, `${home}/Developer/**`, "/tmp/**"],
            apps: ["Terminal", "iTerm2", "claude", "Code", "Cursor"],
            tools: [
              "Read",
              "Write",
              "Edit",
              "Glob",
              "Grep",
              "Bash",
              "NotebookEdit",
            ],
          },
          rateLimit: { maxPerMinute: 30 },
        });
        break;
      case "permissive":
        this.updatePolicy({
          enabled: true,
          defaultAction: "allow",
          blocklist: {
            paths: ["~/.ssh/**", "~/.aws/**", "~/.gnupg/**"],
            apps: [],
          },
          allowlist: {
            paths: ["**"],
            apps: ["*"],
            tools: ["*"],
          },
          rateLimit: { maxPerMinute: 0 },
        });
        break;
    }
  }

  /** Serialize the entire current policy (including app scopes and sandbox profiles) to JSON. */
  exportPolicy(): string {
    const data = {
      policy: this.policy,
      appScopes: Object.fromEntries(this.appScopes),
      sandboxProfiles: Object.fromEntries(this.sandboxProfiles),
    };
    return JSON.stringify(data, null, 2);
  }

  /** Import and apply a previously-exported policy JSON string. */
  importPolicy(json: string): void {
    const data = JSON.parse(json);
    if (data.policy) {
      this.updatePolicy(data.policy);
    }
    if (data.appScopes) {
      for (const [app, scope] of Object.entries(data.appScopes)) {
        this.addAppScope(app, scope as AppScope);
      }
    }
    if (data.sandboxProfiles) {
      for (const [name, config] of Object.entries(data.sandboxProfiles)) {
        this.addSandboxProfile(name, config as any);
      }
    }
  }
}
