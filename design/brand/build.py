"""Berth Studio brand builder.

Every logo file and the case study come from the geometry below, so the
golden-ratio construction in the PDF is the logo, not an illustration of it.

    python3 design/brand/build.py        # writes SVGs and case-study.html
    (then render the PNG and PDF with Chrome, see README.md in this folder)
"""
from pathlib import Path
import base64
import math
import re
import urllib.request

OUT = Path(__file__).resolve().parent

# ---------------------------------------------------------------- geometry
PHI = (1 + 5 ** 0.5) / 2
H = 1.0                      # height of one berth (pill); the base unit
TOP = PHI                    # top berth length            = φ
BOTTOM = PHI ** 2            # bottom berth length         = φ² = φ + 1
GAP = PHI ** -3              # space between berths        = 1/φ³
W = BOTTOM                   # mark width                  = φ²
TOTAL = 2 * H + GAP          # mark height                 = 2 + 1/φ³ = √5
assert abs(TOTAL - 5 ** 0.5) < 1e-12 and abs(BOTTOM - (TOP + 1)) < 1e-12

# ---------------------------------------------------------------- palette
NAVY, AMBER, TEAL, MIST, SLATE, PAPER, LINE = '#0B2230', '#F2A93B', '#0E8A82', '#F4F7F8', '#4A5B66', '#FBFAF7', '#DCE3E6'


def f(v):
    return f'{v:.4f}'.rstrip('0').rstrip('.')


def pills(top=AMBER, bottom=NAVY):
    return (f'<rect x="0" y="0" width="{f(TOP)}" height="{f(H)}" rx="{f(H / 2)}" fill="{top}"/>'
            f'<rect x="0" y="{f(H + GAP)}" width="{f(BOTTOM)}" height="{f(H)}" rx="{f(H / 2)}" fill="{bottom}"/>')


def mark(width, top=AMBER, bottom=NAVY, label='Berth Studio'):
    height = width * TOTAL / W
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(TOTAL)}" width="{f(width)}" height="{f(height)}" '
            f'role="img" aria-label="{label}">{pills(top, bottom)}</svg>')


def app_icon(size=1024, bg=NAVY):
    # macOS-style rounded square; the mark sits on the optical centre with h of clear space on each side
    r = size * 0.2237
    mw = size * 0.56
    s = mw / W
    ox, oy = (size - mw) / 2, (size - TOTAL * s) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" aria-label="Berth Studio">'
            f'<rect width="{size}" height="{size}" rx="{f(r)}" fill="{bg}"/>'
            f'<g transform="translate({f(ox)} {f(oy)}) scale({f(s)})">{pills(AMBER, MIST)}</g></svg>')


def spiral(x, y, w, h, steps=7):
    """Quarter arcs of the golden spiral inside a landscape golden rectangle."""
    d, squares = f'M{f(x)},{f(y + h)}', []
    for k in range(steps):
        side = ['left', 'top', 'right', 'bottom'][k % 4]
        if side == 'left':
            s = h; squares.append((x, y, s)); d += f' A{f(s)},{f(s)} 0 0 1 {f(x + s)},{f(y)}'; x, w = x + s, w - s
        elif side == 'top':
            s = w; squares.append((x, y, s)); d += f' A{f(s)},{f(s)} 0 0 1 {f(x + s)},{f(y + s)}'; y, h = y + s, h - s
        elif side == 'right':
            s = h; squares.append((x + w - s, y, s)); d += f' A{f(s)},{f(s)} 0 0 1 {f(x + w - s)},{f(y + s)}'; w = w - s
        else:
            s = w; squares.append((x, y + h - s, s)); d += f' A{f(s)},{f(s)} 0 0 1 {f(x)},{f(y + h - s)}'; h = h - s
    return d, squares


