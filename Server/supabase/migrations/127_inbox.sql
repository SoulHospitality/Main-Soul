-- Omnichannel inbox (Messenger, Instagram, WhatsApp) with SLA routing, leads and follow-ups.
-- Inbox timestamps are epoch milliseconds (bigint) so SLA arithmetic stays exact.

CREATE TABLE IF NOT EXISTS public.inbox_agents (
  staff_user_id    integer PRIMARY KEY REFERENCES public.staff_users(id) ON DELETE CASCADE,
  inbox_role       text CHECK (inbox_role IN ('none','agent','supervisor','manager')),
  in_rotation      smallint,
  max_open         integer NOT NULL DEFAULT 30,
  presence         text NOT NULL DEFAULT 'offline' CHECK (presence IN ('online','away','offline')),
  last_seen_at     bigint,
  last_assigned_at bigint
);

-- One row per staff member: the PMS role decides the default inbox role, inbox_agents can override it.
CREATE OR REPLACE VIEW public.inbox_users AS
SELECT su.id,
       COALESCE(NULLIF(su.full_name, ''), su.username) AS name,
       su.role AS pms_role,
       CASE
         WHEN su.role = 'admin' THEN 'admin'
         WHEN a.inbox_role IS NOT NULL THEN NULLIF(a.inbox_role, 'none')
         WHEN su.role = 'reservations_manager' THEN 'manager'
         WHEN su.role IN ('reservations','reservations_web','reservations_manual') THEN 'agent'
         ELSE NULL
       END AS role,
       CASE WHEN COALESCE(su.is_active, 0) = 1 THEN 1 ELSE 0 END AS active,
       COALESCE(a.in_rotation,
         CASE WHEN su.role IN ('reservations','reservations_web','reservations_manual') THEN 1 ELSE 0 END
       )::int AS in_rotation,
       COALESCE(a.max_open, 30) AS max_open,
       COALESCE(a.presence, 'offline') AS presence,
       a.last_seen_at,
       a.last_assigned_at,
       a.inbox_role AS role_override
FROM public.staff_users su
LEFT JOIN public.inbox_agents a ON a.staff_user_id = su.id;

CREATE TABLE IF NOT EXISTS public.inbox_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inbox_channels (
  id               serial PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('messenger','instagram','whatsapp')),
  name             text NOT NULL,
  external_id      text NOT NULL,
  page_id          text,
  waba_id          text,
  access_token_enc text,
  active           smallint NOT NULL DEFAULT 1,
  created_at       bigint NOT NULL,
  UNIQUE (kind, external_id)
);

