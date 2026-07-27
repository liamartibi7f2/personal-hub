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
  const STORAGE_KEY = 'hub_cashflow';
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

  // ── Private state ──
  let _container     = null;
  let _data          = null;   // { transactions: [], balanceSnapshots: [], startingBalance: 0 }
  let _isDataLoaded  = false;
  let _sessionLoaded = false;  // Prevent re-fetch on tab switch
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
  //   STORAGE (localStorage-based; Firebase-ready extension point)
  // ============================================================

  async function _loadData() {
    if (_sessionLoaded && _data) return;

    try {
      // Try HubDB first (if future Firebase support is added)
      if (typeof HubDB !== 'undefined' && typeof HubDB.loadCashFlowData === 'function') {
        const cloudData = await HubDB.loadCashFlowData();
        if (cloudData && Array.isArray(cloudData.transactions)) {
          _data = cloudData;
          _ensureDataDefaults();
          _sessionLoaded = true;
          _isDataLoaded = true;
          return;
        }
      }
    } catch (_) { /* fallback to localStorage */ }

    // localStorage fallback
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.transactions)) {
          _data = parsed;
          _ensureDataDefaults();
          _sessionLoaded = true;
          _isDataLoaded = true;
          return;
        }
      }
    } catch (_) { /* corrupted — use default */ }

    _data = _defaultData();
    _ensureDataDefaults();
    _sessionLoaded = true;
    _isDataLoaded = true;
  }

  function _ensureDataDefaults() {
    if (!_data) _data = _defaultData();
    if (!Array.isArray(_data.transactions)) _data.transactions = [];
    if (!Array.isArray(_data.balanceSnapshots)) _data.balanceSnapshots = [];
    if (typeof _data.startingBalance !== 'number') _data.startingBalance = 0;
  }

  async function _persist() {
    if (!_isDataLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
    } catch (_) { /* quota exceeded */ }

    // Async Firebase sync
    try {
      if (typeof HubDB !== 'undefined' && typeof HubDB.saveCashFlowData === 'function') {
        HubDB.saveCashFlowData(_data).catch(function () {});
      }
    } catch (_) {}
  }

  function _debouncedPersist() {
    if (typeof HubDebounce !== 'undefined') {
      HubDebounce.call('cashflow', _persist, SAVE_DELAY);
    } else {
      setTimeout(_persist, SAVE_DELAY);
    }
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

  <!-- ═══ DASHBOARD — Net Worth + Income/Expense Summary ═══ -->
  <div class="hub-cf-dashboard">
    <div class="hub-cf-hero glass-card">
      <span class="hub-cf-hero-label">Tổng Tài Sản</span>
      <span class="hub-cf-hero-value" id="hub-cf-net-worth">0 ₫</span>
      <span class="hub-cf-hero-sub">Net Worth</span>
    </div>

    <div class="hub-cf-summary--income glass-card">
      <div class="hub-cf-summary-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 4v12M5 10l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="hub-cf-summary-text">
        <span class="hub-cf-summary-label">Thu Nhập</span>
        <span class="hub-cf-summary-value hub-cf-summary-value--income" id="hub-cf-total-income">0 ₫</span>
      </div>
    </div>

    <div class="hub-cf-summary--expense glass-card">
      <div class="hub-cf-summary-icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 16V4M15 10l-5 5-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="hub-cf-summary-text">
        <span class="hub-cf-summary-label">Chi Phí</span>
        <span class="hub-cf-summary-value hub-cf-summary-value--expense" id="hub-cf-total-expense">0 ₫</span>
      </div>
    </div>
  </div>

  <!-- ═══ REAL-TIME CHART ═══ -->
    <div class="hub-cf-chart-section glass-card">
      <div class="hub-cf-chart-header">
        <h4 class="hub-cf-chart-title">Income vs Expense</h4>
        <select class="hub-cf-chart-filter" id="hub-cf-chart-filter">
          <option value="day">Day</option>
          <option value="picker" disabled>Picker</option>
          <option value="month" selected>Month</option>
          <option value="year">Year</option>
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
      <span>Thêm Giao Dịch</span>
    </button>
    <button class="hub-cf-btn hub-cf-btn--export" id="hub-cf-btn-export">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3 13v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>Export to .xlsx</span>
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
      <span class="hub-cf-ledger-count" id="hub-cf-tx-count">0 entries</span>
    </div>

    <div class="hub-cf-category-breakdown" id="hub-cf-breakdown-section">
      <p class="hub-cf-breakdown-title">Category Breakdown</p>
      <div id="hub-cf-breakdown-content"></div>
    </div>

    <!-- Empty state -->
    <div class="hub-cf-empty" id="hub-cf-empty-state" style="display:none;">
      <span class="hub-cf-empty-icon">📋</span>
      <p class="hub-cf-empty-text">No transactions yet.</p>
      <p class="hub-cf-empty-hint">Tap <strong>[Thêm Giao Dịch]</strong> to start tracking.</p>
    </div>

    <div class="hub-cf-table-wrap" id="hub-cf-table-wrap" style="display:none;">
      <table class="hub-cf-table">
        <thead>
          <tr>
            <th class="hub-cf-col--date">Date</th>
            <th class="hub-cf-col--desc">Description</th>
            <th class="hub-cf-col--cat">Category</th>
            <th class="hub-cf-col--amt">Amount</th>
            <th class="hub-cf-col--act"></th>
          </tr>
        </thead>
        <tbody id="hub-cf-tx-body"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ═══ QUICK-ADD MODAL (injected into container) ═══ -->
<div class="hub-cf-overlay" id="hub-cf-overlay" role="dialog" aria-modal="true" aria-label="Add Transaction" style="display:none;">
  <div class="hub-cf-modal glass">
    <div class="hub-cf-modal-header">
      <div class="hub-cf-tab-group">
        <button class="hub-cf-tab hub-cf-tab--active" data-tab="expense" id="hub-cf-tab-expense">
          <span class="hub-cf-tab-dot hub-cf-tab-dot--expense"></span>
          Chi Phí
        </button>
        <button class="hub-cf-tab" data-tab="income" id="hub-cf-tab-income">
          <span class="hub-cf-tab-dot hub-cf-tab-dot--income"></span>
          Thu Nhập
        </button>
      </div>
      <button class="hub-cf-modal-close" id="hub-cf-modal-close" aria-label="Close modal">✕</button>
    </div>

    <div class="hub-cf-modal-body">
      <form id="hub-cf-form" autocomplete="off">
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-amount">Số tiền (VND)</label>
          <input type="number" id="hub-cf-amount" class="hub-cf-form-input hub-cf-amount-input"
                 placeholder="0" min="0" step="1000" required inputmode="numeric" />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-date">Ngày</label>
          <input type="date" id="hub-cf-date" class="hub-cf-form-input hub-cf-date-input" required />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-desc">Mô tả</label>
          <input type="text" id="hub-cf-desc" class="hub-cf-form-input"
                 placeholder="VD: Bún bò, Grab, Sách Clean Code..." maxlength="120" />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-category">Hạng mục</label>
          <select id="hub-cf-category" class="hub-cf-form-input hub-cf-category-select" required></select>
        </div>
        <div class="hub-cf-form-actions">
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--cancel" id="hub-cf-btn-cancel">Cancel</button>
          <button type="submit" class="hub-cf-modal-btn hub-cf-modal-btn--save" id="hub-cf-btn-save">Save</button>
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
    _refreshDashboard();
    _refreshLedger();
  }

  function _refreshDashboard() {
    const totalIncome = _getMonthlyIncome(_currentMonth.year, _currentMonth.month);
    const totalExpense = _getMonthlyExpense(_currentMonth.year, _currentMonth.month);
    const netWorth = _calcNetWorth();

    _setText('hub-cf-net-worth', _formatVND(netWorth));
    _setText('hub-cf-total-income', _formatVND(totalIncome));
    _setText('hub-cf-total-expense', _formatVND(totalExpense));
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
    _setText('hub-cf-month-label', label);
  }

  function _refreshTransactions() {
    const txs = _getMonthTransactions(_currentMonth.year, _currentMonth.month);
    const emptyEl = _qs('#hub-cf-empty-state');
    const tableEl = _qs('#hub-cf-table-wrap');
    const tbody   = _qs('#hub-cf-tx-body');
    const countEl = _qs('#hub-cf-tx-count');

    if (!emptyEl || !tableEl || !tbody) return;

    if (txs.length === 0) {
      emptyEl.style.display = 'flex';
      tableEl.style.display = 'none';
      if (countEl) countEl.textContent = '0 entries';
      return;
    }

    emptyEl.style.display = 'none';
    tableEl.style.display = '';
    if (countEl) countEl.textContent = txs.length + ' entries';

    // Sort by day desc
    txs.sort(function (a, b) { return (b.day || 0) - (a.day || 0); });

    var html = '';
    txs.forEach(function (tx) {
      const rowClass = tx.type === 'income' ? 'hub-cf-tx-income' : 'hub-cf-tx-expense';
      const isExpense = tx.type === 'expense';
      const prefix = isExpense ? '-' : '+';
      const amountFormatted = prefix + _formatVND(tx.amount).replace(/^\+/, '+').replace(/^-/, '-');
      const catName = _categoryDisplayName(tx.category, tx.type);

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
        const txId = this.getAttribute('data-tx-id');
        if (txId) _deleteTransaction(txId);
      });
    });
  }

  function _renderCategoryBreakdown() {
    const incomeMap = _getCategoryBreakdown(_currentMonth.year, _currentMonth.month, 'income');
    const expenseMap = _getCategoryBreakdown(_currentMonth.year, _currentMonth.month, 'expense');
    const totalIncome = Object.values(incomeMap).reduce(function (s, v) { return s + v; }, 0);
    const totalExpense = Object.values(expenseMap).reduce(function (s, v) { return s + v; }, 0);

    const container = _qs('hub-cf-breakdown-content');
    if (!container) return;

    var html = '';

    // Income breakdown
    const incomeCats = INCOME_CATEGORIES.filter(function (c) { return incomeMap[c.id] > 0; });
    if (incomeCats.length > 0) {
      incomeCats.forEach(function (cat) {
        const amt = incomeMap[cat.id];
        const pct = totalIncome > 0 ? Math.round((amt / totalIncome) * 100) : 0;
        html += '<div class="hub-cf-breakdown-item">';
        html += '<span class="hub-cf-breakdown-name">' + _escHtml(cat.name) + '</span>';
        html += '<span class="hub-cf-breakdown-amt hub-cf-breakdown-amt--income">' + _formatVND(amt) + ' (' + pct + '%)</span>';
        html += '</div>';
        html += '<div class="hub-cf-breakdown-bar-track"><div class="hub-cf-breakdown-bar-fill hub-cf-breakdown-bar-fill--income" style="width:' + pct + '%"></div></div>';
      });
    }

    // Expense breakdown
    const expenseCats = Object.entries(expenseMap).filter(function (e) { return e[1] > 0; });
    expenseCats.sort(function (a, b) { return b[1] - a[1]; });
    if (expenseCats.length > 0) {
      if (incomeCats.length > 0) {
        html += '<div style="margin-top: var(--space-md);"></div>';
      }
      expenseCats.forEach(function (_ref) {
        var catId = _ref[0], amt = _ref[1];
        var cat = _lookupCategory(catId, 'expense');
        var pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
        html += '<div class="hub-cf-breakdown-item">';
        html += '<span class="hub-cf-breakdown-name">' + _escHtml(cat.name) + '</span>';
        html += '<span class="hub-cf-breakdown-amt hub-cf-breakdown-amt--expense">' + _formatVND(amt) + ' (' + pct + '%)</span>';
        html += '</div>';
        html += '<div class="hub-cf-breakdown-bar-track"><div class="hub-cf-breakdown-bar-fill hub-cf-breakdown-bar-fill--expense" style="width:' + pct + '%"></div></div>';
      });
    }

    if (!html) {
      html = '<p style="color:var(--text-muted);font-size:0.76rem;text-align:center;padding:var(--space-md) 0;">No category data for this month</p>';
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

    // Chart filter change
    const filterEl = _qs('#hub-cf-chart-filter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        _chartFilter = this.value;
        _updateChart();
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
            label: 'Income',
            data: [],
            backgroundColor: incomeColor + 'b3',
            borderColor: incomeColor,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false
          },
          {
            label: 'Expense',
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