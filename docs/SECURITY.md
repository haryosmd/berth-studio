# Berth Studio threat model and security controls

This document explains what Berth Studio protects, who it protects it from, and which control handles each threat. It is the reference for code review. A change that weakens a control listed here needs a written reason in its pull request.

Status:
- Controls marked **implemented** are in the desktop app and covered by tests.
- Controls marked **prototype** exist and are tested in `design/prototype.html`, and are waiting to be ported to the app.
- Unmarked controls are requirements for the stages ahead. See [ROADMAP.md](ROADMAP.md).

## What we protect

1. **Secrets.**
   - Database passwords, SSH key passphrases, API tokens, Supabase access tokens and Firebase service-account keys.
2. **Production data.**
   - Rows and documents in the databases Berth Studio connects to.
   - Most important: the user's ability to avoid changing them by mistake.
3. **The user's machine.**
   - Nothing Berth Studio opens may run code or read files it should not.
4. **The integrity of Berth Studio itself.**
   - The source, the dependencies, the builds and the updates.

## Who we defend against

| Actor | Goal | Main controls |
|---|---|---|
| Malicious contributor | Slip a backdoor into the source | Review rules, CODEOWNERS, CI without secrets, CLA and DCO |
| Compromised dependency | Run code at build time or run time | Lockfiles, `cargo deny`, `--ignore-scripts`, few dependencies |
| Attacker in the build or release path | Ship a tampered binary or update | Protected releases, provenance, signing, signed updates |
| Hostile content | Run code or steal secrets through what Berth Studio displays: an imported collection, a database value, an HTTP response or a workspace file | Strict parsing, escaping, scripts off, URL scheme block, CSP |
| Malware on the user's machine | Read secrets or tamper with Berth Studio | OS secret stores, no secrets on disk, short-lived tokens, Touch ID |
| Hostile network | Read or change traffic | TLS `verify-full`, SSH host-key pinning |

## 1. Source: nobody slips code in

- **Protected `main`:** pull requests only, at least one code-owner approval, and status checks must pass. Force pushes and branch deletion are off. Stale approvals are dismissed when new commits arrive. The rules apply to administrators too.
- **CODEOWNERS:** covers every path. The sensitive paths are `.github/`, `apps/desktop/src-tauri/`, `crates/berth-secrets/`, `crates/berth-postgres/`, the dependency manifests and lockfiles, and the security documents. Once a second maintainer exists, these paths need two approvals.
- **Signed commits:** maintainers sign commits and tags with SSH or GPG keys. Release tags must be signed.
- **CLA and DCO:** every contributor signs the CLA, and every commit has a DCO sign-off. See [CONTRIBUTING.md](../CONTRIBUTING.md).
- **CI on pull requests:**
  - It runs with `permissions: contents: read`.
  - It never uses `pull_request_target` with a checkout of the contributor's code.
  - Pull requests from forks get no secrets.
  - Workflows from first-time contributors need a maintainer's approval before they run.
