# Clear View for Apple TV (browser extension)

**A separate add-on.** It has nothing to do with Uudam (Netflix subtitles, in the repo root) or Uudam Hover
(`hover/`). It shares no code or data with them and is built and published on its own.

For the Apple TV web player at `tv.apple.com`, in Firefox:

- **No dark shade.** The dark layer Apple draws over the video when the controls show is removed.
- **Controls wake only from the bottom.** Moving the mouse over the top part of the video doesn't bring up
  the controls; only the bottom 20% does (you can change the size). The cursor still shows while you move.
- **Controls hide fast.** After the mouse stops for 1 second (you can change it), the player is told the mouse
  left, so it hides the controls right away.
- **Double-click for full screen.** Double-click the video to go full screen and again to leave. A single click
  still pauses and plays, about 0.3 seconds later, so a double-click doesn't pause and play the video.

Every part can be turned off. Settings: the toolbar button, or `about:addons` → Clear View → Preferences.
Changes apply to an open Apple TV tab right away.

Not made by or connected with Apple. "Apple TV" names the site it works on.

## Load it for testing

Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `clear-view/manifest.json`.
Temporary add-ons are removed when Firefox closes. Needs Firefox 142+.

## How it works

| File | Role |
|------|------|
| `src/page.js` | Runs inside the Apple TV page (`world: "MAIN"`), before the page's own code. Opens the player's closed shadow roots so it can reach the video and add its stylesheet; finds and clears the shade layers; filters mouse events by zone; sends "mouse left" / "mouse came back" events; handles clicks and double-clicks on the bare video. Skips the silent background clips on browse pages (`<amp-background-video>`) and never sends "mouse left" while the mouse rests on a button, slider or menu |
| `src/bridge.js` | Runs in the add-on's own space. Reads the settings from `browser.storage.local` and passes them to `page.js` as a JSON string in a `clear-view:settings` event (page scripts can't read add-on storage) |
| `options/` | Settings page, also used as the toolbar pop-up (`options.html?popup`) |
| `art/` | Icon sources. `python3 clear-view/art/make-icons.py` (needs `pip install cairosvg`) writes `icons/*.png` and `art/listing-icon.png` |
| `test/` | `node clear-view/test/firefox-test.js` (from the repo root, after `npm install`): loads the add-on into headless Firefox and checks every feature on a fake player page (`test/player.html`) |

It uses Manifest V2 so Firefox grants access to `tv.apple.com` at install, with no extra permission step.
The only permission is `storage`.

Apple's player can change at any time. If a part stops working, the likely cause is a change in how the
player is built (names of its parts, or which mouse events it listens to).

## Privacy

Collects nothing and sends nothing. It makes no network requests. Settings stay in your browser.

## Build the addons.mozilla.org package

From the repo root:

```sh
npx web-ext lint  --source-dir clear-view --ignore-files art test STORE.md
npx web-ext build --source-dir clear-view --ignore-files art test STORE.md --overwrite-dest
```

`web-ext build` writes `web-ext-artifacts/clear_view_for_apple_tv-<version>.zip` (git-ignored). Upload that.
No build step and no minified code, so no source package is needed. Store texts are in [STORE.md](STORE.md).

## License

MIT (see `LICENSE` in the repo root).
