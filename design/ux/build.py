"""Berth Studio UX case study builder.

    node design/ux/shots.mjs          # screenshots of the prototype -> design/ux/shots/
    python3 design/ux/build.py        # writes design/ux/case-study.html
    (then print the PDF with Chrome, see README.md in this folder)

Fonts come from the brand case study (design/brand/case-study.html), which embeds
Geist and Geist Mono, so both PDFs use the same type without another download.
"""
from pathlib import Path
import json
import re

OUT = Path(__file__).resolve().parent
BRAND = OUT.parent / 'brand'

NAVY, AMBER, TEAL, MIST, SLATE, PAPER, LINE, RED = '#0B2230', '#F2A93B', '#0E8A82', '#F4F7F8', '#4A5B66', '#FBFAF7', '#DCE3E6', '#B42318'

CROPS = json.loads((OUT / 'shots' / 'crops.json').read_text())
CROPS['coll-menu'].update(x=0, y=0.08, w=0.62, h=0.66)   # widen: show the request body next to the menu


def mark(width, top=AMBER, bottom=NAVY):
    h = width * 2.2361 / 2.618
    return (f'<svg viewBox="0 0 2.618 2.2361" width="{width:.1f}" height="{h:.1f}" aria-hidden="true">'
            f'<rect width="1.618" height="1" rx="0.5" fill="{top}"/><rect y="1.2361" width="2.618" height="1" rx="0.5" fill="{bottom}"/></svg>')


def shot(name, cls='', marks='', style=''):
    return f'<div class="shot {cls}" style="{style}"><img src="shots/{name}.jpg" alt="">{marks}</div>'


def close(name, max_w, max_h):
    """A close-up of the focus box shots.mjs recorded for this screenshot."""
    c = CROPS[name]
    aspect = c['w'] * c['ratio'] / c['h']
    w = min(max_w, max_h * aspect)
    img = (f'width:{100 / c["w"]:.3f}%;margin-left:{-100 * c["x"] / c["w"]:.3f}%;'
           f'margin-top:{-100 * c["y"] / (c["ratio"] * c["w"]):.3f}%')
    return f'<div class="shot" style="width:{w:.0f}px;height:{w / aspect:.0f}px"><img src="shots/{name}.jpg" alt="" style="{img}"></div>'