- **Repository settings:** see [Repository settings](#repository-settings) below.

## 2. Dependencies

- **Lockfiles** (implemented):
  - `Cargo.lock` and `package-lock.json` are committed.
  - `.npmrc` sets `ignore-scripts=true`, so no package can run code during install, locally or in CI.
- **`cargo deny`:** checks advisories, a license allowlist compatible with Apache-2.0, banned crates, and an allowlist of sources (crates.io only, no git dependencies).
- **Audits** (implemented):
  - `cargo audit` and `npm audit` fail the build on any vulnerability.
  - `npm audit signatures` verifies every package's registry signature.
- **Cool-down** (implemented): a version is used only once it is at least 7 days old.
  - npm installs use `--before`.
  - `scripts/check-crate-ages.py` checks every crate in `Cargo.lock`.
  - Only a release that fixes a security advisory may skip the wait. See [DEPENDENCIES.md](DEPENDENCIES.md).
- **Dependabot** (configured in `.github/dependabot.yml`):
  - grouped weekly updates with the same 7-day cool-down;
  - reviewed like code;
  - major versions get a manual changelog read.
- **GitHub Actions:** every action is pinned to a full commit SHA. Third-party actions are kept to a minimum.
- **Few dependencies:** this is policy. Each new crate or package needs a reason in its pull request.

## 3. Builds, releases and updates

- **Who releases:** only maintainers. A release starts from a signed tag and runs in a protected GitHub environment that needs manual approval.
- **What each release publishes:**
  - GitHub build-provenance attestations (SLSA level 3 with GitHub-hosted runners);
  - a CycloneDX SBOM;
  - `SHA256SUMS` signed with minisign.
- **Platform signing:**

| Platform | Signing | Secret store used by Berth Studio |
|---|---|---|
| macOS (first release) | Developer ID, hardened runtime, notarization, minimal entitlements | Keychain |
| Windows (later) | Authenticode through SignPath Foundation or Azure Trusted Signing | Credential Manager (DPAPI) |
| Linux (later) | minisign signatures on AppImage and .deb, plus the distribution's repository signing | Secret Service (GNOME Keyring or KWallet) |

- **Updates:**
  - The Tauri updater only installs updates signed with the minisign key. The public key is compiled into the binary.
  - The update endpoint is HTTPS only.
  - The private key lives only in the protected release environment.
  - Users can turn update checks off.
- **Reproducibility:** we aim for reproducible builds. `SOURCE_DATE_EPOCH` and pinned toolchains come first.

## 4. Hostile content inside the app

Everything Berth Studio displays is untrusted. That includes a database value, an HTTP response, a column name, an imported collection or a workspace file pulled from Git.

- **No HTML from data** (prototype):
  - All text is escaped before it reaches the page.
  - Tree rendering is tested with script and attribute-injection payloads (`treeHtml` tests).
- **Webview lockdown** (implemented):
  - A strict Content Security Policy with no remote scripts, no `eval` and no inline event handlers.
  - The prototype test suite already rejects inline handlers, `eval`, `new Function` and network calls in the page.
  - Tauri capabilities are granted per window. App commands are allowlisted one by one in `apps/desktop/src-tauri/build.rs` and `capabilities/main.json`.
  - The `shell`, `fs` and `http` plugins are not registered, and the webview never passes a file path to Rust.
  - **Exports** (implemented; `export.rs`): the webview sends the text and a suggested name. Rust strips any folder from the name, shows the native Save dialog, and writes only the path that dialog returns, through a temporary file and a rename, readable by the user only. The dialog plugin is used from Rust; its commands are not granted. CSV cells that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, carriage return, unless the cell is a plain number) get a leading apostrophe.
  - When workspaces become user-chosen folders, the file access will be limited to that folder.
- **Imports** (prototype; `importText` and its tests):
  - **Limits:** strict parsing with size limits of 10 MB, folder depth of 24 and 5000 items.
  - **Object safety:** objects are built field by field, so `__proto__` keys cannot pollute prototypes.
  - **Names:** control characters are removed from names.
  - **On-disk names:** they never contain path separators, never start with a dot, and avoid reserved Windows names (`fileName`).
  - **URLs:** only `http` and `https` requests are allowed. `file:`, `javascript:` and every other scheme are marked blocked.
  - **Secrets:** they move to the system keychain and are replaced with `{{VARIABLES}}`. Identical secrets share one entry.
  - **Scripts:** pre-request and test scripts are kept but turned off by default.
- **Scripts:** a user can turn on a script for one request. It then runs in an embedded JavaScript sandbox with no file system, process or network access. It sees only the request and response objects. A time and memory limit applies.
- **Databases** (implemented):
  - The server is untrusted, and values are rendered as text, never as HTML.
  - A PostgreSQL result keeps at most 5,000 rows; a MongoDB result at most 1,000 documents.
  - Table names reach SQL only after the catalog confirms them. MongoDB filters, sorts, projections and pipelines are parsed as JSON in Rust (at most 256 KiB each) and sent as BSON, never assembled as text.
  - The server cannot make the client take any action.

