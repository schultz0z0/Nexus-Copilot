export const MARKETING_OPS_MCP_TOOLS = [
  'marketing_ops_capabilities_v1',
  'marketing_ops_list_campaigns_v1',
  'marketing_ops_get_campaign_v1',
  'marketing_ops_list_campaign_items_v1',
  'marketing_ops_get_campaign_timeline_v1',
  'marketing_ops_get_content_v1',
  'marketing_ops_get_object_capabilities_v1',
  'marketing_ops_prepare_plan_v1',
  'marketing_ops_execute_plan_v1'
] as const;

type ListedTool = { name?: unknown };

type CapabilityPayload = {
  contractVersion?: unknown;
  features?: { read?: unknown; write?: unknown; structuredPlanExecution?: unknown };
  delegationRequiredForDomain?: unknown;
  conversationalConfirmationRequiredForWrites?: unknown;
  browserWriteExecution?: unknown;
};

export function assertMarketingOpsMcpContract(
  listedTools: ListedTool[],
  capabilities: CapabilityPayload
): void {
  const names = new Set(listedTools.flatMap((tool) => typeof tool.name === 'string' ? [tool.name] : []));
  const missing = MARKETING_OPS_MCP_TOOLS.filter((name) => !names.has(name));
  if (missing.length > 0) throw new Error(`missing MCP tools: ${missing.join(', ')}`);
  if (capabilities.contractVersion !== 1) throw new Error('unexpected MCP contract version');
  if (capabilities.features?.read !== true || capabilities.features?.write !== true) {
    throw new Error('Marketing Ops MCP read/write features are not active');
  }
  if (capabilities.features?.structuredPlanExecution !== true) {
    throw new Error('Marketing Ops structured plan execution is not active');
  }
  if (capabilities.delegationRequiredForDomain !== true) {
    throw new Error('Marketing Ops MCP delegation boundary is not active');
  }
  if (capabilities.conversationalConfirmationRequiredForWrites !== true) {
    throw new Error('Marketing Ops MCP write confirmation boundary is not active');
  }
  if (capabilities.browserWriteExecution !== 'product_ui_only') {
    throw new Error('Marketing Ops browser writes must execute through the product UI');
  }
}
