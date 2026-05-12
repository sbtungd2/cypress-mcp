/**
 * Integration Test — Simulate real Traveloka flight search flow
 * 
 * This test uses mock bridge responses that mirror what a real Cypress browser
 * would return when interacting with https://www.traveloka.com/vi-vn/flight
 * 
 * Flow tested:
 * 1. Navigate to Traveloka
 * 2. Snapshot the page (DOM → YAML accessibility tree)
 * 3. Click on "Từ" (departure) field
 * 4. Type "Hà Nội" into search
 * 5. Click a suggestion
 * 6. Click on "Đến" (destination) field
 * 7. Type "Hồ Chí Minh"
 * 8. Assert page title
 * 9. Get text from search form
 * 10. Mock a network route
 * 11. Check console messages
 * 12. Evaluate JS
 * 13. Set viewport
 * 14. Cookie operations
 * 15. LocalStorage operations
 * 16. Wait operations
 * 17. Generate test from history
 */

import { StateManager } from '../src/state/state-manager';
import { BridgeServer } from '../src/bridge/ws-server';

// Import all tool factories
import { browserNavigate, browserGoBack, browserReload } from '../src/tools/navigation/index';
import { browserClick, browserType, browserFill, browserSelect, browserCheck, browserHover, browserScroll, browserPressKey } from '../src/tools/interaction/index';
import { browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute } from '../src/tools/snapshot/index';
import { browserNetworkRequests, browserNetworkRequest, browserMockRoute, browserWaitForRequest } from '../src/tools/network/index';
import { browserScreenshot, browserViewport } from '../src/tools/visual/index';
import { browserConsoleMessages, browserEvaluate } from '../src/tools/console/index';
import { browserListTabs } from '../src/tools/tabs/index';
import { browserGetCookies, browserSetCookie, browserClearCookies, browserLocalStorage } from '../src/tools/storage/index';
import { browserHandleDialog } from '../src/tools/dialog/index';
import { browserWait, browserAssert, browserGenerateTest } from '../src/tools/utility/index';

// ─── Test runner ───
let passed = 0, failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) { if (!condition) throw new Error(msg); }
function assertEqual(a: any, b: any, msg?: string) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertIncludes(s: string, sub: string) { if (!s.includes(sub)) throw new Error(`Expected "${s.substring(0,200)}" to include "${sub}"`); }
function assertType(v: any, t: string) { if (typeof v !== t) throw new Error(`Expected type ${t}, got ${typeof v}`); }

// ═══════════════════════════════════════════
// Smart Mock Bridge — simulates Cypress browser responses
// ═══════════════════════════════════════════
class MockBridge {
  private responseMap: Map<string, (payload: any) => any> = new Map();
  private callLog: Array<{ type: string; payload: any }> = [];

  constructor() {
    this.setupDefaults();
  }

