// Фильтр выдачи YouTube: прячет ролики каналов, у которых подписчиков больше порога.
//
// Подписчиков в самой выдаче YouTube НЕТ. Числа, которые пользователь видит
// у себя, рисует стороннее расширение vidiq, и держаться за его вёрстку нельзя:
// сменят класс или отключат — фильтр умрёт молча. Поэтому гибрид: если число
// уже нарисовано в карточке, берём готовое, иначе дотягиваем сами по channelId
// через внутренний API YouTube и кладём в кэш.

const SEL = "ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer";
const CACHE = new Map();          // channelId -> число подписчиков
let LIMIT = 0, ON = false, busy = false;
// Главный выключатель менеджера. Выключенный ничего не трогает на странице.
// Ползунок «Показать доход» из попапа. Гасит только деньги: приписку с суммой
// в шапке канала и жёлтые суммы под карточками. Прятание больших каналов живёт
// отдельным ползунком, реклама прячется всегда (пользователь, 2026-08-24).
// Ключ в хранилище остался прежний, ytmOn, чтобы не терять настройку.
let MONEY = true;

// «184 тыс.», «98,9 тыс. подписчиков», «1,2 млн», «184K subscribers», «1.2M»
function parseSubs(t) {
  if (!t) return null;
  const m = t.replace(/ /g, " ")
             .match(/([\d]+(?:[.,]\d+)?)\s*(тыс|млн|млрд|K|M|B)?/i);
  if (!m) return null;
  const mul = { "тыс": 1e3, "млн": 1e6, "млрд": 1e9, k: 1e3, m: 1e6, b: 1e9 };
  return Math.round(parseFloat(m[1].replace(",", ".")) * (mul[(m[2] || "").toLowerCase()] || 1));
}

// Число, которое уже стоит в карточке: его рисует vidiq. Запроса не делаем.
// Читаем ТЕКСТ КАРТОЧКИ ЦЕЛИКОМ, а не отдельные элементы: vidiq кладёт число
// и слово «Подписчики» в РАЗНЫЕ узлы, и поэлементный поиск не находил ничего.
function subsFromCard(card) {
  const t = (card.innerText || "").replace(/\u00a0/g, " ");
  const NUM = "([\\d]+(?:[.,]\\d+)?\\s*(?:тыс\\.?|млн|млрд|K|M|B)?)";
  return parseSubs(
    (t.match(new RegExp(NUM + "\\s*(?:подписчик\\w*|subscribers?)", "i")) ||
     t.match(new RegExp(NUM + "\\s*\\n+\\s*(?:Подписчики|Subscribers)", "i")) || [])[1]);
}

function channelIdOf(card) {
  // Ссылка на канал бывает БЕЗ href: YouTube отдаёт пустые <a> в заготовках
  // карточек, и вызов .replace на пустом значении ронял весь скрипт.
  const byId = card.querySelector('a[href^="/channel/UC"]');
  if (byId) return (byId.getAttribute("href") || "").split("/")[2] || null;
  for (const a of card.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href") || "";
    if (h.startsWith("/@")) return "handle:" + h.slice(1).split("/")[0];
    if (h.startsWith("/channel/UC")) return h.split("/")[2] || null;
  }
  return null;
}

// Внутренний API YouTube. Ключ и версия клиента лежат в самой странице.
function cfg() {
  const h = document.documentElement.innerHTML;
  return {
    key: (h.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1],
    ver: (h.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1],
  };
}

