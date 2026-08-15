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
  const SCORE_KEY   = 'hub_quiz_scores'; // Total quiz sessions (dashboard stat)

  // --- Private state ---
  let _container    = null;
  let _mode         = 'library';   // 'library' | 'editor' | 'play'
  let _quizData     = null;        // Parsed quiz for current play session: { sections: [...] }
  let _currentDeck  = null;        // The deck object being played (has id, title, sections)
  let _answeredMap  = {};          // key: "sectionIdx-questionIdx" → 'correct'|'incorrect'|'revealed'
  let _selectedMap  = {};          // key: "sectionIdx-questionIdx" → option letter user picked
  let _decks        = null;        // In-memory array of all decks (loaded once from HubDB)
  let _pageUnloading = false;      // Prevents ghost saves during page reload

  // --- Test Mode state ---
  let _testMode         = false;
  let _testTimeLimit    = 45 * 60;   // seconds, default 45 min
  let _testTimerId      = null;
  let _testTimeRemaining = 0;
  let _testSubmitted    = false;

  // --- AI Generator state ---
  let _aiGenerating     = false;

  // --- Shuffle state ---
  let _shuffle          = false;

  // ── Ghost save guard ──
  // The moment the browser starts unloading (page reload / tab close),
  // mark _pageUnloading so no async save callback will fire a write.
  window.addEventListener('beforeunload', function () {
    _pageUnloading = true;
  });

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

  async function render(container) {
    _container = container;

    // 1) Show loading state immediately
    container.innerHTML =
      '<div class="tab-content quiz-app" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
        '<div class="hub-notes-loading" style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem">' +
          '<span class="hub-notes-loading-dot">●</span> Loading decks...' +
        '</div>' +
      '</div>';

    // 2) Await data (async — may hit Firestore)
    await _loadDecksAsync();

    _mode = 'library';
    _quizData = null;
    _currentDeck = null;
    _answeredMap = {};
    _selectedMap = {};
    _testMode = false;
    _testTimerId = null;
    _testTimeRemaining = 0;
    _testSubmitted = false;
    _shuffle = false;
    _renderApp();
    checkUrlForSharedQuiz();
  }

  function destroy() {
    _stopTestTimer();
    _destroyHighlighter();
    if (_tooltipEl && _tooltipEl.parentNode) {
      _tooltipEl.parentNode.removeChild(_tooltipEl);
      _tooltipEl = null;
    }
    _decks = null;
    _container = null;
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
      case 'mode-select':
        _renderModeSelect();
        break;
      default:
        _renderLibraryMode();
    }
  }

  /* ==========================================================
     DECK MANAGEMENT (HubDB cloud sync with localStorage fallback)
     ========================================================== */

  /**
   * Load all saved decks from HubDB (Firestore when online,
   * localStorage fallback otherwise). Populates the in-memory
   * `_decks` array used by all CRUD operations in this session.
   */
  async function _loadDecksAsync() {
    try {
      var data = await HubDB.loadQuizData();
      if (data && Array.isArray(data.decks)) {
        _decks = data.decks;
      } else {
        _decks = [];
      }
    } catch (_) {
      _decks = [];
    }
  }

  /**
   * Save the current in-memory decks array to HubDB.
   * Fire-and-forget — callers don't need to await.
   */
  function _saveDecks() {
    if (_pageUnloading) return; // Prevent ghost saves during page reload
    HubDB.saveQuizData({ decks: _decks }).catch(function () {});
  }

  /**
   * Add a new deck to the in-memory array and persist.
   * @param {string} title
   * @param {Object} parsed — output of parseQuizText(): { sections, errors }
   * @returns {Object} the newly created deck
   */
  function _addDeck(title, parsed) {
    var deck = {
      id: String(Date.now()),
      title: title.trim(),
      sections: parsed.sections,
      createdAt: Date.now()
    };
    _decks.unshift(deck); // Newest first
    _saveDecks();
    return deck;
  }

  /**
   * Delete a deck by its id from the in-memory array and persist.
   * @param {string} id
   */
  function _deleteDeck(id) {
    _decks = _decks.filter(function (d) { return d.id !== id; });
    _saveDecks();
  }

  /**
   * Retrieve a single deck by id from the in-memory array.
   * @param {string} id
   * @returns {Object|undefined}
   */
  function _getDeckById(id) {
    return _decks.find(function (d) { return d.id === id; });
  }

  /* ==========================================================
     STATE 1 — DECK LIBRARY
     Grid of glassmorphism cards, one per saved deck.
     ========================================================== */

  function _renderLibraryMode() {
    if (!_container) return;

    var decks = _decks || [];
    var hasDecks = decks.length > 0;

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
                  <button class="hub-quiz-share-btn" data-action="share" data-deck-id="${_escAttr(deck.id)}"
                          title="Share this deck" aria-label="Share ${_escAttr(deck.title)}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" fill="currentColor"/>
                      <path d="M11 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" fill="currentColor"/>
                      <path d="M11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" fill="currentColor"/>
                      <path d="M6.5 7l3-2M6.5 9l3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    </svg>
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

        <!-- Create & AI buttons (always visible) -->
        <div class="quiz-library-actions">
          <button class="btn btn-primary deck-create-btn" id="btn-create-deck">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            Create New Deck
          </button>
          <button class="btn btn-secondary deck-ai-btn" id="btn-ai-generate">
            <span class="ai-btn-icon">✨</span> AI Generate
          </button>
        </div>

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

        <!-- Import / Join Section -->
        <div class="hub-quiz-import-section glass-card">
          <div class="hub-quiz-import-header">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style="flex-shrink:0;">
              <path d="M9 14V4M5 8l4-4 4 4" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M3 11v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" stroke="var(--accent-primary)" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <span class="hub-quiz-import-title">Import Shared Deck</span>
          </div>
          <div class="hub-quiz-import-row">
            <span class="hub-quiz-import-prefix">#</span>
            <input type="text" id="hub-quiz-import-input" class="hub-quiz-import-input"
                   placeholder="ENTER ACCESS CODE" maxlength="6" spellcheck="false" autocomplete="off">
            <button class="hub-quiz-import-btn" id="hub-quiz-import-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Import
            </button>
          </div>
          <div class="hub-quiz-import-status" id="hub-quiz-import-status"></div>
        </div>

        <!-- Share Modal (hidden by default) -->
        <div class="hub-quiz-share-overlay" id="hub-quiz-share-overlay" style="display:none;">
          <div class="hub-quiz-share-modal glass-card">
            <div class="hub-quiz-share-header">
              <h3 class="hub-quiz-share-title">Deck Shared</h3>
              <button class="hub-quiz-share-close" id="hub-quiz-share-close" aria-label="Close">&times;</button>
            </div>
            <div class="hub-quiz-share-body">
              <p class="hub-quiz-share-desc">Share this code or link with others to let them import this deck.</p>
              <div class="hub-quiz-share-code-display" id="hub-quiz-share-code-display">------</div>
              <div class="hub-quiz-share-link-row">
                <input type="text" class="hub-quiz-share-link-input" id="hub-quiz-share-link-input" readonly
                       placeholder="https://...">
                <button class="hub-quiz-share-copy-btn" id="hub-quiz-share-copy-btn">
                  Copy Link
                </button>
              </div>
              <div class="hub-quiz-share-feedback" id="hub-quiz-share-feedback"></div>
            </div>
            <div class="hub-quiz-share-footer">
              <button class="btn btn-ghost" id="hub-quiz-share-done">Done</button>
            </div>
          </div>
        </div>

        <!-- AI Generator Modal (hidden by default) -->
        <div class="ai-modal-overlay" id="ai-modal-overlay" style="display:none;">
          <div class="ai-modal glass-card">
            <div class="ai-modal-header">
              <h3><span class="ai-modal-icon">✨</span> AI Quiz Generator</h3>
              <button class="ai-modal-close" id="btn-ai-close" aria-label="Close">&times;</button>
            </div>
            <div class="ai-modal-body">
              <div class="form-group">
                <label for="ai-deck-title">Deck Title</label>
                <input type="text" id="ai-deck-title" class="form-group input" placeholder="e.g., Biology 101, SAT Math..." autocomplete="off">
              </div>
              <div class="form-group">
                <label for="ai-quiz-content">Quiz Content</label>
                <textarea id="ai-quiz-content" class="quiz-textarea glass ai-textarea" placeholder="Paste your Quiz questions and options here..." spellcheck="false"></textarea>
              </div>
              <div class="form-group">
                <label for="ai-quiz-key">Answer Key <span class="ai-label-hint">(Optional — leave blank to let AI solve it)</span></label>
                <textarea id="ai-quiz-key" class="quiz-textarea glass ai-textarea-key" placeholder="Paste Answer Key here (Optional - Leave blank to let AI solve it)" spellcheck="false"></textarea>
              </div>
            </div>
            <div class="ai-modal-footer">
              <span class="ai-footer-hint" id="ai-status-hint">Powered by Gemini</span>
              <div class="ai-modal-actions">
                <button class="btn btn-ghost" id="btn-ai-cancel">Cancel</button>
                <button class="btn btn-primary" id="btn-ai-generate-confirm">
                  <span id="ai-generate-btn-text">⚡ Generate Quiz</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // --- Bind events ---

    // Create deck buttons (header + empty state)
    const btnCreate = _container.querySelector('#btn-create-deck');
    const btnCreateFirst = _container.querySelector('#btn-create-first');
    if (btnCreate)  btnCreate.addEventListener('click', () => { _mode = 'editor'; _renderApp(); });
    if (btnCreateFirst) btnCreateFirst.addEventListener('click', () => { _mode = 'editor'; _renderApp(); });

    // Play, Share, and Delete buttons on deck cards (delegated)
    _container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      var action = btn.dataset.action;
      var id = btn.dataset.deckId;
      if (action === 'play') _handlePlayDeck(id);
      else if (action === 'share') _handleShareDeck(id);
      else if (action === 'delete') _handleDeleteDeck(id);
    });

    // --- AI Generator events ---
    const btnAI = _container.querySelector('#btn-ai-generate');
    const modalOverlay = _container.querySelector('#ai-modal-overlay');
    const btnAIClose = _container.querySelector('#btn-ai-close');
    const btnAICancel = _container.querySelector('#btn-ai-cancel');
    const btnAIGenerate = _container.querySelector('#btn-ai-generate-confirm');

    if (btnAI && modalOverlay) {
      btnAI.addEventListener('click', () => { modalOverlay.style.display = 'flex'; });
    }
    const hideModal = () => { if (modalOverlay) { modalOverlay.style.display = 'none'; _aiGenerating = false; } };
    if (btnAIClose) btnAIClose.addEventListener('click', hideModal);
    if (btnAICancel) btnAICancel.addEventListener('click', hideModal);
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) hideModal(); });
    }
    if (btnAIGenerate) {
      btnAIGenerate.addEventListener('click', () => _handleAIGenerate());
    }

    // --- Import quiz events ---
    const importBtn = _container.querySelector('#hub-quiz-import-btn');
    const importInput = _container.querySelector('#hub-quiz-import-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => _handleImportQuiz());
      importInput.addEventListener('keydown', (e) => {
        // Auto-uppercase as user types
        if (e.key >= 'a' && e.key <= 'z') {
          setTimeout(() => {
            importInput.value = importInput.value.toUpperCase();
          }, 0);
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          _handleImportQuiz();
        }
      });
    }

    // --- Share modal close events (use _container.query for reliability) ---
    var shareOverlay2 = _container.querySelector('#hub-quiz-share-overlay');
    var shareClose = _container.querySelector('#hub-quiz-share-close');
    var shareDone = _container.querySelector('#hub-quiz-share-done');
    if (shareOverlay2 && shareClose) {
      shareClose.addEventListener('click', function () {
        shareOverlay2.style.display = 'none';
      });
    }
    if (shareOverlay2 && shareDone) {
      shareDone.addEventListener('click', function () {
        shareOverlay2.style.display = 'none';
      });
    }
    if (shareOverlay2) {
      shareOverlay2.addEventListener('click', function (e) {
        if (e.target === shareOverlay2) shareOverlay2.style.display = 'none';
      });
    }

    // --- Copy link button ---
    const copyBtn = _container.querySelector('#hub-quiz-share-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const linkInput = _container.querySelector('#hub-quiz-share-link-input');
        if (!linkInput) return;
        linkInput.select();
        linkInput.setSelectionRange(0, 99999);
        try {
          document.execCommand('copy');
          const fb = _container.querySelector('#hub-quiz-share-feedback');
          if (fb) {
            fb.textContent = '✓ Link copied to clipboard!';
            fb.style.color = 'var(--success)';
            fb.style.textShadow = '0 0 8px rgba(68, 255, 136, 0.5)';
            setTimeout(() => { if (fb) fb.textContent = ''; }, 3000);
          }
        } catch (_) {}
      });
    }
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
    _mode = 'mode-select';
    _answeredMap = {};
    _selectedMap = {};
    _testMode = false;
    _testTimeRemaining = 0;
    _testSubmitted = false;
    _shuffle = false;
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
    (result.sections || []).forEach(function (section) {
      totalQuestions += section.questions.length;
    });
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
     STATE 3 — MODE SELECT
     Choose between Practice and Test mode before playing.
     ========================================================== */

  function _renderModeSelect() {
    if (!_container || !_currentDeck) return;

    const deckTitle = _currentDeck.title;
    let totalQuestions = 0;
    (_currentDeck.sections || []).forEach(s => { totalQuestions += s.questions.length; });

    _container.innerHTML = `
      <div class="tab-content quiz-app">
        <div class="quiz-header-row">
          <button class="btn btn-ghost" id="btn-back-from-select" style="padding:6px 14px;">⬅ Back</button>
          <h2 class="section-header" style="margin-bottom:0;">${_esc(deckTitle)}</h2>
          <span class="quiz-badge">${totalQuestions} Qs</span>
        </div>

        <div class="mode-select-container">
          <div class="mode-select-card glass-card" id="mode-practice">
            <div class="mode-select-icon">📝</div>
            <h3>Practice Mode</h3>
            <p>Answer questions at your own pace. Get immediate feedback after each answer. No time limit.</p>
            <button class="btn btn-primary" data-mode="practice">Start Practice</button>
          </div>

          <div class="mode-select-card glass-card" id="mode-test">
            <div class="mode-select-icon">⏱️</div>
            <h3>Test Mode</h3>
            <p>Simulate a real exam. Timer counts down — submit before time runs out. No feedback until you finish.</p>
            <div class="mode-test-time">
              <label for="test-time-input">Time limit (minutes):</label>
              <input type="number" id="test-time-input" class="form-group input" value="45" min="1" max="180" step="1">
            </div>
            <button class="btn btn-accent" data-mode="test">Start Test</button>
          </div>
        </div>

        <!-- Shuffle Toggle -->
        <div class="mode-shuffle-row glass-card">
          <div class="mode-shuffle-info">
            <span class="mode-shuffle-icon">🔀</span>
            <div>
              <span class="mode-shuffle-label">Shuffle Questions</span>
              <span class="mode-shuffle-hint">Randomize question &amp; option order</span>
            </div>
          </div>
          <label class="toggle-switch" title="Toggle shuffle">
            <input type="checkbox" id="shuffle-toggle" ${_shuffle ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;

    // Back button
    const btnBack = _container.querySelector('#btn-back-from-select');
    if (btnBack) btnBack.addEventListener('click', () => { _mode = 'library'; _currentDeck = null; _renderApp(); });

    // Mode buttons
    _container.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        const shuffleCheckbox = _container.querySelector('#shuffle-toggle');
        _shuffle = shuffleCheckbox ? shuffleCheckbox.checked : false;

        if (_shuffle) {
          _shuffleQuizData();
        }

        if (mode === 'practice') {
          _testMode = false;
          _startPlaySession();
        } else {
          const timeInput = _container.querySelector('#test-time-input');
          const minutes = timeInput ? Math.max(1, Math.min(180, parseInt(timeInput.value, 10) || 45)) : 45;
          _testMode = true;
          _testTimeLimit = minutes * 60;
          _testTimeRemaining = _testTimeLimit;
          _testSubmitted = false;
          _startPlaySession();
        }
      });
    });
  }

  /* ==========================================================
     SHUFFLE (Fisher-Yates)
     ========================================================== */

  function _shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function _shuffleQuizData() {
    if (!_quizData) return;

    _quizData = {
      sections: _quizData.sections.map(section => ({
        title: section.title,
        questions: _shuffleArray(section.questions).map(q => ({
          text: q.text,
          options: _shuffleArray(q.options)
        }))
      }))
    };
  }

  function _startPlaySession() {
    _mode = 'play';
    _renderApp();
    _container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ==========================================================
     TEST TIMER LOGIC
     ========================================================== */

  function _startTestTimer() {
    if (_testTimerId) return;
    _testTimerId = setInterval(() => {
      _testTimeRemaining--;
      _updateTimerDisplay();

      if (_testTimeRemaining <= 0) {
        _stopTestTimer();
        _testSubmitted = true;
        // Disable all option buttons
        _container.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
        alert("⏰ Time's Up! Click OK to see your results.");
        _submitTest();
      }
    }, 1000);
  }

  function _stopTestTimer() {
    if (_testTimerId) {
      clearInterval(_testTimerId);
      _testTimerId = null;
    }
  }

  function _formatTime(seconds) {
    const m = Math.floor(Math.max(0, seconds) / 60);
    const s = Math.max(0, seconds) % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function _updateTimerDisplay() {
    const el = document.getElementById('test-timer-display');
    if (!el) return;

    el.textContent = _formatTime(_testTimeRemaining);

    const urgent = _testTimeRemaining < 60;
    const warning = _testTimeRemaining < 300 && !urgent;

    el.classList.toggle('timer-urgent', urgent);
    el.classList.toggle('timer-warning', warning);
  }

  function _submitTest() {
    _stopTestTimer();

    // Re-render in completed state showing all answers + score
    // First, calculate score
    let total = 0, correct = 0;
    if (_quizData) {
      _quizData.sections.forEach(function (section, si) {
        const qs = section.questions;
        total += qs.length;
        qs.forEach(function (q, qi) {
          if (_answeredMap[si + '-' + qi] === 'correct') correct++;
        });
      });
    }

    // Reveal all unanswered questions
    _revealAllAnswers();
    _renderPlayMode();

    // Scroll to results
    setTimeout(() => {
      const banner = _container.querySelector('.quiz-complete-banner');
      if (banner) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }

  /* ==========================================================
     STATE 4 — PLAY MODE
     (Interactive quiz — with optional test mode timer)
     ========================================================== */

  function _renderPlayMode() {
    if (!_quizData || !_container || !_currentDeck) return;

    const sections = _quizData.sections;
    const deckTitle = _currentDeck.title;

    // Count stats
    let totalQuestions = 0;
    let answeredCount = 0;
    let correctCount = 0;
    sections.forEach(function (section, si) {
      const qs = section.questions;
      totalQuestions += qs.length;
      qs.forEach(function (q, qi) {
        const key = `${si}-${qi}`;
        if (_answeredMap[key]) {
          answeredCount++;
          if (_answeredMap[key] === 'correct') correctCount++;
        }
      });
    });
    const allAnswered = answeredCount === totalQuestions;

    // Build sections HTML
    const sectionsHtml = sections.map(function (section, si) {
      const questionsHtml = section.questions.map(function (q, qi) {
        const key = `${si}-${qi}`;
        const selected = _selectedMap[key] || null;
        const answered = !!_answeredMap[key];

        return `
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
      }).join('');

      // Section wrapper
      const sectionTitle = section.title || `Section ${si + 1}`;
      return `
        <div class="quiz-section">
          <h3 class="quiz-section-title">${_esc(sectionTitle)}</h3>
          <div class="quiz-section-count">${section.questions.length} question${section.questions.length !== 1 ? 's' : ''}</div>
          ${questionsHtml}
        </div>
      `;
    }).join('');

    _container.innerHTML = `
      <div class="tab-content quiz-app">
        ${_testMode && !_testSubmitted ? `
          <!-- Test Mode Sticky Timer -->
          <div class="test-timer-bar glass-card" id="test-timer-bar">
            <span class="test-timer-label">⏱️ Time Remaining</span>
            <span class="test-timer-display" id="test-timer-display">${_formatTime(_testTimeRemaining)}</span>
          </div>
        ` : ''}

        ${_testSubmitted ? `
          <div class="test-submitted-banner glass-card">
            <span>🏁 Test Submitted</span>
          </div>
        ` : ''}

        <!-- Top bar: back button + deck title + score -->
        <div class="quiz-topbar glass-card">
          <div class="quiz-topbar-left">
            <button class="btn btn-ghost" id="btn-back-to-decks" style="padding:6px 14px;">
              ⬅ Back to Decks
            </button>
            <div>
              <h2 class="section-header" style="margin-bottom:0;">${_esc(deckTitle)}</h2>
            </div>
            <span class="quiz-badge quiz-badge-live">${_testSubmitted ? 'Submitted' : (_testMode ? 'Test' : 'Live')}</span>
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
          ${_testMode && !_testSubmitted && !allAnswered ? `
            <button class="btn btn-accent test-submit-btn" id="btn-submit-test">
              🏁 Submit Test
            </button>
          ` : ''}
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
      _stopTestTimer();
      _destroyHighlighter();
      _mode = 'library';
      _quizData = null;
      _currentDeck = null;
      _answeredMap = {};
      _selectedMap = {};
      _testMode = false;
      _testSubmitted = false;
      _renderApp();
    });

    // Option clicks — skip if user was highlighting text
    _container.querySelectorAll('.quiz-option:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (window.getSelection().toString().trim().length > 0) return;
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

    // Test mode: submit button
    const btnSubmit = _container.querySelector('#btn-submit-test');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => {
        if (confirm('Submit your test? You will not be able to change answers.')) {
          _testSubmitted = true;
          _submitTest();
        }
      });
    }

    // Test mode: start timer
    if (_testMode && !_testSubmitted) {
      _startTestTimer();
    }

    // Smart text highlighter
    _initHighlighter();
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
     SHARE & IMPORT HANDLERS
     ========================================================== */

  async function _handleShareDeck(deckId) {
    const deck = _getDeckById(deckId);
    if (!deck) {
      console.warn('[Quiz] _handleShareDeck — deck not found:', deckId);
      return;
    }

    // Build a clean deck object to share (no local id/createdAt)
    const shareData = {
      title: deck.title,
      sections: deck.sections,
      sharedAt: Date.now()
    };

    // Lock share buttons to prevent double-clicks while generating
    var shareBtns = _container ? Array.from(_container.querySelectorAll('[data-action="share"]')) : [];
    shareBtns.forEach(function (btn) { btn.disabled = true; });

    // Find modal elements
    var overlay = document.getElementById('hub-quiz-share-overlay');
    var codeDisplay = document.getElementById('hub-quiz-share-code-display');
    var linkInput = document.getElementById('hub-quiz-share-link-input');
    var feedbackEl = document.getElementById('hub-quiz-share-feedback');

    if (!overlay) {
      console.warn('[Quiz] Share overlay element (#hub-quiz-share-overlay) not found in DOM');
      _showToast('Share modal unavailable — please reload the page.');
      shareBtns.forEach(function (btn) { btn.disabled = false; });
      return;
    }

    // Show loading state
    if (codeDisplay) codeDisplay.textContent = 'GENERATING...';
    if (feedbackEl) feedbackEl.textContent = '';

    try {
      var shareCode = await HubDB.shareQuizDeck(shareData);

      // Populate the modal fields
      if (codeDisplay) codeDisplay.textContent = shareCode;
      var shareUrl = window.location.origin + window.location.pathname.replace(/\/+$/, '') + '/?quiz=' + shareCode;
      if (linkInput) {
        linkInput.value = shareUrl;
      }

      // Open the modal
      overlay.style.display = 'flex';

      // Select link text after the DOM has painted
      if (linkInput) {
        setTimeout(function () { linkInput.select(); }, 350);
      }
    } catch (err) {
      console.warn('[Quiz] Share failed:', err);
      if (codeDisplay) codeDisplay.textContent = 'ERROR';
      // Show error in the visible import-status field
      var importStatus = document.getElementById('hub-quiz-import-status');
      if (importStatus) {
        importStatus.textContent = err.message || 'Failed to share deck. Check your connection.';
        importStatus.className = 'hub-quiz-import-status hub-quiz-import-status--error';
        setTimeout(function () {
          if (importStatus) importStatus.textContent = '';
        }, 6000);
      }
      if (feedbackEl) {
        feedbackEl.textContent = err.message || 'Failed to share deck. Check your connection.';
        feedbackEl.style.color = 'var(--danger)';
      }
      _showToast('Share failed: ' + (err.message || 'Check connection'));
    } finally {
      // Re-enable share buttons
      shareBtns.forEach(function (btn) { btn.disabled = false; });
    }
  }

  async function _handleImportQuiz() {
    const input = document.getElementById('hub-quiz-import-input');
    const statusEl = document.getElementById('hub-quiz-import-status');
    if (!input || !statusEl) return;

    var code = input.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
      statusEl.textContent = 'Enter a valid 6-character code';
      statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--error';
      return;
    }

    statusEl.textContent = 'Importing...';
    statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--loading';

    try {
      var deckData = await HubDB.importSharedQuiz(code);
      if (!deckData) {
        statusEl.textContent = 'Code not found. Check the code and try again.';
        statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--error';
        return;
      }

      // Duplicate check: prevent importing the same deck twice
      var deckTitle = (deckData.title || 'Imported Deck').trim();
      var duplicate = _decks.some(function (d) {
        return d.title.toLowerCase() === deckTitle.toLowerCase();
      });
      if (duplicate) {
        statusEl.textContent = 'Deck "' + deckTitle + '" already exists in your library.';
        statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--error';
        return;
      }

      // Add imported deck to local library
      var newDeck = {
        id: String(Date.now()),
        title: deckTitle,
        sections: deckData.sections || [],
        createdAt: Date.now(),
        imported: true
      };
      _decks.unshift(newDeck);
      _saveDecks();

      statusEl.textContent = '✓ Deck imported successfully!';
      statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--success';

      // Clear input and re-render library
      input.value = '';
      setTimeout(function () {
        _renderLibraryMode();
        _showToast('Deck "' + deckTitle + '" imported!');
      }, 800);
    } catch (err) {
      console.error('[Quiz] Import failed:', err.message || err);
      statusEl.textContent = err.message || 'Network error. Please try again.';
      statusEl.className = 'hub-quiz-import-status hub-quiz-import-status--error';
    }
  }

  /* ==========================================================
     TOAST NOTIFICATION
     ========================================================== */

  function _showToast(message) {
    var existing = document.querySelector('.hub-quiz-toast');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var toast = document.createElement('div');
    toast.className = 'hub-quiz-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add('hub-quiz-toast--visible');
    });

    setTimeout(function () {
      toast.classList.remove('hub-quiz-toast--visible');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 3500);
  }

  /* ==========================================================
     URL AUTO-IMPORT
     Check for ?quiz=XXXXXX on page load.
     Retries up to 20 times (10 seconds) until HubDB is ready
     and Firebase auth is resolved.
     ========================================================== */

  function checkUrlForSharedQuiz() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('quiz');
    if (!code || code.trim().length !== 6) return;

    var cleanCode = code.trim().toUpperCase();
    var attempts = 0;
    var maxAttempts = 20;

    function _tryImport() {
      attempts++;
      // Guard: only proceed if we're on the quiz tab
      if (!_container) {
        if (attempts < maxAttempts) {
          setTimeout(_tryImport, 500);
        }
        return;
      }

      var auth = HubDB.getAuthStatus();

      // Not ready yet — retry until HubDB is initialised or auth settles
      if (!auth && attempts < maxAttempts) {
        setTimeout(_tryImport, 500);
        return;
      }

      // Timeout: give up after maxAttempts
      var proceed = function () {
        _performUrlImport(cleanCode);
      };

      if (attempts >= maxAttempts) {
        proceed();
        return;
      }

      // HubDB ready — proceed
      proceed();
    }

    setTimeout(_tryImport, 300);
  }

  async function _performUrlImport(cleanCode) {
    try {
      var deckData = await HubDB.importSharedQuiz(cleanCode);

      // Duplicate check before adding
      var duplicate = _decks.some(function (d) {
        return d.title.toLowerCase() === (deckData.title || 'Imported Deck').trim().toLowerCase();
      });
      if (duplicate) {
        _showToast('Deck "' + (deckData.title || 'Imported Deck').trim() + '" already exists in your library.');
        history.replaceState(null, '', window.location.pathname);
        return;
      }

      var newDeck = {
        id: String(Date.now()),
        title: (deckData.title || 'Imported Deck').trim(),
        sections: deckData.sections || [],
        createdAt: Date.now(),
        imported: true
      };
      _decks.unshift(newDeck);
      _saveDecks();

      history.replaceState(null, '', window.location.pathname);

      if (_container) {
        _renderLibraryMode();
        _showToast('Deck "' + newDeck.title + '" imported from shared link!');
      }
    } catch (err) {
      console.error('[Quiz] URL import failed:', err.message || err);
      history.replaceState(null, '', window.location.pathname);
      _showToast(err.message || 'Failed to import shared quiz.');
    }
  }

  /* ==========================================================
     HELPER: Get correct option letter for a question
     ========================================================== */

  function _getCorrectOptionLetter(question) {
    const correct = question.options.find(o => o.isCorrect);
    return correct ? correct.letter : '?';
  }

  /* ==========================================================
     SMART TEXT HIGHLIGHTER — Multi-Color Cyberpunk Palette
     ========================================================== */

  const HL_COLORS = [
    { name: 'cyan',    hex: '#00f0ff' },
    { name: 'purple',  hex: '#b829ea' },
    { name: 'yellow',  hex: '#fde047' },
    { name: 'green',   hex: '#00ff66' },
    { name: 'pink',    hex: '#ff2a6d' }
  ];

  let _tooltipEl = null;

  function _initHighlighter() {
    _destroyHighlighter();

    const container = _container && _container.querySelector('.quiz-sections-container');
    if (!container) return;

    container.addEventListener('mouseup', _onHighlighterMouseUp);
    container.addEventListener('click', _onHighlighterClick);
  }

  function _destroyHighlighter() {
    _hideTooltip();
    const container = _container && _container.querySelector('.quiz-sections-container');
    if (container) {
      container.removeEventListener('mouseup', _onHighlighterMouseUp);
      container.removeEventListener('click', _onHighlighterClick);
    }
  }

  function _onHighlighterMouseUp() {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        _hideTooltip();
        return;
      }

      const container = _container && _container.querySelector('.quiz-sections-container');
      if (!container) return;

      let node = sel.anchorNode;
      let inside = false;
      while (node) {
        if (node === container) { inside = true; break; }
        node = node.parentNode;
      }
      if (!inside) { _hideTooltip(); return; }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      _showTooltip(rect);
    }, 10);
  }

  function _showTooltip(rect) {
    if (!_tooltipEl) {
      _tooltipEl = document.createElement('div');
      _tooltipEl.className = 'highlight-palette';

      let swatchesHtml = HL_COLORS.map(c =>
        `<button class="hl-palette-swatch" data-hl-color="${c.name}"
                 style="--hl-color:${c.hex}" aria-label="Highlight ${c.name}"></button>`
      ).join('');

      _tooltipEl.innerHTML = swatchesHtml + `
        <span class="hl-palette-divider"></span>
        <button class="hl-palette-clear" aria-label="Clear highlights in selection">✕</button>
      `;

      _tooltipEl.addEventListener('mousedown', _onPaletteMouseDown);
      document.body.appendChild(_tooltipEl);
    }

    const top = rect.top + window.scrollY - 50;
    const left = rect.left + window.scrollX + rect.width / 2 - _tooltipEl.offsetWidth / 2;

    _tooltipEl.style.top = top + 'px';
    _tooltipEl.style.left = left + 'px';
    _tooltipEl.classList.add('highlight-palette--visible');
  }

  function _hideTooltip() {
    if (_tooltipEl) {
      _tooltipEl.classList.remove('highlight-palette--visible');
    }
  }

  function _onPaletteMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    // Clear button — remove highlights within selection
    const clearBtn = e.target.closest('.hl-palette-clear');
    if (clearBtn) {
      _clearHighlightsInSelection(sel);
      sel.removeAllRanges();
      _hideTooltip();
      return;
    }

    // Color swatch — apply highlight
    const swatch = e.target.closest('.hl-palette-swatch');
    if (!swatch) return;

    const color = swatch.dataset.hlColor;
    if (!color) return;

    const range = sel.getRangeAt(0);
    const mark = document.createElement('mark');
    mark.className = 'cyber-hl cyber-hl-' + color;

    try {
      range.surroundContents(mark);
    } catch (_) {
      const fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
    }

    sel.removeAllRanges();
    _hideTooltip();
  }

  function _clearHighlightsInSelection(sel) {
    const range = sel.getRangeAt(0);
    const container = _container && _container.querySelector('.quiz-sections-container');
    if (!container) return;

    // Walk all .cyber-hl marks intersecting the selection and unwrap them
    const marks = container.querySelectorAll('mark.cyber-hl');
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      if (range.intersectsNode(m)) {
        const parent = m.parentNode;
        while (m.firstChild) {
          parent.insertBefore(m.firstChild, m);
        }
        parent.removeChild(m);
      }
    }
  }

  function _onHighlighterClick(e) {
    const mark = e.target.closest('mark.cyber-hl');
    if (!mark) return;

    const parent = mark.parentNode;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
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
     AI QUIZ GENERATOR — Gemini API integration
     ========================================================== */

  async function _handleAIGenerate() {
    if (_aiGenerating) return;

    const titleInput = document.getElementById('ai-deck-title');
    const contentTA = document.getElementById('ai-quiz-content');
    const keyTA = document.getElementById('ai-quiz-key');
    const statusHint = document.getElementById('ai-status-hint');
    const btnText = document.getElementById('ai-generate-btn-text');

    const title = (titleInput && titleInput.value || '').trim();
    const content = (contentTA && contentTA.value || '').trim();
    const answerKey = (keyTA && keyTA.value || '').trim();

    if (!title) {
      if (titleInput) {
        titleInput.style.borderColor = 'var(--danger)';
        setTimeout(() => { titleInput.style.borderColor = ''; }, 2000);
      }
      return;
    }
    if (!content) {
      if (contentTA) {
        contentTA.style.borderColor = 'var(--danger)';
        setTimeout(() => { contentTA.style.borderColor = ''; }, 2000);
      }
      return;
    }

    // Read API key from localStorage
    const apiKey = (() => {
      try { return localStorage.getItem('hub_gemini_api_key') || ''; } catch (_) { return ''; }
    })();

    if (!apiKey) {
      if (statusHint) statusHint.textContent = '❌ No API key found. Set it in Settings & Backup.';
      return;
    }

    _aiGenerating = true;
    if (statusHint) statusHint.textContent = '⏳ Generating quiz with AI...';
    if (btnText) btnText.textContent = '⏳ Generating...';

    const prompt = `You are a quiz parser AI. Given raw quiz text and an optional answer key, produce a structured JSON array.

