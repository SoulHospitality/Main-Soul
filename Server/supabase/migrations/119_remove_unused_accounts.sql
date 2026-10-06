-- USD treasury, fixed assets / depreciation, share capital, amenities, master-lease rent and FX accounts
-- were removed from the chart of accounts; drop any leftover rows that still point at them.

DO $$
BEGIN
  IF to_regclass('public.financial_manual_entries') IS NOT NULL THEN
    DELETE FROM public.financial_manual_entries
    WHERE debit_account_code IN ('102000','104000','150000','151000','159000','301000','502000','505000','606000','607000')
       OR credit_account_code IN ('102000','104000','150000','151000','159000','301000','502000','505000','606000','607000');
  END IF;

  IF to_regclass('public.financial_custom_accounts') IS NOT NULL THEN
    DELETE FROM public.financial_custom_accounts
    WHERE parent_code IN ('102000','104000','150000','151000','159000','301000','502000','505000','606000','607000');
  END IF;

  IF to_regclass('public.close_checklist_templates') IS NOT NULL THEN
    IF to_regclass('public.close_checklist_items') IS NOT NULL THEN
      DELETE FROM public.close_checklist_items
      WHERE template_id IN (SELECT id FROM public.close_checklist_templates WHERE title = 'Run depreciation');
    END IF;
    DELETE FROM public.close_checklist_templates WHERE title = 'Run depreciation';
    UPDATE public.close_checklist_templates
      SET description = 'Reconcile all bank accounts (101000 and its sub-accounts) against bank statements'
      WHERE title = 'Bank reconciliation';
    UPDATE public.close_checklist_templates
      SET description = 'Count and reconcile cash accounts (103000 and its sub-accounts)'
      WHERE title = 'Cash reconciliation';
  END IF;
END $$;
