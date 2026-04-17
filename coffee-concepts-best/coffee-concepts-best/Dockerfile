# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
# Install only production deps
RUN npm ci --omit=dev

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy deps + generated Prisma client from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy app source
COPY server  ./server
COPY public  ./public
COPY package*.json ./
COPY prisma  ./prisma

EXPOSE 4000

# Default command = main API server.
# Override with CMD ["node","server/timerWorker.js"] for the timer service.
CMD ["node", "server/index.js"]
