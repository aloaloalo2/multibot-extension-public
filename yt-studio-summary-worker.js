// Read visible-page metrics without opening tabs. Collect likes only on request.
// No YouTube API credentials, direct API calls or changes to channel settings.
(() => {
  const PREFIX = 'mbStudioSummary:';
  const METRICS = ['ctr', 'duration', 'retention', 'likes', 'shares'];
  const queue = [];
  const pending = new Set();
  let active = null;
  let writing = Promise.resolve();
  function validUrl(value, channelId) {
    try {
      const u = new URL(value);
      return u.origin === 'https://studio.youtube.com' &&
        u.pathname.startsWith(`/channel/${channelId}/analytics/tab-`) && value.length < 8000;
    } catch { return false; }
  }
  function validate(context, senderUrl) {
    return context && /^UC[\w-]{22}$/.test(context.channelId) &&
      typeof context.key === 'string' && context.key.startsWith(PREFIX + context.channelId + ':') && context.key.length < 600 &&
      typeof context.range === 'string' && context.range.length < 200 &&
      validUrl(senderUrl, context.channelId) &&
      ['overviewUrl', 'contentUrl', 'likesUrl', 'sharesUrl'].every(k => validUrl(context[k], context.channelId));
  }
  function cleanMetrics(input, now) {
    const result = {};
    for (const name of METRICS) {
      const metric = input?.[name];
      if (!metric || !Number.isFinite(metric.value) || metric.value < 0 ||
          metric.value > (['duration', 'retention', 'shares'].includes(name) ? 10000 : 100) ||
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
      if (tab.pendingUrl && tab.pendingUrl !== job.url) throw Error('Адрес отчёта изменился.');
      if (tab.url === job.url) break;
      if (tab.pendingUrl !== job.url || Date.now() >= deadline) throw Error('Отчёт ещё не загрузил адрес.');
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
      Object.assign(record, extra);
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
    const url = job.context[job.mode + 'Url'];
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
  async function request(context, patch, sender, manualMode = '') {
    if (!validate(context, sender.tab?.url)) throw Error('Неверный канал или адрес отчёта.');
    const record = await merge(context, patch);
    if (record.loading && !pending.has(context.key)) await merge(context, {}, { loading: false });
    if (manualMode && !pending.has(context.key)) {
      if (queue.length >= 6) return { ok: false, error: 'Дождитесь завершения обновления других каналов.' };
      pending.add(context.key);
      await merge(context, {}, { loading: true, error: '' });
      queue.push({ context, modes: [manualMode], tabId: null });
      void pump();
    }
    return { ok: true, record: (await chrome.storage.local.get(context.key))[context.key] };
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { cleanMetrics, validUrl, validate };
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
    if (!['mbStudioSummaryGet', 'mbStudioSummaryRefreshLikes', 'mbStudioSummaryRefreshShares', 'mbStudioSummaryProbe', 'mbStudioSummaryResult'].includes(message?.type)) return;
    void ready.then(async () => {
      if (message.type === 'mbStudioSummaryGet') return request(message.context, message.metrics, sender);
      if (message.type === 'mbStudioSummaryRefreshLikes') return request(message.context, {}, sender, 'likes');
      if (message.type === 'mbStudioSummaryRefreshShares') return request(message.context, {}, sender, 'shares');
      const job = active;
      if (!job || job.finishing || sender.tab?.id !== job.tabId || !validUrl(sender.tab.url, job.context.channelId)) return { ok: true };
      if (message.type === 'mbStudioSummaryProbe') {
        try { await job.focusPromise; } catch { await finish('Не удалось включить фоновую загрузку отчёта. Нажмите обновление ещё раз.'); return { ok: false }; }
        if (active !== job || job.finishing || !job.attached) return { ok: false };
        return { ok: true, collector: { mode: job.mode, nonce: job.nonce, context: job.context } };
      }
      if (message.nonce !== job.nonce || message.range !== job.context.range) return { ok: false };
      const allowed = job.mode === 'content' ? ['ctr', 'retention'] : job.mode === 'overview' ? ['duration'] : [job.mode];
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
