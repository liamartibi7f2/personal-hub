# Pocket Debt (Sổ nợ bỏ túi) — Integration Guide

## Overview

This guide shows exactly how to integrate the Pocket Debt feature into your existing `cashflow.js` module. The integration follows the existing architecture patterns: IIFE module, shared state (`_data`), debounced persistence via `HubDB`, and glassmorphism UI with JetBrains Mono.

---

## 1. Data Structure Changes

### In `_defaultData()` (around line 276-282), add `debts` array:

```javascript
function _defaultData() {
  return {
    startingBalance: 0,
    balanceSnapshots: [],
    transactions: [],
    debts: []  // ← ADD THIS LINE
  };
}
```

### In `_ensureDefault()` (around line 435-440), ensure debts array exists:

```javascript
function _ensureDefault() {
  if (!_data) _data = _defaultData();
  if (!Array.isArray(_data.transactions)) _data.transactions = [];
  if (!Array.isArray(_data.balanceSnapshots)) _data.balanceSnapshots = [];
  if (!Array.isArray(_data.debts)) _data.debts = [];  // ← ADD THIS LINE
  if (typeof _data.startingBalance !== 'number') _data.startingBalance = 0;
}
```

---

## 2. Add Pocket Debt I18N Dictionary

Add the `POCKET_DEBT_I18N` object and helper `_pd_t()` near the existing `CASHFLOW_I18N` (around line 184):

```javascript
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
    emptyHistory:        'Chưa có khoản nợ nào được trả.'
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
    emptyHistory:        'No paid debts yet.'
  }
};

function _pd_t(key) {
  var lang = _getCFLang();
  var dict = POCKET_DEBT_I18N[lang] || POCKET_DEBT_I18N['vi'];
  return dict[key] || (POCKET_DEBT_I18N['vi'][key] || key);
}
```

---

## 3. Add Debt Utility Functions

Add these helper functions after `_ensureDefault()` (around line 440):

```javascript
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
```

---

## 4. Add Computation Functions

Add after `_calcSavings()` (around line 1192):

```javascript
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
```

---

## 5. Add Render Functions

Add after `_renderCategoryBreakdown()` (around line 1355):

```javascript
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
  return '<!-- ═══ POCKET DEBT LEDGER ═══ -->' +
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

function _refreshDebtSummary() {
  var totalPending = _getTotalPendingDebt();
  _setTextById('cf-debt-pending', _formatVNFull(totalPending));
}

function _refreshDebtLedger() {
  var activeDebts = _getActiveDebts();
  var paidDebts = _getPaidDebts();
  var tbody = _qs('#hub-cf-debt-body');
  var emptyEl = _qs('#hub-cf-debt-empty-state');
  var tableEl = _qs('#hub-cf-debt-table-wrap');
  var historyList = _qs('#hub-cf-debt-history-list');
  var historyEmpty = _qs('#hub-cf-debt-history-empty');

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

  // History
  if (historyList && historyEmpty) {
    if (paidDebts.length === 0) {
      historyList.innerHTML = '';
      historyEmpty.style.display = 'block';
    } else {
      historyEmpty.style.display = 'none';
      var historyHtml = '';
      paidDebts.forEach(function (debt) { historyHtml += _renderDebtHistoryItem(debt); });
      historyList.innerHTML = historyHtml;
    }
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
}
```

---

## 6. Add Debt Operations

Add after `_deleteTransaction()` (around line 1684):

```javascript
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
```

---

## 7. Add Modal HTML and Handlers

### In `render()` method, inject the Debt Summary Card into the dashboard grid

Around line 748-780, change the summary grid from 2×2 to 3×2 (6 cards) to include Pocket Debt:

```html
<!-- ═══ DASHBOARD — 3×2 Summary Grid ═══ -->
<div class="cashflow-summary-grid">
  <!-- Card 1: Net Worth -->
  <div class="hub-cf-card">...</div>
  <!-- Card 2: Savings & Investments -->
  <div class="hub-cf-card">...</div>
  <!-- Card 3: Income -->
  <div class="hub-cf-card">...</div>
  <!-- Card 4: Expense -->
  <div class="hub-cf-card">...</div>
  <!-- Card 5: Pocket Debt Summary (NEW) -->
  ${_renderDebtSummaryCard()}
</div>
```

### Inject the Debt Ledger after the Transaction Ledger (around line 864):

```html
<!-- Transaction Ledger (existing) -->
</div>

<!-- Pocket Debt Ledger (NEW) -->
${_renderDebtLedgerHTML()}

<!-- AI Financial Advisor (existing) -->
<div class="hub-cf-ai-advisor glass-card">...</div>
```

### Inject Add Debt Modal alongside the existing transaction modal (around line 909-953):

