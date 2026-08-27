type PublicEnv = Record<string, string | boolean | undefined>;
const enabled = (value: string | boolean | undefined) => value === true || value === 'true';

export function marketingOpsFlags(env: PublicEnv) {
  const killed = enabled(env.VITE_MARKETING_OPS_KILL_SWITCH);
  const master = enabled(env.VITE_MARKETING_OPS_ENABLED) && !killed;
  return {
    enabled: master,
    read: master && enabled(env.VITE_MARKETING_OPS_READ),
    write: master && enabled(env.VITE_MARKETING_OPS_WRITE),
    approvals: master && enabled(env.VITE_MARKETING_OPS_APPROVALS),
  };
}
