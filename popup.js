// ── Видео ────────────────────────────────────────────────────────────────

// Runs inside the HeyGen page to locate the real video file.
// Picks the <video> with an .mp4 source and the longest duration
// (that's the full avatar render, not a thumbnail/preview).
function findVideoInPage() {
  const vids = [...document.querySelectorAll("video")]
    .map((v) => ({ src: v.currentSrc || v.src, dur: v.duration || 0 }))
    .filter((o) => o.src && /\.mp4/i.test(o.src));
  if (!vids.length) return null;
  vids.sort((a, b) => b.dur - a.dur);
  return vids[0];
}

// Озвучка сцены лежит в <audio> уже при открытии редактора — по сети
// эти файлы не запрашиваются, пока не нажмёшь play. Порядок элементов в DOM
// совпадает с порядком реплик: сумма их длительностей равна длине сцены.
function findAudioInPage() {
  return [...document.querySelectorAll("audio")]
    .map((a) => ({ src: a.currentSrc || a.src, dur: a.duration || 0 }))
    .filter((o) => o.src && !o.src.startsWith("blob:"));
}

const infoEl = document.getElementById("info");
const btn = document.getElementById("dl");

// Состояние видео пишем прямо в кнопку, отдельной строки статуса больше нет:
// панель короче на целую строку (пользователь, 2026-08-23). Значок показываем
// только когда качать есть что, иначе стрелка вниз рядом с «не найдено» врёт.
const DL_ICON =
  '<svg class="ic" viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
  'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M4 20h16"/></svg>';
function dlSay(text, ready) {
  btn.innerHTML = (ready ? DL_ICON : "") + text;
  btn.disabled = !ready;
}

// Состояние аудио пишем прямо в кнопку, как и у видео: панель короче ещё
// на строку (пользователь, 2026-08-23). Значок показываем только когда
// качать есть что.
// Динамик перед строкой с длительностью: сразу видно, что речь про звук.
const SPK_ICON =
  '<svg class="ic spk" viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
  'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9.5a4 4 0 0 1 0 5"/>' +
  '<path d="M19.5 7a7.5 7.5 0 0 1 0 10"/></svg>';

function audSay(text, ready) {
  audioBtn.innerHTML = (ready ? DL_ICON : "") + text;
  audioBtn.disabled = !ready;
}
const audioInfoEl = document.getElementById("audioInfo");
const audioBtn = document.getElementById("dlAudio");
const refreshBtn = document.getElementById("refreshAudio");

let videoSrc = null;
let audioUrls = [];
let currentTab = null;

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = `status ${cls}`;
  el.hidden = false;              // любое настоящее сообщение показывает строку
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // На странице HeyGen блок раскрыт, на всех прочих свёрнут
  // Раскрыт тот блок, который нужен на этой странице. Пользователь 2026-08-21:
  // «когда я на ютубе, вкладку фильтра держать раскрытой, по аналогии
  // с другими вкладками расширения».
  const onHeyGen = !!(tab && /heygen\.(com|ai)/.test(tab.url || ""));
  const onYT = !!(tab && /(^|\.)youtube\.com/.test(new URL(tab.url || "https://x/").hostname));
  const box = document.getElementById("heygenBox");
  if (box) box.open = onHeyGen;
  const ybox = document.getElementById("ytfBox");
  if (ybox) ybox.open = onYT;
  // Flow раскрываем ТОЛЬКО на его собственной вкладке. Раньше он открывался
  // везде, где нет HeyGen и Ютуба, то есть на любой посторонней странице
  // панель встречала раскрытым блоком. Если вкладка чужая, свёрнуты все три
  // (пользователь, 2026-08-23).
  const onFlow = !!(tab && /labs\.google\/fx\/.*\/tools\/flow\/|flow\.google\.com\//.test(tab.url || ""));
  const fbox = document.getElementById("flowBox");
  // Идёт подача — Flow раскрыт всегда, даже на посторонней вкладке.
  if (fbox) fbox.open = onFlow || runFast();

  if (!onHeyGen) {
    dlSay("Откройте проект HeyGen", false);
    audSay("Откройте HeyGen", false);
    refreshBtn.disabled = true;
    return;
  }

  await initVideo(tab);
  await initAudio(tab);
}

async function initVideo(tab) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findVideoInPage,
    });
  } catch (e) {
    dlSay("Нет доступа к странице", false);
    infoEl.textContent = String(e.message || e);
    return;
  }

  const v = results && results[0] && results[0].result;
  if (!v || !v.src) {
    dlSay("Видео не найдено", false);
    infoEl.textContent = "Откройте сцену и подождите, пока прогрузится плеер.";
    return;
  }

  videoSrc = v.src;
  dlSay("Скачать видео", true);
  if (v.dur && isFinite(v.dur)) {
    const m = Math.floor(v.dur / 60);
    const s = String(Math.round(v.dur % 60)).padStart(2, "0");
    infoEl.textContent = `Длительность: ${m}:${s}`;
  } else {
    infoEl.textContent = "";
  }
}

btn.addEventListener("click", () => {
  if (!videoSrc) return;
  chrome.downloads.download(
    { url: videoSrc, filename: `heygen_${stamp()}.mp4` },
    () => {
      if (chrome.runtime.lastError) {
        dlSay("Ошибка скачивания", false);
        infoEl.textContent = chrome.runtime.lastError.message;
      } else {
        dlSay("Скачивание началось ✓", false);
      }
    }
  );
});

// ── Аудио ────────────────────────────────────────────────────────────────

function fileNameOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop()) || url;
  } catch {
    return url;
  }
}

async function initAudio(tab) {
  audioBtn.disabled = true;
  audSay("Ищу аудио…", false);
  audioInfoEl.textContent = "";

  let found = [];
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findAudioInPage,
    });
    found = (r && r[0] && r[0].result) || [];
  } catch (e) {
    audSay("Нет доступа", false);
    audioInfoEl.textContent = String(e.message || e);
    return;
  }

  audioUrls = found.map((o) => o.src);

  if (!audioUrls.length) {
    audSay("Аудио не найдено", false);
    audioInfoEl.textContent =
      "Откройте сцену и дождитесь загрузки редактора, потом нажмите «Обновить».";
    return;
  }

  const total = found.reduce((s, o) => s + o.dur, 0);
  audSay("Аудио", true);
  audioInfoEl.innerHTML = SPK_ICON + (total
    ? `Суммарно ${fmtDur(total)}: сверьте с длиной сцены.`
    : "Склеятся в порядке реплик, в один WAV.");
  // Список файлов с их id не выводим: он длинный, занимает пол-панели
  // и ничего не даёт (пользователь, 2026-08-23). Хватает счётчика и
  // суммарной длительности выше.
}

refreshBtn.addEventListener("click", () => {
  if (currentTab) initAudio(currentTab);
});

