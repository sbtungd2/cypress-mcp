import { ToolHandler, ToolFactory } from '../types';

// ═══════════════════════════════════════════
// 27. browser_list_tabs [P2]
// ═══════════════════════════════════════════
export const browserListTabs: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_list_tabs',
  description: 'List open browser tabs. Note: Cypress runs in a single tab — this provides emulated multi-tab via state tracking.',
  schema: { type: 'object', properties: {} },
  async execute() {
    const info = await bridge.execute({
      type: 'EVAL',
      payload: { script: 'return { url: location.href, title: document.title }' },
    }).catch(() => ({ url: state.currentUrl, title: state.currentTitle }));

    if (state.tabState.size === 0) {
      state.tabState.set('tab_0', { url: info.url, title: info.title, active: true });
    } else {
      // Update active tab
      for (const [id, tab] of state.tabState) {
        if (tab.active) { tab.url = info.url; tab.title = info.title; }
      }
    }

    const tabs = Array.from(state.tabState.entries()).map(([id, t]) => ({ id, ...t }));
    return { success: true as const, tabs, activeTab: tabs.find(t => t.active)?.id || 'tab_0' };
  },
});

// ═══════════════════════════════════════════
// 28. browser_new_tab [P2]
// ═══════════════════════════════════════════
export const browserNewTab: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_new_tab',
  description: 'Open a new tab (emulated — actually navigates in same tab due to Cypress limitation).',
  schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL for the new tab' } },
  },
  async execute(params) {
    const { url } = params;
    const tabId = `tab_${state.tabState.size}`;

    // Deactivate current
    for (const [, tab] of state.tabState) tab.active = false;

    if (url) {
      await bridge.execute({ type: 'COMMAND', payload: { command: 'visit', args: [url, { failOnStatusCode: false }] } });
    }

    state.tabState.set(tabId, { url: url || 'about:blank', title: '', active: true });
    return { success: true as const, tabId };
  },
});

// ═══════════════════════════════════════════
// 29. browser_switch_tab [P2]
// ═══════════════════════════════════════════
export const browserSwitchTab: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_switch_tab',
  description: 'Switch to another tab (emulated).',
  schema: {
    type: 'object',
    properties: { tabId: { type: 'string' } },
    required: ['tabId'],
  },
  async execute(params) {
    const { tabId } = params;
    const tab = state.tabState.get(tabId);
    if (!tab) return { error: { code: 'MULTI_TAB_UNSUPPORTED', message: `Tab ${tabId} not found` } };

    for (const [, t] of state.tabState) t.active = false;
    tab.active = true;

    if (tab.url && tab.url !== 'about:blank') {
      await bridge.execute({ type: 'COMMAND', payload: { command: 'visit', args: [tab.url, { failOnStatusCode: false }] } });
    }

    return { success: true as const, tabId, url: tab.url };
  },
});

// ═══════════════════════════════════════════
// 30. browser_close_tab [P2]
// ═══════════════════════════════════════════
export const browserCloseTab: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_close_tab',
  description: 'Close a tab (emulated).',
  schema: {
    type: 'object',
    properties: { tabId: { type: 'string', description: 'Tab ID to close. Closes current if empty.' } },
  },
  async execute(params) {
    const { tabId } = params;
    const id = tabId || Array.from(state.tabState.entries()).find(([, t]) => t.active)?.[0];
    if (!id || !state.tabState.has(id)) return { error: { code: 'MULTI_TAB_UNSUPPORTED', message: 'Tab not found' } };

    state.tabState.delete(id);
    // Activate first remaining tab
    if (state.tabState.size > 0) {
      const first = state.tabState.entries().next().value;
      if (first) first[1].active = true;
    }

    return { success: true as const };
  },
});
