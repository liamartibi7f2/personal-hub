/* ============================================================
   DASHBOARD — Command Center Module (v3)
   Đọc dữ liệu các module từ localStorage và hiển thị tổng quan.
   Giao diện dùng class .dsh-* (xem dashboard.css) và token --cfk-*
   nên tự đồng bộ 4 theme: Cyberpunk, Solar Zen, Lo-Fi Twilight, Optimize.
   ============================================================ */

const dashboardModule = (function () {
  'use strict';

  // ── Storage keys ──
  const POMODORO_STATS_KEY = 'hub_pomodoro_stats';
  const FLASHCARD_KEY      = 'hub_flashcards';
  const QUIZ_DECKS_KEY     = 'quiz_decks';
  const CF_META_KEY        = 'hub_cf_meta';
  const HABIT_DATA_KEY     = 'hub_viz_data';
  const HABIT_STYLE_KEY    = 'hub_viz_style';
  const HABIT_MODE_KEY     = 'hub_viz_mode';
  const MAX_HABITS         = 5;

  // ── Runtime state ──
  let _clockInterval    = null;
  let _deadlineInterval = null;
  let _escHandler       = null;

  var _vizMode = 'showAll';               // 'showAll' | 'priority'
  var _activeHabitIndex = 0;
  var _vizHabitData = [];                 // [{ title, description, deadline, reward, completed }]
  var _selectedHabitForDesc = null;       // index của habit đang sửa mô tả
  var _vizStyleConfig = { fontFamily: 'inherit', outlineColor: '', shadowColor: '', glowColor: '', reflection: false };
  var _dueCards = 0;                      // dùng cho dòng "việc tiếp theo"

  // ── Text (en / vi) ──
  const I18N = {
    en: {
      today: 'Today', studyTitle: 'Study', moneyTitle: 'Money',
      focusTitle: 'Focus', focusSub: 'Pomodoro', focusTime: 'Focus time', dayStreak: 'Day streak',
      focusEmpty: 'No focus sessions yet. Start one to build a streak.', focusBtn: 'Start focus',
      cardsTitle: 'Flashcards', cardsSub: 'Spaced repetition', totalCards: 'Cards', dueToday: 'Due today',
      cardsEmpty: 'No flashcards yet. Create a deck to start reviewing.',
      cardsBtnDue: 'Review cards', cardsBtnNone: 'Create a deck', cardsBtnIdle: 'Open flashcards',
      dueShare: (d, n) => d + ' of ' + n + ' cards due',
      quizTitle: 'Quizzes', quizSub: 'Practice', quizDecks: 'Decks', quizQuestions: 'Questions',
      quizEmpty: 'No quiz decks yet. Create one to practice.', quizBtn: 'Take a quiz', quizBtnNone: 'Create a quiz deck',
      netWorth: 'Net worth', cash: 'Cash', bank: 'Bank', savings: 'Savings', openCf: 'Open CashFlow',
      mixLabel: 'How your money is split', moneyEmpty: 'No balances yet. Open CashFlow to add your accounts.',
      habits: 'Habits', habitsDone: (d, n) => d + ' of ' + n + ' done',
      habitsEmpty: 'No habits yet. Add up to five to track each day.', habitsAdd: 'Add a habit',
      habitsSettings: 'Habit settings', nowFollowing: 'Now following', switchHabit: 'Switch habit',
      timeUp: 'Time is up', done: 'Done',
      nextDue: n => n + (n === 1 ? ' card' : ' cards') + ' due for review',
      nextHabits: n => n + (n === 1 ? ' habit' : ' habits') + ' still open today',
      nextClear: 'Nothing due. A good time for a focus session.',
      reviewNow: 'Review now', saved: 'Saved',
      greetMorning: 'Good morning, Commander.', greetAfternoon: 'Good afternoon, Commander.', greetEvening: 'Good evening, Commander.'
    },
    vi: {
      today: 'Hôm nay', studyTitle: 'Học tập', moneyTitle: 'Tài chính',
      focusTitle: 'Tập trung', focusSub: 'Pomodoro', focusTime: 'Tổng thời gian', dayStreak: 'Chuỗi ngày',
      focusEmpty: 'Chưa có phiên tập trung nào. Bắt đầu một phiên để tạo chuỗi ngày.', focusBtn: 'Bắt đầu tập trung',
      cardsTitle: 'Flashcard', cardsSub: 'Lặp lại ngắt quãng', totalCards: 'Tổng số thẻ', dueToday: 'Đến hạn',
      cardsEmpty: 'Chưa có thẻ nào. Tạo một bộ thẻ để bắt đầu ôn.',
      cardsBtnDue: 'Ôn tập thẻ', cardsBtnNone: 'Tạo bộ thẻ', cardsBtnIdle: 'Mở flashcard',
      dueShare: (d, n) => d + '/' + n + ' thẻ đến hạn',
      quizTitle: 'Trắc nghiệm', quizSub: 'Luyện tập', quizDecks: 'Bộ đề', quizQuestions: 'Câu hỏi',
      quizEmpty: 'Chưa có bộ đề nào. Tạo một bộ để luyện tập.', quizBtn: 'Làm trắc nghiệm', quizBtnNone: 'Tạo bộ đề',
      netWorth: 'Tài sản ròng', cash: 'Tiền mặt', bank: 'Ngân hàng', savings: 'Tiết kiệm', openCf: 'Mở CashFlow',
      mixLabel: 'Cơ cấu tiền của bạn', moneyEmpty: 'Chưa có số dư. Mở CashFlow để thêm tài khoản.',
      habits: 'Thói quen', habitsDone: (d, n) => d + '/' + n + ' hoàn thành',
      habitsEmpty: 'Chưa có thói quen nào. Thêm tối đa năm thói quen để theo dõi mỗi ngày.', habitsAdd: 'Thêm thói quen',
      habitsSettings: 'Cài đặt thói quen', nowFollowing: 'Đang theo dõi', switchHabit: 'Đổi thói quen',
      timeUp: 'Hết giờ', done: 'Xong',
      nextDue: n => n + ' thẻ cần ôn hôm nay',
      nextHabits: n => 'Còn ' + n + ' thói quen chưa xong hôm nay',
      nextClear: 'Không có gì đến hạn. Hợp để làm một phiên tập trung.',
      reviewNow: 'Ôn ngay', saved: 'Đã lưu',
      greetMorning: 'Chào buổi sáng, Commander.', greetAfternoon: 'Chào buổi chiều, Commander.', greetEvening: 'Chào buổi tối, Commander.'
    }
  };

  function sysLang() {
    try { return localStorage.getItem('hub_system_language') === 'vi' ? 'vi' : 'en'; } catch (_) { return 'en'; }
  }
  function t(key) {
    const dict = I18N[sysLang()] || I18N.en;
    const v = (key in dict) ? dict[key] : I18N.en[key];
    return typeof v === 'function' ? v.apply(null, Array.prototype.slice.call(arguments, 1)) : v;
  }

  // ── Icons (đường nét, dùng currentColor nên đổi theo theme) ──
  const ICON = {
    focus: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="11" r="6.5"/><path d="M10 8v3.5l2 1.5M8 2.5h4"/></svg>',
    cards: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="11" height="11" rx="2"/><path d="M6 3.5h8.5A2.5 2.5 0 0 1 17 6v8.5"/></svg>',
    quiz:  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5"/><path d="M7 10.2l2 2 4-4.4"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    gear:  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1m0 11v1M1.5 8h1m11 0h1M3.4 3.4l.7.7m7.8 7.8l.7.7m-11.3 0l.7-.7m7.8-7.8l.7-.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    gift:  '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>',
    fb:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3V2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dc:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18.5 5.5c-1.2-.6-2.5-1-3.8-1.2l-.2.4c-1.3-.2-2.7-.2-4 0l-.2-.4c-1.3.2-2.6.6-3.8 1.2C4 9.5 3 13.5 3 17.5c1.5 1 3 1.5 4.5 1.5l.6-.8c-.8-.3-1.6-.7-2.3-1.3l1-1c1.9 1.3 4 2 6.2 2s4.3-.7 6.2-2l1 1c-.7.6-1.5 1-2.3 1.3l.6.8c1.5 0 3-.5 4.5-1.5 0-4-.9-8-3-12zM8.5 15c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" fill="currentColor"/></svg>'
  };

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
       render(container)
       ────────────────────────────────────────────── */
    render(container) {
      loadHabitState();

      const metric = (id, label, extra) =>
        '<div class="dsh-metric"><dt>' + label + '</dt><dd id="' + id + '"' + (extra || '') + '>—</dd></div>';

      container.innerHTML = `
        <div class="dashboard dsh">

          <!-- Hero: hôm nay + thói quen -->
          <header class="dsh-hero">
            <section class="dsh-today dsh-surface" aria-label="${t('today')}">
              <p class="dsh-greeting" id="dash-greeting"></p>
              <h1 class="dsh-clock" id="dash-clock">00:00</h1>
              <p class="dsh-date" id="dash-date"></p>
              <div class="dsh-next" id="dsh-next"></div>
            </section>
            <section class="dsh-habits dsh-surface" id="hub-viz-board" aria-label="${t('habits')}"></section>
          </header>

          <!-- Học tập -->
          <section aria-labelledby="dsh-h-study">
            <h2 class="dsh-section-title" id="dsh-h-study">${t('studyTitle')}</h2>
            <div class="dsh-grid">

              <article class="dsh-card dsh-card--focus dsh-surface">
                <div class="dsh-card-head">
                  <span class="dsh-icon">${ICON.focus}</span>
                  <div><h3 class="dsh-card-title">${t('focusTitle')}</h3><p class="dsh-card-sub">${t('focusSub')}</p></div>
                </div>
                <dl class="dsh-metrics">
                  ${metric('w-focus-time', t('focusTime'))}
                  ${metric('w-streak', t('dayStreak'))}
                </dl>
                <p class="dsh-empty" id="w-pomodoro-empty" style="display:none">${t('focusEmpty')}</p>
                <div class="dsh-card-foot">
                  <button type="button" class="dsh-btn dsh-btn--ghost" data-target="pomodoro">${t('focusBtn')}</button>
                </div>
              </article>

              <article class="dsh-card dsh-card--cards dsh-surface">
                <div class="dsh-card-head">
                  <span class="dsh-icon">${ICON.cards}</span>
                  <div><h3 class="dsh-card-title">${t('cardsTitle')}</h3><p class="dsh-card-sub">${t('cardsSub')}</p></div>
                </div>
                <dl class="dsh-metrics">
                  ${metric('w-total-cards', t('totalCards'))}
                  ${metric('w-due-cards', t('dueToday'))}
                </dl>
                <div id="w-cards-meter" style="display:none">
                  <div class="dsh-bar" role="img" id="w-cards-bar"><span id="w-cards-fill"></span></div>
                  <p class="dsh-meter-note" id="w-cards-note"></p>
                </div>
                <p class="dsh-empty" id="w-flashcard-empty" style="display:none">${t('cardsEmpty')}</p>
                <div class="dsh-card-foot">
                  <button type="button" class="dsh-btn dsh-btn--ghost" data-target="flashcards" id="w-cards-btn">${t('cardsBtnNone')}</button>
                </div>
              </article>

              <article class="dsh-card dsh-card--quiz dsh-surface">
                <div class="dsh-card-head">
                  <span class="dsh-icon">${ICON.quiz}</span>
                  <div><h3 class="dsh-card-title">${t('quizTitle')}</h3><p class="dsh-card-sub">${t('quizSub')}</p></div>
                </div>
                <dl class="dsh-metrics">
                  ${metric('w-quiz-decks', t('quizDecks'))}
                  ${metric('w-quiz-questions', t('quizQuestions'))}
                </dl>
                <p class="dsh-empty" id="w-quiz-empty" style="display:none">${t('quizEmpty')}</p>
                <div class="dsh-card-foot">
                  <button type="button" class="dsh-btn dsh-btn--ghost" data-target="quiz" id="w-quiz-btn">${t('quizBtnNone')}</button>
                </div>
              </article>

            </div>
          </section>

          <!-- Tài chính -->
          <section aria-labelledby="dsh-h-money">
            <h2 class="dsh-section-title" id="dsh-h-money">${t('moneyTitle')}</h2>
            <article class="dsh-money dsh-surface" data-target="cashflow" tabindex="0" role="link" aria-label="${t('openCf')}">
              <div class="dsh-money-main">
                <p class="dsh-money-label">${t('netWorth')}</p>
                <p class="dsh-money-total" id="w-cf-networth">0 đ</p>
                <p class="dsh-empty" id="w-cf-empty" style="display:none">${t('moneyEmpty')}</p>
                <button type="button" class="dsh-btn dsh-btn--ghost" data-target="cashflow" tabindex="-1">${t('openCf')}</button>
              </div>
              <div class="dsh-money-side">
                <div class="dsh-mix" id="w-cf-mix" role="img" aria-label="${t('mixLabel')}" style="display:none">
                  <span class="dsh-mix-seg dsh-mix-seg--cash"></span>
                  <span class="dsh-mix-seg dsh-mix-seg--bank"></span>
                  <span class="dsh-mix-seg dsh-mix-seg--save"></span>
                </div>
                <ul class="dsh-acct">
                  <li><span class="dsh-swatch dsh-swatch--cash"></span><span class="dsh-acct-name">${t('cash')}</span><span class="dsh-acct-val" id="w-cf-cash">0 đ</span></li>
                  <li><span class="dsh-swatch dsh-swatch--bank"></span><span class="dsh-acct-name">${t('bank')}</span><span class="dsh-acct-val" id="w-cf-bank">0 đ</span></li>
                  <li><span class="dsh-swatch dsh-swatch--save"></span><span class="dsh-acct-name">${t('savings')}</span><span class="dsh-acct-val" id="w-cf-savings">0 đ</span></li>
                </ul>
              </div>
            </article>
          </section>

          <footer class="dsh-foot">
            <p>© 2026 Developed by <b>KatsuDuckling</b>. All rights reserved.</p>
            <div class="dsh-foot-links">
              <a class="dsh-foot-link" href="https://www.facebook.com/HochirinoFromDuckland" target="_blank" rel="noopener noreferrer">${ICON.fb}<span>Facebook</span></a>
              <span class="dsh-foot-link" title="Discord">${ICON.dc}<span>katsu5869</span></span>
            </div>
          </footer>

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
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
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
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
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

        </div><!-- /dsh -->
      `;

      // ── Live data ──
      this._updateClock();
      _clockInterval = setInterval(() => this._updateClock(), 1000);
      this._updateWidgets();
      this._renderVizBoard();
      this._startDeadlineTimer();

      // ── Events (delegation, gắn một lần cho mỗi lần render) ──
      const root  = container.querySelector('.dsh');
      const board = document.getElementById('hub-viz-board');
      const go = (target) => { if (target && typeof app !== 'undefined' && app.switchTo) app.switchTo(target); };
      const self = this;

      root.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-target]');
        if (nav && root.contains(nav)) go(nav.dataset.target);
      });
      root.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-target]')) {
          e.preventDefault();
          go(e.target.dataset.target);
        }
      });

      board.addEventListener('click', (e) => {
        const check = e.target.closest('.dsh-check');
        if (check) {
          const idx = parseInt(check.getAttribute('data-habit-idx'), 10);
          if (idx >= 0 && idx < _vizHabitData.length) {
            _vizHabitData[idx].completed = !_vizHabitData[idx].completed;
            self._saveHabitData();
            self._renderVizBoard();
            self._refreshNext();
            self._startDeadlineTimer();
          }
          return;
        }
        if (e.target.closest('#hub-viz-board-gear') || e.target.closest('[data-hb-add]')) { self._openVizSettings(); return; }
        if (e.target.closest('#hub-viz-cycle-btn')) { self._cycleHabit(1); }
      });

      this._bindVizModal();
    },

    /* ──────────────────────────────────────────────
       destroy() — dọn timer + listener toàn cục
       ────────────────────────────────────────────── */
    destroy() {
      if (_clockInterval)    { clearInterval(_clockInterval);    _clockInterval = null; }
      if (_deadlineInterval) { clearInterval(_deadlineInterval); _deadlineInterval = null; }
      if (_escHandler)       { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
    },

    /* ──────────────────────────────────────────────
       _renderVizBoard() — Bảng thói quen
       ────────────────────────────────────────────── */
    _renderVizBoard() {
      const board = document.getElementById('hub-viz-board');
      if (!board) return;

      const total = _vizHabitData.length;
      const done  = _vizHabitData.filter(h => h.completed).length;
      const pct   = total ? Math.round(done / total * 100) : 0;

      const titleStyle = buildTitleStyle();
      const reflect    = _vizStyleConfig.reflection ? ' hub-viz-habit-title-reflect' : '';

      let html = '<div class="dsh-hb-head">'
        + '<h2 class="dsh-hb-title">' + t('habits') + '</h2>'
        + (total ? '<span class="dsh-hb-count">' + esc(t('habitsDone', done, total)) + '</span>' : '')
        + '<button type="button" class="dsh-hb-gear" id="hub-viz-board-gear" title="' + t('habitsSettings') + '" aria-label="' + t('habitsSettings') + '">' + ICON.gear + '</button>'
        + '</div>';

      if (total) {
        html += '<div class="dsh-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="' + t('habits') + '"><span style="width:' + pct + '%"></span></div>';
      }

      if (!total) {
        html += '<div class="dsh-hb-empty"><p class="dsh-empty">' + t('habitsEmpty') + '</p>'
          + '<button type="button" class="dsh-btn dsh-btn--ghost" data-hb-add>' + t('habitsAdd') + '</button></div>';

      } else if (_vizMode === 'showAll') {
        html += '<ul class="dsh-hb-list">';
        _vizHabitData.forEach((h, i) => {
          const isDone = h.completed === true;
          html += '<li class="dsh-hb-item' + (isDone ? ' is-done' : '') + '">'
            + checkHtml(i, isDone, h.title)
            + '<span class="dsh-hb-name hub-viz-habit-title-styled' + reflect + '" style="' + titleStyle + '">' + esc(h.title || 'Untitled') + '</span>'
            + rewardHtml(h) + deadlineHtml(h, i, isDone)
            + '</li>';
        });
        html += '</ul>';

      } else {
        if (_activeHabitIndex >= total) _activeHabitIndex = 0;
        const h = _vizHabitData[_activeHabitIndex];
        const isDone = h.completed === true;
        html += '<div class="dsh-hb-focus">'
          + '<span class="dsh-hb-focus-label">' + t('nowFollowing') + '</span>'
          + '<div class="dsh-hb-focus-row' + (isDone ? ' is-done' : '') + '">'
          +   checkHtml(_activeHabitIndex, isDone, h.title)
          +   '<span class="dsh-hb-focus-title hub-viz-habit-title-styled' + reflect + '" id="hub-viz-priority-text" style="' + titleStyle + '">' + esc(h.title || 'Untitled') + '</span>'
          + '</div>'
          + (rewardHtml(h) || deadlineHtml(h, _activeHabitIndex, isDone) ? '<div class="dsh-hb-meta">' + rewardHtml(h) + deadlineHtml(h, _activeHabitIndex, isDone) + '</div>' : '')
          + (total > 1 ? '<button type="button" class="dsh-btn dsh-btn--ghost" id="hub-viz-cycle-btn">' + t('switchHabit') + '</button>' : '')
          + '</div>';
      }

      board.innerHTML = html;
    },

    /* ──────────────────────────────────────────────
       _refreshNext() — Dòng "việc tiếp theo" ở hero
       ────────────────────────────────────────────── */
    _refreshNext() {
      const el = document.getElementById('dsh-next');
      if (!el) return;
      const left = _vizHabitData.filter(h => !h.completed).length;
      let text, label, target;
      if (_dueCards > 0)  { text = t('nextDue', _dueCards); label = t('reviewNow');  target = 'flashcards'; }
      else if (left > 0)  { text = t('nextHabits', left);   label = t('focusBtn'); target = 'pomodoro'; }
      else                { text = t('nextClear');          label = t('focusBtn');   target = 'pomodoro'; }
      el.innerHTML = '<p class="dsh-next-text">' + esc(text) + '</p>'
        + '<button type="button" class="dsh-btn dsh-btn--primary" data-target="' + target + '">' + esc(label) + '</button>';
    },

    /* ──────────────────────────────────────────────
       Deadline — đếm ngược theo thời gian thực
       ────────────────────────────────────────────── */
    _startDeadlineTimer() {
      if (_deadlineInterval) { clearInterval(_deadlineInterval); _deadlineInterval = null; }
      if (!_vizHabitData.some(h => h.deadline && !h.completed)) return;

      _deadlineInterval = setInterval(() => {
        const badges = document.querySelectorAll('.dsh-hb-dl[data-deadline]:not(.is-done)');
        if (badges.length === 0) { clearInterval(_deadlineInterval); _deadlineInterval = null; return; }

        let expired = false;
        badges.forEach(badge => {
          const dl  = badge.getAttribute('data-deadline');
          const idx = parseInt(badge.getAttribute('data-idx'), 10);
          const diff = deadlineDiff(dl);
          if (diff === null) return;
          if (diff <= 0) {
            // Hết giờ → tự đánh dấu hoàn thành (giữ nguyên hành vi cũ)
            if (_vizHabitData[idx] && !_vizHabitData[idx].completed) {
              _vizHabitData[idx].completed = true;
              expired = true;
            }
          } else {
            badge.textContent = this._formatCountdown(dl, false);
            badge.classList.toggle('is-urgent', diff < 3600000);
          }
        });

        if (expired) {
          this._saveHabitData();
          // Hiệu ứng chỉ chạy khi không ở Optimize / perf-lite
          const lite = document.body.classList.contains('theme-optimized') || document.body.classList.contains('perf-lite');
          const board = document.getElementById('hub-viz-board');
          if (board && !lite) {
            board.classList.add('is-pulse');
            setTimeout(() => board.classList.remove('is-pulse'), 2600);
          }
          this._renderVizBoard();
          this._refreshNext();
        }
      }, 1000);
    },

    _formatCountdown(deadlineStr, completed) {
      if (completed) return t('done');
      const diff = deadlineDiff(deadlineStr);
      if (diff === null) return '';
      if (diff <= 0) return t('timeUp');
      const totalSec = Math.floor(diff / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    },

    /* ──────────────────────────────────────────────
       Modal cài đặt Habit — gắn listener MỘT lần
       ────────────────────────────────────────────── */
    _bindVizModal() {
      const self    = this;
      const overlay = document.getElementById('hub-viz-settings-overlay');
      const closeBtn = document.getElementById('hub-viz-settings-close');
      const toggle  = document.getElementById('hub-viz-mode-toggle');
      if (!overlay) return;

      const close = () => overlay.classList.remove('active');
      if (closeBtn) closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      if (_escHandler) document.removeEventListener('keydown', _escHandler);
      _escHandler = (e) => { if (e.key === 'Escape' && overlay.classList.contains('active')) close(); };
      document.addEventListener('keydown', _escHandler);

      if (toggle) toggle.addEventListener('change', () => self._toggleVizMode());

      // Rich-text toolbar
      const toolbar = document.getElementById('hub-viz-rich-toolbar');
      const editor  = document.getElementById('hub-viz-desc-editor');
      if (toolbar) {
        toolbar.addEventListener('click', (e) => {
          const btn = e.target.closest('.hub-viz-rich-btn');
          if (!btn) return;
          e.preventDefault();
          document.execCommand(btn.getAttribute('data-cmd'), false, null);
          if (editor) editor.focus();
        });
      }
      const cp = document.getElementById('hub-viz-rich-color');
      if (cp) cp.addEventListener('input', function () {
        document.execCommand('foreColor', false, this.value);
        if (editor) editor.focus();
      });

      const sel = document.getElementById('hub-viz-habit-select');
      if (sel) sel.addEventListener('change', function () { self._selectHabitForDesc(this.value); });

      // Save
      const sb = document.getElementById('hub-viz-save-btn');
      if (sb) sb.addEventListener('click', function () {
        _vizStyleConfig.fontFamily   = document.getElementById('hub-viz-font-select')?.value || 'inherit';
        _vizStyleConfig.outlineColor = document.getElementById('hub-viz-outline-color')?.value || '#000000';
        _vizStyleConfig.shadowColor  = document.getElementById('hub-viz-shadow-color')?.value || '#000000';
        _vizStyleConfig.glowColor    = document.getElementById('hub-viz-glow-color')?.value || '#000000';
        _vizStyleConfig.reflection   = document.getElementById('hub-viz-reflection-toggle')?.checked || false;
        try { localStorage.setItem(HABIT_STYLE_KEY, JSON.stringify(_vizStyleConfig)); } catch (_) {}

        document.querySelectorAll('.hub-viz-dl-input').forEach(inp => {
          const i = parseInt(inp.getAttribute('data-idx'), 10);
          if (_vizHabitData[i]) _vizHabitData[i].deadline = inp.value;
        });
        document.querySelectorAll('.hub-viz-rw-input').forEach(inp => {
          const i = parseInt(inp.getAttribute('data-idx'), 10);
          if (_vizHabitData[i]) _vizHabitData[i].reward = inp.value;
        });

        self._saveHabitData();
        self._renderVizBoard();
        self._refreshNext();
        self._startDeadlineTimer();

        const old = sb.textContent;
        sb.textContent = t('saved');
        setTimeout(() => { sb.textContent = old; }, 1200);
      });
    },

    _hydrateVizSettings() {
      const self = this;

      // 1. Danh sách habit
      const list = document.getElementById('hub-viz-habit-list');
      if (list) {
        let html = '';
        _vizHabitData.forEach((h, i) => {
          html += '<div class="hub-viz-habit-row" data-index="' + i + '">'
            + '<input class="hub-viz-habit-input" type="text" value="' + escAttr(h.title) + '" placeholder="New habit item">'
            + '<button type="button" class="hub-viz-habit-row-btn hub-viz-habit-row-btn--delete" title="Remove">&times;</button>'
            + '</div>';
        });
        if (_vizHabitData.length < MAX_HABITS) {
          html += '<div class="hub-viz-habit-row">'
            + '<input class="hub-viz-habit-input hub-viz-habit-input--new" type="text" placeholder="New habit item">'
            + '<button type="button" class="hub-viz-habit-row-btn hub-viz-habit-row-btn--add" title="Add">+</button>'
            + '</div>';
        }
        list.innerHTML = html;

        const addInput = list.querySelector('.hub-viz-habit-input--new');
        const addBtn   = list.querySelector('.hub-viz-habit-row-btn--add');
        const addNew = () => {
          const val = addInput.value.trim();
          if (!val || _vizHabitData.length >= MAX_HABITS) return;
          _vizHabitData.push({ title: val, description: '', deadline: '', reward: '', completed: false });
          self._afterHabitListChange();
        };
        if (addInput) addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
        if (addBtn) addBtn.addEventListener('click', addNew);

        list.querySelectorAll('.hub-viz-habit-row-btn--delete').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.closest('.hub-viz-habit-row').getAttribute('data-index'), 10);
            if (idx >= 0) {
              _vizHabitData.splice(idx, 1);
              if (_selectedHabitForDesc === idx) _selectedHabitForDesc = null;
              else if (_selectedHabitForDesc !== null && _selectedHabitForDesc > idx) _selectedHabitForDesc--;
              if (_activeHabitIndex >= _vizHabitData.length) _activeHabitIndex = 0;
              self._afterHabitListChange();
            }
          });
        });
        list.querySelectorAll('.hub-viz-habit-input:not(.hub-viz-habit-input--new)').forEach((inp, i) => {
          inp.addEventListener('blur', function () {
            const v = this.value.trim();
            if (v && _vizHabitData[i] && v !== _vizHabitData[i].title) {
              _vizHabitData[i].title = v;
              self._afterHabitListChange();
            }
          });
        });
      }

      // 2. Typography
      const setVal = (id, val, isCheck) => { const el = document.getElementById(id); if (el) { if (isCheck) el.checked = val; else el.value = val; } };
      setVal('hub-viz-font-select',   _vizStyleConfig.fontFamily || 'inherit', false);
      setVal('hub-viz-outline-color', _vizStyleConfig.outlineColor || '#000000', false);
      setVal('hub-viz-shadow-color',  _vizStyleConfig.shadowColor  || '#000000', false);
      setVal('hub-viz-glow-color',    _vizStyleConfig.glowColor    || '#000000', false);
      setVal('hub-viz-reflection-toggle', _vizStyleConfig.reflection || false, true);

      // 3. Deadline & reward
      const dlList = document.getElementById('hub-viz-deadline-list');
      if (dlList) {
        dlList.innerHTML = _vizHabitData.map((h, i) =>
          '<div class="dsh-dl-row">'
          + '<span class="dsh-dl-name">' + esc(h.title) + '</span>'
          + '<div class="dsh-dl-fields">'
          +   '<input type="datetime-local" class="dsh-input hub-viz-dl-input" data-idx="' + i + '" value="' + escAttr(h.deadline || '') + '">'
          +   '<input type="text" class="dsh-input hub-viz-rw-input" data-idx="' + i + '" value="' + escAttr(h.reward || '') + '" placeholder="Reward (e.g., Watch a movie)">'
          + '</div></div>'
        ).join('');
      }

      // 4. Chọn habit để sửa mô tả (value = chỉ số, không phụ thuộc tên trùng)
      const sel = document.getElementById('hub-viz-habit-select');
      const editor = document.getElementById('hub-viz-desc-editor');
      if (sel) {
        sel.innerHTML = '<option value="">-- Select a habit --</option>'
          + _vizHabitData.map((h, j) => '<option value="' + j + '"' + (_selectedHabitForDesc === j ? ' selected' : '') + '>' + esc(h.title) + '</option>').join('');
      }
      if (editor) {
        editor.innerHTML = (_selectedHabitForDesc !== null && _vizHabitData[_selectedHabitForDesc])
          ? (_vizHabitData[_selectedHabitForDesc].description || '') : '';
      }
    },

    _afterHabitListChange() {
      this._saveHabitData();
      this._hydrateVizSettings();
      this._renderVizBoard();
      this._refreshNext();
      this._startDeadlineTimer();
    },

    _selectHabitForDesc(val) {
      const editor = document.getElementById('hub-viz-desc-editor');
      if (!editor) return;
      if (_selectedHabitForDesc !== null && _vizHabitData[_selectedHabitForDesc]) {
        _vizHabitData[_selectedHabitForDesc].description = editor.innerHTML;
      }
      const idx = val === '' ? NaN : parseInt(val, 10);
      if (isNaN(idx) || !_vizHabitData[idx]) { _selectedHabitForDesc = null; editor.innerHTML = ''; return; }
      _selectedHabitForDesc = idx;
      editor.innerHTML = _vizHabitData[idx].description || '';
    },

    _saveHabitData() {
      const editor = document.getElementById('hub-viz-desc-editor');
      if (editor && _selectedHabitForDesc !== null && _vizHabitData[_selectedHabitForDesc]) {
        _vizHabitData[_selectedHabitForDesc].description = editor.innerHTML;
      }
      try { localStorage.setItem(HABIT_DATA_KEY, JSON.stringify(_vizHabitData)); } catch (_) {}
    },

    _openVizSettings() {
      const overlay = document.getElementById('hub-viz-settings-overlay');
      const toggle  = document.getElementById('hub-viz-mode-toggle');
      const desc    = document.getElementById('hub-viz-mode-desc');
      if (!overlay) return;
      if (toggle) toggle.checked = (_vizMode === 'priority');
      if (desc) desc.textContent = _vizMode === 'showAll'
        ? 'Show All (each habit visible)'
        : 'Priority (One) following one habit at a time';
      overlay.classList.add('active');
      this._hydrateVizSettings();
    },

    _toggleVizMode() {
      _vizMode = (_vizMode === 'showAll') ? 'priority' : 'showAll';
      try { localStorage.setItem(HABIT_MODE_KEY, _vizMode); } catch (_) {}
      const desc = document.getElementById('hub-viz-mode-desc');
      if (desc) desc.textContent = _vizMode === 'showAll'
        ? 'Show All (each habit visible)'
        : 'Priority (One) following one habit at a time';
      this._renderVizBoard();
    },

    _cycleHabit(direction) {
      const len = _vizHabitData.length;
      if (len < 2) return;
      const textEl = document.getElementById('hub-viz-priority-text');
      const swap = () => {
        _activeHabitIndex = (_activeHabitIndex + (direction || 1) + len) % len;
        this._renderVizBoard();
        const el = document.getElementById('hub-viz-priority-text');
        if (el) {
          el.classList.add('hub-viz-anim-in');
          const clear = () => el.classList.remove('hub-viz-anim-in');
          el.addEventListener('animationend', clear, { once: true });
          setTimeout(clear, 600);
        }
      };
      if (!textEl) { swap(); return; }
      let finished = false;
      const next = () => { if (finished) return; finished = true; swap(); };
      textEl.classList.add('hub-viz-anim-out');
      textEl.addEventListener('animationend', next, { once: true });
      setTimeout(next, 400); // dự phòng khi theme tắt animation
    },

    /* ──────────────────────────────────────────────
       _updateClock() — Lời chào + giờ + ngày
       ────────────────────────────────────────────── */
    _updateClock() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setText('dash-clock', hh + ':' + mm);

      const lang = sysLang();
      setText('dash-date', now.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }));

      const h = now.getHours();
      let key = 'greetEvening', i18nKey = 'greetingEvening';
      if (h < 12)      { key = 'greetMorning';   i18nKey = 'greetingMorning'; }
      else if (h < 17) { key = 'greetAfternoon'; i18nKey = 'greetingAfternoon'; }

      let greeting = t(key);
      if (typeof flashcardModule !== 'undefined') {
        try {
          const d = flashcardModule._getI18N ? flashcardModule._getI18N() : null;
          if (d && d.dash && d.dash[i18nKey]) greeting = d.dash[i18nKey][lang] || d.dash[i18nKey].en || greeting;
        } catch (_) {}
      }
      setText('dash-greeting', greeting);
    },

    /* ──────────────────────────────────────────────
       Widgets
       ────────────────────────────────────────────── */
    _updateWidgets() {
      this._updatePomodoroWidget();
      this._updateFlashcardWidget();
      this._updateQuizWidget();
      this._updateCashFlowWidget();
      this._refreshNext();
    },

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
      const totalMin = Math.floor((stats.totalFocusSeconds || 0) / 60);
      const hours = Math.floor(totalMin / 60);
      const mins  = totalMin % 60;
      setText('w-focus-time', hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm');
      setText('w-streak', calcStreak(stats.dailyHistory || {}));
    },

    _updateFlashcardWidget() {
      const decks = safeParse(FLASHCARD_KEY);
      let total = 0, due = 0;
      const now = Date.now();
      if (Array.isArray(decks)) {
        decks.forEach(deck => {
          const cards = deck && deck.cards;
          if (!Array.isArray(cards)) return;
          total += cards.length;
          cards.forEach(c => {
            if (c && typeof c.nextReviewDate === 'number' && isFinite(c.nextReviewDate) && c.nextReviewDate <= now) due++;
          });
        });
      }
      _dueCards = due;

      setText('w-total-cards', total);
      setText('w-due-cards', due);
      const dueEl = document.getElementById('w-due-cards');
      if (dueEl) dueEl.classList.toggle('is-due', due > 0);

      const btn = document.getElementById('w-cards-btn');
      if (btn) btn.textContent = total === 0 ? t('cardsBtnNone') : (due > 0 ? t('cardsBtnDue') : t('cardsBtnIdle'));

      if (total === 0) {
        show('w-flashcard-empty');
        hide('w-cards-meter');
        return;
      }
      hide('w-flashcard-empty');
      show('w-cards-meter');
      const pct = Math.round(due / total * 100);
      const fill = document.getElementById('w-cards-fill');
      if (fill) fill.style.width = pct + '%';
      const bar = document.getElementById('w-cards-bar');
      if (bar) bar.setAttribute('aria-label', t('dueShare', due, total));
      setText('w-cards-note', t('dueShare', due, total));
    },

    _updateQuizWidget() {
      const decks = safeParse(QUIZ_DECKS_KEY);
      const list  = Array.isArray(decks) ? decks : [];
      let questions = 0;
      list.forEach(deck => {
        const sections = deck && deck.sections;
        if (!Array.isArray(sections)) return;
        sections.forEach(s => { if (s && Array.isArray(s.questions)) questions += s.questions.length; });
      });
      setText('w-quiz-decks', list.length);
      setText('w-quiz-questions', questions);
      const btn = document.getElementById('w-quiz-btn');
      if (btn) btn.textContent = list.length === 0 ? t('quizBtnNone') : t('quizBtn');
      if (list.length === 0) show('w-quiz-empty'); else hide('w-quiz-empty');
    },

    _updateCashFlowWidget() {
      try {
        const meta = safeParse(CF_META_KEY, {}) || {};
        const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
        const fmt = v => new Intl.NumberFormat('vi-VN').format(v) + ' đ';

        const netWorth = num(meta.netWorthOffset);
        const cash = num(meta.initCash), bank = num(meta.initBank), savings = num(meta.savingsBalance);

        setText('w-cf-networth', fmt(netWorth));
        setText('w-cf-cash', fmt(cash));
        setText('w-cf-bank', fmt(bank));
        setText('w-cf-savings', fmt(savings));

        const parts = { cash: Math.max(cash, 0), save: Math.max(savings, 0), bank: Math.max(bank, 0) };
        const sum = parts.cash + parts.bank + parts.save;
        const mix = document.getElementById('w-cf-mix');
        if (mix) {
          if (sum > 0) {
            Object.keys(parts).forEach(k => {
              const seg = mix.querySelector('.dsh-mix-seg--' + k);
              if (!seg) return;
              seg.style.flexGrow = String(parts[k] / sum * 100);
              seg.style.display = parts[k] > 0 ? '' : 'none';
            });
            mix.style.display = '';
          } else {
            mix.style.display = 'none';
          }
        }
        if (netWorth === 0 && sum === 0) show('w-cf-empty'); else hide('w-cf-empty');
      } catch (e) {
        console.warn('Error parsing cashflow meta for dashboard', e);
      }
    }
  };

  // ── Helpers ──

  function loadHabitState() {
    const data = safeParse(HABIT_DATA_KEY, []);
    _vizHabitData = Array.isArray(data)
      ? data.filter(h => h && typeof h.title === 'string').slice(0, MAX_HABITS).map(h => ({
          title: h.title, description: h.description || '', deadline: h.deadline || '',
          reward: h.reward || '', completed: h.completed === true
        }))
      : [];
    const st = safeParse(HABIT_STYLE_KEY, null);
    if (st && typeof st === 'object') {
      _vizStyleConfig = Object.assign({ fontFamily: 'inherit', outlineColor: '', shadowColor: '', glowColor: '', reflection: false }, st);
    }
    try {
      const m = localStorage.getItem(HABIT_MODE_KEY);
      if (m === 'showAll' || m === 'priority') _vizMode = m;
    } catch (_) {}
    _selectedHabitForDesc = null;
    _activeHabitIndex = 0;
  }

  function buildTitleStyle() {
    const color = v => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) && v !== '#000000') ? v : '';
    const font  = (_vizStyleConfig.fontFamily && _vizStyleConfig.fontFamily !== 'inherit' && /^[\w\s,'"()-]+$/.test(_vizStyleConfig.fontFamily))
      ? _vizStyleConfig.fontFamily : '';
    let s = '';
    if (font) s += 'font-family:' + font + ';';
    const outline = color(_vizStyleConfig.outlineColor);
    const shadow  = color(_vizStyleConfig.shadowColor);
    const glow    = color(_vizStyleConfig.glowColor);
    if (outline) s += '-webkit-text-stroke:1px ' + outline + ';';
    if (shadow)  s += 'text-shadow:2px 2px 4px ' + shadow + ';';
    if (glow)    s += 'text-shadow:0 0 10px ' + glow + ',0 0 20px ' + glow + ',0 0 40px ' + glow + ';';
    return s;
  }

  function checkHtml(idx, isDone, title) {
    return '<button type="button" class="dsh-check' + (isDone ? ' is-on' : '') + '" data-habit-idx="' + idx + '" role="checkbox" aria-checked="' + isDone + '" aria-label="' + escAttr(title) + '">' + ICON.check + '</button>';
  }

  function rewardHtml(h) {
    return (h.reward && h.reward.trim())
      ? '<span class="dsh-hb-reward" title="' + escAttr(h.reward) + '">' + ICON.gift + '<span>' + esc(h.reward) + '</span></span>'
      : '';
  }

  function deadlineHtml(h, idx, isDone) {
    if (!h.deadline) return '';
    const diff = deadlineDiff(h.deadline);
    if (diff === null) return '';
    const cls = 'dsh-hb-dl' + (isDone ? ' is-done' : (diff > 0 && diff < 3600000 ? ' is-urgent' : ''));
    return '<span class="' + cls + '" data-deadline="' + escAttr(h.deadline) + '" data-idx="' + idx + '">' + esc(module._formatCountdown(h.deadline, isDone)) + '</span>';
  }

  /** ms còn lại tới deadline, hoặc null nếu không hợp lệ */
  function deadlineDiff(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.getTime() - Date.now();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeParse(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
  function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

  /** Streak hiện tại từ dailyHistory */
  function calcStreak(dailyHistory) {
    const dates = Object.keys(dailyHistory)
      .filter(d => (dailyHistory[d] || 0) > 0)
      .sort((a, b) => b.localeCompare(a));
    if (dates.length === 0) return 0;

    const todayKey     = dateKey(new Date());
    const yesterdayKey = dateKey(new Date(Date.now() - 86400000));
    if (dates[0] !== todayKey && dates[0] !== yesterdayKey) return 0;

    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      if (Math.round((prev - curr) / 86400000) === 1) streak++;
      else break;
    }
    return streak;
  }

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  return module;
})();

// ── Register with the app router ──
if (typeof app !== 'undefined' && app.register) {
  app.register(dashboardModule);
}
