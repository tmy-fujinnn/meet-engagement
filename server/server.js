// Engagement server: receives opt-in snapshots from the student extension,
// merges them per meeting, and serves analytics to the professor dashboard.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLASS_CODE = process.env.CLASS_CODE || 'demo-class';   // students enter this in the extension
const PROF_TOKEN = process.env.PROF_TOKEN || 'change-me';    // professor enters this in the dashboard
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const DATA_FILE = path.join(__dirname, 'data.json');
const BUCKET_MS = 15000; // extension reports every 15s

let db = { meetings: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
let dirty = false;

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const norm = n => String(n || '').replace(/\(you\)/ig, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const keyOf = n => norm(n).toLowerCase();

function part(m, name) {
  const k = keyOf(name);
  if (!k) return null;
  return (m.participants[k] ||= { name: norm(name), ext: false, b: {} });
}

// ---------- ingest ----------
function ingest(s) {
  const code = String(s.meetingCode || '');
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return false;
  const now = Date.now();
  const id = Math.floor(now / BUCKET_MS);
  const m = (db.meetings[code] ||= { code, startedAt: now, lastSeen: now, participants: {}, chat: {} });
  m.lastSeen = now;

  // Self report = authoritative for that student (mic level, camera, tab focus)
  const me = part(m, s.reporter);
  if (me) {
    const self = s.self || {};
    me.ext = true;
    const b = (me.b[id] ||= {});
    b.p = 1;
    b.sc = self.camOn ? 1 : 0;
    b.ss = (self.speakingSec || 0) >= 2 ? 1 : 0;
    b.f = self.focused ? 1 : 0;
  }
  // Roster observed from this student's screen (OR-merged across all reporters)
  for (const r of (Array.isArray(s.roster) ? s.roster : []).slice(0, 300)) {
    const p = part(m, r.name);
    if (!p) continue;
    const b = (p.b[id] ||= {});
    b.p = 1;
    b.cam = (b.cam || 0) | (r.cam ? 1 : 0);
    b.spk = (b.spk || 0) | (r.spk ? 1 : 0);
    b.hand = (b.hand || 0) | (r.hand ? 1 : 0);
  }
  // Chat events (metadata only; de-duplicated across reporters)
  for (const c of (Array.isArray(s.chat) ? s.chat : []).slice(0, 100)) {
    const key = `${keyOf(c.sender)}|${String(c.time || '').slice(0, 12)}|${String(c.hash || '').slice(0, 12)}`;
    if (m.chat[key]) continue;
    m.chat[key] = 1;
    const p = part(m, c.sender);
    if (!p) continue;
    const b = (p.b[id] ||= {});
    b.p = 1;
    b.c = (b.c || 0) + 1;
  }
  dirty = true;
  return true;
}

// ---------- analytics ----------
function summarize(m, now = Date.now()) {
  const startMin = Math.floor(m.startedAt / 60000);
  const nMin = Math.max(1, Math.min(Math.floor(m.lastSeen / 60000) - startMin + 1, 480));
  const tl = Array.from({ length: nMin }, () => ({ present: 0, attentive: 0, interacting: 0 }));
  const rows = [];

  for (const p of Object.values(m.participants)) {
    const mins = new Array(nMin).fill(null);
    let nb = 0, cam = 0, spk = 0, chat = 0, focKnown = 0, foc = 0;
    let lastT = 0, lastInteractT = 0, firstT = Infinity;
    const recentFocus = [];
    const ids = Object.keys(p.b).map(Number).sort((a, b) => a - b);

    for (const id of ids) {
      const b = p.b[id], t = id * BUCKET_MS;
      const mi = Math.floor(t / 60000) - startMin;
      if (mi < 0 || mi >= nMin) continue;
      const camOn = (b.sc ?? b.cam ?? 0) === 1;
      const speaking = b.ss === 1 || b.spk === 1;
      const interacting = speaking || b.hand === 1 || (b.c || 0) > 0;
      const hasF = b.f !== undefined, focused = b.f === 1;
      nb++; if (camOn) cam++; if (speaking) spk++; chat += b.c || 0;
      if (hasF) { focKnown++; if (focused) foc++; recentFocus.push(focused); }
      lastT = t; firstT = Math.min(firstT, t); if (interacting) lastInteractT = t;
      const c = (mins[mi] ||= { n: 0, cam: 0, inter: 0, fN: 0, f: 0 });
      c.n++; if (camOn) c.cam++; if (interacting) c.inter++;
      if (hasF) { c.fN++; if (focused) c.f++; }
    }
    if (!nb) continue;

    // 0 = not seen, 1 = present, 2 = attentive (camera on + tab focused), 3 = interacting
    const strip = mins.map(c => !c ? 0 : c.inter > 0 ? 3
      : (c.cam * 2 >= c.n && (c.fN === 0 || c.f * 2 >= c.fN)) ? 2 : 1);
    strip.forEach((lv, i) => {
      if (lv > 0) { tl[i].present++; if (lv >= 2) tl[i].attentive++; if (lv === 3) tl[i].interacting++; }
    });

    const presentMin = strip.filter(Boolean).length;
    const activeMin = strip.filter(l => l === 3).length;
    const partScore = Math.min(1, (presentMin ? activeMin / presentMin : 0) / 0.25); // 25% of minutes active = full marks
    const camR = cam / nb;
    const focR = focKnown ? foc / focKnown : null;
    const score = Math.round(100 * (focR === null
      ? 0.6 * partScore + 0.4 * camR
      : 0.4 * partScore + 0.3 * camR + 0.3 * focR));

    const here = now - lastT < 45000;
    const ref = here ? now : lastT;
    const idleMin = Math.max(0, Math.round((ref - Math.max(lastInteractT, firstT)) / 60000));
    const tabAway = recentFocus.length >= 6 && recentFocus.slice(-6).every(x => !x);
    const status = !here ? 'left' : presentMin < 3 ? 'new' : score >= 55 ? 'engaged' : score >= 30 ? 'low' : 'disengaged';
    let alert = null;
    if (here && presentMin >= 5) {
      if (tabAway) alert = 'Meet tab out of focus for 90+ seconds';
      else if (idleMin >= 10) alert = `No chat, speaking or hand raise for ${idleMin} min`;
    }
    rows.push({
      name: p.name, ext: !!p.ext, here, status, score, alert, tabAway, idleMin,
      presentMin, chat, spokeMin: +(spk * BUCKET_MS / 60000).toFixed(1),
      cameraPct: Math.round(camR * 100), focusPct: focR === null ? null : Math.round(focR * 100), strip
    });
  }
  rows.sort((a, b) => a.score - b.score);
  return {
    code: m.code, startedAt: m.startedAt, lastSeen: m.lastSeen, nMin, rows,
    timeline: tl.map(x => x.present
      ? { attentive: Math.round(100 * x.attentive / x.present), interacting: Math.round(100 * x.interacting / x.present) }
      : { attentive: 0, interacting: 0 })
  };
}

// ---------- http ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.post('/api/snapshot', (req, res) => {
  if (!same(req.get('x-class-code'), CLASS_CODE)) return res.status(401).json({ error: 'bad class code' });
  return ingest(req.body || {}) ? res.json({ ok: true }) : res.status(400).json({ error: 'bad payload' });
});

