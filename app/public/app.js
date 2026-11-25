// Office Board client. Vanilla JS, no build step, no secure-context APIs. All UI text comes from i18n.json;
// data text (names, titles) is always set with textContent.
'use strict';
(function () {
  var DICT = null, LANG = 'id', ME = null, PEOPLE = [], SETTINGS = {}, TODAY = '';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var TYPES = []; // FX17e: the list comes from the server (/api/me)
  var PENDING_MSG = null; // a refusal to show on the next card page (FX17i: create succeeded, an upload was refused)
  var ARMED = null; // the button whose click is sending the next write request (FX17i)
  var SOURCES = ['WhatsApp', 'Lisan', 'Rapat', 'Email', 'Lainnya'];
  // v1.2: a task (#card/<id>) and the new-task form (#new) open as a panel over the page they came from (LAST).
  // RENDERED is the page now in #view, so closing the panel does not reload it; OPENER gets the focus back.
  // PANEL_BACK: the panel was opened from a page in this tab, so closing it is a history.back() (no extra entry).
  // PAGE counts the pages drawn into #view; pageGet() drops an answer meant for a page the person has already left.
  var LAST = null, RENDERED = '', OPENER = null, OPENER_ID = '', PANEL_BACK = false, FOCUS_AFTER = '', layer = null, PAGE = 0;
  var OFFICE_START = { q: 'all', type: '', owner: '', text: '', page: 1 };
  var OFFICE = Object.assign({}, OFFICE_START); // Papan Kantor filters survive opening and closing a task
  var PAGE_SIZE = 10;
  var AVATAR_BG = ['#112D4E', '#2E5A88', '#3F72AF', '#4D6A92', '#1D4E7A', '#365F91'];
  var ANN_NEW = 0; // v1.7: posts by others since my last visit to Pengumuman (the count beside it in the menu)

  // v1.5: one language only (Indonesian, with the English words the office uses); no switch.

  function t(k) { var d = DICT && DICT[LANG]; return d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : k; }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'cls') el.className = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function api(method, url, body, extraHeaders) {
    var headers = {};
    var opts = { method: method, headers: headers, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    else if (body instanceof Blob) opts.body = body;
    if (extraHeaders) for (var k in extraHeaders) headers[k] = extraHeaders[k];
    // FX17i: the button that sent a write stays disabled until its answer is back, so a double tap sends once.
    var btn = method !== 'GET' ? ARMED : null;
    ARMED = null;
    if (btn) btn.disabled = true;
    var release = function () { if (btn && btn.getAttribute('data-hold') !== '1') btn.disabled = false; };
    var me = ME;
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = {}; }
        release();
        return { ok: r.ok, status: r.status, data: data };
      }, function () {
        // the connection dropped while the answer was arriving: the button must not stay disabled
        release();
        return { ok: false, status: 0, data: { error: 'network', message: t('err_network') } };
      });
    }, function () { release(); return { ok: false, status: 0, data: { error: 'network', message: t('err_network') } }; }).then(function (res) {
      // sent under a session that has since ended (a shared PC): its answer must not sign out or paint over the next person
      if (me && ME !== me) return new Promise(function () {});
      if (res.status === 401 && url !== '/api/login') { ME = null; showSignin(); }
      return res;
    });
  }
  // a page's own reads: an answer that arrives after the person moved to another page must not paint over it
  function pageGet(url) {
    var page = PAGE;
    return api('GET', url).then(function (r) { return page === PAGE ? r : new Promise(function () {}); });
  }

  // A refusal always shows the server's sentence in the page, next to what was tried.
  function showErr(slot, res) {
    clear(slot);
    var msg = (res && res.data && res.data.message) || t('err_network');
    slot.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': (res && res.data && res.data.error) || 'network', text: msg }));
  }
  function showOk(slot, text) { clear(slot); slot.appendChild(h('p', { cls: 'ok', role: 'status', text: text })); }

  function personName(id) {
    for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return PEOPLE[i].nick || PEOPLE[i].name;
    return id || '';
  }
  function fmtDate(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }
  function fmtTime(ms) {
    var d = new Date(ms + 8 * 3600 * 1000).toISOString();
    return fmtDate(d.slice(0, 10)) + ' ' + d.slice(11, 16);
  }
  // a dictionary sentence with {name} slots filled in
  function tf(k, vars) { return t(k).replace(/\{(\w+)\}/g, function (m, n) { return vars && vars[n] !== undefined ? String(vars[n]) : m; }); }
  function dayOf(ms) { return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10); } // Asia/Makassar date of a stamp
  function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  // working days (Monday to Saturday) after a, up to and including b; 0 when b is not after a. Same count as R5.
  function wdAfter(a, b) { var n = 0, x = utc(a), e = utc(b); while (x < e) { x += 86400000; if (new Date(x).getUTCDay() !== 0) n++; } return n; }
  function dueText(c) {
    // a task waiting for confirmation does not age (R5) and is judged at its proof (R4): no countdown for it
    if (!c.due || !TODAY || c.status === 'selesai' || c.status === 'batal' || c.status === 'bukti') return '';
    if (c.due === TODAY) return t('due_today');
    if (TODAY > c.due) { var late = wdAfter(c.due, TODAY); return late ? tf('due_late', { n: late }) : t('due_past'); } // 0: Saturday's due date seen on Sunday
    if (utc(c.due) - utc(TODAY) === 86400000) return t('due_tomorrow');
    return tf('due_in', { n: wdAfter(TODAY, c.due) });
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
  }
  function avatar(id, size) {
    var i = 0, name = id;
    for (; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) { name = PEOPLE[i].name; break; }
    if (i === PEOPLE.length && ME && ME.id === id) name = ME.name;
    var el = h('span', { cls: 'av' + (size ? ' av-' + size : ''), 'aria-hidden': 'true', text: initials(name) });
    el.style.background = AVATAR_BG[(i < PEOPLE.length ? i : 0) % AVATAR_BG.length];
    return el;
  }
  // FX13: a person who left is labelled wherever their open tasks show, so a director can reassign them
  function ownerLabel(id) {
    for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return personName(id) + (PEOPLE[i].active ? '' : ' ' + t('inactive_lane'));
    return personName(id);
  }
  // v1.6: a task's team is its PIC (owner) and its members; the PIC is named first
  function onTeam(c, id) { return c.owner === id || (c.members || []).indexOf(id) >= 0; }
  function teamLabel(c) { return [c.owner].concat(c.members || []).map(ownerLabel).join(', '); }
  function namesOf(ids) { return ids.length ? ids.map(ownerLabel).join(', ') : t('none_picked'); }
  // v1.6.6: a team, or the people who may see a private task: one name field and a chip per person picked. Typing,
  // or a click on the field, lists the people not picked yet; a click, a tap or Enter adds one and empties the field;
  // the x on a chip takes the person off. Someone who left is offered only if already chosen (the server keeps them
  // there). hide(ids) leaves out the people who always belong (the PIC, the requester, the directors) without
  // dropping them from `chosen`, so a pick comes back when the PIC changes again; picked() is what the chips show.
  // Text typed but not picked is cleared when the field loses focus: only the chips are sent.
  function peopleChecks(id, legendKey, chosen) {
    chosen = chosen.slice();
    var hidden = [], shown = [], active = -1, legendId = id + '-legend';
    var eligible = PEOPLE.filter(function (p) { return p.active || chosen.indexOf(p.id) >= 0; });
    var label = function (p) {
      return (p.nick ? p.name + ' (' + p.nick + ')' : p.name) + (p.active ? '' : ' ' + t('inactive_lane')) + (ME && p.id === ME.id ? ' ' + t('me_suffix') : '');
    };
    // the chips and what is sent follow the people list's order (as the ticks did), whatever order they were picked in
    var kept = function () { return eligible.filter(function (p) { return chosen.indexOf(p.id) >= 0 && hidden.indexOf(p.id) < 0; }); };
    var chips = h('div', { cls: 'pchips', id: id + '-chips' });
    var input = h('input', { id: id + '-q', type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
      'aria-controls': id + '-list', 'aria-labelledby': legendId, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      maxlength: '160', placeholder: t('add_person_ph') });
    var list = h('ul', { id: id + '-list', cls: 'name-list', role: 'listbox', 'aria-labelledby': legendId, hidden: true });
    var box = h('fieldset', { cls: 'ppick', id: id }, h('legend', { id: legendId, text: t(legendKey) }), chips, h('div', { cls: 'name-pick' }, input, list));
    var drawChips = function () {
      clear(chips);
      kept().forEach(function (p) {
        chips.appendChild(h('span', { cls: 'pchip', 'data-person': p.id }, h('span', { text: label(p) }),
          h('button', { type: 'button', cls: 'pchip-x', 'aria-label': tf('remove_person', { name: label(p) }), text: '×', onclick: function () {
            chosen.splice(chosen.indexOf(p.id), 1);
            drawChips();
            input.focus(); // the chip and its button are gone: the focus goes back to the field, not to the page
          } })));
      });
    };
    var mark = function () {
      Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('on', i === active); });
      if (active < 0) return input.removeAttribute('aria-activedescendant');
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    };
    var hideList = function () { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; mark(); };
    var showList = function () {
      var q = input.value.trim().toLowerCase();
      var left = eligible.filter(function (p) { return chosen.indexOf(p.id) < 0 && hidden.indexOf(p.id) < 0; });
      shown = left.filter(function (p) { return label(p).toLowerCase().indexOf(q) >= 0; });
      active = shown.length === 1 ? 0 : -1; // a sole match is marked, so Enter takes it
      clear(list);
      shown.forEach(function (p) {
        list.appendChild(h('li', { id: id + '-o-' + p.id, role: 'option', 'aria-selected': 'false', 'data-person': p.id, text: label(p), onclick: function () { add(p.id); } }));
      });
      if (!shown.length) list.appendChild(h('li', { cls: 'none', text: t(left.length ? 'no_name_match' : 'no_more_names') }));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      mark();
    };
    var add = function (pid) { chosen.push(pid); input.value = ''; drawChips(); hideList(); };
    input.addEventListener('input', showList);
    input.addEventListener('click', showList);
    input.addEventListener('blur', function () { input.value = ''; hideList(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (list.hidden) return showList();
        if (!shown.length) return;
        active = ev.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
        mark();
      } else if (ev.key === 'Enter') {
        ev.preventDefault(); // the field sits inside a form: Enter adds a person, it never creates or saves the task
        if (!list.hidden && active >= 0) add(shown[active].id);
      } else if (ev.key === 'Escape' && !list.hidden) {
        ev.stopPropagation(); // closes only the list; the panel around it closes on the next Escape
        hideList();
      }
    });
    // a press on the list must not take the focus from the field: blur would close the list before the click lands
    list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    box.hide = function (ids) { hidden = ids.slice(); drawChips(); if (!list.hidden) showList(); };
    box.picked = function () { return kept().map(function (p) { return p.id; }); };
    drawChips();
    return box;
  }
  // urgency is computed, never typed in (R5): Busuk, then Layu (legal deadline first), Macet, waiting for me, the rest
  function deco(c) {
    c.waitingYou = !!ME && ((c.status === 'tunggu' && c.waiting_on === ME.id) || (c.status === 'bukti' && c.requester === ME.id && !onTeam(c, ME.id)) ||
      (c.status === 'usul' && c.requester === ME.id)); // v1.6.8: a task waiting for my approval as its Pemberi
    c.rank = c.age === 'busuk' ? 0 : c.age === 'layu' ? (c.hard ? 1 : 2) : c.macet ? 3 : c.waitingYou ? 4 : c.status === 'bukti' ? 6 : 5;
    return c;
  }
  function byUrgency(a, b) { return a.rank - b.rank || (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id); }
  function quickOk(c, q) {
    if (q === 'att') return c.age === 'layu' || c.age === 'busuk' || !!c.macet;
    if (q === 'wait') return !!c.waitingYou;
    if (q === 'mine') return !!ME && onTeam(c, ME.id);
    if (q === 'hard') return !!c.hard;
    return true;
  }

  // ------------------------------------------------------------------ badges: colour + word + icon, never colour alone
  var CIRCLE = 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18';
  var ICONS = {
    segar: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c3-4 6-6 10-8',
    layu: CIRCLE + 'M12 7v5l3 2',
    busuk: 'M12 3l9.5 17h-19zM12 10v4.5M12 17.5h.01',
    macet: CIRCLE + 'M10 9v6M14 9v6',
    my: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6',
    office: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    req: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5',
    exc: 'M12 3l9.5 17h-19zM12 10v4.5M12 17.5h.01',
    'new': 'M12 5v14M5 12h14',
    menu: 'M4 7h16M4 12h16M4 17h16',
    review: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M9 15l2 2 4-4',
    routines: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
    people: 'M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.2 2.5 3.8 5.5',
    help: CIRCLE + 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01',
    todo: 'M4 4h16v16H4zM8 12l3 3 5-6',
    history: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5M12 8v4l3 2', // v1.6.7 Riwayat Tugas: a clock turning back
    lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
    list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    kanban: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z',
    timeline: 'M3 5h10M7 12h12M5 19h8',
    close: 'M6 6l12 12M18 6L6 18',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-3.5-3.5',
    ann: 'M3 10v4h3l6 4V6L6 10zM15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10', // v1.7 Pengumuman: a megaphone
    pin: 'M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8',
    file: 'M14 3H6v18h12V7zM14 3v4h4',
    bell: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10 20a2 2 0 0 0 4 0',
    // v1.7.1: the gear of the sidebar's Settings button (index.html), for Pengaturan on Orang & Pengaturan
    gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'
  };
  function icon(kind) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ic');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('d', Object.prototype.hasOwnProperty.call(ICONS, kind) ? ICONS[kind] : ICONS.macet);
    s.appendChild(p);
    return s;
  }
  function ageBadge(age) {
    if (!age) return null;
    return h('span', { cls: 'badge age-' + age, 'data-age': age }, icon(age), h('span', { text: t('age_' + age) }));
  }
  function macetBadge() { return h('span', { cls: 'badge macet', 'data-macet': '1' }, icon('macet'), h('span', { text: t('macet') })); }
  function statusBadge(st) { return h('span', { cls: 'badge status', 'data-status': st, text: t('st_' + st) }); }

  // ------------------------------------------------------------------ layout chrome
  function setChrome() {
    document.documentElement.lang = LANG;
    document.title = t('app_name');
    document.getElementById('app-name').textContent = t('app_name');
    var lo = document.getElementById('logout-btn');
    lo.textContent = t('logout'); lo.hidden = !ME;
    document.getElementById('me-name').textContent = ME ? (ME.nick || ME.name) : '';
    var av = document.getElementById('me-avatar');
    clear(av);
    if (ME) av.appendChild(avatar(ME.id));
    document.getElementById('today-line').textContent = ME && TODAY && !ME.must_change_pin ? tf('today_is', { d: fmtDate(TODAY) }) : '';
    var sb = document.getElementById('settings-btn'); // v1.3: Ganti PIN opens from here, beside the name
    sb.setAttribute('aria-label', t('my_settings')); sb.title = t('my_settings');
    var nav = document.getElementById('nav'), more = document.getElementById('nav-more');
    clear(nav);
    clear(more);
    nav.setAttribute('aria-label', t('menu_label'));
    more.setAttribute('aria-label', t('nav_menu'));
    nav.hidden = more.hidden = !ME || !!ME.must_change_pin;
    document.body.classList.toggle('signed-out', nav.hidden); // sign-in and the first PIN change: a card, no sidebar
    if (!ME) { dropLayer(); return; }
    if (ME.must_change_pin) return;
    // FX5: a director's first tab is Pengecualian (his home); Permintaan Saya moves into Lainnya for him.
    // v1.2: the same five buttons, in the same order, are the bottom bar on a phone and the sidebar on a desktop.
    var dir = ME.role === 'direktur';
    var tabs = dir ? [['exc', 'exc'], ['office', 'nav_office'], ['my', 'nav_my'], ['new', 'nav_new'], ['menu', 'nav_menu']]
      : [['my', 'nav_my'], ['office', 'nav_office'], ['req', 'nav_req'], ['new', 'nav_new'], ['menu', 'nav_menu']];
    var inTabs = tabs.map(function (x) { return x[0]; });
    var cur = currentRoute().name;
    if (cur === 'card') cur = LAST ? LAST.name : home(); // a task's panel lights the page under it
    nav.appendChild(h('p', { cls: 'nav-label', text: t('grp_work') }));
    tabs.forEach(function (tb) {
      var on = cur === tb[0] || (tb[0] === 'menu' && inTabs.indexOf(cur) < 0);
      nav.appendChild(h('button', { type: 'button', id: 'nav-' + tb[0], cls: on ? 'on' : '', 'aria-current': on ? 'page' : null, onclick: function () { go(tb[0]); } },
        icon(tb[0]), h('span', { text: t(tb[1]) }), tb[0] === 'menu' ? annBadge(ANN_NEW) : null));
    });
    // v1.2: on a desktop the Lainnya destinations are listed in the sidebar (the phone keeps the Lainnya page)
    more.appendChild(h('p', { cls: 'nav-label', text: t('nav_menu') }));
    moreItems().forEach(function (it) {
      var on = cur === it[0];
      more.appendChild(h('button', { type: 'button', id: 'more-' + it[0], cls: on ? 'on' : '', 'aria-current': on ? 'page' : null, onclick: function () { go(it[0]); } },
        icon(it[0]), h('span', { text: t(it[1]) }), it[0] === 'ann' ? annBadge(ANN_NEW) : null));
    });
  }
  // v1.7: the count of new posts beside Pengumuman (sidebar, Lainnya page) and on the phone's Lainnya button
  function annBadge(n) { return n > 0 ? h('span', { cls: 'nav-n' }, String(n), h('span', { cls: 'vh', text: ' ' + t('ann_count_label') })) : null; }
  function annCount(n) { // drawn again in place: rebuilding the menu would take the focus from a button in it
    ANN_NEW = n;
    ['more-ann', 'nav-menu', 'menu-ann'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      var old = b.querySelector('.nav-n');
      if (old) b.removeChild(old);
      var c = annBadge(n);
      if (c) b.appendChild(c);
    });
  }
  function moreItems() {
    var dir = ME.role === 'direktur', items = [];
    items.push(['todo', 'todo']); // v1.3: everyone's own to-do list, first in Lainnya
    items.push(['ann', 'ann']); // v1.7: Pengumuman, for everyone
    items.push(['history', 'history']); // v1.6.7: the closed tasks this person received
    if (dir) items.push(['req', 'nav_req']); // FX5: Pengecualian is a director's first tab; his requests live here
    if (dir || ME.keeper === 1) items.push(['review', 'review']);
    if (dir) { items.push(['routines', 'routines']); items.push(['people', 'people']); }
    items.push(['help', 'help']);
    return items;
  }

  function currentRoute() {
    var hs = (location.hash || '').replace(/^#/, '');
    var parts = hs.split('/');
    var name = parts[0];
    // FX17f: own keys only (#constructor, #__proto__, #toString open the landing page); FX5: a director lands on exc
    if (!name || !Object.prototype.hasOwnProperty.call(ROUTES, name)) name = home();
    return { name: name, arg: parts[1] || '' };
  }
  function home() { return ME && ME.role === 'direktur' ? 'exc' : 'my'; }
  function go(name, arg) {
    var target = '#' + name + (arg ? '/' + arg : '');
    if (location.hash === target) render(); else location.hash = target;
  }

  var view;
  // keep = true for a navigation (hashchange): the page under a panel is not reloaded when it is already on screen.
  // Every other caller (an action, a language switch) reloads it, so it shows what the server now says.
  function render(keep) {
    var active = document.activeElement; // read before setChrome() rebuilds the nav buttons
    setChrome();
    if (!ME) return showSignin();
    if (ME.must_change_pin) return showChangePin();
    var r = currentRoute();
    var panel = r.name === 'card' || r.name === 'new';
    var base = panel ? (LAST || { name: home(), arg: '' }) : r;
    var fresh = !(keep && base.name + '/' + base.arg === RENDERED);
    var hadPanel = !!layer.firstChild;
    if (panel && !hadPanel) {
      OPENER = active && active !== document.body ? active : null;
      OPENER_ID = OPENER && OPENER.id ? OPENER.id : '';
      PANEL_BACK = !!keep && !!LAST;
    }
    // FX17i: the panel being reloaded after an action must not take a second tap while the new one loads
    if (panel && hadPanel) Array.prototype.forEach.call(layer.querySelectorAll('button, input, select, textarea'), function (el) { el.disabled = true; });
    if (!panel) { LAST = r; PANEL_BACK = false; }
    if (!panel && hadPanel) { clear(layer); document.getElementById('shell').removeAttribute('inert'); }
    if (fresh) {
      PAGE++;
      clear(view);
      RENDERED = base.name + '/' + base.arg;
      ROUTES[base.name](base.arg);
      if (!panel) window.scrollTo(0, 0);
    }
    if (panel) { ROUTES[r.name](r.arg); return; }
    if (hadPanel) { // inert is lifted above, before the focus moves back
      var o = OPENER;
      if (o && !o.isConnected && OPENER_ID) o = document.getElementById(OPENER_ID); // a rebuilt nav button
      OPENER = null;
      if (o && o.isConnected) o.focus(); else view.focus();
    }
  }
  function dropLayer() {
    if (layer) clear(layer);
    document.getElementById('shell').removeAttribute('inert');
    OPENER = null;
  }
  // The slide-over panel. The page under it is inert; Escape or the close button go back to that page.
  // keepOnScrim: a click beside the panel does not close it (the new-task form would lose what was typed)
  function openDrawer(id, labelId, headBits, keepOnScrim) {
    clear(layer);
    var close = h('button', { type: 'button', id: 'drawer-close', cls: 'icon-btn secondary', 'aria-label': t('close_panel'), onclick: closeDrawer }, icon('close'));
    var body = h('div', { cls: 'dr-body' });
    // tabindex -1: a click on plain text inside keeps the focus in the panel, so Escape still reaches it
    var panel = h('aside', { cls: 'drawer', id: id, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelId, tabindex: '-1',
      onkeydown: function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); } } },
      h('div', { cls: 'dr-head' }, headBits, close), body);
    layer.appendChild(h('div', { cls: 'scrim', 'aria-hidden': 'true', onclick: keepOnScrim ? null : closeDrawer }));
    layer.appendChild(panel);
    document.getElementById('shell').setAttribute('inert', '');
    close.focus();
    return { panel: panel, body: body };
  }
  function closeDrawer() {
    if (PANEL_BACK) { history.back(); return; } // Back after a close must not reopen the task
    var b = LAST || { name: home(), arg: '' };
    location.replace('#' + b.name + (b.arg ? '/' + b.arg : ''));
  }

  // ------------------------------------------------------------------ sign-in
  // v1.2: one card in the middle of the page (no sidebar while signed out): the name from a list, then the PIN.
  function showSignin() {
    ME = null;
    LAST = null;
    RENDERED = '';
    OFFICE = Object.assign({}, OFFICE_START);
    setChrome();
    clear(view);
    var msg = h('div', { cls: 'msg' });
    // v1.6.5: ONE name field. Typing opens a list of the names (or nicknames) that contain the text; a click, a tap or
    // Enter picks one and fills in the full name; a click on the empty field lists everyone. The person sent is kept
    // apart from the text (`chosen`) and is set only by a pick or by a full name typed out, and any keystroke that
    // changes the text drops it, so the name in the field is always the one signed in.
    var who = h('input', { id: 'login-name', type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
      'aria-controls': 'login-names', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '160', placeholder: t('pick_name') });
    var list = h('ul', { id: 'login-names', cls: 'name-list', role: 'listbox', 'aria-label': t('name_label'), hidden: true });
    var pin = h('input', { id: 'login-pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '12' });
    var all = [], shown = [], chosen = '', active = -1;
    var mark = function () {
      Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('on', i === active); });
      if (active < 0) return who.removeAttribute('aria-activedescendant');
      who.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    };
    var hideList = function () { list.hidden = true; who.setAttribute('aria-expanded', 'false'); active = -1; mark(); };
    var showList = function () {
      var q = who.value.trim().toLowerCase();
      shown = all.filter(function (p) { return p.text.toLowerCase().indexOf(q) >= 0; });
      active = shown.length === 1 ? 0 : -1; // a sole match is marked, so Enter takes it
      clear(list);
      shown.forEach(function (p) {
        list.appendChild(h('li', { id: 'lo-' + p.id, role: 'option', 'aria-selected': p.id === chosen ? 'true' : 'false', text: p.text, onclick: function () { pick(p); } }));
      });
      if (!shown.length) list.appendChild(h('li', { cls: 'none', text: t('no_name_match') }));
      list.hidden = false;
      who.setAttribute('aria-expanded', 'true');
      mark();
    };
    var pick = function (p) { chosen = p.id; who.value = p.text; hideList(); pin.focus(); };
    var typed = function () {
      var q = who.value.trim().toLowerCase();
      var full = all.filter(function (p) { return p.text.toLowerCase() === q; });
      chosen = full.length === 1 ? full[0].id : '';
      showList();
    };
    who.addEventListener('input', typed);
    who.addEventListener('click', showList);
    who.addEventListener('blur', hideList);
    who.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (list.hidden) return showList();
        if (!shown.length) return;
        active = ev.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
        mark();
      } else if (ev.key === 'Enter') {
        ev.preventDefault(); // Enter here never sends the form: it picks, or moves on to the PIN
        if (!list.hidden && active >= 0) pick(shown[active]);
        else if (chosen) pin.focus();
      } else if (ev.key === 'Escape') hideList();
    });
    // a press on the list must not take the focus from the field: blur would close the list before the click lands
    list.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    // a missing name or PIN is said here, in the page's language, and costs no sign-in attempt
    var missing = function (code, key, field) {
      clear(msg);
      msg.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': code, text: t(key) }));
      field.focus();
    };
    var form = h('form', { id: 'login-form', onsubmit: function (ev) {
      ev.preventDefault();
      if (!chosen) return missing('client_no_name', 'login_need_name', who);
      if (!pin.value) return missing('client_no_pin', 'login_need_pin', pin);
      api('POST', '/api/login', { id: chosen, pin: pin.value }).then(function (r) {
        if (!r.ok) return showErr(msg, r);
        boot();
      });
    } },
      h('label', { for: 'login-name', text: t('name_label') }), h('div', { cls: 'name-pick' }, who, list),
      h('label', { for: 'login-pin', text: t('pin') }), pin,
      h('button', { type: 'submit', id: 'login-btn', text: t('signin_btn') }),
      msg);
    view.appendChild(h('section', { cls: 'signin-card', id: 'signin', 'aria-labelledby': 'signin-h' },
      h('div', { cls: 'signin-brand' }, document.querySelector('#side .brand-mark').cloneNode(true), h('strong', { text: t('app_name') }), cardTools()),
      h('h1', { id: 'signin-h', text: t('signin_title') }),
      h('p', { cls: 'muted', text: t('framing') }),
      form));
    api('GET', '/api/people-public').then(function (res) {
      all = (res.data.people || []).map(function (p) { return { id: p.id, text: p.nick ? p.name + ' (' + p.nick + ')' : p.name }; });
      if (who.value && document.activeElement === who) typed(); // something was typed before the names arrived
    });
    who.focus(); // the list stays closed until the field is clicked or typed in, so it never covers the PIN on load
  }

  // v1.3: the sidebar (with the sign-out button) is hidden while signed out, so the first PIN change carries its own
  function cardTools() {
    return h('div', { cls: 'card-tools' },
      ME ? h('button', { type: 'button', id: 'card-logout', cls: 'small secondary', text: t('logout'), onclick: signOut }) : null);
  }
  function signOut() {
    api('POST', '/api/logout', {}).then(function () { ME = null; location.hash = ''; showSignin(); });
  }

  // the first PIN change (forced) is a page of its own; a later one opens in the Settings dialog
  function showChangePin() {
    setChrome();
    dropLayer();
    RENDERED = '';
    clear(view);
    view.appendChild(pinForm(true));
  }
  // v1.3: Settings beside the name opens this dialog over the page (no route of its own). It lives in #layer, so
  // dropLayer() (sign-out, a 401) takes it away, and it removes itself on close, so render() never takes it for a task panel.
  function openSettings() {
    var dlg = h('dialog', { id: 'settings-dlg', cls: 'dlg', 'aria-labelledby': 'settings-h', onclose: function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'settings-h', cls: 'dr-title', text: t('my_settings') }),
        h('button', { type: 'button', id: 'settings-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' }, pinForm(false),
        h('div', { cls: 'row dlg-out' }, h('button', { type: 'button', id: 'settings-logout', cls: 'secondary', text: t('logout'), onclick: signOut }))));
    layer.appendChild(dlg);
    dlg.showModal();
    document.getElementById('old-pin').focus();
  }
  function pinForm(forced) {
    var msg = h('div', { cls: 'msg' });
    var old = forced ? null : h('input', { id: 'old-pin', type: 'password', inputmode: 'numeric', maxlength: '12' });
    var p1 = h('input', { id: 'new-pin', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' });
    var p2 = h('input', { id: 'new-pin2', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' });
    var form = h('form', { id: 'pin-form', cls: forced ? 'signin-card' : null, onsubmit: function (ev) {
      ev.preventDefault();
      if (p1.value !== p2.value) { clear(msg); msg.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': 'client_mismatch', text: t('pin_mismatch') })); return; }
      var body = { pin: p1.value };
      if (old) body.old = old.value;
      api('POST', '/api/pin', body).then(function (r) {
        if (!r.ok) return showErr(msg, r);
        if (forced) boot(); else { form.reset(); showOk(msg, t('pin_changed')); }
      });
    } },
      forced ? cardTools() : null,
      forced ? h('h1', { text: t('change_pin_title') }) : h('h2', { text: t('my_pin') }),
      forced ? h('p', { text: t('change_pin_help') }) : null,
      old ? h('label', { for: 'old-pin', text: t('old_pin') }) : null, old,
      h('label', { for: 'new-pin', text: t('new_pin') }), p1,
      h('label', { for: 'new-pin2', text: t('new_pin2') }), p2,
      h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'pin-save', text: t('save_pin') })),
      msg);
    return form;
  }

  function boot() {
    return api('GET', '/api/session').then(function (s) {
      if (!s.ok || !s.data.signed_in) { ME = null; return showSignin(); }
      return loadMe();
    });
  }
  function loadMe() {
    return api('GET', '/api/me').then(function (r) {
      if (!r.ok) { ME = null; return showSignin(); }
      ME = r.data.me;
      if (!ME.must_change_pin) { PEOPLE = r.data.people; SETTINGS = r.data.settings; TODAY = r.data.today; TYPES = r.data.types || []; ANN_NEW = r.data.ann_new || 0; }
      render();
    });
  }
  function refreshMe() {
    return api('GET', '/api/me').then(function (r) { if (r.ok && r.data.people) { PEOPLE = r.data.people; SETTINGS = r.data.settings; TODAY = r.data.today; TYPES = r.data.types || []; annCount(r.data.ann_new || 0); } });
  }

  // ------------------------------------------------------------------ card list items
  function act(cardId, action, body, slot, after) {
    return api('POST', '/api/cards/' + cardId + '/' + action, body || {}).then(function (r) {
      if (!r.ok) { showErr(slot, r); return r; }
      if (after) after(r); else render();
      return r;
    });
  }

  function peopleSelect(id, exclude, withChoose) { // exclude: one id or a list (v1.6: a task's whole team)
    var sel = h('select', { id: id });
    var out = [].concat(exclude || []);
    if (withChoose) sel.appendChild(h('option', { value: '', text: t('choose') }));
    PEOPLE.filter(function (p) { return p.active && out.indexOf(p.id) < 0; }).forEach(function (p) {
      sel.appendChild(h('option', { value: p.id, text: (p.nick ? p.name + ' (' + p.nick + ')' : p.name) + (ME && p.id === ME.id ? ' ' + t('me_suffix') : '') }));
    });
    return sel;
  }

  function blockForm(c, slot, wrap) {
    var sel = peopleSelect('block-who-' + c.id, [c.owner].concat(c.members || []), true); // never someone on the team
    sel.className = 'block-who';
    var note = h('input', { cls: 'block-note', id: 'block-note-' + c.id, type: 'text', maxlength: '500' });
    var f = h('form', { cls: 'inline-form block-form', onsubmit: function (ev) {
      ev.preventDefault();
      act(c.id, 'block', { waiting_on: sel.value, note: note.value }, slot);
    } },
      h('label', { for: sel.id, text: t('f_waiting_on') }), sel,
      h('label', { for: note.id, text: t('f_note') }), note,
      h('div', { cls: 'row' }, h('button', { type: 'submit', cls: 'block-send', text: t('btn_send') })));
    wrap.appendChild(f);
    sel.focus();
  }

  // v1.6.8: turn down (the Pemberi, a director) or take back (the Penerima) a task waiting for approval, with a reason
  function rejectForm(c, slot, wrap, labelKey) {
    clear(wrap);
    var reason = h('input', { cls: 'reject-reason', id: 'reject-reason-' + c.id, type: 'text', maxlength: '1000' });
    wrap.appendChild(h('form', { cls: 'inline-form reject-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'reject', { reason: reason.value }, slot); } },
      h('label', { for: reason.id, text: t('f_reason') }), reason, h('button', { type: 'submit', cls: 'danger reject-send', text: t(labelKey) })));
    reason.focus();
  }

  function overrideRetry(c, action, slot, labelKey) {
    if (!ME || ME.role !== 'direktur') return;
    var reason = h('input', { cls: 'override-reason', id: 'override-' + c.id, type: 'text', maxlength: '1000' });
    var f = h('form', { cls: 'inline-form override-form', onsubmit: function (ev) {
      ev.preventDefault(); act(c.id, action, { reason: reason.value }, slot);
    } }, h('label', { for: reason.id, text: t('f_override') }), reason, h('button', { type: 'submit', cls: 'override-send', text: t(labelKey) }));
    slot.appendChild(f);
  }

  function cardItem(c, opts) {
    opts = opts || {};
    deco(c);
    var el = h('article', { cls: 'card' + (c.age ? ' age-' + c.age : ''), 'data-id': String(c.id), 'data-status': c.status });
    el.appendChild(h('div', { cls: 'card-top' },
      h('span', { cls: 'tag', text: t('type_' + c.type) }), opts.noId ? null : h('span', { cls: 'tid', text: '#' + c.id }),
      h('span', { cls: 'flags' },
        c.waitingYou ? h('span', { cls: 'flag you', text: t('exc_waiting') }) : null,
        c.hard ? h('span', { cls: 'flag', text: t('lbl_hard') }) : null,
        c.routine_key ? h('span', { cls: 'flag', text: t('lbl_routine') }) : null,
        c.private ? h('span', { cls: 'flag' }, icon('lock'), h('span', { text: t('lbl_private') })) : null,
        c.parent ? h('span', { cls: 'flag', text: tf(opts.noId ? 'lbl_sub_of_title' : 'lbl_sub_of', { id: c.parent, t: c.parent_title }) }) : null)));
    var title = h('button', { type: 'button', cls: 'title', text: c.title, onclick: function () { go('card', String(c.id)); } });
    el.appendChild(title);
    var due = dueText(c);
    var meta = h('div', { cls: 'meta' },
      ageBadge(c.age), c.macet ? macetBadge() : null, statusBadge(c.status),
      h('span', { cls: 'due', text: t('lbl_due') + ': ' + fmtDate(c.due) + (due ? ' · ' + due : '') }),
      opts.closed && c.closed_at ? h('span', { cls: 'closed-at', text: t('lbl_closed') + ': ' + fmtTime(c.closed_at).slice(0, 10) }) : null, // office day
      c.status === 'tunggu' && c.waiting_on ? h('span', { text: t('lbl_waiting_on') + ': ' + personName(c.waiting_on) }) : null,
      c.status === 'bukti' && c.macet ? h('span', { cls: 'waiting-confirm', text: t('waiting_confirm') + ': ' + personName(c.requester) }) : null);
    el.appendChild(meta);
    var who = h('div', { cls: 'card-foot' },
      opts.showOwner !== false ? h('span', { cls: 'who' }, avatar(c.owner, 'sm'), h('span', { text: teamLabel(c) })) : null,
      opts.showOwner === false && (c.members || []).length ? h('span', { cls: 'team', text: t('lbl_team') + ': ' + teamLabel(c) }) : null,
      opts.showRequester && c.requester !== c.owner ? h('span', { text: tf('from_req', { name: personName(c.requester) }) }) : null);
    if (who.firstChild) el.appendChild(who);
    var acts = h('div', { cls: 'acts' });
    var slot = h('div', { cls: 'msg' });
    var extra = h('div', { cls: 'extra' });
    var mine = ME && (onTeam(c, ME.id) || ME.role === 'direktur');
    if (opts.quick && mine) {
      if (c.status === 'antri') acts.appendChild(h('button', { type: 'button', cls: 'btn-start', text: t('btn_start'), onclick: function () {
        act(c.id, 'start', {}, slot).then(function (r) { if (!r.ok && /^limit_active/.test(r.data.error)) overrideRetry(c, 'start', slot, 'btn_start_override'); });
      } }));
      if (c.status === 'jalan') {
        acts.appendChild(h('button', { type: 'button', cls: 'btn-block secondary', text: t('btn_block'), onclick: function () { clear(extra); blockForm(c, slot, extra); } }));
        // proof is sent from the task panel, where the evidence is attached (Kirim bukti lives there)
        acts.appendChild(h('button', { type: 'button', cls: 'btn-open', text: t('btn_open'), onclick: function () { go('card', String(c.id)); } }));
      }
      if (c.status === 'tunggu') acts.appendChild(h('button', { type: 'button', cls: 'btn-unblock secondary', text: t('btn_unblock'), onclick: function () {
        act(c.id, 'unblock', {}, slot).then(function (r) { if (!r.ok && /^limit_active/.test(r.data.error)) overrideRetry(c, 'unblock', slot, 'btn_unblock_override'); });
      } }));
    }
    var ownProof = ME && onTeam(c, ME.id) && !onTeam(c, c.requester); // FX1: never judge your own (team's) proof
    if (opts.confirm && c.status === 'bukti' && ME && !ownProof && (c.requester === ME.id || ME.role === 'direktur')) {
      acts.appendChild(h('button', { type: 'button', cls: 'btn-accept', text: t('btn_accept'), onclick: function () { act(c.id, 'accept', {}, slot); } }));
      acts.appendChild(h('button', { type: 'button', cls: 'btn-return secondary', text: t('btn_return'), onclick: function () {
        clear(extra);
        var reason = h('input', { cls: 'return-reason', id: 'return-reason-' + c.id, type: 'text', maxlength: '1000' });
        extra.appendChild(h('form', { cls: 'inline-form return-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'return', { reason: reason.value }, slot); } },
          h('label', { for: reason.id, text: t('f_reason') }), reason,
          h('button', { type: 'submit', cls: 'return-send', text: t('btn_send') })));
        reason.focus();
      } }));
    }
    // v1.6.8: a task a Penerima added, waiting for my approval as its Pemberi
    if (opts.confirm && c.status === 'usul' && ME && c.requester === ME.id) {
      acts.appendChild(h('button', { type: 'button', cls: 'btn-approve', text: t('btn_approve'), onclick: function () { act(c.id, 'approve', {}, slot); } }));
      acts.appendChild(h('button', { type: 'button', cls: 'btn-reject secondary', text: t('btn_reject'), onclick: function () { rejectForm(c, slot, extra, 'btn_reject'); } }));
    }
    if (acts.firstChild) el.appendChild(acts);
    el.appendChild(extra);
    el.appendChild(slot);
    return el;
  }

  function cardList(cards, opts) {
    var box = h('div', { cls: 'cards' + (opts && opts.wide ? ' wide' : '') });
    if (!cards.length) box.appendChild(h('p', { cls: 'muted empty', text: t('no_cards') }));
    cards.forEach(function (c) { box.appendChild(cardItem(c, opts)); });
    return box;
  }

  function legend() {
    return h('div', { cls: 'legend', 'aria-label': t('legend') }, ageBadge('segar'), ageBadge('layu'), ageBadge('busuk'), macetBadge());
  }

  function loading() { view.appendChild(h('p', { cls: 'muted', text: t('loading') })); }

  // n of max tasks in progress, as segments (the words next to it say the same)
  function meter(n, max) {
    var m = h('div', { cls: 'meter' + (n >= max ? ' full' : ''), 'aria-hidden': 'true' });
    for (var i = 0; i < max; i++) m.appendChild(h('i', { cls: i < n ? 'on' : '' }));
    return m;
  }
  // Catat > Sanggupi > Kerjakan > Buktikan > Selesai, with the current stage marked
  function stepsBar(status) {
    var keys = ['step_catat', 'step_sanggupi', 'step_kerjakan', 'step_buktikan', 'st_selesai'];
    var cur = status === 'usul' ? 0 : status === 'antri' ? 1 : status === 'jalan' || status === 'tunggu' ? 2 : status === 'bukti' ? 3 : status === 'selesai' ? 5 : -1;
    var ol = h('ol', { cls: 'steps', 'aria-label': t('steps_label') });
    keys.forEach(function (k, i) {
      ol.appendChild(h('li', { cls: i < cur ? 'done' : i === cur ? 'cur' : '', 'aria-current': i === cur ? 'step' : null }, h('i', {}), h('span', { text: t(k) })));
    });
    return ol;
  }

  // ------------------------------------------------------------------ screens
  var ROUTES = {};
  ROUTES.my = function () {
    view.appendChild(h('h1', { text: t('nav_my') }));
    loading();
    pageGet('/api/cards?view=my').then(function (r) {
      if (!ME) return; // the session ended: api() has shown the sign-in page
      newDay(r);
      clear(view);
      view.appendChild(h('h1', { text: t('nav_my') }));
      view.appendChild(annStrip());
      if (!r.ok) return showErr(view, r);
      var cards = r.data.cards;
      var by = function (st) { return cards.filter(function (c) { return c.status === st; }); };
      var jalan = by('jalan');
      view.appendChild(h('h2', { id: 'sec-jalan', text: t('st_jalan') + ' ' + jalan.length + '/' + SETTINGS.maxActive }));
      view.appendChild(meter(jalan.length, SETTINGS.maxActive));
      view.appendChild(cardList(jalan, { quick: true, showOwner: false, showRequester: true, noId: true }));
      view.appendChild(h('h2', { id: 'sec-antri', text: t('st_antri') }));
      view.appendChild(cardList(by('antri'), { quick: true, showOwner: false, showRequester: true, noId: true }));
      view.appendChild(h('h2', { id: 'sec-tunggu', text: t('st_tunggu') }));
      view.appendChild(cardList(by('tunggu'), { quick: true, showOwner: false, showRequester: true, noId: true }));
      view.appendChild(h('h2', { id: 'sec-bukti', text: t('st_bukti') }));
      view.appendChild(cardList(by('bukti'), { showOwner: false, showRequester: true, noId: true }));
      // v1.6.8: the tasks I added myself, waiting for their Pemberi's approval (shown only when there are some)
      var usul = by('usul');
      if (usul.length) {
        view.appendChild(h('h2', { id: 'sec-usul', text: t('st_usul') }));
        view.appendChild(cardList(usul, { showOwner: false, showRequester: true, noId: true }));
      }
    });
  };

  // v1.2: Papan Kantor is one list of every open task the viewer may see, shown three ways: Daftar (default, paged),
  // Kanban (a column per status) and Timeline (working days). The view is in the address (#office/kanban).
  ROUTES.office = function (arg) {
    var mode = arg === 'kanban' || arg === 'timeline' ? arg : 'list';
    view.appendChild(h('h1', { text: t('nav_office') }));
    pageGet('/api/cards?view=office').then(function (r) {
      if (!ME) return; // the session ended: api() has shown the sign-in page
      if (!r.ok) return showErr(view, r);
      newDay(r);
      var all = r.data.cards.map(deco);
      var seg = h('div', { cls: 'seg', role: 'group', 'aria-label': t('view_label') });
      [['list', 'view_list'], ['kanban', 'view_kanban'], ['timeline', 'view_timeline']].forEach(function (v) {
        seg.appendChild(h('button', { type: 'button', id: 'view-' + v[0], 'aria-pressed': mode === v[0] ? 'true' : 'false',
          onclick: function () { FOCUS_AFTER = 'view-' + v[0]; go('office', v[0] === 'list' ? '' : v[0]); } }, icon(v[0]), h('span', { text: t(v[1]) })));
      });
      var chips = h('div', { cls: 'chips', role: 'group', 'aria-label': t('q_label') });
      var typeSel = h('select', { id: 'f-type' }, h('option', { value: '', text: t('all_types') }));
      TYPES.forEach(function (x) { typeSel.appendChild(h('option', { value: x, text: t('type_' + x) })); });
      typeSel.value = OFFICE.type;
      OFFICE.type = typeSel.value; // a value no longer offered falls back to "all", and so does the filter
      // FX13: people who left keep their open tasks findable
      var ownerSel = h('select', { id: 'f-owner' }, h('option', { value: '', text: t('all_people') }));
      PEOPLE.filter(function (p) { return p.active || all.some(function (c) { return c.owner === p.id; }); }).forEach(function (p) {
        ownerSel.appendChild(h('option', { value: p.id, text: (p.nick || p.name) + (p.active ? '' : ' ' + t('inactive_lane')) }));
      });
      ownerSel.value = OFFICE.owner;
      OFFICE.owner = ownerSel.value; // e.g. a person who left and no longer owns an open task
      var search = h('input', { id: 'f-q', type: 'search', maxlength: '100', placeholder: t('search_ph') });
      search.value = OFFICE.text;
      var count = h('p', { id: 'office-count', cls: 'muted' });
      var body = h('div', { id: 'office-body' });
      var clearBtn = h('button', { type: 'button', id: 'f-clear', cls: 'secondary', text: t('clear_filters'), onclick: function () {
        OFFICE = Object.assign({}, OFFICE_START);
        typeSel.value = ''; ownerSel.value = ''; search.value = '';
        paint();
        search.focus();
      } });
      var refilter = function () { OFFICE.page = 1; paint(); }; // any filter change starts again at page 1
      typeSel.addEventListener('change', function () { OFFICE.type = typeSel.value; refilter(); });
      ownerSel.addEventListener('change', function () { OFFICE.owner = ownerSel.value; refilter(); });
      search.addEventListener('input', function () { OFFICE.text = search.value; refilter(); });
      view.appendChild(h('section', { id: 'office-view', 'data-view': mode },
        h('div', { cls: 'toolbar' }, seg, chips,
          h('div', { cls: 'fields' },
            h('label', { cls: 'fld', for: 'f-type' }, h('span', { text: t('f_type') }), typeSel),
            h('label', { cls: 'fld', for: 'f-owner' }, h('span', { text: t('lbl_people') }), ownerSel),
            h('label', { cls: 'fld fld-search', for: 'f-q' }, h('span', { cls: 'vh', text: t('f_search') }), icon('search'), search),
            clearBtn)),
        count, body, mode === 'list' ? null : legend())); // the list's Urgensi column already names each colour

      function paint() {
        clear(chips);
        [['all', 'q_all'], ['att', 'q_att'], ['wait', 'exc_waiting'], ['mine', 'q_mine'], ['hard', 'lbl_hard']].forEach(function (q) {
          var n = all.filter(function (c) { return quickOk(c, q[0]); }).length;
          chips.appendChild(h('button', { type: 'button', cls: 'chip', 'data-q': q[0], 'aria-pressed': OFFICE.q === q[0] ? 'true' : 'false', onclick: function () {
            OFFICE.q = q[0];
            refilter();
            chips.querySelector('[data-q="' + q[0] + '"]').focus();
          } }, h('span', { text: t(q[1]) }), h('span', { cls: 'n', text: String(n) })));
        });
        var text = OFFICE.text.trim().toLowerCase();
        var rows = all.filter(function (c) {
          return quickOk(c, OFFICE.q) && (!OFFICE.type || c.type === OFFICE.type) && (!OFFICE.owner || onTeam(c, OFFICE.owner)) &&
            (!text || (c.title + ' #' + c.id + ' ' + teamLabel(c) + ' ' + personName(c.requester)).toLowerCase().indexOf(text) >= 0);
        }).sort(byUrgency);
        clearBtn.hidden = !(OFFICE.q !== 'all' || OFFICE.type || OFFICE.owner || text);
        count.textContent = tf('count_line', { n: rows.length, m: all.length });
        clear(body);
        body.appendChild(mode === 'kanban' ? kanbanView(rows) : mode === 'timeline' ? timelineView(rows) : listView(rows, paint, body));
      }
      paint();
      if (FOCUS_AFTER) { var f = document.getElementById(FOCUS_AFTER); FOCUS_AFTER = ''; if (f) f.focus(); } // the view button just pressed
    });
  };
  // The server's day moves at midnight; a page left open overnight follows it (due texts, the timeline, the top line).
  function newDay(r) {
    if (r.data && r.data.today && r.data.today !== TODAY) { TODAY = r.data.today; setChrome(); }
  }

  function listView(rows, repaint, body) {
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    OFFICE.page = Math.min(Math.max(1, OFFICE.page), pages); // a stale page number (the list shrank) is clamped
    var from = (OFFICE.page - 1) * PAGE_SIZE, part = rows.slice(from, from + PAGE_SIZE);
    var tbl = h('div', { cls: 'tlist', role: 'table', 'aria-label': t('nav_office') },
      h('div', { cls: 'tr th', role: 'row' }, ['th_task', 'lbl_status', 'lbl_urgency', 'lbl_people', 'lbl_requester', 'lbl_due'].map(function (k) {
        return h('div', { role: 'columnheader', text: t(k) });
      })));
    part.forEach(function (c) { tbl.appendChild(rowItem(c)); });
    var wrap = h('div', { cls: 'tlist-wrap' }, h('div', { cls: 'tlist-scroll' }, tbl));
    if (!rows.length) wrap.appendChild(h('p', { cls: 'muted empty', text: t('no_cards') }));
    var pager = h('div', { cls: 'pager' }, h('p', { id: 'pg-info', cls: 'muted', text: rows.length ? tf('page_info', { a: from + 1, b: from + part.length, n: rows.length }) : '' }));
    if (pages > 1) {
      var to = function (p) {
        OFFICE.page = p;
        repaint();
        var cur = body.querySelector('.pg[aria-current="page"]');
        if (cur) cur.focus();
      };
      var nav = h('nav', { cls: 'pg-btns', 'aria-label': t('pages_label') });
      nav.appendChild(h('button', { type: 'button', id: 'pg-prev', cls: 'pg secondary', disabled: OFFICE.page <= 1, text: t('page_prev'), onclick: function () { to(OFFICE.page - 1); } }));
      for (var p = 1; p <= pages; p++) {
        (function (n) {
          nav.appendChild(h('button', { type: 'button', cls: 'pg secondary', 'data-page': String(n), 'aria-current': n === OFFICE.page ? 'page' : null,
            'aria-label': tf('page_n', { n: n }), text: String(n), onclick: function () { to(n); } }));
        })(p);
      }
      nav.appendChild(h('button', { type: 'button', id: 'pg-next', cls: 'pg secondary', disabled: OFFICE.page >= pages, text: t('page_next'), onclick: function () { to(OFFICE.page + 1); } }));
      pager.appendChild(nav);
    }
    wrap.appendChild(pager);
    return wrap;
  }

  function rowItem(c) {
    var flags = [c.hard ? t('lbl_hard') : '', c.routine_key ? t('lbl_routine') : '', c.private ? t('lbl_private') : '',
      c.parent ? tf('lbl_sub_of_title', { t: c.parent_title }) : ''].filter(Boolean); // the table shows no task numbers
    return h('div', { cls: 'tr' + (c.age ? ' age-' + c.age : ''), role: 'row', 'data-id': String(c.id), 'data-status': c.status },
      h('div', { role: 'cell', cls: 'c-task' },
        h('button', { type: 'button', cls: 'title', text: c.title, onclick: function () { go('card', String(c.id)); } }),
        h('span', { cls: 'sub', text: [t('type_' + c.type)].concat(flags).join(' · ') })),
      h('div', { role: 'cell' }, statusBadge(c.status)),
      h('div', { role: 'cell', cls: 'c-urg' }, ageBadge(c.age), c.macet ? macetBadge() : null,
        c.waitingYou ? h('span', { cls: 'flag you', text: t('exc_waiting') }) : null),
      h('div', { role: 'cell', cls: 'c-who' }, avatar(c.owner, 'sm'), h('span', { text: teamLabel(c) })),
      h('div', { role: 'cell', text: personName(c.requester) }),
      h('div', { role: 'cell' }, h('span', { text: fmtDate(c.due) }), h('span', { cls: 'sub', text: dueText(c) })));
  }

  function kanbanView(rows) {
    var board = h('div', { cls: 'kanban' });
    [['antri', 'hint_antri'], ['jalan', 'hint_jalan'], ['tunggu', 'hint_tunggu'], ['bukti', 'hint_bukti']].forEach(function (s) {
      var cs = rows.filter(function (c) { return c.status === s[0]; });
      var col = h('section', { cls: 'kcol', 'data-status': s[0], 'aria-labelledby': 'kh-' + s[0] },
        h('div', { cls: 'kcol-h' }, h('h2', { id: 'kh-' + s[0], text: t('st_' + s[0]) }), h('span', { cls: 'n', text: String(cs.length) })),
        h('p', { cls: 'kcol-hint', text: tf(s[1], { n: SETTINGS.maxActive }) }));
      if (!cs.length) col.appendChild(h('p', { cls: 'muted empty', text: t('no_cards') }));
      cs.forEach(function (c) { col.appendChild(cardItem(c, { showRequester: true })); });
      board.appendChild(col);
    });
    return h('div', { cls: 'kanban-scroll' }, board);
  }

  function timelineView(rows) {
    // 18 working days from the Monday of this week (on a Sunday: from tomorrow's Monday)
    var days = [], x = utc(TODAY), wd = new Date(x).getUTCDay();
    x = wd === 0 ? x + 86400000 : x - (wd - 1) * 86400000;
    while (days.length < 18) { if (new Date(x).getUTCDay() !== 0) days.push(new Date(x).toISOString().slice(0, 10)); x += 86400000; }
    var N = days.length;
    var at = function (d) { for (var i = 0; i < N; i++) if (days[i] >= d) return i; return N - 1; };
    var head = h('div', { cls: 'tl-days' });
    days.forEach(function (d) {
      head.appendChild(h('div', { cls: 'tl-day' + (d === TODAY ? ' today' : '') }, h('b', { text: String(+d.slice(8, 10)) }), h('span', { text: t('dow_' + new Date(utc(d)).getUTCDay()) })));
    });
    var tl = h('div', { cls: 'tl' }, h('div', { cls: 'tl-r tl-h' }, h('div', { cls: 'tl-lab' }, h('b', { text: t('tl_title') })), head));
    var owners = [];
    PEOPLE.forEach(function (p) { if (rows.some(function (c) { return c.owner === p.id; })) owners.push(p.id); });
    rows.forEach(function (c) { if (owners.indexOf(c.owner) < 0) owners.push(c.owner); });
    owners.forEach(function (o) {
      var mine = rows.filter(function (c) { return c.owner === o; });
      tl.appendChild(h('div', { cls: 'tl-r tl-g' }, h('div', { cls: 'tl-lab' }, avatar(o, 'sm'), h('span', { text: ownerLabel(o) + ' · ' + tf('tl_n', { n: mine.length }) })), h('div', { cls: 'tl-track' })));
      mine.forEach(function (c) {
        var start = dayOf(c.started_at || c.created_at), end = c.due;
        if (c.status === 'bukti') { if (c.proof_at && dayOf(c.proof_at) > end) end = dayOf(c.proof_at); } else if (TODAY > end) end = TODAY;
        // a due date before the window counts as before its first day, so the whole visible bar is late
        var si = at(start), ei = Math.max(at(end), si), di = c.due < days[0] ? -1 : at(c.due);
        var cls = c.age === 'busuk' ? 'b-busuk' : c.age === 'layu' ? 'b-layu' : c.status === 'tunggu' ? 'b-tunggu' : c.status === 'bukti' ? 'b-bukti' : c.status === 'antri' ? 'b-antri' : 'b-jalan';
        var word = c.macet ? t('macet') : c.age ? t('age_' + c.age) : t('st_' + c.status);
        var bar = h('span', { cls: 'tl-bar ' + cls, title: fmtDate(start) + ' - ' + fmtDate(c.due) },
          h('span', { cls: 'tl-word', text: (start < days[0] ? '« ' : '') + word + (end > days[N - 1] ? ' »' : '') }));
        bar.style.left = (si * 100 / N) + '%';
        bar.style.width = ((ei - si + 1) * 100 / N) + '%';
        if (c.status !== 'bukti' && TODAY > c.due && ei > di) {
          var late = h('span', { cls: 'tl-late' });
          late.style.left = ((di - si + 1) * 100 / (ei - si + 1)) + '%';
          bar.appendChild(late);
        }
        tl.appendChild(h('div', { cls: 'tl-r', 'data-id': String(c.id), 'data-status': c.status },
          h('div', { cls: 'tl-lab' }, h('button', { type: 'button', cls: 'title', text: c.title, onclick: function () { go('card', String(c.id)); } }),
            h('span', { cls: 'vh', text: word + ', ' + fmtDate(start) + ' - ' + fmtDate(c.due) })), // what the bar shows, for a screen reader
          h('div', { cls: 'tl-track', 'aria-hidden': 'true' }, bar)));
      });
    });
    if (days.indexOf(TODAY) >= 0) { // no line on a Sunday: today is not a working day in the window
      var now = h('div', { cls: 'tl-now', 'aria-hidden': 'true' }, h('span', { text: t('tl_today') }));
      now.style.left = 'calc(220px + (100% - 220px) * ' + ((at(TODAY) + 0.5) / N).toFixed(4) + ')';
      tl.appendChild(now);
    }
    if (!rows.length) tl.appendChild(h('p', { cls: 'muted empty', text: t('no_cards') }));
    return h('div', { cls: 'tl-wrap' }, h('div', { cls: 'tl-scroll' }, tl), h('p', { cls: 'muted tl-note', text: t('tl_note') }));
  }

  ROUTES.req = function () {
    view.appendChild(h('h1', { text: t('nav_req') }));
    pageGet('/api/cards?view=req').then(function (r) {
      if (!r.ok) return showErr(view, r);
      var cards = r.data.cards;
      var wait = cards.filter(function (c) { return c.status === 'bukti'; });
      var rest = cards.filter(function (c) { return c.status !== 'bukti' && c.status !== 'usul'; });
      // v1.6.8: tasks a Penerima added and named me as their Pemberi (shown only when there are some)
      var usul = cards.filter(function (c) { return c.status === 'usul'; });
      if (usul.length) {
        view.appendChild(h('h2', { id: 'req-usul', text: t('req_approve') }));
        view.appendChild(cardList(usul, { confirm: true, wide: true }));
      }
      view.appendChild(h('h2', { text: t('st_bukti') }));
      view.appendChild(cardList(wait, { confirm: true, wide: true }));
      view.appendChild(h('h2', { text: t('req_open') }));
      view.appendChild(cardList(rest, { wide: true }));
    });
  };
  // v1.6.7: Riwayat Tugas, the closed tasks this person received (PIC or team), the last closed first; a tap opens the
  // task with its own Riwayat
  ROUTES.history = function () {
    view.appendChild(h('h1', { text: t('history') }));
    view.appendChild(h('p', { cls: 'muted', text: t('history_intro') }));
    pageGet('/api/cards?view=history').then(function (r) {
      if (!r.ok) return showErr(view, r);
      view.appendChild(cardList(r.data.cards, { wide: true, showRequester: true, closed: true }));
    });
  };

  // v1.6: #new/<id> is a sub-task of task <id>. The task is always read first, so the form shows what the server
  // says now (still open, still mine to add to, private or not), never a copy kept from earlier or from someone else.
  ROUTES['new'] = function (arg) {
    var pid = String(arg || '').replace(/[^0-9]/g, '');
    if (!pid) return newForm(null);
    api('GET', '/api/cards/' + pid).then(function (r) {
      var now = currentRoute();
      if (!ME || now.name !== 'new' || now.arg !== arg) return; // the form was left while the task was loading
      var cannot = r.ok && !r.data.can.sub ? { data: { error: 'client_no_sub', message: t('sub_cannot') } } : null; // said before anything is typed
      if (!r.ok || cannot) return showErr(openDrawer('new-panel', 'new-h', h('h2', { id: 'new-h', cls: 'dr-title', text: t('new_sub_title') }), true).body, cannot || r);
      newForm({ id: r.data.card.id, title: r.data.card.title, 'private': r.data.card.private, viewers: r.data.viewers });
    });
  };
  function newForm(parent) {
    var d = openDrawer('new-panel', 'new-h', h('h2', { id: 'new-h', cls: 'dr-title', text: t(parent ? 'new_sub_title' : 'nav_new') }), true);
    var msg = h('div', { cls: 'msg' });
    var title = h('input', { id: 'new-title', type: 'text', maxlength: '200' });
    var owner = peopleSelect('new-owner', null, false);
    owner.value = ME.id;
    var members = peopleChecks('new-members', 'f_members', []);
    members.appendChild(h('p', { cls: 'muted fhelp', text: t('f_members_help') }));
    // a sub-task of a private task is private too (the server says so as well); it starts with the parent's picked
    // people who are still here. The directors and the one creating it always see it: not offered.
    var parentPrivate = !!(parent && parent['private']);
    var active = function (pid) { return PEOPLE.some(function (p) { return p.id === pid && p.active; }); };
    var viewers = peopleChecks('new-viewers', 'f_viewers', parentPrivate ? (parent.viewers || []).filter(active) : []);
    viewers.appendChild(h('p', { cls: 'muted fhelp', text: t('f_viewers_help') + (parent ? ' ' + t('f_viewers_help_sub') : '') }));
    var always = PEOPLE.filter(function (p) { return p.role === 'direktur'; }).map(function (p) { return p.id; }).concat([ME.id]);
    var hideOwner = function () { members.hide([owner.value]); viewers.hide(always.concat([owner.value])); };
    owner.addEventListener('change', hideOwner);
    hideOwner();
    var due = h('input', { id: 'new-due', type: 'date' });
    var type = h('select', { id: 'new-type' });
    TYPES.forEach(function (x) { type.appendChild(h('option', { value: x, text: t('type_' + x) })); });
    var hard = h('input', { id: 'new-hard', type: 'checkbox' });
    var source = h('select', { id: 'new-source' });
    SOURCES.forEach(function (x) { source.appendChild(h('option', { value: x, text: t('src_' + x) })); });
    var body = h('textarea', { id: 'new-body', maxlength: '5000' });
    var files = fileField('new-files', true);
    var priv = h('input', { id: 'new-private', type: 'checkbox', checked: parentPrivate, disabled: parentPrivate });
    var showViewers = function () { viewers.hidden = !priv.checked; };
    priv.addEventListener('change', showViewers);
    showViewers();
    // v1.6.1: sub-tasks made together with this task (not offered when this is a sub-task: one level only). A row
    // starts with the task's PIC and date; the server checks every row before it writes anything.
    var subRows = [], subSeq = 0;
    var MAX_SUBS = 20; // the server takes at most 20 rows in one save (POST /api/cards)
    var subList = h('div', { id: 'new-subs-list' });
    var subFull = h('p', { cls: 'muted fhelp', id: 'new-subs-full', 'aria-live': 'polite', hidden: true, text: tf('sub_row_max', { n: MAX_SUBS }) });
    var renumber = function () {
      subRows.forEach(function (r, i) {
        r.title.setAttribute('aria-label', tf('sub_row_title', { n: i + 1 }));
        r.owner.setAttribute('aria-label', tf('sub_row_owner', { n: i + 1 }));
        r.due.setAttribute('aria-label', tf('sub_row_due', { n: i + 1 }));
        r.del.setAttribute('aria-label', tf('sub_row_del', { n: i + 1 }));
      });
      var full = subRows.length >= MAX_SUBS;
      addRow.disabled = full;
      subFull.hidden = !full;
    };
    var addSub = function () {
      var k = ++subSeq;
      var r = { title: h('input', { id: 'new-sub-title-' + k, cls: 'sub-title', type: 'text', maxlength: '200', placeholder: t('sub_row_placeholder') }),
        owner: peopleSelect('new-sub-owner-' + k, null, false), due: h('input', { id: 'new-sub-due-' + k, cls: 'sub-due', type: 'date' }) };
      r.owner.value = owner.value;
      r.due.value = due.value;
      r.del = h('button', { type: 'button', cls: 'secondary small sub-del', text: t('sub_row_remove'), onclick: function () {
        subRows.splice(subRows.indexOf(r), 1);
        subList.removeChild(r.wrap);
        renumber();
        document.getElementById('new-add-sub').focus();
      } });
      r.wrap = h('div', { cls: 'sub-row' }, r.title, r.owner, r.due, r.del);
      subRows.push(r);
      subList.appendChild(r.wrap);
      renumber();
      r.title.focus();
    };
    var addRow = h('button', { type: 'button', id: 'new-add-sub', cls: 'secondary small', text: t('btn_add_sub_row'), onclick: addSub });
    var subBox = parent ? null : h('fieldset', { cls: 'new-subs', id: 'new-subs' }, h('legend', { text: t('f_subtasks') }), subList, addRow, subFull);
    // v1.6.8: the Pemberi, the person the task is from (not on a sub-task: only the parent's Pemberi or a director adds
    // those). Someone else: the task waits for their approval, and the one adding it is its PIC with no team, sub-tasks,
    // files or privacy (the server refuses them). What was filled in there stays, in case the Pemberi is set back to me.
    var requester = parent ? null : peopleSelect('new-requester', null, false);
    var propHelp = h('p', { cls: 'muted fhelp', id: 'new-requester-help', 'aria-live': 'polite', hidden: true });
    var proposal = function () { return !!requester && requester.value !== ME.id; };
    var filesLabel = h('label', { for: 'new-files', text: t('f_files') });
    var privLabel = h('label', { cls: 'check', for: 'new-private' }, priv, h('span', { text: t('f_private') }));
    var setMode = function () {
      var p = proposal();
      if (p) owner.value = ME.id;
      owner.disabled = p;
      members.hidden = filesLabel.hidden = files.wrap.hidden = privLabel.hidden = subBox.hidden = p;
      viewers.hidden = p || !priv.checked;
      propHelp.hidden = !p;
      propHelp.textContent = p ? tf('f_requester_help', { name: personName(requester.value) }) : '';
      hideOwner();
    };
    if (requester) { requester.value = ME.id; requester.addEventListener('change', setMode); }
    var form = h('form', { id: 'new-form', onsubmit: function (ev) {
      ev.preventDefault();
      // FX17i: the button stays disabled for the whole create + attachments chain; a second tap creates nothing.
      var submit = document.getElementById('new-submit');
      if (submit.getAttribute('data-hold') === '1') return;
      submit.setAttribute('data-hold', '1');
      submit.disabled = true;
      ARMED = null;
      var p = proposal(); // the hidden parts are not sent
      api('POST', '/api/cards', { title: title.value, owner: owner.value, requester: requester ? requester.value : undefined, due: due.value, type: type.value, hard: hard.checked,
        source: source.value, body: body.value, 'private': !p && priv.checked, members: p ? [] : members.picked(),
        viewers: !p && priv.checked ? viewers.picked() : [], parent: parent ? parent.id : null,
        subtasks: p ? [] : subRows.map(function (s) { return { title: s.title.value, owner: s.owner.value, due: s.due.value }; }) }).then(function (r) {
        if (!r.ok) { submit.removeAttribute('data-hold'); submit.disabled = false; return showErr(msg, r); }
        var id = r.data.card.id;
        var list = p ? [] : Array.prototype.slice.call(files.input.files || []);
        var chain = Promise.resolve(true);
        var refusal = h('div', {});
        list.forEach(function (f) { chain = chain.then(function (okSoFar) { return okSoFar ? uploadOne(id, f, 'lampiran', refusal) : false; }); });
        chain.then(function (allOk) {
          // the card exists either way: open it, and show a refused attachment there (no filled form left to resend)
          if (!allOk) PENDING_MSG = { id: String(id), node: refusal };
          RENDERED = ''; // v1.2: the page under the panel lists the new task when the panel opens on it
          location.replace('#card/' + id); // the form's history entry becomes the task's: closing goes back to the page
        });
      });
    } },
      parent ? h('p', { cls: 'muted', id: 'new-parent', text: tf('new_sub_for', { id: parent.id, title: parent.title }) }) : null,
      // v1.6.9 (owner): Pemberi | PIC, Judul | Tenggat, Jenis | Sumber. A sub-task has no Pemberi field: an empty
      // cell keeps PIC on the first row alone, so the other pairs stay as asked.
      h('div', { cls: 'grid2' },
        requester ? h('div', {}, h('label', { for: 'new-requester', text: t('f_requester') }), requester) : null,
        h('div', {}, h('label', { for: 'new-owner', text: t('f_owner') }), owner),
        requester ? null : h('div', {}),
        h('div', {}, h('label', { for: 'new-title', text: t('f_title') }), title),
        h('div', {}, h('label', { for: 'new-due', text: t('f_due') }), due),
        h('div', {}, h('label', { for: 'new-type', text: t('f_type') }), type),
        h('div', {}, h('label', { for: 'new-source', text: t('f_source') }), source),
        h('div', {}, h('label', { cls: 'check', for: 'new-hard' }, hard, h('span', { text: t('f_hard') })))),
      propHelp,
      members,
      subBox,
      h('label', { for: 'new-body', text: t('f_body') }), body,
      filesLabel, files.wrap,
      privLabel,
      viewers,
      h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'new-submit', text: t('btn_create') })),
      msg);
    d.body.appendChild(form);
    title.focus();
  }

  // A file field whose visible button and text come from the dictionary (the native control shows the browser's
  // own language). The real input stays in the page, visually hidden, so the file picker still works.
  function fileField(id, multiple) {
    var input = h('input', { id: id, type: 'file', cls: 'vh', multiple: multiple ? true : null });
    var names = h('span', { cls: 'muted file-names', text: t('no_file') });
    input.addEventListener('change', function () {
      var l = Array.prototype.map.call(input.files || [], function (f) { return f.name; });
      names.textContent = l.length ? l.join(', ') : t('no_file');
    });
    var wrap = h('div', { cls: 'file-field' }, input, h('label', { for: id, cls: 'btn-like', text: t('choose_file') }), names);
    return { input: input, wrap: wrap };
  }

  function uploadOne(cardId, file, purpose, slot) {
    if (file.size > 15 * 1024 * 1024) { clear(slot); slot.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': 'client_big', text: t('err_file_big') })); return Promise.resolve(false); }
    return api('POST', '/api/cards/' + cardId + '/files', file, {
      'X-File-Name': encodeURIComponent(file.name), 'X-Purpose': purpose, 'Content-Type': file.type || 'application/octet-stream',
    }).then(function (r) { if (!r.ok) { showErr(slot, r); return false; } return true; });
  }

  function evidenceList(items) {
    var ul = h('ul', { cls: 'files' });
    items.forEach(function (e) {
      var li = h('li', { 'data-evidence': String(e.id) });
      var info = h('div', { cls: 'ev-info' });
      if (e.kind === 'file') {
        var href = '/f/' + e.id;
        if (/^image\/(png|jpeg|gif|webp)$/.test(e.mime || '')) li.appendChild(h('a', { href: href, target: '_blank', rel: 'noopener' }, h('img', { cls: 'thumb', src: href, alt: e.name })));
        info.appendChild(h('a', { href: href, cls: 'file-link', text: e.name }));
      } else if (e.kind === 'comment') { // v1.5: a written comment counts as proof; a file or link is optional
        info.appendChild(h('p', { cls: 'ev-comment', text: e.name }));
      } else {
        info.appendChild(h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer', cls: 'link-ev', text: e.name }));
      }
      info.appendChild(h('div', { cls: 'muted', text: personName(e.by) + ', ' + fmtTime(e.at) }));
      li.appendChild(info);
      ul.appendChild(li);
    });
    return ul;
  }

  function eventLine(e) {
    var d = e.detail || {};
    var after = d.after || {};
    // v1.6.8: a task a Penerima added for a Pemberi reads "Diusulkan, menunggu persetujuan <Pemberi>"
    var kind = e.kind === 'create' && after.status === 'usul' ? 'propose' : e.kind;
    var bits = [fmtTime(e.at), (e.actor ? personName(e.actor) : t('by_system')), kind === 'propose' ? tf('ev_propose', { name: personName(after.requester) }) : t('ev_' + kind)];
    if (e.kind === 'block' && after.waiting_on) bits.push(personName(after.waiting_on) + ': ' + (after.waiting_note || ''));
    if (e.kind === 'due') bits.push(fmtDate(d.before && d.before.due) + ' -> ' + fmtDate(after.due));
    if (e.kind === 'owner') bits.push(personName(d.before && d.before.owner) + ' -> ' + personName(after.owner));
    if (e.kind === 'evidence' && after.name) bits.push(after.name);
    if (e.kind === 'team' && after.members) bits.push(namesOf(after.members)); // v1.6
    if (e.kind === 'viewers') bits.push(d.parent_private ? t('ev_parent_private') : after['private'] ? namesOf(after.viewers || []) : t('lbl_everyone'));
    if (d.parent_cancelled) bits.push(t('ev_parent_cancelled'));
    var li = h('li', { 'data-kind': e.kind, text: bits.join(' · ') });
    if (d.reason) li.appendChild(h('div', { cls: 'muted', text: t('f_reason') + ': ' + d.reason }));
    return li;
  }

  ROUTES.card = function (arg) {
    var id = String(arg).replace(/[^0-9]/g, '');
    api('GET', '/api/cards/' + id).then(function (r) {
      if (!ME) return; // the session ended: api() has shown the sign-in page; no panel over it
      var now = currentRoute();
      if (now.name !== 'card' || now.arg !== arg) return; // v1.2: the panel was closed while the task was loading
      if (!r.ok) {
        var e = openDrawer('card-detail', 'card-err', h('h2', { id: 'card-err', cls: 'dr-title', text: t('nav_office') }));
        return showErr(e.body, r);
      }
      var c = deco(r.data.card), can = r.data.can;
      var slot = h('div', { cls: 'msg', id: 'card-msg' });
      var d = openDrawer('card-detail', 'card-title', [h('span', { cls: 'tag', text: t('type_' + c.type) }), h('span', { cls: 'tid', text: '#' + c.id })]);
      d.panel.setAttribute('data-id', String(c.id));
      d.panel.setAttribute('data-status', c.status);
      var box = d.body;
      box.appendChild(h('h1', { id: 'card-title', text: c.title }));
      // v1.6: a sub-task names its parent (the server sends it only to people who may see the parent)
      if (c.parent) box.appendChild(h('p', { cls: 'parent-line' }, h('span', { cls: 'muted', text: t('lbl_parent') + ': ' }),
        h('button', { type: 'button', id: 'd-parent', cls: 'link-btn', text: '#' + c.parent + ' ' + (c.parent_title || ''), onclick: function () { go('card', String(c.parent)); } })));
      box.appendChild(h('div', { cls: 'meta row' }, ageBadge(c.age), c.macet ? macetBadge() : null, statusBadge(c.status),
        c.on_time === true ? h('span', { cls: 'badge age-segar', text: t('lbl_on_time') }) : null,
        c.on_time === false ? h('span', { cls: 'badge age-busuk', text: t('lbl_late') }) : null,
        c.waitingYou ? h('span', { cls: 'flag you', text: t('exc_waiting') }) : null));
      box.appendChild(stepsBar(c.status));
      // v1.6.8: added by its Penerima; nothing can be done on it until its Pemberi approves
      if (c.status === 'usul') box.appendChild(h('p', { cls: 'muted', id: 'd-pending', text: tf('pending_line', { name: personName(c.requester) }) }));
      var dl = h('table', { cls: 'facts' });
      var row = function (k, v) { dl.appendChild(h('tr', {}, h('th', { text: t(k) }), h('td', { text: v }))); };
      row('lbl_owner', personName(c.owner));
      if (c.members.length) row('lbl_team', namesOf(c.members));
      row('lbl_requester', personName(c.requester));
      row('lbl_due', fmtDate(c.due) + (c.hard ? ' · ' + t('lbl_hard') : ''));
      row('f_type', t('type_' + c.type));
      row('f_source', t('src_' + c.source));
      if (c.status === 'tunggu') row('lbl_waiting_on', personName(c.waiting_on) + ': ' + (c.waiting_note || ''));
      row('lbl_koreksi', String(c.koreksi));
      row('lbl_moved', String(c.moved));
      row('lbl_viewers', c['private'] ? t('lbl_private') + ': ' + t('f_viewers_help') + (c.parent ? ' ' + t('f_viewers_help_sub') : '') +
        (r.data.viewers.length ? ' ' + t('lbl_also') + ' ' + namesOf(r.data.viewers) : '') : t('lbl_everyone'));
      if (c.routine_key) row('lbl_routine', '✓');
      // v1.2: what can be done comes first; the facts follow it
      var facts = h('div', { cls: 'table-wrap' }, dl);
      var bodyText = c.body ? h('p', { cls: 'body', text: c.body }) : null;

      var acts = h('div', { cls: 'acts row' });
      var extra = h('div', { cls: 'extra' });
      if (can.start) acts.appendChild(h('button', { type: 'button', id: 'd-start', text: t('btn_start'), onclick: function () {
        act(c.id, 'start', {}, slot).then(function (x) { if (!x.ok && /^limit_active/.test(x.data.error)) overrideRetry(c, 'start', slot, 'btn_start_override'); });
      } }));
      if (can.block) acts.appendChild(h('button', { type: 'button', id: 'd-block', cls: 'secondary', text: t('btn_block'), onclick: function () { clear(extra); blockForm(c, slot, extra); } }));
      if (can.unblock) acts.appendChild(h('button', { type: 'button', id: 'd-unblock', cls: 'secondary', text: t('btn_unblock'), onclick: function () {
        act(c.id, 'unblock', {}, slot).then(function (x) { if (!x.ok && /^limit_active/.test(x.data.error)) overrideRetry(c, 'unblock', slot, 'btn_unblock_override'); });
      } }));
      if (can.proof) acts.appendChild(h('button', { type: 'button', id: 'd-proof', text: t('btn_proof'), onclick: function () { act(c.id, 'proof', {}, slot); } }));
      if (can.accept) acts.appendChild(h('button', { type: 'button', id: 'd-accept', text: t('btn_accept'), onclick: function () { act(c.id, 'accept', {}, slot); } }));
      if (can.ret) acts.appendChild(h('button', { type: 'button', id: 'd-return', cls: 'secondary', text: t('btn_return'), onclick: function () {
        clear(extra);
        var reason = h('input', { id: 'd-return-reason', type: 'text', maxlength: '1000' });
        extra.appendChild(h('form', { cls: 'inline-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'return', { reason: reason.value }, slot); } },
          h('label', { for: reason.id, text: t('f_reason') }), reason, h('button', { type: 'submit', id: 'd-return-send', text: t('btn_send') })));
      } }));
      if (can.due) acts.appendChild(h('button', { type: 'button', id: 'd-due', cls: 'secondary', text: t('btn_move_due'), onclick: function () { clear(extra); extra.appendChild(dueForm(c, slot)); } }));
      if (can.owner) acts.appendChild(h('button', { type: 'button', id: 'd-owner', cls: 'secondary', text: t('btn_reassign'), onclick: function () { clear(extra); extra.appendChild(ownerForm(c, slot)); } }));
      // v1.6: the team and who may see the task
      if (can.team) acts.appendChild(h('button', { type: 'button', id: 'd-team', cls: 'secondary', text: t('btn_team'), onclick: function () { clear(extra); extra.appendChild(teamForm(c, slot)); } }));
      if (can.viewers) acts.appendChild(h('button', { type: 'button', id: 'd-viewers', cls: 'secondary', text: t('btn_viewers'), onclick: function () { clear(extra); extra.appendChild(viewersForm(c, r.data.viewers, slot)); } }));
      if (can.cancel) acts.appendChild(h('button', { type: 'button', id: 'd-cancel', cls: 'danger', text: t('btn_cancel_card'), onclick: function () { clear(extra); extra.appendChild(cancelForm(c, slot)); } }));
      // v1.6.8: its Pemberi approves or turns it down; a director may turn it down; the Penerima who added it takes it back
      if (can.approve) acts.appendChild(h('button', { type: 'button', id: 'd-approve', text: t('btn_approve'), onclick: function () { act(c.id, 'approve', {}, slot); } }));
      var rejectKey = c.owner === ME.id ? 'btn_withdraw' : 'btn_reject';
      if (can.reject) acts.appendChild(h('button', { type: 'button', id: 'd-reject', cls: 'secondary', text: t(rejectKey), onclick: function () { rejectForm(c, slot, extra, rejectKey); } }));
      if (acts.firstChild) box.appendChild(acts);
      box.appendChild(extra);
      box.appendChild(slot);
      if (PENDING_MSG && PENDING_MSG.id === String(c.id)) {
        while (PENDING_MSG.node.firstChild) slot.appendChild(PENDING_MSG.node.firstChild);
        PENDING_MSG = null;
      }
      box.appendChild(facts);
      if (bodyText) box.appendChild(bodyText);

      // v1.6: a task's sub-tasks (the ones this person may see); the task closes after them. Shown when there are some
      // or this person may add one (a sub-task whose parent is hidden from them must not look like a parent).
      if (!c.parent && (r.data.subtasks.length || can.sub)) {
        var subs = r.data.subtasks;
        var shut = subs.filter(function (s) { return s.status === 'selesai' || s.status === 'batal'; }).length;
        box.appendChild(h('h2', { id: 'subs-h', text: t('lbl_subtasks') + (subs.length ? ' (' + tf('sub_count', { a: shut, b: subs.length }) + ')' : '') }));
        var sl = h('ul', { cls: 'subs', id: 'subtasks' });
        subs.forEach(function (s) {
          deco(s);
          sl.appendChild(h('li', { 'data-id': String(s.id), 'data-status': s.status },
            h('button', { type: 'button', cls: 'title', text: s.title, onclick: function () { go('card', String(s.id)); } }),
            h('span', { cls: 'meta' }, h('span', { cls: 'tid', text: '#' + s.id }), statusBadge(s.status), ageBadge(s.age),
              h('span', { cls: 'who' }, avatar(s.owner, 'sm'), h('span', { text: teamLabel(s) })))));
        });
        box.appendChild(subs.length ? sl : h('p', { cls: 'muted', text: t('no_subtasks') }));
        if (can.sub) box.appendChild(h('div', { cls: 'row' }, h('button', { type: 'button', id: 'd-add-sub', cls: 'secondary', text: t('btn_add_sub'), onclick: function () {
          go('new', String(c.id));
        } })));
      }

      var proofs = r.data.evidence.filter(function (e) { return e.purpose === 'bukti'; });
      var attach = r.data.evidence.filter(function (e) { return e.purpose === 'lampiran'; });
      box.appendChild(h('h2', { text: t('lbl_proof') }));
      box.appendChild(proofs.length ? evidenceList(proofs) : h('p', { cls: 'muted', text: t('no_proof') }));
      if (can.evidence || can.attach) box.appendChild(evidenceForms(c, can.evidence ? 'bukti' : 'lampiran'));
      box.appendChild(h('h2', { text: t('lbl_attach') }));
      box.appendChild(attach.length ? evidenceList(attach) : h('p', { cls: 'muted', text: t('no_attach') }));
      box.appendChild(h('h2', { text: t('lbl_history') }));
      var ul = h('ul', { cls: 'ev', id: 'history' });
      r.data.events.forEach(function (e) { ul.appendChild(eventLine(e)); });
      box.appendChild(ul);
    });
  };

  function evidenceForms(c, purpose) {
    var slot = h('div', { cls: 'msg', id: 'ev-msg' });
    var ff = fileField('ev-file', false), file = ff.input;
    var note = h('textarea', { id: 'ev-comment', rows: '3', maxlength: '2000' });
    return h('div', { cls: 'inline-form' },
      h('label', { for: 'ev-comment', text: t('f_comment') }), note,
      h('div', { cls: 'row' }, h('button', { type: 'button', id: 'ev-add-comment', cls: 'secondary', text: t('add_comment'), onclick: function () {
        act(c.id, 'comment', { text: note.value, purpose: purpose }, slot);
      } })),
      h('p', { cls: 'field-title', text: purpose === 'bukti' ? t('f_file_proof') : t('f_file_attach') }), ff.wrap,
      h('div', { cls: 'row' }, h('button', { type: 'button', id: 'ev-upload', cls: 'secondary', text: t('add_file'), onclick: function () {
        if (!file.files || !file.files[0]) return;
        showOk(slot, t('uploading'));
        uploadOne(c.id, file.files[0], purpose, slot).then(function (ok) { if (ok) render(); });
      } })),
      slot);
  }

  function dueForm(c, slot, after) {
    var d = h('input', { cls: 'due-new', type: 'date', id: 'due-new-' + c.id });
    var reason = h('input', { cls: 'due-reason', type: 'text', id: 'due-reason-' + c.id, maxlength: '1000' });
    return h('form', { cls: 'inline-form due-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'due', { due: d.value, reason: reason.value }, slot, after); } },
      h('label', { for: d.id, text: t('f_new_due') }), d, h('label', { for: reason.id, text: t('f_reason') }), reason,
      h('button', { type: 'submit', cls: 'due-send', text: t('btn_save') }));
  }
  function ownerForm(c, slot, after) {
    var sel = peopleSelect('owner-new-' + c.id, c.owner, true);
    var reason = h('input', { cls: 'owner-reason', type: 'text', id: 'owner-reason-' + c.id, maxlength: '1000' });
    return h('form', { cls: 'inline-form owner-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'owner', { owner: sel.value, reason: reason.value }, slot, after); } },
      h('label', { for: sel.id, text: t('f_new_owner') }), sel, h('label', { for: reason.id, text: t('f_reason') }), reason,
      h('button', { type: 'submit', cls: 'owner-send', text: t('btn_save') }));
  }
  function cancelForm(c, slot, after) {
    var reason = h('input', { cls: 'cancel-reason', type: 'text', id: 'cancel-reason-' + c.id, maxlength: '1000' });
    return h('form', { cls: 'inline-form cancel-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'cancel', { reason: reason.value }, slot, after); } },
      h('label', { for: reason.id, text: t('f_reason') }), reason, h('button', { type: 'submit', cls: 'danger cancel-send', text: t('btn_cancel_card') }));
  }
  // v1.6: who works on the task with its PIC
  function teamForm(c, slot) {
    var box = peopleChecks('team-new', 'f_members', c.members);
    // not offered: the PIC; whom it waits on. Only the requester or a director gets here (v1.6.3), so the requester may be picked.
    box.hide([c.owner].concat(c.status === 'tunggu' ? [c.waiting_on] : []));
    return h('form', { cls: 'inline-form team-form', onsubmit: function (ev) { ev.preventDefault(); act(c.id, 'team', { members: box.picked() }, slot); } },
      box, h('button', { type: 'submit', id: 'team-send', text: t('btn_save') }));
  }
  // v1.6: everyone in the office, or only the people picked (the PIC, the team, the requester and directors always see it)
  function viewersForm(c, viewers, slot) {
    var priv = h('input', { id: 'viewers-private', type: 'checkbox', checked: !!c['private'] });
    var box = peopleChecks('viewers-new', 'f_viewers', viewers);
    box.appendChild(h('p', { cls: 'muted fhelp', text: t('f_viewers_help') + (c.parent ? ' ' + t('f_viewers_help_sub') : '') }));
    box.hide([c.owner, c.requester].concat(c.members, PEOPLE.filter(function (p) { return p.role === 'direktur'; }).map(function (p) { return p.id; })));
    var show = function () { box.hidden = !priv.checked; };
    priv.addEventListener('change', show);
    show();
    return h('form', { cls: 'inline-form viewers-form', onsubmit: function (ev) {
      ev.preventDefault();
      act(c.id, 'viewers', { 'private': priv.checked, viewers: priv.checked ? box.picked() : [] }, slot);
    } }, h('label', { cls: 'check', for: priv.id }, priv, h('span', { text: t('f_private') })), box, h('button', { type: 'submit', id: 'viewers-send', text: t('btn_save') }));
  }

  ROUTES.exc = function () {
    view.appendChild(h('h1', { text: t('exc') }));
    view.appendChild(annStrip());
    view.appendChild(h('p', { cls: 'muted', text: t('framing') }));
    pageGet('/api/exceptions').then(function (r) {
      if (!r.ok) return showErr(view, r);
      // FX5: what the director himself is blocking first, then wilting/rotten, then stuck; counts in the headings.
      [['waiting', 'exc_waiting'], ['aged', 'exc_aged'], ['macet', 'exc_macet']].forEach(function (s) {
        var cards = r.data[s[0]];
        var sec = h('section', { id: 'exc-' + s[0] }, h('h2', { text: t(s[1]) + ' (' + cards.length + ')' }));
        if (!cards.length) sec.appendChild(h('p', { cls: 'muted empty', text: t('none') }));
        else sec.appendChild(cardList(cards, { wide: true, showRequester: true, confirm: s[0] === 'waiting' }));
        view.appendChild(sec);
      });
    });
  };

  ROUTES.review = function () {
    view.appendChild(h('h1', { text: t('review') }));
    view.appendChild(h('p', { cls: 'muted', text: t('rv_intro') }));
    var msg = h('div', { cls: 'msg', id: 'rv-msg' });
    pageGet('/api/review').then(function (r) {
      if (!r.ok) return showErr(view, r);
      var d = r.data;
      var isDirector = ME.role === 'direktur';
      var bar = h('div', { cls: 'row panel' });
      if (d.open) {
        bar.appendChild(h('span', { text: t('rv_is_open') + ' · ' + fmtTime(d.open.at) + ' · ' + personName(d.open.chair) }));
        bar.appendChild(h('button', { type: 'button', id: 'rv-close', text: t('rv_close'), onclick: function () {
          api('POST', '/api/review/close', {}).then(function (x) { if (!x.ok) return showErr(msg, x); render(); });
        } }));
      } else {
        bar.appendChild(h('button', { type: 'button', id: 'rv-open', text: t('rv_open'), onclick: function () {
          api('POST', '/api/review/open', {}).then(function (x) { if (!x.ok) return showErr(msg, x); render(); });
        } }));
      }
      view.appendChild(bar);
      view.appendChild(msg);
      var section = function (titleKey, cards, id) {
        var sec = h('section', { id: id }, h('h2', { text: t(titleKey) + ' (' + cards.length + ')' }));
        if (!cards.length) sec.appendChild(h('p', { cls: 'muted', text: t('none') }));
        cards.forEach(function (c) {
          var item = cardItem(c, { showRequester: true });
          if (isDirector && d.open) {
            var slot = item.querySelector('.msg');
            var extra = item.querySelector('.extra');
            var movable = c.status !== 'bukti'; // FX15: due date and owner are frozen while the proof waits
            item.appendChild(h('div', { cls: 'acts' },
              movable ? h('button', { type: 'button', cls: 'secondary rv-due', text: t('btn_move_due'), onclick: function () { clear(extra); extra.appendChild(dueForm(c, slot)); } }) : null,
              movable ? h('button', { type: 'button', cls: 'secondary rv-owner', text: t('btn_reassign'), onclick: function () { clear(extra); extra.appendChild(ownerForm(c, slot)); } }) : null,
              h('button', { type: 'button', cls: 'danger rv-cancel', text: t('btn_cancel_card'), onclick: function () { clear(extra); extra.appendChild(cancelForm(c, slot)); } })));
            item.appendChild(extra); item.appendChild(slot);
          }
          sec.appendChild(item);
        });
        view.appendChild(sec);
      };
      section('rv_list', d.list, 'rv-list');
      section('rv_wait_dir', d.waitingDir, 'rv-waitdir');
      view.appendChild(h('h2', { text: t('rv_past') }));
      if (!d.past.length) view.appendChild(h('p', { cls: 'muted', text: t('none') }));
      else {
        var tb = h('table', {}, h('tr', {}, h('th', { text: t('n_from') }), h('th', { text: t('lbl_owner') }),
          h('th', { text: t('age_layu') }), h('th', { text: t('age_busuk') }), h('th', { text: t('macet') }), h('th', { text: t('rv_wait_dir') })));
        d.past.forEach(function (p) {
          var cell = function (k) { return p.counts.before[k] + ' -> ' + p.counts.after[k]; };
          tb.appendChild(h('tr', {}, h('td', { text: fmtDate(p.date) }), h('td', { text: personName(p.chair) }),
            h('td', { text: cell('layu') }), h('td', { text: cell('busuk') }), h('td', { text: cell('macet') }), h('td', { text: cell('menunggu_direktur') })));
        });
        view.appendChild(h('div', { cls: 'table-wrap' }, tb));
      }
    });
  };

  // v1.7.2: the routines are one table (Rutin | Pemilik | Jadwal | Dibuat | Status | Pengaturan), as the people page is;
  // a row's Atur opens routineDialog, which holds the fields the old panel had.
  function routineType(rt) { return t('type_' + rt.type) + (rt.hard ? ' · ' + t('lbl_hard') : ''); }
  function scheduleText(s) {
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    if (s.kind === 'yearly') return tf('r_sum_yearly', { d: two(s.day) + '/' + two(s.month) });
    if (s.kind === 'quarterly') return tf('r_sum_quarterly', { d: s.day, m: (s.months || []).join(', ') });
    return tf('r_sum_monthly', { d: s.day });
  }
  ROUTES.routines = function () {
    var rmsg = h('div', { cls: 'msg', id: 'routines-msg' });
    var tableBox = h('div', { cls: 'table-wrap', id: 'routines-table-wrap' });
    var drawTable = function (list) {
      var tb = h('tbody');
      list.forEach(function (rt) {
        var on = rt.active === 1;
        tb.appendChild(h('tr', { 'data-routine': String(rt.id) },
          h('td', {}, h('div', { cls: 'rt-title', text: rt.title }), h('div', { cls: 'muted', text: routineType(rt) }),
            rt.note ? h('div', { cls: 'muted rt-note', text: rt.note }) : null),
          h('td', { cls: 'nowrap' }, rt.owner ? personName(rt.owner) : h('span', { cls: 'muted', text: t('r_nobody') })),
          h('td', { text: scheduleText(rt.schedule) }),
          h('td', { cls: 'nowrap', text: tf('r_lead_short', { n: rt.lead_days }) }),
          h('td', {}, h('span', { cls: 'badge ' + (on ? 'r-on' : 'status'), text: t(on ? 'r_active' : 'r_inactive') })),
          h('td', {}, h('button', { type: 'button', id: 'rt-open-' + rt.id, cls: 'small secondary', 'aria-label': t('p_open') + ' ' + rt.title, text: t('p_open'),
            onclick: function () { routineDialog(rt, reload, rmsg); } }))));
      });
      var a = document.activeElement, keep = a && tableBox.contains(a) ? a.id : ''; // an Atur that had the cursor keeps it
      clear(tableBox);
      tableBox.appendChild(h('table', { id: 'routines-table' },
        h('thead', {}, h('tr', {}, ['r_col_routine', 'r_owner', 'r_schedule', 'r_col_lead', 'r_col_status', 'p_col_settings'].map(function (k) { return h('th', { scope: 'col', text: t(k) }); }))), tb));
      if (keep && document.getElementById(keep)) document.getElementById(keep).focus();
    };
    var reload = function () {
      pageGet('/api/routines').then(function (r) { if (!r.ok) return showErr(rmsg, r); drawTable(r.data.routines); });
    };
    view.appendChild(h('h1', { text: t('routines') }));
    view.appendChild(rmsg);
    view.appendChild(tableBox);
    reload();
  };
  // v1.7.2: one routine's dialog, with the same fields and the same request as the old panel. Simpan keeps it open with
  // "Tersimpan." (as personDialog does) and draws the table again; an answer that lands after it was closed goes to the
  // page (rmsg), naming the routine.
  function routineDialog(rt, reload, rmsg) {
    var openerId = 'rt-open-' + rt.id;
    var msg = h('div', { cls: 'msg' });
    var owner = peopleSelect('rt-owner', null, true);
    owner.options[0].textContent = t('r_nobody');
    owner.value = rt.owner || '';
    var kind = h('select', { id: 'rt-kind' });
    ['monthly', 'quarterly', 'yearly'].forEach(function (k) { kind.appendChild(h('option', { value: k, text: t('r_' + k) })); });
    kind.value = rt.schedule.kind;
    var day = h('input', { id: 'rt-day', type: 'number', min: '1', max: '31', step: '1', value: String(rt.schedule.day) });
    var month = h('input', { id: 'rt-month', type: 'number', min: '1', max: '12', step: '1', value: String(rt.schedule.month || 1) });
    var months = h('input', { id: 'rt-months', type: 'text', value: (rt.schedule.months || [1, 4, 7, 10]).join(',') });
    var lead = h('input', { id: 'rt-lead', type: 'number', min: '0', max: '365', step: '1', value: String(rt.lead_days) });
    var active = h('input', { id: 'rt-active', type: 'checkbox', checked: rt.active === 1 });
    var monthBox = h('div', { cls: 'rt-month' }, h('label', { for: month.id, text: t('r_month') }), month);
    var monthsBox = h('div', { cls: 'rt-months' }, h('label', { for: months.id, text: t('r_months') }), months);
    var showKind = function () { monthBox.hidden = kind.value !== 'yearly'; monthsBox.hidden = kind.value !== 'quarterly'; };
    kind.addEventListener('change', showKind);
    showKind();
    var save = function () {
      var sched = { kind: kind.value, day: parseInt(day.value, 10) };
      if (kind.value === 'yearly') sched.month = parseInt(month.value, 10);
      if (kind.value === 'quarterly') sched.months = months.value.split(',').map(function (x) { return parseInt(x, 10); });
      api('POST', '/api/routines/' + rt.id, { owner: owner.value || null, schedule: sched, lead_days: parseInt(lead.value, 10), active: active.checked }).then(function (x) {
        var open = dlg.open, at = open ? msg : rmsg;
        if (!x.ok) return showErr(at, x);
        showOk(at, (open ? '' : rt.title + ': ') + t('saved'));
        reload();
      });
    };
    var dlg = h('dialog', { id: 'routine-dlg', cls: 'dlg', 'aria-labelledby': 'routine-dlg-h', onclose: function () {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      var o = document.getElementById(openerId); // the row was drawn again: find its button by id
      if (o) o.focus();
    } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'routine-dlg-h', cls: 'dr-title', text: rt.title }),
        h('button', { type: 'button', id: 'routine-dlg-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' },
        h('p', { cls: 'muted', text: routineType(rt) }),
        rt.note ? h('p', { cls: 'muted', text: rt.note }) : null,
        // novalidate: a hidden Bulan box holding a bad number would block Simpan with no message; the server checks
        // every field, as it did for the old panel's button
        h('form', { id: 'routine-form', novalidate: true, onsubmit: function (ev) { ev.preventDefault(); save(); } },
          h('label', { for: owner.id, text: t('r_owner') }), owner,
          h('label', { for: kind.id, text: t('r_kind') }), kind,
          h('label', { for: day.id, text: t('r_day') }), day,
          monthBox, monthsBox,
          h('label', { for: lead.id, text: t('r_lead') }), lead,
          h('label', { cls: 'check', for: active.id }, active, h('span', { text: t('r_active') })),
          h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'rt-save', text: t('btn_save') })),
          msg)));
    layer.appendChild(dlg);
    dlg.showModal();
    owner.focus();
  }

  // v1.7.1: the people are one table (Nama | Panggilan | Peran | Pengaturan); a row's Atur opens personDialog, and
  // Tambah orang sits at the top right and opens the same dialog empty.
  ROUTES.people = function () {
    var pmsg = h('div', { cls: 'msg', id: 'people-msg' });
    var tableBox = h('div', { cls: 'table-wrap', id: 'people-table-wrap' });
    var drawTable = function (people) {
      var tb = h('tbody');
      people.forEach(function (p) {
        tb.appendChild(h('tr', { 'data-person': p.id },
          h('td', {}, p.name,
            p.active === 1 ? null : h('span', { cls: 'muted', text: ' · ' + t('r_inactive') })),
          h('td', { text: p.nick }),
          h('td', { text: t('role_' + p.role) }),
          h('td', {}, h('button', { type: 'button', id: 'p-open-' + p.id, cls: 'small secondary', 'aria-label': t('p_open') + ' ' + p.name, text: t('p_open'),
            onclick: function () { personDialog(p, reload, pmsg); } }))));
      });
      var a = document.activeElement, keep = a && tableBox.contains(a) ? a.id : ''; // an Atur that had the cursor keeps it
      clear(tableBox);
      tableBox.appendChild(h('table', { id: 'people-table' },
        h('thead', {}, h('tr', {}, ['p_name', 'p_nick', 'p_role', 'p_col_settings'].map(function (k) { return h('th', { scope: 'col', text: t(k) }); }))), tb));
      if (keep && document.getElementById(keep)) document.getElementById(keep).focus();
    };
    var reload = function () {
      refreshMe();
      pageGet('/api/people').then(function (r) { if (!r.ok) return showErr(pmsg, r); drawTable(r.data.people); });
    };
    // v1.7.1: Pengaturan (the four numbers) opens officeSettingsDialog, beside Tambah orang
    view.appendChild(h('div', { cls: 'page-head people-head' }, h('h1', { text: t('people') }),
      h('div', { cls: 'head-acts' },
        h('button', { type: 'button', id: 's-open', cls: 'secondary', onclick: function () { officeSettingsDialog(pmsg); } }, icon('gear'), h('span', { text: t('s_title') })),
        h('button', { type: 'button', id: 'p-add-open', onclick: function () { personDialog(null, reload, pmsg); } }, icon('new'), h('span', { text: t('p_add') })))));
    view.appendChild(pmsg);
    view.appendChild(tableBox);
    pageGet('/api/people').then(function (r) {
      if (!r.ok) return showErr(pmsg, r);
      drawTable(r.data.people);
      SETTINGS = r.data.settings;

      // FX17j: the change log (PIN resets included, so the other director can see them)
      var logBox = h('section', { cls: 'panel', id: 'change-log' }, h('h2', { text: t('change_log') }));
      view.appendChild(logBox);
      pageGet('/api/admin-events?limit=50').then(function (x) {
        if (!x.ok) return showErr(logBox, x);
        if (!x.data.events.length) { logBox.appendChild(h('p', { cls: 'muted', text: t('none') })); return; }
        var ul = h('ul', { cls: 'ev' });
        x.data.events.forEach(function (e) {
          var who = e.subject ? (personName(e.subject) || e.subject) : '';
          ul.appendChild(h('li', { 'data-kind': e.kind, text: [fmtTime(e.at), e.actor ? personName(e.actor) : t('by_system'), t('adm_' + e.kind), who].filter(Boolean).join(' · ') }));
        });
        logBox.appendChild(ul);
      });
    });
  };
  // v1.7.1: one person's dialog (p), or an empty one that adds a person (p null). It is a native <dialog> like the
  // To-Do form, but Simpan keeps it open with "Tersimpan." as the old card did, and a temporary PIN (Reset PIN or a new
  // person) stays in it until it is closed: a PIN is shown once. An answer that lands after the dialog was closed goes
  // to the page (pmsg) instead, so no PIN is lost. reload(): the table is drawn again.
  function personDialog(p, reload, pmsg) {
    var openerId = p ? 'p-open-' + p.id : 'p-add-open';
    var msg = h('div', { cls: 'msg' }), rmsg = h('div', { cls: 'msg' });
    var name = h('input', { id: 'pd-name', type: 'text', maxlength: '100', autocomplete: 'off' });
    var nick = h('input', { id: 'pd-nick', type: 'text', maxlength: '40', autocomplete: 'off' });
    var role = h('select', { id: 'pd-role' }, h('option', { value: 'staf', text: t('role_staf') }), h('option', { value: 'direktur', text: t('role_direktur') }));
    var keeper = h('input', { id: 'pd-keeper', type: 'checkbox', checked: !!(p && p.keeper === 1) });
    var active = p ? h('input', { id: 'pd-active', type: 'checkbox', checked: p.active === 1 }) : null;
    if (p) { name.value = p.name; nick.value = p.nick; role.value = p.role; }
    var pinLine = function (who, pin) { return h('p', { cls: 'ok', role: 'status' }, (who ? who + ': ' : '') + t('p_temp_pin') + ' ', h('span', { cls: 'pin-show', text: pin })); };
    // where an answer shows: in the dialog while it is open, else on the page (naming the person there)
    var answer = function (slot, x, okNode) {
      var open = dlg.open, at = open ? slot : pmsg;
      if (!x.ok) return showErr(at, x);
      clear(at); at.appendChild(okNode(open));
    };
    var dlg = h('dialog', { id: 'person-dlg', cls: 'dlg', 'aria-labelledby': 'person-dlg-h', onclose: function () {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      var o = document.getElementById(openerId); // the row was drawn again: find its button by id
      if (o) o.focus();
    } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'person-dlg-h', cls: 'dr-title', text: p ? p.name : t('p_add') }),
        h('button', { type: 'button', id: 'person-dlg-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' },
        h('form', { id: 'person-form', onsubmit: function (ev) {
          ev.preventDefault();
          if (p) {
            api('POST', '/api/people/' + encodeURIComponent(p.id), { name: name.value, nick: nick.value, role: role.value, keeper: keeper.checked, active: active.checked }).then(function (x) {
              answer(msg, x, function (open) { return h('p', { cls: 'ok', role: 'status', text: (open ? '' : p.name + ': ') + t('saved') }); });
              if (x.ok) reload();
            });
          } else {
            api('POST', '/api/people', { name: name.value, nick: nick.value, role: role.value, keeper: keeper.checked }).then(function (x) {
              // the PIN has its own slot (as Reset PIN's): a refused next try on the emptied form must not wipe it
              answer(x.ok ? rmsg : msg, x, function () { return pinLine(x.data.person.name, x.data.pin); });
              if (!x.ok) return;
              clear(msg);
              name.value = ''; nick.value = ''; role.value = 'staf'; keeper.checked = false; // ready for the next person
              reload();
            });
          }
        } },
          h('label', { for: 'pd-name', text: t('p_name') }), name,
          h('label', { for: 'pd-nick', text: t('p_nick') }), nick,
          h('label', { for: 'pd-role', text: t('p_role') }), role,
          active ? h('label', { cls: 'check', for: 'pd-active' }, active, h('span', { text: t('p_active') })) : null,
          h('label', { cls: 'check', for: 'pd-keeper' }, keeper, h('span', { text: t('p_keeper') })),
          h('div', { cls: 'row' }, h('button', { type: 'submit', id: p ? 'pd-save' : 'pd-add', text: p ? t('btn_save') : t('p_add') })),
          msg),
        p ? h('div', { cls: 'row dlg-out' }, h('button', { type: 'button', id: 'pd-reset', cls: 'secondary', text: t('p_reset'), onclick: function () {
          api('POST', '/api/people/' + encodeURIComponent(p.id) + '/reset-pin', {}).then(function (x) {
            answer(rmsg, x, function (open) { return pinLine(open ? '' : p.name, x.data.pin); });
            if (x.ok) reload();
          });
        } })) : null,
        rmsg));
    layer.appendChild(dlg);
    dlg.showModal();
    name.focus();
  }
  // v1.7.1: the four office numbers (was a panel on the page), in a dialog opened by Pengaturan beside Tambah orang.
  // It starts from SETTINGS and a save stores the server's answer there, so opening it again shows what was saved.
  function officeSettingsDialog(pmsg) {
    var msg = h('div', { cls: 'msg' });
    var num = function (id, v, lo, hi) { return h('input', { id: id, type: 'number', min: String(lo), max: String(hi), step: '1', value: String(v) }); };
    var sMax = num('s-max', SETTINGS.maxActive, 1, 20), sWilt = num('s-wilt', SETTINGS.wiltLate, 0, 10), sRot = num('s-rot', SETTINGS.rotLate, 1, 30), sHard = num('s-hard', SETTINGS.hardLead, 0, 30);
    var dlg = h('dialog', { id: 'office-settings-dlg', cls: 'dlg', 'aria-labelledby': 'office-settings-h', onclose: function () {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      var o = document.getElementById('s-open');
      if (o) o.focus();
    } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'office-settings-h', cls: 'dr-title', text: t('s_title') }),
        h('button', { type: 'button', id: 'office-settings-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' },
        h('form', { id: 'office-settings-form', onsubmit: function (ev) {
          ev.preventDefault();
          api('POST', '/api/settings', { maxActive: parseInt(sMax.value, 10), wiltLate: parseInt(sWilt.value, 10), rotLate: parseInt(sRot.value, 10), hardLead: parseInt(sHard.value, 10) }).then(function (x) {
            if (x.ok) { SETTINGS = x.data.settings; refreshMe(); }
            var at = dlg.open ? msg : pmsg; // closed before the answer: say it on the page
            if (!x.ok) return showErr(at, x);
            showOk(at, (dlg.open ? '' : t('s_title') + ': ') + t('saved'));
          });
        } },
          h('label', { for: 's-max', text: t('s_max') }), sMax,
          h('label', { for: 's-wilt', text: t('s_wilt') }), sWilt,
          h('label', { for: 's-rot', text: t('s_rot') }), sRot,
          h('label', { for: 's-hard', text: t('s_hard') }), sHard,
          h('div', { cls: 'row' }, h('button', { type: 'submit', id: 's-save', text: t('btn_save') })),
          msg)));
    layer.appendChild(dlg);
    dlg.showModal();
    sMax.focus();
  }

  // v1.3: To-Do Saya, the person's own list. Not a tugas: no owner, no proof, no ageing; no page shows it to anyone
  // else. Every read goes through pageGet and nothing is kept outside the page, so the next person on a shared PC sees
  // only their own list.
  // Since 21 Nov 2026 (v1.5.1): the page shows the list only; the add form opens in a dialog from the button at the
  // top right.
  ROUTES.todo = function () {
    var opener = h('button', { type: 'button', id: 'todo-new', onclick: function () { openTodoForm(function () { load('todo-new'); }); } },
      icon('new'), h('span', { text: t('todo_new') }));
    view.appendChild(h('div', { cls: 'page-head' }, h('h1', { text: t('todo') }), opener));
    var lists = h('div', { id: 'todo-lists' });
    // a field the person is in (typing, or on another box): an answer that lands later must not take the focus from it
    var busy = function (a) { return !!a && a.isConnected && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
    var item = function (td) {
      var box = h('input', { type: 'checkbox', id: 'todo-box-' + td.id, checked: td.done === 1 });
      var slot = h('div', { cls: 'msg' });
      // a tick is not a button, so the double-tap guard (ARMED) does not cover it: the box waits for its answer
      box.addEventListener('change', function () {
        box.disabled = true;
        api('POST', '/api/todos/' + td.id, { done: box.checked }).then(function (x) {
          if (!x.ok) {
            box.disabled = false; box.checked = !box.checked;
            if (!busy(document.activeElement)) box.focus();
            return showErr(slot, x);
          }
          load(box.id); // drawn again from the server's answer; the focus stays on this item's box
        });
      });
      var late = !td.done && td.due && TODAY && td.due < TODAY;
      var hint = td.done ? '' : dueText({ due: td.due, status: 'antri' }); // the board's own working-day words
      // v1.6.7: a monthly item says so; ticked, it says when it comes back (the 1st of the month after its date)
      var rep = '';
      if (td.monthly && td.due && td.done) {
        var y = Number(td.due.slice(0, 4)), mo = Number(td.due.slice(5, 7));
        rep = tf('todo_back_on', { d: fmtDate(mo === 12 ? (y + 1) + '-01-01' : y + '-' + String(mo + 1).padStart(2, '0') + '-01') });
      } else if (td.monthly) rep = t('todo_monthly_tag');
      return h('li', { cls: 'todo' + (late ? ' late' : ''), 'data-id': String(td.id), 'data-done': String(td.done) },
        h('label', { cls: 'check', for: box.id }, box, h('span', { cls: 'todo-t', text: td.text })),
        td.due ? h('span', { cls: 'due', text: fmtDate(td.due) + (hint ? ' · ' + hint : '') + (rep ? ' · ' + rep : '') }) : null,
        // Ubah and Hapus as one unit: on a narrow screen they wrap together instead of splitting over two lines
        h('span', { cls: 'todo-acts' },
          h('button', { type: 'button', id: 'todo-edit-' + td.id, cls: 'secondary small todo-edit', 'aria-label': tf('todo_edit_label', { text: td.text }), text: t('todo_edit'), onclick: function () {
            openTodoForm(function () { load('todo-edit-' + td.id); }, td);
          } }),
          h('button', { type: 'button', cls: 'secondary small todo-del', 'aria-label': tf('todo_del_label', { text: td.text }), text: t('todo_del'), onclick: function () {
            api('POST', '/api/todos/' + td.id + '/delete', {}).then(function (x) { if (!x.ok) return showErr(slot, x); load('todo-new'); });
          } })),
        // after the buttons: the title row keeps its date, Ubah and Hapus; the description gets the full row under it
        td.description ? h('p', { cls: 'todo-d muted', text: td.description }) : null,
        slot);
    };
    // focusId: the control to focus once the lists are drawn again. seq: only the newest reload draws, so two reloads
    // whose answers cross cannot leave the older list on screen.
    var seq = 0;
    var load = function (focusId) {
      var mine = ++seq;
      pageGet('/api/todos').then(function (r) {
        if (!ME || mine !== seq) return; // the session ended (api() has shown the sign-in page), or a newer reload is out
        clear(lists);
        if (!r.ok) return showErr(lists, r);
        newDay(r);
        var open = r.data.open, done = r.data.done;
        lists.appendChild(open.length ? h('ul', { cls: 'todos', id: 'todo-open' }, open.map(item)) : h('p', { cls: 'muted empty', id: 'todo-empty', text: t('todo_empty') }));
        if (done.length) {
          var cmsg = h('div', { cls: 'msg' });
          lists.appendChild(h('h2', { id: 'todo-done-h', text: t('st_selesai') + ' (' + done.length + ')' }));
          lists.appendChild(h('ul', { cls: 'todos', id: 'todo-done' }, done.map(item)));
          // v1.6.7: a monthly item is waiting to come back and is not cleared, so the button shows only for the others
          if (done.some(function (x) { return !x.monthly; })) lists.appendChild(h('button', { type: 'button', id: 'todo-clear', cls: 'secondary', text: t('todo_clear'), onclick: function () {
            api('POST', '/api/todos/clear-done', {}).then(function (x) { if (!x.ok) return showErr(cmsg, x); load('todo-new'); });
          } }));
          lists.appendChild(cmsg);
        }
        var f = focusId && document.getElementById(focusId);
        if (f && (f === document.activeElement || !busy(document.activeElement))) f.focus();
      });
    };
    view.appendChild(lists);
    load();
  };
  // The add form in a native <dialog>, as Settings: Escape or the close button shuts it, the page under it is inert,
  // and it removes itself on close (render() must never mistake it for a task panel). added(): the list reloads.
  // td (v1.5.2): an item to edit instead; the form starts with its title, date and description.
  function openTodoForm(added, td) {
    var openerId = td ? 'todo-edit-' + td.id : 'todo-new';
    var msg = h('div', { cls: 'msg' });
    var text = h('input', { id: 'todo-text', type: 'text', maxlength: '200', autocomplete: 'off' });
    var desc = h('textarea', { id: 'todo-desc', rows: '3', maxlength: '1000' });
    var due = h('input', { id: 'todo-due', type: 'date' });
    var monthly = h('input', { id: 'todo-monthly', type: 'checkbox', checked: !!(td && td.monthly), 'aria-describedby': 'todo-monthly-help' }); // v1.6.7
    if (td) { text.value = td.text; due.value = td.due || ''; desc.value = td.description || ''; }
    var dlg = h('dialog', { id: 'todo-dlg', cls: 'dlg', 'aria-labelledby': 'todo-dlg-h', onclose: function () {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      var o = document.getElementById(openerId);
      if (o) o.focus(); // back to the button that opened it
    } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'todo-dlg-h', cls: 'dr-title', text: td ? t('todo_edit_title') : t('todo_new') }),
        h('button', { type: 'button', id: 'todo-dlg-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' },
        h('p', { cls: 'muted', id: 'todo-note', text: t('todo_note') }),
        h('form', { id: 'todo-form', onsubmit: function (ev) {
          ev.preventDefault();
          // a half-typed date never gets here: the browser's own form check refuses it, as on Tugas baru (browser_check)
          api('POST', td ? '/api/todos/' + td.id + '/edit' : '/api/todos', { text: text.value, description: desc.value, due: due.value, monthly: monthly.checked }).then(function (x) {
            if (!dlg.open) { if (x.ok) added(); return; } // closed while it was on its way: still show a saved item
            if (!x.ok) { showErr(msg, x); (x.data.error === 'bad_input' || x.data.error === 'need_todo_date' ? due : text).focus(); return; }
            dlg.close();
            added();
          });
        } },
          h('label', { for: 'todo-text', text: t('todo_text') }), text,
          h('label', { for: 'todo-due', text: t('todo_due') }), due,
          h('label', { cls: 'check', for: 'todo-monthly' }, monthly, h('span', { text: t('todo_monthly') })),
          h('p', { cls: 'muted fhelp', id: 'todo-monthly-help', text: t('todo_monthly_help') }),
          h('label', { for: 'todo-desc', text: t('todo_desc') }), desc,
          h('div', { cls: 'row' }, h('button', { type: 'submit', id: td ? 'todo-save' : 'todo-add', text: td ? t('btn_save') : t('todo_add') })),
          msg)));
    layer.appendChild(dlg);
    dlg.showModal();
    text.focus();
  }

  ROUTES.help = function () {
    view.appendChild(h('h1', { text: t('help') }));
    view.appendChild(h('p', { text: t('motto') + ' ' + t('framing') }));
    view.appendChild(h('p', { cls: 'muted', text: t('sop_intro') }));
    view.appendChild(legend());
    var ol = h('ol', { cls: 'sop', id: 'sop' });
    [1, 2, 3].forEach(function (i) { ol.appendChild(h('li', { id: 'sop' + i }, h('b', { text: t('sop' + i + '_t') }), ' ', h('span', { text: t('sop' + i + '_b') }))); });
    view.appendChild(ol);
  };

  ROUTES.menu = function () {
    view.appendChild(h('h1', { text: t('nav_menu') }));
    var m = h('div', { cls: 'menu' });
    moreItems().forEach(function (it) {
      m.appendChild(h('button', { type: 'button', id: 'menu-' + it[0], cls: 'secondary', onclick: function () { go(it[0]); } }, icon(it[0]), h('span', { text: t(it[1]) }),
        it[0] === 'ann' ? annBadge(ANN_NEW) : null));
    });
    view.appendChild(m);
  };

  // ------------------------------------------------------------------ v1.7: Pengumuman
  function fmtSize(n) { return n >= 1048576 ? String(Math.round(n / 104857.6) / 10).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  // On a person's first page (Papan Saya, Pengecualian), while someone else has posted since their last visit.
  function annStrip() {
    var slot = h('div', { id: 'ann-strip-slot' });
    pageGet('/api/announcements/new').then(function (r) {
      if (!r.ok) return;
      annCount(r.data.n);
      if (!r.data.n) return;
      slot.appendChild(h('div', { cls: 'strip', id: 'ann-strip', role: 'status' }, icon('bell'),
        h('p', {}, h('strong', { text: tf('ann_strip', { n: r.data.n }) }), ' · ', h('span', { text: r.data.title })),
        h('button', { type: 'button', id: 'ann-strip-read', cls: 'small', text: t('ann_read'), onclick: function () { go('ann'); } })));
    });
    return slot;
  }
  // #ann = Aktif (opening it is the visit: the server marks it, so what is BARU now is not BARU next time), #ann/arsip.
  ROUTES.ann = function (arg) {
    var arch = arg === 'arsip';
    var poster = ME.role === 'direktur' || ME.keeper === 1; // the server decides again on every write
    var msg = h('div', { cls: 'msg', id: 'ann-msg' });
    var tabs = h('div', { cls: 'seg', id: 'ann-tabs', role: 'group', 'aria-label': t('ann_tabs') });
    var list = h('div', { id: 'ann-list' });
    var seq = 0;
    // err: an upload refused after its post was saved. The focus goes back to the control that had it (Ubah is drawn again).
    var load = function (err) {
      var mine = ++seq;
      pageGet('/api/announcements?view=' + (arch ? 'archive' : 'active')).then(function (r) {
        if (!ME || mine !== seq) return;
        var fid = document.activeElement && document.activeElement.id;
        clear(tabs); clear(list);
        if (err) showErr(msg, err); else clear(msg);
        if (!r.ok) return showErr(list, r);
        if (!arch) annCount(0);
        tabs.appendChild(h('button', { type: 'button', id: 'ann-tab-active', 'aria-pressed': arch ? 'false' : 'true', onclick: function () { go('ann'); } },
          t('ann_tab_active') + ' ', h('span', { cls: 'n', text: String(r.data.active_n) })));
        tabs.appendChild(h('button', { type: 'button', id: 'ann-tab-archive', 'aria-pressed': arch ? 'true' : 'false', onclick: function () { go('ann', 'arsip'); } }, t('ann_tab_archive')));
        var items = r.data.announcements;
        list.appendChild(items.length ? h('div', { cls: 'ann-list' }, items.map(function (a) { return annItem(a, load); }))
          : h('p', { cls: 'muted empty', id: 'ann-empty', text: t(arch ? 'ann_empty_archive' : 'ann_empty') }));
        list.appendChild(h('p', { cls: 'muted fhelp', id: 'ann-hint', text: t('ann_archive_hint') }));
        if (fid && document.activeElement === document.body) { var f = document.getElementById(fid); if (f) f.focus(); else view.focus(); }
      });
    };
    view.appendChild(h('div', { cls: 'page-head' }, h('h1', { text: t('ann') }),
      poster ? h('button', { type: 'button', id: 'ann-new', onclick: function () { openAnnForm(load); } }, icon('new'), h('span', { text: t('ann_new_btn') })) : null));
    view.appendChild(tabs);
    view.appendChild(msg);
    view.appendChild(list);
    load();
  };
  function annItem(a, reload) {
    var slot = h('div', { cls: 'msg' });
    var author = PEOPLE.filter(function (p) { return p.id === a.author; })[0];
    var flags = [];
    if (a.pinned) flags.push(h('span', { cls: 'flag', 'data-pinned': '1' }, icon('pin'), h('span', { text: t('ann_pinned') })));
    if (a.is_new) flags.push(h('span', { cls: 'tag-new', text: t('ann_new_tag') }));
    var file = null;
    if (a.file) {
      var href = '/fa/' + a.id;
      var img = /^image\/(png|jpeg|gif|webp)$/.test(a.file.mime || '');
      file = h('div', { cls: 'ann-file' },
        img ? h('a', { href: href, target: '_blank', rel: 'noopener' }, h('img', { cls: 'thumb', src: href, alt: a.file.name })) : icon('file'),
        h('a', { href: href, cls: 'file-link', text: a.file.name }),
        h('span', { cls: 'muted', text: fmtSize(a.file.size) }));
    }
    var acts = null;
    if (a.can_change) {
      acts = h('div', { cls: 'row ann-acts' });
      var ask; // Arsipkan asks once, in the page: an archived post cannot come back
      var plain = function () {
        clear(acts);
        acts.appendChild(h('button', { type: 'button', id: 'ann-edit-' + a.id, cls: 'secondary small', 'aria-label': tf('ann_edit_label', { title: a.title }), text: t('ann_edit'),
          onclick: function () { openAnnForm(reload, a); } }));
        acts.appendChild(h('button', { type: 'button', id: 'ann-arch-' + a.id, cls: 'secondary small', 'aria-label': tf('ann_archive_label', { title: a.title }), text: t('ann_archive'), onclick: ask }));
      };
      ask = function () {
        clear(acts);
        var no = h('button', { type: 'button', id: 'ann-arch-no-' + a.id, cls: 'secondary small', text: t('ann_cancel'), onclick: function () { plain(); document.getElementById('ann-arch-' + a.id).focus(); } });
        acts.appendChild(h('p', { cls: 'fhelp', id: 'ann-arch-q-' + a.id, text: t('ann_archive_q') }));
        acts.appendChild(h('button', { type: 'button', id: 'ann-arch-yes-' + a.id, cls: 'danger small', 'aria-describedby': 'ann-arch-q-' + a.id, text: t('ann_archive_yes'), onclick: function () {
          api('POST', '/api/announcements/' + a.id + '/archive', {}).then(function (x) { if (!x.ok) return showErr(slot, x); reload(); });
        } }));
        acts.appendChild(no);
        no.focus(); // the safe choice under the finger
      };
      plain();
    }
    return h('article', { cls: 'ann' + (a.is_new ? ' is-new' : ''), id: 'ann-' + a.id, 'data-id': String(a.id) },
      flags.length ? h('div', { cls: 'ann-flags' }, flags) : null,
      h('h2', { text: a.title }),
      h('div', { cls: 'meta' },
        h('span', { cls: 'who' }, avatar(a.author, 'sm'), h('span', { text: personName(a.author) + (a.author === ME.id ? ' ' + t('ann_you') : '') })),
        author && author.role === 'direktur' ? h('span', { text: t('role_direktur') }) : null,
        h('span', { text: fmtDate(dayOf(a.created_at)) }),
        a.until ? h('span', { text: tf('ann_until_line', { d: fmtDate(a.until) }) }) : null,
        a.edited_at ? h('span', { text: tf('ann_edited', { d: fmtDate(dayOf(a.edited_at)) }) }) : null,
        a.archived_at ? h('span', { text: tf('ann_archived_on', { d: fmtDate(dayOf(a.archived_at)) }) }) : null),
      h('p', { cls: 'body', text: a.body }),
      file, acts, slot);
  }
  // The post form in a native <dialog>, as To-Do's. added(err): the page draws its list again; err is an upload refused
  // after the post itself was saved (shown on the page). a: a post to edit instead.
  function openAnnForm(added, a) {
    var openerId = a ? 'ann-edit-' + a.id : 'ann-new';
    var msg = h('div', { cls: 'msg' });
    var title = h('input', { id: 'ann-title', type: 'text', maxlength: '200', autocomplete: 'off' });
    var body = h('textarea', { id: 'ann-body', rows: '6', maxlength: '5000' });
    var until = h('input', { id: 'ann-until', type: 'date', min: TODAY || null, 'aria-describedby': 'ann-until-help' });
    var pin = h('input', { id: 'ann-pin', type: 'checkbox', checked: !!(a && a.pinned), 'aria-describedby': 'ann-pin-help' });
    var file = fileField('ann-file', false);
    if (a) { title.value = a.title; body.value = a.body; until.value = a.until || ''; }
    var dlg = h('dialog', { id: 'ann-dlg', cls: 'dlg', 'aria-labelledby': 'ann-dlg-h', onclose: function () {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      var o = document.getElementById(openerId);
      if (o) o.focus(); // back to the button that opened it
    } },
      h('div', { cls: 'dr-head' }, h('h1', { id: 'ann-dlg-h', cls: 'dr-title', text: t(a ? 'ann_dlg_edit' : 'ann_dlg_new') }),
        h('button', { type: 'button', id: 'ann-dlg-close', cls: 'icon-btn secondary', 'aria-label': t('close'), onclick: function () { dlg.close(); } }, icon('close'))),
      h('div', { cls: 'dr-body' },
        h('p', { cls: 'muted', id: 'ann-note', text: t('ann_dlg_note') }),
        h('form', { id: 'ann-form', onsubmit: function (ev) {
          ev.preventDefault();
          var f = file.input.files && file.input.files[0];
          if (f && f.size > 15 * 1024 * 1024) { clear(msg); msg.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': 'client_big', text: t('err_file_big') })); return; }
          // FX17i: the button stays disabled for the whole save + upload chain; a second tap saves nothing twice
          var submit = document.getElementById('ann-save');
          if (submit.getAttribute('data-hold') === '1') return;
          submit.setAttribute('data-hold', '1');
          submit.disabled = true;
          ARMED = null;
          api('POST', a ? '/api/announcements/' + a.id + '/edit' : '/api/announcements', { title: title.value, body: body.value, until: until.value, pinned: pin.checked }).then(function (x) {
            if (!x.ok) {
              submit.removeAttribute('data-hold'); submit.disabled = false;
              showErr(msg, x);
              (x.data.error === 'need_ann_body' ? body : x.data.error === 'ann_until_past' || x.data.error === 'bad_input' ? until : title).focus();
              return;
            }
            var id = x.data.announcement.id;
            var up = f ? api('POST', '/api/announcements/' + id + '/file', f, { 'X-File-Name': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' }) : Promise.resolve({ ok: true });
            up.then(function (y) { if (dlg.open) dlg.close(); added(y.ok ? null : y); });
          });
        } },
          h('label', { for: 'ann-title', text: t('ann_f_title') }), title,
          h('label', { for: 'ann-body', text: t('ann_f_body') }), body,
          h('label', { for: 'ann-until', text: t('ann_f_until') }), until,
          h('p', { cls: 'muted fhelp', id: 'ann-until-help', text: t('ann_f_until_help') }),
          h('label', { cls: 'check', for: 'ann-pin' }, pin, h('span', { text: t('ann_f_pin') })),
          h('p', { cls: 'muted fhelp', id: 'ann-pin-help', text: t('ann_f_pin_help') }),
          h('p', { cls: 'field-title', text: t('ann_f_file') }),
          a && a.file ? h('p', { cls: 'muted fhelp', id: 'ann-file-now', text: tf('ann_f_file_now', { name: a.file.name }) }) : null,
          file.wrap,
          h('p', { cls: 'muted fhelp', text: t('ann_f_file_help') }),
          h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'ann-save', text: t('btn_save') }),
            h('button', { type: 'button', id: 'ann-cancel', cls: 'secondary', text: t('ann_cancel'), onclick: function () { dlg.close(); } })),
          msg)));
    layer.appendChild(dlg);
    dlg.showModal();
    title.focus();
  }

  // ------------------------------------------------------------------ start
  function start() {
    view = document.getElementById('view');
    layer = document.getElementById('layer');
    // FX17i: remember which button a tap or submit came from; api() disables it while its write is pending.
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      ARMED = b;
      setTimeout(function () { if (ARMED === b) ARMED = null; }, 0);
    }, true);
    document.addEventListener('submit', function (e) {
      var b = e.target.querySelector('button[type=submit]');
      if (b && b.disabled) { e.preventDefault(); e.stopPropagation(); return; } // Enter while it is still sending
      if (b) { ARMED = b; setTimeout(function () { if (ARMED === b) ARMED = null; }, 0); }
    }, true);
    document.getElementById('logout-btn').addEventListener('click', signOut);
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    window.addEventListener('hashchange', function () { if (ME) render(true); else dropLayer(); });
    fetch('/i18n.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      DICT = d;
      setChrome();
      boot();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
