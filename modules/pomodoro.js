/* ============================================================
   HUB.OS — modules/pomodoro.js
   Pomodoro timer with circular SVG progress ring,
   focus/break modes, premium settings modal, professional
   statistics dashboard with weekly chart, Web Audio beep,
   and localStorage persistence for state, settings & stats.

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
    longBreak: 15
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
    _pauseTimer();
    if (_isRunning || _secondsRemaining < _totalSeconds) {
      _saveTimerState();
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
        _startInterval();
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
    const weeklyData = _getWeeklyData();

    // Format total focus time → "Xh Ym"
    const totalMin = Math.floor(stats.totalFocusSeconds / 60);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    const focusTimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    // Weekly chart: compute bar heights
    const maxMinutes = Math.max(...weeklyData.map(d => d.minutes), 1);

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

        <!-- Weekly chart -->
        <div class="weekly-chart glass-card">
          <h5 class="chart-heading">This Week · Focus Minutes</h5>
          <div class="chart-bars" id="weekly-bars">
            ${weeklyData.map(d => {
              const heightPct = Math.max(4, (d.minutes / maxMinutes) * 100);
              return `
                <div class="chart-bar-wrapper">
                  <span class="chart-bar-value">${d.minutes > 0 ? d.minutes + 'm' : ''}</span>
                  <div class="chart-bar${d.isToday ? ' chart-bar--today' : ''}"
                       style="height:${heightPct}%"
                       title="${d.dayName}: ${d.minutes} min focus">
                  </div>
                  <span class="chart-bar-label${d.isToday ? ' chart-bar-label--today' : ''}">${d.dayName}</span>
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
    const focusVal      = parseInt(document.getElementById('input-focus')?.value, 10);
    const shortBreakVal = parseInt(document.getElementById('input-shortBreak')?.value, 10);
    const longBreakVal  = parseInt(document.getElementById('input-longBreak')?.value, 10);

    // Validate and clamp
    _settings.focus      = Math.max(1, Math.min(120, focusVal || DEFAULT_SETTINGS.focus));
    _settings.shortBreak = Math.max(1, Math.min(60, shortBreakVal || DEFAULT_SETTINGS.shortBreak));
    _settings.longBreak  = Math.max(1, Math.min(60, longBreakVal || DEFAULT_SETTINGS.longBreak));

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
      if (_secondsRemaining > 0) {
        _secondsRemaining--;

        // Efficient DOM updates (no full re-render)
        const timeEl = document.getElementById('timer-time');
        const ringEl = document.getElementById('ring-progress');
        if (timeEl) {
          const m = Math.floor(_secondsRemaining / 60);
          const s = _secondsRemaining % 60;
          timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        if (ringEl) {
          const p = (_totalSeconds - _secondsRemaining) / _totalSeconds;
          ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - p);
        }

        _saveTimerState();
      } else {
        _onTimerComplete();
      }
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

    _playBeep();
    _showNotification();

    // Full re-render to refresh the stats dashboard with updated numbers
    _renderApp();

    // Pulse animation on the updated stat values
    _pulseStatValues();
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
  //  AUDIO: Web Audio API beep
  // =============================================================

  function _playBeep() {
    try {
      if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      [440, 554, 659].forEach((freq, i) => {
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, _audioCtx.currentTime + i * 0.15);
        gain.gain.setValueAtTime(0.15, _audioCtx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + i * 0.15 + 0.3);
        osc.connect(gain);
        gain.connect(_audioCtx.destination);
        osc.start(_audioCtx.currentTime + i * 0.15);
        osc.stop(_audioCtx.currentTime + i * 0.15 + 0.3);
      });
    } catch (_) { /* ignore */ }
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