/* ============================================================
   HUB.OS — modules/time-management.js   ·   v3
   Time-blocking planner: Day / Week / Month, drag-to-create,
   drag-to-move, drag-to-resize, templates, focus mode, audio
   alerts, cloud sync (HubDB) with localStorage fallback.

   Public contract (unchanged): { id, name, icon, render(container), destroy() }
   Registered through app.register(timeManagementModule).
   ============================================================ */

// Legacy global kept for any other module that still calls _esc().
// Guarded so it can never collide with another definition.
(function () {
  if (typeof window !== 'undefined' && typeof window._esc !== 'function') {
    window._esc = function (str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    };
  }
})();

const timeManagementModule = (function () {
  'use strict';

  /* ============================================================
     CONSTANTS  (SLOT_H / HOUR_H must match --tm-slot-h / --tm-hour-h)
     ============================================================ */
  const SECTION_ID   = 'time-management';
  const LOCAL_KEY    = 'hub_tm_data';
  const TEMPLATE_KEY = 'hub_tm_templates';
  const AUDIO_KEY    = 'hub_tm_audio';
  const STREAK_MIN      = 0.5;   // a day counts when >= 50% of its planned minutes are done
  const STREAK_REST_GAP = 2;     // up to 2 empty days in a row do not break a streak
  const MS_KEY          = 'hub_tm_milestones';   // local mirror (per account) of the synced milestone map
  /* Reward milestones: streak length -> difficulty tier (edit freely; keep ascending) */
  const MS_TIERS = [
    { n: 3,   k: 'easy',      name: 'Easy',      msg: 'Three days in a row. The spark is lit.' },
    { n: 7,   k: 'medium',    name: 'Medium',    msg: 'A full week. The habit is taking shape.' },
    { n: 14,  k: 'hard',      name: 'Hard',      msg: 'Two weeks. Most people quit before this.' },
    { n: 30,  k: 'challenge', name: 'Challenge', msg: 'Thirty days. This is who you are now.' },
    { n: 100, k: 'hell',      name: 'Hell',      msg: 'One hundred days. Legendary.' }
  ];
  const NOTIF_KEY    = 'hub_tm_notif';      // per device: { enabled, bgOnly }
  const SW_URL       = 'tm-sw.js';          // must sit next to index.html (see tm-sw.js)

  /* Focus session: Start / Pause / Stop records the time you really focused on a block (block.focusMs, synced) */
  const FS_KEY       = 'hub_tm_fsession';   // the running session, per account → survives a reload
  const FS_MODE_KEY  = 'hub_tm_fmode';      // last chosen mode (per device)
  const FS_MODES = {
    block: { label: 'Timer',    hint: 'Counts the time you focus on this block' },
    pomo:  { label: 'Pomodoro', hint: '25 min focus · 5 min break · 15 min every 4th', work: 25, brk: 5,  long: 15, every: 4 },
    deep:  { label: 'Deep work', hint: '90 min focus · 15 min break',                   work: 90, brk: 15, long: 15, every: 0 }
  };
  const FS_QUICK       = [15, 25, 45, 90];  // quick-focus lengths (minutes)
  const FS_EARLY_MIN   = 15;                // "Start early" is offered when the next block starts within this many minutes
  const FS_MIN_MS      = 5000;              // a session shorter than this is treated as a mis-tap and not recorded
  const FS_AWAY_LOAD   = 180000;            // page was closed longer than this → the restored session comes back paused
  const FS_AWAY_TICK   = 1800000;           // gap this long between two ticks = computer slept → pause at the last heartbeat
  const VIEW_KEY     = 'hub_tm_view';
  const HINT_KEY     = 'hub_tm_hint_seen';
  /* Inbox / Backlog: tasks that have no time yet (see the INBOX section) */
  const INBOX_KEY      = 'hub_tm_inbox';        // local mirror (per account): safety net next to the cloud payload
  const INBOX_OPEN_KEY = 'hub_tm_inbox_open';   // panel open / closed (per device)
  const IBX_MAX        = 200;
  const IBX_PRI        = ['high', 'normal', 'low'];                               // order = sort order in the Inbox
  const IBX_PRI_LABEL  = { high: 'High', normal: 'Normal', low: 'Low' };
  const SLOT_H       = 36;
  const HOUR_H       = 72;
  const DAY_MINS     = 1440;
  const SNAP         = 15;   // minutes — move / resize / create granularity
  const MIN_DUR      = 15;   // shortest block
  const CREATE_DUR   = 30;   // block created by a plain click
  const LONG_PRESS   = 380;  // ms — touch: press & hold to create / move
  const MAX_CUSTOM_TAGS = 12;

  const DEFAULT_TAGS = [
    { id: 'work',     label: 'Work',     color: '#00bfff', opacity: 85 },
    { id: 'study',    label: 'Study',    color: '#7c4dff', opacity: 85 },
    { id: 'skill',    label: 'Skill',    color: '#00e676', opacity: 85 },
    { id: 'personal', label: 'Personal', color: '#ff6e40', opacity: 85 }
  ];
  const TAG_SWATCHES = [['#00bfff', 'Sky'], ['#7c4dff', 'Violet'], ['#00e676', 'Mint'], ['#ff6e40', 'Coral'], ['#ffd740', 'Amber'], ['#ff4081', 'Rose'], ['#1de9b6', 'Teal'], ['#b0bec5', 'Slate']];
  const FALLBACK_TAG = { id: '__none', label: 'Untagged', color: '#8b8b9e', opacity: 60 };

  const DAY_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_FULL  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* Timeline drawer v2 — constants & state */
  const TL_KEY = 'hub_tm_timeline_prefs';
  const TL_RANGES = [['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['late', 'Overdue']];
  const TL_STATUS = [['all', 'All'], ['todo', 'To do'], ['done', 'Done']];
  const TL_SORTS = ['nearest', 'newest', 'duration'];
  const TL_SVG = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  const TL_ICON = {
    search: TL_SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    copy:   TL_SVG('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    target: TL_SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    check:  TL_SVG('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    fwd:    TL_SVG('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    del:    TL_SVG('<path d="M6 6l12 12M18 6 6 18"/>'),
    chev:   TL_SVG('<path d="m9 6 6 6-6 6"/>'),
    edit:   TL_SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>')
  };
  let _tl = { q: '', tag: 'all', range: 'all', status: 'all', pastOpen: false, open: {} };
  /* Set Time v2 — constants & state */
  const SB_DURS = [15, 30, 45, 60, 90, 120, 180];
  const SB_WEEKS = [1, 2, 4, 8, 12];
  const SB_PRESETS = [['once', 'Just this day', []], ['weekdays', 'Weekdays', [1, 2, 3, 4, 5]], ['weekends', 'Weekends', [6, 0]], ['all', 'Every day', [0, 1, 2, 3, 4, 5, 6]]];
  const SB_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  let _sb = { tag: 'work', days: [], weeks: 1, ov: {}, dur: 30 };

  const ICON = {
    inbox:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    brush:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>',
    clock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
    prev:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15,18 9,12 15,6"/></svg>',
    next:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9,18 15,12 9,6"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>',
    repeat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17,1 21,5 17,9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><rect x="7" y="10" width="4" height="8" rx="1"/><rect x="13" y="6" width="4" height="12" rx="1"/></svg>',
    review:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/></svg>',
    focus:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
    flame:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c1 3.2 4.5 5.2 4.5 9.5A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.5c0-1.7.8-2.9 1.8-3.9.2 1.1.8 1.9 1.6 2.2C10.6 8.1 11 5.6 12 3Z"/><path d="M12 21a3 3 0 0 1-3-3"/></svg>',
    bell:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    gear:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>'
  };

  /* ============================================================
     STATE
     ============================================================ */
  let _sectionEl   = null;
  let _initialised = false;
  let _dataReady   = false;
  let _dataTrusted = false;       // this account's data really came from the cloud (or this is a signed-out session) → safe to compare with Habitica
  let _dataUid     = undefined;   // account whose data is in memory: uid, null = signed out, undefined = nothing loaded yet
  let _loadSeq     = 0;           // lets a newer load (account switch) supersede an older one still in flight
  let _syncWired   = false;
  let _tombs       = { blocks: {}, tags: {}, templates: {}, inbox: {} };                       // id → deletion time (so deletes sync too)
  let _base        = { blocks: {}, tags: {}, templates: {}, inbox: {}, settings: '' };          // signature of every item at the last sync
  let _settingsAt  = 0;
  let _msMap          = {};   // celebrated milestones: 'runStart|days' -> date. Add-only, synced with the account
  let _remoteT     = null;
  let _pendingClaim = null;
  let _fs = null, _fsTimer = null, _fsSummary = null, _fsSig = '', _fsMiss = 0;     // focus session state
  let _fsMode = (function () { const m = _lsGet(FS_MODE_KEY); return FS_MODES[m] ? m : 'block'; })();
  let _fsQuick = 25;
  let _confirmCancelCb = null;
  let _ui          = new AbortController();   // document-level listeners of the current mount

  let _view        = _lsGet(VIEW_KEY) === 'week' || _lsGet(VIEW_KEY) === 'month' ? _lsGet(VIEW_KEY) : 'day';
  let _currentDate = _todayStr();
  let _timeBlocks  = [];
  let _customTags  = [];
  let _activeTagId = 'work';
  let _templates   = [];
  let _inbox       = [];     // Inbox / Backlog: tasks with no time yet { id, title, tagId, dur, note, ck, createdAt, updatedAt }
  let _ibx         = null;   // inbox drag in progress
  let _wkd         = null;   // Week view: block being dragged back to the Inbox
  let _ibxSuppress = 0;      // swallow the click that follows a drag
  let _ibxOpen     = (function () { const v = _lsGet(INBOX_OPEN_KEY); return v === null ? (typeof window !== 'undefined' && window.innerWidth >= 1000) : v === '1'; })();
  const LEGACY_SOUNDS = ['https://www.soundjay.com/misc/sounds/bell-ringing-01.mp3', 'https://www.soundjay.com/misc/sounds/bell-ringing-02.mp3'];
  let _audio = {
    enabled: false,
    voice: 'auto',                 // 'auto' = follow the active theme
    volume: 70,
    preMins: 5,
    warnMins: 5,
    cues: { pre: true, start: true, warn: true, end: true, handover: true },
    useCustom: false,              // optional: your own mp3 for start / end
    startSoundURL: '',
    endSoundURL: ''
  };

  let _drag = null;
  let _suppressClickUntil = 0;
  let _editingId = null;
  let _confirmCb = null;
  let _savedRange = null;
  let _lastToday = _todayStr();
  let _pendingScroll = null;        // minutes to scroll to after next day-grid build

  let _nowTimer = null, _focusTimer = null, _saveTimer = null, _toastTimer = null, _tlTimer = null;
  let _notif = { enabled: false, bgOnly: true }, _noticeDone = {}, _hbWorker = null, _hbTimer = null, _swReg = null, _swPromise = null;
  let _audioTimer = null, _ctx = null, _master = null, _sched = {}, _buses = [], _cueTimers = [], _sample = null;

  const _modalStack = [];
  const _returnFocus = new Map();

  /* ============================================================
     SMALL HELPERS
     ============================================================ */
  function _lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function _lsJson(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function _esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function _el(sel) { return _sectionEl ? _sectionEl.querySelector(sel) : null; }
  function _all(sel) { return _sectionEl ? Array.prototype.slice.call(_sectionEl.querySelectorAll(sel)) : []; }

  function _todayStr() { return _dateToStr(new Date()); }
  function _dateToStr(d) { return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()); }
  function _parseDate(s) { return new Date(s + 'T00:00:00'); }
  function _isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(_parseDate(s).getTime()); }
  function _dateLabel(d) { return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate(); }
  function _weekStart(dateStr) {
    const d = _parseDate(dateStr);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));    // Monday-first
    return d;
  }
  function _addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  /* "HH:MM" <-> minutes. "24:00" is a legal END time (midnight at the end of the day). */
  function _toMins(t) {
    if (!t) return 0;
    const p = String(t).split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }
  function _toTime(m) {
    m = Math.round(m);
    if (m >= DAY_MINS) return '24:00';
    return _pad(Math.floor(m / 60)) + ':' + _pad(m % 60);
  }
  function _fmtGold(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function _fmtDur(m) {
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + 'm';
    return r ? h + 'h ' + r + 'm' : h + 'h';
  }
  function _snap(v, mode) {
    const f = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
    return f(v / SNAP) * SNAP;
  }
  function _safeColor(c) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8b8b9e'; }

  /* ---- Tags ---- */
  function _allTags() { return DEFAULT_TAGS.concat(_customTags); }
  function _tagById(id) {
    for (let i = 0, a = _allTags(); i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }
  function _tagOrFallback(id) { return _tagById(id) || FALLBACK_TAG; }
  function _tint(tag) { return Math.round(10 + (tag.opacity || 85) * 0.3); }
  /** Readable text colour (dark or light) for anything painted in the solid tag colour. */
  function _inkFor(hex) {
    const c = _safeColor(hex), ch = [1, 3, 5].map(function (i) {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) > 0.4 ? '#10121a' : '#ffffff';
  }
  function _tagStyle(tag) { return '--tm-c:' + _safeColor(tag.color) + ';--tm-k:' + _tint(tag) + ';--tm-ink:' + _inkFor(tag.color); }

  /* ---- Blocks ---- */
  function _blockById(id) {
    for (let i = 0; i < _timeBlocks.length; i++) if (_timeBlocks[i].id === id) return _timeBlocks[i];
    return null;
  }
  function _blocksForDate(d) {
    return _timeBlocks
      .filter(function (b) { return b.date === d; })
      .sort(function (a, b) { return _toMins(a.startTime) - _toMins(b.startTime); });
  }
  function _newId(suffix) { return 'blk-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + (suffix !== undefined ? '-' + suffix : ''); }

  function _others(date, exceptId) {
    return _timeBlocks
      .filter(function (b) { return b.date === date && b.id !== exceptId; })
      .map(function (b) { return { b: b, s: _toMins(b.startTime), e: _toMins(b.endTime) }; });
  }
  /** First block that overlaps [s,e) on `date`, or null. */
  function _overlap(date, s, e, exceptId) {
    const o = _others(date, exceptId);
    for (let i = 0; i < o.length; i++) if (s < o[i].e && e > o[i].s) return o[i].b;
    return null;
  }
  /** Free interval that contains minute `m` on `date` ([m,m] when m sits inside a block). */
  function _freeBounds(date, m, exceptId) {
    let lo = 0, hi = DAY_MINS;
    _others(date, exceptId).forEach(function (o) {
      if (o.e <= m) lo = Math.max(lo, o.e);
      else if (o.s > m) hi = Math.min(hi, o.s);
      else { lo = m; hi = m; }
    });
    return [lo, hi];
  }
  /** How far a block can travel without touching its neighbours. */
  function _neighbourBounds(b) {
    const s = _toMins(b.startTime), e = _toMins(b.endTime);
    let lo = 0, hi = DAY_MINS;
    _others(b.date, b.id).forEach(function (o) {
      if (o.e <= s) lo = Math.max(lo, o.e);
      if (o.s >= e) hi = Math.min(hi, o.s);
    });
    return [lo, hi];
  }

  /* ============================================================
     HTML SANITISER  (block descriptions are contenteditable HTML)
     Whitelist of inline/list tags; only a safe colour survives.
     ============================================================ */
  const _ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, DIV: 1, P: 1, SPAN: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, FONT: 1 };
  const _DROP    = /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|SVG|MATH|TEMPLATE|NOSCRIPT|FORM|INPUT|BUTTON|TEXTAREA|SELECT|IMG|VIDEO|AUDIO)$/;
  const _COLOR   = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i;

  function _sanitizeHtml(html) {
    if (!html) return '';
    const tpl = document.createElement('template');   // inert: nothing executes or loads
    tpl.innerHTML = String(html);
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
        if (ch.nodeType === 3) return;
        if (ch.nodeType !== 1) { ch.remove(); return; }
        if (!_ALLOWED[ch.tagName]) {
          if (_DROP.test(ch.tagName)) { ch.remove(); return; }
          walk(ch);
          while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
          ch.remove();
          return;
        }
        let color = ch.tagName === 'FONT' ? ch.getAttribute('color') : (ch.style && ch.style.color);
        Array.prototype.slice.call(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
        if (color && _COLOR.test(color.trim())) ch.style.color = color.trim();
        walk(ch);
      });
    })(tpl.content);
    return tpl.innerHTML;
  }
  function _plainText(html) {
    if (!html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = _sanitizeHtml(html).replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ');
    return tpl.content.textContent.replace(/\s+/g, ' ').trim();
  }

  /* ============================================================
     DATA NORMALISATION
     ============================================================ */
  function _normTag(t) {
    if (!t || !t.id) return null;
    return { id: String(t.id), label: String(t.label || 'Tag').slice(0, 20), color: _safeColor(t.color), opacity: _clamp(parseInt(t.opacity, 10) || 85, 20, 100), updatedAt: Number(t.updatedAt) || 0 };
  }
  function _normBlock(b) {
    if (!b || !b.id || !_isDateStr(b.date)) return null;
    if (!/^\d{1,2}:\d{2}$/.test(b.startTime || '') || !/^\d{1,2}:\d{2}$/.test(b.endTime || '')) return null;
    const s = _toMins(b.startTime);
    let e = _toMins(b.endTime);
    if (s >= DAY_MINS) return null;
    if (e === 0 && s > 0) e = DAY_MINS;                 // legacy "00:00" end = midnight
    if (e <= s) e = Math.min(DAY_MINS, s + CREATE_DUR);
    if (e > DAY_MINS) e = DAY_MINS;
    return {
      id: String(b.id), date: b.date, tagId: String(b.tagId || 'work'),
      startTime: _toTime(s), endTime: _toTime(e),
      title: String(b.title || '').slice(0, 120),
      subtitle: _sanitizeHtml(b.subtitle || ''),
      createdAt: Number(b.createdAt) || parseInt(String(b.id).split('-')[1], 10) || 0,
      done: b.done === true,
      habiticaId: b.habiticaId ? String(b.habiticaId).slice(0, 64) : '',
      habFp: b.habFp ? String(b.habFp).slice(0, 16) : '',
      habDone: b.habDone === true,
      gp: +b.gp > 0 ? Math.min(9999, Math.round(+b.gp * 100) / 100) : 0,       // gold this block earned in Habitica
      focusMs: _clamp(Math.round(Number(b.focusMs) || 0), 0, 86400000),      // time really focused on this block (Focus session)
      checklist: _normCk(b.checklist),
      ckDel: Array.isArray(b.ckDel) ? b.ckDel.map(String).slice(0, CK_MAX) : [],
      updatedAt: Number(b.updatedAt) || 0
    };
  }
  function _normInbox(i) {
    if (!i || !i.id) return null;
    const title = String(i.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return null;
    return {
      id: String(i.id), title: title, tagId: String(i.tagId || 'work'),
      pri: IBX_PRI.indexOf(i.pri) > -1 ? i.pri : 'normal',
      dur: _clamp(Math.round((Number(i.dur) || CREATE_DUR) / SNAP) * SNAP, MIN_DUR, 480),
      note: _sanitizeHtml(i.note || ''),
      ck: Array.isArray(i.ck) ? i.ck.map(function (t) { return String(t).replace(/\s+/g, ' ').trim().slice(0, 200); }).filter(Boolean).slice(0, CK_MAX) : [],
      createdAt: Number(i.createdAt) || 0,
      updatedAt: Number(i.updatedAt) || 0
    };
  }
  function _normTpl(t) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.blocks)) return null;
    const name = String(t.name || 'Template').slice(0, 120);
    return Object.assign({}, t, {
      name: name,
      id: String(t.id || ('tpl-' + (Number(t.createdAt) || 0) + '-' + _habHash(name))),   // stable id for templates saved before ids existed
      updatedAt: Number(t.updatedAt) || 0
    });
  }
  function _normTombs(t) {
    const out = { blocks: {}, tags: {}, templates: {}, inbox: {} };
    if (t && typeof t === 'object') {
      Object.keys(out).forEach(function (k) {
        const m = t[k];
        if (!m || typeof m !== 'object') return;
        Object.keys(m).forEach(function (id) { const n = Number(m[id]); if (n > 0) out[k][id] = n; });
      });
    }
    return out;
  }
  function _seedLegacyTemplates() {
    const l = _lsJson(TEMPLATE_KEY);                      // saved in this browser before templates synced with the account
    _templates = Array.isArray(l) ? l.map(_normTpl).filter(Boolean) : [];
  }
  function _applyData(data) {
    if (!data || typeof data !== 'object') return;
    _customTags  = (Array.isArray(data.customTags) ? data.customTags : []).map(_normTag).filter(Boolean);
    const rawBlocks = Array.isArray(data.timeBlocks) ? data.timeBlocks : (Array.isArray(data.blocks) ? data.blocks : []);
    _timeBlocks  = rawBlocks.map(_normBlock).filter(Boolean);
    _activeTagId = _tagById(data.activeTagId) ? data.activeTagId : 'work';
    const prevIbxT = _tombs && _tombs.inbox;
    _tombs       = _normTombs(data.tombs);
    if (prevIbxT) Object.keys(prevIbxT).forEach(function (id) { if (!(_tombs.inbox[id] >= prevIbxT[id])) _tombs.inbox[id] = prevIbxT[id]; });
    if (Array.isArray(data.inbox)) { _inbox = data.inbox.map(_normInbox).filter(Boolean); _ibxSort(); }
    _settingsAt  = Number(data.settingsAt) || 0;
    if (Array.isArray(data.templates)) _templates = data.templates.map(_normTpl).filter(Boolean);
    else _seedLegacyTemplates();
    _applyAudio(data.audio && typeof data.audio === 'object' ? data.audio : _lsJson(AUDIO_KEY));
  }
  function _resetData() {
    _cancelDrag();
    _fs = null; _fsSummary = null; _fsMiss = 0;     // the session of the previous account stays saved under that account
    _timeBlocks = []; _customTags = []; _templates = []; _inbox = []; _activeTagId = 'work';
    _tombs = { blocks: {}, tags: {}, templates: {}, inbox: {} };
    _settingsAt = 0;
    _msMap = {};
  }

  /* ============================================================
     PERSISTENCE  ·  per-account cloud sync
     Every item carries updatedAt; deletions are kept as tombstones.
     Instead of touching every edit site, _payload() diffs the live
     lists against the last synced signatures and stamps what changed.
     HubDB merges by updatedAt, so two devices never overwrite each other.
     ============================================================ */
  function _sigOf(o) { const c = Object.assign({}, o); delete c.updatedAt; return JSON.stringify(c); }
  function _audioSynced() { const a = JSON.parse(JSON.stringify(_audio)); delete a.enabled; return a; }   // on/off stays per device
  function _stampList(list, kind, now) {
    const base = _base[kind], tomb = _tombs[kind], seen = {};
    list.forEach(function (it) {
      if (!it || it.id === undefined || it.id === null) return;
      seen[it.id] = true;
      const sig = _sigOf(it);
      if (base[it.id] !== sig) { it.updatedAt = now; base[it.id] = sig; }
    });
    Object.keys(base).forEach(function (id) {
      if (seen[id]) return;
      tomb[id] = now;                                    // it was there at the last sync and is gone now → deleted
      delete base[id];
    });
  }
  function _rebase() {
    _base = { blocks: {}, tags: {}, templates: {}, inbox: {}, settings: JSON.stringify([_activeTagId, _audioSynced(), _msMap]) };
    _timeBlocks.forEach(function (b) { _base.blocks[b.id] = _sigOf(b); });
    _customTags.forEach(function (t) { _base.tags[t.id] = _sigOf(t); });
    _templates.forEach(function (t) { _base.templates[t.id] = _sigOf(t); });
    _inbox.forEach(function (t) { _base.inbox[t.id] = _sigOf(t); });
  }
  function _payload() {
    const now = Date.now();
    _stampList(_timeBlocks, 'blocks', now);
    _stampList(_customTags, 'tags', now);
    _stampList(_templates, 'templates', now);
    _stampList(_inbox, 'inbox', now);
    const audio = _audioSynced();
    const ss = JSON.stringify([_activeTagId, audio, _msMap]);
    if (_base.settings !== ss) { _base.settings = ss; _settingsAt = now; }
    return {
      v: 2, timeBlocks: _timeBlocks, customTags: _customTags, templates: _templates, inbox: _inbox,
      audio: audio, activeTagId: _activeTagId, settingsAt: _settingsAt, milestones: _msMap, tombs: _tombs, updatedAt: now
    };
  }
  function _saveAll() {
    _saveTimer = null;
    if (_dataUid === undefined) return;                  // nothing loaded yet — never write an empty shell over real data
    const p = _payload();
    _ibxSaveLs();
    if (typeof HubDB !== 'undefined' && HubDB && typeof HubDB.saveTimeManagementData === 'function') {
      // uid = the account these blocks belong to; HubDB refuses to write them into another account's cloud
      try { Promise.resolve(HubDB.saveTimeManagementData(p, { uid: _dataUid })).catch(function () {}); } catch (_) {}
    } else {
      _lsSet(LOCAL_KEY + ':' + (_dataUid || 'guest'), JSON.stringify(p));
    }
  }
  function _scheduleSave() {
    _habQueueSync();
    if (_audio.enabled) _resetSchedule();
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_saveAll, 250);
  }
  function _flushSave() { if (_saveTimer) { clearTimeout(_saveTimer); _saveAll(); } }

  function _loadData() {
    const seq = ++_loadSeq;
    _dataReady = false;
    if (typeof HubDB === 'undefined' || !HubDB || typeof HubDB.loadTimeManagementState !== 'function') {
      _adopt({ uid: null, payload: _lsJson(LOCAL_KEY) });
      return;
    }
    Promise.resolve(HubDB.loadTimeManagementState())
      .then(function (st) { if (seq === _loadSeq) _adopt(st); })
      .catch(function () {
        if (seq !== _loadSeq) return;
        let uid = null;
        try { uid = HubDB.getAuthStatus().uid; } catch (_) {}
        _adopt({ uid: uid, payload: null });
      });
  }
  /** Replace what is in memory with the state of the account HubDB just loaded. */
  function _adopt(st) {
    _dataUid = st.uid === undefined ? null : st.uid;
    _dataTrusted = !st.uid || !!st.cloudOk;
    _resetData();
    if (st.payload) _applyData(st.payload);
    _ibxLoad(st.payload);
    _loadMs(st.payload);
    _rebase();
    _dataReady = true;
    if (st.claimable && _dataUid) _pendingClaim = { uid: _dataUid, count: st.claimable.count, payload: st.claimable.payload };
    else _pendingClaim = null;
    _afterDataReady(st);
  }
  function _afterDataReady(st) {
    _fsRestore();                          // this account's running focus session, if any
    _habSeedKnown();                       // this account's To-Do ids count as already synced — Habitica must never read another account's blocks as "deleted"
    _habQueueSync(800);
    _loadAudio();                          // this device's alerts on/off switch
    if (_audio.enabled) _startAudio(); else if (_audioTimer) _stopAudio();
    _notifBoot();                          // this device's notification switch
    if (_sectionEl && _sectionEl.isConnected) _paint(true);
    if (st && st.dirty) _scheduleSave();   // local edits were merged in → push them up
    _maybeOfferClaim();
  }

  /* ── Account switch + live updates from other devices ── */
  function _onAuth(ev) {
    if (!_initialised) return;                          // module not opened yet: its first load reads the right account
    if (_dataReady && ev.uid === _dataUid) return;      // same account
    _flushSave();                                       // edits made as the previous account stay with that account
    _loadData();
  }
  function _sameSync(a, b) {
    return JSON.stringify([a.timeBlocks, a.customTags, a.templates, a.audio, a.inbox]) === JSON.stringify([b.timeBlocks, b.customTags, b.templates, b.audio, b.inbox]);
  }
  function _onRemote(uid, remote) {
    if (!_dataReady || uid !== _dataUid) return;
    if (_drag || _editingId || _ibx) {                          // never pull the rug from under a drag / open editor
      if (_remoteT) clearTimeout(_remoteT);
      _remoteT = setTimeout(function () { _remoteT = null; _onRemote(uid, remote); }, 1200);
      return;
    }
    const local = _payload();
    const merged = HubDB.mergeTimeManagement(local, remote);
    const mi = _ibxMerge(_inbox, _tombs.inbox, remote);                // the Inbox is merged here: HubDB only knows blocks / tags / templates
    merged.inbox = mi.list;
    merged.tombs = Object.assign({}, merged.tombs, { inbox: mi.tomb });
    if (_sameSync(merged, local)) return;               // nothing new from the other device
    const keepTag = _activeTagId;
    _applyData(merged);
    if (_tagById(keepTag)) _activeTagId = keepTag;      // the selected tag is a per-device UI choice
    _rebase();
    if (_audio.enabled) _resetSchedule();
    if (_sectionEl && _sectionEl.isConnected) _paint(false);
    _habQueueSync();
  }
  function _wireSync() {
    if (_syncWired || typeof HubDB === 'undefined' || !HubDB) return;
    _syncWired = true;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', _fsBeat);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (document.hidden) _fsBeat(); });
    if (typeof HubDB.onAuthChange === 'function') HubDB.onAuthChange(_onAuth);
    if (typeof HubDB.subscribeTimeManagement === 'function') HubDB.subscribeTimeManagement(_onRemote);
    if (typeof window !== 'undefined') window.addEventListener('online', function () { if (_dataReady) _scheduleSave(); });   // push what was edited offline
  }

  /* Blocks made while signed out (or by an older build) are offered to the account — never copied silently. */
  function _maybeOfferClaim() {
    const c = _pendingClaim;
    if (!c || !_dataReady || c.uid !== _dataUid || !_sectionEl || !_sectionEl.isConnected) return;
    _pendingClaim = null;
    _confirm('This browser has ' + c.count + ' time block' + (c.count > 1 ? 's' : '') + ' that are not in this account yet (made while signed out, or before accounts were kept apart). Import them into this account?', function () {
      const keepTag = _activeTagId;
      _applyData(HubDB.mergeTimeManagement(_payload(), c.payload));
      if (_tagById(keepTag)) _activeTagId = keepTag;
      if (!_templates.length) _seedLegacyTemplates();
      HubDB.claimTimeManagementLocal(c.uid, true);
      _scheduleSave();
      _paint(false);
      _toast('Imported ' + c.count + ' block' + (c.count > 1 ? 's' : ''));
    }, { title: 'Import local data?', label: 'Import', onCancel: function () { HubDB.claimTimeManagementLocal(c.uid, false); } });
  }

  /* ============================================================
     PUBLIC MODULE
     ============================================================ */
  const mod = {
    id: 'time-management',
    name: 'Time Management',
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',

    render: function (container) {
      _teardownUI();
      _ui = new AbortController();
      _currentDate = _todayStr();                 // always open on today
      container.innerHTML = _buildHTML();
      _sectionEl = container.querySelector('#' + SECTION_ID);
      _bindAll();
      if (!_initialised) { _initialised = true; _wireSync(); _loadData(); }
      else if (_dataReady) { _paint(true); _maybeOfferClaim(); }
    },

    destroy: function () {
      _teardownUI();
      if (_sectionEl) _sectionEl.classList.add('hub-tm-hidden');
    }
  };

  function _teardownUI() {
    _ui.abort();                                  // removes every document-level listener
    _cancelDrag();
    _wkEnd();
    _ibxEnd();
    if (_nowTimer)   { clearInterval(_nowTimer);   _nowTimer = null; }
    if (_focusTimer) { clearInterval(_focusTimer); _focusTimer = null; }
    if (_tlTimer)    { clearInterval(_tlTimer);    _tlTimer = null; }
    _habStop();
    if (_toastTimer) { clearTimeout(_toastTimer);  _toastTimer = null; }
    _modalStack.length = 0;
    _returnFocus.clear();
    _flushSave();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', _flushSave);
  }

  /* ============================================================
     HTML
     ============================================================ */
  /* ---- Sound dialog building blocks ("Cue sheet") ---- */
  const _SVG_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  function _tog(id, label) {
    return '<label class="toggle-switch"><input type="checkbox" id="' + id + '" aria-label="' + label + '"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>';
  }
  /** Lead time as a 1 / 2 / 5 / 10 min radio group: one tap, no dropdown. */
  function _seg(name, legend) {
    return '<fieldset class="hub-tm-seg"><legend class="hub-tm-sr">' + legend + '</legend>' + LEAD_CHOICES.map(function (n) {
      return '<label><input type="radio" name="' + name + '" value="' + n + '"><span>' + n + '<small>min</small></span></label>';
    }).join('') + '</fieldset>';
  }
  function _voiceCard(id, name, sub, art, mod) {
    return '<label class="hub-tm-voice' + (mod ? ' ' + mod : '') + '"><input type="radio" name="tm-audio-voice" value="' + id + '">' +
      '<span class="hub-tm-voice-face"><svg class="hub-tm-voice-art" viewBox="0 0 28 20" aria-hidden="true">' + art + '</svg>' +
      '<span class="hub-tm-voice-name">' + name + '</span><span class="hub-tm-voice-sub">' + sub + '</span></span></label>';
  }
  /** One moment of a block: node on the rail · title · melody glyph · ▶ audition · on/off. */
  function _station(type, title, when, hint, leadName, tag) {
    const tagEl = tag || 'li';
    const body = '<span class="hub-tm-st-node" aria-hidden="true"></span>' +
      '<div class="hub-tm-st-main">' +
        '<div class="hub-tm-st-head"><span class="hub-tm-st-title">' + title + '</span><span class="hub-tm-st-when">' + when + '</span>' +
          '<svg class="hub-tm-roll" data-roll="' + type + '" viewBox="0 0 72 26" aria-hidden="true"></svg></div>' +
        '<p class="hub-tm-hint" id="tm-hint-' + type + '">' + hint + '</p>' +
        (leadName ? _seg(leadName, title + ': minutes') : '') +
      '</div>' +
      '<div class="hub-tm-st-ctrl">' +
        '<button type="button" class="hub-tm-play" data-preview="' + type + '" aria-label="Play ' + title.toLowerCase() + ' sound">' + _SVG_PLAY + '</button>' +
        _tog('tm-cue-' + type, title) +
      '</div>';
    return '<' + tagEl + ' class="hub-tm-st" data-cue="' + type + '">' + body + '</' + tagEl + '>';
  }

  function _buildHTML() {
    return '' +
    '<section id="' + SECTION_ID + '" class="module-section" aria-label="Time Management">' +
      '<header class="hub-tm-header">' +
        '<div class="hub-tm-header-grid">' +
          '<div class="hub-tm-brand">' +
            '<span class="hub-tm-title-icon" aria-hidden="true">' + ICON.clock + '</span>' +
            '<div class="hub-tm-brand-text"><h2 class="hub-tm-title">Time Management</h2><span class="hub-tm-eyebrow" id="hub-tm-eyebrow"></span></div>' +
          '</div>' +
        '<div class="hub-tm-header-center">' +
          '<div class="hub-tm-date-selector" role="group" aria-label="Date">' +
            '<button type="button" class="hub-tm-date-nav" id="tm-btn-prev" aria-label="Previous" title="Previous">' + ICON.prev + '</button>' +
            '<input type="date" class="hub-tm-date-input" id="tm-date-picker" aria-label="Select date" value="' + _currentDate + '">' +
            '<button type="button" class="hub-tm-date-nav" id="tm-btn-next" aria-label="Next" title="Next">' + ICON.next + '</button>' +
            '<button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-btn-today">Today</button>' +
          '</div>' +
          '<div class="hub-tm-view-switcher" id="hub-tm-view-switcher" role="group" aria-label="View">' +
            '<button type="button" class="hub-tm-view-btn" data-view="day" aria-pressed="true">Day</button>' +
            '<button type="button" class="hub-tm-view-btn" data-view="week" aria-pressed="false">Week</button>' +
            '<button type="button" class="hub-tm-view-btn" data-view="month" aria-pressed="false">Month</button>' +
          '</div>' +
        '</div>' +
          '<div class="hub-tm-header-right">' +
            '<div class="hub-tm-tools" role="group" aria-label="Planning tools">' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-inbox" title="Inbox · tasks without a time (I)" aria-label="Inbox" aria-controls="hub-tm-inbox" aria-pressed="false" aria-keyshortcuts="I">' + ICON.inbox + '<span class="hub-tm-btn-label">Inbox</span><span class="hub-tm-ibx-badge" id="tm-inbox-badge" hidden></span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-templates" title="Templates" aria-label="Templates">' + ICON.template + '<span class="hub-tm-btn-label">Templates</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-set-time" title="Set Time (repeat blocks)" aria-label="Set Time">' + ICON.repeat + '<span class="hub-tm-btn-label">Set Time</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-timeline" title="Timeline" aria-label="Timeline">' + ICON.timeline + '<span class="hub-tm-btn-label">Timeline</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-review" title="Weekly review" aria-label="Weekly review">' + ICON.review + '<span class="hub-tm-btn-label">Review</span></button>' +
            '</div>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--outline hub-tm-btn--habitica" id="tm-btn-habitica" title="Habitica" aria-label="Habitica"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><polyline points="8.5,12 11,14.5 15.5,9.5"/></svg><span class="hub-tm-btn-label">Habitica</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--focus" id="tm-btn-focus-mode" title="Focus Mode" aria-label="Focus Mode">' + ICON.focus + '<span class="hub-tm-btn-label">Focus</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--outline hub-tm-btn--icon" id="tm-btn-settings" title="Settings" aria-label="Settings">' + ICON.gear + '</button>' +
          '</div>' +
        '</div>' +
      '</header>' +

      '<div class="hub-tm-toolbar">' +
        '<div class="hub-tm-tag-manager" id="hub-tm-tag-manager">' +
          '<span class="hub-tm-tag-manager-label" title="New blocks are painted with the selected tag. Press 1–9 to switch.">' + ICON.brush + '<span>Brush</span></span>' +
          '<div class="hub-tm-tag-list" id="hub-tm-tag-list" role="group" aria-label="Tag brush"></div>' +
          '<button type="button" class="hub-tm-tag-add" id="hub-tm-btn-new-tag" aria-expanded="false" aria-controls="hub-tm-add-tag-form" title="Create a tag"><span aria-hidden="true">+</span>Tag</button>' +
        '</div>' +
        '<div class="hub-tm-deck">' +
        '<div class="hub-tm-summary" id="hub-tm-summary" aria-live="polite"></div>' +
        '<button type="button" class="hub-tm-chip hub-tm-hidden" id="hub-tm-hab-chip" title="Habitica"></button>' +
        '<button type="button" class="hub-tm-chip hub-tm-hidden" id="hub-tm-audio-chip">' + ICON.bell + '<span class="hub-tm-chip-text"></span></button>' +
        '</div>' +
        '<form class="hub-tm-add-tag-form hub-tm-tag-pop" id="hub-tm-add-tag-form" autocomplete="off" role="dialog" aria-label="Create a tag">' +
          '<div class="hub-tm-pop-head"><span class="hub-tm-pop-title">New tag</span><button type="button" class="hub-tm-pop-close" id="hub-tm-pop-close" aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-tag-item hub-tm-pop-preview" id="hub-tm-pop-preview"><span class="hub-tm-tag-dot"></span><span class="hub-tm-tag-name" id="hub-tm-pop-preview-name">New tag</span></div>' +
          '<input type="text" class="hub-tm-input hub-tm-add-tag-name" id="hub-tm-add-tag-name" placeholder="Tag name" maxlength="20" aria-label="New tag name">' +
          '<div class="hub-tm-swatches" id="hub-tm-swatches" role="group" aria-label="Colour">' + TAG_SWATCHES.map(function (c) { return '<button type="button" class="hub-tm-swatch" data-color="' + c[0] + '" style="background:' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '" aria-pressed="false"></button>'; }).join('') + '<label class="hub-tm-swatch-custom" title="Custom colour"><input type="color" class="hub-tm-add-tag-color" id="hub-tm-add-tag-color" value="#00bcd4" aria-label="Custom colour"></label></div>' +
          '<label class="hub-tm-pop-range"><span>Block strength</span><output id="hub-tm-add-tag-opacity-out">85%</output><input type="range" id="hub-tm-add-tag-opacity" min="20" max="100" step="5" value="85" aria-label="Block strength"></label>' +
          '<button type="submit" class="hub-tm-btn hub-tm-btn--primary" id="hub-tm-btn-add-tag">Create tag</button>' +
        '</form>' +
      '</div>' +

      '<form class="hub-tm-qp" id="hub-tm-qp" autocomplete="off">' +
        '<div class="hub-tm-qp-field">' +
          '<span class="hub-tm-qp-ico" aria-hidden="true"></span>' +
          '<textarea class="hub-tm-qp-input" id="tm-qp-input" rows="1" maxlength="3000" spellcheck="false" aria-label="Quick plan" aria-describedby="tm-qp-hint" aria-autocomplete="list" aria-controls="tm-qp-sug" aria-expanded="false" placeholder="Quick plan  ·  mai 9:00 1h Học | việc 1; việc 2  ·  4x25p"></textarea>' +
          '<ul class="hub-tm-qp-sug" id="tm-qp-sug" role="listbox" aria-label="From your history" hidden></ul>' +
        '</div>' +
        '<span class="hub-tm-qp-hint" id="tm-qp-hint" aria-live="polite"></span>' +
        '<ol class="hub-tm-qp-plan" id="tm-qp-plan" aria-label="Plan preview" hidden></ol>' +
        '<span class="hub-tm-qp-keys" title="Point at a block (or select it), then press a key" aria-hidden="true"><kbd>N</kbd>plan <kbd>I</kbd>inbox <kbd>⇧↵</kbd>lines <kbd>E</kbd>edit <kbd>C</kbd>checklist <kbd>X</kbd>done <kbd>B</kbd>→inbox</span>' +
      '</form>' +

      '<div class="hub-tm-hint-bar hub-tm-hidden" id="hub-tm-hint">' +
        '<span>Drag on the grid to create a block · drag a block to move it · drag its edges to resize · drag a block onto the Inbox to put it back · click to edit. On touch, press and hold.</span>' +
        '<button type="button" id="tm-btn-hint-close" aria-label="Dismiss tip">&times;</button>' +
      '</div>' +

      '<div class="hub-tm-stage" id="hub-tm-stage">' +
        '<aside class="hub-tm-inbox' + (_ibxOpen ? ' is-open' : '') + '" id="hub-tm-inbox" aria-label="Inbox">' +
          '<div class="hub-tm-ibx-head">' +
            '<h3 class="hub-tm-ibx-title-h">' + ICON.inbox + '<span>Inbox</span><b class="hub-tm-ibx-count" id="tm-ibx-count"></b></h3>' +
            '<span class="hub-tm-ibx-sum" id="tm-ibx-sum" aria-live="polite"></span>' +
            '<button type="button" class="hub-tm-ibx-x" id="tm-ibx-close" aria-label="Close Inbox" title="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-ibx-add">' +
            '<input type="text" class="hub-tm-input" id="tm-ibx-input" maxlength="200" autocomplete="off" spellcheck="false" aria-label="Add to Inbox" placeholder="Jot it down, no time needed…  30m · #tag · !high">' +
            '<button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-ibx-add" aria-label="Add to Inbox" title="Add (Enter)">+</button>' +
          '</div>' +
          '<p class="hub-tm-ibx-hint">Drag a task onto the grid (touch: press and hold). Drag a block back here to unschedule it. Tap ⋮ to edit.</p>' +
          '<ul class="hub-tm-ibx-list" id="tm-ibx-list" aria-label="Waiting tasks"></ul>' +
        '</aside>' +
        '<div class="hub-tm-ibx-dock" id="hub-tm-ibx-dock" aria-hidden="true">' + ICON.inbox + '<span>Drop to Inbox</span></div>' +
        '<div class="hub-tm-grid-wrapper">' +
          '<div class="hub-tm-grid-header" id="hub-tm-grid-header"></div>' +
          '<div class="hub-tm-grid-scroll" id="hub-tm-grid-scroll"><div class="hub-tm-grid-body" id="hub-tm-grid-body"></div></div>' +
        '</div>' +
      '</div>' +

      /* ── Weekly review ── */
      '<div class="hub-tm-overlay" id="hub-tm-review-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-review" role="dialog" aria-modal="true" aria-labelledby="hub-tm-review-title">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-review-title">' + ICON.review + 'Review</h3><button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-dialog-body hub-tm-rv-body" id="hub-tm-review-body"></div>' +
        '</div>' +
      '</div>' +

      /* ── Focus mode ── */
      '<aside class="hub-tm-focus-panel" id="hub-tm-focus-panel" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="hub-tm-focus-title">' +
        '<div class="hub-tm-focus-backdrop"></div>' +
        '<div class="hub-tm-focus-card">' +
          '<div class="hub-tm-focus-badge"><span class="hub-tm-focus-badge-text">NOW</span></div>' +
          '<div class="hub-tm-focus-info">' +
            '<span class="hub-tm-focus-time"></span>' +
            '<h3 class="hub-tm-focus-title" id="hub-tm-focus-title"></h3>' +
            '<span class="hub-tm-focus-tag"></span>' +
            '<p class="hub-tm-focus-note"></p>' +
            '<ul class="hub-tm-focus-ck hub-tm-hidden" id="hub-tm-focus-ck" aria-label="Checklist"></ul>' +
          '</div>' +
          '<div class="hub-tm-focus-progress">' +
            '<div class="hub-tm-focus-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="hub-tm-focus-fill"></div></div>' +
            '<span class="hub-tm-focus-label"></span>' +
          '</div>' +
          '<div class="hub-tm-fs" id="hub-tm-fs">' +
            '<div class="hub-tm-fs-clock hub-tm-hidden" id="hub-tm-fs-clock" role="timer"><span class="hub-tm-fs-time" id="hub-tm-fs-time">00:00</span><span class="hub-tm-fs-sub" id="hub-tm-fs-sub"></span></div>' +
            '<div class="hub-tm-fs-chips hub-tm-hidden" id="hub-tm-fs-modes" role="group" aria-label="Focus mode"></div>' +
            '<div class="hub-tm-fs-chips hub-tm-hidden" id="hub-tm-fs-quick" role="group" aria-label="Quick focus length"></div>' +
            '<p class="hub-tm-fs-note hub-tm-hidden" id="hub-tm-fs-note"></p>' +
            '<div class="hub-tm-fs-actions" id="hub-tm-fs-actions"></div>' +
          '</div>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--outline" id="tm-btn-focus-exit">Exit Focus</button>' +
        '</div>' +
      '</aside>' +

      /* ── Block details · inspector ── */
      '<div class="hub-tm-overlay" id="hub-tm-details-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-inspector" role="dialog" aria-modal="true" aria-labelledby="hub-tm-details-heading">' +
          '<h3 class="hub-tm-sr-only" id="hub-tm-details-heading">Block details</h3>' +
          '<header class="hub-tm-insp-hero">' +
            '<div class="hub-tm-insp-top">' +
              '<span class="hub-tm-insp-eyebrow"><i class="hub-tm-insp-dot" aria-hidden="true"></i><span id="tm-details-eyebrow">Block details</span></span>' +
              '<button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button>' +
            '</div>' +
            '<input type="text" class="hub-tm-insp-title" id="tm-details-title" placeholder="Untitled block" maxlength="120" autocomplete="off" aria-label="Title">' +
            '<div class="hub-tm-insp-meta">' +
              '<span class="hub-tm-pill" id="tm-details-range"></span>' +
              '<span class="hub-tm-pill" id="tm-details-len"></span>' +
              '<span class="hub-tm-pill hub-tm-pill--status" id="tm-details-status"></span>' +
            '</div>' +
          '</header>' +
          '<div class="hub-tm-dialog-body hub-tm-insp-body">' +
            '<section class="hub-tm-sec" aria-labelledby="tm-sec-sched">' +
              '<h4 class="hub-tm-sec-title" id="tm-sec-sched">Schedule</h4>' +
              '<div class="hub-tm-sched">' +
                '<div class="hub-tm-field hub-tm-sched-date"><label for="tm-details-date">Date</label><input type="date" class="hub-tm-input" id="tm-details-date"></div>' +
                '<div class="hub-tm-field"><label for="tm-details-start">Start</label><input type="time" class="hub-tm-input" id="tm-details-start"></div>' +
                '<div class="hub-tm-field"><label for="tm-details-end">End</label><input type="time" class="hub-tm-input" id="tm-details-end"></div>' +
              '</div>' +
              '<div class="hub-tm-quick" role="group" aria-label="Quick length">' +
                '<span class="hub-tm-quick-label">Length</span>' +
                [15, 30, 45, 60, 90, 120].map(function (m) { return '<button type="button" class="hub-tm-quick-btn" data-dur="' + m + '">' + (m < 60 ? m + 'm' : (m / 60) + 'h') + '</button>'; }).join('') +
              '</div>' +
              '<div class="hub-tm-strip" aria-hidden="true"><div class="hub-tm-strip-track" id="tm-details-track"></div>' +
                '<div class="hub-tm-strip-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>' +
              '<p class="hub-tm-strip-note" id="tm-details-strip-note"></p>' +
              '<p class="hub-tm-error" id="hub-tm-details-error" role="alert"></p>' +
            '</section>' +
            '<section class="hub-tm-sec" aria-labelledby="tm-sec-tag">' +
              '<h4 class="hub-tm-sec-title" id="tm-sec-tag">Tag</h4>' +
              '<div class="hub-tm-details-tags" id="hub-tm-details-tags"></div>' +
            '</section>' +
            '<section class="hub-tm-sec" aria-labelledby="tm-sec-status">' +
              '<h4 class="hub-tm-sec-title" id="tm-sec-status">Status</h4>' +
              '<div class="hub-tm-status-card">' +
                '<div class="hub-tm-status-text"><span class="hub-tm-status-label">Completed</span><span class="hub-tm-hab-state" id="tm-details-habstate"></span></div>' +
                '<label class="toggle-switch"><input type="checkbox" id="tm-details-done" aria-label="Completed"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
              '</div>' +
            '</section>' +
            '<section class="hub-tm-sec" aria-labelledby="tm-sec-desc">' +
              '<h4 class="hub-tm-sec-title" id="tm-sec-desc">Description</h4>' +
            '<div class="hub-tm-field"><span class="hub-tm-sr-only">Description</span>' +
              '<div class="hub-tm-rich">' +
                '<div class="hub-tm-rich-toolbar" id="hub-tm-rich-toolbar">' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="bold" title="Bold" aria-label="Bold"><strong>B</strong></button>' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="italic" title="Italic" aria-label="Italic"><em>I</em></button>' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="underline" title="Underline" aria-label="Underline"><u>U</u></button>' +
                  '<span class="hub-tm-rich-sep"></span>' +
                  '<label class="hub-tm-rich-color-label" title="Text colour"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><input type="color" class="hub-tm-rich-color-picker" id="hub-tm-rich-color" value="#ffffff" aria-label="Text colour"></label>' +
                  '<span class="hub-tm-rich-sep"></span>' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">•≡</button>' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="indent" title="Indent" aria-label="Indent">→</button>' +
                  '<button type="button" class="hub-tm-rich-btn" data-cmd="outdent" title="Outdent" aria-label="Outdent">←</button>' +
                '</div>' +
                '<div id="block-desc-editor" class="hub-tm-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Description" data-placeholder="Add a description…"></div>' +
              '</div>' +
            '</div>' +
            '</section>' +
            '<section class="hub-tm-sec hub-tm-sec--ck">' +
            '<div class="hub-tm-field hub-tm-ck">' +
              '<div class="hub-tm-ck-head"><span class="hub-tm-label">Checklist</span><span class="hub-tm-ck-count" id="tm-ck-count"></span>' +
                '<button type="button" class="hub-tm-ck-link hub-tm-hidden" id="tm-ck-import"></button></div>' +
              '<div class="hub-tm-ck-bar hub-tm-hidden" id="tm-ck-bar"><i id="tm-ck-fill"></i></div>' +
              '<ul class="hub-tm-ck-list" id="tm-ck-list"></ul>' +
              '<div class="hub-tm-ck-add"><span aria-hidden="true">+</span><input type="text" id="tm-ck-new" placeholder="New checklist item — press Enter (paste a list to add many)" maxlength="200" autocomplete="off" aria-label="New checklist item"></div>' +
              '<button type="button" class="hub-tm-ck-link hub-tm-hidden" id="tm-ck-all">All items done — mark this block completed</button>' +
            '</div>' +
            '</section>' +
          '</div>' +
          '<footer class="hub-tm-dialog-foot hub-tm-dialog-foot--split hub-tm-insp-foot">' +
            '<button type="button" class="hub-tm-btn hub-tm-btn--alert" id="tm-btn-details-delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete</button>' +
            '<div class="hub-tm-insp-actions"><span class="hub-tm-insp-keys" aria-hidden="true"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> close</span>' +
              '<button type="button" class="hub-tm-btn hub-tm-btn--outline" id="tm-btn-details-inbox" title="Take it off the grid and keep it in the Inbox">To Inbox</button>' +
              '<button type="button" class="hub-tm-btn hub-tm-btn--outline" data-close>Cancel</button>' +
              '<button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-btn-details-save">Save changes</button></div>' +
          '</footer>' +
        '</div>' +
      '</div>' +

      /* ── Habitica Hub ── */
      '<div class="hub-tm-overlay" id="hub-tm-hab-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-hab-hub" role="dialog" aria-modal="true" aria-labelledby="hub-tm-hab-heading">' +
          '<div class="hub-tm-hab-hero is-locked" id="tm-hab-hero">' +
            '<div class="hub-tm-hab-emblem" id="tm-hab-emblem"></div>' +
            '<div class="hub-tm-hab-hero-text"><span class="hub-tm-hab-eyebrow">Habitica Link</span><h3 id="hub-tm-hab-heading">Unlock Habitica</h3><p id="tm-hab-sub"></p></div>' +
            '<span class="hub-tm-hab-pill is-locked" id="tm-hab-pill">Locked</span>' +
            '<button type="button" class="hub-tm-dialog-close" data-close id="tm-hab-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-hab-body" id="tm-hab-body"></div>' +
        '</div>' +
      '</div>' +

      /* ── Confirm ── */
      '<div class="hub-tm-overlay" id="hub-tm-confirm-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-dialog--sm" role="alertdialog" aria-modal="true" aria-labelledby="hub-tm-confirm-title" aria-describedby="hub-tm-confirm-msg">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-confirm-title">Delete?</h3></div>' +
          '<div class="hub-tm-dialog-body"><p class="hub-tm-confirm-message" id="hub-tm-confirm-msg"></p></div>' +
          '<div class="hub-tm-dialog-foot"><button type="button" class="hub-tm-btn hub-tm-btn--outline" id="tm-btn-confirm-cancel">Cancel</button><button type="button" class="hub-tm-btn hub-tm-btn--danger" id="tm-btn-confirm-delete">Delete</button></div>' +
        '</div>' +
      '</div>' +

      /* ── Inbox · edit one task ── */
      '<div class="hub-tm-overlay" id="hub-tm-ibx-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-ibx-dialog" role="dialog" aria-modal="true" aria-labelledby="hub-tm-ibx-modal-h">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-ibx-modal-h">Edit task</h3><button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-dialog-body">' +
            '<div class="hub-tm-field"><label for="tm-ibx-m-title">Title</label><input type="text" class="hub-tm-input" id="tm-ibx-m-title" maxlength="120" autocomplete="off"></div>' +
            '<div class="hub-tm-field-row">' +
              '<div class="hub-tm-field"><label for="tm-ibx-m-tag">Tag</label><select class="hub-tm-input" id="tm-ibx-m-tag"></select></div>' +
              '<div class="hub-tm-field"><label for="tm-ibx-m-dur">Length</label><select class="hub-tm-input" id="tm-ibx-m-dur"></select></div>' +
            '</div>' +
            '<fieldset class="hub-tm-field"><legend>Priority</legend>' +
              '<div class="hub-tm-ibx-prisel" role="radiogroup" aria-label="Priority">' +
                IBX_PRI.map(function (p) { return '<label data-pri="' + p + '"><input type="radio" name="tm-ibx-m-pri" value="' + p + '"><span><i class="hub-tm-ibx-pri-g" aria-hidden="true"><b></b><b></b><b></b></i>' + IBX_PRI_LABEL[p] + '</span></label>'; }).join('') +
              '</div>' +
            '</fieldset>' +
            '<div class="hub-tm-field"><label for="tm-ibx-m-note">Note</label><textarea class="hub-tm-input hub-tm-ibx-ta" id="tm-ibx-m-note" rows="3" maxlength="2000" placeholder="Anything to remember when you place it"></textarea></div>' +
            '<div class="hub-tm-field"><label for="tm-ibx-m-ck">Checklist <span class="hub-tm-hint">one item per line</span></label><textarea class="hub-tm-input hub-tm-ibx-ta" id="tm-ibx-m-ck" rows="3" placeholder="Call the clinic&#10;Bring the insurance card"></textarea></div>' +
            '<p class="hub-tm-error" id="tm-ibx-m-err" role="alert"></p>' +
          '</div>' +
          '<div class="hub-tm-dialog-foot hub-tm-dialog-foot--split">' +
            '<button type="button" class="hub-tm-btn hub-tm-btn--alert" id="tm-ibx-m-del">Delete</button>' +
            '<div class="hub-tm-ibx-foot-r"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-close>Cancel</button><button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-ibx-m-save">Save</button></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ── Settings · Sound alerts (cue sheet) ── */
      '<div class="hub-tm-overlay" id="hub-tm-settings-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-dialog--lg hub-tm-snd" id="tm-snd" role="dialog" aria-modal="true" aria-labelledby="hub-tm-settings-heading">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-settings-heading">Alerts</h3><button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-dialog-body">' +
            '<section class="hub-tm-snd-master" id="tm-snd-master">' +
              '<div class="hub-tm-snd-master-text">' +
                '<label class="hub-tm-snd-master-title" for="tm-audio-enabled"><span class="hub-tm-snd-dot" aria-hidden="true"></span>Sound alerts</label>' +
                '<p class="hub-tm-hint" id="hub-tm-audio-status" aria-live="polite"></p>' +
              '</div>' +
              '<label class="toggle-switch"><input type="checkbox" id="tm-audio-enabled"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
            '</section>' +
            '<section class="hub-tm-snd-master hub-tm-snd-master--notif" id="tm-notif-master">' +
              '<div class="hub-tm-snd-master-text">' +
                '<label class="hub-tm-snd-master-title" for="tm-notif-enabled"><span class="hub-tm-snd-dot" aria-hidden="true"></span>Notifications</label>' +
                '<p class="hub-tm-hint" id="hub-tm-notif-status" aria-live="polite"></p>' +
                '<label class="hub-tm-hint hub-tm-notif-opt"><input type="checkbox" id="tm-notif-bg"><span>Only when this tab is in the background</span></label>' +
                '<button type="button" class="hub-tm-btn hub-tm-btn--outline hub-tm-notif-test" data-notif-test>Send a test notification</button>' +
              '</div>' +
              '<label class="toggle-switch"><input type="checkbox" id="tm-notif-enabled"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
            '</section>' +
            '<div class="hub-tm-set-group" id="tm-audio-options">' +
              '<section class="hub-tm-snd-sec" aria-labelledby="tm-snd-h-inst">' +
                '<h4 class="hub-tm-snd-h" id="tm-snd-h-inst">Instrument</h4>' +
                '<fieldset class="hub-tm-voices"><legend class="hub-tm-sr">Instrument</legend>' +
                  _voiceCard('auto', 'Follow theme', '<span data-auto-now></span>', '<circle cx="14" cy="10" r="7"/><path d="M14 3a7 7 0 0 1 0 14z" fill="currentColor"/>', 'hub-tm-voice--auto') +
                  _voiceCard('cyber', 'Radar synth', 'Cyberpunk', '<path d="M2 16 10 4v12l8-12v12l8-12"/>') +
                  _voiceCard('solar', 'Singing bowl', 'Solar Zen', '<circle cx="14" cy="10" r="3"/><circle cx="14" cy="10" r="6.2" opacity=".65"/><circle cx="14" cy="10" r="9.2" opacity=".35"/>') +
                  _voiceCard('lofi', 'Soft keys', 'Lo-fi Twilight', '<path d="M2 14 8 6l6 8 6-8 6 8"/>') +
                  _voiceCard('terminal', 'Terminal beep', 'Optimize', '<path d="M2 16V6h6v10h6V6h6v10h6V6"/>') +
                '</fieldset>' +
                '<div class="hub-tm-vol"><label for="tm-audio-volume">Volume</label><input type="range" class="hub-tm-range" id="tm-audio-volume" min="0" max="100" step="5" aria-describedby="tm-audio-volume-val"><output id="tm-audio-volume-val" for="tm-audio-volume"></output></div>' +
                '<p class="hub-tm-hint">Choosing an instrument or moving the volume plays a short sample.</p>' +
              '</section>' +
              '<section class="hub-tm-snd-sec" aria-labelledby="tm-snd-h-sheet">' +
                '<div class="hub-tm-snd-sec-head">' +
                  '<div><h4 class="hub-tm-snd-h" id="tm-snd-h-sheet">When it rings</h4><p class="hub-tm-hint">What every block sounds like, in order. Each tag has its own melody.</p></div>' +
                  '<button type="button" class="hub-tm-btn hub-tm-btn--outline hub-tm-sample" id="tm-sample">' + _SVG_PLAY + '<span>Hear a sample block</span></button>' +
                '</div>' +
                '<fieldset class="hub-tm-melodies" id="tm-preview-tags"><legend>Melody of</legend></fieldset>' +
                '<ol class="hub-tm-stations">' +
                  _station('pre', 'Heads-up', 'before it starts', 'One soft note. Skipped if it would land inside another block.', 'tm-pre-mins') +
                  _station('start', 'Block starts', 'on the minute', 'The tag’s melody, rising.') +
                  _station('warn', 'Wrap-up', 'before it ends', '<span id="tm-warn-note">Two soft pings.</span>', 'tm-warn-mins') +
                  _station('end', 'Block ends', 'on the minute', 'The tag’s melody, falling and resolving to a low note.') +
                '</ol>' +
                '<div class="hub-tm-ho" id="tm-ho" data-cue="handover">' +
                  '<div class="hub-tm-st-main"><div class="hub-tm-st-head"><span class="hub-tm-st-title">Smooth handover</span><span class="hub-tm-st-when">back-to-back blocks</span>' +
                    '<span class="hub-tm-ho-art" aria-hidden="true"><i></i><i></i></span></div>' +
                    '<p class="hub-tm-hint">When a block ends exactly as the next begins, one combined cue replaces the end and start sounds.</p>' +
                  '</div>' +
                  '<div class="hub-tm-st-ctrl"><button type="button" class="hub-tm-play" data-preview="handover" aria-label="Play handover sound">' + _SVG_PLAY + '</button>' + _tog('tm-cue-handover', 'Smooth handover') + '</div>' +
                '</div>' +
              '</section>' +
              '<details class="hub-tm-snd-adv" id="tm-snd-adv">' +
                '<summary>Use my own audio files</summary>' +
                '<div class="hub-tm-snd-adv-body">' +
                  '<div class="hub-tm-cue-row"><div class="hub-tm-cue-text"><label class="hub-tm-settings-label" for="tm-audio-custom">Replace start / end / handover</label><span class="hub-tm-hint">Needs an internet link to an audio file. Heads-up and wrap-up keep the instrument sound.</span></div>' + _tog('tm-audio-custom', 'Use my own audio files for start and end') + '</div>' +
                  '<div class="hub-tm-field"><label for="tm-audio-start-url">Start sound URL</label><div class="hub-tm-save-row"><input type="text" class="hub-tm-input" id="tm-audio-start-url" placeholder="https://example.com/start.mp3" maxlength="500"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-test-sound="start" aria-label="Test start sound">Test</button></div></div>' +
                  '<div class="hub-tm-field"><label for="tm-audio-end-url">End sound URL</label><div class="hub-tm-save-row"><input type="text" class="hub-tm-input" id="tm-audio-end-url" placeholder="https://example.com/end.mp3" maxlength="500"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-test-sound="end" aria-label="Test end sound">Test</button></div></div>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<p class="hub-tm-error" id="hub-tm-settings-error" role="alert"></p>' +
          '</div>' +
          '<div class="hub-tm-dialog-foot"><button type="button" class="hub-tm-btn hub-tm-btn--outline" id="tm-btn-settings-cancel">Cancel</button><button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-btn-settings-save">Save settings</button></div>' +
        '</div>' +
      '</div>' +

      /* ── Templates ── */
      '<div class="hub-tm-overlay" id="hub-tm-template-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-dialog--lg" role="dialog" aria-modal="true" aria-labelledby="hub-tm-template-heading">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-template-heading">Templates</h3><button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-dialog-body"><div class="hub-tm-template-list" id="hub-tm-template-list"></div></div>' +
          '<div class="hub-tm-dialog-foot"><div class="hub-tm-save-row"><input type="text" class="hub-tm-input" id="tm-template-name" placeholder="Name this day as a template…" maxlength="30" aria-label="Template name"><button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-btn-template-save">Save this day</button></div></div>' +
        '</div>' +
      '</div>' +

      /* ── Set Time ── */
      '<div class="hub-tm-overlay" id="hub-tm-set-time-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-dialog--st" role="dialog" aria-modal="true" aria-labelledby="hub-tm-settime-heading">' +
          '<div class="hub-tm-dialog-head hub-tm-sb-head">' +
            '<span class="hub-tm-sb-badge">' + ICON.repeat + '</span>' +
            '<div class="hub-tm-sb-headtext"><h3 class="hub-tm-dialog-title" id="hub-tm-settime-heading">Set Time Block</h3><p class="hub-tm-sb-sub">Repeat a time window across your calendar</p></div>' +
            '<button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-sb-body">' +
            '<div class="hub-tm-sb-pane hub-tm-sb-controls">' +
              '<section class="hub-tm-sb-sec"><h4 class="hub-tm-sb-h"><i>1</i>Time</h4>' +
                '<div class="hub-tm-sb-times">' +
                  '<div class="hub-tm-field"><label for="tm-input-start">Starts</label><input type="time" class="hub-tm-input" id="tm-input-start" value="09:00"></div>' +
                  '<span class="hub-tm-sb-dur" id="tm-sb-dur" aria-live="polite">30m</span>' +
                  '<div class="hub-tm-field"><label for="tm-input-end">Ends</label><input type="time" class="hub-tm-input" id="tm-input-end" value="09:30"></div>' +
                '</div>' +
                '<div class="hub-tm-sb-chips" id="tm-sb-durs" role="group" aria-label="Quick duration">' +
                  SB_DURS.map(function (m) { return '<button type="button" data-sb-dur="' + m + '" aria-pressed="false">' + _fmtDur(m) + '</button>'; }).join('') +
                '</div>' +
                '<div class="hub-tm-sb-day"><div class="hub-tm-sb-track" id="tm-sb-track" aria-hidden="true"></div><div class="hub-tm-sb-ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>' +
                '<p class="hub-tm-hint" id="tm-sb-bar-cap"></p>' +
              '</section>' +
              '<section class="hub-tm-sb-sec"><h4 class="hub-tm-sb-h"><i>2</i>Repeat</h4>' +
                '<div class="hub-tm-sb-chips" id="tm-sb-presets" role="group" aria-label="Repeat presets">' +
                  SB_PRESETS.map(function (p) { return '<button type="button" data-sb-preset="' + p[0] + '" aria-pressed="false">' + p[1] + '</button>'; }).join('') +
                '</div>' +
                '<fieldset class="hub-tm-field"><legend class="hub-tm-sr-only">Repeat on</legend><div class="hub-tm-sb-days" id="tm-day-checks">' +
                  SB_DAYS.map(function (d) { return '<label class="hub-tm-day-check"><input type="checkbox" value="' + d[0] + '"><span>' + d[1] + '</span></label>'; }).join('') +
                '</div></fieldset>' +
                '<p class="hub-tm-hint" id="tm-sb-repeat-cap"></p>' +
              '</section>' +
              '<section class="hub-tm-sb-sec"><h4 class="hub-tm-sb-h"><i>3</i>For how long</h4>' +
                '<div class="hub-tm-tl-seg" id="tm-sb-weeks" role="group" aria-label="Span">' +
                  SB_WEEKS.map(function (w) { return '<button type="button" data-sb-weeks="' + w + '" aria-pressed="false">' + w + ' wk' + (w > 1 ? 's' : '') + '</button>'; }).join('') +
                '</div>' +
                '<p class="hub-tm-hint" id="tm-sb-span-cap"></p>' +
              '</section>' +
              '<section class="hub-tm-sb-sec"><h4 class="hub-tm-sb-h"><i>4</i>Details</h4>' +
                '<div class="hub-tm-sb-tags" id="tm-sb-tags" role="group" aria-label="Tag"></div>' +
                '<div class="hub-tm-field"><label class="hub-tm-sr-only" for="tm-sb-title">Title</label><input type="text" class="hub-tm-input" id="tm-sb-title" maxlength="120" placeholder="Title (optional)" autocomplete="off"></div>' +
              '</section>' +
            '</div>' +
            '<div class="hub-tm-sb-pane hub-tm-sb-preview">' +
              '<div class="hub-tm-sb-phead"><h4 class="hub-tm-sb-h">Preview</h4><button type="button" class="hub-tm-sb-link" data-sb-reset hidden>Reset edits</button></div>' +
              '<div class="hub-tm-tl-stats hub-tm-sb-stats" id="tm-sb-stats"></div>' +
              '<div class="hub-tm-sb-cal" id="tm-sb-cal"></div>' +
              '<ul class="hub-tm-sb-legend" aria-hidden="true"><li><i class="hub-tm-sb-sw is-on"></i>Will be added</li><li><i class="hub-tm-sb-sw is-conflict"></i>Time taken · skipped</li><li><i class="hub-tm-sb-sw is-off"></i>Skipped by you</li></ul>' +
              '<p class="hub-tm-error" id="hub-tm-settime-error" role="alert"></p>' +
            '</div>' +
          '</div>' +
          '<div class="hub-tm-dialog-foot hub-tm-dialog-foot--split">' +
            '<p class="hub-tm-sb-foot">Tip: click any date in the preview to add or skip it.</p>' +
            '<div class="hub-tm-sb-actions"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-close>Cancel</button><button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-btn-apply-time">Add blocks</button></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ── Timeline drawer ── */
      '<div class="hub-tm-drawer-scrim" id="hub-tm-timeline-scrim"></div>' +
      '<aside class="hub-tm-drawer" id="hub-tm-timeline-drawer" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="hub-tm-drawer-heading">' +
        '<div class="hub-tm-drawer-head"><h3 class="hub-tm-drawer-title" id="hub-tm-drawer-heading">' + ICON.timeline + 'Timeline</h3><button type="button" class="hub-tm-dialog-close" id="tm-btn-timeline-close" aria-label="Close timeline">&times;</button></div>' +
        '<div class="hub-tm-drawer-body hub-tm-drawer-body--tl">' +
          '<div class="hub-tm-tl-controls">' +
            '<div class="hub-tm-tl-tools">' +
              '<div class="hub-tm-tl-search">' + TL_ICON.search + '<input type="search" class="hub-tm-input" id="tm-timeline-search" placeholder="Search blocks, tags, tasks…" aria-label="Search timeline" autocomplete="off"></div>' +
              '<button type="button" class="hub-tm-tl-iconbtn" id="tm-timeline-today" title="Jump to today" aria-label="Jump to today">' + TL_ICON.target + '</button>' +
              '<button type="button" class="hub-tm-tl-iconbtn" id="tm-timeline-copy" title="Copy agenda as text" aria-label="Copy agenda as text">' + TL_ICON.copy + '</button>' +
            '</div>' +
            '<div class="hub-tm-tl-seg" id="hub-tm-tl-range" role="group" aria-label="Date range">' +
              TL_RANGES.map(function (r) { return '<button type="button" data-tl-range="' + r[0] + '" aria-pressed="false">' + r[1] + '</button>'; }).join('') +
            '</div>' +
            '<div class="hub-tm-tl-chips" id="hub-tm-tl-tags" role="group" aria-label="Filter by tag"></div>' +
            '<div class="hub-tm-tl-filters">' +
              '<div class="hub-tm-tl-seg" id="hub-tm-tl-status" role="group" aria-label="Status">' +
                TL_STATUS.map(function (r) { return '<button type="button" data-tl-status="' + r[0] + '" aria-pressed="false">' + r[1] + '</button>'; }).join('') +
              '</div>' +
              '<div class="hub-tm-sort-wrap"><label class="hub-tm-sr-only" for="tm-timeline-sort">Sort by</label><select class="hub-tm-input" id="tm-timeline-sort"><option value="nearest">Nearest first</option><option value="newest">Newly added</option><option value="duration">Longest first</option></select></div>' +
            '</div>' +
          '</div>' +
          '<div class="hub-tm-tl-scroll" id="hub-tm-tl-scroll">' +
            '<div id="hub-tm-tl-spot"></div>' +
            '<div class="hub-tm-tl-stats" id="hub-tm-tl-stats"></div>' +
            '<div id="hub-tm-timeline-list"></div>' +
          '</div>' +
        '</div>' +
      '</aside>' +

      '<div class="hub-tm-toast" id="hub-tm-toast" role="status" aria-live="polite" aria-atomic="true"><span class="hub-tm-toast-msg"></span><button type="button" class="hub-tm-toast-action" hidden></button></div>' +
    '</section>';
  }

  /* ============================================================
     BIND
     ============================================================ */
  function _bindAll() {
    const sig = { signal: _ui.signal };
    const s = _sectionEl;

    // Date controls
    _el('#tm-btn-prev').addEventListener('click', function () { _shift(-1); });
    _el('#tm-btn-next').addEventListener('click', function () { _shift(1); });
    _el('#tm-btn-today').addEventListener('click', function () { _setDate(_todayStr()); });
    _el('#tm-date-picker').addEventListener('change', function (e) { if (_isDateStr(e.target.value)) _setDate(e.target.value); });
    _el('#hub-tm-view-switcher').addEventListener('click', function (e) {
      const b = e.target.closest('.hub-tm-view-btn');
      if (b) _setView(b.getAttribute('data-view'));
    });
    _el('#tm-btn-hint-close').addEventListener('click', function () { _lsSet(HINT_KEY, '1'); _el('#hub-tm-hint').classList.add('hub-tm-hidden'); });

    // Tags
    _el('#hub-tm-tag-manager').addEventListener('click', _onTagClick);
    _el('#hub-tm-add-tag-form').addEventListener('submit', _onAddTag);

    // Grid
    _bindGrid(_el('#hub-tm-grid-scroll'));

    // Header actions & dialogs
    _el('#tm-btn-focus-mode').addEventListener('click', _openFocus);
    _el('#tm-btn-focus-exit').addEventListener('click', function () { _closeModal(_el('#hub-tm-focus-panel')); });
    _el('.hub-tm-focus-backdrop').addEventListener('click', function () { _closeModal(_el('#hub-tm-focus-panel')); });
    _el('#hub-tm-fs').addEventListener('click', _fsClick);
    _el('#tm-btn-settings').addEventListener('click', _openSettings);
    _el('#tm-btn-templates').addEventListener('click', _openTemplates);
    _el('#tm-btn-set-time').addEventListener('click', _openSetTime);
    _el('#tm-btn-timeline').addEventListener('click', _openTimeline);
    _el('#tm-btn-review').addEventListener('click', _openReview);
    _bindReview();

    // Generic: [data-close] buttons + clicking a dark backdrop
    s.addEventListener('click', function (e) {
      const c = e.target.closest('[data-close]');
      if (c) { _closeModal(c.closest('.hub-tm-overlay')); return; }
      if (e.target.classList && e.target.classList.contains('hub-tm-overlay')) {
        if (e.target.id === 'hub-tm-confirm-modal') _closeConfirm(); else _closeModal(e.target);
      }
    });

    _bindDetails();
    _bindConfirm();
    _bindSettings();
    _bindTemplates();
    _bindSetTime();
    _bindTimeline();
    _bindToast();
    _bindHabitica();
    _bindTagPop();
    _bindChecklist();
    _bindQuickPlan();
    _bindInbox();

    // One keyboard handler for the whole mount
    document.addEventListener('keydown', _onDocKey, sig);
  }

  function _isTyping(t) { return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function _onDocKey(e) {
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !_modalStack.length && !_isTyping(e.target) && _sectionEl && _sectionEl.isConnected && !_sectionEl.classList.contains('hub-tm-hidden')) {
      const t = _allTags()[parseInt(e.key, 10) - 1];
      if (t) { e.preventDefault(); _setActiveTag(t.id); _toast('Brush: ' + t.label); }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {   // Ctrl+Enter saves the block dialog from anywhere inside it
      const dlg = _modalStack[_modalStack.length - 1];
      if (dlg && dlg.id === 'hub-tm-details-modal') { e.preventDefault(); _saveDetails(); return; }
    }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.isComposing && !_modalStack.length && !_isTyping(e.target) &&
        _sectionEl && _sectionEl.isConnected && !_sectionEl.classList.contains('hub-tm-hidden')) {
      const k = e.key.toLowerCase();
      if (k === 'i') { e.preventDefault(); _ibxFocus(); return; }
      if (k === 'n' || k === '/') { const q = _el('#tm-qp-input'); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
      if (_view === 'day' && (k === 'e' || k === 'c' || k === 'x' || k === 'b')) {
        const el = _kbTarget(), b = el && _blockById(el.getAttribute('data-block-id'));
        if (!b) return;
        e.preventDefault();
        if (k === 'e') _openDetails(b.id);
        else if (k === 'b') _blockToInbox(b.id);
        else if (k === 'x') _habToggleDone(b.id);
        else _bkOpenAndFocus(el, b);
        return;
      }
    }
    if (e.key === 'Escape') {
      const pop = _el('#hub-tm-add-tag-form');
      if (pop && pop.classList.contains('is-open') && !_modalStack.length) {
        e.preventDefault();
        _tagPop(false);
        const nb = _el('#hub-tm-btn-new-tag');
        if (nb) nb.focus();
        return;
      }
      if (_ibxMenuEl && !_ibxMenuEl.hidden) { e.preventDefault(); e.stopPropagation(); _ibxMenuClose(true); return; }
      if (_ibx && _ibx.active) { e.preventDefault(); _ibxEnd(); return; }
      if (_wkd && _wkd.active) { e.preventDefault(); _wkEnd(); return; }
      if (_drag && _drag.active) { e.preventDefault(); _cancelDrag(); return; }
      const top = _modalStack[_modalStack.length - 1];
      if (top) {
        e.preventDefault();
        if (top.id === 'hub-tm-confirm-modal') _closeConfirm(); else _closeModal(top);
      }
      return;
    }
    if (e.key === 'Tab' && _modalStack.length) {
      const top = _modalStack[_modalStack.length - 1];
      const f = Array.prototype.slice.call(top.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'))
        .filter(function (n) { return n.getClientRects().length > 0; });
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }

  /* ============================================================
     MODAL MANAGER  (class .is-open + focus restore + stack for Esc)
     ============================================================ */
  function _openModal(el, focusSel) {
    if (!el) return;
    _returnFocus.set(el, document.activeElement);
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    if (_modalStack.indexOf(el) === -1) _modalStack.push(el);
    const t = (focusSel && el.querySelector(focusSel)) || el.querySelector('input:not([type=hidden]), select, textarea, button');
    if (t) t.focus({ preventScroll: true });
  }
  function _closeModal(el) {
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    const i = _modalStack.indexOf(el);
    if (i > -1) _modalStack.splice(i, 1);
    if (el.id === 'hub-tm-settings-modal') _stopSample();
    if (el.id === 'hub-tm-focus-panel' && _focusTimer) { clearInterval(_focusTimer); _focusTimer = null; }
    if (el.id === 'hub-tm-timeline-drawer') { _el('#hub-tm-timeline-scrim').classList.remove('is-open'); if (_tlTimer) { clearInterval(_tlTimer); _tlTimer = null; } }
    const back = _returnFocus.get(el);
    _returnFocus.delete(el);
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  /* ============================================================
     PAINT / NAVIGATION
     ============================================================ */
  function _paint(scroll) {
    if (!_sectionEl) return;
    _syncHeader();
    _renderTags();
    _renderGrid({ animate: false, scroll: scroll !== false });
    if (_nowTimer) clearInterval(_nowTimer);
    _nowTimer = setInterval(_tick, 30000);
  }

  function _headline() {
    const d = _parseDate(_currentDate);
    if (_view === 'month') return MONTH_FULL[d.getMonth()] + ' ' + d.getFullYear();
    if (_view === 'week') {
      const mon = _weekStart(_currentDate), sun = _addDays(mon, 6);
      return 'Week of ' + _dateLabel(mon) + ' – ' + _dateLabel(sun) + ', ' + sun.getFullYear();
    }
    return (_currentDate === _todayStr() ? 'Today · ' : '') + DAY_FULL[d.getDay()] + ', ' + MONTH_FULL[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function _syncHeader() {
    const eb = _el('#hub-tm-eyebrow');
    if (eb) eb.textContent = _headline();
    const p = _el('#tm-date-picker');
    if (p) p.value = _currentDate;
    _all('.hub-tm-view-btn').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === _view)); });
    const hint = _el('#hub-tm-hint');
    if (hint) hint.classList.toggle('hub-tm-hidden', _lsGet(HINT_KEY) === '1' || _view !== 'day');
    const prev = _el('#tm-btn-prev'), next = _el('#tm-btn-next');
    const unit = _view === 'week' ? 'week' : _view === 'month' ? 'month' : 'day';
    if (prev) { prev.title = 'Previous ' + unit; prev.setAttribute('aria-label', 'Previous ' + unit); }
    if (next) { next.title = 'Next ' + unit; next.setAttribute('aria-label', 'Next ' + unit); }
  }

  function _setDate(ds, opts) {
    _currentDate = ds;
    if (opts && opts.view) { _view = opts.view; _lsSet(VIEW_KEY, _view); }
    if (opts && opts.scrollMins !== undefined) _pendingScroll = opts.scrollMins;
    _syncHeader();
    _renderGrid({ animate: true, scroll: true });
    _scheduleSave();
  }
  function _setView(v) {
    if (v !== 'day' && v !== 'week' && v !== 'month') return;
    _view = v;
    _lsSet(VIEW_KEY, v);
    _syncHeader();
    _renderGrid({ animate: true, scroll: true });
  }
  function _shift(dir) {
    const d = _parseDate(_currentDate);
    if (_view === 'week') d.setDate(d.getDate() + 7 * dir);
    else if (_view === 'month') {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + dir);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    } else d.setDate(d.getDate() + dir);
    _setDate(_dateToStr(d));
  }

  /* ============================================================
     GRID RENDERING
     ============================================================ */
  function _renderGrid(opts) {
    const hdr = _el('#hub-tm-grid-header'), body = _el('#hub-tm-grid-body');
    if (!hdr || !body) return;
    _cancelDrag();
    body.className = 'hub-tm-grid-body hub-tm-grid-body--' + _view;
    if (_view === 'week') _buildWeek(hdr, body);
    else if (_view === 'month') _buildMonth(hdr, body);
    else _buildDay(hdr, body);
    if (opts && opts.animate) { body.classList.remove('hub-tm-enter'); void body.offsetWidth; body.classList.add('hub-tm-enter'); }
    _updateSummary();
    _tick();
    _qpUpdate();
    if (!opts || opts.scroll !== false) _scrollInitial();
  }

  function _hourGutter() {
    let h = '';
    for (let i = 0; i < 24; i++) h += '<div class="hub-tm-hour-slot"><span class="hub-tm-hour-label">' + _pad(i) + ':00</span></div>';
    return '<div class="hub-tm-time-gutter" aria-hidden="true">' + h + '</div>';
  }

  /* ---- Day ---- */
  function _buildDay(hdr, body) {
    const d = _parseDate(_currentDate);
    hdr.innerHTML =
      '<div class="hub-tm-time-gutter-header"></div>' +
      '<div class="hub-tm-col-header">' +
        '<span class="hub-tm-col-day-name" id="hub-tm-col-day-name">' + DAY_FULL[d.getDay()] + '</span>' +
        '<span class="hub-tm-col-date-num" id="hub-tm-col-date-num">' + _dateLabel(d) + ', ' + d.getFullYear() + '</span>' +
        (_currentDate === _todayStr() ? '<span class="hub-tm-today-badge">Today</span>' : '') +
      '</div>';
    let slots = '';
    for (let i = 0; i < 48; i++) slots += '<div class="hub-tm-slot" data-time="' + _pad(Math.floor(i / 2)) + ':' + (i % 2 ? '30' : '00') + '"></div>';
    body.innerHTML =
      _hourGutter() +
      '<div class="hub-tm-main-col" id="hub-tm-main-col" aria-label="' + DAY_FULL[d.getDay()] + ' ' + _dateLabel(d) + '">' +
        slots +
        '<div class="hub-tm-now-indicator" id="hub-tm-now-indicator"><span class="hub-tm-now-chip"></span><span class="hub-tm-now-dot"></span><div class="hub-tm-now-line"></div></div>' +
      '</div>';
    _renderDayBlocks();
  }

  function _blockLabel(b) {
    return _tagOrFallback(b.tagId).label + ': ' + (b.title || '') + ', ' + b.startTime + ' to ' + b.endTime;
  }
  /* ---- Checklist drawer on a block (Day view) ----
     A pill on the block opens a panel with the full note + every checklist item.
     Tick items right there; press the pill again (or Esc) to roll it back up. */
  let _bkOpenIds = {};
  function _bkBaseH(b) {
    const s = _toMins(b.startTime); let e = _toMins(b.endTime);
    if (e <= s) e = Math.min(DAY_MINS, s + CREATE_DUR);
    return Math.max(18, Math.round((e - s) / 60 * HOUR_H));
  }
  function _bkKind(b, st) { return st.total || !b.subtitle ? 'checklist' : 'notes'; }
  function _bkToggleLabel(b, st, open) {
    return (st.total ? 'Checklist, ' + st.done + ' of ' + st.total + ' done. ' : (b.subtitle ? 'Notes. ' : 'Add a checklist. ')) + (open ? 'Hide' : 'Show');
  }
  function _bkFootHtml(b, st) {
    return '<button type="button" class="hub-tm-bk-btn" data-bk-edit>Edit block</button>' +
      (st.total && st.done === st.total && !b.done ? '<button type="button" class="hub-tm-bk-btn hub-tm-bk-btn--primary" data-bk-complete>Complete block</button>' : '');
  }
  function _bkPanelHtml(b, st, note) {
    let h = '<div class="hub-tm-bk-panel" id="hub-tm-bk-' + _esc(b.id) + '">';
    if (note) h += '<p class="hub-tm-bk-note">' + _esc(note) + '</p>';
    if (st.total) {
      h += '<div class="hub-tm-bk-prog" aria-hidden="true"><span style="width:' + st.pct + '%"></span></div><ul class="hub-tm-bk-list">';
      _ck(b).forEach(function (it) {
        h += '<li class="hub-tm-bk-row' + (it.done ? ' is-done' : '') + '"><label>' +
          '<input type="checkbox" data-bk-ck="' + _esc(it.id) + '"' + (it.done ? ' checked' : '') + '>' +
          '<span class="hub-tm-bk-box" aria-hidden="true"></span><span class="hub-tm-bk-txt">' + _esc(it.text) + '</span></label></li>';
      });
      h += '</ul>';
    }
    h += '<div class="hub-tm-bk-add"><span aria-hidden="true">+</span><input type="text" data-bk-new maxlength="200" autocomplete="off" placeholder="Add item — Enter · paste a list for many" aria-label="New checklist item"></div>';
    return h + '<div class="hub-tm-bk-foot">' + _bkFootHtml(b, st) + '</div></div>';
  }
  function _bkRefresh(el, b) {
    const st = _ckStats(b), t = el.querySelector('.hub-tm-bk-toggle');
    if (t) {
      const c = t.querySelector('.hub-tm-bk-count');
      if (c) c.textContent = st.done + '/' + st.total;
      t.style.setProperty('--p', st.pct + '%');
      t.classList.toggle('is-complete', st.total > 0 && st.done === st.total);
      t.setAttribute('aria-label', _bkToggleLabel(b, st, el.classList.contains('is-open')));
    }
    const bar = el.querySelector('.hub-tm-bk-prog span'); if (bar) bar.style.width = st.pct + '%';
    const foot = el.querySelector('.hub-tm-bk-foot'); if (foot) foot.innerHTML = _bkFootHtml(b, st);
  }
  /** Swap one block's element for a fresh render (keeps the drawer open via _bkOpenIds). */
  function _bkReplace(el, b) {
    const fresh = _makeBlockEl(b);
    el.replaceWith(fresh);
    _updatePast();
    return fresh;
  }
  /** Add one or many checklist items to a block from the drawer. */
  function _bkAddItems(el, b, texts) {
    const list = _ck(b); let n = 0, full = false;
    texts.forEach(function (t) {
      t = String(t).replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!t) return;
      if (list.length >= CK_MAX) { full = true; return; }
      list.push(_ckNewItem(t)); n++;
    });
    if (full) _toast('A checklist can have up to ' + CK_MAX + ' items.');
    if (!n) return false;
    _bkOpenIds[b.id] = 1;
    _scheduleSave();
    _fckSig = '';
    const fresh = _bkReplace(el, b), inp = fresh.querySelector('[data-bk-new]');
    if (inp) inp.focus({ preventScroll: true });
    try { fresh.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    _tlRefresh();
    return true;
  }
  /* Keyboard target: the block under the pointer, else the one that has focus */
  let _hoverBlockId = '';
  function _kbTarget() {
    let el = _hoverBlockId ? _el('.hub-tm-block[data-block-id="' + _hoverBlockId + '"]') : null;
    if (!el) { const a = document.activeElement; el = a && a.closest ? a.closest('.hub-tm-block') : null; }
    return el;
  }
  function _bkOpenAndFocus(el, b) {
    if (!el.classList.contains('is-open')) _bkToggle(el, b);
    const inp = el.querySelector('[data-bk-new]');
    if (inp) inp.focus({ preventScroll: true });
  }

  function _bkToggle(el, b) {
    const open = !el.classList.contains('is-open'), base = _bkBaseH(b), st = _ckStats(b);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const btn = el.querySelector('.hub-tm-bk-toggle');
    if (el._bkT) { clearTimeout(el._bkT); el._bkT = 0; }
    if (open) {
      _bkOpenIds[b.id] = 1;
      el.style.setProperty('--tm-open-h', 'auto');
      el.classList.add('is-open');
      if (!reduce) {
        const full = el.offsetHeight;                                  // natural height with the panel showing
        el.style.setProperty('--tm-open-h', base + 'px');
        void el.offsetHeight;
        el.style.setProperty('--tm-open-h', full + 'px');
        el._bkT = setTimeout(function () { el.style.setProperty('--tm-open-h', 'auto'); }, 300);
      }
      setTimeout(function () { try { el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch (_) {} }, reduce ? 0 : 280);
    } else {
      delete _bkOpenIds[b.id];
      if (reduce) { el.classList.remove('is-open'); el.style.removeProperty('--tm-open-h'); }
      else {
        el.style.setProperty('--tm-open-h', el.offsetHeight + 'px');
        void el.offsetHeight;
        el.style.setProperty('--tm-open-h', base + 'px');
        el._bkT = setTimeout(function () { el.classList.remove('is-open'); el.style.removeProperty('--tm-open-h'); }, 280);
      }
    }
    if (btn) {
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', _bkToggleLabel(b, st, open));
      btn.title = (open ? 'Hide ' : 'Show ') + _bkKind(b, st);
    }
  }

  function _makeBlockEl(b) {
    const s = _toMins(b.startTime);
    const tag = _tagOrFallback(b.tagId);
    const el = document.createElement('div');
    const note = _plainText(b.subtitle), ck = _ckStats(b);
    const hasPanel = true, empty = !ck.total && !note;
    const open = !!_bkOpenIds[b.id];
    el.className = 'hub-tm-block' + (b.done ? ' is-done' : '') + (_habIsOverdue(b) ? ' is-overdue' : '') + (open ? ' is-open' : '');
    el.setAttribute('data-block-id', b.id);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', _blockLabel(b) + '. Enter to edit, arrow keys to move, Shift plus arrows to resize, Delete to remove.');
    el.style.cssText = _tagStyle(tag) + ';top:' + Math.round(s / 60 * HOUR_H) + 'px;height:' + _bkBaseH(b) + 'px;--tm-base:' + _bkBaseH(b) + 'px';
    const toggle = hasPanel
      ? '<button type="button" class="hub-tm-bk-toggle' + (ck.total && ck.done === ck.total ? ' is-complete' : '') + (empty ? ' is-empty' : '') + '" style="--p:' + ck.pct + '%" aria-expanded="' + open + '" aria-controls="hub-tm-bk-' + _esc(b.id) + '" aria-label="' + _esc(_bkToggleLabel(b, ck, open)) + '" title="' + (open ? 'Hide ' : 'Show ') + _bkKind(b, ck) + '">' +
          (ck.total ? '<svg class="hub-tm-bk-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="hub-tm-bk-count">' + ck.done + '/' + ck.total + '</span>' : '<span class="hub-tm-bk-count">' + (note ? 'Notes' : '+ Checklist') + '</span>') +
          '<svg class="hub-tm-bk-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
      : '';
    el.innerHTML =
      '<div class="hub-tm-block-grip hub-tm-block-grip--top" aria-hidden="true"></div>' +
      '<div class="hub-tm-block-body">' +
        '<div class="hub-tm-bk-head">' +
          '<span class="hub-tm-block-time">' + _esc(b.startTime) + ' – ' + _esc(b.endTime) + '</span>' +
          toggle +
          (b.focusMs >= 60000 ? '<span class="hub-tm-block-focus" title="Time really focused on this block">&#9201; ' + _fmtDur(Math.round(b.focusMs / 60000)) + '</span>' : '') +
        '</div>' +
        '<span class="hub-tm-block-title">' + _esc(b.title || tag.label) + '</span>' +
        (note ? '<span class="hub-tm-block-note">' + _esc(note.slice(0, 160)) + '</span>' : '') +
      '</div>' +
      (hasPanel ? _bkPanelHtml(b, ck, note) : '') +
      '<div class="hub-tm-block-grip hub-tm-block-grip--bottom" aria-hidden="true"></div>' +
      '<button type="button" class="hub-tm-block-check" aria-label="Toggle complete" title="Complete (scores the Habitica To-Do)" tabindex="-1">&#10003;</button>' +
      '<button type="button" class="hub-tm-block-delete" aria-label="Delete block" title="Delete block" tabindex="-1">&times;</button>';
    return el;
  }
  function _renderDayBlocks() {
    const col = _el('#hub-tm-main-col');
    if (!col) return;
    _all('#hub-tm-main-col .hub-tm-block').forEach(function (n) { n.remove(); });
    const frag = document.createDocumentFragment();
    _blocksForDate(_currentDate).forEach(function (b) { frag.appendChild(_makeBlockEl(b)); });
    col.appendChild(frag);
    _updatePast();
  }
  function _focusBlock(id) {
    const n = _el('.hub-tm-block[data-block-id="' + id + '"]');
    if (n) n.focus({ preventScroll: true });
  }

  /* ---- Week ---- */
  function _buildWeek(hdr, body) {
    const mon = _weekStart(_currentDate), sun = _addDays(mon, 6), today = _todayStr();
    hdr.innerHTML = '<div class="hub-tm-col-header hub-tm-col-header--center"><span class="hub-tm-col-day-name">' +
      (mon.getMonth() === sun.getMonth() ? MONTH_SHORT[mon.getMonth()] + ' ' + mon.getDate() + ' – ' + sun.getDate() : _dateLabel(mon) + ' – ' + _dateLabel(sun)) +
      ', ' + sun.getFullYear() + '</span></div>';

    let head = '<div></div>', days = '';
    for (let i = 0; i < 7; i++) {
      const d = _addDays(mon, i), ds = _dateToStr(d), isToday = ds === today;
      head += '<div class="hub-tm-week-head-cell' + (isToday ? ' is-today' : '') + '" data-date="' + ds + '" data-activate role="button" tabindex="0" aria-label="Open ' + DAY_FULL[d.getDay()] + ' ' + _dateLabel(d) + '">' +
                '<span class="hub-tm-week-head-day">' + DAY_SHORT[d.getDay()] + '</span><span class="hub-tm-week-head-date">' + d.getDate() + '</span></div>';
      days += '<div class="hub-tm-week-day' + (isToday ? ' is-today' : '') + '" data-date="' + ds + '"></div>';
    }
    let lines = '';
    for (let l = 0; l < 48; l++) lines += '<div class="hub-tm-week-line"></div>';

    body.innerHTML =
      '<div class="hub-tm-week" id="hub-tm-week">' +
        '<div class="hub-tm-week-head">' + head + '</div>' +
        '<div class="hub-tm-week-body">' +
          '<div class="hub-tm-week-lines">' + lines + '</div>' +
          _hourGutter() + days +
        '</div>' +
      '</div>';
    _renderWeekBlocks();
  }
  function _renderWeekBlocks() {
    _all('.hub-tm-week-day').forEach(function (col) {
      const ds = col.getAttribute('data-date');
      _blocksForDate(ds).forEach(function (b) {
        const s = _toMins(b.startTime);
        let e = _toMins(b.endTime);
        if (e <= s) e = Math.min(DAY_MINS, s + CREATE_DUR);
        const tag = _tagOrFallback(b.tagId);
        const n = document.createElement('div');
        n.className = 'hub-tm-week-block';
        n.setAttribute('data-block-id', b.id);
        n.setAttribute('role', 'button');
        n.setAttribute('tabindex', '0');
        n.setAttribute('aria-label', _blockLabel(b));
        n.style.cssText = _tagStyle(tag) + ';top:' + Math.round(s / 60 * HOUR_H) + 'px;height:' + Math.max(18, Math.round((e - s) / 60 * HOUR_H)) + 'px';
        n.innerHTML = '<span class="hub-tm-week-block-time">' + _esc(b.startTime) + ' – ' + _esc(b.endTime) + '</span><span class="hub-tm-week-block-title">' + _esc(b.title || tag.label) + '</span>';
        col.appendChild(n);
      });
      if (ds === _todayStr()) {
        const line = document.createElement('div');
        line.className = 'hub-tm-week-now';
        col.appendChild(line);
      }
    });
  }

  /* ---- Month ---- */
  function _buildMonth(hdr, body) {
    const ref = _parseDate(_currentDate), y = ref.getFullYear(), m = ref.getMonth(), today = _todayStr();
    hdr.innerHTML = '<div class="hub-tm-col-header hub-tm-col-header--center"><span class="hub-tm-col-day-name">' + MONTH_FULL[m] + ' ' + y + '</span></div>';

    const lead = (new Date(y, m, 1).getDay() + 6) % 7;                 // Monday-first
    const dim  = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((lead + dim) / 7);
    const byDate = {};
    _timeBlocks.forEach(function (b) { (byDate[b.date] = byDate[b.date] || []).push(b); });
    const sk = _streakInfo();

    let html = '<div class="hub-tm-month"><div class="hub-tm-month-head">';
    for (let i = 1; i <= 7; i++) html += '<div class="hub-tm-month-head-cell">' + DAY_SHORT[i % 7] + '</div>';
    html += '</div>';
    for (let r = 0; r < rows; r++) {
      html += '<div class="hub-tm-month-row">';
      for (let c = 0; c < 7; c++) {
        const d = new Date(y, m, r * 7 + c - lead + 1), ds = _dateToStr(d);
        const list = (byDate[ds] || []).slice().sort(function (a, b) { return _toMins(a.startTime) - _toMins(b.startTime); });
        let chips = '', dots = '';
        list.slice(0, 3).forEach(function (b) {
          const tag = _tagOrFallback(b.tagId);
          chips += '<span class="hub-tm-month-chip" style="' + _tagStyle(tag) + '">' + _esc(b.startTime) + ' ' + _esc(b.title || tag.label) + '</span>';
        });
        list.slice(0, 6).forEach(function (b) { dots += '<span class="hub-tm-month-dot" style="' + _tagStyle(_tagOrFallback(b.tagId)) + '"></span>'; });
        const mins = list.reduce(function (s, b) { return s + Math.max(0, _toMins(b.endTime) - _toMins(b.startTime)); }, 0);
        const load = Math.min(1, mins / 480).toFixed(2);          // 8h booked = full heat
        const gold = list.reduce(function (g, b) { return g + (b.gp || 0); }, 0);
        const dst = sk.stats[ds], dstate = sk.state[ds] || _dayState(dst, ds, today);
        let dcls = '', ring = '', band = '', dlabel = '', dtip = '';
        if (dst) {
          const pct = Math.min(100, Math.round(dst.d / dst.p * 100));
          dcls = ' has-plan day-' + dstate + (pct >= 100 ? ' is-full' : '');
          ring = _ringSvg(pct);
          dlabel = ', ' + pct + '% done';
          dtip = ' title="' + dst.k + ' of ' + dst.n + ' block' + (dst.n > 1 ? 's' : '') + ' done · ' + pct + '%"';
        }
        if (sk.inRun[ds]) { dcls += ' is-streak'; band = '<i class="hub-tm-month-streak" aria-hidden="true"></i>'; dlabel += ', streak day ' + sk.runAt[ds]; }
        html += '<div class="hub-tm-month-cell' + (d.getMonth() !== m ? ' is-dim' : '') + (ds === today ? ' is-today' : '') + dcls + '" style="--tm-load:' + load + '" data-date="' + ds + '" data-activate role="button" tabindex="0" aria-label="' + DAY_FULL[d.getDay()] + ' ' + _dateLabel(d) + (list.length ? ', ' + list.length + ' block' + (list.length > 1 ? 's' : '') : '') + dlabel + '"' + dtip + '>' +
                  '<span class="hub-tm-month-num">' + d.getDate() + ring + '</span>' +
                  (mins ? '<span class="hub-tm-month-total">' + _fmtDur(mins) + (gold > 0 ? '<em class="hub-tm-month-gold">+' + _fmtGold(gold) + '</em>' : '') + '</span>' : '') +
                  '<span class="hub-tm-month-chips">' + chips + (list.length > 3 ? '<span class="hub-tm-month-more">+' + (list.length - 3) + ' more</span>' : '') + '</span>' +
                  '<span class="hub-tm-month-dots">' + dots + '</span>' + band + '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html + '</div>';
  }

  /* ============================================================
     DAY COMPLETION + STREAK
     - A day "hits" when >= STREAK_MIN (50%) of its planned minutes are checked done.
     - Days with no blocks are rest days: up to STREAK_REST_GAP in a row keep the streak.
     - Today never breaks a streak while it is still pending.
     - Derived from the blocks each time, so it follows sync and Habitica for free.
     ============================================================ */
  function _dayStats() {
    const m = {};
    _timeBlocks.forEach(function (b) {
      const mins = Math.max(0, _toMins(b.endTime) - _toMins(b.startTime));
      if (!mins) return;
      const s = m[b.date] || (m[b.date] = { p: 0, d: 0, n: 0, k: 0 });
      s.p += mins; s.n++;
      if (b.done) { s.d += mins; s.k++; }
    });
    return m;
  }
  function _dayState(s, ds, today) {
    if (!s) return 'rest';
    if (ds > today) return 'future';
    if (s.d / s.p >= STREAK_MIN) return 'hit';
    return ds === today ? 'pending' : 'miss';
  }
  function _streakInfo(dayArg) {                       // dayArg: evaluate "as of" another day (Habitica's day can start later than midnight)
    const today = dayArg || _todayStr(), stats = _dayStats(), keys = Object.keys(stats).sort();
    const out = { stats: stats, state: {}, runAt: {}, inRun: {}, cur: 0, best: 0, today: today, todayPct: 0, start: '' };
    if (!keys.length) return out;
    const end = _parseDate(today);
    let d = _parseDate(keys[0]);
    const cap = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1500);
    if (d < cap) d = cap;
    let run = 0, gap = 0, prevHit = null, runStart = '';
    while (d <= end) {
      const ds = _dateToStr(d), st = _dayState(stats[ds], ds, today);
      out.state[ds] = st;
      if (st === 'hit') {
        run++; gap = 0; if (run === 1) runStart = ds;
        if (run > out.best) out.best = run;
        out.runAt[ds] = run;
        if (run >= 2) { out.inRun[ds] = true; if (prevHit) out.inRun[prevHit] = true; }
        prevHit = ds;
      } else if (st === 'miss') { run = 0; gap = 0; prevHit = null; }
      else if (st === 'pending') { gap = 0; }
      else { gap++; if (gap > STREAK_REST_GAP) { run = 0; prevHit = null; } }
      d.setDate(d.getDate() + 1);
    }
    out.cur = run; out.start = run > 0 ? runStart : '';
    const t = stats[today];
    out.todayPct = t ? Math.round(t.d / t.p * 100) : 0;
    return out;
  }
  /** Progress ring drawn around the day number. Circle everywhere, square for the TUI skin (CSS picks). */
  function _ringSvg(pct) {
    const dash = ' pathLength=\"100\" stroke-dasharray=\"' + pct + ' 100\"';
    return '<svg class=\"hub-tm-ring\" viewBox=\"0 0 36 36\" aria-hidden=\"true\" focusable=\"false\">' +
      '<circle class=\"hub-tm-ring-track\" cx=\"18\" cy=\"18\" r=\"15.5\"/>' +
      (pct > 0 ? '<circle class=\"hub-tm-ring-arc\" cx=\"18\" cy=\"18\" r=\"15.5\"' + dash + ' transform=\"rotate(-90 18 18)\"/>' : '') +
      '<rect class=\"hub-tm-ring-sq hub-tm-ring-track\" x=\"2.5\" y=\"2.5\" width=\"31\" height=\"31\"/>' +
      (pct > 0 ? '<rect class=\"hub-tm-ring-sq hub-tm-ring-arc\" x=\"2.5\" y=\"2.5\" width=\"31\" height=\"31\"' + dash + '/>' : '') +
      '</svg>';
  }
  /* ---- Milestones: tier lookup, status-bar cells, celebration ---- */
  function _tierAt(cur) { let t = null; MS_TIERS.forEach(function (x) { if (cur >= x.n) t = x; }); return t; }
  function _streakCells(sk) {
    if (!Object.keys(sk.stats).length) return '';
    const t = _tierAt(sk.cur), nx = MS_TIERS.filter(function (x) { return x.n > sk.cur; })[0];
    const need = Math.round(STREAK_MIN * 100), st = sk.state[sk.today];
    const cell = function (cls, k, v, attr, title) { return '<span class="hub-tm-stat ' + cls + '"' + (attr || '') + (title ? ' title="' + title + '"' : '') + '><span class="hub-tm-stat-k">' + k + '</span><strong>' + v + '</strong></span>'; };
    const streak = cell('hub-tm-stat--streak' + (sk.cur > 0 ? ' is-live' : ''), 'Streak',
      ICON.flame + '<span>' + sk.cur + 'd</span>' + (t ? '<em class="hub-tm-ms-tier">' + t.name + '</em>' : ''),
      t ? ' data-tier="' + t.k + '"' : '',
      'Best ' + sk.best + ' days. A day counts when ' + need + '% of its planned time is done. Up to ' + STREAK_REST_GAP + ' empty days in a row do not break a streak.');
    const meter = '<i class="hub-tm-meter' + (st === 'hit' ? ' is-hit' : '') + '" style="--p:' + Math.min(100, sk.todayPct) + ';--t:' + need + '" aria-hidden="true"></i>';
    const today = cell('hub-tm-stat--today', 'Today', st === 'rest' ? '<span class="hub-tm-today-rest">Rest day</span>'
      : meter + (st === 'hit' ? '<span class="hub-tm-streak-ok">Done</span>' : '<span>' + sk.todayPct + '%</span>'), '', 'Needs ' + need + '% to count for the streak');
    const next = nx ? cell('hub-tm-stat--next', 'Next', nx.name + ' · ' + (nx.n - sk.cur) + 'd', ' data-tier="' + nx.k + '"', nx.n + '-day streak')
      : cell('hub-tm-stat--next', 'Tier', 'Max', ' data-tier="hell"');
    return streak + today + next + '<span class="hub-tm-pulse-sep"></span>';
  }
  function _normMs(o) {
    const r = {};
    if (!o || typeof o !== 'object') return r;
    Object.keys(o).slice(0, 300).forEach(function (k) { if (/^\d{4}-\d{2}-\d{2}\|\d{1,4}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(o[k]))) r[k] = String(o[k]); });
    return r;
  }
  function _msKeyLs() { return MS_KEY + ':' + (_dataUid || 'guest'); }
  /** Union of the account's synced map and this device's mirror, so a celebration is never repeated on another device. */
  function _loadMs(payload) { _msMap = Object.assign({}, _normMs(_lsJson(MS_KEY)), _normMs(_lsJson(_msKeyLs())), _normMs(payload && payload.milestones)); }
  /** Fires once per (streak run, milestone), on the day the streak reaches exactly that length. */
  function _msCheck(sk) {
    if (!sk.start || sk.state[sk.today] !== 'hit') return;
    const t = MS_TIERS.filter(function (x) { return x.n === sk.cur; })[0];
    if (!t) return;
    if (!_dataReady) return;                       // never decide before the account's data (and its milestone map) has loaded
    const key = sk.start + '|' + t.n;
    if (_msMap[key]) return;
    _msMap[key] = sk.today;
    _lsSet(_msKeyLs(), JSON.stringify(_msMap));
    _scheduleSave();
    setTimeout(function () { _celebrate(t); }, 450);
  }
  let _rewardTimer = null;
  function _fanfare(idx) {
    if (!_audio.enabled || !_ctx || _ctx.state !== 'running') return;
    try {
      const key = _voiceKey(), v = VOICES[key], bus = _ctx.createGain();
      bus.gain.value = _clamp(_audio.volume / 100, 0, 1);
      bus.connect(_master);
      [0, 4, 7, 12, 16, 19].slice(0, 3 + Math.min(3, idx)).forEach(function (s, k) {
        _voiceTone(key, _ctx, bus, _ctx.currentTime + 0.05 + k * 0.11, v.root * Math.pow(2, s / 12), v.dur * 1.2, 0.9);
      });
    } catch (e) {}
  }
  function _celebrate(t) {
    if (!_sectionEl || !_sectionEl.isConnected) return;
    const idx = MS_TIERS.indexOf(t), nx = MS_TIERS[idx + 1];
    let el = _el('#hub-tm-reward');
    if (!el) { el = document.createElement('div'); el.id = 'hub-tm-reward'; _sectionEl.appendChild(el); }
    let dots = '';
    for (let k = 0; k < 8 + idx * 4; k++) dots += '<i style="--a:' + Math.round(k * 360 / (8 + idx * 4)) + 'deg;--i:' + k + '"></i>';
    el.className = 'hub-tm-reward';
    el.setAttribute('data-tier', t.k);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="hub-tm-reward-badge">' + ICON.flame + '<b>' + t.n + '</b><span class="hub-tm-reward-burst" aria-hidden="true">' + dots + '</span></div>' +
      '<div class="hub-tm-reward-body">' +
        '<span class="hub-tm-reward-kicker">Milestone · ' + t.name + '</span>' +
        '<strong class="hub-tm-reward-title">' + t.n + '-day streak</strong>' +
        '<span class="hub-tm-reward-msg">' + t.msg + '</span>' +
        (nx ? '<span class="hub-tm-reward-next">Next · ' + nx.name + ' at ' + nx.n + ' days</span>' : '<span class="hub-tm-reward-next">Top tier reached</span>') +
      '</div>' +
      '<button type="button" class="hub-tm-reward-x" aria-label="Close">&times;</button>';
    const close = function () { el.classList.remove('is-visible'); if (_rewardTimer) { clearTimeout(_rewardTimer); _rewardTimer = null; } };
    el.querySelector('.hub-tm-reward-x').addEventListener('click', close);
    el.addEventListener('click', close);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('is-visible'); }); });
    _fanfare(idx);
    if (_rewardTimer) clearTimeout(_rewardTimer);
    _rewardTimer = setTimeout(close, 7000 + idx * 1000);
  }

  /* ---- Summary (planned time + tag mix for the visible range) ---- */
  function _rangeBlocks() {
    if (_view === 'day') return _blocksForDate(_currentDate);
    let from, to;
    if (_view === 'week') { const mon = _weekStart(_currentDate); from = _dateToStr(mon); to = _dateToStr(_addDays(mon, 6)); }
    else { const d = _parseDate(_currentDate); from = _dateToStr(new Date(d.getFullYear(), d.getMonth(), 1)); to = _dateToStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
    return _timeBlocks.filter(function (b) { return b.date >= from && b.date <= to; });
  }
  function _updateSummary() {
    _habChip();
    const sk = _streakInfo();
    _msCheck(sk);
    const lead = _streakCells(sk);
    const per = _tagTimes();
    _applyTagTimes(per);
    const box = _el('#hub-tm-summary');
    if (!box) return;
    const list = _rangeBlocks();
    if (!list.length) {
      box.classList.add('is-empty');
      box.innerHTML = lead + '<span class="hub-tm-summary-empty">' + (_view === 'day' ? 'Drag on the grid to plan this day' : 'Nothing planned this ' + _view) + '</span>';
      return;
    }
    box.classList.remove('is-empty');
    let total = 0;
    Object.keys(per).forEach(function (k) { total += per[k]; });
    const stat = function (k, v) { return '<span class="hub-tm-stat"><span class="hub-tm-stat-k">' + k + '</span><strong>' + v + '</strong></span>'; };
    const seg = Object.keys(per).sort(function (a, b) { return per[b] - per[a]; }).map(function (id) {
      const t = _tagOrFallback(id);
      return '<span style="' + _tagStyle(t) + ';flex:' + per[id] + '" title="' + _esc(t.label) + ' · ' + _fmtDur(per[id]) + '"></span>';
    }).join('');
    const gold = list.reduce(function (g, b) { return g + (b.gp || 0); }, 0);
    const focused = list.reduce(function (g, b) { return g + (b.focusMs || 0); }, 0);
    box.innerHTML = lead + stat('Planned', _fmtDur(total)) + (focused >= 60000 ? stat('Focused', _fmtDur(Math.round(focused / 60000))) : '') + stat('Blocks', list.length) +
      (gold > 0 ? '<span class="hub-tm-stat hub-tm-stat--gold"><span class="hub-tm-stat-k">Gold</span><strong>+' + _fmtGold(gold) + '</strong></span>' : '') +
      '<div class="hub-tm-summary-bar" aria-hidden="true">' + seg + '</div>';
  }

  /* ---- Now line / past dimming / scrolling ---- */
  function _tick() {
    if (!_sectionEl || !_sectionEl.isConnected) return;
    if (_lastToday !== _todayStr()) { _lastToday = _todayStr(); _renderGrid({ animate: false, scroll: false }); return; }
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes();
    const ind = _el('#hub-tm-now-indicator');
    if (ind) {
      const show = _currentDate === _todayStr();
      ind.style.display = show ? '' : 'none';
      if (show) {
        ind.style.top = Math.round(mins / 60 * HOUR_H) + 'px';
        const chip = ind.querySelector('.hub-tm-now-chip');
        if (chip) chip.textContent = _pad(now.getHours()) + ':' + _pad(now.getMinutes());
      }
    }
    const wn = _el('.hub-tm-week-now');
    if (wn) wn.style.top = Math.round(mins / 60 * HOUR_H) + 'px';
    _updatePast();
    _updateChip();
  }
  function _updatePast() {
    const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), isToday = _currentDate === _todayStr();
    _all('#hub-tm-main-col .hub-tm-block').forEach(function (n) {
      const b = _blockById(n.getAttribute('data-block-id'));
      n.classList.toggle('hub-tm-block--past', !!(b && isToday && _toMins(b.endTime) <= mins));
    });
  }
  function _scrollToMins(m) {
    const sc = _el('#hub-tm-grid-scroll');
    if (sc) sc.scrollTop = Math.max(0, m / 60 * HOUR_H - sc.clientHeight * 0.3);
  }
  function _scrollInitial() {
    if (_view !== 'day' && _view !== 'week') { const sc = _el('#hub-tm-grid-scroll'); if (sc) sc.scrollTop = 0; return; }
    if (_pendingScroll !== null) { const m = _pendingScroll; _pendingScroll = null; _scrollToMins(m); return; }
    const now = new Date();
    if (_view === 'week' || _currentDate === _todayStr()) { _scrollToMins(now.getHours() * 60 + now.getMinutes()); return; }
    const first = _blocksForDate(_currentDate)[0];
    _scrollToMins(first ? Math.max(0, _toMins(first.startTime) - 60) : 7 * 60);
  }

  /* ============================================================
     TAGS
     ============================================================ */
  function _tagTimes() {
    const per = {};
    _rangeBlocks().forEach(function (b) { per[b.tagId] = (per[b.tagId] || 0) + (_toMins(b.endTime) - _toMins(b.startTime)); });
    return per;
  }
  function _applyTagTimes(per) {
    _all('[data-tag-time]').forEach(function (n) {
      const m = per[n.getAttribute('data-tag-time')] || 0;
      n.textContent = m ? _fmtDur(m) : '';
    });
  }
  function _renderTags() {
    const list = _el('#hub-tm-tag-list');
    if (!list) return;
    if (!_tagById(_activeTagId)) _activeTagId = 'work';
    _ibxRender();                                  // the Inbox chips follow the tag list
    list.innerHTML = _allTags().map(function (t, i) {
      const custom = t.id.indexOf('custom-') === 0 || DEFAULT_TAGS.indexOf(t) === -1;
      const active = t.id === _activeTagId;
      const key = i < 9 ? String(i + 1) : '';
      return '<span class="hub-tm-tag-item' + (active ? ' is-active' : '') + '" style="' + _tagStyle(t) + '" data-tag-id="' + _esc(t.id) + '">' +
               '<button type="button" class="hub-tm-tag" data-tag-id="' + _esc(t.id) + '" aria-pressed="' + active + '"' + (key ? ' aria-keyshortcuts="' + key + '" title="Paint with ' + _esc(t.label) + ' (press ' + key + ')"' : '') + '>' +
                 '<span class="hub-tm-tag-dot"></span><span class="hub-tm-tag-name">' + _esc(t.label) + '</span>' +
                 '<span class="hub-tm-tag-time" data-tag-time="' + _esc(t.id) + '"></span>' +
                 (key ? '<kbd class="hub-tm-tag-key" aria-hidden="true">' + key + '</kbd>' : '') +
               '</button>' +
               (custom ? '<button type="button" class="hub-tm-tag-delete" data-del-tag="' + _esc(t.id) + '" aria-label="Remove tag ' + _esc(t.label) + '" title="Remove tag">&times;</button>' : '') +
             '</span>';
    }).join('');
    _applyTagTimes(_tagTimes());
  }
  function _setActiveTag(id) {
    _activeTagId = id;
    _renderTags();
    _scheduleSave();
  }
  function _onTagClick(e) {
    const del = e.target.closest('[data-del-tag]');
    if (del) { _deleteTag(del.getAttribute('data-del-tag')); return; }
    const t = e.target.closest('.hub-tm-tag');
    if (t) _setActiveTag(t.getAttribute('data-tag-id'));
  }
  function _onAddTag(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.querySelector('#hub-tm-add-tag-name').value.trim();
    if (!name) { form.querySelector('#hub-tm-add-tag-name').focus(); return; }
    if (_customTags.length >= MAX_CUSTOM_TAGS) { _toast('You can have up to ' + MAX_CUSTOM_TAGS + ' custom tags.'); return; }
    if (_allTags().some(function (t) { return t.label.toLowerCase() === name.toLowerCase(); })) { _toast('A tag named “' + name + '” already exists.'); return; }
    const tag = {
      id: 'custom-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      label: name.slice(0, 20),
      color: _safeColor(form.querySelector('#hub-tm-add-tag-color').value),
      opacity: _clamp(parseInt(form.querySelector('#hub-tm-add-tag-opacity').value, 10) || 85, 20, 100)
    };
    _customTags.push(tag);
    form.querySelector('#hub-tm-add-tag-name').value = '';
    form.querySelector('#hub-tm-add-tag-color').value = '#00bcd4';
    form.querySelector('#hub-tm-add-tag-opacity').value = '85';
    _setActiveTag(tag.id);
    _tagPop(false);
    _toast('Tag “' + tag.label + '” created — now painting with it');
  }
  function _tagPop(open) {
    const pop = _el('#hub-tm-add-tag-form'), btn = _el('#hub-tm-btn-new-tag');
    if (!pop || !btn) return;
    pop.classList.toggle('is-open', !!open);
    btn.setAttribute('aria-expanded', String(!!open));
    if (open) { _syncTagPop(); const n = _el('#hub-tm-add-tag-name'); if (n) n.focus({ preventScroll: true }); }
  }
  function _syncTagPop() {
    const col = _safeColor(_el('#hub-tm-add-tag-color').value);
    const op = _clamp(parseInt(_el('#hub-tm-add-tag-opacity').value, 10) || 85, 20, 100);
    _el('#hub-tm-pop-preview').style.cssText = _tagStyle({ color: col, opacity: op });
    _el('#hub-tm-pop-preview-name').textContent = _el('#hub-tm-add-tag-name').value.trim() || 'New tag';
    _el('#hub-tm-add-tag-opacity-out').textContent = op + '%';
    _all('#hub-tm-swatches [data-color]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-color').toLowerCase() === String(col).toLowerCase())); });
  }
  function _bindTagPop() {
    _el('#hub-tm-btn-new-tag').addEventListener('click', function () { _tagPop(!_el('#hub-tm-add-tag-form').classList.contains('is-open')); });
    _el('#hub-tm-pop-close').addEventListener('click', function () { _tagPop(false); _el('#hub-tm-btn-new-tag').focus(); });
    _el('#hub-tm-swatches').addEventListener('click', function (e) {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      _el('#hub-tm-add-tag-color').value = b.getAttribute('data-color');
      _syncTagPop();
    });
    ['#hub-tm-add-tag-name', '#hub-tm-add-tag-color', '#hub-tm-add-tag-opacity'].forEach(function (sel) { _el(sel).addEventListener('input', _syncTagPop); });
    document.addEventListener('pointerdown', function (e) {
      const pop = _el('#hub-tm-add-tag-form');
      if (!pop || !pop.classList.contains('is-open')) return;
      if (e.target.closest('#hub-tm-add-tag-form, #hub-tm-btn-new-tag')) return;
      _tagPop(false);
    }, { signal: _ui.signal });
  }
  function _deleteTag(id) {
    const tag = _tagById(id);
    if (!tag) return;
    const used = _timeBlocks.filter(function (b) { return b.tagId === id; }).length;
    const run = function () {
      _customTags = _customTags.filter(function (t) { return t.id !== id; });
      _timeBlocks.forEach(function (b) { if (b.tagId === id) b.tagId = 'work'; });
      _inbox.forEach(function (i) { if (i.tagId === id) i.tagId = 'work'; });
      if (_activeTagId === id) _activeTagId = 'work';
      _scheduleSave();
      _renderTags();
      _renderGrid({ animate: false, scroll: false });
    };
    if (!used) { run(); return; }
    _confirm('Remove tag “' + tag.label + '”? ' + used + ' block' + (used > 1 ? 's' : '') + ' using it will become Work.', run, { title: 'Remove tag?', label: 'Remove' });
  }

  /* ============================================================
     GRID POINTER INTERACTION  (create / move / resize)
     Mouse & pen start on a small movement; touch needs a long-press,
     so the grid still scrolls normally with one finger.
     ============================================================ */
  function _bindGrid(scroll) {
    const sig = { signal: _ui.signal };
    scroll.addEventListener('pointerdown', _onPointerDown, sig);
    scroll.addEventListener('pointermove', _onPointerMove, sig);
    scroll.addEventListener('pointerup', _onPointerUp, sig);
    scroll.addEventListener('pointercancel', function () { _cancelDrag(); }, sig);
    scroll.addEventListener('touchmove', function (e) { if (((_drag && _drag.active) || (_wkd && _wkd.active)) && e.cancelable) e.preventDefault(); }, { passive: false, signal: _ui.signal });
    scroll.addEventListener('contextmenu', function (e) { if (_drag || _wkd) e.preventDefault(); }, sig);
    scroll.addEventListener('click', _onGridClick, sig);
    scroll.addEventListener('change', _onGridChange, sig);
    scroll.addEventListener('mouseover', function (e) { const bl = e.target.closest && e.target.closest('.hub-tm-block'); _hoverBlockId = bl ? bl.getAttribute('data-block-id') : ''; }, sig);
    scroll.addEventListener('mouseleave', function () { _hoverBlockId = ''; }, sig);
    scroll.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('hub-tm-block')) _hoverBlockId = ''; }, sig);
    scroll.addEventListener('paste', function (e) {                 // paste a list into the drawer → one item per line
      const t = e.target;
      if (!t.hasAttribute || !t.hasAttribute('data-bk-new')) return;
      const txt = ((e.clipboardData || window.clipboardData).getData('text') || '').trim();
      if (!/\r?\n/.test(txt)) return;
      const el = t.closest('.hub-tm-block'), b = el && _blockById(el.getAttribute('data-block-id'));
      if (!b) return;
      e.preventDefault();
      _bkAddItems(el, b, txt.split(/\r?\n/));
    }, sig);
    scroll.addEventListener('keydown', _onGridKey, sig);
  }

  function _mainCol() { return _el('#hub-tm-main-col'); }
  function _yToMins(y) {
    const col = _mainCol();
    if (!col) return 0;
    return _clamp((y - col.getBoundingClientRect().top) / HOUR_H * 60, 0, DAY_MINS);
  }

  function _onPointerDown(e) {
    if (_view === 'week') { _wkDown(e); return; }
    if (_view !== 'day' || _drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.target.closest('.hub-tm-main-col') || e.target.closest('.hub-tm-block-delete') || e.target.closest('.hub-tm-block-check') || e.target.closest('.hub-tm-bk-toggle') || e.target.closest('.hub-tm-bk-panel')) return;
    const blockEl = e.target.closest('.hub-tm-block');
    if (blockEl && blockEl.classList.contains('is-open')) return;     // roll the checklist up first, then move / resize
    const block = blockEl ? _blockById(blockEl.getAttribute('data-block-id')) : null;
    if (blockEl && !block) return;
    const grip = e.target.closest('.hub-tm-block-grip');
    const raw = _yToMins(e.clientY);
    const d = {
      mode: !block ? 'create' : grip ? (grip.classList.contains('hub-tm-block-grip--top') ? 'resize-top' : 'resize-bottom') : 'move',
      pointerId: e.pointerId, pointerType: e.pointerType,
      x0: e.clientX, y0: e.clientY, lastY: e.clientY, lastX: e.clientX,
      raw0: raw, block: block, el: blockEl,
      orig: block ? { s: _toMins(block.startTime), e: _toMins(block.endTime) } : null,
      bounds: null, active: false, timer: null, scrollTimer: null, ghost: null, cur: null
    };
    if (!block) {
      d.bounds = _freeBounds(_currentDate, raw);
      if (d.bounds[1] - d.bounds[0] < MIN_DUR) return;           // pressed on a gap that is too small
    } else d.bounds = _neighbourBounds(block);
    _drag = d;
    if (e.pointerType === 'touch') {
      if (grip) { _drag = null; return; }                           // handles are mouse-only; touch edits times in the dialog
      d.timer = setTimeout(function () {
        if (_drag !== d) return;
        d.active = true;
        _beginDrag();
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      }, LONG_PRESS);
    }
  }

  function _onPointerMove(e) {
    if (_wkd) { _wkMove(e); return; }
    const d = _drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY; d.lastX = e.clientX;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.pointerType === 'touch') { if (dist > 8) _clearDrag(); return; }    // finger is scrolling
      if (dist < 4) return;
      d.active = true;
      _beginDrag();
    }
    _applyDragAt(e.clientY);
    _ensureAutoScroll();
  }

  function _beginDrag() {
    const d = _drag;
    if (!d) return;
    try { _el('#hub-tm-grid-scroll').setPointerCapture(d.pointerId); } catch (_) {}
    if (d.mode === 'create') {
      const tag = _tagOrFallback(_activeTagId);
      const g = document.createElement('div');
      g.className = 'hub-tm-block hub-tm-block--ghost';
      g.style.cssText = _tagStyle(tag);
      g.innerHTML = '<div class="hub-tm-block-body"><span class="hub-tm-block-time"></span><span class="hub-tm-block-title">' + _esc(tag.label) + '</span></div>';
      _mainCol().appendChild(g);
      d.ghost = g;
    } else {
      d.el.classList.add('hub-tm-block--busy');
      if (d.mode === 'move') _sectionEl.classList.add('is-blk-drag');
    }
    _dgOpen(d);
    _applyDragAt(d.lastY);
  }

  /* ── Drag HUD: snap rules, free-lane, origin outline and a live readout ── */
  const DG_VERB = { create: 'New', move: 'Move', 'resize-top': 'Start', 'resize-bottom': 'End' };
  function _dgOpen(d) {
    const col = _mainCol();
    if (!col) return;
    const tag = d.mode === 'create' ? _tagOrFallback(_activeTagId) : _tagOrFallback(d.block.tagId);
    const h = document.createElement('div');
    h.className = 'hub-tm-dg';
    h.setAttribute('aria-hidden', 'true');
    h.setAttribute('data-mode', d.mode);
    h.style.cssText = _tagStyle(tag);
    h.innerHTML =
      '<i class="hub-tm-dg-lane"></i>' +
      (d.orig ? '<i class="hub-tm-dg-orig"></i>' : '') +
      '<i class="hub-tm-dg-line hub-tm-dg-line--s"><b></b></i>' +
      '<i class="hub-tm-dg-line hub-tm-dg-line--e"><b></b></i>' +
      '<div class="hub-tm-dg-tip"><span class="hub-tm-dg-verb"></span><span class="hub-tm-dg-range"></span><span class="hub-tm-dg-dur"></span></div>';
    col.appendChild(h);
    col.classList.add('is-dragging');
    col.setAttribute('data-drag', d.mode);
    d.hud = h;
    const lane = h.querySelector('.hub-tm-dg-lane');
    lane.style.top = Math.round(d.bounds[0] / 60 * HOUR_H) + 'px';
    lane.style.height = Math.round((d.bounds[1] - d.bounds[0]) / 60 * HOUR_H) + 'px';
    if (d.orig) {
      const o = h.querySelector('.hub-tm-dg-orig');
      o.style.top = Math.round(d.orig.s / 60 * HOUR_H) + 'px';
      o.style.height = Math.max(18, Math.round((d.orig.e - d.orig.s) / 60 * HOUR_H)) + 'px';
    }
  }
  function _dgUpdate(d, s, e, limited) {
    const h = d.hud;
    if (!h) return;
    const ls = h.querySelector('.hub-tm-dg-line--s'), le = h.querySelector('.hub-tm-dg-line--e'), tip = h.querySelector('.hub-tm-dg-tip');
    ls.style.top = Math.round(s / 60 * HOUR_H) + 'px';
    le.style.top = Math.round(e / 60 * HOUR_H) + 'px';
    ls.firstChild.textContent = _toTime(s);
    le.firstChild.textContent = e >= DAY_MINS ? '24:00' : _toTime(e);
    h.classList.toggle('is-limit', !!limited);
    const below = s < 75;                                           // no room above → hang the readout under the block
    h.classList.toggle('is-below', below);
    tip.style.top = Math.round((below ? e : s) / 60 * HOUR_H) + 'px';
    let verb = DG_VERB[d.mode];
    if (limited) verb = 'Limit';
    else if (d.mode === 'move' && d.orig) {
      const dm = s - d.orig.s;
      verb = dm ? (dm > 0 ? '+' : '−') + _fmtDur(Math.abs(dm)) : 'Move';
    }
    tip.querySelector('.hub-tm-dg-verb').textContent = verb;
    tip.querySelector('.hub-tm-dg-range').textContent = _toTime(s) + ' – ' + (e >= DAY_MINS ? '24:00' : _toTime(e));
    tip.querySelector('.hub-tm-dg-dur').textContent = _fmtDur(e - s);
  }
  function _dgClose(d) {
    if (d.hud && d.hud.parentNode) d.hud.parentNode.removeChild(d.hud);
    d.hud = null;
    const col = _mainCol();
    if (col) { col.classList.remove('is-dragging'); col.removeAttribute('data-drag'); }
  }
  function _dropFx(id) {
    const n = _el('.hub-tm-block[data-block-id="' + id + '"]');
    if (!n) return;
    n.classList.add('hub-tm-block--drop');
    setTimeout(function () { n.classList.remove('hub-tm-block--drop'); }, 650);
  }

  /* ── drag: grid block → Inbox (Day + Week) ── */
  /** The Inbox (open panel, the closed-Inbox drop dock, or the toolbar button) under the pointer, or null. */
  function _dgInboxTarget(x, y) {
    if (x == null || !_sectionEl) return null;
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    const box = el.closest('#hub-tm-inbox.is-open, #hub-tm-ibx-dock, #tm-btn-inbox');
    return box && _sectionEl.contains(box) ? box : null;
  }
  /** Highlights the drop target and moves the little label that follows the pointer. Returns the target (or null). */
  function _bdUpdate(s, b, x, y) {
    const t = _dgInboxTarget(x, y);
    if (s.bover !== t) {
      if (s.bover) s.bover.classList.remove('is-ibx-drop');
      if (t) t.classList.add('is-ibx-drop');
      s.bover = t;
    }
    if (t && !s.bchip) {
      const tag = _tagOrFallback(b.tagId), g = document.createElement('div');
      g.className = 'hub-tm-ibx-ghost hub-tm-ibx-ghost--blk';
      g.setAttribute('aria-hidden', 'true');
      g.style.cssText = _tagStyle(tag);
      g.innerHTML = '<span class="hub-tm-ibx-ghost-t"></span><span class="hub-tm-ibx-ghost-d">' + _fmtDur(_toMins(b.endTime) - _toMins(b.startTime)) + '</span>';
      g.firstChild.textContent = b.title || tag.label;
      _sectionEl.appendChild(g);
      s.bchip = g;
    } else if (!t && s.bchip) {
      if (s.bchip.parentNode) s.bchip.parentNode.removeChild(s.bchip);
      s.bchip = null;
    }
    if (s.bchip) {
      s.bchip.style.transform = 'translate(' + Math.round(x + 14) + 'px,' + Math.round(y + 10) + 'px)';
      s.bchip.classList.toggle('is-no', !!b.done || _inbox.length >= IBX_MAX);
    }
    return t;
  }
  function _bdClear(s) {
    if (s.bover) s.bover.classList.remove('is-ibx-drop');
    if (s.bchip && s.bchip.parentNode) s.bchip.parentNode.removeChild(s.bchip);
    s.bover = null; s.bchip = null;
  }
  /** While over the Inbox the block rests where it came from (dimmed) and the time HUD steps aside. */
  function _dgInboxRest(d, on) {
    if (!!d.rest === !!on) return;
    d.rest = !!on;
    d.el.classList.toggle('hub-tm-block--ibx', !!on);
    if (d.hud) d.hud.style.display = on ? 'none' : '';
    if (on) {
      d.cur = null;
      d.el.style.top = Math.round(d.orig.s / 60 * HOUR_H) + 'px';
      d.el.style.height = Math.max(18, Math.round((d.orig.e - d.orig.s) / 60 * HOUR_H)) + 'px';
      const lbl = d.el.querySelector('.hub-tm-block-time');
      if (lbl) lbl.textContent = _toTime(d.orig.s) + ' – ' + _toTime(d.orig.e);
    }
  }

  /* Week view: a block can only go back to the Inbox (no moving inside the week) */
  function _wkDown(e) {
    if (_wkd || _drag || _ibx) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target.closest && e.target.closest('.hub-tm-week-block');
    if (!el) return;
    const b = _blockById(el.getAttribute('data-block-id'));
    if (!b) return;
    const w = { el: el, block: b, pointerId: e.pointerId, pointerType: e.pointerType, x0: e.clientX, y0: e.clientY, active: false, timer: null, bover: null, bchip: null };
    _wkd = w;
    if (e.pointerType === 'touch') {
      w.timer = setTimeout(function () {
        if (_wkd !== w) return;
        w.active = true; _wkBegin();
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      }, LONG_PRESS);
    }
  }
  function _wkBegin() {
    const w = _wkd;
    if (!w) return;
    try { _el('#hub-tm-grid-scroll').setPointerCapture(w.pointerId); } catch (_) {}
    w.el.classList.add('hub-tm-block--busy');
    _sectionEl.classList.add('is-blk-drag');
  }
  function _wkMove(e) {
    const w = _wkd;
    if (!w || e.pointerId !== w.pointerId) return;
    if (!w.active) {
      const dist = Math.hypot(e.clientX - w.x0, e.clientY - w.y0);
      if (w.pointerType === 'touch') { if (dist > 8) _wkEnd(); return; }
      if (dist < 4) return;
      w.active = true; _wkBegin();
    }
    _bdUpdate(w, w.block, e.clientX, e.clientY);
  }
  function _wkUp(e) {
    const w = _wkd;
    if (!w || e.pointerId !== w.pointerId) return;
    const hit = w.active && !!w.bover, id = w.block.id, was = w.active;
    _wkEnd();
    if (was) _suppressClickUntil = performance.now() + 350;
    if (hit) _blockToInbox(id);
  }
  function _wkEnd() {
    const w = _wkd;
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    _bdClear(w);
    w.el.classList.remove('hub-tm-block--busy');
    if (_sectionEl) _sectionEl.classList.remove('is-blk-drag');
    try { _el('#hub-tm-grid-scroll').releasePointerCapture(w.pointerId); } catch (_) {}
    _wkd = null;
  }

  function _applyDragAt(clientY) {
    const d = _drag;
    if (!d || !d.active) return;
    const m = _yToMins(clientY);
    let s, e, limited = false;
    if (d.mode === 'create') {
      const lo = Math.min(d.raw0, m), hi = Math.max(d.raw0, m);
      s = _snap(lo, 'down'); e = _snap(hi, 'up');
      if (e - s < CREATE_DUR) e = s + CREATE_DUR;
      const ws = s, we = e;
      s = _clamp(s, d.bounds[0], d.bounds[1] - MIN_DUR);
      e = _clamp(e, s + MIN_DUR, d.bounds[1]);
      limited = ws < s || we > e;
    } else if (d.mode === 'move') {
      const dur = d.orig.e - d.orig.s;
      const ws = d.orig.s + _snap(m - d.raw0, 'round');
      s = _clamp(ws, d.bounds[0], d.bounds[1] - dur);
      e = s + dur;
      limited = ws !== s;
    } else if (d.mode === 'resize-bottom') {
      s = d.orig.s;
      const we = _snap(m, 'round');
      e = _clamp(we, d.orig.s + MIN_DUR, d.bounds[1]);
      limited = we > e;
    } else {
      e = d.orig.e;
      const ws = _snap(m, 'round');
      s = _clamp(ws, d.bounds[0], d.orig.e - MIN_DUR);
      limited = ws < s;
    }
    if (d.mode === 'move') {
      const over = _bdUpdate(d, d.block, d.lastX, clientY);
      if (over) { _dgInboxRest(d, true); return; }
      if (d.rest) _dgInboxRest(d, false);
    }
    d.cur = { s: s, e: e };
    _dgUpdate(d, s, e, limited);
    const n = d.mode === 'create' ? d.ghost : d.el;
    if (!n) return;
    n.style.top = Math.round(s / 60 * HOUR_H) + 'px';
    n.style.height = Math.max(18, Math.round((e - s) / 60 * HOUR_H)) + 'px';
    const lbl = n.querySelector('.hub-tm-block-time');
    if (lbl) lbl.textContent = _toTime(s) + ' – ' + _toTime(e);
  }

  function _ensureAutoScroll() {
    const d = _drag;
    if (!d || d.scrollTimer) return;
    d.scrollTimer = setInterval(function () {
      if (_drag !== d) return;
      const sc = _el('#hub-tm-grid-scroll');
      if (!sc) return;
      const r = sc.getBoundingClientRect(), edge = 56, y = d.lastY;
      let dy = 0;
      if (y < r.top + edge) dy = -Math.ceil((r.top + edge - y) / 6);
      else if (y > r.bottom - edge) dy = Math.ceil((y - (r.bottom - edge)) / 6);
      if (d.rest) return;
      if (dy) { sc.scrollTop += _clamp(dy, -18, 18); _applyDragAt(y); }
    }, 16);
  }

  function _clearDrag() {
    const d = _drag;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (d.scrollTimer) clearInterval(d.scrollTimer);
    _bdClear(d);
    if (_sectionEl) _sectionEl.classList.remove('is-blk-drag');
    _dgClose(d);
    try { _el('#hub-tm-grid-scroll').releasePointerCapture(d.pointerId); } catch (_) {}
    _drag = null;
  }
  function _cancelDrag() {
    _wkEnd();
    const d = _drag;
    if (!d) return;
    const wasActive = d.active;
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.el) d.el.classList.remove('hub-tm-block--busy', 'hub-tm-block--ibx');
    _wkEnd();
    _clearDrag();
    if (wasActive) { _suppressClickUntil = performance.now() + 350; _renderDayBlocks(); }
  }

  function _onPointerUp(e) {
    if (_wkd) { _wkUp(e); return; }
    const d = _drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.active && d.rest && d.block) {
      const id = d.block.id;
      _suppressClickUntil = performance.now() + 350;
      d.el.classList.remove('hub-tm-block--busy', 'hub-tm-block--ibx');
      _clearDrag();
      _renderDayBlocks();
      _blockToInbox(id);
      return;
    }
    if (d.active && d.cur) {
      _suppressClickUntil = performance.now() + 350;
      if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
      const cur = d.cur, mode = d.mode, block = d.block, orig = d.orig;
      _clearDrag();
      if (mode === 'create') _addBlock(cur.s, cur.e);
      else {
        if (cur.s !== orig.s || cur.e !== orig.e) {
          block.startTime = _toTime(cur.s);
          block.endTime = _toTime(cur.e);
          _scheduleSave();
          _updateSummary();
        }
        _renderDayBlocks();
        _focusBlock(block.id);
        _dropFx(block.id);
      }
      return;
    }
    // Plain click / tap
    const mode = d.mode, raw = d.raw0, wasTouch = d.pointerType === 'touch';
    _clearDrag();
    if (mode === 'create' && !wasTouch) {
      _suppressClickUntil = performance.now() + 250;
      const b = _freeBounds(_currentDate, raw);
      let s = _snap(raw, 'down');
      s = _clamp(s, b[0], Math.max(b[0], b[1] - MIN_DUR));
      const end = Math.min(s + CREATE_DUR, b[1]);
      if (end - s >= MIN_DUR) _addBlock(s, end);
    }
    // click on a block falls through to the 'click' handler → opens details
  }

  function _addBlock(s, e) {
    const tag = _tagOrFallback(_activeTagId);
    const b = {
      id: _newId(), date: _currentDate, tagId: tag.id === FALLBACK_TAG.id ? 'work' : tag.id,
      startTime: _toTime(s), endTime: _toTime(e), title: tag.label, subtitle: '', createdAt: Date.now()
    };
    _timeBlocks.push(b);
    _scheduleSave();
    _renderDayBlocks();
    _updateSummary();
    _focusBlock(b.id);
    _dropFx(b.id);
    return b;
  }

  /* ============================================================
     INBOX / BACKLOG  ·  capture first, schedule later
     Tasks that have no time yet. They are NOT blocks, so they never reach
     Habitica, the streak, the review or the alarms until you place them.
     Place = drag onto the Day grid (or onto a day in Week / Month),
     or press the arrow = next free slot. A block can come back via "To Inbox".
     Sync: own list + own tombstones (merged by updatedAt, like blocks) and a
     per-account local mirror, so nothing is lost even if the cloud ignores it.
     ============================================================ */
  function _ibxById(id) { for (let i = 0; i < _inbox.length; i++) if (_inbox[i].id === id) return _inbox[i]; return null; }
  function _ibxSort() { _inbox.sort(function (a, b) { return (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1); }); }
  function _ibxNewId(k) { return 'ibx-' + Date.now() + '-' + (k || 0) + '-' + Math.floor(Math.random() * 100000); }

  /* ── persistence helpers ── */
  function _ibxLsKey() { return INBOX_KEY + ':' + (_dataUid || 'guest'); }
  function _ibxSaveLs() { _lsSet(_ibxLsKey(), JSON.stringify({ inbox: _inbox, tombs: { inbox: _tombs.inbox || {} } })); }
  /** Merge two Inbox states by updatedAt; a tombstone newer than an item's last edit wins. */
  function _ibxMerge(list, tomb, other) {
    other = other || {};
    const ol = Array.isArray(other.inbox) ? other.inbox.map(_normInbox).filter(Boolean) : [];
    const ot = (other.tombs && other.tombs.inbox) || {}, t = {};
    [tomb, ot].forEach(function (m) {
      Object.keys(m || {}).forEach(function (id) { const n = Number(m[id]); if (n > 0 && n > (t[id] || 0)) t[id] = n; });
    });
    const by = {};
    list.concat(ol).forEach(function (it) { const c = by[it.id]; if (!c || it.updatedAt > c.updatedAt) by[it.id] = it; });
    const out = Object.keys(by).map(function (k) { return by[k]; }).filter(function (it) { return !(t[it.id] && t[it.id] >= it.updatedAt); });
    out.sort(function (a, b) { return (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1); });
    return { list: out, tomb: t };
  }
  function _ibxLoad(payload) {
    const mine = payload && Array.isArray(payload.inbox) ? payload.inbox.map(_normInbox).filter(Boolean) : [];
    const m = _ibxMerge(mine, payload && payload.tombs && payload.tombs.inbox, _lsJson(_ibxLsKey()));
    _inbox = m.list;
    _tombs.inbox = m.tomb;
  }

  /* ── capture ── */
  /** "Call dentist 15m #personal"  →  title, tag, length. Unspecified tag / length are learned from history, like Quick plan. */
  function _ibxParse(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim().replace(QP_BULLET, '');
    if (!s) return null;
    const orig = s;
    let tag = null, dur = 0, pri = 'normal';
    s = s.replace(/(^|\s)!(high|cao|low|thap|thấp)(?=\s|$)/i, function (m, sp, w) {
      pri = /^(high|cao)$/i.test(w) ? 'high' : 'low';
      return sp;
    });
    s = s.replace(/(^|\s)#([^\s#]+)/, function (m, sp, w) {
      const k = _qpPlain(w), t = _allTags().filter(function (x) { return _qpPlain(x.label) === k || x.id === w.toLowerCase(); })[0];
      if (!t) return m;
      tag = t;
      return sp;
    });
    s = s.replace(/(^|\s)(\d{1,2}(?:[.,]\d)?)\s?(?:h|g|gio|giờ)(?=\s|$)/i, function (m, sp, n) {
      dur = Math.round(parseFloat(String(n).replace(',', '.')) * 60);
      return sp;
    });
    if (!dur) s = s.replace(/(^|\s)(\d{1,3})\s?(?:p|ph|phut|phút|m|min)(?=\s|$)/i, function (m, sp, n) { dur = parseInt(n, 10); return sp; });
    s = s.replace(/\s+/g, ' ').trim();
    if (!s && (tag || dur || pri !== 'normal')) return null;       // only a #tag / length / priority, no task
    const title = (s || orig).slice(0, 120);
    let hist = null;
    try { hist = _qpHist(); } catch (_) {}
    const hit = hist && hist.map[_qpPlain(title)];
    let t = tag;
    if (!t && hit && hit.tagId) t = _tagById(hit.tagId);
    t = t || _tagOrFallback(_activeTagId);
    const tagId = t.id === FALLBACK_TAG.id ? 'work' : t.id;
    if (!dur) dur = (hit && hit.dur) || (hist && hist.tagDur[tagId]) || CREATE_DUR;
    return { title: title, tagId: tagId, pri: pri, dur: _clamp(Math.round(dur / SNAP) * SNAP, MIN_DUR, 480) };
  }
  function _ibxAddMany(lines) {
    const now = Date.now();
    let n = 0, last = null, full = false;
    lines.forEach(function (ln) {
      if (_inbox.length >= IBX_MAX) { full = true; return; }
      const p = _ibxParse(ln);
      if (!p) return;
      const it = _normInbox({ id: _ibxNewId(n), title: p.title, tagId: p.tagId, pri: p.pri, dur: p.dur, createdAt: now + n });
      if (!it) return;
      _inbox.push(it);
      last = it;
      n++;
    });
    if (full) _toast('Inbox is full (' + IBX_MAX + '). Place or clear something first.');
    if (!n) return 0;
    _ibxSort();
    _scheduleSave();
    _ibxRender(true);
    const list = _el('#tm-ibx-list');
    if (list) list.scrollTop = 0;
    const el = last && _el('.hub-tm-ibx-item[data-ibx-id="' + last.id + '"]');
    if (el) { el.classList.add('is-new'); setTimeout(function () { el.classList.remove('is-new'); }, 700); }
    return n;
  }

  /* ── render ── */
  /** Display order: High → Normal → Low, newest first inside each level. (`_inbox` itself stays in creation order for sync.) */
  function _ibxView() {
    return _inbox.slice().sort(function (a, b) {
      return (IBX_PRI.indexOf(a.pri) - IBX_PRI.indexOf(b.pri)) || (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : -1);
    });
  }
  function _ibxPriHtml(pri) {
    return '<i class="hub-tm-ibx-pri-g" aria-hidden="true"><b></b><b></b><b></b></i><span class="hub-tm-ibx-pri-t">' + IBX_PRI_LABEL[pri] + '</span>';
  }
  function _ibxItemHtml(it) {
    const tg = _tagOrFallback(it.tagId), pri = it.pri || 'normal';
    return '<li class="hub-tm-ibx-item" data-ibx-id="' + _esc(it.id) + '" data-pri="' + pri + '" style="' + _tagStyle(tg) + '">' +
      '<div class="hub-tm-ibx-main">' +
        '<div class="hub-tm-ibx-top">' +
          '<span class="hub-tm-ibx-title" data-ibx-title tabindex="0" role="button" aria-label="Rename: ' + _esc(it.title) + '">' + _esc(it.title) + '</span>' +
          '<button type="button" class="hub-tm-ibx-more" data-ibx-more aria-haspopup="menu" aria-expanded="false" title="More" aria-label="Options: ' + _esc(it.title) + '"><i aria-hidden="true"></i></button>' +
        '</div>' +
        '<div class="hub-tm-ibx-meta">' +
          '<div class="hub-tm-ibx-chips">' +
          '<button type="button" class="hub-tm-ibx-chip hub-tm-ibx-chip--tag" data-ibx-tag title="Change tag"><i class="hub-tm-ibx-dot"></i>' + _esc(tg.label) + '</button>' +
          '<button type="button" class="hub-tm-ibx-chip hub-tm-ibx-chip--dur" data-ibx-dur title="Change length">' + _fmtDur(it.dur) + '</button>' +
          '<button type="button" class="hub-tm-ibx-chip hub-tm-ibx-chip--pri" data-ibx-pri title="Priority: ' + IBX_PRI_LABEL[pri] + ' (click to change)" aria-label="Priority: ' + IBX_PRI_LABEL[pri] + '">' + _ibxPriHtml(pri) + '</button>' +
          (it.ck.length ? '<span class="hub-tm-ibx-note">' + it.ck.length + ' item' + (it.ck.length > 1 ? 's' : '') + '</span>' : '') +
          '</div>' +
          '<button type="button" class="hub-tm-ibx-act hub-tm-ibx-go" data-ibx-go title="Put it in the next free slot" aria-label="Schedule in the next free slot: ' + _esc(it.title) + '">' + TL_ICON.fwd + '</button>' +
        '</div>' +
      '</div>' +
    '</li>';
  }
  function _ibxRender(force) {
    const list = _el('#tm-ibx-list');
    if (!list) return;
    if (_ibx && _ibx.active) return;                                      // never swap the DOM under a drag
    const n = _inbox.length, mins = _inbox.reduce(function (a, i) { return a + i.dur; }, 0);
    const badge = _el('#tm-inbox-badge'), cnt = _el('#tm-ibx-count'), sum = _el('#tm-ibx-sum'), btn = _el('#tm-btn-inbox'), panel = _el('#hub-tm-inbox');
    if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); }
    if (cnt) cnt.textContent = n ? String(n) : '';
    if (sum) sum.textContent = n ? _fmtDur(mins) + ' to place' : '';
    if (btn) { btn.setAttribute('aria-pressed', String(_ibxOpen)); btn.setAttribute('aria-label', 'Inbox' + (n ? ', ' + n + ' waiting' : '')); }
    if (panel) panel.classList.toggle('is-open', _ibxOpen);
    const ae = document.activeElement;
    if (!force && ae && ae.classList && ae.classList.contains('hub-tm-ibx-edit') && list.contains(ae)) return;   // a title is being edited
    list.innerHTML = n ? _ibxView().map(_ibxItemHtml).join('')
      : '<li class="hub-tm-ibx-empty">Nothing waiting.<br>Jot ideas here as they come. Pick the time later.</li>';
  }
  function _ibxToggle(open, focus) {
    _ibxOpen = !!open;
    _lsSet(INBOX_OPEN_KEY, _ibxOpen ? '1' : '0');
    _ibxRender(true);
    if (_ibxOpen && focus) { const i = _el('#tm-ibx-input'); if (i) i.focus({ preventScroll: true }); }
  }
  function _ibxFocus() {
    _ibxToggle(true);
    const i = _el('#tm-ibx-input');
    if (i) { i.focus(); i.select(); }
  }
  function _ibxRefocus(id, sel) {
    const n = _el('.hub-tm-ibx-item[data-ibx-id="' + id + '"] ' + sel);
    if (n) n.focus({ preventScroll: true });
  }

  /* ── item actions ── */
  function _ibxEdit(li) {
    const it = li && _ibxById(li.getAttribute('data-ibx-id'));
    const span = li && li.querySelector('[data-ibx-title]');
    if (!it || !span || li.querySelector('.hub-tm-ibx-edit')) return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'hub-tm-ibx-edit'; inp.maxLength = 120; inp.value = it.title;
    inp.setAttribute('aria-label', 'Task title');
    span.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const finish = function (save) {
      if (done) return;
      done = true;
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (save && v && v !== it.title) { it.title = v; _scheduleSave(); }
      _ibxRender(true);
    };
    inp.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    inp.addEventListener('blur', function () { finish(true); });
  }
  function _ibxRemove(id) {
    const i = _inbox.findIndex(function (x) { return x.id === id; });
    if (i < 0) return;
    const removed = _inbox.splice(i, 1)[0];
    _scheduleSave();
    _ibxRender(true);
    _toast('Removed “' + removed.title + '”', {
      action: 'Undo',
      onAction: function () {
        if (!_ibxById(removed.id)) _inbox.push(removed);
        _ibxSort(); _scheduleSave(); _ibxRender(true);
      }
    });
  }
  /** Inbox → grid. Nothing is created unless [s,e) on `date` is really free. */
  function _ibxSchedule(id, date, s, e) {
    const i = _inbox.findIndex(function (x) { return x.id === id; });
    if (i < 0) return null;
    const it = _inbox[i];
    if (_overlap(date, s, e)) { _toast('That time is taken.'); return null; }
    const b = _normBlock({
      id: _newId(), date: date, tagId: _tagById(it.tagId) ? it.tagId : 'work',
      startTime: _toTime(s), endTime: _toTime(e),
      title: it.title, subtitle: it.note, createdAt: Date.now(),
      checklist: it.ck.map(function (t) { return { text: t }; })
    });
    if (!b) return null;
    _timeBlocks.push(b);
    _inbox.splice(i, 1);
    _qpHN = -1;                                                           // history learns from the new block
    _scheduleSave();
    if (_view === 'day' && date === _currentDate) { _renderDayBlocks(); _updateSummary(); }
    else _renderGrid({ animate: false, scroll: false });
    _ibxRender(true);
    _tlRefresh();
    if (_view === 'day' && date === _currentDate) {
      _dropFx(b.id);
      const n = _el('.hub-tm-block[data-block-id="' + b.id + '"]');
      if (n) { try { n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
    }
    _toast('Placed ' + b.startTime + '–' + b.endTime + ' · ' + it.title + (date !== _currentDate ? ' · ' + _qpDateText(date) : ''), {
      action: 'Undo',
      onAction: function () {
        const k = _timeBlocks.indexOf(b);
        if (k >= 0) _timeBlocks.splice(k, 1);
        if (!_ibxById(it.id)) _inbox.push(it);
        _ibxSort(); _qpHN = -1; _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
        _ibxRender(true); _tlRefresh();
      }
    });
    return b;
  }
  /** First free slot of the task's length: today after "now" (or the picked day after 09:00), then the following days. */
  function _ibxAuto(id, date) {
    const it = _ibxById(id);
    if (!it) return null;
    const today = _todayStr();
    let ds = date || (_currentDate < today ? today : _currentDate);
    for (let k = 0; k < 14; k++) {
      const s = _qpFindFree(ds, it.dur, _qpBase(ds), true);
      if (s !== null) return _ibxSchedule(id, ds, s, s + it.dur);
      ds = _dateToStr(_addDays(_parseDate(ds), 1));
    }
    _toast('No free ' + _fmtDur(it.dur) + ' in the next two weeks.');
    return null;
  }
  /** Grid → Inbox, without losing the note or the checklist. */
  function _blockToInbox(id) {
    const b = _blockById(id);
    if (!b) return;
    if (b.done) { _toast('A completed block stays on the grid.'); return; }
    if (_inbox.length >= IBX_MAX) { _toast('Inbox is full (' + IBX_MAX + ').'); return; }
    const go = function () {
      const cur = _blockById(id);
      if (!cur) return;
      const it = _normInbox({
        id: _ibxNewId(), title: cur.title || _tagOrFallback(cur.tagId).label, tagId: cur.tagId,
        dur: _toMins(cur.endTime) - _toMins(cur.startTime), note: cur.subtitle,
        ck: _ck(cur).map(function (x) { return x.text; }), createdAt: Date.now()
      });
      if (!it) return;
      const removed = _timeBlocks.splice(_timeBlocks.indexOf(cur), 1)[0];
      _inbox.push(it);
      _ibxSort(); _qpHN = -1; _scheduleSave();
      _closeModal(_el('#hub-tm-details-modal'));
      _renderGrid({ animate: false, scroll: false });
      _ibxRender(true); _tlRefresh();
      const ne = _el('.hub-tm-ibx-item[data-ibx-id="' + it.id + '"]');
      if (ne) { ne.classList.add('is-new'); try { ne.scrollIntoView({ block: 'nearest' }); } catch (_) {} setTimeout(function () { ne.classList.remove('is-new'); }, 1400); }
      _toast('Back in the Inbox · ' + it.title, {
        action: 'Undo',
        onAction: function () {
          if (_overlap(removed.date, _toMins(removed.startTime), _toMins(removed.endTime))) { _toast('Can’t restore — that time is taken now.'); return; }
          _inbox = _inbox.filter(function (x) { return x.id !== it.id; });
          _timeBlocks.push(removed);
          _qpHN = -1; _scheduleSave();
          _renderGrid({ animate: false, scroll: false });
          _ibxRender(true); _tlRefresh();
        }
      });
    };
    if (b.focusMs > 0) _confirm('This block has ' + _fmtDur(Math.max(1, Math.round(b.focusMs / 60000))) + ' of focus time recorded. Moving it to the Inbox discards that time. Continue?', go, { title: 'Move to Inbox?', label: 'Move' });
    else go();
  }

  /* ── drag: Inbox → grid ── */
  function _ibxDown(e) {
    if (_ibx || _drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const li = e.target.closest('.hub-tm-ibx-item');
    if (!li || e.target.closest('button, input')) return;
    if (!_ibxById(li.getAttribute('data-ibx-id'))) return;
    const d = { id: li.getAttribute('data-ibx-id'), li: li, pointerId: e.pointerId, pointerType: e.pointerType,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, timer: null, scrollTimer: null,
      ghost: null, gb: null, pd: null, pdKey: '', target: null, over: null };
    _ibx = d;
    if (e.pointerType === 'touch') {
      d.timer = setTimeout(function () {
        if (_ibx !== d) return;
        d.active = true;
        _ibxBegin();
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      }, LONG_PRESS);
    }
  }
  function _ibxMove(e) {
    const d = _ibx;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (d.pointerType === 'touch') { if (dist > 8) _ibxEnd(); return; }    // the finger is scrolling the list
      if (dist < 5) return;
      d.active = true;
      _ibxBegin();
      return;
    }
    _ibxPlace();
    _ibxAutoScroll();
  }
  function _ibxBegin() {
    const d = _ibx, it = d && _ibxById(d.id);
    if (!it) { _ibxEnd(); return; }
    try { d.li.setPointerCapture(d.pointerId); } catch (_) {}
    const g = document.createElement('div');
    g.className = 'hub-tm-ibx-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.style.cssText = _tagStyle(_tagOrFallback(it.tagId));
    g.innerHTML = '<span class="hub-tm-ibx-ghost-t"></span><span class="hub-tm-ibx-ghost-d">' + _fmtDur(it.dur) + '</span>';
    g.firstChild.textContent = it.title;
    _sectionEl.appendChild(g);
    d.ghost = g;
    d.li.classList.add('is-lifted');
    _sectionEl.classList.add('is-ibx-drag');
    _ibxPlace();
  }
  /** What is under the pointer: a free spot in the Day grid, a taken spot, a day cell (Week / Month), or nothing. */
  function _ibxTargetAt(x, y, it) {
    const sc = _el('#hub-tm-grid-scroll');
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    if (_view === 'day') {
      const col = _mainCol();
      if (!col) return null;
      const cr = col.getBoundingClientRect();
      if (x < cr.left || x > cr.right) return null;
      const m = _yToMins(y), fb = _freeBounds(_currentDate, m);
      if (fb[1] - fb[0] < MIN_DUR) return { kind: 'taken' };
      const s = _clamp(_snap(m, 'round'), fb[0], Math.max(fb[0], fb[1] - MIN_DUR));
      const e = Math.min(s + it.dur, fb[1]);
      if (e - s < MIN_DUR) return { kind: 'taken' };
      return { kind: 'slot', s: s, e: e, fb: fb, limited: e - s < it.dur };
    }
    const el = document.elementFromPoint(x, y), cell = el && el.closest && el.closest('[data-date]');
    if (cell && sc.contains(cell)) return { kind: 'day', date: cell.getAttribute('data-date'), el: cell };
    return null;
  }
  function _ibxPlace() {
    const d = _ibx, it = d && _ibxById(d.id);
    if (!it || !d.ghost) return;
    d.ghost.style.transform = 'translate(' + Math.round(d.x + 14) + 'px,' + Math.round(d.y + 10) + 'px)';
    const t = _ibxTargetAt(d.x, d.y, it);
    d.target = t;
    d.ghost.classList.toggle('is-no', !!t && t.kind === 'taken');
    const over = t && t.kind === 'day' ? t.el : null;
    if (d.over !== over) {
      if (d.over) d.over.classList.remove('is-ibx-over');
      if (over) over.classList.add('is-ibx-over');
      d.over = over;
    }
    const tg = _tagOrFallback(it.tagId), col = _mainCol();
    if (t && t.kind === 'slot' && col) {
      const key = t.fb[0] + '-' + t.fb[1];
      if (!d.pd || d.pdKey !== key) {                                       // the free lane changed → rebuild the HUD
        if (d.pd) _dgClose(d.pd);
        d.pd = { mode: 'create', block: null, orig: null, bounds: t.fb, hud: null };
        _dgOpen(d.pd);
        if (d.pd.hud) d.pd.hud.style.cssText = _tagStyle(tg);
        d.pdKey = key;
      }
      _dgUpdate(d.pd, t.s, t.e, t.limited);
      if (!d.gb) {
        const g = document.createElement('div');
        g.className = 'hub-tm-block hub-tm-block--ghost';
        g.style.cssText = _tagStyle(tg);
        g.innerHTML = '<div class="hub-tm-block-body"><span class="hub-tm-block-time"></span><span class="hub-tm-block-title"></span></div>';
        g.querySelector('.hub-tm-block-title').textContent = it.title;
        col.appendChild(g);
        d.gb = g;
      }
      d.gb.style.top = Math.round(t.s / 60 * HOUR_H) + 'px';
      d.gb.style.height = Math.max(18, Math.round((t.e - t.s) / 60 * HOUR_H)) + 'px';
      const lbl = d.gb.querySelector('.hub-tm-block-time');
      if (lbl) lbl.textContent = _toTime(t.s) + ' – ' + _toTime(t.e);
    } else {
      if (d.pd) { _dgClose(d.pd); d.pd = null; d.pdKey = ''; }
      if (d.gb && d.gb.parentNode) { d.gb.parentNode.removeChild(d.gb); d.gb = null; }
    }
  }
  function _ibxAutoScroll() {
    const d = _ibx;
    if (!d || d.scrollTimer) return;
    d.scrollTimer = setInterval(function () {
      if (_ibx !== d) return;
      const sc = _el('#hub-tm-grid-scroll');
      if (!sc) return;
      const r = sc.getBoundingClientRect(), edge = 56;
      if (d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) return;
      let dy = 0;
      if (d.y < r.top + edge) dy = -Math.ceil((r.top + edge - d.y) / 6);
      else if (d.y > r.bottom - edge) dy = Math.ceil((d.y - (r.bottom - edge)) / 6);
      if (dy) { sc.scrollTop += _clamp(dy, -18, 18); _ibxPlace(); }
    }, 16);
  }
  function _ibxEnd() {
    const d = _ibx;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (d.scrollTimer) clearInterval(d.scrollTimer);
    if (d.pd) _dgClose(d.pd);
    if (d.gb && d.gb.parentNode) d.gb.parentNode.removeChild(d.gb);
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.over) d.over.classList.remove('is-ibx-over');
    if (d.li) { d.li.classList.remove('is-lifted'); try { d.li.releasePointerCapture(d.pointerId); } catch (_) {} }
    if (_sectionEl) _sectionEl.classList.remove('is-ibx-drag');
    if (d.active) _ibxSuppress = performance.now() + 300;
    _ibx = null;
  }
  function _ibxUp(e) {
    const d = _ibx;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) { _ibxEnd(); return; }                                    // a plain click: the click handler takes it
    const t = d.target, id = d.id;
    _ibxEnd();
    if (!t) return;                                                          // dropped outside the grid: nothing changes
    if (t.kind === 'slot') _ibxSchedule(id, _currentDate, t.s, t.e);
    else if (t.kind === 'day') _ibxAuto(id, t.date);
    else _toast('That time is taken.');
  }
  function _ibxClick(e) {
    if (performance.now() < _ibxSuppress) return;
    const li = e.target.closest('.hub-tm-ibx-item');
    if (!li) return;
    const id = li.getAttribute('data-ibx-id'), it = _ibxById(id), kb = e.detail === 0;
    if (!it) return;
    const after = function () {                                              // keyboard users: keep focus somewhere useful
      if (!kb) return;
      const n = _el('.hub-tm-ibx-item [data-ibx-go]') || _el('#tm-ibx-input');
      if (n) n.focus({ preventScroll: true });
    };
    if (e.target.closest('[data-ibx-go]')) { _ibxMenuClose(); _ibxAuto(id); after(); return; }
    if (e.target.closest('[data-ibx-del]')) { _ibxRemove(id); after(); return; }
    if (e.target.closest('[data-ibx-more]')) {
      const same = _ibxMenuEl && !_ibxMenuEl.hidden && _ibxMenuId === id;
      if (same) _ibxMenuClose(true); else _ibxMenuOpen(id, e.target.closest('[data-ibx-more]'), kb);
      return;
    }
    if (e.target.closest('[data-ibx-pri]')) {
      it.pri = IBX_PRI[(IBX_PRI.indexOf(it.pri) + 1) % IBX_PRI.length];
      _scheduleSave(); _ibxRender(true); _ibxRefocus(id, '[data-ibx-pri]');
      return;
    }
    if (e.target.closest('[data-ibx-tag]')) {
      const tags = _allTags(), k = tags.findIndex(function (t) { return t.id === it.tagId; });
      it.tagId = tags[(k + 1) % tags.length].id;
      _scheduleSave(); _ibxRender(true); _ibxRefocus(id, '[data-ibx-tag]');
      return;
    }
    if (e.target.closest('[data-ibx-dur]')) {
      const k = SB_DURS.findIndex(function (m) { return m > it.dur; });
      it.dur = k < 0 ? SB_DURS[0] : SB_DURS[k];
      _scheduleSave(); _ibxRender(true); _ibxRefocus(id, '[data-ibx-dur]');
      return;
    }
    if (e.target.closest('[data-ibx-title]')) _ibxEdit(li);
  }
  /* ── priority · duplicate ── */
  function _ibxSetPri(id, pri) {
    const it = _ibxById(id);
    if (!it || IBX_PRI.indexOf(pri) < 0 || it.pri === pri) return;
    it.pri = pri;
    _scheduleSave();
    _ibxRender(true);
  }
  function _ibxDuplicate(id) {
    const it = _ibxById(id);
    if (!it) return;
    if (_inbox.length >= IBX_MAX) { _toast('Inbox is full (' + IBX_MAX + ').'); return; }
    const copy = _normInbox(Object.assign({}, it, { id: _ibxNewId(), createdAt: Date.now(), updatedAt: 0 }));
    if (!copy) return;
    _inbox.push(copy);
    _ibxSort(); _scheduleSave(); _ibxRender(true);
    const el = _el('.hub-tm-ibx-item[data-ibx-id="' + copy.id + '"]');
    if (el) { el.classList.add('is-new'); setTimeout(function () { el.classList.remove('is-new'); }, 700); }
  }

  /* ── ⋮ menu: one floating menu, rebuilt for the item it belongs to ── */
  let _ibxMenuEl = null, _ibxMenuId = '';
  function _ibxMenuClose(refocus) {
    if (!_ibxMenuEl || _ibxMenuEl.hidden) return;
    _ibxMenuEl.hidden = true;
    const id = _ibxMenuId;
    _ibxMenuId = '';
    const b = _el('.hub-tm-ibx-item[data-ibx-id="' + id + '"] [data-ibx-more]');
    if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus({ preventScroll: true }); }
  }
  function _ibxMenuOpen(id, btn, focusFirst) {
    const it = _ibxById(id);
    if (!it || !btn || !_sectionEl) return;
    if (!_ibxMenuEl) {
      _ibxMenuEl = document.createElement('div');
      _ibxMenuEl.className = 'hub-tm-ibx-menu';
      _ibxMenuEl.setAttribute('role', 'menu');
      _ibxMenuEl.hidden = true;
      _sectionEl.appendChild(_ibxMenuEl);
    }
    const m = _ibxMenuEl, cur = it.pri || 'normal';
    const row = function (attrs, cls, role, label, extra) {
      return '<button type="button" class="hub-tm-ibx-mi' + (cls ? ' ' + cls : '') + '" role="' + role + '" ' + attrs + '>' + label + (extra || '') + '</button>';
    };
    m.innerHTML =
      row('data-mi="edit"', '', 'menuitem', '<span class="hub-tm-ibx-mi-ic">' + TL_ICON.edit + '</span><span>Edit details</span>') +
      '<div class="hub-tm-ibx-mi-sep" role="separator"></div>' +
      '<div class="hub-tm-ibx-mi-cap" aria-hidden="true">Priority</div>' +
      IBX_PRI.map(function (p) {
        return row('data-mi="pri" data-pri="' + p + '"', 'hub-tm-ibx-mi--pri', 'menuitemradio" aria-checked="' + (p === cur),
          '<span class="hub-tm-ibx-mi-ic"><span class="hub-tm-ibx-pri hub-tm-ibx-pri--' + p + '" data-pri="' + p + '">' + _ibxPriHtml(p).replace(/<span class="hub-tm-ibx-pri-t">.*<\/span>/, '') + '</span></span><span>' + IBX_PRI_LABEL[p] + '</span>',
          '<span class="hub-tm-ibx-mi-tick" aria-hidden="true"></span>');
      }).join('') +
      '<div class="hub-tm-ibx-mi-sep" role="separator"></div>' +
      row('data-mi="dup"', '', 'menuitem', '<span class="hub-tm-ibx-mi-ic">' + TL_ICON.copy + '</span><span>Duplicate</span>') +
      row('data-mi="del"', 'hub-tm-ibx-mi--del', 'menuitem', '<span class="hub-tm-ibx-mi-ic">' + TL_ICON.del + '</span><span>Delete</span>');
    _ibxMenuId = id;
    document.querySelectorAll('#time-management [data-ibx-more][aria-expanded="true"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    btn.setAttribute('aria-expanded', 'true');
    m.hidden = false;
    // place: right edge under the button, flip upwards / clamp to the viewport
    const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = r.right - w, y = r.bottom + 6;
    if (x < 8) x = Math.min(r.left, vw - w - 8);
    if (y + h > vh - 8) y = Math.max(8, r.top - h - 6);
    m.style.left = Math.round(Math.max(8, x)) + 'px';
    m.style.top = Math.round(y) + 'px';
    if (focusFirst) { const f = m.querySelector('.hub-tm-ibx-mi'); if (f) f.focus({ preventScroll: true }); }
  }
  function _ibxMenuAct(mi) {
    const id = _ibxMenuId, act = mi.getAttribute('data-mi');
    if (!id) return;
    if (act === 'pri') { _ibxSetPri(id, mi.getAttribute('data-pri')); _ibxMenuClose(); _ibxRefocus(id, '[data-ibx-more]'); return; }
    _ibxMenuClose();
    if (act === 'edit') _ibxEditOpen(id);
    else if (act === 'dup') _ibxDuplicate(id);
    else if (act === 'del') _ibxRemove(id);
  }

  /* ── Edit dialog: everything about one Inbox task ── */
  let _ibxEditId = '', _ibxEditNote0 = '';
  function _ibxNoteToText(html) {                         // note is sanitised HTML → editable plain text (line breaks kept)
    if (!html) return '';
    const tpl = document.createElement('template');
    tpl.innerHTML = _sanitizeHtml(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|blockquote)>/gi, '\n');
    return tpl.content.textContent.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }
  function _ibxTextToNote(txt) {
    return _sanitizeHtml(_esc(txt).replace(/\r?\n/g, '<br>'));
  }
  function _ibxEditOpen(id) {
    const it = _ibxById(id), dlg = _el('#hub-tm-ibx-modal');
    if (!it || !dlg) return;
    _ibxEditId = id;
    _el('#tm-ibx-m-title').value = it.title;
    const tagSel = _el('#tm-ibx-m-tag');
    tagSel.innerHTML = _allTags().map(function (t) { return '<option value="' + _esc(t.id) + '">' + _esc(t.label) + '</option>'; }).join('');
    tagSel.value = _tagById(it.tagId) ? it.tagId : 'work';
    const durs = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480];
    if (durs.indexOf(it.dur) < 0) { durs.push(it.dur); durs.sort(function (a, b) { return a - b; }); }
    const durSel = _el('#tm-ibx-m-dur');
    durSel.innerHTML = durs.map(function (m) { return '<option value="' + m + '">' + _fmtDur(m) + '</option>'; }).join('');
    durSel.value = String(it.dur);
    const radio = _el('input[name="tm-ibx-m-pri"][value="' + (it.pri || 'normal') + '"]');
    if (radio) radio.checked = true;
    _ibxEditNote0 = _ibxNoteToText(it.note);
    _el('#tm-ibx-m-note').value = _ibxEditNote0;
    _el('#tm-ibx-m-ck').value = it.ck.join('\n');
    _el('#tm-ibx-m-err').textContent = '';
    _openModal(dlg, '#tm-ibx-m-title');
  }
  function _ibxEditSave() {
    const it = _ibxById(_ibxEditId), dlg = _el('#hub-tm-ibx-modal');
    if (!it) { _closeModal(dlg); return; }
    const title = _el('#tm-ibx-m-title').value.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) { _el('#tm-ibx-m-err').textContent = 'Give the task a title.'; _el('#tm-ibx-m-title').focus(); return; }
    const pri = (_el('input[name="tm-ibx-m-pri"]:checked') || {}).value;
    const noteTxt = _el('#tm-ibx-m-note').value.replace(/\r/g, '').trim();
    it.title = title;
    it.tagId = _el('#tm-ibx-m-tag').value || it.tagId;
    it.dur = _clamp(Math.round((parseInt(_el('#tm-ibx-m-dur').value, 10) || it.dur) / SNAP) * SNAP, MIN_DUR, 480);
    if (IBX_PRI.indexOf(pri) > -1) it.pri = pri;
    if (noteTxt !== _ibxEditNote0) it.note = _ibxTextToNote(noteTxt);        // untouched notes keep their original formatting
    it.ck = _el('#tm-ibx-m-ck').value.split(/\r?\n/).map(function (t) { return t.replace(/\s+/g, ' ').trim().slice(0, 200); }).filter(Boolean).slice(0, CK_MAX);
    const id = it.id;
    _scheduleSave();
    _closeModal(dlg);
    _ibxRender(true);
    _ibxRefocus(id, '[data-ibx-more]');
  }
  function _bindIbxMenuAndDialog(sig) {
    const dlg = _el('#hub-tm-ibx-modal');
    document.addEventListener('pointerdown', function (e) {
      if (!_ibxMenuEl || _ibxMenuEl.hidden) return;
      if (_ibxMenuEl.contains(e.target) || (e.target.closest && e.target.closest('[data-ibx-more]'))) return;
      _ibxMenuClose();
    }, sig);
    window.addEventListener('resize', function () { _ibxMenuClose(); }, sig);
    const list = _el('#tm-ibx-list');
    if (list) list.addEventListener('scroll', function () { _ibxMenuClose(); }, { passive: true, signal: _ui.signal });
    if (_ibxMenuEl) { _ibxMenuEl.remove(); _ibxMenuEl = null; _ibxMenuId = ''; }   // a remount builds a fresh one
    _sectionEl.addEventListener('click', function (e) {
      const mi = e.target.closest && e.target.closest('.hub-tm-ibx-mi');
      if (mi && _ibxMenuEl && _ibxMenuEl.contains(mi)) _ibxMenuAct(mi);
    }, sig);
    _sectionEl.addEventListener('keydown', function (e) {
      if (!_ibxMenuEl || _ibxMenuEl.hidden || !_ibxMenuEl.contains(e.target)) return;
      const items = Array.prototype.slice.call(_ibxMenuEl.querySelectorAll('.hub-tm-ibx-mi')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Tab') { _ibxMenuClose(true); }
    }, sig);
    if (!dlg) return;
    _el('#tm-ibx-m-save').addEventListener('click', _ibxEditSave, sig);
    _el('#tm-ibx-m-del').addEventListener('click', function () { const id = _ibxEditId; _closeModal(dlg); _ibxRemove(id); }, sig);
    dlg.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      const ta = e.target.tagName === 'TEXTAREA';
      if (e.key === 'Enter' && (!ta || e.ctrlKey || e.metaKey)) { e.preventDefault(); _ibxEditSave(); }
    }, sig);
  }
  function _bindInbox() {
    const sig = { signal: _ui.signal };
    const btn = _el('#tm-btn-inbox'), list = _el('#tm-ibx-list'), inp = _el('#tm-ibx-input'), add = _el('#tm-ibx-add'), close = _el('#tm-ibx-close');
    if (!btn || !list || !inp || !add || !close) return;
    btn.addEventListener('click', function () { _ibxToggle(!_ibxOpen, true); }, sig);
    close.addEventListener('click', function () { _ibxToggle(false); btn.focus({ preventScroll: true }); }, sig);
    const commit = function () { if (_ibxAddMany([inp.value])) inp.value = ''; inp.focus({ preventScroll: true }); };
    add.addEventListener('click', commit, sig);
    inp.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;                        // IME (Telex / VNI) composing
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inp.value = ''; inp.blur(); }
    }, sig);
    inp.addEventListener('paste', function (e) {                             // paste a list → one task per line
      const txt = ((e.clipboardData || window.clipboardData).getData('text') || '').trim();
      if (!/\r?\n/.test(txt)) return;
      e.preventDefault();
      _ibxAddMany(txt.split(/\r?\n/));
    }, sig);
    list.addEventListener('pointerdown', _ibxDown, sig);
    list.addEventListener('pointermove', _ibxMove, sig);
    list.addEventListener('pointerup', _ibxUp, sig);
    list.addEventListener('pointercancel', function () { _ibxEnd(); }, sig);
    list.addEventListener('touchmove', function (e) { if (_ibx && _ibx.active && e.cancelable) e.preventDefault(); }, { passive: false, signal: _ui.signal });
    list.addEventListener('contextmenu', function (e) { if (_ibx) e.preventDefault(); }, sig);
    list.addEventListener('click', _ibxClick, sig);
    list.addEventListener('keydown', function (e) {
      const t = e.target;
      if (t.hasAttribute && t.hasAttribute('data-ibx-title') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); _ibxEdit(t.closest('.hub-tm-ibx-item')); }
    }, sig);
    _bindIbxMenuAndDialog(sig);
    _ibxRender(true);
  }

  /* ============================================================
     QUICK PLAN  ·  one line → one block (+ its checklist)
       [time | range] [duration] [#tag] title | item; item; item
       11:00 1h Plan Schedule | viết journal; làm bài tiểu luận
       @9h30 45p #study Đọc sách      ·      9:00-10:30 Họp      ·      1h30 Deep work
     Time: 11:00 · 9am · 9:30pm · @9 · @9h30 · 11:00-12:30 · now.   Duration: 1h · 90m · 45p · 1h30.
     No time → the next free slot.  Tag → #work, #study, #2 …   Items → after "|", split by ";".
     v2 · MANY LINES: Shift+Enter (or paste a list) → one block per line; a line without a time follows the previous block.
          DATES: mai · hôm nay · t2…t7 · cn · mon…sun · 25/11 · 2026-11-25 — sticks to the next lines; a line with only a date switches day.
          REPEAT: 4x25p · 4x25p+5p (5-minute gap) · 3x 1h.
          HISTORY: a known title brings back its tag + usual length; ↑/↓ + Tab (or click) accepts a suggestion.
     ============================================================ */
  function _qpClock(tok, forced) {
    const m = /^(\d{1,2})(?:[:h](\d{2})?)?(am|pm)?$/i.exec(tok);
    if (!m) return null;
    if (!forced && !(tok.indexOf(':') > -1 || m[3])) return null;      // bare "11" or "9h30" is only a time after "@"
    let h = parseInt(m[1], 10);
    const mi = m[2] ? parseInt(m[2], 10) : 0;
    if (m[3]) { if (h < 1 || h > 12) return null; h = h % 12 + (/pm/i.test(m[3]) ? 12 : 0); }
    if (mi > 59 || h > 24 || (h === 24 && mi > 0)) return null;
    return h * 60 + mi;
  }
  function _qpRange(tok) {
    const m = /^(@?)([^-\u2013]+)[-\u2013](@?)([^-\u2013]+)$/.exec(tok);
    if (!m) return null;
    const f = !!(m[1] || m[3]), a = _qpClock(m[2], f), b = _qpClock(m[4], f);
    return a !== null && b !== null ? [a, b] : null;
  }
  function _qpDur(tok) {
    let m;
    if ((m = /^(\d+(?:[.,]\d+)?)h$/i.exec(tok))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
    if ((m = /^(\d+)h(\d{1,2})$/i.exec(tok))) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if ((m = /^(\d+)(?:min|phut|ph|m|p)$/i.exec(tok))) return parseInt(m[1], 10);
    return null;
  }
  function _qpTag(name) {
    const n = name.toLowerCase(), all = _allTags();
    if (/^\d+$/.test(n)) return all[parseInt(n, 10) - 1] || null;
    return all.find(function (t) { return t.id.toLowerCase() === n || t.label.toLowerCase() === n; }) ||
           all.find(function (t) { return t.label.toLowerCase().indexOf(n) === 0 || t.id.toLowerCase().indexOf(n) === 0; }) || null;
  }
  function _qpBase(date) {
    if (date !== _todayStr()) return 9 * 60;
    const d = new Date();
    return Math.ceil((d.getHours() * 60 + d.getMinutes()) / SNAP) * SNAP;
  }
  /** First free window of `dur` minutes on `date`, starting at `from` (then — unless `noWrap` — wrapping to the top of the day). */
  function _qpFindFree(date, dur, from, noWrap) {
    for (let pass = 0; pass < (noWrap ? 1 : 2); pass++) {
      for (let c = pass ? 0 : from; c + dur <= DAY_MINS && (pass === 0 || c < from); c += SNAP) {
        if (!_overlap(date, c, c + dur)) return c;
      }
    }
    return null;
  }

  /* ── v2 helpers ─────────────────────────────────────────────── */
  const QP_MAX_BLOCKS = 40, QP_MAX_REPEAT = 12;
  const QP_BULLET = /^(?:[-*•–·▪▸►]+|\d{1,2}[.)])\s+/;                 // "- ", "• ", "1. " in front of a pasted line
  const QP_DATE_WORDS = { 'today': 0, 'hom nay': 0, 'tomorrow': 1, 'tmr': 1, 'tmrw': 1, 'mai': 1, 'ngay mai': 1, 'ngay mot': 2, 'hom qua': -1, 'yesterday': -1 };
  const QP_WEEKDAYS = {
    't2': 1, 't3': 2, 't4': 3, 't5': 4, 't6': 5, 't7': 6, 'cn': 0,
    'thu hai': 1, 'thu ba': 2, 'thu tu': 3, 'thu nam': 4, 'thu sau': 5, 'thu bay': 6, 'chu nhat': 0,
    'mon': 1, 'monday': 1, 'tue': 2, 'tuesday': 2, 'wed': 3, 'wednesday': 3, 'thur': 4, 'thurs': 4, 'thursday': 4,
    'fri': 5, 'friday': 5, 'sat': 6, 'saturday': 6, 'sun': 0, 'sunday': 0
  };
  function _qpHas(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /** Lower-case, accent-free ("Ôn Flashcard" → "on flashcard") so Vietnamese matches with or without diacritics. */
  function _qpPlain(s) {
    return String(s || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }
  function _qpDateText(ds) {
    const t = _todayStr(), n = Math.round((_parseDate(ds) - _parseDate(t)) / 86400000);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = _parseDate(ds);
    return DAY_SHORT[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  }
  function _qpDurTok(m) {
    if (m < 60) return m + 'p';
    return m % 60 ? Math.floor(m / 60) + 'h' + _pad(m % 60) : (m / 60) + 'h';
  }
  /** One date word/number at the start of a line → { ds, used } | { error } | null. `next` is the following token (two-word dates). */
  function _qpDateOf(tok, next) {
    const p = _qpPlain(tok), two = next ? p + ' ' + _qpPlain(next) : '';
    const rel = function (n) { return _dateToStr(_addDays(new Date(), n)); };
    const wk = function (wd) { const d = new Date(); let n = (wd - d.getDay() + 7) % 7; if (n === 0) n = 7; return rel(n); };   // always the NEXT such day
    if (two && _qpHas(QP_DATE_WORDS, two)) return { ds: rel(QP_DATE_WORDS[two]), used: 2 };
    if (two && _qpHas(QP_WEEKDAYS, two)) return { ds: wk(QP_WEEKDAYS[two]), used: 2 };
    if (tok.toLowerCase() === 'mốt') return { ds: rel(2), used: 1 };                     // "mốt" (with the accent) — bare "mot" means "one"
    if (_qpHas(QP_DATE_WORDS, p)) return { ds: rel(QP_DATE_WORDS[p]), used: 1 };
    if (_qpHas(QP_WEEKDAYS, p)) return { ds: wk(QP_WEEKDAYS[p]), used: 1 };
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tok);
    if (m) return _isDateStr(tok) ? { ds: tok, used: 1 } : { error: 'Not a valid date “' + tok + '”.' };
    if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(tok))) {
      const dd = +m[1], mm = +m[2], today = _parseDate(_todayStr());
      let yy = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      let d = new Date(yy, mm - 1, dd);
      if (d.getMonth() !== mm - 1 || d.getDate() !== dd) return { error: 'Not a valid date “' + tok + '”.' };
      if (!m[3] && d < today) d = new Date(yy + 1, mm - 1, dd);                          // already past this year → next year
      return { ds: _dateToStr(d), used: 1 };
    }
    return null;
  }

  /** Split the head of a line (everything before "|") into its parts. Shared by the parser and by the suggestion box. */
  function _qpScan(head) {
    const o = { date: null, now: false, start: null, end: null, dur: null, count: 1, gap: 0, tag: null, tagTok: '', words: [], lead: [], other: 0, error: '' };
    const toks = head.split(' ').filter(Boolean);
    let lead = true;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      let m, v;
      if ((m = /^#(\S+)$/.exec(tok))) {
        o.tag = _qpTag(m[1]); o.tagTok = tok;
        if (!o.tag) { o.error = 'No tag “#' + m[1] + '”. Try ' + _allTags().slice(0, 3).map(function (t) { return '#' + t.label.toLowerCase(); }).join(' ') + '.'; return o; }
        continue;
      }
      if (lead) {
        if (/^now$/i.test(tok)) { o.now = true; o.other++; o.lead.push(tok); continue; }
        const dt = _qpDateOf(tok, toks[i + 1]);
        if (dt) {
          if (dt.error) { o.error = dt.error; return o; }
          o.date = dt.ds; o.lead.push(tok);
          if (dt.used === 2) { i++; o.lead.push(toks[i]); }
          continue;
        }
        if ((m = /^(\d{1,2})[x×](?:(\S*?))?$/i.exec(tok)) && (!m[2] || _qpDur(m[2].split('+')[0]) !== null)) {   // 4x · 4x25p · 4x25p+5p
          const n = parseInt(m[1], 10);
          if (n < 1 || n > QP_MAX_REPEAT) { o.error = 'Repeat 1–' + QP_MAX_REPEAT + ' times at most.'; return o; }
          o.count = n; o.other++; o.lead.push(tok);
          if (m[2]) {
            const pr = m[2].split('+'), g = pr[1] ? _qpDur(pr[1]) : null;
            o.dur = _qpDur(pr[0]);
            if (pr[1] && g === null) { o.error = 'Gap “+' + pr[1] + '” isn’t a duration. Try +5p.'; return o; }
            if (g !== null) o.gap = g;
          }
          continue;
        }
        if (o.count > 1 && (m = /^\+(\S+)$/.exec(tok)) && (v = _qpDur(m[1])) !== null) { o.gap = v; o.other++; o.lead.push(tok); continue; }
        if ((v = _qpRange(tok))) { o.start = v[0]; o.end = v[1]; o.other++; o.lead.push(tok); continue; }
        v = tok.charAt(0) === '@' ? _qpClock(tok.slice(1), true) : _qpClock(tok, false);
        if (v !== null) { o.start = v; o.other++; o.lead.push(tok); continue; }
        v = _qpDur(tok);
        if (v !== null) { o.dur = v; o.other++; o.lead.push(tok); continue; }
        lead = false;
      }
      o.words.push(tok);
    }
    return o;
  }

  /* ── History: what the user usually does with a title / a tag ── */
  let _qpH = null, _qpHAt = 0, _qpHN = -1;
  function _qpHist() {
    const now = Date.now();
    if (_qpH && _qpHN === _timeBlocks.length && now - _qpHAt < 4000) return _qpH;
    const map = Object.create(null), tagDur = Object.create(null), tagAt = Object.create(null);
    const top = function (o, byAt) { let best = null, bn = 0; Object.keys(o).forEach(function (k) { if (o[k] > bn) { best = k; bn = o[k]; } }); return best; };
    _timeBlocks.forEach(function (b) {
      if (b._qpv) return;                                                          // pencilled-in line of the current plan
      const d = _toMins(b.endTime) - _toMins(b.startTime);
      if (d < MIN_DUR) return;
      const at = Number(b.createdAt) || 0, tid = b.tagId || '';
      if (tid && (tagAt[tid] === undefined || at >= tagAt[tid])) { tagAt[tid] = at; tagDur[tid] = d; }
      const title = String(b.title || '').trim(), key = _qpPlain(title), tg = _tagById(tid);
      if (!key || (tg && key === _qpPlain(tg.label))) return;                       // placeholder titles ("Work") teach nothing
      let h = map[key];
      if (!h) h = map[key] = { title: title, n: 0, at: 0, lastDur: d, tags: {}, durs: {}, ck: {} };
      h.n++;
      if (at >= h.at) { h.at = at; h.title = title; h.lastDur = d; }
      h.tags[tid] = (h.tags[tid] || 0) + 1;
      h.durs[d] = (h.durs[d] || 0) + 1;
      (b.checklist || []).forEach(function (it) {
        const t = String((it && it.text) || '').trim(), kk = _qpPlain(t);
        if (!kk) return;
        (h.ck[kk] = h.ck[kk] || { text: t, n: 0 }).n++;
      });
    });
    Object.keys(map).forEach(function (k) {
      const h = map[k];
      h.tagId = top(h.tags);
      const dm = top(h.durs);
      h.dur = h.durs[h.lastDur] === h.durs[dm] ? h.lastDur : parseInt(dm, 10);        // tie → the most recent length
      h.items = Object.keys(h.ck).map(function (c) { return h.ck[c]; })
        .filter(function (c) { return c.n >= 2; })                                    // only checklist items that keep coming back
        .sort(function (a, b) { return b.n - a.n; }).slice(0, 5).map(function (c) { return c.text; });
    });
    _qpH = { map: map, tagDur: tagDur };
    _qpHAt = now; _qpHN = _timeBlocks.length;
    return _qpH;
  }
  function _qpSuggest(frag) {
    const q = _qpPlain(frag);
    if (q.length < 2) return [];
    const H = _qpHist().map, out = [];
    Object.keys(H).forEach(function (k) {
      const sc = k.indexOf(q) === 0 ? 0 : k.indexOf(' ' + q) > -1 ? 1 : k.indexOf(q) > -1 ? 2 : -1;
      if (sc >= 0) out.push({ h: H[k], key: k, sc: sc });
    });
    out.sort(function (a, b) { return a.sc - b.sc || b.h.n - a.h.n || b.h.at - a.h.at; });
    return out.slice(0, 5);
  }

  /* ── Parse ONE line → blocks. ctx = { date, cursor:{date:mins} } (set by _qpPlan; absent for a bare call) ── */
  function _qpParse(raw, ctx) {
    ctx = ctx || {};
    raw = String(raw || '').replace(/\s+/g, ' ').trim().replace(QP_BULLET, '');
    if (!raw) return { empty: true };
    const bar = raw.indexOf('|');
    const head = (bar < 0 ? raw : raw.slice(0, bar)).trim();
    const items = (bar < 0 ? '' : raw.slice(bar + 1)).split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    const sc = _qpScan(head);
    if (sc.error) return { error: sc.error };
    const date = sc.date || ctx.date || _currentDate;
    if (sc.date && !sc.other && !sc.words.length && !sc.tag && !items.length) return { dateOnly: true, date: sc.date };

    const title = sc.words.join(' ').slice(0, 120), hist = ctx.hist || _qpHist(), hit = title ? hist.map[_qpPlain(title)] : null;
    let tg = sc.tag, learned = false;
    if (!tg && hit) { const t = _tagById(hit.tagId); if (t) { tg = t; learned = true; } }
    tg = tg || _tagOrFallback(_activeTagId);
    const tagId = tg.id === FALLBACK_TAG.id ? 'work' : tg.id;
    let dur = sc.dur;
    if (dur === null && sc.end === null) {                                          // no length typed → what this title / tag usually takes
      if (hit && hit.dur) { dur = hit.dur; learned = true; }
      else if (hist.tagDur[tagId]) { dur = hist.tagDur[tagId]; learned = true; }
    }
    if (dur !== null && dur < MIN_DUR) dur = MIN_DUR;

    let s, e, shortened = false, timed = false;
    if (sc.start !== null || sc.now) {
      timed = true;
      s = sc.now ? _qpBase(date) : sc.start;
      if (s >= DAY_MINS) return { error: 'That start time is past midnight.' };
      e = sc.end !== null ? sc.end : s + (dur || 60);
      if (sc.end !== null && sc.end === 0) e = DAY_MINS;
      if (e <= s) return { error: 'End must be after start.' };
      if (e > DAY_MINS) e = DAY_MINS;
      const fb = _freeBounds(date, s);
      if (fb[1] - s < MIN_DUR) {
        const hitB = _others(date).find(function (o) { return s >= o.s && s < o.e; }) || _others(date).find(function (o) { return o.s === s; });
        return { error: 'Taken' + (hitB ? ': ' + hitB.b.startTime + '–' + hitB.b.endTime + ' “' + (hitB.b.title || _tagOrFallback(hitB.b.tagId).label) + '”' : '') + '.' };
      }
      if (e > fb[1]) { e = fb[1]; shortened = true; }
    } else {
      const d = dur || 60, chained = ctx.cursor && ctx.cursor[date] !== undefined;
      s = _qpFindFree(date, d, chained ? ctx.cursor[date] : _qpBase(date), chained);
      if (s === null) return { error: 'No free ' + _fmtDur(d) + ' left on ' + (date === _currentDate ? 'this day' : _qpDateText(date)) + '.' };
      e = s + d;
    }

    const blocks = [{ s: s, e: e }], len = e - s;
    for (let i = 1; i < sc.count; i++) {
      const prev = blocks[i - 1];
      let ns = prev.e + sc.gap;
      if (ns + len > DAY_MINS) return { error: 'Only ' + i + ' of ' + sc.count + ' fit before midnight.' };
      if (_overlap(date, ns, ns + len)) {
        if (timed) { const hb = _overlap(date, ns, ns + len); return { error: 'Block ' + (i + 1) + '/' + sc.count + ' hits ' + hb.startTime + '–' + hb.endTime + ' “' + (hb.title || _tagOrFallback(hb.tagId).label) + '”.' }; }
        ns = _qpFindFree(date, len, ns, true);
        if (ns === null) return { error: 'Only ' + i + ' of ' + sc.count + ' fit on this day.' };
      }
      blocks.push({ s: ns, e: ns + len });
    }
    blocks.forEach(function (b, i) {
      b.title = sc.count > 1 ? (title || tg.label) + ' ' + (i + 1) + '/' + sc.count : (title || tg.label);
    });
    return { date: date, explicitDate: sc.date, tag: tg, tagId: tagId, items: items, blocks: blocks, shortened: shortened, learned: learned, count: sc.count };
  }

  /* ── Parse the whole box → one plan. Each accepted line is "pencilled in" (temporarily) so the next line sees it. ── */
  function _qpPlan(raw) {
    const plan = { empty: true, lines: [], blocks: [], errors: [], dates: [], jump: null };
    const ctx = { date: _currentDate, cursor: {}, hist: _qpHist() };           // history is read BEFORE any line is pencilled in
    let n = 0;
    try {
      String(raw || '').split(/\r?\n/).forEach(function (ln) {
        if (!ln.replace(/\s+/g, '')) return;
        n++; plan.empty = false;
        const r = _qpParse(ln, ctx);
        if (r.empty) { n--; return; }
        if (r.dateOnly) { ctx.date = r.date; plan.jump = r.date; plan.lines.push({ n: n, dateOnly: true, date: r.date }); return; }
        if (r.error) { plan.errors.push({ n: n, msg: r.error }); plan.lines.push({ n: n, error: r.error }); return; }
        if (plan.blocks.length + r.blocks.length > QP_MAX_BLOCKS) {
          const msg = 'Too many blocks at once (max ' + QP_MAX_BLOCKS + ').';
          plan.errors.push({ n: n, msg: msg }); plan.lines.push({ n: n, error: msg }); return;
        }
        if (r.explicitDate) ctx.date = r.explicitDate;
        r.blocks.forEach(function (b, i) {
          plan.blocks.push({ line: n, date: r.date, s: b.s, e: b.e, title: b.title, tag: r.tag, tagId: r.tagId, items: i === 0 ? r.items : [] });
          _timeBlocks.push({ id: 'qpv-' + plan.blocks.length, _qpv: true, date: r.date, startTime: _toTime(b.s), endTime: _toTime(b.e), title: b.title, tagId: r.tagId });
        });
        ctx.cursor[r.date] = r.blocks[r.blocks.length - 1].e;
        if (plan.dates.indexOf(r.date) < 0) plan.dates.push(r.date);
        plan.lines.push({ n: n, ok: true, r: r });
      });
    } finally {
      for (let i = _timeBlocks.length - 1; i >= 0; i--) if (_timeBlocks[i]._qpv) _timeBlocks.splice(i, 1);
    }
    return plan;
  }

  /* ── Live preview ── */
  function _qpAutosize() {
    const inp = _el('#tm-qp-input');
    if (!inp) return;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 150) + 'px';
  }
  function _qpRenderPlan(plan) {
    const box = _el('#tm-qp-plan');
    if (!box) return;
    const multi = plan.lines.length > 1 || plan.blocks.length > 1;
    if (!multi) { box.hidden = true; box.textContent = ''; return; }
    box.textContent = '';
    let shown = 0, hidden = 0, lastDate = _currentDate;
    const li = function (cls) { const x = document.createElement('li'); if (cls) x.className = cls; box.appendChild(x); return x; };
    const span = function (p, cls, txt) { const s = document.createElement('span'); s.className = cls; s.textContent = txt; p.appendChild(s); return s; };
    plan.lines.forEach(function (L) {
      if (shown >= 8) { hidden += L.ok ? L.r.blocks.length : 1; return; }
      if (L.dateOnly) { const x = li('is-date'); span(x, 'hub-tm-qp-plan-day', '▸ ' + _qpDateText(L.date)); lastDate = L.date; shown++; return; }
      if (L.error) { const x = li('is-error'); span(x, 'hub-tm-qp-plan-n', 'Line ' + L.n); span(x, 'hub-tm-qp-plan-msg', L.error); shown++; return; }
      L.r.blocks.forEach(function (b) {
        if (shown >= 8) { hidden++; return; }
        const x = li();
        x.style.setProperty('--tm-c', _safeColor(L.r.tag.color));
        span(x, 'hub-tm-qp-plan-dot', '');
        span(x, 'hub-tm-qp-plan-time', _toTime(b.s) + '–' + _toTime(b.e));
        span(x, 'hub-tm-qp-plan-title', b.title);
        span(x, 'hub-tm-qp-plan-tag', L.r.tag.label + (L.r.learned ? ' · from history' : ''));
        if (L.r.date !== lastDate) { span(x, 'hub-tm-qp-plan-day', _qpDateText(L.r.date)); lastDate = L.r.date; }
        shown++;
      });
    });
    if (hidden) { const x = li('is-more'); span(x, 'hub-tm-qp-plan-msg', '+ ' + hidden + ' more'); }
    box.hidden = false;
  }
  function _qpUpdate() {
    const inp = _el('#tm-qp-input'), out = _el('#tm-qp-hint'), form = _el('#hub-tm-qp');
    if (!inp || !out || !form) return;
    _qpAutosize();
    const plan = _qpPlan(inp.value);
    _qpRenderPlan(plan);
    out.classList.toggle('is-error', !!plan.errors.length);
    if (plan.empty) {
      const tg = _tagOrFallback(_activeTagId), f = _qpFindFree(_currentDate, 60, _qpBase(_currentDate));
      form.style.setProperty('--tm-c', _safeColor(tg.color));
      out.textContent = f !== null ? 'Next free ' + _toTime(f) + ' · ' + tg.label : '';
      _qpSugUpdate();
      return;
    }
    const first = plan.lines.find(function (L) { return L.ok; });
    if (first) form.style.setProperty('--tm-c', _safeColor(first.r.tag.color));
    if (plan.errors.length) {
      const e0 = plan.errors[0], ok = plan.blocks.length;
      out.textContent = (plan.lines.length > 1 ? 'Line ' + e0.n + ': ' : '') + e0.msg + (ok ? ' · Ctrl+Enter plans the other ' + ok : '');
    } else if (!plan.blocks.length) {
      out.textContent = plan.jump ? 'Enter jumps to ' + _qpDateText(plan.jump) : '';
    } else if (plan.lines.length === 1 && plan.blocks.length === 1) {
      const r = plan.lines[0].r, b = r.blocks[0];
      out.textContent = _toTime(b.s) + '–' + _toTime(b.e) + ' · ' + r.tag.label + (r.date !== _currentDate ? ' · ' + _qpDateText(r.date) : '') +
        (r.items.length ? ' · ' + r.items.length + ' item' + (r.items.length > 1 ? 's' : '') : '') +
        (r.shortened ? ' · fits before the next block' : '') + (r.learned ? ' · from history' : '');
    } else {
      const lo = Math.min.apply(null, plan.blocks.map(function (b) { return b.s; })), hi = Math.max.apply(null, plan.blocks.map(function (b) { return b.e; }));
      out.textContent = plan.blocks.length + ' blocks · ' + (plan.dates.length > 1 ? plan.dates.length + ' days' : _toTime(lo) + '–' + _toTime(hi)) + ' · Enter plans all';
    }
    _qpSugUpdate();
  }

  /* ── Suggestion box (history) ── */
  let _qpSug = [], _qpSugI = -1, _qpSugHideT = 0;
  function _qpLineAt(v, pos) {
    const a = v.lastIndexOf('\n', Math.max(0, pos - 1)) + 1, z = v.indexOf('\n', pos);
    return { a: a, z: z < 0 ? v.length : z };
  }
  function _qpSugHide() {
    const box = _el('#tm-qp-sug'), inp = _el('#tm-qp-input');
    _qpSug = []; _qpSugI = -1;
    if (box) { box.hidden = true; box.textContent = ''; }
    if (inp) { inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); }
  }
  function _qpSugUpdate() {
    const inp = _el('#tm-qp-input'), box = _el('#tm-qp-sug');
    if (!inp || !box) return;
    if (document.activeElement !== inp || inp.selectionStart !== inp.selectionEnd) { _qpSugHide(); return; }
    const v = inp.value, pos = inp.selectionStart, ln = _qpLineAt(v, pos), line = v.slice(ln.a, ln.z), rel = pos - ln.a;
    const bar = line.indexOf('|');
    if (bar >= 0 && rel > bar) { _qpSugHide(); return; }                         // caret is in the checklist part
    const sc = _qpScan((bar < 0 ? line : line.slice(0, bar)).replace(QP_BULLET, '').replace(/\s+/g, ' ').trim());
    if (sc.error || !sc.words.length) { _qpSugHide(); return; }
    const list = _qpSuggest(sc.words.join(' '));
    const typed = _qpPlain(sc.words.join(' ')), explicit = !!sc.tag && (sc.dur !== null || sc.end !== null);
    if (!list.length || (list.length === 1 && list[0].key === typed && explicit)) { _qpSugHide(); return; }   // exact match and nothing left to add
    _qpSug = list;
    if (_qpSugI >= list.length) _qpSugI = -1;
    box.textContent = '';
    list.forEach(function (it, i) {
      const li = document.createElement('li'), tg = _tagById(it.h.tagId) || FALLBACK_TAG;
      li.id = 'tm-qp-sug-' + i; li.setAttribute('role', 'option'); li.setAttribute('data-i', String(i));
      li.setAttribute('aria-selected', i === _qpSugI ? 'true' : 'false');
      li.style.setProperty('--tm-c', _safeColor(tg.color));
      const dot = document.createElement('i'); dot.className = 'hub-tm-qp-sug-dot'; li.appendChild(dot);
      const t = document.createElement('b'); t.className = 'hub-tm-qp-sug-title'; t.textContent = it.h.title; li.appendChild(t);
      const m = document.createElement('span'); m.className = 'hub-tm-qp-sug-meta';
      m.textContent = tg.label + ' · ' + _fmtDur(it.h.dur || it.h.lastDur) + (it.h.n > 1 ? ' · ' + it.h.n + '×' : ''); li.appendChild(m);
      box.appendChild(li);
    });
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    if (_qpSugI >= 0) inp.setAttribute('aria-activedescendant', 'tm-qp-sug-' + _qpSugI); else inp.removeAttribute('aria-activedescendant');
  }
  function _qpSugMove(dir) {
    if (!_qpSug.length) return;
    _qpSugI = _qpSugI < 0 ? (dir > 0 ? 0 : _qpSug.length - 1) : (_qpSugI + dir + _qpSug.length) % _qpSug.length;
    _qpSugUpdate();
  }
  /** Replace the line under the caret with "<lead> <len> #tag Title | items" — tokens already typed are kept. */
  function _qpAccept(i) {
    const inp = _el('#tm-qp-input'), it = _qpSug[i];
    if (!inp || !it) return false;
    const v = inp.value, ln = _qpLineAt(v, inp.selectionStart), line = v.slice(ln.a, ln.z);
    const bar = line.indexOf('|'), headRaw = (bar < 0 ? line : line.slice(0, bar)).replace(QP_BULLET, '').replace(/\s+/g, ' ').trim();
    const tail = bar < 0 ? '' : line.slice(bar + 1).trim();
    const sc = _qpScan(headRaw);
    if (sc.error) return false;
    const parts = sc.lead.slice();
    if (sc.dur === null && sc.end === null && (it.h.dur || it.h.lastDur)) parts.push(_qpDurTok(it.h.dur || it.h.lastDur));
    const tg = sc.tag || _tagById(it.h.tagId);
    if (tg) parts.push(sc.tagTok || '#' + (/^\S+$/.test(tg.label) ? tg.label.toLowerCase() : tg.id));
    parts.push(it.h.title);
    let out = parts.join(' ');
    if (tail) out += ' | ' + tail;
    else if (it.h.items.length) out += ' | ' + it.h.items.join('; ');
    inp.value = v.slice(0, ln.a) + out + v.slice(ln.z);
    const caret = ln.a + out.length;
    inp.setSelectionRange(caret, caret);
    _qpSugHide();
    _qpUpdate();
    return true;
  }

  /* ── Submit ── */
  function _qpSubmit(opts) {
    const inp = _el('#tm-qp-input');
    if (!inp) return;
    opts = opts || {};
    const plan = _qpPlan(inp.value);
    if (plan.empty) return;
    const clear = function () { inp.value = ''; _qpSugHide(); _qpUpdate(); };
    if (!plan.blocks.length && !plan.errors.length) {                        // only a date → just go there
      if (plan.jump) { _setDate(plan.jump); clear(); _toast('Showing ' + _qpDateText(plan.jump)); }
      return;
    }
    if (plan.errors.length && !opts.skipInvalid) { _qpUpdate(); return; }
    if (!plan.blocks.length) { _qpUpdate(); return; }
    const made = [];
    plan.blocks.forEach(function (p, k) {
      const b = _normBlock({
        id: _newId(k), date: p.date, tagId: p.tagId, startTime: _toTime(p.s), endTime: _toTime(p.e),
        title: p.title, subtitle: '', createdAt: Date.now() + k,
        checklist: p.items.slice(0, CK_MAX).map(function (t) { return { text: t }; })
      });
      if (b) made.push(b);
    });
    if (!made.length) return;
    made.forEach(function (b) { _timeBlocks.push(b); });
    _qpHN = -1;                                                              // history learns from the new blocks
    _scheduleSave();
    const dates = plan.dates;
    if (dates.length === 1 && dates[0] !== _currentDate) _setDate(dates[0]);
    else if (_view === 'day') { _renderDayBlocks(); _updateSummary(); }
    else _renderGrid({ animate: false, scroll: false });
    if (_view === 'day') {
      const mine = made.find(function (b) { return b.date === _currentDate; });
      if (mine) {
        _dropFx(mine.id);
        const n = _el('.hub-tm-block[data-block-id="' + mine.id + '"]');
        if (n) { try { n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
      }
    }
    _tlRefresh();
    clear();
    const skipped = plan.errors.length;
    const msg = made.length === 1
      ? 'Planned ' + made[0].startTime + '–' + made[0].endTime + ' · ' + made[0].title + (made[0].date !== _currentDate ? ' · ' + _qpDateText(made[0].date) : '')
      : 'Planned ' + made.length + ' blocks · ' + (dates.length > 1 ? dates.length + ' days' : made[0].startTime + '–' + made[made.length - 1].endTime) + (skipped ? ' · skipped ' + skipped : '');
    _toast(msg, {
      action: 'Undo',
      onAction: function () {
        const ids = {};
        made.forEach(function (b) { ids[b.id] = 1; });
        _timeBlocks = _timeBlocks.filter(function (x) { return !ids[x.id]; });
        _qpHN = -1;
        _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
        _tlRefresh();
      }
    });
  }

  function _bindQuickPlan() {
    const form = _el('#hub-tm-qp'), inp = _el('#tm-qp-input'), box = _el('#tm-qp-sug');
    if (!form || !inp) return;
    const sig = { signal: _ui.signal };
    inp.addEventListener('input', function () { _qpSugI = -1; _qpUpdate(); }, sig);
    inp.addEventListener('focus', function () { _qpUpdate(); }, sig);
    inp.addEventListener('blur', function () { clearTimeout(_qpSugHideT); _qpSugHideT = setTimeout(_qpSugHide, 140); }, sig);
    inp.addEventListener('click', _qpSugUpdate, sig);
    inp.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') _qpSugUpdate();
    }, sig);
    inp.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;                        // IME (Telex/VNI) composing — Enter belongs to the IME
      const open = !!(box && !box.hidden && _qpSug.length);
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (open) _qpSugHide();
        else if (inp.value) { inp.value = ''; _qpUpdate(); }
        else inp.blur();
        return;
      }
      if (open && e.key === 'ArrowDown') { e.preventDefault(); _qpSugMove(1); return; }
      if (open && e.key === 'ArrowUp') { e.preventDefault(); _qpSugMove(-1); return; }
      if (open && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); _qpAccept(_qpSugI >= 0 ? _qpSugI : 0); return; }
      if (e.key === 'Enter') {
        if (e.shiftKey) return;                                              // Shift+Enter = new line
        e.preventDefault();
        if (open && _qpSugI >= 0) { _qpAccept(_qpSugI); return; }            // an arrow-picked suggestion
        _qpSubmit({ skipInvalid: e.ctrlKey || e.metaKey });
      }
    }, sig);
    inp.addEventListener('paste', function (e) {                             // paste a whole plan: tidy bullets/numbers, keep the lines
      const t = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).getData('text') : '';
      if (!t || (!/[\r\n]/.test(t) && !QP_BULLET.test(t))) return;
      e.preventDefault();
      const clean = t.replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, '').replace(QP_BULLET, ''); }).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
      inp.setRangeText(clean, inp.selectionStart, inp.selectionEnd, 'end');
      _qpUpdate();
    }, sig);
    if (box) {
      box.addEventListener('mousedown', function (e) { e.preventDefault(); }, sig);       // keep focus in the box
      box.addEventListener('click', function (e) {
        const li = e.target.closest && e.target.closest('li[data-i]');
        if (li) { _qpAccept(parseInt(li.getAttribute('data-i'), 10)); inp.focus(); }
      }, sig);
    }
    const ico = form.querySelector('.hub-tm-qp-ico');
    if (ico) ico.addEventListener('click', function () { inp.focus(); }, sig);
    form.addEventListener('submit', function (e) { e.preventDefault(); _qpSubmit(); }, sig);
    _qpUpdate();
  }

  function _onGridClick(e) {
    if (performance.now() < _suppressClickUntil) return;
    const tg = e.target.closest('.hub-tm-bk-toggle');
    if (tg) {
      const te = tg.closest('.hub-tm-block'), tb = te && _blockById(te.getAttribute('data-block-id'));
      if (tb) _bkToggle(te, tb);
      return;
    }
    const pn = e.target.closest('.hub-tm-bk-panel');
    if (pn) {
      const pe = pn.closest('.hub-tm-block'), pid = pe && pe.getAttribute('data-block-id');
      if (e.target.closest('[data-bk-edit]')) _openDetails(pid);
      else if (e.target.closest('[data-bk-complete]')) _habToggleDone(pid);
      return;                                                         // ticking / reading never opens the editor
    }
    const chk = e.target.closest('.hub-tm-block-check');
    if (chk) {
      const ce = chk.closest('.hub-tm-block');
      if (ce) _habToggleDone(ce.getAttribute('data-block-id'));
      return;
    }
    const del = e.target.closest('.hub-tm-block-delete');
    if (del) {
      const el = del.closest('.hub-tm-block');
      if (el) _quickDelete(el.getAttribute('data-block-id'));
      return;
    }
    const bEl = e.target.closest('.hub-tm-block, .hub-tm-week-block');
    if (bEl) { _openDetails(bEl.getAttribute('data-block-id')); return; }
    const goEl = e.target.closest('[data-activate]');
    if (goEl) { _setDate(goEl.getAttribute('data-date'), { view: 'day' }); return; }
    const col = e.target.closest('.hub-tm-week-day');
    if (col) {
      const r = col.getBoundingClientRect();
      _setDate(col.getAttribute('data-date'), { view: 'day', scrollMins: _clamp((e.clientY - r.top) / HOUR_H * 60, 0, DAY_MINS) });
    }
  }

  /** Tick a checklist item straight from the block. Updates in place so the drawer stays open. */
  function _onGridChange(e) {
    const cb = e.target.closest && e.target.closest('[data-bk-ck]');
    if (!cb) return;
    const el = cb.closest('.hub-tm-block'), b = el && _blockById(el.getAttribute('data-block-id'));
    const it = b && _ck(b).find(function (i) { return i.id === cb.getAttribute('data-bk-ck'); });
    if (!it) return;
    it.done = cb.checked;
    const row = cb.closest('.hub-tm-bk-row'); if (row) row.classList.toggle('is-done', cb.checked);
    _scheduleSave();
    _fckSig = '';
    _bkRefresh(el, b);
    _tlRefresh();
    _ckNudge(b);
  }

  function _onGridKey(e) {
    const t = e.target;
    if (!t.classList) return;
    if (e.key === 'Escape' && t.closest) {                            // Esc rolls an opened checklist back up
      const oe = t.closest('.hub-tm-block.is-open'), ob = oe && _blockById(oe.getAttribute('data-block-id'));
      if (ob) { e.preventDefault(); _bkToggle(oe, ob); const tg = oe.querySelector('.hub-tm-bk-toggle'); if (tg) tg.focus({ preventScroll: true }); return; }
    }
    if (t.hasAttribute('data-activate') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      _setDate(t.getAttribute('data-date'), { view: 'day' });
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-bk-new')) {           // drawer input: Enter adds, Enter on empty finishes
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const el = t.closest('.hub-tm-block'), b = el && _blockById(el.getAttribute('data-block-id'));
      if (!b) return;
      if (t.value.trim()) _bkAddItems(el, b, [t.value]);
      else { _bkToggle(el, b); el.focus({ preventScroll: true }); }
      return;
    }
    if (!t.classList.contains('hub-tm-block') && !t.classList.contains('hub-tm-week-block')) return;
    const id = t.getAttribute('data-block-id'), b = _blockById(id);
    if (!b) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _openDetails(id); return; }
    if (!t.classList.contains('hub-tm-block')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); _quickDelete(id); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1, nb = _neighbourBounds(b);
    let s = _toMins(b.startTime), en = _toMins(b.endTime);
    if (e.shiftKey) en = _clamp(en + dir * SNAP, s + MIN_DUR, nb[1]);
    else { const dur = en - s; s = _clamp(s + dir * SNAP, nb[0], nb[1] - dur); en = s + dur; }
    b.startTime = _toTime(s); b.endTime = _toTime(en);
    _scheduleSave();
    _renderDayBlocks();
    _updateSummary();
    _focusBlock(id);
  }

  function _quickDelete(id) {
    const i = _timeBlocks.findIndex(function (b) { return b.id === id; });
    if (i < 0) return;
    const removed = _timeBlocks.splice(i, 1)[0];
    _scheduleSave();
    _renderDayBlocks();
    _updateSummary();
    _toast('Deleted “' + (removed.title || 'block') + '”', {
      action: 'Undo',
      onAction: function () {
        if (_overlap(removed.date, _toMins(removed.startTime), _toMins(removed.endTime))) { _toast('Can’t restore — that time is taken now.'); return; }
        _timeBlocks.push(removed);
        _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
      }
    });
  }

  /* ============================================================
     BLOCK DETAILS DIALOG
     ============================================================ */
  function _bindDetails() {
    const modal = _el('#hub-tm-details-modal');
    const editor = _el('#block-desc-editor');
    const err = _el('#hub-tm-details-error');

    _el('#tm-btn-details-save').addEventListener('click', _saveDetails);
    _el('#tm-btn-details-inbox').addEventListener('click', function () { _blockToInbox(_editingId); });
    _el('#tm-btn-details-delete').addEventListener('click', function () {
      const b = _blockById(_editingId);
      if (!b) return;
      _confirm('Delete “' + (b.title || _tagOrFallback(b.tagId).label) + '”?', function () {
        _timeBlocks = _timeBlocks.filter(function (x) { return x.id !== b.id; });
        _scheduleSave();
        _closeModal(modal);
        _renderGrid({ animate: false, scroll: false });
        _tlRefresh();
      }, { title: 'Delete block?' });
    });
    _el('#tm-details-title').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _saveDetails(); } });
    ['#tm-details-date', '#tm-details-start', '#tm-details-end'].forEach(function (s) {
      _el(s).addEventListener('input', function () { err.textContent = ''; _syncDetails(); });
    });
    _el('#tm-details-title').addEventListener('input', _syncDetails);
    _el('#tm-details-done').addEventListener('change', _syncDetails);
    _el('.hub-tm-quick').addEventListener('click', function (e) {          // quick length: End = Start + n
      const q = e.target.closest('.hub-tm-quick-btn');
      if (!q) return;
      const st = _el('#tm-details-start');
      if (!st.value) st.value = '09:00';
      const end = Math.min(DAY_MINS, _toMins(st.value) + parseInt(q.getAttribute('data-dur'), 10));
      _el('#tm-details-end').value = end >= DAY_MINS ? '00:00' : _toTime(end);
      err.textContent = '';
      _syncDetails();
    });

    _el('#hub-tm-details-tags').addEventListener('click', function (e) {
      const p = e.target.closest('.hub-tm-tag-pick');
      if (!p) return;
      _all('#hub-tm-details-tags .hub-tm-tag-pick').forEach(function (n) { n.setAttribute('aria-pressed', String(n === p)); });
      _syncDetails();
    });

    // Rich-text toolbar: keep the editor's selection when buttons are pressed
    const bar = _el('#hub-tm-rich-toolbar');
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('.hub-tm-rich-btn')) e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      const btn = e.target.closest('.hub-tm-rich-btn');
      if (!btn) return;
      editor.focus();
      try { document.execCommand(btn.getAttribute('data-cmd'), false, null); } catch (_) {}
    });
    const saveRange = function () {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) _savedRange = sel.getRangeAt(0).cloneRange();
    };
    ['keyup', 'mouseup', 'focusout', 'input'].forEach(function (n) { editor.addEventListener(n, saveRange); });
    _el('#hub-tm-rich-color').addEventListener('input', function (e) {
      editor.focus();
      if (_savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(_savedRange); }
      try { document.execCommand('foreColor', false, e.target.value); } catch (_) {}
    });
    editor.addEventListener('paste', function (e) {            // plain text only
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
      try { document.execCommand('insertText', false, txt); } catch (_) {}
    });
  }

  function _openDetails(id) {
    const b = _blockById(id);
    if (!b) return;
    _editingId = id;
    _el('#tm-details-title').value = b.title || '';
    _el('#tm-details-date').value = b.date;
    _el('#tm-details-start').value = _toTime(_toMins(b.startTime));
    _el('#tm-details-end').value = b.endTime === '24:00' ? '00:00' : b.endTime;
    _el('#hub-tm-details-error').textContent = '';
    _el('#block-desc-editor').innerHTML = _sanitizeHtml(b.subtitle);
    _el('#tm-details-done').checked = !!b.done;
    _ckOpen(b);
    _el('#tm-details-habstate').textContent = !_habOn() ? '' : b.habiticaId ? (b.habDone ? 'Completed in Habitica. Un-checking takes the gold back.' : 'Linked to a Habitica To-Do due when this block ends.') : 'Not in Habitica yet — it joins your next sync.';
    _savedRange = null;
    _el('#hub-tm-details-tags').innerHTML = _allTags().map(function (t) {
      return '<button type="button" class="hub-tm-tag-pick" style="' + _tagStyle(t) + '" data-tag-id="' + _esc(t.id) + '" aria-pressed="' + (t.id === b.tagId) + '"><span class="hub-tm-tag-dot"></span>' + _esc(t.label) + '</button>';
    }).join('');
    _syncDetails();
    _openModal(_el('#hub-tm-details-modal'), '#tm-details-title');
    _el('#tm-details-title').select();
  }

  /* Live header, colour, status pills and the 24-hour context strip */
  function _syncDetails() {
    const b = _blockById(_editingId), dlg = _el('#hub-tm-details-modal .hub-tm-inspector');
    if (!b || !dlg) return;
    const pick = _el('#hub-tm-details-tags .hub-tm-tag-pick[aria-pressed="true"]');
    const tag = _tagOrFallback(pick ? pick.getAttribute('data-tag-id') : b.tagId);
    dlg.style.setProperty('--tm-c', _safeColor(tag.color));
    dlg.style.setProperty('--tm-k', _tint(tag));

    const date = _el('#tm-details-date').value, st = _el('#tm-details-start').value, en = _el('#tm-details-end').value;
    const dateOk = _isDateStr(date);
    const s = _toMins(st);
    let e = _toMins(en);
    if (e === 0 && s > 0) e = DAY_MINS;
    const timeOk = !!(st && en) && e > s;
    const d = dateOk ? _parseDate(date) : null;

    _el('#tm-details-eyebrow').textContent = tag.label + (d ? ' · ' + DAY_SHORT[d.getDay()] + ', ' + _dateLabel(d) + (date === _todayStr() ? ' · Today' : '') : '');
    _el('#tm-details-range').textContent = timeOk ? st + ' – ' + (e === DAY_MINS ? '24:00' : en) : '--:-- – --:--';
    _el('#tm-details-len').textContent = timeOk ? _fmtDur(e - s) : '—';

    const pill = _el('#tm-details-status');
    let state = 'upcoming', label = 'Upcoming';
    if (_el('#tm-details-done').checked) { state = 'done'; label = 'Completed'; }
    else if (!timeOk || !dateOk) { state = 'warn'; label = 'Check times'; }
    else {
      const now = Date.now();
      if (now >= _ms(date, e)) { state = 'ended'; label = 'Ended'; }
      else if (now >= _ms(date, s)) { state = 'live'; label = 'In progress'; }
    }
    pill.className = 'hub-tm-pill hub-tm-pill--status is-' + state;
    pill.textContent = label;

    // 24-hour strip: the day's other blocks, plus this one (red if it collides)
    const track = _el('#tm-details-track');
    const clash = dateOk && timeOk ? _overlap(date, s, e, b.id) : null;
    let html = '';
    if (dateOk) {
      _others(date, b.id).forEach(function (o) {
        html += '<i class="hub-tm-strip-seg" title="' + _esc(o.b.title || _tagOrFallback(o.b.tagId).label) + '" style="' + _tagStyle(_tagOrFallback(o.b.tagId)) + ';left:' + (o.s / DAY_MINS * 100) + '%;width:' + Math.max(0.6, (o.e - o.s) / DAY_MINS * 100) + '%"></i>';
      });
    }
    if (timeOk) html += '<i class="hub-tm-strip-cur' + (clash ? ' is-clash' : '') + '" style="left:' + (s / DAY_MINS * 100) + '%;width:' + Math.max(0.8, (e - s) / DAY_MINS * 100) + '%"></i>';
    track.innerHTML = html;
    const note = _el('#tm-details-strip-note');
    note.classList.toggle('is-clash', !!clash);
    note.textContent = clash ? 'Overlaps “' + (clash.title || _tagOrFallback(clash.tagId).label) + '” (' + clash.startTime + '–' + clash.endTime + ')' :
      (dateOk && timeOk ? (_others(date, b.id).length ? 'Fits between your other blocks on this day.' : 'Nothing else planned on this day.') : '');
  }

  function _saveDetails() {
    const b = _blockById(_editingId), err = _el('#hub-tm-details-error');
    if (!b) return;
    const date = _el('#tm-details-date').value;
    const st = _el('#tm-details-start').value, en = _el('#tm-details-end').value;
    if (!_isDateStr(date)) { err.textContent = 'Pick a valid date.'; return; }
    if (!st || !en) { err.textContent = 'Set both a start and an end time.'; return; }
    const s = _toMins(st);
    let e = _toMins(en);
    if (e === 0 && s > 0) e = DAY_MINS;                    // 00:00 as an end = midnight
    if (e <= s) { err.textContent = 'End time must be after the start time.'; return; }
    const clash = _overlap(date, s, e, b.id);
    if (clash) { err.textContent = 'Overlaps “' + (clash.title || _tagOrFallback(clash.tagId).label) + '” (' + clash.startTime + '–' + clash.endTime + ').'; return; }

    const wantDone = _el('#tm-details-done').checked;
    if (wantDone && !b.done && _habOn() && _habStartMs({ date: date, startTime: _toTime(s) }) > Date.now()) { err.textContent = 'This block hasn’t started yet — do the work first, then check it off.'; return; }
    const pick = _el('#hub-tm-details-tags .hub-tm-tag-pick[aria-pressed="true"]');
    const ed = _el('#block-desc-editor');
    b.date = date;
    b.startTime = _toTime(s);
    b.endTime = _toTime(e);
    if (pick) b.tagId = pick.getAttribute('data-tag-id');
    b.title = _el('#tm-details-title').value.trim() || _tagOrFallback(b.tagId).label;
    b.subtitle = ed.textContent.trim() ? _sanitizeHtml(ed.innerHTML) : '';
    _ckCommit(b);
    b.done = wantDone;
    if (!wantDone) b.gp = 0;
    _scheduleSave();
    _closeModal(_el('#hub-tm-details-modal'));
    _renderGrid({ animate: false, scroll: false });
    _tlRefresh();                                  // opened from the Timeline? keep it in step
  }

  /* ============================================================
     CONFIRM
     ============================================================ */
  function _confirm(msg, cb, opts) {
    opts = opts || {};
    _confirmCb = cb;
    _confirmCancelCb = opts.onCancel || null;
    _el('#hub-tm-confirm-title').textContent = opts.title || 'Are you sure?';
    _el('#hub-tm-confirm-msg').textContent = msg;
    _el('#tm-btn-confirm-delete').textContent = opts.label || 'Delete';
    _openModal(_el('#hub-tm-confirm-modal'), '#tm-btn-confirm-cancel');   // Cancel gets focus: safer default
  }
  function _closeConfirm() { _confirmCb = null; _confirmCancelCb = null; _closeModal(_el('#hub-tm-confirm-modal')); }
  function _bindConfirm() {
    _el('#tm-btn-confirm-cancel').addEventListener('click', function () { const c = _confirmCancelCb; _closeConfirm(); if (typeof c === 'function') c(); });
    _el('#tm-btn-confirm-delete').addEventListener('click', function () {
      const cb = _confirmCb;
      _closeConfirm();
      if (typeof cb === 'function') cb();
    });
  }

  /* ============================================================
     TOAST
     ============================================================ */
  function _bindToast() {
    _el('.hub-tm-toast-action').addEventListener('click', function () {
      const t = _el('#hub-tm-toast'), cb = t._cb;
      t._cb = null;
      t.classList.remove('is-visible');
      if (typeof cb === 'function') cb();
    });
  }
  function _toast(msg, opts) {
    const t = _el('#hub-tm-toast');
    if (!t) return;
    opts = opts || {};
    if (_toastTimer) clearTimeout(_toastTimer);
    t.querySelector('.hub-tm-toast-msg').textContent = msg;
    const a = t.querySelector('.hub-tm-toast-action');
    a.hidden = !opts.action;
    a.textContent = opts.action || '';
    t._cb = opts.onAction || null;
    t.classList.add('is-visible');
    _toastTimer = setTimeout(function () { t.classList.remove('is-visible'); t._cb = null; _toastTimer = null; }, opts.action ? 5000 : 2600);
  }

  /* ============================================================
     WEEKLY REVIEW  ·  what was planned vs what was really done
     Pure read-out of the blocks (follows sync and Habitica for free).
     ============================================================ */
  let _rvOff = 0, _rvText = '';
  function _rvWeek(off) {
    const mon = _addDays(_weekStart(_todayStr()), off * 7), days = [];
    for (let i = 0; i < 7; i++) days.push(_dateToStr(_addDays(mon, i)));
    return { mon: mon, days: days };
  }
  function _rvAgg(days) {
    const stats = _dayStats(), per = {}, set = {};
    days.forEach(function (d) { set[d] = 1; });
    let p = 0, d = 0;
    const rows = days.map(function (ds) { const s = stats[ds] || { p: 0, d: 0 }; p += s.p; d += s.d; return { ds: ds, p: s.p, d: s.d }; });
    _timeBlocks.forEach(function (b) {
      if (!set[b.date]) return;
      const m = Math.max(0, _toMins(b.endTime) - _toMins(b.startTime));
      if (!m) return;
      const t = per[b.tagId] || (per[b.tagId] = { p: 0, d: 0 });
      t.p += m; if (b.done) t.d += m;
    });
    return { rows: rows, p: p, d: d, per: per };
  }
  function _rvLabel(off, w) {
    const end = _addDays(w.mon, 6), range = _dateLabel(w.mon) + ' – ' + _dateLabel(end);
    return (off === 0 ? 'This week' : off === -1 ? 'Last week' : Math.abs(off) + ' weeks ago') + '<small>' + range + '</small>';
  }
  function _renderReview() {
    const box = _el('#hub-tm-review-body');
    if (!box) return;
    const today = _todayStr(), w = _rvWeek(_rvOff), A = _rvAgg(w.days), B = _rvAgg(_rvWeek(_rvOff - 1).days), sk = _streakInfo();
    const need = Math.round(STREAK_MIN * 100), pct = A.p ? Math.round(A.d / A.p * 100) : 0;
    const planned = w.days.filter(function (ds) { return (sk.stats[ds] || {}).p; });
    const hits = planned.filter(function (ds) { return sk.state[ds] === 'hit'; }).length;
    const dm = A.d - B.d, tier = _tierAt(sk.cur);
    const delta = (!A.d && !B.d) ? '' : (dm === 0 ? 'Same as the week before' : (dm > 0 ? '▲ +' : '▼ −') + _fmtDur(Math.abs(dm)) + ' vs week before');
    const kpi = function (k, v, sub, extra) { return '<div class="hub-tm-rv-kpi' + (extra || '') + '"><span class="hub-tm-stat-k">' + k + '</span><strong>' + v + '</strong><span class="hub-tm-rv-sub">' + sub + '</span></div>'; };

    const nav = '<div class="hub-tm-rv-nav">' +
      '<button type="button" class="hub-tm-date-nav" data-rv="-1" aria-label="Previous week" title="Previous week">' + ICON.prev + '</button>' +
      '<div class="hub-tm-rv-range" aria-live="polite">' + _rvLabel(_rvOff, w) + '</div>' +
      '<button type="button" class="hub-tm-date-nav" data-rv="1" aria-label="Next week" title="Next week"' + (_rvOff >= 0 ? ' disabled' : '') + '>' + ICON.next + '</button>' +
      '<button type="button" class="hub-tm-btn" data-rv="0"' + (_rvOff === 0 ? ' disabled' : '') + '>This week</button></div>';

    if (!A.p) {
      _rvText = '';
      box.innerHTML = nav + '<div class="hub-tm-rv-empty"><b>Nothing planned this week</b><span>Drag on the grid to plan time, then check blocks off — the review fills itself in.</span></div>';
      return;
    }

    const kpis = '<div class="hub-tm-rv-kpis">' +
      kpi('Completion', pct + '%', 'Done ' + _fmtDur(A.d) + ' of ' + _fmtDur(A.p) + '<i class="hub-tm-rv-meter' + (pct >= need ? ' is-hit' : '') + '" style="--p:' + Math.min(100, pct) + '"></i>') +
      kpi('Time done', _fmtDur(A.d), delta || '&nbsp;', dm > 0 ? ' is-up' : dm < 0 ? ' is-down' : '') +
      kpi('On target', hits + '/' + planned.length, 'days at ≥ ' + need + '%') +
      '<div class="hub-tm-rv-kpi hub-tm-rv-kpi--streak"' + (tier ? ' data-tier="' + tier.k + '"' : '') + '><span class="hub-tm-stat-k">Streak now</span><strong>' + ICON.flame + sk.cur + 'd' + (tier ? '<em class="hub-tm-ms-tier">' + tier.name + '</em>' : '') + '</strong><span class="hub-tm-rv-sub">Best ' + sk.best + ' days</span></div>' +
      '</div>';

    const maxP = Math.max(60, Math.max.apply(null, A.rows.map(function (r) { return r.p; })));
    const days = '<div class="hub-tm-rv-days" role="img" aria-label="Planned versus done time per day">' + A.rows.map(function (r, i) {
      const st = sk.state[r.ds], cls = (r.ds === today ? ' is-today' : '') + (st === 'hit' ? ' is-hit' : '') + (st === 'miss' ? ' is-miss' : '') + (r.ds > today ? ' is-future' : '');
      return '<div class="hub-tm-rv-day' + cls + '"><span class="hub-tm-rv-dv">' + (r.p ? _fmtDur(r.d) : '') + '</span>' +
        '<div class="hub-tm-rv-col" title="' + DAY_SHORT[(i + 1) % 7] + ' · done ' + _fmtDur(r.d) + ' of ' + _fmtDur(r.p) + '">' +
        (r.p ? '<i class="hub-tm-rv-plan" style="height:' + Math.round(r.p / maxP * 100) + '%"></i><i class="hub-tm-rv-done" style="height:' + Math.round(r.d / maxP * 100) + '%"></i>' : '') + '</div>' +
        '<span class="hub-tm-rv-dl">' + DAY_SHORT[(i + 1) % 7] + '</span></div>';
    }).join('') + '</div>';

    const tagIds = Object.keys(A.per).sort(function (a, b) { return A.per[b].p - A.per[a].p; });
    const maxT = A.per[tagIds[0]].p;
    const tags = '<ul class="hub-tm-rv-tags">' + tagIds.map(function (id) {
      const t = _tagOrFallback(id), v = A.per[id];
      return '<li style="' + _tagStyle(t) + '"><span class="hub-tm-tag-dot"></span><span class="hub-tm-rv-tn">' + _esc(t.label) + '</span>' +
        '<span class="hub-tm-rv-tv"><b>' + _fmtDur(v.d) + '</b> / ' + _fmtDur(v.p) + '</span>' +
        '<span class="hub-tm-rv-track"><span style="width:' + Math.round(v.p / maxT * 100) + '%"><i style="width:' + Math.round(v.d / v.p * 100) + '%"></i></span></span></li>';
    }).join('') + '</ul>';

    // Insights: only days with real plans (>= 30 min) that are not still ahead of us
    const past = A.rows.filter(function (r) { return r.p >= 30 && r.ds <= today; }).map(function (r) { const i = A.rows.indexOf(r); return { n: DAY_FULL[(i + 1) % 7], v: r.d / r.p, p: r.p, ds: r.ds }; });
    const ins = [];
    if (past.length) {
      const best = past.slice().sort(function (a, b) { return b.v - a.v || b.p - a.p; })[0];
      ins.push(['Best day', best.n + ' · ' + Math.round(best.v * 100) + '% of ' + _fmtDur(best.p)]);
      const weak = past.filter(function (x) { return x.ds < today && x.v < STREAK_MIN; }).sort(function (a, b) { return a.v - b.v; })[0];
      if (weak) ins.push(['Needs attention', weak.n + ' · only ' + Math.round(weak.v * 100) + '% done']);
    }
    const topDone = tagIds.slice().sort(function (a, b) { return A.per[b].d - A.per[a].d; })[0];
    if (A.per[topDone].d) ins.push(['Most time on', _tagOrFallback(topDone).label + ' · ' + _fmtDur(A.per[topDone].d)]);
    const insHtml = ins.length ? '<ul class="hub-tm-rv-ins">' + ins.map(function (x) { return '<li><span class="hub-tm-rv-ik">' + x[0] + '</span><span>' + _esc(x[1]) + '</span></li>'; }).join('') + '</ul>' : '';

    _rvText = 'Weekly review · ' + _dateLabel(w.mon) + ' – ' + _dateLabel(_addDays(w.mon, 6)) + '\n' +
      'Completion ' + pct + '% (' + _fmtDur(A.d) + ' of ' + _fmtDur(A.p) + ')' + (delta ? ' · ' + delta : '') + '\n' +
      'On target ' + hits + '/' + planned.length + ' days · streak ' + sk.cur + 'd (best ' + sk.best + ')\n' +
      tagIds.map(function (id) { return '• ' + _tagOrFallback(id).label + ': ' + _fmtDur(A.per[id].d) + ' / ' + _fmtDur(A.per[id].p); }).join('\n') +
      (ins.length ? '\n' + ins.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') : '');

    box.innerHTML = nav + kpis +
      '<section class="hub-tm-rv-sec"><h4 class="hub-tm-sec-title">By day<span>planned · done</span></h4>' + days + '</section>' +
      '<section class="hub-tm-rv-sec"><h4 class="hub-tm-sec-title">By tag<span>done / planned</span></h4>' + tags + '</section>' +
      (insHtml ? '<section class="hub-tm-rv-sec"><h4 class="hub-tm-sec-title">Highlights</h4>' + insHtml + '</section>' : '') +
      '<div class="hub-tm-rv-foot"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-rv-copy>Copy summary</button></div>';
  }
  function _openReview() { _rvOff = 0; _renderReview(); _openModal(_el('#hub-tm-review-modal'), '.hub-tm-dialog-close'); }
  function _bindReview() {
    const m = _el('#hub-tm-review-modal');
    if (!m) return;
    m.addEventListener('click', function (e) {
      const n = e.target.closest('[data-rv]');
      if (n) { if (n.disabled) return; const v = n.getAttribute('data-rv'); _rvOff = v === '0' ? 0 : Math.min(0, _rvOff + (+v)); _renderReview(); return; }
      if (e.target.closest('[data-rv-copy]') && _rvText) {
        const ok = function () { _toast('Review copied'); };
        try { navigator.clipboard.writeText(_rvText).then(ok, function () { _toast('Couldn’t copy — select the text manually.'); }); } catch (_) { _toast('Couldn’t copy — select the text manually.'); }
      }
    });
  }


  /* ============================================================
     FOCUS MODE  (always about *today*, live-updating)
     ============================================================ */
  function _openFocus() {
    if (!_fs) _fsSummary = null;
    _fsSig = '';
    _renderFocus();
    _openModal(_el('#hub-tm-focus-panel'), '#tm-btn-focus-exit');
    if (_focusTimer) clearInterval(_focusTimer);
    _focusTimer = setInterval(_renderFocus, 5000);
  }
  function _renderFocus() {
    const p = _el('#hub-tm-focus-panel');
    if (!p) return;
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    const list = _blocksForDate(_todayStr());
    const cur = list.find(function (b) { return nm >= _toMins(b.startTime) && nm < _toMins(b.endTime); });
    const nxt = cur ? null : list.find(function (b) { return _toMins(b.startTime) > nm; });
    const set = function (sel, v) { const n = p.querySelector(sel); if (n) n.textContent = v; };
    const fill = p.querySelector('.hub-tm-focus-fill'), bar = p.querySelector('.hub-tm-focus-bar'), tagEl = p.querySelector('.hub-tm-focus-tag');
    const sb = _fs ? _blockById(_fs.blockId) : null;               // a running session pins the panel to its own block
    const b = sb || cur || nxt;
    p.classList.toggle('is-idle', !cur && !sb);
    p.classList.toggle('is-session', !!sb);
    set('.hub-tm-focus-badge-text', sb ? (_fs.phase === 'break' ? 'BREAK' : _fs.running ? 'FOCUS' : 'PAUSED') : cur ? 'NOW' : nxt ? 'UP NEXT' : 'FREE');
    if (b) {
      const tag = _tagOrFallback(b.tagId), s = _toMins(b.startTime), e = _toMins(b.endTime);
      const inside = nm >= s && nm < e;
      set('.hub-tm-focus-time', b.startTime + ' – ' + b.endTime);
      set('.hub-tm-focus-title', b.title || tag.label);
      set('.hub-tm-focus-note', _plainText(b.subtitle));
      _renderFocusCk(b);
      tagEl.textContent = tag.label;
      tagEl.style.setProperty('--tm-c', _safeColor(tag.color));
      const pct = inside ? _clamp(Math.round((nm - s) / (e - s) * 100), 0, 100) : nm >= e ? 100 : 0;
      fill.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', String(pct));
      set('.hub-tm-focus-label', inside ? pct + '% complete · ' + _fmtDur(e - nm) + ' left' : nm >= e ? 'Block time is up · ' + _fmtDur(nm - e) + ' over' : 'Starts in ' + _fmtDur(s - nm));
    } else {
      set('.hub-tm-focus-time', '');
      set('.hub-tm-focus-title', 'No active block');
      set('.hub-tm-focus-note', 'You’re free right now.');
      _renderFocusCk(null);
      tagEl.textContent = '';
      fill.style.width = '0%';
      bar.setAttribute('aria-valuenow', '0');
      set('.hub-tm-focus-label', 'Nothing else scheduled today');
    }
    _fsPaint();
  }

  /* ============================================================
     FOCUS SESSION
     Everything is computed from timestamps (never from counting ticks), so a throttled
     background tab or a reload cannot make the clock drift.
       accMs    focus time already banked      segStart  when the running stretch began
       phaseAcc time spent in the current phase before that stretch (Pomodoro / Deep work)
       beat     last moment we know the page was alive (used to detect sleep / a closed page)
     ============================================================ */
  function _fsPhaseLen(s) {                                   // ms, 0 = no phases (plain timer)
    const m = FS_MODES[s.mode];
    if (!m || !m.work) return 0;
    if (s.phase === 'work') return m.work * 60000;
    return ((m.every && s.cycles > 0 && s.cycles % m.every === 0) ? m.long : m.brk) * 60000;
  }
  function _fsFocusMs(s, now) { return s.accMs + (s.running && s.phase === 'work' ? Math.max(0, now - s.segStart) : 0); }
  function _fsPhaseMs(s, now) { return s.phaseAcc + (s.running ? Math.max(0, now - s.segStart) : 0); }
  function _fsClock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
    return (h ? h + ':' + _pad(m) : _pad(m)) + ':' + _pad(sec);
  }
  function _fsKey() { return FS_KEY + ':' + (_dataUid || 'guest'); }
  function _fsPersist() {
    try { if (_fs) localStorage.setItem(_fsKey(), JSON.stringify(_fs)); else localStorage.removeItem(_fsKey()); } catch (_) {}
  }
  function _fsEnsureTimer() { if (_fs && !_fsTimer) _fsTimer = setInterval(_fsTick, 1000); }

  /** Move through any phase boundaries that passed (also when the tab was in the background). */
  function _fsAdvance(now) {
    const s = _fs;
    if (!s || !s.running) return false;
    let moved = false, guard = 0;
    while (s.running && guard++ < 100) {
      const L = _fsPhaseLen(s);
      if (!L) break;
      const pm = s.phaseAcc + (now - s.segStart);
      if (pm < L) break;
      const endAt = now - (pm - L);                         // the exact moment the phase ended
      if (s.phase === 'work') { s.accMs += Math.max(0, endAt - s.segStart); s.cycles++; s.phase = 'break'; }
      else s.phase = 'work';
      s.phaseAcc = 0; s.segStart = endAt; moved = true;
    }
    return moved;
  }
  function _fsBank(now) {                                   // stop the running stretch and bank it
    const s = _fs;
    if (!s || !s.running) return;
    const seg = Math.max(0, now - s.segStart);
    if (s.phase === 'work') s.accMs += seg;
    s.phaseAcc += seg;
    s.running = false;
  }
  function _fsCue(type) {
    try { if (navigator.vibrate) navigator.vibrate(type === 'end' ? [160, 80, 160] : 120); } catch (_) {}
    try {
      const b = _fs && _blockById(_fs.blockId);
      if (_audio.enabled && _armed() && _ctx) _playCue({ type: type, tagId: b ? b.tagId : null }, _ctx.currentTime + 0.05);
    } catch (_) {}
  }

  function _fsStart(blockId, mode) {
    const b = _blockById(blockId);
    if (!b) return false;
    const now = Date.now();
    if (!FS_MODES[mode]) mode = 'block';
    _fs = { id: 'fs-' + now, blockId: blockId, mode: mode, running: true, phase: 'work', segStart: now, phaseAcc: 0, accMs: 0, cycles: 0, startedAt: now, beat: now };
    _fsSummary = null; _fsMiss = 0;
    _fsPersist(); _fsEnsureTimer(); _renderFocus();
    return true;
  }
  function _fsPause() {
    if (!_fs || !_fs.running) return;
    const now = Date.now();
    _fsAdvance(now); _fsBank(now);
    _fsPersist(); _renderFocus();
  }
  function _fsResume() {
    if (!_fs || _fs.running) return;
    _fs.running = true; _fs.segStart = _fs.beat = Date.now();
    _fsPersist(); _renderFocus();
  }
  function _fsSkipBreak() {
    if (!_fs || _fs.phase !== 'break') return;
    const now = Date.now();
    if (_fs.running) _fsAdvance(now);
    if (_fs.phase !== 'break') return;
    _fs.phase = 'work'; _fs.phaseAcc = 0; _fs.segStart = now;
    _fsPersist(); _renderFocus();
  }
  function _fsStop() {
    const s = _fs;
    if (!s) return;
    const now = Date.now();
    _fsAdvance(now); _fsBank(now);
    const ms = Math.round(s.accMs), b = _blockById(s.blockId);
    _fs = null; _fsPersist();
    if (b && ms >= FS_MIN_MS) {
      b.focusMs = _clamp((b.focusMs || 0) + ms, 0, 86400000);
      _scheduleSave();
      _fsSummary = { blockId: b.id, ms: ms };
      if (_sectionEl && _sectionEl.isConnected) { _renderGrid({ animate: false, scroll: false }); _updateSummary(); }
    } else {
      _fsSummary = null;
      if (!b) _toast('That block no longer exists — the session was not saved.');
    }
    _fsSig = '';
    _renderFocus();
  }
  /** After a reload: pick the session up again, paused if the page was closed for a while. */
  function _fsRestore() {
    _fs = null;
    const r = _lsJson(_fsKey());
    if (r && typeof r === 'object' && _blockById(r.blockId) && FS_MODES[r.mode] && isFinite(r.segStart)) {
      _fs = {
        id: String(r.id || ''), blockId: String(r.blockId), mode: r.mode, running: !!r.running, phase: r.phase === 'break' ? 'break' : 'work',
        segStart: +r.segStart, phaseAcc: +r.phaseAcc || 0, accMs: +r.accMs || 0, cycles: +r.cycles || 0, startedAt: +r.startedAt || +r.segStart, beat: +r.beat || +r.segStart
      };
      const now = Date.now();
      if (_fs.running && now - _fs.beat > FS_AWAY_LOAD) {
        _fsAdvance(_fs.beat); _fsBank(_fs.beat);
        _toast('Focus session paused — the page was closed for a while.');
      } else if (_fs.running) _fsAdvance(now);
      _fsPersist(); _fsEnsureTimer();
    }
    _fsSig = '';
  }
  function _fsBeat() { if (_fs && _fs.running) { _fs.beat = Date.now(); _fsPersist(); } }

  function _fsTick() {
    const s = _fs;
    if (!s) { if (_fsTimer) { clearInterval(_fsTimer); _fsTimer = null; } _fsPaint(); return; }
    const now = Date.now();
    if (!_blockById(s.blockId)) {                                 // deleted (here or on another device); give Undo a moment
      if (!_fsMiss) _fsMiss = now;
      else if (now - _fsMiss > 15000) { _fs = null; _fsMiss = 0; _fsPersist(); _fsSig = ''; _toast('Focus session ended — its block was deleted.'); }
    } else _fsMiss = 0;
    if (_fs && _fs.running) {
      if (now - (_fs.beat || _fs.segStart) > FS_AWAY_TICK) {      // the computer slept: do not count the time away
        const t = _fs.beat || _fs.segStart;
        _fsAdvance(t); _fsBank(t);
        _fsPersist(); _fsSig = '';
        _toast('Focus session paused — you were away.');
      } else {
        const was = _fs.phase;
        if (_fsAdvance(now)) {
          _fsCue(_fs.phase === 'break' ? 'end' : 'start');
          _toast(_fs.phase === 'break' ? 'Focus round done — take a break.' : 'Break over — back to focus.');
          _fsPersist();
        }
        if (now - (_fs.beat || 0) >= 15000) { _fs.beat = now; _fsPersist(); }
        if (was !== _fs.phase) _renderFocus();
      }
    }
    _fsPaint();
  }

  /* What should the big button do right now? */
  function _fsSuggest() {
    const d = new Date(), nm = d.getHours() * 60 + d.getMinutes();
    const list = _blocksForDate(_todayStr());
    const cur = list.find(function (b) { return nm >= _toMins(b.startTime) && nm < _toMins(b.endTime); });
    if (cur) return { kind: 'now', b: cur };
    const nxt = list.find(function (b) { return _toMins(b.startTime) > nm; });
    if (nxt && _toMins(nxt.startTime) - nm <= FS_EARLY_MIN) return { kind: 'early', b: nxt, mins: _toMins(nxt.startTime) - nm };
    return { kind: 'quick', b: null, next: nxt || null, nm: nm };
  }
  /** Quick focus: make a block that starts now, never overlapping the next one. */
  function _fsQuickStart(mins, mode) {
    const d = new Date(), date = _todayStr(), s = d.getHours() * 60 + d.getMinutes();
    const free = _freeBounds(date, s);
    const e = Math.min(DAY_MINS, s + mins, free[1]);
    if (free[1] <= s || e - s < 5) {
      const nx = _blocksForDate(date).find(function (b) { return _toMins(b.startTime) > s; });
      _toast(nx ? 'Less than 5 min free before “' + (nx.title || _tagOrFallback(nx.tagId).label) + '”.' : 'No time left today.');
      return null;
    }
    const tag = _tagOrFallback(_activeTagId);
    const b = _normBlock({ id: _newId(), date: date, tagId: tag.id === FALLBACK_TAG.id ? 'work' : tag.id, startTime: _toTime(s), endTime: _toTime(e), title: 'Quick focus', subtitle: '', createdAt: Date.now() });
    if (!b) return null;
    _timeBlocks.push(b);
    _scheduleSave();
    if (_sectionEl && _sectionEl.isConnected) { _renderGrid({ animate: false, scroll: false }); _updateSummary(); }
    _fsStart(b.id, mode);
    if (e - s < mins) _toast('Shortened to ' + (e - s) + ' min — the next block starts then.');
    return b;
  }

  function _fsSub(s, now) {
    const b = _blockById(s.blockId);
    if (!s.running) return 'Paused · ' + _fsClock(_fsFocusMs(s, now)) + ' focused';
    if (s.phase === 'break') return 'Break · step away from the screen';
    if (s.mode === 'block') {
      const d = new Date(), nm = d.getHours() * 60 + d.getMinutes(), e = b ? _toMins(b.endTime) : 0;
      return b && nm >= e ? 'Over the block by ' + _fmtDur(nm - e) : 'Block ends at ' + (b ? b.endTime : '');
    }
    return 'Round ' + (s.cycles + 1) + ' · ' + _fsClock(_fsFocusMs(s, now)) + ' focused';
  }
  function _fsBtn(now) {                                         // the toolbar button shows the live clock
    const btn = _el('#tm-btn-focus-mode');
    if (!btn) return;
    const s = _fs, lab = btn.querySelector('.hub-tm-btn-label');
    btn.classList.toggle('is-live', !!s);
    btn.classList.toggle('is-paused', !!s && !s.running);
    if (!s) { if (lab) lab.textContent = 'Focus'; btn.title = 'Focus Mode'; return; }
    const L = _fsPhaseLen(s), txt = (s.phase === 'break' ? 'Break' : s.running ? 'Focus' : 'Paused') + ' · ' + _fsClock(L ? L - _fsPhaseMs(s, now) : _fsFocusMs(s, now));
    if (lab) lab.textContent = txt;
    btn.title = txt;
  }
  function _fsPaint() {
    const now = Date.now(), s = _fs;
    _fsBtn(now);
    const box = _el('#hub-tm-fs');
    if (!box) return;
    const clock = _el('#hub-tm-fs-clock'), tEl = _el('#hub-tm-fs-time'), sub = _el('#hub-tm-fs-sub');
    clock.classList.toggle('hub-tm-hidden', !s);
    box.classList.toggle('is-break', !!s && s.phase === 'break');
    let sig, modesHtml = '', quickHtml = '', actHtml = '', note = '';
    const btn = function (act, label, cls, v) { return '<button type="button" class="hub-tm-btn ' + (cls || 'hub-tm-btn--outline') + '" data-fs="' + act + '"' + (v !== undefined ? ' data-v="' + v + '"' : '') + '>' + label + '</button>'; };
    if (s) {
      const L = _fsPhaseLen(s);
      tEl.textContent = _fsClock(L ? L - _fsPhaseMs(s, now) : _fsFocusMs(s, now));
      sub.textContent = _fsSub(s, now);
      sig = 'run|' + s.running + '|' + s.phase + '|' + s.mode;
      actHtml = (s.running ? btn('pause', 'Pause') : btn('resume', 'Resume', 'hub-tm-btn--primary')) + (s.phase === 'break' ? btn('skip', 'Skip break') : '') + btn('stop', 'Stop &amp; save', 'hub-tm-btn--danger');
    } else if (_fsSummary) {
      const b = _blockById(_fsSummary.blockId);
      sig = 'sum|' + _fsSummary.blockId + '|' + _fsSummary.ms + '|' + (b && b.done);
      note = 'Focused ' + _fmtDur(Math.max(1, Math.round(_fsSummary.ms / 60000))) + (b ? ' on “' + _esc(b.title || _tagOrFallback(b.tagId).label) + '” · ' + _fmtDur(Math.round((b.focusMs || 0) / 60000)) + ' in total' : '');
      actHtml = (b && !b.done ? btn('sum-done', 'Mark block done', 'hub-tm-btn--primary') : '') + btn('sum-close', 'Another session');
    } else {
      const sg = _fsSuggest();
      sig = 'idle|' + sg.kind + '|' + (sg.b ? sg.b.id : '') + '|' + (sg.mins || '') + '|' + _fsMode + '|' + _fsQuick + '|' + (sg.next ? sg.next.id : '');
      modesHtml = Object.keys(FS_MODES).map(function (k) {
        return '<button type="button" class="hub-tm-fs-chip' + (k === _fsMode ? ' is-on' : '') + '" data-fs="mode" data-v="' + k + '" aria-pressed="' + (k === _fsMode) + '">' + FS_MODES[k].label + '</button>';
      }).join('');
      note = FS_MODES[_fsMode].hint;
      if (sg.kind === 'quick') {
        quickHtml = FS_QUICK.map(function (m) { return '<button type="button" class="hub-tm-fs-chip' + (m === _fsQuick ? ' is-on' : '') + '" data-fs="len" data-v="' + m + '" aria-pressed="' + (m === _fsQuick) + '">' + m + ' min</button>'; }).join('');
        const room = sg.next ? _toMins(sg.next.startTime) - sg.nm : 0;
        note += ' · ' + (sg.next ? 'Free for ' + _fmtDur(room) + ' before “' + _esc(sg.next.title || _tagOrFallback(sg.next.tagId).label) + '”' : 'Creates a block starting now');
        actHtml = btn('start-quick', 'Quick focus · ' + _fsQuick + ' min', 'hub-tm-btn--primary');
      } else {
        actHtml = btn('start', sg.kind === 'early' ? 'Start early · in ' + _fmtDur(sg.mins) : 'Start focus', 'hub-tm-btn--primary');
      }
    }
    if (sig !== _fsSig) {                                        // rebuild controls only when something changed
      _fsSig = sig;
      _el('#hub-tm-fs-modes').innerHTML = modesHtml;
      _el('#hub-tm-fs-quick').innerHTML = quickHtml;
      _el('#hub-tm-fs-actions').innerHTML = actHtml;
      _el('#hub-tm-fs-note').innerHTML = note;
      _el('#hub-tm-fs-modes').classList.toggle('hub-tm-hidden', !modesHtml);
      _el('#hub-tm-fs-quick').classList.toggle('hub-tm-hidden', !quickHtml);
      _el('#hub-tm-fs-note').classList.toggle('hub-tm-hidden', !note);
    }
  }
  function _fsClick(e) {
    const t = e.target.closest('[data-fs]');
    if (!t) return;
    const act = t.getAttribute('data-fs'), v = t.getAttribute('data-v');
    if (act === 'mode') { _fsMode = FS_MODES[v] ? v : 'block'; _lsSet(FS_MODE_KEY, _fsMode); _fsSig = ''; _fsPaint(); }
    else if (act === 'len') { _fsQuick = parseInt(v, 10) || 25; _fsSig = ''; _fsPaint(); }
    else if (act === 'start') { const sg = _fsSuggest(); if (sg.b) _fsStart(sg.b.id, _fsMode); }
    else if (act === 'start-quick') _fsQuickStart(_fsQuick, _fsMode);
    else if (act === 'pause') _fsPause();
    else if (act === 'resume') _fsResume();
    else if (act === 'skip') _fsSkipBreak();
    else if (act === 'stop') _fsStop();
    else if (act === 'sum-done') { if (_fsSummary) _habToggleDone(_fsSummary.blockId); _fsSig = ''; _renderFocus(); }
    else if (act === 'sum-close') { _fsSummary = null; _fsSig = ''; _fsPaint(); }
  }

  /* ============================================================
     SET TIME  ·  v2 "Schedule builder"
     • Controls on the left, a LIVE calendar preview on the right — no Preview button
     • Quick durations, 24h day-bar that shows what is already planned, presets for repeat days
     • Conflicts are flagged before you apply; click any date to add / skip it by hand
     • Tag + optional title picked right here; Undo after applying
     ============================================================ */
  function _sbTimeVal(m) { return m >= DAY_MINS ? '00:00' : _toTime(m); }
  function _sbTagHtml() {
    return _allTags().map(function (t) {
      return '<button type="button" class="hub-tm-tl-chip" data-sb-tag="' + _esc(t.id) + '" style="' + _tagStyle(t) + '" aria-pressed="false"><span class="hub-tm-tag-dot"></span>' + _esc(t.label) + '</button>';
    }).join('');
  }
  function _openSetTime() {
    const now = new Date();
    let s = 9 * 60;
    if (_currentDate === _todayStr()) s = Math.min(DAY_MINS - CREATE_DUR, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30);
    _sb = { tag: _tagOrFallback(_activeTagId).id === FALLBACK_TAG.id ? 'work' : _activeTagId, days: [], weeks: 1, ov: {}, dur: CREATE_DUR };
    _el('#tm-input-start').value = _toTime(s);
    _el('#tm-input-end').value = _sbTimeVal(s + CREATE_DUR);
    _el('#tm-sb-title').value = '';
    _el('#tm-sb-tags').innerHTML = _sbTagHtml();
    _sbRender();
    _openModal(_el('#hub-tm-set-time-modal'), '#tm-input-start');
  }

  function _sbCompute() {
    const out = { ok: false, err: '', s: 0, e: 0, weeks: [], rows: [], conflicts: 0, win: null };
    const st = _el('#tm-input-start').value, en = _el('#tm-input-end').value;
    const base = _parseDate(_currentDate), endD = _addDays(base, _sb.weeks * 7 - 1);
    out.win = { base: base, end: endD };
    if (!st || !en) out.err = 'Set both a start and an end time.';
    else {
      out.s = _toMins(st); out.e = _toMins(en);
      if (out.e === 0 && out.s > 0) out.e = DAY_MINS;
      if (out.e <= out.s) out.err = 'End time must be after the start time.'; else out.ok = true;
    }
    const first = _weekStart(_currentDate), last = _addDays(_weekStart(_dateToStr(endD)), 6);
    const total = Math.round((last - first) / 86400000) + 1;
    let wk = [];
    for (let i = 0; i < total; i++) {
      const d = _addDays(first, i), ds = _dateToStr(d);
      const inWin = d >= base && d <= endD;
      const match = _sb.days.length ? _sb.days.indexOf(d.getDay()) > -1 : ds === _currentDate;
      const inc = inWin && (_sb.ov[ds] !== undefined ? _sb.ov[ds] === 1 : match);
      const hit = inc && out.ok ? _overlap(ds, out.s, out.e) : null;
      if (hit) out.conflicts++; else if (inc && out.ok) out.rows.push({ date: ds, s: out.s, e: out.e });
      wk.push({ d: d, ds: ds, inWin: inWin, match: match, inc: inc, hit: hit, first: i === 0 });
      if (wk.length === 7) { out.weeks.push(wk); wk = []; }
    }
    return out;
  }

  function _sbRender() {
    const c = _sbCompute(), tag = _tagOrFallback(_sb.tag), dlg = _el('#hub-tm-set-time-modal .hub-tm-dialog');
    dlg.style.setProperty('--tm-c', _safeColor(tag.color));
    if (c.ok) _sb.dur = c.e - c.s;
    const base = c.win.base, bd = DAY_SHORT[base.getDay()] + ', ' + _dateLabel(base);

    /* 1 · time */
    _el('#tm-sb-dur').textContent = c.ok ? _fmtDur(c.e - c.s) : '—';
    _all('#tm-sb-durs [data-sb-dur]').forEach(function (b) { b.setAttribute('aria-pressed', c.ok && parseInt(b.getAttribute('data-sb-dur'), 10) === c.e - c.s ? 'true' : 'false'); });
    const ex = _blocksForDate(_currentDate);
    let bar = ex.map(function (b) {
      const t = _tagOrFallback(b.tagId), s = _toMins(b.startTime), e = _toMins(b.endTime);
      return '<i class="hub-tm-sb-ex" style="--tm-c:' + _safeColor(t.color) + ';left:' + (s / DAY_MINS * 100) + '%;width:' + ((e - s) / DAY_MINS * 100) + '%"></i>';
    }).join('');
    if (c.ok) bar += '<i class="hub-tm-sb-win" style="left:' + (c.s / DAY_MINS * 100) + '%;width:' + ((c.e - c.s) / DAY_MINS * 100) + '%"></i>';
    _el('#tm-sb-track').innerHTML = bar;
    const clash = c.ok ? _overlap(_currentDate, c.s, c.e) : null;
    _el('#tm-sb-bar-cap').textContent = bd + ' · ' + (ex.length ? _tlPlural(ex.length, 'block') + ' already planned (faded)' : 'nothing planned yet') +
      (clash ? ' · overlaps “' + (clash.title || _tagOrFallback(clash.tagId).label) + '”' : '');

    /* 2 · repeat */
    const key = _sb.days.slice().sort().join();
    SB_PRESETS.forEach(function (p) {
      const n = _el('#tm-sb-presets [data-sb-preset="' + p[0] + '"]');
      if (n) n.setAttribute('aria-pressed', p[2].slice().sort().join() === key ? 'true' : 'false');
    });
    _all('#tm-day-checks input').forEach(function (i) { i.checked = _sb.days.indexOf(parseInt(i.value, 10)) > -1; });
    _el('#tm-sb-repeat-cap').textContent = _sb.days.length
      ? 'Repeats every ' + SB_DAYS.filter(function (d) { return _sb.days.indexOf(d[0]) > -1; }).map(function (d) { return d[1]; }).join(', ') + '.'
      : 'Only ' + bd + '. Pick days to repeat — or tap dates in the preview.';

    /* 3 · span */
    _all('#tm-sb-weeks [data-sb-weeks]').forEach(function (b) { b.setAttribute('aria-pressed', parseInt(b.getAttribute('data-sb-weeks'), 10) === _sb.weeks ? 'true' : 'false'); });
    _el('#tm-sb-span-cap').textContent = _dateLabel(c.win.base) + ' → ' + _dateLabel(c.win.end) + ' · starts from the selected date.';

    /* 4 · details */
    _all('#tm-sb-tags [data-sb-tag]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-sb-tag') === _sb.tag ? 'true' : 'false'); });
    _el('#tm-sb-title').placeholder = 'Title (optional) — defaults to “' + tag.label + '”';

    /* preview */
    const mins = c.rows.length * (c.e - c.s);
    const cell = function (k, v, alert) { return '<div class="hub-tm-tl-stat' + (alert ? ' is-alert' : '') + '"><span class="hub-tm-tl-stat-k">' + k + '</span><span class="hub-tm-tl-stat-v">' + v + '</span></div>'; };
    _el('#tm-sb-stats').innerHTML = cell('Blocks', c.rows.length) + cell('Total time', c.rows.length ? _fmtDur(mins) : '0m') + cell('Conflicts', c.conflicts, c.conflicts > 0);
    let html = '<div class="hub-tm-sb-dow">' + SB_DAYS.map(function (d) { return '<span>' + d[1] + '</span>'; }).join('') + '</div>';
    c.weeks.forEach(function (wk) {
      html += '<div class="hub-tm-sb-week">' + wk.map(function (x) {
        const dn = x.d.getDate(), mo = (dn === 1 || x.first) ? '<small>' + MONTH_SHORT[x.d.getMonth()] + '</small>' : '';
        if (!x.inWin) return '<span class="hub-tm-sb-cell is-out">' + mo + '<b>' + dn + '</b></span>';
        const label = DAY_SHORT[x.d.getDay()] + ' ' + _dateLabel(x.d);
        let cls = x.inc ? (x.hit ? ' is-conflict' : ' is-on') : (x.match ? ' is-off' : ' is-idle'), tip;
        if (x.hit) tip = 'Overlaps “' + (x.hit.title || _tagOrFallback(x.hit.tagId).label) + '” ' + x.hit.startTime + '–' + x.hit.endTime + ' — will be skipped';
        else if (x.inc) tip = 'Will be added';
        else tip = x.match ? 'Skipped — click to restore' : 'Click to add';
        if (x.ds === _todayStr()) cls += ' is-today';
        return '<button type="button" class="hub-tm-sb-cell' + cls + '" data-sb-date="' + x.ds + '" aria-pressed="' + (x.inc ? 'true' : 'false') + '" title="' + _esc(label + ' · ' + tip) + '" aria-label="' + _esc(label + ': ' + tip) + '">' +
          mo + '<b>' + dn + '</b>' + (x.inc && c.ok ? '<em>' + _toTime(c.s) + '</em>' : '') + '</button>';
      }).join('') + '</div>';
    });
    _el('#tm-sb-cal').innerHTML = html;
    _el('#hub-tm-settime-error').textContent = c.err;
    _el('#hub-tm-set-time-modal [data-sb-reset]').hidden = !Object.keys(_sb.ov).length;
    const btn = _el('#tm-btn-apply-time');
    btn.disabled = !c.ok || !c.rows.length;
    btn.textContent = c.rows.length ? 'Add ' + _tlPlural(c.rows.length, 'block') : 'Nothing to add';
  }

  function _bindSetTime() {
    const modal = _el('#hub-tm-set-time-modal');
    _el('#tm-input-start').addEventListener('input', function () {
      const s = _toMins(this.value);
      if (this.value && _sb.dur > 0) _el('#tm-input-end').value = _sbTimeVal(Math.min(DAY_MINS, s + _sb.dur));   // moving the start keeps the length
      _sbRender();
    });
    _el('#tm-input-end').addEventListener('input', _sbRender);
    _el('#tm-sb-title').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _sbApply(); } });
    _el('#tm-day-checks').addEventListener('change', function () {
      _sb.days = _all('#tm-day-checks input:checked').map(function (i) { return parseInt(i.value, 10); });
      _sb.ov = {}; _sbRender();
    });
    modal.addEventListener('click', function (e) {
      const t = e.target;
      let n;
      if ((n = t.closest('[data-sb-dur]'))) {
        const s = _toMins(_el('#tm-input-start').value), d = parseInt(n.getAttribute('data-sb-dur'), 10);
        _el('#tm-input-end').value = _sbTimeVal(Math.min(DAY_MINS, s + d)); _sbRender(); return;
      }
      if ((n = t.closest('[data-sb-preset]'))) {
        const p = SB_PRESETS.filter(function (x) { return x[0] === n.getAttribute('data-sb-preset'); })[0];
        if (p) { _sb.days = p[2].slice(); _sb.ov = {}; _sbRender(); }
        return;
      }
      if ((n = t.closest('[data-sb-weeks]'))) { _sb.weeks = parseInt(n.getAttribute('data-sb-weeks'), 10); _sbRender(); return; }
      if ((n = t.closest('[data-sb-tag]'))) { _sb.tag = n.getAttribute('data-sb-tag'); _sbRender(); return; }
      if (t.closest('[data-sb-reset]')) { _sb.ov = {}; _sbRender(); return; }
      if ((n = t.closest('[data-sb-date]'))) {
        const ds = n.getAttribute('data-sb-date'), d = _parseDate(ds);
        const match = _sb.days.length ? _sb.days.indexOf(d.getDay()) > -1 : ds === _currentDate;
        const inc = _sb.ov[ds] !== undefined ? _sb.ov[ds] === 1 : match, want = !inc;
        if (want === match) delete _sb.ov[ds]; else _sb.ov[ds] = want ? 1 : 0;
        _sbRender();
        const again = _el('#tm-sb-cal [data-sb-date="' + ds + '"]');
        if (again) again.focus({ preventScroll: true });
      }
    });
    _el('#tm-btn-apply-time').addEventListener('click', _sbApply);
  }

  function _sbApply() {
    const c = _sbCompute();
    if (!c.ok || !c.rows.length) return;
    const tagId = _tagOrFallback(_sb.tag).id === FALLBACK_TAG.id ? 'work' : _sb.tag;
    const title = (_el('#tm-sb-title').value || '').trim().slice(0, 120) || _tagOrFallback(tagId).label;
    const ids = []; let skipped = c.conflicts;
    c.rows.forEach(function (r, i) {
      if (_overlap(r.date, r.s, r.e)) { skipped++; return; }
      const id = _newId(i);
      _timeBlocks.push({ id: id, date: r.date, tagId: tagId, startTime: _toTime(r.s), endTime: _toTime(r.e), title: title, subtitle: '', createdAt: Date.now() });
      ids.push(id);
    });
    _closeModal(_el('#hub-tm-set-time-modal'));
    if (!ids.length) { _toast('Nothing added — those times are already taken.'); return; }
    _scheduleSave();
    _renderGrid({ animate: false, scroll: false });
    _tlRefresh();
    _toast('Added ' + _tlPlural(ids.length, 'block') + (skipped ? ' · ' + skipped + ' skipped (time already taken)' : ''), {
      action: 'Undo',
      onAction: function () {
        _timeBlocks = _timeBlocks.filter(function (b) { return ids.indexOf(b.id) === -1; });
        _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
        _tlRefresh();
      }
    });
  }

  /* ============================================================
     TEMPLATES
     ============================================================ */
  function _loadTemplates() { /* templates now live in the account's synced data (see _applyData) */ }
  function _saveTemplates() {
    _templates.forEach(function (t) { if (!t.id) t.id = 'tpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); });
    _scheduleSave();
  }

  function _openTemplates() {
    _loadTemplates();
    _renderTemplates();
    _openModal(_el('#hub-tm-template-modal'), '#tm-template-name');
  }
  function _renderTemplates() {
    const list = _el('#hub-tm-template-list');
    if (!_templates.length) { list.innerHTML = '<p class="hub-tm-empty">No saved templates yet.<br>Plan a day, then save it with a name below.</p>'; return; }
    list.innerHTML = _templates.map(function (t, i) {
      const n = (t.blocks || []).length;
      return '<div class="hub-tm-template-item"><div><span class="hub-tm-template-name">' + _esc(t.name) + '</span><span class="hub-tm-template-count">' + n + ' block' + (n !== 1 ? 's' : '') + '</span></div>' +
             '<div class="hub-tm-template-actions"><button type="button" class="hub-tm-btn hub-tm-btn--primary" data-tpl-load="' + i + '">Load</button>' +
             '<button type="button" class="hub-tm-btn hub-tm-btn--outline hub-tm-btn--icon" data-tpl-del="' + i + '" aria-label="Delete template ' + _esc(t.name) + '">&times;</button></div></div>';
    }).join('');
  }
  function _bindTemplates() {
    _el('#hub-tm-template-list').addEventListener('click', function (e) {
      const ld = e.target.closest('[data-tpl-load]'), dl = e.target.closest('[data-tpl-del]');
      if (ld) _applyTemplate(parseInt(ld.getAttribute('data-tpl-load'), 10));
      if (dl) {
        const i = parseInt(dl.getAttribute('data-tpl-del'), 10), t = _templates[i];
        if (!t) return;
        _confirm('Delete template “' + t.name + '”?', function () { _templates.splice(i, 1); _saveTemplates(); _renderTemplates(); }, { title: 'Delete template?' });
      }
    });
    const save = function () {
      const input = _el('#tm-template-name'), name = input.value.trim();
      if (!name) { input.focus(); return; }
      const cur = _blocksForDate(_currentDate);
      if (!cur.length) { _toast('This day has no blocks to save.'); return; }
      _templates.push({
        name: name, createdAt: Date.now(),
        blocks: cur.map(function (b) { return { tagId: b.tagId, startTime: b.startTime, endTime: b.endTime, title: b.title, subtitle: b.subtitle, checklist: _ck(b).map(function (i) { return i.text; }) }; })
      });
      _saveTemplates();
      _renderTemplates();
      input.value = '';
      _toast('Saved template “' + name + '”');
    };
    _el('#tm-btn-template-save').addEventListener('click', save);
    _el('#tm-template-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  }
  function _applyTemplate(i) {
    const t = _templates[i];
    if (!t || !Array.isArray(t.blocks)) return;
    const run = function () {
      _timeBlocks = _timeBlocks.filter(function (b) { return b.date !== _currentDate; });
      t.blocks.forEach(function (src, k) {
        const nb = _normBlock({ id: _newId(k), date: _currentDate, tagId: src.tagId, startTime: src.startTime, endTime: src.endTime, title: src.title, subtitle: src.subtitle, checklist: (src.checklist || []).map(function (t) { return { text: t }; }) });
        if (nb) _timeBlocks.push(nb);
      });
      _scheduleSave();
      _closeModal(_el('#hub-tm-template-modal'));
      _renderGrid({ animate: false, scroll: false });
      _toast('Template loaded');
    };
    const existing = _blocksForDate(_currentDate).length;
    if (existing) _confirm('Replace the ' + existing + ' block' + (existing > 1 ? 's' : '') + ' on this day with “' + t.name + '”?', run, { title: 'Replace this day?', label: 'Replace' });
    else run();
  }

  /* ============================================================
     TIMELINE DRAWER  ·  v2 "Mission log"
     • Spotlight card: what is running NOW / what is UP NEXT (live countdown)
     • Rail view: day groups, NOW marker, free-gap hints, live progress bar
     • Filters: search · range · tag · status · sort — remembered between visits
     • Quick actions on every row: complete · push one day · delete (with Undo)
     • Overdue radar, "Earlier" folded away, one-click "copy agenda"
     ============================================================ */
  function _tlNowMins() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function _tlPlural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function _tlDayDiff(ds) { return Math.round((_parseDate(ds) - _parseDate(_todayStr())) / 86400000); }
  function _tlRel(n) { return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : n > 0 ? 'In ' + n + ' days' : (-n) + ' days ago'; }
  function _tlCmp(a, b) { return a.date === b.date ? _toMins(a.startTime) - _toMins(b.startTime) : (a.date < b.date ? -1 : 1); }
  function _tlLate(b, today, nm) { if (b.done) return false; if (b.date < today) return true; return b.date === today && _toMins(b.endTime) <= nm; }
  function _tlLive(b, today, nm) { return !b.done && b.date === today && _toMins(b.startTime) <= nm && nm < _toMins(b.endTime); }
  function _tlSet(node, html) { if (node && node._html !== html) { node.innerHTML = html; node._html = html; return true; } return false; }
  function _tlRefresh() { const d = _el('#hub-tm-timeline-drawer'); if (d && d.classList.contains('is-open')) _renderTimeline(); }

  function _tlLoadPrefs() {
    const p = _lsJson(TL_KEY) || {};
    if (TL_RANGES.some(function (r) { return r[0] === p.range; })) _tl.range = p.range;
    if (TL_STATUS.some(function (r) { return r[0] === p.status; })) _tl.status = p.status;
    if (TL_SORTS.indexOf(p.sort) > -1) _el('#tm-timeline-sort').value = p.sort;
    _tl.pastOpen = p.pastOpen === true;
  }
  function _tlSavePrefs() {
    _lsSet(TL_KEY, JSON.stringify({ range: _tl.range, status: _tl.status, sort: _el('#tm-timeline-sort').value, pastOpen: _tl.pastOpen }));
  }

  function _openTimeline() {
    _el('#tm-timeline-search').value = _tl.q;
    _renderTimeline();
    _el('#hub-tm-timeline-scrim').classList.add('is-open');
    _openModal(_el('#hub-tm-timeline-drawer'), '#tm-btn-timeline-close');
    if (_tlTimer) clearInterval(_tlTimer);
    _tlTimer = setInterval(_renderTimeline, 30000);          // keeps NOW / countdown / overdue honest
  }

  function _bindTimeline() {
    const drawer = _el('#hub-tm-timeline-drawer');
    _tlLoadPrefs();
    _el('#tm-btn-timeline-close').addEventListener('click', function () { _closeModal(drawer); });
    _el('#hub-tm-timeline-scrim').addEventListener('click', function () { _closeModal(drawer); });
    _el('#tm-timeline-sort').addEventListener('change', function () { _tlSavePrefs(); _renderTimeline(); });
    _el('#tm-timeline-search').addEventListener('input', function (e) { _tl.q = e.target.value; _renderTimeline(); });
    _el('#tm-timeline-copy').addEventListener('click', _tlCopy);
    _el('#tm-timeline-today').addEventListener('click', _tlJumpToday);

    drawer.addEventListener('click', function (e) {
      const t = e.target;
      let n;
      if ((n = t.closest('[data-tl-range]')))  { _tl.range = n.getAttribute('data-tl-range'); _tlSavePrefs(); _renderTimeline(); return; }
      if ((n = t.closest('[data-tl-status]'))) { _tl.status = n.getAttribute('data-tl-status'); _tlSavePrefs(); _renderTimeline(); return; }
      if ((n = t.closest('[data-tl-tag]')))    { const v = n.getAttribute('data-tl-tag'); _tl.tag = (v === _tl.tag ? 'all' : v); _renderTimeline(); return; }
      if (t.closest('[data-tl-past]'))         { _tl.pastOpen = !_tl.pastOpen; _tlSavePrefs(); _renderTimeline(); return; }
      if (t.closest('[data-tl-reset]')) {
        _tl.q = ''; _tl.tag = 'all'; _tl.range = 'all'; _tl.status = 'all';
        _el('#tm-timeline-search').value = '';
        _tlSavePrefs(); _renderTimeline(); return;
      }
      if ((n = t.closest('[data-tl-open]'))) {                       // › / ⌄  show or hide the checklist
        const id = n.getAttribute('data-tl-open');
        _tl.open[id] = n.getAttribute('aria-expanded') !== 'true';
        _renderTimeline();
        const again = drawer.querySelector('[data-tl-open="' + id + '"]');
        if (again) again.focus({ preventScroll: true });
        return;
      }
      if ((n = t.closest('[data-tl-edit]'))) { _openDetails(n.getAttribute('data-tl-edit')); return; }   // editor opens on top; Timeline stays
      if ((n = t.closest('[data-tl-done]')))   { _habToggleDone(n.getAttribute('data-tl-done')); _tlRefresh(); return; }
      if ((n = t.closest('[data-tl-next]')))   { _tlMove(n.getAttribute('data-tl-next')); return; }
      if ((n = t.closest('[data-tl-del]')))    { _tlDelete(n.getAttribute('data-tl-del')); return; }
      if ((n = t.closest('[data-tl-day]')))    { _closeModal(drawer); _setDate(n.getAttribute('data-tl-day'), { view: 'day' }); return; }
      if ((n = t.closest('[data-tl-go]'))) {
        const b = _blockById(n.getAttribute('data-tl-go'));
        if (!b) return;
        _closeModal(drawer);
        _setDate(b.date, { view: 'day', scrollMins: _toMins(b.startTime) });
        _focusBlock(b.id);
      }
    });

    // Tick checklist items right inside the Timeline (same effect as in Focus mode)
    drawer.addEventListener('change', function (e) {
      const cb = e.target.closest('[data-tl-ck]');
      if (!cb) return;
      const bid = cb.getAttribute('data-tl-blk'), iid = cb.getAttribute('data-tl-ck');
      const b = _blockById(bid), it = b && _ck(b).find(function (i) { return i.id === iid; });
      if (!it) return;
      it.done = cb.checked;
      _scheduleSave();
      _fckSig = '';
      _renderGrid({ animate: false, scroll: false });
      _renderTimeline();
      const again = drawer.querySelector('[data-tl-ck="' + iid + '"][data-tl-blk="' + bid + '"]');
      if (again) again.focus({ preventScroll: true });
      _ckNudge(b);
    });
  }

  /* ---- Actions ---- */
  function _tlMoveTarget(b, today) {
    const tomorrow = _dateToStr(_addDays(_parseDate(today), 1));
    return b.date < today ? tomorrow : _dateToStr(_addDays(_parseDate(b.date), 1));
  }
  function _tlDayName(ds, today) {
    const diff = Math.round((_parseDate(ds) - _parseDate(today)) / 86400000), d = _parseDate(ds);
    return diff === 1 ? 'tomorrow' : DAY_SHORT[d.getDay()] + ' ' + _dateLabel(d);
  }
  function _tlMove(id) {
    const b = _blockById(id);
    if (!b || b.done) return;
    const today = _todayStr(), to = _tlMoveTarget(b, today), from = b.date, s = _toMins(b.startTime), e = _toMins(b.endTime), name = _tlDayName(to, today);
    const hit = _overlap(to, s, e, b.id);
    if (hit) { _toast('Can’t move — ' + hit.startTime + '–' + hit.endTime + ' is already booked ' + name + '.'); return; }
    b.date = to;
    _scheduleSave();
    _renderGrid({ animate: false, scroll: false });
    _renderTimeline();
    _toast('Moved to ' + name, {
      action: 'Undo',
      onAction: function () {
        if (_overlap(from, s, e, b.id)) { _toast('Can’t undo — that slot is taken now.'); return; }
        b.date = from;
        _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
        _tlRefresh();
      }
    });
  }
  function _tlDelete(id) {
    const i = _timeBlocks.findIndex(function (b) { return b.id === id; });
    if (i < 0) return;
    const removed = _timeBlocks.splice(i, 1)[0];
    _scheduleSave();
    _renderGrid({ animate: false, scroll: false });
    _renderTimeline();
    _toast('Deleted “' + (removed.title || _tagOrFallback(removed.tagId).label) + '”', {
      action: 'Undo',
      onAction: function () {
        if (_overlap(removed.date, _toMins(removed.startTime), _toMins(removed.endTime))) { _toast('Can’t restore — that time is taken now.'); return; }
        _timeBlocks.push(removed);
        _scheduleSave();
        _renderGrid({ animate: false, scroll: false });
        _tlRefresh();
      }
    });
  }
  function _tlJumpToday() {
    const g = _el('#hub-tm-timeline-list .hub-tm-tl-group.is-today'), sc = _el('#hub-tm-tl-scroll');
    if (!g || !sc) { _toast('No blocks today in this view'); return; }
    const delta = g.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
    sc.scrollTo({ top: sc.scrollTop + delta, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function _tlCopy() {
    const list = _tlFilter(_todayStr(), _tlNowMins()).sort(_tlCmp);
    if (!list.length) { _toast('Nothing to copy'); return; }
    const out = []; let last = '';
    list.forEach(function (b) {
      if (b.date !== last) {
        if (last) out.push('');
        const d = _parseDate(b.date);
        out.push(DAY_SHORT[d.getDay()] + ', ' + _dateLabel(d) + ', ' + d.getFullYear());
        last = b.date;
      }
      out.push((b.done ? '[x] ' : '[ ] ') + b.startTime + '–' + b.endTime + '  ' + (b.title || _tagOrFallback(b.tagId).label) + '  (' + _fmtDur(_toMins(b.endTime) - _toMins(b.startTime)) + ')');
    });
    const text = out.join('\n'), ok = function () { _toast('Agenda copied (' + _tlPlural(list.length, 'block') + ')'); };
    const fallback = function () {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      let done = false; try { done = document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      if (done) ok(); else _toast('Couldn’t copy — select the text manually.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
  }

  /* ---- Data ---- */
  function _tlFilter(today, nm) {
    const mon = _dateToStr(_weekStart(today)), sun = _dateToStr(_addDays(_weekStart(today), 6));
    const q = _tl.q.trim().toLowerCase();
    return _timeBlocks.filter(function (b) {
      if (_tl.tag !== 'all' && b.tagId !== _tl.tag) return false;
      if (_tl.status === 'done' && !b.done) return false;
      if (_tl.status === 'todo' && b.done) return false;
      if (_tl.range === 'today' && b.date !== today) return false;
      if (_tl.range === 'week' && (b.date < mon || b.date > sun)) return false;
      if (_tl.range === 'late' && !_tlLate(b, today, nm)) return false;
      if (q) {
        const hay = [b.title, _tagOrFallback(b.tagId).label].concat((b.checklist || []).map(function (c) { return c.text; })).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function _timelineBlocks(type, src) {
    const today = _todayStr(), list = (src || _timeBlocks).slice();
    const byStart = function (a, b) { return _toMins(a.startTime) - _toMins(b.startTime); };
    if (type === 'newest') return list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (type === 'duration') return list.sort(function (a, b) { return (_toMins(b.endTime) - _toMins(b.startTime)) - (_toMins(a.endTime) - _toMins(a.startTime)); });
    const up = list.filter(function (b) { return b.date >= today; }).sort(function (a, b) { return a.date === b.date ? byStart(a, b) : a.date < b.date ? -1 : 1; });
    const past = list.filter(function (b) { return b.date < today; }).sort(function (a, b) { return a.date === b.date ? byStart(a, b) : a.date < b.date ? 1 : -1; });
    return up.concat(past);
  }

  /* ---- Controls ---- */
  function _tlSyncControls() {
    _all('#hub-tm-tl-range [data-tl-range]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tl-range') === _tl.range ? 'true' : 'false'); });
    _all('#hub-tm-tl-status [data-tl-status]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-tl-status') === _tl.status ? 'true' : 'false'); });
    if (_tl.tag !== 'all' && !_tagById(_tl.tag)) _tl.tag = 'all';
    const counts = {};
    _timeBlocks.forEach(function (b) { counts[b.tagId] = (counts[b.tagId] || 0) + 1; });
    const vis = _allTags().filter(function (t) { return counts[t.id] || _tl.tag === t.id; });
    const sig = vis.map(function (t) { return t.id + '|' + t.label + '|' + t.color + '|' + (counts[t.id] || 0); }).join(';') + '#' + _timeBlocks.length;
    const box = _el('#hub-tm-tl-tags');
    if (box._sig !== sig) {
      box.innerHTML = '<button type="button" class="hub-tm-tl-chip" data-tl-tag="all" aria-pressed="false">All<i>' + _timeBlocks.length + '</i></button>' +
        vis.map(function (t) {
          return '<button type="button" class="hub-tm-tl-chip" data-tl-tag="' + _esc(t.id) + '" style="' + _tagStyle(t) + '" aria-pressed="false"><span class="hub-tm-tag-dot"></span>' + _esc(t.label) + '<i>' + (counts[t.id] || 0) + '</i></button>';
        }).join('');
      box._sig = sig;
    }
    box.hidden = vis.length < 2 && _tl.tag === 'all';
    _all('#hub-tm-tl-tags [data-tl-tag]').forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-tl-tag') === _tl.tag ? 'true' : 'false'); });
  }

  /* ---- Spotlight (NOW / UP NEXT) ---- */
  function _tlPaintSpot(today, nm) {
    const open = _timeBlocks.filter(function (b) { return !b.done; }).sort(_tlCmp);
    const live = open.find(function (b) { return _tlLive(b, today, nm); });
    const next = open.find(function (b) { return b.date > today || (b.date === today && _toMins(b.startTime) > nm); });
    const b = live || next;
    let html;
    if (!b) {
      html = '<div class="hub-tm-tl-spot is-idle"><span class="hub-tm-tl-spot-kicker">All clear</span><span class="hub-tm-tl-spot-title">Nothing left on your schedule</span><span class="hub-tm-tl-spot-sub">Drag on the day grid to plan your next block.</span></div>';
    } else {
      const tag = _tagOrFallback(b.tagId), s = _toMins(b.startTime), e = _toMins(b.endTime), d = _parseDate(b.date), diff = _tlDayDiff(b.date);
      let kick, extra = '';
      if (live) {
        kick = 'Now · ' + _fmtDur(e - nm) + ' left';
        extra = '<span class="hub-tm-tl-bar"><i style="width:' + _clamp(Math.round((nm - s) / (e - s) * 100), 0, 100) + '%"></i></span>';
        if (next) extra += '<span class="hub-tm-tl-spot-sub">Then · ' + (next.date === today ? '' : _tlRel(_tlDayDiff(next.date)) + ' ') + _esc(next.startTime) + ' · ' + _esc(next.title || _tagOrFallback(next.tagId).label) + '</span>';
      } else {
        kick = 'Up next · ' + (diff === 0 ? 'in ' + _fmtDur(s - nm) : _tlRel(diff));
      }
      html = '<button type="button" class="hub-tm-tl-spot' + (live ? ' is-live' : '') + '" data-tl-go="' + _esc(b.id) + '" style="' + _tagStyle(tag) + '">' +
        '<span class="hub-tm-tl-spot-kicker">' + kick + '</span>' +
        '<span class="hub-tm-tl-spot-title">' + _esc(b.title || tag.label) + '</span>' +
        '<span class="hub-tm-tl-spot-sub">' + (diff === 0 ? '' : DAY_SHORT[d.getDay()] + ' ' + _dateLabel(d) + ' · ') + _esc(b.startTime) + '–' + _esc(b.endTime) + ' · ' + _esc(tag.label) + '</span>' + extra +
        '</button>';
    }
    _tlSet(_el('#hub-tm-tl-spot'), html);
    return { liveId: live ? live.id : '', nextId: live ? (next ? next.id : '') : (next ? next.id : '') };
  }

  /* ---- Stats strip ---- */
  function _tlPaintStats(list, today, nm) {
    let mins = 0, done = 0, late = 0;
    list.forEach(function (b) { mins += _toMins(b.endTime) - _toMins(b.startTime); if (b.done) done++; if (_tlLate(b, today, nm)) late++; });
    const n = list.length, pct = n ? Math.round(done / n * 100) : 0;
    const cell = function (k, v, extra, tag, attrs) { return '<' + tag + (tag === 'button' ? ' type="button"' : '') + ' class="hub-tm-tl-stat' + (attrs.cls || '') + '"' + (attrs.attr || '') + '><span class="hub-tm-tl-stat-k">' + k + '</span><span class="hub-tm-tl-stat-v">' + v + '</span>' + (extra || '') + '</' + tag + '>'; };
    const html =
      cell('Blocks', n, '', 'div', {}) +
      cell('Planned', n ? _fmtDur(mins) : '0m', '', 'div', {}) +
      cell('Done', done + '/' + n, '<span class="hub-tm-tl-bar" style="--tm-c:var(--accent-primary)"><i style="width:' + pct + '%"></i></span>', 'div', {}) +
      (late ? cell('Overdue', late, '', 'button', { cls: ' is-alert', attr: ' data-tl-range="late" title="Show overdue blocks"' }) : cell('Overdue', 0, '', 'div', {}));
    _tlSet(_el('#hub-tm-tl-stats'), html);
  }

  /* ---- Rows & groups ---- */
  function _tlItem(b, c) {
    const tag = _tagOrFallback(b.tagId), s = _toMins(b.startTime), e = _toMins(b.endTime), id = _esc(b.id), title = _esc(b.title || tag.label);
    const live = c.liveId === b.id, late = _tlLate(b, c.today, c.nm), next = c.nextId === b.id && !live;
    const ck = b.checklist || [], ckDone = ck.filter(function (i) { return i.done; }).length;
    const meta = [];
    if (live) meta.push('<b class="hub-tm-tl-badge is-live">Live</b>');
    else if (late) meta.push('<b class="hub-tm-tl-badge is-late">Overdue</b>');
    else if (next) meta.push('<b class="hub-tm-tl-badge is-next">Up next</b>');
    meta.push('<span>' + _esc(tag.label) + '</span>');
    if (c.flat) meta.push('<span>' + _esc(b.startTime) + '–' + _esc(b.endTime) + '</span>');
    meta.push('<span>' + _fmtDur(e - s) + '</span>');
    if (b.done && b.gp > 0) meta.push('<span class="hub-tm-tl-gold">+' + _fmtGold(b.gp) + ' gold</span>');
    let when;
    if (c.flat) { const d = _parseDate(b.date); when = '<span class="hub-tm-tl-t1">' + _dateLabel(d) + '</span><span class="hub-tm-tl-t2">' + DAY_SHORT[d.getDay()] + '</span>'; }
    else when = '<span class="hub-tm-tl-t1">' + _esc(b.startTime) + '</span><span class="hub-tm-tl-t2">' + _esc(b.endTime) + '</span>';
    const mvName = _tlDayName(_tlMoveTarget(b, c.today), c.today);
    // Checklist drawer: the live block opens by itself until the person decides otherwise
    const isOpen = _tl.open[b.id] !== undefined ? !!_tl.open[b.id] : (live && ck.length > 0);
    const pid = 'hub-tm-tlp-' + id;
    const ckPct = ck.length ? Math.round(ckDone / ck.length * 100) : 0;
    const strip = '<div class="hub-tm-tl-sub"><button type="button" class="hub-tm-tl-toggle" data-tl-open="' + id + '" aria-expanded="' + isOpen + '"' + (isOpen ? ' aria-controls="' + pid + '"' : '') + ' title="' + (isOpen ? 'Hide' : 'Show') + ' checklist">' +
      TL_ICON.chev + '<span>' + (ck.length ? ckDone + '/' + ck.length + ' tasks' : 'No tasks') + '</span>' +
      (ck.length ? '<span class="hub-tm-tl-ckbar" aria-hidden="true"><i style="width:' + ckPct + '%"></i></span>' : '') + '</button></div>';
    let panel = '';
    if (isOpen) {
      panel = '<div class="hub-tm-tl-panel" id="' + pid + '">' +
        (ck.length
          ? '<ul class="hub-tm-tl-ck">' + ck.map(function (i) {
              return '<li class="' + (i.done ? 'is-done' : '') + '"><label class="hub-tm-tl-ckrow"><span class="hub-tm-ck-box"><input type="checkbox" data-tl-ck="' + _esc(i.id) + '" data-tl-blk="' + id + '"' + (i.done ? ' checked' : '') + '><span></span></span><span class="hub-tm-tl-cktext">' + _esc(i.text) + '</span></label></li>';
            }).join('') + '</ul>'
          : '<p class="hub-tm-tl-ckempty">No tasks yet — add some in the editor.</p>') +
        '<button type="button" class="hub-tm-tl-ckedit" data-tl-edit="' + id + '">' + TL_ICON.edit + '<span>Edit block &amp; checklist</span></button></div>';
    }
    const cls = 'hub-tm-tl-item' + (b.done ? ' is-done' : '') + (live ? ' is-live' : '') + (late ? ' is-late' : '');
    return '<li class="' + cls + '" style="' + _tagStyle(tag) + '">' +
      '<span class="hub-tm-tl-when">' + when + '</span><span class="hub-tm-tl-node" aria-hidden="true"></span>' +
      '<div class="hub-tm-tl-card">' +
        '<button type="button" class="hub-tm-tl-main" data-tl-go="' + id + '">' +
          '<span class="hub-tm-tl-title">' + title + '</span>' +
          '<span class="hub-tm-tl-meta">' + meta.join('<span class="hub-tm-tl-sep" aria-hidden="true">·</span>') +
            (live ? '<span class="hub-tm-tl-bar"><i style="width:' + _clamp(Math.round((c.nm - s) / (e - s) * 100), 0, 100) + '%"></i></span>' : '') + '</span>' +
        '</button>' +
        '<span class="hub-tm-tl-acts">' +
          '<button type="button" class="hub-tm-tl-act" data-tl-edit="' + id + '" title="Edit block" aria-label="Edit ' + title + '">' + TL_ICON.edit + '</button>' +
          '<button type="button" class="hub-tm-tl-act hub-tm-tl-act--done" role="checkbox" aria-checked="' + (b.done ? 'true' : 'false') + '" data-tl-done="' + id + '" title="' + (b.done ? 'Mark not complete' : 'Mark complete') + '" aria-label="' + (b.done ? 'Mark ' + title + ' not complete' : 'Mark ' + title + ' complete') + '">' + TL_ICON.check + '</button>' +
          (b.done ? '' : '<button type="button" class="hub-tm-tl-act" data-tl-next="' + id + '" title="Move to ' + _esc(mvName) + '" aria-label="Move ' + title + ' to ' + _esc(mvName) + '">' + TL_ICON.fwd + '</button>') +
          '<button type="button" class="hub-tm-tl-act hub-tm-tl-act--del" data-tl-del="' + id + '" title="Delete" aria-label="Delete ' + title + '">' + TL_ICON.del + '</button>' +
        '</span>' +
        strip + panel +
      '</div></li>';
  }
  function _tlGroup(g, c) {
    const d = _parseDate(g.date), diff = _tlDayDiff(g.date), isToday = diff === 0;
    let mins = 0, done = 0, gold = 0;
    g.items.forEach(function (b) { mins += _toMins(b.endTime) - _toMins(b.startTime); if (b.done) done++; gold += b.gp || 0; });
    const label = isToday ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : DAY_FULL[d.getDay()];
    let rows = '', placed = !isToday || !!c.liveId;
    g.items.forEach(function (b, i) {
      const s = _toMins(b.startTime);
      if (!placed && s > c.nm) {
        rows += '<li class="hub-tm-tl-now" aria-label="Current time"><span class="hub-tm-tl-now-t">' + _pad(Math.floor(c.nm / 60)) + ':' + _pad(c.nm % 60) + '</span><i class="hub-tm-tl-now-dot"></i><i class="hub-tm-tl-now-line"></i></li>';
        placed = true;
      } else if (c.gaps && i > 0) {
        const gap = s - _toMins(g.items[i - 1].endTime);
        if (gap >= 30) rows += '<li class="hub-tm-tl-gap" aria-hidden="true"><span>Free · ' + _fmtDur(gap) + '</span></li>';
      }
      rows += _tlItem(b, c);
    });
    if (!placed) rows += '<li class="hub-tm-tl-now" aria-label="Current time"><span class="hub-tm-tl-now-t">' + _pad(Math.floor(c.nm / 60)) + ':' + _pad(c.nm % 60) + '</span><i class="hub-tm-tl-now-dot"></i><i class="hub-tm-tl-now-line"></i></li>';
    return '<section class="hub-tm-tl-group' + (isToday ? ' is-today' : '') + '">' +
      '<button type="button" class="hub-tm-tl-ghead" data-tl-day="' + _esc(g.date) + '" title="Open this day">' +
        '<span class="hub-tm-tl-day">' + label + '</span><span class="hub-tm-tl-date">' + DAY_SHORT[d.getDay()] + ', ' + _dateLabel(d) + ', ' + d.getFullYear() + '</span>' +
        (Math.abs(diff) > 1 ? '<span class="hub-tm-tl-rel">' + _tlRel(diff) + '</span>' : '') +
        '<span class="hub-tm-tl-gsum">' + done + '/' + g.items.length + ' · ' + _fmtDur(mins) + (gold > 0 ? ' · +' + _fmtGold(gold) : '') + '</span>' +
      '</button><ul class="hub-tm-tl-rail">' + rows + '</ul></section>';
  }
  function _tlEmpty(filtered) {
    return filtered
      ? '<div class="hub-tm-tl-empty"><b>No blocks match</b><p>Try another range, tag or search term.</p><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-tl-reset>Reset filters</button></div>'
      : '<div class="hub-tm-tl-empty"><b>Your timeline is empty</b><p>Drag across the day grid to plan your first block — it will appear here.</p></div>';
  }

  /* ---- Render ---- */
  function _renderTimeline() {
    const box = _el('#hub-tm-timeline-list'), sc = _el('#hub-tm-tl-scroll');
    if (!box || !sc) return;
    const type = _el('#tm-timeline-sort').value, today = _todayStr(), nm = _tlNowMins();
    _tlSyncControls();
    const spot = _tlPaintSpot(today, nm);
    const list = _tlFilter(today, nm), blocks = _timelineBlocks(type, list);
    _tlPaintStats(list, today, nm);

    const noFilter = !_tl.q.trim() && _tl.tag === 'all' && _tl.status === 'all';
    const c = { today: today, nm: nm, liveId: spot.liveId, nextId: spot.nextId, flat: type !== 'nearest', gaps: type === 'nearest' && noFilter };
    let html;
    if (!_timeBlocks.length) html = _tlEmpty(false);
    else if (!blocks.length) html = _tlEmpty(true);
    else if (type !== 'nearest') {
      html = '<section class="hub-tm-tl-group"><div class="hub-tm-tl-ghead hub-tm-tl-ghead--static"><span class="hub-tm-tl-day">' + (type === 'newest' ? 'Newly added' : 'Longest first') + '</span><span class="hub-tm-tl-gsum">' + _tlPlural(blocks.length, 'block') + '</span></div>' +
        '<ul class="hub-tm-tl-rail">' + blocks.map(function (b) { return _tlItem(b, c); }).join('') + '</ul></section>';
    } else {
      const groups = [];
      blocks.forEach(function (b) {
        const g = groups[groups.length - 1];
        if (g && g.date === b.date) g.items.push(b); else groups.push({ date: b.date, items: [b] });
      });
      const upG = groups.filter(function (g) { return g.date >= today; }), pastG = groups.filter(function (g) { return g.date < today; });
      html = upG.map(function (g) { return _tlGroup(g, c); }).join('');
      if (pastG.length) {
        const collapsible = _tl.range === 'all' && !_tl.q.trim(), open = !collapsible || _tl.pastOpen || !upG.length;
        if (collapsible) {
          let pb = 0, late = 0;
          pastG.forEach(function (g) { pb += g.items.length; g.items.forEach(function (b) { if (_tlLate(b, today, nm)) late++; }); });
          html += '<button type="button" class="hub-tm-tl-past" data-tl-past aria-expanded="' + (open ? 'true' : 'false') + '">' + TL_ICON.chev + '<span>Earlier</span><span class="hub-tm-tl-past-n">' + _tlPlural(pb, 'block') + ' · ' + _tlPlural(pastG.length, 'day') + (late ? ' · <b>' + late + ' overdue</b>' : '') + '</span></button>';
        }
        if (open) html += pastG.map(function (g) { return _tlGroup(g, c); }).join('');
      }
    }

    const act = document.activeElement;
    let fk = null;
    if (act && box.contains(act)) {
      ['data-tl-go', 'data-tl-done', 'data-tl-next', 'data-tl-del', 'data-tl-day', 'data-tl-past'].some(function (a) {
        if (act.hasAttribute(a)) { fk = [a, act.getAttribute(a)]; return true; }
        return false;
      });
    }
    const top = sc.scrollTop;
    if (_tlSet(box, html)) {
      sc.scrollTop = top;
      if (fk) {
        const n = box.querySelector('[' + fk[0] + '="' + (window.CSS && CSS.escape ? CSS.escape(fk[1]) : fk[1]) + '"]');
        if (n) n.focus({ preventScroll: true });
      }
    }
  }

  /* ============================================================
     SOUND DESIGN — "Chime engine"
     • No audio files: every sound is synthesised with the Web Audio API,
       so it works offline and never breaks because a link died.
     • One instrument per theme (radar synth / singing bowl / soft keys /
       terminal beep), or pick one manually.
     • Every tag owns a short melody (3-4 notes of a pentatonic scale), so
       you can tell what is starting without looking.
     • Four moments per block: heads-up → start → wrap-up → end. Blocks that
       touch each other get ONE combined "handover" cue instead of two bells.
     • Cues are scheduled on the AudioContext clock up to ~75 s ahead, so
       throttled background tabs keep perfect time.
     The scheduler lives at module level, so alerts still sound while another
     module is on screen.
     ============================================================ */
  const LEAD_CHOICES = [1, 2, 5, 10];
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19];          // semitone ladder (major pentatonic, ~1.6 octaves)
  const TAG_MOTIFS = { work: [0, 2, 3], study: [1, 0, 2], skill: [0, 3, 5, 3], personal: [3, 5, 4] };
  const VOICES = {
    cyber:    { label: 'Cyberpunk radar', root: 293.66, gap: 0.095, dur: 0.34 },
    solar:    { label: 'Solar bowl',      root: 261.63, gap: 0.30,  dur: 2.1 },
    lofi:     { label: 'Lo-fi keys',      root: 246.94, gap: 0.20,  dur: 1.05 },
    terminal: { label: 'Terminal beep',   root: 440,    gap: 0.11,  dur: 0.08 }
  };
  const CUE_NAME = { pre: 'heads-up', start: 'start', warn: 'wrap-up', end: 'end', handover: 'handover' };

  function _hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function _motifFor(tagId) {
    if (TAG_MOTIFS[tagId]) return TAG_MOTIFS[tagId];
    let h = _hash(String(tagId));
    const m = [];
    for (let i = 0; i < 3; i++) { m.push(h % 7); h = Math.floor(h / 7) + 3; }
    if (m[0] === m[1] && m[1] === m[2]) m[2] = (m[2] + 2) % 7;
    return m;
  }

  /* ---- Cue = list of notes {s: semitones, at: steps, vel, len} ---- */
  function _cueNotes(type, tagId) {
    const m = _motifFor(tagId).map(function (i) { return PENTA[i]; });
    const rev = m.slice().reverse();
    const start = m.map(function (s, k) { return { s: s, at: k, vel: 0.9, len: k === m.length - 1 ? 1.6 : 1 }; });
    if (type === 'pre')  return [{ s: m[0], at: 0, vel: 0.4, len: 0.7 }];
    if (type === 'start') return start;
    if (type === 'warn') return [{ s: m[Math.min(1, m.length - 1)], at: 0, vel: 0.55, len: 0.8 }, { s: m[0], at: 1.7, vel: 0.55, len: 0.8 }];
    if (type === 'end') {
      return rev.map(function (s, k) { return { s: s, at: k, vel: 0.8, len: 1 }; })
        .concat([{ s: -12, at: rev.length, vel: 0.8, len: 1.9 }]);                 // resolve to the low root
    }
    // handover: a falling goodbye note, then the next block's melody
    return [{ s: rev[0], at: 0, vel: 0.45, len: 0.7 }].concat(start.map(function (n) {
      return { s: n.s, at: n.at + 2.4, vel: n.vel, len: n.len };
    }));
  }

  /* ---- The four instruments ---- */
  function _voiceTone(key, c, out, t, f, dur, vel) {
    const g = c.createGain();
    g.connect(out);
    const run = function (o, end) { o.start(t); o.stop(end); };
    const env = function (peak, attack, endT) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vel), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, endT);
    };
    if (key === 'solar') {                                   // singing bowl: inharmonic partials, long tail
      [[1, 1], [2.76, 0.42], [5.4, 0.2], [8.93, 0.08]].forEach(function (p) {
        const o = c.createOscillator(), pg = c.createGain();
        o.type = 'sine'; o.frequency.value = f * p[0]; pg.gain.value = p[1];
        o.connect(pg); pg.connect(g); run(o, t + dur + 0.1);
      });
      env(0.2, 0.012, t + dur);
    } else if (key === 'lofi') {                             // soft electric keys with a little wobble
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1700; lp.connect(g);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 5; lg.gain.value = 7; lfo.connect(lg);
      [['triangle', f, 1], ['sine', f / 2, 0.5]].forEach(function (p) {
        const o = c.createOscillator(), pg = c.createGain();
        o.type = p[0]; o.frequency.value = p[1]; pg.gain.value = p[2];
        lg.connect(o.detune); o.connect(pg); pg.connect(lp); run(o, t + dur + 0.05);
      });
      run(lfo, t + dur + 0.05);
      env(0.2, 0.018, t + dur);
    } else if (key === 'terminal') {                         // hard square beep, no tail
      const o = c.createOscillator();
      o.type = 'square'; o.frequency.value = f; o.connect(g); run(o, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.002);
      g.gain.setValueAtTime(0.1 * vel, t + Math.max(0.004, dur - 0.012));
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else {                                                 // cyber: detuned saws, closing filter sweep
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(Math.min(4200, f * 9), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 1.5), t + dur);
      lp.connect(g);
      [-7, 7].forEach(function (d) {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); run(o, t + dur + 0.05);
      });
      env(0.16, 0.006, t + dur);
    }
  }

  /* ---- Context, voice choice, unlock ---- */
  function _ensureCtx() {
    if (_ctx) return _ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { return null; }
    const comp = _ctx.createDynamicsCompressor();
    _master = _ctx.createGain();
    _master.gain.value = 0.85;
    _master.connect(comp);
    comp.connect(_ctx.destination);
    _ctx.onstatechange = function () { _updateChip(); if (_armed()) _audioTick(); };
    return _ctx;
  }
  function _themeVoice() {
    const b = document.body;
    if (b && b.classList.contains('theme-optimized')) return 'terminal';
    const t = document.documentElement.getAttribute('data-theme') || (b && b.getAttribute('data-theme')) || '';
    return t === 'solar-zen' ? 'solar' : t === 'lofi-twilight' ? 'lofi' : 'cyber';
  }
  function _voiceKey(pref) { pref = pref || _audio.voice; return VOICES[pref] ? pref : _themeVoice(); }
  function _armed() { return !!(_ctx && _ctx.state === 'running'); }
  /** Browsers only allow sound after a user gesture; any click / key press arms the engine. */
  function _unlockAudio() {
    if (!_audio.enabled || _armed()) return;
    const c = _ensureCtx();
    if (c && c.state !== 'running') c.resume().then(function () { _updateChip(); _audioTick(); }).catch(function () {});
  }
  function _armNow() {
    const c = _ensureCtx();
    if (!c) return Promise.reject(new Error('no audio'));
    return c.state === 'running' ? Promise.resolve(c) : c.resume().then(function () { return c; });
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
    window.addEventListener(ev, _unlockAudio, { passive: true, capture: true });
  });

  /** Play one cue at ctx time `when`. Returns the cue's bus so it can be cancelled. */
  function _playCue(ev, when, o) {
    const c = _ctx, key = _voiceKey(o && o.voice), v = VOICES[key];
    const bus = c.createGain();
    bus.gain.value = _clamp(((o && o.vol !== undefined) ? o.vol : _audio.volume) / 100, 0, 1);
    bus.connect(_master);
    _cueNotes(ev.type, ev.tagId).forEach(function (n) {
      _voiceTone(key, c, bus, when + n.at * v.gap, v.root * Math.pow(2, n.s / 12), v.dur * n.len, n.vel);
    });
    return bus;
  }

  /* ---- What is due, and when ---- */
  function _ms(date, mins) { const d = _parseDate(date); d.setMinutes(mins); return d.getTime(); }
  function _cueEvents(from, to) {
    const cf = _audio.cues, pre = _audio.preMins * 60000, warn = _audio.warnMins * 60000;
    const lo = _dateToStr(new Date(from - 86400000)), hi = _dateToStr(new Date(to));
    const list = _timeBlocks.filter(function (b) { return b.date >= lo && b.date <= hi; }).map(function (b) {
      return { b: b, s: _ms(b.date, _toMins(b.startTime)), e: _ms(b.date, _toMins(b.endTime)) };
    });
    const endAt = {}, startAt = {};
    list.forEach(function (o) { endAt[o.e] = o; startAt[o.s] = o; });
    const out = [];
    list.forEach(function (o) {
      const add = function (type, at) {
        if (at < from || at > to) return;
        out.push({ type: type, at: at, key: type + '|' + o.b.id + '|' + at, blockId: o.b.id, tagId: o.b.tagId, title: o.b.title });
      };
      const prev = endAt[o.s];
      const busy = list.some(function (x) { return x !== o && x.s <= o.s - pre && x.e > o.s - pre; });
      if (cf.pre && pre && !prev && !busy) add('pre', o.s - pre);
      if (prev && cf.handover) add('handover', o.s);
      else if (cf.start) add('start', prev ? o.s + 1300 : o.s);   // if it can't merge, stagger it after the previous end
      if (cf.warn && warn && (o.e - o.s) >= 2 * warn && !startAt[o.e]) add('warn', o.e - warn);
      if (cf.end && !(startAt[o.e] && cf.handover)) add('end', o.e);
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }
  function _nextCue() {
    const now = Date.now();
    return _cueEvents(now, now + 36 * 3600000).filter(function (e) { return e.at > now; })[0] || null;
  }

  function _audioTick() {
    if (!_audio.enabled) return;
    const now = Date.now();
    _cueEvents(now - 3000, now + 75000).forEach(function (ev) {
      if (_sched[ev.key]) return;
      if (_fire(ev, now)) _sched[ev.key] = ev.at;       // unarmed cues stay unscheduled, so they still play once sound is unlocked
    });
    Object.keys(_sched).forEach(function (k) { if (_sched[k] < now - 300000) delete _sched[k]; });
  }
  function _fire(ev, now) {
    const delay = Math.max(0, ev.at - now);
    if (_audio.useCustom && (ev.type === 'start' || ev.type === 'end' || ev.type === 'handover')) {
      const first = ev.type === 'start' ? _audio.startSoundURL : _audio.endSoundURL;
      const id = setTimeout(function () {
        _play(first);
        if (ev.type === 'handover') _cueTimers.push(setTimeout(function () { _play(_audio.startSoundURL); }, 1100));
      }, delay);
      _cueTimers.push(id);
      return true;
    }
    const c = _ensureCtx();
    if (!c || c.state !== 'running') { _updateChip(); return false; }    // not armed yet — chip tells the user
    _buses.push({ bus: _playCue(ev, c.currentTime + 0.04 + delay / 1000), at: ev.at });
    return true;
  }
  /** Blocks or settings changed: cancel what was queued and queue it again from fresh data. */
  function _resetSchedule() {
    const now = Date.now();
    _buses = _buses.filter(function (b) {
      if (b.at > now) { try { b.bus.disconnect(); } catch (_) {} return false; }
      return b.at > now - 5000;
    });
    _cueTimers.forEach(clearTimeout);
    _cueTimers = [];
    Object.keys(_sched).forEach(function (k) { if (_sched[k] > now) delete _sched[k]; });
    if (_audio.enabled) _audioTick();
    _updateChip();
  }
  function _startAudio() {
    _stopAudio();
    _audioTimer = setInterval(_audioTick, 1000);
    _audioTick();
    _updateChip();
  }
  function _stopAudio() {
    if (_audioTimer) { clearInterval(_audioTimer); _audioTimer = null; }
    _resetSchedule();
  }
  function _play(url) {
    if (!url) return;
    try { const a = new Audio(url); a.volume = _clamp(_audio.volume / 100, 0, 1); const p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (_) {}
  }

  /* ---- Toolbar chip: shows whether alerts can sound, and what is next ---- */
  function _updateChip() {
    const chip = _el('#hub-tm-audio-chip');
    if (!chip) return;
    chip.classList.toggle('hub-tm-hidden', !_audio.enabled);
    if (!_audio.enabled) return;
    const armed = _armed(), t = chip.querySelector('.hub-tm-chip-text');
    chip.classList.toggle('is-armed', armed);
    chip.classList.toggle('is-waiting', !armed);
    if (!armed) { t.textContent = 'Click anywhere to arm alerts'; chip.title = 'Browsers keep sound off until you interact with the page.'; return; }
    const n = _nextCue();
    if (!n) { t.textContent = 'Alerts on · nothing scheduled'; chip.title = 'Alerts are armed.'; return; }
    const d = new Date(n.at);
    t.textContent = 'Next ' + _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ' · ' + CUE_NAME[n.type];
    chip.title = (n.title || _tagOrFallback(n.tagId).label) + ' — ' + CUE_NAME[n.type];
  }

  /* ============================================================
     NOTIFICATIONS  ·  system notifications for the same moments as the sound cues
     - Fires for pre / start / wrap-up / end / handover (honours the Cue sheet).
     - Driven by a Web-Worker heartbeat so background tabs are not throttled.
     - Shown through a service worker (tm-sw.js) when available — required on
       Android — and falls back to `new Notification()` on desktop.
     - Per device: the on/off switch is stored locally, never synced.
     - Limit: needs the page open in some tab. Reaching a closed browser needs a
       push server (tm-sw.js already contains the `push` handler for that).
     ============================================================ */
  function _notifSupported() { return typeof Notification !== 'undefined' && window.isSecureContext !== false; }
  function _notifReady() { return _notifSupported() && Notification.permission === 'granted'; }
  function _loadNotif() {
    const p = _lsJson(NOTIF_KEY);
    if (p && typeof p === 'object') { _notif.enabled = !!p.enabled; _notif.bgOnly = p.bgOnly !== false; }
  }
  function _saveNotif() { _lsSet(NOTIF_KEY, JSON.stringify(_notif)); }

  /** Must be called straight from a click (user gesture). */
  function _askNotifPermission() {
    if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
    if (window.isSecureContext === false) return Promise.resolve('insecure');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return new Promise(function (res) {
      let done = false;
      const fin = function (p) { if (!done) { done = true; res(p || Notification.permission); } };
      try { const r = Notification.requestPermission(fin); if (r && r.then) r.then(fin, function () { fin(); }); } catch (_) { fin(); }
    });
  }

  /** Registers tm-sw.js once; resolves to an ACTIVE registration, or null (then desktop falls back to new Notification). */
  function _swGet() {
    if (_swReg && _swReg.active) return Promise.resolve(_swReg);
    if (!('serviceWorker' in navigator) || window.isSecureContext === false) return Promise.resolve(null);
    if (!_swPromise) {
      _swPromise = navigator.serviceWorker.register(new URL(SW_URL, document.baseURI).href).then(function (reg) {
        return new Promise(function (res) {
          if (reg.active) { res(reg); return; }
          const w = reg.installing || reg.waiting;
          if (!w) { res(null); return; }
          w.addEventListener('statechange', function () { if (w.state === 'activated') res(reg); else if (w.state === 'redundant') res(null); });
          setTimeout(function () { res(reg.active ? reg : null); }, 5000);
        });
      }).then(function (reg) { _swReg = reg; if (!reg) _swPromise = null; return reg; })
        .catch(function () { _swPromise = null; return null; });
    }
    return _swPromise;
  }

  function _iconUrl() { const l = document.querySelector('link[rel~="icon"]'); return l && l.href ? l.href : undefined; }

  /** Resolves true when something was shown. */
  function _showNotice(title, opts) {
    return _swGet().then(function (reg) {
      if (reg) return reg.showNotification(title, opts).then(function () { return true; });
      const n = new Notification(title, opts);
      n.onclick = function () { try { window.focus(); } catch (_) {} _openFromNotice(opts.data); n.close(); };
      return true;
    }).catch(function () {
      try {
        const n = new Notification(title, opts);
        n.onclick = function () { try { window.focus(); } catch (_) {} _openFromNotice(opts.data); n.close(); };
        return true;
      } catch (_) { return false; }
    });
  }
  function _openFromNotice(d) {
    const b = d && d.blockId ? _blockById(d.blockId) : null;
    if (!b || !_sectionEl || !_sectionEl.isConnected) return;
    _setDate(b.date, { scrollMins: Math.max(0, _toMins(b.startTime) - 60) });
    setTimeout(function () { _focusBlock(b.id); }, 350);
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'tm-notification-click') _openFromNotice(e.data);
    });
  }

  function _noticeText(ev) {
    const b = _blockById(ev.blockId), tag = _tagOrFallback(ev.tagId);
    const name = ev.title || (b && b.title) || tag.label;
    const range = b ? b.startTime + ' – ' + b.endTime : '';
    const dur = b ? _fmtDur(_toMins(b.endTime) - _toMins(b.startTime)) : '';
    const meta = [range, dur].filter(Boolean).join(' · ');
    switch (ev.type) {
      case 'pre':      return ['Starting soon · ' + name, 'In ' + _audio.preMins + ' min' + (meta ? ' · ' + meta : '')];
      case 'start':    return ['Now · ' + name, meta || tag.label];
      case 'warn':     return ['Wrapping up · ' + name, _audio.warnMins + ' min left' + (b ? ' · ends ' + b.endTime : '')];
      case 'end':      return ['Finished · ' + name, b ? 'Ended at ' + b.endTime : 'Block ended'];
      default:         return ['Next up · ' + name, (meta ? meta + ' · ' : '') + 'previous block just ended'];   // handover
    }
  }
  function _deliverNotice(ev) {
    const t = _noticeText(ev), b = _blockById(ev.blockId);
    if (_notif.bgOnly && document.hasFocus && document.hasFocus() && document.visibilityState === 'visible') {
      _toast(t[0] + ' — ' + t[1]);                       // you are looking at the planner: an in-app toast is enough
      return;
    }
    _showNotice(t[0], {
      body: t[1],
      tag: 'tm-' + ev.blockId,                           // one evolving notification per block
      renotify: true,
      silent: !!(_audio.enabled && _armed()),            // our own chime is already playing
      icon: _iconUrl(),
      timestamp: ev.at,
      data: { blockId: ev.blockId, date: b && b.date, url: location.href }
    });
  }

  /** 1-second heartbeat: delivers whatever became due. Stateless — safe if blocks are edited. */
  function _noticeTick() {
    if (!_notif.enabled || !_notifReady()) return;
    const now = Date.now();
    _cueEvents(now - 20000, now + 500).forEach(function (ev) {
      if (_noticeDone[ev.key]) return;
      _noticeDone[ev.key] = ev.at;
      _deliverNotice(ev);
    });
    Object.keys(_noticeDone).forEach(function (k) { if (_noticeDone[k] < now - 600000) delete _noticeDone[k]; });
  }
  function _noticeSeed() {                                // enabling / reloading must not replay what just passed
    const now = Date.now();
    _cueEvents(now - 120000, now).forEach(function (ev) { _noticeDone[ev.key] = ev.at; });
  }
  function _hbStop() {
    if (_hbWorker) { try { _hbWorker.postMessage('stop'); _hbWorker.terminate(); } catch (_) {} _hbWorker = null; }
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  }
  function _hbStart() {
    _hbStop();
    try {                                                 // workers are not throttled in hidden tabs
      const src = 'var t=setInterval(function(){postMessage(1)},1000);onmessage=function(e){if(e.data==="stop"){clearInterval(t);close();}};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      _hbWorker = new Worker(url);
      _hbWorker.onmessage = _noticeTick;
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (_) { _hbTimer = setInterval(_noticeTick, 1000); }
  }
  function _notifBoot() {
    _loadNotif();
    if (_notif.enabled && _notifReady()) { _noticeSeed(); _hbStart(); _swGet(); }
    else _hbStop();
  }
  /** Save button: apply the switch. Returns a short message for the toast. */
  function _commitNotif(want, bgOnly) {
    _notif.bgOnly = bgOnly;
    const off = function (msg) { _notif.enabled = false; _saveNotif(); _hbStop(); return msg; };
    if (!want) return Promise.resolve(off('notifications off'));
    return _askNotifPermission().then(function (p) {
      if (p === 'granted') {
        _notif.enabled = true; _saveNotif(); _noticeSeed(); _hbStart(); _swGet();
        return 'notifications on';
      }
      return off(p === 'denied' ? 'notifications blocked by the browser' : 'notifications need https and a supporting browser');
    });
  }
  function _syncNotifUi() {
    const tg = _el('#tm-notif-enabled');
    if (!tg) return;
    const sup = typeof Notification !== 'undefined', secure = window.isSecureContext !== false;
    const perm = sup ? Notification.permission : 'denied';
    const blocked = !sup || !secure || perm === 'denied';
    tg.disabled = blocked;
    if (blocked) tg.checked = false;
    const on = tg.checked;
    const master = _el('#tm-notif-master');
    master.classList.toggle('is-on', on);
    master.classList.toggle('is-armed', on && perm === 'granted');
    _el('#tm-notif-bg').disabled = !on;
    _el('[data-notif-test]').disabled = blocked;
    _el('#hub-tm-notif-status').textContent =
        !sup ? 'This browser doesn’t support notifications.'
      : !secure ? 'Notifications need a secure (https) page.'
      : perm === 'denied' ? 'Blocked in the browser — allow Notifications for this site (lock icon in the address bar), then reload.'
      : !on ? 'Off. Turn on to be notified when a block is about to start, starts, wraps up and ends.'
      : perm === 'default' ? 'Your browser will ask for permission when you save.'
      : 'Ready · same moments and lead times as the sound alerts · works while the planner stays open in a tab, background tabs included.';
  }
  function _sendTestNotice() {
    _askNotifPermission().then(function (p) {
      _syncNotifUi();
      if (p !== 'granted') { _toast(p === 'denied' ? 'Notifications are blocked in the browser.' : 'Notifications aren’t available here.'); return; }
      return _showNotice('Time Management · test', {
        body: 'This is how block alerts will look.', tag: 'tm-test', icon: _iconUrl(), data: { url: location.href }
      }).then(function (ok) { _toast(ok ? 'Test sent' : 'Couldn’t show it — is tm-sw.js next to index.html?'); });
    });
  }

  /* ============================================================
     SETTINGS DIALOG
     ============================================================ */
  /* Settings (voice, volume, lead times, cues, custom sounds) follow the account; only the on/off switch is per device. */
  function _applyAudio(p) {
    if (!p || typeof p !== 'object') return;
    try {
      if (VOICES[p.voice] || p.voice === 'auto') _audio.voice = p.voice;
      if (typeof p.volume === 'number') _audio.volume = _clamp(Math.round(p.volume), 0, 100);
      if (LEAD_CHOICES.indexOf(p.preMins) > -1) _audio.preMins = p.preMins;
      if (LEAD_CHOICES.indexOf(p.warnMins) > -1) _audio.warnMins = p.warnMins;
      if (p.cues && typeof p.cues === 'object') Object.keys(_audio.cues).forEach(function (k) { if (typeof p.cues[k] === 'boolean') _audio.cues[k] = p.cues[k]; });
      const clean = function (u) { return typeof u === 'string' && LEGACY_SOUNDS.indexOf(u) === -1 ? u : ''; };
      _audio.startSoundURL = clean(p.startSoundURL);
      _audio.endSoundURL = clean(p.endSoundURL);
      _audio.useCustom = typeof p.useCustom === 'boolean' ? p.useCustom : !!(_audio.startSoundURL || _audio.endSoundURL);   // migrate old custom URLs
    } catch (_) {}
  }
  function _loadAudio() {
    const p = _lsJson(AUDIO_KEY);
    if (p && typeof p === 'object') _audio.enabled = !!p.enabled;
  }
  function _saveAudio() { _lsSet(AUDIO_KEY, JSON.stringify(_audio)); _scheduleSave(); }
  function _validSoundUrl(v) {
    if (!v) return true;
    try { const u = new URL(v, location.href); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; }
  }

  /* ---- Reading the dialog's current (unsaved) state ---- */
  function _snd(sel) { return _el('#hub-tm-settings-modal ' + sel); }
  function _sndAll(sel) { return _all('#hub-tm-settings-modal ' + sel); }
  function _formVoice() { const r = _snd('input[name="tm-audio-voice"]:checked'); return r ? r.value : 'auto'; }
  function _formLead(name) { const r = _snd('input[name="' + name + '"]:checked'); const n = r ? parseInt(r.value, 10) : 5; return LEAD_CHOICES.indexOf(n) > -1 ? n : 5; }
  function _formTag() { const r = _snd('input[name="tm-preview-tag"]:checked'); return r ? r.value : _activeTagId; }
  function _formVol() { return _clamp(parseInt(_el('#tm-audio-volume').value, 10) || 0, 0, 100); }
  function _setRadio(name, val) { _sndAll('input[name="' + name + '"]').forEach(function (r) { r.checked = r.value === String(val); }); }

  /* ---- Melody glyph: the cue's real notes drawn as a tiny piano roll ---- */
  function _rollMarkup(type, tagId) {
    const notes = _cueNotes(type, tagId);
    let total = 0, lo = 99, hi = -99;
    notes.forEach(function (n) { total = Math.max(total, n.at + n.len); lo = Math.min(lo, n.s); hi = Math.max(hi, n.s); });
    const W = 72, H = 26, pad = 3, bar = 4, span = Math.max(12, hi - lo);
    return notes.map(function (n) {
      const x = (n.at / total) * W, w = Math.max(3, (n.len / total) * W - 1.5);
      const y = pad + (1 - (n.s - lo) / span) * (H - 2 * pad - bar);
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + bar + '" rx="2" opacity="' + (0.4 + n.vel * 0.6).toFixed(2) + '"/>';
    }).join('');
  }
  function _renderRolls() {
    const tagId = _formTag(), tag = _tagOrFallback(tagId);
    _el('#tm-snd').style.setProperty('--tm-c', _safeColor(tag.color));
    _sndAll('[data-roll]').forEach(function (svg) { svg.innerHTML = _rollMarkup(svg.getAttribute('data-roll'), tagId); });
  }

  /* ---- Auditioning (always plays the dialog's CURRENT choices, saved or not) ---- */
  function _cueSpan(type, tagId, key) {         // seconds the cue rings for
    const v = VOICES[key];
    let m = 0;
    _cueNotes(type, tagId).forEach(function (n) { m = Math.max(m, n.at * v.gap + v.dur * n.len); });
    return m;
  }
  function _mark(type, ms) {
    const row = _snd('[data-cue="' + type + '"]');
    if (!row) return;
    row.classList.add('is-playing');
    const id = setTimeout(function () { row.classList.remove('is-playing'); }, ms);
    if (_sample) _sample.timers.push(id);
  }
  function _sndError(msg) { _el('#hub-tm-settings-error').textContent = msg || ''; }
  function _audition(type) {
    _sndError('');
    _stopSample();
    const form = { voice: _formVoice(), vol: _formVol() }, tagId = _formTag();
    return _armNow().then(function (c) {
      _playCue({ type: type, tagId: tagId }, c.currentTime + 0.05, form);
      _mark(type, _cueSpan(type, tagId, _voiceKey(form.voice)) * 1000 + 150);
    }).catch(function () { _sndError('This browser can’t play synthesised sound.'); });
  }
  function _stopSample() {
    if (!_sample) return;
    _sample.timers.forEach(clearTimeout);
    _sample.buses.forEach(function (b) { try { b.disconnect(); } catch (_) {} });
    _sample = null;
    _sndAll('.is-playing').forEach(function (n) { if (n.id !== 'tm-sample') n.classList.remove('is-playing'); });
    const b = _el('#tm-sample');
    if (b) { b.classList.remove('is-playing'); b.querySelector('span').textContent = 'Hear a sample block'; }
  }
  /** Plays heads-up → start → wrap-up → end back to back (gaps shortened), only the moments that are switched on. */
  function _playSample() {
    if (_sample) { _stopSample(); return; }
    _sndError('');
    const types = ['pre', 'start', 'warn', 'end'].filter(function (t) { return _el('#tm-cue-' + t).checked; });
    if (!types.length) { _sndError('Switch on at least one moment to hear it.'); return; }
    const form = { voice: _formVoice(), vol: _formVol() }, tagId = _formTag(), key = _voiceKey(form.voice);
    _armNow().then(function (c) {
      _sample = { buses: [], timers: [] };
      let t = 0.05;
      types.forEach(function (type) {
        const at = t, span = _cueSpan(type, tagId, key);
        _sample.buses.push(_playCue({ type: type, tagId: tagId }, c.currentTime + at, form));
        _sample.timers.push(setTimeout(function () { _mark(type, span * 1000); }, at * 1000));
        t = at + span + 1.1;
      });
      _sample.timers.push(setTimeout(_stopSample, t * 1000));
      const b = _el('#tm-sample');
      b.classList.add('is-playing');
      b.querySelector('span').textContent = 'Stop sample';
    }).catch(function () { _sndError('This browser can’t play synthesised sound.'); });
  }

  /* ---- Fill / sync ---- */
  function _fillSettings() {
    _stopSample();
    _el('#tm-audio-enabled').checked = _audio.enabled;
    _setRadio('tm-audio-voice', _audio.voice);
    _el('#tm-audio-volume').value = _audio.volume;
    _el('#tm-audio-volume-val').textContent = _audio.volume + '%';
    Object.keys(_audio.cues).forEach(function (k) { _el('#tm-cue-' + k).checked = _audio.cues[k]; });
    _setRadio('tm-pre-mins', _audio.preMins);
    _setRadio('tm-warn-mins', _audio.warnMins);
    _el('#tm-audio-custom').checked = _audio.useCustom;
    _el('#tm-audio-start-url').value = _audio.startSoundURL;
    _el('#tm-audio-end-url').value = _audio.endSoundURL;
    _el('#tm-snd-adv').open = _audio.useCustom;
    const tags = _allTags(), pick = _tagById(_activeTagId) ? _activeTagId : (tags[0] && tags[0].id);
    _el('#tm-preview-tags').innerHTML = '<legend>Melody of</legend>' + tags.map(function (t) {
      return '<label class="hub-tm-melody" style="' + _tagStyle(t) + '"><input type="radio" name="tm-preview-tag" value="' + _esc(t.id) + '"' + (t.id === pick ? ' checked' : '') + '><span><i aria-hidden="true"></i>' + _esc(t.label) + '</span></label>';
    }).join('');
    _renderRolls();
    _el('#tm-notif-enabled').checked = _notif.enabled && _notifReady();
    _el('#tm-notif-bg').checked = _notif.bgOnly;
    _syncSettingsEnabled();
  }
  function _syncSettingsEnabled() {
    const on = _el('#tm-audio-enabled').checked;
    const master = _el('#tm-snd-master');
    master.classList.toggle('is-on', on);
    master.classList.toggle('is-armed', on && _armed());
    _el('#tm-audio-options').classList.toggle('is-off', !on);
    _all('#tm-audio-options input, #tm-audio-options select, #tm-audio-options button').forEach(function (n) { n.disabled = !on; });
    Object.keys(_audio.cues).forEach(function (k) {                    // a moment that is off dims its row and locks its lead time
      const cb = _el('#tm-cue-' + k), row = cb.closest('.hub-tm-st, .hub-tm-ho');
      row.classList.toggle('is-on', cb.checked);
      row.querySelectorAll('.hub-tm-seg input').forEach(function (r) { r.disabled = !on || !cb.checked; });
    });
    const custom = _el('#tm-audio-custom').checked;
    _all('#tm-audio-start-url, #tm-audio-end-url, [data-test-sound]').forEach(function (n) { n.disabled = !on || !custom; });
    const warn = _formLead('tm-warn-mins');
    _el('#tm-warn-note').textContent = 'Two soft pings. Blocks shorter than ' + (2 * warn) + ' min skip it.';
    _el('[data-auto-now]').textContent = 'Now: ' + VOICES[_themeVoice()].label;
    _el('#hub-tm-audio-status').textContent = !on
      ? 'Off. Switch on to hear a chime as blocks start and end.'
      : (_armed() ? 'Ready' : 'Saving arms sound for this tab') + ' · ' + VOICES[_voiceKey(_formVoice())].label + ' · plays only while this page stays open.';
    _syncNotifUi();
  }
  function _openSettings() {
    _fillSettings();
    _sndError('');
    _openModal(_el('#hub-tm-settings-modal'), '#tm-audio-enabled');
  }
  function _bindSettings() {
    const modal = _el('#hub-tm-settings-modal');
    _el('#tm-btn-settings-cancel').addEventListener('click', function () { _closeModal(modal); });
    _el('#hub-tm-audio-chip').addEventListener('click', function () {
      _armNow().then(function () { _updateChip(); _toast('Alerts armed'); }).catch(function () { _toast('This browser can’t play synthesised sound.'); });
    });

    modal.addEventListener('change', function (e) {
      const t = e.target;
      if (t.name === 'tm-audio-voice') { _syncSettingsEnabled(); _audition('start'); }
      else if (t.name === 'tm-preview-tag') { _renderRolls(); _audition('start'); }
      else if (t.id === 'tm-audio-volume') { _audition('pre'); }
      else _syncSettingsEnabled();
    });
    _el('#tm-audio-volume').addEventListener('input', function (e) { _el('#tm-audio-volume-val').textContent = e.target.value + '%'; });
    _el('#tm-sample').addEventListener('click', _playSample);

    _el('#tm-btn-settings-save').addEventListener('click', function () {
      const a = _el('#tm-audio-start-url').value.trim(), b = _el('#tm-audio-end-url').value.trim();
      const custom = _el('#tm-audio-custom').checked;
      if (custom && (!_validSoundUrl(a) || !_validSoundUrl(b))) {
        _el('#tm-snd-adv').open = true;
        _sndError('Sound URLs must start with http:// or https://');
        return;
      }
      _audio.enabled = _el('#tm-audio-enabled').checked;
      _audio.voice = _formVoice();
      _audio.volume = _formVol();
      Object.keys(_audio.cues).forEach(function (k) { _audio.cues[k] = _el('#tm-cue-' + k).checked; });
      _audio.preMins = _formLead('tm-pre-mins');
      _audio.warnMins = _formLead('tm-warn-mins');
      _audio.useCustom = custom;
      _audio.startSoundURL = a;
      _audio.endSoundURL = b;
      _saveAudio();
      if (_audio.enabled) { _startAudio(); _armNow().then(_updateChip).catch(function () {}); }   // this click is the user gesture that arms sound
      else _stopAudio();
      _updateChip();
      const wantN = _el('#tm-notif-enabled').checked, bgN = _el('#tm-notif-bg').checked;   // read first; the permission prompt needs this click
      const pending = _commitNotif(wantN, bgN);
      _closeModal(modal);
      pending.then(function (nMsg) { _toast((_audio.enabled ? 'Sound alerts on' : 'Sound alerts off') + ' · ' + nMsg); });
    });

    modal.addEventListener('click', function (e) {
      const pv = e.target.closest('[data-preview]'), ts = e.target.closest('[data-test-sound]');
      if (e.target.closest('[data-notif-test]')) { _sendTestNotice(); return; }
      if (pv) {
        _audition(pv.getAttribute('data-preview'));
      } else if (ts) {
        const url = (ts.getAttribute('data-test-sound') === 'start' ? _el('#tm-audio-start-url') : _el('#tm-audio-end-url')).value.trim();
        if (!url || !_validSoundUrl(url)) { _sndError('Enter a valid http(s) link first.'); return; }
        _sndError('');
        _play(url);
      }
    });
  }

  /* ============================================================
     CHECKLIST  ·  sub-tasks inside a block
     Edited in Block Details (add / tick / reorder / paste a list), ticked in
     Focus mode, summarised as "2/5" on the block, and kept in step with the
     Habitica To-Do checklist.  Each item remembers its Habitica id (hid) and
     what Habitica last saw (hdone / hfp) so local and remote edits can merge.
     ============================================================ */
  const CK_MAX = 30;
  let _ckDraft = [], _ckDragId = '', _fckSig = '';

  function _ckId() { return 'ck-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function _ck(b) { return b.checklist || (b.checklist = []); }
  function _ckDelList(b) { return b.ckDel || (b.ckDel = []); }
  function _ckStats(b) {
    const l = _ck(b), d = l.filter(function (i) { return i.done; }).length;
    return { done: d, total: l.length, pct: l.length ? Math.round(d / l.length * 100) : 0 };
  }
  function _normCk(list) {
    if (!Array.isArray(list)) return [];
    const seen = {}, out = [];
    list.forEach(function (i) {
      if (!i || out.length >= CK_MAX) return;
      const text = String(i.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      let id = String(i.id || '');
      if (!id || seen[id]) id = _ckId();
      seen[id] = 1;
      out.push({ id: id, text: text, done: i.done === true, hid: i.hid ? String(i.hid).slice(0, 64) : '', hdone: i.hdone === true, hfp: i.hfp ? String(i.hfp).slice(0, 16) : '' });
    });
    return out;
  }
  function _ckNewItem(text) { return { id: _ckId(), text: text, done: false, hid: '', hdone: false, hfp: '' }; }

  /* ── Block Details editor (works on a draft; Save commits it) ── */
  function _ckOpen(b) {
    _ckDraft = _ck(b).map(function (i) { return Object.assign({}, i); });
    _el('#tm-ck-new').value = '';
    _ckRender();
  }
  function _ckRender(focusId) {
    const ul = _el('#tm-ck-list');
    if (!ul) return;
    ul.innerHTML = _ckDraft.map(function (i) {
      return '<li class="hub-tm-ck-item' + (i.done ? ' is-done' : '') + '" data-ck="' + _esc(i.id) + '">' +
        '<span class="hub-tm-ck-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>' +
        '<label class="hub-tm-ck-box"><input type="checkbox"' + (i.done ? ' checked' : '') + ' aria-label="Done"><span></span></label>' +
        '<input type="text" class="hub-tm-ck-text" value="' + _esc(i.text) + '" maxlength="200" aria-label="Checklist item">' +
        '<button type="button" class="hub-tm-ck-del" aria-label="Remove item" title="Remove">&times;</button>' +
      '</li>';
    }).join('');
    _ckMeta();
    if (focusId) { const n = ul.querySelector('[data-ck="' + focusId + '"] .hub-tm-ck-text'); if (n) n.focus(); }
  }
  function _ckImportable() {
    const tpl = document.createElement('template');
    tpl.innerHTML = _sanitizeHtml(_el('#block-desc-editor').innerHTML);
    return Array.prototype.slice.call(tpl.content.querySelectorAll('li'))
      .filter(function (li) { return !li.querySelector('li'); })
      .map(function (li) { return li.textContent.replace(/\s+/g, ' ').trim(); })
      .filter(Boolean).slice(0, CK_MAX);
  }
  function _ckMeta() {
    const d = _ckDraft.filter(function (i) { return i.done; }).length, t = _ckDraft.length;
    _el('#tm-ck-count').textContent = t ? d + '/' + t : '';
    _el('#tm-ck-fill').style.width = (t ? Math.round(d / t * 100) : 0) + '%';
    _el('#tm-ck-bar').classList.toggle('hub-tm-hidden', !t);
    _el('#tm-ck-all').classList.toggle('hub-tm-hidden', !(t > 0 && d === t && !_el('#tm-details-done').checked));
    const n = t ? 0 : _ckImportable().length, imp = _el('#tm-ck-import');
    imp.classList.toggle('hub-tm-hidden', !n);
    imp.textContent = 'Import ' + n + ' bullet' + (n > 1 ? 's' : '') + ' from description';
  }
  // Add several items at once (paste / import); returns the id of the last one added
  function _ckAddMany(texts, at) {
    const room = CK_MAX - _ckDraft.length;
    if (room <= 0) { _toast('A checklist can have up to ' + CK_MAX + ' items.'); return ''; }
    const items = texts.map(function (t) { return String(t).replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 200); })
      .filter(Boolean).slice(0, room).map(_ckNewItem);
    if (!items.length) return '';
    _ckDraft.splice.apply(_ckDraft, [at === undefined ? _ckDraft.length : at, 0].concat(items));
    return items[items.length - 1].id;
  }
  function _ckFlushNew() {
    const inp = _el('#tm-ck-new');
    if (inp && inp.value.trim()) { _ckAddMany([inp.value]); inp.value = ''; }
  }
  // Called by Save: writes the draft back and remembers which Habitica items must be deleted
  function _ckCommit(b) {
    _ckFlushNew();
    const before = _ck(b), final = _normCk(_ckDraft), keep = {}, dels = _ckDelList(b).slice();
    final.forEach(function (i) { if (i.hid) keep[i.hid] = 1; });
    before.forEach(function (i) { if (i.hid && !keep[i.hid] && dels.indexOf(i.hid) < 0) dels.push(i.hid); });
    b.checklist = final;
    b.ckDel = dels.slice(0, CK_MAX);
  }

  /* ── Focus mode: tick items for the current / next block ── */
  function _renderFocusCk(b) {
    const ul = _el('#hub-tm-focus-ck');
    if (!ul) return;
    const list = b ? _ck(b) : [];
    const sig = (b ? b.id : '') + '|' + list.map(function (i) { return i.id + (i.done ? '1' : '0') + i.text; }).join('|');
    if (sig === _fckSig) return;                                     // don't rebuild (and steal focus) every 5 s
    _fckSig = sig;
    ul.classList.toggle('hub-tm-hidden', !list.length);
    ul.innerHTML = list.map(function (i) {
      return '<li class="' + (i.done ? 'is-done' : '') + '"><label class="hub-tm-focus-ck-row"><span class="hub-tm-ck-box"><input type="checkbox" data-fck="' + _esc(i.id) + '" data-block="' + _esc(b.id) + '"' + (i.done ? ' checked' : '') + '><span></span></span><span class="hub-tm-ck-label">' + _esc(i.text) + '</span></label></li>';
    }).join('');
  }
  // When the last item is ticked, offer to complete the block
  function _ckNudge(b) {
    const st = _ckStats(b);
    if (st.total && st.done === st.total && !b.done) {
      _toast('Checklist complete — mark the block done?', { action: 'Complete', onAction: function () { _habToggleDone(b.id); } });
    }
  }

  function _bindChecklist() {
    const ul = _el('#tm-ck-list'), add = _el('#tm-ck-new');
    const idx = function (id) { return _ckDraft.findIndex(function (i) { return i.id === id; }); };
    const rowId = function (el) { const li = el.closest('.hub-tm-ck-item'); return li ? li.getAttribute('data-ck') : ''; };

    ul.addEventListener('change', function (e) {
      if (!e.target.matches('input[type="checkbox"]')) return;
      const i = idx(rowId(e.target));
      if (i < 0) return;
      _ckDraft[i].done = e.target.checked;
      e.target.closest('.hub-tm-ck-item').classList.toggle('is-done', e.target.checked);
      _ckMeta();
    });
    ul.addEventListener('input', function (e) {
      if (!e.target.classList.contains('hub-tm-ck-text')) return;
      const i = idx(rowId(e.target));
      if (i >= 0) _ckDraft[i].text = e.target.value.slice(0, 200);
    });
    ul.addEventListener('click', function (e) {
      const d = e.target.closest('.hub-tm-ck-del');
      if (!d) return;
      const i = idx(rowId(d));
      if (i < 0) return;
      _ckDraft.splice(i, 1);
      _ckRender();
      add.focus();
    });
    ul.addEventListener('keydown', function (e) {
      const t = e.target;
      if (!t.classList.contains('hub-tm-ck-text')) return;
      const i = idx(rowId(t));
      if (i < 0) return;
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (_ckDraft.length >= CK_MAX) { _toast('A checklist can have up to ' + CK_MAX + ' items.'); return; }
        const n = _ckNewItem('');
        _ckDraft.splice(i + 1, 0, n);
        _ckRender(n.id);
      } else if (e.key === 'Backspace' && !t.value) {
        e.preventDefault();
        _ckDraft.splice(i, 1);
        _ckRender(_ckDraft[Math.max(0, i - 1)] ? _ckDraft[Math.max(0, i - 1)].id : '');
        if (!_ckDraft.length) add.focus();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= _ckDraft.length) return;
        const it = _ckDraft.splice(i, 1)[0];
        _ckDraft.splice(j, 0, it);
        _ckRender(it.id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const nb = _ckDraft[i + (e.key === 'ArrowUp' ? -1 : 1)];
        if (nb) { e.preventDefault(); _ckRender(nb.id); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); add.focus(); }
      }
    });
    // Paste a list (one item per line) into any item or the "new item" field
    const onPaste = function (e, at) {
      const txt = (e.clipboardData || window.clipboardData).getData('text');
      if (!/\r?\n/.test(txt.trim())) return;
      e.preventDefault();
      const last = _ckAddMany(txt.split(/\r?\n/), at);
      _ckRender(last);
    };
    ul.addEventListener('paste', function (e) {
      if (!e.target.classList.contains('hub-tm-ck-text')) return;
      const i = idx(rowId(e.target));
      if (i < 0) return;
      const empty = !e.target.value.trim();
      if (empty) _ckDraft.splice(i, 1);
      onPaste(e, empty ? i : i + 1);
    });
    add.addEventListener('paste', function (e) { onPaste(e); });
    add.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        const v = add.value;
        add.value = '';
        const id = _ckAddMany([v]);
        if (id) { _ckRender(); add.focus(); }
      } else if (e.key === 'ArrowUp' && _ckDraft.length) { e.preventDefault(); _ckRender(_ckDraft[_ckDraft.length - 1].id); }
      else if (e.key === 'Backspace' && !add.value && _ckDraft.length) { e.preventDefault(); _ckRender(_ckDraft[_ckDraft.length - 1].id); }
    });
    // Drag to reorder (the grip arms dragging so text selection in the field still works)
    ul.addEventListener('pointerdown', function (e) { const g = e.target.closest('.hub-tm-ck-grip'); if (g) g.closest('.hub-tm-ck-item').draggable = true; });
    ul.addEventListener('dragstart', function (e) {
      const li = e.target.closest('.hub-tm-ck-item');
      if (!li) return;
      _ckDragId = li.getAttribute('data-ck');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _ckDragId); } catch (_) {}
      li.classList.add('is-dragging');
    });
    ul.addEventListener('dragover', function (e) {
      const li = e.target.closest('.hub-tm-ck-item');
      if (!li || !_ckDragId) return;
      e.preventDefault();
      _all('.hub-tm-ck-item.is-over').forEach(function (n) { if (n !== li) n.classList.remove('is-over'); });
      li.classList.add('is-over');
    });
    ul.addEventListener('drop', function (e) {
      const li = e.target.closest('.hub-tm-ck-item');
      if (!li || !_ckDragId) return;
      e.preventDefault();
      const from = idx(_ckDragId), to = idx(li.getAttribute('data-ck'));
      if (from > -1 && to > -1 && from !== to) { const it = _ckDraft.splice(from, 1)[0]; _ckDraft.splice(to, 0, it); }
      _ckDragId = '';
      _ckRender();
    });
    ul.addEventListener('dragend', function () {
      _ckDragId = '';
      _all('.hub-tm-ck-item').forEach(function (n) { n.draggable = false; n.classList.remove('is-dragging', 'is-over'); });
    });

    _el('#tm-ck-import').addEventListener('click', function () { _ckAddMany(_ckImportable()); _ckRender(); });
    _el('#tm-ck-all').addEventListener('click', function () { _el('#tm-details-done').checked = true; _ckMeta(); });
    _el('#tm-details-done').addEventListener('change', _ckMeta);
    _el('#block-desc-editor').addEventListener('input', _ckMeta);

    _el('#hub-tm-focus-ck').addEventListener('change', function (e) {
      const cb = e.target.closest('[data-fck]');
      if (!cb) return;
      const b = _blockById(cb.getAttribute('data-block'));
      const it = b && _ck(b).find(function (i) { return i.id === cb.getAttribute('data-fck'); });
      if (!it) return;
      it.done = cb.checked;
      _scheduleSave();
      _fckSig = '';
      _renderFocusCk(b);
      _renderGrid({ animate: false, scroll: false });
      _ckNudge(b);
    });
  }

  /* ============================================================
     HABITICA  ·  block → To-Do (deadline = end of block)
     Completing a block scores its To-Do (gold / XP); the planner then
     shows what is done, what is still due and what slipped past its
     deadline.  Blocks only ever become To-Dos. The ONE exception is the opt-in
     "Streak Daily" (off by default): a single Daily the planner ticks when a day
     reaches the streak threshold, so Habitica itself keeps the streak.
     Credentials live in this browser only (never sent to HubDB).
     ============================================================ */
  const HAB_BASE = 'https://habitica.com/api/v3';
  const HAB_KEY  = 'hub_tm_habitica';
  const HAB_LOG_TTL = 60 * 60 * 1000;                                       // activity entries live for 1 hour (when auto-clear is on)
  const HAB_PRIO = [['0.1', 'Trivial'], ['1', 'Easy'], ['1.5', 'Medium'], ['2', 'Hard']];
  const _hab = {
    cfg: { userId: '', apiKey: '', syncMode: 'auto', scope: 'titled', since: '', prio: {}, logAutoClear: true,
           sdOn: false, sdPrio: '1', sdDays: '1111111', sdRest: true, sdId: '', sdUp: '', sdFp: '' },      // sd* = Streak Daily
    user: null, q: Promise.resolve(), busy: false, again: false, force: false,
    sd: { streak: null, completed: null, note: '', at: 0 },
    lastPull: 0, lastSync: 0, view: '', log: [], known: {}, gone: {}, delQ: [], sweep: false, timer: null, syncT: null, err: ''
  };
  (function () {
    try {
      const r = JSON.parse(_lsGet(HAB_KEY) || 'null');
      if (r && typeof r === 'object') Object.assign(_hab.cfg, r);
      if (!_hab.cfg.prio || typeof _hab.cfg.prio !== 'object') _hab.cfg.prio = {};
      if (r && r.enabled === false) _hab.cfg.syncMode = 'manual';          // earlier build: sync switched off → keep it from pushing on its own
      if (_hab.cfg.syncMode !== 'manual') _hab.cfg.syncMode = 'auto';
      if (_hab.cfg.scope !== 'all') _hab.cfg.scope = 'titled';
      _hab.cfg.logAutoClear = _hab.cfg.logAutoClear !== false;               // on unless you switched it off
      _hab.cfg.sdOn = _hab.cfg.sdOn === true;                                  // Streak Daily is opt-in
      _hab.cfg.sdRest = _hab.cfg.sdRest !== false;
      if (typeof _hab.cfg.sdDays !== 'string' || !/^[01]{7}$/.test(_hab.cfg.sdDays) || _hab.cfg.sdDays.indexOf('1') < 0) _hab.cfg.sdDays = '1111111';
      _hab.cfg.sdPrio = HAB_PRIO.some(function (o) { return o[0] === String(_hab.cfg.sdPrio); }) ? String(_hab.cfg.sdPrio) : '1';
      ['sdId', 'sdUp', 'sdFp'].forEach(function (k) { _hab.cfg[k] = typeof _hab.cfg[k] === 'string' ? _hab.cfg[k].slice(0, 64) : ''; });
    } catch (_) {}
  })();

  function _habSave() { _lsSet(HAB_KEY, JSON.stringify(_hab.cfg)); }

  /* Deletions owed to Habitica. Kept in localStorage: before, they lived in memory only, so a reload,
     a failed request or a manual-sync session silently forgot them and the To-Do stayed in Habitica forever. */
  function _habSaveDel() { _lsSet(HAB_KEY + '_del', JSON.stringify(_hab.delQ)); }
  function _habQueueDel(id) {
    id = String(id || '');
    if (!id || _hab.delQ.indexOf(id) >= 0) return;
    _hab.delQ.push(id);
    _hab.gone[id] = 1;
    _habSaveDel();
  }
  (function () {
    try {
      const q = JSON.parse(_lsGet(HAB_KEY + '_del') || '[]');
      if (Array.isArray(q)) q.forEach(function (id) { id = String(id || ''); if (id && _hab.delQ.indexOf(id) < 0) { _hab.delQ.push(id); _hab.gone[id] = 1; } });
    } catch (_) {}
  })();
  function _habOn() { return !!(_hab.cfg.userId && _hab.cfg.apiKey); }
  function _habSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function _habHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  /* ── HTTP: one request at a time, paced, honours 429 ── */
  function _habReq(method, path, body) {
    const run = async function (attempt) {
      const c = _hab.cfg;
      const r = await fetch(HAB_BASE + path, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-user': c.userId,
          'x-api-key': c.apiKey,
          'x-client': c.userId + '-HubOS-TimeManagement'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (r.status === 429 && attempt < 2) {
        await _habSleep((parseFloat(r.headers.get('retry-after')) || 30) * 1000);
        return run(attempt + 1);
      }
      let j = {};
      try { j = await r.json(); } catch (_) {}
      if (!r.ok || j.success === false) {
        const e = new Error(j.message || ('Habitica error ' + r.status));
        e.status = r.status;
        throw e;
      }
      return j.data;
    };
    const p = _hab.q.then(function () { return run(0); });
    _hab.q = p.then(function () { return _habSleep(250); }, function () { return _habSleep(250); });
    return p;
  }

  /* ── Block → To-Do mapping ── */
  function _habStartMs(b) { const p = b.date.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 0, _toMins(b.startTime)).getTime(); }
  function _habEndMs(b)   { const p = b.date.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 0, _toMins(b.endTime)).getTime(); }
  function _habDeadline(b) {
    const p = b.date.split('-').map(Number), m = Math.min(_toMins(b.endTime), DAY_MINS - 1);
    return new Date(p[0], p[1] - 1, p[2], Math.floor(m / 60), m % 60).toISOString();
  }
  function _habAlias(b) { return ('hubtm-' + b.id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60); }
  function _habIsOverdue(b) {
    return _habOn() && !b.done && !!_hab.cfg.since && b.date >= _hab.cfg.since && _habEndMs(b) < Date.now();
  }
  function _habTitled(b) {
    return (!!b.title && b.title !== _tagOrFallback(b.tagId).label) || !!_plainText(b.subtitle);
  }
  function _habParts(b) {
    const tpl = document.createElement('template');
    tpl.innerHTML = _sanitizeHtml(b.subtitle || '').replace(/<li[^>]*>/gi, '\n• ').replace(/<br\s*\/?>|<\/(div|p|li|ul|ol)>/gi, '\n');
    const note = tpl.content.textContent.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
    return { note: note, items: _ck(b).slice(0, CK_MAX).map(function (i) { return { text: i.text, completed: !!i.done }; }) };
  }
  function _habPayload(b) {
    const tag = _tagOrFallback(b.tagId), pr = parseFloat(_hab.cfg.prio[b.tagId]);
    const parts = _habParts(b);
    return {
      parts: parts,
      text: (b.title || tag.label).slice(0, 200),
      notes: (b.startTime + ' – ' + b.endTime + ' · ' + tag.label + (parts.note ? '\n' + parts.note : '')).slice(0, 5000),
      date: _habDeadline(b),
      priority: [0.1, 1, 1.5, 2].indexOf(pr) >= 0 ? pr : 1
    };
  }
  function _habFp(p) { return _habHash([p.text, p.notes, p.date, p.priority].join('\u0001')); }

  /* ── API calls ── */
  async function _habFetchUser() {
    const d = await _habReq('GET', '/user?userFields=stats,profile.name,preferences.dayStart');
    const s = (d && d.stats) || {};
    _hab.user = { gp: +s.gp || 0, hp: +s.hp || 0, maxHp: +s.maxHealth || 50, exp: +s.exp || 0, toNext: +s.toNextLevel || 0, lvl: +s.lvl || 1, name: (d && d.profile && d.profile.name) || '', dayStart: _clamp(Math.round(+(d && d.preferences && d.preferences.dayStart) || 0), 0, 23) };
    return _hab.user;
  }
  async function _habCreate(b) {
    const p = _habPayload(b);
    const body = { type: 'todo', text: p.text, notes: p.notes, date: p.date, priority: p.priority, alias: _habAlias(b), checklist: p.parts.items };
    let t, adopted = false;
    try { t = await _habReq('POST', '/tasks/user', body); }
    catch (e) {
      // Alias already exists (e.g. local data was reset) → adopt the existing To-Do instead of duplicating it
      if ((e.status === 409 || e.status === 400) && /alias/i.test(e.message)) { t = await _habReq('GET', '/tasks/' + encodeURIComponent(_habAlias(b))); adopted = true; }
      else throw e;
    }
    b.habiticaId = String(t.id || t._id);
    b.habFp = _habFp(p);
    b.habDone = !!t.completed;
    _hab.known[b.habiticaId] = !!b.habDone;     // from this moment a delete of the block must delete the To-Do (known used to be refreshed only at the NEXT sync)
    if (b.habDone) b.done = true;
    // Remember the Habitica id of every checklist item (same order when we created it; by text when adopting)
    const rc = Array.isArray(t.checklist) ? t.checklist : [], used = {};
    _ck(b).forEach(function (it, i) {
      const r = adopted ? rc.find(function (x) { return !used[x.id] && x.text === it.text; }) : rc[i];
      if (r) { used[r.id] = 1; it.hid = String(r.id); it.hdone = !!r.completed; it.hfp = _habHash(it.text); }
    });
  }
  async function _habUpdate(b) {
    const p = _habPayload(b);
    await _habReq('PUT', '/tasks/' + b.habiticaId, { text: p.text, notes: p.notes, date: p.date, priority: p.priority });
    b.habFp = _habFp(p);
  }
  async function _habScore(b) {
    const up = !!b.done;
    const before = _hab.user ? _hab.user.gp : null;
    const d = await _habReq('POST', '/tasks/' + b.habiticaId + '/score/' + (up ? 'up' : 'down'));
    b.habDone = up;
    if (d && typeof d.gp === 'number') {
      _hab.user = Object.assign(_hab.user || {}, { gp: d.gp, hp: d.hp, exp: d.exp, lvl: d.lvl });
      if (before !== null) {
        const delta = d.gp - before;
        b.gp = up ? Math.max(0, Math.round(delta * 100) / 100) : 0;           // remembered per block → shown per day
        return delta;
      }
    }
    if (!up) b.gp = 0;
    return 0;
  }
  // Mirror what happened inside the Habitica app (checked off / unchecked there)
  // Two-way merge of one block's checklist with the To-Do's checklist in Habitica
  function _habMergeCk(b, remote) {
    let changed = false;
    const byId = {}, del = {};
    remote.forEach(function (r) { byId[r.id] = r; });
    _ckDelList(b).forEach(function (h) { del[h] = 1; });
    b.checklist = _ck(b).filter(function (it) {
      if (!it.hid) return true;
      const r = byId[it.hid];
      const textClean = it.hfp === _habHash(it.text), doneClean = !!it.done === !!it.hdone;
      if (!r) { if (textClean && doneClean) { changed = true; return false; } return true; }   // removed in the app and nothing pending here → drop it
      if (doneClean && !!r.completed !== !!it.hdone) { it.done = it.hdone = !!r.completed; changed = true; }
      const rt = String(r.text || '').slice(0, 200);
      if (textClean && rt && rt !== it.text) { it.text = rt; it.hfp = _habHash(rt); changed = true; }
      return true;
    });
    const known = {};
    b.checklist.forEach(function (it) { if (it.hid) known[it.hid] = 1; });
    remote.forEach(function (r) {                                         // added in the app → add here
      const rt = String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!rt || known[r.id] || del[r.id] || b.checklist.length >= CK_MAX) return;
      b.checklist.push({ id: _ckId(), text: rt, done: !!r.completed, hid: String(r.id), hdone: !!r.completed, hfp: _habHash(rt) });
      changed = true;
    });
    return changed;
  }
  // Push local checklist edits: deletions, new items, renamed items, ticks
  async function _habPushCk(b) {
    let ch = false;
    const base = '/tasks/' + b.habiticaId + '/checklist';
    const dels = _ckDelList(b);
    while (dels.length) {
      try { await _habReq('DELETE', base + '/' + dels[0]); } catch (e) { if (e.status !== 404) throw e; }
      dels.shift(); ch = true;
    }
    const list = _ck(b);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it.hid) {
        const d = await _habReq('POST', base, { text: it.text, completed: !!it.done });
        const last = d && Array.isArray(d.checklist) ? d.checklist[d.checklist.length - 1] : null;
        if (last) { it.hid = String(last.id); it.hdone = !!last.completed; it.hfp = _habHash(it.text); ch = true; }
        continue;
      }
      try {
        if (it.hfp !== _habHash(it.text)) { await _habReq('PUT', base + '/' + it.hid, { text: it.text }); it.hfp = _habHash(it.text); ch = true; }
        if (!!it.done !== !!it.hdone) {
          const d = await _habReq('POST', base + '/' + it.hid + '/score');        // toggles; read the result back
          const r = d && Array.isArray(d.checklist) ? d.checklist.find(function (x) { return x.id === it.hid; }) : null;
          it.hdone = r ? !!r.completed : !!it.done;
          ch = true;
        }
      } catch (e) {
        if (e.status === 404) { it.hid = ''; it.hdone = false; it.hfp = ''; ch = true; }    // gone in Habitica → re-create on the next pass
        else throw e;
      }
    }
    return ch;
  }
  /* ============================================================
     STREAK DAILY  ·  opt-in. Habitica keeps the streak; the planner ticks it.
     - One Daily (alias hubtmstreak). Ticked when the day reaches STREAK_MIN,
       un-ticked only if WE ticked it earlier that day and the day dropped again.
     - "Today" follows Habitica's Custom Day Start, not the calendar midnight.
     - Empty days (inside the planner's rest tolerance) are ticked for you unless switched off.
     - Deleted on Habitica's side → the feature switches itself off (never re-created).
     - Never runs until this account's plans are really loaded (_dataTrusted).
     ============================================================ */
  const SD_ALIAS = 'hubtmstreak';
  const SD_KEYS = ['m', 't', 'w', 'th', 'f', 's', 'su'];                   // Monday … Sunday
  const SD_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function _habDay() { const h = (_hab.user && _hab.user.dayStart) || 0; return _dateToStr(new Date(Date.now() - h * 3600000)); }
  function _sdDue(ds) { return _hab.cfg.sdDays.charAt((_parseDate(ds).getDay() + 6) % 7) === '1'; }
  function _sdFp() { return _hab.cfg.sdPrio + '|' + _hab.cfg.sdDays; }
  function _sdBody(create) {
    const need = Math.round(STREAK_MIN * 100), rep = {};
    SD_KEYS.forEach(function (k, i) { rep[k] = _hab.cfg.sdDays.charAt(i) === '1'; });
    const b = {
      text: 'Planner · reach ' + need + '% of the day',
      notes: 'Made by Time Management. Ticked automatically once you finish ' + need + '% of the time you planned today (and un-ticked if that drops again). Missing it costs HP like any Daily. Switch it off in the planner’s Habitica Link — that deletes it.',
      priority: +_hab.cfg.sdPrio, frequency: 'weekly', repeat: rep, everyX: 1
    };
    if (create) { b.type = 'daily'; b.alias = SD_ALIAS; b.startDate = _parseDate(_habDay()).toISOString(); }
    return b;
  }
  /** What the Daily should look like right now. */
  function _sdWant() {
    const day = _habDay(), sk = _streakInfo(day), st = sk.state[day];
    return { day: day, sk: sk, st: st, want: st === 'hit' || (_hab.cfg.sdRest && (st === 'rest' || st === undefined) && sk.cur > 0) };
  }
  async function _habScoreTask(id, up) {
    const before = _hab.user ? _hab.user.gp : null;
    const d = await _habReq('POST', '/tasks/' + encodeURIComponent(id) + '/score/' + (up ? 'up' : 'down'));
    if (d && typeof d.gp === 'number') {
      _hab.user = Object.assign(_hab.user || {}, { gp: d.gp, hp: d.hp, exp: d.exp, lvl: d.lvl });
      if (before !== null) return d.gp - before;
    }
    return 0;
  }
  async function _habStreakSync() {
    const c = _hab.cfg, sd = _hab.sd, out = { msg: '' };
    if (!c.sdOn) return out;
    if (!_dataTrusted) { sd.note = 'Waiting for your plans to finish loading…'; return out; }
    const w = _sdWant(), day = w.day;
    if (!c.sdId && !w.sk.state[day]) { sd.note = 'Starts with your first planned day.'; return out; }   // never hand a brand-new user a missed Daily
    let t = null, made = false;
    if (c.sdId) {
      try { t = await _habReq('GET', '/tasks/' + encodeURIComponent(c.sdId)); }
      catch (e) { if (e.status !== 404) throw e; }
      if (!t) {                                                               // deleted in Habitica → respect it, do not re-create
        c.sdOn = false; c.sdId = ''; c.sdUp = ''; c.sdFp = ''; _habSave();
        sd.streak = null; sd.completed = null; sd.note = '';
        out.msg = 'Streak Daily was deleted in Habitica — switched off';
        return out;
      }
    } else {
      try { t = await _habReq('POST', '/tasks/user', _sdBody(true)); made = true; }
      catch (e) {
        if ((e.status === 409 || e.status === 400) && /alias/i.test(e.message)) t = await _habReq('GET', '/tasks/' + SD_ALIAS);   // adopt the one we made before
        else throw e;
      }
      c.sdId = String(t.id || t._id); c.sdFp = made ? _sdFp() : ''; _habSave();
      if (!c.sdOn) { _habQueueDel(c.sdId); c.sdId = ''; c.sdFp = ''; _habSave(); _hab.again = true; return out; }   // switched off while it was being created
      if (made) out.msg = 'Streak Daily created';
    }
    if (c.sdFp !== _sdFp()) { await _habReq('PUT', '/tasks/' + encodeURIComponent(c.sdId), _sdBody(false)); c.sdFp = _sdFp(); _habSave(); }
    sd.streak = +t.streak || 0; sd.completed = !!t.completed; sd.note = '';
    if (!_sdDue(day)) { sd.note = 'Not due today — your schedule skips this weekday.'; }
    else if (w.want && !t.completed) {
      const g = await _habScoreTask(c.sdId, true);
      c.sdUp = day; _habSave(); sd.completed = true; sd.streak += 1;
      out.msg = (out.msg ? out.msg + ' · ' : '') + 'Streak Daily ticked (' + (g >= 0 ? '+' : '') + g.toFixed(1) + ' gold)';
    } else if (!w.want && t.completed && c.sdUp === day) {                    // only undo what WE did today; a tick you made in Habitica stays
      await _habScoreTask(c.sdId, false);
      c.sdUp = ''; _habSave(); sd.completed = false; sd.streak = Math.max(0, sd.streak - 1);
      out.msg = (out.msg ? out.msg + ' · ' : '') + 'Streak Daily un-ticked';
    }
    sd.at = Date.now();
    return out;
  }
  function _sdToggle() {
    const c = _hab.cfg, need = Math.round(STREAK_MIN * 100);
    if (!c.sdOn) {
      _confirm('Habitica will get one Daily, “Planner · reach ' + need + '% of the day”. The planner ticks it for you, but any day that ends below ' + need + '% counts as missed: you lose HP and its streak goes back to zero, like any Daily. During a boss quest the damage can be doubled. You can switch it off any time — that deletes the Daily.', function () {
        c.sdOn = true; _habSave(); _habAfterCfg();
        if (c.syncMode === 'manual') _toast('Streak Daily on — press Sync now to create it'); else _habQueueSync(0);
      }, { title: 'Turn on the Streak Daily?', label: 'Turn on' });
      return;
    }
    _confirm('This deletes the Daily from Habitica, so its streak there is lost. Your planner streak is not affected.', function () {
      _habQueueDel(c.sdId || SD_ALIAS);                                        // no saved id (other browser / cleared storage)? Habitica also accepts the alias
      c.sdOn = false; c.sdId = ''; c.sdUp = ''; c.sdFp = '';
      _hab.sd = { streak: null, completed: null, note: '', at: 0 };
      _habSave(); _habAfterCfg();
      if (_hab.delQ.length) _habReconcile(false);                              // right away, even in manual mode: a Daily left behind keeps costing HP
      _toast('Streak Daily removed');
    }, { title: 'Turn off the Streak Daily?', label: 'Turn off' });
  }
  function _sdHtml() {
    const c = _hab.cfg, sd = _hab.sd, need = Math.round(STREAK_MIN * 100), manual = c.syncMode === 'manual';
    const head = '<div class="hub-tm-hab-cardhead"><h4>Streak Daily</h4><button type="button" class="hub-tm-hab-sdswitch" data-hab-sd="toggle" role="switch" aria-checked="' + c.sdOn + '">' + (c.sdOn ? 'On' : 'Off') + '</button></div>';
    const lead = '<p class="hub-tm-hab-sd-lead">One Daily in Habitica that the planner ticks for you once a day reaches <b>' + need + '%</b> of its planned time. Habitica then keeps the streak — with its rewards, and its penalties.</p>';
    if (!c.sdOn) {
      return '<section class="hub-tm-hab-card hub-tm-hab-sd">' + head + lead +
        '<p class="hub-tm-hab-sd-warn">Off by default: a Daily that is not ticked by the end of the day costs HP and resets its streak.</p></section>';
    }
    const day = _habDay(), due = _sdDue(day);
    const days = SD_DAYS.map(function (n, i) {
      return '<button type="button" data-hab-sdday="' + i + '" aria-pressed="' + (c.sdDays.charAt(i) === '1') + '" aria-label="' + n + '" title="' + n + '">' + n.charAt(0) + '</button>';
    }).join('');
    const prio = HAB_PRIO.map(function (o) {
      return '<button type="button" data-hab-sdprio data-val="' + o[0] + '" aria-pressed="' + (o[0] === String(c.sdPrio)) + '">' + o[1] + '</button>';
    }).join('');
    const status = !c.sdId ? 'Will be created on the next sync.'
      : 'Habitica streak <b>' + (sd.streak == null ? '—' : sd.streak) + '</b> · today: ' + (!due ? 'not due' : sd.completed ? '<b class="hub-tm-hab-sd-ok">ticked</b>' : 'waiting for ' + need + '%');
    return '<section class="hub-tm-hab-card hub-tm-hab-sd is-on">' + head + lead +
      '<div class="hub-tm-hab-sd-status"><span class="hub-tm-hab-led' + (sd.completed && due ? '' : ' is-warn') + '"></span><span>' + status + '</span></div>' +
      (sd.note ? '<p class="hub-tm-hab-sd-note">' + _esc(sd.note) + '</p>' : '') +
      '<div class="hub-tm-hab-sd-row"><span>Difficulty<small>Bigger = more damage when missed</small></span><span class="hub-tm-hab-rank-opts" role="radiogroup" aria-label="Streak Daily difficulty">' + prio + '</span></div>' +
      '<div class="hub-tm-hab-sd-row"><span>Due on<small>Other days it stays grey and never hurts</small></span><span class="hub-tm-hab-days" role="group" aria-label="Weekdays">' + days + '</span></div>' +
      '<button type="button" class="hub-tm-hab-opt" data-hab-sd="rest" aria-pressed="' + c.sdRest + '"><strong>Empty days keep the streak</strong><small>A day with no plans is ticked for you while your planner streak is alive (up to ' + STREAK_REST_GAP + ' in a row), so resting never costs HP.</small></button>' +
      (manual ? '<p class="hub-tm-hab-sd-warn">Manual sync is on: the Daily is only ticked when you press <b>Sync now</b>. Do it before your Habitica day ends.</p>' : '') +
      '<p class="hub-tm-hab-sd-warn">A day that ends below ' + need + '% costs HP and resets the streak. Once Habitica has started a new day, the planner cannot claim the old one back.</p>' +
      '</section>';
  }

  async function _habPull() {
    await _habFetchUser();
    const open = await _habReq('GET', '/tasks/user?type=todos');
    const dn = await _habReq('GET', '/tasks/user?type=completedTodos');
    const o = {}, c = {}, rem = {};
    (open || []).forEach(function (t) { o[t.id] = 1; rem[t.id] = Array.isArray(t.checklist) ? t.checklist : []; });
    (dn || []).forEach(function (t) { c[t.id] = 1; });
    // Clean-up of leftovers: open To-Dos this app made (alias hubtm-…) for blocks that no longer exist.
    // Runs once after this fix and on every "Sync now"; never touches your own To-Dos (no hubtm- alias) or completed ones.
    if ((_hab.sweep || !_hab.cfg.swept) && _dataTrusted) {
      const mine = {}, now = Date.now();
      _timeBlocks.forEach(function (b) { mine[_habAlias(b)] = 1; });
      (open || []).forEach(function (t) {
        if (!t || t.completed || typeof t.alias !== 'string' || t.alias.indexOf('hubtm-') !== 0 || mine[t.alias]) return;
        const born = Date.parse(t.createdAt);
        if (born && now - born < 600000) return;                       // very new: another device may not have synced its block yet
        _habQueueDel(t.id || t._id);
      });
      _hab.sweep = false;
      if (!_hab.cfg.swept) { _hab.cfg.swept = true; _habSave(); }
    }
    let changed = false;
    _timeBlocks.forEach(function (b) {
      if (!b.habiticaId) return;
      if (!b.habDone && rem[b.habiticaId] && _habMergeCk(b, rem[b.habiticaId])) changed = true;
      if (!!b.done !== !!b.habDone) return;                               // a pending local change wins
      if (c[b.habiticaId] && !b.done) { b.done = b.habDone = true; changed = true; }
      else if (o[b.habiticaId] && b.done) { b.done = b.habDone = false; b.gp = 0; changed = true; }
    });
    _hab.lastPull = Date.now();
    return changed;
  }

  /* ── Reconcile: create / update / score / delete, then repaint ── */
  function _habSeedKnown() {
    const k = {};
    _timeBlocks.forEach(function (b) { if (b.habiticaId) k[b.habiticaId] = !!b.habDone; });
    _hab.known = k;
  }
  function _habDiff() {
    const cur = {};
    _timeBlocks.forEach(function (b) {
      if (b.habiticaId && _hab.gone[b.habiticaId]) { b.habiticaId = ''; b.habFp = ''; b.habDone = false; }   // restored by Undo after its To-Do was deleted
      if (b.habiticaId) cur[b.habiticaId] = !!b.habDone;
    });
    Object.keys(_hab.known).forEach(function (id) {
      if (id in cur) return;
      if (!_hab.known[id]) _habQueueDel(id);   // completed To-Dos are kept: they are earned history
    });
    _hab.known = cur;
  }
  function _habQueueSync(delay) {
    if (!_habOn() || !_dataReady) return;
    _habDiff();                                   // note a deletion the moment it happens — even in manual mode, or if the tab closes before the timer fires
    if (_hab.cfg.syncMode === 'manual') return;
    if (_hab.syncT) clearTimeout(_hab.syncT);
    _hab.syncT = setTimeout(function () { _hab.syncT = null; if (_hab.cfg.syncMode !== 'manual') _habReconcile(false); }, delay === undefined ? 1500 : delay);
  }
  // pull = also ask Habitica what changed on its side (always true for the Sync now button)
  async function _habReconcile(pull) {
    if (!_habOn() || !_dataReady) return;
    if (_hab.busy) { _hab.again = true; if (pull) _hab.force = true; return; }
    _hab.busy = true;
    _hab.err = '';
    pull = !!(pull || _hab.force);
    _hab.force = false;
    let changed = false, gold = 0, scored = 0, created = 0, updated = 0, removed = 0, sdMsg = '';
    try {
      try { if (pull || !_hab.user || Date.now() - _hab.lastPull > 120000) { if (await _habPull()) changed = true; } }
      catch (e) { if (e.status === 401) throw e; }                          // a failed pull must not stop owed deletions below
      _habDiff();
      while (_hab.delQ.length) {
        const id = _hab.delQ[0];
        try { await _habReq('DELETE', '/tasks/' + id); removed++; }
        catch (e) {
          // keep the id and retry next sync unless Habitica says it is already gone / can never succeed
          if (!(e.status === 404 || (e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429))) throw e;
        }
        _hab.delQ.shift();
        _habSaveDel();
      }
      const today = _todayStr();
      const list = _timeBlocks.slice().sort(function (a, b) { return (a.date + a.startTime) < (b.date + b.startTime) ? -1 : 1; });
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (_timeBlocks.indexOf(b) < 0) continue;                         // removed while syncing
        try {
          if (!b.habiticaId) {
            const want = !!b.done || (b.date >= today && (_hab.cfg.scope === 'all' || _habTitled(b)));
            if (!want) continue;
            await _habCreate(b);
            created++; changed = true;
          } else if (!b.habDone) {
            const p = _habPayload(b);
            if (_habFp(p) !== b.habFp) { await _habUpdate(b); updated++; changed = true; }
          }
          if (b.habiticaId && !b.habDone && await _habPushCk(b)) changed = true;
          if (!!b.done !== !!b.habDone) { gold += await _habScore(b); scored++; changed = true; }
          if (b.habiticaId) _hab.known[b.habiticaId] = !!b.habDone;
          if (_timeBlocks.indexOf(b) < 0) { _habDiff(); _hab.again = true; }   // the block was deleted while its To-Do was being created/updated
        } catch (e) {
          if (e.status === 404 && b.habiticaId) { b.habiticaId = ''; b.habFp = ''; b.habDone = false; changed = true; }
          else throw e;
        }
      }
      try { const sdr = await _habStreakSync(); if (sdr && sdr.msg) sdMsg = sdr.msg; }       // opt-in Streak Daily (no-op when off)
      catch (e) { if (e.status === 401) throw e; _hab.sd.note = 'Streak Daily: ' + (e.message || 'sync failed'); }
    } catch (e) {
      _hab.err = e.status === 401 ? 'Habitica rejected the saved credentials.' : (e.message || 'Sync failed.');
    }
    _hab.busy = false;
    if (!_hab.err) _hab.lastSync = Date.now();
    const parts = [];
    if (created) parts.push('Created ' + created);
    if (updated) parts.push('Updated ' + updated);
    if (scored) parts.push('Scored ' + scored + ' (' + (gold >= 0 ? '+' : '') + gold.toFixed(1) + ' gold)');
    if (removed) parts.push('Removed ' + removed);
    if (sdMsg) parts.push(sdMsg);
    if (_hab.err) parts.push('Error — ' + _hab.err);
    if (parts.length) { _hab.log.unshift({ t: Date.now(), text: parts.join(' · ') }); _hab.log.length = Math.min(_hab.log.length, 6); }
    if (changed) {
      _saveAll();
      if (_sectionEl && _sectionEl.isConnected) { _renderGrid({ animate: false, scroll: false }); _tlRefresh(); }   // gold just landed: show it in the Timeline too
    }
    _habChip();
    if (_habHubOpen()) _habRenderHub();
    if (_hab.err) _toast('Habitica: ' + _hab.err);
    else if (scored) _toast((gold >= 0 ? '+' : '') + gold.toFixed(1) + ' gold');
    if (_hab.again) { _hab.again = false; if (_hab.delQ.length) _habReconcile(false); else _habQueueSync(); }   // manual mode: owed deletions still go out
  }

  /* ── Completing a block ── */
  function _habToggleDone(id) {
    const b = _blockById(id);
    if (!b) return;
    const apply = function () {
      b.done = !b.done;
      if (!b.done) b.gp = 0;
      _scheduleSave();
      _habQueueSync(300);
      _renderGrid({ animate: false, scroll: false });
      _tlRefresh();
      _toast(b.done ? (_habOn() ? (_hab.cfg.syncMode === 'manual' ? 'Completed — press Sync now to send it to Habitica' : 'Completed — syncing to Habitica…') : 'Marked complete') : 'Marked not complete');
    };
    if (!b.done && _habOn() && _habStartMs(b) > Date.now()) { _toast('This block hasn’t started yet — do the work first, then check it off.'); return; }
    if (b.done && b.habDone) { _confirm('Un-completing takes back the gold this To-Do earned.', apply, { title: 'Undo completion?', label: 'Undo' }); return; }
    apply();
  }

  /* ── Chip + overdue marks ── */
  function _habChip() {
    _habBtn();
    const chip = _el('#hub-tm-hab-chip');
    if (!chip) return;
    if (!_habOn()) { chip.classList.add('hub-tm-hidden'); return; }
    const today = _todayStr();
    let tot = 0, dn = 0, od = 0;
    _timeBlocks.forEach(function (b) {
      if (b.date === today) { tot++; if (b.done) dn++; }
      if (_habIsOverdue(b)) od++;
    });
    chip.classList.remove('hub-tm-hidden');
    chip.classList.toggle('is-alert', od > 0);
    const pct = tot ? Math.round(dn / tot * 100) : 0;
    chip.innerHTML =
      (_hab.user ? '<span>Gold <b>' + _hab.user.gp.toFixed(1) + '</b></span><span class="hub-tm-pulse-sep"></span>' : '') +
      '<span>Today <b>' + dn + '/' + tot + '</b></span>' +
      '<span class="hub-tm-pulse-bar" role="img" aria-label="' + pct + '% of today complete"><i style="width:' + pct + '%"></i></span>' +
      (od ? '<span class="hub-tm-pulse-sep"></span><span class="hub-tm-pulse-late"><b>' + od + '</b> overdue</span>' : '');
  }
  function _habTick() {
    _habChip();
    _all('#hub-tm-main-col .hub-tm-block').forEach(function (el) {
      const b = _blockById(el.getAttribute('data-block-id'));
      if (b) el.classList.toggle('is-overdue', _habIsOverdue(b));
    });
    if (_habOn() && !document.hidden) _habQueueSync(0);                  // pulls at most every ~2 min
  }
  function _habStop() { if (_hab.timer) { clearInterval(_hab.timer); _hab.timer = null; } }

  /* ============================================================
     HABITICA HUB  ·  its own space inside the planner
     locked  →  connect (enter key)  →  hub (character, sync mode, rules)
     ============================================================ */
  const HAB_SVG = function (inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>'; };
  const HAB_ICON_SHIELD = HAB_SVG('<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><polyline points="8.5,12 11,14.5 15.5,9.5"/>');
  const HAB_ICON_LOCK   = HAB_SVG('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
  const HAB_PERKS = [
    ['Blocks become quests', 'Every titled block turns into a Habitica To-Do that is due the moment the block ends.'],
    ['Gold for real work', 'Check a block off to score it. You can’t claim a block before it has started.'],
    ['Deadlines that bite', 'Anything that slips past its deadline lights up red so nothing is quietly dropped.'],
    ['Two-way sync', 'Tick a To-Do in the Habitica app and the planner follows. Auto or manual — your call.']
  ];

  function _habHubOpen() { const m = _el('#hub-tm-hab-modal'); return !!m && m.classList.contains('is-open'); }
  function _habAgo(ts) {
    if (!ts) return 'never';
    const m = Math.floor((Date.now() - ts) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
  }
  /** Drop activity entries older than 1 hour. Returns true if anything was removed. */
  function _habPruneLog() {
    if (!_hab.cfg.logAutoClear) return false;
    const cut = Date.now() - HAB_LOG_TTL, n = _hab.log.length;
    _hab.log = _hab.log.filter(function (e) { return e.t > cut; });
    return _hab.log.length !== n;
  }
  function _habToNext(l) { return Math.round((0.25 * l * l + 10 * l + 139.75) / 10) * 10; }

  // Changes that exist locally but have not reached Habitica yet
  function _habPending() {
    if (!_habOn()) return 0;
    const today = _todayStr(), cur = {};
    let n = _hab.delQ.length;
    _timeBlocks.forEach(function (b) {
      if (b.habiticaId) cur[b.habiticaId] = 1;
      if (!b.habiticaId) { if (b.done || (b.date >= today && (_hab.cfg.scope === 'all' || _habTitled(b)))) n++; return; }
      if (!b.habDone && _habFp(_habPayload(b)) !== b.habFp) n++;
      if (!b.habDone) {
        n += _ckDelList(b).length;
        _ck(b).forEach(function (it) { if (!it.hid || it.hfp !== _habHash(it.text) || !!it.done !== !!it.hdone) n++; });
      }
      if (!!b.done !== !!b.habDone) n++;
    });
    Object.keys(_hab.known).forEach(function (id) { if (!(id in cur) && !_hab.known[id]) n++; });
    if (_hab.cfg.sdOn && !_hab.cfg.sdId) n++;
    else if (_hab.cfg.sdOn && _hab.sd.completed !== null) { const w = _sdWant(); if (_sdDue(w.day) && w.want !== !!_hab.sd.completed && (w.want || _hab.cfg.sdUp === w.day)) n++; }
    return n;
  }

  // Header button: locked / auto / manual / error, with a "waiting" badge in manual mode
  function _habBtn() {
    const b = _el('#tm-btn-habitica');
    if (!b) return;
    const on = _habOn(), manual = _hab.cfg.syncMode === 'manual';
    const n = on && manual ? _habPending() : 0;
    const state = !on ? 'locked' : _hab.err ? 'error' : manual ? 'manual' : 'auto';
    const key = state + '|' + n;
    if (b.getAttribute('data-hab-key') === key) return;
    b.setAttribute('data-hab-key', key);
    b.className = 'hub-tm-btn hub-tm-btn--outline hub-tm-btn--habitica is-' + state;
    b.title = on ? 'Habitica · ' + (manual ? 'manual sync' : 'auto sync') : 'Unlock Habitica';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = (on ? HAB_ICON_SHIELD : HAB_ICON_LOCK) +
      '<span class="hub-tm-btn-label">' + (on ? 'Habitica' : 'Unlock Habitica') + '</span>' +
      (on ? '<i class="hub-tm-hab-dot"></i>' : '') +
      (n ? '<span class="hub-tm-hab-badge" aria-label="' + n + ' changes waiting">' + n + '</span>' : '');
  }

  /* ── Hub views ── */
  function _habLockedHtml() {
    return '<div class="hub-tm-hab-perks">' + HAB_PERKS.map(function (p, i) {
      return '<div class="hub-tm-hab-perk"><span class="hub-tm-hab-perk-n">' + (i + 1) + '</span><div><strong>' + p[0] + '</strong><p>' + p[1] + '</p></div></div>';
    }).join('') + '</div>' +
    '<div class="hub-tm-hab-cta">' +
      '<button type="button" class="hub-tm-btn hub-tm-btn--primary hub-tm-hab-unlock" data-hab-go="connect">' + HAB_ICON_LOCK + '<span>Unlock Habitica</span></button>' +
      '<p>You only need your Habitica User ID and API Token. They stay in this browser.</p>' +
    '</div>';
  }
  function _habConnectHtml() {
    return '<ol class="hub-tm-hab-steps">' +
      '<li><span>1</span><div>Open <a href="https://habitica.com/user/settings/api" target="_blank" rel="noopener noreferrer">Habitica → Settings → API</a></div></li>' +
      '<li><span>2</span><div>Copy your <b>User ID</b> and <b>API Token</b></div></li>' +
      '<li><span>3</span><div>Paste them below — they are stored only in this browser and never synced to the cloud</div></li>' +
    '</ol>' +
    '<form id="tm-hab-connect" class="hub-tm-hab-form" autocomplete="off">' +
      '<div class="hub-tm-field"><label for="tm-hab-user">User ID</label><input type="text" class="hub-tm-input" id="tm-hab-user" autocomplete="off" spellcheck="false" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="' + _esc(_hab.cfg.userId || '') + '"></div>' +
      '<div class="hub-tm-field"><label for="tm-hab-key">API Token</label><input type="password" class="hub-tm-input" id="tm-hab-key" autocomplete="off" spellcheck="false" placeholder="' + (_hab.cfg.apiKey ? '•••••••• saved — leave blank to keep' : 'API Token') + '"></div>' +
      '<p class="hub-tm-error" id="tm-hab-error" role="alert"></p>' +
      '<div class="hub-tm-hab-actions"><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-hab-go="locked">Back</button><button type="submit" class="hub-tm-btn hub-tm-btn--primary hub-tm-hab-unlock">' + HAB_ICON_LOCK + '<span>Unlock</span></button></div>' +
    '</form>';
  }
  function _habHubHtml() {
    const u = _hab.user || {}, c = _hab.cfg, manual = c.syncMode === 'manual';
    const today = _todayStr();
    let tot = 0, dn = 0, od = 0, linked = 0;
    _timeBlocks.forEach(function (b) {
      if (b.date === today) { tot++; if (b.done) dn++; }
      if (_habIsOverdue(b)) od++;
      if (b.habiticaId) linked++;
    });
    const pct = tot ? Math.round(dn / tot * 100) : 0, pend = _habPending();
    const lvl = u.lvl || 1, toNext = u.toNext || _habToNext(lvl), maxHp = u.maxHp || 50;
    const hpPct = _clamp(Math.round((u.hp || 0) / maxHp * 100), 0, 100), xpPct = _clamp(Math.round((u.exp || 0) / toNext * 100), 0, 100);
    const meter = function (k, cls, p, txt) { return '<div class="hub-tm-hab-meter ' + cls + '"><span>' + k + '</span><div><i style="width:' + p + '%"></i></div><em>' + txt + '</em></div>'; };
    const tile = function (v, k, cls) { return '<div class="hub-tm-hab-tile ' + (cls || '') + '"><b>' + v + '</b><span>' + k + '</span></div>'; };
    const opt = function (attr, val, on, label, sub) { return '<button type="button" class="hub-tm-hab-opt" data-hab-' + attr + '="' + val + '" aria-pressed="' + on + '"><strong>' + label + '</strong><small>' + sub + '</small></button>'; };
    const ranks = _allTags().map(function (t) {
      const cur = String(c.prio[t.id] != null ? c.prio[t.id] : 1);
      return '<div class="hub-tm-hab-rank" style="' + _tagStyle(t) + '"><span class="hub-tm-hab-rank-name"><i class="hub-tm-tag-dot"></i>' + _esc(t.label) + '</span>' +
        '<span class="hub-tm-hab-rank-opts" role="radiogroup" aria-label="Difficulty for ' + _esc(t.label) + '">' +
        HAB_PRIO.map(function (o) { return '<button type="button" data-hab-rank="' + _esc(t.id) + '" data-val="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + '</button>'; }).join('') +
        '</span></div>';
    }).join('');
    _habPruneLog();
    const auto = _hab.cfg.logAutoClear;
    const log = _hab.log.length
      ? _hab.log.map(function (e) {
          const exp = new Date(e.t + HAB_LOG_TTL);
          return '<li' + (auto ? ' title="Clears at ' + _pad(exp.getHours()) + ':' + _pad(exp.getMinutes()) + '"' : '') + '><time>' + _habAgo(e.t) + '</time><span>' + _esc(e.text) + '</span></li>';
        }).join('')
      : '<li class="is-empty">' + (auto ? 'No activity in the last hour.' : 'No sync activity yet this session.') + '</li>';
    const logTools = '<span class="hub-tm-hab-logtools">' +
      '<button type="button" class="hub-tm-hab-minibtn" data-hab-logclear="toggle" aria-pressed="' + auto + '" title="Remove entries automatically one hour after they appear">Auto-clear · 1h</button>' +
      '<button type="button" class="hub-tm-hab-minibtn" data-hab-logclear="now"' + (_hab.log.length ? '' : ' disabled') + '>Clear now</button></span>';

    return '<div class="hub-tm-hab-char">' +
        '<div class="hub-tm-hab-lv"><b>' + lvl + '</b><small>LV</small></div>' +
        '<div class="hub-tm-hab-char-main"><div class="hub-tm-hab-name">' + _esc(u.name || 'Adventurer') + '</div>' +
          meter('HP', 'hp', hpPct, Math.round(u.hp || 0) + '/' + maxHp) +
          meter('EXP', 'xp', xpPct, Math.round(u.exp || 0) + '/' + toNext) +
        '</div>' +
        '<div class="hub-tm-hab-gold"><span class="hub-tm-hab-coin" aria-hidden="true"></span><b>' + (u.gp || 0).toFixed(1) + '</b><small>Gold</small></div>' +
      '</div>' +
      '<div class="hub-tm-hab-tiles">' +
        '<div class="hub-tm-hab-tile"><div class="hub-tm-hab-ring" style="--p:' + pct + '"><b>' + dn + '/' + tot + '</b></div><span>Today</span></div>' +
        tile(linked, 'Linked To-Dos') + tile(od, 'Overdue', od ? 'is-bad' : '') + tile(pend, 'Waiting', pend ? 'is-warn' : '') +
      '</div>' +
      '<section class="hub-tm-hab-card"><h4>Sync mode</h4>' +
        '<div class="hub-tm-hab-opts">' +
          opt('mode', 'auto', !manual, 'Auto', 'Syncs a moment after every change and checks Habitica every couple of minutes.') +
          opt('mode', 'manual', manual, 'Manual', 'Nothing leaves this browser until you press Sync now.') +
        '</div>' +
        '<div class="hub-tm-hab-syncline"><span class="hub-tm-hab-led' + (_hab.err ? ' is-bad' : pend && manual ? ' is-warn' : '') + '"></span>' +
          '<span>' + (_hab.err ? _esc(_hab.err) : 'Last synced ' + _habAgo(_hab.lastSync)) + (pend ? ' · ' + pend + ' change' + (pend > 1 ? 's' : '') + ' waiting' : '') + '</span>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--primary" id="tm-hab-sync-now"' + (_hab.busy ? ' disabled' : '') + '>' + (_hab.busy ? 'Syncing…' : 'Sync now') + '</button>' +
        '</div>' +
      '</section>' +
      '<section class="hub-tm-hab-card"><h4>Which blocks become To-Dos</h4>' +
        '<div class="hub-tm-hab-opts">' +
          opt('scope', 'titled', c.scope !== 'all', 'Named blocks', 'Only blocks you gave a title or description.') +
          opt('scope', 'all', c.scope === 'all', 'Every block', 'Including untitled ones, from today onward.') +
        '</div>' +
      '</section>' +
      _sdHtml() +
      '<section class="hub-tm-hab-card"><h4>Quest difficulty by tag</h4><div class="hub-tm-hab-ranks">' + ranks + '</div></section>' +
      '<section class="hub-tm-hab-card"><div class="hub-tm-hab-cardhead"><h4>Recent activity</h4>' + logTools + '</div><ul class="hub-tm-hab-log">' + log + '</ul>' + (auto ? '<p class="hub-tm-hab-logfoot">Entries disappear one hour after they appear.</p>' : '') + '</section>' +
      '<div class="hub-tm-hab-actions hub-tm-hab-actions--split"><button type="button" class="hub-tm-btn hub-tm-btn--alert" id="tm-hab-disconnect">Disconnect</button><button type="button" class="hub-tm-btn hub-tm-btn--outline" data-close>Close</button></div>';
  }
  function _habRenderHub() {
    const body = _el('#tm-hab-body');
    if (!body) return;
    if (!_habOn() && _hab.view === 'hub') _hab.view = 'locked';
    const v = _hab.view || (_habOn() ? 'hub' : 'locked');
    _hab.view = v;
    body.innerHTML = v === 'hub' ? _habHubHtml() : v === 'connect' ? _habConnectHtml() : _habLockedHtml();
    const hero = _el('#tm-hab-hero');
    hero.className = 'hub-tm-hab-hero is-' + (v === 'hub' ? 'unlocked' : 'locked');
    _el('#tm-hab-emblem').innerHTML = '<span class="hub-tm-hab-emblem-in">' + (v === 'hub' ? HAB_ICON_SHIELD : HAB_ICON_LOCK) + '</span>';
    _el('#hub-tm-hab-heading').textContent = v === 'hub' ? 'Habitica Link' : v === 'connect' ? 'Insert your key' : 'Unlock Habitica';
    _el('#tm-hab-sub').textContent = v === 'hub' ? (_hab.user && _hab.user.name ? 'Connected as ' + _hab.user.name : 'Connected')
      : v === 'connect' ? 'Two values from your Habitica settings.' : 'Turn your time blocks into real quests.';
    const pill = _el('#tm-hab-pill');
    pill.textContent = v === 'hub' ? (_hab.cfg.syncMode === 'manual' ? 'Manual sync' : 'Auto sync') : 'Locked';
    pill.className = 'hub-tm-hab-pill ' + (v === 'hub' ? (_hab.cfg.syncMode === 'manual' ? 'is-manual' : 'is-auto') : 'is-locked');
  }
  function _habRefreshUser() {
    if (_hab.user && Date.now() - _hab.lastPull < 60000) return;
    _habFetchUser().then(function () { _hab.lastPull = Date.now(); _habChip(); if (_habHubOpen()) _habRenderHub(); }).catch(function (e) {
      _hab.err = e.status === 401 ? 'Habitica rejected the saved credentials.' : (e.message || ''); _habBtn(); if (_habHubOpen()) _habRenderHub();
    });
  }
  function _habAfterCfg() { _habRenderHub(); _habBtn(); _habChip(); }

  async function _habConnect() {
    const err = _el('#tm-hab-error');
    const uid = _el('#tm-hab-user').value.trim(), key = _el('#tm-hab-key').value.trim() || _hab.cfg.apiKey;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) { err.textContent = 'User ID looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.'; return; }
    if (!key) { err.textContent = 'Paste your API Token.'; return; }
    const prev = _hab.cfg;
    _hab.cfg = Object.assign({}, prev, { userId: uid, apiKey: key });
    err.textContent = 'Checking your key…';
    try { await _habFetchUser(); }
    catch (e) {
      _hab.cfg = prev;
      err.textContent = e.status === 401 ? 'Habitica rejected that User ID / API Token.' : 'Couldn’t reach Habitica: ' + e.message;
      return;
    }
    if (!_hab.cfg.since) _hab.cfg.since = _todayStr();                   // overdue tracking starts when you unlock, not from old history
    _hab.err = '';
    _hab.lastPull = Date.now();
    _habSave();
    _hab.view = 'hub';
    _habAfterCfg();
    _renderGrid({ animate: false, scroll: false });
    _toast('Habitica unlocked');
    _habQueueSync(0);
  }
  function _habRunSync() {
    if (_hab.busy) return;
    _hab.sweep = true;
    const p = _habReconcile(true);
    _habRenderHub();
    p.then(function () { if (_habHubOpen()) _habRenderHub(); });
  }
  function _habHubClick(e) {
    const t = e.target.closest('[data-hab-go],[data-hab-mode],[data-hab-scope],[data-hab-rank],[data-hab-logclear],[data-hab-sd],[data-hab-sdprio],[data-hab-sdday],#tm-hab-sync-now,#tm-hab-disconnect');
    if (!t) return;
    if (t.hasAttribute('data-hab-logclear')) {
      if (t.getAttribute('data-hab-logclear') === 'now') _hab.log = [];
      else { _hab.cfg.logAutoClear = !_hab.cfg.logAutoClear; _habSave(); _habPruneLog(); }
      _habRenderHub();
      return;
    }
    if (t.hasAttribute('data-hab-go')) {
      _hab.view = t.getAttribute('data-hab-go');
      _habRenderHub();
      const f = _el('#tm-hab-user');
      if (f) f.focus();
      return;
    }
    if (t.id === 'tm-hab-sync-now') { _habRunSync(); return; }
    if (t.id === 'tm-hab-disconnect') {
      _confirm('Remove the saved Habitica credentials from this browser? To-Dos already created stay in Habitica.' + (_hab.cfg.sdId ? ' The Streak Daily stays too and keeps costing HP on missed days — switch it off first if you do not want that.' : ''), function () {
        _hab.cfg.userId = ''; _hab.cfg.apiKey = '';
        _hab.user = null; _hab.log = []; _hab.lastSync = 0; _hab.err = ''; _hab.view = 'locked';
        _habSave();
        _habAfterCfg();
        _renderGrid({ animate: false, scroll: false });
        _toast('Habitica locked');
      }, { title: 'Lock Habitica?', label: 'Disconnect' });
      return;
    }
    if (t.getAttribute('data-hab-sd') === 'toggle') { _sdToggle(); return; }
    if (t.hasAttribute('data-hab-sd')) _hab.cfg.sdRest = !_hab.cfg.sdRest;
    else if (t.hasAttribute('data-hab-sdprio')) _hab.cfg.sdPrio = t.getAttribute('data-val');
    else if (t.hasAttribute('data-hab-sdday')) {
      const i = +t.getAttribute('data-hab-sdday'), a = _hab.cfg.sdDays.split('');
      a[i] = a[i] === '1' ? '0' : '1';
      if (a.indexOf('1') < 0) return;                                      // at least one due day
      _hab.cfg.sdDays = a.join('');
    }
    else if (t.hasAttribute('data-hab-mode')) _hab.cfg.syncMode = t.getAttribute('data-hab-mode') === 'manual' ? 'manual' : 'auto';
    else if (t.hasAttribute('data-hab-scope')) _hab.cfg.scope = t.getAttribute('data-hab-scope') === 'all' ? 'all' : 'titled';
    else if (t.hasAttribute('data-hab-rank')) _hab.cfg.prio[t.getAttribute('data-hab-rank')] = t.getAttribute('data-val');
    _habSave();
    _habAfterCfg();
    _habQueueSync(0);                                                    // no-op in manual mode
  }
  function _bindHabitica() {
    const modal = _el('#hub-tm-hab-modal'), body = _el('#tm-hab-body');
    const open = function () {
      _hab.view = _habOn() ? 'hub' : 'locked';
      _habRenderHub();
      _openModal(modal, '#tm-hab-close');
      if (_habOn()) _habRefreshUser();
    };
    _el('#tm-btn-habitica').addEventListener('click', open);
    _el('#hub-tm-hab-chip').addEventListener('click', open);
    body.addEventListener('click', _habHubClick);
    body.addEventListener('submit', function (e) { e.preventDefault(); _habConnect(); });

    _habChip();
    if (_hab.timer) clearInterval(_hab.timer);
    _hab.timer = setInterval(function () { _habTick(); _habPruneLog(); if (_habHubOpen() && _hab.view === 'hub') _habRenderHub(); }, 60000);
    _habQueueSync(800);
  }

  return mod;
})();

/* ── Register with router ── */
if (typeof app !== 'undefined' && app && typeof app.register === 'function') {
  app.register(timeManagementModule);
}