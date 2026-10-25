-- A chat can belong to more than one staff member. Replying adds the sender
-- without removing the people already on it.

CREATE TABLE IF NOT EXISTS public.inbox_conversation_assignees (
  conversation_id integer NOT NULL REFERENCES public.inbox_conversations(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  assigned_at bigint NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_assignees_user
  ON public.inbox_conversation_assignees(user_id);

INSERT INTO public.inbox_conversation_assignees (conversation_id, user_id, assigned_at)
SELECT id, assigned_user_id, COALESCE(assigned_at, last_message_at, created_at)
FROM public.inbox_conversations
WHERE assigned_user_id IS NOT NULL
ON CONFLICT DO NOTHING;
