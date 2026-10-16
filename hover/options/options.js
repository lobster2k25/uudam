// Options page: connects to Anki (AnkiConnect) and stores deck, note type, what goes in each field and tags
// in storage.local "anki" (read by background.js when the popup's Anki button is pressed).
const api = globalThis.browser || globalThis.chrome;
const A = globalThis.UudamAnki;
const $ = (id) => document.getElementById(id);

let settings = { deck: '', model: '', fields: {}, tags: 'uudam' };

function status(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

const save = () => api.storage.local.set({ anki: settings });

function fill(select, names, value) {
  select.replaceChildren(...names.map((n) => new Option(n, n)));
  select.value = names.includes(value) ? value : names[0] || '';
}

// A first guess at what goes in each field, from its name (Basic: Front = word, Back = meaning).
const GUESSES = [
  [/sentence|example|context|例文|文脈/i, 'sentence'],
  [/furigana/i, 'furigana'],
  [/reading|kana|読み/i, 'reading'],
  [/mongol|монгол/i, 'mongolian'],
  [/english/i, 'english'],
  [/^(back|meaning|definition|gloss|意味)/i, 'meaning'],
  [/^(front|expression|word|vocab|term|単語|表現)/i, 'word'],
  [/url|source|link/i, 'url'],
  [/kanji|漢字/i, 'kanji'],
];
const guess = (name) => (GUESSES.find(([re]) => re.test(name)) || [, ''])[1];

async function showFields() {
  const names = await A.invoke('modelFieldNames', { modelName: settings.model });
  const old = settings.fields || {};
  const keep = names.some((n) => n in old);
  settings.fields = Object.fromEntries(names.map((n) => [n, keep ? old[n] || '' : guess(n)]));
  $('fields').replaceChildren(...names.map((name) => {
    const row = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = name;
    const select = document.createElement('select');
    for (const [key, text] of Object.entries(A.MARKERS)) select.append(new Option(text, key));
    select.value = settings.fields[name];
    select.addEventListener('change', () => { settings.fields[name] = select.value; save(); });
    const cell = document.createElement('td');
    cell.append(select);
    row.append(label, cell);
    return row;
  }));
  await save();
}

async function load() {
  const version = await A.invoke('version');
  const [decks, models] = await Promise.all([A.invoke('deckNames'), A.invoke('modelNames')]);
  fill($('deck'), decks, settings.deck);
  fill($('model'), models, settings.model);
  settings.deck = $('deck').value;
  settings.model = $('model').value;
  $('tags').value = settings.tags;
  $('setup').hidden = false;
  await showFields();
  status(`Connected to Anki (AnkiConnect version ${version}).`, 'ok');
}

$('connect').addEventListener('click', async () => {
  try {
    // Firefox and Chrome ask the user once to let the add-on talk to 127.0.0.1:8765 (Anki on this computer).
    if (!(await api.permissions.request({ origins: A.ORIGINS }))) throw new Error('The add-on needs your OK to talk to Anki on this computer.');
    status('Waiting for Anki… (answer Yes if Anki asks)');
    const answer = await A.invoke('requestPermission');
    if (answer.permission !== 'granted') throw new Error('Anki said no. In Anki: Tools → Add-ons → AnkiConnect → Config, then try again.');
    await load();
  } catch (e) {
    status(e.message, 'error');
  }
});

$('off').addEventListener('click', async () => {
  settings = { deck: '', model: '', fields: {}, tags: settings.tags };
  await save();
  $('setup').hidden = true;
  status('Anki is off. The popup\'s Anki button opens this page again.');
});

$('deck').addEventListener('change', () => { settings.deck = $('deck').value; save(); });
$('model').addEventListener('change', () => {
  settings.model = $('model').value;
  settings.fields = {};
  showFields().catch((e) => status(e.message, 'error'));
});
$('tags').addEventListener('change', () => { settings.tags = $('tags').value.trim(); save(); });

(async () => {
  settings = { ...settings, ...((await api.storage.local.get('anki')).anki || {}) };
  if (A.ready(settings) && (await api.permissions.contains({ origins: A.ORIGINS }))) {
    try { await load(); } catch (e) { status(`${e.message} (settings kept)`, 'error'); }
  }
})();

// Dictionary version and updates (vendor/dict-panel.js); background.js answers with the value itself.
UudamDictPanel($('dict'), {
  ask: (type) => api.runtime.sendMessage({ type }),
  info: 'dict-info',
  update: 'dict-update',
  done: 'Дараагийн хайлтаас шинэ үгс гарна.',
});