const prof = (req, res, next) => same(req.get('x-prof-token'), PROF_TOKEN) ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/meetings', prof, (req, res) => {
  res.json(Object.values(db.meetings).sort((a, b) => b.lastSeen - a.lastSeen)
    .map(m => ({ code: m.code, startedAt: m.startedAt, lastSeen: m.lastSeen, participants: Object.keys(m.participants).length })));
});
app.get('/api/meetings/:code', prof, (req, res) => {
  const m = db.meetings[req.params.code];
  return m ? res.json(summarize(m)) : res.status(404).json({ error: 'not found' });
});
app.get('/api/meetings/:code/export.csv', prof, (req, res) => {
  const m = db.meetings[req.params.code];
  if (!m) return res.status(404).end();
  const s = summarize(m);
  const lines = ['name,status,score,minutes_present,chat_messages,speaking_minutes,camera_pct,focus_pct,idle_minutes'];
  for (const r of s.rows) lines.push([`"${r.name.replace(/"/g, '""')}"`, r.status, r.score, r.presentMin, r.chat, r.spokeMin, r.cameraPct, r.focusPct ?? '', r.idleMin].join(','));
  res.type('text/csv').send(lines.join('\n'));
});
app.delete('/api/meetings/:code', prof, (req, res) => {
  delete db.meetings[req.params.code]; dirty = true; res.json({ ok: true });
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- persistence + retention ----------
const purge = () => {
  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  for (const [k, m] of Object.entries(db.meetings)) if (m.lastSeen < cutoff) { delete db.meetings[k]; dirty = true; }
};
purge();
setInterval(() => { if (dirty) { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); dirty = false; } }, 10000);
setInterval(purge, 3600e3);

app.listen(PORT, () => console.log(`Engagement server on http://localhost:${PORT}  (class code: ${CLASS_CODE})`));
