# Berth Studio brand

The logo is two pills, one stacked on the other.

- **Top pill:** amber, length φ. It stands for the API.
- **Bottom pill:** navy, length φ². It stands for the database.
- **Gap:** 1/φ³ between the pills.
- **Total height:** exactly √5.

The full story is in the case study: [Indonesian](berth-studio-logo-case-study.pdf) or [English](berth-studio-logo-case-study-en.pdf).

## Files

| File | Use it for |
|---|---|
| `berth-studio-mark.svg` | Light backgrounds |
| `berth-studio-mark-on-dark.svg` | Dark backgrounds |
| `berth-studio-mark-mono.svg` | One colour; it follows the surrounding text colour (`currentColor`) |
| `berth-studio-app-icon.svg`, `berth-studio-app-icon-1024.png` | App icon source. The app icons in `apps/desktop/src-tauri/icons/` are generated from it with `npm run tauri icon` |
| `berth-studio-logo-case-study.pdf`, `berth-studio-logo-case-study-en.pdf` | Case study in Indonesian and English: brief, exploration, golden-ratio construction, colours, type, usage rules |
| `build.py` | Single source of the geometry and the case-study text in both languages. It writes every SVG, plus `case-study.html` and `case-study.en.html` (generated, not committed) |
| `.font-cache.css` | Geist and Geist Mono as data URIs, saved from the last successful download so later builds work offline. Local only, not committed |

## Rules in short

- **Clear space:** keep at least one pill height (h) of empty space on every side.
- **Minimum size:**
  - the mark is at least 16 px;
  - the horizontal lockup is at least 96 px wide.
- **Don't change it:**
  - no rotating;
  - no swapping colours;
  - no stretching the pills;
  - no outlines;
  - no shadows or gradients.

## Colours

| Name | Hex |
|---|---|
| Harbor navy | `#0B2230` |
| Signal amber | `#F2A93B` |
| Tide teal | `#0E8A82` |
| Mist | `#F4F7F8` |

## Type

- **Geist:** wordmark and UI. "Berth" uses weight 600, "Studio" uses 400.
- **Geist Mono:** code and data.

Both fonts use the SIL Open Font License.

## Rebuilding

The build needs Python 3 and Google Chrome. Run it from this folder.

`build.py` downloads Geist and Geist Mono from Google Fonts and embeds them in both HTML files, so the PDF never falls back to system fonts. When the download fails it uses `.font-cache.css`. A few symbols that Geist lacks, such as φ, √ and Arabic letters, use system fonts.

**1. Generate the SVGs and the case-study HTML.**

```bash
python3 build.py
```

**2. Print the case study to PDF**, once per language.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf=berth-studio-logo-case-study.pdf "file://$PWD/case-study.html"
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf=berth-studio-logo-case-study-en.pdf "file://$PWD/case-study.en.html"
```

**3. Render the 1024 px app icon.**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 --screenshot=berth-studio-app-icon-1024.png "file://$PWD/render-app-icon.html"
```