```html
<!-- ═══ QUICK-ADD MODAL (existing) ═══ -->
<div class="hub-cf-overlay" id="hub-cf-overlay" ...>...</div>

<!-- ═══ ADD DEBT MODAL (NEW) ═══ -->
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
          <input type="text" id="hub-cf-debt-debtor" class="hub-cf-form-input" placeholder="${_pd_t('placeholderDebtor')}" maxlength="80" required />
        </div>
        <div class="hub-cf-form-group">
          <label class="hub-cf-form-label" for="hub-cf-debt-amount" data-i18n="labelAmount">${_pd_t('labelAmount')}</label>
          <input type="number" id="hub-cf-debt-amount" class="hub-cf-form-input hub-cf-amount-input" placeholder="${_pd_t('placeholderAmount')}" min="0" step="1000" required inputmode="numeric" />
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
          <textarea id="hub-cf-debt-note" class="hub-cf-form-input hub-cf-textarea" placeholder="${_pd_t('placeholderNote')}" maxlength="200" rows="2"></textarea>
        </div>
        <div class="hub-cf-form-actions">
          <button type="button" class="hub-cf-modal-btn hub-cf-modal-btn--cancel" id="hub-cf-debt-btn-cancel" data-i18n="btnCancel">${_pd_t('btnCancel')}</button>
          <button type="submit" class="hub-cf-modal-btn hub-cf-modal-btn--save" id="hub-cf-debt-btn-save" data-i18n="btnSave">${_pd_t('btnSave')}</button>
        </div>
      </form>
    </div>
  </div>
</div>
```

---

## 8. Add Event Binding

In `_bindEvents()` (around line 1518), add:

```javascript
// Bind Debt events
_bindDebtEvents();
```

Add the `_bindDebtEvents()` function after `_bindAIAdvisorEvents()` (around line 2681):

```javascript
function _bindDebtEvents() {
  // Add Debt button
  var addBtn = _qs('#hub-cf-btn-add-debt');
  if (addBtn) {
    addBtn.addEventListener('click', _openDebtModal);
  }

  // History toggle
  var historyToggle = _qs('#hub-cf-debt-history-toggle');
  var historySection = _qs('#hub-cf-debt-history');
  if (historyToggle && historySection) {
    historyToggle.addEventListener('click', function () {
      historySection.classList.toggle('collapsed');
      historyToggle.textContent = historySection.classList.contains('collapsed')
        ? _pd_t('toggleHistory')
        : _pd_t('historyTitle');
    });
  }

  // Modal close
  var closeBtn = _qs('#hub-cf-debt-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', _closeDebtModal);

  // Modal cancel
  var cancelBtn = _qs('#hub-cf-debt-btn-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', _closeDebtModal);

  // Overlay backdrop
  var overlay = _qs('#hub-cf-debt-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeDebtModal();
    });
  }

  // Form submit
  var form = _qs('#hub-cf-debt-form');
  if (form) {
    form.addEventListener('submit', _handleDebtFormSubmit);
  }
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
  if (overlay) overlay.style.display = 'none';
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

  _addDebt(
    debtorName.value.trim(),
    Number(amount.value),
    dateBorrowed.value,
    expectedReturn.value,
    note ? note.value.trim() : ''
  );
  _closeDebtModal();
}
```

---

## 9. Update `_refreshLedger()` to call debt refresh

In `_refreshLedger()` (around line 1194), add:

```javascript
function _refreshLedger() {
  _updateMonthLabel();
  _refreshTransactions();
  _renderCategoryBreakdown();
  _refreshDebtSummary();   // ← ADD
  _refreshDebtLedger();    // ← ADD
}
```

---

## 10. Update `updateCashFlowLanguage()` to include debt

In `updateCashFlowLanguage()` (around line 1049), add:

```javascript
function updateCashFlowLanguage(lang) {
  ...
  // After existing re-renders:
  _refreshLedger();
  _updateChart();
  _updateDebtLanguage();   // ← ADD
}
```

---

## 11. Load CSS

In your main HTML or app.js, include the stylesheet:

```html
<link rel="stylesheet" href="modules/pocket-debt-styles.css">
```

Or inject via JS in `render()`:

```javascript
if (!document.getElementById('pocket-debt-styles')) {
  var link = document.createElement('link');
  link.id = 'pocket-debt-styles';
  link.rel = 'stylesheet';
  link.href = 'modules/pocket-debt-styles.css';
  document.head.appendChild(link);
}
```

---

## 12. Summary of Files

| File | Purpose |
|------|---------|
| `modules/pocket-debt-integration.js` | Complete standalone module (can be loaded separately) |
| `modules/pocket-debt-styles.css` | All styling for Pocket Debt |
| `modules/pocket-debt-integration-guide.md` | This guide |

---

## 13. Testing Checklist

- [ ] Add a debt: Open modal → Fill form → Save → Appears in ledger with "Đang chờ" status
- [ ] Mark as paid: Click "Đã trả" → Confirm → Row moves to history → Toast shows
- [ ] Add to income: After marking paid, confirm prompt → Transaction appears in CashFlow ledger under "Thu nhập khác"
- [ ] Overdue detection: Set expected date in past → Row highlights red/orange, status shows "Quá hạn"
- [ ] Delete debt: Click ✕ → Confirm → Debt removed
- [ ] Language toggle: Switch EN/VI in settings → All labels update
- [ ] Persistence: Refresh page → Debts persist via HubDB
- [ ] Chart/Dashboard: Net worth card updates correctly with debt collections

---

## Architecture Notes

- **No separate storage**: Debts live in `_data.debts` and persist via existing `HubDB.saveCashFlowData()`
- **No new API calls**: Uses existing `_debouncedPersist()` mechanism
- **Consistent styling**: All classes follow `hub-cf-*` / `hub-cf-debt-*` naming convention
- **Terminal aesthetic**: JetBrains Mono, uppercase labels, status pills, glowing accents
- **Accessibility**: ARIA labels, keyboard navigation, focus states
- **Responsive**: Table hides date columns on mobile; modal adapts to viewport