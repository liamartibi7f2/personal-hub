var fs = require('fs');
var path = 'C:/Users/ASUS/Documents/personal-hub/modules/dashboard.js';
var content = fs.readFileSync(path, 'utf-8');

// ── 1. Replace _bindVizSettingsHelper block ──
// Match from the comment line before it to the closing },
// Includes all content down to (but not including) the next comment block
var oldHelper = /_bindVizSettingsHelper\(\)[\s\S]*?sb\.addEventListener\('click', function \(\) \{ self\._saveHabitData\(\); self\._renderVizBoard\(\); self\._bindVizEvents\(\); \}\); \}\);\n\s*\},/.exec(content);
if (!oldHelper) {
  console.log('Could not find _bindVizSettingsHelper block. Exiting.');
  // Show what's around that area
  var startIdx = content.indexOf('_bindVizSettingsHelper()');
  console.log('Start idx:', startIdx);
  process.exit(1);
}

var newHelper = '    /* ──────────────────────────────────────────────\n' +
'       _bindVizSettingsHelper() — Phase 2+3 bindings\n' +
'       ────────────────────────────────────────────── */\n' +
'    _bindVizSettingsHelper() {\n' +
'      var self = this;\n' +
'      var toolbar = document.getElementById(\'hub-viz-rich-toolbar\');\n' +
'      if (toolbar) {\n' +
'        toolbar.addEventListener(\'click\', function (e) {\n' +
'          var btn = e.target.closest(\'.hub-viz-rich-btn\'); if (!btn) return;\n' +
'          e.preventDefault();\n' +
'          var cmd = btn.getAttribute(\'data-cmd\');\n' +
'          if (cmd === \'indent\') { document.execCommand(\'indent\', false, null); } else if (cmd === \'outdent\') { document.execCommand(\'outdent\', false, null); } else { document.execCommand(cmd, false, null); }\n' +
'          var ed = document.getElementById(\'hub-viz-desc-editor\'); if (ed) ed.focus();\n' +
'        });\n' +
'      }\n' +
'      var cp = document.getElementById(\'hub-viz-rich-color\');\n' +
'      if (cp) { cp.addEventListener(\'input\', function () { document.execCommand(\'foreColor\', false, this.value); var ed = document.getElementById(\'hub-viz-desc-editor\'); if (ed) ed.focus(); }); }\n' +
'      var sel = document.getElementById(\'hub-viz-habit-select\');\n' +
'      if (sel) { sel.addEventListener(\'change\', function () { self._selectHabitForDesc(this.value); }); }\n' +
'\n' +
'      // ── Phase 3: Typography style controls → _vizStyleConfig ──\n' +
'      var fontSel = document.getElementById(\'hub-viz-font-select\');\n' +
'      if (fontSel) {\n' +
'        fontSel.value = _vizStyleConfig.fontFamily || \'inherit\';\n' +
'        fontSel.addEventListener(\'change\', function () {\n' +
'          _vizStyleConfig.fontFamily = this.value;\n' +
'          self._saveVizStyleConfig();\n' +
'        });\n' +
'      }\n' +
'      var outlineCp = document.getElementById(\'hub-viz-outline-color\');\n' +
'      if (outlineCp) {\n' +
'        outlineCp.value = _vizStyleConfig.outlineColor || \'#000000\';\n' +
'        outlineCp.addEventListener(\'input\', function () {\n' +
'          _vizStyleConfig.outlineColor = this.value;\n' +
'          self._saveVizStyleConfig();\n' +
'        });\n' +
'      }\n' +
'      var shadowCp = document.getElementById(\'hub-viz-shadow-color\');\n' +
'      if (shadowCp) {\n' +
'        shadowCp.value = _vizStyleConfig.shadowColor || \'#000000\';\n' +
'        shadowCp.addEventListener(\'input\', function () {\n' +
'          _vizStyleConfig.shadowColor = this.value;\n' +
'          self._saveVizStyleConfig();\n' +
'        });\n' +
'      }\n' +
'      var glowCp = document.getElementById(\'hub-viz-glow-color\');\n' +
'      if (glowCp) {\n' +
'        glowCp.value = _vizStyleConfig.glowColor || \'#000000\';\n' +
'        glowCp.addEventListener(\'input\', function () {\n' +
'          _vizStyleConfig.glowColor = this.value;\n' +
'          self._saveVizStyleConfig();\n' +
'        });\n' +
'      }\n' +
'      var reflectTgl = document.getElementById(\'hub-viz-reflection-toggle\');\n' +
'      if (reflectTgl) {\n' +
'        reflectTgl.checked = !!_vizStyleConfig.reflection;\n' +
'        reflectTgl.addEventListener(\'change\', function () {\n' +
'          _vizStyleConfig.reflection = this.checked;\n' +
'          self._saveVizStyleConfig();\n' +
'        });\n' +
'      }\n' +
'\n' +
'      // ── Phase 3: Deadline & Reward inputs binding ──\n' +
'      var dlList = document.getElementById(\'hub-viz-deadline-list\');\n' +
'      if (dlList) {\n' +
'        dlList.querySelectorAll(\'.hub-viz-deadline-input\').forEach(function (inp) {\n' +
'          inp.addEventListener(\'change\', function () {\n' +
'            var idx = parseInt(this.getAttribute(\'data-dl-idx\'));\n' +
'            if (idx >= 0 && idx < _vizHabitData.length) {\n' +
'              _vizHabitData[idx].deadline = this.value;\n' +
'              self._saveHabitData();\n' +
'            }\n' +
'          });\n' +
'        });\n' +
'        dlList.querySelectorAll(\'.hub-viz-reward-input\').forEach(function (inp) {\n' +
'          inp.addEventListener(\'change\', function () {\n' +
'            var idx = parseInt(this.getAttribute(\'data-rw-idx\'));\n' +
'            if (idx >= 0 && idx < _vizHabitData.length) {\n' +
'              _vizHabitData[idx].reward = this.value;\n' +
'              self._saveHabitData();\n' +
'            }\n' +
'          });\n' +
'        });\n' +
'      }\n' +
'\n' +
'      var sb = document.getElementById(\'hub-viz-save-btn\');\n' +
'      if (sb) { sb.addEventListener(\'click\', function () { self._saveHabitData(); self._stopDeadlineTimer(); self._startDeadlineTimer(); self._renderVizBoard(); self._bindVizEvents(); }); }\n' +
'\n' +
'      // ── Phase 3: Click-to-complete on board items ──\n' +
'      var board = document.getElementById(\'hub-viz-board\');\n' +
'      if (board) {\n' +
'        board.querySelectorAll(\'[data-complete-idx]\').forEach(function (el) {\n' +
'          el.addEventListener(\'click\', function (e) {\n' +
'            e.stopPropagation();\n' +
'            var idx = parseInt(el.getAttribute(\'data-complete-idx\'));\n' +
'            if (idx >= 0 && idx < _vizHabitData.length) {\n' +
'              _vizHabitData[idx].completed = true;\n' +
'              self._saveHabitData();\n' +
'              self._triggerCompletionAnim(el, idx);\n' +
'              self._renderVizBoard();\n' +
'              self._bindVizEvents();\n' +
'            }\n' +
'          });\n' +
'        });\n' +
'      }\n' +
'    },';

