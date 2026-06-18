/* ============================================================
   HUB.OS — modules/quiz.js
   Multiple-Choice Quiz tool with Multi-Deck Management.

   Three UI States:
     1. LIBRARY — browse saved decks, create new, play, delete
     2. EDITOR  — paste raw text + title, parse & save as deck
     3. PLAY    — interactive multiple-choice quiz

   Decks are persisted in localStorage under key "quiz_decks".
   The parser (parseQuizText) is exported as a public function.

   Module contract:
     - id: 'quiz'
     - render(container) → injects the quiz UI
     - destroy()        → cleans up state
   ============================================================ */

const quizModule = (function () {
  'use strict';

  // --- Constants ---
  const DECKS_KEY   = 'quiz_decks';      // Persisted deck library
  const SCORE_KEY   = 'hub_quiz_scores'; // Total quiz sessions (dashboard stat)

  // --- Private state ---
  let _container    = null;
  let _mode         = 'library';   // 'library' | 'editor' | 'play'
  let _quizData     = null;        // Parsed quiz for current play session: { sections: [...] }
  let _currentDeck  = null;        // The deck object being played (has id, title, sections)
  let _answeredMap  = {};          // key: "sectionIdx-questionIdx" → 'correct'|'incorrect'|'revealed'
  let _selectedMap  = {};          // key: "sectionIdx-questionIdx" → option letter user picked

  // --- Default sample text (shown in the editor textarea) ---
  const DEFAULT_TEXT = `'IELTS Grammar
When we went back to the bookstore, the bookseller _ the book we wanted.
A. sold
*B. had sold
C. sells
D. has sold

'Administrative Law - Organizational Hierarchies
According to standard government structures, which entity directly oversees the provincial People's Committees?
A. The National Assembly
*B. The Central Government
C. The Ministry of Justice
D. Local Councils`;

  /* ==========================================================
     RENDER / DESTROY (module contract)
     ========================================================== */

  function render(container) {
    _container = container;
    _mode = 'library';
    _quizData = null;
    _currentDeck = null;
    _answeredMap = {};
    _selectedMap = {};
    _renderApp();
  }

  function destroy() {
    _container = null;
    // No intervals to clear; DOM events are GC'd
  }

  /* ==========================================================
     MAIN RENDER DISPATCHER
     ========================================================== */

  function _renderApp() {
    if (!_container) return;

    switch (_mode) {
      case 'editor':
        _renderEditorMode();
        break;
      case 'play':
        _renderPlayMode();
        break;
      default:
        _renderLibraryMode();
    }
  }

  /* ==========================================================
     DECK MANAGEMENT (localStorage CRUD)
     ========================================================== */

  /**
   * Load all saved decks from localStorage.
   * @returns {Array<{id, title, sections, createdAt}>}
   */
  function _loadDecks() {
    try {
      const stored = localStorage.getItem(DECKS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (_) { return []; }
  }

  /**
   * Save the full decks array to localStorage.
   * @param {Array} decks
   */
  function _saveDecks(decks) {
    try {
      localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
    } catch (_) { /* Storage full or unavailable — silently ignore */ }
  }

  /**
   * Add a new deck to the library.
   * @param {string} title
   * @param {Object} parsed — output of parseQuizText(): { sections, errors }
   * @returns {Object} the newly created deck
   */
  function _addDeck(title, parsed) {
    const decks = _loadDecks();
    const deck = {
      id: String(Date.now()),
      title: title.trim(),
      sections: parsed.sections,
      createdAt: Date.now()
    };
    decks.unshift(deck); // Newest first
    _saveDecks(decks);
    return deck;
  }

  /**
   * Delete a deck by its id.
   * @param {string} id
   */
  function _deleteDeck(id) {
    const decks = _loadDecks();
    const filtered = decks.filter(d => d.id !== id);
    _saveDecks(filtered);
  }

  /**
   * Retrieve a single deck by id.
   * @param {string} id
   * @returns {Object|undefined}
   */
  function _getDeckById(id) {
    const decks = _loadDecks();
    return decks.find(d => d.id === id);
  }

  /* ==========================================================
     STATE 1 — DECK LIBRARY
     Grid of glassmorphism cards, one per saved deck.
     ========================================================== */

  function _renderLibraryMode() {
    if (!_container) return;

    const decks = _loadDecks();
    const hasDecks = decks.length > 0;

    let gridHtml = '';

    if (hasDecks) {
      gridHtml = `
        <div class="deck-grid">
          ${decks.map(deck => {
            const questionCount = deck.sections.reduce((sum, s) => sum + s.questions.length, 0);
            const sectionCount = deck.sections.length;
            return `
              <div class="deck-card glass-card" data-deck-id="${_escAttr(deck.id)}">
                <div class="deck-card-top">
                  <h3 class="deck-card-title">${_esc(deck.title)}</h3>
                  <button class="deck-delete-btn" data-action="delete" data-deck-id="${_escAttr(deck.id)}"
                          title="Delete deck" aria-label="Delete ${_escAttr(deck.title)}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 5h10M6 5V3h4v2M5 5v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5"
                            stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>
                <p class="deck-card-meta">
                  ${questionCount} question${questionCount !== 1 ? 's' : ''}
                  ${sectionCount > 1 ? ` · ${sectionCount} sections` : ''}
                </p>
                <div class="deck-card-actions">
                  <button class="deck-play-btn" data-action="play" data-deck-id="${_escAttr(deck.id)}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="4,2 14,8 4,14"/>
                    </svg>
                    Play
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    _container.innerHTML = `
      <div class="tab-content quiz-app">
        <!-- Header row -->
        <div class="quiz-header-row">
          <h2 class="section-header" style="margin-bottom:0;">Quiz Decks</h2>
          <span class="quiz-badge">${hasDecks ? decks.length + ' deck' + (decks.length !== 1 ? 's' : '') : 'Empty'}</span>
        </div>

        <!-- Create button (always visible) -->
        <button class="btn btn-primary deck-create-btn" id="btn-create-deck">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Create New Deck
        </button>

        ${hasDecks ? gridHtml : `
          <!-- Empty state -->
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <h3>No decks yet</h3>
            <p>Create your first quiz deck by pasting formatted text.</p>
            <button class="btn btn-primary" id="btn-create-first">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              Create Your First Deck
            </button>
          </div>
        `}
      </div>
    `;

    // --- Bind events ---

    // Create deck buttons (header + empty state)
    const btnCreate = _container.querySelector('#btn-create-deck');
    const btnCreateFirst = _container.querySelector('#btn-create-first');
    if (btnCreate)  btnCreate.addEventListener('click', () => { _mode = 'editor'; _renderApp(); });
    if (btnCreateFirst) btnCreateFirst.addEventListener('click', () => { _mode = 'editor'; _renderApp(); });

    // Play and Delete buttons on deck cards
    _container.querySelectorAll('[data-action="play"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deckId;
        _handlePlayDeck(id);
      });
    });

    _container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deckId;
        _handleDeleteDeck(id);
      });
    });
  }

  /* ==========================================================
     HANDLE PLAY DECK
     ========================================================== */

  function _handlePlayDeck(deckId) {
    const deck = _getDeckById(deckId);
    if (!deck) {
      console.warn('[Quiz] Deck not found:', deckId);
      _renderLibraryMode();
      return;
    }

    _currentDeck = deck;
    _quizData = { sections: deck.sections };
    _mode = 'play';
    _answeredMap = {};
    _selectedMap = {};
    _renderApp();
    _container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ==========================================================
     HANDLE DELETE DECK
     ========================================================== */

  function _handleDeleteDeck(deckId) {
    const deck = _getDeckById(deckId);
    if (!deck) return;

    if (!confirm(`Delete "${deck.title}"? This cannot be undone.`)) return;

    _deleteDeck(deckId);
    _renderLibraryMode();
  }

  /* ==========================================================
     STATE 2 — DECK EDITOR
     (Modified from the original input mode — adds title field)
     ========================================================== */

  function _renderEditorMode() {
    if (!_container) return;

    _container.innerHTML = `
      <div class="tab-content quiz-app">
        <!-- Header -->
        <div class="quiz-header-row">
          <button class="btn btn-ghost" id="btn-back-library" style="padding:6px 14px;">
            ⬅ Back
          </button>
          <h2 class="section-header" style="margin-bottom:0;">Create New Deck</h2>
          <span class="quiz-badge">Editor</span>
        </div>

        <!-- Deck Title Input -->
        <div class="form-group">
          <label for="deck-title-input">Deck Title</label>
          <input
            type="text"
            id="deck-title-input"
            class="form-group input"
            placeholder="e.g., IELTS Grammar, History 101, SAT Vocabulary..."
            autocomplete="off"
          >
        </div>

        <!-- Info card -->
        <div class="quiz-info glass-card">
          <div class="quiz-info-icon">📋</div>
          <div class="quiz-info-text">
            <p>Paste your quiz text below using the supported format:</p>
            <code>'Section Title</code> starts a section —
            <code>*B. answer</code> marks the correct option.
            Questions are separated by blank lines.
          </div>
        </div>

        <!-- Textarea -->
        <textarea
          class="quiz-textarea glass"
          id="quiz-textarea"
          placeholder="Paste your quiz text here..."
          spellcheck="false"
        >${_esc(DEFAULT_TEXT)}</textarea>

        <!-- Action buttons -->
        <div class="quiz-actions">
          <button class="btn btn-primary quiz-generate-btn" id="btn-save-deck">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 9l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Save Deck
          </button>
          <button class="btn btn-ghost" id="btn-reset-default">
            ↺ Load Sample
          </button>
          <button class="btn btn-ghost" id="btn-cancel-editor">
            Cancel
          </button>
        </div>

        <!-- Parse errors will appear here -->
        <div class="quiz-errors" id="quiz-errors" style="display:none;"></div>
      </div>
    `;

    // --- Bind events ---

    // Back to library
    const btnBack = _container.querySelector('#btn-back-library');
    if (btnBack) btnBack.addEventListener('click', () => { _mode = 'library'; _renderApp(); });

    // Cancel
    const btnCancel = _container.querySelector('#btn-cancel-editor');
    if (btnCancel) btnCancel.addEventListener('click', () => { _mode = 'library'; _renderApp(); });

    // Save Deck
    const btnSave = _container.querySelector('#btn-save-deck');
    if (btnSave) btnSave.addEventListener('click', () => _handleSaveDeck());

    // Load Sample
    const btnReset = _container.querySelector('#btn-reset-default');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        const ta = _container.querySelector('#quiz-textarea');
        if (ta) ta.value = DEFAULT_TEXT;
      });
    }

    // Keyboard shortcut: Ctrl+Enter to save
    const ta = _container.querySelector('#quiz-textarea');
    if (ta) {
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          _handleSaveDeck();
        }
      });
    }

    // Focus the title input
    setTimeout(() => {
      const titleInput = _container.querySelector('#deck-title-input');
      if (titleInput) titleInput.focus();
    }, 150);
  }

  /* ==========================================================
     HANDLE SAVE DECK — Parse text, validate, persist
     ========================================================== */

  function _handleSaveDeck() {
    if (!_container) return;

    const titleInput = _container.querySelector('#deck-title-input');
    const ta = _container.querySelector('#quiz-textarea');
    if (!titleInput || !ta) return;

    const title = titleInput.value.trim();
    const rawText = ta.value.trim();

    // --- Validation ---
    const errors = [];

    if (!title) {
      errors.push('Please enter a deck title.');
    }
    if (!rawText) {
      errors.push('Please paste or type some quiz text.');
    }

    if (errors.length > 0) {
      _showErrors(errors);
      if (!title) {
        titleInput.focus();
        titleInput.style.borderColor = 'var(--danger)';
        setTimeout(() => { titleInput.style.borderColor = ''; }, 2000);
      }
      return;
    }

    // --- Parse ---
    const result = parseQuizText(rawText);

    // Show parse warnings (non-fatal)
    if (result.errors && result.errors.length > 0) {
      _showErrors(result.errors);
    } else {
      _hideErrors();
    }

    // Validate at least one question was parsed
    let totalQuestions = 0;
    for (const section of result.sections) {
      totalQuestions += section.questions.length;
    }
    if (totalQuestions === 0) {
      _showErrors(['No valid questions found. Check your formatting and try again.']);
      return;
    }

    // --- Save to localStorage ---
    _addDeck(title, result);

    // --- Return to library ---
    _mode = 'library';
    _renderApp();
  }

  /* ==========================================================
     STATE 3 — PLAY MODE
     (Interactive quiz — same UI as before, loaded from deck)
     ========================================================== */

  function _renderPlayMode() {
    if (!_quizData || !_container || !_currentDeck) return;

    const sections = _quizData.sections;
    const deckTitle = _currentDeck.title;

    // Count stats
    let totalQuestions = 0;
    let answeredCount = 0;
    let correctCount = 0;
    for (let si = 0; si < sections.length; si++) {
      const qs = sections[si].questions;
      totalQuestions += qs.length;
      for (let qi = 0; qi < qs.length; qi++) {
        const key = `${si}-${qi}`;
        if (_answeredMap[key]) {
          answeredCount++;
          if (_answeredMap[key] === 'correct') correctCount++;
        }
      }
    }
    const allAnswered = answeredCount === totalQuestions;

    // Build sections HTML
    let sectionsHtml = '';

    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      let questionsHtml = '';

      for (let qi = 0; qi < section.questions.length; qi++) {
        const q = section.questions[qi];
        const key = `${si}-${qi}`;
        const selected = _selectedMap[key] || null;
        const answered = !!_answeredMap[key];

        questionsHtml += `
          <div class="quiz-question-card glass-card" id="q-card-${si}-${qi}">
            <!-- Question number + text -->
            <div class="quiz-question-header">
              <span class="quiz-question-num">Q${qi + 1}</span>
              <p class="quiz-question-text">${_escPreserveBr(q.text)}</p>
            </div>

            <!-- Options grid -->
            <div class="quiz-options" data-si="${si}" data-qi="${qi}">
              ${q.options.map(opt => {
                let optClass = 'quiz-option glass';
                if (answered) {
                  if (opt.isCorrect) {
                    optClass += ' option-correct';
                  } else if (selected === opt.letter && !opt.isCorrect) {
                    optClass += ' option-incorrect';
                  } else {
                    optClass += ' option-disabled';
                  }
                }
                return `
                  <button
                    class="${optClass}"
                    data-letter="${opt.letter}"
                    ${answered ? 'disabled' : ''}
                    aria-label="Option ${opt.letter}: ${_escAttr(opt.text)}"
                  >
                    <span class="option-letter">${opt.letter}</span>
                    <span class="option-text">${_escPreserveBr(opt.text)}</span>
                    ${answered && opt.isCorrect ? '<span class="option-icon">✓</span>' : ''}
                    ${answered && selected === opt.letter && !opt.isCorrect ? '<span class="option-icon">✗</span>' : ''}
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Feedback message after answering -->
            ${answered ? `
              <div class="quiz-feedback ${_answeredMap[key] === 'correct' ? 'feedback-correct' : 'feedback-incorrect'}">
                ${_answeredMap[key] === 'correct'
                  ? '✓ Correct!'
                  : `✗ Incorrect — the correct answer is <strong>${_getCorrectOptionLetter(q)}</strong>`
                }
              </div>
            ` : ''}
          </div>
        `;
      }

      // Section wrapper
      const sectionTitle = section.title || `Section ${si + 1}`;
      sectionsHtml += `
        <div class="quiz-section">
          <h3 class="quiz-section-title">${_esc(sectionTitle)}</h3>
          <div class="quiz-section-count">${section.questions.length} question${section.questions.length !== 1 ? 's' : ''}</div>
          ${questionsHtml}
        </div>
      `;
    }

    _container.innerHTML = `
      <div class="tab-content quiz-app">
        <!-- Top bar: back button + deck title + score -->
        <div class="quiz-topbar glass-card">
          <div class="quiz-topbar-left">
            <button class="btn btn-ghost" id="btn-back-to-decks" style="padding:6px 14px;">
              ⬅ Back to Decks
            </button>
            <div>
              <h2 class="section-header" style="margin-bottom:0;">${_esc(deckTitle)}</h2>
            </div>
            <span class="quiz-badge quiz-badge-live">Live</span>
          </div>
          <div class="quiz-topbar-right">
            <!-- Score ring -->
            <div class="quiz-score-display ${allAnswered ? 'score-complete' : ''}">
              <div class="quiz-score-ring">
                <svg width="52" height="52" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="22" fill="none"
                          stroke="rgba(255,255,255,0.06)" stroke-width="4"/>
                  <circle cx="26" cy="26" r="22" fill="none"
                          stroke="${allAnswered ? 'var(--success)' : 'var(--accent-primary)'}"
                          stroke-width="4" stroke-linecap="round"
                          stroke-dasharray="${2 * Math.PI * 22}"
                          stroke-dashoffset="${2 * Math.PI * 22 * (1 - (answeredCount / Math.max(totalQuestions, 1)))}"
                          style="transition: stroke-dashoffset 0.5s var(--ease-out-expo);"/>
                </svg>
                <span class="quiz-score-text">${correctCount}/${totalQuestions}</span>
              </div>
              <span class="quiz-score-label">${answeredCount} of ${totalQuestions} answered</span>
            </div>
          </div>
        </div>

        <!-- Questions scroll area -->
        <div class="quiz-sections-container">
          ${sectionsHtml}
        </div>

        <!-- Bottom actions -->
        <div class="quiz-bottom-actions">
          ${allAnswered ? `
            <div class="quiz-complete-banner glass-card">
              <span class="quiz-complete-icon">${correctCount === totalQuestions ? '🏆' : correctCount >= totalQuestions / 2 ? '👍' : '📚'}</span>
              <span class="quiz-complete-text">
                ${correctCount === totalQuestions
                  ? 'Perfect score! All answers correct.'
                  : `Quiz complete — ${correctCount} out of ${totalQuestions} correct (${Math.round(correctCount / totalQuestions * 100)}%).`}
              </span>
            </div>
          ` : ''}
          <button class="btn btn-primary" id="btn-reset-quiz">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 8a6 6 0 0 1 10.47-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M14 8a6 6 0 0 1-10.47 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <polyline points="12,2 12,6 8,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Retry Quiz
          </button>
          ${!allAnswered ? `
            <button class="btn btn-ghost" id="btn-show-answers">
              Reveal All Answers
            </button>
          ` : ''}
        </div>
      </div>
    `;

    // --- Bind events ---

    // Back to decks
    const btnBack = _container.querySelector('#btn-back-to-decks');
    if (btnBack) btnBack.addEventListener('click', () => {
      _mode = 'library';
      _quizData = null;
      _currentDeck = null;
      _answeredMap = {};
      _selectedMap = {};
      _renderApp();
    });

    // Option clicks
    _container.querySelectorAll('.quiz-option:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const letter = btn.dataset.letter;
        const si = parseInt(btn.parentElement.dataset.si, 10);
        const qi = parseInt(btn.parentElement.dataset.qi, 10);
        _handleOptionClick(si, qi, letter);
      });
    });

    // Retry quiz
    const btnRetry = _container.querySelector('#btn-reset-quiz');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => {
        _answeredMap = {};
        _selectedMap = {};
        _renderPlayMode();
        _container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Reveal all answers
    const btnReveal = _container.querySelector('#btn-show-answers');
    if (btnReveal) {
      btnReveal.addEventListener('click', () => _revealAllAnswers());
    }
  }

  /* ==========================================================
     HANDLE OPTION CLICK
     ========================================================== */

  function _handleOptionClick(sectionIdx, questionIdx, letter) {
    const key = `${sectionIdx}-${questionIdx}`;
    if (_answeredMap[key]) return; // Already answered

    const question = _quizData.sections[sectionIdx].questions[questionIdx];
    const selectedOpt = question.options.find(o => o.letter === letter);
    if (!selectedOpt) return;

    // Record selection
    _selectedMap[key] = letter;
    _answeredMap[key] = selectedOpt.isCorrect ? 'correct' : 'incorrect';

    // Increment quiz session counter for dashboard stats
    _incrementQuizCount();

    // Re-render to reflect the change
    _renderPlayMode();

    // Scroll to the answered card smoothly
    setTimeout(() => {
      const card = document.getElementById(`q-card-${sectionIdx}-${questionIdx}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  /* ==========================================================
     REVEAL ALL ANSWERS (auto-answer all unanswered)
     ========================================================== */

  function _revealAllAnswers() {
    if (!_quizData) return;

    for (let si = 0; si < _quizData.sections.length; si++) {
      for (let qi = 0; qi < _quizData.sections[si].questions.length; qi++) {
        const key = `${si}-${qi}`;
        if (!_answeredMap[key]) {
          const correctOpt = _quizData.sections[si].questions[qi].options.find(o => o.isCorrect);
          _selectedMap[key] = correctOpt ? correctOpt.letter : null;
          _answeredMap[key] = 'revealed'; // Mark as revealed, not answered
        }
      }
    }
    _renderPlayMode();
  }

  /* ==========================================================
     HELPER: Get correct option letter for a question
     ========================================================== */

  function _getCorrectOptionLetter(question) {
    const correct = question.options.find(o => o.isCorrect);
    return correct ? correct.letter : '?';
  }

  /* ==========================================================
     SCORE TRACKING (writes to localStorage for dashboard)
     ========================================================== */

  function _incrementQuizCount() {
    try {
      const count = parseInt(localStorage.getItem(SCORE_KEY) || '0', 10);
      localStorage.setItem(SCORE_KEY, count + 1);
    } catch (_) { /* ignore */ }
  }

  /* ==========================================================
     ERROR / STATUS DISPLAY
     ========================================================== */

  function _showErrors(errors) {
    const el = document.getElementById('quiz-errors');
    if (!el) return;

    el.style.display = 'block';
    el.innerHTML = `
      <div class="quiz-error-toast glass-card">
        <span class="quiz-error-icon">⚠️</span>
        <div class="quiz-error-list">
          ${errors.map(e => `<p>${_esc(e)}</p>`).join('')}
        </div>
      </div>
    `;

    // Auto-hide after 8 seconds
    setTimeout(() => _hideErrors(), 8000);
  }

  function _hideErrors() {
    const el = document.getElementById('quiz-errors');
    if (el) el.style.display = 'none';
  }

  /* ==========================================================
     UTILITY: HTML escaping
     ========================================================== */

  function _esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /**
   * Escape HTML but preserve <br /> and <br> tags so they render
   * as actual line breaks in innerHTML contexts.
   */
  function _escPreserveBr(str) {
    if (str == null) return '';
    let escaped = _esc(str);
    escaped = escaped.replace(/&lt;br\s*\/?&gt;/gi, '<br />');
    return escaped;
  }

  /** Escape for HTML attributes (shorter, no quotes) */
  function _escAttr(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --- Public API (module contract) ---
  return {
    id: 'quiz',
    name: 'Quiz',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
      <path d="M7 9l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    render,
    destroy
  };

})();

/* ==========================================================
   EXPORTED: parseQuizText(rawText)
   Public parser function — can be reused or tested externally.
   Parses the custom quiz text format into a structured object.

   Format rules:
     - 'Title at line start → new section
     - Blank lines separate question blocks
     - *B. text → correct answer marker
     - <br /> tags preserved in question/option text

   Returns: { sections: [...], errors: [...] }
   Each section: { title: string, questions: [...] }
   Each question: { text: string, options: [{ letter, text, isCorrect }] }
   ========================================================== */

function parseQuizText(rawText) {
  const errors = [];
  const sections = [];

  // Normalize line endings
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // --- Step 1: Split into raw sections by ' leader ---
  const rawSections = [];
  let currentSectionStart = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect section header: line starts with ' (single quote)
    if (line.length > 0 && line[0] === "'" && line.trim().length > 1) {
      // Close previous section
      if (currentSectionStart !== null) {
        rawSections.push({
          title: lines[currentSectionStart].slice(1).trim(),
          startLine: currentSectionStart + 1,
          endLine: i - 1
        });
      }
      currentSectionStart = i;
    }
  }

  // Don't miss the last section
  if (currentSectionStart !== null) {
    rawSections.push({
      title: lines[currentSectionStart].slice(1).trim(),
      startLine: currentSectionStart + 1,
      endLine: lines.length - 1
    });
  }

  // If no explicit sections found, treat entire text as one unnamed section
  if (rawSections.length === 0 && rawText.trim().length > 0) {
    rawSections.push({
      title: 'Quiz',
      startLine: 0,
      endLine: lines.length - 1
    });
  }

  // --- Step 2: For each section, extract question blocks ---
  for (const rawSec of rawSections) {
    const section = {
      title: rawSec.title || 'Untitled Section',
      questions: []
    };

    // Collect lines for this section
    const secLines = [];
    for (let i = rawSec.startLine; i <= rawSec.endLine && i < lines.length; i++) {
      secLines.push(lines[i]);
    }

    // Split into question blocks by blank lines
    const blocks = _splitIntoBlocks(secLines);

    for (const block of blocks) {
      if (block.length === 0) continue;

      const question = _parseQuestionBlock(block, section.title);
      if (question) {
        section.questions.push(question);
      } else {
        const preview = block[0] ? block[0].substring(0, 40) : '(empty)';
        errors.push(
          `Skipped invalid question block in "${section.title}": "${preview}..." — no correct answer (*) found.`
        );
        console.warn('[Quiz Parser] Skipped invalid block:', block);
      }
    }

    if (section.questions.length > 0) {
      sections.push(section);
    }
  }

  return { sections, errors };
}

