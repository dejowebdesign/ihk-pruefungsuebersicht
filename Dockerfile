# ── build stage ──────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# OpenSSL is required by the Prisma query-engine binary at `prisma generate`
# time. node:20-slim ships without it, so Prisma falls back to guessing the
# libssl version — which works on some hosts but fails with exit 1 on stricter
# build environments (e.g. Portainer). Installing it makes generate deterministic.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install prisma-related native deps for db push at runtime (sqlite better-sqlite3).
COPY backend/package.json backend/package-lock.json* ./backend/
COPY package.json package-lock.json* ./

# Install backend deps including devDependencies (prisma CLI + tsx are devDeps but
# required at runtime for `prisma db push` and running tsx serve.ts). The backend
# workspace is referenced by its package name "ihk-pruefungsuebersicht".
# NB: do NOT use `--omit=dev=false` (invalid value — npm rejects/escalates it)
# and do NOT mask failures with `|| npm install` (installs the whole frontend
# tree and hides the real error). `--include=dev` is the correct, explicit flag.
RUN npm install --workspace=ihk-pruefungsuebersicht --include=dev

# Copy source and generate prisma client.
COPY backend/ ./backend/
RUN cd backend && npx prisma generate

# ── runtime stage ─────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_URL="file:/app/data/ihk.db"
ENV LOG_LEVEL=warn

# sqlite3 runtime libs + curl for healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy installed node_modules and built source from build stage.
# NOTE: npm workspaces hoist all deps (incl. @prisma/client + generated .prisma)
# into the root node_modules, so backend/node_modules is empty.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/tsconfig.json ./backend/tsconfig.json
COPY --from=build /app/package.json ./package.json

# Persistent data volume for SQLite.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3001

# Healthcheck: hit the health endpoint every 30s.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3001/api/health || exit 1

# On first start, push the schema into the (possibly empty) data volume, then
# launch the API server (+ scheduler). The entrypoint runs from /app so the
# hoisted node_modules (tsx, @prisma/client, .prisma) resolve correctly.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

WORKDIR /app/backend

# Start API server. Use --with-scheduler to also run periodic imports.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["--with-scheduler"]
