# Build a partir da raiz do monorepo (veja docker-compose.yml: context: .)
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/apps/web

COPY --chown=node:node apps/web/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --chown + chmod garantem leitura pelo usuário "node",
# mesmo que os arquivos no computador estejam com permissão restrita (ex.: 600)
COPY --chown=node:node apps/web/src ./src
COPY --chown=node:node apps/web/migrations ./migrations
COPY --chown=node:node apps/web/public ./public
COPY --chown=node:node packages/core /app/packages/core
RUN chmod -R u=rwX,go=rX /app/apps/web/src /app/apps/web/migrations /app/apps/web/public /app/packages/core

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