// Скачивает и декодирует один файл. Возвращает null, если формат не читается —
// один битый источник не должен ронять всю склейку.
async function loadBuffer(ctx, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return await ctx.decodeAudioData(bytes);
  } catch {
    return null;
  }
}

// Склеивает буферы встык. OfflineAudioContext сам пересчитает частоту
// дискретизации, если файлы записаны по-разному.
async function mergeBuffers(buffers) {
  const rate = Math.max(...buffers.map((b) => b.sampleRate));
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const totalSec = buffers.reduce((sum, b) => sum + b.duration, 0);
  const frames = Math.ceil(totalSec * rate);

  const ctx = new OfflineAudioContext(channels, frames, rate);
  let offset = 0;
  for (const buf of buffers) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(offset);
    offset += buf.duration;
  }
  return ctx.startRendering();
}

// AudioBuffer → WAV (16-бит PCM).
function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;

  const out = new DataView(new ArrayBuffer(44 + dataSize));
  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) out.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, "RIFF");
  out.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  out.setUint32(16, 16, true); // размер fmt-блока
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * blockAlign, true);
  out.setUint16(32, blockAlign, true);
  out.setUint16(34, 8 * bytesPerSample, true);
  ascii(36, "data");
  out.setUint32(40, dataSize, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let pos = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

audioBtn.addEventListener("click", async () => {
  if (!audioUrls.length) return;

  audioBtn.disabled = true;
  refreshBtn.disabled = true;
  const ctx = new AudioContext();

  try {
    const buffers = [];
    let failed = 0;

    for (let i = 0; i < audioUrls.length; i++) {
      audSay(`Скачиваю ${i + 1}/${audioUrls.length}…`, false);
      const buf = await loadBuffer(ctx, audioUrls[i]);
      if (buf) buffers.push(buf);
      else failed++;
    }

    if (!buffers.length) {
      audSay("Ничего не прочиталось", false);
      audioInfoEl.textContent = "Файлы недоступны или в неподдерживаемом формате.";
      return;
    }

    audSay("Склеиваю…", false);
    const merged = await mergeBuffers(buffers);
    const blob = encodeWav(merged);
    const url = URL.createObjectURL(blob);

    await new Promise((resolve) => {
      chrome.downloads.download(
        { url, filename: `heygen_audio_${stamp()}.wav` },
        () => resolve()
      );
    });

    audSay("✅ Готово", false);
    audioInfoEl.textContent =
      `Склеено ${buffers.length} шт., ${fmtDur(merged.duration)}` +
      (failed ? ` · пропущено: ${failed}` : "");

    // Даём Chrome дочитать blob перед освобождением.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    audSay("Ошибка склейки", false);
    audioInfoEl.textContent = String(e.message || e);
  } finally {
    ctx.close();
    refreshBtn.disabled = false;
    audioBtn.disabled = false;
  }
});

init();

// ── Flow автоподача ──────────────────────────────────────────────────────
// Цикл живёт в service worker (flow.js), попап только пульт и лог.

const flowStatusEl = document.getElementById("flowStatus");
const flowTextEl = document.getElementById("flowText");
function normalizeFlowPer(value) {
  const per = Number(value);
  if (per > 0 && per <= 2) return "2";
  return [2, 5, 8, 10, 12].includes(per) ? String(per) : "5";
}
const flowPerEl = document.getElementById("flowPer");
const flowVeoEl = document.getElementById("flowVeo");
const flowClearBtn = document.getElementById("flowClear");
const flowCountBtn = document.getElementById("flowCount");
// Всё, что раньше падало отдельным блоком под плитками, уходит в раскрывающийся
// лог (пользователь, 2026-08-18): список недостающих кадров длинный и раздувал панель.
function toLog(text) {
  flowLogEl.textContent += (flowLogEl.textContent ? "\n" : "") + text;
  flowLogEl.scrollTop = 1e9;
}
const tally = document.getElementById("tally");
let missing = [], missImg = [], missVeo = [];
const flowStartBtn = document.getElementById("flowStart");
const flowResumeBtn = document.getElementById("flowResume");
const flowStopBtn = document.getElementById("flowStop");
// Строки «Кадров за раз» и «Veo 3.1 lite»: прячем их целиком, когда настраивать
// уже нечего (пользователь 2026-08-20: «это тоже скрыть, если все кадры готовы»)
const perRows = [flowPerEl, flowVeoEl].map((e) => e && e.closest(".per")).filter(Boolean);

// «Продолжить» и «Стоп» бесполезны, пока по ним нечего нажимать: при открытии
// расширения они всегда серые и просто занимают строку. Пользователь
// 2026-08-20: «при открытии кнопки продолж и стоп лучше сделать хайд, так как
// они и так не рабочие». Прячем их ровно тогда, когда они недоступны.
// Верхняя строка это статус плюс 🔍. У ПУСТОГО расширения показывать там
// нечего, поэтому она прячется целиком. Как только в поле появилась
// раскадровка, строка возвращается вместе с сообщением про вкладку.
// Пользователь 2026-08-20: «я просил убрать „Этот проект“ лишь когда запускаю
// пустое расширение, а не насовсем».
let tabMsg = null;                       // {text, cls} про текущую вкладку Flow

function refreshTopRow() {
  const has = !!flowTextEl.value.trim();
  // Пустое поле значит, что подавать нечего: прячем и статус, и 🔍, и «Начать»
  // (2026-08-20: «кнопку начать тоже скрой, когда жму очистить»).
  if (!has) {
    flowStatusEl.hidden = true;
    flowCountBtn.hidden = true;
    flowStartBtn.hidden = true;
    return;
  }
  // Пустую строку заполняем состоянием вкладки. Условие именно на ПУСТОТУ,
  // а не на hidden: иначе после «Очистить» возвращался старый текст
  // «Отправлено кадров 114 из 114» (пользователь, 2026-08-23). Живой прогресс
  // при этом не перебивается, у него строка не пустая.
  if (tabMsg && !flowStatusEl.textContent.trim())
    setStatus(flowStatusEl, tabMsg.text, tabMsg.cls);
  flowStatusEl.hidden = !flowStatusEl.textContent.trim();
  flowCountBtn.disabled = !flowTab;
  flowCountBtn.hidden = false;
  // Текст есть: «Начать» возвращается, если в проекте ещё нет готовых кадров
  flowStartBtn.hidden = counted ? counted.made > 0 : savedIdx > 0;
}

function syncHidden() {
  flowResumeBtn.hidden = flowResumeBtn.disabled;
  flowStopBtn.hidden = flowStopBtn.disabled;
  refreshTopRow();
}
const flowSpinEl = document.getElementById("flowSpin");
const heygenBoxEl = document.getElementById("heygenBox");
const heygenHrEl = document.getElementById("heygenHr");

// Идёт подача — в панели остаётся только Flow (пользователь, 2026-08-20)
function heygenShown(on) {
  if (heygenBoxEl) heygenBoxEl.hidden = !on;
  if (heygenHrEl) heygenHrEl.hidden = !on;
  // YouTube менеджер прячем вместе с HeyGen: пока идёт подача, в панели
  // остаётся один Flow (пользователь, 2026-08-28)
  const yb = document.getElementById("ytfBox"), yh = document.getElementById("ytfHr");
  if (yb) yb.hidden = !on;
  if (yh) yh.hidden = !on;
}
// Состояние прошлого открытия известно синхронно, поэтому первый же кадр
// панели рисуется правильно. Опрос воркера придёт через десяток миллисекунд
// и поправит, если что-то изменилось (пользователь, 2026-08-28: «мигает,
// сначала пустое, потом появляется»).
// Объявлена функцией, а не стрелкой: её зовёт init(), который стоит выше по файлу.
function runFast() {
  try { return localStorage.getItem("flowRunFast") === "1"; } catch (e) { return false; }
}
heygenShown(!runFast());
// Пока идёт подача, блок Flow раскрыт на любой вкладке: за ним следят,
// а не за той страницей, где сейчас находишься (пользователь, 2026-08-28).
if (runFast()) { const fb = document.getElementById("flowBox"); if (fb) fb.open = true; }

const flowLogEl = document.getElementById("flowLog");
const flowBarEl = document.getElementById("flowBar");
const flowBarFill = flowBarEl ? flowBarEl.querySelector("i") : null;

let flowTab = null;
let flowTimer = null;
let savedIdx = 0;
let savedTc = "";        // таймкод последнего отправленного кадра
let activeResend = null; // текущий список досылки: «Продолжить» держится его
let resendSent = [];     // таймкоды из этого списка, уже ушедшие в чат
// Итог последнего «Посчитать»: сколько кадров ролика уже стоит в проекте
// и каких не хватает. Пока он свежий, счётчик наверху показывает ЕГО.
// Иначе после смены ролика в статусе висит остаток прошлой раскадровки:
// у пользователя там было «121/121» от «НЛО в Библии» поверх «Создателей».
let counted = null;

// Счётчик считает ВСЕ таймкоды раскадровки, как в шапке файла. Пустые
// таймкоды это окна диктора, отправлять там нечего, но они засчитываются
// пройденными, иначе цифра не сходится с тем, что видит пользователь.
// Общее число берём из самой раскадровки, а не только из ответа воркера:
// после правки расширения его надо перезагружать, а попап перечитывается
// сам, и старый прогон иначе показывал бы 107 вместо 130.
let tcLocal = 0;

// Кадр целиком по его таймкоду: строка времени, тег стиля и промт.
// Ключи те же, что возвращает «Посчитать»: минуты без ведущих нулей.
// Плитки сводки: цифра, подпись и под ней кнопки. Вынесено отдельно,
// потому что попап закрывается от любого клика и плитки надо рисовать заново.
function renderTally(r) {
  missing = r.missing || []; missImg = r.missImg || []; missVeo = r.missVeo || [];
  // gone это сколько кадров недостаёт: при нуле кнопку «дослать» не рисуем
  // Плитки «сделано» больше нет (пользователь, 2026-08-18): она дублировала
  // сумму картинок и видео, а её «дослать» гнало и то и другое разом.
  // Кнопки ▶ и ⧉ рисуем ТОЛЬКО когда есть недостача: всё сделано — плитка чистая.
  const cell = (n, cap, cls, kind, gone) =>
    `<div class="cell">` +
    `<div class="big ${cls}">${n}</div><div class="cap">${cap}</div>` +
    (gone
      ? `<div class="btns">` +
        `<button class="go" data-go="${kind}" title="Дослать недостающие: ${gone}">▶</button>` +
        `<button class="copy" data-kind="${kind}" title="Скопировать кадры с промтами">⧉</button>` +
        `</div>`
      : "") +
    `</div>`;
  tally.classList.add("show");
  tally.innerHTML =
    cell(`${r.imgDone}/${r.imgAll}`, "картинки", r.imgDone === r.imgAll ? "ok" : "no", "img", missImg.length) +
    cell(`${r.veoDone}/${r.veoAll}`, "видео", r.veoDone === r.veoAll ? "ok" : "no", "veo", missVeo.length);
}

function blocksByTc(text) {
  const out = {};
  const m = (text || "").match(/^\d+\.\d+sec/m);
  if (!m) return out;
  for (const b of text.slice(text.indexOf(m[0])).split(/\n(?=\d+\.\d+sec)/)) {
    const t = b.match(/^(\d+)\.(\d+)sec/);
    if (t) out[`${parseInt(t[1], 10)}.${t[2]}sec`] = b.trim();
  }
  return out;
}

function countTc(text) {
  return ((text || "").match(/^\d+\.\d+sec/gm) || []).length;
}

// Считаем КАДРЫ С ПРОМТАМИ, а не все таймкоды раскадровки. Пустые таймкоды
// это окна диктора, туда ничего не отправляется и файлов оттуда не приходит.
// Пробовали показывать все таймкоды (130 против 107) — путало ещё сильнее,
// потому что архив из Flow приходит ровно на 107 файлов.
// Верхней отметки счётчика тут больше нет. Она стояла против отката цифры,
// но после «Посчитать» врала: подсчёт находил 223 из 332, а отметка держала
// 332 с прошлого прогона и показывала конец ролика (пользователь, 2026-08-28).
// Настоящую причину отката вылечили в другом месте: позиция продолжения
// теперь определяется таймкодом кадра, а не номером пачки.
function progress(st, finished) {
  // При досылке недостающих кадров счётчик продолжает нумерацию ролика:
  // bAll это все кадры раскадровки, bDone сколько было готово до запуска.
  // Без этого цифра падала с 98/106 обратно к 0/8 и читалась как откат.
  const all = st.bAll || ((st.iAll || 0) + (st.vAll || 0));
  let done = (st.bDone || 0) + (st.iDone || 0) + (st.vDone || 0);
  if (finished) done = all;
  done = Math.min(done, all);
  return { done, all, text: `${done}/${all}` };
}

function bar(p, kind) {
  if (!flowBarEl) return;
  const on = p.all > 0;
  flowBarEl.style.display = on ? "block" : "none";
  flowBarEl.className = kind;
  flowBarFill.style.width = on ? `${Math.round(100 * p.done / p.all)}%` : "0";
  flowBarEl.title = on ? `${p.text} кадров` : "";
}

function paintFlow(st) {
  flowLogEl.textContent = (st.log || []).join("\n");
  flowLogEl.scrollTop = 1e9;
  // Статус только про отправку. Что реально сгенерилось, показывают
  // плитки сводки по кнопке «Посчитать», дублировать это здесь незачем.
  if (st.running) {
    const sent = (st.iDone || 0) + (st.vDone || 0);
    const allf = (st.iAll || 0) + (st.vAll || 0);
    const p = progress(st, false);
    setStatus(flowStatusEl, `⏳ Готово кадров ${p.done} из ${p.all}`, "wait");
    bar(p, "wait");
    flowStartBtn.disabled = true;
    flowResumeBtn.disabled = true;
    flowStopBtn.disabled = false;
    flowStopBtn.hidden = false;
    // Идёт подача — считать нечего, кнопку убираем совсем, статус занимает
    // всю строку (пользователь, 2026-08-20)
    flowCountBtn.hidden = true;
    flowCountBtn.disabled = true;
    heygenShown(false);
    // Пока идёт подача, нажать можно только «Стоп»: две мёртвые кнопки рядом
    // занимают место зря (пользователь, 2026-08-18)
    flowStartBtn.hidden = true;
    flowResumeBtn.hidden = true;
    // Настройки на ходу менять нечего: задание уже разбито на пачки
    // (пользователь, 2026-08-18)
    flowPerEl.disabled = true;
    flowVeoEl.disabled = true;
    // Чистить на ходу нечего: кнопку убираем из шапки совсем
    // (пользователь, 2026-08-20)
    flowClearBtn.hidden = true;
    flowClearBtn.disabled = true;
    flowTextEl.disabled = true;
    flowTextEl.hidden = true;
    if (flowSpinEl) flowSpinEl.hidden = false;   // крутилка: расширение в работе
    // Плитки подсчёта показывают состояние проекта ДО запуска, а подача его
    // уже меняет. Прячем их и забываем результат (пользователь, 2026-08-18):
    // после остановки счёт делается заново кнопкой «Посчитать».
    tally.innerHTML = ""; tally.classList.remove("show");
    if (counted) { counted = null; chrome.storage.local.remove("flowCounted"); }
  } else {
    flowStopBtn.disabled = true;
    flowStopBtn.hidden = false;
    perRows.forEach((r) => { r.hidden = false; });
    flowStartBtn.hidden = false;
    flowResumeBtn.hidden = false;
    flowPerEl.disabled = false;
    flowVeoEl.disabled = false;
    flowClearBtn.hidden = false;
    flowClearBtn.disabled = false;
    flowTextEl.disabled = false;
    flowTextEl.hidden = false;
    if (flowSpinEl) flowSpinEl.hidden = true;
    flowStartBtn.disabled = !flowTab;
    flowStartBtn.hidden = false;
    // «Начать» шлёт раскадровку с первого куска. Если в проекте уже есть кадры,
    // это второй прогон по готовому: время и кредиты на ветер. Пользователь
    // 2026-08-20: «кнопку начать убери, если уже были созданы кадры», и позже
    // уточнил, что убрать надо совсем, а не гасить. Вместе с кнопкой уходит поле
    // ввода: раскадровка уже разобрана и сохранена, править её на этом шаге
    // нечего («и также поле для ввода убери, если уже кадры определились и
    // записались в файл»). Возвращает обоих «Очистить».
    heygenShown(true);
    flowCountBtn.hidden = false;
    flowCountBtn.disabled = !flowTab || !flowTextEl.value.trim();
    // Свежий подсчёт главнее остатка прошлого прогона: он показывает,
    // сколько кадров ролика реально лежит в проекте прямо сейчас.
    if (counted) {
      const p = { done: counted.made, all: counted.total, text: `${counted.made} из ${counted.total}` };
      const full = !counted.missing.length;
      setStatus(flowStatusEl, full ? `✅ Все ${counted.total} кадров найдены!` : `⏸ Отправлено кадров ${p.text}`,
                full ? "good" : "bad");
      bar(p, full ? "" : "bad");
      flowResumeBtn.disabled = !flowTab || full;
      flowResumeBtn.title = full ? "всё сгенерировано"
        : `дошлю недостающие кадры: ${counted.missing.length}`;
      // Всё сгенерировано: подавать больше нечего и останавливать нечего.
      // Пользователь 2026-08-20: «если все кадры готовы, то кнопки стоп
      // и продолжить скрой». Остаются 🔍 и «Очистить».
      if (full) {
        flowResumeBtn.hidden = flowStopBtn.hidden = true;
        perRows.forEach((r) => { r.hidden = true; });
      }
      if (counted.made > 0) flowStartBtn.hidden = flowTextEl.hidden = true;
      syncHidden();
      return;
    }
    // «Продолжить» имеет смысл только когда есть незаконченный остаток
    const left = st.total ? st.total - st.idx : (savedIdx ? 1 : 0);
    flowResumeBtn.disabled = !flowTab || !savedIdx || left <= 0;
    // подсчёта нет, но прошлый прогон уже что-то отправил: кадры в проекте есть
    if (savedIdx > 0) flowStartBtn.hidden = flowTextEl.hidden = true;
    const vleft = (st.isVid || []).slice(st.idx).filter(Boolean).length;
    flowResumeBtn.title = left <= 0 ? "всё отправлено"
      : vleft ? `осталось сообщений: ${left}, из них видео-пачек: ${vleft}`
              : `осталось сообщений: ${left}`;
    syncHidden();
    if (st.total) {
      const done = st.idx >= st.total;
      const sent = (st.iDone || 0) + (st.vDone || 0);
      const allf = (st.iAll || 0) + (st.vAll || 0);
      const p = progress(st, done);
      setStatus(flowStatusEl,
        allf ? `${done ? "✅" : "⏸"} Отправлено кадров ${p.text}`
             : `${done ? "✅" : "⏸"} Отправлено кадров ${st.idx} из ${st.total}`,
        done ? "good" : "bad");
      bar(p, done ? "" : "bad");
    }
  }
}

function pollFlow() {
  chrome.runtime.sendMessage({ cmd: "flowState" }, (st) => {
    if (chrome.runtime.lastError || !st) return;
    // Рисуем ТОЛЬКО после чтения хранилища: tcLocal (сколько всего таймкодов
    // в раскадровке) приходит оттуда, а при завершённом задании опрос делает
    // один проход и гаснет. Нарисовав раньше, счётчик показывал 107 вместо 130.
    chrome.storage.local.get(["flowIdx", "flowText", "flowPer", "flowLastTc", "flowResendSent"], (r) => {
      r = r || {};
      if (r.flowIdx) savedIdx = r.flowIdx;
      if (r.flowLastTc) savedTc = r.flowLastTc;
      if (Array.isArray(r.flowResendSent)) resendSent = r.flowResendSent;
      tcLocal = countTc(r.flowText || flowTextEl.value);
      // автозапуск из Finder кладёт раскадровку в память — показываем её
      if (r.flowText && !flowTextEl.value) flowTextEl.value = r.flowText;
      if (r.flowPer != null) {
        const per = normalizeFlowPer(r.flowPer);
        if (flowPerEl.value !== per) flowPerEl.value = per;
        if (String(r.flowPer) !== per) chrome.storage.local.set({ flowPer: per });
      }
      paintFlow(st);
      // Запоминаем состояние синхронным хранилищем: при следующем открытии
      // панель сразу нарисуется в правильном виде и не мигнёт
      try { localStorage.setItem("flowRunFast", st.running ? "1" : ""); } catch (e) {}
      if (!st.running && flowTimer) { clearInterval(flowTimer); flowTimer = null; }
    });
  });
}

flowTextEl.addEventListener("input", () => {
  tcLocal = countTc(flowTextEl.value);
  refreshTopRow();          // вставили текст: верхняя строка появляется целиком
  // вставили другую раскадровку: прошлый подсчёт к ней уже не относится
  if (counted) { counted = null; chrome.storage.local.remove("flowCounted"); }
});

async function initFlow() {
  // Работаем на той вкладке, где пользователь сейчас стоит. Искать по всему
  // браузеру нельзя: при нескольких проектах уводило не в тот.
  const isFlow = (t) => /(labs\.google\/fx\/.*\/tools\/flow|flow\.google\.com)\/project\//.test(t.url || "");
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isFlow(active)) {
    flowTab = active;
  } else {
    const all = await chrome.tabs.query({});
    flowTab = all.find(isFlow) || null;
  }

  if (!flowTab) {
    // Запоминаем сообщение в tabMsg, как и остальные: после «Очистить» строку
    // надо чем-то заполнить, а раньше эта ветка ставила текст напрямую и
    // подсказка терялась (пользователь, 2026-08-23).
    tabMsg = { text: "Откройте Google Flow", cls: "bad" };
    setStatus(flowStatusEl, tabMsg.text, tabMsg.cls);
    flowStartBtn.disabled = true;
  } else {
    const id = (flowTab.url.match(/project\/([0-9a-f-]{8})/) || [, "?"])[1];
    const here = active && flowTab.id === active.id;
    // Номер проекта пользователю ничего не говорит. На своей вкладке пишем,
    // что делать дальше (2026-08-20), номер оставляем только в предупреждении
    // про чужую вкладку: там он помогает понять, куда уйдёт подача.
    tabMsg = here ? { text: "Нажмите посчитать", cls: "wait" }
                  : { text: `⚠️ Другая вкладка · ${id}`, cls: "bad" };
    setStatus(flowStatusEl, tabMsg.text, tabMsg.cls);
    flowStartBtn.disabled = false;
  }

  const saved = await chrome.storage.local.get(["flowText", "flowPer", "flowIdx", "flowPerV", "flowVeo", "flowTotal", "flowCounted", "flowLastTc", "flowResend", "flowResendSent"]);
  // попап закрывается от любого клика мимо, поэтому подсчёт живёт в хранилище:
  // иначе цифра и «Продолжить» сбрасывались бы сразу после закрытия
  if (saved.flowCounted && Array.isArray(saved.flowCounted.missing)) {
    counted = saved.flowCounted;
    if (counted.missImg) renderTally(counted);
  }
  if (saved.flowPerV !== 2) { saved.flowPer = +normalizeFlowPer(saved.flowPer); chrome.storage.local.set({ flowPer: saved.flowPer, flowPerV: 2 }); }
  // «pause» это полуручной режим: после каждой видео-пачки расширение встаёт,
  // дальше только по кнопке «Продолжить». Видео тратят кредиты, поэтому по умолчанию так.
  if (!["pause", "skip"].includes(saved.flowVeo)) {
    saved.flowVeo = "pause"; chrome.storage.local.set({ flowVeo: "pause" });
  }
  savedIdx = saved.flowIdx || 0;
  savedTc = saved.flowLastTc || "";
  activeResend = saved.flowResend && Array.isArray(saved.flowResend.missing) ? saved.flowResend : null;
  resendSent = Array.isArray(saved.flowResendSent) ? saved.flowResendSent : [];
  const savedTotal = saved.flowTotal || 0;
  if (saved.flowText) flowTextEl.value = saved.flowText;
  // список фиксированный: старые 4 и 6 заменяем на 5
  flowPerEl.value = normalizeFlowPer(saved.flowPer);
  if (String(saved.flowPer) !== flowPerEl.value) chrome.storage.local.set({ flowPer: flowPerEl.value });
  if (saved.flowVeo) flowVeoEl.value = saved.flowVeo;
  if (savedIdx && savedTotal && savedIdx >= savedTotal) {
    flowResumeBtn.disabled = true;
    flowLogEl.textContent = `прошлый прогон отправлен целиком: ${savedIdx} из ${savedTotal}`;
  } else if (savedIdx) {
    flowLogEl.textContent = `прошлый прогон дошёл до сообщения ${savedIdx}, «Продолжить» стартует с ${savedIdx + 1}`;
  }

  chrome.runtime.sendMessage({ cmd: "ping" }, (r) => {
    if (chrome.runtime.lastError || !r) {
      setStatus(flowStatusEl, "Расширение не перезагружено", "bad");
      flowLogEl.textContent =
        "Фоновый скрипт flow.js не запущен.\nОткройте chrome://extensions и нажмите " +
        "кружок обновления на карточке этого расширения.";
      flowStartBtn.disabled = true;
    }
  });

  refreshTopRow();
  pollFlow();
  flowTimer = setInterval(pollFlow, 1500);
}

