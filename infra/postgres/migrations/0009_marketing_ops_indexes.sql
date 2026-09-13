CREATE INDEX campaigns_tenant_updated_idx
  ON marketing_ops.campaigns (tenant_id, updated_at DESC, id DESC);
CREATE INDEX campaigns_tenant_status_updated_idx
  ON marketing_ops.campaigns (tenant_id, status, updated_at DESC, id DESC);
CREATE INDEX campaigns_search_idx ON marketing_ops.campaigns USING gin (search_vector);
CREATE INDEX campaigns_created_by_fk_idx ON marketing_ops.campaigns (created_by);
CREATE INDEX campaigns_updated_by_fk_idx ON marketing_ops.campaigns (updated_by);

CREATE INDEX campaign_members_tenant_user_idx
  ON marketing_ops.campaign_members (tenant_id, user_id, campaign_id);
CREATE INDEX campaign_members_created_by_fk_idx ON marketing_ops.campaign_members (created_by);

CREATE INDEX campaign_materials_campaign_order_idx
  ON marketing_ops.campaign_materials (tenant_id, campaign_id, created_at DESC, id DESC)
  WHERE unlinked_at IS NULL;
CREATE INDEX campaign_materials_artifact_idx ON marketing_ops.campaign_materials (artifact_id);
CREATE INDEX campaign_materials_owner_fk_idx ON marketing_ops.campaign_materials (artifact_owner_id);

CREATE INDEX campaign_items_schedule_idx
  ON marketing_ops.campaign_items (tenant_id, starts_at, due_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX campaign_items_campaign_order_idx
  ON marketing_ops.campaign_items (tenant_id, campaign_id, due_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX campaign_items_assignee_order_idx
  ON marketing_ops.campaign_items (tenant_id, assignee_user_id, due_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX campaign_items_created_by_fk_idx ON marketing_ops.campaign_items (created_by);
CREATE INDEX campaign_items_updated_by_fk_idx ON marketing_ops.campaign_items (updated_by);

CREATE INDEX item_dependencies_tenant_parent_idx
  ON marketing_ops.item_dependencies (tenant_id, depends_on_item_id, item_id);
CREATE INDEX item_dependencies_campaign_fk_idx
  ON marketing_ops.item_dependencies (tenant_id, campaign_id);

CREATE INDEX content_assets_item_order_idx
  ON marketing_ops.content_assets (tenant_id, item_id, created_at, id);
CREATE INDEX content_assets_campaign_fk_idx ON marketing_ops.content_assets (tenant_id, campaign_id);
CREATE INDEX content_assets_created_by_fk_idx ON marketing_ops.content_assets (created_by);
CREATE INDEX content_assets_updated_by_fk_idx ON marketing_ops.content_assets (updated_by);
CREATE INDEX content_versions_tenant_asset_order_idx
  ON marketing_ops.content_versions (tenant_id, asset_id, version_number DESC);
CREATE INDEX content_versions_created_by_fk_idx ON marketing_ops.content_versions (created_by);

CREATE INDEX item_artifacts_item_order_idx
  ON marketing_ops.item_artifacts (tenant_id, item_id, created_at DESC, id DESC)
  WHERE unlinked_at IS NULL;
CREATE INDEX item_artifacts_asset_fk_idx ON marketing_ops.item_artifacts (tenant_id, asset_id);
CREATE INDEX item_artifacts_artifact_idx ON marketing_ops.item_artifacts (artifact_id);

CREATE INDEX action_packages_campaign_fk_idx ON marketing_ops.action_packages (tenant_id, campaign_id);
CREATE INDEX action_packages_created_by_fk_idx ON marketing_ops.action_packages (created_by);
CREATE INDEX action_packages_authorized_request_fk_idx ON marketing_ops.action_packages (tenant_id, authorized_by_request_id);

CREATE INDEX approval_requests_requested_by_fk_idx ON marketing_ops.approval_requests (requested_by);
CREATE INDEX approval_requests_content_version_fk_idx
  ON marketing_ops.approval_requests (tenant_id, content_asset_id, content_version_number);
CREATE INDEX approval_requests_action_package_fk_idx
  ON marketing_ops.approval_requests (tenant_id, action_package_id);
CREATE INDEX approval_requests_supersedes_fk_idx
  ON marketing_ops.approval_requests (tenant_id, supersedes_request_id);
CREATE INDEX approval_requests_queue_order_idx
  ON marketing_ops.approval_requests (tenant_id, status, created_at DESC, id DESC);

CREATE INDEX approval_decisions_request_fk_idx
  ON marketing_ops.approval_decisions (tenant_id, request_id, created_at DESC);
CREATE INDEX approval_decisions_decided_by_fk_idx ON marketing_ops.approval_decisions (decided_by);

CREATE INDEX audit_events_tenant_order_idx
  ON marketing_ops.audit_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX audit_events_entity_idx
  ON marketing_ops.audit_events (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_events_actor_user_fk_idx ON marketing_ops.audit_events (actor_user_id);
CREATE INDEX audit_events_chat_run_idx ON marketing_ops.audit_events (tenant_id, chat_session_id, run_id);
CREATE INDEX audit_events_tool_call_idx ON marketing_ops.audit_events (tenant_id, tool_call_id);

CREATE INDEX domain_events_pending_idx
  ON marketing_ops.domain_events (available_at, occurred_at, id)
  WHERE published_at IS NULL;
CREATE INDEX domain_events_aggregate_idx
  ON marketing_ops.domain_events (tenant_id, aggregate_type, aggregate_id, occurred_at, id);

CREATE INDEX idempotency_records_expiry_idx ON marketing_ops.idempotency_records (expires_at);
CREATE INDEX delegation_uses_expiry_idx ON marketing_ops.delegation_uses (expires_at);
CREATE INDEX delegation_uses_actor_fk_idx ON marketing_ops.delegation_uses (actor_id);

CREATE INDEX in_app_notifications_user_order_idx
  ON marketing_ops.in_app_notifications (tenant_id, user_id, occurred_at DESC, id DESC);
CREATE INDEX in_app_notifications_unread_idx
  ON marketing_ops.in_app_notifications (tenant_id, user_id, occurred_at DESC, id DESC)
  WHERE read_at IS NULL;
CREATE INDEX in_app_notifications_campaign_fk_idx ON marketing_ops.in_app_notifications (tenant_id, campaign_id);
CREATE INDEX in_app_notifications_item_fk_idx ON marketing_ops.in_app_notifications (tenant_id, item_id);
CREATE INDEX in_app_notifications_approval_fk_idx ON marketing_ops.in_app_notifications (tenant_id, approval_request_id);

