# Connecting a channel manager

Calendar (iCal) sync was removed. Airbnb, Booking.com and other channels are meant to come in through
one channel manager (for example Rentals United, Hostaway or Channex) connected here.

## How it fits

- **Bookings from other channels become reservations.** The provider calls `upsertChannelReservation`
  (`../reservationImport.js`) for each booking and `cancelChannelReservation` for cancellations.
  Imported stays block the calendar, the website and the chatbot like any other reservation, and their
  commission feeds the finance reports.
- **Our availability and prices go out.** `buildAvailabilityPayload` and `buildRatesPayload`
  (`../inventoryPush.js`) build the next 12 months for every mapped unit.
- **Guest messages** from the channels land in the channel inbox through `ingestProviderMessages`
  (`../messaging.js`).
- **Sync runs every 15 minutes** (`jobs/channelSync.js`) for each enabled connection, and on demand at
  `POST /api/pms/channel-manager/sync`. Every run is written to `channel_sync_logs`.

## Adding the provider

1. Create `providers/<Name>Provider.js` extending `BaseChannelProvider` with a unique `key`
   (e.g. `rentals_united`), `connectionType: 'api'` and the capabilities it supports
   (`../capabilities.js`).
2. Implement what it supports: `authenticate`, `pushAvailability`, `pushRates`, `pullReservations`,
   `pullCancellations`, `pullModifications`, `pullMessages`, `sendMessage`. `BookingApiProvider.js` is a
   worked example; `../otaHttp.js` handles authenticated HTTP calls.
3. Register it in `../registry.js` (`registerDefaults`).
4. Create the connection (`POST /api/pms/channel-manager/connections/api` with the credentials) and map
   each unit to its listing in the channel manager (`PUT /api/pms/channel-manager/connections/api/:id/mappings`).
5. If the channel manager can push bookings to us, add a webhook route that calls the same
   `upsertChannelReservation`, so new bookings appear within seconds instead of at the next sync.
