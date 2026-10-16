/* ============================================================
   HUB.OS — modules/perf-lite.js
   "Lite" performance mode: keeps the active theme's colours but
   switches off backdrop blur, glow filters, decorative infinite
   animations and the full-screen dot grid (see body.perf-lite
   in styles.css).

   Modes (persisted in localStorage 'hub_perf_mode'):
     'auto' (default) → turns Lite on by itself when it detects
                         Save-Data / reduced-motion, or when a
                         short frame-rate probe measures a slow
                         device. The decision is remembered.
     'on'             → always Lite
     'off'            → never Lite

   Load it as the FIRST script inside <body> (index.html) so the
   class is on <body> before the first paint:
     <script src="./modules/perf-lite.js"></script>

   Settings UI: static markup in index.html (#backup-perf-section).
   This script wires its Auto / On / Off buttons, keeps the labels in
   the system language (localStorage 'hub_system_language' + the
   'hubLanguageChanged' event dispatched by app.js) and shows status.

   Public API:  HubPerf.get() · set(mode) · isLite() · setLanguage('en'|'vi')
   ============================================================ */

const HubPerf = (function () {
  'use strict';

  const MODE_KEY  = 'hub_perf_mode';        // 'auto' | 'on' | 'off'
  const AUTO_KEY  = 'hub_perf_auto_lite';   // '1' once the probe (or a hint) decided this device is slow
  const CLASS     = 'perf-lite';
  const LANG_KEY  = 'hub_system_language';
  const PROBE_FRAMES   = 90;                // ≈ 1.5 s at 60 fps
  const SLOW_FRAME_MS  = 22;                // median frame time above this ≈ under 45 fps
  const PROBE_DELAY_MS = 2500;              // let the app finish its first render before measuring

  const I18N = {
    title:  { en: 'LITE MODE — SMOOTHER ON WEAK DEVICES', vi: 'CHẾ ĐỘ LITE — MƯỢT HƠN TRÊN MÁY YẾU' },
    desc:   { en: 'Keeps your theme colours but turns off blur, glow and decorative animations. Auto switches it on when the device looks slow.',
              vi: 'Giữ màu theme nhưng tắt làm mờ kính, hiệu ứng phát sáng và animation trang trí. Chế độ Tự động sẽ bật khi máy có vẻ chậm.' },
    auto:   { en: 'Auto', vi: 'Tự động' },
    on:     { en: 'On',   vi: 'Bật' },
    off:    { en: 'Off',  vi: 'Tắt' },
    stOn:   { en: 'Lite is active', vi: 'Lite đang bật' },
    stOff:  { en: 'Lite is inactive', vi: 'Lite đang tắt' },
    stAuto: { en: 'Lite is active (auto-detected)', vi: 'Lite đang bật (tự phát hiện)' }
  };

  let _lang = 'en';
  let _probing = false;
  let _bound = false;

  function _t(k) { return (I18N[k] && (I18N[k][_lang] || I18N[k].en)) || k; }
  function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  function get() { var m = _lsGet(MODE_KEY); return (m === 'on' || m === 'off') ? m : 'auto'; }

  /** Should Lite be active right now, given the mode and what we know about the device? */
  function _wanted() {
    var m = get();
    if (m === 'on') return true;
    if (m === 'off') return false;
    return _lsGet(AUTO_KEY) === '1';
  }

  function isLite() { return !!(document.body && document.body.classList.contains(CLASS)); }

  function _apply() {
    if (!document.body) return;
    document.body.classList.toggle(CLASS, _wanted());
    _refreshUI();
  }

  /* ---------- Auto detection ---------- */

  function _hintsSayLite() {
    try {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn && conn.saveData) return true;
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  /** Measure ~90 frames; resolves with the median frame time in ms (null if the tab was hidden). */
  function _probeFrames() {
    return new Promise(function (resolve) {
      var last = 0, deltas = [];
      function tick(ts) {
        if (document.visibilityState !== 'visible') return resolve(null);
        if (last) deltas.push(ts - last);
        last = ts;
        if (deltas.length >= PROBE_FRAMES) {
          deltas.sort(function (a, b) { return a - b; });
          return resolve(deltas[Math.floor(deltas.length / 2)]);
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function _maybeProbe() {
    if (_probing || get() !== 'auto' || _lsGet(AUTO_KEY) === '1') return;
    if (_hintsSayLite()) { _lsSet(AUTO_KEY, '1'); _apply(); return; }
    _probing = true;
    setTimeout(function () {
      _probeFrames().then(function (median) {
        _probing = false;
        if (median !== null && median > SLOW_FRAME_MS) { _lsSet(AUTO_KEY, '1'); _apply(); }
      });
    }, PROBE_DELAY_MS);
  }

  /* ---------- Public setters ---------- */

  function set(mode) {
    if (mode !== 'on' && mode !== 'off') mode = 'auto';
    _lsSet(MODE_KEY, mode);
    if (mode === 'auto') {
      try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* ignore */ }   // re-evaluate from scratch
      _probing = false;
    }
    _apply();
    if (mode === 'auto') _maybeProbe();
  }

  function setLanguage(lang) {
    _lang = (lang === 'vi') ? 'vi' : 'en';
    _refreshUI();
  }

  /* ---------- Settings UI (static markup in index.html) ---------- */

  function _el(id) { return document.getElementById(id); }

  function _refreshUI() {
    var section = _el('backup-perf-section');
    if (!section) return;
    var m = get();
    var title = _el('backup-perf-title'), desc = _el('backup-perf-desc'), st = _el('backup-perf-status'), seg = _el('backup-perf-seg');
    if (title) title.textContent = _t('title');
    if (desc)  desc.textContent  = _t('desc');
    if (seg) {
      seg.setAttribute('aria-label', _t('title'));
      seg.querySelectorAll('[data-perf-mode]').forEach(function (btn) {
        var mode = btn.getAttribute('data-perf-mode');
        btn.textContent = _t(mode);
        btn.setAttribute('aria-pressed', String(m === mode));
      });
    }
    if (st) st.textContent = isLite() ? (m === 'auto' ? _t('stAuto') : _t('stOn')) : _t('stOff');
  }

  function _bindUI() {
    if (_bound) return;
    var seg = _el('backup-perf-seg');
    if (!seg) return;
    _bound = true;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-perf-mode]') : null;
      if (btn) set(btn.getAttribute('data-perf-mode'));
    });
    // Re-sync labels whenever the Settings modal opens (language may have changed meanwhile)
    var openBtn = _el('btn-backup-open');
    if (openBtn) openBtn.addEventListener('click', function () { setTimeout(_syncLang, 60); });
    // app.js broadcasts this when the user switches EN/VI
    window.addEventListener('hubLanguageChanged', function (e) { setLanguage(e && e.detail); });
  }

  function _syncLang() {
    var l = 'en';
    try { l = _lsGet(LANG_KEY) || 'en'; } catch (e) { /* ignore */ }
    setLanguage(l);
  }

  /* ---------- Boot ---------- */

  function _boot() {
    _bindUI();
    _syncLang();
    _apply();
    _maybeProbe();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();

  return { get: get, set: set, isLite: isLite, setLanguage: setLanguage };
})();
