/* ============================================================
   HUB.OS — modules/cashflow.js
   CashFlow (Wallet.OS) — Personal Finance Tracker
   Data model mirrors "CashDuck Tracking.xlsx":
     - Monthly Summary with net worth, income & expense breakdowns
     - Income categories: Lương, Kinh doanh/đầu tư, Thu nhập bị động, Thu nhập khác
     - Expense categories: Nhà ở, Ăn uống, Di chuyển, Tiêu dùng thiết yếu,
       Tiêu dùng khác, Doodad, Cho đi, Phát triển bản thân, Chi phí khác
     - Balance snapshots (Tiền mặt + Thẻ ngân hàng + Tiết kiệm + Đầu tư + Cho mượn - Nợ)
     - Export to .xlsx for end-of-month reporting
   ============================================================ */

const cashflowModule = (function () {
  'use strict';

  // ── Constants ──
  const SAVE_DELAY  = 400;

  // ── Category definitions (mirrors CashDuck Tracking.xlsx) ──
  const INCOME_CATEGORIES = [
    { id: 'luong',             name: 'Lương',                nameVI: 'Lương' },
    { id: 'kinh-doanh',        name: 'Kinh doanh, đầu tư',   nameVI: 'Kinh doanh, đầu tư' },
    { id: 'thu-nhap-bi-dong',  name: 'Thu nhập bị động',     nameVI: 'Thu nhập bị động' },
    { id: 'thu-nhap-khac',     name: 'Thu nhập khác',        nameVI: 'Thu nhập khác' }
  ];

  const EXPENSE_CATEGORIES = [
    { id: 'nha-o',                   name: 'Nhà ở',                    nameVI: 'Nhà ở' },
    { id: 'an-uong',                 name: 'Ăn uống',                  nameVI: 'Ăn uống' },
    { id: 'di-chuyen',               name: 'Di chuyển',                nameVI: 'Di chuyển' },
    { id: 'tieu-dung-thiet-yeu',     name: 'Tiêu dùng thiết yếu',      nameVI: 'Tiêu dùng thiết yếu' },
    { id: 'tieu-dung-khac',          name: 'Tiêu dùng khác',           nameVI: 'Tiêu dùng khác' },
    { id: 'doodad',                  name: 'Doodad',                   nameVI: 'Doodad' },
    { id: 'cho-di',                  name: 'Cho đi',                   nameVI: 'Cho đi' },
    { id: 'phat-trien-ban-than',     name: 'Phát triển bản thân',      nameVI: 'Phát triển bản thân' },
    { id: 'chi-phi-khac',            name: 'Chi phí khác',             nameVI: 'Chi phí khác' }
  ];

  // ── Balance account types ──
  const BALANCE_ACCOUNTS = [
    { id: 'tien-mat',       name: 'Tiền mặt',       nameVI: 'Tiền mặt' },
    { id: 'the-ngan-hang',  name: 'Thẻ ngân hàng',  nameVI: 'Thẻ ngân hàng' },
    { id: 'tiet-kiem',      name: 'Tiết kiệm',      nameVI: 'Tiết kiệm' },
    { id: 'dau-tu',         name: 'Đầu tư',         nameVI: 'Đầu tư' },
    { id: 'cho-muon',       name: 'Cho mượn',       nameVI: 'Cho mượn' },
    { id: 'no',             name: 'Nợ',             nameVI: 'Nợ' }
  ];

  // ============================================================
  //   I18N DICTIONARY — All static UI strings for CashFlow
  // ============================================================

  var CASHFLOW_I18N = {
    en: {
      // Summary cards
      netWorthLabel:    'NET WORTH',
      netWorthSub:      'ALL-TIME NET WORTH',
      savingsLabel:     'SAVINGS / INVESTMENTS',
      savingsSub:       'SAVINGS & INVESTMENTS',
      incomeLabel:      'INCOME',
      incomeSub:        'TOTAL INCOME',
      expenseLabel:     'EXPENSE',
      expenseSub:       'TOTAL EXPENSE',

      // Chart
      chartTitle:       'INCOME VS EXPENSE',
      chartIncome:      'Income',
      chartExpense:     'Expense',
      chartDay:         'Day',
      chartMonth:       'Month',
      chartYear:        'Year',

      // Action bar
      addTx:            'Add Transaction',
      importXlsx:       'Import .xlsx',
      exportXlsx:       'Export to .xlsx',

      // Ledger
      categoryToggle:   '📊 Detailed Stats',
      categoryTitle:    'CATEGORY BREAKDOWN',
      breakdownIncome:  '⬆ Income',
      breakdownExpense: 'Expense',

      // Table
      thDate:           'Date',
      thDesc:           'Description',
      thCat:            'Category',
      thAmt:            'Amount',
      noCategoryData:   'No category data for this month.',
      noTxYet:          'No transactions yet.',
      noTxHint:         'Tap <strong>Add Transaction</strong> to start tracking.',
      txCount_zero:     '0 entries',
      txCount_one:      '1 entry',
      txCount_other:    'entries',

      // Modal
      modalTitle:       'New Transaction',
      tabExpense:       'Expense',
      tabIncome:        'Income',
      labelAmount:      'Amount (VND)',
      labelDate:        'Date',
      labelDesc:        'Description',
      labelCategory:    'Category',
      placeholderDesc:  'e.g. Grab, coffee, books...',
      btnCancel:        'Cancel',
      btnSave:          'Save',

      // Import
      importNoRows:     'No valid rows found in the file (all',
      importRowsInvalid: 'rows were invalid).',
      importSuccess:    'Imported',
      importSuccess1:   'transactions (replaced all existing data).',
      importSkipped:    'Skipped',
      importInvalidRows: 'invalid rows.',
      importSkippedSheets: 'Skipped sheets:',
      importFailed:     'Import failed — check console for details.',
      importNotLoaded:  'XLSX library not loaded.'
    },

    vi: {
      // Summary cards
      netWorthLabel:    'TỔNG TÀI SẢN',
      netWorthSub:      'TÀI SẢN HIỆN CÓ',
      savingsLabel:     'TIẾT KIỆM / ĐẦU TƯ',
      savingsSub:       'TIẾT KIỆM & ĐẦU TƯ',
      incomeLabel:      'THU NHẬP',
      incomeSub:        'TỔNG THU NHẬP',
      expenseLabel:     'CHI PHÍ',
      expenseSub:       'TỔNG CHI PHÍ',

      // Chart
      chartTitle:       'THU NHẬP VÀ CHI PHÍ',
      chartIncome:      'Thu Nhập',
      chartExpense:     'Chi Phí',
      chartDay:         'Ngày',
      chartMonth:       'Tháng',
      chartYear:        'Năm',

      // Action bar
      addTx:            'Thêm Giao Dịch',
      importXlsx:       'Nhập dữ liệu',
      exportXlsx:       'Xuất file Excel',

      // Ledger
      categoryToggle:   '📊 Thống kê chi tiết',
      categoryTitle:    'HẠNG MỤC CHI TIÊU',
      breakdownIncome:  '⬆ Thu Nhập',
      breakdownExpense: 'Chi Phí',

      // Table
      thDate:           'Ngày',
      thDesc:           'Mô tả',
      thCat:            'Hạng mục',
      thAmt:            'Số tiền',
      noTransData:      'Không có dữ liệu hạng mục trong tháng này.',
      noTransYet:       'Chưa có giao dịch nào.',
      noTransHint:      'Nhấn <strong>Thêm Giao Dịch</strong> để bắt đầu theo dõi.',
      txCount_zero:     '0 mục',
      txCount_other:    'mục',

      // Modal
      modalTitle:       'Thêm Giao Dịch',
      tabExpense:      'Chi Phí',
      tabIncome:       'Thu Nhập',
      labelAmount:      'Số tiền (VND)',
      labelDate:        'Ngày',
      labelDesc:        'Mô tả',
      labelCategory:    'Hạng mục',
      placeholderDesc:  'VD: Bún bò, Grab, Sách Clean Code...',
      btnCancel:        'Hủy',
      btnSave:          'Lưu',

      // Import
      importNoRows:     'Không tìm thấy dòng dữ liệu hợp lệ (tất cả',
      importRowsInvalid: 'dòng không hợp lệ).',
      importSuccess:    'Đã nhập',
      importSuccess1:   'giao dịch (đã thay thế toàn bộ dữ liệu cũ).',
      importSkipped:    'Bỏ qua',
      importInvalidRows: 'dòng không hợp lệ.',
      importSkippedSheets: 'Bỏ qua sheet:',
      importFailed:     'Nhập thất bại — kiểm tra console để biết chi tiết.',
      importNotLoaded:  'Thư viện XLSX chưa được tải.'
    }
  };

  /**
   * getCFLang() — Read the current language from global app state or
   * localStorage. Falls back to 'vi'.
   */
  function _getCFLang() {
    // Try global app state first
    if (typeof app !== 'undefined' && app.getLanguage) {
      return app.getLanguage();
    }
    // Try the canonical setting key (written by app.js backup modal)
    var stored = null;
    try { stored = localStorage.getItem('hub_system_language'); } catch (_) {}
    if (stored === 'en' || stored === 'vi') return stored;
    // Legacy fallback keys
    try { stored = localStorage.getItem('hubos_lang'); } catch (_) {}
    if (stored === 'en' || stored === 'vi') return stored;
    try { stored = localStorage.getItem('hub_lang'); } catch (_) {}
    if (stored === 'en' || stored === 'vi') return stored;
    return 'vi';
  }

  /** Shortcut: get a translated string by key */
  function _t(key) {
    var lang = _getCFLang();
    var dict = CASHFLOW_I18N[lang] || CASHFLOW_I18N['vi'];
    return dict[key] || (CASHFLOW_I18N['vi'][key] || key);
  }

  // ── Private state ──
  let _container     = null;
  let _data          = null;   // { transactions: [], balanceSnapshots: [], startingBalance: 0 }
  let _netWorthOffset = 0;     // Cloud-synced manual override for net worth
  let _savingsBalance = 0;     // Cloud-synced manual override for savings/investments
  let _isDataLoaded  = false;
  let _sessionLoaded = false;  // Prevent re-fetch on tab switch
  let _isOfflineMode = false;  // CRITICAL: true when cloud unreachable + no local cache.
                               // Prevents auto-save of empty data over cloud truth.
  let _activeTab     = 'expense';  // 'expense' | 'income'
  let _currentMonth  = null;  // { year: 2026, month: 3 }
  let _overlay       = null;
  let _modal         = null;
  let _chart         = null;
  let _chartFilter   = 'month';  // 'day' | 'picker' | 'month' | 'year'

  // ── Bound handlers for cleanup ──
  let _boundKeydown = null;

  // ============================================================
  //   DEFAULT DATA
  // ============================================================

  function _defaultData() {
    return {
      startingBalance: 0,
      balanceSnapshots: [],  // { year, month, accountId, amount }
      transactions: []       // { id, type, amount, day, month, year, desc, category, createdAt }
    };
  }

  // ============================================================
  //   STORAGE — Cloud-first via HubDB (no localStorage fallback)
  // ============================================================

  /** Async load from HubDB.
   *
   *  ═══ SAFE INITIALIZATION LOGIC ═══
   *
   *  1. Firestore first (source of truth).
   *  2. If Firestore fails → IndexedDB (durable cache).
   *  3. If IndexedDB also empty/fails → localStorage.
   *  4. If EVERYTHING fails → set _isOfflineMode = true
   *     and DO NOT auto-save. An empty _defaultData()
   *     is held in memory for the UI, but it will NEVER
   *     be persisted automatically — only when the user
   *     explicitly adds a transaction or imports data.
   *
   *  Previously: load failed → _defaultData() → debounced
   *  persist wrote empty transactions array to cloud,
   *  wiping the user's data. This CANNOT happen anymore.
   */
  async function _loadData() {
    if (_sessionLoaded && _data) return;

    // ── 1. Try loading from HubDB (tiered: Firestore → IndexedDB → localStorage) ──
    var loaded = null;
    var cloudFailed = false;

    try {
      if (typeof HubDB !== 'undefined' && typeof HubDB.loadCashFlowData === 'function') {
        loaded = await HubDB.loadCashFlowData();

        // Detect if the load came from a fallback (not Firestore)
        // loadCashFlowData returns null only when ALL tiers are empty.
        // If it returns data, we don't know the source — that's fine,
        // we just need to know if data exists.
      }
    } catch (e) {
      cloudFailed = true;
      console.warn('[CashFlow] HubDB.loadCashFlowData threw:', e.message);
    }

    // ── 2. Initialize state based on load result ──
    if (loaded && Array.isArray(loaded.transactions)) {
      // Data found (from cloud, IndexedDB, or localStorage)
      _data = loaded;
      _ensureDefault();
      _isDataLoaded = true;
      _isOfflineMode = false;
      updateDashboardTotals();
    } else {
      // ═══ NO DATA FOUND ANYWHERE ═══
      // This is either:
      //   a) First-ever login (genuinely empty) — OR —
      //   b) Cloud unreachable AND no local cache (the data-loss bug)
      //
      // We CANNOT distinguish these two cases without a cloud round-trip.
      // The safe move: enter offline mode, show an empty ledger, and
      // NEVER auto-save. Only an explicit user action (Add Transaction,
      // Import) will break the seal and persist data.

      _isOfflineMode = true;
      _data = _defaultData();
      _ensureDefault();
      _isDataLoaded = true;
      _sessionLoaded = false; // allow one retry next time the tab activates

      console.warn('[CashFlow] ⚠️ ENTERED OFFLINE MODE — cloud unreachable, no local cache.');
      console.warn('[CashFlow]    Auto-save is DISABLED until user performs a write action.');
    }

    // ── 3. Load meta offsets (netWorth & savings) ──
    try {
      if (typeof HubDB !== 'undefined' && typeof HubDB.loadCashFlowMeta === 'function') {
        var meta = await HubDB.loadCashFlowMeta();
        if (meta) {
          _netWorthOffset = Number(meta.netWorthOffset) || 0;
          _savingsBalance = Number(meta.savingsBalance) || 0;
        }
      }
    } catch (_) {}

    _sessionLoaded = true;

    // ═══ Final render ═══
    if (loaded && Array.isArray(loaded.transactions)) {
      updateDashboardTotals();
    }
  }

  /** ═══ SAFE PERSIST: Never auto-save when in offline mode ═══
   *
   *  If _isOfflineMode is true and the data is empty (0 transactions),
   *  we REFUSE to persist — we can't distinguish "new user" from
   *  "browser restored tab before network came back." Persisting
   *  now would overwrite cloud data with an empty array.
   *
   *  The seal is broken when the user explicitly writes (add transaction
   *  or import). At that point _isOfflineMode flips off and persists
   *  are allowed.
   */
  async function _persist() {
    if (!_isDataLoaded) return;

    // ═══ GUARD: Offline-mode empty data = DO NOT SAVE ═══
    if (_isOfflineMode && _data && Array.isArray(_data.transactions) && _data.transactions.length === 0) {
      console.warn('[CashFlow] BLOCKED auto-save — offline mode, no transactions. Cloud data is protected.');
      return;
    }

    // Once the user has data, they've broken the seal — allow future saves
    if (_isOfflineMode && _data && Array.isArray(_data.transactions) && _data.transactions.length > 0) {
      _isOfflineMode = false;
    }

    try {
      if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowData === 'function') {
        await HubDB.saveCashFlowData(_data);
      }
    } catch (_) {}
  }

  /** Persist meta offsets (netWorthOffset + savingsBalance).
   *  Meta writes are lightweight — no offline guard needed. */
  async function _persistMeta() {
    try {
      if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
        await HubDB.saveCashFlowMeta({
          netWorthOffset: _netWorthOffset,
          savingsBalance: _savingsBalance
        });
      }
    } catch (_) {}
  }

  function _debouncedPersist() {
    if (typeof HubDebounce !== 'undefined') {
      HubDebounce.call('cashflow', _persist, SAVE_DELAY);
    } else {
      _persist();
    }
  }

  function _debouncedPersistMeta() {
    if (typeof HubDebounce !== 'undefined') {
      HubDebounce.call('cf-meta', _persistMeta, SAVE_DELAY);
    } else {
      _persistMeta();
    }
  }

  function _ensureDefault() {
    if (!_data) _data = _defaultData();
    if (!Array.isArray(_data.transactions)) _data.transactions = [];
    if (!Array.isArray(_data.balanceSnapshots)) _data.balanceSnapshots = [];
    if (typeof _data.startingBalance !== 'number') _data.startingBalance = 0;
  }

  // ============================================================
  //   UTILITY: generate unique ID
  // ============================================================

  function _uid() {
    return 'cf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ============================================================
  //   UTILITY: safe DOM helpers
  // ============================================================

  function _qs(sel) {
    if (!_container) return null;
    return _container.querySelector(sel);
  }

  function _setText(sel, text) {
    const el = _qs(sel);
    if (el) el.textContent = text;
  }

  function _setHtml(sel, html) {
    const el = _qs(sel);
    if (el) el.innerHTML = html;
  }

  /** Shortcut: set text by bare ID (auto-prefixes '#') */
  function _setTextById(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Shortcut: set innerHTML by bare ID (auto-prefixes '#') */
  function _setHtmlById(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ============================================================
  //   FORMATTING
  // ============================================================

  function _formatVND(amount) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    let formatted;
    if (abs >= 1e9) {
      formatted = (abs / 1e9).toFixed(1) + ' B';
    } else if (abs >= 1e6) {
      formatted = (abs / 1e6).toFixed(1) + ' M';
    } else {
      formatted = abs.toLocaleString('vi-VN');
    }
    return n < 0 ? '-' + formatted + ' ₫' : formatted + ' ₫';
  }

  /** Full exact formatting for summary cards — no 'M'/'B' abbreviation */
  function _formatVNFull(amount) {
    var n = Number(amount) || 0;
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    return sign + Math.round(abs).toLocaleString('vi-VN') + ' ₫';
  }

  /** Savings-specific formatting — same as _formatVNFull but re-used
   *  atomically in the edit-btn toast so changes are clearly separate
   *  from the net-worth flow. */
  function _formatVNSavings(amount) {
    return _formatVNFull(amount);
  }

  /**
   * Show a temporary toast anchored at bottom-center.
   * @param {string} msg - The message to display
   */
  function _showToast(msg) {
    var existing = document.querySelector('.hub-cf-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'hub-cf-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add('hub-cf-toast--visible');
    });

    // Auto-dismiss after 2.5s
    setTimeout(function () {
      toast.classList.remove('hub-cf-toast--visible');
      setTimeout(function () {
        if (toast.parentNode) toast.remove();
      }, 400);
    }, 2500);
  }

  function _formatDate(day, month, year) {
    return String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + (year || '');
  }

  function _todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function _currentYearMonth() {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  // ============================================================
  //   COMPUTATION ENGINES
  // ============================================================

  /** Get transactions for a specific month */
  function _getMonthTransactions(year, month) {
    if (!_data || !_data.transactions) return [];
    return _data.transactions.filter(function (tx) {
      return tx.year === year && tx.month === month;
    });
  }

  /** Sum income for a month */
  function _getMonthlyIncome(year, month) {
    const txs = _getMonthTransactions(year, month);
    return txs.filter(function (tx) { return tx.type === 'income'; })
      .reduce(function (sum, tx) { return sum + (tx.amount || 0); }, 0);
  }

  /** Sum expense for a month */
  function _getMonthlyExpense(year, month) {
    const txs = _getMonthTransactions(year, month);
    return txs.filter(function (tx) { return tx.type === 'expense'; }).reduce(function (sum, tx) { return sum + (tx.amount || 0); }, 0);
  }

  /** Get ALL transactions sorted by date descending */
  function _getAllTransactionsSorted() {
    if (!_data || !_data.transactions) return [];
    return _data.transactions.slice().sort(function (a, b) {
      if (a.year !== b.year) return b.year - a.year;
      if (a.month !== b.month) return b.month - a.month;
      return (b.day || 0) - (a.day || 0);
    });
  }

  /** Get recent transactions (current month first, then historical, capped at 50) */
  function _getRecentTransactions() {
    const all = _getAllTransactionsSorted();
    return all.slice(0, 50);
  }

  /** Get category breakdown for a month */
  function _getCategoryBreakdown(year, month, type) {
    const txs = _getMonthTransactions(year, month).filter(function (tx) {
      return tx.type === type;
    });

    const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const map = {};
    categories.forEach(function (cat) { map[cat.id] = 0; });
    txs.forEach(function (tx) {
      if (map[tx.category] !== undefined) {
        map[tx.category] += (tx.amount || 0);
      }
    });
    return map;
  }

  /** Calculate net worth */
  function _calcNetWorth() {
    // Starting balance + all income ever - all expenses ever
    let totalIncome = 0;
    let totalExpense = 0;
    if (_data && _data.transactions) {
      _data.transactions.forEach(function (tx) {
        if (tx.type === 'income') totalIncome += (tx.amount || 0);
        else totalExpense += (tx.amount || 0);
      });
    }
    return (_data.startingBalance || 0) + totalIncome - totalExpense;
  }

  /** Get income categories sorted by amount desc */
  function _getIncomeCategoriesSorted(catMap) {
    if (!catMap) return [];
    const entries = Object.entries(catMap).filter(function (e) { return e[1] > 0; });
    entries.sort(function (a, b) { return b[1] - a[1]; });
    return entries;
  }

  /** Get expense categories sorted by amount desc */
  function _getExpenseCategoriesSorted(catMap) {
    if (!catMap) return [];
    const entries = Object.entries(catMap).filter(function (e) { return e[1] > 0; });
    entries.sort(function (a, b) { return b[1] - a[1]; });
    return entries;
  }

  /** Lookup category object by id */
  function _lookupCategory(catId, type) {
    const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return list.find(function (c) { return c.id === catId; }) || { id: catId, name: catId, nameVI: catId };
  }

  /** Lookup category name for display */
  function _categoryDisplayName(catId, type) {
    return _lookupCategory(catId, type).nameVI || _lookupCategory(catId, type).name;
  }

  // ============================================================
  //   MODULE API — Standard Hub.OS interface
  // ============================================================

  const module = {
    id: 'cashflow',
    name: 'CashFlow',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <path d="M7 11l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,

    /* ──────────────────────────────────────────────
       render(container) — Build the CashFlow UI
       ────────────────────────────────────────────── */
    render: async function (container) {
      _container = container;

      // Load data (once per session)
      await _loadData();

      // Init current month
      if (!_currentMonth) _currentMonth = _currentYearMonth();

      // ══════════════════════════════════════════
      // HTML STRUCTURE
      // ══════════════════════════════════════════
      container.innerHTML = `
<div class="hub-cf-container">

  <!-- ═══ DASHBOARD — 2×2 Summary Grid ═══ -->
  <div class="cashflow-summary-grid">

    <!-- Card 1: Net Worth -->
    <div class="hub-cf-card">
      <span class="hub-cf-card-label" data-i18n="netWorthLabel">${_t('netWorthLabel')}</span>
      <div class="hub-cf-card-value-row">
        <span class="hub-cf-card-value hub-cf-card-value--networth" id="cf-networth">0 ₫</span>
        <button class="hub-cf-card-edit-btn" data-target="net-worth" title="Edit Net Worth">✏️</button>
      </div>
    </div>

    <!-- Card 2: Savings & Investments -->
    <div class="hub-cf-card">
      <span class="hub-cf-card-label" data-i18n="savingsLabel">${_t('savingsLabel')}</span>
      <div class="hub-cf-card-value-row">
        <span class="hub-cf-card-value hub-cf-card-value--savings" id="cf-savings">0 ₫</span>
        <button class="hub-cf-card-edit-btn" data-target="savings" title="Edit Savings &amp; Investments">✏️</button>
      </div>
    </div>

    <!-- Card 3: Income -->
    <div class="hub-cf-card">
      <span class="hub-cf-card-label" data-i18n="incomeLabel">${_t('incomeLabel')}</span>
      <span class="hub-cf-card-value hub-cf-card-value--income" id="cf-income">0 ₫</span>
    </div>

    <!-- Card 4: Expense -->
    <div class="hub-cf-card">
      <span class="hub-cf-card-label" data-i18n="expenseLabel">${_t('expenseLabel')}</span>
      <span class="hub-cf-card-value hub-cf-card-value--expense" id="cf-expense">0 ₫</span>
    </div>

  </div>
<!-- ═══ REAL-TIME CHART ═══ -->
    <div class="hub-cf-chart-section glass-card">
      <div class="hub-cf-chart-header">
        <h4 class="hub-cf-chart-title" data-i18n="chartTitle">${_t('chartTitle')}</h4>
        <select class="hub-cf-chart-filter" id="hub-cf-chart-filter">
          <option value="day" data-i18n="chartDay">${_t('chartDay')}</option>
          <option value="month" selected data-i18n="chartMonth">${_t('chartMonth')}</option>
          <option value="year" data-i18n="chartYear">${_t('chartYear')}</option>
        </select>
      </div>
      <div class="hub-cf-chart-canvas-wrap">
        <canvas id="hub-cf-chart-canvas"></canvas>
      </div>
    </div>

    <!-- ═══ ACTION BAR ═══ -->
  <div class="hub-cf-action-bar">
    <button class="hub-cf-btn hub-cf-btn--add" id="hub-cf-btn-add">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 4v10M4 9h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span data-i18n="addTx">${_t('addTx')}</span>
    </button>
    <button class="hub-cf-btn hub-cf-btn--import" id="hub-cf-btn-import">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v12M5 10l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3 14v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span data-i18n="importXlsx">${_t('importXlsx')}</span>
      <input type="file" id="hub-cf-file-input" accept=".xlsx" style="display:none;" />
    </button>
    <button class="hub-cf-btn hub-cf-btn--export" id="hub-cf-btn-export">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3 13v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span data-i18n="exportXlsx">${_t('exportXlsx')}</span>
    </button>
  </div>

  <!-- ═══ TRANSACTION LEDGER ═══ -->
  <div class="hub-cf-ledger glass-card">
    <div class="hub-cf-ledger-header">
      <div class="hub-cf-month-bar">
        <button class="hub-cf-month-nav" id="hub-cf-month-prev" title="Previous month" aria-label="Previous month">◀</button>
        <span class="hub-cf-month-label" id="hub-cf-month-label"></span>
        <button class="hub-cf-month-nav" id="hub-cf-month-next" title="Next month" aria-label="Next month">▶</button>
      </div>
      <span class="hub-cf-ledger-count" id="hub-cf-tx-count">${_t('txCount_zero')}</span>
    </div>

    <div class="hub-cf-category-breakdown" id="hub-cf-breakdown-section">
      <button class="hub-cf-breakdown-toggle" id="hub-cf-breakdown-toggle">
        <span data-i18n="categoryToggle">${_t('categoryToggle')}</span>
        <span class="hub-cf-breakdown-arrow" id="hub-cf-breakdown-arrow">🔽</span>
      </button>
      <div class="hub-cf-breakdown-body collapsed" id="hub-cf-breakdown-body">
        <p class="hub-cf-breakdown-title" data-i18n="categoryTitle">${_t('categoryTitle')}</p>
        <div id="hub-cf-breakdown-content"></div>
      </div>
    </div>

    <!-- Empty state -->
    <div class="hub-cf-empty" id="hub-cf-empty-state" style="display:none;">
      <span class="hub-cf-empty-icon">📋</span>
      <p class="hub-cf-empty-text" data-i18n="noTxYet">${_t('noTxYet')}</p>
      <p class="hub-cf-empty-hint" data-i18n="noTxHint">${_t('noTxHint')}</p>
    </div>

    <div class="hub-cf-table-wrap" id="hub-cf-table-wrap" style="display:none;">
      <table class="hub-cf-table">
        <thead>
          <tr>
            <th class="hub-cf-col--date" data-i18n="thDate">${_t('thDate')}</th>
            <th class="hub-cf-col--desc" data-i18n="thDesc">${_t('thDesc')}</th>
            <th class="hub-cf-col--cat" data-i18n="thCat">${_t('thCat')}</th>
            <th class="hub-cf-col--amt" data-i18n="thAmt">${_t('thAmt')}</th>
            <th class="hub-cf-col--act"></th>
          </tr>
        </thead>
        <tbody id="hub-cf-tx-body"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ QUICK-ADD MODAL (injected into container) ═══ -->
<div class="hub-cf-overlay" id="hub-cf-overlay" role="dialog" aria-modal="true" aria-label="${_t('modalTitle')}" style="display:none;">
  <div class="hub-cf-modal glass">
    <div class="hub-cf-modal-header">
      <div class="hub-cf-tab-group">
        <button class="hub-cf-tab hub-cf-tab--active" data-tab="expense" id="hub-cf-tab-expense">
          <span class="hub-cf-tab-dot hub-cf-tab-dot--expense"></span>
          <span data-i18n="tabExpense">${_t('tabExpense')}</span>
        </button>
        <button class="hub-cf-tab" data-tab="income" id="hub-cf-tab-income">
          <span class="hub-cf-tab-dot hub-cf-tab-dot--income"></span>
          <span data-i18n="addTx">${_t('tabIncome')}</span>
        </button>
      </div>
      <button class="hub-cf-modal-close" id="hub-cf-modal-close" aria-label="Close modal">✕</button>
    </div>

    <div class="hub-cf-modal-body">
      <form id="hub-cf-form" autocomplete="off">
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-amount" data-i18n="labelAmount">${_t('labelAmount')}</label>
          <input type="number" id="hub-cf-amount" class="hub-cf-form-input hub-cf-amount-input"
                 placeholder="0" min="0" step="1000" required inputmode="numeric" />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-date" data-i18n="labelDate">${_t('labelDate')}</label>
          <input type="date" id="hub-cf-date" class="hub-cf-form-input hub-cf-date-input" required />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-desc" data-i18n="labelDesc">${_t('labelDesc')}</label>
          <input type="text" id="hub-cf-desc" class="hub-cf-form-input"
                 placeholder="${_t('placeholderDesc')}" maxlength="120" />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-category" data-i18n="labelCategory">${_t('labelCategory')}</label>
          <select id="hub-cf-category" class="hub-cf-form-input hub-cf-category-select" required></select>
        </div>
        <div class="hub-cf-form-actions">
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--cancel" id="hub-cf-btn-cancel" data-i18n="btnCancel">${_t('btnCancel')}</button>
          <button type="submit" class="hub-cf-modal-btn hub-cf-modal-btn--save" id="hub-cf-btn-save" data-i18n="btnSave">${_t('btnSave')}</button>
        </div>
      </form>
    </div>
  </div>
</div>`;

      // ══════════════════════════════════════════
      // RENDER DATA INTO THE UI
      // ══════════════════════════════════════════
      _renderAllViews();

      // ══════════════════════════════════════════
      // BIND EVENT HANDLERS
      // ══════════════════════════════════════════
      _bindEvents();

      // ══════════════════════════════════════════
      // SET UP MODAL
      // ══════════════════════════════════════════
      _setupModal();

      // ══════════════════════════════════════════
      // INIT CHART
      // ══════════════════════════════════════════
      if (typeof Chart !== 'undefined') {
        _initChart();
      }
    },

    /* ──────────────────────────────────────────────
       destroy() — Cleanup on tab switch
       ────────────────────────────────────────────── */
    destroy: function () {
      if (_boundKeydown) {
        document.removeEventListener('keydown', _boundKeydown);
        _boundKeydown = null;
      }
      _destroyChart();
      _container = null;
    }
  };

  // ============================================================
  //   RENDER HELPERS
  // ============================================================

  function _renderAllViews() {
    updateDashboardTotals();
    _refreshLedger();
  }

  /**
   * updateCashFlowLanguage(lang)
   *
   * Re-scans all elements with [data-i18n] inside the CashFlow container
   * and updates their textContent from the CASHFLOW_I18N dictionary.
   * Also re-renders dynamic sections (transactions, breakdown, chart).
   *
   * @param {'en'|'vi'} lang — the new language code
   */
  function updateCashFlowLanguage(lang) {
    if (!lang) lang = _getCFLang();
    var dict = CASHFLOW_I18N[lang] || CASHFLOW_I18N['vi'];

    // ── Static text nodes: [data-i18n] ──
    if (_container) {
      var els = _container.querySelectorAll('[data-i18n]');
      Array.prototype.forEach.call(els, function (el) {
        var key = el.getAttribute('data-i18n');
        if (key && dict[key] !== undefined) {
          el.textContent = dict[key];
        }
      });

      // ── Chart filter <option> text ──
      var filterEl = _qs('#hub-cf-chart-filter');
      if (filterEl) {
        var opts = filterEl.querySelectorAll('option');
        opts.forEach(function (opt) {
          var key = opt.getAttribute('data-i18n');
          if (key && dict[key] !== undefined) {
            opt.textContent = dict[key];
          }
        });
      }
    }

    // ── Re-render dynamic sections that contain language-dependent strings ──
    _refreshLedger();
    _updateChart();
  }

  // Expose updateCashFlowLanguage as a public module method
  module.updateLanguage = updateCashFlowLanguage;

  // Also expose on window for legacy callers
  window.cashFlowI18n = updateCashFlowLanguage;

  /**
   * ═══ GLOBAL EVENT BUS — hubLanguageChanged ═══
   *
   * app.js dispatches `new CustomEvent('hubLanguageChanged', { detail: lang })`
   * whenever the user flips the EN ↔ VI toggle in Settings & Backup.
   * This listener picks it up and re-renders the entire CashFlow UI.
   */
  window.addEventListener('hubLanguageChanged', function (e) {
    if (e.detail === 'en' || e.detail === 'vi') {
      // Mirror the language to hubos_lang for getCFLang() to read
      try { localStorage.setItem('hubos_lang', e.detail); } catch (_) {}
      updateCashFlowLanguage(e.detail);
    }
  });

  /**
   * _computeLiveNetWorth()
   *
   * Dynamic all-time Net Worth formula:
   *   totalIncomeAllTime — totalExpenseAllTime + _netWorthOffset
   *
   * This is called both by the edit prompt (to show the current value)
   * and by updateDashboardTotals() (to render the card). Keeping it in
   * one place prevents the offset formula from drifting out of sync.
   *
   * @returns {number} Current live net worth
   */
  function _computeLiveNetWorth() {
    if (!_data || !_data.transactions) return _netWorthOffset || 0;

    var allIncome = 0;
    var allExpense = 0;
    _data.transactions.forEach(function (tx) {
      if (tx.type === 'income') allIncome += (tx.amount || 0);
      else allExpense += (tx.amount || 0);
    });

    return allIncome - allExpense + (_netWorthOffset || 0);
  }

  function updateDashboardTotals() {
    // ═══ GUARD: no data yet ═══
    if (!_data || !_data.transactions) {
      _setTextById('cf-networth', '0 ₫');
      _setTextById('cf-savings',  '0 ₫');
      _setTextById('cf-income',   '0 ₫');
      _setTextById('cf-expense',  '0 ₫');
      return;
    }

    var txs = _data.transactions;

    // ── 1. Determine the time window based on active chart filter ──
    var filteredTxs = [];

    if (_chartFilter === 'day') {
      // Last 30 days
      var now = new Date();
      for (var i = 0; i < 30; i++) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var y = d.getFullYear();
        var m = d.getMonth() + 1;
        var dy = d.getDate();
        txs.forEach(function (tx) {
          if (tx.year === y && tx.month === m && tx.day === dy) {
            filteredTxs.push(tx);
          }
        });
      }

    } else if (_chartFilter === 'month') {
      // Current viewing month
      var ym = _currentMonth || _currentYearMonth();
      filteredTxs = txs.filter(function (tx) {
        return tx.year === ym.year && tx.month === ym.month;
      });

    } else if (_chartFilter === 'year') {
      // Current viewing year
      var year = _currentMonth ? _currentMonth.year : new Date().getFullYear();
      filteredTxs = txs.filter(function (tx) {
        return tx.year === year;
      });

    } else {
      // Fallback: use the viewing month
      var ymFallback = _currentMonth || _currentYearMonth();
      filteredTxs = txs.filter(function (tx) {
        return tx.year === ymFallback.year && tx.month === ymFallback.month;
      });
    }

    // ── 2. Sum income & expense from filtered transactions (time-windowed) ──
    var totalIncome = 0;
    var totalExpense = 0;
    filteredTxs.forEach(function (tx) {
      if (tx.type === 'income') totalIncome += (tx.amount || 0);
      else totalExpense += (tx.amount || 0);
    });

    // ── 3. Net Worth: DYNAMIC all-time formula ──
    //    Net Worth = ALL-TIME income — ALL-TIME expense + (_netWorthOffset)
    //
    //    When the user edits via ✏️, the handler calculates a new offset
    //    so that this formula resolves to their target for the current
    //    transaction set. As transactions are added/deleted, the card
    //    moves dynamically — it is NOT a frozen static number.
    var netWorth = _computeLiveNetWorth();

    // ── 4. Savings: manual value only (not tied to transaction stream) ──
    var savings = _savingsBalance || 0;

    // ═══ 5. WRITE to DOM — full exact numbers, no abbreviation ═══
    _setTextById('cf-networth', _formatVNFull(netWorth));
    _setTextById('cf-savings',  _formatVNFull(savings));
    _setTextById('cf-income',   _formatVNFull(totalIncome));
    _setTextById('cf-expense',  _formatVNFull(totalExpense));

    // Belt + suspenders
    _setText('#cf-networth', _formatVNFull(netWorth));
    _setText('#cf-savings',  _formatVNFull(savings));
    _setText('#cf-income',   _formatVNFull(totalIncome));
    _setText('#cf-expense',  _formatVNFull(totalExpense));
  }

  /** Calculate savings & investments total */
  function _calcSavings() {
    // Sum nhà ở + tiết kiệm + đầu tư balance snapshots
    if (!_data || !_data.balanceSnapshots) return 0;
    return _data.balanceSnapshots
      .filter(function (s) { return s.accountId === 'tiet-kiem' || s.accountId === 'dau-tu'; })
      .reduce(function (sum, s) { return sum + (s.amount || 0); }, 0);
  }

  function _refreshLedger() {
    _updateMonthLabel();
    _refreshTransactions();
    _renderCategoryBreakdown();
  }

  function _updateMonthLabel() {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = months[_currentMonth.month - 1] + ' ' + _currentMonth.year;
    _setTextById('hub-cf-month-label', label);
  }

  function _refreshTransactions() {
    var txs = _getMonthTransactions(_currentMonth.year, _currentMonth.month);
    var emptyEl = _qs('#hub-cf-empty-state');
    var tableEl = _qs('#hub-cf-table-wrap');
    var tbody   = _qs('#hub-cf-tx-body');
    var countEl = _qs('#hub-cf-tx-count');

    if (!emptyEl || !tableEl || !tbody) return;

    if (txs.length === 0) {
      emptyEl.style.display = 'flex';
      tableEl.style.display = 'none';
      if (countEl) countEl.textContent = _t('txCount_zero');
      return;
    }

    emptyEl.style.display = 'none';
    tableEl.style.display = '';
    if (countEl) countEl.textContent = txs.length + ' ' + _t('txCount_other');

    // Sort by day desc
    txs.sort(function (a, b) { return (b.day || 0) - (a.day || 0); });

    var html = '';
    txs.forEach(function (tx) {
      var rowClass = tx.type === 'income' ? 'hub-cf-tx-income' : 'hub-cf-tx-expense';
      var isExpense = tx.type === 'expense';
      var prefix = isExpense ? '-' : '+';
      var amountFormatted = prefix + _formatVND(tx.amount).replace(/^\+/, '+').replace(/^-/, '-');
      var catName = _categoryDisplayName(tx.category, tx.type);

      html += '<tr class="' + rowClass + '" data-tx-id="' + tx.id + '">';
      html += '<td>' + _formatDate(tx.day, tx.month, tx.year) + '</td>';
      html += '<td title="' + _escapeAttr(tx.desc || '') + '">' + _escHtml(tx.desc || '—') + '</td>';
      html += '<td><span class="hub-cf-cat-chip">' + _escHtml(catName) + '</span></td>';
      html += '<td>' + amountFormatted + '</td>';
      html += '<td><button class="hub-cf-delete-btn" data-tx-id="' + tx.id + '" title="Delete">✕</button></td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;

    // Bind delete buttons
    tbody.querySelectorAll('.hub-cf-delete-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var txId = this.getAttribute('data-tx-id');
        if (txId) _deleteTransaction(txId);
      });
    });
  }

  function _renderCategoryBreakdown() {
    var container = _qs('#hub-cf-breakdown-content');
    if (!container) return;

    var txs = _getMonthTransactions(_currentMonth.year, _currentMonth.month);

    // ── Partition by type ──
    var incomeTxs = [];
    var expenseTxs = [];
    txs.forEach(function (tx) {
      if (tx.type === 'income') incomeTxs.push(tx);
      else expenseTxs.push(tx);
    });

    // ── Group & sum income by category ──
    var incomeByCat = {};
    var totalIncome = 0;
    incomeTxs.forEach(function (tx) {
      var cat = tx.category || 'unknown';
      incomeByCat[cat] = (incomeByCat[cat] || 0) + (tx.amount || 0);
      totalIncome += (tx.amount || 0);
    });

    // ── Group & sum expense by category ──
    var expenseByCat = {};
    var totalExpense = 0;
    expenseTxs.forEach(function (tx) {
      var cat = tx.category || 'unknown';
      expenseByCat[cat] = (expenseByCat[cat] || 0) + (tx.amount || 0);
      totalExpense += (tx.amount || 0);
    });

    // ── Helper: sort entries by amount desc ──
    function sortEntries(obj) {
      return Object.keys(obj)
        .map(function (k) { return { id: k, amt: obj[k] }; })
        .sort(function (a, b) { return b.amt - a.amt; });
    }

    var incomeSorted  = sortEntries(incomeByCat);
    var expenseSorted = sortEntries(expenseByCat);

    var html = '';

    // ── INCOME SECTION ──
    if (incomeSorted.length > 0) {
      html += '<p class="hub-cf-breakdown-section-label">' + _t('breakdownIncome') + '</p>';
      incomeSorted.forEach(function (entry) {
        var cat = _lookupCategory(entry.id, 'income');
        var name = cat ? cat.name : entry.id;
        var amt  = entry.amt;
        var pct  = totalIncome > 0 ? Math.round((amt / totalIncome) * 100) : 0;

        html += '<div class="hub-cf-breakdown-item">';
        html += '<span class="hub-cf-breakdown-name">' + _escHtml(name) + '</span>';
        html += '<span class="hub-cf-breakdown-amt hub-cf-breakdown-amt--income">' +
                  _formatVND(amt) + ' (' + pct + '%)' +
                '</span>';
        html += '</div>';
        html += '<div class="hub-cf-breakdown-bar-track">';
        html += '<div class="hub-cf-breakdown-bar-fill hub-cf-breakdown-bar-fill--income" style="width:' + pct + '%"></div>';
        html += '</div>';
      });
    }

    // ── EXPENSE SECTION ──
    if (expenseSorted.length > 0) {
      if (incomeSorted.length > 0) {
        html += '<p class="hub-cf-breakdown-section-label" style="margin-top:2px;">' + _t('breakdownExpense') + '</p>';
      } else {
        html += '<p class="hub-cf-breakdown-section-label">' + _t('breakdownExpense') + '</p>';
      }
      expenseSorted.forEach(function (entry) {
        var cat = _lookupCategory(entry.id, 'expense');
        var name = cat ? cat.name : entry.id;
        var amt  = entry.amt;
        var pct  = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;

        html += '<div class="hub-cf-breakdown-item">';
        html += '<span class="hub-cf-breakdown-name">' + _escHtml(name) + '</span>';
        html += '<span class="hub-cf-breakdown-amt hub-cf-breakdown-amt--expense">' +
                  _formatVND(amt) + ' (' + pct + '%)' +
                '</span>';
        html += '</div>';
        html += '<div class="hub-cf-breakdown-bar-track">';
        html += '<div class="hub-cf-breakdown-bar-fill hub-cf-breakdown-bar-fill--expense" style="width:' + pct + '%"></div>';
        html += '</div>';
      });
    }

    // ── Empty state ──
    if (!html) {
      html = '<p style="color:var(--text-muted);font-size:0.74rem;text-align:center;padding:8px 0;">' + _t('noCategoryData') + '</p>';
    }

    container.innerHTML = html;
  }

  // ============================================================
  //   EVENT BINDING
  // ============================================================

  function _bindEvents() {
    // Add button
    const addBtn = _qs('#hub-cf-btn-add');
    if (addBtn) {
      addBtn.addEventListener('click', _openModal);
    }

    // Export button
    const exportBtn = _qs('#hub-cf-btn-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', _exportToXlsx);
    }

    // ── Edit buttons (Net Worth + Savings) — delegate on dashboard grid ──
    var summaryGrid = _qs('.cashflow-summary-grid');
    if (summaryGrid) {
      summaryGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('.hub-cf-card-edit-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        var target = btn.getAttribute('data-target');

        if (target === 'net-worth') {
          // ── Vietnamese prompt for Net Worth ──
          // Show the CURRENT live net worth (dynamic), not the raw offset
          var liveNetWorth = _computeLiveNetWorth();
          var currentVal = liveNetWorth ? liveNetWorth.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập số dư Tổng Tài Sản hiện tại (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          // Strip spaces, commas, dots (thousand separators), then parse
          var clean = String(raw).replace(/[\s,.]/g, '');
          var userTarget = parseInt(clean, 10);
          if (isNaN(userTarget)) return; // invalid input — bail silently

          // Calculate the TRUE offset:
          //   offset = userTarget — (allIncome — allExpense)
          // This way the dynamic formula:
          //   display = allIncome — allExpense + _netWorthOffset
          // resolves to exactly userTarget at this moment.
          var allIncome = 0;
          var allExpense = 0;
          if (_data && _data.transactions) {
            _data.transactions.forEach(function (tx) {
              if (tx.type === 'income') allIncome += (tx.amount || 0);
              else allExpense += (tx.amount || 0);
            });
          }
          _netWorthOffset = userTarget - (allIncome - allExpense);

          // Push calculated offset to Firestore immediately
          _persistMeta().catch(function (err) {
            console.error('[CashFlow] Meta persist failed:', err);
          });

          updateDashboardTotals();
          _showToast('✅ Đã cập nhật Tổng Tài Sản: ' + _formatVNFull(userTarget));

        } else if (target === 'savings') {
          // ── Vietnamese prompt for Savings ──
          // Savings is purely manual (no transaction math applied).
          // Show the current $avings value, replace with whatever the
          // user enters. Balance snapshots are stored separately in
          // $ata.balanceSnapshots and are not recomputed here.
          var liveSavings = _savingsBalance || 0;
          var currentVal = liveSavings ? liveSavings.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập số dư Tiết kiệm / Đầu tư hiện tại (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          // Strip commas, dots, spaces
          var cleaned = String(raw).replace(/[\s,.]/g, '');
          var parsed = parseInt(cleaned, 10);

          if (isNaN(parsed)) return;

          _savingsBalance = parsed;
          _persistMeta().catch(function (err) {
            console.error('[CashFlow] Meta persist failed:', err);
          });
          updateDashboardTotals();
          _showToast('✅ Đã cập nhật Tiết kiệm / Đầu tư: ' + _formatVNSavings(parsed));
        }
      });
    }

    // Import button — triggers hidden file input
    const importBtn = _qs('#hub-cf-btn-import');
    const fileInput = _qs('#hub-cf-file-input');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (file) _handleImport(file);
        // Reset so the same file can be reimported
        fileInput.value = '';
      });
    }

    // Month navigation
    const prevBtn = _qs('#hub-cf-month-prev');
    const nextBtn = _qs('#hub-cf-month-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        _currentMonth.month -= 1;
        if (_currentMonth.month < 1) {
          _currentMonth.month = 12;
          _currentMonth.year -= 1;
        }
        _renderAllViews();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        _currentMonth.month += 1;
        if (_currentMonth.month > 12) {
          _currentMonth.month = 1;
          _currentMonth.year += 1;
        }
        _renderAllViews();
      });
    }

    // Chart filter change — re-render dashboard totals + chart
    var filterEl = _qs('#hub-cf-chart-filter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        _chartFilter = this.value;
        updateDashboardTotals();
        _updateChart();
      });
    }

    // Category breakdown toggle — collapse / expand
    var toggleBtn = _qs('#hub-cf-breakdown-toggle');
    var breakdownBody = _qs('#hub-cf-breakdown-body');
    var toggleArrow = _qs('#hub-cf-breakdown-arrow');
    if (toggleBtn && breakdownBody && toggleArrow) {
      toggleBtn.addEventListener('click', function () {
        var collapsed = breakdownBody.classList.toggle('collapsed');
        toggleArrow.textContent = collapsed ? '🔽' : '🔼';
      });
    }

    // Escape key to close modal
    _boundKeydown = function (e) {
      if (e.key === 'Escape') {
        _closeModal();
      }
    };
    document.addEventListener('keydown', _boundKeydown);
  }

  // ============================================================
  //   MODAL LOGIC
  // ============================================================

  function _setupModal() {
    _activeTab = 'expense';

    // Tab buttons
    const tabExpense = _qs('#hub-cf-tab-expense');
    const tabIncome  = _qs('#hub-cf-tab-income');
    if (tabExpense) {
      tabExpense.addEventListener('click', function () { _switchTab('expense'); });
    }
    if (tabIncome) {
      tabIncome.addEventListener('click', function () { _switchTab('income'); });
    }

    // Close button
    const closeBtn = _qs('#hub-cf-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', _closeModal);
    }

    // Cancel button
    const cancelBtn = _qs('#hub-cf-btn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', _closeModal);
    }

    // Overlay backdrop click
    const overlay = _qs('#hub-cf-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeModal();
      });
    }

    // Form submit
    const form = _qs('#hub-cf-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        _saveTransaction();
      });
    }

    // Populate initial category options
    _populateCategories();
  }

  function _populateCategories() {
    const select = _qs('#hub-cf-category');
    if (!select) return;

    const categories = _activeTab === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    var html = '';
    categories.forEach(function (cat) {
      html += '<option value="' + cat.id + '">' + _escHtml(cat.name) + '</option>';
    });
    select.innerHTML = html;
  }

  function _switchTab(tab) {
    _activeTab = tab;
    const tabExpense = _qs('#hub-cf-tab-expense');
    const tabIncome  = _qs('#hub-cf-tab-income');

    if (tabExpense) tabExpense.classList.toggle('hub-cf-tab--active', tab === 'expense');
    if (tabIncome)  tabIncome.classList.toggle('hub-cf-tab--active', tab === 'income');

    _populateCategories();
  }

  function _openModal() {
    const overlay = _qs('#hub-cf-overlay');
    if (!overlay) return;

    // Reset form
    const form = _qs('#hub-cf-form');
    if (form) form.reset();

    const dateInput = _qs('#hub-cf-date');
    if (dateInput) dateInput.value = _todayISO();

    overlay.style.display = 'flex';
    setTimeout(function () {
      const amountInput = _qs('#hub-cf-amount');
      if (amountInput) amountInput.focus();
    }, 150);
  }

  function _closeModal() {
    const overlay = _qs('#hub-cf-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function _saveTransaction() {
    const amountStr = (_qs('#hub-cf-amount') ? _qs('#hub-cf-amount').value : '');
    const dateStr   = (_qs('#hub-cf-date') ? _qs('#hub-cf-date').value : '');
    const desc      = (_qs('#hub-cf-desc') ? _qs('#hub-cf-desc').value.trim() : '');
    const category  = (_qs('#hub-cf-category') ? _qs('#hub-cf-category').value : '');

    const amount = parseInt(amountStr, 10);
    if (!amountStr || isNaN(amount) || amount <= 0) {
      _showInput('hub-cf-amount');
      return;
    }
    if (!dateStr) {
      _showInput('hub-cf-date');
      return;
    }
    if (!category) {
      _showInput('hub-cf-category');
      return;
    }

    const dateParts = dateStr.split('-');
    const year  = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    const day   = parseInt(dateParts[2], 10);

    const tx = {
      id: _uid(),
      type: _activeTab,  // 'expense' or 'income'
      amount: amount,
      year: year,
      month: month,
      day: day,
      desc: desc || '',
      category: category,
      createdAt: Date.now()
    };

    _data.transactions.push(tx);

    // ── BREAK THE OFFLINE SEAL: user explicitly added data ──
    if (_isOfflineMode) { _isOfflineMode = false; }

    _debouncedPersist();
    _closeModal();
    _renderAllViews();
    _updateChart();

    // If the new TX month matches the viewing month, ledger updates naturally
    // If not, switch to the TX's month
    if (year !== _currentMonth.year || month !== _currentMonth.month) {
      _currentMonth.year = year;
      _currentMonth.month = month;
    }

    _renderAllViews();
  }

  function _deleteTransaction(txId) {
    var idx = -1;
    for (var i = 0; i < _data.transactions.length; i++) {
      if (_data.transactions[i].id === txId) { idx = i; break; }
    }
    if (idx === -1) return;

    _data.transactions.splice(idx, 1);
    _debouncedPersist();
    _renderAllViews();
    _updateChart();
  }

  function _showInput(sel) {
    var el = _qs(sel);
    if (!el) return;
    el.style.borderColor = 'var(--danger)';
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.focus();
    setTimeout(function () { el.style.borderColor = ''; }, 1500);
  }

  // ============================================================
  //   IMPORT FROM .XLSX (Strict Overwrite — no merge, no dedup)
  // ============================================================

  /**
   * Read an Excel workbook from a File object. The Excel file is the
   * ABSOLUTE source of truth — it REPLACES the entire transactions array
   * and overwrites Firestore completely.
   *
   * NaN Guard: any row with a missing/invalid day, month, or amount is
   * SKIPPED silently to prevent 'NaN/2026' labels on the chart.
   *
   * Expected column layout per row:
   *   Ngày | Tháng | Mô tả | Hạng mục | Số tiền
   *
   * Sheet name determines type:
   *   - Contains "Income" or "Thu"  → type 'income'
   *   - Contains "Expense" or "Chi" → type 'expense'
   *   - Otherwise → type 'expense'
   *
   * @param {File} file — XLSX file from <input type="file" />
   */
  async function _handleImport(file) {
    if (typeof XLSX === 'undefined') {
      _showStatusMsg(_t('importNotLoaded'));
      return;
    }

    try {
      // ── 1. Read workbook from file buffer ──
      var buffer = await file.arrayBuffer();
      var wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

      var sheetNames = wb.SheetNames;
      var importedTxs = [];
      var skippedSheets = [];
      var skippedRows = 0;

      // ── 2. Iterate sheets, skip "Summary" ──
      sheetNames.forEach(function (name) {
        var lower = String(name).toLowerCase().trim();
        if (lower === 'summary' || lower === 'tóm tắt') {
          skippedSheets.push(name);
          return;
        }

        // Determine type from sheet name
        var isIncome = lower.indexOf('income') !== -1 || lower.indexOf('thu') !== -1;
        var type = isIncome ? 'income' : 'expense';

        var sheet = wb.Sheets[name];
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) return; // no data rows

        // ── 3. Parse each data row with strict NaN guard & date string fix ──
        for (var i = 1; i < rows.length; i++) {
          var row = rows[i];
          if (!row || !row.length) continue;

          // Read raw cell values
          var rawDay     = row[0];
          var rawMonth   = row[1];
          var rawDesc    = row[2];
          var rawCat     = row[3];
          var rawAmount  = row[4];
          var rawYear    = row[5];  // optional explicit Year column

          // ── Date fixing: detect DD/MM/YYYY string in column 0 ──
          var dayVal, monthVal, year;
          var rawDayStr = typeof rawDay === 'string' ? rawDay : String(rawDay || '');

          if (rawDayStr.indexOf('/') !== -1) {
            // Cell is a full date string like "31/03/2026" or "31/3/2026"
            var parts = rawDayStr.split('/');
            dayVal   = parseInt(parts[0], 10);
            monthVal = parseInt(parts[1], 10);
            year     = parseInt(parts[2], 10);
          } else {
            // Cell holds plain numeric day (or was parsed as date serial by SheetJS)
            dayVal   = Number(rawDay);
            monthVal = Number(rawMonth);
            // Year from explicit Year column (col 5), or fallback to current view year
            year = (typeof rawYear === 'number' && rawYear >= 2000 && rawYear <= 2100)
              ? rawYear
              : (_currentMonth ? _currentMonth.year : new Date().getFullYear());

            // 🔥 SheetJS date serial fix: if rawDay is a large serial number
            // (Excel stores dates as days since 1900-01-01), convert it
            if (dayVal > 31 && dayVal < 150000) {
              var jsDate = XLSX.SSF.parse_date_code(dayVal);
              if (jsDate && jsDate.d > 0 && jsDate.m > 0 && jsDate.y > 2000) {
                dayVal   = jsDate.d;
                monthVal = jsDate.m;
                year     = jsDate.y;
              }
            }
          }

          var amount = Number(rawAmount);

          // ═══ STRICT GUARD: reject NaN, <=0, or missing day/month/amount ═══
          if (isNaN(dayVal)     || dayVal <= 0  || dayVal > 31)     { skippedRows++; continue; }
          if (isNaN(monthVal)   || monthVal <= 0 || monthVal > 12)  { skippedRows++; continue; }
          if (isNaN(amount)     || amount <= 0)                     { skippedRows++; continue; }
          if (isNaN(year)       || year < 2000 || year > 2100)      { skippedRows++; continue; }

          var desc     = String(rawDesc || row['Mô tả'] || '').trim();
          var category = String(rawCat  || row['Hạng mục'] || '').trim();

          importedTxs.push({
            id: _uid(),
            type: type,
            amount: Math.abs(amount),
            year: year,
            month: monthVal,
            day: dayVal,
            desc: desc || '',
            category: category || '',
            createdAt: Date.now()
          });
        }
      });

      if (importedTxs.length === 0) {
        _showStatusMsg(_t('importNoRows') + ' ' + skippedRows + ' ' + _t('importRowsInvalid'));
        return;
      }

      // ═══ 4. STRICT OVERWRITE: replace entire state & persist ═══
      _data.transactions = importedTxs;
      _isDataLoaded = true;

      // ── BREAK THE OFFLINE SEAL: user explicitly imported data ──
      if (_isOfflineMode) { _isOfflineMode = false; }

      await _persist();

      // ═══ 5. FULL UI REFRESH ═══
      updateDashboardTotals();
      _refreshLedger();
      _updateChart();

      var msg = _t('importSuccess') + ' ' + importedTxs.length + ' ' + _t('importSuccess1');
      if (skippedRows > 0) msg += ' ' + _t('importSkipped') + ' ' + skippedRows + ' ' + _t('importInvalidRows');
      if (skippedSheets.length > 0) msg += ' ' + _t('importSkippedSheets') + ' ' + skippedSheets.join(', ');
      _showStatusMsg(msg);

    } catch (e) {
      console.error('[CashFlow] Import failed:', e);
      _showStatusMsg(_t('importFailed'));
    }
  }

  // ============================================================
  //   EXPORT TO .XLSX
  // ============================================================

  function _exportToXlsx() {
    if (!_data || !_data.transactions || _data.transactions.length === 0) {
      var statusEl = document.getElementById('hub-cf-status-msg');
      if (!statusEl) return;
      statusEl.textContent = 'No transactions to export.';
      statusEl.style.color = 'var(--danger)';
      statusEl.style.display = 'block';
      setTimeout(function () { if (statusEl) statusEl.style.display = 'none'; }, 2500);
      return;
    }

    try {
      // Build Expense array
      var expenseRows = [];
      var incomeRows = [];

      _data.transactions.forEach(function (tx) {
        var row = {
          'Ngày': tx.day || 0,
          'Tháng': tx.month || 0,
          'Mô tả': (tx.desc || ''),
          'Hạng mục': _categoryDisplayName(tx.category, tx.type),
          'Số tiền': (tx.amount || 0)
        };
        if (tx.type === 'expense') {
          expenseRows.push(row);
        } else if (tx.type === 'income') {
          incomeRows.push(row);
        }
      });

      // Sort expense by month then day descending
      expenseRows.sort(function (a, b) {
        if (a['Tháng'] !== b['Tháng']) return b['Tháng'] - a['Tháng'];
        return b['Ngày'] - a['Ngày'];
      });

      // Sort income by month then day descending
      incomeRows.sort(function (a, b) {
        if (a['Tháng'] !== b['Tháng']) return b['Tháng'] - a['Tháng'];
        return b['Ngày'] - a['Ngày'];
      });

      // Create workbook with XLSX global
      var wb = XLSX.utils.book_new();

      // Sheet 1: Expenses
      if (expenseRows.length > 0) {
        var wsExpense = XLSX.utils.json_to_sheet(expenseRows, {
          header: ['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Số tiền']
        });
        XLSX.utils.book_append_sheet(wb, wsExpense, 'Expenses');
      } else {
        // Still create empty sheet with headers
        var wsEmptyExpense = XLSX.utils.aoa_to_sheet([['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Số tiền']]);
        XLSX.utils.book_append_sheet(wb, wsEmptyExpense, 'Expenses');
      }

      // Sheet 2: Income
      if (incomeRows.length > 0) {
        var wsIncome = XLSX.utils.json_to_sheet(incomeRows, {
          header: ['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Số tiền']
        });
        XLSX.utils.book_append_sheet(wb, wsIncome, 'Income');
      } else {
        var wsEmptyIncome = XLSX.utils.aoa_to_sheet([['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Số tiền']]);
        XLSX.utils.book_append_sheet(wb, wsEmptyIncome, 'Income');
      }

      // Write and download
      var now = new Date();
      var ts = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      XLSX.writeFile(wb, 'CashFlow_Export_' + ts + '.xlsx');
    } catch (e) {
      console.error('Excel export failed:', e);
      // Graceful fallback notification
      var statusEl = _showStatusMsg('Export failed — try again.');
      if (statusEl) {
        statusEl.style.color = 'var(--danger)';
      }
    }
  }

  function _showStatusMsg(msg) {
    // create a temporary status message element if not exists
    var el = document.getElementById('hub-cf-status-msg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hub-cf-status-msg';
      el.style.cssText = 'position:fixed;bottom:1rem;right:1rem;padding:0.6rem 1.2rem;border-radius:8px;background:var(--bg-card);color:var(--text-primary);z-index:9999;font-size:0.82rem;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function () { if (el) el.style.display = 'none'; }, 2500);
    return el;
  }

  // ============================================================
  //   CHART.JS — Real-time Income vs Expense Chart
  // ============================================================

  function _initChart() {
    var canvas = _qs('#hub-cf-chart-canvas');
    if (!canvas) return;

    // Destroy previous chart instance if exists
    if (_chart) {
      _chart.destroy();
      _chart = null;
    }

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get computed CSS variable colors for chart
    var style = getComputedStyle(document.documentElement);
    var incomeColor = style.getPropertyValue('--success').trim() || '#00e676';
    var expenseColor = style.getPropertyValue('--danger').trim() || '#ff5252';
    var textColor = style.getPropertyValue('--text-primary').trim() || '#e0e0e0';
    var textMuted = style.getPropertyValue('--text-muted').trim() || '#888';

    _chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: _t('chartIncome'),
            data: [],
            backgroundColor: incomeColor + 'b3',
            borderColor: incomeColor,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false
          },
          {
            label: _t('chartExpense'),
            data: [],
            backgroundColor: expenseColor + 'b3',
            borderColor: expenseColor,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            labels: {
              color: textColor,
              usePointStyle: true,
              padding: 16,
              font: { size: 12 }
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ': ' + (ctx.raw || 0).toLocaleString('vi-VN') + ' ₫';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: textMuted,
              font: { size: 11 }
            },
            grid: {
              color: 'rgba(128, 128, 128, 0.15)'
            }
          },
          y: {
            ticks: {
              color: textMuted,
              font: { size: 11 },
              callback: function (val) {
                if (val >= 1e9) return (val / 1e9).toFixed(1) + 'B';
                if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M';
                if (val >= 1e3) return (val / 1e3).toFixed(0) + 'k';
                return val;
              }
            },
            grid: {
              color: 'rgba(128, 128, 128, 0.15)'
            },
            beginAtZero: true
          }
        }
      }
    });

    _updateChart();
  }

  function _updateChart() {
    if (!_chart || !_chart.canvas) return;

    var data = _dataZoom();
    _chart.data.labels = data.labels;
    _chart.data.datasets[0].data = data.incomeData;
    _chart.data.datasets[1].data = data.expenseData;

    // Toggle chart type: line for day-level detail, bar for month/year aggregation
    var isDayView = _chartFilter === 'day';
    _chart.config.type = isDayView ? 'line' : 'bar';

    // Adjust dataset styles per type
    _chart.data.datasets[0].fill = isDayView ? false : undefined;
    _chart.data.datasets[1].fill = isDayView ? false : undefined;
    if (isDayView) {
      _chart.data.datasets[0].tension = 0.3;
      _chart.data.datasets[1].tension = 0.3;
      _chart.data.datasets[0].pointRadius = 3;
      _chart.data.datasets[1].pointRadius = 3;
    } else {
      _chart.data.datasets[0].tension = undefined;
      _chart.data.datasets[1].tension = undefined;
      _chart.data.datasets[0].pointRadius = undefined;
      _chart.data.datasets[1].pointRadius = undefined;
    }

    _chart.update();
  }

  function _dataZoom() {
    var labels = [];
    var incomeData = [];
    var expenseData = [];

    if (!_data || !_data.transactions || _data.transactions.length === 0) {
      return { labels: labels, incomeData: incomeData, expenseData: expenseData };
    }

    var trans = _data.transactions.slice(); // shallow copy

    if (_chartFilter === 'day') {
      // Group by date (dd/mm), last 30 days
      var dayMap = {};
      // Get date range: last 30 days
      var now = new Date();
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var key = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
        dayMap[key] = { income: 0, expense: 0 };
      }

      trans.forEach(function (tx) {
        var key = String(tx.day).padStart(2, '0') + '/' + String(tx.month).padStart(2, '0');
        if (dayMap[key] !== undefined) {
          if (tx.type === 'income') dayMap[key].income += tx.amount;
          else dayMap[key].expense += tx.amount;
        }
      });

      Object.keys(dayMap).forEach(function (key) {
        labels.push(key);
        incomeData.push(dayMap[key].income);
        expenseData.push(dayMap[key].expense);
      });

    } else if (_chartFilter === 'month') {
      // Group by month, show all unique months
      var monthMap = {};
      trans.forEach(function (tx) {
        var key = String(tx.month).padStart(2, '0') + '/' + tx.year;
        if (!monthMap[key]) monthMap[key] = { income: 0, expense: 0, year: tx.year, month: tx.month };
        if (tx.type === 'income') monthMap[key].income += tx.amount;
        else monthMap[key].expense += tx.amount;
      });

      var keys = Object.keys(monthMap).sort(function (a, b) {
        var aParts = a.split('/'), bParts = b.split('/');
        if (aParts[1] !== bParts[1]) return parseInt(aParts[1]) - parseInt(bParts[1]);
        return parseInt(aParts[0]) - parseInt(bParts[0]);
      });

      keys.forEach(function (key) {
        var m = monthMap[key];
        var label = String(m.month).padStart(2, '0') + '/' + m.year;
        labels.push(label);
        incomeData.push(m.income);
        expenseData.push(m.expense);
      });

    } else if (_chartFilter === 'year') {
      // Group by year
      var yearMap = {};
      trans.forEach(function (tx) {
        if (!yearMap[tx.year]) yearMap[tx.year] = { income: 0, expense: 0 };
        if (tx.type === 'income') yearMap[tx.year].income += tx.amount;
        else yearMap[tx.year].expense += tx.amount;
      });

      var yearKeys = Object.keys(yearMap).sort();
      yearKeys.forEach(function (yr) {
        labels.push(String(yr));
        incomeData.push(yearMap[yr].income);
        expenseData.push(yearMap[yr].expense);
      });
    }

    return { labels: labels, incomeData: incomeData, expenseData: expenseData };
  }

  function _destroyChart() {
    if (_chart) {
      _chart.destroy();
      _chart = null;
    }
  }

  // ============================================================
  //   XSS PREVENTION
  // ============================================================

  function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ============================================================
  //   REGISTER
  // ============================================================

  if (typeof app !== 'undefined') {
    app.register(module);
  }

  return module;
})();