content = content.replace(oldHelper[0], newHelper);
console.log('Step 1: _bindVizSettingsHelper replaced.');

// ── 2. Add deadline/reward injection into _hydrateVizSettings ──
// Find the end of _hydrateVizSettings (the "Restore description" block) and add injection before it
var hydrateMarker = '// Restore description for selected habit';
var hydIdx = content.indexOf(hydrateMarker);
if (hydIdx === -1) {
  console.log('Could not find hydrate restore description marker');
  process.exit(1);
}

// Insert the deadline-list injection code before that comment
var deadlineInjection = '\n' +
'      // ── Phase 3: Inject deadline & reward rows ──\n' +
'      var dlList = document.getElementById(\'hub-viz-deadline-list\');\n' +
'      if (dlList) {\n' +
'        var dlHtml = \'\';\n' +
'        for (var d = 0; d < _vizHabitData.length; d++) {\n' +
'          var h = _vizHabitData[d];\n' +
'          dlHtml += \'<div class=\"hub-viz-deadline-row\">\';\n' +
'          dlHtml += \'<input type=\"datetime-local\" class=\"hub-viz-deadline-input\" data-dl-idx=\"\' + d + \'\" value=\"\' + ((h.deadline || \'\').replace(/\"/g, \'&quot;\')) + \'\">\';\n' +
'          dlHtml += \'<input type=\"text\" class=\"hub-viz-reward-input\" data-rw-idx=\"\' + d + \'\" value=\"\' + ((h.reward || \'\').replace(/\"/g, \'&quot;\').replace(/</g, \'&lt;\')) + \'\" placeholder=\"🏆 reward\">\';\n' +
'          dlHtml += \'</div>\';\n' +
'        }\n' +
'        dlList.innerHTML = dlHtml;\n' +
'      }\n';

