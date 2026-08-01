/* ============================================================
   HUB.OS — modules/time-management.js  PHASE 2
   Time-blocking daily planner with cloud sync, now-line,
   grid overlay blocks, and custom tag management.
   ============================================================ */
   // Hàm vá lỗi: Đổi màu nút Tag khi được chọn
var _setActiveTagButton = function (tagId) {
    // Scope to the tag manager bar only — don't touch blocks or other data-tag-id elements
    var manager = document.getElementById('hub-tm-tag-manager');
    if (!manager) return;
    var allTags = manager.querySelectorAll('.hub-tm-tag');
    for (var i = 0; i < allTags.length; i++) {
        allTags[i].classList.remove('hub-tm-tag--active');
        allTags[i].style.opacity = '0.5';
        allTags[i].style.filter = '';
    }

    var active = manager.querySelector('.hub-tm-tag[data-tag-id="' + tagId + '"]');
    if (active) {
        active.classList.add('hub-tm-tag--active');
        active.style.opacity = '1';
        active.style.filter = 'brightness(1.2)';
    }
    };
   var _syncDateUI = function (dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return;

    var picker = document.getElementById('tm-date-picker');
    if (picker) picker.value = dateStr;

    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var dayEl = document.getElementById('hub-tm-col-day-name');
    var dateEl = document.getElementById('hub-tm-col-date-num');
    if (dayEl) dayEl.textContent = days[d.getDay()] || 'Monday';
    if (dateEl) dateEl.textContent = months[d.getMonth()] + ' ' + d.getDate();
};
// Hàm _esc (chống mã độc) do Claude quên viết
const _esc = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
};