/* ----------------------------------------------------------
   PARSER HELPERS
   ---------------------------------------------------------- */

/**
 * Split an array of lines into blocks separated by blank lines.
 * Consecutive blank lines are treated as a single separator.
 */
function _splitIntoBlocks(lines) {
  const blocks = [];
  let currentBlock = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip leading blank lines
    if (currentBlock.length === 0 && line.trim() === '') {
      continue;
    }

    if (line.trim() === '') {
      // Blank line — end current block (if not empty)
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [];
    } else {
      currentBlock.push(line);
    }
  }

  // Don't miss the last block
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Parse a single question block (array of lines) into a question object.
 * Returns null if the block doesn't have a valid correct answer.
 */
function _parseQuestionBlock(lines, sectionTitle) {
  const questionLines = [];
  const options = [];
  let hasCorrectAnswer = false;

  // Regex: optional *, letter A-E, period, space, then option text
  const optionRe = /^(\*?)\s*([A-E])\.\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    const match = trimmed.match(optionRe);
    if (match) {
      const isCorrect = match[1] === '*';
      const letter = match[2];
      const text = match[3].trim();

      if (isCorrect) hasCorrectAnswer = true;

      options.push({ letter, text, isCorrect });
    } else {
      // Not an option line → part of the question text
      questionLines.push(trimmed);
    }
  }

  // Must have at least 2 options and a correct answer
  if (options.length < 2 || !hasCorrectAnswer) {
    return null;
  }

  const questionText = questionLines.join('<br />');

  return {
    text: questionText,
    options
  };
}

// Auto-register with the app router
if (typeof app !== 'undefined') {
  app.register(quizModule);
}