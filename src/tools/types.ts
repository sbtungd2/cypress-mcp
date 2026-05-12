// ─── Tool Interface ───
export interface ToolHandler {
  name: string;
  description: string;
  schema: ToolSchema;
  execute(params: Record<string, any>): Promise<ToolResult>;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
  oneOf?: any[];
}

export type ToolResult = ToolSuccess | ToolError;
export interface ToolSuccess { success: true; [key: string]: any; }
export interface ToolError { error: { code: ErrorCode; message: string; details?: any; }; }

export type ErrorCode =
  | 'ELEMENT_NOT_FOUND' | 'ELEMENT_NOT_VISIBLE' | 'ELEMENT_DISABLED'
  | 'ELEMENT_DETACHED' | 'ELEMENT_COVERED' | 'ELEMENT_NOT_TYPEABLE'
  | 'NOT_CHECKABLE' | 'NOT_A_SELECT' | 'OPTION_NOT_FOUND'
  | 'NAVIGATION_TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_URL' | 'SSL_ERROR' | 'NO_HISTORY'
  | 'JS_SYNTAX_ERROR' | 'JS_RUNTIME_ERROR' | 'JS_TIMEOUT' | 'JS_SERIALIZE_ERROR'
  | 'INVALID_SELECTOR' | 'INVALID_REF'
  | 'SESSION_EXPIRED' | 'CYPRESS_NOT_READY' | 'COMMAND_QUEUE_FULL'
  | 'SCREENSHOT_FAILED' | 'MOCK_CONFLICT' | 'MOCK_NOT_FOUND'
  | 'MULTI_TAB_UNSUPPORTED' | 'REQUEST_NOT_FOUND' | 'WAIT_TIMEOUT'
  | 'SNAPSHOT_FAILED' | 'SCOPE_NOT_FOUND'
  | 'TOOL_NOT_FOUND' | 'EXECUTION_ERROR'
  | 'CLICK_FAILED' | 'TYPE_FAILED' | 'FILL_FAILED' | 'CHECK_FAILED'
  | 'HOVER_FAILED' | 'SCROLL_FAILED' | 'DRAG_DROP_FAILED'
  | 'KEY_PRESS_FAILED' | 'QUERY_FAILED' | 'GET_TEXT_FAILED'
  | 'GET_ATTR_FAILED' | 'MOCK_FAILED' | 'VIEWPORT_FAILED'
  | 'NAVIGATION_FAILED' | 'SELECT_FAILED' | 'DIALOG_FAILED'
  | 'STORAGE_FAILED' | 'ASSERT_FAILED' | 'RUN_FAILED' | 'GENERATE_FAILED'
  | 'INVALID_FILTER' | 'INVALID_KEY';

// ─── Bridge Protocol ───
export interface BridgeMessage {
  id: string;
  type: BridgeMessageType;
  payload: any;
  timeout?: number;
}

export type BridgeMessageType =
  | 'COMMAND' | 'CHAIN' | 'EVAL' | 'SNAPSHOT'
  | 'INTERCEPT' | 'INTERCEPT_WAIT' | 'WAIT_ALIAS'
  | 'WAIT_NETWORK_IDLE' | 'READ_FILE_BASE64';

export interface BridgeResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
}

// ─── Snapshot Types ───
export interface SnapshotNode {
  ref: string;
  role: string;
  name: string;
  level?: number;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  placeholder?: string;
  description?: string;
  children?: SnapshotNode[];
}

// ─── Network Types ───
export interface CapturedRequest {
  id: number;
  url: string;
  method: string;
  status: number;
  resourceType: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: any;
  responseBody: any;
  duration: number;
  timestamp: number;
  size: number;
}

// ─── Console Types ───
export interface ConsoleMessage {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  source?: string;
}

// ─── State Types ───
export interface CommandHistoryEntry {
  tool: string;
  params: Record<string, any>;
  result: ToolResult;
  timestamp: number;
}

// ─── Tool Factory ───
// Use interface to avoid circular dependency with bridge/state modules
export interface IBridgeServer {
  execute(message: Omit<BridgeMessage, 'id'>): Promise<any>;
}

export interface IStateManager {
  currentUrl: string;
  currentTitle: string;
  viewportWidth: number;
  viewportHeight: number;
  networkRequests: CapturedRequest[];
  consoleMessages: ConsoleMessage[];
  activeMocks: Map<string, { url: string; method: string }>;
  commandHistory: CommandHistoryEntry[];
  tabState: Map<string, { url: string; title: string; active: boolean }>;
  updateCurrentPage(info: { url: string; title: string }): void;
  updateViewport(width: number, height: number): void;
  updateNetworkRequests(requests: CapturedRequest[]): void;
  updateConsoleMessages(messages: ConsoleMessage[]): void;
  clearConsoleMessages(): void;
  addMock(id: string, mock: { url: string; method: string }): void;
  removeMock(id: string): void;
  addToHistory(entry: CommandHistoryEntry): void;
}

export type ToolFactory = (bridge: IBridgeServer, state: IStateManager) => ToolHandler;
