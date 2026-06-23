/* ============================================================
   HUB.OS — modules/notes.js
   Notion-like rich text notes module with folder organization,
   auto-save, slash commands, and a floating formatting toolbar.

   Module contract:
     - id: 'notes'
     - render(container) → injects the notes UI
     - destroy()        → cleans up event listeners & intervals
   ============================================================ */

const notesModule = (function () {
  'use strict';

  // ── Constants ──
  const STORAGE_KEY = 'hub_notes';
  const SAVE_DELAY  = 400; // ms debounce for auto-save

  // ── Private state ──
  let _data         = null;       // { folders: [ { id, name, notes: [...] } ] }
  let _activeFolder = null;       // folder object reference
  let _activeNote   = null;       // note object reference (mutable via _data)
  let _container    = null;       // root container DOM element
  let _saveTimer    = null;       // debounce timer ID
  let _sidebarNotes = null;       // cached sidebar note-list container
  let _titleInput   = null;       // cached title input
  let _editor       = null;       // cached editor div
  let _folderList   = null;       // cached folder list container
  let _toolbar      = null;       // floating formatting toolbar
  let _savingIndicator = null;    // "Saving..." indicator

  // ============================================================
  //   STORAGE
  // ============================================================

  function _loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.folders) && parsed.folders.length > 0) {
          _data = parsed;
          return;
        }
      }
    } catch (_) { /* ignore parse errors */ }
    // Default state
    _data = {
      folders: [{
        id: _uid(),
        name: 'Personal',
        notes: [_createNote('Personal', 'Welcome to Notes!\n\nTry typing /h1, /h2, or /h3 followed by space to insert headings.')]
      }]
    };
    _persist();
  }

  function _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
    } catch (_) { /* quota exceeded */ }
  }

  /** Debounced persist with visual indicator */
  function _scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _showSaving(true);
    _saveTimer = setTimeout(() => {
      _persist();
      _showSaving(false);
      _saveTimer = null;
    }, SAVE_DELAY);
  }

  function _showSaving(active) {
    if (_savingIndicator) {
      _savingIndicator.textContent = active ? 'Saving...' : 'Saved';
      _savingIndicator.classList.toggle('notes-saving--active', active);
    }
  }

  // ============================================================
  //   HELPERS
  // ============================================================

  function _uid() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  function _createNote(title, content) {
    return {
      id: _uid(),
      title: title || 'Untitled',
      content: content || '',
      folderId: null,
      updatedAt: Date.now()
    };
  }

  function _escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ============================================================
  //   RENDER — Entry Point
  // ============================================================

  function render(container) {
    _container = container;
    _loadData();
    _activeFolder = _data.folders[0];
    _activeNote   = _activeFolder.notes[0] || null;

    container.innerHTML = `
      <div class="tab-content notes-app">
        <!-- Left Pane — Sidebar -->
        <aside class="notes-sidebar glass" id="notes-sidebar">
          <div class="notes-sidebar-header">
            <span class="notes-sidebar-title">Notes</span>
            <button class="notes-btn-add" id="notes-btn-add" title="New Note" aria-label="New Note">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>

          <!-- Folder list -->
          <div class="notes-folder-list" id="notes-folder-list"></div>

          <!-- Note list divider -->
          <div class="notes-divider"></div>

          <!-- Note list -->
          <div class="notes-note-list" id="notes-note-list"></div>

          <!-- Saving indicator -->
          <div class="notes-saving" id="notes-saving">Saved</div>
        </aside>

        <!-- Right Pane — Editor -->
        <main class="notes-editor-pane" id="notes-editor-pane">
          <div class="notes-editor-area">
            <input
              type="text"
              class="notes-title-input"
              id="notes-title-input"
              placeholder="Untitled"
              spellcheck="false"
            />
            <div
              class="notes-editor"
              id="note-editor"
              contenteditable="true"
              data-placeholder="Start writing... /h1 /h2 /h3 for headings"
            ></div>
          </div>

          <!-- Empty state (shown when no note is selected) -->
          <div class="notes-empty-state" id="notes-empty-state" style="display:none">
            <div class="notes-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
                <path d="M12 6v12M6 12h12"/>
              </svg>
            </div>
            <p class="notes-empty-title">No note selected</p>
            <p class="notes-empty-sub">Create a new note to get started</p>
          </div>
        </main>

        <!-- Floating Formatting Toolbar -->
        <div class="notes-float-toolbar" id="notes-float-toolbar">
          <button class="notes-tb-btn" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button>
          <button class="notes-tb-btn" data-cmd="italic" title="Italic" aria-label="Italic"><i>I</i></button>
          <button class="notes-tb-btn" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>
          <button class="notes-tb-btn notes-tb-highlight" data-cmd="foreColor" data-value="#00f0ff" title="Neon Cyan" aria-label="Neon Cyan text color">A</button>
        </div>
      </div>
    `;

    // Cache refs
    _sidebarNotes    = document.getElementById('notes-note-list');
    _folderList      = document.getElementById('notes-folder-list');
    _titleInput      = document.getElementById('notes-title-input');
    _editor          = document.getElementById('note-editor');
    _toolbar         = document.getElementById('notes-float-toolbar');
    _savingIndicator = document.getElementById('notes-saving');

    // Render lists
    _renderFolders();
    _renderNoteList();
    _loadNoteIntoEditor();

    // ── Bind events ──
    _bindAddNote();
    _bindEditorEvents();
    _bindFormatToolbar();
    _bindFolderClicks();
  }

  // ============================================================
  //   RENDER — Sidebar
  // ============================================================

