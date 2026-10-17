// Alpine-компонент приложения. Состояние и действия; чистая логика — в utils.js.
document.addEventListener('alpine:init', () => {
  Alpine.data('freqApp', () => ({
    // --- состояние ---
    lang: 'en',
    input: '',
    cipherText: '',
    cipherFreq: {},
    mapping: {},        // зашифрованный символ -> выбранная замена
    history: [],        // стек { from, to } для отмены
    modalSymbol: null,  // символ, для которого открыто окно замены
    vig: null,          // отчёт «это Вижинер?» (null — окно закрыто)

    // Подбор ключа Вижинера
    vigL: '',           // введённое число групп l
    lHint: null,        // подсказка по l из расчёта индекса совпадений
    split: null,        // { l, symbols, groups } после разбиения на группы
    shifts: [],         // выбранный сдвиг (номер буквы ключа) для каждой группы

    init() {
      this.$watch('lang', () => {
        document.documentElement.lang = this.lang;
        document.title = this.t('pageTitle');
        this.closeModal();
        this.closeVig();
        this.clearMapping();
        this.resetSplit();
        this.lHint = null;
        this.vigL = '';
      });
    },

    // --- вычисляемые значения ---
    t(key, params) {
      return FA.t(this.lang, key, params);
    },

    get alphabet() { return Object.keys(FA.REF_FREQS[this.lang]); },
    get refFreq() { return FA.REF_FREQS[this.lang]; },

    get refRows() { return FA.freqRows(this.refFreq); },
    get curRows() { return FA.freqRows(this.cipherFreq); },

    get mappingList() {
      return Object.entries(this.mapping).map(([from, to]) => ({ from, to }));
    },

    // Текст как последовательность токенов: key === null — не-буква, выводится как есть.
    get tokens() {
      return Array.from(this.cipherText, ch => ({ ch, key: FA.symbolKey(ch, this.lang) }));
    },

    get modalData() {
      if (this.modalSymbol === null) return null;
      const curFreq = this.cipherFreq[this.modalSymbol] || 0;
      const taken = new Set(Object.values(this.mapping));
      const { best, items } = FA.replacementCandidates(this.alphabet, this.refFreq, curFreq, taken);
      return { curFreq, best, items };
    },

    // Формулы с подставленными числами для окна «это Вижинер?».
    get vigLines() {
      const v = this.vig;
      if (!v || v.tooShort) return [];
      const f = FA.fmt;
      const na = this.t('vigNA');
      return [
        {
          id: 'vigRi',
          general: 'RI_A = 1 / |A|',
          calc: `= 1 / ${v.alphabetSize}`,
          result: `= ${f(v.ri)}`
        },
        {
          id: 'vigIm',
          general: 'I_M = Σ pᵢ²',
          calc: '',
          result: `= ${f(v.im)}`
        },
        {
          id: 'vigIc',
          general: 'I_C = Σ nᵢ(nᵢ − 1) / (n(n − 1))',
          calc: `n = ${v.n}`,
          result: `= ${f(v.ic)}`
        },
        {
          id: 'vigLen',
          general: 'l = n·(I_M − RI_A) / (n·(I_C − RI_A) + (I_M − I_C))',
          calc: `= ${v.n}·(${f(v.im)} − ${f(v.ri)}) / (${v.n}·(${f(v.ic)} − ${f(v.ri)}) + (${f(v.im)} − ${f(v.ic)}))`,
          result: v.lExact === null ? `— (${na})` : `≈ ${v.lExact.toFixed(2)}`
        },
        {
          id: 'vigLenLim',
          general: 'l → (I_M − RI_A) / (I_C − RI_A)',
          calc: `= (${f(v.im)} − ${f(v.ri)}) / (${f(v.ic)} − ${f(v.ri)})`,
          result: v.lAsym === null ? `— (${na})` : `≈ ${v.lAsym.toFixed(2)}`
        }
      ];
    },

    get vigVerdictText() {
      const v = this.vig;
      if (!v) return '';
      if (v.verdict === 'mono') return this.t('vigVerdictMono');
      if (v.verdict === 'vigenere') return this.t('vigVerdictVig', { l: v.candidate });
      return this.t('vigVerdictUnclear');
    },

    // Алфавит Вижинера: буквы по порядку, '_' последним; номер символа = его сдвиг.
    get orderedAlphabet() { return FA.ALPHABETS[this.lang]; },

    // Ключ строкой: буква на каждую группу.
    get keyString() {
      return this.shifts.map(s => FA.displayChar(this.orderedAlphabet[s])).join('');
    },

    // Расшифрованный текст как массив символов.
    get decrypted() {
      if (!this.split) return [];
      return FA.vigenereDecrypt(this.split.symbols, this.shifts, this.lang);
    },

    get vigHintText() {
      const h = this.lHint;
      if (!h) return '';
      if (!h.candidate) return this.t('vigHintNone');
      const exact = h.lExact === null ? '—' : h.lExact.toFixed(2);
      return this.t('vigHint', { l: h.candidate, exact });
    },

    // --- хелперы для шаблона ---
    show: FA.displayChar,
    pct: FA.formatPct,
    signed: FA.formatSignedPct,
    fmt: FA.fmt,

    groupTable(group, j) {
      return FA.groupTable(group, this.lang, this.shifts[j], 10);
    },

    // --- действия ---
    analyze() {
      const cleaned = FA.cleanCipherText(this.input, this.lang);
      if (!cleaned.trim()) {
        alert(this.t('emptyText'));
        return;
      }
      FA.highlightSymbol(this.$root, null); // элементы текста пересоздаются — сбрасываем подсветку
      this.cipherText = cleaned;
      this.cipherFreq = FA.computeFreq(cleaned, this.lang);
      this.clearMapping();
      this.resetSplit();

      // Подсказка для l: считаем так же, как в окне «это Вижинер?».
      const report = FA.vigenereReport(cleaned, this.lang, this.refFreq, 20);
      this.lHint = report.tooShort ? null : { candidate: report.candidate, lExact: report.lExact };
      this.vigL = this.lHint && this.lHint.candidate ? String(this.lHint.candidate) : '';
    },

    // --- подбор ключа Вижинера ---
    resetSplit() {
      this.split = null;
      this.shifts = [];
    },

    splitIntoGroups() {
      if (!this.cipherText) {
        alert(this.t('vigNeedText'));
        return;
      }
      const symbols = FA.textSymbols(this.cipherText, this.lang);
      if (symbols.length < 2) {
        alert(this.t('vigTooShort'));
        return;
      }
      const max = Math.min(40, Math.floor(symbols.length / 2));
      const l = parseInt(this.vigL, 10);
      if (!(l >= 1 && l <= max)) {
        alert(this.t('vigBadL', { max }));
        return;
      }
      FA.highlightGroup(this.$root, null);
      const groups = FA.splitGroups(symbols, l).map(g => FA.analyzeGroup(g, this.lang));
      this.split = { l, symbols, groups };
      // По умолчанию — сдвиг с лучшим совпадением по всей таблице: правило «самый частый → _»
      // иногда ошибается на коротких группах, оно остаётся отдельной подсказкой в карточке.
      this.shifts = groups.map(g => g.best[0].shift);
    },

    // Ввод ключа строкой: буква i задаёт сдвиг группы i. Нераспознанные символы пропускаются.
    setKey(str) {
      if (!this.split) return;
      const alphabet = this.orderedAlphabet;
      Array.from(str.toLowerCase()).slice(0, this.split.l).forEach((ch, j) => {
        const s = alphabet.indexOf(ch);
        if (s >= 0) this.shifts[j] = s;
      });
    },

    setReplace(from, to) {
      this.history.push({ from, to: this.mapping[from] || null });
      this.mapping[from] = to;
    },

    undoReplace(from) {
      for (let i = this.history.length - 1; i >= 0; i--) {
        if (this.history[i].from === from) {
          const prev = this.history[i].to;
          this.history.splice(i, 1);
          if (prev === null) delete this.mapping[from];
          else this.mapping[from] = prev;
          return;
        }
      }
      delete this.mapping[from];
    },

    clearMapping() {
      this.mapping = {};
      this.history = [];
    },

    resetAll() {
      if (confirm(this.t('confirmReset'))) this.clearMapping();
    },

    openModal(symbol) { this.modalSymbol = symbol; },

    // Клик по тексту: один обработчик на контейнере, символ берём из data-k нажатого элемента.
    openFromEvent(event) {
      const el = event.target;
      const symbol = el && el.dataset ? el.dataset.k : undefined;
      if (symbol !== undefined) this.openModal(symbol);
    },

    // Подсветка всех вхождений при наведении — без реактивного состояния, см. FA.setHighlight.
    hoverText(event) {
      const el = event.target;
      const symbol = el && el.dataset ? el.dataset.k : undefined;
      FA.highlightSymbol(this.$root, symbol === undefined ? null : symbol);
    },
    leaveText() { FA.highlightSymbol(this.$root, null); },
    highlightGroup(j) { FA.highlightGroup(this.$root, j); },
    closeModal() { this.modalSymbol = null; },

    openVig() {
      if (!this.cipherText) {
        alert(this.t('vigNeedText'));
        return;
      }
      this.vig = FA.vigenereReport(this.cipherText, this.lang, this.refFreq, 20);
    },
    closeVig() { this.vig = null; },

    pickReplacement(item) {
      if (item.taken) return;
      this.setReplace(this.modalSymbol, item.symbol);
      this.closeModal();
    },

    undoFromModal() {
      this.undoReplace(this.modalSymbol);
      this.closeModal();
    }
  }));
});