const timeManagementModule = (function () {
  'use strict';

  const SECTION_ID    = 'time-management';
  const LOCAL_KEY     = 'hub_tm_data';
  const SLOT_H        = 36;   // px per 30-min slot (matches CSS --tm-slot-h)
  const HOUR_H        = 72;   // px per hour
  const TOTAL_SLOTS   = 48;   // 00:00–23:30

  // ── Default tags (never deleted) ──
  const DEFAULT_TAGS = [
    { id: 'work',     label: 'Work',     color: '#00bfff', opacity: 85 },
    { id: 'study',    label: 'Study',    color: '#7c4dff', opacity: 85 },
    { id: 'skill',    label: 'Skill',    color: '#00e676', opacity: 85 },
    { id: 'personal', label: 'Personal', color: '#ff6e40', opacity: 85 }
  ];

  // ── DOM refs ──
  let _sectionEl   = null;
  let _initialised = false;

  // ── State ──
  let _currentDate   = _todayStr();        // "YYYY-MM-DD"
  let _timeBlocks    = [];                 // Block objects for the selected date
  let _customTags    = [];                 // User-added tags
  let _activeTagId   = 'work';            // Currently selected tag for drawing
  let _timeInterval = null;
  let _audioCheckInterval = null;
  let _lastMinuteProcessed = '';          // "HH:mm" — prevents double-play of audio alerts
  let _audioSettings = {
    enabled: false,
    startSoundURL: 'https://www.soundjay.com/misc/sounds/bell-ringing-01.mp3',
    endSoundURL:   'https://www.soundjay.com/misc/sounds/bell-ringing-02.mp3'
  };
  const TEMPLATE_KEY = 'hub_tm_templates';
  let _templates    = [];

  // ── Tag helpers ──
  function _allTags() {
    return DEFAULT_TAGS.concat(_customTags);
  }

  function _tagById(id) {
    return _allTags().find(function (t) { return t.id === id; });
  }

  /* ============================================================
     PUBLIC MODULE DEFINITION
     ============================================================ */
  const module = {
    id: 'time-management',
    name: 'Time Management',
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',

    render: function (container) {
      container.innerHTML = _buildHTML();
      _sectionEl = document.getElementById(SECTION_ID);

      if (!_initialised) {
        _initialised = true;
        _loadDataAndRender();
      } else {
        // Re-hydrate: blocks, now-line, scroll position, UI state
        _syncDateUI(_currentDate);
        _renderCustomTagPills();
        _setActiveTagButton(_activeTagId);
        _renderAllBlocks();
        _startNowLine();
        _scrollToNow();
      }
      // CRITICAL: re-bind every event listener on EVERY render
      // because innerHTML destroys the previous DOM and its listeners
      _bindAll(_sectionEl);
    },

    destroy: function () {
      if (_timeInterval) { clearInterval(_timeInterval); _timeInterval = null; }
      _stopAudioCheck();
      if (_sectionEl) _sectionEl.classList.add('hub-tm-hidden');
    }
  };

  /* ============================================================
     ASYNC INIT — load cloud data then render
     ============================================================ */
  function _loadDataAndRender() {
    if (typeof HubDB !== 'undefined' && HubDB.loadTimeManagementData) {
      HubDB.loadTimeManagementData().then(function (data) {
        if (data) {
          _customTags   = data.customTags   || [];
          _timeBlocks   = data.timeBlocks   || [];
          _activeTagId  = data.activeTagId  || 'work';
          _currentDate  = data.currentDate  || _todayStr();
        }
        _afterDataReady();
      }).catch(function () {
        _afterDataReady();
      });
    } else {
      _loadFromLocalStorage();
      _afterDataReady();
    }
  }

  function _loadFromLocalStorage() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        _customTags   = data.customTags   || [];
        _timeBlocks   = data.timeBlocks   || [];
        _activeTagId  = data.activeTagId  || 'work';
        _currentDate  = data.currentDate  || _todayStr();
      }
    } catch (_) {}
  }

  function _afterDataReady() {
    _loadTemplates();
    _loadAudioSettings();
    _syncDateUI(_currentDate);
    _renderCustomTagPills();
    _setActiveTagButton(_activeTagId);
    renderGridStructure(_currentView);
    _renderAllBlocks();
    _startNowLine();
    _scrollToNow();
    // Start audio check loop if enabled
    if (_audioSettings.enabled) { _startAudioCheck(); }
  }

  /* ============================================================
     PERSISTENCE
     ============================================================ */
  function _saveAll() {
    var payload = {
      currentDate:  _currentDate,
      timeBlocks:   _timeBlocks,
      customTags:   _customTags,
      activeTagId:  _activeTagId
    };

    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(payload)); } catch (_) {}

    if (typeof HubDB !== 'undefined' && HubDB.saveTimeManagementData) {
      HubDB.saveTimeManagementData(payload).catch(function () {});
    }
  }

  /* ============================================================
     HTML BUILDER  (no demo block — that's generated by JS now)
     ============================================================ */
  function _buildHTML() {
    var dateVal = _currentDate;

    return '<section id="' + SECTION_ID + '" class="module-section">' +
      '<header class="hub-tm-header">' +
        '<div class="hub-tm-header-left">' +
          '<h2 class="hub-tm-title">' +
            '<svg class="hub-tm-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>' +
            'Time Management' +
          '</h2>' +
          '<div class="hub-tm-date-selector">' +
            '<button class="hub-tm-date-nav" id="tm-btn-prev" aria-label="Previous day" title="Previous day">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,18 9,12 15,6"/></svg>' +
            '</button>' +
            '<input type="date" class="hub-tm-date-input" id="tm-date-picker" title="Select date" value="' + dateVal + '">' +
            '<button class="hub-tm-date-nav" id="tm-btn-next" aria-label="Next day" title="Next day">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,18 15,12 9,6"/></svg>' +
            '</button>' +
            '<button class="hub-tm-btn hub-tm-btn-today" id="tm-btn-today">Today</button>' +
          '</div>' +
          '<div class="hub-tm-view-switcher" id="hub-tm-view-switcher">' +
            '<button class="hub-tm-view-btn hub-tm-view-btn--active" data-view="day">Day</button>' +
            '<button class="hub-tm-view-btn" data-view="week">Week</button>' +
            '<button class="hub-tm-view-btn" data-view="month">Month</button>' +
          '</div>' +
          '<button class="hub-tm-settings-btn" id="tm-btn-settings" title="Settings">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="hub-tm-header-right">' +
          '<button class="hub-tm-btn hub-tm-btn-outline" id="tm-btn-load-template">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            'Load Template' +
          '</button>' +
          '<button class="hub-tm-btn hub-tm-btn-outline" id="tm-btn-save-template">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>' +
            'Save as Template' +
          '</button>' +
          '<button class="hub-tm-btn hub-tm-btn-focus" id="tm-btn-focus-mode" title="Toggle Focus Mode">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12M4.93 19.07l2.12-2.12m9.9-9.9l2.12-2.12"/></svg>' +
            'Focus Mode' +
          '</button>' +
          '<button class="hub-tm-btn hub-tm-btn-outline" id="tm-btn-set-time">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>' +
            'Set Time' +
          '</button>' +
          '<button class="hub-tm-btn hub-tm-btn-outline" id="tm-btn-timeline">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="4" height="8" rx="1"/><rect x="13" y="6" width="4" height="12" rx="1"/></svg>' +
            'Timeline' +
          '</button>' +
        '</div>' +
      '</header>' +
      '<div class="hub-tm-tag-manager" id="hub-tm-tag-manager">' +
        '<span class="hub-tm-tag-manager-label">Tags:</span>' +
        _buildTagPillsHTML() +
        '<span class="hub-tm-tag-separator"></span>' +
        '<span class="hub-tm-tag-container" id="hub-tm-custom-tags"></span>' +
        '<form class="hub-tm-add-tag-form" id="hub-tm-add-tag-form" autocomplete="off">' +
          '<input type="text" class="hub-tm-add-tag-name" id="hub-tm-add-tag-name" placeholder="Tag name…" maxlength="20" aria-label="New tag name">' +
          '<input type="color" class="hub-tm-add-tag-color" id="hub-tm-add-tag-color" value="#00bcd4" aria-label="Tag color">' +
          '<input type="number" class="hub-tm-add-tag-opacity" id="hub-tm-add-tag-opacity" value="85" min="20" max="100" step="5" aria-label="Tag opacity %" title="Block opacity %">' +
          '<button type="submit" class="hub-tm-btn hub-tm-btn-add-tag" id="hub-tm-btn-add-tag" title="Add custom tag">+</button>' +
        '</form>' +
      '</div>' +
      '<div class="hub-tm-grid-wrapper">' +
        '<div class="hub-tm-grid-header" id="hub-tm-grid-header"></div>' +
        '<div class="hub-tm-grid-scroll" id="hub-tm-grid-scroll">' +
          '<div class="hub-tm-grid-body" id="hub-tm-grid-body"></div>' +
        '</div>' +
      '</div>' +
      '<aside class="hub-tm-focus-panel" id="hub-tm-focus-panel" aria-hidden="true">' +
        '<div class="hub-tm-focus-backdrop"></div>' +
        '<div class="hub-tm-focus-card">' +
          '<div class="hub-tm-focus-now-badge">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="10"/></svg>NOW' +
          '</div>' +
          '<div class="hub-tm-focus-block-info">' +
            '<span class="hub-tm-focus-time"></span>' +
            '<h3 class="hub-tm-focus-title"></h3>' +
            '<span class="hub-tm-focus-tag"></span>' +
            '<p class="hub-tm-focus-subtitle"></p>' +
          '</div>' +
          '<div class="hub-tm-focus-progress">' +
            '<div class="hub-tm-focus-progress-bar"><div class="hub-tm-focus-progress-fill"></div></div>' +
            '<span class="hub-tm-focus-progress-label"></span>' +
          '</div>' +
          '<button class="hub-tm-btn hub-tm-btn-focus-exit" id="tm-btn-focus-exit">Exit Focus</button>' +
        '</div>' +
      '</aside>' +
      '<div class="hub-tm-tooltip" id="hub-tm-tooltip" style="display: none;">' +
        '<p class="hub-tm-tooltip-text">Drag to create a block on the grid. Click a block to edit it.</p>' +
      '</div>' +
      // ── BLOCK DETAILS MODAL ──
      '<div class="hub-tm-details-overlay" id="hub-tm-details-modal" style="display:none;" aria-hidden="true">' +
        '<div class="hub-tm-details-card">' +
          '<div class="hub-tm-details-header">' +
            '<h3 class="hub-tm-details-title">Block Details</h3>' +
            '<button class="hub-tm-details-close" id="tm-btn-details-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-details-body">' +
            '<label class="hub-tm-details-label">Time</label>' +
            '<div class="hub-tm-details-time-display" id="hub-tm-details-time">09:00 – 17:00</div>' +
            '<label class="hub-tm-details-label" for="tm-details-title">Title</label>' +
            '<input type="text" class="hub-tm-details-input" id="tm-details-title" placeholder="Block title…" maxlength="120">' +
            '<label class="hub-tm-details-label">Tag</label>' +
            '<div class="hub-tm-details-tags" id="hub-tm-details-tags"></div>' +
            '<label class="hub-tm-details-label">Description</label>' +
            '<div class="hub-tm-rich-text-container">' +
              '<div class="hub-tm-rich-toolbar">' +
                '<button type="button" class="hub-tm-rich-btn" data-cmd="bold" title="Bold"><strong>B</strong></button>' +
                '<button type="button" class="hub-tm-rich-btn" data-cmd="italic" title="Italic"><em>I</em></button>' +
                '<button type="button" class="hub-tm-rich-btn" data-cmd="underline" title="Underline"><u>U</u></button>' +
                '<span class="hub-tm-rich-sep"></span>' +
                '<label class="hub-tm-rich-color-label" title="Font Color">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' +
                  '<input type="color" class="hub-tm-rich-color-picker" id="hub-tm-rich-color" value="#ffffff">' +
                '</label>' +
                '<span class="hub-tm-rich-sep"></span>' +
                '<button type="button" class="hub-tm-rich-btn" data-cmd="indent" title="Indent">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><polyline points="7,8 3,12 7,16"/></svg>' +
                '</button>' +
                '<button type="button" class="hub-tm-rich-btn" data-cmd="outdent" title="Outdent">' +
                  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><polyline points="9,8 7,12 9,16"/></svg>' +
                '</button>' +
              '</div>' +
              '<div id="block-desc-editor" contenteditable="true" class="hub-tm-rich-editor-area" placeholder="Add a description…"></div>' +
            '</div>' +
          '</div>' +
          '<div class="hub-tm-details-footer">' +
            '<button class="hub-tm-details-btn-delete" id="tm-btn-details-delete">Delete</button>' +
            '<button class="hub-tm-details-btn-save" id="tm-btn-details-save">Save</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // ── CONFIRM DELETE MODAL ──
      '<div class="hub-tm-confirm-overlay" id="hub-tm-confirm-modal" style="display:none;" aria-hidden="true">' +
        '<div class="hub-tm-confirm-card">' +
          '<h3 class="hub-tm-confirm-title">Delete Timeline?</h3>' +
          '<p class="hub-tm-confirm-message" id="hub-tm-confirm-msg">Are you sure you want to delete this timeline?</p>' +
          '<div class="hub-tm-confirm-actions">' +
            '<button class="hub-tm-confirm-btn-cancel" id="tm-btn-confirm-cancel">Cancel</button>' +
            '<button class="hub-tm-confirm-btn-delete" id="tm-btn-confirm-delete">Delete</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // ── SETTINGS MODAL ──
      '<div class="hub-tm-settings-overlay" id="hub-tm-settings-modal" style="display:none;" aria-hidden="true">' +
        '<div class="hub-tm-settings-card">' +
          '<div class="hub-tm-settings-header">' +
            '<h3 class="hub-tm-settings-title">Settings</h3>' +
            '<button class="hub-tm-settings-close" id="tm-btn-settings-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-settings-body">' +
            '<div class="hub-tm-settings-row">' +
              '<span class="hub-tm-settings-label">Enable Audio Alerts</span>' +
              '<label class="toggle-switch">' +
                '<input type="checkbox" id="tm-audio-enabled">' +
                '<span class="toggle-slider"></span>' +
              '</label>' +
            '</div>' +
            '<label class="hub-tm-settings-label" for="tm-audio-start-url">Start Block Sound URL</label>' +
            '<input type="text" class="hub-tm-settings-input" id="tm-audio-start-url" placeholder="https://example.com/start.mp3" maxlength="500">' +
            '<label class="hub-tm-settings-label" for="tm-audio-end-url">End Block Sound URL</label>' +
            '<input type="text" class="hub-tm-settings-input" id="tm-audio-end-url" placeholder="https://example.com/end.mp3" maxlength="500">' +
          '</div>' +
          '<div class="hub-tm-settings-footer">' +
            '<button class="hub-tm-btn hub-tm-btn-outline" id="tm-btn-settings-cancel">Cancel</button>' +
            '<button class="hub-tm-btn hub-tm-btn-today" id="tm-btn-settings-save">Save Settings</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // ── TEMPLATE MANAGEMENT MODAL ──
      '<div class="hub-tm-template-overlay" id="hub-tm-template-modal" style="display:none;" aria-hidden="true">' +
        '<div class="hub-tm-template-card">' +
          '<div class="hub-tm-template-header">' +
            '<h3 class="hub-tm-template-title">Templates</h3>' +
            '<button class="hub-tm-template-close" id="tm-btn-template-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-template-body">' +
            '<div class="hub-tm-template-list" id="hub-tm-template-list">' +
              '<p class="hub-tm-template-empty" id="hub-tm-template-empty">No saved templates</p>' +
            '</div>' +
          '</div>' +
          '<div class="hub-tm-template-footer">' +
            '<input type="text" class="hub-tm-template-name-input" id="tm-template-name" placeholder="Template name…" maxlength="30" aria-label="Template name">' +
            '<button class="hub-tm-btn hub-tm-btn-today" id="tm-btn-template-save">Save Current</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // ── SET TIME MODAL ──
      '<div class="hub-tm-modal-overlay" id="hub-tm-set-time-modal" style="display:none;" aria-hidden="true">' +
        '<div class="hub-tm-modal-card">' +
          '<div class="hub-tm-modal-header">' +
            '<h3 class="hub-tm-modal-title">Set Time Block</h3>' +
            '<button class="hub-tm-modal-close" id="tm-btn-modal-close" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="hub-tm-modal-body">' +
            '<div class="hub-tm-modal-field">' +
              '<label for="tm-input-start">Start Time</label>' +
              '<input type="time" id="tm-input-start" value="09:00">' +
            '</div>' +
            '<div class="hub-tm-modal-field">' +
              '<label for="tm-input-end">End Time</label>' +
              '<input type="time" id="tm-input-end" value="09:30">' +
            '</div>' +
            '<fieldset class="hub-tm-modal-field">' +
              '<legend>Repeat Days</legend>' +
              '<div class="hub-tm-day-checks">' +
                '<label><input type="checkbox" value="mon"> Mon</label>' +
                '<label><input type="checkbox" value="tue"> Tue</label>' +
                '<label><input type="checkbox" value="wed"> Wed</label>' +
                '<label><input type="checkbox" value="thu"> Thu</label>' +
                '<label><input type="checkbox" value="fri"> Fri</label>' +
                '<label><input type="checkbox" value="sat"> Sat</label>' +
                '<label><input type="checkbox" value="sun"> Sun</label>' +
              '</div>' +
            '</fieldset>' +
            '<div class="hub-tm-modal-field">' +
              '<button class="hub-tm-btn hub-tm-btn-today" id="tm-btn-preview">Preview</button>' +
            '</div>' +
            '<div class="hub-tm-preview-table-wrap">' +
              '<table class="hub-tm-preview-table" id="tm-preview-table">' +
                '<thead><tr><th>Day</th><th>Start</th><th>End</th><th>Duration</th><th>Del</th></tr></thead>' +
                '<tbody id="tm-preview-tbody"><tr><td colspan="4" class="hub-tm-preview-empty">Click Preview to see schedule</td></tr></tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +
          '<div class="hub-tm-modal-footer">' +
            '<button class="hub-tm-btn hub-tm-btn-today" id="tm-btn-apply-time">Apply</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // ── TIMELINE MANAGER (sliding right drawer) ──
      '<div class="hub-tm-timeline-overlay" id="hub-tm-timeline-overlay" style="display:none;"></div>' +
      '<aside class="hub-tm-timeline-drawer" id="hub-tm-timeline-drawer" aria-hidden="true">' +
        '<div class="hub-tm-timeline-drawer-header">' +
          '<h3 class="hub-tm-timeline-drawer-title">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="4" height="8" rx="1"/><rect x="13" y="6" width="4" height="12" rx="1"/></svg>' +
            'Timeline' +
          '</h3>' +
          '<button class="hub-tm-timeline-close" id="tm-btn-timeline-close" aria-label="Close timeline">&times;</button>' +
        '</div>' +
        '<div class="hub-tm-timeline-drawer-body">' +
          '<div class="hub-tm-timeline-sort-wrap">' +
            '<label class="hub-tm-timeline-sort-label" for="tm-timeline-sort">Sort by</label>' +
            '<select class="hub-tm-timeline-sort" id="tm-timeline-sort">' +
              '<option value="nearest">Nearest (Realtime)</option>' +
              '<option value="newest">Newly Added</option>' +
              '<option value="duration">Highest Duration</option>' +
            '</select>' +
          '</div>' +
          '<div class="hub-tm-timeline-list" id="hub-tm-timeline-list">' +
            '<p class="hub-tm-timeline-empty">No blocks scheduled</p>' +
          '</div>' +
        '</div>' +
      '</aside>' +
      // ── TOAST NOTIFICATION ──
      '<div class="hub-tm-toast" id="hub-tm-toast" aria-live="polite" aria-atomic="true"></div>' +
    '</section>';
  }

  function _buildTagPillsHTML() {
    var html = '';
    DEFAULT_TAGS.forEach(function (t) {
      html += '<span class="hub-tm-tag hub-tm-tag--' + t.id + '" data-tag-id="' + t.id + '" data-color="' + t.color + '" role="button" tabindex="0">' +
                '<span class="hub-tm-tag-dot"></span>' + _esc(t.label) +
              '</span>';
    });
    return html;
  }

  /* ============================================================
     BIND ALL EVENT LISTENERS
     ============================================================ */
  function _bindAll(section) {
    _bindTagManager(section);
    _bindDateControls(section);
    _bindFocusMode(section);
    _bindGridClicks(section);
    _bindAddTagForm(section);
    _bindBlockInteractions(section);
    _bindEscKey(section);
    _bindSetTimeModal(section);
    _bindBlockDetailsModal(section);
    _bindTimelinePanel(section);
    _bindConfirmModal(section);
    _bindTemplateModal(section);
    _bindViewSwitcher(section);
    _bindSettingsModal(section);
  }

  /* ── Tag Selection ── */
  function _bindTagManager(section) {
    // Use event delegation on the tag manager so custom tags work too
    var manager = section.querySelector('#hub-tm-tag-manager');
    if (!manager) return;

    manager.addEventListener('click', function (e) {
      var tagEl = e.target.closest('.hub-tm-tag');
      if (!tagEl) return;

      // If user clicked the delete button inside a custom tag, let that handler run
      if (e.target.closest('.hub-tm-tag-delete')) return;

      _activeTagId = tagEl.getAttribute('data-tag-id');
      _setActiveTag(_activeTagId);
      _saveAll();
    });
  }

  function _setActiveTag(tagId) {
    var allTags = document.querySelectorAll('#hub-tm-tag-manager .hub-tm-tag');
    for (var i = 0; i < allTags.length; i++) {
      allTags[i].classList.remove('hub-tm-tag--active');
      allTags[i].style.opacity = '0.5';
      allTags[i].style.filter = '';
    }
    var activeEl = document.querySelector('#hub-tm-tag-manager .hub-tm-tag[data-tag-id="' + tagId + '"]');
    if (activeEl) {
      activeEl.classList.add('hub-tm-tag--active');
      activeEl.style.opacity = '1';
      activeEl.style.filter = 'brightness(1.2)';
    }
  }

  /* ── Date Controls ── */
  function _bindDateControls(section) {
    var picker = section.querySelector('#tm-date-picker');
    var todayBtn = section.querySelector('#tm-btn-today');
    var prevBtn  = section.querySelector('#tm-btn-prev');
    var nextBtn  = section.querySelector('#tm-btn-next');

    if (todayBtn) {
      todayBtn.addEventListener('click', function () {
        _currentDate = _todayStr();
        _setDateUI(new Date());
        _renderAllBlocks();
        if (_currentView !== 'day') renderGridStructure(_currentView);
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        var d = new Date(_currentDate + 'T00:00:00');
        if (_currentView === 'week') {
          d.setDate(d.getDate() - 7);
        } else if (_currentView === 'month') {
          d.setMonth(d.getMonth() - 1);
        } else {
          d.setDate(d.getDate() - 1);
        }
        _currentDate = _dateToStr(d);
        _setDateUI(d);
        _renderAllBlocks();
        if (_currentView !== 'day') renderGridStructure(_currentView);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var d = new Date(_currentDate + 'T00:00:00');
        if (_currentView === 'week') {
          d.setDate(d.getDate() + 7);
        } else if (_currentView === 'month') {
          d.setMonth(d.getMonth() + 1);
        } else {
          d.setDate(d.getDate() + 1);
          if (d.getTime() > Date.now() + 86400000) return;
        }
        _currentDate = _dateToStr(d);
        _setDateUI(d);
        renderGridStructure(_currentView);
        if (_currentView === 'day') _renderAllBlocks();
      });
    }

    if (picker) {
      picker.addEventListener('change', function () {
        var val = picker.value;
        if (val) {
          var dt = new Date(val + 'T00:00:00');
          if (!isNaN(dt.getTime())) {
            _currentDate = val;
            _setDateUI(dt);
            _renderAllBlocks();
            if (_currentView !== 'day') renderGridStructure(_currentView);
          }
        }
      });
    }
  }

  function _setDateUI(d) {
    var picker = document.getElementById('tm-date-picker');
    if (picker) {
      picker.value = _dateToStr(d);
    }
    _currentDate = _dateToStr(d);
    // Update grid header
    var dayEl = document.getElementById('hub-tm-col-day-name');
    var dateEl = document.getElementById('hub-tm-col-date-num');
    if (dayEl) dayEl.textContent = _dayName(d);
    if (dateEl) dateEl.textContent = _dateLabel(d);
  }

  /* ── Focus Mode ── */
  function _bindFocusMode(section) {
    var toggleBtn = section.querySelector('#tm-btn-focus-mode');
    var exitBtn   = section.querySelector('#tm-btn-focus-exit');
    var panel     = section.querySelector('#hub-tm-focus-panel');
    if (!toggleBtn || !exitBtn || !panel) return;

    toggleBtn.addEventListener('click', function () {
      _populateFocusPanel(panel);
      panel.setAttribute('aria-hidden', 'false');
    });

    exitBtn.addEventListener('click', function () {
      panel.setAttribute('aria-hidden', 'true');
    });

    var backdrop = panel.querySelector('.hub-tm-focus-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        panel.setAttribute('aria-hidden', 'true');
      });
    }
  }

  function _populateFocusPanel(panel) {
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var currentBlock = _blocksForDate(_currentDate).find(function (b) {
      var start = _timeToMins(b.startTime);
      var end   = _timeToMins(b.endTime);
      return nowMins >= start && nowMins < end;
    });

    var timeEl = panel.querySelector('.hub-tm-focus-time');
    var titleEl = panel.querySelector('.hub-tm-focus-title');
    var tagEl = panel.querySelector('.hub-tm-focus-tag');
    var subtitleEl = panel.querySelector('.hub-tm-focus-subtitle');
    var fillEl = panel.querySelector('.hub-tm-focus-progress-fill');
    var labelEl = panel.querySelector('.hub-tm-focus-progress-label');

    if (currentBlock) {
      var tag = _tagById(currentBlock.tagId);
      var startM = _timeToMins(currentBlock.startTime);
      var endM   = _timeToMins(currentBlock.endTime);
      var pct = Math.min(100, Math.round(((nowMins - startM) / (endM - startM)) * 100));
      var rem = endM - nowMins;
      var remH = Math.floor(rem / 60);
      var remMn = rem % 60;

      if (timeEl) timeEl.textContent = currentBlock.startTime + ' - ' + currentBlock.endTime;
      if (titleEl) titleEl.textContent = currentBlock.title || 'Untitled';
      if (tagEl) {
        tagEl.textContent = tag ? tag.label : currentBlock.tagId;
        tagEl.className = 'hub-tm-focus-tag';
        var tagCls = _tagClass(currentBlock.tagId);
        if (tagCls) tagEl.classList.add(tagCls);
      }
      if (subtitleEl) subtitleEl.textContent = currentBlock.subtitle || '';
      if (fillEl) fillEl.style.width = pct + '%';
      if (labelEl) labelEl.textContent = pct + '% complete  ·  ' + remH + 'h ' + remMn + 'm remaining';
    } else {
      if (timeEl) timeEl.textContent = '';
      if (titleEl) titleEl.textContent = 'No active block';
      if (tagEl) { tagEl.textContent = ''; tagEl.className = 'hub-tm-focus-tag'; }
      if (subtitleEl) subtitleEl.textContent = 'You\'re free right now.';
      if (fillEl) fillEl.style.width = '0%';
      if (labelEl) labelEl.textContent = 'No scheduled time block';
    }
  }

  /* ── DRAG-TO-CREATE (Google Calendar style, mouse + touch) ── */
  var _dragState = {
    ghostBlock: null,
    dragStartSlot: null,
    dragStartMins: 0,
    isDragging: false,
    dragScrollTimer: null
  };

  function _bindGridClicks(section) {
    var mainCol = section.querySelector('#hub-tm-main-col');
    if (!mainCol) return;
    var scroller = mainCol.closest('.hub-tm-grid-scroll');

    // ── Coordinate normalisation ──
    function _getClientY(e) {
      return e.touches ? e.touches[0].clientY : e.clientY;
    }

    // ── Auto-scroll when pointer near edges ──
    function startAutoScroll(e) {
      if (!scroller || _dragState.dragScrollTimer) return;
      _dragState.dragScrollTimer = setInterval(function () {
        var rect = scroller.getBoundingClientRect();
        var edge = 60;
        var relY = _getClientY(e) - rect.top;
        if (relY < edge && relY > 0) {
          scroller.scrollTop = Math.max(0, scroller.scrollTop - 5);
        } else if (relY > rect.height - edge && relY < rect.height) {
          scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + 5);
        }
      }, 16);
    }

    function stopAutoScroll() {
      if (_dragState.dragScrollTimer) {
        clearInterval(_dragState.dragScrollTimer);
        _dragState.dragScrollTimer = null;
      }
    }

    // ── Shared: start ghost block ──
    function beginDrag(e) {
      var slotEl = e.target.closest('.hub-tm-slot');
      if (!slotEl) return;
      if (e.target.closest('.hub-tm-block')) return;

      _dragState.isDragging     = true;
      _dragState.dragStartSlot  = slotEl;
      _dragState.dragStartMins  = _timeToMins(slotEl.getAttribute('data-time'));

      var stMins = _dragState.dragStartMins;
      var tag = _tagById(_activeTagId) || DEFAULT_TAGS[0];
      var ghost = document.createElement('div');
      ghost.className = 'hub-tm-block hub-tm-block--ghost';
      ghost.style.top    = Math.round((stMins / 60) * HOUR_H) + 'px';
      ghost.style.height = HOUR_H / 2 + 'px';
      ghost.innerHTML =
        '<div class="hub-tm-block-content">' +
          '<span class="hub-tm-block-time" id="ghost-time-label">' +
            _esc(_minsToTime(stMins)) + ' – ' + _esc(_minsToTime(stMins + 30)) +
          '</span>' +
          '<span class="hub-tm-block-title">' + _esc(tag.label) + '</span>' +
          '<span class="hub-tm-block-subtitle">Drag to set duration</span>' +
        '</div>';
      mainCol.appendChild(ghost);
      _dragState.ghostBlock = ghost;
    }

    // ── Shared: resize ghost ──
    function moveDrag(e) {
      if (!_dragState.isDragging || !_dragState.ghostBlock) return;

      var clientY = _getClientY(e);
      var endMins;

      // Use elementFromPoint so touch works (e.target is the original touchstart element)
      var cx = e.clientX || (e.touches && e.touches[0].clientX);
      var pointEl = document.elementFromPoint(cx, clientY);
      var slotEl = pointEl ? pointEl.closest('.hub-tm-slot') : null;

      if (slotEl) {
        var slotMins = _timeToMins(slotEl.getAttribute('data-time'));
        endMins = Math.max(_dragState.dragStartMins + 30, slotMins + 30);
      } else {
        var mainRect = mainCol.getBoundingClientRect();
        var scrollTop = scroller ? scroller.scrollTop : 0;
        var relY = clientY - mainRect.top + scrollTop;
        var approxMins = Math.max(0, Math.floor((relY / HOUR_H) * 60));
        endMins = Math.min(1440, Math.max(_dragState.dragStartMins + 30,
          Math.ceil(approxMins / 30) * 30));
      }
      endMins = Math.min(1440, endMins);

      _updateGhost(_dragState.ghostBlock, _dragState.dragStartMins, endMins);
      startAutoScroll(e);
    }

    // ── Shared: commit block ──
    function endDrag() {
      if (!_dragState.isDragging) return;
      _dragState.isDragging = false;
      stopAutoScroll();

      var gh        = _dragState.ghostBlock;
      var startMins = _dragState.dragStartMins;

      if (gh) {
        var lbl = gh.querySelector('#ghost-time-label');
        var endMins = startMins + 30;
        if (lbl) {
          var raw = lbl.textContent.split(' – ');
          endMins = _timeToMins(raw[1]) || (startMins + 30);
        }

        if (gh.parentNode) gh.parentNode.removeChild(gh);
        _dragState.ghostBlock = null;

        var duration = Math.max(30, endMins - startMins);
        _createNewBlock(startMins, duration);
      }

      _dragState.dragStartSlot = null;
    }

    // ── MOUSE LISTENERS ──
    mainCol.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      beginDrag(e);
    });

    mainCol.addEventListener('mousemove', function (e) {
      moveDrag(e);
    });

    document.addEventListener('mouseup', endDrag);

    // ── TOUCH LISTENERS (mobile) ──
    mainCol.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      beginDrag(e.touches[0]);
    }, { passive: false });

    mainCol.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      moveDrag(e);
    }, { passive: false });

    document.addEventListener('touchend', function (e) {
      endDrag();
    });
  }

  /* ── Ghost block visual update ── */
  function _updateGhost(ghost, startMins, endMins) {
    var topPx    = (startMins / 60) * HOUR_H;
    var heightPx = Math.max(SLOT_H, ((endMins - startMins) / 60) * HOUR_H);

    ghost.style.top    = Math.round(topPx) + 'px';
    ghost.style.height = Math.round(heightPx) + 'px';

    var lbl = ghost.querySelector('#ghost-time-label');
    if (lbl) {
      lbl.textContent = _minsToTime(startMins) + ' – ' + _minsToTime(endMins);
    }
  }

  /* ── Commit a real block from drag params ── */
  function _createNewBlock(startMinutes, durationMinutes) {
    var endMinutes = Math.min(1440, startMinutes + durationMinutes);

    // Collision check
    var dateBlocks = _blocksForDate(_currentDate);
    for (var i = 0; i < dateBlocks.length; i++) {
      var bStart = _timeToMins(dateBlocks[i].startTime);
      var bEnd   = _timeToMins(dateBlocks[i].endTime);
      if (startMinutes < bEnd && endMinutes > bStart) return;
    }

    var tag     = _tagById(_activeTagId) || DEFAULT_TAGS[0];
    var blockId = 'blk-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

    var block = {
      id:        blockId,
      date:      _currentDate,
      tagId:     tag.id,
      startTime: _minsToTime(startMinutes),
      endTime:   _minsToTime(endMinutes),
      title:     tag.label,
      subtitle:  ''
    };

    _timeBlocks.push(block);
    _saveAll();
    _renderBlock(block, document.getElementById('hub-tm-main-col'));
  }

  /* ── Open block details modal ── */
  function _openBlockDetails(block) {
    var modal = document.getElementById('hub-tm-details-modal');
    if (!modal) return;

    // Store block ID on modal
    modal.setAttribute('data-editing-block-id', block.id);

    // Time display
    var timeEl = document.getElementById('hub-tm-details-time');
    if (timeEl) timeEl.textContent = block.startTime + ' – ' + block.endTime;

    // Title
    var titleInput = document.getElementById('tm-details-title');
    if (titleInput) titleInput.value = block.title || '';

    // Description (rich text editor)
    var descEditor = document.getElementById('block-desc-editor');
    if (descEditor) descEditor.innerHTML = block.subtitle || '';

    // Tag picker
    var tagsContainer = document.getElementById('hub-tm-details-tags');
    if (tagsContainer) {
      var allTags = _allTags();
      var html = '';
      for (var i = 0; i < allTags.length; i++) {
        var t  = allTags[i];
        var isActive = (t.id === block.tagId);
        html += '<span class="hub-tm-details-tag-pick' + (isActive ? ' hub-tm-details-tag-pick--active' : '') + '" data-tag-id="' + t.id + '" role="button" tabindex="0">' +
                  '<span class="hub-tm-tag-dot" style="background:' + _esc(t.color) + ';box-shadow:0 0 6px ' + _esc(t.color) + ';"></span>' +
                  _esc(t.label) +
                '</span>';
      }
      tagsContainer.innerHTML = html;

      // Wire tag picker clicks
      var picks = tagsContainer.querySelectorAll('.hub-tm-details-tag-pick');
      for (var j = 0; j < picks.length; j++) {
        picks[j].addEventListener('click', function () {
          var siblings = this.parentNode.querySelectorAll('.hub-tm-details-tag-pick');
          for (var s = 0; s < siblings.length; s++) {
            siblings[s].classList.remove('hub-tm-details-tag-pick--active');
          }
          this.classList.add('hub-tm-details-tag-pick--active');
        });
      }
    }

    // Show modal
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }

  /* ── Delete Button on blocks ── */
  function _bindBlockInteractions(section) {
    var mainCol = section.querySelector('#hub-tm-main-col');
    if (!mainCol) return;

    mainCol.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.hub-tm-block-delete');
      if (delBtn) {
        e.stopPropagation();
        var blockEl = delBtn.closest('.hub-tm-block');
        if (!blockEl) return;
        var blockId = blockEl.getAttribute('data-block-id');
        for (var i = 0; i < _timeBlocks.length; i++) {
          if (_timeBlocks[i].id === blockId) {
            _timeBlocks.splice(i, 1);
            break;
          }
        }
        _saveAll();
        if (blockEl.parentNode) blockEl.parentNode.removeChild(blockEl);
        return;
      }

      // Click on a block itself → open details modal
      var blockEl = e.target.closest('.hub-tm-block');
      if (blockEl) {
        var blockId = blockEl.getAttribute('data-block-id');
        var block = null;
        for (var bi = 0; bi < _timeBlocks.length; bi++) {
          if (_timeBlocks[bi].id === blockId) { block = _timeBlocks[bi]; break; }
        }
        if (block) _openBlockDetails(block);
      }
    });
  }

  /* ── Add Tag Form ── */
  function _bindAddTagForm(section) {
    var form = section.querySelector('#hub-tm-add-tag-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var nameInput = form.querySelector('#hub-tm-add-tag-name');
      var colorInput = form.querySelector('#hub-tm-add-tag-color');
      var opacityInput = form.querySelector('#hub-tm-add-tag-opacity');

      if (!nameInput || !colorInput || !opacityInput) return;
      var name = nameInput.value.trim();
      if (!name) return;

      var color = colorInput.value || '#00bcd4';
      var opacity = Math.min(100, Math.max(20, parseInt(opacityInput.value, 10) || 85));
      var tagId = 'custom-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

      var newTag = {
        id:      tagId,
        label:   name,
        color:   color,
        opacity: opacity
      };

      _customTags.push(newTag);
      _saveAll();
      _renderOneCustomTagPill(newTag);
      _setActiveTag(tagId);

      nameInput.value = '';
      colorInput.value = '#00bcd4';
      opacityInput.value = '85';
    });
  }

  /* ── Delete Custom Tag ── */
  function _bindCustomTagDelete(tagEl, tagId) {
    var delBtn = tagEl.querySelector('.hub-tm-tag-delete');
    if (!delBtn) return;
    delBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      for (var i = 0; i < _customTags.length; i++) {
        if (_customTags[i].id === tagId) {
          _customTags.splice(i, 1);
          break;
        }
      }
      _saveAll();
      if (tagEl && tagEl.parentNode) tagEl.parentNode.removeChild(tagEl);

      // Fall back to 'work' if the deleted tag was active
      if (_activeTagId === tagId) {
        _activeTagId = 'work';
        _setActiveTag('work');
        _saveAll();
      }
    });
  }

  /* ── SET TIME MODAL (Open / Preview / Apply) ── */
  function _bindSetTimeModal(section) {
    var modal    = section.querySelector('#hub-tm-set-time-modal');
    var openBtn  = section.querySelector('#tm-btn-set-time');
    var closeBtn = section.querySelector('#tm-btn-modal-close');
    var previewBtn = section.querySelector('#tm-btn-preview');
    var applyBtn = section.querySelector('#tm-btn-apply-time');

    if (!modal || !openBtn) return;

    // Open
    openBtn.addEventListener('click', function () {
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    });

    // Close helpers
    function closeModal() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        var focusPanel = section.querySelector('#hub-tm-focus-panel');
        if (focusPanel && focusPanel.getAttribute('aria-hidden') === 'false') return;
        closeModal();
      }
    });

    // Preview
    if (previewBtn) {
      previewBtn.addEventListener('click', function () {
        _previewTimeTable(section);
      });
    }

    // Apply
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        _applyTimeBlock(section);
        closeModal();
      });
    }
  }

  /* ── Fill the preview table with selected days × start/end ── */
  function _previewTimeTable(section) {
    var startInput = section.querySelector('#tm-input-start');
    var endInput   = section.querySelector('#tm-input-end');
    var tbody      = section.querySelector('#tm-preview-tbody');

    if (!startInput || !endInput || !tbody) return;

    var startTime = startInput.value;
    var endTime   = endInput.value;
    if (!startTime || !endTime) return;

    var startM = _timeToMins(startTime);
    var endM   = _timeToMins(endTime);
    if (endM <= startM) { endM = startM + 30; endInput.value = _minsToTime(endM); }

    var dayLabels = {
      mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
      fri: 'Friday', sat: 'Saturday', sun: 'Sunday'
    };

    var checks = section.querySelectorAll('#hub-tm-set-time-modal input[type="checkbox"]:checked');
    // If no day checked, treat as today
    if (checks.length === 0) {
      var todayKey = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
      checks = [{ value: todayKey }];
    }

    var rows = '';
    for (var i = 0; i < checks.length; i++) {
      var dayKey = checks[i].value || checks[i];
      var dayName = dayLabels[dayKey] || dayKey;
      var durMins = endM - startM;
      var durLabel = Math.floor(durMins / 60) + 'h ' + (durMins % 60) + 'm';
      rows += '<tr>' +
        '<td>' + _esc(dayName) + '</td>' +
        '<td>' + _esc(_minsToTime(startM)) + '</td>' +
        '<td>' + _esc(_minsToTime(endM)) + '</td>' +
        '<td>' + durLabel + '</td>' +
        '<td><button class="hub-tm-preview-delete" title="Remove">&times;</button></td>' +
      '</tr>';
    }

    tbody.innerHTML = rows;

    // Wire delete buttons inside preview table
    var delBtns = tbody.querySelectorAll('.hub-tm-preview-delete');
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener('click', function () {
        var row = this.closest('tr');
        if (!row) return;
        var dayCell = row.querySelector('td');
        var dayName = dayCell ? dayCell.textContent.trim() : 'this entry';
        _showConfirmModal('Remove "' + dayName + '" from the schedule?', function () {
          if (row && row.parentNode) row.remove();
        });
      });
    }
  }

  /* ── Create block(s) from preview table rows ── */
  function _applyTimeBlock(section) {
    var tbody = section.querySelector('#tm-preview-tbody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    if (!rows.length) return;

    var dayMap = {
      'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4,
      'Friday': 5, 'Saturday': 6, 'Sunday': 0
    };
    var todayDT = new Date(_currentDate + 'T00:00:00');

    var tag = _tagById(_activeTagId) || DEFAULT_TAGS[0];
    var added = 0;

    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].querySelectorAll('td');
      if (cells.length < 4) continue;

      var dayName   = (cells[0].textContent || '').trim();
      var startTime = (cells[1].textContent || '').trim();
      var endTime   = (cells[2].textContent || '').trim();

      var startM = _timeToMins(startTime);
      var endM   = _timeToMins(endTime);
      if (endM <= startM) continue;

      var targetDay = dayMap[dayName];
      if (targetDay === undefined) continue;

      var todayDay = todayDT.getDay();
      var diff = targetDay - todayDay;
      if (diff < 0) diff += 7; // next week
      var blockDate = new Date(todayDT);
      blockDate.setDate(todayDT.getDate() + diff);
      var blockDateStr = _dateToStr(blockDate);

      var blockId = 'blk-' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '-' + r;

      var block = {
        id:        blockId,
        date:      blockDateStr,
        tagId:     tag.id,
        startTime: _minsToTime(startM),
        endTime:   _minsToTime(endM),
        title:     tag.label,
        subtitle:  ''
      };

      _timeBlocks.push(block);
      added++;
    }

    if (added > 0) {
      _saveAll();
      _renderAllBlocks();
    }
  }

  /* ── CONFIRM DELETE MODAL ── */
  let _confirmCallback = null;

  function _showConfirmModal(message, callback) {
    var modal = document.getElementById('hub-tm-confirm-modal');
    if (!modal) { if (typeof callback === 'function') callback(); return; } // fallback

    var msgEl = document.getElementById('hub-tm-confirm-msg');
    if (msgEl) msgEl.textContent = message || 'Are you sure?';

    _confirmCallback = callback || null;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    // Focus the cancel button for safety
    var cancelBtn = document.getElementById('tm-btn-confirm-cancel');
    if (cancelBtn) cancelBtn.focus();
  }

  function _bindConfirmModal(section) {
    var modal    = section.querySelector('#hub-tm-confirm-modal');
    var cancelBtn = section.querySelector('#tm-btn-confirm-cancel');
    var deleteBtn = section.querySelector('#tm-btn-confirm-delete');

    if (!modal) return;

    function closeConfirm() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      _confirmCallback = null;
    }

    if (cancelBtn) cancelBtn.addEventListener('click', closeConfirm);

    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        if (typeof _confirmCallback === 'function') {
          _confirmCallback();
        }
        closeConfirm();
      });
    }

    // Backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeConfirm();
    });

    // ESC
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeConfirm();
      }
    });
  }