CREATE TABLE IF NOT EXISTS public.inbox_customers (
  id           serial PRIMARY KEY,
  name         text,
  phone        text,
  email        text,
  avatar_url   text,
  notes        text,
  is_simulated smallint NOT NULL DEFAULT 0,
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_customers_phone ON public.inbox_customers(phone);

CREATE TABLE IF NOT EXISTS public.inbox_customer_identities (
  id           serial PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES public.inbox_customers(id),
  channel_id   integer NOT NULL REFERENCES public.inbox_channels(id),
  channel_kind text NOT NULL,
  external_id  text NOT NULL,
  display_name text,
  username     text,
  created_at   bigint NOT NULL,
  UNIQUE (channel_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_identities_customer ON public.inbox_customer_identities(customer_id);

CREATE TABLE IF NOT EXISTS public.inbox_conversations (
  id                   serial PRIMARY KEY,
  customer_id          integer NOT NULL REFERENCES public.inbox_customers(id),
  identity_id          integer NOT NULL REFERENCES public.inbox_customer_identities(id),
  channel_id           integer NOT NULL REFERENCES public.inbox_channels(id),
  channel_kind         text NOT NULL,
  status               text NOT NULL DEFAULT 'needs_reply'
                       CHECK (status IN ('needs_reply','waiting_customer','snoozed','closed')),
  type                 text NOT NULL DEFAULT 'unknown'
                       CHECK (type IN ('unknown','sales_lead','existing_guest','owner','broker','complaint','supplier','spam','other')),
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  assigned_user_id     integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  assigned_at          bigint,
  awaiting_since       bigint,
  sla_start_at         bigint,
  sla_due_at           bigint,
  sla_warned           smallint NOT NULL DEFAULT 0,
  sla_breached         smallint NOT NULL DEFAULT 0,
  escalation_level     smallint NOT NULL DEFAULT 0,
  reassign_count       smallint NOT NULL DEFAULT 0,
  last_message_at      bigint,
  last_inbound_at      bigint,
  last_message_preview text,
  unread_count         integer NOT NULL DEFAULT 0,
  snooze_until         bigint,
  current_lead_id      integer,
  source               text,
  ad_id                text,
  ad_ref_json          text,
  ai_json              text,
  ai_summary           text,
  night_ai_replies     integer NOT NULL DEFAULT 0,
  created_at           bigint NOT NULL,
  closed_at            bigint
);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_identity ON public.inbox_conversations(identity_id);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_customer ON public.inbox_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_assigned ON public.inbox_conversations(assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_status ON public.inbox_conversations(status, last_message_at);

CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id               serial PRIMARY KEY,
  conversation_id  integer NOT NULL REFERENCES public.inbox_conversations(id),
  direction        text NOT NULL CHECK (direction IN ('in','out')),
  sender_type      text NOT NULL CHECK (sender_type IN ('customer','agent','ai','auto','external')),
  user_id          integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  channel_kind     text NOT NULL,
  external_id      text,
  body             text,
  attachments_json text,
  delivery_status  text NOT NULL DEFAULT 'received'
                   CHECK (delivery_status IN ('received','pending','sent','delivered','read','failed')),
  error            text,
  created_at       bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_messages_external
  ON public.inbox_messages(channel_kind, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_conv ON public.inbox_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_created ON public.inbox_messages(created_at);

CREATE TABLE IF NOT EXISTS public.inbox_notes (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES public.inbox_conversations(id),
  user_id         integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_notes_conv ON public.inbox_notes(conversation_id);

CREATE TABLE IF NOT EXISTS public.inbox_lead_stages (
  key                text PRIMARY KEY,
  name_en            text NOT NULL,
  name_ar            text NOT NULL,
  position           integer NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('open','won','lost','invalid')),
  requires_phone     smallint NOT NULL DEFAULT 0,
  requires_follow_up smallint NOT NULL DEFAULT 0,
  is_qualified       smallint NOT NULL DEFAULT 0,
  active             smallint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.inbox_lost_reasons (
  key      text PRIMARY KEY,
  name_en  text NOT NULL,
  name_ar  text NOT NULL,
  position integer NOT NULL,
  active   smallint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.inbox_leads (
  id              serial PRIMARY KEY,
  customer_id     integer NOT NULL REFERENCES public.inbox_customers(id),
  conversation_id integer REFERENCES public.inbox_conversations(id),
  stage_key       text NOT NULL REFERENCES public.inbox_lead_stages(key),
  owner_user_id   integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  source          text,
  campaign        text,
  project         text,
  unit_type       text,
  unit_id         uuid REFERENCES public.units(id) ON DELETE SET NULL,
  check_in        text,
  check_out       text,
  guests          integer,
  budget          text,
  temperature     text CHECK (temperature IN ('hot','warm','cold') OR temperature IS NULL),
  lost_reason_key text REFERENCES public.inbox_lost_reasons(key),
  lost_note       text,
  booking_ref     text,
  booking_value   numeric(14,2),
  reservation_id  integer REFERENCES public.reservations(id) ON DELETE SET NULL,
  created_by      integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL,
  qualified_at    bigint,
  won_at          bigint,
  closed_at       bigint
);
CREATE INDEX IF NOT EXISTS idx_inbox_leads_conv ON public.inbox_leads(conversation_id);
CREATE INDEX IF NOT EXISTS idx_inbox_leads_customer ON public.inbox_leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_inbox_leads_stage ON public.inbox_leads(stage_key, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_leads_created ON public.inbox_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_leads_reservation ON public.inbox_leads(reservation_id);

CREATE TABLE IF NOT EXISTS public.inbox_lead_stage_history (
  id         serial PRIMARY KEY,
  lead_id    integer NOT NULL REFERENCES public.inbox_leads(id),
  from_stage text,
  to_stage   text NOT NULL,
  user_id    integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  at         bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_lsh_lead ON public.inbox_lead_stage_history(lead_id, at);

CREATE TABLE IF NOT EXISTS public.inbox_follow_ups (
  id               serial PRIMARY KEY,
  lead_id          integer REFERENCES public.inbox_leads(id),
  conversation_id  integer REFERENCES public.inbox_conversations(id),
  assigned_user_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  due_at           bigint NOT NULL,
  note             text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  notified         smallint NOT NULL DEFAULT 0,
  escalated        smallint NOT NULL DEFAULT 0,
  created_by       integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at       bigint NOT NULL,
  done_at          bigint,
  done_by          integer REFERENCES public.staff_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_followups_due ON public.inbox_follow_ups(status, due_at);

-- Every human reply to a waiting customer: the raw material for response-time KPIs.
CREATE TABLE IF NOT EXISTS public.inbox_responses (
  id               serial PRIMARY KEY,
  conversation_id  integer NOT NULL REFERENCES public.inbox_conversations(id),
  user_id          integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  assigned_user_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  channel_kind     text NOT NULL,
  awaiting_since   bigint NOT NULL,
  sla_start_at     bigint NOT NULL,
  responded_at     bigint NOT NULL,
  seconds_raw      integer NOT NULL,
  seconds_sla      integer NOT NULL,
  within_sla       smallint NOT NULL,
  is_first         smallint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_responses_at ON public.inbox_responses(responded_at);

CREATE TABLE IF NOT EXISTS public.inbox_sla_events (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES public.inbox_conversations(id),
  user_id         integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('warning','breach','escalation_supervisor','escalation_manager')),
  at              bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_sla_events_at ON public.inbox_sla_events(at);

CREATE TABLE IF NOT EXISTS public.inbox_assignments (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES public.inbox_conversations(id),
  from_user_id    integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  to_user_id      integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  by_user_id      integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  reason          text NOT NULL,
  at              bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_assignments_conv ON public.inbox_assignments(conversation_id, at);
CREATE INDEX IF NOT EXISTS idx_inbox_assignments_at ON public.inbox_assignments(at);

-- Append-only audit log.
CREATE TABLE IF NOT EXISTS public.inbox_events (
  id              bigserial PRIMARY KEY,
  conversation_id integer,
  lead_id         integer,
  user_id         integer,
  type            text NOT NULL,
  data_json       text,
  at              bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_events_conv ON public.inbox_events(conversation_id, at);
CREATE INDEX IF NOT EXISTS idx_inbox_events_lead ON public.inbox_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_inbox_events_at ON public.inbox_events(at);

CREATE OR REPLACE FUNCTION public.inbox_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inbox audit log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inbox_events_no_change ON public.inbox_events;
CREATE TRIGGER inbox_events_no_change BEFORE UPDATE OR DELETE ON public.inbox_events
  FOR EACH ROW EXECUTE FUNCTION public.inbox_events_append_only();

CREATE TABLE IF NOT EXISTS public.inbox_comments (
  id                 serial PRIMARY KEY,
  channel_id         integer NOT NULL REFERENCES public.inbox_channels(id),
  platform           text NOT NULL CHECK (platform IN ('facebook','instagram')),
  external_id        text NOT NULL,
  post_id            text,
  post_link          text,
  parent_external_id text,
  author_external_id text,
  author_name        text,
  body               text,
  created_at         bigint NOT NULL,
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','handled')),
  assigned_user_id   integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  public_reply       text,
  public_reply_at    bigint,
  public_reply_by    integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  private_reply_at   bigint,
  private_reply_by   integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  customer_id        integer REFERENCES public.inbox_customers(id),
  lead_id            integer REFERENCES public.inbox_leads(id),
  handled_at         bigint,
  handled_by         integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  UNIQUE (platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_inbox_comments_status ON public.inbox_comments(status, created_at);

CREATE TABLE IF NOT EXISTS public.inbox_templates (
  id         serial PRIMARY KEY,
  title      text NOT NULL,
  body       text NOT NULL,
  shortcut   text,
  active     smallint NOT NULL DEFAULT 1,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inbox_webhook_log (
  id          bigserial PRIMARY KEY,
  object      text,
  received_at bigint NOT NULL,
  payload     text,
  error       text
);
CREATE INDEX IF NOT EXISTS idx_inbox_webhook_log_at ON public.inbox_webhook_log(received_at);

INSERT INTO public.inbox_lead_stages (key, name_en, name_ar, position, kind, requires_phone, requires_follow_up, is_qualified) VALUES
  ('new', 'New', 'جديد', 1, 'open', 0, 0, 0),
  ('qualifying', 'Qualifying', 'جاري التأهيل', 2, 'open', 0, 0, 0),
  ('qualified', 'Qualified', 'مؤهل', 3, 'open', 1, 0, 1),
  ('quoted', 'Price sent', 'تم إرسال السعر', 4, 'open', 1, 1, 1),
  ('negotiating', 'Negotiating', 'تفاوض', 5, 'open', 1, 1, 1),
  ('booking_requested', 'Booking requested', 'طلب حجز', 6, 'open', 1, 0, 1),
  ('won', 'Booked', 'تم الحجز', 7, 'won', 1, 0, 1),
  ('lost', 'Lost', 'مفقود', 8, 'lost', 0, 0, 0),
  ('invalid', 'Invalid', 'غير صالح', 9, 'invalid', 0, 0, 0)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.inbox_lost_reasons (key, name_en, name_ar, position) VALUES
  ('price', 'Price', 'السعر', 1),
  ('no_availability', 'No availability', 'لا يوجد متاح', 2),
  ('no_response', 'Customer stopped responding', 'العميل توقف عن الرد', 3),
  ('booked_elsewhere', 'Booked elsewhere', 'حجز في مكان آخر', 4),
  ('dates_changed', 'Dates changed', 'تغيرت التواريخ', 5),
  ('unit_mismatch', 'Unit did not match', 'الوحدة غير مناسبة', 6),
  ('customer_cancelled', 'Customer cancelled', 'العميل ألغى', 7),
  ('competitor', 'Went to competitor', 'ذهب لمنافس', 8),
  ('wrong_lead', 'Wrong lead', 'عميل غير مناسب', 9),
  ('other', 'Other', 'أخرى', 10)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.inbox_templates (title, body, shortcut, created_at)
SELECT t.title, t.body, t.shortcut, (extract(epoch FROM now()) * 1000)::bigint
FROM (VALUES
  ('Welcome', 'أهلاً بيك في Soul Hospitality 🌊 معاك {{agent_name}}. ممكن تقولي المشروع اللي حابب تحجز فيه، تاريخ الوصول والمغادرة، وعدد الأفراد؟', 'ترحيب'),
  ('Ask details', 'عشان أبعتلك المتاح والأسعار محتاج: المشروع، تاريخ الوصول، تاريخ المغادرة، عدد الأفراد، وعدد الغرف.', 'تفاصيل'),
  ('Ask phone', 'ممكن رقم الموبايل/واتساب عشان أبعتلك صور الوحدات والتفاصيل كاملة؟', 'رقم'),
  ('Deposit', 'لتأكيد الحجز مطلوب عربون، وهبعتلك طرق الدفع حالاً. بعد التحويل ابعت صورة الإيصال وفريق الحسابات هيأكد الحجز.', 'عربون'),
  ('Follow-up', 'أهلاً {{customer_name}} 👋 حبيت أطمن لو لسه مهتم بالحجز؟ الوحدات في الفترة دي بتخلص بسرعة.', 'متابعة'),
  ('No availability', 'للأسف التواريخ دي مش متاحة حالياً. تحب أشوفلك تواريخ قريبة أو مشروع تاني؟', 'غير متاح')
) AS t(title, body, shortcut)
WHERE NOT EXISTS (SELECT 1 FROM public.inbox_templates);