async function fetchSubs(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const { key, ver } = cfg();
  if (!key) return null;
  try {
    let real = id;
    if (id.startsWith("handle:")) {
      const r = await post(`/youtubei/v1/navigation/resolve_url?key=${key}&prettyPrint=false`,
                           { context: ctx(ver), url: "https://www.youtube.com/" + id.slice(7) });
      real = r?.endpoint?.browseEndpoint?.browseId;
      if (!real) return null;
    }
    const j = await post(`/youtubei/v1/browse?key=${key}&prettyPrint=false`,
                         { context: ctx(ver), browseId: real });
    // Берём число ИЗ ШАПКИ канала. Первое попавшееся "subscriberCountText"
    // в ответе брать нельзя: оно принадлежит каналу из рекомендаций сбоку.
    // На @hauntedcosmos_ так получалось 17.3K вместо настоящих 68.6K.
    const rows = j?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel
                  ?.metadata?.contentMetadataViewModel?.metadataRows || [];
    let txt = rows.flatMap(r => (r.metadataParts || []).map(p => p?.text?.content))
                  .find(t => t && /subscriber|подписчик/i.test(t));
    if (!txt) txt = j?.header?.c4TabbedHeaderRenderer?.subscriberCountText?.simpleText;
    const n = parseSubs(txt);
    CACHE.set(id, n);
    return n;
  } catch (e) { return null; }
}
const ctx = (ver) => ({ client: { clientName: "WEB", clientVersion: ver || "2.20240101.00.00", hl: "en", gl: "US" } });
const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" },
                                  body: JSON.stringify(b) }).then(r => r.json());

// Реклама убирается ВСЕГДА, независимо от галочки: пользователь 2026-08-21
// «автоматически расширение пусть убирает ролики реклама, они там подписаны».
//
// Ищем от ЗНАЧКА, а не от контейнера. Контейнеров у YouTube много и они
// меняются: кроме ytd-ad-slot-renderer попадается новый yt-lockup-view-model,
// которого в списке тегов не было, и такие объявления оставались висеть.
// А значок «Реклама» рисует один и тот же ad-badge-view-model.
const BADGE = "ad-badge-view-model, feed-ad-metadata-view-model";
const BOX = "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer," +
            "ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-search-pyv-renderer," +
            "ytd-carousel-ad-renderer, ytd-rich-item-renderer, ytd-video-renderer, yt-lockup-view-model";
const ADS = "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer," +
            "ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-search-pyv-renderer," +
            "ytd-carousel-ad-renderer, ytd-companion-slot-renderer";

function hideAds() {
  for (const b of document.querySelectorAll(BADGE)) {
    const box = b.closest(BOX);
    if (box && box.style.display !== "none") { box.style.display = "none"; box.dataset.ytfAd = "1"; }
  }
  for (const el of document.querySelectorAll(ADS)) {     // вторая сеть, по тегам блоков
    if (el.style.display !== "none") { el.style.display = "none"; el.dataset.ytfAd = "1"; }
  }
}

function show(card, on) {
  if (card.dataset.ytfAd) return;          // рекламу обратно не показываем
  card.style.display = on ? "" : "none";
  card.dataset.ytfHidden = on ? "" : "1";
}

async function apply() {
  if (busy) return;
  busy = true;
  try {
    hideAds();
    const cards = [...document.querySelectorAll(SEL)].filter(c => !c.dataset.ytfAd);
    if (!ON || !LIMIT) { cards.forEach(c => show(c, true)); return; }
    const wait = [];
    for (const c of cards) {
      let n = null;
      try { n = subsFromCard(c); } catch (e) { n = null; }
      if (n == null) {
        const id = channelIdOf(c);
        if (id && CACHE.has(id)) n = CACHE.get(id);
        else if (id) { wait.push([c, id]); continue; }
      }
      show(c, n == null || n <= LIMIT);
    }
    // Незнакомые каналы тянем небольшими пачками, чтобы не бить по сети разом
    for (let i = 0; i < wait.length; i += 4) {
      const part = wait.slice(i, i + 4);
      await Promise.all(part.map(async ([c, id]) => {
        const n = await fetchSubs(id);
        show(c, n == null || n <= LIMIT);
      }));
    }
  } finally { busy = false; }
}

