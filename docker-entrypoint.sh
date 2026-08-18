#!/bin/sh
# Container entrypoint: ensure the SQLite schema exists, then launch the API.
# Runs from /app/backend so prisma/schema.prisma resolves.
set -e

# Generate the Prisma client for the container's runtime and push the schema
# into the (possibly empty) data volume. Idempotent and safe on restart.
npx prisma generate >/dev/null 2>&1 || echo "prisma generate warning" >&2
npx prisma db push --accept-data-loss >/dev/null 2>&1 || {
  echo "prisma db push failed; continuing (schema may already exist)" >&2
}

# Hand off to the API server. $@ forwards CMD args (e.g. --with-scheduler).
exec npx tsx src/scripts/serve.ts "$@"