## 5. Production safety

These controls guard against human error. That threat is real even though nobody is attacking.

- **Read-only production** (implemented; `Profile::normalized`, `check_prod_write`):
  - "Production" is a flag on a workspace environment, so a team can have several (`prod-eu`, `prod-us`). Every environment with the flag gets the rules below.
  - Production profiles always open read-only. For PostgreSQL this is enforced by the server (`default_transaction_read_only`).
  - A write needs the connection name typed in full. The check runs in Rust, and the write uses a one-off session.
  - A tab pinned to a production environment is tinted red even when the workspace switcher shows another environment.
- **Read-only profiles** (implemented): a PostgreSQL profile with read replicas and no primary refuses every write in Rust (`BERTH_NO_WRITE`) before anything is sent.
- **MongoDB** (implemented; `berth-mongo`, `app.rs`): MongoDB has no read-only session, so the layers are:
  - a read-only profile refuses inserts, replacements, deletes and pipelines with `$out` or `$merge` in Rust;
  - in production, the same operations need the connection name typed;
  - for protection at the server, the profile should use a user with only the `read` role. The integration tests check that the server refuses such a user even when the client guard is off.
- **Removing an environment** (implemented): when the environment still has profiles, the change is refused until the user confirms the listed profiles, which are then deleted together with their Keychain items.
- **Read/write routing** (implemented; `berth_core::route`):
  - Only `SELECT`, `EXPLAIN` without `ANALYZE`, and `SHOW` go to a read replica.
  - Everything that might write stays on the primary. That means DML, DDL, `SELECT … FOR UPDATE`, `SELECT INTO`, sequence and advisory-lock functions, and anything inside a transaction.
  - Comments, string literals and dollar-quoted bodies are stripped before classification, so a keyword hidden inside them cannot change the route.
  - Read endpoints use read-only sessions, so even a write pinned to a replica is refused by the server.
  - The Rust classifier is a port of the prototype's and passes the same test cases.
  - Anything it does not recognise runs on the primary.
- **Grid edits:** they show the exact SQL with bound parameters before commit, and run in one transaction.

- **Updates** (implemented; `update.rs`, `release.yml`):
  - Update packages are signed with a minisign key that exists only as a secret of the protected `release` environment. The app refuses a package whose signature does not match the public key compiled into it.
  - `requireSignedVersion` is on: the version inside the signature must match the version in `latest.json`, so a tampered manifest cannot replay an older, validly signed release.
  - The manifest and package are fetched over HTTPS with rustls. Only `v*` tags, which only maintainers can create, trigger a release.
  - Release notes are shown as plain text, never as HTML.
  - **Privacy:** the check is an anonymous `GET` to GitHub when the app opens and every six hours. It carries no account, workspace or usage data; GitHub sees the IP address and the updater's user agent.

## 6. A compromised or hostile machine

**Malware with the user's privileges.** Such malware can watch the screen, log keystrokes and read the memory of processes the user owns. No desktop app can fully defend against that, and Berth Studio does not claim to. What Berth Studio does is keep the damage small and short-lived.

- **Secrets only in the OS secret store** (implemented for macOS):
  - `berth-secrets` uses `keyring-core` with the macOS Keychain store.
  - Windows Credential Manager and the Linux Secret Service follow behind the same trait.
  - Only `keychain://berth-studio/...` references are accepted. A workspace file cannot point the app at another program's keychain item.
  - A stored password stays bound to the server and user it was saved for. When an endpoint's host, port, user, MongoDB connection string or auth database changes, the password is dropped and must be typed again. So an edited or tampered workspace cannot send a saved password to another host. Connection tests apply the same rule.
  - Secrets are never in workspace files, logs, crash reports or the webview.
  - **Query history** (implemented; `history.rs`): every statement that reached a server is kept in `history.jsonl` in the app data folder, readable by the user only and never in the workspace. SQL that mentions a password (`ALTER ROLE … PASSWORD`) is not recorded, nor is SQL over 64 KiB. The newest 5,000 runs are kept, and the history can be cleared per connection. Saved queries are in the workspace file, so whatever SQL a user saves travels with it.
  - The webview only ever sees a keychain reference such as `keychain://berth-studio/acme-db/prod/write`.
  - On macOS the Keychain items carry an access control list tied to Berth Studio's code signature. Another app that asks for them triggers a system prompt.
