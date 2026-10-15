# Berth Studio UX case study

The case study tells the design story in 19 pages, in [Indonesian](berth-studio-ux-case-study.pdf) and [English](berth-studio-ux-case-study-en.pdf): the problem, the user, the landscape, the principles, the core idea (a connection is a system, not an environment), and the key screens from environment profiles to import, the visual language, themes and keyboard use.

It is meant for people outside the team, so it leaves out internal work such as tests, bugs, open decisions and the roadmap. Those live in [docs/ROADMAP.md](../../docs/ROADMAP.md).

## Files

| File | What it is |
|---|---|
| `shots.mjs` | Opens `design/prototype.html` in headless Chrome, sets up each screen and saves `shots/*.jpg`. It also writes `shots/crops.json` for the close-ups. The screenshots are generated, not committed |
| `build.py` | Writes `case-study.html` (Indonesian) and `case-study.en.html` (English) from the screenshots. Both languages share one layout. It reuses the Geist fonts embedded in `../brand/case-study.html`, so run `design/brand/build.py` first |
| `case-study.html`, `case-study.en.html` | The pages, 1600 × 900 px each. Generated, not committed |
| `berth-studio-ux-case-study.pdf`, `berth-studio-ux-case-study-en.pdf` | The printed case study |

## Rebuilding

Run these from the repository root. They need Node 22 or newer (for the built-in WebSocket), Python 3 and Google Chrome.

**1. Capture the screenshots.** Pass shot names to capture only some of them, for example `node design/ux/shots.mjs gate import`.

```bash
node design/ux/shots.mjs
```

**2. Generate the HTML.**

```bash
python3 design/ux/build.py
```

**3. Print the PDFs**, once per language.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --allow-file-access-from-files --virtual-time-budget=8000 --print-to-pdf=design/ux/berth-studio-ux-case-study.pdf "file://$PWD/design/ux/case-study.html"
```

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --allow-file-access-from-files --virtual-time-budget=8000 --print-to-pdf=design/ux/berth-studio-ux-case-study-en.pdf "file://$PWD/design/ux/case-study.en.html"
```

Screenshots only use a thin outline, not blurred shadows: PDF viewers such as Preview draw blurred shadows as solid grey boxes.