/* ── BLOCK DETAILS MODAL (open/save/delete/close) ── */
  function _bindBlockDetailsModal(section) {
    var modal    = section.querySelector('#hub-tm-details-modal');
    var closeBtn = section.querySelector('#tm-btn-details-close');
    var saveBtn  = section.querySelector('#tm-btn-details-save');
    var delBtn   = section.querySelector('#tm-btn-details-delete');

    if (!modal) return;

    function closeDetails() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    // Close button
    if (closeBtn) closeBtn.addEventListener('click', closeDetails);

    // Backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeDetails();
    });

    // ── Rich text toolbar binding ──
    var toolbar = modal.querySelector('.hub-tm-rich-toolbar');
    if (toolbar) {
      toolbar.addEventListener('click', function (e) {
        var btn = e.target.closest('.hub-tm-rich-btn');
        if (!btn) return;
        e.preventDefault();
        var cmd = btn.getAttribute('data-cmd');
        var editor = document.getElementById('block-desc-editor');
        if (!editor) return;

        if (cmd === 'bold') {
          document.execCommand('bold', false, null);
        } else if (cmd === 'italic') {
          document.execCommand('italic', false, null);
        } else if (cmd === 'underline') {
          document.execCommand('underline', false, null);
        } else if (cmd === 'indent') {
          document.execCommand('indent', false, null);
        } else if (cmd === 'outdent') {
          document.execCommand('outdent', false, null);
        }
        editor.focus();
      });

      // Color picker
      var colorPicker = toolbar.querySelector('#hub-tm-rich-color');
      if (colorPicker) {
        colorPicker.addEventListener('input', function () {
          var editor = document.getElementById('block-desc-editor');
          if (editor) {
            editor.focus();
            document.execCommand('foreColor', false, colorPicker.value);
          }
        });
      }
    }

    // Save
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var blockId = modal.getAttribute('data-editing-block-id');
        if (!blockId) return;

        var idx = -1;
        for (var i = 0; i < _timeBlocks.length; i++) {
          if (_timeBlocks[i].id === blockId) { idx = i; break; }
        }
        if (idx === -1) return;

        var titleInput = section.querySelector('#tm-details-title');
        var descEditor = section.querySelector('#block-desc-editor');
        var activePick = section.querySelector('#hub-tm-details-tags .hub-tm-details-tag-pick--active');

        _timeBlocks[idx].title    = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : _timeBlocks[idx].title;
        _timeBlocks[idx].subtitle = (descEditor && descEditor.innerHTML.trim()) ? descEditor.innerHTML.trim() : '';
        if (activePick) {
          _timeBlocks[idx].tagId = activePick.getAttribute('data-tag-id');
        }

        _saveAll();
        _renderAllBlocks();
        closeDetails();
      });
    }

    // Delete (with custom confirmation modal)
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        var blockId = modal.getAttribute('data-editing-block-id');
        if (!blockId) return;

        var block = null;
        for (var i = 0; i < _timeBlocks.length; i++) {
          if (_timeBlocks[i].id === blockId) { block = _timeBlocks[i]; break; }
        }
        var msg = 'Delete "' + (block ? (block.title || block.tagId) : 'this block') + '"?';

        _showConfirmModal(msg, function () {
          for (var j = 0; j < _timeBlocks.length; j++) {
            if (_timeBlocks[j].id === blockId) {
              _timeBlocks.splice(j, 1);
              break;
            }
          }
          _saveAll();
          _renderAllBlocks();
        });
        closeDetails();
      });
    }

    // ESC key (merged into existing ESC handler)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeDetails();
      }
    });
  }

