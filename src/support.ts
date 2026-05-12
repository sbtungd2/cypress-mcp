/**
 * cypress-mcp/support — Import in cypress/support/e2e.ts
 *
 * Auto-setup:
 * - Network interceptor (capture all requests)
 * - Console collector (hook console.*)
 * - DOM snapshot custom command
 * - Agent loop command
 *
 * @example
 * ```ts
 * // cypress/support/e2e.ts
 * import 'cypress-mcp/support';
 * ```
 */

declare global {
  namespace Cypress {
    interface Chainable {
      mcpSnapshot(options?: any): Chainable<any>;
      mcpAgentLoop(): Chainable<void>;
    }
  }
  interface Window {
    __mcpNetworkBuffer: any[];
    __mcpConsoleBuffer: any[];
    __mcpRefCounter: number;
  }
}

const debug = Cypress.env('MCP_DEBUG') || false;

function log(msg: string) {
  if (debug) {
    Cypress.log({ name: 'MCP', message: msg, consoleProps: () => ({ message: msg }) });
  }
}

// ═══════════════════════════════════════════
// 1. Network Interceptor — capture all requests
// ═══════════════════════════════════════════
let requestId = 0;
// Shared buffer accessible from Node.js side via cy.task
const networkBuffer: any[] = [];

beforeEach(() => {
  requestId = 0;
  networkBuffer.length = 0;

  cy.intercept('**', (req) => {
    const id = ++requestId;
    const startTime = Date.now();

    req.on('response', (res) => {
      const captured = {
        id,
        url: req.url,
        method: req.method,
        status: res.statusCode,
        resourceType: req.resourceType || 'xhr',
        requestHeaders: req.headers || {},
        responseHeaders: res.headers || {},
        requestBody: req.body,
        responseBody: null, // Don't capture full body by default (perf)
        duration: Date.now() - startTime,
        timestamp: startTime,
        size: 0,
      };

      // Store in module-level buffer (accessible synchronously)
      networkBuffer.push(captured);
      // Cap at 1000
      if (networkBuffer.length > 1000) {
        networkBuffer.splice(0, networkBuffer.length - 500);
      }
    });

    req.continue();
  }).as('__mcpIntercept');

  // Also init browser-side buffer for EVAL-based access
  cy.window({ log: false }).then((win) => {
    win.__mcpNetworkBuffer = networkBuffer;
  });
});

// ═══════════════════════════════════════════
// 2. Console Collector — hook console methods
// ═══════════════════════════════════════════
Cypress.on('window:before:load', (win) => {
  win.__mcpConsoleBuffer = [];

  const levels = ['log', 'warn', 'error', 'info', 'debug'] as const;
  for (const level of levels) {
    const original = win.console[level];
    win.console[level] = function (...args: any[]) {
      win.__mcpConsoleBuffer.push({
        level,
        text: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
        timestamp: Date.now(),
      });
      // Cap at 500
      if (win.__mcpConsoleBuffer.length > 500) {
        win.__mcpConsoleBuffer = win.__mcpConsoleBuffer.slice(-250);
      }
      return original.apply(win.console, args);
    };
  }
});

// ═══════════════════════════════════════════
// 3. DOM Snapshot Command
// ═══════════════════════════════════════════
Cypress.Commands.add('mcpSnapshot', (options: any = {}) => {
  return cy.document({ log: false }).then((doc) => {
    // Snapshot logic runs via EVAL from bridge
    // This command is a convenience wrapper
    return { ready: true };
  });
});

// ═══════════════════════════════════════════
// 4. Agent Loop — polls bridge for commands
// ═══════════════════════════════════════════
Cypress.Commands.add('mcpAgentLoop', () => {
  function pollAndExecute(): void {
    cy.task('mcpBridgePoll', null, { log: false }).then((command: any) => {
      if (!command) {
        // No pending command — wait and poll again
        cy.wait(100, { log: false }).then(() => pollAndExecute());
        return;
      }

      const { id, type, payload } = command;
      log(`Exec: ${type} ${JSON.stringify(payload).substring(0, 80)}`);

      executeCommand(type, payload).then((result: any) => {
        cy.task('mcpBridgeResponse', { id, data: result }, { log: false }).then(() => {
          pollAndExecute();
        });
      });
    });
  }

  pollAndExecute();
});

function executeCommand(type: string, payload: any): Cypress.Chainable<any> {
  switch (type) {
    case 'COMMAND':
      return executeSingleCommand(payload);

    case 'CHAIN':
      return executeChainedCommands(payload.commands);

    case 'EVAL':
      return cy.window({ log: false }).then((win: any) => {
        try {
          const fn = new Function(payload.script);
          return fn.call(win);
        } catch (err: any) {
          return { __error: err.message };
        }
      });

    case 'INTERCEPT':
      return setupIntercept(payload);

    case 'INTERCEPT_WAIT':
      return setupInterceptAndWait(payload);

    case 'WAIT_ALIAS':
      return cy.wait(`@${payload.alias}`, { timeout: payload.timeout || 10000 }).then((interception: any) => {
        return {
          request: { method: interception.request?.method, url: interception.request?.url, body: interception.request?.body },
          response: { statusCode: interception.response?.statusCode, body: interception.response?.body },
          duration: interception.duration,
        };
      });

    case 'READ_FILE_BASE64':
      return cy.readFile(payload.path, 'base64', { log: false }).then((data: string) => data);

    default:
      return cy.wrap({ __error: `Unknown command type: ${type}` });
  }
}

function executeSingleCommand(payload: any): Cypress.Chainable<any> {
  const { command, args = [], target } = payload;

  if (target) {
    const chain = cy.get(target, { log: false });
    return (chain as any)[command](...args);
  }
  return (cy as any)[command](...args);
}

function executeChainedCommands(commands: any[]): Cypress.Chainable<any> {
  let chain: any = cy;

  for (const cmd of commands) {
    const { command, args = [] } = cmd;
    chain = chain[command](...args);
  }

  return chain;
}

function setupIntercept(payload: any): Cypress.Chainable<any> {
  const { method, url, response, alias } = payload;
  const routeMatcher: any = { method, url };

  if (response) {
    cy.intercept(routeMatcher, {
      statusCode: response.statusCode || 200,
      body: response.body,
      headers: response.headers || {},
      delay: response.delay || 0,
    }).as(alias);
  } else {
    // Passthrough (remove mock)
    cy.intercept(routeMatcher, (req: any) => req.continue()).as(alias);
  }

  return cy.wrap({ alias });
}

function setupInterceptAndWait(payload: any): Cypress.Chainable<any> {
  const { url, method, alias } = payload;
  cy.intercept({ method: method || '*', url }, (req: any) => req.continue()).as(alias);
  return cy.wrap({ alias });
}

// ═══════════════════════════════════════════
// 5. Error handling — don't fail on uncaught exceptions in agent mode
// ═══════════════════════════════════════════
Cypress.on('uncaught:exception', () => false);

export {};
