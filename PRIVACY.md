# Privacy Policy – Uudam (Netflix and YouTube Subtitles)

Last updated: 2026-10-22

Uudam is a browser extension that shows Japanese subtitles on Netflix and YouTube with furigana and Mongolian word meanings. This policy explains what the extension does with your data.

## Short version

Uudam does not collect, send, sell, or share any of your data. Everything stays in your own browser. There are no servers, no accounts, no analytics, no ads, and no tracking.

## What the extension reads

- **Netflix and YouTube subtitle files.** On `www.netflix.com` and `www.youtube.com` only, the extension reads the Japanese subtitle files that the site already sends to your browser, so it can show them on screen with furigana. On YouTube it may turn on the video's Japanese captions in the player so that the player downloads them. This happens on your device. The subtitles are not saved or sent anywhere.
- It does not read your Netflix or YouTube account details, viewing history, passwords, payment details, or any other website.

## What the extension stores

Uudam uses the browser's local extension storage (`storage` permission) to keep:

- Your settings: whether the extension is on, and whether furigana is shown.
- Whether dictionary updates are on, when they were last checked, and a downloaded copy of the dictionary (see below), kept in the extension's own IndexedDB.
- A list of words that were not found in the built-in dictionary: the word, its reading, how many times it was seen, and one subtitle line it appeared in. This list is shown in the extension's popup so you can see which words are missing.

This data stays in your browser. It is never sent to the developer or to anyone else. You can delete the word list at any time with the **Clear** button in the popup, and all stored data is removed when you uninstall the extension.

## What the extension sends

Nothing about you. The dictionary is built into the extension, so word lookups happen on your device.

**Dictionary updates (off unless you turn them on).** In the popup you can turn on a daily check for new words or press **Одоо шинэчлэх** (update now). Only then, and only after you allow access to GitHub, the extension downloads two public files of the open mongol-dict dictionary from GitHub (`github.com/lobster2k25/mongol-dict` releases, served from `release-assets.githubusercontent.com`): a small file with the latest version number, and the dictionary itself when it is newer. These are plain requests for public files: they carry no information about you, your viewing or your settings. As with any download, GitHub sees your IP address (GitHub's privacy statement applies). The download is data (words) only, never code.

The **Copy** button in the popup copies the missing-word list to your clipboard only when you click it. What you do with it after that is up to you.

## Permissions

- `storage`: to save your settings and the missing-word list on your device.
- Access to `www.netflix.com` and `www.youtube.com`: to read subtitles and show them on the player. The extension does not run on any other site.
- Optional access to GitHub (`github.com/lobster2k25/mongol-dict`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com`): asked for only when you turn dictionary updates on, to download the dictionary files described above. You can remove it in the browser's add-on settings at any time.

## Children

The extension does not knowingly collect any data from anyone, including children.

## Changes

If this policy changes, the new version will be posted on this page with a new date.

## Contact

Questions about this policy: open an issue at https://github.com/lobster2k25/uudam/issues
