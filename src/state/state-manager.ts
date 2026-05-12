import { CapturedRequest, ConsoleMessage, CommandHistoryEntry } from '../tools/types';

export class StateManager {
  private _currentUrl: string = '';
  private _currentTitle: string = '';
  private _viewportWidth: number = 1280;
  private _viewportHeight: number = 720;
  private _networkRequests: CapturedRequest[] = [];
  private _consoleMessages: ConsoleMessage[] = [];
  private _activeMocks: Map<string, { url: string; method: string }> = new Map();
  private _commandHistory: CommandHistoryEntry[] = [];
  private _tabState: Map<string, { url: string; title: string; active: boolean }> = new Map();

  // ── Getters ──
  get currentUrl() { return this._currentUrl; }
  get currentTitle() { return this._currentTitle; }
  get viewportWidth() { return this._viewportWidth; }
  get viewportHeight() { return this._viewportHeight; }
  get networkRequests() { return this._networkRequests; }
  get consoleMessages() { return this._consoleMessages; }
  get activeMocks() { return this._activeMocks; }
  get commandHistory() { return this._commandHistory; }
  get tabState() { return this._tabState; }

  // ── Updaters ──
  updateCurrentPage(info: { url: string; title: string }) {
    this._currentUrl = info.url;
    this._currentTitle = info.title;
  }

  updateViewport(width: number, height: number) {
    this._viewportWidth = width;
    this._viewportHeight = height;
  }

  updateNetworkRequests(requests: CapturedRequest[]) {
    this._networkRequests = requests;
  }

  addNetworkRequest(req: CapturedRequest) {
    if (this._networkRequests.length >= 500) {
      this._networkRequests = this._networkRequests.slice(-250);
    }
    this._networkRequests.push(req);
  }

  updateConsoleMessages(messages: ConsoleMessage[]) {
    this._consoleMessages = messages;
  }

  addConsoleMessage(msg: ConsoleMessage) {
    this._consoleMessages.push(msg);
    if (this._consoleMessages.length > 500) {
      this._consoleMessages = this._consoleMessages.slice(-250);
    }
  }

  clearConsoleMessages() {
    this._consoleMessages = [];
  }

  addMock(id: string, mock: { url: string; method: string }) {
    this._activeMocks.set(id, mock);
  }

  removeMock(id: string) {
    this._activeMocks.delete(id);
  }

  addToHistory(entry: CommandHistoryEntry) {
    this._commandHistory.push(entry);
    if (this._commandHistory.length > 200) {
      this._commandHistory = this._commandHistory.slice(-100);
    }
  }

  reset() {
    this._currentUrl = '';
    this._currentTitle = '';
    this._networkRequests = [];
    this._consoleMessages = [];
    this._activeMocks.clear();
    this._commandHistory = [];
    this._tabState.clear();
  }
}
