# HazelPOS landing page (its own Railway project). Build context is the repo root.
FROM node:22.17-bookworm-slim
WORKDIR /site
COPY site/ ./
USER node
CMD ["node", "server.js"]
