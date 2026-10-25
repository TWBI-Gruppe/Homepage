FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

# Database and downloaded preview images live in /data – mount a volume there.
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data PORT=3000
VOLUME /data
EXPOSE 3000

USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
