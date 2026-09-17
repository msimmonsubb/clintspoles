// Pole measurement server. No dependencies.
//
//   node server.js            -> http://localhost:8080
//   PORT=3000 node server.js  -> different port
//
// Data layout (all under ./data, never committed):
//   projects.json          { projects: [{id, name, createdAt}], phases: [{id, projectId, name, createdAt}] }
//   phases/<id>.json       { seed: [pole rows from the spreadsheet], edits: { poleId: {fields..., updatedAt} } }
//   locations.json         latest reported position per label
//   track-YYYY-MM-DD.jsonl one line per position report
//
// Field app (open to the tech):
//   GET  /api/projects                        projects with phases and progress counts
//   GET  /api/phases/:id                      one phase: seed rows + edits
//   PUT  /api/phases/:id/poles/:poleId        save one pole (JSON body)
//   GET  /api/phases/:id/export.csv           that phase as CSV
//   POST /api/location  GET|DELETE /api/locations  GET /api/track?name=&date=
//
// Admin (put basic auth on /manage.html and /api/admin/* in Caddy):
//   POST   /api/admin/projects                {name}
//   PATCH  /api/admin/projects/:id            {name}
//   DELETE /api/admin/projects/:id            deletes its phases too
//   POST   /api/admin/phases                  {projectId, name, poles: [...]}
//   PATCH  /api/admin/phases/:id              {name?, projectId?}
//   PUT    /api/admin/phases/:id/poles        {poles} replace pole list, keeps measurements matched by pole #
//   DELETE /api/admin/phases/:id
//
// On first start, if there is no projects.json and a legacy data.js exists, it is
// imported as project "West Mountain" / phase "Phase 6" together with data/edits.json.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PHASE_DIR = path.join(DATA_DIR, 'phases');
const META_FILE = path.join(DATA_DIR, 'projects.json');
const LOC_FILE = path.join(DATA_DIR, 'locations.json');
const PORT = Number(process.env.PORT) || 8080;

fs.mkdirSync(PHASE_DIR, { recursive: true });

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } };
const writeJson = (f, obj) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 1)); fs.renameSync(t, f); };
const newId = () => crypto.randomBytes(4).toString('hex');
const clean = (v, max = 200) => (v == null ? '' : String(v)).trim().slice(0, max);

/* ---------- pole rows ---------- */
const FIELDS = ['pole', 'address', 'power', 'catv', 'phone', 'other', 'crossing', 'proposed', 'replace', 'material', 'section'];
const MEASURE_FIELDS = ['power', 'catv', 'phone', 'other', 'crossing', 'proposed'];
const HEADER = ['Pole #', 'Address', 'Power Height', 'CATV Height', 'Phone Height', 'Other Height', 'Road / Street Crossing Height', 'Proposed Attachment Height', 'SUGGEST REPLACE', 'Material', 'Coords', 'Section'];

function normalisePoles(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const lat = Number(r.lat), lng = Number(r.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const p = { id: out.length + 1, lat: +lat.toFixed(7), lng: +lng.toFixed(7) };
    for (const f of FIELDS) p[f] = clean(r[f]);
    out.push(p);
  }
  return out;
}
const isDone = p => MEASURE_FIELDS.some(f => (p[f] || '').trim() !== '');
const merged = ph => ph.seed.map(s => Object.assign({}, s, ph.edits[s.id] || {}));

/* ---------- metadata + phase storage ---------- */
let meta = readJson(META_FILE, null);
const phaseCache = {};
const saveTimers = {};
function phaseFile(id) { return path.join(PHASE_DIR, id + '.json'); }
function loadPhase(id) {
  if (!/^[0-9a-f]{8}$/.test(id)) return null;
  if (!phaseCache[id]) { const d = readJson(phaseFile(id), null); if (!d) return null; d.edits = d.edits || {}; d.seed = d.seed || []; phaseCache[id] = d; }
  return phaseCache[id];
}
function savePhase(id, immediate) {
  clearTimeout(saveTimers[id]);
  if (immediate) return writeJson(phaseFile(id), phaseCache[id]);
  saveTimers[id] = setTimeout(() => writeJson(phaseFile(id), phaseCache[id]), 200);
}
function saveMeta() { writeJson(META_FILE, meta); }
const findProject = id => meta.projects.find(p => p.id === id);
const findPhase = id => meta.phases.find(p => p.id === id);

if (!meta) {
  meta = { projects: [], phases: [] };
  const legacy = path.join(ROOT, 'data.js');
  if (fs.existsSync(legacy)) {
    const js = fs.readFileSync(legacy, 'utf8');
    const seed = normalisePoles(JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1)));
    const legacyEdits = path.join(DATA_DIR, 'edits.json');
    const edits = readJson(legacyEdits, {});
    const project = { id: newId(), name: 'West Mountain', createdAt: Date.now() };
    const phase = { id: newId(), projectId: project.id, name: 'Phase 6', createdAt: Date.now() };
    meta.projects.push(project); meta.phases.push(phase);
    phaseCache[phase.id] = { seed, edits };
    savePhase(phase.id, true);
    if (fs.existsSync(legacyEdits)) fs.renameSync(legacyEdits, legacyEdits + '.migrated');
    console.log(`Imported legacy data.js as "${project.name} / ${phase.name}" (${seed.length} poles, ${Object.keys(edits).length} saved measurements)`);
  }
  saveMeta();
}

