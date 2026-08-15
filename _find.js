var fs = require('fs');
var path = 'C:/Users/ASUS/Documents/personal-hub/modules/dashboard.js';
var content = fs.readFileSync(path, 'utf-8');

// Match from comment opening to the closing }, of _bindVizSettingsHelper
var marker = "    /* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n       _bindVizSettingsHelper() \u2014 Additional Phase 2 bindings";
var idx = content.indexOf(marker);
console.log('Marker found at:', idx);

if (idx === -1) {
  // try partial
  var p = content.indexOf("_bindVizSettingsHelper() \u2014 Additional Phase 2 bindings");
  console.log('Just function line found at:', p);
  // Show exactly 30 chars surrounding it
  console.log(JSON.stringify(content.substring(p - 30, p + 80)));
}