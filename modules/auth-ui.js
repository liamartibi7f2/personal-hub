/* ============================================================
   HUB.OS — modules/auth-ui.js
   Cyberpunk Authentication UI — Firebase login/register,
   1-hour inactivity auto-logout, admin badge detection.
   ============================================================ */
(function () {
  'use strict';

  // ── Config ──
  const ADMIN_EMAIL   = 'admin@hubos.com'; // Change this later
  const INACTIVITY_MS = 60 * 60 * 1000;     // 1 hour
  let _inactivityTimer = null;
  let _authModalEl    = null;
  let _currentUser    = null;

  // ── Initialise on DOM ready ──
  document.addEventListener('DOMContentLoaded', function () {
    _buildModal();
    _injectLoginButton();
    _updateSidebarStatus();
    _startInactivityWatch();
    _listenAuthChanges();
  });

  // ── Build the auth modal and append to body ──
  function _buildModal() {
    var div = document.createElement('div');
    div.id = 'auth-modal';
    div.className = 'cyber-auth-overlay';
    div.innerHTML =
      '<div class="cyber-auth-box glass">' +
        '<button class="cyber-auth-close" id="auth-close" aria-label="Close">✕</button>' +
        '<div class="cyber-auth-header">' +
          '<div class="cyber-auth-lock">' +
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none">' +
              '<rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
              '<path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
              '<circle cx="12" cy="16" r="1.5" fill="currentColor"/>' +
            '</svg>' +
          '</div>' +
          '<h3 class="cyber-auth-title">SECURE ACCESS</h3>' +
          '<p class="cyber-auth-sub">Authenticate to enable cloud sync</p>' +
        '</div>' +
        '<form class="cyber-auth-form" id="auth-form" novalidate>' +
          '<div class="cyber-field">' +
            '<input type="email" id="auth-email" class="cyber-input" required spellcheck="false" autocomplete="email">' +
            '<label for="auth-email" class="cyber-label">EMAIL / USERNAME</label>' +
            '<div class="cyber-input-line"></div>' +
          '</div>' +
          '<div class="cyber-field">' +
            '<input type="password" id="auth-password" class="cyber-input" required autocomplete="current-password">' +
            '<label for="auth-password" class="cyber-label">PASSWORD</label>' +
            '<div class="cyber-input-line"></div>' +
          '</div>' +
          '<div class="cyber-auth-error" id="auth-error"></div>' +
          '<div class="cyber-auth-btns">' +
            '<button type="submit" class="cyber-btn cyber-btn-primary" id="auth-submit">' +
              '<span class="cyber-btn-text">LOGIN</span>' +
              '<span class="cyber-btn-glitch"></span>' +
            '</button>' +
            '<button type="button" class="cyber-btn cyber-btn-secondary" id="auth-toggle-mode">' +
              '<span class="cyber-btn-text">CREATE ACCOUNT</span>' +
            '</button>' +
          '</div>' +
          '<div class="cyber-auth-divider">' +
            '<span class="cyber-auth-divider-line"></span>' +
            '<span class="cyber-auth-divider-text">OR</span>' +
            '<span class="cyber-auth-divider-line"></span>' +
          '</div>' +
          '<button type="button" class="cyber-btn cyber-btn-google" id="btn-google-login">' +
            '<svg class="cyber-google-icon" width="18" height="18" viewBox="0 0 48 48" fill="none">' +
              '<path d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>' +
              '<path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>' +
              '<path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>' +
              '<path d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>' +
            '</svg>' +
            '<span class="cyber-btn-text">Continue with Google</span>' +
          '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(div);
    _authModalEl = div;

    // ── Bind modal events ──
    document.getElementById('auth-close').addEventListener('click', _closeModal);
    div.addEventListener('click', function (e) {
      if (e.target === div) _closeModal();
    });
    document.getElementById('auth-form').addEventListener('submit', _handleSubmit);
    document.getElementById('auth-toggle-mode').addEventListener('click', _toggleMode);
    document.getElementById('btn-google-login').addEventListener('click', _handleGoogleLogin);
  }

  // ── Inject login button into sidebar-footer ──
  function _injectLoginButton() {
    var footer = document.querySelector('.sidebar-footer');
    if (!footer) return;

    var btn = document.createElement('button');
    btn.id = 'btn-auth-login';
    btn.className = 'cyber-login-btn';
    btn.setAttribute('title', 'Cloud Login');
    btn.setAttribute('aria-label', 'Cloud Login');
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="cyber-login-icon">' +
        '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13 12H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_currentUser) {
        _logout();
      } else {
        _openModal();
      }
    });

    // Insert before the theme toggle
    var themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      footer.insertBefore(btn, themeBtn);
    } else {
      footer.appendChild(btn);
    }

    // Also inject a mobile-friendly badge into nav-list
    _injectMobileAuthBadge();
  }

  function _injectMobileAuthBadge() {
    var navList = document.getElementById('nav-list');
    if (!navList) return;

    var btn = document.createElement('button');
    btn.id = 'btn-auth-login-mobile';
    btn.className = 'cyber-login-btn-mobile nav-item';
    btn.setAttribute('title', 'Cloud Login');
    btn.setAttribute('aria-label', 'Cloud Login');
    btn.innerHTML =
      '<span class="nav-icon">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none">' +
          '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13 12H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
      '</span>' +
      '<span>Cloud</span>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_currentUser) {
        _logout();
      } else {
        _openModal();
      }
    });

    // Insert before the settings btn (which is the last child)
    var settingsBtn = document.getElementById('btn-backup-open');
    if (settingsBtn) {
      navList.insertBefore(btn, settingsBtn);
    } else {
      navList.appendChild(btn);
    }
  }

  // ── Modal open / close ──
  function _openModal() {
    if (!_authModalEl) return;
    document.getElementById('auth-error').textContent = '';
    document.getElementById('auth-email').value = '';
    document.getElementById('auth-password').value = '';
    document.getElementById('auth-submit').querySelector('.cyber-btn-text').textContent = 'LOGIN';
    document.getElementById('auth-toggle-mode').querySelector('.cyber-btn-text').textContent = 'CREATE ACCOUNT';
    document.getElementById('btn-google-login').querySelector('.cyber-btn-text').textContent = 'Continue with Google';
    document.getElementById('btn-google-login').disabled = false;
    _authModalEl.classList.add('cyber-auth-overlay--visible');
    setTimeout(function () {
      document.getElementById('auth-email').focus();
    }, 200);
  }

  function _closeModal() {
    if (!_authModalEl) return;
    _authModalEl.classList.remove('cyber-auth-overlay--visible');
  }

  // ── Login / Register submit ──
  var _isRegisterMode = false;

  function _toggleMode() {
    _isRegisterMode = !_isRegisterMode;
    var submitText = _isRegisterMode ? 'REGISTER' : 'LOGIN';
    var toggleText = _isRegisterMode ? 'ALREADY HAVE AN ACCOUNT' : 'CREATE ACCOUNT';
    document.getElementById('auth-submit').querySelector('.cyber-btn-text').textContent = submitText;
    document.getElementById('auth-toggle-mode').querySelector('.cyber-btn-text').textContent = toggleText;
    document.getElementById('auth-error').textContent = '';
  }

  function _handleSubmit(e) {
    e.preventDefault();
    var email    = document.getElementById('auth-email').value.trim();
    var password = document.getElementById('auth-password').value;
    var errorEl  = document.getElementById('auth-error');
    errorEl.textContent = '';

    if (!email || !password) {
      errorEl.textContent = 'Fill in both fields';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters';
      return;
    }

    var submitBtn = document.getElementById('auth-submit');
    submitBtn.disabled = true;
    submitBtn.querySelector('.cyber-btn-text').textContent = 'AUTHENTICATING...';

    var promise = _isRegisterMode
      ? firebase.auth().createUserWithEmailAndPassword(email, password)
      : firebase.auth().signInWithEmailAndPassword(email, password);

    promise
      .then(function () {
        // ── HARD RELOAD: force page reload so all modules re-initialise ──
        // Clearing localStorage before reload ensures the fresh start
        // won't be polluted by stale local data.
        try { localStorage.removeItem('hub_notes'); } catch (_) {}
        window.location.reload();
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
      })
      .finally(function () {
        // Only re-enable button if we are NOT reloading (error path)
        // If there's no error and reload is imminent, this is moot.
        if (!firebase.auth().currentUser) {
          submitBtn.disabled = false;
          submitBtn.querySelector('.cyber-btn-text').textContent = _isRegisterMode ? 'REGISTER' : 'LOGIN';
        }
      });
  }

  // ── Google Sign-In ──
  function _handleGoogleLogin() {
    var errorEl  = document.getElementById('auth-error');
    var googleBtn = document.getElementById('btn-google-login');
    errorEl.textContent = '';
    googleBtn.disabled = true;
    googleBtn.querySelector('.cyber-btn-text').textContent = 'CONNECTING...';

    HubDB.loginWithGoogle()
      .then(function () {
        // ── HARD RELOAD: force page reload so all modules re-initialise ──
        try { localStorage.removeItem('hub_notes'); } catch (_) {}
        window.location.reload();
      })
      .catch(function (err) {
        if (err.code !== 'auth/popup-closed-by-user') {
          errorEl.textContent = err.message;
        }
      })
      .finally(function () {
        // Only re-enable button if we are NOT reloading (error path)
        if (!firebase.auth().currentUser) {
          googleBtn.disabled = false;
          googleBtn.querySelector('.cyber-btn-text').textContent = 'Continue with Google';
        }
      });
  }

  // ── Logout ──
  function _logout() {
    // 1) Clear all local Hub caches so no stale data remains visible
    try { localStorage.removeItem('hub_notes'); } catch (_) {}
    try { localStorage.removeItem('hub_quiz_scores'); } catch (_) {}
    try { localStorage.removeItem('flashcard_data'); } catch (_) {}
    try { localStorage.removeItem('pomodoro_state'); } catch (_) {}

    // 2) Sign out of Firebase — await the promise, THEN reload
    //    This prevents the race where the page reloads while auth
    //    is still in a half-signed-out state.
    firebase.auth().signOut()
      .then(function () {
        window.location.reload();
      })
      .catch(function (err) {
        console.warn('[AuthUI] signOut error:', err.message);
        // Even if signOut fails, force a reload to reset state
        window.location.reload();
      });
  }

  // ── Listen to Firebase auth state ──
  function _listenAuthChanges() {
    firebase.auth().onAuthStateChanged(function (user) {
      _currentUser = user;
      _updateSidebarStatus();

      var loginBtn    = document.getElementById('btn-auth-login');
      var mobileBtn   = document.getElementById('btn-auth-login-mobile');

      if (user) {
        var isAdmin = user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        var label   = isAdmin ? 'ADMIN' : (user.email || 'CLOUD');
        var tooltip = 'Logged in as ' + user.email + (isAdmin ? ' [SYSTEM ADMIN]' : '');

        if (loginBtn) {
          loginBtn.setAttribute('title', tooltip);
          loginBtn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="cyber-login-icon">' +
              '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
              '<circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/>' +
            '</svg>' +
            '<span class="cyber-login-label">' + label + '</span>';
          loginBtn.classList.add('cyber-login-btn--active');
          if (isAdmin) loginBtn.classList.add('cyber-login-btn--admin');
          else loginBtn.classList.remove('cyber-login-btn--admin');
        }
        if (mobileBtn) {
          mobileBtn.setAttribute('title', tooltip);
          mobileBtn.innerHTML =
            '<span class="nav-icon">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none">' +
                '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '<circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/>' +
              '</svg>' +
            '</span>' +
            '<span>' + label + '</span>';
          mobileBtn.classList.add('cyber-login-btn--active');
        }

        // Show admin badge if applicable
        _toggleAdminBadge(isAdmin);
        _resetInactivityTimer();

      } else {
        // Restore default login button
        if (loginBtn) {
          loginBtn.setAttribute('title', 'Cloud Login');
          loginBtn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="cyber-login-icon">' +
              '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13 12H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>';
          loginBtn.classList.remove('cyber-login-btn--active', 'cyber-login-btn--admin');
        }
        if (mobileBtn) {
          mobileBtn.innerHTML =
            '<span class="nav-icon">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none">' +
                '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13 12H3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
              '</svg>' +
            '</span>' +
            '<span>Cloud</span>';
          mobileBtn.classList.remove('cyber-login-btn--active');
        }

        _toggleAdminBadge(false);
        _clearInactivityTimer();
      }
    });
  }

  // ── Admin badge ──
  function _toggleAdminBadge(show) {
    var existing = document.getElementById('cyber-admin-badge');
    if (show && !existing) {
      var badge = document.createElement('div');
      badge.id = 'cyber-admin-badge';
      badge.className = 'cyber-admin-badge';
      badge.innerHTML =
        '<span class="cyber-admin-badge-dot"></span>' +
        '<span class="cyber-admin-badge-text">[SYSTEM ADMIN] ACCESS GRANTED</span>';
      // Insert at the bottom of the sidebar, above the footer
      var sidebar = document.getElementById('sidebar');
      var footer  = document.querySelector('.sidebar-footer');
      if (sidebar && footer) {
        sidebar.insertBefore(badge, footer);
      }
    } else if (!show && existing) {
      existing.remove();
    }
  }

  // ── Update sidebar status dot + label ──
  function _updateSidebarStatus() {
    var label = document.querySelector('.status-label');
    var dot   = document.querySelector('.status-dot');
    if (!label || !dot) return;

    var isAuthed = !!(firebase.auth().currentUser);

    // Dot colour
    dot.classList.remove('status-dot--online', 'status-dot--offline');
    dot.classList.add(isAuthed ? 'status-dot--online' : 'status-dot--offline');

    // Label
    label.textContent = isAuthed ? 'Cloud Sync' : 'Offline';

    // Status-indicator container
    var indicator = label.closest('.status-indicator');
    if (indicator) {
      indicator.classList.toggle('status-indicator--auth', isAuthed);
      indicator.setAttribute('title', isAuthed ? 'Authenticated' : 'Offline');
    }
  }

  // ── Inactivity Watch ──
  function _startInactivityWatch() {
    var events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    function onActivity() {
      if (_currentUser) _resetInactivityTimer();
    }
    for (var i = 0; i < events.length; i++) {
      document.addEventListener(events[i], onActivity, { passive: true });
    }
  }

  function _resetInactivityTimer() {
    _clearInactivityTimer();
    _inactivityTimer = setTimeout(function () {
      if (_currentUser) {
        console.log('[AuthUI] Inactivity timeout — signing out');
        _logout();
      }
    }, INACTIVITY_MS);
  }

  function _clearInactivityTimer() {
    if (_inactivityTimer) {
      clearTimeout(_inactivityTimer);
      _inactivityTimer = null;
    }
  }

  // ── Expose a minimal API for other modules ──
  window.HubAuth = {
    isLoggedIn: function () { return !!_currentUser; },
    getUser:    function () { return _currentUser; },
    logout:     _logout,
    openModal:  _openModal
  };

})();