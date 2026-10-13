# Uudam Hover – Japanese Lookup (browser extension)

Hold **Shift** and point at Japanese text on any page: the word under the mouse gets a yellow highlight and a
popup shows its reading and English meaning (JMdict), plus the Mongolian meaning when our dictionary has it.
Verb forms are shown as the dictionary word (読んでいました → 読む). Let go of Shift and move away, press
Escape, click, or scroll to close it.

A separate add-on from uudam (which only runs on Netflix), sharing its parts: kuromoji and `src/lookup.js`
for splitting text into words, and the JMdict data from `build-fallback.js`. Firefox first (Manifest V3,
Firefox 142+); `test/chromium-test.js` shows it also runs in Chromium with a service worker.

## Build and load in Firefox

1. Build uudam first (see `../README.md`): `node build.js` in the uudam folder, with JMdict in
   `../mongol-dict/ja-mn/sources/`.
2. Here: `node build.js` — copies `vendor/` (kuromoji, lookup.js), `data/` (dict.json, fallback-full/) and
   `icons/` from uudam. Generated, not committed.
3. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `hover/manifest.json`.
4. Open any page with Japanese, hold Shift and point at a word. The first lookup takes a few seconds while
   the dictionaries load.

## How it works

| File | Role |
|------|------|
| `src/content.js` | Runs in every page. Finds the character under the mouse, sends up to 40 characters around it (same paragraph, same sentence) to the background, highlights the word it gets back (CSS Custom Highlight API, so the page is not changed) and draws the popup in a shadow root |
| `src/background.js` | Loads kuromoji, our Mongolian words and all of JMdict once; splits the text with uudam's `segment()` and answers with the word at the mouse |

## Tests

- `npm install` in uudam once, then `node test/chromium-test.js` — loads the extension into headless Chromium
  and points at words on `test/page.html` with Shift held. Screenshots in `test/out/`.
- `npx web-ext lint --source-dir . --ignore-files test build.js README.md` — Mozilla's checks (0 warnings).

## License

Code: MIT (`../LICENSE`). Bundled data: as in uudam (JMdict © EDRDG, CC BY-SA 4.0; mongol-dict, CC BY-SA 4.0;
kuromoji.js and its dictionary, Apache 2.0).
