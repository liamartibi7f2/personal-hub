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
    _navList.appendChild(btn);

    // Direct click listener on this nav item
    btn.addEventListener('click', function () {
      switchTo(mod.id);
    });
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
  return { register, switchTo, _getActiveModuleId: function () { return _activeModule ? _activeModule.id : null; } };

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
  // Apply persisted system language to sidebar + dashboard BEFORE first render
  // (flashcardModule.applyLanguage walks all DOM, so sidebar nav gets translated)
  var savedLang = 'en';
  try { savedLang = localStorage.getItem('hub_system_language') || 'en'; } catch (_) {}
  if (savedLang !== 'en' && savedLang !== 'vi') savedLang = 'en';
  if (typeof flashcardModule !== 'undefined' && flashcardModule.applyLanguage) {
    flashcardModule.applyLanguage(savedLang);
  }

  const initialModule = window.location.hash.replace('#', '') || 'dashboard';
  app.switchTo(initialModule);

  // Initialize the global backup modal (sidebar gear icon)
  _initBackupModal();

  // Migrate legacy theme values
  (function(){try{var t=localStorage.getItem('hub_theme');if(t==='light')localStorage.setItem('hub_theme','solar-zen');if(t==='dark')localStorage.setItem('hub_theme','cyberpunk');}catch(_){}})();

  // Initialize the 3-theme switcher (cyberpunk / solar-zen / lofi-twilight)
  _initThemeSwitcher();

  // Initialize optimize mode toggle (black & green terminal, max performance)
  _initOptimizeModeToggle();
});

/* ----------------------------------------------------------
   THEME SWITCHER (3 Themes: Cyberpunk / Solar Zen / Lo-Fi Twilight)
   data-theme attribute on <html> drives all CSS theme selectors.
   ---------------------------------------------------------- */

const THEME_KEY    = 'hub_theme';
const THEME_ORDER  = ['cyberpunk', 'solar-zen', 'lofi-twilight'];
const THEME_ICONS  = { 'cyberpunk': '☀️', 'solar-zen': '🌙', 'lofi-twilight': '🌆' };
const THEME_TITLES = { 'cyberpunk': 'Cyberpunk — Dark Neon', 'solar-zen': 'Solar Zen — Clean Light', 'lofi-twilight': 'Lo-Fi Twilight — Soft Dark' };

/** Get the current theme from the DOM attribute (single source of truth) */
function _getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'cyberpunk';
}

/** Apply a theme: set data-theme attribute, update sidebar icon, save to localStorage + Firebase */
function _applyTheme(themeName) {
  if (!THEME_ORDER.includes(themeName)) return;

  // 1) Set the DOM attribute — this triggers all CSS selectors
  document.documentElement.setAttribute('data-theme', themeName);

  // 2) Sync sidebar toggle button icon
  _syncSidebarThemeIcon();

  // 3) Sync swatch buttons in backup modal
  _syncThemeSwatches();

  // 4) Persist to localStorage
  try {
    localStorage.setItem(THEME_KEY, themeName);
  } catch (_) { /* quota exceeded — ignore */ }

  // 5) Persist to Firebase flashcard settings (workspaceTheme field)
  try {
    if (typeof flashcardModule !== 'undefined' && typeof HubDB !== 'undefined') {
      HubDB.loadFlashcardSettings().then(function (settings) {
        var merged = settings || {};
        merged.workspaceTheme = themeName;
        if (!merged.schema) {
          merged.schema = [
            { id: 'phonetic', name: 'Phonetic', prompt: 'Provide the IPA phonetic transcription.', isDeletable: false },
            { id: 'synonym', name: 'Synonym', prompt: 'Provide 2-3 common synonyms.', isDeletable: true }
          ];
        }
        if (typeof merged.voiceSpeed !== 'number') merged.voiceSpeed = 0.9;
        HubDB.saveFlashcardSettings(merged).catch(function () {});
      }).catch(function () {});
    }
  } catch (_) {}
}

/** Update sidebar #btn-theme-toggle icon to match current theme */
function _syncSidebarThemeIcon() {
  var btn  = document.getElementById('btn-theme-toggle');
  var icon = btn ? btn.querySelector('.theme-toggle-icon') : null;
  if (!btn || !icon) return;
  var current = _getCurrentTheme();
  icon.textContent = THEME_ICONS[current] || '☀️';
  btn.setAttribute('title', THEME_TITLES[current] || 'Switch theme');
}

