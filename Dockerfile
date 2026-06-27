# Stage 1: install deps
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ \
  && npm ci \
  && npm rebuild better-sqlite3

# Stage 2: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: production image
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

# Copy the standalone output and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy native module (better-sqlite3 .node binary)
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