def construction(width=760):
    """The construction drawing: unit circles, golden rectangle and spiral, the +1 square, dimensions."""
    pad_l, pad_t, pad_r, pad_b = 0.62, 0.42, 1.3, 0.5
    vb_w, vb_h = W + pad_l + pad_r, TOTAL + pad_t + pad_b
    sw = 'vector-effect="non-scaling-stroke"'
    g = []
    g.append(f'<g opacity="0.16">{pills()}</g>')
    # golden rectangle φ×1 on the top berth, its squares and spiral
    d, squares = spiral(0, 0, TOP, H)
    for (sx, sy, s) in squares:
        g.append(f'<rect x="{f(sx)}" y="{f(sy)}" width="{f(s)}" height="{f(s)}" fill="none" stroke="{TEAL}" stroke-width="1" {sw}/>')
    g.append(f'<path d="{d}" fill="none" stroke="{TEAL}" stroke-width="2" {sw}/>')
    # bottom berth = the same golden rectangle plus one unit square
    y2 = H + GAP
    g.append(f'<rect x="0" y="{f(y2)}" width="{f(TOP)}" height="{f(H)}" fill="none" stroke="{TEAL}" stroke-width="1" stroke-dasharray="5 4" {sw}/>')
    g.append(f'<rect x="{f(TOP)}" y="{f(y2)}" width="1" height="{f(H)}" fill="{AMBER}" fill-opacity="0.18" stroke="{AMBER}" stroke-width="1.5" {sw}/>')
    g.append(f'<text x="{f(TOP + 0.5)}" y="{f(y2 + 0.56)}" font-size="0.13" text-anchor="middle" fill="#9A5B00" font-family="Geist Mono, monospace">+1</text>')
    # cap circles, diameter 1
    for cx, cy in [(0.5, 0.5), (TOP - 0.5, 0.5), (0.5, y2 + 0.5), (BOTTOM - 0.5, y2 + 0.5)]:
        g.append(f'<circle cx="{f(cx)}" cy="{f(cy)}" r="0.5" fill="none" stroke="{NAVY}" stroke-width="1" stroke-dasharray="2 3" {sw}/>')
    # outlines of the real shapes
    g.append(f'<rect x="0" y="0" width="{f(TOP)}" height="{f(H)}" rx="0.5" fill="none" stroke="{AMBER}" stroke-width="2.5" {sw}/>')
    g.append(f'<rect x="0" y="{f(y2)}" width="{f(BOTTOM)}" height="{f(H)}" rx="0.5" fill="none" stroke="{NAVY}" stroke-width="2.5" {sw}/>')

    def dim(x1, y1, x2, y2_, label, anchor='middle', dx=0.0, dy=0.0):
        tick = 0.05
        out = f'<line x1="{f(x1)}" y1="{f(y1)}" x2="{f(x2)}" y2="{f(y2_)}" stroke="{SLATE}" stroke-width="1" {sw}/>'
        if y1 == y2_:
            out += ''.join(f'<line x1="{f(x)}" y1="{f(y1 - tick)}" x2="{f(x)}" y2="{f(y1 + tick)}" stroke="{SLATE}" stroke-width="1" {sw}/>' for x in (x1, x2))
        else:
            out += ''.join(f'<line x1="{f(x1 - tick)}" y1="{f(y)}" x2="{f(x1 + tick)}" y2="{f(y)}" stroke="{SLATE}" stroke-width="1" {sw}/>' for y in (y1, y2_))
        tx, ty = (x1 + x2) / 2 + dx, (y1 + y2_) / 2 + dy
        out += f'<text x="{f(tx)}" y="{f(ty)}" font-size="0.12" text-anchor="{anchor}" fill="{NAVY}" font-family="Geist Mono, monospace">{label}</text>'
        return out
    g.append(dim(0, -0.2, TOP, -0.2, 'φ ≈ 1.618', dy=-0.06))
    g.append(dim(0, TOTAL + 0.22, BOTTOM, TOTAL + 0.22, 'φ² = φ + 1 ≈ 2.618', dy=0.17))
    g.append(dim(-0.22, 0, -0.22, H, '1', anchor='end', dx=-0.08, dy=0.04))
    g.append(dim(-0.22, y2, -0.22, y2 + H, '1', anchor='end', dx=-0.08, dy=0.04))
    g.append(dim(BOTTOM + 0.22, 0, BOTTOM + 0.22, TOTAL, '√5 ≈ 2.236', anchor='start', dx=0.1, dy=0.04))
    g.append(f'<line x1="{f(TOP + 0.15)}" y1="{f(H)}" x2="{f(TOP + 0.15)}" y2="{f(y2)}" stroke="{SLATE}" stroke-width="1" {sw}/>')
    g.append(f'<text x="{f(TOP + 0.24)}" y="{f(H + GAP / 2 + 0.04)}" font-size="0.12" fill="{NAVY}" font-family="Geist Mono, monospace">1/φ³ ≈ 0.236</text>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(-pad_l)} {f(-pad_t)} {f(vb_w)} {f(vb_h)}" width="{width}" height="{f(width * vb_h / vb_w)}">'
            + ''.join(g) + '</svg>')


def v1_mark(width):
    """The first, rejected concept: a golden-circle B with a docked dot. Shown in the exploration page."""
    t, s, rho = PHI ** -2, 2 * PHI ** -2, PHI ** -2
    hh = 2 + 2 * PHI
    c1, r1, c2, r2 = (1.0, 1.0), 1.0, (PHI, 2 + PHI), PHI
    d1, d2 = r1 + rho, r2 + rho
    dx, dy = c2[0] - c1[0], c2[1] - c1[1]; d = math.hypot(dx, dy)
    a = (d1 * d1 - d2 * d2 + d * d) / (2 * d); hgt = math.sqrt(d1 * d1 - a * a)
    cx, cy = c1[0] + a * dx / d + hgt * dy / d, c1[1] + a * dy / d - hgt * dx / d
    body = (f'<path fill="{NAVY}" fill-rule="evenodd" d="M0,0 H1 A1,1 0 0 1 1,2 H0 Z M{f(s)},{f(t)} H1 A{f(1 - t)},{f(1 - t)} 0 0 1 1,{f(2 - t)} H{f(s)} Z"/>'
            f'<path fill="{NAVY}" fill-rule="evenodd" d="M0,2 H{f(PHI)} A{f(PHI)},{f(PHI)} 0 0 1 {f(PHI)},{f(hh)} H0 Z M{f(s)},{f(2 + t)} H{f(PHI)} A{f(PHI - t)},{f(PHI - t)} 0 0 1 {f(PHI)},{f(hh - t)} H{f(s)} Z"/>'
            f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(rho)}" fill="{AMBER}"/>')
    return f'<svg viewBox="-0.3 -0.3 {f(2 * PHI + 0.6)} {f(hh + 0.6)}" width="{width}" height="{f(width * (hh + 0.6) / (2 * PHI + 0.6))}">{body}</svg>'


def concept_a(width):
    return (f'<svg viewBox="0 0 120 120" width="{width}" height="{width}"><path d="M36 26V80a12 12 0 0 0 12 12h24a12 12 0 0 0 12-12V26" fill="none" stroke="{NAVY}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<rect x="51" y="30" width="18" height="44" rx="9" fill="{AMBER}"/></svg>')


def concept_b(width):
    return (f'<svg viewBox="0 0 120 120" width="{width}" height="{width}"><path d="M38 20V98" stroke="{NAVY}" stroke-width="16" stroke-linecap="round"/>'
            f'<circle cx="64" cy="72" r="22" fill="none" stroke="{NAVY}" stroke-width="16"/><circle cx="64" cy="72" r="7" fill="{AMBER}"/></svg>')


