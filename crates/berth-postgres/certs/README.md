# Amazon RDS root certificates

`rds-global-bundle.pem` is Amazon's global CA bundle for RDS and Aurora, downloaded unchanged from
<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>.

`berth-postgres` embeds it with `include_str!` and trusts its roots, besides the system trust
store, for hosts under `rds.amazonaws.com` and `rds.amazonaws.com.cn` only. A user's own CA
certificate file still adds to it. Every other host sees only the system trust store.

| | |
| --- | --- |
| Downloaded | 2026-10-16 |
| SHA-256 | `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b` |
| Certificates | 114 |

Refresh it before a release when AWS adds roots, then commit both files:

```bash
scripts/certs/refresh-rds-bundle.sh
```
