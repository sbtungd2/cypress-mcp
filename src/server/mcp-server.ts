import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolHandler } from '../tools/types';
import { BridgeServer } from '../bridge/ws-server';
import { StateManager } from '../state/state-manager';

export class McpServer {
  private server: Server;
  private tools: Map<string, ToolHandler> = new Map();
  private debug: boolean;

  constructor(
    private bridge: BridgeServer,
    private state: StateManager,
    private options: { transport: 'stdio' | 'sse'; ssePort?: number; debug?: boolean }
  ) {
    this.debug = options.debug || false;

    this.server = new Server(
      { name: 'cypress-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  registerTool(handler: ToolHandler) {
    this.tools.set(handler.name, handler);
  }

  private setupHandlers() {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.tools.values()).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
      })),
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = this.tools.get(name);

      if (!tool) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: 'TOOL_NOT_FOUND', message: `Tool ${name} not found` } }) }],
          isError: true,
        };
      }

      try {
        this.log(`Calling: ${name}`);
        const result = await tool.execute(args || {});

        this.state.addToHistory({
          tool: name,
          params: args || {},
          result,
          timestamp: Date.now(),
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError: 'error' in result,
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: { code: 'EXECUTION_ERROR', message: err.message } }) }],
          isError: true,
        };
      }
    });
  }

  async start() {
    if (this.options.transport === 'stdio') {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.log('MCP server started (stdio)');
    }
  }

  async stop() {
    await this.server.close();
  }

  private log(msg: string) {
    if (this.debug) {
      console.error(`[cypress-mcp:server] ${msg}`);
    }
  }
}
