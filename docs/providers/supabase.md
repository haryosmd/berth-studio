# Supabase

Status: specified, not implemented. The database part reuses the PostgreSQL driver; everything else goes through Supabase's HTTP APIs.

## Database connections

| Mode | Host and user | Port | Network | Use it for |
|---|---|---|---|---|
| Direct | `db.<ref>.supabase.co`, user `postgres` | 5432 | IPv6 only, unless the IPv4 add-on is on | Users with IPv6 |
| Shared pooler, session mode | pooler host, user `postgres.<ref>` | 5432 | IPv4 | **Default for Berth Studio**: Supabase recommends it for GUI tools |
| Shared pooler, transaction mode | pooler host, user `postgres.<ref>` | 6543 | IPv4 | Short serverless queries only |
| Dedicated pooler (paid) | `db.<ref>.supabase.co` | 6543 | IPv6, or IPv4 with the add-on | Transaction mode only |

- **The pooler host cannot be derived from the region.** Its form is `aws-<index>-<region>.pooler.supabase.com`, and the index is not predictable. Read it from `GET /v1/projects/{ref}/config/database/pooler` (fields `db_host`, `db_port`, `db_user`, `pool_mode`, `database_type`).
- **Session mode moved off port 6543** on 2025-02-28; 6543 is transaction mode only.
- **Transaction mode** keeps no session state: no prepared statements, `SET`, `LISTEN`/`NOTIFY`, temporary tables, advisory locks or cursors across transactions. Berth Studio's simple query protocol works there, but `statement_timeout` must be sent per transaction.
- **TLS:** `sslmode=require` encrypts without checking the server. `verify-full` needs the project's CA certificate, downloaded by the user from Dashboard → Database Settings → SSL Configuration; there is no public download URL.

## Read replicas

- Pro, Team and Enterprise plans; AWS, at least Small compute, Postgres 15 or later; up to 2 replicas (5 on XL and above).
- Replicas accept reads only. Auth, Storage and Realtime always use the primary.
- **Their host names are not documented.** Each replica has its own pooler; read it from the pooler endpoint above, where entries have `database_type: "READ_REPLICA"`. A Supabase profile therefore maps naturally onto Berth Studio's primary + read-replica endpoints.

## Management API

Base URL `https://api.supabase.com`, header `Authorization: Bearer <token>`.

- **Tokens:** personal access tokens. Scoped tokens (prefix `sbp_fc`) are available and preferred; classic tokens are labelled "Legacy" and carry full account access. Stored in the Keychain.
- **Rate limit:** 120 requests per minute per user, per project or organisation, per endpoint; the logs endpoint allows 30 per minute. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; over the limit the API answers 429.

| What | Endpoint |
|---|---|
| Projects | `GET /v1/projects` (`ref`, `name`, `region`, `status`, `database.host`, `database.version`) |
| API keys | `GET /v1/projects/{ref}/api-keys`; add `?reveal=true` (needs the "API Key Secrets" permission) to see secret values |
| Pooler settings | `GET /v1/projects/{ref}/config/database/pooler` |
| SQL (beta) | `POST /v1/projects/{ref}/database/query` with `{query, parameters?, read_only?}`, or `POST …/database/query/read-only`, which runs as `supabase_read_only_user` |
| Edge Functions | `GET /v1/projects/{ref}/functions` |
| Storage buckets | `GET /v1/projects/{ref}/storage/buckets` |
| Auth settings | `GET /v1/projects/{ref}/config/auth` |
| Logs | `GET /v1/projects/{ref}/analytics/endpoints/logs?sql=…&iso_timestamp_start=…&iso_timestamp_end=…`: ClickHouse SQL over one `logs` table filtered by `source_name`, at most 24 hours per call |

The old `…/analytics/endpoints/logs.all` endpoint was removed on 2026-09-23 and answers 410.

## API keys

- New keys: `sb_publishable_…` (safe in clients while RLS is on) and `sb_secret_…` (bypasses RLS, server-side only). They go in the `apikey` header, not `Authorization`, because they are not JWTs.
- Secret keys are refused with 401 when the `User-Agent` looks like a browser. The Rust HTTP client sends its own user agent, so this does not affect Berth Studio.
- Legacy `anon` and `service_role` JWT keys are deprecated and end by the end of 2026.

## Auth users, Storage and Edge Functions

- **Users:** read `auth.users` over the database connection (read-only), or `GET https://<ref>.supabase.co/auth/v1/admin/users?page=&per_page=` (default 50 per page; `X-Total-Count` and `Link` headers). Managed columns can change, so the app selects them by name and tolerates missing ones.
- **Storage:** `POST /storage/v1/object/list/{bucket}` with `{prefix, limit, offset, sortBy}`; folders come back with `id: null`. Signed URLs: `POST /storage/v1/object/sign/{bucket}/{path}` with `{expiresIn}`; the returned `signedURL` is relative to `/storage/v1`.
- **Edge Functions:** `POST https://<ref>.supabase.co/functions/v1/<slug>` with the `apikey` header. Functions require a JWT by default (`verify_jwt`).

## Identifiers

- Project ref: exactly 20 lowercase letters. Project URL: `https://<ref>.supabase.co`.

## Local development

`supabase start` (Docker) serves the API on 54321, the database on 54322 (`postgres:postgres`) and Studio on 54323. A native runtime without Docker is experimental (`supabase start --runtime native`, macOS 14+ on Apple silicon). The Management API and pooler cannot be emulated locally, so their tests need recorded responses or a real project.

## Sources

- Connecting: https://supabase.com/docs/guides/database/connecting-to-postgres
- Session mode on 6543 deprecated: https://supabase.com/changelog/32755-supabase-connection-pooler-deprecating-session-mode-on-port-6543-on-february-28
- SSL: https://supabase.com/docs/guides/platform/ssl-enforcement
- IPv4 add-on: https://supabase.com/docs/guides/platform/ipv4-address
- Read replicas: https://supabase.com/docs/guides/platform/read-replicas
- Management API: https://supabase.com/docs/reference/api/introduction and https://api.supabase.com/api/v1-json
- Logs endpoint migration: https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint
- Access tokens: https://supabase.com/docs/guides/platform/personal-access-tokens
- API keys: https://supabase.com/docs/guides/api/api-keys
- Auth admin API: https://github.com/supabase/auth/blob/master/internal/api/admin.go
- Storage: https://supabase.com/docs/reference/storage
- Edge Functions: https://supabase.com/docs/guides/functions/quickstart
- Local runtimes: https://supabase.com/docs/guides/local-development/docker-and-native-runtimes

## Unverified

- Host and user formats of read replicas and their poolers (read them from the API instead).
- Whether `sb_secret_…` keys work on the Auth admin and Storage endpoints with only the `apikey` header.
- The exact `source_name` values for Edge Function logs in the new logs table.
- The full shape of the `config/auth` response.
