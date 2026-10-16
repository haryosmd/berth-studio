# Architecture

Berth Studio is a desktop client for backend engineers: databases (PostgreSQL and MongoDB now, Supabase and Firebase next), an API client and ERD diagrams, in one window. This page explains how the code is organised and why. The threat model and security controls are in [SECURITY.md](SECURITY.md). What is built and what comes next is in [ROADMAP.md](ROADMAP.md).

## Principles

1. **Light.** The app opens in about a second, sits under 80 MB when idle, and keeps a 100,000-row grid smooth. The grid is virtualised and results are paged.
2. **Local-first.** There is no account and no cloud sync. A workspace is a set of files the user can keep in Git.
3. **Secure by default.** Secrets live in the operating system's secret store and stay in Rust; the webview never receives one. Production opens read-only.
4. **Keyboard-first.** A command palette and standard macOS shortcuts.
5. **One model.** Connections, API requests and diagrams share the same environments, and each workspace decides what those environments are.

## Repository layout

```
apps/desktop/            The desktop app
  src/                   React + TypeScript interface (no state library, no CSS framework)
  tests/                 Unit tests for the interface helpers (node --test)
  public/fonts/          Geist and Geist Mono, bundled so the app loads nothing remote
  src-tauri/             Tauri 2 shell: window, IPC commands, permissions, icons
crates/
  berth-core/            Connections, profiles, validation, SQL classification and routing. Pure logic, no I/O
  berth-secrets/         Secret storage: macOS Keychain, plus an in-memory store for tests
  berth-postgres/        PostgreSQL sessions, catalog browsing, query runs, cancellation
  berth-mongo/           MongoDB sessions, catalog, find, aggregation, document edits
design/                  Clickable prototype, design tokens, brand assets and case studies
docs/                    Architecture, roadmap, security model, dependency policy
  providers/             Checked specifications for PostgreSQL, MongoDB, Supabase and Firebase
scripts/                 Development databases and supply-chain checks
```

Rust crates are one Cargo workspace (`Cargo.toml` at the root). The interface is an npm workspace (`apps/desktop`). Both lockfiles live at the root.

## Data model

**Environments** belong to the workspace. A new workspace starts with dev, staging and prod, and a team can rename them, add its own (`local`, `qa`, `uat`, `prod-eu`), reorder them, or remove them. Each environment has:
- an id (lowercase, starts with a letter, at most 24 characters), used in Keychain references and never changed after creation;
- a label and a colour for the interface;
- a **production** flag. Several environments can be production, for example `prod-eu` and `prod-us`; every rule below that says "production" means "an environment with this flag";
- optional long and short spellings (`development`, `stg`) used when copying profiles.

Removing an environment that still has profiles is refused until the user confirms. The interface lists the affected profiles first, and confirming deletes them and their Keychain items.

A **connection** is one logical system, such as `acme-db`. It is not one environment. A connection has at most one **profile** per environment, and a profile may be missing: a system that only exists in staging and prod simply has no dev profile, and the interface says so instead of guessing.

A PostgreSQL profile has at most one `write` **endpoint** (the primary) and any number of `read` endpoints (replicas), with at least one endpoint in total. Every endpoint has its own host, port, database, user and TLS mode. This covers:
- separate read and write databases per environment;
- RDS reader and writer endpoints;
- one host with a read-write user and a read-only user;
- an environment where you only have read access: a profile with replicas and no primary can only read, and a write is refused before anything is sent.

A MongoDB profile has one endpoint: a connection string without the password, a user, an auth database and a read preference (`primary` or `secondaryPreferred`). See [providers/mongodb.md](providers/mongodb.md).

Production profiles are always read-only. `berth-core` normalises every profile before it is stored or used, so this holds whatever the interface sends.

The **workspace file** (`workspace.json` in the app data folder, mode `0600`, folder mode `0700`) holds environments, connections and profiles. A version 1 file, from before environments were configurable, loads with the default three. It never holds a secret, only a reference:

