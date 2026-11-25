// Pakker siden og bibliotekene inn i assets.js, slik at serveren blir én enkelt fil.
const fs = require('fs'), path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const out = {
  html: rd('public/index.html'),
  xlsx: rd('node_modules/xlsx/dist/xlsx.full.min.js'),
  qr: rd('node_modules/qrcode-generator/dist/qrcode.js')
};
fs.writeFileSync(path.join(__dirname, 'assets.js'), 'module.exports=' + JSON.stringify(out) + ';\n');
console.log('assets.js skrevet (' + Math.round(fs.statSync(path.join(__dirname, 'assets.js')).size / 1024) + ' kB)');