// Выключили менеджер: возвращаем страницу как была. Показываем всё спрятанное,
// включая рекламу, снимаем приписку с шапки канала и подписи под роликами.
function restore() {
  for (const c of document.querySelectorAll("[data-ytf-hidden], [data-ytf-ad]")) {
    c.style.display = "";
    delete c.dataset.ytfHidden;
    delete c.dataset.ytfAd;
  }
  const box = document.getElementById("ytf-month");
  if (box) box.remove();
  document.querySelectorAll(".ytf-cash").forEach((x) => x.remove());
}

let timer = null;
const nudge = () => { clearTimeout(timer); timer = setTimeout(() => { apply(); showMonth(); cashCards(); }, 400); };

chrome.storage.local.get(["ytfOn", "ytfLimit", "ytmOn"], (r) => {
  r = r || {};
  MONEY = r.ytmOn !== false;           // по умолчанию включено
  ON = !!r.ytfOn; LIMIT = +(r.ytfLimit || 0);
  apply();
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.ytmOn) {
    MONEY = ch.ytmOn.newValue !== false;
    // Суммы под карточками снимаем всегда: при включении их нарисует cashCards,
    // при выключении они должны просто исчезнуть.
    document.querySelectorAll(".ytf-cash").forEach((x) => x.remove());
    const b = document.getElementById("ytf-month");
    if (b && LAST) paintMonth(b, LAST);
    if (MONEY) cashCards();
  }
  if (ch.ytfOn) ON = !!ch.ytfOn.newValue;
  if (ch.ytfLimit) LIMIT = +ch.ytfLimit.newValue || 0;
  // «Очистить» в попапе: забываем посчитанные числа и показываем всё обратно
  if (ch.ytfClear) CACHE.clear();
  // Применяем сразу, но с задержкой: пока пользователь набирает 50000, порог
  // успевает побывать пятёркой и полусотней, и без паузы фильтр дёргался бы
  // на каждую цифру.
  if (ch.ytfOn || ch.ytfLimit || ch.ytfClear) nudge();
});
new MutationObserver(() => { hideAds(); nudge(); })
  .observe(document.documentElement, { childList: true, subtree: true });
// Старую приписку снимаем СРАЗУ, не дожидаясь пересчёта: иначе на новом канале
// секунду висят цифры предыдущего и на глазах перескакивают.
// Слушаем все четыре события, потому что они приходят по-разному. Проверено
// 2026-08-23: по клику на канал идёт yt-navigate-start, а на кнопку «назад»
// его НЕТ, там только popstate и yt-page-data-updated, и приписка оставалась
// старой до конца пересчёта.
// Снимаем только чужую: если адрес тот же, приписку не трогаем, иначе она
// мигала бы на каждое обновление страницы.
const dropStale = () => {
  const b = document.getElementById("ytf-month");
  if (b && b.dataset.ch !== channelPage()) { b.remove(); LAST = null; }
};
for (const ev of ["yt-navigate-start", "yt-navigate-finish",
                  "yt-page-data-updated", "popstate"]) addEventListener(ev, dropStale);
addEventListener("yt-navigate-finish", nudge);
setTimeout(() => { showMonth(); cashCards(); }, 1200);

// ── просмотры канала за месяц ────────────────────────────────────────────
// Такой цифры у YouTube нет, её собираем сами: берём вкладку «Видео» канала,
// складываем просмотры роликов, вышедших за последние 30 дней, и вписываем
// результат прямо в шапку рядом с именем канала (пользователь, 2026-08-22).
const MONTH_CACHE = new Map();
const AGE = { second: 1/86400, minute: 1/1440, hour: 1/24, day: 1, week: 7, month: 30.4, year: 365 };

const daysAgo = (t) => {
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/i.exec(t || "");
  return m ? +m[1] * AGE[m[2].toLowerCase()] : null;
};
// «5.7K views», «133K», «1.2M». Простое отбрасывание нецифр давало 57 вместо 5700.
const bigNum = (s) => {
  const m = /([\d.,]+)\s*([KMB])?/i.exec(String(s).replace(/\u00a0/g, " "));
  if (!m) return 0;
  const mul = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * mul);
};
const human = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + "M"
                  : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);

