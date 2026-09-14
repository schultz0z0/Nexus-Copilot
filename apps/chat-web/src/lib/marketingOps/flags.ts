type PublicEnv = Record<string, string | boolean | undefined>;
const enabled = (value: string | boolean | undefined) => value === true || value === 'true';

export function marketingOpsFlags(env: PublicEnv) {
  const killed = enabled(env.VITE_MARKETING_OPS_KILL_SWITCH);
  const master = enabled(env.VITE_MARKETING_OPS_ENABLED) && !killed;
  const read = master && enabled(env.VITE_MARKETING_OPS_READ);
  const write = master && enabled(env.VITE_MARKETING_OPS_WRITE);
  return {
    enabled: master,
    read,
    write,
    approvals: master && enabled(env.VITE_MARKETING_OPS_APPROVALS),
    structuredPlanExecution: read && write && enabled(env.VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION),
  };
}
