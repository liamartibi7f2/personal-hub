/* ============================================================
   HUB.OS — modules/pomodoro.js
   Pomodoro timer with circular SVG progress ring,
   focus/break modes, premium settings modal, professional
   statistics dashboard with weekly chart, looping
   audio alarm with 5 hardcoded URL profiles + classic beep.

   FEATURES:
     - Cycle System (4 Pomodoros → Long Break)
     - Penalty 1: "Sleeping on Victory" (Grace Period after breaks)
     - Penalty 2: "Giving up halfway" (Early Cancel detection)
     - Prodex event dispatch for success/fail

   Module contract:
     - id: 'pomodoro'
     - render(container) -> injects the timer + stats UI
     - destroy()        -> cleans up intervals and state
   ============================================================ */

const pomodoroModule = (function () {
  'use strict';

  // --- Constants ---
  const REFERENCE_KEY = 'hub_pomodoro_ref';
  const ALARM_LOOP_MS = 2000;
  const GRACE_SECONDS = 60; // 1-minute grace period

  // --- In-memory cloud-backed data ---
  let _pomodoroData      = null;
  let _pomodoroDataLoaded = false;
  let _pageUnloading     = false;

  // ── LocalStorage keys for stats features ──
  const LS_LAST_ACTIVE_DATE = 'hub_pomodoro_lastActiveDate';
  const LS_DAILY_HISTORY    = 'hub_pomodoro_dailyHistory';   // { 'YYYY-MM-DD': { minutes: N, completed: N } }
  const LS_TOTAL_FOCUS      = 'hub_pomodoro_totalFocus';     // minutes (legacy fallback)

  // ── Ghost save guard ──
  window.addEventListener('beforeunload', function () {
    _pageUnloading = true;
  });

  // --- Hardcoded Sound Profiles ---
  const SOUND_PROFILES = [
    { key: 'classic',    label: 'Classic' },
    { key: 'undertale',  label: 'Undertale' },
    { key: 'minecraft',  label: 'Minecraft' },
    { key: 'steven',     label: 'Steven Universe' },
    { key: 'bell1',      label: 'Bell 1' },
    { key: 'bell2',      label: 'Bell 2' }
  ];

  const SOUND_URLS = {
    undertale: './undertale.mp3',
    minecraft: './minecraft.mp3',
    steven:    './steven.mp3',
    bell1:     './bell1.mp3',
    bell2:     './bell2.mp3'
  };

  // --- Default settings (in minutes) ---
  const DEFAULT_SETTINGS = {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    soundProfile: 'classic',
    autoStartBreaks: false,
    autoStartFocus: false
  };

  // --- Default stats structure ---
  const DEFAULT_STATS = {
    totalFocusSeconds: 0,
    completedPomodoros: 0,
    dailyHistory: {},       // { 'YYYY-MM-DD': seconds }
    lastCompletedDate: null  // 'YYYY-MM-DD'
  };

  // --- SVG ring geometry ---
  const RING_RADIUS        = 120;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ~ 753.98

  // --- Modes ---
  const MODES = [
    { key: 'focus',      label: 'Focus',       settingKey: 'focus' },
    { key: 'shortBreak', label: 'Short Break', settingKey: 'shortBreak' },
    { key: 'longBreak',  label: 'Long Break',  settingKey: 'longBreak' }
  ];

  // --- Private state ---
  let _settings          = { ...DEFAULT_SETTINGS };
  let _currentMode       = 'focus';
  let _secondsRemaining  = 0;
  let _totalSeconds      = 0;
  let _isRunning         = false;
  let _timerInterval     = null;
  let _alarmInterval     = null;
  let _alarmAudio        = null;
  let _alarmRinging      = false;
  let _container         = null;
  let _audioCtx          = null;
  let _settingsOpen      = false;
  let _escapeHandler     = null;
  let _chartRange        = 'week';
  let _lastTickTime      = null;

  // --- Cycle System ---
  let _currentCycle      = 0;   // completed pomodoros this cycle block
  let _targetCycles      = 4;   // pomodoros before a long break

  // --- Grace Period ---
  let _inGracePeriod     = false; // currently counting down the 60s grace

  // --- Early Cancel ---
  let _focusStartTime    = null; // Date.now() when a focus session starts
  let _isFocusSession    = false;

  // =============================================================
  //  PUBLIC API
  // =============================================================

  async function render(container) {
    _container = container;
    _settingsOpen = false;

    // 1) Show loading state immediately
    container.innerHTML =
      '<div class="tab-content" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
        '<div style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem">' +
          '<span style="color:var(--accent-cyan)">●</span> Loading timer...' +
        '</div>' +
      '</div>';

    // 2) Await cloud/offline data
    await _loadPomodoroDataAsync();

    // 3) Sync the local _settings from the loaded data
    var s = _getSettings();
    _settings.focus      = s.focus;
    _settings.shortBreak = s.shortBreak;
    _settings.longBreak  = s.longBreak;
    _settings.soundProfile     = s.soundProfile;
    _settings.autoStartBreaks  = s.autoStartBreaks;
    _settings.autoStartFocus   = s.autoStartFocus;

    // 4) Try to restore a running timer from localStorage
    if (!_restoreTimerState()) {
      _currentMode = 'focus';
      _setDuration(_settings.focus);
      _isRunning = false;
      _currentCycle = 0;
      _inGracePeriod = false;
      _focusStartTime = null;
      _isFocusSession = false;
    }

    // 5) Strict streak check: if lastActiveDate is older than yesterday, show 0
    _checkStreakOnLoad();

    _renderApp();
  }

  /**
   * On app load, check if the lastActiveDate gap is >1 day.
   * If the streak is already broken, write nothing — _calculateStreak() will
   * return 0 on next UI render because the date gap is visible.
   */
  function _checkStreakOnLoad() {
    var lastActive = _readLastActiveDate();
    if (!lastActive) return;

    var todayKey     = _getDateKey(new Date());
    var yesterdayKey = _getDateKey(new Date(Date.now() - 86400000));

    // If lastActive is older than yesterday, streak is broken
    if (lastActive !== todayKey && lastActive !== yesterdayKey) {
      // Remove lastActiveDate so _calculateStreak() returns 0
      try { localStorage.removeItem(LS_LAST_ACTIVE_DATE); } catch (_) { /* ignore */ }
    }
  }

  function destroy() {
    _saveTimerState();
    _stopAlarmInternal();

    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }

    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
      _escapeHandler = null;
    }

    _container = null;
  }

  // =============================================================
  //  HUBDB DATA LAYER
  // =============================================================

  async function _loadPomodoroDataAsync() {
    if (_pomodoroDataLoaded) return;
    try {
      var data = await HubDB.loadPomodoroData();
      if (data) {
        _pomodoroData = data;
      }
    } catch (_) {}
    if (!_pomodoroData) {
      _pomodoroData = {
        work: 25,
        shortBreak: 5,
        longBreak: 15,
        soundProfile: 'classic',
        autoStartBreaks: false,
        autoStartFocus: false,
        totalFocusMinutes: 0,
        completedSessions: 0,
        dailyHistory: {},
        lastCompletedDate: null
      };
    }
    _pomodoroDataLoaded = true;
  }

  function _savePomodoroData() {
    if (_pageUnloading) return;
    if (!_pomodoroData) return;
    HubDB.savePomodoroData(_pomodoroData).catch(function () {});
  }

  function _getSettings() {
    if (!_pomodoroData) {
      return { focus: 25, shortBreak: 5, longBreak: 15, soundProfile: 'classic', autoStartBreaks: false, autoStartFocus: false };
    }
    return {
      focus: _pomodoroData.work || 25,
      shortBreak: _pomodoroData.shortBreak || 5,
      longBreak: _pomodoroData.longBreak || 15,
      soundProfile: _pomodoroData.soundProfile || 'classic',
      autoStartBreaks: !!_pomodoroData.autoStartBreaks,
      autoStartFocus: !!_pomodoroData.autoStartFocus
    };
  }

  function _getStats() {
    if (!_pomodoroData) {
      return { totalFocusSeconds: 0, completedPomodoros: 0, dailyHistory: {}, lastCompletedDate: null };
    }
    return {
      totalFocusSeconds: (_pomodoroData.totalFocusMinutes || 0) * 60,
      completedPomodoros: _pomodoroData.completedSessions || 0,
      dailyHistory: _pomodoroData.dailyHistory || {},
      lastCompletedDate: _pomodoroData.lastCompletedDate || null
    };
  }

  function _getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function _getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── LocalStorage Daily History Helpers ──

  /** Read the daily-history object from localStorage (pure JS object, JSON serialised). */
  function _readDailyHistory() {
    try {
      var raw = localStorage.getItem(LS_DAILY_HISTORY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  /** Write the daily-history object to localStorage. */
  function _writeDailyHistory(obj) {
    try { localStorage.setItem(LS_DAILY_HISTORY, JSON.stringify(obj)); } catch (_) { /* ignore */ }
  }

  /** Get the last active date string from localStorage (or null). */
  function _readLastActiveDate() {
    try { return localStorage.getItem(LS_LAST_ACTIVE_DATE) || null; } catch (_) { return null; }
  }

  /** Write today as lastActiveDate. */
  function _writeLastActiveDate() {
    try { localStorage.setItem(LS_LAST_ACTIVE_DATE, _getDateKey(new Date())); } catch (_) { /* ignore */ }
  }

  // ── Statistics helpers ──

  /**
   * Accumulate a completed focus session into localStorage-based daily history.
   * This is the single source-of-truth for chart + stat card aggregation.
   */
  function _recordFocusCompletion() {
    if (!_pomodoroData) return;
    const todayKey = _getDateKey(new Date());
    const focusMinutes = Math.round(_totalSeconds / 60);

    // ── Update cloud data (legacy compat) ──
    _pomodoroData.totalFocusMinutes = (_pomodoroData.totalFocusMinutes || 0) + focusMinutes;
    _pomodoroData.completedSessions = (_pomodoroData.completedSessions || 0) + 1;
    if (!_pomodoroData.dailyHistory) _pomodoroData.dailyHistory = {};
    _pomodoroData.dailyHistory[todayKey] = (_pomodoroData.dailyHistory[todayKey] || 0) + focusMinutes;
    _pomodoroData.lastCompletedDate = todayKey;

    // ── Primary: localStorage daily history (chart + stat data source) ──
    var history = _readDailyHistory();
    if (!history[todayKey]) {
      history[todayKey] = { minutes: 0, completed: 0 };
    }
    history[todayKey].minutes   += focusMinutes;
    history[todayKey].completed += 1;
    _writeDailyHistory(history);

    // ── Streak handling ──
    var lastActive = _readLastActiveDate();
    var yesterdayKey = _getDateKey(new Date(Date.now() - 86400000));

    if (lastActive === yesterdayKey) {
      /* yesterday → increment streak (handled by _calculateStreak on next render) */
    } else if (lastActive === todayKey) {
      /* already counted today — no change */
    } else {
      /* gap → streak resets to 1 */
    }
    _writeLastActiveDate();

    // ── Legacy total focus fallback ──
    try { localStorage.setItem(LS_TOTAL_FOCUS, String(_pomodoroData.totalFocusMinutes || 0)); } catch (_) { /* ignore */ }

    /* Prodex: notify the Chrome extension content script */
    try {
      document.dispatchEvent(new CustomEvent('prodex-pomodoro-complete'));
    } catch (_e) { /* extension not present — noop */ }

    _savePomodoroData();
  }

  /**
   * Calculate current streak from the localStorage lastActiveDate.
   *
   * Rules:
   *   - lastActiveDate === today   → count contiguous days in history
   *   - lastActiveDate === yesterday → count contiguous days in history
   *   - lastActiveDate is older or null → 0
   */
  function _calculateStreak() {
    var lastActive = _readLastActiveDate();
    if (!lastActive) return 0;

    var todayKey     = _getDateKey(new Date());
    var yesterdayKey = _getDateKey(new Date(Date.now() - 86400000));

    // If lastActive is older than yesterday → broken streak
    if (lastActive !== todayKey && lastActive !== yesterdayKey) return 0;

    // Walk backwards from yesterday (or today) through consecutive days
    var history = _readDailyHistory();
    var streak = 1; // at least today or yesterday
    var cursor = (lastActive === todayKey) ? yesterdayKey : _getDateKey(new Date(Date.now() - 2 * 86400000));

    while (true) {
      var entry = history[cursor];
      if (entry && entry.completed > 0) {
        streak++;
        // move cursor one day earlier
        var d = new Date(cursor + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        cursor = _getDateKey(d);
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Get filtered daily history for a given date range.
   * Returns an array of { date, minutes, completed } objects.
   */
  function _getFilteredHistory(range) {
    var history = _readDailyHistory();
    var now     = new Date();
    var result  = [];
    var startDate;

    if (range === 'week') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    } else if (range === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (range === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    }

    var cursor = new Date(startDate);
    while (cursor <= now) {
      var key = _getDateKey(cursor);
      var entry = history[key];
      if (entry) {
        result.push({
          date:      key,
          minutes:   entry.minutes || 0,
          completed: entry.completed || 0
        });
      } else {
        result.push({
          date:      key,
          minutes:   0,
          completed: 0
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  /** Compute totals for the stat cards within the selected timeframe. */
  function _computeTimeframeTotals(range) {
    var filtered = _getFilteredHistory(range);
    var totalMinutes = 0;
    var totalCompleted = 0;
    for (var i = 0; i < filtered.length; i++) {
      totalMinutes  += filtered[i].minutes;
      totalCompleted += filtered[i].completed;
    }
    return { totalMinutes: totalMinutes, totalCompleted: totalCompleted };
  }

  // ── Chart data builders ──

  function _getWeeklyData() {
    var raw = _getFilteredHistory('week');
    var days = [];

    for (var i = 0; i < raw.length; i++) {
      var d = new Date(raw[i].date + 'T12:00:00');
      days.push({
        date:    raw[i].date,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        minutes: raw[i].minutes,
        isToday: raw[i].date === _getDateKey(new Date())
      });
    }

    return days;
  }

  function _getMonthlyData() {
    var raw  = _getFilteredHistory('month');
    var now  = new Date();
    var weeks = [];
    var totalDays = raw.length;

    // Group into 4 chunks (rough weeks)
    var chunkSize = Math.max(1, Math.ceil(totalDays / 4));

    for (var w = 0; w < 4; w++) {
      var startIdx = w * chunkSize;
      var endIdx   = Math.min(startIdx + chunkSize, totalDays);
      var weekMinutes = 0;

      for (var i = startIdx; i < endIdx; i++) {
        weekMinutes += raw[i].minutes;
      }

      var sDate = new Date(raw[startIdx].date + 'T12:00:00');
      var eDate = new Date(raw[endIdx - 1].date + 'T12:00:00');

      var sLabel = sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var eLabel = eDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      weeks.push({
        label:      sLabel + '–' + eLabel,
        shortLabel: 'W' + (w + 1),
        minutes:    weekMinutes,
        isCurrent:  w === 3
      });
    }

    return weeks;
  }

  function _getYearlyData() {
    var raw  = _getFilteredHistory('year');
    var now  = new Date();
    var year = now.getFullYear();

    var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Pre-group raw data by month index (0-11)
    var monthBuckets = [];
    for (var m = 0; m < 12; m++) {
      monthBuckets[m] = 0;
    }

    var monthNow = now.getMonth();
    for (var i = 0; i < raw.length; i++) {
      var dateObj = new Date(raw[i].date + 'T12:00:00');
      if (dateObj.getFullYear() === year) {
        monthBuckets[dateObj.getMonth()] += raw[i].minutes;
      }
    }

    var months = [];
    for (var mi = 0; mi < 12; mi++) {
      months.push({
        label:     monthNames[mi],
        minutes:   monthBuckets[mi],
        isCurrent: mi === monthNow
      });
    }

    return months;
  }

  function _getChartData() {
    if (_chartRange === 'month') {
      return {
        bars:       _getMonthlyData(),
        chartLabel: 'This Month · Focus Minutes'
      };
    }
    if (_chartRange === 'year') {
      var yearStr = String(new Date().getFullYear());
      return {
        bars:       _getYearlyData(),
        chartLabel: yearStr + ' · Focus Hours'
      };
    }
    return {
      bars:       _getWeeklyData(),
      chartLabel: 'This Week · Focus Minutes'
    };
  }

  // ── Dynamic stats + chart update (no full re-render) ──

  /**
   * Recompute the stat cards and chart bars based on the current _chartRange.
   * Called when the Week / Month / Year toggle is clicked.
   * Avoids a full _renderApp() so the timer keeps running uninterrupted.
   */
  function _updateStatsAndChart() {
    if (!_container) return;

    // 1) Update stat cards
    var tfTotals = _computeTimeframeTotals(_chartRange);
    var totalMin = tfTotals.totalMinutes;
    var hours    = Math.floor(totalMin / 60);
    var mins     = totalMin % 60;
    var focusTimeStr = hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm';

    var elFocus = document.getElementById('stat-focus-time');
    if (elFocus) elFocus.textContent = focusTimeStr;

    var elCompleted = document.getElementById('stat-completed');
    if (elCompleted) elCompleted.textContent = String(tfTotals.totalCompleted);

    var elStreak = document.getElementById('stat-streak');
    if (elStreak) elStreak.textContent = String(_calculateStreak());

    // 2) Update chart bars region
    var chartData = _getChartData();
    var isYearView = _chartRange === 'year';
    var maxValue   = Math.max.apply(null, chartData.bars.map(function (d) { return d.minutes; }).concat([1]));

    var barsHtml = '';
    for (var i = 0; i < chartData.bars.length; i++) {
      var d = chartData.bars[i];
      var displayVal = isYearView ? (d.minutes / 60) : d.minutes;
      var displayValStr = isYearView
        ? (displayVal >= 0.1 ? displayVal.toFixed(1) + 'h' : '')
        : (d.minutes > 0 ? d.minutes + 'm' : '');
      var heightPct = Math.max(4, (d.minutes / maxValue) * 100);
      barsHtml +=
        '<div class="chart-bar-wrapper">' +
          '<span class="chart-bar-value">' + displayValStr + '</span>' +
          '<div class="chart-bar' + (d.isCurrent ? ' chart-bar--today' : '') + '"' +
               ' style="height:' + heightPct + '%"' +
               ' title="' + d.label + ': ' + displayValStr + '">' +
          '</div>' +
          '<span class="chart-bar-label' + (d.isCurrent ? ' chart-bar-label--today' : '') + '">' + (d.shortLabel || d.dayName || d.label) + '</span>' +
        '</div>';
    }

    var chartBarsEl = _container.querySelector('#chart-bars');
    if (chartBarsEl) chartBarsEl.innerHTML = barsHtml;

    // 3) Update chart heading
    var chartHeading = _container.querySelector('.chart-heading');
    if (chartHeading) chartHeading.textContent = chartData.chartLabel;

    // 4) Toggle active class on range buttons
    _container.querySelectorAll('.chart-range-btn').forEach(function (btn) {
      var range = btn.dataset.range;
      if (range === _chartRange) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // =============================================================
  //  TIMER STATE PERSISTENCE
  // =============================================================

  function _saveTimerState() {
    try {
      localStorage.setItem(REFERENCE_KEY, JSON.stringify({
        mode:          _currentMode,
        remaining:     _secondsRemaining,
        total:         _totalSeconds,
        running:       _isRunning,
        timestamp:     Date.now(),
        cycle:         _currentCycle,
        gracePeriod:   _inGracePeriod,
        focusStart:    _focusStartTime,
        isFocus:       _isFocusSession
      }));
    } catch (_) { /* ignore */ }
  }

  function _restoreTimerState() {
    try {
      const stored = localStorage.getItem(REFERENCE_KEY);
      if (!stored) return false;

      const state = JSON.parse(stored);
      if (!state || state.remaining <= 0) return false;

      _currentMode  = state.mode || 'focus';
      _totalSeconds = state.total;

      // Restore cycle / grace / focus state
      if (typeof state.cycle !== 'undefined')     _currentCycle   = state.cycle;
      if (typeof state.gracePeriod !== 'undefined') _inGracePeriod = state.gracePeriod;
      if (typeof state.focusStart !== 'undefined')  _focusStartTime = state.focusStart;
      if (typeof state.isFocus !== 'undefined')     _isFocusSession = state.isFocus;

      if (state.running && state.timestamp) {
        const elapsed       = Math.floor((Date.now() - state.timestamp) / 1000);
        _secondsRemaining   = Math.max(0, state.remaining - elapsed);

        if (_secondsRemaining <= 0) {
          _onTimerComplete();
          return true;
        }

        _isRunning = true;
        _lastTickTime = Date.now();
      } else {
        _secondsRemaining = state.remaining;
        _isRunning = false;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  function _clearTimerState() {
    try { localStorage.removeItem(REFERENCE_KEY); } catch (_) { /* ignore */ }
  }

  // =============================================================
  //  DURATION
  // =============================================================

  function _setDuration(minutes) {
    _totalSeconds      = minutes * 60;
    _secondsRemaining  = _totalSeconds;
  }

  // =============================================================
  //  RENDER: Main app shell
  // =============================================================

  function _renderApp() {
    if (!_container) return;

    const minutes   = Math.floor(_secondsRemaining / 60);
    const seconds   = _secondsRemaining % 60;
    const timeStr   = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const progress  = _totalSeconds > 0
      ? (_totalSeconds - _secondsRemaining) / _totalSeconds
      : 0;
    const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
    const modeInfo   = MODES.find(m => m.key === _currentMode) || MODES[0];

    _container.innerHTML = `
      <div class="tab-content pomodoro-app">

        ${_renderModeToggles()}
        ${_renderTimerSection(timeStr, dashOffset, modeInfo)}
        ${_renderStatsDashboard()}
        ${_renderSettingsOverlay()}

      </div>
    `;

    if (_isRunning) {
      _startInterval();
    }

    _bindEvents();
  }

  // ---------------------------------------------------------
  //  RENDER: Mode toggle pills
  // ---------------------------------------------------------

  function _renderModeToggles() {
    return `
      <div class="pomodoro-topbar">
        <div class="mode-toggle" role="group" aria-label="Timer mode">
          ${MODES.map(m => `
            <button class="mode-btn${m.key === _currentMode ? ' active' : ''}"
                    data-mode="${m.key}">
              ${m.label}
            </button>
          `).join('')}
        </div>

        <button class="settings-btn glass" id="btn-settings-top" title="Customize timer durations" aria-label="Open timer settings">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" class="settings-btn-icon">
            <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4"
                  stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <span>Settings</span>
        </button>
      </div>
    `;
  }

  // ---------------------------------------------------------
  //  RENDER: Timer ring + display + controls
  // ---------------------------------------------------------

  function _renderTimerSection(timeStr, dashOffset, modeInfo) {
    // Grace period label override
    var modeLabel = modeInfo.label;
    if (_inGracePeriod) {
      modeLabel = '⚠ Grace Period';
    }

    // Cycle display
    var cycleHtml = '';
    if (_currentCycle > 0 || _currentMode === 'focus') {
      cycleHtml = '<div class="timer-cycle" id="timer-cycle" style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);text-align:center;letter-spacing:0.06em;margin-bottom:4px;">' +
        'Cycle ' + (_currentCycle + 1) + '/' + _targetCycles +
      '</div>';
    }

    return `
      <div class="timer-container">

        <!-- Settings gear -->
        <button class="settings-toggle" id="btn-settings" title="Timer Settings" aria-label="Open timer settings">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4"
                  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>

        <!-- Cycle indicator -->
        ${cycleHtml}

        <!-- SVG ring -->
        <div class="timer-ring-container">
          <svg class="timer-ring-svg" viewBox="0 0 260 260">
            <circle class="timer-ring-bg"
                    cx="130" cy="130" r="${RING_RADIUS}"/>
            <circle class="timer-ring-progress${_currentMode !== 'focus' ? ' break-mode' : ''}${_inGracePeriod ? ' grace-mode' : ''}"
                    id="ring-progress"
                    cx="130" cy="130" r="${RING_RADIUS}"
                    stroke-dasharray="${RING_CIRCUMFERENCE}"
                    stroke-dashoffset="${dashOffset}"/>
          </svg>

          <div class="timer-display">
            <div class="timer-time" id="timer-time">${timeStr}</div>
            <div class="timer-label">${modeLabel}</div>
          </div>
        </div>

        <!-- Controls -->
        <div class="timer-controls">
          <button class="timer-btn-icon" id="btn-reset" title="Reset">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 0 1 10.47-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <polyline points="12,2 12,6 8,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="timer-btn-main" id="btn-toggle" title="${_isRunning ? 'Pause' : 'Start'}">
            ${_isRunning
              ? `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <rect x="5" y="3" width="3" height="14" rx="1"/>
                  <rect x="12" y="3" width="3" height="14" rx="1"/>
                </svg>`
              : `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  <polygon points="5,2 18,10 5,18"/>
                </svg>`
            }
          </button>
          <button class="timer-btn-icon" id="btn-skip" title="Skip">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <polygon points="4,3 12,8 4,13" fill="currentColor"/>
              <rect x="12" y="3" width="2" height="10" rx="0.5" fill="currentColor"/>
            </svg>
          </button>
          <button class="hub-pomodoro-stop-alarm" id="btn-stop-alarm" title="Stop Alarm" style="display:${_alarmRinging ? 'flex' : 'none'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------
  //  RENDER: Statistics Dashboard
  // ---------------------------------------------------------

  function _renderStatsDashboard() {
    const streak     = _calculateStreak();
    const chartData  = _getChartData();

    // Compute timeframe-specific totals for stat cards
    var tfTotals = _computeTimeframeTotals(_chartRange);
    var totalMin = tfTotals.totalMinutes;
    var hours    = Math.floor(totalMin / 60);
    var mins     = totalMin % 60;
    var focusTimeStr = hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm';

    const isYearView = _chartRange === 'year';
    const maxValue   = Math.max(...chartData.bars.map(d => d.minutes), 1);

    return `
      <div class="pomodoro-stats">
        <h4 class="stats-heading">Performance Metrics</h4>

        <div class="stats-grid">
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">⏱️</span>
            <span class="stat-value" id="stat-focus-time">${focusTimeStr}</span>
            <span class="stat-label">Total Focus</span>
          </div>
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">✓</span>
            <span class="stat-value" id="stat-completed">${tfTotals.totalCompleted}</span>
            <span class="stat-label">Completed</span>
          </div>
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">🔥</span>
            <span class="stat-value" id="stat-streak">${streak}</span>
            <span class="stat-label">Day Streak</span>
          </div>
        </div>

        <div class="weekly-chart glass-card">
          <div class="chart-header-row">
            <h5 class="chart-heading">${chartData.chartLabel}</h5>
            <div class="chart-range-toggle" role="group" aria-label="Chart time range">
              <button class="chart-range-btn${_chartRange === 'week' ? ' active' : ''}"
                      data-range="week">Week</button>
              <button class="chart-range-btn${_chartRange === 'month' ? ' active' : ''}"
                      data-range="month">Month</button>
              <button class="chart-range-btn${_chartRange === 'year' ? ' active' : ''}"
                      data-range="year">Year</button>
            </div>
          </div>
          <div class="chart-bars" id="chart-bars">
            ${chartData.bars.map(d => {
              const displayVal = isYearView ? (d.minutes / 60) : d.minutes;
              const displayValStr = isYearView
                ? (displayVal >= 0.1 ? displayVal.toFixed(1) + 'h' : '')
                : (d.minutes > 0 ? d.minutes + 'm' : '');
              const heightPct = Math.max(4, (d.minutes / maxValue) * 100);
              return `
                <div class="chart-bar-wrapper">
                  <span class="chart-bar-value">${displayValStr}</span>
                  <div class="chart-bar${d.isCurrent ? ' chart-bar--today' : ''}"
                       style="height:${heightPct}%"
                       title="${d.label}: ${displayValStr}">
                  </div>
                  <span class="chart-bar-label${d.isCurrent ? ' chart-bar-label--today' : ''}">${d.shortLabel || d.dayName || d.label}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------
  //  RENDER: Settings Modal Overlay
  // ---------------------------------------------------------

  function _renderSettingsOverlay() {
    return `
      <div class="settings-overlay${_settingsOpen ? ' settings-overlay--visible' : ''}"
           id="settings-overlay" role="dialog" aria-modal="true" aria-label="Timer settings">

        <div class="settings-modal glass">
          <div class="settings-modal-header">
            <div class="settings-modal-title-group">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="settings-modal-icon-svg">
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4"
                      stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              <h3>Timer Settings</h3>
            </div>
            <button class="settings-close-btn" id="btn-settings-close" aria-label="Close settings">✕</button>
          </div>

          <div class="settings-body">
            ${_renderAutoStartToggles()}
            ${_renderSoundField()}
            <hr style="border:none;border-top:1px solid var(--glass-border);margin:0;">
            ${_renderSettingsField('Focus Duration', 'focus', _settings.focus, 1, 120)}
            ${_renderSettingsField('Short Break', 'shortBreak', _settings.shortBreak, 1, 60)}
            ${_renderSettingsField('Long Break', 'longBreak', _settings.longBreak, 1, 60)}
          </div>

          <div class="settings-modal-footer">
            <button class="btn btn-ghost" id="btn-cancel-settings">Cancel</button>
            <button class="btn btn-primary" id="btn-save-settings">Save Settings</button>
          </div>
        </div>

      </div>
    `;
  }

  function _renderAutoStartToggles() {
    return `
      <div class="settings-field settings-field--row">
        <span class="settings-field-label">Auto-start Breaks</span>
        <label class="toggle-switch">
          <input type="checkbox" id="input-autoStartBreaks"${_settings.autoStartBreaks ? ' checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="settings-field settings-field--row">
        <span class="settings-field-label">Auto-start Focus</span>
        <label class="toggle-switch">
          <input type="checkbox" id="input-autoStartFocus"${_settings.autoStartFocus ? ' checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }

  function _renderSoundField() {
    var current = _settings.soundProfile || 'classic';

    var profileOpts = '';
    for (var pi = 0; pi < SOUND_PROFILES.length; pi++) {
      var p = SOUND_PROFILES[pi];
      profileOpts += '<option value="' + p.key + '"' + (p.key === current ? ' selected' : '') + '>' + p.label + '</option>';
    }

    return '' +
      '<div class="settings-field">' +
        '<label class="settings-field-label">Sound Effect</label>' +
        '<div class="hub-pomodoro-sound-row">' +
          '<div class="settings-select-wrap glass-card" style="flex:1;padding:0;border-radius:var(--radius-sm);">' +
            '<select id="input-soundProfile" class="settings-sound-select">' +
              profileOpts +
            '</select>' +
          '</div>' +
          '<button class="btn-test-sound" id="btn-test-sound" title="Test selected sound" aria-label="Test sound">🔊</button>' +
        '</div>' +
      '</div>';
  }

  function _renderSettingsField(label, key, value, min, max) {
    return `
      <div class="settings-field">
        <label class="settings-field-label">${label}</label>
        <div class="settings-stepper">
          <button class="stepper-btn" data-target="${key}" data-dir="-1" aria-label="Decrease ${label}">−</button>
          <input type="number"
                 class="stepper-input"
                 id="input-${key}"
                 value="${value}"
                 min="${min}"
                 max="${max}"
                 data-key="${key}"
                 aria-label="${label} in minutes">
          <button class="stepper-btn" data-target="${key}" data-dir="1" aria-label="Increase ${label}">+</button>
          <span class="stepper-unit">min</span>
        </div>
      </div>
    `;
  }

  // =============================================================
  //  EVENTS
  // =============================================================

  function _bindEvents() {
    if (!_container) return;

    // --- Mode toggle buttons ---
    _container.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        var mode = this.dataset.mode;
        if (mode === _currentMode) return;
        // Clearing grace period or focus tracking when user manually switches
        _inGracePeriod = false;
        _focusStartTime = null;
        _isFocusSession = false;
        _switchMode(mode);
      });
    });

    // --- Timer controls ---
    var btnToggle = _container.querySelector('#btn-toggle');
    if (btnToggle) btnToggle.addEventListener('click', _toggleTimer);

    var btnReset = _container.querySelector('#btn-reset');
    if (btnReset) btnReset.addEventListener('click', _resetTimer);

    var btnSkip = _container.querySelector('#btn-skip');
    if (btnSkip) btnSkip.addEventListener('click', _skipTimer);

    // --- Stop Alarm button ---
    var btnStopAlarm = _container.querySelector('#btn-stop-alarm');
    if (btnStopAlarm) btnStopAlarm.addEventListener('click', _stopAlarm);

    // --- Settings: open (both buttons) ---
    var btnSettings = _container.querySelector('#btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', _openSettings);

    var btnSettingsTop = _container.querySelector('#btn-settings-top');
    if (btnSettingsTop) btnSettingsTop.addEventListener('click', _openSettings);

    // --- Settings: close ---
    var btnClose = _container.querySelector('#btn-settings-close');
    if (btnClose) btnClose.addEventListener('click', _closeSettings);

    // --- Settings: cancel ---
    var btnCancel = _container.querySelector('#btn-cancel-settings');
    if (btnCancel) btnCancel.addEventListener('click', _closeSettings);

    // --- Settings: save ---
    var btnSave = _container.querySelector('#btn-save-settings');
    if (btnSave) btnSave.addEventListener('click', _saveSettingsHandler);

    // --- Settings: backdrop click ---
    var overlay = _container.querySelector('#settings-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) _closeSettings();
      });
    }

    // --- Settings: stepper buttons ---
    _container.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        var target = this.dataset.target;
        var dir    = parseInt(this.dataset.dir, 10);
        var input  = _container.querySelector('#input-' + target);
        if (input) {
          var min  = parseInt(input.getAttribute('min'), 10) || 1;
          var max  = parseInt(input.getAttribute('max'), 10) || 120;
          var val  = parseInt(input.value, 10) || 0;
          val = Math.max(min, Math.min(max, val + dir));
          input.value = val;
        }
      });
    });

    // --- Settings: test sound button ---
    var btnTestSound = _container.querySelector('#btn-test-sound');
    if (btnTestSound) {
      btnTestSound.addEventListener('click', function () {
        var select = _container.querySelector('#input-soundProfile');
        var profile = select ? select.value : 'classic';
        _playTestSound(profile);
      });
    }

    // --- Keyboard: Escape to close settings ---
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
    }
    _escapeHandler = function (e) {
      if (e.key === 'Escape' && _settingsOpen) {
        _closeSettings();
      }
      if ((e.key === ' ' || e.key === 'Spacebar') && !_settingsOpen) {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        e.preventDefault();
        _toggleTimer();
      }
    };
    document.addEventListener('keydown', _escapeHandler);

    // --- Chart range toggle pills ---
    _container.querySelectorAll('.chart-range-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        var range = this.dataset.range;
        if (!range || range === _chartRange) return;
        _chartRange = range;
        _updateStatsAndChart();
      });
    });
  }

  // ---------------------------------------------------------
  //  Settings modal open / close / save
  // ---------------------------------------------------------

  function _openSettings() {
    _settingsOpen = true;
    var overlay = document.getElementById('settings-overlay');
    if (overlay) {
      overlay.classList.add('settings-overlay--visible');
      var firstInput = overlay.querySelector('input');
      if (firstInput) setTimeout(function () { firstInput.focus(); }, 100);
    }
  }

  function _closeSettings() {
    _settingsOpen = false;
    var overlay = document.getElementById('settings-overlay');
    if (overlay) {
      overlay.classList.remove('settings-overlay--visible');
    }
  }

  function _saveSettingsHandler() {
    var focusVal      = parseInt(_getVal('input-focus'), 10);
    var shortBreakVal = parseInt(_getVal('input-shortBreak'), 10);
    var longBreakVal  = parseInt(_getVal('input-longBreak'), 10);
    var soundVal      = _getVal('input-soundProfile');

    var autoStartBreaksEl = document.getElementById('input-autoStartBreaks');
    var autoStartFocusEl  = document.getElementById('input-autoStartFocus');
    _settings.autoStartBreaks = autoStartBreaksEl ? autoStartBreaksEl.checked : false;
    _settings.autoStartFocus  = autoStartFocusEl  ? autoStartFocusEl.checked  : false;

    _settings.focus      = Math.max(1, Math.min(120, focusVal || DEFAULT_SETTINGS.focus));
    _settings.shortBreak = Math.max(1, Math.min(60, shortBreakVal || DEFAULT_SETTINGS.shortBreak));
    _settings.longBreak  = Math.max(1, Math.min(60, longBreakVal || DEFAULT_SETTINGS.longBreak));

    var validKeys = SOUND_PROFILES.map(function (p) { return p.key; });
    if (soundVal && validKeys.indexOf(soundVal) !== -1) {
      _settings.soundProfile = soundVal;
    }

    if (_pomodoroData) {
      _pomodoroData.work = _settings.focus;
      _pomodoroData.shortBreak = _settings.shortBreak;
      _pomodoroData.longBreak = _settings.longBreak;
      _pomodoroData.soundProfile = _settings.soundProfile;
      _pomodoroData.autoStartBreaks = _settings.autoStartBreaks;
      _pomodoroData.autoStartFocus = _settings.autoStartFocus;
    }

    _savePomodoroData();

    try { localStorage.setItem('hub_pomodoro_settings', JSON.stringify(_settings)); } catch (_) {}
    try { localStorage.setItem('hub_pomodoro_sessions', String(_pomodoroData ? _pomodoroData.completedSessions : 0)); } catch (_) {}

    _pauseTimer();
    var settingKey = MODES.find(function (m) { return m.key === _currentMode; }).settingKey;
    _setDuration(_settings[settingKey]);
    _isRunning = false;
    _inGracePeriod = false;
    _focusStartTime = null;
    _isFocusSession = false;
    _clearTimerState();

    _closeSettings();
    _renderApp();
  }

  // =============================================================
  //  TIMER LOGIC
  // =============================================================

  function _switchMode(mode) {
    _pauseTimer();
    _currentMode = mode;
    var settingKey = MODES.find(function (m) { return m.key === mode; }).settingKey;
    _setDuration(_settings[settingKey]);
    _isRunning = false;
    _inGracePeriod = false;
    _focusStartTime = null;
    _isFocusSession = false;
    _clearTimerState();
    _renderApp();
  }

  function _toggleTimer() {
    if (_isRunning) {
      _pauseTimer();
    } else {
      _startTimer();
    }
    _renderApp();
  }

  function _startTimer() {
    // If in grace period, user clicked Start to begin Focus early — clear grace
    if (_inGracePeriod) {
      _inGracePeriod = false;
      _currentMode = 'focus';
      _setDuration(_settings.focus);
      _isFocusSession = true;
      _focusStartTime = Date.now();
      _isRunning = true;
      _lastTickTime = Date.now();
      _startInterval();
      _saveTimerState();
      // Re-render to show Focus mode
      if (_container) _renderApp();
      return;
    }

    if (_secondsRemaining <= 0) {
      var settingKey = MODES.find(function (m) { return m.key === _currentMode; }).settingKey;
      _setDuration(_settings[settingKey]);
    }

    // Track focus session start for Penalty 2
    if (_currentMode === 'focus') {
      _isFocusSession = true;
      _focusStartTime = Date.now();
    } else {
      _isFocusSession = false;
      _focusStartTime = null;
    }

    _isRunning = true;
    _lastTickTime = Date.now();
    _startInterval();
    _saveTimerState();
  }

  function _pauseTimer() {
    _isRunning = false;
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
    _saveTimerState();
  }

  function _resetTimer() {
    // ── Penalty 2: "Giving up halfway" (Early Cancel) ──
    if (_currentMode === 'focus' && _isFocusSession && _focusStartTime !== null) {
      const elapsedSeconds = (Date.now() - _focusStartTime) / 1000;
      if (elapsedSeconds > 60) {
        // User is giving up — dispatch fail event
        try {
          document.dispatchEvent(new CustomEvent('prodex-pomodoro-fail'));
        } catch (_e) { /* noop */ }
        // Reset cycle counter
        _currentCycle = 0;
      }
      // elapsed <= 60s: accidental click, just reset normally
    }

    _pauseTimer();
    _inGracePeriod = false;
    _focusStartTime = null;
    _isFocusSession = false;
    var settingKey = MODES.find(function (m) { return m.key === _currentMode; }).settingKey;
    _setDuration(_settings[settingKey]);
    _clearTimerState();
    _renderApp();
  }

  function _skipTimer() {
    // ── Penalty 2: "Giving up halfway" also applies to Skip ──
    if (_currentMode === 'focus' && _isFocusSession && _focusStartTime !== null) {
      const elapsedSeconds = (Date.now() - _focusStartTime) / 1000;
      if (elapsedSeconds > 60) {
        try {
          document.dispatchEvent(new CustomEvent('prodex-pomodoro-fail'));
        } catch (_e) { /* noop */ }
        _currentCycle = 0;
      }
    }

    _pauseTimer();
    _inGracePeriod = false;
    _focusStartTime = null;
    _isFocusSession = false;
    _secondsRemaining = 0;
    _onTimerComplete();
  }

  function _startInterval() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(function () {
      var now   = Date.now();
      var delta = (now - _lastTickTime) / 1000;
      _lastTickTime = now;

      if (delta > 0) {
        _secondsRemaining = Math.max(0, _secondsRemaining - delta);
      }

      if (_secondsRemaining <= 0) {
        _secondsRemaining = 0;
        _onTimerComplete();
        return;
      }

      var displaySeconds = Math.ceil(_secondsRemaining);
      var timeEl = document.getElementById('timer-time');
      var ringEl = document.getElementById('ring-progress');
      if (timeEl) {
        var m = Math.floor(displaySeconds / 60);
        var s = displaySeconds % 60;
        timeEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }
      if (ringEl) {
        var p = (_totalSeconds - _secondsRemaining) / _totalSeconds;
        ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - Math.min(1, p));
      }

      _saveTimerState();
    }, 1000);
  }

  // =============================================================
  //  TIMER COMPLETION
  // =============================================================

  function _onTimerComplete() {
    _pauseTimer();
    _clearTimerState();
    _secondsRemaining = 0;
    _isFocusSession = false;
    _focusStartTime = null;

    // ==========================================
    //  CASE 1: Focus session completed (success)
    // ==========================================
    if (_currentMode === 'focus') {
      _incrementSessions();
      _recordFocusCompletion();

      // -- Cycle System --
      _currentCycle = (_currentCycle + 1) % _targetCycles;

      // Dispatch success event with explicit console log
      console.log('EVENT DISPATCHED: prodex-pomodoro-success');
      try {
        document.dispatchEvent(new CustomEvent('prodex-pomodoro-success'));
      } catch (_e) { /* noop */ }

      // Alarm sound
      _playAlarm(_settings.soundProfile);
      _showNotification();

      // Auto-transition to break
      if (_settings.autoStartBreaks) {
        var breakMode = (_currentCycle === 0) ? 'longBreak' : 'shortBreak';
        _currentMode = breakMode;
        _setDuration(_settings[MODES.find(function (m) { return m.key === breakMode; }).settingKey]);
        _startTimer();
        if (_container) _renderApp();
        return;
      }

      if (_container) {
        _renderApp();
        _pulseStatValues();
      }
      return;
    }

    // ==========================================
    //  CASE 2: Grace period expired (Penalty 1)
    //  Check BEFORE break — during grace the mode
    //  stays at shortBreak/longBreak.
    // ==========================================
    if (_inGracePeriod) {
      _inGracePeriod = false;

      // Dispatch fail event with explicit console log
      console.log('EVENT DISPATCHED: prodex-pomodoro-fail (grace expired)');
      try {
        document.dispatchEvent(new CustomEvent('prodex-pomodoro-fail'));
      } catch (_e) { /* noop */ }

      // Reset cycle to zero
      _currentCycle = 0;

      // Revert to default Focus mode (paused — wait for user)
      _currentMode = 'focus';
      _setDuration(_settings.focus);
      _isRunning = false;
      _clearTimerState();
      _stopAllAlarms();

      if (_container) {
        _renderApp();
      }
      return;
    }

    // ==========================================
    //  CASE 3: Break session completed
    //  → Enter "Grace Period" (Penalty 1)
    // ==========================================
    if (_currentMode === 'shortBreak' || _currentMode === 'longBreak') {
      // Alarm sound
      _playAlarm(_settings.soundProfile);
      _showNotification();

      // Enter 60-second grace period
      _inGracePeriod = true;
      _totalSeconds = GRACE_SECONDS;
      _secondsRemaining = GRACE_SECONDS;
      _currentMode = 'shortBreak'; // keep display mode but label changes
      _isRunning = true;
      _lastTickTime = Date.now();
      _startInterval();
      _saveTimerState();

      if (_container) {
        _renderApp();
      }
      return;
    }

    // Fallback: just re-render
    if (_container) {
      _renderApp();
      _pulseStatValues();
    }
  }

  function _pulseStatValues() {
    ['stat-focus-time', 'stat-completed', 'stat-streak'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.add('stat-pulse');
        setTimeout(function () { el.classList.remove('stat-pulse'); }, 600);
      }
    });
  }

  // =============================================================
  //  AUDIO ENGINE: Looping alarm with 6 profiles
  // =============================================================

  /** Stop ALL running alarms: interval, audio, and UI. */
  function _stopAllAlarms() {
    if (_alarmInterval) {
      clearInterval(_alarmInterval);
      _alarmInterval = null;
    }
    if (_alarmAudio) {
      try {
        _alarmAudio.pause();
        _alarmAudio.currentTime = 0;
        _alarmAudio.src = '';
      } catch (_) { /* ignore */ }
      _alarmAudio = null;
    }
    _alarmRinging = false;
    var btn = document.getElementById('btn-stop-alarm');
    if (btn) btn.style.display = 'none';
  }

  function _playAlarm(profile) {
    // Always stop any existing alarm before starting a new one
    _stopAllAlarms();
    _alarmRinging = true;

    if (profile === 'classic') {
      _startLoopingClassic();
    } else {
      _startLoopingUrl(profile);
    }

    var btn = document.getElementById('btn-stop-alarm');
    if (btn) btn.style.display = 'flex';
  }

  function _startLoopingClassic() {
    _playClassicBeepOnce();

    _alarmInterval = setInterval(function () {
      _playClassicBeepOnce();
    }, ALARM_LOOP_MS);
  }

  function _playClassicBeepOnce() {
    try {
      var ctx = _getAudioContext();
      var now = ctx.currentTime;

      var master = ctx.createGain();
      master.gain.setValueAtTime(0.18, now);
      master.connect(ctx.destination);

      var freqs = [880, 1100, 880, 1100, 1320];
      for (var i = 0; i < freqs.length; i++) {
        var t = now + i * 0.18;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freqs[i], t);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(g);
        g.connect(master);
        osc.start(t);
        osc.stop(t + 0.25);
      }
    } catch (_) { /* audio unavailable */ }
  }

  function _startLoopingUrl(profile) {
    var url = SOUND_URLS[profile];
    if (!url) return;

    try {
      _alarmAudio = new Audio(url);

      var playPromise = _alarmAudio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {
          _stopAlarmInternal();
          _startLoopingClassic();
        });
      }

      _alarmInterval = setInterval(function () {
        if (_alarmAudio) {
          try {
            _alarmAudio.currentTime = 0;
            var pp = _alarmAudio.play();
            if (pp && typeof pp.catch === 'function') {
              pp.catch(function () { /* ignore autoplay failures on repeats */ });
            }
          } catch (_) { /* ignore */ }
        }
      }, ALARM_LOOP_MS);
    } catch (_) {
      _startLoopingClassic();
    }
  }

  function _stopAlarm() {
    _stopAlarmInternal();

    var btn = document.getElementById('btn-stop-alarm');
    if (btn) btn.style.display = 'none';
  }

  function _stopAlarmInternal() {
    _alarmRinging = false;

    if (_alarmInterval) {
      clearInterval(_alarmInterval);
      _alarmInterval = null;
    }

    if (_alarmAudio) {
      try {
        _alarmAudio.pause();
        _alarmAudio.currentTime = 0;
        _alarmAudio.src = '';
      } catch (_) { /* ignore */ }
      _alarmAudio = null;
    }
  }

  function _playTestSound(profile) {
    if (profile === 'classic') {
      _playClassicBeepOnce();
      return;
    }

    var url = SOUND_URLS[profile];
    if (!url) return;

    try {
      var audio = new Audio(url);
      var pp = audio.play();
      if (pp && typeof pp.catch === 'function') {
        pp.catch(function () { /* test play failed silently */ });
      }
    } catch (_) { /* ignore */ }
  }

  function _getAudioContext() {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }
    return _audioCtx;
  }

  // =============================================================
  //  BROWSER NOTIFICATION
  // =============================================================

  function _showNotification() {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      var label = _inGracePeriod ? 'Grace Period' : (MODES.find(function (m) { return m.key === _currentMode; }) || {}).label || 'Timer';
      new Notification('Hub OS — Pomodoro', {
        body: label + ' session complete!',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2300f0ff"/></svg>'
      });
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // =============================================================
  //  INCREMENT SESSION COUNT (backward-compat for dashboard)
  // =============================================================

  function _incrementSessions() {
    try {
      var count = _pomodoroData ? _pomodoroData.completedSessions : parseInt(localStorage.getItem('hub_pomodoro_sessions') || '0', 10);
      localStorage.setItem('hub_pomodoro_sessions', String(count));
    } catch (_) { /* ignore */ }
  }

  // =============================================================
  //  PUBLIC API (module contract)
  // =============================================================
  return {
    id:   'pomodoro',
    name: 'Pomodoro',
    icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none">' +
      '<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>' +
      '<polyline points="10,5 10,10 14,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>',
    render: render,
    destroy: destroy
  };

})();

// Auto-register with the app router
if (typeof app !== 'undefined') {
  app.register(pomodoroModule);
}