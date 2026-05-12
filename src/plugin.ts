import { McpServer } from './server/mcp-server';
import { BridgeServer } from './bridge/ws-server';
import { StateManager } from './state/state-manager';
import { registerAllTools, ToolRegistry, CypressMcpPlugin, ToolMiddleware } from './server/tool-registry-v2';

export interface CypressMcpOptions {
  /** WebSocket port for bridge. Default: 3456 */
  wsPort?: number;
  /** MCP transport: 'stdio' | 'sse'. Default: 'stdio' */
  transport?: 'stdio' | 'sse';
  /** SSE port (if transport === 'sse'). Default: 3100 */
  ssePort?: number;
  /** Enable debug logging. Default: false */
  debug?: boolean;
  /** Path to persist browser profile (cookies, localStorage) between sessions. */
  userDataDir?: string;
  /** Enable Cypress video recording. Default: false */
  video?: boolean;
  /** Enable tracing (Cypress screenshots on failure + command log). Default: false */
  tracing?: boolean;
  /** Third-party plugins to register */
  plugins?: CypressMcpPlugin[];
  /** Global middleware hooks (run before/after every tool execution) */
  middleware?: ToolMiddleware[];
}

/**
 * Cypress MCP Plugin Entry — call inside setupNodeEvents().
 *
 * @example
 * ```ts
 * import { defineConfig } from 'cypress';
 * import { cypressMcp } from 'cypress-mcp/plugin';
 *
 * export default defineConfig({
 *   e2e: {
 *     setupNodeEvents(on, config) {
 *       cypressMcp(on, config);
 *       return config;
 *     }
 *   }
 * });
 * ```
 */
export function cypressMcp(
  on: (event: string, ...args: any[]) => void,
  config: Record<string, any>,
  options: CypressMcpOptions = {}
): Record<string, any> {
  const {
    wsPort = 3456,
    transport = 'stdio',
    ssePort = 3100,
    debug = false,
    userDataDir,
    video = false,
    tracing = false,
    plugins = [],
    middleware = [],
  } = options;

  // ── 1. Init core services ──
  const state = new StateManager();
  const bridge = new BridgeServer(wsPort, state, { debug });
  const mcpServer = new McpServer(bridge, state, { transport, ssePort, debug });

  // ── 2. Register all tools (auto-discover + plugins) ──
  const registry = registerAllTools(mcpServer, bridge, state, { debug, plugins });

  // ── 2b. Register global middleware ──
  for (const mw of middleware) {
    registry.use(mw);
  }

  // ── 3. Register cy.task handlers ──
  on('task', {
    mcpBridgePoll() {
      return bridge.getPendingCommand();
    },

    mcpBridgeResponse(message: { id: string; data?: any; error?: string }) {
      bridge.handleBrowserResponse(message);
      return null;
    },

    mcpNetworkUpdate(requests: any[]) {
      state.updateNetworkRequests(requests);
      return null;
    },

    mcpConsoleUpdate(messages: any[]) {
      state.updateConsoleMessages(messages);
      return null;
    },

    mcpGetState() {
      return {
        url: state.currentUrl,
        title: state.currentTitle,
        viewport: { width: state.viewportWidth, height: state.viewportHeight },
        networkCount: state.networkRequests.length,
        consoleCount: state.consoleMessages.length,
        mockCount: state.activeMocks.size,
        historyCount: state.commandHistory.length,
      };
    },
  });

  // ── 4. Start bridge + MCP on browser launch ──
  on('before:browser:launch', (browser: any, launchOptions: any) => {
    bridge.start();
    mcpServer.start().catch((err) => {
      console.error('[cypress-mcp] MCP server start failed:', err);
    });

    if (debug) {
      console.error(`[cypress-mcp] Bridge ready (task-based, port: ${wsPort})`);
      console.error(`[cypress-mcp] MCP server starting (${transport})`);
    }

    return launchOptions;
  });

  // ── 5. Cleanup ──
  on('after:run', () => {
    bridge.stop();
    mcpServer.stop();
  });

  // ── 6. Inject env vars for browser side ──
  config.env = {
    ...config.env,
    MCP_WS_PORT: wsPort,
    MCP_DEBUG: debug,
  };

  // ── 7. Persistent profile — userDataDir ──
  if (userDataDir) {
    config.env.MCP_USER_DATA_DIR = userDataDir;
    // Tell Cypress to use this profile directory
    (config as any).userDataDir = userDataDir;
    if (debug) console.error(`[cypress-mcp] Persistent profile: ${userDataDir}`);
  }

  // ── 8. Video & Tracing ──
  if (video) {
    (config as any).video = true;
    if (debug) console.error('[cypress-mcp] Video recording enabled');
  }
  if (tracing) {
    (config as any).screenshotOnRunFailure = true;
    if (debug) console.error('[cypress-mcp] Tracing (screenshots on failure) enabled');
  }

  return config;
}
