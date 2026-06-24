/* ============================================================
   HUB.OS — database.js
   Firebase Firestore adapter with localStorage fallback.
   Uses the Adapter Pattern: UI modules call HubDB.* and never
   touch Firebase or localStorage directly.
   ============================================================ */

const HubDB = (function () {
  'use strict';

  // ⚠️  REPLACE with your Firebase project config
  const firebaseConfig = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
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

    // Track auth state
    _auth.onAuthStateChanged(function (user) {
      _user = user;
    });

    _ready = true;
  } catch (err) {
    _initError = err;
    console.warn('[HubDB] Firebase init failed, falling back to localStorage:', err.message);
  }

  // ── Helpers ──

  function _isOnline() {
    return _ready && _user && navigator.onLine !== false;
  }

  function _userRef() {
    if (!_isOnline()) return null;
    return _db.collection('users').doc(_user.uid);
  }

  // ── Public API ──

  /**
   * Save notes workspace data.
   * If logged in and online → Firestore.
   * Otherwise → localStorage fallback.
   * @param {Object} data - The full notes workspace object
   */
  async function saveNotesData(data) {
    try {
      if (_isOnline()) {
        await _userRef().set(
          { notesWorkspace: data },
          { merge: true }
        );
        return;
      }
    } catch (err) {
      console.warn('[HubDB] Firestore save failed, falling back to localStorage:', err.message);
    }
    // localStorage fallback
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
   * @returns {Object|null} The parsed notes workspace, or null if none found
   */
  async function loadNotesData() {
    // Try Firestore first when online
    if (_isOnline()) {
      try {
        var doc = await _userRef().get();
        if (doc.exists) {
          var cloudData = doc.data().notesWorkspace;
          if (cloudData) {
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
        // Merge individual notes that don't exist in cloud
        localFolder.notes.forEach(function (localNote) {
          var noteMatch = match.notes.find(function (n) { return n && n.id === localNote.id; });
          if (!noteMatch) {
            match.notes.push(localNote);
          }
        });
      }
    });
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

  // ── Expose public API ──

  return {
    saveNotesData: saveNotesData,
    loadNotesData: loadNotesData,
    getAuthStatus: getAuthStatus
  };

})();