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
  const VIEW_KEY     = 'hub_tm_view';
  const HINT_KEY     = 'hub_tm_hint_seen';
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
    chev:   TL_SVG('<path d="m9 6 6 6-6 6"/>')
  };
  let _tl = { q: '', tag: 'all', range: 'all', status: 'all', pastOpen: false };
  /* Set Time v2 — constants & state */
  const SB_DURS = [15, 30, 45, 60, 90, 120, 180];
  const SB_WEEKS = [1, 2, 4, 8, 12];
  const SB_PRESETS = [['once', 'Just this day', []], ['weekdays', 'Weekdays', [1, 2, 3, 4, 5]], ['weekends', 'Weekends', [6, 0]], ['all', 'Every day', [0, 1, 2, 3, 4, 5, 6]]];
  const SB_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  let _sb = { tag: 'work', days: [], weeks: 1, ov: {}, dur: 30 };

  const ICON = {
    brush:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>',
    clock:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
    prev:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15,18 9,12 15,6"/></svg>',
    next:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9,18 15,12 9,6"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>',
    repeat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17,1 21,5 17,9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7,23 3,19 7,15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    timeline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><rect x="7" y="10" width="4" height="8" rx="1"/><rect x="13" y="6" width="4" height="12" rx="1"/></svg>',
    focus:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
    bell:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    gear:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>'
  };

  /* ============================================================
     STATE
     ============================================================ */
  let _sectionEl   = null;
  let _initialised = false;
  let _dataReady   = false;
  let _dataUid     = undefined;   // account whose data is in memory: uid, null = signed out, undefined = nothing loaded yet
  let _loadSeq     = 0;           // lets a newer load (account switch) supersede an older one still in flight
  let _syncWired   = false;
  let _tombs       = { blocks: {}, tags: {}, templates: {} };                       // id → deletion time (so deletes sync too)
  let _base        = { blocks: {}, tags: {}, templates: {}, settings: '' };          // signature of every item at the last sync
  let _settingsAt  = 0;
  let _remoteT     = null;
  let _pendingClaim = null;
  let _confirmCancelCb = null;
  let _ui          = new AbortController();   // document-level listeners of the current mount

  let _view        = _lsGet(VIEW_KEY) === 'week' || _lsGet(VIEW_KEY) === 'month' ? _lsGet(VIEW_KEY) : 'day';
  let _currentDate = _todayStr();
  let _timeBlocks  = [];
  let _customTags  = [];
  let _activeTagId = 'work';
  let _templates   = [];
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
  function _tagStyle(tag) { return '--tm-c:' + _safeColor(tag.color) + ';--tm-k:' + _tint(tag); }

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
      checklist: _normCk(b.checklist),
      ckDel: Array.isArray(b.ckDel) ? b.ckDel.map(String).slice(0, CK_MAX) : [],
      updatedAt: Number(b.updatedAt) || 0
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
    const out = { blocks: {}, tags: {}, templates: {} };
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
    _tombs       = _normTombs(data.tombs);
    _settingsAt  = Number(data.settingsAt) || 0;
    if (Array.isArray(data.templates)) _templates = data.templates.map(_normTpl).filter(Boolean);
    else _seedLegacyTemplates();
    _applyAudio(data.audio && typeof data.audio === 'object' ? data.audio : _lsJson(AUDIO_KEY));
  }
  function _resetData() {
    _cancelDrag();
    _timeBlocks = []; _customTags = []; _templates = []; _activeTagId = 'work';
    _tombs = { blocks: {}, tags: {}, templates: {} };
    _settingsAt = 0;
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
    _base = { blocks: {}, tags: {}, templates: {}, settings: JSON.stringify([_activeTagId, _audioSynced()]) };
    _timeBlocks.forEach(function (b) { _base.blocks[b.id] = _sigOf(b); });
    _customTags.forEach(function (t) { _base.tags[t.id] = _sigOf(t); });
    _templates.forEach(function (t) { _base.templates[t.id] = _sigOf(t); });
  }
  function _payload() {
    const now = Date.now();
    _stampList(_timeBlocks, 'blocks', now);
    _stampList(_customTags, 'tags', now);
    _stampList(_templates, 'templates', now);
    const audio = _audioSynced();
    const ss = JSON.stringify([_activeTagId, audio]);
    if (_base.settings !== ss) { _base.settings = ss; _settingsAt = now; }
    return {
      v: 2, timeBlocks: _timeBlocks, customTags: _customTags, templates: _templates,
      audio: audio, activeTagId: _activeTagId, settingsAt: _settingsAt, tombs: _tombs, updatedAt: now
    };
  }
  function _saveAll() {
    _saveTimer = null;
    if (_dataUid === undefined) return;                  // nothing loaded yet — never write an empty shell over real data
    const p = _payload();
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
    _resetData();
    if (st.payload) _applyData(st.payload);
    _rebase();
    _dataReady = true;
    if (st.claimable && _dataUid) _pendingClaim = { uid: _dataUid, count: st.claimable.count, payload: st.claimable.payload };
    else _pendingClaim = null;
    _afterDataReady(st);
  }
  function _afterDataReady(st) {
    _habSeedKnown();                       // this account's To-Do ids count as already synced — Habitica must never read another account's blocks as "deleted"
    _habQueueSync(800);
    _loadAudio();                          // this device's alerts on/off switch
    if (_audio.enabled) _startAudio(); else if (_audioTimer) _stopAudio();
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
    return JSON.stringify([a.timeBlocks, a.customTags, a.templates, a.audio]) === JSON.stringify([b.timeBlocks, b.customTags, b.templates, b.audio]);
  }
  function _onRemote(uid, remote) {
    if (!_dataReady || uid !== _dataUid) return;
    if (_drag || _editingId) {                          // never pull the rug from under a drag / open editor
      if (_remoteT) clearTimeout(_remoteT);
      _remoteT = setTimeout(function () { _remoteT = null; _onRemote(uid, remote); }, 1200);
      return;
    }
    const local = _payload();
    const merged = HubDB.mergeTimeManagement(local, remote);
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
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-templates" title="Templates" aria-label="Templates">' + ICON.template + '<span class="hub-tm-btn-label">Templates</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-set-time" title="Set Time (repeat blocks)" aria-label="Set Time">' + ICON.repeat + '<span class="hub-tm-btn-label">Set Time</span></button>' +
          '<button type="button" class="hub-tm-btn hub-tm-btn--tool" id="tm-btn-timeline" title="Timeline" aria-label="Timeline">' + ICON.timeline + '<span class="hub-tm-btn-label">Timeline</span></button>' +
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

      '<div class="hub-tm-hint-bar hub-tm-hidden" id="hub-tm-hint">' +
        '<span>Drag on the grid to create a block · drag a block to move it · drag its edges to resize · click to edit. On touch, press and hold.</span>' +
        '<button type="button" id="tm-btn-hint-close" aria-label="Dismiss tip">&times;</button>' +
      '</div>' +

      '<div class="hub-tm-grid-wrapper">' +
        '<div class="hub-tm-grid-header" id="hub-tm-grid-header"></div>' +
        '<div class="hub-tm-grid-scroll" id="hub-tm-grid-scroll"><div class="hub-tm-grid-body" id="hub-tm-grid-body"></div></div>' +
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
            '<div class="hub-tm-insp-actions"><span class="hub-tm-insp-keys" aria-hidden="true"><kbd>Enter</kbd> save · <kbd>Esc</kbd> close</span>' +
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

      /* ── Settings · Sound alerts (cue sheet) ── */
      '<div class="hub-tm-overlay" id="hub-tm-settings-modal" aria-hidden="true">' +
        '<div class="hub-tm-dialog hub-tm-dialog--lg hub-tm-snd" id="tm-snd" role="dialog" aria-modal="true" aria-labelledby="hub-tm-settings-heading">' +
          '<div class="hub-tm-dialog-head"><h3 class="hub-tm-dialog-title" id="hub-tm-settings-heading">Sound alerts</h3><button type="button" class="hub-tm-dialog-close" data-close aria-label="Close">&times;</button></div>' +
          '<div class="hub-tm-dialog-body">' +
            '<section class="hub-tm-snd-master" id="tm-snd-master">' +
              '<div class="hub-tm-snd-master-text">' +
                '<label class="hub-tm-snd-master-title" for="tm-audio-enabled"><span class="hub-tm-snd-dot" aria-hidden="true"></span>Sound alerts</label>' +
                '<p class="hub-tm-hint" id="hub-tm-audio-status" aria-live="polite"></p>' +
              '</div>' +
              '<label class="toggle-switch"><input type="checkbox" id="tm-audio-enabled"><span class="toggle-track"><span class="toggle-thumb"></span></span></label>' +
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
    _el('#tm-btn-settings').addEventListener('click', _openSettings);
    _el('#tm-btn-templates').addEventListener('click', _openTemplates);
    _el('#tm-btn-set-time').addEventListener('click', _openSetTime);
    _el('#tm-btn-timeline').addEventListener('click', _openTimeline);

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
    if (e.key === 'Escape') {
      const pop = _el('#hub-tm-add-tag-form');
      if (pop && pop.classList.contains('is-open') && !_modalStack.length) {
        e.preventDefault();
        _tagPop(false);
        const nb = _el('#hub-tm-btn-new-tag');
        if (nb) nb.focus();
        return;
      }
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
  function _makeBlockEl(b) {
    const s = _toMins(b.startTime);
    let e = _toMins(b.endTime);
    if (e <= s) e = Math.min(DAY_MINS, s + CREATE_DUR);
    const tag = _tagOrFallback(b.tagId);
    const el = document.createElement('div');
    el.className = 'hub-tm-block' + (b.done ? ' is-done' : '') + (_habIsOverdue(b) ? ' is-overdue' : '');
    el.setAttribute('data-block-id', b.id);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', _blockLabel(b) + '. Enter to edit, arrow keys to move, Shift plus arrows to resize, Delete to remove.');
    el.style.cssText = _tagStyle(tag) + ';top:' + Math.round(s / 60 * HOUR_H) + 'px;height:' + Math.max(18, Math.round((e - s) / 60 * HOUR_H)) + 'px';
    const note = _plainText(b.subtitle), ck = _ckStats(b);
    el.innerHTML =
      '<div class="hub-tm-block-grip hub-tm-block-grip--top" aria-hidden="true"></div>' +
      '<div class="hub-tm-block-body">' +
        '<span class="hub-tm-block-time">' + _esc(b.startTime) + ' – ' + _esc(b.endTime) + '</span>' +
        '<span class="hub-tm-block-title">' + _esc(b.title || tag.label) + '</span>' +
        (ck.total ? '<span class="hub-tm-block-ck' + (ck.done === ck.total ? ' is-complete' : '') + '" title="Checklist: ' + ck.done + ' of ' + ck.total + ' done">&#10003; ' + ck.done + '/' + ck.total + '</span>' : '') +
        (note ? '<span class="hub-tm-block-note">' + _esc(note.slice(0, 160)) + '</span>' : '') +
      '</div>' +
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
        html += '<div class="hub-tm-month-cell' + (d.getMonth() !== m ? ' is-dim' : '') + (ds === today ? ' is-today' : '') + '" style="--tm-load:' + load + '" data-date="' + ds + '" data-activate role="button" tabindex="0" aria-label="' + DAY_FULL[d.getDay()] + ' ' + _dateLabel(d) + (list.length ? ', ' + list.length + ' block' + (list.length > 1 ? 's' : '') : '') + '">' +
                  '<span class="hub-tm-month-num">' + d.getDate() + '</span>' +
                  (mins ? '<span class="hub-tm-month-total">' + _fmtDur(mins) + '</span>' : '') +
                  '<span class="hub-tm-month-chips">' + chips + (list.length > 3 ? '<span class="hub-tm-month-more">+' + (list.length - 3) + ' more</span>' : '') + '</span>' +
                  '<span class="hub-tm-month-dots">' + dots + '</span></div>';
      }
      html += '</div>';
    }
    body.innerHTML = html + '</div>';
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
    const per = _tagTimes();
    _applyTagTimes(per);
    const box = _el('#hub-tm-summary');
    if (!box) return;
    const list = _rangeBlocks();
    if (!list.length) {
      box.classList.add('is-empty');
      box.innerHTML = '<span class="hub-tm-summary-empty">' + (_view === 'day' ? 'Drag on the grid to plan this day' : 'Nothing planned this ' + _view) + '</span>';
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
    box.innerHTML = stat('Planned', _fmtDur(total)) + stat('Blocks', list.length) + '<div class="hub-tm-summary-bar" aria-hidden="true">' + seg + '</div>';
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
    scroll.addEventListener('touchmove', function (e) { if (_drag && _drag.active && e.cancelable) e.preventDefault(); }, { passive: false, signal: _ui.signal });
    scroll.addEventListener('contextmenu', function (e) { if (_drag) e.preventDefault(); }, sig);
    scroll.addEventListener('click', _onGridClick, sig);
    scroll.addEventListener('keydown', _onGridKey, sig);
  }

  function _mainCol() { return _el('#hub-tm-main-col'); }
  function _yToMins(y) {
    const col = _mainCol();
    if (!col) return 0;
    return _clamp((y - col.getBoundingClientRect().top) / HOUR_H * 60, 0, DAY_MINS);
  }

  function _onPointerDown(e) {
    if (_view !== 'day' || _drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!e.target.closest('.hub-tm-main-col') || e.target.closest('.hub-tm-block-delete') || e.target.closest('.hub-tm-block-check')) return;
    const blockEl = e.target.closest('.hub-tm-block');
    const block = blockEl ? _blockById(blockEl.getAttribute('data-block-id')) : null;
    if (blockEl && !block) return;
    const grip = e.target.closest('.hub-tm-block-grip');
    const raw = _yToMins(e.clientY);
    const d = {
      mode: !block ? 'create' : grip ? (grip.classList.contains('hub-tm-block-grip--top') ? 'resize-top' : 'resize-bottom') : 'move',
      pointerId: e.pointerId, pointerType: e.pointerType,
      x0: e.clientX, y0: e.clientY, lastY: e.clientY,
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
    const d = _drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastY = e.clientY;
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
    }
    _applyDragAt(d.lastY);
  }

  function _applyDragAt(clientY) {
    const d = _drag;
    if (!d || !d.active) return;
    const m = _yToMins(clientY);
    let s, e;
    if (d.mode === 'create') {
      const lo = Math.min(d.raw0, m), hi = Math.max(d.raw0, m);
      s = _snap(lo, 'down'); e = _snap(hi, 'up');
      if (e - s < CREATE_DUR) e = s + CREATE_DUR;
      s = _clamp(s, d.bounds[0], d.bounds[1] - MIN_DUR);
      e = _clamp(e, s + MIN_DUR, d.bounds[1]);
    } else if (d.mode === 'move') {
      const dur = d.orig.e - d.orig.s;
      s = _clamp(d.orig.s + _snap(m - d.raw0, 'round'), d.bounds[0], d.bounds[1] - dur);
      e = s + dur;
    } else if (d.mode === 'resize-bottom') {
      s = d.orig.s;
      e = _clamp(_snap(m, 'round'), d.orig.s + MIN_DUR, d.bounds[1]);
    } else {
      e = d.orig.e;
      s = _clamp(_snap(m, 'round'), d.bounds[0], d.orig.e - MIN_DUR);
    }
    d.cur = { s: s, e: e };
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
      if (dy) { sc.scrollTop += _clamp(dy, -18, 18); _applyDragAt(y); }
    }, 16);
  }

  function _clearDrag() {
    const d = _drag;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    if (d.scrollTimer) clearInterval(d.scrollTimer);
    try { _el('#hub-tm-grid-scroll').releasePointerCapture(d.pointerId); } catch (_) {}
    _drag = null;
  }
  function _cancelDrag() {
    const d = _drag;
    if (!d) return;
    const wasActive = d.active;
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    if (d.el) d.el.classList.remove('hub-tm-block--busy');
    _clearDrag();
    if (wasActive) { _suppressClickUntil = performance.now() + 350; _renderDayBlocks(); }
  }

  function _onPointerUp(e) {
    const d = _drag;
    if (!d || e.pointerId !== d.pointerId) return;
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
    return b;
  }

  function _onGridClick(e) {
    if (performance.now() < _suppressClickUntil) return;
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

  function _onGridKey(e) {
    const t = e.target;
    if (!t.classList) return;
    if (t.hasAttribute('data-activate') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      _setDate(t.getAttribute('data-date'), { view: 'day' });
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
    _el('#tm-btn-details-delete').addEventListener('click', function () {
      const b = _blockById(_editingId);
      if (!b) return;
      _confirm('Delete “' + (b.title || _tagOrFallback(b.tagId).label) + '”?', function () {
        _timeBlocks = _timeBlocks.filter(function (x) { return x.id !== b.id; });
        _scheduleSave();
        _closeModal(modal);
        _renderGrid({ animate: false, scroll: false });
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
    _scheduleSave();
    _closeModal(_el('#hub-tm-details-modal'));
    _renderGrid({ animate: false, scroll: false });
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
     FOCUS MODE  (always about *today*, live-updating)
     ============================================================ */
  function _openFocus() {
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
    const b = cur || nxt;
    p.classList.toggle('is-idle', !cur);
    set('.hub-tm-focus-badge-text', cur ? 'NOW' : nxt ? 'UP NEXT' : 'FREE');
    if (b) {
      const tag = _tagOrFallback(b.tagId), s = _toMins(b.startTime), e = _toMins(b.endTime);
      set('.hub-tm-focus-time', b.startTime + ' – ' + b.endTime);
      set('.hub-tm-focus-title', b.title || tag.label);
      set('.hub-tm-focus-note', _plainText(b.subtitle));
      _renderFocusCk(b);
      tagEl.textContent = tag.label;
      tagEl.style.setProperty('--tm-c', _safeColor(tag.color));
      const pct = cur ? _clamp(Math.round((nm - s) / (e - s) * 100), 0, 100) : 0;
      fill.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', String(pct));
      set('.hub-tm-focus-label', cur ? pct + '% complete · ' + _fmtDur(e - nm) + ' left' : 'Starts in ' + _fmtDur(s - nm));
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
    if (ck.length) meta.push('<span>' + ckDone + '/' + ck.length + ' tasks</span>');
    let when;
    if (c.flat) { const d = _parseDate(b.date); when = '<span class="hub-tm-tl-t1">' + _dateLabel(d) + '</span><span class="hub-tm-tl-t2">' + DAY_SHORT[d.getDay()] + '</span>'; }
    else when = '<span class="hub-tm-tl-t1">' + _esc(b.startTime) + '</span><span class="hub-tm-tl-t2">' + _esc(b.endTime) + '</span>';
    const mvName = _tlDayName(_tlMoveTarget(b, c.today), c.today);
    const cls = 'hub-tm-tl-item' + (b.done ? ' is-done' : '') + (live ? ' is-live' : '') + (late ? ' is-late' : '');
    return '<li class="' + cls + '" style="' + _tagStyle(tag) + '">' +
      '<span class="hub-tm-tl-when">' + when + '</span><span class="hub-tm-tl-node" aria-hidden="true"></span>' +
      '<div class="hub-tm-tl-card">' +
        '<button type="button" class="hub-tm-tl-main" data-tl-go="' + id + '">' +
          '<span class="hub-tm-tl-title">' + title + '</span>' +
          '<span class="hub-tm-tl-meta">' + meta.join('<span class="hub-tm-tl-sep" aria-hidden="true">·</span>') + '</span>' +
          (live ? '<span class="hub-tm-tl-bar"><i style="width:' + _clamp(Math.round((c.nm - s) / (e - s) * 100), 0, 100) + '%"></i></span>' : '') +
        '</button>' +
        '<span class="hub-tm-tl-acts">' +
          '<button type="button" class="hub-tm-tl-act hub-tm-tl-act--done" role="checkbox" aria-checked="' + (b.done ? 'true' : 'false') + '" data-tl-done="' + id + '" title="' + (b.done ? 'Mark not complete' : 'Mark complete') + '" aria-label="' + (b.done ? 'Mark ' + title + ' not complete' : 'Mark ' + title + ' complete') + '">' + TL_ICON.check + '</button>' +
          (b.done ? '' : '<button type="button" class="hub-tm-tl-act" data-tl-next="' + id + '" title="Move to ' + _esc(mvName) + '" aria-label="Move ' + title + ' to ' + _esc(mvName) + '">' + TL_ICON.fwd + '</button>') +
          '<button type="button" class="hub-tm-tl-act hub-tm-tl-act--del" data-tl-del="' + id + '" title="Delete" aria-label="Delete ' + title + '">' + TL_ICON.del + '</button>' +
        '</span>' +
      '</div></li>';
  }
  function _tlGroup(g, c) {
    const d = _parseDate(g.date), diff = _tlDayDiff(g.date), isToday = diff === 0;
    let mins = 0, done = 0;
    g.items.forEach(function (b) { mins += _toMins(b.endTime) - _toMins(b.startTime); if (b.done) done++; });
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
        '<span class="hub-tm-tl-gsum">' + done + '/' + g.items.length + ' · ' + _fmtDur(mins) + '</span>' +
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
      _closeModal(modal);
      _toast(_audio.enabled ? 'Sound alerts on' : 'Sound alerts off');
    });

    modal.addEventListener('click', function (e) {
      const pv = e.target.closest('[data-preview]'), ts = e.target.closest('[data-test-sound]');
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
     deadline.  Only To-Dos are created — never Dailies or Habits.
     Credentials live in this browser only (never sent to HubDB).
     ============================================================ */
  const HAB_BASE = 'https://habitica.com/api/v3';
  const HAB_KEY  = 'hub_tm_habitica';
  const HAB_LOG_TTL = 60 * 60 * 1000;                                       // activity entries live for 1 hour (when auto-clear is on)
  const HAB_PRIO = [['0.1', 'Trivial'], ['1', 'Easy'], ['1.5', 'Medium'], ['2', 'Hard']];
  const _hab = {
    cfg: { userId: '', apiKey: '', syncMode: 'auto', scope: 'titled', since: '', prio: {}, logAutoClear: true },
    user: null, q: Promise.resolve(), busy: false, again: false, force: false,
    lastPull: 0, lastSync: 0, view: '', log: [], known: {}, gone: {}, delQ: [], timer: null, syncT: null, err: ''
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
    } catch (_) {}
  })();

  function _habSave() { _lsSet(HAB_KEY, JSON.stringify(_hab.cfg)); }
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
    const d = await _habReq('GET', '/user?userFields=stats,profile.name');
    const s = (d && d.stats) || {};
    _hab.user = { gp: +s.gp || 0, hp: +s.hp || 0, maxHp: +s.maxHealth || 50, exp: +s.exp || 0, toNext: +s.toNextLevel || 0, lvl: +s.lvl || 1, name: (d && d.profile && d.profile.name) || '' };
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
      if (before !== null) return d.gp - before;
    }
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
  async function _habPull() {
    await _habFetchUser();
    const open = await _habReq('GET', '/tasks/user?type=todos');
    const dn = await _habReq('GET', '/tasks/user?type=completedTodos');
    const o = {}, c = {}, rem = {};
    (open || []).forEach(function (t) { o[t.id] = 1; rem[t.id] = Array.isArray(t.checklist) ? t.checklist : []; });
    (dn || []).forEach(function (t) { c[t.id] = 1; });
    let changed = false;
    _timeBlocks.forEach(function (b) {
      if (!b.habiticaId) return;
      if (!b.habDone && rem[b.habiticaId] && _habMergeCk(b, rem[b.habiticaId])) changed = true;
      if (!!b.done !== !!b.habDone) return;                               // a pending local change wins
      if (c[b.habiticaId] && !b.done) { b.done = b.habDone = true; changed = true; }
      else if (o[b.habiticaId] && b.done) { b.done = b.habDone = false; changed = true; }
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
      if (!_hab.known[id]) { _hab.delQ.push(id); _hab.gone[id] = 1; }   // completed To-Dos are kept: they are earned history
    });
    _hab.known = cur;
  }
  function _habQueueSync(delay) {
    if (!_habOn() || !_dataReady || _hab.cfg.syncMode === 'manual') return;
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
    let changed = false, gold = 0, scored = 0, created = 0, updated = 0, removed = 0;
    try {
      if (pull || !_hab.user || Date.now() - _hab.lastPull > 120000) { if (await _habPull()) changed = true; }
      _habDiff();
      while (_hab.delQ.length) {
        const id = _hab.delQ.shift();
        try { await _habReq('DELETE', '/tasks/' + id); removed++; } catch (e) { if (e.status !== 404) throw e; }
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
        } catch (e) {
          if (e.status === 404 && b.habiticaId) { b.habiticaId = ''; b.habFp = ''; b.habDone = false; changed = true; }
          else throw e;
        }
      }
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
    if (_hab.err) parts.push('Error — ' + _hab.err);
    if (parts.length) { _hab.log.unshift({ t: Date.now(), text: parts.join(' · ') }); _hab.log.length = Math.min(_hab.log.length, 6); }
    if (changed) {
      _saveAll();
      if (_sectionEl && _sectionEl.isConnected) _renderGrid({ animate: false, scroll: false });
    }
    _habChip();
    if (_habHubOpen()) _habRenderHub();
    if (_hab.err) _toast('Habitica: ' + _hab.err);
    else if (scored) _toast((gold >= 0 ? '+' : '') + gold.toFixed(1) + ' gold');
    if (_hab.again) { _hab.again = false; _habQueueSync(); }
  }

  /* ── Completing a block ── */
  function _habToggleDone(id) {
    const b = _blockById(id);
    if (!b) return;
    const apply = function () {
      b.done = !b.done;
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
    const p = _habReconcile(true);
    _habRenderHub();
    p.then(function () { if (_habHubOpen()) _habRenderHub(); });
  }
  function _habHubClick(e) {
    const t = e.target.closest('[data-hab-go],[data-hab-mode],[data-hab-scope],[data-hab-rank],[data-hab-logclear],#tm-hab-sync-now,#tm-hab-disconnect');
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
      _confirm('Remove the saved Habitica credentials from this browser? To-Dos already created stay in Habitica.', function () {
        _hab.cfg.userId = ''; _hab.cfg.apiKey = '';
        _hab.user = null; _hab.log = []; _hab.lastSync = 0; _hab.err = ''; _hab.view = 'locked';
        _habSave();
        _habAfterCfg();
        _renderGrid({ animate: false, scroll: false });
        _toast('Habitica locked');
      }, { title: 'Lock Habitica?', label: 'Disconnect' });
      return;
    }
    if (t.hasAttribute('data-hab-mode')) _hab.cfg.syncMode = t.getAttribute('data-hab-mode') === 'manual' ? 'manual' : 'auto';
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