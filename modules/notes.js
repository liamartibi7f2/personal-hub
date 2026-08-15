/* ============================================================
   HUB.OS — modules/notes.js
   Notion-like rich text notes module with folder organization,
   auto-save, slash commands, and a floating formatting toolbar.
   ============================================================ */
// ==========================================
// TÍNH NĂNG: COPY/PASTE ẢNH LÊN CLOUD (IMGBB)
// ==========================================

function setupNoteImagePaste() {
    // Thay '.note-editor' bằng class hoặc ID vùng viết Note của bạn
    const noteEditor = document.querySelector('.note-editor'); 
    if (!noteEditor) return;

    noteEditor.addEventListener('paste', async (e) => {
        // Lấy dữ liệu từ Clipboard
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let imageFile = null;

        // Quét xem trong thứ vừa Paste có chứa file Ảnh không
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                imageFile = item.getAsFile();
                break;
            }
        }

        // Nếu là ảnh -> Bắt đầu quy trình Cloud
        if (imageFile) {
            e.preventDefault(); // CHẶN NGAY việc trình duyệt tự dán mã Base64 nặng nề

            // 1. Chèn hiệu ứng Loading tại vị trí con trỏ nhấp nháy
            const loadingId = 'img-loading-' + Date.now();
            const loadingHtml = `<span id="${loadingId}" style="color: var(--primary-color, #00e676); font-style: italic; font-weight: bold;">[⏳ Đang tải ảnh lên Cloud...]</span>`;
            document.execCommand('insertHTML', false, loadingHtml);

            // 2. Gửi ảnh lên Cloud
            try {
                const imageUrl = await uploadToImgBB(imageFile);

                // 3. Nhận Link về -> Thay thế chữ Loading bằng tấm ảnh thật
                const loadingSpan = document.getElementById(loadingId);
                if (loadingSpan) {
                    const imgTag = document.createElement('img');
                    imgTag.src = imageUrl;
                    imgTag.style.maxWidth = '100%';
                    imgTag.style.borderRadius = '8px'; // Bo góc chuẩn UI Hub.OS
                    imgTag.style.marginTop = '10px';
                    imgTag.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)'; // Đổ bóng nhẹ
                    
                    // Tráo đổi span loading bằng thẻ img
                    loadingSpan.parentNode.replaceChild(imgTag, loadingSpan);
                }
            } catch (error) {
                console.error("Lỗi upload ảnh:", error);
                const loadingSpan = document.getElementById(loadingId);
                if (loadingSpan) loadingSpan.innerText = '[❌ Lỗi tải ảnh. Vui lòng thử lại!]';
            }
        }
    });
}

