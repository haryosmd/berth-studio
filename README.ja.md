<h1 align="center">Berth Studio</h1>

<p align="center">
  データベースと API を、ひとつのアプリで。<br>
  軽くて速くて、シークレットの扱いにはとことん慎重に。
</p>

<p align="center">
  🇬🇧 <a href="README.md">English</a> ·
  🇮🇩 <a href="README.id.md">Bahasa Indonesia</a> ·
  🇨🇳 <a href="README.zh-CN.md">简体中文</a> ·
  🇯🇵 <b>日本語</b> ·
  🇸🇦 <a href="README.ar.md">العربية</a> ·
  🇷🇺 <a href="README.ru.md">Русский</a>
</p>

> **お知らせ：** Berth Studio は開発の初期段階です。macOS アプリは[ダウンロード](https://github.com/haryosmd/berth-studio/releases/latest)でき、PostgreSQL と MongoDB に接続できます。目指す姿はクリックできるプロトタイプで確認できます。

## なぜ Berth Studio？

バックエンドエンジニアの毎日は、たぶんこんな感じですよね。

- データベース用に DBeaver を開き、
- API 用に Postman を開き、
- dev・staging・prod の接続文字列でいっぱいのメモも手放せない。

Berth Studio はこれをひとつのウィンドウにまとめます。もちろん、本番環境はしっかり慎重に扱います。

## できること

- **データベース：** PostgreSQL、MongoDB、Supabase、Firebase に対応しています。テーブルの閲覧、行の編集、クエリの実行、ドキュメントの確認ができます。
- **dev・staging・prod：**
  - 1 つの接続が、環境ごとにプロファイルを 1 つずつ持ちます。各プロファイルには専用のホストと認証情報があります。
  - 環境の名前はチームで自由に決められます（local、qa、prod-eu など）。タブごとに環境を固定すれば、2 つの環境を並べて見比べられます。
  - その環境に接続が存在しなければ、推測せずにはっきり教えてくれます。
- **読み取り用と書き込み用の DB を分けられる：**
  - プロファイルにはプライマリ（primary）と、リードレプリカ（read replica）を複数設定できます。
  - 読み取りは自動でレプリカへ、書き込みは常にプライマリへ送られます。
  - どちらかに手動で固定することもできます。リードレプリカだけのプロファイルは、そもそも書き込めません。
- **API Collections：** リクエストを何階層でもフォルダに入れられます。VS Code のファイルツリーと同じ感覚です。Postman、Insomnia、OpenAPI、HAR、Bruno、cURL からインポートできます。
- **ERD：** 実際のスキーマから図を描いたり、新しいテーブルを自由にスケッチしたりできます。
- **セーフティネット：**
  - 本番環境は読み取り専用で開きます。
  - グリッドでの編集は、実行前に必ず SQL を表示します。
  - 本番に書き込むには、先に接続名を入力する必要があります。
- **シークレット：** パスワードやトークンは OS のキーチェーンに保存されます。ワークスペースのファイルに書かれることも、UI に表示されることもありません。
- **アップデート：** 新しいバージョンが公開されると、右上にアイコンが表示されます。ワンクリックでダウンロードでき、署名を確認できたときだけインストールされます。

## 試してみる

### アプリをダウンロードする（macOS）

[リリースページ](https://github.com/haryosmd/berth-studio/releases/latest)から最新の `.dmg` を取得します。1 つのビルドで Apple シリコンと Intel の両方の Mac で動きます。`.dmg` を開いて、Berth Studio をアプリケーションフォルダにドラッグしてください。

アプリはまだ Apple Developer ID で署名されていないため、初回起動は macOS にブロックされます。**システム設定 → プライバシーとセキュリティ**を開き、下にスクロールして**このまま開く**を選んでください。以降のバージョンはアプリ内アップデーターで届き、署名の検証に通ったものだけがインストールされます。

### ソースから動かす（macOS）

Rust（`rustup` 経由）、Node.js 20 以降、Xcode Command Line Tools が必要です。最初のビルドには数分かかります。2 つ目のコマンドで、サンプルデータ入りの使い捨て PostgreSQL が `127.0.0.1:54329` で起動します（ユーザー `app`、パスワード `berth-dev-app`。`scripts/dev-db/stop.sh` で削除できます）。MongoDB を使う場合は Homebrew で `mongodb-community@8.0` を入れ、`scripts/dev-db/mongo-start.sh` を実行します。使い捨てのレプリカセットが `127.0.0.1:54330` で起動します（ユーザー `app`、パスワード `berth-dev-app`、認証データベース `events`）。

```bash
npm ci
scripts/dev-db/start.sh
npm run tauri dev
```

### クラウドのデータベースに接続する

Amazon RDS や Aurora、Azure Database、Google Cloud SQL、DigitalOcean などのマネージドデータベースは、サーバー証明書をプロバイダー独自の CA で署名しており、macOS は標準ではそれを信頼しません。Berth Studio は証明書をきちんと検証するので、プロバイダーの CA を渡すまで接続テストは `invalid peer certificate: UnknownIssuer` で失敗します。

1. プロバイダーから CA 証明書（`.pem` ファイル）をダウンロードします。たいていはデータベースの接続ページにあり、「CA certificate」「root certificate」「SSL certificate」などと呼ばれています。
   - **Amazon RDS と Aurora：** リージョンごとのバンドル、またはグローバルバンドルを [RDS のトラストストア](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)から。
   - **Azure Database for PostgreSQL：** [TLS のドキュメント](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-networking-ssl-tls)に載っているルート証明書。
   - **Google Cloud SQL：** インスタンスの**接続**ページにあるサーバー CA。[ドキュメント](https://cloud.google.com/sql/docs/postgres/configure-ssl-instance)を参照。
   - **DigitalOcean：** データベースの**概要**ページにある CA 証明書。[ドキュメント](https://docs.digitalocean.com/products/databases/postgresql/how-to/connect/)を参照。
2. PostgreSQL 接続の接続シートで、その環境のプロファイルにある **CA certificate** 欄にファイルのパスを入力します。パスは `~` で始めても構いません。
3. **Test** をクリックします。ファイルは接続のたびに読み込まれるので、その場所に置いたままにしてください。

CA ファイルはシステムのトラストストアに追加されるだけで、置き換えはしません。手元のマシン上のデータベースや TLS を無効にしたデータベースには不要です。

### プロトタイプを開く

プロトタイプはサンプルデータ入りの HTML ファイル 1 つだけです。本物のデータベースには一切接続しません。

```bash
open design/prototype.html
```

Windows や Linux では、ファイルをダブルクリックするだけで開けます。

ぜひ試してほしいこと：

1. **プロファイルがない場合：** 上部バーで環境を **dev** に切り替えてみてください。`events-db` は dev のプロファイルがないのでグレーになります。
2. **クエリの送り先：** **Query editor** を開いて `acme-db · dev · auto → read` のチップをクリックすると、クエリがどこで実行されるか確認できます。
3. **フォルダ：** **API Collections** のフォルダにカーソルを合わせ、**+** からリクエストやフォルダを追加できます。
4. **インポート：** **⇧⌘I** を押して、サンプルをインポートしてみてください。
5. **どこへでもジャンプ：** **⌘K** を押します。

### テストを実行する

Node.js 20 以上が必要です。ほかにインストールするものはありません。

```bash
npm test
```

## リポジトリの中身

| パス | 内容 |
|---|---|
| [`design/prototype.html`](design/prototype.html) | クリックできるプロトタイプ |
| [`design/tests/`](design/tests/) | プロトタイプのロジックの単体テスト |
| [`apps/desktop/`](apps/desktop/) | デスクトップアプリ：React の UI と Tauri のシェル |
| [`crates/`](crates/) | Rust：プロファイルとクエリのルーティング、キーチェーン、PostgreSQL と MongoDB のドライバー |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | アプリの作りとその理由。英語です |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 完了したことと今後の予定。英語です |
| [`docs/SECURITY.md`](docs/SECURITY.md) | 脅威モデルとすべてのセキュリティ対策。英語です |
| [`docs/RELEASING.md`](docs/RELEASING.md) | リリースとアプリ内アップデートの仕組み。署名鍵とそのパスワードについても説明しています。英語です |

## セキュリティ

**脆弱性を見つけたら：** 公開の issue は立てずに、[SECURITY.md](SECURITY.md) の手順で非公開で報告してください。

**Berth Studio がシークレット、コード、リリースをどう守っているか知りたいときは：** [docs/SECURITY.md](docs/SECURITY.md) にまとめています。

## コントリビュート

大歓迎です！まずは [CONTRIBUTING.md](CONTRIBUTING.md) を読んでください。ざっくり言うと次の 3 つです。

- **CLA：** [CLA](CLA.md) に 1 回だけ署名します。初めての pull request でボットが案内します。
- **サインオフ：** すべてのコミットに `git commit -s` でサインオフを付けます。
- **テスト：** push する前に `npm test` を実行します。

## ライセンス

Berth Studio は Apache License 2.0 で公開しています。詳しくは [LICENSE](LICENSE) と [NOTICE](NOTICE) をご覧ください。