- **Touch ID or the system password** is required to reveal a secret in the UI.
- **Memory:**
  - Secrets are zeroized after use (`zeroize`, implemented), and Rust code holds them for as short a time as possible.
  - Firebase and cloud tokens are short-lived OAuth tokens that refresh on their own.
- **No secrets on disk:**
  - A service-account file is read once, moved into the keychain, and never kept.
  - Exports and Git sync carry only variables and references.
- **Code signature and Gatekeeper.** Together with the hardened runtime, these make it harder to inject code into a running Berth Studio. On macOS, library validation blocks unsigned dynamic libraries.
- **Logs:** Berth Studio redacts connection strings, headers and query parameters that look like secrets before it writes anything.
- **Root or admin access.** An attacker with root, administrator or kernel access can read anything on the machine. That attacker is out of scope. Disk encryption (FileVault, BitLocker, LUKS) and OS updates are the user's defence there, and the documentation says so plainly.

## 7. Network

- **TLS** (implemented):
  - The default is TLS with full certificate and host-name verification for everything that is not `localhost`.
  - It uses rustls with the macOS trust store, and no OpenSSL.
  - The status bar shows the TLS version.
  - Turning verification off needs an explicit choice for each connection, and it shows a warning.
  - Pasted `curl -k` commands do not turn it off (prototype test).
- **SSH:**
  - Host keys are checked against `known_hosts`.
  - A new host shows its fingerprint and needs confirmation.
  - A changed host key blocks the connection.
- **No telemetry:** Berth Studio sends none. Crash reports are opt-in and stripped of queries, rows, headers and connection strings.

## Repository settings

These are set in the GitHub repository settings. They cannot be stored in the repository, so the maintainer applies them by hand when the repository is created, and checks them before every release.

**Branches and tags (rulesets):**
- `main`:
  - changes only through pull requests, with one code-owner approval;
  - stale approvals are dismissed;
  - required status checks, which are all jobs of the CI workflow;
  - linear history and signed commits;
  - no force pushes and no deletion;
  - administrators follow the same rules.
- Tags `v*`: only maintainers can create them, and they must be signed.

**Actions:**
- Default workflow permissions: read repository contents only. Workflows cannot create or approve pull requests.
- Fork pull requests:
  - require approval for all outside contributors before workflows run;
  - never send secrets or write tokens to fork pull requests.
- Allowed actions: GitHub-made actions only, pinned to full commit SHAs. The CI workflow uses nothing else.
- Releases run in a protected `release` environment with required reviewers. Its secrets (signing keys, the minisign key) exist only there.

**Code security:**
- Private vulnerability reporting.
- Dependabot alerts and security updates.
- Secret scanning with push protection.
- Code scanning (CodeQL).

**General:**
- Allow only squash merges.
- Automatically delete head branches after merge.
- Turn off wikis. They have no review step.
- The CLA Assistant app checks every pull request.

Forks cannot change any of this. A fork runs its own copy of the workflows, with its own permissions and none of our secrets. The CI workflow uses `pull_request`, never `pull_request_target`, so code from a fork never runs with access to this repository.

## Open items before 1.0

- Pick the JavaScript sandbox for user-enabled scripts (`rquickjs` or `boa`) and write its escape tests.
- Fuzz the importers with `cargo-fuzz` once they are ported to Rust.
- Earn the OpenSSF Best Practices badge and add the Scorecard workflow.
- Have a lawyer review the CLA, and an external reviewer check the release pipeline.
