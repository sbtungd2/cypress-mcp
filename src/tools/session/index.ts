import { ToolHandler, ToolFactory } from '../types';
import { escapeSelector } from '../utils';
import * as fs from 'fs';
import * as path from 'path';

// Default state file location
const DEFAULT_STATE_DIR = path.join(process.cwd(), '.cypress-mcp');
const DEFAULT_STATE_FILE = 'state.json';

function getStateFilePath(name: string): string {
  const dir = process.env.MCP_STATE_DIR || DEFAULT_STATE_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Sanitize name — only allow alphanumeric, dash, underscore
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dir, `${safeName}.json`);
}

// ═══════════════════════════════════════════
// browser_save_state — Save to disk (persists across sessions)
// ═══════════════════════════════════════════
export const browserSaveState: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_save_state',
  description: 'Save current browser state (cookies, localStorage, sessionStorage) to a file on disk. State persists across MCP server restarts — login once, stay logged in. Use browser_restore_state to restore.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "State name. Default: 'default'. Each name creates a separate file." },
    },
  },
  async execute(params) {
    const { name: stateName = 'default' } = params;

    try {
      // Collect cookies
      const cookies = await bridge.execute({
        type: 'COMMAND',
        payload: { command: 'getCookies', args: [] },
      });

      // Collect localStorage
      const localStorage = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var items = {};
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            items[k] = localStorage.getItem(k);
          }
          return items;
        ` },
      });

      // Collect sessionStorage
      const sessionStorage = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var items = {};
          for (var i = 0; i < sessionStorage.length; i++) {
            var k = sessionStorage.key(i);
            items[k] = sessionStorage.getItem(k);
          }
          return items;
        ` },
      });

      // Get current URL
      const pageInfo = await bridge.execute({
        type: 'EVAL',
        payload: { script: 'return { url: location.href, title: document.title }' },
      }).catch(() => ({ url: state.currentUrl, title: '' }));

      const snapshot = {
        version: 1,
        name: stateName,
        url: pageInfo.url || state.currentUrl,
        cookies: Array.isArray(cookies) ? cookies : [],
        localStorage: localStorage || {},
        sessionStorage: sessionStorage || {},
        savedAt: new Date().toISOString(),
        timestamp: Date.now(),
      };

      // Write to disk
      const filePath = getStateFilePath(stateName);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

      return {
        success: true as const,
        name: stateName,
        filePath,
        cookieCount: snapshot.cookies.length,
        localStorageKeys: Object.keys(snapshot.localStorage).length,
        sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
        savedAt: snapshot.savedAt,
      };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_restore_state — Restore from disk