/* ── TIMELINE MANAGER (sliding drawer) ── */
  function reconstructTimeline(type) {
    console.log('[Timeline] reconstruct:', type);
    var blocks = _timeBlocks.slice();

    if (type === 'nearest') {
      blocks.sort(function (a, b) {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return _timeToMins(a.startTime) - _timeToMins(b.startTime);
      });
    } else if (type === 'newest') {
      blocks.sort(function (a, b) {
        return b.id.localeCompare(a.id);
      });
    } else if (type === 'duration') {
      blocks.sort(function (a, b) {
        var durA = _timeToMins(b.endTime) - _timeToMins(b.startTime);
        var durB = _timeToMins(a.endTime) - _timeToMins(a.startTime);
        return durA - durB;
      });
    }
    return blocks;
  }

  function _renderTimeline(blocks) {
    var list = document.getElementById('hub-tm-timeline-list');
    if (!list) return;

    if (!blocks || !blocks.length) {
      list.innerHTML = '<p class="hub-tm-timeline-empty">No blocks scheduled</p>';
      return;
    }

    // Group blocks by date
    var groups = {};
    for (var i = 0; i < blocks.length; i++) {
      var d = blocks[i].date;
      if (!groups[d]) groups[d] = [];
      groups[d].push(blocks[i]);
    }

    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = '';
    var dates = Object.keys(groups).sort();

    for (var g = 0; g < dates.length; g++) {
      var dateStr = dates[g];
      var dateBlocks = groups[dateStr];
      var dt = new Date(dateStr + 'T00:00:00');

      html += '<div class="hub-tm-timeline-day-group">';
      html += '<div class="hub-tm-timeline-day-heading">';
      html += '<span class="hub-tm-timeline-day-name">' + _esc(days[dt.getDay()]) + '</span>';
      html += '<span class="hub-tm-timeline-day-date">' + _esc(_dateLabel(dt)) + '</span>';
      html += '<span class="hub-tm-timeline-day-count">' + dateBlocks.length + ' block' + (dateBlocks.length > 1 ? 's' : '') + '</span>';
      html += '</div>';

      for (var b = 0; b < dateBlocks.length; b++) {
        var block = dateBlocks[b];
        var tag = _tagById(block.tagId);
        html += '<div class="hub-tm-timeline-event" data-block-id="' + _esc(block.id) + '">';
        html += '<span class="hub-tm-tag-dot" style="background:' + (tag ? _esc(tag.color) : '#888') + ';"></span>';
        html += '<span class="hub-tm-timeline-event-time">' + _esc(block.startTime) + ' – ' + _esc(block.endTime) + '</span>';
        html += '<span class="hub-tm-timeline-event-title">' + _esc(block.title || block.tagId) + '</span>';
        var dur = _timeToMins(block.endTime) - _timeToMins(block.startTime);
        html += '<span class="hub-tm-timeline-event-dur">' + Math.floor(dur / 60) + 'h ' + (dur % 60) + 'm</span>';
        html += '<button class="hub-tm-timeline-delete" aria-label="Delete block" title="Delete block">&times;</button>';
        html += '</div>';
      }
      html += '</div>';
    }

    list.innerHTML = html;
  }

  function _bindTimelinePanel(section) {
    var toggleBtn = section.querySelector('#tm-btn-timeline');
    var drawer    = section.querySelector('#hub-tm-timeline-drawer');
    var overlay   = section.querySelector('#hub-tm-timeline-overlay');
    var closeBtn  = section.querySelector('#tm-btn-timeline-close');
    var sortEl    = section.querySelector('#tm-timeline-sort');

    if (!toggleBtn || !drawer) return;

    function openDrawer() {
      if (overlay) overlay.style.display = 'block';
      drawer.setAttribute('aria-hidden', 'false');
      drawer.classList.add('hub-tm-timeline-drawer--open');
      var sortType = sortEl ? sortEl.value : 'nearest';
      _renderTimeline(reconstructTimeline(sortType));
    }

    function closeDrawer() {
      if (overlay) overlay.style.display = 'none';
      drawer.setAttribute('aria-hidden', 'true');
      drawer.classList.remove('hub-tm-timeline-drawer--open');
    }

    toggleBtn.addEventListener('click', openDrawer);

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    if (overlay) {
      overlay.addEventListener('click', closeDrawer);
    }

    if (sortEl) {
      sortEl.addEventListener('change', function () {
        _renderTimeline(reconstructTimeline(sortEl.value));
      });
    }

    // Event delegation for quick-delete "X" buttons inside the timeline list
    var listEl = section.querySelector('#hub-tm-timeline-list');
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var delBtn = e.target.closest('.hub-tm-timeline-delete');
        if (!delBtn) return;
        e.stopPropagation();

        var eventRow = delBtn.closest('.hub-tm-timeline-event');
        var blockId  = eventRow ? eventRow.getAttribute('data-block-id') : null;
        if (!blockId) return;

        // Find the block for a nice confirmation message
        var block = null;
        for (var i = 0; i < _timeBlocks.length; i++) {
          if (_timeBlocks[i].id === blockId) { block = _timeBlocks[i]; break; }
        }
        var msg = 'Delete "' + (block ? (block.title || block.tagId) : 'this block') + '"?';
        _showConfirmModal(msg, function () {
          // Remove block from array
          for (var j = 0; j < _timeBlocks.length; j++) {
            if (_timeBlocks[j].id === blockId) {
              _timeBlocks.splice(j, 1);
              break;
            }
          }
          _saveAll();
          _renderAllBlocks();
          // Re-render the timeline
          var sortType = sortEl ? sortEl.value : 'nearest';
          _renderTimeline(reconstructTimeline(sortType));
        });
      });
    }
  }