flowTextEl.addEventListener("change", () =>
  chrome.storage.local.set({ flowText: flowTextEl.value }));
flowPerEl.addEventListener("change", () => {
  flowPerEl.value = normalizeFlowPer(flowPerEl.value);
  chrome.storage.local.set({ flowPer: flowPerEl.value });
});

function launch(fresh, onlyList, contBase) {
  const text = flowTextEl.value.trim();
  if (!text) { setStatus(flowStatusEl, "Вставьте раскадровку", "bad"); return; }
  if (!flowTab) return;
  chrome.storage.local.set({ flowText: text, flowPer: flowPerEl.value, flowVeo: flowVeoEl.value });
  setStatus(flowStatusEl, fresh ? "Запускаю…" : "Продолжаю…", "wait");
  // Кнопка ▶ в плитке присылает свой список кадров, «Продолжить» берёт всю
  // недостачу из последнего подсчёта. База нужна, чтобы счётчик продолжал
  // общую нумерацию ролика, а не начинался заново с нуля.
  // contBase приходит при ПРОДОЛЖЕНИИ прерванной досылки: список уже урезан
  // до неотправленного остатка, база учитывает досланное.
  const list = !fresh && onlyList && onlyList.length ? onlyList
    : !fresh && counted && counted.missing.length ? counted.missing : null;
  const resend = list && { missing: list,
                           made: contBase ? contBase.made : (counted ? counted.made : 0),
                           total: contBase ? contBase.total : (counted ? counted.total : list.length) };
  // Новая досылка (не продолжение) запоминает свой список целиком: «Стоп» и
  // «Продолжить» работают строго по нему, без пересчёта (пользователь,
  // 2026-08-28). Список обновляет только кнопка «Посчитать».
  if (resend && !contBase) {
    activeResend = { missing: list.slice(), made: resend.made, total: resend.total };
    resendSent = [];
    chrome.storage.local.set({ flowResend: activeResend, flowResendSent: [] });
  }
  chrome.runtime.sendMessage(
    // newSession не шлём: «Новый сеанс» расширение не жмёт ни при каких условиях
    { cmd: "flowStart", tabId: flowTab.id, text, per: +normalizeFlowPer(flowPerEl.value),
      veo: flowVeoEl.value, head: fresh, newSession: false,
      fromIdx: fresh || resend ? 0 : savedIdx,
      fromTc: fresh || resend ? "" : savedTc,
      only: resend ? resend.missing : null,
      sentBase: resend ? resendSent.slice() : null,
      base: resend ? { all: resend.total, done: resend.made } : null },
    (resp) => {
      const err = chrome.runtime.lastError;
      if (err || !resp) {
        setStatus(flowStatusEl, "Фоновый воркер молчит", "bad");
        flowLogEl.textContent =
          (err ? err.message : "нет ответа") +
          "\n\nПерезагрузите расширение на chrome://extensions " +
          "(кружок обновления на карточке). Права и фоновый скрипт менялись, " +
          "без перезагрузки Chrome их не подхватит.";
        return;
      }
      if (!resp.ok) {
        setStatus(flowStatusEl, "Досылка не пошла", "bad");
        flowLogEl.textContent += `\nдосылка отменена: ${resp.err || "воркер отказал"}`;
        return;
      }
      // Досылка обязана уйти ровно тем списком, что мы посчитали. Если воркер
      // насчитал другое число, он старой версии и про список не знает: такая
      // отправка гонит по второму кругу кадры, которые уже сгенерированы.
      // Опасен только случай, когда воркер взял БОЛЬШЕ, чем просили: значит
      // он старой сборки, фильтр не понял и погонит всю раскадровку заново.
      // А меньше бывает законно: часть недостающих таймкодов может не найтись
      // в тексте, или видео отброшены режимом «пропускать». Раньше досылка
      // в этом случае молча отказывалась стартовать (пользователь, 2026-08-28:
      // «нажал посчитать, потом продолжить, а оно не шлёт»).
      if (resend && (resp.frames === undefined || resp.frames > resend.missing.length)) {
        chrome.runtime.sendMessage({ cmd: "flowStop" }, () => {});
        setStatus(flowStatusEl, "Расширение не перезагружено", "bad");
        flowLogEl.textContent +=
          `\nостановил: просил ${resend.missing.length} кадров, воркер взял ` +
          `${resp.frames === undefined ? "всю раскадровку" : resp.frames}.` +
          "\nОткройте chrome://extensions и нажмите кружок обновления на карточке.";
        flowLogEl.scrollTop = 1e9;
        return;
      }
      if (resend && !resp.frames) {
        chrome.runtime.sendMessage({ cmd: "flowStop" }, () => {});
        setStatus(flowStatusEl, "Досылать нечего", "bad");
        flowLogEl.textContent +=
          `\nни один из ${resend.missing.length} недостающих кадров не нашёлся в раскадровке.` +
          "\nПохоже, в поле лежит текст другого ролика. Вставьте ту раскадровку, по которой считали.";
        flowLogEl.scrollTop = 1e9;
        return;
      }
      if (resend) {
        flowLogEl.textContent += `\nдосылаю кадров: ${resp.frames}`;
        if (resp.frames < resend.missing.length) {
          const lost = resend.missing.length - resp.frames;
          flowLogEl.textContent += `\nвнимание: ${lost} из недостающих кадров в подачу не попали` +
            (flowVeoEl.value === "skip" ? ", похоже это видео, а режим стоит «пропускать»" : "");
        }
      }
      flowStartBtn.disabled = true;
      flowResumeBtn.disabled = true;
      flowStopBtn.disabled = false;
      // не ждём первого опроса через 1.5 с: крутилка и уборка «Очистить»
      // должны быть видны сразу по нажатию
      if (flowSpinEl) flowSpinEl.hidden = false;
      flowClearBtn.hidden = true;
      flowCountBtn.hidden = true;
      heygenShown(false);
      counted = null;                       // цифру дальше ведёт сам прогон
      chrome.storage.local.remove("flowCounted");
      if (flowTimer) clearInterval(flowTimer);
      flowTimer = setInterval(pollFlow, 1500);
    }
  );
}