def clear_space(width=520):
    pad = H
    vb = f'{f(-pad - 0.25)} {f(-pad - 0.25)} {f(W + 2 * pad + 0.5)} {f(TOTAL + 2 * pad + 0.5)}'
    sw = 'vector-effect="non-scaling-stroke"'
    hgt = width * (TOTAL + 2 * pad + 0.5) / (W + 2 * pad + 0.5)
    guides = (f'<rect x="{f(-pad)}" y="{f(-pad)}" width="{f(W + 2 * pad)}" height="{f(TOTAL + 2 * pad)}" fill="{AMBER}" fill-opacity="0.08" stroke="{AMBER}" stroke-width="1.5" stroke-dasharray="6 5" {sw}/>'
              f'<rect x="0" y="0" width="{f(W)}" height="{f(TOTAL)}" fill="{MIST}" stroke="{LINE}" stroke-width="1" {sw}/>')
    labels = ''.join(f'<text x="{f(x)}" y="{f(y)}" font-size="0.16" text-anchor="middle" fill="#9A5B00" font-family="Geist Mono, monospace">h</text>'
                     for x, y in [(W / 2, -pad / 2 + 0.06), (W / 2, TOTAL + pad / 2 + 0.06), (-pad / 2, TOTAL / 2 + 0.06), (W + pad / 2, TOTAL / 2 + 0.06)])
    return f'<svg viewBox="{vb}" width="{width}" height="{f(hgt)}">{guides}{pills()}{labels}</svg>'


# ---------------------------------------------------------------- asset files
def write(name, text):
    (OUT / name).write_text(text, encoding='utf-8')


write('berth-studio-mark.svg', mark(W * 100) + '\n')
write('berth-studio-mark-on-dark.svg', mark(W * 100, AMBER, MIST) + '\n')
write('berth-studio-mark-mono.svg', mark(W * 100, 'currentColor', 'currentColor').replace('<rect x="0" y="0"', '<rect opacity="0.55" x="0" y="0"') + '\n')
write('berth-studio-app-icon.svg', app_icon() + '\n')

# ---------------------------------------------------------------- case study
def lockup(mark_w, top=AMBER, bottom=NAVY, text=NAVY, sub=SLATE, size=None, gap=None):
    mh = mark_w * TOTAL / W
    size = size or mh * 0.78
    gap = gap or mark_w * 0.36
    return (f'<span class="lockup" style="gap:{f(gap)}px">{mark(mark_w, top, bottom)}'
            f'<span class="word" style="font-size:{f(size)}px;color:{text}">Berth <span style="color:{sub};font-weight:400">Studio</span></span></span>')


def page(n, kicker, title, body, cls=''):
    return (f'<section class="page {cls}"><header><span class="brand">{mark(26)}<b>Berth Studio</b><span>Logo case study</span></span>'
            f'<span class="num">{n:02d}</span></header><div class="kicker">{kicker}</div><h2>{title}</h2>{body}</section>')


