import { z } from "zod";

/** Gateway configuration schema, validated at startup with Zod. */
export const gatewayConfigSchema = z.object({
  gateway: z.object({
    bind: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(19800),
    auth: z.object({
      token: z.string().optional(),
      localAutoApprove: z.boolean().default(true),
    }),
  }),

  execution: z.object({
    defaultLayer: z.enum(["auto", "deep", "surface"]).default("auto"),
    maxRetries: z.number().int().min(0).default(3),
    retryBackoffMs: z.array(z.number()).default([1000, 3000, 10000]),
    verifyAfterEachStep: z.boolean().default(true),
    screenshotOnError: z.boolean().default(true),
  }),

  session: z.object({
    store: z.string().default("~/.omnistate/sessions/sessions.json"),
    transcriptDir: z.string().default("~/.omnistate/sessions/"),
    maintenance: z.object({
      mode: z.enum(["warn", "enforce"]).default("enforce"),
      pruneAfter: z.string().default("30d"),
      maxEntries: z.number().int().default(500),
    }),
  }),

  fleet: z.object({
    enabled: z.boolean().default(false),
    discoveryMode: z.enum(["tailscale", "manual", "mdns"]).default("tailscale"),
    agents: z.array(z.string()).default([]),
  }),

  health: z.object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().min(1000).default(30000),
    autoRepair: z.boolean().default(true),
    notifyChannel: z.string().optional(),
  }),

  plugins: z.object({
    dir: z.string().default("~/.omnistate/plugins/"),
    enabled: z.array(z.string()).default([]),
  }),
});

export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;