// «Начать» стирает весь прогресс и гонит раскадровку заново, а нажать её
// легко по ошибке (пользователь, 2026-08-18). Если прошлый прогон дошёл
// докуда-то или подсчёт нашёл готовые кадры, сначала переспрашиваем.
flowStartBtn.addEventListener("click", () => {
  const done = counted ? counted.made : savedIdx;
  if (done > 0) {
    const what = counted
      ? `В проекте уже есть ${counted.made} из ${counted.total} кадров.`
      : `Прошлый прогон дошёл до ${savedIdx} сообщения.`;
    if (!confirm(`${what}\n\nНачать всё сначала? Кадры пойдут в НОВЫЙ проект с первого.\n` +
                 `Чтобы дослать недостающие, закройте это окно и нажмите «Продолжить».`)) return;
  }
  launch(true);
});
flowResumeBtn.addEventListener("click", () => {
  // Свежий подсчёт главнее всего: он задаёт новый список недостачи.
  if (counted && counted.missing.length) { launch(false); return; }
  // Прерванная досылка продолжается строго по СВОЕМУ списку: дослать ровно
  // то, что из него не ушло. Никакого пересчёта, пока пользователь сам не
  // нажмёт «Посчитать» (пользователь, 2026-08-28).
  if (activeResend && activeResend.missing.length) {
    const sent = new Set(resendSent);
    const rest = activeResend.missing.filter((tc) => !sent.has(tc));
    if (!rest.length) {
      setStatus(flowStatusEl, "✅ Досылка завершена", "good");
      toLog("список досылки отправлен целиком; новый список даст «Посчитать»");
      return;
    }
    toLog(`продолжаю досылку: осталось ${rest.length} из ${activeResend.missing.length} по тому же списку`);
    launch(false, rest, { made: activeResend.made + (activeResend.missing.length - rest.length),
                          total: activeResend.total });
    return;
  }
  launch(false);
});

