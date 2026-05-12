import * as path from 'path';
import * as fs from 'fs';
import { McpServer } from './mcp-server';
import { BridgeServer } from '../bridge/ws-server';
import { StateManager } from '../state/state-manager';
import { ToolHandler, ToolFactory } from '../tools/types';

// ─── Tool Metadata ───
export interface ToolMetadata {
  /** Tool category for grouping: 'navigation', 'interaction', etc. */
  category: string;
  /** Priority: 'P0' (core), 'P1' (important), 'P2' (nice to have) */
  priority: 'P0' | 'P1' | 'P2';
  /** Semantic version when tool was added */
  since: string;
  /** Tags for filtering */
  tags?: string[];
}

export interface RegisteredTool {
  handler: ToolHandler;
  metadata: ToolMetadata;
}

// ─── Middleware ───
export type ToolMiddleware = (
  toolName: string,
  params: Record<string, any>,
  next: (params: Record<string, any>) => Promise<any>
) => Promise<any>;

// ─── Plugin Interface ───
export interface CypressMcpPlugin {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Tool factories to register */
  tools: Array<{
    factory: ToolFactory;
    metadata: ToolMetadata;
  }>;
  /** Optional middleware */
  middleware?: ToolMiddleware[];
  /** Optional state extensions */
  stateExtensions?: Record<string, any>;
}

// ─── Registry ───
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private middlewares: ToolMiddleware[] = [];
  private plugins: Map<string, CypressMcpPlugin> = new Map();

  constructor(
    private bridge: BridgeServer,
    private state: StateManager,
    private debug: boolean = false,
  ) {}

  /**
   * Register a single tool factory with metadata
   */
  register(factory: ToolFactory, metadata: ToolMetadata): void {
    const handler = factory(this.bridge, this.state);
    this.tools.set(handler.name, { handler, metadata });
    this.log(`Registered: ${handler.name} [${metadata.category}/${metadata.priority}]`);
  }

  /**
   * Register all tool factories from a module (an object with ToolFactory exports)
   */
  registerModule(mod: Record<string, ToolFactory>, category: string, priority: 'P0' | 'P1' | 'P2' = 'P1'): void {
    for (const [exportName, factory] of Object.entries(mod)) {
      if (typeof factory === 'function' && exportName.startsWith('browser')) {
        this.register(factory, { category, priority, since: '0.1.0' });
      }
    }
  }

  /**
   * Auto-discover and register all tools from tool subdirectories.
   * This is the KEY scalability feature — add a new directory, export tools, done.
   */
  autoDiscover(toolsDir: string): void {
    if (!fs.existsSync(toolsDir)) {
      this.log(`Tools directory not found: ${toolsDir}`);
      return;
    }

    const categoryDirs = fs.readdirSync(toolsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const category of categoryDirs) {
      const indexPath = path.join(toolsDir, category, 'index.ts');
      const indexJsPath = path.join(toolsDir, category, 'index.js');
      const modulePath = fs.existsSync(indexJsPath) ? indexJsPath : indexPath;

      if (!fs.existsSync(modulePath)) continue;

      try {
        const mod = require(modulePath);
        this.registerModule(mod, category);
      } catch (err: any) {
        this.log(`Failed to load tools from ${category}: ${err.message}`);
      }
    }
  }

  /**
   * Register a third-party plugin
   */
  registerPlugin(plugin: CypressMcpPlugin): void {
    if (this.plugins.has(plugin.name)) {
      this.log(`Plugin ${plugin.name} already registered, skipping`);
      return;
    }

    this.plugins.set(plugin.name, plugin);

    // Register tools
    for (const { factory, metadata } of plugin.tools) {
      this.register(factory, {
        ...metadata,
        tags: [...(metadata.tags || []), `plugin:${plugin.name}`],
      });
    }

    // Register middleware
    if (plugin.middleware) {
      this.middlewares.push(...plugin.middleware);
    }

    // Extend state
    if (plugin.stateExtensions) {
      Object.assign(this.state, plugin.stateExtensions);
    }

    this.log(`Plugin loaded: ${plugin.name}@${plugin.version} (${plugin.tools.length} tools)`);
  }

  /**
   * Add middleware that runs before/after every tool execution
   */
  use(middleware: ToolMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Get all registered tool handlers (for MCP server)
   */
  getAllHandlers(): ToolHandler[] {
    return Array.from(this.tools.values()).map(t => t.handler);
  }

  /**
   * Get tool by name
   */
  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get tools filtered by category or tags
   */
  getToolsByCategory(category: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.metadata.category === category);
  }

  getToolsByTag(tag: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.metadata.tags?.includes(tag));
  }

  /**
   * Execute a tool with middleware chain
   */
  async execute(name: string, params: Record<string, any>): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: { code: 'TOOL_NOT_FOUND', message: `Tool ${name} not found` } };
    }

    // Build middleware chain
    const chain = this.middlewares.reduceRight(
      (next: (p: Record<string, any>) => Promise<any>, mw: ToolMiddleware) => {
        return (p: Record<string, any>) => mw(name, p, next);
      },
      (p: Record<string, any>) => tool.handler.execute(p)
    );

    return chain(params);
  }

  /** Total tool count */
  get count(): number { return this.tools.size; }

  /** List all tool names */
  get names(): string[] { return Array.from(this.tools.keys()); }

  /** Summary by category */
  get summary(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const { metadata } of this.tools.values()) {
      result[metadata.category] = (result[metadata.category] || 0) + 1;
    }
    return result;
  }

  private log(msg: string) {
    if (this.debug) console.error(`[cypress-mcp:registry] ${msg}`);
  }
}