```json
{
  "role": "write",
  "host": "db.staging.acme.internal",
  "port": 5432,
  "database": "acme",
  "user": "app",
  "tls": "auto",
  "secret": "keychain://berth-studio/acme-db/staging/write-0"
}
```

The workspace file is written to a temporary file first and then renamed, so a crash never leaves half a file.

**Copying a profile** to another environment swaps whole environment words in hosts, databases, users and MongoDB connection strings. Each environment contributes its id, long name and short name, and words are swapped by position. With the defaults:
- `dev` and `development`;
- `staging` and `stg`;
- `prod`, `production` and `prd`.

A copy never carries passwords, a password is only reused for the same server and user, and a copy into production is read-only.

## Where a query runs

`berth_core::route` decides, in Rust, which endpoint a statement may use. Comments, string literals, quoted identifiers and dollar-quoted bodies are removed first, so a keyword hidden inside them cannot change the route.

| Goes to a read replica | Stays on the primary |
|---|---|
| `SELECT`, `TABLE`, `VALUES`, `SHOW` | `INSERT`, `UPDATE`, `DELETE`, `MERGE`, all DDL, `COPY`, `CALL`, `DO` |
| `EXPLAIN` without `ANALYZE` | `SELECT … FOR UPDATE` / `FOR SHARE`, `SELECT … INTO` |
| `WITH … SELECT` without data-modifying CTEs | `nextval`, `setval`, advisory locks, `set_config` and similar functions |
| | `EXPLAIN ANALYZE` of a write, anything inside a transaction |
| | Anything the classifier does not recognise |

The rule is to send anything uncertain to the primary. A read sent to the primary only costs load. A write sent to a replica fails, and a read from a lagging replica can be stale.

The user can pin a query tab to the write or the read endpoint. A write pinned to read is still sent, and the server rejects it. On a profile with no primary, every statement goes to a read endpoint and a write is refused with `BERTH_NO_WRITE` before it is sent.

The classifier is a port of the prototype's logic, and the Rust tests mirror `design/tests/core.test.mjs` so both stay in step.

## Production guard

A statement that would write in a production environment runs only after the user types the connection name. The same applies to MongoDB inserts, replacements, deletes and pipelines with `$out` or `$merge`. `berth_core::check_prod_write` verifies this in Rust, and the IPC command rejects the call with the code `BERTH_CONFIRM_PROD` until it passes.

A confirmed write runs on a one-off session that is closed afterwards. Every other production session is read-only at the server.

## Sessions

`berth-postgres` opens one session per endpoint. Each session is set up as follows:

- **Read-only sessions:** sessions on read endpoints and on read-only profiles set `default_transaction_read_only = on`. A stray write is refused by the database itself (SQLSTATE `25006`), not only by the client.
- **Statement timeout:** every session sets `statement_timeout` (30 s by default).
- **Cancelling:** a running query is cancelled through the server's cancel protocol. `cancel_query` looks the query up by its run id.
- **Result size:** a result keeps at most 5,000 rows and is marked `truncated` beyond that, so one careless `SELECT *` cannot exhaust memory.
- **Values as text:** values travel as text through the simple query protocol. Types for table browsing come from the catalog.
- **Table browsing:** the schema and table are first confirmed in `pg_catalog`, and only then quoted into SQL. Limit and offset are integers.
- **TLS:** TLS uses rustls with the macOS trust store, and the certificate host name is checked too. `auto` means required for every host except `localhost`. An endpoint can add a PEM file of CA certificates to that store, which RDS needs. There is no OpenSSL in the dependency tree.

Sessions are cached per connection, environment, role and read-only flag. Saving a connection drops its cached sessions.

`berth-mongo` opens one client per profile:

