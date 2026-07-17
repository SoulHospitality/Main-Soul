-- 000_reset_project_schema.sql
-- Drop previous PMS / partial unified tables so a clean schema can be created.
-- Does NOT touch auth / storage / supabase internal schemas.

DROP TABLE IF EXISTS public.card_checkout_sessions CASCADE;
DROP TABLE IF EXISTS public.job_applications CASCADE;
DROP TABLE IF EXISTS public.jobs CASCADE;
DROP TABLE IF EXISTS public.promo_codes CASCADE;
DROP TABLE IF EXISTS public.reviews CASCADE;
DROP TABLE IF EXISTS public.wishlist_items CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.unit_ical_blocks CASCADE;
DROP TABLE IF EXISTS public.unit_blocked_dates CASCADE;
DROP TABLE IF EXISTS public.listing_ical CASCADE;
DROP TABLE IF EXISTS public.unit_daily_prices CASCADE;
DROP TABLE IF EXISTS public.inquiries CASCADE;
DROP TABLE IF EXISTS public.bookings CASCADE;

DROP TABLE IF EXISTS public.sales_notifications CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.cash_ledger CASCADE;
DROP TABLE IF EXISTS public.petty_cash CASCADE;
DROP TABLE IF EXISTS public.petty_cash_settings CASCADE;
DROP TABLE IF EXISTS public.owner_units CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.salary_deductions CASCADE;
DROP TABLE IF EXISTS public.employees CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.commissions CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.reservations CASCADE;
DROP TABLE IF EXISTS public.staff_users CASCADE;
DROP TABLE IF EXISTS public.daily_prices CASCADE;

-- Current + archived legacy PMS names
DROP TABLE IF EXISTS public.units CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP TABLE IF EXISTS public.commissions_pms_archive CASCADE;
DROP TABLE IF EXISTS public.payments_pms_archive CASCADE;
DROP TABLE IF EXISTS public.expenses_pms_archive CASCADE;
DROP TABLE IF EXISTS public.documents_pms_archive CASCADE;
DROP TABLE IF EXISTS public.notifications_pms_archive CASCADE;
DROP TABLE IF EXISTS public.owner_units_pms_archive CASCADE;
DROP TABLE IF EXISTS public.daily_prices_pms_archive CASCADE;
DROP TABLE IF EXISTS public.salary_deductions_pms_archive CASCADE;
DROP TABLE IF EXISTS public.tasks_pms_archive CASCADE;
DROP TABLE IF EXISTS public.employees_pms_archive CASCADE;
DROP TABLE IF EXISTS public.audit_log_pms_archive CASCADE;
DROP TABLE IF EXISTS public.reservations_pms_archive CASCADE;
DROP TABLE IF EXISTS public.units_pms_archive CASCADE;
DROP TABLE IF EXISTS public.users_pms_archive CASCADE;

DROP SEQUENCE IF EXISTS public.wp_post_id_seq CASCADE;
DROP FUNCTION IF EXISTS public.ensure_wp_post_id() CASCADE;
