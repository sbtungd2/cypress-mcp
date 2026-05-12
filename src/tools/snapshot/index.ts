import { ToolHandler, ToolFactory } from '../types';
import { resolveTarget, escapeSelector } from '../utils';

// ═══════════════════════════════════════════
// DOM Snapshotter — browser-side code (injected via EVAL)
// ═══════════════════════════════════════════
const SNAPSHOTTER_SCRIPT = `
(function() {
  var TAG_ROLES = {
    A: function(el) { return el.hasAttribute('href') ? 'link' : 'generic'; },
    BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    IMG: 'img', FORM: 'form', NAV: 'navigation', MAIN: 'main',
    ASIDE: 'complementary', HEADER: 'banner', FOOTER: 'contentinfo',
    DIALOG: 'dialog', UL: 'list', OL: 'list', LI: 'listitem',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell',
    DETAILS: 'group', SUMMARY: 'button', PROGRESS: 'progressbar', OUTPUT: 'status',
    SECTION: function(el) { return (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) ? 'region' : 'generic'; },
    INPUT: function(el) {
      var map = { text:'textbox', search:'searchbox', email:'textbox', password:'textbox',
        tel:'textbox', url:'textbox', number:'spinbutton', range:'slider',
        checkbox:'checkbox', radio:'radio', submit:'button', reset:'button', button:'button' };
      return map[el.type] || 'textbox';
    }
  };
  var INTERACTIVE = ['button','link','textbox','searchbox','combobox','checkbox','radio','slider','switch','tab','menuitem','option','spinbutton','treeitem'];
  var LANDMARKS = ['banner','navigation','main','complementary','contentinfo','form','region','search'];
  var STRUCTURAL = ['heading','list','listitem','table','row','cell','columnheader','img','dialog','alert','status','progressbar','group','separator','tablist','tabpanel','menu'];

  var refCounter = 0;

  function getRole(el) {
    var r = el.getAttribute('role');
    if (r) return r;
    var m = TAG_ROLES[el.tagName];
    if (typeof m === 'function') return m(el);
    if (typeof m === 'string') return m;
    return 'generic';
  }

  function getName(el, role) {
    var lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(' ').map(function(id) { var e = document.getElementById(id); return e ? e.textContent.trim() : ''; }).filter(Boolean).join(' ');
    var al = el.getAttribute('aria-label');
    if (al) return al;
    if (el.id && (el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA')) {
      try {
        var label = document.querySelector('label[for="'+CSS.escape(el.id)+'"]');
        if (label) return label.textContent.trim();
      } catch(e) { /* invalid id for selector */ }
    }
    if (el.tagName === 'IMG') return el.alt || '';
    var title = el.getAttribute('title');
    if (title) return title;
    if (['button','link','heading','listitem','menuitem','tab'].indexOf(role)!==-1) return (el.textContent||'').trim().substring(0,120);
    if (el.placeholder) return el.placeholder;
    return '';
  }

  function isHidden(el) {
    if (el.getAttribute('aria-hidden')==='true') return true;
    if (el.hidden) return true;
    var s = getComputedStyle(el);
    return s.display==='none' || s.visibility==='hidden';
  }

  function traverse(el, depth, opts) {
    if (depth > opts.maxDepth) return null;
    if (!opts.includeHidden && isHidden(el)) return null;
    if (['SCRIPT','STYLE','NOSCRIPT','LINK','META','BR','HR'].indexOf(el.tagName) !== -1) return null;

    var role = getRole(el);
    var isInt = INTERACTIVE.indexOf(role) !== -1;
    var isLand = LANDMARKS.indexOf(role) !== -1;
    var isStruct = STRUCTURAL.indexOf(role) !== -1;

    if (opts.interactiveOnly && !isInt && !isLand) {
      var kids = [];
      for (var i = 0; i < el.children.length; i++) {
        var c = traverse(el.children[i], depth + 1, opts);
        if (c) {
          // Flatten: if child is a group wrapper, unwrap its children
          if (c.role === 'group' && !c.ref && !c.name && c.children) {
            for (var j = 0; j < c.children.length; j++) kids.push(c.children[j]);
          } else {
            kids.push(c);
          }
        }
      }
      if (kids.length === 0) return null;
      if (kids.length === 1) return kids[0];
      return { ref:'', role:'group', name:'', children: kids };
    }

    var name = getName(el, role);
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      var c = traverse(el.children[i], depth + 1, opts);
      if (c) children.push(c);
    }

    if (role === 'generic' && !name) {
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
    }

    var ref = isInt ? 'ref:' + (++refCounter) : '';
    if (ref) el.setAttribute('data-mcp-ref', ref);

    var node = { ref: ref, role: role, name: name };
    if (role === 'heading') node.level = parseInt(el.tagName[1]);
    if (el.tagName==='INPUT'||el.tagName==='TEXTAREA') node.value = el.value;
    if (el.tagName==='SELECT' && el.selectedIndex>=0) node.value = el.options[el.selectedIndex].text;
    if ((el.type==='checkbox'||el.type==='radio') && el.tagName==='INPUT') node.checked = el.checked;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled')==='true') node.disabled = true;
    if (el.hasAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded')==='true';
    if (el.hasAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected')==='true';
    if (el.getAttribute('aria-required')==='true' || el.required) node.required = true;
    if (children.length) node.children = children;
    return node;
  }

  function toYaml(node, indent) {
    indent = indent || 0;
    var pad = '';
    for (var i=0;i<indent;i++) pad += '  ';
    var line = pad + '- ' + node.role;
    if (node.name) line += ' "' + node.name.replace(/"/g,'\\"') + '"';
    if (node.ref) line += ' [' + node.ref + ']';
    var attrs = [];
    if (node.level !== undefined) attrs.push('level='+node.level);
    if (node.value !== undefined) attrs.push('value="'+node.value+'"');
    if (node.checked !== undefined) attrs.push(node.checked ? 'checked' : 'unchecked');
    if (node.disabled) attrs.push('disabled');
    if (node.expanded !== undefined) attrs.push(node.expanded ? 'expanded' : 'collapsed');
    if (node.selected) attrs.push('selected');
    if (node.required) attrs.push('required');
    if (attrs.length) line += ' ' + attrs.join(' ');
    var result = line + '\\n';
    if (node.children) {
      for (var i=0;i<node.children.length;i++) {
        result += toYaml(node.children[i], indent + 1);
      }
    }
    return result;
  }

  // Run
  var scope = '__SCOPE__';
  var root = scope === 'body' ? document.body : document.querySelector(scope);
  if (!root) return { error: 'Scope not found: ' + scope };

  refCounter = 0;
  var opts = { maxDepth: __MAX_DEPTH__, includeHidden: __INCLUDE_HIDDEN__, interactiveOnly: __INTERACTIVE_ONLY__ };
  var tree = traverse(root, 0, opts);
  if (!tree) return { yaml: '', refCount: 0 };
  return { yaml: toYaml(tree, 0), refCount: refCounter, url: location.href, title: document.title };
})();
`;

