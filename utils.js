// Чистые функции без доступа к состоянию и DOM.
window.FA = window.FA || {};

FA.LETTER_RE = {
  en: /^[a-z]$/i,
  ru: /^[а-я]$/i
};

FA.STRIP_RE = {
  en: /[^a-z_]/gi,
  ru: /[^а-я_]/gi
};

FA.isLetter = function (ch, lang) {
  return FA.LETTER_RE[lang].test(ch);
};

// Ключ символа в таблицах частот: буква в нижнем регистре, '_' как есть, иначе null.
FA.symbolKey = function (ch, lang) {
  if (FA.isLetter(ch, lang)) return ch.toLowerCase();
  if (ch === '_') return '_';
  return null;
};

FA.displayChar = function (s) {
  if (s === ' ') return '_';
  return s.toUpperCase();
};

FA.formatPct = function (value) {
  return (value * 100).toFixed(2) + '%';
};

// Оставляет в тексте только буквы выбранного языка и '_'.
FA.cleanCipherText = function (raw, lang) {
  return raw.replace(FA.STRIP_RE[lang], '');
};

// Возвращает { символ: доля } для всего текста.
FA.computeFreq = function (text, lang) {
  const counts = {};
  let total = 0;
  for (const ch of text) {
    const key = FA.symbolKey(ch, lang);
    if (key === null) continue;
    counts[key] = (counts[key] || 0) + 1;
    total++;
  }
  const freq = {};
  for (const k in counts) freq[k] = counts[k] / total;
  return freq;
};

// Таблица частот -> строки по 3 пары (символ, частота), по убыванию частоты.
// Каждая строка — плоский массив из 6 ячеек { symbol, text }; пустые ячейки: symbol === null.
FA.freqRows = function (freqObj, pairsPerRow) {
  pairsPerRow = pairsPerRow || 3;
  const entries = Object.entries(freqObj).sort((a, b) => b[1] - a[1]);
  const rows = [];
  for (let i = 0; i < entries.length; i += pairsPerRow) {
    const row = [];
    for (let j = 0; j < pairsPerRow; j++) {
      const entry = entries[i + j];
      if (entry) {
        row.push({ symbol: entry[0], text: FA.displayChar(entry[0]) });
        row.push({ symbol: entry[0], text: FA.formatPct(entry[1]) });
      } else {
        row.push({ symbol: null, text: '' }, { symbol: null, text: '' });
      }
    }
    rows.push(row);
  }
  return rows;
};

FA.fmt = function (value) {
  return value === null || value === undefined ? '—' : value.toFixed(4);
};

// I_M: индекс совпадений источника текстов по эталонной таблице (частоты нормируются к сумме 1).
FA.sourceIndex = function (refFreq) {
  const values = Object.values(refFreq);
  const total = values.reduce((s, v) => s + v, 0);
  return values.reduce((s, v) => s + (v / total) * (v / total), 0);
};

// Индекс совпадений: sum n_i (n_i - 1) / (n (n - 1)). Для n < 2 не определён.
FA.indexOfCoincidence = function (keys) {
  const n = keys.length;
  if (n < 2) return null;
  const counts = {};
  for (const k of keys) counts[k] = (counts[k] || 0) + 1;
  let sum = 0;
  for (const k in counts) sum += counts[k] * (counts[k] - 1);
  return sum / (n * (n - 1));
};

// Средний индекс совпадений по l группам: символ с номером i попадает в группу i mod l.
FA.groupedIndex = function (keys, l) {
  const groups = Array.from({ length: l }, () => []);
  keys.forEach((k, i) => groups[i % l].push(k));
  const ics = groups.map(FA.indexOfCoincidence).filter(v => v !== null);
  return ics.length ? ics.reduce((s, v) => s + v, 0) / ics.length : null;
};

