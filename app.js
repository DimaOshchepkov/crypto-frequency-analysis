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
    hovered: null,      // символ под курсором
    modalSymbol: null,  // символ, для которого открыто окно замены
    vig: null,          // отчёт «это Вижинер?» (null — окно закрыто)

    init() {
      this.$watch('lang', () => {
        document.documentElement.lang = this.lang;
        document.title = this.t('pageTitle');
        this.closeModal();
        this.closeVig();
        this.clearMapping();
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

    // --- хелперы для шаблона ---
    show: FA.displayChar,
    pct: FA.formatPct,
    fmt: FA.fmt,

    // --- действия ---
    analyze() {
      const cleaned = FA.cleanCipherText(this.input, this.lang);
      if (!cleaned.trim()) {
        alert(this.t('emptyText'));
        return;
      }
      this.cipherText = cleaned;
      this.cipherFreq = FA.computeFreq(cleaned, this.lang);
      this.clearMapping();
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
