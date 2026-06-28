/* ============================================================
   HUB.OS — modules/notes.js
   Notion-like rich text notes module with folder organization,
   auto-save, slash commands, and a floating formatting toolbar.
   ============================================================ */

const notesModule = (function () {
  'use strict';

  // ── Constants ──
  const SAVE_DELAY  = 400;

  // ── Private state ──
  let _data         = null;
  let _activeFolder = null;
  let _activeNote   = null;
  let _container    = null;
  let _saveTimer    = null;
  let _isDataLoaded = false;
  /** ⚠ LOAD GUARD: Prevents auto-save from overwriting cloud data
   *  with empty [] before data has finished loading from Firestore.
   *  Only set to true AFTER cloud data is received and rendered.     */
  let _isNotesDataLoaded = false;
  let _autoSaveEnabled = true;
  let _pageUnloading = false; // Prevents ghost saves during page reload

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
    saveFeedback:    null
  };

  // ── Ghost save guard ──
  // The moment the browser starts unloading (page reload / tab close),
  // mark _pageUnloading so no setTimeout callback will fire a write.
  window.addEventListener('beforeunload', function () {
    _pageUnloading = true;
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
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
          console.log("Notes data loaded from cloud/localStorage.");
          return;
        }
      }
    } catch (_) { /* ignore */ }

    // Default data if nothing stored
    _data = {
      folders: [{
        id: _uid(),
        name: 'Personal',
        notes: [_buildNoteObject('Welcome', 'Welcome to Notes!<br><br>Try typing /h1, /h2, or /h3 followed by space to insert headings.')]
      }]
    };
    // ⚠ WARNING: Do NOT call _persist here — data hasn't been rendered yet.
    // The render() function will trigger the first save after it's done.
  }

  async function _persist(force) {
    // ⚠ LOAD GUARD: NEVER write to storage before cloud data is confirmed loaded.
    // This prevents an empty template [] from overwriting good cloud data
    // during the startup race between the auto-save timer and the Firestore fetch.
    if (!_isNotesDataLoaded) {
      console.warn("Auto-save blocked: Data has not finished loading from Cloud yet.");
      return;
    }
    if (!_isDataLoaded) return;
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
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      _persist().then(function () {
      }).catch(function () {
      });
      _saveTimer = null;
    }, SAVE_DELAY);
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
    _activeFolder = _data.folders[0];
    _activeNote   = _activeFolder.notes[0] || null;

    // 4) UNLOCK the Load Guard: Cloud data has been received and is about to be rendered.
    //    This is the only place where _isNotesDataLoaded becomes true.
    //    From this point forward, auto-save is allowed to write to storage.
    _isNotesDataLoaded = true;
    console.log("Notes successfully loaded. Auto-save is now unlocked.");

    // 5) Overwrite with real Notes UI
    container.innerHTML =
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
            '<span class="hub-notes-save-feedback" id="hn-save-feedback"></span>' +
          '</div>' +
          '<div class="hub-notes-editor-area">' +
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
        '<div class="hub-notes-float-toolbar" id="hn-float-toolbar" style="display:none">' +
          '<button class="hub-notes-tb-btn" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button>' +
          '<button class="hub-notes-tb-btn" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button>' +
          '<button class="hub-notes-tb-btn" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>' +
          '<button class="hub-notes-tb-btn hub-notes-tb-highlight" data-cmd="foreColor" data-value="#00f0ff" title="Neon Cyan" aria-label="Neon Cyan text color">A</button>' +
        '</div>' +
      '</div>';

    // 5) Cache all DOM refs
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

    // 6) Render lists
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();

    // 7) Bind all events
    _bindSearchEvents();
    _bindAddNote();
    _bindAddFolder();
    _bindEditorEvents();
    _bindFormatToolbar();
    _bindFolderClicks();
    _bindManualSave();

    // 8) Safe initial persist: Save the loaded/rendered data to cloud.
    //    This happens AFTER the guard is unlocked AND the DOM is mounted,
    //    ensuring we NEVER save empty data and the Saving indicator works.
    _persist(true);
  }

  // ============================================================
  //   RENDER — Sidebar
  // ============================================================

  function _renderFolders() {
    var el = _el.folderList;
    if (!el) return;
    var html = '';
    for (var i = 0; i < _data.folders.length; i++) {
      var f = _data.folders[i];
      var activeClass = (_activeFolder && f.id === _activeFolder.id) ? ' hub-notes-active' : '';
      html += '<button class="hub-notes-folder-item' + activeClass + '" data-folder-id="' + _escHtml(f.id) + '">' +
        '<svg class="hub-notes-folder-icon" width="14" height="14" viewBox="0 0 20 20" fill="none">' +
          '<path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" fill="currentColor" opacity="0.3"/>' +
          '<path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.2" fill="none"/>' +
        '</svg>' +
        '<span>' + _escHtml(f.name) + '</span>' +
        '<span class="hub-notes-folder-count">' + (f.notes ? f.notes.length : 0) + '</span>' +
      '</button>';
    }
    el.innerHTML = html;
  }

  function _renderNoteList() {
    var el = _el.sidebarNotes;
    if (!el) return;
    if (!_activeFolder || !_activeFolder.notes || _activeFolder.notes.length === 0) {
      el.innerHTML = '<div class="hub-notes-empty-list">No notes yet</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < _activeFolder.notes.length; i++) {
      var n = _activeFolder.notes[i];
      if (!n) continue; // Safety check
      var activeClass = (_activeNote && n.id === _activeNote.id) ? ' hub-notes-active' : '';
      html += '<button class="hub-notes-note-item' + activeClass + '" data-note-id="' + _escHtml(n.id) + '">' +
        '<span class="hub-notes-note-title">' + _escHtml(n.title || 'Untitled') + '</span>' +
        '<span class="hub-notes-note-date">' + _formatDate(n.updatedAt) + '</span>' +
      '</button>';
    }
    el.innerHTML = html;
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

  // ============================================================
  //   RENDER — Editor
  // ============================================================

  function _loadNoteIntoEditor() {
    if (!_activeNote) {
      if (_el.titleInput) _el.titleInput.style.display = 'none';
      if (_el.editor) _el.editor.style.display = 'none';
      if (_el.emptyState) _el.emptyState.style.display = '';
      if (_el.editorPane) _el.editorPane.classList.add('hub-notes-editor--empty');
      return;
    }
    if (_el.emptyState) _el.emptyState.style.display = 'none';
    if (_el.editorPane) _el.editorPane.classList.remove('hub-notes-editor--empty');
    if (_el.titleInput) { _el.titleInput.style.display = ''; _el.titleInput.value = _activeNote.title; }
    if (_el.editor) { _el.editor.style.display = ''; _el.editor.innerHTML = _activeNote.content || ''; }

    _updateNoteListDate();
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
    var folder = null;
    for (var i = 0; i < _data.folders.length; i++) {
      if (_data.folders[i].id === folderId) { folder = _data.folders[i]; break; }
    }
    if (!folder) return;
    var name = prompt('Rename desk:', folder.name);
    if (!name || !name.trim() || name.trim() === folder.name) return;
    folder.name = name.trim();
    _persist();
    _renderFolders();
  }

  function _deleteFolder(folderId) {
    if (!confirm('Delete this desk and all its notes?')) return;
    var idx = -1;
    for (var i = 0; i < _data.folders.length; i++) {
      if (_data.folders[i].id === folderId) { idx = i; break; }
    }
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
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!q) {
        item.style.display = '';
        continue;
      }
      var titleEl = item.querySelector('.hub-notes-note-title');
      var title   = titleEl ? titleEl.textContent.toLowerCase() : '';
      var content = item.getAttribute('data-search-content') || '';
      // Build content index on first encounter
      if (!content) {
        var nid = item.getAttribute('data-note-id');
        if (nid && _activeFolder) {
          for (var j = 0; j < _activeFolder.notes.length; j++) {
            var n = _activeFolder.notes[j];
            if (n && n.id === nid) {
              content = (n.title || '') + ' ' + (n.content || '');
              content = content.toLowerCase().replace(/<[^>]+>/g, '');
              item.setAttribute('data-search-content', content);
              break;
            }
          }
        }
      }
      var match = title.indexOf(q) !== -1 || content.indexOf(q) !== -1;
      item.style.display = match ? '' : 'none';
    }
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
      var folder = null;
      for (var i = 0; i < _data.folders.length; i++) {
        if (_data.folders[i].id === fid) { folder = _data.folders[i]; break; }
      }
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
        if (items) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
              e.preventDefault();
              alert('⚠️ Hub.OS Protocol: Direct image pasting is disabled to protect the 5MB storage limit. Please use an Image URL instead.');
              return;
            }
          }
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
        if (files) {
          for (var i = 0; i < files.length; i++) {
            if (files[i].type.indexOf('image') !== -1) {
              e.preventDefault();
              alert('⚠️ Hub.OS Protocol: Drag & drop for images is not supported in the Offline version.');
              return;
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
        var note = null;
        if (_activeFolder) {
          for (var i = 0; i < _activeFolder.notes.length; i++) {
            if (_activeFolder.notes[i] && _activeFolder.notes[i].id === nid) { 
              note = _activeFolder.notes[i]; 
              break; 
            }
          }
        }
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
        document.execCommand('foreColor', false, val);
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
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
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
      if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
      }
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

    console.log("[Notes] Data loaded from cloud after login.");
  }

  /**
   * Called after logout. Clears all local notes state, resets the
   * Load Guard, and clears the UI so the user never sees stale data.
   */
  function clearData() {
    // 1) Cancel any pending save
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }

    // 2) Reset the Load Guard — no saves will fire until re-login + re-load
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
        searchInput: null, searchClear: null, manualSaveBtn: null, saveFeedback: null
      };
    }

    // 5) Clear DOM listeners (same as destroy)
    if (_boundDocMouseup)   document.removeEventListener('mouseup', _boundDocMouseup);
    if (_boundDocMousedown) document.removeEventListener('mousedown', _boundDocMousedown);
    if (_boundDocKeyup)     document.removeEventListener('keyup', _boundDocKeyup);
    if (_boundDocKeydown)   document.removeEventListener('keydown', _boundDocKeydown);
    _boundDocMouseup  = null;
    _boundDocMousedown = null;
    _boundDocKeyup    = null;
    _boundDocKeydown  = null;

    console.log("[Notes] Data cleared after logout. Load Guard reset.");
  }

  // ============================================================
  //   DESTROY
  // ============================================================

  function destroy() {
    // Fire-and-forget save on destroy; no need to block teardown
    _saveImmediate().catch(function () {});
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }

    // Remove document-level listeners
    if (_boundDocMouseup)   document.removeEventListener('mouseup', _boundDocMouseup);
    if (_boundDocMousedown) document.removeEventListener('mousedown', _boundDocMousedown);
    if (_boundDocKeyup)     document.removeEventListener('keyup', _boundDocKeyup);
    if (_boundDocKeydown)   document.removeEventListener('keydown', _boundDocKeydown);

    // Clear all refs
    _el = {
      sidebarNotes: null, folderList: null, titleInput: null, editor: null,
      toolbar: null, savingIndicator: null, emptyState: null, editorPane: null,
      addBtn: null, addFolderBtn: null
    };
    _boundDocMouseup  = null;
    _boundDocMousedown = null;
    _boundDocKeyup    = null;
    _boundDocKeydown  = null;
    _activeNote   = null;
    _activeFolder = null;
    _data   = null;
    _container = null;
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