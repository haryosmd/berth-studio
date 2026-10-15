# Security policy

Berth Studio stores database passwords, API tokens and service-account keys for its users. We treat security reports as the highest priority work in the project.

## Supported versions

Berth Studio is in its design stage and has no released builds yet. Until 1.0, only the latest release and the `main` branch receive security fixes.

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest 0.x release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Do not open a public issue.**

Report it privately through GitHub instead:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include what an attacker can do, the steps to reproduce it, and the version or commit you tested.

If GitHub is not an option for you, open a public issue that says only that you need a private channel. Give no details. A maintainer will reply with one.

What happens next:

- **Within 3 working days:** we confirm we received the report.
- **Within 7 days:** you get our first assessment and a severity rating.
- **Fix targets:** 30 days for critical and high severity issues, 90 days for the rest.
- **Disclosure:** we publish a GitHub Security Advisory with a CVE when it applies. We credit you unless you ask us not to.

## In scope

- Any way to read a secret that Berth Studio stores without the user's approval.
- Code execution or file access triggered by content Berth Studio opens. This includes:
  - imported collections;
  - database values;
  - HTTP responses;
  - service-account files;
  - workspace files from a Git repository.
- Bypassing the production guardrails. These are the read-only mode, the typed confirmation, and routing writes to read replicas.
- Tampering with updates, or with the release build and signing pipeline.
- Weaknesses in the TLS or SSH host verification Berth Studio performs.

## Out of scope

- Attacks that already need full control of the user's account or machine. [docs/SECURITY.md](docs/SECURITY.md) explains what Berth Studio still does to limit the damage in that case.
- Findings in third-party services such as Supabase, Firebase or your database server. Report those to the vendor.
- Missing security headers on the prototype's static demo page.

## Safe harbour

We will not take legal action against research done in good faith that follows this policy:

- **Your own data:** you use only your own accounts and data.
- **No disruption:** you avoid harming other users or degrading the service.
- **Time to fix:** you give us a reasonable time to fix the issue before you disclose it.

## Verifying a release

From the first release, every artifact can be checked before you install it:

- **Build provenance:** `gh attestation verify Berth-Studio.dmg --repo <owner>/berth-studio`
- **Checksums:** `minisign -Vm SHA256SUMS -P <public key>`. The public key is published here and compiled into the app's updater.
- **macOS signing:** `spctl --assess --type open --context context:primary-signature -v Berth-Studio.dmg` should report a Developer ID source that Apple notarized.

The minisign public key will be added to this file with the first release.
