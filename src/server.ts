import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFocusmateAuthTool } from './tools/focusmate-auth.js';
import { registerBookSessionTool } from './tools/book-session.js';
import { registerCancelSessionTool } from './tools/cancel-session.js';
import { registerListSessionsTool } from './tools/list-sessions.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'focusmate-mcp',
    version: '1.0.0'
  });

  // Register all tools
  registerFocusmateAuthTool(server);
  registerBookSessionTool(server);
  registerCancelSessionTool(server);
  registerListSessionsTool(server);

  return server;
}
