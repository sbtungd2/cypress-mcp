# Security Policy

## Security Considerations

`cypress-mcp` is a **development/testing tool** that gives MCP clients (AI agents) control over a Cypress browser instance. This has inherent security implications:

### By Design

- **`browser_evaluate`** and **`browser_run_cypress`** execute arbitrary JavaScript/Cypress code in the browser context. This is by design (similar to Chrome DevTools Console) but means the MCP client has full access to the page's DOM, cookies, localStorage, and network.
- **`browser_navigate`** can navigate to any URL (except `javascript:`, `data:`, `file:` which are blocked).
- **Network interception** can capture request/response headers and bodies, including sensitive data like auth tokens.

### Mitigations in Place

- **URL protocol validation** — `javascript:`, `data:`, `file:` URLs are blocked in `browser_navigate`.
- **Input escaping** — All user inputs interpolated into JavaScript strings are escaped (quotes, backticks, template literals, null bytes, Unicode line separators).
- **Ref format validation** — Element references (`ref:N`) are validated against `^ref:\d+$` to prevent CSS selector injection.
- **Regex DoS protection** — Network filter regex patterns are limited to 500 characters.
- **Memory caps** — Network requests (500), console messages (500), and command history (200) are capped to prevent memory exhaustion.
- **Script size limits** — `browser_evaluate` rejects scripts over 100KB.
- **CLI input validation** — Browser, transport, and port arguments are validated against allowlists.
- **No `shell: true`** — CLI uses `shell: false` to prevent command injection.

### Recommendations

1. **Do NOT run in production environments** — This tool is for development and testing only.
2. **Do NOT expose the MCP server to untrusted networks** — The stdio transport is local-only by design.
3. **Be cautious with SSE transport** — If using SSE, ensure the port is not publicly accessible.
4. **Review AI agent actions** — Monitor what the connected MCP client is doing, especially with `browser_evaluate`.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it by opening a GitHub issue (for non-sensitive issues) or contacting the maintainers directly.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |
