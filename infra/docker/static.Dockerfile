# web + admin + site static builds served by Caddy (production and infra/selfhost). Build from the repo root:
#   docker build -f infra/docker/static.Dockerfile --build-arg DOMAIN=quotes.example.com -t quotedb-static .
# CI pushes this image to GHCR; the Droplet runs it alongside the API and PostgreSQL.

FROM node:24-slim AS build
ARG DOMAIN
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @quotedb/web... --filter @quotedb/admin... --filter @quotedb/site...
# Build-time public config (baked into the bundles, never secrets).
ENV VITE_API_URL=https://api.${DOMAIN} \
    VITE_WEB_URL=https://app.${DOMAIN} \
    VITE_ADMIN_URL=https://admin.${DOMAIN} \
    PUBLIC_WEB_URL=https://app.${DOMAIN}
RUN test -n "$DOMAIN" \
  && pnpm --filter @quotedb/web build \
  && pnpm --filter @quotedb/admin build \
  && pnpm --filter @quotedb/site build

FROM caddy:2
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/admin/dist /srv/admin
COPY --from=build /repo/apps/site/dist /srv/site
COPY infra/selfhost/Caddyfile /etc/caddy/Caddyfile
