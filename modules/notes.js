/* ============================================================
   HUB.OS — modules/notes.js
   Notion-like rich text notes module with folder organization,
   auto-save, slash commands, and a floating formatting toolbar.
   ============================================================ */

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
  let _pageUnloading = false; // Prevents ghost saves during page reload

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
    spellcheckBtn:  null
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
            '<span class="hub-notes-save-feedback" id="hn-save-feedback"></span>' +
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
          '<button class="hub-notes-tb-btn" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button>' +
          '<button class="hub-notes-tb-btn" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>' +
          '<button class="hub-notes-tb-btn hub-notes-tb-highlight" data-cmd="foreColor" data-value="#00f0ff" title="Neon Cyan" aria-label="Neon Cyan text color">A</button>' +
          '<span class="hub-notes-tb-sep"></span>' +
          '<button class="hub-notes-tb-btn" data-cmd="insertUnorderedList" title="Bullet List" aria-label="Bullet List">' +
            '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
              '<path d="M4 4.5h10M4 8h10M4 11.5h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
              '<circle cx="2" cy="4.5" r="1" fill="currentColor"/>' +
              '<circle cx="2" cy="8" r="1" fill="currentColor"/>' +
              '<circle cx="2" cy="11.5" r="1" fill="currentColor"/>' +
            '</svg>' +
          '</button>' +
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

    // Render lists
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();

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
    if (!_activeNote) {
      if (_el.titleInput) _el.titleInput.style.display = 'none';
      if (_el.editor) _el.editor.style.display = 'none';
      if (_el.emptyState) _el.emptyState.style.display = '';
      if (_el.editorPane) _el.editorPane.classList.add('hub-notes-editor--empty');
      if (_el.dateContainer) _el.dateContainer.style.display = 'none';
      return;
    }
    if (_el.emptyState) _el.emptyState.style.display = 'none';
    if (_el.editorPane) _el.editorPane.classList.remove('hub-notes-editor--empty');
    if (_el.titleInput) { _el.titleInput.style.display = ''; _el.titleInput.value = _activeNote.title; }
    if (_el.editor) { _el.editor.style.display = ''; _el.editor.innerHTML = _activeNote.content || ''; }
    if (_el.dateContainer) _el.dateContainer.style.display = '';

    _updateDateDisplay();
    _updateNoteListDate();
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

    // Anti-Base64 Defense: block pasted images and embedded Base64 images
    if (_el.editor) {
      _el.editor.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (items && [].some.call(items, function (it) { return it.type.indexOf('image') !== -1; })) {
          e.preventDefault();
          alert('⚠️ Hub.OS Protocol: Direct image pasting is disabled to protect the 5MB storage limit. Please use an Image URL instead.');
        }
        var html = e.clipboardData && e.clipboardData.getData('text/html');
        if (html && html.indexOf('src="data:image/') !== -1) {
          e.preventDefault();
          alert('⚠️ Hub.OS Protocol: Hidden Base64 image detected in pasted content. Please use an Image URL instead.');
        }
      });
    }

    // Anti-Base64 Defense: block dropped images
    if (_el.editor) {
      _el.editor.addEventListener('drop', function (e) {
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && [].some.call(files, function (f) { return f.type.indexOf('image') !== -1; })) {
          e.preventDefault();
          alert('⚠️ Hub.OS Protocol: Drag & drop for images is not supported in the Offline version.');
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
      if (_el.editor.contains(t) || _el.toolbar.contains(t)) return;
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

    // Toolbar button clicks
    _el.toolbar.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var btn = e.target.closest('.hub-notes-tb-btn');
      if (!btn) return;
      var cmd = btn.getAttribute('data-cmd');
      var val = btn.getAttribute('data-value');
      if (cmd === 'foreColor' && val) {
        // Toggle: if selection is already the highlight color, revert to default
        var currentColor = '';
        try { currentColor = document.queryCommandValue('foreColor'); } catch (_) {}
        // Convert both to lowercase hex for comparison
        var normalizeColor = function (c) {
          if (!c) return '';
          c = c.toLowerCase().replace(/\s/g, '');
          // rgb(0, 240, 255) → #00f0ff
          var rgb = c.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
          if (rgb) {
            return '#' + [rgb[1], rgb[2], rgb[3]].map(function (n) {
              var h = parseInt(n, 10).toString(16);
              return h.length === 1 ? '0' + h : h;
            }).join('');
          }
          return c;
        };
        var tgt = normalizeColor(val);
        var cur = normalizeColor(currentColor);
        if (cur === tgt) {
          document.execCommand('foreColor', false, '#ffffff');
        } else {
          document.execCommand('foreColor', false, val);
        }
      } else if (cmd) {
        document.execCommand(cmd, false, null);
      }
      if (_el.editor) _el.editor.focus();
      setTimeout(_updateToolbarPosition, 10);
    });
  }

