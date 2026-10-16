// Keeps the Mongolian dictionary (mongol-dict) up to date without a new add-on version, the way Yomitan does:
// read the small index file of the latest GitHub release, and when its version is newer than ours, download the
// release's word file, check it, and keep it in IndexedDB. The dictionary built into the add-on stays as the backup.
// Data only, never code. Used by uudam's and hover's background scripts, and by build.js (fromRelease) in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UudamDictUpdate = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const LATEST = 'https://github.com/lobster2k25/mongol-dict/releases/latest/download/';
  const INDEX_URL = `${LATEST}mongol-dict-ja-mn-yomitan-index.json`;
  const DATA_URL = `${LATEST}mongol-dict-ja-mn.json`;
  // github.com answers with a redirect to the file host; both must be allowed (optional_host_permissions).
  const ORIGINS = ['https://github.com/lobster2k25/mongol-dict/*', 'https://release-assets.githubusercontent.com/*', 'https://objects.githubusercontent.com/*'];
  const DAY = 24 * 60 * 60 * 1000;

  // "0.10.1" > "0.9.3"; anything missing counts as 0.
  function newer(a, b) {
    const pa = String(a || '0').split('.').map(Number);
    const pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  // A release file ({ version, kanji, words, names }, tools/build-release.js) → the add-ons' dictionary shape ({ version, kanji, words }).
  function fromRelease(rel) {
    const kanji = rel.kanji.map(({ kanji, meanings_mn, origin_mn, note_kind, note_mn, examples }) => ({
      kanji, meanings_mn, origin_mn: origin_mn || '', note_kind, note_mn, examples,
    }));
    // Names (countries, places, surnames…) become word-shaped entries: the Mongolian name, then its description.
    const names = (rel.names || []).map(({ id, word, reading, alt, kind, mn, desc_mn }) => ({
      id, word, reading, alt, pos: `name-${kind}`, meanings_mn: desc_mn ? [mn, desc_mn] : [mn], note_kind: '', note_mn: '',
    }));
    const words = [...rel.words.map(({ status, ...e }) => e), ...names];
    return { version: rel.version, kanji, words };
  }

  // Throws unless the download looks like a whole dictionary, so a broken file never replaces a good one.
  function check(dict) {
    const bad = (why) => { throw new Error(`dictionary download rejected: ${why}`); };
    if (!dict || !/^\d+\.\d+\.\d+$/.test(dict.version || '')) bad('no version');
    if (!Array.isArray(dict.kanji) || dict.kanji.length < 1000) bad('too few kanji');
    if (!Array.isArray(dict.words) || dict.words.length < 1000) bad('too few words');
    for (const k of dict.kanji) if (typeof k.kanji !== 'string' || !Array.isArray(k.meanings_mn)) bad('bad kanji entry');
    for (const w of dict.words) if (typeof w.word !== 'string' || !Array.isArray(w.meanings_mn)) bad('bad word entry');
    return dict;
  }

  // ---------- IndexedDB: one record, the downloaded dictionary ----------

  const DB = 'uudam-dict';
  const STORE = 'dict';
  const KEY = 'current';
  const db = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { d.close(); resolve(req.result); };
      tx.onerror = () => { d.close(); reject(tx.error); };
    });
  }
  const saved = () => run('readonly', (s) => s.get(KEY)).then((d) => d || null, () => null);
  const save = (dict) => run('readwrite', (s) => s.put(dict, KEY));
  const forget = () => run('readwrite', (s) => s.delete(KEY));

  // The downloaded dictionary if it is newer than the built-in one (bundledVersion), else null.
  async function savedIfNewer(bundledVersion) {
    const d = await saved();
    return d && newer(d.version, bundledVersion) ? d : null;
  }

  const allowed = (api) => api.permissions.contains({ origins: ORIGINS });

  // Checks the latest release and downloads it when newer. → { status: 'updated' | 'current' | 'no-permission', version }
  // A second call while one is running gets the same answer (the popup and permissions.onAdded can both ask).
  let running = null;
  function update(api, bundledVersion) {
    running ||= doUpdate(api, bundledVersion).finally(() => { running = null; });
    return running;
  }
  async function doUpdate(api, bundledVersion) {
    if (!(await allowed(api))) return { status: 'no-permission', version: bundledVersion };
    const have = (await savedIfNewer(bundledVersion))?.version || bundledVersion;
    const get = async (url) => {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.json();
    };
    const index = await get(INDEX_URL);
    await api.storage.local.set({ dictCheckedAt: Date.now() });
    if (!newer(index.revision, have)) return { status: 'current', version: have };
    const dict = check(fromRelease(await get(DATA_URL)));
    await save(dict);
    return { status: 'updated', version: dict.version };
  }

  // The once-a-day check, when the user turned it on. → update()'s answer, or null when it is not time yet.
  async function daily(api, bundledVersion) {
    const s = await api.storage.local.get({ dictAuto: false, dictCheckedAt: 0 });
    if (!s.dictAuto || Date.now() - s.dictCheckedAt < DAY) return null;
    return update(api, bundledVersion);
  }

  return { ORIGINS, newer, fromRelease, check, saved, savedIfNewer, forget, update, daily };
});
