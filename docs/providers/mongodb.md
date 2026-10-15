# MongoDB

Crate: `crates/berth-mongo`. Driver: the official `mongodb` crate 3.9 (Apache-2.0, MSRV 1.88), async on tokio, default features `rustls-tls` and `dns-resolver`, so no OpenSSL. BSON values come from the `bson` 2.x crate that the driver re-exports.

A MongoDB deployment holds **databases**, each database holds **collections** (or views and time-series collections), and each collection holds **documents**. Berth Studio shows them in that order: connection → database → collection → documents.

## Connecting

- **Connection string:** `mongodb://host:port/…` or `mongodb+srv://cluster.example.net/…`. The password is never stored inside it; validation rejects a URI that carries one.
- **Credentials:** user name and auth database come from the profile, the password from the Keychain. They are passed as `ClientOptions::credential` (`Credential::builder()`), so the mechanism (SCRAM-SHA-256 on modern servers) is negotiated by the server.
- **Read preference:** each profile picks `primary` or `secondaryPreferred`. `secondary` is not offered, because on a single-node replica set it finds no eligible server and fails after the 30 s server-selection timeout.
- **Timeouts:** server selection 10 s and connect 10 s, instead of the driver's 30 s default, so an unreachable host fails quickly in a desktop app.
- **Topology:** the `hello` command reports `setName`, `isWritablePrimary` and `msg: "isdbgrid"` for a mongos. The sidebar shows the server version and whether it is a standalone server, a replica set or a sharded cluster.

## Read-only and production

MongoDB has no read-only session setting. Berth Studio uses three layers:

1. **Client side:** a profile marked read-only (every production profile) refuses inserts, updates and deletes before anything is sent. A production write needs the connection name typed, checked in Rust.
2. **Read preference:** reads may go to secondaries.
3. **Server side:** for real protection, connect with a user that has the built-in `read` role. `read` allows `find`, `listCollections`, `listIndexes`, `collStats` and `dbStats`; writes need `readWrite`.

`connectionStatus` with `showPrivileges: true` reports the roles of the signed-in user. Showing them after a connection test is planned.

## Catalog

| Operation | How | Notes |
|---|---|---|
| Databases | `list_databases()` with `authorized_databases(true)` | Without the cluster `listDatabases` privilege, the server returns only the databases the user can access |
| Collections | `list_collections()` | Returns the type (`collection`, `view`, `timeseries`), options and validator |
| Counts | `estimated_document_count()` | Uses collection metadata, so it is instant. Views get no count |
| Indexes | `list_indexes()` | |
| Server version | `buildInfo` | |

The `collStats` and `currentOp` **commands** are deprecated since MongoDB 6.2. Use the `$collStats` and `$currentOp` aggregation stages instead.

## Reading

- `find(filter).projection(..).sort(..).skip(..).limit(..).max_time(..)`: options are chained builders in driver 3.x.
- `aggregate(pipeline).max_time(..)`.
- Results are cut at 1,000 documents and marked `truncated`; the cursor asks for one more than the limit to know whether more exist.
- Filter, sort, projection and pipelines are typed as Extended JSON (`{"$oid": …}`, `{"$date": …}`), at most 256 KiB each. A pipeline is an array of stages with one operator each.
- Documents are sent to the interface as relaxed Extended JSON. `Bson::into_relaxed_extjson` panics on `Decimal128`, so that value is written in its canonical form (`{"$numberDecimal": "19.99"}`) instead.
- The grid shows `ObjectId` as its hex string and dates as ISO 8601; the side pane shows the Extended JSON as it is.
- A document is at most 16 MiB and nests at most 100 levels.

## Writing

`insert_one`, `replace_one` by `_id`, and `delete_one` by `_id`. Each one goes through the read-only and production checks above. A pipeline with `$out` or `$merge` writes too, so it follows the same rules, and a read-only session refuses it before sending it. A replacement may not change `_id`. Multi-document transactions need a replica set or sharded cluster; they are not used yet.

## Cancelling

The driver has no cancellation API, and dropping a driver future part-way can leave its internals inconsistent. So:

- `find` and `aggregate` are sent with `maxTimeMS` (30 s), so the **server** stops them;
- every operation runs in its own task. After `maxTimeMS` plus the selection timeout and a short grace period, the app stops waiting and reports `BerthTimeout`, but the task is allowed to finish.

Stopping a query by operation id (`$currentOp` with a `comment`, then `killOp`) is planned.

## Testing

`scripts/dev-db/mongo-start.sh` starts a single-node replica set on `127.0.0.1:54330` with authentication, users `app` (`readWrite` on `events`) and `app_ro` (`read` on `events`), and sample data in `events.events` and `events.sessions`. Run the tests with:

```bash
BERTH_TEST_MONGO=127.0.0.1:54330 cargo test --workspace
```

The tests in `crates/berth-mongo/tests/live.rs` cover the catalog, finds, aggregation, writes, and both read-only layers (the client guard and the server refusing the `read` user). The desktop app's test covers the production guard. `scripts/dev-db/mongo-stop.sh` stops the server and deletes its data.

Install the server with Homebrew:

```bash
brew tap mongodb/brew && brew install mongodb/brew/mongodb-community@8.0
```

Current Homebrew loads formulae from a third-party tap only once you trust them. The install reads `mongodb-community@8.0`, its dependency `mongodb-database-tools`, and the formulae it conflicts with (such as `mongodb-enterprise`, which is not installed). Trust each one Homebrew names with `brew trust --formula mongodb/brew/<formula>`, or the whole tap with `brew trust mongodb/brew`. CI trusts the whole tap, because the set of conflicting formulae changes between Homebrew versions.

## Sources

- Driver API: https://docs.rs/mongodb/3.9.1/mongodb/
- Features: https://docs.rs/crate/mongodb/3.9.1/features
- Migration to 3.x (builder options): https://github.com/mongodb/mongo-rust-driver/blob/main/migration-3.0.md
- Run a command, read preference: https://www.mongodb.com/docs/drivers/rust/current/run-command/
- Extended JSON and Decimal128: https://docs.rs/bson/2.15.0/bson/enum.Bson.html
- Built-in roles: https://www.mongodb.com/docs/manual/reference/built-in-roles/
- `hello`: https://www.mongodb.com/docs/manual/reference/command/hello/
- `$collStats`: https://www.mongodb.com/docs/manual/reference/operator/aggregation/collStats/
- `killOp`, `$currentOp`: https://www.mongodb.com/docs/manual/reference/command/killOp/
- Limits: https://www.mongodb.com/docs/manual/reference/limits/
- Install on macOS: https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-os-x/
- Replica set for testing: https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-for-testing/

## Unverified

- Which server version `brew install mongodb-community` installs today. The manual already lists 9.0 as current; the tap README still says 8.0. The tests use the `@8.0` formula explicitly.
