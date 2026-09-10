CREATE SCHEMA app;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE TYPE app.mood AS ENUM ('draft', 'ready');
CREATE SEQUENCE app.item_seq;

CREATE TABLE app.items (
  id uuid,
  tenant_id uuid NOT NULL,
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT items_tenant_unique UNIQUE (tenant_id, id)
);

ALTER TABLE app.items ADD COLUMN name text;
ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.items FORCE ROW LEVEL SECURITY;

CREATE INDEX items_tenant_idx ON app.items (tenant_id);
CREATE VIEW app.item_view AS SELECT id FROM app.items;

CREATE FUNCTION app.touch(p_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT p_id
$function$;

CREATE TRIGGER items_touch
BEFORE INSERT ON app.items
FOR EACH ROW EXECUTE FUNCTION app.touch();

CREATE POLICY "Tenant read" ON app.items FOR SELECT USING (true);
GRANT SELECT, UPDATE ON TABLE app.items TO nexus_app;
REVOKE UPDATE ON TABLE app.items FROM nexus_app;
ALTER TABLE app.items OWNER TO nexus_owner;
COMMENT ON TABLE app.items IS 'Inventory fixture';
DROP VIEW app.item_view;