async function monthViews(id) {
  if (MONTH_CACHE.has(id)) return MONTH_CACHE.get(id);
  const { key, ver } = cfg();
  if (!key) return null;
  try {
    // Из ответа вытаскиваем карточки роликов и токен продолжения.
    // Новая вёрстка отдаёт карточки как lockupViewModel, videoRenderer там нет.
    const parse = (j) => {
      const cards = [];
      let token = null;
      (function walk(o) {
        if (!o || typeof o !== "object") return;
        if (o.lockupViewModel) {
          const t = [];
          (function g(x) {
            if (!x || typeof x !== "object") return;
            if (typeof x.content === "string") t.push(x.content);
            for (const k in x) g(x[k]);
          })(o.lockupViewModel);
          cards.push(t);
        }
        // Берём ПЕРВЫЙ токен: в ответе их два, и второй принадлежит другому
        // блоку, карточек по нему не приходит и постраничный обход обрывается
        // на первой же странице (проверено на Silas Mercer, 2026-08-23).
        if (!token && o.continuationItemRenderer) {
          const tk = o.continuationItemRenderer?.continuationEndpoint
                      ?.continuationCommand?.token;
          if (tk) token = tk;
        }
        for (const k in o) walk(o[k]);
      })(j);
      return { cards, token };
    };

    // params это вкладка «Видео» канала
    let j = await post(`/youtubei/v1/browse?key=${key}&prettyPrint=false`,
      { context: ctx(ver), browseId: id, params: "EgZ2aWRlb3PyBgQKAjoA" });
    let { cards, token } = parse(j);

    // ОДНОЙ СТРАНИЦЫ МАЛО. Вкладка отдаёт тридцать карточек за раз, а канал,
    // который заливает по два ролика в день, укладывает в них половину месяца.
    // На Silas Mercer из-за этого выходило 953 тысячи вместо 2,7 миллиона
    // (пользователь, 2026-08-23). Тянем продолжения, пока ролики свежее месяца.
    const older = (list) => {
      const last = list[list.length - 1];
      if (!last) return false;
      const w = last.find((x) => /\bago\b/i.test(x));
      const d = w ? daysAgo(w) : null;
      return d !== null && d > 30;
    };
    // Потолок шестьдесят роликов (пользователь, 2026-08-23). Канал с двумя
    // роликами в день выдаёт за месяц около шестидесяти, дальше тянуть нечего,
    // а лишние запросы к ютубу только замедляют страницу.
    const CAP = 60;
    let guard = 0;
    while (token && guard++ < 12 && cards.length < CAP && !older(cards)) {
      j = await post(`/youtubei/v1/browse?key=${key}&prettyPrint=false`,
        { context: ctx(ver), continuation: token });
      const next = parse(j);
      if (!next.cards.length) break;
      cards = cards.concat(next.cards);
      token = next.token;
    }

    const rows = cards
      .slice(0, CAP)
      .map((t) => ({ v: t.find((x) => /\bviews?\b/i.test(x)) || "", w: t.find((x) => /\bago\b/i.test(x)) || "" }))
      .filter((r) => r.v && r.w);
    // СТРОГО МЕНЬШЕ тридцати. YouTube пишет «1 month ago» для всего от тридцати
    // до шестидесяти дней, и при d <= 30 такие ролики попадали в месячную сумму.
    // На Silas Mercer это давало 4,56 миллиона вместо настоящих 2,7
    // (пользователь, 2026-08-23). В днях и неделях YouTube считает до «4 weeks»,
    // то есть двадцати восьми дней, так что ничего живого мы не теряем.
    const fresh = rows.filter((r) => { const d = daysAgo(r.w); return d !== null && d < 30; });
    const res = { views: fresh.reduce((a, r) => a + bigNum(r.v), 0), count: fresh.length };
    MONTH_CACHE.set(id, res);
    return res;
  } catch (e) { return null; }
}


