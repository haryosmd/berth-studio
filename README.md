<h1 align="center">Berth Studio</h1>

<p align="center">
  One app for your databases and your APIs.<br>
  Light, quick, and careful with your secrets.
</p>

<p align="center">
  🇬🇧 <b>English</b> ·
  🇮🇩 <a href="README.id.md">Bahasa Indonesia</a> ·
  🇨🇳 <a href="README.zh-CN.md">简体中文</a> ·
  🇯🇵 <a href="README.ja.md">日本語</a> ·
  🇸🇦 <a href="README.ar.md">العربية</a> ·
  🇷🇺 <a href="README.ru.md">Русский</a>
</p>

> **Heads up:** Berth Studio is in early development. The macOS app can be [downloaded](https://github.com/haryosmd/berth-studio/releases/latest) and talks to PostgreSQL and MongoDB. The clickable prototype shows where it's heading.

## Why Berth Studio?

If you build backends, your day probably looks like this:

- DBeaver open for the database;
- Postman open for the API;
- a notes file full of connection strings for dev, staging and prod.

Berth Studio puts all of that in one window, and it treats production with the care it deserves.

## What it does

- **Databases:** PostgreSQL, MongoDB, Supabase and Firebase. Browse tables, edit rows, run queries and read documents.
- **dev, staging and prod:**
  - One connection has one profile per environment, and each profile has its own host and credentials.
  - Your team names its own environments (local, qa, prod-eu and so on), and a tab can be pinned to its own environment so you can compare two side by side.
  - When a connection doesn't exist in that environment, Berth Studio says so instead of guessing.
- **Separate read and write databases:**
  - A profile can have a primary and read replicas.
  - Reads go to a replica automatically, and writes always stay on the primary.
  - You can pin a query to either one yourself, and a profile with only read replicas simply can't write.
- **API Collections:** Requests live in folders inside folders, like the file tree in VS Code. You can import from Postman, Insomnia, OpenAPI, HAR, Bruno or cURL.
- **ERD:** Draw diagrams from a live schema, or sketch new tables freely.
- **Safety nets:**
  - Production opens read-only.
  - Every grid edit shows its SQL before it runs.
  - Writing to prod means typing the connection name first.
- **Secrets:** Passwords and tokens stay in your system keychain. They never go into workspace files or show up in the UI.
- **Updates:** When a new version is released, an icon appears at the top right. One click downloads it, and the app installs it only if its signature checks out.

## Try it

### Download the app (macOS)

Grab the latest `.dmg` from the [releases page](https://github.com/haryosmd/berth-studio/releases/latest). One build runs on both Apple silicon and Intel Macs. Open the `.dmg` and drag Berth Studio into Applications.

The app isn't signed with an Apple Developer ID yet, so macOS blocks the first launch. Open **System Settings → Privacy & Security**, scroll down and choose **Open Anyway**. Later versions arrive through the in-app updater, which only installs an update whose signature checks out.

### Run from source (macOS)

You need Rust (via `rustup`), Node.js 20 or newer, and the Xcode Command Line Tools. The first build takes a few minutes. The second command starts a throwaway PostgreSQL with sample data on `127.0.0.1:54329` (user `app`, password `berth-dev-app`; `scripts/dev-db/stop.sh` removes it again). For MongoDB, install `mongodb-community@8.0` from Homebrew and run `scripts/dev-db/mongo-start.sh`: a throwaway replica set on `127.0.0.1:54330` (user `app`, password `berth-dev-app`, auth database `events`).

```bash
npm ci
scripts/dev-db/start.sh
npm run tauri dev
```

### Connect to a database in the cloud

Managed databases such as Amazon RDS and Aurora, Azure Database, Google Cloud SQL or DigitalOcean sign their server certificates with the provider's own CA, which macOS doesn't trust out of the box. Berth Studio checks the certificate anyway, so the connection test fails with `invalid peer certificate: UnknownIssuer` until you give it the provider's CA.

1. Download the CA certificate (a `.pem` file) from your provider. It's usually on the database's connection page, called "CA certificate", "root certificate" or "SSL certificate":
   - **Amazon RDS and Aurora:** one bundle per region, or the global bundle, from the [RDS trust store](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
   - **Azure Database for PostgreSQL:** the root certificates listed in the [TLS docs](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls).
   - **Google Cloud SQL:** the server CA on the instance's **Connections** page, see [the docs](https://cloud.google.com/sql/docs/postgres/configure-ssl-instance).
   - **DigitalOcean:** the CA certificate on the database's **Overview** page, see [the docs](https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/).
2. In the connection sheet of a PostgreSQL connection, put the file's path into the **CA certificate** field of that environment's profile. A path may start with `~`.
3. Click **Test**. The file is read on every connection, so keep it where it is.

The CA file adds to the system trust store; it never replaces it. Databases on your own machine, or with TLS off, don't need one.

### Open the prototype

It's a single HTML file with sample data. Nothing connects to a real database.

```bash
open design/prototype.html
```

On Windows or Linux, just double-click the file.

Things worth trying:

1. **Missing profiles:** switch the environment to **dev** in the top bar. `events-db` turns grey because it has no dev profile.
2. **Query routing:** open the **Query editor** and click the `acme-db · dev · auto → read` chip to see where your query runs.
3. **Folders:** hover a folder in **API Collections** and click **+** to add a request or a folder.
4. **Import:** press **⇧⌘I** and try a sample import.
5. **Jump anywhere:** press **⌘K**.

### Run the tests

You need Node.js 20 or newer. There's nothing else to install.

```bash
npm test
```

## What's in this repo

| Path | What's inside |
|---|---|
| [`design/prototype.html`](design/prototype.html) | The clickable prototype |
| [`design/tests/`](design/tests/) | Unit tests for the prototype's logic |
| [`apps/desktop/`](apps/desktop/) | The desktop app: the React interface and the Tauri shell |
| [`crates/`](crates/) | Rust: profiles and query routing, Keychain, the PostgreSQL and MongoDB drivers |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the app is built, and why |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's done and what comes next |
| [`docs/SECURITY.md`](docs/SECURITY.md) | The threat model and every security control |
| [`docs/RELEASING.md`](docs/RELEASING.md) | How releases and in-app updates work, including the signing key and its password |

## Security

**Found a vulnerability?** Please don't open a public issue. Report it privately as explained in [SECURITY.md](SECURITY.md).

**Curious how Berth Studio protects your secrets, its code and its releases?** Read [docs/SECURITY.md](docs/SECURITY.md).

## Contributing

Glad to have you! Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The short version:

- **CLA:** sign the [CLA](CLA.md) once. A bot asks you on your first pull request.
- **Sign-off:** sign off every commit with `git commit -s`.
- **Tests:** run `npm test` before you push.

## License

Berth Studio is released under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
