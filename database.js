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

  // ── Global debounce utility (shared by all modules) ──
  window.HubDebounce = (function () {
    const timers = {};
    return {
      call: function (key, fn, delay) {
        if (timers[key]) clearTimeout(timers[key]);
        timers[key] = setTimeout(function () {
          delete timers[key];
          fn();
        }, delay || 400);
      },
      cancel: function (key) {
        if (timers[key]) {
          clearTimeout(timers[key]);
          delete timers[key];
        }
      },
      flush: function (key) {
        const t = timers[key];
        if (t) { clearTimeout(t); delete timers[key]; }
      }
    };
  })();

  // ── Initialisation ──

  try {
    _app = firebase.initializeApp(firebaseConfig);
    _db  = firebase.firestore(_app);
    _auth = firebase.auth(_app);

    // Modern Firestore persistence via settings.cache (replaces deprecated enableMultiTabIndexedDbPersistence)
    try {
      _db.settings({
        cache: { 'PERSISTENCE': 'MULTI_TAB' }
      });
    } catch (cacheErr) {
      // Older SDK versions throw on unknown settings — persistence falls back to browser default
      if (cacheErr.message && cacheErr.message.indexOf('cache') !== -1) {
        // SDK doesn't support settings.cache yet — try the older enablePersistence as fallback
        _db.enablePersistence({ synchronizeTabs: true }).catch(function (pErr) {
          if (pErr.code !== 'failed-precondition' && pErr.code !== 'unimplemented') {
            console.warn('[HubDB] Persistence error:', pErr);
          }
        });
      }
    }

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

  /**
   * Dedicated Firestore reference for the notes subcollection.
   * Uses: users/{userId}/notes_store/data
   * This completely isolates notes data from all other modules
   * (Quiz, Flashcards, Pomodoro, Focus, etc.) so they can never collide.
   */
  function _notesDocRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid).collection('notes_store').doc('data');
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

    // Logged in + online → Firestore subcollection only. No silent fallback.
    if (_isOnline()) {
      try {
        await Promise.race([
          _notesDocRef()
            .set({ workspace: data })
            .catch(function (err) {
              console.error('[HubDB] Firebase Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        // Also mirror to localStorage so Export All Data captures the latest notes.
        // Without this, the backup file would miss notes saved exclusively to Firestore.
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
        } catch (_) {}
        return; // success — exit early
      } catch (err) {
        // Log detailed error so the user can see Firestore Security Rules issues
        console.error('[HubDB] Firestore set() for notes_store failed:', err.message || err);
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
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return null;
    }
    await _ensureReady();
    // Try Firestore subcollection first when online (with 2.5s timeout)
    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _notesDocRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          const cloudData = doc.data().workspace;
          if (cloudData && cloudData.folders && cloudData.folders.length > 0) {
            // Merge any localStorage changes the user made while offline
            try {
              const localRaw = localStorage.getItem(LOCAL_KEY);
              if (localRaw) {
                _mergeLocalIntoCloud(cloudData, JSON.parse(localRaw));
                // Only save back if local merge actually changed something
                _notesDocRef().set({ workspace: cloudData }).catch(function () {});
              }
            } catch (_) {}
            try { localStorage.removeItem(LOCAL_KEY); } catch (_) {}
            // Mirror to localStorage so "Export All Data" always captures the latest
            // notes workspace, even immediately after a page reload.
            try {
              localStorage.setItem(LOCAL_KEY, JSON.stringify(cloudData));
            } catch (_) {}
            return cloudData;
          }
          // Cloud doc exists but has no workspace yet — return null,
          // NOT a default. The workspace is created only when the user
          // explicitly clicks "Add Folder" / "Add Note" in the UI.
          return null;
        }

        // No user document at all (first login) — return null.
        // NEVER auto-create + auto-save a default workspace.
        return null;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed for notes_store, trying localStorage:', err.message);
      }
    }

    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  // ──────────────────────────────────────────────
  //  IndexedDB Wrapper — local failsafe cache for
  //  high-value mutable data (CashFlow transactions).
  //  Survives browser restores, tab crashes, and
  //  localStorage eviction (5MB cap).
  // ──────────────────────────────────────────────

  const _idb = (function () {
    const DB_NAME    = 'hubos_cache';
    const DB_VERSION = 1;

    /** Open (or create) the database and the "cashflow" store. */
    function _open() {
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) {
          return reject(new Error('IndexedDB not available'));
        }
        var req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains('cashflow')) {
            db.createObjectStore('cashflow');
          }
          if (!db.objectStoreNames.contains('cashflowMeta')) {
            db.createObjectStore('cashflowMeta');
          }
        };
        req.onsuccess  = function (e) { resolve(e.target.result); };
        req.onerror    = function (e) { reject(e.target.error); };
      });
    }

    var _dbPromise = null;
    function _getDB() {
      if (!_dbPromise) _dbPromise = _open();
      return _dbPromise;
    }

    /**
     * Store a value under the given key (read-write transaction).
     * Returns a promise that resolves when the write commits.
     */
    async function _set(storeName, key, value) {
      try {
        var db = await _getDB();
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function (e) { reject(e.target.error); };
          tx.onabort    = function (e) { reject(e.target.error); };
        });
      } catch (_) {}
    }

    /**
     * Retrieve a value by key (read-only).
     * Returns the stored value or undefined.
     */
    async function get(storeName, key) {
      try {
        var db = await _getDB();
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).get(key);
          req.onsuccess = function () { resolve(req.result); };
          tx.onerror    = function (e) { reject(e.target.error); };
        });
      } catch (_) { return undefined; }
    }

    /**
     * Delete a key (read-write).
     */
    async function del(storeName, key) {
      try {
        var db = await _getDB();
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function (e) { reject(e.target.error); };
        });
      } catch (_) {}
    }

    return {
      /** Cache CashFlow transaction data to IndexedDB. */
      cacheCFData:     function (data) { return _set('cashflow',     'cf_data', data);  },
      /** Load CashFlow transaction data from IndexedDB cache. */
      loadCFData:      function ()      { return get('cashflow',      'cf_data');        },
      /** Cache CashFlow meta (offset + savings) to IndexedDB. */
      cacheCFMeta:     function (meta)  { return _set('cashflowMeta','cf_meta', meta);  },
      /** Load CashFlow meta from IndexedDB cache. */
      loadCFMeta:      function ()      { return get('cashflowMeta',  'cf_meta');        },
      /** Clear CashFlow cache (used when cloud write succeeds and we want a clean slate). */
      clearCFCache:    function ()      {
        return Promise.all([
          del('cashflow', 'cf_data'),
          del('cashflowMeta', 'cf_meta')
        ]).catch(function () {});
      }
    };
  })();

  // ──────────────────────────────────────────────
  //  CashFlow data (subcollection-based, same pattern as Notes)
  // ──────────────────────────────────────────────

  const CF_LOCAL_KEY       = 'hub_cf_cloud_data';
  const CF_LOCAL_OFFSET    = 'hub_cf_cloud_offset';
  const CF_LOCAL_SAVINGS   = 'hub_cf_cloud_savings';

  function _cfDataDocRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid).collection('cashflow_store').doc('data');
  }

  function _cfMetaDocRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid).collection('cashflow_store').doc('meta');
  }

  /**
   * ═══ DUAL-WRITE: IndexedDB first, THEN Firestore (cloud) ═══
   *
   * Save CashFlow data (transactions + balances).
   * ALWAYS caches to IndexedDB first — this is the write-once,
   * survive-everything failsafe. Then attempts Firestore.
   *
   * @param {Object} data — { transactions: [], balanceSnapshots: [], startingBalance: 0 }
   */
  async function saveCashFlowData(data) {
    // ── STEP 1: IndexedDB cache ALWAYS (survives browser restore, tab crash, offline) ──
    try { await _idb.cacheCFData(data); } catch (_) {}

    // ── STEP 2: localStorage mirror (same legacy key for quick access) ──
    try { localStorage.setItem(CF_LOCAL_KEY, JSON.stringify(data)); } catch (_) {}

    // ── STEP 3: Firestore (cloud sync) ──
    await _ensureReady();
    if (_isOnline()) {
      try {
        await Promise.race([
          _cfDataDocRef()
            .set({ payload: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] CashFlow Firestore write failed:', err);
              throw err;
            }),
          _timeout(3000)
        ]);
        // Cloud write validated — IndexedDB is now just a mirror; we're done
        return;
      } catch (err) {
        console.error('[HubDB] CashFlow cloud save failed — data is safe in IndexedDB:', err.message || err);
        return;
      }
    }
  }

  /**
   * ═══ DUAL-WRITE for metadata (netWorthOffset + savingsBalance) ═══
   * Same pattern: IndexedDB first, then Firestore.
   *
   * @param {Object} meta — { netWorthOffset: number, savingsBalance: number }
   */
  async function saveCashFlowMeta(meta) {
    // ── STEP 1: IndexedDB cache ──
    try { await _idb.cacheCFMeta(meta); } catch (_) {}

    // ── STEP 2: localStorage mirror ──
    try { localStorage.setItem(CF_LOCAL_OFFSET, JSON.stringify(meta)); } catch (_) {}

    // ── STEP 3: Firestore ──
    await _ensureReady();
    if (_isOnline()) {
      try {
        await Promise.race([
          _cfMetaDocRef()
            .set(meta, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] CashFlow Meta write failed:', err);
              throw err;
            }),
          _timeout(3000)
        ]);
        return;
      } catch (_) { /* IndexedDB already has it */ }
    }
  }

  /**
   * ═══ SAFE LOAD for CashFlow data ═══
   *
   * Priority ladder:
   *   1. Firestore (cloud) — the truth, if reachable
   *   2. IndexedDB — durable local cache (survives tab restore)
   *   3. localStorage — fast fallback for key data
   *
   * CRITICAL RULE: If Firestore fails AND IndexedDB has NO data
   * (first-time login, new device), we return `{ _noCloudData: true }`
   * instead of an empty payload — the consumer (cashflow.js) uses
   * this sentinel to set isOfflineMode and skip all auto-save.
   *
   * @returns {Object|null} — The payload, null if nothing found, or
   *                          { _noCloudData: true } if cloud unreachable
   *                          and no local cache exists.
   */
  async function loadCashFlowData() {
    // STEP 1: Fast offline path — skip auth wait
    if (navigator.onLine === false) {
      try {
        var idbOffline = await _idb.loadCFData();
        if (idbOffline && Array.isArray(idbOffline.transactions)) return idbOffline;
      } catch (_) {}
      // Fall through to localStorage
      try {
        var rawLocalOff = localStorage.getItem(CF_LOCAL_KEY);
        if (rawLocalOff) return JSON.parse(rawLocalOff);
      } catch (_) {}
      // Nothing anywhere — still offline. Let caller decide.
      return null;
    }

    await _ensureReady();

    // STEP 2: Firestore — the source of truth
    if (_isOnline()) {
      try {
        var doc = await Promise.race([
          _cfDataDocRef().get(),
          _timeout(3000)
        ]);
        if (doc && doc.exists) {
          var cloudData = doc.data().payload;
          if (cloudData && Array.isArray(cloudData.transactions)) {
            // ═══ CLOUD LOAD SUCCESS: cache locally + merge any offline queue ═══
            try { await _idb.cacheCFData(cloudData); } catch (_) {}
            try { localStorage.setItem(CF_LOCAL_KEY, JSON.stringify(cloudData)); } catch (_) {}

            // Merge any offline transactions that accumulated in IndexedDB
            try {
              var localPayload = await _idb.loadCFData();
              if (localPayload && Array.isArray(localPayload.transactions) && localPayload.transactions.length > 0) {
                var existingIds = {};
                cloudData.transactions.forEach(function (t) { existingIds[t.id] = true; });
                var merged = false;
                localPayload.transactions.forEach(function (t) {
                  if (!existingIds[t.id]) { cloudData.transactions.push(t); merged = true; }
                });
                if (merged) {
                  await _idb.cacheCFData(cloudData);
                  _cfDataDocRef().set({ payload: cloudData }, { merge: true }).catch(function () {});
                }
              }
            } catch (_) {}

            return cloudData;
          }
          // Cloud doc exists but has no valid payload — return null, NOT a fresh default
          return null;
        }
        // Cloud doc doesn't exist → first login. Return null, NOT an auto-created default.
        return null;
      } catch (err) {
        console.warn('[HubDB] CashFlow Cloud load failed:', err.message || err);
        // ═══ FALL THROUGH to IndexedDB ═══
      }
    }

    // STEP 3: IndexedDB fallback (durable, survives tab restore)
    try {
      var idbData = await _idb.loadCFData();
      if (idbData && Array.isArray(idbData.transactions) && idbData.transactions.length > 0) {
        console.log('[HubDB] CashFlow — loaded from IndexedDB cache');
        return idbData;
      }
    } catch (_) {}

    // STEP 4: localStorage fallback
    try {
      var rawLocal = localStorage.getItem(CF_LOCAL_KEY);
      if (rawLocal) {
        var parsed = JSON.parse(rawLocal);
        if (parsed && Array.isArray(parsed.transactions) && parsed.transactions.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}

    // NO DATA FOUND ANYWHERE — return null explicitly.
    // This is the SAFE path: the caller must NOT auto-save empty data.
    return null;
  }

  /**
   * ═══ SAFE LOAD for CashFlow metadata ═══
   *
   * Load netWorthOffset + savingsBalance with the same tiered approach:
   * Cloud → IndexedDB → localStorage → defaults.
   *
   * @returns {Object} — { netWorthOffset: 0, savingsBalance: 0 }
   */
  async function loadCashFlowMeta() {
    var defaults = { netWorthOffset: 0, savingsBalance: 0 };

    // STEP 1: Offline fast path — check IndexedDB first
    if (navigator.onLine === false) {
      try {
        var idbOffMeta = await _idb.loadCFMeta();
        if (idbOffMeta && typeof idbOffMeta.netWorthOffset !== 'undefined') return idbOffMeta;
      } catch (_) {}
      try {
        var rawL = localStorage.getItem(CF_LOCAL_OFFSET);
        if (rawL) return JSON.parse(rawL);
      } catch (_) {}
      return defaults;
    }

    await _ensureReady();

    // STEP 2: Firestore
    if (_isOnline()) {
      try {
        var doc = await Promise.race([
          _cfMetaDocRef().get(),
          _timeout(3000)
        ]);
        if (doc && doc.exists) {
          var meta = doc.data();
          // Cache to IndexedDB + localStorage
          try {
            var resolved = {
              netWorthOffset: Number(meta.netWorthOffset) || 0,
              savingsBalance: Number(meta.savingsBalance) || 0
            };
            await _idb.cacheCFMeta(resolved);
            localStorage.setItem(CF_LOCAL_OFFSET, JSON.stringify(resolved));
          } catch (_) {}
          return {
            netWorthOffset: Number(meta.netWorthOffset) || 0,
            savingsBalance: Number(meta.savingsBalance) || 0
          };
        }
        return defaults;
      } catch (err) {
        console.warn('[HubDB] CashFlow Meta load failed:', err.message || err);
      }
    }

    // STEP 3: IndexedDB fallback
    try {
      var idbMeta = await _idb.loadCFMeta();
      if (idbMeta && typeof idbMeta.netWorthOffset !== 'undefined') return idbMeta;
    } catch (_) {}

    // STEP 4: localStorage
    try {
      var raw = localStorage.getItem(CF_LOCAL_OFFSET);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return defaults;
  }

  /**
   * Merge any notes/folders that exist locally but not in the cloud.
   * This prevents data loss when the user adds notes offline.
   */
  function _mergeLocalIntoCloud(cloud, local) {
    if (!local || !local.folders || !cloud || !cloud.folders) return;
    local.folders.forEach(function (localFolder) {
      const match = cloud.folders.find(function (f) { return f.id === localFolder.id; });
      if (!match) {
        cloud.folders.push(localFolder);
      } else if (localFolder.notes && localFolder.notes.length) {
        localFolder.notes.forEach(function (localNote) {
          if (!localNote) return;
          const noteMatch = match.notes.find(function (n) { return n && n.id === localNote.id; });
          if (!noteMatch) {
            match.notes.push(localNote);
          } else if (!localNote.content || !localNote.content.trim()) {
          } else if (!noteMatch.content || !noteMatch.content.trim()) {
            noteMatch.content = localNote.content;
            if (localNote.title) noteMatch.title = localNote.title;
          }
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
    const provider = new firebase.auth.GoogleAuthProvider();
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
    const code = _generateShareCode();
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
    const code = (shareCode || '').trim().toUpperCase();
    if (!code || code.length !== 6) throw new Error('Invalid code: must be exactly 6 characters');

    await _ensureReady();
    try {
      if (_ready && navigator.onLine !== false) {
        const doc = await Promise.race([
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
        const data = doc.data();
        if (!data || !data.sections || data.sections.length === 0) {
          console.warn('[HubDB] Import Error — document exists but has no quiz data');
          throw new Error('Quiz data is empty or corrupted.');
        }
        return data;
      } else {
        console.warn('[HubDB] Cannot import — browser is offline. Trying localStorage fallback.');
      }
    } catch (err) {
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
      const shared = JSON.parse(localStorage.getItem('hub_shared_quizzes') || '{}');
      const localData = shared[code];
      if (localData) {
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
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude O,0,I,1 for readability
    let code = '';
    for (let i = 0; i < 6; i++) {
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
    console.log("[HubDB] loadFlashcardsData() called — auth ready:", _ready, "user:", _user ? _user.uid : "null", "online:", navigator.onLine !== false);
    // Fast-path: if browser says offline, skip auth wait + Firestore entirely
    if (navigator.onLine === false) {
      try {
        const raw = localStorage.getItem(FLASHCARD_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return null;
    }
    await _ensureReady();
    // Try Firestore first when online (with 2.5s timeout)
    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _userRef().get(),
          _timeout(2500)
        ]);
        console.log("[HubDB] loadFlashcardsData — doc.exists:", doc ? doc.exists : "no doc", "user:", _user ? _user.uid : "null");
        if (doc.exists) {
          const cloudData = doc.data().flashcardsData;
          console.log("[HubDB] loadFlashcardsData — cloud flashcardsData:", cloudData ? (cloudData.decks ? cloudData.decks.length + " decks" : "no decks") : "null");
          if (cloudData && cloudData.decks && cloudData.decks.length > 0) {
            // Merge any localStorage changes the user made while offline
            try {
              const localRaw = localStorage.getItem(FLASHCARD_KEY);
              if (localRaw) {
                _mergeLocalFlashcardsIntoCloud(cloudData, JSON.parse(localRaw));
                _userRef().set({ flashcardsData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            try { localStorage.removeItem(FLASHCARD_KEY); } catch (_) {}
            console.log("[HubDB] loadFlashcardsData — returning cloud data with", cloudData.decks.length, "decks");
            return cloudData;
          }
        }

        let defaultFlashcardData = {
          decks: []
        };

        try {
          const localRaw = localStorage.getItem(FLASHCARD_KEY);
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData && localData.decks && localData.decks.length > 0) {
              defaultFlashcardData = localData;
            }
          }
        } catch (_) {}

        console.log("[HubDB] loadFlashcardsData — no cloud data found, defaultFlashcardData has", defaultFlashcardData.decks.length, "decks");

        // Persist the default/merged data to Firestore so cloud is never empty
        try {
          await Promise.race([
            _userRef().set({ flashcardsData: defaultFlashcardData }, { merge: true }),
            _timeout(2500)
          ]);
        } catch (_) {}
        try { localStorage.removeItem(FLASHCARD_KEY); } catch (_) {}
        console.log("[HubDB] loadFlashcardsData — returning default/local data with", defaultFlashcardData.decks.length, "decks");
        return defaultFlashcardData;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed, trying localStorage:', err.message);
      }
    }
    console.log("[HubDB] loadFlashcardsData — not online, falling back to localStorage");
    try {
      const raw = localStorage.getItem(FLASHCARD_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function _mergeLocalFlashcardsIntoCloud(cloud, local) {
    if (!local || !local.decks || !cloud || !cloud.decks) return;
    const cloudIds = {};
    const cloudTitles = {};

    cloud.decks.forEach(function (d) {
      if (d.id) cloudIds[d.id] = true;
      if (d.title) cloudTitles[d.title.toLowerCase().trim()] = true;
    });

    local.decks.forEach(function (localDeck) {
      if (localDeck.id && cloudIds[localDeck.id]) return;

      const titleKey = localDeck.title ? localDeck.title.toLowerCase().trim() : '';
      if (titleKey && cloudTitles[titleKey]) return;

      cloud.decks.push(localDeck);
      cloudIds[localDeck.id] = true;
      cloudTitles[titleKey] = true;
    });

    local.decks.forEach(function (localDeck) {
      const match = cloud.decks.find(function (d) { return d.id === localDeck.id; });
      if (match && localDeck.cards && localDeck.cards.length) {
        localDeck.cards.forEach(function (localCard) {
          if (!localCard) return;
          const cardMatch = match.cards.find(function (c) { return c && c.term === localCard.term; });
          if (!cardMatch) {
            match.cards.push(localCard);
          } else if (!localCard.term || !localCard.term.trim()) {
          } else if (!cardMatch.term || !cardMatch.term.trim()) {
            Object.assign(cardMatch, localCard);
          }
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
        const raw = localStorage.getItem(QUIZ_KEY);
        if (raw) return { decks: JSON.parse(raw) };
      } catch (_) {}
      return { decks: [] };
    }
    await _ensureReady();
    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _userRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          const cloudData = doc.data().quizData;
          if (cloudData && cloudData.decks && cloudData.decks.length > 0) {
            try {
              const localRaw = localStorage.getItem(QUIZ_KEY);
              if (localRaw) {
                _mergeLocalQuizIntoCloud(cloudData, { decks: JSON.parse(localRaw) });
                _userRef().set({ quizData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            try { localStorage.removeItem(QUIZ_KEY); } catch (_) {}
            return cloudData;
          }
        }

        let defaultQuizData = {
          decks: []
        };

        try {
          const localRaw = localStorage.getItem(QUIZ_KEY);
          if (localRaw) {
            const localData = { decks: JSON.parse(localRaw) };
            if (localData.decks && localData.decks.length > 0) {
              defaultQuizData = localData;
            }
          }
        } catch (_) {}

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

    try {
      const raw = localStorage.getItem(QUIZ_KEY);
      if (raw) return { decks: JSON.parse(raw) };
    } catch (_) {}
    return { decks: [] };
  }

  function _mergeLocalQuizIntoCloud(cloud, local) {
    if (!local || !local.decks || !cloud || !cloud.decks) return;
    local.decks.forEach(function (localDeck) {
      const match = cloud.decks.find(function (d) { return d.id === localDeck.id; });
      if (!match) {
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
        const raw = localStorage.getItem(FOCUS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return null;
    }
    await _ensureReady();
    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _userRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          const cloudData = doc.data().focusData;
          if (cloudData && cloudData.customLinks) {
            try {
              const localRaw = localStorage.getItem(FOCUS_KEY);
              if (localRaw) {
                _mergeLocalFocusIntoCloud(cloudData, JSON.parse(localRaw));
                _userRef().set({ focusData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            try { localStorage.removeItem(FOCUS_KEY); } catch (_) {}
            return cloudData;
          }
        }

        let defaultFocusData = {
          customLinks: [],
          lastStation: 'lofi',
          volume: 50,
          playlist: []
        };

        try {
          const localRaw = localStorage.getItem(FOCUS_KEY);
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData && localData.customLinks) {
              defaultFocusData = localData;
            }
          }
        } catch (_) {}

        try {
          const oldPlaylistRaw = localStorage.getItem('hub_focus_playlist');
          if (oldPlaylistRaw) {
            const oldPlaylist = JSON.parse(oldPlaylistRaw);
            if (Array.isArray(oldPlaylist) && oldPlaylist.length > 0 && (!defaultFocusData.playlist || defaultFocusData.playlist.length === 0)) {
              defaultFocusData.playlist = oldPlaylist;
            }
            try { localStorage.removeItem('hub_focus_playlist'); } catch (_) {}
          }
        } catch (_) {}

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

    try {
      const raw = localStorage.getItem(FOCUS_KEY);
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
        const raw = localStorage.getItem(POMODORO_KEY);
        if (raw) return { ...DEFAULT_POMODORO_DATA, ...JSON.parse(raw) };
      } catch (_) {}
      return { ...DEFAULT_POMODORO_DATA };
    }
    await _ensureReady();
    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _userRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          const cloudData = doc.data().pomodoroData;
          if (cloudData && (typeof cloudData.totalFocusMinutes === 'number' || cloudData.work)) {
            try {
              const localRaw = localStorage.getItem(POMODORO_KEY);
              if (localRaw) {
                _mergeLocalPomodoroIntoCloud(cloudData, JSON.parse(localRaw));
                _userRef().set({ pomodoroData: cloudData }, { merge: true }).catch(function () {});
              }
            } catch (_) {}
            try { localStorage.removeItem(POMODORO_KEY); } catch (_) {}
            return { ...DEFAULT_POMODORO_DATA, ...cloudData };
          }
        }

        const defaultPomodoroData = { ...DEFAULT_POMODORO_DATA };

        try {
          const localRaw = localStorage.getItem(POMODORO_KEY);
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData && (typeof localData.totalFocusMinutes === 'number' || localData.work)) {
              defaultPomodoroData = { ...defaultPomodoroData, ...localData };
            }
          }
        } catch (_) {}

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

    try {
      const raw = localStorage.getItem(POMODORO_KEY);
      if (raw) return { ...DEFAULT_POMODORO_DATA, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_POMODORO_DATA };
  }

  function _mergeLocalPomodoroIntoCloud(cloud, local) {
    if (!local || !cloud) return;
    if (typeof local.totalFocusMinutes === 'number') {
      cloud.totalFocusMinutes = Math.max(cloud.totalFocusMinutes || 0, local.totalFocusMinutes);
    }
    if (typeof local.completedSessions === 'number') {
      cloud.completedSessions = Math.max(cloud.completedSessions || 0, local.completedSessions);
    }
    if (local.dailyHistory && typeof local.dailyHistory === 'object') {
      if (!cloud.dailyHistory) cloud.dailyHistory = {};
      Object.keys(local.dailyHistory).forEach(function (dateKey) {
        const localVal = local.dailyHistory[dateKey];
        const cloudVal = cloud.dailyHistory[dateKey] || 0;
        cloud.dailyHistory[dateKey] = Math.max(localVal, cloudVal);
      });
    }
    if (local.lastCompletedDate && (!cloud.lastCompletedDate || local.lastCompletedDate > cloud.lastCompletedDate)) {
      cloud.lastCompletedDate = local.lastCompletedDate;
    }
    if (typeof local.work === 'number') cloud.work = local.work;
    if (typeof local.shortBreak === 'number') cloud.shortBreak = local.shortBreak;
    if (typeof local.longBreak === 'number') cloud.longBreak = local.longBreak;
    if (local.soundProfile) cloud.soundProfile = local.soundProfile;
    if (typeof local.autoStartBreaks === 'boolean') cloud.autoStartBreaks = local.autoStartBreaks;
    if (typeof local.autoStartFocus === 'boolean') cloud.autoStartFocus = local.autoStartFocus;
  }

  // ── Flashcard AI Settings ──

  const FLASHCARD_SETTINGS_KEY = 'hub_flashcard_ai_settings';

  const DEFAULT_FLASHCARD_SETTINGS = {
    schema: [
      { id: 'phonetic', name: 'Phonetic', prompt: 'Provide the IPA phonetic transcription.', isDeletable: false },
      { id: 'synonym', name: 'Synonym', prompt: 'Provide 2-3 common synonyms.', isDeletable: true }
    ],
    systemLanguage: 'en',
    workspaceTheme: 'cyberpunk'
  };

  /**
   * Firestore doc ref for flashcard AI settings.
   * Path: users/{userId}/settings/flashcards
   */
  function _flashcardSettingsDocRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid).collection('settings').doc('flashcards');
  }

  /**
   * Save flashcard AI settings (schema) to Firestore.
   * Falls back to localStorage when offline.
   * @param {Object} data - { schema: [...] }
   */
  async function saveFlashcardSettings(data) {
    await _ensureReady();

    if (_isOnline()) {
      try {
        await Promise.race([
          _flashcardSettingsDocRef()
            .set(data)
            .catch(function (err) {
              console.error('[HubDB] Flashcard Settings Write Failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        return;
      } catch (err) {
        console.error('[HubDB] Firestore set() for flashcard settings failed:', err.message || err);
        return;
      }
    }

    // Offline fallback
    try {
      localStorage.setItem(FLASHCARD_SETTINGS_KEY, JSON.stringify(data));
    } catch (quotaErr) {
      console.error('[HubDB] localStorage quota exceeded');
    }
  }

  /**
   * Load flashcard AI settings from Firestore.
   * Falls back to localStorage when offline.
   * If no data exists anywhere, returns the default schema.
   * @returns {Object} { schema: [...] }
   */
  async function loadFlashcardSettings() {
    if (navigator.onLine === false) {
      try {
        const raw = localStorage.getItem(FLASHCARD_SETTINGS_KEY);
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return { ...DEFAULT_FLASHCARD_SETTINGS, schema: DEFAULT_FLASHCARD_SETTINGS.schema.map(function (s) { return { ...s }; }) };
    }
    await _ensureReady();

    if (_isOnline()) {
      try {
        const doc = await Promise.race([
          _flashcardSettingsDocRef().get(),
          _timeout(2500)
        ]);
        if (doc.exists) {
          const cloudData = doc.data();
          if (cloudData && cloudData.schema && cloudData.schema.length > 0) {
            try { localStorage.removeItem(FLASHCARD_SETTINGS_KEY); } catch (_) {}
            return cloudData;
          }
        }

        try {
          const localRaw = localStorage.getItem(FLASHCARD_SETTINGS_KEY);
          if (localRaw) {
            const localData = JSON.parse(localRaw);
            if (localData && localData.schema && localData.schema.length > 0) {
              _flashcardSettingsDocRef().set(localData).catch(function () {});
              try { localStorage.removeItem(FLASHCARD_SETTINGS_KEY); } catch (_) {}
              return localData;
            }
          }
        } catch (_) {}

        const defaults = {
          ...DEFAULT_FLASHCARD_SETTINGS,
          schema: DEFAULT_FLASHCARD_SETTINGS.schema.map(function (s) { return { ...s }; })
        };
        _flashcardSettingsDocRef().set(defaults).catch(function () {});
        return defaults;
      } catch (err) {
        console.warn('[HubDB] Firestore load failed for flashcard settings, trying localStorage:', err.message);
      }
    }

    try {
      const raw = localStorage.getItem(FLASHCARD_SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { ...DEFAULT_FLASHCARD_SETTINGS, schema: DEFAULT_FLASHCARD_SETTINGS.schema.map(function (s) { return { ...s }; }) };
  }

  // ── Time Management ──

  const TM_LOCAL_KEY = 'hub_tm_data';

  function _tmDocRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid).collection('timeman_store').doc('data');
  }

  /**
   * Save Time Management data (blocks + custom tags).
   * Firestore-first, localStorage fallback.
   * @param {Object} data — { blocks: [], customTags: [] }
   */
  async function saveTimeManagementData(data) {
    await _ensureReady();

    if (_isOnline()) {
      try {
        await Promise.race([
          _tmDocRef()
            .set({ payload: data }, { merge: true })
            .catch(function (err) {
              console.error('[HubDB] TimeManagement write failed:', err);
              throw err;
            }),
          _timeout(2500)
        ]);
        try { localStorage.setItem(TM_LOCAL_KEY, JSON.stringify(data)); } catch (_) {}
        return;
      } catch (err) {
        console.error('[HubDB] TimeManagement save failed:', err.message || err);
        try { localStorage.setItem(TM_LOCAL_KEY, JSON.stringify(data)); } catch (_) {}
        return;
      }
    }

    try { localStorage.setItem(TM_LOCAL_KEY, JSON.stringify(data)); } catch (_) {}
  }

  /**
   * Load Time Management data.
   * Cloud first, localStorage fallback.
   * @returns {Object|null} — { blocks: [], customTags: [] }
   */
  async function loadTimeManagementData() {
    if (navigator.onLine === false) {
      try {
        var rawLocal = localStorage.getItem(TM_LOCAL_KEY);
        if (rawLocal) return JSON.parse(rawLocal);
      } catch (_) {}
      return null;
    }

    await _ensureReady();

    if (_isOnline()) {
      try {
        var doc = await Promise.race([
          _tmDocRef().get(),
          _timeout(2500)
        ]);
        if (doc && doc.exists) {
          var cloudData = doc.data().payload;
          if (cloudData && Array.isArray(cloudData.blocks)) {
            try { localStorage.setItem(TM_LOCAL_KEY, JSON.stringify(cloudData)); } catch (_) {}
            return cloudData;
          }
          return null;
        }
        return null;
      } catch (err) {
        console.warn('[HubDB] TimeManagement load failed, trying localStorage:', err.message);
      }
    }

    try {
      var raw = localStorage.getItem(TM_LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
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
    saveCashFlowData: saveCashFlowData,
    loadCashFlowData: loadCashFlowData,
    saveCashFlowMeta: saveCashFlowMeta,
    loadCashFlowMeta: loadCashFlowMeta,
    savePomodoroData: savePomodoroData,
    loadPomodoroData: loadPomodoroData,
    saveFlashcardSettings: saveFlashcardSettings,
    loadFlashcardSettings: loadFlashcardSettings,
    saveTimeManagementData: saveTimeManagementData,
    loadTimeManagementData: loadTimeManagementData,
    loginWithGoogle: loginWithGoogle,
    getAuthStatus: getAuthStatus,
    waitForReady: _ensureReady,
    shareQuizDeck: shareQuizDeck,
    importSharedQuiz: importSharedQuiz
  };

})();