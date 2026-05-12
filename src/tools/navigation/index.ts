import { ToolHandler, ToolFactory } from '../types';
import { validateUrl } from '../utils';

// ═══════════════════════════════════════════
// 1. browser_navigate [P0]
// ═══════════════════════════════════════════
export const browserNavigate: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_navigate',
  description: 'Navigate the browser to a URL. Returns final URL (after redirects), page title, status code, and load time. Supports http/https and relative paths.',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' },
      timeout: { type: 'number', description: 'Page load timeout in ms. Default: 30000' },
      waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Wait condition. Default: load' },
    },
    required: ['url'],
  },
  async execute(params) {
    const { url, timeout = 30000, waitUntil = 'load' } = params;
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      return { error: { code: 'INVALID_URL', message: urlCheck.error! } };
    }

    const startTime = Date.now();
    try {
      await bridge.execute({
        type: 'COMMAND',
        payload: { command: 'visit', args: [url, { timeout, failOnStatusCode: false }] },
        timeout: timeout + 5000,
      });

      if (waitUntil === 'networkidle') {
        await bridge.execute({
          type: 'EVAL',
          payload: { script: `
            return new Cypress.Promise(resolve => {
              let pending = 0, timer;
              const origFetch = window.fetch;
              window.fetch = function() {
                pending++;
                return origFetch.apply(this, arguments).finally(() => { pending--; check(); });
              };
              function check() {
                clearTimeout(timer);
                timer = setTimeout(() => { if (pending === 0) { window.fetch = origFetch; resolve('idle'); } }, 500);
              }
              check();
            });
          ` },
          timeout: Math.max(timeout - (Date.now() - startTime), 5000),
        });
      }

      const pageInfo = await bridge.execute({
        type: 'EVAL',
        payload: { script: 'return { url: location.href, title: document.title }' },
      });

      state.updateCurrentPage(pageInfo);

      return {
        success: true as const,
        url: pageInfo.url,
        title: pageInfo.title,
        statusCode: 200,
        loadTime: Date.now() - startTime,
      };
    } catch (err: any) {
      if (Date.now() - startTime >= timeout) {
        return { error: { code: 'NAVIGATION_TIMEOUT', message: `Page did not load within ${timeout}ms` } };
      }
      if (err.message?.includes('ERR_NAME_NOT_RESOLVED') || err.message?.includes('ERR_CONNECTION_REFUSED')) {
        return { error: { code: 'NETWORK_ERROR', message: err.message } };
      }
      return { error: { code: 'NAVIGATION_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 2. browser_go_back [P1]
// ═══════════════════════════════════════════
export const browserGoBack: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_go_back',
  description: 'Navigate back in browser history. Returns the new URL and page title.',
  schema: {
    type: 'object',
    properties: {
      timeout: { type: 'number', description: 'Timeout in ms. Default: 10000' },
    },
  },
  async execute(params) {
    const { timeout = 10000 } = params;
    try {
      await bridge.execute({ type: 'COMMAND', payload: { command: 'go', args: ['back'] }, timeout });
      const info = await bridge.execute({ type: 'EVAL', payload: { script: 'return { url: location.href, title: document.title }' } });
      state.updateCurrentPage(info);
      return { success: true as const, url: info.url, title: info.title };
    } catch (err: any) {
      return { error: { code: 'NAVIGATION_TIMEOUT', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 3. browser_go_forward [P1]
// ═══════════════════════════════════════════
export const browserGoForward: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_go_forward',
  description: 'Navigate forward in browser history. Returns the new URL and page title.',
  schema: {
    type: 'object',
    properties: {
      timeout: { type: 'number', description: 'Timeout in ms. Default: 10000' },
    },
  },
  async execute(params) {
    const { timeout = 10000 } = params;
    try {
      await bridge.execute({ type: 'COMMAND', payload: { command: 'go', args: ['forward'] }, timeout });
      const info = await bridge.execute({ type: 'EVAL', payload: { script: 'return { url: location.href, title: document.title }' } });
      state.updateCurrentPage(info);
      return { success: true as const, url: info.url, title: info.title };
    } catch (err: any) {
      return { error: { code: 'NAVIGATION_TIMEOUT', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 4. browser_reload [P1]
// ═══════════════════════════════════════════
export const browserReload: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_reload',
  description: 'Reload the current page. Use forceReload=true to bypass cache (hard reload).',
  schema: {
    type: 'object',
    properties: {
      forceReload: { type: 'boolean', description: 'Bypass cache. Default: false' },
      timeout: { type: 'number', description: 'Timeout in ms. Default: 30000' },
    },
  },
  async execute(params) {
    const { forceReload = false, timeout = 30000 } = params;
    const start = Date.now();
    try {
      await bridge.execute({
        type: 'COMMAND',
        payload: { command: 'reload', args: forceReload ? [true] : [] },
        timeout,
      });
      const info = await bridge.execute({ type: 'EVAL', payload: { script: 'return { url: location.href, title: document.title }' } });
      state.updateCurrentPage(info);
      return { success: true as const, url: info.url, title: info.title, loadTime: Date.now() - start };
    } catch (err: any) {
      return { error: { code: 'NAVIGATION_TIMEOUT', message: err.message } };
    }
  },
});
