/**
 * Extended Tool Definitions — All 45+ tools organized by category.
 * This file extends the base tools.ts with all newly implemented tools.
 */

import type { AnthropicTool } from "./tools.js";

// ------------------------------------------------------------------
// OS & Hardware Tools (10)
// ------------------------------------------------------------------

export const OS_HARDWARE_TOOLS: AnthropicTool[] = [
  {
    name: "dark_mode_toggle",
    description: "Toggle macOS Dark Mode on or off. Optional enable param forces specific state.",
    input_schema: {
      type: "object",
      properties: {
        enable: { type: "boolean", description: "Force enable (true) or disable (false). Omit to toggle." }
      }
    }
  },
  {
    name: "dark_mode_get",
    description: "Get current Dark Mode state.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "set_volume_percent",
    description: "Set system output volume to a percentage (0-100).",
    input_schema: {
      type: "object",
      properties: {
        percent: { type: "number", description: "Volume percentage 0-100" }
      },
      required: ["percent"]
    }
  },
  {
    name: "get_volume_percent",
    description: "Get current system volume percentage.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "wifi_toggle",
    description: "Toggle WiFi on/off. Optional enable param forces specific state.",
    input_schema: {
      type: "object",
      properties: {
        enable: { type: "boolean", description: "Force enable (true) or disable (false)" }
      }
    }
  },
  {
    name: "get_battery_percent",
    description: "Get current battery percentage and charging status.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "dnd_toggle",
    description: "Toggle Do Not Disturb / Focus mode on/off.",
    input_schema: {
      type: "object",
      properties: {
        enable: { type: "boolean", description: "Force enable or disable" }
      }
    }
  },
  {
    name: "mic_mute_toggle",
    description: "Toggle system microphone mute on/off.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "lock_screen",
    description: "Lock the macOS screen immediately.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "set_brightness",
    description: "Set display brightness to a percentage (0-100).",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "number", description: "Brightness level 0-100" }
      },
      required: ["level"]
    }
  },
  {
    name: "set_random_wallpaper",
    description: "Set a random wallpaper from ~/Pictures.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "top_ram_processes",
    description: "List top processes by RAM usage.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of processes to return (default 10)" }
      }
    }
  }
];

// ------------------------------------------------------------------
// App Management Tools (10)
// ------------------------------------------------------------------

export const APP_MANAGEMENT_TOOLS: AnthropicTool[] = [
  {
    name: "open_app",
    description: "Open a macOS application by name.",
    input_schema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Application name (e.g. 'Safari', 'Notion')" }
      },
      required: ["app"]
    }
  },
  {
    name: "force_quit_app",
    description: "Force quit an application by name.",
    input_schema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Application name to force quit" }
      },
      required: ["app"]
    }
  },
  {
    name: "minimize_all_windows",
    description: "Minimize all open windows to the Dock.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "apple_notes_create",
    description: "Create a new note in Apple Notes with a title.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title" }
      },
      required: ["title"]
    }
  },
  {
    name: "spotify_play",
    description: "Play music in Spotify. Optional playlist URI.",
    input_schema: {
      type: "object",
      properties: {
        playlistUri: { type: "string", description: "Spotify playlist URI" }
      }
    }
  },
  {
    name: "spotify_pause",
    description: "Pause Spotify playback.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "spotify_next_track",
    description: "Skip to next track in Spotify.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "calendar_show_today",
    description: "Open Calendar app and show today's events.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "open_mail",
    description: "Open the Mail application.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "close_finder_windows",
    description: "Close all Finder windows.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "is_app_running",
    description: "Check if an application is currently running.",
    input_schema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Application name" }
      },
      required: ["app"]
    }
  }
];

// ------------------------------------------------------------------
// Browser Tools (10)
// ------------------------------------------------------------------

export const BROWSER_TOOLS: AnthropicTool[] = [
  {
    name: "open_url",
    description: "Open a URL in Safari or Chrome.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
        browser: { type: "string", enum: ["safari", "chrome"], description: "Target browser" }
      },
      required: ["url"]
    }
  },
  {
    name: "google_search",
    description: "Perform a Google search.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "open_incognito",
    description: "Open a new Chrome incognito/private window.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "close_all_tabs",
    description: "Close all browser tabs in Safari or Chrome.",
    input_schema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["safari", "chrome"] }
      }
    }
  },
  {
    name: "youtube_search",
    description: "Search YouTube videos.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_active_tab_url",
    description: "Get URL of the currently active browser tab.",
    input_schema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["safari", "chrome"] }
      }
    }
  },
  {
    name: "reload_page",
    description: "Reload the current browser page.",
    input_schema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["safari", "chrome"] }
      }
    }
  },
  {
    name: "google_maps_directions",
    description: "Open Google Maps with directions to a destination.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Destination address or place" }
      },
      required: ["destination"]
    }
  },
  {
    name: "bookmark_page",
    description: "Bookmark the current browser page.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Optional bookmark title" },
        browser: { type: "string", enum: ["safari", "chrome"] }
      }
    }
  },
  {
    name: "find_nearby",
    description: "Find places near a location using Google Maps.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Place type (e.g. 'coffee shop', 'restaurant')" },
        location: { type: "string", description: "Location to search near" }
      },
      required: ["category", "location"]
    }
  }
];

// ------------------------------------------------------------------
// File Tools (10)
// ------------------------------------------------------------------

