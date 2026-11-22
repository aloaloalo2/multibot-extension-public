// «Эффективность» column on the Studio Content list: a 0–100 score per video from CTR, average percentage viewed,
// average view duration and shares per view of the video's lifetime report. Views do not count. Fixed YouTube benchmarks,
// equal weights (author's choice, 21 November 2026). The report is read only when the author presses ↻.
(() => {
  const ROOT = 'data-multibot-efficiency';
  // Each measure gives 0–100 points; the score is their mean. Views do not count.
  const linear = (low, high) => v => (v - low) / (high - low) * 100;
  const BENCHMARKS = [
    // 4,5% is already above average: 60 points (author, 21 November 2026)
    ['CTR', 'ctr', linear(1.5, 6.5)],
    ['Средний % просмотра', 'avp', linear(20, 60)],
    // Relative to the channel: its longest average view gets 100, the others their share of it (author, 22 November
    // 2026: fixed minutes gave every long video 100). Without the channel's videos (the Insights table) it is left out.
    ['Длина одного просмотра', 'avd', (v, o) => o.maxAvd > 0 ? v / o.maxAvd * 100 : null],
    // Likes are not scored (author, 22 November 2026). Lenient and saturating: shares are rare, 1% of views sharing is 70 points (author, 22 November 2026).
    ['Поделились / просмотры', 'shares', v => 100 * (1 - Math.exp(-v / 0.83))],
  ];
  const MIN_VIEWS = 100;
  // The longest average view among the channel's videos with enough views.
  function longest(videos) {
    return Math.max(0, ...Object.values(videos || {}).filter(v => v.views >= MIN_VIEWS && Number.isFinite(v.avd)).map(v => v.avd));
  }
  function score(video, options = {}) {
    if (!video || !(video.views >= MIN_VIEWS)) return null;
    const parts = BENCHMARKS.filter(([, k]) => Number.isFinite(video[k]))
      .map(([label, k, points]) => ({ label, key: k, value: video[k], points: points(video[k], options) }))
      .filter(p => Number.isFinite(p.points)).map(p => ({ ...p, points: Math.max(0, Math.min(100, p.points)) }));
    if (parts.length < 2) return null;
    return { value: Math.round(parts.reduce((a, p) => a + p.points, 0) / parts.length), parts };
  }
  function exploreUrl(channelId) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'CHANNEL'], ['entity_id', channelId], ['time_period', 'lifetime'], ['explore_type', 'TABLE_AND_CHART'],
      ['metrics_computation_type', 'DELTA'], ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) u.searchParams.set(k, v);
    for (const m of ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_PERCENTAGE', 'AVERAGE_WATCH_TIME', 'SHARINGS']) u.searchParams.append('t_metrics', m);
    u.searchParams.set('dimension', 'VIDEO');
    u.searchParams.set('o_column', 'EXTERNAL_VIEWS');
    u.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_DESC');
    return u.href;
  }
  function context(rawUrl, doc) {
    const m = new URL(rawUrl).pathname.match(/^\/channel\/(UC[\w-]{22})\/videos(?:\/|$)/);
    if (!m) return null;
    const home = doc.querySelector('#home-button')?.getAttribute('href') || '';
    if (!home.includes('/channel/' + m[1])) return null;
    return { channelId: m[1], key: 'mbEfficiency:' + m[1], range: 'lifetime', period: 'lifetime', videosUrl: exploreUrl(m[1]) };
  }
  const fmt = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: v < 1 ? 2 : 1 }).format(v) + '%';
  const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  // Only the measured values and their points (author, 21 November 2026: the scale text was noise).
  function explain(result) {
    return result.parts.map(p => `${p.label}: ${p.key === 'avd' ? clock(p.value) : fmt(p.value)} → ${Math.round(p.points)}`).join('\n');
  }
  if (typeof module === 'object' && module.exports) { module.exports = { score, longest, context, exploreUrl, explain, BENCHMARKS }; return; }

  globalThis.__mbEfficiency = { score, explain };   // the Insights table scores the channel on this scale
  globalThis.__mbEfficiencyCleanup?.();
  let enabled = true, ctx = null, record = null, timer, lastKey = '';
  const send = message => chrome.runtime.sendMessage(message);
  const style = document.createElement('style');
  // Studio's own .cell-header rules are more specific than ours: the width needs !important on both header and cells,
  // or the header column is narrower than the rows and its label runs into «Комментарии».
  style.textContent = `[${ROOT}]{flex:0 0 150px!important;width:150px!important;min-width:150px!important;max-width:150px!important;box-sizing:border-box!important;padding:0 24px 0 12px!important;display:flex!important;justify-content:flex-end!important}
    [${ROOT}=cell]{align-items:flex-start!important;padding-top:12px!important}
    [${ROOT}=cell] b{display:inline-block;min-width:34px;padding:2px 6px;border-radius:10px;font:500 14px/18px Roboto,Arial,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
    [${ROOT}=head]{align-items:center!important;gap:4px;white-space:nowrap}
    [${ROOT}=head] button{border:0;background:transparent;color:var(--yt-spec-text-secondary,#aaa);cursor:pointer;font-size:14px;line-height:14px;padding:2px}
    [${ROOT}=head] button:disabled{cursor:wait;animation:mb-eff-spin 1s linear infinite}
    @keyframes mb-eff-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[${ROOT}=head] button:disabled{animation:none}}`;
  const color = v => v >= 70 ? ['#1b5e20', '#c8e6c9'] : v >= 40 ? ['#5d4a00', '#ffe9a8'] : ['#6d1b1b', '#ffcdd2'];
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
    const button = head.querySelector('button');
    button.disabled = !!record?.loading;
    const at = record?.videosAt ? `Данные: ${new Date(record.videosAt).toLocaleString('ru-RU')}.` : 'Данных ещё нет.';
    head.title = `Эффективность ролика 0–100 без учёта просмотров: CTR, средний % просмотра, длина одного просмотра и «Поделиться» на просмотр за всё время. ${at}${record?.error ? '\n' + record.error : ''}`;
    button.title = record?.loading ? 'Загружаем отчёт канала…' : 'Обновить оценки из «Расширенного режима»';
    button.setAttribute('aria-label', button.title);
  }
  function rows() {
    const maxAvd = longest(record?.videos);
    for (const row of document.querySelectorAll('ytcp-video-row')) {
      const last = [...row.querySelectorAll('.cell-body[class*=tablecell-]')].filter(e => !e.hasAttribute(ROOT)).at(-1);
      if (!last) continue;
      let cell = last.parentElement.querySelector(`[${ROOT}=cell]`);
      if (!cell) { cell = document.createElement('div'); cell.setAttribute(ROOT, 'cell'); cell.className = 'cell-body'; cell.append(document.createElement('b')); }
      if (cell.previousElementSibling !== last) last.after(cell);
      const id = [...row.querySelectorAll('a[href]')].map(a => a.getAttribute('href').match(/\/video\/([\w-]{11})/)?.[1]).find(Boolean);
      const video = record?.videos?.[id], result = score(video, { maxAvd }), b = cell.firstChild;
      const label = result ? String(result.value) : '—';
      if (b.textContent !== label) b.textContent = label;
      const [bg, fg] = result ? color(result.value) : ['transparent', 'var(--yt-spec-text-secondary,#aaa)'];
      b.style.background = bg; b.style.color = fg;
      cell.title = result ? explain(result) : !record?.videos ? 'Нажмите ↻ в заголовке «Эффективность».' :
        !video ? 'Ролика нет в отчёте (мало просмотров или он вне первой страницы отчёта).' : `Мало данных: нужно от ${MIN_VIEWS} просмотров.`;
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
      const reply = await send({ type: 'mbEfficiencyRefresh', context: ctx });
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
