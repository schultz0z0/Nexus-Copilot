ALTER TABLE marketing_ops.campaigns
  DROP CONSTRAINT campaigns_briefing_check;

ALTER TABLE marketing_ops.campaigns
  ALTER COLUMN briefing DROP DEFAULT,
  ALTER COLUMN briefing TYPE text
    USING CASE
      WHEN briefing = '{}'::jsonb THEN NULL
      WHEN jsonb_typeof(briefing) = 'string' THEN briefing #>> '{}'
      ELSE briefing::text
    END,
  ALTER COLUMN briefing DROP NOT NULL;

ALTER TABLE marketing_ops.campaigns
  ADD CONSTRAINT campaigns_briefing_length
  CHECK (briefing IS NULL OR char_length(briefing) <= 20000);
