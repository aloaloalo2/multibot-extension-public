// «Эффективность» and «Сейчас» columns on the Studio Content list: how a video does on the measures that, inside a
// channel, follow its views (CTR 70%, subscribers per 1000 views 20%, view length 10%), over its whole life and over
// the last 4 days with data. Each measure is ranked among the same channel's videos, so niches do not compete.
// Views and impressions never enter the score (author, 22 November 2026).
(() => {
  const ROOT = 'data-multibot-efficiency';
  const EARLY_DAYS = 2, MIN_EARLY_VIEWS = 20, MAX_IDS = 60;
  // Views and impressions are never part of the score. What follows views differs by channel (22 November 2026: CTR on
  // Чичваркин +47, on Космос +7, where subscribers per 1000 views gave +79), so each channel gets its own weights:
  // a measure weighs as much as its rank correlation with the channel's views (negative ones weigh nothing). Checked by
  // leaving each video out of its own weights: +35…+67 on four channels. The weights below serve a channel with fewer
  // than LEARN_MIN videos.
  const MEASURES = [
    ['CTR', 'ctr', 0.7],
    ['Подписок на 1000 просмотров', 'subs', 0.2],
    ['Длина просмотра', 'avd', 0.1],
    ['% просмотра', 'avp', 0],
    ['Поделились на 1000 просмотров', 'shares', 0],
  ];
  const LEARN_MIN = 6;
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
    return { ctr: e.ctr, avd: e.avd, subs: Math.max(0, e.subs) / e.views * 1000,
      avp: Number.isFinite(e.avp) ? e.avp : NaN, shares: Number.isFinite(e.shares) ? e.shares / e.views * 1000 : NaN };
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
      const parts = MEASURES.filter(([, , w]) => w > 0).map(([label, key, weight]) => ({ label, key, weight, value: m[key], points: rank(key, m[key]) }));
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
  // The whole life of a video: the same measures (seconds watched per impression 70%, subscribers per 1000 views 30%,
  // ranked inside the channel) over all its days, from one lifetime report of the channel (author, 22 November 2026:
  // the score judges the whole video, not only its current week).
  const WEEK_METRICS = ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_TIME', 'SUBSCRIBERS_NET_CHANGE', 'AVERAGE_WATCH_PERCENTAGE', 'SHARINGS'];
  const MIN_NOW_VIEWS = 100;   // the whole life: a video needs at least this many views to be judged
  function weekUrl(channelId) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'CHANNEL'], ['entity_id', channelId], ['time_period', 'lifetime'], ['explore_type', 'TABLE_AND_CHART'],
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
      result[id] = { views: number(c[0]) || 0, impr: number(c[1]) || 0, ctr: number(c[2]), avd: seconds(c[3]), subs: number(c[4]) || 0, avp: number(c[5]), shares: number(c[6]) || 0 };
    }
    return result;
  }
  const ranks = a => { const s = a.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
    for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  function spearman(x, y) {
    const rx = ranks(x), ry = ranks(y), n = x.length, mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sx += (rx[i] - mx) ** 2; sy += (ry[i] - my) ** 2; }
    return sx && sy ? sxy / Math.sqrt(sx * sy) : 0;
  }
  // The channel's own weights from its lifetime report: each measure's rank correlation with views, negatives dropped.
  function learnWeights(byId, minViews = MIN_NOW_VIEWS) {
    const known = Object.values(byId || {}).filter(v => v.views >= minViews).map(v => [v, measures(v)]).filter(([, m]) => m);
    const defaults = Object.fromEntries(MEASURES.map(([, k, w]) => [k, w]));
    if (known.length < LEARN_MIN) return { weights: defaults, learned: false, n: known.length };
    const rho = {};
    for (const [, k] of MEASURES) {
      const pairs = known.filter(([, m]) => Number.isFinite(m[k]));
      rho[k] = pairs.length >= LEARN_MIN ? spearman(pairs.map(([, m]) => m[k]), pairs.map(([v]) => v.views)) : 0;
    }
    const total = Object.values(rho).reduce((a, r) => a + Math.max(0, r), 0);
    if (!total) return { weights: defaults, learned: false, n: known.length, rho };
    const weights = Object.fromEntries(Object.entries(rho).map(([k, r]) => [k, Math.max(0, r) / total]));
    return { weights, learned: true, n: known.length, rho };
  }
  function nowScores(byId, minViews = MIN_NOW_VIEWS, weights = null) {
    const w = weights || Object.fromEntries(MEASURES.map(([, k, x]) => [k, x]));
    const known = Object.entries(byId || {}).filter(([, v]) => v.views >= minViews && Number.isFinite(v.subs)).map(([id, v]) => [id, v, measures(v)]).filter(([, , m]) => m);
    const rank = (key, value) => {
      if (known.length < 2) return 50;
      const all = known.map(([, , m]) => m[key]).filter(Number.isFinite), below = all.filter(x => x < value).length, equal = all.filter(x => x === value).length;
      return all.length < 2 ? 50 : (below + (equal - 1) / 2) / (all.length - 1) * 100;
    };
    const result = {};
    for (const [id, v, m] of known) {
      const parts = MEASURES.filter(([, key]) => w[key] > 0 && Number.isFinite(m[key])).map(([label, key]) => ({ label, key, weight: w[key], value: m[key], points: rank(key, m[key]) }));
      const weight = parts.reduce((a, p) => a + p.weight, 0);
      if (!weight) continue;
      result[id] = { value: Math.round(parts.reduce((a, p) => a + p.points * p.weight, 0) / weight), parts, impr: v.impr, views: v.views };
    }
    return result;
  }
  function explainNow(result, period = 'всё время') {
    const show = p => p.key === 'ctr' || p.key === 'avp' ? one(p.value) + '%' : p.key === 'avd' ? `${Math.floor(p.value / 60)}:${String(Math.round(p.value % 60)).padStart(2, '0')}` : one(p.value);
    return result.parts.map(p => `${p.label} (${period}): ${show(p)} → ${Math.round(p.points)}, вес ${Math.round(p.weight * 100)}%`).join('\n');
  }
  // «Сейчас»: the same measures over the last 4 days with data. Studio's daily data ends two days back (on 22 November
  // its last day was 20 November), so the range is the 4 California days before yesterday; the report takes it as
  // `time_period=<start ms>,<end ms>`.
  const RECENT_DAYS = 4, MIN_RECENT_VIEWS = 20;
  function pacificMidnight(now, daysBack) {
    // Studio's days start at midnight in California (08:00 UTC in winter, 07:00 in summer).
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now)).split('-').map(Number);
    for (const h of [8, 7]) {
      const t = Date.UTC(y, m - 1, d - daysBack, h);
      if (new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)) === '00') return t;
    }
    return Date.UTC(y, m - 1, d - daysBack, 8);
  }
  function recentRange(now = Date.now()) {
    return `${pacificMidnight(now, 1 + RECENT_DAYS)},${pacificMidnight(now, 1)}`;
  }
  function recentUrl(channelId, now = Date.now()) {
    const u = new URL(weekUrl(channelId));
    u.searchParams.set('time_period', recentRange(now));
    return u.href;
  }
  const api = { learnWeights, spearman, sessionIndex, recentRange, recentUrl, RECENT_DAYS, MIN_RECENT_VIEWS, dayUrl, readDays, early, parseDate, measures, scores, explain, context, missing, weekUrl, readWeek, nowScores, explainNow, MEASURES, MAX_IDS };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  globalThis.__mbEfficiency = api;   // the collector tab and the Insights table use the same scale
  globalThis.__mbEfficiencyCleanup?.();
  let enabled = true, ctx = null, record = null, timer, lastKey = '';
  const send = message => chrome.runtime.sendMessage(message);
  const style = document.createElement('style');
  // Studio's own .cell-header rules are more specific than ours: the width needs !important on both header and cells,
  // or the header column is narrower than the rows and its label runs into «Комментарии».
  style.textContent = `[${ROOT}]{flex:0 0 150px!important;width:150px!important;min-width:150px!important;max-width:150px!important;box-sizing:border-box!important;padding:0 24px 0 12px!important;display:flex!important;justify-content:flex-end!important}
    [${ROOT}=cell],[${ROOT}=nowcell],[${ROOT}=reachcell]{align-items:flex-start!important;padding-top:12px!important}
    [${ROOT}=nowhead],[${ROOT}=nowcell],[${ROOT}=reachhead],[${ROOT}=reachcell]{flex-basis:100px!important;width:100px!important;min-width:100px!important;max-width:100px!important}
    [${ROOT}=nowhead],[${ROOT}=reachhead]{align-items:center!important}
    [${ROOT}=cell] b,[${ROOT}=nowcell] b,[${ROOT}=reachcell] b{display:inline-block;min-width:34px;padding:2px 6px;border-radius:10px;font:500 14px/18px Roboto,Arial,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
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
    head.parentElement.querySelector(`[${ROOT}=reachhead]`)?.remove();
    let nowHead = head.parentElement.querySelector(`[${ROOT}=nowhead]`);
    if (!nowHead) { nowHead = document.createElement('div'); nowHead.setAttribute(ROOT, 'nowhead'); nowHead.className = head.className; nowHead.textContent = 'Сейчас'; }
    if (nowHead.previousElementSibling !== head) head.after(nowHead);
    nowHead.title = `Те же показатели за последние ${RECENT_DAYS} дня с данными (Studio отдаёт дни с задержкой в два дня), по сравнению с другими роликами канала.` +
      (record?.recentAt ? `\nДанные: ${new Date(record.recentAt).toLocaleString('ru-RU')}` : '');
    const button = head.querySelector('button');
    button.disabled = !!record?.loading;
    // A failed refresh shows ⚠ in place of ↻: its reason is in the tooltip, a click tries again.
    const mark = record?.error && !record?.loading ? '⚠' : '↻';
    if (button.textContent !== mark) button.textContent = mark;
    button.style.color = mark === '⚠' ? '#f9ab00' : '';
    const learned = learnWeights(record?.now), all = nowScores(record?.now, MIN_NOW_VIEWS, learned.weights);
    const shown = Object.values(all).filter(r => Number.isFinite(r.views));
    const match = shown.length >= LEARN_MIN ? Math.round(spearman(shown.map(r => r.value), shown.map(r => r.views)) * 100) : null;
    const weightsText = MEASURES.filter(([, k]) => learned.weights[k] > 0).map(([label, k]) => `${label} ${Math.round(learned.weights[k] * 100)}%`).join(', ');
    head.title = `Формула этого канала: ${weightsText}.` + (learned.learned ? ` Веса подобраны по ${learned.n} роликам канала: чем сильнее показатель идёт вместе с просмотрами, тем больше его вес. Сами просмотры в оценку не входят.` : ' Роликов мало, веса общие.') +
      (match !== null ? `\nСовпадение с просмотрами: ${match > 0 ? '+' : ''}${match} из 100.` : '') +
      (record?.nowAt ? `\nДанные: ${new Date(record.nowAt).toLocaleString('ru-RU')}` : '') + (record?.error ? '\n' + record.error : '');
    button.title = record?.loading ? 'Читаем отчёты роликов…' : record?.error ? record.error : 'Обновить «Эффективность» и «Сейчас»';
    button.setAttribute('aria-label', button.title);
  }
  function rows() {
    const learned = learnWeights(record?.now), all = nowScores(record?.now, MIN_NOW_VIEWS, learned.weights), recent = nowScores(record?.recent, MIN_RECENT_VIEWS, learned.weights);
    const paint = (cell, r) => {
      const b = cell.firstChild, label = r ? String(r.value) : '—';
      if (b.textContent !== label) b.textContent = label;
      const [bg, fg] = r ? color(r.value) : ['transparent', 'var(--yt-spec-text-secondary,#aaa)'];
      b.style.background = bg; b.style.color = fg;
    };
    const make = (kind) => { const c = document.createElement('div'); c.setAttribute(ROOT, kind); c.className = 'cell-body'; c.append(document.createElement('b')); return c; };
    const idOf = row => [...row.querySelectorAll('a[href]')].map(a => a.getAttribute('href').match(/\/video\/([\w-]{11})/)?.[1]).find(Boolean);
    for (const row of document.querySelectorAll('ytcp-video-row')) {
      const last = [...row.querySelectorAll('.cell-body[class*=tablecell-]')].filter(e => !e.hasAttribute(ROOT)).at(-1);
      if (!last) continue;
      const cell = last.parentElement.querySelector(`[${ROOT}=cell]`) || make('cell');
      if (cell.previousElementSibling !== last) last.after(cell);
      cell.parentElement.querySelector(`[${ROOT}=reachcell]`)?.remove();
      const nowCell = cell.parentElement.querySelector(`[${ROOT}=nowcell]`) || make('nowcell');
      if (nowCell.previousElementSibling !== cell) cell.after(nowCell);
      const id = idOf(row);
      paint(cell, all[id]); paint(nowCell, recent[id]);
      cell.title = all[id] ? explainNow(all[id]) : !record?.now ? 'Нажмите ↻ в заголовке «Эффективность».' : `Мало данных: меньше ${MIN_NOW_VIEWS} просмотров за всё время.`;
      nowCell.title = recent[id] ? explainNow(recent[id], `${RECENT_DAYS} дня`) : !record?.recent ? 'Нажмите ↻ в заголовке «Эффективность».' :
        `За последние ${RECENT_DAYS} дня меньше ${MIN_RECENT_VIEWS} просмотров: YouTube сейчас почти не показывает ролик.`;
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
    record = { ...record, loading: true, error: '' }; draw();
    try {
      const reply = await send({ type: 'mbEfficiencyRefresh', context: { ...ctx, ids: [] } });
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
