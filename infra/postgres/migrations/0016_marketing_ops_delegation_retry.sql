ALTER TABLE marketing_ops.delegation_uses
  DROP CONSTRAINT delegation_uses_tenant_id_actor_id_operation_idempotency_ke_key;

CREATE INDEX delegation_uses_operation_lookup_idx
  ON marketing_ops.delegation_uses (tenant_id, actor_id, operation, idempotency_key);