// Чистим текст, лог и отметку позиции: после этого «Продолжить» неактивна,
// а «Начать» пойдёт с самого начала в новом сеансе.
function runCount(after) {
  if (!flowTab) { setStatus(flowStatusEl, "Нет вкладки Flow", "bad"); return; }
  const text = flowTextEl.value.trim();
  if (!text) { setStatus(flowStatusEl, "Вставьте раскадровку", "bad"); return; }
  flowCountBtn.disabled = true;
  toLog("считаю кадры в проекте…");
  chrome.runtime.sendMessage({ cmd: "flowCount", tabId: flowTab.id, text }, (r) => {
    flowCountBtn.disabled = !flowTab || !flowTextEl.value.trim();
    if (chrome.runtime.lastError || !r) { toLog("воркер не отвечает"); return; }
    if (!r.ok) { toLog("сбой: " + r.err); return; }
    // крупная сводка: сделано зелёным, недостача красным.
    // Списки недостающих кадров расставляет сама renderTally.
    renderTally(r);

    // Диагностика уходит в лог, наружу только номера недостающих кадров.
    const diag = [`посчитал: нашёл на странице ${r.found} номеров, сетка ${r.grid ? "найдена" : "НЕ найдена"}`];
    if (!r.found && r.sample && r.sample.length)
      diag.push("что вижу в сетке: " + r.sample.slice(0, 12).join(" | "));
    toLog(diag.join("\n"));

    const lines = [];
    if (r.missImg && r.missImg.length) lines.push(`картинки (${r.missImg.length}): ` + r.missImg.join(", "));
    if (r.missVeo && r.missVeo.length) lines.push(`видео (${r.missVeo.length}): ` + r.missVeo.join(", "));
    if (!missing.length) lines.push("всё на месте");
    toLog(lines.join("\n"));

    // Счётчик наверху сразу показывает насчитанное, «Продолжить» оживает.
    counted = { made: r.made, total: r.total, missing: missing.slice(),
                missImg: missImg.slice(), missVeo: missVeo.slice(),
                imgAll: r.imgAll, imgDone: r.imgDone, veoAll: r.veoAll, veoDone: r.veoDone };
    chrome.storage.local.set({ flowCounted: counted });
    pollFlow();
    if (after) after();
  });
}
flowCountBtn.addEventListener("click", () => runCount());