def case_study_pages(lang):
    """Every page of the case study; t() picks the Indonesian or English text."""
    t = lambda id_, en: en if lang == 'en' else id_
    pages = []
    pages.append(f'''<section class="page cover"><div class="cover-in">{mark(300)}
<h1>Berth <span>Studio</span></h1><p>Logo case study</p></div>
<footer><span>Berth Studio, open source database and API client</span><span>{t('Oktober 2026', 'October 2026')}</span></footer></section>''')

    pages.append(page(2, 'Brief', t('Satu aplikasi untuk database dan API', 'One app for databases and APIs'),
     f'''<div class="cols"><div class="lead"><p>{t('Berth Studio adalah aplikasi desktop open source untuk backend engineer. Isinya client database untuk PostgreSQL, MongoDB, Supabase, dan Firebase, digabung dengan API client dan kanvas ERD dalam satu jendela.', 'Berth Studio is an open source desktop app for backend engineers. It combines a database client for PostgreSQL, MongoDB, Supabase and Firebase with an API client and an ERD canvas, all in one window.')}</p>
<p>{t('Penggunanya membuka aplikasi ini berkali-kali setiap hari, sering di layar yang penuh tab dan terminal. Logonya harus langsung dikenali di Dock macOS, di tab browser, dan di README GitHub.', 'People open it many times a day, often on a screen full of tabs and terminals. The logo has to be recognisable at a glance in the macOS Dock, in a browser tab and in a GitHub README.')}</p></div>
<div><h3>{t('Tujuan logo', 'Goals for the logo')}</h3><ol class="goals">{t('<li><b>Sederhana.</b> Cukup dua bentuk dan dua warna.</li><li><b>Tetap jelas di 16 px.</b> Ukuran favicon dan ikon kecil di sidebar.</li><li><b>Punya cerita.</b> Terhubung dengan nama Berth dan fungsi aplikasinya.</li><li><b>Terukur.</b> Setiap proporsi diturunkan dari golden ratio, jadi mudah digambar ulang dengan tepat.</li>', '<li><b>Simple.</b> Two shapes and two colours, nothing more.</li><li><b>Clear at 16 px.</b> The size of a favicon or a small sidebar icon.</li><li><b>A story.</b> Tied to the name Berth and to what the app does.</li><li><b>Measured.</b> Every proportion comes from the golden ratio, so it is easy to redraw exactly.</li>')}</ol></div></div>'''))

    pages.append(page(3, t('Nama', 'Name'), t('Berth: tempat kapal bersandar', 'Berth: where a ship ties up'),
     f'''<div class="cols"><div class="lead"><p>{t('<i>Berth</i> adalah slot di pelabuhan tempat sebuah kapal ditambatkan. Setiap kapal punya tempatnya sendiri, rapi, dan aman.', 'A <i>berth</i> is the slot in a harbour where a ship is moored. Every ship has its own place, orderly and safe.')}</p>
<p>{t('Begitu juga koneksi di Berth Studio. Setiap database dan API punya tempatnya sendiri, dengan profil terpisah untuk dev, staging, dan prod, dan secret yang tersimpan aman di keychain.', 'Connections in Berth Studio work the same way. Every database and API has its own place, with separate profiles for dev, staging and prod, and secrets kept safe in the keychain.')}</p></div>
<div class="map"><div><span class="sw" style="background:{AMBER}"></span><b>{t('Kapsul atas, amber', 'Top pill, amber')}</b><p>{t('API. Lebih ringan dan lebih pendek, seperti request yang datang dan pergi.', 'The API. Lighter and shorter, like requests that come and go.')}</p></div>
<div><span class="sw" style="background:{NAVY}"></span><b>{t('Kapsul bawah, navy', 'Bottom pill, navy')}</b><p>{t('Database. Lebih panjang dan lebih berat, jadi fondasi yang menopang semuanya.', 'The database. Longer and heavier, the foundation everything rests on.')}</p></div>
<div><span class="sw" style="background:{LINE}"></span><b>{t('Celah di antaranya', 'The gap between them')}</b><p>{t('Dermaga. Ruang kecil yang memisahkan sekaligus menyatukan keduanya, dan sekaligus membentuk siluet huruf B.', 'The pier. A small space that separates and joins the two, and turns the pair into the silhouette of a B.')}</p></div></div></div>'''))

    pages.append(page(4, t('Eksplorasi', 'Exploration'), t('Dari rumit ke sederhana', 'From complicated to simple'),
     f'''<div class="explore">
<figure class="rejected"><div class="tile">{v1_mark(120)}</div><figcaption><b>{t('Putaran 1 · Huruf B dan titik', 'Round 1 · Letter B and a dot')}</b><span>{t('Ditolak. Dua lengkung berbeda ukuran membuat bentuknya timpang, dan titiknya terasa seperti tersangkut.', 'Rejected. Two bowls of different sizes made it lopsided, and the dot looked stuck.')}</span></figcaption></figure>
<figure class="rejected"><div class="tile">{concept_a(140)}</div><figcaption><b>A · Slip</b><span>{t('Tempat sandar dilihat dari atas. Jelas, tapi mudah terbaca sebagai magnet atau cangkir.', 'A berth seen from above. Clear, but easily read as a magnet or a cup.')}</span></figcaption></figure>
<figure class="rejected"><div class="tile">{concept_b(140)}</div><figcaption><b>B · Porthole b</b><span>{t('Rapi sebagai huruf, tapi huruf dan lingkaran adalah bentuk yang sangat umum, jadi kurang khas.', 'Tidy as a letter, but letters in circles are everywhere, so it lacks character.')}</span></figcaption></figure>
<figure class="chosen"><div class="tile">{mark(150)}</div><figcaption><b>C · Two berths</b><span>{t('Dipilih. Dua bentuk saja, langsung terbaca sebagai B, sebagai dua dermaga, dan sebagai lapisan data.', 'Chosen. Just two shapes, read at once as a B, as two berths and as layers of data.')}</span></figcaption></figure>
</div><p class="note">{t('Masukan pada putaran pertama sederhana: "tidak simple dan cenderung aneh". Putaran kedua membuang semua lengkung dan detail, lalu membangun ulang dari dua kapsul.', 'The feedback on round one was short: "not simple, and a bit odd". Round two dropped every curve and detail and started again from two pills.')}</p>'''))

    pages.append(page(5, t('Konstruksi', 'Construction'), t('Golden ratio, dari unit sampai siluet', 'The golden ratio, from unit to silhouette'),
     f'''<div class="construct"><div class="drawing">{construction(760)}</div>
<div class="steps"><div><b>1 · Unit</b><p>{t('Tinggi satu kapsul adalah satu unit. Ujungnya setengah lingkaran berdiameter 1.', 'The height of one pill is one unit. Its ends are half circles with a diameter of 1.')}</p></div>
<div><b>{t('2 · Kapsul atas = φ', '2 · Top pill = φ')}</b><p>{t('Panjangnya φ, jadi bingkainya persegi panjang emas. Spiral emas pas di dalamnya.', 'Its length is φ, so its frame is a golden rectangle. The golden spiral fits inside.')}</p></div>
<div><b>{t('3 · Kapsul bawah = φ + 1', '3 · Bottom pill = φ + 1')}</b><p>{t('Bentuk atas ditambah satu persegi unit. Karena φ + 1 = φ², kedua kapsul berbanding tepat 1 : φ.', 'The top shape plus one unit square. Because φ + 1 = φ², the two pills are exactly 1 : φ.')}</p></div>
<div><b>{t('4 · Celah = 1/φ³', '4 · Gap = 1/φ³')}</b><p>{t('Celah ini membuat tinggi total tepat √5, bilangan yang sama yang membentuk φ = (1 + √5) / 2.', 'This gap makes the total height exactly √5, the same number that defines φ = (1 + √5) / 2.')}</p></div></div></div>'''))

    rows = [(t('Tinggi kapsul, unit h', 'Pill height, unit h'), '1', '1.000'), (t('Radius sudut', 'Corner radius'), 'h / 2', '0.500'),
            (t('Panjang kapsul atas', 'Top pill length'), 'φ', f'{PHI:.3f}'), (t('Panjang kapsul bawah', 'Bottom pill length'), 'φ² = φ + 1', f'{PHI**2:.3f}'),
            (t('Celah', 'Gap'), '1 / φ³', f'{GAP:.3f}'), (t('Lebar logo', 'Logo width'), 'φ²', f'{W:.3f}'),
            (t('Tinggi logo', 'Logo height'), '2 + 1/φ³ = √5', f'{TOTAL:.3f}'), (t('Rasio atas : bawah', 'Top : bottom ratio'), '1 : φ', f'1 : {PHI:.3f}')]
    pages.append(page(6, t('Proporsi', 'Proportions'), t('Semua ukuran dalam satu tabel', 'Every measurement in one table'),
     f'''<div class="cols"><table class="spec"><thead><tr><th>{t('Elemen', 'Element')}</th><th>{t('Rumus', 'Formula')}</th><th>{t('Nilai', 'Value')}</th></tr></thead><tbody>
{''.join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td></tr>' for a, b, c in rows)}</tbody></table>
<div class="lead"><p>{t('Setiap versi logo, dari ikon 16 px sampai sampul dokumen ini, memakai proporsi yang sama persis. Kalau logo perlu digambar ulang, cukup ikuti tabel ini.', 'Every version of the logo, from the 16 px icon to the cover of this document, uses exactly these proportions. To redraw the logo, follow this table.')}</p>
<p>{t('Sudut kapsul selalu setengah tinggi kapsul, jadi ujungnya bulat sempurna di ukuran berapa pun.', 'The corner radius is always half the pill height, so the ends stay perfectly round at any size.')}</p></div></div>'''))

    pages.append(page(7, t('Logo final', 'Final logo'), 'Berth Studio',
     f'''<div class="final"><div class="hero">{lockup(260, size=118, gap=78)}</div>
<div class="variants"><div class="v"><div class="tile">{mark(120)}</div><span>Mark</span></div>
<div class="v"><div class="tile stack">{mark(96)}<span class="word" style="font-size:30px;color:{NAVY}">Berth <span style="color:{SLATE};font-weight:400">Studio</span></span></div><span>{t('Bertumpuk', 'Stacked')}</span></div>
<div class="v"><div class="tile"><span class="word" style="font-size:40px;color:{NAVY}">Berth <span style="color:{SLATE};font-weight:400">Studio</span></span></div><span>Wordmark</span></div></div></div>'''))

    pages.append(page(8, t('Ikon aplikasi', 'App icon'), t('Di Dock, di sidebar, di tab browser', 'In the Dock, the sidebar and the browser tab'),
     f'''<div class="icons"><div class="big">{app_icon(360)}</div>
<div class="ladder">{''.join(f'<figure>{app_icon(sz)}<figcaption>{sz} px</figcaption></figure>' for sz in (128, 64, 32, 16))}</div>
<div class="lead small"><p>{t('Di ikon, kapsul bawah berubah menjadi mist supaya kontras di atas navy. Logo memakai 56% lebar ikon dan diletakkan tepat di tengah. Di 16 px kedua kapsul masih terpisah jelas.', 'On the icon the bottom pill turns mist so it stands out on navy. The mark takes 56% of the icon width and sits exactly in the centre. At 16 px the two pills are still clearly apart.')}</p></div></div>'''))

    colors = [('Harbor navy', NAVY, t('Warna utama. Kapsul database, teks wordmark, latar ikon.', 'Primary colour. The database pill, the wordmark and the icon background.'), ''),
              ('Signal amber', AMBER, t('Aksen. Kapsul API dan sorotan penting saja.', 'Accent. The API pill and key highlights only.'), ''),
              ('Tide teal', TEAL, t('Warna aksen di dalam aplikasi: fokus, seleksi, tombol utama.', 'The accent inside the app: focus, selection, primary buttons.'), ''),
              ('Mist', MIST, t('Latar terang dan kapsul bawah di atas navy.', 'Light backgrounds, and the bottom pill on navy.'), f'box-shadow:inset 0 0 0 1px {LINE};')]
    pages.append(page(9, t('Warna', 'Colour'), t('Harbor navy dan signal amber', 'Harbor navy and signal amber'),
     f'''<div class="colors">{''.join(f'<div class="c"><div class="chip" style="background:{hx};{bd}"></div><b>{nm}</b><code>{hx}</code><code>RGB {int(hx[1:3],16)} {int(hx[3:5],16)} {int(hx[5:7],16)}</code><p>{use}</p></div>' for nm, hx, use, bd in colors)}</div>
<div class="ratio"><span style="flex:60;background:{MIST};box-shadow:inset 0 0 0 1px {LINE}"></span><span style="flex:25;background:{NAVY}"></span><span style="flex:10;background:{TEAL}"></span><span style="flex:5;background:{AMBER}"></span></div>
<p class="note">{t('Takaran pemakaian: 60 mist, 25 navy, 10 teal, 5 amber. Amber sengaja paling sedikit supaya tetap menarik perhatian.', 'Proportion of use: 60 mist, 25 navy, 10 teal, 5 amber. Amber is used least on purpose, so it keeps drawing the eye.')}</p>'''))

    pages.append(page(10, t('Tipografi', 'Typography'), t('Geist untuk kata, Geist Mono untuk data', 'Geist for words, Geist Mono for data'),
     f'''<div class="type"><div><div class="aa">Aa</div><b>Geist</b><p>{t('Wordmark dan seluruh UI. Geometris dan netral, jadi kapsul tetap jadi bintang utamanya. "Berth" 600, "Studio" 400.', 'The wordmark and the whole UI. Geometric and neutral, so the pills stay the star. "Berth" in 600, "Studio" in 400.')}</p>
<div class="weights"><span style="font-weight:400">Regular 400</span><span style="font-weight:500">Medium 500</span><span style="font-weight:600">Semibold 600</span></div></div>
<div><div class="aa mono">0123</div><b>Geist Mono</b><p>{t('Query, nilai di grid, dan kode. Angkanya sama lebar, jadi kolom tetap lurus.', 'Queries, grid values and code. Its digits share one width, so columns stay aligned.')}</p>
<pre>SELECT id, email FROM users\nWHERE plan = 'pro'\nLIMIT 50;</pre></div></div>
<p class="note">{t('Kedua font berlisensi SIL Open Font License, jadi aman dipakai di proyek open source.', 'Both fonts use the SIL Open Font License, so they are safe for an open source project.')}</p>'''))

    pages.append(page(11, t('Aturan pakai', 'Usage'), t('Ruang kosong dan ukuran minimum', 'Clear space and minimum size'),
     f'''<div class="cols"><div class="drawing">{clear_space(520)}</div>
<div class="lead"><p>{t('<b>Ruang kosong.</b> Sisakan jarak minimal setinggi satu kapsul, h, di setiap sisi logo. Tidak boleh ada teks atau elemen lain di dalamnya.', '<b>Clear space.</b> Keep at least one pill height, h, empty on every side of the logo. No text or other element may enter it.')}</p>
<p>{t('<b>Ukuran minimum.</b> Mark minimal 16 px, lockup horizontal minimal 96 px lebarnya. Di bawah ukuran itu, pakai mark saja.', '<b>Minimum size.</b> The mark is at least 16 px, the horizontal lockup at least 96 px wide. Below that, use the mark on its own.')}</p>
<div class="minis">{''.join(f'<span>{mark(sz)}<small>{sz}</small></span>' for sz in (16, 24, 32, 48, 64))}</div></div></div>'''))

    dont_tiles = [
     (t('Jangan diputar', "Don't rotate"), f'<div style="transform:rotate(-18deg)">{mark(110)}</div>'),
     (t('Jangan tukar warna', "Don't swap colours"), mark(110, NAVY, AMBER)),
     (t('Jangan ubah proporsi', "Don't change proportions"), f'<svg viewBox="0 0 {f(W)} {f(TOTAL)}" width="110"><rect width="{f(BOTTOM)}" height="1" rx="0.5" fill="{AMBER}"/><rect y="{f(H + GAP)}" width="{f(BOTTOM)}" height="1" rx="0.5" fill="{NAVY}"/></svg>'),
     (t('Jangan pakai garis luar', "Don't outline"), mark(110, 'none', 'none').replace('fill="none"/>', f'fill="none" stroke="{NAVY}" stroke-width="0.06"/>')),
     (t('Jangan beri efek', "Don't add effects"), f'<div style="filter:drop-shadow(0 8px 10px rgba(0,0,0,.35))">{mark(110, "#F6C36F", "#22506B")}</div>'),
    ]
    pages.append(page(12, t('Variasi', 'Variations'), t('Di latar terang, gelap, dan satu warna', 'On light, dark and one colour'),
     f'''<div class="bgs"><div style="background:{MIST}">{mark(130)}</div><div style="background:{NAVY}">{mark(130, AMBER, MIST)}</div><div style="background:#fff;box-shadow:inset 0 0 0 1px {LINE}">{mark(130, '#7A7F84', '#111')}</div><div style="background:#111">{mark(130, '#9AA3A8', '#fff')}</div></div>
<div class="donts">{''.join(f'<figure><div class="tile">{svg}</div><figcaption>{c}</figcaption></figure>' for c, svg in dont_tiles)}</div>'''))

    pages.append(page(13, t('Penerapan', 'In use'), t('Logo di tempat kerjanya', 'The logo where it works'),
     f'''<div class="apps">
<div class="left"><div class="dockbar">{''.join(f'<span class="ph" style="background:{c}"></span>' for c in ('#D9DEE2', '#C9D3D8', '#E4DCCF'))}<span class="me">{app_icon(64)}<i></i></span><span class="ph" style="background:#D3D8E8"></span></div>
<div class="win"><div class="tb"><i></i><i></i><i></i>{mark(18)}<b>Berth Studio</b><span class="env">dev</span><span class="env">staging</span><span class="env prod">prod</span></div><div class="wb"><div class="side"><span></span><span></span><span></span><span class="short"></span></div><div class="main"><span></span><span></span><span class="short"></span></div></div></div></div>
<div class="right"><div class="readme"><div>{lockup(70, size=30, gap=20)}</div><p>One app for your databases and your APIs.</p><small>English · Bahasa Indonesia · 简体中文 · 日本語 · العربية · Русский</small></div>
<div class="tab"><span class="t">{mark(16)}Berth Studio<i>×</i></span><span class="t off">New tab</span></div></div>
</div>'''))

    pages.append(f'''<section class="page cover closing"><div class="close-in">{mark(230, AMBER, MIST)}
<div><h2>{t('Dua kapsul. Dua warna.<br>Satu rasio.', 'Two pills. Two colours.<br>One ratio.')}</h2>
<div class="trio"><div><b>B</b><span>{t('Dua kapsul yang ditumpuk terbaca sebagai huruf B, dan tetap jelas di ukuran 16 px.', 'Two stacked pills read as the letter B, and stay clear at 16 px.')}</span></div>
<div><b>API + DB</b><span>{t('Amber untuk API, navy untuk database, dan celah di antaranya sebagai dermaga.', 'Amber for the API, navy for the database, and the gap between them as the pier.')}</span></div>
<div><b>φ</b><span>{t('Kapsul atas φ, kapsul bawah φ², celah 1/φ³, dan tinggi total √5.', 'Top pill φ, bottom pill φ², gap 1/φ³, total height √5.')}</span></div></div></div></div>
<footer><span>Berth Studio, open source database and API client</span><span>Logo case study</span></footer></section>''')
    return pages


