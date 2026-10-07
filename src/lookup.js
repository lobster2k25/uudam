// Pure lookup logic, shared by the extension and the Node test: groups kuromoji tokens into clickable
// words, finds them in our dictionary, and works out furigana. No DOM or browser APIs here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JapSubLookup = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const KANJI = /[㐀-鿿豈-﫿々〆ヵヶ]/;
  const JAPANESE = /[぀-ヿ㐀-鿿豈-﫿々〆]/;
  const MAX_SPAN = 5;

  const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // JMdict fallback (English): form → entries. Readings count as forms only for words usually written in kana.
  function fallbackIndex(list) {
    const map = new Map();
    for (const e of list || []) {
      for (const form of new Set([...e.k, ...(e.u || !e.k.length ? e.r : [])])) {
        if (!map.has(form)) map.set(form, []);
        map.get(form).push(e);
      }
    }
    return map;
  }

  // Best JMdict entries first: those read the way the subtitle reads the word, then common ones.
  function rankFallback(list, reading) {
    const score = (e) => (reading && e.r.includes(reading) ? 2 : 0) + (e.c ? 1 : 0);
    return [...list].sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  function buildIndex(dict, fallback) {
    const words = new Map();
    for (const e of dict.words) {
      for (const form of [e.word, ...(e.alt || [])]) {
        if (!words.has(form)) words.set(form, []);
        if (!words.get(form).includes(e)) words.get(form).push(e);
      }
    }
    const kanji = new Map(dict.kanji.map((k) => [k.kanji, k]));
    return { words, kanji, fallback: fallbackIndex(fallback) };
  }

  const base = (t) => (t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form);
  const isVerbLike = (t) => t.pos === '動詞' || t.pos === '形容詞' || t.pos === '助動詞';

  // Endings that belong to the word before them: 食べ|て|い|た is one word for a learner.
  function isInflection(t, prev) {
    if (!isVerbLike(prev) && !(prev.pos === '助詞' && prev.pos_detail_1 === '接続助詞')) return false;
    if (t.pos === '助動詞') return isVerbLike(prev);
    if (t.pos === '動詞') return ['非自立', '接尾'].includes(t.pos_detail_1);
    if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞') return ['て', 'で', 'ちゃ', 'じゃ'].includes(t.surface_form) && isVerbLike(prev);
    return false;
  }

  // Splits one subtitle line (already tokenized) into units: { surface, form, reading, entries, parts, ruby, kanji, lookable }.
  function segment(tokens, index) {
    const units = [];
    let i = 0;
    while (i < tokens.length) {
      let span = 1;
      let form = base(tokens[i]);
      for (let len = Math.min(MAX_SPAN, tokens.length - i); len >= 2; len--) {
        const toks = tokens.slice(i, i + len);
        const surface = toks.map((t) => t.surface_form).join('');
        const dictForm = toks.slice(0, -1).map((t) => t.surface_form).join('') + base(toks[len - 1]);
        // Our words join any tokens; JMdict ones only spans with kanji (else every kana phrase would glue together).
        const hit = [dictForm, surface].find((f) => index.words.has(f) || (KANJI.test(f) && index.fallback.has(f)));
        if (hit) { span = len; form = hit; break; }
      }
      const head = tokens.slice(i, i + span);
      i += span;
      const parts = [];
      while (i < tokens.length && isInflection(tokens[i], (parts.length ? parts[parts.length - 1] : head[head.length - 1]))) {
        parts.push(tokens[i++]);
      }
      units.push(makeUnit(head, form, parts, index));
    }
    return units;
  }

  function makeUnit(head, form, parts, index) {
    const all = [...head, ...parts];
    const surface = all.map((t) => t.surface_form).join('');
    let entries = index.words.get(form) || [];
    if (!entries.length && head.length === 1) entries = index.words.get(head[0].surface_form) || [];
    // kuromoji can't read made-up or rare words; their reading is then unknown ('*' or missing).
    const readingOf = (t) => (t.reading && t.reading !== '*' ? toHiragana(t.reading) : null);
    let headReading = head.every(readingOf) ? head.map(readingOf).join('') : null;
    // kuromoji reads the conjugated form (名乗っ → なのっ); swap its ending for the dictionary form's (なのる).
    if (headReading && head.length === 1 && base(head[0]) !== head[0].surface_form) {
      const s = head[0].surface_form;
      const b = base(head[0]);
      let p = 0;
      while (p < s.length && s[p] === b[p]) p++;
      const tail = toHiragana(s.slice(p));
      headReading = headReading.endsWith(tail) ? headReading.slice(0, headReading.length - tail.length) + toHiragana(b.slice(p)) : null;
    }
    const symbol = head.every((t) => t.pos === '記号') || !JAPANESE.test(surface);
    const fallback = entries.length ? [] : rankFallback(index.fallback.get(form) || (head.length === 1 && index.fallback.get(head[0].surface_form)) || [], headReading);
    return {
      surface,
      form,
      reading: entries[0] ? entries[0].reading : headReading,
      pos: head[0].pos,
      proper: head[0].pos_detail_1 === '固有名詞',
      properKind: head[0].pos_detail_2, // 人名 person, 地域 place, 組織 organisation
      entries,
      fallback, // JMdict entries (English), only when we have no entry of our own
      parts: parts.map((t) => ({ surface: t.surface_form, form: base(t), entries: index.words.get(base(t)) || [] })),
      ruby: all.flatMap((t) => furigana(t.surface_form, readingOf(t))),
      kanji: [...new Set([...surface].filter((c) => KANJI.test(c)))].map((c) => index.kanji.get(c) || { kanji: c, meanings_mn: [] }),
      lookable: !symbol,
    };
  }

  // Furigana for one token: [{ text, rt? }]. Kana parts of the word stay bare: 取り戻す → 取(と)り戻(もど)す.
  function furigana(surface, reading) {
    if (!reading || !KANJI.test(surface)) return [{ text: surface }];
    const pieces = surface.split(/([㐀-鿿豈-﫿々〆ヵヶ]+)/).filter(Boolean);
    const escape = (s) => toHiragana(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${pieces.map((p) => (KANJI.test(p) ? '(.+?)' : escape(p))).join('')}$`);
    const m = toHiragana(reading).match(pattern);
    if (!m) return [{ text: surface, rt: reading }];
    let g = 1;
    return pieces.map((p) => (KANJI.test(p) ? { text: p, rt: m[g++] } : { text: p }));
  }

  return { buildIndex, fallbackIndex, rankFallback, segment, furigana, toHiragana };
});
