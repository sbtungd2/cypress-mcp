import { ToolHandler, ToolFactory } from '../types';
import { resolveTarget, escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// 37. browser_wait [P0]
// ═══════════════════════════════════════════
export const browserWait: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_wait',
  description: 'Wait for a condition: element visible/hidden, text to appear, fixed time, or network idle.',
  schema: {
    type: 'object',
    properties: {
      time: { type: 'number', description: 'Wait fixed milliseconds' },
      selector: { type: 'string', description: 'Wait for element to appear' },
      ref: { type: 'string', description: 'Wait for ref element' },
      state: { type: 'string', enum: ['visible', 'hidden', 'attached', 'detached'], description: "Default: 'visible'" },
      text: { type: 'string', description: 'Wait for text content to appear on page' },
      networkIdle: { type: 'boolean', description: 'Wait for no pending requests' },
      timeout: { type: 'number', description: 'Max wait time. Default: 10000' },
    },
  },
  async execute(params) {
    const { time, selector, ref, state: waitState = 'visible', text, networkIdle, timeout = 10000 } = params;
    const start = Date.now();

    try {
      if (time) {
        await bridge.execute({ type: 'COMMAND', payload: { command: 'wait', args: [time] }, timeout: time + 5000 });
        return { success: true as const, waited: time };
      }

      if (selector || ref) {
        const target = resolveTarget({ ref, selector })!;
        if (waitState === 'hidden' || waitState === 'detached') {
          await bridge.execute({
            type: 'CHAIN',
            payload: { commands: [{ command: 'get', args: [target, { timeout }] }, { command: 'should', args: ['not.be.visible'] }] },
            timeout: timeout + 5000,
          });
        } else {
          await bridge.execute({
            type: 'CHAIN',
            payload: { commands: [{ command: 'get', args: [target, { timeout }] }, { command: 'should', args: ['be.visible'] }] },
            timeout: timeout + 5000,
          });
        }
        return { success: true as const, duration: Date.now() - start };
      }

      if (text) {
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [{ command: 'contains', args: [text, { timeout }] }] },
          timeout: timeout + 5000,
        });
        return { success: true as const, duration: Date.now() - start };
      }

      if (networkIdle) {
        await bridge.execute({
          type: 'EVAL',
          payload: { script: `
            return new Cypress.Promise(function(resolve) {
              var timer;
              function check() {
                clearTimeout(timer);
                timer = setTimeout(function() { resolve('idle'); }, 500);
              }
              var origFetch = window.fetch;
              var pending = 0;
              window.fetch = function() {
                pending++;
                return origFetch.apply(this, arguments).finally(function() { pending--; check(); });
              };
              check();
            });
          ` },
          timeout: timeout + 5000,
        });
        return { success: true as const, duration: Date.now() - start };
      }

      return { error: { code: 'WAIT_TIMEOUT', message: 'No wait condition specified' } };
    } catch (err: any) {
      return { error: { code: 'WAIT_TIMEOUT', message: `Wait failed after ${Date.now() - start}ms: ${err.message}` } };
    }
  },
});

// ═══════════════════════════════════════════
// 38. browser_assert [P1]
// ═══════════════════════════════════════════
export const browserAssert: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_assert',
  description: 'Assert a condition on the page or an element. Returns pass/fail with details.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      assertion: { type: 'string', description: "Chai assertion: 'be.visible', 'have.text', 'contain', 'have.class', 'exist', 'have.value', 'have.attr', 'have.length'" },
      expected: { type: 'string', description: 'Expected value' },
      timeout: { type: 'number', description: 'Default: 5000' },
    },
    required: ['assertion'],
  },
  async execute(params) {
    const { ref, selector, assertion, expected, timeout = 5000 } = params;
    const target = resolveTarget({ ref, selector });

    try {
      if (target) {
        const args = expected !== undefined ? [assertion, expected] : [assertion];
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [
            { command: 'get', args: [target, { timeout }] },
            { command: 'should', args },
          ] },
          timeout: timeout + 5000,
        });
      } else {
        // Page-level assertions
        if (assertion === 'have.title') {
          await bridge.execute({
            type: 'CHAIN',
            payload: { commands: [{ command: 'title', args: [] }, { command: 'should', args: ['include', expected || ''] }] },
            timeout: timeout + 5000,
          });
        } else if (assertion === 'have.url' || assertion === 'include.url') {
          await bridge.execute({
            type: 'CHAIN',
            payload: { commands: [{ command: 'url', args: [] }, { command: 'should', args: ['include', expected || ''] }] },
            timeout: timeout + 5000,
          });
        }
      }

      return { success: true as const, passed: true, assertion, expected };
    } catch (err: any) {
      return {
        success: true as const,
        passed: false,
        assertion,
        expected,
        actual: err.message,
      };
    }
  },
});

