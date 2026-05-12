# cypress-mcp

> MCP (Model Context Protocol) server plugin for Cypress — let AI agents control your browser for testing.

Turn Cypress into an MCP server that AI clients (Claude Desktop, Cursor, Windsurf, etc.) can use to navigate, interact with, and test web applications.

## Features

- **52 browser automation tools** — navigate, click, type, screenshot, intercept network, iframes, and more
- **Accessibility-first DOM snapshots** — ARIA-based page representation optimized for LLM understanding
- **Zero config** — just 2 lines to integrate into your Cypress project
- **Network interception** — capture, filter, and mock HTTP requests
- **Test generation** — automatically generate Cypress tests from recorded sessions
- **Plugin system** — extend with custom tools via third-party plugins
- **MCP standard** — works with any MCP-compatible AI client

## Quick Start

### Install

```bash
npm install cypress-mcp --save-dev
```

### Configure (2 lines)

**cypress.config.ts:**

```typescript
import { defineConfig } from 'cypress';
import { cypressMcp } from 'cypress-mcp/plugin';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000', // your app
    setupNodeEvents(on, config) {
      cypressMcp(on, config);
      return config;
    },
  },
});
```

**cypress/support/e2e.ts:**

```typescript
import 'cypress-mcp/support';
```

### Run

```bash
# Auto-detects baseUrl from cypress.config
npx cypress-mcp

# Or override baseUrl for a specific project
npx cypress-mcp --base-url http://localhost:4200

# All options
npx cypress-mcp --base-url http://localhost:3000 --browser chrome --port 3457 --debug
```

### Connect to MCP Clients

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp"]
    }
  }
}
```

baseUrl is auto-detected from `cypress.config.ts` in the working directory. To override:

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp", "--base-url", "http://localhost:4200"],
      "env": {
        "CYPRESS_BASE_URL": "http://localhost:4200"
      }
    }
  }
}
```

**VS Code / Cursor:**

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp", "--base-url", "http://localhost:3000"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add cypress npx cypress-mcp --base-url http://localhost:3000
```

### baseUrl Resolution Order

The CLI resolves `baseUrl` from multiple sources (highest priority first):

1. `--base-url` CLI argument
2. `CYPRESS_BASE_URL` environment variable
3. Auto-detected from `cypress.config.{ts,js}` in current directory
4. No baseUrl (Cypress works without it — use `browser_navigate` to go anywhere)

## Tools (38 total)

### Navigation (4)
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_go_back` | Go back in history |
| `browser_go_forward` | Go forward in history |
| `browser_reload` | Reload the page |

### Interaction (9)
| Tool | Description |
|------|-------------|
| `browser_click` | Click an element (left/right/double) |
| `browser_type` | Type text with keystroke simulation |
| `browser_fill` | Set input value directly |
| `browser_select` | Select dropdown option |
| `browser_check` | Check/uncheck checkbox or radio |
| `browser_hover` | Hover over element |
| `browser_scroll` | Scroll page or element into view |
| `browser_drag_drop` | Drag and drop elements |
| `browser_press_key` | Press keyboard keys |

### Snapshot & DOM (4)
| Tool | Description |
|------|-------------|
| `browser_snapshot` | **Core tool** — accessibility tree snapshot |
| `browser_query_elements` | Find elements by role, text, state |
| `browser_get_text` | Get element or page text content |
| `browser_get_attribute` | Get HTML attribute values |

### Network (5)
| Tool | Description |
|------|-------------|
| `browser_network_requests` | List captured requests |
| `browser_network_request` | Get full request details |
| `browser_mock_route` | Mock a network endpoint |
| `browser_remove_mock` | Remove a mock |
| `browser_wait_for_request` | Wait for a specific request |

### Screenshot & Visual (2)
| Tool | Description |
|------|-------------|
| `browser_screenshot` | Capture screenshot (element or page) |
| `browser_viewport` | Set viewport size/preset |

### Console & Debug (2)
| Tool | Description |
|------|-------------|
| `browser_console_messages` | Get console log/warn/error |
| `browser_evaluate` | Execute JavaScript in browser |

### Tab Management (4)
| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List open tabs (emulated) |
| `browser_new_tab` | Open new tab |
| `browser_switch_tab` | Switch to tab |
| `browser_close_tab` | Close tab |

### Storage & Cookies (5)
| Tool | Description |
|------|-------------|
| `browser_get_cookies` | Get cookies |
| `browser_set_cookie` | Set a cookie |
| `browser_clear_cookies` | Clear cookies |
| `browser_local_storage` | Get/set/delete localStorage |
| `browser_session_storage` | Get/set/delete sessionStorage |

### Dialog (1)
| Tool | Description |
|------|-------------|
| `browser_handle_dialog` | Handle alert/confirm/prompt |

### Utility (4)
| Tool | Description |
|------|-------------|
| `browser_wait` | Wait for condition/time/element |
| `browser_assert` | Assert element state |
| `browser_run_cypress` | Execute raw Cypress commands |
| `browser_generate_test` | Generate test from session history |

## Architecture

```
┌─────────────────┐    stdio/SSE     ┌─────────────────┐
│   AI Client     │ ◄──────────────► │   MCP Server    │
│ (Claude, etc.)  │                  │   (Node.js)     │
└─────────────────┘                  │                 │
                                     │  38 Tool        │
                                     │  Handlers       │
                                     │                 │
                                     │  State Manager  │
                                     └────────┬────────┘
                                              │ cy.task()
                                              │ (polling)
                                     ┌────────┴────────┐
                                     │  Cypress Browser │
                                     │                 │
                                     │  Agent Loop     │
                                     │  DOM Snapshotter│
                                     │  Net Interceptor│
                                     │  Console Hook   │
                                     └─────────────────┘
```

**3-Layer Architecture:**

1. **MCP Server (Node.js)** — Handles MCP protocol, tool registration, request routing
2. **Bridge** — cy.task() based polling between Node.js and Cypress browser
3. **Cypress Runtime** — Agent spec keeps browser open, executes commands, captures state

## Options

```typescript
cypressMcp(on, config, {
  wsPort: 3456,        // Bridge port
  transport: 'stdio',  // 'stdio' or 'sse'
  ssePort: 3100,       // SSE port (if transport === 'sse')
  debug: false,        // Debug logging
});
```

## How it Works

1. `cypressMcp()` starts an MCP server (stdio) and registers 38 tool handlers
2. Cypress runs an "agent spec" that keeps the browser open in a polling loop
3. When the AI client calls a tool (e.g., `browser_navigate`), the MCP server queues a command
4. The browser-side agent polls for commands via `cy.task('mcpBridgePoll')`
5. Commands execute as real Cypress commands (`cy.visit`, `cy.click`, etc.)
6. Results flow back through `cy.task('mcpBridgeResponse')`

## Security

See [SECURITY.md](SECURITY.md) for security considerations, especially regarding `browser_evaluate` and `browser_run_cypress` tools.

**Important:** This tool is for development/testing only. Do not expose the MCP server to untrusted networks.

## Requirements

- Node.js >= 18
- Cypress >= 12.0.0

## License

MIT
