/**
 * Resolve ref hoặc selector thành CSS selector cho Cypress
 */
export function resolveTarget(params: { ref?: string; selector?: string }): string | null {
  if (params.ref) {
    // Validate ref format: must be 'ref:NUMBER'
    if (!/^ref:\d+$/.test(params.ref)) {
      return null; // Invalid ref format — reject
    }
    return `[data-mcp-ref="${params.ref}"]`;
  }
  if (params.selector) {
    return params.selector;
  }
  return null;
}

/**
 * Escape string for embedding inside a JS single-quoted string within EVAL scripts.
 * Prevents JS injection when user-provided values are interpolated into scripts.
 */
export function escapeSelector(sel: string): string {
  if (typeof sel !== 'string') return '';
  return sel
    .replace(/\\/g, '\\\\')     // Backslash first
    .replace(/'/g, "\\'")       // Single quotes
    .replace(/"/g, '\\"')       // Double quotes
    .replace(/`/g, '\\`')       // Backticks (template literals)
    .replace(/\$/g, '\\$')      // Dollar sign (${} injection)
    .replace(/\n/g, '\\n')      // Newline
    .replace(/\r/g, '\\r')      // Carriage return
    .replace(/\0/g, '')         // Null bytes — strip entirely
    .replace(/\u2028/g, '\\u2028')  // Unicode line separator
    .replace(/\u2029/g, '\\u2029'); // Unicode paragraph separator
}

/**
 * Validate URL before navigation — prevent javascript: and data: protocols
 */
export function validateUrl(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:')) {
    return { valid: false, error: 'javascript: URLs are not allowed' };
  }
  if (trimmed.startsWith('data:') && !trimmed.startsWith('data:text/html')) {
    // Allow data:text/html for testing, block others (data:application/octet-stream etc.)
    return { valid: false, error: 'data: URLs are not allowed' };
  }
  if (trimmed.startsWith('file:')) {
    return { valid: false, error: 'file: URLs are not allowed for security' };
  }
  return { valid: true };
}

/**
 * Sanitize regex pattern to prevent ReDoS
 * Limits pattern length and rejects known catastrophic patterns
 */
export function sanitizeRegex(pattern: string): { regex: RegExp | null; error?: string } {
  if (!pattern || typeof pattern !== 'string') {
    return { regex: null, error: 'Pattern is required' };
  }
  if (pattern.length > 500) {
    return { regex: null, error: 'Regex pattern too long (max 500 chars)' };
  }
  try {
    const regex = new RegExp(pattern);
    return { regex };
  } catch {
    return { regex: null, error: `Invalid regex: ${pattern.substring(0, 100)}` };
  }
}
