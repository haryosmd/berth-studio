<h1 align="center">Berth Studio</h1>

<p align="center">
  Satu aplikasi buat database dan API kamu.<br>
  Ringan, cepat, dan hati-hati banget sama secret kamu.
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>Bahasa Indonesia</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.ru.md">Русский</a>
</p>

> **Catatan:** Berth Studio masih tahap awal pengembangan. Aplikasi desktop pertamanya sudah bisa dijalankan dari source di macOS dan terhubung ke PostgreSQL, tapi belum ada versi yang bisa diunduh. Prototype yang bisa diklik menunjukkan arah tujuannya.

## Kenapa Berth Studio?

Kalau kamu backend engineer, hari-harimu mungkin kayak gini:

- DBeaver kebuka buat database;
- Postman kebuka buat API;
- catatan penuh connection string buat dev, staging, dan prod.

Berth Studio nyatuin semuanya dalam satu jendela, dan tetap memperlakukan production dengan hati-hati.

## Apa saja yang bisa dilakukan

- **Database:** PostgreSQL, MongoDB, Supabase, dan Firebase. Lihat tabel, edit baris, jalankan query, dan baca dokumen.
- **dev, staging, dan prod:**
  - Satu koneksi punya satu profil per environment, dan tiap profil punya host dan kredensial sendiri.
  - Nama environment bebas diatur tim kamu (local, qa, prod-eu, dan seterusnya), dan satu tab bisa dikunci ke environment-nya sendiri supaya dua environment bisa dibandingkan berdampingan.
  - Kalau koneksinya nggak ada di environment itu, Berth Studio bilang terus terang, bukan nebak-nebak.
- **Database read dan write terpisah:**
  - Satu profil bisa punya satu primary dan beberapa read replica.
  - Query baca otomatis ke replica, dan query tulis selalu tetap di primary.
  - Mau kunci manual ke salah satunya juga bisa, dan profil yang cuma punya read replica otomatis nggak bisa menulis.
- **API Collections:** Request disimpan dalam folder di dalam folder, mirip file tree di VS Code. Bisa import dari Postman, Insomnia, OpenAPI, HAR, Bruno, atau cURL.
- **ERD:** Gambar diagram dari skema asli, atau sketsa tabel baru sesukamu.
- **Pengaman:**
  - Production dibuka read-only.
  - Setiap edit di grid menampilkan SQL-nya dulu sebelum dijalankan.
  - Mau nulis ke prod, harus ngetik nama koneksinya dulu.
- **Secret:** Password dan token disimpan di keychain sistem. Nggak pernah masuk ke file workspace, dan nggak pernah tampil di UI.

## Coba sekarang

### Jalankan aplikasinya (macOS)

Kamu butuh Rust (lewat `rustup`), Node.js 20 atau lebih baru, dan Xcode Command Line Tools. Build pertama makan waktu beberapa menit. Perintah kedua menyalakan PostgreSQL sementara berisi data contoh di `127.0.0.1:54329` (user `app`, password `berth-dev-app`; `scripts/dev-db/stop.sh` menghapusnya lagi). Untuk MongoDB, install `mongodb-community@8.0` dari Homebrew lalu jalankan `scripts/dev-db/mongo-start.sh`: replica set sementara di `127.0.0.1:54330` (user `app`, password `berth-dev-app`, auth database `events`).

```bash
npm ci
scripts/dev-db/start.sh
npm run tauri dev
```

### Buka prototype

Prototype-nya cuma satu file HTML berisi data contoh. Nggak ada yang nyambung ke database sungguhan.

```bash
open design/prototype.html
```

Di Windows atau Linux, cukup klik dua kali file-nya.

Yang seru buat dicoba:

1. **Profil yang belum ada:** ganti environment ke **dev** di bar atas. `events-db` jadi abu-abu karena belum punya profil dev.
2. **Arah query:** buka **Query editor**, lalu klik chip `acme-db · dev · auto → read` buat lihat query kamu jalan di mana.
3. **Folder:** arahkan kursor ke folder di **API Collections**, lalu klik **+** buat nambah request atau folder.
4. **Import:** tekan **⇧⌘I** dan coba import contoh.
5. **Lompat ke mana saja:** tekan **⌘K**.

### Jalankan test

Butuh Node.js 20 ke atas. Selain itu nggak perlu install apa-apa.

```bash
npm test
```

## Isi repo ini

| Path | Isinya |
|---|---|
| [`design/prototype.html`](design/prototype.html) | Prototype yang bisa diklik |
| [`design/tests/`](design/tests/) | Unit test untuk logika prototype |
| [`apps/desktop/`](apps/desktop/) | Aplikasi desktopnya: tampilan React dan shell Tauri |
| [`crates/`](crates/) | Rust: profil dan routing query, Keychain, driver PostgreSQL dan MongoDB |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Cara aplikasinya dibangun dan alasannya, dalam bahasa Inggris |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Yang sudah selesai dan yang berikutnya, dalam bahasa Inggris |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model dan semua kontrol keamanan, dalam bahasa Inggris |

## Keamanan

**Nemu celah keamanan?** Tolong jangan buka issue publik. Laporkan secara privat sesuai panduan di [SECURITY.md](SECURITY.md).

**Penasaran gimana Berth Studio melindungi secret, kode, dan rilisnya?** Baca [docs/SECURITY.md](docs/SECURITY.md).

## Kontribusi

Senang banget kamu mau bantu! Baca [CONTRIBUTING.md](CONTRIBUTING.md) dulu. Versi singkatnya:

- **CLA:** tanda tangani [CLA](CLA.md) sekali saja. Bot akan mengingatkan di pull request pertamamu.
- **Sign-off:** kasih sign-off di setiap commit pakai `git commit -s`.
- **Test:** jalankan `npm test` sebelum push.

## Lisensi

Berth Studio dirilis dengan Apache License 2.0. Lihat [LICENSE](LICENSE) dan [NOTICE](NOTICE).
