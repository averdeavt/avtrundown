'use strict';
// Rundown-server: ingen avhengigheter. Kjør med "node server.js" eller som ferdig program.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const A = require('./assets.js'); // { html, xlsx, qr } (genereres av build-assets.js)

const exeName = path.basename(process.execPath).toLowerCase();
const compiled = !/^(node|bun)(\.exe)?$/.test(exeName);
const BASE = compiled ? path.dirname(process.execPath) : __dirname;
const DIR = path.join(BASE, 'rundown-data');
fs.mkdirSync(path.join(DIR, 'notes'), { recursive: true });

const STATUSES = ['Ikke startet', 'Klar', 'Pågår', 'Ferdig', 'Problem'];
const FILE = path.join(DIR, 'rundown.json');
const CFG = path.join(DIR, 'config.json');

function load(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }
function save(file, obj) { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, file); }

const cfg = load(CFG, null) || { pin: String(crypto.randomInt(1000, 10000)) };
if (!cfg.pin) cfg.pin = String(crypto.randomInt(1000, 10000));
save(CFG, cfg);

const sample = [
  { id: 'c1', el: 'Slipp inn publikum', who: 'Sal', dur: 900, status: 'Ikke startet', note: 'Husbelysning 100 %' },
  { id: 'c2', el: 'Velkomst og sikkerhetsinfo', who: 'Scenesjef', dur: 180, status: 'Ikke startet', note: '' },
  { id: 'c3', el: 'Akt 1', who: 'Scene', dur: 2700, status: 'Ikke startet', note: 'Kamera 1-3 live' },
  { id: 'c4', el: 'Pause', who: 'Sal', dur: 1200, status: 'Ikke startet', note: '' },
  { id: 'c5', el: 'Akt 2', who: 'Scene', dur: 2400, status: 'Ikke startet', note: '' }
];
let store = load(FILE, null) || { title: 'Rundown', start: '19:00', cues: sample, live: { id: null, since: 0, rev: 0 } };
if (!store.live) store.live = { id: null, since: 0, rev: 0 };
let PORT = 0;

function cleanCues(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 1000).map((c, i) => {
    let id = String((c && c.id) || ('c' + Date.now().toString(36) + i)).slice(0, 40);
    while (seen.has(id)) id += 'x';
    seen.add(id);
    return {
      id,
      el: String((c && c.el) || '').slice(0, 300),
      who: String((c && c.who) || '').slice(0, 200),
      dur: Math.max(0, Math.min(86400, Math.round(+(c && c.dur) || 0))),
      status: STATUSES.includes(c && c.status) ? c.status : STATUSES[0],
      note: String((c && c.note) || '').slice(0, 2000)
    };
  });
}

const clients = new Set();
function snapshot() { return JSON.stringify({ data: { title: store.title, start: store.start, cues: store.cues }, live: store.live, now: Date.now() }); }
function persist() { try { save(FILE, store); } catch (e) { console.error('Kunne ikke lagre:', e.message); } }
function broadcast() {
  const s = 'event: state\ndata: ' + snapshot() + '\n\n';
  for (const r of clients) { try { r.write(s); } catch (e) { clients.delete(r); } }
}
setInterval(() => { for (const r of clients) { try { r.write(': ping\n\n'); } catch (e) { clients.delete(r); } } }, 20000);

const TOKEN = () => crypto.createHash('sha256').update('rd1:' + cfg.pin).digest('hex').slice(0, 32);
function isLoop(req) { const a = req.socket.remoteAddress || ''; return a === '::1' || a === '127.0.0.1' || a === '::ffff:127.0.0.1'; }
function isAdmin(req) { return isLoop(req) || (req.headers.authorization || '') === 'Bearer ' + TOKEN(); }

function lanUrls() {
  const out = [];
  for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === 'IPv4' && !i.internal) out.push('http://' + i.address + ':' + PORT);
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '', n = 0;
    req.on('data', d => { n += d.length; if (n > 2e6) { reject(new Error('for stor')); req.destroy(); } else b += d; });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function send(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); }
function sendText(res, type, text) { res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(text); }

