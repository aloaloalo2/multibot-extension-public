importScripts("heygen-audio-background.js", "yt-studio-summary-worker.js");
// ── Автоподача раскадровки в чат Google Flow ─────────────────────────────
// Цикл живёт в service worker, потому что попап закрывается.
// Печать идёт через chrome.debugger: Flow принимает только доверенный ввод.

// Уходит первым абзацем самого первого сообщения. Правится здесь.
const HEAD = `Генерируй картинки. Если картинка вышла с ошибкой, перефразируй её промт
и сгенерируй заново. После генерации переименуй картинки числом кадра`;

let job = null;            // { tabId, chunks, idx, running, head, newSession, log[] }
let starting = false;      // замок на время старта задания: гонку двух pollJob не пускаем
let gen = 0;               // номер задания: прошлый цикл сам замолкает
let attachedTab = null;
let baseLen = 30;          // длина пустого поля: в нём висит подсказка

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isEmpty = (p) => !!p && p.len <= baseLen + 5;

// ── бейдж расширения ─────────────────────────────────────────────────────
// Иконка на карточке статичная, из манифеста: серая стрелка скачивания.
// Воркер её НЕ трогает. Единственное, что он делает, — бейдж с процентом
// готовности, переливающийся зелёным в жёлтый.
//
// Почему так: setIcon вызывался в том числе при старте воркера, а клик по
// кнопке воркер и будит. Правка кнопки в момент её нажатия и съедала открытие
// панели (пользователь, 2026-08-20, трижды). Теперь два правила:
//   1. ни одного setIcon — иконка берётся из манифеста;
//   2. к chrome.action обращаемся ТОЛЬКО пока идёт подача, при старте воркера
//      и в покое кнопка не трогается вообще.
const BLINK_MS = 400, BLINK_PERIOD = 1600;   // шаг перелива и полный цикл
let blinkTimer = null, blinkPhase = 0, lastText = "";
let iconPct = 0, pctIdx = -1;                // процент и кусок, на котором его считали

// Стрелка переливается из своего обычного серого в жёлтый и обратно
// (пользователь, 2026-08-20).
const C_FROM = [154, 160, 166];              // тот же серый, что в покое
const C_TO = [245, 212, 66];                 // жёлтый
// Бейдж не мигает: ровная серая плашка с жёлтыми цифрами, всё движение
// отдано стрелке (пользователь, 2026-08-20).
const BADGE_TEXT = "#f5d442";
const BADGE_BG = "#2e333a";

// Плавный перелив: косинус даёт мягкие концы, без рывка на развороте.
function mixAt(phase) {
  const k = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const hex = (v) => v.toString(16).padStart(2, "0");
  return "#" + C_FROM.map((a, i) => hex(Math.round(a + (C_TO[i] - a) * k))).join("");
}

// Стрелка на кнопке мигает вместе с бейджем, поэтому её приходится рисовать.
// В покое стрелка обычная, крупная — та же, что лежит в файлах манифеста.
// Пока идёт подача, она уменьшается и уходит вверх, чтобы бейдж внизу её
// не закрывал (пользователь, 2026-08-20).
// ВАЖНО: setIcon зовём ТОЛЬКО пока идёт подача и при её остановке. При старте
// воркера кнопку трогать нельзя — именно это и срывало открытие панели.
const ICON = 32;
const ICON_GRAY = "rgb(154, 160, 166)";

function plate(x) {
  x.clearRect(0, 0, ICON, ICON);
  x.fillStyle = "#1b1e24";
  x.beginPath();
  if (x.roundRect) x.roundRect(0, 0, ICON, ICON, ICON * 0.22);
  else x.rect(0, 0, ICON, ICON);
  x.fill();
}

function arrowBig(color) {                   // покой: как в файлах манифеста
  const x = new OffscreenCanvas(ICON, ICON).getContext("2d"), W = ICON;
  plate(x);
  x.fillStyle = color;
  x.fillRect(W * 0.435, W * 0.15, W * 0.13, W * 0.32);
  x.beginPath();
  x.moveTo(W * 0.29, W * 0.44);
  x.lineTo(W * 0.71, W * 0.44);
  x.lineTo(W * 0.50, W * 0.72);
  x.closePath(); x.fill();
  x.fillRect(W * 0.24, W * 0.79, W * 0.52, W * 0.075);
  return x.getImageData(0, 0, W, W);
}

function arrowSmall(color) {                 // работа: мельче и выше, под бейдж
  const x = new OffscreenCanvas(ICON, ICON).getContext("2d"), W = ICON;
  plate(x);
  x.fillStyle = color;
  x.fillRect(W * 0.455, W * 0.06, W * 0.09, W * 0.23);
  x.beginPath();
  x.moveTo(W * 0.36, W * 0.28);
  x.lineTo(W * 0.64, W * 0.28);
  x.lineTo(W * 0.50, W * 0.45);
  x.closePath(); x.fill();
  x.fillRect(W * 0.37, W * 0.50, W * 0.26, W * 0.056);
  return x.getImageData(0, 0, W, W);
}

function paintIcon(data) {
  try {
    const r = chrome.action.setIcon({ imageData: { 32: data } });
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* воркер уже гасят — рисовать некуда */ }
}

function badge(text, color) {
  try {
    if (text !== null) chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) { /* воркер уже гасят */ }
}

// Пачек уже ушло в чат: отправленная считается сразу, не дожидаясь генерации.
const sentIdx = (j) => Math.max((j && j.idx) || 0, (j && j.sent) || 0);

// Считаем ровно то же, что показывает панель в «Готово кадров N из M».
function jobPct(j) {
  if (!j || !j.chunks || !j.chunks.length) return 0;
  const t = tally({ ...j, idx: sentIdx(j) });
  const all = t.bAll || (t.iAll + t.vAll);
  if (!all) return 0;
  const done = Math.min((t.bDone || 0) + t.iDone + t.vDone, all);
  return Math.max(0, Math.min(100, Math.round(100 * done / all)));
}

function blink(on) {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  if (!on) { pctIdx = -1; lastText = ""; badge("", null); paintIcon(arrowBig(ICON_GRAY)); return; }
  pctIdx = -1; blinkPhase = 0; lastText = "";
  try {
    if (chrome.action.setBadgeTextColor)
      chrome.action.setBadgeTextColor({ color: BADGE_TEXT });
  } catch (e) { /* Chrome старее 110 — цвет текста подберёт сам */ }
  const draw = (first) => {
    // процент пересчитываем только когда ушёл следующий кусок
    if (job && sentIdx(job) !== pctIdx) { pctIdx = sentIdx(job); iconPct = jobPct(job); }
    const t = `${iconPct}%`;
    // фон бейджа ставим один раз, текст — только когда цифра сменилась
    if (first) badge((lastText = t), BADGE_BG);
    else if (t !== lastText) badge((lastText = t), null);
    paintIcon(arrowSmall(mixAt(blinkPhase)));      // переливается только стрелка
  };
  draw(true);
  blinkTimer = setInterval(() => {
    blinkPhase = (blinkPhase + BLINK_MS / BLINK_PERIOD) % 1;
    draw();
  }, BLINK_MS);
}

// Chrome выгружает service worker через ~30 секунд без событий.
function keepAlive(on) {
  if (on) chrome.alarms.create("flowTick", { periodInMinutes: 0.4 });
  else chrome.alarms.clear("flowTick");
  blink(on);
}

function stamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

// Лог кладём в хранилище: память воркера не переживает выгрузку.
function say(line) {
  if (!job) return;
  job.log.push(stamp() + "  " + line);
  if (job.log.length > 400) job.log.shift();
  chrome.storage.local.set({ flowLog: job.log, flowRunning: job.running, flowTotal: job.chunks.length });
}