/* ── ESC key dismiss focus panel ── */
  function _bindEscKey(section) {
    document.addEventListener('keydown', function (e) {
      var panel = section.querySelector('#hub-tm-focus-panel');
      if (e.key === 'Escape' && panel && panel.getAttribute('aria-hidden') === 'false') {
        panel.setAttribute('aria-hidden', 'true');
      }
    });
  }

  /* ============================================================
     TEMPLATE MANAGEMENT (Load & Save)
     ============================================================ */
  function _loadTemplates() {
    try {
      var raw = localStorage.getItem(TEMPLATE_KEY);
      if (raw) _templates = JSON.parse(raw);
    } catch (_) { _templates = []; }
  }

  function _saveTemplates() {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(_templates)); } catch (_) {}
  }

  function _renderTemplateList() {
    var list = document.getElementById('hub-tm-template-list');
    if (!list) return;

    if (!_templates.length) {
      list.innerHTML = '<p class="hub-tm-template-empty" id="hub-tm-template-empty">No saved templates</p>';
      return;
    }

    var html = '';
    for (var i = 0; i < _templates.length; i++) {
      var t = _templates[i];
      var blockCount = t.blocks ? t.blocks.length : 0;
      html += '<div class="hub-tm-template-item">' +
        '<div class="hub-tm-template-item-info">' +
          '<span class="hub-tm-template-item-name">' + _escapeHtml(t.name) + '</span>' +
          '<span class="hub-tm-template-item-count">' + blockCount + ' block' + (blockCount !== 1 ? 's' : '') + '</span>' +
        '</div>' +
        '<div class="hub-tm-template-item-actions">' +
          '<button class="hub-tm-template-item-btn-load" data-tm-idx="' + i + '">Load</button>' +
          '<button class="hub-tm-template-item-btn-delete" data-tm-idx="' + i + '">&times;</button>' +
        '</div>' +
      '</div>';
    }
    list.innerHTML = html;

    // Wire load buttons
    var loadBtns = list.querySelectorAll('.hub-tm-template-item-btn-load');
    for (var li = 0; li < loadBtns.length; li++) {
      loadBtns[li].addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-tm-idx'), 10);
        _applyTemplate(idx);
      });
    }

    // Wire delete buttons
    var delBtns = list.querySelectorAll('.hub-tm-template-item-btn-delete');
    for (var di = 0; di < delBtns.length; di++) {
      delBtns[di].addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-tm-idx'), 10);
        var name = _templates[idx] ? _templates[idx].name : 'this template';
        _showConfirmModal('Delete template "' + name + '"?', function () {
          _templates.splice(idx, 1);
          _saveTemplates();
          _renderTemplateList();
        });
      });
    }
  }

  function _applyTemplate(idx) {
    var template = _templates[idx];
    if (!template || !template.blocks) return;

    // Remove current day's blocks
    _timeBlocks = _timeBlocks.filter(function (b) { return b.date !== _currentDate; });

    // Add template blocks assigned to current date with fresh IDs
    for (var i = 0; i < template.blocks.length; i++) {
      var src = template.blocks[i];
      var block = {
        id:        'blk-' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '-' + i,
        date:      _currentDate,
        tagId:     src.tagId || 'work',
        startTime: src.startTime,
        endTime:   src.endTime,
        title:     src.title || '',
        subtitle:  src.subtitle || ''
      };
      _timeBlocks.push(block);
    }

    _saveAll();
    _renderAllBlocks();
    _showToast('Template Loaded Successfully');

    // Close template modal
    var modal = document.getElementById('hub-tm-template-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function _bindTemplateModal(section) {
    var loadBtn = section.querySelector('#tm-btn-load-template');
    var saveBtn = section.querySelector('#tm-btn-save-template');
    var modal   = section.querySelector('#hub-tm-template-modal');
    var closeBtn = section.querySelector('#tm-btn-template-close');

    if (!modal) return;

    function openModal() {
      _loadTemplates();
      _renderTemplateList();
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    if (loadBtn) loadBtn.addEventListener('click', openModal);

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });

    // Save Current
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var nameInput = document.getElementById('tm-template-name');
        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) { nameInput && nameInput.focus(); return; }

        var currentBlocks = _blocksForDate(_currentDate);
        _templates.push({
          name: name,
          blocks: currentBlocks.slice(),
          createdAt: Date.now()
        });
        _saveTemplates();
        _renderTemplateList();
        if (nameInput) nameInput.value = '';
      });
    }
  }

