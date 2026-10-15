# Dependencies

Every dependency is attack surface, so each one is here with the reason it exists. Add a row to this page in the same pull request that adds a dependency (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## How a version gets in

1. **A cool-down of at least 7 days.** Freshly published versions are where hijacked releases show up, and they are usually caught and pulled within days. So we pick the newest version that is at least a week old:
   - **npm:** install with `--before=<date a week ago>`. This applies to every package in the tree, not just the direct ones.
   - **Rust:** Cargo has no cool-down option, so pin the direct crates exactly (`=x.y.z`) when they are fresh. Then run `python3 scripts/check-crate-ages.py`, which checks every crate in `Cargo.lock`.
   - When it finds a crate that is too new, move it back with `cargo update -p <name>@<version> --precise <older version>`.
   - **Exception:** a release that fixes a security advisory skips the wait, because the older version would be the bigger risk.
     - `cargo deny check` catches this case.
     - Each exception is listed in `SECURITY_FIXES` in the script, together with its advisory id.
     - The only exception today is `rustls` 0.23.46, which fixes RUSTSEC-2026-0346 and RUSTSEC-2026-0347.
   - The first run found 27 crates newer than a week, for example `tauri-runtime` 2.12.2 and `rustls` 0.23.46. All of them were moved back except `rustls`, which stays at its security fix.
2. **No install-time code.**
   - `.npmrc` sets `ignore-scripts=true`, so no npm package runs code during install.
   - `npm query ':attr(scripts, [postinstall])'` must stay empty. Check `preinstall` and `install` the same way.
3. **Exact versions and lockfiles.** `.npmrc` sets `save-exact=true`. Changes to `package-lock.json` and `Cargo.lock` are reviewed like code.
4. **Automated checks, which all must pass:**
   - `npm audit` reports 0 vulnerabilities.
   - `npm audit signatures`: every package has a verified registry signature.
   - `cargo deny check`: advisories, an Apache-2.0-compatible licence allowlist, no OpenSSL, crates.io as the only source. The policy is in [`deny.toml`](../deny.toml).
   - `cargo audit`.
5. **Toolchain from signed sources.**
   - Rust comes from Homebrew's checksummed `rustup` bottle, never a `curl | sh` script.
   - The compiler version is pinned in [`rust-toolchain.toml`](../rust-toolchain.toml).

## Rust crates (direct)

| Crate | Version | Why it is here | Trust notes |
|---|---|---|---|
| `tauri`, `tauri-build` | =2.12.1, =2.7.1 (with `tauri-runtime`, `-utils`, `-codegen`, `-macros` held at the matching week-old releases) | The desktop shell: window, IPC, permissions | Tauri Programme (Commons Conservancy); security audits published |
| `serde`, `serde_json` | 1.0.229, 1.0.151 | Typed IPC and the workspace file | De facto standard; dtolnay |
| `thiserror` | 2.0.21 | Error types without boilerplate | dtolnay |
| `tokio` | 1.53.2 | Async runtime (only `rt`, `time`, `sync`) | tokio-rs |
| `tokio-postgres` | 0.7.18 | PostgreSQL protocol, no compile-time database needed | rust-postgres (sfackler) |
| `tokio-postgres-rustls`, `rustls` | 0.14.0, 0.23.46 | TLS to the database without OpenSSL | rustls is audited (Cure53) |
| `rustls-platform-verifier` | 0.7.1 | Checks certificates against the macOS trust store, host name included | rustls org |
| `keyring-core`, `apple-native-keyring-store` | 1.0.0, 1.0.2 | Passwords in the macOS Keychain | keyring-rs (open-source-cooperative); used instead of the all-in-one `keyring` crate, as its maintainers recommend for applications |
| `zeroize` | 1.9.1 | Wipes passwords from memory after use | RustCrypto |
| `mongodb` | 3.9.1 (with `bson` 2.15.0) | The official MongoDB driver. Default features only: `rustls-tls` and `dns-resolver` (for `mongodb+srv://`, through `hickory-resolver`) | MongoDB, Inc.; Apache-2.0 |
| `futures-util` | 0.3.34 | Reading driver cursors as streams (`std` feature only) | rust-lang |

Cryptography comes from `ring` 0.17.14, through rustls.

### Licence exception

`tiny-keccak` 2.0.2 is CC0-1.0, a public-domain dedication that is compatible with Apache-2.0 but not on the allowlist. It runs only at compile time, inside a macro the MongoDB driver uses (`const-random`), and is not linked into the app. `deny.toml` allows it for that one crate.

### Known `cargo audit` warnings

These two are warnings, not vulnerabilities. Both are in Tauri's GTK3 stack, which is only compiled for Linux; `cargo tree -i <crate> --target aarch64-apple-darwin` prints nothing for them. They will be reviewed again when the Linux build starts.

| ID | Crate | Kind | Pulled in by |
|---|---|---|---|
| RUSTSEC-2024-0429 | `glib` 0.18.5 | unsound (`VariantStrIter`) | `gtk` → `muda` / `tao`, Linux only |
| RUSTSEC-2024-0370 | `proc-macro-error` 1.0.4 | unmaintained | `glib-macros`, Linux only |

## npm packages (direct)

All of them were published at least 7 days before they were installed.

| Package | Version | Why it is here |
|---|---|---|
| `react`, `react-dom` | 19.3.0 | UI |
| `@tauri-apps/api` | 2.12.1 | `invoke()` for the IPC commands |
| `codemirror`, `@codemirror/lang-sql`, `@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@lezer/highlight` | 6.0.2, 6.10.0, 6.43.14, 6.7.6, 6.13.1, 1.2.5 | SQL editor. The last four were already in the tree; they are listed directly only because the editor imports them |
| `@tanstack/react-virtual` | 3.14.13 | Virtualised grid, so 5,000 rows stay smooth |
| `vite`, `@vitejs/plugin-react` | 8.3.3, 6.1.2 | Build only, not shipped in the app |
| `typescript`, `@types/react`, `@types/react-dom` | 7.0.2, 19.3.0, 19.3.0 | Type checking only |
| `@tauri-apps/cli` | 2.12.1 | Build and bundle the app; prebuilt binary, no install script |

### The full npm tree

These numbers are from the first install.

| Check | Result |
|---|---|
| Packages installed | 47 |
| Install scripts | none |
| `npm audit` | 0 vulnerabilities |
| `npm audit signatures` | all 47 signatures verified, 18 with provenance attestations |
| Licences | MIT, Apache-2.0, ISC and BSD-3-Clause, plus MPL-2.0 for `lightningcss`, a build-time CSS tool that is not shipped |

## Fonts

Geist and Geist Mono are licensed under the SIL Open Font License 1.1. They are bundled in `apps/desktop/public/fonts/` together with their [licence](../apps/desktop/public/fonts/OFL.txt), so the app never loads a remote font.