// ── отладчик ─────────────────────────────────────────────────────────────

let flowDebuggerQueue = Promise.resolve();
const isFlowBackgroundUrl = url => /^https:\/\/(?:flow\.google\.com\/|labs\.google\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$))/i.test(url || "");
function withFlowDebuggerLock(work) {
  const next = flowDebuggerQueue.then(work, work);
  flowDebuggerQueue = next.catch(() => {});
  return next;
}
async function waitForFlowBackgroundTab(tabId) {
  const deadline = Date.now() + 6000;
  while (true) {
    const tab = await toTabGetQuiet(tabId);
    if (!tab) throw new Error("Вкладка Flow закрита");
    if (tab.pendingUrl && !isFlowBackgroundUrl(tab.pendingUrl)) throw new Error("Вкладка Flow змінила адресу");
    if (isFlowBackgroundUrl(tab.url)) return tab;
    if (!isFlowBackgroundUrl(tab.pendingUrl) || Date.now() >= deadline) throw new Error("Вкладка Flow ще не завантажилась або змінила адресу");
    await sleep(100);
  }
}
async function detachFlowDebugger() {
  const tabId = attachedTab;
  attachedTab = null;
  if (tabId === null) return;
  try { await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: false }); } catch (e) {}
  try { await chrome.debugger.detach({ tabId }); } catch (e) {}
}
async function attachFlowDebugger(tabId) {
  await waitForFlowBackgroundTab(tabId);
  if (attachedTab !== tabId) {
    await detachFlowDebugger();
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (e) {
      const m = String(e.message || e);
      if (/already attached|Another debugger/i.test(m))
        throw new Error("К вкладке подключён другой отладчик. Закройте DevTools и Claude in Chrome на ней, либо откройте Flow в новой вкладке.");
      throw e;
    }
    attachedTab = tabId;
  }
  try {
    // Reassert after navigation/reload without activating a tab or Mac window.
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch (e) {
    await detachFlowDebugger();
    throw e;
  }
}
async function attach(tabId) {
  return withFlowDebuggerLock(() => attachFlowDebugger(tabId));
}
// Chrome отключает отладчик сам: вкладка перезагрузилась, пользователь нажал
// «Отмена» на плашке «расширение отлаживает браузер», зашёл другой отладчик.
// Переменная при этом продолжала помнить вкладку, attach() выходил сразу,
// и каждая команда падала с «Debugger is not attached». Внешне это выглядело
// как «продолжить не работает»: отправка срывалась, счётчик не двигался,
// и следующее «Продолжить» снова начинало с первого куска.
chrome.debugger.onDetach.addListener((src) => {
  if (src && src.tabId === attachedTab) attachedTab = null;
});

async function detach() {
  return withFlowDebuggerLock(detachFlowDebugger);
}

// ── функции, исполняемые ВНУТРИ страницы ─────────────────────────────────
// Каждая обязана быть самодостаточной: chrome.scripting внедряет только
// саму функцию, соседей по файлу она не видит.

function probe() {
  // Кнопка отправки это единственная кнопка с иконкой arrow_forward
  // (свободна) или stop (идёт генерация). Обходом дерева её искать нельзя:
  // на свежем проекте так попадается крестик из шапки панели.
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  const ed = eds[eds.length - 1];
  const all = [...document.querySelectorAll("button")];
  const ico = (b) => (b.innerText || "").replace(/\s+/g, " ").trim();
  const send = all.find((b) => /^arrow_forward\b/.test(ico(b)))
            || all.find((b) => /^stop\b/.test(ico(b)))
            || null;
  const icon = send ? ico(send) : "";

  let box = null, sbox = null;
  if (ed) { const r = ed.getBoundingClientRect(); box = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
  if (send) { const r = send.getBoundingClientRect(); sbox = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }

  const texts = [...document.querySelectorAll("p,div")]
    .filter((d) => d.childElementCount === 0 && (d.innerText || "").trim().length > 20)
    .map((d) => d.innerText.trim());

  // Flow иногда отвечает «Агент перегружен» и вешает кнопку «Повторить».
  // Слать в этот момент следующие пачки бессмысленно: они уйдут в пустоту
  // (пользователь, 2026-08-20). Ловим и кнопку, и сам текст баннера.
  const rbtn = all.find((b) => /^(повторить|retry|try again)$/i.test(ico(b).toLowerCase()));
  const retry = !!rbtn;
  // Текст рядом с кнопкой: иногда там «Агент перегружен», иногда
  // «Что-то пошло не так» (пользователь, 2026-08-20). Берём его для лога,
  // а фразу про ошибку засчитываем ТОЛЬКО внутри этого баннера: под кадрами
  // она же стоит на каждой сорвавшейся картинке, и там это обычный брак.
  let banner = "";
  if (rbtn) {
    let n = rbtn;
    for (let i = 0; i < 4 && n.parentElement; i++) n = n.parentElement;
    banner = (n.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const bodyTxt = (document.body.innerText || "");
  // Голое слово «перегружен» ловить нельзя: оно может прийти в промте и
  // остановить подачу на ровном месте. Ищем целую фразу баннера.
  const over = /агент перегружен|перегружен\.?\s*повторите|agent is overloaded|too many requests/i.test(bodyTxt)
            || /что-то пошло не так|something went wrong|перегруж/i.test(banner);

  // Плитки «Что-то пошло не так» считаем штуками. Одна-две это обычный брак
  // генерации, его велено пропускать. Останавливаться нужно, только когда
  // завалилась вся пачка (пользователь, 2026-08-20).
  const errs = [...document.querySelectorAll("div,p,span")]
    .filter((d) => d.childElementCount === 0 &&
      /что-то пошло не так|something went wrong/i.test(d.innerText || "")).length;

  // Кто сейчас получит нажатие клавиши. Enter уходит в активный элемент,
  // и если это не поле ввода, он жмёт постороннюю кнопку.
  const ae = document.activeElement;
  const act = ae ? {
    tag: ae.tagName,
    edit: ae.getAttribute && ae.getAttribute("contenteditable") === "true",
    t: (ae.innerText || ae.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 30),
  } : null;

  return {
    act,
    hasEditor: !!ed,
    len: ed ? ed.innerText.trim().length : 0,
    icon,
    // Новый сайт гасит кнопку атрибутом disabled, старый ставил aria-disabled.
    // Наружу отдаём прежний вид "true"/null, чтобы остальной код не трогать.
    off: send ? ((send.getAttribute("aria-disabled") === "true" || send.disabled) ? "true" : null) : null,
    busy: !send || /^stop\b/.test(icon),   // нет кнопки — считаем занятым
    box, sbox,
    media: [...document.querySelectorAll("img")].filter((i) => i.clientWidth >= 60).length
         + document.querySelectorAll("video").length,
    tail: texts.length ? texts[texts.length - 1].slice(-300) : "",
    retry, over, errs, banner,
    stall: retry || over,
  };
}

function focusEditor() {
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  const ed = eds[eds.length - 1];
  if (!ed) return { ok: false };
  ed.focus();
  try {
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  } catch (e) {}
  const a = document.activeElement;
  return { ok: a === ed || ed.contains(a), active: a ? a.tagName : null };
}

// Cmd+A здесь нельзя: Flow выделяет им всю сетку ассетов, а не текст.
function selectAllInEditor() {
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  const ed = eds[eds.length - 1];
  if (!ed) return false;
  ed.focus();
  try {
    const sel = window.getSelection(), r = document.createRange();
    r.selectNodeContents(ed);
    sel.removeAllRanges(); sel.addRange(r);
  } catch (e) { return false; }
  return true;
}

function clickSendDom() {
  const ico = (b) => (b.innerText || "").replace(/\s+/g, " ").trim();
  const b = [...document.querySelectorAll("button")].find((x) => /^arrow_forward\b/.test(ico(x)));
  if (!b || b.getAttribute("aria-disabled") === "true") return false;
  b.click();
  return true;
}

// Плитка «Создать проект» лежит поверх карточки готового проекта, поэтому
// отсеиваем всё, внутри чего есть ссылка на существующий проект.
function clickCreateProject() {
  const all = [...document.querySelectorAll("button")];
  const good = all.filter((x) => {
    const t = (x.innerText || "").replace(/\s+/g, " ").trim();
    // Плитка на новом сайте подписана «Новый проект», на старом была
    // «Создать проект». Держим оба и английский.
    if (!/создать\s+проект|новый\s+проект|new\s+project/i.test(t)) return false;
    if (x.querySelector('a[href*="/project/"]')) return false;
    if (x.closest('a[href*="/project/"]')) return false;
    return t.length < 40;
  });
  const b = good[good.length - 1];
  if (!b) return { ok: false, seen: all.map((x) => (x.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24)).filter(Boolean).slice(0, 14) };
  b.click();
  return { ok: true, t: (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24) };
}

// Собирает имена готовых ассетов из сетки проекта.
// Сетка виртуальная: в разметке живут только видимые плитки, поэтому
// прокручиваем её сверху донизу и собираем подписи на каждом шаге.
// Панель чата исключаем по координате: там лежат наши же промты с таймкодами.
async function collectDone() {
  const eds = [...document.querySelectorAll('[contenteditable="true"]')];
  const ed = eds[eds.length - 1];
  const chatLeft = ed ? ed.getBoundingClientRect().left - 40 : Infinity;

  // самый большой прокручиваемый контейнер левее чата это и есть сетка
  let grid = null, best = 0;
  for (const el of document.querySelectorAll("div")) {
    const r = el.getBoundingClientRect();
    if (r.left >= chatLeft || r.width < 200) continue;
    if (el.scrollHeight > el.clientHeight + 50 && el.clientHeight > best) { best = el.clientHeight; grid = el; }
  }

  const done = new Set();
  const sample = [];
  const grab = () => {
    for (const el of document.querySelectorAll("div, span, p")) {
      if (el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (!t || t.length > 80) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left >= chatLeft) continue;
      if (sample.length < 25) sample.push(t);
      // Flow подписывает плитки по-разному: «4.09», «4.09sec», «0.12sec [ТЕГ]»,
      // «4_09», «4-09», «Кадр 4.09», «0.25sec_3». Приводим разделители к точке
      // и берём любое число вида М.СС, не приклеенное к другим цифрам.
      // Так размеры 896x1200, даты и «3:4» в счёт не попадают.
      const norm = t.replace(/[_\-–—]/g, ".").replace(/\s*sec\b/gi, "");
      for (const m of norm.matchAll(/(?<!\d)(\d{1,2})[.,](\d{2})(?!\d)/g))
        done.add(`${parseInt(m[1], 10)}.${m[2]}sec`);
    }
  };

  grab();
  if (grid) {
    const step = Math.max(200, grid.clientHeight - 100);
    const was = grid.scrollTop;
    for (let y = 0; y <= grid.scrollHeight; y += step) {
      grid.scrollTop = y;
      await new Promise((r) => setTimeout(r, 260));
      grab();
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 5) break;
    }
    grid.scrollTop = was;
  }
  return { done: [...done], sample, grid: !!grid, chatLeft: Math.round(chatLeft) };
}

// Меню с тремя точками справа сверху: в нём пункт «Скачать проект»,
// который отдаёт весь проект одним архивом. Свой сбор файлов не нужен.
function findKebab() {
  const btns = [...document.querySelectorAll("button")];
  const txt = (b) => (b.innerText || "").replace(/\s+/g, " ").trim();
  const top = btns.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.top < 90 && r.width > 10 && r.right > window.innerWidth * 0.45;
  });
  const hit = top.find((b) => /^(more_vert|more_horiz)\b/i.test(txt(b)))
           || top.find((b) => /меню|more|options/i.test((b.getAttribute("aria-label") || b.title || "")))
           || top[top.length - 3];
  if (!hit) return { ok: false, seen: top.map(txt).slice(0, 12) };
  const r = hit.getBoundingClientRect();
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), t: txt(hit).slice(0, 20) };
}

