/**
 * Unit tests for cypress-mcp core modules.
 * Run: npx ts-node --esm tests/unit-tests.ts
 * (Or just: node -e "require('./tests/unit-tests.ts')" with ts-node registered)
 */

// ─── Simple test runner ───
let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((err: any) => {
        failed++;
        failures.push(`${name}: ${err.message}`);
        console.log(`  ✗ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}
function assertEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertIncludes(str: string, substr: string, msg?: string) {
  if (!str.includes(substr)) throw new Error(msg || `Expected "${str}" to include "${substr}"`);
}

// ─── Import modules ───
import { StateManager } from '../src/state/state-manager';
import { BridgeServer } from '../src/bridge/ws-server';
import { resolveTarget, escapeSelector } from '../src/tools/utils';

// ═══════════════════════════════════════════
// Test: utils
// ═══════════════════════════════════════════
console.log('\n── utils ──');

test('resolveTarget with ref', () => {
  const result = resolveTarget({ ref: 'ref:14' });
  assertEqual(result, '[data-mcp-ref="ref:14"]');
});

test('resolveTarget with selector', () => {
  const result = resolveTarget({ selector: '#my-button' });
  assertEqual(result, '#my-button');
});

test('resolveTarget with both prefers ref', () => {
  const result = resolveTarget({ ref: 'ref:1', selector: '.fallback' });
  assertEqual(result, '[data-mcp-ref="ref:1"]');
});

test('resolveTarget with neither returns null', () => {
  assertEqual(resolveTarget({}), null);
});

test('escapeSelector handles single quotes', () => {
  const result = escapeSelector("it's a test");
  assertEqual(result, "it\\'s a test");
});

test('escapeSelector handles backslashes', () => {
  const result = escapeSelector('path\\to\\thing');
  assertEqual(result, 'path\\\\to\\\\thing');
});

test('escapeSelector handles newlines', () => {
  const result = escapeSelector('line1\nline2');
  assertEqual(result, 'line1\\nline2');
});

// ═══════════════════════════════════════════
// Test: StateManager
// ═══════════════════════════════════════════
console.log('\n── StateManager ──');

test('initial state is empty', () => {
  const s = new StateManager();
  assertEqual(s.currentUrl, '');
  assertEqual(s.currentTitle, '');
  assertEqual(s.networkRequests.length, 0);
  assertEqual(s.consoleMessages.length, 0);
  assertEqual(s.commandHistory.length, 0);
});

test('updateCurrentPage sets url and title', () => {
  const s = new StateManager();
  s.updateCurrentPage({ url: 'https://example.com', title: 'Example' });
  assertEqual(s.currentUrl, 'https://example.com');
  assertEqual(s.currentTitle, 'Example');
});

test('updateViewport sets dimensions', () => {
  const s = new StateManager();
  s.updateViewport(1920, 1080);
  assertEqual(s.viewportWidth, 1920);
  assertEqual(s.viewportHeight, 1080);
});

test('addNetworkRequest appends and caps', () => {
  const s = new StateManager();
  for (let i = 0; i < 1100; i++) {
    s.addNetworkRequest({
      id: i, url: `http://x/${i}`, method: 'GET', status: 200,
      resourceType: 'xhr', requestHeaders: {}, responseHeaders: {},
      requestBody: null, responseBody: null, duration: 1, timestamp: i, size: 0,
    });
  }
  // Should be capped at 500 after exceeding 1000
  assert(s.networkRequests.length <= 600, `Expected <= 600, got ${s.networkRequests.length}`);
});

test('addConsoleMessage appends and caps at 500', () => {
  const s = new StateManager();
  for (let i = 0; i < 600; i++) {
    s.addConsoleMessage({ level: 'log', text: `msg ${i}`, timestamp: i });
  }
  // After 501 items: trims to 250. Then 99 more pushes = 349. No further trim (< 500).
  assert(s.consoleMessages.length <= 500, `Expected <= 500, got ${s.consoleMessages.length}`);
  assert(s.consoleMessages.length > 0, 'Expected some messages');
});

test('clearConsoleMessages clears', () => {
  const s = new StateManager();
  s.addConsoleMessage({ level: 'log', text: 'test', timestamp: 0 });
  assertEqual(s.consoleMessages.length, 1);
  s.clearConsoleMessages();
  assertEqual(s.consoleMessages.length, 0);
});

test('addMock and removeMock', () => {
  const s = new StateManager();
  s.addMock('mock_1', { url: '/api/test', method: 'GET' });
  assertEqual(s.activeMocks.size, 1);
  s.removeMock('mock_1');
  assertEqual(s.activeMocks.size, 0);
});

test('addToHistory appends and caps', () => {
  const s = new StateManager();
  for (let i = 0; i < 250; i++) {
    s.addToHistory({ tool: 'test', params: {}, result: { success: true as const }, timestamp: i });
  }
  assert(s.commandHistory.length <= 150, `Expected <= 150, got ${s.commandHistory.length}`);
});

