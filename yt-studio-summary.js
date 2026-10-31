// A compact channel header table. Every value comes from rendered Studio reports.
(() => {
  const ROOT = 'data-multibot-channel-summary';
  const NAMES = ['ctr', 'duration', 'retention', 'likes', 'shares'];
  const LABELS = ['CTR', 'Просмотр', '0:30', 'Лайки/просм.', 'Поделились/просм.'];
  const FULL_LABELS = ['Средний CTR', 'Средний процент просмотра', 'Удержание на отметке 0:30', 'Среднее соотношение лайков к просмотрам', 'Среднее соотношение числа публикаций через «Поделиться» к просмотрам'];
  const text = e => (e?.textContent || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = e => e && !e.closest('[hidden], [aria-hidden="true"]') && e.getClientRects().length > 0;
  function percentage(value) {
    const m = String(value || '').replace(/[\u00a0\u202f]/g, ' ').match(/^\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?\s*$/);
    return m ? Number(m[1].replace(',', '.')) : null;
  }
  function count(value) {
    const s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '');
    // Counts in the detailed report are exact. Never treat abbreviated 1.2K as exact.
    return /^\d+$/.test(s) ? Number(s) : null;
  }
  function average(values) {
    const valid = values.filter(v => Number.isFinite(v) && v >= 0);
    return valid.length ? { value: valid.reduce((a, b) => a + b, 0) / valid.length, count: valid.length } : null;
  }
  function durationMetric(doc) {
    for (const table of doc.querySelectorAll('yta-top-performing-entities')) {
      const headers = [...table.querySelectorAll('.header.metric')];
      const index = headers.findIndex(h => /средняя продолжительность просмотра|середня тривалість перегляду|average view duration/i.test(text(h)));
      if (index < 0) continue;
      const rows = [...table.querySelectorAll('.row')].filter(visible);
      const result = average(rows.map(row => percentage(text(row.querySelectorAll('.metric-cell')[index]?.querySelector('.percentage')))));
      if (result) return { ...result, source: `Среднее процентов по ${result.count} показанным роликам в обзоре. Каждый ролик имеет одинаковый вес.` };
    }
    return null;
  }
  function contentMetrics(doc) {
    const metrics = {};
    for (const block of doc.querySelectorAll('yta-key-metric-block')) {
      if (!visible(block)) continue;
      if (/CTR|click.through.rate|рейтинг кліків/i.test(text(block.querySelector('#metric-label')))) {
        const value = percentage(text(block.querySelector('#metric-total')));
        if (value !== null) metrics.ctr = { value, count: 1, source: 'Показатель CTR из вкладки «Контент» за выбранный период.' };
      }
    }
    for (const card of doc.querySelectorAll('yta-audience-retention-highlights-channel-card-v2')) {
      if (!visible(card)) continue;
      if (!/0\s*:\s*30/.test(text(card.querySelector('.rows-header-title-right')))) continue;
      const values = [...card.querySelectorAll('.left-side .row')].filter(visible).map(row => percentage(text(row.querySelector('.value'))));
      const result = average(values);
      if (result) metrics.retention = { ...result, source: `Среднее по ${result.count} роликам блока 0:30. Блок Studio использует видео, опубликованные за последние 365 дней.` };
    }
    return metrics;
  }
  function ratioMetric(doc, rawUrl, metricName) {
    const u = new URL(rawUrl), columns = u.searchParams.getAll('t_metrics');
    const vi = columns.indexOf('EXTERNAL_VIEWS'), li = columns.indexOf(metricName);
    if (vi < 0 || li < 0 || u.searchParams.get('dimension') !== 'VIDEO') return null;
    const root = doc.querySelector('#debug-explore-table');
    if (!root || !visible(root)) return null;
    const values = [];
    for (const row of root.querySelectorAll('yta-explore-table-row')) {
      const label = text(row.querySelector('.debug-dimension-value'));
      if (!label || /^(итого|total|усього|всього)$/i.test(label)) continue;
      const cells = [...row.querySelectorAll('.debug-metric-value')];
      if (cells.length !== columns.length) continue;
      const views = count(text(cells[vi])), likes = count(text(cells[li]));
      if (views > 0 && likes !== null && (metricName !== 'RATINGS_LIKES' || likes <= views)) values.push(likes / views * 100);
    }
    const result = average(values);
    const label = metricName === 'SHARINGS' ? 'число публикаций через «Поделиться»' : 'лайки';
    return result ? { ...result, source: `Среднее (${label} ÷ просмотры × 100%) по ${result.count} роликам отчёта за выбранный период. Ролики без просмотров исключены.` } : null;
  }
  const likesMetric = (doc, url) => ratioMetric(doc, url, 'RATINGS_LIKES');
  const sharesMetric = (doc, url) => ratioMetric(doc, url, 'SHARINGS');
  function readMetrics(doc, rawUrl, mode) {
    if (mode === 'content') return contentMetrics(doc);
    const value = mode === 'likes' ? likesMetric(doc, rawUrl) : mode === 'shares' ? sharesMetric(doc, rawUrl) : durationMetric(doc);
    return value ? { [['likes', 'shares'].includes(mode) ? mode : 'duration']: value } : {};
  }
  function dateRange(doc) {
    const picker = [...doc.querySelectorAll('yta-time-picker')].filter(visible).at(-1);
    return text(picker?.querySelector('.label-text'));
  }
  function hash(s) {
    let value = 2166136261;
    for (const char of s) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return (value >>> 0).toString(36);
  }
  function context(doc, rawUrl) {
    const u = new URL(rawUrl), match = u.pathname.match(/^\/channel\/(UC[\w-]{22})\/analytics\/(tab-[^/]+)\/(period-[^/]+)(?:\/|$)/);
    if (!match || u.pathname.includes('/explore')) return null;
    const channelId = match[1], range = dateRange(doc);
    const home = doc.querySelector('#home-button')?.getAttribute('href') || '';
    if (!range || !home.includes('/channel/' + channelId)) return null;
    const heading = [...doc.querySelectorAll('h1')].find(e => visible(e) && /аналитика по каналу|аналітика каналу|channel analytics/i.test(text(e)));
    if (!heading) return null;
    const advanced = doc.querySelector('#page-title-container .advanced-analytics-container a[href]') ||
      [...doc.querySelectorAll('a[href]')].find(a => a.getAttribute('href').includes('/analytics/') && a.getAttribute('href').includes('/explore?'));
    if (!advanced) return null;
    const overview = new URL(u), content = new URL(u), likes = new URL(advanced.getAttribute('href'), u.origin);
    overview.pathname = u.pathname.replace(/\/tab-[^/]+\//, '/tab-overview/');
    content.pathname = u.pathname.replace(/\/tab-[^/]+\//, '/tab-content/');
    likes.searchParams.delete('t_metrics');
    likes.searchParams.append('t_metrics', 'EXTERNAL_VIEWS');
    likes.searchParams.append('t_metrics', 'RATINGS_LIKES');
    likes.searchParams.set('dimension', 'VIDEO');
    likes.searchParams.set('metric', 'EXTERNAL_VIEWS');
    likes.searchParams.set('o_column', 'EXTERNAL_VIEWS');
    const shares = new URL(likes);
    shares.searchParams.delete('t_metrics');
    shares.searchParams.append('t_metrics', 'EXTERNAL_VIEWS');
    shares.searchParams.append('t_metrics', 'SHARINGS');
    const period = new URL(likes); period.searchParams.delete('t_metrics');
    period.searchParams.delete('metric'); period.searchParams.delete('o_column');
    period.pathname = period.pathname.replace(/\/tab-[^/]+\//, '/tab-overview/');
    return { channelId, range, key: `mbStudioSummary:${channelId}:${hash(range + '|' + period.href)}`,
      overviewUrl: overview.href, contentUrl: content.href, likesUrl: likes.href, sharesUrl: shares.href };
  }
  function render(doc, ctx, record, onRefreshLikes) {
    const heading = [...doc.querySelectorAll('h1')].find(e => visible(e) && /аналитика по каналу|аналітика каналу|channel analytics/i.test(text(e)));
    if (!heading) return;
    const parent = heading.parentElement;
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
      heading.after(table);
    } else if (table.parentElement !== parent) heading.after(table);
    table.dataset.channel = ctx.channelId;
    const formatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    for (const name of NAMES) {
      const cell = table.querySelector(`[data-metric="${name}"]`), saved = record?.metrics?.[name];
      const metric = saved && Date.now() >= saved.at && (['likes', 'shares'].includes(name) || Date.now() - saved.at < 15 * 60000) ? saved : null;
      const value = metric && Number.isFinite(metric.value) ? (name === 'shares' ? new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(metric.value) : formatter.format(metric.value)) + '%' : '-';
      const title = metric ? `${metric.source}\n${name === 'retention' ? 'Источник: блок удержания Studio.' : ctx.range}\nОбновлено: ${new Date(metric.at).toLocaleString('ru-RU')}` : 'Откройте соответствующую вкладку аналитики для чтения показателя.';
      if (['likes', 'shares'].includes(name)) {
        let button = cell.querySelector('button');
        if (!button) {
          button = doc.createElement('button'); button.type = 'button'; button.setAttribute('data-refresh-likes', '');
          const label = doc.createElement('span'); label.setAttribute('data-likes-value', '');
          const icon = doc.createElement('span'); icon.setAttribute('data-refresh-icon', ''); icon.setAttribute('aria-hidden', 'true'); icon.textContent = '↻';
          button.append(label, icon); cell.replaceChildren(button);
        }
        const label = button.querySelector('[data-likes-value]'), labelText = metric ? value : 'Обновить';
        if (label.textContent !== labelText) label.textContent = labelText;
        button.disabled = !!record?.loading;
        const labelName = name === 'shares' ? 'публикации к просмотрам' : 'лайки к просмотрам';
        button.setAttribute('aria-label', record?.loading ? `Обновление: ${labelName}` : `Обновить ${labelName}`);
        button.title = record?.loading ? 'Загружаем отчёт этого канала.' : `${metric ? title + '\n' : ''}${record?.error ? record.error + '\n' : ''}Обновить из отчёта текущего канала.`;
        button.onclick = () => onRefreshLikes?.(ctx, name);
        continue;
      }
      if (cell.textContent !== value) cell.textContent = value;
      if (cell.title !== title) cell.title = title;
    }
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { percentage, count, average, durationMetric, contentMetrics, likesMetric, sharesMetric, readMetrics, context, dateRange, render };
    return;
  }
  globalThis.__mbStudioSummaryCleanup?.();
  let timer, collectorTimer, refreshTimer, current = null, record = null, lastRequest = '', lastRequestAt = 0, lastKey = '', keySince = 0;
  // Переключатель «Аналитика канала» в попапе (ключ ytsOn, по умолчанию
  // включён). Выключен — таблички нет и запросов в фон за данными тоже нет.
  let enabled = true;
  function hide() {
    document.querySelector(`[${ROOT}]`)?.remove();
    current = null; record = null; lastKey = ''; lastRequest = '';
  }
  const send = message => chrome.runtime.sendMessage(message);
  const style = document.createElement('style');
  style.textContent = `#page-title-container:has(>[${ROOT}]){display:flex;align-items:center;flex-wrap:wrap;column-gap:12px;row-gap:6px;height:auto;min-height:64px;padding-top:0;padding-bottom:0;box-sizing:border-box}
    #page-title-container:has(>[${ROOT}])>h1{flex:0 0 auto;min-width:0;margin:0!important;padding-top:0!important;padding-bottom:0!important;line-height:1.25;align-self:center}
    #page-title-container:has(>[${ROOT}])>.advanced-analytics-container{margin-left:auto;flex-shrink:0}
    [${ROOT}]{border:1px solid var(--ytcp-line-divider,#3f3f3f);border-radius:6px;border-spacing:0;overflow:hidden;color:var(--ytcp-text-primary,#f1f1f1);font-family:Roboto,Arial,sans-serif;margin:0 auto 0 0;flex:0 0 auto;width:auto;max-width:100%;align-self:center;table-layout:auto;transform:translateY(3px)}
    [${ROOT}] th,[${ROOT}] td{text-align:center;padding:0 8px;border-right:1px solid var(--ytcp-line-divider,#3f3f3f);white-space:nowrap;letter-spacing:0}
    [${ROOT}] th{font-size:10px;line-height:12px;font-weight:400;color:var(--ytcp-text-secondary,#aaa);padding-top:2px;padding-bottom:0}
    [${ROOT}] td{font-size:13px;line-height:15px;font-weight:500;padding-top:0;padding-bottom:2px;font-variant-numeric:tabular-nums}
    [${ROOT}] th:last-child,[${ROOT}] td:last-child{border-right:0}
    [${ROOT}] button{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:0;border:0;background:transparent;color:inherit;font:inherit;line-height:inherit;cursor:pointer}
    [${ROOT}] button:hover{color:var(--ytcp-text-primary,#fff)}
    [${ROOT}] button:focus-visible{outline:1px solid currentColor;outline-offset:2px;border-radius:2px}
    [${ROOT}] [data-refresh-icon]{display:inline-block;font-size:14px;line-height:14px;color:var(--ytcp-text-secondary,#aaa)}
    [${ROOT}] button:disabled{cursor:wait;opacity:.65}
    [${ROOT}] button:disabled [data-refresh-icon]{animation:mb-summary-refresh 1s linear infinite}
    @keyframes mb-summary-refresh{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[${ROOT}] button:disabled [data-refresh-icon]{animation:none}}
    @media(max-width:1000px){[${ROOT}] th,[${ROOT}] td{padding-left:6px;padding-right:6px}[${ROOT}] th{font-size:9px}}
    @media(max-width:560px){[${ROOT}]{max-width:100%}[${ROOT}] th{white-space:normal}}`;
  document.documentElement.append(style);
  async function update() {
    if (!enabled) { hide(); return; }
    if (document.hidden) return;
    const ctx = context(document, location.href);
    if (!ctx) { document.querySelector(`[${ROOT}]`)?.remove(); current = null; return; }
    if (ctx.key !== lastKey) { lastKey = ctx.key; keySince = Date.now(); current = ctx; record = null; lastRequest = ''; }
    render(document, ctx, record, refreshLikes);
    if (Date.now() - keySince < 800) { schedule(); return; }
    const metrics = readMetrics(document, location.href, location.pathname.includes('/tab-content/') ? 'content' : 'overview');
    const signature = ctx.key + JSON.stringify(metrics);
    if (signature === lastRequest && Date.now() - lastRequestAt < 60000) return;
    lastRequest = signature; lastRequestAt = Date.now();
    try {
      const reply = await send({ type: 'mbStudioSummaryGet', context: ctx, metrics });
      if (current?.key !== ctx.key) return;
      if (reply?.ok) { record = reply.record; render(document, ctx, record, refreshLikes); }
    } catch { /* Reloaded extension: the next page load reconnects. */ }
  }
  async function refreshLikes(requested, metric = 'likes') {
    const ctx = context(document, location.href);
    if (!ctx || ctx.key !== requested.key || current?.key !== ctx.key || record?.loading) return;
    record = { ...record, loading: true, error: '' };
    render(document, ctx, record, refreshLikes);
    try {
      const reply = await send({ type: metric === 'shares' ? 'mbStudioSummaryRefreshShares' : 'mbStudioSummaryRefreshLikes', context: ctx });
      if (current?.key !== ctx.key) return;
      record = reply?.ok ? reply.record : { ...record, loading: false, error: reply?.error || 'Не удалось обновить показатель. Нажмите ещё раз.' };
    } catch {
      if (current?.key !== ctx.key) return;
      record = { ...record, loading: false, error: 'Перезагрузите страницу после обновления расширения.' };
    }
    render(document, ctx, record, refreshLikes);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => void update(), 250); }
  const changed = (changes, area) => {
    if (area === 'local' && changes.ytsOn) {
      enabled = changes.ytsOn.newValue !== false;
      if (enabled) schedule(); else hide();
      return;
    }
    if (!enabled) return;
    if (area === 'local' && current && changes[current.key]) {
      record = changes[current.key].newValue;
      render(document, current, record, refreshLikes);
    }
  };
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => !m.target.parentElement?.closest(`[${ROOT}]`) && !m.target.closest?.(`[${ROOT}]`))) schedule();
  });
  async function boot() {
    let probe;
    try { probe = await send({ type: 'mbStudioSummaryProbe' }); } catch { return; }
    if (probe?.collector) {
      style.remove();
      const job = probe.collector, started = Date.now();
      let stable = '', repeats = 0, finished = false;
      collectorTimer = setInterval(async () => {
        if (finished) return;
        const metrics = readMetrics(document, location.href, job.mode), range = dateRange(document);
        const signature = JSON.stringify(metrics);
        repeats = signature === stable ? repeats + 1 : 0; stable = signature;
        const complete = job.mode === 'content' ? !!(metrics.ctr && metrics.retention) : !!metrics[['likes', 'shares'].includes(job.mode) ? job.mode : 'duration'];
        const home = document.querySelector('#home-button')?.getAttribute('href') || '';
        if (!home.includes('/channel/' + job.context.channelId) || range !== job.context.range || (!complete && Date.now() - started < 30000) || repeats < 2) return;
        finished = true; clearInterval(collectorTimer);
        try { await send({ type: 'mbStudioSummaryResult', nonce: job.nonce, range, metrics }); } catch {}
      }, 600);
      return;
    }
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
