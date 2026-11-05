-- Guest chatbot (test stage): conversations about units, prices and availability.
-- When the bot can't help, the chat is handed to the Live Inbox and agents take over.

CREATE TABLE IF NOT EXISTS public.chatbot_sessions (
  id                    serial PRIMARY KEY,
  token                 text NOT NULL UNIQUE,
  -- Where the customer is "writing from": the test page pretends to be Instagram or Messenger.
  channel_kind          text NOT NULL DEFAULT 'instagram' CHECK (channel_kind IN ('instagram', 'messenger', 'website')),
  customer_name         text NOT NULL,
  status                text NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'handed_off')),
  handoff_reason        text,
  inbox_conversation_id integer,
  -- Units already suggested, so "show me others" never repeats one.
  shown_unit_ids        text[] NOT NULL DEFAULT '{}',
  -- The exact conversation sent to the AI (kept append-only, thinking blocks included),
  -- in the format of the provider that wrote it ('gemini' or 'claude').
  ai_provider           text,
  history               jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens          integer NOT NULL DEFAULT 0,
  output_tokens         integer NOT NULL DEFAULT 0,
  created_by            integer REFERENCES public.staff_users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- What the chat window shows: customer, bot, agent and system lines, plus any unit cards.
CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id               serial PRIMARY KEY,
  session_id       integer NOT NULL REFERENCES public.chatbot_sessions(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('customer', 'bot', 'agent', 'system')),
  body             text NOT NULL DEFAULT '',
  units            jsonb,
  inbox_message_id integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chatbot_messages_session_idx ON public.chatbot_messages (session_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS chatbot_messages_inbox_uq ON public.chatbot_messages (inbox_message_id) WHERE inbox_message_id IS NOT NULL;
