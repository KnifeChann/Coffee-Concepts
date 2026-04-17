/**
 * server/store.js
 * Redis-backed shared state store for Coffee & Concepts.
 *
 * Replaces all in-memory JS Maps so that multiple server instances
 * and the timer worker all see exactly the same data.
 *
 * Key schema:
 *   room:{id}              — JSON blob of room metadata (no members / messages)
 *   room:{id}:members      — Redis Hash  socketId → JSON member object
 *   room:{id}:messages     — Redis List  (newest at index 0 via LPUSH, trimmed to 200)
 *   room:{id}:timer        — Redis Hash  running/mode/secondsLeft/totalSeconds/sessionCount/skipBreakCycle
 *   sess:{socketId}        — JSON blob   { userId, roomId }   (30 min TTL, refreshed on activity)
 *   buddy:req:{reqId}      — JSON blob   { from, fromName, fromAvatar, to }  (5 min TTL)
 *   chat:rl:{socketId}     — String      timestamp of last message  (1 s TTL)
 */
'use strict';

const { createClient } = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Two clients: one for commands, one kept free for pub/sub by the adapter.
// We export `pub` so the Socket.IO adapter can subscribe on it.
const pub = createClient(REDIS_URL);
const sub = pub.duplicate();

pub.on('error', (err) => console.error('[redis] pub error:', err.message));
sub.on('error', (err) => console.error('[redis] sub error', err.message));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setJSON(key, value, ttlSec) {
  const s = JSON.stringify(value);
  if (ttlSec) {
    await pub.set(key, s, 'EX', ttlSec);
  } else {
    await pub.set(key, s);
  }
}

async function getJSON(key) {
  const s = await pub.get(key);
  return s ? JSON.parse(s) : null;
}

// ── Session store ─────────────────────────────────────────────────────────────
// TTL 30 min; each socket activity can refresh it.

const SESS_TTL = 30 * 60;

async function sessSet(socketId, data) {
  await setJSON(`sess:${socketId}`, data, SESS_TTL);
}

async function sessGet(socketId) {
  return getJSON(`sess:${socketId}`);
}

async function sessDel(socketId) {
  await pub.del(`sess:${socketId}`);
}

// ── Room metadata ─────────────────────────────────────────────────────────────
// Rooms never expire on their own; they're deleted/reset explicitly.

async function roomSet(roomId, meta) {
  await setJSON(`room:${roomId}`, meta);
}

async function roomGet(roomId) {
  return getJSON(`room:${roomId}`);
}

async function roomDel(roomId) {
  await pub.del(
    `room:${roomId}`,
    `room:${roomId}:members`,
    `room:${roomId}:messages`,
    `room:${roomId}:timer`
  );
}

async function roomAllIds() {
  const keys = await pub.keys('room:*');
  // filter out sub-keys like room:r1:members
  return keys
    .filter((k) => k.split(':').length === 2)
    .map((k) => k.replace('room:', ''));
}

// ── Room members (Hash) ───────────────────────────────────────────────────────

async function memberSet(roomId, socketId, member) {
  await pub.hset(`room:${roomId}:members`, socketId, JSON.stringify(member));
}

async function memberDel(roomId, socketId) {
  await pub.hdel(`room:${roomId}:members`, socketId);
}

async function membersGet(roomId) {
  const raw = await pub.hgetall(`room:${roomId}:members`);
  if (!raw) return {};
  const out = {};
  for (const [sid, json] of Object.entries(raw)) {
    out[sid] = JSON.parse(json);
  }
  return out;
}

async function memberCount(roomId) {
  return pub.hlen(`room:${roomId}:members`);
}

// ── Room messages (List) ──────────────────────────────────────────────────────

async function messagePush(roomId, msg) {
  const key = `room:${roomId}:messages`;
  await pub.lpush(key, JSON.stringify(msg));
  await pub.ltrim(key, 0, 199); // keep last 200
}

async function messagesGet(roomId, count = 60) {
  const raws = await pub.lrange(`room:${roomId}:messages`, 0, count - 1);
  // List is newest-first; reverse to get chronological order for clients
  return raws.map((r) => JSON.parse(r)).reverse();
}

// ── Room timer (Hash) ─────────────────────────────────────────────────────────

async function timerSet(roomId, data) {
  await pub.hset(`room:${roomId}:timer`, data);
}

async function timerGet(roomId) {
  const raw = await pub.hgetall(`room:${roomId}:timer`);
  if (!raw || !Object.keys(raw).length) return null;
  return {
    running: raw.running === 'true',
    mode: raw.mode || 'focus',
    secondsLeft: parseInt(raw.secondsLeft, 10) || 0,
    totalSeconds: parseInt(raw.totalSeconds, 10) || 0,
    sessionCount: parseInt(raw.sessionCount, 10) || 1,
    skipBreakCycle: raw.skipBreakCycle === 'true',
  };
}

async function timerDecrement(roomId) {
  // Atomic decrement — safe across multiple processes
  const newVal = await pub.hincrby(`room:${roomId}:timer`, 'secondsLeft', -1);
  return Math.max(0, newVal);
}

// ── Timer leader lock ─────────────────────────────────────────────────────────
// Only the process that holds this lock ticks the timer.
// TTL = 5s — the worker refreshes every second.

const LOCK_TTL = 5;

async function timerLockAcquire(roomId, instanceId) {
  const res = await pub.set(
    `room:${roomId}:timer:lock`,
    instanceId,
    'NX',
    'EX',
    LOCK_TTL
  );
  return res === 'OK';
}

async function timerLockRefresh(roomId, instanceId) {
  const current = await pub.get(`room:${roomId}:timer:lock`);
  if (current !== instanceId) return false; // stolen
  await pub.expire(`room:${roomId}:timer:lock`, LOCK_TTL);
  return true;
}

async function timerLockRelease(roomId, instanceId) {
  const current = await pub.get(`room:${roomId}:timer:lock`);
  if (current === instanceId) await pub.del(`room:${roomId}:timer:lock`);
}

// ── Buddy requests ────────────────────────────────────────────────────────────

async function buddyReqSet(reqId, data) {
  await setJSON(`buddy:req:${reqId}`, data, 5 * 60); // 5 min TTL
}

async function buddyReqGet(reqId) {
  return getJSON(`buddy:req:${reqId}`);
}

async function buddyReqDel(reqId) {
  await pub.del(`buddy:req:${reqId}`);
}

// ── Chat rate-limit ───────────────────────────────────────────────────────────

async function chatRLCheck(socketId) {
  const key = `chat:rl:${socketId}`;
  const last = await pub.get(key);
  const now = Date.now();
  if (last && now - Number(last) < 500) return false; // too fast
  await pub.set(key, String(now), 'PX', 1000); // expire after 1 s
  return true;
}

// ── Cleanup: remove all session keys for a socketId ──────────────────────────

async function cleanupSocket(socketId) {
  await sessDel(socketId);
  await pub.del(`chat:rl:${socketId}`);
}

module.exports = {
  pub,
  sub,
  // sessions
  sessSet,
  sessGet,
  sessDel,
  // rooms
  roomSet,
  roomGet,
  roomDel,
  roomAllIds,
  // members
  memberSet,
  memberDel,
  membersGet,
  memberCount,
  // messages
  messagePush,
  messagesGet,
  // timer
  timerSet,
  timerGet,
  timerDecrement,
  timerLockAcquire,
  timerLockRefresh,
  timerLockRelease,
  // buddy
  buddyReqSet,
  buddyReqGet,
  buddyReqDel,
  // chat rate-limit
  chatRLCheck,
  // cleanup
  cleanupSocket,
};
