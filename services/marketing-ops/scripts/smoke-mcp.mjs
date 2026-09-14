import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { assertMarketingOpsMcpContract } from '../dist/mcp/smoke.js';

const endpoint = process.env.MARKETING_OPS_MCP_SMOKE_URL ?? 'http://127.0.0.1:8091/mcp';
const client = new Client({ name: 'nexus-marketing-ops-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint));

function payloadFrom(result) {
  if (result.isError) throw new Error('capabilities tool returned an MCP error');
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  if (!text) throw new Error('capabilities tool returned no structured payload');
  return JSON.parse(text).data ?? JSON.parse(text);
}

try {
  await client.connect(transport, { timeout: 5_000 });
  const listed = await client.listTools(undefined, { timeout: 5_000 });
  const result = await client.callTool(
    { name: 'marketing_ops_capabilities_v1', arguments: {} },
    undefined,
    { timeout: 5_000 }
  );
  assertMarketingOpsMcpContract(listed.tools, payloadFrom(result));
  console.log(JSON.stringify({ ok: true, endpoint, tools: listed.tools.length, contractVersion: 1 }));
} finally {
  await client.close().catch(() => undefined);
}