// Канал опознаём ПО АДРЕСУ, а не по разметке. После перехода внутри ютуба
// страница ещё держит данные предыдущего канала: externalId, meta itemprop
// и даже canonical у страниц с хэндлом остаются старыми. Проверено 2026-08-23:
// на /@wizofYT все три источника отдавали id Отиса, и приписка показывала
// его цифры. Свежий на переходе только location.pathname.
function channelPage() {
  // Хэндл берём как «всё до следующего слэша». Через \w нельзя: без флага u
  // он ловит только латиницу, и каналы с кириллическим именем вроде
  // @Михаил-Дубравин не опознавались вовсе (пользователь, 2026-08-23).
  const m = location.pathname.match(/^\/(?:@[^\/]+|(?:channel|c|user)\/[^\/]+)/);
  return m ? m[0] : null;
}

// Путь в id канала. Для /channel/UCxxx он в самом адресе, для хэндла тянем
// страницу отдельным запросом: её ответ относится к нужному каналу, в отличие
// от разметки уже открытой страницы.
const ID_CACHE = new Map();
async function channelId(key) {
  const direct = (key.match(/^\/channel\/(UC[\w-]{20,24})/) || [])[1];
  if (direct) return direct;
  if (ID_CACHE.has(key)) return ID_CACHE.get(key);
  try {
    const html = await fetch(key, { credentials: "same-origin" }).then((r) => r.text());
    const id = (html.match(/"externalId":"(UC[\w-]{20,24})"/) || [])[1] || null;
    if (id) ID_CACHE.set(key, id);
    return id;
  } catch (e) { return null; }
}


// Строка «@handle · N подписчиков · N видео» в шапке канала. Ищем по смыслу,
// а не по классу: имена классов у YouTube меняются от версии к версии.
function metaRow() {
  const all = [...document.querySelectorAll("div, span")].filter((e) => {
    const t = e.textContent || "";
    return t.length < 90 && /подписчик|subscriber/i.test(t) && /видео|videos/i.test(t);
  });
  return all.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0] || null;
}

async function showMonth() {
  const key = channelPage();
  const old = document.getElementById("ytf-month");
  if (!key) { if (old) old.remove(); return; }
  // Приписка помнит адрес канала, на котором стоит. Сменился адрес, значит
  // считаем заново.
  if (old && old.dataset.ch === key) return;
  if (old) old.remove();
  const row = metaRow();
  if (!row) return;

  const box = document.createElement("span");
  box.id = "ytf-month"; box.dataset.ch = key;
  // Размер приписки 11 пикселей (пользователь, 2026-08-23). Рядом с текстом
  // канала в 14 пикселей она читается как пометка, а не как часть строки.
  // Задан явно, а не через font:inherit: наследование зависит от вёрстки
  // шапки, и YouTube её периодически меняет.
  box.style.cssText = "margin-left:8px;color:#f5d442;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display',system-ui,sans-serif;font-size:11px;font-weight:500;white-space:nowrap";
  box.textContent = "• считаю…";
  row.appendChild(box);

  const id = await channelId(key);
  if (!id || channelPage() !== key) { box.remove(); return; }
  const r = await monthViews(id);
  // Пока шёл запрос, пользователь мог уйти на другой канал. Ответ по старому
  // каналу нельзя рисовать в шапку нового (пользователь, 2026-08-23).
  if (!document.body.contains(box)) return;
  if (channelPage() !== key) { box.remove(); return; }
  LAST = r ? { id, ...r } : null;
  paintMonth(box, r);
}

