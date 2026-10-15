# Contributing to Berth Studio

Thanks for helping. Berth Studio handles database passwords, API tokens and production data, so the bar for review is high. This page explains how to contribute without lowering it.

## Before you start

- **Security issues:** report them privately, as described in [SECURITY.md](SECURITY.md). Never open a public issue for one.
- **Large changes:** open an issue first so the design can be agreed before you write code. This covers a new database engine, a new import format, or anything that touches secrets.
- **Where things are:**
  - the desktop app is in `apps/desktop/` and `crates/`;
  - the clickable prototype in `design/` still shows where the app is going.

  See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Legal

Every pull request needs two things.

1. **The Contributor License Agreement.** Read [CLA.md](CLA.md). On your first pull request, the CLA Assistant bot asks you to sign it with a comment, and you only sign once. The CLA lets the project change its license later without asking every contributor again. You keep the copyright to your work.
2. **A Developer Certificate of Origin sign-off on every commit.** Use `git commit -s`. It adds `Signed-off-by: Your Name <you@example.com>` and confirms you wrote the change or have the right to submit it.

## Signed commits

`main` only accepts commits with a verified signature, so set up signing once on every computer you commit from. An SSH key works and needs no GPG. Use a separate key per computer; GitHub accepts several, and removing one never affects the others.

1. Register the computer's public key on GitHub as a **signing** key. The first command grants `gh` permission to manage signing keys:

```bash
gh auth refresh -h github.com -s admin:ssh_signing_key
```

```bash
gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title "Work laptop"
```

2. In your clone, sign every commit and tag with that key:

```bash
git config gpg.format ssh && git config user.signingkey ~/.ssh/id_ed25519.pub && git config commit.gpgsign true && git config tag.gpgsign true
```

The commit email must be one of the verified emails on your GitHub account. If a pull request is blocked because a commit is unsigned, sign it again and push the branch: `git commit --amend --no-edit -S && git push --force-with-lease`.

## Making a change

Run the JavaScript tests, for the prototype and the UI helpers:

```bash
npm test
```

Run the Rust tests. The database tests need the throwaway servers from `scripts/dev-db/start.sh` (PostgreSQL) and `scripts/dev-db/mongo-start.sh` (MongoDB, installed with `brew install mongodb/brew/mongodb-community@8.0`). Each group skips itself when its variable is not set:

```bash
BERTH_TEST_PG=127.0.0.1:54329 BERTH_TEST_MONGO=127.0.0.1:54330 cargo test --workspace
```

Run the linters and the type check:

```bash
cargo clippy --workspace --all-targets -- -D warnings && cargo fmt --all -- --check && npm run typecheck
```

- **Tests:** add or update tests with every change to logic.
  - Rust: the crates under `crates/` and `apps/desktop/src-tauri/src/app.rs`.
  - The prototype: its `berth-core` block, tested in `design/tests/`.
  - The interface helpers: `apps/desktop/src/logic.ts`, tested in `apps/desktop/tests/`.
- **Security rules belong in Rust:** routing, the production guard, read-only sessions and secrets are enforced in `apps/desktop/src-tauri/src/app.rs` and the crates. The UI only reflects them.
- **One topic per pull request:** keep it small, and describe what changed and how you checked it.
- **Style:** match the surrounding code. The prototype has no build step, so it stays one HTML file with plain JavaScript.
- **Content from the page:** never put text from files, databases or responses into the page as HTML. Escape it with `esc()` the way the existing code does.
- **The README comes in six languages:** English, Indonesian, Chinese, Japanese, Arabic and Russian. When you change one, update all six. `npm test` fails if their links or structure drift apart.

## Dependencies

Every new dependency is new attack surface, so each one needs a reason.

- **Explain it:**
  - say in the pull request why the dependency is needed and what it replaces;
  - check its maintenance, its download count and its install scripts;
  - add it to [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
- **Wait a week:** only use a version that was published at least 7 days ago. For npm, install with `--before`, as in the example below.
- **No install scripts:** `.npmrc` turns them off for every package (`ignore-scripts=true`).
- **Lockfiles:** `Cargo.lock` and the npm lockfile are committed, and changes to them are reviewed like code.
- **Licenses:** only Apache-2.0-compatible licenses are allowed. `cargo deny` enforces this using [deny.toml](deny.toml).
- **Checks before you open the pull request:**
  - `npm audit`
  - `npm audit signatures`
  - `npm query ':attr(scripts, [postinstall])'`, which must print `[]`
  - `cargo deny check`
  - `cargo audit`

To add an npm package with the 7-day wait, set the date to one week ago. This example uses `<package>` and `<version>` as placeholders:

```bash
npm install --ignore-scripts --before=2026-10-08 <package>@<version>
```
- **GitHub Actions:** pin every action to a full commit SHA, not a tag.

## Review rules

- **`main` is protected:** every change arrives through a pull request, and nobody pushes directly, not even maintainers.
- **Approval:** a code owner must approve, and CI must pass.
- **Stricter paths:** changes to `.github/`, `apps/desktop/src-tauri/`, `crates/berth-secrets/`, signing, updates or secret storage need a second maintainer once the project has one.
- **Pull requests from forks:** their CI runs without repository secrets.
- **Releases:** a maintainer cuts them from a signed tag through a protected GitHub environment. [docs/RELEASING.md](docs/RELEASING.md) explains the full release process.