tally.addEventListener("click", async (e) => {
  // «Дослать» прямо из плитки: недостачу берём ту, что стоит в этой строке.
  // Картинки и видео можно догонять по отдельности, видео тратят кредиты.
  const g = e.target.closest(".go");
  if (g) {
    const list = g.dataset.go === "img" ? missImg : g.dataset.go === "veo" ? missVeo : missing;
    if (!list.length || !flowTab) return;
    g.disabled = true;
    launch(false, list);
    return;
  }

  const b = e.target.closest(".copy");
  if (!b) return;

  const list = b.dataset.kind === "veo" ? missVeo : missImg;
  if (!list.length) { b.textContent = "—"; setTimeout(() => { b.textContent = "⧉"; }, 900); return; }
  // Копируем не номера, а сами кадры целиком: таймкод, тег стиля и промт.
  // Такой текст можно сразу вставить в Flow руками, ничего не дособирая.
  const blocks = blocksByTc(flowTextEl.value);
  const text = list.map((tc) => blocks[tc] || tc).join("\n\n");
  await navigator.clipboard.writeText(text);
  b.textContent = "✓";
  setTimeout(() => { b.textContent = "⧉"; }, 1200);
});

flowClearBtn.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();   // кнопка внутри summary, блок не трогаем
  flowTextEl.value = "";
  flowLogEl.textContent = "";
  missing = [];
  tally.innerHTML = ""; tally.classList.remove("show"); missImg = []; missVeo = [];
  savedIdx = 0;
  savedTc = "";
  activeResend = null;
  resendSent = [];
  tcLocal = 0;
  counted = null;
  bar({ done: 0, all: 0, text: "0/0" }, "");     // полоса загрузки тоже сбрасывается
  chrome.storage.local.remove(
    ["flowText", "flowIdx", "flowLog", "flowTotal", "flowRunning", "flowTally", "flowCounted", "flowLastTc", "flowResend", "flowResendSent"]);
  // job.txt остаётся лежать на диске; помечаем его взятым, иначе автозапуск
  // подхватит тот же файл заново и начнёт генерить по второму кругу
  chrome.runtime.sendMessage({ cmd: "flowConsume" }, () => {});
  chrome.runtime.sendMessage({ cmd: "flowStop" }, () => {});

  // Возвращаем панель к виду свежеоткрытого расширения. Сброса состояния мало:
  // спрятанное надо показать обратно руками, перерисовки тут не будет, опрос
  // на стоящем задании выключен. Пользователь 2026-08-20: «когда жму очистить,
  // не возвращается всё назад, не видно скрытых элементов».
  for (const el of [flowStartBtn, flowResumeBtn, flowStopBtn, flowTextEl, flowCountBtn])
    if (el) el.hidden = false;
  perRows.forEach((r) => { r.hidden = false; });
  flowTextEl.disabled = false;
  flowPerEl.disabled = false;
  flowVeoEl.disabled = false;
  if (flowSpinEl) flowSpinEl.hidden = true;
  flowStartBtn.disabled = !flowTab;
  flowCountBtn.disabled = true;              // текста нет, считать нечего
  flowStopBtn.disabled = true;
  flowResumeBtn.disabled = true;
  syncHidden();
  // Никакого «Очищено»: после чистки панель выглядит как у свежеоткрытого
  // расширения, а строка статуса прячется вместе с полем и 🔍
  // (пользователь, 2026-08-20). refreshTopRow внутри syncHidden уже это сделал.
  // Текст тоже стираем: спрятать мало, он всплывал обратно при вставке нового
  // задания (пользователь, 2026-08-23).
  flowStatusEl.textContent = "";
  flowStatusEl.hidden = true;
});

flowStopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ cmd: "flowStop" }, () => {
    setStatus(flowStatusEl, "Останавливаю после текущего шага", "wait");
  });
});

initFlow();

// ── Фильтр YouTube ───────────────────────────────────────────────────────
// Прячет в выдаче ролики каналов, у которых подписчиков больше порога.
// Сам фильтр живёт в yt-filter.js на странице YouTube, попап только хранит
// настройки: галочку и число. Обмен через chrome.storage, контент-скрипт
// слушает изменения и перерисовывает выдачу сразу.
const ytfOnEl = document.getElementById("ytfOn");
const ytfLimitEl = document.getElementById("ytfLimit");
const ytfLimitRow = document.getElementById("ytfLimitRow");
const YTF_DEF = 15000, YTF_MAX = 30000;   // значение по умолчанию и потолок

// Разряды разделяем пробелом: 5 000 читается быстрее, чем 5000
// (пользователь, 2026-08-24). Пробел неразрывный, иначе число может
// перенестись по строке. Из-за разделителя поле стало текстовым.
const ytfNum = (v) => +String(v).replace(/\D/g, "") || 0;
const ytfFmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

// Больше тридцати тысяч вводить нельзя (пользователь, 2026-08-21): фильтр
// задуман под мелкие каналы, а с большим порогом он просто ничего не прячет.
function ytfClamp() {
  const n = ytfNum(ytfLimitEl.value);
  return n > YTF_MAX ? YTF_MAX : n;
}

