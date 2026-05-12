/**
 * Integration Test — Simulate real ABAY.vn flight search
 * 
 * ABAY has a very different structure from Traveloka:
 * - ASP.NET WebForms with __doPostBack
 * - City dropdown lists (not autocomplete inputs)
 * - Passenger count dropdowns (Người lớn, Trẻ em, Em bé)
 * - Simpler layout, no SPA routing
 *
 * Flow:
 * 1. Navigate to abay.vn
 * 2. Snapshot → verify different DOM structure
 * 3. Click "Điểm đi" dropdown → select "Hà Nội"  
 * 4. Click "Điểm đến" dropdown → select "Tp Hồ Chí Minh"
 * 5. Select passenger count
 * 6. Click "TÌM KIẾM" button
 * 7. Check network requests
 * 8. Handle dialog (ASP.NET confirm)
 * 9. Get cookies (ASP.NET session)
 * 10. Assert page content
 * 11. Generate test
 */

import { StateManager } from '../src/state/state-manager';
import { BridgeServer } from '../src/bridge/ws-server';

import { browserNavigate, browserGoBack, browserReload } from '../src/tools/navigation/index';
import { browserClick, browserType, browserFill, browserSelect, browserCheck, browserHover, browserScroll, browserPressKey, browserDragDrop } from '../src/tools/interaction/index';
import { browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute } from '../src/tools/snapshot/index';
import { browserNetworkRequests, browserNetworkRequest, browserMockRoute, browserRemoveMock, browserWaitForRequest } from '../src/tools/network/index';
import { browserScreenshot, browserViewport } from '../src/tools/visual/index';
import { browserConsoleMessages, browserEvaluate } from '../src/tools/console/index';
import { browserListTabs, browserNewTab, browserSwitchTab, browserCloseTab } from '../src/tools/tabs/index';
import { browserGetCookies, browserSetCookie, browserClearCookies, browserLocalStorage, browserSessionStorage } from '../src/tools/storage/index';
import { browserHandleDialog } from '../src/tools/dialog/index';
import { browserWait, browserAssert, browserRunCypress, browserGenerateTest } from '../src/tools/utility/index';

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

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function assertEqual(a: any, b: any, msg?: string) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertIncludes(s: string, sub: string) { if (!s.includes(sub)) throw new Error(`"${s.substring(0,200)}..." does not include "${sub}"`); }

// ═══════════════════════════════════════════
// Mock Bridge — ABAY-specific responses
// ═══════════════════════════════════════════
class AbayMockBridge {
  private handlers: Map<string, (p: any) => any> = new Map();
  private log: Array<{ type: string; payload: any }> = [];
  private currentUrl = 'about:blank';