/** Set the correct --active class on swatch buttons inside the backup modal */
function _syncThemeSwatches() {
  var current = _getCurrentTheme();
  var group   = document.getElementById('backup-theme-swatch-group');
  if (!group) return;
  group.querySelectorAll('.hub-theme-swatch').forEach(function (swatch) {
    var theme = swatch.getAttribute('data-theme');
    if (theme === current) {
      swatch.classList.add('hub-theme-swatch--active');
    } else {
      swatch.classList.remove('hub-theme-swatch--active');
    }
  });
}

/** Initialize theme system: bind swatch buttons + sidebar cycle toggle */
function _initThemeSwitcher() {

  // ── Sidebar toggle button: cycle through 3 themes ──
  var sidebarBtn = document.getElementById('btn-theme-toggle');
  if (sidebarBtn) {
    _syncSidebarThemeIcon();
    sidebarBtn.addEventListener('click', function () {
      var current = _getCurrentTheme();
      var idx = THEME_ORDER.indexOf(current);
      var next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      _applyTheme(next);
    });
  }

  // ── Swatch buttons in backup modal ──
  var swatchGroup = document.getElementById('backup-theme-swatch-group');
  if (swatchGroup) {
    swatchGroup.querySelectorAll('.hub-theme-swatch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var theme = this.getAttribute('data-theme');
        _applyTheme(theme);
      });
    });

    // Hook into modal open — sync swatches after DOM is ready
    var openBtn = document.getElementById('btn-backup-open');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        setTimeout(_syncThemeSwatches, 50);
        // Also update the desc text per current language
        setTimeout(function () {
          var desc = document.getElementById('backup-sys-theme-desc');
          if (!desc) return;
          var lang = 'en';
          try { lang = localStorage.getItem('hub_system_language') || 'en'; } catch (_) {}
          if (lang === 'vi') {
            desc.textContent = 'Chọn giao diện không gian làm việc';
          } else {
            desc.textContent = 'Choose your visual workspace environment';
          }
        }, 60);
      });
    }
  }

  // ── Load Firebase workspaceTheme as cross-device sync (localStorage wins on init) ──
  try {
    if (typeof flashcardModule !== 'undefined' && typeof HubDB !== 'undefined') {
      HubDB.loadFlashcardSettings().then(function (settings) {
        if (settings && settings.workspaceTheme &&
            ['cyberpunk', 'solar-zen', 'lofi-twilight'].indexOf(settings.workspaceTheme) !== -1) {
          // Only sync from cloud if localStorage doesn't already have a theme set
          var localTheme = null;
          try { localTheme = localStorage.getItem(THEME_KEY); } catch (_) {}
          if (!localTheme || localTheme === 'light' || localTheme === 'dark') {
            // Those are stale legacy values — cloud wins
            _applyTheme(settings.workspaceTheme);
          }
        }
      }).catch(function () {}); // silently ignore — offline or not configured
    }
  } catch (_) {}
}

/* ----------------------------------------------------------
   OPTIMIZE MODE — Max Performance & Focus (Black + Green Terminal)
   ---------------------------------------------------------- */

const OPTIMIZE_KEY = 'hubos_optimize_mode';

