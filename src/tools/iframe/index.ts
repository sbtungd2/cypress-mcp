import { ToolHandler, ToolFactory } from '../types';
import { resolveTarget, escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// browser_iframe_click [P1] — Click inside iframe
// ═══════════════════════════════════════════
export const browserIframeClick: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_iframe_click',
  description: 'Click an element inside an iframe. First specify the iframe selector, then the element inside it.',
  schema: {
    type: 'object',
    properties: {
      iframeSelector: { type: 'string', description: 'CSS selector for the iframe element' },
      ref: { type: 'string', description: 'Element ref inside iframe' },
      selector: { type: 'string', description: 'CSS selector for element inside iframe' },
      force: { type: 'boolean', description: 'Force click. Default: false' },
    },
    required: ['iframeSelector'],
  },
  async execute(params) {
    const { iframeSelector, ref, selector, force = false } = params;
    const innerTarget = resolveTarget({ ref, selector });
    if (!innerTarget) return { error: { code: 'INVALID_SELECTOR', message: 'ref or selector for inner element required' } };

    try {
      const commands: any[] = [
        { command: 'get', args: [iframeSelector] },
        { command: 'its', args: ['0.contentDocument.body'] },
        { command: 'should', args: ['not.be.empty'] },
        { command: 'find', args: [innerTarget] },
        { command: 'click', args: force ? [{ force: true }] : [] },
      ];

      await bridge.execute({ type: 'CHAIN', payload: { commands } });
      return { success: true as const, iframe: iframeSelector, target: innerTarget };
    } catch (err: any) {
      return { error: { code: 'CLICK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_iframe_type [P1] — Type inside iframe
// ═══════════════════════════════════════════
export const browserIframeType: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_iframe_type',
  description: 'Type text into an element inside an iframe.',
  schema: {
    type: 'object',
    properties: {
      iframeSelector: { type: 'string', description: 'CSS selector for the iframe element' },
      ref: { type: 'string' }, selector: { type: 'string' },
      text: { type: 'string', description: 'Text to type' },
      clearBefore: { type: 'boolean', description: 'Clear field first. Default: false' },
    },
    required: ['iframeSelector', 'text'],
  },
  async execute(params) {
    const { iframeSelector, ref, selector, text, clearBefore = false } = params;
    const innerTarget = resolveTarget({ ref, selector });
    if (!innerTarget) return { error: { code: 'INVALID_SELECTOR', message: 'ref or selector required' } };

    try {
      const commands: any[] = [
        { command: 'get', args: [iframeSelector] },
        { command: 'its', args: ['0.contentDocument.body'] },
        { command: 'should', args: ['not.be.empty'] },
        { command: 'find', args: [innerTarget] },
      ];
      if (clearBefore) commands.push({ command: 'clear', args: [] });
      commands.push({ command: 'type', args: [text] });

      await bridge.execute({ type: 'CHAIN', payload: { commands } });
      return { success: true as const, iframe: iframeSelector, target: innerTarget };
    } catch (err: any) {
      return { error: { code: 'TYPE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_iframe_snapshot [P1] — Snapshot inside iframe
// ═══════════════════════════════════════════
export const browserIframeSnapshot: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_iframe_snapshot',
  description: 'Take an accessibility snapshot of content inside an iframe. Returns YAML tree like browser_snapshot but scoped to iframe content.',
  schema: {
    type: 'object',
    properties: {
      iframeSelector: { type: 'string', description: 'CSS selector for the iframe element' },
    },
    required: ['iframeSelector'],
  },
  async execute(params) {
    const { iframeSelector } = params;

    try {
      // Get iframe body HTML length first to verify access
      const accessible = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var iframe = document.querySelector('${escapeSelector(iframeSelector)}');
          if (!iframe) return { error: 'iframe not found' };
          try {
            var body = iframe.contentDocument.body;
            return body ? { accessible: true, childCount: body.children.length } : { error: 'iframe body empty' };
          } catch(e) {
            return { error: 'Cross-origin iframe — cannot access content: ' + e.message };
          }
        ` },
      });

      if (accessible?.error) {
        return { error: { code: 'SNAPSHOT_FAILED', message: accessible.error } };
      }

      // Run snapshot inside iframe context
      const result = await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [
          { command: 'get', args: [iframeSelector] },
          { command: 'its', args: ['0.contentDocument.body'] },
          { command: 'should', args: ['not.be.empty'] },
          // Note: cy.within() on iframe body, then we can query elements
        ] },
      });

      // Use EVAL to run snapshotter inside iframe
      const snapshot = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var iframe = document.querySelector('${escapeSelector(iframeSelector)}');
          var body = iframe.contentDocument.body;
          // Simplified snapshot for iframe — list interactive elements
          var results = [];
          var refCounter = 0;
          var INTERACTIVE_TAGS = { A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' };
          var walker = document.createTreeWalker ? iframe.contentDocument.createTreeWalker(body, NodeFilter.SHOW_ELEMENT) : null;
          if (walker) {
            while (walker.nextNode()) {
              var el = walker.currentNode;
              var role = el.getAttribute('role') || INTERACTIVE_TAGS[el.tagName] || null;
              if (role || ['H1','H2','H3','H4','H5','H6'].indexOf(el.tagName) !== -1) {
                var ref = INTERACTIVE_TAGS[el.tagName] ? 'ref:' + (++refCounter) : '';
                if (ref) el.setAttribute('data-mcp-ref', ref);
                var name = el.getAttribute('aria-label') || el.textContent.trim().substring(0,80) || el.placeholder || '';
                results.push({ ref: ref, role: role || 'heading', name: name, tag: el.tagName });
              }
            }
          }
          return { elements: results, refCount: refCounter, url: iframe.src || '' };
        ` },
      });

      // Format as YAML
      const yaml = (snapshot.elements || []).map((e: any) => {
        let line = `- ${e.role}`;
        if (e.name) line += ` "${e.name}"`;
        if (e.ref) line += ` [${e.ref}]`;
        return line;
      }).join('\n');

      return {
        success: true as const,
        snapshot: yaml,
        elementCount: snapshot.refCount || 0,
        iframeUrl: snapshot.url || '',
      };
    } catch (err: any) {
      return { error: { code: 'SNAPSHOT_FAILED', message: err.message } };
    }
  },
});
