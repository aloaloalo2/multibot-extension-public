// Per-video averages in Overview and Content's 0:30 retention card.
// Reads rendered analytics only. No requests, stored channel data or popup UI.
(() => {
  const marker = 'data-multibot-average-percentage';
  const retentionMarker = 'data-multibot-retention-average';
  function parsePercentage(text) {
    const match = String(text || '').replace(/[\u00a0\u202f]/g, ' ').match(/^\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?\s*$/);
    if (!match) return null;
    const value = Number(match[1].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }
  function mean(values) {
    const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null;
  }
  function isDurationHeader(text) {
    return /средняя продолжительность просмотра|середня тривалість перегляду|average view duration/i.test(text);
  }
  function isRetentionHeader(text) {
    return /0\s*:\s*30/.test(text) && /продолжают смотреть|продовжують (?:дивитися|перегляд)|still watching|watching at/i.test(text);
  }
  function updateRetention(doc) {
    for (const card of doc.querySelectorAll('yta-audience-retention-highlights-channel-card-v2')) {
      const rows = [...card.querySelectorAll('.left-side .row')]
        .filter(row => !row.closest('[hidden], [aria-hidden="true"]') && row.getClientRects().length);
      const values = rows.map(row => parsePercentage(row.querySelector('.value')?.textContent));
      const average = mean(values);
      for (const label of card.querySelectorAll('.rows-header-title-right')) {
        let suffix = label.querySelector(`[${retentionMarker}]`);
        const original = [...label.childNodes].filter(n => n !== suffix).map(n => n.textContent).join('');
        if (average === null || !isRetentionHeader(original)) { suffix?.remove(); continue; }
        if (!suffix) {
          suffix = doc.createElement('span');
          suffix.setAttribute(retentionMarker, '');
          label.append(suffix);
        }
        const count = values.filter(v => v !== null).length;
        const text = ` (${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average)}%)`;
        const title = `Multi Bot: среднее удержание на отметке 0:30 по ${count} из ${rows.length} показанных роликов. Каждый ролик имеет одинаковый вес.`;
        if (suffix.textContent !== text) suffix.textContent = text;
        if (suffix.title !== title) suffix.title = title;
      }
    }
  }
  function update(doc, pathname) {
    const overview = /^\/channel\/[^/]+\/analytics\/tab-overview(?:\/|$)/.test(pathname) && !pathname.includes('/explore');
    const content = /^\/channel\/[^/]+\/analytics\/tab-content(?:\/|$)/.test(pathname) && !pathname.includes('/explore');
    if (content) updateRetention(doc);
    else doc.querySelectorAll(`[${retentionMarker}]`).forEach(e => e.remove());
    if (!overview) {
      doc.querySelectorAll(`[${marker}]`).forEach(e => e.remove());
      return;
    }
    for (const table of doc.querySelectorAll('yta-top-performing-entities')) {
      const headers = [...table.querySelectorAll('.header.metric')];
      for (const [index, header] of headers.entries()) {
        const label = header.querySelector('.header-text');
        if (!label) continue;
        let suffix = label.querySelector(`[${marker}]`);
        // Use the original label, excluding our appended text.
        const original = [...label.childNodes].filter(n => n !== suffix).map(n => n.textContent).join('');
        if (!isDurationHeader(original)) { suffix?.remove(); continue; }
        const rows = [...table.querySelectorAll('.row')];
        const values = rows.map(row => {
          const cell = row.querySelectorAll('.metric-cell')[index];
          return parsePercentage(cell?.querySelector('.percentage')?.textContent);
        });
        const average = mean(values);
        if (average === null) { suffix?.remove(); continue; }
        if (!suffix) {
          suffix = doc.createElement('span');
          suffix.setAttribute(marker, '');
          label.append(suffix);
        }
        const count = values.filter(v => v !== null).length;
        const text = ` (${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(average)}%)`;
        const title = `Multi Bot: среднее арифметическое процентов по ${count} из ${rows.length} роликов в этой таблице. Каждый ролик имеет одинаковый вес; это не общий показатель канала с учётом просмотров.`;
        if (suffix.textContent !== text) suffix.textContent = text;
        if (suffix.title !== title) suffix.title = title;
      }
    }
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { parsePercentage, mean, isDurationHeader, isRetentionHeader, update };
    return;
  }
  let timer;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; update(document, location.pathname); }, 120);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', schedule);
  document.addEventListener('yt-navigate-finish', schedule);
  schedule();
})();