function projectSummary() {
  return meta.projects.map(p => ({
    id: p.id, name: p.name, createdAt: p.createdAt,
    phases: meta.phases.filter(ph => ph.projectId === p.id).map(ph => {
      const d = loadPhase(ph.id) || { seed: [], edits: {} };
      const poles = merged(d);
      const last = Object.values(d.edits).reduce((m, e) => Math.max(m, e.updatedAt || 0), 0);
      return { id: ph.id, name: ph.name, createdAt: ph.createdAt, poles: poles.length, done: poles.filter(isDone).length, lastSaved: last || null };
    }),
  }));
}

/* ---------- live locations ---------- */
let locations = readJson(LOC_FILE, {});
let locWriteQueued = false;
function persistLocations() {
  if (locWriteQueued) return;
  locWriteQueued = true;
  setTimeout(() => { locWriteQueued = false; writeJson(LOC_FILE, locations); }, 1000);
}
function localDate(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function safeName(n) { return String(n || '').trim().slice(0, 40).replace(/[^\w .'-]/g, ''); }
function recordLocation(body) {
  const name = safeName(body.name), lat = Number(body.lat), lng = Number(body.lng);
  if (!name || !isFinite(lat) || !isFinite(lng)) return null;
  const rec = { name, lat, lng, acc: Number(body.acc) || null, ts: Date.now() };
  locations[name] = rec;
  persistLocations();
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

/* ---------- export ---------- */
function toCsv(poles) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = poles.map(p => [p.pole, p.address, p.power, p.catv, p.phone, p.other, p.crossing, p.proposed, p.replace, p.material, p.lat + ', ' + p.lng, p.section]);
  return '﻿' + [HEADER, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}
function fileSafe(s) { return String(s).replace(/[^\w .-]+/g, '_').trim() || 'poles'; }

/* ---------- http plumbing ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const ok = (res, obj) => send(res, 200, JSON.stringify(obj));
const fail = (res, code, msg) => send(res, code, JSON.stringify({ error: msg }));
function readBody(req, limit = 30e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('Upload is too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Body is not valid JSON')); } });
    req.on('error', reject);
  });
}

/* ---------- routes ---------- */
async function route(req, res, url) {
  const p = url.pathname, m = req.method;
  let x;

  // --- field app ---
  if (p === '/api/projects' && m === 'GET') return ok(res, projectSummary());

  if ((x = p.match(/^\/api\/phases\/([0-9a-f]{8})$/)) && m === 'GET') {
    const ph = findPhase(x[1]), d = loadPhase(x[1]);
    if (!ph || !d) return fail(res, 404, 'No such phase');
    const pr = findProject(ph.projectId);
    return ok(res, { id: ph.id, name: ph.name, projectId: ph.projectId, projectName: pr ? pr.name : '', seed: d.seed, edits: d.edits });
  }
  if ((x = p.match(/^\/api\/phases\/([0-9a-f]{8})\/poles\/(\d+)$/)) && m === 'PUT') {
    const d = loadPhase(x[1]);
    if (!d) return fail(res, 404, 'No such phase');
    const body = await readBody(req, 1e6);
    if (typeof body !== 'object' || Array.isArray(body)) return fail(res, 400, 'Bad body');
    if (!d.seed.some(s => String(s.id) === x[2])) return fail(res, 404, 'No such pole');
    const existing = d.edits[x[2]];
    if (!existing || (body.updatedAt || 0) >= (existing.updatedAt || 0)) { d.edits[x[2]] = body; savePhase(x[1]); }
    return ok(res, d.edits[x[2]]);
  }
  if ((x = p.match(/^\/api\/phases\/([0-9a-f]{8})\/export\.csv$/)) && m === 'GET') {
    const ph = findPhase(x[1]), d = loadPhase(x[1]);
    if (!ph || !d) return fail(res, 404, 'No such phase');
    const pr = findProject(ph.projectId);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileSafe((pr ? pr.name + ' ' : '') + ph.name)} poles.csv"` });
    return res.end(toCsv(merged(d)));
  }

  // --- live location ---
  if (p === '/api/location' && m === 'POST') {
    const rec = recordLocation(await readBody(req, 1e5));
    return rec ? ok(res, rec) : fail(res, 400, 'need name, lat, lng');
  }
  if (p === '/api/locations' && m === 'DELETE') { locations = {}; persistLocations(); return ok(res, { cleared: true }); }
  if (p === '/api/locations' && m === 'GET') {
    const cutoff = Date.now() - 2 * 3600 * 1000;
    return ok(res, Object.values(locations).filter(l => l.ts > cutoff));
  }
  if (p === '/api/track' && m === 'GET') return ok(res, readTrack(url.searchParams.get('name'), url.searchParams.get('date')));

  // --- admin ---
  if (p === '/api/admin/projects' && m === 'POST') {
    const body = await readBody(req, 1e5);
    const name = clean(body.name, 80);
    if (!name) return fail(res, 400, 'Project needs a name');
    const project = { id: newId(), name, createdAt: Date.now() };
    meta.projects.push(project); saveMeta();
    return ok(res, project);
  }
  if ((x = p.match(/^\/api\/admin\/projects\/([0-9a-f]{8})$/))) {
    const project = findProject(x[1]);
    if (!project) return fail(res, 404, 'No such project');
    if (m === 'PATCH') {
      const body = await readBody(req, 1e5);
      if (body.name !== undefined) { const name = clean(body.name, 80); if (!name) return fail(res, 400, 'Project needs a name'); project.name = name; }
      saveMeta(); return ok(res, project);
    }
    if (m === 'DELETE') {
      for (const ph of meta.phases.filter(ph => ph.projectId === project.id)) { delete phaseCache[ph.id]; try { fs.unlinkSync(phaseFile(ph.id)); } catch (e) {} }
      meta.phases = meta.phases.filter(ph => ph.projectId !== project.id);
      meta.projects = meta.projects.filter(pr => pr.id !== project.id);
      saveMeta(); return ok(res, { deleted: true });
    }
  }
  if (p === '/api/admin/phases' && m === 'POST') {
    const body = await readBody(req);
    const project = findProject(String(body.projectId || ''));
    if (!project) return fail(res, 400, 'Pick a project first');
    const name = clean(body.name, 80);
    if (!name) return fail(res, 400, 'Phase needs a name');
    const seed = normalisePoles(body.poles);
    if (!seed.length) return fail(res, 400, 'No rows with usable coordinates');
    const phase = { id: newId(), projectId: project.id, name, createdAt: Date.now() };
    meta.phases.push(phase); saveMeta();
    phaseCache[phase.id] = { seed, edits: {} }; savePhase(phase.id, true);
    return ok(res, Object.assign({ poles: seed.length }, phase));
  }
  if ((x = p.match(/^\/api\/admin\/phases\/([0-9a-f]{8})(\/poles)?$/))) {
    const phase = findPhase(x[1]);
    if (!phase) return fail(res, 404, 'No such phase');
    if (x[2] && m === 'PUT') {
      const body = await readBody(req);
      const seed = normalisePoles(body.poles);
      if (!seed.length) return fail(res, 400, 'No rows with usable coordinates');
      const d = loadPhase(phase.id);
      // keep measurements for poles whose pole # is unique in both the old and new lists
      const count = (rows, k) => rows.filter(r => r.pole === k).length;
      const oldByPole = {};
      for (const s of d.seed) if (s.pole && count(d.seed, s.pole) === 1 && d.edits[s.id]) oldByPole[s.pole] = d.edits[s.id];
      const edits = {};
      let kept = 0;
      // the new sheet wins for identity fields; the saved measurement fields carry over
      for (const s of seed) if (s.pole && count(seed, s.pole) === 1 && oldByPole[s.pole]) { edits[s.id] = Object.assign({}, oldByPole[s.pole], { pole: s.pole, address: s.address, lat: s.lat, lng: s.lng }); kept++; }
      phaseCache[phase.id] = { seed, edits }; savePhase(phase.id, true);
      return ok(res, { poles: seed.length, keptMeasurements: kept });
    }
    if (!x[2] && m === 'PATCH') {
      const body = await readBody(req, 1e5);
      if (body.name !== undefined) { const name = clean(body.name, 80); if (!name) return fail(res, 400, 'Phase needs a name'); phase.name = name; }
      if (body.projectId !== undefined) { if (!findProject(String(body.projectId))) return fail(res, 400, 'No such project'); phase.projectId = String(body.projectId); }
      saveMeta(); return ok(res, phase);
    }
    if (!x[2] && m === 'DELETE') {
      meta.phases = meta.phases.filter(ph => ph.id !== phase.id); saveMeta();
      delete phaseCache[phase.id]; try { fs.unlinkSync(phaseFile(phase.id)); } catch (e) {}
      return ok(res, { deleted: true });
    }
  }
  if (p.startsWith('/api/')) return fail(res, 404, 'Not found');

  // --- static files ---
  // only pages and images are served; server code, data and spreadsheets are not
  let file = decodeURIComponent(p === '/' ? '/index.html' : p);
  file = path.normalize(path.join(ROOT, file));
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA_DIR + path.sep) || !/\.(html|css|png|webp|svg|ico)$/i.test(file)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  route(req, res, url).catch(e => fail(res, e.message && /too large|valid JSON/.test(e.message) ? 400 : 500, String(e.message || e)));
}).listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log(`Pole site running:\n  http://localhost:${PORT}` + ips.map(ip => `\n  http://${ip}:${PORT}`).join(''));
  console.log(`Manage projects:    http://localhost:${PORT}/manage.html\nData folder:        ${DATA_DIR}`);
});