test('reset clears everything', () => {
  const s = new StateManager();
  s.updateCurrentPage({ url: 'https://x', title: 'X' });
  s.addNetworkRequest({ id: 1, url: 'http://x', method: 'GET', status: 200, resourceType: 'xhr', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 1, timestamp: 0, size: 0 });
  s.addConsoleMessage({ level: 'log', text: 'test', timestamp: 0 });
  s.addMock('m1', { url: '/api', method: 'GET' });
  s.reset();
  assertEqual(s.currentUrl, '');
  assertEqual(s.networkRequests.length, 0);
  assertEqual(s.consoleMessages.length, 0);
  assertEqual(s.activeMocks.size, 0);
});

// ═══════════════════════════════════════════
// Test: BridgeServer
// ═══════════════════════════════════════════
console.log('\n── BridgeServer ──');

test('getPendingCommand returns null when empty', () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);
  assertEqual(b.getPendingCommand(), null);
});

test('execute queues command and getPendingCommand returns it', async () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);

  // Don't await — we need to intercept the promise
  const promise = b.execute({ type: 'EVAL', payload: { script: 'return 42' }, timeout: 5000 });

  // Command should be queued
  const cmd = b.getPendingCommand();
  assert(cmd !== null, 'Expected command in queue');
  assertEqual(cmd!.type, 'EVAL');
  assertEqual(cmd!.payload.script, 'return 42');

  // Resolve via response
  b.handleBrowserResponse({ id: cmd!.id, data: 42 });

  const result = await promise;
  assertEqual(result, 42);
});

test('execute rejects on error response', async () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);

  const promise = b.execute({ type: 'COMMAND', payload: { command: 'visit' }, timeout: 5000 });
  const cmd = b.getPendingCommand();
  b.handleBrowserResponse({ id: cmd!.id, error: 'Page not found' });

  try {
    await promise;
    throw new Error('Should have thrown');
  } catch (err: any) {
    assertIncludes(err.message, 'Page not found');
  }
});

test('execute rejects on timeout', async () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);

  const promise = b.execute({ type: 'COMMAND', payload: {}, timeout: 50 });

  try {
    await promise;
    throw new Error('Should have thrown');
  } catch (err: any) {
    assertIncludes(err.message, 'timed out');
  }
});

test('queueLength and pendingCount', () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);

  assertEqual(b.queueLength, 0);
  assertEqual(b.pendingCount, 0);

  // Queue a command (fire-and-forget, will timeout later)
  b.execute({ type: 'EVAL', payload: {}, timeout: 60000 }).catch(() => {});

  assertEqual(b.queueLength, 1);
  assertEqual(b.pendingCount, 1);

  b.getPendingCommand();
  assertEqual(b.queueLength, 0);
  assertEqual(b.pendingCount, 1); // Still pending response

  b.stop(); // Clean up
});

test('stop rejects all pending commands', async () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);

  const p1 = b.execute({ type: 'EVAL', payload: {}, timeout: 60000 }).catch((e: any) => e.message);
  const p2 = b.execute({ type: 'EVAL', payload: {}, timeout: 60000 }).catch((e: any) => e.message);

  b.stop();

  const [r1, r2] = await Promise.all([p1, p2]);
  assertIncludes(r1, 'shutting down');
  assertIncludes(r2, 'shutting down');
});

test('handleBrowserResponse ignores unknown id', () => {
  const s = new StateManager();
  const b = new BridgeServer(3456, s);
  // Should not throw
  b.handleBrowserResponse({ id: 'nonexistent', data: 'ignored' });
});

// ═══════════════════════════════════════════
// Test: Tool factories produce valid handlers
// ═══════════════════════════════════════════
console.log('\n── Tool Factories ──');

import { browserNavigate, browserGoBack, browserGoForward, browserReload } from '../src/tools/navigation/index';
import { browserClick, browserType } from '../src/tools/interaction/index';
import { browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute } from '../src/tools/snapshot/index';
import { browserNetworkRequests, browserMockRoute } from '../src/tools/network/index';
import { browserScreenshot, browserViewport } from '../src/tools/visual/index';
import { browserConsoleMessages, browserEvaluate } from '../src/tools/console/index';
import { browserListTabs } from '../src/tools/tabs/index';
import { browserGetCookies, browserLocalStorage } from '../src/tools/storage/index';
import { browserHandleDialog } from '../src/tools/dialog/index';
import { browserWait, browserAssert, browserRunCypress, browserGenerateTest } from '../src/tools/utility/index';

const mockBridge = {
  execute: async () => ({}),
} as any;
const mockState = new StateManager();

const allFactories = [
  browserNavigate, browserGoBack, browserGoForward, browserReload,
  browserClick, browserType,
  browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute,
  browserNetworkRequests, browserMockRoute,
  browserScreenshot, browserViewport,
  browserConsoleMessages, browserEvaluate,
  browserListTabs,
  browserGetCookies, browserLocalStorage,
  browserHandleDialog,
  browserWait, browserAssert, browserRunCypress, browserGenerateTest,
];