function _updateToolbarPosition() {
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (text.length === 0 || !sel || !sel.rangeCount || !_el.editor || !_el.toolbar) {
      _hideToolbar();
      return;
    }

    // Kiểm tra xem đoạn bôi đen có nằm trong editor không
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

    // Ép thanh menu dùng tọa độ "Fixed" (Bám dính chính xác theo màn hình)
    _el.toolbar.style.position = 'fixed';
    _el.toolbar.style.display = 'flex'; // Bật hiển thị trước để đo chiều rộng

    var tbWidth = _el.toolbar.offsetWidth || 140;
    
    // Tính toán: Nổi lên đúng 45px ngay trên đầu chữ bôi đen, và nằm ngay chính giữa
    var top  = rect.top - 45;
    var left = rect.left + (rect.width / 2) - (tbWidth / 2);

    _el.toolbar.style.top  = Math.max(10, top) + 'px';
    _el.toolbar.style.left = Math.max(10, left) + 'px';
    _el.toolbar.classList.add('hub-notes-toolbar--visible');
  }

  function _hideToolbar() {
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
        dateContainer: null, dateText: null, dateInput: null, backupBtn: null, historyBtn: null, historyOverlay: null, historyClose: null, historyList: null, historyLoading: null, historyEmpty: null, historyBody: null, spellcheckBtn: null
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
      dateContainer: null, dateText: null, dateInput: null, backupBtn: null, historyBtn: null, historyOverlay: null, historyClose: null, historyList: null, historyLoading: null, historyEmpty: null, historyBody: null, spellcheckBtn: null
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
   * Execute the rolling backup workflow:
   * 1. Capture current editor content
   * 2. Query notes_backup_vault ordered by created_at ASC
   * 3. If ≥10 docs exist, delete the oldest surplus
   * 4. addDoc the new backup with note_content + serverTimestamp()
   * 5. Show success toast
   *
   * IMPORTANT: This NEVER touches HubDB.saveNotesData / hub_notes localStorage key.
   * It operates on a fully isolated collection: users/{uid}/notes_backup_vault
   */
  async function _executeRollingBackup() {
    // ── 1. Capture current note content ──
    // Flush live editor state into _activeNote so we snapshot what the user sees
    if (_activeNote && _el.titleInput && _el.editor) {
      _activeNote.title   = _el.titleInput.value || 'Untitled';
      _activeNote.content = _el.editor.innerHTML;
    }

    var snapshot = {
      title: _activeNote ? _activeNote.title : '(empty)',
      content: _activeNote ? _activeNote.content : '',
      noteId: _activeNote ? _activeNote.id : null,
      folderName: _activeFolder ? _activeFolder.name : '(none)',
      capturedAt: Date.now() // client-side timestamp as fallback
    };

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
      // ── 4. Rolling window: query existing backups, prune if ≥10 ──
      //    limit(11) is optimal: we only need to know if 10+ docs exist
      //    and which are the oldest. Fetching all docs would freeze the
      //    browser if the vault grows unbounded.
      var existingSnap = await Promise.race([
        vaultRef.orderBy('created_at', 'asc').limit(11).get(),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 3000); })
      ]);

      var existingDocs = existingSnap.docs; // array of QueryDocumentSnapshot
      var count = existingDocs.length;

      // If 10 or more exist, delete the oldest so that 9 remain before adding
      if (count >= 10) {
        var deleteCount = count - 9; // how many to prune
        var batch = db.batch();
        for (var i = 0; i < deleteCount; i++) {
          batch.delete(existingDocs[i].ref);
        }
        await batch.commit();
      }

      // ── 5. Insert new backup via addDoc (always creates a new doc) ──
      await Promise.race([
        vaultRef.add({
          note_content: snapshot,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        }),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 3000); })
      ]);

      // ── 6. Success toast ──
      _showBackupToast('✅ Đã đẩy bản sao lưu lên Két sắt an toàn');
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
   * @param {firebase.firestore.QuerySnapshot} snap
   */
  function _renderHistoryFromSnapshot(snap) {
    var docs = snap ? snap.docs : [];
    if (!docs || docs.length === 0) {
      _showHistoryEmpty('No backups found in the vault.');
      return;
    }

    // ── 1. Batch all DOM reads BEFORE any writes (prevent layout thrash) ──
    //    Read current display states first, then write them in one frame.
    var loadingEl = _el.historyLoading;
    var listEl    = _el.historyList;
    var emptyEl   = _el.historyEmpty;

    // ── 2. Use requestAnimationFrame to defer DOM writes ──
    //    Build the fragment off-screen first, then attach in one atomic operation.
    var frag = document.createDocumentFragment();

    docs.forEach(function (docSnap) {
      var data = docSnap.data();
      if (!data || !data.note_content) return; // skip malformed docs

      var snapshotData = data.note_content;

      // ── Build timestamp string ──
      var dateStr = '';
      if (data.created_at && data.created_at.toDate) {
        var d = data.created_at.toDate();
        dateStr = _pad2(d.getDate()) + '/' + _pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' - ' + _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
      } else if (snapshotData.capturedAt) {
        var d = new Date(snapshotData.capturedAt);
        dateStr = _pad2(d.getDate()) + '/' + _pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' - ' + _pad2(d.getHours()) + ':' + _pad2(d.getMinutes());
      }

      // ── Build text snippet (first 30 chars, strip HTML) ──
      var rawContent = snapshotData.content || '';
      var plain = rawContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      var snippet = plain.substring(0, 30);
      if (plain.length > 30) snippet += '…';

      // ── Build item DOM (off-screen, no reflow triggered) ──
      var item = document.createElement('div');
      item.className = 'hub-notes-history-item';
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
      // Capture docId + snapshotData in closure for restore
      restoreBtn.addEventListener('click', (function (id, snapData) {
        return function () { _restoreBackup(id, snapData); };
      })(docSnap.id, snapshotData));

      item.appendChild(infoDiv);
      item.appendChild(restoreBtn);
      frag.appendChild(item);
    });

    // ── 3. Atomic DOM write: attach fragment + toggle visibility in one microtask ──
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
   * Confirm → inject backup content into editor → close modal → toast.
   */
  function _restoreBackup(docId, snapshotData) {
    if (!confirm('Bạn có chắc chắn muốn ghi đè nội dung hiện tại bằng bản sao lưu này không?')) {
      return;
    }

    // ── Inject content into active note ──
    if (_activeNote) {
      _activeNote.title   = snapshotData.title || 'Untitled';
      _activeNote.content = snapshotData.content || '';
      _loadNoteIntoEditor();
    } else {
      // If no active note, create one from the backup
      if (!_activeFolder) {
        // Create a default folder if none exists
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

    // ── Persist the restored content ──
    _scheduleSave();

    // ── Close modal ──
    _closeHistoryOverlay();

    // ── Success toast ──
    _showBackupToast('✅ Đã khôi phục dữ liệu từ Két sắt');
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