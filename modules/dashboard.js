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
          <!-- Hero: greeting + clock -->
          <div class="dashboard-hero">
            <p class="dashboard-greeting" id="dash-greeting">Hello</p>
            <h1 class="dashboard-clock" id="dash-clock">00:00</h1>
            <p class="dashboard-date" id="dash-date"></p>
          </div>

          <!-- Widget Grid — Command Center -->
          <div>
            <p class="section-header">Command Center</p>
            <div class="dashboard-widgets">

              <!-- ───────── Widget A: Pomodoro / Productivity ───────── -->
              <div class="widget-card glass-card widget-pomodoro">
                <div class="widget-accent"></div>
                <div class="widget-header">
                  <span class="widget-icon">⏱️</span>
                  <h3 class="widget-title">Focus &amp; Productivity</h3>
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
              <div class="widget-card glass-card widget-flashcards">
                <div class="widget-accent"></div>
                <div class="widget-header">
                  <span class="widget-icon">🃏</span>
                  <h3 class="widget-title">Flashcard SRS</h3>
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
              <div class="widget-card glass-card widget-quiz">
                <div class="widget-accent"></div>
                <div class="widget-header">
                  <span class="widget-icon">📝</span>
                  <h3 class="widget-title">Quiz &amp; Knowledge Base</h3>
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

          <!-- Legacy quick-launch row — preserved for full-deck access -->
          <div>
            <p class="section-header">Quick Launch</p>
            <div class="dashboard-launch">
              <div class="launch-card glass-card" data-target="flashcards">
                <div class="launch-card-icon">🃏</div>
                <div class="launch-card-info">
                  <h3>Flashcards</h3>
                  <p>Study vocabulary with 3D flip cards</p>
                </div>
              </div>
              <div class="launch-card glass-card" data-target="pomodoro">
                <div class="launch-card-icon">⏱️</div>
                <div class="launch-card-info">
                  <h3>Pomodoro</h3>
                  <p>Focus timer with progress tracking</p>
                </div>
              </div>
              <div class="launch-card glass-card" data-target="quiz">
                <div class="launch-card-icon">📝</div>
                <div class="launch-card-info">
                  <h3>Quiz</h3>
                  <p>Multiple-choice challenge mode</p>
                </div>
              </div>
            </div>
          </div>

        </div><!-- /dashboard -->
      `;

      // ── Set up live data ──
      this._updateClock();
      _clockInterval = setInterval(() => this._updateClock(), 1000);
      this._updateWidgets();

      // ── Bind navigation clicks ──
      container.querySelectorAll('[data-target]').forEach(el => {
        el.addEventListener('click', (e) => {
          // Ignore clicks on widget buttons (they already have the listener below)
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
       _updateClock() — Live greeting + clock + date
       ────────────────────────────────────────────── */
    _updateClock() {
      const now = new Date();
      const hours   = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');

      setText('dash-clock', `${hours}:${minutes}`);

      setText('dash-date', now.toLocaleDateString('en-US', {
        weekday: 'long',
        year:    'numeric',
        month:   'long',
        day:     'numeric'
      }));

      const h = now.getHours();
      let greeting = 'Good Evening';
      if (h < 12) greeting = 'Good Morning';
      else if (h < 17) greeting = 'Good Afternoon';
      setText('dash-greeting', `${greeting}, Commander.`);
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

      for (let i = 0; i < decks.length; i++) {
        const cards = decks[i].cards;
        if (!Array.isArray(cards)) continue;
        totalCards += cards.length;
        for (let j = 0; j < cards.length; j++) {
          if (typeof cards[j].nextReviewDate === 'number' && cards[j].nextReviewDate <= now) {
            dueCards++;
          }
        }
      }

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
      for (let i = 0; i < decks.length; i++) {
        const sections = decks[i].sections;
        if (!Array.isArray(sections)) continue;
        for (let j = 0; j < sections.length; j++) {
          const questions = sections[j].questions;
          if (Array.isArray(questions)) {
            totalQuestions += questions.length;
          }
        }
      }

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
      const diffDays = Math.round((prev - curr) / 86400000);
      if (diffDays === 1) {
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