import { randomUUID } from 'crypto';
import { BridgeMessage } from '../tools/types';
import { StateManager } from '../state/state-manager';

interface PendingCommand {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeServer {
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandQueue: BridgeMessage[] = [];
  private debug: boolean;

  constructor(
    private port: number,
    private state: StateManager,
    options: { debug?: boolean } = {}
  ) {
    this.debug = options.debug || false;
  }

  start() {
    this.log(`Bridge server ready (task-based, port config: ${this.port})`);
  }

  stop() {
    this.pendingCommands.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Bridge shutting down'));
    });
    this.pendingCommands.clear();
    this.commandQueue = [];
  }

  /**
   * Gửi command đến Cypress browser và chờ response.
   * Tool handlers gọi method này.
   */
  async execute(message: Omit<BridgeMessage, 'id'>): Promise<any> {
    const id = randomUUID();
    const timeout = message.timeout || 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Bridge command timed out after ${timeout}ms (type: ${message.type})`));
      }, timeout);

      this.pendingCommands.set(id, { resolve, reject, timer });

      this.commandQueue.push({
        id,
        type: message.type,
        payload: message.payload,
        timeout,
      });

      this.log(`Queued: ${id.substring(0, 8)} [${message.type}]`);
    });
  }

  /**
   * Browser polls this via cy.task('mcpBridgePoll')
   */
  getPendingCommand(): BridgeMessage | null {
    const cmd = this.commandQueue.shift() || null;
    if (cmd) {
      this.log(`Dispatched: ${cmd.id.substring(0, 8)} [${cmd.type}]`);
    }
    return cmd;
  }

  /**
   * Browser responds via cy.task('mcpBridgeResponse')
   */
  handleBrowserResponse(response: { id: string; data?: any; error?: string }) {
    const pending = this.pendingCommands.get(response.id);
    if (!pending) {
      this.log(`No pending command for: ${response.id.substring(0, 8)}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCommands.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.data);
    }
  }

  get queueLength(): number {
    return this.commandQueue.length;
  }

  get pendingCount(): number {
    return this.pendingCommands.size;
  }

  private log(msg: string) {
    if (this.debug) {
      console.error(`[cypress-mcp:bridge] ${msg}`);
    }
  }
}
