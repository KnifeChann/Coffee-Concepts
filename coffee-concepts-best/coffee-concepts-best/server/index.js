/**
 * server/index.js  —  Coffee & Concepts (Best)
 *
 * Production-ready, horizontally scalable entry point.
 *
 * State:
 *   Users          → PostgreSQL via Prisma   (server/db.js)
 *   Rooms/Sessions → Redis                   (server/store.js)
 *   Real-time      → Socket.IO + Redis adapter
 *   Timers         → server/timerWorker.js   (separate process)
 */
'use strict';

require('dotenv').config();

const express = require('express');
const http    = require('http');
const path    = require('path');
const crypto  = require('crypto');
const { Server }  = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const prisma = require('./db');
const store  = require('./store');

// ── App setup ─────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
});

// Wire Socket.IO to the Redis adapter (pub/sub from store.js)
io.adapter(createAdapter(store.pub, store.sub));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const JWT_SECRET   = process.env.JWT_SECRET || 'cc-dev-secret-2024';
const PORT         = process.env.PORT || 4000;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// (Aadhaar verification removed in this build)

// ── JWT helpers ───────────────────────────────────────────────────────────────

const makeToken  = (uid) => jwt.sign({ userId: uid }, JWT_SECRET, { expiresIn: '7d' });
const verifyToken = (tok) => { try { return jwt.verify(tok, JWT_SECRET); } catch { return null; } };

// ── Safe serialisers ──────────────────────────────────────────────────────────

function safeUser(u) {
  return {
    id:              u.id,
    username:        u.username,
    email:           u.email,
    gender:          u.gender,
    genderLocked:    !!u.genderLocked,
    createdAt:       u.createdAt,
    avatar:          u.avatar,
    isAdmin:         !!u.isAdmin,
    chatRestrictedUntil: u.chatRestrictedUntil || null,
    personalNote:    u.personalNote || '',
    todos:           Array.isArray(u.todos) ? u.todos : [],
    stats:           u.stats,
  };
}

async function safeRoom(roomId) {
  const room    = await store.roomGet(roomId);
  if (!room) return null;
  const timer   = await store.timerGet(roomId);
  const membersMap = await store.membersGet(roomId);
  const members = Object.entries(membersMap).map(([sid, m]) => ({ ...m, socketId: sid }));
  const messages = await store.messagesGet(roomId, 60);
  return {
    id:          room.id,
    name:        room.name,
    type:        room.type,
    theme:       room.theme,
    subject:     room.subject,
    icon:        room.icon,
    maxMembers:  room.maxMembers,
    sessionMins: room.sessionMins,
    memberCount: members.length,
    members,
    messages,
    timeLeftMs:  room.expiresAt == null ? null : Math.max(0, room.expiresAt - Date.now()),
    timer:       timer || {
      running: false, mode: 'focus',
      secondsLeft: room.sessionMins * 60,
      totalSeconds: room.sessionMins * 60,
      sessionCount: 1, skipBreakCycle: true,
    },
    extendVotes: 0, // tracked separately; simplified here
  };
}

