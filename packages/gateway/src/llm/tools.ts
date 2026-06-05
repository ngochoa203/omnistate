/**
 * Shared tool definitions in Anthropic format with an adapter to OpenAI
 * function-calling format. Phase 3 seed set — full list extended in Phase 4.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicToolInputProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: AnthropicToolInputProperty;
  properties?: Record<string, AnthropicToolInputProperty>;
  required?: string[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, AnthropicToolInputProperty>;
    required?: string[];
  };
}

export interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, object>;
    required?: string[];
  };
}

export interface OpenAITool {
  type: "function";
  function: OpenAIFunction;
}

// ---------------------------------------------------------------------------
// Seed tool definitions (Anthropic format)
// ---------------------------------------------------------------------------

export const ALL_TOOLS: AnthropicTool[] = [
  {
    name: "timer.set",
    description: "Set a countdown timer for a specified duration.",
    input_schema: {
      type: "object",
      properties: {
        duration_seconds: {
          type: "number",
          description: "Timer duration in seconds.",
        },
        label: {
          type: "string",
          description: "Optional human-readable label for the timer.",
        },
        durationMs: {
          type: "number",
          description: "Timer duration in milliseconds (alternative to duration_seconds).",
        },
      },
      required: ["duration_seconds"],
    },
  },
  {
    name: "timer.cancel",
    description: "Cancel an active countdown timer by its id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Timer id returned by timer.set." },
      },
      required: ["id"],
    },
  },
  {
    name: "timer.list",
    description: "List all active countdown timers for the current session.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "note.create",
    description: "Create and persist a text note with optional tags.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Body text of the note." },
        tags: {
          type: "array",
          description: "Optional list of tag strings.",
          items: { type: "string" },
        },
      },
      required: ["text"],
    },
  },
  {
    name: "note.list",
    description: "List all saved notes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "note.search",
    description: "Search notes by text or tag.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term to match against note text or tags." },
      },
      required: ["query"],
    },
  },
  {
    name: "reminder.set",
    description: "Set a reminder that fires at a specific time with a message.",
    input_schema: {
      type: "object",
      properties: {
        at: {
          type: "string",
          description: "ISO-8601 datetime or cron expression (5-field) when the reminder fires.",
        },
        message: { type: "string", description: "Reminder message text." },
      },
      required: ["at", "message"],
    },
  },
  {
    name: "reminder.list",
    description: "List all active reminders for the current session.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "reminder.cancel",
    description: "Cancel an active reminder by its id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reminder id returned by reminder.set." },
      },
      required: ["id"],
    },
  },
  {
    name: "calendar.today",
    description: "List all Calendar.app events scheduled for today (macOS only).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "calendar.next",
    description: "Return the next upcoming Calendar.app event (macOS only).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "app.launch",
    description: "Launch a macOS application by name or bundle identifier.",
    input_schema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Application name (e.g. 'Safari') or bundle ID (e.g. 'com.apple.Safari').",
        },
        args: {
          type: "array",
          description: "Optional command-line arguments to pass to the application.",
          items: { type: "string" },
        },
      },
      required: ["app"],
    },
  },
  {
    name: "ui.click",
    description: "Perform a mouse click at screen coordinates or on a named UI element.",
    input_schema: {
      type: "object",
      properties: {
        x: {
          type: "number",
          description: "Horizontal screen coordinate (pixels from left edge).",
        },
        y: {
          type: "number",
          description: "Vertical screen coordinate (pixels from top edge).",
        },
        element: {
          type: "string",
          description: "Accessibility label or role description of the target element (alternative to x/y).",
        },
        button: {
          type: "string",
          description: "Mouse button to use: 'left', 'right', or 'middle'. Defaults to 'left'.",
          enum: ["left", "right", "middle"],
        },
        double: {
          type: "boolean",
          description: "Whether to perform a double-click.",
        },
      },
    },
  },
  {
    name: "shell.exec",
    description: "Execute a shell command and return its stdout/stderr output.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command.",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds. Defaults to 30000.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "network.wifi",
    description: "Query or change Wi-Fi state: toggle, connect to a network, or list nearby SSIDs.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action to perform.",
          enum: ["on", "off", "connect", "disconnect", "list", "status"],
        },
        ssid: {
          type: "string",
          description: "Network SSID to connect to (required when action is 'connect').",
        },
        password: {
          type: "string",
          description: "Network password (required when action is 'connect' and the network is secured).",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "wifi.scan",
    description: "Scan for nearby Wi-Fi networks and list SSIDs, BSSIDs, signal strength, channels, and security types.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "wifi.details",
    description: "Get detailed information about the current Wi-Fi connection (SSID, BSSID, RSSI, channel, noise, security type).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "wifi.monitor.start",
    description: "Enable Wi-Fi monitor mode for packet sniffing (requires sudo). Captures raw 802.11 frames.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "number", description: "Wi-Fi channel to monitor (1-165). Defaults to 1." },
      },
    },
  },
  {
    name: "wifi.monitor.stop",
    description: "Disable Wi-Fi monitor mode and restore normal Wi-Fi operation.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "network.capture",
    description: "Capture network packets using tcpdump with optional BPF filter.",
    input_schema: {
      type: "object",
      properties: {
        iface: { type: "string", description: "Network interface (e.g. 'en0')." },
        filter: { type: "string", description: "BPF filter expression (e.g. 'tcp port 80')." },
        duration: { type: "number", description: "Capture duration in seconds." },
        outFile: { type: "string", description: "Output pcap file path." },
      },
      required: ["iface", "filter", "duration", "outFile"],
    },
  },
  {
    name: "network.scan.hosts",
    description: "Discover live hosts on a subnet using ARP/ping sweep or nmap.",
    input_schema: {
      type: "object",
      properties: {
        subnet: { type: "string", description: "Target subnet in CIDR notation (e.g. '192.168.1.0/24')." },
      },
      required: ["subnet"],
    },
  },
  {
    name: "network.scan.ports",
    description: "Scan ports on a target host to find open services.",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Target hostname or IP address." },
        ports: { type: "string", description: "Comma-separated port list or range (e.g. '22,80,443' or '1-1024'). Defaults to common ports." },
      },
      required: ["host"],
    },
  },
  {
    name: "network.dns",
    description: "Perform DNS lookup for a domain name.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain name to look up." },
        type: { type: "string", description: "DNS record type (A, AAAA, MX, NS, TXT, CNAME, SOA). Defaults to A.", enum: ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"] },
      },
      required: ["domain"],
    },
  },
  {
    name: "network.whois",
    description: "Perform a WHOIS lookup for a domain or IP address.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Domain name or IP address to look up." },
      },
      required: ["target"],
    },
  },
  {
    name: "security.tools",
    description: "Check which security/pentest tools are installed on the system (nmap, tcpdump, aircrack-ng, etc.).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "security.audit",
    description: "Run a basic security audit: check open ports, firewall status, Wi-Fi security, SSH status, and generate recommendations.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "manage_application",
    description: "Open, close or manage a specific application with optional duration.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["open", "close"],
          description: "Action: open or close"
        },
        app_name: {
          type: "string",
          description: "Exact app name (zalo, chrome, safari). Only the app name, NO duration."
        },
        duration_seconds: {
          type: "integer",
          description: "If user wants to open app for a duration then close, set this. null if not specified."
        }
      },
      required: ["action", "app_name"]
    }
  },
  {
    name: "orchestrate",
    description: "Execute a sequence of UI automation steps on macOS. Use for apps without API (Zalo, LINE, etc.). Steps execute in order. Return results for each step.",
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered list of steps to execute. Each step has action + params.",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: [
                  // App lifecycle
                  "app.open", "app.close", "app.wait", "app.focus",
                  // Mouse actions
                  "click", "double_click", "right_click",
                  // Keyboard actions
                  "type", "paste", "key", "enter", "tab", "escape", "select.all",
                  // Search in app
                  "search.find", "search.type", "contact.search",
                  // Messaging
                  "message.send",
                  // UI wait/exists
                  "ui.wait_for", "ui.exists", "ui.wait_for_element",
                  // File operations
                  "file.list_images", "file.classify_image", "file.move", "file.copy", "file.delete",
                  "file.find", "file.create_folder",
                  // Vision/AI
                  "vision.detect_cat", "vision.detect_objects", "vision.classify",
                  // Misc
                  "screenshot", "sleep"
                ],
                description: "Action type: app.* for app control, click/type for UI, file.* for files, vision.* for AI"
              },
              params: {
                type: "object",
                description: "Action parameters (varies by action type)",
                properties: {
                  // App control
                  app: { type: "string", description: "App name (e.g. 'Zalo', 'Safari')" },
                  seconds: { type: "number", description: "Seconds to wait" },
                  button: { type: "string", enum: ["left", "right"], description: "Mouse button" },
                  // Mouse coordinates
                  x: { type: "number", description: "X coordinate" },
                  y: { type: "number", description: "Y coordinate" },
                  // UI elements
                  element: { type: "string", description: "UI element identifier (AX role, label, title)" },
                  timeout: { type: "number", description: "Timeout in seconds" },
                  // Keyboard
                  key: { type: "string", description: "Key name (e.g. 'return', 'tab', 'f')" },
                  modifiers: { type: "array", items: { type: "string" }, description: "Modifier keys (command, shift, option, control)" },
                  // Search/contact
                  contact: { type: "string", description: "Contact name or phone" },
                  // File operations
                  path: { type: "string", description: "File or directory path" },
                  source: { type: "string", description: "Source path for file operations" },
                  destination: { type: "string", description: "Destination path for file operations" },
                  filter: { type: "string", enum: ["cat", "dog", "all"], description: "Image filter (for vision classification)" },
                  recursive: { type: "boolean", description: "Recursively process directories" },
                  dry_run: { type: "boolean", description: "Preview without making changes" },
                  // Messaging
                  message: { type: "string", description: "Message text to send" },
                  // Vision
                  confidence: { type: "number", description: "Minimum confidence threshold (0-1)" },
                  selector: { type: "string", description: "CSS/AX selector for element" }
                }
              }
            }
          }
        },
        session_id: {
          type: "string",
          description: "Optional session ID for multi-step workflows (for context continuity)"
        }
      },
      required: ["steps"]
    }
  },
];

const QUARANTINED_MAINLINE_TOOLS = new Set<string>([
  "wifi.monitor.start",
  "wifi.monitor.stop",
  "network.capture",
  "network.scan.hosts",
  "network.scan.ports",
  "wifi.deep.scan",
  "wifi.channel.set",
  "wifi.capture.handshake",
  "wifi.tools.install",
  "wifi.deauth",
  "wifi.crack.handshake",
]);

export const TOOLS: AnthropicTool[] = ALL_TOOLS.filter((tool) => !QUARANTINED_MAINLINE_TOOLS.has(tool.name));

// ---------------------------------------------------------------------------
// Adapter: Anthropic -> OpenAI function-calling format
// ---------------------------------------------------------------------------

export function toOpenAITools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as OpenAIFunction["parameters"],
    },
  }));
}
