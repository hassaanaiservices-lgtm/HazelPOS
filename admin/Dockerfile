# HazelPOS Admin panel (second Railway service). Build context is the repo root:
#   docker build -f admin/Dockerfile -t hazelpos-admin .
FROM node:22.17-bookworm-slim AS build
WORKDIR /app
COPY admin/package*.json admin/
RUN npm --prefix admin ci
COPY admin admin
RUN npm --prefix admin run build

FROM node:22.17-bookworm-slim
ENV NODE_ENV=production PORT=4400
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm ci --omit=dev
COPY admin/server.js ./
COPY --from=build /app/admin/dist dist
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4400)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
