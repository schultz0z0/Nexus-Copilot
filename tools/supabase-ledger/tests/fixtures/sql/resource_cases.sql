INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', false),
  ('chat-attachments', 'chat-attachments', false);

SELECT cron.schedule(
  'approval-expiry',
  '*/5 * * * *',
  $job$SELECT marketing_ops_private.expire_approvals()$job$
);