test('all tool factories produce valid ToolHandler', () => {
  for (const factory of allFactories) {
    const handler = factory(mockBridge, mockState);
    assert(typeof handler.name === 'string' && handler.name.length > 0, `Missing name`);
    assert(typeof handler.description === 'string' && handler.description.length > 0, `Missing description for ${handler.name}`);
    assert(handler.schema.type === 'object', `Invalid schema type for ${handler.name}`);
    assert(typeof handler.execute === 'function', `Missing execute for ${handler.name}`);
  }
});

test('tool names follow browser_ convention', () => {
  for (const factory of allFactories) {
    const handler = factory(mockBridge, mockState);
    assert(handler.name.startsWith('browser_'), `Tool ${handler.name} doesn't start with browser_`);
  }
});

test('tool schemas have properties', () => {
  for (const factory of allFactories) {
    const handler = factory(mockBridge, mockState);
    assert(typeof handler.schema.properties === 'object', `Missing properties in schema for ${handler.name}`);
  }
});

// ═══════════════════════════════════════════
// Test: Tool execution with mock bridge
// ═══════════════════════════════════════════
console.log('\n── Tool Execution ──');

test('browser_navigate returns error for missing url', async () => {
  const handler = browserNavigate(mockBridge, mockState);
  const result = await handler.execute({});
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'INVALID_URL');
});

test('browser_click returns error for missing selector/ref', async () => {
  const handler = browserClick(mockBridge, mockState);
  const result = await handler.execute({});
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'INVALID_SELECTOR');
});

test('browser_type returns error for missing selector/ref', async () => {
  const handler = browserType(mockBridge, mockState);
  const result = await handler.execute({ text: 'hello' });
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'INVALID_SELECTOR');
});

test('browser_get_text returns error when no target specified', async () => {
  const handler = browserGetText(mockBridge, mockState);
  const result = await handler.execute({});
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'INVALID_SELECTOR');
});

test('browser_get_attribute returns error when no attribute and not allAttributes', async () => {
  const handler = browserGetAttribute(mockBridge, mockState);
  const result = await handler.execute({ selector: '#x' });
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'GET_ATTR_FAILED');
});

test('browser_wait returns error when no condition specified', async () => {
  const handler = browserWait(mockBridge, mockState);
  const result = await handler.execute({});
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'WAIT_TIMEOUT');
});

test('browser_generate_test returns error when no history', async () => {
  const emptyState = new StateManager();
  const handler = browserGenerateTest(mockBridge, emptyState);
  const result = await handler.execute({});
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'GENERATE_FAILED');
});

test('browser_generate_test produces valid code from history', async () => {
  const stateWithHistory = new StateManager();
  stateWithHistory.addToHistory({ tool: 'browser_navigate', params: { url: 'https://example.com' }, result: { success: true as const }, timestamp: 1 });
  stateWithHistory.addToHistory({ tool: 'browser_click', params: { selector: '#btn' }, result: { success: true as const }, timestamp: 2 });
  stateWithHistory.addToHistory({ tool: 'browser_type', params: { selector: '#input', text: 'hello' }, result: { success: true as const }, timestamp: 3 });

  const handler = browserGenerateTest(mockBridge, stateWithHistory);
  const result = await handler.execute({ testName: 'My Test' });
  assert('success' in result && result.success, 'Expected success');
  assertIncludes((result as any).code, "cy.visit('https://example.com')");
  assertIncludes((result as any).code, "cy.get('#btn').click()");
  assertIncludes((result as any).code, "cy.get('#input').type('hello')");
  assertEqual((result as any).commandCount, 3);
});

test('browser_network_requests works with empty state', async () => {
  const handler = browserNetworkRequests(mockBridge, mockState);
  const result = await handler.execute({});
  assert('success' in result && result.success, 'Expected success');
  assertEqual((result as any).total, 0);
});

test('browser_local_storage returns error on missing key for get', async () => {
  const handler = browserLocalStorage(mockBridge, mockState);
  const result = await handler.execute({ action: 'get' });
  assert('error' in result, 'Expected error');
  assertEqual((result as any).error.code, 'INVALID_KEY');
});

// ═══════════════════════════════════════════
// Test: Tool Registry
// ═══════════════════════════════════════════
console.log('\n── Tool Registry ──');

import { McpServer } from '../src/server/mcp-server';
import { registerAllTools } from '../src/server/tool-registry';

test('registerAllTools registers 38 tools', () => {
  // Create a minimal mock that counts registrations
  let registeredCount = 0;
  const mockServer = {
    registerTool: () => { registeredCount++; },
  } as any;

  // Suppress the console.error log from registerAllTools
  const origErr = console.error;
  console.error = () => {};
  registerAllTools(mockServer, mockBridge as any, mockState);
  console.error = origErr;

  assertEqual(registeredCount, 52, `Expected 52 tools, got ${registeredCount}`);
});

// ═══════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════
setTimeout(() => {
  console.log(`\n${'═'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  console.log(`${'═'.repeat(40)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 500); // Wait for async tests
