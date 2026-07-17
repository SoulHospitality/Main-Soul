# Main Soul — Client / Server

```
Main Soul/
├── Client/                 # Single Vite SPA (guest + admin + sales)
└── Server/                 # API + database migrations
    ├── src/                # Express API
    └── supabase/migrations/
```

| App | Path | Port | Role |
|-----|------|------|------|
| **Server** | [`Server/`](Server/) | `5000` | Express + Postgres (Supabase) + Cloudinary + Paymob + Socket.io |
| **Client** | [`Client/`](Client/) | `5173` | Guest site, `/admin/*` PMS portal, `/sales/*` |

## Quick start

1. Copy [`.env.example`](.env.example) → `Server/.env` and fill `DATABASE_URL`, Cloudinary, Paymob, `JWT_SECRET`.
2. Migrations live in [`Server/supabase/migrations/`](Server/supabase/migrations/) and apply automatically on Server boot.
3. Install & run:

```bash
npm run install:all
npm run dev:server     # API — http://localhost:5000
npm run dev:client     # SPA — http://localhost:5173
```

- Guest site: http://localhost:5173
- PMS admin: http://localhost:5173/sign-in (staff username → opens `/admin`)

Default staff seed: username `admin` / password from `ADMIN_PASSWORD` (default `Admin@123`).

## Architecture

- **Database:** Supabase Postgres — schema SQL under `Server/supabase/migrations/`.
- **Media:** Cloudinary.
- **Payments:** Paymob (`/api/payments/paymob-webhook`).
- **Auth:** Guests → `/api/auth/*`; staff → `/api/staff/auth/*` (JWT). Admin UI under `Client/src/admin` maps calls to `/api/pms/*`.
- **Admin:** Integrated into the Client at `/admin/*` — no separate admin package.

See [`WORKSPACE_MAP.md`](WORKSPACE_MAP.md) for the full map.