function _renderFolders() {
    if (!_data || !_data.folders) return;
    _folderList.innerHTML = _data.folders.map(f => `
      <button class="notes-folder-item${(_activeFolder && f.id === _activeFolder.id) ? ' active' : ''}" data-folder-id="${_escHtml(f.id)}">
        <svg class="notes-folder-icon" width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" fill="currentColor" opacity="0.3"/>
          <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" stroke="currentColor" stroke-width="1.2" fill="none"/>
        </svg>
        <span>${_escHtml(f.name)}</span>
        <span class="notes-folder-count">${f.notes ? f.notes.length : 0}</span>
      </button>
    `).join('');
  }

  function _renderNoteList() {
    // Lớp khiên bảo vệ: Nếu không có thư mục nào thì dừng lại ngay, không báo lỗi
    if (!_activeFolder || !_activeFolder.notes) return;
    
    _sidebarNotes.innerHTML = _activeFolder.notes.map(n => `
      <button class="notes-note-item${(_activeNote && n.id === _activeNote.id) ? ' active' : ''}" data-note-id="${_escHtml(n.id)}">
        <span class="notes-note-title">${_escHtml(n.title || 'Untitled')}</span>
        <span class="notes-note-date">${_formatDate(n.updatedAt)}</span>
      </button>
    `).join('');
  }

  function _formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return diffHrs + 'h ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ============================================================
  //   RENDER — Editor
  // ============================================================

