-- Owner comments: owners post comments about a unit (or in general) from the owner portal;
-- Owner Experience and Unit Acquisition staff reply in the same thread.

CREATE TABLE IF NOT EXISTS public.owner_comment_threads (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  subject varchar(200) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_from varchar(16) NOT NULL DEFAULT 'owner' CHECK (last_message_from IN ('owner', 'staff')),
  owner_last_read_at timestamptz,
  staff_last_read_at timestamptz,
  resolved_by integer REFERENCES public.staff_users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.owner_comment_messages (
  id serial PRIMARY KEY,
  thread_id integer NOT NULL REFERENCES public.owner_comment_threads(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES public.staff_users(id),
  from_owner boolean NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_comment_threads_owner_idx
  ON public.owner_comment_threads (owner_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS owner_comment_threads_status_idx
  ON public.owner_comment_threads (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS owner_comment_messages_thread_idx
  ON public.owner_comment_messages (thread_id, created_at);

ALTER TABLE public.owner_comment_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_comment_messages ENABLE ROW LEVEL SECURITY;
