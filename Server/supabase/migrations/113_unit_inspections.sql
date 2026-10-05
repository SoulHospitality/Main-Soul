-- New unit inspection workflow (Operations).
-- Supervisor assigns a new unit to an operations agent; the agent drafts a checklist,
-- the supervisor approves (and may edit) it, then the agent completes the inspection
-- with a walkthrough video that is shared with the supervisor and the unit's owners.

CREATE TABLE IF NOT EXISTS public.unit_inspections (
  id serial PRIMARY KEY,
  unit_id uuid NOT NULL UNIQUE REFERENCES public.units(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'checklist_submitted', 'checklist_approved', 'completed')),
  assigned_to integer REFERENCES public.staff_users(id),
  assigned_by integer REFERENCES public.staff_users(id),
  assigned_at timestamptz,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist_submitted_at timestamptz,
  checklist_approved_by integer REFERENCES public.staff_users(id),
  checklist_approved_at timestamptz,
  manager_note text,
  video_url text,
  video_public_id text,
  agent_notes text,
  completed_by integer REFERENCES public.staff_users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unit_inspections_assigned_to_idx
  ON public.unit_inspections (assigned_to);
CREATE INDEX IF NOT EXISTS unit_inspections_status_idx
  ON public.unit_inspections (status);

ALTER TABLE public.unit_inspections ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.unit_inspections.checklist IS
  'Array of {id, label, added_by: agent|manager, result: ok|issue|null, note}';
