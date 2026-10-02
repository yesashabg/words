// «Слова» — тренажёр английских слов: экраны, озвучка, резервная копия.
// Расписание повторений — в srs.js.
import * as srs from './srs.js';

const STATE_KEY = 'slova.state.v1';
const WORDS_KEY = 'slova.words.v1';
const BACKUP_EVERY_DAYS = 14;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

// ---------- Данные ----------

function defaultState() {
  return {
    settings: { newPerDay: 8, direction: 'mixed', autoplay: true },
    cards: {}, // прогресс по словам, ключ — id слова
    log: {}, // сколько карточек пройдено по дням: { [день]: { r: ответов, n: новых } }
    lastBackup: null,
    knownIds: null, // слова прошлой загрузки — чтобы заметить новые
  };
}

function loadState() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!saved || typeof saved !== 'object') return base;
    return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
  } catch {
    return base;
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    toast('Не получилось сохранить прогресс');
  }
}

function loadCachedWords() {
  try {
    const data = JSON.parse(localStorage.getItem(WORDS_KEY));
    return data && Array.isArray(data.words) ? data : null;
  } catch {
    return null;
  }
}

const indexWords = (d) => new Map((d?.words || []).map((w) => [w.id, w]));

let state = loadState();
let deck = loadCachedWords();
let byId = indexWords(deck);
let loading = !deck;
let session = null;
let currentView = 'home';
let listFilter = 'all';

const wordList = () => deck?.words || [];

