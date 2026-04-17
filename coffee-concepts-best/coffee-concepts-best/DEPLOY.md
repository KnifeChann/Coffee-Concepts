# ☕ Coffee & Concepts — Deploy Guide

> This guide walks you from zero to a live, scalable deployment on **Railway** in ~15 minutes.

---

## Prerequisites

- [Railway account](https://railway.app) (free tier is enough to start)
- Git + this repo pushed to GitHub

---

## Step 1 — Push to GitHub

```bash
git init                        # if not already a git repo
git add .
git commit -m "feat: scalable production setup"
git remote add origin https://github.com/YOUR_USERNAME/coffee-concepts-best.git
git push -u origin main
```

---

## Step 2 — Create Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Deploy from GitHub repo"**
3. Select `coffee-concepts-best`
4. Railway will detect the `Dockerfile` automatically — click **Deploy**

---

## Step 3 — Add PostgreSQL Plugin

1. In your Railway project dashboard click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway automatically injects `$DATABASE_URL` into all services in the project ✅

---

## Step 4 — Add Redis Plugin

1. Click **"+ New"** → **"Database"** → **"Redis"**
2. Railway automatically injects `$REDIS_URL` into all services ✅

---

## Step 5 — Run DB Migrations

Railway doesn't run migrations automatically. Do it once via the Railway shell:

```bash
# In the Railway dashboard → your app service → "Shell" tab:
npx prisma migrate deploy
```

Or add it as a start command override (runs before the app):

```
npx prisma migrate deploy && node server/index.js
```

---

## Step 6 — Set Environment Variables

In Railway → your **app** service → **Variables** tab, add:

| Variable | Value |
|---|---|
| `JWT_SECRET` | A long random string (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `ADMIN_EMAILS` | `your@email.com` (comma-separated for multiple) |
| `WEATHER_API_KEY` | *(optional)* OpenWeatherMap key |

`DATABASE_URL` and `REDIS_URL` are injected by Railway automatically — **don't add them manually**.

---

## Step 7 — Add the Timer Worker as a Separate Service

The timer process must run separately from the API server.

1. Click **"+ New"** → **"GitHub Repo"** → select the same repo
2. In **Settings** → **Start Command**, set:
   ```
   node server/timerWorker.js
   ```
3. Add the same env vars (`JWT_SECRET`, `ADMIN_EMAILS`) — `DATABASE_URL` and `REDIS_URL` are auto-injected
4. **Keep this service at exactly 1 replica** (Railway default)

---

## Step 8 — Scale the API Server

The API server is stateless (all state in Postgres + Redis), so you can scale freely:

Railway Dashboard → app service → **Settings** → **Replicas** → set to 2, 3, etc.

All instances share Redis for real-time events (Socket.IO Redis adapter) and Postgres for data.

---

## Step 9 — Custom Domain (Optional)

Railway generates a URL like `coffee-concepts-best.up.railway.app`.

To use your own domain:
1. Railway → app service → **Settings** → **Domains** → **Add Custom Domain**
2. Add a CNAME record in your DNS pointing to the Railway domain

---

## Local Development (Docker)

```bash
# Copy environment template
cp .env.example .env
# Edit .env — change JWT_SECRET at minimum

# Build and start everything
docker-compose up --build

# App: http://localhost:4000
# To test multi-instance scaling locally:
docker-compose up --scale app=3
```

---

## Architecture Overview

```
Browser clients
      │
      │  HTTP + WebSocket
      ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  App (N=3)  │    │  App (N=3)  │    │  App (N=3)  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
              ┌───────────┴───────────┐
              │         Redis         │  ← Socket.IO adapter (pub/sub)
              │  rooms / sessions /   │  ← Shared real-time state
              │  chat / rate-limits   │
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              │    Timer Worker (1)   │  ← Holds Redis lock per room
              │   timerWorker.js      │  ← Emits tick events via adapter
              └───────────────────────┘
                          │
              ┌───────────┴───────────┐
              │      PostgreSQL       │  ← Users, stats, todos
              └───────────────────────┘
```

---

## Monitoring

- **Health check**: `GET /api/health` → `{ status:"ok", rooms:N, users:N, uptime:N }`
- Railway provides built-in metrics and logs per service
- Add [Better Stack](https://betterstack.com) or [Grafana Cloud](https://grafana.com) for alerting