async function broadcastRoom(roomId) {
  const data = await safeRoom(roomId);
  if (data) io.to(roomId).emit('room:update', data);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getAuthUser(req) {
  const tok = verifyToken(req.headers.authorization?.split(' ')[1]);
  if (!tok) return null;
  return prisma.user.findUnique({ where: { id: tok.userId } }).catch(() => null);
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function currentWeekKey() {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0,10);
}

function maybeResetWeekly(stats) {
  const wk = currentWeekKey();
  if (stats.weekReset !== wk) {
    stats.weeklyMinutes = [0,0,0,0,0,0,0];
    stats.weekReset = wk;
  }
}

// ── Default rooms ─────────────────────────────────────────────────────────────

const DEFAULT_ROOMS = [
  { id:'r1', name:'Quiet Library',   type:'neutral', theme:'dark',    subject:'General Study', icon:'📚', maxMembers:40, sessionMins:25 },
  { id:'r2', name:'Lavender Lounge', type:'female',  theme:'cafe',    subject:'Exam Prep',     icon:'💜', maxMembers:40, sessionMins:50 },
  { id:'r3', name:'Deep Work Den',   type:'male',    theme:'minimal', subject:'Coding',        icon:'💻', maxMembers:40, sessionMins:90 },
  { id:'r4', name:'Dawn Desk',       type:'neutral', theme:'night',   subject:'Productivity',  icon:'🌅', maxMembers:50, sessionMins:25 },
  { id:'r5', name:'Bloom Room',      type:'female',  theme:'cafe',    subject:'Languages',     icon:'🌸', maxMembers:40, sessionMins:50 },
  { id:'r6', name:'The Grind',       type:'neutral', theme:'dark',    subject:'Deep Work',     icon:'⚡', maxMembers:50, sessionMins:90 },
];

async function initDefaultRooms() {
  for (const t of DEFAULT_ROOMS) {
    const existing = await store.roomGet(t.id);
    if (existing) continue; // already initialised (e.g. server restart)
    await store.roomSet(t.id, {
      id:t.id, name:t.name, type:t.type, theme:t.theme, subject:t.subject,
      icon:t.icon, maxMembers:t.maxMembers, sessionMins:t.sessionMins,
      createdAt:Date.now(), expiresAt:null,
    });
    await store.timerSet(t.id, {
      running:'false', mode:'focus',
      secondsLeft:String(t.sessionMins*60),
      totalSeconds:String(t.sessionMins*60),
      sessionCount:'1', skipBreakCycle:'true',
    });
  }
  console.log('[rooms] Default rooms initialised in Redis');
}

// ── Room access control ───────────────────────────────────────────────────────

function joinRoomDenial(user, room) {
  if (room.type === 'neutral') return null;
  if (!user) return 'Sign in to join gender-specific rooms.';
  if (room.type === 'female' && user.gender !== 'female') return 'This room is for women only.';
  if (room.type === 'male'   && user.gender !== 'male')   return 'This room is for men only.';
  if (!['female','male'].includes(user.gender)) return 'Neutral rooms are open to your profile.';
  return null;
}

// ── Weather ───────────────────────────────────────────────────────────────────

const MOCK_WX = [
  { temp:28, feels_like:30, description:'clear sky',    icon:'01d', city:'Your City', humidity:55, wind:3.2 },
  { temp:22, feels_like:21, description:'partly cloudy',icon:'02d', city:'Your City', humidity:68, wind:5.1 },
  { temp:18, feels_like:17, description:'light rain',   icon:'10d', city:'Your City', humidity:82, wind:7.4 },
  { temp:32, feels_like:35, description:'haze',         icon:'50d', city:'Your City', humidity:72, wind:1.8 },
];

function weatherCodeToText(code) {
  const map={0:'Clear skies',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',48:'Foggy',51:'Light drizzle',53:'Drizzle',55:'Steady drizzle',61:'Light rain',63:'Rain showers',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Strong showers',95:'Thunderstorm'};
  return map[code]||'Calm weather';
}
function meteoCodeToOwmIcon(code,isDay){
  if(code===0)return isDay?'01d':'01n';
  if([1,2].includes(code))return isDay?'02d':'02n';
  if(code===3)return'04d';
  if([45,48].includes(code))return'50d';
  if([51,53,55,61,63,65].includes(code))return'10d';
  if([71,73,75].includes(code))return'13d';
  if([80,81,82].includes(code))return'09d';
  if(code===95)return'11d';
  return'02d';
}

// ══════════════════════════════════════════════════════════════════════════════
// HTTP Routes
// ══════════════════════════════════════════════════════════════════════════════

// ── Register ──────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, gender } = req.body;
    if (!username?.trim() || !email?.trim() || !password)
      return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password min 6 characters' });
    if (gender !== 'female' && gender !== 'male')
      return res.status(400).json({ error: 'Select Female or Male' });

    const emailLc = email.toLowerCase().trim();
    const isAdmin = ADMIN_EMAILS.includes(emailLc);

    const user = await prisma.user.create({
      data: {
        username:    username.trim(),
        email:       emailLc,
        gender,
        genderLocked:    true,
        aadhaarVerified: false,
        aadhaarHash: null,
        passwordHash: await bcrypt.hash(password, 10),
        avatar:      username.trim().slice(0,2).toUpperCase(),
        isAdmin,
        personalNote:'',
        todos:       [],
        stats: {
          totalMinutes:0, sessionsCompleted:0, streak:0,
          lastStudyDate:null, weeklyMinutes:[0,0,0,0,0,0,0],
          weekReset: currentWeekKey(),
        },
      },
    });

    res.json({ token: makeToken(user.id), user: safeUser(user) });
  } catch (e) {
    if (e.code === 'P2002') {
      const field = e.meta?.target?.includes('email') ? 'Email' : 'Duplicate field';
      return res.status(409).json({ error: `${field} already registered` });
    }
    console.error('[register]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid credentials' });
    if (user.banned) return res.status(403).json({ error: 'This account has been banned' });
    res.json({ token: makeToken(user.id), user: safeUser(user) });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Me ────────────────────────────────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  try {
    const tok = verifyToken(req.headers.authorization?.split(' ')[1]);
    if (!tok) return res.status(401).json({ error: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: tok.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Workspace (notes + todos) ─────────────────────────────────────────────────
app.get('/api/me/workspace', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ personalNote: u.personalNote || '', todos: u.todos || [] });
});

