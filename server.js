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