// Параметры проверки «это шифр Вижинера?»: RI_A, I_M, I_C, длина ключа по формуле (4),
// таблица I_C(l) для l = 1..maxL и вывод.
FA.vigenereReport = function (text, lang, refFreq, maxL) {
  const keys = [];
  for (const ch of text) {
    const k = FA.symbolKey(ch, lang);
    if (k !== null) keys.push(k);
  }
  const n = keys.length;
  // Алфавит A: буквы языка и '_' (пробел есть во всех алфавитах).
  const alphabetSize = Object.keys(refFreq).length;
  const ri = 1 / alphabetSize;
  const im = FA.sourceIndex(refFreq);
  const ic = FA.indexOfCoincidence(keys);

  const report = {
    n, alphabetSize, ri, im, ic,
    lExact: null, lAsym: null, threshold: ri + (im - ri) / 2,
    rows: [], candidate: null, verdict: 'unclear', tooShort: ic === null
  };
  if (report.tooShort) return report;

  const denom = n * (ic - ri) + (im - ic);
  if (denom > 0) report.lExact = n * (im - ri) / denom;
  if (ic > ri) report.lAsym = (im - ri) / (ic - ri);

  const limit = Math.max(1, Math.min(maxL, Math.floor(n / 2)));
  for (let l = 1; l <= limit; l++) {
    const value = FA.groupedIndex(keys, l);
    if (value === null) continue;
    report.rows.push({ l, ic: value, candidate: false, width: 0 });
  }
  const scale = Math.max(im, ...report.rows.map(r => r.ic));
  report.rows.forEach(r => { r.width = Math.round(r.ic / scale * 100); });

  const first = report.rows.find(r => r.ic >= report.threshold);
  if (first) {
    first.candidate = true;
    report.candidate = first.l;
    report.verdict = first.l === 1 ? 'mono' : 'vigenere';
  }
  return report;
};

// ---------- Подбор ключа Вижинера ----------
// Алфавит A = FA.ALPHABETS[lang]; номер символа — его значение. Шифр: c = (p + k) mod |A|.

FA.formatSignedPct = function (value) {
  return (value >= 0 ? '+' : '') + (value * 100).toFixed(2) + '%';
};

FA.normalizeFreq = function (freq) {
  const total = Object.values(freq).reduce((s, v) => s + v, 0);
  const out = {};
  for (const k in freq) out[k] = freq[k] / total;
  return out;
};

FA.indexMap = function (lang) {
  const map = {};
  FA.ALPHABETS[lang].forEach((s, i) => { map[s] = i; });
  return map;
};

// Текст -> массив символов алфавита (буквы в нижнем регистре и '_').
FA.textSymbols = function (text, lang) {
  const out = [];
  for (const ch of text) {
    const k = FA.symbolKey(ch, lang);
    if (k !== null) out.push(k);
  }
  return out;
};

// Группа j (с нуля) = символы на позициях j, j + l, j + 2l, ...
FA.splitGroups = function (symbols, l) {
  const groups = Array.from({ length: l }, () => []);
  symbols.forEach((s, i) => groups[i % l].push(s));
  return groups;
};

// Анализ одной группы (это шифр Цезаря со сдвигом k):
//  freq[i]       — доля символа с номером i в группе;
//  suggested     — сдвиг, при котором самый частый символ группы переходит в '_';
//  mismatch[s]   — несовпадение с эталоном при сдвиге s: сумма |частота - эталон| / 2 (0 = идеально);
//  best          — три сдвига с наименьшим несовпадением.
FA.analyzeGroup = function (groupSymbols, lang) {
  const alphabet = FA.ALPHABETS[lang];
  const N = alphabet.length;
  const idx = FA.indexMap(lang);
  const ref = FA.normalizeFreq(FA.REF_FREQS[lang]);
  const n = groupSymbols.length;

  const counts = new Array(N).fill(0);
  for (const s of groupSymbols) counts[idx[s]]++;
  const freq = counts.map(c => (n ? c / n : 0));

  // При сдвиге s символ с номером i расшифровывается в (i - s) mod N.
  const mismatch = [];
  for (let s = 0; s < N; s++) {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += Math.abs(freq[i] - ref[alphabet[(i - s + N) % N]]);
    mismatch.push(sum / 2);
  }

  let top = 0;
  for (let i = 1; i < N; i++) if (counts[i] > counts[top]) top = i;
  const suggested = (top - idx['_'] + N) % N;

  const best = mismatch
    .map((m, shift) => ({ shift, mismatch: m }))
    .sort((a, b) => a.mismatch - b.mismatch)
    .slice(0, 3);

  return { n, counts, freq, mismatch, suggested, best };
};

