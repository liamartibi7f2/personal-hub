/* ============================================================
   HUB.OS — app.js
   Core application: module registry, tab routing via hashchange,
   sidebar nav rendering, and the built-in Dashboard module.

   === HOW TO ADD A NEW TOOL MODULE IN THE FUTURE ===

   1. Create a new file:  modules/your-tool.js
   2. Define a module object with this shape:

      const yourToolModule = {
        id: 'your-tool',              // Unique ID (used in URL hash)
        name: 'Your Tool',            // Display name in sidebar
        icon: '🔧',                   // Emoji or SVG icon
        render(container) { ... },    // Inject HTML & bind events
        destroy() { ... }             // Clean up timers/listeners
      };

   3. Call:  app.register(yourToolModule);

   4. Add a <script src="./modules/your-tool.js"></script>
      to index.html (before </body>).

   That's it! The router picks up everything automatically.
   ============================================================ */

/* ----------------------------------------------------------
   APP: Module Registry & Router
   ---------------------------------------------------------- */
const app = (function () {
  'use strict';

  // --- Private state ---
  const _registry = new Map();       // id → module
  let _activeModule = null;          // Currently mounted module
  const _mainContent = document.getElementById('main-content');
  const _navList      = document.getElementById('nav-list');

  /**
   * Register a module with the router.
   * @param {Object} mod — { id, name, icon, render(container), destroy() }
   */
  function register(mod) {
    if (!mod.id || !mod.name || typeof mod.render !== 'function') {
      console.error('[HubOS] Invalid module — must have id, name, and render().', mod);
      return;
    }
    _registry.set(mod.id, mod);
    _renderNavItem(mod);

    // If the URL hash matches this module on registration, switch to it
    if (window.location.hash === `#${mod.id}`) {
      switchTo(mod.id);
    }
  }

  /**
   * Switch to a module by its id.
   * @param {string} moduleId
   */
  function switchTo(moduleId) {
    const mod = _registry.get(moduleId);
    if (!mod) {
      console.warn(`[HubOS] No module registered with id "${moduleId}".`);
      switchTo('dashboard'); // Fallback
      return;
    }

    // Destroy previous module (clean up timers, listeners, etc.)
    if (_activeModule && typeof _activeModule.destroy === 'function') {
      _activeModule.destroy();
    }

    // Clear container and render new module
    _mainContent.innerHTML = '';
    mod.render(_mainContent);
    _activeModule = mod;

    // Update active nav styling
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.moduleId === moduleId);
    });

    // Update URL hash (without re-triggering hashchange)
    if (window.location.hash !== `#${moduleId}`) {
      history.pushState(null, '', `#${moduleId}`);
    }
  }

  /**
   * Render a single nav item in the sidebar for a registered module.
   * @param {Object} mod
   */
  function _renderNavItem(mod) {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.moduleId = mod.id;
    btn.innerHTML = `
      <span class="nav-icon">${mod.icon}</span>
      <span>${mod.name}</span>
    `;
    btn.addEventListener('click', () => switchTo(mod.id));
    _navList.appendChild(btn);
  }

  // --- Listen for browser back/forward (hashchange) ---
  window.addEventListener('hashchange', () => {
    const moduleId = window.location.hash.replace('#', '') || 'dashboard';
    // Only switch if the hash actually changed to a different module
    if (!_activeModule || _activeModule.id !== moduleId) {
      switchTo(moduleId);
    }
  });

  // --- Public API ---
  return { register, switchTo };

})();

/* ----------------------------------------------------------
   BOOTSTRAP
   ---------------------------------------------------------- */

// External modules (dashboard, flashcards, pomodoro, quiz) are
// defined in their respective files under modules/. Each calls
// app.register(...) at the bottom of its script. The script
// loading order in index.html determines nav-bar order.

