FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
ENV NODE_OPTIONS=--max-old-space-size=1024
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_IGNORE_INCORRECT_LOCKFILE=1
RUN npm run build \
 && ./node_modules/.bin/esbuild src/db/seed.ts --bundle --platform=node --format=esm --external:better-sqlite3 --outfile=dist/seed.mjs

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=/app/data/taxi.db
ENV NEXT_TELEMETRY_DISABLED=1

RUN mkdir -p /app/data
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/dist/seed.mjs ./dist/seed.mjs

EXPOSE 3000
CMD ["node", "server.js"]