// ═══════════════════════════════════════════
// 39. browser_run_cypress [P1]
// ═══════════════════════════════════════════
export const browserRunCypress: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_run_cypress',
  description: 'Execute raw Cypress commands as a code string. SECURITY WARNING: This runs arbitrary Cypress code — only use with trusted input. For advanced use when pre-built tools are insufficient.',
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: "Cypress commands as JS string. e.g. \"cy.get('.btn').click().then(() => { ... })\"" },
      timeout: { type: 'number', description: 'Default: 30000' },
    },
    required: ['code'],
  },
  async execute(params) {
    const { code, timeout = 30000 } = params;
    try {
      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: code },
        timeout,
      });
      return { success: true as const, result };
    } catch (err: any) {
      return { error: { code: 'RUN_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 40. browser_generate_test [P1]
// ═══════════════════════════════════════════
export const browserGenerateTest: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_generate_test',
  description: 'Generate a Cypress test file from the recorded command history in this session. Outputs a complete .cy.ts file content.',
  schema: {
    type: 'object',
    properties: {
      testName: { type: 'string', description: 'Test name/description' },
      since: { type: 'number', description: 'Only include commands after this timestamp' },
      includeAssertions: { type: 'boolean', description: 'Add auto-generated assertions. Default: true' },
    },
  },
  async execute(params) {
    const { testName = 'Generated test', since, includeAssertions = true } = params;
    let history = [...state.commandHistory];
    if (since) history = history.filter(h => h.timestamp >= since);

    if (history.length === 0) {
      return { error: { code: 'GENERATE_FAILED', message: 'No commands in history to generate test from' } };
    }

    const lines: string[] = [
      `describe('${testName}', () => {`,
      `  it('${testName}', () => {`,
    ];

    for (const entry of history) {
      const cmd = mapToolToCommand(entry.tool, entry.params);
      if (cmd) lines.push(`    ${cmd}`);
    }

    lines.push('  });');
    lines.push('});');
    lines.push('');

    const code = lines.join('\n');
    return { success: true as const, code, commandCount: history.length };
  },
});

function getSelector(params: Record<string, any>): string | null {
  if (params.selector) return `'${params.selector}'`;
  if (params.ref) return `'[data-mcp-ref="${params.ref}"]'`;
  return null;
}

function mapToolToCommand(tool: string, params: Record<string, any>): string | null {
  const sel = getSelector(params);
  switch (tool) {
    case 'browser_navigate':
      return `cy.visit('${params.url}');`;
    case 'browser_click':
      return sel ? `cy.get(${sel}).click();` : null;
    case 'browser_type':
      return sel ? `cy.get(${sel}).type('${params.text}');` : null;
    case 'browser_fill':
      return sel ? `cy.get(${sel}).clear().type('${params.value}');` : null;
    case 'browser_select':
      return sel ? `cy.get(${sel}).select('${params.value}');` : null;
    case 'browser_check':
      return sel ? `cy.get(${sel}).${params.checked === false ? 'uncheck' : 'check'}();` : null;
    case 'browser_scroll':
      if (sel) return `cy.get(${sel}).scrollIntoView();`;
      if (params.direction) return `cy.scrollTo('${params.direction === 'down' ? 'bottom' : 'top'}');`;
      return null;
    case 'browser_press_key':
      return `cy.get('body').type('{${params.key.toLowerCase()}}');`;
    case 'browser_wait':
      if (params.time) return `cy.wait(${params.time});`;
      if (sel) return `cy.get(${sel}).should('be.visible');`;
      return null;
    case 'browser_assert':
      if (sel && params.expected) return `cy.get(${sel}).should('${params.assertion}', '${params.expected}');`;
      if (sel) return `cy.get(${sel}).should('${params.assertion}');`;
      return null;
    case 'browser_go_back':
      return `cy.go('back');`;
    case 'browser_reload':
      return `cy.reload();`;
    case 'browser_viewport':
      if (params.preset) return `cy.viewport('${params.preset}');`;
      if (params.width && params.height) return `cy.viewport(${params.width}, ${params.height});`;
      return null;
    default:
      return `// ${tool}: ${JSON.stringify(params)}`;
  }
}