/* ── VIEW SWITCHER (Day / Week / Month — renders grid structure) ── */
  var _currentView = 'day';

  function _bindViewSwitcher(section) {
    var switcher = section.querySelector('#hub-tm-view-switcher');
    if (!switcher) return;

    function setActive(btn) {
      var allBtns = switcher.querySelectorAll('.hub-tm-view-btn');
      for (var i = 0; i < allBtns.length; i++) {
        allBtns[i].classList.remove('hub-tm-view-btn--active');
        allBtns[i].style.background = '';
        allBtns[i].style.color = '';
      }
      btn.classList.add('hub-tm-view-btn--active');
      btn.style.background = 'var(--accent-primary, #00f0ff)';
      btn.style.color = '#000';
    }

    switcher.addEventListener('click', function (e) {
      var btn = e.target.closest('.hub-tm-view-btn');
      if (!btn) return;

      var view = btn.getAttribute('data-view');
      setActive(btn);
      _currentView = view;
      try { localStorage.setItem('hub_tm_view', view); } catch (_) {}
      renderGridStructure(view);
    });

    var savedView;
    try { savedView = localStorage.getItem('hub_tm_view'); } catch (_) {}
    if (savedView && savedView !== 'day') {
      var btn = switcher.querySelector('.hub-tm-view-btn[data-view="' + savedView + '"]');
      if (btn) setActive(btn);
      _currentView = savedView;
    }
  }

  /* ── renderGridStructure (rebuilds the grid innerHTML for each view) ── */
  function renderGridStructure(viewType) {
    var gridBody = document.getElementById('hub-tm-grid-body');
    var gridScroll = document.getElementById('hub-tm-grid-scroll');
    var gridHeader = document.getElementById('hub-tm-grid-header');
    if (!gridBody || !gridScroll || !gridHeader) return;

    gridBody.classList.add('hub-tm-grid-body--switching');

    setTimeout(function () {
      if (viewType === 'day') {
        _buildDayGrid(gridBody, gridHeader, gridScroll);
      } else if (viewType === 'week') {
        _buildWeekGrid(gridBody, gridHeader, gridScroll);
      } else if (viewType === 'month') {
        _buildMonthGrid(gridBody, gridHeader, gridScroll);
      }

      gridBody.classList.remove('hub-tm-grid-body--switching');

      // Re-bind grid interactions for the new structure
      var section = document.getElementById('time-management');
      if (section) _bindGridClicks(section);
      if (section) _bindBlockInteractions(section);
    }, 160);
  }

  /* ── Day grid ── */
  function _buildDayGrid(gridBody, gridHeader, gridScroll) {
    var d = new Date(_currentDate + 'T00:00:00');

    var hourLabels = '';
    for (var h = 0; h < 24; h++) {
      hourLabels += '<div class="hub-tm-hour-slot"><span class="hub-tm-hour-label">' +
                    String(h).padStart(2, '0') + ':00</span></div>';
    }
    var halfSlots = '';
    for (var i = 0; i < 48; i++) {
      var hh = Math.floor(i / 2);
      var mm = (i % 2) * 30;
      var time = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      halfSlots += '<div class="hub-tm-slot" data-time="' + time + '"></div>';
    }

    gridHeader.innerHTML =
      '<div class="hub-tm-time-gutter-header"></div>' +
      '<div class="hub-tm-col-header">' +
        '<span class="hub-tm-col-day-name" id="hub-tm-col-day-name">' + _dayName(d) + '</span>' +
        '<span class="hub-tm-col-date-num" id="hub-tm-col-date-num">' + _dateLabel(d) + '</span>' +
      '</div>';

    gridBody.innerHTML =
      '<div class="hub-tm-time-gutter" aria-hidden="true">' + hourLabels + '</div>' +
      '<div class="hub-tm-main-col" id="hub-tm-main-col">' +
        halfSlots +
        '<div class="hub-tm-now-indicator" id="hub-tm-now-indicator">' +
          '<div class="hub-tm-now-dot"></div>' +
          '<div class="hub-tm-now-line"></div>' +
        '</div>' +
      '</div>';

    gridScroll.style.overflow = 'auto';
    _renderAllBlocks();
    _startNowLine();
    _scrollToNow();
  }

  /* ── Week grid ── */
  function _buildWeekGrid(gridBody, gridHeader, gridScroll) {
    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var todayStr = _todayStr();

    var cursor = new Date(_currentDate + 'T00:00:00');
    var dayOfWeek = cursor.getDay();
    var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    var monday = new Date(cursor);
    monday.setDate(cursor.getDate() + mondayOffset);

    // ── HEADER: 8-column CSS grid row ──
    var headerHTML = '<div class="hub-tm-week-header-row">' +
      '<div class="hub-tm-week-gutter-spacer"></div>';
    for (var ci = 0; ci < 7; ci++) {
      var dHdr = new Date(monday);
      dHdr.setDate(monday.getDate() + ci);
      var dStrHdr = _dateToStr(dHdr);
      var isTodayHdr = (dStrHdr === todayStr);
      headerHTML += '<div class="hub-tm-week-header-cell' + (isTodayHdr ? ' hub-tm-week-header-cell--today' : '') + '">' +
        '<span class="hub-tm-week-header-day">' + days[ci] + '</span>' +
        '<span class="hub-tm-week-header-date">' + dHdr.getDate() + '</span>' +
      '</div>';
    }
    headerHTML += '</div>';
    gridHeader.innerHTML = headerHTML;

    // ── 2: Hour labels (time gutter – 24 rows) ──
    var timeGutterHTML = '<div class="hub-tm-week-time-gutter" aria-hidden="true">';
    for (var h = 0; h < 24; h++) {
      timeGutterHTML += '<div class="hub-tm-week-hour-row">' +
        '<span class="hub-tm-week-hour-label">' + String(h).padStart(2, '0') + ':00</span>' +
      '</div>';
    }
    timeGutterHTML += '</div>';

    // ── 3. 7 day columns with background grid lines and click zones ──
    var columnsHTML = '';
    for (var cj = 0; cj < 7; cj++) {
      var dCol = new Date(monday);
      dCol.setDate(monday.getDate() + cj);
      var colDateStr = _dateToStr(dCol);

      columnsHTML += '<div class="hub-tm-week-day-column" data-week-date="' + colDateStr + '">';

      // Horizontal grid lines (hour + half-hour)
      for (var line = 0; line < 48; line++) {
        var topPx = line * SLOT_H;
        var isHour = (line % 2 === 0);
        columnsHTML += '<div class="hub-tm-week-grid-line' + (isHour ? ' hub-tm-week-grid-line--hour' : ' hub-tm-week-grid-line--half') + '" style="top:' + topPx + 'px;"></div>';
      }

      // Click-to-create zones (one per 30min slot)
      for (var slot = 0; slot < 48; slot++) {
        var hh = Math.floor(slot / 2);
        var mm = (slot % 2) * 30;
        var timeLabel = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
        var zoneTop = slot * SLOT_H;
        columnsHTML += '<div class="hub-tm-week-click-zone" data-time="' + timeLabel + '" data-date="' + colDateStr + '" style="top:' + zoneTop + 'px;height:' + SLOT_H + 'px;"></div>';
      }

      // Now indicator line (hidden by default, positioned via JS)
      columnsHTML += '<div class="hub-tm-week-now-line" data-week-date="' + colDateStr + '" style="display:none;"></div>';

      columnsHTML += '</div>';
    }

    // ── 4. Assemble: 8-column CSS Grid container ──
    var bodyHTML =
      '<div class="hub-tm-grid-body--week" id="hub-tm-week-inner-body">' +
        '<div class="hub-tm-week-grid-scroll" id="hub-tm-week-grid-scroll">' +
          '<div class="grid-view-week">' +
            timeGutterHTML +
            columnsHTML +
          '</div>' +
        '</div>' +
      '</div>';

    gridBody.innerHTML = bodyHTML;
    gridScroll.style.overflow = 'auto';
    _renderWeekBlocks();
  }

  /* ── Month grid ── */
  function _buildMonthGrid(gridBody, gridHeader, gridScroll) {
    var todayStr = _todayStr();
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var dt = new Date(_currentDate + 'T00:00:00');
    var year = dt.getFullYear();
    var month = dt.getMonth();

    var monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    gridHeader.innerHTML =
      '<div class="hub-tm-time-gutter-header" style="display:none;"></div>' +
      '<div class="hub-tm-col-header" style="flex:1;text-align:center;">' +
        '<span class="hub-tm-col-day-name" style="font-size:1rem;">' + monthsFull[month] + ' ' + year + '</span>' +
      '</div>';

    var html = '<div class="hub-tm-grid-body--month" id="hub-tm-month-grid-body">' +
      '<div class="hub-tm-month-header-row">';
    for (var dn = 0; dn < 7; dn++) {
      html += '<div class="hub-tm-month-header-cell">' + dayNames[dn] + '</div>';
    }
    html += '</div>' +
      '<div class="hub-tm-month-grid-scroll" id="hub-tm-month-grid-scroll">';

    var firstDay = new Date(year, month, 1);
    var startDayOfWeek = firstDay.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevMonthDays = new Date(year, month, 0).getDate();

    var blocksByDate = {};
    for (var bi = 0; bi < _timeBlocks.length; bi++) {
      var bdate = _timeBlocks[bi].date;
      if (!blocksByDate[bdate]) blocksByDate[bdate] = [];
      blocksByDate[bdate].push(_timeBlocks[bi]);
    }

    for (var ri = 0; ri < 6; ri++) {
      html += '<div class="hub-tm-month-week-row">';
      for (var di = 0; di < 7; di++) {
        var idx = ri * 7 + di;
        var num = idx - startDayOfWeek + 1;

        if (num < 1) {
          var prevNum = prevMonthDays + num;
          var prevDate = new Date(year, month - 1, prevNum);
          var prevDateStr = _dateToStr(prevDate);
          html += '<div class="hub-tm-month-day-cell hub-tm-month-day-cell--month-other hub-tm-month-day-cell--dim" data-month-date="' + prevDateStr + '">' +
            '<span class="hub-tm-month-day-num">' + prevNum + '</span>' +
            '</div>';
        } else if (num > daysInMonth) {
          var nextNum = num - daysInMonth;
          var nextDate = new Date(year, month + 1, nextNum);
          var nextDateStr = _dateToStr(nextDate);
          html += '<div class="hub-tm-month-day-cell hub-tm-month-day-cell--month-other hub-tm-month-day-cell--dim" data-month-date="' + nextDateStr + '">' +
            '<span class="hub-tm-month-day-num">' + nextNum + '</span>' +
            '</div>';
        } else {
          var cellDateStr = _dateToStr(new Date(year, month, num));
          var isTodayCell = cellDateStr === todayStr;
          var cellClass = 'hub-tm-month-day-cell';
          if (isTodayCell) cellClass += ' hub-tm-month-day-cell--today';
          html += '<div class="' + cellClass + '" data-month-date="' + cellDateStr + '">' +
            '<span class="hub-tm-month-day-num">' + num + '</span>' +
            '<div class="hub-tm-month-block-dots">';

          if (blocksByDate[cellDateStr]) {
            var limitDots = Math.min(blocksByDate[cellDateStr].length, 6);
            for (var doti = 0; doti < limitDots; doti++) {
              var tag = _tagById(blocksByDate[cellDateStr][doti].tagId);
              var dotColor = tag ? tag.color : '#888';
              html += '<span class="hub-tm-month-block-dot" style="background:' + dotColor + ';box-shadow:0 0 4px ' + dotColor + ';"></span>';
            }
          }

          html += '</div></div>';
        }
      }
      html += '</div>';
    }

    html += '</div></div>';

    gridBody.innerHTML = html;
    gridScroll.style.overflow = 'auto';
  }

  /* ── Week block rendering ── */
  function _renderWeekBlocks() {
    var weekBody = document.getElementById('hub-tm-week-inner-body');
    if (!weekBody) return;

    var columns = weekBody.querySelectorAll('.hub-tm-week-day-column');
    for (var c = 0; c < columns.length; c++) {
      var colDate = columns[c].getAttribute('data-week-date');
      if (!colDate) continue;

      var existing = columns[c].querySelectorAll('.hub-tm-week-block');
      for (var ex = 0; ex < existing.length; ex++) {
        existing[ex].parentNode.removeChild(existing[ex]);
      }

      var blocks = _blocksForDate(colDate);
      for (var b = 0; b < blocks.length; b++) {
        var startM = _timeToMins(blocks[b].startTime);
        var endM   = _timeToMins(blocks[b].endTime);
        if (endM <= startM) endM = startM + 30;
        if (endM > 1440) endM = 1440;
        if (startM > 1440) continue;

        var top    = (startM / 60) * HOUR_H;
        var height = Math.max(18, ((endM - startM) / 60) * HOUR_H);
        var tag = _tagById(blocks[b].tagId);

        var el = document.createElement('div');
        el.className = 'hub-tm-week-block';
        el.setAttribute('data-block-id', blocks[b].id);
        el.style.top = Math.round(top) + 'px';
        el.style.height = Math.round(height) + 'px';
        el.style.setProperty('--tm-block-accent', tag ? tag.color : '#00bfff');
        el.style.background = tag ? _hexToRgba(tag.color, (tag.opacity || 85) / 100) : 'rgba(0,191,255,0.12)';
        el.style.borderLeftColor = tag ? tag.color : '#00bfff';

        var title = blocks[b].title || (tag ? tag.label : 'Block');
        var desc  = blocks[b].subtitle || '';
        var timeRange = _escapeHtml(blocks[b].startTime + ' – ' + blocks[b].endTime);

        el.innerHTML =
          '<div class="hub-tm-week-block-time">' + timeRange + '</div>' +
          '<div class="hub-tm-week-block-title">' + _escapeHtml(title) + '</div>' +
          (desc ? '<div class="hub-tm-week-block-desc">' + desc + '</div>' : '');

        columns[c].appendChild(el);
      }
    }
  }

