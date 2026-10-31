// Classroom: фільтр тижнів. Content script для classroom.google.com
(() => {
  'use strict';
  if (window.__crfLoaded) return;
  window.__crfLoaded = true;

  const DAY_ABBR = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const DEFAULTS = {
    weekdays: true,      // показувати будні (пн–пт)
    weekend: true,       // показувати суботу
    weekMode: 'online',  // для буднів: off | online | offline
    enabled: true,       // головний перемикач біля кнопки
    anchor: '2026-09-14',// понеділок першого онлайн-тижня
    dateSource: 'auto',  // auto | published | due
    noDate: 'show',      // show | hide
    badges: true
  };

  // ---------- сховище ----------
  const store = {
    get(cb) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get('crf', r => cb(Object.assign({}, DEFAULTS, r.crf || {})));
          return;
        }
      } catch (e) {}
      let v = {};
      try { v = JSON.parse(localStorage.getItem('crf') || '{}'); } catch (e) {}
      cb(Object.assign({}, DEFAULTS, v));
    },
    set(v) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ crf: v });
          return;
        }
      } catch (e) {}
      try { localStorage.setItem('crf', JSON.stringify(v)); } catch (e) {}
    }
  };

  // ---------- розбір дат ----------
  const MONTHS = [
    ['січ', 0], ['лют', 1], ['бер', 2], ['квіт', 3], ['трав', 4], ['черв', 5],
    ['лип', 6], ['серп', 7], ['вер', 8], ['жовт', 9], ['лист', 10], ['груд', 11],
    ['янв', 0], ['фев', 1], ['мар', 2], ['апр', 3], ['мая', 4], ['май', 4], ['июн', 5],
    ['июл', 6], ['авг', 7], ['сен', 8], ['окт', 9], ['ноя', 10], ['дек', 11],
    ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['may', 4], ['jun', 5],
    ['jul', 6], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11]
  ];
  const RE_PUBLISHED = /(опубліковано|опубликовано|posted)/i;
  const RE_DUE = /(дата здачі|срок сдачи|due)/i;
  const RE_LABEL = /(опубліковано|опубликовано|posted|дата здачі|срок сдачи|due|без терміну|без срока|no due date|сьогодні|сегодня|today|учора|вчера|yesterday|завтра|tomorrow)/i;

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function mondayOf(d) {
    const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x;
  }
  function monthIndex(name) {
    name = (name || '').toLowerCase();
    for (const [p, idx] of MONTHS) { if (name.startsWith(p)) return idx; }
    return -1;
  }
  function parseDate(text) {
    const t = text.toLowerCase().replace(/змінено.*$/i, '').replace(/изменено.*$/i, '').replace(/edited.*$/i, '');
    const today = startOfDay(new Date());
    if (/сьогодні|сегодня|today/.test(t)) return today;
    if (/учора|вчера|yesterday/.test(t)) { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
    if (/завтра|tomorrow/.test(t)) { const d = new Date(today); d.setDate(d.getDate() + 1); return d; }
    let day, mon, year, mm;
    const re1 = /(\d{1,2})\s+([a-zа-яіїєґ]+)\.?(?:,?\s*(\d{4}))?/gi;
    while ((mm = re1.exec(t))) { const idx = monthIndex(mm[2]); if (idx >= 0) { day = +mm[1]; mon = idx; if (mm[3]) year = +mm[3]; break; } }
    if (mon === undefined) {
      const re2 = /([a-z]{3,})\s+(\d{1,2})(?:,\s*(\d{4}))?/gi; // англ. "Sep 4"
      while ((mm = re2.exec(t))) { const idx = monthIndex(mm[1]); if (idx >= 0) { mon = idx; day = +mm[2]; if (mm[3]) year = +mm[3]; break; } }
    }
    if (mon === undefined) {
      const num = t.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
      if (num && +num[2] >= 1 && +num[2] <= 12) { day = +num[1]; mon = +num[2] - 1; if (num[3]) year = num[3].length === 2 ? 2000 + +num[3] : +num[3]; }
    }
    if (mon === undefined) {
      if (/^\s*(опубліковано|опубликовано|posted)?\s*\d{1,2}:\d{2}\s*$/.test(t)) return today; // лише час = сьогодні
      return null;
    }
    if (year === undefined) {
      year = today.getFullYear();
      let d = new Date(year, mon, day);
      const diff = (d - today) / 86400000;
      if (diff > 120) d = new Date(year - 1, mon, day);
      else if (diff < -240) d = new Date(year + 1, mon, day);
      return startOfDay(d);
    }
    return startOfDay(new Date(year, mon, day));
  }

  // ---------- класифікація ----------
  let settings = Object.assign({}, DEFAULTS);
  function anchorMonday() {
    const p = (settings.anchor || DEFAULTS.anchor).split('-').map(Number);
    return mondayOf(new Date(p[0], p[1] - 1, p[2]));
  }
  function weekType(date) {
    const diff = Math.round((mondayOf(date) - anchorMonday()) / 604800000);
    if (diff < 0) return 'offline';
    return diff % 2 === 0 ? 'online' : 'offline';
  }

  // ---------- пошук рядків ----------
  function rowOf(el) {
    return el.closest('li, [role="listitem"]');
  }
  // чи є в тексті дата (день + місяць, сьогодні/учора або час)
  function hasDate(t) {
    const l = t.toLowerCase();
    if (/сьогодні|сегодня|today|учора|вчера|yesterday|завтра|tomorrow/.test(l)) return true;
    const re = /(\d{1,2})\s+([a-zа-яіїєґ]+)/gi; let m;
    while ((m = re.exec(l))) { if (monthIndex(m[2]) >= 0) return true; }
    return /(^|\s)\d{1,2}:\d{2}(\s|$)/.test(l);
  }
  // найменший елемент навколо мітки, у якому вже є дата
  function lineText(el) {
    const first = cleanText(el);
    let cur = el;
    for (let i = 0; i < 5 && cur; i++) {
      const t = cleanText(cur);
      if (t.length <= 120 && hasDate(t)) return t;
      if (cur.tagName === 'LI' || cur.getAttribute('role') === 'listitem') break;
      cur = cur.parentElement;
    }
    return first;
  }
  function isRendered(el) { return el.getClientRects().length > 0; }
  function cleanText(el) {
    return el.textContent.replace(/(онлайн|очно) · (нд|пн|вт|ср|чт|пт|сб)|без дати/g, '').replace(/\s+/g, ' ').trim();
  }
  function collectRows() {
    const rows = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t0 = n.textContent.trim();
      if (!t0 || t0.length > 80 || !RE_LABEL.test(t0)) continue;
      const el = n.parentElement;
      if (!el || el.closest('#crf-wrap') || el.classList.contains('crf-badge')) continue;
      const row = rowOf(el);
      if (!row) continue;
      const t = lineText(el);
      if (!rows.has(row)) rows.set(row, { published: [], due: [], labels: [] });
      const info = rows.get(row);
      const rendered = isRendered(el);
      if (RE_PUBLISHED.test(t)) info.published.push({ t, el, rendered });
      else info.due.push({ t, el, rendered });
      info.labels.push({ el, rendered });
    }
    return rows;
  }
  // перший кандидат, у якому справді є дата
  function pickDate(list) {
    for (const c of list) { const d = parseDate(c.t); if (d) return { date: d, el: c.el, rendered: c.rendered }; }
    return null;
  }

  // ---------- розгортання "Переглянути всі" ----------
  const RE_SHOWALL = /^(переглянути|подивитися|показати|посмотреть|показать|view|show)\s+(вс[іе]|все|всё|all)$/i;
  function normText(s) { return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е').replace(/[.,:;!]+$/, ''); }
  function clickLike(el) {
    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ev = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(type, opts));
    }
  }
  function autoExpand() {
    if (!filterActive()) return false;
    const targets = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!RE_SHOWALL.test(normText(n.textContent))) continue;
      const el = n.parentElement;
      if (!el || el.closest('#crf-wrap') || !el.getClientRects().length) continue;
      const t = el.closest('a, button, [role="button"], [role="link"], [tabindex], [jsaction]') || el;
      const tries = +(t.dataset.crfTries || 0);
      if (tries >= 3) continue;
      t.dataset.crfTries = String(tries + 1);
      targets.push(t);
    }
    for (const t of targets) clickLike(t);
    return targets.length > 0;
  }

  // ---------- застосування ----------
  let lastStats = { shown: 0, total: 0 };
  function apply() {
    autoExpand();
    const rows = collectRows();
    const weekFilter = 'online';
    const active = filterActive();
    let shown = 0, total = 0;
    rows.forEach((info, row) => {
      const rendered = row.classList.contains('crf-hidden') || isRendered(row);
      if (rendered) total++;
      let pick = null;
      if (settings.dateSource === 'published') pick = pickDate(info.published);
      else if (settings.dateSource === 'due') pick = pickDate(info.due);
      else pick = pickDate(info.published) || pickDate(info.due);
      const date = pick ? pick.date : null;
      const labelEl = pick && pick.rendered ? pick.el : ((info.labels.find(l => l.rendered) || info.labels[0] || {}).el || null);
      let visible = true;
      if (active) {
        if (!date) visible = settings.noDate !== 'hide';
        else {
          const wd = date.getDay();
          if (wd === 6) visible = !!settings.weekend;
          else visible = !!settings.weekdays && (!weekFilter || weekType(date) === weekFilter);
        }
      }
      row.classList.toggle('crf-hidden', !visible);
      if (visible && rendered) shown++;
      // бейдж
      let badge = row.querySelector(':scope .crf-badge');
      if (settings.badges) {
        if (!badge && labelEl) {
          badge = document.createElement('span');
          badge.className = 'crf-badge';
          labelEl.appendChild(badge);
        }
        if (badge) {
          if (date) {
            const wt = date.getDay() === 6 ? 'online' : weekType(date);
            badge.textContent = (wt === 'online' ? 'онлайн' : 'очно') + ' · ' + DAY_ABBR[date.getDay()];
            badge.className = 'crf-badge ' + (wt === 'online' ? 'crf-online' : 'crf-offline');
          } else {
            badge.textContent = 'без дати';
            badge.className = 'crf-badge crf-nodate';
          }
        }
      } else if (badge) badge.remove();
    });
    lastStats = { shown, total };
    ensureUI();
    updateCount();
  }

  // ---------- кнопка і панель ----------
  let wrap = null, btn = null, panel = null, isOpen = false;
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') el.className = attrs[k];
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    for (const c of children) el.append(c);
    return el;
  }
  function save() { store.set(settings); apply(); }
  function filterActive() { return !!settings.enabled; }
  function updateCount() {
    if (!btn) return;
    const txt = btn.querySelector('.crf-btn-text');
    if (txt) txt.textContent = 'Фільтр онлайну' + (filterActive() ? ' · ' + lastStats.shown + ' шт' : '');
    btn.classList.toggle('crf-active', filterActive());
    const c = panel && panel.querySelector('.crf-count');
    if (c) c.textContent = lastStats.shown + ' шт';
  }
  function toggle(open) {
    isOpen = !!open;
    if (wrap) wrap.classList.toggle('crf-open', isOpen);
  }
  function icon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 5h18l-7 8v5l-4 2v-7L3 5z'); path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }
  function buildPanel() {
    const p = h('div', { id: 'crf-panel' });
    const head = h('div', { class: 'crf-head' }, h('span', {}, 'Фільтр онлайну'), h('span', { class: 'crf-count' }, ''));
    const body = h('div', { class: 'crf-body' });

    // будні / вихідні
    const wdBox = h('input', { type: 'checkbox', id: 'crf-wd', onchange: e => { settings.weekdays = e.target.checked; save(); } });
    wdBox.checked = !!settings.weekdays;
    const weBox = h('input', { type: 'checkbox', id: 'crf-we', onchange: e => { settings.weekend = e.target.checked; save(); } });
    weBox.checked = !!settings.weekend;
    body.append(h('div', { class: 'crf-row' }, h('div', { class: 'crf-label' }, 'Що показувати'),
      h('div', { class: 'crf-inline' }, h('label', {}, wdBox, 'Пн–Пт, Нд'), h('label', {}, weBox, 'Сб'))));

    // дата першого онлайн-понеділка
    const anchor = h('input', { type: 'date', value: settings.anchor, onchange: e => { if (e.target.value) { settings.anchor = e.target.value; save(); } } });
    body.append(h('div', { class: 'crf-row' }, h('div', { class: 'crf-label' }, 'Понеділок першого онлайн-тижня'), anchor));

    body.append(h('div', { class: 'crf-foot' },
      h('button', { id: 'crf-reset', type: 'button', onclick: () => { settings.weekdays = true; settings.weekend = true; settings.weekMode = 'online'; settings.enabled = true; save(); rebuildUI(); } }, 'Скинути'),
      h('button', { type: 'button', onclick: () => toggle(false) }, 'Закрити')));

    p.append(head, body);
    return p;
  }
  // випадний список "Усі заняття" / "Усі теми", біля якого ставимо кнопку
  function findAnchor() {
    const main = document.querySelector('main') || document.body;
    const boxes = Array.from(main.querySelectorAll('[role="combobox"]')).filter(isRendered);
    if (!boxes.length) return null;
    const box = boxes[0];
    const w = box.getBoundingClientRect().width;
    let outer = box;
    while (outer.parentElement && outer.parentElement !== main && outer.parentElement.getBoundingClientRect().width <= w + 8) outer = outer.parentElement;
    return outer;
  }
  function rebuildUI() {
    if (wrap) wrap.remove();
    wrap = null;
    ensureUI();
  }
  function ensureUI() {
    const anchor = findAnchor();
    const mode = anchor ? 'anchored' : 'floating';
    if (wrap && document.contains(wrap) && wrap.dataset.mode === mode && (mode === 'floating' || wrap.previousElementSibling === anchor)) return;
    if (wrap) wrap.remove();
    wrap = h('div', { id: 'crf-wrap', class: isOpen ? 'crf-open' : '' });
    wrap.dataset.mode = mode;
    btn = h('button', { id: 'crf-btn', type: 'button', onclick: e => { e.stopPropagation(); toggle(!isOpen); } }, icon(), h('span', { class: 'crf-btn-text' }, 'Фільтр онлайну'));
    const sw = h('input', { type: 'checkbox', id: 'crf-enabled', onchange: e => { settings.enabled = e.target.checked; save(); } });
    sw.checked = !!settings.enabled;
    const swLabel = h('label', { class: 'crf-switch', title: 'Увімкнути або вимкнути фільтр' }, sw, h('span', { class: 'crf-slider' }));
    panel = buildPanel();
    wrap.append(btn, swLabel, panel);
    if (anchor) {
      const container = anchor.parentElement;
      container.insertBefore(wrap, anchor.nextSibling);
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.flexWrap = 'wrap';
      container.style.gap = '12px';
    } else {
      wrap.classList.add('crf-floating');
      document.body.append(wrap);
    }
    updateCount();
  }
  document.addEventListener('click', e => { if (isOpen && wrap && !wrap.contains(e.target)) toggle(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) toggle(false); });

  // ---------- запуск ----------
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(apply, 300); }
  store.get(s => {
    settings = s;
    ensureUI();
    apply();
    const mo = new MutationObserver(muts => {
      for (const m of muts) { if (m.target.closest && m.target.closest('#crf-wrap')) continue; schedule(); return; }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    let href = location.href;
    setInterval(() => { if (location.href !== href) { href = location.href; schedule(); } }, 800);
  });
})();
