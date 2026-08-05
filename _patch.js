var fs = require('fs');
var path = 'C:/Users/ASUS/Documents/personal-hub/modules/dashboard.js';
var content = fs.readFileSync(path, 'utf-8');

// ── 1. Replace _bindVizSettingsHelper ──
var oldHelper = '_bindVizSettingsHelper() \u2014 Additional Phase 2 bindings\n\t       \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n\t    _bindVizSettingsHelper() {\n\t      var self = this;\n\t      var toolbar = document.getElementById("hub-viz-rich-toolbar");\n\t      if (toolbar) {\n\t        toolbar.addEventListener("click", function (e) {\n\t          var btn = e.target.closest(".hub-viz-rich-btn"); if (!btn) return;\n\t          e.preventDefault();\n\t          var cmd = btn.getAttribute("data-cmd");\n\t          if (cmd === "indent") { document.execCommand("indent", false, null); } else if (cmd === "outdent") { document.execCommand("outdent", false, null); } else { document.execCommand(cmd, false, null); }\n\t          var ed = document.getElementById("hub-viz-desc-editor"); if (ed) ed.focus();\n\t        });\n\t      }\n\t      var cp = document.getElementById("hub-viz-rich-color");\n\t      if (cp) { cp.addEventListener("input", function () { document.execCommand("foreColor", false, this.value); var ed = document.getElementById("hub-viz-desc-editor"); if (ed) ed.focus(); }); }\n\t      var sel = document.getElementById("hub-viz-habit-select");\n\t      if (sel) { sel.addEventListener("change", function () { self._selectHabitForDesc(this.value); }); }\n\t      var sb = document.getElementById("hub-viz-save-btn");\n\t      if (sb) { sb.addEventListener("click", function () { self._saveHabitData(); self._renderVizBoard(); self._bindVizEvents(); }); }\n\t    },';

var newHelper = '    /* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n' +
'       _bindVizSettingsHelper() \u2014 Phase 2+3 bindings\n' +
'       \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n' +
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
'      // \u2500\u2500 Phase 3: Typography style controls \u2192 _vizStyleConfig \u2500\u2500\n' +
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
'      // \u2500\u2500 Phase 3: Deadline & Reward inputs binding \u2500\u2500\n' +
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
'      // \u2500\u2500 Phase 3: Click-to-complete on board items \u2500\u2500\n' +
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
'    }';

// Try exact string match via hex
var oldHex = '';
for (var i = 0; i < oldHelper.length; i++) oldHex += oldHelper.charCodeAt(i).toString(16).padStart(2, '0');

var idx = content.indexOf(oldHelper);
if (idx > -1) {
  content = content.substring(0, idx) + newHelper + content.substring(idx + oldHelper.length);
  console.log('OK: Replaced _bindVizSettingsHelper at offset ' + idx);
} else {
  console.log('FAIL: Could not find oldHelper. Checking partial match...');
  // Try matching just the function name + opening brace
  var partial = 'bindVizSettingsHelper() {\n\t      var self = this;\n\t      var toolbar';
  idx = content.indexOf(partial);
  if (idx > -1) {
    console.log('Partial found at ' + idx + ', oldHelper has different chars after it');
  } else {
    console.log('Partial also not found');
  }
  process.exit(1);
}

fs.writeFileSync(path, content, 'utf-8');
console.log('Wrote file.');