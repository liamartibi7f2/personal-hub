/* ============================================================
   DASHBOARD — Command Center Module
   Central hub that reads all module data from localStorage
   and displays a high-level progress overview with glassmorphism
   widget cards.
   ============================================================ */

const dashboardModule = (function () {
  'use strict';

  // ── Constants ──
  const POMODORO_STATS_KEY = 'hub_pomodoro_stats';
  const FLASHCARD_KEY      = 'hub_flashcards';
  const QUIZ_DECKS_KEY     = 'quiz_decks';

  let _clockInterval = null;

  // ── Habit Board State ──
  var _vizMode = 'showAll';               // 'showAll' | 'priority'
  var _activeHabitIndex = 0;
  var _vizHabitData = [];                 // [{ title, description, deadline, reward, completed }]
	  var _selectedHabitForDesc = null;       // which habit the rich-text editor describes
	  var _vizStyleConfig = { fontFamily: 'inherit', outlineColor: '', shadowColor: '', glowColor: '', reflection: false };
	  var _vizDeadlineInterval = null;

  // ── Module Definition ──

  const module = {
    id: 'dashboard',
    name: 'Dashboard',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    </svg>`,

    /* ──────────────────────────────────────────────
       render(container) — Build the dashboard HTML
       ────────────────────────────────────────────── */
    render(container) {
      container.innerHTML = `
        <div class="tab-content dashboard">
          <!-- Hero Row: greeting + clock | viz habit board -->
          <div class="dashboard-hero-row">
            <div class="dashboard-hero">
              <p class="dashboard-greeting" id="dash-greeting">Hello</p>
              <h1 class="dashboard-clock" id="dash-clock">00:00</h1>
              <p class="dashboard-date" id="dash-date"></p>
            </div>
            <div class="hub-viz-board glass-card" id="hub-viz-board"></div>
          </div>

          <!-- Widget Grid — Command Center 2.0 -->
          <div>
            <p class="section-header dashboard-v2-header">⚡ Command Center</p>
            <div class="dashboard-widgets">

              <!-- ───────── Widget A: Pomodoro / Productivity ───────── -->
              <div class="widget-card-v2 glass-card widget-pomodoro">
                <div class="widget-v2-accent"></div>
                <div class="widget-v2-header">
                  <div class="widget-v2-icon-ring">
                    <span class="widget-icon">⏱️</span>
                  </div>
                  <div class="widget-v2-title-group">
                    <h3 class="widget-title">Focus &amp; Productivity</h3>
                    <span class="widget-v2-subtitle">Pomodoro Engine</span>
                  </div>
                </div>
                <div class="widget-body">
                  <div class="widget-stat-row">
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--cyan" id="w-focus-time">—</span>
                      <span class="widget-stat-label">Total Focus Time</span>
                    </div>
                    <div class="widget-stat-divider"></div>
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--cyan" id="w-streak">—</span>
                      <span class="widget-stat-label">Day Streak</span>
                    </div>
                  </div>
                  <p class="widget-empty" id="w-pomodoro-empty" style="display:none">No focus sessions yet</p>
                </div>
                <div class="widget-footer">
                  <button class="widget-btn widget-btn-cyan" data-target="pomodoro">
                    <svg class="widget-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                      <path d="M8 5v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    </svg>
                    Enter Focus Mode
                  </button>
                </div>
              </div>

              <!-- ───────── Widget B: Flashcards / SRS ───────── -->
              <div class="widget-card-v2 glass-card widget-flashcards">
                <div class="widget-v2-accent"></div>
                <div class="widget-v2-header">
                  <div class="widget-v2-icon-ring">
                    <span class="widget-icon">🃏</span>
                  </div>
                  <div class="widget-v2-title-group">
                    <h3 class="widget-title">Flashcard SRS</h3>
                    <span class="widget-v2-subtitle">Spaced Repetition</span>
                  </div>
                </div>
                <div class="widget-body">
                  <div class="widget-stat-row">
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--purple" id="w-total-cards">—</span>
                      <span class="widget-stat-label">Total Cards</span>
                    </div>
                    <div class="widget-stat-divider"></div>
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--due" id="w-due-cards">—</span>
                      <span class="widget-stat-label">Cards Due Today</span>
                    </div>
                  </div>
                  <p class="widget-empty" id="w-flashcard-empty" style="display:none">No flashcards yet</p>
                </div>
                <div class="widget-footer">
                  <button class="widget-btn widget-btn-purple" data-target="flashcards">
                    <svg class="widget-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 4l6 4 6-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                    </svg>
                    Review Due Cards
                  </button>
                </div>
              </div>

              <!-- ───────── Widget C: Quiz / Knowledge Base ───────── -->
              <div class="widget-card-v2 glass-card widget-quiz">
                <div class="widget-v2-accent"></div>
                <div class="widget-v2-header">
                  <div class="widget-v2-icon-ring">
                    <span class="widget-icon">📝</span>
                  </div>
                  <div class="widget-v2-title-group">
                    <h3 class="widget-title">Quiz &amp; Knowledge Base</h3>
                    <span class="widget-v2-subtitle">Challenge Mode</span>
                  </div>
                </div>
                <div class="widget-body">
                  <div class="widget-stat-row">
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--green" id="w-quiz-decks">—</span>
                      <span class="widget-stat-label">Quiz Decks</span>
                    </div>
                    <div class="widget-stat-divider"></div>
                    <div class="widget-stat">
                      <span class="widget-stat-value widget-stat-value--green" id="w-quiz-questions">—</span>
                      <span class="widget-stat-label">Total Questions</span>
                    </div>
                  </div>
                  <p class="widget-empty" id="w-quiz-empty" style="display:none">No quiz decks yet</p>
                </div>
                <div class="widget-footer">
                  <button class="widget-btn widget-btn-green" data-target="quiz">
                    <svg class="widget-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
                      <path d="M6 8l1.5 1.5L10 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Take a Quiz
                  </button>
                </div>
              </div>

            </div><!-- /dashboard-widgets -->
          </div>

          <!-- Quick Launch 2.0 -->
          <div>
            <p class="section-header dashboard-v2-header">🚀 Quick Launch</p>
            <div class="dashboard-launch">
              <div class="launch-card-v2 glass-card" data-target="flashcards">
                <div class="launch-card-v2-icon">
                  <span>🃏</span>
                </div>
                <div class="launch-card-v2-body">
                  <h3 class="launch-card-v2-title">Flashcards</h3>
                  <p class="launch-card-v2-desc">Study vocabulary with 3D flip cards</p>
                </div>
                <div class="launch-card-v2-arrow">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
              <div class="launch-card-v2 glass-card" data-target="pomodoro">
                <div class="launch-card-v2-icon">
                  <span>⏱️</span>
                </div>
                <div class="launch-card-v2-body">
                  <h3 class="launch-card-v2-title">Pomodoro</h3>
                  <p class="launch-card-v2-desc">Focus timer with progress tracking</p>
                </div>
                <div class="launch-card-v2-arrow">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
              <div class="launch-card-v2 glass-card" data-target="quiz">
                <div class="launch-card-v2-icon">
                  <span>📝</span>
                </div>
                <div class="launch-card-v2-body">
                  <h3 class="launch-card-v2-title">Quiz</h3>
                  <p class="launch-card-v2-desc">Multiple-choice challenge mode</p>
                </div>
                <div class="launch-card-v2-arrow">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <!-- KatsuDuckling Reserved Footer -->
          <div class="dashboard-footer">
            <div class="dashboard-footer-divider"></div>
            <div class="dashboard-footer-content">
              <p class="dashboard-footer-copy">© 2026 Developed by <span class="dashboard-footer-brand">KatsuDuckling</span>. All rights reserved.</p>
              <div class="dashboard-footer-links">
                <a href="https://www.facebook.com/HochirinoFromDuckland" class="dashboard-footer-link" target="_blank" rel="noopener noreferrer" title="Facebook">
                  <svg class="dashboard-footer-link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span>Facebook</span>
                </a>
                <span class="dashboard-footer-sep">·</span>
                <span class="dashboard-footer-link dashboard-footer-link--text" title="Discord">
                  <svg class="dashboard-footer-link-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18.5 5.5c-1.2-.6-2.5-1-3.8-1.2l-.2.4c-1.3-.2-2.7-.2-4 0l-.2-.4c-1.3.2-2.6.6-3.8 1.2C4 9.5 3 13.5 3 17.5c1.5 1 3 1.5 4.5 1.5l.6-.8c-.8-.3-1.6-.7-2.3-1.3l1-1c1.9 1.3 4 2 6.2 2s4.3-.7 6.2-2l1 1c-.7.6-1.5 1-2.3 1.3l.6.8c1.5 0 3-.5 4.5-1.5 0-4-.9-8-3-12zM8.5 15c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" fill="currentColor"/>
                  </svg>
                  <span>katsu5869</span>
                </span>
              </div>
            </div>
          </div>

        <!-- Habit Board Settings Modal -->
          <div class="hub-viz-settings-overlay" id="hub-viz-settings-overlay">
            <div class="hub-viz-settings-modal glass">
              <div class="hub-viz-settings-header">
                <h3>Habit Board</h3>
                <button class="hub-viz-settings-close" id="hub-viz-settings-close">&times;</button>
              </div>

              <!-- Display Mode Toggle -->
              <div class="hub-viz-settings-row">
                <span class="hub-viz-settings-label">Display Mode</span>
                <label class="toggle-switch">
                  <input type="checkbox" id="hub-viz-mode-toggle">
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <p style="font-size:0.62rem;color:var(--text-muted);font-family:var(--font-mono);" id="hub-viz-mode-desc">Show All (each habit visible)</p>

              <!-- Divider -->
              <div style="height:1px;background:var(--glass-border);margin:4px 0;"></div>

              <!-- Habit List Input -->
              <span class="hub-viz-desc-label">Habits (Max 5)</span>
              <div class="hub-viz-habit-list" id="hub-viz-habit-list">
                <!-- injected by _hydrateVizSettings -->
              </div>

              <!-- Select habit for description -->
              <span class="hub-viz-desc-label">Edit Description For</span>
              <select class="hub-viz-habit-select" id="hub-viz-habit-select">
                <option value="">-- Select a habit --</option>
              </select>

              <!-- Rich Text Editor -->
              <div>
                <span class="hub-viz-desc-label">Description</span>
                <div class="hub-viz-rich-text-container">
                  <div class="hub-viz-rich-toolbar" id="hub-viz-rich-toolbar">
                    <button type="button" class="hub-viz-rich-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>
                    <button type="button" class="hub-viz-rich-btn" data-cmd="italic" title="Italic"><em>I</em></button>
                    <button type="button" class="hub-viz-rich-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                    <span class="hub-viz-rich-sep"></span>
                    <label class="hub-viz-rich-color-label" title="Font Color">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      <input type="color" class="hub-viz-rich-color-picker" id="hub-viz-rich-color" value="#00f0ff">
                    </label>
                    <span class="hub-viz-rich-sep"></span>
                    <button type="button" class="hub-viz-rich-btn" data-cmd="indent" title="Indent">&gt;</button>
                    <button type="button" class="hub-viz-rich-btn" data-cmd="outdent" title="Outdent">&lt;</button>
                  </div>
                  <div id="hub-viz-desc-editor" contenteditable="true" class="hub-viz-rich-editor-area"></div>
                </div>
              </div>

              <!-- Divider -->
              <div style="height:1px;background:var(--glass-border);margin:4px 0;"></div>

              <!-- Typography Customizer -->
              <span class="hub-viz-desc-label">Typography Style</span>
              <div class="hub-viz-style-section">
                <div class="hub-viz-style-row">
                  <span class="hub-viz-style-mini-label">Font</span>
                  <select class="hub-viz-style-select" id="hub-viz-font-select">
                    <option value="inherit">System Default</option>
                    <option value="Arial, sans-serif">Arial</option>
                    <option value="Times New Roman, serif">Times New Roman</option>
                    <option value="Courier New, monospace">Courier New</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="Verdana, sans-serif">Verdana</option>
                    <option value="var(--font-heading)">Hub Display</option>
                  </select>
                </div>
                <div class="hub-viz-style-row">
                  <span class="hub-viz-style-mini-label">Outline</span>
                  <input type="color" class="hub-viz-style-color" id="hub-viz-outline-color" value="#000000">
                </div>
                <div class="hub-viz-style-row">
                  <span class="hub-viz-style-mini-label">Shadow</span>
                  <input type="color" class="hub-viz-style-color" id="hub-viz-shadow-color" value="#000000">
                </div>
                <div class="hub-viz-style-row">
                  <span class="hub-viz-style-mini-label">Glow</span>
                  <input type="color" class="hub-viz-style-color" id="hub-viz-glow-color" value="#000000">
                </div>
                <div class="hub-viz-style-tgl-row">
                  <span class="hub-viz-style-mini-label">Reflection</span>
                  <label class="toggle-switch">
                    <input type="checkbox" id="hub-viz-reflection-toggle">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <!-- Divider -->
              <div style="height:1px;background:var(--glass-border);margin:4px 0;"></div>

              <!-- Deadline & Reward per Habit -->
              <span class="hub-viz-desc-label">Deadline &amp; Reward</span>
              <div id="hub-viz-deadline-list">
                <!-- injected by _hydrateVizSettings -->
              </div>

              <!-- Save Button -->
              <button class="hub-viz-save-btn" id="hub-viz-save-btn">Save Habit Data</button>
            </div>
          </div>

        </div><!-- /dashboard -->
      `;

      // ── Restore persisted habit board mode ──
      try {
        var savedMode = localStorage.getItem('hub_viz_mode');
        if (savedMode === 'showAll' || savedMode === 'priority') { _vizMode = savedMode; }
      } catch (_) {}

      // ── Set up live data ──
      this._updateClock();
      _clockInterval = setInterval(() => this._updateClock(), 1000);
      this._updateWidgets();
      (function _initHB() { if (_vizHabitData.length === 0) { _vizHabitData = [{ title: 'Habit 1', description: '' }, { title: 'Habit 2', description: '' }]; } })();

      // ── Render habit board + bind its events ──
      this._renderVizBoard();
      this._bindVizEvents();
      this._bindVizSettingsHelper();

      // ── Bind Quick Launch card clicks ──
      container.querySelectorAll('.launch-card-v2[data-target]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('.widget-btn')) return;
          const target = el.dataset.target;
          if (target && typeof app !== 'undefined' && app.switchTo) {
            app.switchTo(target);
          }
        });
      });

      // ── Bind widget action buttons ──
      container.querySelectorAll('.widget-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.target;
          if (target && typeof app !== 'undefined' && app.switchTo) {
            app.switchTo(target);
          }
        });
      });
    },

    /* ──────────────────────────────────────────────
       destroy() — Cleanup
       ────────────────────────────────────────────── */
    destroy() {
      if (_clockInterval) {
        clearInterval(_clockInterval);
        _clockInterval = null;
      }
    },

    /* ──────────────────────────────────────────────
       _renderVizBoard() — Populate habit board
       ────────────────────────────────────────────── */
    _renderVizBoard() {
      var board = document.getElementById('hub-viz-board');
      if (!board) return;

      var self = this;
      var gearHtml = '<button class="hub-viz-board-gear" id="hub-viz-board-gear" title="Habit Board Settings"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1m0 11v1M1.5 8h1m11 0h1M3.4 3.4l.7.7m7.8 7.8l.7.7m-11.3 0l.7-.7m7.8-7.8l.7-.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>';
      var titleHtml = '<span class="hub-viz-board-title">Habit Tracker</span>';

      // Build inline style string from _vizStyleConfig
      var buildTitleStyle = function () {
        var s = '';
        if (_vizStyleConfig.fontFamily && _vizStyleConfig.fontFamily !== 'inherit') {
          s += 'font-family:' + _vizStyleConfig.fontFamily + ';';
        }
        if (_vizStyleConfig.outlineColor && _vizStyleConfig.outlineColor !== '#000000') {
          s += '-webkit-text-stroke:1px ' + _vizStyleConfig.outlineColor + ';';
        }
        if (_vizStyleConfig.shadowColor && _vizStyleConfig.shadowColor !== '#000000') {
          s += 'text-shadow:2px 2px 4px ' + _vizStyleConfig.shadowColor + ';';
        }
        if (_vizStyleConfig.glowColor && _vizStyleConfig.glowColor !== '#000000') {
          s += 'text-shadow:0 0 10px ' + _vizStyleConfig.glowColor + ', 0 0 20px ' + _vizStyleConfig.glowColor + ', 0 0 40px ' + _vizStyleConfig.glowColor + ';';
        }
        return s;
      };
      var titleStyle = buildTitleStyle();
      var titleReflectClass = _vizStyleConfig.reflection ? ' hub-viz-habit-title-reflect' : '';

      // Build one item markup
      var buildItemHtml = function (h, idx) {
        var titleStyled = '<span class="hub-viz-habit-title-styled' + titleReflectClass + '" style="' + titleStyle + '">' + (h.title || 'Untitled') + '</span>';

        var rewardHtml = '';
        if (h.reward && h.reward.trim()) {
          rewardHtml = '<span class="hub-viz-reward-chip">🏆 ' + (h.reward.replace(/"/g, '&quot;').replace(/</g, '&lt;')) + '</span>';
        }

        var deadlineHtml = '';
        if (h.deadline) {
          var deadlineClass = 'hub-viz-deadline-badge';
          if (h.completed) {
            deadlineClass += ' hub-viz-deadline-badge--done';
          }
          deadlineHtml = '<span class="' + deadlineClass + '" data-deadline="' + h.deadline + '" data-idx="' + idx + '">' + self._formatCountdown(h.deadline, h.completed) + '</span>';
        }

        var doneClass = h.completed ? ' hub-viz-board-item--done' : '';
        var completeAttr = h.completed ? '' : 'data-complete-idx="' + idx + '"';
        return '<div class="hub-viz-board-item' + doneClass + '" ' + completeAttr + '>' + titleStyled + rewardHtml + deadlineHtml + '</div>';
      };

      if (_vizMode === 'showAll') {
        var itemsHtml = '';
        for (var i = 0; i < _vizHabitData.length; i++) {
          itemsHtml += buildItemHtml(_vizHabitData[i], i);
        }
        board.innerHTML = titleHtml + '<div class="hub-viz-board-list">' + itemsHtml + '</div>' + gearHtml;
      } else {
        var idx = _activeHabitIndex;
        var habit = (_vizHabitData[idx] && _vizHabitData[idx].title) || (_vizHabitData[0] && _vizHabitData[0].title);
        board.innerHTML = titleHtml
          + '<div class="hub-viz-board-priority">'
            + '<span class="hub-viz-board-priority-label">Now Following</span>'
            + '<span class="hub-viz-board-priority-text hub-viz-habit-title-styled' + titleReflectClass + '" id="hub-viz-priority-text" style="' + titleStyle + '">' + habit + '</span>'
            + '<button class="hub-viz-cycle-btn" id="hub-viz-cycle-btn">'
              + '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3-4-3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 8l3-4-3-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              + 'Converse'
            + '</button>'
          + '</div>'
          + gearHtml;
      }
    },

    /* ──────────────────────────────────────────────────
       _formatCountdown(deadline, completed) → display str
       ────────────────────────────────────────────────── */
    _formatCountdown(deadlineStr, completed) {
      if (completed) return 'Done';
      if (!deadlineStr) return '';
      var dl = new Date(deadlineStr);
      if (isNaN(dl.getTime())) return '';
      var diff = dl.getTime() - Date.now();
      if (diff <= 0) return 'Time!';
      var totalSec = Math.floor(diff / 1000);
      var d = Math.floor(totalSec / 86400);
      var h = Math.floor((totalSec % 86400) / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    },

    /* ──────────────────────────────────────────────
       _bindVizEvents() — Attach habit board listeners
       ────────────────────────────────────────────── */
    _bindVizEvents() {
      var self = this;

      // Gear opens settings
      var gear = document.getElementById('hub-viz-board-gear');
      if (gear) {
        gear.addEventListener('click', function (e) {
          e.stopPropagation();
          self._openVizSettings();
        });
      }

      // Modal close
      var overlay = document.getElementById('hub-viz-settings-overlay');
      var closeBtn = document.getElementById('hub-viz-settings-close');
      var toggle = document.getElementById('hub-viz-mode-toggle');

      if (closeBtn && overlay) {
        closeBtn.addEventListener('click', function () {
          overlay.classList.remove('hub-viz-settings-overlay--visible');
        });
        overlay.addEventListener('click', function (e) {
          if (e.target === overlay) {
            overlay.classList.remove('hub-viz-settings-overlay--visible');
          }
        });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && overlay.classList.contains('hub-viz-settings-overlay--visible')) {
            overlay.classList.remove('hub-viz-settings-overlay--visible');
          }
        });
      }

      if (toggle) {
        toggle.addEventListener('change', function () {
          self._toggleVizMode();
        });
      }

      // Cycle button (priority mode only)
      var cycleBtn = document.getElementById('hub-viz-cycle-btn');
      if (cycleBtn) {
        cycleBtn.addEventListener('click', function () {
          self._cycleHabit(1);
        });
      }
    },

    /* ──────────────────────────────────────────────
       _bindVizSettingsHelper() — Additional Phase 2 bindings
	       ────────────────────────────────────────────── */
	    _bindVizSettingsHelper() {
	      var self = this;
	      var toolbar = document.getElementById('hub-viz-rich-toolbar');
	      if (toolbar) {
	        toolbar.addEventListener('click', function (e) {
	          var btn = e.target.closest('.hub-viz-rich-btn'); if (!btn) return;
	          e.preventDefault();
	          var cmd = btn.getAttribute('data-cmd');
	          if (cmd === 'indent') { document.execCommand('indent', false, null); } else if (cmd === 'outdent') { document.execCommand('outdent', false, null); } else { document.execCommand(cmd, false, null); }
	          var ed = document.getElementById('hub-viz-desc-editor'); if (ed) ed.focus();
	        });
	      }
	      var cp = document.getElementById('hub-viz-rich-color');
	      if (cp) { cp.addEventListener('input', function () { document.execCommand('foreColor', false, this.value); var ed = document.getElementById('hub-viz-desc-editor'); if (ed) ed.focus(); }); }
	      var sel = document.getElementById('hub-viz-habit-select');
	      if (sel) { sel.addEventListener('change', function () { self._selectHabitForDesc(this.value); }); }
	      var sb = document.getElementById('hub-viz-save-btn');
	      if (sb) { sb.addEventListener('click', function () { self._saveHabitData(); self._renderVizBoard(); self._bindVizEvents(); }); }
	    },

	    /* ──────────────────────────────────────────────
	       _hydrateVizSettings() — Populate habit list + selector
	       ────────────────────────────────────────────── */
	    _hydrateVizSettings() {
	      var list = document.getElementById('hub-viz-habit-list');
	      if (!list) return;
	      var html = '';
	      for (var i = 0; i < _vizHabitData.length; i++) {
	        html += '<div class="hub-viz-habit-row" data-index="' + i + '">'
	          + '<input class="hub-viz-habit-input" type="text" value="' + _vizHabitData[i].title.replace(/"/g, '&quot;') + '" placeholder="New habit item">'
	          + '<button class="hub-viz-habit-row-btn hub-viz-habit-row-btn--delete" title="Remove">&times;</button>'
	          + '</div>';
	      }
	      html += '<div class="hub-viz-habit-row">'
	        + '<input class="hub-viz-habit-input hub-viz-habit-input--new" type="text" placeholder="New habit item">'
	        + '<button class="hub-viz-habit-row-btn hub-viz-habit-row-btn--add" title="Add">+</button>'
	        + '</div>';
	      list.innerHTML = html;

	      var self = this;

	      // Add-button handler (click or Enter)
	      (function bindAddRow() {
	        var addBtn = list.querySelector('.hub-viz-habit-row-btn--add');
	        var addInput = list.querySelector('.hub-viz-habit-input--new');
	        if (!addInput) return;
	        var addNew = function () {
	          var val = addInput.value.trim();
	          if (!val || _vizHabitData.length >= 5) return;
	          _vizHabitData.push({ title: val, description: '' });
	          self._saveHabitData();
	          self._hydrateVizSettings();
	          self._bindVizSettingsHelper();
	          self._renderVizBoard();
	          self._bindVizEvents();
	        };
	        addInput.addEventListener('keydown', function (e) {
	          if (e.key === 'Enter') { e.preventDefault(); addNew(); }
	        });
	        if (addBtn) { addBtn.addEventListener('click', addNew); }
	      })();

	      // Delete buttons
	      list.querySelectorAll('.hub-viz-habit-row-btn--delete').forEach(function (btn) {
	        btn.addEventListener('click', function () {
	          var row = btn.closest('.hub-viz-habit-row');
	          var idx = row ? parseInt(row.getAttribute('data-index')) : -1;
	          if (idx >= 0 && idx < _vizHabitData.length) {
	            _vizHabitData.splice(idx, 1);
	            if (_selectedHabitForDesc === idx) _selectedHabitForDesc = null;
	            self._saveHabitData();
	            self._hydrateVizSettings();
	            self._bindVizSettingsHelper();
	            self._renderVizBoard();
	            self._bindVizEvents();
	          }
	        });
	      });

	      // Input change
	      list.querySelectorAll('.hub-viz-habit-input').forEach(function (inp, i) {
	        inp.addEventListener('blur', function () {
	          if (i >= _vizHabitData.length) return;
	          var v = this.value.trim();
	          if (v) { _vizHabitData[i].title = v; self._saveHabitData(); }
	          self._hydrateVizSettings();
	          self._bindVizSettingsHelper();
	          self._renderVizBoard();
	          self._bindVizEvents();
	        });
	      });

	      // Populate selector
	      var sel = document.getElementById('hub-viz-habit-select');
	      if (sel) {
	        sel.innerHTML = '<option value="">-- Select a habit --</option>';
	        for (var j = 0; j < _vizHabitData.length; j++) {
	          sel.innerHTML += '<option value="' + _vizHabitData[j].title.replace(/"/g, '&quot;') + '"' + (_selectedHabitForDesc === j ? ' selected' : '') + '>' + _vizHabitData[j].title + '</option>';
	        }
	      }

	      // Restore description for selected habit
	      var editor = document.getElementById('hub-viz-desc-editor');
	      if (editor && _selectedHabitForDesc !== null && _selectedHabitForDesc < _vizHabitData.length) {
	        editor.innerHTML = _vizHabitData[_selectedHabitForDesc].description || '';
	      } else if (editor) {
	        editor.innerHTML = '';
	      }
	    },

	    /* ──────────────────────────────────────────────
	       _selectHabitForDesc(val) — Switch editor context
	       ────────────────────────────────────────────── */
	    _selectHabitForDesc(val) {
	      var editor = document.getElementById('hub-viz-desc-editor');
	      if (!editor) return;

	      // Save current description to previously selected habit
	      if (_selectedHabitForDesc !== null && _selectedHabitForDesc < _vizHabitData.length) {
	        _vizHabitData[_selectedHabitForDesc].description = editor.innerHTML;
	      }

	      // Find new selection
	      if (!val) { _selectedHabitForDesc = null; editor.innerHTML = ''; return; }
	      for (var i = 0; i < _vizHabitData.length; i++) {
	        if (_vizHabitData[i].title === val) { _selectedHabitForDesc = i; break; }
	      }
	      if (_selectedHabitForDesc !== null && _selectedHabitForDesc < _vizHabitData.length) {
	        editor.innerHTML = _vizHabitData[_selectedHabitForDesc].description || '';
	      }
	    },

	    /* ──────────────────────────────────────────────
	       _saveHabitData() — Persist to localStorage
	       ────────────────────────────────────────────── */
	    _saveHabitData() {
	      // Grab description from editor before saving
	      var editor = document.getElementById('hub-viz-desc-editor');
	      if (editor && _selectedHabitForDesc !== null && _selectedHabitForDesc < _vizHabitData.length) {
	        _vizHabitData[_selectedHabitForDesc].description = editor.innerHTML;
	      }
	      try { localStorage.setItem('hub_viz_data', JSON.stringify(_vizHabitData)); } catch (_) {}
	    },

	    /* ──────────────────────────────────────────────
	       _openVizSettings() — Show settings modal
       ────────────────────────────────────────────── */
    _openVizSettings() {
      var overlay = document.getElementById('hub-viz-settings-overlay');
      var toggle = document.getElementById('hub-viz-mode-toggle');
      var desc = document.getElementById('hub-viz-mode-desc');
      if (!overlay) return;

      if (toggle) {
        toggle.checked = (_vizMode === 'priority');
      }
      if (desc) {
        desc.textContent = _vizMode === 'showAll'
          ? 'Show All (each habit visible)'
          : 'Priority (One) following one habit at a time';
      }
      overlay.classList.add('hub-viz-settings-overlay--visible');
	      this._hydrateVizSettings();
	      this._bindVizSettingsHelper();
    },

    /* ──────────────────────────────────────────────
       _toggleVizMode() — Flip between modes
       ────────────────────────────────────────────── */
    _toggleVizMode() {
      _vizMode = (_vizMode === 'showAll') ? 'priority' : 'showAll';
      try { localStorage.setItem('hub_viz_mode', _vizMode); } catch (_) {}
      this._renderVizBoard();
      this._bindVizEvents();
      this._bindVizSettingsHelper();
    },

    /* ──────────────────────────────────────────────
       _cycleHabit(direction) — Slide animation cycle
       ────────────────────────────────────────────── */
    _cycleHabit(direction) {
      direction = direction || 1;
      var len = _vizHabitData.length;
      if (len === 0) return;

      _activeHabitIndex = (_activeHabitIndex + direction + len) % len;
      var newHabit = (_vizHabitData[_activeHabitIndex] && _vizHabitData[_activeHabitIndex].title) || '';

      var textEl = document.getElementById('hub-viz-priority-text');
      if (!textEl) return;

      textEl.classList.add('hub-viz-anim-out');

      textEl.addEventListener('animationend', function outHandler() {
        textEl.removeEventListener('animationend', outHandler);
        textEl.textContent = newHabit;
        textEl.classList.remove('hub-viz-anim-out');
        textEl.classList.add('hub-viz-anim-in');

        textEl.addEventListener('animationend', function inHandler() {
          textEl.removeEventListener('animationend', inHandler);
          textEl.classList.remove('hub-viz-anim-in');
        });
      });
    },

    /* ──────────────────────────────────────────────
       _updateClock() — Live greeting + clock + date
       ────────────────────────────────────────────── */
    _updateClock() {
      const now = new Date();
      const hours   = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');

      setText('dash-clock', `${hours}:${minutes}`);

      // Localize date: vi uses vi-VN locale
      var sysLang = 'en';
      try { sysLang = localStorage.getItem('hub_system_language') || 'en'; } catch (_) {}
      var locale = sysLang === 'vi' ? 'vi-VN' : 'en-US';
      setText('dash-date', now.toLocaleDateString(locale, {
        weekday: 'long',
        year:    'numeric',
        month:   'long',
        day:     'numeric'
      }));

      const h = now.getHours();
      // Look up greeting from i18n dictionary if flashcardModule is available
      var greetingKey = 'greetingEvening';
      if (h < 12) greetingKey = 'greetingMorning';
      else if (h < 17) greetingKey = 'greetingAfternoon';
      var greeting = 'Good Evening, Commander.';
      // Try to use the i18n dictionary from flashcardModule
      if (typeof flashcardModule !== 'undefined') {
        try {
          var i18nDash = flashcardModule._getI18N ? flashcardModule._getI18N() : null;
          if (i18nDash && i18nDash.dash && i18nDash.dash[greetingKey]) {
            greeting = i18nDash.dash[greetingKey][sysLang] || i18nDash.dash[greetingKey]['en'];
          }
        } catch (_) {}
      }
      setText('dash-greeting', greeting);
    },

    /* ──────────────────────────────────────────────
       _updateWidgets() — Refresh all widget data
       ────────────────────────────────────────────── */
    _updateWidgets() {
      this._updatePomodoroWidget();
      this._updateFlashcardWidget();
      this._updateQuizWidget();
    },

    /* ──────────────────────────────────────────────
       _updatePomodoroWidget()
       Reads hub_pomodoro_stats: { totalFocusSeconds,
         completedPomodoros, dailyHistory, lastCompletedDate }
       ────────────────────────────────────────────── */
    _updatePomodoroWidget() {
      const stats = safeParse(POMODORO_STATS_KEY);
      const hasData = stats && typeof stats === 'object' && stats.totalFocusSeconds > 0;

      if (!hasData) {
        setText('w-focus-time', '—');
        setText('w-streak', '—');
        show('w-pomodoro-empty');
        return;
      }

      hide('w-pomodoro-empty');

      // Format focus time
      const totalMin = Math.floor((stats.totalFocusSeconds || 0) / 60);
      const hours    = Math.floor(totalMin / 60);
      const mins     = totalMin % 60;
      const focusStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      setText('w-focus-time', focusStr);

      // Calculate streak
      const streak = calcStreak(stats.dailyHistory || {});
      setText('w-streak', streak);
    },

    /* ──────────────────────────────────────────────
       _updateFlashcardWidget()
       Reads hub_flashcards: array of deck objects
       each with { cards: [{ nextReviewDate, ... }] }
       ────────────────────────────────────────────── */
    _updateFlashcardWidget() {
      const decks = safeParse(FLASHCARD_KEY);
      const hasData = Array.isArray(decks) && decks.length > 0;

      if (!hasData) {
        setText('w-total-cards', '0');
        setText('w-due-cards', '0');
        show('w-flashcard-empty');
        return;
      }

      hide('w-flashcard-empty');

      let totalCards = 0;
      let dueCards   = 0;
      const now      = Date.now();

      decks.forEach(function (deck) {
        const cards = deck.cards;
        if (!Array.isArray(cards)) return;
        totalCards += cards.length;
        cards.forEach(function (card) {
          // Strict validation: must be a finite number AND ≤ now
          if (typeof card.nextReviewDate === 'number'
              && isFinite(card.nextReviewDate)
              && card.nextReviewDate <= now) {
            dueCards++;
          }
        });
      });

      setText('w-total-cards', totalCards);

      const dueEl = document.getElementById('w-due-cards');
      if (dueEl) {
        dueEl.textContent = dueCards;
        // Highlight class for emphasis when cards are due
        dueEl.classList.toggle('has-due', dueCards > 0);
      }
    },

    /* ──────────────────────────────────────────────
       _updateQuizWidget()
       Reads quiz_decks: array of deck objects
       each with { sections: [{ questions: [...] }] }
       ────────────────────────────────────────────── */
    _updateQuizWidget() {
      const decks = safeParse(QUIZ_DECKS_KEY);
      const hasData = Array.isArray(decks) && decks.length > 0;

      if (!hasData) {
        setText('w-quiz-decks', '0');
        setText('w-quiz-questions', '0');
        show('w-quiz-empty');
        return;
      }

      hide('w-quiz-empty');

      setText('w-quiz-decks', decks.length);

      let totalQuestions = 0;
      decks.forEach(function (deck) {
        const sections = deck.sections;
        if (!Array.isArray(sections)) return;
        sections.forEach(function (section) {
          const questions = section.questions;
          if (Array.isArray(questions)) {
            totalQuestions += questions.length;
          }
        });
      });

      setText('w-quiz-questions', totalQuestions);
    }
  };

  // ── Internal Helpers ──

  /** Safe JSON.parse with fallback */
  function safeParse(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  /** Set textContent of an element by ID */
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /** Show an element by ID */
  function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  /** Hide an element by ID */
  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  /** Calculate current streak from dailyHistory map */
  function calcStreak(dailyHistory) {
    const dates = Object.keys(dailyHistory)
      .filter(d => (dailyHistory[d] || 0) > 0)
      .sort((a, b) => b.localeCompare(a));

    if (dates.length === 0) return 0;

    const todayKey       = dateKey(new Date());
    const yesterdayKey   = dateKey(new Date(Date.now() - 86400000));

    // Streak only counts if last completion is today or yesterday
    if (dates[0] !== todayKey && dates[0] !== yesterdayKey) return 0;

    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev     = new Date(dates[i - 1]);
      const curr     = new Date(dates[i]);
      if (Math.round((prev - curr) / 86400000) === 1) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  /** Format a Date → 'YYYY-MM-DD' */
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return module;
})();

// ── Register with the app router ──
if (typeof app !== 'undefined' && app.register) {
  app.register(dashboardModule);
}