CSS = f'''
@page {{ size: 1600px 900px; margin: 0 }}
* {{ box-sizing: border-box }}
html, body {{ margin: 0; background: #e9ecee; -webkit-print-color-adjust: exact; print-color-adjust: exact }}
body {{ font-family: 'Geist', -apple-system, 'Helvetica Neue', sans-serif; color: {NAVY} }}
.page {{ width: 1600px; height: 900px; background: {PAPER}; padding: 64px 96px; position: relative; overflow: hidden; page-break-after: always; break-after: page; margin: 0 auto 24px }}
@media print {{ .page {{ margin: 0 }} body {{ background: {PAPER} }} }}
header {{ display: flex; justify-content: space-between; align-items: center; font-size: 15px; color: {SLATE} }}
header .brand {{ display: flex; align-items: center; gap: 12px }} header .brand b {{ color: {NAVY}; font-weight: 600 }}
header .num {{ font-family: 'Geist Mono', monospace }}
.kicker {{ margin-top: 56px; font-size: 16px; letter-spacing: .14em; text-transform: uppercase; color: {TEAL}; font-weight: 600 }}
h2 {{ font-size: 56px; letter-spacing: -.025em; font-weight: 600; margin: 10px 0 40px; line-height: 1.05; text-wrap: balance }}
h3 {{ font-size: 20px; margin: 0 0 14px; font-weight: 600 }}
p {{ margin: 0 0 16px; line-height: 1.55 }}
code {{ font-family: 'Geist Mono', monospace; font-size: .92em }}
.cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: start }}
.lead p {{ font-size: 23px; color: #22343E }} .lead.small p {{ font-size: 19px }}
.note {{ position: absolute; left: 96px; right: 96px; bottom: 56px; font-size: 18px; color: {SLATE} }}
.goals {{ margin: 0; padding: 0; list-style: none; counter-reset: g }}
.goals li {{ counter-increment: g; display: grid; grid-template-columns: 44px 1fr; font-size: 20px; line-height: 1.5; padding: 14px 0; border-top: 1px solid {LINE} }}
.goals li::before {{ content: counter(g); font-family: 'Geist Mono', monospace; color: {TEAL} }}
.cover {{ background: {NAVY}; color: {MIST}; display: flex; flex-direction: column }}
.cover-in {{ margin: auto 0 auto 40px; display: flex; flex-direction: column; gap: 28px }}
.cover .cover-in svg rect:last-child {{ fill: {MIST} }}
.cover h1 {{ font-size: 112px; margin: 24px 0 0; letter-spacing: -.035em; font-weight: 600; line-height: 1 }}
.cover h1 span {{ font-weight: 400; color: #9FB2BD }}
.cover p {{ font-size: 28px; color: {AMBER}; margin: 0 }}
.cover footer {{ display: flex; justify-content: space-between; font-size: 17px; color: #9FB2BD; padding: 0 40px }}
.map {{ display: flex; flex-direction: column; gap: 22px }}
.map div {{ display: grid; grid-template-columns: 56px 1fr; column-gap: 18px; align-items: center }}
.map .sw {{ grid-row: span 2; width: 56px; height: 24px; border-radius: 12px }}
.map b {{ font-size: 20px }} .map p {{ grid-column: 2; margin: 4px 0 0; color: {SLATE}; font-size: 18px }}
.explore {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px }}
.explore figure {{ margin: 0 }} .tile {{ height: 260px; border-radius: 18px; background: #fff; display: grid; place-items: center; box-shadow: inset 0 0 0 1px {LINE} }}
.explore .chosen .tile {{ box-shadow: inset 0 0 0 3px {TEAL} }}
.explore .rejected .tile {{ opacity: .9 }}
figcaption {{ margin-top: 16px; display: flex; flex-direction: column; gap: 6px; font-size: 18px }}
figcaption span {{ color: {SLATE}; font-size: 16px; line-height: 1.5 }}
.construct {{ display: grid; grid-template-columns: 780px 1fr; gap: 56px; align-items: start; margin-top: -10px }}
.drawing {{ background: #fff; border-radius: 18px; box-shadow: inset 0 0 0 1px {LINE}; padding: 10px; display: grid; place-items: center }}
.steps {{ display: flex; flex-direction: column; gap: 18px }} .steps b {{ font-size: 19px }} .steps p {{ margin: 6px 0 0; color: {SLATE}; font-size: 17px }}
.steps div {{ border-top: 1px solid {LINE}; padding-top: 14px }}
.spec {{ border-collapse: collapse; width: 100%; font-size: 19px }}
.spec th {{ text-align: left; font-size: 14px; letter-spacing: .1em; text-transform: uppercase; color: {SLATE}; padding: 0 0 12px; font-weight: 600 }}
.spec td {{ padding: 13px 0; border-top: 1px solid {LINE} }} .spec td:nth-child(2), .spec td:nth-child(3) {{ font-family: 'Geist Mono', monospace }}
.spec td:nth-child(3) {{ text-align: right }}
.lockup {{ display: inline-flex; align-items: center }} .word {{ font-weight: 600; letter-spacing: -.025em; line-height: 1 }}
.final .hero {{ height: 330px; display: grid; place-items: center; background: #fff; border-radius: 22px; box-shadow: inset 0 0 0 1px {LINE}; margin-top: -10px }}
.variants {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 28px }}
.variants .tile {{ height: 200px }} .variants .v > span {{ display: block; margin-top: 10px; color: {SLATE}; font-size: 16px }}
.tile.stack {{ display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px }}
.icons {{ display: grid; grid-template-columns: 380px 1fr; grid-template-rows: auto 1fr; column-gap: 72px; margin-top: -10px }}
.icons .big {{ grid-row: span 2 }} .ladder {{ display: flex; align-items: flex-end; gap: 40px; margin-bottom: 40px }}
.ladder figure {{ margin: 0; display: flex; flex-direction: column; align-items: center; gap: 12px }} .ladder figcaption {{ font-family: 'Geist Mono', monospace; font-size: 15px; color: {SLATE} }}
.colors {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px }}
.colors .chip {{ height: 230px; border-radius: 18px; margin-bottom: 18px }} .colors b {{ display: block; font-size: 20px; margin-bottom: 6px }}
.colors code {{ display: block; color: {SLATE}; font-size: 15px; line-height: 1.6 }} .colors p {{ margin-top: 10px; font-size: 16px; color: {SLATE} }}
.ratio {{ display: flex; height: 22px; border-radius: 11px; overflow: hidden; margin-top: 30px }}
.type {{ display: grid; grid-template-columns: 1fr 1fr; gap: 80px }} .aa {{ font-size: 150px; line-height: 1; font-weight: 600; letter-spacing: -.04em; margin-bottom: 16px }}
.aa.mono {{ font-family: 'Geist Mono', monospace; font-weight: 400; color: {TEAL} }}
.type b {{ font-size: 24px; display: block; margin-bottom: 8px }} .type p {{ font-size: 18px; color: {SLATE} }}
.weights {{ display: flex; gap: 28px; font-size: 22px }}
pre {{ font-family: 'Geist Mono', monospace; font-size: 19px; background: {NAVY}; color: {MIST}; padding: 18px 22px; border-radius: 12px; margin: 0; line-height: 1.55 }}
.minis {{ display: flex; align-items: flex-end; gap: 30px; margin-top: 28px }} .minis span {{ display: flex; flex-direction: column; align-items: center; gap: 10px }}
.minis small {{ font-family: 'Geist Mono', monospace; color: {SLATE}; font-size: 14px }}
.bgs {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: -8px }} .bgs > div {{ height: 230px; border-radius: 18px; display: grid; place-items: center }}
.donts {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 22px; margin-top: 30px }} .donts figure {{ margin: 0 }} .donts .tile {{ height: 150px; position: relative }}
.donts .tile::after {{ content: ''; position: absolute; inset: 14px; background: linear-gradient(to top right, transparent calc(50% - 1.5px), #C2410C calc(50% - 1.5px), #C2410C calc(50% + 1.5px), transparent calc(50% + 1.5px)); opacity: .75 }}
.donts figcaption {{ font-size: 16px; color: #9A3412 }}
.apps {{ display: grid; grid-template-columns: 1.15fr 1fr; gap: 28px; margin-top: -10px }} .apps .left, .apps .right {{ display: flex; flex-direction: column; gap: 28px }}
.dockbar {{ height: 120px; border-radius: 26px; background: #E3E8EB; display: flex; align-items: center; justify-content: center; gap: 18px; position: relative }}
.dockbar .ph {{ width: 64px; height: 64px; border-radius: 15px }} .dockbar svg {{ transform: translateY(-6px) }}
.dockbar .me {{ position: relative; display: block }} .dockbar .me i {{ position: absolute; bottom: -10px; left: 50%; margin-left: -2.5px; width: 5px; height: 5px; border-radius: 50%; background: {NAVY} }}
.win {{ border-radius: 14px; background: #fff; box-shadow: inset 0 0 0 1px {LINE}; overflow: hidden; height: 330px }}
.win .tb {{ height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid {LINE}; font-size: 16px }}
.win .tb > i {{ width: 12px; height: 12px; border-radius: 50%; background: #D7DCDF }} .win .tb > i:nth-child(3) {{ margin-right: 14px }}
.env {{ font-size: 13px; padding: 3px 10px; border-radius: 999px; background: {MIST}; color: {SLATE}; box-shadow: inset 0 0 0 1px {LINE} }}
.win .tb b {{ margin-right: auto; font-weight: 600 }} .env.prod {{ color: #B42318 }}
.wb {{ display: grid; grid-template-columns: 210px 1fr; height: 278px }} .wb .side {{ background: {MIST}; padding: 22px; display: flex; flex-direction: column; gap: 14px }}
.wb span {{ height: 12px; border-radius: 6px; background: #DFE5E8 }} .wb .short {{ width: 55% }} .wb .main {{ padding: 26px; display: flex; flex-direction: column; gap: 16px }}
.readme {{ background: #fff; border-radius: 14px; box-shadow: inset 0 0 0 1px {LINE}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 24px; height: 230px }}
.readme p {{ margin: 6px 0 0; font-size: 18px; color: {SLATE} }} .readme small {{ color: {TEAL}; font-size: 14px }}
.tab {{ background: #DDE3E6; border-radius: 14px; height: 222px; padding: 24px 22px 0; display: flex; align-items: flex-start; gap: 6px }}
.tab .t {{ display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 10px 10px 0 0; padding: 14px 18px; font-size: 16px; min-width: 240px }}
.tab .t i {{ margin-left: auto; font-style: normal; color: {SLATE} }} .tab .t.off {{ background: transparent; color: {SLATE}; min-width: 160px }}
.closing .close-in {{ margin: auto 40px; display: grid; grid-template-columns: 300px 1fr; gap: 100px; align-items: center }}
.closing h2 {{ color: {MIST}; font-size: 76px; margin: 0 0 56px; letter-spacing: -.03em }}
.trio {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px }} .trio div {{ border-top: 1px solid #2A4452; padding-top: 18px }}
.trio b {{ display: block; font-size: 30px; color: {AMBER}; margin-bottom: 10px; font-weight: 600 }} .trio span {{ color: #C9D5DB; font-size: 19px; line-height: 1.5 }}
'''