// Доход считаем просто: просмотры делим на тысячу и множим на RPM. Значение
// RPM живёт в попапе, по умолчанию два доллара (пользователь, 2026-08-22).
let RPM = 2, LAST = null;

function money(n) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(".0", "") + "K";
  return "$" + (n < 10 ? n.toFixed(1) : Math.round(n));
}

function paintMonth(box, r) {
  if (!box || !r) { if (box) box.textContent = "• месяц не посчитался"; return; }
  // Просмотры показываем всегда, доход только при включённом ползунке.
  const cash = MONEY ? ` · ${money(r.views / 1000 * RPM)}` : "";
  box.textContent = `• ${human(r.views)} за месяц${cash}`;
  box.title = `${r.views.toLocaleString("ru-RU")} просмотров у ${r.count} роликов за 30 дней` +
              (MONEY ? `, при RPM ${RPM} это ${money(r.views / 1000 * RPM)}` : "");
}

chrome.storage.local.get(["ytfRpm"], (r) => { if ((r || {}).ytfRpm !== undefined) RPM = +r.ytfRpm || 0; });
chrome.storage.onChanged.addListener((ch) => {
  if (!ch.ytfRpm) return;
  RPM = +ch.ytfRpm.newValue || 0;
  const box = document.getElementById("ytf-month");
  if (box && LAST) paintMonth(box, LAST);     // пересчитываем без нового запроса
  cashCards(true);                            // и подписи под роликами тоже
});

// ── доход под каждым роликом ─────────────────────────────────────────────
// Под каждой карточкой дописываем, сколько ролик принёс: просмотры делим
// на тысячу и множим на RPM (пользователь, 2026-08-22).
const CARDS = "yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer";
const METAROW = "div.ytContentMetadataViewModelMetadataRow, #metadata-line";

// «475 просмотров», «5,7 тыс. просмотров», «1,2 млн», «65K views»
function viewsOf(t) {
  const m = /([\d]+(?:[.,]\d+)?)\s*(тыс\.?|млн|млрд|K|M|B)?\s*(?:просмотр\w*|views?)/i
    .exec(String(t).replace(/\u00a0/g, " "));
  if (!m) return null;
  const mul = { "тыс": 1e3, "тыс.": 1e3, "млн": 1e6, "млрд": 1e9, k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase()] || 1;
  return Math.round(parseFloat(m[1].replace(",", ".")) * mul);
}

function cashCards(again) {
  if (!MONEY) return;
  if (again) document.querySelectorAll(".ytf-cash").forEach((x) => x.remove());
  for (const c of document.querySelectorAll(CARDS)) {
    const row = [...c.querySelectorAll(METAROW)].find((e) => /просмотр|views/i.test(e.textContent || ""));
    if (!row) continue;
    const v = viewsOf(row.textContent);
    if (v == null) continue;
    // Карточку YouTube переиспользует: при новом поиске и переходах внутри
    // сайта он не строит разметку заново, а подменяет текст в старых узлах.
    // Наша подпись при этом оставалась от прошлого ролика: под «1,4 млн
    // просмотров» висело «$10» от ролика с 2,5 тысячами (пользователь,
    // 2026-09-11). Поэтому готовую подпись не пропускаем, а сверяем с числом
    // в строке и перерисовываем, если просмотры или RPM сменились.
    let b = c.querySelector(".ytf-cash");
    if (b && b.dataset.v === String(v) && b.dataset.rpm === String(RPM)) continue;
    if (!b) {
      b = document.createElement("span");
      b.className = "ytf-cash";
      b.style.cssText = "margin-left:6px;color:#f5d442;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display',system-ui,sans-serif;font-weight:700";
    }
    b.dataset.v = String(v);
    b.dataset.rpm = String(RPM);
    b.textContent = "• " + money(v / 1000 * RPM);
    b.title = `${v.toLocaleString("ru-RU")} просмотров при RPM ${RPM}`;
    if (b.parentNode !== row) row.appendChild(b);
  }
}
