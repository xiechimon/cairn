FROM node:24-bookworm AS build
RUN npm install --global pnpm@12.5.1
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile --filter @xiechimon/cairn... --filter @cairn/web...
RUN pnpm --filter @cairn/web build
RUN pnpm --filter @xiechimon/cairn build

FROM node:24-bookworm AS native
WORKDIR /opt/native
COPY apps/server/package.json /tmp/server-package.json
RUN node -e "const v = require('/tmp/server-package.json').dependencies['better-sqlite3']; require('fs').writeFileSync('package.json', JSON.stringify({ private: true, dependencies: { 'better-sqlite3': v } }))"
RUN npm install --omit=dev
RUN cd node_modules/better-sqlite3 && npx node-gyp rebuild --release --force_build=1 && rm -rf prebuilds
RUN node -e "const D = require('better-sqlite3'); new D(':memory:').prepare('select 1').get()"

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install --yes --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=native /opt/native/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./web
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV CAIRN_HOME=/data
ENV CAIRN_REQUIRE_TOKEN=1
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/app').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/index.mjs"]
