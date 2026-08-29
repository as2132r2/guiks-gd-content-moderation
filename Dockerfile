FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# 试用手册随构建拷进 dist/——运行镜像只带 dist/，读不到 docs/。
COPY scripts ./scripts
COPY docs/deploy/user-manual.html ./docs/deploy/user-manual.html
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    APP_MODE=demo \
    PORT=3300 \
    DATABASE_PATH=/app/data/app.db \
    FAIL_CLOSED=true

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3300
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3300/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
