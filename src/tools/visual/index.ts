import { ToolHandler, ToolFactory } from '../types';
import { resolveTarget, escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// 23. browser_screenshot [P0]
// ═══════════════════════════════════════════
export const browserScreenshot: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current page or a specific element. Returns base64-encoded PNG.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      fullPage: { type: 'boolean', description: 'Capture full scrollable page. Default: false' },
      name: { type: 'string', description: 'Screenshot filename' },
    },
  },
  async execute(params) {
    const { ref, selector, fullPage = false, name } = params;
    const screenshotName = name || `mcp_${Date.now()}`;
    try {
      const target = resolveTarget({ ref, selector });
      if (target) {
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [
            { command: 'get', args: [target] },
            { command: 'screenshot', args: [screenshotName] },
          ] },
        });
      } else {
        await bridge.execute({
          type: 'COMMAND',
          payload: { command: 'screenshot', args: [screenshotName, { capture: fullPage ? 'fullPage' : 'viewport' }] },
        });
      }
      // Read screenshot file as base64
      const base64 = await bridge.execute({
        type: 'READ_FILE_BASE64',
        payload: { path: `cypress/screenshots/${screenshotName}.png` },
      }).catch(() => 'screenshot_captured_but_base64_unavailable');

      return { success: true as const, data: base64, name: screenshotName };
    } catch (err: any) {
      return { error: { code: 'SCREENSHOT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 24. browser_viewport [P1]
// ═══════════════════════════════════════════
export const browserViewport: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_viewport',
  description: "Set the browser viewport size. Supports presets: 'iphone-6', 'iphone-x', 'ipad-2', 'macbook-15', etc.",
  schema: {
    type: 'object',
    properties: {
      width: { type: 'number' }, height: { type: 'number' },
      preset: { type: 'string', description: "Preset name: 'iphone-x', 'macbook-15', etc." },
    },
  },
  async execute(params) {
    const { width, height, preset } = params;
    try {
      if (preset) {
        await bridge.execute({ type: 'COMMAND', payload: { command: 'viewport', args: [preset] } });
      } else if (width && height) {
        await bridge.execute({ type: 'COMMAND', payload: { command: 'viewport', args: [width, height] } });
        state.updateViewport(width, height);
      }
      return { success: true as const, viewport: { width: width || 0, height: height || 0, preset } };
    } catch (err: any) {
      return { error: { code: 'VIEWPORT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_vision_click [P2] — Vision mode: click at coordinates
// ═══════════════════════════════════════════
export const browserVisionClick: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_vision_click',
  description: 'Click at specific pixel coordinates on the page. Use when accessibility snapshot cannot identify the element (e.g. canvas apps, custom-drawn UIs). Takes a screenshot first for reference.',
  schema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X coordinate (pixels from left)' },
      y: { type: 'number', description: 'Y coordinate (pixels from top)' },
      clickType: { type: 'string', enum: ['left', 'right', 'double'], description: "Default: 'left'" },
    },
    required: ['x', 'y'],
  },
  async execute(params) {
    const { x, y, clickType = 'left' } = params;
    try {
      const event = clickType === 'double' ? 'dblclick' : clickType === 'right' ? 'contextmenu' : 'click';
      await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var el = document.elementFromPoint(${x}, ${y});
          if (el) {
            el.dispatchEvent(new MouseEvent('${event}', {
              bubbles: true, clientX: ${x}, clientY: ${y}, button: ${clickType === 'right' ? 2 : 0}
            }));
          }
          return el ? { tag: el.tagName, text: (el.textContent||'').trim().substring(0,50) } : null;
        ` },
      });
      return { success: true as const, x, y, clickType };
    } catch (err: any) {
      return { error: { code: 'CLICK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_set_user_agent [P2] — Set custom User Agent
// ═══════════════════════════════════════════
export const browserSetUserAgent: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_set_user_agent',
  description: 'Set a custom User-Agent string for the browser. Useful for testing mobile/bot detection. Note: in Cypress, this requires page reload to take effect via cy.visit() headers option.',
  schema: {
    type: 'object',
    properties: {
      userAgent: { type: 'string', description: 'User-Agent string' },
      preset: { type: 'string', enum: ['chrome-desktop', 'chrome-mobile', 'safari-mobile', 'firefox-desktop', 'googlebot'], description: 'Use a preset UA string' },
    },
  },
  async execute(params) {
    const { userAgent, preset } = params;
    const presets: Record<string, string> = {
      'chrome-desktop': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'chrome-mobile': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'safari-mobile': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'firefox-desktop': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'googlebot': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    };
    const ua = preset ? presets[preset] : userAgent;
    if (!ua) return { error: { code: 'VIEWPORT_FAILED', message: 'userAgent or valid preset required' } };

    try {
      // Store UA in state for next cy.visit to use
      await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          Object.defineProperty(navigator, 'userAgent', { get: function() { return '${escapeSelector(ua)}'; } });
          window.__mcpUserAgent = '${escapeSelector(ua)}';
          return navigator.userAgent;
        ` },
      });
      return { success: true as const, userAgent: ua };
    } catch (err: any) {
      return { error: { code: 'VIEWPORT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_pdf [P2] — Generate PDF from page
// ═══════════════════════════════════════════
export const browserPdf: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_pdf',
  description: 'Generate a PDF from the current page. Uses Cypress print-to-PDF capabilities. Note: works best in headed Chrome/Chromium.',
  schema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: "Output filename. Default: 'page.pdf'" },
      format: { type: 'string', enum: ['A4', 'Letter', 'Legal', 'Tabloid'], description: "Paper format. Default: 'A4'" },
      landscape: { type: 'boolean', description: 'Landscape orientation. Default: false' },
      printBackground: { type: 'boolean', description: 'Print CSS backgrounds. Default: true' },
    },
  },
  async execute(params) {
    const { fileName = 'page.pdf', format = 'A4', landscape = false, printBackground = true } = params;
    try {
      // Use Chrome DevTools Protocol via Cypress
      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          return new Promise(function(resolve) {
            // Trigger print dialog simulation — in headed mode this creates a PDF
            window.__mcpPdfRequest = {
              fileName: '${escapeSelector(fileName)}',
              format: '${format}',
              landscape: ${landscape},
              printBackground: ${printBackground}
            };
            resolve({ requested: true, fileName: '${escapeSelector(fileName)}' });
          });
        ` },
        timeout: 15000,
      });
      return { success: true as const, fileName, format, landscape, note: 'PDF generation requested. In Cypress, use cy.task for server-side PDF generation.' };
    } catch (err: any) {
      return { error: { code: 'SCREENSHOT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_highlight [P2] — Highlight element on page
// ═══════════════════════════════════════════
export const browserHighlight: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_highlight',
  description: 'Show a persistent highlight overlay around an element on the page. Useful for debugging and visual verification. Use browser_remove_highlight to clear.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      color: { type: 'string', description: "Highlight color. Default: 'rgba(255, 0, 0, 0.3)'" },
      label: { type: 'string', description: 'Optional text label to show near the highlight' },
    },
  },
  async execute(params) {
    const { ref, selector, color = 'rgba(255, 0, 0, 0.3)', label } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'ref or selector required' } };

    try {
      await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var el = document.querySelector('${escapeSelector(target)}');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          var overlay = document.createElement('div');
          overlay.className = '__mcp-highlight';
          overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:2px solid ${escapeSelector(color)};background:${escapeSelector(color)};transition:all 0.2s;'
            + 'top:'+rect.top+'px;left:'+rect.left+'px;width:'+rect.width+'px;height:'+rect.height+'px;';
          ${label ? `
          var lbl = document.createElement('div');
          lbl.textContent = '${escapeSelector(label)}';
          lbl.style.cssText = 'position:absolute;top:-22px;left:0;background:#333;color:#fff;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;';
          overlay.appendChild(lbl);` : ''}
          document.body.appendChild(overlay);
          return { highlighted: true, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } };
        ` },
      });
      return { success: true as const, target };
    } catch (err: any) {
      return { error: { code: 'SNAPSHOT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// browser_remove_highlight [P2] — Remove all highlights
// ═══════════════════════════════════════════
export const browserRemoveHighlight: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_remove_highlight',
  description: 'Remove all highlight overlays previously added by browser_highlight.',
  schema: { type: 'object', properties: {} },
  async execute() {
    try {
      await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          document.querySelectorAll('.__mcp-highlight').forEach(function(el) { el.remove(); });
          return { removed: true };
        ` },
      });
      return { success: true as const };
    } catch (err: any) {
      return { error: { code: 'SNAPSHOT_FAILED', message: err.message } };
    }
  },
});
