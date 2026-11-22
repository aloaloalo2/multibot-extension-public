// Read visible-page metrics without opening tabs. Open the reports only when the author asks for a refresh.
// No YouTube API credentials, direct API calls or changes to channel settings.
(() => {
  const PREFIX = 'mbStudioSummary:', EFFICIENCY = 'mbEfficiency:';
  const METRICS = ['ctr', 'duration', 'avd', 'retention', 'shares'];
  const queue = [];
  const pending = new Set();
  let active = null;
  let writing = Promise.resolve();
  function validUrl(value, channelId) {
    try {
      const u = new URL(value);
      return u.origin === 'https://studio.youtube.com' &&
        u.pathname.startsWith(`/channel/${channelId}/analytics/hub_`) && value.length < 8000;
    } catch { return false; }
  }
  // «Эффективность» on the Content list: the first 48 hours of the listed videos, one day-by-day report each.
  function validateEfficiency(context, senderUrl) {
    try {
      return context && /^UC[\w-]{22}$/.test(context.channelId) && context.key === EFFICIENCY + context.channelId &&
        context.range === 'early' && context.period === 'early' && validUrl(context.earlyUrl, context.channelId) &&
        Array.isArray(context.ids) && context.ids.length <= 60 && context.ids.every(id => /^[\w-]{11}$/.test(id)) &&
        new URL(senderUrl).origin === 'https://studio.youtube.com' &&
        new URL(senderUrl).pathname.startsWith(`/channel/${context.channelId}/videos`);
    } catch { return false; }
  }
  // One video's day-by-day report (the same address yt-studio-efficiency.js reads). A background tab is hidden, and a
  // frame inside it never rendered its table (22 November 2026), so the collector tab opens each report itself.
  // `authuser` picks the Google account that owns the channel: a new tab otherwise opens Studio as the account
  // chosen last in the avatar menu, and another account's channel reads «нет доступа» (22 November 2026).
  // Studio drops it from the address once the page has loaded.
  function account(u, authuser) { if (Number.isInteger(authuser) && authuser >= 0 && authuser < 20) u.searchParams.set('authuser', String(authuser)); return u.href; }
  function sameUrl(a, b) { try { const x = new URL(a), y = new URL(b); x.searchParams.delete('authuser'); y.searchParams.delete('authuser'); return x.href === y.href; } catch { return false; } }
  function dayUrl(channelId, videoId, authuser) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'VIDEO'], ['entity_id', videoId], ['time_period', 'lifetime'], ['explore_type', 'TABLE_AND_CHART'],
      ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) u.searchParams.set(k, v);
    for (const m of ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_TIME', 'SUBSCRIBERS_NET_CHANGE']) u.searchParams.append('t_metrics', m);
    u.searchParams.set('dimension', 'DAY');
    u.searchParams.set('o_column', 'DAY');
    u.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_ASC');
    return account(u, authuser);
  }
  function weekUrl(channelId, authuser) {
    const u = new URL(`https://studio.youtube.com/channel/${channelId}/analytics/hub_content/explore`);
    for (const [k, v] of [['entity_type', 'CHANNEL'], ['entity_id', channelId], ['time_period', 'lifetime'], ['explore_type', 'TABLE_AND_CHART'],
      ['metrics_computation_type', 'DELTA'], ['metric', 'EXTERNAL_VIEWS'], ['granularity', 'DAY']]) u.searchParams.set(k, v);
    for (const m of ['EXTERNAL_VIEWS', 'VIDEO_THUMBNAIL_IMPRESSIONS', 'VIDEO_THUMBNAIL_IMPRESSIONS_VTR', 'AVERAGE_WATCH_TIME', 'SUBSCRIBERS_NET_CHANGE']) u.searchParams.append('t_metrics', m);
    u.searchParams.set('dimension', 'VIDEO');
    u.searchParams.set('o_column', 'VIDEO_THUMBNAIL_IMPRESSIONS');
    u.searchParams.set('o_direction', 'ANALYTICS_ORDER_DIRECTION_DESC');
    return account(u, authuser);
  }
  // The last 4 days with data (yt-studio-efficiency.js recentRange): Studio's daily data ends two days back.
  function recentUrl(channelId, authuser, now = Date.now()) {
    const u = new URL(weekUrl(channelId, authuser));
    u.searchParams.set('time_period', `${pacificMidnight(now, 5)},${pacificMidnight(now, 1)}`);
    return u.href;
  }
  function pacificMidnight(now, daysBack) {
    // Studio's days start at midnight in California (08:00 UTC in winter, 07:00 in summer).
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(now)).split('-').map(Number);
    for (const h of [8, 7]) {
      const t = Date.UTC(y, m - 1, d - daysBack, h);
      if (new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)) === '00') return t;
    }
    return Date.UTC(y, m - 1, d - daysBack, 8);
  }
  function cleanNow(input) {
    const result = {};
    for (const [id, v] of Object.entries(input || {}).slice(0, 2000)) {
      if (!/^[\w-]{11}$/.test(id) || !v || !Number.isFinite(v.impr) || !Number.isFinite(v.views)) continue;
      const row = { views: v.views, impr: v.impr };
      if (Number.isFinite(v.ctr) && v.ctr >= 0 && v.ctr <= 100) row.ctr = v.ctr;
      if (Number.isFinite(v.subs) && Math.abs(v.subs) < 1e9) row.subs = v.subs;
      if (Number.isFinite(v.avd) && v.avd >= 0 && v.avd < 86400) row.avd = v.avd;
      result[id] = row;
    }
    return result;
  }
  function cleanEarly(input, ids) {
    const result = {};
    for (const id of ids || []) {
      const e = input?.[id];
      if (!e || !Number.isInteger(e.days) || e.days < 1 || e.days > 2) continue;
      const row = { days: e.days };
      if (typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) row.date = e.date;
      for (const k of ['views', 'impr', 'subs']) if (Number.isFinite(e[k]) && Math.abs(e[k]) < 1e9) row[k] = e[k];
      if (Number.isFinite(e.ctr) && e.ctr >= 0 && e.ctr <= 100) row.ctr = e.ctr;
      if (Number.isFinite(e.avd) && e.avd >= 0 && e.avd < 86400) row.avd = e.avd;
      if (Number.isFinite(row.views) && row.views >= 0) result[id] = row;
    }
    return result;
  }
  function validate(context, senderUrl) {
    if (context && context.authuser !== undefined && !(Number.isInteger(context.authuser) && context.authuser >= 0 && context.authuser < 20)) return false;
    if (context?.key?.startsWith?.(EFFICIENCY)) return validateEfficiency(context, senderUrl);
    return context && /^UC[\w-]{22}$/.test(context.channelId) &&
      typeof context.key === 'string' && context.key.startsWith(PREFIX + context.channelId + ':') && context.key.length < 600 &&
      typeof context.range === 'string' && context.range.length < 200 &&
      ['week', '4_weeks', 'quarter'].includes(context.period) &&
      validUrl(senderUrl, context.channelId) &&
      ['contentUrl', 'exploreUrl'].every(k => validUrl(context[k], context.channelId)) &&
      new URL(context.exploreUrl).searchParams.get('time_period') === context.period;
  }
  function cleanMetrics(input, now) {
    const result = {};
    for (const name of METRICS) {
      const metric = input?.[name];
      if (!metric || !Number.isFinite(metric.value) || metric.value < 0 ||
          metric.value > (name === 'avd' ? 86400 : ['duration', 'retention', 'shares'].includes(name) ? 10000 : 100) ||
          !Number.isInteger(metric.count) || metric.count < 1 || metric.count > 100000) continue;
      result[name] = { value: metric.value, count: metric.count,
        source: String(metric.source || '').slice(0, 350), at: now };
    }
    return result;
  }
  async function enableCollectorFocus(job) {
    const deadline = Date.now() + 10000;
    while (active === job && !job.finishing) {
      const tab = await chrome.tabs.get(job.tabId);
      if (tab.pendingUrl && !sameUrl(tab.pendingUrl, job.url)) throw Error('Адрес отчёта изменился.');
      if (sameUrl(tab.url, job.url)) break;
      if (!sameUrl(tab.pendingUrl, job.url) || Date.now() >= deadline) throw Error('Отчёт ещё не загрузил адрес.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (active !== job || job.finishing) return;
    await chrome.debugger.attach({ tabId: job.tabId }, '1.3');
    job.attached = true;
    if (active !== job || job.finishing) return;
    await chrome.debugger.sendCommand({ tabId: job.tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
  }
  async function releaseCollectorFocus(job) {
    if (!job.attached) return;
    job.attached = false;
    try { await chrome.debugger.sendCommand({ tabId: job.tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: false }); } catch {}
    try { await chrome.debugger.detach({ tabId: job.tabId }); } catch {}
  }
  function merge(context, metrics = {}, extra = {}) {
    const operation = writing.then(async () => {
      const saved = (await chrome.storage.local.get(context.key))[context.key];
      const record = saved?.channelId === context.channelId ? saved :
        { channelId: context.channelId, range: context.range, metrics: {} };
      record.metrics = { ...record.metrics, ...cleanMetrics(metrics, Date.now()) };
      const { early, ...rest } = extra;
      if (early) record.early = { ...record.early, ...early };
      Object.assign(record, rest);
      await chrome.storage.local.set({ [context.key]: record });
      return record;
    });
    writing = operation.catch(() => {});
    return operation;
  }
  async function finish(error = '') {
    const job = active;
    if (!job || job.finishing) return;
    job.finishing = true;
    clearTimeout(job.timer);
    await job.focusPromise?.catch(() => {});
    await releaseCollectorFocus(job);
    await chrome.storage.session.remove('mbStudioSummaryCollector');
    await merge(job.context, {}, { loading: false, error, attemptedAt: Date.now() });
    if (job.tabId) await chrome.tabs.remove(job.tabId).catch(() => {});
    pending.delete(job.context.key);
    active = null;
    void pump();
  }
  async function next() {
    const job = active;
    if (!job) return;
    clearTimeout(job.timer);
    if (!job.modes.length) return finish(job.timedOut ? 'Не все отчёты успели загрузиться. Доступные показатели сохранены.' : '');
    job.mode = job.modes.shift();
    job.nonce = crypto.randomUUID();
    const url = job.mode.startsWith('early:') ? dayUrl(job.context.channelId, job.mode.slice(6), job.context.authuser) :
      job.mode === 'now' ? weekUrl(job.context.channelId, job.context.authuser) :
      job.mode === 'recent' ? recentUrl(job.context.channelId, job.context.authuser) : job.context[job.mode + 'Url'];
    job.url = url;
    await chrome.storage.session.set({ mbStudioSummaryCollector: {
      tabId: job.tabId, channelId: job.context.channelId, started: Date.now(), url } });
    job.timer = setTimeout(() => {
      if (active === job) { job.timedOut = true; void next().catch(() => finish('Не все отчёты успели загрузиться.')); }
    }, 45000);
    if (job.tabId) await chrome.tabs.update(job.tabId, { url });
    else {
      const tab = await chrome.tabs.create({ url, active: false });
      if (active !== job) { await chrome.tabs.remove(tab.id).catch(() => {}); return; }
      job.tabId = tab.id;
      job.focusPromise = enableCollectorFocus(job);
      await chrome.storage.session.set({ mbStudioSummaryCollector: {
        tabId: tab.id, channelId: job.context.channelId, started: Date.now(), url } });
      await job.focusPromise;
    }
  }
  async function pump() {
    if (active || !queue.length) return;
    active = queue.shift();
    try { await next(); } catch { await finish('Не удалось прочитать отчёт Studio.'); }
  }
  async function request(context, patch, sender, manualModes = null) {
    if (!validate(context, sender.tab?.url)) throw Error('Неверный канал или адрес отчёта.');
    const record = await merge(context, patch);
    if (record.loading && !pending.has(context.key)) await merge(context, {}, { loading: false });
    if (manualModes && !pending.has(context.key)) {
      if (queue.length >= 6) return { ok: false, error: 'Дождитесь завершения обновления других каналов.' };
      pending.add(context.key);
      await merge(context, {}, { loading: true, error: '' });
      queue.push({ context, modes: [...manualModes], tabId: null });
      void pump();
    }
    return { ok: true, record: (await chrome.storage.local.get(context.key))[context.key] };
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { cleanMetrics, cleanEarly, cleanNow, dayUrl, weekUrl, recentUrl, sameUrl, validUrl, validate };
    return;
  }
  const ready = (async () => {
    // Clean up only a tab registered as our collector before a worker reload.
    const old = (await chrome.storage.session.get('mbStudioSummaryCollector')).mbStudioSummaryCollector;
    if (old?.tabId) {
      const tab = await chrome.tabs.get(old.tabId).catch(() => null);
      if (tab && tab.url === old.url && validUrl(tab.url, old.channelId))
        await chrome.tabs.remove(old.tabId).catch(() => {});
      await chrome.storage.session.remove('mbStudioSummaryCollector');
    }
  })();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['mbStudioSummaryGet', 'mbStudioSummaryRefresh', 'mbEfficiencyGet', 'mbEfficiencyRefresh', 'mbStudioSummaryProbe', 'mbStudioSummaryResult'].includes(message?.type)) return;
    void ready.then(async () => {
      if (message.type === 'mbStudioSummaryGet') return request(message.context, message.metrics, sender);
      // One click refreshes everything: «Расширенный режим» (percentage viewed, view length, shares), then «Контент» (CTR, 0:30).
      if (message.type === 'mbStudioSummaryRefresh') return request(message.context, {}, sender, ['explore', 'content']);
      if (message.type === 'mbEfficiencyGet') return request(message.context, {}, sender);
      if (message.type === 'mbEfficiencyRefresh') return request(message.context, {}, sender, ['now', 'recent']);
      const job = active;
      if (!job || job.finishing || sender.tab?.id !== job.tabId || !validUrl(sender.tab.url, job.context.channelId)) return { ok: true };
      if (message.type === 'mbStudioSummaryProbe') {
        try { await job.focusPromise; } catch { await finish('Не удалось включить фоновую загрузку отчёта. Нажмите обновление ещё раз.'); return { ok: false }; }
        if (active !== job || job.finishing || !job.attached) return { ok: false };
        return { ok: true, collector: { mode: job.mode, nonce: job.nonce, context: job.context } };
      }
      if (message.nonce !== job.nonce || message.range !== job.context.range) return { ok: false };
      if (message.denied) {
        job.modes = [];
        await finish('Studio сейчас открыт на другом канале, и отчёты этого канала недоступны. Переключитесь на этот канал через аватар → «Сменить аккаунт» и нажмите ↻ ещё раз.');
        return { ok: true };
      }
      if (job.mode === 'recent') {
        await merge(job.context, {}, { recent: cleanNow(message.now), recentAt: Date.now() });
        await next();
        return { ok: true };
      }
      if (job.mode === 'now') {
        await merge(job.context, {}, { now: cleanNow(message.now), nowAt: Date.now() });
        await next();
        return { ok: true };
      }
      if (job.mode.startsWith('early:')) {
        const early = cleanEarly(message.early, [job.mode.slice(6)]);
        if (Object.keys(early).length) await merge(job.context, {}, { early, earlyAt: Date.now() });
        await next();
        return { ok: true };
      }
      const allowed = job.mode === 'content' ? ['ctr', 'retention'] : ['duration', 'avd', 'shares'];
      const metrics = Object.fromEntries(allowed.filter(k => message.metrics?.[k]).map(k => [k, message.metrics[k]]));
      await merge(job.context, metrics);
      await next();
      return { ok: true };
    }).then(reply, () => reply({ ok: false, error: 'Не удалось обновить показатели.' }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(id => {
    if (active?.tabId === id) void finish('Сбор показателей прерван.');
  });
  chrome.debugger.onDetach.addListener(target => {
    if (active?.tabId === target.tabId && !active.finishing) {
      active.attached = false;
      void finish('Фоновая загрузка отчёта прервана. Нажмите обновление ещё раз.');
    }
  });
})();