- **Read-only:** MongoDB has no read-only session setting. A read-only profile refuses writes in Rust before anything is sent; connecting with a user that has only the `read` role makes the server refuse them too.
- **Time limits:** `find` and `aggregate` carry `maxTimeMS` (30 s), so the server stops them. The driver cannot cancel an operation, so each one runs in its own task, and the app stops waiting shortly after the server's limit.
- **Result size:** at most 1,000 documents, marked `truncated` beyond that.
- **Values:** documents travel as relaxed Extended JSON. `Decimal128` is written in its canonical form, because the driver's relaxed conversion panics on it.
- **TLS:** rustls, as for PostgreSQL. SRV connection strings use the driver's own DNS resolver.

## IPC surface

The webview can call exactly the commands below. Each one is listed in `apps/desktop/src-tauri/build.rs` and allowed in `apps/desktop/src-tauri/capabilities/main.json`; anything else is rejected by Tauri. There is no shell, file system or HTTP plugin.

| Command | What it does |
|---|---|
| `list_environments` | Returns the workspace environments |
| `save_environments` | Validates and saves the environment list; removing one that has profiles needs `confirmDelete` |
| `list_connections` | Returns the workspace connections (references only, no secrets) |
| `save_connection` | Validates profiles, stores typed passwords in the Keychain, removes secrets of deleted endpoints, saves the workspace |
| `delete_connection` | Removes a connection and its Keychain items |
| `test_profile` | Connects read-only to every endpoint of a draft profile and reports the server version or the error |
| `list_tables` | Tables, views and materialised views the user can read |
| `browse_table` | One page of a table, ordered by its primary key |
| `run_query` | Routes, guards production, runs, and reports where the query ran |
| `cancel_query` | Cancels a running query by its run id |
| `mongo_overview` | MongoDB server version, topology and the databases the user can read |
| `list_collections` | Collections, views and time-series collections, with estimated counts |
| `find_documents` | Filter, sort, projection, skip and limit on one collection |
| `aggregate` | Runs a pipeline; one that writes follows the production and read-only rules |
| `list_indexes` | Index names, keys and uniqueness |
| `write_document` | Inserts, replaces or deletes one document by `_id`, behind the same guards |
| `check_update` | Asks the latest GitHub release whether a newer version exists |
| `install_update` | Downloads, verifies and installs that version, streaming progress over a channel |
| `restart_app` | Restarts into the installed update |

The updater plugin is registered for its Rust API only. Its own commands are not in the capability file, so the webview cannot call them.

The webview runs under a strict Content Security Policy, set in `tauri.conf.json`:
- scripts only from the app bundle;
- no remote connections, only IPC;
- no frames, objects or form submissions;
- a frozen JavaScript prototype.

Inline styles are allowed because CodeMirror and React set styles at run time. Scripts are not: `script-src` is limited to the bundle.

The rules that matter for safety live in `apps/desktop/src-tauri/src/app.rs` and the crates. The interface only reflects them.

## Interface

React 19 with a handful of components and no state library. The pieces are:
- **Styling:** the design tokens from `design/tokens.css`, so light and dark themes and the data-type colours match the prototype.
- **Query editor:** CodeMirror 6.
- **Grids:** virtualised with TanStack Virtual. MongoDB documents are shown as a grid of top-level fields, with the selected document as JSON beside it.
- **Environment switcher:** a segmented control for up to five environments, a menu beyond that. Each tab follows the switcher unless it is pinned to its own environment, so two environments can be open side by side. A tab in a production environment is tinted red, whatever the switcher shows.
- **Previewing in a browser:** when the interface runs outside Tauri during development, `apps/desktop/src/mock.ts` stands in for the backend. It is never part of a production build.

## Updates

Releases are built and published by a workflow when a version tag is pushed; see [RELEASING.md](RELEASING.md). Installed copies check `latest.json` from the newest GitHub release five seconds after launch and every six hours, using `tauri-plugin-updater` from Rust. When a newer version exists, an icon appears at the right of the title bar. Its panel shows the version, the release date and the release notes as plain text, then downloads with progress and offers a restart.

An update is installed only when its minisign signature matches the public key built into the app and the version inside the signature matches the announced one, so neither a tampered package nor a replayed older release is accepted. A failed check is silent and retried at the next interval.

