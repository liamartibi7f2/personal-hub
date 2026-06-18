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
});