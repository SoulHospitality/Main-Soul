# Partner inventory API

Private feed of **published rental** units for an external website. Details only (no availability calendar).

## Setup (Soul)

1. Set a long random secret in the server environment:

```bash
PARTNER_INVENTORY_API_KEY=replace-with-a-long-random-secret
```

2. Restart the API. Without this env var, partner routes return `503`.

3. Give the partner the **base URL** of your API (e.g. `https://api.example.com`) and the key. They must call from **their backend** — never put the key in browser JavaScript.

## Auth

Send the key on every request:

```http
Authorization: Bearer YOUR_KEY
```

or:

```http
X-Api-Key: YOUR_KEY
```

Wrong or missing key → `401 Unauthorized`.

## Endpoints

### List inventory

`GET /api/partners/v1/inventory`

Query params:

| Param    | Default | Notes              |
|----------|---------|--------------------|
| `limit`  | 50      | Max 200            |
| `offset` | 0       | Pagination offset  |

Only returns units with `status=published` and `listing_type=rent`.

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_KEY" \
  "https://YOUR_API_HOST/api/partners/v1/inventory?limit=50&offset=0"
```

Response shape:

```json
{
  "items": [ /* public unit objects */ ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

### Unit detail

`GET /api/partners/v1/inventory/:idOrSlug`

`:idOrSlug` is the unit UUID or slug. Draft/sale units are not returned (`404`).

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_KEY" \
  "https://YOUR_API_HOST/api/partners/v1/inventory/some-unit-slug"
```

## Unit fields

Payload matches the guest-site public unit shape (owner, commission, ops, and scrape fields are stripped). Useful fields include:

- Identity: `id`, `slug`, `title`, `listing_type`, `status`
- Location: `compound`, `area`, `city`, `lat`, `lng`
- Specs: `property_type`, `beds`, `baths`, `guests`, `size_m2`
- Media: `cover_url`, `photo_urls`
- Copy: `short_description`, `the_property`, `guest_access`, `neighborhood`, `getting_around` (detail)
- Amenities: `amenities`, `facilities`
- Price: `price_fallback`, `from_price`, `price_currency`, `price_as_of` (when a today rate exists)
- Reviews: `average_rating`, `review_count`

List responses may include fewer photos (`photo_urls` capped) than detail.

## Limits

Partner routes are rate-limited (about 120 requests per 15 minutes per IP), on top of the global API limit.

## Revoking access

Rotate or remove `PARTNER_INVENTORY_API_KEY` and restart the server. Old keys stop working immediately.