// Перерисовываем поле с разделителем и возвращаем курсор на место. Считаем,
// сколько цифр стояло левее курсора, и после переформатирования ставим его
// после того же по счёту разряда: иначе курсор прыгал бы в конец на каждой
// набранной цифре и число посреди строки было бы не поправить.
function ytfPaint() {
  const el = ytfLimitEl;
  const dig = el.value.slice(0, el.selectionStart ?? el.value.length)
                      .replace(/\D/g, "").length;
  const n = ytfClamp();
  el.value = n ? ytfFmt(n) : "";
  let i = 0, seen = 0;
  while (i < el.value.length && seen < dig) {
    if (/\d/.test(el.value[i])) seen++;
    i++;
  }
  el.setSelectionRange(i, i);
}

// Поле и «Применить» показываем только при поставленной галочке: без неё
// настраивать нечего (пользователь, 2026-08-21).

// Значок красит и фоновый воркер, и попап. Воркер в Chrome засыпает, и если
// галочку поставили, пока он спал, воронка не загоралась (пользователь 2026-08-21:
// «зашёл на ютуб, но не светится фильтр»). Попап делает то же самое при открытии
// и при каждом переключении, так что состояние сходится в любом случае.
async function ytfIcon(on) {
  // Красим ТОЛЬКО текущую вкладку и только если это YouTube: на остальных
  // вкладках должен остаться обычный значок.
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t) return;
    const yt = /^https?:\/\/(www\.)?youtube\.com\//.test(t.url || "");
    const p = (on && yt)
      ? { 16: "icons/filter16.png", 32: "icons/filter32.png", 48: "icons/filter48.png", 128: "icons/filter128.png" }
      : { 16: "icons/multibot-list-16.png", 32: "icons/multibot-list-32.png", 48: "icons/multibot-list-48.png", 128: "icons/multibot-list-128.png" };
    await chrome.action.setIcon({ tabId: t.id, path: p });
    await chrome.action.setTitle({ tabId: t.id,
      title: (on && yt) ? "Фильтр YouTube включён" : "Multi Bot" });
  } catch (e) {}
}

function ytfRows() {
  ytfLimitRow.hidden = !ytfOnEl.checked;
}

chrome.storage.local.get(["ytfOn", "ytfLimit"], (r) => {
  r = r || {};
  ytfOnEl.checked = !!r.ytfOn;
  const v = Math.min(ytfNum(r.ytfLimit), YTF_MAX) || (r.ytfOn ? YTF_DEF : 0);
  ytfLimitEl.value = v ? ytfFmt(v) : "";
  ytfRows(); ytfIcon(ytfOnEl.checked);
});
// Кнопки «Применить» нет, фильтр применяется сразу: пользователь 2026-08-21
// «кнопку применить не надо, оно и так применяет норм». От дёрганья на каждую
// нажатую цифру спасает задержка в контент-скрипте.
ytfOnEl.addEventListener("change", () => {
  // Поставили галочку с пустым полем — сразу подставляем пятнадцать тысяч,
  // чтобы не приходилось вбивать число руками (пользователь, 2026-08-21).
  if (ytfOnEl.checked && !ytfClamp()) ytfLimitEl.value = ytfFmt(YTF_DEF);
  chrome.storage.local.set({ ytfOn: ytfOnEl.checked, ytfLimit: ytfClamp() });
  ytfRows(); ytfIcon(ytfOnEl.checked);
});
ytfLimitEl.addEventListener("input", () => {
  ytfPaint();
  chrome.storage.local.set({ ytfLimit: ytfClamp() });
});

// «Показать доход». Раньше этот ползунок стоял в шапке блока и выключал весь
// менеджер целиком. Пользователь 2026-08-24 попросил убрать его из шапки
// и поставить к RPM, чтобы доход включался отдельно. Поле RPM открывается
// вместе с ним, как «Подписчиков до» открывается вместе с прятанием каналов.
// Ключ в хранилище остался прежний, ytmOn, чтобы не терять настройку.
const ytmOnEl = document.getElementById("ytmOn");
const ytfRpmRowEl = document.getElementById("ytfRpmRow");

function ytmPaint(on) {
  ytmOnEl.checked = on;
  ytfRpmRowEl.hidden = !on;
}

// По умолчанию включено: у кого расширение уже стояло, ничего не пропадает.
chrome.storage.local.get(["ytmOn"], (r) => {
  ytmPaint((r || {}).ytmOn !== false);
});

ytmOnEl.addEventListener("change", () => {
  const on = ytmOnEl.checked;
  ytmPaint(on);
  chrome.storage.local.set({ ytmOn: on });
});


// ── RPM и доход ──────────────────────────────────────────────────────────
// Доход считается как просмотры за месяц, делённые на тысячу и умноженные
// на RPM. Значение по умолчанию два доллара, шаг переключателя полдоллара
// (пользователь, 2026-08-22). Число уходит в хранилище, а показывает его
// контент-скрипт прямо в шапке канала рядом с просмотрами.
const ytfRpmEl = document.getElementById("ytfRpm");
const RPM_DEF = 2, RPM_STEP = 0.5, RPM_MAX = 50;

function ytfRpmSet(v) {
  v = Math.min(RPM_MAX, Math.max(0, Math.round(v / RPM_STEP) * RPM_STEP));
  ytfRpmEl.value = v % 1 ? v.toFixed(1) : String(v);
  chrome.storage.local.set({ ytfRpm: v });
}
chrome.storage.local.get(["ytfRpm"], (r) => {
  const v = (r || {}).ytfRpm;
  ytfRpmEl.value = v === undefined ? RPM_DEF : v;
  if (v === undefined) chrome.storage.local.set({ ytfRpm: RPM_DEF });
});
document.getElementById("ytfRpmUp").addEventListener("click", (e) => {
  e.preventDefault(); ytfRpmSet((+ytfRpmEl.value || 0) + RPM_STEP);
});
document.getElementById("ytfRpmDown").addEventListener("click", (e) => {
  e.preventDefault(); ytfRpmSet((+ytfRpmEl.value || 0) - RPM_STEP);
});
ytfRpmEl.addEventListener("change", () => ytfRpmSet(+ytfRpmEl.value || 0));

// Пока один блок раскрыт, остальные гасим классом на теле. Смотрим только
// блоки первого уровня: «Журнал» внутри Flow вложенный и в счёт не идёт.
const topBoxes = () => [...document.querySelectorAll("body > details")];
function markOpen() {
  document.body.classList.toggle("anyOpen", topBoxes().some((d) => d.open));
}
topBoxes().forEach((d) => d.addEventListener("toggle", markOpen));

