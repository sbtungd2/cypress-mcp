import { ToolHandler, ToolFactory } from '../types';
import { escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// 31. browser_get_cookies [P1]
// ═══════════════════════════════════════════
export const browserGetCookies: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_get_cookies',
  description: 'Get browser cookies. Optionally filter by name or domain.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Filter by cookie name' },
      domain: { type: 'string', description: 'Filter by domain' },
    },
  },
  async execute(params) {
    const { name, domain } = params;
    try {
      const cookies = await bridge.execute({
        type: 'COMMAND',
        payload: { command: 'getCookies', args: [] },
      });

      let result = Array.isArray(cookies) ? cookies : [];
      if (name) result = result.filter((c: any) => c.name === name);
      if (domain) result = result.filter((c: any) => c.domain?.includes(domain));

      return {
        success: true as const,
        count: result.length,
        cookies: result.map((c: any) => ({
          name: c.name, value: c.value, domain: c.domain,
          path: c.path, secure: c.secure, httpOnly: c.httpOnly,
          expiry: c.expiry,
        })),
      };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 32. browser_set_cookie [P1]
// ═══════════════════════════════════════════
export const browserSetCookie: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_set_cookie',
  description: 'Set a browser cookie.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: { type: 'string' },
      domain: { type: 'string' },
      path: { type: 'string', description: "Default: '/'" },
      secure: { type: 'boolean' },
      httpOnly: { type: 'boolean' },
      expiry: { type: 'number', description: 'Expiry as Unix timestamp' },
    },
    required: ['name', 'value'],
  },
  async execute(params) {
    const { name, value, domain, path = '/', secure, httpOnly, expiry } = params;
    try {
      const cookie: any = { name, value, path };
      if (domain) cookie.domain = domain;
      if (secure !== undefined) cookie.secure = secure;
      if (httpOnly !== undefined) cookie.httpOnly = httpOnly;
      if (expiry) cookie.expiry = expiry;

      await bridge.execute({
        type: 'COMMAND',
        payload: { command: 'setCookie', args: [name, value, cookie] },
      });
      return { success: true as const, cookie: { name, value, domain, path } };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 33. browser_clear_cookies [P2]
// ═══════════════════════════════════════════
export const browserClearCookies: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_clear_cookies',
  description: 'Clear all cookies or a specific cookie by name.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Specific cookie to clear. Omit to clear all.' },
    },
  },
  async execute(params) {
    const { name } = params;
    try {
      if (name) {
        await bridge.execute({ type: 'COMMAND', payload: { command: 'clearCookie', args: [name] } });
      } else {
        await bridge.execute({ type: 'COMMAND', payload: { command: 'clearCookies', args: [] } });
      }
      return { success: true as const };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 34. browser_local_storage [P1]
// ═══════════════════════════════════════════
export const browserLocalStorage: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_local_storage',
  description: 'Get, set, or delete localStorage entries.',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set', 'delete', 'clear', 'list'], description: "Default: 'get'" },
      key: { type: 'string', description: 'Storage key' },
      value: { type: 'string', description: 'Value for set action' },
    },
    required: ['action'],
  },
  async execute(params) {
    const { action, key, value } = params;
    try {
      let script: string;
      switch (action) {
        case 'get':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required for get' } };
          script = `var v = localStorage.getItem('${escapeSelector(key)}'); try { return JSON.parse(v); } catch { return v; }`;
          break;
        case 'set':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required for set' } };
          script = `localStorage.setItem('${escapeSelector(key)}', '${escapeSelector(value || '')}'); return true;`;
          break;
        case 'delete':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required for delete' } };
          script = `localStorage.removeItem('${escapeSelector(key)}'); return true;`;
          break;
        case 'clear':
          script = 'localStorage.clear(); return true;';
          break;
        case 'list':
          script = `var items = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); items[k] = localStorage.getItem(k); } return { count: localStorage.length, items: items };`;
          break;
        default:
          return { error: { code: 'STORAGE_FAILED', message: `Unknown action: ${action}` } };
      }

      const result = await bridge.execute({ type: 'EVAL', payload: { script } });
      return { success: true as const, result };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 35. browser_session_storage [P2]
// ═══════════════════════════════════════════
export const browserSessionStorage: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_session_storage',
  description: 'Get, set, or delete sessionStorage entries.',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set', 'delete', 'clear', 'list'] },
      key: { type: 'string' },
      value: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(params) {
    const { action, key, value } = params;
    try {
      let script: string;
      switch (action) {
        case 'get':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required' } };
          script = `var v = sessionStorage.getItem('${escapeSelector(key)}'); try { return JSON.parse(v); } catch { return v; }`;
          break;
        case 'set':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required' } };
          script = `sessionStorage.setItem('${escapeSelector(key)}', '${escapeSelector(value || '')}'); return true;`;
          break;
        case 'delete':
          if (!key) return { error: { code: 'INVALID_KEY', message: 'Key required' } };
          script = `sessionStorage.removeItem('${escapeSelector(key)}'); return true;`;
          break;
        case 'clear':
          script = 'sessionStorage.clear(); return true;';
          break;
        case 'list':
          script = `var items = {}; for (var i = 0; i < sessionStorage.length; i++) { var k = sessionStorage.key(i); items[k] = sessionStorage.getItem(k); } return { count: sessionStorage.length, items: items };`;
          break;
        default:
          return { error: { code: 'STORAGE_FAILED', message: `Unknown action: ${action}` } };
      }

      const result = await bridge.execute({ type: 'EVAL', payload: { script } });
      return { success: true as const, result };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});
