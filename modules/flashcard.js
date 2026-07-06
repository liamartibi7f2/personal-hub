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
  let _pageUnloading  = false;      // Prevents ghost saves during page reload

  // --- SRS state ---
  let _mode           = 'library';  // 'library' | 'study' | 'browse'
  let _studyQueue     = [];         // Array of card indices for current study session
  let _sessionStats   = null;       // { reviewed: 0, correct: 0, hard: 0, again: 0, started: timestamp }
  let _cardFlipped    = false;      // Whether the card is flipped in study mode

  // --- AI Settings state ---
  let _aiSchema       = [];
  let _voiceSpeed     = 0.9;
  let _isFlashcardSettingsLoaded = false;

  // --- UI State ---
  let _activeVault    = 'en';        // Which vault panel is visible: 'en' | 'zh'
  let _systemLanguage = 'en';        // Global UI language: 'en' | 'vi'

  // --- i18n Dictionary ---
  const I18N = {
    // Sidebar nav items (app.js registers these, but we update them post-render)
    sidebar: {
      dashboard:  { en: 'Dashboard',  vi: 'Bảng Điều Khiển' },
      flashcards: { en: 'Flashcards', vi: 'Thẻ Ghi Nhớ' },
      pomodoro:   { en: 'Pomodoro',   vi: 'Đồng Hồ Pomodoro' },
      quiz:       { en: 'Quiz',       vi: 'Câu Đố' },
      'focus-vibe': { en: 'Focus Vibe', vi: 'Nhạc Tập Trung' },
      notes:      { en: 'Notes',      vi: 'Ghi Chú' }
    },
    // Dashboard strings
    dash: {
      greetingMorning:   { en: 'Good Morning, Commander.',   vi: 'Chào Buổi Sáng, Chỉ Huy.' },
      greetingAfternoon: { en: 'Good Afternoon, Commander.', vi: 'Chào Buổi Chiều, Chỉ Huy.' },
      greetingEvening:   { en: 'Good Evening, Commander.',   vi: 'Chào Buổi Tối, Chỉ Huy.' },
      commandCenter:     { en: 'Command Center',             vi: 'Trung Tâm Điều Khiển' },
      quickLaunch:       { en: 'Quick Launch',               vi: 'Khởi Động Nhanh' },
      focusProductivity: { en: 'Focus & Productivity',       vi: 'Tập Trung & Năng Suất' },
      totalFocusTime:    { en: 'Total Focus Time',           vi: 'Tổng Thời Gian Tập Trung' },
      dayStreak:         { en: 'Day Streak',                 vi: 'Chuỗi Ngày' },
      noFocusSessions:   { en: 'No focus sessions yet',      vi: 'Chưa có phiên tập trung nào' },
      enterFocusMode:    { en: 'Enter Focus Mode',           vi: 'Vào Chế Độ Tập Trung' },
      flashcardSRS:      { en: 'Flashcard SRS',              vi: 'Thẻ Ghi Nhớ SRS' },
      totalCards:        { en: 'Total Cards',                vi: 'Tổng Số Thẻ' },
      cardsDueToday:     { en: 'Cards Due Today',            vi: 'Thẻ Đến Hạn Hôm Nay' },
      noFlashcardsYet:   { en: 'No flashcards yet',          vi: 'Chưa có thẻ ghi nhớ nào' },
      reviewDueCards:    { en: 'Review Due Cards',           vi: 'Ôn Tập Thẻ Đến Hạn' },
      quizKnowledge:     { en: 'Quiz & Knowledge Base',      vi: 'Câu Đố & Kiến Thức' },
      quizDecks:         { en: 'Quiz Decks',                 vi: 'Bộ Câu Đố' },
      totalQuestions:    { en: 'Total Questions',            vi: 'Tổng Số Câu Hỏi' },
      noQuizDecks:       { en: 'No quiz decks yet',          vi: 'Chưa có bộ câu đố nào' },
      takeQuiz:          { en: 'Take a Quiz',                vi: 'Làm Câu Đố' },
      flashcardsLaunch:  { en: 'Flashcards',                 vi: 'Thẻ Ghi Nhớ' },
      studyVocab:        { en: 'Study vocabulary with 3D flip cards', vi: 'Học từ vựng với thẻ lật 3D' },
      pomodoroLaunch:    { en: 'Pomodoro',                   vi: 'Đồng Hồ Pomodoro' },
      focusTimer:        { en: 'Focus timer with progress tracking', vi: 'Đồng hồ tập trung với theo dõi tiến độ' },
      quizLaunch:        { en: 'Quiz',                       vi: 'Câu Đố' },
      mcChallenge:       { en: 'Multiple-choice challenge mode', vi: 'Chế độ thử thách trắc nghiệm' }
    },
    // Flashcard UI strings
    fc: {
      deckLibrary:      { en: 'Deck Library',               vi: 'Thư Viện Bộ Thẻ' },
      cardsDue:         { en: 'due',                        vi: 'đến hạn' },
      enVaultLabel:     { en: 'ENGLISH VAULT',              vi: 'KHO TIẾNG ANH' },
      zhVaultLabel:     { en: 'MANDARIN VAULT',             vi: 'KHO TIẾNG TRUNG' },
      enVaultEmpty:     { en: 'No English decks yet. Click "+ Create New Deck" to start building your vocabulary collection.', vi: 'Chưa có bộ thẻ tiếng Anh nào. Nhấn "+ Tạo Bộ Thẻ Mới" để bắt đầu.' },
      zhVaultEmpty:     { en: 'No Mandarin decks yet. Click "+ Create New Deck" to start building your 中文 collection.', vi: 'Chưa có bộ thẻ tiếng Trung nào. Nhấn "+ Tạo Bộ Thẻ Mới" để bắt đầu.' },
      createNewDeck:    { en: 'Create New Deck',            vi: 'Tạo Bộ Thẻ Mới' },
      noDecksYet:       { en: 'No decks yet',               vi: 'Chưa có bộ thẻ nào' },
      createFirstDeck:  { en: 'Create Your First Deck',     vi: 'Tạo Bộ Thẻ Đầu Tiên' },
      getStarted:       { en: 'Create your first flashcard deck to get started.', vi: 'Tạo bộ thẻ ghi nhớ đầu tiên để bắt đầu.' },
      studyDue:         { en: 'Study Due',                  vi: 'Ôn Tập Đến Hạn' },
      browseEdit:       { en: 'Browse / Edit',              vi: 'Duyệt / Sửa' },
      totalCardsLabel:  { en: 'Total Cards',                vi: 'Tổng Số Thẻ' },
      dueForReview:     { en: 'Due for Review',             vi: 'Đến Hạn Ôn Tập' },
      chooseLang:       { en: 'Choose Language',            vi: 'Chọn Ngôn Ngữ' },
      selectLangDesc:   { en: 'Select the language for your new flashcard deck', vi: 'Chọn ngôn ngữ cho bộ thẻ ghi nhớ mới' },
      englishDesc:      { en: 'Vocabulary, IELTS, TOEFL, idioms, collocations & more', vi: 'Từ vựng, IELTS, TOEFL, thành ngữ, cụm từ & hơn thế nữa' },
      mandarinDesc:     { en: '汉字, pinyin, HSK levels, grammar patterns & radicals', vi: 'Chữ Hán, bính âm, cấp độ HSK, ngữ pháp & bộ thủ' },
      nameYourDeck:     { en: 'Name Your Deck',             vi: 'Đặt Tên Bộ Thẻ' },
      creatingDeck:     { en: 'Creating a',                 vi: 'Đang tạo bộ thẻ' },
      changeLang:       { en: '↩ Change',                   vi: '↩ Đổi' },
      enterDeckTitle:   { en: 'Please enter a deck title.', vi: 'Vui lòng nhập tên bộ thẻ.' },
      createDeckBtn:    { en: 'Create Deck',                vi: 'Tạo Bộ Thẻ' },
      cancelBtn:        { en: 'Cancel',                     vi: 'Hủy' },
      closeBtn:         { en: 'Close',                      vi: 'Đóng' },
      advancedAISettings: { en: 'Advanced AI Settings',     vi: 'Cài Đặt AI Nâng Cao' },
      customizeAIPrompt:  { en: 'Customize the AI prompt fields for auto-generated cards', vi: 'Tùy chỉnh các trường prompt AI cho thẻ tạo tự động' },
      promptFields:     { en: 'Prompt Fields',              vi: 'Trường Prompt' },
      voiceSpeed:       { en: 'Voice Speed',                vi: 'Tốc Độ Giọng Nói' },
      adjustTTS:        { en: 'Adjust the TTS reading speed (default: 0.9x)', vi: 'Điều chỉnh tốc độ đọc TTS (mặc định: 0.9x)' },
      addCustomField:   { en: 'Add Custom Field',           vi: 'Thêm Trường Tùy Chỉnh' },
      fieldId:          { en: 'Field ID',                   vi: 'Mã Trường' },
      fieldName:        { en: 'Field Name',                 vi: 'Tên Trường' },
      aiInstruction:    { en: 'AI Instruction',             vi: 'Hướng Dẫn AI' },
      addFieldBtn:      { en: '+ Add Field',                vi: '+ Thêm Trường' },
      noCustomFields:   { en: 'No custom fields defined.',  vi: 'Chưa có trường tùy chỉnh nào.' },
      systemLanguage:   { en: 'System Language',            vi: 'Ngôn Ngữ Hệ Thống' },
      systemLangDesc:   { en: 'Choose the interface language for Hub.OS', vi: 'Chọn ngôn ngữ giao diện cho Hub.OS' },
      fieldIdRequired:  { en: 'Please enter a Field ID.',   vi: 'Vui lòng nhập Mã Trường.' },
      fieldNameRequired:{ en: 'Please enter a Field Name.', vi: 'Vui lòng nhập Tên Trường.' },
      fieldPromptRequired: { en: 'Please enter an AI Instruction.', vi: 'Vui lòng nhập Hướng Dẫn AI.' },
      fieldExists:      { en: 'A field with ID "X" already exists.', vi: 'Trường có mã "X" đã tồn tại.' },
      // ── Mandarin Architect Access (ZH vault empty state) ──
      zhNeuralTitle:   { en: 'NEURAL INTERFACE: PENDING CONFIGURATION', vi: 'GIAO DIỆN THẦN KINH: ĐANG CHỜ CẤU HÌNH' },
      zhSystemStatus:   { en: 'System Status: Waiting for Linguistic Architect...', vi: 'Trạng Thái Hệ Thống: Đang Chờ Kiến Trúc Sư Ngôn Ngữ...' },
      zhBlueprintTitle: { en: 'STRUCTURE BLUEPRINT', vi: 'BẢN THIẾT KẾ CẤU TRÚC' },
      zhStructureType:  { en: 'STRUCTURE_TYPE: ?', vi: 'LOẠI_CẤU_TRÚC: ?' },
      zhPhoneticEngine: { en: 'PHONETIC_ENGINE: Pinyin / Bopomofo / Audio Only?', vi: 'CÔNG_CỤ_PHÁT_ÂM: Bính Âm / Chú Âm / Chỉ Âm Thanh?' },
      zhStudyMethod:    { en: 'STUDY_METHOD: Cloze / Matching / Writing?', vi: 'PHƯƠNG_PHÁP_HỌC: Điền Khuyết / Ghép Cặp / Viết?' },
      zhHskLevel:       { en: 'HSK_LEVEL_TARGET: ?', vi: 'MỤC_TIÊU_HSK: ?' },
      zhCharSet:        { en: 'CHARACTER_SET: Simplified / Traditional / Both?', vi: 'BỘ_CHỮ: Giản Thể / Phồn Thể / Cả Hai?' },
      zhFieldNote1:     { en: 'Configure the schema fields above to define how AI generates Mandarin cards. Each field maps to a data slot on every flashcard.', vi: 'Cấu hình các trường schema ở trên để xác định cách AI tạo thẻ tiếng Trung. Mỗi trường ánh xạ tới một slot dữ liệu trên mỗi thẻ.' },
      zhFieldNote2:     { en: 'Default fields: phonetic (pinyin), synonym (similar words), hsk_level, radical. Edit in Advanced AI Settings → Prompt Fields.', vi: 'Trường mặc định: phonetic (bính âm), synonym (từ đồng nghĩa), hsk_level, radical. Chỉnh sửa trong Cài Đặt AI Nâng Cao → Trường Prompt.' },
      zhProposeBtn:     { en: 'PROPOSE NEW STRUCTURE', vi: 'ĐỀ XUẤT CẤU TRÚC MỚI' },
      zhProposeHint:    { en: 'Invite a linguistic partner to help design the flashcard schema', vi: 'Mời một đối tác ngôn ngữ để cùng thiết kế schema thẻ ghi nhớ' },
      zhQuickStartBtn:  { en: 'Quick Start: Create Empty Deck', vi: 'Bắt Đầu Nhanh: Tạo Bộ Thẻ Trống' },
      zhQuickStartHint: { en: 'Skip the blueprint — start with defaults and iterate later', vi: 'Bỏ qua bản thiết kế — bắt đầu với mặc định và điều chỉnh sau' }
    }
  };

  /**
   * Resolve an i18n string from the dictionary.
   * @param {string} section - e.g. 'dash', 'fc', 'sidebar'
   * @param {string} key - the key within that section
   * @returns {string} localized string
   */
  function _(section, key) {
    var sec = I18N[section];
    if (!sec) return key;
    var entry = sec[key];
    if (!entry) return key;
    return entry[_systemLanguage] || entry['en'] || key;
  }

  /**
   * Walk the DOM and update all i18n-annotated elements.
   * Elements with `data-i18n="section.key"` get their textContent replaced.
   * Elements with `data-i18n-placeholder="section.key"` get placeholder replaced.
   * Sidebar nav items are matched by data-module-id.
   */
  function applyLanguage(lang) {
    _systemLanguage = lang || 'en';

    // --- Sidebar nav items ---
    var navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(function (btn) {
      var moduleId = btn.dataset.moduleId;
      if (moduleId && I18N.sidebar[moduleId]) {
        var label = I18N.sidebar[moduleId][_systemLanguage] || I18N.sidebar[moduleId]['en'];
        // The nav item has <span class="nav-icon">...</span><span>TEXT</span>
        var textSpan = btn.querySelector('span:last-child');
        if (textSpan) textSpan.textContent = label;
      }
    });

    // --- Dashboard elements ---
    // Update greeting (special: depends on time of day)
    if (typeof dashboardModule !== 'undefined' && dashboardModule._updateClock) {
      dashboardModule._updateClock();
    }
    // Update section headers, widget titles, stat labels
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var parts = (el.dataset.i18n || '').split('.');
      if (parts.length === 2) {
        var sec = I18N[parts[0]];
        if (sec && sec[parts[1]]) {
          el.textContent = sec[parts[1]][_systemLanguage] || sec[parts[1]]['en'] || el.textContent;
        }
      }
    });
    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var parts = (el.dataset.i18nPlaceholder || '').split('.');
      if (parts.length === 2) {
        var sec = I18N[parts[0]];
        if (sec && sec[parts[1]]) {
          el.placeholder = sec[parts[1]][_systemLanguage] || sec[parts[1]]['en'] || el.placeholder;
        }
      }
    });

    // --- Flashcard sections that may be currently rendered ---
    var fcContainer = document.querySelector('.flashcard-app');
    if (fcContainer) {
      // Update vault tab labels
      var enTab = fcContainer.querySelector('#vault-tab-en');
      var zhTab = fcContainer.querySelector('#vault-tab-zh');
      if (enTab) enTab.textContent = _('fc', 'enVaultLabel');
      if (zhTab) zhTab.textContent = _('fc', 'zhVaultLabel');
      // Update section header
      var libHeader = fcContainer.querySelector('.flashcard-header .section-header');
      if (libHeader) libHeader.textContent = '📚 ' + _('fc', 'deckLibrary');
      // Update create button
      var createBtn = fcContainer.querySelector('#btn-create-deck');
      if (createBtn) {
        createBtn.innerHTML = '<span style="font-size:1.1rem;">+</span> ' + _('fc', 'createNewDeck');
      }
      // Update deck card action buttons
      fcContainer.querySelectorAll('.deck-play-btn').forEach(function (btn) {
        btn.childNodes.forEach(function (node) {
          if (node.nodeType === 3 && node.textContent.trim() === 'Study Due') {
            node.textContent = ' ' + _('fc', 'studyDue');
          }
        });
      });
      fcContainer.querySelectorAll('.deck-browse-btn').forEach(function (btn) {
        btn.textContent = _('fc', 'browseEdit');
      });
      // Update deck card meta labels
      fcContainer.querySelectorAll('.deck-card-meta').forEach(function (meta) {
        var html = meta.innerHTML;
        html = html.replace(/Total Cards:/g, _('fc', 'totalCardsLabel') + ':');
        html = html.replace(/Due for Review:/g, _('fc', 'dueForReview') + ':');
        meta.innerHTML = html;
      });
      // Update "due" text in header
      var headerSpan = fcContainer.querySelector('.flashcard-header span');
      if (headerSpan) {
        var txt = headerSpan.textContent;
        if (txt && txt.indexOf('due') !== -1) {
          headerSpan.textContent = txt.replace(/\bdue\b/g, _('fc', 'cardsDue'));
        }
      }
    }

    // --- Persist preference ---
    try {
      localStorage.setItem('hub_system_language', _systemLanguage);
    } catch (_) {}
  }

  /**
   * Load system language from settings or localStorage fallback.
   */
  function _loadSystemLanguage() {
    try {
      var local = localStorage.getItem('hub_system_language');
      if (local === 'en' || local === 'vi') {
        _systemLanguage = local;
      }
    } catch (_) {}
  }

  
  // Default AI schema (used when no cloud data exists)
  const DEFAULT_AI_SCHEMA = [
    { id: 'phonetic', name: 'Phonetic', prompt: 'Provide the IPA phonetic transcription.', isDeletable: false },
    { id: 'synonym', name: 'Synonym', prompt: 'Provide 2-3 common synonyms.', isDeletable: true }
  ];

  // --- Default starter cards (new Gemini-compatible format) ---

  // ── Ghost save guard ──
  // The moment the browser starts unloading (page reload / tab close),
  // mark _pageUnloading so no async save callback will fire a write.
  window.addEventListener('beforeunload', function () {
    _pageUnloading = true;
  });

  /* ==========================================================
     RENDER / DESTROY (module contract)
     ========================================================== */

  async function render(container) {
    _container = container;

    // 1) Show loading state immediately
    container.innerHTML =
      '<div class="tab-content flashcard-app" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
        '<div class="hub-notes-loading" style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem">' +
          '<span class="hub-notes-loading-dot">●</span> Loading flashcards...' +
        '</div>' +
      '</div>';

    console.log("[Flashcard] render() — checking auth & loading decks");

    // 2) Wait for Firebase auth to settle before attempting to fetch
    //    This prevents a race condition where the decks firestore query
    //    fires before onAuthStateChanged has populated the user.
    if (typeof HubDB !== 'undefined' && HubDB.waitForReady) {
      console.log("[Flashcard] Waiting for HubDB auth ready...");
      await HubDB.waitForReady();
      var authStatus = HubDB.getAuthStatus();
      console.log("[Flashcard] Auth ready — loggedIn:", authStatus.loggedIn, "uid:", authStatus.uid);
    }

    // 3) Await data (async — may hit Firestore)
    await _loadDecksAsync();

    // 4) Load AI settings from Firebase (async — uses load guard, loads systemLanguage)
    await _loadAISettingsAsync();

    // 5) Apply the loaded system language to the entire UI
    applyLanguage(_systemLanguage);

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
    // Clean up all global keyboard listeners to prevent leak/accumulation
    if (window._hubFlashcardBrowseKeyHandler) {
      document.removeEventListener('keydown', window._hubFlashcardBrowseKeyHandler);
      delete window._hubFlashcardBrowseKeyHandler;
    }
    if (window._hubFlashcardSpaceHandler) {
      document.removeEventListener('keydown', window._hubFlashcardSpaceHandler);
      delete window._hubFlashcardSpaceHandler;
    }
    if (window._hubFlashcardNumberHandler) {
      document.removeEventListener('keydown', window._hubFlashcardNumberHandler);
      delete window._hubFlashcardNumberHandler;
    }
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

  /**
   * Load decks from HubDB (Firestore when online + authenticated,
   * fallback to localStorage otherwise).
   */
  async function _loadDecksAsync() {
    console.log("[Flashcard] _loadDecksAsync() — fetching decks from HubDB...");
    var authCheck = HubDB.getAuthStatus();
    console.log("[Flashcard] Auth status at load time — loggedIn:", authCheck.loggedIn, "uid:", authCheck.uid);
    try {
      const data = await HubDB.loadFlashcardsData();
      console.log("[Flashcard] _loadDecksAsync() — HubDB returned:", data ? (data.decks ? data.decks.length + " decks" : "no decks key") : "null");
      if (data && Array.isArray(data.decks)) {
        if (data.decks.length > 0) {
          if (data.decks[0].cards !== undefined) {
            _decks = data.decks.map(function (deck) {
              return {
                id: deck.id || ('deck_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)),
                title: deck.title || 'Untitled Deck',
                language: deck.language || 'en', // Fallback: old decks default to English
                cards: (deck.cards || []).map(_normalizeCard)
              };
            });
          } else if (data.decks[0].term !== undefined) {
            // Legacy flat card array — migrate into a single deck
            _decks = [{
              id: 'deck_migrated_' + Date.now(),
              title: 'My Cards',
              language: 'en',
              cards: data.decks.map(_normalizeCard)
            }];
            await HubDB.saveFlashcardsData({ decks: _decks });
          } else {
            _decks = [];
          }
        } else {
          _decks = [];
        }
      } else {
        _decks = [];
      }
    } catch (_) {
      _decks = [];
    }
  }

  /**
   * Save decks to HubDB (Firestore when online, localStorage fallback).
   * Fire-and-forget wrapper for callers that don't need to await.
   */
  function _saveDecks() {
    if (_pageUnloading) return; // Prevent ghost saves during page reload
    // Fire-and-forget: the async save is handled internally;
    // we don't need UI to block on it.
    HubDB.saveFlashcardsData({ decks: _decks }).catch(function () {});
  }

  /* ==========================================================
     AI SETTINGS — Load, Save, Sync, and UI Modal
     ========================================================== */

  /**
   * Load AI settings from HubDB (Firestore or localStorage).
   * Uses a load guard to prevent overwriting cloud data with empty state.
   */
  async function _loadAISettingsAsync() {
    try {
      var settings = await HubDB.loadFlashcardSettings();
      if (settings) {
        if (settings.schema && settings.schema.length > 0) {
          _aiSchema = settings.schema;
        } else {
          _aiSchema = DEFAULT_AI_SCHEMA.map(function (s) { return { ...s }; });
        }
        if (typeof settings.voiceSpeed === 'number') {
          _voiceSpeed = settings.voiceSpeed;
        } else {
          _voiceSpeed = 0.9;
        }
        // Load system language from cloud settings
        if (settings.systemLanguage === 'en' || settings.systemLanguage === 'vi') {
          _systemLanguage = settings.systemLanguage;
        } else {
          _loadSystemLanguage(); // fallback to localStorage
        }
      } else {
        _aiSchema = DEFAULT_AI_SCHEMA.map(function (s) { return { ...s }; });
        _voiceSpeed = 0.9;
        _loadSystemLanguage();
        await HubDB.saveFlashcardSettings({ schema: _aiSchema, voiceSpeed: _voiceSpeed, systemLanguage: _systemLanguage });
      }
    } catch (_) {
      _aiSchema = DEFAULT_AI_SCHEMA.map(function (s) { return { ...s }; });
      _voiceSpeed = 0.9;
      _loadSystemLanguage();
    }
    _isFlashcardSettingsLoaded = true;
  }

  /**
   * Save the current AI schema to HubDB.
   * Only writes if the load guard is active.
   */
  function _saveAISettings() {
    if (!_isFlashcardSettingsLoaded) return;
    HubDB.saveFlashcardSettings({ schema: _aiSchema, voiceSpeed: _voiceSpeed, systemLanguage: _systemLanguage }).catch(function () {});
  }

  /**
   * Build a dynamic AI instruction prompt for the given word
   * based on the current schema fields.
   */
  function buildAIPrompt(targetWord, currentSchema) {
    var schema = currentSchema || _aiSchema;
    if (!schema || schema.length === 0) {
      schema = DEFAULT_AI_SCHEMA;
    }

    var fieldInstructions = schema.map(function (field) {
      return '    "' + field.id + '": ' + field.prompt;
    }).join(',\n');

    var prompt = 'You are an English vocabulary tutor. Return ONLY valid JSON for the word \'' + targetWord + '\'.\n' +
      'Keys: type, vietnamese, describe, examples, note, word_family, idioms, collocations, clozeSentence' +
      (schema.length > 0 ? ', ' + schema.map(function (f) { return f.id; }).join(', ') : '') + '.\n' +
      '- type: short part of speech in parentheses (n), (v), (adj), (adv)\n' +
      '- vietnamese: concise Vietnamese meaning\n' +
      '- describe: RETURN A LIST of distinct short meanings (each <= 12 words)\n' +
      '- examples: RETURN A LIST of 2 short example sentences (natural, correct context)\n' +
      '- note: return EXACTLY 3 short bullet points (<=15 words each) about common mistakes/confusions.\n' +
      '- synonyms: up to 5\n' +
      '- word_family: include forms with POS\n' +
      '- idioms: return up to 2 idioms or set phrases using the word.\n' +
      '- collocations: return 5 natural collocations\n' +
      '- clozeSentence: A natural English example sentence. You MUST replace the target vocabulary word in this sentence with EXACTLY three underscores: "___"';

    if (schema.length > 0) {
      prompt += '\n\nAdditional fields:\n' + fieldInstructions;
    }

    prompt += '\n\nReturn ONLY a valid JSON object. Do NOT wrap it in markdown code blocks. Do NOT include any text outside the JSON.';

    return prompt;
  }

  /* ==========================================================
     ADVANCED AI SETTINGS MODAL
     ========================================================== */

  function _showAISettingsModal() {
    if (document.getElementById('flashcard-ai-settings-overlay')) return;

    var fieldsHtml = _aiSchema.map(function (field, index) {
      var delBtn = field.isDeletable
        ? '<button class="hub-flashcard-ai-del-btn" data-index="' + index + '" title="Delete field">&times;</button>'
        : '';
      return '' +
        '<div class="hub-flashcard-ai-field-row">' +
          '<div class="hub-flashcard-ai-field-info">' +
            '<span class="hub-flashcard-ai-field-id">' + _esc(field.id) + '</span>' +
            '<span class="hub-flashcard-ai-field-name">' + _esc(field.name) + '</span>' +
            '<span class="hub-flashcard-ai-field-prompt">' + _esc(field.prompt) + '</span>' +
          '</div>' +
          delBtn +
        '</div>';
    }).join('') || '<p class="hub-flashcard-ai-empty">' + _('fc', 'noCustomFields') + '</p>';

    var overlay = document.createElement('div');
    overlay.id = 'flashcard-ai-settings-overlay';
    overlay.className = 'add-card-overlay';
    overlay.innerHTML = '' +
      '<div class="hub-flashcard-ai-modal glass">' +
        '<div class="generate-modal-header">' +
          '<div class="generate-modal-icon">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
              '<path d="M12 2L2 7l10 5 10-5-10-5z" stroke="var(--accent-secondary)" stroke-width="1.5" stroke-linejoin="round"/>' +
              '<path d="M2 17l10 5 10-5" stroke="var(--accent-secondary)" stroke-width="1.5" stroke-linejoin="round" opacity="0.6"/>' +
              '<path d="M2 12l10 5 10-5" stroke="var(--accent-secondary)" stroke-width="1.5" stroke-linejoin="round" opacity="0.4"/>' +
            '</svg>' +
          '</div>' +
          '<h3 class="generate-modal-title">' + _('fc', 'advancedAISettings') + '</h3>' +
          '<p class="generate-modal-subtitle">' + _('fc', 'customizeAIPrompt') + '</p>' +
        '</div>' +

        '<div class="hub-flashcard-ai-body">' +

          '<div class="hub-flashcard-ai-section">' +
            '<h4 class="hub-flashcard-ai-section-title">' + _('fc', 'promptFields') + '</h4>' +
            '<div class="hub-flashcard-ai-field-list">' +
              fieldsHtml +
            '</div>' +
          '</div>' +

          '<div class="hub-flashcard-ai-section">' +
            '<h4 class="hub-flashcard-ai-section-title">' + _('fc', 'voiceSpeed') + '</h4>' +
            '<div class="hub-flashcard-voice-speed-row">' +
              '<span class="hub-flashcard-voice-speed-label">0.5x</span>' +
              '<div class="hub-flashcard-voice-speed-track">' +
                '<input type="range" id="hub-voice-speed-range" ' +
                  'min="0.5" max="1.5" step="0.1" value="' + _voiceSpeed + '" ' +
                  'class="hub-flashcard-voice-speed-slider">' +
                '<span class="hub-flashcard-voice-speed-value" id="hub-voice-speed-display">' + _voiceSpeed.toFixed(1) + 'x</span>' +
              '</div>' +
              '<span class="hub-flashcard-voice-speed-label">1.5x</span>' +
            '</div>' +
            '<p class="hub-flashcard-voice-speed-hint">' + _('fc', 'adjustTTS') + '</p>' +
          '</div>' +

          '<div class="hub-flashcard-ai-section">' +
            '<h4 class="hub-flashcard-ai-section-title">' + _('fc', 'addCustomField') + '</h4>' +
            '<div class="hub-flashcard-ai-form">' +
              '<div class="hub-flashcard-ai-form-row">' +
                '<div class="hub-flashcard-ai-form-group" style="flex:1;">' +
                  '<label class="hub-flashcard-ai-label">' + _('fc', 'fieldId') + '</label>' +
                  '<input type="text" id="hub-ai-new-id" class="hub-flashcard-ai-input" placeholder="e.g. phrasal_verb" autocomplete="off">' +
                '</div>' +
                '<div class="hub-flashcard-ai-form-group" style="flex:1;">' +
                  '<label class="hub-flashcard-ai-label">' + _('fc', 'fieldName') + '</label>' +
                  '<input type="text" id="hub-ai-new-name" class="hub-flashcard-ai-input" placeholder="e.g. Phrasal Verb" autocomplete="off">' +
                '</div>' +
              '</div>' +
              '<div class="hub-flashcard-ai-form-group">' +
                '<label class="hub-flashcard-ai-label">' + _('fc', 'aiInstruction') + '</label>' +
                '<textarea id="hub-ai-new-prompt" class="hub-flashcard-ai-textarea" placeholder="e.g. Provide a common phrasal verb using this word" rows="2"></textarea>' +
              '</div>' +
              '<button class="btn btn-primary" id="hub-ai-add-field-btn">' + _('fc', 'addFieldBtn') + '</button>' +
            '</div>' +
          '</div>' +

          '<div class="hub-flashcard-ai-section">' +
            '<h4 class="hub-flashcard-ai-section-title">' + _('fc', 'systemLanguage') + '</h4>' +
            '<p class="hub-flashcard-system-lang-desc">' + _('fc', 'systemLangDesc') + '</p>' +
            '<div class="hub-flashcard-system-lang-row">' +
              '<button class="hub-flashcard-system-lang-btn hub-flashcard-system-lang-btn--en' + (_systemLanguage === 'en' ? ' hub-flashcard-system-lang-btn--active' : '') + '" id="hub-syslang-en">' +
                '<span class="hub-flashcard-system-lang-flag">🇬🇧</span>' +
                '<span class="hub-flashcard-system-lang-label">English</span>' +
              '</button>' +
              '<button class="hub-flashcard-system-lang-btn hub-flashcard-system-lang-btn--vi' + (_systemLanguage === 'vi' ? ' hub-flashcard-system-lang-btn--active' : '') + '" id="hub-syslang-vi">' +
                '<span class="hub-flashcard-system-lang-flag">🇻🇳</span>' +
                '<span class="hub-flashcard-system-lang-label">Tiếng Việt</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="hub-flashcard-ai-status" id="hub-ai-status"></div>' +
        '</div>' +

        '<div class="generate-modal-footer">' +
          '<button class="btn btn-ghost" id="hub-ai-close-btn">' + _('fc', 'closeBtn') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeAISettingsModal();
    });

    var escHandler = function (e) {
      if (e.key === 'Escape') {
        _closeAISettingsModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    overlay.querySelector('#hub-ai-close-btn')
      .addEventListener('click', _closeAISettingsModal);

    overlay.querySelectorAll('.hub-flashcard-ai-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var index = parseInt(btn.dataset.index, 10);
        _deleteAIField(index);
      });
    });

    var idInput = overlay.querySelector('#hub-ai-new-id');
    if (idInput) {
      idInput.addEventListener('input', function () {
        idInput.value = idInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      });
    }

    overlay.querySelector('#hub-ai-add-field-btn')
      .addEventListener('click', _addAIField);

    var promptInput = overlay.querySelector('#hub-ai-new-prompt');
    if (promptInput) {
      promptInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _addAIField();
        }
      });
    }

    // --- Voice Speed slider live update ---
    var voiceRange = overlay.querySelector('#hub-voice-speed-range');
    var voiceDisplay = overlay.querySelector('#hub-voice-speed-display');
    if (voiceRange && voiceDisplay) {
      voiceRange.addEventListener('input', function () {
        var val = parseFloat(voiceRange.value);
        voiceDisplay.textContent = val.toFixed(1) + 'x';
        _voiceSpeed = val;
        _saveAISettings();
      });
    }

    // --- System Language toggle buttons ---
    var sysLangEn = overlay.querySelector('#hub-syslang-en');
    var sysLangVi = overlay.querySelector('#hub-syslang-vi');
    if (sysLangEn) {
      sysLangEn.addEventListener('click', function () {
        if (_systemLanguage === 'en') return;
        _systemLanguage = 'en';
        sysLangEn.classList.add('hub-flashcard-system-lang-btn--active');
        if (sysLangVi) sysLangVi.classList.remove('hub-flashcard-system-lang-btn--active');
        applyLanguage('en');
        _saveAISettings();
        // Re-render AI modal to reflect updated labels
        _closeAISettingsModal();
        _showAISettingsModal();
      });
    }
    if (sysLangVi) {
      sysLangVi.addEventListener('click', function () {
        if (_systemLanguage === 'vi') return;
        _systemLanguage = 'vi';
        sysLangVi.classList.add('hub-flashcard-system-lang-btn--active');
        if (sysLangEn) sysLangEn.classList.remove('hub-flashcard-system-lang-btn--active');
        applyLanguage('vi');
        _saveAISettings();
        _closeAISettingsModal();
        _showAISettingsModal();
      });
    }

    setTimeout(function () {
      if (idInput) idInput.focus();
    }, 150);
  }

  function _closeAISettingsModal() {
    var overlay = document.getElementById('flashcard-ai-settings-overlay');
    if (overlay) overlay.remove();
  }

  function _addAIField() {
    var overlay = document.getElementById('flashcard-ai-settings-overlay');
    if (!overlay) return;

    var idInput = overlay.querySelector('#hub-ai-new-id');
    var nameInput = overlay.querySelector('#hub-ai-new-name');
    var promptInput = overlay.querySelector('#hub-ai-new-prompt');
    var statusEl = overlay.querySelector('#hub-ai-status');

    var fieldId = (idInput ? idInput.value : '').trim();
    var fieldName = (nameInput ? nameInput.value : '').trim();
    var fieldPrompt = (promptInput ? promptInput.value : '').trim();

    if (!fieldId) {
      if (statusEl) {
        statusEl.className = 'hub-flashcard-ai-status hub-flashcard-ai-status-error';
        statusEl.textContent = _('fc', 'fieldIdRequired');
      }
      if (idInput) idInput.focus();
      return;
    }
    if (!fieldName) {
      if (statusEl) {
        statusEl.className = 'hub-flashcard-ai-status hub-flashcard-ai-status-error';
        statusEl.textContent = _('fc', 'fieldNameRequired');
      }
      if (nameInput) nameInput.focus();
      return;
    }
    if (!fieldPrompt) {
      if (statusEl) {
        statusEl.className = 'hub-flashcard-ai-status hub-flashcard-ai-status-error';
        statusEl.textContent = _('fc', 'fieldPromptRequired');
      }
      if (promptInput) promptInput.focus();
      return;
    }

    var exists = _aiSchema.some(function (f) { return f.id === fieldId; });
    if (exists) {
      if (statusEl) {
        statusEl.className = 'hub-flashcard-ai-status hub-flashcard-ai-status-error';
        statusEl.textContent = _('fc', 'fieldExists').replace('X', fieldId);
      }
      if (idInput) idInput.focus();
      return;
    }

    _aiSchema.push({
      id: fieldId,
      name: fieldName,
      prompt: fieldPrompt,
      isDeletable: true
    });

    _saveAISettings();

    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (promptInput) promptInput.value = '';

    if (statusEl) {
      statusEl.className = 'hub-flashcard-ai-status hub-flashcard-ai-status-success';
      statusEl.textContent = 'Field "' + fieldName + '" added successfully!';
      setTimeout(function () {
        if (statusEl) { statusEl.className = 'hub-flashcard-ai-status'; statusEl.textContent = ''; }
      }, 2000);
    }

    _reRenderAIFieldList();
    if (idInput) idInput.focus();
  }

  function _deleteAIField(index) {
    var field = _aiSchema[index];
    if (!field) return;
    if (!field.isDeletable) return;

    _aiSchema.splice(index, 1);
    _saveAISettings();
    _reRenderAIFieldList();
  }

  function _reRenderAIFieldList() {
    var overlay = document.getElementById('flashcard-ai-settings-overlay');
    if (!overlay) return;

    var fieldList = overlay.querySelector('.hub-flashcard-ai-field-list');
    if (!fieldList) return;

    if (_aiSchema.length === 0) {
      fieldList.innerHTML = '<p class="hub-flashcard-ai-empty">No custom fields defined.</p>';
      return;
    }

    fieldList.innerHTML = _aiSchema.map(function (field, index) {
      var delBtn = field.isDeletable
        ? '<button class="hub-flashcard-ai-del-btn" data-index="' + index + '" title="Delete field">&times;</button>'
        : '';
      return '' +
        '<div class="hub-flashcard-ai-field-row">' +
          '<div class="hub-flashcard-ai-field-info">' +
            '<span class="hub-flashcard-ai-field-id">' + _esc(field.id) + '</span>' +
            '<span class="hub-flashcard-ai-field-name">' + _esc(field.name) + '</span>' +
            '<span class="hub-flashcard-ai-field-prompt">' + _esc(field.prompt) + '</span>' +
          '</div>' +
          delBtn +
        '</div>';
    }).join('');

    fieldList.querySelectorAll('.hub-flashcard-ai-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var index = parseInt(btn.dataset.index, 10);
        _deleteAIField(index);
      });
    });
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
      if (updated.repetition === 0) {
        if (quality === QUALITY.HARD) {
          updated.interval = 1;
        } else if (quality === QUALITY.GOOD) {
          updated.interval = 2;
        } else {
          updated.interval = 4;
        }
      } else if (updated.repetition === 1) {
        updated.interval = 6;
      } else {
        updated.interval = Math.round(updated.interval * updated.easeFactor);
      }
      updated.repetition++;
    } else {
      updated.repetition = 0;
      updated.interval = 1;
    }

    const qDiff = 5 - quality;
    updated.easeFactor = updated.easeFactor + (0.1 - qDiff * (0.08 + qDiff * 0.02));
    if (updated.easeFactor < 1.3) updated.easeFactor = 1.3;

    if (isAgainInSession) {
      updated.nextReviewDate = Date.now();
    } else {
      updated.nextReviewDate = Date.now() + (updated.interval * 24 * 60 * 60 * 1000);
    }

    return updated;
  }

  function _getNextReviewLabel(quality, card) {
    if (quality === QUALITY.AGAIN) return '< 1m';

    let interval, easeFactor;

    easeFactor = card.easeFactor +
      (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    if (quality >= 3) {
      if (card.repetition === 0) {
        if (quality === QUALITY.HARD) {
          interval = 1;
        } else if (quality === QUALITY.GOOD) {
          interval = 2;
        } else {
          interval = 4;
        }
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

const prompt = buildAIPrompt(word, _aiSchema);

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
      clozeSentence: parsed.clozeSentence || '',
      imageUrl: parsed.imageUrl || '',
      // Dynamic fields from AI schema
      ...(_buildDynamicFields(parsed)),
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
   * Build dynamic field values from the AI schema.
   * Maps each schema field to the value from the parsed response.
   */
  function _buildDynamicFields(parsed) {
    var fields = {};
    if (_aiSchema && _aiSchema.length > 0) {
      _aiSchema.forEach(function (field) {
        var val = parsed[field.id];
        if (val !== undefined && val !== null) {
          fields[field.id] = val;
        } else {
          fields[field.id] = '';
        }
      });
    }
    return fields;
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
     MANDARIN VAULT — ARCHITECT ACCESS (Collaborative Empty State)
     Crimson/Gold neon "NEURAL INTERFACE: PENDING CONFIGURATION"
     with blueprint placeholder fields and a collab-invite CTA.
     Shown only when the ZH vault has zero decks.
     ========================================================== */

  function _buildZhArchitectScreen() {
    return `
      <div class="hub-flashcard-zh-architect" id="zh-architect-screen">

        <!-- ═══ Neural Interface Header ═══ -->
        <div class="zh-architect-header">
          <div class="zh-architect-glow-orb zh-architect-glow-orb--left"></div>
          <div class="zh-architect-glow-orb zh-architect-glow-orb--right"></div>
          <div class="zh-architect-header-content">
            <div class="zh-architect-sigil">
              <!-- Crimson circuit sigil SVG -->
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="4" y="4" width="40" height="40" rx="8" stroke="var(--zh-accent)" stroke-width="1.2" opacity="0.6"/>
                <rect x="12" y="12" width="24" height="24" rx="4" stroke="var(--zh-accent)" stroke-width="1" opacity="0.4"/>
                <circle cx="24" cy="24" r="6" fill="var(--zh-accent)" opacity="0.15" stroke="var(--zh-accent)" stroke-width="0.8"/>
                <circle cx="24" cy="24" r="2" fill="var(--zh-accent)" opacity="0.5"/>
                <path d="M24 4v8M24 36v8M4 24h8M36 24h8M10 10l5.6 5.6M32.4 32.4L38 38M38 10l-5.6 5.6M15.6 32.4L10 38" stroke="var(--zh-accent)" stroke-width="0.6" opacity="0.3"/>
              </svg>
            </div>
            <h3 class="zh-architect-title">${_('fc', 'zhNeuralTitle')}</h3>
            <div class="zh-architect-status-bar">
              <span class="zh-architect-status-dot"></span>
              <span class="zh-architect-status-text">${_('fc', 'zhSystemStatus')}</span>
            </div>
          </div>
        </div>

        <!-- ═══ Blueprint Panel ═══ -->
        <div class="zh-architect-blueprint">
          <div class="zh-architect-blueprint-header">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="2" stroke="var(--zh-accent)" stroke-width="1" opacity="0.5"/>
              <line x1="4" y1="1" x2="4" y2="15" stroke="var(--zh-accent)" stroke-width="0.5" opacity="0.3"/>
              <line x1="10" y1="1" x2="10" y2="15" stroke="var(--zh-accent)" stroke-width="0.5" opacity="0.3"/>
            </svg>
            <span class="zh-architect-blueprint-label">${_('fc', 'zhBlueprintTitle')}</span>
          </div>

          <div class="zh-architect-fields">
            <!-- Structure Type -->
            <div class="zh-architect-field">
              <div class="zh-architect-field-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--zh-accent)" stroke-width="1" opacity="0.5"/>
                  <path d="M4 5h6M4 8h4M4 11h2" stroke="var(--zh-gold)" stroke-width="1" stroke-linecap="round"/>
                </svg>
              </div>
              <span class="zh-architect-field-key" data-i18n="fc.zhStructureType">${_('fc', 'zhStructureType')}</span>
            </div>
            <!-- Phonetic Engine -->
            <div class="zh-architect-field">
              <div class="zh-architect-field-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="var(--zh-accent)" stroke-width="1" opacity="0.5"/>
                  <path d="M4 7c0-1.5 1.5-3 3-3s3 1.5 3 3" stroke="var(--zh-gold)" stroke-width="1" stroke-linecap="round"/>
                  <path d="M5 9c0 1 1.5 2 2 2" stroke="var(--zh-gold)" stroke-width="0.8" stroke-linecap="round" opacity="0.6"/>
                </svg>
              </div>
              <span class="zh-architect-field-key" data-i18n="fc.zhPhoneticEngine">${_('fc', 'zhPhoneticEngine')}</span>
            </div>
            <!-- Study Method -->
            <div class="zh-architect-field">
              <div class="zh-architect-field-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--zh-accent)" stroke-width="1" opacity="0.5"/>
                  <path d="M4 5l3 3 3-4" stroke="var(--zh-gold)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="zh-architect-field-key" data-i18n="fc.zhStudyMethod">${_('fc', 'zhStudyMethod')}</span>
            </div>
            <!-- HSK Level -->
            <div class="zh-architect-field">
              <div class="zh-architect-field-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L8.5 5.5H13L9.5 8.5L11 13L7 10L3 13L4.5 8.5L1 5.5H5.5L7 1Z" stroke="var(--zh-gold)" stroke-width="1" stroke-linejoin="round"/>
                </svg>
              </div>
              <span class="zh-architect-field-key" data-i18n="fc.zhHskLevel">${_('fc', 'zhHskLevel')}</span>
            </div>
            <!-- Character Set -->
            <div class="zh-architect-field">
              <div class="zh-architect-field-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="1" width="12" height="12" rx="2" stroke="var(--zh-accent)" stroke-width="1" opacity="0.5"/>
                  <text x="7" y="10" text-anchor="middle" font-size="7" fill="var(--zh-gold)" opacity="0.7" font-family="serif">字</text>
                </svg>
              </div>
              <span class="zh-architect-field-key" data-i18n="fc.zhCharSet">${_('fc', 'zhCharSet')}</span>
            </div>
          </div>

          <!-- Schema Config Note -->
          <div class="zh-architect-note">
            <div class="zh-architect-note-icon">⚙</div>
            <div class="zh-architect-note-text">
              <p>${_('fc', 'zhFieldNote1')}</p>
              <p>${_('fc', 'zhFieldNote2')}</p>
            </div>
          </div>
        </div>

        <!-- ═══ Action Buttons ═══ -->
        <div class="zh-architect-actions">
          <!-- Primary: Collab Invite -->
          <button class="zh-architect-btn zh-architect-btn--primary" id="btn-zh-propose-structure">
            <span class="zh-architect-btn-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.3"/>
                <path d="M2 16c0-3 2-5 5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <circle cx="14" cy="6" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M11 15c0-2 1.5-3.5 3-3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                <path d="M12 3l3 3-3 3" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>
                <circle cx="11" cy="12" r="1.2" fill="var(--zh-gold)" opacity="0.9"/>
                <path d="M11 10.8v1.4M9.8 12h1.4" stroke="var(--zh-gold)" stroke-width="0.6"/>
              </svg>
            </span>
            <span class="zh-architect-btn-label">${_('fc', 'zhProposeBtn')}</span>
            <span class="zh-architect-btn-hint">${_('fc', 'zhProposeHint')}</span>
          </button>

          <!-- Secondary: Quick Start -->
          <button class="zh-architect-btn zh-architect-btn--secondary" id="btn-zh-quick-start">
            <span class="zh-architect-btn-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
                <path d="M7 5l3.5 3-3.5 3V5Z" fill="currentColor" opacity="0.7"/>
              </svg>
            </span>
            <span class="zh-architect-btn-label">${_('fc', 'zhQuickStartBtn')}</span>
            <span class="zh-architect-btn-hint">${_('fc', 'zhQuickStartHint')}</span>
          </button>
        </div>

        <!-- ═══ Bottom decorative scan line ═══ -->
        <div class="zh-architect-scanline"></div>
      </div>
    `;
  }

  /* ==========================================================
     STATE 1 — DECK LIBRARY (Sliding Vault Architecture)
     Two panels (ENGLISH / MANDARIN) in a sliding track.
     Tab toggles switch active panel via translateX on the track.
     ========================================================== */

  function _renderDeckLibrary() {
    if (!_container) return;

    // --- Filter decks into language groups ---
    var enDecks = _decks.filter(function (d) { return (d.language || 'en') === 'en'; });
    var zhDecks = _decks.filter(function (d) { return d.language === 'zh'; });

    var totalCards = _decks.reduce(function (sum, d) { return sum + d.cards.length; }, 0);
    var totalDue = _countTotalDueCards();

    // --- Empty state: no decks at all ---
    if (_decks.length === 0) {
      _container.innerHTML = `
        <div class="tab-content flashcard-app">
          <div class="empty-state">
            <div class="empty-state-icon">📚</div>
            <h3 data-i18n="fc.noDecksYet">${_('fc', 'noDecksYet')}</h3>
            <p data-i18n="fc.getStarted">${_('fc', 'getStarted')}</p>
            <button class="btn btn-primary" id="btn-create-first-deck">+ ${_('fc', 'createFirstDeck')}</button>
          </div>
        </div>
      `;
      var btnCreateFirst = _container.querySelector('#btn-create-first-deck');
      if (btnCreateFirst) btnCreateFirst.addEventListener('click', _showCreateDeckModal);
      return;
    }

    // --- Sort helper: due-first, then alphabetical ---
    function _sortDecks(decks) {
      return decks.slice().sort(function (a, b) {
        var aDue = _countDueCards(a);
        var bDue = _countDueCards(b);
        if (aDue > 0 && bDue === 0) return -1;
        if (bDue > 0 && aDue === 0) return 1;
        return a.title.localeCompare(b.title);
      });
    }

    // --- Build deck card HTML ---
    function _buildDeckCard(deck) {
      var dTotal = deck.cards.length;
      var dDue = _countDueCards(deck);
      return `
        <div class="deck-card glass-card" data-deck-id="${_esc(deck.id)}">
          <div class="deck-card-top">
            <h3 class="deck-card-title">${_esc(deck.title)}</h3>
            <div class="deck-card-actions-top">
              <button class="deck-rename-btn" data-action="rename-deck" data-deck-id="${_esc(deck.id)}" title="Rename deck">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
              </button>
              <button class="deck-delete-btn" data-action="delete-deck" data-deck-id="${_esc(deck.id)}" title="Delete deck">🗑</button>
            </div>
          </div>
          <div class="deck-card-meta">
            ${_('fc', 'totalCardsLabel')}: ${dTotal} ·
            <span style="color:${dDue > 0 ? 'var(--accent-primary)' : 'var(--text-muted)'};">
              ${_('fc', 'dueForReview')}: ${dDue}
            </span>
          </div>
          <div class="deck-card-actions">
            <button class="deck-play-btn" data-action="study" data-deck-id="${_esc(deck.id)}" ${dDue === 0 ? 'disabled style="opacity:0.35;cursor:not-allowed;box-shadow:none;"' : ''}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                <polygon points="4,2 16,10 4,18"/>
              </svg>
              ${_('fc', 'studyDue')}
            </button>
            <button class="deck-browse-btn" data-action="browse" data-deck-id="${_esc(deck.id)}">
              ${_('fc', 'browseEdit')}
            </button>
          </div>
        </div>
      `;
    }

    // --- Determine initial slide position from active vault ---
    var translateX = _activeVault === 'zh' ? '-50%' : '0%';
    var enTabActive = _activeVault === 'en' ? ' hub-flashcard-vault-tab--active' : '';
    var zhTabActive = _activeVault === 'zh' ? ' hub-flashcard-vault-tab--active' : '';

    // --- Render the sliding vault library ---
    _container.innerHTML = `
      <div class="tab-content flashcard-app" style="align-items:stretch;">

        <!-- Global Header -->
        <div class="flashcard-header" style="max-width:100%;">
          <h2 class="section-header" style="margin-bottom:0;">📚 ${_('fc', 'deckLibrary')}</h2>
          <span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);">
            ${totalCards} cards · ${totalDue} ${_('fc', 'cardsDue')}
          </span>
        </div>

        <!-- Vault Tab Toggles -->
        <div class="hub-flashcard-vault-tabs">
          <button class="hub-flashcard-vault-tab hub-flashcard-vault-tab--en${enTabActive}" id="vault-tab-en">
            🇬🇧 ${_('fc', 'enVaultLabel')}
            <span class="hub-flashcard-vault-tab-count">${enDecks.length}</span>
          </button>
          <button class="hub-flashcard-vault-tab hub-flashcard-vault-tab--zh${zhTabActive}" id="vault-tab-zh">
            🇨🇳 ${_('fc', 'zhVaultLabel')}
            <span class="hub-flashcard-vault-tab-count">${zhDecks.length}</span>
          </button>
        </div>

        <!-- Sliding Vault Container -->
        <div class="hub-flashcard-vault-container">
          <div class="hub-flashcard-vault-track" style="transform: translateX(${translateX});" id="vault-track">

            <!-- ============ ENG PANEL ============ -->
            <div class="hub-flashcard-vault-panel hub-flashcard-vault-panel--en" id="eng-panel">
              ${enDecks.length === 0 ? `
                <div class="hub-flashcard-vault-empty">
                  <p data-i18n="fc.enVaultEmpty">${_('fc', 'enVaultEmpty')}</p>
                </div>
              ` : `
                <div class="deck-grid">
                  ${_sortDecks(enDecks).map(function (deck) { return _buildDeckCard(deck); }).join('')}
                </div>
              `}
            </div>

            <!-- ============ ZHO PANEL ============ -->
            <div class="hub-flashcard-vault-panel hub-flashcard-vault-panel--zh" id="zho-panel">
              ${zhDecks.length === 0 ? _buildZhArchitectScreen() : `
                <div class="deck-grid">
                  ${_sortDecks(zhDecks).map(function (deck) { return _buildDeckCard(deck); }).join('')}
                </div>
              `}
            </div>

          </div>
        </div>

        <!-- Create New Deck Button -->
        <button class="deck-create-btn btn btn-primary" id="btn-create-deck">
          <span style="font-size:1.1rem;">+</span> ${_('fc', 'createNewDeck')}
        </button>

      </div>
    `;

    // --- Bind events ---

    // Create deck button — smart creation: auto-assign language from active vault
    var btnCreate = _container.querySelector('#btn-create-deck');
    if (btnCreate) btnCreate.addEventListener('click', function () {
      _showCreateDeckModal(true); // true = skip language picker, use _activeVault
    });

    // Vault tab toggles
    var tabEn = _container.querySelector('#vault-tab-en');
    var tabZh = _container.querySelector('#vault-tab-zh');
    var track = _container.querySelector('#vault-track');

    if (tabEn) {
      tabEn.addEventListener('click', function () {
        if (_activeVault === 'en') return;
        _activeVault = 'en';
        if (track) track.style.transform = 'translateX(0%)';
        tabEn.classList.add('hub-flashcard-vault-tab--active');
        if (tabZh) tabZh.classList.remove('hub-flashcard-vault-tab--active');
      });
    }
    if (tabZh) {
      tabZh.addEventListener('click', function () {
        if (_activeVault === 'zh') return;
        _activeVault = 'zh';
        if (track) track.style.transform = 'translateX(-50%)';
        tabZh.classList.add('hub-flashcard-vault-tab--active');
        if (tabEn) tabEn.classList.remove('hub-flashcard-vault-tab--active');
      });
    }

    // --- Mandarin Architect Access: button bindings ---
    var btnPropose = _container.querySelector('#btn-zh-propose-structure');
    var btnQuickStart = _container.querySelector('#btn-zh-quick-start');
    if (btnPropose) {
      btnPropose.addEventListener('click', function () {
        // Collab invite: switch to ZH vault, open create deck modal with smart creation
        _activeVault = 'zh';
        _showCreateDeckModal(true);
      });
    }
    if (btnQuickStart) {
      btnQuickStart.addEventListener('click', function () {
        // Quick start: create an empty ZH deck immediately with a default title
        _activeVault = 'zh';
        var defaultTitle = '中文 Deck ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        _createDeck(defaultTitle, 'zh');
        _renderApp();
      });
    }

    // Deck action buttons (Study Due, Browse/Edit, Delete, Rename) — delegated
    _container.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        var deckId = btn.dataset.deckId;

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
        } else if (action === 'rename-deck') {
          _handleRenameDeck(deckId);
        }
      });
    });
  }

  /* ==========================================================
     CREATE DECK MODAL — Multi-Step Language Picker
     Step 1: Select language (English or Mandarin)
     Step 2: Enter deck title + confirm

     @param {boolean} [useActiveVault=false]
       When true, skip the language picker and auto-assign the
       current _activeVault language. Used by "+ Create New Deck"
       from the sliding vault UI.
     ========================================================== */

  function _showCreateDeckModal(useActiveVault) {
    if (document.getElementById('create-deck-overlay')) return;

    // If smart creation, pick language from active vault immediately
    var _pickedLanguage = useActiveVault ? _activeVault : null;

    var overlay = document.createElement('div');
    overlay.id = 'create-deck-overlay';
    overlay.className = 'add-card-overlay';

    // --- STEP 1: Language Selection ---
    function _renderLanguageStep() {
      overlay.innerHTML = `
        <div class="hub-flashcard-lang-modal glass">
          <div class="generate-modal-header">
            <div class="generate-modal-icon">
              <span style="font-size:1.8rem;">🌐</span>
            </div>
            <h3 class="generate-modal-title">Choose Language</h3>
            <p class="generate-modal-subtitle">Select the language for your new flashcard deck</p>
          </div>

          <div class="hub-flashcard-lang-cards">
            <!-- ENGLISH Card -->
            <div class="hub-flashcard-lang-card hub-flashcard-lang-card--en" id="lang-card-en">
              <div class="hub-flashcard-lang-card-glow hub-flashcard-lang-card-glow--en"></div>
              <div class="hub-flashcard-lang-card-icon">
                <span class="hub-flashcard-lang-card-flag">🇬🇧</span>
              </div>
              <div class="hub-flashcard-lang-card-content">
                <h4 class="hub-flashcard-lang-card-title">ENGLISH</h4>
                <p class="hub-flashcard-lang-card-desc">
                  Vocabulary, IELTS, TOEFL, idioms, collocations & more
                </p>
              </div>
              <div class="hub-flashcard-lang-card-accent hub-flashcard-lang-card-accent--en"></div>
              <div class="hub-flashcard-lang-card-arrow">→</div>
            </div>

            <!-- MANDARIN Card -->
            <div class="hub-flashcard-lang-card hub-flashcard-lang-card--zh" id="lang-card-zh">
              <div class="hub-flashcard-lang-card-glow hub-flashcard-lang-card-glow--zh"></div>
              <div class="hub-flashcard-lang-card-icon">
                <span class="hub-flashcard-lang-card-flag">🇨🇳</span>
              </div>
              <div class="hub-flashcard-lang-card-content">
                <h4 class="hub-flashcard-lang-card-title">中文 / TIẾNG TRUNG</h4>
                <p class="hub-flashcard-lang-card-desc">${_('fc', 'mandarinDesc')}</p>
                </p>
              </div>
              <div class="hub-flashcard-lang-card-accent hub-flashcard-lang-card-accent--zh"></div>
              <div class="hub-flashcard-lang-card-arrow">→</div>
            </div>
          </div>

          <div class="generate-modal-footer">
            <button class="btn btn-ghost" id="btn-cancel-lang">${_('fc', 'cancelBtn')}</button>
          </div>
        </div>
      `;

      // Bind language card clicks
      var enCard = overlay.querySelector('#lang-card-en');
      var zhCard = overlay.querySelector('#lang-card-zh');

      if (enCard) {
        enCard.addEventListener('click', function () { _pickedLanguage = 'en'; _renderNameStep(); });
      }
      if (zhCard) {
        zhCard.addEventListener('click', function () { _pickedLanguage = 'zh'; _renderNameStep(); });
      }

      // Cancel button
      var cancelBtn = overlay.querySelector('#btn-cancel-lang');
      if (cancelBtn) cancelBtn.addEventListener('click', _closeCreateDeckModal);
    }

    // --- STEP 2: Deck Name ---
    function _renderNameStep() {
      var langLabel = _pickedLanguage === 'zh' ? '中文 / Mandarin' : 'English';
      var langEmoji = _pickedLanguage === 'zh' ? '🇨🇳' : '🇬🇧';

      overlay.innerHTML = `
        <div class="hub-flashcard-lang-modal glass">
          <div class="generate-modal-header">
            <div class="generate-modal-icon">
              <span style="font-size:1.8rem;">${langEmoji}</span>
            </div>
            <h3 class="generate-modal-title">${_('fc', 'nameYourDeck')}</h3>
            <p class="generate-modal-subtitle">
              ${_('fc', 'creatingDeck')} <span style="color:${_pickedLanguage === 'zh' ? 'var(--accent-crimson, #ff0055)' : 'var(--accent-primary)'};font-weight:600;">${langLabel}</span> ${_('fc', 'deckLibrary').toLowerCase()}
            </p>
          </div>

          <div class="hub-flashcard-lang-picked-badge hub-flashcard-lang-picked-badge--${_pickedLanguage}">
            <span class="hub-flashcard-lang-picked-flag">${langEmoji}</span>
            <span class="hub-flashcard-lang-picked-label">${langLabel}</span>
            <button class="hub-flashcard-lang-change-btn" id="btn-change-lang">${_('fc', 'changeLang')}</button>
          </div>

          <div class="generate-input-row" style="flex-direction:column;">
            <input
              type="text"
              id="input-deck-title"
              class="generate-word-input"
              data-i18n-placeholder="${_pickedLanguage === 'zh' ? 'e.g. HSK 4 Vocabulary 四级词汇' : 'e.g. IELTS Academic Vocabulary'}"
              placeholder="${_pickedLanguage === 'zh' ? 'e.g. HSK 4 Vocabulary 四级词汇' : 'e.g. IELTS Academic Vocabulary'}"
              autocomplete="off"
            >
          </div>

          <div class="generate-status" id="create-deck-status"></div>

          <div class="generate-modal-footer">
            <button class="btn btn-ghost" id="btn-cancel-create-deck">${_('fc', 'cancelBtn')}</button>
            <button class="btn btn-primary" id="btn-confirm-create-deck">${_('fc', 'createDeckBtn')}</button>
          </div>
        </div>
      `;

      // Change language button (only show if not smart-creation)
      var changeBtn = overlay.querySelector('#btn-change-lang');
      if (changeBtn) {
        if (useActiveVault) {
          // In smart-creation mode, hide the change button — user can still
          // navigate back to vault and pick a different one
          changeBtn.style.display = 'none';
        } else {
          changeBtn.addEventListener('click', function (e) { e.stopPropagation(); _renderLanguageStep(); });
        }
      }

      // Cancel button
      var cancelBtn = overlay.querySelector('#btn-cancel-create-deck');
      if (cancelBtn) cancelBtn.addEventListener('click', _closeCreateDeckModal);

      // Confirm button
      var confirmBtn = overlay.querySelector('#btn-confirm-create-deck');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          var input = document.getElementById('input-deck-title');
          var title = input ? input.value.trim() : '';
          if (!title) {
            var status = document.getElementById('create-deck-status');
            if (status) {
              status.className = 'generate-status status-error';
              status.textContent = _('fc', 'enterDeckTitle');
            }
            return;
          }
          _createDeck(title, _pickedLanguage);
          _closeCreateDeckModal();
          _renderApp();
        });
      }

      // Enter key
      var titleInput = overlay.querySelector('#input-deck-title');
      if (titleInput) {
        titleInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            var conf = overlay.querySelector('#btn-confirm-create-deck');
            if (conf) conf.click();
          }
        });
      }

      // Focus input
      setTimeout(function () {
        var inp = overlay.querySelector('#input-deck-title');
        if (inp) inp.focus();
      }, 150);
    }

    // --- Build initial step (skip language picker for smart creation) ---
    if (_pickedLanguage) {
      _renderNameStep();
    } else {
      _renderLanguageStep();
    }

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeCreateDeckModal();
    });

    // Close on Escape
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        _closeCreateDeckModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function _closeCreateDeckModal() {
    var overlay = document.getElementById('create-deck-overlay');
    if (overlay) overlay.remove();
  }

  function _createDeck(title, language) {
    const deck = {
      id: 'deck_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      title: title,
      language: language || 'en',
      cards: []
    };
    _decks.push(deck);
    _saveDecks();
  }

  /* ==========================================================
     RENAME DECK
     ========================================================== */

  function _handleRenameDeck(deckId) {
    const deck = _decks.find(d => d.id === deckId);
    if (!deck) return;
    const newName = prompt('Enter new name for this deck:', deck.title);
    if (!newName || newName.trim() === '') return;
    if (newName.trim() === deck.title) return;
    deck.title = newName.trim();
    _saveDecks();
    _renderApp();
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
    deck.cards.forEach(function (card, i) {
      if (card.nextReviewDate <= now) {
        _studyQueue.push(i);
      }
    });

    if (_studyQueue.length === 0) {
      _showToast('No cards due in this deck! You\'re all caught up.');
      _mode = 'library';
      _renderApp();
      return;
    }

    // Shuffle the queue for variety (Fisher-Yates)
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

        ${deck ? '<p style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;">Deck: ' + _esc(deck.title) + '</p>' : ''}

        <!-- 3D Card -->
        <div class="card-stage" id="card-stage">
          <div class="card-3d" id="card-3d">
            <!-- ============ FRONT FACE ============ -->
            ${card.clozeSentence ? `
            <div class="card-face card-front card-front-cloze">
              <div class="cloze-sentence">
                <span>${_esc(card.clozeSentence.split('___')[0] || '')}</span>
                <input type="text" id="cloze-input" class="cyber-cloze-input" placeholder="Type answer..." autocomplete="off">
                <span>${_esc(card.clozeSentence.split('___')[1] || '')}</span>
              </div>
              <div class="cloze-actions">
                <button id="cloze-check-btn" class="cloze-btn cloze-btn-check">Check</button>
                <button id="cloze-reveal-btn" class="cloze-btn cloze-btn-reveal">Reveal (Give up)</button>
              </div>
              <div id="cloze-feedback"></div>
            </div>
            ` : `
            <div class="card-face card-front">
              <span class="card-term">${_esc(card.term)}</span>
              ${card.type ? '<span class="card-pos">' + _esc(card.type) + '</span>' : ''}
              ${card.phonetic ? '<span class="card-phonetic-front">' + _esc(card.phonetic) + '</span>' : ''}
              <span class="card-hint">Click to flip</span>
            </div>
            `}

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
                  <span class="card-section-label label-phonetic">🔊 Phonetic
                    <button class="hub-flashcard-speaker-btn" data-speaker-term="${_esc(card.term)}" title="Listen to pronunciation" aria-label="Listen to pronunciation">&#9654;</button>
                  </span>
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

                ${card.imageUrl ? `
                <div class="card-section">
                  <span class="card-section-label label-image">🖼️ Visual Memory</span>
                  <img src="${_esc(card.imageUrl)}" alt="Vocabulary Image" class="card-visual-img" loading="lazy">
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

    const card3d = _container.querySelector('#card-3d');
    const panel = _container.querySelector('#srs-assessment-panel');
    const clozeInput = _container.querySelector('#cloze-input');
    const isCloze = !!clozeInput;

    if (card3d && panel) {

      if (isCloze) {
        // --- Cloze mode: lock normal flip ---

        // Prevent click-to-flip on the card (cloze input captures clicks)
        card3d.addEventListener('click', (e) => {
          if (!_cardFlipped && e.target !== clozeInput) {
            clozeInput.focus();
          }
        });

        // Prevent spacebar flip when cloze input is focused
        // Clean up any previous handlers to prevent accumulation
        if (window._hubFlashcardSpaceHandler) {
          document.removeEventListener('keydown', window._hubFlashcardSpaceHandler);
        }
        const spaceHandler = (e) => {
          if ((e.key === ' ' || e.key === 'Spacebar') && !_cardFlipped) {
            // Always allow typing in any input or textarea (including overlays/modals)
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.target === clozeInput) return;
            e.preventDefault();
            clozeInput.focus();
          }
        };
        document.addEventListener('keydown', spaceHandler);
        window._hubFlashcardSpaceHandler = spaceHandler;

        // --- Cloze: flip helper ---
        const _doFlip = () => {
          _cardFlipped = true;
          card3d.classList.add('flipped');
          setTimeout(() => panel.classList.add('revealed'), 150);
        };

        // --- Cloze: Check answer ---
        const _checkCloze = () => {
          if (_cardFlipped) return;
          const cards = _getActiveCards();
          const card = cards[cardIdx];
          const userAnswer = _normalizeStr(clozeInput.value);
          const correctAnswer = _normalizeStr(card.term);
          const feedback = _container.querySelector('#cloze-feedback');

          if (userAnswer === correctAnswer) {
            if (feedback) {
              feedback.textContent = 'Correct!';
              feedback.className = 'cloze-feedback-correct';
            }
            setTimeout(() => {
              _doFlip();
            }, 400);
          } else {
            if (feedback) {
              feedback.textContent = 'Incorrect, try again!';
              feedback.className = 'cloze-feedback-incorrect';
            }
            clozeInput.value = '';
            clozeInput.focus();
          }
        };

        // Enter key on input
        clozeInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            _checkCloze();
          }
        });

        // Check button
        const checkBtn = _container.querySelector('#cloze-check-btn');
        if (checkBtn) checkBtn.addEventListener('click', _checkCloze);

        // Reveal button
        const revealBtn = _container.querySelector('#cloze-reveal-btn');
        if (revealBtn) {
          revealBtn.addEventListener('click', () => {
            if (_cardFlipped) return;
            const feedback = _container.querySelector('#cloze-feedback');
            if (feedback) {
              feedback.textContent = 'Revealed';
              feedback.className = 'cloze-feedback-incorrect';
            }
            _doFlip();
          });
        }

        // Focus input after render
        setTimeout(() => clozeInput.focus(), 200);

      } else {
        // --- Normal mode: click/space to flip ---

        card3d.addEventListener('click', () => {
          if (!_cardFlipped) {
            _cardFlipped = true;
            card3d.classList.add('flipped');
            setTimeout(() => panel.classList.add('revealed'), 150);
          }
        });

        // Clean up any previous study space handler to prevent accumulation
        if (window._hubFlashcardSpaceHandler) {
          document.removeEventListener('keydown', window._hubFlashcardSpaceHandler);
        }
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
        window._hubFlashcardSpaceHandler = spaceHandler;
      }
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
    window._hubFlashcardNumberHandler = numberHandler;

    // Assessment button clicks (delegated)
    _container.addEventListener('click', function (e) {
      var btn = e.target.closest('.srs-assessment-btn');
      if (!btn) return;
      var quality = parseInt(btn.dataset.quality, 10);
      _handleAssessment(quality, cardIdx);
    });

    // End session button
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

    // Speaker buttons (TTS) — event delegation
    if (_container) {
      _container.querySelectorAll('.hub-flashcard-speaker-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var term = btn.dataset.speakerTerm;
          if (term) {
            btn.classList.add('speaking');
            playPronunciation(term);
            var removeSpeaking = function () { btn.classList.remove('speaking'); };
            if (window.speechSynthesis) {
              var cleanup = function () {
                window.speechSynthesis.removeEventListener('end', cleanup);
                window.speechSynthesis.removeEventListener('error', cleanup);
                removeSpeaking();
              };
              window.speechSynthesis.addEventListener('end', cleanup);
              window.speechSynthesis.addEventListener('error', cleanup);
            } else {
              setTimeout(removeSpeaking, 1500);
            }
          }
        });
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
            <button class="hub-flashcard-ai-settings-btn" id="btn-ai-settings-empty" title="Advanced AI Settings" aria-label="Advanced AI Settings">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
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
            <button class="hub-flashcard-ai-settings-btn" id="btn-ai-settings" title="Advanced AI Settings" aria-label="Advanced AI Settings">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.6 3.6l1.4 1.4M13 13l1.4 1.4M3.6 14.4l1.4-1.4M13 5l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </button>
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
                  <span class="card-section-label label-phonetic">🔊 Phonetic
                    <button class="hub-flashcard-speaker-btn" data-speaker-term="${_esc(card.term)}" title="Listen to pronunciation" aria-label="Listen to pronunciation">&#9654;</button>
                  </span>
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

                ${card.imageUrl ? `
                <div class="card-section">
                  <span class="card-section-label label-image">🖼️ Visual Memory</span>
                  <img src="${_esc(card.imageUrl)}" alt="Vocabulary Image" class="card-visual-img" loading="lazy">
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

    // Add card buttons (AI + Manual + AI Settings)
    const btnAddAi = _container.querySelector('#btn-add-card-ai');
    if (btnAddAi) btnAddAi.addEventListener('click', _showAddForm);
    const btnAddManual = _container.querySelector('#btn-add-card-manual');
    if (btnAddManual) btnAddManual.addEventListener('click', () => _showCardEditorModal(null));
    const btnAiSettings = _container.querySelector('#btn-ai-settings, #btn-ai-settings-empty');
    if (btnAiSettings) btnAiSettings.addEventListener('click', _showAISettingsModal);

    // Prev / Next
    const btnPrev = _container.querySelector('#btn-prev');
    const btnNext = _container.querySelector('#btn-next');
    if (btnPrev) btnPrev.addEventListener('click', () => {
      if (_currentIndex > 0) { _currentIndex--; _renderBrowseMode(); }
    });
    if (btnNext) btnNext.addEventListener('click', () => {
      if (_currentIndex < cards.length - 1) { _currentIndex++; _renderBrowseMode(); }
    });

    // Keyboard nav — clean up any previous listener to prevent accumulation
    if (window._hubFlashcardBrowseKeyHandler) {
      document.removeEventListener('keydown', window._hubFlashcardBrowseKeyHandler);
    }
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
    window._hubFlashcardBrowseKeyHandler = keyHandler;

    // Dot indicators (click to jump, delegated)
    _container.addEventListener('click', function (e) {
      var dot = e.target.closest('.deck-dot');
      if (!dot) return;
      _currentIndex = parseInt(dot.dataset.index, 10);
      _renderBrowseMode();
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

    // Speaker buttons (TTS) — event delegation
    if (_container) {
      _container.querySelectorAll('.hub-flashcard-speaker-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var term = btn.dataset.speakerTerm;
          if (term) {
            btn.classList.add('speaking');
            playPronunciation(term);
            // Remove speaking class when speech ends
            var removeSpeaking = function () { btn.classList.remove('speaking'); };
            if (window.speechSynthesis) {
              var cleanup = function () {
                window.speechSynthesis.removeEventListener('end', cleanup);
                window.speechSynthesis.removeEventListener('error', cleanup);
                removeSpeaking();
              };
              window.speechSynthesis.addEventListener('end', cleanup);
              window.speechSynthesis.addEventListener('error', cleanup);
            } else {
              setTimeout(removeSpeaking, 1500);
            }
          }
        });
      });
    }
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

    // NOTE: Intentionally NO "close on backdrop click" for this modal.
    // The user must click the Cancel button to avoid accidental data loss.

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

      _isGenerating = false;
      _setGenerateLoading(overlay, false);
      _clearStatus();

      // Close the generate modal and open the card editor with AI data pre-filled
      _closeAddForm();
      _showCardEditorModal(cardData, true); // true = prefill mode (saves as NEW card)

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

  function _showCardEditorModal(card, isPrefill) {
    // Prevent multiple overlays
    if (document.getElementById('card-editor-overlay')) return;

    const isEdit = !!card && !isPrefill;
    const title = isPrefill ? 'Review AI Card' : (isEdit ? 'Edit Card' : 'New Card');
    const subtitle = isPrefill ? 'Edit fields below, then save to your deck' : (isEdit ? `Editing "${card.term}"` : 'Fill in the fields manually');

    const term = card ? card.term : '';
    const type = card ? card.type : '';
    const phonetic = card ? card.phonetic : '';
    const vietnamese = card ? card.vietnamese : '';
    const describe = card && card.describe ? card.describe.join('\n') : '';
    const examples = card && card.examples ? card.examples.join('\n') : '';
    const synonyms = card && card.synonyms ? card.synonyms.join(', ') : '';
    const note = card && card.note ? card.note.join('\n') : '';
    const clozeSentence = card && card.clozeSentence ? card.clozeSentence : '';
    const imageUrl = card && card.imageUrl ? card.imageUrl : '';

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

          <div class="form-group">
            <label>🖼️ Visual Memory (Optional)</label>
            <input type="text" id="ceditor-image" class="card-editor-input hub-flashcard-visual-input" value="${_esc(imageUrl)}" placeholder="Paste an image from clipboard, or type a URL..." autocomplete="off">
            <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted);">Copy an image (Ctrl+C), then paste it here (Ctrl+V). Auto-compresses to save space.</span>
          </div>

          <div class="form-group">
            <label>Cloze Sentence (Fill-in-the-blank)</label>
            <textarea id="ceditor-cloze" class="card-editor-textarea" rows="2" placeholder="Example sentence with ___ where the word goes, e.g. We need a ___ approach to solve this.">${_esc(clozeSentence)}</textarea>
            <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted);">Use ___ (three underscores) as placeholder for the target word.</span>
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

    // NOTE: Intentionally NO "close on backdrop click" for this modal.
    // The user must click the Cancel button to avoid accidental data loss.

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
    const cardToSave = isPrefill ? null : card;
    overlay.querySelector('#btn-save-card')
      .addEventListener('click', () => _handleSaveCard(overlay, cardToSave));

    // --- Ctrl+Enter to save ---
    overlay.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        _handleSaveCard(overlay, cardToSave);
      }
    });

    // --- Clipboard paste: image → compressed base64 injection ---
    _attachImagePasteHandler(overlay);

    // Focus first input
    setTimeout(() => {
      const inp = overlay.querySelector('#ceditor-term');
      if (inp) inp.focus();
    }, 150);
  }

  /**
   * Attach a paste event listener to the Visual Memory input field.
   * Detects image clipboard data, compresses it via <canvas> to JPEG
   * @ 70% quality (max 800px), then sets the compressed Base64 Data URL
   * as the field's value and dispatches an 'input' event so the existing
   * save logic picks up the new value.
   */
  function _attachImagePasteHandler(overlay) {
    var inputField = overlay.querySelector('#ceditor-image');
    if (!inputField) return;

    inputField.addEventListener('paste', function (e) {
      // Abort if clipboard API not supported
      if (!e.clipboardData || !e.clipboardData.items) return;

      var items = e.clipboardData.items;
      var imageItem = null;

      // Find the first image item in the paste payload
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          imageItem = items[i];
          break;
        }
      }

      // No image found — let the browser handle it as text paste normally
      if (!imageItem) return;

      // Image detected — stop the browser from pasting raw text
      e.preventDefault();

      var file = imageItem.getAsFile();
      if (!file) return;

      // --- Mark field as processing ---
      var originalPlaceholder = inputField.placeholder;
      inputField.value = 'Processing image...';
      inputField.disabled = true;

      // --- Read file → compress → inject ---
      var reader = new FileReader();

      reader.onload = function (loadEvt) {
        var img = new Image();

        img.onload = function () {
          // Compute compressed dimensions (max 800px, maintain aspect ratio)
          var MAX_DIM = 800;
          var w = img.width;
          var h = img.height;

          if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) {
              h = Math.round(h * (MAX_DIM / w));
              w = MAX_DIM;
            } else {
              w = Math.round(w * (MAX_DIM / h));
              h = MAX_DIM;
            }
          }

          // Create canvas and draw scaled image
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          // Export as JPEG @ 70% quality — dramatic size reduction vs PNG base64
          var compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);

          // --- Inject the compressed base64 ---
          inputField.value = compressedDataUrl;
          inputField.placeholder = originalPlaceholder;
          inputField.disabled = false;

          // Dispatch 'input' event so any auto-save/debounce or Save button
          // logic picks up the new value and persists it to Firestore.
          inputField.dispatchEvent(new Event('input', { bubbles: true }));

          // Clean up canvas reference
          canvas.width = 0;
          canvas.height = 0;
        };

        img.onerror = function () {
          // Failed to decode the image — restore field gracefully
          inputField.value = '';
          inputField.placeholder = 'Image paste failed. Try again or paste a URL.';
          inputField.disabled = false;
        };

        // Start decoding
        img.src = loadEvt.target.result;
      };

      reader.onerror = function () {
        // FileReader failed — restore field
        inputField.value = '';
        inputField.placeholder = 'Image paste failed. Try again or paste a URL.';
        inputField.disabled = false;
      };

      // Start reading the file
      reader.readAsDataURL(file);
    });
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
    const clozeRaw      = (overlay.querySelector('#ceditor-cloze')?.value || '').trim();
    const imageUrl     = (overlay.querySelector('#ceditor-image')?.value || '').trim();

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
      collocations: existingCard ? (existingCard.collocations || []) : [],
      clozeSentence: clozeRaw,
      imageUrl: imageUrl
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
     TEXT-TO-SPEECH: Speak a word using the Web Speech API
     ========================================================== */

  /**
   * Pronounce the given word using SpeechSynthesis.
   * Uses the user's saved voiceSpeed setting and selects a
   * native en-US voice if available.
   */
  function playPronunciation(word) {
    if (!window.speechSynthesis) {
      console.warn('[Flashcard] SpeechSynthesis not supported.');
      return;
    }

    // Cancel any in-progress speech to avoid overlap
    window.speechSynthesis.cancel();

    var utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = _voiceSpeed;

    // Attempt to select a native en-US voice.
    // Chrome loads voices asynchronously; getVoices() may be empty
    // on first call. We try once synchronously, then fall back to
    // the voiceschanged event or a delayed retry.
    var voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) {
      try {
        // Some browsers return empty until the first speak() call
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel();
        voices = window.speechSynthesis.getVoices();
      } catch (_) {}
    }

    var enUsVoice = voices.find(function (v) {
      return v.lang === 'en-US' || v.lang.startsWith('en-US');
    });

    if (enUsVoice) {
      utterance.voice = enUsVoice;
    }

    window.speechSynthesis.speak(utterance);
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
   * Normalize a string for comparison: lowercase, trim whitespace,
   * collapse multiple spaces, remove leading/trailing punctuation noise.
   */
  function _normalizeStr(str) {
    return (str || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
        clozeSentence: card.clozeSentence || '',
        imageUrl: card.imageUrl || '',
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
      clozeSentence: card.clozeSentence || '',
      imageUrl: card.imageUrl || '',
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
    destroy,
    // Expose for cross-module access (dashboard greeting, sidebar i18n, etc.)
    applyLanguage: applyLanguage,
    _getI18N: function () { return I18N; }
  };

})();

// Auto-register with the app router
if (typeof app !== 'undefined') {
  app.register(flashcardModule);
}