function findDownloadItem() {
  const nodes = [...document.querySelectorAll("[role='menuitem'], li, button, div, span")];
  const txt = (b) => (b.innerText || "").replace(/\s+/g, " ").trim();
  const cand = nodes.filter((b) => {
    const t = txt(b);
    if (!t || t.length > 40) return false;
    const r = b.getBoundingClientRect();
    return r.width > 60 && r.height > 16 && r.height < 70;
  });
  const hit = cand.find((b) => /^скачать проект$/i.test(txt(b)))
           || cand.find((b) => /скачать проект|download project/i.test(txt(b)))
           || cand.find((b) => /^скачать\b|^download\b/i.test(txt(b)));
  if (!hit) return { ok: false, seen: [...new Set(cand.map(txt))].slice(0, 20) };
  const r = hit.getBoundingClientRect();
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), t: txt(hit).slice(0, 30) };
}

// Кнопка «Новый сеанс» в шапке панели чата.
function findNewChat() {
  const btns = [...document.querySelectorAll("button")];
  const info = btns
    .map((b) => ({ b, r: b.getBoundingClientRect(), t: (b.innerText || "").replace(/\s+/g, " ").trim() }))
    .filter((o) => o.r.width > 8 && o.r.top < 220);
  let hit = info.find((o) => /новый\s+сеанс|new\s+(chat|session)/i.test(o.t))
         || info.find((o) => /^edit_square\b/i.test(o.t));
  const list = info.map((o) => ({ x: Math.round(o.r.left + o.r.width / 2), y: Math.round(o.r.top + o.r.height / 2), t: o.t.slice(0, 24) }));
  if (!hit) return { ok: false, why: "кнопка не найдена", info: list };
  return { ok: true, x: Math.round(hit.r.left + hit.r.width / 2), y: Math.round(hit.r.top + hit.r.height / 2), t: hit.t.slice(0, 24), info: list };
}

// ── помощники ────────────────────────────────────────────────────────────

async function run(fn) {
  if (!job || job.cancelled) throw new Error("Подачу Flow зупинено");
  await attach(job.tabId);
  if (job.cancelled) throw new Error("Подачу Flow зупинено");
  const r = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func: fn });
  return r && r[0] ? r[0].result : null;
}

// Если отладчик всё-таки отвалился между командами, переподключаемся и
// повторяем один раз: терять из-за этого весь прогон незачем.
async function cdp(m, p) {
  if (!job || job.cancelled) throw new Error("Подачу Flow зупинено");
  try {
    return await chrome.debugger.sendCommand({ tabId: job.tabId }, m, p);
  } catch (e) {
    if (!/not attached/i.test(String(e.message || e))) throw e;
    attachedTab = null;
    say("отладчик отвалился, переподключаюсь");
    await attach(job.tabId);
    return await chrome.debugger.sendCommand({ tabId: job.tabId }, m, p);
  }
}

async function mouseClick(x, y) {
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}