// ═══════════════════════════════════════════
export const browserRestoreState: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_restore_state',
  description: 'Restore a previously saved browser state from disk. Restores cookies, localStorage, and sessionStorage. Login once with browser_save_state, then browser_restore_state on every new session to skip login.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "State name to restore. Default: 'default'" },
      skipCookies: { type: 'boolean', description: 'Skip restoring cookies. Default: false' },
      skipLocalStorage: { type: 'boolean', description: 'Skip restoring localStorage. Default: false' },
      skipSessionStorage: { type: 'boolean', description: 'Skip restoring sessionStorage. Default: false' },
      navigateToUrl: { type: 'boolean', description: 'Navigate to the URL where state was saved. Default: false' },
    },
  },
  async execute(params) {
    const {
      name: stateName = 'default',
      skipCookies = false,
      skipLocalStorage = false,
      skipSessionStorage = false,
      navigateToUrl = false,
    } = params;

    // Read from disk
    const filePath = getStateFilePath(stateName);
    if (!fs.existsSync(filePath)) {
      // List available states to help user
      const stateDir = path.dirname(filePath);
      let available: string[] = [];
      if (fs.existsSync(stateDir)) {
        available = fs.readdirSync(stateDir)
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''));
      }
      const hint = available.length > 0
        ? ` Available states: ${available.join(', ')}`
        : ' No saved states found. Use browser_save_state first.';
      return { error: { code: 'STORAGE_FAILED', message: `State '${stateName}' not found.${hint}` } };
    }

    let snapshot: any;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      snapshot = JSON.parse(raw);
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: `Failed to read state file: ${err.message}` } };
    }

    const restored: string[] = [];

    try {
      // Restore cookies
      if (!skipCookies && snapshot.cookies?.length > 0) {
        for (const cookie of snapshot.cookies) {
          try {
            await bridge.execute({
              type: 'COMMAND',
              payload: { command: 'setCookie', args: [cookie.name, cookie.value, cookie] },
            });
          } catch { /* skip invalid cookies */ }
        }
        restored.push(`${snapshot.cookies.length} cookies`);
      }

      // Navigate first if needed (cookies require matching domain)
      if (navigateToUrl && snapshot.url) {
        await bridge.execute({
          type: 'COMMAND',
          payload: { command: 'visit', args: [snapshot.url, { failOnStatusCode: false }] },
        });
        restored.push(`navigated to ${snapshot.url}`);
      }

      // Restore localStorage
      if (!skipLocalStorage && snapshot.localStorage && Object.keys(snapshot.localStorage).length > 0) {
        const entries = snapshot.localStorage;
        const script = Object.entries(entries)
          .map(([k, v]) => `localStorage.setItem('${escapeSelector(k)}', '${escapeSelector(String(v))}');`)
          .join('\n');
        await bridge.execute({ type: 'EVAL', payload: { script } });
        restored.push(`${Object.keys(entries).length} localStorage keys`);
      }

      // Restore sessionStorage
      if (!skipSessionStorage && snapshot.sessionStorage && Object.keys(snapshot.sessionStorage).length > 0) {
        const entries = snapshot.sessionStorage;
        const script = Object.entries(entries)
          .map(([k, v]) => `sessionStorage.setItem('${escapeSelector(k)}', '${escapeSelector(String(v))}');`)
          .join('\n');
        await bridge.execute({ type: 'EVAL', payload: { script } });
        restored.push(`${Object.keys(entries).length} sessionStorage keys`);
      }

      return {
        success: true as const,
        name: stateName,
        restored,
        savedAt: snapshot.savedAt,
        originalUrl: snapshot.url,
      };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_list_states — List saved states
// ═══════════════════════════════════════════
export const browserListStates: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_list_states',
  description: 'List all saved browser states on disk. Shows name, saved date, and cookie/storage counts.',
  schema: { type: 'object', properties: {} },
  async execute() {
    const stateDir = process.env.MCP_STATE_DIR || DEFAULT_STATE_DIR;
    if (!fs.existsSync(stateDir)) {
      return { success: true as const, states: [], count: 0 };
    }

    const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    const states = files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(stateDir, f), 'utf-8');
        const data = JSON.parse(raw);
        return {
          name: data.name || f.replace('.json', ''),
          savedAt: data.savedAt,
          url: data.url,
          cookieCount: data.cookies?.length || 0,
          localStorageKeys: data.localStorage ? Object.keys(data.localStorage).length : 0,
        };
      } catch {
        return { name: f.replace('.json', ''), savedAt: 'unknown', url: '', cookieCount: 0, localStorageKeys: 0 };
      }
    });

    return { success: true as const, states, count: states.length, stateDir };
  },
});

// ═══════════════════════════════════════════
// browser_delete_state — Delete a saved state
// ═══════════════════════════════════════════
export const browserDeleteState: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_delete_state',
  description: 'Delete a saved browser state from disk.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'State name to delete' },
      all: { type: 'boolean', description: 'Delete ALL saved states. Default: false' },
    },
  },
  async execute(params) {
    const { name: stateName, all = false } = params;

    try {
      if (all) {
        const stateDir = process.env.MCP_STATE_DIR || DEFAULT_STATE_DIR;
        if (fs.existsSync(stateDir)) {
          const files = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
          for (const f of files) fs.unlinkSync(path.join(stateDir, f));
          return { success: true as const, deleted: files.length };
        }
        return { success: true as const, deleted: 0 };
      }

      if (!stateName) {
        return { error: { code: 'STORAGE_FAILED', message: 'Provide a state name or use all=true' } };
      }

      const filePath = getStateFilePath(stateName);
      if (!fs.existsSync(filePath)) {
        return { error: { code: 'STORAGE_FAILED', message: `State '${stateName}' not found` } };
      }

      fs.unlinkSync(filePath);
      return { success: true as const, deleted: 1, name: stateName };
    } catch (err: any) {
      return { error: { code: 'STORAGE_FAILED', message: err.message } };
    }
  },
});
