/**
 * cypress-mcp Agent Mode Spec
 *
 * This is NOT a regular test file. It starts a persistent agent loop
 * that listens for MCP commands via the bridge and executes them.
 *
 * The browser stays open indefinitely, ready for AI agent control.
 */
describe('cypress-mcp: Agent Mode', () => {
  it('listens for MCP commands', () => {
    // Navigate to baseUrl or blank page
    const baseUrl = Cypress.config('baseUrl') || 'about:blank';
    cy.visit(baseUrl, { failOnStatusCode: false });

    // Log agent mode start
    cy.log('**cypress-mcp agent mode started**');
    cy.log(`Bridge: task-based (port ${Cypress.env('MCP_WS_PORT') || 3456})`);

    // Start the agent loop — polls for commands indefinitely
    cy.mcpAgentLoop();
  });
});
