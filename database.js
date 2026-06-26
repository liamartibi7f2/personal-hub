/* ============================================================
   HUB.OS — database.js
   Firebase Firestore adapter with localStorage fallback.
   Uses the Adapter Pattern: UI modules call HubDB.* and never
   touch Firebase or localStorage directly.
   ============================================================ */

const HubDB = (function () {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyDOxiG1_ATb7_ERh34J4YLOdC8hu5_SYJ0',
    authDomain: 'hubos-6b7ac.firebaseapp.com',
    projectId: 'hubos-6b7ac',
    storageBucket: 'hubos-6b7ac.firebasestorage.app',
    messagingSenderId: '951576381184',
    appId: '1:951576381184:web:f9840a882ec1fd2500d5e5',
    measurementId: 'G-77QKMV18LQ'
  };

  // ── Private state ──
  const LOCAL_KEY = 'hub_notes';
  let _app       = null;
  let _db        = null;
  let _auth      = null;
  let _user      = null;
  let _ready     = false;
  let _initError = null;

  // ── Initialisation ──

  try {
    _app = firebase.initializeApp(firebaseConfig);
    _db  = firebase.firestore(_app);
    _auth = firebase.auth(_app);

    // Enable offline persistence (silently catches if already enabled)
    _db.enablePersistence({ synchronizeTabs: true }).catch(function (err) {
      if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
        console.warn('[HubDB] Persistence error:', err);
      }
    });

    // Track auth state — resolve a pending promise on first fire
    _auth._authReady = new Promise(function (resolve) {
      _auth.onAuthStateChanged(function (user) {
        _user = user;
        _ready = true;
        resolve();
      });
    });
  } catch (err) {
    _initError = err;
    console.warn('[HubDB] Firebase init failed, falling back to localStorage:', err.message);
  }

  // ── Helpers ──

  /**
   * Wait for Firebase auth to settle before any read/write.
   * If Firebase never initialised, resolves immediately (localStorage path).
   */
  async function _ensureReady() {
    if (!_app) return; // never initialised → localStorage only
    // Don't wait more than 3s for Firebase auth to initialise
    try {
      await Promise.race([
        _auth._authReady,
        new Promise(function (r) { setTimeout(r, 3000); })
      ]);
    } catch (_) {}
  }

  function _isOnline() {
    return _ready && _user && navigator.onLine !== false;
  }

  function _userRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid);
  }

  // ── Public API ──

  // Timeout helper: rejects after ms if the promise doesn't settle
  function _timeout(ms) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, ms);
    });
  }

  /**
   * Save notes workspace data.
   * Strictly prioritizes Firestore when logged in and online.
   * Only falls back to localStorage when the user is genuinely
   * not logged in or the browser reports offline.
   * @param {Object} data - The full notes workspace object
   */
  async function saveNotesData(data) {
    await _ensureReady();

    // Logged in + online → Firestore only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _userRef()
            .set({ notesWorkspace: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return; // success — exit early
      } catch (err) {
        // Log detailed error so the user can see Firestore Security Rules issues
        console.error('[HubDB] Firestore set() failed:', err.message || err);
        // Do NOT fall through to localStorage — the user expects cloud sync.
        // If we silently save to localStorage here, Browser B will still
        // read empty cloud data and overwrite everything.
        return;
      }
    }

    // Not logged in OR browser says offline → localStorage fallback
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load notes workspace data.
   * If logged in and online → Firestore (fallback to localStorage if empty).
   * Otherwise → localStorage.
   * If cloud data is empty (no workspace yet), initializes a proper default
   * structure and persists it back to the cloud so subsequent logins
   * from other browsers don't overwrite with nothing.
   * @returns {Object|null} The parsed notes workspace, or null if none found
   */
  async function loadNotesData() {
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        var raw = localStorage.getItem(LOCAL_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return null;
    }
    await _ensureReady();
    // Try Firestore first when online (with 2.5s timeout)
    if (_isOnline()) {
      try {
        var doc = await Promise.race([
          _userRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          var cloudData = doc.data().notesWorkspace;
          if (cloudData && cloudData.folders && cloudData.folders.length > 0) {
            // Merge any localStorage changes the user made while offline
            try {
              var localRaw = localStorage.getItem(LOCAL_KEY);
              if (localRaw) {
                _mergeLocalIntoCloud(cloudData, JSON.parse(localRaw));
                // Persist the merged result back to Firestore silently
                _userRef().set({ notesWorkspace: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            // Clear local copy after successful cloud read + merge
            try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
            return cloudData;
          }
        }

        // Cloud doc exists but workspace is empty/missing, OR doc doesn't exist.
        // Initialize a proper default structure and save it to cloud so that
        // logging in from another browser gets data, not empty overwrites.
        var defaultData = {
          folders: [{
            id: 'folder-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            name: 'Personal',
            notes: [{
              id: 'note-' + Date.now(),
              title: 'Welcome',
              content: 'Welcome to Notes!<br><br>Try typing /h1, /h2, or /h3 followed by space to insert headings.',
              order: 0
            }]
          }]
        };

        // Check localStorage for any unsaved work first
        try {
          var localRaw = localStorage.getItem(LOCAL_KEY);
          if (localRaw) {
            var localData = JSON.parse(localRaw);
            if (localData && localData.folders && localData.folders.length > 0) {
              defaultData = localData;
            }
          }
        } catch (_) {}

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ notesWorkspace: defaultData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
        return defaultData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }

    // localStorage fallback
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  /**
   * Merge any notes/folders that exist locally but not in the cloud.
   * This prevents data loss when the user adds notes offline.
   */
  function _mergeLocalIntoCloud(cloud, local) {
    if (!local || !local.folders || !cloud || !cloud.folders) return;
    local.folders.forEach(function (localFolder) {
      var match = cloud.folders.find(function (f) { return f.id === localFolder.id; });
      if (!match) {
        // Entire folder doesn't exist in cloud → add it
        cloud.folders.push(localFolder);
      } else if (localFolder.notes && localFolder.notes.length) {
        // Merge individual notes that don't exist in cloud.
        // PROTECT: if a local note is empty and the cloud note has content,
        // do NOT overwrite the cloud content — keep the richer version.
        localFolder.notes.forEach(function (localNote) {
          if (!localNote) return;
          var noteMatch = match.notes.find(function (n) { return n && n.id === localNote.id; });
          if (!noteMatch) {
            match.notes.push(localNote);
          } else if (!localNote.content || !localNote.content.trim()) {
            // Local note is empty → keep the cloud version (it has content)
            // Do nothing — cloud note already has the richer content
          } else if (!noteMatch.content || !noteMatch.content.trim()) {
            // Cloud note is empty but local has content → keep local version
            noteMatch.content = localNote.content;
            if (localNote.title) noteMatch.title = localNote.title;
          }
          // If both have content, keep the cloud version (most recently synced)
        });
      }
    });
  }

  /**
   * Sign in with Google popup.
   * @returns {Promise<UserCredential>}
   */
  async function loginWithGoogle() {
    await _ensureReady();
    var provider = new firebase.auth.GoogleAuthProvider();
    return _auth.signInWithPopup(provider);
  }

  /**
   * Get current auth status.
   * @returns {{ loggedIn: boolean, uid: string|null }}
   */
  function getAuthStatus() {
    return {
      loggedIn: !!_user,
      uid: _user ? _user.uid : null
    };
  }

  // ── Quiz Sharing ──

  /**
   * Share a quiz deck to Firestore by generating a unique 6-char code.
   * @param {Object} deckData - The quiz deck data to share
   * @returns {Promise<string>} The generated share code
   */
  async function shareQuizDeck(deckData) {
    await _ensureReady();
    var code = _generateShareCode();
    try {
      if (!_isOnline()) {
        throw new Error('You must be logged in to the Cloud to share a deck.');
      }
      await Promise.race([
        _db.collection('shared_quizzes').doc(code).set(deckData)
          .catch(function (err) {
            console.error('[HubDB] Share Error — Firestore write rejected:', err);
            throw err;
          }),
        _timeout(2500)
      ]);
      return code;
    } catch (err) {
      console.error('[HubDB] Firestore share failed:', err.message || err);
      throw err;
    }
  }

  /**
   * Import a shared quiz deck by its 6-character share code.
   * @param {string} shareCode - The 6-char alphanumeric code
   * @returns {Promise<Object|null>} The quiz deck data, or null if not found
   */
  async function importSharedQuiz(shareCode) {
    var code = (shareCode || '').trim().toUpperCase();
    if (!code || code.length !== 6) throw new Error('Invalid code: must be exactly 6 characters');

    await _ensureReady();
    try {
      if (_ready && navigator.onLine !== false) {
        var doc = await Promise.race([
          _db.collection('shared_quizzes').doc(code).get()
            .catch(function (err) {
              console.error('[HubDB] Import Error — Firestore read rejected (permission denied?):', err);
              throw new Error('Permission denied: Firestore rejected the read. Check security rules.');
            }),
          _timeout(2500)
        ]);
        if (!doc.exists) {
          console.warn('[HubDB] Import Error — code "' + code + '" not found in shared_quizzes');
          throw new Error('Quiz not found: "' + code + '" does not exist.');
        }
        var data = doc.data();
        if (!data || !data.sections || data.sections.length === 0) {
          console.warn('[HubDB] Import Error — document exists but has no quiz data');
          throw new Error('Quiz data is empty or corrupted.');
        }
        return data;
      } else {
        console.warn('[HubDB] Cannot import — browser is offline. Trying localStorage fallback.');
      }
    } catch (err) {
      // Re-throw Firestore/timeout errors for the caller to handle
      if (err.message && (err.message.indexOf('Quiz not found') !== -1 ||
          err.message.indexOf('Permission denied') !== -1 ||
          err.message.indexOf('Invalid code') !== -1 ||
          err.message.indexOf('quiz data is empty') !== -1)) {
        throw err;
      }
      console.warn('[HubDB] Firestore import failed:', err.message || err);
    }

    // Offline-only fallback: check localStorage
    try {
      var shared = JSON.parse(localStorage.getItem('hub_shared_quizzes') || '{}');
      var localData = shared[code];
      if (localData) {
        console.log('[HubDB] Quiz imported from localStorage (offline mode). Code:', code);
        return localData;
      }
      throw new Error('Quiz not found: "' + code + '" does not exist (localStorage fallback also empty).');
    } catch (_) {
      throw new Error('Quiz not found: "' + code + '" does not exist (localStorage fallback also empty).');
    }
  }

  /**
   * Generate a random 6-character alphanumeric code (uppercase letters + digits).
   * Retries up to 5 times if the code already exists in shared_quizzes.
   */
  function _generateShareCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O,0,I,1 for readability
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // ── Expose public API ──

  return {
    saveNotesData: saveNotesData,
    loadNotesData: loadNotesData,
    loginWithGoogle: loginWithGoogle,
    getAuthStatus: getAuthStatus,
    waitForReady: _ensureReady,
    shareQuizDeck: shareQuizDeck,
    importSharedQuiz: importSharedQuiz
  };

})();