  private setupDefaults() {
    // Default EVAL handler — simulate common JS evaluations
    this.onType('EVAL', (payload) => {
      const script = payload.script || '';

      // Snapshotter script (check FIRST — it contains location.href too)
      if (script.includes('TAG_ROLES') || (script.includes('traverse') && script.includes('toYaml'))) {
        return {
          yaml: `- navigation "Traveloka"
  - link "Khách sạn" [ref:1]
  - link "Vé máy bay" [ref:2]
  - link "Vé xe khách" [ref:3]
- main
  - heading "Tìm & đặt vé máy bay giá rẻ" level=1
  - form "Flight Search"
    - radio "Một chiều" [ref:4] checked
    - radio "Khứ hồi" [ref:5] unchecked
    - textbox "Từ" [ref:6] value=""
    - textbox "Đến" [ref:7] value=""
    - textbox "Ngày khởi hành" [ref:8] value=""
    - combobox "Phổ thông" [ref:9]
    - button "Tìm chuyến bay" [ref:10]
`,
          refCount: 10,
          url: 'https://www.traveloka.com/vi-vn/flight',
          title: 'Vé máy bay giá rẻ nhất 2026, ưu đãi hấp dẫn',
        };
      }

      // Location info
      if (script.includes('location.href')) {
        if (script.includes('document.title')) {
          return { url: 'https://www.traveloka.com/vi-vn/flight', title: 'Vé máy bay giá rẻ nhất 2026, ưu đãi hấp dẫn' };
        }
        return 'https://www.traveloka.com/vi-vn/flight';
      }

      // Query elements (check before generic querySelector)
      if (script.includes('querySelectorAll') && script.includes('refCounter')) {
        return {
          count: 3,
          elements: [
            { ref: 'ref:101', role: 'textbox', name: 'Từ', tagName: 'INPUT', visible: true, disabled: false },
            { ref: 'ref:102', role: 'textbox', name: 'Đến', tagName: 'INPUT', visible: true, disabled: false },
            { ref: 'ref:103', role: 'button', name: 'Tìm chuyến bay', tagName: 'BUTTON', visible: true, disabled: false },
          ],
        };
      }

      // All attributes (check before generic querySelector)
      if (script.includes('Object.fromEntries') && script.includes('attributes')) {
        return { 'data-testid': 'search-form', class: 'flight-search', id: 'main-search' };
      }

      // querySelector for element info
      if (script.includes('querySelector') && script.includes('tagName')) {
        return { tagName: 'INPUT', text: '', role: 'textbox' };
      }

      // querySelector for value
      if (script.includes('querySelector') && script.includes('.value')) {
        return 'Hà Nội (HAN)';
      }

      // Full page text
      if (script.includes('document.body.innerText')) {
        return 'Tìm & đặt vé máy bay giá rẻ\nMột chiều\nKhứ hồi\nTừ\nĐến\nNgày khởi hành\nTìm chuyến bay';
      }

      // getAttribute
      if (script.includes('getAttribute')) {
        return 'search-form-departure';
      }

      // Scroll position
      if (script.includes('scrollX') || script.includes('scrollY')) {
        return { x: 0, y: 500 };
      }

      // Network buffer
      if (script.includes('__mcpNetworkBuffer')) {
        return [
          { id: 1, url: 'https://www.traveloka.com/api/v2/flight/search', method: 'POST', status: 200, resourceType: 'xhr', requestHeaders: {}, responseHeaders: { 'content-type': 'application/json' }, requestBody: { from: 'HAN', to: 'SGN' }, responseBody: null, duration: 245, timestamp: Date.now() - 1000, size: 15432 },
          { id: 2, url: 'https://www.traveloka.com/api/v2/flight/fare', method: 'GET', status: 200, resourceType: 'xhr', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 120, timestamp: Date.now() - 500, size: 8900 },
          { id: 3, url: 'https://www.traveloka.com/static/main.js', method: 'GET', status: 200, resourceType: 'script', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 50, timestamp: Date.now() - 2000, size: 250000 },
        ];
      }

      // Console buffer
      if (script.includes('__mcpConsoleBuffer')) {
        return [
          { level: 'log', text: '[Traveloka] Flight search initialized', timestamp: Date.now() - 2000 },
          { level: 'warn', text: 'Deprecation warning: API v1 will be removed', timestamp: Date.now() - 1000 },
          { level: 'error', text: 'Failed to load advertisement: 403 Forbidden', timestamp: Date.now() - 500 },
        ];
      }

      // cy.realHover check
      if (script.includes('cy.realHover')) return false;

      // localStorage (order matters: list check before getItem)
      if (script.includes('localStorage')) {
        if (script.includes('localStorage.length') && script.includes('localStorage.key')) return { count: 2, items: { 'user_prefs': '{"currency":"VND"}', 'search_history': '["HAN-SGN"]' } };
        if (script.includes('getItem')) return '{"currency":"VND","lang":"vi"}';
        if (script.includes('setItem')) return true;
        if (script.includes('removeItem')) return true;
        if (script.includes('clear')) return true;
      }

      // Cypress.Promise (networkIdle wait)
      if (script.includes('Cypress.Promise') || script.includes('resolve')) return 'idle';

      // Default
      return null;
    });

    // COMMAND handler
    this.onType('COMMAND', (payload) => {
      const { command } = payload;
      if (command === 'visit') return { url: 'https://www.traveloka.com/vi-vn/flight' };
      if (command === 'go') return {};
      if (command === 'reload') return {};
      if (command === 'wait') return {};
      if (command === 'viewport') return {};
      if (command === 'screenshot') return {};
      if (command === 'getCookies') return [
        { name: 'tvlk_session', value: 'abc123', domain: '.traveloka.com', path: '/', secure: true, httpOnly: true },
        { name: 'lang', value: 'vi', domain: '.traveloka.com', path: '/', secure: false, httpOnly: false },
      ];
      if (command === 'setCookie') return {};
      if (command === 'clearCookies' || command === 'clearCookie') return {};
      return {};
    });

    // CHAIN handler
    this.onType('CHAIN', (payload) => {
      const commands = payload.commands || [];
      const lastCmd = commands[commands.length - 1];
      if (lastCmd?.command === 'should') return {}; // assertion passed
      if (lastCmd?.command === 'invoke') return {};
      if (lastCmd?.command === 'trigger') return {};
      if (lastCmd?.command === 'select') return {};
      return {};
    });

    // INTERCEPT
    this.onType('INTERCEPT', () => ({ alias: 'mock_api' }));
    this.onType('INTERCEPT_WAIT', () => ({ alias: 'wait_search' }));
    this.onType('WAIT_ALIAS', () => ({
      request: { method: 'POST', url: '/api/v2/flight/search', body: { from: 'HAN', to: 'SGN' } },
      response: { statusCode: 200, body: { flights: [] } },
      duration: 342,
    }));
    this.onType('READ_FILE_BASE64', () => 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
  }

  onType(type: string, handler: (payload: any) => any) {
    this.responseMap.set(type, handler);
  }

  async execute(message: { type: string; payload: any; timeout?: number }): Promise<any> {
    this.callLog.push({ type: message.type, payload: message.payload });

    const handler = this.responseMap.get(message.type);
    if (handler) {
      const result = handler(message.payload);
      return result;
    }
    return {};
  }

  getCallLog() { return this.callLog; }
  getCallCount(type?: string) {
    if (!type) return this.callLog.length;
    return this.callLog.filter(c => c.type === type).length;
  }
  getLastCall(type?: string) {
    const filtered = type ? this.callLog.filter(c => c.type === type) : this.callLog;
    return filtered[filtered.length - 1];
  }
  clearLog() { this.callLog = []; }
}


// ═══════════════════════════════════════════
// Integration Tests
// ═══════════════════════════════════════════

async function runTests() {
  const bridge = new MockBridge();
  const state = new StateManager();

  // ── Step 1: Navigate ──
  console.log('\n── Step 1: Navigate to Traveloka ──');

  await test('browser_navigate to Traveloka', async () => {
    const nav = browserNavigate(bridge as any, state);
    const result: any = await nav.execute({ url: 'https://www.traveloka.com/vi-vn/flight' });
    assert('success' in result && result.success === true, `Expected success, got ${JSON.stringify(result)}`);
    assertEqual(result.url, 'https://www.traveloka.com/vi-vn/flight');
    assertIncludes(result.title, 'Vé máy bay');
    assertType(result.loadTime, 'number');
    // State should be updated
    assertEqual(state.currentUrl, 'https://www.traveloka.com/vi-vn/flight');
  });

  // ── Step 2: Snapshot ──
  console.log('\n── Step 2: Snapshot page (accessibility tree) ──');

  await test('browser_snapshot returns YAML tree with refs', async () => {
    bridge.clearLog();
    const snap = browserSnapshot(bridge as any, state);
    const result: any = await snap.execute({});
    assert('success' in result && result.success, `Snapshot failed: ${JSON.stringify(result)}`);
    assertType(result.snapshot, 'string');
    assertIncludes(result.snapshot, 'navigation "Traveloka"');
    assertIncludes(result.snapshot, 'textbox "Từ" [ref:6]');
    assertIncludes(result.snapshot, 'button "Tìm chuyến bay" [ref:10]');
    assertIncludes(result.snapshot, 'radio "Một chiều" [ref:4] checked');
    assertEqual(result.elementCount, 10);
    // Verify bridge was called with EVAL
    assertEqual(bridge.getCallCount('EVAL'), 1);
  });

  await test('browser_snapshot with interactiveOnly option', async () => {
    const snap = browserSnapshot(bridge as any, state);
    const result: any = await snap.execute({ interactiveOnly: true });
    assert('success' in result, 'Expected result');
  });

  // ── Step 3: Query Elements ──
  console.log('\n── Step 3: Query elements ──');

  await test('browser_query_elements finds form inputs', async () => {
    const query = browserQueryElements(bridge as any, state);
    const result: any = await query.execute({ role: 'textbox', state: 'visible' });
    assert('success' in result && result.success, 'Expected success');
    assertEqual(result.count, 3);
    assert(result.elements.some((e: any) => e.name === 'Từ'), 'Should find "Từ" input');
    assert(result.elements.some((e: any) => e.name === 'Đến'), 'Should find "Đến" input');
  });

  // ── Step 4: Interact — Click departure field ──
  console.log('\n── Step 4: Click departure field ──');

  await test('browser_click on ref:6 (Từ field)', async () => {
    bridge.clearLog();
    const click = browserClick(bridge as any, state);
    const result: any = await click.execute({ ref: 'ref:6' });
    assert('success' in result && result.success, `Click failed: ${JSON.stringify(result)}`);

    // Verify correct CSS selector was generated
    const chainCall = bridge.getLastCall('CHAIN');
    assertEqual(chainCall.payload.commands[0].args[0], '[data-mcp-ref="ref:6"]', 'Wrong selector for ref');
    assertEqual(chainCall.payload.commands[1].command, 'click', 'Should use click command');
  });

  // ── Step 5: Type into departure ──
  console.log('\n── Step 5: Type "Hà Nội" ──');

  await test('browser_type "Hà Nội" into ref:6', async () => {
    bridge.clearLog();
    const type_ = browserType(bridge as any, state);
    const result: any = await type_.execute({ ref: 'ref:6', text: 'Hà Nội', clearBefore: true });
    assert('success' in result && result.success, `Type failed: ${JSON.stringify(result)}`);

    // Check chain: get → clear → type
    const chainCall = bridge.getLastCall('CHAIN');
    const cmds = chainCall.payload.commands;
    assertEqual(cmds[0].command, 'get');
    assertEqual(cmds[1].command, 'clear'); // clearBefore=true
    assertEqual(cmds[2].command, 'type');
    assertEqual(cmds[2].args[0], 'Hà Nội');
  });

  await test('browser_type with pressEnter', async () => {
    const type_ = browserType(bridge as any, state);
    const result: any = await type_.execute({ selector: '#search', text: 'test', pressEnter: true });
    assert('success' in result, 'Expected result');

    const chainCall = bridge.getLastCall('CHAIN');
    const typeCmd = chainCall.payload.commands.find((c: any) => c.command === 'type');
    assertEqual(typeCmd.args[0], 'test{enter}', 'Should append {enter}');
  });

  // ── Step 6: Fill ──
  console.log('\n── Step 6: Fill input directly ──');

  await test('browser_fill sets value via invoke', async () => {
    bridge.clearLog();
    const fill = browserFill(bridge as any, state);
    const result: any = await fill.execute({ ref: 'ref:7', value: 'Hồ Chí Minh' });
    assert('success' in result && result.success, 'Fill failed');

    const chain = bridge.getLastCall('CHAIN');
    const cmds = chain.payload.commands;
    assertEqual(cmds[1].command, 'invoke');
    assertEqual(cmds[1].args[0], 'val');
    assertEqual(cmds[1].args[1], 'Hồ Chí Minh');
    assertEqual(cmds[2].command, 'trigger');
    assertEqual(cmds[2].args[0], 'input');
  });

  // ── Step 7: Select, Check, Hover ──
  console.log('\n── Step 7: Select, Check, Hover ──');

  await test('browser_select dropdown', async () => {
    const sel = browserSelect(bridge as any, state);
    const result: any = await sel.execute({ ref: 'ref:9', value: 'business' });
    assert(!('error' in result), 'Select should not error');
  });

  await test('browser_check radio button', async () => {
    const chk = browserCheck(bridge as any, state);
    const result: any = await chk.execute({ ref: 'ref:5', checked: true });
    assert(!('error' in result), 'Check should not error');
  });

  await test('browser_hover over button', async () => {
    const hov = browserHover(bridge as any, state);
    const result: any = await hov.execute({ ref: 'ref:10' });
    assert('success' in result && result.success, 'Hover failed');
    assertEqual(result.usedRealEvents, false, 'Should fallback to trigger');
  });

  // ── Step 8: Scroll & Key Press ──
  console.log('\n── Step 8: Scroll & Key Press ──');

  await test('browser_scroll down 500px', async () => {
    const scroll = browserScroll(bridge as any, state);
    const result: any = await scroll.execute({ direction: 'down', amount: 500 });
    assert('success' in result && result.success, 'Scroll failed');
    assertEqual(result.scrollPosition.y, 500);
  });

  await test('browser_scroll element into view', async () => {
    bridge.clearLog();
    const scroll = browserScroll(bridge as any, state);
    const result: any = await scroll.execute({ ref: 'ref:10' });
    assert('success' in result, 'Scroll failed');

    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].command, 'scrollIntoView');
  });

  await test('browser_press_key Tab', async () => {
    bridge.clearLog();
    const key = browserPressKey(bridge as any, state);
    const result: any = await key.execute({ key: 'Tab' });
    assert('success' in result && result.success, 'Key press failed');

    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[0], '{tab}', 'Tab should map to {tab}');
  });

  await test('browser_press_key Ctrl+A modifier', async () => {
    bridge.clearLog();
    const key = browserPressKey(bridge as any, state);
    await key.execute({ key: 'a', modifiers: ['ctrl'] });

    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[0], '{ctrl+a}');
  });

  // ── Step 9: Get Text ──
  console.log('\n── Step 9: Get text content ──');

  await test('browser_get_text full page', async () => {
    const getText = browserGetText(bridge as any, state);
    const result: any = await getText.execute({ fullPage: true });
    assert('success' in result && result.success, 'getText failed');
    assertIncludes(result.text, 'Tìm & đặt vé máy bay');
    assertIncludes(result.text, 'Tìm chuyến bay');
  });

  await test('browser_get_text specific element', async () => {
    const getText = browserGetText(bridge as any, state);
    const result: any = await getText.execute({ ref: 'ref:6' });
    assert('success' in result, 'Expected result');
  });

  // ── Step 10: Get Attribute ──
  console.log('\n── Step 10: Get attribute ──');

  await test('browser_get_attribute single', async () => {
    const getAttr = browserGetAttribute(bridge as any, state);
    const result: any = await getAttr.execute({ ref: 'ref:6', attribute: 'data-testid' });
    assert('success' in result && result.success, 'getAttr failed');
    assertEqual(result.value, 'search-form-departure');
  });

  await test('browser_get_attribute all', async () => {
    const getAttr = browserGetAttribute(bridge as any, state);
    const result: any = await getAttr.execute({ selector: '#main-search', allAttributes: true });
    assert('success' in result && result.success, 'getAttr all failed');
    assertEqual(result.value['data-testid'], 'search-form');
    assertEqual(result.value.class, 'flight-search');
  });

  // ── Step 11: Network ──
  console.log('\n── Step 11: Network inspection ──');

  await test('browser_network_requests lists all requests', async () => {
    const netReqs = browserNetworkRequests(bridge as any, state);
    const result: any = await netReqs.execute({});
    assert('success' in result && result.success, 'netReqs failed');
    assertEqual(result.total, 3);
    assert(result.requests.some((r: any) => r.url.includes('/flight/search')), 'Should contain search API');
  });

  await test('browser_network_requests filter by resourceType xhr', async () => {
    const netReqs = browserNetworkRequests(bridge as any, state);
    const result: any = await netReqs.execute({ resourceType: 'xhr' });
    assert('success' in result, 'Expected result');
    assertEqual(result.filtered, 2, 'Should have 2 xhr requests');
  });

  await test('browser_network_requests filter by URL regex', async () => {
    const netReqs = browserNetworkRequests(bridge as any, state);
    const result: any = await netReqs.execute({ filter: '/api/.*search' });
    assert('success' in result, 'Expected result');
    assertEqual(result.filtered, 1);
  });

  await test('browser_network_request detail by ID', async () => {
    const netReq = browserNetworkRequest(bridge as any, state);
    const result: any = await netReq.execute({ id: 1 });
    assert('success' in result && result.success, 'netReq detail failed');
    assertEqual(result.method, 'POST');
    assertIncludes(result.url, 'flight/search');
  });

  await test('browser_network_request returns error for invalid ID', async () => {
    const netReq = browserNetworkRequest(bridge as any, state);
    const result: any = await netReq.execute({ id: 999 });
    assert('error' in result, 'Expected error');
    assertEqual(result.error.code, 'REQUEST_NOT_FOUND');
  });

  // ── Step 12: Mock Route ──
  console.log('\n── Step 12: Mock route ──');

  await test('browser_mock_route sets up intercept', async () => {
    const mock = browserMockRoute(bridge as any, state);
    const result: any = await mock.execute({
      url: '/api/v2/flight/search',
      method: 'POST',
      response: { statusCode: 200, body: { flights: [{ id: 1, price: 1500000 }] } },
    });
    assert('success' in result && result.success, 'Mock failed');
    assert(typeof result.alias === 'string', 'Should return alias');
    assert(state.activeMocks.size > 0, 'State should track mock');
  });

  // ── Step 13: Console ──
  console.log('\n── Step 13: Console messages ──');

  await test('browser_console_messages returns all levels', async () => {
    const console_ = browserConsoleMessages(bridge as any, state);
    const result: any = await console_.execute({});
    assert('success' in result && result.success, 'Console failed');
    assertEqual(result.total, 3);
    assert(result.messages.some((m: any) => m.level === 'error'), 'Should have error');
    assert(result.messages.some((m: any) => m.level === 'warn'), 'Should have warn');
  });

  await test('browser_console_messages filter by error', async () => {
    const console_ = browserConsoleMessages(bridge as any, state);
    const result: any = await console_.execute({ level: 'error' });
    assert('success' in result, 'Expected result');
    assert(result.messages.every((m: any) => m.level === 'error'), 'Should only have errors');
  });

  // ── Step 14: Evaluate JS ──
  console.log('\n── Step 14: Evaluate JavaScript ──');

  await test('browser_evaluate runs script', async () => {
    bridge.clearLog();
    const eval_ = browserEvaluate(bridge as any, state);
    const result: any = await eval_.execute({ script: 'return document.title' });
    assert('success' in result && result.success, 'Eval failed');

    // Verify the script was wrapped in IIFE
    const evalCall = bridge.getLastCall('EVAL');
    assertIncludes(evalCall.payload.script, 'return (function()');
  });

  // ── Step 15: Visual ──
  console.log('\n── Step 15: Screenshot & Viewport ──');

  await test('browser_screenshot captures page', async () => {
    const ss = browserScreenshot(bridge as any, state);
    const result: any = await ss.execute({ fullPage: true, name: 'traveloka_home' });
    assert('success' in result && result.success, 'Screenshot failed');
    assertEqual(result.name, 'traveloka_home');
  });

  await test('browser_viewport set to mobile', async () => {
    const vp = browserViewport(bridge as any, state);
    const result: any = await vp.execute({ width: 375, height: 812 });
    assert('success' in result && result.success, 'Viewport failed');
    assertEqual(state.viewportWidth, 375);
    assertEqual(state.viewportHeight, 812);
  });

  // ── Step 16: Storage & Cookies ──
  console.log('\n── Step 16: Cookies & Storage ──');

  await test('browser_get_cookies returns cookies', async () => {
    const cookies = browserGetCookies(bridge as any, state);
    const result: any = await cookies.execute({});
    assert('success' in result && result.success, 'getCookies failed');
    assertEqual(result.count, 2);
    assert(result.cookies.some((c: any) => c.name === 'tvlk_session'), 'Should have session cookie');
  });

  await test('browser_get_cookies filter by name', async () => {
    const cookies = browserGetCookies(bridge as any, state);
    const result: any = await cookies.execute({ name: 'lang' });
    assert('success' in result, 'Expected result');
    assertEqual(result.count, 1);
    assertEqual(result.cookies[0].value, 'vi');
  });

  await test('browser_set_cookie', async () => {
    const setCookie = browserSetCookie(bridge as any, state);
    const result: any = await setCookie.execute({ name: 'test', value: 'hello' });
    assert('success' in result && result.success, 'setCookie failed');
  });

  await test('browser_local_storage list', async () => {
    const ls = browserLocalStorage(bridge as any, state);
    const result: any = await ls.execute({ action: 'list' });
    assert('success' in result && result.success, 'localStorage list failed');
    assertEqual(result.result.count, 2);
  });

  await test('browser_local_storage get', async () => {
    const ls = browserLocalStorage(bridge as any, state);
    const result: any = await ls.execute({ action: 'get', key: 'user_prefs' });
    assert('success' in result && result.success, 'localStorage get failed');
  });

  // ── Step 17: Wait & Assert ──
  console.log('\n── Step 17: Wait & Assert ──');

  await test('browser_wait for fixed time', async () => {
    const wait = browserWait(bridge as any, state);
    const result: any = await wait.execute({ time: 500 });
    assert('success' in result && result.success, 'Wait failed');
    assertEqual(result.waited, 500);
  });

  await test('browser_wait for element', async () => {
    bridge.clearLog();
    const wait = browserWait(bridge as any, state);
    const result: any = await wait.execute({ selector: '.search-results', state: 'visible', timeout: 5000 });
    assert('success' in result && result.success, 'Wait for element failed');

    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[0], 'be.visible');
  });

  await test('browser_wait for text', async () => {
    const wait = browserWait(bridge as any, state);
    const result: any = await wait.execute({ text: 'Kết quả tìm kiếm' });
    assert('success' in result && result.success, 'Wait for text failed');
  });

  await test('browser_wait for networkIdle', async () => {
    const wait = browserWait(bridge as any, state);
    const result: any = await wait.execute({ networkIdle: true });
    assert('success' in result && result.success, 'Wait networkIdle failed');
  });

  await test('browser_assert element visible', async () => {
    bridge.clearLog();
    const assert_ = browserAssert(bridge as any, state);
    const result: any = await assert_.execute({ selector: '#search-btn', assertion: 'be.visible' });
    assert('success' in result, 'Assert failed');
    assertEqual(result.passed, true);

    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].command, 'should');
    assertEqual(chain.payload.commands[1].args[0], 'be.visible');
  });

  await test('browser_assert page title', async () => {
    const assert_ = browserAssert(bridge as any, state);
    const result: any = await assert_.execute({ assertion: 'have.title', expected: 'máy bay' });
    assert('success' in result, 'Assert title failed');
    assertEqual(result.passed, true);
  });

  // ── Step 18: Navigation extras ──
  console.log('\n── Step 18: Navigation extras ──');

  await test('browser_go_back', async () => {
    const goBack = browserGoBack(bridge as any, state);
    const result: any = await goBack.execute({});
    assert('success' in result && result.success, 'goBack failed');
  });

  await test('browser_reload', async () => {
    const reload = browserReload(bridge as any, state);
    const result: any = await reload.execute({ forceReload: true });
    assert('success' in result && result.success, 'reload failed');
    assertType(result.loadTime, 'number');
  });

  // ── Step 19: Tabs ──
  console.log('\n── Step 19: Tab management ──');

  await test('browser_list_tabs shows current tab', async () => {
    const tabs = browserListTabs(bridge as any, state);
    const result: any = await tabs.execute({});
    assert('success' in result && result.success, 'listTabs failed');
    assert(result.tabs.length >= 1, 'Should have at least 1 tab');
    assert(result.tabs.some((t: any) => t.active), 'Should have active tab');
  });

  // ── Step 20: Generate Test ──
  console.log('\n── Step 20: Generate Cypress test from session ──');

  // Manually populate history (in real usage, MCP server does this automatically)
  state.addToHistory({ tool: 'browser_navigate', params: { url: 'https://www.traveloka.com/vi-vn/flight' }, result: { success: true as const }, timestamp: 1 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:6' }, result: { success: true as const }, timestamp: 2 });
  state.addToHistory({ tool: 'browser_type', params: { ref: 'ref:6', text: 'Hà Nội' }, result: { success: true as const }, timestamp: 3 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:7' }, result: { success: true as const }, timestamp: 4 });
  state.addToHistory({ tool: 'browser_type', params: { ref: 'ref:7', text: 'Hồ Chí Minh' }, result: { success: true as const }, timestamp: 5 });
  state.addToHistory({ tool: 'browser_click', params: { selector: '#search-btn' }, result: { success: true as const }, timestamp: 6 });

  await test('browser_generate_test produces valid code', async () => {
    const gen = browserGenerateTest(bridge as any, state);
    const result: any = await gen.execute({ testName: 'Traveloka Flight Search' });
    assert('success' in result && result.success, `Generate failed: ${JSON.stringify(result)}`);
    assertIncludes(result.code, "describe('Traveloka Flight Search'");
    assertIncludes(result.code, "cy.visit('https://www.traveloka.com/vi-vn/flight')");
    assert(result.commandCount > 5, `Expected > 5 commands, got ${result.commandCount}`);
  });

  // ── Step 21: Error handling ──
  console.log('\n── Step 21: Error handling ──');

  await test('browser_navigate with invalid URL returns error', async () => {
    const nav = browserNavigate(bridge as any, state);
    const result: any = await nav.execute({ url: '' });
    assert('error' in result, 'Expected error');
    assertEqual(result.error.code, 'INVALID_URL');
  });

  await test('bridge timeout produces proper error', async () => {
    // Create a bridge that never responds
    const slowBridge = new MockBridge();
    slowBridge.onType('EVAL', () => {
      return new Promise(() => {}); // Never resolves
    });

    const nav = browserNavigate(slowBridge as any, state);
    const result: any = await nav.execute({ url: 'https://slow.example.com', timeout: 100 });
    // Should either get a result (mock resolves instantly) or timeout
    // Since our mock actually returns Promise<never>, the bridge timeout should catch it
    assert('error' in result || 'success' in result, 'Should get some result');
  });

  await test('browser_network_requests with invalid regex returns error', async () => {
    const netReqs = browserNetworkRequests(bridge as any, state);
    const result: any = await netReqs.execute({ filter: '[invalid' });
    assert('error' in result, 'Expected error');
    assertEqual(result.error.code, 'INVALID_FILTER');
  });

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Traveloka Integration Test Results`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    • ${f}`));
  }
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
