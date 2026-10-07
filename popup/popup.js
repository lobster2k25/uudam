const api = globalThis.browser || globalThis.chrome;
const NETFLIX = { origins: ['*://www.netflix.com/*'] };
const $ = (id) => document.getElementById(id);

// Firefox lets the user withhold host permissions; without them the content scripts never run.
api.permissions.contains(NETFLIX).then((ok) => { $('grant').style.display = ok ? 'none' : 'block'; });
$('grant-btn').addEventListener('click', () => api.permissions.request(NETFLIX).then((ok) => {
  if (ok) $('grant').style.display = 'none';
}));

api.storage.local.get({ enabled: true, furigana: true, misses: {} }).then((s) => {
  for (const k of ['enabled', 'furigana']) {
    $(k).checked = s[k];
    $(k).addEventListener('change', () => api.storage.local.set({ [k]: $(k).checked }));
  }
  showMisses(s.misses);
});

let sorted = [];
function showMisses(misses) {
  sorted = Object.entries(misses).sort((a, b) => b[1].count - a[1].count);
  $('miss-count').textContent = sorted.length;
  $('misses').textContent = '';
  for (const [form, m] of sorted) {
    const row = document.createElement('div');
    const word = document.createElement('span');
    word.textContent = m.reading && m.reading !== form ? `${form} (${m.reading})` : form;
    const count = document.createElement('span');
    count.textContent = m.count;
    row.append(word, count);
    $('misses').append(row);
  }
}

// Tab-separated: word, reading, times seen, a subtitle line it appeared in.
$('copy').addEventListener('click', () => navigator.clipboard.writeText(
  sorted.map(([form, m]) => [form, m.reading || '', m.count, m.line].join('\t')).join('\n'),
));
$('clear').addEventListener('click', () => api.storage.local.set({ misses: {} }).then(() => showMisses({})));
