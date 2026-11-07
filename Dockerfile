# syntax=docker/dockerfile:1
# Coolify / generic Docker build for Review Matters.
# Debian slim (not alpine) so Prisma engines and sharp use glibc builds.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# "npm run build" runs prisma generate && next build.
# public/ may be absent from the checkout (empty dirs aren't tracked by git);
# the runner COPY needs the path to exist either way.
RUN mkdir -p public && npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/private-uploads && chown node:node /app/private-uploads

# Full node_modules are kept on purpose: the entrypoint runs
# `prisma migrate deploy` and the ops scripts (bootstrap-admin, maintenance,
# security-worker) run via tsx inside the container when needed.
COPY --from=builder /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
# Apply migrations, then serve. Migrations are additive and idempotent.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
