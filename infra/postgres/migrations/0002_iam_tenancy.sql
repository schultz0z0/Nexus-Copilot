CREATE TABLE iam.tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tenants_slug_format_check
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT tenants_display_name_check
    CHECK (char_length(display_name) BETWEEN 1 AND 160),
  CONSTRAINT tenants_timestamp_order_check
    CHECK (updated_at >= created_at)
);

CREATE TABLE iam.principals (
  id uuid PRIMARY KEY,
  external_subject text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  disabled_at timestamptz,
  CONSTRAINT principals_external_subject_check
    CHECK (external_subject IS NULL OR char_length(external_subject) BETWEEN 1 AND 255),
  CONSTRAINT principals_disabled_at_check
    CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE TABLE iam.memberships (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, principal_id),
  CONSTRAINT memberships_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES iam.tenants (id) ON DELETE CASCADE,
  CONSTRAINT memberships_principal_fk
    FOREIGN KEY (principal_id) REFERENCES iam.principals (id) ON DELETE CASCADE,
  CONSTRAINT memberships_role_check
    CHECK (role IN ('member', 'manager', 'admin')),
  CONSTRAINT memberships_timestamp_order_check
    CHECK (updated_at >= created_at)
);

CREATE INDEX memberships_principal_id_idx
  ON iam.memberships (principal_id);

CREATE INDEX memberships_active_tenant_idx
  ON iam.memberships (tenant_id, principal_id)
  WHERE active;

REVOKE ALL ON iam.tenants FROM PUBLIC;
REVOKE ALL ON iam.principals FROM PUBLIC;
REVOKE ALL ON iam.memberships FROM PUBLIC;