// Перевод строки в поле Flow равен отправке, поэтому строки разделяем
// мягким переносом Shift+Enter, а текст строки кладём разом.
async function typeLines(text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await cdp("Input.insertText", { text: lines[i] });
    if (i < lines.length - 1) {
      const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 };
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    }
  }
}

async function typeChars(text) {
  for (const ch of text) {
    if (ch === "\n") {
      const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 8 };
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    } else {
      await cdp("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch, unmodifiedText: ch });
    }
  }
}

async function clearEditor() {
  if (!await run(selectAllInEditor)) return false;
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await sleep(300);
  return isEmpty(await run(probe));
}

async function waitEditor(sec = 20) {
  for (let i = 0; i < sec * 2; i++) {
    const p = await run(probe);
    if (p && p.hasEditor) return p;
    await sleep(500);
  }
  return null;
}

async function putText(text) {
  let p0 = await run(probe);
  if (!p0 || !p0.hasEditor) { say("   поля ввода нет, жду появления"); p0 = await waitEditor(20); }
  if (!p0) { say("поле ввода не появилось за 20 секунд"); return false; }
  baseLen = p0.len;

  await attach(job.tabId);
  await sleep(200);
  await run(focusEditor);

  await typeLines(text);
  await sleep(900);
  let p = await run(probe);

  // Живая кнопка отправки — единственный признак, что приложение видит текст.
  if (!p || p.off === "true") {
    say(`   кнопка серая при ${p ? p.len : 0} символах, набиваю посимвольно`);
    if (!await clearEditor()) { say("   очистить поле не вышло"); return false; }
    await run(focusEditor);
    await typeChars(text);
    await sleep(1200);
    p = await run(probe);
  }
  // Пустое поле показывает подсказку, её длина = baseLen. Если после ввода
  // длина не выросла, текста в поле нет, сколько бы кнопка ни была живой.
  if (!p || p.len <= baseLen + 5) {
    say(`   текст не встал: в поле ${p ? p.len : 0} при пустом ${baseLen}`);
    return false;
  }
  if (p.off === "true") { say("текст не принят полем"); return false; }
  say(`   в поле ${p.len} символов из ${text.length}, кнопка «${p.icon}»`);
  return true;
}

