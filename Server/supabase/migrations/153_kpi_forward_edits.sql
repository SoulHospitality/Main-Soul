-- KPI edits only change the days still to come.
-- A checklist item now has the days it is on the list: items added today start today,
-- items removed stop yesterday, so past days keep the list they were scored with.
-- Importance is gone: every KPI counts the same in a person's score.

ALTER TABLE public.kpi_checklist_items
  ADD COLUMN IF NOT EXISTS active_from date,
  ADD COLUMN IF NOT EXISTS active_until date;

UPDATE public.kpi_targets SET weight = 1 WHERE weight IS DISTINCT FROM 1;
