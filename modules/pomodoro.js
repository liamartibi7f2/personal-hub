/* ============================================================
   HUB.OS — modules/pomodoro.js
   Pomodoro timer with circular SVG progress ring,
   focus/break modes, premium settings modal, professional
   statistics dashboard with weekly chart, classic alarm +
   5 custom URL audio slots, and localStorage persistence.

   Module contract:
     - id: 'pomodoro'
     - render(container) → injects the timer + stats UI
     - destroy()        → cleans up intervals and state
   ============================================================ */

const pomodoroModule = (function () {
  'use strict';

  // --- Constants ---
  const SETTINGS_KEY  = 'hub_pomodoro_settings';
  const SESSIONS_KEY  = 'hub_pomodoro_sessions';
  const REFERENCE_KEY = 'hub_pomodoro_ref';
  const STATS_KEY     = 'hub_pomodoro_stats';

  // --- Default settings (in minutes) ---
  const DEFAULT_SETTINGS = {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    soundProfile: 'classic_alarm',
    autoStartBreaks: false,
    autoStartFocus: false,
    customUrl1: '',
    customUrl2: '',
    customUrl3: '',
    customUrl4: '',
    customUrl5: ''
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
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS; // ≈ 753.98

  // --- Modes ---
  const MODES = [
    { key: 'focus',      label: 'Focus',       settingKey: 'focus' },
    { key: 'shortBreak', label: 'Short Break', settingKey: 'shortBreak' },
    { key: 'longBreak',  label: 'Long Break',  settingKey: 'longBreak' }
  ];

  // --- Private state ---
  let _settings       = { ...DEFAULT_SETTINGS };
  let _currentMode    = 'focus';
  let _secondsRemaining = 0;
  let _totalSeconds   = 0;
  let _isRunning      = false;
  let _timerInterval  = null;
  let _container      = null;
  let _audioCtx       = null;
  let _settingsOpen   = false;   // Tracks settings modal visibility
  let _escapeHandler  = null;    // Reference for cleanup
  let _chartRange     = 'week';  // 'week' | 'month' | 'year'
  let _lastTickTime   = null;    // Date.now() anchor for delta-based timing

  // =============================================================
  //  PUBLIC API
  // =============================================================

  function render(container) {
    _container = container;
    _loadSettings();
    _settingsOpen = false;

    // Try to restore a running timer from localStorage
    if (!_restoreTimerState()) {
      _currentMode = 'focus';
      _setDuration(_settings.focus);
      _isRunning = false;
    }

    _renderApp();
  }

  function destroy() {
    // Persist the current timer state so it survives SPA tab switches.
    // IMPORTANT: do NOT call _pauseTimer() — it sets _isRunning = false
    // which would kill background execution. We only clear the browser
    // interval handle; the logical timer stays running.
    _saveTimerState();

    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }

    // Remove global escape handler if present
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
      _escapeHandler = null;
    }

    _container = null;
  }

  // =============================================================
  //  SETTINGS ENGINE
  // =============================================================

  function _loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        _settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (_) { /* ignore */ }
  }

  function _saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
    } catch (_) { /* ignore */ }
  }

  function _escHtml(str) {
    if (typeof str !== 'string') return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function _getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // =============================================================
  //  STATS ENGINE
  // =============================================================

  /**
   * Load stats from localStorage, merging with defaults.
   * Handles corrupted or missing data gracefully.
   * @returns {Object} stats object
   */
  function _loadStats() {
    try {
      const stored = localStorage.getItem(STATS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          totalFocusSeconds: parsed.totalFocusSeconds || 0,
          completedPomodoros: parsed.completedPomodoros || 0,
          dailyHistory: parsed.dailyHistory || {},
          lastCompletedDate: parsed.lastCompletedDate || null
        };
      }
    } catch (_) { /* ignore */ }
    return { ...DEFAULT_STATS, dailyHistory: {} };
  }

  /** Persist stats to localStorage */
  function _saveStats(stats) {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (_) { /* ignore */ }
  }

  /** Return a 'YYYY-MM-DD' key for a given Date */
  function _getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Record a completed focus session in the stats.
   * Called automatically when the focus timer hits 0:00.
   */
  function _recordFocusCompletion() {
    const stats    = _loadStats();
    const todayKey = _getDateKey(new Date());

    stats.totalFocusSeconds += _totalSeconds;
    stats.completedPomodoros += 1;
    stats.dailyHistory[todayKey] = (stats.dailyHistory[todayKey] || 0) + _totalSeconds;
    stats.lastCompletedDate = todayKey;

    _saveStats(stats);
  }

  /**
   * Calculate current daily streak.
   * Counts consecutive days backwards from the most recent
   * completion date (today or yesterday).
   * @returns {number} streak count
   */
  function _calculateStreak() {
    const stats = _loadStats();
    const todayKey     = _getDateKey(new Date());
    const yesterdayKey = _getDateKey(new Date(Date.now() - 86400000));

    // Get all dates with completions, sorted newest first
    const dates = Object.keys(stats.dailyHistory)
      .filter(d => (stats.dailyHistory[d] || 0) > 0)
      .sort((a, b) => b.localeCompare(a));

    if (dates.length === 0) return 0;

    // The most recent completion must be today or yesterday
    if (dates[0] !== todayKey && dates[0] !== yesterdayKey) return 0;

    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = Math.round((prev - curr) / 86400000);
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Build an array of the last 7 days with focus minutes per day.
   * @returns {Array<{date, dayName, minutes, isToday}>}
   */
  function _getWeeklyData() {
    const stats = _loadStats();
    const now   = new Date();
    const days  = [];

    for (let i = 6; i >= 0; i--) {
      const d       = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key     = _getDateKey(d);
      const seconds = stats.dailyHistory[key] || 0;
      days.push({
        date:    key,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        minutes: Math.floor(seconds / 60),
        isToday: i === 0
      });
    }

    return days;
  }

  /**
   * Build monthly chart data: last 30 days grouped into 4 weekly buckets.
   * Each bucket aggregates ~7 days of focus minutes.
   * @returns {Array<{label: string, minutes: number, isCurrent: boolean}>}
   */
  function _getMonthlyData() {
    const stats = _loadStats();
    const now   = new Date();
    const weeks = [];

    // Walk backwards in 7-day chunks: Week 4 (oldest) → Week 1 (current)
    for (let w = 3; w >= 0; w--) {
      let weekMinutes = 0;
      const endDay  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - w * 7);
      const startDay = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 6);

      for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
        const key     = _getDateKey(d);
        const seconds = stats.dailyHistory[key] || 0;
        weekMinutes += Math.floor(seconds / 60);
      }

      // Format label like "Jun 1-7"
      const sLabel = startDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const eLabel = endDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      weeks.push({
        label:     `${sLabel}–${eLabel}`,
        shortLabel: `W${4 - w}`,
        minutes:   weekMinutes,
        isCurrent: w === 0
      });
    }

    return weeks;
  }

  /**
   * Build yearly chart data: 12 months of the current year.
   * @returns {Array<{label: string, minutes: number, isCurrent: boolean}>}
   */
  function _getYearlyData() {
    const stats     = _loadStats();
    const now       = new Date();
    const year      = now.getFullYear();
    const monthNow  = now.getMonth(); // 0-indexed
    const months    = [];

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    for (let m = 0; m < 12; m++) {
      let monthMinutes = 0;

      // Iterate every day in this month
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const d       = new Date(year, m, day);
        const key     = _getDateKey(d);
        const seconds = stats.dailyHistory[key] || 0;
        monthMinutes += Math.floor(seconds / 60);
      }

      months.push({
        label:     monthNames[m],
        minutes:   monthMinutes,
        isCurrent: m === monthNow
      });
    }

    return months;
  }

  /**
   * Unified data getter based on current chart range.
   * @returns {{ bars: Array, chartLabel: string }}
   */
  function _getChartData() {
    if (_chartRange === 'month') {
      return {
        bars:       _getMonthlyData(),
        chartLabel: 'This Month · Focus Minutes'
      };
    }
    if (_chartRange === 'year') {
      return {
        bars:       _getYearlyData(),
        chartLabel: `${new Date().getFullYear()} · Focus Hours`
      };
    }
    // Default: week
    return {
      bars:       _getWeeklyData(),
      chartLabel: 'This Week · Focus Minutes'
    };
  }

  // =============================================================
  //  TIMER STATE PERSISTENCE
  // =============================================================

  function _saveTimerState() {
    try {
      localStorage.setItem(REFERENCE_KEY, JSON.stringify({
        mode:      _currentMode,
        remaining: _secondsRemaining,
        total:     _totalSeconds,
        running:   _isRunning,
        timestamp: Date.now()
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

      if (state.running && state.timestamp) {
        const elapsed       = Math.floor((Date.now() - state.timestamp) / 1000);
        _secondsRemaining   = Math.max(0, state.remaining - elapsed);

        if (_secondsRemaining <= 0) {
          _onTimerComplete();
          return true;
        }

        _isRunning = true;
        _lastTickTime = Date.now();
        // Interval will be started by _renderApp()
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

    const minutes  = Math.floor(_secondsRemaining / 60);
    const seconds  = _secondsRemaining % 60;
    const timeStr  = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const progress = _totalSeconds > 0
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

        <!-- Prominent Settings button with gear icon -->
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

        <!-- SVG ring -->
        <div class="timer-ring-container">
          <svg class="timer-ring-svg" viewBox="0 0 260 260">
            <circle class="timer-ring-bg"
                    cx="130" cy="130" r="${RING_RADIUS}"/>
            <circle class="timer-ring-progress${_currentMode !== 'focus' ? ' break-mode' : ''}"
                    id="ring-progress"
                    cx="130" cy="130" r="${RING_RADIUS}"
                    stroke-dasharray="${RING_CIRCUMFERENCE}"
                    stroke-dashoffset="${dashOffset}"/>
          </svg>

          <div class="timer-display">
            <div class="timer-time" id="timer-time">${timeStr}</div>
            <div class="timer-label">${modeInfo.label}</div>
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
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------
  //  RENDER: Statistics Dashboard
  // ---------------------------------------------------------

  function _renderStatsDashboard() {
    const stats      = _loadStats();
    const streak     = _calculateStreak();
    const chartData  = _getChartData();

    // Format total focus time → "Xh Ym"
    const totalMin = Math.floor(stats.totalFocusSeconds / 60);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    const focusTimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    // Chart: compute bar heights. For year view: show hours instead of minutes.
    const isYearView = _chartRange === 'year';
    const maxValue   = Math.max(...chartData.bars.map(d => d.minutes), 1);

    return `
      <div class="pomodoro-stats">
        <h4 class="stats-heading">Performance Metrics</h4>

        <!-- Metric cards -->
        <div class="stats-grid">
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">⏱️</span>
            <span class="stat-value" id="stat-focus-time">${focusTimeStr}</span>
            <span class="stat-label">Total Focus</span>
          </div>
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">✓</span>
            <span class="stat-value" id="stat-completed">${stats.completedPomodoros}</span>
            <span class="stat-label">Completed</span>
          </div>
          <div class="stat-card-mini glass-card">
            <span class="stat-icon">🔥</span>
            <span class="stat-value" id="stat-streak">${streak}</span>
            <span class="stat-label">Day Streak</span>
          </div>
        </div>

        <!-- Chart with time-range toggle -->
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
          <!-- Header -->
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

          <!-- Body: Duration inputs -->
          <div class="settings-body">
            ${_renderAutoStartToggles()}
            ${_renderSoundField()}
            <hr style="border:none;border-top:1px solid var(--glass-border);margin:0;">
            ${_renderSettingsField('Focus Duration', 'focus', _settings.focus, 1, 120)}
            ${_renderSettingsField('Short Break', 'shortBreak', _settings.shortBreak, 1, 60)}
            ${_renderSettingsField('Long Break', 'longBreak', _settings.longBreak, 1, 60)}
          </div>

          <!-- Footer: Actions -->
          <div class="settings-modal-footer">
            <button class="btn btn-ghost" id="btn-cancel-settings">Cancel</button>
            <button class="btn btn-primary" id="btn-save-settings">Save Settings</button>
          </div>
        </div>

      </div>
    `;
  }

  /** Render auto-start toggle switches */
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

  /** Render the sound profile selector + custom URL fields */
  function _renderSoundField() {
    var profiles = [
      { key: 'classic_alarm', label: 'Classic Alarm' },
      { key: 'custom_1',      label: 'Custom 1' },
      { key: 'custom_2',      label: 'Custom 2' },
      { key: 'custom_3',      label: 'Custom 3' },
      { key: 'custom_4',      label: 'Custom 4' },
      { key: 'custom_5',      label: 'Custom 5' }
    ];
    var current = _settings.soundProfile || 'classic_alarm';

    var profileOpts = '';
    for (var pi = 0; pi < profiles.length; pi++) {
      var p = profiles[pi];
      profileOpts += '<option value="' + p.key + '"' + (p.key === current ? ' selected' : '') + '>' + p.label + '</option>';
    }

    var urlInputs = '';
    for (var ui = 1; ui <= 5; ui++) {
      urlInputs += '<div class="hub-pomodoro-url-row">' +
        '<label class="hub-pomodoro-url-label" for="input-customUrl' + ui + '">Link ' + ui + '</label>' +
        '<input type="url" class="hub-pomodoro-url-input" id="input-customUrl' + ui + '" value="' + _escHtml(_settings['customUrl' + ui] || '') + '" placeholder="https://www.myinstants.com/en/instant/..." />' +
      '</div>';
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
        '<p class="hub-pomodoro-instructions">Hướng dẫn: Truy cập myinstants.com, bấm vào một âm thanh bất kỳ, bấm nút \'Copy Link\' hoặc sao chép URL trên trình duyệt rồi dán vào các ô Custom bên dưới.</p>' +
      '</div>' +
      '<div class="hub-pomodoro-url-section">' +
        '<label class="settings-field-label" style="display:block;margin-bottom:var(--space-sm);">Custom Audio Links</label>' +
        urlInputs +
      '</div>';
  }

  /** Render a single settings field with stepper controls */
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
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === _currentMode) return;
        _switchMode(mode);
      });
    });

    // --- Timer controls ---
    const btnToggle = _container.querySelector('#btn-toggle');
    if (btnToggle) btnToggle.addEventListener('click', _toggleTimer);

    const btnReset = _container.querySelector('#btn-reset');
    if (btnReset) btnReset.addEventListener('click', _resetTimer);

    const btnSkip = _container.querySelector('#btn-skip');
    if (btnSkip) btnSkip.addEventListener('click', _skipTimer);

    // --- Settings: open (both buttons) ---
    const btnSettings = _container.querySelector('#btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', _openSettings);

    const btnSettingsTop = _container.querySelector('#btn-settings-top');
    if (btnSettingsTop) btnSettingsTop.addEventListener('click', _openSettings);

    // --- Settings: close ---
    const btnClose = _container.querySelector('#btn-settings-close');
    if (btnClose) btnClose.addEventListener('click', _closeSettings);

    // --- Settings: cancel ---
    const btnCancel = _container.querySelector('#btn-cancel-settings');
    if (btnCancel) btnCancel.addEventListener('click', _closeSettings);

    // --- Settings: save ---
    const btnSave = _container.querySelector('#btn-save-settings');
    if (btnSave) btnSave.addEventListener('click', _saveSettingsHandler);

    // --- Settings: backdrop click ---
    const overlay = _container.querySelector('#settings-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _closeSettings();
      });
    }

    // --- Settings: stepper buttons ---
    _container.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const dir    = parseInt(btn.dataset.dir, 10);
        const input  = _container.querySelector(`#input-${target}`);
        if (input) {
          const min  = parseInt(input.getAttribute('min'), 10) || 1;
          const max  = parseInt(input.getAttribute('max'), 10) || 120;
          let val    = parseInt(input.value, 10) || 0;
          val = Math.max(min, Math.min(max, val + dir));
          input.value = val;
        }
      });
    });

    // --- Settings: test sound button ---
    const btnTestSound = _container.querySelector('#btn-test-sound');
    if (btnTestSound) {
      btnTestSound.addEventListener('click', () => {
        const select = _container.querySelector('#input-soundProfile');
        const profile = select ? select.value : 'classic_alarm';
        _playSound(profile);
      });
    }

    // --- Keyboard: Escape to close settings ---
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
    }
    _escapeHandler = (e) => {
      if (e.key === 'Escape' && _settingsOpen) {
        _closeSettings();
      }
      // Space to toggle timer (only when settings are closed)
      if ((e.key === ' ' || e.key === 'Spacebar') && !_settingsOpen) {
        // Don't intercept if user is typing in an input
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        e.preventDefault();
        _toggleTimer();
      }
    };
    document.addEventListener('keydown', _escapeHandler);

    // --- Chart range toggle pills ---
    _container.querySelectorAll('.chart-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        if (!range || range === _chartRange) return;
        _chartRange = range;
        _renderApp();
      });
    });
  }

  // ---------------------------------------------------------
  //  Settings modal open / close / save
  // ---------------------------------------------------------

  function _openSettings() {
    _settingsOpen = true;
    const overlay = document.getElementById('settings-overlay');
    if (overlay) {
      overlay.classList.add('settings-overlay--visible');
      // Focus the first input for convenience
      const firstInput = overlay.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);
    }
  }

  function _closeSettings() {
    _settingsOpen = false;
    const overlay = document.getElementById('settings-overlay');
    if (overlay) {
      overlay.classList.remove('settings-overlay--visible');
    }
  }

  function _saveSettingsHandler() {
    // Read values from the modal inputs
    var focusVal      = parseInt(_getVal('input-focus'), 10);
    var shortBreakVal = parseInt(_getVal('input-shortBreak'), 10);
    var longBreakVal  = parseInt(_getVal('input-longBreak'), 10);
    var soundVal      = _getVal('input-soundProfile');

    // Read auto-start toggles
    var autoStartBreaksEl = document.getElementById('input-autoStartBreaks');
    var autoStartFocusEl  = document.getElementById('input-autoStartFocus');
    _settings.autoStartBreaks = autoStartBreaksEl ? autoStartBreaksEl.checked : false;
    _settings.autoStartFocus  = autoStartFocusEl  ? autoStartFocusEl.checked  : false;

    // Validate and clamp
    _settings.focus      = Math.max(1, Math.min(120, focusVal || DEFAULT_SETTINGS.focus));
    _settings.shortBreak = Math.max(1, Math.min(60, shortBreakVal || DEFAULT_SETTINGS.shortBreak));
    _settings.longBreak  = Math.max(1, Math.min(60, longBreakVal || DEFAULT_SETTINGS.longBreak));

    // Sound profile — only accept known keys
    var validSounds = ['classic_alarm', 'custom_1', 'custom_2', 'custom_3', 'custom_4', 'custom_5'];
    if (soundVal && validSounds.indexOf(soundVal) !== -1) {
      _settings.soundProfile = soundVal;
    }

    // Save custom URL fields
    for (var i = 1; i <= 5; i++) {
      var input = document.getElementById('input-customUrl' + i);
      _settings['customUrl' + i] = input ? input.value.trim() : '';
    }

    _saveSettings();

    // Reset the timer to match the new duration for the current mode
    _pauseTimer();
    const settingKey = MODES.find(m => m.key === _currentMode).settingKey;
    _setDuration(_settings[settingKey]);
    _isRunning = false;
    _clearTimerState();

    // Close modal and re-render
    _closeSettings();
    _renderApp();
  }

  // =============================================================
  //  TIMER LOGIC
  // =============================================================

  function _switchMode(mode) {
    _pauseTimer();
    _currentMode = mode;
    const settingKey = MODES.find(m => m.key === mode).settingKey;
    _setDuration(_settings[settingKey]);
    _isRunning = false;
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
    if (_secondsRemaining <= 0) {
      const settingKey = MODES.find(m => m.key === _currentMode).settingKey;
      _setDuration(_settings[settingKey]);
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
    _pauseTimer();
    const settingKey = MODES.find(m => m.key === _currentMode).settingKey;
    _setDuration(_settings[settingKey]);
    _clearTimerState();
    _renderApp();
  }

  function _skipTimer() {
    _pauseTimer();
    _secondsRemaining = 0;
    _onTimerComplete();
  }

  function _startInterval() {
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      const now   = Date.now();
      const delta = (now - _lastTickTime) / 1000;   // seconds elapsed since last tick
      _lastTickTime = now;

      if (delta > 0) {
        _secondsRemaining = Math.max(0, _secondsRemaining - delta);
      }

      // Timer completed — guard against oversleep past end time
      if (_secondsRemaining <= 0) {
        _secondsRemaining = 0;
        _onTimerComplete();
        return;
      }

      // Efficient DOM updates (no full re-render)
      const displaySeconds = Math.ceil(_secondsRemaining);
      const timeEl = document.getElementById('timer-time');
      const ringEl = document.getElementById('ring-progress');
      if (timeEl) {
        const m = Math.floor(displaySeconds / 60);
        const s = displaySeconds % 60;
        timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
      if (ringEl) {
        const p = (_totalSeconds - _secondsRemaining) / _totalSeconds;
        ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - Math.min(1, p));
      }

      _saveTimerState();
    }, 1000);
  }

  // =============================================================
  //  TIMER COMPLETION (stats hook is here)
  // =============================================================

  function _onTimerComplete() {
    _pauseTimer();
    _clearTimerState();
    _secondsRemaining = 0;

    // --- STATS HOOK: only record focus completions ---
    if (_currentMode === 'focus') {
      _incrementSessions();       // backward-compat dashboard counter
      _recordFocusCompletion();   // detailed stats (total time, daily history, streak)
    }

    // Audio and notification work regardless of which SPA tab is active
    _playSound(_settings.soundProfile);
    _showNotification();

    // --- AUTO-TRANSITION ---
    // Focus → Break (if enabled)
    if (_currentMode === 'focus' && _settings.autoStartBreaks) {
      const stats     = _loadStats();
      const breakMode = stats.completedPomodoros % 4 === 0 ? 'longBreak' : 'shortBreak';
      _currentMode = breakMode;
      _setDuration(_settings[MODES.find(m => m.key === breakMode).settingKey]);
      _startTimer();
      // Only re-render if user is actively viewing the Pomodoro tab
      if (_container) _renderApp();
      return;
    }

    // Break → Focus (if enabled)
    if ((_currentMode === 'shortBreak' || _currentMode === 'longBreak') && _settings.autoStartFocus) {
      _currentMode = 'focus';
      _setDuration(_settings.focus);
      _startTimer();
      if (_container) _renderApp();
      return;
    }

    // Full re-render to refresh the stats dashboard with updated numbers
    if (_container) {
      _renderApp();
      // Pulse animation on the updated stat values
      _pulseStatValues();
    }
  }

  /**
   * Briefly add a glow pulse class to stat values after an update.
   * The CSS animation handles the visual effect.
   */
  function _pulseStatValues() {
    ['stat-focus-time', 'stat-completed', 'stat-streak'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('stat-pulse');
        setTimeout(() => el.classList.remove('stat-pulse'), 600);
      }
    });
  }

  // =============================================================
  //  AUDIO: Classic alarm + 5 Custom URL slots
  // =============================================================

  /**
   * Play the selected sound profile.
   * - 'classic_alarm': synthesized beep sequence (Web Audio API).
   * - 'custom_N':      play the URL from settings; fallback to classic on error.
   */
  function _playSound(profile) {
    if (profile === 'classic_alarm') {
      _playClassicAlarm();
      return;
    }

    // Custom slot: extract the index from 'custom_1' .. 'custom_5'
    var match = profile.match(/^custom_(\d)$/);
    if (!match) {
      _playClassicAlarm();
      return;
    }

    var idx       = parseInt(match[1], 10);
    var url       = _settings['customUrl' + idx] || '';
    var trimmedUrl = url.trim();

    if (!trimmedUrl) {
      _playClassicAlarm();
      return;
    }

    // --- MyInstants smart converter ---
    var playUrl = trimmedUrl;
    var myinstantsMatch = trimmedUrl.match(/myinstants\.com.*\/instant\/([^\/\?]+)/);
    if (myinstantsMatch) {
      playUrl = 'https://www.myinstants.com/media/sounds/' + myinstantsMatch[1] + '.mp3';
    }

    try {
      var audio = new Audio(playUrl);
      var playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function () {
          _playClassicAlarm();
        });
      }
    } catch (_) {
      _playClassicAlarm();
    }
  }

  /**
   * Synthesize a classic multi-beep alarm via Web Audio API.
   * Used as default and as fallback when a custom URL fails.
   */
  function _playClassicAlarm() {
    try {
      var ctx = _getAudioContext();
      var now = ctx.currentTime;

      var master = ctx.createGain();
      master.gain.setValueAtTime(0.18, now);
      master.connect(ctx.destination);

      // Multi-beep: ascending square wave
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

  /** Lazy-init and return a shared AudioContext */
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
      const label = MODES.find(m => m.key === _currentMode).label;
      new Notification('Hub OS — Pomodoro', {
        body: `${label} session complete!`,
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
      const count = parseInt(localStorage.getItem(SESSIONS_KEY) || '0', 10);
      localStorage.setItem(SESSIONS_KEY, count + 1);
    } catch (_) { /* ignore */ }
  }

  // =============================================================
  //  PUBLIC API (module contract)
  // =============================================================
  return {
    id:   'pomodoro',
    name: 'Pomodoro',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
      <polyline points="10,5 10,10 14,12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    render,
    destroy
  };

})();

// Auto-register with the app router
if (typeof app !== 'undefined') {
  app.register(pomodoroModule);
}