function _loadNoteIntoEditor() {
    const emptyState = document.getElementById('notes-empty-state');
    const editorPane = document.getElementById('notes-editor-pane');

    // Nếu không có Note nào đang được chọn
    if (!_activeNote) {
      if (_titleInput) _titleInput.style.display = 'none';
      if (_editor) _editor.style.display = 'none';
      if (emptyState) emptyState.style.display = '';
      if (editorPane) editorPane.classList.add('notes-editor--empty');
      return;
    }

    // Nếu CÓ Note đang được chọn
    if (emptyState) emptyState.style.display = 'none';
    if (editorPane) editorPane.classList.remove('notes-editor--empty');
    
    if (_titleInput) {
      _titleInput.style.display = '';
      _titleInput.value = _activeNote.title;
    }
    
    if (_editor) {
      _editor.style.display = '';
      _editor.innerHTML = _activeNote.content || '';
    }

   
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

function _createNote() {
    // Sửa lỗi tự gọi chính nó (Infinite Recursion) bằng cách tạo Object trực tiếp
    const note = {
      id: 'note_' + Date.now().toString(36),
      title: 'Untitled',
      content: '',
      folderId: _activeFolder ? _activeFolder.id : 'default',
      updatedAt: Date.now()
    };
    
    if (_activeFolder && _activeFolder.notes) {
      _activeFolder.notes.unshift(note);
    }
    
    _activeNote = note;
    _persist();
    _renderNoteList();
    _loadNoteIntoEditor();
    _renderFolders();
    
    // Loại bỏ cú pháp ?. gây lỗi Syntax Error
    setTimeout(() => {
      if (typeof _titleInput !== 'undefined' && _titleInput) {
        _titleInput.focus();
      }
    }, 50);
  }

  function _deleteNote(noteId) {
    if (!_activeFolder || !_activeFolder.notes) return;
    
    const idx = _activeFolder.notes.findIndex(n => n.id === noteId);
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
  //   SLASH COMMANDS
  // ============================================================

  function _handleSlashCommand() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const text = node.textContent || '';
    const pos  = range.startOffset;

    // Look backwards from cursor for a slash pattern
    const before = text.substring(0, pos);
    const match = before.match(/\/(h[123])\s$/);
    if (!match) return false;

    const tag = match[1];           // "h1", "h2", or "h3"
    const cmdLen = match[0].length; // e.g. "/h1 "

    // Delete the "/h1 " text
    range.setStart(node, pos - cmdLen);
    range.deleteContents();

    // Create the heading element
    const heading = document.createElement(tag);
    heading.innerHTML = '&#8203;'; // zero-width space for cursor
    range.insertNode(heading);

    // Place cursor inside the heading
    range.selectNodeContents(heading);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    _scheduleSave();
    return true;
  }

  // ============================================================
  //   EVENT BINDING
  // ============================================================

  function _bindAddNote() {
    const btn = document.getElementById('notes-btn-add');
    if (!btn) return;
    btn.addEventListener('click', _createNote);
  }

  function _bindFolderClicks() {
    _folderList.addEventListener('click', (e) => {
      const item = e.target.closest('.notes-folder-item');
      if (!item) return;
      const fid = item.dataset.folderId;
      const folder = _data.folders.find(f => f.id === fid);
      if (!folder || folder.id === _activeFolder.id) return;
      _activeFolder = folder;
      _activeNote = _activeFolder.notes[0] || null;
      _renderFolders();
      _renderNoteList();
      _loadNoteIntoEditor();
    });
  }

  function _bindEditorEvents() {
    // Title input changes
    _titleInput?.addEventListener('input', () => {
      if (_activeNote) {
        _activeNote.title = _titleInput.value || 'Untitled';
        _scheduleSave();
        _renderNoteList();
      }
    });

    // Editor content changes
    _editor?.addEventListener('input', () => {
      if (_activeNote) {
        _activeNote.content = _editor.innerHTML;
        _updateNoteListDate();
        _scheduleSave();
      }
    });

    // Slash commands on keyup
    _editor?.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        _handleSlashCommand();
      }
    });

    // Combined keydown for Enter + Backspace
    _editor?.addEventListener('keydown', (e) => {
      // Enter at end of heading → break out to paragraph
      if (e.key === 'Enter') {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const node = sel.anchorNode;
        const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        const heading = el?.closest('h1, h2, h3');
        if (heading && sel.anchorOffset === (node.textContent || '').length) {
          e.preventDefault();
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          heading.parentNode.insertBefore(p, heading.nextSibling);
          const range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          _scheduleSave();
          return;
        }
      }

      // Backspace at start of a heading → downgrade to paragraph
      if (e.key === 'Backspace') {
        _handleBackspaceInHeading(e);
      }
    });

    // Keyboard shortcut: Ctrl+Shift+N for new note
    _editor?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        _createNote();
      }
    });

    // Click on a note item in sidebar
    _sidebarNotes?.addEventListener('click', (e) => {
      const item = e.target.closest('.notes-note-item');
      if (!item) return;
      const nid = item.dataset.noteId;
      if (nid === _activeNote?.id) return;
      // Save before switching
      _saveImmediate();
      const note = _activeFolder.notes.find(n => n.id === nid);
      if (note) {
        _activeNote = note;
        _renderNoteList();
        _loadNoteIntoEditor();
      }
    });

    // Right-click to delete note (sidebar context)
    _sidebarNotes?.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.notes-note-item');
      if (!item) return;
      e.preventDefault();
      if (confirm('Delete this note?')) {
        _deleteNote(item.dataset.noteId);
      }
    });

    // Keyboard: Escape to blur editor
    _editor?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        _editor.blur();
      }
    });
  }

  function _handleBackspaceInHeading(e) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (sel.anchorOffset !== 0) return;
    const node = sel.anchorNode;
    if (!node) return;
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const heading = el?.closest('h1, h2, h3');
    if (!heading) return;

    // Only if we're at the very start of the heading
    const range = sel.getRangeAt(0);
    if (range.startOffset !== 0 || (range.startContainer.textContent || '').length === 0) return;

    e.preventDefault();
    // Replace heading with a paragraph
    const p = document.createElement('p');
    p.innerHTML = heading.innerHTML;
    heading.parentNode.replaceChild(p, heading);
    const newRange = document.createRange();
    newRange.setStart(p.firstChild || p, 0);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    _scheduleSave();
  }

  // ============================================================
  //   FLOATING FORMATTING TOOLBAR
  // ============================================================

  function _bindFormatToolbar() {
    if (!_editor || !_toolbar) return;

    // Show toolbar on text selection
    document.addEventListener('mouseup', _updateToolbarPosition);
    document.addEventListener('keyup', (e) => {
      // Only for arrow + shift combinations (text selection via keyboard)
      if (e.key.startsWith('Arrow') && e.shiftKey) {
        _updateToolbarPosition();
      }
    });

    // Hide toolbar when clicking outside the editor
    document.addEventListener('mousedown', (e) => {
      if (_editor.contains(e.target) || _toolbar.contains(e.target)) return;
      _hideToolbar();
    });

    // Toolbar button clicks
    _toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
      const btn = e.target.closest('.notes-tb-btn');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.value;
      if (cmd === 'foreColor' && val) {
        document.execCommand('foreColor', false, val);
      } else {
        document.execCommand(cmd, false, null);
      }
      _editor.focus();
      // Toolbar may still be relevant — reposition
      setTimeout(_updateToolbarPosition, 10);
    });

    // Hide on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _hideToolbar();
    });
  }

  function _updateToolbarPosition() {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (text.length === 0 || !sel.rangeCount) {
      _hideToolbar();
      return;
    }

    // Check selection is inside our editor
    let node = sel.anchorNode;
    while (node && node !== _editor && node !== document) node = node.parentNode;
    if (!node || node !== _editor) {
      _hideToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      _hideToolbar();
      return;
    }

    const editorRect = _editor.getBoundingClientRect();
    const top = rect.top - editorRect.top - 48;
    const left = rect.left - editorRect.left + (rect.width / 2);

    _toolbar.style.display = 'flex';
    _toolbar.style.top = Math.max(4, top) + 'px';
    _toolbar.style.left = Math.max(0, left) + 'px';
    _toolbar.style.transform = 'translateX(-50%)';
    _toolbar.classList.add('notes-toolbar--visible');
  }

  function _hideToolbar() {
    if (_toolbar) {
      _toolbar.style.display = 'none';
      _toolbar.classList.remove('notes-toolbar--visible');
    }
  }

  // ============================================================
  //   SAVE — Force immediate persist
  // ============================================================

  function _saveImmediate() {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    // Flush pending content
    if (_activeNote && _titleInput && _editor) {
      _activeNote.title = _titleInput.value || 'Untitled';
      _activeNote.content = _editor.innerHTML;
    }
    _persist();
    _showSaving(false);
  }

  // ============================================================
  //   DESTROY
  // ============================================================

  function destroy() {
    _saveImmediate();
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    _toolbar = null;
    _sidebarNotes = null;
    _folderList = null;
    _titleInput = null;
    _editor = null;
    _savingIndicator = null;
    _activeNote = null;
    _activeFolder = null;
    _data = null;
    _container = null;
  }

  // ============================================================
  //   PUBLIC API
  // ============================================================

  return {
    id: 'notes',
    name: 'Notes',
    icon: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3"/>
      <path d="M6 7h8M6 10h6M6 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`,
    render,
    destroy
  };
})();

// ── Register with the app router ──
if (typeof app !== 'undefined' && app.register) {
  app.register(notesModule);
}