function liveAction(a) {
  const cues = store.cues, L = store.live;
  const idx = cues.findIndex(c => c.id === L.id);
  const old = idx >= 0 ? cues[idx] : null;
  let ni = -2;
  if (a.action === 'next') ni = idx + 1;
  else if (a.action === 'prev') ni = Math.max(0, idx - 1);
  else if (a.action === 'goto') ni = cues.findIndex(c => c.id === a.id);
  else if (a.action === 'stop') ni = -1;
  if (ni === -2) return false;
  if (ni >= cues.length || ni < 0) {
    if (old && a.action === 'next') old.status = 'Ferdig';
    store.live = { id: null, since: Date.now(), rev: (L.rev || 0) + 1 };
    return true;
  }
  const nw = cues[ni];
  if (old && old !== nw) old.status = ni > idx ? 'Ferdig' : 'Klar';
  nw.status = 'Pågår';
  store.live = { id: nw.id, since: Date.now(), rev: (L.rev || 0) + 1 };
  return true;
}

function noteFile(user) { return path.join(DIR, 'notes', crypto.createHash('sha1').update(user.trim().toLowerCase()).digest('hex').slice(0, 16) + '.json'); }
function cleanName(n) { return String(n || '').trim().slice(0, 40); }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html') return sendText(res, 'text/html', A.html);
      if (p === '/xlsx.js') return sendText(res, 'application/javascript', A.xlsx);
      if (p === '/qr.js') return sendText(res, 'application/javascript', A.qr);
      if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (p === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\nevent: state\ndata: ' + snapshot() + '\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(snapshot()); }
      if (p === '/api/me') return send(res, 200, { admin: isAdmin(req), local: isLoop(req) });
      if (p === '/api/info') return send(res, 200, { urls: lanUrls(), pin: isAdmin(req) ? cfg.pin : null });
      if (p === '/api/notes') {
        const u = cleanName(url.searchParams.get('user'));
        if (!u) return send(res, 400, { error: 'navn mangler' });
        return send(res, 200, load(noteFile(u), { user: u, notes: {} }));
      }
    }
    if (req.method === 'POST' && p === '/api/login') {
      const b = await readBody(req);
      if (String(b.pin) === cfg.pin) return send(res, 200, { token: TOKEN() });
      await new Promise(r => setTimeout(r, 400));
      return send(res, 401, { error: 'feil kode' });
    }
    if (req.method === 'PUT' && p === '/api/rundown') {
      if (!isAdmin(req)) return send(res, 401, { error: 'ikke produsent' });
      const b = await readBody(req);
      store.title = String(b.title || 'Rundown').slice(0, 200);
      store.start = /^\d{1,2}:\d{2}$/.test(b.start) ? b.start : '19:00';
      store.cues = cleanCues(b.cues);
      if (store.live.id && !store.cues.some(c => c.id === store.live.id)) store.live = { id: null, since: Date.now(), rev: (store.live.rev || 0) + 1 };
      persist(); broadcast();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/live') {
      if (!isAdmin(req)) return send(res, 401, { error: 'ikke produsent' });
      const b = await readBody(req);
      if (!liveAction(b)) return send(res, 400, { error: 'ukjent handling' });
      persist(); broadcast();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && p === '/api/notes') {
      const b = await readBody(req);
      const u = cleanName(b.user);
      if (!u || !b.cue) return send(res, 400, { error: 'mangler navn eller cue' });
      const f = noteFile(u);
      const d = load(f, { user: u, notes: {} });
      const text = String(b.text || '').slice(0, 5000);
      if (text) d.notes[String(b.cue).slice(0, 40)] = text; else delete d.notes[String(b.cue).slice(0, 40)];
      save(f, d);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'ikke funnet' });
  } catch (e) {
    try { send(res, 400, { error: String(e.message || e) }); } catch (e2) { /* ignorer */ }
  }
});

function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
  exec(cmd, () => {});
}

function listen(port, tries) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1);
    else { console.error('Kunne ikke starte serveren:', e.message); setTimeout(() => process.exit(1), 8000); }
  });
  server.listen(port, '0.0.0.0', () => {
    PORT = port;
    const local = 'http://localhost:' + PORT;
    console.log('\n  RUNDOWN kjører\n');
    console.log('  Du som produsent åpner:  ' + local);
    console.log('  Andre på samme nett åpner:');
    const urls = lanUrls();
    if (urls.length) urls.forEach(u => console.log('     ' + u)); else console.log('     (fant ingen nettverksadresse. Er du koblet til nettet?)');
    console.log('\n  Produsentkode for andre enheter: ' + cfg.pin);
    console.log('  Data lagres i: ' + DIR);
    console.log('\n  La dette vinduet stå åpent mens rundownen brukes. Lukk det for å stoppe.\n');
    openBrowser(local);
  });
}
listen(+process.env.PORT || 3000, 20);