// Hàm kết nối API (Xử lý ngầm)
async function uploadToImgBB(file) {
    // API Key của ImgBB (Miễn phí, thay khóa của bạn vào đây)
    const API_KEY = '02bc2aa57ceb6ba1b2666abb41b6082d'; 
    
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${API_KEY}`, {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    if (data.success) {
        return data.data.url; // Trả về đường link ảnh trực tiếp (URL)
    } else {
        throw new Error('Upload Cloud thất bại');
    }
}
// ── Focus Writing Timer (SVG Circle + Persistent State + Beep-Beep Alarm) ──
function NotesTimer(displayEl, progressCircle, playBtn, resetBtn) {
  var self = this;

  self.displayEl        = displayEl;       // Text node inside SVG (e.g. <span>)
  self.progressCircle   = progressCircle;  // SVG <circle> for dashoffset animation
  self.playBtn          = playBtn;
  self.resetBtn         = resetBtn;

  self.remainingSeconds = 0;
  self.totalDuration    = 0;              // total secs for this session
  self.intervalId       = null;
  self.isRunning        = false;
  self.isRinging        = false;          // alarm-active flag
  self.alarmInterval    = null;           // setInterval handle for the beep loop
  self._audioCtx        = null;           // lazy-created AudioContext (resumed on user gesture)
  self.allowBackground  = false;          // when true, do NOT auto-pause on tab switch
  self._visChangeBound  = null;

  // ── Config ──
  var ALARM_COLOR    = '#ff4466';         // cyberpunk red used while ringing
  var BEEP_INTERVAL  = 1200;              // ms between double-beeps
  var BEEP_FREQ      = 880;               // Hz — classic digital alarm tone
  var BEEP_BURST_MS  = 120;               // duration of each "beep" burst
  var BEEP_GAP_MS    = 120;               // silence between the two bursts in a pair

  function _readDuration() {
    try {
      var v = parseInt(localStorage.getItem('hub_os_notes_timer_duration'), 10);
      return (v >= 5 && v <= 120) ? v : 30;
    } catch (_) { return 30; }
  }

  function _format(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ── Lazy AudioContext (Safari/iOS requires creation inside a user gesture) ──
  function _getAudioCtx() {
    if (self._audioCtx) {
      try {
        if (self._audioCtx.state === 'suspended') self._audioCtx.resume();
      } catch (_) { /* ignore */ }
      return self._audioCtx;
    }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      self._audioCtx = new Ctx();
      return self._audioCtx;
    } catch (_) {
      return null;
    }
  }

  // ── Synthesize "beep beep" — two short square-wave bursts at 880Hz ──
  function _playBeep() {
    var ctx = _getAudioCtx();
    if (!ctx) return;          // no Web Audio support → silent no-op
    if (ctx.state === 'suspended') ctx.resume();

    var now = ctx.currentTime;
    var dur = BEEP_BURST_MS / 1000;

    for (var i = 0; i < 2; i++) {
      var startOffset = i * (BEEP_BURST_MS + BEEP_GAP_MS) / 1000;

      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(BEEP_FREQ, now + startOffset);

      // Envelope: quick attack so the square wave doesn't click,
      // exponential release to silence at the end of each burst.
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + startOffset + 0.01);
      gain.gain.setValueAtTime(0.25, now + startOffset + dur - 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.02);
    }
  }

  // ── SVG Circle Animation ──
  var CIRCLE_RADIUS  = 36;
  var CIRCUMFERENCE  = 2 * Math.PI * CIRCLE_RADIUS; // ~226.19

  function _updateCircle(ratio) {
    if (!self.progressCircle) return;
    // ratio: 0 → full, 1 → empty (dashoffset = 0 means fully drawn)
    var offset = CIRCUMFERENCE * (1 - ratio);
    self.progressCircle.style.strokeDashoffset = offset;
  }

  // ── Combined display update ──
  function _updateDisplay() {
    var sec = self.remainingSeconds;
    var dur = self.totalDuration;
    if (self.displayEl) {
      self.displayEl.textContent = _format(sec);
    }
    if (dur > 0) {
      _updateCircle(sec / dur);
    }
  }

  // ── Tick ──
  function _tick() {
    if (self.remainingSeconds <= 0) {
      self.pause();
      if (self.displayEl) self.displayEl.textContent = '00:00';
      _updateCircle(0); // empty ring
      self.startAlarm(); // fire the looped beep-beep alarm
      return;
    }
    self.remainingSeconds--;
    _updateDisplay();
    _saveState();
  }

  // ── Alarm ──
  self.startAlarm = function () {
    if (self.isRinging) return;             // already ringing → no-op
    self.isRinging = true;

    // Immediate first beep, then loop every 1.2s
    _playBeep();
    self.alarmInterval = setInterval(_playBeep, BEEP_INTERVAL);

    // Visual alert — flip display + ring stroke to red
    if (self.displayEl)      self.displayEl.style.color = ALARM_COLOR;
    if (self.progressCircle) self.progressCircle.style.stroke = ALARM_COLOR;

    _saveState();
  };

  self.stopAlarm = function () {
    if (!self.isRinging && !self.alarmInterval) return; // already silent
    if (self.alarmInterval) {
      clearInterval(self.alarmInterval);
      self.alarmInterval = null;
    }
    self.isRinging = false;

    // Clear the inline red styles so the display returns to its CSS color
    if (self.displayEl)      self.displayEl.style.color = '';
    if (self.progressCircle) self.progressCircle.style.stroke = '';

    _saveState();
  };

  // ── Actions ──
  self.reset = function () {
    self.stopAlarm();                       // never let the alarm outlive reset
    self.pause();
    self.totalDuration    = _readDuration() * 60;
    self.remainingSeconds = self.totalDuration;
    _updateDisplay();
    _saveState();
  };

  self.start = function () {
    // ▶ BUTTON ACTS AS "STOP ALARM" WHILE RINGING ──
    // The Play button doubles as the alarm-stop control. When the alarm
    // is going off, pressing ▶ silences the looped beeps AND resets
    // the timer back to a full session. The user then presses ▶ again
    // to start the next countdown.
    if (self.isRinging) {
      self.stopAlarm();
      self.totalDuration    = _readDuration() * 60;
      self.remainingSeconds = self.totalDuration;
      _updateDisplay();
      _saveState();
      return;                                // ← do NOT start the countdown
    }

    if (self.isRunning) return;
    if (self.remainingSeconds <= 0) {
      self.totalDuration    = _readDuration() * 60;
      self.remainingSeconds = self.totalDuration;
      _updateDisplay();
    }
    self.isRunning  = true;
    self.intervalId = setInterval(_tick, 1000);
    _saveState();
  };

  self.pause = function () {
    if (!self.isRunning) return;
    self.isRunning  = false;
    if (self.intervalId) {
      clearInterval(self.intervalId);
      self.intervalId = null;
    }
    _saveState();
  };

  // ── State persistence (FREEZE across module switches) ──
  function _saveState() {
    if (typeof window !== 'undefined') {
      window.HubOS_NotesTimerState = {
        timeLeft:          self.remainingSeconds,
        totalDuration:     self.totalDuration,
        isPaused:          !self.isRunning,
        isRinging:         self.isRinging,
        allowBackground:   self.allowBackground
      };
    }
  }

  function _restoreState() {
    if (typeof window !== 'undefined' && window.HubOS_NotesTimerState) {
      var s = window.HubOS_NotesTimerState;
      if (typeof s.timeLeft === 'number' && s.timeLeft >= 0
          && typeof s.totalDuration === 'number' && s.totalDuration > 0) {
        self.totalDuration    = s.totalDuration;
        self.remainingSeconds = s.timeLeft;
        self.isRunning        = false;       // always remain paused on restore
        self.allowBackground  = s.allowBackground === true; // default OFF
        // If the alarm was firing when the user last switched away,
        // re-arm it on reload so the beeps resume — the user didn't
        // explicitly stop them. (Requires a fresh user gesture to
        // actually emit sound on some browsers, which is fine.)
        if (s.isRinging) {
          self.isRinging = true;
          self.startAlarm();
        }
        return true;
      }
    }
    return false;
  }

  // ── Destroy ──
  self.destroy = function () {
    self.stopAlarm();                       // kill any looping beep loop first
    _saveState();                           // freeze current state
    self.pause();
    if (self._visChangeBound) {
      document.removeEventListener('visibilitychange', self._visChangeBound);
      self._visChangeBound = null;
    }
  };

  // ── Init ──
  if (_restoreState()) {
    // Restored from frozen state — keep paused, show saved time
    _updateDisplay();
  } else {
    self.totalDuration    = _readDuration() * 60;
    self.remainingSeconds = self.totalDuration;
    _updateDisplay();
  }
  _saveState();

  // ── Background-run toggle ──
  /**
   * Toggle whether this timer should keep running when the tab is hidden.
   * Reflects state on the supplied button DOM element (🔒 / 🔓 + class).
   * Safe to call with no element — just flips the flag and persists.
   */
  self.toggleBackgroundMode = function (btnEl) {
    self.allowBackground = !self.allowBackground;
    if (btnEl) {
      // Icon swapping is now handled entirely by CSS via SVG visibility,
      // so we only flip the state class + ARIA flag here.
      btnEl.classList.toggle('hub-notes-timer-btn--unlocked', self.allowBackground);
      btnEl.setAttribute('aria-pressed', self.allowBackground ? 'true' : 'false');
    }
    _saveState();
  };

  // Visibility change: auto-pause when tab hidden (unless background-run is on)
  self._visChangeBound = function () {
    if (document.hidden && self.isRunning && !self.allowBackground) {
      self.pause();
    }
  };
  document.addEventListener('visibilitychange', self._visChangeBound);
}

const notesModule = (function () {
  'use strict';

  // ── Constants ──
  const SAVE_DELAY  = 500;

  // ── Private state ──
  let _data         = null;
  let _activeFolder = null;
  let _activeNote   = null;
  let _container    = null;
  let _isDataLoaded = false;
  /** ⚠ LOAD GUARD: Prevents auto-save from overwriting cloud data
   *  with empty [] before data has finished loading from Firestore.
   *  Only set to true AFTER cloud data is received and rendered.     */
  let _isNotesDataLoaded = false;
  /**
   * ⚡ SESSION-LEVEL INIT FLAG: Set to true after the first successful
   *    load + render in this browser session. NEVER reset by destroy().
   *    This prevents re-fetching from Firestore on tab switches,
   *    eliminating the race condition that resets notes to "Welcome".
   *    Only reset by clearData() on explicit logout.
   */
  let _sessionInitialized = false;
  let _autoSaveEnabled = true;
  let _timer = null; // Focus Writing Timer
  let isToolbarFixed = false; // Track if toolbar is in fixed/static mode
  let _pageUnloading = false; // Prevents ghost saves during page reload

  // ── Time Capsule (note lock) state ──
  let _lockInterval = null;       // ticks #hn-locked-countdown each second
  let _penaltyInterval = null;    // ticks 60s bypass cooldown
  let _unlockEarlyBound = false;  // one-shot guard for delegated unlock-early handler

  // ── Image selection state ──
  /** @type {HTMLElement|null} Currently selected <img> inside #hn-editor (for float toolbar) */
  let _selectedImage = null;

  // ── Vault / History listener management ──
  /** @type {function|null} Firestore onSnapshot unsubscribe for vault history */
  let _vaultHistoryListener = null;
  /** @type {boolean} Track whether the history modal is currently open */
  let _historyModalOpen = false;

  // Cached DOM refs
  let _el = {
    sidebarNotes:    null,
    folderList:      null,
    titleInput:      null,
    editor:          null,
    toolbar:         null,
    savingIndicator: null,
    emptyState:      null,
    editorPane:      null,
    addBtn:          null,
    addFolderBtn:    null,
    manualSaveBtn:   null,
    saveFeedback:    null,
    searchBtn:       null,
    searchBar:       null,
    searchInput:     null,
    searchClear:     null,
    dateContainer:   null,
    dateText:        null,
    dateInput:       null,
    backupBtn:       null,
    historyBtn:      null,
    historyOverlay:  null,
    historyClose:    null,
    historyList:     null,
    historyLoading:  null,
    historyEmpty:    null,
    historyBody:     null,
    spellcheckBtn:  null,
    timerDisplay:   null,
    timerCircle:    null,
    timerPlayBtn:   null,
    timerResetBtn:  null,
    timerBgBtn:     null
  };

  // ── Ghost save guard ──
  // The moment the browser starts unloading (page reload / tab close),
  // mark _pageUnloading so no setTimeout callback will fire a write.
  window.addEventListener('beforeunload', function () {
    _pageUnloading = true;
    HubDebounce.cancel('notes-auto-save');
  });

  // Bound handler references for cleanup
  let _boundDocMouseup  = null;
  let _boundDocMousedown = null;
  let _boundDocKeyup    = null;
  let _boundDocKeydown  = null;

  // ============================================================
  //   STORAGE
  // ============================================================

  async function _loadData() {
    try {
      const data = await HubDB.loadNotesData();
      if (data && Array.isArray(data.folders)) {
        // Clean corrupted notes (null/undefined) from previous crashes
        data.folders.forEach(function(f) {
          if (f.notes && Array.isArray(f.notes)) {
            f.notes = f.notes.filter(function(n) { return n && n.id; });
          } else {
            f.notes = [];
          }
        });
        // Only accept if at least one folder exists
        if (data.folders.length > 0) {
          _data = data;
          _isDataLoaded = true;
          return;
        }
      }
    } catch (_) { /* ignore */ }

    // No data exists yet (new user or empty workspace).
    // Initialize with empty array — NO default folders, NO default notes.
    // The workspace is only populated when the user explicitly clicks
    // "Add Folder" or "Add Note" in the UI.
    _data = { folders: [] };
    _isDataLoaded = true;
  }

  async function _persist(force) {
    // ⚠ LOAD GUARD: NEVER write to storage before cloud data is confirmed loaded.
    // This prevents an empty template [] from overwriting good cloud data
    // during the startup race between the auto-save timer and the Firestore fetch.
    if (!_isNotesDataLoaded) {
      console.warn("SAVE BLOCKED: Data has not finished loading from Cloud yet.");
      return;
    }
    if (!_isDataLoaded) {
      console.warn("SAVE BLOCKED: _isDataLoaded is false.");
      return;
    }
    if (!force && !_autoSaveEnabled) return;
    if (_pageUnloading) return; // Prevent ghost saves during page reload

    _showSaving(true, 'SYNCING TO CLOUD...');
    // Safety net: force "Saved" after 8s to prevent stuck indicator
    var safetyTimer = setTimeout(function () {
      _showSaving(false);
    }, 8000);
    try {
      await HubDB.saveNotesData(_data);
      clearTimeout(safetyTimer);
      _showSaving(false);
    } catch (_) {
      clearTimeout(safetyTimer);
      _showSaving(false);
    }
  }

  function _scheduleSave() {
    // ⚠ LOAD GUARD: Don't schedule auto-saves until data is fully loaded.
    if (!_isNotesDataLoaded) return;
    if (_pageUnloading) return; // Don't schedule saves during page reload
    HubDebounce.call('notes-auto-save', _persist, SAVE_DELAY);
  }

  function _showSaving(active, customMsg) {
    var el = _el.savingIndicator;
    if (!el) return;
    el.textContent = active ? (customMsg || 'Saving...') : 'Saved';
    if (active) {
      el.classList.add('hub-notes-saving--active');
    } else {
      el.classList.remove('hub-notes-saving--active');
    }
  }

  // ============================================================
  //   HELPERS
  // ============================================================

  function _uid() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  // ĐÃ SỬA LỖI TRÙNG TÊN: Hàm này dùng để tạo dữ liệu Note
  function _buildNoteObject(title, content) {
    return {
      id: _uid(),
      title: title || 'Untitled',
      content: content || '',
      folderId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function _escHtml(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function _qs(id) {
    var el = document.getElementById(id);
    return el;
  }

  // ============================================================
  //   RENDER — Entry Point
  // ============================================================

  async function render(container) {
    _container = container;

    // ⚡ FAST PATH: If already initialized in this session, skip the async
    //    Firestore fetch entirely. Just re-render the UI from memory.
    //    This prevents the race condition where rapid tab switches trigger
    //    multiple _loadData() calls that overwrite each other.
    if (_sessionInitialized && _data) {
      _isNotesDataLoaded = true;
      // Restore active selections if they were lost (defensive — destroy()
      // should preserve them, but handle the edge case anyway)
      if (!_activeFolder && _data.folders && _data.folders.length > 0) {
        _activeFolder = _data.folders[0];
      }
      if (!_activeNote && _activeFolder && _activeFolder.notes) {
        _activeNote = _activeFolder.notes[0] || null;
      }
      _renderUI();
      // ⚠ NO auto-save here — only explicit user actions trigger persist.
      return;
    }

    // 1) Show loading state immediately
    container.innerHTML =
      '<div class="tab-content hub-notes-app" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
        '<div class="hub-notes-loading" style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem">' +
          '<span class="hub-notes-loading-dot">●</span> Loading workspace...' +
        '</div>' +
      '</div>';

    // 2) Await data (async — may hit Firestore)
    await _loadData();

    // 3) Initialize active selections
    //    Safe: _data.folders may be empty (new user) — handle gracefully
    _activeFolder = _data.folders && _data.folders.length > 0 ? _data.folders[0] : null;
    _activeNote   = (_activeFolder && _activeFolder.notes && _activeFolder.notes.length > 0)
                      ? _activeFolder.notes[0]
                      : null;

    // 4) UNLOCK the Load Guard: Cloud data has been received and is about to be rendered.
    //    This is the only place where _isNotesDataLoaded becomes true.
    //    From this point forward, auto-save is allowed to write to storage
    //    (but ONLY triggered by explicit user actions — typing, adding folders/notes).
    _isNotesDataLoaded = true;
    _sessionInitialized = true;

    // 5) Overwrite with real Notes UI
    _renderUI();

    // ⚠ NO auto-save after render.
    //    The workspace was loaded from cloud/localStorage as-is.
    //    Persist only fires when the user explicitly edits content,
    //    creates a folder, or clicks the manual Save button.
  }

  /**
   * _renderUI — Injects the notes DOM template, caches element refs,
   * renders folder/note lists, loads active note into the editor, and
   * binds all event listeners. Called on first load AND on every tab-
   * switch if _sessionInitialized is true, so the DOM is always fresh.
   */
  function _renderUI() {
    _container.innerHTML =
      '<div class="tab-content hub-notes-app">' +
        '<aside class="hub-notes-sidebar glass" id="hn-sidebar">' +
          '<div class="hub-notes-sidebar-header">' +
            '<span class="hub-notes-sidebar-title">Notes</span>' +
            '<div class="hub-notes-sidebar-actions">' +
              '<button class="hub-notes-btn-add hub-notes-btn-search" id="hn-btn-search" title="Search Notes" aria-label="Search Notes">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
                  '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" fill="none"/>' +
                  '<path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '</svg>' +
              '</button>' +
              '<button class="hub-notes-btn-add" id="hn-btn-add-folder" title="New Desk" aria-label="New Desk">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
                  '<path d="M2 6l6-4 6 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6z" stroke="currentColor" stroke-width="1.3" fill="none"/>' +
                  '<path d="M8 10v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '</svg>' +
              '</button>' +
              '<button class="hub-notes-btn-add" id="hn-btn-add" title="New Note" aria-label="New Note">' +
                '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
                  '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="hub-notes-search-bar" id="hn-search-bar" style="display:none">' +
            '<input type="text" class="hub-notes-search-input" id="hn-search-input" placeholder="Search keywords..." spellcheck="false" />' +
            '<button class="hub-notes-search-clear" id="hn-search-clear" aria-label="Clear search">✕</button>' +
          '</div>' +
          '<div class="hub-notes-folder-list" id="hn-folder-list"></div>' +
          '<div class="hub-notes-divider"></div>' +
          '<div class="hub-notes-note-list" id="hn-note-list"></div>' +
          '<div class="hub-notes-saving" id="hn-saving">Saved</div>' +
        '</aside>' +
        '<main class="hub-notes-editor-pane" id="hn-editor-pane">' +
          '<div class="hub-notes-editor-toolbar">' +
            '<div class="hn-layout-menu-container">' +
              '<button id="hn-focus-toggle" class="hub-notes-tb-btn" title="Toggle Focus Mode" aria-label="Toggle Focus Mode" aria-expanded="false">' +
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect x="2" y="2" width="12" height="12" rx="2" />' +
                  '<line x1="6" y1="2" x2="6" y2="14" />' +
                '</svg>' +
              '</button>' +
              '<div id="hn-layout-dropdown" class="hn-layout-dropdown" style="display: none;">' +
                '<button id="hn-opt-sidebar" class="hn-dropdown-item">◧ Toggle Sidebar</button>' +
                '<button id="hn-opt-zen" class="hn-dropdown-item">🗖 Zen Mode</button>' +
              '</div>' +
            '</div>' +
            '<button class="hub-notes-save-btn" id="hn-btn-manual-save" title="Save now" aria-label="Save notes">' +
              '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="hub-notes-save-icon">' +
                '<path d="M13 3H3a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V5l-3-2z" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
                '<path d="M11 3v3H5V3" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
                '<circle cx="8" cy="10" r="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">Save</span>' +
            '</button>' +
            '<button class="hub-notes-backup-btn" id="hn-btn-backup" title="Cloud Snapshot Backup" aria-label="Backup notes to cloud vault">' +
              '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" class="hub-notes-backup-icon">' +
                '<path d="M10 4v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '<path d="M6 9l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
                '<path d="M3 12v3a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0017 15v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                '<path d="M10 3a3 3 0 00-3 3h6a3 3 0 00-3-3z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">Vault</span>' +
            '</button>' +
            '<button class="hub-notes-history-btn" id="hn-btn-history" title="Restore History" aria-label="Restore notes from vault history">' +
              '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" class="hub-notes-history-icon">' +
                '<circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.4" fill="none"/>' +
                '<path d="M10 6v4.5l3 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                '<path d="M2 10h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">History</span>' +
            '</button>' +
            '<button class="hub-notes-spellcheck-btn" id="hn-btn-spellcheck" title="Toggle Spellcheck" aria-label="Toggle spellcheck">' +
              '<svg class="hub-notes-spellcheck-btn-svg" width="14" height="14" viewBox="0 0 20 20" fill="none">' +
                '<path d="M4 2h12a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z" stroke="currentColor" stroke-width="1.3" fill="none"/>' +
                '<text x="10" y="14.5" text-anchor="middle" font-size="11" font-family="serif" font-style="italic" fill="currentColor">abc</text>' +
                '<line x1="3" y1="3" x2="17" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">Spell</span>' +
            '</button>' +
            '<button class="hub-notes-spellcheck-btn" id="hn-btn-pin" title="Toolbar" aria-label="Pin toolbar">' +
              '<svg class="hub-notes-spellcheck-btn-svg" width="14" height="14" viewBox="0 0 24 24" fill="none">' +
                '<path d="M12 17v5m-4.5-5h9M9 2h6v5l1 2v4H8V9l1-2V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">Pin</span>' +
            '</button>' +
            '<button class="hub-notes-spellcheck-btn hub-notes-lock-btn" id="hn-btn-lock" title="Time Capsule — lock this note until a future date" aria-label="Lock note with Time Capsule">' +
              '<svg class="hub-notes-spellcheck-btn-svg" width="14" height="14" viewBox="0 0 24 24" fill="none">' +
                '<rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
                '<path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
                '<circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>' +
              '</svg>' +
              '<span class="hub-notes-save-label">Lock</span>' +
            '</button>' +
            '<input type="datetime-local" id="hn-lock-datetime" class="hub-notes-lock-datetime" aria-hidden="true" tabindex="-1">' +
            '<span class="hub-notes-save-feedback" id="hn-save-feedback"></span>' +
            '<div class="hub-notes-timer" id="hn-timer">' +
              '<div class="hub-notes-timer-ring">' +
                '<svg viewBox="0 0 80 80" class="hub-notes-timer-svg">' +
                  '<circle class="hub-notes-timer-track" cx="40" cy="40" r="36" fill="none" />' +
                  '<circle class="hub-notes-timer-progress" id="hn-timer-circle" cx="40" cy="40" r="36" fill="none" />' +
                '</svg>' +
                '<span class="hub-notes-timer-display" id="hn-timer-display">30:00</span>' +
              '</div>' +
              '<button class="hub-notes-timer-btn" id="hn-timer-play" title="Start / Pause Timer" aria-label="Start or pause timer">▶</button>' +
              '<button class="hub-notes-timer-btn" id="hn-timer-reset" title="Reset Timer" aria-label="Reset timer">↺</button>' +
              '<button class="hub-notes-timer-btn" id="hn-timer-bg-toggle" title="Allow Background Run (Do not pause on tab switch)" aria-label="Toggle background run" aria-pressed="false">' +
                '<svg class="hn-timer-icon-locked" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
                  '<rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>' +
                  '<path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
                  '<circle cx="8" cy="10.5" r="1.1" fill="currentColor"/>' +
                '</svg>' +
                '<svg class="hn-timer-icon-unlocked" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
                  '<rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>' +
                  '<path d="M5 7V5a3 3 0 0 1 5.5-1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1.6 1.4"/>' +
                  '<circle cx="8" cy="10.5" r="1.1" fill="currentColor"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="hub-notes-editor-area">' +
            '<div class="hub-notes-date-container" id="hn-date-container">' +
              '<span class="hub-notes-date-text" id="hn-date-text">Set Date</span>' +
              '<input type="date" class="hub-notes-date-input" id="hn-date-input" />' +
            '</div>' +
            '<input type="text" class="hub-notes-title-input" id="hn-title-input" placeholder="Untitled" spellcheck="false" />' +
            '<div class="hub-notes-editor" id="hn-editor" contenteditable="true" data-placeholder="Start writing... /h1 /h2 /h3 for headings"></div>' +
          '</div>' +
          '<div class="hub-notes-empty-state" id="hn-empty-state" style="display:none">' +
            '<div class="hub-notes-empty-icon">' +
              '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">' +
                '<path d="M12 6v12M6 12h12"/>' +
              '</svg>' +
            '</div>' +
            '<p class="hub-notes-empty-title">No note selected</p>' +
            '<p class="hub-notes-empty-sub">Create a new note to get started</p>' +
          '</div>' +
          '<div class="hub-notes-locked-overlay" id="hn-locked-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="hn-locked-title">' +
            '<div class="hub-notes-locked-card">' +
              '<div class="hub-notes-locked-icon" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
                  '<rect x="4" y="11" width="16" height="10" rx="2"></rect>' +
                  '<path d="M8 11V7a4 4 0 1 1 8 0v4"></path>' +
                  '<circle cx="12" cy="16" r="1.4" fill="currentColor"></circle>' +
                '</svg>' +
              '</div>' +
              '<h2 class="hub-notes-locked-title" id="hn-locked-title">TIME CAPSULE</h2>' +
              '<p class="hub-notes-locked-desc">This note is locked until the timer reaches zero. Discipline builds mastery — no peeking.</p>' +
              '<div class="hub-notes-locked-countdown" id="hn-locked-countdown">--d --h --m --s</div>' +
              '<button class="hub-notes-unlock-early-btn" id="hn-btn-unlock-early" type="button">Unlock Early</button>' +
              '<div class="hub-notes-locked-penalty" id="hn-locked-penalty" style="display:none" role="alert" aria-live="polite">' +
                '<span class="hub-notes-penalty-label">COOLDOWN IN PROGRESS</span>' +
                '<span class="hub-notes-penalty-timer" id="hn-penalty-timer">60</span>' +
                '<span class="hub-notes-penalty-hint">Switch notes to abort this reckless override.</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</main>' +
        '<div class="hub-notes-history-overlay" id="hn-history-overlay" role="dialog" aria-modal="true" aria-label="Vault History">' +
                '<div class="hub-notes-history-modal glass">' +
                  '<div class="hub-notes-history-header">' +
                    '<h3 class="hub-notes-history-title">🕒 Vault History</h3>' +
                    '<button class="hub-notes-history-close" id="hn-history-close" aria-label="Close history">✕</button>' +
                  '</div>' +
                  '<div class="hub-notes-history-body">' +
                    '<div class="hub-notes-history-loading" id="hn-history-loading">' +
                      '<span class="hub-notes-loading-dot">●</span> Loading backups...' +
                    '</div>' +
                    '<div class="hub-notes-history-list" id="hn-history-list" style="display:none"></div>' +
                    '<div class="hub-notes-history-empty" id="hn-history-empty" style="display:none">' +
                      '<p>No backups found in the vault.</p>' +
                      '<p class="hub-notes-history-empty-sub">Use the Vault button to create your first snapshot backup.</p>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="hub-notes-float-toolbar" id="hn-float-toolbar" style="display:none">' +
          '<button class="hub-notes-tb-btn" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button>' +
          // Custom Font Size Tool: Left-click opens input, Right-click instantly applies saved size
          '<button class="hub-notes-tb-btn hub-notes-tb-size" id="hn-size-btn" title="Font Size (Click: set · Right-Click: apply saved)" aria-label="Custom Font Size">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<text x="2" y="12.5" font-family="monospace" font-size="10" font-weight="bold" fill="currentColor">T</text>' +
              '<path d="M9.5 9v4.5m-2-2.5h4M10.5 5.5l1.5 1.5 1.5-1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>' +
            '</svg>' +
          '</button>' +
          '<input type="number" id="hn-size-input" class="hub-notes-size-input" min="8" max="96" step="1" placeholder="px" aria-label="Custom font size in pixels" />' +
          '<span class="hub-notes-tb-sep"></span>' +
          '<button class="hub-notes-tb-btn" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button>' +
          '<button class="hub-notes-tb-btn" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>' +
          '<span class="hub-notes-tb-sep"></span>' +
          '<button class="hub-notes-tb-btn" data-cmd="justifyLeft" title="Align Left" aria-label="Align Left">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<path d="M2 3h12M2 6.5h8M2 10h10M2 13.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
          '<button class="hub-notes-tb-btn" data-cmd="justifyCenter" title="Align Center" aria-label="Align Center">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<path d="M2 3h12M4.5 6.5h7M3 10h10M5 13.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
          '<button class="hub-notes-tb-btn" data-cmd="justifyRight" title="Align Right" aria-label="Align Right">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<path d="M2 8h12M6 6.5h8M4 10h10M7 13.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
          '<button class="hub-notes-tb-btn" id="hn-quote-btn" title="Toggle Quote" aria-label="Quote">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path>' +
              '<path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path>' +
            '</svg>' +
          '</button>' +
          '<span class="hub-notes-tb-sep"></span>' +
          '<button class="hub-notes-tb-btn" data-cmd="insertUnorderedList" title="Bullet List" aria-label="Bullet List">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<path d="M4 4.5h10M4 8h10M4 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
              '<circle cx="2" cy="4.5" r="1" fill="currentColor"/>' +
              '<circle cx="2" cy="8" r="1" fill="currentColor"/>' +
              '<circle cx="2" cy="11.5" r="1" fill="currentColor"/>' +
            '</svg>' +
          '</button>' +
          '<span class="hub-notes-tb-sep"></span>' +
          '<input type="color" id="hn-color-picker" class="hub-notes-color-input" value="#00f0ff" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none">' +
          '<button class="hub-notes-tb-btn hub-notes-tb-highlight" id="hn-color-btn" title="Text Color" aria-label="Text color picker">A</button>' +
                '<span class="hub-notes-tb-sep"></span>' +
          '<input type="color" id="hn-highlight-picker" class="hub-notes-color-input" value="#fff000" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none">' +
          '<button class="hub-notes-tb-btn" id="hn-highlight-btn" title="Highlight (Bôi màu nền)" aria-label="Highlight text">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
              '<path d="M15.5 3.5l5 5L7 22H2v-5L15.5 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
              '<line x1="2" y1="22" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
          '<span class="hub-notes-tb-sep"></span>' +
        '</div>' +
      '</div>';

    // ⚠ CLEANUP STALE LISTENERS: Any previous render cycle may have
    //    left a dangling onSnapshot subscription. Kill it before we
    //    re-cache DOM refs and re-bind events so the new history overlay
    //    gets a clean subscription slate.
    _unsubscribeVaultListeners();

    // Cache all DOM refs
    _el.sidebarNotes    = _qs('hn-note-list');
    _el.folderList      = _qs('hn-folder-list');
    _el.titleInput      = _qs('hn-title-input');
    _el.editor          = _qs('hn-editor');
    _el.toolbar         = _qs('hn-float-toolbar');
    _el.savingIndicator = _qs('hn-saving');
    _el.manualSaveBtn   = _qs('hn-btn-manual-save');
    _el.saveFeedback    = _qs('hn-save-feedback');
    _el.emptyState      = _qs('hn-empty-state');
    _el.editorPane      = _qs('hn-editor-pane');
    _el.addBtn          = _qs('hn-btn-add');
    _el.addFolderBtn    = _qs('hn-btn-add-folder');
    _el.searchBtn       = _qs('hn-btn-search');
    _el.searchBar       = _qs('hn-search-bar');
    _el.searchInput     = _qs('hn-search-input');
    _el.searchClear     = _qs('hn-search-clear');
    _el.dateContainer   = _qs('hn-date-container');
    _el.dateText        = _qs('hn-date-text');
    _el.dateInput       = _qs('hn-date-input');
    _el.backupBtn       = _qs('hn-btn-backup');
    _el.historyBtn      = _qs('hn-btn-history');
    _el.historyOverlay  = _qs('hn-history-overlay');
    _el.historyClose    = _qs('hn-history-close');
    _el.historyList     = _qs('hn-history-list');
    _el.historyLoading  = _qs('hn-history-loading');
    _el.historyEmpty    = _qs('hn-history-empty');
    _el.historyBody     = null; // will be scoped from overlay
    _el.spellcheckBtn  = _qs('hn-btn-spellcheck');
    _el.timerDisplay   = _qs('hn-timer-display');
    _el.timerCircle    = _qs('hn-timer-circle');
    _el.timerPlayBtn   = _qs('hn-timer-play');
    _el.timerResetBtn  = _qs('hn-timer-reset');
    _el.timerBgBtn     = _qs('hn-timer-bg-toggle');
	
	// Bế Toolbar vào đúng bên trong khung Editor để ghim chuẩn xác
    if (_el.editorPane && _el.toolbar) {
        _el.editorPane.insertBefore(_el.toolbar, _el.editorPane.firstChild);
    }

    // ── Focus Writing Timer ──
    _timer = new NotesTimer(_el.timerDisplay, _el.timerCircle, _el.timerPlayBtn, _el.timerResetBtn);
    if (_el.timerPlayBtn) {
      _el.timerPlayBtn.addEventListener('click', function () {
        if (_timer.isRunning) { _timer.pause(); }
        else { _timer.start(); }
      });
    }
    if (_el.timerResetBtn) {
      _el.timerResetBtn.addEventListener('click', function () {
        _timer.reset();
      });
    }
    // ── Background-run toggle: 🔒 ↔ 🔓, prevents tab-switch auto-pause ──
    if (_el.timerBgBtn) {
      _el.timerBgBtn.addEventListener('click', function () {
        var btn = this;
        _timer.toggleBackgroundMode(btn);
      });
      // Reflect restored state (button was freshly injected by _renderUI).
      // CSS performs the icon swap; we only mirror the class + ARIA flag.
      _el.timerBgBtn.classList.toggle('hub-notes-timer-btn--unlocked', _timer.allowBackground);
      _el.timerBgBtn.setAttribute('aria-pressed', _timer.allowBackground ? 'true' : 'false');
    }

    // ── Layout Dropdown (Sidebar Toggle + Zen Mode) ──
    var focusToggle = document.getElementById('hn-focus-toggle');
    var dropdown = document.getElementById('hn-layout-dropdown');
    var optSidebar = document.getElementById('hn-opt-sidebar');
    var optZen = document.getElementById('hn-opt-zen');
    var sidebar = document.getElementById('hn-sidebar');
    var editorPane = document.getElementById('hn-editor-pane');

    // Toggle dropdown visibility
    if (focusToggle && dropdown) {
      focusToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dropdown.style.display === 'flex';
        dropdown.style.display = isOpen ? 'none' : 'flex';
        focusToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      });
    }

    // Option: Toggle Sidebar
    if (optSidebar && sidebar) {
      optSidebar.addEventListener('click', function (e) {
        e.stopPropagation();
        sidebar.classList.toggle('focus-collapsed');
        dropdown.style.display = 'none';
        focusToggle.setAttribute('aria-expanded', 'false');
      });
    }

    // Option: Zen Mode
    if (optZen && editorPane) {
      optZen.addEventListener('click', function (e) {
        e.stopPropagation();
        editorPane.classList.toggle('zen-mode-active');
        dropdown.style.display = 'none';
        focusToggle.setAttribute('aria-expanded', 'false');
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      if (dropdown && dropdown.style.display === 'flex') {
        var container = e.target.closest('.hn-layout-menu-container');
        if (!container) {
          dropdown.style.display = 'none';
          if (focusToggle) focusToggle.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Render lists
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();

    // Bind drag-and-drop reordering
    _bindDragAndDrop(_el.folderList, 'folders');
    _bindDragAndDrop(_el.sidebarNotes, 'notes');

    // Apply persisted spellcheck preference
    var spellPref = _loadSpellcheckPreference();
    _applySpellcheck(spellPref);

    // Bind all events
    _bindSearchEvents();
    _bindAddNote();
    _bindAddFolder();
    _bindEditorEvents();
    _bindFormatToolbar();
    _bindFolderClicks();
    _bindManualSave();
    _bindDateEvents();
    _bindBackupVault();
    _bindHistoryVault();
    _bindSpellcheckToggle();
    _bindImageSelection();
    _bindTimeCapsule();
  }

  // ============================================================
  //   DRAG & DROP — Reorder folders + notes
  // ============================================================

  /** @type {HTMLElement|null} Element currently being dragged */
  var _dragEl = null;

  /**
   * Read the current DOM order for a given list type and sync it
   * back to the underlying _data arrays, then persist.
   * @param {'folders'|'notes'} type
   */
  function _saveNewOrder(type) {
    if (type === 'folders') {
      var items = _el.folderList ? _el.folderList.querySelectorAll('.hub-notes-folder-item') : [];
      var newOrder = [];
      [].forEach.call(items, function (item) {
        var id = item.getAttribute('data-id');
        var folder = _data.folders.find(function (f) { return f.id === id; });
        if (folder) newOrder.push(folder);
      });
      if (newOrder.length === _data.folders.length) {
        _data.folders = newOrder;
      }
    } else if (type === 'notes') {
      if (!_activeFolder) return;
      var items = _el.sidebarNotes ? _el.sidebarNotes.querySelectorAll('.hub-notes-note-item') : [];
      var newOrder = [];
      [].forEach.call(items, function (item) {
        var id = item.getAttribute('data-id');
        var note = _activeFolder.notes.find(function (n) { return n && n.id === id; });
        if (note) newOrder.push(note);
      });
      if (newOrder.length === _activeFolder.notes.length) {
        _activeFolder.notes = newOrder;
      }
    }
    _persist();
  }

  /**
   * Compute whether the mouse is in the top or bottom half of the
   * hovered element to decide insert-before or insert-after.
   */
  function _getDropPosition(e, el) {
    var rect = el.getBoundingClientRect();
    var midY = rect.top + rect.height / 2;
    return e.clientY < midY ? 'above' : 'below';
  }

  /** Remove all drop-target indicator classes from a container. */
  function _clearDropTargets(container) {
    if (!container) return;
    var children = container.children;
    [].forEach.call(children, function (child) {
      child.classList.remove('drop-target-above', 'drop-target-below');
    });
  }

  /** Bind DnD delegation on a list container for either 'folders' or 'notes'. */
  function _bindDragAndDrop(container, type) {
    if (!container) return;

    container.addEventListener('dragstart', function (e) {
      var item = e.target.closest('.hub-notes-folder-item, .hub-notes-note-item');
      if (!item) { e.preventDefault(); return; }
      _dragEl = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.getAttribute('data-id'));
      // Attach drag type and context so folder drop targets can intercept notes
      e.dataTransfer.setData('drag-type', type === 'folders' ? 'folder' : 'note');
      if (type === 'notes') {
        e.dataTransfer.setData('note-id', item.dataset.noteId || '');
        e.dataTransfer.setData('source-folder-id', _activeFolder ? _activeFolder.id : '');
      } else {
        e.dataTransfer.setData('folder-id', item.dataset.folderId || '');
      }
    });

    container.addEventListener('dragend', function (e) {
      var item = e.target.closest('.hub-notes-folder-item, .hub-notes-note-item');
      if (item) item.classList.remove('dragging');
      _clearDropTargets(container);
      _clearFolderDropHighlight(container);
      _dragEl = null;
    });

    container.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // ---- Folder list: highlight entire folder when a note hovers it ----
      if (type === 'folders') {
        var dragType = e.dataTransfer.getData('drag-type');
        if (dragType === 'note') {
          _clearDropTargets(container);
          _clearFolderDropHighlight(container);
          var folderItem = e.target.closest('.hub-notes-folder-item');
          if (folderItem) {
            folderItem.classList.add('drop-target-folder');
          }
          return;
        }
      }

      var item = e.target.closest('.hub-notes-folder-item, .hub-notes-note-item');
      if (!item || item === _dragEl) {
        _clearDropTargets(container);
        return;
      }
      _clearDropTargets(container);
      var pos = _getDropPosition(e, item);
      item.classList.add('drop-target-' + pos);
    });

    container.addEventListener('dragleave', function (e) {
      var item = e.target.closest('.hub-notes-folder-item, .hub-notes-note-item');
      if (item) {
        item.classList.remove('drop-target-above', 'drop-target-below');
        item.classList.remove('drop-target-folder');
      }
    });

    container.addEventListener('drop', function (e) {
      e.preventDefault();

      // ---- Cross-container: Note dropped onto a folder in the folder list ----
      if (type === 'folders') {
        var dragType = e.dataTransfer.getData('drag-type');
        if (dragType === 'note') {
          var folderItem = e.target.closest('.hub-notes-folder-item');
          if (!folderItem) return;
          folderItem.classList.remove('drop-target-folder');

          var noteId = e.dataTransfer.getData('note-id');
          var sourceFolderId = e.dataTransfer.getData('source-folder-id');
          var targetFolderId = folderItem.dataset.folderId;
          if (!noteId || !targetFolderId || sourceFolderId === targetFolderId) return;

          var sourceFolder = _data.folders.find(function (f) { return f.id === sourceFolderId; });
          var targetFolder = _data.folders.find(function (f) { return f.id === targetFolderId; });
          if (!sourceFolder || !targetFolder) return;

          var noteIndex = sourceFolder.notes.findIndex(function (n) { return n && n.id === noteId; });
          if (noteIndex === -1) return;

          var movedNote = sourceFolder.notes.splice(noteIndex, 1)[0];
          targetFolder.notes.push(movedNote);

          _clearDropTargets(container);
          _clearFolderDropHighlight(container);
          if (_dragEl) { _dragEl.classList.remove('dragging'); _dragEl = null; }

          _persist();
          _renderFolders();
          _renderNoteList();
          return;
        }
      }

      var item = e.target.closest('.hub-notes-folder-item, .hub-notes-note-item');
      if (!item || !_dragEl || item === _dragEl) return;
      _clearDropTargets(container);
      _dragEl.classList.remove('dragging');

      var pos = _getDropPosition(e, item);
      if (pos === 'above') {
        container.insertBefore(_dragEl, item);
      } else {
        container.insertBefore(_dragEl, item.nextSibling);
      }
      _saveNewOrder(type);
      _dragEl = null;
    });
  }

  /** Remove drop-target-folder highlight from all children in a container. */
  function _clearFolderDropHighlight(container) {
    if (!container) return;
    var children = container.children;
    [].forEach.call(children, function (child) {
      child.classList.remove('drop-target-folder');
    });
  }

  // ============================================================
  //   RENDER — Sidebar
  // ============================================================

  function _renderFolders() {
    var el = _el.folderList;
    if (!el) return;
    var frag = document.createDocumentFragment();
    _data.folders.forEach(function (f) {
      var activeClass = (_activeFolder && f.id === _activeFolder.id) ? ' hub-notes-active' : '';
      var btn = document.createElement('button');
      btn.className = 'hub-notes-folder-item' + activeClass;
      btn.dataset.folderId = f.id;
      btn.draggable = true;
      btn.dataset.id = f.id;
      btn.innerHTML = '' +
        '<svg class="hub-notes-folder-icon" width="14" height="14" viewBox="0 0 20 20" fill="none">' +
          '<path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" fill="currentColor" opacity="0.3"/>' +
          '<path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
        '</svg>' +
        '<span>' + _escHtml(f.name) + '</span>' +
        '<span class="hub-notes-folder-count">' + (f.notes ? f.notes.length : 0) + '</span>';
      frag.appendChild(btn);
    });
    el.innerHTML = '';
    el.appendChild(frag);
  }

  function _renderNoteList() {
    var el = _el.sidebarNotes;
    if (!el) return;
    if (!_activeFolder || !_activeFolder.notes || _activeFolder.notes.length === 0) {
      el.innerHTML = '<div class="hub-notes-empty-list">No notes yet</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    _activeFolder.notes.forEach(function (n) {
      if (!n) return;
      var activeClass = (_activeNote && n.id === _activeNote.id) ? ' hub-notes-active' : '';
      var btn = document.createElement('button');
      btn.className = 'hub-notes-note-item' + activeClass;
      btn.dataset.noteId = n.id;
      btn.draggable = true;
      btn.dataset.id = n.id;
      btn.innerHTML = '' +
        '<span class="hub-notes-note-title">' + _escHtml(n.title || 'Untitled') + '</span>' +
        '<span class="hub-notes-note-date">' + _formatDate(n.updatedAt) + '</span>';
      frag.appendChild(btn);
    });
    el.innerHTML = '';
    el.appendChild(frag);
  }

  function _formatDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var diffMs = now - d;
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Spellcheck persistence ──
  function _getSpellcheckKey() {
    return 'hubos_notes_spellcheck';
  }

  function _loadSpellcheckPreference() {
    var stored = localStorage.getItem(_getSpellcheckKey());
    // Default to true (spellcheck ON) if no preference saved yet
    return stored === null ? true : stored === 'true';
  }

  function _applySpellcheck(enabled) {
    if (_el.editor) {
      _el.editor.spellcheck = enabled;
    }
    if (_el.titleInput) {
      _el.titleInput.spellcheck = enabled;
    }
    if (_el.spellcheckBtn) {
      if (enabled) {
        _el.spellcheckBtn.classList.add('hub-notes-spellcheck-btn--active');
      } else {
        _el.spellcheckBtn.classList.remove('hub-notes-spellcheck-btn--active');
      }
    }
  }

  function _bindSpellcheckToggle() {
    if (!_el.spellcheckBtn) return;
    _el.spellcheckBtn.addEventListener('click', function () {
      var current = _el.editor ? _el.editor.spellcheck : true;
      var next = !(current !== false);
      localStorage.setItem(_getSpellcheckKey(), String(next));
      _applySpellcheck(next);
    });
  }

  // ============================================================
  //   RENDER — Editor
  // ============================================================

  function _loadNoteIntoEditor() {
    // HARD STOP: cancel timers so they never leak between notes / renders
    _clearTimeCapsuleTimers();

    var lockedOverlay = document.getElementById('hn-locked-overlay');
    var penaltyBox    = document.getElementById('hn-locked-penalty');
    var unlockBtn     = document.getElementById('hn-btn-unlock-early');
    var countdownEl   = document.getElementById('hn-locked-countdown');

    if (!_activeNote) {
      if (_el.titleInput) _el.titleInput.style.display = 'none';
      if (_el.editor) _el.editor.style.display = 'none';
      if (_el.emptyState) _el.emptyState.style.display = '';
      if (_el.editorPane) _el.editorPane.classList.add('hub-notes-editor--empty');
      if (_el.dateContainer) _el.dateContainer.style.display = 'none';
      if (lockedOverlay) lockedOverlay.style.display = 'none';
      return;
    }

    // Compute lock state once
    var unlockAt = (_activeNote && typeof _activeNote.unlockAt === 'number')
      ? _activeNote.unlockAt
      : null;
    var isLocked = unlockAt && unlockAt > Date.now();

    if (isLocked) {
      // ---- LOCKED: hide editor surfaces, show the glass overlay ----
      if (_el.titleInput) _el.titleInput.style.display = 'none';
      if (_el.editor) _el.editor.style.display = 'none';
      if (_el.emptyState) _el.emptyState.style.display = 'none';
      if (_el.editorPane) _el.editorPane.classList.remove('hub-notes-editor--empty');
      if (_el.dateContainer) _el.dateContainer.style.display = 'none';
      if (lockedOverlay) lockedOverlay.style.display = '';
      if (unlockBtn) unlockBtn.style.display = '';
      if (penaltyBox) penaltyBox.style.display = 'none';

      var tick = function () {
        if (!_activeNote || !_activeNote.unlockAt) {
          if (_lockInterval) { clearInterval(_lockInterval); _lockInterval = null; }
          return;
        }
        var remaining = _activeNote.unlockAt - Date.now();
        if (remaining <= 0) {
          // Time capsule has expired → unlock permanently.
          if (_lockInterval) { clearInterval(_lockInterval); _lockInterval = null; }
          _activeNote.unlockAt = null;
          if (countdownEl) countdownEl.textContent = '0d 0h 0m 0s';
          try { _persist(true); } catch (e) { /* best-effort save */ }
          _loadNoteIntoEditor();
          return;
        }
        if (countdownEl) countdownEl.textContent = _formatCountdown(remaining);
      };
      tick();
      _lockInterval = setInterval(tick, 1000);
      return;
    }

    // ---- UNLOCKED: standard editor view ----
    if (lockedOverlay) lockedOverlay.style.display = 'none';
    if (_el.emptyState) _el.emptyState.style.display = 'none';
    if (_el.editorPane) _el.editorPane.classList.remove('hub-notes-editor--empty');
    if (_el.titleInput) { _el.titleInput.style.display = ''; _el.titleInput.value = _activeNote.title; }
    if (_el.editor) { _el.editor.style.display = ''; _el.editor.innerHTML = _activeNote.content || ''; }
    if (_el.dateContainer) _el.dateContainer.style.display = '';

    _updateDateDisplay();
    _updateNoteListDate();
  }

  /**
   * Centralised timer cleanup. Safe to call repeatedly; clears both
   * the countdown ticker and the 60s penalty ticker in a single place,
   * which every caller needs anyway (note-switch, render, destroy).
   */
  function _clearTimeCapsuleTimers() {
    if (_lockInterval)    { clearInterval(_lockInterval);    _lockInterval = null; }
    if (_penaltyInterval) { clearInterval(_penaltyInterval); _penaltyInterval = null; }
  }

  /**
   * Format a millisecond duration as "Xd Xh Xm Xs". Used by the
   * overlaid countdown display; clamped at 0 to avoid negative drift.
   * @param {number} ms
   * @returns {string}
   */
  function _formatCountdown(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
  }

  /**
   * Bind all Time Capsule UI controls: toolbar lock button, the
   * hidden datetime-local picker, and the overlay's early-unlock
   * button. The early-unlock handler uses document-level delegation
   * (guarded by `_unlockEarlyBound`) so it survives render() cycles
   * that wipe #hn-locked-overlay out of the DOM.
   *
   * Called at end of _renderUI() — must run AFTER innerHTML has been
   * injected so all referenced nodes exist.
   */
  function _bindTimeCapsule() {
    var btn     = document.getElementById('hn-btn-lock');
    var picker  = document.getElementById('hn-lock-datetime');
    if (!btn || !picker) return;

    // ── Toolbar lock button: open picker (or disarm if already locked) ──
    btn.addEventListener('click', function () {
      if (!_activeNote) {
        if (typeof window.HubToast === 'function') HubToast.show('Select a note first', 'warn');
        return;
      }

      // If the note is currently locked, offer a direct disarm path here too
      // (the overlay has its own "Unlock Early" with the 60s penalty; this is
      // a clean, immediate unlock from the toolbar).
      if (_activeNote.unlockAt && _activeNote.unlockAt > Date.now()) {
        var okToolbar = window.confirm(
          'This note is currently locked.\n\n' +
          'Disarm the Time Capsule now without penalty?'
        );
        if (!okToolbar) return;
        _activeNote.unlockAt = null;
        try { _persist(true); } catch (e) { /* ignore */ }
        _loadNoteIntoEditor();
        return;
      }

      // Prefill picker: +1 hour default, or the existing unlock time
      var defaultTs = _activeNote.unlockAt || (Date.now() + 60 * 60 * 1000);
      picker.value = _formatDateTimeLocalValue(defaultTs);

      // showPicker requires a user gesture, which we have from the click.
      if (typeof picker.showPicker === 'function') {
        try { picker.showPicker(); } catch (e) { picker.click(); picker.focus(); }
      } else {
        picker.click();
        picker.focus();
      }
    });

    // ── Picker change: commit the lock to the note + save + reload ──
    picker.addEventListener('change', function () {
      if (!_activeNote || !picker.value) return;
      // The picker emits local time strings — parse defensively.
      var ts = new Date(picker.value).getTime();
      if (isNaN(ts) || ts <= Date.now()) {
        if (typeof window.HubToast === 'function') HubToast.show('Pick a future date & time', 'warn');
        picker.value = '';
        return;
      }
      _activeNote.unlockAt = ts;
      try { _persist(true); } catch (e) { /* ignore */ }
      _loadNoteIntoEditor();
    });

    // ── Early-unlock button (delegated on document) ──
    if (!_unlockEarlyBound) {
      _unlockEarlyBound = true;
      document.addEventListener('click', function (e) {
        var target = e.target && e.target.closest
          ? e.target.closest('#hn-btn-unlock-early')
          : null;
        if (!target) return;
        // Only act when there's an active note still locked
        if (!_activeNote || !_activeNote.unlockAt || _activeNote.unlockAt <= Date.now()) return;

        e.preventDefault();
        e.stopPropagation();

        var ok = window.confirm(
          '⚠ PENALTY 60-SECOND COOLDOWN\n\n' +
          'Bypassing the Time Capsule will lock you out for 60 seconds.\n' +
          'Switch to another note to abort the bypass prematurely.\n\n' +
          'Proceed?'
        );
        if (!ok) return;

        target.style.display = 'none';
        var penaltyBox  = document.getElementById('hn-locked-penalty');
        var penaltyText = document.getElementById('hn-penalty-timer');
        if (penaltyBox) penaltyBox.style.display = '';
        if (penaltyText) penaltyText.textContent = '60';

        if (_penaltyInterval) clearInterval(_penaltyInterval);
        var remaining = 60;
        _penaltyInterval = setInterval(function () {
          remaining -= 1;
          if (penaltyText) penaltyText.textContent = String(Math.max(0, remaining));
          if (remaining <= 0) {
            clearInterval(_penaltyInterval);
            _penaltyInterval = null;
            if (_activeNote) _activeNote.unlockAt = null;
            try { _persist(true); } catch (e) { /* ignore */ }
            _loadNoteIntoEditor();
          }
        }, 1000);
      });
    }
  }

  /**
   * Helper: format a timestamp as the `value` attribute of an
   * <input type="datetime-local">. Differs from `_formatDateInputValue`
   * (which is YYYY-MM-DD only) by emitting `YYYY-MM-DDTHH:MM` so the
   * browser's native picker stays in sync with the note's unlockAt.
   * @param {number} ts
   * @returns {string}
   */
  function _formatDateTimeLocalValue(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var yyyy = d.getFullYear();
    var mm   = pad(d.getMonth() + 1);
    var dd   = pad(d.getDate());
    var hh   = pad(d.getHours());
    var mi   = pad(d.getMinutes());
    return yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi;
  }

  function _formatCreatedDate(ts) {
    if (!ts) return 'Set Date';
    var d = new Date(ts);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    return dd + '/' + mm + '/' + yyyy;
  }

  function _formatDateInputValue(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    return yyyy + '-' + mm + '-' + dd;
  }

  function _updateDateDisplay() {
    if (!_activeNote) return;
    if (_el.dateText) {
      _el.dateText.textContent = _formatCreatedDate(_activeNote.createdAt);
    }
    if (_el.dateInput) {
      _el.dateInput.value = _formatDateInputValue(_activeNote.createdAt);
    }
  }

  function _updateNoteListDate() {
    if (_activeNote) {
      _activeNote.updatedAt = Date.now();
      _renderNoteList();
    }
  }

  // ============================================================
  //   ACTIONS — CRUD
  // ============================================================

  // ĐÃ SỬA LỖI TRÙNG TÊN: Đổi tên thành _handleAddNote
  function _handleAddNote() {
    if (!_activeFolder) return;
    var note = _buildNoteObject('Untitled', '');
    note.folderId = _activeFolder.id;
    _activeFolder.notes.unshift(note);
    _activeNote = note;
    _persist();
    _renderNoteList();
    _loadNoteIntoEditor();
    _renderFolders();
    setTimeout(function () {
      if (_el.titleInput) _el.titleInput.focus();
    }, 50);
  }

  function _deleteNote(noteId) {
    if (!_activeFolder) return;
    var idx = _activeFolder.notes.findIndex(function (n) { return n && n.id === noteId; });
    if (idx === -1) return;
    _activeFolder.notes.splice(idx, 1);

    if (_activeNote && _activeNote.id === noteId) {
      _activeNote = _activeFolder.notes[0] || null;
    }
    _persist();
    _renderNoteList();
    _loadNoteIntoEditor();
    _renderFolders();
  }

  // ============================================================
  //   FOLDER MANAGEMENT
  // ============================================================

  function _handleAddFolder() {
    var name = prompt('Enter new desk name:');
    if (!name || !name.trim()) return;
    var folder = {
      id: _uid(),
      name: name.trim(),
      notes: []
    };
    _data.folders.push(folder);
    _activeFolder = folder;
    _activeNote = null;
    _persist();
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();
  }

  function _renameFolder(folderId) {
    var folder = _data.folders.find(function (f) { return f.id === folderId; });
    if (!folder) return;
    var name = prompt('Rename desk:', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    folder.name = name.trim();
    _persist();
    _renderFolders();
  }

  function _deleteFolder(folderId) {
    if (!confirm('Delete this desk and all its notes?')) return;
    var idx = _data.folders.findIndex(function (f) { return f.id === folderId; });
    if (idx === -1) return;
    _data.folders.splice(idx, 1);

    // Fallback: if no folders remain, create default Personal
    if (_data.folders.length === 0) {
      _data.folders.push({
        id: _uid(),
        name: 'Personal',
        notes: []
      });
    }

    // If the deleted folder was active, switch to first available
    if (_activeFolder && _activeFolder.id === folderId) {
      _activeFolder = _data.folders[0];
      _activeNote = _activeFolder.notes[0] || null;
    }
    _persist();
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();
  }

  function _bindAddFolder() {
    if (_el.addFolderBtn) {
      _el.addFolderBtn.addEventListener('click', _handleAddFolder);
    }
  }

  // ============================================================
  //   SLASH COMMANDS
  // ============================================================

  function _handleSlashCommand() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    var node = range.startContainer;
    if (!node) return false;
    var text = node.textContent || '';
    var pos  = range.startOffset;

    var before = text.substring(0, pos);
    var match = before.match(/\/(h[123])\s$/);
    if (!match) return false;

    var tag = match[1];
    var cmdLen = match[0].length;

    range.setStart(node, pos - cmdLen);
    range.deleteContents();

    var heading = document.createElement(tag);
    heading.innerHTML = '&#8203;'; // Dấu cách tàng hình an toàn
    range.insertNode(heading);

    range.selectNodeContents(heading);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    _scheduleSave();
    return true;
  }

  // ============================================================
  //   SEARCH — Real-time filtering
  // ============================================================

  /**
   * Toggle the search bar open/closed and focus the input.
   */
  function _toggleSearchBar() {
    if (!_el.searchBar || !_el.searchInput) return;
    var isHidden = _el.searchBar.style.display === 'none' || !_el.searchBar.style.display;
    if (isHidden) {
      _el.searchBar.style.display = 'flex';
      setTimeout(function () {
        _el.searchBar.classList.add('hub-notes-search-bar--open');
        _el.searchInput.focus();
      }, 20);
    } else {
      _el.searchBar.classList.remove('hub-notes-search-bar--open');
      _el.searchInput.value = '';
      setTimeout(function () {
        _el.searchBar.style.display = 'none';
        _filterNoteList('');
      }, 200);
    }
  }

  /**
   * Real-time filter of note items in the sidebar.
   * Shows notes whose title OR content includes the query.
   */
  function _filterNoteList(query) {
    var items = document.querySelectorAll('.hub-notes-note-item');
    var q = query.toLowerCase().trim();
    [].forEach.call(items, function (item) {
      if (!q) {
        item.style.display = '';
        return;
      }
      var titleEl = item.querySelector('.hub-notes-note-title');
      var title   = titleEl ? titleEl.textContent.toLowerCase() : '';
      var content = item.getAttribute('data-search-content') || '';
      // Build content index on first encounter
      if (!content) {
        var nid = item.getAttribute('data-note-id');
        if (nid && _activeFolder) {
          var note = _activeFolder.notes.find(function (n) { return n && n.id === nid; });
          if (note) {
            content = (note.title || '') + ' ' + (note.content || '');
            content = content.toLowerCase().replace(/<[^>]+>/g, '');
            item.setAttribute('data-search-content', content);
          }
        }
      }
      var match = title.indexOf(q) !== -1 || content.indexOf(q) !== -1;
      item.style.display = match ? '' : 'none';
    });
  }

  /**
   * Bind search toggle button, input listener, and clear button.
   */
  function _bindSearchEvents() {
    // Search button toggle
    if (_el.searchBtn) {
      _el.searchBtn.addEventListener('click', _toggleSearchBar);
    }

    // Real-time input filtering
    if (_el.searchInput) {
      _el.searchInput.addEventListener('input', function () {
        _filterNoteList(this.value);
      });
    }

    // Clear button
    if (_el.searchClear) {
      _el.searchClear.addEventListener('click', function () {
        if (_el.searchInput) {
          _el.searchInput.value = '';
          _filterNoteList('');
          _el.searchInput.focus();
        }
      });
    }

    // Escape to close search
    if (_el.searchInput) {
      _el.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          _toggleSearchBar();
          if (_el.searchBtn) _el.searchBtn.focus();
        }
      });
    }
  }

  // ============================================================
  //   EVENT BINDING
  // ============================================================

  function _bindAddNote() {
    if (_el.addBtn) {
      _el.addBtn.addEventListener('click', _handleAddNote);
    }
  }

  function _bindFolderClicks() {
    var list = _el.folderList;
    if (!list) return;
    list.addEventListener('click', function (e) {
      var item = e.target.closest('.hub-notes-folder-item');
      if (!item) return;
      var fid = item.getAttribute('data-folder-id');
      var folder = _data.folders.find(function (f) { return f.id === fid; });
      if (!folder || folder.id === _activeFolder.id) return;
      _activeFolder = folder;
      _activeNote = _activeFolder.notes[0] || null;
      _renderFolders();
      _renderNoteList();
      _loadNoteIntoEditor();
    });

    // Double-click to rename folder
    list.addEventListener('dblclick', function (e) {
      var item = e.target.closest('.hub-notes-folder-item');
      if (!item) return;
      _renameFolder(item.getAttribute('data-folder-id'));
    });

    // Right-click to delete folder
    list.addEventListener('contextmenu', function (e) {
      var item = e.target.closest('.hub-notes-folder-item');
      if (!item) return;
      e.preventDefault();
      _deleteFolder(item.getAttribute('data-folder-id'));
    });
  }

  // ============================================================
  //   IMAGE TEXT-WRAPPING — Selection + Float helpers
  // ============================================================

  /** Strip every image-position class from an <img> element. */
  function _stripFloatClasses(img) {
    if (!img) return;
    img.classList.remove('img-float-left', 'img-float-right', 'img-center', 'img-selected');
  }

  /** Apply a single float class; previous classes are cleared first. */
  function _applyFloatClass(img, cls) {
    if (!img) return;
    _stripFloatClasses(img);
    img.classList.add(cls);
    img.classList.add('img-selected');
    _selectedImage = img;
    _syncAlignButtonState();
  }

  /**
   * Toggle the visual "active" state on the three align buttons
   * according to the current image's float class. When no image is
   * selected, all three go back to their default look.
   */
  function _syncAlignButtonState() {
    if (!_el.toolbar) return;
    var left   = _el.toolbar.querySelector('[data-cmd="justifyLeft"]');
    var center = _el.toolbar.querySelector('[data-cmd="justifyCenter"]');
    var right  = _el.toolbar.querySelector('[data-cmd="justifyRight"]');
    [left, center, right].forEach(function (b) {
      if (b) b.classList.remove('hub-notes-tb-btn--active');
    });
    if (!_selectedImage) return;
    if (_selectedImage.classList.contains('img-float-left')   && left)   left.classList.add('hub-notes-tb-btn--active');
    if (_selectedImage.classList.contains('img-center')       && center) center.classList.add('hub-notes-tb-btn--active');
    if (_selectedImage.classList.contains('img-float-right')  && right)  right.classList.add('hub-notes-tb-btn--active');
  }

  /**
   * Click inside the editor: select <img> targets, clear selection when
   * the user clicks anywhere else (text node, blank lines, etc).
   */
  function _bindImageSelection() {
    if (!_el.editor) return;

    _el.editor.addEventListener('click', function (e) {
      var t = e.target;
      // Clicked directly on an image — select it.
      if (t && t.tagName === 'IMG') {
        // Clear ring from previous selection (if different image)
        if (_selectedImage && _selectedImage !== t) {
          _selectedImage.classList.remove('img-selected');
        }
        t.classList.add('img-selected');
        _selectedImage = t;
        _syncAlignButtonState();      // visually highlight align buttons
        return;
      }
      // Clicked on text / block element — deselect any previous image.
      if (_selectedImage) {
        _selectedImage.classList.remove('img-selected');
        _selectedImage = null;
        _syncAlignButtonState();      // clear button highlights
      }
    });
  }

  function _bindEditorEvents() {
    // Title input changes
    if (_el.titleInput) {
      _el.titleInput.addEventListener('input', function () {
        if (_activeNote) {
          _activeNote.title = _el.titleInput.value || 'Untitled';
          _scheduleSave();
          _renderNoteList();
        }
      });
    }

    // Editor content changes
    if (_el.editor) {
      _el.editor.addEventListener('input', function () {
        if (_activeNote) {
          _activeNote.content = _el.editor.innerHTML;
          _updateNoteListDate();
          _scheduleSave();
        }
      });
    }

    // Cloud Image Upload: Paste
    if (_el.editor) {
      _el.editor.addEventListener('paste', async function (e) {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let imageFile = null;

        for (let item of items) {
          if (item.type.indexOf('image') === 0) {
            imageFile = item.getAsFile();
            break;
          }
        }

        if (!imageFile) return;

        e.preventDefault();

        const loadingId = 'hub-notes-img-loading-' + Date.now();
        const loadingHtml = '<span id="' + loadingId + '" style="color: var(--primary-color, #00e676); font-style: italic; font-weight: bold;">[⏳ Uploading to Cloud...]</span>';
        document.execCommand('insertHTML', false, loadingHtml);

        try {
          const imageUrl = await uploadToImgBB(imageFile);
          const loadingSpan = document.getElementById(loadingId);
          if (loadingSpan) {
            var imgTag = document.createElement('img');
            imgTag.src = imageUrl;
            imgTag.style.maxWidth = '100%';
            imgTag.style.borderRadius = '8px';
            imgTag.style.marginTop = '10px';
            imgTag.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
            loadingSpan.parentNode.replaceChild(imgTag, loadingSpan);
          }
        } catch (err) {
          console.error('Hub.OS: Image upload failed', err);
          const loadingSpan = document.getElementById(loadingId);
          if (loadingSpan) {
            loadingSpan.style.color = '#ff5252';
            loadingSpan.textContent = '[❌ Upload failed. Please try again.]';
          }
        }
      });
    }

    // Cloud Image Upload: Drag & Drop
    if (_el.editor) {
      _el.editor.addEventListener('drop', async function (e) {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files) return;

        for (let file of files) {
          if (file.type.indexOf('image') !== 0) continue;
          e.preventDefault();

          _el.editor.focus();

          const loadingId = 'hub-notes-img-loading-' + Date.now();
          const loadingHtml = '<span id="' + loadingId + '" style="color: var(--primary-color, #00e676); font-style: italic; font-weight: bold;">[⏳ Uploading to Cloud...]</span>';
          document.execCommand('insertHTML', false, loadingHtml);

          try {
            const imageUrl = await uploadToImgBB(file);
            const loadingSpan = document.getElementById(loadingId);
            if (loadingSpan) {
              var imgTag = document.createElement('img');
              imgTag.src = imageUrl;
              imgTag.style.maxWidth = '100%';
              imgTag.style.borderRadius = '8px';
              imgTag.style.marginTop = '10px';
              imgTag.style.boxShadow = '0 4px 6px rgba(0,0,0,0.3)';
              loadingSpan.parentNode.replaceChild(imgTag, loadingSpan);
            }
          } catch (err) {
            console.error('Hub.OS: Image upload failed', err);
            const loadingSpan = document.getElementById(loadingId);
            if (loadingSpan) {
              loadingSpan.style.color = '#ff5252';
              loadingSpan.textContent = '[❌ Upload failed. Please try again.]';
            }
          }
        }
      });
    }

    // Slash commands on keyup
    if (_el.editor) {
      _el.editor.addEventListener('keyup', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
          _handleSlashCommand();
        }
      });
    }

    // Enter / Backspace handling inside headings
    if (_el.editor) {
      _el.editor.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          _handleEnterInHeading(e);
        } else if (e.key === 'Backspace') {
          _handleBackspaceInHeading(e);
        }
      });
    }

    // Ctrl+Shift+N for new note
    if (_el.editor) {
      _el.editor.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
          e.preventDefault();
          _handleAddNote();
        }
      });
    }

    // Escape to blur editor
    if (_el.editor) {
      _el.editor.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          _el.editor.blur();
        }
      });
    }

    // Click on a note item in sidebar
    if (_el.sidebarNotes) {
      _el.sidebarNotes.addEventListener('click', function (e) {
        var item = e.target.closest('.hub-notes-note-item');
        if (!item) return;
        var nid = item.getAttribute('data-note-id');
        if (!nid || (_activeNote && nid === _activeNote.id)) return;
        _saveImmediate();
        var note = _activeFolder ? _activeFolder.notes.find(function (n) { return n && n.id === nid; }) : null;
        if (note) {
          _activeNote = note;
          _renderNoteList();
          _loadNoteIntoEditor();
        }
      });
    }

    // Right-click to delete note
    if (_el.sidebarNotes) {
      _el.sidebarNotes.addEventListener('contextmenu', function (e) {
        var item = e.target.closest('.hub-notes-note-item');
        if (!item) return;
        e.preventDefault();
        if (confirm('Delete this note?')) {
          _deleteNote(item.getAttribute('data-note-id'));
        }
      });
    }
  }

  function _handleEnterInHeading(e) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.anchorNode;
    if (!node) return;
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    var heading = el ? el.closest('h1, h2, h3') : null;
    if (!heading) return;

    var textLen = (node.textContent || '').length;
    if (sel.anchorOffset === textLen) {
      e.preventDefault();
      var p = document.createElement('p');
      p.innerHTML = '<br>';
      if (heading.parentNode) {
        heading.parentNode.insertBefore(p, heading.nextSibling);
        var range = document.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        _scheduleSave();
      }
    }
  }

  function _handleBackspaceInHeading(e) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (sel.anchorOffset !== 0) return;
    var node = sel.anchorNode;
    if (!node) return;
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    var heading = el ? el.closest('h1, h2, h3') : null;
    if (!heading) return;

    var range = sel.getRangeAt(0);
    if (range.startOffset !== 0) return;
    var textLen = (range.startContainer.textContent || '').length;
    if (textLen === 0) return;

    e.preventDefault();
    var p = document.createElement('p');
    p.innerHTML = heading.innerHTML;
    if (heading.parentNode) {
      heading.parentNode.replaceChild(p, heading);
      var newRange = document.createRange();
      newRange.setStart(p.firstChild || p, 0);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      _scheduleSave();
    }
  }

  // ============================================================
  //   FLOATING FORMATTING TOOLBAR
  // ============================================================

  function _bindFormatToolbar() {
    if (!_el.editor || !_el.toolbar) return;

    _boundDocMouseup = function () {
      _updateToolbarPosition();
    };

    _boundDocMousedown = function (e) {
      if (!_el.editor || !_el.toolbar || !e) return;
      var t = e.target;
      if (!t) return;
      // Don't hide if clicking inside the editor, toolbar, or the color input
      if (_el.editor.contains(t) || _el.toolbar.contains(t)) return;
      if (t && t.id === 'hn-color-picker') return;
      _hideToolbar();
    };

    _boundDocKeyup = function (e) {
      var k = e && e.key;
      if (k && typeof k === 'string' && k.startsWith('Arrow') && e.shiftKey) {
        _updateToolbarPosition();
      }
    };

    _boundDocKeydown = function (e) {
      if (e && e.key === 'Escape') _hideToolbar();
    };

    document.addEventListener('mouseup', _boundDocMouseup);
    document.addEventListener('mousedown', _boundDocMousedown);
    document.addEventListener('keyup', _boundDocKeyup);
    document.addEventListener('keydown', _boundDocKeydown);

    // ── Toolbar button clicks: mousedown + preventDefault to avoid
    //     stealing focus / losing text selection from contenteditable ──
    var savedRange = null; // selection checkpoint for color picker

    _el.toolbar.addEventListener('mousedown', function (e) {
      var btn = e.target.closest('.hub-notes-tb-btn');
      if (!btn) return;

      // ⚠ CRITICAL: ALWAYS preventDefault on toolbar button mousedown.
      // Without it, clicking the "A" color button steals focus from
      // the contenteditable editor and drops the text selection before
      // the color picker's 'input' event can read & apply the color.
      // For command buttons (bold, italic, ...) this is also correct —
      // execCommand operates on the saved selection.
      e.preventDefault();

      var cmd = btn.getAttribute('data-cmd');
      var val = btn.getAttribute('data-value');

      // ── IMAGE FLOAT INTERCEPT ──
      // Re-purpose the three alignment buttons when an image is selected:
      // instead of justifing the current text selection, apply Word-style
      // float wrapping to _selectedImage and bypass execCommand entirely.
      if (_selectedImage &&
          (cmd === 'justifyLeft' || cmd === 'justifyCenter' || cmd === 'justifyRight')) {
        var floatClass = (cmd === 'justifyLeft')   ? 'img-float-left'
                       : (cmd === 'justifyCenter') ? 'img-center'
                       :                              'img-float-right';
        _applyFloatClass(_selectedImage, floatClass);
        _scheduleSave();   // persist the new float class to cloud/local
        if (_el.editor) _el.editor.focus();
        setTimeout(_updateToolbarPosition, 10);
        return;            // ← bypass document.execCommand for image floats
      }

      // ── Normal path: legacy execCommand on text selection ──
      if (cmd) {
        document.execCommand(cmd, false, val || null);
      }

      if (_el.editor) _el.editor.focus();
      setTimeout(_updateToolbarPosition, 10);
    });

    // ── Text color button: save selection → open native picker ──
    var colorBtn   = _el.toolbar.querySelector('#hn-color-btn');
    var colorPicker = _el.toolbar.querySelector('#hn-color-picker');

    if (colorBtn && colorPicker) {
      // Save the live range before the native picker steals focus
      colorBtn.addEventListener('click', function () {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
          savedRange = sel.getRangeAt(0).cloneRange();
        }
        colorPicker.click();
      });

      // Apply the chosen color to the saved range
      colorPicker.addEventListener('input', function () {
        if (savedRange) {
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
          savedRange = null; // consumed
        }
        document.execCommand('foreColor', false, colorPicker.value);
        if (_el.editor) _el.editor.focus();
      });

      // Safety net: some browser pickers fire 'input' only once on drag;
      // 'change' fires on final commit. Apply regardless.
      colorPicker.addEventListener('change', function () {
        if (savedRange) {
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
          savedRange = null;
          document.execCommand('foreColor', false, colorPicker.value);
        }
        if (_el.editor) _el.editor.focus();
      });
    }

    // ── Nút Pin (Ghim Toolbar) ──
    // Trong HTML hiện tại của bạn, nút Pin có id là "hn-btn-pin"
    var pinBtn = document.getElementById('hn-btn-pin');
    if (pinBtn) {
      pinBtn.addEventListener('click', function () {
        isToolbarFixed = !isToolbarFixed;
        if (_el.editorPane) {
          _el.editorPane.classList.toggle('fixed-toolbar-mode', isToolbarFixed);
        }
        // Tái sử dụng class active của nút Spell để tạo hiệu ứng phát sáng khi bật
        pinBtn.classList.toggle('hub-notes-spellcheck-btn--active', isToolbarFixed);
        
        if (isToolbarFixed && _el.toolbar) {
          _el.toolbar.style.position = 'static'; // Ghi đè thành static luôn ở JS
          _el.toolbar.style.left = 'auto';       // Xóa tọa độ lơ lửng cũ
          _el.toolbar.style.top = 'auto';        // Xóa tọa độ lơ lửng cũ
          _el.toolbar.style.display = 'flex';
          _el.toolbar.classList.add('hub-notes-toolbar--visible');
        } else if (_el.toolbar) {
          _hideToolbar();
        }
      });
    }

    // ── Nút Bút Dạ Quang (Highlight) ──
    var hlBtn = document.getElementById('hn-highlight-btn');
    var hlPicker = document.getElementById('hn-highlight-picker');

    if (hlBtn && hlPicker) {
      hlBtn.addEventListener('mousedown', function(e) { e.preventDefault(); }); // Bắt buộc để không mất bôi đen chữ
      hlBtn.addEventListener('click', function () {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
          savedRange = sel.getRangeAt(0).cloneRange(); // Tái sử dụng biến savedRange ở trên
        }
        hlPicker.click();
      });

hlPicker.addEventListener('input', function () {
        if (savedRange) {
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
        }
        document.execCommand('hiliteColor', false, hlPicker.value);
        if (_el.editor) _el.editor.focus();
      });
    }

    // ── Toggle Quote (monospace blockquote) ──
    // Standard data-cmd="formatBlock" with data-value="blockquote" will not
    // toggle off when clicked a second time, so this button has its own
    // handler that detects whether the caret is currently inside a
    // <blockquote> and switches it back to a normal paragraph if so.
    var quoteBtn = document.getElementById('hn-quote-btn');
    if (quoteBtn) {
      quoteBtn.addEventListener('mousedown', function (e) {
        // CRITICAL: keep the editor's text selection alive while we toggle.
        e.preventDefault();
        e.stopPropagation();
      });

      quoteBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var editor = _el.editor;
        if (!editor) return;

        var sel = window.getSelection();
        var node = sel ? sel.anchorNode : null;
        var isInsideBlockquote = false;

        if (node) {
          var cur = (node.nodeType === 3) ? node.parentNode : node;
          while (cur && cur !== editor) {
            if (cur.tagName && cur.tagName === 'BLOCKQUOTE') {
              isInsideBlockquote = true;
              break;
            }
            cur = cur.parentNode;
          }
        }

        document.execCommand(
          'formatBlock',
          false,
          isInsideBlockquote ? 'p' : 'blockquote'
        );

        if (editor && typeof editor.focus === 'function') {
          editor.focus();
        }
        _scheduleSave();
      });
    }

    // ──────────────────────────────────────────────────────────
    //   CUSTOM FONT SIZE TOOL
    //   Left-click  → toggle a small px input (Enter to apply)
    //   Right-click → instantly apply the previously saved size
    // ──────────────────────────────────────────────────────────
    var _customFontSize = '18';         // persisted across renders via localStorage
    var _savedSizeRange = null;         // text-selection checkpoint for the apply path

    try {
      var stored = localStorage.getItem('hub_os_notes_custom_font_size');
      if (stored && /^\d{1,3}$/.test(stored)) _customFontSize = stored;
    } catch (_) { /* localStorage may be blocked — keep default */ }

    var sizeBtn   = _el.toolbar.querySelector('#hn-size-btn');
    var sizeInput = _el.toolbar.querySelector('#hn-size-input');

    function applyCustomSize(size) {
      // Validate + clamp to a sane range (8–96px)
      var n = parseInt(size, 10);
      if (!n || isNaN(n)) return;
      if (n < 8)  n = 8;
      if (n > 96) n = 96;

      _customFontSize = String(n);
      try { localStorage.setItem('hub_os_notes_custom_font_size', _customFontSize); } catch (_) {}

      // Restore the original text selection so execCommand operates on the right range
      if (_savedSizeRange && _el.editor) {
        var selCheck = window.getSelection();
        if (selCheck) {
          selCheck.removeAllRanges();
          selCheck.addRange(_savedSizeRange);
        }
      }

      // Native browser hack: apply <font size="7"> (largest preset),
      // then swap those tags for <span> with our exact px value.
      document.execCommand('fontSize', false, '7');

      if (_el.editor) {
        var fonts = _el.editor.querySelectorAll('font[size="7"]');
        [].forEach.call(fonts, function (fontEl) {
          var span = document.createElement('span');
          span.style.fontSize = _customFontSize + 'px';
          span.style.lineHeight = '1.5';
          // Preserve face/color attributes if present
          if (fontEl.face)  span.style.fontFamily  = fontEl.face;
          if (fontEl.color) span.style.color       = fontEl.color;
          while (fontEl.firstChild) span.appendChild(fontEl.firstChild);
          if (fontEl.parentNode) fontEl.parentNode.replaceChild(span, fontEl);
        });
      }

      if (_el.editor) _el.editor.focus();
      _savedSizeRange = null;
      _scheduleSave();
    }

    if (sizeBtn && sizeInput) {
      // Keep selection checkpoint fresh BEFORE any focus-stealing mousedown
      sizeBtn.addEventListener('mousedown', function (e) {
        e.preventDefault();              // critical: keeps text selection alive
        e.stopPropagation();             // ← bypass the generic toolbar execCommand dispatch
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          _savedSizeRange = sel.getRangeAt(0).cloneRange();
        }
      });

      // LEFT CLICK → toggle the input field
      sizeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = sizeInput.style.display === 'block' || sizeInput.classList.contains('hub-notes-size-input--open');
        if (isOpen) {
          sizeInput.style.display = 'none';
          sizeInput.classList.remove('hub-notes-size-input--open');
          if (_el.editor) _el.editor.focus();
        } else {
          sizeInput.style.display = 'block';
          sizeInput.classList.add('hub-notes-size-input--open');
          sizeInput.value = _customFontSize;
          sizeInput.placeholder = _customFontSize + 'px';
          setTimeout(function () { sizeInput.focus(); sizeInput.select(); }, 10);
        }
      });

      // RIGHT CLICK → instantly apply saved size (no input UI)
      sizeBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Refresh selection in case the user just right-clicked without a prior left-click
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
          _savedSizeRange = sel.getRangeAt(0).cloneRange();
        }
        applyCustomSize(_customFontSize);
        // Flash a tiny visual confirmation on the button
        sizeBtn.classList.add('hub-notes-tb-btn--active');
        setTimeout(function () { sizeBtn.classList.remove('hub-notes-tb-btn--active'); }, 220);
      });

      // ENTER inside the input → commit + apply
      sizeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          var v = sizeInput.value.trim() || _customFontSize;
          applyCustomSize(v);
          sizeInput.style.display = 'none';
          sizeInput.classList.remove('hub-notes-size-input--open');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          sizeInput.style.display = 'none';
          sizeInput.classList.remove('hub-notes-size-input--open');
          if (_el.editor) _el.editor.focus();
        }
      });

      // Blur → close input (with grace period so Enter's focus-restore doesn't close it early)
      sizeInput.addEventListener('blur', function () {
        setTimeout(function () {
          if (document.activeElement !== sizeInput) {
            sizeInput.style.display = 'none';
            sizeInput.classList.remove('hub-notes-size-input--open');
          }
        }, 120);
      });

      // Prevent the input itself from re-triggering the generic toolbar mousedown
      sizeInput.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }
  } // <--- THÊM ĐÚNG 1 DẤU NGOẶC NÀY VÀO ĐÂY ĐỂ ĐÓNG HÀM LẠI!

  function _updateToolbarPosition() {
    // Return early if toolbar is in fixed mode
    if (isToolbarFixed) return;

    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (text.length === 0 || !sel || !sel.rangeCount || !_el.editor || !_el.toolbar) {
      _hideToolbar();
      return;
    }

    // Verify selection is inside the editor
    var node = sel.anchorNode;
    var inside = false;
    while (node) {
      if (node === _el.editor) { inside = true; break; }
      if (node === document) break;
      node = node.parentNode;
    }
    if (!inside) {
      _hideToolbar();
      return;
    }

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      _hideToolbar();
      return;
    }

    // Display first so offsetWidth is accurate
    _el.toolbar.style.position = 'fixed';
    _el.toolbar.style.display = 'flex';

    var tbWidth  = _el.toolbar.offsetWidth || 140;
    var margin   = 10;

    // Position centered above the selection, 45px up
    var top  = rect.top - 45;
    var left = rect.left + (rect.width / 2) - (tbWidth / 2);

    // ── Viewport boundary clamp ──
    var maxLeft = window.innerWidth - tbWidth - margin;
    if (maxLeft < margin) maxLeft = margin; // toolbar wider than viewport — pin left
    left = Math.max(margin, Math.min(left, maxLeft));

    _el.toolbar.style.top  = Math.max(margin, top) + 'px';
    _el.toolbar.style.left = left + 'px';
    _el.toolbar.classList.add('hub-notes-toolbar--visible');
  }
  

  function _hideToolbar() {
    // Return early if toolbar is in fixed mode
    if (isToolbarFixed) return;

    var tb = _el.toolbar;
    if (tb) {
      tb.style.display = 'none';
      tb.classList.remove('hub-notes-toolbar--visible');
    }
  }

  // ============================================================
  //   SAVE — Force immediate persist
  // ============================================================

  async function _saveImmediate() {
    HubDebounce.cancel('notes-auto-save');
    if (_activeNote && _el.titleInput && _el.editor) {
      _activeNote.title   = _el.titleInput.value || 'Untitled';
      _activeNote.content = _el.editor.innerHTML;
    }
    await _persist(true);
    _showSaving(false);
  }

  // ============================================================
  //   SAVE — Manual save button
  // ============================================================

  function _bindManualSave() {
    var btn = document.getElementById('hn-btn-manual-save');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Flush editor state into _activeNote
      if (_activeNote && _el.titleInput && _el.editor) {
        _activeNote.title   = _el.titleInput.value || 'Untitled';
        _activeNote.content = _el.editor.innerHTML;
      }
      HubDebounce.cancel('notes-auto-save');
      _persist(true).then(function () {
        var el = document.getElementById('hn-save-feedback');
        if (el) {
          el.textContent = 'Saved!';
          el.classList.add('hub-notes-save-feedback--show');
          setTimeout(function () { el.classList.remove('hub-notes-save-feedback--show'); }, 2000);
        }
      }).catch(function () {});
    });
  }

  // ============================================================
  //   CREATION DATE — Inline date picker
  // ============================================================

  function _bindDateEvents() {
    // Click on date text → show date input, hide text
    if (_el.dateText) {
      _el.dateText.addEventListener('click', function () {
        if (_el.dateText) _el.dateText.style.display = 'none';
        if (_el.dateInput) {
          _el.dateInput.style.display = '';
          _el.dateInput.focus();
          // On mobile, trigger the native date picker immediately
          if ('showPicker' in HTMLInputElement.prototype) {
            _el.dateInput.showPicker();
          }
        }
      });
    }

    // Date input change → update note, trigger auto-save
    if (_el.dateInput) {
      _el.dateInput.addEventListener('change', function () {
        var val = _el.dateInput.value;
        if (val && _activeNote) {
          // Convert YYYY-MM-DD to timestamp (UTC midnight of that day)
          var parts = val.split('-');
          var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          _activeNote.createdAt = d.getTime();
          _updateDateDisplay();
          _scheduleSave();
        }
        // Hide input, show text
        if (_el.dateInput) _el.dateInput.style.display = 'none';
        if (_el.dateText) _el.dateText.style.display = '';
      });

      // Blur → hide input, show text (but not if user is still picking)
      _el.dateInput.addEventListener('blur', function () {
        // Small delay to let a 'change' event fire first
        setTimeout(function () {
          if (_el.dateInput) _el.dateInput.style.display = 'none';
          if (_el.dateText) _el.dateText.style.display = '';
        }, 150);
      });
    }
  }

  // ============================================================
  //   AUTO-SAVE TOGGLE (called from backup modal)
  // ============================================================

  function getAutoSaveEnabled() {
    return _autoSaveEnabled;
  }

  function setAutoSaveEnabled(val) {
    _autoSaveEnabled = !!val;
  }

  // ============================================================
  //   AUTH-AWARE LIFECYCLE
  //   Called by auth-ui.js when user logs in or out.
  // ============================================================

  /**
   * Called after login. Reloads notes data from the cloud and
   * resets the local UI to reflect the freshly loaded state.
   * The Load Guard (_isNotesDataLoaded) is reset to false before
   * the fetch, then set to true only after data is confirmed.
   */
  async function loadFromCloud() {
    // 1) Reset local state and the Load Guard to prevent any
    //    stray auto-save timers from firing during the fetch.
    _sessionInitialized = false;
    _isNotesDataLoaded = false;
    _data = null;
    _activeFolder = null;
    _activeNote = null;

    // 2) If the container is mounted, show loading state
    if (_container) {
      _container.innerHTML =
        '<div class="tab-content hub-notes-app" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
          '<div class="hub-notes-loading" style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem">' +
            '<span class="hub-notes-loading-dot">●</span> Loading workspace...' +
          '</div>' +
        '</div>';
    }

    // 3) Fetch fresh data from cloud
    await _loadData();

    // 4) If the module is currently mounted (container exists), re-render
    if (_container) {
      // Re-run the full render cycle over the existing container
      render(_container);
    }
  }

  /**
   * Called after logout. Clears all local notes state, resets the
   * Load Guard, and clears the UI so the user never sees stale data.
   */
  function clearData() {
    // 1) Cancel any pending save
    HubDebounce.cancel('notes-auto-save');

    // 2) Reset session cache + Load Guard — no saves will fire until re-login + re-load
    _sessionInitialized = false;
    _isNotesDataLoaded = false;
    _isDataLoaded = false;

    // 3) Clear all local state
    _data = null;
    _activeFolder = null;
    _activeNote = null;

    // 4) Clear the UI if mounted
    if (_container) {
      _container.innerHTML =
        '<div class="tab-content hub-notes-app" style="display:flex;align-items:center;justify-content:center;min-height:300px">' +
          '<div class="hub-notes-loading" style="font-family:var(--font-mono);color:var(--text-muted);font-size:0.85rem;opacity:0.5">' +
            '<span>Session ended. Login to access cloud notes.</span>' +
          '</div>' +
        '</div>';
      _el = {
        sidebarNotes: null, folderList: null, titleInput: null, editor: null,
        toolbar: null, savingIndicator: null, emptyState: null, editorPane: null,
        addBtn: null, addFolderBtn: null, searchBtn: null, searchBar: null,
        searchInput: null, searchClear: null, manualSaveBtn: null, saveFeedback: null,
        dateContainer: null, dateText: null, dateInput: null, backupBtn: null, historyBtn: null, historyOverlay: null, historyClose: null, historyList: null, historyLoading: null, historyEmpty: null, historyBody: null, spellcheckBtn: null, timerDisplay: null, timerCircle: null, timerPlayBtn: null, timerResetBtn: null, timerBgBtn: null
      };
    }

    // 5) Kill vault listeners — prevent any Firestore stream from
    //    surviving the logout / data-clear cycle.
    _unsubscribeVaultListeners();

    // 6) Clear DOM listeners (same as destroy)
    if (_boundDocMouseup)   document.removeEventListener('mouseup', _boundDocMouseup);
    if (_boundDocMousedown) document.removeEventListener('mousedown', _boundDocMousedown);
    if (_boundDocKeyup)     document.removeEventListener('keyup', _boundDocKeyup);
    if (_boundDocKeydown)   document.removeEventListener('keydown', _boundDocKeydown);
    _boundDocMouseup  = null;
    _boundDocMousedown = null;
    _boundDocKeyup    = null;
    _boundDocKeydown  = null;

    }

  // ============================================================
  //   VAULT LISTENER LIFECYCLE
  // ============================================================

  /**
   * Unsubscribe ALL active Firestore vault listeners and reset
   * tracking state. Called on modal close, tab switch, and logout.
   */
  function _unsubscribeVaultListeners() {
    if (_vaultHistoryListener) {
      try { _vaultHistoryListener(); } catch (_) { /* ignore unsubscribe errors */ }
      _vaultHistoryListener = null;
    }
    _historyModalOpen = false;
  }

  // ============================================================
  //   DESTROY
  // ============================================================

  function destroy() {
    // Fire-and-forget save on destroy; no need to block teardown
    _saveImmediate().catch(function () {});
    HubDebounce.cancel('notes-auto-save');

    // ⚠ KILL VAULT LISTENERS: Unsubscribe any active Firestore
    //    onSnapshot listeners to prevent memory leaks when the
    //    user switches tabs away from Notes.
    _unsubscribeVaultListeners();

    // Destroy focus timer (OS-level pause when switching modules)
    if (_timer) { _timer.destroy(); _timer = null; }

    // Remove document-level listeners
    if (_boundDocMouseup)   document.removeEventListener('mouseup', _boundDocMouseup);
    if (_boundDocMousedown) document.removeEventListener('mousedown', _boundDocMousedown);
    if (_boundDocKeyup)     document.removeEventListener('keyup', _boundDocKeyup);
    if (_boundDocKeydown)   document.removeEventListener('keydown', _boundDocKeydown);

    // Clear all refs
    _el = {
      sidebarNotes: null, folderList: null, titleInput: null, editor: null,
      toolbar: null, savingIndicator: null, emptyState: null, editorPane: null,
      addBtn: null, addFolderBtn: null, searchBtn: null, searchBar: null,
      searchInput: null, searchClear: null, manualSaveBtn: null, saveFeedback: null,
      dateContainer: null, dateText: null, dateInput: null, backupBtn: null, historyBtn: null, historyOverlay: null, historyClose: null, historyList: null, historyLoading: null, historyEmpty: null, historyBody: null, spellcheckBtn: null, timerDisplay: null, timerCircle: null, timerPlayBtn: null, timerResetBtn: null, timerBgBtn: null
    };
    // ⚡ PRESERVE _data, _activeNote, _activeFolder, _sessionInitialized,
    //    and _isNotesDataLoaded across tab switches so the in-memory cache
    //    survives destroy() → render() cycles. Only the DOM refs and
    //    listeners need to go — they are re-created on the next render.
    _container = null;
  }

  // ============================================================
  //   VAULT BACKUP — Rolling Cloud Snapshot (isolated from auto-save)
  // ============================================================

  /**
   * Bind the backup button to trigger the confirmation dialog,
   * then execute the rolling backup workflow to Firestore.
   */
  function _bindBackupVault() {
    var btn = _el.backupBtn;
    if (!btn) return;
    btn.addEventListener('click', function () {
      _showBackupConfirmDialog();
    });
  }

  /**
   * Render a clean glass dialog asking the user to confirm the backup.
   * Handles both confirm and cancel paths.
   */
  function _showBackupConfirmDialog() {
    // Remove any existing dialog first
    var existing = document.querySelector('.hub-notes-backup-dialog-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'hub-notes-backup-dialog-overlay';
    overlay.innerHTML =
      '<div class="hub-notes-backup-dialog glass">' +
        '<h3 class="hub-notes-backup-dialog-title">☁️ Cloud Snapshot Backup</h3>' +
        '<p class="hub-notes-backup-dialog-desc">Tạo bản sao lưu an toàn cho ghi chú hiện tại?</p>' +
        '<div class="hub-notes-backup-dialog-actions">' +
          '<button class="hub-notes-backup-dialog-btn" id="hn-backup-cancel">Cancel</button>' +
          '<button class="hub-notes-backup-dialog-btn hub-notes-backup-dialog-btn--confirm" id="hn-backup-confirm">Backup Now</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Cancel handler — click button or click overlay background
    function _dismiss() {
      overlay.remove();
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _dismiss();
    });
    var cancelBtn = overlay.querySelector('#hn-backup-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', _dismiss);

    // Confirm handler
    var confirmBtn = overlay.querySelector('#hn-backup-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        overlay.remove();
        _executeRollingBackup();
      });
    }
  }

  /**
   * Deep-clone the ENTIRE notes workspace tree (_data) into a plain object
   * that can be safely stored and restored without maintaining any references
   * to live objects. This prevents the "Vault History destruction" bug where
   * a shallow copy of only the active note/folder would overwrite the full
   * state on restore, deleting all other desks, folders, and notes.
   *
   * @returns {Object} A complete, detached, JSON-safe snapshot of the
   *                   full notes database: { folders: [...] }
   */
  function _saveVaultSnapshot() {
    if (!_data || !_data.folders) {
      return { folders: [] };
    }

    // Flush active editor state into _activeNote before cloning
    if (_activeNote && _el.titleInput && _el.editor) {
      _activeNote.title   = _el.titleInput.value || 'Untitled';
      _activeNote.content = _el.editor.innerHTML;
    }

    // Deep-clone via JSON round-trip for a guaranteed-independent copy.
    // This is intentional — structuredClone() or manual recursion would
    // also work, but JSON.parse(JSON.stringify()) is the safest way to
    // guarantee zero dangling references to live objects in the module
    // closure. Any Date values are stored as timestamps already.
    try {
      return JSON.parse(JSON.stringify(_data));
    } catch (err) {
      console.error('[Notes Vault] Failed to serialize workspace snapshot:', err);
      return { folders: [] };
    }
  }

  /**
   * Replace the ENTIRE global notes state with a previously saved snapshot
   * (from Vault History), persist it to Cloud / localStorage, and trigger
   * a FULL re-render of the sidebar, folder list, and editor so the UI
   * reflects every restored desk, folder, and note.
   *
   * @param {Object} snapshot - The complete workspace tree { folders: [...] }
   *                            previously produced by _saveVaultSnapshot()
   */
  function _restoreVaultSnapshot(snapshot) {
    if (!snapshot || !snapshot.folders || !Array.isArray(snapshot.folders)) {
      _showBackupToast('❌ Snapshot is corrupt — missing folders array.', true);
      return;
    }

    // ── 1. Validation: every folder must have id, name, and a notes array ──
    var validFolders = snapshot.folders.filter(function (f) {
      return f && f.id && typeof f.name === 'string' && Array.isArray(f.notes);
    });
    if (validFolders.length === 0) {
      _showBackupToast('❌ Snapshot is corrupt — no valid folders found.', true);
      return;
    }

    // Sanitize: strip null/undefined notes from every folder
    validFolders.forEach(function (f) {
      f.notes = f.notes.filter(function (n) { return n && n.id; });
    });

    // ── 2. Deep-clone into _data (JSON round-trip guarantees independence
    //       from the Firestore doc snapshot, which may be internally frozen) ──
    try {
      _data = JSON.parse(JSON.stringify({ folders: validFolders }));
    } catch (err) {
      _showBackupToast('❌ Failed to parse snapshot data.', true);
      return;
    }

    // ── 3. Restore active selection: first folder + first note ──
    _isDataLoaded = true;
    _activeFolder = _data.folders.length > 0 ? _data.folders[0] : null;
    _activeNote = (_activeFolder && _activeFolder.notes && _activeFolder.notes.length > 0)
                    ? _activeFolder.notes[0]
                    : null;

    // ── 4. Persist to Cloud + localStorage ──
    //    Force=true bypasses the auto-save guard so the restored state
    //    is written immediately, even if the user has auto-save off.
    _persist(true).catch(function (err) {
      console.error('[Notes Vault] Persist after restore failed:', err);
    });

    // ── 5. Full UI re-render: sidebar, folder list, note list, editor,
    //       empty-state. This is critical — without this the user still
    //       sees the pre-restore UI and thinks nothing changed. ──
    try {
      _renderFolders();
      _renderNoteList();
      _loadNoteIntoEditor();
    } catch (e) {
      console.error('[Notes Vault] UI re-render failed:', e);
      // If a partial DOM state exists, re-inject the whole UI to recover
      if (_container) {
        _renderUI();
      }
    }

    // ── 6. Close the history modal ──
    _closeHistoryOverlay();

    // ── 7. Feedback ──
    _showBackupToast('✅ Full workspace restored from vault snapshot (' + validFolders.length + ' desk' + (validFolders.length > 1 ? 's' : '') + ')');
  }

  /**
   * Execute the rolling backup workflow:
   * 1. Capture the ENTIRE workspace snapshot via _saveVaultSnapshot()
   * 2. Query notes_backup_vault ordered by created_at ASC
   * 3. If ≥10 docs exist, delete the oldest surplus
   * 4. addDoc the new backup with workspace_snapshot + serverTimestamp()
   * 5. Show success toast
   *
   * IMPORTANT: There are TWO separate Firestore subcollection paths:
   *  - notes_store     — the auto-saving live workspace (used by HubDB)
   *  - notes_backup_vault  — immutable rolling snapshots (this function)
   * NEVER touches HubDB.saveNotesData / hub_notes localStorage key directly.
   */
  async function _executeRollingBackup() {
    // ── 1. Capture the ENTIRE workspace tree via deep-clone ──
    var fullSnapshot = _saveVaultSnapshot();

    // Quick sanity check: at least one folder must exist
    if (!fullSnapshot.folders || fullSnapshot.folders.length === 0) {
      _showBackupToast('⚠️ Workspace trống — không có gì để sao lưu.', true);
      return;
    }

    // ── 2. Check auth / online status ──
    var authStatus = HubDB.getAuthStatus();
    if (!authStatus.loggedIn || navigator.onLine === false) {
      _showBackupToast('⚠️ Bạn cần đăng nhập và có kết nối mạng để sao lưu lên Cloud.', true);
      return;
    }

    // ── 3. Get Firestore reference ──
    var db;
    try {
      db = firebase.firestore();
    } catch (e) {
      _showBackupToast('❌ Không thể kết nối tới Firestore.', true);
      return;
    }

    var vaultRef = db.collection('users').doc(authStatus.uid).collection('notes_backup_vault');

    try {
      // ── 4. Rolling window: query existing backups, prune if ≥ 10 ──
      var existingSnap = await Promise.race([
        vaultRef.orderBy('created_at', 'asc').limit(11).get(),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 15000); }) // Đã tăng từ 3000 lên 15000
      ]);

      var existingDocs = existingSnap.docs; 
      var count = existingDocs.length;

      if (count >= 10) {
        var deleteCount = count - 9; 
        var batch = db.batch();
        for (var i = 0; i < deleteCount; i++) {
          batch.delete(existingDocs[i].ref);
        }
        await batch.commit();
      }

      // ── 5. Summary metadata for the history list preview ──
      var folderCount = fullSnapshot.folders.length;
      var noteCount = 0;
      fullSnapshot.folders.forEach(function (f) { noteCount += (f.notes ? f.notes.length : 0); });

      // ── 6. Insert new backup into the vault ──
      await Promise.race([
        vaultRef.add({
          workspace_snapshot: fullSnapshot,    
          folder_count: folderCount,
          note_count: noteCount,
          capturedAt: Date.now(),             
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        }),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 15000); }) // Đã tăng từ 3000 lên 15000
      ]);

      // ── 7. Success toast ──
      _showBackupToast('✅ Đã sao lưu toàn bộ workspace (' + folderCount + ' desk' + (folderCount > 1 ? 's' : '') + ', ' + noteCount + ' note' + (noteCount > 1 ? 's' : '') + ') lên Két sắt.');
    } catch (err) {
      console.error('[Notes Vault] Backup failed:', err.message || err);
      _showBackupToast('❌ Sao lưu thất bại: ' + (err.message || 'unknown error'), true);
    }
  }

  /**
   * Show a temporary toast notification anchored at the bottom center.
   * @param {string} message - The message to display
   * @param {boolean} [isError=false] - If true, styles as error
   */
  function _showBackupToast(message, isError) {
    // Remove any existing toast
    var existing = document.querySelector('.hub-notes-backup-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'hub-notes-backup-toast';
    toast.textContent = message;
    if (isError) {
      toast.style.borderColor = '#ff4466';
      toast.style.color = '#ff6688';
    }
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add('hub-notes-backup-toast--visible');
    });

    // Auto-dismiss
    var duration = isError ? 4000 : 2500;
    setTimeout(function () {
      toast.classList.remove('hub-notes-backup-toast--visible');
      setTimeout(function () {
        if (toast.parentNode) toast.remove();
      }, 400); // match CSS transition
    }, duration);
  }

  // ============================================================
  //   HISTORY — Real-time Vault Backups (onSnapshot + limit)
  // ============================================================

  /**
   * Bind the HISTORY button: open overlay → subscribe Firestore
   * onSnapshot with limit(10) → render backup list with restore
   * buttons. Unsubscribe on modal close to prevent memory leaks.
   */
  function _bindHistoryVault() {
    // ── Open overlay → subscribe live listener ──
    if (_el.historyBtn) {
      _el.historyBtn.addEventListener('click', function () {
        _openHistoryOverlay();
        _subscribeHistoryListener();
      });
    }

    // ── Close button ──
    if (_el.historyClose) {
      _el.historyClose.addEventListener('click', function () {
        _closeHistoryOverlay();
      });
    }

    // ── Close on backdrop click ──
    if (_el.historyOverlay) {
      _el.historyOverlay.addEventListener('click', function (e) {
        if (e.target === _el.historyOverlay) {
          _closeHistoryOverlay();
        }
      });
    }

    // ── Close on Escape ──
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _el.historyOverlay && _el.historyOverlay.classList.contains('hub-notes-history-overlay--visible')) {
        _closeHistoryOverlay();
      }
    });
  }

  function _openHistoryOverlay() {
    if (!_el.historyOverlay) return;
    // Reset UI state — show loading spinner, hide list + empty states
    if (_el.historyLoading) _el.historyLoading.style.display = '';
    if (_el.historyList) { _el.historyList.style.display = 'none'; _el.historyList.innerHTML = ''; }
    if (_el.historyEmpty) _el.historyEmpty.style.display = 'none';
    _el.historyBody = _el.historyOverlay.querySelector('.hub-notes-history-body');
    _el.historyOverlay.classList.add('hub-notes-history-overlay--visible');
    _historyModalOpen = true;
  }

  function _closeHistoryOverlay() {
    if (_el.historyOverlay) {
      _el.historyOverlay.classList.remove('hub-notes-history-overlay--visible');
    }
    // ⚠ CRITICAL: Unsubscribe the Firestore onSnapshot listener
    //    immediately. Don't wait for tab-switch destroy() — the
    //    listener was created specifically for this modal session.
    _unsubscribeVaultListeners();
  }

  /**
   * Subscribe to notes_backup_vault via Firestore onSnapshot with
   * limit(10). The listener stays alive ONLY while the modal is open,
   * giving real-time updates. It is killed on modal close or tab switch.
   *
   * PREVENTS MEMORY LEAKS: The unsubscribe function is stored in
   * _vaultHistoryListener and cleaned up in _closeHistoryOverlay(),
   * destroy(), and clearData().
   *
   * PREVENTS BROWSER FREEZE: limit(10) ensures we never fetch the
   * entire vault history — only the 10 most recent backups.
   */
  function _subscribeHistoryListener() {
    // ── 1. Defensive: kill any existing listener before starting a new one ──
    _unsubscribeVaultListeners();

    // ── 2. Check auth / online status ──
    var authStatus = HubDB.getAuthStatus();
    if (!authStatus.loggedIn || navigator.onLine === false) {
      _showHistoryEmpty('⚠️ Bạn cần đăng nhập và có kết nối mạng để xem lịch sử sao lưu.');
      return;
    }

    // ── 3. Get Firestore ──
    var db;
    try {
      db = firebase.firestore();
    } catch (e) {
      _showHistoryEmpty('❌ Không thể kết nối tới Firestore.');
      return;
    }

    var vaultRef = db.collection('users').doc(authStatus.uid).collection('notes_backup_vault');

    // ── 4. Subscribe onSnapshot with limit(10) newest-first ──
    //    limit(10) ensures the browser never freezes from fetching
    //    hundreds of backup documents.
    try {
      _vaultHistoryListener = vaultRef
        .orderBy('created_at', 'desc')
        .limit(10)
        .onSnapshot(
          function (snap) {
            _renderHistoryFromSnapshot(snap);
          },
          function (err) {
            console.error('[Notes History] onSnapshot error:', err.message || err);
            _showHistoryEmpty('❌ Lỗi kết nối: ' + (err.message || 'permission denied'));
          }
        );
    } catch (err) {
      console.error('[Notes History] Failed to subscribe:', err.message || err);
      _showHistoryEmpty('❌ Không thể kết nối tới Firestore.');
    }
  }

  /**
   * Render history items from an onSnapshot result.
   * Uses requestAnimationFrame batching to prevent layout thrashing.
   *
   * Handles BOTH v1 (legacy: note_content single-note snapshot) and
   * v2 (current: workspace_snapshot full-tree snapshot) backup formats.
   *
   * @param {firebase.firestore.QuerySnapshot} snap
   */
  function _renderHistoryFromSnapshot(snap) {
    var docs = snap ? snap.docs : [];
    if (!docs || docs.length === 0) {
      _showHistoryEmpty('No backups found in the vault.');
      return;
    }

    // ── 1. Batch all DOM reads BEFORE any writes (prevent layout thrash) ──
    var loadingEl = _el.historyLoading;
    var listEl    = _el.historyList;
    var emptyEl   = _el.historyEmpty;

    // ── 2. Build the fragment off-screen ──
    var frag = document.createDocumentFragment();

    docs.forEach(function (docSnap) {
      var data = docSnap.data();
      if (!data) return;

      // Detect backup format: v2 has workspace_snapshot, v1 has note_content
      var hasWorkspace = !!(data.workspace_snapshot && data.workspace_snapshot.folders);
      var hasLegacyContent = !!(data.note_content);

      if (!hasWorkspace && !hasLegacyContent) return; // unrecognized format

      // ── Build timestamp string ──
      var dateStr = '';
      if (data.created_at && data.created_at.toDate) {
        var d = data.created_at.toDate();
        dateStr = _pad2(d.getDate()) + '/' + _pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' - ' + _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
      } else if (data.capturedAt) {
        var d = new Date(data.capturedAt);
        dateStr = _pad2(d.getDate()) + '/' + _pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' - ' + _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
      }

      // ── Build text snippet for the preview ──
      var snippet = '';
      var isFullWorkspace = false;
      if (hasWorkspace) {
        // v2: full workspace — show desk/note counts
        isFullWorkspace = true;
        var fc = data.folder_count || 0;
        var nc = data.note_count || 0;

        // Compute counts from the actual snapshot if metadata fields missing
        if (!data.folder_count && !data.note_count) {
          fc = data.workspace_snapshot.folders.length;
          nc = 0;
          data.workspace_snapshot.folders.forEach(function (f) { nc += (f.notes ? f.notes.length : 0); });
        }
        snippet = '📦 ' + fc + ' desk' + (fc > 1 ? 's' : '') + ' · ' + nc + ' note' + (nc > 1 ? 's' : '');
      } else {
        // v1 legacy: single-note snapshot
        var rawContent = data.note_content.content || '';
        var plain = rawContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
        snippet = data.note_content.folderName ? '📁 ' + data.note_content.folderName + ' · ' : '';
        snippet += plain.substring(0, 40);
        if (plain.length > 40) snippet += '…';
      }

      // ── Build item DOM ──
      var item = document.createElement('div');
      item.className = 'hub-notes-history-item' + (isFullWorkspace ? ' hub-notes-history-item--full' : '');
      item.setAttribute('data-doc-id', docSnap.id);

      var infoDiv = document.createElement('div');
      infoDiv.className = 'hub-notes-history-item-info';

      var timeSpan = document.createElement('span');
      timeSpan.className = 'hub-notes-history-item-time';
      timeSpan.textContent = dateStr || '(unknown date)';

      var snippetSpan = document.createElement('span');
      snippetSpan.className = 'hub-notes-history-item-snippet';
      snippetSpan.textContent = snippet || '(empty)';

      infoDiv.appendChild(timeSpan);
      infoDiv.appendChild(snippetSpan);

      var restoreBtn = document.createElement('button');
      restoreBtn.className = 'hub-notes-history-restore-btn';
      restoreBtn.textContent = 'Restore';

      // Capture doc id + format-aware restore callback
      if (isFullWorkspace) {
        (function (id, snapData) {
          restoreBtn.addEventListener('click', function () {
            if (!confirm('⚠️ Restore the ENTIRE workspace from this snapshot? ALL current desks and notes will be replaced.')) {
              return;
            }
            _restoreVaultSnapshot(snapData.workspace_snapshot);
          });
        })(docSnap.id, data);
      } else {
        // Legacy restore: single note only — show warning and offer partial restore
        (function (id, snapData) {
          restoreBtn.addEventListener('click', function () {
            if (!confirm('[LEGACY SNAPSHOT] This is an older single-note backup. It will be restored into the current active note. Continue?')) {
              return;
            }
            _restoreBackup(id, snapData.note_content);
          });
        })(docSnap.id, data);
      }

      item.appendChild(infoDiv);
      item.appendChild(restoreBtn);
      frag.appendChild(item);
    });

    // ── 3. Atomic DOM write ──
    requestAnimationFrame(function () {
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'none';
      if (listEl) {
        listEl.innerHTML = '';
        listEl.appendChild(frag);
        listEl.style.display = '';
      }
    });
  }

  /**
   * Zero-pad a number to 2 digits. Tiny utility to avoid repeating
   * String(n).padStart(2,'0') throughout the history render loop.
   */
  function _pad2(n) {
    var s = String(n);
    return s.length === 1 ? '0' + s : s;
  }

  /**
   * Deprecated: replaced by _subscribeHistoryListener + onSnapshot.
   * Kept as a no-op so any stale references don't throw.
   */
  function _fetchAndRenderHistory() {
    // Forward to the new subscription-based approach
    _subscribeHistoryListener();
  }

  /**
   * LEGACY restore: inject a single-note backup (v1 format) into the
   * active note. Only called for old vault entries that predate the
   * full-workspace v2 snapshot format. Does NOT touch other folders/notes.
   *
   * @param {string} docId - Firestore document ID (unused, kept for API consistency)
   * @param {Object} snapshotData - The legacy note_content object
   */
  function _restoreBackup(docId, snapshotData) {
    // ── Inject content into active note ──
    if (_activeNote) {
      _activeNote.title   = snapshotData.title || 'Untitled';
      _activeNote.content = snapshotData.content || '';
      _loadNoteIntoEditor();
    } else {
      // If no active note, create one from the backup into the active folder
      if (!_activeFolder) {
        var folder = {
          id: _uid(),
          name: 'Personal',
          notes: []
        };
        _data.folders.push(folder);
        _activeFolder = folder;
      }
      var note = _buildNoteObject(snapshotData.title || 'Restored Note', snapshotData.content || '');
      note.folderId = _activeFolder.id;
      _activeFolder.notes.unshift(note);
      _activeNote = note;
      _renderFolders();
      _renderNoteList();
      _loadNoteIntoEditor();
    }

    // ── Persist and close ──
    _scheduleSave();
    _closeHistoryOverlay();
    _showBackupToast('✅ Đã khôi phục nội dung note từ Két sắt (legacy snapshot)');
  }

  /**
   * Show the empty-state placeholder inside the modal body.
   */
  function _showHistoryEmpty(message) {
    if (_el.historyLoading) _el.historyLoading.style.display = 'none';
    if (_el.historyList) _el.historyList.style.display = 'none';
    if (_el.historyEmpty) {
      _el.historyEmpty.style.display = '';
      var p = _el.historyEmpty.querySelector('p');
      if (p) p.textContent = message;
    }
  }

  // ============================================================
  //   PUBLIC API
  // ============================================================

  return {
    id: 'notes',
    name: 'Notes',
    getAutoSaveEnabled: getAutoSaveEnabled,
    setAutoSaveEnabled: setAutoSaveEnabled,
    loadFromCloud: loadFromCloud,
    clearData: clearData,
    icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none">' +
      '<path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M6 7h8M6 10h6M6 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '</svg>',
    render: render,
    destroy: destroy
  };
})();

// ── Register with the app router ──
if (typeof app !== 'undefined' && app.register) {
  app.register(notesModule);
}