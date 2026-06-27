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

  // ── Flashcards ──

  const FLASHCARD_KEY = 'hub_flashcards';

  /**
   * Save flashcards workspace data.
   * Strictly prioritizes Firestore when logged in and online.
   * Only falls back to localStorage when the user is genuinely
   * not logged in or the browser reports offline.
   * @param {Object} data - The full flashcards data object ({ decks: [...] })
   */
  async function saveFlashcardsData(data) {
    await _ensureReady();

    // Logged in + online → Firestore only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _userRef()
            .set({ flashcardsData: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return;
      } catch (err) {
        console.error('[HubDB] Firestore set() failed:', err.message || err);
        return;
      }
    }

    // Not logged in OR browser says offline → localStorage fallback
    try {
      localStorage.setItem(FLASHCARD_KEY, JSON.stringify(data));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load flashcards workspace data.
   * If logged in and online → Firestore (fallback to localStorage if empty).
   * Otherwise → localStorage.
   * If cloud data is empty (no workspace yet), initializes a default structure
   * and persists it back to the cloud so subsequent logins
   * from other browsers don't overwrite with nothing.
   * @returns {Object|null} The parsed flashcards data, or default structure
   */
  async function loadFlashcardsData() {
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        var raw = localStorage.getItem(FLASHCARD_KEY);
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
          var cloudData = doc.data().flashcardsData;
          if (cloudData && cloudData.decks && cloudData.decks.length > 0) {
            // Merge any localStorage changes the user made while offline
            try {
              var localRaw = localStorage.getItem(FLASHCARD_KEY);
              if (localRaw) {
                _mergeLocalFlashcardsIntoCloud(cloudData, JSON.parse(localRaw));
                // Persist the merged result back to Firestore silently
                _userRef().set({ flashcardsData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            // Clear local copy after successful cloud read + merge
            try { localStorage.removeItem(FLASHCARD_KEY); } catch (_) {}
            return cloudData;
          }
        }

        // Cloud doc exists but flashcardsData is empty/missing, OR doc doesn't exist.
        // Initialize a default structure and save it to cloud so that
        // logging in from another browser gets data, not empty overwrites.
        var defaultFlashcardData = {
          decks: []
        };

        // Check localStorage for any unsaved work first
        try {
          var localRaw = localStorage.getItem(FLASHCARD_KEY);
          if (localRaw) {
            var localData = JSON.parse(localRaw);
            if (localData && localData.decks && localData.decks.length > 0) {
              defaultFlashcardData = localData;
            }
          }
        } catch (_) {}

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ flashcardsData: defaultFlashcardData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(FLASHCARD_KEY); } catch (_) {}
        return defaultFlashcardData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }

    // localStorage fallback
    try {
      var raw = localStorage.getItem(FLASHCARD_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  /**
   * Merge any decks/cards that exist locally but not in the cloud.
   * This prevents data loss when the user adds cards offline.
   */
  function _mergeLocalFlashcardsIntoCloud(cloud, local) {
    if (!local || !local.decks || !cloud || !cloud.decks) return;
    local.decks.forEach(function (localDeck) {
      var match = cloud.decks.find(function (d) { return d.id === localDeck.id; });
      if (!match) {
        // Entire deck doesn't exist in cloud → add it
        cloud.decks.push(localDeck);
      } else if (localDeck.cards && localDeck.cards.length) {
        // Merge individual cards that don't exist in cloud.
        // PROTECT: if a local card is empty and the cloud card has content,
        // do NOT overwrite the cloud content — keep the richer version.
        localDeck.cards.forEach(function (localCard) {
          if (!localCard) return;
          var cardMatch = match.cards.find(function (c) { return c && c.term === localCard.term; });
          if (!cardMatch) {
            match.cards.push(localCard);
          } else if (!localCard.term || !localCard.term.trim()) {
            // Local card is empty → keep the cloud version
          } else if (!cardMatch.term || !cardMatch.term.trim()) {
            // Cloud card is empty but local has content → keep local version
            Object.assign(cardMatch, localCard);
          }
          // If both have content, keep the cloud version (most recently synced)
        });
      }
    });
  }

  // ── Quiz ──

  const QUIZ_KEY = 'quiz_decks';

  /**
   * Save quiz workspace data.
   * Strictly prioritizes Firestore when logged in and online.
   * Only falls back to localStorage when the user is genuinely
   * not logged in or the browser reports offline.
   * @param {Object} data - The full quiz data object ({ decks: [...] })
   */
  async function saveQuizData(data) {
    await _ensureReady();

    // Logged in + online → Firestore only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _userRef()
            .set({ quizData: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return;
      } catch (err) {
        console.error('[HubDB] Firestore set() failed:', err.message || err);
        return;
      }
    }

    // Not logged in OR browser says offline → localStorage fallback
    try {
      localStorage.setItem(QUIZ_KEY, JSON.stringify(data.decks));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load quiz workspace data.
   * If logged in and online → Firestore (fallback to localStorage if empty).
   * Otherwise → localStorage.
   * If cloud data is empty (no workspace yet), initializes a default structure
   * and persists it back to the cloud so subsequent logins
   * from other browsers don't overwrite with nothing.
   * @returns {Object|null} The parsed quiz data, or default structure
   */
  async function loadQuizData() {
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        var raw = localStorage.getItem(QUIZ_KEY);
        if (raw) return { decks: JSON.parse(raw) };
      } catch (_) {}
      return { decks: [] };
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
          var cloudData = doc.data().quizData;
          if (cloudData && cloudData.decks && cloudData.decks.length > 0) {
            // Merge any localStorage changes the user made while offline
            try {
              var localRaw = localStorage.getItem(QUIZ_KEY);
              if (localRaw) {
                _mergeLocalQuizIntoCloud(cloudData, { decks: JSON.parse(localRaw) });
                // Persist the merged result back to Firestore silently
                _userRef().set({ quizData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            // Clear local copy after successful cloud read + merge
            try { localStorage.removeItem(QUIZ_KEY); } catch (_) {}
            return cloudData;
          }
        }

        // Cloud doc exists but quizData is empty/missing, OR doc doesn't exist.
        // Initialize a default structure and save it to cloud so that
        // logging in from another browser gets data, not empty overwrites.
        var defaultQuizData = {
          decks: []
        };

        // Check localStorage for any unsaved work first
        try {
          var localRaw = localStorage.getItem(QUIZ_KEY);
          if (localRaw) {
            var localData = { decks: JSON.parse(localRaw) };
            if (localData.decks && localData.decks.length > 0) {
              defaultQuizData = localData;
            }
          }
        } catch (_) {}

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ quizData: defaultQuizData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(QUIZ_KEY); } catch (_) {}
        return defaultQuizData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }

    // localStorage fallback
    try {
      var raw = localStorage.getItem(QUIZ_KEY);
      if (raw) return { decks: JSON.parse(raw) };
    } catch (_) {}
    return { decks: [] };
  }

  /**
   * Merge any quiz decks that exist locally but not in the cloud.
   * This prevents data loss when the user adds decks offline.
   */
  function _mergeLocalQuizIntoCloud(cloud, local) {
    if (!local || !local.decks || !cloud || !cloud.decks) return;
    local.decks.forEach(function (localDeck) {
      var match = cloud.decks.find(function (d) { return d.id === localDeck.id; });
      if (!match) {
        // Entire deck doesn't exist in cloud → add it
        cloud.decks.push(localDeck);
      }
    });
  }

  // ── Expose public API ──

  // ── Focus Vibe ──

  const FOCUS_KEY = 'hub_focus_data';

  /**
   * Save focus vibe data (playlist, volume, last station, custom links).
   * Strictly prioritizes Firestore when logged in and online.
   * Only falls back to localStorage when the user is genuinely
   * not logged in or the browser reports offline.
   * @param {Object} data - The full focus data object
   */
  async function saveFocusData(data) {
    await _ensureReady();

    // Logged in + online → Firestore only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _userRef()
            .set({ focusData: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return;
      } catch (err) {
        console.error('[HubDB] Firestore set() failed:', err.message || err);
        return;
      }
    }

    // Not logged in OR browser says offline → localStorage fallback
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify(data));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load focus vibe data.
   * If logged in and online → Firestore (fallback to localStorage if empty).
   * Otherwise → localStorage.
   * If cloud data is empty, initializes a default structure
   * and persists it back to the cloud so subsequent logins
   * from other browsers don't overwrite with nothing.
   * @returns {Object} The parsed focus data, or default structure
   */
  async function loadFocusData() {
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        var raw = localStorage.getItem(FOCUS_KEY);
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
          var cloudData = doc.data().focusData;
          if (cloudData && cloudData.customLinks) {
            // Merge any localStorage changes the user made while offline
            try {
              var localRaw = localStorage.getItem(FOCUS_KEY);
              if (localRaw) {
                _mergeLocalFocusIntoCloud(cloudData, JSON.parse(localRaw));
                // Persist the merged result back to Firestore silently
                _userRef().set({ focusData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            // Clear local copy after successful cloud read + merge
            try { localStorage.removeItem(FOCUS_KEY); } catch (_) {}
            return cloudData;
          }
        }

        // Cloud doc exists but focusData is empty/missing, OR doc doesn't exist.
        // Initialize a default structure and save it to cloud so that
        // logging in from another browser gets data, not empty overwrites.
        var defaultFocusData = {
          customLinks: [],
          lastStation: 'lofi',
          volume: 50,
          playlist: []
        };

        // Check localStorage for any unsaved work first
        try {
          var localRaw = localStorage.getItem(FOCUS_KEY);
          if (localRaw) {
            var localData = JSON.parse(localRaw);
            if (localData && localData.customLinks) {
              defaultFocusData = localData;
            }
          }
        } catch (_) {}

        // Also merge the old `hub_focus_playlist` key if it exists (migration)
        try {
          var oldPlaylistRaw = localStorage.getItem('hub_focus_playlist');
          if (oldPlaylistRaw) {
            var oldPlaylist = JSON.parse(oldPlaylistRaw);
            if (Array.isArray(oldPlaylist) && oldPlaylist.length > 0 && (!defaultFocusData.playlist || defaultFocusData.playlist.length === 0)) {
              defaultFocusData.playlist = oldPlaylist;
            }
            try { localStorage.removeItem('hub_focus_playlist'); } catch (_) {}
          }
        } catch (_) {}

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ focusData: defaultFocusData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(FOCUS_KEY); } catch (_) {}
        return defaultFocusData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }

    // localStorage fallback
    try {
      var raw = localStorage.getItem(FOCUS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  /**
   * Merge any local focus changes (customLinks, playlist, volume, etc.)
   * that exist locally but not in the cloud.
   */
  function _mergeLocalFocusIntoCloud(cloud, local) {
    if (!local || !cloud) return;
    // Merge customLinks — add any that don't exist in cloud
    if (local.customLinks && Array.isArray(local.customLinks) && local.customLinks.length > 0) {
      if (!cloud.customLinks) cloud.customLinks = local.customLinks;
      local.customLinks.forEach(function (localLink) {
        if (!cloud.customLinks.some(function (c) { return c === localLink; })) {
          cloud.customLinks.push(localLink);
        }
      });
    }
    // Merge playlist entries — add any custom entries missing from cloud
    if (local.playlist && Array.isArray(local.playlist) && local.playlist.length > 0) {
      if (!cloud.playlist) cloud.playlist = local.playlist;
      local.playlist.forEach(function (localEntry) {
        if (!cloud.playlist.some(function (c) { return c.id === localEntry.id; })) {
          cloud.playlist.push(localEntry);
        }
      });
    }
    // Prefer the most recent volume / lastStation
    if (typeof local.volume === 'number') cloud.volume = local.volume;
    if (local.lastStation) cloud.lastStation = local.lastStation;
  }

  // ── Pomodoro ──

  const POMODORO_KEY = 'hub_pomodoro_data';

  const DEFAULT_POMODORO_DATA = {
    work: 25,
    shortBreak: 5,
    longBreak: 15,
    soundProfile: 'classic',
    autoStartBreaks: false,
    autoStartFocus: false,
    totalFocusMinutes: 0,
    completedSessions: 0,
    dailyHistory: {},
    lastCompletedDate: null
  };

  /**
   * Save pomodoro timer data (settings + stats).
   * Strictly prioritizes Firestore when logged in and online.
   * Only falls back to localStorage when the user is genuinely
   * not logged in or the browser reports offline.
   * @param {Object} data - The pomodoro data object
   */
  async function savePomodoroData(data) {
    await _ensureReady();

    // Logged in + online → Firestore only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _userRef()
            .set({ pomodoroData: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return;
      } catch (err) {
        console.error('[HubDB] Firestore set() failed:', err.message || err);
        return;
      }
    }

    // Not logged in OR browser says offline → localStorage fallback
    try {
      localStorage.setItem(POMODORO_KEY, JSON.stringify(data));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load pomodoro timer data.
   * If logged in and online → Firestore (fallback to localStorage if empty).
   * Otherwise → localStorage.
   * If cloud data is empty, initializes a default structure
   * and persists it back to the cloud so subsequent logins
   * from other browsers don't overwrite with nothing.
   * @returns {Object} The parsed pomodoro data, or default structure
   */
  async function loadPomodoroData() {
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        var raw = localStorage.getItem(POMODORO_KEY);
        if (raw) return { ...DEFAULT_POMODORO_DATA, ...JSON.parse(raw) };
      } catch (_) {}
      return { ...DEFAULT_POMODORO_DATA };
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
          var cloudData = doc.data().pomodoroData;
          if (cloudData && (typeof cloudData.totalFocusMinutes === 'number' || cloudData.work)) {
            // Merge any localStorage changes the user made while offline
            try {
              var localRaw = localStorage.getItem(POMODORO_KEY);
              if (localRaw) {
                _mergeLocalPomodoroIntoCloud(cloudData, JSON.parse(localRaw));
                // Persist the merged result back to Firestore silently
                _userRef().set({ pomodoroData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            // Clear local copy after successful cloud read + merge
            try { localStorage.removeItem(POMODORO_KEY); } catch (_) {}
            return { ...DEFAULT_POMODORO_DATA, ...cloudData };
          }
        }

        // Cloud doc exists but pomodoroData is empty/missing, OR doc doesn't exist.
        // Initialize a default structure and save it to cloud so that
        // logging in from another browser gets data, not empty overwrites.
        var defaultPomodoroData = { ...DEFAULT_POMODORO_DATA };

        // Check localStorage for any unsaved work first
        try {
          var localRaw = localStorage.getItem(POMODORO_KEY);
          if (localRaw) {
            var localData = JSON.parse(localRaw);
            if (localData && (typeof localData.totalFocusMinutes === 'number' || localData.work)) {
              defaultPomodoroData = { ...defaultPomodoroData, ...localData };
            }
          }
        } catch (_) {}

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ pomodoroData: defaultPomodoroData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(POMODORO_KEY); } catch (_) {}
        return defaultPomodoroData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }

    // localStorage fallback
    try {
      var raw = localStorage.getItem(POMODORO_KEY);
      if (raw) return { ...DEFAULT_POMODORO_DATA, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_POMODORO_DATA };
  }

  /**
   * Merge any local pomodoro data changes into the cloud data.
   * This prevents data loss when the user completes sessions offline.
   * Merges completion stats cumulatively, prefers local settings
   * (most recently changed).
   */
  function _mergeLocalPomodoroIntoCloud(cloud, local) {
    if (!local || !cloud) return;
    // Merge cumulative stats (additive — count each completed session once)
    if (typeof local.totalFocusMinutes === 'number') {
      cloud.totalFocusMinutes = Math.max(cloud.totalFocusMinutes || 0, local.totalFocusMinutes);
    }
    if (typeof local.completedSessions === 'number') {
      cloud.completedSessions = Math.max(cloud.completedSessions || 0, local.completedSessions);
    }
    // Merge daily history (local sessions not yet recorded in cloud)
    if (local.dailyHistory && typeof local.dailyHistory === 'object') {
      if (!cloud.dailyHistory) cloud.dailyHistory = {};
      Object.keys(local.dailyHistory).forEach(function (dateKey) {
        var localVal = local.dailyHistory[dateKey];
        var cloudVal = cloud.dailyHistory[dateKey] || 0;
        cloud.dailyHistory[dateKey] = Math.max(localVal, cloudVal);
      });
    }
    // Prefer local lastCompletedDate if it's more recent
    if (local.lastCompletedDate && (!cloud.lastCompletedDate || local.lastCompletedDate > cloud.lastCompletedDate)) {
      cloud.lastCompletedDate = local.lastCompletedDate;
    }
    // Prefer local settings (most recently changed)
    if (typeof local.work === 'number') cloud.work = local.work;
    if (typeof local.shortBreak === 'number') cloud.shortBreak = local.shortBreak;
    if (typeof local.longBreak === 'number') cloud.longBreak = local.longBreak;
    if (local.soundProfile) cloud.soundProfile = local.soundProfile;
    if (typeof local.autoStartBreaks === 'boolean') cloud.autoStartBreaks = local.autoStartBreaks;
    if (typeof local.autoStartFocus === 'boolean') cloud.autoStartFocus = local.autoStartFocus;
  }

  // ── Expose public API ──

  return {
    saveNotesData: saveNotesData,
    loadNotesData: loadNotesData,
    saveFlashcardsData: saveFlashcardsData,
    loadFlashcardsData: loadFlashcardsData,
    saveQuizData: saveQuizData,
    loadQuizData: loadQuizData,
    saveFocusData: saveFocusData,
    loadFocusData: loadFocusData,
    savePomodoroData: savePomodoroData,
    loadPomodoroData: loadPomodoroData,
    loginWithGoogle: loginWithGoogle,
    getAuthStatus: getAuthStatus,
    waitForReady: _ensureReady,
    shareQuizDeck: shareQuizDeck,
    importSharedQuiz: importSharedQuiz
  };

})();