## Testing

| Layer | Tests | Notes |
|---|---|---|
| `berth-core` | Unit tests | Mirror the prototype's tests for profiles and routing |
| `berth-secrets` | Unit tests | A real Keychain round trip is opt-in: `cargo test -p berth-secrets -- --ignored` |
| `berth-postgres` | Unit and integration tests | Integration tests run against `scripts/dev-db/start.sh` when `BERTH_TEST_PG` is set |
| `berth-mongo` | Unit and integration tests | Integration tests run against `scripts/dev-db/mongo-start.sh` when `BERTH_TEST_MONGO` is set |
| Desktop app (`app.rs`) | Integration tests | Covers routing, the production guard for both engines, read-only profiles, environment changes, secrets never reaching the workspace file, profile validation |
| Interface helpers | `node --test` | `apps/desktop/tests/` |
| Prototype and READMEs | `node --test` | `design/tests/`, including a check that all six README translations stay in step |

## Planned modules

These designs are settled and proven in the prototype; their Rust implementation follows the roadmap. The facts they rely on were checked against official documentation and are recorded, with sources, in [providers/](providers/README.md).

- **Supabase:**
  - the database is reached through the PostgreSQL driver via Supavisor: session pooler (port 5432) by default, transaction pooler (6543) without prepared statements or session settings;
  - pooler and read-replica hosts are read from the Management API (`/v1/projects/{ref}/config/database/pooler`), never built from the project reference;
  - the rest uses the Management API (120 requests a minute) with a scoped access token kept in the Keychain; logs come from the analytics endpoint (30 requests a minute);
  - project API keys are the new `sb_publishable_` and `sb_secret_` keys, sent in the `apikey` header.
- **Firebase:**
  - Firestore, Authentication, Realtime Database and Storage, through their REST APIs with short-lived OAuth tokens, scopes `cloud-platform`, `firebase.database` and `userinfo.email`;
  - sign-in with Application Default Credentials, or a service-account file that is read once, moved into the Keychain, and never kept;
  - Firestore edits send an explicit field mask, because fields named in the mask but missing from the body are deleted;
  - the dev profile can point at the Emulator Suite, which needs Java 21.
- **MongoDB, next steps:** stopping a running operation by id, change streams, and schema inference for diagrams.
- **API client and API Collections:**
  - collections are folders and files, so they can be kept in Git, with nested folders;
  - environment variables are shared with the database connections.
- **Importing collections:** Postman, Insomnia, OpenAPI, Swagger, HAR, Bruno and cURL, with these safeguards:
  - limits of 10 MB, a folder depth of 24 and 5,000 items;
  - only `http` and `https` URLs are allowed;
  - secrets move to the Keychain;
  - scripts are kept but turned off.
- **Diagrams:**
  - a live mode reads the schema, with foreign keys drawn automatically;
  - a sketch mode for drafting freely.
- **Cross-platform:**
  - `berth-secrets` gets Windows Credential Manager and Linux Secret Service backends behind the same trait;
  - the Windows and Linux builds follow the macOS release.

## Background

The choices above came from looking at the tools backend engineers already use.

| Tool | Strength | Gap | What we took |
|---|---|---|---|
| DBeaver | Supports almost every database | Heavy (JVM), dense interface | Breadth as a long-term target |
| TablePlus | Fast and native on macOS | Closed source, no API client | The speed bar, reviewing SQL before commit |
| Beekeeper Studio | Open source and tidy | Electron | Proof that an open-source client can feel good |
| Postman | The most complete API client | Electron, cloud-first, needs an account | Collections, environments, chained responses |
| Yaak | Tauri and Rust, offline, secrets in the Keychain | API only | A light stack, no secrets in files |
| Bruno | Collections as files, Git-friendly | API only | The workspace as files you can commit |

Tauri was chosen over Electron for its footprint (tens of megabytes idle instead of hundreds) and its permission model. `tokio-postgres` was chosen over `sqlx` because it needs no database at compile time and stays small.
