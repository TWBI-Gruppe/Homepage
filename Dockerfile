FROM node:22-alpine

RUN apk add --no-cache su-exec

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/

# Database and downloaded preview images live in /data – attach a persistent
# volume there (docker-compose does this; on Railway add a volume at /data).
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