// ═══════════════════════════════════════════
// Default registration — built-in tools
// ═══════════════════════════════════════════

// Category → priority mapping
const CATEGORY_PRIORITY: Record<string, 'P0' | 'P1' | 'P2'> = {
  navigation: 'P0',
  interaction: 'P0',
  snapshot: 'P0',
  network: 'P1',
  visual: 'P1',
  console: 'P1',
  tabs: 'P2',
  storage: 'P1',
  session: 'P1',
  iframe: 'P1',
  dialog: 'P1',
  utility: 'P1',
};

/**
 * Register all built-in tools.
 * Backward-compatible wrapper — called from plugin.ts
 */
export function registerAllTools(
  server: McpServer,
  bridge: BridgeServer,
  state: StateManager,
  options?: { debug?: boolean; plugins?: CypressMcpPlugin[] }
): ToolRegistry {
  const registry = new ToolRegistry(bridge, state, options?.debug);

  // Import and register each category
  const categories = [
    { name: 'navigation', mod: require('../tools/navigation/index') },
    { name: 'interaction', mod: require('../tools/interaction/index') },
    { name: 'snapshot', mod: require('../tools/snapshot/index') },
    { name: 'network', mod: require('../tools/network/index') },
    { name: 'visual', mod: require('../tools/visual/index') },
    { name: 'console', mod: require('../tools/console/index') },
    { name: 'tabs', mod: require('../tools/tabs/index') },
    { name: 'storage', mod: require('../tools/storage/index') },
    { name: 'session', mod: require('../tools/session/index') },
    { name: 'iframe', mod: require('../tools/iframe/index') },
    { name: 'dialog', mod: require('../tools/dialog/index') },
    { name: 'utility', mod: require('../tools/utility/index') },
  ];

  for (const { name, mod } of categories) {
    registry.registerModule(mod, name, CATEGORY_PRIORITY[name] || 'P1');
  }

  // Register third-party plugins
  if (options?.plugins) {
    for (const plugin of options.plugins) {
      registry.registerPlugin(plugin);
    }
  }

  // Register all handlers with MCP server
  for (const handler of registry.getAllHandlers()) {
    server.registerTool(handler);
  }

  console.error(`[cypress-mcp] Registered ${registry.count} tools across ${Object.keys(registry.summary).length} categories`);
  if (options?.debug) {
    const summary = registry.summary;
    Object.entries(summary).forEach(([cat, count]) => {
      console.error(`  ${cat}: ${count} tools`);
    });
  }

  return registry;
}