RULES:
1. Parse each question and its options from the provided content.
2. Options must be labeled A, B, C, D, etc.
3. If the answer key is provided, map the correct letters to each question in order.
4. If the answer key is EMPTY, act as an expert and solve each question to determine the correct answer.
5. Return ONLY a valid JSON array — no markdown fences, no explanatory text.

REQUIRED OUTPUT FORMAT:
[{"text": "Question text here?", "options": [{"letter": "A", "text": "Option text", "isCorrect": true}, {"letter": "B", "text": "Option text", "isCorrect": false}]}]

--- CONTENT ---
${content}
--- END CONTENT ---

--- ANSWER KEY ---
${answerKey || '(empty — solve the questions yourself)'}
--- END ANSWER KEY ---`;

    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
          })
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error('API error ' + response.status + ': ' + err.substring(0, 200));
      }

      const data = await response.json();
      const rawText = data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
        data.candidates[0].content.parts[0].text;

      if (!rawText) throw new Error('Empty response from Gemini');

      // Strip markdown fences if present
      let jsonStr = rawText.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const questions = JSON.parse(jsonStr);
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('AI did not return a valid question array');
      }

      // Build a single-section deck from the AI response
      const parsed = { sections: [{ title: title, questions: questions }], errors: [] };
      _addDeck(title, parsed);

      // Hide modal and refresh library
      const overlay = document.getElementById('ai-modal-overlay');
      if (overlay) overlay.style.display = 'none';
      if (contentTA) contentTA.value = '';
      if (keyTA) keyTA.value = '';
      if (titleInput) titleInput.value = '';

      _renderLibraryMode();

    } catch (err) {
      console.warn('[Quiz AI]', err);
      if (statusHint) statusHint.textContent = '❌ ' + (err.message || 'Generation failed');
    } finally {
      _aiGenerating = false;
      if (btnText) btnText.textContent = '⚡ Generate Quiz';
    }
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