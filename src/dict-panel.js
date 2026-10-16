// The «Толь бичиг» box in uudam's popup and hover's options page: the dictionary version, the once-a-day update
// check and an update button (dict-update.js does the work in the background script). GitHub access is asked for
// only here, when the user turns updates on or presses the button.
// UudamDictPanel(el, { ask, info, update, done }): ask(type) sends a message to the background script and resolves
// with its answer; info/update are the message types; done is the line shown after a successful update.
(function (root) {
  root.UudamDictPanel = function (el, opts) {
    const api = globalThis.browser || globalThis.chrome;
    const origins = root.UudamDictUpdate.ORIGINS;
    el.innerHTML = `
      <div>Хувилбар: <b class="dict-version">…</b></div>
      <label><input type="checkbox" class="dict-auto"> Шинэ үгийг өдөр бүр шалгаж татах</label>
      <div class="buttons"><button class="dict-update">Одоо шинэчлэх</button></div>
      <div class="dict-status"></div>
      <div class="dict-note">GitHub-аас толийн файлыг л татна; таны тухай юу ч илгээхгүй.</div>`;
    const $ = (cls) => el.querySelector(`.${cls}`);
    const status = (text) => { $('dict-status').textContent = text; };

    const refresh = () => opts.ask(opts.info).then((i) => {
      $('dict-version').textContent = `mongol-dict ${i.version}${i.updated ? ' (татсан)' : ''}`;
      $('dict-auto').checked = i.auto;
      if (!$('dict-status').textContent && i.checkedAt) status(`Сүүлд шалгасан: ${new Date(i.checkedAt).toLocaleString()}`);
    }, () => { $('dict-version').textContent = '?'; });

    const run = async () => {
      status('Шалгаж байна…');
      $('dict-update').disabled = true;
      try {
        const r = await opts.ask(opts.update);
        if (!r || r.status === 'error') status(`Алдаа: ${r && r.error ? r.error : 'хариу алга'}`);
        else if (r.status === 'updated') status(`Шинэчлэгдлээ: ${r.version}. ${opts.done}`);
        else if (r.status === 'current') status(`Хамгийн сүүлийн хувилбар байна (${r.version}).`);
        else status('GitHub-аас татах зөвшөөрөл алга.');
      } catch (err) {
        status(`Алдаа: ${err && err.message ? err.message : err}`);
      }
      $('dict-update').disabled = false;
      refresh();
    };

    // permissions.request must be the first thing the click does (browsers only allow it from a user action).
    const askAccess = () => api.permissions.request({ origins }).then((ok) => {
      if (!ok) status('Зөвшөөрөл өгөөгүй тул татаж чадахгүй.');
      return ok;
    });
    // Firefox may close the popup while its permission prompt is open; the background script then starts the
    // download itself when the permission arrives (permissions.onAdded), so dictAuto is saved right away.
    $('dict-auto').addEventListener('change', (e) => {
      if (!e.target.checked) { api.storage.local.set({ dictAuto: false }); return; }
      const access = askAccess();
      api.storage.local.set({ dictAuto: true });
      access.then((ok) => {
        if (ok) return run();
        e.target.checked = false;
        return api.storage.local.set({ dictAuto: false });
      });
    });
    $('dict-update').addEventListener('click', () => askAccess().then((ok) => ok && run()));
    refresh();
  };
})(typeof self !== 'undefined' ? self : this);
