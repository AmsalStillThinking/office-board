// One browser look at Office Board v1.6 (team + PIC, picked viewers, sub-tasks) in a headless Chrome over CDP.
// A test server of its own (random port, fictional fixture people, a throwaway schema in the test PostgreSQL),
// a scratch Chrome profile; both removed in finally. Clicks are real mouse events at the element's centre, checked
// with elementFromPoint first. Selects and date boxes are set from script (said in the report).
// Usage: node ob-v16-browser.mjs <app dir> <scratch dir>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const APP = path.resolve(process.argv[2]);
const SCR = path.resolve(process.argv[3]);
const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const DATA = path.join(SCR, 'ob-v16-data');
const PROFILE = path.join(SCR, 'ob-v16-chrome');
const SHOTS = path.join(SCR, 'ob-v16-shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -- ' + detail : '')); };

let server = null, chrome = null, ws = null;
const pageErrors = [];
try {
  for (const d of [DATA, PROFILE]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const pg = spawnSync(process.execPath, [path.join(APP, 'test', 'pgtest.mjs'), DATA], { encoding: 'utf8' });
  if (pg.status !== 0) throw new Error('pgtest: ' + pg.stdout + pg.stderr);

  // ---- the test server
  server = spawn(process.execPath, [path.join(APP, 'server.mjs'), '--port', '0', '--host', '127.0.0.1', '--data', DATA, '--seed', path.join(APP, 'test', 'fixture')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  server.stdout.on('data', (b) => { out += b; });
  server.stderr.on('data', (b) => { out += b; });
  let port = null;
  for (let i = 0; i < 200 && !port; i++) { const m = /LISTENING port=(\d+)/.exec(out); if (m) port = Number(m[1]); else await sleep(100); }
  if (!port) throw new Error('server did not start: ' + out);
  if (port === 3006) throw new Error('port 3006 is the live board');
  const base = `http://127.0.0.1:${port}`;
  const pins = new Map();
  for (const line of fs.readFileSync(path.join(DATA, 'first-pins.txt'), 'utf8').split(/\r?\n/)) { const m = /^(\S+)\t[^\t]+\t(\d+)$/.exec(line); if (m) pins.set(m[1], m[2]); }
  const token = new Map();
  for (const who of ['T03', 'T04', 'T05', 'T06']) {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: who, pin: pins.get(who) }) });
    const ck = r.headers.get('set-cookie').split(';')[0];
    const c = await fetch(base + '/api/pin', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify({ pin: '135790' }) });
    if (r.status !== 200 || c.status !== 200) throw new Error('sign-in setup failed for ' + who);
    token.set(who, ck.split('=')[1]);
  }

  // ---- Chrome
  chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', '--user-data-dir=' + PROFILE, 'about:blank'], { stdio: 'ignore' });
  let dport = null;
  for (let i = 0; i < 150 && !dport; i++) { try { dport = Number(fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); } catch { await sleep(100); } }
  if (!dport) throw new Error('Chrome gave no DevTools port');
  const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
  const pageT = list.find((x) => x.type === 'page');
  ws = new WebSocket(pageT.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); if (d.error) p.rej(new Error(d.error.message)); else p.res(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}, ms = 30000) => new Promise((res, rej) => {
    const id = ++nextId;
    const t = setTimeout(() => { pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, ms);
    pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); } throw new Error('timed out waiting for ' + what); };
  const q = (sel) => JSON.stringify(sel);
  async function click(sel) {
    const box = await ev(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const t = document.elementFromPoint(x, y);
      return { x, y, w: r.width, hit: !!t && (t === e || e.contains(t)), top: t ? t.tagName + '#' + t.id : '' }; })()`);
    if (!box) throw new Error('no element ' + sel);
    if (!box.w || !box.hit) throw new Error(`not clickable ${sel} (covered by ${box.top})`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  async function type(sel, text) { await click(sel); await send('Input.insertText', { text }); }
  const setValue = (sel, v, evName) => ev(`(() => { const e = document.querySelector(${q(sel)}); e.value = ${q(v)}; e.dispatchEvent(new Event(${q(evName)}, { bubbles: true })); return e.value; })()`);
  // v1.6.6: the team and the viewers are a name field and a chip per person. offered() opens the list from script and
  // reads whether a person is in it; pick() clicks the field and then the name, both as real mouse events.
  const offered = (box, p) => ev(`(() => { const f = document.getElementById(${q(box + '-q')}); f.click();
    const on = !!document.getElementById(${q(box + '-o-' + p)});
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return on; })()`);
  const chipped = (box, p) => ev(`!!document.querySelector(${q('#' + box + '-chips [data-person="' + p + '"]')})`);
  async function pick(box, p) { await click('#' + box + '-q'); await waitFor(`!!document.getElementById(${q(box + '-o-' + p)})`, p + ' offered in ' + box); await click('#' + box + '-o-' + p); }
  const NAMES = { T03: 'Dewi Kartika', T04: 'Eko Saputro', T05: 'Fajar Nugroho', T06: 'Gita Maharani' };
  let loads = 0;
  // a new query string forces a real page load (a hash-only change keeps the page and its signed-in person)
  async function load(hash) { await send('Page.navigate', { url: `${base}/?load=${++loads}${hash}` }); }
  async function as(who, hash) {
    await send('Network.clearBrowserCookies');
    await send('Network.setCookie', { name: 'ob_sid', value: token.get(who), domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' });
    await load(hash);
    await waitFor(`!!document.getElementById('me-name') && document.getElementById('me-name').textContent === ${q(NAMES[who])}`, 'signed in as ' + who);
  }
  let WANT = 0;
  async function width(w) {
    WANT = w;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(200);
  }
  // measured on the app's own page: the page must be the device width first, then hold nothing wider
  async function overflow(name) {
    const m = await ev('[document.documentElement.clientWidth, document.documentElement.scrollWidth]');
    check(name, m[0] === WANT && m[1] <= m[0], `clientWidth ${m[0]}, scrollWidth ${m[1]}, want ${WANT}`);
  }
  const facts = () => ev(`Object.fromEntries([...document.querySelectorAll('#card-detail table.facts tr')].map((r) => [r.cells[0].textContent, r.cells[1].textContent]))`);
  async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); }

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');

  // ================= 390 px, Dewi asks Eko (PIC) with Gita on the team, private, Fajar picked
  await width(390);
  await as('T03', '#new');
  await waitFor(`!!document.getElementById('new-form')`, 'the new-task form');
  check('team field: the PIC (Dewi by default) is not offered', !(await offered('new-members', 'T03')) && await offered('new-members', 'T04'));
  check('viewer field hidden until Pribadi is ticked', await ev(`getComputedStyle(document.getElementById('new-viewers')).display === 'none'`));
  await setValue('#new-owner', 'T04', 'change');
  check('choosing Eko as PIC takes him out of the team field', !(await offered('new-members', 'T04')) && await offered('new-members', 'T03'));
  await pick('new-members', 'T06');
  await click('label[for="new-private"]');
  check('Pribadi shows the viewer field', await ev(`getComputedStyle(document.getElementById('new-viewers')).display !== 'none'`));
  await pick('new-viewers', 'T05');
  await type('#new-title', 'Laporan stok Nov');
  await setValue('#new-due', '2026-11-30', 'input');
  await overflow('form has no horizontal overflow at 390');
  await shot('390-new-form.png');
  await click('#new-submit');
  await waitFor(`document.getElementById('card-title') && document.getElementById('card-title').textContent === 'Laporan stok Nov'`, 'the new task panel');
  const parentId = await ev(`document.getElementById('card-detail').getAttribute('data-id')`);
  let f = await facts();
  check('panel: PIC is Eko', f['Pemilik (PIC)'] === 'Eko Saputro', JSON.stringify(f['Pemilik (PIC)']));
  check('panel: team is Gita', f['Tim'] === 'Gita Maharani', JSON.stringify(f['Tim']));
  check('panel: private, Fajar picked', /Pribadi/.test(f['Yang melihat'] || '') && /Fajar Nugroho/.test(f['Yang melihat'] || ''), JSON.stringify(f['Yang melihat']));
  check('panel: Ubah tim and Siapa yang melihat offered to the requester', await ev(`!!document.getElementById('d-team') && !!document.getElementById('d-viewers')`));
  check('panel: empty sub-task list says so', await ev(`/Belum ada sub-tugas/.test(document.getElementById('card-detail').textContent)`));

  // a sub-task from the panel: it opens on the parent, stays private and starts with the parent's picked people
  await click('#d-add-sub');
  await waitFor(`!!document.getElementById('new-parent')`, 'the sub-task form');
  check('sub-task form names its parent', await ev(`document.getElementById('new-parent').textContent`) === `Untuk tugas #${parentId}: Laporan stok Nov`);
  check('sub-task of a private task: Pribadi ticked and locked', await ev(`document.getElementById('new-private').checked && document.getElementById('new-private').disabled`));
  check('sub-task starts with the parent viewers picked', await chipped('new-viewers', 'T05') && await ev(`!document.getElementById('new-viewers').hidden`));
  await setValue('#new-owner', 'T05', 'change');
  await type('#new-title', 'Rekap kas');
  await setValue('#new-due', '2026-11-27', 'input');
  await click('#new-submit');
  await waitFor(`document.getElementById('card-title') && document.getElementById('card-title').textContent === 'Rekap kas'`, 'the sub-task panel');
  const subId = await ev(`document.getElementById('card-detail').getAttribute('data-id')`);
  check('sub-task panel links to its parent', (await ev(`document.getElementById('d-parent').textContent`)) === `#${parentId} Laporan stok Nov`);
  check('a sub-task offers no sub-task of its own', await ev(`!document.getElementById('d-add-sub') && !document.getElementById('subtasks')`));
  await click('#d-parent');
  await waitFor(`document.getElementById('card-title') && document.getElementById('card-title').textContent === 'Laporan stok Nov' && !!document.getElementById('subtasks')`, 'back on the parent');
  check('parent lists the sub-task with its count', await ev(`document.querySelectorAll('#subtasks li').length === 1 && /Rekap kas/.test(document.getElementById('subtasks').textContent) && /0 dari 1 sudah ditutup/.test(document.getElementById('subs-h').textContent)`));
  await overflow('parent panel has no horizontal overflow at 390');
  await shot('390-parent-panel.png');

  // ================= Gita (on the team) starts it from Papan Saya; she also sees the private sub-task
  await as('T06', '#my');
  await waitFor(`!!document.querySelector('article.card[data-id="${parentId}"]')`, "the shared task on Gita's Papan Saya");
  check("Gita's Papan Saya offers Mulai on the shared task", await ev(`!!document.querySelector('article.card[data-id="${parentId}"] .btn-start')`));
  await click(`article.card[data-id="${parentId}"] .btn-start`);
  await waitFor(`!!document.querySelector('article.card[data-id="${parentId}"][data-status="jalan"]')`, 'the task running');
  check('a member started the shared task', true);
  await click(`article.card[data-id="${parentId}"] .btn-block`);
  await waitFor(`!!document.getElementById('block-who-${parentId}')`, 'the Macet form');
  const waitOpts = await ev(`[...document.getElementById('block-who-${parentId}').options].map((o) => o.value)`);
  check('Macet: nobody on the team is offered as the one waited on', !waitOpts.includes('T04') && !waitOpts.includes('T06') && waitOpts.includes('T05'), waitOpts.join(','));
  await load('#office');
  await waitFor(`!!document.getElementById('office-body') && document.querySelectorAll('#office-body [data-id]').length > 0`, 'Papan Kantor');
  check('the parent team sees the private sub-task', await ev(`!!document.querySelector('#office-body [data-id="${subId}"]')`));

  // ================= 1280 px, Dewi's Papan Kantor shows the team and the sub-task mark
  await width(1280);
  await as('T03', '#office');
  await waitFor(`document.querySelectorAll('#office-body .tr[data-id]').length >= 2`, 'the office list');
  check('list: team after the PIC', (await ev(`document.querySelector('.tr[data-id="${parentId}"] .c-who > span:last-child').textContent`)) === 'Eko Saputro, Gita Maharani');
  check('list: the sub-task is marked', new RegExp(`Sub-tugas dari #${parentId}`).test(await ev(`document.querySelector('.tr[data-id="${subId}"] .c-task .sub').textContent`)));
  await overflow('list has no horizontal overflow at 1280');
  await shot('1280-office.png');
  await load('#card/' + parentId);
  await waitFor(`!!document.getElementById('d-viewers')`, 'the parent panel');
  await click('#d-viewers');
  check('Siapa yang melihat: PIC, team and requester are not offered', !(await offered('viewers-new', 'T03')) && !(await offered('viewers-new', 'T04')) &&
    !(await offered('viewers-new', 'T06')) && await chipped('viewers-new', 'T05'));
  await shot('1280-viewers-form.png');
  // ================= Eko is the PIC, not the requester: he changes the team but not the requester's place, nor who sees
  await as('T04', '#card/' + parentId);
  await waitFor(`!!document.getElementById('d-team')`, "Eko's panel");
  check('the PIC gets no Siapa yang melihat button', await ev(`!document.getElementById('d-viewers')`));
  await click('#d-team');
  check('Ubah tim as PIC: the requester and the PIC are not offered', !(await offered('team-new', 'T03')) && !(await offered('team-new', 'T04')) &&
    await offered('team-new', 'T05') && await chipped('team-new', 'T06'));
  check('no script error on any page', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('harness ran to the end', false, (e && e.stack) || String(e));
} finally {
  try { ws && ws.close(); } catch { /* closed */ }
  if (chrome) { chrome.kill(); await sleep(800); }
  if (server) { server.kill(); await sleep(300); }
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(DATA, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`checks ${results.length}, failed ${failed.length}`);
console.log('RESULT: ' + (results.length >= 20 && !failed.length ? 'PASS' : 'FAIL'));
process.exit(failed.length || results.length < 20 ? 1 : 0);
