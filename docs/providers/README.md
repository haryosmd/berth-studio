# Provider specifications

One page per data source. Each one records how Berth Studio connects, what it calls, the limits it must respect, and the official source for every fact, so the implementation is built on checked behaviour rather than memory.

| Provider | Status in the app | Page |
|---|---|---|
| PostgreSQL | Implemented | [postgresql.md](postgresql.md) |
| MongoDB | Implemented | [mongodb.md](mongodb.md) |
| Supabase | Specified, not implemented | [supabase.md](supabase.md) |
| Firebase | Specified, not implemented | [firebase.md](firebase.md) |

The facts were checked against the sources on 2026-10-15. Anything a page lists under **Unverified** must be tested against a real service before code depends on it.
