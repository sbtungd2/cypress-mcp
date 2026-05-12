#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// ─── Parse CLI args ───
const args = process.argv.slice(2);
const options: Record<string, string> = {};

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
    options[args[i].slice(2)] = args[i + 1];
    i++;
  } else if (args[i].startsWith('--')) {
    options[args[i].slice(2)] = 'true';
  }
}

// ─── Resolve all options: CLI args → env vars → cypress.config → defaults ───
const port = options.port || process.env.MCP_PORT || '3456';
const transport = options.transport || process.env.MCP_TRANSPORT || 'stdio';
const browser = options.browser || process.env.MCP_BROWSER || 'chrome';
const headed = (options.headed || process.env.MCP_HEADED) !== 'false';
const specDir = options.spec || process.env.MCP_SPEC || '';
const configFile = options['config-file'] || process.env.CYPRESS_CONFIG_FILE || '';
const debug = options.debug === 'true' || process.env.MCP_DEBUG === 'true';

// ─── Resolve baseUrl: CLI → env → cypress.config → default ───
function detectBaseUrl(): string {
  // 1. CLI arg (highest priority)
  if (options['base-url']) return options['base-url'];

  // 2. Environment variable
  if (process.env.CYPRESS_BASE_URL) return process.env.CYPRESS_BASE_URL;

  // 3. Auto-detect from cypress.config.{ts,js,mjs,cjs} in current directory
  const configNames = [
    'cypress.config.ts', 'cypress.config.js',
    'cypress.config.mjs', 'cypress.config.cjs',
  ];

  for (const name of configNames) {
    const configPath = configFile
      ? path.resolve(configFile)
      : path.resolve(process.cwd(), name);

    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        // Extract baseUrl from config file (simple regex — works for most cases)
        const match = content.match(/baseUrl\s*[:=]\s*['"`]([^'"`]+)['"`]/);
        if (match) {
          if (debug) console.error(`[cypress-mcp] Auto-detected baseUrl from ${name}: ${match[1]}`);
          return match[1];
        }
      } catch { /* ignore read errors */ }
    }
  }

  // 4. No baseUrl found — that's OK, Cypress can work without it
  return '';
}

const baseUrl = detectBaseUrl();

// ─── Validate inputs ───
const ALLOWED_BROWSERS = ['chrome', 'chromium', 'firefox', 'edge', 'electron'];
const ALLOWED_TRANSPORTS = ['stdio', 'sse'];

if (!ALLOWED_BROWSERS.includes(browser)) {
  console.error(`[cypress-mcp] Invalid browser: ${browser}. Allowed: ${ALLOWED_BROWSERS.join(', ')}`);
  process.exit(1);
}
if (!ALLOWED_TRANSPORTS.includes(transport)) {
  console.error(`[cypress-mcp] Invalid transport: ${transport}. Allowed: ${ALLOWED_TRANSPORTS.join(', ')}`);
  process.exit(1);
}
if (!/^\d+$/.test(port) || parseInt(port) < 1024 || parseInt(port) > 65535) {
  console.error(`[cypress-mcp] Invalid port: ${port}. Must be 1024-65535`);
  process.exit(1);
}
if (baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
  console.error(`[cypress-mcp] Invalid base-url: ${baseUrl}. Must start with http:// or https://`);
  process.exit(1);
}

// ─── Print config ───
console.error(`
┌──────────────────────────────────────────────┐
│  cypress-mcp v0.1.0                          │
│  MCP server for Cypress browser automation   │
├──────────────────────────────────────────────┤
│  Base URL:  ${(baseUrl || '(none)').padEnd(33)}│
│  Bridge:    task-based (port ${port.padEnd(17)}│
│  Transport: ${transport.padEnd(33)}│
│  Browser:   ${browser.padEnd(33)}│
│  Headed:    ${String(headed).padEnd(33)}│
│  Debug:     ${String(debug).padEnd(33)}│
└──────────────────────────────────────────────┘
`);

// ─── Build Cypress args ───
const agentSpec = specDir || path.resolve(__dirname, 'cypress', 'agent.cy.ts');

const cypressConfig: Record<string, any> = {
  env: {
    MCP_WS_PORT: parseInt(port),
    MCP_DEBUG: debug,
  },
};
if (baseUrl) {
  cypressConfig.e2e = { baseUrl };
}

const cypressArgs = [
  'cypress', 'open',
  '--e2e',
  '--browser', browser,
  '--config', JSON.stringify(cypressConfig),
];

if (configFile) {
  cypressArgs.push('--config-file', configFile);
}

if (!specDir) {
  cypressArgs.push('--spec', agentSpec);
}

// ─── Launch Cypress ───
const child = spawn('npx', cypressArgs, {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    MCP_TRANSPORT: transport,
    MCP_WS_PORT: port,
    ...(baseUrl ? { CYPRESS_BASE_URL: baseUrl } : {}),
  },
});

child.on('error', (err) => {
  console.error('[cypress-mcp] Failed to start Cypress:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
