# Etapa de dependencias completas (incluye herramientas de prueba).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Etapa de pruebas: docker compose --profile test run --rm tests
FROM deps AS test
ENV NODE_ENV=test
ENV WHATSAPP_PROVIDER=none
COPY server ./server
COPY public ./public
COPY config ./config
COPY tests ./tests
CMD ["npm", "test"]

# Etapa de producción.
FROM node:22-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/app.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY config ./config
COPY README.md ./README.md

RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "server/index.js"]
