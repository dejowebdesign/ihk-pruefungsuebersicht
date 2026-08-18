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

# Standalone Next.js server + static assets. The rewrites proxy forwards
# /api/* to the backend service (BACKEND_URL) at runtime.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/standalone/frontend ./frontend
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

EXPOSE 3000

# Next standalone server reads from frontend/ when the app was built as a workspace.
WORKDIR /app/frontend
CMD ["node", "server.js"]
