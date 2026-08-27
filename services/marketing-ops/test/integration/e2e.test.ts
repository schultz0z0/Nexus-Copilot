import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

const enabled = process.env.MARKETING_OPS_E2E === 'true';
const baseUrl = process.env.MARKETING_OPS_E2E_URL ?? 'http://127.0.0.1:8091';

describe.runIf(enabled)('Marketing Ops container E2E', () => {
  it('serves health and database readiness', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/ready`)).status).toBe(200);
  });

  it('serves MCP capabilities over stateless Streamable HTTP', async () => {
    const client = new Client({ name: 'phase-1-local-gate', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
    const result = await client.callTool({ name: 'marketing_ops_capabilities_v1', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ contractVersion: 1 });
    await client.close();
  });
});
