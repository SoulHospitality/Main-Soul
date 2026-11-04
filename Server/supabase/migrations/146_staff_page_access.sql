-- Per-user page access. NULL keeps the user on their role's pages (the behaviour before this change);
-- a JSON map such as {"reservations": {"level": "read", "scope": "own"}} replaces it, page by page.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS page_access jsonb;
