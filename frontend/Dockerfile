# ── build stage ──────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Copy manifests first for layer caching. The frontend lives in a npm workspace
# at the repo root, so we need the root package.json + lockfile too.
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package-lock.json* ./frontend/

# Install workspace deps (frontend + root workspace setup).
RUN npm install --workspace=ihk-pruefungsuebersicht-frontend || npm install

# Copy frontend source.
COPY frontend/ ./frontend/

# Build the Next.js production bundle (standalone output).
RUN npm --workspace=ihk-pruefungsuebersicht-frontend run build

# ── runtime stage ─────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone Next.js server + static assets. The middleware proxy forwards
# /api/* to the backend service (BACKEND_URL) at runtime.
#
# Standalone layout (npm workspace build, monorepo tracing root):
#   .next/standalone/
#     ├─ package.json
#     ├─ node_modules/        (traced deps, hoisted)
#     └─ frontend/
#          ├─ server.js       (standalone server entry)
#          └─ .next/          (server chunks, NO static)
# So copying standalone/* into /app yields /app/frontend/server.js. Static
# assets are emitted separately into .next/static and must be copied on top.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
# NOTE: public/ is intentionally NOT copied. The app ships no static public
# assets (no favicon/icons referenced in metadata), and the directory is empty
# and untracked — copying it would break builds from a fresh checkout
# ("COPY failed: file not found"). Add a public/ COPY here only if real
# public assets are introduced.

EXPOSE 3000

# Standalone server.js lives under frontend/ (workspace build) and expects
# .next/ adjacent; node_modules is resolved from the parent /app.
WORKDIR /app/frontend
CMD ["node", "server.js"]