export const FILE_TOOLS: AnthropicTool[] = [
  {
    name: "create_folder",
    description: "Create a new folder. Optionally on Desktop.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Full path or folder name" },
        onDesktop: { type: "boolean", description: "Create on Desktop if true" }
      },
      required: ["path"]
    }
  },
  {
    name: "find_files_by_extension",
    description: "Find all files with a specific extension in a directory.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory to search" },
        extension: { type: "string", description: "File extension (e.g. 'pdf')" },
        recursive: { type: "boolean", description: "Search subdirectories (default true)" }
      },
      required: ["directory", "extension"]
    }
  },
  {
    name: "delete_file",
    description: "Delete a file by path.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Full file path" }
      },
      required: ["path"]
    }
  },
  {
    name: "rename_file",
    description: "Rename a file. Specify old and new names in a folder.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder containing the file" },
        oldName: { type: "string", description: "Current file name" },
        newName: { type: "string", description: "New file name" }
      },
      required: ["folder", "oldName", "newName"]
    }
  },
  {
    name: "copy_folder",
    description: "Copy a folder to a destination.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source folder path" },
        destination: { type: "string", description: "Destination folder path" }
      },
      required: ["source", "destination"]
    }
  },
  {
    name: "compress_to_zip",
    description: "Compress a folder to a .zip file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path to compress" },
        zipName: { type: "string", description: "Output zip file name (optional)" }
      },
      required: ["path"]
    }
  },
  {
    name: "open_folder_in_finder",
    description: "Open a folder in Finder.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path" }
      },
      required: ["path"]
    }
  },
  {
    name: "sort_desktop_by",
    description: "Sort Desktop files by name, date, size, or kind.",
    input_schema: {
      type: "object",
      properties: {
        sortBy: { type: "string", enum: ["name", "date", "size", "kind"], description: "Sort criteria" }
      }
    }
  },
  {
    name: "find_large_files",
    description: "Find files larger than a specified size in MB.",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory to search (default home)" },
        minSizeMB: { type: "number", description: "Minimum size in MB (default 1024)" }
      }
    }
  },
  {
    name: "empty_trash",
    description: "Empty the Trash folder.",
    input_schema: { type: "object", properties: {} }
  }
];

// ------------------------------------------------------------------
// Dev Tools (5)
// ------------------------------------------------------------------

export const DEV_TOOLS: AnthropicTool[] = [
  {
    name: "ping_host",
    description: "Ping a host and return statistics.",
    input_schema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Host or IP to ping" },
        count: { type: "number", description: "Number of pings (default 4)" }
      },
      required: ["host"]
    }
  },
  {
    name: "open_vscode",
    description: "Open Visual Studio Code. Optional project path.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project folder path" }
      }
    }
  },
  {
    name: "run_build",
    description: "Run a build command in a directory.",
    input_schema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Working directory" },
        command: { type: "string", description: "Build command (default 'npm run build')" }
      },
      required: ["cwd"]
    }
  },
  {
    name: "docker_start",
    description: "Start Docker Desktop application.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "get_local_ip",
    description: "Get local IP address and optionally copy to clipboard.",
    input_schema: {
      type: "object",
      properties: {
        copyToClipboard: { type: "boolean", description: "Copy to clipboard (default false)" }
      }
    }
  }
];

// ------------------------------------------------------------------
// Chaining Workflows (5)
// ------------------------------------------------------------------

export const CHAINING_TOOLS: AnthropicTool[] = [
  {
    name: "screenshot_and_send_zalo",
    description: "Capture screenshot and send via Zalo to a contact.",
    input_schema: {
      type: "object",
      properties: {
        contact: { type: "string", description: "Zalo contact name" },
        message: { type: "string", description: "Optional message text" }
      },
      required: ["contact"]
    }
  },
  {
    name: "start_coding_mode",
    description: "Open YouTube lofi, enable DND, and open VS Code.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "download_unzip_delete",
    description: "Download a file, extract it, and delete the archive.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Download URL" },
        destination: { type: "string", description: "Destination folder (default Downloads)" }
      },
      required: ["url"]
    }
  },
  {
    name: "edit_config_key",
    description: "Read a config file, edit a key, and write back.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Config file path" },
        key: { type: "string", description: "Key to edit" },
        value: { type: "string", description: "New value" }
      },
      required: ["path", "key", "value"]
    }
  },
  {
    name: "schedule_message_then_lock",
    description: "Schedule a Telegram message and lock screen after delay.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to send" },
        delayMinutes: { type: "number", description: "Delay in minutes (default 30)" }
      },
      required: ["message"]
    }
  },
  {
    name: "execute_chain",
    description: "Execute a sequence of tool calls in order.",
    input_schema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Array of {tool, params} steps",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              params: { type: "object" },
              delay: { type: "number" }
            }
          }
        }
      },
      required: ["steps"]
    }
  }
];

// ------------------------------------------------------------------
// Combine All Tools
// ------------------------------------------------------------------

export const ALL_EXTENDED_TOOLS: AnthropicTool[] = [
  ...OS_HARDWARE_TOOLS,
  ...APP_MANAGEMENT_TOOLS,
  ...BROWSER_TOOLS,
  ...FILE_TOOLS,
  ...DEV_TOOLS,
  ...CHAINING_TOOLS
];

// Tool name lookup
export const TOOL_BY_NAME: Map<string, AnthropicTool> = new Map(
  ALL_EXTENDED_TOOLS.map(t => [t.name, t])
);
