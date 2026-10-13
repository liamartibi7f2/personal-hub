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

      // Dashboard v2
      cfdTitle: 'Financial overview', cfdHide: 'Hide balances', cfdShow: 'Show balances',
      cfdNetWorth: 'Net worth', cfdBank: 'Bank', cfdCash: 'Cash', cfdSavings: 'Savings & investments',
      cfdCashflow: 'Cash flow', cfdRemaining: 'Remaining', cfdIncome: 'Income', cfdExpense: 'Expenses',
      cfdSaved: 'Saved', cfdUncategorized: 'Uncategorized', cfdNeedsReview: 'needs review',
      cfdDebt: 'Pending debts', cfdPeriodDay: 'Last 30 days', cfdMonth: 'Month', cfdYear: 'Year',

      // Chart
      chartTitle:       'INCOME VS EXPENSE',
      chartIncome:      'Income',
      chartExpense:     'Expense',
      chartCash:        'Cash Flow',
      chartBank:        'Bank Flow',
      chartDay:         'Day',
      chartMonth:       'Month',
      chartYear:        'Year',
      viewChart:        'Chart',
      viewHeatmap:      'Heatmap',
      heatmapDailyLimit: 'Limit:',
      heatmapPerDay:    '/ day',
      heatmapLevel0:    'Safe',
      heatmapLevel1:    'Under 50%',
      heatmapLevel2:    '50-100%',
      heatmapLevel3:    'Over Limit',
      heatmapTotalSpent: 'Total Spent:',
      heatmapTopCategory: 'Top Category:',
      heatmapNoExpense: 'No expenses',
      heatmapPrevMonth: 'Previous month',
      heatmapNextMonth: 'Next month',
      heatmapThisMonth: 'This month',
      heatmapPickMonth: 'Pick a month',
      heatmapPrevYear:  'Previous year',
      heatmapNextYear:  'Next year',
      heatmapHasData:   'Has expenses',

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
      labelDateFrom:    'From',
      labelDateTo:      'To',
      sortNewest:       'Newest First',
      sortOldest:       'Oldest First',
      sortHighest:      'Highest First',
      sortLowest:       'Lowest First',
      sortNone:         'No Sort',
      labelKeyword:     'Keyword',
      labelSelectCategories: 'Select Categories',
      labelMin:         'Min',
      labelMax:         'Max',
      placeholderKeyword: 'Search description...',
      btnClear:         'Clear',
      btnApply:         'Apply',
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

      // Dashboard v2
      cfdTitle: 'Tổng quan tài chính', cfdHide: 'Ẩn số dư', cfdShow: 'Hiện số dư',
      cfdNetWorth: 'Tài sản ròng', cfdBank: 'Ngân hàng', cfdCash: 'Tiền mặt', cfdSavings: 'Tiết kiệm & đầu tư',
      cfdCashflow: 'Dòng tiền', cfdRemaining: 'Còn lại', cfdIncome: 'Thu nhập', cfdExpense: 'Chi tiêu',
      cfdSaved: 'Để dành', cfdUncategorized: 'Chưa phân loại', cfdNeedsReview: 'cần xem xét',
      cfdDebt: 'Nợ đang chờ thu', cfdPeriodDay: '30 ngày gần nhất', cfdMonth: 'Tháng', cfdYear: 'Năm',

      // Chart
      chartTitle:       'THU NHẬP VÀ CHI PHÍ',
      chartIncome:      'Thu Nhập',
      chartExpense:     'Chi Phí',
      chartCash:        'Dòng tiền mặt',
      chartBank:        'Dòng ngân hàng',
      chartDay:         'Ngày',
      chartMonth:       'Tháng',
      chartYear:        'Năm',
      viewChart:        'Biểu đồ',
      viewHeatmap:      'Heatmap',
      heatmapDailyLimit: 'Hạn mức:',
      heatmapPerDay:    '/ ngày',
      heatmapLevel0:    'An toàn',
      heatmapLevel1:    'Dưới 50%',
      heatmapLevel2:    '50-100%',
      heatmapLevel3:    'Vượt hạn',
      heatmapTotalSpent: 'Tổng chi:',
      heatmapTopCategory: 'Hạng mục chính:',
      heatmapNoExpense: 'Không chi tiêu',
      heatmapPrevMonth: 'Tháng trước',
      heatmapNextMonth: 'Tháng sau',
      heatmapThisMonth: 'Tháng này',
      heatmapPickMonth: 'Chọn tháng',
      heatmapPrevYear:  'Năm trước',
      heatmapNextYear:  'Năm sau',
      heatmapHasData:   'Có chi tiêu',

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
      labelDateFrom:    'Từ',
      labelDateTo:      'Đến',
      sortNewest:       'Mới nhất trước',
      sortOldest:       'Cũ nhất trước',
      sortHighest:      'Cao nhất trước',
      sortLowest:       'Thấp nhất trước',
      sortNone:         'Không sắp xếp',
      labelKeyword:     'Từ khóa',
      labelSelectCategories: 'Chọn hạng mục',
      labelMin:         'Tối thiểu',
      labelMax:         'Tối đa',
      placeholderKeyword: 'Tìm kiếm mô tả...',
      btnClear:         'Xóa bộ lọc',
      btnApply:         'Áp dụng',
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
      toastRecoveryDone:   '✅ Đã thu nợ {amount} vào {wallet}',
      noDebtsYet:          'Chưa có khoản nợ nào.',
      noDebtsHint:         'Nhấn <strong>Thêm nợ mới</strong> để bắt đầu theo dõi.',
      historyTitle:        'LỊCH SỬ ĐÃ TRẢ',
      toggleHistory:       'Xem lịch sử',
      emptyHistory:        'Chưa có khoản nợ nào được trả.',
      btnClose:            'Đóng',
      // Debt Recovery Modal
      recoveryTitle:       'THU HỒI NỢ',
      labelRecoverySource: 'Nguồn nhận tiền',
      optionCash:          'Tiền mặt (Cash)',
      optionBank:          'Chuyển khoản (Bank)',
      hintRecoveryNoIncome: 'Tiền nợ sẽ được cộng vào ví bạn chọn. Loại này <strong>không tính vào Thu nhập</strong>.',
      btnConfirm:          'Xác nhận'
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
      toastRecoveryDone:   '✅ Recovered {amount} into {wallet}',
      noDebtsYet:          'No debts yet.',
      noDebtsHint:         'Click <strong>Add New Debt</strong> to start tracking.',
      historyTitle:        'PAID HISTORY',
      toggleHistory:       'View History',
      emptyHistory:        'No paid debts yet.',
      btnClose:            'Close',
      // Debt Recovery Modal
      recoveryTitle:       'DEBT RECOVERY',
      labelRecoverySource: 'Destination Wallet',
      optionCash:          'Cash (Physical)',
      optionBank:          'Bank Transfer',
      hintRecoveryNoIncome: 'Money will be added to selected wallet. This does <strong>not count as Income</strong>.',
      btnConfirm:          'Confirm'
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
    initCash: 0,
    budgets: {},                // Category budget limits: { categoryId: amount }
    dailyLimits: {}             // Daily expense limits per month: { "YYYY-MM": amount }
  };

  // ═══════════════════════════════════════════════════════════════
  // CENTRALIZED TABLE FILTER STATE — Data Pipeline Architecture
  // ═══════════════════════════════════════════════════════════════
  // Single source of truth for all column filters.
  // Each column gets its own namespace; pipelines compose without conflict.
  // Extensible: description, category, amount can be added later.
  let _txTableState = {
    date: { from: null, to: null, sort: 'desc' },
    description: { keyword: '' },
    category: { selected: [] },
    amount: { min: null, max: null, sort: null }
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
  let _heatmapView   = 'chart';  // 'chart' | 'heatmap'

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
    requestId: 0,                    // For deduplication
    tab: 'plan',                     // 'plan' | 'chat' (persisted)
    userAborted: false,              // User pressed Stop
    _loadingTimer: null
  };

  function _loadAIState() {
    try {
      const saved = localStorage.getItem('hub_cf_ai_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        _aiState.provider = parsed.provider || 'gemini';
        _aiState.conversationHistory = parsed.conversationHistory || [];
        _aiState.currentResponse = parsed.currentResponse || '';
        _aiState.tab = parsed.tab === 'chat' ? 'chat' : 'plan';
        // Don't restore isLoading from disk — check in-flight request instead
      }
    } catch (_) {}
  }

  function _saveAIState() {
    try {
      localStorage.setItem('hub_cf_ai_state', JSON.stringify({
        provider: _aiState.provider,
        conversationHistory: _aiState.conversationHistory.slice(-60),
        currentResponse: _aiState.currentResponse,
        tab: _aiState.tab
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
    _cashFlowMeta.budgets = meta.budgets || {};
    _cashFlowMeta.dailyLimits = meta.dailyLimits || {};

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

  /** Query selector all shortcut */
  function _qsAll(sel) {
    if (!_container) return [];
    return Array.from(_container.querySelectorAll(sel));
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

  /* ──────────────────────────────────────────────
     _enableKeyboardNavigation(formSelector)
     - Keyboard jumping (Enter, Arrows)
     - Shift+S Quick Save
     - Bulletproof Vietnamese IME Guard
     ────────────────────────────────────────────── */
  function _enableKeyboardNavigation(formSelector) {
    var form = _qs(formSelector);
    if (!form) return;

    // Feature: Shift + S to Quick Save
    if (!form.dataset.shortcutBound) {
      form.dataset.shortcutBound = "true";
      form.addEventListener('keydown', function(e) {
        if (e.shiftKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          var saveBtn = form.querySelector('button.widget-btn-green, button#btn-save-tx, button[type="submit"]');
          if (saveBtn) saveBtn.click();
        }
      });
    }

    var focusable = Array.from(form.querySelectorAll('input, select, button.widget-btn-green, button#btn-save-tx'));
    if (focusable.length === 0) return;

    focusable.forEach(function(el, index) {
      if (el.dataset.kbnavBound) return;
      el.dataset.kbnavBound = "true";

      el.addEventListener('keydown', function(e) {
        var isSelect = el.tagName.toLowerCase() === 'select';
        var isDate = el.type === 'date';
        var isNumberType = el.type === 'number';

        // 1. BRUTE FORCE: Stop native number stepping BEFORE IME checks
        if (isNumberType && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          // Fallback for strict IMEs that bypass preventDefault
          el.blur();
          el.focus();
        }

        // 2. VIETNAMESE IME GUARD (Input Method Editor)
        // If the user is currently composing a Vietnamese word (e.g. typing 'a' then 's' for 'á'),
        // or the browser reports keyCode 229 (Processing), DO NOT jump focus. Let them finish typing.
        if (e.isComposing || e.keyCode === 229) {
          return;
        }

        // 3. ENTER KEY: Jump next or submit
        if (e.key === 'Enter') {
          e.preventDefault();
          if (el.tagName.toLowerCase() === 'button') {
            el.click();
          } else if (index < focusable.length - 1) {
            focusable[index + 1].focus();
          }
        }

        // 4. ARROW DOWN: Jump next
        if (e.key === 'ArrowDown' && !isSelect && !isDate) {
          e.preventDefault();
          if (index < focusable.length - 1) focusable[index + 1].focus();
        }

        // 5. ARROW UP: Jump previous
        if (e.key === 'ArrowUp' && !isSelect && !isDate) {
          e.preventDefault();
          if (index > 0) focusable[index - 1].focus();
        }
      });
    });
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

  /** ═══════════════════════════════════════════════════════════════
   * DATA PIPELINE: Filter & Sort Transactions
   * Centralized function that applies _txTableState to a fresh copy
   * of the current month's transactions. Pure — no mutation of _data.
   * ═══════════════════════════════════════════════════════════════ */
  function _getFilteredAndSortedTransactions() {
    // 1. Get fresh copy of current month's transactions (no mutation)
    var txs = _getMonthTransactions(_currentMonth.year, _currentMonth.month).slice();

    // 2. Apply Date Filter
    var from = _txTableState.date.from;
    var to = _txTableState.date.to;
    if (from !== null) {
      txs = txs.filter(function (tx) { return (tx.day || 0) >= from; });
    }
    if (to !== null) {
      txs = txs.filter(function (tx) { return (tx.day || 0) <= to; });
    }

    // 3. Apply Description Filter (case-insensitive keyword search)
    var keyword = _txTableState.description.keyword;
    if (keyword && keyword.trim()) {
      var kw = keyword.trim().toLowerCase();
      txs = txs.filter(function (tx) {
        return (tx.desc || '').toLowerCase().indexOf(kw) !== -1;
      });
    }

    // 4. Apply Category Filter (multi-select)
    var selectedCats = _txTableState.category.selected;
    if (selectedCats && selectedCats.length > 0) {
      txs = txs.filter(function (tx) {
        return selectedCats.indexOf(tx.category) !== -1;
      });
    }

    // 5. Apply Amount Filter
    var minAmt = _txTableState.amount.min;
    var maxAmt = _txTableState.amount.max;
    if (minAmt !== null) {
      txs = txs.filter(function (tx) { return (tx.amount || 0) >= minAmt; });
    }
    if (maxAmt !== null) {
      txs = txs.filter(function (tx) { return (tx.amount || 0) <= maxAmt; });
    }

    // 6. Apply Sort (priority: amount sort > date sort)
    var amtSort = _txTableState.amount.sort;
    if (amtSort === 'asc' || amtSort === 'desc') {
      txs.sort(function (a, b) {
        var amtA = a.amount || 0;
        var amtB = b.amount || 0;
        return amtSort === 'asc' ? amtA - amtB : amtB - amtA;
      });
    } else {
      // Fallback to date sort
      var dateSort = _txTableState.date.sort;
      txs.sort(function (a, b) {
        var dayA = a.day || 0;
        var dayB = b.day || 0;
        return dateSort === 'asc' ? dayA - dayB : dayB - dayA;
      });
    }

    return txs;
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
  const providerSelect = _qs('#cf-ai-provider');
  if (providerSelect) providerSelect.value = _aiState.provider;

  _renderChatHistory();
  _renderSpendingPlan();     // cũng cập nhật Insight banner
  _switchAITab(_aiState.tab);
  _updateAIStatus();

  // Yêu cầu vẫn đang chạy ngầm (người dùng vừa chuyển tab rồi quay lại)
  if (_aiState.isLoading && _aiState.abortController) {
    _showAILoading('Đang phân tích… (tiếp tục ở nền)');
    _setAIBusy(true);
  } else {
    _setAIBusy(false);
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
}

/* Smart Budget UI */
.hub-cf-cat-budget-btn {
  background: transparent; border: none; padding: 0 0 0 6px;
  cursor: pointer; opacity: 0.4; font-size: 0.8rem; transition: all 0.2s;
}
.hub-cf-cat-budget-btn:hover { opacity: 1; transform: scale(1.1); }
.hub-cf-bar-safe { background-color: var(--success, #00e676) !important; }
.hub-cf-bar-warning { background-color: var(--warning, #ffb300) !important; }
.hub-cf-bar-danger { background-color: var(--danger, #ff5252) !important; box-shadow: 0 0 6px color-mix(in srgb, var(--danger) 50%, transparent); }
.hub-cf-budget-over { animation: cfPulseDanger 1.5s infinite; color: var(--danger); font-weight: bold; }
@keyframes cfPulseDanger { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }

/* ============================================================
   FILTER POPOVER — Date column (extensible for other columns)
   ============================================================ */
.hub-cf-col-filterable {
  position: relative;
  user-select: none;
}

.hub-cf-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 180ms, background 180ms, transform 120ms;
  opacity: 0.7;
  flex-shrink: 0;
}
.hub-cf-filter-btn:hover {
  opacity: 1;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  transform: scale(1.05);
}
.hub-cf-filter-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  opacity: 1;
}

.hub-cf-filter-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  min-width: 220px;
  max-width: 280px;
  padding: 0;
  margin-top: 4px;
  border-radius: var(--radius-md, 10px);
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  overflow: hidden;
  animation: cfPopoverIn 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
@keyframes cfPopoverIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.hub-cf-filter-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
}
.hub-cf-filter-popover-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
}
.hub-cf-filter-popover-close {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  border-radius: var(--radius-sm, 6px);
  transition: color 150ms, background 150ms;
}
.hub-cf-filter-popover-close:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.hub-cf-filter-popover-body {
  padding: 12px;
}
.hub-cf-filter-row {
  margin-bottom: 10px;
}
.hub-cf-filter-row:last-child { margin-bottom: 0; }
.hub-cf-filter-row label {
  display: block;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.hub-cf-filter-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  border-radius: var(--radius-sm, 6px);
  background: color-mix(in srgb, var(--bg-card) 80%, transparent);
  color: var(--text-primary);
  font-size: 0.8rem;
  box-sizing: border-box;
  transition: border-color 150ms, box-shadow 150ms;
}
.hub-cf-filter-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 25%, transparent);
}

.hub-cf-filter-sort-row {
  display: flex;
  gap: 16px;
}
.hub-cf-filter-sort-row label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  color: var(--text-primary);
  cursor: pointer;
  margin-bottom: 0;
}
.hub-cf-filter-sort-row input[type="radio"] {
  accent-color: var(--primary);
  width: 14px;
  height: 14px;
}

.hub-cf-filter-popover-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  background: color-mix(in srgb, var(--bg-card) 50%, transparent);
}
.hub-cf-filter-btn-clear,
.hub-cf-filter-btn-apply {
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  font-size: 0.74rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms;
}
.hub-cf-filter-btn-clear {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.hub-cf-filter-btn-clear:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.hub-cf-filter-btn-apply {
  background: var(--primary);
  color: white;
}
.hub-cf-filter-btn-apply:hover {
  filter: brightness(1.1);
}

/* ============================================================
   TABLE FILTER POPOVER (DATE & PIPELINE) — Supplemental Styles
   ============================================================ */
.hub-cf-col-filterable {
  position: relative;
  cursor: pointer;
}

.hub-cf-th-inner {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

.hub-cf-filter-icon {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  padding: 2px;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  transition: all 0.2s;
}

.hub-cf-filter-icon:hover, .hub-cf-filter-icon.active {
  color: var(--primary, #00e676);
  background: color-mix(in srgb, var(--primary) 15%, transparent);
}

.hub-cf-filter-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 999;
  width: 240px;
  background: var(--bg-card, #121212);
  border: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 16px;
  text-transform: none;
  font-weight: normal;
  color: var(--text-primary, #e0e0e0);
}

/* Add a tiny triangle arrow pointing up */
.hub-cf-filter-popover::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 16px;
  width: 10px;
  height: 10px;
  background: var(--bg-card, #121212);
  border-left: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
  transform: rotate(45deg);
}

.cf-popover-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}

.cf-popover-group label {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.cf-popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cf-popover-row input[type="number"] {
  width: 100%;
  background: rgba(0,0,0,0.2);
  border: 1px solid color-mix(in srgb, var(--text-muted) 30%, transparent);
  color: var(--text-primary, #fff);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
}

.cf-popover-row input[type="number"]:focus {
  border-color: var(--primary, #00e676);
}

.cf-popover-group label.cf-radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-primary, #e0e0e0);
  text-transform: none;
  font-weight: normal;
  cursor: pointer;
}

.cf-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
}

/* Fix Clipping: Allow popovers to escape table wrappers */
.hub-cf-ledger.glass-card,
.hub-cf-view-wrapper,
.hub-cf-table-wrap,
.hub-cf-table {
  overflow: visible !important;
}

/* Custom Checkbox Design for Category Popover */
#filter-cat-list {
  max-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
}
/* Sleek Scrollbar */
#filter-cat-list::-webkit-scrollbar { width: 4px; }
#filter-cat-list::-webkit-scrollbar-track { background: transparent; }
#filter-cat-list::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text-muted) 30%, transparent); border-radius: 4px; }

.cf-category-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.2s;
  cursor: pointer;
}
.cf-category-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* Hide native checkbox */
.cf-category-item input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--text-muted, #888);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  margin: 0;
  margin-top: 3px;
  transition: all 0.2s;
}

/* Checked state */
.cf-category-item input[type="checkbox"]:checked {
  background: var(--primary, #00e676);
  border-color: var(--primary, #00e676);
}

/* Custom Checkmark */
.cf-category-item input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #121212;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.cf-category-label {
  font-size: 0.85rem;
  color: var(--text-primary, #e0e0e0);
  line-height: 1.4;
  word-break: break-word;
}

/* Table Header Filter Styles */
.hub-cf-th-inner {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

.hub-cf-filter-icon {
  background: transparent;
  border: none;
  color: var(--text-muted, #888);
  padding: 2px;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  transition: all 0.2s;
}

.hub-cf-filter-icon:hover, .hub-cf-filter-icon.active {
  color: var(--primary, #00e676);
  background: color-mix(in srgb, var(--primary) 15%, transparent);
}

/* ============================================================
   PROFESSIONAL FILTER POPOVER STYLING
   ============================================================ */

/* Professional Input Styling */
.cf-input-styled {
  width: 100%;
  background: rgba(0, 0, 0, 0.3) !important;
  border: 1px solid color-mix(in srgb, var(--text-muted) 30%, transparent) !important;
  color: var(--text-primary) !important;
  padding: 8px 10px !important;
  border-radius: 6px !important;
  font-size: 0.85rem !important;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
.cf-input-styled:focus { border-color: var(--primary) !important; }

/* Vertical Radio Alignment */
.cf-radio-vertical-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.cf-radio-vertical-group .cf-radio-label {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-primary);
  cursor: pointer;
}
.cf-radio-vertical-group .cf-radio-label input[type="radio"] {
  accent-color: var(--primary);
  width: 14px;
  height: 14px;
}

/* Popover Action Buttons */
.cf-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--text-muted) 20%, transparent);
}

/* Popover Row Layout */
.cf-popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cf-popover-row .cf-input-styled { flex: 1; }
.cf-popover-row span { flex-shrink: 0; }

/* Category List Styling */
#filter-cat-list {
  max-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
}
#filter-cat-list::-webkit-scrollbar { width: 4px; }
#filter-cat-list::-webkit-scrollbar-track { background: transparent; }
#filter-cat-list::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text-muted) 30%, transparent); border-radius: 4px; }

.cf-category-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.2s;
  cursor: pointer;
}
.cf-category-item:hover { background: rgba(255, 255, 255, 0.05); }

.cf-category-item input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--text-muted, #888);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  margin: 0;
  margin-top: 3px;
  transition: all 0.2s;
}
.cf-category-item input[type="checkbox"]:checked {
  background: var(--primary, #00e676);
  border-color: var(--primary, #00e676);
}
.cf-category-item input[type="checkbox"]:checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #121212;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.cf-category-label {
  font-size: 0.85rem;
  color: var(--text-primary, #e0e0e0);
  line-height: 1.4;
  word-break: break-word;
}

/* ============================================================
   GOLDEN BULLET: Scrollable Table + Sticky Headers + Unclipped Popovers
   ============================================================ */

/* 1. Enable internal scrolling with a safety net for vertical popover space */
.hub-cf-table-wrap {
  max-height: 450px !important;
  min-height: 380px !important; /* Guarantees enough vertical space for the longest popover to drop down */
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

/* 2. Sticky Headers: Keep filters visible while scrolling */
.hub-cf-table th {
  position: sticky !important;
  top: 0 !important;
  z-index: 20 !important;
  background: var(--bg-card, #121212) !important;
  box-shadow: 0 2px 4px rgba(0,0,0,0.3) !important;
}

/* 3. Horizontal Anti-Clipping: Force right-side popovers to open INWARD */
#popover-filter-cat,
#popover-filter-amt {
  left: auto !important;
  right: 0 !important;
}

/* 4. Left-side popovers open normally */
#popover-filter-date,
#popover-filter-desc {
  left: 0 !important;
  right: auto !important;
}

/* AI Advisor styles live in styles.css (section "AI ADVISOR v2" — .cfx-*) */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ============================================================
   CYBERPUNK HEATMAP — Calendar View
   ============================================================ */

/* View Toggle */
.hub-cf-view-toggle {
  display: inline-flex;
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 2px;
  gap: 2px;
}

.hub-cf-view-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 500;
  font-family: var(--font-mono);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 180ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  white-space: nowrap;
}

.hub-cf-view-toggle-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
}

.hub-cf-view-toggle-btn.active {
  color: var(--bg-deep);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent-primary) 40%, transparent);
}

.hub-cf-view-toggle-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.hub-cf-view-toggle-icon {
  font-size: 0.9rem;
  line-height: 1;
}

/* Heatmap Container */
.hub-cf-heatmap-wrap {
  width: 100%;
  overflow-x: auto;
}

.hub-cf-heatmap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin: 0 0 16px;               /* margin âm cũ bị .hub-cf-heatmap-wrap (overflow:auto) cắt mất mép trên của nút/pill */
  border-bottom: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--bg-elevated) 60%, transparent);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  flex-wrap: wrap;
  gap: 12px;
}

.hub-cf-heatmap-month {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hub-cf-heatmap-limit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent);
  border-radius: var(--radius-md);
}

.hub-cf-heatmap-limit-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hub-cf-heatmap-limit-value {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--accent-primary);
  text-shadow: 0 0 12px color-mix(in srgb, var(--accent-primary) 60%, transparent);
}

.hub-cf-heatmap-limit-unit {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.hub-cf-heatmap-edit-limit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  margin-left: 4px;
}

.hub-cf-heatmap-edit-limit:hover {
  color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
  transform: scale(1.1);
}

.hub-cf-heatmap-edit-limit:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* Heatmap Grid */
.hub-cf-heatmap-grid {
  padding: 0 8px 16px;
  position: relative;  /* Positioning context for tooltip */
}

.hub-cf-heatmap-day-headers {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 8px;
}

.hub-cf-heatmap-day-header {
  text-align: center;
  font-size: 0.65rem;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 6px 0;
}

.hub-cf-heatmap-cells {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

/* Heatmap Cells */
.hub-cf-heatmap-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
  position: relative;
  min-height: 44px;
  padding: 4px 2px;
  box-sizing: border-box;
}

.hub-cf-heatmap-cell:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  z-index: 10;
}

.hub-cf-heatmap-cell--empty {
  background: transparent;
  cursor: default;
  pointer-events: none;
}

/* Level 0: Safe / Energy Conserved — Dark bg, glowing accent border */
.hub-cf-heatmap-cell--level-0 {
  background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
  border: 1.5px solid var(--accent-primary);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 20%, transparent),
    0 0 8px color-mix(in srgb, var(--accent-primary) 15%, transparent);
}

.hub-cf-heatmap-cell--level-0:hover {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 40%, transparent),
    0 0 16px color-mix(in srgb, var(--accent-primary) 30%, transparent);
  transform: scale(1.05);
}