content = content.substring(0, hydIdx) + deadlineBlock + content.substring(hydIdx);

console.log('  Step 2: Deadline/reward injection added.');

// ── 3. Load viz style config on hydrate ──
// Load persisted style config
// We need to ensure the _openVizSettings method restores style inputs. Find _openVizSettings and add loading.
// Also add loading before the deadline injection
var dlBlockIdx2 = content.indexOf('// ── Phase 3: Inject deadline & reward rows');
if (dlBlockIdx2 > -1) {
  var loadingBlock = '         // ── Phase 3: Restore persisted style config ──\n' +
'      try {\n' +
'        var savedStyle = localStorage.getItem(\'hub_viz_style_config\');\n' +
'        if (savedStyle) {\n' +
'          var parsed = JSON.parse(savedStyle);\n' +
'          _vizStyleConfig = parsed;\n' +
'        }\n' +
'      } catch (_) {}\n' +
'\n' +
'      // ── Phase 3: Restore persisted viz data ──\n' +
'      try {\n' +
'        var savedData = localStorage.getItem(\'hub_viz_data\');\n' +
'        if (savedData) { _vizHabitData = JSON.parse(savedData); }\n' +
'      } catch (_) {}\n' +
'                   ';
  content = content.substring(0, dlBlockIdx2) + loadingBlock + content.substring(dlBlockIdx2);
  console.log('Step 2b: Style/habit restoration injected.');
}

// ── 4. Add new methods after _cycleHabit ──
// Find _cycleHabit end
var cycleEnd = '      textEl.addEventListener(\'animationend\', functionolHandler() {\n        textEl.removeEventListener(\'animationend\',HandleR);\n        textEl.textContent = newHabi;\n        textEl.classList.remove(\'hub-viz-anim-out\');\n        textEl.classList.add(\'hub-viz-anim-in\');\n\n        textEl.addEventListener(\'animationend\', functionHandler() {\n          textEl.removeEventListener(\'animationend\', inHandler);\n          textEl.classList.remove(\'hub-viz-anim-in\');\n        });\n      });\n    },';

// Find it with regex
var cycleRegex = /\_cycleHabit\(direction) \{\s+direction = direction \|\| 1;\s+var len = \_vizHabitData.length;\s+if \(len === 0\) return;[\s\S]*?}\s*,\s*\n\s/;

var cycleMatch = necromatch(content);
if (!cycleMatch) {
  console.log('Step 4: Could not find _cycleHabit');
  process.exit(1);
}

