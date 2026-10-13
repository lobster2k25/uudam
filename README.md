# Uudam – Netflix Subtitles (browser extension)

Japanese subtitles on Netflix with furigana; click a word for its Mongolian meaning and kanji breakdown.
Firefox (Manifest V3, Firefox 142+) and Chrome (111+). One folder works in both.

## Build and load in Firefox

1. In `../mongol-dict`: `npm install` (once).
2. Here: `node build.js` — fills `vendor/` (kuromoji + its 17 MB dictionary), `data/dict.json` (our kanji
   and words) and the JMdict fallback (`data/fallback.json`, `data/fallback-full/`, needs `sources/JMdict_e` from
   `fetch-sources.sh`). Re-run whenever the dictionary changes. Both folders are generated and not committed.
3. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
   Temporary add-ons are removed when Firefox closes; load again next time.
4. Open a Netflix title, turn Netflix's subtitles to **Japanese** (or leave them off — we fetch the Japanese
   track ourselves when Netflix offers one). The first line takes a few seconds while the dictionary loads.

If nothing appears: click the Uudam toolbar icon. If it shows **Зөвшөөрөх**, Firefox is withholding the
netflix.com permission — click it. Errors show in the Netflix tab's console with the prefix `[jap-sub]`.

### Chrome

Do steps 1 and 2 above, then Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** →
pick this folder. Chrome keeps it after a restart. Chrome warns about `background.scripts` and
`browser_specific_settings`, which are there for Firefox; that is fine.

## How it works

| File | Role |
|------|------|
| `src/inject.js` | Runs inside Netflix's page. Adds the WebVTT profile to the player's manifest request, reports the subtitle tracks, downloads one when asked |
| `src/background.js` | Runs kuromoji (splits Japanese into words). It lives here because Firefox content scripts can't load kuromoji's dictionary. Firefox runs it as a background page (manifest `scripts`), Chrome as a service worker (`src/sw.js` loads the same files). Chrome stops the worker when idle; the next line then waits about a second while kuromoji loads again |
| `src/content.js` | Picks the Japanese track, keeps it in sync with `video.currentTime`, draws the line with furigana; hovering the subtitles pauses the video, resting on a word opens its popup (kanji in it open the kanji's entry); on/off button 字 and Alt+J; logs words missing from our dictionary |
| `src/lookup.js` | Pure logic: joins kuromoji tokens into learner-sized words (食べ+て+い+た → 食べる), dictionary lookup, furigana |
| `build-fallback.js` | English fallback from JMdict (© EDRDG, CC BY-SA 4.0) for words without a Mongolian entry: a 37k-word subset per tab, the full 219k set in the background on demand. A separate layer: never copied into `mongol-dict/ja-mn` |
| `build-kanji.js` | Kanji layer `data/kanji.json` (2.4 MB, background only): jōyō on/kun readings, formation type, radical and phonetic part and the kanji sharing it (Kanjium, CC BY-SA 4.0), parts and stroke paths (KanjiVG © Ulrich Apel, CC BY-SA 3.0). The kanji popup draws the strokes in order. Part names come from our kanji and `mongol-dict/ja-mn/radicals.json`. A separate layer: never copied into `mongol-dict/ja-mn` |
| `popup/` | Toolbar popup: on/off, furigana on/off, list of missing words (copy as TSV for the next dictionary batch) |

If Netflix gives no WebVTT track, content.js falls back to reading the text Netflix itself draws
(works for text subtitles, not image subtitles).

## Tests

- `node test/lookup-test.js` — segmentation, lookups, furigana on sample lines.
- `node test/serve.js`, then open `http://localhost:8765/test/page.html` — a fake player running the real
  content script with a fake subtitle track, to check the overlay and popup without Netflix.
- `npm install` once, then `node test/firefox-test.js` — installs the extension into headless Firefox and checks the
  fake Netflix page `test/netflix.html` (subtitle shows, Netflix's own hidden, popup opens). Screenshots in `test/out/`.
- `node test/chrome-test.js` — the same checks (`test/checks.js`) in headless Chrome. `CHROME=` picks the browser;
  on Linux as root add `CHROME_ARGS=--no-sandbox`.
- `npx web-ext lint --source-dir . --ignore-files test build.js build-fallback.js build-kanji.js build-chrome.js package.json package-lock.json node_modules` — Mozilla's checks (currently 1 warning: Firefox ignores `background.service_worker`, which is for Chrome).

## License

Code: MIT (`LICENSE`). Bundled data, built by `build.js` and not committed:
Mongolian dictionary from [mongol-dict](https://github.com/lobster2k25/mongol-dict) (CC BY-SA 4.0);
English fallback from JMdict © EDRDG (CC BY-SA 4.0); kanji readings and formation from
[Kanjium](https://github.com/mifunetoshiro/kanjium) © Uros Ozvatic (CC BY-SA 4.0); stroke order and parts from
[KanjiVG](https://kanjivg.tagaini.net) © Ulrich Apel (CC BY-SA 3.0); kuromoji.js and its dictionary (Apache 2.0).

## Building the addons.mozilla.org package

Needs Node 20+, npm, git, curl, gunzip (Linux, macOS, or Git Bash on Windows).

```sh
git clone https://github.com/lobster2k25/mongol-dict && git -C mongol-dict checkout v0.4.0
git clone https://github.com/lobster2k25/uudam extension   # must sit next to mongol-dict
(cd mongol-dict && npm install && sh ja-mn/tools/fetch-sources.sh && node ja-mn/tools/build-freq.js)
cd extension && npm install && node build.js
npx web-ext build --source-dir . --ignore-files test build.js build-fallback.js build-kanji.js build-chrome.js package.json package-lock.json node_modules
```

For the Chrome Web Store, after `node build.js` run `node build-chrome.js`. It writes `web-ext-artifacts/uudam-chrome-<version>.zip`
(upload this) and `web-ext-artifacts/chrome/` (the same files, to try with Load unpacked). Its manifest leaves out what only
Firefox reads, so Chrome shows no warnings.

What `build.js` produces:

- `vendor/kuromoji.js`: kuromoji 0.1.2 (`node_modules/kuromoji/build/kuromoji.js` from npm), with two
  changes made by `build.js`, which checks both and stops if the pattern isn't found. (1) Dictionary URLs are
  built by plain string concatenation instead of `path.join`, which turns `moz-extension://` into `moz-extension:/`. (2) The
  dictionary files are loaded with `fetch` and the browser's own `DecompressionStream('gzip')` instead of
  XHR and kuromoji's JavaScript gunzip. Nothing else is changed.
- `vendor/dict/*.dat.gz`: kuromoji's IPADIC dictionary files, copied unchanged.
- `data/dict.json`: our Mongolian dictionary (mongol-dict). `data/fallback*.json`: English glosses from
  JMdict. `data/kanji.json`: readings, parts and stroke paths from Kanjium and KanjiVG. All of these are JSON data, not code.