/* ── AUDIO SETTINGS (load from localStorage) ── */
  function _loadAudioSettings() {
    try {
      var raw = localStorage.getItem('hub_tm_audio');
      if (raw) {
        var parsed = JSON.parse(raw);
        _audioSettings.enabled       = parsed.enabled       || false;
        _audioSettings.startSoundURL = parsed.startSoundURL || _audioSettings.startSoundURL;
        _audioSettings.endSoundURL   = parsed.endSoundURL   || _audioSettings.endSoundURL;
      }
    } catch (_) {}
  }

  function _saveAudioSettings() {
    try { localStorage.setItem('hub_tm_audio', JSON.stringify(_audioSettings)); } catch (_) {}
  }

  /* ── SETTINGS MODAL (open / close / save) ── */
  function _bindSettingsModal(section) {
    var modal    = section.querySelector('#hub-tm-settings-modal');
    var openBtn  = section.querySelector('#tm-btn-settings');
    var closeBtn = section.querySelector('#tm-btn-settings-close');
    var cancelBtn = section.querySelector('#tm-btn-settings-cancel');
    var saveBtn  = section.querySelector('#tm-btn-settings-save');

    if (!modal || !openBtn) return;

    var enabledCheckbox  = section.querySelector('#tm-audio-enabled');
    var startURLInput    = section.querySelector('#tm-audio-start-url');
    var endURLInput      = section.querySelector('#tm-audio-end-url');

    function openModal() {
      // Hydrate inputs from state
      if (enabledCheckbox) enabledCheckbox.checked = _audioSettings.enabled;
      if (startURLInput)   startURLInput.value     = _audioSettings.startSoundURL;
      if (endURLInput)     endURLInput.value       = _audioSettings.endSoundURL;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    openBtn.addEventListener('click', openModal);

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Backdrop click to close
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    // ESC to close
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        closeModal();
      }
    });

    // Save button
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        _audioSettings.enabled       = enabledCheckbox  ? enabledCheckbox.checked : false;
        _audioSettings.startSoundURL = startURLInput    ? startURLInput.value.trim()    : _audioSettings.startSoundURL;
        _audioSettings.endSoundURL   = endURLInput      ? endURLInput.value.trim()      : _audioSettings.endSoundURL;
        _saveAudioSettings();

        // Start or clear the audio check loop
        if (_audioSettings.enabled) {
          _startAudioCheck();
        } else {
          _stopAudioCheck();
        }

        closeModal();
      });
    }
  }

  /* ── AUDIO CHECK LOOP (every 1 second, guards on minute change) ── */
  function _startAudioCheck() {
    _stopAudioCheck();

    _audioCheckInterval = setInterval(function () {
      // Always reload settings so the user can change URLs mid-session
      _loadAudioSettings();

      var now = new Date();
      var h = String(now.getHours()).padStart(2, '0');
      var m = String(now.getMinutes()).padStart(2, '0');
      var currentHM = h + ':' + m;

      if (currentHM === _lastMinuteProcessed) return;
      _lastMinuteProcessed = currentHM;

      if (!_audioSettings.enabled) return;

      var playStart = false;
      var playEnd   = false;

      // Check ALL blocks (across all dates), not just current date
      for (var i = 0; i < _timeBlocks.length; i++) {
        var b = _timeBlocks[i];
        if (b.startTime === currentHM) playStart = true;
        if (b.endTime   === currentHM) playEnd   = true;
        if (playStart && playEnd) break;
      }

      if (playStart) _playCustomSound(_audioSettings.startSoundURL);
      if (playEnd)   _playCustomSound(_audioSettings.endSoundURL);
    }, 500);
  }

  function _stopAudioCheck() {
    if (_audioCheckInterval) {
      clearInterval(_audioCheckInterval);
      _audioCheckInterval = null;
    }
  }

  /* ── Audio playback helper ── */
  function _playCustomSound(url) {
    if (!url) return;
    var a;
    try {
      a = new Audio(url);
    } catch (err) {
      console.error('[Hub Audio] Invalid Audio URL:', err.message || err);
      return;
    }
    a.volume = 0.7;
    a.play().catch(function (err) {
      console.error('[Hub Audio] Autoplay blocked (browser policy):', err.message || err);
    });
  }

  /* ── Legacy wrapper ── */
  function _playAudio(url) {
    _playCustomSound(url);
  }

