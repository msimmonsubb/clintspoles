// Optional tiny server for the pole measurement site.
// No dependencies. Serves the site and keeps every saved pole in data/edits.json
// so measurements taken on the phone show up for everyone else who opens the site.
//
//   node server.js            -> http://localhost:8080
//   PORT=3000 node server.js  -> different port
//
// Endpoints used by index.html:
//   GET  /api/poles        all saved edits, keyed by pole id
//   PUT  /api/poles/:id    save one pole (JSON body)
//   GET  /api/export.csv   full sheet (seed data + edits) as CSV
//   GET  /api/export.json  full sheet as JSON
//   POST /api/location     phone reports its GPS position {name, lat, lng, acc}
//   GET  /api/locations    latest position of everyone sharing (last 2 h)
//   DELETE /api/locations  forget all remembered positions (clears stale dots)
//   GET  /api/track?name=X&date=YYYY-MM-DD   that person's breadcrumb trail for a day

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const EDITS_FILE = path.join(DATA_DIR, 'edits.json');
const PORT = Number(process.env.PORT) || 8080;

fs.mkdirSync(DATA_DIR, { recursive: true });
let edits = {};
try { edits = JSON.parse(fs.readFileSync(EDITS_FILE, 'utf8')); } catch (e) { edits = {}; }

function seed() {
  const js = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const start = js.indexOf('['), end = js.lastIndexOf(']');
  return JSON.parse(js.slice(start, end + 1));
}
function merged() { return seed().map(p => Object.assign({}, p, edits[p.id] || {})); }

let writeQueued = false;
function persist() {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    const tmp = EDITS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(edits, null, 1));
    fs.renameSync(tmp, EDITS_FILE);
  }, 200);
}

/* ---- live locations ---- */
const LOC_FILE = path.join(DATA_DIR, 'locations.json');
let locations = {};
try { locations = JSON.parse(fs.readFileSync(LOC_FILE, 'utf8')); } catch (e) { locations = {}; }
let locWriteQueued = false;
function persistLocations() {
  if (locWriteQueued) return;
  locWriteQueued = true;
  setTimeout(() => { locWriteQueued = false; fs.writeFileSync(LOC_FILE, JSON.stringify(locations, null, 1)); }, 1000);
}
function localDate(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function safeName(n) { return String(n || '').trim().slice(0, 40).replace(/[^\w .'-]/g, ''); }
function recordLocation(body) {
  const name = safeName(body.name), lat = Number(body.lat), lng = Number(body.lng);
  if (!name || !isFinite(lat) || !isFinite(lng)) return null;
  const rec = { name, lat, lng, acc: Number(body.acc) || null, ts: Date.now() };
  locations[name] = rec;
  persistLocations();
  // breadcrumb trail, one JSON line per report, per day
  fs.appendFile(path.join(DATA_DIR, `track-${localDate(rec.ts)}.jsonl`), JSON.stringify(rec) + '\n', () => {});
  return rec;
}
function readTrack(name, date) {
  name = safeName(name); date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : localDate(Date.now());
  let text = '';
  try { text = fs.readFileSync(path.join(DATA_DIR, `track-${date}.jsonl`), 'utf8'); } catch (e) { return []; }
  return text.split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(r => r && (!name || r.name === name))
    .map(r => [r.lat, r.lng, r.ts]);
}

const HEADER = ['Pole #', 'Address', 'Power Height', 'CATV Height', 'Phone Height', 'Other Height', 'Road / Street Crossing Height', 'Proposed Attachment Height', 'SUGGEST REPLACE', 'Material', 'Coords', 'Section'];
function toCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = merged().map(p => [p.pole, p.address, p.power, p.catv, p.phone, p.other, p.crossing, p.proposed, p.replace, p.material, p.lat + ', ' + p.lng, p.section]);
  return [HEADER, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/poles' && req.method === 'GET') return send(res, 200, JSON.stringify(edits));
    const m = p.match(/^\/api\/poles\/(\d+)$/);
    if (m && req.method === 'PUT') {
      const id = m[1];
      const body = JSON.parse(await readBody(req) || '{}');
      if (typeof body !== 'object' || Array.isArray(body)) return send(res, 400, '{"error":"bad body"}');
      const existing = edits[id];
      if (!existing || (body.updatedAt || 0) >= (existing.updatedAt || 0)) { edits[id] = body; persist(); }
      return send(res, 200, JSON.stringify(edits[id]));
    }
    if (p === '/api/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="WEST MOUNTAIN PHASE 6 POLE MEASUREMENTS.csv"' });
      return res.end('﻿' + toCsv());
    }
    if (p === '/api/export.json') return send(res, 200, JSON.stringify(merged(), null, 1));
    if (p === '/api/location' && req.method === 'POST') {
      const rec = recordLocation(JSON.parse(await readBody(req) || '{}'));
      return rec ? send(res, 200, JSON.stringify(rec)) : send(res, 400, '{"error":"need name, lat, lng"}');
    }
    if (p === '/api/locations' && req.method === 'DELETE') {   // forget every remembered position (trail files are kept)
      locations = {}; persistLocations();
      return send(res, 200, '{"cleared":true}');
    }
    if (p === '/api/locations') {
      // only positions from the last 2 hours; anything older is history, not "where he is"
      const cutoff = Date.now() - 2 * 3600 * 1000;
      return send(res, 200, JSON.stringify(Object.values(locations).filter(l => l.ts > cutoff)));
    }
    if (p === '/api/track') return send(res, 200, JSON.stringify(readTrack(url.searchParams.get('name'), url.searchParams.get('date'))));
    if (p.startsWith('/api/')) return send(res, 404, '{"error":"not found"}');

    // static files
    let file = decodeURIComponent(p === '/' ? '/index.html' : p);
    file = path.normalize(path.join(ROOT, file));
    if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA_DIR + path.sep) || path.basename(file) === 'server.js') return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, JSON.stringify({ error: String(e.message || e) }));
  }
}).listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Pole site running:\n  http://localhost:${PORT}` + ips.map(ip => `\n  http://${ip}:${PORT}   (phone on same network)`).join(''));
  console.log(`Saved measurements: ${EDITS_FILE}\nCSV export:          http://localhost:${PORT}/api/export.csv`);
});