/* Level 1: Under 50% — Dim Amber/Orange */
.hub-cf-heatmap-cell--level-1 {
  background: linear-gradient(145deg,
    color-mix(in srgb, #ffb300 15%, var(--bg-surface)),
    color-mix(in srgb, #ffb300 8%, var(--bg-surface))
  );
  border: 1px solid color-mix(in srgb, #ffb300 30%, transparent);
}

.hub-cf-heatmap-cell--level-1:hover {
  box-shadow: 0 0 12px color-mix(in srgb, #ffb300 40%, transparent);
  transform: scale(1.05);
  border-color: color-mix(in srgb, #ffb300 50%, transparent);
}

/* Level 2: 50-100% — Red/Warning */
.hub-cf-heatmap-cell--level-2 {
  background: linear-gradient(145deg,
    color-mix(in srgb, var(--danger) 20%, var(--bg-surface)),
    color-mix(in srgb, var(--danger) 10%, var(--bg-surface))
  );
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
}

.hub-cf-heatmap-cell--level-2:hover {
  box-shadow: 0 0 14px color-mix(in srgb, var(--danger) 45%, transparent);
  transform: scale(1.05);
  border-color: color-mix(in srgb, var(--danger) 60%, transparent);
}

/* Level 3: Over Limit — Neon danger + pulse animation */
.hub-cf-heatmap-cell--level-3 {
  background: linear-gradient(145deg,
    color-mix(in srgb, var(--danger) 30%, var(--bg-surface)),
    color-mix(in srgb, var(--danger) 18%, var(--bg-surface))
  );
  border: 2px solid var(--danger);
  box-shadow:
    0 0 16px color-mix(in srgb, var(--danger) 50%, transparent),
    inset 0 0 24px color-mix(in srgb, var(--danger) 15%, transparent);
  animation: cfHeatmapPulse 2s ease-in-out infinite;
}

@keyframes cfHeatmapPulse {
  0%, 100% {
    box-shadow:
      0 0 16px color-mix(in srgb, var(--danger) 50%, transparent),
      inset 0 0 24px color-mix(in srgb, var(--danger) 15%, transparent);
    border-color: var(--danger);
  }
  50% {
    box-shadow:
      0 0 28px color-mix(in srgb, var(--danger) 70%, transparent),
      inset 0 0 32px color-mix(in srgb, var(--danger) 25%, transparent);
    border-color: color-mix(in srgb, var(--danger) 80%, #fff);
  }
}

.hub-cf-heatmap-cell--level-3:hover {
  animation: none;
  transform: scale(1.05);
  box-shadow:
    0 0 32px color-mix(in srgb, var(--danger) 80%, transparent),
    inset 0 0 40px color-mix(in srgb, var(--danger) 30%, transparent);
}

/* Today indicator */
.hub-cf-heatmap-cell--today {
  position: relative;
}

.hub-cf-heatmap-cell--today::before {
  content: '';
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  background: var(--accent-primary);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--accent-primary);
  animation: cfTodayPulse 1.5s ease-in-out infinite;
}

@keyframes cfTodayPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.8); }
}

/* Selected cell (clicked for filtering) */
.hub-cf-heatmap-cell--selected {
  outline: 2px solid var(--accent-secondary);
  outline-offset: -2px;
  box-shadow:
    0 0 0 2px var(--accent-secondary),
    0 0 20px color-mix(in srgb, var(--accent-secondary) 40%, transparent) !important;
}

.hub-cf-heatmap-cell-day {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1;
  z-index: 1;
}

.hub-cf-heatmap-cell--level-0 .hub-cf-heatmap-cell-day { color: var(--accent-primary); }
.hub-cf-heatmap-cell--level-1 .hub-cf-heatmap-cell-day { color: #ffb300; }
.hub-cf-heatmap-cell--level-2 .hub-cf-heatmap-cell-day { color: var(--danger); }
.hub-cf-heatmap-cell--level-3 .hub-cf-heatmap-cell-day { color: #fff; text-shadow: 0 0 4px var(--danger); }

.hub-cf-heatmap-cell-amount {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 500;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1;
  opacity: 0.8;
}

.hub-cf-heatmap-cell--level-3 .hub-cf-heatmap-cell-amount { color: color-mix(in srgb, #fff 80%, var(--danger)); }

/* Heatmap Legend */
.hub-cf-heatmap-legend {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 16px;
  flex-wrap: wrap;
}

.hub-cf-heatmap-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.7rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.hub-cf-heatmap-legend-color {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  flex-shrink: 0;
  border: 1px solid var(--glass-border);
}

.hub-cf-heatmap-legend-level-0 {
  background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
  border-color: var(--accent-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 20%, transparent);
}

.hub-cf-heatmap-legend-level-1 {
  background: linear-gradient(145deg, color-mix(in srgb, #ffb300 15%, var(--bg-surface)), color-mix(in srgb, #ffb300 8%, var(--bg-surface)));
  border-color: color-mix(in srgb, #ffb300 30%, transparent);
}

.hub-cf-heatmap-legend-level-2 {
  background: linear-gradient(145deg, color-mix(in srgb, var(--danger) 20%, var(--bg-surface)), color-mix(in srgb, var(--danger) 10%, var(--bg-surface)));
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}

.hub-cf-heatmap-legend-level-3 {
  background: linear-gradient(145deg, color-mix(in srgb, var(--danger) 30%, var(--bg-surface)), color-mix(in srgb, var(--danger) 18%, var(--bg-surface)));
  border-color: var(--danger);
  box-shadow: 0 0 10px color-mix(in srgb, var(--danger) 40%, transparent);
  animation: cfHeatmapPulse 2s ease-in-out infinite;
}

/* Mobile responsiveness */
@media (max-width: 768px) {
  .hub-cf-heatmap-cell {
    min-height: 36px;
    padding: 2px 1px;
  }

  .hub-cf-heatmap-day-header {
    font-size: 0.55rem;
    padding: 4px 0;
  }

  .hub-cf-heatmap-cell-day {
    font-size: 0.75rem;
  }

  .hub-cf-heatmap-cell-amount {
    font-size: 0.5rem;
  }

  .hub-cf-heatmap-limit {
    padding: 4px 8px;
    gap: 6px;
  }

  .hub-cf-heatmap-limit-value {
    font-size: 0.8rem;
  }

  .hub-cf-view-toggle-btn {
    padding: 6px 10px;
    font-size: 0.7rem;
    gap: 4px;
  }

  .hub-cf-heatmap-legend {
    gap: 16px;
  }

  .hub-cf-heatmap-legend-item {
    font-size: 0.62rem;
  }

  .hub-cf-heatmap-legend-color {
    width: 12px;
    height: 12px;
  }
}
`;
        document.head.appendChild(styleEl);
      }

      // ══════════════════════════════════════════
      // HTML STRUCTURE
      // ══════════════════════════════════════════
      container.innerHTML = `
<div class="hub-cf-container">

  <!-- ═══ DASHBOARD — Summary Section ═══ -->
  <div class="hub-cf-dashboard glass-card cfd-host">
    <div class="cfd" id="cfd-root">

      <div class="cfd-head">
        <h3 class="cfd-title" data-i18n="cfdTitle">${_t('cfdTitle')}</h3>
        <button type="button" class="cfd-hide-btn" id="cfd-hide-btn" aria-pressed="false">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          <span id="cfd-hide-label">${_t('cfdHide')}</span>
        </button>
      </div>

      <div class="cfd-grid">

        <!-- Assets: Net Worth + allocation (Bank / Cash) + Savings -->
        <section class="cfd-card" aria-labelledby="cfd-assets-label">
          <div class="cfd-card-top"><span class="cfd-label" id="cfd-assets-label" data-i18n="cfdNetWorth">${_t('cfdNetWorth')}</span></div>
          <div class="cfd-hero">
            <span class="cfd-num cfd-hero-val" id="cf-networth">0 ₫</span>
            <button type="button" class="hub-cf-card-edit-btn cfd-edit" id="btn-edit-networth" data-target="net-worth" title="Chỉnh sửa Tổng Tài Sản" aria-label="Chỉnh sửa Tổng Tài Sản"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
          </div>
          <div class="cfd-alloc" id="cfd-alloc" aria-hidden="true"><i class="cfd-seg cfd-seg--bank" id="cfd-alloc-bank"></i><i class="cfd-seg cfd-seg--cash" id="cfd-alloc-cash"></i></div>
          <ul class="cfd-rows">
            <li class="cfd-row">
              <span class="cfd-row-name"><i class="cfd-dot cfd-dot--bank" aria-hidden="true"></i><span data-i18n="cfdBank">${_t('cfdBank')}</span></span>
              <span class="cfd-row-val"><span class="cfd-num" id="cf-bank-balance">0 ₫</span><span class="cfd-pct" id="cfd-pct-bank"></span><button type="button" class="hub-cf-card-edit-btn cfd-edit" id="btn-edit-bank" data-target="bank" title="Edit Bank Account Balance" aria-label="Edit Bank Account Balance"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></span>
            </li>
            <li class="cfd-row">
              <span class="cfd-row-name"><i class="cfd-dot cfd-dot--cash" aria-hidden="true"></i><span data-i18n="cfdCash">${_t('cfdCash')}</span></span>
              <span class="cfd-row-val"><span class="cfd-num" id="cf-cash-balance">0 ₫</span><span class="cfd-pct" id="cfd-pct-cash"></span><button type="button" class="hub-cf-card-edit-btn cfd-edit" id="btn-edit-cash" data-target="cash" title="Edit Cash Wallet Balance" aria-label="Edit Cash Wallet Balance"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></span>
            </li>
            <li class="cfd-row cfd-row--memo">
              <span class="cfd-row-name"><span data-i18n="cfdSavings">${_t('cfdSavings')}</span></span>
              <span class="cfd-row-val"><span class="cfd-num" id="cf-savings">0 ₫</span><button type="button" class="hub-cf-card-edit-btn cfd-edit" data-target="savings" title="Edit Savings & Investments" aria-label="Edit Savings & Investments"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button></span>
            </li>
          </ul>
        </section>

        <!-- Cash flow: Remaining + Income / Expense -->
        <section class="cfd-card" aria-labelledby="cfd-flow-label">
          <div class="cfd-card-top">
            <span class="cfd-label" id="cfd-flow-label"><span data-i18n="cfdCashflow">${_t('cfdCashflow')}</span><span class="cfd-period" id="cfd-period"></span></span>
            <span class="cfd-chip" id="cfd-rate" hidden></span>
          </div>
          <div class="cfd-sub" data-i18n="cfdRemaining">${_t('cfdRemaining')}</div>
          <div class="cfd-hero"><span class="cfd-num cfd-hero-val" id="cfd-net">0 ₫</span></div>
          <div class="cfd-bars">
            <div class="cfd-bar-row">
              <div class="cfd-bar-top"><span data-i18n="cfdIncome">${_t('cfdIncome')}</span><span class="cfd-num" id="cf-income">0 ₫</span></div>
              <div class="cfd-track"><i class="cfd-fill cfd-fill--inc" id="cfd-bar-inc"></i></div>
            </div>
            <div class="cfd-bar-row">
              <div class="cfd-bar-top"><span data-i18n="cfdExpense">${_t('cfdExpense')}</span><span class="cfd-num cfd-neg" id="cf-expense">0 ₫</span></div>
              <div class="cfd-track"><i class="cfd-fill cfd-fill--exp" id="cfd-bar-exp"></i></div>
            </div>
          </div>
        </section>
      </div>

      <div class="cfd-strip">
        <!-- Uncategorized (logic: .hub-cf-card--has-uncategorized toggled by updateDashboardTotals) -->
        <div class="cfd-note cfd-unc" id="cf-uncategorized-card">
          <span class="cfd-note-main">
            <svg class="cfd-unc-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
            <span data-i18n="cfdUncategorized">${_t('cfdUncategorized')}</span>
          </span>
          <span class="cfd-note-val"><span class="cfd-num" id="cf-uncategorized-balance">0 ₫</span><span class="cfd-note-hint" data-i18n="cfdNeedsReview">${_t('cfdNeedsReview')}</span></span>
        </div>
        <!-- Pocket Debt -->
        <div class="cfd-note cfd-debt">
          <span class="cfd-note-main"><span data-i18n="cfdDebt">${_t('cfdDebt')}</span></span>
          <span class="cfd-note-val"><span class="cfd-num" id="cf-debt-pending">${_formatVNFull(_getTotalPendingDebt())}</span></span>
        </div>
      </div>

    </div>
  </div>
<!-- ═══ REAL-TIME CHART / HEATMAP ═══ -->
    <div class="hub-cf-chart-section glass-card">
      <div class="hub-cf-chart-header">
        <h4 class="hub-cf-chart-title" data-i18n="chartTitle">${_t('chartTitle')}</h4>

        <!-- View Toggle: Chart / Heatmap -->
        <div class="hub-cf-view-toggle" role="group" aria-label="${_escHtml('View Mode')}">
          <button class="hub-cf-view-toggle-btn active" data-view="chart" aria-pressed="true" title="${_escHtml('Chart View')}">
            <span class="hub-cf-view-toggle-icon">📊</span>
            <span class="hub-cf-view-toggle-label" data-i18n="viewChart">${_t('viewChart')}</span>
          </button>
          <button class="hub-cf-view-toggle-btn" data-view="heatmap" aria-pressed="false" title="${_escHtml('Heatmap View')}">
            <span class="hub-cf-view-toggle-icon">🔲</span>
            <span class="hub-cf-view-toggle-label" data-i18n="viewHeatmap">${_t('viewHeatmap')}</span>
          </button>
        </div>

        <select class="hub-cf-chart-filter" id="hub-cf-chart-filter">
          <option value="day" data-i18n="chartDay">${_t('chartDay')}</option>
          <option value="month" selected data-i18n="chartMonth">${_t('chartMonth')}</option>
          <option value="year" data-i18n="chartYear">${_t('chartYear')}</option>
        </select>
      </div>

      <!-- Chart View -->
      <div class="hub-cf-chart-canvas-wrap" id="hub-cf-chart-view" style="display: block;">
        <canvas id="hub-cf-chart-canvas"></canvas>
      </div>

      <!-- Heatmap View -->
      <div class="hub-cf-heatmap-wrap" id="hub-cf-heatmap-view" style="display: none;">
        <div class="hub-cf-heatmap-header">
          <div class="hub-cf-heatmap-nav" role="group" aria-label="${_escHtml(_t('heatmapPickMonth'))}">
            <button type="button" class="hub-cf-heatmap-nav-btn" id="hub-cf-heatmap-prev" aria-label="${_escHtml(_t('heatmapPrevMonth'))}" title="${_escHtml(_t('heatmapPrevMonth'))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button type="button" class="hub-cf-heatmap-month-btn" id="hub-cf-heatmap-month-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="hub-cf-heatmap-picker" title="${_escHtml(_t('heatmapPickMonth'))}">
              <span class="hub-cf-heatmap-month" id="hub-cf-heatmap-month-label"></span>
              <svg class="hub-cf-heatmap-month-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button type="button" class="hub-cf-heatmap-nav-btn" id="hub-cf-heatmap-next" aria-label="${_escHtml(_t('heatmapNextMonth'))}" title="${_escHtml(_t('heatmapNextMonth'))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <button type="button" class="hub-cf-heatmap-today" id="hub-cf-heatmap-today" data-i18n="heatmapThisMonth" hidden>${_t('heatmapThisMonth')}</button>
            <div class="hub-cf-heatmap-picker" id="hub-cf-heatmap-picker" role="dialog" aria-label="${_escHtml(_t('heatmapPickMonth'))}" hidden></div>
          </div>
          <div class="heatmap-limit-pill" id="hub-cf-heatmap-limit-pill" tabindex="0" role="button" aria-label="${_escHtml('Edit Daily Limit')}" title="${_escHtml('Set daily expense limit for this month')}">
            <span class="heatmap-limit-label" data-i18n="heatmapDailyLimit">${_t('heatmapDailyLimit')}</span>
            <span class="heatmap-limit-value" id="hub-cf-heatmap-limit-value">500.0k</span>
            <span class="heatmap-limit-unit" data-i18n="heatmapPerDay">${_t('heatmapPerDay')}</span>
            <span class="heatmap-limit-icon" aria-hidden="true">✏️</span>
          </div>
        </div>
        <div class="hub-cf-heatmap-grid" id="hub-cf-heatmap-grid" role="grid" aria-label="${_escHtml('Expense heatmap calendar')}"></div>
        <!-- Tooltip "Note" của heatmap được tạo động và gắn vào <body> (xem _getHeatmapTooltip) -->
        <div class="hub-cf-heatmap-legend" id="hub-cf-heatmap-legend" aria-hidden="true">
          <div class="hub-cf-heatmap-legend-item">
            <span class="hub-cf-heatmap-legend-color hub-cf-heatmap-legend-level-0"></span>
            <span data-i18n="heatmapLevel0">${_t('heatmapLevel0')}</span>
          </div>
          <div class="hub-cf-heatmap-legend-item">
            <span class="hub-cf-heatmap-legend-color hub-cf-heatmap-legend-level-1"></span>
            <span data-i18n="heatmapLevel1">${_t('heatmapLevel1')}</span>
          </div>
          <div class="hub-cf-heatmap-legend-item">
            <span class="hub-cf-heatmap-legend-color hub-cf-heatmap-legend-level-2"></span>
            <span data-i18n="heatmapLevel2">${_t('heatmapLevel2')}</span>
          </div>
          <div class="hub-cf-heatmap-legend-item">
            <span class="hub-cf-heatmap-legend-color hub-cf-heatmap-legend-level-3"></span>
            <span data-i18n="heatmapLevel3">${_t('heatmapLevel3')}</span>
          </div>
        </div>

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
              <th class="hub-cf-col--date hub-cf-col-filterable">
                <div class="hub-cf-th-inner">
                  <span data-i18n="thDate">${_t('thDate')}</span>
                  <button class="hub-cf-filter-icon" id="btn-filter-date" aria-label="Filter Date" title="Filter by Date">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </button>
                </div>
                <div class="hub-cf-filter-popover glass" id="popover-filter-date" style="display:none; width: 220px;">
                  <div class="cf-popover-group">
                    <div class="cf-popover-row">
                      <input type="number" id="filter-date-from" placeholder="${_t('labelDateFrom')}" min="1" max="31" class="cf-input-styled">
                      <span style="color: var(--text-muted);">-</span>
                      <input type="number" id="filter-date-to" placeholder="${_t('labelDateTo')}" min="1" max="31" class="cf-input-styled">
                    </div>
                  </div>
                  <div class="cf-popover-group cf-radio-vertical-group" style="margin-top: 8px;">
                    <label class="cf-radio-label"><input type="radio" name="filter-date-sort" value="desc" checked> ${_t('sortNewest')}</label>
                    <label class="cf-radio-label"><input type="radio" name="filter-date-sort" value="asc"> ${_t('sortOldest')}</label>
                  </div>
                  <div class="cf-popover-actions">
                    <button id="btn-filter-date-clear" class="hub-cf-modal-btn--cancel" style="padding:4px 12px; font-size:12px;">${_t('btnClear')}</button>
                    <button id="btn-filter-date-apply" class="hub-cf-modal-btn--save" style="padding:4px 12px; font-size:12px;">${_t('btnApply')}</button>
                  </div>
                </div>
              </th>
              <th class="hub-cf-col--desc hub-cf-col-filterable">
                <div class="hub-cf-th-inner">
                  <span data-i18n="thDesc">${_t('thDesc')}</span>
                  <button class="hub-cf-filter-icon" id="btn-filter-desc" aria-label="Filter Description" title="Filter by Description">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                  </button>
                </div>
                <div class="hub-cf-filter-popover glass" id="popover-filter-desc" style="display:none; width: 220px;">
                  <div class="cf-popover-group">
                    <div class="cf-popover-row">
                      <input type="text" id="filter-desc-keyword" placeholder="${_t('placeholderKeyword')}" class="cf-input-styled">
                    </div>
                  </div>
                  <div class="cf-popover-actions">
                    <button id="btn-filter-desc-clear" class="hub-cf-modal-btn--cancel" style="padding:4px 12px; font-size:12px;">${_t('btnClear')}</button>
                    <button id="btn-filter-desc-apply" class="hub-cf-modal-btn--save" style="padding:4px 12px; font-size:12px;">${_t('btnApply')}</button>
                  </div>
                </div>
              </th>
              <th class="hub-cf-col--cat hub-cf-col-filterable">
                <div class="hub-cf-th-inner">
                  <span data-i18n="thCat">${_t('thCat')}</span>
                  <button class="hub-cf-filter-icon" id="btn-filter-cat" aria-label="Filter Category" title="Filter by Category">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 12 12 17 22 12"></polyline><polyline points="2 17 12 22 22 17"></polyline></svg>
                  </button>
                </div>
                <div class="hub-cf-filter-popover glass" id="popover-filter-cat" style="display:none; width: 240px;">
                  <div class="cf-popover-group" id="filter-cat-list" style="max-height: 200px; overflow-y: auto; padding-right: 4px;">
                  </div>
                  <div class="cf-popover-actions">
                    <button id="btn-filter-cat-clear" class="hub-cf-modal-btn--cancel" style="padding:4px 12px; font-size:12px;">${_t('btnClear')}</button>
                    <button id="btn-filter-cat-apply" class="hub-cf-modal-btn--save" style="padding:4px 12px; font-size:12px;">${_t('btnApply')}</button>
                  </div>
                </div>
              </th>
              <th class="hub-cf-col--amt hub-cf-col-filterable">
                <div class="hub-cf-th-inner">
                  <span data-i18n="thAmt">${_t('thAmt')}</span>
                  <button class="hub-cf-filter-icon" id="btn-filter-amt" aria-label="Filter Amount" title="Filter by Amount">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                  </button>
                </div>
                <div class="hub-cf-filter-popover glass" id="popover-filter-amt" style="display:none; width: 220px;">
                  <div class="cf-popover-group">
                    <div class="cf-popover-row">
                      <input type="number" id="filter-amt-min" placeholder="${_t('labelMin')} (VND)" min="0" class="cf-input-styled">
                      <span style="color: var(--text-muted);">-</span>
                      <input type="number" id="filter-amt-max" placeholder="${_t('labelMax')} (VND)" min="0" class="cf-input-styled">
                    </div>
                  </div>
                  <div class="cf-popover-group cf-radio-vertical-group" style="margin-top: 8px;">
                    <label class="cf-radio-label"><input type="radio" name="sort-amt" value="desc"> ${_t('sortHighest')}</label>
                    <label class="cf-radio-label"><input type="radio" name="sort-amt" value="asc"> ${_t('sortLowest')}</label>
                    <label class="cf-radio-label"><input type="radio" name="sort-amt" value="none" checked> ${_t('sortNone')}</label>
                  </div>
                  <div class="cf-popover-actions">
                    <button id="btn-filter-amt-clear" class="hub-cf-modal-btn--cancel" style="padding:4px 12px; font-size:12px;">${_t('btnClear')}</button>
                    <button id="btn-filter-amt-apply" class="hub-cf-modal-btn--save" style="padding:4px 12px; font-size:12px;">${_t('btnApply')}</button>
                  </div>
                </div>
              </th>
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

<!-- ═══ AI FINANCIAL ADVISOR v2 — Kế hoạch chi tiêu + Hỏi đáp ═══ -->
${_aiShellHTML()}

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
          <input type="text" id="hub-cf-amount" class="hub-cf-form-input hub-cf-amount-input"
                 placeholder="0" required inputmode="numeric" />
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
          <input type="text" id="hub-cf-debt-amount" class="hub-cf-form-input hub-cf-amount-input"
                 placeholder="${_pd_t('placeholderAmount')}" required inputmode="numeric" />
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
</div>

<!-- ═══ DEBT RECOVERY MODAL (Thu hồi nợ) ═══ -->
<div class="hub-cf-overlay" id="hub-cf-debt-recovery-overlay" role="dialog" aria-modal="true" aria-label="${_pd_t('recoveryTitle')}" style="display:none;">
  <div class="hub-cf-modal hub-cf-debt-recovery-modal glass">
    <div class="hub-cf-modal-header">
      <h3 class="hub-cf-modal-title" data-i18n="recoveryTitle">${_pd_t('recoveryTitle')}</h3>
      <button class="hub-cf-modal-close" id="hub-cf-debt-recovery-modal-close" aria-label="Close modal">✕</button>
    </div>
    <div class="hub-cf-modal-body">
      <form id="hub-cf-debt-recovery-form" autocomplete="off">
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="debt-recovery-source" data-i18n="labelRecoverySource">${_pd_t('labelRecoverySource')}</label>
          <select id="debt-recovery-source" class="hub-cf-form-input" required>
            <option value="cash" data-i18n="optionCash">${_pd_t('optionCash')}</option>
            <option value="bank" selected data-i18n="optionBank">${_pd_t('optionBank')}</option>
          </select>
        </div>
        <p class="hub-cf-form-hint" data-i18n="hintRecoveryNoIncome">${_pd_t('hintRecoveryNoIncome')}</p>
        <div class="hub-cf-form-actions">
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--cancel" id="hub-cf-debt-recovery-btn-cancel" data-i18n="btnCancel">${_pd_t('btnCancel')}</button>
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--save" id="hub-cf-debt-recovery-btn-confirm" data-i18n="btnConfirm">${_pd_t('btnConfirm')}</button>
        </div>
      </form>
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
      _removeHeatmapTooltip();
      if (_boundHeatmapPickerOutside) {
        document.removeEventListener('pointerdown', _boundHeatmapPickerOutside);
        _boundHeatmapPickerOutside = null;
      }
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
    _refreshHeatmap();
    _renderSpendingPlan();
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
    _refreshHeatmap();
    _updateDebtLanguage();
    updateDashboardTotals();
    var _hb = document.getElementById('cfd-hide-label'), _hr = document.getElementById('cfd-root');
    if (_hb && _hr) _hb.textContent = _hr.classList.contains('cfd--hidden') ? _t('cfdShow') : _t('cfdHide');
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

  /** Derived, display-only values for the dashboard (allocation %, remaining, saved rate, bars, period).
   *  Reads numbers already computed by updateDashboardTotals — never recomputes balances. */
  function _updateDashboardExtras(m) {
    function set(id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; }
    function pct1(v) { return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%'; }

    var bank = Number(m.bank) || 0, cash = Number(m.cash) || 0;
    var income = Number(m.income) || 0, expense = Number(m.expense) || 0;

    // Allocation of liquid assets (positive balances only, so the bar is always valid)
    var posBank = Math.max(bank, 0), posCash = Math.max(cash, 0), pos = posBank + posCash;
    var wb = pos > 0 ? posBank / pos * 100 : 0;
    var wc = pos > 0 ? posCash / pos * 100 : 0;
    var segB = document.getElementById('cfd-alloc-bank'), segC = document.getElementById('cfd-alloc-cash');
    if (segB) segB.style.width = wb + '%';
    if (segC) segC.style.width = wc + '%';
    set('cfd-pct-bank', pos > 0 && bank > 0 ? pct1(wb) : '');
    set('cfd-pct-cash', pos > 0 && cash > 0 ? pct1(wc) : '');

    // Remaining = Income − Expense (same totals as the cards; savings transfers & debt recovery already excluded)
    var net = income - expense;
    var netEl = document.getElementById('cfd-net');
    if (netEl) {
      netEl.textContent = (net > 0 ? '+' : '') + _formatVNFull(net);
      netEl.classList.toggle('cfd-pos', net > 0);
      netEl.classList.toggle('cfd-neg', net < 0);
    }
    var rateEl = document.getElementById('cfd-rate');
    if (rateEl) {
      if (income > 0) {
        rateEl.hidden = false;
        rateEl.textContent = _t('cfdSaved') + ' ' + pct1(net / income * 100);
        rateEl.classList.toggle('cfd-chip--neg', net < 0);
      } else {
        rateEl.hidden = true;
      }
    }
    var bi = document.getElementById('cfd-bar-inc'), be = document.getElementById('cfd-bar-exp');
    if (bi) bi.style.width = (income > 0 ? 100 : 0) + '%';
    if (be) be.style.width = (income > 0 ? Math.min(expense / income * 100, 100) : (expense > 0 ? 100 : 0)) + '%';

    // Period label follows the same window as the totals
    var label = '';
    if (_chartFilter === 'day') {
      label = _t('cfdPeriodDay');
    } else if (_chartFilter === 'year') {
      var yr = _currentMonth ? _currentMonth.year : new Date().getFullYear();
      label = _t('cfdYear') + ' ' + yr;
    } else {
      var ymx = _currentMonth || _currentYearMonth();
      label = _t('cfdMonth') + ' ' + String(ymx.month).padStart(2, '0') + '/' + ymx.year;
    }
    set('cfd-period', label ? ' · ' + label : '');
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
      _updateDashboardExtras({ bank: 0, cash: 0, income: 0, expense: 0 });
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
    // ALSO EXCLUDE: Debt recovery ("🤝 Thu nợ") — this is an asset transfer, not revenue.
    var totalIncome = 0;
    var totalExpense = 0;
    var cashIncome = 0, cashExpense = 0, bankIncome = 0, bankExpense = 0, uncIncome = 0, uncExpense = 0, savingsIncome = 0, savingsExpense = 0;
    filteredTxs.forEach(function (tx) {
      var isSavingsRelated = tx.source === 'savings' ||
        tx.category === 'tiet-kiem' ||
        tx.category === 'Tiết kiệm' ||
        tx.category === '🐷 Tiết kiệm';

      // 🔑 Debt recovery is an asset transfer, not revenue — exclude from global Income
      var isDebtRecovery = tx.category === 'thu-no' || tx.category === 'Thu nợ';

      if (tx.type === 'income') {
        // Only count as global income if NOT an internal savings transfer AND NOT debt recovery
        if (!isSavingsRelated && !isDebtRecovery) {
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

    _updateDashboardExtras({ bank: bankBalance, cash: cashBalance, income: totalIncome, expense: totalExpense });
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
    // Use Data Pipeline: filtered + sorted transactions
    var rawMonthTxs = _getMonthTransactions(_currentMonth.year, _currentMonth.month);
    var txs = typeof _getFilteredAndSortedTransactions === 'function' ? _getFilteredAndSortedTransactions() : rawMonthTxs;
    var emptyEl = _qs('#hub-cf-empty-state');
    var tableEl = _qs('#hub-cf-table-wrap');
    var tbody   = _qs('#hub-cf-tx-body');
    var countEl = _qs('#hub-cf-tx-count');

    if (!emptyEl || !tableEl || !tbody) return;

    // Case 1: Absolutely no transactions this month (Raw data is empty)
    if (rawMonthTxs.length === 0) {
      emptyEl.style.display = 'flex';
      tableEl.style.display = 'none';
      if (countEl) countEl.textContent = _t('txCount_zero');
      return;
    }

    // Case 2: Has data, but filtered result is empty
    if (txs.length === 0) {
      emptyEl.style.display = 'none';
      tableEl.style.display = ''; // MUST KEEP TABLE VISIBLE SO FILTERS REMAIN ACCESSIBLE
      if (countEl) countEl.textContent = _t('txCount_zero');

      // Inject a "No results found" row directly into the tbody
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:32px 16px; color:var(--text-muted);">Không tìm thấy giao dịch nào khớp với bộ lọc.</td></tr>';
      return;
    }

    // Case 3: Normal rendering (Has filtered data)
    emptyEl.style.display = 'none';
    tableEl.style.display = '';
    if (countEl) countEl.textContent = txs.length + ' ' + _t('txCount_other');

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

    // ── EXPENSE SECTION (Smart Budget) ──
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
        var budgetLimit = _cashFlowMeta.budgets && _cashFlowMeta.budgets[entry.id];

        // Budget edit button HTML (explicit for clarity)
        var btnHtml = '<button class="hub-cf-cat-budget-btn" data-cat-id="' + entry.id + '" title="Cài đặt ngân sách">✏️</button>';

        // Legacy mode: no budget set → pct relative to totalExpense
        if (!budgetLimit || budgetLimit <= 0) {
          var pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;

          html += '<div class="hub-cf-breakdown-item">';
          html += '<span class="hub-cf-breakdown-name">' + _escHtml(name) + btnHtml + '</span>';
          html += '<span class="hub-cf-breakdown-amt hub-cf-breakdown-amt--expense">' +
                    _formatVND(amt) + ' (' + pct + '%)' +
                  '</span>';
          html += '</div>';
          html += '<div class="hub-cf-breakdown-bar-track">';
          html += '<div class="hub-cf-breakdown-bar-fill hub-cf-breakdown-bar-fill--expense" style="width:' + Math.min(pct, 100) + '%"></div>';
          html += '</div>';
        }
        // Smart Budget mode: budgetLimit > 0
        else {
          var budgetPct = (amt / budgetLimit) * 100;
          var displayPct = Math.round(budgetPct);
          var barPct = Math.min(budgetPct, 100);

          // Determine dynamic color & bar class based on budgetPct
          var color;
          if (budgetPct <= 50) {
            color = 'var(--success, #00e676)';
          } else if (budgetPct <= 85) {
            color = 'var(--warning, #ffb300)';
          } else {
            color = 'var(--danger, #ff5252)';
          }

          // Over-budget pulse class for amount text (keep if over 100%)
          var amtClass = 'hub-cf-breakdown-amt';
          if (budgetPct > 100) {
            amtClass += ' hub-cf-budget-over';
          }

          html += '<div class="hub-cf-breakdown-item">';
          html += '<span class="hub-cf-breakdown-name">' + _escHtml(name) + btnHtml + '</span>';
          html += '<span class="' + amtClass + '" style="color:' + color + ';">' +
                    _formatVND(amt) + ' / ' + _formatVND(budgetLimit) + ' (' + displayPct + '%)' +
                  '</span>';
          html += '</div>';
          html += '<div class="hub-cf-breakdown-bar-track">';
          html += '<div class="hub-cf-breakdown-bar-fill" style="width:' + barPct + '%; background-color:' + color + ';"></div>';
          html += '</div>';
        }
      });
    }

    // ── Empty state ──
    if (!html) {
      html = '<p style="color:var(--text-muted);font-size:0.74rem;text-align:center;padding:8px 0;">' + _t('noCategoryData') + '</p>';
    }

    container.innerHTML = html;

    // ── Event delegation for budget edit buttons (bound ONCE via dataset guard) ──
    if (!container.dataset.budgetDelegationBound) {
      container.dataset.budgetDelegationBound = 'true';
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('.hub-cf-cat-budget-btn');
        if (!btn) return;
        e.stopPropagation();

        var catId = btn.getAttribute('data-cat-id');
        var currentBudget = _cashFlowMeta.budgets[catId] || 0;

        var raw = prompt('Nhập ngân sách tối đa cho tháng (VND)\n(Nhập 0 để xóa ngân sách hạng mục này):', currentBudget);
        if (raw !== null) {
          var val = parseInt(String(raw).replace(/[\s,.]/g, ''), 10);
          if (!isNaN(val) && val > 0) {
            _cashFlowMeta.budgets[catId] = val;
          } else if (val === 0) {
            delete _cashFlowMeta.budgets[catId];
          }
          if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowMeta === 'function') {
            HubDB.saveCashFlowMeta(_cashFlowMeta).catch(function (_) {});
          }
          _renderCategoryBreakdown();
        }
      });
    }
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
    // Refresh debt recovery modal if visible
    var recoveryOverlay = _qs('#hub-cf-debt-recovery-overlay');
    if (recoveryOverlay && recoveryOverlay.style.display === 'flex') {
      var cashOption = _qs('#debt-recovery-source option[value="cash"]');
      var bankOption = _qs('#debt-recovery-source option[value="bank"]');
      var hintEl = _qs('#hub-cf-debt-recovery-overlay [data-i18n="hintRecoveryNoIncome"]');
      var cancelBtn = _qs('#hub-cf-debt-recovery-btn-cancel');
      var confirmBtn = _qs('#hub-cf-debt-recovery-btn-confirm');
      var labelEl = _qs('#hub-cf-debt-recovery-overlay [data-i18n="labelRecoverySource"]');
      var titleEl = _qs('#hub-cf-debt-recovery-overlay .hub-cf-modal-title');
      if (cashOption) cashOption.textContent = _pd_t('optionCash');
      if (bankOption) bankOption.textContent = _pd_t('optionBank');
      if (hintEl) hintEl.innerHTML = _pd_t('hintRecoveryNoIncome');
      if (cancelBtn) cancelBtn.textContent = _pd_t('btnCancel');
      if (confirmBtn) confirmBtn.textContent = _pd_t('btnConfirm');
      if (labelEl) labelEl.textContent = _pd_t('labelRecoverySource');
      if (titleEl) titleEl.textContent = _pd_t('recoveryTitle');
      recoveryOverlay.setAttribute('aria-label', _pd_t('recoveryTitle'));
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

    // ── Hide balances toggle (display-only, remembered per browser) ──
    var _cfdHideBtn = _qs('#cfd-hide-btn');
    var _cfdRoot = _qs('#cfd-root');
    if (_cfdHideBtn && _cfdRoot) {
      var _cfdApplyHide = function (on) {
        _cfdRoot.classList.toggle('cfd--hidden', on);
        _cfdHideBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var lbl = document.getElementById('cfd-hide-label');
        if (lbl) lbl.textContent = on ? _t('cfdShow') : _t('cfdHide');
      };
      var _cfdStored = false;
      try { _cfdStored = localStorage.getItem('hub_cf_hide_balance') === '1'; } catch (_) {}
      _cfdApplyHide(_cfdStored);
      _cfdHideBtn.addEventListener('click', function () {
        var on = !_cfdRoot.classList.contains('cfd--hidden');
        _cfdApplyHide(on);
        try { localStorage.setItem('hub_cf_hide_balance', on ? '1' : '0'); } catch (_) {}
      });
    }

    // ── Edit buttons (Net Worth + Savings) — delegate on dashboard grid ──
    var summaryGrid = _qs('.cfd');
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
      prevBtn.addEventListener('click', function () { _shiftMonth(-1); });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () { _shiftMonth(1); });
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

    // Initialize heatmap toggle
    _initHeatmapToggle();

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

    // Escape key to close modals
    _boundKeydown = function (e) {
      if (e.key === 'Escape') {
        _closeHeatmapPicker(true);
        _closeModal();
        _closeDebtModal();
        _closeDebtHistoryModal();
        _closeDebtRecoveryModal();
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
      // Update debt recovery modal if open
      var recoveryOverlay = _qs('#hub-cf-debt-recovery-overlay');
      if (recoveryOverlay && recoveryOverlay.style.display === 'flex') {
        var recoveryTitleEl = _qs('#hub-cf-debt-recovery-overlay .hub-cf-modal-title');
        if (recoveryTitleEl) {
          recoveryTitleEl.textContent = _pd_t('recoveryTitle');
        }
        recoveryOverlay.setAttribute('aria-label', _pd_t('recoveryTitle'));
        // Update select options and hint
        var cashOption = _qs('#debt-recovery-source option[value="cash"]');
        var bankOption = _qs('#debt-recovery-source option[value="bank"]');
        var hintEl = _qs('#hub-cf-debt-recovery-overlay [data-i18n="hintRecoveryNoIncome"]');
        var cancelBtn = _qs('#hub-cf-debt-recovery-btn-cancel');
        var confirmBtn = _qs('#hub-cf-debt-recovery-btn-confirm');
        var labelEl = _qs('#hub-cf-debt-recovery-overlay [data-i18n="labelRecoverySource"]');
        if (cashOption) cashOption.textContent = _pd_t('optionCash');
        if (bankOption) bankOption.textContent = _pd_t('optionBank');
        if (hintEl) hintEl.innerHTML = _pd_t('hintRecoveryNoIncome');
        if (cancelBtn) cancelBtn.textContent = _pd_t('btnCancel');
        if (confirmBtn) confirmBtn.textContent = _pd_t('btnConfirm');
        if (labelEl) labelEl.textContent = _pd_t('labelRecoverySource');
      }
    });

    // ═══════════════════════════════════════════════════════════════
    // FILTER POPOVER TOGGLE LOGIC (Unified)
    // ═══════════════════════════════════════════════════════════════

    // Helper: Close ALL filter popovers
    function _closeAllFilterPopovers() {
      var popovers = [
        _qs('#popover-filter-date'),
        _qs('#popover-filter-desc'),
        _qs('#popover-filter-cat'),
        _qs('#popover-filter-amt')
      ];
      var buttons = [
        _qs('#btn-filter-date'),
        _qs('#btn-filter-desc'),
        _qs('#btn-filter-cat'),
        _qs('#btn-filter-amt')
      ];
      popovers.forEach(function (p) { if (p) p.style.display = 'none'; });
      buttons.forEach(function (b) { if (b) b.classList.remove('active'); });
    }

    // Helper: Toggle a specific filter popover
    function _bindFilterToggle(btnId, popoverId, onOpen) {
      var btn = _qs('#' + btnId);
      var popover = _qs('#' + popoverId);
      if (!btn || !popover) return;

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isCurrentlyOpen = popover.style.display === 'flex';
        _closeAllFilterPopovers();

        // Toggle: only open if it wasn't already open
        if (!isCurrentlyOpen) {
          if (typeof onOpen === 'function') onOpen();
          popover.style.display = 'flex';
          btn.classList.add('active');
        }
      });
    }

    // Bind all 4 filter toggles with their specific onOpen handlers
    _bindFilterToggle('btn-filter-date', 'popover-filter-date', function () {
      var dateFromInput = _qs('#filter-date-from');
      var dateToInput = _qs('#filter-date-to');
      var datePopover = _qs('#popover-filter-date');
      if (dateFromInput) dateFromInput.value = _txTableState.date.from || '';
      if (dateToInput) dateToInput.value = _txTableState.date.to || '';
      if (datePopover) {
        var sortRadio = datePopover.querySelector('input[name="filter-date-sort"][value="' + _txTableState.date.sort + '"]');
        if (sortRadio) sortRadio.checked = true;
      }
    });

    _bindFilterToggle('btn-filter-desc', 'popover-filter-desc', function () {
      var descKeywordInput = _qs('#filter-desc-keyword');
      if (descKeywordInput) descKeywordInput.value = _txTableState.description.keyword || '';
    });

    _bindFilterToggle('btn-filter-cat', 'popover-filter-cat', function () {
      _populateCategoryFilterOptions();
    });

    _bindFilterToggle('btn-filter-amt', 'popover-filter-amt', function () {
      var amtMinInput = _qs('#filter-amt-min');
      var amtMaxInput = _qs('#filter-amt-max');
      var amtPopover = _qs('#popover-filter-amt');
      if (amtMinInput) amtMinInput.value = _txTableState.amount.min || '';
      if (amtMaxInput) amtMaxInput.value = _txTableState.amount.max || '';
      if (amtPopover) {
        var sortRadio = amtPopover.querySelector('input[name="sort-amt"][value="' + (_txTableState.amount.sort || 'none') + '"]');
        if (sortRadio) sortRadio.checked = true;
      }
    });

    // Apply/Clear handlers for Date filter
    (function () {
      var datePopover = _qs('#popover-filter-date');
      var dateFromInput = _qs('#filter-date-from');
      var dateToInput = _qs('#filter-date-to');
      var dateApplyBtn = _qs('#btn-filter-date-apply');
      var dateClearBtn = _qs('#btn-filter-date-clear');

      if (dateApplyBtn) {
        dateApplyBtn.addEventListener('click', function () {
          var from = dateFromInput && dateFromInput.value ? parseInt(dateFromInput.value, 10) : null;
          var to = dateToInput && dateToInput.value ? parseInt(dateToInput.value, 10) : null;
          var sortRadio = datePopover && datePopover.querySelector('input[name="filter-date-sort"]:checked');
          var sort = sortRadio ? sortRadio.value : 'desc';

          _txTableState.date = { from: from, to: to, sort: sort };
          if (datePopover) datePopover.style.display = 'none';
          var btn = _qs('#btn-filter-date');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
      if (dateClearBtn) {
        dateClearBtn.addEventListener('click', function () {
          _txTableState.date = { from: null, to: null, sort: 'desc' };
          if (dateFromInput) dateFromInput.value = '';
          if (dateToInput) dateToInput.value = '';
          if (datePopover) {
            var defaultSortRadio = datePopover.querySelector('input[name="filter-date-sort"][value="desc"]');
            if (defaultSortRadio) defaultSortRadio.checked = true;
          }
          if (datePopover) datePopover.style.display = 'none';
          var btn = _qs('#btn-filter-date');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
    })();

    // Apply/Clear handlers for Description filter
    (function () {
      var descPopover = _qs('#popover-filter-desc');
      var descKeywordInput = _qs('#filter-desc-keyword');
      var descApplyBtn = _qs('#btn-filter-desc-apply');
      var descClearBtn = _qs('#btn-filter-desc-clear');

      if (descApplyBtn) {
        descApplyBtn.addEventListener('click', function () {
          _txTableState.description.keyword = descKeywordInput && descKeywordInput.value ? descKeywordInput.value : '';
          if (descPopover) descPopover.style.display = 'none';
          var btn = _qs('#btn-filter-desc');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
      if (descClearBtn) {
        descClearBtn.addEventListener('click', function () {
          _txTableState.description.keyword = '';
          if (descKeywordInput) descKeywordInput.value = '';
          if (descPopover) descPopover.style.display = 'none';
          var btn = _qs('#btn-filter-desc');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
    })();

    // Apply/Clear handlers for Category filter
    (function () {
      var catPopover = _qs('#popover-filter-cat');
      var catApplyBtn = _qs('#btn-filter-cat-apply');
      var catClearBtn = _qs('#btn-filter-cat-clear');

      if (catApplyBtn) {
        catApplyBtn.addEventListener('click', function () {
          var checkboxes = catPopover && catPopover.querySelectorAll('input[type="checkbox"]:checked');
          var selected = [];
          if (checkboxes) {
            checkboxes.forEach(function (cb) { selected.push(cb.value); });
          }
          _txTableState.category.selected = selected;
          if (catPopover) catPopover.style.display = 'none';
          var btn = _qs('#btn-filter-cat');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
      if (catClearBtn) {
        catClearBtn.addEventListener('click', function () {
          _txTableState.category.selected = [];
          if (catPopover) {
            var checkboxes = catPopover.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(function (cb) { cb.checked = false; });
          }
          if (catPopover) catPopover.style.display = 'none';
          var btn = _qs('#btn-filter-cat');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
    })();

    // Apply/Clear handlers for Amount filter
    (function () {
      var amtPopover = _qs('#popover-filter-amt');
      var amtMinInput = _qs('#filter-amt-min');
      var amtMaxInput = _qs('#filter-amt-max');
      var amtApplyBtn = _qs('#btn-filter-amt-apply');
      var amtClearBtn = _qs('#btn-filter-amt-clear');

      if (amtApplyBtn) {
        amtApplyBtn.addEventListener('click', function () {
          var min = amtMinInput && amtMinInput.value ? parseInt(amtMinInput.value, 10) : null;
          var max = amtMaxInput && amtMaxInput.value ? parseInt(amtMaxInput.value, 10) : null;
          var sortRadio = amtPopover && amtPopover.querySelector('input[name="sort-amt"]:checked');
          var sort = sortRadio ? sortRadio.value : null;

          _txTableState.amount = { min: min, max: max, sort: sort };
          if (amtPopover) amtPopover.style.display = 'none';
          var btn = _qs('#btn-filter-amt');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
      if (amtClearBtn) {
        amtClearBtn.addEventListener('click', function () {
          _txTableState.amount = { min: null, max: null, sort: null };
          if (amtMinInput) amtMinInput.value = '';
          if (amtMaxInput) amtMaxInput.value = '';
          if (amtPopover) {
            var defaultSortRadio = amtPopover.querySelector('input[name="sort-amt"][value="none"]');
            if (defaultSortRadio) defaultSortRadio.checked = true;
          }
          if (amtPopover) amtPopover.style.display = 'none';
          var btn = _qs('#btn-filter-amt');
          if (btn) btn.classList.remove('active');
          _refreshTransactions();
        });
      }
    })();

    // Close all popovers on outside click
    document.addEventListener('click', function (e) {
      var popovers = [
        _qs('#popover-filter-date'),
        _qs('#popover-filter-desc'),
        _qs('#popover-filter-cat'),
        _qs('#popover-filter-amt')
      ];
      var buttons = [
        _qs('#btn-filter-date'),
        _qs('#btn-filter-desc'),
        _qs('#btn-filter-cat'),
        _qs('#btn-filter-amt')
      ];
      popovers.forEach(function (p, i) {
        if (p && p.style.display === 'flex' && !p.contains(e.target) && e.target !== buttons[i]) {
          p.style.display = 'none';
          if (buttons[i]) buttons[i].classList.remove('active');
        }
      });
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

    // Shorthand logic for amount input
    function applyShorthandLogic(inputId) {
      var input = _qs(inputId);
      if (!input) return;
      input.addEventListener('input', function(e) {
        var val = this.value.toLowerCase();
        if (val.endsWith('k')) {
          var num = parseFloat(val.replace('k', ''));
          if (!isNaN(num)) this.value = num * 1000;
        } else if (val.endsWith('m')) {
          var num = parseFloat(val.replace('m', ''));
          if (!isNaN(num)) this.value = num * 1000000;
        } else {
          // Strip out any non-numeric characters EXCEPT dot (for decimals before shorthand)
          this.value = this.value.replace(/[^0-9.]/g, '');
        }
      });
    }
    applyShorthandLogic('#hub-cf-amount');
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

    // --- Restore Sticky Category ---
    try {
      var lastCat = localStorage.getItem('hub_cf_last_category_' + _activeTab);
      if (lastCat && !window.isEditingTransactionMode) { // Ensure we don't override edit mode
        var exists = Array.from(select.options).some(function(opt) { return opt.value === lastCat; });
        if (exists) select.value = lastCat;
      }
    } catch(e) {}
  }

  /** Populate category checkbox list for filter popover (uses ALL categories, not tab-dependent) */
  function _populateCategoryFilterOptions() {
    const container = _qs('#filter-cat-list');
    if (!container) return;

    // Combine income and expense categories for filtering
    var allCats = INCOME_CATEGORIES.concat(EXPENSE_CATEGORIES);
    var html = '';
    allCats.forEach(function (cat) {
      var isChecked = _txTableState.category.selected.indexOf(cat.id) !== -1;
      html += '<label class="cf-category-item">';
      html += '  <input type="checkbox" value="' + cat.id + '" class="cf-filter-cat-checkbox"' + (isChecked ? ' checked' : '') + ' />';
      html += '  <span class="cf-category-label">' + _escHtml(cat.name) + '</span>';
      html += '</label>';
    });
    container.innerHTML = html;
  }

  /** Close all filter popovers */
  function _closeAllFilterPopovers() {
    var popovers = _container ? _container.querySelectorAll('.hub-cf-filter-popover') : [];
    popovers.forEach(function (p) { p.style.display = 'none'; });
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

    window.isEditingTransactionMode = false; // Flag for populateCategories

    const dateInput = _qs('#hub-cf-date');
    if (dateInput) dateInput.value = _todayISO();

    // Restore Sticky Source
    try {
      var lastSource = localStorage.getItem('hub_cf_last_source');
      var sourceSelect = _qs('#hub-cf-source');
      if (lastSource && sourceSelect) {
        sourceSelect.value = lastSource;
      }
    } catch(e) {}

    overlay.style.display = 'flex';
    setTimeout(function () {
      const amountInput = _qs('#hub-cf-amount');
      if (amountInput) amountInput.focus();
    }, 150);

    // Enable keyboard navigation for transaction form
    _enableKeyboardNavigation('#hub-cf-form');
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

    // PROTECT EDIT MODE: Prevent sticky defaults from overriding actual transaction data
    window.isEditingTransactionMode = true;

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

    // Enable keyboard navigation for transaction form
    _enableKeyboardNavigation('#hub-cf-form');
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

    // --- Save Sticky Defaults ---
    try {
      localStorage.setItem('hub_cf_last_source', source);
      localStorage.setItem('hub_cf_last_category_' + _activeTab, category);
    } catch(e) {}

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

    // Confirm
    var confirmMsg = _pd_t('confirmMarkPaid')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount));
    if (!confirm(confirmMsg)) return;

    // Store debtId for the recovery modal to use
    window.currentDebtRecoveryId = debtId;

    // Show the custom Debt Recovery modal
    var overlay = _qs('#hub-cf-debt-recovery-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      // Focus the select dropdown
      setTimeout(function () {
        var selectEl = _qs('#debt-recovery-source');
        if (selectEl) selectEl.focus();
      }, 150);
    }
  }

  function _executeDebtRecovery(targetSource) {
    var debtId = window.currentDebtRecoveryId;
    if (!debtId) return;

    var debt = _data.debts.find(function (d) { return d.id === debtId; });
    if (!debt) return;

    debt.status = 'paid';
    debt.paidAt = Date.now();
    _debouncedPersist();
    _refreshDebtSummary();
    _refreshDebtLedger();

    _showToast(_pd_t('toastDebtPaid')
      .replace('{name}', debt.debtorName)
      .replace('{amount}', _formatVND(debt.amount)));

    // Auto-generate recovery transaction with category "🤝 Thu nợ"
    // This is an asset transfer, NOT revenue — excluded from global Income
    var tx = {
      id: _uid(),
      type: 'income',
      amount: Number(debt.amount),
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      day: new Date().getDate(),
      desc: 'Thu nợ: ' + debt.debtorName + (debt.note ? ' - ' + debt.note : ''),
      category: 'thu-no', // "🤝 Thu nợ" — excluded from global Income
      source: targetSource,
      createdAt: Date.now()
    };

    _data.transactions.push(tx);
    _debouncedPersist();
    _renderAllViews(); // Updates dashboard totals, ledger, chart
    _updateChart();

    var walletLabel = targetSource === 'cash' ? _pd_t('optionCash') : _pd_t('optionBank');
    _showToast(_pd_t('toastRecoveryDone')
      .replace('{amount}', _formatVND(debt.amount))
      .replace('{wallet}', walletLabel));

    // Clear the temp variable
    window.currentDebtRecoveryId = null;
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

      // ── 2. Đọc từng sheet → bộ đọc theo TÊN CỘT (hiểu cả file mới và file xuất kiểu cũ) ──
      var sheetsData = wb.SheetNames.map(function (name) {
        return { name: name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) };
      });
      var parsed = _parseImportSheets(sheetsData, {
        defaultYear: _currentMonth ? _currentMonth.year : new Date().getFullYear(),
        uid: _uid,
        now: Date.now()
      });
      var importedTxs = parsed.transactions;
      var skippedRows = parsed.skippedRows;
      var skippedSheets = parsed.skippedSheets;

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

  // ==== XLSX-CORE-BEGIN ====================================================
  //   XLSX WRITER (không phụ thuộc thư viện) + BỘ DỰNG BÁO CÁO CASHFLOW
  //   ---------------------------------------------------------------------
  //   Vì sao tự viết? SheetJS bản miễn phí chỉ ghi được dữ liệu thô, không có
  //   màu sắc / bảng Excel / định dạng có điều kiện / biểu đồ. Phần này tự dựng
  //   file .xlsx (OOXML + zip) nên chạy offline, không cần CDN.
  //   Mọi hàm ở đây là hàm thuần (không đụng DOM) để dễ kiểm thử.
  // ==========================================================================

  // ── ZIP (store, không nén) ──
  var _xlCrcTable = null;
  function _xlCrc32(bytes) {
    if (!_xlCrcTable) {
      _xlCrcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        _xlCrcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = _xlCrcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function _xlZip(entries) {
    var enc = new TextEncoder();
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var parts = [], central = [], offset = 0, cdSize = 0;

    entries.forEach(function (e) {
      var name = enc.encode(e.name);
      var data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      var crc = _xlCrc32(data);

      var lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
      cdSize += ch.length;
    });

    var eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);

    var all = parts.concat(central, [eocd]);
    var total = 0; all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ── XML helpers ──
  function _xlEsc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _xlColName(n) {              // 1 → A, 27 → AA
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function _xlAddr(r, c) { return _xlColName(c) + r; }
  function _xlRange(r1, c1, r2, c2) { return _xlAddr(r1, c1) + ':' + _xlAddr(r2, c2); }
  function _xlSerial(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569; }   // ngày Excel
  function _xlFromSerial(n) {
    var d = new Date(Math.round((n - 25569) * 86400000));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  // ── Style book: dedupe font/fill/border/numFmt/xf ──
  function _xlStyleBook() {
    var fonts = [], fills = [], borders = [], nfs = [], xfs = [], dxfs = [];
    var fm = {}, flm = {}, bm = {}, nm = {}, xm = {}, dm = {};
    function put(arr, map, key, xml) { if (map[key] === undefined) { map[key] = arr.length; arr.push(xml); } return map[key]; }
    function rgb(c) { return 'FF' + String(c).replace('#', '').toUpperCase(); }

    function fontXml(f) {
      f = f || {};
      return '<font>' + (f.b ? '<b/>' : '') + (f.i ? '<i/>' : '') + (f.u ? '<u/>' : '') +
        '<sz val="' + (f.sz || 10) + '"/><color rgb="' + rgb(f.color || '1F2937') + '"/>' +
        '<name val="' + (f.name || 'Arial') + '"/><family val="2"/></font>';
    }
    function fillXml(c) {
      return '<fill><patternFill patternType="solid"><fgColor rgb="' + rgb(c) + '"/><bgColor indexed="64"/></patternFill></fill>';
    }
    function borderXml(b) {
      function side(tag, s) { return s ? '<' + tag + ' style="' + s[0] + '"><color rgb="' + rgb(s[1]) + '"/></' + tag + '>' : '<' + tag + '/>'; }
      b = b || {};
      return '<border>' + side('left', b.l) + side('right', b.r) + side('top', b.t) + side('bottom', b.b) + '<diagonal/></border>';
    }

    // vị trí 0 bắt buộc là mặc định
    put(fonts, fm, JSON.stringify({}), fontXml({}));
    put(fills, flm, 'none', '<fill><patternFill patternType="none"/></fill>');
    put(fills, flm, 'gray125', '<fill><patternFill patternType="gray125"/></fill>');
    put(borders, bm, '{}', borderXml({}));
    xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'); xm['{}'] = 0;

    return {
      /** Đăng ký 1 kiểu ô, trả về chỉ số xf */
      xf: function (o) {
        o = o || {};
        var key = JSON.stringify(o);
        if (xm[key] !== undefined) return xm[key];
        var fontId = put(fonts, fm, JSON.stringify(o.font || {}), fontXml(o.font));
        var fillId = o.fill ? put(fills, flm, 'f' + o.fill, fillXml(o.fill)) : 0;
        var borderId = o.border ? put(borders, bm, JSON.stringify(o.border), borderXml(o.border)) : 0;
        var numFmtId = 0;
        if (o.fmt) {
          if (nm[o.fmt] === undefined) { nm[o.fmt] = 164 + nfs.length; nfs.push({ id: 164 + nfs.length, code: o.fmt }); }
          numFmtId = nm[o.fmt];
        }
        var al = o.al ? '<alignment' +
          (o.al.h ? ' horizontal="' + o.al.h + '"' : '') + (o.al.v ? ' vertical="' + o.al.v + '"' : '') +
          (o.al.wrap ? ' wrapText="1"' : '') + (o.al.indent ? ' indent="' + o.al.indent + '"' : '') + '/>' : '';
        var xml = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId +
          '" xfId="0"' + (numFmtId ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' + (fillId ? ' applyFill="1"' : '') +
          (borderId ? ' applyBorder="1"' : '') + (al ? ' applyAlignment="1">' + al + '</xf>' : '/>');
        xfs.push(xml);
        xm[key] = xfs.length - 1;
        return xm[key];
      },
      /** Kiểu cho định dạng có điều kiện (dxf) */
      dxf: function (o) {
        var key = JSON.stringify(o);
        if (dm[key] !== undefined) return dm[key];
        var xml = '<dxf>' +
          (o.font ? '<font>' + (o.font.b ? '<b/>' : '') + (o.font.i ? '<i/>' : '') + (o.font.color ? '<color rgb="' + rgb(o.font.color) + '"/>' : '') + '</font>' : '') +
          (o.fill ? '<fill><patternFill patternType="solid"><fgColor rgb="' + rgb(o.fill) + '"/><bgColor rgb="' + rgb(o.fill) + '"/></patternFill></fill>' : '') +
          '</dxf>';
        dxfs.push(xml);
        dm[key] = dxfs.length - 1;
        return dm[key];
      },
      toXml: function () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          (nfs.length ? '<numFmts count="' + nfs.length + '">' + nfs.map(function (n) { return '<numFmt numFmtId="' + n.id + '" formatCode="' + _xlEsc(n.code) + '"/>'; }).join('') + '</numFmts>' : '') +
          '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>' +
          '<fills count="' + fills.length + '">' + fills.join('') + '</fills>' +
          '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
          '<dxfs count="' + dxfs.length + '">' + dxfs.join('') + '</dxfs>' +
          '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
          '</styleSheet>';
      }
    };
  }

  // ── Shared strings ──
  function _xlSharedStrings() {
    var list = [], map = {}, count = 0;
    return {
      idx: function (s) {
        s = String(s); count++;
        if (map[s] === undefined) { map[s] = list.length; list.push(s); }
        return map[s];
      },
      toXml: function () {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + count + '" uniqueCount="' + list.length + '">' +
          list.map(function (s) {
            var sp = /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : '';
            return '<si><t' + sp + '>' + _xlEsc(s) + '</t></si>';
          }).join('') + '</sst>';
      }
    };
  }

  // ── Sheet model ──
  function _xlSheet(name) {
    return {
      name: name, rows: {}, merges: [], cols: [], rowHt: {}, cf: [], dv: [], tables: [], links: [], charts: [],
      freeze: null, breaks: [], grid: true, tab: null, landscape: false, fit: false, titles: null, selected: false, zoom: 100,
      /** v: number | string | {f: 'công thức', v: kết quả đã tính} | null */
      put: function (r, c, v, s) {
        (this.rows[r] = this.rows[r] || {})[c] = { v: v, s: s || 0 };
      },
      /** Tô style cho cả vùng (kể cả vùng gộp) để viền/màu nền hiện đủ */
      fillRange: function (r1, c1, r2, c2, s) {
        for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) {
          if (!(this.rows[r] && this.rows[r][c])) this.put(r, c, null, s);
        }
      },
      merge: function (r1, c1, r2, c2) { this.merges.push(_xlRange(r1, c1, r2, c2)); },
      width: function (c, w) { this.cols.push({ min: c, max: c, w: w }); },
      height: function (r, h) { this.rowHt[r] = h; }
    };
  }

  function _xlSheetXml(ws, sst, relIds) {
    var rowNums = Object.keys(ws.rows).map(Number).sort(function (a, b) { return a - b; });
    var maxR = 1, maxC = 1;
    var sd = '';
    rowNums.forEach(function (r) {
      var cols = Object.keys(ws.rows[r]).map(Number).sort(function (a, b) { return a - b; });
      if (r > maxR) maxR = r;
      var ht = ws.rowHt[r] ? ' ht="' + ws.rowHt[r] + '" customHeight="1"' : '';
      sd += '<row r="' + r + '"' + ht + '>';
      cols.forEach(function (c) {
        if (c > maxC) maxC = c;
        var cell = ws.rows[r][c], v = cell.v, a = _xlAddr(r, c), s = cell.s ? ' s="' + cell.s + '"' : '';
        if (v === null || v === undefined || v === '') sd += '<c r="' + a + '"' + s + '/>';
        else if (typeof v === 'number') sd += '<c r="' + a + '"' + s + '><v>' + (isFinite(v) ? v : 0) + '</v></c>';
        else if (typeof v === 'string') sd += '<c r="' + a + '"' + s + ' t="s"><v>' + sst.idx(v) + '</v></c>';
        else if (v && v.f !== undefined) {
          var isStr = typeof v.v === 'string';
          sd += '<c r="' + a + '"' + s + (isStr ? ' t="str"' : '') + '><f>' + _xlEsc(v.f) + '</f>' +
            (v.v === undefined || v.v === null ? '' : '<v>' + (isStr ? _xlEsc(v.v) : (isFinite(v.v) ? v.v : 0)) + '</v>') + '</c>';
        }
      });
      sd += '</row>';
    });
    ws.cols.forEach(function (c) { if (c.max > maxC) maxC = c.max; });

    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    x += '<sheetPr>' + (ws.tab ? '<tabColor rgb="FF' + ws.tab + '"/>' : '') + (ws.fit ? '<pageSetUpPr fitToPage="1"/>' : '') + '</sheetPr>';
    x += '<dimension ref="A1:' + _xlAddr(maxR, maxC) + '"/>';
    x += '<sheetViews><sheetView workbookViewId="0"' + (ws.grid ? '' : ' showGridLines="0"') + (ws.selected ? ' tabSelected="1"' : '') +
      (ws.zoom !== 100 ? ' zoomScale="' + ws.zoom + '" zoomScaleNormal="' + ws.zoom + '"' : '') + '>';
    if (ws.freeze) {
      var fr = ws.freeze;   // {row, col}  → số dòng/cột cố định
      var tl = _xlAddr(fr.row + 1, (fr.col || 0) + 1);
      x += '<pane ' + (fr.col ? 'xSplit="' + fr.col + '" ' : '') + 'ySplit="' + fr.row + '" topLeftCell="' + tl + '" activePane="' + (fr.col ? 'bottomRight' : 'bottomLeft') + '" state="frozen"/>' +
        '<selection pane="' + (fr.col ? 'bottomRight' : 'bottomLeft') + '" activeCell="' + tl + '" sqref="' + tl + '"/>';
    }
    x += '</sheetView></sheetViews>';
    x += '<sheetFormatPr defaultRowHeight="15"/>';
    if (ws.cols.length) {
      x += '<cols>' + ws.cols.slice().sort(function (a, b) { return a.min - b.min; }).map(function (c) {
        return '<col min="' + c.min + '" max="' + c.max + '" width="' + c.w + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    x += '<sheetData>' + sd + '</sheetData>';
    if (ws.merges.length) x += '<mergeCells count="' + ws.merges.length + '">' + ws.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>';

    var prio = 1;
    ws.cf.forEach(function (g) {
      x += '<conditionalFormatting sqref="' + g.ref + '">';
      g.rules.forEach(function (r) {
        if (r.type === 'dataBar') {
          x += '<cfRule type="dataBar" priority="' + (prio++) + '"><dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="FF' + r.color + '"/></dataBar></cfRule>';
        } else if (r.type === 'expression') {
          x += '<cfRule type="expression" dxfId="' + r.dxf + '" priority="' + (prio++) + '"><formula>' + _xlEsc(r.formula) + '</formula></cfRule>';
        }
      });
      x += '</conditionalFormatting>';
    });

    if (ws.dv.length) {
      x += '<dataValidations count="' + ws.dv.length + '">' + ws.dv.map(function (d) {
        return '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"' +
          (d.title ? ' errorTitle="' + _xlEsc(d.title) + '"' : '') + (d.error ? ' error="' + _xlEsc(d.error) + '"' : '') +
          (d.prompt ? ' promptTitle="' + _xlEsc(d.promptTitle || '') + '" prompt="' + _xlEsc(d.prompt) + '"' : '') +
          ' sqref="' + d.ref + '"><formula1>' + _xlEsc(d.list) + '</formula1></dataValidation>';
      }).join('') + '</dataValidations>';
    }
    if (ws.links.length) {
      x += '<hyperlinks>' + ws.links.map(function (l) {
        return '<hyperlink ref="' + l.ref + '" location="' + _xlEsc(l.loc) + '" display="' + _xlEsc(l.text) + '"/>';
      }).join('') + '</hyperlinks>';
    }
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    x += '<pageSetup paperSize="9" orientation="' + (ws.landscape ? 'landscape' : 'portrait') + '"' + (ws.fit ? ' fitToWidth="1" fitToHeight="0"' : '') + '/>';
    x += '<headerFooter><oddFooter>&amp;L&amp;8CashFlow&amp;C&amp;8&amp;A&amp;R&amp;8Trang &amp;P / &amp;N</oddFooter></headerFooter>';
    if (ws.breaks && ws.breaks.length) x += '<rowBreaks count="' + ws.breaks.length + '" manualBreakCount="' + ws.breaks.length + '">' + ws.breaks.map(function (b) { return '<brk id="' + b + '" max="16383" man="1"/>'; }).join('') + '</rowBreaks>';
    if (relIds.drawing) x += '<drawing r:id="' + relIds.drawing + '"/>';
    if (ws.tables.length) x += '<tableParts count="' + ws.tables.length + '">' + relIds.tables.map(function (id) { return '<tablePart r:id="' + id + '"/>'; }).join('') + '</tableParts>';
    x += '</worksheet>';
    return x;
  }

  // ── Biểu đồ cột / thanh (OOXML chart) ──
  function _xlChartXml(spec) {
    function txPr(sz, color, bold) {
      return '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '" b="' + (bold ? 1 : 0) + '"><a:solidFill><a:srgbClr val="' + color +
        '"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="vi-VN"/></a:p></c:txPr>';
    }
    function numCache(arr, fmt) {
      return '<c:numCache><c:formatCode>' + _xlEsc(fmt || 'General') + '</c:formatCode><c:ptCount val="' + arr.length + '"/>' +
        arr.map(function (v, i) { return '<c:pt idx="' + i + '"><c:v>' + v + '</c:v></c:pt>'; }).join('') + '</c:numCache>';
    }
    function strCache(arr) {
      return '<c:strCache><c:ptCount val="' + arr.length + '"/>' +
        arr.map(function (v, i) { return '<c:pt idx="' + i + '"><c:v>' + _xlEsc(v) + '</c:v></c:pt>'; }).join('') + '</c:strCache>';
    }
    var horizontal = spec.dir === 'bar';
    var grid = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E9F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';

    var sers = spec.series.map(function (s, i) {
      var dl = spec.labels
        ? '<c:dLbls><c:numFmt formatCode="' + _xlEsc(spec.labelFmt || '#,##0') + '" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
          txPr(800, '5F6B7A', false) + '<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/>' +
          '<c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>'
        : '';
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/>' +
        '<c:tx><c:strRef><c:f>' + _xlEsc(s.nameRef) + '</c:f>' + strCache([s.name]) + '</c:strRef></c:tx>' +
        '<c:spPr><a:solidFill><a:srgbClr val="' + s.color + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>' + dl +
        '<c:cat>' + (spec.catNum
          ? '<c:numRef><c:f>' + _xlEsc(spec.catRef) + '</c:f>' + numCache(spec.cats, spec.catFmt) + '</c:numRef>'
          : '<c:strRef><c:f>' + _xlEsc(spec.catRef) + '</c:f>' + strCache(spec.cats) + '</c:strRef>') + '</c:cat>' +
        '<c:val><c:numRef><c:f>' + _xlEsc(s.valRef) + '</c:f>' + numCache(s.vals, '#,##0') + '</c:numRef></c:val></c:ser>';
    }).join('');

    var catAx = '<c:catAx><c:axId val="500001"/><c:scaling><c:orientation val="' + (horizontal ? 'maxMin' : 'minMax') + '"/></c:scaling><c:delete val="0"/>' +
      '<c:axPos val="' + (horizontal ? 'l' : 'b') + '"/>' +
      (spec.catAxFmt ? '<c:numFmt formatCode="' + _xlEsc(spec.catAxFmt) + '" sourceLinked="0"/>' : '<c:numFmt formatCode="General" sourceLinked="1"/>') +
      '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
      '<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="C9D0DA"/></a:solidFill></a:ln></c:spPr>' + txPr(900, '5F6B7A', false) +
      '<c:crossAx val="500002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>';
    var valAx = '<c:valAx><c:axId val="500002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="' + (horizontal ? 1 : 0) + '"/>' +
      '<c:axPos val="' + (horizontal ? 'b' : 'l') + '"/>' + (horizontal ? '' : grid) +
      '<c:numFmt formatCode="' + _xlEsc(spec.valFmt || '#,##0') + '" sourceLinked="0"/>' +
      '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
      '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>' + txPr(900, '5F6B7A', false) +
      '<c:crossAx val="500001"/><c:crosses val="' + (horizontal ? 'max' : 'autoZero') + '"/><c:crossBetween val="between"/></c:valAx>';

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:roundedCorners val="0"/><c:chart>' +
      '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr><a:r><a:rPr lang="vi-VN" sz="1100" b="1"><a:solidFill><a:srgbClr val="1F2A44"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>' +
      _xlEsc(spec.title) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>' +
      '<c:plotArea><c:layout/><c:barChart><c:barDir val="' + (horizontal ? 'bar' : 'col') + '"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + sers +
      '<c:gapWidth val="' + (spec.gap || 60) + '"/><c:axId val="500001"/><c:axId val="500002"/></c:barChart>' + catAx + valAx + '</c:plotArea>' +
      (spec.legend ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/>' + txPr(900, '5F6B7A', false) + '</c:legend>' : '') +
      '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
      '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9DEE5"/></a:solidFill></a:ln></c:spPr>' +
      '</c:chartSpace>';
  }

  // ── Đóng gói thành file .xlsx ──
  function _xlPackage(sheets, sb, sst, names, meta) {
    var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var files = [], overrides = [], tableN = 0, chartN = 0, drawN = 0;
    function relXml(list) {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        list.map(function (r) { return '<Relationship Id="' + r.id + '" Type="' + NS_R + '/' + r.type + '" Target="' + r.target + '"/>'; }).join('') + '</Relationships>';
    }

    sheets.forEach(function (ws, i) {
      var n = i + 1, rels = [], ids = { tables: [] }, rid = 1;

      if (ws.charts.length) {
        drawN++;
        ids.drawing = 'rId' + rid;
        rels.push({ id: 'rId' + rid++, type: 'drawing', target: '../drawings/drawing' + drawN + '.xml' });
        var drels = [], dx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">';
        ws.charts.forEach(function (ch, k) {
          chartN++;
          drels.push({ id: 'rId' + (k + 1), type: 'chart', target: '../charts/chart' + chartN + '.xml' });
          files.push({ name: 'xl/charts/chart' + chartN + '.xml', data: ch.xml });
          overrides.push(['/xl/charts/chart' + chartN + '.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml']);
          dx += '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>' + ch.from.c + '</xdr:col><xdr:colOff>' + (ch.from.dx || 0) + '</xdr:colOff><xdr:row>' + ch.from.r +
            '</xdr:row><xdr:rowOff>' + (ch.from.dy || 0) + '</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + ch.to.c + '</xdr:col><xdr:colOff>' + (ch.to.dx || 0) +
            '</xdr:colOff><xdr:row>' + ch.to.r + '</xdr:row><xdr:rowOff>' + (ch.to.dy || 0) + '</xdr:rowOff></xdr:to>' +
            '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (k + 2) + '" name="Biểu đồ ' + (k + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
            '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
            '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="' + NS_R + '" r:id="rId' + (k + 1) + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
        });
        dx += '</xdr:wsDr>';
        files.push({ name: 'xl/drawings/drawing' + drawN + '.xml', data: dx });
        files.push({ name: 'xl/drawings/_rels/drawing' + drawN + '.xml.rels', data: relXml(drels) });
        overrides.push(['/xl/drawings/drawing' + drawN + '.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml']);
      }

      ws.tables.forEach(function (t) {
        tableN++;
        ids.tables.push('rId' + rid);
        rels.push({ id: 'rId' + rid++, type: 'table', target: '../tables/table' + tableN + '.xml' });
        files.push({
          name: 'xl/tables/table' + tableN + '.xml',
          data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="' + tableN +
            '" name="' + t.name + '" displayName="' + t.name + '" ref="' + t.ref + '" totalsRowShown="0"><autoFilter ref="' + t.ref + '"/>' +
            '<tableColumns count="' + t.cols.length + '">' + t.cols.map(function (c, k) { return '<tableColumn id="' + (k + 1) + '" name="' + _xlEsc(c) + '"/>'; }).join('') +
            '</tableColumns><tableStyleInfo showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>'
        });
        overrides.push(['/xl/tables/table' + tableN + '.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml']);
      });

      files.push({ name: 'xl/worksheets/sheet' + n + '.xml', data: _xlSheetXml(ws, sst, ids) });
      if (rels.length) files.push({ name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', data: relXml(rels) });
      overrides.push(['/xl/worksheets/sheet' + n + '.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
    });

    var wbRels = sheets.map(function (ws, i) { return { id: 'rId' + (i + 1), type: 'worksheet', target: 'worksheets/sheet' + (i + 1) + '.xml' }; });
    wbRels.push({ id: 'rId' + (sheets.length + 1), type: 'styles', target: 'styles.xml' });
    wbRels.push({ id: 'rId' + (sheets.length + 2), type: 'sharedStrings', target: 'sharedStrings.xml' });

    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_R + '">' +
      '<workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews><sheets>' +
      sheets.map(function (ws, i) { return '<sheet name="' + _xlEsc(ws.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
      (names.length ? '<definedNames>' + names.map(function (nm) {
        return '<definedName name="' + nm.name + '"' + (nm.sheet !== undefined ? ' localSheetId="' + nm.sheet + '"' : '') + '>' + _xlEsc(nm.ref) + '</definedName>';
      }).join('') + '</definedNames>' : '') +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';

    var iso = (meta.created || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
    var all = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        overrides.map(function (o) { return '<Override PartName="' + o[0] + '" ContentType="' + o[1] + '"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="' + NS_R + '/extended-properties" Target="docProps/app.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + _xlEsc(meta.title || 'CashFlow') + '</dc:title><dc:creator>CashFlow</dc:creator>' +
        '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>' },
      { name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CashFlow</Application></Properties>' },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: relXml(wbRels) }
    ].concat(files);
    all.push({ name: 'xl/styles.xml', data: sb.toXml() });
    all.push({ name: 'xl/sharedStrings.xml', data: sst.toXml() });   // phải ghi sau cùng: các sheet đã nạp chuỗi xong
    return _xlZip(all);
  }

  // ══════════════════════════════════════════════════════════════
  //   BỘ DỰNG BÁO CÁO CASHFLOW
  //   snap = {
  //     rows:  [{y,m,d,type:'income'|'expense',cat,desc,src,amount,rep}],
  //     debts: [{name,amount,borrowed:{y,m,d}|null,due:{y,m,d}|null,paid,note}],
  //     expenseCats:[nhãn], incomeCats:[nhãn], allCats:[{type,label}],
  //     budgets:{nhãn: số tiền/tháng}, balances:{...},
  //     viewYear, viewMonth, exportedAt: Date
  //   }
  // ══════════════════════════════════════════════════════════════
  function _buildCashflowXlsx(snap) {
    var sb = _xlStyleBook(), sst = _xlSharedStrings();
    var C = { navy: '1F2A44', ink: '1F2937', muted: '6B7686', line: 'D9DEE5', bg: 'F4F6F9', green: '12805C', greenL: 'E3F4EC', red: 'C0392B', redL: 'FBE9E7',
      amber: 'B7791F', amberL: 'FFF4D6', blue: '0000FF', input: 'FFF8DC', white: 'FFFFFF', teal: '0E7C86' };
    var F_VND = '#,##0" ₫";[Red]-#,##0" ₫";"–"', F_NUM = '#,##0;[Red]-#,##0;"–"', F_PCT = '0.0%;[Red]-0.0%;"–"';
    var F_DATE = 'dd/mm/yyyy', F_MONTH = '"Tháng "0', F_INT = '#,##0;-#,##0;"–"';
    var LAST = 10000, FIRST = 5;                                   // vùng dữ liệu của sheet Giao dịch
    var SRC = ['Tiền mặt', 'Chuyển khoản', 'Tiết kiệm', 'Chưa phân loại'];

    var exp = snap.exportedAt || new Date();
    var todaySerial = _xlSerial(exp.getFullYear(), exp.getMonth() + 1, exp.getDate());
    var VY = snap.viewYear || exp.getFullYear(), VM = snap.viewMonth || (exp.getMonth() + 1);

    // ── dữ liệu đã chuẩn hóa ──
    var data = (snap.rows || []).map(function (r, i) {
      return { s: _xlSerial(r.y, r.m, r.d), type: r.type === 'income' ? 'Thu nhập' : 'Chi phí', cat: r.cat, desc: r.desc || '', src: r.src,
        amount: Math.abs(Number(r.amount) || 0), rep: !!r.rep, ord: i };
    });
    data.sort(function (a, b) { return (b.s - a.s) || (a.ord - b.ord); });
    var N = data.length;

    function calc(type, rep, cat, lo, hi, src) {
      var sum = 0, n = 0;
      data.forEach(function (d) {
        if (d.type !== type) return;
        if (rep && !d.rep) return;
        if (cat !== null && cat !== undefined && d.cat !== cat) return;
        if (src !== null && src !== undefined && d.src !== src) return;
        if (d.s < lo || d.s > hi) return;
        sum += d.amount; n++;
      });
      return { sum: sum, n: n };
    }

    // ── tạo style dùng chung ──
    var thin = ['thin', C.line];
    var X = {
      title: sb.xf({ font: { b: 1, sz: 20, color: C.white }, fill: C.navy, al: { h: 'left', v: 'center', indent: 1 } }),
      sub: sb.xf({ font: { sz: 10, color: 'C8D0E0' }, fill: C.navy, al: { h: 'left', v: 'center', indent: 1 } }),
      lbl: sb.xf({ font: { b: 1, sz: 9, color: C.muted }, al: { h: 'right', v: 'center' } }),
      inp: sb.xf({ font: { b: 1, sz: 11, color: C.blue }, fill: C.input, border: { l: ['thin', 'E0B84C'], r: ['thin', 'E0B84C'], t: ['thin', 'E0B84C'], b: ['thin', 'E0B84C'] }, al: { h: 'center', v: 'center' } }),
      dateBox: sb.xf({ font: { b: 1, sz: 10 }, fill: C.bg, fmt: F_DATE, border: { b: thin }, al: { h: 'center', v: 'center' } }),
      hint: sb.xf({ font: { i: 1, sz: 9, color: C.muted }, al: { h: 'left', v: 'center', indent: 1 } }),
      sec: sb.xf({ font: { b: 1, sz: 11, color: C.navy }, border: { b: ['medium', C.teal] }, al: { h: 'left', v: 'center' } }),
      th: sb.xf({ font: { b: 1, sz: 9, color: C.white }, fill: C.navy, al: { h: 'center', v: 'center', wrap: 1 } }),
      thL: sb.xf({ font: { b: 1, sz: 9, color: C.white }, fill: C.navy, al: { h: 'left', v: 'center', indent: 1 } }),
      tdL: sb.xf({ font: { sz: 10 }, border: { b: thin }, al: { h: 'left', v: 'center', indent: 1 } }),
      tdMonth: sb.xf({ font: { sz: 10 }, border: { b: thin }, fmt: F_MONTH, al: { h: 'left', v: 'center', indent: 1 } }),
      tdN: sb.xf({ font: { sz: 10 }, border: { b: thin }, fmt: F_NUM, al: { h: 'right', v: 'center' } }),
      tdI: sb.xf({ font: { sz: 10 }, border: { b: thin }, fmt: F_INT, al: { h: 'right', v: 'center' } }),
      tdP: sb.xf({ font: { sz: 10 }, border: { b: thin }, fmt: F_PCT, al: { h: 'right', v: 'center' } }),
      tdIn: sb.xf({ font: { sz: 10, color: C.blue }, fill: C.input, border: { b: thin }, fmt: F_NUM, al: { h: 'right', v: 'center' } }),
      totL: sb.xf({ font: { b: 1, sz: 10, color: C.navy }, fill: C.bg, border: { t: ['thin', C.navy], b: ['thin', C.navy] }, al: { h: 'left', v: 'center', indent: 1 } }),
      totN: sb.xf({ font: { b: 1, sz: 10, color: C.navy }, fill: C.bg, border: { t: ['thin', C.navy], b: ['thin', C.navy] }, fmt: F_NUM, al: { h: 'right', v: 'center' } }),
      totI: sb.xf({ font: { b: 1, sz: 10, color: C.navy }, fill: C.bg, border: { t: ['thin', C.navy], b: ['thin', C.navy] }, fmt: F_INT, al: { h: 'right', v: 'center' } }),
      totP: sb.xf({ font: { b: 1, sz: 10, color: C.navy }, fill: C.bg, border: { t: ['thin', C.navy], b: ['thin', C.navy] }, fmt: F_PCT, al: { h: 'right', v: 'center' } }),
      note: sb.xf({ font: { sz: 9, color: C.muted }, al: { h: 'left', v: 'top', wrap: 1, indent: 1 } })
    };
    function cardStyles(accent) {
      return {
        lab: sb.xf({ font: { b: 1, sz: 9, color: C.muted }, fill: C.bg, border: { t: ['medium', accent] }, al: { h: 'left', v: 'center', indent: 1 } }),
        val: function (fmt) { return sb.xf({ font: { b: 1, sz: 20, color: accent }, fill: C.bg, fmt: fmt, al: { h: 'left', v: 'center', indent: 1 } }); },
        sub: sb.xf({ font: { i: 1, sz: 9, color: C.muted }, fill: C.bg, al: { h: 'left', v: 'center', indent: 1 } })
      };
    }

    // ══════════════ SHEET 1: TỔNG QUAN ══════════════
    var ws1 = _xlSheet('Tổng quan');
    ws1.breaks = [30]; ws1.grid = false; ws1.tab = C.navy; ws1.landscape = true; ws1.fit = true; ws1.selected = true;
    ws1.width(1, 2); for (var ci = 2; ci <= 13; ci++) ws1.width(ci, 15); ws1.width(14, 2);

    var minS = N ? data[data.length - 1].s : todaySerial, maxS = N ? data[0].s : todaySerial;
    function ddmmyyyy(sn) { var q = _xlFromSerial(sn); return ('0' + q.d).slice(-2) + '/' + ('0' + q.m).slice(-2) + '/' + q.y; }

    ws1.put(1, 2, 'CASHFLOW · BÁO CÁO TÀI CHÍNH CÁ NHÂN', X.title); ws1.fillRange(1, 2, 1, 13, X.title); ws1.merge(1, 2, 1, 13); ws1.height(1, 42);
    ws1.put(2, 2, 'Xuất ngày ' + ddmmyyyy(todaySerial) + '  ·  ' + N + ' giao dịch  ·  dữ liệu từ ' + ddmmyyyy(minS) + ' đến ' + ddmmyyyy(maxS), X.sub);
    ws1.fillRange(2, 2, 2, 13, X.sub); ws1.merge(2, 2, 2, 13); ws1.height(2, 22);
    ws1.height(3, 8);

    // Bộ chọn kỳ (ô vàng)
    ws1.put(4, 2, 'NĂM', X.lbl); ws1.put(4, 3, VY, X.inp);
    ws1.put(4, 4, 'THÁNG', X.lbl); ws1.put(4, 5, VM, X.inp);
    var fromS = _xlSerial(VY, VM, 1), toS = _xlSerial(VY, VM + 1, 1) - 1;
    ws1.put(4, 6, 'TỪ NGÀY', X.lbl);
    ws1.put(4, 7, { f: 'DATE($C$4,IF($E$4="Cả năm",1,$E$4),1)', v: fromS }, X.dateBox);
    ws1.put(4, 8, 'ĐẾN NGÀY', X.lbl);
    ws1.put(4, 9, { f: 'EDATE($G$4,IF($E$4="Cả năm",12,1))-1', v: toS }, X.dateBox);
    ws1.put(4, 10, '◂ Đổi ô vàng (Năm / Tháng) để xem kỳ khác — mọi số liệu bên dưới tự cập nhật', X.hint); ws1.fillRange(4, 10, 4, 13, X.hint); ws1.merge(4, 10, 4, 13);
    ws1.height(4, 26); ws1.height(5, 8);
    var years = {}; years[VY] = 1; data.forEach(function (d) { years[_xlFromSerial(d.s).y] = 1; });
    var yearList = Object.keys(years).map(Number).sort().join(',');
    ws1.dv.push({ ref: 'C4', list: '"' + yearList + '"', title: 'Năm không hợp lệ', error: 'Chọn một năm trong danh sách.', promptTitle: 'Năm', prompt: 'Chọn năm cần xem.' });
    ws1.dv.push({ ref: 'E4', list: '"Cả năm,1,2,3,4,5,6,7,8,9,10,11,12"', title: 'Tháng không hợp lệ', error: 'Chọn "Cả năm" hoặc một tháng từ 1 đến 12.', promptTitle: 'Tháng', prompt: 'Chọn "Cả năm" hoặc tháng 1–12.' });

    var PERIOD = 'GD_Ngay,">="&$G$4,GD_Ngay,"<="&$I$4';
    function sumF(type, rep, catRef) {
      return 'SUMIFS(GD_SoTien,GD_Loai,"' + type + '"' + (rep ? ',GD_TinhBC,"<>Không"' : '') + (catRef ? ',GD_HangMuc,' + catRef : '') + ',' + PERIOD + ')';
    }
    function cntF(type, rep, catRef) {
      return 'COUNTIFS(GD_Loai,"' + type + '"' + (rep ? ',GD_TinhBC,"<>Không"' : '') + (catRef ? ',GD_HangMuc,' + catRef : '') + ',' + PERIOD + ')';
    }
    var pInc = calc('Thu nhập', true, null, fromS, toS), pExp = calc('Chi phí', true, null, fromS, toS);
    var pNet = pInc.sum - pExp.sum, pRate = pInc.sum ? pNet / pInc.sum : 0;

    function card(r, c1, c2, label, valObj, fmt, accent, subObj) {
      var cs = cardStyles(accent);
      ws1.put(r, c1, label, cs.lab); ws1.fillRange(r, c1, r, c2, cs.lab); ws1.merge(r, c1, r, c2);
      ws1.put(r + 1, c1, valObj, cs.val(fmt)); ws1.fillRange(r + 1, c1, r + 2, c2, cs.val(fmt)); ws1.merge(r + 1, c1, r + 2, c2);
      ws1.put(r + 3, c1, subObj, cs.sub); ws1.fillRange(r + 3, c1, r + 3, c2, cs.sub); ws1.merge(r + 3, c1, r + 3, c2);
    }
    card(6, 2, 4, 'THU NHẬP', { f: sumF('Thu nhập', true), v: pInc.sum }, F_VND, C.green,
      { f: cntF('Thu nhập', true) + '&" giao dịch"', v: pInc.n + ' giao dịch' });
    card(6, 5, 7, 'CHI PHÍ', { f: sumF('Chi phí', true), v: pExp.sum }, F_VND, C.red,
      { f: cntF('Chi phí', true) + '&" giao dịch"', v: pExp.n + ' giao dịch' });
    card(6, 8, 10, 'CHÊNH LỆCH (THU − CHI)', { f: 'B7-E7', v: pNet }, F_VND, C.teal,
      { f: 'IF(H7>=0,"Thu lớn hơn chi","Chi vượt thu")', v: pNet >= 0 ? 'Thu lớn hơn chi' : 'Chi vượt thu' });
    card(6, 11, 13, 'TỶ LỆ TIẾT KIỆM', { f: 'IF(B7=0,0,H7/B7)', v: pRate }, F_PCT, C.amber, 'Chênh lệch ÷ Thu nhập');
    ws1.height(6, 20); ws1.height(7, 22); ws1.height(8, 22); ws1.height(9, 18); ws1.height(10, 10);
    var dxGreenF = sb.dxf({ font: { b: 1, color: C.green } }), dxRedF = sb.dxf({ font: { b: 1, color: C.red } });
    ws1.cf.push({ ref: 'H7', rules: [{ type: 'expression', dxf: dxRedF, formula: '$H$7<0' }, { type: 'expression', dxf: dxGreenF, formula: '$H$7>0' }] });

    // Số dư tại thời điểm xuất (ảnh chụp)
    var bal = snap.balances || {};
    ws1.put(11, 2, 'SỐ DƯ TẠI THỜI ĐIỂM XUẤT   ·   ảnh chụp từ ứng dụng, không tự cập nhật   ·   Tài sản ròng = Ngân hàng + Tiền mặt + Chưa phân loại', X.sec);
    ws1.fillRange(11, 2, 11, 13, X.sec); ws1.merge(11, 2, 11, 13); ws1.height(11, 24);
    var balItems = [['TÀI SẢN RÒNG', bal.netWorth, C.navy], ['TIẾT KIỆM / ĐẦU TƯ', bal.savings, C.amber], ['NGÂN HÀNG', bal.bank, C.teal],
      ['TIỀN MẶT', bal.cash, C.green], ['CHƯA PHÂN LOẠI', bal.uncategorized, C.muted], ['NỢ CHO VAY (CHỜ THU)', bal.pendingDebt, C.red]];
    var balLab = sb.xf({ font: { b: 1, sz: 8, color: C.muted }, fill: C.bg, al: { h: 'left', v: 'center', indent: 1 } });
    balItems.forEach(function (it, k) {
      var c1 = 2 + k * 2, c2 = c1 + 1;
      var vs = sb.xf({ font: { b: 1, sz: 13, color: it[2] }, fill: C.bg, fmt: F_VND, border: { b: ['medium', it[2]] }, al: { h: 'left', v: 'center', indent: 1 } });
      ws1.put(12, c1, it[0], balLab); ws1.fillRange(12, c1, 12, c2, balLab); ws1.merge(12, c1, 12, c2);
      ws1.put(13, c1, Number(it[1]) || 0, vs); ws1.fillRange(13, c1, 13, c2, vs); ws1.merge(13, c1, 13, c2);
    });
    ws1.height(12, 18); ws1.height(13, 28); ws1.height(14, 12);

    // Bảng theo tháng
    var R_M0 = 17;                                   // hàng tháng 1
    ws1.put(15, 2, { f: '"DÒNG TIỀN THEO THÁNG  ·  "&$C$4', v: 'DÒNG TIỀN THEO THÁNG  ·  ' + VY }, X.sec);
    ws1.fillRange(15, 2, 15, 7, X.sec); ws1.merge(15, 2, 15, 7); ws1.height(15, 24);
    ['Tháng', 'Thu nhập', 'Chi phí', 'Chênh lệch', 'Tiết kiệm %', 'Lũy kế'].forEach(function (h, k) { ws1.put(16, 2 + k, h, k === 0 ? X.thL : X.th); });
    ws1.height(16, 22);
    var mInc = [], mExp = [], cum = 0, tInc = 0, tExp = 0;
    for (var m = 1; m <= 12; m++) {
      var r = R_M0 + m - 1, lo = _xlSerial(VY, m, 1), hi = _xlSerial(VY, m + 1, 1) - 1;
      var mi = calc('Thu nhập', true, null, lo, hi).sum, me = calc('Chi phí', true, null, lo, hi).sum, mn = mi - me;
      cum += mn; tInc += mi; tExp += me; mInc.push(mi); mExp.push(me);
      var dr = 'GD_Ngay,">="&DATE($C$4,$B' + r + ',1),GD_Ngay,"<"&DATE($C$4,$B' + r + '+1,1)';
      ws1.put(r, 2, m, X.tdMonth);
      ws1.put(r, 3, { f: 'SUMIFS(GD_SoTien,GD_Loai,"Thu nhập",GD_TinhBC,"<>Không",' + dr + ')', v: mi }, X.tdN);
      ws1.put(r, 4, { f: 'SUMIFS(GD_SoTien,GD_Loai,"Chi phí",GD_TinhBC,"<>Không",' + dr + ')', v: me }, X.tdN);
      ws1.put(r, 5, { f: 'C' + r + '-D' + r, v: mn }, X.tdN);
      ws1.put(r, 6, { f: 'IF(C' + r + '=0,0,E' + r + '/C' + r + ')', v: mi ? mn / mi : 0 }, X.tdP);
      ws1.put(r, 7, { f: r === R_M0 ? 'E' + r : 'G' + (r - 1) + '+E' + r, v: cum }, X.tdN);
      ws1.height(r, 20);
    }
    var R_MT = R_M0 + 12;                            // hàng tổng = 29
    ws1.put(R_MT, 2, 'Cả năm', X.totL);
    ws1.put(R_MT, 3, { f: 'SUM(C' + R_M0 + ':C' + (R_MT - 1) + ')', v: tInc }, X.totN);
    ws1.put(R_MT, 4, { f: 'SUM(D' + R_M0 + ':D' + (R_MT - 1) + ')', v: tExp }, X.totN);
    ws1.put(R_MT, 5, { f: 'C' + R_MT + '-D' + R_MT, v: tInc - tExp }, X.totN);
    ws1.put(R_MT, 6, { f: 'IF(C' + R_MT + '=0,0,E' + R_MT + '/C' + R_MT + ')', v: tInc ? (tInc - tExp) / tInc : 0 }, X.totP);
    ws1.put(R_MT, 7, null, X.totN); ws1.height(R_MT, 22);
    var dxPos = sb.dxf({ font: { color: C.green } });
    ws1.cf.push({ ref: 'C' + R_M0 + ':C' + (R_MT - 1), rules: [{ type: 'dataBar', color: 'A8DCC5' }] });
    ws1.cf.push({ ref: 'D' + R_M0 + ':D' + (R_MT - 1), rules: [{ type: 'dataBar', color: 'F2B5AD' }] });
    ws1.cf.push({ ref: 'E' + R_M0 + ':E' + R_MT, rules: [{ type: 'expression', dxf: dxPos, formula: 'E' + R_M0 + '>0' }] });

    // Chi phí theo hạng mục
    var periodTxt = VM ? 'tháng ' + VM + '/' + VY : 'cả năm ' + VY;
    var PTXT_F = 'IF($E$4="Cả năm","cả năm "&$C$4,"tháng "&$E$4&"/"&$C$4)';
    var R_E0 = 33, expCats = snap.expenseCats || [], nE = expCats.length, R_EX = R_E0 + nE, R_ET = R_EX + 1;
    ws1.put(31, 2, { f: '"CHI PHÍ THEO HẠNG MỤC  ·  "&' + PTXT_F, v: 'CHI PHÍ THEO HẠNG MỤC  ·  ' + periodTxt }, X.sec);
    ws1.fillRange(31, 2, 31, 7, X.sec); ws1.merge(31, 2, 31, 7); ws1.height(31, 24);
    ws1.put(32, 2, 'Hạng mục', X.thL); ws1.fillRange(32, 2, 32, 3, X.thL); ws1.merge(32, 2, 32, 3);
    ['Số tiền', '% tổng chi', 'Ngân sách / tháng', '% ngân sách kỳ'].forEach(function (h, k) { ws1.put(32, 4 + k, h, X.th); });
    ws1.height(32, 28);
    var eVals = [], eSum = 0, monthsInPeriod = 12;      // mặc định mô phỏng tháng đang chọn → 1
    monthsInPeriod = VM ? 1 : 12;
    expCats.forEach(function (lab, k) {
      var r = R_E0 + k, v = calc('Chi phí', true, lab, fromS, toS).sum, bud = (snap.budgets || {})[lab];
      eVals.push(v); eSum += v;
      ws1.put(r, 2, lab, X.tdL); ws1.fillRange(r, 2, r, 3, X.tdL); ws1.merge(r, 2, r, 3);
      ws1.put(r, 4, { f: sumF('Chi phí', true, '$B' + r), v: v }, X.tdN);
      ws1.put(r, 5, { f: 'IF($D$' + R_ET + '=0,0,D' + r + '/$D$' + R_ET + ')', v: pExp.sum ? v / pExp.sum : 0 }, X.tdP);
      ws1.put(r, 6, bud ? Number(bud) : null, X.tdIn);
      ws1.put(r, 7, { f: 'IF(OR(F' + r + '="",F' + r + '=0),"",D' + r + '/(F' + r + '*IF($E$4="Cả năm",12,1)))', v: bud ? v / (Number(bud) * monthsInPeriod) : '' }, X.tdP);
      ws1.height(r, 20);
    });
    var restE = pExp.sum - eSum;
    ws1.put(R_EX, 2, 'Khác (chưa xếp hạng mục)', X.tdL); ws1.fillRange(R_EX, 2, R_EX, 3, X.tdL); ws1.merge(R_EX, 2, R_EX, 3);
    ws1.put(R_EX, 4, { f: 'E7-SUM(D' + R_E0 + ':D' + (R_EX - 1) + ')', v: restE }, X.tdN);
    ws1.put(R_EX, 5, { f: 'IF($D$' + R_ET + '=0,0,D' + R_EX + '/$D$' + R_ET + ')', v: pExp.sum ? restE / pExp.sum : 0 }, X.tdP);
    ws1.put(R_EX, 6, null, X.tdN); ws1.put(R_EX, 7, null, X.tdN); ws1.height(R_EX, 20);
    ws1.put(R_ET, 2, 'Tổng chi phí', X.totL); ws1.fillRange(R_ET, 2, R_ET, 3, X.totL); ws1.merge(R_ET, 2, R_ET, 3);
    ws1.put(R_ET, 4, { f: 'SUM(D' + R_E0 + ':D' + R_EX + ')', v: pExp.sum }, X.totN);
    ws1.put(R_ET, 5, { f: 'SUM(E' + R_E0 + ':E' + R_EX + ')', v: pExp.sum ? 1 : 0 }, X.totP);
    ws1.put(R_ET, 6, null, X.totN); ws1.put(R_ET, 7, null, X.totN); ws1.height(R_ET, 22);
    var dxOver = sb.dxf({ font: { b: 1, color: C.red }, fill: C.redL }), dxWarn = sb.dxf({ font: { b: 1, color: C.amber }, fill: C.amberL }), dxOk = sb.dxf({ font: { color: C.green } });
    var gRef = 'G' + R_E0 + ':G' + (R_EX - 1);
    ws1.cf.push({ ref: gRef, rules: [
      { type: 'expression', dxf: dxOver, formula: 'AND(ISNUMBER(G' + R_E0 + '),G' + R_E0 + '>1)' },
      { type: 'expression', dxf: dxWarn, formula: 'AND(ISNUMBER(G' + R_E0 + '),G' + R_E0 + '>0.85)' },
      { type: 'expression', dxf: dxOk, formula: 'AND(ISNUMBER(G' + R_E0 + '),G' + R_E0 + '<=0.85)' }] });
    ws1.cf.push({ ref: 'D' + R_E0 + ':D' + (R_EX - 1), rules: [{ type: 'dataBar', color: 'F2B5AD' }] });

    // Thu nhập theo hạng mục  |  Theo nguồn tiền
    var R_I_T = R_ET + 2, R_I_H = R_I_T + 1, R_I0 = R_I_H + 1, incCats = snap.incomeCats || [], nI = incCats.length, R_IX = R_I0 + nI, R_IT = R_IX + 1;
    ws1.put(R_I_T, 2, { f: '"THU NHẬP THEO HẠNG MỤC  ·  "&' + PTXT_F, v: 'THU NHẬP THEO HẠNG MỤC  ·  ' + periodTxt }, X.sec);
    ws1.fillRange(R_I_T, 2, R_I_T, 7, X.sec); ws1.merge(R_I_T, 2, R_I_T, 7); ws1.height(R_I_T, 24);
    ws1.put(R_I_H, 2, 'Hạng mục', X.thL); ws1.fillRange(R_I_H, 2, R_I_H, 3, X.thL); ws1.merge(R_I_H, 2, R_I_H, 3);
    ['Số tiền', '% tổng thu', 'Số giao dịch', 'Trung bình / GD'].forEach(function (h, k) { ws1.put(R_I_H, 4 + k, h, X.th); });
    ws1.height(R_I_H, 28);
    var iSum = 0, iCnt = 0;
    incCats.forEach(function (lab, k) {
      var r = R_I0 + k, cc = calc('Thu nhập', true, lab, fromS, toS);
      iSum += cc.sum; iCnt += cc.n;
      ws1.put(r, 2, lab, X.tdL); ws1.fillRange(r, 2, r, 3, X.tdL); ws1.merge(r, 2, r, 3);
      ws1.put(r, 4, { f: sumF('Thu nhập', true, '$B' + r), v: cc.sum }, X.tdN);
      ws1.put(r, 5, { f: 'IF($D$' + R_IT + '=0,0,D' + r + '/$D$' + R_IT + ')', v: pInc.sum ? cc.sum / pInc.sum : 0 }, X.tdP);
      ws1.put(r, 6, { f: cntF('Thu nhập', true, '$B' + r), v: cc.n }, X.tdI);
      ws1.put(r, 7, { f: 'IF(F' + r + '=0,0,D' + r + '/F' + r + ')', v: cc.n ? cc.sum / cc.n : 0 }, X.tdN);
      ws1.height(r, 20);
    });
    var restI = pInc.sum - iSum, restIn = pInc.n - iCnt;
    ws1.put(R_IX, 2, 'Khác (chưa xếp hạng mục)', X.tdL); ws1.fillRange(R_IX, 2, R_IX, 3, X.tdL); ws1.merge(R_IX, 2, R_IX, 3);
    ws1.put(R_IX, 4, { f: 'B7-SUM(D' + R_I0 + ':D' + (R_IX - 1) + ')', v: restI }, X.tdN);
    ws1.put(R_IX, 5, { f: 'IF($D$' + R_IT + '=0,0,D' + R_IX + '/$D$' + R_IT + ')', v: pInc.sum ? restI / pInc.sum : 0 }, X.tdP);
    ws1.put(R_IX, 6, { f: 'COUNTIFS(GD_Loai,"Thu nhập",GD_TinhBC,"<>Không",' + PERIOD + ')-SUM(F' + R_I0 + ':F' + (R_IX - 1) + ')', v: restIn }, X.tdI);
    ws1.put(R_IX, 7, { f: 'IF(F' + R_IX + '=0,0,D' + R_IX + '/F' + R_IX + ')', v: restIn ? restI / restIn : 0 }, X.tdN); ws1.height(R_IX, 20);
    ws1.put(R_IT, 2, 'Tổng thu nhập', X.totL); ws1.fillRange(R_IT, 2, R_IT, 3, X.totL); ws1.merge(R_IT, 2, R_IT, 3);
    ws1.put(R_IT, 4, { f: 'SUM(D' + R_I0 + ':D' + R_IX + ')', v: pInc.sum }, X.totN);
    ws1.put(R_IT, 5, { f: 'SUM(E' + R_I0 + ':E' + R_IX + ')', v: pInc.sum ? 1 : 0 }, X.totP);
    ws1.put(R_IT, 6, { f: 'SUM(F' + R_I0 + ':F' + R_IX + ')', v: pInc.n }, X.totI);
    ws1.put(R_IT, 7, { f: 'IF(F' + R_IT + '=0,0,D' + R_IT + '/F' + R_IT + ')', v: pInc.n ? pInc.sum / pInc.n : 0 }, X.totN); ws1.height(R_IT, 22);

    // Theo nguồn tiền (gồm cả chuyển nội bộ)
    ws1.put(R_I_T, 9, { f: '"BIẾN ĐỘNG THEO NGUỒN TIỀN  ·  "&' + PTXT_F, v: 'BIẾN ĐỘNG THEO NGUỒN TIỀN  ·  ' + periodTxt }, X.sec);
    ws1.fillRange(R_I_T, 9, R_I_T, 13, X.sec); ws1.merge(R_I_T, 9, R_I_T, 13);
    ws1.put(R_I_H, 9, 'Nguồn tiền', X.thL);
    ['Thu nhập', 'Chi phí', 'Chênh lệch', 'Số giao dịch'].forEach(function (h, k) { ws1.put(R_I_H, 10 + k, h, X.th); });
    var sTI = 0, sTE = 0, sTN = 0;
    SRC.forEach(function (sname, k) {
      var r = R_I0 + k, a = calc('Thu nhập', false, null, fromS, toS, sname), b = calc('Chi phí', false, null, fromS, toS, sname);
      sTI += a.sum; sTE += b.sum; sTN += a.n + b.n;
      var base = 'GD_Nguon,$I' + r + ',' + PERIOD;
      ws1.put(r, 9, sname, X.tdL);
      ws1.put(r, 10, { f: 'SUMIFS(GD_SoTien,GD_Loai,"Thu nhập",' + base + ')', v: a.sum }, X.tdN);
      ws1.put(r, 11, { f: 'SUMIFS(GD_SoTien,GD_Loai,"Chi phí",' + base + ')', v: b.sum }, X.tdN);
      ws1.put(r, 12, { f: 'J' + r + '-K' + r, v: a.sum - b.sum }, X.tdN);
      ws1.put(r, 13, { f: 'COUNTIFS(' + base + ')', v: a.n + b.n }, X.tdI);
    });
    var R_ST = R_I0 + SRC.length;
    ws1.put(R_ST, 9, 'Tổng cộng', X.totL);
    ws1.put(R_ST, 10, { f: 'SUM(J' + R_I0 + ':J' + (R_ST - 1) + ')', v: sTI }, X.totN);
    ws1.put(R_ST, 11, { f: 'SUM(K' + R_I0 + ':K' + (R_ST - 1) + ')', v: sTE }, X.totN);
    ws1.put(R_ST, 12, { f: 'J' + R_ST + '-K' + R_ST, v: sTI - sTE }, X.totN);
    ws1.put(R_ST, 13, { f: 'SUM(M' + R_I0 + ':M' + (R_ST - 1) + ')', v: sTN }, X.totI); ws1.height(R_ST, 22);
    ws1.put(R_ST + 1, 9, 'Tính mọi giao dịch, kể cả chuyển tiết kiệm nội bộ và thu hồi nợ.', X.hint);
    ws1.fillRange(R_ST + 1, 9, R_ST + 1, 13, X.hint); ws1.merge(R_ST + 1, 9, R_ST + 1, 13);
    ws1.cf.push({ ref: 'L' + R_I0 + ':L' + R_ST, rules: [{ type: 'expression', dxf: dxPos, formula: 'L' + R_I0 + '>0' }] });

    // Ghi chú
    var R_N = Math.max(R_IT, R_ST + 1) + 2;
    ws1.put(R_N, 2, 'GHI CHÚ', X.sec); ws1.fillRange(R_N, 2, R_N, 13, X.sec); ws1.merge(R_N, 2, R_N, 13); ws1.height(R_N, 22);
    [
      '•  Thu nhập / Chi phí chỉ tính các giao dịch có cột «Tính báo cáo» khác "Không" (loại trừ chuyển tiền tiết kiệm nội bộ và thu hồi nợ) — giống cách ứng dụng tính.',
      '•  Mọi số liệu là công thức: sửa, thêm, xóa dòng ở sheet «Giao dịch» (hoặc đổi Năm / Tháng ở ô vàng phía trên) là báo cáo và biểu đồ tự cập nhật.',
      '•  Ô nền vàng, chữ xanh là ô nhập liệu (Năm, Tháng, Ngân sách / tháng). Ô «% ngân sách kỳ» chuyển vàng khi dùng trên 85% và đỏ khi vượt ngân sách.',
      '•  Có thể nhập lại chính file này vào ứng dụng bằng nút Nhập Excel — ứng dụng đọc sheet «Giao dịch».'
    ].forEach(function (t, k) { var r = R_N + 1 + k; ws1.put(r, 2, t, X.note); ws1.fillRange(r, 2, r, 13, X.note); ws1.merge(r, 2, r, 13); ws1.height(r, 28); });

    // Biểu đồ
    var QT = "'Tổng quan'!";
    ws1.charts.push({
      from: { c: 7, r: 14, dx: 60000 }, to: { c: 13, r: R_MT },
      xml: _xlChartXml({ title: 'Thu – Chi theo tháng', dir: 'col', legend: true, gap: 70, catNum: true, catRef: QT + '$B$' + R_M0 + ':$B$' + (R_MT - 1),
        cats: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], catFmt: F_MONTH, catAxFmt: '"T"0', valFmt: '[>=1000000]#,##0.0,,"tr";[>=1000]#,##0,"k";0',
        series: [
          { name: 'Thu nhập', nameRef: QT + '$C$16', color: '1E9E6A', valRef: QT + '$C$' + R_M0 + ':$C$' + (R_MT - 1), vals: mInc },
          { name: 'Chi phí', nameRef: QT + '$D$16', color: 'D6564A', valRef: QT + '$D$' + R_M0 + ':$D$' + (R_MT - 1), vals: mExp }] })
    });
    ws1.charts.push({
      from: { c: 7, r: 30, dx: 60000 }, to: { c: 13, r: R_ET },
      xml: _xlChartXml({ title: 'Chi phí theo hạng mục', dir: 'bar', legend: false, gap: 45, labels: true, labelFmt: '[>=1000000]#,##0.0,,"tr";[>=1000]#,##0,"k";0',
        catNum: false, catRef: QT + '$B$' + R_E0 + ':$B$' + (R_EX - 1), cats: expCats,
        series: [{ name: 'Số tiền', nameRef: QT + '$D$32', color: 'D6564A', valRef: QT + '$D$' + R_E0 + ':$D$' + (R_EX - 1), vals: eVals }] })
    });

    // ══════════════ SHEET 2: GIAO DỊCH ══════════════
    var ws2 = _xlSheet('Giao dịch');
    ws2.tab = C.teal; ws2.landscape = true; ws2.fit = true; ws2.freeze = { row: 4 }; ws2.titles = '$4:$4';
    [13, 13, 28, 46, 17, 18, 15].forEach(function (w, k) { ws2.width(k + 1, w); });
    var tTitle = sb.xf({ font: { b: 1, sz: 14, color: C.white }, fill: C.navy, al: { h: 'left', v: 'center', indent: 1 } });
    ws2.put(1, 1, 'DANH SÁCH GIAO DỊCH', tTitle); ws2.fillRange(1, 1, 1, 7, tTitle); ws2.merge(1, 1, 1, 7); ws2.height(1, 32);
    var infoL = sb.xf({ font: { b: 1, sz: 9, color: C.muted }, fill: C.bg, al: { h: 'left', v: 'center', indent: 1 } });
    var infoR = sb.xf({ font: { b: 1, sz: 9, color: C.muted }, fill: C.bg, al: { h: 'right', v: 'center' } });
    var infoCnt = sb.xf({ font: { b: 1, sz: 11, color: C.navy }, fill: C.bg, fmt: '#,##0" giao dịch"', al: { h: 'left', v: 'center' } });
    var infoSum = sb.xf({ font: { b: 1, sz: 11, color: C.navy }, fill: C.bg, fmt: F_VND, al: { h: 'left', v: 'center' } });
    var totalAmt = 0; data.forEach(function (d) { totalAmt += d.amount; });
    ws2.put(2, 1, 'Đang hiển thị', infoL); ws2.put(2, 2, null, infoL); ws2.merge(2, 1, 2, 2);
    ws2.put(2, 3, { f: 'SUBTOTAL(102,F' + FIRST + ':F' + LAST + ')', v: N }, infoCnt);
    ws2.put(2, 4, 'Tổng giá trị theo bộ lọc (Thu + Chi)', infoR);
    ws2.put(2, 5, { f: 'SUBTOTAL(109,F' + FIRST + ':F' + LAST + ')', v: totalAmt }, infoSum); ws2.merge(2, 5, 2, 6);
    ws2.put(2, 6, null, infoSum); ws2.put(2, 7, null, infoL); ws2.height(2, 24);
    ws2.put(3, 1, 'Mẹo: bấm mũi tên ở tiêu đề cột để lọc / sắp xếp (lọc Loại = Chi phí để xem tổng chi). Thêm giao dịch bằng cách nhập dòng mới ngay dưới bảng.', X.hint);
    ws2.fillRange(3, 1, 3, 7, X.hint); ws2.merge(3, 1, 3, 7); ws2.height(3, 20);

    var H2 = ['Ngày', 'Loại', 'Hạng mục', 'Mô tả', 'Nguồn', 'Số tiền', 'Tính báo cáo'];
    var th2 = sb.xf({ font: { b: 1, sz: 10, color: C.white }, fill: C.navy, al: { h: 'center', v: 'center' } });
    H2.forEach(function (h, k) { ws2.put(4, k + 1, h, th2); }); ws2.height(4, 26);
    var s2 = {
      date: sb.xf({ font: { sz: 10 }, fmt: F_DATE, al: { h: 'center', v: 'center' } }),
      type: sb.xf({ font: { sz: 10 }, al: { h: 'center', v: 'center' } }),
      txt: sb.xf({ font: { sz: 10 }, al: { h: 'left', v: 'center', indent: 1 } }),
      amt: sb.xf({ font: { sz: 10, b: 1 }, fmt: F_VND, al: { h: 'right', v: 'center' } }),
      rep: sb.xf({ font: { sz: 10 }, al: { h: 'center', v: 'center' } })
    };
    data.forEach(function (d, i) {
      var r = FIRST + i;
      ws2.put(r, 1, d.s, s2.date); ws2.put(r, 2, d.type, s2.type); ws2.put(r, 3, d.cat, s2.txt); ws2.put(r, 4, d.desc, s2.txt);
      ws2.put(r, 5, d.src, s2.txt); ws2.put(r, 6, d.amount, s2.amt); ws2.put(r, 7, d.rep ? 'Có' : 'Không', s2.rep);
    });
    ws2.tables.push({ name: 'tblGiaoDich', ref: _xlRange(4, 1, 3 + Math.max(N, 1) + 1, 7), cols: H2 });
    var catRows = (snap.allCats || []).length;
    ws2.dv.push({ ref: 'B' + FIRST + ':B' + LAST, list: '"Thu nhập,Chi phí"', title: 'Loại không hợp lệ', error: 'Chọn Thu nhập hoặc Chi phí.' });
    ws2.dv.push({ ref: 'C' + FIRST + ':C' + LAST, list: "'Danh mục'!$B$4:$B$" + (3 + Math.max(catRows, 1)), title: 'Hạng mục', error: 'Chọn hạng mục trong danh sách (xem sheet Danh mục).' });
    ws2.dv.push({ ref: 'E' + FIRST + ':E' + LAST, list: '"' + SRC.join(',') + '"', title: 'Nguồn tiền', error: 'Chọn nguồn tiền trong danh sách.' });
    ws2.dv.push({ ref: 'G' + FIRST + ':G' + LAST, list: '"Có,Không"', title: 'Tính báo cáo', error: 'Chọn Có hoặc Không.' });
    ws2.cf.push({ ref: 'F' + FIRST + ':F' + LAST, rules: [
      { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.green } }), formula: '$B' + FIRST + '="Thu nhập"' },
      { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.red } }), formula: '$B' + FIRST + '="Chi phí"' }] });
    ws2.cf.push({ ref: 'B' + FIRST + ':B' + LAST, rules: [
      { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.green }, fill: C.greenL }), formula: '$B' + FIRST + '="Thu nhập"' },
      { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.red }, fill: C.redL }), formula: '$B' + FIRST + '="Chi phí"' }] });
    ws2.cf.push({ ref: 'G' + FIRST + ':G' + LAST, rules: [{ type: 'expression', dxf: sb.dxf({ font: { i: 1, color: '9AA4B2' } }), formula: '$G' + FIRST + '="Không"' }] });
    ws2.cf.push({ ref: 'A' + FIRST + ':G' + LAST, rules: [{ type: 'expression', dxf: sb.dxf({ fill: 'F6F8FB' }), formula: 'AND($A' + FIRST + '<>"",MOD(ROW(),2)=0)' }] });

    var sheets = [ws1, ws2];

    // ══════════════ SHEET 3: CÔNG NỢ (nếu có) ══════════════
    var debts = snap.debts || [];
    if (debts.length) {
      var ws3 = _xlSheet('Công nợ');
      ws3.tab = C.amber; ws3.landscape = true; ws3.fit = true; ws3.freeze = { row: 4 }; ws3.titles = '$4:$4';
      [24, 17, 14, 14, 12, 14, 14, 44].forEach(function (w, k) { ws3.width(k + 1, w); });
      ws3.put(1, 1, 'CÔNG NỢ — TIỀN CHO MƯỢN', tTitle); ws3.fillRange(1, 1, 1, 8, tTitle); ws3.merge(1, 1, 1, 8); ws3.height(1, 32);
      var pending = 0; debts.forEach(function (d) { if (!d.paid) pending += Number(d.amount) || 0; });
      ws3.put(2, 1, 'Tổng nợ đang chờ thu', infoL); ws3.put(2, 2, { f: 'SUMIFS(B5:B1000,E5:E1000,"<>Có")', v: pending }, infoSum); ws3.fillRange(2, 3, 2, 8, infoL); ws3.height(2, 24);
      ws3.put(3, 1, 'Cột «Trạng thái» và «Còn lại (ngày)» tự tính theo ngày hôm nay. Đổi cột «Đã trả» thành Có khi đã thu hồi.', X.hint);
      ws3.fillRange(3, 1, 3, 8, X.hint); ws3.merge(3, 1, 3, 8); ws3.height(3, 20);
      var H3 = ['Người mượn', 'Số tiền', 'Ngày mượn', 'Hẹn trả', 'Đã trả', 'Trạng thái', 'Còn lại (ngày)', 'Ghi chú'];
      H3.forEach(function (h, k) { ws3.put(4, k + 1, h, th2); }); ws3.height(4, 26);
      var sn = function (o) { return o ? _xlSerial(o.y, o.m, o.d) : null; };
      debts.forEach(function (d, i) {
        var r = FIRST + i, due = sn(d.due), st = d.paid ? 'Đã trả' : (due !== null && due < todaySerial ? 'Quá hạn' : 'Đang chờ');
        ws3.put(r, 1, d.name || '', s2.txt); ws3.put(r, 2, Number(d.amount) || 0, s2.amt);
        ws3.put(r, 3, sn(d.borrowed), s2.date); ws3.put(r, 4, due, s2.date); ws3.put(r, 5, d.paid ? 'Có' : 'Không', s2.rep);
        ws3.put(r, 6, { f: 'IF(E' + r + '="Có","Đã trả",IF(D' + r + '="","Đang chờ",IF(D' + r + '<TODAY(),"Quá hạn","Đang chờ")))', v: st }, s2.rep);
        ws3.put(r, 7, { f: 'IF(OR(E' + r + '="Có",D' + r + '=""),"",D' + r + '-TODAY())', v: (d.paid || due === null) ? '' : due - todaySerial }, sb.xf({ font: { sz: 10 }, fmt: '0;[Red]-0', al: { h: 'center', v: 'center' } }));
        ws3.put(r, 8, d.note || '', s2.txt);
      });
      ws3.tables.push({ name: 'tblCongNo', ref: _xlRange(4, 1, 4 + debts.length, 8), cols: H3 });
      ws3.dv.push({ ref: 'E' + FIRST + ':E1000', list: '"Có,Không"', title: 'Đã trả', error: 'Chọn Có hoặc Không.' });
      ws3.cf.push({ ref: 'F' + FIRST + ':F1000', rules: [
        { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.red }, fill: C.redL }), formula: '$F' + FIRST + '="Quá hạn"' },
        { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.amber }, fill: C.amberL }), formula: '$F' + FIRST + '="Đang chờ"' },
        { type: 'expression', dxf: sb.dxf({ font: { b: 1, color: C.green }, fill: C.greenL }), formula: '$F' + FIRST + '="Đã trả"' }] });
      ws3.cf.push({ ref: 'A' + FIRST + ':H1000', rules: [{ type: 'expression', dxf: sb.dxf({ fill: 'F6F8FB' }), formula: 'AND($A' + FIRST + '<>"",MOD(ROW(),2)=0)' }] });
      sheets.push(ws3);
    }

    // ══════════════ SHEET: DANH MỤC ══════════════
    var ws4 = _xlSheet('Danh mục');
    ws4.tab = '9AA4B2'; ws4.fit = true;
    [12, 34, 3, 20, 3, 16].forEach(function (w, k) { ws4.width(k + 1, w); });
    ws4.put(1, 1, 'DANH MỤC & HƯỚNG DẪN', tTitle); ws4.fillRange(1, 1, 1, 6, tTitle); ws4.merge(1, 1, 1, 6); ws4.height(1, 32);
    ws4.put(3, 1, 'Loại', th2); ws4.put(3, 2, 'Hạng mục', th2); ws4.put(3, 4, 'Nguồn tiền', th2); ws4.put(3, 6, 'Tính báo cáo', th2);
    (snap.allCats || []).forEach(function (c, k) { ws4.put(4 + k, 1, c.type, s2.txt); ws4.put(4 + k, 2, c.label, s2.txt); });
    SRC.forEach(function (sname, k) { ws4.put(4 + k, 4, sname, s2.txt); });
    ws4.put(4, 6, 'Có', s2.txt); ws4.put(5, 6, 'Không', s2.txt);
    var R_G = 4 + Math.max((snap.allCats || []).length, SRC.length) + 1;
    ws4.put(R_G, 1, 'CÁCH DÙNG', X.sec); ws4.fillRange(R_G, 1, R_G, 6, X.sec); ws4.merge(R_G, 1, R_G, 6); ws4.height(R_G, 24);
    [
      '•  Các cột Loại, Hạng mục, Nguồn, Tính báo cáo ở sheet «Giao dịch» có danh sách chọn lấy từ trang này.',
      '•  Hạng mục lạ (không có trong danh sách) vẫn được giữ nguyên khi nhập lại vào ứng dụng, nhưng báo cáo Tổng quan sẽ xếp vào dòng «Khác».',
      '•  «Tính báo cáo = Không» dành cho chuyển tiền tiết kiệm nội bộ và thu hồi nợ — không phải thu nhập hay chi phí thật.',
      '•  Công thức dùng các tên vùng GD_Ngay, GD_Loai, GD_HangMuc, GD_Nguon, GD_SoTien, GD_TinhBC (xem Formulas ▸ Name Manager), phủ đến dòng ' + LAST + '.'
    ].forEach(function (t, k) { var r = R_G + 1 + k; ws4.put(r, 1, t, X.note); ws4.fillRange(r, 1, r, 6, X.note); ws4.merge(r, 1, r, 6); ws4.height(r, 30); });

    sheets.push(ws4);

    var colLetter = { Ngay: 'A', Loai: 'B', HangMuc: 'C', Nguon: 'E', SoTien: 'F', TinhBC: 'G' };
    var names = Object.keys(colLetter).map(function (k) {
      return { name: 'GD_' + k, ref: "'Giao dịch'!$" + colLetter[k] + '$' + FIRST + ':$' + colLetter[k] + '$' + LAST };
    });
    names.push({ name: '_xlnm.Print_Titles', sheet: 1, ref: "'Giao dịch'!$4:$4" });
    if (debts.length) names.push({ name: '_xlnm.Print_Titles', sheet: 2, ref: "'Công nợ'!$4:$4" });

    return _xlPackage(sheets, sb, sst, names, { created: exp, title: 'CashFlow — Báo cáo tài chính' });
  }

  // ══════════════════════════════════════════════════════════════
  //   NHẬP FILE EXCEL — đọc theo TÊN CỘT (không theo vị trí)
  //   Hiểu: file mới (sheet «Giao dịch») và file xuất kiểu cũ
  //   (sheet Expenses / Income, không có cột Năm).
  //   sheets = [{ name, rows: [[ô, ô, ...], ...] }]  (kết quả sheet_to_json header:1)
  //   ctx    = { defaultYear, uid(), now }
  // ══════════════════════════════════════════════════════════════
  function _xlNorm(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[đĐ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Ô ngày → {y,m,d} hoặc null. Hiểu: số seri Excel, "dd/mm/yyyy", "yyyy-mm-dd". */
  function _xlParseDate(v) {
    if (typeof v === 'number') {
      if (v > 36526 && v < 73051) return _xlFromSerial(Math.floor(v));
      return null;
    }
    if (typeof v === 'string') {
      var s = v.trim(), m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
      if (m) return { d: +m[1], m: +m[2], y: +m[3] };
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    }
    return null;
  }

  function _xlParseAmount(v) {
    if (typeof v === 'number') return Math.abs(v);
    if (typeof v === 'string') {
      var digits = v.replace(/[^\d]/g, '');
      return digits ? Number(digits) : NaN;
    }
    return NaN;
  }

  function _xlParseSource(v) {
    var s = _xlNorm(v);
    if (/(^| )(cash|tien mat|tien)( |$)/.test(s)) return 'cash';
    if (/bank|chuyen|ngan hang/.test(s)) return 'bank';
    if (/saving|tiet kiem/.test(s)) return 'savings';
    return 'uncategorized';
  }

  var _XL_SKIP_SHEETS = ['tong quan', 'summary', 'tom tat', 'danh muc', 'cong no', 'huong dan'];

  function _parseImportSheets(sheets, ctx) {
    var out = [], skippedRows = 0, skippedSheets = [];

    sheets.forEach(function (sh) {
      var nm = _xlNorm(sh.name), rows = sh.rows || [];
      if (_XL_SKIP_SHEETS.indexOf(nm) !== -1) { skippedSheets.push(sh.name); return; }

      // Tìm dòng tiêu đề: dòng đầu tiên (trong 15 dòng đầu) có cột «Số tiền» / «Amount»
      var hi = -1;
      for (var i = 0; i < Math.min(rows.length, 15); i++) {
        var cells = (rows[i] || []).map(_xlNorm);
        if (cells.indexOf('so tien') !== -1 || cells.indexOf('amount') !== -1) { hi = i; break; }
      }
      if (hi < 0) { if (rows.length > 1) skippedSheets.push(sh.name); return; }

      var head = rows[hi].map(_xlNorm);
      function find(list) { for (var k = 0; k < list.length; k++) { var ix = head.indexOf(list[k]); if (ix !== -1) return ix; } return -1; }
      var col = {
        date: find(['ngay', 'date', 'ngay giao dich']), month: find(['thang', 'month']), year: find(['nam', 'year']),
        type: find(['loai', 'type']), desc: find(['mo ta', 'description', 'noi dung']), cat: find(['hang muc', 'category']),
        src: find(['nguon', 'source', 'nguon tien']), amt: find(['so tien', 'amount'])
      };
      var sheetIsIncome = nm.indexOf('income') !== -1 || /(^| )thu( |$)/.test(nm);

      for (var r = hi + 1; r < rows.length; r++) {
        var row = rows[r];
        if (!row || !row.length) continue;
        var blank = true;
        for (var q = 0; q < row.length; q++) { if (row[q] !== null && row[q] !== undefined && String(row[q]).trim() !== '') { blank = false; break; } }
        if (blank) continue;

        // Ngày
        var dv = col.date >= 0 ? row[col.date] : undefined, day, month, year, dt = _xlParseDate(dv);
        if (dt) { day = dt.d; month = dt.m; year = dt.y; }
        else if (typeof dv === 'number' && dv >= 1 && dv <= 31) {
          day = dv; month = col.month >= 0 ? Number(row[col.month]) : NaN;
          year = col.year >= 0 ? Number(row[col.year]) : NaN;
          if (!(year >= 2000 && year <= 2100)) year = ctx.defaultYear;
        } else { skippedRows++; continue; }

        var amount = col.amt >= 0 ? _xlParseAmount(row[col.amt]) : NaN;
        if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100) || !(amount > 0)) { skippedRows++; continue; }

        // Loại: ưu tiên cột «Loại», nếu không có thì theo tên sheet
        var type = sheetIsIncome ? 'income' : 'expense';
        if (col.type >= 0 && row[col.type] !== undefined && String(row[col.type]).trim() !== '') {
          var tn = _xlNorm(row[col.type]);
          type = (tn.indexOf('thu') === 0 || tn.indexOf('income') === 0) ? 'income' : 'expense';
        }

        var category = col.cat >= 0 ? String(row[col.cat] === undefined || row[col.cat] === null ? '' : row[col.cat]).trim() : '';
        // «🤝 Thu nợ» ở file Excel ↔ mã 'thu-no' trong ứng dụng (ứng dụng loại khoản này khỏi Thu nhập)
        if (type === 'income' && _xlNorm(category) === 'thu no') category = 'thu-no';

        out.push({
          id: ctx.uid(), type: type, amount: Math.abs(amount), year: year, month: month, day: day,
          desc: col.desc >= 0 ? String(row[col.desc] === undefined || row[col.desc] === null ? '' : row[col.desc]).trim() : '',
          category: category, source: col.src >= 0 ? _xlParseSource(row[col.src]) : 'uncategorized', createdAt: ctx.now
        });
      }
    });

    return { transactions: out, skippedRows: skippedRows, skippedSheets: skippedSheets };
  }
  // ==== XLSX-CORE-END ======================================================


  /** Gom dữ liệu ứng dụng thành "snapshot" thuần để bộ dựng báo cáo xử lý */
  function _collectExportSnapshot() {
    var SRC_VI = { cash: 'Tiền mặt', bank: 'Chuyển khoản', savings: 'Tiết kiệm' };
    function iso(s) {
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s || '');
      return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    }
    function catLabel(tx) {
      var c = tx.category;
      if (tx.type === 'income' && (c === 'thu-no' || c === 'Thu nợ')) return '🤝 Thu nợ';
      return _categoryDisplayName(c, tx.type);
    }
    // Cùng quy tắc với thẻ tổng kết của ứng dụng: chuyển tiết kiệm & thu hồi nợ không phải thu/chi thật
    function reported(tx) {
      var isSavings = tx.source === 'savings' || tx.category === 'tiet-kiem' || tx.category === 'Tiết kiệm' || tx.category === '🐷 Tiết kiệm';
      var isDebtRecovery = tx.category === 'thu-no' || tx.category === 'Thu nợ';
      return !isSavings && !(tx.type === 'income' && isDebtRecovery);
    }
    var fallbackYear = _currentMonth ? _currentMonth.year : new Date().getFullYear();
    var rows = _data.transactions.filter(function (tx) { return tx.type === 'income' || tx.type === 'expense'; }).map(function (tx) {
      return { y: tx.year || fallbackYear, m: tx.month || 1, d: tx.day || 1, type: tx.type, cat: catLabel(tx), desc: tx.desc || '',
        src: SRC_VI[tx.source] || 'Chưa phân loại', amount: tx.amount || 0, rep: reported(tx) };
    });

    var expenseCats = [], incomeCats = [], budgets = {}, allCats = [], seen = {};
    var bud = (_cashFlowMeta && _cashFlowMeta.budgets) || {};
    EXPENSE_CATEGORIES.forEach(function (c) {
      var label = _categoryDisplayName(c.id, 'expense');
      allCats.push({ type: 'Chi phí', label: label });
      if (c.id === 'tiet-kiem') return;
      expenseCats.push(label);
      var b = bud[c.id] || bud[label] || bud[c.name];
      if (b > 0) budgets[label] = b;
    });
    INCOME_CATEGORIES.forEach(function (c) {
      var label = _categoryDisplayName(c.id, 'income');
      if (c.id !== 'tiet-kiem') { incomeCats.push(label); allCats.push({ type: 'Thu nhập', label: label }); }
    });
    allCats.push({ type: 'Thu nhập', label: '🤝 Thu nợ' });

    _ensureDebtData();
    var debts = _data.debts.map(function (d) {
      return { name: d.debtorName, amount: d.amount, borrowed: iso(d.dateBorrowed), due: iso(d.expectedReturnDate),
        paid: _getDebtStatus(d) === 'paid', note: d.note || '' };
    });

    return {
      rows: rows, debts: debts, expenseCats: expenseCats, incomeCats: incomeCats, allCats: allCats, budgets: budgets,
      balances: { netWorth: _computeLiveNetWorth(), savings: _calcSavingsBalance(), bank: _calcBankBalance(),
        cash: _calcCashBalance(), uncategorized: _calcUncategorizedBalance(), pendingDebt: _getTotalPendingDebt() },
      viewYear: _currentMonth ? _currentMonth.year : fallbackYear,
      viewMonth: _currentMonth ? _currentMonth.month : (new Date().getMonth() + 1),
      exportedAt: new Date()
    };
  }

  /** Xuất báo cáo Excel đầy đủ (4 sheet, công thức, biểu đồ). Lỗi → quay về bản xuất cơ bản. */
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
      var bytes = _buildCashflowXlsx(_collectExportSnapshot());
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var now = new Date();
      var ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'CashFlow_Export_' + ts + '.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      console.error('[CashFlow] Rich Excel export failed, using basic export:', e);
      _exportToXlsxBasic();
    }
  }


  /** Bản xuất cơ bản (SheetJS) — dự phòng khi bản đầy đủ gặp lỗi */
  function _exportToXlsxBasic() {
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
  //   HEATMAP VIEW — Cyberpunk Calendar Heatmap
  // ============================================================

  /**
   * Compact VND formatting for heatmap cells (e.g., "500k", "1.2M", "50")
   */
  function _formatCompactVND(amount) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    if (abs >= 1e9) return (abs / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (abs / 1e3).toFixed(1) + 'k';
    return Math.round(abs).toLocaleString('vi-VN');
  }

  // ============================================================
  //   HEATMAP — ĐIỀU HƯỚNG THÁNG (xem lại tháng quá khứ)
  //   ------------------------------------------------------------
  //   Heatmap, bảng giao dịch và các thẻ tổng kết cùng dùng chung
  //   _currentMonth, nên đổi tháng ở đâu thì tất cả đều đổi theo.
  //   Mọi cách đổi tháng đều đi qua _goToMonth().
  // ============================================================

  var _heatmapPickerYear = null;   // năm đang hiển thị trong bộ chọn
  var _heatmapLastKey = null;      // YYYYMM của lần render trước (để biết có đổi tháng không)
  var _heatmapNavDir = 0;          // +1 tiến / -1 lùi (hướng hiệu ứng trượt)
  var _boundHeatmapPickerOutside = null;

  function _heatmapMonthNames(short) {
    if (_getCFLang() === 'vi') {
      return short
        ? ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']
        : ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    }
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  }

  /** Chuyển tới một tháng bất kỳ (tự chuẩn hóa tháng 0 / 13...). */
  function _goToMonth(year, month) {
    var d = new Date(year, month - 1, 1);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    if (y === _currentMonth.year && m === _currentMonth.month) return;

    _heatmapNavDir = (y * 12 + m) > (_currentMonth.year * 12 + _currentMonth.month) ? 1 : -1;

    // Bộ lọc "đúng 1 ngày" do click ô heatmap tạo ra sẽ vô nghĩa ở tháng khác → bỏ
    var df = _txTableState.date;
    if (df.from !== null && df.from === df.to) { df.from = null; df.to = null; }

    _currentMonth.year = y;
    _currentMonth.month = m;
    _renderAllViews();
  }

  /** Tiến / lùi n tháng so với tháng đang xem. */
  function _shiftMonth(delta) {
    _goToMonth(_currentMonth.year, _currentMonth.month + delta);
  }

  /** Đồng bộ trạng thái nút: hiện "Tháng này" khi đang xem tháng khác. */
  function _syncHeatmapNav() {
    var todayBtn = _qs('#hub-cf-heatmap-today');
    if (todayBtn) {
      var now = _currentYearMonth();
      todayBtn.hidden = (now.year === _currentMonth.year && now.month === _currentMonth.month);
      todayBtn.textContent = _t('heatmapThisMonth');
    }
    var prev = _qs('#hub-cf-heatmap-prev');
    var next = _qs('#hub-cf-heatmap-next');
    var pick = _qs('#hub-cf-heatmap-month-btn');
    if (prev) { prev.title = _t('heatmapPrevMonth'); prev.setAttribute('aria-label', _t('heatmapPrevMonth')); }
    if (next) { next.title = _t('heatmapNextMonth'); next.setAttribute('aria-label', _t('heatmapNextMonth')); }
    if (pick) { pick.title = _t('heatmapPickMonth'); }

    var picker = _qs('#hub-cf-heatmap-picker');
    if (picker && !picker.hidden) _renderHeatmapPicker();
  }

  /** Vẽ bộ chọn tháng: lưới 12 tháng + bước chuyển năm. */
  function _renderHeatmapPicker() {
    var picker = _qs('#hub-cf-heatmap-picker');
    if (!picker) return;

    var year = _heatmapPickerYear !== null ? _heatmapPickerYear : _currentMonth.year;
    var now = _currentYearMonth();
    var names = _heatmapMonthNames(true);

    // Tháng nào trong năm này có chi tiêu → chấm nhỏ
    var hasData = {};
    ((_data && _data.transactions) || []).forEach(function (tx) {
      if (tx.type === 'expense' && tx.year === year) hasData[tx.month] = true;
    });

    var html = '';
    html += '<div class="hub-cf-heatmap-picker-year">';
    html +=   '<button type="button" class="hub-cf-heatmap-nav-btn" data-year-step="-1" aria-label="' + _escHtml(_t('heatmapPrevYear')) + '" title="' + _escHtml(_t('heatmapPrevYear')) + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg></button>';
    html +=   '<span class="hub-cf-heatmap-picker-year-label">' + year + '</span>';
    html +=   '<button type="button" class="hub-cf-heatmap-nav-btn" data-year-step="1" aria-label="' + _escHtml(_t('heatmapNextYear')) + '" title="' + _escHtml(_t('heatmapNextYear')) + '">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg></button>';
    html += '</div>';

    html += '<div class="hub-cf-heatmap-picker-grid" role="group">';
    for (var m = 1; m <= 12; m++) {
      var cls = 'hub-cf-heatmap-picker-month';
      var selected = (year === _currentMonth.year && m === _currentMonth.month);
      if (selected) cls += ' is-selected';
      if (year === now.year && m === now.month) cls += ' is-now';
      if (hasData[m]) cls += ' has-data';
      html += '<button type="button" class="' + cls + '" data-month="' + m + '" aria-pressed="' + selected + '">' + names[m - 1] + '</button>';
    }
    html += '</div>';

    html += '<div class="hub-cf-heatmap-picker-legend"><span class="hub-cf-heatmap-picker-dot" aria-hidden="true"></span>' +
              _escHtml(_t('heatmapHasData')) + '</div>';

    picker.innerHTML = html;
  }

  function _openHeatmapPicker() {
    var picker = _qs('#hub-cf-heatmap-picker');
    var btn = _qs('#hub-cf-heatmap-month-btn');
    if (!picker || !btn) return;
    _hideHeatmapTooltip();
    _heatmapPickerYear = _currentMonth.year;
    _renderHeatmapPicker();
    picker.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }

  function _closeHeatmapPicker(refocus) {
    var picker = document.getElementById('hub-cf-heatmap-picker');
    if (!picker || picker.hidden) return;
    picker.hidden = true;
    var btn = document.getElementById('hub-cf-heatmap-month-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) btn.focus();
    }
  }

  /** Gắn sự kiện cho cụm điều hướng trong header heatmap. */
  function _bindHeatmapNav() {
    var prev = _qs('#hub-cf-heatmap-prev');
    var next = _qs('#hub-cf-heatmap-next');
    var pick = _qs('#hub-cf-heatmap-month-btn');
    var today = _qs('#hub-cf-heatmap-today');
    var picker = _qs('#hub-cf-heatmap-picker');

    if (prev) prev.addEventListener('click', function () { _shiftMonth(-1); });
    if (next) next.addEventListener('click', function () { _shiftMonth(1); });

    if (today) {
      today.addEventListener('click', function () {
        var now = _currentYearMonth();
        _goToMonth(now.year, now.month);
        _closeHeatmapPicker();
      });
    }

    if (pick && picker) {
      pick.addEventListener('click', function () {
        if (picker.hidden) _openHeatmapPicker(); else _closeHeatmapPicker();
      });

      // Ủy quyền sự kiện cho các nút bên trong bộ chọn (nội dung được vẽ lại liên tục)
      picker.addEventListener('click', function (e) {
        var stepBtn = e.target.closest('[data-year-step]');
        if (stepBtn) {
          _heatmapPickerYear = (_heatmapPickerYear !== null ? _heatmapPickerYear : _currentMonth.year) +
                               parseInt(stepBtn.getAttribute('data-year-step'), 10);
          _renderHeatmapPicker();
          return;
        }
        var monthBtn = e.target.closest('[data-month]');
        if (monthBtn) {
          var y = _heatmapPickerYear !== null ? _heatmapPickerYear : _currentMonth.year;
          _goToMonth(y, parseInt(monthBtn.getAttribute('data-month'), 10));
          _closeHeatmapPicker(true);
        }
      });
    }

    // Bấm ra ngoài thì đóng bộ chọn (listener toàn cục: gỡ bản cũ trước khi gắn bản mới)
    if (_boundHeatmapPickerOutside) {
      document.removeEventListener('pointerdown', _boundHeatmapPickerOutside);
    }
    _boundHeatmapPickerOutside = function (e) {
      var pk = document.getElementById('hub-cf-heatmap-picker');
      if (!pk || pk.hidden) return;
      var btn = document.getElementById('hub-cf-heatmap-month-btn');
      if (pk.contains(e.target) || (btn && btn.contains(e.target))) return;
      _closeHeatmapPicker();
    };
    document.addEventListener('pointerdown', _boundHeatmapPickerOutside);
  }

  /**
   * Initialize heatmap view toggle
   */
  function _initHeatmapToggle() {
    const chartView = _qs('#hub-cf-chart-view');
    const heatmapView = _qs('#hub-cf-heatmap-view');
    const toggleBtns = _qsAll('.hub-cf-view-toggle-btn');

    if (!chartView || !heatmapView || !toggleBtns.length) return;

    toggleBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const view = this.dataset.view;
        if (view === _heatmapView) return;

        _heatmapView = view;

        // Update toggle buttons
        toggleBtns.forEach(b => {
          const isActive = b.dataset.view === view;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-pressed', isActive);
        });

        // Show/hide views
        chartView.style.display = view === 'chart' ? 'block' : 'none';
        heatmapView.style.display = view === 'heatmap' ? 'block' : 'none';
        _hideHeatmapTooltip();

        // Render heatmap if switching to it
        if (view === 'heatmap') {
          _renderHeatmap();
        } else {
          _updateChart();
        }
      });
    });

    // Month navigation + month picker inside the heatmap header
    _bindHeatmapNav();

    // Initialize daily limit editor
    const editLimitBtn = _qs('#hub-cf-heatmap-limit-pill');
    if (editLimitBtn) {
      editLimitBtn.addEventListener('click', _setDailyLimit);
      editLimitBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _setDailyLimit();
        }
      });
    }
  }

  /**
   * Render the cyberpunk heatmap for the current month
   */
  function _renderHeatmap() {
    const grid = _qs('#hub-cf-heatmap-grid');
    const monthLabel = _qs('#hub-cf-heatmap-month-label');
    const limitValue = _qs('#hub-cf-heatmap-limit-value');

    if (!grid || !monthLabel || !limitValue) return;

    // Get current month/year
    const year = _currentMonth.year;
    const month = _currentMonth.month; // 1-12

    // Update month label
    const months = _heatmapMonthNames(false);
    monthLabel.textContent = `${months[month - 1]} ${year}`;
    _syncHeatmapNav();

    // Get daily limit for this month
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const dailyLimit = _cashFlowMeta.dailyLimits && _cashFlowMeta.dailyLimits[monthKey]
      ? _cashFlowMeta.dailyLimits[monthKey]
      : 500000; // Default 500k VND

    limitValue.textContent = _formatCompactVND(dailyLimit);

    // Get expense data for each day of the month
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 = Sunday

    // Calculate daily expenses
    const dailyExpenses = {};
    const dailyTopCategories = {};

    const monthTxs = _getMonthTransactions(year, month);
    monthTxs.forEach(tx => {
      if (tx.type !== 'expense') return;
      const day = tx.day;
      if (!dailyExpenses[day]) dailyExpenses[day] = 0;
      dailyExpenses[day] += tx.amount || 0;

      // Track top category per day
      if (!dailyTopCategories[day]) dailyTopCategories[day] = {};
      const cat = tx.category;
      dailyTopCategories[day][cat] = (dailyTopCategories[day][cat] || 0) + (tx.amount || 0);
    });

    // Find top category for each day
    const dayTopCategory = {};
    Object.keys(dailyTopCategories).forEach(day => {
      const cats = dailyTopCategories[day];
      let topCat = null, topAmt = 0;
      Object.entries(cats).forEach(([catId, amt]) => {
        if (amt > topAmt) { topAmt = amt; topCat = catId; }
      });
      if (topCat) dayTopCategory[day] = { id: topCat, amount: topAmt };
    });

    // Build heatmap grid
    let html = '';

    // Day headers (Mon-Sun)
    const dayHeaders = _getCFLang() === 'vi'
      ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    html += '<div class="hub-cf-heatmap-day-headers">';
    dayHeaders.forEach(d => {
      html += `<div class="hub-cf-heatmap-day-header">${d}</div>`;
    });
    html += '</div>';

    html += '<div class="hub-cf-heatmap-cells" role="grid">';

    // Empty cells before first day (adjust for Monday start)
    const mondayStart = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
    for (let i = 0; i < mondayStart; i++) {
      html += '<div class="hub-cf-heatmap-cell hub-cf-heatmap-cell--empty" aria-hidden="true"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const spent = dailyExpenses[day] || 0;
      const ratio = dailyLimit > 0 ? spent / dailyLimit : 0;
      let level = 0;

      if (spent === 0) level = 0;
      else if (ratio < 0.5) level = 1;
      else if (ratio < 1.0) level = 2;
      else level = 3;

      const topCat = dayTopCategory[day];
      const topCatName = topCat ? _categoryDisplayName(topCat.id, 'expense') : '';
      const topCatAmt = topCat ? _formatCompactVND(topCat.amount) : '';

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === _todayISO();

      html += `<div class="hub-cf-heatmap-cell hub-cf-heatmap-cell--level-${level} ${isToday ? 'hub-cf-heatmap-cell--today' : ''}"
                  data-day="${day}"
                  data-date="${dateStr}"
                  data-spent="${spent}"
                  data-limit="${dailyLimit}"
                  data-level="${level}"
                  data-top-category="${_escHtml(topCatName)}"
                  data-top-category-amt="${_escHtml(topCatAmt)}"
                  role="gridcell"
                  tabindex="0"
                  aria-label="${_escHtml(`${day}/${month}: ${_formatVND(spent)} spent`)}">`;
      html += `<span class="hub-cf-heatmap-cell-day">${day}</span>`;
      if (spent > 0) {
        html += `<span class="hub-cf-heatmap-cell-amount">${_formatCompactVND(spent)}</span>`;
      }
      html += '</div>';
    }

    html += '</div>';
    grid.innerHTML = html;

    // Hiệu ứng trượt nhẹ khi đổi tháng (trượt theo hướng đang điều hướng)
    var monthKey2 = year * 100 + month;
    if (_heatmapLastKey !== null && _heatmapLastKey !== monthKey2 && _heatmapNavDir) {
      grid.setAttribute('data-dir', _heatmapNavDir > 0 ? 'next' : 'prev');
      grid.classList.remove('is-switching');
      void grid.offsetWidth; // restart animation
      grid.classList.add('is-switching');
    }
    _heatmapLastKey = monthKey2;
    _heatmapNavDir = 0;

    // Bind click events for filtering
    _bindHeatmapCellEvents();

    // Bind hover events for tooltip
    _bindHeatmapTooltipEvents();
  }

  /**
   * Bind click events on heatmap cells to filter ledger
   */
  function _bindHeatmapCellEvents() {
    const cells = _qsAll('.hub-cf-heatmap-cell:not(.hub-cf-heatmap-cell--empty)');
    cells.forEach(cell => {
      cell.addEventListener('click', function() {
        const day = parseInt(this.dataset.day, 10);
        if (!day) return;

        // Update filter state
        _txTableState.date.from = day;
        _txTableState.date.to = day;

        // Visual feedback
        cells.forEach(c => c.classList.remove('hub-cf-heatmap-cell--selected'));
        this.classList.add('hub-cf-heatmap-cell--selected');

        // Refresh ledger
        _refreshTransactions();

        // Scroll to ledger
        const ledger = _qs('.hub-cf-ledger');
        if (ledger) ledger.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      // Keyboard support
      cell.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });
  }

  // ============================================================
  //   HEATMAP TOOLTIP ("Note" khi di chuột vào ô ngày)
  //   ------------------------------------------------------------
  //   - Gắn thẳng vào <body> + position: fixed  →  không bị ảnh hưởng
  //     bởi transform / backdrop-filter của .glass-card phía trên.
  //   - Luôn hiện TRÊN ô ngày, căn giữa theo ô. Tự lật xuống dưới nếu
  //     sát mép trên, tự dịch ngang nếu sát mép trái/phải màn hình.
  //   - Style nằm hoàn toàn trong styles.css (khối "HEATMAP TOOLTIP").
  // ============================================================

  var HEATMAP_TOOLTIP_ID = 'hub-cf-heatmap-tooltip';
  var _heatmapTooltipCell = null;          // ô đang được hiển thị tooltip
  var _heatmapTooltipGlobalBound = false;  // listener toàn cục chỉ bind 1 lần

  /** Lấy (hoặc tạo mới) phần tử tooltip trên <body>. */
  function _getHeatmapTooltip() {
    var el = document.getElementById(HEATMAP_TOOLTIP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = HEATMAP_TOOLTIP_ID;
      el.className = 'hub-cf-heatmap-tooltip';
      el.setAttribute('role', 'tooltip');
      el.setAttribute('data-placement', 'top');
      el.setAttribute('data-level', '0');
      document.body.appendChild(el);
    }
    return el;
  }

  /** Ẩn tooltip (giữ lại phần tử để lần sau dùng lại). */
  function _hideHeatmapTooltip() {
    var tooltip = document.getElementById(HEATMAP_TOOLTIP_ID);
    if (tooltip) tooltip.classList.remove('hub-cf-heatmap-tooltip--visible');
    if (_heatmapTooltipCell) {
      _heatmapTooltipCell.removeAttribute('aria-describedby');
      _heatmapTooltipCell = null;
    }
  }

  /** Gỡ hẳn tooltip khỏi DOM (gọi khi rời module CashFlow). */
  function _removeHeatmapTooltip() {
    _hideHeatmapTooltip();
    var tooltip = document.getElementById(HEATMAP_TOOLTIP_ID);
    if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
  }

  /** Dựng nội dung tooltip từ data-* của ô ngày. */
  function _buildHeatmapTooltipHTML(cell) {
    var spent     = parseInt(cell.dataset.spent, 10) || 0;
    var level     = parseInt(cell.dataset.level, 10) || 0;
    var topCat    = cell.dataset.topCategory || '';
    var topCatAmt = cell.dataset.topCategoryAmt || '';
    var lang      = _getCFLang();

    var dateObj = new Date(cell.dataset.date + 'T00:00:00');
    var formattedDate = dateObj.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    var html = '';
    html += '<div class="hub-cf-heatmap-tooltip-head">';
    html +=   '<span class="hub-cf-heatmap-tooltip-date">' + _escHtml(formattedDate) + '</span>';
    html +=   '<span class="hub-cf-heatmap-tooltip-badge">' + _escHtml(_t('heatmapLevel' + level)) + '</span>';
    html += '</div>';
    html += '<div class="hub-cf-heatmap-tooltip-body">';

    if (spent > 0) {
      html += '<div class="hub-cf-heatmap-tooltip-row">';
      html +=   '<span class="hub-cf-heatmap-tooltip-label">' + _escHtml(_t('heatmapTotalSpent')) + '</span>';
      html +=   '<strong class="hub-cf-heatmap-tooltip-value hub-cf-heatmap-tooltip-value--amount">' + _escHtml(_formatVND(spent)) + '</strong>';
      html += '</div>';

      if (topCat) {
        html += '<div class="hub-cf-heatmap-tooltip-row">';
        html +=   '<span class="hub-cf-heatmap-tooltip-label">' + _escHtml(_t('heatmapTopCategory')) + '</span>';
        html +=   '<span class="hub-cf-heatmap-tooltip-value">' + _escHtml(topCat) +
                    (topCatAmt ? '<small>(' + _escHtml(topCatAmt) + ')</small>' : '') + '</span>';
        html += '</div>';
      }
    } else {
      html += '<div class="hub-cf-heatmap-tooltip-empty">' + _escHtml(_t('heatmapNoExpense')) + '</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Đặt tooltip nằm TRÊN ô ngày (tọa độ viewport, vì tooltip là position: fixed).
   * Lật xuống dưới nếu phía trên không đủ chỗ; kẹp ngang trong màn hình;
   * mũi tên luôn chỉ đúng vào tâm ô dù tooltip bị dịch.
   */
  function _positionHeatmapTooltip(tooltip, cell) {
    var GAP       = 10;  // khoảng cách ô ↔ tooltip (đã tính phần mũi tên)
    var MARGIN    = 8;   // cách mép màn hình tối thiểu
    var ARROW_PAD = 14;  // mũi tên không sát góc bo tròn

    // Đưa về góc (0,0) trước khi đo: phần tử fixed có left lớn sẽ bị co chiều rộng
    tooltip.style.left = '0px';
    tooltip.style.top  = '0px';

    var cellRect = cell.getBoundingClientRect();
    var tipW = tooltip.offsetWidth;
    var tipH = tooltip.offsetHeight;
    var vw   = document.documentElement.clientWidth;

    // Ngang: căn giữa theo ô, kẹp trong màn hình
    var centerX = cellRect.left + cellRect.width / 2;
    var left = Math.max(MARGIN, Math.min(centerX - tipW / 2, vw - tipW - MARGIN));

    // Dọc: mặc định phía trên ô; thiếu chỗ thì lật xuống dưới
    var placement = 'top';
    var top = cellRect.top - tipH - GAP;
    if (top < MARGIN) {
      placement = 'bottom';
      top = cellRect.bottom + GAP;
    }

    // Mũi tên: trỏ vào tâm ô, nhưng không vượt ra ngoài góc bo của tooltip
    var arrowX = Math.max(ARROW_PAD, Math.min(centerX - left, tipW - ARROW_PAD));

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top  = Math.round(top) + 'px';
    tooltip.style.setProperty('--tt-arrow-x', Math.round(arrowX) + 'px');
    tooltip.setAttribute('data-placement', placement);
  }

  /** Hiện tooltip cho một ô ngày. */
  function _showHeatmapTooltip(cell) {
    if (!cell || !cell.dataset.day) return;

    var tooltip = _getHeatmapTooltip();

    if (_heatmapTooltipCell && _heatmapTooltipCell !== cell) {
      _heatmapTooltipCell.removeAttribute('aria-describedby');
    }
    _heatmapTooltipCell = cell;

    tooltip.setAttribute('data-level', String(parseInt(cell.dataset.level, 10) || 0));
    tooltip.innerHTML = _buildHeatmapTooltipHTML(cell);
    _positionHeatmapTooltip(tooltip, cell);

    cell.setAttribute('aria-describedby', HEATMAP_TOOLTIP_ID);
    tooltip.classList.add('hub-cf-heatmap-tooltip--visible');
  }

  /** Listener toàn cục (bind 1 lần): tọa độ fixed sẽ cũ khi cuộn / đổi cỡ cửa sổ → ẩn đi. */
  function _bindHeatmapTooltipGlobalListeners() {
    if (_heatmapTooltipGlobalBound) return;
    _heatmapTooltipGlobalBound = true;

    window.addEventListener('scroll', _hideHeatmapTooltip, { passive: true, capture: true });
    window.addEventListener('resize', _hideHeatmapTooltip);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') _hideHeatmapTooltip();
    });
  }

  /**
   * Gắn sự kiện hover / focus cho các ô ngày của heatmap.
   * Được gọi sau mỗi lần _renderHeatmap() (ô cũ đã bị thay bằng ô mới).
   */
  function _bindHeatmapTooltipEvents() {
    // Grid vừa được render lại → ô đang hover (nếu có) đã bị gỡ khỏi DOM
    _hideHeatmapTooltip();
    _bindHeatmapTooltipGlobalListeners();

    _qsAll('.hub-cf-heatmap-cell:not(.hub-cf-heatmap-cell--empty)').forEach(function (cell) {
      cell.addEventListener('mouseenter', function () { _showHeatmapTooltip(this); });
      cell.addEventListener('mouseleave', _hideHeatmapTooltip);
      // Hỗ trợ bàn phím (ô có tabindex="0")
      cell.addEventListener('focus', function () { _showHeatmapTooltip(this); });
      cell.addEventListener('blur', _hideHeatmapTooltip);
    });
  }

  /**
   * Prompt user to set daily expense limit for current month
   */
  function _setDailyLimit() {
    const lang = _getCFLang();
    const monthKey = `${_currentMonth.year}-${String(_currentMonth.month).padStart(2, '0')}`;
    const currentLimit = _cashFlowMeta.dailyLimits && _cashFlowMeta.dailyLimits[monthKey]
      ? _cashFlowMeta.dailyLimits[monthKey]
      : 500000;

    const promptMsg = lang === 'vi'
      ? `Nhập hạn mức chi tiêu mỗi ngày cho ${_currentMonth.month}/${_currentMonth.year} (VND):`
      : `Set daily expense limit for ${_currentMonth.month}/${_currentMonth.year} (VND):`;

    const currentVal = currentLimit.toLocaleString('vi-VN');
    const raw = prompt(promptMsg, currentVal);

    if (raw === null) return; // User cancelled

    const clean = String(raw).replace(/[\s,.]/g, '');
    const newLimit = parseInt(clean, 10);

    if (isNaN(newLimit) || newLimit < 0) {
      _showToast(lang === 'vi' ? '❌ Số tiền không hợp lệ' : '❌ Invalid amount');
      return;
    }

    // Initialize dailyLimits object if needed
    if (!_cashFlowMeta.dailyLimits) {
      _cashFlowMeta.dailyLimits = {};
    }

    _cashFlowMeta.dailyLimits[monthKey] = newLimit;

    // Persist
    _debouncedPersistMeta();

    // Re-render heatmap
    _renderHeatmap();

    _showToast(lang === 'vi'
      ? `✅ Hạn mức hàng ngày: ${_formatVND(newLimit)}`
      : `✅ Daily limit: ${_formatVND(newLimit)}`);
  }

  /**
   * Re-render heatmap when month changes (call from month nav handlers)
   */
  function _refreshHeatmap() {
    if (_heatmapView === 'heatmap') {
      _renderHeatmap();
    } else {
      _heatmapNavDir = 0; // heatmap đang ẩn → không giữ hướng trượt cũ
    }
  }

  // ============================================================
  //   AI FINANCIAL ADVISOR v2
  //   ① Kế hoạch chi tiêu — tính ngay tại máy (tức thì, số liệu chính xác)
  //   ② Hỏi đáp AI — có trí nhớ hội thoại + ngữ cảnh tài chính đầy đủ
  // ============================================================

  var AI_ADDRESS = 'Thiếu gia';                 // Cách AI xưng hô với bạn — đổi tại đây
  var AI_HISTORY_TURNS = 8;                     // Số tin nhắn gần nhất gửi kèm làm "trí nhớ"
  var AI_MAX_STORED = 60;                       // Số tin nhắn tối đa lưu lại
  var AI_TARGET_RATE_KEY = 'hub_cf_ai_target_rate';
  var AI_DEFAULT_TARGET_RATE = 20;              // Mục tiêu tiết kiệm mặc định (% thu nhập)

  // Nhóm hạng mục theo quy tắc 50/30/20 (mục tiêu Needs/Wants tự co giãn theo % tiết kiệm)
  var AI_BUCKETS = {
    needs:  { label: 'Thiết yếu',               cats: ['nha-o', 'an-uong', 'di-chuyen', 'tieu-dung-thiet-yeu'] },
    wants:  { label: 'Mong muốn',               cats: ['tieu-dung-khac', 'doodad', 'cho-di', 'chi-phi-khac'] },
    growth: { label: 'Tiết kiệm & phát triển',  cats: ['tiet-kiem', 'phat-trien-ban-than'] }
  };

  var AI_PROMPTS = {
    summary:  'Tóm tắt thu chi tháng này và chỉ ra điều đáng chú ý nhất.',
    plan:     'Hãy lập kế hoạch chi tiêu chi tiết cho tháng sau dựa trên dữ liệu thu chi của tôi: ngân sách từng hạng mục, quy tắc chi tiêu và việc cần làm trong 7 ngày đầu.',
    cut:      'Tôi nên cắt giảm những khoản nào để đạt mục tiêu tiết kiệm? Cho tôi số tiền cụ thể cho từng khoản.',
    forecast: 'Dự báo chi tiêu và số tiền để dành được đến cuối tháng này, và cho tôi biết cần điều chỉnh gì.',
    cash:     'Phân tích dòng tiền mặt và ngân hàng của tôi. Tôi nên giữ bao nhiêu tiền mặt?',
    savings:  'Tôi đang có một khoản tiền tiết kiệm. Tôi nên làm gì để nó phát huy hiệu quả và không bị tiêu hao dần?'
  };

  var AI_STATUS_STEPS = ['Đọc dữ liệu giao dịch…', 'Đối chiếu với ngân sách…', 'Soạn khuyến nghị…'];

  var AI_ICON = {
    spark:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    user:    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    send:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
    stop:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    plus:    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    key:     '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/></svg>',
    copy:    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    plan:    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    chat:    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12z"/></svg>',
    info:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    ok:      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>',
    warn:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
    danger:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/></svg>'
  };

  // ─────────────────────────────────────────────────────────────
  //  Tiện ích nhỏ
  // ─────────────────────────────────────────────────────────────

  function _aiGetTargetRate() {
    try {
      var v = parseInt(localStorage.getItem(AI_TARGET_RATE_KEY), 10);
      if (v >= 5 && v <= 80) return v;
    } catch (_) {}
    return AI_DEFAULT_TARGET_RATE;
  }

  function _aiSetTargetRate(v) {
    try { localStorage.setItem(AI_TARGET_RATE_KEY, String(v)); } catch (_) {}
  }

  function _aiShiftMonth(ym, delta) {
    var d = new Date(ym.year, ym.month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function _aiClamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function _aiTime(ts) {
    try {
      return new Date(ts || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  /** Tổng hợp một tháng: thu nhập thật (không tính rút tiết kiệm), chi tiêu thật (không tính chuyển vào tiết kiệm). */
  function _aiMonthAgg(year, month) {
    var txs = _getMonthTransactions(year, month);
    var agg = { income: 0, spent: 0, saved: 0, byCat: {}, count: txs.length };
    txs.forEach(function (tx) {
      var amt = Number(tx.amount) || 0;
      if (tx.type === 'income') {
        if (tx.category !== 'tiet-kiem') agg.income += amt;
      } else if (tx.category === 'tiet-kiem') {
        agg.saved += amt;
      } else {
        agg.spent += amt;
        agg.byCat[tx.category] = (agg.byCat[tx.category] || 0) + amt;
      }
    });
    return agg;
  }

  // ─────────────────────────────────────────────────────────────
  //  ENGINE: Kế hoạch chi tiêu (không cần AI)
  // ─────────────────────────────────────────────────────────────

  function _computeSpendingPlan() {
    if (!_data || !_data.transactions) return null;

    var ym = _currentMonth || _currentYearMonth();
    var now = new Date();
    var nowIdx = now.getFullYear() * 12 + now.getMonth();
    var viewIdx = ym.year * 12 + (ym.month - 1);
    var isCurrent = viewIdx === nowIdx;
    var isFuture = viewIdx > nowIdx;
    var daysInMonth = new Date(ym.year, ym.month, 0).getDate();
    var daysElapsed = isCurrent ? now.getDate() : (isFuture ? 0 : daysInMonth);
    var remainingDays = isCurrent ? (daysInMonth - now.getDate() + 1) : 0; // gồm cả hôm nay

    var cur = _aiMonthAgg(ym.year, ym.month);
    var prev = _aiMonthAgg(_aiShiftMonth(ym, -1).year, _aiShiftMonth(ym, -1).month);

    // Thu nhập nền: tháng này nếu đã có, nếu chưa → trung bình 3 tháng gần nhất có thu nhập
    var hist = [1, 2, 3].map(function (k) {
      var s = _aiShiftMonth(ym, -k);
      return _aiMonthAgg(s.year, s.month).income;
    }).filter(function (v) { return v > 0; });
    var avgIncome = hist.length ? hist.reduce(function (a, b) { return a + b; }, 0) / hist.length : 0;
    var incomeIsEstimate = cur.income <= 0 && avgIncome > 0;
    var incomeBase = cur.income > 0 ? cur.income : avgIncome;

    var targetRate = _aiGetTargetRate();
    var spendCap = incomeBase * (1 - targetRate / 100);
    var remaining = spendCap - cur.spent;
    var safePerDay = remainingDays > 0 ? Math.max(0, remaining) / remainingDays : 0;
    // Dự báo: khoản cố định (nhà ở) trả một lần nên không nhân theo ngày; phần còn lại ngoại suy theo tốc độ chi/ngày
    var fixedSpent = cur.byCat['nha-o'] || 0;
    var burn = daysElapsed > 0 ? (cur.spent - fixedSpent) / daysElapsed : 0;
    var projectedSpend = isCurrent ? cur.spent + burn * (daysInMonth - daysElapsed) : cur.spent;
    var projectedSavings = incomeBase - projectedSpend;
    var savingsRate = cur.income > 0 ? ((cur.income - cur.spent) / cur.income) * 100 : null;

    // Phân bổ 50/30/20 (Needs/Wants co giãn theo mục tiêu tiết kiệm, tỷ lệ 5:3)
    var rest = 100 - targetRate;
    var needsTarget = Math.round(rest * 0.625);
    var targets = { needs: needsTarget, wants: rest - needsTarget, growth: targetRate };
    var buckets = {};
    ['needs', 'wants'].forEach(function (k) {
      var amt = 0;
      AI_BUCKETS[k].cats.forEach(function (c) { amt += cur.byCat[c] || 0; });
      buckets[k] = { label: AI_BUCKETS[k].label, amount: amt, pct: incomeBase > 0 ? (amt / incomeBase) * 100 : null, target: targets[k] };
    });
    var growthPct = incomeBase > 0 ? _aiClamp(100 - buckets.needs.pct - buckets.wants.pct, 0, 100) : null;
    buckets.growth = {
      label: AI_BUCKETS.growth.label,
      amount: incomeBase > 0 ? Math.max(0, incomeBase - buckets.needs.amount - buckets.wants.amount) : 0,
      pct: growthPct, target: targets.growth
    };

    // Hạng mục chi (so sánh tháng trước + ngân sách)
    var budgets = _cashFlowMeta.budgets || {};
    var catIds = Object.keys(cur.byCat);
    var cats = catIds.map(function (id) {
      var amt = cur.byCat[id];
      var pv = prev.byCat[id] || 0;
      var limit = Number(budgets[id]) || 0;
      var budgetPct = limit > 0 ? (amt / limit) * 100 : null;
      return {
        id: id,
        name: _categoryDisplayName(id, 'expense'),
        amount: amt,
        share: cur.spent > 0 ? (amt / cur.spent) * 100 : 0,
        prev: pv,
        delta: pv > 0 ? ((amt - pv) / pv) * 100 : null,
        limit: limit,
        budgetPct: budgetPct,
        status: budgetPct === null ? 'none' : (budgetPct > 100 ? 'over' : (budgetPct >= 85 ? 'warn' : 'ok'))
      };
    }).sort(function (a, b) { return b.amount - a.amount; });

    // Nợ cần thu hồi
    var activeDebts = [];
    try { activeDebts = _getActiveDebts(); } catch (_) {}
    var debtList = activeDebts.map(function (d) {
      return {
        debtor: d.debtorName || '',
        amount: Number(d.amount) || 0,
        due: d.expectedReturnDate || '',
        overdue: _getDebtStatus(d) === 'overdue'
      };
    });

    var monthKey = ym.year + '-' + String(ym.month).padStart(2, '0');
    var dailyLimit = (_cashFlowMeta.dailyLimits && _cashFlowMeta.dailyLimits[monthKey]) || 500000;

    return {
      ym: ym, isCurrent: isCurrent, isFuture: isFuture,
      daysInMonth: daysInMonth, daysElapsed: daysElapsed, remainingDays: remainingDays,
      cur: cur, prev: prev,
      incomeBase: incomeBase, incomeIsEstimate: incomeIsEstimate,
      targetRate: targetRate, spendCap: spendCap, remaining: remaining,
      safePerDay: safePerDay, burn: burn,
      projectedSpend: projectedSpend, projectedSavings: projectedSavings,
      savingsRate: savingsRate,
      timePct: daysInMonth > 0 ? (daysElapsed / daysInMonth) * 100 : 0,
      usedPct: spendCap > 0 ? (cur.spent / spendCap) * 100 : 0,
      buckets: buckets, cats: cats,
      debts: { list: debtList, total: debtList.reduce(function (s, d) { return s + d.amount; }, 0), overdue: debtList.filter(function (d) { return d.overdue; }).length },
      balances: { cash: _calcCashBalance(), bank: _calcBankBalance(), savings: _cashFlowMeta.savingsBalance || 0, netWorth: _computeLiveNetWorth() },
      dailyLimit: dailyLimit
    };
  }

  /** Rule-based: các hành động nên làm, xếp theo mức khẩn cấp */
  function _aiBuildActions(p) {
    var A = [];
    var F = _formatVNFull;

    if (!p || (p.cur.count === 0 && p.incomeBase <= 0)) {
      return [{ level: 'info', title: 'Chưa có dữ liệu để lập kế hoạch', body: 'Hãy ghi lại thu nhập và vài khoản chi, mình sẽ tính cần chi và nhắc bạn mỗi ngày.' }];
    }

    if (p.incomeBase <= 0) {
      A.push({ level: 'warn', title: 'Chưa ghi nhận thu nhập', body: 'Thêm thu nhập của tháng này để mình tính cần chi và mục tiêu tiết kiệm.' });
    } else if (p.isCurrent) {
      if (p.remaining < 0) {
        A.push({ level: 'danger', title: 'Đã vượt cần chi ' + F(-p.remaining), body: 'Để giữ mục tiêu tiết kiệm ' + p.targetRate + '%, hãy tạm dừng các khoản "mong muốn" trong ' + p.remainingDays + ' ngày còn lại.', prompt: 'Tôi đã vượt cần chi tháng này. Hãy đưa ra phương án cứu vãn cụ thể cho những ngày còn lại.' });
      } else if (p.projectedSpend > p.spendCap) {
        A.push({ level: 'warn', title: 'Đang chi nhanh hơn kế hoạch', body: 'Tốc độ chi (không tính nhà ở) ≈ ' + F(p.burn) + '/ngày, dự báo chạm ' + F(p.projectedSpend) + ' (cần ' + F(p.spendCap) + '). Giữ dưới ' + F(p.safePerDay) + '/ngày để về đích.', prompt: AI_PROMPTS.forecast });
      } else {
        A.push({ level: 'ok', title: 'Đang đi đúng kế hoạch', body: 'Còn ' + F(p.remaining) + ' trong cần chi — khoảng ' + F(p.safePerDay) + '/ngày cho ' + p.remainingDays + ' ngày còn lại.' });
      }
    } else if (p.savingsRate !== null) {
      if (p.savingsRate >= p.targetRate) {
        A.push({ level: 'ok', title: 'Tháng này đạt mục tiêu tiết kiệm', body: 'Tỷ lệ để dành ' + p.savingsRate.toFixed(1) + '% so với mục tiêu ' + p.targetRate + '%.' });
      } else {
        A.push({ level: 'warn', title: 'Chưa đạt mục tiêu tiết kiệm', body: 'Tỷ lệ để dành ' + p.savingsRate.toFixed(1) + '% so với mục tiêu ' + p.targetRate + '%.', prompt: AI_PROMPTS.cut });
      }
    }

    // Nhóm "mong muốn" vượt mức khuyến nghị
    var w = p.buckets.wants;
    if (w.pct !== null && w.pct > w.target + 5) {
      var wantCats = p.cats.filter(function (c) { return AI_BUCKETS.wants.cats.indexOf(c.id) !== -1; });
      var big = wantCats[0];
      var tip = big ? ' Thử giảm 15% "' + big.name + '" ≈ ' + F(big.amount * 0.15) + '.' : '';
      A.push({ level: 'warn', title: 'Nhóm "Mong muốn" chiếm ' + w.pct.toFixed(0) + '% thu nhập', body: 'Mức khuyến nghị ≤ ' + w.target + '%.' + tip, prompt: AI_PROMPTS.cut });
    }

    // Hạng mục vượt ngân sách
    p.cats.filter(function (c) { return c.status === 'over'; }).slice(0, 2).forEach(function (c) {
      A.push({ level: 'danger', title: c.name + ' vượt ngân sách ' + Math.round(c.budgetPct - 100) + '%', body: 'Đã chi ' + F(c.amount) + ' / hạn mức ' + F(c.limit) + '.', prompt: 'Tôi đang chi vượt ngân sách cho hạng mục ' + c.name + '. Nên điều chỉnh thế nào?' });
    });

    // Hạng mục tăng mạnh so với tháng trước
    p.cats.filter(function (c) { return c.delta !== null && c.delta >= 30 && c.share >= 8 && c.status !== 'over'; }).slice(0, 1).forEach(function (c) {
      A.push({ level: 'warn', title: c.name + ' tăng ' + Math.round(c.delta) + '% so với tháng trước', body: 'Từ ' + F(c.prev) + ' lên ' + F(c.amount) + '.', prompt: 'Vì sao hạng mục ' + c.name + ' của tôi tăng mạnh so với tháng trước và nên xử lý thế nào?' });
    });

    // Nợ cho mượn
    if (p.debts.total > 0) {
      A.push({
        level: p.debts.overdue > 0 ? 'warn' : 'info',
        title: p.debts.overdue > 0 ? 'Có ' + p.debts.overdue + ' khoản nợ đã quá hạn' : 'Còn ' + F(p.debts.total) + ' chưa thu hồi',
        body: 'Tổng đang cho mượn ' + F(p.debts.total) + '. Thu hồi sớm giúp tăng dòng tiền khả dụng.'
      });
    }

    // Tiền mặt vs ngân hàng
    if (p.balances.cash > 0 && p.balances.bank > 0) {
      if (p.balances.cash > p.balances.bank * 2) {
        A.push({ level: 'info', title: 'Tiền mặt đang nhiều gấp đôi ngân hàng', body: 'Cân nhắc gửi bớt vào tài khoản để an toàn và dễ theo dõi.', prompt: AI_PROMPTS.cash });
      }
    }

    var rank = { danger: 0, warn: 1, info: 2, ok: 3 };
    A.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
    return A.slice(0, 5);
  }

  // ─────────────────────────────────────────────────────────────
  //  Render: Tab "Kế hoạch chi tiêu"
  // ─────────────────────────────────────────────────────────────

  function _aiTone(level) { return 'is-' + level; }

  function _renderSpendingPlan() {
    var root = _qs('#cfx-plan');
    if (!root) return;

    var ym = _currentMonth || _currentYearMonth();
    var periodEl = _qs('#cfx-ai-period');
    if (periodEl) periodEl.textContent = 'Tháng ' + ym.month + '/' + ym.year;

    var p = _computeSpendingPlan();
    if (!p || (p.cur.count === 0 && p.incomeBase <= 0)) {
      root.innerHTML =
        '<div class="cfx-empty-plan">' +
          '<div class="cfx-empty-plan__icon">' + AI_ICON.plan + '</div>' +
          '<strong>Chưa có dữ liệu cho tháng ' + ym.month + '/' + ym.year + '</strong>' +
          '<p>Hãy ghi lại thu nhập và vài khoản chi. Kế hoạch chi tiêu sẽ tự động xuất hiện ở đây.</p>' +
        '</div>';
      _generateAIInsight();
      return;
    }

    var F = _formatVNFull;
    var e = _escHtml;

    // ── Hero: tiến độ chi tiêu so với cần chi ──
    var heroTone = p.usedPct > 100 ? 'danger' : ((p.isCurrent && p.usedPct > p.timePct + 10) ? 'warn' : 'ok');
    var fillW = _aiClamp(p.usedPct, 0, 100).toFixed(1);
    var tickW = _aiClamp(p.timePct, 0, 100).toFixed(1);
    var segBtns = [10, 20, 30, 40].map(function (r) {
      return '<button type="button" class="cfx-seg__btn' + (r === p.targetRate ? ' is-active' : '') + '" data-rate="' + r + '" aria-pressed="' + (r === p.targetRate) + '">' + r + '%</button>';
    }).join('');

    var hero =
      '<div class="cfx-hero ' + _aiTone(heroTone) + '">' +
        '<div class="cfx-hero__top">' +
          '<div>' +
            '<div class="cfx-label">cần chi để đạt mục tiêu tiết kiệm</div>' +
            '<div class="cfx-hero__value">' + (p.spendCap > 0 ? F(p.spendCap) : '—') + '</div>' +
            '<div class="cfx-hero__sub">' +
              (p.spendCap > 0
                ? 'Đã chi <b>' + F(p.cur.spent) + '</b> · ' + (p.remaining >= 0 ? 'còn <b>' + F(p.remaining) + '</b>' : 'vượt <b>' + F(-p.remaining) + '</b>')
                : 'Thêm thu nhập để tính cần chi') +
              (p.incomeIsEstimate ? ' · <span class="cfx-muted">thu nhập ước tính (TB 3 tháng)</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cfx-seg" role="group" aria-label="Mục tiêu tiết kiệm"><span class="cfx-seg__label">Mục tiêu tiết kiệm</span>' + segBtns + '</div>' +
        '</div>' +
        '<div class="cfx-pace" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(_aiClamp(p.usedPct, 0, 100)) + '">' +
          '<div class="cfx-pace__fill" style="width:' + fillW + '%"></div>' +
          (p.isCurrent ? '<div class="cfx-pace__tick" style="left:' + tickW + '%" title="Tiến độ thời gian của tháng"></div>' : '') +
        '</div>' +
        '<div class="cfx-pace__legend"><span>Đã dùng ' + Math.round(p.usedPct) + '% cần chi</span>' +
          (p.isCurrent ? '<span>Ngày ' + p.daysElapsed + '/' + p.daysInMonth + ' (' + Math.round(p.timePct) + '% tháng)</span>' : '<span>Tháng đã kết thúc</span>') +
        '</div>' +
      '</div>';

    // ── KPI ──
    var overProj = p.incomeBase > 0 && p.projectedSpend > p.spendCap;
    var rateOk = p.savingsRate !== null && p.savingsRate >= p.targetRate;
    var kpis =
      '<div class="cfx-kpis">' +
        _aiKpi('Chi an toàn mỗi ngày',
          (p.isCurrent && p.incomeBase > 0) ? F(p.safePerDay) : '—',
          p.isCurrent ? (p.remaining >= 0 ? 'Còn ' + p.remainingDays + ' ngày · hạn mức ngày ' + F(p.dailyLimit) : 'Đã vượt cần chi') : 'Chỉ áp dụng tháng hiện tại',
          (p.isCurrent && p.remaining < 0) ? 'danger' : 'ok') +
        _aiKpi(p.isCurrent ? 'Dự báo chi cuối tháng' : 'Tổng chi trong tháng',
          F(p.projectedSpend),
          p.incomeBase > 0 ? 'cần chi ' + F(p.spendCap) : 'Chưa có thu nhập',
          overProj ? 'warn' : 'ok') +
        _aiKpi('Tỷ lệ để dành',
          p.savingsRate !== null ? p.savingsRate.toFixed(1) + '%' : '—',
          'Mục tiêu ' + p.targetRate + '%',
          p.savingsRate === null ? 'info' : (rateOk ? 'ok' : 'warn')) +
        _aiKpi(p.isCurrent ? 'Dự kiến để dành' : 'Đã để dành',
          p.incomeBase > 0 ? F(p.projectedSavings) : '—',
          'Đã chuyển vào tiết kiệm ' + F(p.cur.saved),
          p.projectedSavings < 0 ? 'danger' : 'ok') +
      '</div>';

    // ── Phân bổ 50/30/20 ──
    var allocRows = ['needs', 'wants', 'growth'].map(function (k) {
      var b = p.buckets[k];
      var pct = b.pct;
      var tone = 'info';
      if (pct !== null) {
        if (k === 'growth') tone = pct >= b.target ? 'ok' : (pct >= b.target * 0.6 ? 'warn' : 'danger');
        else tone = pct <= b.target + 3 ? 'ok' : (pct <= b.target + 10 ? 'warn' : 'danger');
      }
      return '<div class="cfx-alloc__row">' +
        '<div class="cfx-alloc__name">' + e(b.label) + '</div>' +
        '<div class="cfx-alloc__bar ' + _aiTone(tone) + '">' +
          '<i style="width:' + _aiClamp(pct || 0, 0, 100).toFixed(1) + '%"></i>' +
          '<b style="left:' + _aiClamp(b.target, 0, 100) + '%" title="Mục tiêu ' + b.target + '%"></b>' +
        '</div>' +
        '<div class="cfx-alloc__val"><strong>' + (pct !== null ? pct.toFixed(0) + '%' : '—') + '</strong><span>/ ' + (k === 'growth' ? '≥' : '≤') + b.target + '%</span></div>' +
      '</div>';
    }).join('');

    var alloc =
      '<div class="cfx-card">' +
        '<div class="cfx-card__head"><h5>Phân bổ thu nhập</h5><span class="cfx-muted">Vạch đứng = mục tiêu</span></div>' +
        allocRows +
      '</div>';

    // ── Hạng mục chi ──
    var catRows = p.cats.slice(0, 6).map(function (c) {
      var barPct = c.budgetPct !== null ? _aiClamp(c.budgetPct, 0, 100) : _aiClamp(c.share, 0, 100);
      var tone = c.status === 'over' ? 'danger' : (c.status === 'warn' ? 'warn' : (c.status === 'ok' ? 'ok' : 'info'));
      var deltaHtml = '<span class="cfx-delta cfx-muted">mới</span>';
      if (c.delta !== null) {
        var up = c.delta > 0;
        deltaHtml = '<span class="cfx-delta ' + (Math.abs(c.delta) < 5 ? 'cfx-muted' : (up ? 'is-up' : 'is-down')) + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(Math.round(c.delta)) + '%</span>';
      }
      return '<div class="cfx-cat">' +
        '<div class="cfx-cat__name" title="' + e(c.name) + '">' + e(c.name) + '</div>' +
        '<div class="cfx-cat__bar ' + _aiTone(tone) + '"><i style="width:' + barPct.toFixed(1) + '%"></i></div>' +
        '<div class="cfx-cat__amt">' + F(c.amount) + (c.limit > 0 ? '<small>/ ' + F(c.limit) + '</small>' : '<small>' + Math.round(c.share) + '% tổng chi</small>') + '</div>' +
        deltaHtml +
      '</div>';
    }).join('');

    var cats =
      '<div class="cfx-card">' +
        '<div class="cfx-card__head"><h5>Hạng mục chi nhiều nhất</h5><span class="cfx-muted">So với tháng trước</span></div>' +
        (catRows || '<p class="cfx-muted">Chưa có khoản chi nào trong tháng.</p>') +
      '</div>';

    // ── Hành động đề xuất ──
    var actions = _aiBuildActions(p);
    var actionRows = actions.map(function (a) {
      return '<div class="cfx-action ' + _aiTone(a.level) + '">' +
        '<span class="cfx-action__icon">' + AI_ICON[a.level === 'ok' ? 'ok' : a.level] + '</span>' +
        '<div class="cfx-action__text"><strong>' + e(a.title) + '</strong><span>' + e(a.body) + '</span></div>' +
        (a.prompt ? '<button type="button" class="cfx-link" data-ai-prompt="' + e(a.prompt) + '">Hỏi AI</button>' : '') +
      '</div>';
    }).join('');

    var actionsCard =
      '<div class="cfx-card cfx-card--wide">' +
        '<div class="cfx-card__head"><h5>Việc nên làm ngay</h5><span class="cfx-muted">Phân tích tự động</span></div>' +
        actionRows +
      '</div>';

    // ── CTA ──
    var cta =
      '<div class="cfx-cta">' +
        '<button type="button" class="cfx-btn cfx-btn--primary" data-ai-prompt="' + e(AI_PROMPTS.plan) + '">' + AI_ICON.spark + '<span>Lập kế hoạch tháng sau với AI</span></button>' +
        '<button type="button" class="cfx-btn" data-ai-prompt="' + e(AI_PROMPTS.cut) + '"><span>Tìm khoản nên cắt giảm</span></button>' +
        '<button type="button" class="cfx-btn" data-ai-prompt="' + e(AI_PROMPTS.forecast) + '"><span>Dự báo cuối tháng</span></button>' +
      '</div>';

    root.innerHTML = hero + kpis + '<div class="cfx-grid">' + alloc + cats + '</div>' + actionsCard + cta;
    _generateAIInsight();
  }

  function _aiKpi(label, value, sub, tone) {
    return '<div class="cfx-kpi ' + _aiTone(tone) + '">' +
      '<div class="cfx-label">' + _escHtml(label) + '</div>' +
      '<div class="cfx-kpi__value">' + _escHtml(value) + '</div>' +
      '<div class="cfx-kpi__sub">' + _escHtml(sub) + '</div>' +
    '</div>';
  }

  // ─────────────────────────────────────────────────────────────
  //  Insight banner (luôn hiển thị phía trên, theo mức độ khẩn cấp)
  // ─────────────────────────────────────────────────────────────

  function _showAIInsight(message, level) {
    var banner = _qs('#cf-ai-insight-banner');
    var msgEl = _qs('#cf-ai-insight-message');
    if (!banner || !msgEl) return;
    level = level || 'info';
    msgEl.textContent = message;
    banner.dataset.level = level;
    var icon = _qs('#cf-ai-insight-icon');
    if (icon) icon.innerHTML = AI_ICON[level] || AI_ICON.info;
    banner.style.display = 'flex';
  }

  function _hideAIInsight() {
    var banner = _qs('#cf-ai-insight-banner');
    if (banner) banner.style.display = 'none';
  }

  function _generateAIInsight() {
    var p = _computeSpendingPlan();
    if (!p || (p.cur.count === 0 && p.incomeBase <= 0)) {
      _showAIInsight('Chưa có dữ liệu tháng này. Ghi vài khoản thu chi để mình lập kế hoạch cho bạn.', 'info');
      return;
    }
    var top = _aiBuildActions(p)[0];
    if (top) _showAIInsight(top.title + '. ' + top.body, top.level);
  }

  // ─────────────────────────────────────────────────────────────
  //  Ngữ cảnh gửi cho AI
  // ─────────────────────────────────────────────────────────────

  function _getAIKey(provider) {
    var storageKey = provider === 'gemini' ? 'gemini_api_key' : 'nvidia_api_key';
    try { return localStorage.getItem(storageKey); } catch (_) { return null; }
  }

  function _getFinancialContext() {
    var ym = _currentMonth || _currentYearMonth();
    var plan = _computeSpendingPlan();
    var balances = {
      netWorth: _computeLiveNetWorth(),
      savings: _cashFlowMeta.savingsBalance || 0,
      cashBalance: _calcCashBalance(),
      bankBalance: _calcBankBalance()
    };

    if (!_data || !_data.transactions || _data.transactions.length === 0 || !plan) {
      return JSON.stringify({ month: ym.month + '/' + ym.year, message: 'Chưa có dữ liệu giao dịch.', balances: balances });
    }

    var monthTxs = _getMonthTransactions(ym.year, ym.month);
    var txs = (monthTxs.length > 0 ? monthTxs : _getAllTransactionsSorted().slice(0, 100)).slice()
      .sort(function (a, b) { return (b.day || 0) - (a.day || 0); })
      .slice(0, 80);

    // Tổng theo hạng mục tính sẵn để AI không phải cộng
    var categoryTotals = { income: {}, expense: {} };
    monthTxs.forEach(function (tx) {
      var type = tx.type === 'income' ? 'income' : 'expense';
      var name = _categoryDisplayName(tx.category, tx.type);
      categoryTotals[type][name] = (categoryTotals[type][name] || 0) + (tx.amount || 0);
    });

    var budgets = {};
    Object.keys(_cashFlowMeta.budgets || {}).forEach(function (id) {
      if (_cashFlowMeta.budgets[id] > 0) budgets[_categoryDisplayName(id, 'expense')] = _cashFlowMeta.budgets[id];
    });

    var prevByCat = {};
    Object.keys(plan.prev.byCat).forEach(function (id) { prevByCat[_categoryDisplayName(id, 'expense')] = plan.prev.byCat[id]; });

    var R = Math.round;
    return JSON.stringify({
      month: ym.month + '/' + ym.year,
      currency: 'VND',
      plan: {
        incomeThisMonth: R(plan.cur.income),
        incomeUsedForPlanning: R(plan.incomeBase),
        incomeIsEstimateFromLast3Months: plan.incomeIsEstimate,
        spentThisMonth: R(plan.cur.spent),
        movedToSavingsThisMonth: R(plan.cur.saved),
        savingsRatePct: plan.savingsRate === null ? null : +plan.savingsRate.toFixed(1),
        targetSavingsRatePct: plan.targetRate,
        spendCap: R(plan.spendCap),
        remainingUnderCap: R(plan.remaining),
        daysInMonth: plan.daysInMonth,
        remainingDays: plan.remainingDays,
        burnRatePerDay: R(plan.burn),
        projectedMonthEndSpend: R(plan.projectedSpend),
        projectedMonthEndSaving: R(plan.projectedSavings),
        safeToSpendPerDay: R(plan.safePerDay),
        dailyLimitSetByUser: plan.dailyLimit,
        allocationPctOfIncome: {
          needs:  { actual: plan.buckets.needs.pct === null ? null : +plan.buckets.needs.pct.toFixed(1), target: plan.buckets.needs.target },
          wants:  { actual: plan.buckets.wants.pct === null ? null : +plan.buckets.wants.pct.toFixed(1), target: plan.buckets.wants.target },
          savingsAndGrowth: { actual: plan.buckets.growth.pct === null ? null : +plan.buckets.growth.pct.toFixed(1), target: plan.buckets.growth.target }
        }
      },
      categoryTotals: categoryTotals,
      categoryBudgets: budgets,
      previousMonth: { income: R(plan.prev.income), spent: R(plan.prev.spent), spentByCategory: prevByCat },
      debtsToCollect: plan.debts.list.map(function (d) { return { debtor: d.debtor, amount: d.amount, dueDate: d.due, overdue: d.overdue }; }),
      balances: balances,
      transactions: txs.map(function (tx) {
        return {
          d: _formatDate(tx.day, tx.month, tx.year),
          c: _categoryDisplayName(tx.category, tx.type),
          a: tx.amount,
          t: tx.type === 'expense' ? '-' : '+',
          n: tx.desc || '',
          s: tx.source || 'bank'
        };
      })
    });
  }

  function _aiSystemInstruction() {
    return 'Bạn là "Quân sư tài chính cá nhân" của ' + AI_ADDRESS + ': cố vấn lập kế hoạch chi tiêu thực chiến, thẳng thắn, tinh gọn. ' +
      'Luôn xưng hô với người dùng là "' + AI_ADDRESS + '" và trả lời bằng tiếng Việt.\n\n' +
      'NGUYÊN TẮC SỐ LIỆU\n' +
      '1. Chỉ dùng số liệu trong khối DỮ LIỆU. KHÔNG tự cộng/trừ để tạo ra con số tổng hợp mới: dùng đúng giá trị có sẵn trong plan, categoryTotals, previousMonth, balances. Phép tính đơn giản để minh hoạ (ví dụ giảm 15% một hạng mục) được phép nhưng phải ghi rõ là ước tính (≈).\n' +
      '2. Định dạng tiền kiểu Việt Nam: 1.250.000 ₫. Không bịa giao dịch, hạng mục hay số dư không có trong dữ liệu; thiếu dữ liệu thì nói rõ.\n' +
      '3. plan.targetSavingsRatePct là mục tiêu tiết kiệm người dùng đã chọn; plan.spendCap là cần chi để đạt mục tiêu đó. Mọi kế hoạch ngân sách phải nằm trong spendCap.\n' +
      '4. Giao dịch có trường s: "cash" (tiền mặt) hoặc "bank" (ngân hàng). Chỉ phân tích riêng hai nguồn này khi liên quan.\n\n' +
      'CÁCH TRẢ LỜI\n' +
      '- Chào hỏi/xã giao ("hello", "cảm ơn"…): đáp 1–2 câu thân thiện rồi gợi ý 2–3 việc bạn có thể làm. KHÔNG đổ số liệu khi chưa được hỏi.\n' +
      '- Câu hỏi mơ hồ: nêu ngắn gọn cách bạn hiểu rồi vẫn trả lời luôn; chỉ hỏi lại tối đa 1 câu ở cuối.\n' +
      '- Câu hỏi kiến thức tài chính chung: giải thích ngắn gọn, gắn với tình hình thực tế của người dùng nếu liên quan.\n' +
      '- Mở đầu bằng kết luận 1 câu. Sau đó là các ý chính dạng gạch đầu dòng; mỗi ý có con số cụ thể và hành động cụ thể (làm gì, bao nhiêu, khi nào). Tối đa khoảng 220 từ, trừ khi được yêu cầu lập kế hoạch.\n' +
      '- Yêu cầu lập kế hoạch chi tiêu/ngân sách/tháng sau: trả lời theo cấu trúc (1) Hiện trạng 2–3 dòng; (2) Bảng markdown ngân sách đề xuất với các cột Hạng mục | Tháng này | Đề xuất | Ghi chú, tổng đề xuất không vượt plan.spendCap; (3) 3 quy tắc chi tiêu; (4) Việc cần làm trong 7 ngày tới.\n' +
      '- Thứ tự ưu tiên khi tối ưu: khoản thiết yếu → thu hồi/trả nợ → quỹ khẩn cấp (3–6 tháng chi thiết yếu) → tiết kiệm/đầu tư → mong muốn. Không khuyên mã cổ phiếu/coin cụ thể.\n' +
      '- Giọng văn tôn trọng, không phán xét. Dùng **in đậm** cho con số then chốt, không dùng emoji tràn lan.';
  }

  /** Lấy các tin nhắn gần nhất làm "trí nhớ" (bỏ tin cuối vì đó là câu hỏi hiện tại) */
  function _aiBuildHistory() {
    var h = _aiState.conversationHistory.slice(0, -1).slice(-AI_HISTORY_TURNS);
    var out = [];
    h.forEach(function (m) {
      var role = m.role === 'user' ? 'user' : 'assistant';
      var text = String(m.content || '').slice(0, 1500);
      if (!text) return;
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].text += '\n' + text; // gộp tin liền nhau cùng vai trò
      else out.push({ role: role, text: text });
    });
    while (out.length && out[0].role !== 'user') out.shift(); // Gemini yêu cầu bắt đầu bằng user
    return out;
  }

  function _aiBuildRequest(userQuery) {
    var system = _aiSystemInstruction();
    var context = _getFinancialContext();
    var history = _aiBuildHistory();
    var transcript = history.map(function (m) { return (m.role === 'user' ? 'NGƯỜI DÙNG: ' : 'TRỢ LÝ: ') + m.text; }).join('\n');
    var flat = system + '\n\n=== DỮ LIỆU TÀI CHÍNH (JSON) ===\n' + context +
      (transcript ? '\n\n=== HỘI THOẠI TRƯỚC ĐÓ ===\n' + transcript : '') +
      '\n\n=== CÂU HỎI MỚI CỦA NGƯỜI DÙNG ===\n' + userQuery;
    return { system: system, context: context, history: history, user: userQuery, flat: flat };
  }

  // ─────────────────────────────────────────────────────────────
  //  Gọi API
  // ─────────────────────────────────────────────────────────────

  /** fetch có timeout + retry + hỗ trợ huỷ */
  async function _resilientFetch(url, options, config) {
    options = options || {};
    config = config || {};
    var timeout = config.timeout || 120000;
    var maxRetries = config.maxRetries === undefined ? 2 : config.maxRetries;
    var retryDelay = config.retryDelay || 1000;
    var externalSignal = config.signal || null;

    var lastError;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, timeout);
      var signal = controller.signal;
      if (externalSignal) {
        signal = (typeof AbortSignal.any === 'function') ? AbortSignal.any([controller.signal, externalSignal]) : externalSignal;
      }
      try {
        var response = await fetch(url, Object.assign({}, options, { signal: signal, keepalive: false }));
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        if (err.name === 'AbortError' || err.name === 'TypeError') throw err;
        if (attempt < maxRetries) await new Promise(function (r) { setTimeout(r, retryDelay * (attempt + 1)); });
      }
    }
    throw lastError;
  }

  /** Gemini: dùng systemInstruction + hội thoại nhiều lượt đúng chuẩn */
  async function _callGeminiAPI(req, apiKey, signal) {
    var contents = req.history.concat([{ role: 'user', text: req.user }]).map(function (m) {
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] };
    });

    var response = await _resilientFetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=' + encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system + '\n\n=== DỮ LIỆU TÀI CHÍNH (JSON) ===\n' + req.context }] },
          contents: contents,
          generationConfig: { maxOutputTokens: 2048, temperature: 0.6 }
        })
      },
      { timeout: 60000, maxRetries: 2, signal: signal }
    );

    if (!response.ok) {
      var error = await response.json().catch(function () { return {}; });
      throw new Error('Gemini API error: ' + response.status + ' - ' + ((error.error && error.error.message) || response.statusText));
    }

    var data = await response.json();
    var cand = data.candidates && data.candidates[0];
    var text = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
    if (!text && data.promptFeedback && data.promptFeedback.blockReason) {
      throw new Error('Yêu cầu bị chặn bởi bộ lọc an toàn (' + data.promptFeedback.blockReason + ').');
    }
    return text || 'Không có phản hồi từ AI.';
  }

  /** Nvidia Nemotron qua backend Vercel (backend chỉ nhận 1 chuỗi → gộp ngữ cảnh + lịch sử vào đó) */
  async function _callNvidiaAPI(req, apiKey, signal) {
    var response = await _resilientFetch('https://personal-hub-rose-xi.vercel.app/api/ask-nvidia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey, systemPrompt: req.flat })
    }, { timeout: 120000, maxRetries: 1, signal: signal });

    if (!response.ok) {
      var error = await response.json().catch(function () { return {}; });
      throw new Error('Nvidia API error: ' + response.status + ' - ' + (error.message || response.statusText));
    }
    var data = await response.json();
    return data.response || 'Không có phản hồi từ AI.';
  }

  function _aiFriendlyError(err) {
    var msg = String((err && err.message) || err || '');
    if (/401|403|API key|api_key|permission|unauthor/i.test(msg)) return 'API key không hợp lệ hoặc đã hết hạn. Mở Cài đặt (biểu tượng chìa khoá) để kiểm tra lại.';
    if (/429|quota|rate/i.test(msg)) return 'Đã chạm giới hạn truy cập của dịch vụ AI. Hãy thử lại sau ít phút hoặc đổi mô hình.';
    if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) return 'Không kết nối được tới dịch vụ AI. Kiểm tra mạng rồi thử lại.';
    if (err && err.name === 'AbortError') return 'Yêu cầu quá thời gian chờ. Hãy thử lại.';
    return msg || 'Đã xảy ra lỗi không xác định.';
  }

  // ─────────────────────────────────────────────────────────────
  //  Markdown renderer (an toàn: escape trước, rồi mới dựng thẻ)
  // ─────────────────────────────────────────────────────────────

  function _aiInline(s) {
    return s
      .replace(/(-?\d[\d.,]*\s?(?:₫|VND|VNĐ|vnđ|đ(?![a-zà-ỹ])))/g, '<span class="cfx-num">$1</span>')
      .replace(/(\d+(?:[.,]\d+)?\s?%)/g, '<span class="cfx-num">$1</span>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function _aiMarkdown(raw) {
    var lines = _escHtml(String(raw || '')).replace(/\r/g, '').split('\n');
    var html = '';
    var i = 0;
    var para = [];
    var listType = null;

    function flushPara() { if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; } }
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    function isTableSep(l) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || ''); }
    function cells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }

    while (i < lines.length) {
      var line = lines[i];
      var m;

      if (!line.trim()) { flushPara(); closeList(); i++; continue; }

      // Bảng
      if (/^\s*\|.*\|\s*$/.test(line) && isTableSep(lines[i + 1])) {
        flushPara(); closeList();
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        html += '<div class="cfx-table-wrap"><table><thead><tr>' + head.map(function (c) { return '<th>' + _aiInline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + _aiInline(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div>';
        continue;
      }

      if ((m = line.match(/^\s{0,3}(#{1,4})\s+(.*)$/))) { flushPara(); closeList(); html += '<div class="cfx-md-h cfx-md-h--' + m[1].length + '">' + _aiInline(m[2]) + '</div>'; i++; continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; i++; continue; }
      if ((m = line.match(/^\s*&gt;\s?(.*)$/))) { flushPara(); closeList(); html += '<blockquote>' + _aiInline(m[1]) + '</blockquote>'; i++; continue; }

      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        flushPara();
        if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
        html += '<li>' + _aiInline(m[1]) + '</li>'; i++; continue;
      }
      if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
        flushPara();
        if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
        html += '<li>' + _aiInline(m[2]) + '</li>'; i++; continue;
      }

      closeList();
      para.push(_aiInline(line.trim()));
      i++;
    }
    flushPara(); closeList();
    return html;
  }

  // ─────────────────────────────────────────────────────────────
  //  Khung giao diện (HTML shell) — được chèn vào render()
  // ─────────────────────────────────────────────────────────────

  function _aiShellHTML() {
    var chips = [
      ['Tóm tắt tháng này', AI_PROMPTS.summary],
      ['Lập kế hoạch tháng sau', AI_PROMPTS.plan],
      ['Cắt giảm ở đâu?', AI_PROMPTS.cut],
      ['Dự báo cuối tháng', AI_PROMPTS.forecast],
      ['Tiền mặt vs Ngân hàng', AI_PROMPTS.cash],
      ['Quản lý tiền tiết kiệm', AI_PROMPTS.savings]
    ].map(function (c) {
      return '<button type="button" class="cf-ai-chip cfx-chip" data-ai-prompt="' + _escHtml(c[1]) + '">' + _escHtml(c[0]) + '</button>';
    }).join('');

    return '' +
    '<section class="cfx-ai" id="cfx-ai" aria-label="Trợ lý tài chính AI">' +
      '<header class="cfx-ai__head">' +
        '<div class="cfx-ai__brand">' +
          '<div class="cfx-ai__logo">' + AI_ICON.spark + '</div>' +
          '<div class="cfx-ai__titles">' +
            '<h4>AI Financial Advisor</h4>' +
            '<p><span class="cfx-ai__dot" id="cfx-ai-dot"></span><span id="cfx-ai-status">Sẵn sàng</span><span class="cfx-sep">·</span><span id="cfx-ai-period"></span></p>' +
          '</div>' +
        '</div>' +
        '<div class="cfx-ai__tools">' +
          '<select id="cf-ai-provider" class="cfx-select" aria-label="Chọn mô hình AI">' +
            '<option value="gemini">Gemini 3.7 Flash</option>' +
            '<option value="nvidia">Nvidia Nemotron 3 Ultra</option>' +
          '</select>' +
          '<button type="button" id="cfx-ai-new" class="cfx-iconbtn" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">' + AI_ICON.plus + '</button>' +
          '<button type="button" id="cf-ai-settings-btn" class="cfx-iconbtn" title="Cài đặt API Key" aria-label="Cài đặt API Key">' + AI_ICON.key + '</button>' +
        '</div>' +
      '</header>' +

      '<div class="cfx-insight" id="cf-ai-insight-banner" data-level="info" role="status">' +
        '<span class="cfx-insight__icon" id="cf-ai-insight-icon">' + AI_ICON.info + '</span>' +
        '<div class="cfx-insight__text"><span class="cfx-insight__tag">Insight</span><span id="cf-ai-insight-message">Đang phân tích dữ liệu chi tiêu tháng này…</span></div>' +
      '</div>' +

      '<div class="cfx-tabs" role="tablist" aria-label="Chế độ">' +
        '<button type="button" role="tab" class="cfx-tab" data-tab="plan" id="cfx-tab-plan" aria-controls="cfx-panel-plan">' + AI_ICON.plan + '<span>Kế hoạch chi tiêu</span></button>' +
        '<button type="button" role="tab" class="cfx-tab" data-tab="chat" id="cfx-tab-chat" aria-controls="cfx-panel-chat">' + AI_ICON.chat + '<span>Hỏi đáp AI</span></button>' +
      '</div>' +

      '<div class="cfx-panel" id="cfx-panel-plan" role="tabpanel" aria-labelledby="cfx-tab-plan">' +
        '<div id="cfx-plan"></div>' +
      '</div>' +

      '<div class="cfx-panel cfx-chat" id="cfx-panel-chat" role="tabpanel" aria-labelledby="cfx-tab-chat" hidden>' +
        '<div class="cfx-chat__scroll" id="hub-cf-ai-output" aria-live="polite"></div>' +
        '<div class="cfx-chat__composer">' +
          '<div class="cfx-chips" id="cf-ai-quick-prompts">' + chips + '</div>' +
          '<div class="cfx-input">' +
            '<textarea id="cf-ai-prompt" class="cfx-input__field" rows="1" maxlength="1500" placeholder="Hỏi về chi tiêu, ngân sách, cách tiết kiệm…" autocomplete="off" data-lpignore="true" data-form-type="other" aria-label="Câu hỏi cho trợ lý AI"></textarea>' +
            '<button type="button" id="cf-ai-ask-btn" class="cfx-send" aria-label="Gửi câu hỏi" title="Gửi (Enter)">' + AI_ICON.send + '</button>' +
          '</div>' +
          '<div class="cfx-hint">Enter để gửi · Shift+Enter xuống dòng · AI đọc dữ liệu của tháng đang xem</div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  // ─────────────────────────────────────────────────────────────
  //  Chat UI
  // ─────────────────────────────────────────────────────────────

  function _aiEmptyStateHTML() {
    var ym = _currentMonth || _currentYearMonth();
    var tiles = [
      ['Lập kế hoạch tháng sau', 'Ngân sách từng hạng mục + việc cần làm tuần đầu', AI_PROMPTS.plan],
      ['Cắt giảm ở đâu?', 'Số tiền cụ thể cho từng khoản nên giảm', AI_PROMPTS.cut],
      ['Dự báo cuối tháng', 'Chi bao nhiêu, để dành được bao nhiêu', AI_PROMPTS.forecast],
      ['Quản lý tiền tiết kiệm', 'Giữ và làm tiền tiết kiệm sinh lời', AI_PROMPTS.savings]
    ].map(function (t) {
      return '<button type="button" class="cfx-tile" data-ai-prompt="' + _escHtml(t[2]) + '"><strong>' + _escHtml(t[0]) + '</strong><span>' + _escHtml(t[1]) + '</span></button>';
    }).join('');

    return '<div class="cfx-empty">' +
      '<div class="cfx-empty__logo">' + AI_ICON.spark + '</div>' +
      '<h5>Xin chào ' + _escHtml(AI_ADDRESS) + '</h5>' +
      '<p>Mình đã đọc dữ liệu tháng ' + ym.month + '/' + ym.year + ' của bạn. Hỏi gì cũng được, hoặc chọn một gợi ý:</p>' +
      '<div class="cfx-tiles">' + tiles + '</div>' +
    '</div>';
  }

  function _appendAIChatBubble(text, sender, opts) {
    var out = _qs('#hub-cf-ai-output');
    if (!out) return null;
    opts = opts || {};
    var isUser = sender === 'user';
    var empty = out.querySelector('.cfx-empty');
    if (empty) empty.remove();

    if (!isUser) { // chỉ tin AI mới nhất giữ nút "Tạo lại"
      Array.prototype.forEach.call(out.querySelectorAll('[data-act="regen"]'), function (b) { b.remove(); });
    }

    var content = isUser ? '<p>' + _escHtml(text).replace(/\n/g, '<br>') + '</p>' : _aiMarkdown(text);
    var actions = '';
    if (!isUser && !opts.noActions) {
      actions = '<div class="cfx-msg__actions">' +
        '<button type="button" data-act="copy">' + AI_ICON.copy + '<span>Sao chép</span></button>' +
        (opts.isError ? '' : '<button type="button" data-act="regen">' + AI_ICON.refresh + '<span>Tạo lại</span></button>') +
      '</div>';
    }
    if (opts.isError) {
      actions = '<div class="cfx-msg__actions"><button type="button" data-act="regen">' + AI_ICON.refresh + '<span>Thử lại</span></button></div>';
    }

    var html =
      '<div class="cfx-msg ' + (isUser ? 'cfx-msg--user' : 'cfx-msg--ai') + (opts.isError ? ' cfx-msg--error' : '') + '">' +
        '<div class="cfx-msg__avatar">' + (isUser ? AI_ICON.user : AI_ICON.spark) + '</div>' +
        '<div class="cfx-msg__body">' +
          '<div class="cfx-msg__meta"><span>' + (isUser ? 'Bạn' : 'Advisor') + '</span><time>' + _aiTime(opts.time) + '</time></div>' +
          '<div class="cfx-msg__bubble cfx-md">' + content + '</div>' +
          actions +
        '</div>' +
      '</div>';
    out.insertAdjacentHTML('beforeend', html);
    out.scrollTop = out.scrollHeight;
    return out.lastElementChild;
  }

  function _showAILoading(message) {
    var out = _qs('#hub-cf-ai-output');
    if (!out) return;
    _clearAILoading();
    var empty = out.querySelector('.cfx-empty');
    if (empty) empty.remove();

    out.insertAdjacentHTML('beforeend',
      '<div class="cfx-msg cfx-msg--ai" data-loading="1">' +
        '<div class="cfx-msg__avatar">' + AI_ICON.spark + '</div>' +
        '<div class="cfx-msg__body">' +
          '<div class="cfx-msg__meta"><span>Advisor</span></div>' +
          '<div class="cfx-msg__bubble cfx-typing"><span class="cfx-typing__dots"><i></i><i></i><i></i></span><span class="cfx-typing__text">' + _escHtml(message || AI_STATUS_STEPS[0]) + '</span></div>' +
        '</div>' +
      '</div>');
    out.scrollTop = out.scrollHeight;

    var step = 0;
    _aiState._loadingTimer = setInterval(function () {
      var t = _qs('.cfx-typing__text');
      if (!t) return;
      step = (step + 1) % AI_STATUS_STEPS.length;
      t.textContent = AI_STATUS_STEPS[step];
    }, 2200);
  }

  function _clearAILoading() {
    if (_aiState._loadingTimer) { clearInterval(_aiState._loadingTimer); _aiState._loadingTimer = null; }
    var out = _qs('#hub-cf-ai-output');
    if (!out) return;
    Array.prototype.forEach.call(out.querySelectorAll('[data-loading]'), function (el) { el.remove(); });
  }

  function _renderAIResponse(text) {
    _clearAILoading();
    _appendAIChatBubble(text, 'assistant', { time: Date.now() });
  }

  function _showAIError(message) {
    _clearAILoading();
    _appendAIChatBubble(message, 'assistant', { isError: true, time: Date.now() });
  }

  function _renderChatHistory() {
    var out = _qs('#hub-cf-ai-output');
    if (!out) return;
    out.innerHTML = '';
    if (!_aiState.conversationHistory.length) {
      out.innerHTML = _aiEmptyStateHTML();
      return;
    }
    _aiState.conversationHistory.forEach(function (msg) {
      _appendAIChatBubble(msg.content, msg.role === 'user' ? 'user' : 'assistant', { time: msg.timestamp });
    });
    out.scrollTop = out.scrollHeight;
  }

  function _setAIBusy(busy) {
    var btn = _qs('#cf-ai-ask-btn');
    var root = _qs('#cfx-ai');
    if (root) root.classList.toggle('is-busy', !!busy);
    if (btn) {
      btn.innerHTML = busy ? AI_ICON.stop : AI_ICON.send;
      btn.title = busy ? 'Dừng' : 'Gửi (Enter)';
      btn.setAttribute('aria-label', busy ? 'Dừng phản hồi' : 'Gửi câu hỏi');
    }
    var status = _qs('#cfx-ai-status');
    if (status) status.textContent = busy ? 'Đang phân tích…' : _aiReadyLabel();
  }

  function _aiReadyLabel() {
    return _getAIKey(_aiState.provider) ? 'Sẵn sàng' : 'Chưa có API key';
  }

  function _updateAIStatus() {
    var dot = _qs('#cfx-ai-dot');
    var hasKey = !!_getAIKey(_aiState.provider);
    if (dot) dot.classList.toggle('is-off', !hasKey);
    var status = _qs('#cfx-ai-status');
    if (status && !_aiState.isLoading) status.textContent = _aiReadyLabel();
  }

  function _switchAITab(tab) {
    if (tab !== 'plan' && tab !== 'chat') tab = 'plan';
    _aiState.tab = tab;
    ['plan', 'chat'].forEach(function (t) {
      var btn = _qs('#cfx-tab-' + t);
      var panel = _qs('#cfx-panel-' + t);
      if (btn) { btn.classList.toggle('is-active', t === tab); btn.setAttribute('aria-selected', String(t === tab)); btn.tabIndex = t === tab ? 0 : -1; }
      if (panel) panel.hidden = t !== tab;
    });
    if (tab === 'chat') {
      var out = _qs('#hub-cf-ai-output');
      if (out) out.scrollTop = out.scrollHeight;
    }
    _saveAIState();
  }

  function _autoGrowPrompt() {
    var el = _qs('#cf-ai-prompt');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  // ─────────────────────────────────────────────────────────────
  //  Luồng hỏi đáp chính
  // ─────────────────────────────────────────────────────────────

  function _abortAIRequest() {
    if (_aiState.abortController) _aiState.abortController.abort();
  }

  function _aiRegenerate() {
    if (_aiState.isLoading) return;
    var h = _aiState.conversationHistory;
    if (h.length && h[h.length - 1].role !== 'user') h.pop();
    var last = h.length && h[h.length - 1].role === 'user' ? h.pop() : null;
    if (!last) return;
    _saveAIState();
    _renderChatHistory();
    _handleAIAdvisorQuery(last.content);
  }

  async function _handleAIAdvisorQuery(forcedText) {
    var promptInput = _qs('#cf-ai-prompt');
    var providerSelect = _qs('#cf-ai-provider');
    if (!promptInput || !providerSelect) return;
    if (_aiState.isLoading) return;

    var userQuery = (typeof forcedText === 'string' ? forcedText : promptInput.value).trim();
    if (!userQuery) return;

    _switchAITab('chat');

    var provider = providerSelect.value;
    _aiState.provider = provider;

    var apiKey = _getAIKey(provider);
    if (!apiKey) {
      _appendAIChatBubble(userQuery, 'user', { time: Date.now() });
      _showAIError('Chưa có API key cho mô hình này. Mở Cài đặt (biểu tượng chìa khoá phía trên) để nhập key rồi hỏi lại.');
      _aiState.conversationHistory.push({ role: 'user', content: userQuery, timestamp: Date.now() });
      _saveAIState();
      promptInput.value = '';
      _autoGrowPrompt();
      return;
    }

    _aiState.abortController = new AbortController();
    var signal = _aiState.abortController.signal;
    var requestId = ++_aiState.requestId;

    _aiState.isLoading = true;
    _aiState.lastPrompt = userQuery;
    _aiState.lastError = null;
    _setAIBusy(true);

    _appendAIChatBubble(userQuery, 'user', { time: Date.now() });
    _aiState.conversationHistory.push({ role: 'user', content: userQuery, timestamp: Date.now() });
    _saveAIState();
    promptInput.value = '';
    _autoGrowPrompt();
    _showAILoading();

    try {
      var req = _aiBuildRequest(userQuery);
      var responseText = provider === 'nvidia'
        ? await _callNvidiaAPI(req, apiKey, signal)
        : await _callGeminiAPI(req, apiKey, signal);

      if (requestId !== _aiState.requestId) return;

      _aiState.currentResponse = responseText;
      _aiState.conversationHistory.push({ role: 'assistant', content: responseText, timestamp: Date.now() });
      _saveAIState();
      _renderAIResponse(responseText);

    } catch (error) {
      if (requestId !== _aiState.requestId) return;

      if (error && error.name === 'AbortError' && signal.aborted && _aiState.userAborted) {
        _clearAILoading();
        _showToast('Đã dừng phản hồi');
      } else {
        console.error('[CashFlow AI] Error:', error);
        _aiState.lastError = _aiFriendlyError(error);
        _showAIError(_aiState.lastError);
      }
    } finally {
      if (requestId === _aiState.requestId) {
        _aiState.isLoading = false;
        _aiState.abortController = null;
        _aiState.userAborted = false;
        _clearAILoading();
        _setAIBusy(false);
        var inp = _qs('#cf-ai-prompt');
        if (inp) inp.focus();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Key modal
  // ─────────────────────────────────────────────────────────────

  function _openAIKeyModal() {
    var modal = document.getElementById('cf-ai-key-modal');
    if (!modal) return;
    document.getElementById('cf-key-gemini').value = localStorage.getItem('gemini_api_key') || '';
    document.getElementById('cf-key-nvidia').value = localStorage.getItem('nvidia_api_key') || '';
    modal.style.display = 'flex';
    requestAnimationFrame(function () { modal.classList.add('hub-cf-ai-key-modal--visible'); });
    setTimeout(function () { var el = document.getElementById('cf-key-gemini'); if (el) el.focus(); }, 150);
  }

  function _closeAIKeyModal() {
    var modal = document.getElementById('cf-ai-key-modal');
    if (!modal) return;
    modal.classList.remove('hub-cf-ai-key-modal--visible');
    setTimeout(function () { modal.style.display = 'none'; }, 300);
  }

  function _saveAIKeys() {
    var geminiKey = document.getElementById('cf-key-gemini').value.trim();
    var nvidiaKey = document.getElementById('cf-key-nvidia').value.trim();
    if (geminiKey) localStorage.setItem('gemini_api_key', geminiKey);
    if (nvidiaKey) localStorage.setItem('nvidia_api_key', nvidiaKey);
    _closeAIKeyModal();
    _updateAIStatus();
    _showToast('✅ Đã lưu API Keys thành công!');
  }

  function _clearAIKeys() {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem('nvidia_api_key');
    document.getElementById('cf-key-gemini').value = '';
    document.getElementById('cf-key-nvidia').value = '';
    _updateAIStatus();
    _showToast('✅ Đã xóa API Keys!');
  }

  // ─────────────────────────────────────────────────────────────
  //  Gắn sự kiện (event delegation trên #cfx-ai)
  // ─────────────────────────────────────────────────────────────

  var _aiEscBound = false;

  function _bindAIAdvisorEvents() {
    var root = document.getElementById('cfx-ai');
    var modal = document.getElementById('cf-ai-key-modal');

    if (root && !root.dataset.bound) {
      root.dataset.bound = '1';

      root.addEventListener('click', function (e) {
        var t = e.target;

        var tabBtn = t.closest('.cfx-tab');
        if (tabBtn) { _switchAITab(tabBtn.dataset.tab); return; }

        var rateBtn = t.closest('[data-rate]');
        if (rateBtn) { _aiSetTargetRate(parseInt(rateBtn.dataset.rate, 10)); _renderSpendingPlan(); return; }

        var promptBtn = t.closest('[data-ai-prompt]');
        if (promptBtn) { _handleAIAdvisorQuery(promptBtn.getAttribute('data-ai-prompt')); return; }

        var actBtn = t.closest('[data-act]');
        if (actBtn) {
          var act = actBtn.dataset.act;
          if (act === 'regen') { _aiRegenerate(); return; }
          if (act === 'copy') {
            var bubble = actBtn.closest('.cfx-msg__body').querySelector('.cfx-msg__bubble');
            var txt = bubble ? bubble.innerText : '';
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(function () { _showToast('Đã sao chép'); }, function () { _showToast('Không sao chép được'); });
            }
            return;
          }
        }

        if (t.closest('#cfx-ai-new')) {
          if (_aiState.isLoading) { _aiState.userAborted = true; _abortAIRequest(); }
          _aiState.conversationHistory = [];
          _aiState.currentResponse = '';
          _aiState.lastError = null;
          _saveAIState();
          _renderChatHistory();
          _showToast('Đã bắt đầu cuộc trò chuyện mới');
          return;
        }

        if (t.closest('#cf-ai-settings-btn')) { _openAIKeyModal(); return; }

        if (t.closest('#cf-ai-ask-btn')) {
          if (_aiState.isLoading) { _aiState.userAborted = true; _abortAIRequest(); }
          else _handleAIAdvisorQuery();
        }
      });

      root.addEventListener('keydown', function (e) {
        if (e.target && e.target.id === 'cf-ai-prompt' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          _handleAIAdvisorQuery();
        }
      });

      root.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'cf-ai-prompt') _autoGrowPrompt();
      });

      root.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'cf-ai-provider') {
          _aiState.provider = e.target.value;
          _saveAIState();
          _updateAIStatus();
        }
      });
    }

    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = '1';
      var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      on('cf-key-close', _closeAIKeyModal);
      on('cf-key-close-bottom', _closeAIKeyModal);
      on('cf-key-save', _saveAIKeys);
      on('cf-key-clear', _clearAIKeys);
      modal.addEventListener('click', function (e) { if (e.target === modal) _closeAIKeyModal(); });
    }

    if (!_aiEscBound) {
      _aiEscBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var m = document.getElementById('cf-ai-key-modal');
        if (m && m.style.display === 'flex') _closeAIKeyModal();
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════

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

    // ═══ DEBT RECOVERY MODAL EVENTS ═══
    // Modal close (Recovery modal)
    var recoveryCloseBtn = _qs('#hub-cf-debt-recovery-modal-close');
    if (recoveryCloseBtn) recoveryCloseBtn.addEventListener('click', _closeDebtRecoveryModal);

    // Modal cancel (Recovery modal)
    var recoveryCancelBtn = _qs('#hub-cf-debt-recovery-btn-cancel');
    if (recoveryCancelBtn) recoveryCancelBtn.addEventListener('click', _closeDebtRecoveryModal);

    // Overlay backdrop (Recovery modal)
    var recoveryOverlay = _qs('#hub-cf-debt-recovery-overlay');
    if (recoveryOverlay) {
      recoveryOverlay.addEventListener('click', function (e) {
        if (e.target === recoveryOverlay) _closeDebtRecoveryModal();
      });
    }

    // Confirm button (Recovery modal) - reads selected source and executes recovery
    var recoveryConfirmBtn = _qs('#hub-cf-debt-recovery-btn-confirm');
    if (recoveryConfirmBtn) {
      recoveryConfirmBtn.addEventListener('click', function () {
        var selectEl = _qs('#debt-recovery-source');
        if (selectEl) {
          var targetSource = selectEl.value;
          _executeDebtRecovery(targetSource);
          _closeDebtRecoveryModal();
        }
      });
    }

    // Event delegation for Paid History Modal delete buttons (static parent, bound once)
    _bindDebtHistoryModalDelegation();

    // Shorthand logic for debt amount input
    function applyShorthandLogic(inputId) {
      var input = _qs(inputId);
      if (!input) return;
      input.addEventListener('input', function(e) {
        var val = this.value.toLowerCase();
        if (val.endsWith('k')) {
          var num = parseFloat(val.replace('k', ''));
          if (!isNaN(num)) this.value = num * 1000;
        } else if (val.endsWith('m')) {
          var num = parseFloat(val.replace('m', ''));
          if (!isNaN(num)) this.value = num * 1000000;
        } else {
          // Strip out any non-numeric characters EXCEPT dot (for decimals before shorthand)
          this.value = this.value.replace(/[^0-9.]/g, '');
        }
      });
    }
    applyShorthandLogic('#hub-cf-debt-amount');
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

    // Enable keyboard navigation for debt form
    _enableKeyboardNavigation('#hub-cf-debt-form');
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

  // ══════════════════════════════════════════
  // DEBT RECOVERY MODAL LOGIC
  // ══════════════════════════════════════════

  function _closeDebtRecoveryModal() {
    var overlay = _qs('#hub-cf-debt-recovery-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      // Reset select to default
      var selectEl = _qs('#debt-recovery-source');
      if (selectEl) selectEl.value = 'bank';
      // Clear temp variable
      window.currentDebtRecoveryId = null;
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

    // Enable keyboard navigation for debt form
    _enableKeyboardNavigation('#hub-cf-debt-form');
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