/* ============================================================
     BLOCK RENDERING
     ============================================================ */
  function _blocksForDate(dateStr) {
    return _timeBlocks.filter(function (b) { return b.date === dateStr; });
  }

  function _renderAllBlocks() {
    var mainCol = document.getElementById('hub-tm-main-col');
    if (!mainCol) return;

    // Remove existing block elements (leave slots + now line)
    var existing = mainCol.querySelectorAll('.hub-tm-block');
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }

    var blocks = _blocksForDate(_currentDate);
    for (var j = 0; j < blocks.length; j++) {
      _renderBlock(blocks[j], mainCol);
    }
  }

  function _renderBlock(block, mainCol) {
    var startM = _timeToMins(block.startTime);
    var endM   = _timeToMins(block.endTime);
    if (endM <= startM) endM = startM + 30;

    // Handle 0:00 overflow — clamp to 24h
    if (endM > 1440) endM = 1440;
    if (startM > 1440) return; // past midnight, just skip

    var top    = (startM / 60) * HOUR_H;
    var height = Math.max(24, ((endM - startM) / 60) * HOUR_H);

    var tag = _tagById(block.tagId);
    var tagCls = tag ? 'hub-tm-block--' + block.tagId : 'hub-tm-block--custom';
    var rgb = tag ? _hexToRgb(tag.color) : '255,255,255';
    var rgba = tag ? _hexToRgba(tag.color, (tag.opacity || 85) / 100) : 'rgba(255,255,255,0.12)';

    var el = document.createElement('div');
    el.className = 'hub-tm-block ' + tagCls;
    el.setAttribute('data-block-id', block.id);
    el.setAttribute('data-tag', block.tagId);
    el.style.top = Math.round(top) + 'px';
    el.style.height = Math.round(height) + 'px';
    el.style.setProperty('--tm-block-accent', tag ? tag.color : '#00bfff');
    el.style.setProperty('--tm-block-accent-rgb', rgb);
    el.style.setProperty('background', rgba);
    el.style.setProperty('border-left-color', tag ? tag.color : '#00bfff');

    el.innerHTML =
      '<div class="hub-tm-block-grip"></div>' +
      '<div class="hub-tm-block-content">' +
        '<span class="hub-tm-block-time">' + _escapeHtml(block.startTime) + ' – ' + _escapeHtml(block.endTime) + '</span>' +
        '<span class="hub-tm-block-title" contenteditable="true" spellcheck="false">' + _escapeHtml(block.title || tag.label) + '</span>' +
        '<span class="hub-tm-block-subtitle">' + (block.subtitle || '') + '</span>' +
      '</div>' +
      '<button class="hub-tm-block-delete" aria-label="Delete block" title="Delete block">&times;</button>';

    // Wire up the contenteditable title to save back
    var titleEl = el.querySelector('.hub-tm-block-title');
    if (titleEl) {
      titleEl.addEventListener('input', function () {
        for (var k = 0; k < _timeBlocks.length; k++) {
          if (_timeBlocks[k].id === block.id) {
            _timeBlocks[k].title = titleEl.textContent;
            _saveAll();
            break;
          }
        }
      });
    }

    if (mainCol) {
      mainCol.appendChild(el);
    }

    return el;
  }

  /* ── Custom Tag Pill UI ── */
  function _renderCustomTagPills() {
    var container = document.getElementById('hub-tm-custom-tags');
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < _customTags.length; i++) {
      _renderOneCustomTagPill(_customTags[i]);
    }
  }

  function _renderOneCustomTagPill(tag) {
    var container = document.getElementById('hub-tm-custom-tags');
    if (!container) return;
    var pill = document.createElement('span');
    pill.className = 'hub-tm-tag hub-tm-tag--custom';
    pill.setAttribute('data-tag-id', tag.id);
    pill.setAttribute('data-color', tag.color);
    pill.setAttribute('data-opacity', String(tag.opacity));
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    pill.style.setProperty('--tm-custom-color', tag.color);
    pill.style.setProperty('--tm-custom-color-rgb', _hexToRgb(tag.color));
    pill.innerHTML = '<span class="hub-tm-tag-dot" style="background:' + _escapeHtml(tag.color) + ';"></span>' +
                     _escapeHtml(tag.label) +
                     '<button class="hub-tm-tag-delete" aria-label="Remove tag">&times;</button>';

    _bindCustomTagDelete(pill, tag.id);

    if (tag.id === _activeTagId) {
      pill.classList.add('hub-tm-tag--active');
    }

    container.appendChild(pill);
  }

  /* ============================================================
     NOW-LINE INDICATOR
     ============================================================ */
  function _startNowLine() {
    _updateNowLine();
    if (_timeInterval) clearInterval(_timeInterval);
    _timeInterval = setInterval(_updateNowLine, 60000);
  }

  function _updateNowLine() {
    var indicator = document.getElementById('hub-tm-now-indicator');
    if (!indicator) return;

    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    if (mins >= 1440) {
      indicator.style.display = 'none';
      return;
    }

    var topPx = (mins / 60) * HOUR_H;

    // Only show if viewing today's date
    var today = _todayStr();
    if (_currentDate !== today) {
      indicator.style.display = 'none';
      return;
    }

    indicator.style.display = 'flex';
    indicator.style.top = Math.round(topPx) + 'px';

    // Also update past-block dimming
    _updatePastBlockDimming();
  }

  /* ── Dim blocks whose end time has passed ── */
  function _updatePastBlockDimming() {
    var allBlocks = document.querySelectorAll('#hub-tm-main-col .hub-tm-block');
    if (!allBlocks.length) return;

    var todayStr = _todayStr();
    var now = new Date();
    var nowTotalMins = now.getHours() * 60 + now.getMinutes();

    for (var i = 0; i < allBlocks.length; i++) {
      var el = allBlocks[i];
      var blockId = el.getAttribute('data-block-id');
      if (!blockId) continue;

      // Find block data
      var block = null;
      for (var j = 0; j < _timeBlocks.length; j++) {
        if (_timeBlocks[j].id === blockId) { block = _timeBlocks[j]; break; }
      }
      if (!block) continue;

      // Only dim today's blocks — past blocks on other dates are irrelevant
      if (block.date !== todayStr || _currentDate !== todayStr) {
        el.classList.remove('hub-tm-block--past');
        continue;
      }

      var endMins = _timeToMins(block.endTime);
      if (endMins < nowTotalMins) {
        el.classList.add('hub-tm-block--past');
      } else {
        el.classList.remove('hub-tm-block--past');
      }
    }
  }

  function _scrollToNow() {
    if (_currentDate !== _todayStr()) return;
    var scrollEl = document.getElementById('hub-tm-grid-scroll');
    if (!scrollEl) return;
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var px = (mins / 60) * HOUR_H;
    scrollEl.scrollTop = Math.max(0, px - 200);
  }

  /* ============================================================
     UTILITIES
     ============================================================ */
  function _todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _dateToStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _dayName(d) {
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[d.getDay()] || 'Monday';
  }

  function _dateLabel(d) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  function _timeToMins(timeStr) {
    if (!timeStr) return 0;
    var parts = timeStr.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }

  function _minsToTime(mins) {
    if (mins >= 1440) mins = mins - 1440;
    var h = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function _hexToRgb(hex) {
    var r = parseInt(hex.slice(1, 3), 16) || 0;
    var g = parseInt(hex.slice(3, 5), 16) || 0;
    var b = parseInt(hex.slice(5, 7), 16) || 0;
    return r + ',' + g + ',' + b;
  }

  function _hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16) || 0;
    var g = parseInt(hex.slice(3, 5), 16) || 0;
    var b = parseInt(hex.slice(5, 7), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.min(1, Math.max(0, alpha)) + ')';
  }

  function _tagClass(tagId) {
    return 'hub-tm-tag--' + tagId;
  }

  function _escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ── Toast Notification ── */
  var _toastTimer = null;
  function _showToast(message) {
    var toast = document.getElementById('hub-tm-toast');
    if (!toast) return;

    // Clear any in-progress toast
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    toast.classList.remove('hub-tm-toast--hiding');
    toast.classList.remove('hub-tm-toast--visible');

    // Force reflow so the animation restarts
    void toast.offsetWidth;

    toast.textContent = message;
    toast.classList.add('hub-tm-toast--visible');

    _toastTimer = setTimeout(function () {
      if (!toast) return;
      toast.classList.remove('hub-tm-toast--visible');
      toast.classList.add('hub-tm-toast--hiding');
      _toastTimer = null;
    }, 2500);
  }

  /* ============================================================
     RETURNED MODULE OBJECT
     ============================================================ */
  return module;
})();

/* ── Register with router ── */
if (typeof app !== 'undefined' && app.register) {
  app.register(timeManagementModule);
}