// Строки таблицы группы при выбранном сдвиге: шифрсимвол -> расшифрованный, частота в группе,
// эталонная частота расшифрованного символа (нормирована), разница.
FA.groupTable = function (analysis, lang, shift, limit) {
  const alphabet = FA.ALPHABETS[lang];
  const N = alphabet.length;
  const ref = FA.normalizeFreq(FA.REF_FREQS[lang]);
  const rows = [];
  for (let i = 0; i < N; i++) {
    if (!analysis.counts[i]) continue;
    const plain = alphabet[(i - shift + N) % N];
    rows.push({
      cipher: alphabet[i],
      plain,
      freq: analysis.freq[i],
      ref: ref[plain],
      diff: analysis.freq[i] - ref[plain]
    });
  }
  rows.sort((a, b) => b.freq - a.freq);
  return rows.slice(0, limit || 10);
};

// Расшифровка: p_i = (c_i - k_(i mod l)) mod |A|. Возвращает массив символов.
FA.vigenereDecrypt = function (symbols, shifts, lang) {
  const alphabet = FA.ALPHABETS[lang];
  const N = alphabet.length;
  const idx = FA.indexMap(lang);
  const l = shifts.length;
  return symbols.map((s, i) => alphabet[(idx[s] - shifts[i % l] + N * 2) % N]);
};

// ---------- Подсветка при наведении ----------
// Намеренно НЕ через реактивное состояние Alpine: пока «текущий символ под курсором» лежал в данных,
// каждое наведение заново считало привязки :class всех N букв текста. И не через CSS :has(): на большом
// тексте браузер переоценивает все элементы с data-k (на 20 000 букв это +150 мс на каждое движение).
// Здесь класс переключается напрямую у совпадающих элементов — их обычно несколько десятков.
// Состояние (что подсвечено сейчас) хранится в root.dataset.hl<attr>.
FA.setHighlight = function (root, attr, value, selectorFor) {
  if (!root) return;
  const key = 'hl' + attr;
  const next = value === null || value === undefined ? '' : String(value);
  if ((root.dataset[key] || '') === next) return;
  root.dataset[key] = next;
  const cls = 'crypto__hl-' + attr;
  root.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
  if (next !== '') root.querySelectorAll(selectorFor(next)).forEach(el => el.classList.add(cls));
};

// Буква текста: подсвечивает все элементы с тем же data-k — буквы текста и ячейки таблицы частот.
FA.highlightSymbol = function (root, symbol) {
  FA.setHighlight(root, 'k', symbol, v => `[data-k="${v}"]`);
};

// Группа Вижинера: подсвечивает позиции группы в расшифрованном тексте.
FA.highlightGroup = function (root, group) {
  FA.setHighlight(root, 'g', group, v => `.crypto__dec[data-g="${v}"]`);
};

// Кандидаты на замену: все символы алфавита, отсортированные по близости частоты.
// Лучшее совпадение — ближайший из ещё не занятых.
FA.replacementCandidates = function (alphabet, refFreq, curFreq, takenSet) {
  const sorted = alphabet.slice().sort(
    (a, b) => Math.abs(refFreq[a] - curFreq) - Math.abs(refFreq[b] - curFreq)
  );
  const best = sorted.find(s => !takenSet.has(s)) || null;
  return {
    best,
    items: sorted.map(symbol => ({
      symbol,
      freq: refFreq[symbol],
      taken: takenSet.has(symbol),
      best: symbol === best
    }))
  };
};
