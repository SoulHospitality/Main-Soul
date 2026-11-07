-- Lead statuses the team uses. They replace the old pipeline stages (New, Qualifying, Price sent…).
-- "Interested" carries the destination in the lead's project field.

INSERT INTO public.inbox_lead_stages (key, name_en, name_ar, position, kind, requires_phone, requires_follow_up, is_qualified, active) VALUES
  ('interested',        'Interested',                  'مهتم',               1, 'open', 0, 0, 1, 1),
  ('different_project', 'Requested different project', 'طلب مشروع تاني',     2, 'open', 0, 0, 1, 1),
  ('done',              'Done',                        'تم',                 3, 'won',  0, 0, 1, 1),
  ('lost',              'Lost',                        'مفقود',              4, 'lost', 0, 0, 0, 1),
  ('low_budget',        'Low budget',                  'ميزانية قليلة',      5, 'lost', 0, 0, 0, 1),
  ('not_interested',    'Not interested',              'غير مهتم',           6, 'lost', 0, 0, 0, 1),
  ('no_answer',         'No answer / Ghost',           'مبيردش',             7, 'lost', 0, 0, 0, 1),
  ('cancel_no_refund',  'Cancel without refund',       'إلغاء بدون استرداد', 8, 'lost', 0, 0, 0, 1),
  ('cancel_refund',     'Cancel with refund',          'إلغاء مع استرداد',   9, 'lost', 0, 0, 0, 1)
ON CONFLICT (key) DO UPDATE SET
  name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, position = EXCLUDED.position, kind = EXCLUDED.kind,
  requires_phone = 0, requires_follow_up = 0, is_qualified = EXCLUDED.is_qualified, active = 1;

-- Existing leads move to the closest new status; old stages stay for history but are hidden.
UPDATE public.inbox_leads SET stage_key = 'interested'
  WHERE stage_key IN ('new', 'qualifying', 'qualified', 'quoted', 'negotiating', 'booking_requested');
UPDATE public.inbox_leads SET stage_key = 'done' WHERE stage_key = 'won';
UPDATE public.inbox_leads SET stage_key = 'not_interested' WHERE stage_key = 'invalid';
UPDATE public.inbox_lead_stages SET active = 0
  WHERE key IN ('new', 'qualifying', 'qualified', 'quoted', 'negotiating', 'booking_requested', 'won', 'invalid');

-- Leads made by the chatbot before the chat reaches the inbox.
ALTER TABLE public.chatbot_sessions ADD COLUMN IF NOT EXISTS lead_id integer;
