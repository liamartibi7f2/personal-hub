/* ================================================================
   Hub.OS — Collaboration Hub (Phase 2)
   ── Connection Flow + Gamified Co-working Dashboard
   ================================================================ */
const collaborationModule = (function () {
  'use strict';

  // ── State ──
  var _container = null;
  var KEY_STORAGE = 'hub_os_collab_keys';
  var _sidebarBtnInjected = false;
  var _connectionTimeout = null;

  // Phase 2 state
  var _isConnected = false;
  var _myHP = 10;
  var _partnerHP = 10;

  // ── Mock Data ──
  var MOCK_MY_STATUS = {
    name: 'You',
    hp: 10,
    presence: 'live',
    currentModule: 'Notes',
    isFocused: true,
    pomodoroTimeLeft: '25:00'
  };

  var MOCK_PARTNER_STATUS = {
    name: 'Budy',
    hp: 10,
    presence: 'online',
    currentModule: 'Flashcards',
    isFocused: false,
    idleMins: 2
  };

  var MOCK_MY_TASKS = [
    { id: 'my-1', desc: 'Finish Hub.OS dashboard redesign', deadline: null, done: false },
    { id: 'my-2', desc: 'Review PR #42 — auth middleware', deadline: null, done: false },
    { id: 'my-3', desc: 'Study SRS cards — Chinese Lesson 12', deadline: null, done: false }
  ];

  var MOCK_PARTNER_TASKS = [
    { id: 'pt-1', desc: 'Write unit tests for the quiz engine', deadline: Date.now() - 3600000, done: false },
    { id: 'pt-2', desc: 'Bug hunt — sidebar flicker on theme switch', deadline: Date.now() - 7200000, done: false },
    { id: 'pt-3', desc: 'Deploy v2.1 to staging', deadline: Date.now(), done: false }
  ];

  // ── Helpers ──
  function _generateKey() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var seg1 = '';
    var seg2 = '';
    for (var i = 0; i < 4; i++) {
      seg1 += chars.charAt(Math.floor(Math.random() * chars.length));
      seg2 += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'HUB-' + seg1 + '-' + seg2;
  }

  function _loadKeys() {
    try {
      var raw = localStorage.getItem(KEY_STORAGE);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function _saveKeys(keys) {
    try {
      localStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
    } catch (e) {}
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Sidebar button ──
  function _injectSidebarButton() {
    if (_sidebarBtnInjected) return;
    var footer = document.querySelector('.sidebar-footer');
    if (!footer) return;

    var btn = document.createElement('button');
    btn.id = 'btn-collab-hub';
    btn.className = 'hub-collab-sidebar-btn';
    btn.setAttribute('title', 'Collaboration Hub');
    btn.setAttribute('aria-label', 'Collaboration Hub');
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="7" cy="7" r="2.5"/>' +
        '<circle cx="17" cy="17" r="2.5"/>' +
        '<line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/>' +
      '</svg>';

    btn.addEventListener('click', function () {
      if (typeof app !== 'undefined' && app.switchTo) {
        app.switchTo('collab-hub');
      }
    });

    var themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      footer.insertBefore(btn, themeBtn);
    } else {
      footer.appendChild(btn);
    }

    _sidebarBtnInjected = true;
  }

  // ── Phase 1: Key History Rendering ──
  function _renderHistoryList() {
    var listEl = document.getElementById('hub-collab-history-list');
    var emptyEl = document.getElementById('hub-collab-empty');
    if (!listEl || !emptyEl) return;

    var keys = _loadKeys();

    if (!keys.length) {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    listEl.innerHTML = '';
    for (var i = 0; i < keys.length; i++) {
      var entry = keys[i];
      var item = document.createElement('div');
      item.className = 'hub-collab-history-item';
      item.setAttribute('data-key-index', String(i));

      var statusText = 'Status: Not Connected';
      if (entry.status === 'connected') {
        statusText = 'Connected: ' + (entry.connectedTo || 'Peer');
      }

      item.innerHTML =
        '<div class="hub-collab-key-info">' +
          '<code class="hub-collab-key-string">' + escapeHTML(entry.key) + '</code>' +
          '<span class="hub-collab-key-status">' + escapeHTML(statusText) + '</span>' +
        '</div>' +
        '<button class="hub-collab-key-delete" data-index="' + i + '" title="Delete key">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="18" y1="6" x2="6" y2="18"/>' +
            '<line x1="6" y1="6" x2="18" y2="18"/>' +
          '</svg>' +
        '</button>';

      listEl.appendChild(item);
    }
  }

  // ── Phase 1: Panel bindings ──
  function _bindPanel1Events() {
    var genBtn = document.getElementById('btn-collab-generate');
    if (genBtn) {
      genBtn.addEventListener('click', function () {
        var newKey = _generateKey();
        var keys = _loadKeys();
        keys.push({ key: newKey, status: 'not-connected', created: Date.now() });
        _saveKeys(keys);
        _renderHistoryList();
      });
    }

    var historyList = document.getElementById('hub-collab-history-list');
    if (historyList) {
      historyList.addEventListener('click', function (e) {
        var deleteBtn = e.target.closest('.hub-collab-key-delete');
        if (!deleteBtn) return;

        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
        if (isNaN(idx)) return;

        var keys = _loadKeys();
        if (idx < 0 || idx >= keys.length) return;

        var confirmed = confirm('Are you sure you want to delete this connection key?');
        if (!confirmed) return;

        keys.splice(idx, 1);
        _saveKeys(keys);
        _renderHistoryList();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 2 — Connection Flow
  // ══════════════════════════════════════════════════════════════

  function _bindPanel2ConnectionEvents() {
    var btnConnect = document.getElementById('hub-collab-btn-connect');
    var inputEl = document.getElementById('hub-collab-connect-input');
    if (!btnConnect || !inputEl) return;

    // Also allow Enter key to submit
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        _startConnection(btnConnect, inputEl);
      }
    });

    btnConnect.addEventListener('click', function () {
      _startConnection(btnConnect, inputEl);
    });
  }

  function _startConnection(btn, input) {
    var key = (input.value || '').trim().toUpperCase();
    if (!key) {
      var feedback = document.getElementById('hub-collab-connect-feedback');
      if (feedback) {
        feedback.textContent = 'Please enter a connection key.';
        feedback.className = 'hub-collab-connect-feedback hub-collab-connect-feedback--error';
      }
      return;
    }

    // Clear previous feedback
    var feedback = document.getElementById('hub-collab-connect-feedback');
    if (feedback) {
      feedback.textContent = '';
      feedback.className = 'hub-collab-connect-feedback';
    }

    // Show spinner, hide connect button
    var spinner = document.getElementById('hub-collab-spinner-container');
    btn.disabled = true;
    input.disabled = true;
    if (spinner) spinner.style.display = '';

    _connectionTimeout = setTimeout(function () {
      // Hide spinner
      if (spinner) spinner.style.display = 'none';
      btn.disabled = false;
      input.disabled = false;

      // 80% success chance
      var success = Math.random() < 0.8;

      if (success) {
        _onConnectionSuccess(input);
      } else {
        _onConnectionFailed(btn);
      }
    }, 2000);
  }

  function _onConnectionSuccess(input) {
    var feedback = document.getElementById('hub-collab-connect-feedback');
    if (feedback) {
      feedback.textContent = 'Connected!';
      feedback.className = 'hub-collab-connect-feedback hub-collab-connect-feedback--success';
    }

    // Flash the panel
    var panel = document.getElementById('hub-collab-panel-connect');
    if (panel) {
      panel.classList.add('hub-collab-connected-flash');
    }

    // After short delay, transition to dashboard
    _connectionTimeout = setTimeout(function () {
      _transitionToDashboard();
    }, 600);
  }

  function _onConnectionFailed(btn) {
    var feedback = document.getElementById('hub-collab-connect-feedback');
    if (feedback) {
      feedback.textContent = 'Connection failed. Please try again.';
      feedback.className = 'hub-collab-connect-feedback hub-collab-connect-feedback--error';
    }
    // Connect button already re-enabled in _startConnection upon timeout
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 2 — Dashboard Rendering
  // ══════════════════════════════════════════════════════════════

  function _transitionToDashboard() {
    _isConnected = true;

    // Reset HP
    _myHP = 10;
    _partnerHP = 10;
    MOCK_MY_STATUS.hp = 10;
    MOCK_PARTNER_STATUS.hp = 10;

    // Hide the 3-panel connection grid
    var connGrid = document.getElementById('hub-collab-connection-grid');
    if (connGrid) {
      connGrid.classList.add('hub-collab-connection-hidden');
    }

    // Show the dashboard
    var dashboard = document.getElementById('hub-collab-dashboard');
    if (dashboard) {
      dashboard.classList.add('hub-collab-dashboard--visible');
    }

    // Render contents
    _renderMyStatus();
    _renderPartnerStatus();
    _renderMyTasks();
    _renderPartnerTasks();

    // Bind attack events
    _bindAttackEvents();
  }

  function _renderHearts(hp) {
    var html = '<div class="hub-collab-hearts">';
    for (var i = 0; i < 10; i++) {
      var cls = i < hp ? 'hub-collab-heart--full' : 'hub-collab-heart--empty';
      html += '<span class="hub-collab-heart ' + cls + '">&#9829;</span>';
    }
    html += '</div>';
    return html;
  }

  function _renderPresencePill(presence) {
    var label, vcls;
    if (presence === 'live') {
      label = 'Live';
      vcls = 'hub-collab-pill--live';
    } else if (presence === 'away') {
      label = 'Away';
      vcls = 'hub-collab-pill--away';
    } else {
      label = 'Offline';
      vcls = 'hub-collab-pill--offline';
    }
    // Only wrap the label portion in a pill display
    return '<span class="hub-collab-pill ' + vcls + '">' + label + '</span>';
  }

  function _renderMyStatus() {
    var container = document.getElementById('hub-collab-my-status-inner');
    if (!container) return;

    var s = MOCK_MY_STATUS;
    var focusText = s.isFocused ? 'Pomodoro: ' + s.pomodoroTimeLeft : 'Not Focused';
    var focusCls = s.isFocused ? 'hub-collab-detail-value--accent' : '';

    container.innerHTML =
      '<div class="hub-collab-status-row">' +
        '<span class="hub-collab-username">' + escapeHTML(s.name) + '</span>' +
        _renderPresencePill(s.presence) +
      '</div>' +
      _renderHearts(s.hp) +
      '<p class="hub-collab-hp-label">HP ' + s.hp + '/10</p>' +
      '<ul class="hub-collab-detail-list" style="margin-top:var(--space-md)">' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Module</span>' +
          '<span class="hub-collab-detail-value">' + escapeHTML(s.currentModule) + '</span>' +
        '</li>' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Focus</span>' +
          '<span class="hub-collab-detail-value ' + focusCls + '">' + escapeHTML(focusText) + '</span>' +
        '</li>' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Status</span>' +
          '<span class="hub-collab-detail-value" style="color:var(\'--success\')">Active</span>' +
        '</li>' +
      '</ul>';
  }

  function _renderPartnerStatus() {
    var container = document.getElementById('hub-collab-partner-status-inner');
    if (!container) return;

    var s = MOCK_PARTNER_STATUS;
    var idleText = s.isFocused ? 'Pomodoro: 15:00' : 'Idle for: ' + s.idleMins + ' min' + (s.idleMins !== 1 ? 's' : '');
    var idleCls = s.isFocused ? 'hub-collab-detail-value--accent' : '';

    container.innerHTML =
      '<div class="hub-collab-status-row">' +
        '<span class="hub-collab-username">' + escapeHTML(s.name) + '</span>' +
        _renderPresencePill(s.presence) +
      '</div>' +
      '<div id="hub-collab-partner-hearts-container">' + _renderHearts(s.hp) + '</div>' +
      '<p class="hub-collab-hp-label">HP <span id="hub-collab-partner-hp-num">' + s.hp + '</span>/10</p>' +
      '<ul class="hub-collab-detail-list" style="margin-top:var(--space-md)">' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Module</span>' +
          '<span class="hub-collab-detail-value">' + escapeHTML(s.currentModule) + '</span>' +
        '</li>' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Focus</span>' +
          '<span class="hub-collab-detail-value ' + idleCls + '">' + escapeHTML(idleText) + '</span>' +
        '</li>' +
        '<li class="hub-collab-detail-item">' +
          '<span class="hub-collab-detail-label">Status</span>' +
          '<span class="hub-collab-detail-value">Active</span>' +
        '</li>' +
      '</ul>';
  }

  function _formatDeadline(deadline) {
    if (!deadline) return 'Open';

    var now = Date.now();
    var diff = deadline - now;

    if (diff < -3600000) {
      // More than 1 hour overdue
      var hours = Math.floor(Math.abs(diff) / 3600000);
      return { text:'Overdue: ' + hours + 'h ago', cls: 'hub-collab-task-deadline--overdue' };
    }
    if (diff < 0) {
      // Less than 1 hour but past
      return { text: 'Overdue: now', cls: 'hub-collab-task-deadline--overdue' };
    }
    if (diff < 3600000) {
      var mins = Math.ceil(diff / 60000);
      return { text: 'Due in: ' + mins + 'm', cls: 'hub-collab-task-deadline--imminent' };
    }
    var hours = Math.ceil(diff / 3600000);
    return { text: 'Due in: ' + hours + 'h', cls: '' };
  }

  function _isOverdue(deadline) {
    return deadline !== null && deadline < Date.now();
  }

  function _renderMyTasks() {
    var container = document.getElementById('hub-collab-my-tasks-inner');
    if (!container) return;

    var html = '<ul class="hub-collab-task-list">';
    for (var i = 0; i < MOCK_MY_TASKS.length; i++) {
      var t = MOCK_MY_TASKS[i];
      var dl = _formatDeadline(t.deadline);
      html +=
        '<li class="hub-collab-task-item">' +
          '<span class="hub-collab-task-desc">' + escapeHTML(t.desc) + '</span>' +
          '<span class="hub-collab-task-deadline ' + dl.cls + '">' + dl.text + '</span>' +
        '</li>';
    }
    html += '</ul>';
    container.innerHTML = html;
  }

  function _renderPartnerTasks() {
    var container = document.getElementById('hub-collab-partner-tasks-inner');
    if (!container) return;

    var html = '<ul class="hub-collab-task-list">';
    for (var i = 0; i < MOCK_PARTNER_TASKS.length; i++) {
      var t = MOCK_PARTNER_TASKS[i];
      var dl = _formatDeadline(t.deadline);
      var overdue = _isOverdue(t.deadline);

      html +=
        '<li class="hub-collab-task-item">' +
          '<span class="hub-collab-task-desc">' + escapeHTML(t.desc) + '</span>' +
          '<span class="hub-collab-task-deadline ' + dl.cls + '">' + dl.text + '</span>';

      // Attack button: only if overdue AND not done AND partner HP > 0
      if (overdue && !t.done) {
        html +=
          '<button class="hub-collab-btn-attack hub-collab-attack-btn" data-task-id="' + t.id + '" title="Attack this overdue task">' +
            '<span>&#9876;&#65039;</span> Attack' +
          '</button>';
      }

      html += '</li>';
    }
    html += '</ul>';
    container.innerHTML = html;
  }

  // ── Attack Logic ──
  function _bindAttackEvents() {
    var taskList = document.getElementById('hub-collab-partner-tasks-inner');
    if (!taskList) return;

    taskList.addEventListener('click', function (e) {
      var attackBtn = e.target.closest('.hub-collab-btn-attack');
      if (!attackBtn) return;

      var taskId = attackBtn.getAttribute('data-task-id');
      if (!taskId) return;

      _handleAttack(taskId);
    });
  }

  function _handleAttack(taskId) {
    if (_partnerHP <= 0) return;

    // Deduct HP
    _partnerHP--;
    MOCK_PARTNER_STATUS.hp = _partnerHP;

    // Update hearts visually
    var heartsContainer = document.getElementById('hub-collab-partner-hearts-container');
    if (heartsContainer) {
      heartsContainer.innerHTML = _renderHearts(_partnerHP);
    }

    // Update HP text
    var hpNum = document.getElementById('hub-collab-partner-hp-num');
    if (hpNum) {
      hpNum.textContent = String(_partnerHP);
    }

    // Find and remove the attack button for this task
    var allAttackBtns = document.querySelectorAll('.hub-collab-attack-btn');
    for (var i = 0; i < allAttackBtns.length; i++) {
      if (allAttackBtns[i].getAttribute('data-task-id') === taskId) {
        allAttackBtns[i].style.display = 'none';
        allAttackBtns[i].classList.remove('hub-collab-btn-attack');
        // Mark task as done so it doesn't reappear
      }
    }

    // Mark the mock task as done
    for (var j = 0; j < MOCK_PARTNER_TASKS.length; j++) {
      if (MOCK_PARTNER_TASKS[j].id === taskId) {
        MOCK_PARTNER_TASKS[j].done = true;
        break;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // BUILD HTML
  // ══════════════════════════════════════════════════════════════

  function _buildHTML() {
    return '' +
      '<div class="hub-collab-app">' +
        '<div class="hub-collab-header">' +
          '<h2 class="hub-collab-title">Collaboration Hub</h2>' +
          '<p class="hub-collab-subtitle">Connect and collaborate in real-time</p>' +
        '</div>' +

        /* ── Connection Grid (3 panels) ── */
        '<div class="hub-collab-grid" id="hub-collab-connection-grid">' +

          /* Panel 1 — Generate Collaboration Key */
          '<div class="hub-collab-panel hub-collab-panel--keys">' +
            '<div class="hub-collab-panel-header">' +
              '<h3>Generate Collaboration Key</h3>' +
              '<p>Create a key to share with a collaborator</p>' +
            '</div>' +
            '<button class="hub-collab-btn-generate" id="btn-collab-generate">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<circle cx="8" cy="15" r="5.5"/>' +
                '<line x1="8" y1="10" x2="8" y2="4"/>' +
                '<line x1="10" y1="7" x2="6" y2="7"/>' +
                '<line x1="19.5" y1="5.5" x2="12.5" y2="12.5"/>' +
              '</svg>' +
              'Generate Connection Key' +
            '</button>' +
            '<div class="hub-collab-history" id="hub-collab-history">' +
              '<h4 class="hub-collab-history-title">Key History</h4>' +
              '<div class="hub-collab-history-list" id="hub-collab-history-list"></div>' +
              '<p class="hub-collab-empty" id="hub-collab-empty">No keys generated yet. Click the button above to create one.</p>' +
            '</div>' +
          '</div>' +

          /* Panel 2 — Connect to Partner (Phase 2) */
          '<div class="hub-collab-panel hub-collab-panel--connect" id="hub-collab-panel-connect">' +
            '<div class="hub-collab-panel-header">' +
              '<h3>Connect to Partner</h3>' +
              '<p>Enter a collaboration key to start a session</p>' +
            '</div>' +
            '<div class="hub-collab-connect-form">' +
              '<input type="text" class="hub-collab-connect-input" id="hub-collab-connect-input" placeholder="HUB-XXXX-XXXX" maxlength="14" autocomplete="off">' +
              '<button class="hub-collab-btn-connect" id="hub-collab-btn-connect">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>' +
                  '<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>' +
                '</svg>' +
                'Connect' +
              '</button>' +
            '</div>' +
            '<div class="hub-collab-spinner-container" id="hub-collab-spinner-container" style="display:none">' +
              '<div class="hub-collab-spinner"></div>' +
              '<p class="hub-collab-spinner-text">Establishing connection...</p>' +
            '</div>' +
            '<p class="hub-collab-connect-feedback" id="hub-collab-connect-feedback"></p>' +
          '</div>' +

          /* Panel 3 — Placeholder (wide) */
          '<div class="hub-collab-panel hub-collab-panel--placeholder hub-collab-panel--wide">' +
            '<div class="hub-collab-placeholder">' +
              '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
                '<line x1="3" y1="9" x2="21" y2="9"/>' +
                '<line x1="9" y1="21" x2="9" y2="9"/>' +
              '</svg>' +
              '<h3>Phase 2</h3>' +
              '<p>Collaboration session dashboard coming soon</p>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ── Collaboration Dashboard (hidden initially) ── */
        '<div class="hub-collab-dashboard" id="hub-collab-dashboard">' +

          /* Row 1: My Status */
          '<div class="hub-collab-panel">' +
            '<div class="hub-collab-section-header">' +
              '<h3 class="hub-collab-section-title">My Status</h3>' +
            '</div>' +
            '<div id="hub-collab-my-status-inner"></div>' +
          '</div>' +

          /* Row 1: Partner Status */
          '<div class="hub-collab-panel">' +
            '<div class="hub-collab-section-header">' +
              '<h3 class="hub-collab-section-title">Partner Status</h3>' +
            '</div>' +
            '<div id="hub-collab-partner-status-inner"></div>' +
          '</div>' +

          /* Row 2: My Tasks */
          '<div class="hub-collab-panel">' +
            '<div class="hub-collab-section-header">' +
              '<h3 class="hub-collab-section-title">My Tasks</h3>' +
            '</div>' +
            '<div id="hub-collab-my-tasks-inner"></div>' +
          '</div>' +

          /* Row 2: Partner Tasks */
          '<div class="hub-collab-panel">' +
            '<div class="hub-collab-section-header">' +
              '<h3 class="hub-collab-section-title">Partner Tasks</h3>' +
            '</div>' +
            '<div id="hub-collab-partner-tasks-inner"></div>' +
          '</div>' +

          /* Row 3: Chat (full width) */
          '<div class="hub-collab-panel hub-collab-chat-row">' +
            '<div class="hub-collab-chat-placeholder">' +
              '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' +
              '</svg>' +
              '<h4>Session Chat</h4>' +
              '<p>Chat integration coming in Phase 3</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Module lifecycle ──
  function render(container) {
    if (!container) return;
    _container = container;
    _isConnected = false;
    _myHP = 10;
    _partnerHP = 10;
    MOCK_MY_STATUS.hp = 10;
    MOCK_PARTNER_STATUS.hp = 10;

    _container.innerHTML = _buildHTML();
    _renderHistoryList();
    _bindPanel1Events();
    _bindPanel2ConnectionEvents();
  }

  function destroy() {
    if (_connectionTimeout) {
      clearTimeout(_connectionTimeout);
      _connectionTimeout = null;
    }
    _container = null;
    _isConnected = false;
  }

  // Inject sidebar button on script load
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    _injectSidebarButton();
  } else {
    document.addEventListener('DOMContentLoaded', _injectSidebarButton, { once: true });
  }

  return {
    id: 'collab-hub',
    name: 'Collab Hub',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/></svg>',
    render: render,
    destroy: destroy
  };
})();

// Auto-register
if (typeof app !== 'undefined' && app.register) {
  app.register(collaborationModule);
}