# Roadmap

Berth Studio is built in stages. Each stage ends with something that runs and is tested. How the pieces fit together is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Stage 0: design (done)

- A clickable prototype of every screen, with light and dark themes: [`design/prototype.html`](../design/prototype.html).
- A design system, which is token-based so the app and the prototype share colours and type: [`design/tokens.css`](../design/tokens.css).
- Brand: the logo with its golden-ratio construction, and the app icon ([`design/brand/`](../design/brand/)).
- A UX case study ([`design/ux/`](../design/ux/)).
- Design decisions:
  - **Accent:** teal.
  - **Grid density:** compact.
  - **Query results panel:** at the bottom.

## Stage 1: foundation, PostgreSQL and MongoDB (in progress)

Done:
- [x] Cargo and npm workspaces, a pinned Rust toolchain and supply-chain checks. See [DEPENDENCIES.md](DEPENDENCIES.md).
- [x] `berth-core`: connections, per-environment profiles, validation, copying profiles, SQL classification and routing.
- [x] `berth-secrets`: macOS Keychain storage; secrets never reach the webview or a file.
- [x] `berth-postgres`:
  - TLS through rustls and the system trust store;
  - read-only sessions enforced by the server;
  - statement timeout and cancel;
  - catalog-checked table browsing.
- [x] Desktop shell:
  - Tauri 2 with a strict CSP and a per-command allowlist;
  - the environment switcher;
  - light and dark themes.
- [x] The connection sheet: one tab per environment, a primary and any number of read replicas, and a connection test.
- [x] The table browser: a virtualised grid, colour per data type, paging.
- [x] The SQL editor: auto, write or read targets, cancel, errors shown with line and column.
- [x] The production guard: writes need the connection name typed, and the check runs in Rust.
- [x] Environments defined by the workspace: rename, add, reorder and remove them, mark several as production, and pin a tab to its own environment to work in two side by side.
- [x] Read-only profiles: a profile with read replicas and no primary, for environments where you only have read access.
- [x] `berth-mongo` and the MongoDB screens:
  - databases, collections, views and indexes;
  - find with filter, sort and projection; aggregation pipelines;
  - inserting, replacing and deleting documents, behind the read-only and production guards;
  - a local replica set for tests (`scripts/dev-db/mongo-start.sh`).
- [x] Provider specifications checked against official documentation: [providers/](providers/README.md).

Next:
- [ ] Filter bar in the table browser (filters become parameterised queries)
- [ ] Inline editing with an SQL review step and a single-transaction commit
- [ ] Export results to CSV and JSON
- [ ] SQL autocomplete from a schema cache
- [ ] Command palette (⌘K); the sidebar filter (⌘P) is done
- [ ] SSH tunnels with host-key verification
- [ ] Query history in a local SQLite store
- [ ] Continuous integration, running the workflow in `.github/workflows/ci.yml` on every pull request

## Stage 2: diagrams and MongoDB depth

- ERD canvas: live mode from the schema, and sketch mode.
- MongoDB: schema inference for diagrams, stopping a running operation by id, change streams, and a CodeMirror JSON editor for filters and pipelines.

## Stage 3: API client

- Requests with variables shared with the database environments.
- API Collections as files.
- Importers for Postman, Insomnia, OpenAPI, Swagger, HAR, Bruno and cURL, with the limits described in [SECURITY.md](SECURITY.md).

## Stage 4: release

- Signing and distribution:
  - Developer ID signing, the hardened runtime and notarization;
  - a `.dmg`.
- Updates signed with minisign (done: in-app update icon, release workflow on version tags; see [RELEASING.md](RELEASING.md)).
- Release provenance:
  - build-provenance attestations;
  - an SBOM;
  - signed checksums.
- A performance pass: idle memory, and 100,000-row grids.

## Before the first public release

- [ ] Confirm the name is free: GitHub organisation, domain and trademark.
- [ ] Set the final bundle identifier. It is `app.berthstudio.desktop` today, and depends on the domain.
- [ ] Fill in the maintainer's legal name in [CLA.md](../CLA.md) and the real handles in [.github/CODEOWNERS](../.github/CODEOWNERS).
- [ ] Have the CLA reviewed by a lawyer.
- [ ] Have native speakers review the README translations.
- [ ] Apply the repository settings listed in [SECURITY.md](SECURITY.md#repository-settings).

## Later

- Supabase and Firebase modules (designed in the prototype, specified in [providers/](providers/README.md)).
- Windows and Linux builds. When the Linux build starts, review the two Linux-only `cargo audit` warnings noted in [DEPENDENCIES.md](DEPENDENCIES.md).
- MySQL, MariaDB, SQLite and Redis.
