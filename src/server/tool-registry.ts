import { McpServer } from './mcp-server';
import { BridgeServer } from '../bridge/ws-server';
import { StateManager } from '../state/state-manager';

// Navigation (4)
import { browserNavigate, browserGoBack, browserGoForward, browserReload } from '../tools/navigation/index';
// Interaction (10) — +1 file_upload
import { browserClick, browserType, browserFill, browserSelect, browserCheck, browserHover, browserScroll, browserDragDrop, browserPressKey, browserFileUpload } from '../tools/interaction/index';
// Snapshot & DOM (5) — +1 get_html
import { browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute, browserGetHtml } from '../tools/snapshot/index';
// Network (5)
import { browserNetworkRequests, browserNetworkRequest, browserMockRoute, browserRemoveMock, browserWaitForRequest } from '../tools/network/index';
// Visual (8) — +6 new tools
import { browserScreenshot, browserViewport, browserVisionClick, browserSetUserAgent, browserPdf, browserHighlight, browserRemoveHighlight } from '../tools/visual/index';
// Console & Debug (2)
import { browserConsoleMessages, browserEvaluate } from '../tools/console/index';
// Tabs (4)
import { browserListTabs, browserNewTab, browserSwitchTab, browserCloseTab } from '../tools/tabs/index';
// Storage (5)
import { browserGetCookies, browserSetCookie, browserClearCookies, browserLocalStorage, browserSessionStorage } from '../tools/storage/index';
// Session (2) — NEW
import { browserSaveState, browserRestoreState } from '../tools/session/index';
// iFrame (3) — NEW
import { browserIframeClick, browserIframeType, browserIframeSnapshot } from '../tools/iframe/index';
// Dialog (1)
import { browserHandleDialog } from '../tools/dialog/index';
// Utility (4)
import { browserWait, browserAssert, browserRunCypress, browserGenerateTest } from '../tools/utility/index';

export function registerAllTools(
  server: McpServer,
  bridge: BridgeServer,
  state: StateManager
) {
  const factories = [
    // Navigation (4)
    browserNavigate, browserGoBack, browserGoForward, browserReload,
    // Interaction (10)
    browserClick, browserType, browserFill, browserSelect,
    browserCheck, browserHover, browserScroll, browserDragDrop,
    browserPressKey, browserFileUpload,
    // Snapshot & DOM (5)
    browserSnapshot, browserQueryElements, browserGetText, browserGetAttribute, browserGetHtml,
    // Network (5)
    browserNetworkRequests, browserNetworkRequest,
    browserMockRoute, browserRemoveMock, browserWaitForRequest,
    // Visual (8)
    browserScreenshot, browserViewport, browserVisionClick,
    browserSetUserAgent, browserPdf, browserHighlight, browserRemoveHighlight,
    // Console & Debug (2)
    browserConsoleMessages, browserEvaluate,
    // Tabs (4)
    browserListTabs, browserNewTab, browserSwitchTab, browserCloseTab,
    // Storage (5)
    browserGetCookies, browserSetCookie, browserClearCookies,
    browserLocalStorage, browserSessionStorage,
    // Session (2)
    browserSaveState, browserRestoreState,
    // iFrame (3)
    browserIframeClick, browserIframeType, browserIframeSnapshot,
    // Dialog (1)
    browserHandleDialog,
    // Utility (4)
    browserWait, browserAssert, browserRunCypress, browserGenerateTest,
  ];

  for (const factory of factories) {
    const handler = factory(bridge, state);
    server.registerTool(handler);
  }

  console.error(`[cypress-mcp] Registered ${factories.length} tools`);
}
