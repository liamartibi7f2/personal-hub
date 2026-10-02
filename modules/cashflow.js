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
    { id: 'thu-nhap-khac',     name: 'Thu nhập khác',        nameVI: 'Thu nhập khác' },
    { id: 'tiet-kiem',         name: '🐷 Tiết kiệm',         nameVI: '🐷 Tiết kiệm' }
  ];

  const EXPENSE_CATEGORIES = [
    { id: 'nha-o',                   name: '🏠 Nhà ở',                 nameVI: '🏠 Nhà ở' },
    { id: 'an-uong',                 name: '🍜 Ăn uống',               nameVI: '🍜 Ăn uống' },
    { id: 'di-chuyen',               name: '🛵 Di chuyển',             nameVI: '🛵 Di chuyển' },
    { id: 'tieu-dung-thiet-yeu',     name: '🛒 Tiêu dùng thiết yếu',    nameVI: '🛒 Tiêu dùng thiết yếu' },
    { id: 'tieu-dung-khac',          name: '🛍️ Tiêu dùng khác',         nameVI: '🛍️ Tiêu dùng khác' },
    { id: 'doodad',                  name: '🎮 Doodad',                nameVI: '🎮 Doodad' },
    { id: 'cho-di',                  name: '❤️ Cho đi',                nameVI: '❤️ Cho đi' },
    { id: 'phat-trien-ban-than',     name: '📚 Phát triển bản thân',    nameVI: '📚 Phát triển bản thân' },
    { id: 'chi-phi-khac',            name: '🏷️ Chi phí khác',           nameVI: '🏷️ Chi phí khác' },
    { id: 'tiet-kiem',               name: '🐷 Tiết kiệm',             nameVI: '🐷 Tiết kiệm' }
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

  // ── Source types (UPDATED: 3-way categorization) ──
  const SOURCE_TYPES = [
    { id: 'uncategorized', name: 'Uncategorized', nameVI: 'Chưa phân loại' },
    { id: 'bank',          name: 'Bank Transfer', nameVI: 'Chuyển khoản' },
    { id: 'cash',          name: 'Cash',          nameVI: 'Tiền mặt' }
  ];

  // ── Category emoji mapping for backward compatibility ──
  // Maps legacy category names (without emojis) to new emoji-enhanced names
  const CATEGORY_ICONS = {
    // Expense categories
    'Nhà ở':                    '🏠 Nhà ở',
    'Ăn uống':                  '🍜 Ăn uống',
    'Di chuyển':                '🛵 Di chuyển',
    'Tiêu dùng thiết yếu':      '🛒 Tiêu dùng thiết yếu',
    'Tiêu dùng khác':           '🛍️ Tiêu dùng khác',
    'Doodad':                   '🎮 Doodad',
    'Cho đi':                   '❤️ Cho đi',
    'Phát triển bản thân':      '📚 Phát triển bản thân',
    'Chi phí khác':             '🏷️ Chi phí khác',
    'Tiết kiệm':                '🐷 Tiết kiệm',
    // Income categories (for future use / completeness)
    'Lương':                    '💰 Lương',
    'Kinh doanh, đầu tư':       '📈 Kinh doanh, đầu tư',
    'Thu nhập bị động':         '💎 Thu nhập bị động',
    'Thu nhập khác':            '💵 Thu nhập khác',
    'Tiết kiệm':                '🐷 Tiết kiệm'
  };

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
      cashWalletLabel:  'CASH WALLET',
      cashWalletSub:    'PHYSICAL CASH ON HAND',
      bankAccountLabel: 'BANK ACCOUNT',
      bankAccountSub:   'DIGITAL / BANK BALANCE',
      uncategorizedLabel:  'UNCATEGORIZED',
      uncategorizedSub:    'NEEDS REVIEW',

      // Chart
      chartTitle:       'INCOME VS EXPENSE',
      chartIncome:      'Income',
      chartExpense:     'Expense',
      chartCash:        'Cash Flow',
      chartBank:        'Bank Flow',
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
      tabLedger:        'Transaction List',
      tabStats:         'Category Breakdown',
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
      modalTitleEdit:   'Edit Transaction',
      tabExpense:       'Expense',
      tabIncome:        'Income',
      labelAmount:      'Amount (VND)',
      labelDate:        'Date',
      labelDesc:        'Description',
      labelCategory:    'Category',
      labelSource:      'Source',
      sourceUncategorized: 'Uncategorized',
      sourceCash:       'Cash (Physical)',
      sourceBank:       'Bank Transfer',
      sourceSavings:    'Savings',
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
      cashWalletLabel:  'TIỀN MẶT',
      cashWalletSub:    'TIỀN MẶT TRONG TAY',
      bankAccountLabel: 'CHUYỂN KHOẢN',
      bankAccountSub:   'SỐ DƯ TÀI KHOẢN',
      uncategorizedLabel:  'CHƯA PHÂN LOẠI',
      uncategorizedSub:    'CẦN XEM XÉT',

      // Chart
      chartTitle:       'THU NHẬP VÀ CHI PHÍ',
      chartIncome:      'Thu Nhập',
      chartExpense:     'Chi Phí',
      chartCash:        'Dòng tiền mặt',
      chartBank:        'Dòng ngân hàng',
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
      tabLedger:        'Lịch sử',
      tabStats:         'Thống kê',
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
      modalTitleEdit:   'Sửa Giao Dịch',
      tabExpense:      'Chi Phí',
      tabIncome:       'Thu Nhập',
      labelAmount:      'Số tiền (VND)',
      labelDate:        'Ngày',
      labelDesc:        'Mô tả',
      labelCategory:    'Hạng mục',
      labelSource:      'Nguồn',
      sourceUncategorized: 'Chưa phân loại',
      sourceCash:       'Tiền mặt',
      sourceBank:       'Chuyển khoản',
      sourceSavings:    'Tiết kiệm',
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

  // ══════════════════════════════════════════════════════════════
  // POCKET DEBT I18N DICTIONARY
  // ══════════════════════════════════════════════════════════════

  var POCKET_DEBT_I18N = {
    vi: {
      debtSummaryTitle:    'SỔ NỢ BỎ TÚI',
      debtSummarySub:      'Tổng tiền đang cho mượn',
      totalPendingDebt:    'Tổng nợ đang chờ thu',
      ledgerTitle:         'DANH SÁCH NỢ',
      colDebtor:           'Người mượn',
      colAmount:           'Số tiền',
      colDateBorrowed:     'Ngày mượn',
      colExpectedReturn:   'Ngày hẹn trả',
      colStatus:           'Trạng thái',
      colActions:          'Thao tác',
      statusPending:       'Đang chờ',
      statusPaid:          'Đã trả',
      statusOverdue:       'Quá hạn',
      btnMarkPaid:         'Đã trả',
      btnAddDebt:          'Thêm nợ mới',
      btnDelete:           'Xóa',
      modalTitle:          'Thêm khoản nợ mới',
      labelDebtorName:     'Tên người mượn',
      labelAmount:         'Số tiền (VND)',
      labelDateBorrowed:   'Ngày mượn',
      labelExpectedReturn: 'Ngày hẹn trả',
      labelNote:           'Ghi chú',
      placeholderDebtor:   'VD: Anh Minh, Chị Lan...',
      placeholderAmount:   '0',
      placeholderNote:     'VD: Mượn tiền ăn trưa, Mượn cấp bách...',
      btnCancel:           'Hủy',
      btnSave:             'Lưu',
      modalTitleEdit:      'Sửa Thông Tin Nợ',
      confirmMarkPaid:     'Đánh dấu "{name}" đã trả nợ {amount}?',
      confirmAddToIncome:  'Bạn có muốn thêm khoản nợ này vào Thu nhập CashFlow dưới danh mục "Thu nợ"?',
      confirmDelete:       'Xóa khoản nợ của "{name}" ({amount})?',
      toastDebtAdded:      '✅ Đã thêm khoản nợ: {name} - {amount}',
      toastDebtPaid:       '✅ Đã đánh dấu đã trả: {name} - {amount}',
      toastDebtDeleted:    '✅ Đã xóa khoản nợ: {name}',
      toastIncomeAdded:    '✅ Đã thêm vào Thu nhập: Thu nợ từ {name}',
      noDebtsYet:          'Chưa có khoản nợ nào.',
      noDebtsHint:         'Nhấn <strong>Thêm nợ mới</strong> để bắt đầu theo dõi.',
      historyTitle:        'LỊCH SỬ ĐÃ TRẢ',
      toggleHistory:       'Xem lịch sử',
      emptyHistory:        'Chưa có khoản nợ nào được trả.',
      btnClose:            'Đóng'
    },
    en: {
      debtSummaryTitle:    'POCKET DEBT',
      debtSummarySub:      'Total Money Lent Out',
      totalPendingDebt:    'Total Pending Debt',
      ledgerTitle:         'DEBT LEDGER',
      colDebtor:           'Debtor',
      colAmount:           'Amount',
      colDateBorrowed:     'Borrowed Date',
      colExpectedReturn:   'Expected Return',
      colStatus:           'Status',
      colActions:          'Actions',
      statusPending:       'Pending',
      statusPaid:          'Paid',
      statusOverdue:       'Overdue',
      btnMarkPaid:         'Mark Paid',
      btnAddDebt:          'Add New Debt',
      btnDelete:           'Delete',
      modalTitle:          'Add New Debt',
      labelDebtorName:     'Debtor Name',
      labelAmount:         'Amount (VND)',
      labelDateBorrowed:   'Date Borrowed',
      labelExpectedReturn: 'Expected Return',
      labelNote:           'Note',
      placeholderDebtor:   'e.g. John, Sarah...',
      placeholderAmount:   '0',
      placeholderNote:     'e.g. Lunch money, Emergency loan...',
      btnCancel:           'Cancel',
      btnSave:             'Save',
      modalTitleEdit:      'Edit Debt Info',
      confirmMarkPaid:     'Mark "{name}" as paid ({amount})?',
      confirmAddToIncome:  'Add this debt to CashFlow Income as "Debt Collection"?',
      confirmDelete:       'Delete debt from "{name}" ({amount})?',
      toastDebtAdded:      '✅ Added debt: {name} - {amount}',
      toastDebtPaid:       '✅ Marked paid: {name} - {amount}',
      toastDebtDeleted:    '✅ Deleted debt: {name}',
      toastIncomeAdded:    '✅ Added to Income: Debt collection from {name}',
      noDebtsYet:          'No debts yet.',
      noDebtsHint:         'Click <strong>Add New Debt</strong> to start tracking.',
      historyTitle:        'PAID HISTORY',
      toggleHistory:       'View History',
      emptyHistory:        'No paid debts yet.',
      btnClose:            'Close'
    }
  };

  function _pd_t(key) {
    var lang = _getCFLang();
    var dict = POCKET_DEBT_I18N[lang] || POCKET_DEBT_I18N['vi'];
    return dict[key] || (POCKET_DEBT_I18N['vi'][key] || key);
  }

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
  let _cashFlowMeta = {        // Cloud-synced meta: netWorthOffset, savingsBalance, initBank, initCash
    netWorthOffset: 0,
    savingsBalance: 0,
    initBank: 0,
    initCash: 0
  };
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

  // ── Edit state ──
  let _editingTxId   = null;  // Current transaction being edited, or null
  let _editingDebtId = null;  // Current debt being edited, or null

  // ============================================================
  //   AI ADVISOR PERSISTENT STATE
  //   Survives destroy()/render() cycles, enables background execution
  // ============================================================

  let _aiState = {
    provider: 'gemini',              // Persisted in localStorage
    isLoading: false,                // Programmatic flag
    currentResponse: '',             // Last complete response (markdown)
    conversationHistory: [],         // [{ role, content, timestamp }]
    lastPrompt: '',                  // Last user query
    abortController: null,           // Active request AbortController
    lastError: null,                 // Last error for retry UI
    requestId: 0                     // For deduplication
  };

  function _loadAIState() {
    try {
      const saved = localStorage.getItem('hub_cf_ai_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        _aiState.provider = parsed.provider || 'gemini';
        _aiState.conversationHistory = parsed.conversationHistory || [];
        _aiState.currentResponse = parsed.currentResponse || '';
        // Don't restore isLoading from disk — check in-flight request instead
      }
    } catch (_) {}
  }

  function _saveAIState() {
    try {
      localStorage.setItem('hub_cf_ai_state', JSON.stringify({
        provider: _aiState.provider,
        conversationHistory: _aiState.conversationHistory,
        currentResponse: _aiState.currentResponse
      }));
    } catch (_) {}
  }

  // ============================================================
  //   DEFAULT DATA
  // ============================================================

  function _defaultData() {
    return {
      startingBalance: 0,
      balanceSnapshots: [],  // { year, month, accountId, amount }
      transactions: [],       // { id, type, amount, day, month, year, desc, category, source, createdAt }
      debts: []               // { id, debtorName, amount, dateBorrowed, expectedReturnDate, status, note, paidAt, createdAt }
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

    // Show loading state immediately
    console.log('[CashFlow] Loading data from Firebase...');

    // ── 1. Load BOTH data and meta in parallel from HubDB ──
    // NO FALLBACKS — use the REAL functions from database.js.
    // If they throw, let the error bubble up so we see it in console.
    var loaded = await HubDB.loadCashFlowData();
    var meta = await HubDB.loadCashFlowMeta();

    // ── 2. Apply meta FIRST (loadCashFlowMeta returns defaults if missing) ──
    _cashFlowMeta.netWorthOffset = meta.netWorthOffset;
    _cashFlowMeta.savingsBalance = meta.savingsBalance;
    _cashFlowMeta.initBank = meta.initBank;
    _cashFlowMeta.initCash = meta.initCash;

    // ── 3. Initialize state based on transaction load result ──
    if (loaded && Array.isArray(loaded.transactions)) {
      // Data found (from cloud, IndexedDB, or localStorage)
      _data = loaded;
      _ensureDefault();
      _isDataLoaded = true;
      _isOfflineMode = false;
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

    _sessionLoaded = true;
    console.log('[CashFlow] Data loaded successfully. Meta:', _cashFlowMeta);
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

  /** Debounced persist for meta (netWorthOffset, savingsBalance, initBank, initCash).
   *  Meta writes are lightweight — no offline guard needed. */
  function _debouncedPersistMeta() {
    if (typeof HubDebounce !== 'undefined') {
      HubDebounce.call('cf-meta', function () {
        if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
          HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (_) {});
        }
      }, SAVE_DELAY);
    } else {
      if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
        HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (_) {});
      }
    }
  }

  function _debouncedPersist() {
    if (typeof HubDebounce !== 'undefined') {
      HubDebounce.call('cashflow', _persist, SAVE_DELAY);
    } else {
      _persist();
    }
  }

  function _ensureDefault() {
    if (!_data) _data = _defaultData();
    if (!Array.isArray(_data.transactions)) _data.transactions = [];
    if (!Array.isArray(_data.balanceSnapshots)) _data.balanceSnapshots = [];
    if (!Array.isArray(_data.debts)) _data.debts = [];
    if (typeof _data.startingBalance !== 'number') _data.startingBalance = 0;

    // 🔑 BACKWARD COMPATIBILITY: Default missing source to 'uncategorized'
    _data.transactions.forEach(function (tx) {
      if (!tx.source) tx.source = 'uncategorized';
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DEBT UTILITIES
  // ══════════════════════════════════════════════════════════════

  function _generateDebtId() {
    return 'debt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _formatDateISOtoVN(isoDate) {
    if (!isoDate) return '—';
    var parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return String(parts[2]).padStart(2, '0') + '/' + String(parts[1]).padStart(2, '0') + '/' + parts[0];
  }

  function _getDebtStatus(debt) {
    if (debt.status === 'paid') return 'paid';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var expected = new Date(debt.expectedReturnDate + 'T00:00:00');
    if (expected < today) return 'overdue';
    return 'pending';
  }

  function _getStatusClass(status) {
    return 'hub-cf-debt-status--' + status;
  }

  function _getStatusLabel(status) {
    var map = { pending: 'statusPending', paid: 'statusPaid', overdue: 'statusOverdue' };
    return _pd_t(map[status] || 'statusPending');
  }

  function _ensureDebtData() {
    if (!_data) _data = _defaultData();
    if (!Array.isArray(_data.debts)) _data.debts = [];
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

  /** Lookup category name for display with emoji mapping for legacy data */
  function _categoryDisplayName(catId, type) {
    var cat = _lookupCategory(catId, type);
    var displayName = cat.nameVI || cat.name || catId;

    // Backward compatibility: map legacy names (without emojis) to new emoji versions
    if (CATEGORY_ICONS[displayName]) {
      return CATEGORY_ICONS[displayName];
    }
    // Also check if the name already has an emoji (starts with emoji char)
    // If not, and it's not in our map, return as-is
    return displayName;
  }

  /** Calculate running cash balance (all-time) */
  function _calcCashBalance() {
    if (!_data || !_data.transactions) return 0;
    let cashIncome = 0;
    let cashExpense = 0;
    _data.transactions.forEach(function (tx) {
      if (tx.source !== 'cash') return;
      if (tx.type === 'income') cashIncome += (tx.amount || 0);
      else cashExpense += (tx.amount || 0);
    });
    // Add initial balance offset from meta (synced via Firestore)
    var initCash = _cashFlowMeta.initCash || 0;
    return cashIncome - cashExpense + initCash;
  }

  /** Calculate running bank balance (all-time) */
  function _calcBankBalance() {
    if (!_data || !_data.transactions) return 0;
    let bankIncome = 0;
    let bankExpense = 0;
    _data.transactions.forEach(function (tx) {
      if (tx.source !== 'bank') return;
      if (tx.type === 'income') bankIncome += (tx.amount || 0);
      else bankExpense += (tx.amount || 0);
    });
    // Add initial balance offset from meta (synced via Firestore)
    var initBank = _cashFlowMeta.initBank || 0;
    return bankIncome - bankExpense + initBank;
  }

  /** Calculate running uncategorized balance (all-time) — NEW */
  function _calcUncategorizedBalance() {
    if (!_data || !_data.transactions) return 0;
    let uncategorizedIncome = 0;
    let uncategorizedExpense = 0;
    _data.transactions.forEach(function (tx) {
      if (tx.source !== 'uncategorized') return;
      if (tx.type === 'income') uncategorizedIncome += (tx.amount || 0);
      else uncategorizedExpense += (tx.amount || 0);
    });
    return uncategorizedIncome - uncategorizedExpense;
  }

  /** Calculate running savings balance (all-time) from transactions */
  function _calcSavingsBalance() {
    if (!_data || !_data.transactions) return 0;
    let savingsIncome = 0;
    let savingsExpense = 0;
    _data.transactions.forEach(function (tx) {
      if (tx.source !== 'savings') return;
      if (tx.type === 'income') savingsIncome += (tx.amount || 0);
      else savingsExpense += (tx.amount || 0);
    });
    // Add initial balance offset from meta (synced via Firestore)
    var initSavings = _cashFlowMeta.savingsBalance || 0;
    return savingsIncome - savingsExpense + initSavings;
  }

  /** Calculate monthly cash flow for chart */
  function _getMonthlyCashFlow(year, month) {
    if (!_data || !_data.transactions) return { cashIncome: 0, cashExpense: 0, bankIncome: 0, bankExpense: 0, uncategorizedIncome: 0, uncategorizedExpense: 0, savingsIncome: 0, savingsExpense: 0 };
    const txs = _getMonthTransactions(year, month);
    let cashIncome = 0, cashExpense = 0, bankIncome = 0, bankExpense = 0, uncategorizedIncome = 0, uncategorizedExpense = 0, savingsIncome = 0, savingsExpense = 0;
    txs.forEach(function (tx) {
      if (tx.type === 'income') {
        if (tx.source === 'cash') cashIncome += tx.amount;
        else if (tx.source === 'bank') bankIncome += tx.amount;
        else if (tx.source === 'uncategorized') uncategorizedIncome += tx.amount;
        else if (tx.source === 'savings') savingsIncome += tx.amount;
      } else {
        if (tx.source === 'cash') cashExpense += tx.amount;
        else if (tx.source === 'bank') bankExpense += tx.amount;
        else if (tx.source === 'uncategorized') uncategorizedExpense += tx.amount;
        else if (tx.source === 'savings') savingsExpense += tx.amount;
      }
    });
    return { cashIncome, cashExpense, bankIncome, bankExpense, uncategorizedIncome, uncategorizedExpense, savingsIncome, savingsExpense };
  }

  // ============================================================
//   AI STATE RESTORATION (called from render after HTML injection)
// ============================================================

function _restoreAIState() {
  const responseEl = _qs('#cf-ai-response');
  const providerSelect = _qs('#cf-ai-provider');
  const promptInput = _qs('#cf-ai-prompt');
  const askBtn = _qs('#cf-ai-ask-btn');

  // Restore provider selection
  if (providerSelect) {
    providerSelect.value = _aiState.provider;
    // Don't add listener here — _bindEvents will handle it
  }

  if (_aiState.isLoading && _aiState.abortController) {
    // Request still in flight — restore loading UI
    if (responseEl) {
      responseEl.classList.add('loading');
      responseEl.textContent = 'Đang phân tích... (tiếp tục ở nền)';
    }
    if (promptInput) promptInput.disabled = true;
    if (askBtn) {
      askBtn.disabled = true;
      askBtn.textContent = 'Đang hỏi...';
    }
  } else if (_aiState.currentResponse) {
    // Has cached response — restore it
    if (responseEl) {
      _renderAIResponse(_aiState.currentResponse);
    }
    // Re-enable input
    if (promptInput) promptInput.disabled = false;
    if (askBtn) {
      askBtn.disabled = false;
      askBtn.textContent = 'Hỏi';
    }
  } else if (_aiState.lastError) {
    // Has cached error — restore error UI
    if (responseEl) {
      _showAIError(_aiState.lastError);
    }
    if (promptInput) promptInput.disabled = false;
    if (askBtn) {
      askBtn.disabled = false;
      askBtn.textContent = 'Hỏi';
    }
  } else {
    // Default state
    if (responseEl) {
      responseEl.textContent = 'AI Advisor is ready. Ask me about your spending...';
    }
    if (promptInput) promptInput.disabled = false;
    if (askBtn) {
      askBtn.disabled = false;
      askBtn.textContent = 'Hỏi';
    }
  }
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
      // INJECT EDIT BUTTON CSS (Theme-synced)
      // ══════════════════════════════════════════
      if (!document.getElementById('hub-cf-edit-styles')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'hub-cf-edit-styles';
        styleEl.textContent = `/* ============================================================
   EDIT BUTTONS — Theme-synced inline SVG styling
   ============================================================ */

.hub-cf-edit-btn,
.hub-cf-debt-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              background 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform 120ms ease-out;
  opacity: 0.75;
}

.hub-cf-edit-btn:hover,
.hub-cf-debt-edit-btn:hover {
  opacity: 1;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  transform: scale(1.05);
}

.hub-cf-edit-btn:focus-visible,
.hub-cf-debt-edit-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  opacity: 1;
}

.hub-cf-edit-btn:active,
.hub-cf-debt-edit-btn:active {
  transform: scale(0.96);
}

.hub-cf-edit-btn svg,
.hub-cf-debt-edit-btn svg {
  display: block;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  stroke: currentColor;
}

/* Actions container for flex layout with gap */
.hub-cf-tx-actions,
.hub-cf-debt-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}

/* ============================================================
   DASHBOARD SUMMARY CONTAINER — Sync with glass-card panels
   ============================================================ */

.hub-cf-dashboard {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* ============================================================
   6-COLUMN GRID LAYOUT — Balanced Symmetrical Cards
   ============================================================ */

.cashflow-summary-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
  margin-bottom: 16px;
  align-items: start;
  width: 100%;
  box-sizing: border-box;
}

/* Force Pocket Debt to span full width */
.cashflow-summary-grid .hub-cf-debt-summary-card--fullwidth {
  grid-column: 1 / -1;
}

/* 6-Column Spanning Rules (Desktop) */

/* Row 1: Net Worth (1), Savings (2), Bank (3) — each 1/3 width */
.cashflow-summary-grid .hub-cf-card:nth-child(1),  /* Net Worth */
.cashflow-summary-grid .hub-cf-card:nth-child(2),  /* Savings */
.cashflow-summary-grid .hub-cf-card:nth-child(3) { /* Bank Account */
  grid-column: span 2;
}

/* Row 2: Cash (4), Uncategorized (5) — each 1/2 width */
.cashflow-summary-grid .hub-cf-card:nth-child(4),  /* Cash Wallet */
.cashflow-summary-grid .hub-cf-card:nth-child(5) { /* Uncategorized */
  grid-column: span 3;
}

/* Row 3: Income (6), Expense (7) — each 1/2 width, side by side */
.cashflow-summary-grid .hub-cf-card:nth-child(6),  /* Income */
.cashflow-summary-grid .hub-cf-card:nth-child(7) { /* Expense */
  grid-column: span 3;
}

/* Mobile Responsiveness: Stack all cards vertically */
@media (max-width: 768px) {
  .cashflow-summary-grid {
    grid-template-columns: 1fr;
  }
  .cashflow-summary-grid .hub-cf-card,
  .cashflow-summary-grid .hub-cf-debt-summary-card--fullwidth {
    grid-column: span 6 !important;
  }
}

/* 3-WAY SOURCE CARDS & WARNING STATE */

/* Prevent text overflow in all cards */
.hub-cf-card {
  word-wrap: break-word;
  overflow-wrap: break-word;
  white-space: normal;
  min-width: 0; /* Critical: allows grid items to shrink below content size */
}

.hub-cf-card-value {
  word-break: break-word;
  overflow-wrap: anywhere;
}

.hub-cf-card-label,
.hub-cf-card-sub {
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Source cards (Bank, Cash, Uncategorized) */
.hub-cf-card--source {
  position: relative;
  border-left: 3px solid var(--primary);
}

.hub-cf-card--bank { border-left-color: var(--info, #00bcd4); }
.hub-cf-card--cash { border-left-color: var(--success, #00e676); }
.hub-cf-card--uncategorized { border-left-color: var(--accent-secondary, #ffb300); }

/* Warning state: Uncategorized balance > 0 */
.hub-cf-card--uncategorized.hub-cf-card--has-uncategorized {
  border-left-color: var(--accent-secondary, #ffb300);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-secondary) 40%, transparent);
}

.hub-cf-card--uncategorized.hub-cf-card--has-uncategorized .hub-cf-card-value--uncategorized {
  color: var(--accent-secondary, #ffb300);
  text-shadow: 0 0 8px color-mix(in srgb, var(--accent-secondary) 60%, transparent);
}

/* ============================================================
   EDIT BUTTONS FOR SUMMARY CARDS — Fixed positioning
   ============================================================ */

/* Parent card must be relative for absolute positioning of edit btn */
.hub-cf-card {
  position: relative;
}

/* Edit button inside summary cards */
.hub-cf-card-edit-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              background 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
              transform 120ms ease-out;
  opacity: 0.7;
  font-size: 12px;
  line-height: 1;
}

.hub-cf-card-edit-btn:hover {
  opacity: 1;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  transform: scale(1.05);
}

.hub-cf-card-edit-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  opacity: 1;
}

.hub-cf-card-edit-btn:active {
  transform: scale(0.96);
}

.hub-cf-card-edit-btn svg {
  display: block;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  stroke: currentColor;
}

/* Value row layout for cards with edit button */
.hub-cf-card-value-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.hub-cf-card-icon {
  font-size: 1.1rem;
  opacity: 0.8;
}

.hub-cf-card-value--networth { color: var(--primary); }
.hub-cf-card-value--savings { color: var(--success, #00e676); }
.hub-cf-card-value--bank { color: var(--info, #00bcd4); }
.hub-cf-card-value--cash { color: var(--success, #00e676); }
.hub-cf-card-value--uncategorized { color: var(--text-muted); transition: color 0.3s ease; }
.hub-cf-card-value--income { color: var(--success, #00e676); }
.hub-cf-card-value--expense { color: var(--danger, #ff5252); }
.hub-cf-card-value--debt { color: var(--warning, #ffb300); }

/* Source badge in transaction table */
.hub-cf-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 0.7rem;
  margin-left: 6px;
  flex-shrink: 0;
}

.hub-cf-source-badge--bank {
  background: color-mix(in srgb, var(--info, #00bcd4) 20%, transparent);
  color: var(--info, #00bcd4);
  border: 1px solid color-mix(in srgb, var(--info, #00bcd4) 40%, transparent);
}

.hub-cf-source-badge--cash {
  background: color-mix(in srgb, var(--success, #00e676) 20%, transparent);
  color: var(--success, #00e676);
  border: 1px solid color-mix(in srgb, var(--success, #00e676) 40%, transparent);
}

.hub-cf-source-badge--uncategorized {
  background: color-mix(in srgb, var(--accent-secondary, #ffb300) 20%, transparent);
  color: var(--accent-secondary, #ffb300);
  border: 1px solid color-mix(in srgb, var(--accent-secondary, #ffb300) 40%, transparent);
}

.hub-cf-source-badge--savings {
  background: color-mix(in srgb, var(--success, #00e676) 20%, transparent);
  color: var(--success, #00e676);
  border: 1px solid color-mix(in srgb, var(--success, #00e676) 40%, transparent);
}

/* Category chip + badge inline */
.hub-cf-cat-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 6px);
  font-size: 0.68rem;
  font-weight: 500;
  background: color-mix(in srgb, var(--primary) 15%, transparent);
  color: var(--primary);
  margin-right: 4px;
}';
        document.head.appendChild(styleEl);
      }`;
        document.head.appendChild(styleEl);
      }

      // ══════════════════════════════════════════
      // HTML STRUCTURE
      // ══════════════════════════════════════════
      container.innerHTML = `
<div class="hub-cf-container">

  <!-- ═══ DASHBOARD — Summary Section ═══ -->
  <div class="hub-cf-dashboard glass-card">
    <div class="cashflow-summary-grid">

      <!-- Card 1: Net Worth (Grand Total) — WITH EDIT BUTTON -->
      <div class="hub-cf-card hub-cf-card--networth">
        <span class="hub-cf-card-label" data-i18n="netWorthLabel">${_t('netWorthLabel')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--networth" id="cf-networth">0 ₫</span>
          <button class="hub-cf-card-edit-btn" id="btn-edit-networth" data-target="net-worth" title="Chỉnh sửa Tổng Tài Sản" aria-label="Chỉnh sửa Tổng Tài Sản">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        <span class="hub-cf-card-sub" data-i18n="netWorthSub">${_t('netWorthSub')}</span>
      </div>

      <!-- Card 2: Savings / Investments -->
      <div class="hub-cf-card hub-cf-card--savings">
        <span class="hub-cf-card-label" data-i18n="savingsLabel">${_t('savingsLabel')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--savings" id="cf-savings">0 ₫</span>
          <button class="hub-cf-card-edit-btn" data-target="savings" title="Edit Savings & Investments" aria-label="Edit Savings & Investments">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        <span class="hub-cf-card-sub" data-i18n="savingsSub">${_t('savingsSub')}</span>
      </div>

      <!-- Card 3: CHUYỂN KHOẢN (Bank Balance) -->
      <div class="hub-cf-card hub-cf-card--source hub-cf-card--bank">
        <span class="hub-cf-card-label" data-i18n="bankAccountLabel">${_t('bankAccountLabel')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--bank" id="cf-bank-balance">0 ₫</span>
          <button class="hub-cf-card-edit-btn" id="btn-edit-bank" data-target="bank" title="Edit Bank Account Balance" aria-label="Edit Bank Account Balance">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        <span class="hub-cf-card-sub" data-i18n="bankAccountSub">${_t('bankAccountSub')}</span>
      </div>

      <!-- Card 4: TIỀN MẶT (Cash Wallet Balance) -->
      <div class="hub-cf-card hub-cf-card--source hub-cf-card--cash">
        <span class="hub-cf-card-label" data-i18n="cashWalletLabel">${_t('cashWalletLabel')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--cash" id="cf-cash-balance">0 ₫</span>
          <button class="hub-cf-card-edit-btn" id="btn-edit-cash" data-target="cash" title="Edit Cash Wallet Balance" aria-label="Edit Cash Wallet Balance">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
        <span class="hub-cf-card-sub" data-i18n="cashWalletSub">${_t('cashWalletSub')}</span>
      </div>

      <!-- Card 5: CHƯA PHÂN LOẠI (Uncategorized Balance) -->
      <div class="hub-cf-card hub-cf-card--source hub-cf-card--uncategorized" id="cf-uncategorized-card">
        <span class="hub-cf-card-label" data-i18n="uncategorizedLabel">${_t('uncategorizedLabel')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--uncategorized" id="cf-uncategorized-balance">0 ₫</span>
          <span class="hub-cf-card-icon" aria-hidden="true">❓</span>
        </div>
        <span class="hub-cf-card-sub" data-i18n="uncategorizedSub">${_t('uncategorizedSub')}</span>
      </div>

      <!-- Card 6: Income (Monthly) -->
      <div class="hub-cf-card hub-cf-card--income-monthly">
        <span class="hub-cf-card-label" data-i18n="incomeLabel">${_t('incomeLabel')}</span>
        <span class="hub-cf-card-value hub-cf-card-value--income" id="cf-income">0 ₫</span>
      </div>

      <!-- Card 7: Expense (Monthly) -->
      <div class="hub-cf-card hub-cf-card--expense-monthly">
        <span class="hub-cf-card-label" data-i18n="expenseLabel">${_t('expenseLabel')}</span>
        <span class="hub-cf-card-value hub-cf-card-value--expense" id="cf-expense">0 ₫</span>
      </div>

      <!-- Card 8: Pocket Debt (Sổ nợ bỏ túi) — Full Width -->
      <div class="hub-cf-card hub-cf-debt-summary-card hub-cf-debt-summary-card--fullwidth">
        <span class="hub-cf-card-label" data-i18n="debtSummaryTitle">${_pd_t('debtSummaryTitle')}</span>
        <div class="hub-cf-card-value-row">
          <span class="hub-cf-card-value hub-cf-card-value--debt" id="cf-debt-pending">${_formatVNFull(_getTotalPendingDebt())}</span>
          <span class="hub-cf-card-sub" data-i18n="totalPendingDebt">${_pd_t('totalPendingDebt')}</span>
        </div>
      </div>

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

    <!-- Segmented Tab Switcher -->
    <div class="hub-cf-tab-switcher" role="tablist" aria-label="${_escHtml('View mode')}">
      <button class="hub-cf-tab-switcher-btn" role="tab" data-view="ledger" aria-selected="true" id="hub-cf-tab-ledger">
        <span class="hub-cf-tab-switcher-icon">📋</span>
        <span class="hub-cf-tab-switcher-label" data-i18n="tabLedger">Lịch sử</span>
      </button>
      <button class="hub-cf-tab-switcher-btn" role="tab" data-view="stats" aria-selected="false" id="hub-cf-tab-stats">
        <span class="hub-cf-tab-switcher-icon">📊</span>
        <span class="hub-cf-tab-switcher-label" data-i18n="tabStats">Thống kê</span>
      </button>
    </div>

    <!-- HISTORY VIEW: Empty state + Transaction Table -->
    <div class="hub-cf-view-wrapper" id="hub-cf-history-view">
      <!-- Empty state -->
      <div class="hub-cf-empty" id="hub-cf-empty-state" style="display:none;">
        <span class="hub-cf-empty-icon">📋</span>
        <p class="hub-cf-empty-text" data-i18n="noTxYet">${_t('noTxYet')}</p>
        <p class="hub-cf-empty-hint" data-i18n="noTxHint">${_t('noTxHint')}</p>
      </div>

      <!-- Transaction Table -->
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

    <!-- STATS VIEW: Category Breakdown -->
    <div class="hub-cf-view-wrapper" id="hub-cf-stats-view" style="display:none;">
      <div class="hub-cf-category-breakdown" id="hub-cf-breakdown-section">
        <p class="hub-cf-breakdown-title" data-i18n="categoryTitle">${_t('categoryTitle')}</p>
        <div id="hub-cf-breakdown-content"></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ POCKET DEBT LEDGER ═══ -->
<div class="hub-cf-debt-ledger glass-card">
  <div class="hub-cf-debt-header">
    <h4 class="hub-cf-debt-title" data-i18n="ledgerTitle">${_pd_t('ledgerTitle')}</h4>
    <div class="hub-cf-debt-actions">
      <button class="hub-cf-btn hub-cf-btn--add-debt" id="hub-cf-btn-add-debt">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span data-i18n="btnAddDebt">${_pd_t('btnAddDebt')}</span>
      </button>
      <button class="hub-cf-btn hub-cf-btn--ghost hub-cf-debt-history-toggle" id="hub-cf-debt-history-toggle" data-i18n="toggleHistory" aria-label="${_pd_t('toggleHistory')}">${_pd_t('toggleHistory')}</button>
    </div>
  </div>

  <!-- Empty state -->
  <div class="hub-cf-debt-empty" id="hub-cf-debt-empty-state" style="display:none;">
    <span class="hub-cf-debt-empty-icon">📓</span>
    <p class="hub-cf-debt-empty-text" data-i18n="noDebtsYet">${_pd_t('noDebtsYet')}</p>
    <p class="hub-cf-debt-empty-hint" data-i18n="noDebtsHint">${_pd_t('noDebtsHint')}</p>
  </div>

  <!-- Active Debts Table -->
  <div class="hub-cf-debt-table-wrap" id="hub-cf-debt-table-wrap" style="display:none;">
    <table class="hub-cf-debt-table">
      <thead>
        <tr>
          <th class="hub-cf-debt-col--debtor" data-i18n="colDebtor">${_pd_t('colDebtor')}</th>
          <th class="hub-cf-debt-col--amount" data-i18n="colAmount">${_pd_t('colAmount')}</th>
          <th class="hub-cf-debt-col--date" data-i18n="colDateBorrowed">${_pd_t('colDateBorrowed')}</th>
          <th class="hub-cf-debt-col--expected" data-i18n="colExpectedReturn">${_pd_t('colExpectedReturn')}</th>
          <th class="hub-cf-debt-col--status" data-i18n="colStatus">${_pd_t('colStatus')}</th>
          <th class="hub-cf-debt-col--actions" data-i18n="colActions">${_pd_t('colActions')}</th>
        </tr>
      </thead>
      <tbody id="hub-cf-debt-body"></tbody>
    </table>
  </div>
</div>

<!-- ═══ AI FINANCIAL ADVISOR ═══ -->
<div class="hub-cf-ai-advisor glass-card">
  <div class="hub-cf-ai-header">
    <h4 class="hub-cf-ai-title">🤖 AI Financial Advisor</h4>
    <select id="cf-ai-provider" class="hub-cf-ai-select">
      <option value="gemini">Gemini 3.7 Flash</option>
      <option value="nvidia">Nvidia Nemotron 3 Ultra</option>
    </select>
    <button id="cf-ai-settings-btn" class="hub-cf-ai-settings-btn" title="Cài đặt API Key" aria-label="Cài đặt API Key">⚙️</button>
  </div>
  <div id="cf-ai-response" class="cf-ai-response-box">AI Advisor is ready. Ask me about your spending...</div>
  <div class="hub-cf-ai-input-row">
    <input type="text" id="cf-ai-prompt" class="hub-cf-ai-input" placeholder="Hỏi về chi tiêu tháng này (VD: Tiền ăn hết bao nhiêu?)..." autocomplete="off" data-lpignore="true" data-form-type="other">
    <button id="cf-ai-ask-btn" class="hub-cf-ai-btn">Hỏi</button>
  </div>
</div>

<!-- ═══ AI KEY MANAGEMENT MODAL ═══ -->
<div id="cf-ai-key-modal" class="hub-cf-ai-key-modal" role="dialog" aria-modal="true" aria-label="AI API Key Management" style="display:none;">
  <div class="hub-cf-ai-key-modal-content glass">
    <div class="hub-cf-ai-key-modal-header">
      <h4>🔑 AI API Key Management</h4>
      <button id="cf-key-close" class="hub-cf-ai-key-modal-close" aria-label="Close">✕</button>
    </div>
    <div class="hub-cf-ai-key-modal-body">
      <div class="hub-cf-ai-key-group">
        <label for="cf-key-gemini">Gemini API Key</label>
        <input type="password" id="cf-key-gemini" class="hub-cf-ai-key-input" placeholder="Nhập Gemini API Key..." autocomplete="new-password" spellcheck="false">
      </div>
      <div class="hub-cf-ai-key-group">
        <label for="cf-key-nvidia">Nvidia NIM API Key</label>
        <input type="password" id="cf-key-nvidia" class="hub-cf-ai-key-input" placeholder="Nhập Nvidia NIM API Key..." autocomplete="new-password" spellcheck="false">
      </div>
      <div class="hub-cf-ai-key-actions">
        <button id="cf-key-save" class="hub-cf-ai-key-btn hub-cf-ai-key-btn--save">Lưu Keys</button>
        <button id="cf-key-clear" class="hub-cf-ai-key-btn hub-cf-ai-key-btn--clear">Xóa Keys</button>
        <button id="cf-key-close-bottom" class="hub-cf-ai-key-btn hub-cf-ai-key-btn--close">Đóng</button>
      </div>
    </div>
  </div>
</div>

<!-- ═══ QUICK-ADD MODAL (injected into container) ═══ -->
<div class="hub-cf-overlay" id="hub-cf-overlay" role="dialog" aria-modal="true" aria-label="${_t('modalTitle')}" style="display:none;">
  <div class="hub-cf-modal glass">
    <div class="hub-cf-modal-header">
      <h3 class="hub-cf-modal-title" data-i18n="modalTitle">${_t('modalTitle')}</h3>
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
          <label class="hub-cf-form-label" for="hub-cf-source" data-i18n="labelSource">${_t('labelSource')}</label>
          <select id="hub-cf-source" class="hub-cf-form-input hub-cf-source-select" required>
            <option value="uncategorized" data-i18n="sourceUncategorized">${_t('sourceUncategorized')}</option>
            <option value="bank" data-i18n="sourceBank">${_t('sourceBank')}</option>
            <option value="cash" data-i18n="sourceCash">${_t('sourceCash')}</option>
            <option value="savings" data-i18n="sourceSavings">${_t('sourceSavings')}</option>
          </select>
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
</div>

<!-- ═══ ADD DEBT MODAL ═══ -->
<div class="hub-cf-overlay" id="hub-cf-debt-overlay" role="dialog" aria-modal="true" aria-label="${_pd_t('modalTitle')}" style="display:none;">
  <div class="hub-cf-modal hub-cf-debt-modal glass">
    <div class="hub-cf-modal-header">
      <h3 class="hub-cf-modal-title" data-i18n="modalTitle">${_pd_t('modalTitle')}</h3>
      <button class="hub-cf-modal-close" id="hub-cf-debt-modal-close" aria-label="Close modal">✕</button>
    </div>

    <div class="hub-cf-modal-body">
      <form id="hub-cf-debt-form" autocomplete="off">
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-debt-debtor" data-i18n="labelDebtorName">${_pd_t('labelDebtorName')}</label>
          <input type="text" id="hub-cf-debt-debtor" class="hub-cf-form-input"
                 placeholder="${_pd_t('placeholderDebtor')}" maxlength="80" required />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-debt-amount" data-i18n="labelAmount">${_pd_t('labelAmount')}</label>
          <input type="number" id="hub-cf-debt-amount" class="hub-cf-form-input hub-cf-amount-input"
                 placeholder="${_pd_t('placeholderAmount')}" min="0" step="1000" required inputmode="numeric" />
        </div>
        <div class="hub-cf-form-grid">
          <div class="hub-cf-form-group">
            <label class="hub-cf-form-label" for="hub-cf-debt-date-borrowed" data-i18n="labelDateBorrowed">${_pd_t('labelDateBorrowed')}</label>
            <input type="date" id="hub-cf-debt-date-borrowed" class="hub-cf-form-input hub-cf-date-input" required />
          </div>
          <div class="hub-cf-form-group">
            <label class="hub-cf-form-label" for="hub-cf-debt-expected-return" data-i18n="labelExpectedReturn">${_pd_t('labelExpectedReturn')}</label>
            <input type="date" id="hub-cf-debt-expected-return" class="hub-cf-form-input hub-cf-date-input" required />
          </div>
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-debt-note" data-i18n="labelNote">${_pd_t('labelNote')}</label>
          <textarea id="hub-cf-debt-note" class="hub-cf-form-input hub-cf-textarea"
                    placeholder="${_pd_t('placeholderNote')}" maxlength="200" rows="2"></textarea>
        </div>
        <div class="hub-cf-form-actions">
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--cancel" id="hub-cf-debt-btn-cancel" data-i18n="btnCancel">${_pd_t('btnCancel')}</button>
          <button type="submit" class="hub-cf-modal-btn hub-cf-modal-btn--save" id="hub-cf-debt-btn-save" data-i18n="btnSave">${_pd_t('btnSave')}</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- ═══ PAID HISTORY MODAL ═══ -->
<div class="hub-cf-overlay" id="hub-cf-debt-history-overlay" role="dialog" aria-modal="true" aria-label="${_pd_t('historyTitle')}" style="display:none;">
  <div class="hub-cf-modal hub-cf-debt-history-modal glass">
    <div class="hub-cf-modal-header">
      <h3 class="hub-cf-modal-title" data-i18n="historyTitle">${_pd_t('historyTitle')}</h3>
      <button class="hub-cf-modal-close" id="hub-cf-debt-history-modal-close" aria-label="${_pd_t('btnClose')}">✕</button>
    </div>
    <div class="hub-cf-modal-body">
      <div class="hub-cf-debt-history-modal-empty" id="hub-cf-debt-history-modal-empty" style="display:none;">
        <span class="hub-cf-debt-empty-icon">📓</span>
        <p class="hub-cf-debt-empty-text" data-i18n="emptyHistory">${_pd_t('emptyHistory')}</p>
      </div>
      <div class="hub-cf-debt-history-modal-list" id="hub-cf-debt-history-modal-list"></div>
    </div>
  </div>
</div>`;

      // ══════════════════════════════════════════
      // RESTORE AI ADVISOR STATE (persistent across tab switches)
      // ══════════════════════════════════════════
      // Load persisted AI state on first render
      if (!_aiState._initialized) {
        _loadAIState();
        _aiState._initialized = true;
      }

      // Restore AI Advisor UI from persistent state
      _restoreAIState();

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
    _refreshDebtSummary();
    _refreshDebtLedger();
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
    _updateDebtLanguage();
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
   * NEW FORMULA: Net Worth = Bank + Cash + Uncategorized + netWorthOffset
   * EXPLICITLY EXCLUDES Savings/Investments
   *
   * @returns {number} Current live net worth (liquid assets only)
   */
  function _computeLiveNetWorth() {
    if (!_data || !_data.transactions) return _cashFlowMeta.netWorthOffset || 0;

    // All-time balances per source (liquid assets only)
    var cashBalance = _calcCashBalance();
    var bankBalance = _calcBankBalance();
    var uncategorizedBalance = _calcUncategorizedBalance();

    // Net Worth = Bank + Cash + Uncategorized + offset
    return bankBalance + cashBalance + uncategorizedBalance + (_cashFlowMeta.netWorthOffset || 0);
  }

  function updateDashboardTotals() {
    // ═══ GUARD: no data yet ═══
    if (!_data || !_data.transactions) {
      _setTextById('cf-networth', '0 ₫');
      _setTextById('cf-savings',  '0 ₫');
      _setTextById('cf-bank-balance', '0 ₫');
      _setTextById('cf-cash-balance', '0 ₫');
      _setTextById('cf-uncategorized-balance', '0 ₫');
      _setTextById('cf-income',   '0 ₫');
      _setTextById('cf-expense',  '0 ₫');
      // Reset warning state
      const uncCard = document.getElementById('cf-uncategorized-card');
      if (uncCard) uncCard.classList.remove('hub-cf-card--has-uncategorized');
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
    // ACCOUNTING RULE: Internal transfers to/from Savings are NOT income/expense.
    // Exclude transactions where source === 'savings' OR category === 'Tiết kiệm' / '🐷 Tiết kiệm'.
    var totalIncome = 0;
    var totalExpense = 0;
    var cashIncome = 0, cashExpense = 0, bankIncome = 0, bankExpense = 0, uncIncome = 0, uncExpense = 0, savingsIncome = 0, savingsExpense = 0;
    filteredTxs.forEach(function (tx) {
      var isSavingsRelated = tx.source === 'savings' ||
        tx.category === 'tiet-kiem' ||
        tx.category === 'Tiết kiệm' ||
        tx.category === '🐷 Tiết kiệm';

      if (tx.type === 'income') {
        // Only count as global income if NOT an internal savings transfer
        if (!isSavingsRelated) {
          totalIncome += (tx.amount || 0);
        }
        if (tx.source === 'bank') bankIncome += tx.amount;
        else if (tx.source === 'cash') cashIncome += tx.amount;
        else if (tx.source === 'uncategorized') uncIncome += tx.amount;
        else if (tx.source === 'savings') savingsIncome += tx.amount;
      } else {
        // Only count as global expense if NOT an internal savings transfer
        if (!isSavingsRelated) {
          totalExpense += (tx.amount || 0);
        }
        if (tx.source === 'bank') bankExpense += tx.amount;
        else if (tx.source === 'cash') cashExpense += tx.amount;
        else if (tx.source === 'uncategorized') uncExpense += tx.amount;
        else if (tx.source === 'savings') savingsExpense += tx.amount;
      }
    });

    // ── 3. Net Worth: NEW FORMULA — Liquid assets only (EXCLUDES Savings) ──
    //    Net Worth = Bank + Cash + Uncategorized + netWorthOffset
    var netWorth = _computeLiveNetWorth();

    // ── 4. All-time balances per source ──
    var cashBalance = _calcCashBalance();
    var bankBalance = _calcBankBalance();
    var uncategorizedBalance = _calcUncategorizedBalance();
    var savingsBalance = _calcSavingsBalance();

    // ── 5. Savings: dynamic calculation from transactions + initSavings ──
    var savings = savingsBalance;

    // ═══ 6. WRITE to DOM — full exact numbers, no abbreviation ═══
    _setTextById('cf-networth', _formatVNFull(netWorth));
    _setTextById('cf-savings', _formatVNFull(savings));
    _setTextById('cf-bank-balance', _formatVNFull(bankBalance));
    _setTextById('cf-cash-balance', _formatVNFull(cashBalance));
    _setTextById('cf-uncategorized-balance', _formatVNFull(uncategorizedBalance));
    _setTextById('cf-income', _formatVNFull(totalIncome));
    _setTextById('cf-expense', _formatVNFull(totalExpense));

    // Belt + suspenders
    _setText('#cf-networth', _formatVNFull(netWorth));
    _setText('#cf-savings', _formatVNFull(savings));
    _setText('#cf-bank-balance', _formatVNFull(bankBalance));
    _setText('#cf-cash-balance', _formatVNFull(cashBalance));
    _setText('#cf-uncategorized-balance', _formatVNFull(uncategorizedBalance));
    _setText('#cf-income', _formatVNFull(totalIncome));
    _setText('#cf-expense', _formatVNFull(totalExpense));

    // 🔑 Conditional warning for Uncategorized > 0
    const uncCard = document.getElementById('cf-uncategorized-card');
    if (uncCard) {
      if (uncategorizedBalance > 0) {
        uncCard.classList.add('hub-cf-card--has-uncategorized');
      } else {
        uncCard.classList.remove('hub-cf-card--has-uncategorized');
      }
    }
  }

  /** Calculate savings & investments total */
  function _calcSavings() {
    // Sum nhà ở + tiết kiệm + đầu tư balance snapshots
    if (!_data || !_data.balanceSnapshots) return 0;
    return _data.balanceSnapshots
      .filter(function (s) { return s.accountId === 'tiet-kiem' || s.accountId === 'dau-tu'; })
      .reduce(function (sum, s) { return sum + (s.amount || 0); }, 0);
  }

  // ══════════════════════════════════════════════════════════════
  // DEBT COMPUTATION
  // ══════════════════════════════════════════════════════════════

  function _getTotalPendingDebt() {
    _ensureDebtData();
    return _data.debts
      .filter(function (d) { return _getDebtStatus(d) !== 'paid'; })
      .reduce(function (sum, d) { return sum + (Number(d.amount) || 0); }, 0);
  }

  function _getActiveDebts() {
    _ensureDebtData();
    return _data.debts
      .filter(function (d) { return _getDebtStatus(d) !== 'paid'; })
      .sort(function (a, b) {
        var statusA = _getDebtStatus(a);
        var statusB = _getDebtStatus(b);
        if (statusA === 'overdue' && statusB !== 'overdue') return -1;
        if (statusB === 'overdue' && statusA !== 'overdue') return 1;
        return new Date(a.expectedReturnDate) - new Date(b.expectedReturnDate);
      });
  }

  function _getPaidDebts() {
    _ensureDebtData();
    return _data.debts
      .filter(function (d) { return _getDebtStatus(d) === 'paid'; })
      .sort(function (a, b) { return (b.paidAt || 0) - (a.paidAt || 0); });
  }

  function _refreshLedger() {
    _updateMonthLabel();
    _refreshTransactions();
    _renderCategoryBreakdown();
    // Ensure correct view visibility on data refresh
    if (typeof _switchLedgerView === 'function') {
      _switchLedgerView(_ledgerView || 'ledger');
    }
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
      // Source badge
      var sourceBadge = '';
      if (tx.source === 'bank') {
        sourceBadge = '<span class="hub-cf-source-badge hub-cf-source-badge--bank" title="' + _t('sourceBank') + '">🏦</span>';
      } else if (tx.source === 'cash') {
        sourceBadge = '<span class="hub-cf-source-badge hub-cf-source-badge--cash" title="' + _t('sourceCash') + '">💵</span>';
      } else if (tx.source === 'savings') {
        sourceBadge = '<span class="hub-cf-source-badge hub-cf-source-badge--savings" title="' + _t('sourceSavings') + '">🐷</span>';
      } else {
        sourceBadge = '<span class="hub-cf-source-badge hub-cf-source-badge--uncategorized" title="' + _t('sourceUncategorized') + '">❓</span>';
      }

      html += '<tr class="' + rowClass + '" data-tx-id="' + tx.id + '">';
      html += '<td>' + _formatDate(tx.day, tx.month, tx.year) + '</td>';
      html += '<td title="' + _escapeAttr(tx.desc || '') + '">' + _escHtml(tx.desc || '—') + '</td>';
      html += '<td><span class="hub-cf-cat-chip">' + _escHtml(catName) + '</span> ' + sourceBadge + '</td>';
      html += '<td>' + amountFormatted + '</td>';
      html += '<td>';
      html += '<div class="hub-cf-tx-actions">';
      html += '<button class="hub-cf-edit-btn" data-tx-id="' + tx.id + '" title="Chỉnh sửa" aria-label="Chỉnh sửa giao dịch">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
      html += '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>';
      html += '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>';
      html += '</svg>';
      html += '</button>';
      html += '<button class="hub-cf-delete-btn" data-tx-id="' + tx.id + '" title="Xóa" aria-label="Xóa giao dịch">✕</button>';
      html += '</div>';
      html += '</td>';
      html += '</tr>';
    });

    tbody.innerHTML = html;

    // Event delegation for edit buttons (transaction)
    // Bind ONCE to tbody - handles dynamically rendered edit buttons
    if (!tbody.dataset.editDelegationBound) {
      tbody.dataset.editDelegationBound = 'true';
      tbody.addEventListener('click', function (e) {
        var editBtn = e.target.closest('.hub-cf-edit-btn');
        if (!editBtn) return;
        e.stopPropagation();
        var txId = editBtn.getAttribute('data-tx-id');
        if (txId) _openEditTransactionModal(txId);
      });
    }

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

  // ══════════════════════════════════════════════════════════════
  // DEBT RENDER FUNCTIONS
  // ══════════════════════════════════════════════════════════════

  function _renderDebtSummaryCard() {
    var totalPending = _getTotalPendingDebt();
    return '<div class="hub-cf-card hub-cf-debt-summary-card">' +
      '<span class="hub-cf-card-label" data-i18n="debtSummaryTitle">' + _pd_t('debtSummaryTitle') + '</span>' +
      '<div class="hub-cf-card-value-row">' +
        '<span class="hub-cf-card-value hub-cf-card-value--debt" id="cf-debt-pending">' + _formatVNFull(totalPending) + '</span>' +
        '<span class="hub-cf-card-sub" data-i18n="totalPendingDebt">' + _pd_t('totalPendingDebt') + '</span>' +
      '</div>' +
    '</div>';
  }

  function _renderDebtLedgerHTML() {
    return '<!-- POCKET DEBT LEDGER -->' +
    '<div class="hub-cf-debt-ledger glass-card">' +
      '<div class="hub-cf-debt-header">' +
        '<h4 class="hub-cf-debt-title" data-i18n="ledgerTitle">' + _pd_t('ledgerTitle') + '</h4>' +
        '<div class="hub-cf-debt-actions">' +
          '<button class="hub-cf-btn hub-cf-btn--add-debt" id="hub-cf-btn-add-debt">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
              '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>' +
            '<span data-i18n="btnAddDebt">' + _pd_t('btnAddDebt') + '</span>' +
          '</button>' +
          '<button class="hub-cf-btn hub-cf-btn--ghost hub-cf-debt-history-toggle" id="hub-cf-debt-history-toggle">' +
            '<span data-i18n="toggleHistory">' + _pd_t('toggleHistory') + '</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="hub-cf-debt-empty" id="hub-cf-debt-empty-state" style="display:none;">' +
        '<span class="hub-cf-debt-empty-icon">📓</span>' +
        '<p class="hub-cf-debt-empty-text" data-i18n="noDebtsYet">' + _pd_t('noDebtsYet') + '</p>' +
        '<p class="hub-cf-debt-empty-hint" data-i18n="noDebtsHint">' + _pd_t('noDebtsHint') + '</p>' +
      '</div>' +
      '<div class="hub-cf-debt-table-wrap" id="hub-cf-debt-table-wrap" style="display:none;">' +
        '<table class="hub-cf-debt-table">' +
          '<thead>' +
            '<tr>' +
              '<th class="hub-cf-debt-col--debtor" data-i18n="colDebtor">' + _pd_t('colDebtor') + '</th>' +
              '<th class="hub-cf-debt-col--amount" data-i18n="colAmount">' + _pd_t('colAmount') + '</th>' +
              '<th class="hub-cf-debt-col--date" data-i18n="colDateBorrowed">' + _pd_t('colDateBorrowed') + '</th>' +
              '<th class="hub-cf-debt-col--expected" data-i18n="colExpectedReturn">' + _pd_t('colExpectedReturn') + '</th>' +
              '<th class="hub-cf-debt-col--status" data-i18n="colStatus">' + _pd_t('colStatus') + '</th>' +
              '<th class="hub-cf-debt-col--actions" data-i18n="colActions">' + _pd_t('colActions') + '</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody id="hub-cf-debt-body"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="hub-cf-debt-history collapsed" id="hub-cf-debt-history">' +
        '<h5 class="hub-cf-debt-history-title" data-i18n="historyTitle">' + _pd_t('historyTitle') + '</h5>' +
        '<div class="hub-cf-debt-history-empty" id="hub-cf-debt-history-empty" style="display:none;">' +
          '<p style="color:var(--text-muted);font-size:0.74rem;text-align:center;padding:16px 0;" data-i18n="emptyHistory">' + _pd_t('emptyHistory') + '</p>' +
        '</div>' +
        '<div class="hub-cf-debt-history-list" id="hub-cf-debt-history-list"></div>' +
      '</div>' +
    '</div>';
  }

  function _renderDebtRow(debt) {
    var status = _getDebtStatus(debt);
    var statusClass = _getStatusClass(status);
    var statusLabel = _getStatusLabel(status);
    var isOverdue = status === 'overdue';
    var amountFormatted = _formatVND(debt.amount);
    var dateBorrowed = _formatDateISOtoVN(debt.dateBorrowed);
    var expectedReturn = _formatDateISOtoVN(debt.expectedReturnDate);

    return '<tr class="hub-cf-debt-row' + (isOverdue ? ' hub-cf-debt-row--overdue' : '') + '" data-debt-id="' + debt.id + '">' +
      '<td title="' + _escHtml(debt.debtorName) + '">' + _escHtml(debt.debtorName) + '</td>' +
      '<td class="hub-cf-debt-amount">' + amountFormatted + '</td>' +
      '<td>' + dateBorrowed + '</td>' +
      '<td>' + expectedReturn + '</td>' +
      '<td><span class="hub-cf-debt-status ' + statusClass + '">' + statusLabel + '</span></td>' +
      '<td>' +
        '<div class="hub-cf-debt-actions">' +
          (status !== 'paid' ?
            '<button class="hub-cf-debt-btn hub-cf-debt-btn--paid" data-debt-id="' + debt.id + '" data-i18n="btnMarkPaid" title="' + _pd_t('btnMarkPaid') + '">' + _pd_t('btnMarkPaid') + '</button>' : '') +
          '<button class="hub-cf-debt-edit-btn" data-debt-id="' + debt.id + '" title="Chỉnh sửa" aria-label="Chỉnh sửa khoản nợ">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
          '</svg>' +
          '</button>' +
          '<button class="hub-cf-debt-btn hub-cf-debt-btn--delete" data-debt-id="' + debt.id + '" title="' + _pd_t('btnDelete') + '">✕</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function _renderDebtHistoryItem(debt) {
    var amountFormatted = _formatVND(debt.amount);
    var dateBorrowed = _formatDateISOtoVN(debt.dateBorrowed);
    var paidAt = debt.paidAt ? new Date(debt.paidAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    return '<div class="hub-cf-debt-history-item" data-debt-id="' + debt.id + '">' +
      '<div class="hub-cf-debt-history-main">' +
        '<span class="hub-cf-debt-history-debtor">' + _escHtml(debt.debtorName) + '</span>' +
        '<span class="hub-cf-debt-history-amount hub-cf-debt-history-amount--paid">' + amountFormatted + '</span>' +
      '</div>' +
      '<div class="hub-cf-debt-history-meta">' +
        '<span>Mượn: ' + dateBorrowed + '</span>' +
        '<span>Trả: ' + paidAt + '</span>' +
        (debt.note ? '<span class="hub-cf-debt-history-note">' + _escHtml(debt.note) + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  // ── NEW: Render item for paid history modal
  function _renderDebtHistoryModalItem(debt) {
    var amountFormatted = _formatVND(debt.amount);
    var dateBorrowed = _formatDateISOtoVN(debt.dateBorrowed);
    var paidAt = debt.paidAt ? new Date(debt.paidAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    return '<div class="hub-cf-debt-history-modal-item" data-debt-id="' + debt.id + '">' +
      '<div class="hub-cf-debt-history-modal-main">' +
        '<div class="hub-cf-debt-history-modal-debtor">' + _escHtml(debt.debtorName) + '</div>' +
        '<div class="hub-cf-debt-history-modal-meta">' +
          '<span>Mượn: ' + dateBorrowed + '</span>' +
          '<span>Trả: ' + paidAt + '</span>' +
          (debt.note ? '<span class="hub-cf-debt-history-note">' + _escHtml(debt.note) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<span class="hub-cf-debt-history-modal-amount">' + amountFormatted + '</span>' +
      '<button class="hub-cf-debt-btn hub-cf-debt-btn--delete" data-debt-id="' + debt.id + '" title="' + _pd_t('btnDelete') + '">✕</button>' +
    '</div>';
  }

  // ── NEW: Refresh paid history modal content (uses event delegation on static parent)
  function _refreshDebtHistoryModal() {
    var paidDebts = _getPaidDebts();
    var listEl = document.getElementById('hub-cf-debt-history-modal-list');
    var emptyEl = document.getElementById('hub-cf-debt-history-modal-empty');

    if (!listEl || !emptyEl) {
      console.warn('[CashFlow] Modal elements not found during refresh');
      return;
    }

    if (paidDebts.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'flex';
    } else {
      emptyEl.style.display = 'none';
      var html = '';
      paidDebts.forEach(function (debt) { html += _renderDebtHistoryModalItem(debt); });
      listEl.innerHTML = html;
    }
  }

  // ── Event delegation for Paid History Modal (bound ONCE in _bindDebtEvents)
  // Handles delete buttons that are dynamically rendered via innerHTML
  function _bindDebtHistoryModalDelegation() {
    var listEl = document.getElementById('hub-cf-debt-history-modal-list');
    if (!listEl) {
      console.warn('[CashFlow] Paid history modal list element not found for delegation binding');
      return;
    }
    if (listEl.dataset.delegationBound === 'true') return;

    listEl.dataset.delegationBound = 'true';

    listEl.addEventListener('click', function (e) {
      var deleteBtn = e.target.closest('.hub-cf-debt-btn--delete');
      if (!deleteBtn) return;

      e.stopPropagation();
      var debtId = deleteBtn.getAttribute('data-debt-id');
      if (debtId) _deleteDebtFromHistory(debtId);
    });

    console.log('[CashFlow] Paid history modal delegation bound successfully');
  }

  // ── NEW: Open paid history modal
  function _openDebtHistoryModal() {
    var overlay = _qs('#hub-cf-debt-history-overlay');
    if (!overlay) return;
    _refreshDebtHistoryModal();
    overlay.style.display = 'flex';
  }

  // ── NEW: Close paid history modal
  function _closeDebtHistoryModal() {
    var overlay = _qs('#hub-cf-debt-history-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ── NEW: Delete debt from paid history (permanently remove)
  function _deleteDebtFromHistory(debtId) {
    _ensureDebtData();
    var debts = _data.debts;
    var debtIndex = debts.findIndex(function (d) { return d.id === debtId; });
    if (debtIndex === -1) return;

    var debt = debts[debtIndex];
    if (!confirm(_pd_t('confirmDelete').replace('{name}', debt.debtorName).replace('{amount}', _formatVND(debt.amount)))) {
      return;
    }

    debts.splice(debtIndex, 1);
    _debouncedPersist();
    _refreshDebtSummary();
    _refreshDebtLedger();
    _refreshDebtHistoryModal();
    _showToast(_pd_t('toastDebtDeleted').replace('{name}', debt.debtorName));
  }

  function _refreshDebtSummary() {
    var totalPending = _getTotalPendingDebt();
    _setTextById('cf-debt-pending', _formatVNFull(totalPending));
  }

  function _refreshDebtLedger() {
    var activeDebts = _getActiveDebts();
    var tbody = _qs('#hub-cf-debt-body');
    var emptyEl = _qs('#hub-cf-debt-empty-state');
    var tableEl = _qs('#hub-cf-debt-table-wrap');

    if (!tbody || !emptyEl || !tableEl) return;

    // Active debts
    if (activeDebts.length === 0) {
      emptyEl.style.display = 'flex';
      tableEl.style.display = 'none';
    } else {
      emptyEl.style.display = 'none';
      tableEl.style.display = '';
      var html = '';
      activeDebts.forEach(function (debt) { html += _renderDebtRow(debt); });
      tbody.innerHTML = html;

      // Event delegation for debt edit buttons
      if (!tbody.dataset.editDelegationBound) {
        tbody.dataset.editDelegationBound = 'true';
        tbody.addEventListener('click', function (e) {
          var editBtn = e.target.closest('.hub-cf-debt-edit-btn');
          if (!editBtn) return;
          e.stopPropagation();
          var debtId = editBtn.getAttribute('data-debt-id');
          if (debtId) _openEditDebtModal(debtId);
        });
      }

      tbody.querySelectorAll('.hub-cf-debt-btn--paid').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var debtId = this.getAttribute('data-debt-id');
          if (debtId) _markDebtPaid(debtId);
        });
      });
      tbody.querySelectorAll('.hub-cf-debt-btn--delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var debtId = this.getAttribute('data-debt-id');
          if (debtId) _deleteDebt(debtId);
        });
      });
    }
  }

  function _updateDebtLanguage() {
    if (!_container) return;
    var dict = POCKET_DEBT_I18N[_getCFLang()] || POCKET_DEBT_I18N['vi'];
    var els = _container.querySelectorAll('[data-i18n]');
    Array.prototype.forEach.call(els, function (el) {
      var key = el.getAttribute('data-i18n');
      if (key && dict[key] !== undefined) { el.textContent = dict[key]; }
    });
    _refreshDebtLedger();
    // Refresh history modal if visible
    var historyOverlay = _qs('#hub-cf-debt-history-overlay');
    if (historyOverlay && historyOverlay.style.display === 'flex') {
      _refreshDebtHistoryModal();
    }
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
          // ── Vietnamese prompt for Net Worth Target ──
          // HARD RESET METHOD: Retrieve current displayed value, calculate difference,
          // add difference to EXISTING netWorthOffset. This guarantees the final render
          // EXACTLY matches targetNumber regardless of transaction history.
          var currentNetWorthDisplayed = _computeLiveNetWorth(); // current rendered value (Bank + Cash + Uncat + offset)
          var currentVal = currentNetWorthDisplayed ? currentNetWorthDisplayed.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập Tổng Tài Sản mục tiêu (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          var clean = String(raw).replace(/[\s,.]/g, '');
          var targetNumber = parseInt(clean, 10);
          if (isNaN(targetNumber)) return;

          // Foolproof calculation:
          // difference = targetNumber - currentNetWorthDisplayed
          // new_netWorthOffset = current_netWorthOffset + difference
          var difference = targetNumber - currentNetWorthDisplayed;
          var newNetWorthOffset = (_cashFlowMeta.netWorthOffset || 0) + difference;
          _cashFlowMeta.netWorthOffset = newNetWorthOffset;

          // Persist to Firestore via HubDB
          if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
            HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (err) {
              console.error('[CashFlow] Meta persist failed:', err);
            });
          }

          updateDashboardTotals();
          _showToast('✅ Tổng Tài Sản: ' + _formatVNFull(targetNumber));

        } else if (target === 'savings') {
          // ── Vietnamese prompt for Savings Target ──
          // HARD RESET METHOD: Retrieve current displayed value, calculate difference,
          // add difference to EXISTING savingsBalance. This guarantees the final render
          // EXACTLY matches targetNumber regardless of transaction history.
          var currentSavingsDisplayed = _calcSavingsBalance(); // current rendered value (transactions + savingsBalance)
          var currentVal = currentSavingsDisplayed ? currentSavingsDisplayed.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập số dư Tiết kiệm / Đầu tư mục tiêu (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          var clean = String(raw).replace(/[\s,.]/g, '');
          var targetNumber = parseInt(clean, 10);
          if (isNaN(targetNumber)) return;

          // Foolproof calculation:
          // difference = targetNumber - currentSavingsDisplayed
          // new_savingsBalance = current_savingsBalance + difference
          var difference = targetNumber - currentSavingsDisplayed;
          var newSavingsBalance = (_cashFlowMeta.savingsBalance || 0) + difference;
          _cashFlowMeta.savingsBalance = newSavingsBalance;

          // Persist to Firestore via HubDB
          if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
            HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (err) {
              console.error('[CashFlow] Meta persist failed:', err);
            });
          }

          updateDashboardTotals();
          _showToast('✅ Tiết kiệm / Đầu tư: ' + _formatVNFull(targetNumber));

        } else if (target === 'bank') {
          // ── Vietnamese prompt for Bank Account Target ──
          // HARD RESET METHOD: Retrieve current displayed value, calculate difference,
          // add difference to EXISTING initBank. This guarantees the final render
          // EXACTLY matches targetNumber regardless of transaction history.
          var currentBankDisplayed = _calcBankBalance(); // current rendered value (transactions + initBank)
          var currentVal = currentBankDisplayed ? currentBankDisplayed.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập số dư Ngân hàng mục tiêu (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          var clean = String(raw).replace(/[\s,.]/g, '');
          var targetNumber = parseInt(clean, 10);
          if (isNaN(targetNumber)) return;

          // Foolproof calculation:
          // difference = targetNumber - currentBankDisplayed
          // new_init_bank = current_init_bank + difference
          var difference = targetNumber - currentBankDisplayed;
          var newInitBank = (_cashFlowMeta.initBank || 0) + difference;
          _cashFlowMeta.initBank = newInitBank;

          // Persist to Firestore via HubDB
          if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
            HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (err) {
              console.error('[CashFlow] Meta persist failed:', err);
            });
          }

          updateDashboardTotals();
          _showToast('✅ Số dư Ngân hàng: ' + _formatVNFull(targetNumber));

        } else if (target === 'cash') {
          // ── Vietnamese prompt for Cash Wallet Target ──
          // HARD RESET METHOD: Retrieve current displayed value, calculate difference,
          // add difference to EXISTING initCash. This guarantees the final render
          // EXACTLY matches targetNumber regardless of transaction history.
          var currentCashDisplayed = _calcCashBalance(); // current rendered value (transactions + initCash)
          var currentVal = currentCashDisplayed ? currentCashDisplayed.toLocaleString('vi-VN') : '0';
          var raw = prompt('Nhập số dư Tiền mặt mục tiêu (VND):', currentVal);
          if (raw === null) return; // user cancelled — do nothing

          var clean = String(raw).replace(/[\s,.]/g, '');
          var targetNumber = parseInt(clean, 10);
          if (isNaN(targetNumber)) return;

          // Foolproof calculation:
          // difference = targetNumber - currentCashDisplayed
          // new_init_cash = current_init_cash + difference
          var difference = targetNumber - currentCashDisplayed;
          var newInitCash = (_cashFlowMeta.initCash || 0) + difference;
          _cashFlowMeta.initCash = newInitCash;

          // Persist to Firestore via HubDB
          if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
            HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (err) {
              console.error('[CashFlow] Meta persist failed:', err);
            });
          }

          updateDashboardTotals();
          _showToast('✅ Số dư Tiền mặt: ' + _formatVNFull(targetNumber));
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

    // ── Segmented Tab Switcher: Ledger ↔ Stats ──
    var ledgerTab = _qs('#hub-cf-tab-ledger');
    var statsTab  = _qs('#hub-cf-tab-stats');
    var historyView = _qs('#hub-cf-history-view');
    var statsView   = _qs('#hub-cf-stats-view');

    var _ledgerView = 'ledger'; // 'ledger' | 'stats'

    function _switchLedgerView(view) {
      _ledgerView = view;
      if (ledgerTab) ledgerTab.setAttribute('aria-selected', view === 'ledger');
      if (statsTab)  statsTab.setAttribute('aria-selected',  view === 'stats');

      var switcher = _qs('.hub-cf-tab-switcher');
      if (switcher) switcher.setAttribute('data-active-view', view);

      // ONLY toggle the VIEW WRAPPERS — never touch emptyState/tableWrap directly
      // _refreshTransactions() owns the empty-vs-table logic inside historyView
      var showHistory = view === 'ledger';
      var showStats   = view === 'stats';

      if (historyView) historyView.style.display = showHistory ? '' : 'none';
      if (statsView)   statsView.style.display   = showStats   ? '' : 'none';
    }

    if (ledgerTab && statsTab) {
      ledgerTab.addEventListener('click', function () { _switchLedgerView('ledger'); });
      statsTab.addEventListener('click',  function () { _switchLedgerView('stats');  });
    }

    // Escape key to close modal
    _boundKeydown = function (e) {
      if (e.key === 'Escape') {
        _closeModal();
      }
    };
    document.addEventListener('keydown', _boundKeydown);

    // AI Financial Advisor events
    _bindAIAdvisorEvents();

    // Pocket Debt events
    _bindDebtEvents();

    // Listen for global language change events
    window.addEventListener('hubLanguageChanged', function (e) {
      var newLang = e.detail;
      // Update transaction modal title if open
      var modalOverlay = _qs('#hub-cf-overlay');
      if (modalOverlay && modalOverlay.style.display === 'flex') {
        var isEditing = _editingTxId !== null;
        var titleEl = _qs('#hub-cf-overlay .hub-cf-modal-title');
        if (titleEl) {
          titleEl.textContent = isEditing ? _t('modalTitleEdit') : _t('modalTitle');
        }
        modalOverlay.setAttribute('aria-label', isEditing ? _t('modalTitleEdit') : _t('modalTitle'));
      }
      // Update debt modal title if open
      var debtOverlay = _qs('#hub-cf-debt-overlay');
      if (debtOverlay && debtOverlay.style.display === 'flex') {
        var isEditingDebt = _editingDebtId !== null;
        var debtTitleEl = _qs('#hub-cf-debt-overlay .hub-cf-modal-title');
        if (debtTitleEl) {
          debtTitleEl.textContent = isEditingDebt ? _pd_t('modalTitleEdit') : _pd_t('modalTitle');
        }
        debtOverlay.setAttribute('aria-label', isEditingDebt ? _pd_t('modalTitleEdit') : _pd_t('modalTitle'));
      }
    });
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
    if (overlay) {
      overlay.style.display = 'none';
      // Reset edit state
      _editingTxId = null;
      const titleEl = _qs('#hub-cf-overlay .hub-cf-modal-title');
      if (titleEl) titleEl.textContent = _t('modalTitle');
      overlay.setAttribute('aria-label', _t('modalTitle'));
    }
  }

  // Update modal title when language changes
  function _updateTransactionModalTitle() {
    const overlay = _qs('#hub-cf-overlay');
    if (overlay && overlay.style.display === 'flex') {
      const isEditing = _editingTxId !== null;
      overlay.setAttribute('aria-label', isEditing ? _t('modalTitleEdit') : _t('modalTitle'));
    }
  }

  // ══════════════════════════════════════════
  // EDIT TRANSACTION MODAL LOGIC
  // ══════════════════════════════════════════

  function _openEditTransactionModal(txId) {
    const tx = _data.transactions.find(t => t.id === txId);
    if (!tx) return;

    _editingTxId = txId;

    const overlay = _qs('#hub-cf-overlay');
    if (!overlay) return;

    // Reset form first
    const form = _qs('#hub-cf-form');
    if (form) form.reset();

    // Update modal title and aria-label
    const editTitle = _t('modalTitleEdit') || 'Sửa Giao Dịch';
    overlay.setAttribute('aria-label', editTitle);
    const titleEl = _qs('#hub-cf-overlay .hub-cf-modal-title');
    if (titleEl) titleEl.textContent = editTitle;

    // Switch to correct tab
    _switchTab(tx.type);

    // Populate fields
    const amountInput = _qs('#hub-cf-amount');
    const dateInput = _qs('#hub-cf-date');
    const descInput = _qs('#hub-cf-desc');
    const categorySelect = _qs('#hub-cf-category');
    const sourceSelect = _qs('#hub-cf-source');  // NEW

    if (amountInput) amountInput.value = tx.amount;
    if (dateInput) {
      // Format date as YYYY-MM-DD for input type="date"
      dateInput.value = tx.year + '-' + String(tx.month).padStart(2, '0') + '-' + String(tx.day).padStart(2, '0');
    }
    if (descInput) descInput.value = tx.desc || '';
    if (categorySelect) categorySelect.value = tx.category;
    if (sourceSelect) sourceSelect.value = tx.source || 'bank';  // NEW: default to 'bank'

    // Show modal
    overlay.style.display = 'flex';
    setTimeout(function () {
      if (amountInput) amountInput.focus();
    }, 150);
  }

  function _saveTransaction() {
    const amountStr = (_qs('#hub-cf-amount') ? _qs('#hub-cf-amount').value : '');
    const dateStr   = (_qs('#hub-cf-date') ? _qs('#hub-cf-date').value : '');
    const desc      = (_qs('#hub-cf-desc') ? _qs('#hub-cf-desc').value.trim() : '');
    const category  = (_qs('#hub-cf-category') ? _qs('#hub-cf-category').value : '');
    const source    = (_qs('#hub-cf-source') ? _qs('#hub-cf-source').value : 'bank'); // NEW

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
    if (!source) {
      _showInput('hub-cf-source');
      return;
    }

    const dateParts = dateStr.split('-');
    const year  = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    const day   = parseInt(dateParts[2], 10);

    if (_editingTxId) {
      // EDIT MODE: Update existing transaction
      const txIndex = _data.transactions.findIndex(t => t.id === _editingTxId);
      if (txIndex !== -1) {
        _data.transactions[txIndex] = {
          ..._data.transactions[txIndex],
          type: _activeTab,
          amount: amount,
          year: year,
          month: month,
          day: day,
          desc: desc || '',
          category: category,
          source: source  // NEW: persist source
        };
      }
      _editingTxId = null;
    } else {
      // CREATE MODE: Add new transaction
      const tx = {
        id: _uid(),
        type: _activeTab,
        amount: amount,
        year: year,
        month: month,
        day: day,
        desc: desc || '',
        category: category,
        source: source,  // NEW: capture source
        createdAt: Date.now()
      };
      _data.transactions.push(tx);
    }

    // ── BREAK THE OFFLINE SEAL: user explicitly added data ──
    if (_isOfflineMode) { _isOfflineMode = false; }

    _debouncedPersist();
    _closeModal();
    _renderAllViews();
    _updateChart();

    // If the TX month matches the viewing month, ledger updates naturally
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

  // ══════════════════════════════════════════════════════════════
  // DEBT OPERATIONS
  // ══════════════════════════════════════════════════════════════

  function _addDebt(debtorName, amount, dateBorrowed, expectedReturnDate, note) {
    _ensureDebtData();

    var debt = {
      id: _generateDebtId(),
      debtorName: debtorName.trim(),
      amount: Number(amount),
      dateBorrowed: dateBorrowed,
      expectedReturnDate: expectedReturnDate,
      status: 'pending',
      note: note ? note.trim() : '',
      createdAt: Date.now()
    };

    _data.debts.push(debt);
    _debouncedPersist();
    _refreshDebtSummary();
    _refreshDebtLedger();

    _showToast(_pd_t('toastDebtAdded')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount)));
  }

  function _markDebtPaid(debtId) {
    var debt = _data.debts.find(function (d) { return d.id === debtId; });
    if (!debt) return;

    var confirmMsg = _pd_t('confirmMarkPaid')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount));
    if (!confirm(confirmMsg)) return;

    debt.status = 'paid';
    debt.paidAt = Date.now();
    _debouncedPersist();
    _refreshDebtSummary();
    _refreshDebtLedger();

    _showToast(_pd_t('toastDebtPaid')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount)));

    // Prompt to add to CashFlow income
    var addToIncomeMsg = _pd_t('confirmAddToIncome');
    if (confirm(addToIncomeMsg)) {
      _addDebtCollectionToIncome(debt);
    }
  }

  function _addDebtCollectionToIncome(debt) {
    var tx = {
      id: _uid(),
      type: 'income',
      amount: Number(debt.amount),
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      day: new Date().getDate(),
      desc: 'Thu nợ từ ' + debt.debtorName + (debt.note ? ' - ' + debt.note : ''),
      category: 'thu-nhap-khac',
      createdAt: Date.now()
    };

    _data.transactions.push(tx);
    _debouncedPersist();
    _renderAllViews();
    _updateChart();

    _showToast(_pd_t('toastIncomeAdded').replace('{name}', debt.debtorName));
  }

  function _deleteDebt(debtId) {
    var debt = _data.debts.find(function (d) { return d.id === debtId; });
    if (!debt) return;

    var confirmMsg = _pd_t('confirmDelete')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount));
    if (!confirm(confirmMsg)) return;

    var idx = _data.debts.findIndex(function (d) { return d.id === debtId; });
    if (idx === -1) return;

    _data.debts.splice(idx, 1);
    _debouncedPersist();
    _refreshDebtSummary();
    _refreshDebtLedger();

    _showToast(_pd_t('toastDebtDeleted').replace('{name}', debt.debtorName));
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
          // Parse source field with defensive checks — unrecognized → "uncategorized"
          var rawSource = '';
          try {
            // Handle both array rows (header=1) and object rows (header row as keys)
            if (Array.isArray(row)) {
              // Column index 5 would be 'Nguồn' / 'Source' based on expected layout
              rawSource = String(row[5] || '').trim().toLowerCase();
            } else {
              rawSource = String(row['Nguồn'] || row['Source'] || row['nguon'] || row['source'] || '').trim().toLowerCase();
            }
          } catch (_) {
            rawSource = '';
          }
          var source = 'uncategorized'; // Default: unrecognized → uncategorized
          if (rawSource === 'cash' || rawSource === 'tiền mặt' || rawSource === 'tien mat' || rawSource === 'cash (physical)' || rawSource === 'tiền' || rawSource === 'tien') {
            source = 'cash';
          } else if (rawSource === 'bank' || rawSource === 'chuyển khoản' || rawSource === 'chuyen khoan' || rawSource === 'bank transfer' || rawSource === 'tài khoản ngân hàng' || rawSource === 'tai khoan ngan hang' || rawSource === 'ngân hàng' || rawSource === 'ngan hang' || rawSource === 'chuyen') {
            source = 'bank';
          } else if (rawSource === 'savings' || rawSource === 'tiết kiệm' || rawSource === 'tiet kiem' || rawSource === 'saving') {
            source = 'savings';
          }
          // Any other value (including empty, 'unknown', 'other', etc.) stays as 'uncategorized'

          importedTxs.push({
            id: _uid(),
            type: type,
            amount: Math.abs(amount),
            year: year,
            month: monthVal,
            day: dayVal,
            desc: desc || '',
            category: category || '',
            source: source,  // NEW
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
      _renderAllViews();
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
        // Defensive: ensure source exists and is valid
        var src = tx.source || 'uncategorized';
        var sourceLabel = '';
        if (src === 'cash') sourceLabel = _t('sourceCash');
        else if (src === 'bank') sourceLabel = _t('sourceBank');
        else if (src === 'savings') sourceLabel = _t('sourceSavings');
        else sourceLabel = _t('sourceUncategorized');
        var row = {
          'Ngày': tx.day || 0,
          'Tháng': tx.month || 0,
          'Mô tả': (tx.desc || ''),
          'Hạng mục': _categoryDisplayName(tx.category, tx.type),
          'Nguồn': sourceLabel,
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
          header: ['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Nguồn', 'Số tiền']
        });
        XLSX.utils.book_append_sheet(wb, wsExpense, 'Expenses');
      } else {
        // Still create empty sheet with headers
        var wsEmptyExpense = XLSX.utils.aoa_to_sheet([['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Nguồn', 'Số tiền']]);
        XLSX.utils.book_append_sheet(wb, wsEmptyExpense, 'Expenses');
      }

      // Sheet 2: Income
      if (incomeRows.length > 0) {
        var wsIncome = XLSX.utils.json_to_sheet(incomeRows, {
          header: ['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Nguồn', 'Số tiền']
        });
        XLSX.utils.book_append_sheet(wb, wsIncome, 'Income');
      } else {
        var wsEmptyIncome = XLSX.utils.aoa_to_sheet([['Ngày', 'Tháng', 'Mô tả', 'Hạng mục', 'Nguồn', 'Số tiền']]);
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
    var cashIncomeData = [];
    var cashExpenseData = [];
    var bankIncomeData = [];
    var bankExpenseData = [];
    var uncategorizedIncomeData = [];
    var uncategorizedExpenseData = [];

    if (!_data || !_data.transactions || _data.transactions.length === 0) {
      return {
        labels: labels,
        incomeData: incomeData,
        expenseData: expenseData,
        cashIncomeData: cashIncomeData,
        cashExpenseData: cashExpenseData,
        bankIncomeData: bankIncomeData,
        bankExpenseData: bankExpenseData,
        uncategorizedIncomeData: uncategorizedIncomeData,
        uncategorizedExpenseData: uncategorizedExpenseData
      };
    }

    var trans = _data.transactions.slice();

    if (_chartFilter === 'day') {
      var dayMap = {};
      var now = new Date();
      for (var i = 29; i >= 0; i--) {
        var d = new Date(now);
        d.setDate(d.getDate() - i);
        var key = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
        dayMap[key] = { income: 0, expense: 0, cashIncome: 0, cashExpense: 0, bankIncome: 0, bankExpense: 0, uncategorizedIncome: 0, uncategorizedExpense: 0 };
      }

      trans.forEach(function (tx) {
        var key = String(tx.day).padStart(2, '0') + '/' + String(tx.month).padStart(2, '0');
        if (dayMap[key] !== undefined) {
          if (tx.type === 'income') {
            dayMap[key].income += tx.amount;
            if (tx.source === 'cash') dayMap[key].cashIncome += tx.amount;
            else if (tx.source === 'bank') dayMap[key].bankIncome += tx.amount;
            else if (tx.source === 'uncategorized') dayMap[key].uncategorizedIncome += tx.amount;
          } else {
            dayMap[key].expense += tx.amount;
            if (tx.source === 'cash') dayMap[key].cashExpense += tx.amount;
            else if (tx.source === 'bank') dayMap[key].bankExpense += tx.amount;
            else if (tx.source === 'uncategorized') dayMap[key].uncategorizedExpense += tx.amount;
          }
        }
      });

      Object.keys(dayMap).forEach(function (key) {
        labels.push(key);
        incomeData.push(dayMap[key].income);
        expenseData.push(dayMap[key].expense);
        cashIncomeData.push(dayMap[key].cashIncome);
        cashExpenseData.push(dayMap[key].cashExpense);
        bankIncomeData.push(dayMap[key].bankIncome);
        bankExpenseData.push(dayMap[key].bankExpense);
        uncategorizedIncomeData.push(dayMap[key].uncategorizedIncome);
        uncategorizedExpenseData.push(dayMap[key].uncategorizedExpense);
      });

    } else if (_chartFilter === 'month') {
      var monthMap = {};
      trans.forEach(function (tx) {
        var key = String(tx.month).padStart(2, '0') + '/' + tx.year;
        if (!monthMap[key]) monthMap[key] = { income: 0, expense: 0, cashIncome: 0, cashExpense: 0, bankIncome: 0, bankExpense: 0, uncategorizedIncome: 0, uncategorizedExpense: 0, year: tx.year, month: tx.month };
        if (tx.type === 'income') {
          monthMap[key].income += tx.amount;
          if (tx.source === 'cash') monthMap[key].cashIncome += tx.amount;
          else if (tx.source === 'bank') monthMap[key].bankIncome += tx.amount;
          else if (tx.source === 'uncategorized') monthMap[key].uncategorizedIncome += tx.amount;
        } else {
          monthMap[key].expense += tx.amount;
          if (tx.source === 'cash') monthMap[key].cashExpense += tx.amount;
          else if (tx.source === 'bank') monthMap[key].bankExpense += tx.amount;
          else if (tx.source === 'uncategorized') monthMap[key].uncategorizedExpense += tx.amount;
        }
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
        cashIncomeData.push(m.cashIncome);
        cashExpenseData.push(m.cashExpense);
        bankIncomeData.push(m.bankIncome);
        bankExpenseData.push(m.bankExpense);
        uncategorizedIncomeData.push(m.uncategorizedIncome);
        uncategorizedExpenseData.push(m.uncategorizedExpense);
      });

    } else if (_chartFilter === 'year') {
      var yearMap = {};
      trans.forEach(function (tx) {
        if (!yearMap[tx.year]) yearMap[tx.year] = { income: 0, expense: 0, cashIncome: 0, cashExpense: 0, bankIncome: 0, bankExpense: 0, uncategorizedIncome: 0, uncategorizedExpense: 0 };
        if (tx.type === 'income') {
          yearMap[tx.year].income += tx.amount;
          if (tx.source === 'cash') yearMap[tx.year].cashIncome += tx.amount;
          else if (tx.source === 'bank') yearMap[tx.year].bankIncome += tx.amount;
          else if (tx.source === 'uncategorized') yearMap[tx.year].uncategorizedIncome += tx.amount;
        } else {
          yearMap[tx.year].expense += tx.amount;
          if (tx.source === 'cash') yearMap[tx.year].cashExpense += tx.amount;
          else if (tx.source === 'bank') yearMap[tx.year].bankExpense += tx.amount;
          else if (tx.source === 'uncategorized') yearMap[tx.year].uncategorizedExpense += tx.amount;
        }
      });

      var yearKeys = Object.keys(yearMap).sort();
      yearKeys.forEach(function (yr) {
        labels.push(String(yr));
        incomeData.push(yearMap[yr].income);
        expenseData.push(yearMap[yr].expense);
        cashIncomeData.push(yearMap[yr].cashIncome);
        cashExpenseData.push(yearMap[yr].cashExpense);
        bankIncomeData.push(yearMap[yr].bankIncome);
        bankExpenseData.push(yearMap[yr].bankExpense);
        uncategorizedIncomeData.push(yearMap[yr].uncategorizedIncome);
        uncategorizedExpenseData.push(yearMap[yr].uncategorizedExpense);
      });
    }

    return {
      labels: labels,
      incomeData: incomeData,
      expenseData: expenseData,
      cashIncomeData: cashIncomeData,
      cashExpenseData: cashExpenseData,
      bankIncomeData: bankIncomeData,
      bankExpenseData: bankExpenseData,
      uncategorizedIncomeData: uncategorizedIncomeData,
      uncategorizedExpenseData: uncategorizedExpenseData
    };
  }

  function _destroyChart() {
    if (_chart) {
      _chart.destroy();
      _chart = null;
    }
  }

  // ============================================================
  //   AI FINANCIAL ADVISOR
  // ============================================================

  /**
   * Get API key for a provider from localStorage
   * @param {string} provider - 'gemini' or 'nvidia'
   * @returns {string|null} API key or null if not found
   */
  function _getAIKey(provider) {
    const storageKey = provider === 'gemini' ? 'gemini_api_key' : 'nvidia_api_key';
    return localStorage.getItem(storageKey);
  }

  /**
   * Get financial context from current month's transactions
   * Returns compressed JSON string with Date, Category, Amount, Note
   * Includes pre-calculated categoryTotals to prevent AI math hallucinations
   * Includes manual balances: netWorth (computed live) and savings (manual override)
   * @returns {string} JSON string of transaction data and balances
   */
  function _getFinancialContext() {
    if (!_data || !_data.transactions || _data.transactions.length === 0) {
      return JSON.stringify({
        transactions: [],
        message: 'Chưa có dữ liệu giao dịch.',
        categoryTotals: { income: {}, expense: {} },
        balances: {
          netWorth: _computeLiveNetWorth(),
          savings: _cashFlowMeta.savingsBalance || 0,
          cashBalance: _calcCashBalance(),
          bankBalance: _calcBankBalance(),
          uncategorizedBalance: _calcUncategorizedBalance()
        }
      });
    }

    // Get transactions for current viewing month
    const ym = _currentMonth || _currentYearMonth();
    const monthTxs = _getMonthTransactions(ym.year, ym.month);

    // If no transactions in current month, use all transactions (capped at 100)
    const txs = monthTxs.length > 0 ? monthTxs : _getAllTransactionsSorted().slice(0, 100);

    // Pre-calculate category totals on the client side (EXACT math)
    const categoryTotals = { income: {}, expense: {} };
    txs.forEach(tx => {
      const type = tx.type === 'income' ? 'income' : 'expense';
      const catName = _categoryDisplayName(tx.category, tx.type);
      categoryTotals[type][catName] = (categoryTotals[type][catName] || 0) + (tx.amount || 0);
    });

    // Compress data to essential fields only
    const compressed = txs.map(tx => ({
      d: _formatDate(tx.day, tx.month, tx.year),  // Date
      c: _categoryDisplayName(tx.category, tx.type), // Category
      a: tx.amount,                                // Amount
      t: tx.type === 'expense' ? '-' : '+',        // Type indicator
      n: tx.desc || '',                             // Note
      s: tx.source || 'bank'                        // Source (NEW)
    }));

    return JSON.stringify({
      month: `${ym.month}/${ym.year}`,
      transactions: compressed,
      summary: {
        income: _getMonthlyIncome(ym.year, ym.month),
        expense: _getMonthlyExpense(ym.year, ym.month)
      },
      categoryTotals: categoryTotals,
      balances: {
        netWorth: _computeLiveNetWorth(),
        savings: _cashFlowMeta.savingsBalance || 0,
        cashBalance: _calcCashBalance(),   // NEW
        bankBalance: _calcBankBalance()    // NEW
      }
    });
  }

  /**
   * Render markdown-like text to the response box
   * @param {string} text - Text content to render
   */
  function _renderAIResponse(text) {
    const el = document.getElementById('cf-ai-response');
    if (!el) return;

    // Simple markdown-ish rendering: **bold**, *italic*, `code`, line breaks
    let html = _escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(0,240,255,0.1);padding:1px 4px;border-radius:3px;font-family:var(--font-mono);">$1</code>')
      .replace(/\n/g, '<br>');

    el.innerHTML = html;
    el.classList.remove('loading');
    el.scrollTop = el.scrollHeight;
  }

  /**
   * Show loading state in response box
   * @param {string} message - Optional loading message
   */
  function _showAILoading(message = 'Đang phân tích...') {
    const el = document.getElementById('cf-ai-response');
    if (!el) return;
    el.classList.add('loading');
    el.textContent = message;
  }

  /**
   * Show error in response box
   * @param {string} message - Error message
   */
  function _showAIError(message) {
    const el = document.getElementById('cf-ai-response');
    if (!el) return;
    el.classList.remove('loading');
    el.innerHTML = `<span style="color:var(--danger);">⚠️ ${_escHtml(message)}</span>`;
  }

  /**
   * Resilient fetch with timeout, retry, and abort support
   * @param {string} url
   * @param {RequestInit} options
   * @param {Object} config { timeout, maxRetries, retryDelay, keepalive, signal }
   * @returns {Promise<Response>}
   */
  async function _resilientFetch(url, options = {}, config = {}) {
    const {
      timeout = 120000,        // 2 min client timeout ( > Vercel 60s )
      maxRetries = 2,
      retryDelay = 1000,
      keepalive = true,
      signal: externalSignal = null
    } = config;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Merge external signal (from caller) with internal timeout signal
    let mergedSignal = controller.signal;
    if (externalSignal) {
      // Create a combined signal that aborts if EITHER aborts
      const signalAny = AbortSignal.any([controller.signal, externalSignal]);
      mergedSignal = signalAny;
    }

    // Merge signal
    const fetchOptions = {
      ...options,
      signal: mergedSignal,
      keepalive
    };

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        // Don't retry on abort or non-network errors
        if (err.name === 'AbortError' || err.name === 'TypeError') {
          throw err;
        }

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }


  /**
   * Call Gemini API (Gemini 3.7 Flash)
   * @param {string} systemPrompt - Complete prompt with context
   * @param {string} apiKey - Gemini API key
   * @param {AbortSignal} [signal] - Optional abort signal for cancellation
   * @returns {Promise<string>} AI response text
   */
  async function _callGeminiAPI(systemPrompt, apiKey, signal) {
    const response = await _resilientFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: systemPrompt }]
          }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7
          }
        })
      }, { timeout: 60000, maxRetries: 2, keepalive: true, signal } // 60s timeout for Gemini
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${response.status} - ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Không có phản hồi từ AI.';
  }

  /**
   * Call Nvidia Nemotron 3 Ultra API via Vercel backend
   * @param {string} systemPrompt - Complete prompt with context
   * @param {string} apiKey - Nvidia NIM API key
   * @returns {Promise<string>} AI response text
   */
  async function _callNvidiaAPI(systemPrompt, apiKey) {
    const response = await fetch('https://personal-hub-rose-xi.vercel.app/api/ask-nvidia', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey, systemPrompt })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Nvidia API error: ${response.status} - ${error.message || response.statusText}`);
    }

    const data = await response.json();
    return data.response || 'Không có phản hồi từ AI.';
  }

  /**
   * Open AI Key Management Modal
   */
  function _openAIKeyModal() {
    const modal = document.getElementById('cf-ai-key-modal');
    if (!modal) return;

    // Load existing keys from localStorage
    const geminiKey = localStorage.getItem('gemini_api_key') || '';
    const nvidiaKey = localStorage.getItem('nvidia_api_key') || '';

    document.getElementById('cf-key-gemini').value = geminiKey;
    document.getElementById('cf-key-nvidia').value = nvidiaKey;

    modal.style.display = 'flex';
    // Trigger animation
    requestAnimationFrame(() => {
      modal.classList.add('hub-cf-ai-key-modal--visible');
    });

    // Focus first input
    setTimeout(() => {
      document.getElementById('cf-key-gemini').focus();
    }, 150);
  }

  /**
   * Close AI Key Management Modal
   */
  function _closeAIKeyModal() {
    const modal = document.getElementById('cf-ai-key-modal');
    if (!modal) return;

    modal.classList.remove('hub-cf-ai-key-modal--visible');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }

  /**
   * Save API Keys to localStorage
   */
  function _saveAIKeys() {
    const geminiKey = document.getElementById('cf-key-gemini').value.trim();
    const nvidiaKey = document.getElementById('cf-key-nvidia').value.trim();

    if (geminiKey) {
      localStorage.setItem('gemini_api_key', geminiKey);
    }
    if (nvidiaKey) {
      localStorage.setItem('nvidia_api_key', nvidiaKey);
    }

    _closeAIKeyModal();
    _showToast('✅ Đã lưu API Keys thành công!');
  }

  /**
   * Clear API Keys from localStorage
   */
  function _clearAIKeys() {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('nvidia_api_key');

    document.getElementById('cf-key-gemini').value = '';
    document.getElementById('cf-key-nvidia').value = '';

    _showToast('✅ Đã xóa API Keys!');
  }

  /**
   * Main AI Ask Handler - bound to #cf-ai-ask-btn click
   * Supports background execution: continues even if user navigates away
   */
  async function _handleAIAdvisorQuery() {
    const promptInput = document.getElementById('cf-ai-prompt');
    const providerSelect = document.getElementById('cf-ai-provider');
    const askBtn = document.getElementById('cf-ai-ask-btn');

    if (!promptInput || !providerSelect || !askBtn) return;

    const userQuery = promptInput.value.trim();
    if (!userQuery) {
      _showAIError('Vui lòng nhập câu hỏi.');
      return;
    }

    const provider = providerSelect.value; // 'gemini' or 'nvidia'
    _aiState.provider = provider; // Persist provider choice

    // Check if API key exists
    const apiKey = _getAIKey(provider);
    if (!apiKey) {
      _showAIError('Vui lòng cấu hình API Key trong mục Cài đặt (⚙️) trước khi hỏi.');
      return;
    }

    // Abort any previous in-flight request
    if (_aiState.abortController) {
      _aiState.abortController.abort();
    }

    // Create new abort controller for this request
    _aiState.abortController = new AbortController();
    const signal = _aiState.abortController.signal;
    const currentRequestId = ++_aiState.requestId; // Deduplication

    // Update state BEFORE starting background fetch
    _aiState.isLoading = true;
    _aiState.lastPrompt = userQuery;
    _aiState.lastError = null;
    _aiState.currentResponse = ''; // Clear previous response while loading

    // Disable UI during request (will be restored on re-render if user navigates away)
    askBtn.disabled = true;
    promptInput.disabled = true;
    _showAILoading();

    // Add user message to conversation history
    _aiState.conversationHistory.push({
      role: 'user',
      content: userQuery,
      timestamp: Date.now()
    });

    // Save state immediately for persistence across tab switches
    _saveAIState();

    try {
      // Build system prompt with financial context
      const context = _getFinancialContext();
      const systemPrompt = "Bạn là một Quân sư tài chính xuất chúng. Bạn BẮT BUỘC phải luôn xưng hô và gọi tôi là 'Thiếu gia'. " +
        "NHIỀM VỤ TUYỆT ĐỐI: KHÔNG TỰ TÍNH TOÁN TỔNG HỢP THEO HÀNG MỤC (category totals). " +
        "BẮT BUỘC PHẢI SỬ DỤNG CHÍNH XÁC CÁC CON SỐ ĐÃ TÍNH SẴN TRONG ĐỐI TƯỢNG 'categoryTotals' (income/expense) ĐỂ TỔNG HỢP TÀI CHÍNH. " +
        "CHỈ SỬ DỤNG MẢNG 'transactions' ĐỂ PHÂN TÍCH MẪU THÓI QUEN, TẦN SUẤT GIAO DỊCH, VÀ MÔ TẢ CHI TIẾT. " +
        "NẾU BẠN TỰ TÍNH TOÁN, CON SỐ SẼ SAI (HALLUCINATION). TUÂN THỦ NGHIÊM NGẶT QUY TẮC NÀY. " +
        "Dựa vào dữ liệu tài chính dưới đây để: Phân tích thói quen tiêu dùng, đưa ra chiến lược quản lý vốn nghiêm ngặt, và tư vấn cách phân bổ dòng tiền tối ưu nhất để gia tăng tài sản. " +
        "LƯU Ý QUAN TRỌNG: Mỗi giao dịch có trường 's' (source) chỉ 'cash' (Tiền mặt) hoặc 'bank' (Ngân hàng). " +
        "Hãy phân tích riêng dòng tiền Tiền mặt và Ngân hàng, tư vấn cách quản lý số dư ví tiền mặt và tài khoản ngân hàng. " +
        "Dữ liệu dòng tiền: " + context;

      // Call appropriate API with abort signal
      let responseText;
      if (provider === 'nvidia') {
        responseText = await _callNvidiaAPI(systemPrompt, apiKey, signal);
      } else {
        responseText = await _callGeminiAPI(systemPrompt, apiKey, signal);
      }

      // DEDUPLICATION: ignore stale responses from superseded requests
      if (currentRequestId !== _aiState.requestId) {
        console.log('[CashFlow AI] Ignoring stale response (superseded by newer request)');
        return;
      }

      // Update state with successful response
      _aiState.isLoading = false;
      _aiState.currentResponse = responseText;
      _aiState.lastError = null;

      // Add assistant response to conversation history
      _aiState.conversationHistory.push({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now()
      });

      // Persist state
      _saveAIState();

      // Render response if UI still available
      const responseEl = document.getElementById('cf-ai-response');
      if (responseEl) {
        _renderAIResponse(responseText);
      }

      // Clear input on success
      promptInput.value = '';

    } catch (error) {
      // DEDUPLICATION: ignore stale errors from superseded requests
      if (currentRequestId !== _aiState.requestId) {
        console.log('[CashFlow AI] Ignoring stale error (superseded by newer request)');
        return;
      }

      // Don't treat abort as error
      if (error.name === 'AbortError') {
        _aiState.isLoading = false;
        _aiState.currentResponse = 'Yêu cầu đã bị hủy.';
        _saveAIState();
        return;
      }

      console.error('[CashFlow AI] Error:', error);
      _aiState.isLoading = false;
      _aiState.lastError = error.message;
      _saveAIState();

      // Show error with retry option if UI available
      const responseEl = document.getElementById('cf-ai-response');
      if (responseEl) {
        _showAIError(`Lỗi: ${error.message}`);
      }

    } finally {
      // Only re-enable UI if this is still the current request
      if (currentRequestId === _aiState.requestId) {
        _aiState.abortController = null;

        // Re-enable UI if elements still exist (user hasn't navigated away)
        if (askBtn) askBtn.disabled = false;
        if (promptInput) {
          promptInput.disabled = false;
          promptInput.focus();
        }
      }
    }
  }

  /**
   * Bind AI Advisor events - called from _bindEvents()
   */
  function _bindAIAdvisorEvents() {
    const askBtn = document.getElementById('cf-ai-ask-btn');
    const promptInput = document.getElementById('cf-ai-prompt');
    const providerSelect = document.getElementById('cf-ai-provider');
    const settingsBtn = document.getElementById('cf-ai-settings-btn');
    const modalCloseBtn = document.getElementById('cf-key-close');
    const modalCloseBtnBottom = document.getElementById('cf-key-close-bottom');
    const saveBtn = document.getElementById('cf-key-save');
    const clearBtn = document.getElementById('cf-key-clear');
    const modal = document.getElementById('cf-ai-key-modal');

    if (askBtn) {
      askBtn.addEventListener('click', _handleAIAdvisorQuery);
    }

    if (promptInput) {
      promptInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _handleAIAdvisorQuery();
        }
      });
    }

    // Provider change — persist selection
    if (providerSelect) {
      providerSelect.addEventListener('change', function() {
        _aiState.provider = this.value;
        _saveAIState();
      });
    }

    // Settings button opens modal
    if (settingsBtn) {
      settingsBtn.addEventListener('click', _openAIKeyModal);
    }

    // Modal close buttons
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', _closeAIKeyModal);
    }
    if (modalCloseBtnBottom) {
      modalCloseBtnBottom.addEventListener('click', _closeAIKeyModal);
    }

    // Save keys
    if (saveBtn) {
      saveBtn.addEventListener('click', _saveAIKeys);
    }

    // Clear keys
    if (clearBtn) {
      clearBtn.addEventListener('click', _clearAIKeys);
    }

    // Close modal on overlay click
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          _closeAIKeyModal();
        }
      });
    }

    // Escape key to close modal
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        const modal = document.getElementById('cf-ai-key-modal');
        if (modal && modal.style.display === 'flex') {
          _closeAIKeyModal();
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DEBT EVENT BINDING & MODAL HANDLERS
  // ══════════════════════════════════════════════════════════════

  function _bindDebtEvents() {
    // Add Debt button
    var addBtn = _qs('#hub-cf-btn-add-debt');
    if (addBtn) {
      addBtn.addEventListener('click', _openDebtModal);
    }

    // History toggle - now opens modal
    var historyToggle = _qs('#hub-cf-debt-history-toggle');
    if (historyToggle) {
      historyToggle.addEventListener('click', _openDebtHistoryModal);
    }

    // Modal close (Add Debt modal)
    var closeBtn = _qs('#hub-cf-debt-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', _closeDebtModal);

    // Modal cancel (Add Debt modal)
    var cancelBtn = _qs('#hub-cf-debt-btn-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _closeDebtModal);

    // Overlay backdrop (Add Debt modal)
    var overlay = _qs('#hub-cf-debt-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeDebtModal();
      });
    }

    // Form submit (Add Debt modal)
    var form = _qs('#hub-cf-debt-form');
    if (form) {
      form.addEventListener('submit', _handleDebtFormSubmit);
    }

    // History modal close
    var historyCloseBtn = _qs('#hub-cf-debt-history-modal-close');
    if (historyCloseBtn) historyCloseBtn.addEventListener('click', _closeDebtHistoryModal);

    // History modal overlay backdrop
    var historyOverlay = _qs('#hub-cf-debt-history-overlay');
    if (historyOverlay) {
      historyOverlay.addEventListener('click', function (e) {
        if (e.target === historyOverlay) _closeDebtHistoryModal();
      });
    }

    // Event delegation for Paid History Modal delete buttons (static parent, bound once)
    _bindDebtHistoryModalDelegation();
  }

  function _openDebtModal() {
    var overlay = _qs('#hub-cf-debt-overlay');
    if (!overlay) return;
    var form = _qs('#hub-cf-debt-form');
    if (form) form.reset();
    var today = _todayISO();
    var dateBorrowed = _qs('#hub-cf-debt-date-borrowed');
    var expectedReturn = _qs('#hub-cf-debt-expected-return');
    if (dateBorrowed) dateBorrowed.value = today;
    if (expectedReturn) expectedReturn.value = today;
    overlay.style.display = 'flex';
    setTimeout(function () {
      var debtorInput = _qs('#hub-cf-debt-debtor');
      if (debtorInput) debtorInput.focus();
    }, 150);
  }

  function _closeDebtModal() {
    var overlay = _qs('#hub-cf-debt-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      _editingDebtId = null;
      const titleEl = _qs('#hub-cf-debt-overlay .hub-cf-modal-title');
      if (titleEl) titleEl.textContent = _pd_t('modalTitle');
      overlay.setAttribute('aria-label', _pd_t('modalTitle'));
    }
  }

  // Update debt modal title when language changes
  function _updateDebtModalTitle() {
    var overlay = _qs('#hub-cf-debt-overlay');
    if (overlay && overlay.style.display === 'flex') {
      var isEditing = _editingDebtId !== null;
      var titleEl = _qs('#hub-cf-debt-overlay .hub-cf-modal-title');
      if (titleEl) {
        titleEl.textContent = isEditing ? _pd_t('modalTitleEdit') : _pd_t('modalTitle');
      }
      overlay.setAttribute('aria-label', isEditing ? _pd_t('modalTitleEdit') : _pd_t('modalTitle'));
    }
  }

  // ══════════════════════════════════════════
  // EDIT DEBT MODAL LOGIC
  // ══════════════════════════════════════════

  function _openEditDebtModal(debtId) {
    const debt = _data.debts.find(d => d.id === debtId);
    if (!debt) return;

    _editingDebtId = debtId;

    var overlay = _qs('#hub-cf-debt-overlay');
    if (!overlay) return;

    // Reset form
    var form = _qs('#hub-cf-debt-form');
    if (form) form.reset();

    // Update modal title
    var titleEl = _qs('#hub-cf-debt-overlay .hub-cf-modal-title');
    var editTitle = _pd_t('modalTitleEdit') || 'Sửa Thông Tin Nợ';
    if (titleEl) {
      titleEl.textContent = editTitle;
    }
    overlay.setAttribute('aria-label', editTitle);

    // Populate fields
    var debtorInput = _qs('#hub-cf-debt-debtor');
    var amountInput = _qs('#hub-cf-debt-amount');
    var dateBorrowedInput = _qs('#hub-cf-debt-date-borrowed');
    var expectedReturnInput = _qs('#hub-cf-debt-expected-return');
    var noteInput = _qs('#hub-cf-debt-note');

    if (debtorInput) debtorInput.value = debt.debtorName || '';
    if (amountInput) amountInput.value = debt.amount || '';
    if (dateBorrowedInput) dateBorrowedInput.value = debt.dateBorrowed || '';
    if (expectedReturnInput) expectedReturnInput.value = debt.expectedReturnDate || '';
    if (noteInput) noteInput.value = debt.note || '';

    overlay.style.display = 'flex';
    setTimeout(function () {
      if (debtorInput) debtorInput.focus();
    }, 150);
  }

  function _handleDebtFormSubmit(e) {
    e.preventDefault();
    var debtorName = _qs('#hub-cf-debt-debtor');
    var amount = _qs('#hub-cf-debt-amount');
    var dateBorrowed = _qs('#hub-cf-debt-date-borrowed');
    var expectedReturn = _qs('#hub-cf-debt-expected-return');
    var note = _qs('#hub-cf-debt-note');

    if (!debtorName || !debtorName.value.trim()) { _showInput('#hub-cf-debt-debtor'); return; }
    if (!amount || !amount.value || Number(amount.value) <= 0) { _showInput('#hub-cf-debt-amount'); return; }
    if (!dateBorrowed || !dateBorrowed.value) { _showInput('#hub-cf-debt-date-borrowed'); return; }
    if (!expectedReturn || !expectedReturn.value) { _showInput('#hub-cf-debt-expected-return'); return; }
    if (new Date(expectedReturn.value) < new Date(dateBorrowed.value)) {
      alert(_pd_t('labelExpectedReturn') + ' không thể nhỏ hơn ' + _pd_t('labelDateBorrowed') + '.');
      _showInput('#hub-cf-debt-expected-return');
      return;
    }

    if (_editingDebtId) {
      // EDIT MODE: Update existing debt
      var debtIndex = _data.debts.findIndex(d => d.id === _editingDebtId);
      if (debtIndex !== -1) {
        _data.debts[debtIndex] = {
          ..._data.debts[debtIndex],
          debtorName: debtorName.value.trim(),
          amount: Number(amount.value),
          dateBorrowed: dateBorrowed.value,
          expectedReturnDate: expectedReturn.value,
          note: note ? note.value.trim() : ''
        };
      }
      _editingDebtId = null;
    } else {
      // CREATE MODE: Add new debt
      _addDebt(
        debtorName.value.trim(),
        Number(amount.value),
        dateBorrowed.value,
        expectedReturn.value,
        note ? note.value.trim() : ''
      );
    }

    _debouncedPersist();
    _closeDebtModal();
    _refreshDebtSummary();
    _refreshDebtLedger();

    // Reset modal title
    var titleEl = _qs('#hub-cf-debt-overlay .hub-cf-modal-title');
    if (titleEl) {
      titleEl.textContent = _pd_t('modalTitle');
    }
    var overlay = _qs('#hub-cf-debt-overlay');
    if (overlay) {
      overlay.setAttribute('aria-label', _pd_t('modalTitle'));
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