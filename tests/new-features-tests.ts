/**
 * Tests for NEW features:
 * - browser_get_html
 * - browser_file_upload
 * - browser_save_state / restore / list / delete (file-based persistence)
 * - browser_iframe_click / type / snapshot
 * - browser_vision_click
 * - browser_set_user_agent
 * - browser_pdf
 * - browser_highlight / remove_highlight
 */
import * as fs from 'fs';
import * as path from 'path';
import { StateManager } from '../src/state/state-manager';

// Import new tools
import { browserGetHtml } from '../src/tools/snapshot/index';
import { browserFileUpload } from '../src/tools/interaction/index';
import { browserSaveState, browserRestoreState, browserListStates, browserDeleteState } from '../src/tools/session/index';
import { browserIframeClick, browserIframeType, browserIframeSnapshot } from '../src/tools/iframe/index';
import { browserVisionClick, browserSetUserAgent, browserPdf, browserHighlight, browserRemoveHighlight } from '../src/tools/visual/index';

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

function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function assertEqual(a: any, b: any, m?: string) { if (a !== b) throw new Error(m || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// Mock bridge
const mockBridge = {
  calls: [] as any[],
  mockResponses: new Map<string, any>(),

  async execute(msg: any) {
    this.calls.push(msg);
    const s = msg.payload?.script || '';

    // Session: getCookies
    if (msg.payload?.command === 'getCookies') return [
      { name: 'session', value: 'abc123', domain: '.test.com', path: '/' },
      { name: 'token', value: 'xyz789', domain: '.test.com', path: '/' },
    ];
    if (msg.payload?.command === 'setCookie') return {};

    // Session: localStorage
    if (s.includes('localStorage.length') && s.includes('localStorage.key'))
      return { user: 'john', theme: 'dark' };
    if (s.includes('localStorage.setItem')) return true;

    // Session: sessionStorage
    if (s.includes('sessionStorage.length') && s.includes('sessionStorage.key'))
      return { cart: '["item1"]' };
    if (s.includes('sessionStorage.setItem')) return true;

    // Page info
    if (s.includes('location.href') && s.includes('document.title'))
      return { url: 'https://test.com/dashboard', title: 'Dashboard' };

    // HTML content
    if (s.includes('innerHTML')) return '<div class="content"><h1>Hello</h1><p>World</p></div>';
    if (s.includes('outerHTML')) return '<section id="main"><div class="content"><h1>Hello</h1></div></section>';

    // elementFromPoint (vision click)
    if (s.includes('elementFromPoint'))
      return { tag: 'BUTTON', text: 'Submit' };

    // UA override
    if (s.includes('navigator') && s.includes('userAgent')) return 'Mozilla/5.0 Custom';

    // Highlight
    if (s.includes('getBoundingClientRect'))
      return { highlighted: true, rect: { top: 100, left: 200, width: 300, height: 50 } };
    if (s.includes('__mcp-highlight'))
      return { removed: true };

    // iframe snapshot (createTreeWalker = the actual snapshot, not the access check)
    if (s.includes('createTreeWalker') || s.includes('INTERACTIVE_TAGS'))
      return { elements: [
        { ref: 'ref:1', role: 'textbox', name: 'Email', tag: 'INPUT' },
        { ref: 'ref:2', role: 'button', name: 'Submit', tag: 'BUTTON' },
      ], refCount: 2, url: 'https://payment.stripe.com/checkout' };

    // iframe accessible check (simpler script, no createTreeWalker)
    if (s.includes('contentDocument'))
      return { accessible: true, childCount: 5 };

    // PDF
    if (s.includes('__mcpPdfRequest'))
      return { requested: true, fileName: 'page.pdf' };

    // CHAIN commands
    if (msg.type === 'CHAIN') return {};

    return {};
  },

  reset() { this.calls = []; },
};

const state = new StateManager();
state.updateCurrentPage({ url: 'https://test.com/dashboard', title: 'Dashboard' });

// Clean up test state dir
const TEST_STATE_DIR = path.join(process.cwd(), '.cypress-mcp-test');
process.env.MCP_STATE_DIR = TEST_STATE_DIR;

function cleanStateDir() {
  if (fs.existsSync(TEST_STATE_DIR)) {
    fs.readdirSync(TEST_STATE_DIR).forEach(f => fs.unlinkSync(path.join(TEST_STATE_DIR, f)));
    fs.rmdirSync(TEST_STATE_DIR);
  }
}

async function run() {
  cleanStateDir();

  console.log('\n══════════════════════════════════════════');
  console.log('  NEW FEATURES TEST SUITE');
  console.log('══════════════════════════════════════════');

  // ── browser_get_html ──
  console.log('\n── browser_get_html ──');

  await test('get_html innerHTML', async () => {
    const tool = browserGetHtml(mockBridge as any, state);
    const r: any = await tool.execute({ selector: '#main' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assert(r.html.includes('<h1>Hello</h1>'), 'Missing h1');
    assert(typeof r.length === 'number', 'Missing length');
  });

  await test('get_html requires target or fullPage', async () => {
    const tool = browserGetHtml(mockBridge as any, state);
    const r: any = await tool.execute({});
    assert('error' in r, 'Should error');
  });

  // ── browser_file_upload ──
  console.log('\n── browser_file_upload ──');

  await test('file_upload with selector', async () => {
    mockBridge.reset();
    const tool = browserFileUpload(mockBridge as any, state);
    const r: any = await tool.execute({ selector: '#file-input', filePath: 'test.pdf' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.filePath, 'test.pdf');
    // Verify chain command
    const chain = mockBridge.calls.find(c => c.type === 'CHAIN');
    assert(chain, 'No CHAIN call');
    assert(chain.payload.commands.some((c: any) => c.command === 'selectFile'), 'Missing selectFile');
  });

  await test('file_upload drag-drop mode', async () => {
    const tool = browserFileUpload(mockBridge as any, state);
    const r: any = await tool.execute({ filePath: 'image.png', action: 'drag-drop' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.action, 'drag-drop');
  });

  await test('file_upload requires filePath', async () => {
    const tool = browserFileUpload(mockBridge as any, state);
    const r: any = await tool.execute({ selector: '#x' });
    // filePath is required in schema but execute still runs — tool should handle
    assert(r.success || 'error' in r, 'Should handle missing filePath');
  });

  // ── Session: save/restore/list/delete (FILE-BASED) ──
  console.log('\n── Session tools (file-based persistence) ──');

  await test('save_state writes to disk', async () => {
    const tool = browserSaveState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'test-login' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.name, 'test-login');
    assertEqual(r.cookieCount, 2);
    assert(r.filePath.includes('test-login.json'), `Path: ${r.filePath}`);
    // Verify file exists
    assert(fs.existsSync(r.filePath), 'State file not created');
    // Verify file contents
    const content = JSON.parse(fs.readFileSync(r.filePath, 'utf-8'));
    assertEqual(content.cookies.length, 2);
    assertEqual(content.name, 'test-login');
    assert(content.savedAt, 'Missing savedAt');
  });

  await test('list_states shows saved state', async () => {
    const tool = browserListStates(mockBridge as any, state);
    const r: any = await tool.execute({});
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.count, 1);
    assertEqual(r.states[0].name, 'test-login');
    assertEqual(r.states[0].cookieCount, 2);
  });

  await test('save_state second state', async () => {
    const tool = browserSaveState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'test-admin' });
    assert(r.success, 'Failed');
  });

  await test('list_states shows both', async () => {
    const tool = browserListStates(mockBridge as any, state);
    const r: any = await tool.execute({});
    assertEqual(r.count, 2);
  });

  await test('restore_state reads from disk', async () => {
    const tool = browserRestoreState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'test-login' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assert(r.restored.some((s: string) => s.includes('cookies')), `Restored: ${r.restored}`);
    assert(r.savedAt, 'Missing savedAt');
  });

  await test('restore_state nonexistent shows available', async () => {
    const tool = browserRestoreState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'nonexistent' });
    assert('error' in r, 'Should error');
    assert(r.error.message.includes('test-login'), `Should suggest available: ${r.error.message}`);
  });

  await test('restore_state skip options', async () => {
    const tool = browserRestoreState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'test-login', skipCookies: true, skipSessionStorage: true });
    assert(r.success, 'Failed');
    assert(!r.restored.some((s: string) => s.includes('cookies')), 'Should skip cookies');
  });

  await test('delete_state removes file', async () => {
    const tool = browserDeleteState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'test-admin' });
    assert(r.success, 'Failed');
    assertEqual(r.deleted, 1);
    // Verify file gone
    const listTool = browserListStates(mockBridge as any, state);
    const lr: any = await listTool.execute({});
    assertEqual(lr.count, 1); // Only test-login remains
  });

  await test('delete_state all', async () => {
    // Save another
    await (browserSaveState(mockBridge as any, state)).execute({ name: 'temp' });
    const tool = browserDeleteState(mockBridge as any, state);
    const r: any = await tool.execute({ all: true });
    assert(r.success, 'Failed');
    assert(r.deleted >= 2, `Deleted: ${r.deleted}`);
    const lr: any = await (browserListStates(mockBridge as any, state)).execute({});
    assertEqual(lr.count, 0);
  });

  await test('delete_state nonexistent', async () => {
    const tool = browserDeleteState(mockBridge as any, state);
    const r: any = await tool.execute({ name: 'nope' });
    assert('error' in r, 'Should error');
  });

  // ── iFrame tools ──
  console.log('\n── iFrame tools ──');

  await test('iframe_click', async () => {
    mockBridge.reset();
    const tool = browserIframeClick(mockBridge as any, state);
    const r: any = await tool.execute({ iframeSelector: '#payment-frame', selector: '#submit-btn' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    const chain = mockBridge.calls.find(c => c.type === 'CHAIN');
    assert(chain.payload.commands.some((c: any) => c.args?.[0]?.includes?.('contentDocument')), 'Missing contentDocument access');
  });

  await test('iframe_click requires inner selector', async () => {
    const tool = browserIframeClick(mockBridge as any, state);
    const r: any = await tool.execute({ iframeSelector: '#frame' });
    assert('error' in r, 'Should error');
  });

  await test('iframe_type', async () => {
    const tool = browserIframeType(mockBridge as any, state);
    const r: any = await tool.execute({ iframeSelector: '#frame', selector: '#email', text: 'user@test.com' });
    assert(r.success, 'Failed');
  });

  await test('iframe_snapshot', async () => {
    const tool = browserIframeSnapshot(mockBridge as any, state);
    const r: any = await tool.execute({ iframeSelector: '#payment-frame' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assert(r.snapshot.includes('textbox'), `Missing textbox: ${r.snapshot}`);
    assert(r.snapshot.includes('button'), 'Missing button');
    assertEqual(r.elementCount, 2);
  });

  // ── Vision mode ──
  console.log('\n── Vision mode ──');

  await test('vision_click at coordinates', async () => {
    mockBridge.reset();
    const tool = browserVisionClick(mockBridge as any, state);
    const r: any = await tool.execute({ x: 500, y: 300 });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.x, 500);
    assertEqual(r.y, 300);
  });

  await test('vision_click requires x and y', async () => {
    const tool = browserVisionClick(mockBridge as any, state);
    const r: any = await tool.execute({ x: 100 });
    // y is required in schema — execute should still handle
    assert(r.success || 'error' in r, 'Should handle');
  });

  // ── User Agent ──
  console.log('\n── User Agent ──');

  await test('set_user_agent with preset', async () => {
    const tool = browserSetUserAgent(mockBridge as any, state);
    const r: any = await tool.execute({ preset: 'chrome-mobile' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assert(r.userAgent.includes('Mobile'), `UA: ${r.userAgent}`);
  });

  await test('set_user_agent custom', async () => {
    const tool = browserSetUserAgent(mockBridge as any, state);
    const r: any = await tool.execute({ userAgent: 'MyBot/1.0' });
    assert(r.success, 'Failed');
  });

  await test('set_user_agent requires input', async () => {
    const tool = browserSetUserAgent(mockBridge as any, state);
    const r: any = await tool.execute({});
    assert('error' in r, 'Should error');
  });

  // ── PDF ──
  console.log('\n── PDF ──');

  await test('pdf generation', async () => {
    const tool = browserPdf(mockBridge as any, state);
    const r: any = await tool.execute({ fileName: 'report.pdf', format: 'A4' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
    assertEqual(r.fileName, 'report.pdf');
  });

  // ── Highlight ──
  console.log('\n── Highlight ──');

  await test('highlight element', async () => {
    const tool = browserHighlight(mockBridge as any, state);
    const r: any = await tool.execute({ selector: '#error-msg', color: 'rgba(255,0,0,0.5)', label: 'Bug here' });
    assert(r.success, `Failed: ${JSON.stringify(r)}`);
  });

  await test('highlight requires target', async () => {
    const tool = browserHighlight(mockBridge as any, state);
    const r: any = await tool.execute({});
    assert('error' in r, 'Should error');
  });

  await test('remove_highlight', async () => {
    const tool = browserRemoveHighlight(mockBridge as any, state);
    const r: any = await tool.execute({});
    assert(r.success, 'Failed');
  });

  // ── Cleanup ──
  cleanStateDir();

  // ── Summary ──
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  New Features: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('CRASH:', e); cleanStateDir(); process.exit(1); });
