-- Check 6: every closed (frozen) month's saved journal must balance. Read-only. No personal data.
-- financial_posted_entries.entry is the saved entry: { id, date, type, lines: [{ account, debit, credit }] }.
BEGIN TRANSACTION READ ONLY;

SELECT p.year_month, p.kind,
       COUNT(DISTINCT p.entry_id) AS entries,
       SUM(COALESCE((l ->> 'debit')::numeric, 0))::numeric(18,2) AS debits,
       SUM(COALESCE((l ->> 'credit')::numeric, 0))::numeric(18,2) AS credits,
       (SUM(COALESCE((l ->> 'debit')::numeric, 0)) - SUM(COALESCE((l ->> 'credit')::numeric, 0)))::numeric(18,2) AS difference
FROM public.financial_posted_entries p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.entry -> 'lines', '[]'::jsonb)) AS l
GROUP BY p.year_month, p.kind
ORDER BY p.year_month, p.kind;

-- Individual saved entries that do not balance on their own (entry ids only).
SELECT p.year_month, p.entry_id,
       (SUM(COALESCE((l ->> 'debit')::numeric, 0)) - SUM(COALESCE((l ->> 'credit')::numeric, 0)))::numeric(18,2) AS difference
FROM public.financial_posted_entries p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.entry -> 'lines', '[]'::jsonb)) AS l
GROUP BY p.year_month, p.entry_id
HAVING abs(SUM(COALESCE((l ->> 'debit')::numeric, 0)) - SUM(COALESCE((l ->> 'credit')::numeric, 0))) > 0.005
ORDER BY 1, 2;

ROLLBACK;
