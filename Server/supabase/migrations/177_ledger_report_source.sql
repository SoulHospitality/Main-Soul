-- 177: which source the Financial System reports read: the existing calculation ('engine', default) or the stored
-- ledger ('ledger'). Phase 6 of the financial reconstruction. Additive; changes no existing row.
-- Guarded like the posting switch (migration 176): the row cannot be deleted or renamed; only 'engine' or 'ledger';
-- every change needs a VERIFIED active admin and a reason, and is written to the append-only ledger_control_log.
-- Switching to 'ledger' also needs posting to be on. Switching back to 'engine' (rollback) is always allowed to a
-- verified admin with a reason.

CREATE OR REPLACE FUNCTION public.ledger_report_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor integer; reason text; posting text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.key = 'ledger_reports' THEN RAISE EXCEPTION 'The report source setting cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.key IS DISTINCT FROM NEW.key AND 'ledger_reports' IN (OLD.key, NEW.key) THEN
    RAISE EXCEPTION 'The report source row cannot be renamed, and no row can be renamed into it';
  END IF;
  IF NEW.key <> 'ledger_reports' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.value_text IS NOT DISTINCT FROM OLD.value_text THEN RETURN NEW; END IF;
  IF NEW.value_text NOT IN ('engine', 'ledger') THEN
    RAISE EXCEPTION 'The report source must be engine or ledger';
  END IF;
  actor := public.ledger_verified_actor();
  reason := btrim(COALESCE(current_setting('app.control_reason', true), ''));
  -- The insert made by this migration needs no actor; every later change does.
  IF TG_OP = 'UPDATE' THEN
    IF actor IS NULL OR NOT public.ledger_is_active_admin(actor) OR length(reason) < 10 THEN
      RAISE EXCEPTION 'Changing the report source needs a verified active admin (signed app.identity_claim) and app.control_reason (10+ characters)';
    END IF;
    IF NEW.value_text = 'ledger' THEN
      SELECT value_text INTO posting FROM public.financial_settings WHERE key = 'ledger_posting';
      IF COALESCE(posting, 'off') <> 'on' THEN
        RAISE EXCEPTION 'Reports cannot read the stored ledger while ledger posting is off';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.ledger_control_log (control, old_value, new_value, actor_id, reason)
  VALUES ('ledger_reports', CASE WHEN TG_OP = 'UPDATE' THEN OLD.value_text END, NEW.value_text, actor, NULLIF(reason, ''));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS financial_settings_ledger_reports_guard ON public.financial_settings;
CREATE TRIGGER financial_settings_ledger_reports_guard BEFORE INSERT OR UPDATE OR DELETE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.ledger_report_source_guard();

-- Created after the trigger, so its insertion is logged (no actor: installation).
INSERT INTO public.financial_settings (key, value_text)
VALUES ('ledger_reports', 'engine')
ON CONFLICT (key) DO NOTHING;

-- Switching posting OFF while reports read the stored ledger would show a frozen picture as current: refused.
CREATE OR REPLACE FUNCTION public.ledger_posting_off_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.key = 'ledger_posting' AND NEW.value_text = 'off' AND OLD.value_text = 'on'
     AND EXISTS (SELECT 1 FROM public.financial_settings WHERE key = 'ledger_reports' AND value_text = 'ledger') THEN
    RAISE EXCEPTION 'Switch reports back to engine before switching ledger posting off';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS financial_settings_ledger_posting_off_guard ON public.financial_settings;
CREATE TRIGGER financial_settings_ledger_posting_off_guard BEFORE UPDATE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.ledger_posting_off_guard();
