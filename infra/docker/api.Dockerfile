# Platform-neutral API image (DigitalOcean via GHCR, Render, Fly, or infra/selfhost). Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t quotedb-api .
# No BuildKit cache mounts, so the file builds the same on any builder.

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
# Only the API and its workspace dependencies (packages/shared); native builds are allowed via
# pnpm-workspace.yaml `allowBuilds` (argon2, esbuild).
RUN pnpm install --frozen-lockfile --filter @quotedb/api...
RUN pnpm --filter @quotedb/api build
# Self-contained production install: dist/ + drizzle/ migrations + prod node_modules.
RUN pnpm --filter @quotedb/api deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 8080
# Run migrations separately before starting: `node dist/migrate.js` (infra/droplet/deploy.sh does).
CMD ["node", "dist/index.js"]
