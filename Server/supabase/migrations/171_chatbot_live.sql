-- Chatbot goes live: real Instagram / Messenger conversations and website chat, a blocklist,
-- and guest care (pre-arrival emails, rating requests, re-engagement).

-- The website chat is a Live Inbox channel too, so agents answer it after a hand-off.
ALTER TABLE public.inbox_channels DROP CONSTRAINT IF EXISTS inbox_channels_kind_check;
ALTER TABLE public.inbox_channels ADD CONSTRAINT inbox_channels_kind_check
  CHECK (kind IN ('messenger', 'instagram', 'whatsapp', 'website'));

-- mode: 'test' (the CEO test page), 'live' (a real Instagram / Messenger conversation), 'website' (the site chat).
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'test';
ALTER TABLE public.chatbot_sessions DROP CONSTRAINT IF EXISTS chatbot_sessions_mode_check;
ALTER TABLE public.chatbot_sessions ADD CONSTRAINT chatbot_sessions_mode_check CHECK (mode IN ('test', 'live', 'website'));
-- The real inbox conversation a live session answers (one session per conversation).
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS live_conversation_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS chatbot_sessions_live_conv_uq
  ON public.chatbot_sessions (live_conversation_id) WHERE live_conversation_id IS NOT NULL;
-- A person replied: the bot stays quiet in this conversation until then.
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS paused_until timestamptz;
-- Last inbox message the bot has read, so a burst of customer messages is answered once.
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS last_seen_message_id integer NOT NULL DEFAULT 0;
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS handed_off_at timestamptz;
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS phone text;

-- Photos and voice notes the customer sent in the website chat.
ALTER TABLE public.chatbot_messages ADD COLUMN IF NOT EXISTS attachments jsonb;

-- The blocklist: the single source of truth. A blocked customer gets no bot replies on any channel.
CREATE TABLE IF NOT EXISTS public.guest_blocklist (
  id                serial PRIMARY KEY,
  phone             text,
  inbox_customer_id integer,
  reason            text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_cancellations')),
  active            boolean NOT NULL DEFAULT true,
  created_by        integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  removed_by        integer,
  removed_at        timestamptz
);
CREATE INDEX IF NOT EXISTS guest_blocklist_phone_idx ON public.guest_blocklist (phone) WHERE active;
CREATE INDEX IF NOT EXISTS guest_blocklist_customer_idx ON public.guest_blocklist (inbox_customer_id) WHERE active;

-- Automatic guest messages, one per kind per stay (pre-arrival, rating request, re-engagement).
CREATE TABLE IF NOT EXISTS public.guest_outreach (
  id             serial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('prearrival', 'review_request', 'reengage')),
  reservation_id integer NOT NULL,
  channel        text NOT NULL DEFAULT 'email',
  recipient      text,
  status         text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, reservation_id)
);

-- Guest ratings out of 5, asked after checkout.
CREATE TABLE IF NOT EXISTS public.guest_reviews (
  id             serial PRIMARY KEY,
  reservation_id integer NOT NULL UNIQUE,
  token          text NOT NULL UNIQUE,
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  comment        text,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  rated_at       timestamptz,
  google_offered boolean NOT NULL DEFAULT false
);
