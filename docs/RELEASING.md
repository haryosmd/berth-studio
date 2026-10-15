# Releasing

Pushing a version tag builds, signs and publishes a release. Installed copies of Berth Studio check the newest release when they open and every six hours, and show an update icon in the title bar when there is a newer version.

## How an update reaches users

1. A maintainer pushes a tag such as `v0.2.0`. The tag ruleset only lets maintainers create `v*` tags.
2. [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs in the protected `release` environment:
   - it checks that the tag, `tauri.conf.json` and `Cargo.toml` all carry the same version;
   - it builds a universal app (Apple silicon and Intel), a `.dmg`, and the update package `.app.tar.gz`, signed with the updater key;
   - it publishes a GitHub release with the `.dmg`, the update package, its `.sig`, `latest.json` and `SHA256SUMS`. The release notes are GitHub's generated notes.
3. Installed apps download `https://github.com/haryosmd/berth-studio/releases/latest/download/latest.json`. When its version is newer, the update icon appears.
4. **Download and install** fetches the package, and the app refuses it unless:
   - the minisign signature matches the public key built into the app (`plugins.updater.pubkey` in `tauri.conf.json`);
   - the version inside the signature matches the version in `latest.json` (`requireSignedVersion`), so an older, validly signed release cannot be replayed as a new one.
5. **Restart now** starts the new version. Quitting and reopening does the same.

A tag with a pre-release suffix, such as `v0.3.0-beta.1`, is published as a pre-release and never marked latest, so installed apps do not offer it.

## Cutting a release

1. In a pull request, set the new version in both places and merge it:
   - `version` in [`apps/desktop/src-tauri/tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json);
   - `version` under `[workspace.package]` in [`Cargo.toml`](../Cargo.toml), then run `cargo update --workspace` so `Cargo.lock` follows.
2. Tag the merged commit on `main` and push the tag:

```bash
git switch main && git pull && git tag v0.2.0 && git push origin v0.2.0
```

3. Watch the **Release** workflow in the Actions tab. When it finishes, the release is public and installed apps see it within six hours, or at their next launch.

## One-time setup: the updater signing key

**Who needs this.** Only the maintainer who publishes releases, once. Running the app, developing it, or opening a pull request needs no key.

**What the key is.** A key pair made for this project, unrelated to any Apple, GitHub or Mac account:

| Part | File | Where it goes | Secret? |
|---|---|---|---|
| Public key | `berth-studio-updater.key.pub` | `tauri.conf.json`, built into every copy of the app | No, it is meant to be public |
| Private key | `berth-studio-updater.key` | The `release` environment on GitHub, and the maintainer's password manager | Yes, the most sensitive secret of the project |
| Password | none | Encrypts the private key file; stored next to it as a second secret | Yes |

**Why it matters.** The app installs an update only when the update is signed by the private key. That is what stops someone who takes over a download link, or the release page, from pushing their own code to every user. It also means whoever holds the private key and its password can ship code to every installed copy, so treat them like the keys to production.

**The password is not your Mac password.** It is a new password you choose when generating the key. It keeps the key file useless to anyone who copies it, for example from a backup. Use a long random one from a password manager.

The private key never enters the repository, a pull request workflow, or a chat.

1. Generate the key pair on the maintainer's Mac. It asks for a password:

```bash
npm run tauri signer generate -- -w ~/.tauri/berth-studio-updater.key
```

2. Put the **public** key (`~/.tauri/berth-studio-updater.key.pub`) into `plugins.updater.pubkey` in `tauri.conf.json`, in a pull request.
3. Store the **private** key and its password as secrets of the `release` environment only:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/berth-studio-updater.key
```

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release
```

4. In the repository settings, give the `release` environment a required reviewer and limit it to `v*` tags.
5. Back up the private key and its password somewhere safe, such as a password manager. If the key is lost, installed copies can never verify an update again, and users must reinstall from a `.dmg` signed with a new key.

## Not yet in place

- **Apple code signing and notarization.** Until the app is signed with a Developer ID, macOS blocks the first launch of a downloaded `.dmg`: open **System Settings → Privacy & Security** and choose **Open Anyway**. In-app updates are not affected, because the app downloads them itself and checks their minisign signature.
- Build provenance attestations and an SBOM (see [ROADMAP.md](ROADMAP.md)).
