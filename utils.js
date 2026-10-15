// Чистые функции без доступа к состоянию и DOM.
window.FA = window.FA || {};

FA.LETTER_RE = {
  en: /^[a-z]$/i,
  ru: /^[а-яё]$/i
};

FA.STRIP_RE = {
  en: /[^a-z_]/gi,
  ru: /[^а-яё_]/gi
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
  // Алфавит A: буквы языка, а '_' входит в него только если встречается в тексте.
  const hasSpace = keys.includes('_');
  const alphabet = {};
  for (const k in refFreq) if (k !== '_' || hasSpace) alphabet[k] = refFreq[k];
  const alphabetSize = Object.keys(alphabet).length;
  const ri = 1 / alphabetSize;
  const im = FA.sourceIndex(alphabet);
  const ic = FA.indexOfCoincidence(keys);

  const report = {
    n, alphabetSize, hasSpace, ri, im, ic,
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
