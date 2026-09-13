ALTER TABLE marketing_ops.campaign_items
  ALTER COLUMN content TYPE jsonb
  USING CASE WHEN content IS NULL THEN NULL ELSE content::jsonb END;

ALTER TABLE marketing_ops.campaign_items
  ADD CONSTRAINT campaign_items_content_object_check
  CHECK (content IS NULL OR jsonb_typeof(content) = 'object');
