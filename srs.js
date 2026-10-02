// Расписание повторений для «Слов». Чистые функции без DOM — их проверяют тесты.

export const AGAIN = 0;
export const HARD = 1;
export const GOOD = 2;

export const DAY_MS = 86400000;
export const DEFAULT_EASE = 2.3; // «Помню» подряд даёт 1 → 3 → 7 → 16 → 37 дней
export const MIN_EASE = 1.3;
export const MAX_IVL = 365;
export const KNOWN_IVL = 21; // с такого интервала слово считаем выученным

// Номер дня по местному календарю: часовой пояс и летнее время дни не сдвигают.
export function dayNumber(date = new Date()) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export function today() {
  return dayNumber(new Date());
}

export function dateOfDay(day) {
  const d = new Date(day * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function newCard() {
  return { ivl: 0, ease: DEFAULT_EASE, reps: 0, lapses: 0, seen: 0, due: null, intro: null, last: null };
}

const round2 = (x) => Math.round(x * 100) / 100;

// Ответ на карточку → новое состояние карточки. ivl — интервал в днях, 0 значит «ещё раз сегодня».
export function schedule(card, grade, day) {
  const c = { ...newCard(), ...card };
  const firstAnswer = c.seen === 0;
  if (c.intro == null) c.intro = day;
  c.seen += 1;
  c.last = day;

  if (grade === AGAIN) {
    if (c.reps > 0) {
      c.lapses += 1;
      c.ease = Math.max(MIN_EASE, round2(c.ease - 0.2));
    }
    c.ivl = 0;
    c.due = day;
    return c;
  }

  if (grade === HARD) {
    c.ivl = c.ivl === 0 ? 1 : Math.max(1, Math.round(c.ivl * 1.2));
    c.ease = Math.max(MIN_EASE, round2(c.ease - 0.15));
  } else {
    if (firstAnswer) c.ivl = 3; // слово знакомо с первого показа
    else if (c.ivl === 0) c.ivl = 1;
    else if (c.ivl === 1) c.ivl = 3;
    else c.ivl = Math.round(c.ivl * c.ease);
    if (c.ease < DEFAULT_EASE) c.ease = Math.min(DEFAULT_EASE, round2(c.ease + 0.05));
  }

  c.ivl = Math.min(MAX_IVL, c.ivl);
  c.reps += 1;
  c.due = day + c.ivl;
  return c;
}

// Очередь дня: сначала все повторения (самые просроченные первыми), потом новые слова в пределах дневной нормы.
export function planToday(words, cards, settings, day) {
  const due = [];
  const fresh = [];
  let introducedToday = 0;
  for (const w of words) {
    const c = cards[w.id];
    if (!c || c.intro == null) continue;
    if (c.intro === day) introducedToday += 1;
    if (c.due != null && c.due <= day) due.push(w.id);
  }
  const room = Math.max(0, (settings?.newPerDay ?? 8) - introducedToday);
  for (const w of words) {
    if (fresh.length >= room) break;
    const c = cards[w.id];
    if (!c || c.intro == null) fresh.push(w.id);
  }
  due.sort((a, b) => cards[a].due - cards[b].due || cards[a].ivl - cards[b].ivl);
  return { due, fresh, introducedToday };
}

// Направление карточки. Новое слово всегда англ → рус. В смешанном режиме дальше чередуем:
// каждое второе повторение рус → англ, его проговаривают вслух.
export function direction(card, settings) {
  const c = card || newCard();
  if (!c.seen) return 'en-ru';
  const mode = settings?.direction || 'mixed';
  if (mode !== 'mixed') return mode;
  return c.reps % 2 === 1 ? 'ru-en' : 'en-ru';
}

export function status(card) {
  if (!card || card.intro == null) return 'new';
  return card.ivl >= KNOWN_IVL ? 'known' : 'learning';
}

export function stats(words, cards) {
  const s = { new: 0, learning: 0, known: 0, total: words.length };
  for (const w of words) s[status(cards[w.id])] += 1;
  return s;
}

export function dueCount(words, cards, day) {
  let n = 0;
  for (const w of words) {
    const c = cards[w.id];
    if (c && c.intro != null && c.due != null && c.due <= day) n += 1;
  }
  return n;
}

// Сколько дней подряд были занятия. Если сегодня занятий ещё не было, считаем до вчера.
export function streak(log, day) {
  let d = log[day]?.r > 0 ? day : day - 1;
  let n = 0;
  while (log[d]?.r > 0) {
    n += 1;
    d -= 1;
  }
  return n;
}

export function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

export function formatIvl(days) {
  if (days <= 0) return 'ещё раз';
  if (days < 30) return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  if (days < 365) return `${Math.round(days / 30)} мес`;
  return '1 год';
}

export function formatDue(due, day) {
  const d = due - day;
  if (d <= 0) return 'сегодня';
  if (d === 1) return 'завтра';
  return `через ${formatIvl(d)}`;
}
