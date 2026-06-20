/* ============================================================
   HUB.OS — modules/flashcard.js
   Vocabulary flashcard tool with 3D flip animation,
   Gemini API auto-generation, Spaced Repetition System (SM-2),
   MULTI-DECK MANAGEMENT (localStorage-backed),
   and localStorage persistence.

   Module contract:
     - id: 'flashcards'
     - render(container) → injects the flashcard UI
     - destroy()        → cleans up event listeners
   ============================================================ */

const flashcardModule = (function () {
  'use strict';

  // --- Constants ---
  const STORAGE_KEY   = 'hub_flashcards';
  const REVIEWED_KEY  = 'hub_flashcard_reviewed';
  const API_KEY_CONST = ''; // <-- PASTE YOUR GEMINI API KEY HERE, or set via the modal gear
  const API_KEY_STORE = 'hub_gemini_api_key';
  const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  // --- SRS Quality ratings (SM-2 algorithm) ---
  const QUALITY = {
    AGAIN: 0,
    HARD:  3,
    GOOD:  4,
    EASY:  5
  };

  // SRS button definitions (used in assessment panel)
  const SRS_BUTTONS = [
    { quality: QUALITY.AGAIN, label: 'Again',  cssQuality: '0' },
    { quality: QUALITY.HARD,  label: 'Hard',   cssQuality: '3' },
    { quality: QUALITY.GOOD,  label: 'Good',   cssQuality: '4' },
    { quality: QUALITY.EASY,  label: 'Easy',   cssQuality: '5' }
  ];

  // --- Private state ---
  let _decks          = [];          // Array of deck objects: { id, title, cards }
  let _activeDeckId   = null;       // Which deck is currently selected
  let _currentIndex   = 0;          // Which card we're viewing (browse mode, within active deck)
  let _container      = null;       // Reference to the DOM container for cleanup
  let _isGenerating   = false;      // Prevent double-submit (Gemini API)

  // --- SRS state ---
  let _mode           = 'library';  // 'library' | 'study' | 'browse'
  let _studyQueue     = [];         // Array of card indices for current study session
  let _sessionStats   = null;       // { reviewed: 0, correct: 0, hard: 0, again: 0, started: timestamp }
  let _cardFlipped    = false;      // Whether the card is flipped in study mode

  // --- Default starter cards (new Gemini-compatible format) ---
  const DEFAULT_CARDS = [
    {
      term: 'Ephemeral',
      type: '(adj)',
      phonetic: '/ɪˈfem.ər.əl/',
      vietnamese: 'phù du, ngắn ngủi, chóng tàn',
      describe: [
        'Lasting for a very short time',
        'Transitory; fleeting by nature'
      ],
      examples: [
        'The beauty of cherry blossoms is ephemeral, lasting only a few days.',
        'Social media fame is often ephemeral — here today, gone tomorrow.'
      ],
      note: [
        'Don\'t confuse with "ethereal" (delicate, heavenly).',
        'Often used in literary or philosophical contexts.',
        'Stress falls on the second syllable: e-PHEM-er-al.'
      ],
      synonyms: ['fleeting', 'transient', 'momentary', 'brief', 'short-lived'],
      word_family: { noun: 'ephemerality', adverb: 'ephemerally', noun2: 'ephemeron' },
      idioms: [
        'Here today, gone tomorrow — fame is ephemeral.'
      ],
      collocations: [
        'ephemeral beauty',
        'ephemeral nature',
        'ephemeral fame',
        'ephemeral moment',
        'ephemeral existence'
      ]
    },
    {
      term: 'Ubiquitous',
      type: '(adj)',
      phonetic: '/juːˈbɪk.wɪ.təs/',
      vietnamese: 'ở khắp nơi, đâu cũng có',
      describe: [
        'Present, appearing, or found everywhere',
        'So common as to seem universal'
      ],
      examples: [
        'Smartphones have become ubiquitous in modern society.',
        'The brand\'s logo is ubiquitous — you see it on every street corner.'
      ],
      note: [
        'Pronounced "you-BICK-wih-tus" — the "qui" is /kwɪ/.',
        'Often overused in academic writing; vary your vocabulary.',
        'Not to be confused with "universal" — ubiquitous implies physical presence.'
      ],
      synonyms: ['omnipresent', 'pervasive', 'universal', 'everywhere', 'all-over'],
      word_family: { noun: 'ubiquity', adverb: 'ubiquitously', noun2: 'ubiquitousness' },
      idioms: [
        'As ubiquitous as the air we breathe.'
      ],
      collocations: [
        'ubiquitous presence',
        'ubiquitous technology',
        'ubiquitous computing',
        'ubiquitous access',
        'ubiquitous advertising'
      ]
    },
    {
      term: 'Pragmatic',
      type: '(adj)',
      phonetic: '/præɡˈmæt.ɪk/',
      vietnamese: 'thực dụng, thực tế',
      describe: [
        'Dealing with things sensibly and realistically',
        'Based on practical rather than theoretical considerations'
      ],
      examples: [
        'We need a pragmatic approach to solve this budget crisis.',
        'She\'s a pragmatic leader who focuses on what actually works.'
      ],
      note: [
        'Not the same as "pragmatic" in linguistics (study of language use).',
        'Don\'t confuse with "dogmatic" — they are near opposites.',
        'A pragmatic person values results over ideology.'
      ],
      synonyms: ['practical', 'realistic', 'sensible', 'down-to-earth', 'hardheaded'],
      word_family: { noun: 'pragmatism', noun2: 'pragmatist', adverb: 'pragmatically' },
      idioms: [
        'Don\'t let perfect be the enemy of good — be pragmatic.'
      ],
      collocations: [
        'pragmatic approach',
        'pragmatic solution',
        'pragmatic view',
        'pragmatic decision',
        'pragmatic reason'
      ]
    }
  ];

  /* ==========================================================
     RENDER / DESTROY (module contract)
     ========================================================== */

  function render(container) {
    _container = container;
    _loadDecks();
    _currentIndex = 0;
    _mode = 'library';
    _activeDeckId = null;
    _studyQueue = [];
    _sessionStats = null;
    _cardFlipped = false;
    _renderApp();
  }

  function destroy() {
    _studyQueue = [];
    _sessionStats = null;
    _cardFlipped = false;
    _mode = 'library';
    _activeDeckId = null;
    _container = null;
  }

  /* ==========================================================
     MAIN RENDER DISPATCHER
     ========================================================== */

  function _renderApp() {
    if (!_container) return;

    switch (_mode) {
      case 'study':
        _renderStudySession();
        break;
      case 'browse':
        _renderBrowseMode();
        break;
      default:
        _renderDeckLibrary();
    }
  }

  /* ==========================================================
     LOAD / SAVE DECKS (with automatic migration)
     ========================================================== */

  function _loadDecks() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);

        if (Array.isArray(parsed) && parsed.length > 0) {
          // Detect format: deck array has 'cards' property; legacy flat array has 'term'
          if (parsed[0].cards !== undefined) {
            // Already in deck format — normalize all cards
            _decks = parsed.map(deck => ({
              id: deck.id || ('deck_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
              title: deck.title || 'Untitled Deck',
              cards: (deck.cards || []).map(_normalizeCard)
            }));
          } else if (parsed[0].term !== undefined) {
            // Legacy flat card array — migrate to a "Default Deck"
            _decks = [{
              id: 'deck_default_migrated',
              title: 'Default Deck',
              cards: parsed.map(_normalizeCard)
            }];
            _saveDecks(); // Persist the migration
          } else {
            _decks = [];
          }
        } else {
          _decks = [];
        }
      }
    } catch (_) { /* ignore */ }

    // If no decks exist, create default deck with starter cards
    if (!_decks || _decks.length === 0) {
      _decks = [{
        id: 'deck_default_' + Date.now(),
        title: 'Default Deck',
        cards: DEFAULT_CARDS.map(c => _normalizeCard({ ...c }))
      }];
      _saveDecks();
    }
  }

  function _saveDecks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_decks));
    } catch (_) { /* ignore */ }
  }

  /* ==========================================================
     DECK HELPERS
     ========================================================== */

  function _getActiveDeck() {
    return _decks.find(d => d.id === _activeDeckId) || null;
  }

  function _getActiveCards() {
    const deck = _getActiveDeck();
    return deck ? deck.cards : [];
  }

  /* ==========================================================
     API KEY RESOLUTION
     ========================================================== */

  function _getApiKey() {
    // 1. Check the JS constant (if user edited the file)
    if (API_KEY_CONST && API_KEY_CONST.trim() !== '') {
      return API_KEY_CONST.trim();
    }
    // 2. Check localStorage
    try {
      const stored = localStorage.getItem(API_KEY_STORE);
      if (stored && stored.trim() !== '') return stored.trim();
    } catch (_) { /* ignore */ }
    return null;
  }

  function _saveApiKey(key) {
    try {
      localStorage.setItem(API_KEY_STORE, key.trim());
    } catch (_) { /* ignore */ }
  }

  /* ==========================================================
     SRS HELPER: Count due cards in a deck
     ========================================================== */

  function _countDueCards(deck) {
    const now = Date.now();
    return deck.cards.filter(c => c.nextReviewDate <= now).length;
  }

  /**
   * Count total due cards across all decks.
   */
  function _countTotalDueCards() {
    return _decks.reduce((sum, d) => sum + _countDueCards(d), 0);
  }

  /* ==========================================================
     SRS: SM-2 ALGORITHM
     Returns a NEW card object with updated SRS fields.
     @param {number} quality - 0 (Again), 3 (Hard), 4 (Good), 5 (Easy)
     @param {Object} card   - the card being rated
     @param {boolean} isAgainInSession - if true, sets nextReviewDate to now
     @returns {Object} updated card
     ========================================================== */

  function calculateSRS(quality, card, isAgainInSession) {
    const updated = { ...card };

    if (quality >= 3) {
      // Correct response — advance interval
      if (updated.repetition === 0) {
        updated.interval = 1;
      } else if (updated.repetition === 1) {
        updated.interval = 6;
      } else {
        updated.interval = Math.round(updated.interval * updated.easeFactor);
      }
      updated.repetition++;
    } else {
      // Incorrect (Again) — reset
      updated.repetition = 0;
      updated.interval = 1;
    }

    // Update ease factor
    const qDiff = 5 - quality;
    updated.easeFactor = updated.easeFactor + (0.1 - qDiff * (0.08 + qDiff * 0.02));
    if (updated.easeFactor < 1.3) updated.easeFactor = 1.3;

    // Set next review date
    if (isAgainInSession) {
      // Re-queue in the same study session (set to now so it's immediately due)
      updated.nextReviewDate = Date.now();
    } else {
      // Convert interval (days) to milliseconds
      updated.nextReviewDate = Date.now() + (updated.interval * 24 * 60 * 60 * 1000);
    }

    return updated;
  }

  /* ==========================================================
     SRS: Simulate what the next review label WOULD be
     for a given quality, without mutating the card.
     Returns a human-readable string like "< 1m", "1d", "6d"
     ========================================================== */

  function _getNextReviewLabel(quality, card) {
    // For "Again", always show "< 1m" (in-session re-queue)
    if (quality === QUALITY.AGAIN) return '< 1m';

    // Simulate SM-2 calculation for this quality
    let interval, easeFactor;

    easeFactor = card.easeFactor +
      (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    if (quality >= 3) {
      if (card.repetition === 0) {
        interval = 1;
      } else if (card.repetition === 1) {
        interval = 6;
      } else {
        interval = Math.round(card.interval * easeFactor);
      }
    } else {
      interval = 1;
    }

    return _formatInterval(interval);
  }

  /**
   * Format a day-based interval into a human-readable label.
   * @param {number} days
   * @returns {string}
   */
  function _formatInterval(days) {
    if (days < 1) {
      // Shouldn't happen for non-Again, but handle gracefully
      const mins = Math.round(days * 24 * 60);
      if (mins < 60) return `< ${mins}m`;
      const hrs = Math.round(days * 24);
      return `< ${hrs}h`;
    }
    if (days === 1) return '1d';
    if (days < 30) return `${days}d`;
    if (days < 365) {
      const months = Math.round(days / 30);
      return `${months}mo`;
    }
    const years = Math.round(days / 365);
    return `${years}y`;
  }

  /**
   * Format a timestamp (nextReviewDate) into a relative label.
   * Used in browse mode to show when a card is due.
   * @param {number} timestamp
   * @returns {string}
   */
  function _formatDueDate(timestamp) {
    const now = Date.now();
    if (timestamp <= now) return 'Now';
    const diffMs = timestamp - now;
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    if (diffDays < 1) {
      const hrs = Math.round(diffMs / (60 * 60 * 1000));
      if (hrs < 1) return 'Soon';
      return `in ${hrs}h`;
    }
    return `in ${_formatInterval(Math.round(diffDays))}`;
  }

  /* ==========================================================
     GEMINI API — GENERATE CARD DATA  (PRESERVED VERBATIM)
     ========================================================== */

  /**
   * Call Gemini 2.5 Flash to generate vocabulary data for a word.
   * @param {string} word — the word to look up
   * @returns {Promise<Object>} parsed card data (with SRS defaults appended)
   */
  async function _generateCardData(word) {
    const apiKey = _getApiKey();
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const prompt = `You are an English vocabulary tutor. Return ONLY valid JSON for the word '${word}'.
Keys: type, phonetic, vietnamese, describe, examples, note, synonyms, word_family, idioms, collocations.
- type: short form (n), (v), (adj), (adv)
- vietnamese: concise Vietnamese meaning
- describe: RETURN A LIST of distinct short meanings (each <= 12 words)
- examples: RETURN A LIST of 2 short example sentences (natural, correct context)
- note: return EXACTLY 3 short bullet points (<=15 words each) about common mistakes/confusions.
- synonyms: up to 5
- word_family: include forms with POS
- idioms: return up to 2 idioms or set phrases using the word.
- collocations: return 5 natural collocations`;

    const body = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 400) {
        throw new Error('INVALID_API_KEY');
      }
      if (response.status === 429) {
        throw new Error('RATE_LIMITED');
      }
      throw new Error(`API_ERROR:${response.status}:${errorText}`);
    }

    const data = await response.json();

    // Extract the text from Gemini's response structure
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('EMPTY_RESPONSE');
    }

    // Parse the JSON — Gemini may wrap in markdown code blocks
    const parsed = _parseGeminiJson(rawText);

    // Build a clean card object with the word AND SRS defaults injected
    return {
      term: word,
      type: parsed.type || '',
      phonetic: parsed.phonetic || '',
      vietnamese: parsed.vietnamese || '',
      describe: _ensureArray(parsed.describe),
      examples: _ensureArray(parsed.examples),
      note: _ensureArray(parsed.note),
      synonyms: _ensureArray(parsed.synonyms),
      word_family: parsed.word_family || {},
      idioms: _ensureArray(parsed.idioms),
      collocations: _ensureArray(parsed.collocations),
      // --- SRS defaults for new cards ---
      repetition: 0,
      interval: 0,
      easeFactor: 2.5,
      nextReviewDate: Date.now()
    };
  }

  /**
   * Parse Gemini's response text into JSON, stripping any
   * markdown code fences that the model may emit.
   */
  function _parseGeminiJson(text) {
    let jsonStr = text.trim();

    // Remove markdown code block wrappers
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr
        .replace(/^```(?:json)?\s*\n?/i, '')  // opening fence
        .replace(/\n?```\s*$/, '');            // closing fence
    }

    return JSON.parse(jsonStr);
  }

  /**
   * Ensure a value is an array. Handles stringified arrays
   * and single values gracefully.
   */
  function _ensureArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      // Try parsing as JSON array first
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) { /* fall through */ }
      // Single string — wrap in array
      return val.trim() ? [val.trim()] : [];
    }
    if (val && typeof val === 'object') {
      return Object.values(val).filter(v => v && typeof v === 'string');
    }
    return [];
  }

  /* ==========================================================
     STATE 1 — DECK LIBRARY (New Dashboard)
     CSS grid of glassmorphism deck cards.
     Each card: title, total cards, due count, actions.
     ========================================================== */

  function _renderDeckLibrary() {
    if (!_container) return;

    const totalCards = _decks.reduce((sum, d) => sum + d.cards.length, 0);
    const totalDue = _countTotalDueCards();

    // --- Empty state: no decks at all ---
    if (_decks.length === 0) {
      _container.innerHTML = `
        <div class="tab-content flashcard-app">
          <div class="empty-state">
            <div class="empty-state-icon">📚</div>
            <h3>No decks yet</h3>
            <p>Create your first flashcard deck to get started.</p>
            <button class="btn btn-primary" id="btn-create-first-deck">+ Create Your First Deck</button>
          </div>
        </div>
      `;
      const btnCreate = _container.querySelector('#btn-create-first-deck');
      if (btnCreate) btnCreate.addEventListener('click', _showCreateDeckModal);
      return;
    }

    // --- Sort decks: those with due cards first, then alphabetical ---
    const sortedDecks = [..._decks].sort((a, b) => {
      const aDue = _countDueCards(a);
      const bDue = _countDueCards(b);
      if (aDue > 0 && bDue === 0) return -1;
      if (bDue > 0 && aDue === 0) return 1;
      return a.title.localeCompare(b.title);
    });

    _container.innerHTML = `
      <div class="tab-content flashcard-app" style="align-items:stretch;">

        <!-- Header -->
        <div class="flashcard-header" style="max-width:100%;">
          <h2 class="section-header" style="margin-bottom:0;">Deck Library</h2>
          <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);">
            ${totalCards} cards · ${totalDue} due
          </span>
        </div>

        <!-- Deck Grid -->
        <div class="deck-grid">
          ${sortedDecks.map(deck => {
            const dTotal = deck.cards.length;
            const dDue = _countDueCards(deck);
            return `
              <div class="deck-card glass-card" data-deck-id="${_esc(deck.id)}">
                <div class="deck-card-top">
                  <h3 class="deck-card-title">${_esc(deck.title)}</h3>
                  <button class="deck-delete-btn" data-action="delete-deck" data-deck-id="${_esc(deck.id)}" title="Delete deck">🗑</button>
                </div>
                <div class="deck-card-meta">
                  Total Cards: ${dTotal} ·
                  <span style="color:${dDue > 0 ? 'var(--accent-primary)' : 'var(--text-muted)'};">
                    Due for Review: ${dDue}
                  </span>
                </div>
                <div class="deck-card-actions">
                  <button class="deck-play-btn" data-action="study" data-deck-id="${_esc(deck.id)}" ${dDue === 0 ? 'disabled style="opacity:0.35;cursor:not-allowed;box-shadow:none;"' : ''}>
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <polygon points="4,2 16,10 4,18"/>
                    </svg>
                    Study Due
                  </button>
                  <button class="deck-browse-btn" data-action="browse" data-deck-id="${_esc(deck.id)}">
                    Browse / Edit
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Create New Deck Button -->
        <button class="deck-create-btn btn btn-primary" id="btn-create-deck">
          <span style="font-size:1.1rem;">+</span> Create New Deck
        </button>

      </div>
    `;

    // --- Bind events ---

    // Create deck button
    const btnCreate = _container.querySelector('#btn-create-deck');
    if (btnCreate) btnCreate.addEventListener('click', _showCreateDeckModal);

    // Deck action buttons (Study Due, Browse/Edit, Delete)
    _container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const deckId = btn.dataset.deckId;

        if (action === 'study') {
          _activeDeckId = deckId;
          _startStudySession();
        } else if (action === 'browse') {
          _activeDeckId = deckId;
          _currentIndex = 0;
          _mode = 'browse';
          _cardFlipped = false;
          _renderApp();
        } else if (action === 'delete-deck') {
          _showDeckDeleteConfirm(deckId);
        }
      });
    });
  }

  /* ==========================================================
     CREATE DECK MODAL
     ========================================================== */

  function _showCreateDeckModal() {
    if (document.getElementById('create-deck-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'create-deck-overlay';
    overlay.className = 'add-card-overlay';
    overlay.innerHTML = `
      <div class="generate-modal glass" id="create-deck-modal">
        <div class="generate-modal-header">
          <div class="generate-modal-icon">
            <span style="font-size:1.8rem;">📚</span>
          </div>
          <h3 class="generate-modal-title">Create New Deck</h3>
          <p class="generate-modal-subtitle">Organize flashcards by topic</p>
        </div>

        <div class="generate-input-row" style="flex-direction:column;">
          <input
            type="text"
            id="input-deck-title"
            class="generate-word-input"
            placeholder="Deck title (e.g. IELTS Vocab)"
            autocomplete="off"
          >
        </div>

        <div class="generate-status" id="create-deck-status"></div>

        <div class="generate-modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-create-deck">Cancel</button>
          <button class="btn btn-primary" id="btn-confirm-create-deck">Create Deck</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeCreateDeckModal();
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        _closeCreateDeckModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Cancel button
    overlay.querySelector('#btn-cancel-create-deck')
      .addEventListener('click', _closeCreateDeckModal);

    // Confirm button
    overlay.querySelector('#btn-confirm-create-deck')
      .addEventListener('click', () => {
        const input = document.getElementById('input-deck-title');
        const title = input ? input.value.trim() : '';
        if (!title) {
          const status = document.getElementById('create-deck-status');
          if (status) {
            status.className = 'generate-status status-error';
            status.textContent = 'Please enter a deck title.';
          }
          return;
        }
        _createDeck(title);
        _closeCreateDeckModal();
        _renderApp();
      });

    // Enter key
    overlay.querySelector('#input-deck-title')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          overlay.querySelector('#btn-confirm-create-deck').click();
        }
      });

    // Focus input
    setTimeout(() => {
      const inp = overlay.querySelector('#input-deck-title');
      if (inp) inp.focus();
    }, 150);
  }

  function _closeCreateDeckModal() {
    const overlay = document.getElementById('create-deck-overlay');
    if (overlay) overlay.remove();
  }

  function _createDeck(title) {
    const deck = {
      id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      title: title,
      cards: []
    };
    _decks.push(deck);
    _saveDecks();
  }

  /* ==========================================================
     DELETE DECK CONFIRMATION
     ========================================================== */

  function _showDeckDeleteConfirm(deckId) {
    const deck = _decks.find(d => d.id === deckId);
    if (!deck) return;

    const cardCount = deck.cards.length;
    const msg = cardCount > 0
      ? `Delete "${deck.title}" and its ${cardCount} card${cardCount !== 1 ? 's' : ''}? This cannot be undone.`
      : `Delete empty deck "${deck.title}"?`;

    if (confirm(msg)) {
      _decks = _decks.filter(d => d.id !== deckId);
      _saveDecks();

      // If we were in browse/study mode for this deck, go back to library
      if (_activeDeckId === deckId) {
        _activeDeckId = null;
        _mode = 'library';
      }
      _renderApp();
    }
  }

  /* ==========================================================
     TOAST NOTIFICATION (brief floating message)
     ========================================================== */

  function _showToast(message) {
    // Remove any existing toast
    const existing = document.querySelector('.srs-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'srs-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 100px; left: 50%; transform: translateX(-50%);
      padding: 12px 24px; border-radius: var(--radius-full);
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-primary);
      z-index: 999; animation: fadeSlideIn 0.3s var(--ease-out-expo);
      box-shadow: var(--shadow-md);
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  /* ==========================================================
     START STUDY SESSION
     Build queue of due card indices from the ACTIVE deck only,
     then enter study mode.
     ========================================================== */

  function _startStudySession() {
    const deck = _getActiveDeck();
    if (!deck) {
      _showToast('Please select a deck first.');
      _mode = 'library';
      _renderApp();
      return;
    }

    const now = Date.now();
    _studyQueue = [];
    for (let i = 0; i < deck.cards.length; i++) {
      if (deck.cards[i].nextReviewDate <= now) {
        _studyQueue.push(i);
      }
    }

    if (_studyQueue.length === 0) {
      _showToast('No cards due in this deck! You\'re all caught up.');
      _mode = 'library';
      _renderApp();
      return;
    }

    // Shuffle the queue for variety
    for (let i = _studyQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [_studyQueue[i], _studyQueue[j]] = [_studyQueue[j], _studyQueue[i]];
    }

    _sessionStats = {
      reviewed: 0,
      correct: 0,
      hard: 0,
      again: 0,
      started: Date.now()
    };

    _mode = 'study';
    _cardFlipped = false;
    _renderStudySession();
  }

  /* ==========================================================
     STATE 2 — STUDY SESSION
     One card at a time, flip to reveal + assessment panel
     ========================================================== */

  function _renderStudySession() {
    if (!_container) return;

    const deck = _getActiveDeck();

    // Check if queue is empty → completion
    if (_studyQueue.length === 0) {
      _renderCompletionScreen();
      return;
    }

    const cardIdx = _studyQueue[0];
    const cards = _getActiveCards();
    const card = cards[cardIdx];
    const remaining = _studyQueue.length;
    const reviewed = _sessionStats ? _sessionStats.reviewed : 0;

    _container.innerHTML = `
      <div class="tab-content flashcard-app">

        <!-- Session top bar -->
        <div class="srs-session-bar">
          <span class="srs-session-counter">
            <strong>${remaining}</strong> card${remaining !== 1 ? 's' : ''} remaining
            · ${reviewed} reviewed
          </span>
          <button class="srs-btn-end-session" id="btn-end-session">End Session</button>
        </div>

        ${deck ? `<p style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Deck: ${_esc(deck.title)}</p>` : ''}

        <!-- 3D Card -->
        <div class="card-stage" id="card-stage">
          <div class="card-3d" id="card-3d">
            <!-- ============ FRONT FACE ============ -->
            <div class="card-face card-front">
              <span class="card-term">${_esc(card.term)}</span>
              ${card.type ? `<span class="card-pos">${_esc(card.type)}</span>` : ''}
              ${card.phonetic ? `<span class="card-phonetic-front">${_esc(card.phonetic)}</span>` : ''}
              <span class="card-hint">Click to flip</span>
            </div>

            <!-- ============ BACK FACE ============ -->
            <div class="card-face card-back">
              <div class="card-back-scroll">
                <!-- Header: word + type -->
                <div class="card-back-header">
                  <div class="card-back-header-left">
                    <span class="card-back-word">${_esc(card.term)}</span>
                    ${card.type ? `<span class="card-pos card-pos-back">${_esc(card.type)}</span>` : ''}
                  </div>
                </div>

                ${card.phonetic ? `
                <div class="card-section">
                  <span class="card-section-label label-phonetic">🔊 Phonetic</span>
                  <span class="card-phonetic">${_esc(card.phonetic)}</span>
                </div>` : ''}

                ${card.vietnamese ? `
                <div class="card-section">
                  <span class="card-section-label label-vietnamese">🇻🇳 Vietnamese</span>
                  <span class="card-vietnamese">${_esc(card.vietnamese)}</span>
                </div>` : ''}

                ${card.describe && card.describe.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-definition">📖 Definition</span>
                  <ul class="card-bullet-list">
                    ${card.describe.map(d => `<li>${_esc(d)}</li>`).join('')}
                  </ul>
                </div>` : ''}

                ${card.examples && card.examples.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-examples">💬 Examples</span>
                  <ul class="card-bullet-list">
                    ${card.examples.map(e => `<li class="card-example-item">${_esc(e)}</li>`).join('')}
                  </ul>
                </div>` : ''}

                ${card.synonyms && card.synonyms.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-synonyms">🔗 Synonyms</span>
                  <div class="card-tags">
                    ${card.synonyms.map(s => `<span class="card-tag tag-synonym">${_esc(s)}</span>`).join('')}
                  </div>
                </div>` : ''}

                ${card.word_family && Object.keys(card.word_family).length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-family">🌳 Word Family</span>
                  <div class="card-word-family">
                    ${Object.entries(card.word_family).map(([pos, w]) =>
                      `<span class="family-item"><span class="family-pos">${_esc(pos)}</span> ${_esc(w)}</span>`
                    ).join('')}
                  </div>
                </div>` : ''}

                ${card.idioms && card.idioms.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-idioms">📜 Idioms & Phrases</span>
                  ${card.idioms.map(i => `<p class="card-idiom-item">${_esc(i)}</p>`).join('')}
                </div>` : ''}

                ${card.collocations && card.collocations.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-collocations">🧩 Collocations</span>
                  <div class="card-tags">
                    ${card.collocations.map(c => `<span class="card-tag tag-collocation">${_esc(c)}</span>`).join('')}
                  </div>
                </div>` : ''}

                ${card.note && card.note.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-notes">⚠️ Usage Notes</span>
                  <ul class="card-bullet-list card-notes-list">
                    ${card.note.map(n => `<li>${_esc(n)}</li>`).join('')}
                  </ul>
                </div>` : ''}
              </div><!-- /card-back-scroll -->
            </div><!-- /card-back -->
          </div><!-- /card-3d -->
        </div><!-- /card-stage -->

        <!-- Assessment Panel (hidden until card flips) -->
        <div class="srs-assessment-panel" id="srs-assessment-panel">
          <p class="srs-assessment-label">How well did you remember?</p>
          <div class="srs-assessment-row">
            ${SRS_BUTTONS.map(btn => {
              const timeLabel = _getNextReviewLabel(btn.quality, card);
              return `
                <button class="srs-assessment-btn" data-quality="${btn.cssQuality}" data-label="${btn.label}">
                  <span class="srs-time-badge">${timeLabel}</span>
                  <span class="srs-btn-label">${btn.label}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>

      </div>
    `;

    // If card was already flipped, restore flipped state
    if (_cardFlipped) {
      const card3d = _container.querySelector('#card-3d');
      if (card3d) card3d.classList.add('flipped');
      const panel = _container.querySelector('#srs-assessment-panel');
      if (panel) {
        // Small delay for the flip animation to start
        setTimeout(() => panel.classList.add('revealed'), 150);
      }
    }

    _bindStudyEvents(cardIdx);
  }

  /* ==========================================================
     BIND STUDY SESSION EVENTS
     ========================================================== */

  function _bindStudyEvents(cardIdx) {
    if (!_container) return;

    // Card flip
    const card3d = _container.querySelector('#card-3d');
    const panel = _container.querySelector('#srs-assessment-panel');

    if (card3d && panel) {
      // Click to flip
      card3d.addEventListener('click', () => {
        if (!_cardFlipped) {
          _cardFlipped = true;
          card3d.classList.add('flipped');
          // Reveal assessment panel with a slight delay for the flip
          setTimeout(() => panel.classList.add('revealed'), 150);
        }
      });

      // Space bar also flips
      const spaceHandler = (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          e.preventDefault();
          if (!_cardFlipped) {
            _cardFlipped = true;
            card3d.classList.add('flipped');
            setTimeout(() => panel.classList.add('revealed'), 150);
          }
        }
      };
      document.addEventListener('keydown', spaceHandler);
    }

    // Assessment buttons — also allow number keys 1-4
    const numberHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!_cardFlipped) return;
      const keyMap = { '1': QUALITY.AGAIN, '2': QUALITY.HARD, '3': QUALITY.GOOD, '4': QUALITY.EASY };
      const quality = keyMap[e.key];
      if (quality !== undefined) {
        e.preventDefault();
        _handleAssessment(quality, cardIdx);
      }
    };
    document.addEventListener('keydown', numberHandler);

    // Assessment button clicks
    _container.querySelectorAll('.srs-assessment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const quality = parseInt(btn.dataset.quality, 10);
        _handleAssessment(quality, cardIdx);
      });
    });

    // End session button → back to deck library
    const btnEnd = _container.querySelector('#btn-end-session');
    if (btnEnd) {
      btnEnd.addEventListener('click', () => {
        _studyQueue = [];
        _mode = 'library';
        _activeDeckId = null;
        _cardFlipped = false;
        _renderApp();
      });
    }
  }

  /* ==========================================================
     HANDLE ASSESSMENT (SM-2 update + advance queue)
     ========================================================== */

  function _handleAssessment(quality, cardIdx) {
    if (!_container) return;

    const deck = _getActiveDeck();
    if (!deck) return;

    // Remove the current card from the front of the queue
    _studyQueue.shift();

    const card = deck.cards[cardIdx];
    const isAgain = (quality === QUALITY.AGAIN);

    // Apply SM-2 algorithm
    const updated = calculateSRS(quality, card, isAgain);
    deck.cards[cardIdx] = updated;
    _saveDecks();

    // Track stats
    if (_sessionStats) {
      _sessionStats.reviewed++;
      if (isAgain) _sessionStats.again++;
      else if (quality === QUALITY.HARD) _sessionStats.hard++;
      else _sessionStats.correct++;
    }

    // If "Again", re-add to the end of the queue
    if (isAgain) {
      _studyQueue.push(cardIdx);
    }

    // Update reviewed count in dashboard
    _incrementReviewed();

    // Reset flip state and render next card
    _cardFlipped = false;

    if (_studyQueue.length === 0) {
      // Session complete
      _renderCompletionScreen();
    } else {
      _renderStudySession();
      // Scroll to top of card
      _container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ==========================================================
     STATE 2b — COMPLETION SCREEN
     ========================================================== */

  function _renderCompletionScreen() {
    if (!_container) return;

    const stats = _sessionStats || { reviewed: 0, correct: 0, hard: 0, again: 0 };
    const deck = _getActiveDeck();
    const total = stats.reviewed;
    let icon, title, subtitle;

    if (total === 0) {
      icon = '📭';
      title = 'No cards to review';
      subtitle = 'Check back later when cards are due for review.';
    } else if (stats.correct === total) {
      icon = '🏆';
      title = 'Perfect Score!';
      subtitle = `All ${total} card${total !== 1 ? 's' : ''} answered correctly. Outstanding memory!`;
    } else if (stats.correct >= total * 0.7) {
      icon = '👍';
      title = 'Great Session!';
      subtitle = `${stats.correct} of ${total} correct. Keep up the good work.`;
    } else {
      icon = '📚';
      title = 'Session Complete';
      subtitle = `${stats.correct} of ${total} correct. Practice makes perfect — keep at it!`;
    }

    const deckDueCount = deck ? _countDueCards(deck) : 0;

    _container.innerHTML = `
      <div class="tab-content flashcard-app srs-completion">
        <div class="srs-completion-icon">${icon}</div>
        <h2 class="srs-completion-title">${title}</h2>
        <p class="srs-completion-subtitle">${subtitle}</p>

        ${total > 0 ? `
        <div class="srs-completion-stats">
          <div class="srs-completion-stat">
            <span class="srs-completion-stat-val good">${stats.correct}</span>
            <span class="srs-completion-stat-lbl">Correct</span>
          </div>
          <div class="srs-completion-stat">
            <span class="srs-completion-stat-val ok">${stats.hard}</span>
            <span class="srs-completion-stat-lbl">Hard</span>
          </div>
          <div class="srs-completion-stat">
            <span class="srs-completion-stat-val" style="color:var(--danger);">${stats.again}</span>
            <span class="srs-completion-stat-lbl">Again</span>
          </div>
        </div>
        ` : ''}

        <!-- Next due count -->
        <p style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);margin-top:var(--space-sm);">
          ${deckDueCount} card${deckDueCount !== 1 ? 's' : ''} due now${deck ? ` in "${_esc(deck.title)}"` : ''}
        </p>

        <div style="display:flex;gap:var(--space-md);margin-top:var(--space-lg);">
          <button class="btn btn-primary" id="btn-back-to-library">
            ⬅ Back to Decks
          </button>
          ${deckDueCount > 0 ? `
          <button class="srs-btn-study" id="btn-study-again">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
              <polygon points="4,2 14,9 4,16"/>
            </svg>
            Keep Studying
          </button>
          ` : ''}
        </div>
      </div>
    `;

    // Bind events
    const btnDash = _container.querySelector('#btn-back-to-library');
    if (btnDash) btnDash.addEventListener('click', () => {
      _mode = 'library';
      _activeDeckId = null;
      _sessionStats = null;
      _renderApp();
    });

    const btnAgain = _container.querySelector('#btn-study-again');
    if (btnAgain) btnAgain.addEventListener('click', () => {
      _startStudySession();
    });
  }

  /* ==========================================================
     STATE 3 — BROWSE MODE (Deck-specific Browse & Edit)
     Shows cards from the active deck only.
     ========================================================== */

  function _renderBrowseMode() {
    if (!_container) return;

    const deck = _getActiveDeck();
    const cards = _getActiveCards();

    // --- If no deck found, fall back to library ---
    if (!deck) {
      _mode = 'library';
      _renderApp();
      return;
    }

    // --- If no cards, show empty state ---
    if (cards.length === 0) {
      _container.innerHTML = `
        <div class="tab-content flashcard-app">
          <div class="flashcard-header">
            <button class="btn btn-ghost" id="btn-back-to-library" style="padding:6px 14px;">⬅ Back to Decks</button>
            <h2 class="section-header" style="margin-bottom:0;">${_esc(deck.title)}</h2>
          </div>
          <div class="empty-state">
            <div class="empty-state-icon">🃏</div>
            <h3>No flashcards yet</h3>
            <p>Add your first vocabulary card with AI or manually.</p>
            <div class="btn-group" style="justify-content:center;">
              <button class="btn btn-primary" id="btn-add-ai-empty">✨ AI Generate</button>
              <button class="btn btn-manual-add" id="btn-add-manual-empty">✍️ Manual Add</button>
            </div>
          </div>
        </div>
      `;
      const btnBack = _container.querySelector('#btn-back-to-library');
      if (btnBack) btnBack.addEventListener('click', () => { _mode = 'library'; _activeDeckId = null; _renderApp(); });
      const btnAi = _container.querySelector('#btn-add-ai-empty');
      if (btnAi) btnAi.addEventListener('click', _showAddForm);
      const btnManual = _container.querySelector('#btn-add-manual-empty');
      if (btnManual) btnManual.addEventListener('click', () => _showCardEditorModal(null));
      return;
    }

    const card = cards[_currentIndex];
    if (!card) {
      _currentIndex = 0;
      _renderBrowseMode();
      return;
    }

    const hasIdioms       = card.idioms && card.idioms.length > 0;
    const hasCollocations  = card.collocations && card.collocations.length > 0;
    const hasSynonyms     = card.synonyms && card.synonyms.length > 0;
    const hasWordFamily   = card.word_family && Object.keys(card.word_family).length > 0;
    const hasNotes        = card.note && card.note.length > 0;

    // SRS info for this card
    const dueLabel = _formatDueDate(card.nextReviewDate || 0);
    const intervalLabel = _formatInterval(card.interval || 0);
    const easeLabel = (card.easeFactor || 2.5).toFixed(1);

    _container.innerHTML = `
      <div class="tab-content flashcard-app">
        <!-- Header row -->
        <div class="flashcard-header">
          <button class="btn btn-ghost" id="btn-back-to-library" style="padding:6px 14px;">⬅ Back to Decks</button>
          <div style="text-align:center;">
            <h2 class="section-header" style="margin-bottom:2px;">${_esc(deck.title)}</h2>
            <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted);">${cards.length} card${cards.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="btn-group">
            <button class="btn btn-primary btn-sm" id="btn-add-card-ai">✨ AI Generate</button>
            <button class="btn btn-manual-add btn-sm" id="btn-add-card-manual">✍️ Manual Add</button>
          </div>
        </div>

        <!-- 3D Card -->
        <div class="card-stage" id="card-stage">
          <div class="card-3d" id="card-3d">
            <!-- ============ FRONT FACE ============ -->
            <div class="card-face card-front">
              <span class="card-term">${_esc(card.term)}</span>
              ${card.type ? `<span class="card-pos">${_esc(card.type)}</span>` : ''}
              ${card.phonetic ? `<span class="card-phonetic-front">${_esc(card.phonetic)}</span>` : ''}
              <span class="card-hint">Click to flip</span>
            </div>

            <!-- ============ BACK FACE ============ -->
            <div class="card-face card-back">
              <div class="card-back-scroll">
                <!-- Header: word + type + flip-back button -->
                <div class="card-back-header">
                  <div class="card-back-header-left">
                    <span class="card-back-word">${_esc(card.term)}</span>
                    ${card.type ? `<span class="card-pos card-pos-back">${_esc(card.type)}</span>` : ''}
                  </div>
                  <button class="card-flip-back-btn" title="Flip back" aria-label="Flip card back">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M7 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                </div>

                ${card.phonetic ? `
                <div class="card-section">
                  <span class="card-section-label label-phonetic">🔊 Phonetic</span>
                  <span class="card-phonetic">${_esc(card.phonetic)}</span>
                </div>` : ''}

                ${card.vietnamese ? `
                <div class="card-section">
                  <span class="card-section-label label-vietnamese">🇻🇳 Vietnamese</span>
                  <span class="card-vietnamese">${_esc(card.vietnamese)}</span>
                </div>` : ''}

                ${card.describe && card.describe.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-definition">📖 Definition</span>
                  <ul class="card-bullet-list">
                    ${card.describe.map(d => `<li>${_esc(d)}</li>`).join('')}
                  </ul>
                </div>` : ''}

                ${card.examples && card.examples.length > 0 ? `
                <div class="card-section">
                  <span class="card-section-label label-examples">💬 Examples</span>
                  <ul class="card-bullet-list">
                    ${card.examples.map(e => `<li class="card-example-item">${_esc(e)}</li>`).join('')}
                  </ul>
                </div>` : ''}

                ${hasSynonyms ? `
                <div class="card-section">
                  <span class="card-section-label label-synonyms">🔗 Synonyms</span>
                  <div class="card-tags">
                    ${card.synonyms.map(s => `<span class="card-tag tag-synonym">${_esc(s)}</span>`).join('')}
                  </div>
                </div>` : ''}

                ${hasWordFamily ? `
                <div class="card-section">
                  <span class="card-section-label label-family">🌳 Word Family</span>
                  <div class="card-word-family">
                    ${Object.entries(card.word_family).map(([pos, w]) =>
                      `<span class="family-item"><span class="family-pos">${_esc(pos)}</span> ${_esc(w)}</span>`
                    ).join('')}
                  </div>
                </div>` : ''}

                ${hasIdioms ? `
                <div class="card-section">
                  <span class="card-section-label label-idioms">📜 Idioms & Phrases</span>
                  ${card.idioms.map(i => `<p class="card-idiom-item">${_esc(i)}</p>`).join('')}
                </div>` : ''}

                ${hasCollocations ? `
                <div class="card-section">
                  <span class="card-section-label label-collocations">🧩 Collocations</span>
                  <div class="card-tags">
                    ${card.collocations.map(c => `<span class="card-tag tag-collocation">${_esc(c)}</span>`).join('')}
                  </div>
                </div>` : ''}

                ${hasNotes ? `
                <div class="card-section">
                  <span class="card-section-label label-notes">⚠️ Usage Notes</span>
                  <ul class="card-bullet-list card-notes-list">
                    ${card.note.map(n => `<li>${_esc(n)}</li>`).join('')}
                  </ul>
                </div>` : ''}

                <!-- SRS Info Footer -->
                <div class="srs-info-footer">
                  <div class="srs-info-item">
                    <span class="srs-info-item-label">Due</span>
                    <span class="srs-info-item-value">${dueLabel}</span>
                  </div>
                  <div class="srs-info-item">
                    <span class="srs-info-item-label">Interval</span>
                    <span class="srs-info-item-value">${intervalLabel}</span>
                  </div>
                  <div class="srs-info-item">
                    <span class="srs-info-item-label">Ease</span>
                    <span class="srs-info-item-value">${easeLabel}×</span>
                  </div>
                </div>

              </div><!-- /card-back-scroll -->
            </div><!-- /card-back -->
          </div><!-- /card-3d -->
        </div><!-- /card-stage -->

        <!-- Deck navigation -->
        <div class="deck-nav">
          <button class="deck-btn" id="btn-prev" ${_currentIndex === 0 ? 'disabled' : ''}>◀</button>
          <span class="deck-counter">${_currentIndex + 1} / ${cards.length}</span>
          <button class="deck-btn" id="btn-next" ${_currentIndex >= cards.length - 1 ? 'disabled' : ''}>▶</button>
        </div>

        <!-- Dot indicators -->
        <div class="deck-dots" id="deck-dots">
          ${cards.map((_, i) => `
            <span class="deck-dot${i === _currentIndex ? ' active' : ''}" data-index="${i}"></span>
          `).join('')}
        </div>

        <!-- Delete + Edit buttons -->
        <div class="btn-group" style="margin-top:var(--space-md);">
          <button class="btn btn-danger" id="btn-delete-card">
            🗑 Delete Card
          </button>
          <button class="btn btn-edit-card" id="btn-edit-card">
            ✏️ Edit Card
          </button>
        </div>
      </div>
    `;

    _bindBrowseEvents();
  }

  /* ==========================================================
     BIND BROWSE MODE EVENTS (Deck-scoped)
     ========================================================== */

  function _bindBrowseEvents() {
    if (!_container) return;

    const cards = _getActiveCards();

    // Back to library
    const btnBack = _container.querySelector('#btn-back-to-library');
    if (btnBack) btnBack.addEventListener('click', () => {
      _mode = 'library';
      _activeDeckId = null;
      _currentIndex = 0;
      _renderApp();
    });

    // Card flip
    const card3d = _container.querySelector('#card-3d');
    if (card3d) {
      card3d.addEventListener('click', () => {
        card3d.classList.toggle('flipped');
      });
    }

    // Flip-back button
    const flipBackBtn = _container.querySelector('.card-flip-back-btn');
    if (flipBackBtn) {
      flipBackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = _container.querySelector('#card-3d');
        if (c) c.classList.remove('flipped');
      });
    }

    // Prevent scroll-container clicks from flipping
    const scrollArea = _container.querySelector('.card-back-scroll');
    if (scrollArea) {
      scrollArea.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Add card buttons (AI + Manual)
    const btnAddAi = _container.querySelector('#btn-add-card-ai');
    if (btnAddAi) btnAddAi.addEventListener('click', _showAddForm);
    const btnAddManual = _container.querySelector('#btn-add-card-manual');
    if (btnAddManual) btnAddManual.addEventListener('click', () => _showCardEditorModal(null));

    // Prev / Next
    const btnPrev = _container.querySelector('#btn-prev');
    const btnNext = _container.querySelector('#btn-next');
    if (btnPrev) btnPrev.addEventListener('click', () => {
      if (_currentIndex > 0) { _currentIndex--; _renderBrowseMode(); }
    });
    if (btnNext) btnNext.addEventListener('click', () => {
      if (_currentIndex < cards.length - 1) { _currentIndex++; _renderBrowseMode(); }
    });

    // Keyboard nav
    const keyHandler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' && _currentIndex > 0) {
        _currentIndex--;
        _renderBrowseMode();
        _incrementReviewed();
      } else if (e.key === 'ArrowRight' && _currentIndex < cards.length - 1) {
        _currentIndex++;
        _renderBrowseMode();
        _incrementReviewed();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        const c = _container.querySelector('#card-3d');
        if (c) c.classList.toggle('flipped');
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Dot indicators (click to jump)
    _container.querySelectorAll('.deck-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        _currentIndex = parseInt(dot.dataset.index, 10);
        _renderBrowseMode();
      });
    });

    // Delete card
    const btnDelete = _container.querySelector('#btn-delete-card');
    if (btnDelete) btnDelete.addEventListener('click', () => {
      if (confirm(`Delete "${cards[_currentIndex].term}"?`)) {
        const deck = _getActiveDeck();
        if (!deck) return;
        deck.cards.splice(_currentIndex, 1);
        _saveDecks();
        if (_currentIndex >= deck.cards.length) _currentIndex = Math.max(0, deck.cards.length - 1);
        if (deck.cards.length === 0) {
          // Deck is now empty — stay in browse mode to show empty state
          _renderBrowseMode();
        } else {
          _renderApp();
        }
      }
    });

    // Edit card
    const btnEdit = _container.querySelector('#btn-edit-card');
    if (btnEdit) btnEdit.addEventListener('click', () => {
      _showCardEditorModal(cards[_currentIndex]);
    });
  }

  /* ==========================================================
     INCREMENT REVIEWED COUNT
     ========================================================== */

  function _incrementReviewed() {
    try {
      const count = parseInt(localStorage.getItem(REVIEWED_KEY) || '0', 10);
      localStorage.setItem(REVIEWED_KEY, count + 1);
    } catch (_) { /* ignore */ }
  }

  /* ==========================================================
     ADD CARD — GEMINI-POWERED MODAL  (PRESERVED VERBATIM)
     ========================================================== */

  function _showAddForm() {
    // Prevent multiple overlays
    if (document.getElementById('add-card-overlay')) return;

    const hasApiKey = !!_getApiKey();

    const overlay = document.createElement('div');
    overlay.id = 'add-card-overlay';
    overlay.className = 'add-card-overlay';
    overlay.innerHTML = `
      <div class="generate-modal glass" id="generate-modal">
        <!-- Header -->
        <div class="generate-modal-header">
          <div class="generate-modal-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--accent-primary)" stroke-width="1.5"/>
              <circle cx="12" cy="12" r="4" fill="var(--accent-primary)" opacity="0.5"/>
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="var(--accent-primary)" stroke-width="1" opacity="0.4"/>
            </svg>
          </div>
          <h3 class="generate-modal-title">Generate Flashcard</h3>
          <p class="generate-modal-subtitle">Powered by Gemini AI</p>
        </div>

        <!-- API Key section (only shown if no key is configured) -->
        <div class="api-key-section ${hasApiKey ? 'api-key-hidden' : ''}" id="api-key-section">
          <div class="api-key-row">
            <input
              type="password"
              id="input-api-key"
              class="api-key-input"
              placeholder="Paste your Gemini API key"
              autocomplete="off"
            >
            <button class="btn btn-primary btn-sm" id="btn-save-key">Save</button>
          </div>
          <p class="api-key-hint">
            Your key is stored locally in your browser only.
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a key →</a>
          </p>
        </div>

        <!-- Word input -->
        <div class="generate-input-row">
          <input
            type="text"
            id="input-word"
            class="generate-word-input"
            placeholder="Enter a word (e.g. Serendipity)"
            autocomplete="off"
            ${!hasApiKey ? 'disabled' : ''}
          >
          <button
            class="btn btn-primary btn-generate ${!hasApiKey ? 'btn-disabled' : ''}"
            id="btn-generate"
            ${!hasApiKey ? 'disabled' : ''}
          >
            <span id="btn-generate-text">Generate</span>
            <span id="btn-generate-spinner" class="generate-spinner-hidden">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="spinner-svg">
                <circle cx="9" cy="9" r="7" stroke="rgba(0,0,0,0.3)" stroke-width="2"/>
                <path d="M9 2a7 0 0 1 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </span>
          </button>
        </div>

        <!-- Loading / status area -->
        <div class="generate-status" id="generate-status"></div>

        <!-- Footer actions -->
        <div class="generate-modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-form">Cancel</button>
          ${hasApiKey ? '' : `
          <button class="btn btn-ghost btn-sm" id="btn-toggle-key">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M7 1v2M7 11v2M1 7h2M11 7h2" stroke="currentColor" stroke-width="1"/>
            </svg>
            Set API Key
          </button>`}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // --- Event: Close on backdrop click ---
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeAddForm();
    });

    // --- Event: Close on Escape ---
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        _closeAddForm();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // --- Event: Cancel button ---
    overlay.querySelector('#btn-cancel-form')
      .addEventListener('click', _closeAddForm);

    // --- Event: Toggle API key visibility ---
    const btnToggleKey = overlay.querySelector('#btn-toggle-key');
    if (btnToggleKey) {
      btnToggleKey.addEventListener('click', () => {
        const section = document.getElementById('api-key-section');
        if (section) section.classList.toggle('api-key-hidden');
      });
    }

    // --- Event: Save API key ---
    const btnSaveKey = overlay.querySelector('#btn-save-key');
    if (btnSaveKey) {
      btnSaveKey.addEventListener('click', () => {
        const input = document.getElementById('input-api-key');
        const key = input ? input.value.trim() : '';
        if (!key) return;
        _saveApiKey(key);
        // Unlock the word input & generate button
        const wordInput = document.getElementById('input-word');
        const genBtn = document.getElementById('btn-generate');
        if (wordInput) wordInput.disabled = false;
        if (genBtn) {
          genBtn.disabled = false;
          genBtn.classList.remove('btn-disabled');
        }
        // Hide the API key section
        const section = document.getElementById('api-key-section');
        if (section) section.classList.add('api-key-hidden');
        // Focus the word input
        if (wordInput) wordInput.focus();
        _showStatus('success', 'API key saved. You\'re ready to generate!');
        setTimeout(() => _clearStatus(), 3000);
      });
    }

    // --- Event: Generate button ---
    const btnGenerate = overlay.querySelector('#btn-generate');
    if (btnGenerate) {
      btnGenerate.addEventListener('click', () => _handleGenerate(overlay));
    }

    // --- Event: Enter key in word input ---
    const wordInput = overlay.querySelector('#input-word');
    if (wordInput) {
      wordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _handleGenerate(overlay);
      });
    }

    // Focus the right input
    setTimeout(() => {
      if (hasApiKey) {
        const inp = overlay.querySelector('#input-word');
        if (inp) inp.focus();
      } else {
        const inp = overlay.querySelector('#input-api-key');
        if (inp) inp.focus();
      }
    }, 150);
  }

  /* ==========================================================
     HANDLE GENERATE (word → Gemini → card → active deck)
     ========================================================== */

  async function _handleGenerate(overlay) {
    if (_isGenerating) return;

    const wordInput = overlay.querySelector('#input-word');
    const word = wordInput ? wordInput.value.trim() : '';

    if (!word) {
      _showStatus('error', 'Please enter a word.');
      return;
    }

    // --- Enter loading state ---
    _isGenerating = true;
    _setGenerateLoading(overlay, true);
    _showStatus('loading', 'Fetching neural data…');

    try {
      const cardData = await _generateCardData(word);

      // Add card to the ACTIVE deck
      const deck = _getActiveDeck();
      if (deck) {
        deck.cards.push(cardData);
        _saveDecks();
        _currentIndex = deck.cards.length - 1;
      }

      // Success feedback
      _showStatus('success', `"${word}" added to your deck!`);

      // Close modal after a brief pause (so user sees success)
      setTimeout(() => {
        _closeAddForm();
        _renderApp(); // Go back to browse mode
      }, 600);

    } catch (err) {
      _isGenerating = false;
      _setGenerateLoading(overlay, false);

      switch (err.message) {
        case 'NO_API_KEY':
          _showStatus('error', 'Please set your Gemini API key first.');
          const section = document.getElementById('api-key-section');
          if (section) section.classList.remove('api-key-hidden');
          break;
        case 'INVALID_API_KEY':
          _showStatus('error', 'Invalid API key. Please check and try again.');
          break;
        case 'RATE_LIMITED':
          _showStatus('error', 'Rate limited. Please wait a moment and try again.');
          break;
        case 'EMPTY_RESPONSE':
          _showStatus('error', 'Gemini returned an empty response. Try a different word.');
          break;
        default:
          console.error('[Flashcard] Generate error:', err);
          _showStatus('error', 'Something went wrong. Check the console or try again.');
      }
    }
  }

  /* ==========================================================
     LOADING STATE HELPERS  (PRESERVED)
     ========================================================== */

  function _setGenerateLoading(overlay, isLoading) {
    const btnText    = overlay.querySelector('#btn-generate-text');
    const btnSpinner = overlay.querySelector('#btn-generate-spinner');
    const genBtn     = overlay.querySelector('#btn-generate');
    const wordInput  = overlay.querySelector('#input-word');

    if (isLoading) {
      if (btnText)    btnText.style.display = 'none';
      if (btnSpinner) btnSpinner.className = 'generate-spinner-active';
      if (genBtn)     genBtn.disabled = true;
      if (wordInput)  wordInput.disabled = true;
    } else {
      if (btnText)    btnText.style.display = '';
      if (btnSpinner) btnSpinner.className = 'generate-spinner-hidden';
      if (genBtn)     genBtn.disabled = false;
      if (wordInput)  wordInput.disabled = false;
    }
  }

  function _showStatus(type, message) {
    const el = document.getElementById('generate-status');
    if (!el) return;
    el.className = `generate-status status-${type}`;
    el.innerHTML = message;
  }

  function _clearStatus() {
    const el = document.getElementById('generate-status');
    if (el) { el.className = 'generate-status'; el.innerHTML = ''; }
  }

  /* ==========================================================
     CLOSE MODAL  (PRESERVED)
     ========================================================== */

  function _closeAddForm() {
    _isGenerating = false;
    const overlay = document.getElementById('add-card-overlay');
    if (overlay) overlay.remove();
  }

  /* ==========================================================
     CARD EDITOR MODAL — Universal (Manual Add + Edit)
     Glassmorphism modal for entering/editing card data.
     @param {Object|null} card — null for manual add; card object for edit
     ========================================================== */

  function _showCardEditorModal(card) {
    // Prevent multiple overlays
    if (document.getElementById('card-editor-overlay')) return;

    const isEdit = !!card;
    const title = isEdit ? 'Edit Card' : 'New Card';
    const subtitle = isEdit ? `Editing "${card.term}"` : 'Fill in the fields manually';

    const term = card ? card.term : '';
    const type = card ? card.type : '';
    const phonetic = card ? card.phonetic : '';
    const vietnamese = card ? card.vietnamese : '';
    const describe = card && card.describe ? card.describe.join('\n') : '';
    const examples = card && card.examples ? card.examples.join('\n') : '';
    const synonyms = card && card.synonyms ? card.synonyms.join(', ') : '';
    const note = card && card.note ? card.note.join('\n') : '';

    const overlay = document.createElement('div');
    overlay.id = 'card-editor-overlay';
    overlay.className = 'add-card-overlay';
    overlay.innerHTML = `
      <div class="card-editor-modal glass" id="card-editor-modal">
        <!-- Header -->
        <div class="generate-modal-header">
          <div class="generate-modal-icon">
            <span style="font-size:1.8rem;">${isEdit ? '✏️' : '📝'}</span>
          </div>
          <h3 class="generate-modal-title">${title}</h3>
          <p class="generate-modal-subtitle">${subtitle}</p>
        </div>

        <!-- Scrollable form body -->
        <div class="card-editor-body">
          <div class="card-editor-row">
            <div class="form-group" style="flex:2;">
              <label>Term *</label>
              <input type="text" id="ceditor-term" class="card-editor-input" value="${_esc(term)}" placeholder="e.g. Serendipity" autocomplete="off">
            </div>
            <div class="form-group" style="flex:1;">
              <label>Type / POS</label>
              <input type="text" id="ceditor-type" class="card-editor-input" value="${_esc(type)}" placeholder="e.g. (n), (adj)" autocomplete="off">
            </div>
          </div>

          <div class="card-editor-row">
            <div class="form-group" style="flex:1;">
              <label>Phonetic</label>
              <input type="text" id="ceditor-phonetic" class="card-editor-input" value="${_esc(phonetic)}" placeholder="e.g. /ˌser.ənˈdɪp.ə.ti/" autocomplete="off">
            </div>
            <div class="form-group" style="flex:1;">
              <label>Vietnamese Meaning</label>
              <input type="text" id="ceditor-vietnamese" class="card-editor-input" value="${_esc(vietnamese)}" placeholder="e.g. sự tình cờ may mắn" autocomplete="off">
            </div>
          </div>

          <div class="form-group">
            <label>Definition</label>
            <textarea id="ceditor-describe" class="card-editor-textarea" rows="2" placeholder="One definition per line">${_esc(describe)}</textarea>
          </div>

          <div class="form-group">
            <label>Examples</label>
            <textarea id="ceditor-examples" class="card-editor-textarea" rows="2" placeholder="One example sentence per line">${_esc(examples)}</textarea>
          </div>

          <div class="form-group">
            <label>Synonyms</label>
            <input type="text" id="ceditor-synonyms" class="card-editor-input" value="${_esc(synonyms)}" placeholder="Comma-separated, e.g. chance, fortune, luck" autocomplete="off">
          </div>

          <div class="form-group">
            <label>Usage Notes</label>
            <textarea id="ceditor-note" class="card-editor-textarea" rows="2" placeholder="One usage note per line">${_esc(note)}</textarea>
          </div>
        </div>

        <!-- Footer actions -->
        <div class="generate-modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-editor">Cancel</button>
          <button class="btn btn-primary" id="btn-save-card">Save Card</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // --- Close on backdrop click ---
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeCardEditorModal();
    });

    // --- Close on Escape ---
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        _closeCardEditorModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // --- Cancel button ---
    overlay.querySelector('#btn-cancel-editor')
      .addEventListener('click', _closeCardEditorModal);

    // --- Save button ---
    overlay.querySelector('#btn-save-card')
      .addEventListener('click', () => _handleSaveCard(overlay, card));

    // --- Ctrl+Enter to save ---
    overlay.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        _handleSaveCard(overlay, card);
      }
    });

    // Focus first input
    setTimeout(() => {
      const inp = overlay.querySelector('#ceditor-term');
      if (inp) inp.focus();
    }, 150);
  }

  function _closeCardEditorModal() {
    const overlay = document.getElementById('card-editor-overlay');
    if (overlay) overlay.remove();
  }

  function _handleSaveCard(overlay, existingCard) {
    const isEdit = !!existingCard;

    // --- Read form values ---
    const term = (overlay.querySelector('#ceditor-term')?.value || '').trim();
    if (!term) {
      // Highlight the term input
      const termInput = overlay.querySelector('#ceditor-term');
      if (termInput) {
        termInput.style.borderColor = 'var(--danger)';
        termInput.focus();
        setTimeout(() => { termInput.style.borderColor = ''; }, 2000);
      }
      return;
    }

    const typeVal       = (overlay.querySelector('#ceditor-type')?.value || '').trim();
    const phoneticVal   = (overlay.querySelector('#ceditor-phonetic')?.value || '').trim();
    const vietnameseVal = (overlay.querySelector('#ceditor-vietnamese')?.value || '').trim();
    const describeRaw   = (overlay.querySelector('#ceditor-describe')?.value || '').trim();
    const examplesRaw   = (overlay.querySelector('#ceditor-examples')?.value || '').trim();
    const synonymsRaw   = (overlay.querySelector('#ceditor-synonyms')?.value || '').trim();
    const noteRaw       = (overlay.querySelector('#ceditor-note')?.value || '').trim();

    // --- Build the card fields ---
    const cardFields = {
      term: term,
      type: typeVal,
      phonetic: phoneticVal,
      vietnamese: vietnameseVal,
      describe: describeRaw ? describeRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
      examples: examplesRaw ? examplesRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
      synonyms: synonymsRaw ? synonymsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
      note: noteRaw ? noteRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
      word_family: existingCard ? (existingCard.word_family || {}) : {},
      idioms: existingCard ? (existingCard.idioms || []) : [],
      collocations: existingCard ? (existingCard.collocations || []) : []
    };

    if (isEdit) {
      // --- Edit mode: preserve SRS progress ---
      const deck = _getActiveDeck();
      if (!deck) { _closeCardEditorModal(); return; }
      deck.cards[_currentIndex] = {
        ...existingCard,
        ...cardFields
      };
    } else {
      // --- Manual Add mode: new card with SRS defaults ---
      const deck = _getActiveDeck();
      if (!deck) { _closeCardEditorModal(); return; }
      const newCard = {
        ...cardFields,
        repetition: 0,
        interval: 0,
        easeFactor: 2.5,
        nextReviewDate: Date.now()
      };
      deck.cards.push(newCard);
      _currentIndex = deck.cards.length - 1;
    }

    _saveDecks();
    _closeCardEditorModal();
    _renderApp();
  }

  /* ==========================================================
     UTILITY: Escape HTML to prevent XSS
     ========================================================== */

  function _esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /**
   * Normalize a card object to the new Gemini-compatible format
   * AND ensure SRS fields are present (migration).
   * Handles migration of old-format cards and adds SRS defaults.
   */
  function _normalizeCard(card) {
    // --- SRS defaults (for migration of existing cards) ---
    const srsDefaults = {
      repetition: (typeof card.repetition === 'number') ? card.repetition : 0,
      interval: (typeof card.interval === 'number') ? card.interval : 0,
      easeFactor: (typeof card.easeFactor === 'number') ? card.easeFactor : 2.5,
      nextReviewDate: (typeof card.nextReviewDate === 'number') ? card.nextReviewDate : Date.now()
    };

    // If the card already has 'describe' as an array, it's likely
    // already in the new format — just ensure arrays are arrays
    if (Array.isArray(card.describe)) {
      return {
        term: card.term || '',
        type: card.type || card.pos || '',
        phonetic: card.phonetic || '',
        vietnamese: card.vietnamese || '',
        describe: _ensureArray(card.describe),
        examples: _ensureArray(card.examples),
        note: _ensureArray(card.note),
        synonyms: _ensureArray(card.synonyms),
        word_family: card.word_family || {},
        idioms: _ensureArray(card.idioms),
        collocations: _ensureArray(card.collocations),
        ...srsDefaults
      };
    }

    // --- Migrate old format → new format ---
    const describe = card.definition
      ? [card.definition]
      : [];

    const synonyms = card.synonyms
      ? (typeof card.synonyms === 'string'
          ? card.synonyms.split(',').map(s => s.trim()).filter(Boolean)
          : _ensureArray(card.synonyms))
      : [];

    const idioms = card.idiom
      ? [card.idiom]
      : [];

    return {
      term: card.term || '',
      type: card.pos || card.type || '',
      phonetic: '',
      vietnamese: '',
      describe,
      examples: [],
      note: [],
      synonyms,
      word_family: {},
      idioms,
      collocations: [],
      ...srsDefaults
    };
  }

  // --- Public API (module contract) ---
  return {
    id: 'flashcards',
    name: 'Flashcards',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <line x1="3" y1="8" x2="17" y2="8" stroke="currentColor" stroke-width="1.5"/>
      <line x1="7" y1="4" x2="7" y2="8" stroke="currentColor" stroke-width="1.5"/>
      <line x1="13" y1="4" x2="13" y2="8" stroke="currentColor" stroke-width="1.5"/>
    </svg>`,
    render,
    destroy
  };

})();

// Auto-register with the app router
if (typeof app !== 'undefined') {
  app.register(flashcardModule);
}