app.put('/api/me/workspace', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    const data = {};
    if (typeof req.body.personalNote === 'string')
      data.personalNote = req.body.personalNote.slice(0, 8000);
    if (Array.isArray(req.body.todos))
      data.todos = req.body.todos.slice(0,120).map(t => ({
        id:   String(t.id || uuidv4()).slice(0,48),
        text: String(t.text || '').slice(0,400),
        done: !!t.done,
      }));
    const updated = await prisma.user.update({ where: { id: u.id }, data });
    res.json({ personalNote: updated.personalNote, todos: updated.todos });
  } catch (e) {
    console.error('[workspace]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Rooms ─────────────────────────────────────────────────────────────────────
app.get('/api/rooms', async (_req, res) => {
  try {
    const ids   = await store.roomAllIds();
    const rooms = await Promise.all(ids.map(safeRoom));
    res.json({ rooms: rooms.filter(Boolean) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/rooms/:id', async (req, res) => {
  const room = await safeRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ room });
});

async function createRoomFromBody(body, actorName) {
  const { name, type, theme, subject, icon, sessionMins, maxMembers } = body;
  if (!name?.trim()) return { error: 'Room name required' };
  const id = uuidv4();
  const mins = [25,50,90].includes(parseInt(sessionMins,10)) ? parseInt(sessionMins,10) : 25;
  const meta = {
    id, name: name.trim(),
    type:       ['neutral','female','male'].includes(type) ? type : 'neutral',
    theme:      theme || 'dark',
    subject:    subject?.trim() || 'General',
    icon:       icon || '📚',
    maxMembers: Math.min(parseInt(maxMembers,10)||40, 50),
    sessionMins: mins,
    createdAt: Date.now(),
    expiresAt: null,
  };
  await store.roomSet(id, meta);
  await store.timerSet(id, {
    running:'false', mode:'focus',
    secondsLeft:String(mins*60), totalSeconds:String(mins*60),
    sessionCount:'1', skipBreakCycle:'true',
  });
  console.log(`[rooms] ${actorName} created ${id} "${meta.name}"`);
  return { room: await safeRoom(id) };
}

app.post('/api/admin/rooms', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const out = await createRoomFromBody(req.body, u.username);
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
});

app.delete('/api/admin/rooms/:id', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const id = req.params.id;
  const room = await store.roomGet(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const count = await store.memberCount(id);
  if (count > 0) return res.status(409).json({ error: 'Room still has members — ask them to leave first' });
  await store.roomDel(id);
  console.log(`[rooms] ${u.username} deleted ${id}`);
  res.json({ ok: true });
});

// ── Admin: update room ─────────────────────────────────────────────────────────
app.patch('/api/admin/rooms/:id', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const id = req.params.id;
    const room = await store.roomGet(id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const memberCount = await store.memberCount(id);
    const occupied = memberCount > 0;

    const patch = req.body || {};
    const out = { ...room };

    // Always-allowed (safe) fields
    if (typeof patch.name === 'string' && patch.name.trim()) out.name = patch.name.trim().slice(0, 60);
    if (typeof patch.subject === 'string' && patch.subject.trim()) out.subject = patch.subject.trim().slice(0, 80);
    if (typeof patch.icon === 'string' && patch.icon.trim()) out.icon = patch.icon.trim().slice(0, 6);
    if (typeof patch.theme === 'string' && patch.theme.trim()) out.theme = patch.theme.trim().slice(0, 24);

    // Restricted while occupied
    if (!occupied) {
      if (typeof patch.type === 'string' && ['neutral','female','male'].includes(patch.type)) out.type = patch.type;
      if (patch.maxMembers != null) {
        const mx = Math.min(parseInt(patch.maxMembers, 10) || out.maxMembers || 40, 50);
        out.maxMembers = Math.max(2, mx);
      }
      if (patch.sessionMins != null) {
        const mins = parseInt(patch.sessionMins, 10);
        out.sessionMins = [25,50,90].includes(mins) ? mins : out.sessionMins;
      }
    }

    // Prevent shrinking below current count (even if unoccupied should be 0 here, but keep safe)
    if (out.maxMembers != null && out.maxMembers < memberCount) out.maxMembers = memberCount;

    await store.roomSet(id, out);

    // If session length changed and timer isn't running, align timer to new length
    if (!occupied && patch.sessionMins != null) {
      const timer = await store.timerGet(id);
      if (timer && !timer.running) {
        const total = out.sessionMins * 60;
        await store.timerSet(id, {
          totalSeconds: String(total),
          secondsLeft: String(total),
          mode: 'focus',
          running: 'false',
          sessionCount: String(timer.sessionCount || 1),
          skipBreakCycle: String(timer.skipBreakCycle ? 'true' : 'false'),
        });
      }
    }

    await broadcastRoom(id);
    res.json({ ok: true, room: await safeRoom(id) });
  } catch (e) {
    console.error('[admin room patch]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** Legacy alias */
app.post('/api/rooms/create', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Only admins can create rooms' });
  const out = await createRoomFromBody(req.body, u.username);
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
});

// ── Leaderboard ───────────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const all = await prisma.user.findMany({
      select:{ id:true, username:true, avatar:true, stats:true },
      orderBy:[{ stats: { sort:'desc' } }],   // Prisma JSON ordering — partial; we sort in JS
    });
    const lb = all
      .map(u => ({ id:u.id, username:u.username, avatar:u.avatar, ...u.stats }))
      .sort((a,b) => (b.totalMinutes||0)-(a.totalMinutes||0))
      .slice(0,20);
    res.json({ leaderboard: lb });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Stats ──────────────────────────────────────────────────────────────────────
app.get('/api/stats/:userId', async (req, res) => {
  const tok = verifyToken(req.headers.authorization?.split(' ')[1]);
  if (!tok || tok.userId !== req.params.userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = await prisma.user.findUnique({ where:{ id: req.params.userId } });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ stats: user.stats });
});

// ── Reports (roommate behavior) ───────────────────────────────────────────────
app.post('/api/reports', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });

    const message = String(req.body?.message || '').trim();
    const roomId = req.body?.roomId ? String(req.body.roomId).slice(0, 64) : null;
    const reportedUserId = req.body?.reportedUserId ? String(req.body.reportedUserId).slice(0, 64) : null;

    if (!message) return res.status(400).json({ error: 'Message required' });
    if (message.length > 1000) return res.status(400).json({ error: 'Message too long' });

    // If a reported userId is provided, verify it exists; otherwise store null (e.g. guest)
    let reported = null;
    if (reportedUserId) {
      reported = await prisma.user.findUnique({ where: { id: reportedUserId }, select: { id: true } });
    }

    const report = await prisma.report.create({
      data: {
        message,
        roomId,
        reporterId: u.id,
        reportedUserId: reported?.id || null,
        status: 'open',
      },
    });

    res.json({ ok: true, reportId: report.id });
  } catch (e) {
    console.error('[report]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Weather ───────────────────────────────────────────────────────────────────
app.get('/api/weather', async (req, res) => {
  const lat = req.query.lat;
  const lon = req.query.lon;
  const key = process.env.WEATHER_API_KEY;

  if (key && lat && lon) {
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${key}&units=metric`);
      const d = await r.json();
      if (d.cod === 200) return res.json({ weather:{ temp:Math.round(d.main.temp), feels_like:Math.round(d.main.feels_like), description:d.weather[0].description, icon:d.weather[0].icon, city:d.name, country:d.sys.country, humidity:d.main.humidity, wind:d.wind.speed }, mock:false });
    } catch { /* fall through */ }
  }

  const la=Number(lat), lo=Number(lon);
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    try {
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude',String(la));
      url.searchParams.set('longitude',String(lo));
      url.searchParams.set('current','temperature_2m,weather_code,is_day,apparent_temperature');
      url.searchParams.set('timezone','auto');
      const response=await fetch(url,{ headers:{ 'User-Agent':'CoffeeConcepts-Best/1.0' }});
      if (response.ok) {
        const payload=await response.json();
        const cur=payload.current||{};
        const code=cur.weather_code??0;
        const isDay=cur.is_day===1;
        const temp=Number.isFinite(cur.temperature_2m)?Math.round(cur.temperature_2m):22;
        const feels=Number.isFinite(cur.apparent_temperature)?Math.round(cur.apparent_temperature):temp;
        return res.json({ weather:{ temp, feels_like:feels, description:weatherCodeToText(code), icon:meteoCodeToOwmIcon(code,isDay), city:'Near you', country:'', humidity:0, wind:0 }, mock:false });
      }
    } catch { /* fall through */ }
  }

  res.json({ weather:MOCK_WX[Math.floor(Math.random()*MOCK_WX.length)], mock:true });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const ids = await store.roomAllIds();
  const userCount = await prisma.user.count();
  res.json({ status:'ok', rooms:ids.length, users:userCount, uptime:Math.floor(process.uptime()) });
});

// ══════════════════════════════════════════════════════════════════════════════
// Admin Routes
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/users', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const list = await prisma.user.findMany({
    select:{ id:true, username:true, email:true, gender:true, createdAt:true, avatar:true, isAdmin:true, banned:true, chatRestrictedUntil:true, stats:true },
    orderBy:{ createdAt:'desc' },
  });
  res.json({ users: list });
});

app.post('/api/admin/users/:id/ban', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const target = await prisma.user.findUnique({ where:{ id:req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.isAdmin) return res.status(403).json({ error: 'Cannot ban admin users' });
  const updated = await prisma.user.update({ where:{ id:req.params.id }, data:{ banned:!target.banned } });
  console.log(`[admin] ${u.username} ${updated.banned?'banned':'unbanned'} ${target.username}`);
  if (updated.banned) io.emit('admin:kick-user', { userId: req.params.id, reason: 'Account banned by admin' });
  res.json({ ok:true, banned:updated.banned });
});

app.post('/api/admin/users/:id/kick', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const target = await prisma.user.findUnique({ where:{ id:req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  // Emit kick event to all sockets for this user (Redis pub/sub fans out to all instances)
  io.emit('admin:kick-user', { userId: req.params.id, reason: 'Admin removed you from active sessions' });
  console.log(`[admin] ${u.username} kicked userId=${req.params.id}`);
  res.json({ ok:true });
});

app.post('/api/admin/users/:id/restrict', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.isAdmin) return res.status(403).json({ error: 'Cannot restrict admin users' });

    const minutes = Math.max(1, Math.min(30 * 24 * 60, parseInt(req.body?.minutes, 10) || 60)); // cap 30 days
    const until = new Date(Date.now() + minutes * 60_000);

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { chatRestrictedUntil: until },
    });

    io.emit('admin:restricted', { userId: req.params.id, until: until.toISOString() });
    console.log(`[admin] ${u.username} restricted userId=${req.params.id} until=${until.toISOString()}`);
    res.json({ ok: true, chatRestrictedUntil: updated.chatRestrictedUntil });
  } catch (e) {
    console.error('[admin restrict]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: Reports inbox ──────────────────────────────────────────────────────
app.get('/api/admin/reports', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const reports = await prisma.report.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        reporter: { select: { id: true, username: true, email: true } },
        reported: { select: { id: true, username: true, email: true, banned: true, chatRestrictedUntil: true } },
      },
    });

    res.json({ reports });
  } catch (e) {
    console.error('[admin reports]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/reports/:id/resolve', async (req, res) => {
  try {
    const u = await getAuthUser(req);
    if (!u) return res.status(401).json({ error: 'Unauthorized' });
    if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const updated = await prisma.report.update({
      where: { id: req.params.id },
      data: { status: 'resolved' },
    });
    res.json({ ok: true, report: updated });
  } catch (e) {
    console.error('[admin report resolve]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const target = await prisma.user.findUnique({ where:{ id:req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.isAdmin) return res.status(403).json({ error: 'Cannot delete admin users' });
  await prisma.user.delete({ where:{ id:req.params.id } });
  console.log(`[admin] ${u.username} deleted user ${target.username}`);
  res.json({ ok:true });
});

app.post('/api/admin/users/:id/admin', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const target = await prisma.user.findUnique({ where:{ id:req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  const updated = await prisma.user.update({ where:{ id:req.params.id }, data:{ isAdmin:!target.isAdmin } });
  console.log(`[admin] ${u.username} ${updated.isAdmin?'promoted':'demoted'} ${target.username}`);
  res.json({ ok:true, isAdmin:updated.isAdmin });
});

app.get('/api/admin/dashboard', async (req, res) => {
  const u = await getAuthUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (!u.isAdmin) return res.status(403).json({ error: 'Admin only' });
  const [totalUsers, bannedUsers, adminUsers, restrictedUsers, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where:{ banned:true } }),
    prisma.user.count({ where:{ isAdmin:true } }),
    prisma.user.count({ where:{ chatRestrictedUntil: { gt: new Date() } } }),
    prisma.user.findMany({ orderBy:{ createdAt:'desc' }, take:5, select:{ username:true, email:true, createdAt:true } }),
  ]);
  const roomIds  = await store.roomAllIds();
  const memberCounts = await Promise.all(roomIds.map(id => store.memberCount(id)));
  const peopleInRooms = memberCounts.reduce((s,c) => s + c, 0);
  res.json({ stats:{ totalUsers, bannedUsers, adminUsers, restrictedUsers, totalRooms:roomIds.length, peopleInRooms, recentUsers } });
});

// ══════════════════════════════════════════════════════════════════════════════
// Socket.IO real-time
// ══════════════════════════════════════════════════════════════════════════════

function getSocketUser(socket) {
  const tok = verifyToken(socket.handshake.auth?.token);
  if (!tok) return null;
  return prisma.user.findUnique({ where:{ id:tok.userId } }).catch(() => null);
}

io.on('connection', async (socket) => {
  const user  = await getSocketUser(socket);
  const dName = user ? user.username : `Guest-${socket.id.slice(0,5)}`;
  const dAvat = user ? user.avatar   : '??';
  socket.data.userId   = user?.id;
  socket.data.username = dName;
  console.log(`[+] ${dName} connected`);

  // ── Admin kick (fan-out to all instances) ──────────────────────────────────
  socket.on('admin:kick-user', ({ userId, reason }) => {
    if (socket.data.userId === userId) {
      socket.emit('admin:kicked-out', { reason });
    }
  });

  // ── Join room ─────────────────────────────────────────────────────────────
  socket.on('room:join', async ({ roomId }) => {
    const room = await store.roomGet(roomId);
    if (!room) return socket.emit('error', { message: 'Room not found' });

    if (user?.banned) return socket.emit('error', { message: 'This account has been banned' });

    const count = await store.memberCount(roomId);
    if (count >= room.maxMembers) return socket.emit('error', { message: 'Room is full' });

    const denial = joinRoomDenial(user, room);
    if (denial) return socket.emit('error', { message: denial });

    // Leave previous room if switching
    const prevSess = await store.sessGet(socket.id);
    if (prevSess?.roomId && prevSess.roomId !== roomId) {
      await store.memberDel(prevSess.roomId, socket.id);
      socket.leave(prevSess.roomId);
      io.to(prevSess.roomId).emit('room:member-left', { socketId:socket.id, username:dName });
      io.to(prevSess.roomId).emit('webrtc:peer-left', { fromSocketId:socket.id });
      await broadcastRoom(prevSess.roomId);
    }

    socket.join(roomId);
    await store.sessSet(socket.id, { userId:user?.id||null, roomId });
    await store.memberSet(roomId, socket.id, {
      socketId:socket.id, userId:user?.id||null, username:dName,
      avatar:dAvat, onBreak:false, camOn:true, micOn:true, joinedAt:Date.now(),
    });

    socket.emit('room:joined', await safeRoom(roomId));
    io.to(roomId).emit('room:member-joined', { socketId:socket.id, username:dName, avatar:dAvat });
    await broadcastRoom(roomId);
  });

  // ── Leave room ─────────────────────────────────────────────────────────────
  async function leaveRoom() {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    await store.memberDel(sess.roomId, socket.id);
    socket.leave(sess.roomId);
    io.to(sess.roomId).emit('room:member-left', { socketId:socket.id, username:dName });
    io.to(sess.roomId).emit('webrtc:peer-left', { fromSocketId:socket.id });
    await broadcastRoom(sess.roomId);
    await store.sessDel(socket.id);
  }
  socket.on('room:leave', leaveRoom);

  // ── Timer controls ─────────────────────────────────────────────────────────
  socket.on('timer:start', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const timer = await store.timerGet(sess.roomId);
    if (!timer || timer.running) return;
    await store.timerSet(sess.roomId, { running:'true' });
    io.to(sess.roomId).emit('timer:started', { by:dName });
    await broadcastRoom(sess.roomId);
  });

  socket.on('timer:pause', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    await store.timerSet(sess.roomId, { running:'false' });
    io.to(sess.roomId).emit('timer:paused', { by:dName });
    await broadcastRoom(sess.roomId);
  });

  socket.on('timer:reset', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const room  = await store.roomGet(sess.roomId);
    if (!room) return;
    const timer = await store.timerGet(sess.roomId);
    await store.timerSet(sess.roomId, {
      running:'false', mode:'focus',
      secondsLeft:String(timer?.totalSeconds ?? room.sessionMins*60),
      totalSeconds:String(timer?.totalSeconds ?? room.sessionMins*60),
    });
    io.to(sess.roomId).emit('timer:reset', { by:dName });
    await broadcastRoom(sess.roomId);
  });

  // ── Chat ───────────────────────────────────────────────────────────────────
  socket.on('chat:send', async ({ text }) => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId || !text?.trim()) return;
    if (user?.banned) return socket.emit('error', { message: 'This account has been banned' });
    if (user) {
      const latest = await prisma.user.findUnique({ where: { id: user.id }, select: { chatRestrictedUntil: true, banned: true } }).catch(() => null);
      if (latest?.banned) return socket.emit('error', { message: 'This account has been banned' });
      if (latest?.chatRestrictedUntil && new Date(latest.chatRestrictedUntil).getTime() > Date.now()) {
        return socket.emit('error', { message: 'Chat is temporarily restricted for your account.' });
      }
    }
    const allowed = await store.chatRLCheck(socket.id);
    if (!allowed) return;
    const msg = {
      id:uuidv4(), socketId:socket.id, userId:user?.id||null,
      username:dName, avatar:dAvat,
      text:text.trim().slice(0,500), timestamp:Date.now(),
    };
    await store.messagePush(sess.roomId, msg);
    io.to(sess.roomId).emit('chat:message', msg);
  });

  // ── Direct user message ────────────────────────────────────────────────────
  socket.on('room:user-message', async ({ toSocketId, text }) => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId || !toSocketId || !text?.trim()) return;
    if (user) {
      const latest = await prisma.user.findUnique({ where: { id: user.id }, select: { chatRestrictedUntil: true, banned: true } }).catch(() => null);
      if (latest?.banned) return socket.emit('error', { message: 'This account has been banned' });
      if (latest?.chatRestrictedUntil && new Date(latest.chatRestrictedUntil).getTime() > Date.now()) {
        return socket.emit('error', { message: 'Messaging is temporarily restricted for your account.' });
      }
    }
    const members = await store.membersGet(sess.roomId);
    if (!members[toSocketId] || toSocketId === socket.id) return;
    const payload = { fromSocketId:socket.id, fromUsername:dName, text:text.trim().slice(0,500), roomId:sess.roomId, timestamp:Date.now() };
    io.to(toSocketId).emit('room:user-message', payload);
    socket.emit('room:user-message-sent', { ok:true });
  });

  // ── Break ──────────────────────────────────────────────────────────────────
  socket.on('break:start', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const members = await store.membersGet(sess.roomId);
    const mb = members[socket.id];
    if (mb) { mb.onBreak = true; await store.memberSet(sess.roomId, socket.id, mb); }
    io.to(sess.roomId).emit('member:break-start', { socketId:socket.id, username:dName });
    await broadcastRoom(sess.roomId);
  });

  socket.on('break:end', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const members = await store.membersGet(sess.roomId);
    const mb = members[socket.id];
    if (mb) { mb.onBreak = false; await store.memberSet(sess.roomId, socket.id, mb); }
    io.to(sess.roomId).emit('member:break-end', { socketId:socket.id, username:dName });
    await broadcastRoom(sess.roomId);
  });

  // ── Buddy system ───────────────────────────────────────────────────────────
  socket.on('buddy:request', async ({ toSocketId }) => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const members = await store.membersGet(sess.roomId);
    if (!members[toSocketId] || toSocketId === socket.id) return socket.emit('error', { message:'Cannot send request' });
    const reqId = uuidv4();
    await store.buddyReqSet(reqId, { from:socket.id, fromName:dName, fromAvatar:dAvat, to:toSocketId });
    io.to(toSocketId).emit('buddy:request-received', { requestId:reqId, fromSocketId:socket.id, fromUsername:dName, fromAvatar:dAvat });
    socket.emit('buddy:request-sent', { toUsername: members[toSocketId]?.username });
  });

  socket.on('buddy:accept', async ({ requestId }) => {
    const req = await store.buddyReqGet(requestId);
    if (!req || req.to !== socket.id) return;
    await store.buddyReqDel(requestId);
    const dmId = [req.from, req.to].sort().join('~~');
    io.to(req.from).emit('buddy:accepted', { dmId, withSocketId:socket.id,    withUsername:dName });
    io.to(req.to).emit('buddy:accepted',   { dmId, withSocketId:req.from, withUsername:req.fromName });
  });

  socket.on('buddy:decline', async ({ requestId }) => {
    const req = await store.buddyReqGet(requestId);
    if (!req || req.to !== socket.id) return;
    await store.buddyReqDel(requestId);
    io.to(req.from).emit('buddy:declined', { byUsername:dName });
  });

  // ── DM ─────────────────────────────────────────────────────────────────────
  socket.on('dm:send', ({ dmId, text }) => {
    if (!text?.trim() || !dmId) return;
    if (user?.banned) return socket.emit('error', { message: 'This account has been banned' });
    const parts = dmId.split('~~');
    const other = parts.find(p => p !== socket.id);
    if (!other) return;
    const msg = { id:uuidv4(), fromSocketId:socket.id, fromUsername:dName, text:text.trim().slice(0,500), timestamp:Date.now() };
    io.to(other).emit('dm:message', { dmId, msg });
    socket.emit('dm:message', { dmId, msg });
  });

  // ── Media toggle ───────────────────────────────────────────────────────────
  socket.on('media:toggle', async ({ camOn, micOn }) => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const members = await store.membersGet(sess.roomId);
    const mb = members[socket.id];
    if (mb) {
      if (camOn !== undefined) mb.camOn = camOn;
      if (micOn !== undefined) mb.micOn = micOn;
      await store.memberSet(sess.roomId, socket.id, mb);
    }
    io.to(sess.roomId).emit('member:media-update', { socketId:socket.id, camOn:mb?.camOn, micOn:mb?.micOn });
  });

  // ── WebRTC signalling (purely pass-through) ────────────────────────────────
  socket.on('webrtc:offer',     ({ toSocketId, offer })     => io.to(toSocketId).emit('webrtc:offer',     { fromSocketId:socket.id, offer }));
  socket.on('webrtc:answer',    ({ toSocketId, answer })    => io.to(toSocketId).emit('webrtc:answer',    { fromSocketId:socket.id, answer }));
  socket.on('webrtc:ice',       ({ toSocketId, candidate }) => io.to(toSocketId).emit('webrtc:ice',       { fromSocketId:socket.id, candidate }));
  socket.on('webrtc:peer-left', ({ toSocketId }) => {
    if (toSocketId === '__all__' || toSocketId === '*') {
      store.sessGet(socket.id).then(sess => { if (sess?.roomId) io.to(sess.roomId).emit('webrtc:peer-left', { fromSocketId:socket.id }); });
    } else {
      io.to(toSocketId).emit('webrtc:peer-left', { fromSocketId:socket.id });
    }
  });

  // ── Session complete (stats) ───────────────────────────────────────────────
  socket.on('session:complete', async ({ minutes }) => {
    if (!user) return;
    const u = await prisma.user.findUnique({ where:{ id:user.id } });
    if (!u) return;
    const stats = { ...(u.stats || {}) };
    maybeResetWeekly(stats);
    stats.totalMinutes      = (stats.totalMinutes || 0) + (minutes || 25);
    stats.sessionsCompleted = (stats.sessionsCompleted || 0) + 1;
    const today = new Date().toDateString();
    if (stats.lastStudyDate !== today) {
      const yest = new Date(Date.now()-86_400_000).toDateString();
      stats.streak = stats.lastStudyDate === yest ? (stats.streak||0)+1 : 1;
      stats.lastStudyDate = today;
    }
    const dow = new Date().getDay();
    if (!Array.isArray(stats.weeklyMinutes)) stats.weeklyMinutes=[0,0,0,0,0,0,0];
    stats.weeklyMinutes[dow] = (stats.weeklyMinutes[dow]||0) + (minutes||25);
    await prisma.user.update({ where:{ id:user.id }, data:{ stats } });
    socket.emit('stats:updated', stats);
  });

  // ── Room extend vote ───────────────────────────────────────────────────────
  socket.on('room:vote-extend', async () => {
    const sess = await store.sessGet(socket.id);
    if (!sess?.roomId) return;
    const room = await store.roomGet(sess.roomId);
    if (!room) return;
    if (room.expiresAt == null) {
      io.to(sess.roomId).emit('room:extend-vote', { from:dName, votes:1, needed:1 });
      io.to(sess.roomId).emit('room:extended', { by:'∞' });
      return;
    }
    // track votes in Redis as a Set (using a sorted set with score=0)
    const voteKey = `room:${sess.roomId}:extend-votes`;
    await store.pub.zadd(voteKey, 0, socket.id);
    await store.pub.expire(voteKey, 60*60); // 1 hr TTL
    const votes  = await store.pub.zcard(voteKey);
    const count  = await store.memberCount(sess.roomId);
    const needed = Math.max(2, Math.ceil(count/2));
    io.to(sess.roomId).emit('room:extend-vote', { from:dName, votes, needed });
    if (votes >= needed) {
      room.expiresAt += 30*60*1000;
      await store.roomSet(sess.roomId, room);
      await store.pub.del(voteKey);
      io.to(sess.roomId).emit('room:extended', { by:30 });
      await broadcastRoom(sess.roomId);
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    console.log(`[-] ${dName} disconnected`);
    await leaveRoom();
    await store.cleanupSocket(socket.id);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Bootstrap
// ══════════════════════════════════════════════════════════════════════════════

async function bootstrap() {
  // Promote admin emails in DB if they already have accounts
  if (ADMIN_EMAILS.length) {
    await prisma.user.updateMany({
      where: { email: { in: ADMIN_EMAILS }, isAdmin: false },
      data:  { isAdmin: true },
    });
  }

  await prisma.$connect();
  console.log('[db] PostgreSQL connected');

  await initDefaultRooms();

  server.listen(PORT, () => {
    console.log(`\n☕  Coffee & Concepts (Best) — http://localhost:${PORT}\n`);
    console.log('   Open that URL in your browser (same origin for API + Socket.IO).');
    if (ADMIN_EMAILS.length) console.log(`   Admin emails: ${ADMIN_EMAILS.join(', ')}`);
    else console.log('   Set ADMIN_EMAILS (comma-separated) so those accounts can create/delete rooms.');
    console.log('');
  });
}

bootstrap().catch((e) => { console.error('[bootstrap] Fatal:', e); process.exit(1); });

process.on('SIGINT',  () => { prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', () => { prisma.$disconnect(); process.exit(0); });
