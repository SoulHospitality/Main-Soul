-- Rehearsal r0: inventory of every public table (row count and a content checksum per table). READ-ONLY.
-- Run on the SOURCE (production, by the DBA, as a role that can read every table) at the backup's point in
-- time, and on the RESTORED COPY, then diff the two outputs: every finance table must be equal. Output:
-- table names, counts and md5 hashes only (never row contents). Reads every row; run it off-peak.
BEGIN TRANSACTION READ ONLY;

SELECT c.relname AS table_name,
       (xpath('/row/n/text()', query_to_xml(format('SELECT COUNT(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text
         || ' rows / ' ||
       COALESCE((xpath('/row/h/text()', query_to_xml(format(
         'SELECT md5(COALESCE(string_agg(md5(x::text), '''' ORDER BY md5(x::text)), '''')) AS h FROM public.%I x', c.relname),
         false, true, '')))[1]::text, '') AS fingerprint
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

SELECT 'migrations' AS item, COUNT(*)::text || ' applied, last ' || MAX(id) AS value FROM public._schema_migrations
UNION ALL SELECT 'database size', pg_size_pretty(pg_database_size(current_database()));

ROLLBACK;
