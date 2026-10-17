# addons.mozilla.org listing texts

Copy these into the Developer Hub when submitting. Distribution: **On this site**.

**Name:** Clear View for Apple TV

**Add-on URL:** clear-view-for-apple-tv

**Summary** (max 250 characters):

> For the Apple TV web player: removes the dark shade over the video, wakes the controls only from the bottom
> of the screen, hides them fast, and lets you double-click for full screen.

**Description:**

> Watching on tv.apple.com, the controls cover the picture with a dark shade, pop up every time the mouse
> moves anywhere, and take a long time to go away. Clear View fixes that.
>
> - No dark shade over the video when the controls show.
> - Controls wake only when you move the mouse near the bottom of the video (bottom 20%, you can change it).
>   Moving elsewhere leaves the picture clear.
> - Controls hide about 1 second after the mouse stops (you can change it).
> - Double-click the video to go full screen, and again to leave. A single click still pauses and plays.
>
> Every feature can be turned on or off from the toolbar button. Works only on tv.apple.com.
>
> Collects no data and makes no network requests.
>
> Not made by or connected with Apple. Apple TV is a trademark of Apple Inc.

**Categories:** Photos, Music & Videos

**Support site:** https://github.com/lobster2k25/uudam/tree/main/clear-view

**License:** MIT

**Privacy policy:** none needed (no data leaves the browser).

**Icon:** `art/listing-icon.png` (512×512).

**Screenshots** (add 1–3, 1280×800 works well): the player with controls showing and no shade; the toolbar
pop-up with the settings.

## Notes for reviewers

> No build step, no minified or third-party code. Every file in the package is the source.
>
> src/page.js runs in the page's main world on tv.apple.com only, at document_start. It wraps
> Element.prototype.attachShadow to create the player's shadow roots as open instead of closed. This is
> needed because the Apple TV player's controls and video live inside closed shadow roots, and the add-on
> must reach them to clear the shade layer (via an adopted stylesheet) and to find the video element. The
> wrapper changes only the mode; it keeps the roots in a Set and does nothing else with them.
>
> The add-on stops some trusted mouse events at the window (capture phase) so the player doesn't see moves
> in the upper part of the video, and dispatches synthetic mouseleave/mouseenter-type events so the player
> hides its controls sooner and stays responsive afterwards. For the double-click feature it handles single
> clicks on the bare video itself (video.play()/pause()) after a 300 ms wait.
>
> src/bridge.js (isolated world) reads browser.storage.local and passes the settings to page.js as a JSON
> string in a CustomEvent. No network requests, no remote code, no data collection.
