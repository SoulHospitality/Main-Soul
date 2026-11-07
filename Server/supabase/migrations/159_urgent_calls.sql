-- Urgent calls: customers who asked for a manager or a person. The chatbot (or a staff member) leaves
-- the name, phone and what the problem is; the team calls them back and marks it done.
CREATE TABLE IF NOT EXISTS public.urgent_calls (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  notes text,
  source text NOT NULL DEFAULT 'chatbot',
  channel_kind text,
  chatbot_session_id integer,
  inbox_conversation_id integer,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'called', 'done')),
  outcome text,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  handled_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS urgent_calls_status_idx ON public.urgent_calls (status, created_at DESC);
