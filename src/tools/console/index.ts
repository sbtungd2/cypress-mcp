import { ToolHandler, ToolFactory } from '../types';

// ═══════════════════════════════════════════
// 25. browser_console_messages [P1]
// ═══════════════════════════════════════════
export const browserConsoleMessages: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_console_messages',
  description: 'Get browser console messages (log, warn, error, info) captured during the session.',
  schema: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['all', 'log', 'warn', 'error', 'info'], description: "Default: 'all'" },
      limit: { type: 'number', description: 'Max messages. Default: 50' },
      clear: { type: 'boolean', description: 'Clear buffer after reading. Default: false' },
    },
  },
  async execute(params) {
    const { level = 'all', limit = 50, clear = false } = params;

    // Pull latest from browser
    try {
      const msgs = await bridge.execute({
        type: 'EVAL',
        payload: { script: 'return window.__mcpConsoleBuffer || []' },
      });
      if (Array.isArray(msgs) && msgs.length > 0) {
        state.updateConsoleMessages(msgs);
      }
    } catch { /* use cached */ }

    let messages = [...state.consoleMessages];
    if (level !== 'all') messages = messages.filter(m => m.level === level);
    const result = messages.slice(-limit);
    if (clear) state.clearConsoleMessages();

    return { success: true as const, total: messages.length, messages: result };
  },
});

// ═══════════════════════════════════════════
// 26. browser_evaluate [P1]
// ═══════════════════════════════════════════
export const browserEvaluate: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_evaluate',
  description: "Execute JavaScript in the browser context. SECURITY WARNING: This tool runs arbitrary code — only use with trusted input. Result must be JSON-serializable.",
  schema: {
    type: 'object',
    properties: {
      script: { type: 'string', description: "JavaScript code. Use 'return' for values." },
      timeout: { type: 'number', description: 'Timeout in ms. Default: 10000' },
    },
    required: ['script'],
  },
  async execute(params) {
    const { script, timeout = 10000 } = params;
    // SECURITY: Limit script size to prevent DoS
    if (!script || typeof script !== 'string') {
      return { error: { code: 'JS_SYNTAX_ERROR', message: 'Script is required' } };
    }
    if (script.length > 100000) {
      return { error: { code: 'JS_SYNTAX_ERROR', message: 'Script too large (max 100KB)' } };
    }
    try {
      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: `return (function(){ ${script} })()` },
        timeout,
      });
      return { success: true as const, result };
    } catch (err: any) {
      if (err.message?.includes('SyntaxError')) return { error: { code: 'JS_SYNTAX_ERROR', message: err.message } };
      if (err.message?.includes('timeout')) return { error: { code: 'JS_TIMEOUT', message: err.message } };
      return { error: { code: 'JS_RUNTIME_ERROR', message: err.message } };
    }
  },
});
