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
    // Grammar patterns (〜てしまう): each one's match regexes joined into one, run over a whole subtitle line.
    const grammar = [];
    for (const g of dict.grammar || []) {
      try { grammar.push({ entry: g, re: new RegExp(g.match.map((m) => `(?:${m})`).join('|'), 'g') }); } catch { /* bad regex: skip */ }
    }
    return { words, kanji, grammar, fallback: fallbackIndex(fallback) };
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

  // What the endings of a bent word do, in Mongolian, in order: 食べ|られ|なかっ|た → чадах / идэвхгүй, үгүйсгэл, өнгөрсөн цаг.
  const ENDINGS = {
    ない: 'үгүйсгэл', ぬ: 'үгүйсгэл', ん: 'үгүйсгэл', た: 'өнгөрсөн цаг', ます: 'эелдэг хэлбэр', です: 'эелдэг хэлбэр',
    れる: 'идэвхгүй / чадах', られる: 'идэвхгүй / чадах', せる: 'үйлдүүлэх', させる: 'үйлдүүлэх', たい: 'хүсэх', たがる: 'хүсэх',
    う: 'санал, бодол (…ъя)', よう: 'санал, бодол (…ъя)', いる: 'үргэлжилж буй', おる: 'үргэлжилж буй', ある: 'хийгдсэн байдал',
    // Spoken short forms: してる = している, 読んでる = 読んでいる, 死んじまう = 死んでしまう.
    てる: 'үргэлжилж буй', でる: 'үргэлжилж буй', とる: 'үргэлжилж буй',
    しまう: 'бүрэн дуусгах / харамсах', ちゃう: 'бүрэн дуусгах / харамсах', じゃう: 'бүрэн дуусгах / харамсах',
    ちまう: 'бүрэн дуусгах / харамсах', じまう: 'бүрэн дуусгах / харамсах',
    おく: 'урьдчилан хийх', とく: 'урьдчилан хийх', みる: 'оролдож үзэх', いく: 'цааш үргэлжлэх', くる: 'ирэх, эхлэх',
    くれる: 'надад хийж өгөх', くださる: 'надад хийж өгөх', あげる: 'бусдад хийж өгөх', やる: 'бусдад хийж өгөх',
    もらう: 'хийлгэж авах', いただく: 'хийлгэж авах',
  };
  function formNotes(parts) {
    const notes = [];
    let prev = '';
    for (const p of parts || []) {
      // だ is the past of 読んだ, but だろ/でしょ guess (だろう, でしょう; their う is part of the guess).
      const guess = /^(だろ|でしょ)/.test(prev);
      prev = p.surface;
      if (guess && p.form === 'う') continue;
      const note = /^(だろ|でしょ)/.test(p.surface) ? 'таамаг' : p.form === 'だ' ? ENDINGS.た : ENDINGS[p.form];
      if (note && !notes.includes(note)) notes.push(note);
    }
    // A word that ends in て/で (見せて, 待って): the て-form, which joins actions or asks for one.
    const last = parts && parts[parts.length - 1];
    if (last && (last.form === 'て' || last.form === 'で')) notes.push('て хэлбэр (…аад; …аач гэсэн хүсэлт)');
    return notes;
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

  // Gives each unit of a line the grammar patterns found over it: unit.grammar = [entry, …], longest match first.
  // A match lying inside the stem of a word we have an entry for is left out (でも is a word, not 〜ても).
  const MAX_GRAMMAR = 3;
  function attachGrammar(units, index) {
    const text = units.map((u) => u.surface).join('');
    const spans = [];
    let at = 0;
    for (const u of units) {
      const head = u.surface.length - u.parts.reduce((n, p) => n + p.surface.length, 0);
      spans.push({ start: at, end: at + u.surface.length, headEnd: at + head });
      at += u.surface.length;
      u.grammar = [];
    }
    const hits = units.map(() => []);
    for (const { entry, re } of index.grammar || []) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        // Punctuation a regex took along (でも、) doesn't count as reaching past the word.
        const core = m[0].replace(/^[\s、。，．,.!?！？…・「」『』（）()]+/, '');
        const s = m.index + (m[0].length - core.length);
        const e = s + core.replace(/[\s、。，．,.!?！？…・「」『』（）()]+$/, '').length;
        if (e <= s) continue;
        units.forEach((u, i) => {
          const sp = spans[i];
          if (!u.lookable || s >= sp.end || e <= sp.start) return;
          if (u.entries.length && s >= sp.start && e <= sp.headEnd) return;
          hits[i].push({ entry, len: e - s });
        });
      }
    }
    // One pattern per family: 〜てしまった and 〜てしまう start the same way, so only the longer match is shown.
    const family = (g) => g.pattern.replace(/[〜~]/g, '').replace(/[（(].*$/, '').slice(0, 3);
    units.forEach((u, i) => {
      const seen = new Set();
      u.grammar = hits[i].sort((a, b) => b.len - a.len).map((h) => h.entry)
        .filter((g) => !seen.has(family(g)) && seen.add(family(g))).slice(0, MAX_GRAMMAR);
    });
    return units;
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

  // The reading each kanji has in this word, from its furigana and the kanji's jōyō readings:
  // 学校 がっこう → 学 がっ (on), 校 こう (on). info: kanji → { on: [[r]], kun: [[stem, okurigana]] }.
  // Returns kanji → { r, kind: 'on' | 'kun' }; kanji whose part can't be told apart (今日 きょう) are left out.
  const VOICED = Object.fromEntries('かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどはばひびふぶへべほぼ'
    .match(/../g).map((p) => [p[0], [p[1]]]));
  for (const [h, p] of ['はぱ', 'ひぴ', 'ふぷ', 'へぺ', 'ほぽ']) VOICED[h].push(p);
  function kanjiReadings(ruby, info) {
    const out = new Map();
    const candidates = (k) => {
      const i = info.get(k);
      if (!i) return [];
      const list = [
        ...i.on.map((x) => ({ r: toHiragana(x[0]), kind: 'on' })),
        ...i.kun.map((x) => ({ r: x[0].replace(/[-.]/g, ''), kind: 'kun' })).filter((c) => c.r),
      ];
      const more = [];
      for (const c of list) {
        for (const v of VOICED[c.r[0]] || []) more.push({ ...c, r: v + c.r.slice(1) }); // 時 じ → 年月日 ...び
        if (c.kind === 'on' && /[つちくき]$/.test(c.r)) more.push({ ...c, r: `${c.r.slice(0, -1)}っ` }); // 学 がく → がっ
      }
      return [...list, ...more].sort((a, b) => b.r.length - a.r.length);
    };
    const split = (chars, rt) => {
      if (!chars.length) return rt ? null : [];
      if (chars[0] === '々') return null;
      for (const c of candidates(chars[0])) {
        if (!rt.startsWith(c.r)) continue;
        const rest = split(chars.slice(1), rt.slice(c.r.length));
        if (rest) return [c, ...rest];
      }
      return null;
    };
    for (const piece of ruby) {
      if (!piece.rt || !KANJI.test(piece.text)) continue;
      const chars = [...piece.text];
      const found = split(chars, toHiragana(piece.rt));
      if (!found) continue;
      chars.forEach((k, i) => { if (!out.has(k)) out.set(k, found[i]); });
    }
    return out;
  }

  // The built-in dictionary, which build.js splits into files under 5 MB (addons.mozilla.org's limit):
  // data/dict/parts.json { version, parts }, data/dict/kanji.json, data/dict/words-0.json … words-<parts-1>.json.
  // load(file) → the parsed JSON of a file in the add-on (or on disk, in Node).
  async function loadDict(load) {
    const { version, parts } = await load('data/dict/parts.json');
    const [kanji, grammar, ...lists] = await Promise.all([load('data/dict/kanji.json'), load('data/dict/grammar.json').catch(() => []),
      ...[...Array(parts).keys()].map((i) => load(`data/dict/words-${i}.json`))]);
    return { version, kanji, grammar, words: lists.flat() };
  }

  return { formNotes, buildIndex, fallbackIndex, rankFallback, segment, attachGrammar, furigana, toHiragana, kanjiReadings, loadDict };
});
