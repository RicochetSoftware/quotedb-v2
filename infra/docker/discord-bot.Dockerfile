FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @quotedb/discord-bot...
RUN pnpm --filter @quotedb/discord-bot build
RUN pnpm --filter @quotedb/discord-bot deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
CMD ["node", "dist/index.js"]
