-- Calendar (iCal) sync is removed. Airbnb / Booking.com availability will come from a channel manager,
-- which imports bookings as reservations (channel_connections + channel_unit_mappings stay for that).

DROP TABLE IF EXISTS public.unit_ical_blocks CASCADE;
ALTER TABLE IF EXISTS public.channel_sync_logs DROP COLUMN IF EXISTS feed_id;
DROP TABLE IF EXISTS public.unit_ota_feeds CASCADE;
DROP TABLE IF EXISTS public.listing_ical CASCADE;
ALTER TABLE public.units DROP COLUMN IF EXISTS ical_url;

-- Nights held by old calendar imports.
DELETE FROM public.unit_blocked_dates WHERE source = 'ical' OR source LIKE 'ical:%';

-- Channel connections are API-only from now on.
DELETE FROM public.channel_connections WHERE connection_type = 'ical';
ALTER TABLE public.channel_connections DROP CONSTRAINT IF EXISTS channel_connections_connection_type_check;
ALTER TABLE public.channel_connections ADD CONSTRAINT channel_connections_connection_type_check CHECK (connection_type IN ('api'));
