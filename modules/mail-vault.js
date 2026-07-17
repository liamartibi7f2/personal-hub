/* ============================================================
   HUB.OS — modules/mail-vault.js
   Mail Vault (Admin Only) — Real-time Firestore-powered data
   table for generated email accounts.

   ACCESS GUARD: Only renders for [SYSTEM ADMIN] users.
   Uses Firebase onSnapshot to listen to admin_mail_vault
   collection live.
   ============================================================ */

const mailVaultModule = (function () {
  'use strict';

  // ── Config ──
  const ADMIN_EMAIL   = 'admin@hubos.com';              // Must match auth-ui.js
  const COLLECTION     = 'admin_mail_vault';

  let _unsubscribe   = null;   // Firestore onSnapshot cleanup function
  let _rowsById      = {};     // Map docId → { email, password, jwt_token, type, created_at, docId }
  let _tableBody     = null;
  let _emptyState    = null;
  let _countBadge    = null;

  // ── Module Definition ──

  const module = {
    id: 'mail-vault',
    name: 'Mail Vault',
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <path d="M2 7l10 7 10-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="12" r="1.5" fill="var(--accent-primary)" opacity="0.7"/>
      <path d="M7 20l1.5-4h7l1.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
    </svg>`,

    /* ──────────────────────────────────────────────
       render(container) — Build the vault UI
       ────────────────────────────────────────────── */
    render(container) {
      // ── Guard: [SYSTEM ADMIN] only ──
      const user = (typeof HubAuth !== 'undefined') ? HubAuth.getUser() : null;
      const isAdmin = user && user.email &&
                      user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

      if (!isAdmin) {
        container.innerHTML = `
          <div class="tab-content hub-mail-vault-denied">
            <div class="hub-mail-vault-lock-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="var(--danger)" stroke-width="1.5"/>
                <path d="M8 11V7a4 4 0 018 0v4" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="12" cy="16" r="1.5" fill="var(--danger)"/>
                <path d="M12 8v2" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <h2 class="hub-mail-vault-denied-title">ACCESS DENIED</h2>
            <p class="hub-mail-vault-denied-sub">
              This module is restricted to <strong>[SYSTEM ADMIN]</strong> accounts only.<br>
              Log in with an authorized admin account to access the Mail Vault.
            </p>
          </div>
        `;
        return;
      }

      // ── Admin is authenticated — render the full vault ──
      container.innerHTML = `
        <div class="tab-content hub-mail-vault">

          <!-- Header -->
          <div class="hub-mail-vault-header">
            <div class="hub-mail-vault-header-left">
              <div class="hub-mail-vault-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="4" width="20" height="16" rx="2" stroke="var(--accent-primary)" stroke-width="1.5"/>
                  <path d="M2 7l10 7 10-7" stroke="var(--accent-primary)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div>
                <h2 class="hub-mail-vault-title">Mail Vault</h2>
                <p class="hub-mail-vault-subtitle">Admin-only email account registry — live-synced</p>
              </div>
            </div>
            <div class="hub-mail-vault-badge" id="hub-mail-vault-count">— accounts</div>
          </div>

          <!-- Empty state (hidden by default) -->
          <div class="hub-mail-vault-empty" id="hub-mail-vault-empty">
            <div class="hub-mail-vault-empty-icon">📭</div>
            <p class="hub-mail-vault-empty-title">No accounts yet</p>
            <p class="hub-mail-vault-empty-sub">
              Use the Telegram Bot <code>/add</code> command to generate DuckMail accounts.<br>
              They will appear here in real-time.
            </p>
          </div>

          <!-- Table -->
          <div class="hub-mail-vault-table-wrap glass-card">
            <table class="hub-mail-vault-table" id="hub-mail-vault-table">
              <thead>
                <tr>
                  <th class="hub-mail-vault-col-email">Email</th>
                  <th class="hub-mail-vault-col-password">Password</th>
                  <th class="hub-mail-vault-col-type">Type</th>
                  <th class="hub-mail-vault-col-date">Date Added</th>
                </tr>
              </thead>
              <tbody id="hub-mail-vault-tbody">
                <!-- Populated by onSnapshot -->
              </tbody>
            </table>
          </div>

          <!-- Footer hint -->
          <div class="hub-mail-vault-footer">
            <span class="hub-mail-vault-footer-dot"></span>
            <span id="hub-mail-vault-sync-status">Listening for changes...</span>
          </div>

        </div><!-- /hub-mail-vault -->
      `;

      // ── Cache DOM refs ──
      _tableBody  = document.getElementById('hub-mail-vault-tbody');
      _emptyState = document.getElementById('hub-mail-vault-empty');
      _countBadge = document.getElementById('hub-mail-vault-count');

      // ── Start real-time Firestore listener ──
      this._startListener();
    },

    /* ──────────────────────────────────────────────
       destroy() — Cleanup on tab switch
       ────────────────────────────────────────────── */
    destroy() {
      if (_unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
      }
      _rowsById = {};
      _tableBody = null;
      _emptyState = null;
      _countBadge = null;
    },

    /* ──────────────────────────────────────────────
       _startListener() — onSnapshot on admin_mail_vault
       ────────────────────────────────────────────── */
    _startListener() {
      const db = firebase.firestore();
      if (!db) {
        _showSyncError('Firestore not available');
        return;
      }

      try {
        _unsubscribe = db.collection(COLLECTION)
          .orderBy('created_at', 'desc')
          .onSnapshot(
            (snapshot) => {
              _handleSnapshot(snapshot);
              _setSyncStatus('Live — synced', true);
            },
            (error) => {
              console.error('[MailVault] onSnapshot error:', error);
              _showSyncError(error.message || 'Permission denied');
            }
          );
      } catch (err) {
        console.error('[MailVault] Failed to start listener:', err);
        _showSyncError(err.message || 'Unknown error');
      }
    },

    /* ──────────────────────────────────────────────
       _handleSnapshot(snapshot) — Process changes
       ────────────────────────────────────────────── */
    _handleSnapshot(snapshot) {
      if (!snapshot) return;

      // Track existing IDs to detect deletions
      const newIds = new Set();

      snapshot.docChanges().forEach((change) => {
        const doc   = change.doc;
        const data  = doc.data();
        const docId = doc.id;

        if (change.type === 'removed') {
          delete _rowsById[docId];
        } else {
          // added or modified
          newIds.add(docId);
          _rowsById[docId] = {
            email:      data.email      || '—',
            password:   data.password   || '—',
            jwt_token:  data.jwt_token  || '',
            type:       data.type       || 'DuckMail',
            created_at: data.created_at || null,
            docId:      docId
          };
        }
      });

      // Also capture doc deletions that may not appear in docChanges
      const currentIds = new Set();
      snapshot.forEach((doc) => {
        currentIds.add(doc.id);
        if (!newIds.has(doc.id)) {
          // This doc wasn't in docChanges but is in the snapshot → initial load
          const data = doc.data();
          newIds.add(doc.id);
          _rowsById[doc.id] = {
            email:      data.email      || '—',
            password:   data.password   || '—',
            jwt_token:  data.jwt_token  || '',
            type:       data.type       || 'DuckMail',
            created_at: data.created_at || null,
            docId:      doc.id
          };
        }
      });

      // Remove docs no longer in snapshot
      Object.keys(_rowsById).forEach((id) => {
        if (!currentIds.has(id)) {
          delete _rowsById[id];
        }
      });

      // Re-render the table
      _renderTable();
    }
  };

  // ── Private: Render the table rows ──

  function _renderTable() {
    const entries = Object.values(_rowsById);
    // Sort by created_at descending (newest first)
    entries.sort((a, b) => {
      const ta = _toTimestamp(a.created_at);
      const tb = _toTimestamp(b.created_at);
      return tb - ta;
    });

    // Update count badge
    if (_countBadge) {
      _countBadge.textContent = `${entries.length} account${entries.length !== 1 ? 's' : ''}`;
    }

    // Toggle empty state
    if (_emptyState) {
      _emptyState.style.display = entries.length === 0 ? '' : 'none';
    }

    const tableEl = document.getElementById('hub-mail-vault-table');
    if (tableEl) {
      tableEl.style.display = entries.length === 0 ? 'none' : '';
    }

    if (!_tableBody) return;

    // Build row HTML
    _tableBody.innerHTML = entries.map((entry, idx) => {
      const email     = _escapeHtml(entry.email);
      const password  = _escapeHtml(entry.password);
      const mailType  = _escapeHtml(entry.type);
      const dateStr   = _formatDate(entry.created_at);
      const docId     = entry.docId;
      const rowId     = `mv-row-${idx}`;
      const maskId    = `mv-mask-${idx}`;

      // Type badge class
      const typeClass = _typeToClass(mailType);

      return `
        <tr class="hub-mail-vault-row" id="${rowId}" data-doc-id="${docId}">
          <td class="hub-mail-vault-cell hub-mail-vault-cell-email" data-label="Email">
            <div class="hub-mail-vault-email-wrap">
              <svg class="hub-mail-vault-email-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>
                <path d="M2 7l10 7 10-7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
              </svg>
              <span class="hub-mail-vault-email-text" title="${email}" data-full="${email}">${email}</span>
            </div>
          </td>
          <td class="hub-mail-vault-cell hub-mail-vault-cell-password" data-label="Password">
            <button class="hub-mail-vault-password-btn" id="${maskId}"
                    data-password="${password}"
                    data-revealed="false"
                    title="Click to reveal password"
                    aria-label="Toggle password visibility">
              <span class="hub-mail-vault-password-mask">${'•'.repeat(Math.min(password.length, 24))}</span>
              <svg class="hub-mail-vault-password-eye" width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 5 7 11 7s9.27-3.11 11-7c-1.73-3.89-5-7-11-7z" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
          </td>
          <td class="hub-mail-vault-cell hub-mail-vault-cell-type" data-label="Type">
            <span class="hub-mail-vault-type-badge ${typeClass}">${mailType}</span>
          </td>
          <td class="hub-mail-vault-cell hub-mail-vault-cell-date" data-label="Date Added">
            <span class="hub-mail-vault-date">${dateStr}</span>
          </td>
        </tr>
      `;
    }).join('');

    // ── Bind password toggle click handlers ──
    _tableBody.querySelectorAll('.hub-mail-vault-password-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const revealed = this.dataset.revealed === 'true';
        const password = this.dataset.password;
        const maskSpan = this.querySelector('.hub-mail-vault-password-mask');

        if (revealed) {
          // Hide
          maskSpan.textContent = '•'.repeat(Math.min(password.length, 24));
          this.dataset.revealed = 'false';
          this.classList.remove('hub-mail-vault-password-btn--revealed');
        } else {
          // Reveal
          maskSpan.textContent = password;
          this.dataset.revealed = 'true';
          this.classList.add('hub-mail-vault-password-btn--revealed');

          // Auto-hide after 8 seconds for security
          const btnRef = this;
          const autoHideTimer = parseInt(btnRef.dataset.autoHideTimer || '0', 10);
          if (autoHideTimer) clearTimeout(autoHideTimer);
          btnRef.dataset.autoHideTimer = setTimeout(() => {
            if (btnRef.dataset.revealed === 'true') {
              btnRef.querySelector('.hub-mail-vault-password-mask').textContent =
                '•'.repeat(Math.min(btnRef.dataset.password.length, 24));
              btnRef.dataset.revealed = 'false';
              btnRef.classList.remove('hub-mail-vault-password-btn--revealed');
            }
          }, 8000);
        }
      });
    });
  }

  // ── Private helpers ──

  function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function _toTimestamp(val) {
    if (!val) return 0;
    // Firestore Timestamp (compat SDK)
    if (val.toMillis && typeof val.toMillis === 'function') return val.toMillis();
    // JavaScript Date
    if (val instanceof Date) return val.getTime();
    // ISO string
    if (typeof val === 'string') return new Date(val).getTime();
    // Number (millis)
    if (typeof val === 'number') return val;
    return 0;
  }

  function _formatDate(val) {
    const ms = _toTimestamp(val);
    if (!ms) return '—';

    const d = new Date(ms);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    // Full date for older entries
    return d.toLocaleDateString('en-US', {
      year:  'numeric',
      month: 'short',
      day:   'numeric',
      hour:  '2-digit',
      minute:'2-digit'
    });
  }

  function _typeToClass(type) {
    const t = (type || '').toLowerCase().replace(/\s+/g, '-');
    if (t === 'duckmail')   return 'hub-mail-vault-type-duckmail';
    if (t === 'mailtm')     return 'hub-mail-vault-type-mailtm';
    if (t === 'temp-mail')  return 'hub-mail-vault-type-tempmail';
    return 'hub-mail-vault-type-other';
  }

  function _setSyncStatus(text, ok) {
    const el = document.getElementById('hub-mail-vault-sync-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? 'var(--success)' : 'var(--danger)';

    const dot = document.querySelector('.hub-mail-vault-footer-dot');
    if (dot) {
      dot.classList.toggle('hub-mail-vault-footer-dot--live', ok);
      dot.classList.toggle('hub-mail-vault-footer-dot--error', !ok);
    }
  }

  function _showSyncError(message) {
    _setSyncStatus(`Error: ${message}`, false);

    // If table is empty, show a helpful message
    if (_tableBody && Object.keys(_rowsById).length === 0) {
      _tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="hub-mail-vault-error-cell">
            <div class="hub-mail-vault-error-msg">
              <span class="hub-mail-vault-error-icon">⚠️</span>
              <p><strong>Connection Error</strong></p>
              <p class="hub-mail-vault-error-detail">${_escapeHtml(message)}</p>
              <p class="hub-mail-vault-error-hint">
                Make sure Firestore security rules allow read access to<br>
                the <code>admin_mail_vault</code> collection.
              </p>
            </div>
          </td>
        </tr>
      `;
    }
  }

  return module;
})();

// ── Register with the app router ──
if (typeof app !== 'undefined' && app.register) {
  app.register(mailVaultModule);
}