// On page load, route to the correct tab based on URL hash
document.addEventListener('DOMContentLoaded', () => {
  const initialModule = window.location.hash.replace('#', '') || 'dashboard';
  app.switchTo(initialModule);

  // Initialize the global backup modal (sidebar gear icon)
  _initBackupModal();

  // Initialize the theme toggle (light/dark mode)
  _initThemeToggle();
});

/* ----------------------------------------------------------
   THEME TOGGLE (Light / Dark Mode)
   ---------------------------------------------------------- */

const THEME_KEY  = 'hub_theme';
const LIGHT_MODE = 'light-mode';

function _initThemeToggle() {
  const btn   = document.getElementById('btn-theme-toggle');
  const icon  = btn ? btn.querySelector('.theme-toggle-icon') : null;
  if (!btn || !icon) return;

  /** Update icon to reflect current state */
  function _syncIcon() {
    const isLight = document.body.classList.contains(LIGHT_MODE);
    icon.textContent = isLight ? '🌙' : '☀️';
    btn.setAttribute('title', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  }

  // Sync on init (flash prevention already set html.light-mode; mirror to body)
  if (document.documentElement.classList.contains(LIGHT_MODE)) {
    document.body.classList.add(LIGHT_MODE);
  }
  _syncIcon();

  // Toggle on click
  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle(LIGHT_MODE);

    // Keep html and body in sync
    if (isLight) {
      document.documentElement.classList.add(LIGHT_MODE);
    } else {
      document.documentElement.classList.remove(LIGHT_MODE);
    }

    _syncIcon();

    // Persist preference
    try {
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    } catch (_) { /* quota exceeded — ignore */ }
  });
}

/* ----------------------------------------------------------
   GLOBAL BACKUP MODAL (Export / Import)
   ---------------------------------------------------------- */

/**
 * List of all localStorage keys used by the app.
 * When adding a new module, append its key(s) here.
 */
const BACKUP_KEYS = [
  'hub_pomodoro_settings',
  'hub_pomodoro_sessions',
  'hub_pomodoro_ref',
  'hub_pomodoro_stats',
  'hub_flashcards',
  'hub_flashcard_reviewed',
  'hub_gemini_api_key',
  'hub_notes',
  'quiz_decks',
  'hub_quiz_scores'
];

function _initBackupModal() {
  const openBtn     = document.getElementById('btn-backup-open');
  const closeBtn    = document.getElementById('btn-backup-close');
  const cancelBtn   = document.getElementById('btn-backup-cancel');
  const overlay     = document.getElementById('backup-overlay');
  const exportBtn   = document.getElementById('btn-backup-export');
  const importBtn   = document.getElementById('btn-backup-import-trigger');
  const fileInput   = document.getElementById('backup-file-input');
  const statusEl    = document.getElementById('backup-status');

  if (!openBtn || !overlay) return;

  // --- Open ---
  openBtn.addEventListener('click', () => {
    overlay.classList.add('backup-overlay--visible');
    _setBackupStatus('', '');
  });

  // --- Auto-save toggle ---
  _initAutoSaveToggle();

  // --- Close helpers ---
  function _close() {
    overlay.classList.remove('backup-overlay--visible');
  }

  closeBtn?.addEventListener('click', _close);
  cancelBtn?.addEventListener('click', _close);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _close();
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('backup-overlay--visible')) {
      _close();
    }
  });

  // --- Export ---
  exportBtn?.addEventListener('click', () => {
    _exportBackup();
  });

  // --- Import trigger → click hidden file input ---
  importBtn?.addEventListener('click', () => {
    if (fileInput) fileInput.click();
  });

  // --- Import handler ---
  fileInput?.addEventListener('change', () => {
    _importBackup(fileInput);
  });
}

/**
 * Export: gather all localStorage data → JSON → Blob → download
 */
