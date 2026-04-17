/**
 * server/timerWorker.js
 * Distributed timer worker for Coffee & Concepts.
 *
 * This process (run separately, e.g. `node server/timerWorker.js`)
 * is the ONLY thing that ticks room timers.  It uses a per-room Redis
 * lock so that if you accidentally run two workers, only one wins.
 *
 * It publishes timer events into the Socket.IO Redis adapter pub/sub
 * channel so that all connected app instances forward them to clients.
 */
'use strict';

require('dotenv').config();

const { createClient } = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { Server } = require('socket.io');
const http = require('http');
const crypto = require('crypto');
const prisma = require('./db');
const store = require('./store');

// Unique ID for this worker instance (used for Redis lock ownership)
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');
console.log(`[timer-worker] starting, instanceId=${INSTANCE_ID}`);

// ── Minimal Socket.IO server (no HTTP listeners — port 0) ─────────────────────
// We only use this so we can emit events through the shared Redis adapter.
const dummyServer = http.createServer();
const io = new Server(dummyServer);

const pub = createClient(process.env.REDIS_URL || 'redis://localhost:6379');
const sub = pub.duplicate();

pub.on('error', (e) => console.error('[timer-worker] redis pub:', e.message));
sub.on('error', (e) => console.error('[timer-worker] redis sub:', e.message));

(async () => {
  io.adapter(createAdapter(pub, sub));

  // We don't need to listen on a port, but Socket.IO needs the server attached
  dummyServer.listen(0);

  console.log('[timer-worker] Redis adapter connected — ticking every second');

  setInterval(tick, 1000);
})();

async function tick() {
  // Get all room IDs from Redis
  const roomIds = await store.roomAllIds();

  await Promise.all(
    roomIds.map(async (roomId) => {
      const timer = await store.timerGet(roomId);
      if (!timer || !timer.running) return;

      // Try to acquire (or refresh) the lock for this room
      const hasLock =
        (await store.timerLockAcquire(roomId, INSTANCE_ID)) ||
        (await store.timerLockRefresh(roomId, INSTANCE_ID));

      if (!hasLock) return; // another worker instance owns this room

      const newSeconds = await store.timerDecrement(roomId);

      // Emit tick to all clients in the room (via Redis adapter → all app instances)
      io.to(roomId).emit('timer:tick', {
        secondsLeft: newSeconds,
        totalSeconds: timer.totalSeconds,
        mode: timer.mode,
        sessionCount: timer.sessionCount,
      });

      if (newSeconds > 0) return;

      // ── Session / break transition ────────────────────────────────────────
      const room = await store.roomGet(roomId);
      if (!room) return;

      await store.timerSet(roomId, { running: 'false' });
      await store.timerLockRelease(roomId, INSTANCE_ID);

      if (timer.mode === 'focus') {
        if (timer.skipBreakCycle) {
          // Auto-restart next focus session
          const next = {
            running: 'true',
            mode: 'focus',
            secondsLeft: String(timer.totalSeconds),
            totalSeconds: String(timer.totalSeconds),
            sessionCount: String(timer.sessionCount + 1),
            skipBreakCycle: 'true',
          };
          await store.timerSet(roomId, next);
          io.to(roomId).emit('timer:milestone', { sessionCount: timer.sessionCount + 1 });
        } else {
          const breakSecs = 5 * 60;
          await store.timerSet(roomId, {
            running: 'true',
            mode: 'break',
            secondsLeft: String(breakSecs),
            totalSeconds: String(breakSecs),
            sessionCount: String(timer.sessionCount),
            skipBreakCycle: 'false',
          });
          io.to(roomId).emit('timer:session-complete', { sessionCount: timer.sessionCount });
        }
      } else {
        // break finished → new focus session
        const focusSecs = room.sessionMins * 60;
        await store.timerSet(roomId, {
          running: 'true',
          mode: 'focus',
          secondsLeft: String(focusSecs),
          totalSeconds: String(focusSecs),
          sessionCount: String(timer.sessionCount + 1),
          skipBreakCycle: timer.skipBreakCycle ? 'true' : 'false',
        });
        io.to(roomId).emit('timer:break-complete', { sessionCount: timer.sessionCount + 1 });
      }

      // Broadcast full room state update after transition
      const updatedTimer = await store.timerGet(roomId);
      const members = await store.membersGet(roomId);
      const messages = await store.messagesGet(roomId, 60);
      io.to(roomId).emit('room:update', {
        ...room,
        timer: updatedTimer,
        members: Object.entries(members).map(([sid, m]) => ({ ...m, socketId: sid })),
        memberCount: Object.keys(members).length,
        messages,
      });
    })
  );

  // ── Expire rooms ──────────────────────────────────────────────────────────
  const roomIds2 = await store.roomAllIds();
  await Promise.all(
    roomIds2.map(async (roomId) => {
      const room = await store.roomGet(roomId);
      if (!room || room.expiresAt == null) return;
      if (Date.now() < room.expiresAt) return;

      // Room has expired
      await store.timerSet(roomId, { running: 'false' });
      io.to(roomId).emit('room:expired');

      // Reset to default template if it's a default room
      const defaultTemplate = DEFAULT_ROOMS.find((r) => r.id === roomId);
      if (defaultTemplate) {
        const resetRoom = makeRoomMeta(defaultTemplate);
        await store.roomSet(roomId, resetRoom);
        await store.timerSet(roomId, {
          running: 'false',
          mode: 'focus',
          secondsLeft: String(defaultTemplate.sessionMins * 60),
          totalSeconds: String(defaultTemplate.sessionMins * 60),
          sessionCount: '1',
          skipBreakCycle: 'true',
        });
      }
    })
  );
}

// ── Default room templates (kept in sync with index.js) ──────────────────────
const DEFAULT_ROOMS = [
  { id: 'r1', name: 'Quiet Library',   type: 'neutral', theme: 'dark',    subject: 'General Study', icon: '📚', maxMembers: 40, sessionMins: 25 },
  { id: 'r2', name: 'Lavender Lounge', type: 'female',  theme: 'cafe',    subject: 'Exam Prep',     icon: '💜', maxMembers: 40, sessionMins: 50 },
  { id: 'r3', name: 'Deep Work Den',   type: 'male',    theme: 'minimal', subject: 'Coding',        icon: '💻', maxMembers: 40, sessionMins: 90 },
  { id: 'r4', name: 'Dawn Desk',       type: 'neutral', theme: 'night',   subject: 'Productivity',  icon: '🌅', maxMembers: 50, sessionMins: 25 },
  { id: 'r5', name: 'Bloom Room',      type: 'female',  theme: 'cafe',    subject: 'Languages',     icon: '🌸', maxMembers: 40, sessionMins: 50 },
  { id: 'r6', name: 'The Grind',       type: 'neutral', theme: 'dark',    subject: 'Deep Work',     icon: '⚡', maxMembers: 50, sessionMins: 90 },
];

function makeRoomMeta(t) {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    theme: t.theme,
    subject: t.subject,
    icon: t.icon,
    maxMembers: t.maxMembers,
    sessionMins: t.sessionMins,
    messages: [],
    createdAt: Date.now(),
    expiresAt: null,
  };
}

process.on('SIGINT', graceful);
process.on('SIGTERM', graceful);
async function graceful() {
  console.log('[timer-worker] shutting down...');
  process.exit(0);
}