var beforeCycleEnd = content.lastIndexOf('},', cycleMatch.index + cycleMatch[0].length - 10);
if (beforeCycEnd === -1 || beforeCycleEnd < cycleMatch.index) {
  beforeCycleEnd = cycleMatch.index + cycleMatch[0].length - 4;
}

// Insert new methods after the closing },
var newMethods = '\n' +
'\n' +
'    /* ──────────────────────────────────────────────\n' +
'       _saveVizStyleConfig() — Persist style to localStorage\n' +
'       ────────────────────────────────────────────── */\n' +
'    _saveVizStyleConfig() {\n' +
'      try { localStorage.setItem(\'hub_viz_style_config\', JSON.stringify(_vizStyleConfig)); } catch (_) {}\n' +
'    },\n' +
'\n' +
'    /* ──────────────────────────────────────────────\n' +
'       _isOptimizeMode() — Check theme from localStorage\n' +
'       ────────────────────────────────────────────── */\n' +
'    _isOptimizeMode() {\n' +
'      try {\n' +
'        var t = localStorage.getItem(\'hub_theme\') || \'cyberpunk\';\n' +
'        return t === \'optimize\';\n' +
'      } catch (_) { return false; }\n' +
'    },\n' +
'\n' +
'    /* ──────────────────────────────────────────────────\n' +
'       _triggerCompletionAnim(boardEl, idx) — Confetti burst\n' +
'       ────────────────────────────────────────────────── */\n' +
'    _triggerCompletionAnim(boardEl, idx) {\n' +
'      if (this._isOptimizeMode()) return; // skip when optimize mode\n' +
'      var board = document.getElementById(\'hub-viz-board\');\n' +
'      if (!board) return;\n' +
'\n' +
'      // Glow pulse on the board\n' +
'      board.classList.add(\'hub-viz-complete-anim\');\n' +
'      board.addEventListener(\'animationend\', function handler() {\n' +
'        board.removeEventListener(\'animationend\', handler);\n' +
'        board.classList.remove(\'hub-viz-complete-anim\');\n' +
'      });\n' +
'\n' +
'      // Spawn confetti shards inside the board\n' +
'      var colors = [\'cyan\', \'green\', \'gold\', \'pink\', \'purple\'];\n' +
'      for (var i = 0; i < 24; i++) {\n' +
'        var shard = document.createElement(\'span\');\n' +
'        shard.className = \'hub-viz-confetti-shard hub-viz-confetti-shard--\' + colors[i % colors.length];\n' +
'        shard.style.left = (Math.random() * 90 + 5) + \'%\';\n' +
'        shard.style.top = (Math.random() * 50 + 20) + \'%\';\n' +
'        shard.style.animationDelay = (Math.random() * 0.3) + \'s\';\n' +
'        shard.style.animationDuration = (1.2 + Math.random() * 0.8) + \'s\';\n' +
'        board.appendChild(shard);\n' +
'        shard.addEventListener(\'animationend\', function () {\n' +
'          if (shard.parentNode) shard.parentNode.removeChild(shard);\n' +
'        });\n' +
'      }\n' +
'    },\n' +
'\n' +
'    /* ──────────────────────────────────────────────────\n' +
'       _startDeadlineTimer() — 1s interval for countdown updates\n' +
'       ────────────────────────────────────────────────── */\n' +
'    _startDeadlineTimer() {\n' +
'      var self = this;\n' +
'      this._stopDeadlineTimer();\n' +
'      var hasDeadlines = false;\n' +
'      for (var i = 0; i < _vizHabitData.length; i++) {\n' +
'        if (_vizHabitData[i].deadline && !_vizHabitData[i].completed) { hasDeadlines = true; break; }\n' +
'      }\n' +
'      if (!hasDeadlines) return;\n' +
'\n' +
'      _vizDeadlineInterval = setInterval(function () {\n' +
'        var badges = document.querySelectorAll(\'.hub-viz-deadline-badge[data-deadline]\');\n' +
'        var allDone = true;\n' +
'        badges.forEach(function (badge) {\n' +
'          var dl = badge.getAttribute(\'data-deadline\');\n' +
'          var idx = parseInt(badge.getAttribute(\'data-idx\'));\n' +
'          var h = (_vizHabitData[idx] && _vizHabitData[idx].completed);\n' +
'          if (h) {\n' +
'            badge.textContent = \'Done\';\n' +
'            badge.className = \'hub-viz-deadline-badge hub-viz-deadline-badge--done\';\n' +
'            return;\n' +
'          }\n' +
'          var diff = new Date(dl).getTime() - Date.now();\n' +
'          if (diff <= 0) {\n' +
'            // Deadline hit — auto-complete + animate\n' +
'            if (_vizHabitData[idx] && !_vizHabitData[idx].completed) {\n' +
'              _vizHabitData[idx].completed = true;\n' +
'              self._saveHabitData();\n' +
'              self._triggerCompletionAnim(badge, idx);\n' +
'            }\n' +
'            badge.textContent = \'Time!\';\n' +
'            badge.className = \'hub-viz-deadline-badge hub-viz-deadline-badge--danger\';\n' +
'          } else {\n' +
'            allDone = false;\n' +
'            var totalSec = Math.floor(diff / 1000);\n' +
'            var d = Math.floor(totalSec / 86400);\n' +
'            var hh = Math.floor((totalSec % 86400) / 3600);\n' +
'            var m = Math.floor((totalSec % 3600) / 60);\n' +
'            var s = totalSec % 60;\n' +
'            var text = d > 0 ? d + \'d \' + hh + \'h\' : hh > 0 ? hh + \'h \' + m + \'m\' : m > 0 ? m + \'m \' + s + \'s\' : s + \'s\';\n' +
'            badge.textContent = text;\n' +
'            // Warning/danger classes\n' +
'            if (totalSec < 3600) {\n' +
'              badge.className = \'hub-viz-deadline-badge hub-viz-deadline-badge--danger\';\n' +
'            } else if (totalSec < 86400) {\n' +
'              badge.className = \'hub-viz-deadline-badge hub-viz-deadline-badge--warning\';\n' +
'            }\n' +
'          }\n' +
'        });\n' +
'        if (allDone) {\n' +
'          self._stopDeadlineTimer();\n' +
'          self._renderVizBoard();\n' +
'          self._bindVizEvents();\n' +
'        }\n' +
'      }, 1000);\n' +
'    },\n' +
'\n' +
'    /* ──────────────────────────────────────────────────\n' +
'       _stopDeadlineTimer() — Clear the deadline interval\n' +
'       ────────────────────────────────────────────────── */\n' +
'    _stopDeadlineTimer() {\n' +
'      if (_vizDeadlineInterval) {\n' +
'        clearInterval(_vizDeadlineInterval);\n' +
'        _vizDeadlineInterval = null;\n' +
'      }\n' +
'    },');
';

content = content.substring(0, beforeCycleEnd + 2) + newMethods + content.substring(beforeCycleEnd + 2);

console.log('Step 4: Added new methods after _cycleHabit.');

// ── 5. Fix _openVizSettings to also start the timer ──
var openViz = 'this._hydrateVizSettings();\n\t      this._bindVizSettingsHelper();';
var openVizReplace = 'this._hydrateVizSettings();\n      this._bindVizSettingsHelper();';
if (content.indexOf(openViz) > -1) {
  content = content.replace(openViz, openVizReplace);
  console.log('Step 5: _openVizSettings patched.');
} else {
  console.log('Step 5: _openVizSettings pattern not found — may already be patched.');
}

console.log('All patches applied. Writing file...');
fs.writeFileSync(path, content, 'utf-8');
console.log('Done.');