import { ToolHandler, ToolFactory } from '../types';

// ═══════════════════════════════════════════
// 36. browser_handle_dialog [P1]
// ═══════════════════════════════════════════
export const browserHandleDialog: ToolFactory = (bridge): ToolHandler => ({
  name: 'browser_handle_dialog',
  description: 'Handle browser dialogs (alert, confirm, prompt). Set up auto-response before the dialog appears, or respond to a pending dialog.',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['accept', 'dismiss'], description: "Default: 'accept'" },
      promptText: { type: 'string', description: 'Text to enter in prompt() dialogs' },
      autoHandle: { type: 'boolean', description: 'Auto-handle future dialogs. Default: false' },
    },
  },
  async execute(params) {
    const { action = 'accept', promptText, autoHandle = false } = params;
    try {
      // Cypress uses window:alert, window:confirm, window:prompt events
      // We set up a one-time or persistent listener via the bridge
      const script = autoHandle
        ? `
          // Persistent handler
          window.__mcpDialogHandler = {
            action: '${action}',
            promptText: ${promptText ? `'${promptText.replace(/'/g, "\\'")}'` : 'undefined'},
            history: []
          };
          cy.on('window:alert', function(text) {
            window.__mcpDialogHandler.history.push({ type: 'alert', text: text });
            return ${action === 'accept' ? 'true' : 'false'};
          });
          cy.on('window:confirm', function(text) {
            window.__mcpDialogHandler.history.push({ type: 'confirm', text: text });
            return ${action === 'accept' ? 'true' : 'false'};
          });
          return { handler: 'installed', action: '${action}' };
        `
        : `
          // One-time: set up stub for next dialog
          var stub = cy.stub();
          stub.${action === 'accept' ? 'returns(true)' : 'returns(false)'};
          cy.on('window:confirm', stub);
          cy.on('window:alert', stub);
          return { handler: 'one-time', action: '${action}' };
        `;

      const result = await bridge.execute({ type: 'EVAL', payload: { script } });
      return { success: true as const, ...result };
    } catch (err: any) {
      return { error: { code: 'DIALOG_FAILED', message: err.message } };
    }
  },
});
