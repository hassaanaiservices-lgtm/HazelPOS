# HazelPOS server (Railway or any Docker host). Build: docker build -t hazelpos .
FROM node:22.17-bookworm-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN npm --prefix client ci
COPY client client
RUN npm --prefix client run build

FROM node:22.17-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=4000
WORKDIR /app
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY server server
COPY rag rag
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown -R node:node /data /app
# Railway mounts volumes owned by root: set RAILWAY_RUN_UID=0 there. On a VPS: chown -R 1000:1000 ./data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
