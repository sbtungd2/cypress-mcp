import { ToolHandler, ToolFactory } from '../types';
import { resolveTarget, escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// 5. browser_click [P0]
// ═══════════════════════════════════════════
export const browserClick: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_click',
  description: "Click an element on the page. Use 'ref' from a snapshot for reliable targeting, or 'selector' as CSS fallback. Supports left/right/double click, modifier keys, and force click.",
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: "Element reference from snapshot (e.g. 'ref:14')" },
      selector: { type: 'string', description: 'CSS selector fallback' },
      clickType: { type: 'string', enum: ['left', 'right', 'double'], description: "Click type. Default: 'left'" },
      force: { type: 'boolean', description: 'Force click even if covered. Default: false' },
      position: { type: 'string', enum: ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] },
      modifiers: { type: 'array', items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] } },
    },
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector, clickType = 'left', force = false, position, modifiers } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      // Get URL before click to detect navigation
      const urlBefore = await bridge.execute({ type: 'EVAL', payload: { script: 'return location.href' } });

      const clickOpts: any = {};
      if (force) clickOpts.force = true;
      if (position) clickOpts.position = position;
      if (modifiers?.length) {
        if (modifiers.includes('ctrl')) clickOpts.ctrlKey = true;
        if (modifiers.includes('alt')) clickOpts.altKey = true;
        if (modifiers.includes('shift')) clickOpts.shiftKey = true;
        if (modifiers.includes('meta')) clickOpts.metaKey = true;
      }

      const cmd = clickType === 'double' ? 'dblclick' : clickType === 'right' ? 'rightclick' : 'click';
      await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [
          { command: 'get', args: [target, { timeout: 10000 }] },
          { command: cmd, args: Object.keys(clickOpts).length ? [clickOpts] : [] },
        ] },
      });

      const elementInfo = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var el = document.querySelector('${escapeSelector(target)}');
          return el ? { tagName: el.tagName, text: (el.textContent||'').trim().substring(0,100), role: el.getAttribute('role')||el.tagName.toLowerCase() } : null;
        ` },
      });

      const urlAfter = await bridge.execute({ type: 'EVAL', payload: { script: 'return location.href' } });
      const navigationOccurred = urlAfter !== urlBefore;
      if (navigationOccurred) state.updateCurrentPage({ url: urlAfter, title: '' });

      return {
        success: true as const,
        elementInfo: elementInfo || { tagName: 'UNKNOWN', text: '', role: 'unknown' },
        navigationOccurred,
        ...(navigationOccurred ? { newUrl: urlAfter } : {}),
      };
    } catch (err: any) {
      if (err.message?.includes('Expected to find') || err.message?.includes('not found'))
        return { error: { code: 'ELEMENT_NOT_FOUND', message: `Element ${target} not found` } };
      if (err.message?.includes('not visible'))
        return { error: { code: 'ELEMENT_NOT_VISIBLE', message: `Element ${target} is not visible` } };
      if (err.message?.includes('covered'))
        return { error: { code: 'ELEMENT_COVERED', message: 'Element is covered. Use force=true.' } };
      return { error: { code: 'CLICK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 6. browser_type [P0]
// ═══════════════════════════════════════════
export const browserType: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_type',
  description: 'Type text into an input/textarea element. Simulates real keystrokes. Use clearBefore=true to replace existing content. Use pressEnter=true to submit forms.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      text: { type: 'string', description: 'Text to type' },
      clearBefore: { type: 'boolean', description: 'Clear field first. Default: false' },
      delay: { type: 'number', description: 'Delay between keystrokes (ms). Default: 0' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing. Default: false' },
    },
    required: ['text'],
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector, text, clearBefore = false, delay = 0, pressEnter = false } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      const commands: any[] = [{ command: 'get', args: [target, { timeout: 10000 }] }];
      if (clearBefore) commands.push({ command: 'clear', args: [] });

      let typeText = text;
      if (pressEnter) typeText += '{enter}';
      const typeOpts: any = {};
      if (delay > 0) typeOpts.delay = delay;
      commands.push({ command: 'type', args: [typeText, typeOpts] });

      await bridge.execute({ type: 'CHAIN', payload: { commands } });

      const currentValue = await bridge.execute({
        type: 'EVAL',
        payload: { script: `var el = document.querySelector('${escapeSelector(target)}'); return el ? (el.value||el.textContent||'') : '';` },
      });

      return { success: true as const, currentValue };
    } catch (err: any) {
      if (err.message?.includes('not found')) return { error: { code: 'ELEMENT_NOT_FOUND', message: err.message } };
      if (err.message?.includes('not a typeable')) return { error: { code: 'ELEMENT_NOT_TYPEABLE', message: 'Element is not typeable' } };
      return { error: { code: 'TYPE_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 7. browser_fill [P1]
// ═══════════════════════════════════════════
export const browserFill: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_fill',
  description: 'Set the value of an input field directly (no keystroke simulation). Faster than browser_type but may not trigger all event listeners.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      value: { type: 'string', description: 'Value to set' },
    },
    required: ['value'],
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector, value } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [
          { command: 'get', args: [target] },
          { command: 'invoke', args: ['val', value] },
          { command: 'trigger', args: ['input'] },
          { command: 'trigger', args: ['change'] },
        ] },
      });
      return { success: true as const, currentValue: value };
    } catch (err: any) {
      return { error: { code: 'FILL_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 8. browser_select [P1]
// ═══════════════════════════════════════════
export const browserSelect: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_select',
  description: 'Select option(s) in a <select> dropdown by value or label. For multi-select, pass an array.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      value: { description: 'Option value(s) to select' },
      byLabel: { type: 'boolean', description: 'Match by visible text. Default: false' },
    },
    required: ['value'],
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector, value } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [
          { command: 'get', args: [target] },
          { command: 'select', args: [value] },
        ] },
      });

      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var el = document.querySelector('${escapeSelector(target)}');
          if (!el) return null;
          var opts = Array.from(el.selectedOptions);
          return { selectedValues: opts.map(o=>o.value), selectedLabels: opts.map(o=>o.text) };
        ` },
      });

      return { success: true as const, ...result };
    } catch (err: any) {
      return { error: { code: 'SELECT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 9. browser_check [P1]
// ═══════════════════════════════════════════
export const browserCheck: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_check',
  description: 'Check or uncheck a checkbox, or select a radio button.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      checked: { type: 'boolean', description: 'true=check, false=uncheck. Default: true' },
      value: { type: 'string', description: 'Radio group value to select' },
      force: { type: 'boolean', description: 'Force. Default: false' },
    },
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector, checked = true, value, force = false } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      const cmd = checked ? 'check' : 'uncheck';
      const args: any[] = [];
      if (value) args.push(value);
      const opts: any = {};
      if (force) opts.force = true;
      if (Object.keys(opts).length) args.push(opts);

      await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [{ command: 'get', args: [target] }, { command: cmd, args }] },
      });

      const state = await bridge.execute({
        type: 'EVAL',
        payload: { script: `var el = document.querySelector('${escapeSelector(target)}'); return el ? el.checked : null;` },
      });

      return { success: true as const, checked: state };
    } catch (err: any) {
      return { error: { code: 'CHECK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 10. browser_hover [P2]
// ═══════════════════════════════════════════
export const browserHover: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_hover',
  description: 'Hover the mouse over an element. Uses cy.trigger("mouseover") by default. Install cypress-real-events for true CSS :hover.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      position: { type: 'string', enum: ['center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] },
    },
    oneOf: [{ required: ['ref'] }, { required: ['selector'] }],
  },
  async execute(params) {
    const { ref, selector } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };

    try {
      // Try realHover first (cypress-real-events plugin), fallback to trigger
      const hasRealEvents = await bridge.execute({
        type: 'EVAL',
        payload: { script: "try { return typeof cy.realHover === 'function'; } catch(e) { return false; }" },
      }).catch(() => false);

      const commands: any[] = [{ command: 'get', args: [target] }];
      if (hasRealEvents) {
        commands.push({ command: 'realHover', args: [] });
      } else {
        commands.push({ command: 'trigger', args: ['mouseenter'] });
        commands.push({ command: 'trigger', args: ['mouseover'] });
      }

      await bridge.execute({ type: 'CHAIN', payload: { commands } });

      const info = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var el = document.querySelector('${escapeSelector(target)}');
          return el ? { tagName: el.tagName, role: el.getAttribute('role')||el.tagName.toLowerCase(), text: (el.textContent||'').trim().substring(0,100) } : null;
        ` },
      });

      return { success: true as const, elementInfo: info, usedRealEvents: !!hasRealEvents };
    } catch (err: any) {
      return { error: { code: 'HOVER_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 11. browser_scroll [P1]
// ═══════════════════════════════════════════
export const browserScroll: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_scroll',
  description: 'Scroll the page in a direction, or scroll a specific element into the viewport.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'Scroll this element into view' },
      selector: { type: 'string' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (page scroll)' },
      amount: { type: 'number', description: 'Pixels to scroll. Default: 500' },
      position: { type: 'string', enum: ['top', 'bottom', 'center'] },
    },
  },
  async execute(params) {
    const { ref, selector, direction, amount = 500 } = params;
    try {
      if (ref || selector) {
        const target = resolveTarget({ ref, selector })!;
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [{ command: 'get', args: [target] }, { command: 'scrollIntoView', args: [] }] },
        });
      } else if (direction) {
        const scrollMap: Record<string, string> = {
          down: `window.scrollBy(0, ${amount})`,
          up: `window.scrollBy(0, -${amount})`,
          right: `window.scrollBy(${amount}, 0)`,
          left: `window.scrollBy(-${amount}, 0)`,
        };
        await bridge.execute({ type: 'EVAL', payload: { script: scrollMap[direction] || '' } });
      }

      const pos = await bridge.execute({
        type: 'EVAL',
        payload: { script: 'return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }' },
      });
      return { success: true as const, scrollPosition: pos };
    } catch (err: any) {
      return { error: { code: 'SCROLL_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 12. browser_drag_drop [P2]
// ═══════════════════════════════════════════
export const browserDragDrop: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_drag_drop',
  description: 'Drag an element from source to target. Requires @4tw/cypress-drag-drop plugin or falls back to manual event sequence.',
  schema: {
    type: 'object',
    properties: {
      sourceRef: { type: 'string' }, sourceSelector: { type: 'string' },
      targetRef: { type: 'string' }, targetSelector: { type: 'string' },
    },
  },
  async execute(params) {
    const source = resolveTarget({ ref: params.sourceRef, selector: params.sourceSelector });
    const target = resolveTarget({ ref: params.targetRef, selector: params.targetSelector });
    if (!source || !target) return { error: { code: 'INVALID_SELECTOR', message: 'Source and target required' } };

    try {
      // Fallback: manual drag events
      await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          var src = document.querySelector('${escapeSelector(source)}');
          var tgt = document.querySelector('${escapeSelector(target)}');
          if (!src || !tgt) throw new Error('Elements not found');
          var dt = new DataTransfer();
          src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          tgt.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
          tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
          tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
          src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
          return true;
        ` },
      });
      return { success: true as const };
    } catch (err: any) {
      return { error: { code: 'DRAG_DROP_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 13. browser_press_key [P1]
// ═══════════════════════════════════════════
export const browserPressKey: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_press_key',
  description: 'Press a keyboard key. Supports special keys (Enter, Escape, Tab, arrows) and modifier combinations.',
  schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key name: Enter, Escape, Tab, ArrowDown, Backspace, etc.' },
      modifiers: { type: 'array', items: { type: 'string', enum: ['alt', 'ctrl', 'meta', 'shift'] } },
      ref: { type: 'string' }, selector: { type: 'string' },
    },
    required: ['key'],
  },
  async execute(params) {
    const { key, modifiers = [], ref, selector } = params;
    const target = resolveTarget({ ref, selector }) || 'body';

    const keyMap: Record<string, string> = {
      Enter: '{enter}', Escape: '{esc}', Tab: '{tab}',
      Backspace: '{backspace}', Delete: '{del}',
      ArrowUp: '{uparrow}', ArrowDown: '{downarrow}',
      ArrowLeft: '{leftarrow}', ArrowRight: '{rightarrow}',
      Home: '{home}', End: '{end}', PageUp: '{pageup}', PageDown: '{pagedown}',
    };

    let cypressKey = keyMap[key] || key;
    if (modifiers.length > 0) {
      const modStr = modifiers.join('+');
      const baseKey = key.length === 1 ? key : cypressKey.replace(/[{}]/g, '');
      cypressKey = `{${modStr}+${baseKey}}`;
    }

    try {
      await bridge.execute({
        type: 'CHAIN',
        payload: { commands: [
          { command: 'get', args: [target] },
          { command: 'type', args: [cypressKey, { force: true }] },
        ] },
      });
      return { success: true as const };
    } catch (err: any) {
      return { error: { code: 'KEY_PRESS_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 14. browser_file_upload [P1] — NEW
// ═══════════════════════════════════════════
export const browserFileUpload: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_file_upload',
  description: 'Upload a file to an <input type="file"> element. Provide the file path on disk. Cypress will attach the file using cy.selectFile().',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      filePath: { type: 'string', description: 'Path to the file to upload (relative to Cypress project root or absolute)' },
      fileName: { type: 'string', description: 'Override the file name shown to the application' },
      mimeType: { type: 'string', description: 'Override MIME type (e.g. "image/png", "application/pdf")' },
      action: { type: 'string', enum: ['select', 'drag-drop'], description: "Upload method: 'select' (click input) or 'drag-drop'. Default: 'select'" },
    },
    required: ['filePath'],
  },
  async execute(params) {
    const { ref, selector, filePath, fileName, mimeType, action = 'select' } = params;
    const target = resolveTarget({ ref, selector });
    if (!target && action === 'select') {
      return { error: { code: 'INVALID_SELECTOR', message: 'ref or selector required for file input' } };
    }

    try {
      const selectFileOpts: any = {};
      if (fileName || mimeType) {
        selectFileOpts.fileName = fileName;
        selectFileOpts.mimeType = mimeType;
      }
      if (action === 'drag-drop') selectFileOpts.action = 'drag-drop';

      if (target) {
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [
            { command: 'get', args: [target] },
            { command: 'selectFile', args: Object.keys(selectFileOpts).length ? [filePath, selectFileOpts] : [filePath] },
          ] },
        });
      } else {
        // drag-drop without target — drop on body
        await bridge.execute({
          type: 'CHAIN',
          payload: { commands: [
            { command: 'get', args: ['body'] },
            { command: 'selectFile', args: [filePath, { ...selectFileOpts, action: 'drag-drop' }] },
          ] },
        });
      }

      return { success: true as const, filePath, action };
    } catch (err: any) {
      return { error: { code: 'FILL_FAILED', message: err.message } };
    }
  },
});