def case_study_pages(lang):
    """Every page of the case study; t() picks the Indonesian or English text."""
    t = lambda id_, en: en if lang == 'en' else id_
    pages = []

    def head(dark=False):
        n = len(pages) + 1
        return f'<header><span class="brand">{mark(24, AMBER, MIST if dark else NAVY)}<b>Berth Studio</b></span><span class="num">{n:02d}</span></header>'

    def plain(kicker, title, body, cls=''):
        pages.append(f'<section class="page {cls}">{head("dark" in cls)}<div class="kicker">{kicker}</div><h2>{title}</h2>{body}</section>')

    def feature(kicker, title, lead, points, art, tint='teal'):
        """Text on the left, the screen on a tinted panel that runs to the page edge."""
        pts = ''.join(f'<li><b>{a}</b><span>{b}</span></li>' for a, b in points)
        pages.append(f'''<section class="page feat {tint}">{head()}<div class="ftext"><div class="kicker">{kicker}</div><h2>{title}</h2>
<p class="lead">{lead}</p><ol class="pts">{pts}</ol></div><div class="fart">{art}</div></section>''')

    # cover
    pages.append(f'''<section class="page cover"><div class="cover-t">{mark(110, AMBER, MIST)}
<div class="cover-k">UI/UX case study</div><h1>{t('Satu dermaga<br>untuk database<br><em>dan API.</em>', 'One harbour<br>for databases<br><em>and APIs.</em>')}</h1>
<p>{t('Bagaimana Berth Studio menyatukan client database dan API client dalam satu jendela yang tenang, cepat, dan aman untuk produksi.', 'How Berth Studio brings a database client and an API client into one calm, fast window that is safe to use on production.')}</p></div>
{shot('welcome-dark', 'cover-shot')}
<footer><span>Berth Studio · {t('Oktober 2026', 'October 2026')}</span></footer></section>''')

    plain(t('Masalahnya', 'The problem'), t('Satu pekerjaan,<br>tiga aplikasi.', 'One job,<br>three apps.'), f'''<div class="three">
<div class="win3"><i></i><i></i><i></i><b>{t('Client database', 'Database client')}</b><span>{t('Berat dan padat. Tiap environment jadi koneksi terpisah.', 'Heavy and crowded. Every environment is a separate connection.')}</span></div>
<div class="win3"><i></i><i></i><i></i><b>API client</b><span>{t('Cloud-first, wajib akun, dan tidak tahu apa-apa soal database.', 'Cloud-first, needs an account, and knows nothing about your database.')}</span></div>
<div class="win3 note3"><i></i><i></i><i></i><b>{t('Catatan', 'Notes')}</b><span>{t('Connection string dev, staging, dan prod, plus password yang ikut tersalin.', 'Connection strings for dev, staging and prod, with passwords pasted in too.')}</span></div>
</div><p class="big-note">{t('Hasilnya: pindah jendela terus, salah environment, dan rasa takut setiap kali membuka prod.', 'The result: constant window switching, the wrong environment, and a little fear every time prod is open.')}</p>''', 'problem')

    plain(t('Penggunanya', 'The user'), t('Backend engineer dengan banyak environment.', 'Backend engineers with many environments.'), f'''<div class="user">
<blockquote>{t('“Di tempat saya ada dev read, dev write, staging read, dan staging write. Beda semua.”', '“At my company we have dev read, dev write, staging read and staging write. All different.”')}<cite>{t('Masukan saat review prototype, yang mengubah cara kami memodelkan koneksi', 'Feedback from a prototype review, which changed how we model connections')}</cite></blockquote>
<div class="needs">{''.join(f'<div><i>0{i + 1}</i>{s}</div>' for i, s in enumerate([
        t('Pindah environment tanpa salah membuka database', 'Switch environments without opening the wrong database'),
        t('Query baca ke replica tanpa perlu dipikirkan', 'Send reads to a replica without thinking about it'),
        t('Ditahan dulu sebelum mengubah data di prod', 'Be stopped before changing data in prod'),
        t('Memakai collection orang lain dengan aman', "Use someone else's collection safely")]))}</div></div>''')

    dots = [('DBeaver', 12, 74, 'db'), ('Beekeeper Studio', 40, 82, 'db'), ('TablePlus', 84, 76, 'db'),
            ('Postman', 20, 88, 'api'), ('Bruno', 50, 90, 'api'), ('Yaak', 76, 88, 'api')]
    pts = ''.join(f'<span class="dot {k}" style="left:{x}%;top:{y}%"><i></i>{n}</span>' for n, x, y, k in dots)
    plain(t('Lanskap', 'The landscape'), t('Yang ringan cuma satu fungsi. Yang lengkap terasa berat.', 'The light tools do one thing. The complete ones feel heavy.'), f'''<div class="posmap">
<div class="map">{pts}<span class="dot me" style="left:84%;top:16%">{mark(30)}Berth Studio</span>
<span class="ax x">{t('Berat', 'Heavy')} <b>→</b> {t('Ringan', 'Light')}</span><span class="ax y"><b>↑</b> Database + API</span><span class="ax y0">{t('Satu fungsi', 'One job')}</span></div>
<div class="legend"><p><i class="db"></i>{t('Client database', 'Database client')}</p><p><i class="api"></i>API client</p>
<p class="small">{t('Posisi bersifat ilustratif, berdasarkan teknologi (JVM, Electron, native, Tauri) dan cakupan fiturnya.', 'Positions are illustrative, based on each tool’s technology (JVM, Electron, native, Tauri) and scope.')}</p>
<p class="claim">{t('Celah yang kami isi: ringan seperti aplikasi native, lengkap untuk database dan API, dan paham environment.', 'The gap we fill: as light as a native app, complete for databases and APIs, and aware of environments.')}</p></div></div>''')

    princ = [(t('Ringan', 'Light'), t('Buka dalam sedetik, tetap mulus di 100 ribu baris.', 'Opens in a second, stays smooth at 100,000 rows.')),
             (t('Lokal', 'Local'), t('Tanpa akun dan tanpa cloud. Workspace berupa file.', 'No account and no cloud. A workspace is just files.')),
             (t('Aman', 'Safe'), t('Password hanya di Keychain sistem, tidak pernah di layar.', 'Passwords live in the system keychain, never on screen.')),
             ('Keyboard', t('⌘K untuk semuanya.', '⌘K for everything.')),
             (t('Satu model', 'One model'), t('Database, API, dan diagram berbagi environment.', 'Databases, APIs and diagrams share environments.'))]
    plain(t('Prinsip', 'Principles'), t('Lima aturan yang memutuskan setiap perdebatan.', 'Five rules that settle every debate.'),
          '<div class="princ">' + ''.join(f'<div><b>{a}</b><span>{b}</span></div>' for a, b in princ) + '</div>'
          + f'<p class="redrule"><span></span>{t("Merah hanya untuk produksi. Kalau ada merah di layar, Anda sedang menyentuh prod.", "Red means production, and only production. If you see red, you are touching prod.")}</p>')

    plain(t('Ide utamanya', 'The core idea'), t('Koneksi adalah sistem, <em>bukan</em> environment.', 'A connection is a system, <em>not</em> an environment.'), f'''<div class="idea">
<div class="sys">acme-db<small>{t('satu koneksi', 'one connection')}</small></div>
<div class="branches">
<div class="br"><span class="env dev">dev</span><span class="ep w">write</span><span class="ep r">read</span></div>
<div class="br"><span class="env stg">staging</span><span class="ep w">write</span><span class="ep r">read</span></div>
<div class="br"><span class="env prod">prod</span><span class="ep w">write · read-only</span><span class="ep r">read ×2</span></div>
</div>
<div class="idea-t"><p>{t('Satu koneksi punya satu profil untuk setiap environment. Profil Postgres punya satu endpoint <b>write</b> dan sejumlah endpoint <b>read</b>.', 'Each connection has one profile per environment. A Postgres profile has one <b>write</b> endpoint and any number of <b>read</b> endpoints.')}</p>
<p>{t('Switcher di titlebar mengganti profil semua koneksi sekaligus. Kalau profilnya tidak ada, aplikasi mengatakannya terus terang.', 'The switcher in the title bar changes the profile of every connection at once. When a profile is missing, the app says so plainly.')}</p></div></div>''')

    pins = [(1, 82.3, 2.4), (2, 31.4, 2.4), (3, 15.6, 11.8), (4, 76, 6.6), (5, 62, 98.2), (6, 62, 14)]
    marks = ''.join(f'<i class="pin" style="left:{x}%;top:{y}%">{n}</i>' for n, x, y in pins)
    legend = [('Environment', t('dev, staging, prod untuk semua koneksi', 'dev, staging, prod for every connection')),
              ('⌘K', t('cari tabel, query, request, aksi', 'find tables, queries, requests, actions')),
              ('Sidebar', t('koneksi, API Collections, diagram', 'connections, API Collections, diagrams')),
              (t('Tab', 'Tabs'), t('semua pekerjaan berdampingan', 'all your work side by side')),
              ('Status bar', t('selalu menyebut endpoint yang dipakai', 'always names the endpoint in use')),
              ('Welcome', t('aksi cepat dan modul workspace', 'quick actions and workspace modules'))]
    plain(t('Kerangka', 'The shell'), t('Satu jendela untuk semua modul.', 'One window for every module.'), f'''<div class="shell">{shot('welcome', '', marks)}
<ol class="legend6">{''.join(f'<li><i>{i + 1}</i><b>{a}</b><span>{b}</span></li>' for i, (a, b) in enumerate(legend))}</ol></div>''', 'shellp')

    feature('Environment', t('Profil yang tidak ada ditampilkan jujur.', 'A missing profile is shown honestly.'),
            t('Di dev, events-db tidak punya profil. Alih-alih menebak, layar menawarkan tiga jalan keluar.', 'In dev, events-db has no profile. Instead of guessing, the screen offers three ways forward.'),
            [('Set up dev', t('isi profil baru', 'fill in a new profile')), ('Copy from staging', t('host dan nama database ikut disesuaikan', 'hosts and database names are adjusted')),
             ('Switch to staging', t('pindah ke environment yang ada', 'move to an environment that exists'))],
            close('gate', 872, 600))
    feature('Environment', t('Semua profil dalam satu matriks.', 'Every profile in one matrix.'),
            t('Baris adalah koneksi, kolom adalah environment. Sel kosong bisa langsung diisi atau disalin.', 'Rows are connections, columns are environments. An empty cell can be filled in or copied right there.'),
            [(t('Sekali lihat', 'At a glance'), t('endpoint write dan read di setiap environment', 'write and read endpoints in every environment')),
             ('Copy from', t('kata dev, staging, dan prod ditukar otomatis', 'dev, staging and prod are swapped automatically')),
             (t('Aman', 'Safe'), t('password tidak pernah ikut tersalin', 'passwords are never copied'))],
            close('env-matrix', 872, 680))
    feature('Read & write', t('Query baca ke replica. Sisanya ke primary.', 'Reads go to a replica. Everything else goes to the primary.'),
            t('Chip target selalu menyebut ke mana query berjalan. Hasilnya menyebut endpoint yang benar-benar dipakai.', 'The target chip always says where a query will run. The result names the endpoint that was actually used.'),
            [('SELECT, SHOW, EXPLAIN', t('ke read replica', 'go to the read replica')),
             (t('Tulis, kunci baris, transaksi', 'Writes, row locks, transactions'), t('tetap di primary', 'stay on the primary')),
             (t('Kalau ragu', 'When in doubt'), t('ke primary, karena replica bisa basi', 'the primary, because a replica can lag'))],
            close('query-target', 872, 680))
    feature('Read & write', t('Satu form, satu tab per environment.', 'One form, one tab per environment.'),
            t('Primary wajib. Read replica bisa ditambah berapa saja, masing-masing dengan host, database, dan user sendiri.', 'A primary is required. Add as many read replicas as you need, each with its own host, database and user.'),
            [(t('Tab profil', 'Profile tabs'), t('dev, staging, prod dalam satu form', 'dev, staging and prod in one form')),
             (t('Validasi dulu', 'Checked first'), t('kesalahan ketahuan sebelum test koneksi', 'mistakes show up before the connection test')),
             ('Prod', t('selalu read-only, tidak bisa dimatikan', 'always read-only, and it cannot be turned off'))],
            close('conn-profile', 872, 720))
    pages.append(f'''<section class="page prodp">{head(True)}<div class="kicker">{t('Produksi', 'Production')}</div><h2>{t('Prod harus terasa berbeda.', 'Prod has to feel different.')}</h2>
<div class="prod2"><figure>{shot('prod-table')}<figcaption><b>{t('Merah dan read-only', 'Red and read-only')}</b>{t('Tab bar dan status bar berubah merah, dan koneksi terbuka read-only.', 'The tab bar and status bar turn red, and the connection opens read-only.')}</figcaption></figure>
<figure>{close('prod-confirm', 600, 380)}<figcaption><b>{t('Ketik namanya dulu', 'Type its name first')}</b>{t('Commit ke prod meminta nama koneksi diketik. SQL bisa direview, dan semuanya jalan dalam satu transaksi.', 'Committing to prod asks you to type the connection name. The SQL can be reviewed, and everything runs in one transaction.')}</figcaption></figure></div></section>''')
    feature('API Collections', t('Folder sedalam apa pun, rapi seperti editor kode.', 'Folders as deep as you like, tidy as a code editor.'),
            t('Request disusun di folder bertingkat dengan garis panduan, dan bisa dibuka atau ditutup seperti di VS Code.', 'Requests sit in nested folders with indent guides, and fold open and shut like in VS Code.'),
            [(t('Tombol +', 'The + button'), t('New request atau New folder langsung di tempatnya', 'New request or New folder right where you are')),
             ('Undo', t('folder yang terhapus bisa dikembalikan', 'a deleted folder can be brought back')),
             ('Keyboard', t('← → untuk buka-tutup, F2 untuk rename', '← → to fold, F2 to rename'))],
            close('coll-menu', 872, 680), 'amber')
    feature('Import', t('Collection orang lain dianggap tidak dipercaya.', "Someone else's collection is treated as untrusted."),
            t('Postman, Insomnia, OpenAPI, Swagger, HAR, Bruno, dan cURL dikenali otomatis, lalu diperiksa sebelum disimpan.', 'Postman, Insomnia, OpenAPI, Swagger, HAR, Bruno and cURL are detected automatically, then checked before anything is saved.'),
            [(t('Secret dipindah', 'Secrets moved'), t('token diganti variabel dan disimpan di Keychain', 'tokens become variables, stored in the keychain')),
             (t('Script mati', 'Scripts off'), t('tidak ada yang jalan sampai Anda menyalakannya', 'nothing runs until you turn it on')),
             (t('Preview dulu', 'Preview first'), t('lihat isi tree sebelum masuk workspace', 'see the tree before it joins your workspace'))],
            close('import', 872, 720), 'amber')

    gal = [('table', 'Table browser'), ('mongo', 'MongoDB'), ('erd', 'ERD'), ('api', 'API client'), ('supabase', 'Supabase'), ('firebase', 'Firebase')]
    plain(t('Modul', 'Modules'), t('Satu pola untuk setiap sumber data.', 'One pattern for every data source.'),
          '<div class="gal">' + ''.join(f'<figure>{shot(n)}<figcaption>{c}</figcaption></figure>' for n, c in gal) + '</div>')

    types = [('number', '#1F5FC4', '1,520'), ('string', '#1E7D52', '"pro"'), ('null', '#93A1A0', 'NULL'), ('json', '#7E45BE', '{ }'),
             ('date', '#B85A06', '2026-10-01'), ('boolean', '#B02F68', 'true'), ('primary key', '#9A7400', 'id')]
    plain(t('Bahasa visual', 'Visual language'), t('Warna punya arti, bukan dekorasi.', 'Colour carries meaning, not decoration.'), f'''<div class="dl">
<div><div class="sub">{t('Setiap tipe data punya warnanya sendiri', 'Every data type has its own colour')}</div><div class="tchips">{''.join(f'<div style="--c:{c}"><code>{v}</code><span>{n}</span></div>' for n, c, v in types)}</div>
<p class="dlp">{t('Warna yang sama dipakai di grid, JSON, dan editor SQL, jadi tipe data terbaca tanpa melihat header.', 'The same colours appear in the grid, in JSON and in the SQL editor, so you can read a type without checking the header.')}</p></div>
<div class="spec2"><div><span class="aa">Aa</span><b>Geist</b><span>{t('Untuk antarmuka', 'For the interface')}</span></div><div><span class="aa mono">0123</span><b>Geist Mono</b><span>{t('Untuk data dan kode', 'For data and code')}</span></div>
<div class="accent"><i></i><b>{t('Satu aksen teal', 'One teal accent')}</b><span>{t('Untuk fokus dan aksi utama. Merah hanya untuk prod.', 'For focus and primary actions. Red is only for prod.')}</span></div></div></div>''')

    pages.append(f'''<section class="page themes">{head(True)}<div class="kicker">{t('Tema', 'Themes')}</div><h2>{t('Terang dan gelap, sama-sama kelas satu.', 'Light and dark, both first class.')}</h2>
<div class="duo">{shot('query-target', 'lt')}{shot('query-dark', 'dk')}</div></section>''')

    keys = [('⌘K', t('Cari apa saja', 'Find anything')), ('⌘↵', t('Run query atau Send', 'Run a query or Send')), ('⌘.', t('Batalkan', 'Cancel')),
            ('⇧⌘I', 'Import collection'), ('F2', 'Rename'), ('Esc', t('Tutup', 'Close'))]
    plain('Keyboard', t('Bisa dipakai tanpa menyentuh mouse.', 'Usable without touching the mouse.'), f'''<div class="keys">{''.join(f'<div><kbd>{k}</kbd><span>{d}</span></div>' for k, d in keys)}</div>
<p class="note">{t('Tree dan menu memakai peran aksesibilitas yang benar, fokus selalu terlihat, dan animasi berhenti saat reduced motion aktif.', 'Trees and menus use the right accessibility roles, focus is always visible, and motion stops when reduced motion is on.')}</p>''')

    pages.append(f'''<section class="page closing"><div class="close-in">{mark(200, AMBER, MIST)}
<div><h2>{t('Satu jendela.<br>Tiga environment.<br><em>Nol password di file.</em>', 'One window.<br>Three environments.<br><em>Zero passwords in files.</em>')}</h2>
<div class="trio"><div><b>4</b><span>{t('sumber data: PostgreSQL, MongoDB, Supabase, Firebase', 'data sources: PostgreSQL, MongoDB, Supabase, Firebase')}</span></div>
<div><b>2</b><span>{t('endpoint per environment: read dan write, dirutekan otomatis', 'endpoints per environment: read and write, routed automatically')}</span></div>
<div><b>1</b><span>{t('aturan warna: merah berarti produksi', 'colour rule: red means production')}</span></div></div></div></div>
<footer><span>Berth Studio, open source database and API client</span><span>UI/UX case study</span></footer></section>''')
    return pages


