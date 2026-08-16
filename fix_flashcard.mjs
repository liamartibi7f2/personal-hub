import fs from 'fs';

let content = fs.readFileSync('C:/Users/ASUS/Documents/personal-hub/modules/flashcard.js', 'utf8');

// Find the exact position and do a precise replacement based on actual content
const searchStr = `        + CUSTOM_FIELD_POSITIONS.map(function (p) {
return '<option value="' + _esc(p.value) + '"' + (p.value === 'bottom' ? ' selected' : '') + '>' + _esc(p.label) + '</option>';
        + }).join('') +`;

const replaceStr = `        + CUSTOM_FIELD_POSITIONS.map(function (p) {
return '<option value="' + _esc(p.value) + '"' + (p.value === 'bottom' ? ' selected' : '') + '>' + _esc(p.label) + '</option>';
}).join('') +`;

if (content.includes(searchStr)) {
    content = content.replace(searchStr, replaceStr);
    fs.writeFileSync('C:/Users/ASUS/Documents/personal-hub/modules/flashcard.js', content);
    console.log('Fixed!');
} else {
    console.log('Search string not found!');
    const idx = content.indexOf('CUSTOM_FIELD_POSITIONS.map');
    if (idx >= 0) {
        console.log('Actual content around the area:');
        console.log(JSON.stringify(content.slice(idx-50, idx+300)));
    }
}