FONTS_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=block'


def font_faces():
    """Inline Geist and Geist Mono (SIL OFL) as data URIs, so Chrome's PDF printer never falls back to system fonts.
    The last successful download is kept in .font-cache.css, so a rebuild works offline."""
    cache_file = OUT / '.font-cache.css'
    try:
        ua = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
        css = urllib.request.urlopen(urllib.request.Request(FONTS_URL, headers=ua), timeout=20).read().decode()
        cache = {}
        def inline(m):
            if m.group(1) not in cache:
                cache[m.group(1)] = base64.b64encode(urllib.request.urlopen(m.group(1), timeout=20).read()).decode()
            return f"url(data:font/woff2;base64,{cache[m.group(1)]}) format('woff2')"
        css = re.sub(r"url\((https://[^)]+)\) format\('woff2'\)", inline, css)
        cache_file.write_text(css)
        print(f'fonts embedded: {len(cache)} files')
        return f'<style>{css}</style>'
    except Exception as err:
        if cache_file.exists():
            print(f'fonts embedded from .font-cache.css (download failed: {err})')
            return f'<style>{cache_file.read_text()}</style>'
        print(f'fonts not embedded ({err}); the PDF may fall back to system fonts')
        return f'<link href="{FONTS_URL}" rel="stylesheet">'


fonts = font_faces()
for lang, name in (('id', 'case-study.html'), ('en', 'case-study.en.html')):
    pages = case_study_pages(lang)
    body = re.sub(r'<li>(.*?)</li>', r'<li><span>\1</span></li>', ''.join(pages))   # keep each list item one grid cell
    write(name, f'''<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>Berth Studio · Logo case study</title>
{fonts}
<style>{CSS}</style></head><body>{body}</body></html>''')

# small pages used to render PNG assets with Chrome
write('render-app-icon.html', f'<!doctype html><html><head><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style></head><body>{app_icon(1024)}</body></html>')
print(f'mark {W:.4f} x {TOTAL:.4f} (√5 = {5 ** 0.5:.4f}); pages: {len(pages)}')
