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

  try { var saved = window.localStorage.getItem('ob_lang'); if (saved === 'en' || saved === 'id') LANG = saved; } catch (e) { /* private mode */ }

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
    var headers = { 'X-Lang': LANG };
    var opts = { method: method, headers: headers, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof Blob)) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    else if (body instanceof Blob) opts.body = body;
    if (extraHeaders) for (var k in extraHeaders) headers[k] = extraHeaders[k];
    // FX17i: the button that sent a write stays disabled until its answer is back, so a double tap sends once.
    var btn = method !== 'GET' ? ARMED : null;
    ARMED = null;
    if (btn) btn.disabled = true;
    var release = function () { if (btn && btn.getAttribute('data-hold') !== '1') btn.disabled = false; };
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) {
        var data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = {}; }
        release();
        if (r.status === 401 && url !== '/api/login') { ME = null; showSignin(); }
        return { ok: r.ok, status: r.status, data: data };
      }, function () {
        // the connection dropped while the answer was arriving: the button must not stay disabled
        release();
        return { ok: false, status: 0, data: { error: 'network', message: t('err_network') } };
      });
    }, function () { release(); return { ok: false, status: 0, data: { error: 'network', message: t('err_network') } }; });
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

  // ------------------------------------------------------------------ badges: colour + word + icon, never colour alone
  function icon(kind) {
    var s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
    if (kind === 'segar') p.setAttribute('d', 'M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M5 8.2l2 2l4-4.4');
    else if (kind === 'layu') p.setAttribute('d', 'M8 1.8L15 14.2H1L8 1.8M8 6v4M8 11.6v1');
    else if (kind === 'busuk') p.setAttribute('d', 'M5 1.5h6l3.5 3.5v6L11 14.5H5L1.5 11V5L5 1.5M5.5 5.5l5 5M10.5 5.5l-5 5');
    else p.setAttribute('d', 'M3 3h3v10H3zM10 3h3v10h-3z');
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
    document.getElementById('motto').textContent = t('motto');
    var lb = document.getElementById('lang-btn');
    lb.textContent = t('lang_toggle'); lb.setAttribute('aria-label', t('lang_toggle_label'));
    var lo = document.getElementById('logout-btn');
    lo.textContent = t('logout'); lo.hidden = !ME;
    document.getElementById('me-name').textContent = ME ? (ME.nick || ME.name) : '';
    var nav = document.getElementById('nav');
    clear(nav);
    nav.hidden = !ME || !!ME.must_change_pin;
    if (!ME) return;
    // FX5: a director's first tab is Pengecualian (his home); Permintaan Saya moves into Lainnya for him.
    var dir = ME.role === 'direktur';
    var tabs = dir ? [['exc', 'exc'], ['office', 'nav_office'], ['my', 'nav_my'], ['new', 'nav_new'], ['menu', 'nav_menu']]
      : [['my', 'nav_my'], ['office', 'nav_office'], ['req', 'nav_req'], ['new', 'nav_new'], ['menu', 'nav_menu']];
    var inTabs = tabs.map(function (x) { return x[0]; });
    var cur = currentRoute().name;
    tabs.forEach(function (tb) {
      var on = cur === tb[0] || (tb[0] === 'menu' && inTabs.indexOf(cur) < 0 && cur !== 'card');
      nav.appendChild(h('button', { type: 'button', id: 'nav-' + tb[0], cls: on ? 'on' : '', text: t(tb[1]), onclick: function () { go(tb[0]); } }));
    });
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
  function render() {
    setChrome();
    if (!ME) return showSignin();
    if (ME.must_change_pin) return showChangePin(true);
    var r = currentRoute();
    clear(view);
    ROUTES[r.name](r.arg);
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ sign-in
  function showSignin() {
    ME = null;
    setChrome();
    clear(view);
    var box = h('section', { cls: 'panel', id: 'signin' });
    view.appendChild(h('h1', { text: t('signin_title') }));
    view.appendChild(h('p', { cls: 'muted', text: t('framing') }));
    view.appendChild(box);
    var chosen = null;
    var names = h('div', { cls: 'names', id: 'names' });
    var pinBox = h('div', { id: 'pin-box', hidden: true });
    var msg = h('div', { cls: 'msg' });
    box.appendChild(h('h2', { text: t('pick_name') }));
    box.appendChild(names);
    box.appendChild(pinBox);
    api('GET', '/api/people-public').then(function (res) {
      (res.data.people || []).forEach(function (p) {
        names.appendChild(h('button', { type: 'button', cls: 'name-btn', 'data-id': p.id, text: p.nick ? p.name + ' (' + p.nick + ')' : p.name, onclick: function () {
          chosen = p; names.hidden = true; pinBox.hidden = false;
          clear(pinBox);
          var pin = h('input', { id: 'login-pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '12' });
          var form = h('form', { id: 'login-form', onsubmit: function (ev) {
            ev.preventDefault();
            api('POST', '/api/login', { id: chosen.id, pin: pin.value }).then(function (r) {
              if (!r.ok) return showErr(msg, r);
              boot();
            });
          } },
            h('p', { cls: 'who-picked', text: chosen.name }),
            h('label', { for: 'login-pin', text: t('pin') }), pin,
            h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'login-btn', text: t('signin_btn') }),
              h('button', { type: 'button', cls: 'secondary', text: t('change_name'), onclick: function () { names.hidden = false; pinBox.hidden = true; clear(msg); } })),
            msg);
          pinBox.appendChild(form);
          pin.focus();
        } }));
      });
    });
  }

  function showChangePin(forced) {
    setChrome();
    clear(view);
    var msg = h('div', { cls: 'msg' });
    var old = forced ? null : h('input', { id: 'old-pin', type: 'password', inputmode: 'numeric', maxlength: '12' });
    var p1 = h('input', { id: 'new-pin', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' });
    var p2 = h('input', { id: 'new-pin2', type: 'password', inputmode: 'numeric', maxlength: '12', autocomplete: 'new-password' });
    var form = h('form', { id: 'pin-form', cls: 'panel', onsubmit: function (ev) {
      ev.preventDefault();
      if (p1.value !== p2.value) { clear(msg); msg.appendChild(h('p', { cls: 'err', role: 'alert', 'data-code': 'client_mismatch', text: t('pin_mismatch') })); return; }
      var body = { pin: p1.value };
      if (old) body.old = old.value;
      api('POST', '/api/pin', body).then(function (r) {
        if (!r.ok) return showErr(msg, r);
        if (forced) boot(); else showOk(msg, t('pin_changed'));
      });
    } },
      h('h1', { text: t('change_pin_title') }),
      forced ? h('p', { text: t('change_pin_help') }) : null,
      old ? h('label', { for: 'old-pin', text: t('old_pin') }) : null, old,
      h('label', { for: 'new-pin', text: t('new_pin') }), p1,
      h('label', { for: 'new-pin2', text: t('new_pin2') }), p2,
      h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'pin-save', text: t('save_pin') })),
      msg);
    view.appendChild(form);
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
      if (!ME.must_change_pin) { PEOPLE = r.data.people; SETTINGS = r.data.settings; TODAY = r.data.today; TYPES = r.data.types || []; }
      render();
    });
  }
  function refreshMe() {
    return api('GET', '/api/me').then(function (r) { if (r.ok && r.data.people) { PEOPLE = r.data.people; SETTINGS = r.data.settings; TODAY = r.data.today; TYPES = r.data.types || []; } });
  }

  // ------------------------------------------------------------------ card list items
  function act(cardId, action, body, slot, after) {
    return api('POST', '/api/cards/' + cardId + '/' + action, body || {}).then(function (r) {
      if (!r.ok) { showErr(slot, r); return r; }
      if (after) after(r); else render();
      return r;
    });
  }

  function peopleSelect(id, exclude, withChoose) {
    var sel = h('select', { id: id });
    if (withChoose) sel.appendChild(h('option', { value: '', text: t('choose') }));
    PEOPLE.filter(function (p) { return p.active && p.id !== exclude; }).forEach(function (p) {
      sel.appendChild(h('option', { value: p.id, text: (p.nick ? p.name + ' (' + p.nick + ')' : p.name) + (ME && p.id === ME.id ? ' ' + t('me_suffix') : '') }));
    });
    return sel;
  }

  function blockForm(c, slot, wrap) {
    var sel = peopleSelect('block-who-' + c.id, c.owner, true);
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
    var el = h('article', { cls: 'card' + (c.age ? ' age-' + c.age : ''), 'data-id': String(c.id), 'data-status': c.status });
    var title = h('button', { type: 'button', cls: 'title', text: c.title, onclick: function () { go('card', String(c.id)); } });
    el.appendChild(title);
    var meta = h('div', { cls: 'meta' },
      ageBadge(c.age), c.macet ? macetBadge() : null, statusBadge(c.status),
      h('span', { text: t('lbl_due') + ': ' + fmtDate(c.due) }),
      opts.showOwner !== false ? h('span', { text: t('lbl_owner') + ': ' + personName(c.owner) }) : null,
      opts.showRequester && c.requester !== c.owner ? h('span', { text: t('lbl_requester') + ': ' + personName(c.requester) }) : null,
      c.status === 'tunggu' && c.waiting_on ? h('span', { text: t('lbl_waiting_on') + ': ' + personName(c.waiting_on) }) : null,
      c.status === 'bukti' && c.macet ? h('span', { cls: 'waiting-confirm', text: t('waiting_confirm') + ': ' + personName(c.requester) }) : null,
      c.hard ? h('span', { text: t('lbl_hard') }) : null,
      c.private ? h('span', { text: t('lbl_private') }) : null);
    el.appendChild(meta);
    var acts = h('div', { cls: 'acts' });
    var slot = h('div', { cls: 'msg' });
    var extra = h('div', { cls: 'extra' });
    var mine = ME && (c.owner === ME.id || ME.role === 'direktur');
    if (opts.quick && mine) {
      if (c.status === 'antri') acts.appendChild(h('button', { type: 'button', cls: 'btn-start', text: t('btn_start'), onclick: function () {
        act(c.id, 'start', {}, slot).then(function (r) { if (!r.ok && r.data.error === 'limit_active') overrideRetry(c, 'start', slot, 'btn_start_override'); });
      } }));
      if (c.status === 'jalan') {
        acts.appendChild(h('button', { type: 'button', cls: 'btn-block secondary', text: t('btn_block'), onclick: function () { clear(extra); blockForm(c, slot, extra); } }));
        acts.appendChild(h('button', { type: 'button', cls: 'btn-proof', text: t('btn_proof'), onclick: function () { act(c.id, 'proof', {}, slot); } }));
      }
      if (c.status === 'tunggu') acts.appendChild(h('button', { type: 'button', cls: 'btn-unblock secondary', text: t('btn_unblock'), onclick: function () {
        act(c.id, 'unblock', {}, slot).then(function (r) { if (!r.ok && r.data.error === 'limit_active') overrideRetry(c, 'unblock', slot, 'btn_unblock_override'); });
      } }));
    }
    var ownProof = ME && ME.id === c.owner && c.requester !== c.owner; // FX1: never judge your own proof
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

  // ------------------------------------------------------------------ screens
  var ROUTES = {};
  ROUTES.my = function () {
    view.appendChild(h('h1', { text: t('nav_my') }));
    loading();
    api('GET', '/api/cards?view=my').then(function (r) {
      clear(view);
      view.appendChild(h('h1', { text: t('nav_my') }));
      if (!r.ok) return showErr(view, r);
      var cards = r.data.cards;
      var by = function (st) { return cards.filter(function (c) { return c.status === st; }); };
      var jalan = by('jalan');
      view.appendChild(h('h2', { id: 'sec-jalan', text: t('st_jalan') + ' ' + jalan.length + '/' + SETTINGS.maxActive }));
      view.appendChild(cardList(jalan, { quick: true, showOwner: false, showRequester: true }));
      view.appendChild(h('h2', { id: 'sec-antri', text: t('st_antri') }));
      view.appendChild(cardList(by('antri'), { quick: true, showOwner: false, showRequester: true }));
      view.appendChild(h('h2', { id: 'sec-tunggu', text: t('st_tunggu') }));
      view.appendChild(cardList(by('tunggu'), { quick: true, showOwner: false, showRequester: true }));
      view.appendChild(h('h2', { id: 'sec-bukti', text: t('st_bukti') }));
      view.appendChild(cardList(by('bukti'), { showOwner: false, showRequester: true }));
    });
  };

  ROUTES.office = function () {
    view.appendChild(h('h1', { text: t('nav_office') }));
    view.appendChild(legend());
    api('GET', '/api/cards?view=office').then(function (r) {
      if (!r.ok) return showErr(view, r);
      var lanes = h('div', { cls: 'lanes' });
      // FX13: a lane for every active person AND for anyone who still owns an open card (left people keep their cards
      // visible, labelled, so a director can reassign them).
      PEOPLE.filter(function (p) { return p.active || r.data.cards.some(function (c) { return c.owner === p.id; }); }).forEach(function (p) {
        var cards = r.data.cards.filter(function (c) { return c.owner === p.id; });
        var active = cards.filter(function (c) { return c.status === 'jalan'; }).length;
        var lane = h('section', { cls: 'lane' + (p.active ? '' : ' inactive'), 'data-person': p.id },
          h('h3', {}, h('span', { text: (p.nick || p.name) + (p.active ? '' : ' ' + t('inactive_lane')) }), h('span', { cls: 'muted', text: t('st_jalan') + ' ' + active + '/' + SETTINGS.maxActive })));
        lane.appendChild(cardList(cards, { showOwner: false, showRequester: true }));
        lanes.appendChild(lane);
      });
      view.appendChild(lanes);
    });
  };

  ROUTES.req = function () {
    view.appendChild(h('h1', { text: t('nav_req') }));
    api('GET', '/api/cards?view=req').then(function (r) {
      if (!r.ok) return showErr(view, r);
      var cards = r.data.cards;
      var wait = cards.filter(function (c) { return c.status === 'bukti'; });
      var rest = cards.filter(function (c) { return c.status !== 'bukti'; });
      view.appendChild(h('h2', { text: t('st_bukti') }));
      view.appendChild(cardList(wait, { confirm: true, wide: true }));
      view.appendChild(h('h2', { text: t('req_open') }));
      view.appendChild(cardList(rest, { wide: true }));
    });
  };

  ROUTES['new'] = function () {
    var msg = h('div', { cls: 'msg' });
    var title = h('input', { id: 'new-title', type: 'text', maxlength: '200' });
    var owner = peopleSelect('new-owner', null, false);
    owner.value = ME.id;
    var due = h('input', { id: 'new-due', type: 'date' });
    var type = h('select', { id: 'new-type' });
    TYPES.forEach(function (x) { type.appendChild(h('option', { value: x, text: t('type_' + x) })); });
    var hard = h('input', { id: 'new-hard', type: 'checkbox' });
    var source = h('select', { id: 'new-source' });
    SOURCES.forEach(function (x) { source.appendChild(h('option', { value: x, text: t('src_' + x) })); });
    var body = h('textarea', { id: 'new-body', maxlength: '5000' });
    var files = fileField('new-files', true);
    var priv = h('input', { id: 'new-private', type: 'checkbox' });
    var form = h('form', { id: 'new-form', cls: 'panel', onsubmit: function (ev) {
      ev.preventDefault();
      // FX17i: the button stays disabled for the whole create + attachments chain; a second tap creates nothing.
      var submit = document.getElementById('new-submit');
      if (submit.getAttribute('data-hold') === '1') return;
      submit.setAttribute('data-hold', '1');
      submit.disabled = true;
      ARMED = null;
      api('POST', '/api/cards', { title: title.value, owner: owner.value, due: due.value, type: type.value, hard: hard.checked,
        source: source.value, body: body.value, 'private': priv.checked }).then(function (r) {
        if (!r.ok) { submit.removeAttribute('data-hold'); submit.disabled = false; return showErr(msg, r); }
        var id = r.data.card.id;
        var list = Array.prototype.slice.call(files.input.files || []);
        var chain = Promise.resolve(true);
        var refusal = h('div', {});
        list.forEach(function (f) { chain = chain.then(function (okSoFar) { return okSoFar ? uploadOne(id, f, 'lampiran', refusal) : false; }); });
        chain.then(function (allOk) {
          // the card exists either way: open it, and show a refused attachment there (no filled form left to resend)
          if (!allOk) PENDING_MSG = { id: String(id), node: refusal };
          go('card', String(id));
        });
      });
    } },
      h('h1', { text: t('nav_new') }),
      h('div', { cls: 'grid2' },
        h('div', {}, h('label', { for: 'new-title', text: t('f_title') }), title),
        h('div', {}, h('label', { for: 'new-owner', text: t('f_owner') }), owner),
        h('div', {}, h('label', { for: 'new-due', text: t('f_due') }), due),
        h('div', {}, h('label', { for: 'new-type', text: t('f_type') }), type),
        h('div', {}, h('label', { for: 'new-source', text: t('f_source') }), source),
        h('div', {}, h('label', { cls: 'check', for: 'new-hard' }, hard, h('span', { text: t('f_hard') })))),
      h('label', { for: 'new-body', text: t('f_body') }), body,
      h('label', { for: 'new-files', text: t('f_files') }), files.wrap,
      h('label', { cls: 'check', for: 'new-private' }, priv, h('span', { text: t('f_private') })),
      h('div', { cls: 'row' }, h('button', { type: 'submit', id: 'new-submit', text: t('btn_create') })),
      msg);
    view.appendChild(form);
  };

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
    var bits = [fmtTime(e.at), (e.actor ? personName(e.actor) : t('by_system')), t('ev_' + e.kind)];
    var after = d.after || {};
    if (e.kind === 'block' && after.waiting_on) bits.push(personName(after.waiting_on) + ': ' + (after.waiting_note || ''));
    if (e.kind === 'due') bits.push(fmtDate(d.before && d.before.due) + ' -> ' + fmtDate(after.due));
    if (e.kind === 'owner') bits.push(personName(d.before && d.before.owner) + ' -> ' + personName(after.owner));
    if (e.kind === 'evidence' && after.name) bits.push(after.name);
    var li = h('li', { 'data-kind': e.kind, text: bits.join(' · ') });
    if (d.reason) li.appendChild(h('div', { cls: 'muted', text: t('f_reason') + ': ' + d.reason }));
    return li;
  }

  ROUTES.card = function (arg) {
    var id = String(arg).replace(/[^0-9]/g, '');
    api('GET', '/api/cards/' + id).then(function (r) {
      if (!r.ok) { view.appendChild(h('h1', { text: t('nav_office') })); return showErr(view, r); }
      var c = r.data.card, can = r.data.can;
      var slot = h('div', { cls: 'msg', id: 'card-msg' });
      var box = h('section', { cls: 'panel card-detail' + (c.age ? ' age-' + c.age : ''), id: 'card-detail', 'data-id': String(c.id), 'data-status': c.status });
      box.appendChild(h('h1', { id: 'card-title', text: c.title }));
      box.appendChild(h('div', { cls: 'meta row' }, ageBadge(c.age), c.macet ? macetBadge() : null, statusBadge(c.status),
        c.on_time === true ? h('span', { cls: 'badge age-segar', text: t('lbl_on_time') }) : null,
        c.on_time === false ? h('span', { cls: 'badge age-busuk', text: t('lbl_late') }) : null));
      var dl = h('table', { cls: 'facts' });
      var row = function (k, v) { dl.appendChild(h('tr', {}, h('th', { text: t(k) }), h('td', { text: v }))); };
      row('lbl_owner', personName(c.owner));
      row('lbl_requester', personName(c.requester));
      row('lbl_due', fmtDate(c.due) + (c.hard ? ' · ' + t('lbl_hard') : ''));
      row('f_type', t('type_' + c.type));
      row('f_source', t('src_' + c.source));
      if (c.status === 'tunggu') row('lbl_waiting_on', personName(c.waiting_on) + ': ' + (c.waiting_note || ''));
      row('lbl_koreksi', String(c.koreksi));
      row('lbl_moved', String(c.moved));
      if (c.private) row('lbl_private', '✓');
      if (c.routine_key) row('lbl_routine', '✓');
      box.appendChild(h('div', { cls: 'table-wrap' }, dl));
      if (c.body) box.appendChild(h('p', { cls: 'body', text: c.body }));

      var acts = h('div', { cls: 'acts row' });
      var extra = h('div', { cls: 'extra' });
      if (can.start) acts.appendChild(h('button', { type: 'button', id: 'd-start', text: t('btn_start'), onclick: function () {
        act(c.id, 'start', {}, slot).then(function (x) { if (!x.ok && x.data.error === 'limit_active') overrideRetry(c, 'start', slot, 'btn_start_override'); });
      } }));
      if (can.block) acts.appendChild(h('button', { type: 'button', id: 'd-block', cls: 'secondary', text: t('btn_block'), onclick: function () { clear(extra); blockForm(c, slot, extra); } }));
      if (can.unblock) acts.appendChild(h('button', { type: 'button', id: 'd-unblock', cls: 'secondary', text: t('btn_unblock'), onclick: function () {
        act(c.id, 'unblock', {}, slot).then(function (x) { if (!x.ok && x.data.error === 'limit_active') overrideRetry(c, 'unblock', slot, 'btn_unblock_override'); });
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
      if (can.cancel) acts.appendChild(h('button', { type: 'button', id: 'd-cancel', cls: 'danger', text: t('btn_cancel_card'), onclick: function () { clear(extra); extra.appendChild(cancelForm(c, slot)); } }));
      if (acts.firstChild) box.appendChild(acts);
      box.appendChild(extra);
      box.appendChild(slot);
      if (PENDING_MSG && PENDING_MSG.id === String(c.id)) {
        while (PENDING_MSG.node.firstChild) slot.appendChild(PENDING_MSG.node.firstChild);
        PENDING_MSG = null;
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
      view.appendChild(box);
    });
  };

  function evidenceForms(c, purpose) {
    var slot = h('div', { cls: 'msg', id: 'ev-msg' });
    var ff = fileField('ev-file', false), file = ff.input;
    var url = h('input', { id: 'ev-url', type: 'url', maxlength: '2000', placeholder: 'https://' });
    return h('div', { cls: 'inline-form' },
      h('p', { cls: 'field-title', text: purpose === 'bukti' ? t('f_file_proof') : t('f_file_attach') }), ff.wrap,
      h('div', { cls: 'row' }, h('button', { type: 'button', id: 'ev-upload', cls: 'secondary', text: t('add_file'), onclick: function () {
        if (!file.files || !file.files[0]) return;
        showOk(slot, t('uploading'));
        uploadOne(c.id, file.files[0], purpose, slot).then(function (ok) { if (ok) render(); });
      } })),
      h('label', { for: 'ev-url', text: t('f_link') }), url,
      h('div', { cls: 'row' }, h('button', { type: 'button', id: 'ev-link', cls: 'secondary', text: t('add_link'), onclick: function () {
        act(c.id, 'link', { url: url.value, purpose: purpose }, slot);
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

  ROUTES.exc = function () {
    view.appendChild(h('h1', { text: t('exc') }));
    view.appendChild(h('p', { cls: 'muted', text: t('framing') }));
    api('GET', '/api/exceptions').then(function (r) {
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
    api('GET', '/api/review').then(function (r) {
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

  ROUTES.nums = function () {
    view.appendChild(h('h1', { text: t('nums') }));
    var from = h('input', { id: 'n-from', type: 'date', value: TODAY.slice(0, 8) + '01' });
    var to = h('input', { id: 'n-to', type: 'date', value: TODAY });
    var out = h('div', {});
    var load = function () {
      clear(out);
      api('GET', '/api/numbers?from=' + encodeURIComponent(from.value) + '&to=' + encodeURIComponent(to.value)).then(function (r) {
        if (!r.ok) return showErr(out, r);
        var pctTxt = function (p, n, d) { return p === null ? '-' : p + '% (' + n + '/' + d + ')'; };
        var tb = h('table', { id: 'nums-table' }, h('tr', {}, h('th', { text: t('n_person') }), h('th', { text: t('n_on_time') }), h('th', { text: t('n_first') }),
          h('th', { text: t('n_busuk') }), h('th', { text: t('n_active') }), h('th', { text: t('n_wait') })));
        // FX2: the office row first (bold), then the person rows (all for a director, your own for anyone else)
        var tot = r.data.total;
        tb.appendChild(h('tr', { cls: 'total-row', 'data-person': '_total' }, h('th', { text: t('nums_total') }), h('th', { text: pctTxt(tot.on_time_pct, tot.on_time, tot.closed) }),
          h('th', { text: pctTxt(tot.first_time_pct, tot.first_time, tot.confirmed) }), h('th', { text: String(tot.busuk_now) }), h('th', { text: '-' }),
          h('th', { text: tot.wait_director_median === null ? '-' : String(tot.wait_director_median) })));
        r.data.rows.forEach(function (x) {
          tb.appendChild(h('tr', { 'data-person': x.person }, h('td', { text: x.name }), h('td', { text: pctTxt(x.on_time_pct, x.on_time, x.closed) }),
            h('td', { text: pctTxt(x.first_time_pct, x.first_time, x.confirmed) }), h('td', { text: String(x.busuk_now) }),
            h('td', { text: x.active_now + '/' + x.max_active }), h('td', { text: x.wait_director_median === null ? '-' : String(x.wait_director_median) })));
        });
        out.appendChild(h('p', { text: t('n_reviews') + ': ' + r.data.reviews_held }));
        out.appendChild(h('div', { cls: 'table-wrap' }, tb));
        if (ME.role !== 'direktur') out.appendChild(h('p', { cls: 'muted', id: 'nums-note', text: t('nums_note') }));
      });
    };
    view.appendChild(h('div', { cls: 'grid2 panel' }, h('div', {}, h('label', { for: 'n-from', text: t('n_from') }), from), h('div', {}, h('label', { for: 'n-to', text: t('n_to') }), to),
      h('div', {}, h('button', { type: 'button', id: 'n-show', text: t('btn_show'), onclick: load }))));
    view.appendChild(out);
    load();
  };

  ROUTES.routines = function () {
    view.appendChild(h('h1', { text: t('routines') }));
    api('GET', '/api/routines').then(function (r) {
      if (!r.ok) return showErr(view, r);
      r.data.routines.forEach(function (rt) {
        var msg = h('div', { cls: 'msg' });
        var owner = peopleSelect('rt-owner-' + rt.id, null, true);
        owner.options[0].textContent = t('r_nobody');
        owner.value = rt.owner || '';
        var kind = h('select', { id: 'rt-kind-' + rt.id });
        ['monthly', 'quarterly', 'yearly'].forEach(function (k) { kind.appendChild(h('option', { value: k, text: t('r_' + k) })); });
        kind.value = rt.schedule.kind;
        var day = h('input', { id: 'rt-day-' + rt.id, type: 'number', min: '1', max: '31', step: '1', value: String(rt.schedule.day) });
        var month = h('input', { id: 'rt-month-' + rt.id, type: 'number', min: '1', max: '12', step: '1', value: String(rt.schedule.month || 1) });
        var months = h('input', { id: 'rt-months-' + rt.id, type: 'text', value: (rt.schedule.months || [1, 4, 7, 10]).join(',') });
        var lead = h('input', { id: 'rt-lead-' + rt.id, type: 'number', min: '0', max: '365', step: '1', value: String(rt.lead_days) });
        var active = h('input', { id: 'rt-active-' + rt.id, type: 'checkbox', checked: rt.active === 1 });
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
            if (!x.ok) return showErr(msg, x);
            showOk(msg, t('saved'));
          });
        };
        view.appendChild(h('section', { cls: 'panel routine', 'data-routine': String(rt.id) },
          h('h2', { text: rt.title }),
          h('p', { cls: 'muted', text: t('type_' + rt.type) + (rt.hard ? ' · ' + t('lbl_hard') : '') }),
          rt.note ? h('p', { cls: 'muted', text: rt.note }) : null,
          h('div', { cls: 'grid2' },
            h('div', {}, h('label', { for: owner.id, text: t('r_owner') }), owner),
            h('div', {}, h('label', { for: kind.id, text: t('r_kind') }), kind),
            h('div', {}, h('label', { for: day.id, text: t('r_day') }), day),
            monthBox, monthsBox,
            h('div', {}, h('label', { for: lead.id, text: t('r_lead') }), lead)),
          h('label', { cls: 'check', for: active.id }, active, h('span', { text: t('r_active') })),
          h('button', { type: 'button', cls: 'rt-save', text: t('btn_save'), onclick: save }), msg));
      });
    });
  };

  ROUTES.people = function () {
    view.appendChild(h('h1', { text: t('people') }));
    api('GET', '/api/people').then(function (r) {
      if (!r.ok) return showErr(view, r);
      var st = r.data.settings;
      var smsg = h('div', { cls: 'msg' });
      var num = function (id, v, lo, hi) { return h('input', { id: id, type: 'number', min: String(lo), max: String(hi), step: '1', value: String(v) }); };
      var sMax = num('s-max', st.maxActive, 1, 20), sWilt = num('s-wilt', st.wiltLate, 0, 10), sRot = num('s-rot', st.rotLate, 1, 30), sHard = num('s-hard', st.hardLead, 0, 30);
      view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: t('s_title') }),
        h('div', { cls: 'grid2' },
          h('div', {}, h('label', { for: 's-max', text: t('s_max') }), sMax), h('div', {}, h('label', { for: 's-wilt', text: t('s_wilt') }), sWilt),
          h('div', {}, h('label', { for: 's-rot', text: t('s_rot') }), sRot), h('div', {}, h('label', { for: 's-hard', text: t('s_hard') }), sHard)),
        h('button', { type: 'button', id: 's-save', text: t('btn_save'), onclick: function () {
          api('POST', '/api/settings', { maxActive: parseInt(sMax.value, 10), wiltLate: parseInt(sWilt.value, 10), rotLate: parseInt(sRot.value, 10), hardLead: parseInt(sHard.value, 10) })
            .then(function (x) { if (!x.ok) return showErr(smsg, x); showOk(smsg, t('saved')); refreshMe(); });
        } }), smsg));

      r.data.people.forEach(function (p) {
        var msg = h('div', { cls: 'msg' });
        var name = h('input', { id: 'p-name-' + p.id, type: 'text', value: p.name, maxlength: '100' });
        var nick = h('input', { id: 'p-nick-' + p.id, type: 'text', value: p.nick, maxlength: '40' });
        var role = h('select', { id: 'p-role-' + p.id }, h('option', { value: 'staf', text: t('role_staf') }), h('option', { value: 'direktur', text: t('role_direktur') }));
        role.value = p.role;
        var keeper = h('input', { id: 'p-keeper-' + p.id, type: 'checkbox', checked: p.keeper === 1 });
        var active = h('input', { id: 'p-active-' + p.id, type: 'checkbox', checked: p.active === 1 });
        view.appendChild(h('section', { cls: 'panel person', 'data-person': p.id },
          h('h2', { text: p.name + (p.must_change_pin ? ' · ' + t('p_must_change') : '') }),
          h('div', { cls: 'grid2' }, h('div', {}, h('label', { for: name.id, text: t('p_name') }), name), h('div', {}, h('label', { for: nick.id, text: t('p_nick') }), nick),
            h('div', {}, h('label', { for: role.id, text: t('p_role') }), role)),
          h('label', { cls: 'check', for: keeper.id }, keeper, h('span', { text: t('p_keeper') })),
          h('label', { cls: 'check', for: active.id }, active, h('span', { text: t('p_active') })),
          h('div', { cls: 'row' },
            h('button', { type: 'button', cls: 'p-save', text: t('btn_save'), onclick: function () {
              api('POST', '/api/people/' + encodeURIComponent(p.id), { name: name.value, nick: nick.value, role: role.value, keeper: keeper.checked, active: active.checked })
                .then(function (x) { if (!x.ok) return showErr(msg, x); showOk(msg, t('saved')); refreshMe(); });
            } }),
            h('button', { type: 'button', cls: 'secondary p-reset', text: t('p_reset'), onclick: function () {
              api('POST', '/api/people/' + encodeURIComponent(p.id) + '/reset-pin', {}).then(function (x) {
                if (!x.ok) return showErr(msg, x);
                clear(msg); msg.appendChild(h('p', { cls: 'ok' }, t('p_temp_pin') + ' ', h('span', { cls: 'pin-show', text: x.data.pin })));
              });
            } })), msg));
      });

      var amsg = h('div', { cls: 'msg' });
      var aName = h('input', { id: 'a-name', type: 'text', maxlength: '100' }), aNick = h('input', { id: 'a-nick', type: 'text', maxlength: '40' });
      var aRole = h('select', { id: 'a-role' }, h('option', { value: 'staf', text: t('role_staf') }), h('option', { value: 'direktur', text: t('role_direktur') }));
      var aKeeper = h('input', { id: 'a-keeper', type: 'checkbox' });
      view.appendChild(h('section', { cls: 'panel' }, h('h2', { text: t('p_add') }),
        h('div', { cls: 'grid2' }, h('div', {}, h('label', { for: 'a-name', text: t('p_name') }), aName), h('div', {}, h('label', { for: 'a-nick', text: t('p_nick') }), aNick),
          h('div', {}, h('label', { for: 'a-role', text: t('p_role') }), aRole)),
        h('label', { cls: 'check', for: 'a-keeper' }, aKeeper, h('span', { text: t('p_keeper') })),
        h('button', { type: 'button', id: 'a-save', text: t('p_add'), onclick: function () {
          api('POST', '/api/people', { name: aName.value, nick: aNick.value, role: aRole.value, keeper: aKeeper.checked }).then(function (x) {
            if (!x.ok) return showErr(amsg, x);
            clear(amsg); amsg.appendChild(h('p', { cls: 'ok' }, x.data.person.name + ': ' + t('p_temp_pin') + ' ', h('span', { cls: 'pin-show', text: x.data.pin })));
            refreshMe();
          });
        } }), amsg));

      // FX17j: the change log (PIN resets included, so the other director can see them)
      var logBox = h('section', { cls: 'panel', id: 'change-log' }, h('h2', { text: t('change_log') }));
      view.appendChild(logBox);
      api('GET', '/api/admin-events?limit=50').then(function (x) {
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

  ROUTES.help = function () {
    view.appendChild(h('h1', { text: t('help') }));
    view.appendChild(h('p', { text: t('motto') + ' ' + t('framing') }));
    view.appendChild(h('p', { cls: 'muted', text: t('sop_intro') }));
    view.appendChild(legend());
    var ol = h('ol', { cls: 'sop', id: 'sop' });
    [1, 2, 3].forEach(function (i) { ol.appendChild(h('li', { id: 'sop' + i }, h('b', { text: t('sop' + i + '_t') }), ' ', h('span', { text: t('sop' + i + '_b') }))); });
    view.appendChild(ol);
  };

  ROUTES.pin = function () { showChangePin(false); };

  ROUTES.menu = function () {
    view.appendChild(h('h1', { text: t('nav_menu') }));
    var items = [];
    var dir = ME.role === 'direktur';
    if (dir) items.push(['req', 'nav_req']); // FX5: Pengecualian is a director's first tab; his requests live here
    if (dir || ME.keeper === 1) items.push(['review', 'review']);
    items.push(['nums', 'nums']);
    if (dir) { items.push(['routines', 'routines']); items.push(['people', 'people']); }
    items.push(['help', 'help']);
    items.push(['pin', 'my_pin']);
    var m = h('div', { cls: 'menu' });
    items.forEach(function (it) { m.appendChild(h('button', { type: 'button', id: 'menu-' + it[0], text: t(it[1]), onclick: function () { go(it[0]); } })); });
    view.appendChild(m);
  };

  // ------------------------------------------------------------------ start
  function start() {
    view = document.getElementById('view');
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
    document.getElementById('lang-btn').addEventListener('click', function () {
      LANG = LANG === 'id' ? 'en' : 'id';
      try { window.localStorage.setItem('ob_lang', LANG); } catch (e) { /* ignore */ }
      if (ME) render(); else showSignin();
    });
    document.getElementById('logout-btn').addEventListener('click', function () {
      api('POST', '/api/logout', {}).then(function () { ME = null; location.hash = ''; showSignin(); });
    });
    window.addEventListener('hashchange', function () { if (ME) render(); });
    fetch('/i18n.json', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      DICT = d;
      setChrome();
      boot();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
