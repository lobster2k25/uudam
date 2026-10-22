// Runs in Netflix's own page (MAIN world), where the player's data is visible. Also runs in Netflix's
// about:blank frames, since a player can parse its data there with untouched JSON functions.
// Asks Netflix to include text subtitle files in its manifest, passes the subtitle track list to
// content.js (in the top page), and downloads a track when content.js asks.
// On YouTube: reports the video's caption tracks, turns on Japanese captions when content.js asks, and
// keeps a copy of the caption file the player then downloads.
(() => {
  // Text formats we can read, best first. Japanese is often offered only as IMSC/TTML (XML with ruby).
  const PROFILES = ['webvtt-lssdh-ios8', 'imsc1.1', 'dfxp-ls-sdh', 'simplesdh'];
  const TAG = 'jap-sub:';
  const { stringify, parse } = JSON;
  const plainFetch = window.fetch;
  const top = window.top;
  const where = window === top ? 'page' : 'frame';
  const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const send = (msg) => top.postMessage(TAG + stringify(msg), '*');
  console.info(`[jap-sub] page hook running (${where})`);

  // The track list may sit at any depth of the parsed manifest; look a few levels down.
  function findManifest(data, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 4) return null;
    if (Array.isArray(data.timedtexttracks)) return data;
    for (const v of Object.values(data)) {
      const found = findManifest(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function inspect(data) {
    const r = findManifest(data);
    if (!r) return;
    const movieId = r.movieId || r.viewableId || (r.video && r.video.movieId);
    const tracks = r.timedtexttracks.filter((t) => !t.isNoneTrack).map((t) => {
      const offered = Object.keys(t.ttDownloadables || {});
      const format = PROFILES.find((p) => offered.includes(p));
      const d = format && t.ttDownloadables[format];
      const url = d && ((d.urls && d.urls[0] && d.urls[0].url) || Object.values(d.downloadUrls || {})[0]);
      return {
        language: t.language, name: t.languageDescription, forced: !!t.isForcedNarrative,
        cc: t.rawTrackType === 'closedcaptions', format: format || null, offered, url: url || null,
      };
    });
    console.info(`[jap-sub] Netflix subtitle tracks for ${movieId} (${where}): ${tracks.map((t) => `${t.language}${t.cc ? ' (CC)' : ''} [${t.offered.join(', ')}]`).join('; ')}`);
    send({ type: 'tracks', movieId: String(movieId), tracks });
  }

  // ---------- the player's own subtitle downloads ----------
  // With Japanese subtitles on, Netflix's player downloads the episode's whole subtitle file. We keep a
  // copy of any response that is a Japanese TTML or WebVTT file, or a YouTube caption file (JSON from
  // /api/timedtext); everything else is skipped after peeking at its first bytes.
  const MAX_SUBS = 5e6;
  const caught = new Set();
  const decoder = new TextDecoder();
  const isCaptionUrl = (url) => /\/api\/timedtext/.test(url || '');
  // < BOM W \n, or { for a YouTube caption file (other JSON is not worth reading).
  const mayBeText = (bytes, url) => bytes.length && (bytes[0] === 0x3c || bytes[0] === 0xef || bytes[0] === 0x57 || bytes[0] === 0x0a
    || (bytes[0] === 0x7b && isCaptionUrl(url)));

  // Text of a YouTube caption file (json3), or null if it is not one.
  function youTubeText(text, url) {
    if (!isCaptionUrl(url) || !text.trimStart().startsWith('{')) return null;
    try {
      const events = parse(text).events;
      if (!Array.isArray(events)) return null;
      return events.map((e) => (e.segs || []).map((g) => g.utf8 || '').join('')).join('');
    } catch { return null; }
  }

  function capture(text, url) {
    const head = text.slice(0, 3000);
    const yt = youTubeText(text, url);
    if (yt == null && !/<tt[\s>]/.test(head) && !/^﻿?\s*WEBVTT/.test(head)) return;
    const kana = ((yt == null ? text : yt).match(/[぀-ヿ]/g) || []).length;
    if (kana < 20 || caught.has(url)) return;
    caught.add(url);
    console.info(`[jap-sub] caught the player's Japanese subtitle file (${Math.round(text.length / 1024)} KB, ${where})`);
    send({ type: 'captured', text });
  }

  async function sniffResponse(res) {
    if (!res.body || Number(res.headers.get('content-length')) > MAX_SUBS) return;
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!chunks.length && !mayBeText(value, res.url)) { reader.cancel(); return; }
      chunks.push(value);
      total += value.length;
      if (total > MAX_SUBS) { reader.cancel(); return; }
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    capture(decoder.decode(all), res.url);
  }

  function hookNetwork(win) {
    const ownFetch = win.fetch;
    if (ownFetch && !ownFetch.__japSub) {
      win.fetch = async function (...args) {
        const res = await ownFetch.apply(this, args);
        try { sniffResponse(res.clone()).catch(() => {}); } catch {}
        return res;
      };
      win.fetch.__japSub = true;
    }
    const X = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (X && !X.send.__japSub) {
      const open = X.open;
      const sendRequest = X.send;
      X.open = function (method, url, ...rest) {
        this.__japSubUrl = String(url);
        return open.call(this, method, url, ...rest);
      };
      X.send = function (...args) {
        this.addEventListener('load', () => {
          try {
            const type = this.responseType;
            if (type === '' || type === 'text') {
              if (this.responseText.length < MAX_SUBS) capture(this.responseText, this.__japSubUrl);
            } else if (type === 'arraybuffer' && this.response && this.response.byteLength < MAX_SUBS) {
              const bytes = new Uint8Array(this.response);
              if (mayBeText(bytes, this.__japSubUrl)) capture(decoder.decode(bytes), this.__japSubUrl);
            }
          } catch {}
        });
        return sendRequest.apply(this, args);
      };
      X.send.__japSub = true;
    }
  }

  function hook(win) {
    hookNetwork(win);
    if (onYouTube) return; // the manifest hooks below are for Netflix's player only
    const J = win.JSON;
    const P = win.Response && win.Response.prototype;
    if (!J || J.parse.__japSub) return;
    const ownStringify = J.stringify;
    const ownParse = J.parse;
    J.stringify = function (value, ...rest) {
      try {
        const p = value && value.params;
        if (p && Array.isArray(p.profiles)) {
          for (const profile of PROFILES) if (!p.profiles.includes(profile)) p.profiles.push(profile);
          p.showAllSubDubTracks = true;
        }
      } catch {}
      return ownStringify.call(this, value, ...rest);
    };
    J.parse = function (text, ...rest) {
      const data = ownParse.call(this, text, ...rest);
      try {
        inspect(data);
        if (typeof text === 'string' && text.includes('timedtexttracks') && !findManifest(data)) {
          console.info(`[jap-sub] saw subtitle data in an unexpected shape; top-level keys: ${Object.keys(data || {}).join(', ')}`);
        }
      } catch {}
      return data;
    };
    J.parse.__japSub = true;
    if (P) {
      const json = P.json;
      P.json = async function () {
        const data = await json.call(this);
        try { inspect(data); } catch {}
        return data;
      };
    }
  }

  hook(window);

  // A frame's JSON can be grabbed the moment the frame is created, before any content script runs
  // there, so hook it whenever the page reaches into a frame. Cross-origin frames throw; skip them.
  const frameWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    ...frameWindow,
    get() {
      const win = frameWindow.get.call(this);
      try { if (win) hook(win); } catch {}
      return win;
    },
  });

  // ---------- YouTube ----------
  // The player (#movie_player) lists the video's caption tracks. Its caption files can only be fetched by
  // the player itself (they need a token it adds), so content.js asks us to switch the player to the
  // Japanese track, and the file it then downloads is caught above.
  const ytPlayer = () => {
    const p = document.getElementById('movie_player');
    return p && typeof p.getPlayerResponse === 'function' ? p : null;
  };
  let ytReported = '';
  if (where === 'page') {
    setInterval(() => {
      try {
        const p = ytPlayer();
        const r = p && p.getPlayerResponse();
        const videoId = r && r.videoDetails && r.videoDetails.videoId;
        if (!videoId) return;
        const list = ((r.captions && r.captions.playerCaptionsTracklistRenderer) || {}).captionTracks || [];
        const tracks = list.map((t) => ({ language: t.languageCode, kind: t.kind || '' }));
        const report = stringify({ type: 'yt-tracks', videoId, tracks });
        if (report === ytReported) return;
        ytReported = report;
        console.info(`[jap-sub] YouTube caption tracks for ${videoId}: ${tracks.map((t) => t.language + (t.kind ? ` (${t.kind})` : '')).join(', ') || 'none'}`);
        top.postMessage(TAG + report, '*');
      } catch {}
    }, 1000);
  }

  function showYouTubeTrack(msg) {
    const p = ytPlayer();
    if (!p) return;
    if (typeof p.loadModule === 'function') p.loadModule('captions');
    const list = (typeof p.getOption === 'function' && p.getOption('captions', 'tracklist')) || [];
    const pick = list.find((t) => t.languageCode === msg.language && (t.kind || '') === msg.kind) || { languageCode: msg.language };
    p.setOption('captions', 'track', pick);
    console.info(`[jap-sub] turned on YouTube's ${msg.language}${msg.kind ? ` (${msg.kind})` : ''} captions`);
  }

  window.addEventListener('message', async (e) => {
    if (where !== 'page' || e.source !== window || typeof e.data !== 'string' || !e.data.startsWith(TAG)) return;
    const msg = parse(e.data.slice(TAG.length));
    if (msg.type === 'yt-show') { try { showYouTubeTrack(msg); } catch (err) { console.warn(`[jap-sub] could not turn on YouTube captions: ${err}`); } return; }
    if (msg.type !== 'fetch') return;
    try {
      const res = await plainFetch(msg.url);
      send({ type: 'subs', key: msg.key, text: await res.text() });
    } catch (err) {
      send({ type: 'subs', key: msg.key, error: String(err) });
    }
  });
})();