async function pressEnter() {
  const k = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", text: "\r", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}

async function send() {
  for (let i = 0; i < 20; i++) {
    const p = await run(probe);
    if (p && p.off !== "true" && !p.busy) break;
    await sleep(500);
  }
  const pre = await run(probe);
  // Если чат УЖЕ занят прошлой генерацией, признак «идёт генерация» ничего
  // не доказывает: он был занят и до нашего Enter. В таком случае верим
  // только опустевшему полю (пользователь, 2026-08-28: в логе стояло
  // «ушло по Enter, генерация уже идёт», хотя генерация шла прошлая).
  const wasBusy = !!(pre && pre.busy);
  if (wasBusy) say("   внимание: чат занят прошлой генерацией, отправку считаю только по пустому полю");
  if (isEmpty(pre)) { say(`   поле пустое до отправки (${pre ? pre.len : "?"}), Enter не жму`); return false; }

  await run(focusEditor);
  const f = await run(probe);
  const a = f && f.act;
  say(a ? `   фокус перед Enter: <${a.tag}>${a.edit ? " поле ввода" : ""} «${a.t}»`
        : "   фокус перед Enter определить не вышло");
  if (a && !a.edit && a.tag === "BUTTON") {
    say("   в фокусе КНОПКА, Enter не жму, иначе нажмётся она");
    await run(clickSendDom);
    await sleep(1400);
    const q = await run(probe);
    if ((q && q.busy && !wasBusy) || isEmpty(q)) { say("   ушло по кнопке отправки"); return true; }
  }
  await pressEnter();
  await sleep(1500);
  let p = await run(probe);
  if (p && p.busy && !wasBusy) { say("   ушло по Enter, генерация уже идёт"); return true; }
  if (isEmpty(p)) { say("   ушло по Enter"); return true; }

  say(`   Enter не сработал (в поле ${p ? p.len : "?"} при пустом ${baseLen}), жму кнопку`);
  await run(clickSendDom);
  await sleep(1400);
  p = await run(probe);
  if (p && p.busy && !wasBusy) { say("   ушло по кнопке, генерация идёт"); return true; }
  if (isEmpty(p)) { say("   ушло по кнопке"); return true; }

  // мышью бьём только по СВОБОДНОЙ кнопке отправки и по свежим координатам
  p = await run(probe);
  if (p && p.sbox && !p.busy) {
    say("   жму кнопку мышью");
    await mouseClick(p.sbox.x, p.sbox.y);
    await sleep(1600);
    p = await run(probe);
    if ((p && p.busy) || isEmpty(p)) { say("   ушло по клику мышью"); return true; }
  }
  say(`   поле так и не опустело (${p ? p.len : "?"} символов)`);
  return false;
}

// Сначала дожидаемся, что генерация началась, потом что кончилась.
// Перед отправкой пачки ждём, пока Flow договорит предыдущую. Внутри прогона
// это лишняя мелочь, потому что цикл и так стоит на waitDone. А вот кнопку
// «Продолжить» человек жмёт когда угодно, в том числе посреди генерации, и
// раньше расширение в этот момент лезло печатать в занятый чат
// (пользователь, 2026-08-28). Свободной кнопку считаем по двум подряд
// спокойным замерам, чтобы не поймать миг между двумя пачками.
async function waitFree(alive, limitSec = 900) {
  const t0 = Date.now();
  let calm = 0, told = false;
  // Один раз пишем, что расширение видит на кнопке. Если промт всё-таки уходит
  // рано, по этой строке видно, распознаётся ли занятость вообще
  // (пользователь, 2026-08-28: «записывает промпт в чат, хотя ещё рано»).
  const p0 = await run(probe);
  say(p0 ? `   перед отправкой: иконка «${p0.icon || "нет"}», генерация ${p0.busy ? "идёт" : "не идёт"}`
         : "   перед отправкой: страницу прочитать не вышло");
  while (alive() && (Date.now() - t0) / 1000 < limitSec) {
    const p = await run(probe);
    // Смотрим ТОЛЬКО на генерацию. Серая кнопка тут ничего не значит: поле
    // ещё пустое, а Flow гасит отправку, пока в него не введён текст. Ждать
    // её здесь означало ждать вечно (пользователь, 2026-08-28).
    if (p && !p.busy) {
      if (++calm >= 2) {
        if (told) say(`   кнопка освободилась через ${Math.round((Date.now() - t0) / 1000)} с`);
        return true;
      }
    } else {
      calm = 0;
      if (!told) { say("   Flow ещё занят прошлой генерацией, жду"); told = true; }
    }
    await sleep(told ? 1500 : 600);
  }
  return false;
}

async function waitDone(alive, limitSec = 1500) {
  const t0 = Date.now();
  let started = false, seen = "";
  for (let i = 0; i < 25 && !started; i++) {
    const p = await run(probe);
    if (p && p.busy) { started = true; seen = p.icon; break; }
    await sleep(1200);
  }
  say(started ? `   генерация пошла (иконка «${seen}»)` : "   занятости кнопки не увидел, жду по сроку");

  let calm = 0, ticks = 0, last = null;
  while (alive() && (Date.now() - t0) / 1000 < limitSec) {
    const p = await run(probe);
    if (p && p.stall) { say("   Flow встал: " + (p.banner || "агент перегружен")); return p; }
    const icon = p ? p.icon : "нет кнопки";
    if (icon !== last) { say(`   иконка стала «${icon}»`); last = icon; }
    if (p && !p.busy) { calm++; if (calm >= 3) { say("   кнопка снова стрелка"); return p; } }
    else calm = 0;
    if (++ticks % 20 === 0) say(`   всё ещё жду, ${Math.round((Date.now() - t0) / 1000)} с`);
    await sleep(3000);
  }
  if (alive()) say("   срок ожидания вышел");
  return null;
}

// ── разбиение ────────────────────────────────────────────────────────────

// Блок между метками *---- это канон персонажей и список стилей.
// Он уходит в первое сообщение вместе с шапкой, чтобы Flow держал
// одних и тех же людей и одни и те же стили весь ролик.
function pullCanon(text) {
  const m = text.match(/\*----\s*\n([\s\S]*?)\n\s*\*----/);
  return m ? m[1].trim() : "";
}

// Сколько в куске картинок и сколько видео: для подробного статуса
function countChunk(chunk) {
  const blocks = chunk.split(/\n(?=\d+\.\d+sec)/).filter((b) => /Промт\s*:/i.test(b));
  const veo = blocks.filter((b) => /\[\s*VEO/i.test(b)).length;
  return { img: blocks.length - veo, veo };
}

function tally(job) {
  let iAll = 0, vAll = 0, iDone = 0, vDone = 0;
  (job.chunks || []).forEach((c, k) => {
    const { img, veo } = countChunk(c);
    iAll += img; vAll += veo;
    if (k < job.idx) { iDone += img; vDone += veo; }
  });
  // tcAll это все таймкоды файла, tcDone сколько из них уже позади
  const pos = job.pos || [], n = job.chunks ? job.chunks.length : 0;
  const tcAll = job.allTc || (iAll + vAll);
  let tcDone = 0;
  for (let k = 0; k < job.idx && k < pos.length; k++) tcDone = Math.max(tcDone, pos[k]);
  if (n && job.idx >= n) tcDone = tcAll;            // хвостовые окна диктора
  return { iAll, vAll, iDone, vDone, tcAll, tcDone: Math.min(tcDone, tcAll),
           bAll: job.bAll || 0, bDone: job.bDone || 0 };
}

// allTc и pos считаются, но в статус НЕ идут: счётчик показывает кадры
// с промтами (107), а не все таймкоды (130). Метаданные оставлены на случай,
// если снова понадобится прогресс по всей ленте.
let lastSplit = { allTc: 0, pos: [] };

// «Посчитать» знает, каких кадров на странице нет. Оставляем в тексте только их,
// чтобы «Продолжить» досылал недостачу, а не гонял всю раскадровку заново.
const normTc = (t) => {
  const m = (t || "").match(/^(\d+)\.(\d+)sec/);
  return m ? `${parseInt(m[1], 10)}.${m[2]}sec` : "";
};

function keepOnly(text, set) {
  const m = text.match(/^\d+\.\d+sec/m);
  if (!m) return text;
  const cut = text.indexOf(m[0]);
  const keep = text.slice(cut).split(/\n(?=\d+\.\d+sec)/)
    .filter((b) => set.has(normTc(b)));
  // Пусто значит таймкоды не совпали. Возвращать тут ВЕСЬ текст нельзя:
  // именно так досылка молча превращалась в повторную отправку всей раскадровки.
  return keep.length ? text.slice(0, cut) + keep.join("\n") : "";
}

// «6 картинок», но «2 картинки» и «21 картинка»: без этого приставка
// к пачке читается коряво (пользователь, 2026-08-20).
function plural(n, one, few, many) {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

function normalizeFlowBatchSize(value) {
  const per = Number(value);
  if (per > 0 && per <= 2) return 2;
  return [2, 5, 8, 10, 12].includes(per) ? per : 5;
}
function split(text, per, veoMode) {
  per = normalizeFlowBatchSize(per);
  const m = text.match(/^\d+\.\d+sec/m);
  if (!m) { lastSplit = { allTc: 1, pos: [0] }; return [text.trim()]; }
  const cut = text.indexOf(m[0]);
  // Преамбула раскадровки не отправляется: шапка строго одна, из HEAD.
  let all = text.slice(cut).split(/\n(?=\d+\.\d+sec)/);
  const allTc = all.length;
  const parts = [];
  all.forEach((b, n) => { if (/Промт\s*:/i.test(b)) parts.push({ b, n }); });  // окна диктора мимо
  const isVeo = (x) => /\[\s*VEO/i.test(x.b);
  const imgs = parts.filter((x) => !isVeo(x));
  const veos = parts.filter(isVeo);
  const out = [], pos = [], isVid = [];
  const push = (sl, v) => {
    out.push(sl.map((x) => x.b).join("\n").trim());
    pos.push(Math.max(...sl.map((x) => x.n)) + 1);
    isVid.push(!!v);
  };
  for (let i = 0; i < imgs.length; i += per) push(imgs.slice(i, i + per), false);
  // видео идут последними, но такими же пачками, как и картинки
  if (veoMode !== "skip")
    for (let i = 0; i < veos.length; i += per) push(veos.slice(i, i + per), true);
  lastSplit = { allTc, pos, isVid };
  return out;
}

// ── основной цикл ────────────────────────────────────────────────────────

async function loop() {
  const my = ++gen;
  // Поколение важно только если пришло НОВОЕ задание. Перезапуск воркера
  // обнуляет счётчик, и старая проверка убивала живой цикл на ровном месте.
  const alive = () => !!job && job.running && my >= gen;
  try {
    keepAlive(true);
    await attach(job.tabId);

    while (alive() && job.idx < job.chunks.length) {
      say(`→ кусок ${job.idx + 1} из ${job.chunks.length}`);

      // «Новый сеанс» не жмём НИКОГДА. Проект под ролик всегда свежий, чат в нём
      // и так пустой. Раньше это делала кнопка «Начать», и лишний сеанс появлялся
      // каждый раз, когда её жали вместо «Продолжить».

      const chunk = job.chunks[job.idx];
      const frames = (chunk.match(/^\d+\.\d+sec/gm) || []).length || 1;
      const m0 = await run(probe);
      if (m0 && m0.stall) {
        say("Flow встал: " + (m0.banner || "агент перегружен"));
        say("пачку не отправляю, останавливаюсь");
        say("нажмите «Повторить» в чате Flow, дождитесь ответа и жмите «Продолжить»");
        break;
      }
      const media0 = m0 ? m0.media : 0;
      const errs0 = m0 ? m0.errs : 0;
      let body = chunk;
      // Flow должен делать ВСЁ присланное разом, поэтому каждая пачка
      // подписывается этой строкой. Формулировки пользователя (2026-08-20):
      // у пачки видео своя, чтобы Flow не принял её за картинки.
      // В самом первом сообщении «продолжай» неуместно, там ещё нечего продолжать.
      // Про переименование напоминаем в каждой пачке: одной шапки Flow не помнит
      // (пользователь, 2026-08-20).
      // У видео-пачки своя добавка: клипы уходят последними, и без напоминания
      // veo рисует героев заново, не так, как они вышли на картинках
      // (пользователь, 2026-08-20).
      const vid = (job.isVid || [])[job.idx];
      const KEEP = " Если есть герои в видео промптах используй их точно такими же" +
                   " как использовал в кадрах ранее:";
      const GO = vid
        ? (frames === 1
            ? "сделай это ВИДЕО VEO 3.1 LITE и переименуй его." + KEEP
            : `сделай все эти ${frames} ВИДЕО VEO 3.1 LITE за раз и переименуй их.` + KEEP)
        : (frames === 1
            ? "сделай эту картинку и переименуй её:"
            : `сделай все эти ${frames} ${plural(frames, "картинку", "картинки", "картинок")} за раз и переименуй их:`);
      const GO_MORE = "продолжай, " + GO;
      if (job.head && job.idx === 0) {
        body = HEAD + "\n" + GO + "\n\n" +
               (job.canon ? job.canon + "\n\n" : "") + chunk;
      } else {
        // КАЖДАЯ следующая пачка идёт с этой приставкой и своими промтами
        // Repeat canon once on the first successfully sent batch after resume.
        body = GO_MORE + "\n\n" +
               (job.canonPending && job.canon ? job.canon + "\n\n" : "") + chunk;
      }

      if (!await waitFree(alive)) {
        say("кнопка отправки так и не освободилась, останавливаюсь");
        break;
      }
      if (!await putText(body)) break;
      if (!await send()) { say("отправить не удалось, останавливаюсь"); break; }
      job.canonPending = false;
      // Кусок ушёл в чат: «Продолжить» должен взять следующий.
      // Счётчик должен двигаться в момент ОТПРАВКИ, а не когда пачка
      // догенерировалась: иначе цифра стоит на месте минутами, хотя промты
      // уже ушли (пользователь, 2026-08-28).
      job.sent = job.idx + 1;
      // Кроме номера пачки запоминаем таймкод последнего отправленного кадра:
      // номер врёт, если список пачек пересобрался (пользователь, 2026-08-28).
      // Досылка якорь НЕ трогает: её кадры разбросаны, и таймкод последнего
      // из них не значит «всё до него отправлено».
      const _tcs = chunk.match(/^\d+\.\d+sec/gm) || [];
      const _st = { flowIdx: job.idx + 1, flowTally: tally({ ...job, idx: job.idx + 1 }) };
      if (!job.resend && _tcs.length) _st.flowLastTc = _tcs[_tcs.length - 1];
      // Досылка вместо якоря копит СПИСОК отправленных таймкодов: «Продолжить»
      // дошлёт остаток того же списка недостачи, без пересчёта
      // (пользователь, 2026-08-28).
      if (job.resend && _tcs.length) {
        for (const t of _tcs) job.sentTcs.push(normTc(t));
        _st.flowResendSent = job.sentTcs;
      }
      chrome.storage.local.set(_st);
      say("   отправлено, жду генерацию");

      const p = await waitDone(alive);
      if (!p) { say("ждал слишком долго, останавливаюсь"); break; }
      if (p.stall) {
        say("дальше не иду. Кусок " + (job.idx + 1) + " ушёл, но кадры по нему могли не сделаться");
        say("нажмите «Повторить» в чате Flow, дождитесь ответа и жмите «Продолжить»");
        job.idx++;
        chrome.storage.local.set({ flowIdx: job.idx });
        break;
      }

      // Догонять недостачу словом «продолжай» расширение больше не пробует
      // (пользователь, 2026-08-18: «просто продолжай это не надо вообще»).
      // Если Flow сделал не все картинки пачки, это видно по «Посчитать»,
      // и недостача досылается кнопкой ▶ вместе с промтами.
      if (!job.preview) {
        const q = await run(probe);
        const made = q ? Math.max(0, q.media - media0) : 0;
        const bad = q ? Math.max(0, q.errs - errs0) : 0;
        // Одиночные плитки «Что-то пошло не так» это обычный брак генерации,
        // его велено пропускать. Останавливает только баннер (см. probe).
        say(made >= frames ? `   кусок закрыт, картинок ${made} из ${frames}`
                           : `   сделано ${made} из ${frames}, ошибок ${bad}`);
      }

      job.idx++;

      // Полуручной режим для видео ВСЕГДА включён, отключить его нельзя:
      // пачка ушла, генерация закрыта — встаём на паузу.
      // Видео тратят кредиты, пользователь хочет решать по каждой пачке отдельно.
      // «Продолжить» возьмёт следующую и снова остановится.
      if (job.veoPause && (job.isVid || [])[job.idx - 1]) {
        const left = (job.isVid || []).slice(job.idx).filter(Boolean).length;
        say(left ? `видео-пачка отправлена, пауза. Осталось видео-пачек: ${left}. Жму «Продолжить» когда скажете`
                 : "последняя видео-пачка отправлена");
        break;
      }
      await sleep(2000);
    }
    if (my === gen) say(job.idx >= job.chunks.length ? "всё отправлено" : "остановлено");
  } catch (e) {
    say("сбой: " + String(e.message || e));
  } finally {
    if (my === gen) {
      job.running = false;
      keepAlive(false);
      chrome.storage.local.set({ flowRunning: false });
      await detach();
    }
  }
}

// ── автозапуск из Finder ─────────────────────────────────────────────────
// Быстрое действие кладёт раскадровку в job.txt рядом с расширением,
// первой строкой «#метка|кадров за раз». Своё вложение расширение читать
// умеет, сервер и порты не нужны.

async function readJob() {
  try {
    const r = await fetch(chrome.runtime.getURL("job.txt") + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    const raw = await r.text();
    if (!raw || raw.trim().length < 40) return null;
    const m = raw.match(/^#(\d+)(?:\|(\w+))?\s*\n/);
    const tag = m && m[2] ? m[2] : "";
    return {
      id: m ? m[1] : String(raw.length),
      per: /^\d+$/.test(tag) ? parseInt(tag, 10) : 0,
      mode: /^preview$/i.test(tag) ? "preview" : "frames",
      text: raw.replace(/^#\d+(?:\|\w+)?\s*\n/, ""),
    };
  } catch (e) { return null; }
}

// Задание живёт две минуты после правого клика. Иначе при каждой
// перезагрузке расширения запускался бы старый файл, лежащий на диске.
const СВЕЖЕСТЬ = 120;

const ВЕРСИЯ = "v8.1 переезд на flow.google.com";

async function autoRun(j) {
  const st = await chrome.storage.local.get(["lastJob", "flowPer", "flowVeo", "lastProject"]);
  if (st.lastJob === j.id) return;                 // это задание уже брали

  const age = Math.round(Date.now() / 1000) - parseInt(j.id, 10);
  if (!isFinite(age) || age > СВЕЖЕСТЬ) {
    await chrome.storage.local.set({ lastJob: j.id });   // помечаем и молчим
    return;
  }
  await chrome.storage.local.set({ lastJob: j.id });

  // Задание заводим ДО всякой работы: say() при пустом job молча выходит,
  // и тогда в логе не видно ни версии, ни причины остановки.
  job = { tabId: null, chunks: [], idx: 0, running: true, head: true, newSession: false, log: [] };
  const ownedJob = job;
  try {
  say("расширение " + ВЕРСИЯ);

  // Вкладку всегда открываем свою и работаем только в ней.
  // Flow переехал: с сентября 2026 адрес flow.google.com, старый labs.google
  // только перебрасывает. Открываем сразу новый, иначе вкладка меняет адрес
  // на лету и проверки по URL ниже ловят промежуточное состояние.
  const tab = await chrome.tabs.create({ url: "https://flow.google.com/", active: false });
  job.tabId = tab.id;
  if (job.cancelled) return;
  await attach(tab.id);
  const pid = (u) => (String(u).match(/project\/([0-9a-f-]{8})/) || [, "?"])[1];
  say("открыл новую вкладку");

  for (let i = 0; i < 40; i++) {
    const current = await toTabGetQuiet(tab.id);
    if (!current) { say("вкладка Flow закрыта, останавливаюсь"); job.running = false; return; }
    if (current.status === "complete") break;
    await sleep(500);
  }
  await sleep(1500);

  // НОВЫЙ ПРОЕКТ создаём всегда, и для кадров, и для превью.
  // А вот «Новый сеанс» не жмём НИКОГДА: это разные вещи, и сеанс в свежем
  // проекте уже есть. Клик по нему убран из всех путей.
  const initial = await toTabGetQuiet(tab.id);
  if (!initial) { say("вкладка Flow закрыта, останавливаюсь"); job.running = false; return; }
  const before = initial.url || "";
  const tabsBefore = new Set((await chrome.tabs.query({})).map((t) => t.id));
  for (let i = 0; i < 30; i++) {
    const r = await run(clickCreateProject);
    if (r && r.ok) { say(`нажал «${r.t}»`); break; }
    if (i === 10 && r) say("кнопки проекта не видно, что есть: " + JSON.stringify(r.seen));
    await sleep(1000);
  }

  // Плитка «Создать проект» иногда открывает проект в ОТДЕЛЬНОЙ вкладке.
  // Тогда у нас на руках две: пустая наша и новая с проектом. Забираем ту,
  // где проект, а лишнюю закрываем. Работать должны ровно в одной.
  let url = before;
  for (let i = 0; i < 25; i++) {
    const current = await toTabGetQuiet(job.tabId);
    if (!current) { say("вкладка Flow закрыта, останавливаюсь"); job.running = false; return; }
    url = current.url || "";
    if (/\/project\//.test(url) && url !== before) break;

    const extra = (await chrome.tabs.query({}))
      .find((t) => !tabsBefore.has(t.id) && /(labs\.google\/fx\/.*|flow\.google\.com)\/project\//.test(t.url || ""));
    if (extra) {
      const old = job.tabId;
      job.tabId = extra.id;
      url = extra.url;
      say("Flow открыл проект в новой вкладке, забираю её, лишнюю закрываю");
      await detach();
      await toTabRemoveQuiet(old);
      if (!await toTabGetQuiet(job.tabId)) {
        say("вкладка проекта закрыта, останавливаюсь"); job.running = false; return;
      }
      await attach(job.tabId);
      break;
    }
    await sleep(600);
  }
  if (!/\/project\//.test(url)) { say("новый проект не открылся, останавливаюсь"); job.running = false; return; }
  say("проект " + pid(url) + ", сеанс в нём не создаю");
  await chrome.storage.local.set({ lastProject: url });

  if (!await waitEditor(30)) { say("панель чата не открылась, останавливаюсь"); job.running = false; return; }

  // Свежему проекту нужно время устояться: Flow ещё дорисовывает панель и
  // заводит сеанс. Если слать промт сразу, интерфейс дёргается.
  say("проект открыт, жду 3 секунды перед отправкой");
  await sleep(3000);

  // текст в поле попапа: оттуда его берёт «Продолжить», и видно что в работе
  await chrome.storage.local.set({ flowText: j.text });

  if (j.mode === "preview") {
    job.chunks = [j.text.trim()];
    job.head = false;            // никакой добавочной шапки
    job.canon = "";              // и канон не подмешиваем
    job.preview = true;          // и не дожимаем «продолжай»
    say("режим превью: файл уходит целиком, одним сообщением");
  } else {
    const per = normalizeFlowBatchSize(j.per || st.flowPer);
    await chrome.storage.local.set({ flowPer: String(per) });
    job.canon = pullCanon(j.text);
    job.per = per;                       // пригодится для догоняющего «продолжай»
    job.chunks = split(j.text, per, st.flowVeo || "last");
    job.allTc = lastSplit.allTc; job.pos = lastSplit.pos; job.isVid = lastSplit.isVid;
    job.veoPause = (st.flowVeo || "pause") !== "skip";
    say(job.canon
      ? `канон и стили найдены (${job.canon.split("\n").length} строк), уйдут в первое сообщение`
      : "канон между метками *---- не найден, шапка уйдёт без него");
    const t = tally(job);
    say(`кадров за раз ${per}: ${t.iAll} картинок и ${t.vAll} видео, ${job.chunks.length} сообщений`);
  }
  await loop();
  } catch (e) {
    if (job === ownedJob) say("сбой: " + String(e.message || e));
  } finally {
    if (job === ownedJob) {
      job.running = false;
      await detach();
      await chrome.storage.local.set({ flowRunning: false });
    }
  }
}

async function pollJob() {
  if (starting || (job && job.running)) return;    // одно задание за раз
  const j = await readJob();
  if (!j) return;
  starting = true;
  try { await autoRun(j); } finally { starting = false; }
}

// На старте воркера (в том числе после перезагрузки расширения) помечаем
// лежащее задание взятым, чтобы ничего не запустилось само.
(async () => {
  const j = await readJob();
  if (j) await chrome.storage.local.set({ lastJob: j.id });
})();

chrome.alarms.create("jobTick", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "jobTick") pollJob();
  if (a.name === "flowTick" && job && job.running) chrome.storage.local.set({ flowBeat: Date.now() });
});
setInterval(pollJob, 4000);

// ── связь с попапом ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg.cmd === "ping") reply({ ok: true });

    if (msg.cmd === "flowStart") {
      // only приходит после «Посчитать»: гоним только недостающие кадры,
      // а счётчик ведём по всему ролику, чтобы цифра не падала обратно к нулю
      const only = Array.isArray(msg.only) && msg.only.length
        ? new Set(msg.only.map(normTc)) : null;
      const src = only ? keepOnly(msg.text, only) : msg.text;
      if (only && !src) {
        reply({ ok: false, err: `ни один из ${only.size} кадров не найден в раскадровке` });
        return;
      }
      const per = normalizeFlowBatchSize(msg.per);
      const chunks = split(src, per, msg.veo || "last");
      // сколько кадров реально уйдёт: попап сверит это число со своим списком
      const frames = chunks.reduce((n, c) => n + (c.match(/^\d+\.\d+sec/gm) || []).length, 0);
      const meta = { allTc: lastSplit.allTc, pos: lastSplit.pos, isVid: lastSplit.isVid };
      let from = Math.min(Math.max(0, msg.fromIdx | 0), Math.max(0, chunks.length - 1));
      // Номер пачки значит что-то только внутри ТОГО ЖЕ разбиения. Если между
      // прогонами менялся размер пачки или досылался урезанный список, номер
      // указывает не туда, и счётчик прыгает назад, а кадры идут по второму
      // кругу (пользователь, 2026-08-28: было 290 из 332, стало 150).
      // Поэтому ищем пачку по таймкоду последнего отправленного кадра.
      if (!only && msg.fromTc) {
        const want = normTc(msg.fromTc);
        const k = chunks.findIndex((c) =>
          (c.match(/^\d+\.\d+sec/gm) || []).some((t) => normTc(t) === want));
        if (k >= 0) {
          const byTc = Math.min(k + 1, chunks.length - 1);
          // Таймкод найден, значит он и есть точная позиция. Брать вместо него
          // дальнюю из двух оценок нельзя: номер пачки из прошлого разбиения
          // при увеличении размера пачки упирается в конец списка, и подача
          // перепрыгивала в самый хвост, отправляла последний кадр и рапортовала
          // «всё отправлено» (пользователь, 2026-08-28).
          if (byTc !== from) say(`позиция: по номеру пачки ${from + 1}, по таймкоду ${byTc + 1}, беру по таймкоду`);
          from = byTc;
        }
      }
      job = { tabId: msg.tabId, chunks, idx: from, running: true,
              resend: !!only,
              sentTcs: Array.isArray(msg.sentBase) ? msg.sentBase.slice() : [],
              per,
              head: msg.head !== false, newSession: false,
              canon: pullCanon(msg.text), canonPending: true, log: [], veoPause: msg.veo !== "skip",
              sent: from,
              bAll: (msg.base && msg.base.all) | 0, bDone: (msg.base && msg.base.done) | 0,
              ...meta };
      if (only) say(`досылаю недостающие кадры: ${only.size}`);
      say(`разбито на ${chunks.length} кусков по ${per} кадров, видео ` +
          (msg.veo === "skip" ? "пропускаю" : "в конце, с паузой после каждой пачки"));
      if (!job.head) say(`продолжаю с куска ${from + 1}, канон повторю в следующей пачке`);
      chrome.storage.local.set({ flowIdx: from });
      loop();
      reply({ ok: true, total: chunks.length, frames, only: !!only });
    }

    if (msg.cmd === "flowCount") {
      const saved = job;
      job = { tabId: msg.tabId, chunks: [], idx: 0, running: false, log: [] };
      let res;
      try {
        const r = await run(collectDone);
        const done = new Set((r && r.done) || []);
        const imgs = [], veos = [];
        const text = msg.text || "";
        const first = text.match(/^\d+\.\d+sec/m);
        if (first) {
          for (const b of text.slice(text.indexOf(first[0])).split(/\n(?=\d+\.\d+sec)/)) {
            if (!/Промт\s*:/i.test(b)) continue;            // окна диктора мимо
            const m = b.match(/^(\d+)\.(\d+)sec/);
            if (!m) continue;
            (/\[\s*VEO/i.test(b) ? veos : imgs).push(`${parseInt(m[1], 10)}.${m[2]}sec`);
          }
        }
        const missImg = imgs.filter((x) => !done.has(x));
        const missVeo = veos.filter((x) => !done.has(x));
        res = {
          ok: true,
          imgAll: imgs.length, imgDone: imgs.length - missImg.length, missImg,
          veoAll: veos.length, veoDone: veos.length - missVeo.length, missVeo,
          total: imgs.length + veos.length,
          made: imgs.length + veos.length - missImg.length - missVeo.length,
          missing: missImg.concat(missVeo),
          found: done.size, grid: !!(r && r.grid), sample: (r && r.sample) || [],
        };
      } catch (e) { res = { ok: false, err: String(e.message || e) }; }
      if (!saved || !saved.running) await detach();
      job = saved;
      reply(res);
    }
    if (msg.cmd === "flowDownload") {
      const saved = job;
      job = { tabId: msg.tabId, chunks: [], idx: 0, running: false, log: [] };
      let res;
      try {
        await attach(msg.tabId);
        const kb = await run(findKebab);
        if (!kb || !kb.ok) {
          res = { ok: false, err: "меню с тремя точками не найдено", seen: (kb && kb.seen) || [] };
        } else {
          await mouseClick(kb.x, kb.y);
          await sleep(900);
          const it = await run(findDownloadItem);
          if (!it || !it.ok) {
            res = { ok: false, err: "пункт «Скачать проект» не найден", seen: (it && it.seen) || [] };
          } else {
            await mouseClick(it.x, it.y);
            await sleep(1200);
            res = { ok: true, t: it.t };
          }
        }
      } catch (e) { res = { ok: false, err: String(e.message || e) }; }
      await detach();
      job = saved;
      reply(res);
    }
    if (msg.cmd === "flowStop") { gen++; if (job) { job.running = false; job.cancelled = true; } keepAlive(false); await detach(); reply({ ok: true }); }

    // «Очистить» помечает лежащее в job.txt задание как взятое, иначе
    // расширение тут же подхватит его снова и начнёт заново.
    if (msg.cmd === "flowConsume") {
      const j = await readJob();
      if (j) await chrome.storage.local.set({ lastJob: j.id });
      reply({ ok: true, id: j ? j.id : null });
    }

    if (msg.cmd === "flowState") {
      if (job) {
        reply({ running: job.running, idx: job.idx, total: job.chunks.length, log: job.log,
                isVid: job.isVid || [], veoPause: !!job.veoPause,
                ...tally({ ...job, idx: sentIdx(job) }) });
        return;
      }
      const st = await chrome.storage.local.get(["flowLog", "flowIdx", "flowTotal", "flowRunning", "flowTally"]);
      reply({ running: false, idx: st.flowIdx || 0, total: st.flowTotal || 0, ...(st.flowTally || {}),
              log: (st.flowLog || []).concat(st.flowRunning ? ["— воркер был выгружен Chrome, жмите «Продолжить» —"] : []) });
    }
  })();
  return true;
});


// ── значок фильтра YouTube ───────────────────────────────────────────────
// Жёлтая воронка горит ТОЛЬКО на вкладке YouTube и только при включённом
// фильтре. Пользователь 2026-08-21: «пусть он на ютуб странице лишь горит»
// и «пусть горит, даже если не нажимаю на него».
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ, оно записано выше в блоке про бейдж: при СТАРТЕ воркера
// кнопку трогать нельзя, клик по ней воркер и будит, и правка в этот момент
// съедает открытие панели. Поэтому здесь НЕТ ни paintAll на старте, ни
// onStartup, ни onInstalled. Значок меняется только на событиях вкладок,
// которые кликом не вызываются.
//
// И пока идёт подача, кнопка принадлежит анимации стрелки: туда не лезем.
const ICON_ON = { 16: "icons/filter16.png", 32: "icons/filter32.png",
                  48: "icons/filter48.png", 128: "icons/filter128.png" };
const ICON_OFF = { 16: "icons/multibot-list-16.png", 32: "icons/multibot-list-32.png",
                   48: "icons/multibot-list-48.png", 128: "icons/multibot-list-128.png" };
const isYT = (u) => /^https?:\/\/(www\.)?youtube\.com\//.test(u || "");

async function paintTab(tab) {
  if (!tab || tab.id == null) return;
  if (job && job.running) return;                 // идёт подача, значок не наш
  let on = false;
  try {
    const r = await chrome.storage.local.get(["ytfOn"]);
    on = !!(r || {}).ytfOn && isYT(tab.url);
  } catch (e) {}
  try { await chrome.action.setIcon({ tabId: tab.id, path: on ? ICON_ON : ICON_OFF }); } catch (e) {}
  try {
    await chrome.action.setTitle({ tabId: tab.id,
      title: on ? "Фильтр YouTube включён" : "Multi Bot" });
  } catch (e) {}
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  paintTab(await toTabGetQuiet(tabId));
});
chrome.tabs.onUpdated.addListener((id, ch, tab) => {
  if (ch.status === "complete" || ch.url) paintTab(tab);
});
// Переключили галочку — перекрашиваем открытые вкладки YouTube, чтобы
// не ждать, пока пользователь на них переключится.
chrome.storage.onChanged.addListener(async (ch) => {
  if (!ch.ytfOn) return;
  try { for (const t of await chrome.tabs.query({ url: "*://*.youtube.com/*" })) paintTab(t); } catch (e) {}
});

// Тихие обёртки над chrome.tabs: вкладка может закрыться между нашими
// обращениями, а Chrome печатает «Unchecked runtime.lastError», даже
// когда промис пойман. Гасится только чтением lastError в колбэке.
function toTabGetQuiet(id) {
  return new Promise((resolve) => {
    chrome.tabs.get(id, (tab) => {
      const error = chrome.runtime.lastError;
      resolve(error ? null : (tab || null));
    });
  });
}
function toTabRemoveQuiet(id) {
  return new Promise((resolve) => {
    chrome.tabs.remove(id, () => {
      const error = chrome.runtime.lastError;
      resolve(!error);
    });
  });
}
