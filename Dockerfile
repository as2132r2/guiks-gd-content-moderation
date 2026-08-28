# 贵客松广电内容项目 — 独立 demo 服务镜像。
# 这是一个和薄荷线上生态无关的独立服务：自己的容器、端口和配置。
# 纯 Node + TypeScript，通过 tsx 直接运行 src/index.ts，无需编译产物(dist)。
# Node 22+ 是硬要求（本机是 Node 25，锁定 22 求稳定）。
FROM node:22-slim

# 在 /app 里干活。
WORKDIR /app

# 先只拷贝依赖清单，命中 Docker 层缓存：只有依赖变了才重装。
COPY package.json package-lock.json ./

# 关键点：tsx 是 devDependency，而下面设置了 NODE_ENV=production。
# npm 在 production 模式下默认会跳过 devDependencies —— 那样 tsx 就装不上，
# 容器一启动就找不到 tsx、直接崩。所以这里显式 --include=dev 把 devDeps 也装上。
RUN npm ci --include=dev

# 拷贝运行所需的源码与 TS 配置。tsx 直接跑 TS，不需要 build/dist。
COPY tsconfig.json ./
COPY src ./src

# 运行期环境：生产模式 + 默认端口 3300。
# 注意 NODE_ENV=production 只影响运行行为；devDeps 已在上面的构建阶段装好。
ENV NODE_ENV=production
ENV PORT=3300

# 服务监听 3300。
EXPOSE 3300

# 健康检查：命中内置的 /healthz。用 Node 自带 http，无需额外装 curl/wget。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3300/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 启动即 `npm start` → tsx src/index.ts。
CMD ["npm", "start"]
