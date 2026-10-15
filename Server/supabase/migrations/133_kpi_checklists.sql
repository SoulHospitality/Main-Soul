-- A daily checklist is a share of a KPI. The person who adds it chooses that share.

CREATE TABLE IF NOT EXISTS public.kpi_checklists (
  id serial PRIMARY KEY,
  target_id integer NOT NULL REFERENCES public.kpi_targets(id) ON DELETE CASCADE,
  title text NOT NULL,
  weight_percent numeric NOT NULL CHECK (weight_percent > 0 AND weight_percent <= 100),
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kpi_checklist_items (
  id serial PRIMARY KEY,
  checklist_id integer NOT NULL REFERENCES public.kpi_checklists(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.kpi_checklist_assignees (
  checklist_id integer NOT NULL REFERENCES public.kpi_checklists(id) ON DELETE CASCADE,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  PRIMARY KEY (checklist_id, staff_user_id)
);

CREATE TABLE IF NOT EXISTS public.kpi_checklist_ticks (
  item_id integer NOT NULL REFERENCES public.kpi_checklist_items(id) ON DELETE CASCADE,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  checked_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, staff_user_id, work_date)
);

CREATE INDEX IF NOT EXISTS kpi_checklists_target_idx ON public.kpi_checklists (target_id);
CREATE INDEX IF NOT EXISTS kpi_checklist_ticks_staff_idx ON public.kpi_checklist_ticks (staff_user_id, work_date);
