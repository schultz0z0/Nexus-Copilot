import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Router } from 'express';
import type { MarketingOpsMcpDependencies } from './createServer.js';
import { createMarketingOpsMcpServer } from './createServer.js';

export function createMcpRouter(deps: MarketingOpsMcpDependencies): Router {
  const router = Router();
  router.post('/mcp', async (request, response) => {
    const server = createMarketingOpsMcpServer(deps);
    const transport = new StreamableHTTPServerTransport(
      { sessionIdGenerator: undefined } as unknown as StreamableHTTPServerTransportOptions
    );
    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    } finally {
      response.on('close', () => { void transport.close(); void server.close(); });
    }
  });
  router.get('/mcp', (_request, response) => response.status(405).json({ error: 'method_not_allowed' }));
  router.delete('/mcp', (_request, response) => response.status(405).json({ error: 'method_not_allowed' }));
  return router;
}