CSS = '''
@page { size: 1600px 900px; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: #e9ecee; -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { font-family: 'Geist', -apple-system, 'Helvetica Neue', sans-serif; color: NAVY }
.page { width: 1600px; height: 900px; background: PAPER; padding: 120px 96px 64px; position: relative; overflow: hidden; break-after: page; margin: 0 auto 24px }
@media print { .page { margin: 0 } body { background: PAPER } }
header { position: absolute; top: 48px; left: 96px; right: 64px; display: flex; justify-content: space-between; align-items: center; font-size: 15px; z-index: 2 }
header .brand { display: flex; align-items: center; gap: 12px } header b { font-weight: 600 }
header .num { font-family: 'Geist Mono', monospace; color: SLATE }
.kicker { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: TEAL; font-weight: 600 }
h2 { font-size: 54px; letter-spacing: -.03em; font-weight: 600; margin: 12px 0 40px; line-height: 1.04; text-wrap: balance; max-width: 1100px }
h2 em { font-style: normal; color: TEAL }
p { margin: 0 0 14px; line-height: 1.5 }
.shot { position: relative; border-radius: 12px; overflow: hidden; box-shadow: 0 0 0 1px rgba(11,34,48,.16); background: #fff; line-height: 0 }
.shot img { width: 100%; display: block }
.note { position: absolute; left: 96px; right: 96px; bottom: 60px; font-size: 19px; color: SLATE; margin: 0 }
/* dark pages */
.cover, .closing, .prodp, .themes { background: NAVY; color: MIST }
.prodp header .num, .themes header .num { color: #9FB2BD }
.prodp .kicker { color: #FF8A7A } .themes .kicker { color: AMBER }
/* cover */
.cover { padding: 0 }
.cover-t { position: absolute; left: 96px; top: 96px; width: 600px }
.cover-k { margin-top: 40px; font-size: 16px; letter-spacing: .16em; text-transform: uppercase; color: AMBER; font-weight: 600 }
.cover h1 { font-size: 84px; line-height: 1.02; letter-spacing: -.035em; font-weight: 600; margin: 16px 0 28px }
.cover h1 em { font-style: normal; color: AMBER }
.cover p { font-size: 21px; color: #C9D5DB; max-width: 520px }
.cover-shot { position: absolute; left: 760px; top: 150px; width: 1100px; border-radius: 16px; box-shadow: 0 0 0 1px rgba(255,255,255,.14) }
.cover footer, .closing footer { position: absolute; left: 96px; right: 96px; bottom: 48px; display: flex; justify-content: space-between; font-size: 16px; color: #9FB2BD }
/* problem */
.three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 8px }
.win3 { background: #fff; border-radius: 16px; box-shadow: inset 0 0 0 1px LINE; padding: 22px 28px 34px; min-height: 280px; display: flex; flex-direction: column; gap: 10px; position: relative }
.win3 i { position: absolute; top: 22px; width: 11px; height: 11px; border-radius: 50%; background: #D7DCDF } .win3 i:nth-child(2) { left: 46px } .win3 i:nth-child(1) { left: 28px } .win3 i:nth-child(3) { left: 64px }
.win3 b { margin-top: 44px; font-size: 26px; letter-spacing: -.01em } .win3 span { font-size: 18px; color: SLATE; line-height: 1.5 }
.win3.note3 { background: #FFF6E6; box-shadow: inset 0 0 0 1px #F3D9A8 }
.big-note { position: absolute; left: 96px; bottom: 72px; margin: 0; font-size: 30px; line-height: 1.35; letter-spacing: -.015em; max-width: 1100px }
.problem .big-note::first-word { color: TEAL }
/* user */
.user { display: grid; grid-template-columns: 1.15fr 1fr; gap: 72px; align-items: start }
blockquote { margin: 0; font-size: 40px; line-height: 1.25; letter-spacing: -.02em; font-weight: 500; position: relative; padding-left: 36px; border-left: 6px solid AMBER }
cite { display: block; margin-top: 24px; font-size: 16px; font-style: normal; color: SLATE; letter-spacing: 0; font-weight: 400 }
.needs { display: flex; flex-direction: column } .needs div { border-top: 1px solid LINE; padding: 18px 0; font-size: 21px; display: grid; grid-template-columns: 50px 1fr }
.needs i { font-style: normal; font-family: 'Geist Mono', monospace; color: TEAL; font-size: 16px; padding-top: 4px }
/* positioning */
.posmap { display: grid; grid-template-columns: 900px 1fr; gap: 64px; margin-top: -8px }
.map { position: relative; height: 560px; border-left: 2px solid NAVY; border-bottom: 2px solid NAVY; background: linear-gradient(#E8F4F3, #E8F4F3) no-repeat right top / 50% 45% }
.dot { position: absolute; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 8px; font-size: 17px; white-space: nowrap }
.dot i { width: 14px; height: 14px; border-radius: 50% } .dot.db i, .legend .db { background: NAVY } .dot.api i, .legend .api { background: AMBER }
.dot.me { font-size: 24px; font-weight: 600; gap: 12px }
.ax { position: absolute; font-size: 15px; color: SLATE; letter-spacing: .04em } .ax b { color: NAVY }
.ax.x { right: 0; bottom: -34px } .ax.y { left: 16px; top: 12px } .ax.y0 { left: 16px; bottom: 12px }
.legend p { display: flex; align-items: center; gap: 12px; font-size: 18px } .legend i { width: 14px; height: 14px; border-radius: 50% }
.legend .small { font-size: 15px; color: SLATE; margin-top: 20px; display: block }
.legend .claim { margin-top: 40px; font-size: 24px; line-height: 1.4; letter-spacing: -.01em; display: block; border-top: 2px solid TEAL; padding-top: 20px }
/* principles */
.princ { display: grid; grid-template-columns: repeat(5, 1fr); border-top: 2px solid NAVY }
.princ div { padding: 28px 28px 0 0; display: flex; flex-direction: column; gap: 14px; min-height: 260px }
.princ div + div { padding-left: 28px; border-left: 1px solid LINE }
.princ b { font-size: 40px; letter-spacing: -.03em; font-weight: 600 } .princ span { font-size: 18px; color: SLATE; line-height: 1.5 }
.redrule { position: absolute; left: 96px; bottom: 64px; display: flex; align-items: center; gap: 18px; font-size: 22px; margin: 0 }
.redrule span { width: 64px; height: 24px; border-radius: 12px; background: RED }
/* idea */
.idea { display: grid; grid-template-columns: 240px 560px 1fr; gap: 0; align-items: center; margin-top: 10px }
.sys { background: NAVY; color: MIST; border-radius: 22px; padding: 28px 30px; font-family: 'Geist Mono', monospace; font-size: 26px; font-weight: 500 }
.sys small { display: block; font-family: 'Geist', sans-serif; font-size: 15px; color: #9FB2BD; margin-top: 6px; font-weight: 400 }
.branches { display: flex; flex-direction: column; gap: 22px; padding-left: 60px; position: relative }
.branches::before { content: ''; position: absolute; left: 0; top: 50%; width: 30px; border-top: 2px solid NAVY }
.branches::after { content: ''; position: absolute; left: 30px; top: 31px; bottom: 31px; border-left: 2px solid NAVY }
.br { display: flex; gap: 10px; align-items: center; position: relative }
.br::before { content: ''; position: absolute; left: -30px; top: 50%; width: 30px; border-top: 2px solid NAVY }
.env { width: 130px; height: 62px; border-radius: 31px; display: grid; place-items: center; font-size: 20px; font-weight: 600; color: #fff }
.env.dev { background: #1E7D52 } .env.stg { background: #B85A06 } .env.prod { background: RED }
.ep { height: 46px; padding: 0 20px; border-radius: 23px; display: grid; place-items: center; font-family: 'Geist Mono', monospace; font-size: 16px; background: #fff; box-shadow: inset 0 0 0 1.5px LINE }
.ep.w { box-shadow: inset 0 0 0 1.5px NAVY } .ep.r { color: TEAL; box-shadow: inset 0 0 0 1.5px #9FD3CE }
.idea-t { padding-left: 64px } .idea-t p { font-size: 20px; color: #22343E } .idea-t b { color: TEAL }
/* shell */
.shellp h2 { margin-bottom: 28px }
.shell { display: grid; grid-template-columns: 1000px 1fr; gap: 48px; align-items: start }
.pin { position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 50%; background: AMBER; color: NAVY; font: 600 15px/30px 'Geist Mono', monospace; text-align: center; font-style: normal; box-shadow: 0 0 0 3px #fff }
.legend6 { list-style: none; margin: 0; padding: 0 } .legend6 li { display: grid; grid-template-columns: 42px 1fr; padding: 13px 0; border-top: 1px solid LINE }
.legend6 i { grid-row: span 2; width: 26px; height: 26px; border-radius: 50%; background: AMBER; font: 600 13px/26px 'Geist Mono', monospace; text-align: center; font-style: normal }
.legend6 b { font-size: 18px } .legend6 span { font-size: 15.5px; color: SLATE; margin-top: 3px }
/* feature pages */
.feat { padding: 0 } .feat header { right: auto; width: 440px }
.ftext { position: absolute; left: 96px; top: 150px; width: 440px }
.ftext h2 { font-size: 46px; margin-bottom: 26px }
.lead { font-size: 20px; color: #22343E }
.pts { list-style: none; margin: 34px 0 0; padding: 0; counter-reset: p }
.pts li { counter-increment: p; display: grid; grid-template-columns: 40px 1fr; padding: 14px 0; border-top: 1px solid LINE }
.pts li::before { content: counter(p, decimal-leading-zero); font-family: 'Geist Mono', monospace; color: TEAL; font-size: 15px; grid-row: span 2; padding-top: 3px }
.pts b { font-size: 18px } .pts span { font-size: 16px; color: SLATE; margin-top: 3px }
.fart { position: absolute; left: 600px; top: 0; right: 0; bottom: 0; display: grid; place-items: center; background: #E6F1F0 }
.feat.amber .fart { background: #FBEFD9 } .feat.amber .pts li::before, .feat.amber .kicker { color: #B26B00 }
/* prod */
.prodp { background: #2A0F0D } .prodp h2 { color: #fff }
.prod2 { display: grid; grid-template-columns: 760px 1fr; gap: 48px; align-items: start }
.prodp .shot { box-shadow: 0 0 0 1px rgba(255,255,255,.2) }
.prodp figure { margin: 0 } .prodp figcaption { margin-top: 18px; font-size: 16px; color: #E7C7C2; line-height: 1.5 }
.prodp figcaption b { display: block; font-size: 20px; color: #fff; margin-bottom: 4px }
/* gallery */
.gal { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px 32px; margin-top: -10px }
.gal figure { margin: 0 } .gal .shot { aspect-ratio: 2.05; border-radius: 10px } .gal .shot img { height: 100%; object-fit: cover; object-position: top left }
.gal figcaption { margin-top: 12px; font-size: 18px; font-weight: 600 }
/* design language */
.dl { display: grid; grid-template-columns: 1fr 520px; gap: 80px }
.sub { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: SLATE; font-weight: 600; margin-bottom: 18px }
.tchips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px }
.tchips div { background: color-mix(in srgb, var(--c) 9%, #fff); border-radius: 14px; padding: 18px 18px 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 22%, #fff) }
.tchips code { font-family: 'Geist Mono', monospace; color: var(--c); font-size: 24px } .tchips span { font-size: 14px; color: SLATE }
.dlp { margin-top: 28px; font-size: 19px; color: #22343E; max-width: 620px }
.spec2 { display: flex; flex-direction: column; gap: 26px }
.spec2 > div { display: grid; grid-template-columns: 200px 1fr; grid-template-rows: auto auto; align-items: end; border-top: 1px solid LINE; padding-top: 18px }
.spec2 .aa { grid-row: span 2; font-size: 88px; font-weight: 600; letter-spacing: -.04em; line-height: .9 } .spec2 .aa.mono { font-family: 'Geist Mono', monospace; font-weight: 400; color: TEAL; font-size: 64px }
.spec2 b { font-size: 22px } .spec2 span { color: SLATE; font-size: 16px }
.spec2 .accent i { grid-row: span 2; width: 150px; height: 56px; border-radius: 28px; background: TEAL; align-self: center }
/* themes */
.themes { background: #0E1B22 } .themes h2 { color: #fff }
.duo .shot { position: absolute; width: 800px; box-shadow: 0 0 0 1px rgba(255,255,255,.18) } .duo .lt { left: 96px; top: 250px } .duo .dk { left: 704px; top: 340px; box-shadow: 0 0 0 1px rgba(255,255,255,.18), 0 0 0 10px #0E1B22 }
/* keyboard */
.keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px }
.keys div { background: #fff; border-radius: 20px; box-shadow: inset 0 0 0 1px LINE; padding: 36px; min-height: 200px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start }
kbd { font-family: 'Geist', sans-serif; font-size: 40px; font-weight: 500; min-width: 110px; height: 76px; padding: 0 18px; display: grid; place-items: center; border-radius: 14px; background: MIST; box-shadow: inset 0 0 0 1.5px LINE, 0 4px 0 LINE }
.keys span { font-size: 22px }
/* closing */
.closing .close-in { position: absolute; left: 136px; right: 96px; top: 0; bottom: 0; display: grid; grid-template-columns: 260px 1fr; gap: 110px; align-items: center }
.closing h2 { color: MIST; font-size: 64px; margin: 0 0 48px } .closing h2 em { color: AMBER }
.trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px } .trio div { border-top: 1px solid #2A4452; padding-top: 18px }
.trio b { display: block; font-size: 56px; color: AMBER; font-weight: 600; letter-spacing: -.03em; line-height: 1; margin-bottom: 12px } .trio span { color: #C9D5DB; font-size: 18px; line-height: 1.5 }
'''
for k, v in dict(NAVY=NAVY, AMBER=AMBER, TEAL=TEAL, MIST=MIST, SLATE=SLATE, PAPER=PAPER, LINE=LINE, RED=RED).items():
    CSS = re.sub(rf'\b{k}\b', v, CSS)


def fonts():
    """Reuse the Geist faces the brand build already embedded; fall back to Google Fonts."""
    brand = BRAND / 'case-study.html'
    m = brand.exists() and re.search(r'<style>(/\*[^<]*?@font-face.*?)</style>', brand.read_text(), re.S)
    if m:
        return f'<style>{m.group(1)}</style>'
    print('fonts not embedded: run design/brand/build.py first; the PDF may fall back to system fonts')
    return '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=block" rel="stylesheet">'


font_css = fonts()
for lang, name in (('id', 'case-study.html'), ('en', 'case-study.en.html')):
    pages = case_study_pages(lang)
    body = ''.join(pages)
    missing = sorted({n for n in re.findall(r'shots/([\w-]+)\.jpg', body) if not (OUT / 'shots' / f'{n}.jpg').exists()})
    if missing:
        raise SystemExit(f'missing screenshots: {", ".join(missing)}. Run: node design/ux/shots.mjs')
    (OUT / name).write_text(f'''<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>Berth Studio · UI/UX case study</title>
{font_css}
<style>{CSS}</style></head><body>{body}</body></html>''')
    print(f'{name}: {len(pages)} pages')