function _exportBackup() {
  try {
    const backup = {};
    BACKUP_KEYS.forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        backup[key] = raw;
      }
    });

    // Include any undiscovered hub_ keys just in case
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('hub_') && !(k in backup)) {
        backup[k] = localStorage.getItem(k);
      }
    }

    const json  = JSON.stringify(backup, null, 2);
    const blob  = new Blob([json], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `hub_os_backup_${timestamp}.json`;

    const a = document.createElement('a');
    a.href  = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    _setBackupStatus(`✓ Backup exported — ${filename}`, 'success');
  } catch (err) {
    console.error('[HubOS] Export failed:', err);
    _setBackupStatus('Export failed — see console for details', 'error');
  }
}

/**
 * Import: read selected .json file → validate → overwrite localStorage → reload
 * @param {HTMLInputElement} fileInput
 */
function _importBackup(fileInput) {
  const files = fileInput.files;
  if (!files || files.length === 0) {
    _setBackupStatus('', '');
    return;
  }

  const file = files[0];

  // Validate extension
  if (!file.name.toLowerCase().endsWith('.json')) {
    _setBackupStatus('Invalid file type — please select a .json backup file', 'error');
    fileInput.value = '';
    return;
  }

  _setBackupStatus('Reading file…', 'info');

  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error('Backup file is not a valid key/value map');
      }

      // Sanity check: at least one known key should be present
      const hasKnownKey = BACKUP_KEYS.some(k => k in data);
      // Also accept any hub_ prefixed key
      const hasHubKey = Object.keys(data).some(k => k.startsWith('hub_') || k === 'quiz_decks');
      if (!hasKnownKey && !hasHubKey) {
        throw new Error('No recognizable Hub OS data found in the file');
      }

      // Count keys before overwriting
      const importCount = Object.keys(data).length;

      // Safely overwrite localStorage with validated data
      Object.entries(data).forEach(([key, value]) => {
        // Only store values that look like they were legitimately stored as strings
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        } else if (typeof value === 'object' && value !== null) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      });

      _setBackupStatus(`✓ ${importCount} keys restored — reloading…`, 'success');

      // Small delay so user sees the success message, then reload
      setTimeout(() => {
        window.location.reload();
      }, 800);

    } catch (err) {
      console.error('[HubOS] Import failed:', err);
      _setBackupStatus(`Import failed: ${err.message}`, 'error');
    }

    // Reset file input so the same file can be re-selected
    fileInput.value = '';
  };

  reader.onerror = () => {
    _setBackupStatus('Failed to read file — it may be corrupted', 'error');
    fileInput.value = '';
  };

  reader.readAsText(file);
}

/**
 * Initialize the auto-save toggle in the backup modal.
 * Reads the initial state from the notes module and persists preference to localStorage.
 */
function _initAutoSaveToggle() {
  const toggle = document.getElementById('btn-auto-save-toggle');
  if (!toggle) return;

  // Restore persisted preference
  try {
    const saved = localStorage.getItem('hub_notes_autosave');
    if (saved !== null) {
      const checked = saved === 'true';
      toggle.checked = checked;
      // Sync with notes module if it's registered
      if (typeof notesModule !== 'undefined' && notesModule.setAutoSaveEnabled) {
        notesModule.setAutoSaveEnabled(checked);
      }
    }
  } catch (_) {}

  // On change, update notes module + persist
  toggle.addEventListener('change', function () {
    const checked = toggle.checked;
    if (typeof notesModule !== 'undefined' && notesModule.setAutoSaveEnabled) {
      notesModule.setAutoSaveEnabled(checked);
    }
    try {
      localStorage.setItem('hub_notes_autosave', checked ? 'true' : 'false');
    } catch (_) {}
  });
}

/**
 * Helper: show a status message inside the backup modal
 * @param {string} msg
 * @param {'success'|'error'|'info'|''} type
 */
function _setBackupStatus(msg, type) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'backup-status';
  if (type) {
    el.classList.add(`backup-status-${type}`);
  }
}