function _initOptimizeModeToggle() {
  const toggle = document.getElementById('btn-optimize-toggle');
  if (!toggle) return;

  // ── Restore persisted state on page load ──
  var enabled = false;
  try {
    enabled = localStorage.getItem(OPTIMIZE_KEY) === 'true';
  } catch (_) {}
  toggle.checked = enabled;
  if (enabled) {
    document.body.classList.add('theme-optimized');
  } else {
    document.body.classList.remove('theme-optimized');
  }

  // ── Toggle handler ──
  toggle.addEventListener('change', function () {
    var checked = toggle.checked;
    if (checked) {
      document.body.classList.add('theme-optimized');
    } else {
      document.body.classList.remove('theme-optimized');
    }
    try {
      localStorage.setItem(OPTIMIZE_KEY, checked ? 'true' : 'false');
    } catch (_) {}
  });

  // ── Sync desc language on modal open ──
  var openBtn = document.getElementById('btn-backup-open');
  if (openBtn) {
    openBtn.addEventListener('click', function () {
      setTimeout(function () {
        var desc = document.getElementById('backup-optimize-desc');
        if (!desc) return;
        var lang = 'en';
        try { lang = localStorage.getItem('hub_system_language') || 'en'; } catch (_) {}
        if (lang === 'vi') {
          desc.textContent = 'Đen & Xanh Terminal — tắt mọi hiệu ứng, làm mờ & đổ bóng để không tốn GPU';
        } else {
          desc.textContent = 'Black & Green Terminal — disables all animations, blurs & shadows for zero GPU latency';
        }
      }, 70);
    });
  }
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
  'hub_quiz_scores',
  'hubos_optimize_mode'
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

  // --- System Language toggle ---
  _initSystemLanguageToggle();

  
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
 * Sync the backup modal's system language toggle to match the
 * current _systemLanguage (read from localStorage or firebase).
 * Called every time the backup modal opens so the buttons reflect reality.
 */
function _syncSystemLanguageToggle() {
  var lang = 'en';
  try { lang = localStorage.getItem('hub_system_language') || 'en'; } catch (_) {}
  if (lang !== 'en' && lang !== 'vi') lang = 'en';

  var enBtn = document.getElementById('backup-syslang-en');
  var viBtn = document.getElementById('backup-syslang-vi');
  var desc  = document.getElementById('backup-sys-lang-desc');

  if (!enBtn || !viBtn) return;

  if (lang === 'vi') {
    enBtn.classList.remove('hub-syslang-toggle-btn--active');
    viBtn.classList.add('hub-syslang-toggle-btn--active');
    if (desc) desc.textContent = 'Chọn ngôn ngữ giao diện cho Hub.OS';
  } else {
    viBtn.classList.remove('hub-syslang-toggle-btn--active');
    enBtn.classList.add('hub-syslang-toggle-btn--active');
    if (desc) desc.textContent = 'Choose the interface language for Hub.OS';
  }
}

/**
 * Initialize the system language toggle inside the backup modal.
 * On click: save to localStorage + Firebase, then call
 * flashcardModule.applyLanguage() to update the entire DOM live.
 */
function _initSystemLanguageToggle() {
  var enBtn = document.getElementById('backup-syslang-en');
  var viBtn = document.getElementById('backup-syslang-vi');
  if (!enBtn || !viBtn) return;

  // Sync on modal open — hook into the existing open flow
  var openBtn = document.getElementById('btn-backup-open');
  if (openBtn) {
    var origHandler = openBtn.onclick;
    openBtn.addEventListener('click', function () {
      // Small delay so DOM inside the modal is ready
      setTimeout(_syncSystemLanguageToggle, 50);
    });
  }

  function _setLanguage(lang) {
    // 1) Persist to localStorage immediately
    try { localStorage.setItem('hub_system_language', lang); } catch (_) {}

    // 2) Persist via flashcardModule's central setter (saves to Firebase + applies DOM)
    if (typeof flashcardModule !== 'undefined' && flashcardModule.setSystemLanguage) {
      flashcardModule.setSystemLanguage(lang);
    } else if (typeof flashcardModule !== 'undefined' && flashcardModule.applyLanguage) {
      flashcardModule.applyLanguage(lang);
    }

    // 3) Re-render dashboard if visible (it reads greeting from i18n)
    if (typeof dashboardModule !== 'undefined' && typeof app !== 'undefined') {
      var activeId = app._getActiveModuleId ? app._getActiveModuleId() : null;
      if (activeId === 'dashboard' && dashboardModule.render) {
        var mainContent = document.getElementById('main-content');
        if (mainContent) {
          mainContent.innerHTML = '';
          dashboardModule.render(mainContent);
        }
      }
    }

    // 4) Update the toggle button visuals
    _syncSystemLanguageToggle();
  }

  enBtn.addEventListener('click', function () {
    if (enBtn.classList.contains('hub-syslang-toggle-btn--active')) return; // already active
    _setLanguage('en');
  });

  viBtn.addEventListener('click', function () {
    if (viBtn.classList.contains('hub-syslang-toggle-btn--active')) return; // already active
    _setLanguage('vi');
  });
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
