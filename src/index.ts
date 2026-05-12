// ═══════════════════════════════════════════
// cypress-mcp — Public API
// ═══════════════════════════════════════════

// Plugin entry
export { cypressMcp } from './plugin';
export type { CypressMcpOptions } from './plugin';

// Core classes (for advanced usage)
export { McpServer } from './server/mcp-server';
export { BridgeServer } from './bridge/ws-server';
export { StateManager } from './state/state-manager';

// Registry & Plugin system (for extending cypress-mcp)
export { ToolRegistry, registerAllTools } from './server/tool-registry-v2';
export type { CypressMcpPlugin, ToolMiddleware, ToolMetadata, RegisteredTool } from './server/tool-registry-v2';

// Types
export type {
  ToolHandler,
  ToolSchema,
  ToolResult,
  ToolSuccess,
  ToolError,
  ToolFactory,
  ErrorCode,
  BridgeMessage,
  BridgeResponse,
  SnapshotNode,
  CapturedRequest,
  ConsoleMessage,
  CommandHistoryEntry,
  IBridgeServer,
  IStateManager,
} from './tools/types';