  constructor() {
    this.handlers.set('EVAL', (payload) => {
      const s = payload.script || '';

      // Snapshot script (must be first — contains location.href)
      if (s.includes('TAG_ROLES') || (s.includes('traverse') && s.includes('toYaml'))) {
        return {
          yaml: `- banner
  - link "ABAY.vn" [ref:1]
  - text "Tổng đài hỗ trợ: 1900 6091"
- navigation
  - link "Trang chủ" [ref:2]
  - link "Vé nội địa" [ref:3]
  - link "Vé quốc tế" [ref:4]
  - link "Vé theo hãng" [ref:5]
  - link "Xem lại đơn hàng" [ref:6]
  - link "Giới thiệu" [ref:7]
  - link "Liên hệ" [ref:8]
- main
  - heading "vé máy bay giá rẻ" level=2
  - form "Flight Search"
    - textbox "Điểm đi" [ref:9] value=""
    - textbox "Điểm đến" [ref:10] value=""
    - textbox "Ngày đi" [ref:11] value=""
    - textbox "Ngày về" [ref:12] value=""
    - checkbox "Bỏ chọn ngày về" [ref:13] unchecked
    - combobox "Người lớn" [ref:14] value="1"
    - combobox "Trẻ em" [ref:15] value="0"
    - combobox "Em bé" [ref:16] value="0"
    - button "TÌM KIẾM" [ref:17]
  - region "Chọn điểm"
    - heading "Việt Nam" level=3
    - link "Hà Nội" [ref:18]
    - link "Tp Hồ Chí Minh" [ref:19]
    - link "Đà Nẵng" [ref:20]
    - link "Nha Trang" [ref:21]
    - link "Phú Quốc" [ref:22]
    - heading "Quốc tế" level=3
    - link "Bangkok (BKK)" [ref:23]
    - link "Singapore (SIN)" [ref:24]
    - link "Seoul (ICN)" [ref:25]
    - link "Tokyo Narita (NRT)" [ref:26]
- contentinfo
  - link "Câu hỏi thường gặp" [ref:27]
  - link "Thông tin chuyển khoản" [ref:28]
  - text "© 2008-2026 ABAY.vn"
`,
          refCount: 28,
          url: this.currentUrl,
          title: 'Vé Nội Địa & Vé Quốc Tế Các Hãng Vé Máy Bay Giá Rẻ Khuyến Mãi',
        };
      }

      // Location
      if (s.includes('location.href')) {
        if (s.includes('document.title'))
          return { url: this.currentUrl, title: 'Vé Nội Địa & Vé Quốc Tế Các Hãng Vé Máy Bay Giá Rẻ Khuyến Mãi' };
        return this.currentUrl;
      }

      // Query elements (BEFORE generic querySelector — script also contains 'querySelector')
      if (s.includes('querySelectorAll') && s.includes('refCounter'))
        return {
          count: 4,
          elements: [
            { ref: 'ref:201', role: 'textbox', name: 'Điểm đi', tagName: 'INPUT', visible: true, disabled: false },
            { ref: 'ref:202', role: 'textbox', name: 'Điểm đến', tagName: 'INPUT', visible: true, disabled: false },
            { ref: 'ref:203', role: 'combobox', name: 'Người lớn', tagName: 'SELECT', visible: true, disabled: false },
            { ref: 'ref:204', role: 'button', name: 'TÌM KIẾM', tagName: 'INPUT', visible: true, disabled: false },
          ],
        };

      // All attributes (BEFORE generic querySelector)
      if (s.includes('Object.fromEntries') && s.includes('attributes'))
        return { id: 'ctl00_ContentPlaceHolder1_txtDiemDi', name: 'ctl00$ContentPlaceHolder1$txtDiemDi', type: 'text', class: 'form-control', autocomplete: 'off' };

      // Element info after click
      if (s.includes('querySelector') && s.includes('tagName')) {
        if (s.includes('ref:17')) return { tagName: 'INPUT', text: 'TÌM KIẾM', role: 'button' };
        if (s.includes('ref:18')) return { tagName: 'A', text: 'Hà Nội', role: 'link' };
        if (s.includes('ref:19')) return { tagName: 'A', text: 'Tp Hồ Chí Minh', role: 'link' };
        return { tagName: 'DIV', text: '', role: 'generic' };
      }

      // Value after type
      if (s.includes('querySelector') && s.includes('.value')) return 'Hà Nội';

      // Full page text
      if (s.includes('document.body.innerText'))
        return 'Vé máy bay giá rẻ, nhiều khuyến mãi nội địa, quốc tế - ABAY.vn\nĐiểm đi\nĐiểm đến\nNgày đi\nNgày về\nNgười lớn\nTrẻ em\nEm bé\nTÌM KIẾM\nHà Nội\nTp Hồ Chí Minh\nĐà Nẵng\nTổng đài hỗ trợ: 1900 6091';

      // getAttribute (single)
      if (s.includes('getAttribute') && !s.includes('Object.fromEntries'))
        return 'ctl00_ContentPlaceHolder1_txtDiemDi';

      // Network buffer
      if (s.includes('__mcpNetworkBuffer'))
        return [
          { id: 1, url: 'https://www.abay.vn/', method: 'GET', status: 200, resourceType: 'document', requestHeaders: {}, responseHeaders: { 'content-type': 'text/html' }, requestBody: null, responseBody: null, duration: 450, timestamp: Date.now() - 3000, size: 85000 },
          { id: 2, url: 'https://www.abay.vn/_Web/_File/Images/Layout/homeIcon.png', method: 'GET', status: 200, resourceType: 'image', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 30, timestamp: Date.now() - 2500, size: 1200 },
          { id: 3, url: 'https://www.abay.vn/WebResource.axd?d=abc123', method: 'GET', status: 200, resourceType: 'script', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 80, timestamp: Date.now() - 2000, size: 45000 },
          { id: 4, url: 'https://www.abay.vn/ScriptResource.axd?d=def456', method: 'GET', status: 200, resourceType: 'script', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 65, timestamp: Date.now() - 1800, size: 32000 },
          { id: 5, url: 'https://www.googletagmanager.com/gtm.js?id=GTM-NW4HT8W', method: 'GET', status: 200, resourceType: 'script', requestHeaders: {}, responseHeaders: {}, requestBody: null, responseBody: null, duration: 120, timestamp: Date.now() - 1500, size: 98000 },
        ];

      // Console buffer
      if (s.includes('__mcpConsoleBuffer'))
        return [
          { level: 'log', text: '[GTM] Container loaded', timestamp: Date.now() - 2000 },
          { level: 'warn', text: 'Synchronous XMLHttpRequest on the main thread is deprecated', timestamp: Date.now() - 1500 },
        ];

      // Scroll position
      if (s.includes('scrollX') || s.includes('scrollY'))
        return { x: 0, y: 300 };

      // realHover check
      if (s.includes('cy.realHover')) return false;

      // localStorage
      if (s.includes('localStorage')) {
        if (s.includes('localStorage.length') && s.includes('localStorage.key'))
          return { count: 1, items: { 'abay_recent': '["HAN-SGN","HAN-DAD"]' } };
        if (s.includes('getItem')) return '["HAN-SGN","HAN-DAD"]';
        if (s.includes('setItem')) return true;
        if (s.includes('removeItem')) return true;
        if (s.includes('clear')) return true;
      }

      // sessionStorage
      if (s.includes('sessionStorage')) {
        if (s.includes('sessionStorage.length') && s.includes('sessionStorage.key'))
          return { count: 1, items: { 'abay_search_state': '{"from":"HAN","to":"SGN"}' } };
        if (s.includes('getItem')) return '{"from":"HAN","to":"SGN"}';
        if (s.includes('setItem')) return true;
      }

      // evaluate generic
      if (s.includes('return (function()'))
        return { __viewstate: '__VIEWSTATE exists', postback: true };

      // networkIdle / Promise
      if (s.includes('Cypress.Promise') || s.includes('Promise') || s.includes('resolve')) return 'idle';

      return null;
    });

    this.handlers.set('COMMAND', (p) => {
      if (p.command === 'visit') { this.currentUrl = p.args[0]; return {}; }
      if (p.command === 'go') return {};
      if (p.command === 'reload') return {};
      if (p.command === 'wait') return {};
      if (p.command === 'viewport') return {};
      if (p.command === 'screenshot') return {};
      if (p.command === 'getCookies') return [
        { name: 'ASP.NET_SessionId', value: 'kj3hf2k4h5jk2h3', domain: '.abay.vn', path: '/', secure: false, httpOnly: true },
        { name: '__RequestVerificationToken', value: 'xyz789abc', domain: '.abay.vn', path: '/', secure: false, httpOnly: false },
        { name: '_ga', value: 'GA1.2.123456.789012', domain: '.abay.vn', path: '/', secure: false, httpOnly: false },
      ];
      if (p.command === 'setCookie') return {};
      if (p.command === 'clearCookies' || p.command === 'clearCookie') return {};
      return {};
    });

    this.handlers.set('CHAIN', (p) => {
      const cmds = p.commands || [];
      const last = cmds[cmds.length - 1];
      if (last?.command === 'should') return {};
      if (last?.command === 'select') return {};
      if (last?.command === 'invoke') return {};
      if (last?.command === 'trigger') return {};
      if (last?.command === 'scrollIntoView') return {};
      return {};
    });

    this.handlers.set('INTERCEPT', () => ({ alias: 'mock_search' }));
    this.handlers.set('INTERCEPT_WAIT', () => ({ alias: 'wait_postback' }));
    this.handlers.set('WAIT_ALIAS', () => ({
      request: { method: 'POST', url: 'https://www.abay.vn/', body: '__VIEWSTATE=abc&__EVENTTARGET=ctl00$ContentPlaceHolder1$btnTimKiem' },
      response: { statusCode: 200, body: '<html>Search results</html>' },
      duration: 1200,
    }));
    this.handlers.set('READ_FILE_BASE64', () => 'iVBORw0KGgoAAAANSUhEUg==');
  }

