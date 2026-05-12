import { ToolHandler, ToolFactory } from '../types';
import { sanitizeRegex } from '../utils';

let mockCounter = 0;

// ═══════════════════════════════════════════
// 18. browser_network_requests [P0]
// ═══════════════════════════════════════════
export const browserNetworkRequests: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_network_requests',
  description: "List all captured network requests. Filter by URL pattern, resource type (xhr, fetch, document, script, stylesheet, image, font), or status code range. Cypress's cy.intercept captures every request.",
  schema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: "URL regex pattern. e.g. '/api/.*'" },
      resourceType: { type: 'string', enum: ['xhr', 'fetch', 'document', 'script', 'stylesheet', 'image', 'font', 'all'], description: "Default: 'all'" },
      statusFilter: { type: 'string', enum: ['all', 'success', 'error', 'redirect'], description: "Default: 'all'" },
      limit: { type: 'number', description: 'Max results. Default: 50' },
    },
  },
  async execute(params) {
    const { filter, resourceType = 'all', statusFilter = 'all', limit = 50 } = params;

    // Pull latest from browser
    try {
      const browserRequests = await bridge.execute({
        type: 'EVAL',
        payload: { script: 'return window.__mcpNetworkBuffer || []' },
      });
      if (Array.isArray(browserRequests) && browserRequests.length > 0) {
        state.updateNetworkRequests(browserRequests);
      }
    } catch { /* use cached state */ }

    let requests = [...state.networkRequests];

    if (filter) {
      const { regex, error } = sanitizeRegex(filter);
      if (!regex) {
        return { error: { code: 'INVALID_FILTER', message: error! } };
      }
      requests = requests.filter(r => regex.test(r.url));
    }

    if (resourceType !== 'all') {
      requests = requests.filter(r => r.resourceType === resourceType);
    }

    if (statusFilter !== 'all') {
      requests = requests.filter(r => {
        if (statusFilter === 'success') return r.status >= 200 && r.status < 300;
        if (statusFilter === 'error') return r.status >= 400;
        if (statusFilter === 'redirect') return r.status >= 300 && r.status < 400;
        return true;
      });
    }

    const total = state.networkRequests.length;
    const filtered = requests.slice(0, limit);

    return {
      success: true as const,
      total,
      filtered: filtered.length,
      requests: filtered.map(r => ({
        id: r.id, method: r.method, url: r.url, status: r.status,
        resourceType: r.resourceType, duration: r.duration, size: r.size,
      })),
    };
  },
});

// ═══════════════════════════════════════════
// 19. browser_network_request [P0]
// ═══════════════════════════════════════════
export const browserNetworkRequest: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_network_request',
  description: 'Get full details of a specific network request by ID (headers, body, timing).',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Request ID from browser_network_requests' },
      part: { type: 'string', enum: ['all', 'requestHeaders', 'responseHeaders', 'requestBody', 'responseBody'], description: "Default: 'all'" },
      maxBodySize: { type: 'number', description: 'Max body size in chars. Default: 10000' },
    },
    required: ['id'],
  },
  async execute(params) {
    const { id, part = 'all', maxBodySize = 10000 } = params;
    const req = state.networkRequests.find(r => r.id === id);
    if (!req) return { error: { code: 'REQUEST_NOT_FOUND', message: `Request #${id} not found` } };

    const truncate = (body: any): any => {
      if (!body) return null;
      const str = typeof body === 'string' ? body : JSON.stringify(body);
      return str.length > maxBodySize ? str.substring(0, maxBodySize) + '...[truncated]' : body;
    };

    if (part !== 'all') {
      const val = (req as any)[part];
      return { success: true as const, [part]: part.includes('Body') ? truncate(val) : val };
    }

    return {
      success: true as const,
      id: req.id, method: req.method, url: req.url, status: req.status,
      resourceType: req.resourceType,
      requestHeaders: req.requestHeaders, responseHeaders: req.responseHeaders,
      requestBody: truncate(req.requestBody), responseBody: truncate(req.responseBody),
      duration: req.duration, size: req.size, timestamp: req.timestamp,
    };
  },
});

// ═══════════════════════════════════════════
// 20. browser_mock_route [P1]
// ═══════════════════════════════════════════
export const browserMockRoute: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_mock_route',
  description: 'Mock a network route to return a custom response. Powerful for testing without a real backend.',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: "URL pattern: '/api/users', '/api/**'" },
      method: { type: 'string', description: "HTTP method. Default: 'GET'" },
      response: { type: 'object', description: 'Mock response: { statusCode, body, headers, delay }' },
      alias: { type: 'string', description: 'Alias for cy.wait()' },
    },
    required: ['url', 'response'],
  },
  async execute(params) {
    const { url, method = 'GET', response, alias } = params;
    const mockAlias = alias || `mock_${++mockCounter}`;

    try {
      await bridge.execute({
        type: 'INTERCEPT',
        payload: { method, url, response, alias: mockAlias },
      });
      state.addMock(mockAlias, { url, method });
      return { success: true as const, alias: mockAlias, mockId: mockAlias };
    } catch (err: any) {
      return { error: { code: 'MOCK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 21. browser_remove_mock [P2]
// ═══════════════════════════════════════════
export const browserRemoveMock: ToolFactory = (bridge, state): ToolHandler => ({
  name: 'browser_remove_mock',
  description: 'Remove a previously set mock route by its mockId.',
  schema: {
    type: 'object',
    properties: {
      mockId: { type: 'string', description: 'Mock ID from browser_mock_route' },
    },
    required: ['mockId'],
  },
  async execute(params) {
    const { mockId } = params;
    const mock = state.activeMocks.get(mockId);
    if (!mock) return { error: { code: 'MOCK_NOT_FOUND', message: `Mock ${mockId} not found` } };

    try {
      // Override with passthrough
      await bridge.execute({
        type: 'INTERCEPT',
        payload: { method: mock.method, url: mock.url, response: null },
      });
      state.removeMock(mockId);
      return { success: true as const };
    } catch (err: any) {
      return { error: { code: 'MOCK_FAILED', message: err.message } };
    }
  },
});

// ═══════════════════════════════════════════
// 22. browser_wait_for_request [P1]
// ═══════════════════════════════════════════
let waitCounter = 0;
export const browserWaitForRequest: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_wait_for_request',
  description: 'Wait for a network request matching the URL pattern. Returns request details when it occurs.',
  schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL pattern' },
      method: { type: 'string', description: 'HTTP method filter' },
      timeout: { type: 'number', description: 'Timeout in ms. Default: 10000' },
    },
    required: ['url'],
  },
  async execute(params) {
    const { url, method, timeout = 10000 } = params;
    const alias = `wait_${++waitCounter}`;

    try {
      await bridge.execute({
        type: 'INTERCEPT_WAIT',
        payload: { url, method: method || '*', alias, timeout },
        timeout: timeout + 5000,
      });

      const result = await bridge.execute({
        type: 'WAIT_ALIAS',
        payload: { alias, timeout },
        timeout: timeout + 5000,
      });

      return {
        success: true as const,
        request: {
          method: result?.request?.method || method || 'GET',
          url: result?.request?.url || url,
          status: result?.response?.statusCode || 0,
          requestBody: result?.request?.body,
          responseBody: result?.response?.body,
          duration: result?.duration || 0,
        },
      };
    } catch (err: any) {
      return { error: { code: 'WAIT_TIMEOUT', message: `No request matching ${url} within ${timeout}ms` } };
    }
  },
});
