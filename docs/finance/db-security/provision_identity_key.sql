-- Provision a ledger identity key (verified identity, review finding H3). Run by the DBA as the owner.
--
--   1. Generate a secret OUTSIDE the database (never paste it into chat, tickets or the repository):
--        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--   2. Store it in the application environment (Render secrets, never committed):
--        LEDGER_IDENTITY_KEY_ID=<key id, e.g. k2027a>    LEDGER_IDENTITY_KEY=<the 64-hex secret>
--   3. Store the same secret in the database:
--        psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v key_id=k2027a -v key_hex="$LEDGER_IDENTITY_KEY" \
--             -f docs/finance/db-security/provision_identity_key.sql
--   Rotation: add a new key, switch the application to it, then deactivate the old one (keys can be
--   deactivated but never changed or deleted).
BEGIN;
INSERT INTO public.ledger_identity_keys (key_id, secret) VALUES (:'key_id', decode(:'key_hex', 'hex'));
COMMIT;
SELECT key_id, active, created_at, length(secret) AS secret_bytes FROM public.ledger_identity_keys ORDER BY created_at;
