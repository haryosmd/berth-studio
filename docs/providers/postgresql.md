# PostgreSQL

Crate: `crates/berth-postgres`. Driver: `tokio-postgres` 0.7 with rustls.

## Connecting

- **One session per endpoint.** A profile has at most one `write` endpoint (the primary) and any number of `read` endpoints (replicas). A profile with only read endpoints is valid; it can only read.
- **Authentication:** password, negotiated by the server (SCRAM-SHA-256 on modern servers). The password comes from the Keychain and is never part of a connection string.
- **TLS:** `auto` requires TLS for every host except `localhost`, `127.0.0.1` and `::1`. Certificates and host names are verified against the system trust store (`rustls-platform-verifier`). `require` and `disable` can be set per endpoint.
- **Session setup:** `SET statement_timeout` (30 s by default) on every session. Sessions on read endpoints and read-only profiles also `SET default_transaction_read_only = on`, so the server refuses writes with SQLSTATE `25006`.
- **Application name:** `Berth Studio`, visible in `pg_stat_activity`.

## Catalog and data

| Operation | How |
|---|---|
| List tables | `pg_catalog.pg_class` + `pg_namespace`, kinds `r v m p f`, filtered by `has_table_privilege(…, 'SELECT')` |
| Columns and types | `pg_attribute` with `format_type`, primary key from `pg_index.indisprimary` |
| Browse a table | Schema and table confirmed in the catalog first, then `SELECT * FROM "schema"."table" ORDER BY <pk> LIMIT n OFFSET m` |
| Run user SQL | Simple query protocol, so a script may hold several statements; values arrive as text |
| Cancel | `CancelToken::cancel_query`, which opens a separate connection to the server |

## Limits

- At most 5,000 rows are kept per result; larger results are marked `truncated`.
- SQL sent over IPC is limited to 1 MiB.

## Poolers

The simple query protocol uses no named prepared statements, so it also works through transaction-mode poolers (PgBouncer, Supavisor port 6543). Session settings such as `statement_timeout` do not survive between transactions there. Before transaction-pooler profiles are supported, the timeout must be sent with `SET LOCAL` inside each transaction.

## Testing

`scripts/dev-db/start.sh` starts PostgreSQL 16 on `127.0.0.1:54329` with users `app` (owner) and `app_ro` (read-only). Run the tests with:

```bash
BERTH_TEST_PG=127.0.0.1:54329 cargo test -p berth-postgres
```

## Sources

- Protocol and cancellation: https://www.postgresql.org/docs/current/protocol-flow.html
- `default_transaction_read_only`, `statement_timeout`: https://www.postgresql.org/docs/current/runtime-config-client.html
- SQLSTATE codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
- `tokio-postgres`: https://docs.rs/tokio-postgres/0.7/tokio_postgres/