// ═══════════════════════════════════════════
// 14. browser_snapshot [P0] — MOST IMPORTANT TOOL
// ═══════════════════════════════════════════
export const browserSnapshot: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_snapshot',
  description: "Capture an accessibility tree snapshot of the current page. Returns a YAML tree with element roles, names, states, and interactive element refs for use with browser_click, browser_type, etc. This is the primary way to 'see' the page.",
  schema: {
    type: 'object',
    properties: {
      scope: { type: 'string', description: "CSS selector to limit snapshot scope. Default: 'body'" },
      maxDepth: { type: 'number', description: 'Max DOM depth. Default: 10' },
      includeHidden: { type: 'boolean', description: 'Include hidden elements. Default: false' },
      interactiveOnly: { type: 'boolean', description: 'Only return interactive elements. Default: false' },
    },
  },
  async execute(params) {
    const { scope = 'body', maxDepth = 10, includeHidden = false, interactiveOnly = false } = params;

    try {
      const script = SNAPSHOTTER_SCRIPT
        .replace('__SCOPE__', scope.replace(/'/g, "\\'"))
        .replace('__MAX_DEPTH__', String(maxDepth))
        .replace('__INCLUDE_HIDDEN__', String(includeHidden))
        .replace('__INTERACTIVE_ONLY__', String(interactiveOnly));

      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: `return ${script}` },
        timeout: 15000,
      });

      if (result?.error) {
        return { error: { code: 'SCOPE_NOT_FOUND', message: result.error } };
      }

      return {
        success: true as const,
        snapshot: result.yaml || '',
        url: result.url || state.currentUrl,
        title: result.title || state.currentTitle,
        elementCount: result.refCount || 0,
      };
    } catch (err: any) {
      return { error: { code: 'SNAPSHOT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 15. browser_query_elements [P1]
// ═══════════════════════════════════════════
export const browserQueryElements: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_query_elements',
  description: 'Find elements matching criteria (role, text, state). Returns matching elements with refs for interaction tools.',
  schema: {
    type: 'object',
    properties: {
      role: { type: 'string', description: 'ARIA role: button, link, textbox, heading...' },
      text: { type: 'string', description: 'Text content (partial match)' },
      state: { type: 'string', enum: ['visible', 'hidden', 'disabled', 'checked'] },
      selector: { type: 'string', description: 'CSS selector' },
      limit: { type: 'number', description: 'Max results. Default: 20' },
    },
  },
  async execute(params) {
    const { role, text, state: stateFilter, selector, limit = 20 } = params;

    try {
      const result = await bridge.execute({
        type: 'EVAL',
        payload: { script: `
          return (function() {
            var results = [], refCounter = window.__mcpRefCounter || 0;
            var sel = '${escapeSelector(selector || '*')}';
            var els = document.querySelectorAll(sel);
            for (var i = 0; i < els.length && results.length < ${limit}; i++) {
              var el = els[i];
              var elRole = el.getAttribute('role') || el.tagName.toLowerCase();
              ${role ? `if (elRole !== '${role}') continue;` : ''}
              ${text ? `if (!(el.textContent||'').toLowerCase().includes('${escapeSelector(text.toLowerCase())}')) continue;` : ''}
              var visible = el.offsetParent !== null;
              var disabled = el.hasAttribute('disabled');
              ${stateFilter === 'visible' ? 'if (!visible) continue;' : ''}
              ${stateFilter === 'hidden' ? 'if (visible) continue;' : ''}
              ${stateFilter === 'disabled' ? 'if (!disabled) continue;' : ''}
              var ref = 'ref:' + (++refCounter);
              el.setAttribute('data-mcp-ref', ref);
              results.push({ ref: ref, role: elRole, name: (el.textContent||'').trim().substring(0,100), tagName: el.tagName, visible: visible, disabled: disabled });
            }
            window.__mcpRefCounter = refCounter;
            return { count: results.length, elements: results };
          })();
        ` },
      });

      return { success: true as const, ...result };
    } catch (err: any) {
      return { error: { code: 'QUERY_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 16. browser_get_text [P1]
// ═══════════════════════════════════════════
export const browserGetText: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_get_text',
  description: 'Get the text content of an element or the full page.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      fullPage: { type: 'boolean', description: 'Get all text on the page. Default: false' },
      maxLength: { type: 'number', description: 'Max characters. Default: 5000' },
    },
  },
  async execute(params) {
    const { ref, selector, fullPage = false, maxLength = 5000 } = params;

    try {
      let script: string;
      if (fullPage) {
        script = 'return document.body.innerText';
      } else {
        const target = resolveTarget({ ref, selector });
        if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'ref, selector, or fullPage required' } };
        script = `var el = document.querySelector('${escapeSelector(target)}'); return el ? (el.innerText||el.textContent||'') : '';`;
      }

      const text = await bridge.execute({ type: 'EVAL', payload: { script } });
      const truncated = typeof text === 'string' && text.length > maxLength;
      return {
        success: true as const,
        text: truncated ? text.substring(0, maxLength) : (text || ''),
        truncated,
      };
    } catch (err: any) {
      return { error: { code: 'GET_TEXT_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 17. browser_get_attribute [P2]
// ═══════════════════════════════════════════
export const browserGetAttribute: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_get_attribute',
  description: 'Get HTML attribute value(s) from an element.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      attribute: { type: 'string', description: 'Attribute name (href, src, class, data-*). Required unless allAttributes=true.' },
      allAttributes: { type: 'boolean', description: 'Return all attributes. Default: false' },
    },
  },
  async execute(params) {
    const { ref, selector, attribute, allAttributes = false } = params;
    const target = resolveTarget({ ref, selector });
    if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'Either ref or selector is required' } };
    if (!allAttributes && !attribute) return { error: { code: 'GET_ATTR_FAILED', message: 'attribute is required when allAttributes is false' } };

    try {
      const script = allAttributes
        ? `var el = document.querySelector('${escapeSelector(target)}'); return el ? Object.fromEntries(Array.from(el.attributes).map(function(a){return[a.name,a.value]})) : null;`
        : `var el = document.querySelector('${escapeSelector(target)}'); return el ? el.getAttribute('${escapeSelector(attribute)}') : null;`;

      const result = await bridge.execute({ type: 'EVAL', payload: { script } });
      return { success: true as const, value: result };
    } catch (err: any) {
      return { error: { code: 'GET_ATTR_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 18. browser_get_html [P1] — NEW
// ═══════════════════════════════════════════
export const browserGetHtml: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_get_html',
  description: 'Get the raw HTML content of an element or the full page. Returns innerHTML or outerHTML. Useful for inspecting DOM structure, hidden fields, and element attributes.',
  schema: {
    type: 'object',
    properties: {
      ref: { type: 'string' }, selector: { type: 'string' },
      outer: { type: 'boolean', description: 'Return outerHTML (includes the element tag itself). Default: false (innerHTML)' },
      fullPage: { type: 'boolean', description: 'Get full page HTML. Default: false' },
      maxLength: { type: 'number', description: 'Max characters to return. Default: 20000' },
    },
  },
  async execute(params) {
    const { ref, selector, outer = false, fullPage = false, maxLength = 20000 } = params;
    try {
      let script: string;
      if (fullPage) {
        script = outer ? 'return document.documentElement.outerHTML' : 'return document.body.innerHTML';
      } else {
        const target = resolveTarget({ ref, selector });
        if (!target) return { error: { code: 'INVALID_SELECTOR', message: 'ref, selector, or fullPage required' } };
        const prop = outer ? 'outerHTML' : 'innerHTML';
        script = `var el = document.querySelector('${escapeSelector(target)}'); return el ? el.${prop} : null;`;
      }

      const html = await bridge.execute({ type: 'EVAL', payload: { script } });
      if (html === null) return { error: { code: 'ELEMENT_NOT_FOUND', message: 'Element not found' } };

      const truncated = typeof html === 'string' && html.length > maxLength;
      return {
        success: true as const,
        html: truncated ? html.substring(0, maxLength) + '<!-- truncated -->' : (html || ''),
        length: typeof html === 'string' ? html.length : 0,
        truncated,
      };
    } catch (err: any) {
      return { error: { code: 'GET_TEXT_FAILED', message: err.message } };
    }
  },
});