  async execute(msg: { type: string; payload: any; timeout?: number }): Promise<any> {
    this.log.push({ type: msg.type, payload: msg.payload });
    const h = this.handlers.get(msg.type);
    return h ? h(msg.payload) : {};
  }

  getLog() { return this.log; }
  getLastCall(type?: string) {
    const f = type ? this.log.filter(c => c.type === type) : this.log;
    return f[f.length - 1];
  }
  clearLog() { this.log = []; }
}

// ═══════════════════════════════════════════
async function runTests() {
  const bridge = new AbayMockBridge();
  const state = new StateManager();

  console.log('\n══════════════════════════════════════════');
  console.log('  ABAY.vn Integration Tests');
  console.log('══════════════════════════════════════════');

  // ── 1. Navigate ──
  console.log('\n── 1. Navigate to abay.vn ──');
  await test('navigate to abay.vn', async () => {
    const nav = browserNavigate(bridge as any, state);
    const r: any = await nav.execute({ url: 'https://www.abay.vn/' });
    assert(r.success, `Nav failed: ${JSON.stringify(r)}`);
    assertIncludes(r.url, 'abay.vn');
    assertIncludes(r.title, 'Vé Nội Địa');
    assertEqual(state.currentUrl, 'https://www.abay.vn/');
  });

  // ── 2. Snapshot ──
  console.log('\n── 2. Snapshot ABAY page ──');
  await test('snapshot returns ABAY-specific structure', async () => {
    const snap = browserSnapshot(bridge as any, state);
    const r: any = await snap.execute({});
    assert(r.success, 'Snapshot failed');
    // ABAY has different structure from Traveloka
    assertIncludes(r.snapshot, 'banner');
    assertIncludes(r.snapshot, 'link "ABAY.vn" [ref:1]');
    assertIncludes(r.snapshot, 'textbox "Điểm đi" [ref:9]');
    assertIncludes(r.snapshot, 'textbox "Điểm đến" [ref:10]');
    assertIncludes(r.snapshot, 'combobox "Người lớn" [ref:14]');
    assertIncludes(r.snapshot, 'button "TÌM KIẾM" [ref:17]');
    assertIncludes(r.snapshot, 'link "Hà Nội" [ref:18]');
    assertIncludes(r.snapshot, 'link "Bangkok (BKK)" [ref:23]');
    assertIncludes(r.snapshot, 'contentinfo');
    assertEqual(r.elementCount, 28);
  });

  await test('snapshot with scope narrows to form', async () => {
    const snap = browserSnapshot(bridge as any, state);
    const r: any = await snap.execute({ scope: '#searchForm', maxDepth: 5 });
    assert(r.success, 'Scoped snapshot failed');
  });

  // ── 3. Query elements ──
  console.log('\n── 3. Query elements ──');
  await test('query form inputs', async () => {
    const q = browserQueryElements(bridge as any, state);
    const r: any = await q.execute({ role: 'textbox' });
    assert(r.success, 'Query failed');
    assertEqual(r.count, 4);
    assert(r.elements.some((e: any) => e.name === 'Điểm đi'), 'Should find Điểm đi');
    assert(r.elements.some((e: any) => e.role === 'combobox'), 'Should find combobox');
  });

  // ── 4. Click "Điểm đi" then select "Hà Nội" ──
  console.log('\n── 4. Click Điểm đi → select Hà Nội ──');
  await test('click Điểm đi input', async () => {
    bridge.clearLog();
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({ ref: 'ref:9' });
    assert(r.success, 'Click failed');
    // Verify correct selector
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[0].args[0], '[data-mcp-ref="ref:9"]');
  });

  await test('click Hà Nội from dropdown', async () => {
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({ ref: 'ref:18' });
    assert(r.success, 'Click Hà Nội failed');
  });

  // ── 5. Click "Điểm đến" then select "Tp Hồ Chí Minh" ──
  console.log('\n── 5. Click Điểm đến → select Tp HCM ──');
  await test('click Điểm đến input', async () => {
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({ ref: 'ref:10' });
    assert(r.success, 'Click Điểm đến failed');
  });

  await test('click Tp Hồ Chí Minh from dropdown', async () => {
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({ ref: 'ref:19' });
    assert(r.success, 'Click HCM failed');
  });

  // ── 6. Select passengers ──
  console.log('\n── 6. Select passengers ──');
  await test('select 2 adults', async () => {
    bridge.clearLog();
    const sel = browserSelect(bridge as any, state);
    const r: any = await sel.execute({ ref: 'ref:14', value: '2' });
    assert(!('error' in r), 'Select adults failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].command, 'select');
    assertEqual(chain.payload.commands[1].args[0], '2');
  });

  await test('select 1 child', async () => {
    const sel = browserSelect(bridge as any, state);
    const r: any = await sel.execute({ ref: 'ref:15', value: '1' });
    assert(!('error' in r), 'Select child failed');
  });

  // ── 7. Check "Bỏ chọn ngày về" (one-way) ──
  console.log('\n── 7. Check one-way checkbox ──');
  await test('check one-way checkbox', async () => {
    bridge.clearLog();
    const chk = browserCheck(bridge as any, state);
    const r: any = await chk.execute({ ref: 'ref:13', checked: true });
    assert(!('error' in r), 'Check failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].command, 'check');
  });

  // ── 8. Type date ──
  console.log('\n── 8. Type departure date ──');
  await test('type date into Ngày đi', async () => {
    bridge.clearLog();
    const type_ = browserType(bridge as any, state);
    const r: any = await type_.execute({ ref: 'ref:11', text: '15/06/2026', clearBefore: true });
    assert(r.success, 'Type date failed');
    const chain = bridge.getLastCall('CHAIN');
    const cmds = chain.payload.commands;
    assertEqual(cmds[1].command, 'clear');
    assertEqual(cmds[2].args[0], '15/06/2026');
  });

  // ── 9. Click TÌM KIẾM ──
  console.log('\n── 9. Click TÌM KIẾM ──');
  await test('click search button', async () => {
    bridge.clearLog();
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({ ref: 'ref:17' });
    assert(r.success, 'Click search failed');
  });

  // ── 10. Wait for postback (ASP.NET specific) ──
  console.log('\n── 10. Wait for ASP.NET postback ──');
  await test('wait for network idle after postback', async () => {
    const wait = browserWait(bridge as any, state);
    const r: any = await wait.execute({ networkIdle: true, timeout: 15000 });
    assert(r.success, 'Wait networkIdle failed');
  });

  await test('wait for search results element', async () => {
    bridge.clearLog();
    const wait = browserWait(bridge as any, state);
    const r: any = await wait.execute({ selector: '#searchResults', state: 'visible', timeout: 10000 });
    assert(r.success, 'Wait for results failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[0], 'be.visible');
  });

  // ── 11. Network analysis ──
  console.log('\n── 11. Network requests ──');
  await test('list all network requests', async () => {
    const net = browserNetworkRequests(bridge as any, state);
    const r: any = await net.execute({});
    assert(r.success, 'Network list failed');
    assertEqual(r.total, 5);
  });

  await test('filter document requests', async () => {
    const net = browserNetworkRequests(bridge as any, state);
    const r: any = await net.execute({ resourceType: 'document' });
    assert(r.success, 'Filter failed');
    assertEqual(r.filtered, 1);
  });

  await test('filter by ASP.NET resources', async () => {
    const net = browserNetworkRequests(bridge as any, state);
    const r: any = await net.execute({ filter: '\\.(axd|aspx)' });
    assert(r.success, 'Regex filter failed');
    assertEqual(r.filtered, 2, `Expected 2 .axd resources, got ${r.filtered}`);
  });

  await test('get request detail', async () => {
    const net = browserNetworkRequest(bridge as any, state);
    const r: any = await net.execute({ id: 1 });
    assert(r.success, 'Detail failed');
    assertIncludes(r.url, 'abay.vn');
    assertEqual(r.status, 200);
  });

  // ── 12. Mock route for search API ──
  console.log('\n── 12. Mock search route ──');
  await test('mock search POST', async () => {
    const mock = browserMockRoute(bridge as any, state);
    const r: any = await mock.execute({
      url: 'https://www.abay.vn/',
      method: 'POST',
      response: { statusCode: 200, body: '<html>Mocked results</html>', headers: { 'content-type': 'text/html' } },
    });
    assert(r.success, 'Mock failed');
    assert(state.activeMocks.size >= 1, 'Mock not tracked');
  });

  await test('remove mock', async () => {
    const mockId = Array.from(state.activeMocks.keys())[0];
    const rm = browserRemoveMock(bridge as any, state);
    const r: any = await rm.execute({ mockId });
    assert(r.success, 'Remove mock failed');
  });

  // ── 13. Wait for request ──
  console.log('\n── 13. Wait for postback request ──');
  await test('wait for POST request', async () => {
    const waitReq = browserWaitForRequest(bridge as any, state);
    const r: any = await waitReq.execute({ url: 'https://www.abay.vn/', method: 'POST', timeout: 10000 });
    assert(r.success, `Wait request failed: ${JSON.stringify(r)}`);
    assertEqual(r.request.method, 'POST');
    assertIncludes(r.request.url, 'abay.vn');
  });

  // ── 14. Console ──
  console.log('\n── 14. Console messages ──');
  await test('check console has GTM log', async () => {
    const cons = browserConsoleMessages(bridge as any, state);
    const r: any = await cons.execute({});
    assert(r.success, 'Console failed');
    assert(r.messages.some((m: any) => m.text.includes('GTM')), 'Should have GTM log');
  });

  // ── 15. Evaluate — check ASP.NET viewstate ──
  console.log('\n── 15. Evaluate JS ──');
  await test('evaluate checks __VIEWSTATE', async () => {
    bridge.clearLog();
    const ev = browserEvaluate(bridge as any, state);
    const r: any = await ev.execute({ script: "return { hasViewState: !!document.getElementById('__VIEWSTATE') }" });
    assert(r.success, 'Eval failed');
    // Verify script was wrapped
    const call = bridge.getLastCall('EVAL');
    assertIncludes(call.payload.script, 'return (function()');
  });

  await test('evaluate with raw Cypress commands', async () => {
    const run = browserRunCypress(bridge as any, state);
    const r: any = await run.execute({ code: "cy.get('#__VIEWSTATE').should('exist')" });
    assert(r.success, 'RunCypress failed');
  });

  // ── 16. Get text ──
  console.log('\n── 16. Get page text ──');
  await test('get full page text', async () => {
    const gt = browserGetText(bridge as any, state);
    const r: any = await gt.execute({ fullPage: true });
    assert(r.success, 'getText failed');
    assertIncludes(r.text, 'ABAY.vn');
    assertIncludes(r.text, 'Điểm đi');
    assertIncludes(r.text, '1900 6091');
  });

  // ── 17. Get attribute (ASP.NET IDs) ──
  console.log('\n── 17. Get attribute ──');
  await test('get ASP.NET control id', async () => {
    const ga = browserGetAttribute(bridge as any, state);
    const r: any = await ga.execute({ ref: 'ref:9', attribute: 'id' });
    assert(r.success, 'getAttr failed');
    assertIncludes(r.value, 'ctl00_ContentPlaceHolder1');
  });

  await test('get all attributes', async () => {
    const ga = browserGetAttribute(bridge as any, state);
    const r: any = await ga.execute({ selector: '#ctl00_ContentPlaceHolder1_txtDiemDi', allAttributes: true });
    assert(r.success, 'getAttr all failed');
    assertEqual(r.value.autocomplete, 'off');
    assertEqual(r.value.type, 'text');
  });

  // ── 18. Cookies (ASP.NET session) ──
  console.log('\n── 18. ASP.NET cookies ──');
  await test('get cookies includes ASP.NET session', async () => {
    const gc = browserGetCookies(bridge as any, state);
    const r: any = await gc.execute({});
    assert(r.success, 'getCookies failed');
    assert(r.cookies.some((c: any) => c.name === 'ASP.NET_SessionId'), 'Should have ASP.NET session');
    assert(r.cookies.some((c: any) => c.name === '__RequestVerificationToken'), 'Should have antiforgery token');
  });

  await test('set cookie', async () => {
    const sc = browserSetCookie(bridge as any, state);
    const r: any = await sc.execute({ name: 'abay_pref', value: 'lang=vi', domain: '.abay.vn' });
    assert(r.success, 'setCookie failed');
  });

  await test('clear cookies', async () => {
    const cc = browserClearCookies(bridge as any, state);
    const r: any = await cc.execute({ name: 'ASP.NET_SessionId' });
    assert(r.success, 'clearCookie failed');
  });

  // ── 19. Storage ──
  console.log('\n── 19. Storage ──');
  await test('localStorage list', async () => {
    const ls = browserLocalStorage(bridge as any, state);
    const r: any = await ls.execute({ action: 'list' });
    assert(r.success, 'LS list failed');
    assertEqual(r.result.count, 1);
    assert('abay_recent' in r.result.items, 'Should have recent searches');
  });

  await test('sessionStorage get', async () => {
    const ss = browserSessionStorage(bridge as any, state);
    const r: any = await ss.execute({ action: 'get', key: 'abay_search_state' });
    assert(r.success, 'SS get failed');
  });

  // ── 20. Visual ──
  console.log('\n── 20. Screenshot & Viewport ──');
  await test('screenshot search form', async () => {
    const ss = browserScreenshot(bridge as any, state);
    const r: any = await ss.execute({ ref: 'ref:17', name: 'abay_search_btn' });
    assert(r.success, 'Screenshot failed');
  });

  await test('viewport responsive (iPhone)', async () => {
    const vp = browserViewport(bridge as any, state);
    const r: any = await vp.execute({ preset: 'iphone-x' });
    assert(r.success, 'Viewport failed');
  });

  await test('viewport custom', async () => {
    const vp = browserViewport(bridge as any, state);
    const r: any = await vp.execute({ width: 1366, height: 768 });
    assert(r.success, 'Viewport failed');
    assertEqual(state.viewportWidth, 1366);
  });

  // ── 21. Scroll ──
  console.log('\n── 21. Scroll ──');
  await test('scroll down', async () => {
    const sc = browserScroll(bridge as any, state);
    const r: any = await sc.execute({ direction: 'down', amount: 300 });
    assert(r.success, 'Scroll failed');
    assertEqual(r.scrollPosition.y, 300);
  });

  // ── 22. Dialog (ASP.NET confirm) ──
  console.log('\n── 22. Handle dialog ──');
  await test('handle ASP.NET confirm dialog', async () => {
    const hd = browserHandleDialog(bridge as any, state);
    const r: any = await hd.execute({ action: 'accept', autoHandle: true });
    assert(!('error' in r), 'Dialog handle failed');
  });

  // ── 23. Assert ──
  console.log('\n── 23. Assertions ──');
  await test('assert search button exists', async () => {
    const a = browserAssert(bridge as any, state);
    const r: any = await a.execute({ selector: '#btnTimKiem', assertion: 'exist' });
    assert(r.passed, 'Assert exist failed');
  });

  await test('assert page URL', async () => {
    const a = browserAssert(bridge as any, state);
    const r: any = await a.execute({ assertion: 'have.url', expected: 'abay.vn' });
    assert(r.passed, 'Assert URL failed');
  });

  // ── 24. Hover ──
  console.log('\n── 24. Hover menu ──');
  await test('hover Vé nội địa menu', async () => {
    const h = browserHover(bridge as any, state);
    const r: any = await h.execute({ ref: 'ref:3' });
    assert(r.success, 'Hover failed');
    assertEqual(r.usedRealEvents, false);
  });

  // ── 25. Press key ──
  console.log('\n── 25. Keyboard ──');
  await test('press Escape to close dropdown', async () => {
    bridge.clearLog();
    const k = browserPressKey(bridge as any, state);
    const r: any = await k.execute({ key: 'Escape' });
    assert(r.success, 'Escape failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[0], '{esc}');
  });

  await test('press Enter to submit', async () => {
    bridge.clearLog();
    const k = browserPressKey(bridge as any, state);
    const r: any = await k.execute({ key: 'Enter', ref: 'ref:17' });
    assert(r.success, 'Enter failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[0].args[0], '[data-mcp-ref="ref:17"]');
    assertEqual(chain.payload.commands[1].args[0], '{enter}');
  });

  // ── 26. Drag drop ──
  console.log('\n── 26. Drag & Drop ──');
  await test('drag drop (swap departure/destination)', async () => {
    const dd = browserDragDrop(bridge as any, state);
    const r: any = await dd.execute({ sourceRef: 'ref:9', targetRef: 'ref:10' });
    assert(r.success, 'DragDrop failed');
  });

  // ── 27. Tabs ──
  console.log('\n── 27. Tab management ──');
  await test('list tabs', async () => {
    const lt = browserListTabs(bridge as any, state);
    const r: any = await lt.execute({});
    assert(r.success, 'listTabs failed');
    assert(r.tabs.length >= 1, 'Should have tab');
  });

  await test('new tab + switch + close', async () => {
    const nt = browserNewTab(bridge as any, state);
    const r1: any = await nt.execute({ url: 'https://www.abay.vn/ve-may-bay-noi-dia' });
    assert(r1.success, 'newTab failed');

    const st = browserSwitchTab(bridge as any, state);
    const r2: any = await st.execute({ tabId: r1.tabId });
    assert(r2.success, 'switchTab failed');

    const ct = browserCloseTab(bridge as any, state);
    const r3: any = await ct.execute({ tabId: r1.tabId });
    assert(r3.success, 'closeTab failed');
  });

  // ── 28. Fill ──
  console.log('\n── 28. Fill ──');
  await test('fill departure directly', async () => {
    bridge.clearLog();
    const f = browserFill(bridge as any, state);
    const r: any = await f.execute({ ref: 'ref:9', value: 'HAN' });
    assert(r.success, 'Fill failed');
    const chain = bridge.getLastCall('CHAIN');
    assertEqual(chain.payload.commands[1].args[1], 'HAN');
  });

  // ── 29. Navigate back & reload ──
  console.log('\n── 29. Navigation ──');
  await test('go back', async () => {
    const gb = browserGoBack(bridge as any, state);
    const r: any = await gb.execute({});
    assert(r.success, 'goBack failed');
  });

  await test('reload with cache bypass', async () => {
    const rl = browserReload(bridge as any, state);
    const r: any = await rl.execute({ forceReload: true });
    assert(r.success, 'reload failed');
  });

  // ── 30. Generate test from full session ──
  console.log('\n── 30. Generate test ──');

  // Populate history
  state.addToHistory({ tool: 'browser_navigate', params: { url: 'https://www.abay.vn/' }, result: { success: true as const }, timestamp: 1 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:9' }, result: { success: true as const }, timestamp: 2 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:18' }, result: { success: true as const }, timestamp: 3 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:10' }, result: { success: true as const }, timestamp: 4 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:19' }, result: { success: true as const }, timestamp: 5 });
  state.addToHistory({ tool: 'browser_select', params: { ref: 'ref:14', value: '2' }, result: { success: true as const }, timestamp: 6 });
  state.addToHistory({ tool: 'browser_check', params: { ref: 'ref:13', checked: true }, result: { success: true as const }, timestamp: 7 });
  state.addToHistory({ tool: 'browser_type', params: { ref: 'ref:11', text: '15/06/2026' }, result: { success: true as const }, timestamp: 8 });
  state.addToHistory({ tool: 'browser_click', params: { ref: 'ref:17' }, result: { success: true as const }, timestamp: 9 });
  state.addToHistory({ tool: 'browser_assert', params: { selector: '#searchResults', assertion: 'be.visible' }, result: { success: true as const }, timestamp: 10 });

  await test('generate test from ABAY session', async () => {
    const gen = browserGenerateTest(bridge as any, state);
    const r: any = await gen.execute({ testName: 'ABAY Flight Search HAN → SGN' });
    assert(r.success, `Generate failed: ${JSON.stringify(r)}`);
    assertIncludes(r.code, "describe('ABAY Flight Search HAN → SGN'");
    assertIncludes(r.code, "cy.visit('https://www.abay.vn/')");
    assertIncludes(r.code, "cy.get('[data-mcp-ref=\"ref:18\"]').click()");
    assertIncludes(r.code, "cy.get('[data-mcp-ref=\"ref:14\"]').select('2')");  // passenger
    assertIncludes(r.code, "cy.get('[data-mcp-ref=\"ref:13\"]').check()");      // one-way
    assertIncludes(r.code, ".type('15/06/2026')");
    assert(r.commandCount === 10, `Expected 10 commands, got ${r.commandCount}`);
  });

  // ── 31. Error handling ──
  console.log('\n── 31. Error handling ──');
  await test('navigate empty URL', async () => {
    const nav = browserNavigate(bridge as any, state);
    const r: any = await nav.execute({ url: '' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_URL');
  });

  await test('click without ref or selector', async () => {
    const click = browserClick(bridge as any, state);
    const r: any = await click.execute({});
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_SELECTOR');
  });

  await test('type without target', async () => {
    const t = browserType(bridge as any, state);
    const r: any = await t.execute({ text: 'hello' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_SELECTOR');
  });

  await test('localStorage get without key', async () => {
    const ls = browserLocalStorage(bridge as any, state);
    const r: any = await ls.execute({ action: 'get' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_KEY');
  });

  await test('sessionStorage delete without key', async () => {
    const ss = browserSessionStorage(bridge as any, state);
    const r: any = await ss.execute({ action: 'delete' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_KEY');
  });

  await test('network requests invalid regex', async () => {
    const net = browserNetworkRequests(bridge as any, state);
    const r: any = await net.execute({ filter: '(unclosed' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'INVALID_FILTER');
  });

  await test('remove nonexistent mock', async () => {
    const rm = browserRemoveMock(bridge as any, state);
    const r: any = await rm.execute({ mockId: 'nonexistent' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'MOCK_NOT_FOUND');
  });

  await test('wait with no condition', async () => {
    const w = browserWait(bridge as any, state);
    const r: any = await w.execute({});
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'WAIT_TIMEOUT');
  });

  await test('generate test with empty history', async () => {
    const emptyState = new StateManager();
    const gen = browserGenerateTest(bridge as any, emptyState);
    const r: any = await gen.execute({});
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'GENERATE_FAILED');
  });

  await test('getAttribute without attribute and not allAttributes', async () => {
    const ga = browserGetAttribute(bridge as any, state);
    const r: any = await ga.execute({ ref: 'ref:9' });
    assert('error' in r, 'Should error');
    assertEqual(r.error.code, 'GET_ATTR_FAILED');
  });

  // ═══════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ABAY.vn Integration Test Results`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    • ${f}`));
  }
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Crash:', err); process.exit(1); });
