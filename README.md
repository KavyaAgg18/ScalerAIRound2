# Route 53 Console Clone

A working clone of the Amazon Route 53 console: hosted zones and DNS records with full CRUD, persisted in SQLite, behind a mocked sign-in.

- **Frontend:** Next.js 16 (App Router, TypeScript strict) using [Cloudscape](https://cloudscape.design/), the design system the AWS console is built on.
- **Backend:** FastAPI + SQLAlchemy 2 + Pydantic v2.
- **Database:** SQLite (WAL, foreign keys on).
- **Auth:** mocked. Demo user `demo` / `demo1234`, session in an HTTP-only cookie backed by a `sessions` table.

Bonus features: BIND zone file import, export as BIND or JSON, dark mode, keyboard shortcuts and bulk delete.

Not affiliated with AWS. No AWS resources are created and no DNS is served.

## Run locally

Requirements: Node 20+ (tested with 24), Python 3.12, [uv](https://docs.astral.sh/uv/).

```bash
# Backend (http://127.0.0.1:8000)
cd backend
uv sync
uv run uvicorn app.main:app --reload

# Frontend dev server (http://localhost:3000), proxies /api to the backend
cd frontend
npm install
npm run dev
```

Production-like single process: `cd frontend && npm run build`, then run the backend. It serves the static export from `frontend/out` at http://127.0.0.1:8000.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./route53.db` | SQLite file |
| `COOKIE_SECURE` | `0` | Set `1` behind HTTPS |
| `SESSION_TTL_HOURS` | `24` | Session lifetime |
| `SEED_DEMO_DATA` | `1` | Insert demo zones when the DB has no zones (never overwrites) |
| `DEMO_USERNAME` / `DEMO_PASSWORD` | `demo` / `demo1234` | Demo user created if missing |
| `STATIC_DIR` | `../frontend/out` | Static export served by FastAPI |
| `ACCOUNT_NAME` / `ACCOUNT_ID` / `ACCOUNT_ROLE` | `Demo Organization` / `123456789012` / `developer` | What the account menu shows |

## Tests

```bash
# Backend: API tests with pytest
cd backend && uv run pytest

# Frontend: unit + component tests (Vitest, Testing Library, Cloudscape test-utils)
cd frontend && npm test

# End-to-end: Playwright against the real app (needs a fresh build)
cd frontend && npm run build && npx playwright install chromium && npm run test:e2e
```

| Suite | Where | What it covers |
|---|---|---|
| Backend (75) | `backend/tests/` | Login/logout/expiry, session cookie reuse and revocation, zone and record CRUD, validation for every record type, CNAME/duplicate/routing-policy conflicts, protected SOA/NS, search/sort/pagination (including 1,000 records), cascade delete, error body format, data on disk in SQLite, zone file parsing, import (all or nothing) and export, zone tags, VPC ID checks, routing-policy and alias filters, every routing policy, alias targets, health checks, CIDR collections, multiple VPCs, account info, upgrading an old database |
| Frontend unit/component (130) | `frontend/src/**/*.test.ts(x)` | Validators, API client (query strings, error mapping, 401 redirect, network failure), delete confirmation, record form, sign-in, console shell (auth guard, nav, flash, help panel, search, shortcuts, sign-out), dark mode, tags, the record wizard, filter chips, and every page's loading/empty/error states and form behavior |
| End-to-end (34) | `frontend/e2e/` | The six workflows from the brief (auth, create zone, manage zones, create record, edit/delete record, edge cases), import/export, the record wizard, tags, bulk delete, shortcuts, dark mode, Coming soon sections, backend restart persistence, API outage, stale deletes, refresh mid-flow, back/forward, health checks, failover and alias records, CIDR collections, a private zone with two VPCs |
| Visual (33 snapshots) | `frontend/e2e/visual.spec.ts` | Sign-in, hosted zones, zone details, record selected, create record, record wizard, create zone, edit zone, delete-zone dialog, import zone file and a Coming soon page at 1920×1080, 1440×900 and 768×1024 |

The E2E run starts FastAPI with a throwaway SQLite file, so it never touches your dev database. Visual baselines are per OS (the committed ones are `*-win32.png`). After an intentional UI change, regenerate them with `npx playwright test visual --update-snapshots` and review the diff.

Formatting: `npm run format` (Prettier) in `frontend/`, and `uv run ruff format . && uv run ruff check .` in `backend/`.

## Deploy (VPS, Docker Compose)

One image: Node builds the static export, then a Python image runs FastAPI, which serves `/api` and the pages from the same origin. Caddy terminates HTTPS.

```bash
# on the server, with ports 80/443 open and DNS pointing at it
git clone <repo> && cd <repo>
DOMAIN=route53.example.com docker compose up -d --build
```

No domain? Use `DOMAIN=<server-ip>.sslip.io`.

- SQLite lives in the named volume `r53data` at `/data/route53.db`. It survives `docker compose up --build`, restarts and reboots. **Never run `docker compose down -v`**: it deletes the volume and the database.
- Backup: `docker compose exec app python -c "import sqlite3; s=sqlite3.connect('/data/route53.db'); s.backup(sqlite3.connect('/data/backup.db'))"`.
- Health check: `GET /api/health`.
- Schema is created with `create_all` on startup. `backend/app/migrate.py` then adds columns that newer versions introduced and moves the old single VPC into `zone_vpcs`, so redeploying over an existing database is safe. Anything beyond additive changes would need Alembic.

## Architecture

```
browser ──► FastAPI (one process, one origin)
              ├─ /api/*  JSON API ──► SQLite via SQLAlchemy
              └─ /*      static Next.js export (frontend/out)
```

In development, `next dev` serves the pages and proxies `/api` to FastAPI, so the session cookie is same-origin in both setups.

```
backend/app/
  main.py          app, startup (create tables, seed), routers, static files
  db.py            engine + SQLite pragmas (WAL, foreign keys), session dependency
  models.py        users, sessions, hosted_zones, zone_vpcs, record_sets, health_checks, CIDR collections
  migrate.py       additive upgrades for databases created by older versions
  schemas.py       Pydantic request/response models
  auth.py          login/logout/me, PBKDF2 hashing, current_user dependency
  zones.py         hosted zone API, SOA/NS generation
  records.py       record API, record-set conflict rules, routing policies and alias targets
  health_checks.py health check API (status is simulated)
  cidr_collections.py  CIDR collection API for IP-based routing
  aws.py           Regions, continents and alias target types
  zone_files.py    zone file import and BIND/JSON export API
  zonefile.py      BIND parser and renderer
  dns_validate.py  domain names and per-type value validation
  errors.py        {"detail", "errors": [{field, message}]} error format
frontend/src/
  app/login/                  sign-in page (outside the console shell)
  app/(console)/              auth-guarded console pages
    hostedzones/              list, create, edit, details, records/create (quick create + wizard),
                              records/edit, records/import
    healthchecks/, cidrcollections/   list, create and edit pages
    page.tsx, [section]/      "Coming soon" pages for the mocked sections
  components/console.tsx      top bar, side navigation, AppLayout shell, flashes, help panel, shortcuts
  lib/api.ts                  typed API client
  lib/validate.ts             client-side copy of the validation rules (instant feedback)
  lib/theme.ts                orange primary buttons, light/dark mode
```

Pages that need an ID read it from the query string (`/hostedzones/details/?id=Z…`), so the app is a fully static export. List filter, sort and page are kept in the URL, so refresh and back/forward keep the view.

## Database schema

SQLite, created on startup with SQLAlchemy (`backend/app/models.py`). Times are stored as UTC.

**users**

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| username | VARCHAR(64) | unique |
| password_hash | VARCHAR | `pbkdf2_sha256$iterations$salt$hash` |
| created_at | DATETIME | |

**sessions**

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR(64) | primary key; SHA-256 of the cookie token (the token itself is never stored) |
| user_id | INTEGER | FK → users.id, `ON DELETE CASCADE` |
| expires_at | DATETIME | indexed; expired rows are purged at login |
| created_at | DATETIME | |

**hosted_zones**

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR(32) | primary key, Route 53 style (`Z` + 20 characters) |
| name | VARCHAR(255) | unique; lowercase with trailing dot (`example.com.`) |
| zone_type | VARCHAR(16) | `public` or `private` (CHECK) |
| description | VARCHAR(256) | |
| vpc_region, vpc_id | VARCHAR(32) | legacy single VPC; kept for old databases, `zone_vpcs` is the source of truth |
| created_at, updated_at | DATETIME | |

**zone_tags**

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| hosted_zone_id | VARCHAR(32) | FK → hosted_zones.id, `ON DELETE CASCADE` |
| key | VARCHAR(128) | unique per zone; can't start with `aws:` |
| value | VARCHAR(256) | may be empty |

**zone_vpcs** (VPCs associated with a private zone, at least one)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| hosted_zone_id | VARCHAR(32) | FK → hosted_zones.id, `ON DELETE CASCADE` |
| region | VARCHAR(32) | AWS Region code |
| vpc_id | VARCHAR(32) | `vpc-` + 8 to 17 hex characters; unique per zone |

**record_sets** (one row per Route 53 record set)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER | primary key |
| hosted_zone_id | VARCHAR(32) | FK → hosted_zones.id, `ON DELETE CASCADE` |
| name | VARCHAR(255) | FQDN, lowercase, trailing dot |
| type | VARCHAR(8) | A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA, SOA (CHECK) |
| ttl | INTEGER | 0 to 2147483647 (CHECK); ignored for alias records |
| values_json | TEXT | JSON array of values, one per line in the console |
| routing_policy | VARCHAR(16) | `simple`, `weighted`, `failover`, `latency`, `geolocation`, `geoproximity`, `multivalue` or `ip` |
| set_identifier | VARCHAR(128) | "Record ID"; required for every policy except simple |
| weight | INTEGER | weighted only, 0 to 255 |
| failover | VARCHAR(16) | failover only, `PRIMARY` or `SECONDARY` |
| region | VARCHAR(32) | latency only |
| geo_location | VARCHAR(16) | geolocation only: `*`, `continent:EU`, `country:US` or `country:US/CA` |
| geoproximity, bias | VARCHAR(64), INTEGER | geoproximity only: `region:us-east-1` or `coordinates:lat,lon`; bias -99 to 99 |
| cidr_collection_id, cidr_location | VARCHAR(36), VARCHAR(16) | IP-based only; location `*` is the default |
| health_check_id | VARCHAR(36) | optional, any policy except simple |
| alias_target_type, alias_target, alias_region, evaluate_target_health | | alias records: target type (`record`, `cloudfront`, `elb`, `s3`, ...), DNS name, and Region when the target type needs one |
| is_protected | BOOLEAN | true for the SOA and apex NS records Route 53 creates |
| created_at, updated_at | DATETIME | |

**health_checks**

| Column | Type | Notes |
|---|---|---|
| id | VARCHAR(36) | primary key (UUID) |
| name | VARCHAR(256) | optional |
| protocol | VARCHAR(8) | HTTP, HTTPS or TCP |
| ip_address / domain_name | VARCHAR | endpoint, one of the two |
| port, resource_path | INTEGER, VARCHAR | |
| request_interval, failure_threshold | INTEGER | 10 or 30 seconds; 1 to 10 |
| created_at, updated_at | DATETIME | |

**cidr_collections** / **cidr_locations**

| Column | Type | Notes |
|---|---|---|
| cidr_collections.id, name | VARCHAR(36), VARCHAR(64) | name unique |
| cidr_locations.collection_id | VARCHAR(36) | FK → cidr_collections.id, `ON DELETE CASCADE` |
| cidr_locations.name | VARCHAR(16) | unique per collection |
| cidr_locations.cidrs_json | TEXT | JSON array of CIDR blocks |

Indexes: unique `(hosted_zone_id, name, type, coalesce(set_identifier, ''))` for record-set identity, plus `(hosted_zone_id, name)` and `(hosted_zone_id, type)` for search and filters.

## API overview

All endpoints are under `/api`, take and return JSON, and (except login and health) need the session cookie; without it they return 401. Errors look like `{"detail": "message", "errors": [{"field": "name", "message": "..."}]}`. FastAPI also serves interactive docs at `/docs`.

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/auth/login` | Sign in | `{username, password}`; sets the HTTP-only cookie. 401 on bad credentials |
| POST | `/auth/logout` | Sign out | Deletes the session; 204 |
| GET | `/auth/me` | Current user | `{username, account_name, account_id, role}`. 401 if not signed in or expired |
| GET | `/hosted-zones` | List zones | `q` (name, description or ID), `sort` (name, zone_type, record_count, description, id, created_at), `order`, `page`, `page_size` (≤100). Returns `{items, total, page, page_size}` |
| POST | `/hosted-zones` | Create zone | `{name, description, zone_type, vpcs?: [{region, vpc_id}], tags?: [{key, value}]}`. Adds SOA + NS. 409 duplicate name, 422 invalid (including a malformed VPC ID or duplicate tag keys) |
| GET | `/hosted-zones/{id}` | Zone details | Includes `record_count`, `name_servers` and `tags`. 404 if unknown |
| PATCH | `/hosted-zones/{id}` | Edit zone | `{description?, tags?, vpcs?}`; `tags` and `vpcs` replace the whole set (tags max 50; vpcs for private zones only, at least one) |
| DELETE | `/hosted-zones/{id}` | Delete zone | 409 if it still has records other than SOA/NS |
| GET | `/hosted-zones/{id}/records` | List records | `q` (name or value), `type`, `routing_policy`, `alias` (`yes`/`no`), `sort` (name, type, ttl, routing_policy), `order`, `page`, `page_size` (≤300) |
| POST | `/hosted-zones/{id}/records` | Create record set | `{name, type, ttl, values[], routing_policy, set_identifier?, weight?, failover?, region?, geo_location?, geoproximity?, bias?, cidr_collection_id?, cidr_location?, health_check_id?, alias?: {target_type, dns_name, region?, evaluate_target_health}}`. 422 invalid value, 409 conflict |
| GET | `/hosted-zones/{id}/records/{rid}` | One record set | |
| PATCH | `/hosted-zones/{id}/records/{rid}` | Edit record set | `{ttl?, values?, alias?}` plus the fields of the record's own routing policy; name, type, policy and record ID can't change |
| DELETE | `/hosted-zones/{id}/records/{rid}` | Delete record set | 400 for the protected SOA/NS |
| POST | `/hosted-zones/{id}/import` | Import BIND zone file | `{zone_file}`. All or nothing; returns `{imported, skipped}`. 422 lists every bad line, 409 lists conflicts |
| GET | `/hosted-zones/{id}/export` | Export zone | `format=bind` (default) or `json`; downloaded as an attachment |
| GET, POST | `/health-checks` | List (`q`, `page`) / create health check | `{name?, protocol, ip_address? or domain_name?, port?, resource_path?, request_interval, failure_threshold}`. Private IPs are rejected |
| GET, PUT, DELETE | `/health-checks/{id}` | One health check | Delete is 409 while records use it |
| GET, POST | `/cidr-collections` | List / create CIDR collection | `{name, locations: [{name, cidrs[]}]}` |
| GET, PUT, DELETE | `/cidr-collections/{id}` | One collection | 409 when removing a location or collection that records use |
| GET | `/health` | Health check | No auth |

## What is real and what is simulated

| Real (persisted, validated) | Simulated | Not supported |
|---|---|---|
| Hosted zones: create (public/private), list, search, sort, paginate, edit description and tags, delete (also several at once) | SOA and NS records with `awsdns` name servers, created for every new zone | Answering DNS queries, propagation |
| Records: A, AAAA, CNAME, TXT, MX, NS, PTR, SRV, CAA; multi-value; TTL; all eight routing policies (simple, weighted, failover, latency, geolocation, geoproximity, multivalue answer, IP-based); alias records to another record or to AWS resources; health checks; CIDR collections; private zones with several VPCs; quick create or wizard; filters by type, routing policy and alias; BIND import; BIND/JSON export | VPC suggestions for private zones (any well-formed VPC ID is accepted); account name, ID and role (from env vars); Services menu (only Route 53 opens); health check status (Unknown, then Healthy; nothing is probed); AWS alias targets aren't checked against real resources; "View status" always reports INSYNC | Record types such as SPF, NAPTR, DS and TLSA (listed but disabled) |
| Rules: CNAME not at apex and not mixed with other types; no duplicate record sets; one routing policy per name/type; default SOA/NS can't be deleted; zones with records can't be deleted | | Dashboard, traffic policies, Resolver, profiles and the other side-nav sections show a "Coming soon" page, as the brief allows |

Deliberate difference from AWS: duplicate hosted zone names are rejected (409). AWS allows several zones with the same name.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Alt + S | Search hosted zones from the top bar |
| / | Focus the table filter |
| c | Create a hosted zone (zones list) or a record (zone details) |
| ? | Show the shortcut list (also under Settings → Keyboard shortcuts) |

Dark mode: Settings (gear icon) → Visual mode → Light, Dark or Browser default. The choice is remembered per browser.

## Visual fidelity

The UI uses Cloudscape components directly (visual-refresh theme, as in the current console), so spacing, typography, colors and interaction states come from the same design system. These pages were compared side by side with screenshots of the real console and adjusted to match: the console shell (top bar, breadcrumb toolbar, side navigation, footer, orange primary buttons), the hosted zones list and its details panel, create hosted zone (public and private), edit hosted zone, the delete-zone dialog, zone details with its records table, filters and preferences, and quick create record.

The Services menu, account menu, health check pages, CIDR collection pages and the routing-policy and alias parts of the record form follow the console's layout and wording but weren't compared with screenshots, so small differences are likely there.
