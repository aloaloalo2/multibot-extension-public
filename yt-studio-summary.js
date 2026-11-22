// A compact channel header table on Studio «Инсайты» (hub_* pages, November 2026).
// Every value comes from rendered Studio reports: CTR and 0:30 retention from «Контент», the per-video averages from
// «Расширенный режим». No YouTube API, no settings changes.
(() => {
  const ROOT = 'data-multibot-channel-summary';
  // «score» is not read from Studio: it is the channel's «Эффективность», the same 0–100 scale as the Content list.
  // Likes left the table and the scores (author, 22 November 2026); the average view length took their place.
  const NAMES = ['ctr', 'duration', 'avd', 'retention', 'shares', 'score'];
  const LABELS = ['CTR', 'Просмотр', 'Длина', '0:30', 'Поделились/просм.', 'Эффективность'];
  const FULL_LABELS = ['CTR для значков видео', 'Средний процент просмотра', 'Средняя длина одного просмотра', 'Удержание на отметке 0:30', 'Среднее соотношение числа публикаций через «Поделиться» к просмотрам', 'Эффективность канала 0–100 без учёта просмотров'];
  // Period chips of the Insights pages and the matching «Расширенный режим» period.
  const PERIODS = { 7: 'week', 28: '4_weeks', 90: 'quarter' };
  const EXPLORE_METRICS = ['EXTERNAL_VIEWS', 'AVERAGE_WATCH_PERCENTAGE', 'AVERAGE_WATCH_TIME', 'SHARINGS'];
  const text = e => (e?.textContent || '').replace(/[  ‎‏⁨⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = e => e && !e.closest('[hidden], [aria-hidden="true"]') && e.getClientRects().length > 0;
  function percentage(value) {
    const m = String(value || '').replace(/[  ]/g, ' ').match(/^\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?\s*$/);
    return m ? Number(m[1].replace(',', '.')) : null;
  }
  function count(value) {
    const s = String(value ?? '').replace(/[\s  ]/g, '');
    // Counts in the detailed report are exact. Never treat abbreviated 1.2K as exact.
    return /^\d+$/.test(s) ? Number(s) : null;
  }
  function seconds(value) {
    const m = String(value || '').match(/^(?:(\d+):)?(\d+):(\d{2})$/);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }
  function average(values) {
    const valid = values.filter(v => Number.isFinite(v) && v >= 0);
    return valid.length ? { value: valid.reduce((a, b) => a + b, 0) / valid.length, count: valid.length } : null;
  }
  // «Контент» in Insights: the CTR simple metric and the «Ключевые моменты» card on its 0:30 intro list.
  function contentMetrics(doc) {
    const metrics = {};
    for (const metric of doc.querySelectorAll('ytcp-simple-metric-view-model')) {
      if (!visible(metric)) continue;
      let box = metric.parentElement;
      for (let i = 0; i < 5 && box && !box.querySelector('.ytBasicContentViewModelParagraphHeadline'); i++) box = box.parentElement;
      if (!/CTR|click.through/i.test(text(box?.querySelector('.ytBasicContentViewModelParagraphHeadline')))) continue;
      const value = percentage(text(metric.querySelector('.ytcpSimpleMetricValue')));
      if (value !== null) { metrics.ctr = { value, count: 1, source: 'CTR для значков видео из «Инсайты → Контент» за выбранный период.' }; break; }
    }
    for (const card of doc.querySelectorAll('yt-card-view-model')) {
      if (!visible(card)) continue;
      const labels = [...card.querySelectorAll('yt-list-item-view-model')].filter(visible)
        .map(item => text(item.querySelector('.ytListItemViewModelTrailingLabel')));
      if (!labels.some(label => /0\s*:\s*30/.test(label))) continue;
      const result = average(labels.map(percentage));
      if (result) metrics.retention = { ...result, source: `Среднее по ${result.count} роликам блока «Ключевые моменты», вкладка «Вступления» (0:30). Блок Studio берёт новые видео за последние 365 дней.` };
      break;
    }
    return metrics;
  }
  // «Расширенный режим», one row per video: views, average percentage viewed, view length, shares.
  function exploreMetrics(doc, rawUrl) {
    const u = new URL(rawUrl), columns = u.searchParams.getAll('t_metrics');
    const vi = columns.indexOf('EXTERNAL_VIEWS');
    if (vi < 0 || u.searchParams.get('dimension') !== 'VIDEO') return {};
    const root = doc.querySelector('#debug-explore-table');
    if (!root || !visible(root)) return {};
    const rows = [];
    for (const row of root.querySelectorAll('yta-explore-table-row')) {
      const label = text(row.querySelector('.debug-dimension-value'));
      if (!label || /^(итого|total|усього|всього|разом)$/i.test(label)) continue;
      const cells = [...row.querySelectorAll('.debug-metric-value')].map(text);
      if (cells.length !== columns.length) continue;
      const views = count(cells[vi]);
      if (views > 0) rows.push({ views, cells });
    }
    const metrics = {}, n = name => columns.indexOf(name);
    if (n('AVERAGE_WATCH_PERCENTAGE') >= 0) {
      const result = average(rows.map(r => percentage(r.cells[n('AVERAGE_WATCH_PERCENTAGE')])));
      if (result) metrics.duration = { ...result, source: `Среднее процентов просмотра по ${result.count} роликам отчёта за выбранный период. Каждый ролик имеет одинаковый вес.` };
    }
    if (n('AVERAGE_WATCH_TIME') >= 0) {
      const result = average(rows.map(r => seconds(r.cells[n('AVERAGE_WATCH_TIME')])));
      if (result) metrics.avd = { ...result, source: `Средняя длина одного просмотра по ${result.count} роликам отчёта за выбранный период.` };
    }
    for (const [name, column, label] of [['shares', 'SHARINGS', 'число публикаций через «Поделиться»']]) {
      if (n(column) < 0) continue;
      const values = rows.map(r => { const v = count(r.cells[n(column)]); return v === null ? null : v / r.views * 100; });
      const result = average(values);
      if (result) metrics[name] = { ...result, source: `Среднее (${label} ÷ просмотры × 100%) по ${result.count} роликам отчёта за выбранный период. Ролики без просмотров исключены.` };
    }
    return metrics;
  }
  function readMetrics(doc, rawUrl, mode) {
    return mode === 'explore' ? exploreMetrics(doc, rawUrl) : mode === 'content' ? contentMetrics(doc) : {};
  }
  // The Insights period chips («7 дней · 28 дней · 90 дней · Ещё»).
  function periodChips(doc) {
    for (const bar of doc.querySelectorAll('chip-bar-view-model')) {
      if (!visible(bar)) continue;
      const chips = [...bar.querySelectorAll('chip-view-model')];
      if (chips.filter(c => /^\d+\s*\D+$/.test(text(c))).length < 2) continue;
      return chips;
    }
    return [];
  }
  function dateRange(doc) {
    return text(periodChips(doc).find(c => c.querySelector('.ytChipShapeActive')));
  }
  function hash(s) {
    let value = 2166136261;
    for (const char of s) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return (value >>> 0).toString(36);
  }
  // The page title row («Статистика канала», «Контент»…): the first header with the «Расширенный режим» action.
  function titleRow(doc) {
    for (const header of doc.querySelectorAll('yt-shelf-header-layout')) {
      if (!visible(header)) continue;
      if (!header.querySelector('.ytShelfHeaderLayoutTrailingActions button')) continue;
      return header.querySelector('.ytShelfHeaderLayoutHeaderRow');
    }
    return null;
  }
  // Which signed-in Google account this Studio page belongs to (ytcfg SESSION_INDEX in the page's own scripts).
  function sessionIndex(doc) {
    for (const script of doc.querySelectorAll?.('script') || []) {
      const m = (script.textContent || '').match(/"SESSION_INDEX":"?(\d+)/);
      if (m) return Number(m[1]);
    }
    return undefined;
  }
  function context(doc, rawUrl) {
    const u = new URL(rawUrl), match = u.pathname.match(/^\/channel\/(UC[\w-]{22})\/analytics\/(hub_[a-z_]+)\/?$/);
    if (!match) return null;
    const channelId = match[1], range = dateRange(doc), days = Number((range.match(/^(\d+)/) || [])[1]);
    const home = doc.querySelector('#home-button')?.getAttribute('href') || '';
    if (!range || !PERIODS[days] || !home.includes('/channel/' + channelId) || !titleRow(doc)) return null;
    const base = `${u.origin}/channel/${channelId}/analytics/`, authuser = sessionIndex(doc);
    const withAccount = (href, n) => { if (n === undefined) return href; const x = new URL(href); x.searchParams.set('authuser', String(n)); return x.href; };
    const explore = new URL(base + 'hub_content/explore');
    for (const [k, v] of [['entity_type', 'CHANNEL'], ['entity_id', channelId], ['time_period', PERIODS[days]], ['explore_type', 'TABLE_AND_CHART'],
      ['metrics_computation_type', 'DELTA'], ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) explore.searchParams.set(k, v);
    for (const m of EXPLORE_METRICS) explore.searchParams.append('t_metrics', m);
    explore.searchParams.set('dimension', 'VIDEO');
    explore.searchParams.set('o_column', 'EXTERNAL_VIEWS');
    explore.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_DESC');
    return { channelId, range, period: PERIODS[days], key: `mbStudioSummary:${channelId}:${hash('insights|' + PERIODS[days])}`,
      contentUrl: withAccount(base + 'hub_content', authuser), exploreUrl: withAccount(explore.href, authuser), authuser };
  }
  function render(doc, ctx, record, onRefresh, effRecord) {
    const row = titleRow(doc);
    if (!row) return;
    let table = doc.querySelector(`[${ROOT}]`);
    if (!table) {
      table = doc.createElement('table'); table.setAttribute(ROOT, '');
      table.setAttribute('aria-label', 'Средние показатели канала');
      const head = doc.createElement('tr'), body = doc.createElement('tr');
      for (let i = 0; i < NAMES.length; i++) {
        const th = doc.createElement('th'); th.textContent = LABELS[i]; th.title = FULL_LABELS[i]; th.scope = 'col'; head.append(th);
        const td = doc.createElement('td'); td.setAttribute('data-metric', NAMES[i]); body.append(td);
      }
      const thead = doc.createElement('thead'), tbody = doc.createElement('tbody');
      thead.append(head); tbody.append(body); table.append(thead, tbody);
    }
    const label = row.querySelector('.ytShelfHeaderLayoutLabelContainer');
    if (table.parentElement !== row) (label ? label.after(table) : row.append(table));
    table.dataset.channel = ctx.channelId;
    const one = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const two = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    const efficiency = channelScore(effRecord, { week: 7, '4_weeks': 28, quarter: 90 }[ctx.period]);
    for (const name of NAMES) {
      const cell = table.querySelector(`[data-metric="${name}"]`), metric = record?.metrics?.[name];
      const ok = name === 'score' ? !!efficiency : metric && Number.isFinite(metric.value);
      let button = cell.querySelector('button');
      if (!button) {
        button = doc.createElement('button'); button.type = 'button'; button.setAttribute('data-refresh-likes', '');
        const span = doc.createElement('span'); span.setAttribute('data-likes-value', '');
        const icon = doc.createElement('span'); icon.setAttribute('data-refresh-icon', ''); icon.setAttribute('aria-hidden', 'true'); icon.textContent = '↻';
        button.append(span, icon); cell.replaceChildren(button);
      }
      const span = button.querySelector('[data-likes-value]');
      const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
      const labelText = !ok ? '—' : name === 'score' ? String(efficiency.value) : name === 'avd' ? clock(metric.value) : (name === 'shares' ? two : one).format(metric.value) + '%';
      if (span.textContent !== labelText) span.textContent = labelText;
      button.disabled = !!record?.loading;
      button.setAttribute('aria-label', record?.loading ? `Обновление: ${FULL_LABELS[NAMES.indexOf(name)]}` : 'Обновить показатели канала');
      const about = name === 'score' ? (ok ? efficiency.explain + '\n' : 'Нет роликов этого периода с прочитанными первыми 48 часами: нажмите ↻ в колонке «Эффективность» на странице «Контент».\n') : ok ? `${metric.source}\n${name === 'retention' ? 'Источник: блок удержания Studio.' : 'Период: ' + ctx.range}\nОбновлено: ${new Date(metric.at).toLocaleString('ru-RU')}\n` : '';
      button.title = record?.loading ? 'Загружаем отчёты этого канала.' : `${about}${record?.error ? record.error + '\n' : ''}Обновить все показатели из отчётов текущего канала.`;
      button.onclick = () => onRefresh?.(ctx);
    }
  }
  // The channel's «Эффективность»: the mean score of its videos released in the selected period, on the Content list
  // scale (yt-studio-efficiency.js, loaded in the same content-script world; its first-48-hours data).
  function channelScore(effRecord, days, now = Date.now()) {
    const scale = globalThis.__mbEfficiency || (typeof require === 'function' ? require('./yt-studio-efficiency.js') : null);
    if (!scale || !days || !effRecord?.early) return null;
    const all = scale.scores(effRecord.early), since = now - days * 86400000;
    const inside = Object.entries(all).filter(([id, s]) => !s.partial && effRecord.early[id]?.date && Date.parse(effRecord.early[id].date) >= since);
    if (!inside.length) return null;
    const value = Math.round(inside.reduce((a, [, s]) => a + s.value, 0) / inside.length);
    const sorted = inside.map(([, s]) => s.value).sort((a, b) => b - a);
    return { value, explain: `Среднее по ${inside.length} роликам, вышедшим за ${days} дней (лучший ${sorted[0]}, слабейший ${sorted.at(-1)}).` };
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { channelScore, percentage, count, average, contentMetrics, exploreMetrics, readMetrics, context, dateRange, render, PERIODS };
    return;
  }
  globalThis.__mbStudioSummaryCleanup?.();
  let effRecord = null, timer, collectorTimer, refreshTimer, current = null, record = null, lastRequest = '', lastRequestAt = 0, lastKey = '', keySince = 0;
  // Переключатель «Аналитика канала» в попапе (ключ ytsOn, по умолчанию
  // включён). Выключен — таблички нет и запросов в фон за данными тоже нет.
  let enabled = true;
  function hide() {
    document.querySelector(`[${ROOT}]`)?.remove();
    current = null; record = null; lastKey = ''; lastRequest = '';
  }
  const send = message => chrome.runtime.sendMessage(message);
  const style = document.createElement('style');
  style.textContent = `.ytShelfHeaderLayoutHeaderRow:has(>[${ROOT}]){flex-wrap:wrap;column-gap:16px;row-gap:6px}
    .ytShelfHeaderLayoutHeaderRow:has(>[${ROOT}])>.ytShelfHeaderLayoutLabelContainer{flex:0 1 auto}
    .ytShelfHeaderLayoutHeaderRow:has(>[${ROOT}])>.ytShelfHeaderLayoutTrailingActions{margin-left:auto}
    [${ROOT}]{border:1px solid var(--yt-spec-10-percent-layer,#3f3f3f);border-radius:6px;border-spacing:0;overflow:hidden;color:var(--yt-spec-text-primary,#f1f1f1);font-family:Roboto,Arial,sans-serif;margin:0 auto 0 0;flex:0 0 auto;width:auto;max-width:100%;align-self:center;table-layout:auto}
    [${ROOT}] th,[${ROOT}] td{text-align:center;padding:0 8px;border-right:1px solid var(--yt-spec-10-percent-layer,#3f3f3f);white-space:nowrap;letter-spacing:0}
    [${ROOT}] th{font-size:10px;line-height:12px;font-weight:400;color:var(--yt-spec-text-secondary,#aaa);padding-top:2px;padding-bottom:0}
    [${ROOT}] td{font-size:13px;line-height:15px;font-weight:500;padding-top:0;padding-bottom:2px;font-variant-numeric:tabular-nums}
    [${ROOT}] th:last-child,[${ROOT}] td:last-child{border-right:0}
    [${ROOT}] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:inherit;cursor:pointer}
    [${ROOT}] button:focus-visible{outline:1px solid currentColor;outline-offset:2px;border-radius:2px}
    [${ROOT}] [data-refresh-icon]{display:inline-block;font-size:13px;line-height:13px;color:var(--yt-spec-text-secondary,#aaa);opacity:0;transition:opacity .15s}
    [${ROOT}]:hover [data-refresh-icon],[${ROOT}] button:focus-visible [data-refresh-icon],[${ROOT}] button:disabled [data-refresh-icon]{opacity:1}
    [${ROOT}] button:disabled{cursor:wait;opacity:.65}
    [${ROOT}] button:disabled [data-refresh-icon]{animation:mb-summary-refresh 1s linear infinite}
    @keyframes mb-summary-refresh{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[${ROOT}] button:disabled [data-refresh-icon]{animation:none}}
    @media(max-width:1000px){[${ROOT}] th,[${ROOT}] td{padding-left:6px;padding-right:6px}[${ROOT}] th{font-size:9px}}`;
  document.documentElement.append(style);
  async function update() {
    if (!enabled) { hide(); return; }
    if (document.hidden) return;
    const ctx = context(document, location.href);
    if (!ctx) { document.querySelector(`[${ROOT}]`)?.remove(); current = null; return; }
    if (ctx.key !== lastKey) {
      lastKey = ctx.key; keySince = Date.now(); current = ctx; record = null; lastRequest = ''; effRecord = null;
      try { effRecord = (await chrome.storage.local.get('mbEfficiency:' + ctx.channelId))['mbEfficiency:' + ctx.channelId] || null; } catch {}
    }
    render(document, ctx, record, refresh, effRecord);
    if (Date.now() - keySince < 800) { schedule(); return; }
    // On «Контент» the visible CTR and retention are saved while the author looks at them.
    const metrics = /\/hub_content\/?$/.test(location.pathname) ? contentMetrics(document) : {};
    const signature = ctx.key + JSON.stringify(metrics);
    if (signature === lastRequest && Date.now() - lastRequestAt < 60000) return;
    lastRequest = signature; lastRequestAt = Date.now();
    try {
      const reply = await send({ type: 'mbStudioSummaryGet', context: ctx, metrics });
      if (current?.key !== ctx.key) return;
      if (reply?.ok) { record = reply.record; render(document, ctx, record, refresh, effRecord); }
    } catch { /* Reloaded extension: the next page load reconnects. */ }
  }
  async function refresh(requested) {
    const ctx = context(document, location.href);
    if (!ctx || ctx.key !== requested.key || current?.key !== ctx.key || record?.loading) return;
    record = { ...record, loading: true, error: '' };
    render(document, ctx, record, refresh, effRecord);
    try {
      const reply = await send({ type: 'mbStudioSummaryRefresh', context: ctx });
      if (current?.key !== ctx.key) return;
      record = reply?.ok ? reply.record : { ...record, loading: false, error: reply?.error || 'Не удалось обновить показатели. Нажмите ещё раз.' };
    } catch {
      if (current?.key !== ctx.key) return;
      record = { ...record, loading: false, error: 'Перезагрузите страницу после обновления расширения.' };
    }
    render(document, ctx, record, refresh, effRecord);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => void update(), 250); }
  const changed = (changes, area) => {
    if (area === 'local' && changes.ytsOn) {
      enabled = changes.ytsOn.newValue !== false;
      if (enabled) schedule(); else hide();
      return;
    }
    if (!enabled) return;
    if (area === 'local' && current && changes['mbEfficiency:' + current.channelId]) {
      effRecord = changes['mbEfficiency:' + current.channelId].newValue || null;
      render(document, current, record, refresh, effRecord);
    }
    if (area === 'local' && current && changes[current.key]) {
      record = changes[current.key].newValue;
      render(document, current, record, refresh, effRecord);
    }
  };
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => !m.target.parentElement?.closest(`[${ROOT}]`) && !m.target.closest?.(`[${ROOT}]`))) schedule();
  });
  // A background report tab: read it (choosing the requested period on «Контент») and hand the values back.
  function collect(job) {
    const started = Date.now();
    let stable = '', repeats = 0, finished = false, clickedAt = 0;
    collectorTimer = setInterval(async () => {
      if (finished) return;
      const home = document.querySelector('#home-button')?.getAttribute('href') || '';
      // A new tab opens Studio as the channel last chosen through the avatar menu. Another channel's report then
      // reads «У вас нет доступа к этой странице» and would only time out.
      if (!home && /нет доступа|немає доступу|don.t have (permission|access)/i.test((document.body?.innerText || '').slice(0, 2000))) {
        finished = true; clearInterval(collectorTimer);
        try { await send({ type: 'mbStudioSummaryResult', nonce: job.nonce, range: job.context.range, denied: true }); } catch {}
        return;
      }
      if (!home.includes('/channel/' + job.context.channelId)) return;
      if (job.mode === 'now') {
        // «Сейчас»: the channel's videos over the last 7 days.
        if (new URL(location.href).searchParams.get('time_period') !== 'week') return;
        const now = globalThis.__mbEfficiency?.readWeek(document) || {}, signature = JSON.stringify(now);
        repeats = signature === stable ? repeats + 1 : 0; stable = signature;
        if ((!Object.keys(now).length && Date.now() - started < 20000) || (Object.keys(now).length && repeats < 2)) return;
        finished = true; clearInterval(collectorTimer);
        try { await send({ type: 'mbStudioSummaryResult', nonce: job.nonce, range: job.context.range, now }); } catch {}
        return;
      }
      if (job.mode.startsWith('early:')) {
        // «Эффективность»: this tab shows one video's day-by-day report; its first two days are kept.
        const scale = globalThis.__mbEfficiency, rows = scale?.readDays(document), signature = JSON.stringify(rows);
        repeats = signature === stable ? repeats + 1 : 0; stable = signature;
        if ((!rows?.length && Date.now() - started < 20000) || (rows?.length && repeats < 2)) return;
        finished = true; clearInterval(collectorTimer);
        const e = scale?.early(rows), id = job.mode.slice(6);
        try { await send({ type: 'mbStudioSummaryResult', nonce: job.nonce, range: job.context.range, early: e ? { [id]: e } : {} }); } catch {}
        return;
      }
      if (job.mode === 'content') {
        const chips = periodChips(document), active = chips.find(c => c.querySelector('.ytChipShapeActive'));
        if (!chips.length) return;
        if (text(active) !== job.context.range) {
          if (Date.now() - clickedAt > 3000) { clickedAt = Date.now(); chips.find(c => text(c) === job.context.range)?.querySelector('button')?.click(); }
          return;
        }
      } else if (new URL(location.href).searchParams.get('time_period') !== job.context.period) return;
      const metrics = readMetrics(document, location.href, job.mode), signature = JSON.stringify(metrics);
      repeats = signature === stable ? repeats + 1 : 0; stable = signature;
      const complete = job.mode === 'content' ? !!(metrics.ctr && metrics.retention) : !!(metrics.duration && metrics.avd && metrics.shares);
      if ((!complete && Date.now() - started < 20000) || repeats < 2) return;
      finished = true; clearInterval(collectorTimer);
      try { await send({ type: 'mbStudioSummaryResult', nonce: job.nonce, range: job.context.range, metrics }); } catch {}
    }, 600);
  }
  async function boot() {
    let probe;
    try { probe = await send({ type: 'mbStudioSummaryProbe' }); } catch { return; }
    if (probe?.collector) { style.remove(); collect(probe.collector); return; }
    try { enabled = (await chrome.storage.local.get('ytsOn')).ytsOn !== false; } catch {}
    chrome.storage.onChanged.addListener(changed);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('popstate', schedule); document.addEventListener('yt-navigate-finish', schedule);
    document.addEventListener('visibilitychange', schedule);
    refreshTimer = setInterval(schedule, 60000);
    schedule();
  }
  globalThis.__mbStudioSummaryCleanup = () => {
    clearTimeout(timer); clearInterval(collectorTimer); clearInterval(refreshTimer); observer.disconnect(); style.remove();
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener('popstate', schedule); document.removeEventListener('yt-navigate-finish', schedule);
    document.removeEventListener('visibilitychange', schedule);
    document.querySelector(`[${ROOT}]`)?.remove();
  };
  void boot();
})();
