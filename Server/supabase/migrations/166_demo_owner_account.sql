-- Demo owner account for trying the owner portal. Signs in with the email or the placeholder phone
-- 000000000099 (not a real number). The password is shared privately; only its hash is stored here.
-- It owns no units, so it sees no real owner's money. Deactivate it from User Management when done.
INSERT INTO public.staff_users (username, password_hash, email, full_name, role, is_first_login, is_active, salary_change_status)
SELECT '000000000099', '$2a$10$/x46givYtpSjvzL3khTVUe8/cdpy6GTG6tXg3fXp7i3NoWTdjwCtG', 'demo.owner@soul.owners.local', 'Demo Owner', 'owner', 0, 1, 'none'
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff_users
  WHERE lower(email) = 'demo.owner@soul.owners.local' OR username = '000000000099'
);
