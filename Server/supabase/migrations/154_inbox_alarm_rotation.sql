-- Snooze alarm: who snoozed the chat and when it is due. The alarm rings once it is due and the
-- red bell stays until that person has opened the chat and left it (or closed it).
ALTER TABLE public.inbox_conversations
  ADD COLUMN IF NOT EXISTS snooze_alarm_at bigint,
  ADD COLUMN IF NOT EXISTS snooze_alarm_by integer,
  ADD COLUMN IF NOT EXISTS snooze_alarm_seen smallint NOT NULL DEFAULT 0,
  -- A guest who writes again after a long silence starts a new rotation: the chat goes to the next
  -- agent in turn instead of whoever had it before.
  ADD COLUMN IF NOT EXISTS rotate_pending smallint NOT NULL DEFAULT 0;

-- Saved replies: who wrote each one, so agents can edit and remove their own.
ALTER TABLE public.inbox_templates
  ADD COLUMN IF NOT EXISTS updated_at bigint;

CREATE INDEX IF NOT EXISTS inbox_assignments_reason_at_idx ON public.inbox_assignments (reason, at);
