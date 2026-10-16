// Saving words to Anki through the AnkiConnect add-on (it listens on 127.0.0.1:8765 while Anki is open).
// Used by the background page (adding notes) and the options page (picking deck, note type and fields).
// The settings live in storage.local under "anki": { deck, model, fields: { fieldName: marker }, tags }.
(function (root) {
  const URL = 'http://127.0.0.1:8765';
  const ORIGINS = ['http://127.0.0.1:8765/*'];

  // What a note field can be filled with. The keys are stored in the settings, so they must not change.
  const MARKERS = {
    '': '(empty)',
    word: 'Word (dictionary form)',
    reading: 'Reading (hiragana)',
    furigana: 'Word with furigana (Anki format: 漢字[かんじ])',
    mongolian: 'Mongolian meaning',
    english: 'English meaning',
    meaning: 'Meaning (Mongolian, else English)',
    sentence: 'Sentence, the word in bold',
    kanji: 'Kanji in the word with their meanings',
    surface: 'Word as it was on the page',
    url: 'Page address',
  };

  async function invoke(action, params = {}) {
    let res;
    try {
      res = await fetch(URL, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
    } catch (e) {
      throw new Error('Anki is not reachable. Open Anki and make sure the AnkiConnect add-on is installed.');
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('result' in body)) {
      throw new Error('AnkiConnect refused the request. Press "Connect to Anki" in the add-on options and allow it in Anki.');
    }
    if (body.error) throw new Error(body.error);
    return body.result;
  }

  const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const list = (items) => (items.length > 1 ? `<ol>${items.map((x) => `<li>${escape(x)}</li>`).join('')}</ol>` : items.map(escape).join(''));

  // Field values for one word. word = what the background sent to the page (see background.js words()),
  // plus sentence (text, start, end), url and furigana pieces [{ text, rt? }].
  function values(word) {
    const mongolian = word.mongolian.flat();
    const english = word.english.flatMap((e) => e.s.map(([, gloss]) => gloss));
    const s = word.sentence;
    return {
      word: escape(word.form),
      reading: escape(word.reading || ''),
      furigana: word.furigana.map((p, i) => (p.rt ? `${i ? ' ' : ''}${escape(p.text)}[${escape(p.rt)}]` : escape(p.text))).join(''),
      mongolian: list(mongolian),
      english: list(english),
      meaning: list(mongolian.length ? mongolian : english),
      sentence: s ? `${escape(s.text.slice(0, s.start))}<b>${escape(s.text.slice(s.start, s.end))}</b>${escape(s.text.slice(s.end))}` : '',
      kanji: word.kanji.map((k) => `${escape(k.k)} ${escape((k.mn.length ? k.mn : k.en).join(', '))}`).join('<br>'),
      surface: escape(word.surface),
      url: escape(word.url || ''),
    };
  }

  function note(settings, word) {
    const v = values(word);
    const fields = {};
    for (const [name, marker] of Object.entries(settings.fields || {})) fields[name] = marker ? v[marker] || '' : '';
    return {
      deckName: settings.deck,
      modelName: settings.model,
      fields,
      tags: (settings.tags || '').split(/\s+/).filter(Boolean),
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    };
  }

  const ready = (settings) => !!(settings && settings.deck && settings.model && Object.values(settings.fields || {}).some(Boolean));

  root.UudamAnki = { URL, ORIGINS, MARKERS, invoke, note, ready };
})(typeof self !== 'undefined' ? self : this);