async function refreshWords() {
  try {
    const res = await fetch('words.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.words)) throw new Error('В words.json нет списка слов');
    const before = state.knownIds ? new Set(state.knownIds) : null;
    deck = data;
    byId = indexWords(deck);
    try {
      localStorage.setItem(WORDS_KEY, JSON.stringify(data));
    } catch {
      // без копии списка не будет работы офлайн, но занятие идёт
    }
    const ids = data.words.map((w) => w.id);
    const added = before ? ids.filter((id) => !before.has(id)).length : 0;
    state.knownIds = ids;
    saveState();
    if (added) toast(`Новые слова: +${added}`);
  } catch (err) {
    console.warn('Список слов не обновился', err);
  } finally {
    loading = false;
  }
  if (['home', 'list', 'settings'].includes(currentView)) renderView(currentView);
}

// ---------- Мелочи ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmtDay = (day) => srs.dateOfDay(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const repeatsText = (n) =>
  n ? `Завтра: ${n} ${srs.plural(n, 'повторение', 'повторения', 'повторений')}.` : 'Завтра повторений нет.';

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

// ---------- Экраны ----------

function show(view) {
  currentView = view;
  for (const el of $$('.view')) el.hidden = el.id !== `view-${view}`;
  window.scrollTo(0, 0);
  renderView(view);
}

function renderView(view) {
  if (view === 'home') renderHome();
  else if (view === 'list') renderList();
  else if (view === 'settings') renderSettings();
}

function renderHome() {
  const day = srs.today();
  const words = wordList();
  const plan = srs.planToday(words, state.cards, state.settings, day);
  const st = srs.stats(words, state.cards);
  const total = plan.due.length + plan.fresh.length;

  $('#due-count').textContent = plan.due.length;
  $('#new-count').textContent = plan.fresh.length;
  const start = $('#start-btn');
  start.disabled = total === 0;
  start.textContent = total ? 'Начать' : 'На сегодня всё';
  $('#today-note').textContent = homeNote(words, plan, st, day);

  const streak = srs.streak(state.log, day);
  $('#stat-streak').textContent = streak;
  $('#stat-streak-label').textContent = srs.plural(streak, 'день подряд', 'дня подряд', 'дней подряд');
  $('#stat-learning').textContent = st.learning;
  $('#stat-known').textContent = st.known;
  $('#stat-total').textContent = words.length;

  $('#install-banner').hidden = !(isIOS() && !isStandalone());
  $('#backup-banner').hidden = !needsBackup(st, day);
}

function homeNote(words, plan, st, day) {
  if (!words.length) {
    return loading ? 'Загружаю слова…' : 'Слова не загрузились. Проверь интернет и открой приложение ещё раз.';
  }
  if (plan.due.length + plan.fresh.length === 0) {
    const tomorrow = repeatsText(srs.dueCount(words, state.cards, day + 1));
    return st.new ? tomorrow : `${tomorrow} Новые слова закончились — попроси Claude Code добавить ещё.`;
  }
  const minutes = Math.max(1, Math.ceil(plan.due.length * 0.25 + plan.fresh.length * 0.5));
  return `Займёт около ${minutes} мин.`;
}

function needsBackup(st, day) {
  if (st.learning + st.known < 10) return false;
  return state.lastBackup == null || day - state.lastBackup >= BACKUP_EVERY_DAYS;
}

// ---------- Занятие ----------

function startSession() {
  const day = srs.today();
  const plan = srs.planToday(wordList(), state.cards, state.settings, day);
  const queue = [...plan.due, ...plan.fresh];
  if (!queue.length) return;
  session = { queue, total: queue.length, done: 0, reviewed: 0, learned: 0, fresh: new Set(plan.fresh), current: null };
  prefetchAudio(queue);
  show('card');
  showCard();
}

function showCard() {
  while (session.queue.length && !byId.has(session.queue[0])) session.queue.shift();
  if (!session.queue.length) {
    finishSession();
    return;
  }
  const id = session.queue[0];
  const w = byId.get(id);
  const card = state.cards[id] || srs.newCard();
  const dir = srs.direction(card, state.settings);
  session.current = { id, w, card, dir, revealed: false };

  $('#card-front').innerHTML = frontHTML(w, card, dir);
  $('#card-back').innerHTML = backHTML(w, card);
  $('#card-front').hidden = false;
  $('#card-back').hidden = true;
  $('#reveal-btn').hidden = false;
  $('#grade-btns').hidden = true;
  $('#flash').scrollTop = 0;
  updateProgress();
  if (dir === 'en-ru' && state.settings.autoplay) playClip(w, 0);
}

function frontHTML(w, card, dir) {
  if (dir === 'ru-en') {
    const ex = speakExample(w);
    return `
      <p class="badge">скажи по-английски</p>
      <h2 class="word ru">${esc(w.tr)}</h2>
      ${ex && ex[1] ? `<p class="cue">«${esc(ex[1])}»</p>` : ''}
      <p class="prompt">Скажи слово вслух. Получится — скажи всю фразу.</p>
      <button class="link-btn" type="button" data-action="hint">Подсказка</button>
      <p class="hint-text" hidden>${esc(hintFor(w.w))}</p>`;
  }
  return `
    ${card.seen ? '' : '<p class="badge">новое слово</p>'}
    <h2 class="word">${esc(w.w)}</h2>
    ${w.t ? `<p class="ipa">${esc(w.t)}</p>` : ''}
    <button class="play big" type="button" data-play="0" aria-label="Послушать слово">${PLAY_ICON}</button>
    <p class="prompt">Вспомни перевод</p>`;
}

function backHTML(w, card) {
  return `
    <div class="answer-head">
      <div>
        <h2 class="word">${esc(w.w)}</h2>
        ${w.t ? `<p class="ipa">${esc(w.t)}</p>` : ''}
      </div>
      <button class="play" type="button" data-play="0" aria-label="Послушать слово">${PLAY_ICON}</button>
    </div>
    <p class="translation">${esc(w.tr)}</p>
    ${examplesHTML(w, true)}
    ${card.seen ? '' : '<p class="tip">Новое слово: придумай с ним своё предложение и скажи вслух.</p>'}`;
}

// Второй пример (рабочий) — для проговаривания: прочитать вслух, послушать, сравнить.
function examplesHTML(w, onCard) {
  const examples = w.ex || [];
  const speakIdx = onCard ? (examples.length > 1 ? 1 : 0) : -1;
  return examples
    .map(
      ([en, ru], i) => `
      <div class="example${i === speakIdx ? ' speak' : ''}">
        <p class="ex-label">${i === speakIdx ? 'Скажи вслух → послушай → сравни' : 'Пример'}</p>
        <div class="ex-row">
          <p class="ex-en">${highlight(en, w.w)}</p>
          <button class="play small" type="button" data-play="${i + 1}" aria-label="Послушать пример">${PLAY_ICON}</button>
        </div>
        ${ru ? `<p class="ex-ru">${esc(ru)}</p>` : ''}
      </div>`,
    )
    .join('');
}

const speakExample = (w) => (w.ex || [])[1] || (w.ex || [])[0] || null;

// «instead» → «i _ _ _ _ _ _»: первая буква и прочерки вместо остальных.
function hintFor(word) {
  return word
    .split(/\s+/)
    .map((part) => [...part].map((ch, i) => (i === 0 || !/\p{L}/u.test(ch) ? ch : '_')).join(' '))
    .join('   ');
}

// Подсвечиваем слово в примере, в том числе с окончаниями: consist → consists, turn → turned.
const SKIP = new Set(['to', 'be', 'a', 'an', 'the', 'of', 'at', 'in', 'on', 'for', 'so', 'but', 'you']);
function highlight(sentence, word) {
  let html = esc(sentence);
  const parts = word.toLowerCase().split(/\s+/).filter((p) => p.length >= 3 && !SKIP.has(p));
  for (const part of parts) {
    html = html.replace(new RegExp(`\\b(${escapeRe(part)}[a-z]*)`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

function reveal() {
  const cur = session?.current;
  if (!cur || cur.revealed) return;
  cur.revealed = true;
  $('#card-front').hidden = true;
  $('#card-back').hidden = false;
  $('#reveal-btn').hidden = true;
  const day = srs.today();
  [srs.AGAIN, srs.HARD, srs.GOOD].forEach((grade) => {
    $(`#ivl-${grade}`).textContent = srs.formatIvl(srs.schedule(cur.card, grade, day).ivl);
  });
  $('#grade-btns').hidden = false;
  $('#flash').scrollTop = 0;
  if (cur.dir === 'ru-en' && state.settings.autoplay) playClip(cur.w, 0);
}

function answer(grade) {
  const cur = session?.current;
  if (!cur || !cur.revealed) return;
  const day = srs.today();
  const wasNew = !cur.card.seen;
  state.cards[cur.id] = srs.schedule(cur.card, grade, day);
  const entry = state.log[day] || { r: 0, n: 0 };
  entry.r += 1;
  if (wasNew) entry.n += 1;
  state.log[day] = entry;
  saveState();

  session.queue.shift();
  if (grade === srs.AGAIN) {
    session.queue.splice(Math.min(3, session.queue.length), 0, cur.id); // вернётся через пару карточек
  } else {
    session.done += 1;
    if (session.fresh.has(cur.id)) session.learned += 1;
    else session.reviewed += 1;
  }
  if (session.queue.length) showCard();
  else finishSession();
}

function updateProgress() {
  $('#progress-fill').style.width = `${(session.done / session.total) * 100}%`;
  $('#progress-text').textContent = `${session.done} / ${session.total}`;
}

function finishSession() {
  const s = session;
  session = null;
  stopAudio();
  const parts = [];
  if (s.reviewed) parts.push(`Повторено: ${s.reviewed}`);
  if (s.learned) parts.push(`Новых слов: ${s.learned}`);
  $('#done-summary').textContent = parts.join(' · ');
  $('#done-tomorrow').textContent = repeatsText(srs.dueCount(wordList(), state.cards, srs.today() + 1));
  show('done');
}

function onCardClick(e) {
  const cur = session?.current;
  if (!cur) return;
  const play = e.target.closest('[data-play]');
  if (play) {
    playClip(cur.w, Number(play.dataset.play));
    return;
  }
  const hint = e.target.closest('[data-action="hint"]');
  if (hint) {
    hint.hidden = true;
    $('#card-front .hint-text').hidden = false;
    return;
  }
  if (!cur.revealed) reveal();
}

function onKey(e) {
  const cur = session?.current;
  if (currentView !== 'card' || !cur || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!cur.revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    reveal();
  } else if (cur.revealed && ['1', '2', '3'].includes(e.key)) {
    answer(Number(e.key) - 1);
  } else if (e.key === 'p' || e.key === 'з') {
    playClip(cur.w, 0);
  }
}

// ---------- Озвучка ----------
// Файлы озвучки готовит build_words.py. Если файла нет или он не играет — говорит голос устройства.

const player = new Audio();
const clipUrls = new Map();
let lastClip = { key: null, at: 0 };
let playToken = 0;
let audioUnlocked = false;
let speechUnlocked = false;
let silentUrl = null;

// iOS включает звук только после нажатия. Нажатие «будит» плеер, дальше он играет сам.
// Если касание было прокруткой, iOS звук не включит — тогда пробуем на следующем нажатии.
function unlockAudio() {
  if (!audioUnlocked && player.paused) {
    try {
      silentUrl = silentUrl || silentWav();
      player.src = silentUrl;
      player
        .play()
        ?.then(() => {
          audioUnlocked = true;
        })
        .catch(() => {});
    } catch {
      // не страшно: озвучка сработает с нажатия на динамик
    }
  }
  if (!speechUnlocked && 'speechSynthesis' in window) {
    speechUnlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      // голос устройства — только запасной вариант
    }
  }
}

function silentWav() {
  const samples = 800; // 0,1 секунды тишины
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const text = (offset, s) => [...s].forEach((ch, i) => v.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

async function playClip(w, idx) {
  const text = idx === 0 ? w.w : w.ex?.[idx - 1]?.[0];
  if (!text) return;
  const key = `${w.id}#${idx}`;
  const now = Date.now();
  const slow = lastClip.key === key && now - lastClip.at < 8000; // второе нажатие подряд — медленнее
  lastClip = { key: slow ? null : key, at: now };
  const token = ++playToken;
  stopAudio();
  const file = w.a?.[idx];
  if (file) {
    try {
      const url = await clipUrl(file);
      if (token !== playToken) return;
      player.src = url;
      player.defaultPlaybackRate = slow ? 0.7 : 1;
      player.playbackRate = slow ? 0.7 : 1;
      await player.play();
      audioUnlocked = true;
      return;
    } catch (err) {
      if (token !== playToken) return;
      console.warn('Файл озвучки не сыграл, говорит голос устройства', err);
    }
  }
  speak(text, slow);
}

function clipUrl(file) {
  if (!clipUrls.has(file)) {
    const url = fetch(`audio/${file}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => URL.createObjectURL(blob));
    clipUrls.set(file, url);
    url.catch(() => clipUrls.delete(file));
  }
  return clipUrls.get(file);
}

function prefetchAudio(ids) {
  for (const id of ids) {
    for (const file of byId.get(id)?.a || []) {
      if (file) clipUrl(file).catch(() => {});
    }
  }
}

function stopAudio() {
  try {
    player.pause();
  } catch {
    // плеер ещё ничего не играл
  }
  try {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  } catch {
    // голоса устройства нет
  }
}

const NOVELTY_VOICES =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang) && !NOVELTY_VOICES.test(v.name));
  const score = (v) =>
    (/premium/i.test(v.name) ? 4 : 0) +
    (/enhanced|улучш/i.test(v.name) ? 3 : 0) +
    (/^en[-_]gb/i.test(v.lang) ? 2 : /^en[-_]us/i.test(v.lang) ? 1 : 0) +
    (v.localService ? 1 : 0);
  return voices.sort((a, b) => score(b) - score(a))[0] || null;
}

function speak(text, slow) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : 'en-GB';
  u.rate = slow ? 0.7 : 0.95;
  speechSynthesis.speak(u);
}

// ---------- Все слова ----------

const STATUS_LABEL = { new: 'новое', learning: 'учу', known: 'выучено' };

function renderList() {
  const query = $('#search').value.trim().toLowerCase();
  const day = srs.today();
  for (const chip of $$('#filter-chips .chip')) chip.classList.toggle('active', chip.dataset.filter === listFilter);
  const items = wordList().filter((w) => {
    if (listFilter !== 'all' && srs.status(state.cards[w.id]) !== listFilter) return false;
    return !query || w.w.toLowerCase().includes(query) || w.tr.toLowerCase().includes(query);
  });
  $('#list-count').textContent = items.length;
  $('#word-list').innerHTML = items.length
    ? items.map((w) => rowHTML(w, day)).join('')
    : '<li class="empty">Ничего не нашлось</li>';
}

function rowHTML(w, day) {
  const card = state.cards[w.id];
  const st = srs.status(card);
  return `
    <li class="word-row" data-id="${esc(w.id)}">
      <button class="row-main" type="button" data-action="toggle">
        <span class="row-text">
          <span class="row-word">${esc(w.w)}</span>
          <span class="row-tr">${esc(w.tr)}</span>
        </span>
        <span class="pill ${st}">${STATUS_LABEL[st]}</span>
      </button>
      <div class="row-details" hidden>
        <div class="answer-head">
          <p class="ipa">${esc(w.t)}</p>
          <button class="play small" type="button" data-play="0" aria-label="Послушать слово">${PLAY_ICON}</button>
        </div>
        ${examplesHTML(w, false)}
        ${st === 'new' ? '' : `<p class="hint">Следующее повторение: ${srs.formatDue(card.due, day)}.</p>`}
      </div>
    </li>`;
}

function onListClick(e) {
  const row = e.target.closest('.word-row');
  const w = row && byId.get(row.dataset.id);
  if (!w) return;
  const play = e.target.closest('[data-play]');
  if (play) {
    playClip(w, Number(play.dataset.play));
    return;
  }
  if (e.target.closest('[data-action="toggle"]')) {
    const details = $('.row-details', row);
    details.hidden = !details.hidden;
  }
}

// ---------- Настройки и копия ----------

function renderSettings() {
  for (const seg of $$('.seg')) {
    const value = String(state.settings[seg.dataset.setting]);
    for (const b of $$('button', seg)) b.classList.toggle('active', b.dataset.value === value);
  }
  $('#autoplay').checked = Boolean(state.settings.autoplay);
  $('#backup-info').textContent =
    state.lastBackup != null ? `Последняя копия: ${fmtDay(state.lastBackup)}.` : 'Копий пока не было.';
  const n = wordList().length;
  $('#about-info').textContent = n
    ? `Сейчас в приложении ${n} ${srs.plural(n, 'слово', 'слова', 'слов')}.`
    : 'Список слов ещё не загрузился.';
}

function onSegClick(e) {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  const key = e.currentTarget.dataset.setting;
  state.settings[key] = key === 'newPerDay' ? Number(b.dataset.value) : b.dataset.value;
  saveState();
  renderSettings();
}

function backupFile() {
  const { knownIds, ...rest } = state;
  const payload = { app: 'slova', format: 1, exportedAt: new Date().toISOString(), state: rest };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `slova-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  return new File([JSON.stringify(payload)], name, { type: 'application/json' });
}

// На телефоне — меню «Поделиться» (в «Файлы» или себе в Telegram), на компьютере — обычное скачивание.
async function backup() {
  const file = backupFile();
  try {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Слова — копия прогресса' });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Не получилось сохранить копию');
    return;
  }
  state.lastBackup = srs.today();
  saveState();
  renderView(currentView);
  toast('Копия сохранена');
}

async function restore(file) {
  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch {
    // ниже скажем, что файл не тот
  }
  if (!data || data.app !== 'slova' || !data.state || typeof data.state.cards !== 'object') {
    toast('Это не файл копии «Слов»');
    return;
  }
  const when = data.exportedAt
    ? new Date(data.exportedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : 'неизвестной даты';
  const n = Object.keys(data.state.cards).length;
  const question = `Заменить текущий прогресс копией от ${when}? В копии ${n} ${srs.plural(n, 'слово', 'слова', 'слов')} с прогрессом.`;
  if (!window.confirm(question)) return;
  const base = defaultState();
  state = { ...base, ...data.state, settings: { ...base.settings, ...data.state.settings }, knownIds: state.knownIds };
  saveState();
  renderView(currentView);
  toast('Прогресс восстановлен');
}

// ---------- Запуск ----------

function bindEvents() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) show(go.dataset.go);
  });
  $('#start-btn').addEventListener('click', startSession);
  $('#exit-btn').addEventListener('click', () => {
    session = null;
    stopAudio();
    show('home');
  });
  $('#reveal-btn').addEventListener('click', reveal);
  $('#grade-btns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) answer(Number(b.dataset.grade));
  });
  $('#flash').addEventListener('click', onCardClick);
  $('#search').addEventListener('input', renderList);
  $('#filter-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    listFilter = chip.dataset.filter;
    renderList();
  });
  $('#word-list').addEventListener('click', onListClick);
  for (const seg of $$('.seg')) seg.addEventListener('click', onSegClick);
  $('#autoplay').addEventListener('change', (e) => {
    state.settings.autoplay = e.target.checked;
    saveState();
  });
  $('#backup-btn').addEventListener('click', backup);
  $('#banner-backup-btn').addEventListener('click', backup);
  $('#restore-btn').addEventListener('click', () => $('#restore-file').click());
  $('#restore-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) restore(file);
  });
  document.addEventListener('keydown', onKey);
  document.addEventListener('touchend', unlockAudio, { capture: true, passive: true });
  document.addEventListener('click', unlockAudio, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshWords();
  });
}

bindEvents();
show('home');
refreshWords();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Офлайн-режим не включился', err));
}
navigator.storage?.persist?.().catch(() => {});
