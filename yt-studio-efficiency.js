// «Эффективность» column on the Studio Content list: how strongly a video's first 48 hours ask YouTube to push it.
// Measured on the author's channels (22 November 2026, Тимми, Валентин Чичваркин, Космос PRO, 69 videos with daily
// data): a video gets impressions later when its first two days give many seconds watched per impression (CTR × average
// view length) and many subscribers per 1000 views. Lifetime likes, shares and percentage viewed fall as a video reaches
// a colder audience, so they describe reach, not its cause, and are left out. Each measure is compared with the same
// channel's other videos (percentile), so niches do not compete. Views do not count. Weights 70/30 from that sample.
(() => {
  const ROOT = 'data-multibot-efficiency';
  const EARLY_DAYS = 2, MIN_EARLY_VIEWS = 20, MAX_IDS = 60;
  const MEASURES = [
    ['Секунд просмотра на показ', 'wpi', 0.7],
    ['Подписок на 1000 просмотров', 'subs', 0.3],
  ];
  const METRICS = ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_TIME', 'SUBSCRIBERS_NET_CHANGE'];
  const text = e => (e?.textContent || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
  const number = s => { const v = Number(String(s ?? '').replace(/[\s  %]/g, '').replace(',', '.')); return Number.isFinite(v) ? v : null; };
  const seconds = s => { const m = String(s || '').match(/^(?:(\d+):)?(\d+):(\d{2})$/); return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; };
  // One video's day-by-day report in «Расширенный режим», oldest day first.
  function dayUrl(channelId, videoId) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'VIDEO'], ['entity_id', videoId], ['time_period', 'lifetime'], ['explore_type', 'TABLE_AND_CHART'],
      ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) u.searchParams.set(k, v);
    for (const m of METRICS) u.searchParams.append('t_metrics', m);
    u.searchParams.set('dimension', 'DAY');
    u.searchParams.set('o_column', 'DAY');
    u.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_ASC');
    return u.href;
  }
  function readDays(doc) {
    const root = doc.querySelector('#debug-explore-table');
    if (!root) return null;
    return [...root.querySelectorAll('yta-explore-table-row')]
      .map(row => [text(row.querySelector('.debug-dimension-value')), ...[...row.querySelectorAll('.debug-metric-value')].map(text)])
      .filter(r => r[0] && r.length === METRICS.length + 1 && !/^(итого|total|усього|всього|разом)$/i.test(r[0]));
  }
  const MONTHS = ['янв|січ|jan', 'фев|лют|feb', 'мар|бер|mar', 'апр|кві|apr', 'ма[йя]|тра|may', 'июн|чер|jun', 'июл|лип|jul', 'авг|сер|aug', 'сен|вер|sep', 'окт|жов|oct', 'ноя|лис|nov', 'дек|гру|dec'];
  function parseDate(s) {
    const m = String(s).toLowerCase().match(/(\d{1,2})\s+([a-zа-яёіїє]+)\.?,?\s+(\d{4})|([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (!m) return null;
    const [day, word, year] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
    const month = MONTHS.findIndex(p => new RegExp('^(' + p + ')').test(word));
    return month < 0 ? null : `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // The first two days of the report: the window in which YouTube decides how widely to test a video.
  function early(rows) {
    if (!rows?.length) return null;
    let views = 0, impr = 0, clicks = 0, watch = 0, subs = 0;
    for (const r of rows.slice(0, EARLY_DAYS)) {
      const v = number(r[1]) || 0, i = number(r[2]) || 0;
      views += v; impr += i; clicks += (number(r[3]) || 0) / 100 * i; watch += (seconds(r[4]) || 0) * v; subs += number(r[5]) || 0;
    }
    return { date: parseDate(rows[0][0]), days: Math.min(rows.length, EARLY_DAYS), views, impr,
      ctr: impr ? clicks / impr * 100 : null, avd: views ? watch / views : null, subs };
  }
  function measures(e) {
    if (!e || !(e.views >= MIN_EARLY_VIEWS) || !(e.impr > 0) || !Number.isFinite(e.ctr) || !Number.isFinite(e.avd)) return null;
    return { wpi: e.ctr / 100 * e.avd, subs: Math.max(0, e.subs) / e.views * 1000 };
  }
  // Percentile among the channel's videos with complete first two days: 0 = weakest on the channel, 100 = strongest.
  function scores(earlyById) {
    const known = Object.entries(earlyById || {}).map(([id, e]) => [id, e, measures(e)]).filter(([, e, m]) => m && e.days >= EARLY_DAYS);
    const rank = (key, value) => {
      const all = known.map(([, , m]) => m[key]);
      if (all.length < 2) return 50;
      const below = all.filter(v => v < value).length, equal = all.filter(v => v === value).length;
      return Math.max(0, Math.min(100, (below + (equal - 1) / 2) / (all.length - 1) * 100));
    };
    const result = {};
    for (const [id, e] of Object.entries(earlyById || {})) {
      const m = measures(e);
      if (!m) continue;
      const parts = MEASURES.map(([label, key, weight]) => ({ label, key, weight, value: m[key], points: rank(key, m[key]) }));
      result[id] = { value: Math.round(parts.reduce((a, p) => a + p.points * p.weight, 0)), parts, partial: e.days < EARLY_DAYS, compared: known.length };
    }
    return result;
  }
  const one = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v);
  function explain(result) {
    const lines = result.parts.map(p => `${p.label} (48 ч): ${one(p.value)} → ${Math.round(p.points)}`);
    if (result.partial) lines.push('Прошло меньше 48 часов: оценка предварительная.');
    return lines.join('\n');
  }
  // Which signed-in Google account this Studio page belongs to (ytcfg SESSION_INDEX in the page's own scripts).
  function sessionIndex(doc) {
    for (const script of doc.querySelectorAll?.('script') || []) {
      const m = (script.textContent || '').match(/"SESSION_INDEX":"?(\d+)/);
      if (m) return Number(m[1]);
    }
    return undefined;
  }
  function context(rawUrl, doc) {
    const m = new URL(rawUrl).pathname.match(/^\/channel\/(UC[\w-]{22})\/videos(?:\/|$)/);
    if (!m) return null;
    const home = doc.querySelector('#home-button')?.getAttribute('href') || '';
    if (!home.includes('/channel/' + m[1])) return null;
    return { channelId: m[1], key: 'mbEfficiency:' + m[1], range: 'early', period: 'early',
      earlyUrl: `https://studio.youtube.com/channel/${m[1]}/analytics/hub_overview`, ids: [], authuser: sessionIndex(doc) };
  }
  // Videos on the page without their first two days yet (new ones are read again until both days are in).
  function missing(ids, earlyById) {
    return [...new Set(ids)].filter(id => /^[\w-]{11}$/.test(id) && !(earlyById?.[id]?.days >= EARLY_DAYS)).slice(0, MAX_IDS);
  }
  // «Сейчас»: the same formula as «Эффективность» (seconds watched per impression 70%, subscribers per 1000 views 30%,
  // ranked inside the channel), on the last 7 days instead of the first 48 hours (author, 22 November 2026: the two
  // columns must be comparable). Videos YouTube hardly shows this week are not scored.
  const WEEK_METRICS = ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_TIME', 'SUBSCRIBERS_NET_CHANGE'];
  const MIN_NOW_IMPRESSIONS = 200;
  function weekUrl(channelId) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'CHANNEL'], ['entity_id', channelId], ['time_period', 'week'], ['explore_type', 'TABLE_AND_CHART'],
      ['metrics_computation_type', 'DELTA'], ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) u.searchParams.set(k, v);
    for (const m of WEEK_METRICS) u.searchParams.append('t_metrics', m);
    u.searchParams.set('dimension', 'VIDEO');
    u.searchParams.set('o_column', 'VIDEO_THUMBNAIL_IMPRESSIONS');
    u.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_DESC');
    return u.href;
  }
  function readWeek(doc) {
    const root = doc.querySelector('#debug-explore-table'), result = {};
    if (!root) return result;
    for (const row of root.querySelectorAll('yta-explore-table-row')) {
      const id = (row.querySelector('img')?.getAttribute('src') || '').match(/\/vi(?:_webp)?\/([\w-]{11})\//)?.[1];
      const c = [...row.querySelectorAll('.debug-metric-value')].map(text);
      if (!id || c.length !== WEEK_METRICS.length) continue;
      result[id] = { views: number(c[0]) || 0, impr: number(c[1]) || 0, ctr: number(c[2]), avd: seconds(c[3]), subs: number(c[4]) || 0 };
    }
    return result;
  }
  function nowScores(byId) {
    const known = Object.entries(byId || {}).filter(([, v]) => v.impr >= MIN_NOW_IMPRESSIONS && Number.isFinite(v.subs)).map(([id, v]) => [id, v, measures(v)]).filter(([, , m]) => m);
    const rank = (key, value) => {
      if (known.length < 2) return 50;
      const all = known.map(([, , m]) => m[key]), below = all.filter(x => x < value).length, equal = all.filter(x => x === value).length;
      return (below + (equal - 1) / 2) / (all.length - 1) * 100;
    };
    const result = {};
    for (const [id, v, m] of known) {
      const parts = MEASURES.map(([label, key, weight]) => ({ label, key, weight, value: m[key], points: rank(key, m[key]) }));
      result[id] = { value: Math.round(parts.reduce((a, p) => a + p.points * p.weight, 0)), parts, impr: v.impr };
    }
    return result;
  }
  function explainNow(result) {
    return result.parts.map(p => `${p.label} (7 дн): ${one(p.value)} → ${Math.round(p.points)}`).join('\n') +
      `\nПоказов за 7 дней: ${new Intl.NumberFormat('ru-RU').format(result.impr)}`;
  }
  const api = { sessionIndex, dayUrl, readDays, early, parseDate, measures, scores, explain, context, missing, weekUrl, readWeek, nowScores, explainNow, MEASURES, MAX_IDS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  globalThis.__mbEfficiency = api;   // the collector tab and the Insights table use the same scale
  globalThis.__mbEfficiencyCleanup?.();
  let enabled = true, ctx = null, record = null, timer, lastKey = '';
  const send = message => chrome.runtime.sendMessage(message);
  const style = document.createElement('style');
  // Studio's own .cell-header rules are more specific than ours: the width needs !important on both header and cells,
  // or the header column is narrower than the rows and its label runs into «Комментарии».
  style.textContent = `[${ROOT}]{flex:0 0 150px!important;width:150px!important;min-width:150px!important;max-width:150px!important;box-sizing:border-box!important;padding:0 24px 0 12px!important;display:flex!important;justify-content:flex-end!important}
    [${ROOT}=cell],[${ROOT}=nowcell]{align-items:flex-start!important;padding-top:12px!important}
    [${ROOT}=nowhead],[${ROOT}=nowcell]{flex-basis:110px!important;width:110px!important;min-width:110px!important;max-width:110px!important}
    [${ROOT}=nowhead]{align-items:center!important}
    [${ROOT}=cell] b,[${ROOT}=nowcell] b{display:inline-block;min-width:34px;padding:2px 6px;border-radius:10px;font:500 14px/18px Roboto,Arial,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
    [${ROOT}=cell] b[data-partial]{opacity:.6}
    [${ROOT}=head]{align-items:center!important;gap:4px;white-space:nowrap}
    [${ROOT}=head] button{border:0;background:transparent;color:var(--yt-spec-text-secondary,#aaa);cursor:pointer;font-size:14px;line-height:14px;padding:2px}
    [${ROOT}=head] button:disabled{cursor:wait;animation:mb-eff-spin 1s linear infinite}
    @keyframes mb-eff-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[${ROOT}=head] button:disabled{animation:none}}`;
  const color = v => v >= 70 ? ['#1b5e20', '#c8e6c9'] : v >= 40 ? ['#5d4a00', '#ffe9a8'] : ['#6d1b1b', '#ffcdd2'];
  // Videos of the page that have views (a scheduled or private video has no report to read).
  const pageIds = () => [...document.querySelectorAll('ytcp-video-row')]
    .filter(row => (number(text(row.querySelector('.tablecell-views'))) || 0) > 0)
    .map(row => [...row.querySelectorAll('a[href]')].map(a => a.getAttribute('href').match(/\/video\/([\w-]{11})/)?.[1]).find(Boolean)).filter(Boolean);
  function header() {
    const last = [...document.querySelectorAll('.cell-header[class*=tablecell-]')].filter(e => !e.closest('ytcp-video-row') && !e.hasAttribute(ROOT)).at(-1);
    if (!last) return;
    let head = last.parentElement.querySelector(`[${ROOT}=head]`);
    if (!head) {
      head = document.createElement('div'); head.setAttribute(ROOT, 'head'); head.className = last.className.replace(/tablecell-\S+/g, '').trim();
      const label = document.createElement('span'); label.textContent = 'Эффективность';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '↻';
      button.onclick = () => void refresh();
      head.append(label, button);
    }
    if (head.previousElementSibling !== last) last.after(head);
    let nowHead = head.parentElement.querySelector(`[${ROOT}=nowhead]`);
    if (!nowHead) { nowHead = document.createElement('div'); nowHead.setAttribute(ROOT, 'nowhead'); nowHead.className = head.className; nowHead.textContent = 'Сейчас'; }
    if (nowHead.previousElementSibling !== head) head.after(nowHead);
    nowHead.title = 'Та же формула, что «Эффективность» (секунды просмотра на показ и подписки на 1000 просмотров), за последние 7 дней, по сравнению с другими роликами канала. ' +
      `Ролики меньше чем с ${MIN_NOW_IMPRESSIONS} показами за неделю не оцениваются.` + (record?.nowAt ? `\nДанные: ${new Date(record.nowAt).toLocaleString('ru-RU')}` : '');
    const button = head.querySelector('button'), left = missing(pageIds(), record?.early).length;
    button.disabled = !!record?.loading;
    // A failed refresh shows ⚠ in place of ↻: its reason is in the tooltip, a click tries again.
    const mark = record?.error && !record?.loading ? '⚠' : '↻';
    if (button.textContent !== mark) button.textContent = mark;
    button.style.color = mark === '⚠' ? '#f9ab00' : '';
    head.title = 'Насколько первые 48 часов ролика просят YouTube его продвигать: секунды просмотра на показ и подписки на 1000 просмотров, ' +
      'по сравнению с другими роликами этого канала. Просмотры не учитываются.' + (record?.error ? '\n' + record.error : '');
    button.title = record?.loading ? 'Читаем отчёты роликов…' : record?.error ? record.error : `Обновить «Сейчас» за 7 дней${left ? ` и прочитать первые 48 часов: ${left} ролик(ов)` : ''}`;
    button.setAttribute('aria-label', button.title);
  }
  function rows() {
    const all = scores(record?.early), now = nowScores(record?.now);
    for (const row of document.querySelectorAll('ytcp-video-row')) {
      const last = [...row.querySelectorAll('.cell-body[class*=tablecell-]')].filter(e => !e.hasAttribute(ROOT)).at(-1);
      if (!last) continue;
      let cell = last.parentElement.querySelector(`[${ROOT}=cell]`);
      if (!cell) { cell = document.createElement('div'); cell.setAttribute(ROOT, 'cell'); cell.className = 'cell-body'; cell.append(document.createElement('b')); }
      if (cell.previousElementSibling !== last) last.after(cell);
      const id = [...row.querySelectorAll('a[href]')].map(a => a.getAttribute('href').match(/\/video\/([\w-]{11})/)?.[1]).find(Boolean);
      const e = record?.early?.[id], result = all[id], b = cell.firstChild;
      const label = result ? String(result.value) : '—';
      if (b.textContent !== label) b.textContent = label;
      const [bg, fg] = result ? color(result.value) : ['transparent', 'var(--yt-spec-text-secondary,#aaa)'];
      b.style.background = bg; b.style.color = fg;
      b.toggleAttribute('data-partial', !!result?.partial);
      cell.title = result ? explain(result) : !e ? 'Нажмите ↻ в заголовке «Эффективность».' : `Мало данных: за первые 48 часов меньше ${MIN_EARLY_VIEWS} просмотров.`;
      let nowCell = cell.parentElement.querySelector(`[${ROOT}=nowcell]`);
      if (!nowCell) { nowCell = document.createElement('div'); nowCell.setAttribute(ROOT, 'nowcell'); nowCell.className = 'cell-body'; nowCell.append(document.createElement('b')); }
      if (nowCell.previousElementSibling !== cell) cell.after(nowCell);
      const n = now[id], nb = nowCell.firstChild, nowLabel = n ? String(n.value) : '—';
      if (nb.textContent !== nowLabel) nb.textContent = nowLabel;
      const [nbg, nfg] = n ? color(n.value) : ['transparent', 'var(--yt-spec-text-secondary,#aaa)'];
      nb.style.background = nbg; nb.style.color = nfg;
      nowCell.title = n ? explainNow(n) : !record?.now ? 'Нажмите ↻ в заголовке «Эффективность».' :
        `За последние 7 дней меньше ${MIN_NOW_IMPRESSIONS} показов: YouTube сейчас почти не показывает ролик.`;
    }
  }
  function draw() { if (!document.querySelector('ytcp-video-row')) return; header(); rows(); }
  function clear() { document.querySelectorAll(`[${ROOT}]`).forEach(e => e.remove()); }
  async function update() {
    if (!enabled) { clear(); return; }
    ctx = context(location.href, document);
    if (!ctx) { clear(); return; }
    if (ctx.key !== lastKey) {
      lastKey = ctx.key; record = null;
      try { const reply = await send({ type: 'mbEfficiencyGet', context: ctx }); if (reply?.ok && lastKey === ctx.key) record = reply.record; } catch {}
    }
    draw();
  }
  async function refresh() {
    if (!ctx || record?.loading) return;
    const ids = missing(pageIds(), record?.early);
    record = { ...record, loading: true, error: '' }; draw();
    try {
      const reply = await send({ type: 'mbEfficiencyRefresh', context: { ...ctx, ids } });
      record = reply?.ok ? reply.record : { ...record, loading: false, error: reply?.error || 'Не удалось обновить. Нажмите ещё раз.' };
    } catch { record = { ...record, loading: false, error: 'Перезагрузите страницу после обновления расширения.' }; }
    draw();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void update(), 300); };
  const changed = (changes, area) => {
    if (area !== 'local') return;
    if (changes.ytsEff) { enabled = changes.ytsEff.newValue !== false; lastKey = ''; schedule(); return; }
    if (ctx && changes[ctx.key]) { record = changes[ctx.key].newValue; if (enabled) draw(); }
  };
  const observer = new MutationObserver(ms => { if (ms.some(m => !m.target.closest?.(`[${ROOT}]`))) schedule(); });
  (async () => {
    try { if ((await send({ type: 'mbStudioSummaryProbe' }))?.collector) return; } catch { return; }
    try { enabled = (await chrome.storage.local.get('ytsEff')).ytsEff !== false; } catch {}
    document.documentElement.append(style);
    chrome.storage.onChanged.addListener(changed);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule);
    schedule();
  })();
  globalThis.__mbEfficiencyCleanup = () => {
    clearTimeout(timer); observer.disconnect(); style.remove(); clear();
    chrome.storage.onChanged.removeListener(changed); document.removeEventListener('yt-navigate-finish', schedule);
  };
})();
